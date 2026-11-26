// Host side of a co-op run. `CoopHostWorld` IS a sim `World` (players[0] = the host, guests follow in slot order) whose
// `step()` also does the networking: apply the guests' held inputs and card answers, step the sim, collect the events,
// and every `SNAPSHOT_EVERY_TICKS`-th call broadcast a snapshot. Because the world drives itself, the engine's run loop
// needs no co-op specific code on the host: it keeps calling `world.step(inputs)` with the local hero's input.
//
// Host rules (documented behaviour, see ./index.ts):
//   * the sim pauses while ANY hero has a pending card modal (sim feature); each hero answers its own modal, 20 s auto-pick
//   * a guest that drops keeps its hero for RECONNECT_GRACE_SEC (idle, invulnerable); after that the hero dies
//   * the run ends for everybody when the last hero dies, the final boss falls, or the HOST leaves (host migration is not
//     supported: the relay moves the host seat, every client then finishes with its last personal result checkpoint)

import { COOP_BTN_ATTACK, COOP_BTN_CAST_MASK, COOP_BTN_MANUAL, type JsonValue, type ServerMessage, type Slot } from '@ms/shared';
import { openRunEnd } from '../../sim/cards';
import { refreshRunEvent } from '../../sim/runEvents';
import type { RunConfig, RunResult } from '../../sim/run';
import type { ModalRequest } from '../../sim/types';
import type { PlayerInput } from '../../sim/stores';
import { World } from '../../sim/world';
import { resolveAffixes, resolveRunEvents, type ContentDB } from '../../data/schema';
import type { WorldEnv } from '../../sim/types';
import { EventCollector, WireStrings } from './events';
import { dqang } from './quant';
import {
  CHECKPOINT_EVERY_SEC,
  EV,
  HUD_EVERY,
  INPUT_STALE_TICKS,
  KEYFRAME_EVERY,
  READY_TIMEOUT_SEC,
  RECONNECT_GRACE_SEC,
  SNAPSHOT_EVERY_TICKS,
  SYNC_VERSION,
  type CoopPhase,
  type CoopStatus,
  type CoopWire,
  type NetStats,
  type PlayerAck,
} from './protocol';
import { buildPlayerResult, encodeResult } from './results';
import { SnapshotEncoder } from './snapshot';

type Of<T extends ServerMessage['t']> = Extract<ServerMessage, { t: T }>;

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const FNV_MASK = 0xffffffffffffffffn;

class ContentDigest {
  private h = FNV_OFFSET;

  private byte(b: number): void {
    this.h = ((this.h ^ BigInt(b & 0xff)) * FNV_PRIME) & FNV_MASK;
  }

  private u32(v: number): void {
    const n = v >>> 0;
    this.byte(n & 0xff);
    this.byte((n >>> 8) & 0xff);
    this.byte((n >>> 16) & 0xff);
    this.byte((n >>> 24) & 0xff);
  }

  private strRaw(s: string): void {
    this.u32(s.length);
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      this.byte(c & 0xff);
      if (c > 0xff) this.byte(c >>> 8);
    }
  }

  feed(v: unknown): void {
    if (v === null || v === undefined) {
      this.byte(0);
      return;
    }
    const t = typeof v;
    if (t === 'boolean') {
      this.byte(v ? 1 : 2);
      return;
    }
    if (t === 'number') {
      this.byte(3);
      const n = Object.is(v, -0) ? 0 : (v as number);
      this.strRaw(Number.isFinite(n) ? String(n) : 'NaN');
      return;
    }
    if (t === 'string') {
      this.byte(4);
      this.strRaw(v as string);
      return;
    }
    if (Array.isArray(v)) {
      this.byte(5);
      this.u32(v.length);
      for (let i = 0; i < v.length; i++) this.feed(v[i]);
      this.byte(0x5d);
      return;
    }
    if (t === 'object') {
      this.byte(6);
      const rec = v as Record<string, unknown>;
      const keys = Object.keys(rec)
        .filter((k) => rec[k] !== undefined)
        .sort();
      this.u32(keys.length);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i] as string;
        this.strRaw(k);
        this.feed(rec[k]);
      }
      this.byte(0x7d);
      return;
    }
    this.byte(7);
    this.strRaw(String(v));
  }

  hex(): string {
    return this.h.toString(16).padStart(16, '0');
  }
}

