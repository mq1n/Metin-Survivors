// In-memory stand-in for the Worker's `CoopRoom` + the client `CoopTransport`, for headless tests and tooling.
// It follows the relay's semantics (workers/api/src/coopRoom.ts): slot assignment, host = lowest slot of the creator, host
// seat migration on host loss (epoch + 1), 60 s slot grace, host-only snapshots (≤ 48 KB), guest → host input / pick /
// event, host → everyone / `to` events, the per-socket token buckets, and the JSON size caps. Latency is virtual: a
// `MemoryNet` clock delivers every message after `latencyMs` (+ jitter) in per-link FIFO order, so a test can run minutes
// of play in a few CPU seconds, deterministically.

import {
  COOP_LIMITS,
  clientMessageLimit,
  encodeSnapshot,
  readSnapshotHeader,
  snapshotPayload,
  type ClientMessage,
  type Difficulty,
  type InputFields,
  type JsonValue,
  type Loadout,
  type LobbyPlayer,
  type RoomCause,
  type RoomLimitsInfo,
  type RoomPhase,
  type ServerMessage,
  type Slot,
  type SnapshotHeader,
  type ZoneId,
} from '@ms/shared';
import type { TransportEvents, TransportState } from '../transport';
import type { CoopWire } from './protocol';

type Of<T extends ServerMessage['t']> = Extract<ServerMessage, { t: T }>;

// Promise.withResolvers is ES2024; the game compiles against the ES2023 lib (same helper as net/transport.ts).
interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: Error): void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface Timer {
  at: number;
  seq: number;
  fn: () => void;
}

export class MemoryNet {
  /** virtual wall clock (ms) */
  now = 0;
  private seq = 0;
  /** pending callbacks ordered by (at, seq) */
  private readonly q: Timer[] = [];

  schedule(delayMs: number, fn: () => void): void {
    const t: Timer = { at: this.now + delayMs, seq: this.seq++, fn };
    let i = this.q.length;
    while (i > 0 && (this.q[i - 1] as Timer).at > t.at) i--;
    this.q.splice(i, 0, t);
  }

  /** advances the clock, running every callback that becomes due in order (callbacks may schedule more) */
  advance(ms: number): void {
    const end = this.now + ms;
    for (let t = this.q[0]; t && t.at <= end; t = this.q[0]) {
      this.q.shift();
      this.now = Math.max(this.now, t.at);
      t.fn();
    }
    this.now = end;
  }
}

class Bucket {
  private tokens: number;
  private last = -1;
  constructor(
    private readonly perSec: number,
    private readonly burst: number,
  ) {
    this.tokens = burst;
  }
  take(now: number): boolean {
    if (this.last < 0) this.last = now;
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.perSec);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

interface Entry {
  slot: Slot;
  playerId: string;
  name: string;
  ready: boolean;
  loadout: Loadout | null;
  graceUntil: number | null;
  client: MemoryTransport | null;
}

export interface RelayTraffic {
  /** bytes the relay received from each slot / sent to each slot */
  up: number[];
  down: number[];
  snapshotFrames: number;
  snapshotBytes: number;
  inputFrames: number;
  eventFrames: number;
  eventBytes: number;
  /** dropped / refused messages (rate limits, size caps, wrong role) */
  violations: string[];
}

export interface MemoryRoomOptions {
  /** one-way client ↔ relay latency (ms) */
  latencyMs?: number;
  /** uniform extra delay per message (ms), FIFO per link is preserved */
  jitterMs?: number;
  seed?: number;
}

const GRACE_MS = 60_000;

export class MemoryRoom {
  readonly code = 'TEST01';
  host: Slot = 0;
  epoch = 1;
  phase: RoomPhase = 'lobby';
  readonly roster: Entry[] = [];
  readonly traffic: RelayTraffic = { up: [0, 0, 0, 0], down: [0, 0, 0, 0], snapshotFrames: 0, snapshotBytes: 0, inputFrames: 0, eventFrames: 0, eventBytes: 0, violations: [] };
  private rng: number;

  constructor(
    readonly net: MemoryNet,
    readonly opts: MemoryRoomOptions = {},
  ) {
    this.rng = opts.seed ?? 1;
  }

