// @ms/shared/coop — co-op wire protocol (ARCHITECTURE §10, PLAN §3.10).
//
// Topology: host-authoritative star relayed by one Durable Object per room (`CoopRoom`, WebSocket hibernation).
//   * The host (room creator; migrates to the lowest connected slot when the host leaves) simulates the world.
//   * Guests send `input` (≈20 Hz) and `pick` (card choice) → relayed to the host only, stamped with the sender slot.
//   * The host sends binary `snapshot` frames (≈15 Hz, quantised) → relayed to every guest verbatim.
//   * `event`s are reliable and small; host→guests broadcast (or `to` one slot), guest→host only.
//   * `pause`/`resume`: host → everyone; guest → host only (request).
// Control traffic is JSON text frames `{ "t": "<type>", ... }`; the only binary frame is the snapshot.
//
// Connect: `GET /api/v1/coop/:room` with `Upgrade: websocket`, subprotocols `ms.coop.v1` and `auth.<playerId>.<secret>`
// (browsers cannot set Authorization on WebSocket). The server echoes only `ms.coop.v1`.
//
// Binary snapshot frame (little-endian, 16-byte header + opaque payload; payload layout is owned by the co-op sim
// sync code, the relay never inspects it):
//
//   off size  field
//    0  u8    kind      = 0x01 (SNAPSHOT)
//    1  u8    version   = 1
//    2  u16   flags     bit0 keyframe | bit1 delta | bit2 paused | bit3 final
//    4  u32   seq       host-side snapshot counter, wraps at 2^32
//    8  u32   tick      host sim tick (60 Hz) the snapshot represents
//   12  u16   epoch     host epoch; receivers drop frames whose epoch is lower than `roomState.epoch`
//   14  u16   baseDelta delta snapshots: (seq - baseSeq) of the keyframe/previous snapshot it is relative to; 0 for keyframes
//   16  ...   payload   quantised entity sections (see quantize()/dequantize() for the shared fixed-point codec)

import {
  CLASS_IDS,
  DIFFICULTIES,
  DOCTRINE_KEYS,
  EMPIRE_IDS,
  SEXES,
  ZONE_IDS,
  isOneOf,
  isRecord,
  type ClassId,
  type Difficulty,
  type DoctrineKey,
  type EmpireId,
  type Sex,
  type Validation,
  type ZoneId,
} from './api';

export const COOP_PROTOCOL = 1;
export const COOP_SUBPROTOCOL = 'ms.coop.v1';
export const COOP_AUTH_PROTOCOL_PREFIX = 'auth.';
export const COOP_MAX_PLAYERS = 4;

/** Exact text frames answered by the runtime without waking the Durable Object (hibernation-friendly keepalive). */
export const PING_FRAME = '{"t":"ping"}';
export const PONG_FRAME = '{"t":"pong"}';

/** Nominal cadences the sync layer should aim for. */
export const COOP_RATES = { inputHz: 20, snapshotHz: 15, pickTimeoutSec: 20, pingIntervalSec: 5 } as const;

/** Relay hard limits (enforced server-side, also announced in `hello`). Text sizes are UTF-16 code units. */
export const COOP_LIMITS = {
  inputBytes: 256,
  controlBytes: 2048,
  eventBytes: 4096,
  snapshotBytes: 48 * 1024,
} as const;

/** WebSocket close codes used by the relay. */
export const COOP_CLOSE = {
  normal: 1000,
  policy: 1008,
  replaced: 4001,
  idle: 4002,
  roomClosed: 4003,
  rateAbuse: 4008,
} as const;

export type CoopErrorCode =
  | 'bad_message'
  | 'too_large'
  | 'rate_limited'
  | 'not_host'
  | 'room_full'
  | 'room_not_found'
  | 'room_in_progress'
  | 'wrong_phase'
  | 'not_ready'
  | 'unauthorized'
  | 'idle_timeout'
  | 'room_closed'
  | 'replaced'
  | 'bad_target';