/** Semantic content digest both sides must agree on (same build -> same tables, indexes, stats, terrain and rules). */
export function contentFingerprint(content: ContentDB, zone: string): string {
  const d = new ContentDigest();
  const z = content.zones?.find((q) => q.id === zone);
  const enemyShape = (e: ContentDB['enemies'][number]) => ({
    id: e.id,
    model: e.model,
    scale: e.scale,
    tint: e.tint,
    tintMode: e.tintMode,
    race: e.race,
    rank: e.rank,
    level: e.level,
    hp: e.hp,
    damage: e.damage,
    speed: e.speed,
    radius: e.radius,
    mass: e.mass,
    attacks: e.attacks,
    xp: e.xp,
    yeop: e.yeop,
    ai: e.ai,
    resist: e.resist,
  });
  const runEvents = resolveRunEvents(content.runEvents);
  const affixes = resolveAffixes(content.affixes);
  d.feed({
    zone,
    zoneDef: z
      ? {
          id: z.id,
          order: z.order,
          levelRange: z.levelRange,
          biome: z.biome
            ? {
                id: z.biome.id,
                seed: z.biome.seed,
                ground: z.biome.ground,
                trees: z.biome.trees,
                props: z.biome.props,
                water: z.biome.water,
                relief: z.biome.relief,
              }
            : null,
          bands: z.bands,
          bosses: z.bosses,
          final: z.final,
          metins: z.metins,
          gearTier: z.gearTier,
          xpMul: z.xpMul ?? 1,
          hard: z.hard,
        }
      : null,
    enemies: (content.enemies ?? []).map(enemyShape),
    bosses: (content.bosses ?? []).map((b) => ({
      ...enemyShape(b),
      phases: b.phases,
      patterns: b.patterns,
      enrageAfter: b.enrageAfter,
      loot: b.loot,
      escorts: b.escorts,
    })),
    metins: (content.metins ?? []).map((m) => ({
      id: m.id,
      rune: m.rune,
      model: m.model,
      hp: m.hp,
      modifier: m.modifier,
      modParams: m.modParams,
      swarm: m.swarm,
      awakenAfter: m.awakenAfter,
      rewards: m.rewards,
      great: m.great === true,
    })),
    skills: (content.skills ?? []).map((s) => ({
      id: s.id,
      classId: s.classId,
      doctrine: s.doctrine,
      kind: s.kind,
      behavior: s.behavior,
      element: s.element,
      params: s.params,
      upgrades: s.upgrades,
      awakenParams: s.awaken?.params,
      vfx: s.vfx,
      sfx: s.sfx,
      heroClip: s.heroClip,
      unlock: s.unlock,
      trigger: s.trigger,
      role: s.role,
      vigil: s.vigil,
    })),
    passives: (content.passives ?? []).map((p) => ({ id: p.id, perRank: p.perRank, maxRank: p.maxRank })),
    stones: (content.stones ?? []).map((s) => ({ id: s.id, slot: s.slot, perLevel: s.perLevel, maxLevel: s.maxLevel })),
    trinkets: (content.trinkets ?? []).map((t) => ({ id: t.id, slot: t.slot, effect: t.effect, perRank: t.perRank, maxRank: t.maxRank })),
    classes: (content.classes ?? []).map((c) => ({
      id: c.id,
      sexes: c.sexes,
      doctrines: c.doctrines.map((doc) => ({ id: doc.id, basic: doc.basic, starter: doc.starter, skills: doc.skills })),
      base: c.base,
    })),
    empires: (content.empires ?? []).map((e) => ({ id: e.id, bonus: e.bonus, edict: e.edict })),
    balance: content.balance,
    runEvents: { window: runEvents.window, bossGap: runEvents.bossGap, zoneKinds: runEvents.zones[zone] ?? [], kinds: runEvents.kinds },
    affixes,
  });
  return `${zone}.${d.hex()}`;
}

export class CoopHostWorld extends World {
  /** set by `attachHost` */
  host: CoopHost | null = null;
  private readonly merged: PlayerInput[] = [];

