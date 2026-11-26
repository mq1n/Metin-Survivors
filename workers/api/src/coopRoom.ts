import { DurableObject } from 'cloudflare:workers';
import {
  COOP_CLOSE,
  COOP_LIMITS,
  COOP_MAX_PLAYERS,
  COOP_PROTOCOL,
  PING_FRAME,
  PONG_FRAME,
  SLOTS,
  parseClientMessage,
  readSnapshotHeader,
  type ClientMessage,
  type CoopErrorCode,
  type Loadout,
  type LobbyPlayer,
  type RoomCause,
  type RoomPhase,
  type ServerMessage,
  type Slot,
} from '@ms/shared';
import type { ApiEnv } from './env';
import { errorBody } from './http';

/** One Durable Object per co-op room: a hibernating WebSocket relay with host-authoritative semantics (see @ms/shared/coop). */

const CREATE_TTL_MS = 2 * 60_000; // creator must connect within this long
const LOBBY_IDLE_MS = 10 * 60_000;
const RUNNING_IDLE_MS = 5 * 60_000;
const GRACE_MS = 60_000; // a disconnected player keeps their slot this long during a run
const MAX_LIFETIME_MS = 3 * 60 * 60_000;
const ALARM_MIN_MS = 10_000;
const ALARM_MAX_MS = 5 * 60_000;
const START_DELAY_MS = 3_000;
const ACTIVITY_PERSIST_MS = 120_000;
const OPEN = 1;

interface RosterEntry {
  slot: Slot;
  playerId: string;
  name: string;
  ready: boolean;
  loadout: Loadout | null;
  /** disconnected (or never connected) players hold their slot until this time; null while connected */
  graceUntil: number | null;
  /** has connected at least once (distinguishes join from rejoin) */
  seen: boolean;
}

interface RoomState {
  code: string;
  createdAt: number;
  everConnected: boolean;
  phase: RoomPhase;
  host: Slot;
  epoch: number;
  roster: RosterEntry[];
  lastActivity: number;
}

interface Attachment {
  slot: Slot;
  playerId: string;
}

// ---------------------------------------------------------------------------
// Per-socket abuse control (in-memory; a hibernation wake simply starts with fresh buckets)

class Bucket {
  private tokens: number;
  private last = 0;
  constructor(
    private readonly perSec: number,
    private readonly burst: number,
  ) {
    this.tokens = burst;
  }
  take(now: number): boolean {
    if (this.last === 0) this.last = now;
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.perSec);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

type LimitClass = 'any' | 'input' | 'snapshot' | 'event' | 'control' | 'ping';

const CLASS_OF: Record<ClientMessage['t'], Exclude<LimitClass, 'any' | 'snapshot'>> = {
  input: 'input',
  event: 'event',
  ping: 'ping',
  join: 'control',
  leave: 'control',
  start: 'control',
  end: 'control',
  pick: 'control',
  pause: 'control',
  resume: 'control',
};

class SocketLimits {
  private readonly buckets: Record<LimitClass, Bucket> = {
    any: new Bucket(150, 300),
    input: new Bucket(30, 60),
    snapshot: new Bucket(30, 45),
    event: new Bucket(20, 40),
    control: new Bucket(8, 16),
    ping: new Bucket(4, 8),
  };
  private strikes = 0;
  private strikeWindow = 0;
  private lastErrorAt = 0;

  allow(cls: LimitClass, now: number): boolean {
    return this.buckets.any.take(now) && this.buckets[cls].take(now);
  }
  /** Returns true when the socket has misbehaved enough to be dropped. */
  strike(now: number, weight = 1): boolean {
    if (now - this.strikeWindow > 10_000) {
      this.strikeWindow = now;
      this.strikes = 0;
    }
    this.strikes += weight;
    return this.strikes > 150;
  }
  errorDue(now: number): boolean {
    if (now - this.lastErrorAt < 1000) return false;
    this.lastErrorAt = now;
    return true;
  }
}

// ---------------------------------------------------------------------------

export class CoopRoom extends DurableObject<ApiEnv> {
  private room: RoomState | null = null;
  private persistedActivity = 0;
  private readonly limits = new WeakMap<WebSocket, SocketLimits>();

