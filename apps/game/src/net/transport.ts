// Co-op WebSocket transport (client side of ARCHITECTURE §10 / @ms/shared coop protocol). Owner: NET.
//
// This module only moves messages: connection lifecycle, auth, reconnect, keepalive, latency, message framing and
// the guard rails the relay enforces (size caps, host-only snapshots). Gameplay synchronisation (what goes into the
// input / snapshot / event payloads) is built on top of it later.
//
//   const t = CoopTransport.forRoom(api, 'ABC234');
//   t.on('roomState', (s) => …);  t.on('snapshot', ({ header, payload }) => …);
//   const hello = await t.connect();
//   t.join(loadout, true); …

import {
  COOP_AUTH_PROTOCOL_PREFIX,
  COOP_CLOSE,
  COOP_LIMITS,
  COOP_PROTOCOL,
  COOP_RATES,
  COOP_SUBPROTOCOL,
  PING_FRAME,
  clientMessageLimit,
  encodeSnapshot,
  formatBearer,
  parseServerMessage,
  readSnapshotHeader,
  snapshotPayload,
  type ClientMessage,
  type Credentials,
  type Difficulty,
  type InputFields,
  type JsonValue,
  type Loadout,
  type LobbyPlayer,
  type RoomLimitsInfo,
  type RoomPhase,
  type ServerMessage,
  type SnapshotHeader,
  type Slot,
  type ZoneId,
} from '@ms/shared';
import type { ApiClient } from './api';

export type TransportState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

type Of<T extends ServerMessage['t']> = Extract<ServerMessage, { t: T }>;

export interface SnapshotEvent {
  header: SnapshotHeader;
  /** the complete frame as received */
  frame: ArrayBuffer;
  /** zero-copy view of the payload after the 16-byte header */
  payload: Uint8Array;
}

export interface CloseInfo {
  code: number;
  reason: string;
  /** a reconnect attempt has been scheduled */
  willReconnect: boolean;
}

export interface TransportEvents {
  state: TransportState;
  hello: Of<'hello'>;
  roomState: Of<'roomState'>;
  start: Of<'start'>;
  end: Of<'end'>;
  /** host only: a guest's input */
  input: Of<'input'>;
  event: Of<'event'>;
  /** host only: a guest's card pick */
  pick: Of<'pick'>;
  pause: Of<'pause'>;
  resume: Of<'resume'>;
  /** guests only: a host snapshot (frames from a stale host epoch are dropped before this fires) */
  snapshot: SnapshotEvent;
  /** server-reported problem (`rate_limited`, `not_host`, …) */
  error: Of<'error'>;
  close: CloseInfo;
}

export interface CoopTransportOptions {
  /** `wss://…/api/v1/coop/ABC234` (see `ApiClient.coopSocketUrl`) */
  url: string;
  credentials: Credentials;
  /** injectable for tests / non-browser hosts */
  WebSocketImpl?: typeof WebSocket;
  /** reconnect after unexpected drops (default true); the server holds a player's slot for 60 s during a run */
  reconnect?: boolean;
  maxReconnectAttempts?: number;
  pingIntervalMs?: number;
  now?: () => number;
}

// `number` in browsers, `Timeout` under Node (vitest): the timer API's own handle type covers both.
type TimerHandle = ReturnType<typeof setTimeout>;

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: Error): void;
}

// Promise.withResolvers is ES2024; the game compiles against the ES2023 lib.
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Close codes after which retrying is pointless. */
const FATAL_CLOSE_CODES: readonly number[] = [COOP_CLOSE.policy, COOP_CLOSE.replaced, COOP_CLOSE.idle, COOP_CLOSE.roomClosed, COOP_CLOSE.rateAbuse];
const OPEN = 1;

export class CoopTransport {
  state: TransportState = 'idle';
  room = '';
  /** our slot; -1 until `hello` */
  slot = -1;
  host = -1;
  epoch = 0;
  phase: RoomPhase = 'lobby';
  players: LobbyPlayer[] = [];
  limits: RoomLimitsInfo = {
    maxPlayers: 4,
    inputBytes: COOP_LIMITS.inputBytes,
    eventBytes: COOP_LIMITS.eventBytes,
    snapshotBytes: COOP_LIMITS.snapshotBytes,
  };
  /** smoothed round-trip time in ms (0 until the first pong) */
  latencyMs = 0;

  private ws: WebSocket | null = null;
  private readonly opts: CoopTransportOptions;
  private readonly now: () => number;
  private readonly handlers = new Map<keyof TransportEvents, Set<(e: never) => void>>();
  private connecting: Deferred<Of<'hello'>> | null = null;
  private userClosed = false;
  private everOpened = false;
  private attempts = 0;
  private reconnectTimer: TimerHandle | undefined;
  private pingTimer: TimerHandle | undefined;
  private pingSentAt = 0;
  private serverOffset = 0;

  constructor(opts: CoopTransportOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
  }