  constructor(config: RunConfig, content: ContentDB, env: WorldEnv) {
    super(config, content, config.meta, env);
    for (let i = 0; i < this.players.length; i++) this.merged.push({ moveX: 0, moveZ: 0 });
  }

  /** the host's own UI only ever shows ITS modals (other heroes answer theirs on their machines) */
  override get modal(): ModalRequest | null {
    for (const m of this.modals) if (m.player === 0 || m.kind === 'runEnd') return m;
    return null;
  }

  override step(inputs: readonly PlayerInput[]): void {
    const h = this.host;
    if (!h) {
      super.step(inputs);
      return;
    }
    if (!h.beginTick(inputs[0], this.merged)) {
      this.bus.clear();
      h.idleTick();
      return;
    }
    super.step(this.merged);
    h.endTick();
  }

  /** the host hero's settlement view, not the party's */
  override buildResult(victory: boolean): RunResult {
    return buildPlayerResult(this, victory, 0);
  }

  /** shared by the run-end path and `abort` */
  finalizeResult(victory: boolean): RunResult {
    const res = buildPlayerResult(this, victory, 0);
    this.result = res;
    return res;
  }
}

interface GuestSeat {
  slot: Slot;
  /** world player index */
  index: number;
  name: string;
  connected: boolean;
  dropped: boolean;
  disconnectCall: number;
  ready: boolean;
  /** held input */
  mx: number;
  mz: number;
  manualCast: boolean;
  heldAttack: boolean;
  pendingAttack: boolean;
  pendingCastMask: number;
  aimX: number;
  aimZ: number;
  hasAim: boolean;
  /** active movement ack seq sent to guest (reset to 0 across sync/reconnect) */
  seq: number;
  /** monotonic high-water mark of accepted input seqs (never reset; blocks stale/retransmitted edge replay) */
  lastSeq: number;
  recvSimTick: number;
  lastRecvCall: number;
  hudVer: number;
  /** modal id → signature of the cards the guest has seen */
  announced: Map<number, string>;
}

export interface CoopHostOptions {
  world: CoopHostWorld;
  wire: CoopWire;
  hostSlot: Slot;
  /** guest slots in world order (players 1..n) */
  guestSlots: readonly Slot[];
  /** display names in world order */
  names: readonly string[];
  fingerprint: string;
  now?: () => number;
  snapshotEvery?: number;
  onStatus?: (s: CoopStatus) => void;
}

export class CoopHost {
  readonly world: CoopHostWorld;
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
  readonly strings = new WireStrings();
  readonly collector = new EventCollector(this.strings);
  readonly encoder: SnapshotEncoder;
  phase: CoopPhase = 'waiting';
  finished = false;
  /** the shared sim is frozen by the host (menu / hidden tab); set through `setHostPaused` */
  hostPaused = false;
  /** results per world index once the run ended (host index 0) */
  results: RunResult[] = [];

  private readonly wire: CoopWire;
  private readonly guests: GuestSeat[] = [];
  private readonly hostSlot: Slot;
  private readonly names: readonly string[];
  private readonly fingerprint: string;
  private readonly now: () => number;
  private readonly every: number;
  private readonly onStatus: ((s: CoopStatus) => void) | undefined;
  private readonly offs: (() => void)[] = [];
  private calls = 0;
  private snapN = 0;
  private forceKey = true;
  private started = false;
  private startedAt = 0;
  private timedOut = false;
  private firstWall = 0;
  private lastStatus = '';
  private lastModalCount = 0;
  private readonly hostHudVer = { v: 1 };

  constructor(o: CoopHostOptions) {
    this.world = o.world;
    this.wire = o.wire;
    this.hostSlot = o.hostSlot;
    this.names = o.names;
    this.fingerprint = o.fingerprint;
    this.now = o.now ?? Date.now;
    this.every = o.snapshotEvery ?? SNAPSHOT_EVERY_TICKS;
    this.onStatus = o.onStatus;
    this.encoder = new SnapshotEncoder(o.world, this.strings);
    o.guestSlots.forEach((slot, k) => {
      this.guests.push({
        slot,
        index: k + 1,
        name: this.names[k + 1] ?? `P${k + 2}`,
        connected: true,
        dropped: false,
        disconnectCall: 0,
        ready: false,
        mx: 0,
        mz: 0,
        manualCast: false,
        heldAttack: false,
        pendingAttack: false,
        pendingCastMask: 0,
        aimX: 0,
        aimZ: 0,
        hasAim: false,
        seq: 0,
        lastSeq: 0,
        recvSimTick: 0,
        lastRecvCall: -1e9,
        hudVer: 1,
        announced: new Map(),
      });
    });
    o.world.host = this;
    const w = this.wire;
    this.offs.push(
      w.on('input', (m) => this.onInput(m)),
      w.on('pick', (m) => this.onPick(m)),
      w.on('event', (m) => this.handleEvent(m)),
      w.on('roomState', (m) => this.onRoomState(m)),
      w.on('hello', () => this.checkSeat()),
      w.on('close', (c) => {
        if (!c.willReconnect && !this.finished) this.abort('disconnected');
      }),
    );
  }

