// Co-op sync protocol definitions shared by host and guest (see README block in ./index.ts for the big picture).

import type { CoopTransport } from '../transport';
import { CAP } from '../../sim/constants';
import type { Slot } from '@ms/shared';
import type { TableSpec } from './tables';

/**
 * Wire protocol version, checked by the guest on the host's `init` event: a mismatch disconnects with the error 'protocol'.
 * 2 (EL-01): the enemy tier column carries the elite affix in its high nibble (`packTier`), so a v1 peer would read tier 16..79 as an
 * elite tier. Bump it with every change of a table layout or of what a column means.
 */
export const SYNC_VERSION = 2;

/** host ticks (60 Hz calls of `tick`) per snapshot: 4 → 15 Hz */
export const SNAPSHOT_EVERY_TICKS = 4;
/** a full keyframe is re-sent this often (self-healing + late joiners); in snapshots */
export const KEYFRAME_EVERY = 150;
/** hud / damage-meter section cadence in snapshots (~2 Hz) */
export const HUD_EVERY = 8;
/** guests render this far behind the newest snapshot (sim seconds) */
export const INTERP_DELAY = 0.1;
/** byte budgets of one snapshot (the relay accepts 48 KB; we stay far below) */
export const SNAPSHOT_BUDGET = 11_500;
export const KEYFRAME_BUDGET = 30_000;
export const EVENT_BUDGET = 3_500;
/** hosts treat a guest as silent after this many ticks without input and zero its movement */
export const INPUT_STALE_TICKS = 24;
/** a dropped guest keeps its (invulnerable, idle) hero this long; the relay keeps the slot for 60 s */
export const RECONNECT_GRACE_SEC = 15;
/** guests wait for the host to start the run this long; the host waits for slow loaders this long (s) */
export const READY_TIMEOUT_SEC = 25;
/** host → guest personal result checkpoints (host loss fallback) */
export const CHECKPOINT_EVERY_SEC = 10;

// ---------------------------------------------------------------------------
// JSON `event` kinds (≤ 32 chars, [a-z][A-Za-z0-9_.]*)

export const EV = {
  /** guest → host: MetaBonuses of the guest hero (after `start`) */
  meta: 'meta',
  /** guest → host: assets loaded, mirror running; also asks for a keyframe */
  ready: 'ready',
  /** guest → host: please send a keyframe (reconnect, desync) */
  sync: 'sync',
  /** guest → host: card-modal command that is not a pick: { id, op: 'reroll'|'banish'|'skip', index? } */
  cmd: 'cmd',
  /** host → everyone: run handshake { v, fp } (content fingerprint) */
  init: 'init',
  /** host → slot: a card modal (JSON ModalRequest minus `result`) */
  modal: 'modal',
  /** host → slot: final personal RunResult */
  result: 'result',
  /** host → slot: personal RunResult checkpoint */
  ckpt: 'ckpt',
} as const;

export interface PlayerSlotInfo {
  slot: Slot;
  name: string;
}

/** world order on the host: [host, ...other slots ascending] */
export function hostOrder(hostSlot: Slot, slots: readonly Slot[]): Slot[] {
  const rest = slots.filter((s) => s !== hostSlot).sort((a, b) => a - b);
  return [hostSlot, ...rest];
}

/** world order on a guest: [me, ...host order without me]; index 0 is "the local hero" for camera/audio/HUD */
export function localOrder(mySlot: Slot, hostSlot: Slot, slots: readonly Slot[]): Slot[] {
  return [mySlot, ...hostOrder(hostSlot, slots).filter((s) => s !== mySlot)];
}

// ---------------------------------------------------------------------------
// The slice of CoopTransport the sync layer uses (CoopTransport and the in-memory test relay both satisfy it)

export type CoopWire = Pick<
  CoopTransport,
  | 'state'
  | 'room'
  | 'slot'
  | 'host'
  | 'epoch'
  | 'phase'
  | 'players'
  | 'isHost'
  | 'isOpen'
  | 'latencyMs'
  | 'limits'
  | 'on'
  | 'connect'
  | 'join'
  | 'start'
  | 'end'
  | 'leave'
  | 'close'
  | 'input'
  | 'event'
  | 'pick'
  | 'pause'
  | 'resume'
  | 'sendSnapshot'
>;

// ---------------------------------------------------------------------------
// Snapshot tables

export const ENEMY_COL = { x: 0, z: 1, rot: 2, clip: 3, hp: 4, status: 5, flags: 6, corr: 7, scale: 8, tier: 9, type: 10 } as const;
export const ENEMY_SPEC: TableSpec = { name: 'enemy', capacity: CAP.enemies, widths: [2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 2] };

/**
 * The enemy `tier` column is one byte: the elite tier (0..3) in the low nibble and the elite affix (AffixId, 0 = none, 1..4) in the
 * high nibble: `tier | affix << 4`. Both stay below 16; the column does not change shape.
 */
export function packTier(tier: number, affix: number): number {
  return (tier & 15) | ((affix & 15) << 4);
}
/** the elite tier of a packed tier byte */
export function tierOfPacked(b: number): number {
  return b & 15;
}
/** the elite affix id of a packed tier byte (0 = none) */
export function affixOfPacked(b: number): number {
  return (b >> 4) & 15;
}