  random(): number {
    this.rng = (this.rng * 1664525 + 1013904223) >>> 0;
    return this.rng / 0x100000000;
  }

  /** delay of one hop (ms) */
  hop(): number {
    return (this.opts.latencyMs ?? 20) + this.random() * (this.opts.jitterMs ?? 0);
  }

  /** a transport for `playerId` (call `.connect()` on it) */
  client(playerId: string, name = playerId): MemoryTransport {
    return new MemoryTransport(this, playerId, name);
  }

  lobbyPlayers(): LobbyPlayer[] {
    return [...this.roster]
      .sort((a, b) => a.slot - b.slot)
      .map((e) => ({ slot: e.slot, name: e.name, connected: e.client?.isOpen === true, ready: e.ready, loadout: e.loadout }));
  }

  /** server side of `connect` */
  accept(client: MemoryTransport): { ok: true; entry: Entry; rejoin: boolean } | { ok: false; code: string } {
    let entry = this.roster.find((e) => e.playerId === client.playerId);
    let rejoin = false;
    if (entry) {
      rejoin = entry.client !== null || entry.graceUntil !== null;
    } else {
      if (this.phase === 'running') return { ok: false, code: 'room_in_progress' };
      const slot = ([0, 1, 2, 3] as Slot[]).find((s) => !this.roster.some((e) => e.slot === s));
      if (slot === undefined) return { ok: false, code: 'room_full' };
      entry = { slot, playerId: client.playerId, name: client.name, ready: false, loadout: null, graceUntil: null, client: null };
      this.roster.push(entry);
    }
    if (entry.client && entry.client !== client) entry.client.serverClose(4001, false);
    entry.client = client;
    entry.graceUntil = null;
    return { ok: true, entry, rejoin };
  }

  entryOf(client: MemoryTransport): Entry | undefined {
    return this.roster.find((e) => e.client === client);
  }

  /** server → one client */
  sendTo(e: Entry, msg: ServerMessage): void {
    const c = e.client;
    if (!c) return;
    const text = JSON.stringify(msg);
    this.traffic.down[e.slot] = (this.traffic.down[e.slot] as number) + text.length;
    c.deliverLater(() => c.receive(JSON.parse(text) as ServerMessage));
  }

  sendFrameTo(e: Entry, frame: ArrayBuffer): void {
    const c = e.client;
    if (!c) return;
    this.traffic.down[e.slot] = (this.traffic.down[e.slot] as number) + frame.byteLength;
    const copy = frame.slice(0);
    c.deliverLater(() => c.receiveFrame(copy));
  }

  broadcast(msg: ServerMessage, except?: Entry): void {
    for (const e of this.roster) if (e !== except && e.client?.isOpen) this.sendTo(e, msg);
  }

  broadcastRoomState(cause: RoomCause): void {
    this.broadcast({ t: 'roomState', room: this.code, phase: this.phase, host: this.host, epoch: this.epoch, players: this.lobbyPlayers(), cause });
  }

  migrateHost(): RoomCause | null {
    const next = this.roster.filter((e) => e.client?.isOpen).sort((a, b) => a.slot - b.slot)[0];
    if (!next || next.slot === this.host) return null;
    const from = this.host;
    this.host = next.slot;
    this.epoch += 1;
    return { kind: 'hostChanged', slot: next.slot, from };
  }

  /** a socket went away (drop or leave); `leave` frees the slot at once, a drop keeps it for the grace period */
  gone(e: Entry, kind: 'leave' | 'disconnect'): void {
    e.client = null;
    if (kind === 'leave' || this.phase === 'lobby') {
      this.roster.splice(this.roster.indexOf(e), 1);
    } else {
      e.graceUntil = this.net.now + GRACE_MS;
    }
    let cause: RoomCause = { kind, slot: e.slot };
    if (this.host === e.slot) {
      const m = this.migrateHost();
      if (m) cause = m;
    }
    this.broadcastRoomState(cause);
  }