  get guestCount(): number {
    return this.guests.length;
  }

  /** The host finished loading: from now on the sim waits (bounded) for slow guests. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.startedAt = this.now();
    this.firstWall = this.startedAt;
    this.setPhase(this.waitingNow() ? 'waiting' : 'running');
    this.emitStatus(true);
  }

  private waitingNow(): boolean {
    if (!this.started || this.timedOut) return false;
    if (this.now() - this.startedAt > READY_TIMEOUT_SEC * 1000) {
      this.timedOut = true;
      return false;
    }
    return this.guests.some((g) => !g.ready && !g.dropped);
  }

  get waiting(): boolean {
    return this.waitingNow();
  }

  setHostPaused(p: boolean): void {
    if (this.hostPaused === p) return;
    this.hostPaused = p;
    if (p) this.wire.pause('host');
    else this.wire.resume();
    this.emitStatus(true);
  }

  // ---- per tick ---------------------------------------------------------------------------------------------------------

  /** builds the per-player input array; false while the sim must not advance (guests still loading) */
  beginTick(local: PlayerInput | undefined, merged: PlayerInput[]): boolean {
    this.calls++;
    if (this.finished) return true;
    if (this.waitingNow()) {
      this.setPhase('waiting');
      return false;
    }
    if (this.phase === 'waiting') this.setPhase('running');
    const l = merged[0] as PlayerInput;
    l.moveX = local?.moveX ?? 0;
    l.moveZ = local?.moveZ ?? 0;
    l.manualCast = local?.manualCast;
    l.attack = local?.attack;
    l.castMask = local?.castMask;
    l.aimX = local?.aimX;
    l.aimZ = local?.aimZ;
    const world = this.world;
    for (const g of this.guests) {
      const p = merged[g.index] as PlayerInput;
      const pl = world.players[g.index];
      if (!g.connected && !g.dropped) {
        if (this.calls - g.disconnectCall > RECONNECT_GRACE_SEC * 60) this.dropSeat(g);
        else if (pl && pl.alive && pl.iframes < 0.5) pl.iframes = 0.5; // ghosted while the connection comes back
      }
      if (g.connected && !g.dropped && this.calls - g.lastRecvCall <= INPUT_STALE_TICKS) {
        p.moveX = g.mx;
        p.moveZ = g.mz;
        p.manualCast = g.manualCast;
        p.attack = g.heldAttack || g.pendingAttack;
        p.castMask = g.pendingCastMask;
        p.aimX = g.hasAim ? g.aimX : undefined;
        p.aimZ = g.hasAim ? g.aimZ : undefined;
        g.pendingAttack = false;
        g.pendingCastMask = 0;
      } else {
        p.moveX = 0;
        p.moveZ = 0;
        p.manualCast = g.manualCast;
        p.attack = false;
        p.castMask = 0;
        p.aimX = undefined;
        p.aimZ = undefined;
        g.heldAttack = false;
        g.pendingAttack = false;
        g.pendingCastMask = 0;
      }
    }
    return true;
  }

  /** the sim could not tick (waiting for guests): keep the link alive */
  idleTick(): void {
    if (this.calls % (this.every * 3) === 0) this.sendSnapshot(false);
    if (this.calls % 60 === 0) this.emitStatus(false);
  }