export const PROJ_COL = { x: 0, z: 1, rot: 2, h: 3, kind: 4, style: 5, radius: 6 } as const;
export const PROJ_SPEC: TableSpec = { name: 'projectile', capacity: CAP.projectiles, widths: [2, 2, 1, 1, 1, 2, 1] };

export const PICKUP_COL = { x: 0, z: 1, h: 2, magnet: 3, kind: 4, tier: 5 } as const;
export const PICKUP_SPEC: TableSpec = { name: 'pickup', capacity: CAP.pickups, widths: [2, 2, 1, 1, 1, 1] };

export const TELE_COL = { x: 0, z: 1, progress: 2, rot: 3, shape: 4, radius: 5, length: 6, width: 7, dur: 8 } as const;
export const TELE_SPEC: TableSpec = { name: 'telegraph', capacity: CAP.telegraphs, widths: [2, 2, 1, 1, 1, 2, 2, 2, 2] };

/** interest management: entities farther than this from every living hero are not sent (enter / leave radius, m) */
export const INTEREST_ENTER = 56;
export const INTEREST_LEAVE = 64;
/** distance classes for the update rate (m): ≤ NEAR every snapshot, ≤ MID every 2nd, beyond every 3rd */
export const RATE_NEAR = 30;
export const RATE_MID = 42;
/** hard caps on how many projectiles / pickups are mirrored (nearest first) */
export const MAX_PROJECTILES = 420;
export const MAX_PICKUPS = 260;

// ---------------------------------------------------------------------------
// Decoded snapshot pieces

export interface PlayerWire {
  alive: boolean;
  connected: boolean;
  x: number;
  z: number;
  vx: number;
  vz: number;
  kvx: number;
  kvz: number;
  dashT: number;
  dashVx: number;
  dashVz: number;
  rot: number;
  /** index into HERO_CLIPS */
  clip: number;
  moveSpeed: number;
  slowMul: number;
  corrupted: number;
  hp: number;
  hpMax: number;
  shield: number;
  level: number;
  xp: number;
  xpNext: number;
  yeop: number;
  shards: number;
  kills: number;
  /** last input seq the host applied for this player, and for how many sim ticks it has been in effect */
  ackSeq: number;
  ackAge: number;
  /** version of the hud skill list the cooldown bytes belong to */
  hudVer: number;
  cds: number[];
}

export interface ModalWire {
  /** host player index */
  player: number;
  id: number;
  waited: number;
}

export interface MetinWire {
  id: number;
  type: number;
  x: number;
  z: number;
  phase: number;
  great: boolean;
  hpFrac: number;
  scale: number;
  auraRadius: number;
  phaseT: number;
  warnLeft: number;
}

export interface BossWire {
  id: number;
  bossId: string;
  enemy: number;
  phase: number;
  enraged: boolean;
  final: boolean;
  hp: number;
  hpMax: number;
  x: number;
  z: number;
}

export interface HudPlayerWire {
  ver: number;
  skills: { id: string; rank: number; basic: boolean }[];
  passives: { id: string; rank: number }[];
  stones: ({ id: string; level: number } | null)[];
  trinkets: ({ id: string; rank: number } | null)[];
  rerolls: number;
  banishes: number;
  skips: number;
  dmg: { skillId: string; rank: number; damage: number }[];
}

export interface HudWire {
  players: HudPlayerWire[];
  nextBoss: { at: number; id: string } | null;
  dps: number;
}

export const HERO_CLIPS = ['idle', 'run', 'cast', 'dash', 'attack', 'hit', 'death', 'victory'] as const;

/** Per-player acknowledgement data the host stamps into every snapshot. */
export interface PlayerAck {
  seq: number;
  age: number;
  connected: boolean;
  /** hud skill-list version of this player (bumped on card picks) */
  hudVer: number;
}

// ---------------------------------------------------------------------------
// Status surfaced to the UI

export type CoopPhase = 'waiting' | 'running' | 'reconnecting' | 'ended' | 'hostLeft' | 'disconnected';

export interface CoopStatusPlayer {
  name: string;
  slot: Slot;
  connected: boolean;
  /** this client */
  local: boolean;
  /** host side: the hero finished loading and is in the run */
  ready: boolean;
}

export interface CoopStatus {
  role: 'host' | 'guest';
  phase: CoopPhase;
  /** players in world order (index 0 = this client on guests, the host on the host) */
  players: CoopStatusPlayer[];
  /** card picks the paused sim is waiting for (name, seconds waited, seconds left until the auto-pick) */
  pendingPicks: { name: string; waited: number; left: number }[];
  /** the host paused the shared sim (menu / hidden tab) */
  hostPaused: boolean;
  pingMs: number;
}

export interface NetStats {
  /** snapshots sent (host) / received (guest) */
  snapshots: number;
  keyframes: number;
  bytes: number;
  maxSnapshotBytes: number;
  maxDeltaBytes: number;
  /** event bytes inside snapshots / events dropped by the budget */
  eventBytes: number;
  droppedEvents: number;
  decodeErrors: number;
  /** seconds covered (wall clock) */
  seconds: number;
}