export type Slot = 0 | 1 | 2 | 3;
export const SLOTS: readonly Slot[] = [0, 1, 2, 3];
export type RoomPhase = 'lobby' | 'running';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

/** What other players need to render and understand a teammate. */
export interface Loadout {
  classId: ClassId;
  doctrine: DoctrineKey;
  sex: Sex;
  empire: EmpireId;
  /** armor / weapon tier 0..3 (hero model + weapon swap) */
  tier: number;
  /** appearance parameters, ≤ 8 values 0..255 */
  look?: number[];
}

export interface LobbyPlayer {
  slot: Slot;
  name: string;
  connected: boolean;
  ready: boolean;
  loadout: Loadout | null;
}

export type RoomCause =
  | { kind: 'join' | 'leave' | 'rejoin' | 'disconnect' | 'ready' | 'loadout' | 'start' | 'end'; slot?: Slot }
  | { kind: 'hostChanged'; slot: Slot; from: Slot };

// ---------------------------------------------------------------------------
// Client → server

/** Bit layout for `InputFields.btn` (uint16). */
export const COOP_BTN_CAST_MASK = 0x03ff; // bits 0..9: taskbar skill-slot manual cast mask (slots 0..9)
export const COOP_BTN_ATTACK = 0x0400; // bit 10: manual basic attack (Space / LMB)
export const COOP_BTN_MANUAL = 0x0800; // bit 11: manual-cast mode active (auto-cast off)

export interface InputFields {
  /** uint32 client counter */
  seq: number;
  /** last host tick the client has seen */
  tick: number;
  /** move vector × 127, integers −127..127 */
  mx: number;
  mz: number;
  /** aim angle quantised to 0..255 (rad / 2π × 256) */
  aim?: number;
  /** button bitmask 0..65535 (COOP_BTN_* flags) */
  btn?: number;
}

export type ClientMessage =
  | { t: 'join'; loadout: Loadout; ready?: boolean }
  | { t: 'leave' }
  | { t: 'start'; zone: ZoneId; difficulty: Difficulty; seed: number }
  | { t: 'end'; victory?: boolean }
  | ({ t: 'input' } & InputFields)
  | { t: 'event'; k: string; tick?: number; to?: Slot; d?: JsonValue }
  | { t: 'pick'; id: number; index: number }
  | { t: 'pause'; reason?: string }
  | { t: 'resume' }
  | { t: 'ping'; ts?: number };

// ---------------------------------------------------------------------------
// Server → client

export interface RoomLimitsInfo {
  maxPlayers: number;
  inputBytes: number;
  eventBytes: number;
  snapshotBytes: number;
}

export type ServerMessage =
  | {
      t: 'hello';
      proto: number;
      room: string;
      /** your slot */
      slot: Slot;
      host: Slot;
      epoch: number;
      phase: RoomPhase;
      /** server wall clock (ms) */
      serverTime: number;
      players: LobbyPlayer[];
      limits: RoomLimitsInfo;
    }
  | {
      t: 'roomState';
      room: string;
      phase: RoomPhase;
      host: Slot;
      /** increments every time the host changes; stamped into snapshot headers */
      epoch: number;
      players: LobbyPlayer[];
      cause?: RoomCause;
    }
  | {
      t: 'start';
      zone: ZoneId;
      difficulty: Difficulty;
      seed: number;
      /** server wall clock (ms) at which every client should begin tick 0 */
      startAt: number;
      /** slots participating (connected at start) */
      slots: Slot[];
    }
  | { t: 'end'; victory?: boolean }
  | ({ t: 'input'; slot: Slot } & InputFields)
  | { t: 'event'; from: Slot; k: string; tick?: number; d?: JsonValue }
  | { t: 'pick'; slot: Slot; id: number; index: number }
  | { t: 'pause'; from: Slot; reason?: string }
  | { t: 'resume'; from: Slot }
  | { t: 'pong'; ts?: number; st?: number }
  | { t: 'error'; code: CoopErrorCode; message: string };