  endTick(): void {
    if (this.finished) return;
    const world = this.world;
    this.collector.collect(world.events);
    const picked = this.collector.takeCardPicks();
    if (picked !== 0) {
      this.hostHudVer.v++;
      for (const g of this.guests) if ((picked & (1 << g.index)) !== 0) g.hudVer++;
    }
    this.announceModals();
    if (world.over) {
      this.finish();
      return;
    }
    if (this.calls % this.every === 0) this.sendSnapshot(false);
    if (this.calls % (CHECKPOINT_EVERY_SEC * 60) === 0) this.sendCheckpoints();
    const modalCount = world.modals.length;
    if (modalCount !== this.lastModalCount) {
      this.lastModalCount = modalCount;
      this.emitStatus(false);
    } else if (this.calls % 60 === 0) {
      this.emitStatus(false);
    }
  }

  // ---- snapshots ---------------------------------------------------------------------------------------------------------

  private acks(): PlayerAck[] {
    const world = this.world;
    const out: PlayerAck[] = [{ seq: 0, age: 0, connected: true, hudVer: this.hostHudVer.v }];
    for (const g of this.guests) {
      out.push({ seq: g.seq, age: Math.max(0, world.tick - g.recvSimTick), connected: g.connected && !g.dropped, hudVer: g.hudVer });
    }
    return out;
  }

  private sendSnapshot(final: boolean): void {
    const world = this.world;
    const keyframe = this.forceKey || this.snapN % KEYFRAME_EVERY === 0;
    this.forceKey = false;
    const hud = keyframe || this.snapN % HUD_EVERY === 0 || this.collector.hudDirty;
    this.collector.hudDirty = false;
    const events = this.collector.flush();
    const paused = world.modals.length > 0 || this.waitingNow() || this.hostPaused;
    const e = this.encoder.encode({ keyframe, paused, final, acks: this.acks(), hud, events });
    this.snapN++;
    this.wire.sendSnapshot(e.header, e.payload);
    const s = this.stats;
    s.snapshots++;
    if (keyframe) s.keyframes++;
    s.bytes += e.stats.bytes;
    s.maxSnapshotBytes = Math.max(s.maxSnapshotBytes, e.stats.bytes);
    if (!keyframe) s.maxDeltaBytes = Math.max(s.maxDeltaBytes, e.stats.bytes);
    s.eventBytes += e.stats.eventBytes;
    s.droppedEvents += events.dropped;
    s.seconds = (this.now() - this.firstWall) / 1000;
  }

  /** the next snapshot is a keyframe (late join, reconnect) */
  requestKeyframe(): void {
    this.forceKey = true;
    refreshRunEvent(this.world);
  }

  // ---- modals ------------------------------------------------------------------------------------------------------------

  private modalSignature(m: ModalRequest): string {
    return JSON.stringify([m.cards, m.canReroll, m.canBanish, m.canSkip, m.rerolls, m.banishes, m.skips]);
  }

  private sendModal(g: GuestSeat, m: ModalRequest, sig: string): void {
    // the cards go out whole (JSON): every optional Card field (pact / needs / bargain, ...) reaches the guest as is; never pick fields
    // here (net/coop/cardFields.test.ts pins it)
    const body = {
      id: m.id,
      kind: m.kind,
      cards: m.cards,
      canReroll: m.canReroll,
      canBanish: m.canBanish,
      canSkip: m.canSkip,
      rerolls: m.rerolls,
      banishes: m.banishes,
      skips: m.skips,
      level: m.level,
      source: m.source,
      free: m.free,
      awakened: m.awakened,
    };
    g.announced.set(m.id, sig);
    this.wire.event(EV.modal, body as unknown as JsonValue, { to: g.slot });
  }

  private announceModals(): void {
    const world = this.world;
    for (const g of this.guests) {
      if (!g.connected || g.dropped) continue;
      let live = 0;
      for (const m of world.modals) {
        if (m.player !== g.index || m.kind === 'runEnd') continue;
        live++;
        const sig = this.modalSignature(m);
        if (g.announced.get(m.id) !== sig) this.sendModal(g, m, sig);
      }
      if (g.announced.size > live) {
        for (const id of [...g.announced.keys()]) if (!world.modals.some((m) => m.id === id)) g.announced.delete(id);
      }
    }
  }

  private reannounce(g: GuestSeat): void {
    g.announced.clear();
    this.announceModals();
  }

  // ---- incoming ----------------------------------------------------------------------------------------------------------

