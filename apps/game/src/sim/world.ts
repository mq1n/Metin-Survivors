// World: owns ALL sim state. `world.step(inputs)` advances one fixed tick (DT) and fills `world.events`.
// No three.js, no DOM, no wall-clock, no Math.random.

import type { BalanceConfig, ContentDB, EnemyDef, MetinDef, TriggerConfig, ZoneDef } from '../data/schema';
import { RARITIES, resolveChest, resolveHardMuls, resolveTriggers, resolveZoneMuls, type Rarity } from '../data/schema';
import { updateBosses, type BossSystem, createBossSystem } from './bosses';
import { chooseCard, rerollOffer, banishCard, skipOffer, tickModalWait } from './cards';
import { type ContentIndex, buildContentIndex, zoneById } from './content';
import { CAP, DEFAULT_ARENA_RADIUS, DT } from './constants';
import { EventBus, type SimEvent } from './events';
import { updateEnemies } from './ai';
import { updateStatuses } from './combat';
import { sweepDead } from './enemies';
import { type MetinSystem, createMetinSystem, updateMetins } from './metins';
import { updatePickups } from './pickups';
import { createPlayer, updatePlayers } from './player';
import { buildResult, updateProgress } from './progress';
import { type RngStreams, createStreams } from './rng';
import { type RunEventRun, createRunEvent, updateRunEvent } from './runEvents';
import { runScheduled, Scheduler } from './scheduler';
import { updateSkills } from './skills';
import { updateProjectiles } from './skills/projectiles';
import { updateZones } from './skills/zones';
import { SpatialHash } from './spatial';
import { type SpawnerState, createSpawner, updateSpawner } from './spawner';
import { Interner } from './strings';
import {
  EnemyStore,
  PickupStore,
  PlayerState,
  type SkillInstance,
  type PlayerInput,
  ProjectileStore,
  TelegraphStore,
  ZoneStore,
} from './stores';
import { updateTelegraphs } from './telegraph';
import type { BossState, HudSnapshot, MetinState, ModalRequest, WorldEnv } from './types';
import { clampRunOptions, DEFAULT_RUN_OPTIONS, runOptionsReward, runOptionsTable } from './run';
import type { CoopPlayerInit, MetaBonuses, RunConfig, RunOptions, RunResult } from './run';
import { hud as buildHud } from './hud';

/** run-wide counters feeding RunResult */
export interface RunTally {
  kills: number;
  elitesKilled: number;
  bossesKilled: string[];
  metinsBroken: number;
  metinsAwakened: number;
  metinIds: string[];
  chestsOpened: number;
  damageDealt: number;
  damageTaken: number;
}

export interface DifficultyMods {
  hp: number;
  damage: number;
  count: number;
  reward: number;
}

/**
 * Run modifiers (RS-01): the few multipliers that zone data, the difficulty and run events share, applied in ONE place.
 * Every field is 1 (eliteDrop: the base chest chance) when nothing changes it, so default content plays exactly as before.
 * Readers (all in sim/): pickups.ts `xp` / `yeop` / `eliteDrop` (dropLoot), spawner.ts `eliteEvery`, metins.ts `awaken`,
 * bosses.ts `finalHp` / `finalEnrage`. Sim-only state: the effects reach co-op guests through the pickups, enemies and events
 * the host already mirrors; nothing in render or the HUD reads it.
 */
export interface RunMods {
  /** x the xp value of a gem dropped by a dead creature (zone.xpMul) */
  xp: number;
  /** x the yeop amount a dead creature drops */
  yeop: number;
  /** chance that an elite (tier 1-2) drops a chest: balance.chest.eliteDrop (0.12 = the shipped game) x event factors */
  eliteDrop: number;
  /** x the interval between elites (< 1 = more elites). hard: balance.hard / zone.hard `eliteEveryMul` */
  eliteEvery: number;
  /** x the time a metin stands before it awakens (< 1 = sooner). hard: `awakenMul` */
  awaken: number;
  /** x the HP of the FINAL boss only (zone.final.hpMul) */
  finalHp: number;
  /** x the interval between the final boss's rage stacks (< 1 = sooner). hard: `finalEnrageMul` */
  finalEnrage: number;
}

