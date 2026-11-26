// Guest side of a co-op run. `MirrorWorld` IS a sim `World` — its stores, players, modals, events and `hud()` are what the
// renderer / vfx / audio / UI already read for a local run — but it never simulates: `step()` drives `CoopGuest`, which
//   * sends the local hero's held input at ~20 Hz and predicts the local hero's movement (./predict.ts),
//   * decodes host snapshots into a small frame queue and plays them back ~100 ms behind the newest one, interpolating
//     entity positions between the two surrounding frames and dispatching each frame's events when playback reaches it,
//   * routes card answers to the host and mirrors the host's pending modal offers for the local hero.
//
// The local hero is ALWAYS world index 0 (camera, audio listener, "player === 0" HUD flashes keep working); the other heroes
// follow in host order. Snapshot player indexes are host indexes and are mapped on the way in.

import { COOP_BTN_ATTACK, COOP_BTN_CAST_MASK, COOP_BTN_MANUAL, type JsonValue, type ServerMessage, type Slot } from '@ms/shared';
import { AFFIX_KINDS, MAX_SKILL_RANK, type ContentDB } from '../../data/schema';
import { DT } from '../../sim/constants';
import { DEFAULT_RUN_OPTIONS, type RunConfig, type RunResult } from '../../sim/run';
import { EventBus } from '../../sim/events';
import { runEventHudOf, type RunEventView } from '../../sim/runEvents';
import type { DenseStore, PlayerInput } from '../../sim/stores';
import { MetinPhase, type Card, type HudSnapshot, type MetinState, type ModalRequest, type WorldEnv } from '../../sim/types';
import { World } from '../../sim/world';
import { ByteReader, DecodeError } from './bytes';
import { decodeEvents, type EventSink } from './events';
import { HeroPredictor } from './predict';
import {
  affixOfPacked,
  EV,
  HERO_CLIPS,
  INTERP_DELAY,
  SYNC_VERSION,
  tierOfPacked,
  type CoopPhase,
  type CoopStatus,
  type CoopWire,
  type HudWire,
  type NetStats,
  type PlayerWire,
} from './protocol';
import { dqang, dqpos, qang } from './quant';
import { decodeResult } from './results';
import { SnapshotDecoder, type SnapshotFrame } from './snapshot';
import type { TableState } from './tables';
import { openRunEnd } from '../../sim/cards';

type Of<T extends ServerMessage['t']> = Extract<ServerMessage, { t: T }>;

export class MirrorWorld extends World {
  /** set by `CoopGuest` */
  guest: CoopGuest | null = null;

  constructor(config: RunConfig, content: ContentDB, env: WorldEnv) {
    super(config, content, config.meta, env);
  }

  /** the run loop's tick: sends input, advances playback (never simulates) */
  override step(inputs: readonly PlayerInput[]): void {
    const g = this.guest;
    if (!g) {
      this.bus.clear();
      return;
    }
    g.tick(inputs[0]);
  }

  override chooseCard(index: number, _player = 0): boolean {
    return this.guest?.pickCard(index) ?? false;
  }
  override reroll(_player = 0): boolean {
    return this.guest?.command('reroll', 0) ?? false;
  }
  override banish(index: number, _player = 0): boolean {
    return this.guest?.command('banish', index) ?? false;
  }
  override skip(_player = 0): boolean {
    return this.guest?.command('skip', 0) ?? false;
  }
  override hud(player = 0): HudSnapshot {
    return this.guest ? this.guest.buildHud(player) : super.hud(player);
  }
  override buildResult(victory: boolean): RunResult {
    return this.guest ? this.guest.personalResult(victory) : super.buildResult(victory);
  }
}

class TableMap {
  readonly local: Uint32Array;
  readonly net: Uint16Array;
  readonly active: Uint8Array;
  constructor(cap: number) {
    this.local = new Uint32Array(cap);
    this.net = new Uint16Array(cap);
    this.active = new Uint8Array(cap);
  }
}

export interface CoopGuestOptions {
  world: MirrorWorld;
  wire: CoopWire;
  mySlot: Slot;
  hostSlot: Slot;
  /** guest world order: [me, ...] */
  order: readonly Slot[];
  /** host world order: [host, ...] */
  hostOrder: readonly Slot[];
  /** display names in guest world order */
  names: readonly string[];
  fingerprint: string;
  now?: () => number;
  onStatus?: (s: CoopStatus) => void;
}

function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f;
}
function lerpAngle(a: number, b: number, f: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * f;
}

const QUEUE_MAX = 18;
/** Bounds on deferred event blocks retained while the guest render loop is suspended (NET-09). */
export const DEFERRED_MAX_BLOCKS = 24;
export const DEFERRED_MAX_BYTES = 64 * 1024;
const TELEPORT = 6;
/** a shrine channel value older than this (mirrored seconds) is dropped: the host sends it at 4 Hz while it changes, a lost one must not freeze the bar */
const CHANNEL_STALE = 1;

export class CoopGuest {
  readonly world: MirrorWorld;
  readonly stats: NetStats = {
    snapshots: 0,
    keyframes: 0,
    bytes: 0,
    maxSnapshotBytes: 0,
    maxDeltaBytes: 0,
    eventBytes: 0,
    droppedEvents: 0,
    decodeErrors: 0,
    seconds: 0,
  };
  readonly decoder = new SnapshotDecoder();
  readonly predictor: HeroPredictor;
  phase: CoopPhase = 'waiting';
  /** reconciliation statistics (metres the predicted hero had to move per snapshot) */
  readonly prediction = { count: 0, sumJump: 0, maxJump: 0, snaps: 0 };
  /** error code when the session cannot continue (`contentMismatch`, `protocol`) */
  error: string | null = null;
  /** newest decoded frame / frame currently on display */
  latest: SnapshotFrame | null = null;
  A: SnapshotFrame | null = null;
  /** playback clock in sim seconds */
  rt = 0;
  hostPaused = false;
  /** wall-clock ms of the last snapshot */
  lastSnapshotAt = 0;