  private seat(slot: Slot): GuestSeat | undefined {
    return this.guests.find((g) => g.slot === slot);
  }

  private clearGuestInput(g: GuestSeat): void {
    // Reset active movement ack and transient combat latches, but keep `lastSeq` monotonic across sync/reconnect.
    g.seq = 0;
    g.mx = 0;
    g.mz = 0;
    g.heldAttack = false;
    g.pendingAttack = false;
    g.pendingCastMask = 0;
    g.hasAim = false;
  }

  private onInput(m: Of<'input'>): void {
    const g = this.seat(m.slot);
    if (!g || g.dropped) return;
    if (m.seq <= g.lastSeq) return; // out of date (a resent / reordered frame, even across sync or reconnect)
    g.lastSeq = m.seq;
    g.seq = m.seq;
    g.mx = m.mx / 127;
    g.mz = m.mz / 127;
    const btn = m.btn ?? 0;
    g.manualCast = (btn & COOP_BTN_MANUAL) !== 0;
    const attack = (btn & COOP_BTN_ATTACK) !== 0;
    g.heldAttack = attack;
    if (attack) g.pendingAttack = true;
    const castMask = btn & COOP_BTN_CAST_MASK;
    if (castMask !== 0) g.pendingCastMask |= castMask;
    if (m.aim !== undefined) {
      const rad = dqang(m.aim);
      g.aimX = Math.sin(rad);
      g.aimZ = Math.cos(rad);
      g.hasAim = true;
    } else {
      g.hasAim = false;
    }
    g.recvSimTick = this.world.tick;
    g.lastRecvCall = this.calls;
  }

  private onPick(m: Of<'pick'>): void {
    const g = this.seat(m.slot);
    if (!g || g.dropped || this.finished) return;
    const world = this.world;
    const first = world.modals.find((q) => q.player === g.index && q.kind !== 'runEnd');
    if (!first || first.id !== m.id) return;
    world.chooseCard(m.index, g.index);
  }

  /** a guest's `ready` / `sync` / `cmd` event (the session replays the ones that arrived while the host was still loading) */
  handleEvent(m: Of<'event'>): void {
    const g = this.seat(m.from);
    if (!g || g.dropped) return;
    const d = m.d;
    switch (m.k) {
      case EV.ready:
        g.ready = true;
        this.clearGuestInput(g);
        this.sendInit(g);
        this.requestKeyframe();
        this.reannounce(g);
        this.emitStatus(true);
        break;
      case EV.sync:
        this.clearGuestInput(g);
        this.sendInit(g);
        this.requestKeyframe();
        this.reannounce(g);
        break;
      case EV.cmd: {
        if (typeof d !== 'object' || d === null || Array.isArray(d)) return;
        const id = d.id;
        const op = d.op;
        const world = this.world;
        const first = world.modals.find((q) => q.player === g.index && q.kind !== 'runEnd');
        if (!first || first.id !== id) return;
        const index = typeof d.index === 'number' ? d.index : 0;
        let ok = false;
        if (op === 'reroll') ok = world.reroll(g.index);
        else if (op === 'banish') ok = world.banish(index, g.index);
        else if (op === 'skip') ok = world.skip(g.index);
        if (ok) {
          const still = world.modals.find((q) => q.id === first.id);
          if (still) this.sendModal(g, still, this.modalSignature(still));
        }
        break;
      }
      default:
        break;
    }
  }

  private sendInit(g: GuestSeat): void {
    this.wire.event(EV.init, { v: SYNC_VERSION, fp: this.fingerprint }, { to: g.slot });
  }

  private onRoomState(m: Of<'roomState'>): void {
    if (this.checkSeat()) return;
    for (const g of this.guests) {
      if (g.dropped) continue;
      const lp = m.players.find((p) => p.slot === g.slot);
      if (!lp) {
        this.dropSeat(g);
      } else if (lp.connected && !g.connected) {
        g.connected = true;
        this.clearGuestInput(g);
        this.requestKeyframe();
      } else if (!lp.connected && g.connected) {
        g.connected = false;
        g.disconnectCall = this.calls;
        this.clearGuestInput(g);
      }
    }
    this.emitStatus(true);
  }