  constructor(ctx: DurableObjectState, env: ApiEnv) {
    super(ctx, env);
    // Keepalive pings are answered by the runtime without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING_FRAME, PONG_FRAME));
    void ctx.blockConcurrencyWhile(async () => {
      this.room = (await ctx.storage.get<RoomState>('room')) ?? null;
      this.persistedActivity = this.room?.lastActivity ?? 0;
    });
  }

  // -------------------------------------------------------------------------
  // HTTP entry (only reachable through the Worker, which authenticates and stamps x-ms-* headers)

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/create' && request.method === 'POST') return this.create(request);
    if (url.pathname === '/ws' && request.method === 'GET') return this.acceptSocket(request);
    return jsonError(404, 'room_not_found', 'Not found');
  }

  private async create(request: Request): Promise<Response> {
    if (this.room) return jsonError(409, 'room_in_progress', 'Room code already in use');
    const playerId = request.headers.get('x-ms-player');
    const code = request.headers.get('x-ms-room');
    if (!playerId || !code) return jsonError(400, 'room_not_found', 'Missing room identity');
    const now = Date.now();
    this.room = {
      code,
      createdAt: now,
      everConnected: false,
      phase: 'lobby',
      host: 0,
      epoch: 1,
      roster: [{ slot: 0, playerId, name: readName(request), ready: false, loadout: null, graceUntil: now + CREATE_TTL_MS, seen: false }],
      lastActivity: now,
    };
    this.persistedActivity = now;
    await this.persist();
    await this.ensureAlarm();
    return Response.json({ room: code }, { status: 201 });
  }

  private async acceptSocket(request: Request): Promise<Response> {
    const room = this.room;
    if (!room) return jsonError(404, 'room_not_found', 'Room not found');
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return jsonError(426, 'upgrade_required', 'Expected a WebSocket upgrade');
    const playerId = request.headers.get('x-ms-player');
    if (!playerId) return jsonError(401, 'unauthorized', 'Unauthenticated');
    const name = readName(request);
    const now = Date.now();

    let entry = room.roster.find((e) => e.playerId === playerId);
    let cause: RoomCause;
    if (entry) {
      entry.name = name;
      cause = { kind: entry.seen ? 'rejoin' : 'join', slot: entry.slot };
    } else {
      if (room.phase === 'running') return jsonError(409, 'room_in_progress', 'The run has already started');
      const slot = SLOTS.find((s) => !room.roster.some((e) => e.slot === s));
      if (slot === undefined || room.roster.length >= COOP_MAX_PLAYERS) return jsonError(409, 'room_full', 'Room is full');
      entry = { slot, playerId, name, ready: false, loadout: null, graceUntil: null, seen: false };
      room.roster.push(entry);
      cause = { kind: 'join', slot };
    }
    entry.graceUntil = null;
    entry.seen = true;
    room.everConnected = true;

    // A second connection by the same player replaces the first (e.g. a refreshed tab).
    for (const old of this.ctx.getWebSockets(`p:${playerId}`)) {
      this.sendError(old, 'replaced', 'Connected from another tab or device');
      old.close(COOP_CLOSE.replaced, 'replaced');
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server, [`p:${playerId}`, `s:${entry.slot}`]);
    const attachment: Attachment = { slot: entry.slot, playerId };
    server.serializeAttachment(attachment);

    this.touch(now);
    await this.persist();
    await this.ensureAlarm();

    this.send(server, {
      t: 'hello',
      proto: COOP_PROTOCOL,
      room: room.code,
      slot: entry.slot,
      host: room.host,
      epoch: room.epoch,
      phase: room.phase,
      serverTime: now,
      players: this.lobbyPlayers(),
      limits: {
        maxPlayers: COOP_MAX_PLAYERS,
        inputBytes: COOP_LIMITS.inputBytes,
        eventBytes: COOP_LIMITS.eventBytes,
        snapshotBytes: COOP_LIMITS.snapshotBytes,
      },
    });
    this.broadcastRoomState(cause);

    const headers = new Headers();
    const proto = request.headers.get('x-ms-subprotocol');
    if (proto) headers.set('Sec-WebSocket-Protocol', proto);
    return new Response(null, { status: 101, webSocket: client, headers });
  }