  private readonly wire: CoopWire;
  private readonly mySlot: Slot;
  private readonly hostSlot: Slot;
  private readonly names: readonly string[];
  private readonly deferred: { count: number; bytes: Uint8Array; time: number }[] = [];
  private deferredBytes = 0;
  private deferredOverflowed = false;
  /**
   * The host sim time of the snapshot frame whose events are being decoded (set by pass() / the deferred loop in tick()): what a
   * mirrored 'runEvent' is stamped with. NOT the mirror clock: events are decoded before the clock moves (a clock-jump tick, the
   * frames that piled up while the tab was hidden, a fresh mirror's first frame), and a stamp from the stale clock would drop a LIVE
   * event from the HUD until the next heartbeat.
   */
  private evTime = 0;
  private readonly order: readonly Slot[];
  private readonly pInit = new Uint8Array(4);
  private readonly fingerprint: string;
  private readonly now: () => number;
  private readonly onStatus: ((s: CoopStatus) => void) | undefined;
  private readonly offs: (() => void)[] = [];
  private readonly hostOfLocal: number[];
  private readonly localOfHost: number[];
  private readonly queue: SnapshotFrame[] = [];
  private B: SnapshotFrame | null = null;
  private f = 0;
  private started = false;
  private tickN = 0;
  private lastSyncReq = -1000;
  private lastSyncReqAt = -Infinity;
  private firstAt = 0;
  private lastStatus = '';
  // input
  private heldQx = 0;
  private heldQz = 0;
  private heldBtn = 0;
  private heldAim = -1;
  private prevAttack = false;
  private pendingAttack = false;
  private pendingCastMask = 0;
  private pendingAim = -1;
  private lastSendTick = -100;
  private sentOnce = false;
  // tables
  private readonly eMap = new TableMap(768);
  private readonly pMap = new TableMap(1500);
  private readonly kMap = new TableMap(1200);
  private readonly tMap = new TableMap(128);
  private readonly eToggle = new Uint8Array(768);
  private readonly metinObjs = new Map<number, MetinState>();
  // modals / results / hud
  private readonly offers = new Map<number, ModalRequest>();
  private readonly confirmed = new Set<number>();
  private readonly picked = new Set<number>();
  private runEndModal: ModalRequest | null = null;
  private hudCache: HudWire | null = null;
  // run event (RS-02a): the latest mirrored 'runEvent' state (the HUD timer counts down from absolute times on the mirrored clock)
  // and each local hero's shrine channel progress; only the local hero's own value reaches its HUD.
  // seenAt = the host sim time of the frame that carried the last 'runEvent' refreshing the view (runEventHudOf drops a ghost no heartbeat refreshes)
  private runEventView: (RunEventView & { id: number; seenAt: number }) | null = null;
  private readonly channels: ({ p: number; at: number } | undefined)[] = [];
  private finalResult: RunResult | null = null;
  private ckpt: RunResult | null = null;
  // scratch
  private sx = 0;
  private sz = 0;
  private sr = 0;
  private readonly sink: EventSink;
  private readonly stateBus = new EventBus();
  private readonly stateSink: EventSink;

  constructor(o: CoopGuestOptions) {
    this.world = o.world;
    this.wire = o.wire;
    this.mySlot = o.mySlot;
    this.hostSlot = o.hostSlot;
    this.names = o.names;
    this.order = o.order;
    this.fingerprint = o.fingerprint;
    this.now = o.now ?? Date.now;
    this.onStatus = o.onStatus;
    this.hostOfLocal = o.order.map((s) => o.hostOrder.indexOf(s));
    this.localOfHost = o.hostOrder.map((s) => o.order.indexOf(s));
    this.predictor = new HeroPredictor({
      arenaRadius: o.world.arenaRadius,
      walkable: o.world.env.walkable,
      moveCircle: o.world.env.moveCircle,
      surfaceAt: o.world.env.surfaceAt,
    });
    o.world.guest = this;
    this.sink = {
      bus: this.world.bus,
      player: (h) => this.localOfHost[h] ?? 0,
      enemy: (id) => this.localEnemy(id),
      str: (id) => this.decoder.wireNames[id] ?? '',
      onDamage: (handle) => {
        const S = this.world.enemies;
        const row = handle !== 0 ? S.find(handle) : -1;
        if (row >= 0) S.flash[row] = 1;
      },
      onPlayerHit: (idx, result) => {
        const p = this.world.players[idx];
        if (p && result === 0) p.flash = 1;
      },
      onRunEvent: (e) => {
        if (e.phase === 'channel') {
          if (e.player >= 0 && e.id === this.runEventView?.id) this.channels[e.player] = { p: e.p, at: this.evTime };
          return;
        }
        const cur = this.runEventView;
        // an older event never replaces a newer one; a new event starts without channel progress
        if (cur !== null && e.id < cur.id) return;
        if (cur === null || e.id !== cur.id || e.phase === 'end') this.channels.length = 0;
        this.runEventView = { id: e.id, kind: e.kind, phase: e.phase, x: e.x, z: e.z, startAt: e.startAt, endAt: e.endAt, seenAt: this.evTime };
      },
    };
    this.stateSink = {
      bus: this.stateBus,
      player: this.sink.player,
      enemy: () => 0,
      str: this.sink.str,
      ...(this.sink.onRunEvent ? { onRunEvent: this.sink.onRunEvent } : {}),
    };
    const w = this.wire;
    this.offs.push(
      w.on('snapshot', (e) => this.onSnapshot(e.frame)),
      w.on('event', (m) => this.onEvent(m)),
      w.on('roomState', (m) => this.onRoomState(m)),
      w.on('hello', () => this.onHello()),
      w.on('end', () => this.onEnd()),
      w.on('pause', () => this.setHostPaused(true)),
      w.on('resume', () => this.setHostPaused(false)),
      w.on('close', (c) => this.onClose(c.willReconnect)),
    );
  }