export const RUN_MOD_KEYS: readonly (keyof RunMods)[] = ['xp', 'yeop', 'eliteDrop', 'eliteEvery', 'awaken', 'finalHp', 'finalEnrage'];

/** event factors are clamped into this range so a data typo cannot stall or flood the sim (eliteDrop may be 0) */
export const EVENT_MOD_MIN = 0.05;
export const EVENT_MOD_MAX = 20;

export const MAX_BAITS = 32;
export const CORPSE_RING = 16;

/**
 * Lure points (DESIGN M5): creature MOVEMENT is pulled toward the nearest bait whose radius covers it, instead of toward the
 * hero (attack choice and range still use the hero). Bosses ignore baits; elites use half the radius (AI side, WP1).
 * Entries keep their add order (deterministic); a producer re-adding the same non-zero `key` refreshes the entry in place.
 * `key` is a uint32 chosen by the producer: a companion row handle, or `0x80000000 | skillSlot` for a cast-point bait.
 */
export class BaitList {
  count = 0;
  readonly x = new Float32Array(MAX_BAITS);
  readonly z = new Float32Array(MAX_BAITS);
  /** pull radius (m) */
  readonly r = new Float32Array(MAX_BAITS);
  /** seconds left */
  readonly left = new Float32Array(MAX_BAITS);
  readonly key = new Uint32Array(MAX_BAITS);

  /** false when the list is full (the new bait is dropped) */
  add(x: number, z: number, r: number, left: number, key: number): boolean {
    if (key !== 0) {
      for (let i = 0; i < this.count; i++) {
        if (this.key[i] !== key) continue;
        this.x[i] = x;
        this.z[i] = z;
        this.r[i] = r;
        this.left[i] = left;
        return true;
      }
    }
    if (this.count >= MAX_BAITS) return false;
    const i = this.count++;
    this.x[i] = x;
    this.z[i] = z;
    this.r[i] = r;
    this.left[i] = left;
    this.key[i] = key;
    return true;
  }

  /** age every entry by `dt`; expired entries are removed keeping the order of the rest */
  tick(dt: number): void {
    if (this.count === 0) return;
    let n = 0;
    for (let i = 0; i < this.count; i++) {
      const left = (this.left[i] as number) - dt;
      if (left <= 0) continue;
      if (n !== i) {
        this.x[n] = this.x[i] as number;
        this.z[n] = this.z[i] as number;
        this.r[n] = this.r[i] as number;
        this.key[n] = this.key[i] as number;
      }
      this.left[n] = left;
      n++;
    }
    this.count = n;
  }