  /** Convenience: transport for `room` using the API client's base URL and stored credentials. */
  static forRoom(api: ApiClient, room: string, opts: Partial<CoopTransportOptions> = {}): CoopTransport {
    const credentials = api.getCredentials();
    if (!credentials) throw new Error('Register with the API before joining a co-op room');
    const t = new CoopTransport({ url: api.coopSocketUrl(room), credentials, ...opts });
    t.room = room.toUpperCase();
    return t;
  }

  // ---- events ---------------------------------------------------------------

  on<K extends keyof TransportEvents>(type: K, fn: (e: TransportEvents[K]) => void): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(fn as (e: never) => void);
    return () => set.delete(fn as (e: never) => void);
  }

  private emit<K extends keyof TransportEvents>(type: K, payload: TransportEvents[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        (fn as (e: TransportEvents[K]) => void)(payload);
      } catch (err) {
        console.error(`co-op handler for "${type}" failed`, err);
      }
    }
  }

  private setState(next: TransportState): void {
    if (this.state === next) return;
    this.state = next;
    this.emit('state', next);
  }

  // ---- connection --------------------------------------------------------------

  get isOpen(): boolean {
    return this.ws !== null && this.ws.readyState === OPEN;
  }
  get isHost(): boolean {
    return this.slot >= 0 && this.slot === this.host;
  }

  /** Server wall clock (ms), estimated from the last `hello` / `pong`. */
  serverNow(): number {
    return this.now() + this.serverOffset;
  }

  /** Resolves with the server's `hello` (slot, host, roster); rejects when the socket closes first. */
  connect(): Promise<Of<'hello'>> {
    if (this.connecting) return this.connecting.promise;
    if (this.isOpen && this.slot >= 0) {
      this.userClosed = false;
      const m: Of<'hello'> = {
        t: 'hello',
        proto: COOP_PROTOCOL,
        room: this.room,
        slot: this.slot as Slot,
        host: this.host as Slot,
        epoch: this.epoch,
        phase: this.phase,
        serverTime: this.serverNow(),
        players: this.players,
        limits: this.limits,
      };
      queueMicrotask(() => {
        if (!this.isOpen || this.userClosed) return;
        this.emit('state', 'open');
        this.emit('hello', m);
      });
      return Promise.resolve(m);
    }
    this.userClosed = false;
    this.attempts = 0;
    this.connecting = deferred<Of<'hello'>>();
    const pending = this.connecting.promise;
    pending.catch(() => undefined);
    this.open('connecting');
    return pending;
  }

  private open(state: TransportState): void {
    this.setState(state);
    const Impl = this.opts.WebSocketImpl ?? WebSocket;
    const token = formatBearer(this.opts.credentials);
    const ws = new Impl(this.opts.url, [COOP_SUBPROTOCOL, `${COOP_AUTH_PROTOCOL_PREFIX}${token}`]);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.everOpened = true;
      this.attempts = 0;
      this.setState('open');
      this.startPing();
    };
    ws.onmessage = (ev: MessageEvent) => {
      if (this.ws === ws) this.onFrame(ev.data as unknown);
    };
    ws.onclose = (ev: CloseEvent) => {
      if (this.ws === ws) this.onClosed(ev.code, ev.reason);
    };
    ws.onerror = () => {
      // the close event that follows carries the outcome
    };
  }

  private onFrame(data: unknown): void {
    if (typeof data === 'string') {
      const parsed = parseServerMessage(data);
      if (!parsed.ok) {
        console.warn('co-op: dropped malformed server frame', parsed.field, parsed.reason);
        return;
      }
      this.onMessage(parsed.value);
      return;
    }
    if (data instanceof ArrayBuffer) {
      const header = readSnapshotHeader(data);
      if (!header) return;
      // 16-bit epoch compare: ignore frames from a host that has since been replaced
      if (this.epoch > 0 && ((header.epoch - (this.epoch & 0xffff)) & 0xffff) > 0x8000) return;
      this.emit('snapshot', { header, frame: data, payload: snapshotPayload(data) });
    }
  }

  private onMessage(m: ServerMessage): void {
    switch (m.t) {
      case 'hello':
        this.room = m.room;
        this.slot = m.slot;
        this.host = m.host;
        this.epoch = m.epoch;
        this.phase = m.phase;
        this.players = m.players;
        this.limits = m.limits;
        this.serverOffset = m.serverTime - this.now();
        this.connecting?.resolve(m);
        this.connecting = null;
        this.emit('hello', m);
        return;
      case 'roomState':
        this.host = m.host;
        this.epoch = m.epoch;
        this.phase = m.phase;
        this.players = m.players;
        this.emit('roomState', m);
        return;
      case 'start':
        this.phase = 'running';
        this.emit('start', m);
        return;
      case 'end':
        this.phase = 'lobby';
        this.emit('end', m);
        return;
      case 'pong':
        if (m.st !== undefined) this.serverOffset = m.st - this.now();
        if (this.pingSentAt > 0) {
          const rtt = this.now() - this.pingSentAt;
          this.latencyMs = this.latencyMs === 0 ? rtt : this.latencyMs * 0.7 + rtt * 0.3;
          this.pingSentAt = 0;
        }
        return;
      case 'input':
        this.emit('input', m);
        return;
      case 'event':
        this.emit('event', m);
        return;
      case 'pick':
        this.emit('pick', m);
        return;
      case 'pause':
        this.emit('pause', m);
        return;
      case 'resume':
        this.emit('resume', m);
        return;
      case 'error':
        this.emit('error', m);
        return;
    }
  }

  private onClosed(code: number, reason: string): void {
    this.stopPing();
    this.ws = null;
    const retry =
      !this.userClosed &&
      this.opts.reconnect !== false &&
      this.everOpened &&
      !FATAL_CLOSE_CODES.includes(code) &&
      this.attempts < (this.opts.maxReconnectAttempts ?? 5);
    if (!this.everOpened || (!retry && this.connecting)) {
      this.connecting?.reject(new Error(`co-op connection failed (code ${code}${reason ? `: ${reason}` : ''})`));
      this.connecting = null;
    }
    this.emit('close', { code, reason, willReconnect: retry });
    if (!retry) {
      this.setState('closed');
      return;
    }
    this.attempts += 1;
    this.setState('reconnecting');
    const delay = Math.min(8000, 500 * 2 ** (this.attempts - 1));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (!this.userClosed) this.open('reconnecting');
    }, delay);
  }

  /** Closes the socket for good (no reconnect). */
  close(): void {
    this.userClosed = true;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.stopPing();
    const ws = this.ws;
    this.ws = null;
    if (ws && ws.readyState <= OPEN) ws.close(COOP_CLOSE.normal, 'client closed');
    this.connecting?.reject(new Error('co-op connection closed'));
    this.connecting = null;
    this.setState('closed');
  }

  private startPing(): void {
    this.stopPing();
    const every = this.opts.pingIntervalMs ?? COOP_RATES.pingIntervalSec * 1000;
    this.pingTimer = setInterval(() => {
      if (!this.isOpen) return;
      this.pingSentAt = this.now();
      this.ws?.send(PING_FRAME);
    }, every);
  }

  private stopPing(): void {
    clearInterval(this.pingTimer);
    this.pingTimer = undefined;
    this.pingSentAt = 0;
  }

  // ---- sending ---------------------------------------------------------------------

  /** Sends a control message; returns false (and sends nothing) when closed or over the relay's size cap. */
  send(msg: ClientMessage): boolean {
    if (!this.isOpen) return false;
    const text = JSON.stringify(msg);
    if (text.length > clientMessageLimit(msg.t)) return false;
    this.ws?.send(text);
    return true;
  }

  join(loadout: Loadout, ready?: boolean): boolean {
    return this.send(ready === undefined ? { t: 'join', loadout } : { t: 'join', loadout, ready });
  }
  /** Tells the room we are leaving (frees the slot immediately) and closes the socket. */
  leave(): void {
    this.send({ t: 'leave' });
    this.close();
  }
  /** Host: start the run for everyone (all players need a loadout; guests must be ready). */
  start(zone: ZoneId, difficulty: Difficulty, seed: number): boolean {
    return this.send({ t: 'start', zone, difficulty, seed });
  }
  /** Host: the run is over, return the room to the lobby. */
  end(victory?: boolean): boolean {
    return this.send(victory === undefined ? { t: 'end' } : { t: 'end', victory });
  }
  /** Guest → host input (call at {@link COOP_RATES}.inputHz). */
  input(fields: InputFields): boolean {
    return this.send({ t: 'input', ...fields });
  }
  /** Reliable event: host → everyone (or `to` one slot); guest → host. */
  event(k: string, d?: JsonValue, opts: { tick?: number; to?: Slot } = {}): boolean {
    const msg: ClientMessage = { t: 'event', k };
    if (d !== undefined) msg.d = d;
    if (opts.tick !== undefined) msg.tick = opts.tick;
    if (opts.to !== undefined) msg.to = opts.to;
    return this.send(msg);
  }
  /** Guest → host card pick (`id` identifies the offer being answered). */
  pick(id: number, index: number): boolean {
    return this.send({ t: 'pick', id, index });
  }
  pause(reason?: string): boolean {
    return this.send(reason === undefined ? { t: 'pause' } : { t: 'pause', reason });
  }
  resume(): boolean {
    return this.send({ t: 'resume' });
  }

  /**
   * Host only: broadcasts a binary snapshot. The header's `epoch` is filled from the room's current host epoch.
   * Returns false when not host, closed, or the frame exceeds the relay cap.
   */
  sendSnapshot(header: Omit<SnapshotHeader, 'epoch'>, payload: Uint8Array): boolean {
    if (!this.isOpen || !this.isHost) return false;
    const frame = encodeSnapshot({ ...header, epoch: this.epoch }, payload);
    if (frame.byteLength > this.limits.snapshotBytes) return false;
    this.ws?.send(frame);
    return true;
  }
}