  /** assets are loaded and the world is on screen: tell the host (it holds the sim until everybody is in) */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.firstAt = this.now();
    this.phase = 'waiting';
    this.requestSync(true);
    this.emitStatus(true);
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    if (this.world.guest === this) this.world.guest = null;
  }

  // ---- network in ---------------------------------------------------------------------------------------------------------

  private applyDeferredState(d: { count: number; bytes: Uint8Array; time: number }): void {
    this.stateBus.clear();
    try {
      this.evTime = d.time;
      decodeEvents(new ByteReader(d.bytes), d.count, this.stateSink);
    } catch (e) {
      if (!(e instanceof DecodeError)) throw e;
      this.stats.decodeErrors++;
    } finally {
      this.stateBus.clear();
    }
  }

  private pushDeferred(count: number, bytes: Uint8Array, time: number): void {
    if (bytes.byteLength > DEFERRED_MAX_BYTES) {
      this.applyDeferredState({ count, bytes, time });
      this.stats.droppedEvents += count;
      this.deferredOverflowed = true;
      return;
    }
    this.deferred.push({ count, bytes, time });
    this.deferredBytes += bytes.byteLength;
    while (this.deferred.length > DEFERRED_MAX_BLOCKS || this.deferredBytes > DEFERRED_MAX_BYTES) {
      const evicted = this.deferred.shift() as { count: number; bytes: Uint8Array; time: number };
      this.deferredBytes -= evicted.bytes.byteLength;
      this.stats.droppedEvents += evicted.count;
      this.deferredOverflowed = true;
      // Preserve essential state transitions (runEvent phases/heartbeats) before discarding stale cosmetics.
      this.applyDeferredState(evicted);
    }
  }

  private onSnapshot(frame: ArrayBuffer): void {
    if (this.world.over || this.error) return;
    let f: SnapshotFrame | null = null;
    try {
      f = this.decoder.decode(frame, this.now());
    } catch (e) {
      this.stats.decodeErrors++;
      if (!(e instanceof DecodeError)) throw e;
      this.requestSync(false);
      return;
    }
    if (!f) {
      if (this.decoder.needKeyframe) this.requestSync(false);
      return;
    }
    const s = this.stats;
    s.snapshots++;
    if (f.keyframe) s.keyframes++;
    s.bytes += f.bytes;
    s.maxSnapshotBytes = Math.max(s.maxSnapshotBytes, f.bytes);
    if (!f.keyframe) s.maxDeltaBytes = Math.max(s.maxDeltaBytes, f.bytes);
    s.eventBytes += f.eventLen;
    this.lastSnapshotAt = f.recvAt;
    s.seconds = (f.recvAt - this.firstAt) / 1000;
    this.latest = f;
    this.queue.push(f);
    while (this.queue.length > QUEUE_MAX) {
      // playback fell far behind (hidden tab): retain bounded deferred event blocks, dropping oldest cosmetics
      const old = this.queue.shift() as SnapshotFrame;
      if (old.eventCount > 0) this.pushDeferred(old.eventCount, old.eventBytes.slice(0, old.eventLen), old.time);
    }
    if (f.hud) this.hudCache = f.hud;
    if (this.phase === 'waiting' || this.phase === 'reconnecting') this.phase = 'running';
    // keep the extrapolation of the local hero honest: rewind to what the host says and replay unacknowledged input
    const me = f.players[this.hostOfLocal[0] as number];
    if (me) {
      const running = !f.paused && !f.final;
      const r = this.predictor.reconcile(me, running);
      const ps = this.prediction;
      ps.count++;
      ps.sumJump += r.jump;
      if (r.jump > ps.maxJump && running) ps.maxJump = r.jump;
      if (r.snapped && running) ps.snaps++;
    }
    this.syncOffers(f);
  }

  private onEvent(m: Of<'event'>): void {
    if (m.from !== this.hostSlot) return;
    const d = m.d;
    switch (m.k) {
      case EV.init:
        if (typeof d === 'object' && d !== null && !Array.isArray(d)) {
          if (d.v !== SYNC_VERSION || d.fp !== this.fingerprint) {
            this.error = d.v !== SYNC_VERSION ? 'protocol' : 'contentMismatch';
            this.phase = 'disconnected';
            this.emitStatus(true);
          }
        }
        break;
      case EV.modal:
        this.onModal(d);
        break;
      case EV.result: {
        const r = decodeResult(d);
        if (r) {
          this.finalResult = r;
          if (this.latest?.final && !this.world.over) this.finalize('ended');
        }
        break;
      }
      case EV.ckpt: {
        const r = decodeResult(d);
        if (r) this.ckpt = r;
        break;
      }
      default:
        break;
    }
  }

  private onModal(d: JsonValue | undefined): void {
    if (typeof d !== 'object' || d === null || Array.isArray(d)) return;
    const id = d.id;
    if (typeof id !== 'number' || this.picked.has(id)) return;
    const kind = d.kind;
    if (kind !== 'levelUp' && kind !== 'essence' && kind !== 'chest' && kind !== 'bossReward') return;
    const prev = this.offers.get(id);
    const req: ModalRequest = {
      id,
      kind,
      player: 0,
      // the host's cards, whole: optional Card fields (pact / needs / bargain, ...) must not be filtered here (net/coop/cardFields.test.ts)
      cards: Array.isArray(d.cards) ? (d.cards as unknown as Card[]) : [],
      canReroll: d.canReroll === true,
      canBanish: d.canBanish === true,
      canSkip: d.canSkip === true,
      rerolls: typeof d.rerolls === 'number' ? d.rerolls : 0,
      banishes: typeof d.banishes === 'number' ? d.banishes : 0,
      skips: typeof d.skips === 'number' ? d.skips : 0,
      level: typeof d.level === 'number' ? d.level : 0,
      source: typeof d.source === 'string' ? d.source : '',
      free: d.free === true,
      awakened: d.awakened === true,
      waited: prev?.waited ?? 0,
      result: null,
    };
    this.offers.set(id, req);
    this.rebuildModals();
  }

  /** confirm / retire offers according to the host's pending list (modals pause the sim, so this is the only truth) */
  private syncOffers(f: SnapshotFrame): void {
    const meHost = this.hostOfLocal[0] as number;
    let changed = false;
    for (const [id, req] of this.offers) {
      const listed = f.modals.find((m) => m.player === meHost && m.id === id);
      if (listed) {
        this.confirmed.add(id);
        req.waited = listed.waited;
      } else if (this.confirmed.has(id)) {
        this.offers.delete(id);
        this.confirmed.delete(id);
        changed = true;
      }
    }
    if (changed) this.rebuildModals();
  }

  private rebuildModals(): void {
    const w = this.world;
    w.modals.length = 0;
    const ids = [...this.offers.keys()].sort((a, b) => a - b);
    for (const id of ids) w.modals.push(this.offers.get(id) as ModalRequest);
    if (this.runEndModal) w.modals.push(this.runEndModal);
  }

  private onRoomState(m: Of<'roomState'>): void {
    if (this.world.over) return;
    if (m.host !== this.hostSlot || m.cause?.kind === 'hostChanged') {
      // host migration is not supported mid-run: finish with the last checkpoint, and if the relay made US the host return
      // the room to its lobby so everybody can regroup
      if (this.wire.isHost) this.wire.end(false);
      this.finalize('hostLeft');
      return;
    }
    this.emitStatus(false);
  }

  private clearInputLatches(): void {
    this.heldQx = 0;
    this.heldQz = 0;
    this.heldBtn = 0;
    this.heldAim = -1;
    this.prevAttack = false;
    this.pendingAttack = false;
    this.pendingCastMask = 0;
    this.pendingAim = -1;
  }

  private onHello(): void {
    if (this.world.over) return;
    if (this.wire.host !== this.hostSlot) {
      this.finalize('hostLeft');
      return;
    }
    if (this.wire.phase !== 'running') {
      this.finalize('ended');
      return;
    }
    if (this.phase === 'reconnecting') {
      this.clearInputLatches();
      this.phase = 'waiting';
      this.decoder.needKeyframe = true;
      this.requestSync(true);
    }
    this.emitStatus(true);
  }

  private onEnd(): void {
    if (this.world.over) return;
    this.finalize('ended');
  }

  private onClose(willReconnect: boolean): void {
    if (this.world.over) return;
    this.clearInputLatches();
    if (willReconnect) {
      this.phase = 'reconnecting';
      this.emitStatus(true);
    } else {
      this.finalize('disconnected');
    }
  }

  private setHostPaused(p: boolean): void {
    this.hostPaused = p;
    this.emitStatus(true);
  }

  private requestSync(force: boolean): boolean {
    if (!this.started) return false;
    const now = this.now();
    if (!force && this.tickN - this.lastSyncReq < 90 && now - this.lastSyncReqAt < 1500) return false;
    this.lastSyncReq = this.tickN;
    this.lastSyncReqAt = now;
    this.wire.event(force ? EV.ready : EV.sync);
    return true;
  }

  // ---- commands ---------------------------------------------------------------------------------------------------------

  private firstOffer(): ModalRequest | null {
    for (const m of this.world.modals) if (m.kind !== 'runEnd') return m;
    return null;
  }

  pickCard(index: number): boolean {
    const m = this.firstOffer();
    if (!m || index < 0 || index >= m.cards.length) return false;
    if (!this.wire.pick(m.id, index)) return false;
    this.offers.delete(m.id);
    this.confirmed.delete(m.id);
    this.picked.add(m.id);
    this.rebuildModals();
    return true;
  }

  command(op: 'reroll' | 'banish' | 'skip', index: number): boolean {
    const m = this.firstOffer();
    if (!m) return false;
    if (op === 'reroll' && !m.canReroll) return false;
    if (op === 'banish' && (!m.canBanish || index < 0 || index >= m.cards.length)) return false;
    if (op === 'skip' && !m.canSkip) return false;
    if (!this.wire.event(EV.cmd, { id: m.id, op, index })) return false;
    if (op === 'skip') {
      this.offers.delete(m.id);
      this.confirmed.delete(m.id);
      this.picked.add(m.id);
      this.rebuildModals();
    }
    return true;
  }

  // ---- per tick ---------------------------------------------------------------------------------------------------------

  tick(input?: PlayerInput | number, inZ?: number): void {
    const inp: PlayerInput | undefined =
      typeof input === 'number' ? { moveX: input, moveZ: inZ ?? 0 } : input;
    const w = this.world;
    w.bus.clear();
    this.tickN++;
    if (this.deferred.length > 0) {
      for (const d of this.deferred) {
        try {
          this.evTime = d.time;
          decodeEvents(new ByteReader(d.bytes), d.count, this.sink);
        } catch (e) {
          if (!(e instanceof DecodeError)) throw e;
          this.stats.decodeErrors++;
        }
      }
      this.deferred.length = 0;
      this.deferredBytes = 0;
    }
    if (this.deferredOverflowed && this.requestSync(false)) {
      this.deferredOverflowed = false;
    }
    if (w.over || this.error) return;
    const aimRot = this.pumpInput(inp);
    const lf = this.latest;
    const simRunning = lf !== null && !lf.paused && !lf.final;
    this.predictor.step(this.heldQx / 127, this.heldQz / 127, simRunning, aimRot);
    if (!this.advanceClock()) {
      this.watchdog();
      return;
    }
    const A = this.A as SnapshotFrame;
    this.syncStyles();
    this.syncTable(A.enemies, this.B?.enemies ?? null, w.enemies, this.eMap, this.fillEnemy);
    this.syncTable(A.projectiles, this.B?.projectiles ?? null, w.projectiles, this.pMap, this.fillProjectile);
    this.syncTable(A.pickups, this.B?.pickups ?? null, w.pickups, this.kMap, this.fillPickup);
    this.syncTable(A.telegraphs, this.B?.telegraphs ?? null, w.telegraphs, this.tMap, this.fillTelegraph);
    this.syncMetins(A);
    this.syncPlayers(A);
    w.time = this.rt;
    w.tick = Math.round(this.rt * 60);
    const B = this.B;
    w.corruption = B ? lerp(A.corruption, B.corruption, this.f) : A.corruption;
    w.darkness = B ? lerp(A.darkness, B.darkness, this.f) : A.darkness;
    w.maxCorruption = A.maxCorruption;
    if (A.final && !w.over) this.finalize('ended');
    this.watchdog();
    if (this.tickN % 60 === 0) this.emitStatus(false);
  }

  private watchdog(): void {
    if (!this.started) return;
    if (this.decoder.needKeyframe || this.latest === null) this.requestSync(false);
  }

  private pumpInput(input: PlayerInput | undefined): number {
    let x = input?.moveX ?? 0;
    let z = input?.moveZ ?? 0;
    const l = Math.hypot(x, z);
    if (l > 1) {
      x /= l;
      z /= l;
    } else if (!Number.isFinite(l)) {
      x = 0;
      z = 0;
    }
    const qx = Math.round(x * 127);
    const qz = Math.round(z * 127);

    let qAim = -1;
    if (input && typeof input.aimX === 'number' && typeof input.aimZ === 'number') {
      const al = Math.hypot(input.aimX, input.aimZ);
      if (al > 1e-4 && Number.isFinite(al)) qAim = qang(Math.atan2(input.aimX / al, input.aimZ / al));
    }

    // Latch rising-edge manual combat triggers (plus their aim) so throttle frames never drop quick clicks or skill hotkeys,
    // without spamming 60 Hz packets while Space/LMB is held continuously.
    const attackNow = input?.attack === true;
    const attackEdge = attackNow && !this.prevAttack;
    this.prevAttack = attackNow;
    const rawMask = (input?.castMask ?? 0) & COOP_BTN_CAST_MASK;
    if (attackEdge) {
      this.pendingAttack = true;
      if (qAim >= 0) this.pendingAim = qAim;
    }
    if (rawMask !== 0) {
      this.pendingCastMask |= rawMask;
      if (qAim >= 0) this.pendingAim = qAim;
    }

    const btn =
      (input?.manualCast ? COOP_BTN_MANUAL : 0) |
      (attackNow || this.pendingAttack ? COOP_BTN_ATTACK : 0) |
      this.pendingCastMask;
    const sendAim = this.pendingAim >= 0 ? this.pendingAim : qAim;

    const tick = this.predictor.tick;
    const since = tick - this.lastSendTick;
    const moveChanged = qx !== this.heldQx || qz !== this.heldQz;
    const urgent = this.pendingAttack || this.pendingCastMask !== 0;
    const btnChanged = (btn & ~COOP_BTN_CAST_MASK) !== this.heldBtn || urgent;
    const aimDelta = sendAim >= 0 && this.heldAim >= 0 ? Math.min((sendAim - this.heldAim + 256) & 255, (this.heldAim - sendAim + 256) & 255) : sendAim !== this.heldAim ? 255 : 0;
    const aimChanged = sendAim !== this.heldAim && ((btn & (COOP_BTN_ATTACK | COOP_BTN_CAST_MASK)) !== 0 || aimDelta >= 3);
    const changed = moveChanged || btnChanged || aimChanged;
    // Cap at 30 Hz (since >= 2) to stay strictly inside the relay's 30/s input bucket; 6 Hz keepalive while steady.
    if (!this.sentOnce || (changed && since >= 2) || since >= 10) {
      if (this.wire.isOpen) {
        this.wire.input({
          seq: tick,
          tick: this.latest?.tick ?? 0,
          mx: qx,
          mz: qz,
          ...(sendAim >= 0 ? { aim: sendAim } : {}),
          ...(btn !== 0 ? { btn } : {}),
        });
        this.heldQx = qx;
        this.heldQz = qz;
        // Track stateful mode/held-attack flags; one-shot castMask bits do not need a follow-up clear packet.
        this.heldBtn = btn & ~COOP_BTN_CAST_MASK;
        this.heldAim = sendAim;
        this.pendingAttack = false;
        this.pendingCastMask = 0;
        this.pendingAim = -1;
      } else {
        this.clearInputLatches();
      }
      this.sentOnce = true;
      this.lastSendTick = tick;
    }

    // Match sim/player.ts manual-cast aim facing immediately in local hero prediction.
    return input?.manualCast && (attackNow || rawMask !== 0) && qAim >= 0 ? dqang(qAim) : NaN;
  }

  /** advances the playback clock; false while there is nothing to show yet */
  private advanceClock(): boolean {
    const q = this.queue;
    if (this.A === null) {
      const first = q.shift();
      if (!first) return false;
      this.pass(first);
      this.rt = first.time;
      this.A = first;
    } else {
      const newest = q.length > 0 ? (q[q.length - 1] as SnapshotFrame).time : this.A.time;
      const lag = newest - this.rt;
      if (lag > 0.6) this.rt = newest - INTERP_DELAY;
      else if (lag > INTERP_DELAY * 1.6) this.rt += DT * 1.06;
      else if (lag < INTERP_DELAY * 0.6) this.rt += DT * 0.94;
      else this.rt += DT;
      if (this.rt > newest) this.rt = newest;
      while (q.length > 0 && (q[0] as SnapshotFrame).time <= this.rt) this.pass((this.A = q.shift() as SnapshotFrame));
    }
    const A = this.A;
    this.B = q.length > 0 ? (q[0] as SnapshotFrame) : null;
    const B = this.B;
    this.f = B && B.time > A.time ? Math.min(1, Math.max(0, (this.rt - A.time) / (B.time - A.time))) : 0;
    return true;
  }

  /** playback reached `f`: its events fire now */
  private pass(f: SnapshotFrame): void {
    if (f.eventCount === 0) return;
    try {
      this.evTime = f.time;
      decodeEvents(new ByteReader(f.eventBytes, 0, f.eventLen), f.eventCount, this.sink);
    } catch (e) {
      if (!(e instanceof DecodeError)) throw e;
      this.stats.decodeErrors++;
    }
  }

  private localEnemy(netId: number): number {
    const slot = netId & 0x7ff;
    if (slot >= 768 || this.eMap.active[slot] !== 1 || this.eMap.net[slot] !== netId) return 0;
    return this.eMap.local[slot] as number;
  }

  private syncStyles(): void {
    const names = this.world.strings.names;
    const src = this.decoder.styleNames;
    for (let i = names.length; i < src.length; i++) names.push(src[i] as string);
  }

  // ---- tables ------------------------------------------------------------------------------------------------------------

  private syncTable(
    A: TableState,
    B: TableState | null,
    store: DenseStore,
    map: TableMap,
    fill: (row: number, slot: number, isNew: boolean, A: TableState, B: TableState | null) => void,
  ): void {
    const cap = A.spec.capacity;
    for (let s = 0; s < cap; s++) {
      if (A.present[s] === 0) {
        if (map.active[s] === 1) {
          const r = store.find(map.local[s] as number);
          if (r >= 0) store.free(r);
          map.active[s] = 0;
        }
        continue;
      }
      const nid = A.id[s] as number;
      let row = map.active[s] === 1 ? store.find(map.local[s] as number) : -1;
      let isNew = false;
      if (row < 0 || map.net[s] !== nid) {
        if (row >= 0) store.free(row);
        row = store.alloc();
        if (row < 0) {
          map.active[s] = 0;
          continue;
        }
        map.local[s] = store.id[row] as number;
        map.net[s] = nid;
        map.active[s] = 1;
        isNew = true;
      }
      fill.call(this, row, s, isNew, A, B);
    }
  }

  /** samples x/z of `slot` between A and B into sx/sz */
  private samplePos(A: TableState, B: TableState | null, slot: number): void {
    const ax = dqpos((A.cols[0] as Uint16Array)[slot] as number);
    const az = dqpos((A.cols[1] as Uint16Array)[slot] as number);
    const f = this.f;
    if (B && f > 0 && B.present[slot] === 1 && B.id[slot] === A.id[slot]) {
      const bx = dqpos((B.cols[0] as Uint16Array)[slot] as number);
      const bz = dqpos((B.cols[1] as Uint16Array)[slot] as number);
      if (Math.abs(bx - ax) < TELEPORT && Math.abs(bz - az) < TELEPORT) {
        this.sx = lerp(ax, bx, f);
        this.sz = lerp(az, bz, f);
        return;
      }
    }
    this.sx = ax;
    this.sz = az;
  }

  /** samples the u8 angle column `col` into sr (radians) */
  private sampleRot(A: TableState, B: TableState | null, slot: number, col: number): void {
    const ra = dqang((A.cols[col] as Uint16Array)[slot] as number);
    const f = this.f;
    if (B && f > 0 && B.present[slot] === 1 && B.id[slot] === A.id[slot]) {
      this.sr = lerpAngle(ra, dqang((B.cols[col] as Uint16Array)[slot] as number), f);
    } else {
      this.sr = ra;
    }
  }

  private fillEnemy(row: number, slot: number, isNew: boolean, A: TableState, B: TableState | null): void {
    const S = this.world.enemies;
    this.samplePos(A, B, slot);
    this.sampleRot(A, B, slot, 2);
    S.px[row] = isNew ? this.sx : (S.x[row] as number);
    S.pz[row] = isNew ? this.sz : (S.z[row] as number);
    S.x[row] = this.sx;
    S.z[row] = this.sz;
    S.prot[row] = isNew ? this.sr : (S.rot[row] as number);
    S.rot[row] = this.sr;
    const cols = A.cols;
    const clipCol = (cols[3] as Uint16Array)[slot] as number;
    const clip = clipCol & 0x7f;
    const toggle = clipCol >> 7;
    if (isNew) {
      S.animT[row] = 0;
      this.eToggle[slot] = toggle;
      S.flash[row] = 0;
    } else if (S.animClip[row] !== clip || this.eToggle[slot] !== toggle) {
      S.animT[row] = 0;
      this.eToggle[slot] = toggle;
    } else {
      S.animT[row] = (S.animT[row] as number) + DT;
    }
    S.animClip[row] = clip;
    const fl = S.flash[row] as number;
    if (fl > 0) S.flash[row] = Math.max(0, fl - DT * 5);
    S.hpMax[row] = 100;
    S.hp[row] = (((cols[4] as Uint16Array)[slot] as number) * 100) / 255;
    S.status[row] = (cols[5] as Uint16Array)[slot] as number;
    S.flags[row] = (cols[6] as Uint16Array)[slot] as number;
    S.corrupted[row] = ((cols[7] as Uint16Array)[slot] as number) / 15;
    S.scale[row] = ((cols[8] as Uint16Array)[slot] as number) / 32;
    // the tier byte is tier | affix << 4 (protocol.ts packTier); an affix id this build does not know shows as plain
    const packed = (cols[9] as Uint16Array)[slot] as number;
    S.eliteTier[row] = tierOfPacked(packed);
    const affix = affixOfPacked(packed);
    S.affix[row] = affix <= AFFIX_KINDS.length ? affix : 0;
    const type = (cols[10] as Uint16Array)[slot] as number;
    const defs = this.world.typeDefs;
    S.type[row] = type < defs.length ? type : 0;
    S.radius[row] = defs[S.type[row] as number]?.radius ?? 0.5;
  }

  private fillProjectile(row: number, slot: number, isNew: boolean, A: TableState, B: TableState | null): void {
    const S = this.world.projectiles;
    this.samplePos(A, B, slot);
    this.sampleRot(A, B, slot, 2);
    S.px[row] = isNew ? this.sx : (S.x[row] as number);
    S.pz[row] = isNew ? this.sz : (S.z[row] as number);
    S.x[row] = this.sx;
    S.z[row] = this.sz;
    S.rot[row] = this.sr;
    const cols = A.cols;
    S.h[row] = ((cols[3] as Uint16Array)[slot] as number) / 32;
    const kind = (cols[4] as Uint16Array)[slot] as number;
    S.kind[row] = kind & 0x7f;
    S.hostile[row] = kind >> 7;
    S.style[row] = (cols[5] as Uint16Array)[slot] as number;
    S.radius[row] = ((cols[6] as Uint16Array)[slot] as number) / 32;
    S.age[row] = isNew ? 0 : (S.age[row] as number) + DT;
  }

  private fillPickup(row: number, slot: number, isNew: boolean, A: TableState, B: TableState | null): void {
    const S = this.world.pickups;
    this.samplePos(A, B, slot);
    S.px[row] = isNew ? this.sx : (S.x[row] as number);
    S.pz[row] = isNew ? this.sz : (S.z[row] as number);
    S.x[row] = this.sx;
    S.z[row] = this.sz;
    const cols = A.cols;
    S.h[row] = ((cols[2] as Uint16Array)[slot] as number) / 64;
    S.magnet[row] = (cols[3] as Uint16Array)[slot] as number;
    S.kind[row] = (cols[4] as Uint16Array)[slot] as number;
    S.tier[row] = (cols[5] as Uint16Array)[slot] as number;
    S.age[row] = isNew ? 0 : (S.age[row] as number) + DT;
  }

  private fillTelegraph(row: number, slot: number, _isNew: boolean, A: TableState, B: TableState | null): void {
    const S = this.world.telegraphs;
    this.samplePos(A, B, slot);
    this.sampleRot(A, B, slot, 3);
    S.x[row] = this.sx;
    S.z[row] = this.sz;
    S.rot[row] = this.sr;
    const cols = A.cols;
    const pa = ((cols[2] as Uint16Array)[slot] as number) / 255;
    S.progress[row] = B && this.f > 0 && B.present[slot] === 1 && B.id[slot] === A.id[slot] ? lerp(pa, ((B.cols[2] as Uint16Array)[slot] as number) / 255, this.f) : pa;
    const sh = (cols[4] as Uint16Array)[slot] as number;
    S.shape[row] = sh & 15;
    S.owner[row] = sh >> 4;
    S.radius[row] = ((cols[5] as Uint16Array)[slot] as number) / 32;
    S.length[row] = ((cols[6] as Uint16Array)[slot] as number) / 32;
    S.width[row] = ((cols[7] as Uint16Array)[slot] as number) / 64;
    S.dur[row] = ((cols[8] as Uint16Array)[slot] as number) / 100;
  }

  // ---- metins / players -----------------------------------------------------------------------------------------------------

  private syncMetins(A: SnapshotFrame): void {
    const w = this.world;
    const seen = new Set<number>();
    w.metins.length = 0;
    const dt = Math.max(0, this.rt - A.time);
    for (const m of A.metins) {
      seen.add(m.id);
      let o = this.metinObjs.get(m.id);
      if (!o) {
        const def = w.metinDefs[m.type] ?? (w.metinDefs[0] as MetinState['def']);
        o = {
          id: m.id,
          def,
          type: m.type,
          x: m.x,
          z: m.z,
          phase: m.phase as MetinPhase,
          phaseT: 0,
          age: 0,
          enemy: 0,
          hp: 0,
          hpMax: 1,
          hpFrac: 1,
          scale: 1,
          great: m.great,
          auraRadius: m.auraRadius,
          radius: 1,
          swarmT: 0,
          eliteT: 0,
          waveIdx: 0,
          modT: 0,
          tele: 0,
          warnLeft: 0,
        };
        this.metinObjs.set(m.id, o);
      }
      o.x = m.x;
      o.z = m.z;
      o.phase = m.phase as MetinPhase;
      o.phaseT = m.phaseT + dt;
      o.hpFrac = m.hpFrac;
      o.scale = m.scale;
      o.great = m.great;
      o.auraRadius = m.auraRadius;
      o.warnLeft = Math.max(0, m.warnLeft - dt);
      w.metins.push(o);
    }
    if (this.metinObjs.size > seen.size) for (const id of [...this.metinObjs.keys()]) if (!seen.has(id)) this.metinObjs.delete(id);
  }

  private syncPlayers(A: SnapshotFrame): void {
    const w = this.world;
    const B = this.B;
    const f = this.f;
    const lf = this.latest as SnapshotFrame;
    for (let i = 0; i < w.players.length; i++) {
      const p = w.players[i];
      const h = this.hostOfLocal[i] as number;
      const wa = A.players[h];
      if (!p || !wa) continue;
      p.px = p.x;
      p.pz = p.z;
      p.prot = p.rot;
      const wb = B?.players[h];
      const local = i === 0;
      const ws: PlayerWire = local ? (lf.players[h] ?? wa) : wa;
      if (local && this.predictor.ready && ws.alive) {
        p.x = this.predictor.renderX;
        p.z = this.predictor.renderZ;
        p.rot = this.predictor.state.rot;
        p.speed = this.predictor.state.speed;
      } else if (wb && f > 0 && Math.abs(wb.x - wa.x) < TELEPORT && Math.abs(wb.z - wa.z) < TELEPORT) {
        p.x = lerp(wa.x, wb.x, f);
        p.z = lerp(wa.z, wb.z, f);
        p.rot = lerpAngle(wa.rot, wb.rot, f);
        p.speed = Math.hypot(wa.vx, wa.vz);
      } else {
        p.x = wa.x;
        p.z = wa.z;
        p.rot = wa.rot;
        p.speed = Math.hypot(wa.vx, wa.vz);
      }
      if (this.pInit[i] === 0) {
        this.pInit[i] = 1;
        p.px = p.x;
        p.pz = p.z;
        p.prot = p.rot;
      }
      p.alive = ws.alive;
      p.hp = ws.hp;
      p.hpMax = ws.hpMax;
      p.shield = ws.shield;
      p.level = ws.level;
      p.xp = ws.xp;
      p.xpNext = ws.xpNext;
      p.yeop = ws.yeop;
      p.shards = ws.shards;
      p.kills = ws.kills;
      p.corrupted = wa.corrupted;
      p.dashT = ws.dashT;
      p.vx = ws.vx;
      p.vz = ws.vz;
      let clip = HERO_CLIPS[ws.clip] ?? 'idle';
      if (local && (clip === 'idle' || clip === 'run')) clip = p.speed > 0.4 ? 'run' : 'idle';
      if (clip !== p.clip) {
        p.clip = clip;
        p.clipT = 0;
      } else {
        p.clipT += DT;
      }
      if (p.flash > 0) p.flash = Math.max(0, p.flash - DT * 4);
    }
  }

  // ---- hud / results -------------------------------------------------------------------------------------------------------

  buildHud(player: number): HudSnapshot {
    const w = this.world;
    const p = w.players[player] ?? w.players[0];
    const h = this.hostOfLocal[player] ?? 0;
    const lf = this.latest;
    const wp = lf?.players[h];
    const hp = this.hudCache?.players[h];
    const ix = w.ix;
    const skills = (hp?.skills ?? []).map((s, k) => ({
      id: s.id,
      icon: ix.skills.get(s.id)?.icon ?? '',
      rank: s.rank,
      cooldown: wp && hp && wp.hudVer === hp.ver ? (wp.cds[k] ?? 0) : 0,
      // only the fraction travels (the host's cooldown modifiers are not mirrored): no number, the wedge still shows it
      cdLeft: 0,
      basic: s.basic,
      awakened: s.rank >= MAX_SKILL_RANK,
    }));
    const passives = (hp?.passives ?? []).map((x) => {
      const d = ix.passives.get(x.id);
      return { id: x.id, icon: d?.icon ?? '', rank: x.rank, maxRank: d?.maxRank ?? x.rank };
    });
    const stones = (hp?.stones ?? [null, null, null, null, null, null]).map((s) => (s ? { id: s.id, icon: ix.stones.get(s.id)?.icon ?? '', level: s.level } : null));
    const trinkets = (hp?.trinkets ?? [null, null, null]).map((t) => (t ? { id: t.id, icon: ix.trinkets.get(t.id)?.icon ?? '', rank: t.rank } : null));
    const nb = this.hudCache?.nextBoss;
    const bw = lf?.bosses[0];
    const runEvent = this.runEventView ? runEventHudOf(this.runEventView, w.time, this.runEventView.seenAt) : null;
    const ch = this.channels[player];
    // only the LOCAL hero's own progress (world index 0) reaches this HUD
    const channel = player === 0 && runEvent !== null && ch !== undefined && ch.p > 0 && this.rt - ch.at <= CHANNEL_STALE ? ch.p : undefined;
    const metins: HudSnapshot['metins'] = [];
    for (const m of w.metins) {
      if (m.phase === MetinPhase.Alive || m.phase === MetinPhase.Awakened || m.phase === MetinPhase.Falling) {
        metins.push({ id: m.id, x: m.x, z: m.z, awakened: m.phase === MetinPhase.Awakened, hpFrac: m.hpFrac, rune: m.def.rune });
      }
    }
    const out: HudSnapshot = {
      time: w.time,
      player,
      hp: p?.hp ?? 0,
      hpMax: p?.hpMax ?? 1,
      shield: p?.shield ?? 0,
      level: p?.level ?? 1,
      xp: p?.xp ?? 0,
      xpNext: p?.xpNext ?? 1,
      yeop: p?.yeop ?? 0,
      shards: p?.shards ?? 0,
      kills: p?.kills ?? 0,
      corruption: w.corruption,
      alive: p?.alive ?? true,
      skills,
      passives,
      stones,
      trinkets,
      rerolls: hp?.rerolls ?? 0,
      banishes: hp?.banishes ?? 0,
      skips: hp?.skips ?? 0,
      nextBoss: nb ? { at: nb.at, in: Math.max(0, nb.at - w.time), id: nb.id } : null,
      boss: bw ? { id: bw.bossId, hp: bw.hp, hpMax: bw.hpMax, phase: bw.phase, enraged: bw.enraged, final: bw.final, x: bw.x, z: bw.z } : null,
      metins,
      darkness: w.darkness,
      px: p?.x ?? 0,
      pz: p?.z ?? 0,
      dmg: hp?.dmg ?? [],
      dps: this.hudCache?.dps ?? 0,
    };
    if (runEvent !== null) out.runEvent = runEvent;
    if (channel !== undefined) out.channel = channel;
    return out;
  }

  /** the local hero's run result: the host's final one, else the last checkpoint patched with what we saw */
  personalResult(victory: boolean): RunResult {
    if (this.finalResult) return this.finalResult;
    const w = this.world;
    const cfg = w.config;
    const lf = this.latest;
    const me = lf?.players[this.hostOfLocal[0] as number];
    const base: RunResult =
      this.ckpt ??
      ({
        victory,
        time: 0,
        kills: 0,
        elitesKilled: 0,
        level: 1,
        yeop: 0,
        yeopLeft: 0,
        shards: 0,
        metinsBroken: 0,
        metinTypesBroken: [],
        metinsAwakened: 0,
        bossesKilled: [],
        chestsOpened: 0,
        maxCorruption: w.maxCorruption,
        damageTaken: 0,
        damageDealt: 0,
        damageBySkill: [],
        zone: cfg.zone,
        difficulty: cfg.difficulty,
        classId: cfg.classId,
        doctrine: cfg.doctrine,
        seed: cfg.seed,
        talentXp: 0,
        runOptions: { ...DEFAULT_RUN_OPTIONS },
        rewardMul: 1,
        players: w.players.map((_, i) => ({ index: i, level: 1, kills: 0, yeop: 0, alive: true })),
      } satisfies RunResult);
    return {
      ...base,
      victory,
      time: Math.max(base.time, this.rt),
      level: Math.max(base.level, me?.level ?? 1),
      kills: Math.max(base.kills, me?.kills ?? 0),
      yeopLeft: me ? me.yeop : base.yeopLeft,
      shards: me ? Math.max(base.shards, me.shards) : base.shards,
    };
  }

  /** the run is over for this client (final snapshot, host left, connection lost) */
  finalize(why: 'ended' | 'hostLeft' | 'disconnected'): void {
    const w = this.world;
    if (w.over) return;
    w.over = true;
    this.hostPaused = false;
    const res = this.finalResult ?? this.personalResult(false);
    w.victory = res.victory;
    w.result = res;
    this.phase = why === 'ended' ? 'ended' : why;
    this.offers.clear();
    this.confirmed.clear();
    this.runEndModal = null;
    this.rebuildModals();
    openRunEnd(w, res);
    // openRunEnd pushes for players[0] (the local hero) — exactly what the guest UI needs
    this.runEndModal = w.modals.find((m) => m.kind === 'runEnd') ?? null;
    this.emitStatus(true);
  }

  // ---- status ------------------------------------------------------------------------------------------------------------

  status(): CoopStatus {
    const lf = this.latest;
    const pending: CoopStatus['pendingPicks'] = [];
    if (lf) {
      for (const m of lf.modals) {
        const li = this.localOfHost[m.player] ?? 0;
        pending.push({ name: this.names[li] ?? `P${li + 1}`, waited: m.waited, left: Math.max(0, 20 - m.waited) });
      }
    }
    return {
      role: 'guest',
      phase: this.phase,
      players: this.names.map((name, i) => ({
        name,
        slot: this.order[i] ?? this.mySlot,
        connected: lf?.players[this.hostOfLocal[i] as number]?.connected ?? true,
        local: i === 0,
        ready: true,
      })),
      pendingPicks: pending,
      hostPaused: this.hostPaused,
      pingMs: this.wire.latencyMs,
    };
  }

  private emitStatus(force: boolean): void {
    if (!this.onStatus) return;
    const s = this.status();
    const key = JSON.stringify(s);
    if (!force && key === this.lastStatus) return;
    this.lastStatus = key;
    this.onStatus(s);
  }

  /** average downstream rate (kbit/s) */
  get kbps(): number {
    const s = this.stats;
    return s.seconds > 0 ? (s.bytes * 8) / 1000 / s.seconds : 0;
  }
}