// ---------------------------------------------------------------------------
// Guards

function fail(field: string, reason: string): Validation<never> {
  return { ok: false, field, reason };
}

function intIn(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

const EVENT_KIND_RE = /^[a-z][A-Za-z0-9_.]{0,31}$/;

export function parseLoadout(v: unknown): Validation<Loadout> {
  if (!isRecord(v)) return fail('loadout', 'must be an object');
  if (!isOneOf(CLASS_IDS, v.classId)) return fail('loadout.classId', 'invalid');
  if (!isOneOf(DOCTRINE_KEYS, v.doctrine)) return fail('loadout.doctrine', 'invalid');
  if (!isOneOf(SEXES, v.sex)) return fail('loadout.sex', 'invalid');
  if (!isOneOf(EMPIRE_IDS, v.empire)) return fail('loadout.empire', 'invalid');
  if (!intIn(v.tier, 0, 3)) return fail('loadout.tier', 'must be 0..3');
  const out: Loadout = { classId: v.classId, doctrine: v.doctrine, sex: v.sex, empire: v.empire, tier: v.tier };
  if (v.look !== undefined) {
    if (!Array.isArray(v.look) || v.look.length > 8 || !v.look.every((n) => intIn(n, 0, 255))) {
      return fail('loadout.look', 'must be ≤8 integers 0..255');
    }
    out.look = v.look as number[];
  }
  return { ok: true, value: out };
}

function parseInputFields(m: Record<string, unknown>): Validation<InputFields> {
  if (!intIn(m.seq, 0, 0xffffffff)) return fail('seq', 'uint32');
  if (!intIn(m.tick, 0, 0xffffffff)) return fail('tick', 'uint32');
  if (!intIn(m.mx, -127, 127)) return fail('mx', '−127..127');
  if (!intIn(m.mz, -127, 127)) return fail('mz', '−127..127');
  const out: InputFields = { seq: m.seq, tick: m.tick, mx: m.mx, mz: m.mz };
  if (m.aim !== undefined) {
    if (!intIn(m.aim, 0, 255)) return fail('aim', '0..255');
    out.aim = m.aim;
  }
  if (m.btn !== undefined) {
    if (!intIn(m.btn, 0, 0xffff)) return fail('btn', '0..65535');
    out.btn = m.btn;
  }
  return { ok: true, value: out };
}

/** Max accepted text length for each client message type (UTF-16 code units). */
export function clientMessageLimit(type: string): number {
  if (type === 'input') return COOP_LIMITS.inputBytes;
  if (type === 'event') return COOP_LIMITS.eventBytes;
  return COOP_LIMITS.controlBytes;
}

/** Parses one client text frame. Never throws. */
export function parseClientMessage(text: string): Validation<ClientMessage> {
  if (text.length > COOP_LIMITS.eventBytes) return fail('frame', 'too large');
  let m: unknown;
  try {
    m = JSON.parse(text);
  } catch {
    return fail('frame', 'invalid JSON');
  }
  if (!isRecord(m) || typeof m.t !== 'string') return fail('t', 'missing message type');
  if (text.length > clientMessageLimit(m.t)) return fail('frame', 'too large');

  switch (m.t) {
    case 'join': {
      const l = parseLoadout(m.loadout);
      if (!l.ok) return l;
      if (m.ready !== undefined && typeof m.ready !== 'boolean') return fail('ready', 'must be boolean');
      return { ok: true, value: m.ready === undefined ? { t: 'join', loadout: l.value } : { t: 'join', loadout: l.value, ready: m.ready } };
    }
    case 'leave':
      return { ok: true, value: { t: 'leave' } };
    case 'start': {
      if (!isOneOf(ZONE_IDS, m.zone)) return fail('zone', 'invalid');
      if (!isOneOf(DIFFICULTIES, m.difficulty)) return fail('difficulty', 'invalid');
      if (!intIn(m.seed, 0, 0xffffffff)) return fail('seed', 'uint32');
      return { ok: true, value: { t: 'start', zone: m.zone, difficulty: m.difficulty, seed: m.seed } };
    }
    case 'end':
      if (m.victory !== undefined && typeof m.victory !== 'boolean') return fail('victory', 'must be boolean');
      return { ok: true, value: m.victory === undefined ? { t: 'end' } : { t: 'end', victory: m.victory } };
    case 'input': {
      const f = parseInputFields(m);
      return f.ok ? { ok: true, value: { t: 'input', ...f.value } } : f;
    }
    case 'event': {
      if (typeof m.k !== 'string' || !EVENT_KIND_RE.test(m.k)) return fail('k', 'invalid event kind');
      const out: ClientMessage = { t: 'event', k: m.k };
      if (m.tick !== undefined) {
        if (!intIn(m.tick, 0, 0xffffffff)) return fail('tick', 'uint32');
        out.tick = m.tick;
      }
      if (m.to !== undefined) {
        if (!intIn(m.to, 0, COOP_MAX_PLAYERS - 1)) return fail('to', 'invalid slot');
        out.to = m.to as Slot;
      }
      if (m.d !== undefined) out.d = m.d as JsonValue;
      return { ok: true, value: out };
    }
    case 'pick': {
      if (!intIn(m.id, 0, 0xffffffff)) return fail('id', 'uint32');
      if (!intIn(m.index, 0, 15)) return fail('index', '0..15');
      return { ok: true, value: { t: 'pick', id: m.id, index: m.index } };
    }
    case 'pause': {
      if (m.reason !== undefined && (typeof m.reason !== 'string' || m.reason.length > 32)) return fail('reason', '≤32 chars');
      return { ok: true, value: m.reason === undefined ? { t: 'pause' } : { t: 'pause', reason: m.reason } };
    }
    case 'resume':
      return { ok: true, value: { t: 'resume' } };
    case 'ping': {
      if (m.ts !== undefined && (typeof m.ts !== 'number' || !Number.isFinite(m.ts))) return fail('ts', 'must be a number');
      return { ok: true, value: m.ts === undefined ? { t: 'ping' } : { t: 'ping', ts: m.ts } };
    }
    default:
      return fail('t', `unknown message type "${m.t}"`);
  }
}

const SERVER_TYPES = ['hello', 'roomState', 'start', 'end', 'input', 'event', 'pick', 'pause', 'resume', 'pong', 'error'] as const;

/**
 * Parses one server text frame on the client. Checks the discriminant and the fields the transport depends on;
 * message bodies come from our own Worker, so this is a seatbelt, not a full schema.
 */
export function parseServerMessage(text: string): Validation<ServerMessage> {
  let m: unknown;
  try {
    m = JSON.parse(text);
  } catch {
    return fail('frame', 'invalid JSON');
  }
  if (!isRecord(m) || typeof m.t !== 'string' || !isOneOf(SERVER_TYPES, m.t)) return fail('t', 'unknown message type');
  switch (m.t) {
    case 'hello':
      if (!intIn(m.slot, 0, 3) || !intIn(m.host, 0, 3) || typeof m.room !== 'string' || !Array.isArray(m.players)) return fail('hello', 'malformed');
      break;
    case 'roomState':
      if (!intIn(m.host, 0, 3) || typeof m.room !== 'string' || !Array.isArray(m.players)) return fail('roomState', 'malformed');
      break;
    case 'start':
      if (!isOneOf(ZONE_IDS, m.zone) || !isOneOf(DIFFICULTIES, m.difficulty) || typeof m.seed !== 'number' || !Array.isArray(m.slots)) {
        return fail('start', 'malformed');
      }
      break;
    case 'input':
      if (!intIn(m.slot, 0, 3)) return fail('input', 'malformed');
      break;
    case 'event':
      if (!intIn(m.from, 0, 3) || typeof m.k !== 'string') return fail('event', 'malformed');
      break;
    case 'pick':
      if (!intIn(m.slot, 0, 3) || typeof m.id !== 'number' || typeof m.index !== 'number') return fail('pick', 'malformed');
      break;
    case 'pause':
    case 'resume':
      if (!intIn(m.from, 0, 3)) return fail(m.t, 'malformed');
      break;
    case 'error':
      if (typeof m.code !== 'string' || typeof m.message !== 'string') return fail('error', 'malformed');
      break;
    default:
      break;
  }
  return { ok: true, value: m as unknown as ServerMessage };
}

// ---------------------------------------------------------------------------
// Binary snapshot frames

export const SNAPSHOT_KIND = 0x01;
export const SNAPSHOT_VERSION = 1;
export const SNAPSHOT_HEADER_BYTES = 16;

export const SnapshotFlags = { keyframe: 1, delta: 2, paused: 4, final: 8 } as const;

export interface SnapshotHeader {
  flags: number;
  seq: number;
  tick: number;
  epoch: number;
  baseDelta: number;
}

/** Writes the 16-byte header at `byteOffset` of `view`. */
export function writeSnapshotHeader(view: DataView, h: SnapshotHeader, byteOffset = 0): void {
  view.setUint8(byteOffset, SNAPSHOT_KIND);
  view.setUint8(byteOffset + 1, SNAPSHOT_VERSION);
  view.setUint16(byteOffset + 2, h.flags & 0xffff, true);
  view.setUint32(byteOffset + 4, h.seq >>> 0, true);
  view.setUint32(byteOffset + 8, h.tick >>> 0, true);
  view.setUint16(byteOffset + 12, h.epoch & 0xffff, true);
  view.setUint16(byteOffset + 14, h.baseDelta & 0xffff, true);
}

/** Reads a snapshot header, or null if the frame is not a v1 snapshot. */
export function readSnapshotHeader(buf: ArrayBuffer | ArrayBufferView): SnapshotHeader | null {
  const view =
    buf instanceof ArrayBuffer ? new DataView(buf) : new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (view.byteLength < SNAPSHOT_HEADER_BYTES) return null;
  if (view.getUint8(0) !== SNAPSHOT_KIND || view.getUint8(1) !== SNAPSHOT_VERSION) return null;
  return {
    flags: view.getUint16(2, true),
    seq: view.getUint32(4, true),
    tick: view.getUint32(8, true),
    epoch: view.getUint16(12, true),
    baseDelta: view.getUint16(14, true),
  };
}

/** Builds a complete snapshot frame (header + payload). */
export function encodeSnapshot(h: SnapshotHeader, payload: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(SNAPSHOT_HEADER_BYTES + payload.byteLength);
  writeSnapshotHeader(new DataView(out), h);
  new Uint8Array(out, SNAPSHOT_HEADER_BYTES).set(payload);
  return out;
}

/** The payload part of a snapshot frame (zero-copy view). */
export function snapshotPayload(buf: ArrayBuffer): Uint8Array {
  return new Uint8Array(buf, SNAPSHOT_HEADER_BYTES);
}

/** Maps `v` ∈ [min, max] to an unsigned integer of `bits` (≤ 31) bits, clamping. */
export function quantize(v: number, min: number, max: number, bits: number): number {
  const levels = 2 ** bits - 1;
  const t = (v - min) / (max - min);
  return Math.round((t < 0 ? 0 : t > 1 ? 1 : t) * levels);
}

/** Inverse of {@link quantize}. */
export function dequantize(q: number, min: number, max: number, bits: number): number {
  return min + (q / (2 ** bits - 1)) * (max - min);
}