  violation(msg: string): void {
    this.traffic.violations.push(msg);
  }
}

export class MemoryTransport implements CoopWire {
  state: TransportState = 'idle';
  room = '';
  slot = -1;
  host = -1;
  epoch = 0;
  phase: RoomPhase = 'lobby';
  players: LobbyPlayer[] = [];
  latencyMs = 0;
  limits: RoomLimitsInfo = { maxPlayers: 4, inputBytes: COOP_LIMITS.inputBytes, eventBytes: COOP_LIMITS.eventBytes, snapshotBytes: COOP_LIMITS.snapshotBytes };

  private readonly handlers = new Map<keyof TransportEvents, Set<(e: never) => void>>();
  private opened = false;
  private lastDeliver = 0;
  private lastUp = 0;
  private reconnecting = false;
  private readonly buckets = { any: new Bucket(150, 300), input: new Bucket(30, 60), snapshot: new Bucket(30, 45), event: new Bucket(20, 40), control: new Bucket(8, 16), ping: new Bucket(4, 8) };

  constructor(
    private readonly relay: MemoryRoom,
    readonly playerId: string,
    readonly name: string,
  ) {}

  get isOpen(): boolean {
    return this.opened;
  }
  get isHost(): boolean {
    return this.slot >= 0 && this.slot === this.host;
  }

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
    for (const fn of [...(this.handlers.get(type) ?? [])]) (fn as (e: TransportEvents[K]) => void)(payload);
  }

  private setState(s: TransportState): void {
    if (this.state === s) return;
    this.state = s;
    this.emit('state', s);
  }

  /** a message from the relay arrives after the link latency, never overtaking an earlier one */
  deliverLater(fn: () => void): void {
    const net = this.relay.net;
    const at = Math.max(net.now + this.relay.hop(), this.lastDeliver);
    this.lastDeliver = at;
    net.schedule(at - net.now, () => {
      if (this.opened || this.state === 'connecting') fn();
    });
  }

  /** a message to the relay: processed after the link latency in FIFO order */
  private up(fn: () => void): void {
    const net = this.relay.net;
    const at = Math.max(net.now + this.relay.hop(), this.lastUp);
    this.lastUp = at;
    net.schedule(at - net.now, fn);
  }

  // ---- connection ------------------------------------------------------------------------------------------------------------

  connect(): Promise<Of<'hello'>> {
    if (this.opened && this.slot >= 0) {
      const m: Of<'hello'> = {
        t: 'hello',
        proto: 1,
        room: this.room,
        slot: this.slot as Slot,
        host: this.host as Slot,
        epoch: this.epoch,
        phase: this.phase,
        serverTime: this.relay.net.now,
        players: this.players,
        limits: this.limits,
      };
      queueMicrotask(() => {
        if (!this.opened) return;
        this.emit('state', 'open');
        this.emit('hello', m);
      });
      return Promise.resolve(m);
    }
    const d = deferred<Of<'hello'>>();
    this.setState(this.reconnecting ? 'reconnecting' : 'connecting');
    this.up(() => {
      const r = this.relay.accept(this);
      if (!r.ok) {
        this.setState('closed');
        d.reject(new Error(r.code));
        return;
      }
      this.opened = true;
      this.setState('open');
      const e = r.entry;
      this.relay.sendTo(e, {
        t: 'hello',
        proto: 1,
        room: this.relay.code,
        slot: e.slot,
        host: this.relay.host,
        epoch: this.relay.epoch,
        phase: this.relay.phase,
        serverTime: this.relay.net.now,
        players: this.relay.lobbyPlayers(),
        limits: this.limits,
      });
      this.relay.broadcastRoomState({ kind: r.rejoin ? 'rejoin' : 'join', slot: e.slot });
      this.helloWaiters.push(d.resolve);
    });
    return d.promise;
  }

  private helloWaiters: ((h: Of<'hello'>) => void)[] = [];

  receive(m: ServerMessage): void {
    switch (m.t) {
      case 'hello':
        this.room = m.room;
        this.slot = m.slot;
        this.host = m.host;
        this.epoch = m.epoch;
        this.phase = m.phase;
        this.players = m.players;
        this.latencyMs = 2 * (this.relay.opts.latencyMs ?? 20) + (this.relay.opts.jitterMs ?? 0);
        for (const r of this.helloWaiters.splice(0)) r(m);
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
      case 'pong':
        return;
    }
  }