  /** index of the nearest bait whose radius x `rScale` covers (x, z); ties go to the lower index; -1 = none */
  nearest(x: number, z: number, rScale = 1): number {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < this.count; i++) {
      const dx = (this.x[i] as number) - x;
      const dz = (this.z[i] as number) - z;
      const d = dx * dx + dz * dz;
      const rr = (this.r[i] as number) * rScale;
      if (d <= rr * rr && d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  clear(): void {
    this.count = 0;
  }
}

/**
 * The last CORPSE_RING kill positions (DESIGN M3 kill hook; Cursed Legion raises knights from them). Index 0 of `at(k)` is the
 * newest. Written by skills/hooks.ts onKill (WP1); read by the knight brain (WP2).
 */
export class CorpseRing {
  /** valid entries, <= CORPSE_RING */
  count = 0;
  /** next write slot */
  head = 0;
  readonly x = new Float32Array(CORPSE_RING);
  readonly z = new Float32Array(CORPSE_RING);
  /** sim time of the kill */
  readonly t = new Float64Array(CORPSE_RING);
  /** killer player index */
  readonly owner = new Uint8Array(CORPSE_RING);

  push(x: number, z: number, t: number, owner: number): void {
    const i = this.head;
    this.x[i] = x;
    this.z[i] = z;
    this.t[i] = t;
    this.owner[i] = owner;
    this.head = (i + 1) % CORPSE_RING;
    if (this.count < CORPSE_RING) this.count++;
  }

  /** storage index of the k-th newest entry (0 = newest, k < count) */
  at(k: number): number {
    return (this.head - 1 - k + 2 * CORPSE_RING) % CORPSE_RING;
  }

  clear(): void {
    this.count = 0;
    this.head = 0;
  }
}

export class World {
  readonly content: ContentDB;
  readonly config: RunConfig;
  readonly zone: ZoneDef;
  readonly balance: BalanceConfig;
  readonly ix: ContentIndex;
  readonly env: WorldEnv;
  readonly arenaRadius: number;
  readonly rng: RngStreams;
  /** interned vfx/style names referenced by store `style`/`preset` ids */
  readonly strings = new Interner();
  readonly bus = new EventBus();

  readonly enemies = new EnemyStore();
  readonly projectiles = new ProjectileStore();
  readonly pickups = new PickupStore();
  readonly zones = new ZoneStore();
  readonly telegraphs = new TelegraphStore();
  readonly hash: SpatialHash;

  /** index 0 = local player */
  readonly players: PlayerState[] = [];
  /** EnemyStore.type indexes this (creatures, then bosses) */
  readonly typeDefs: EnemyDef[];
  /** MetinState.type / metin-row `ref` indexes this */
  readonly metinDefs: MetinDef[];
  /** every metin that is falling, standing, or shattering */
  readonly metins: MetinState[] = [];
  /** every boss that is alive (or dying this tick) */
  readonly bosses: BossState[] = [];
  /** enemy type indexes used by this zone (bands, elites, swarms, bosses) for asset preloading */
  readonly usedTypes: number[] = [];

  /** sim seconds (not advanced while a modal is open) */
  time = 0;
  tick = 0;
  /** 0..1 */
  corruption = 0;
  maxCorruption = 0;
  /** 0..1 screen darkening from a Black metin (render) */
  darkness = 0;
  over = false;
  victory = false;
  result: RunResult | null = null;
  /** seconds until the end modal opens after victory/defeat */
  endTimer = -1;
  endVictory = false;

  /** pending modal requests; the first is the one the UI shows. The sim is frozen while non-empty. */
  readonly modals: ModalRequest[] = [];
  nextModalId = 1;

  readonly diff: DifficultyMods;
  /**
   * run modifiers (RunMods): the zone / difficulty base x every active event factor. Read it; change it only through
   * `setEventMods` / `clearEventMods`.
   */
  readonly mods: Readonly<RunMods>;
  /** the run's own modifiers before any event: zone data, balance.chest and (on hard only) the hard multipliers */
  private readonly modsBase: Readonly<RunMods>;
  /** event id -> factors, in the order they were first set (Map order: deterministic) */
  private readonly eventMods = new Map<string, Partial<RunMods>>();
  /** the Run Options sliders in effect (clamped); `options.speed` scales enemy / boss movement and projectile speed */
  readonly options: RunOptions;
  /** damage-dealt samples every 0.5 s (ring) for the dps readout */
  private readonly dmgRing = new Float64Array(11);
  private dmgCount = 0;
  readonly tally: RunTally = {
    kills: 0,
    elitesKilled: 0,
    bossesKilled: [],
    metinsBroken: 0,
    metinsAwakened: 0,
    metinIds: [],
    chestsOpened: 0,
    damageDealt: 0,
    damageTaken: 0,
  };

  readonly sched = new Scheduler();
  readonly spawner: SpawnerState;
  readonly metinSys: MetinSystem;
  readonly bossSys: BossSystem;
  /**
   * The run's one set-piece event (sim/runEvents.ts, RS-02a), scheduled at createWorld; null = this run has none, which is every
   * run of the shipped content (`runEvents.zones` is empty). Host-authoritative: guests get it as mirrored 'runEvent' events.
   */
  readonly runEvent: RunEventRun | null;

  /** shared query result buffers (systems must not hold them across calls into other systems) */
  readonly qa = new Int32Array(CAP.enemies);
  readonly qb = new Int32Array(CAP.enemies);
  readonly qn = new Int32Array(64);

  /** co-op auto-pick timer for modals (seconds); Infinity in single player */
  autoPickAfter = Infinity;
  /** every skill instance of every player, indexed by its global slot */
  readonly skillSlots: SkillInstance[] = [];
  /** live XP gem pickups (merge beyond the soft cap) */
  xpGems = 0;
  mergeCursor = 0;
  /** suppress loot while the field collapses on final victory */
  noLoot = false;

  /** context-trigger thresholds and caps: balance.triggers over the in-code defaults */
  readonly trig: TriggerConfig;
  /** lure points (creature movement pulls toward them); empty unless a skill adds one */
  readonly baits = new BaitList();
  /** recent kill positions (Cursed Legion) */
  readonly corpses = new CorpseRing();
  /**
   * TEST / QA ONLY: every trigger gate reads open, so context-gated skills still auto-cast on their plain cooldown
   * (tools/qa/shot.ts --cast / --castStep, the shippedScale lab). Never set by the game.
   */
  qaForceTriggers = false;

  constructor(config: RunConfig, content: ContentDB, meta: MetaBonuses = config.meta, env: WorldEnv = {}) {
    this.config = config;
    this.content = content;
    this.balance = content.balance;
    this.trig = resolveTriggers(content.balance.triggers);
    this.zone = zoneById(content, config.zone);
    this.ix = buildContentIndex(content);
    this.typeDefs = this.ix.typeDefs;
    this.metinDefs = this.ix.metinDefs;
    this.env = env;
    this.arenaRadius = env.arenaRadius ?? DEFAULT_ARENA_RADIUS;
    this.rng = createStreams(config.seed);
    this.hash = new SpatialHash(this.arenaRadius, CAP.enemies);
    const hard = config.difficulty === 'hard' ? content.balance.hard : { hp: 1, damage: 1, count: 1, reward: 1 };
    const table = config.runOptions ? runOptionsTable(content.balance) : null;
    this.options = table ? clampRunOptions(config.runOptions, table) : { ...DEFAULT_RUN_OPTIONS };
    const optionsReward = table ? runOptionsReward(this.options, table) : 1;
    // the sliders fold into the difficulty multipliers: hp / damage / spawn count / reward
    this.diff = {
      hp: hard.hp * this.options.health,
      damage: hard.damage * this.options.damage,
      count: hard.count * this.options.density,
      reward: hard.reward * optionsReward,
    };
    // run modifiers: the hard multipliers (zone override first) only apply on hard; everything is 1 (eliteDrop 0.12) by default
    const isHard = config.difficulty === 'hard';
    const hardMuls = resolveHardMuls(content.balance, this.zone);
    const zoneMuls = resolveZoneMuls(this.zone);
    this.modsBase = {
      xp: zoneMuls.xp,
      yeop: 1,
      eliteDrop: resolveChest(content.balance).eliteDrop,
      eliteEvery: isHard ? hardMuls.eliteEveryMul : 1,
      awaken: isHard ? hardMuls.awakenMul : 1,
      finalHp: zoneMuls.finalHp,
      finalEnrage: isHard ? hardMuls.finalEnrageMul : 1,
    };
    this.mods = { ...this.modsBase };

    // players
    const inits: CoopPlayerInit[] = [
      { classId: config.classId, doctrine: config.doctrine, sex: config.sex, empire: config.empire, meta },
      ...(config.coop ?? []),
    ];
    inits.forEach((init, i) => this.players.push(createPlayer(this, i, init)));
    if (this.players.length > 1) this.autoPickAfter = 20;

    this.collectUsedTypes();
    this.spawner = createSpawner(this);
    this.metinSys = createMetinSystem(this);
    this.bossSys = createBossSystem(this);
    // after the other systems' setup; draws from rng.spawn ONLY when the zone lists events (two draws), else nothing
    this.runEvent = createRunEvent(this);
    // opening cards for a talent start level
    for (const p of this.players) if (p.pendingLevels > 0) updateProgress(this);
    this.bus.story('zoneIntro', this.zone.id);
  }

  /** events emitted by out-of-step `chooseCard()` calls waiting to be surfaced on the next `step()` */
  private readonly pendingCardEvents: SimEvent[] = [];

  /** the event list of the last `step` (cleared at the start of each step; do not retain objects) */
  get events(): SimEvent[] {
    return this.bus.list;
  }

  /** currently displayed modal (first pending request) or null */
  get modal(): ModalRequest | null {
    return this.modals[0] ?? null;
  }

  /** advance one fixed tick. While a modal is pending only the auto-pick timer runs. */
  step(inputs: readonly PlayerInput[]): void {
    this.bus.clear();
    if (this.pendingCardEvents.length > 0) {
      this.bus.replay(this.pendingCardEvents);
      this.pendingCardEvents.length = 0;
    }
    if (this.over) return;
    if (this.modals.length > 0) {
      tickModalWait(this);
      return;
    }
    this.time += DT;
    this.tick++;
    this.baits.tick(DT);
    updatePlayers(this, inputs);
    this.hash.rebuild(this.enemies);
    updateSkills(this);
    runScheduled(this);
    updateProjectiles(this);
    updateZones(this);
    updateEnemies(this);
    updateStatuses(this);
    updateTelegraphs(this);
    updateBosses(this);
    updateMetins(this);
    updateSpawner(this);
    updateRunEvent(this);
    updatePickups(this);
    sweepDead(this);
    updateProgress(this);
    if (this.tick % 30 === 0) this.dmgRing[this.dmgCount++ % this.dmgRing.length] = this.tally.damageDealt;
  }

  // ---- UI answers --------------------------------------------------------

  /** pick card `index` of the first modal belonging to `player` */
  chooseCard(index: number, player = 0): boolean {
    const before = this.bus.list.length;
    const ok = chooseCard(this, player, index);
    if (ok) {
      for (let i = before; i < this.bus.list.length; i++) {
        this.pendingCardEvents.push({ ...(this.bus.list[i] as SimEvent) });
      }
    }
    return ok;
  }
  reroll(player = 0): boolean {
    return rerollOffer(this, player);
  }
  banish(index: number, player = 0): boolean {
    return banishCard(this, player, index);
  }
  skip(player = 0): boolean {
    return skipOffer(this, player);
  }

  // ---- run modifiers -------------------------------------------------------

  /**
   * Apply an event's factors to `w.mods` (each key multiplies the base; factors of different events stack, setting the same
   * `id` again replaces its factors). Factors are clamped to [EVENT_MOD_MIN, EVENT_MOD_MAX] (eliteDrop may be 0); a
   * non-finite factor is ignored. Call `clearEventMods(id)` when the event ends.
   */
  setEventMods(id: string, factors: Partial<RunMods>): void {
    const clean: Partial<RunMods> = {};
    for (const k of RUN_MOD_KEYS) {
      const v = factors[k];
      if (v === undefined || !Number.isFinite(v)) continue;
      clean[k] = Math.min(EVENT_MOD_MAX, Math.max(k === 'eliteDrop' ? 0 : EVENT_MOD_MIN, v));
    }
    this.eventMods.set(id, clean);
    this.recomputeMods();
  }

  /** remove the factors `setEventMods(id, ...)` added (no-op for an unknown id) */
  clearEventMods(id: string): void {
    if (this.eventMods.delete(id)) this.recomputeMods();
  }

  /** is `id` currently applying factors? */
  hasEventMods(id: string): boolean {
    return this.eventMods.has(id);
  }

  /** mods = base x the product of every active event's factor (no events: exactly the base) */
  private recomputeMods(): void {
    const out = this.mods as RunMods;
    for (const k of RUN_MOD_KEYS) {
      let v = this.modsBase[k];
      for (const f of this.eventMods.values()) {
        const x = f[k];
        if (x !== undefined) v *= x;
      }
      out[k] = v;
    }
  }

  // ---- skill-logic lists ---------------------------------------------------

  /**
   * add (or refresh, same non-zero `key`) a lure point: creatures within `r` of (x, z) walk to it for `left` seconds.
   * No-op returning false when the kill switch `balance.triggers.bait` is off or the list is full.
   */
  addBait(x: number, z: number, r: number, left: number, key = 0): boolean {
    if (!this.trig.bait) return false;
    return this.baits.add(x, z, r, left, key);
  }

  /** record a kill position for the corpse ring (called from the kill hook) */
  addCorpse(x: number, z: number, owner: number): void {
    this.corpses.push(x, z, this.time, owner);
  }

  // ---- queries -----------------------------------------------------------

  hud(player = 0): HudSnapshot {
    return buildHud(this, player);
  }

  /** snapshot of the run stats (final once `over`) */
  buildResult(victory: boolean): RunResult {
    return buildResult(this, victory);
  }

  /** time-scaled enemy hp multiplier (per-minute growth × difficulty) */
  hpScale(): number {
    return (1 + this.balance.enemyHpPerMin * (this.time / 60)) * this.diff.hp;
  }

  /** time-scaled enemy damage multiplier */
  dmgScale(): number {
    return (1 + this.balance.enemyDamagePerMin * (this.time / 60)) * this.diff.damage;
  }

  /** party damage per second over the last ~5 s of sim time */
  dps(): number {
    const n = Math.min(this.dmgCount, this.dmgRing.length);
    if (n < 2) return 0;
    const len = this.dmgRing.length;
    const newest = this.dmgRing[(this.dmgCount - 1) % len] as number;
    const oldest = this.dmgRing[(this.dmgCount - n) % len] as number;
    return (newest - oldest) / ((n - 1) * 0.5);
  }

  /** alive enemy count excluding metin rows and dying rows */
  aliveEnemies(): number {
    return this.spawner.alive;
  }

  nearestPlayer(x: number, z: number): number {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i] as PlayerState;
      if (!p.alive) continue;
      const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  allDead(): boolean {
    for (const p of this.players) if (p.alive) return false;
    return true;
  }

  rarityIndex(r: Rarity): number {
    return RARITIES.indexOf(r);
  }

  private collectUsedTypes(): void {
    const seen = new Set<number>();
    const add = (id: string): void => {
      const i = this.ix.typeIndex.get(id);
      if (i !== undefined) seen.add(i);
    };
    for (const band of this.zone.bands) {
      for (const s of band.spawns) {
        add(s.enemy);
        if (s.group) {
          if (s.group.leader) add(s.group.leader);
          for (const m of s.group.members) add(m);
        }
      }
      if (band.elites) for (const id of band.elites.pool) add(id);
    }
    for (const b of this.zone.bosses) add(b.boss);
    add(this.zone.final.boss);
    for (const id of [...this.zone.metins.types, this.zone.final.greatMetin]) {
      const m = this.ix.metins.get(id);
      if (m) for (const e of m.swarm.enemies) add(e);
    }
    this.usedTypes.push(...[...seen].sort((a, b) => a - b));
  }
}


/** create a world for a run. `meta` defaults to `config.meta`. */
export function createWorld(config: RunConfig, content: ContentDB, meta: MetaBonuses = config.meta, env: WorldEnv = {}): World {
  return new World(config, content, meta, env);
}