  /** true when this client is no longer the host (the relay migrated the seat after a disconnect) */
  private checkSeat(): boolean {
    if (this.finished) return true;
    if (this.wire.slot >= 0 && !this.wire.isHost) {
      this.abort('hostLeft');
      return true;
    }
    return false;
  }

  private dropSeat(g: GuestSeat): void {
    if (g.dropped) return;
    g.dropped = true;
    g.connected = false;
    const p = this.world.players[g.index];
    if (p && p.alive) {
      p.alive = false;
      p.hp = 0;
      this.collector.collect([{ t: 'playerDeath', player: g.index, x: p.x, z: p.z }]);
    }
    // dismiss pending card/chest offers belonging to the dropped seat so they never stall the remaining party
    for (let i = this.world.modals.length - 1; i >= 0; i--) {
      const m = this.world.modals[i];
      if (m && m.player === g.index && m.kind !== 'runEnd') this.world.modals.splice(i, 1);
    }
    g.announced.clear();
    this.emitStatus(true);
  }

  // ---- end of run --------------------------------------------------------------------------------------------------------

  private sendCheckpoints(): void {
    const world = this.world;
    for (const g of this.guests) {
      if (!g.connected || g.dropped) continue;
      this.wire.event(EV.ckpt, encodeResult(buildPlayerResult(world, false, g.index)) as unknown as JsonValue, { to: g.slot });
    }
  }

  /** run over: personal results first, then the final snapshot (flag `final`), then the room returns to its lobby */
  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    if (this.hostPaused) {
      this.hostPaused = false;
      this.wire.resume();
    }
    const world = this.world;
    const victory = world.victory;
    this.results = world.players.map((_, i) => buildPlayerResult(world, victory, i));
    world.result = this.results[0] as RunResult;
    for (const m of world.modals) if (m.kind === 'runEnd') m.result = world.result;
    for (const g of this.guests) {
      if (g.dropped) continue;
      this.wire.event(EV.result, encodeResult(this.results[g.index] as RunResult) as unknown as JsonValue, { to: g.slot });
    }
    this.sendSnapshot(true);
    this.setPhase('ended');
    this.wire.end(victory);
    this.emitStatus(true);
  }

  /** the host lost its seat / its connection: end the run locally with the host hero's result */
  abort(reason: 'hostLeft' | 'disconnected'): void {
    if (this.finished) return;
    this.finished = true;
    this.hostPaused = false;
    const world = this.world;
    if (!world.over) {
      world.over = true;
      world.victory = false;
      const res = world.finalizeResult(false);
      openRunEnd(world, res);
    }
    this.setPhase(reason === 'hostLeft' ? 'hostLeft' : 'disconnected');
    this.emitStatus(true);
  }

  dispose(): void {
    // the host walked away mid-run (pause menu → quit): everybody gets their personal result and the room returns to its lobby
    if (!this.finished && this.started && this.wire.isHost) this.finish();
    for (const off of this.offs) off();
    this.offs.length = 0;
    if (this.world.host === this) this.world.host = null;
  }

  // ---- status ------------------------------------------------------------------------------------------------------------

  private setPhase(p: CoopPhase): void {
    this.phase = p;
  }

  status(): CoopStatus {
    const world = this.world;
    const pending: CoopStatus['pendingPicks'] = [];
    for (const m of world.modals) {
      if (m.kind === 'runEnd') continue;
      const name = m.player === 0 ? (this.names[0] ?? 'P1') : (this.guests.find((g) => g.index === m.player)?.name ?? `P${m.player + 1}`);
      pending.push({ name, waited: m.waited, left: Number.isFinite(world.autoPickAfter) ? Math.max(0, world.autoPickAfter - m.waited) : 0 });
    }
    return {
      role: 'host',
      phase: this.phase,
      players: [
        { name: this.names[0] ?? 'P1', slot: this.hostSlot, connected: true, local: true, ready: true },
        ...this.guests.map((g) => ({ name: g.name, slot: g.slot, connected: g.connected && !g.dropped, local: false, ready: g.ready })),
      ],
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

  /** average downstream rate every guest sees (kbit/s) */
  get kbps(): number {
    const s = this.stats;
    return s.seconds > 0 ? (s.bytes * 8) / 1000 / s.seconds : 0;
  }
}