  receiveFrame(frame: ArrayBuffer): void {
    const header = readSnapshotHeader(frame);
    if (!header) return;
    if (this.epoch > 0 && ((header.epoch - (this.epoch & 0xffff)) & 0xffff) > 0x8000) return;
    this.emit('snapshot', { header, frame, payload: snapshotPayload(frame) });
  }

  /** the relay closed our socket (replaced by a newer connection) */
  serverClose(code: number, willReconnect: boolean): void {
    this.opened = false;
    this.emit('close', { code, reason: '', willReconnect });
    this.setState(willReconnect ? 'reconnecting' : 'closed');
  }

  // ---- test controls -----------------------------------------------------------------------------------------------------------

  /** simulates a lost connection: the relay sees the socket go away, the client starts "reconnecting" */
  drop(): void {
    if (!this.opened) return;
    this.opened = false;
    this.reconnecting = true;
    this.emit('close', { code: 1006, reason: '', willReconnect: true });
    this.setState('reconnecting');
    this.up(() => {
      const e = this.relay.entryOf(this);
      if (e) this.relay.gone(e, 'disconnect');
    });
  }

  /** the reconnect attempt succeeds (relay re-accepts the player id) */
  async reconnect(): Promise<void> {
    await this.connect();
    this.reconnecting = false;
  }

  // ---- sending -------------------------------------------------------------------------------------------------------------------

  private allow(cls: keyof MemoryTransport['buckets']): boolean {
    const now = this.relay.net.now;
    return this.buckets.any.take(now) && this.buckets[cls].take(now);
  }

  private control(msg: ClientMessage, cls: 'input' | 'event' | 'control', after: (e: Entry) => void): boolean {
    if (!this.opened) return false;
    const text = JSON.stringify(msg);
    if (text.length > clientMessageLimit(msg.t)) return false;
    this.up(() => {
      const e = this.relay.entryOf(this);
      if (!e) return;
      this.relay.traffic.up[e.slot] = (this.relay.traffic.up[e.slot] as number) + text.length;
      if (!this.allow(cls)) {
        this.relay.violation(`rate_limited ${msg.t} from slot ${e.slot}`);
        return;
      }
      after(e);
    });
    return true;
  }

  join(loadout: Loadout, ready?: boolean): boolean {
    return this.control(ready === undefined ? { t: 'join', loadout } : { t: 'join', loadout, ready }, 'control', (e) => {
      if (this.relay.phase !== 'lobby') return;
      e.loadout = loadout;
      if (ready !== undefined) e.ready = ready;
      this.relay.broadcastRoomState({ kind: 'loadout', slot: e.slot });
    });
  }

  start(zone: ZoneId, difficulty: Difficulty, seed: number): boolean {
    return this.control({ t: 'start', zone, difficulty, seed }, 'control', (e) => {
      const r = this.relay;
      if (e.slot !== r.host || r.phase !== 'lobby') return;
      const here = r.roster.filter((x) => x.client?.isOpen);
      if (here.some((x) => x.loadout === null || (x.slot !== r.host && !x.ready))) {
        r.sendTo(e, { t: 'error', code: 'not_ready', message: 'Every player needs a loadout and must be ready' });
        return;
      }
      r.phase = 'running';
      for (const x of here) x.ready = false;
      r.broadcast({ t: 'start', zone, difficulty, seed, startAt: r.net.now + 3000, slots: here.map((x) => x.slot).sort((a, b) => a - b) });
      r.broadcastRoomState({ kind: 'start', slot: e.slot });
    });
  }

  end(victory?: boolean): boolean {
    return this.control(victory === undefined ? { t: 'end' } : { t: 'end', victory }, 'control', (e) => {
      const r = this.relay;
      if (e.slot !== r.host || r.phase !== 'running') return;
      r.phase = 'lobby';
      for (const x of r.roster) x.ready = false;
      r.broadcast(victory === undefined ? { t: 'end' } : { t: 'end', victory });
      r.broadcastRoomState({ kind: 'end', slot: e.slot });
    });
  }