  // -------------------------------------------------------------------------
  // WebSocket handlers (hibernation API)

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const room = this.room;
    if (!room) {
      ws.close(COOP_CLOSE.roomClosed, 'room_closed');
      return;
    }
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att || !this.isConnected(att.playerId)) {
      ws.close(COOP_CLOSE.policy, 'unauthorized');
      return;
    }
    const now = Date.now();
    const limits = this.limitsFor(ws);

    if (typeof message !== 'string') {
      await this.onBinary(ws, att, message, limits, now);
      return;
    }

    const parsed = parseClientMessage(message);
    if (!parsed.ok) {
      const tooLarge = parsed.reason === 'too large';
      await this.misbehave(ws, limits, now, tooLarge ? 'too_large' : 'bad_message', `${parsed.field}: ${parsed.reason}`, tooLarge ? 20 : 1);
      return;
    }
    const msg = parsed.value;
    if (!limits.allow(CLASS_OF[msg.t], now)) {
      await this.misbehave(ws, limits, now, 'rate_limited', 'Too many messages', 1);
      return;
    }
    if (msg.t !== 'ping') this.touch(now);

    switch (msg.t) {
      case 'ping':
        this.send(ws, msg.ts === undefined ? { t: 'pong', st: now } : { t: 'pong', ts: msg.ts, st: now });
        return;
      case 'join':
        await this.onJoin(ws, att, room, msg);
        return;
      case 'leave':
        await this.onLeave(ws, att, room);
        return;
      case 'start':
        await this.onStart(ws, att, room, msg, now);
        return;
      case 'end':
        await this.onEnd(ws, att, room, msg);
        return;
      case 'input':
        if (att.slot === room.host) return this.sendError(ws, 'bad_message', 'The host does not send input');
        if (room.phase !== 'running') return;
        this.sendToSlot(room.host, { t: 'input', slot: att.slot, seq: msg.seq, tick: msg.tick, mx: msg.mx, mz: msg.mz, ...optionalInput(msg) });
        return;
      case 'event':
        this.onEvent(ws, att, room, msg);
        return;
      case 'pick':
        if (att.slot === room.host) return this.sendError(ws, 'bad_message', 'The host picks locally');
        if (room.phase !== 'running') return this.sendError(ws, 'wrong_phase', 'No run in progress');
        this.sendToSlot(room.host, { t: 'pick', slot: att.slot, id: msg.id, index: msg.index });
        return;
      case 'pause':
      case 'resume': {
        if (room.phase !== 'running') return this.sendError(ws, 'wrong_phase', 'No run in progress');
        const out: ServerMessage =
          msg.t === 'pause'
            ? msg.reason === undefined
              ? { t: 'pause', from: att.slot }
              : { t: 'pause', from: att.slot, reason: msg.reason }
            : { t: 'resume', from: att.slot };
        if (att.slot === room.host) this.broadcast(out, ws);
        else this.sendToSlot(room.host, out);
        return;
      }
    }
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean): Promise<void> {
    try {
      await this.onSocketGone(ws);
    } finally {
      this.finishClose(ws, code, reason);
    }
  }

  override async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    try {
      await this.onSocketGone(ws);
    } finally {
      this.finishClose(ws, COOP_CLOSE.normal, 'error');
    }
  }

  /** Complete the RFC 6455 close handshake so clients do not stall in CLOSING waiting for a server reply frame. */
  private finishClose(ws: WebSocket, code: number, reason: string): void {
    const safeCode = code === COOP_CLOSE.normal || (code >= 3000 && code <= 4999) ? code : COOP_CLOSE.normal;
    const safeReason = new TextEncoder().encode(reason).byteLength <= 123 ? reason : '';
    try {
      ws.close(safeCode, safeReason);
    } catch {
      try {
        ws.close();
      } catch {
        // socket already closed
      }
    }
  }

  override async alarm(): Promise<void> {
    const room = this.room;
    if (!room) return;
    const now = Date.now();

    const changed: RoomCause[] = [];
    for (const entry of [...room.roster]) {
      if (entry.graceUntil !== null && now >= entry.graceUntil && !this.isConnected(entry.playerId)) {
        room.roster = room.roster.filter((e) => e !== entry);
        changed.push({ kind: 'leave', slot: entry.slot });
      }
    }
    const idleLimit = room.phase === 'running' ? RUNNING_IDLE_MS : LOBBY_IDLE_MS;
    const connected = room.roster.some((e) => this.isConnected(e.playerId));
    if (now - room.lastActivity > idleLimit) return this.destroy(COOP_CLOSE.idle, 'idle_timeout');
    if (now - room.createdAt > MAX_LIFETIME_MS) return this.destroy(COOP_CLOSE.roomClosed, 'room_closed');
    if (!room.everConnected && now - room.createdAt > CREATE_TTL_MS) return this.destroy(COOP_CLOSE.roomClosed, 'room_closed');
    if (room.roster.length === 0 || (!connected && room.everConnected && room.roster.every((e) => e.graceUntil !== null && now >= e.graceUntil))) {
      return this.destroy(COOP_CLOSE.roomClosed, 'room_closed');
    }

    const hostGone = !room.roster.some((e) => e.slot === room.host);
    const cause = hostGone ? this.migrateHost(undefined) : null;
    if (changed.length > 0 || cause !== null) await this.persist();
    await this.ctx.storage.setAlarm(this.nextAlarmAt(room, now));
    if (cause) this.broadcastRoomState(cause);
    else if (changed.length > 0) this.broadcastRoomState(changed[0] as RoomCause);
  }

  // -------------------------------------------------------------------------
  // Message handlers

  private async onBinary(ws: WebSocket, att: Attachment, frame: ArrayBuffer, limits: SocketLimits, now: number): Promise<void> {
    const room = this.room as RoomState;
    if (frame.byteLength > COOP_LIMITS.snapshotBytes) {
      await this.misbehave(ws, limits, now, 'too_large', 'Snapshot too large', 20);
      return;
    }
    if (att.slot !== room.host) {
      await this.misbehave(ws, limits, now, 'not_host', 'Only the host sends snapshots', 1);
      return;
    }
    if (!limits.allow('snapshot', now)) {
      await this.misbehave(ws, limits, now, 'rate_limited', 'Snapshot rate exceeded', 1);
      return;
    }
    if (!readSnapshotHeader(frame)) {
      await this.misbehave(ws, limits, now, 'bad_message', 'Malformed snapshot header', 1);
      return;
    }
    if (room.phase !== 'running') return;
    this.touch(now);
    this.broadcastRaw(frame, ws);
  }

  private async onJoin(ws: WebSocket, att: Attachment, room: RoomState, msg: Extract<ClientMessage, { t: 'join' }>): Promise<void> {
    if (room.phase !== 'lobby') return this.sendError(ws, 'wrong_phase', 'The run has already started');
    const entry = room.roster.find((e) => e.slot === att.slot);
    if (!entry) return;
    const loadoutChanged = JSON.stringify(entry.loadout) !== JSON.stringify(msg.loadout);
    entry.loadout = msg.loadout;
    const readyChanged = msg.ready !== undefined && msg.ready !== entry.ready;
    if (msg.ready !== undefined) entry.ready = msg.ready;
    if (!loadoutChanged && !readyChanged) return;
    await this.persist();
    this.broadcastRoomState({ kind: loadoutChanged ? 'loadout' : 'ready', slot: att.slot });
  }

  private async onLeave(ws: WebSocket, att: Attachment, room: RoomState): Promise<void> {
    const entry = room.roster.find((e) => e.slot === att.slot);
    ws.close(COOP_CLOSE.normal, 'leave');
    if (!entry) return;
    room.roster = room.roster.filter((e) => e !== entry);
    await this.afterDeparture(room, entry, ws, 'leave');
  }

  private async onStart(
    ws: WebSocket,
    att: Attachment,
    room: RoomState,
    msg: Extract<ClientMessage, { t: 'start' }>,
    now: number,
  ): Promise<void> {
    if (att.slot !== room.host) return this.sendError(ws, 'not_host', 'Only the host can start');
    if (room.phase !== 'lobby') return this.sendError(ws, 'wrong_phase', 'The run has already started');
    const here = room.roster.filter((e) => this.isConnected(e.playerId));
    const hostEntry = here.find((e) => e.slot === room.host);
    if (!hostEntry?.loadout || here.some((e) => e.loadout === null || (e.slot !== room.host && !e.ready))) {
      return this.sendError(ws, 'not_ready', 'Every player needs a loadout and must be ready');
    }
    room.roster = here;
    room.phase = 'running';
    for (const e of room.roster) e.ready = false;
    await this.persist();
    this.broadcast({
      t: 'start',
      zone: msg.zone,
      difficulty: msg.difficulty,
      seed: msg.seed,
      startAt: now + START_DELAY_MS,
      slots: room.roster.map((e) => e.slot).sort((a, b) => a - b),
    });
    this.broadcastRoomState({ kind: 'start', slot: att.slot });
  }

  private async onEnd(ws: WebSocket, att: Attachment, room: RoomState, msg: Extract<ClientMessage, { t: 'end' }>): Promise<void> {
    if (att.slot !== room.host) return this.sendError(ws, 'not_host', 'Only the host can end the run');
    if (room.phase !== 'running') return this.sendError(ws, 'wrong_phase', 'No run in progress');
    room.phase = 'lobby';
    room.roster = room.roster.filter((e) => this.isConnected(e.playerId));
    for (const e of room.roster) {
      e.ready = false;
      e.graceUntil = null;
    }
    await this.persist();
    this.broadcast(msg.victory === undefined ? { t: 'end' } : { t: 'end', victory: msg.victory });
    this.broadcastRoomState({ kind: 'end', slot: att.slot });
  }

  private onEvent(ws: WebSocket, att: Attachment, room: RoomState, msg: Extract<ClientMessage, { t: 'event' }>): void {
    const out: ServerMessage = { t: 'event', from: att.slot, k: msg.k };
    if (msg.tick !== undefined) out.tick = msg.tick;
    if (msg.d !== undefined) out.d = msg.d;
    if (att.slot !== room.host) {
      this.sendToSlot(room.host, out);
      return;
    }
    if (msg.to === undefined) {
      this.broadcast(out, ws);
      return;
    }
    if (msg.to === att.slot || !room.roster.some((e) => e.slot === msg.to)) return this.sendError(ws, 'bad_target', 'No such player');
    this.sendToSlot(msg.to, out);
  }

  // -------------------------------------------------------------------------
  // Membership

  private async onSocketGone(ws: WebSocket): Promise<void> {
    const room = this.room;
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!room || !att) return;
    if (this.isConnected(att.playerId, ws)) return; // replaced by a newer connection
    const entry = room.roster.find((e) => e.playerId === att.playerId);
    if (!entry) return;
    if (room.phase === 'lobby') {
      room.roster = room.roster.filter((e) => e !== entry);
      await this.afterDeparture(room, entry, ws, 'leave');
      return;
    }
    if (entry.graceUntil !== null) return; // already accounted for (e.g. dropped for abuse, then closed)
    entry.graceUntil = Date.now() + GRACE_MS;
    await this.afterDeparture(room, entry, ws, 'disconnect');
  }

  private async afterDeparture(room: RoomState, entry: RosterEntry, closing: WebSocket, kind: 'leave' | 'disconnect'): Promise<void> {
    let cause: RoomCause = { kind, slot: entry.slot };
    if (room.host === entry.slot) {
      const migrated = this.migrateHost(closing);
      if (migrated) cause = migrated;
    }
    const now = Date.now();
    const anyone = room.roster.some(
      (e) => e.playerId !== entry.playerId && (this.isConnected(e.playerId, closing) || (!e.seen && e.graceUntil !== null && e.graceUntil > now)),
    );
    if (!anyone && room.phase === 'lobby') {
      await this.destroy(COOP_CLOSE.roomClosed, 'room_closed');
      return;
    }
    await this.persist();
    await this.ensureAlarm();
    this.broadcastRoomState(cause, closing);
  }

  /** Host seat → lowest connected slot. Returns the cause when the host changed. */
  private migrateHost(exclude: WebSocket | undefined): RoomCause | null {
    const room = this.room as RoomState;
    const next = room.roster
      .filter((e) => this.isConnected(e.playerId, exclude))
      .sort((a, b) => a.slot - b.slot)[0];
    if (!next || next.slot === room.host) return null;
    const from = room.host;
    room.host = next.slot;
    room.epoch += 1;
    return { kind: 'hostChanged', slot: next.slot, from };
  }

  private async destroy(code: number, reason: string): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(code, reason);
      } catch {
        // already closing
      }
    }
    this.room = null;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  // -------------------------------------------------------------------------
  // Helpers

  private isConnected(playerId: string, exclude?: WebSocket): boolean {
    return this.ctx.getWebSockets(`p:${playerId}`).some((w) => w !== exclude && w.readyState === OPEN);
  }

  private lobbyPlayers(exclude?: WebSocket): LobbyPlayer[] {
    const room = this.room as RoomState;
    return [...room.roster]
      .sort((a, b) => a.slot - b.slot)
      .map((e) => ({
        slot: e.slot,
        name: e.name,
        connected: this.isConnected(e.playerId, exclude),
        ready: e.ready,
        loadout: e.loadout,
      }));
  }

  private broadcastRoomState(cause: RoomCause, exclude?: WebSocket): void {
    const room = this.room as RoomState;
    const players = this.lobbyPlayers(exclude);
    this.broadcast({ t: 'roomState', room: room.code, phase: room.phase, host: room.host, epoch: room.epoch, players, cause }, exclude);
  }

  private limitsFor(ws: WebSocket): SocketLimits {
    let l = this.limits.get(ws);
    if (!l) {
      l = new SocketLimits();
      this.limits.set(ws, l);
    }
    return l;
  }

  private async misbehave(ws: WebSocket, limits: SocketLimits, now: number, code: CoopErrorCode, message: string, weight: number): Promise<void> {
    if (limits.errorDue(now)) this.sendError(ws, code, message);
    if (limits.strike(now, weight)) {
      ws.close(COOP_CLOSE.rateAbuse, 'rate_abuse');
      await this.onSocketGone(ws);
    }
  }

  private touch(now: number): void {
    const room = this.room;
    if (!room) return;
    room.lastActivity = now;
    if (now - this.persistedActivity > ACTIVITY_PERSIST_MS) {
      this.persistedActivity = now;
      void this.persist();
    }
  }

  private async persist(): Promise<void> {
    if (this.room) await this.ctx.storage.put('room', this.room);
  }

  private nextAlarmAt(room: RoomState, now: number): number {
    const idleLimit = room.phase === 'running' ? RUNNING_IDLE_MS : LOBBY_IDLE_MS;
    let deadline = Math.min(room.lastActivity + idleLimit, room.createdAt + MAX_LIFETIME_MS);
    if (!room.everConnected) deadline = Math.min(deadline, room.createdAt + CREATE_TTL_MS);
    for (const e of room.roster) {
      if (e.graceUntil !== null && e.graceUntil < deadline) deadline = e.graceUntil;
    }
    const wait = Math.max(ALARM_MIN_MS, Math.min(ALARM_MAX_MS, deadline - now + 1_000));
    return now + wait;
  }

  private async ensureAlarm(): Promise<void> {
    if (!this.room) return;
    const now = Date.now();
    const want = this.nextAlarmAt(this.room, now);
    const existing = await this.ctx.storage.getAlarm();
    if (existing === null || existing > want + 5_000) await this.ctx.storage.setAlarm(want);
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    this.sendRaw(ws, JSON.stringify(msg));
  }

  private sendRaw(ws: WebSocket, data: string | ArrayBuffer): void {
    if (ws.readyState !== OPEN) return;
    try {
      ws.send(data);
    } catch {
      // peer went away mid-send; the close handler cleans up
    }
  }

  private sendError(ws: WebSocket, code: CoopErrorCode, message: string): void {
    this.send(ws, { t: 'error', code, message });
  }

  private sendToSlot(slot: Slot, msg: ServerMessage): void {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets(`s:${slot}`)) this.sendRaw(ws, data);
  }

  private broadcast(msg: ServerMessage, exclude?: WebSocket): void {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) if (ws !== exclude) this.sendRaw(ws, data);
  }

  private broadcastRaw(frame: ArrayBuffer, exclude: WebSocket): void {
    for (const ws of this.ctx.getWebSockets()) if (ws !== exclude) this.sendRaw(ws, frame);
  }
}

function readName(request: Request): string {
  const raw = request.headers.get('x-ms-name') ?? '';
  try {
    return decodeURIComponent(raw).slice(0, 16) || 'Player';
  } catch {
    return 'Player';
  }
}

function optionalInput(msg: Extract<ClientMessage, { t: 'input' }>): { aim?: number; btn?: number } {
  const out: { aim?: number; btn?: number } = {};
  if (msg.aim !== undefined) out.aim = msg.aim;
  if (msg.btn !== undefined) out.btn = msg.btn;
  return out;
}

function jsonError(status: number, code: Parameters<typeof errorBody>[0], message: string): Response {
  return Response.json(errorBody(code, message), { status });
}