  leave(): void {
    if (!this.opened) return;
    this.control({ t: 'leave' }, 'control', (e) => this.relay.gone(e, 'leave'));
    this.opened = false;
    this.setState('closed');
  }

  close(): void {
    if (!this.opened) {
      this.setState('closed');
      return;
    }
    this.opened = false;
    this.setState('closed');
    this.up(() => {
      const e = this.relay.entryOf(this);
      if (e) this.relay.gone(e, 'disconnect');
    });
  }

  input(fields: InputFields): boolean {
    return this.control({ t: 'input', ...fields }, 'input', (e) => {
      const r = this.relay;
      if (e.slot === r.host || r.phase !== 'running') return;
      r.traffic.inputFrames++;
      const h = r.roster.find((x) => x.slot === r.host);
      if (h) r.sendTo(h, { t: 'input', slot: e.slot, ...fields });
    });
  }

  event(k: string, d?: JsonValue, opts: { tick?: number; to?: Slot } = {}): boolean {
    const msg: ClientMessage = { t: 'event', k };
    if (d !== undefined) msg.d = d;
    if (opts.tick !== undefined) msg.tick = opts.tick;
    if (opts.to !== undefined) msg.to = opts.to;
    return this.control(msg, 'event', (e) => {
      const r = this.relay;
      r.traffic.eventFrames++;
      r.traffic.eventBytes += JSON.stringify(msg).length;
      const out: ServerMessage = { t: 'event', from: e.slot, k };
      if (opts.tick !== undefined) out.tick = opts.tick;
      if (d !== undefined) out.d = d;
      if (e.slot !== r.host) {
        const h = r.roster.find((x) => x.slot === r.host);
        if (h) r.sendTo(h, out);
        return;
      }
      if (opts.to === undefined) r.broadcast(out, e);
      else {
        const t = r.roster.find((x) => x.slot === opts.to);
        if (t && t !== e) r.sendTo(t, out);
        else r.sendTo(e, { t: 'error', code: 'bad_target', message: 'No such player' });
      }
    });
  }

  pick(id: number, index: number): boolean {
    return this.control({ t: 'pick', id, index }, 'control', (e) => {
      const r = this.relay;
      if (e.slot === r.host || r.phase !== 'running') return;
      const h = r.roster.find((x) => x.slot === r.host);
      if (h) r.sendTo(h, { t: 'pick', slot: e.slot, id, index });
    });
  }

  pause(reason?: string): boolean {
    return this.control(reason === undefined ? { t: 'pause' } : { t: 'pause', reason }, 'control', (e) => {
      const r = this.relay;
      if (e.slot === r.host) r.broadcast(reason === undefined ? { t: 'pause', from: e.slot } : { t: 'pause', from: e.slot, reason }, e);
    });
  }

  resume(): boolean {
    return this.control({ t: 'resume' }, 'control', (e) => {
      const r = this.relay;
      if (e.slot === r.host) r.broadcast({ t: 'resume', from: e.slot }, e);
    });
  }

  sendSnapshot(header: Omit<SnapshotHeader, 'epoch'>, payload: Uint8Array): boolean {
    if (!this.opened || !this.isHost) return false;
    const frame = encodeSnapshot({ ...header, epoch: this.epoch }, payload);
    if (frame.byteLength > this.limits.snapshotBytes) return false;
    this.up(() => {
      const r = this.relay;
      const e = r.entryOf(this);
      if (!e || e.slot !== r.host) {
        r.violation('snapshot from a non-host');
        return;
      }
      r.traffic.up[e.slot] = (r.traffic.up[e.slot] as number) + frame.byteLength;
      if (!this.allow('snapshot')) {
        r.violation('snapshot rate exceeded');
        return;
      }
      if (r.phase !== 'running') return;
      r.traffic.snapshotFrames++;
      r.traffic.snapshotBytes += frame.byteLength;
      for (const x of r.roster) if (x !== e && x.client?.isOpen) r.sendFrameTo(x, frame);
    });
    return true;
  }
}
