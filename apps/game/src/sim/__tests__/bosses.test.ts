// Bosses and the final: scheduled arrivals + intro, hp-fraction phases, every BossPatternKind (telegraph / projectiles /
// damage), enrage, boss death rewards, the Great Metin + final boss + victory, and the defeat / revive / co-op flows.

import { describe, expect, it } from 'vitest';
import type { BossDef, BossPattern, BossPatternKind, ZoneDef } from '../../data/schema';
import { RARITIES } from '../../data/schema';
import { spawnBoss } from '../bosses';
import { cloneContent, fixtureConfig } from '../__fixtures__/content';
import { hitEnemy, hurtPlayer, HurtKind, newHitCtx } from '../combat';
import { DEFEAT_DELAY, PLAYER_RADIUS, VICTORY_DELAY } from '../constants';
import type { SimEvent, SimEventType } from '../events';
import type { CoopPlayerInit } from '../run';
import { refreshStats } from '../stats';
import { AnimClip, EnemyFlag, EnemyState, PickupKind, ProjKind, StatusIdx, TelegraphAct, TelegraphShape, type PlayerState } from '../stores';
import { MetinPhase, type BossState, type MetinState, type WorldEnv } from '../types';
import { createWorld, type World } from '../world';
import { spawnPickup } from '../pickups';
import { addTelegraph } from '../telegraph';
import { drainModals, NO_INPUT, player, runTicks, spawn } from './helpers';

const HORYEONG = 'boss_horyeong';
const ORK = 'boss_ork_chief';
const INTRO = 1.6;
const DT = 1 / 60;
const COOP_HERO: CoopPlayerInit = { classId: 'warrior', doctrine: 'a', sex: 'f', empire: 'chowon', meta: { stats: {} } };

// ---------------------------------------------------------------------------
// helpers

type EventOf<T extends SimEventType> = Extract<SimEvent, { t: T }>;

interface Setup {
  seed?: number;
  /** per-boss-def tweaks on the private content clone */
  boss?: Record<string, (d: BossDef) => void>;
  zone?: (z: ZoneDef) => void;
  /** two heroes */
  coop?: boolean;
  difficulty?: 'normal' | 'hard';
  /** keep the zone's boss schedule */
  schedule?: boolean;
  /** keep the Great Metin / final boss schedule */
  final?: boolean;
  /** keep hero hp realistic (default: unkillable) */
  fragile?: boolean;
  /** keep the heroes' starting skills (default: none, so nothing damages the boss by accident) */
  keepSkills?: boolean;
  /** environment hooks (e.g. WorldEnv.bossModel) */
  env?: WorldEnv;
}

/** quiet world: spawner, metin stones off; heroes without skills; bosses/final only when asked for */
function bossWorld(o: Setup = {}): World {
  const content = cloneContent();
  o.zone?.(content.zones[0] as ZoneDef);
  for (const b of content.bosses) o.boss?.[b.id]?.(b);
  const w = createWorld(
    fixtureConfig({ seed: o.seed ?? 21, difficulty: o.difficulty ?? 'normal', ...(o.coop ? { coop: [COOP_HERO] } : {}) }),
    content,
    undefined,
    o.env,
  );
  w.spawner.acc = -1e9;
  w.spawner.eliteT = 1e9;
  if (!o.schedule) w.spawner.nextBoss = w.spawner.bosses.length;
  w.metinSys.nextFallAt = 1e9;
  if (!o.final) w.metinSys.finalStarted = true;
  for (const p of w.players) {
    if (!o.keepSkills) p.skills.length = 0;
    if (!o.fragile) {
      p.hp = 1e6;
      p.hpMax = 1e6;
    }
  }
  return w;
}

function place(w: World, x: number, z: number, pi = 0): void {
  const p = player(w, pi);
  p.x = x;
  p.z = z;
  p.px = x;
  p.pz = z;
  p.kvx = 0;
  p.kvz = 0;
  p.vx = 0;
  p.vz = 0;
  p.iframes = 0;
}

function dist(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(ax - bx, az - bz);
}

function near(actual: number, expected: number, rel = 0.01): void {
  expect(Math.abs(actual - expected), `${actual} vs ${expected}`).toBeLessThanOrEqual(Math.abs(expected) * rel);
}

function mitigation(w: World, p: PlayerState, element: number): number {
  return (1 - (p.stats.resist[element] as number)) * (1 - p.stats.armor / (p.stats.armor + w.balance.armorK));
}

interface Stamped<T extends SimEventType> {
  /** 1-based index of the step (within this call) that emitted it */
  tick: number;
  ev: EventOf<T>;
}

/** step n ticks and return stamped copies of the events whose type is in `types` */
function watch<T extends SimEventType>(w: World, ticks: number, types: readonly T[]): Stamped<T>[] {
  const out: Stamped<T>[] = [];
  for (let i = 1; i <= ticks; i++) {
    w.step([NO_INPUT]);
    for (const e of w.events) if ((types as readonly string[]).includes(e.t)) out.push({ tick: i, ev: { ...e } as EventOf<T> });
  }
  return out;
}

/** step until `pred` holds; returns the ticks stepped */
function until(w: World, pred: () => boolean, max: number, what: string): number {
  for (let i = 0; i < max; i++) {
    if (pred()) return i;
    w.step([NO_INPUT]);
  }
  if (!pred()) throw new Error(`timed out waiting for ${what} (t=${w.time.toFixed(2)})`);
  return max;
}

function bossRow(w: World, b: BossState): number {
  return w.enemies.find(b.enemy);
}

/** the boss behaves as `kind` only: phase 0 with this pattern, cooldown 0, no melee, no timed enrage */
function only(kind: BossPatternKind, params: Record<string, number> = {}, over: Partial<BossPattern> = {}): (d: BossDef) => void {
  return (d) => {
    const base = d.patterns.find((p) => p.kind === kind);
    if (!base) throw new Error(`boss ${d.id} has no '${kind}' pattern`);
    const pat: BossPattern = { ...base, cooldown: 0, ...over, params: { ...base.params, ...params } };
    d.patterns = [pat];
    d.phases = [{ hpPct: 1, patterns: [pat.id] }];
    d.attacks = [];
    d.enrageAfter = 1e9;
  };
}

/** boss def (in the fixture) that owns pattern `kind` */
function bossFor(kind: BossPatternKind): string {
  return kind === 'nova' || kind === 'teleport' || kind === 'breath' || kind === 'enrage' ? ORK : HORYEONG;
}

interface Arena {
  w: World;
  b: BossState;
  row: number;
  id: string;
}

interface ArenaOpts {
  params?: Record<string, number>;
  over?: Partial<BossPattern>;
  /** hero position (default origin) */
  hero?: [number, number];
  /** boss position (default 12 m +Z of the origin) */
  at?: [number, number];
  setup?: Setup;
}

/**
 * world with one boss forced to `kind`; spawned and primed so that its pattern starts the moment the intro ends.
 * The pattern starts with cooldown 0 (ready at once) but, unless `over.cooldown` says otherwise, is on a huge cooldown
 * afterwards so a test sees exactly one cast.
 */
function arena(kind: BossPatternKind, o: ArenaOpts = {}): Arena {
  const id = bossFor(kind);
  const w = bossWorld({ ...o.setup, boss: { [id]: only(kind, o.params, { cooldown: 1e6, ...o.over }) } });
  if (o.hero) place(w, o.hero[0], o.hero[1]);
  const at = o.at ?? [0, 12];
  const b = spawnBoss(w, id, false, at[0], at[1]);
  if (!b) throw new Error('boss did not spawn');
  b.gap = 0;
  b.ready.fill(0);
  return { w, b, row: bossRow(w, b), id };
}

/** run until the boss has picked its pattern (windup begins); returns ticks stepped */
function beginPattern(a: Arena): number {
  const n = until(a.w, () => a.b.pattern !== null, 6 * 60, 'the boss to start a pattern');
  return n;
}

/** wait until the boss is hittable and in its Move state (intro over) */
function introOver(w: World, b: BossState): void {
  until(w, () => b.age >= INTRO + 0.1, 5 * 60, 'the intro to end');
}

interface TeleRow {
  shape: number;
  act: number;
  owner: number;
  x: number;
  z: number;
  rot: number;
  radius: number;
  length: number;
  width: number;
  dur: number;
  follow: number;
  damage: number;
  knock: number;
  element: number;
}

function teleRows(w: World): TeleRow[] {
  const T = w.telegraphs;
  const out: TeleRow[] = [];
  for (let i = 0; i < T.count; i++) {
    out.push({
      shape: T.shape[i] as number,
      act: T.act[i] as number,
      owner: T.owner[i] as number,
      x: T.x[i] as number,
      z: T.z[i] as number,
      rot: T.rot[i] as number,
      radius: T.radius[i] as number,
      length: T.length[i] as number,
      width: T.width[i] as number,
      dur: T.dur[i] as number,
      follow: T.follow[i] as number,
      damage: T.damage[i] as number,
      knock: T.knock[i] as number,
      element: T.element[i] as number,
    });
  }
  return out;
}

interface Bolt {
  x: number;
  z: number;
  vx: number;
  vz: number;
  damage: number;
  radius: number;
  life: number;
}

/** hostile projectiles created by the step that just ran (they are still at age 0 when the step ends) */
function newBolts(w: World): Bolt[] {
  const P = w.projectiles;
  const bolts: Bolt[] = [];
  for (let i = 0; i < P.count; i++) {
    if (P.kind[i] === ProjKind.Hostile && P.hostile[i] === 1 && P.skill[i] === 255 && P.age[i] === 0) {
      bolts.push({ x: P.x[i] as number, z: P.z[i] as number, vx: P.vx[i] as number, vz: P.vz[i] as number, damage: P.damage[i] as number, radius: P.radius[i] as number, life: P.life[i] as number });
    }
  }
  return bolts;
}

/** step n ticks; per tick that fired hostile bolts, the bolts */
function boltBatches(w: World, ticks: number): { tick: number; bolts: Bolt[] }[] {
  const out: { tick: number; bolts: Bolt[] }[] = [];
  for (let t = 1; t <= ticks; t++) {
    w.step([NO_INPUT]);
    const bolts = newBolts(w);
    if (bolts.length > 0) out.push({ tick: t, bolts });
  }
  return out;
}

/** boss pattern damage before mitigation: def.damage × row damage multiplier × pattern factor */
function bossDmg(w: World, id: string, row: number, factor: number): number {
  const def = w.ix.bosses.get(id) as BossDef;
  return def.damage * (w.enemies.dmgMul[row] as number) * factor;
}

function hit(w: World, row: number, dmg = 1e9, player = 0): number {
  const c = newHitCtx();
  c.player = player;
  c.noCrit = true;
  return hitEnemy(w, row, dmg, c);
}

/** kill an enemy row with one hit; the events of the kill stay readable (copies are returned) until the next step */
function slay(w: World, row: number): SimEvent[] {
  w.bus.clear();
  expect(hit(w, row)).toBeGreaterThan(0);
  return w.events.map((e) => ({ ...e }) as SimEvent);
}

function hurtEvents(evs: Stamped<'playerHit'>[], player = 0): Stamped<'playerHit'>[] {
  return evs.filter((e) => e.ev.player === player && e.ev.result === 0);
}

// ---------------------------------------------------------------------------

describe('scheduled bosses', () => {
  it('arrive at zone.bosses[].at with a bossSpawn event, 22–30 m from the hero', () => {
    const w = bossWorld({ schedule: true });
    expect(w.zone.bosses.map((b) => b.at)).toEqual([180, 480]);
    runTicks(w, 179 * 60);
    expect(w.bosses.length).toBe(0);
    expect(w.enemies.count).toBe(0);
    // step to the tick that spawns it, keeping everything that tick emitted
    let tick: SimEvent[] = [];
    for (let i = 0; i < 3 * 60 && tick.length === 0; i++) {
      w.step([NO_INPUT]);
      if (w.events.some((e) => e.t === 'bossSpawn')) tick = w.events.map((e) => ({ ...e }) as SimEvent);
    }
    expect(Math.abs(w.time - 180)).toBeLessThanOrEqual(2 * DT);
    const spawned = tick.filter((e) => e.t === 'bossSpawn') as EventOf<'bossSpawn'>[];
    expect(spawned.length).toBe(1);
    const ev = spawned[0]!;
    expect(ev.bossId).toBe(HORYEONG);
    expect(ev.final).toBe(false);
    const d = dist(ev.x, ev.z, 0, 0);
    expect(d).toBeGreaterThanOrEqual(22 - 1e-3);
    expect(d).toBeLessThanOrEqual(30 + 1e-3);
    // the creature row
    expect(w.bosses.length).toBe(1);
    const b = w.bosses[0] as BossState;
    expect(b.id).toBe(ev.boss);
    expect(b.enemy).toBe(ev.enemy);
    expect(b.def.id).toBe(HORYEONG);
    expect(b.final).toBe(false);
    const row = bossRow(w, b);
    expect(row).toBeGreaterThanOrEqual(0);
    expect(w.enemies.x[row]).toBeCloseTo(ev.x, 3);
    expect(w.enemies.z[row]).toBeCloseTo(ev.z, 3);
    expect(w.enemies.eliteTier[row]).toBe(3);
    expect((w.enemies.flags[row] as number) & EnemyFlag.Boss).toBe(EnemyFlag.Boss);
    expect((w.enemies.flags[row] as number) & EnemyFlag.Pinned).toBe(0);
    expect(w.typeDefs[w.enemies.type[row] as number]?.id).toBe(HORYEONG);
    // the creature-layer spawn event and the story hook
    const es = tick.find((e) => e.t === 'enemySpawn') as EventOf<'enemySpawn'>;
    expect(es.source).toBe(3);
    expect(es.tier).toBe(3);
    expect(es.enemy).toBe(ev.enemy);
    const story = tick.find((e) => e.t === 'story') as EventOf<'story'>;
    expect(story.kind).toBe('bossIntro');
    expect(story.ref).toBe(HORYEONG);
  });

  it('hp and damage scale with the run time and difficulty', () => {
    for (const difficulty of ['normal', 'hard'] as const) {
      const w = bossWorld({ difficulty });
      w.time = 180;
      const b = spawnBoss(w, HORYEONG, false, 0, 20) as BossState;
      const row = bossRow(w, b);
      const hardHp = difficulty === 'hard' ? w.balance.hard.hp : 1;
      const hardDmg = difficulty === 'hard' ? w.balance.hard.damage : 1;
      near(w.enemies.hpMax[row] as number, 3500 * (1 + w.balance.enemyHpPerMin * 3) * hardHp, 1e-4);
      near(w.enemies.dmgMul[row] as number, (1 + w.balance.enemyDamagePerMin * 3) * hardDmg, 1e-4);
    }
  });

  it('a second boss arrives at its own `at`', () => {
    const w = bossWorld({ schedule: true });
    w.time = 479;
    // the first boss slot is long past: mark it as spawned
    w.spawner.nextBoss = 1;
    const evs = watch(w, 2 * 60, ['bossSpawn']);
    expect(evs.length).toBe(1);
    expect(evs[0]!.ev.bossId).toBe(ORK);
    expect(Math.abs(w.time - 481)).toBeLessThan(DT);
    expect(Math.abs(evs[0]!.tick * DT + 479 - 480)).toBeLessThanOrEqual(2 * DT);
  });

  it('is invulnerable for ~1.6 s (intro): hits do nothing, no pattern, still in Spawn state', () => {
    const w = bossWorld();
    place(w, 0, 0);
    const b = spawnBoss(w, HORYEONG, false, 0, 12) as BossState;
    b.gap = 0;
    b.ready.fill(0);
    const row = bossRow(w, b);
    expect((w.enemies.flags[row] as number) & EnemyFlag.Invuln).toBe(EnemyFlag.Invuln);
    expect(w.enemies.state[row]).toBe(EnemyState.Spawn);
    const hp = w.enemies.hp[row] as number;
    runTicks(w, 80); // 1.33 s
    expect(((w.enemies.flags[row] as number) & EnemyFlag.Invuln) !== 0).toBe(true);
    expect(hit(w, row, 1000)).toBe(0);
    expect(w.enemies.hp[row]).toBe(hp);
    expect(b.pattern).toBeNull();
    expect(w.telegraphs.count).toBe(0);
    // vulnerable at ~1.6 s
    const ticks = until(w, () => ((w.enemies.flags[row] as number) & EnemyFlag.Invuln) === 0, 60, 'the intro invulnerability to end');
    expect(Math.abs(80 + ticks - INTRO * 60)).toBeLessThanOrEqual(2);
    expect(hit(w, row, 1000)).toBe(1000);
    expect(w.enemies.hp[row]).toBeCloseTo(hp - 1000, 2);
  });

  it('the intro keeps the boss passive: it neither walks nor attacks the adjacent hero', () => {
    const w = bossWorld();
    place(w, 0, 0);
    const b = spawnBoss(w, HORYEONG, false, 0, 2.5) as BossState;
    const row = bossRow(w, b);
    const hp0 = player(w).hp;
    runTicks(w, 90);
    expect(player(w).hp).toBe(hp0);
    expect(w.enemies.x[row]).toBeCloseTo(0, 2);
    expect(w.enemies.z[row]).toBeCloseTo(2.5, 2);
  });

  it('a model with a longer spawn clip keeps its intro (Spawn state + invulnerable) until the clip ends, capped at 4 s', () => {
    const check = (spawn: number, expected: number): void => {
      const w = bossWorld({ env: { bossModel: () => ({ spawn, breath: false }) } });
      place(w, 0, 0);
      const b = spawnBoss(w, HORYEONG, false, 0, 12) as BossState;
      const row = bossRow(w, b);
      const before = Math.round((expected - 0.2) * 60);
      runTicks(w, before);
      expect(w.enemies.state[row]).toBe(EnemyState.Spawn);
      expect((w.enemies.flags[row] as number) & EnemyFlag.Invuln).toBe(EnemyFlag.Invuln);
      const ticks = until(w, () => ((w.enemies.flags[row] as number) & EnemyFlag.Invuln) === 0, 60, 'the intro to end');
      expect(Math.abs((before + ticks) * DT - expected)).toBeLessThanOrEqual(2 * DT);
    };
    check(3.6, 3.6);
    check(9, 4);
    // a short spawn clip never shortens the default arrival
    check(0.8, INTRO);
  });
});

// ---------------------------------------------------------------------------

describe('boss phases', () => {
  function phased(): { w: World; b: BossState; row: number } {
    const w = bossWorld();
    place(w, 0, 0);
    const b = spawnBoss(w, HORYEONG, false, 0, 30) as BossState;
    introOver(w, b);
    return { w, b, row: bossRow(w, b) };
  }

  it('Horyeong phase thresholds are fractions of hp: 1, 0.6, 0.25', () => {
    const def = cloneContent().bosses.find((d) => d.id === HORYEONG) as BossDef;
    expect(def.phases.map((p) => p.hpPct)).toEqual([1, 0.6, 0.25]);
  });

  it('starts in phase 0 and switches when the hp fraction drops to a threshold (bossPhase event)', () => {
    const { w, b, row } = phased();
    const max = w.enemies.hpMax[row] as number;
    expect(b.phase).toBe(0);
    // above 0.6: nothing happens
    w.enemies.hp[row] = max * 0.7;
    expect(watch(w, 5, ['bossPhase']).length).toBe(0);
    expect(b.phase).toBe(0);
    // at 0.55: phase 1
    w.enemies.hp[row] = max * 0.55;
    const ev1 = watch(w, 3, ['bossPhase']);
    expect(ev1.length).toBe(1);
    expect(ev1[0]!.ev.phase).toBe(1);
    expect(ev1[0]!.ev.bossId).toBe(HORYEONG);
    expect(ev1[0]!.ev.boss).toBe(b.id);
    expect(ev1[0]!.ev.enrage).toBe(false);
    expect(ev1[0]!.ev.hpFrac).toBeCloseTo(0.55, 3);
    expect(b.phase).toBe(1);
    // exactly on the threshold counts
    w.enemies.hp[row] = max * 0.25;
    const ev2 = watch(w, 3, ['bossPhase']);
    expect(ev2.length).toBe(1);
    expect(ev2[0]!.ev.phase).toBe(2);
    expect(b.phase).toBe(2);
    // no event while nothing changes
    expect(watch(w, 30, ['bossPhase']).length).toBe(0);
  });

  it('a big hit that skips a phase jumps straight to the last matching one (a single event)', () => {
    const { w, b, row } = phased();
    w.enemies.hp[row] = (w.enemies.hpMax[row] as number) * 0.2;
    const evs = watch(w, 3, ['bossPhase']);
    expect(evs.length).toBe(1);
    expect(evs[0]!.ev.phase).toBe(2);
    expect(b.phase).toBe(2);
  });

  it('a phase change pulls the pattern cooldowns forward (so the new moves start soon)', () => {
    const { w, b, row } = phased();
    b.ready.fill(w.time + 50);
    w.enemies.hp[row] = (w.enemies.hpMax[row] as number) * 0.5;
    runTicks(w, 2);
    for (let k = 0; k < b.ready.length; k++) expect(b.ready[k]).toBeLessThanOrEqual(w.time + 1.2 + k * 0.4 + 1e-9);
  });

  it('phases are not evaluated during the intro', () => {
    const w = bossWorld();
    place(w, 0, 0);
    const b = spawnBoss(w, HORYEONG, false, 0, 30) as BossState;
    const row = bossRow(w, b);
    w.enemies.hp[row] = (w.enemies.hpMax[row] as number) * 0.1;
    expect(watch(w, 60, ['bossPhase']).length).toBe(0);
    expect(b.phase).toBe(0);
    runTicks(w, 60);
    expect(b.phase).toBe(2);
  });

  it('percent thresholds (0–100) are accepted like fractions', () => {
    const w = bossWorld({
      boss: {
        [HORYEONG]: (d) => {
          d.phases = d.phases.map((p) => ({ ...p, hpPct: p.hpPct * 100 }));
        },
      },
    });
    place(w, 0, 0);
    const b = spawnBoss(w, HORYEONG, false, 0, 30) as BossState;
    introOver(w, b);
    const row = bossRow(w, b);
    w.enemies.hp[row] = (w.enemies.hpMax[row] as number) * 0.55;
    runTicks(w, 3);
    expect(b.phase).toBe(1);
  });

  it('each phase only starts patterns from its own list', () => {
    const { w, b, row } = phased();
    const started: Set<string>[] = [new Set(), new Set(), new Set()];
    const allowed = [['slam', 'charge'], ['slam', 'volley', 'summon'], ['ring', 'meteor', 'slam']];
    const max = w.enemies.hpMax[row] as number;
    const hpFor = [1, 0.5, 0.2];
    for (let ph = 0; ph < 3; ph++) {
      w.enemies.hp[row] = max * (hpFor[ph] as number);
      for (let t = 0; t < 50 * 60; t++) {
        w.step([NO_INPUT]);
        // a pattern that began in an earlier phase may still be playing out: only count fresh picks (patternT is 0 on the pick tick)
        if (b.pattern && b.patternT === 0) started[b.phase]!.add(b.pattern.id);
        place(w, 0, 0);
      }
      expect(b.phase).toBe(ph);
    }
    for (let ph = 0; ph < 3; ph++) {
      const ids = [...started[ph]!];
      expect(ids.length, `phase ${ph}`).toBeGreaterThanOrEqual(2);
      for (const id of ids) expect(allowed[ph], `phase ${ph}: ${id}`).toContain(id);
    }
  });

  it('a boss pattern ends (and the boss goes idle) when its target dies', () => {
    const a = arena('slam', { hero: [0, 0], at: [0, 4], setup: { fragile: true } });
    beginPattern(a);
    expect(a.b.pattern).not.toBeNull();
    const p = player(a.w);
    p.alive = false;
    p.hp = 0;
    runTicks(a.w, 2);
    expect(a.b.pattern).toBeNull();
    expect(a.w.enemies.state[a.row]).toBe(EnemyState.Move);
  });
});

describe('boss pattern clips', () => {
  const clipOf = (kind: BossPatternKind, breath: boolean | null): number => {
    const a = arena(kind, breath === null ? {} : { setup: { env: { bossModel: () => ({ spawn: 0, breath }) } } });
    beginPattern(a);
    return a.w.enemies.animClip[a.row] as number;
  };

  it('kinds alternate special1 / special2 by default', () => {
    expect(clipOf('slam', null)).toBe(AnimClip.Special1);
    expect(clipOf('breath', null)).toBe(AnimClip.Special2);
    expect(clipOf('breath', false)).toBe(AnimClip.Special2);
  });

  it('a model with its breath in special1 breathes there and moves the other patterns onto special2 / special3', () => {
    expect(clipOf('breath', true)).toBe(AnimClip.Special1);
    expect(clipOf('slam', true)).toBe(AnimClip.Special2);
    expect(clipOf('nova', true)).toBe(AnimClip.Special3);
  });
});

// ---------------------------------------------------------------------------

describe('boss patterns', () => {
  describe('slam', () => {
    it('at self: a boss-owned circle telegraph that follows the boss, then damages + shoves the hero inside', () => {
      const a = arena('slam', { hero: [0, 0], at: [0, 3] });
      const { w } = a;
      const p = player(w);
      const t0 = beginPattern(a);
      expect(a.b.pattern?.kind).toBe('slam');
      const rows = teleRows(w);
      expect(rows.length).toBe(1);
      const tele = rows[0] as TeleRow;
      expect(tele.shape).toBe(TelegraphShape.Circle);
      expect(tele.owner).toBe(1);
      expect(tele.act).toBe(TelegraphAct.Impact);
      expect(tele.radius).toBeCloseTo(4.5, 5);
      expect(tele.dur).toBeCloseTo(0.9, 5);
      expect(tele.follow).toBe(a.b.enemy);
      expect(tele.knock).toBeCloseTo(2.5, 5);
      near(tele.damage, bossDmg(w, a.id, a.row, 1.5), 1e-4);
      expect(w.enemies.state[a.row]).toBe(EnemyState.Windup);
      expect(t0).toBeGreaterThan(80);

      const evs = watch(w, 100, ['telegraph', 'playerHit', 'enemyAttack']);
      expect(evs.some((e) => e.ev.t === 'enemyAttack')).toBe(false); // the attack event fired on the begin tick
      const hurt = hurtEvents(evs.filter((e) => e.ev.t === 'playerHit') as Stamped<'playerHit'>[]);
      expect(hurt.length).toBe(1);
      expect(Math.abs(hurt[0]!.tick - 0.9 * 60)).toBeLessThanOrEqual(3);
      near(hurt[0]!.ev.amount, bossDmg(w, a.id, a.row, 1.5) * mitigation(w, p, 0), 0.005);
      expect(hurt[0]!.ev.element).toBe(0);
      // shoved away from the boss (boss at +Z of the hero → hero pushed to −Z)
      expect(p.z).toBeLessThan(-1);
    });

    it('the circle is radius + hero body: just inside is hit, just outside is not', () => {
      const hitCount = (heroZ: number): number => {
        const a = arena('slam', { hero: [0, heroZ], at: [0, 0] });
        beginPattern(a);
        return hurtEvents(watch(a.w, 100, ['playerHit'])).length;
      };
      expect(hitCount(4.5 + PLAYER_RADIUS - 0.15)).toBe(1);
      expect(hitCount(4.5 + PLAYER_RADIUS + 0.3)).toBe(0);
    });

    it('at the player (atPlayer): a fixed circle on the hero\'s position; walking out of it avoids the hit', () => {
      const run = (move: boolean) => {
        const a = arena('slam', { params: { atPlayer: 1, radius: 3, damage: 1.6 }, hero: [0, 0], at: [0, 12] });
        beginPattern(a);
        const rows = teleRows(a.w);
        expect(rows.length).toBe(1);
        const tele = rows[0] as TeleRow;
        expect(tele.follow).toBe(0);
        expect(tele.x).toBeCloseTo(0, 2);
        expect(tele.z).toBeCloseTo(0, 2);
        expect(tele.radius).toBeCloseTo(3, 5);
        const hits: Stamped<'playerHit'>[] = [];
        for (let t = 0; t < 100; t++) {
          a.w.step([move ? { moveX: 1, moveZ: 0 } : NO_INPUT]);
          for (const e of a.w.events) if (e.t === 'playerHit') hits.push({ tick: t, ev: { ...e } });
        }
        return hurtEvents(hits).length;
      };
      expect(run(false)).toBe(1);
      expect(run(true)).toBe(0); // 0.9 s × 5.6 m/s = 5 m > 3 + 0.55
    });

    it('ends after windup + 0.45 s and goes on cooldown', () => {
      const a = arena('slam', { over: { cooldown: 4 } });
      beginPattern(a);
      const t0 = a.w.time;
      until(a.w, () => a.b.pattern === null, 3 * 60, 'the slam to end');
      near(a.w.time - t0, 0.9 + 0.45, 0.04);
      expect(a.w.enemies.state[a.row]).toBe(EnemyState.Move);
      near(a.b.ready[0] as number - a.w.time, 4, 0.01);
    });
  });

  describe('charge', () => {
    it('shows a boss line telegraph, dashes the full length once, and hits an in-line hero exactly once', () => {
      const a = arena('charge', { hero: [0, 0], at: [0, 14] });
      const { w } = a;
      const p = player(w);
      beginPattern(a);
      const rows = teleRows(w);
      expect(rows.length).toBe(1);
      const tele = rows[0] as TeleRow;
      expect(tele.shape).toBe(TelegraphShape.Line);
      expect(tele.owner).toBe(1);
      expect(tele.act).toBe(TelegraphAct.Visual);
      expect(tele.length).toBeCloseTo(14, 5);
      expect(tele.width).toBeCloseTo(2.2, 5);
      expect(tele.follow).toBe(a.b.enemy);
      expect(tele.dur).toBeCloseTo(1, 5);
      expect(Math.abs(Math.abs(tele.rot) - Math.PI)).toBeLessThan(0.02); // facing −Z
      const x0 = w.enemies.x[a.row] as number;
      const z0 = w.enemies.z[a.row] as number;

      const evs = watch(w, 3 * 60, ['playerHit']);
      const hurt = hurtEvents(evs);
      expect(hurt.length).toBe(1);
      near(hurt[0]!.ev.amount, bossDmg(w, a.id, a.row, 2) * mitigation(w, p, 0), 0.005);
      // the boss travelled the whole dash length along its facing
      const x1 = w.enemies.x[a.row] as number;
      const z1 = w.enemies.z[a.row] as number;
      expect(dist(x1, z1, x0, z0)).toBeGreaterThan(13.5);
      // the dash itself lasts length / speed = 0.7 s, after the 1 s windup
      expect(hurt[0]!.tick / 60).toBeGreaterThan(1.0);
      expect(hurt[0]!.tick / 60).toBeLessThan(1.8);
    });

    it('dashes at `speed` m/s along its facing while in the Dash state', () => {
      const a = arena('charge', { hero: [0, 0], at: [0, 14] });
      const { w } = a;
      beginPattern(a);
      until(w, () => w.enemies.state[a.row] === EnemyState.Dash, 3 * 60, 'the dash to start');
      const z0 = w.enemies.z[a.row] as number;
      const x0 = w.enemies.x[a.row] as number;
      runTicks(w, 6);
      near(z0 - (w.enemies.z[a.row] as number), (20 * 6) / 60, 0.02); // speed 20 m/s towards −Z
      expect(Math.abs((w.enemies.x[a.row] as number) - x0)).toBeLessThan(0.05);
      expect(w.enemies.state[a.row]).toBe(EnemyState.Dash);
    });

    it('misses a hero off the line (co-op: the second hero stands to the side)', () => {
      const a = arena('charge', { hero: [0, 0], at: [0, 14], setup: { coop: true } });
      place(a.w, 16, 0, 1); // farther from the boss than the target hero, and far off its line
      beginPattern(a);
      const evs = watch(a.w, 3 * 60, ['playerHit']);
      expect(hurtEvents(evs, 0).length).toBe(1);
      expect(hurtEvents(evs, 1).length).toBe(0);
    });
  });

  describe('volley', () => {
    it('fires `waves` fans of `count` hostile bolts, `interval` apart, centred on the hero', () => {
      const a = arena('volley', { hero: [0, 0], at: [0, 14] });
      const { w } = a;
      beginPattern(a);
      const rows = teleRows(w);
      expect(rows.length).toBe(1);
      expect(rows[0]!.shape).toBe(TelegraphShape.Cone);
      expect(rows[0]!.owner).toBe(1);
      expect(rows[0]!.width).toBeCloseTo(0.9, 5); // spread
      expect(rows[0]!.dur).toBeCloseTo(0.8, 5);
      expect(rows[0]!.follow).toBe(a.b.enemy);

      const batches = boltBatches(w, 4 * 60);
      expect(batches.length).toBe(2);
      expect(Math.abs(batches[0]!.tick - 0.8 * 60)).toBeLessThanOrEqual(3);
      expect(Math.abs(batches[1]!.tick - batches[0]!.tick - 0.4 * 60)).toBeLessThanOrEqual(2);
      for (const batch of batches) {
        expect(batch.bolts.length).toBe(5);
        const angles = batch.bolts.map((bolt) => Math.atan2(bolt.vx, bolt.vz));
        const base = Math.atan2(0 - 0, 0 - 14); // boss at (0,14) aims at the hero at the origin → −Z
        const sorted = angles.map((ang) => Math.atan2(Math.sin(ang - base), Math.cos(ang - base))).sort((p, q) => p - q);
        // 5 bolts evenly spread over 0.9 rad around the aim line
        sorted.forEach((ang, k) => expect(ang).toBeCloseTo((k / 4 - 0.5) * 0.9, 2));
        for (const bolt of batch.bolts) {
          near(Math.hypot(bolt.vx, bolt.vz), 12, 1e-4);
          expect(bolt.radius).toBeCloseTo(0.5, 5);
          expect(bolt.life).toBeCloseTo(2.2, 2);
          near(bolt.damage, bossDmg(w, a.id, a.row, 0.8), 1e-4);
          expect(dist(bolt.x, bolt.z, 0, 14)).toBeCloseTo(1.4, 3);
        }
      }
    });

    it('a bolt on the hero hurts (boss damage × 0.8 × mitigation); bolts outside the fan never do', () => {
      const a = arena('volley', { hero: [0, 0], at: [0, 14] });
      const p = player(a.w);
      beginPattern(a);
      const evs = watch(a.w, 4 * 60, ['playerHit']);
      const hurt = hurtEvents(evs);
      expect(hurt.length).toBeGreaterThanOrEqual(1);
      expect(hurt.length).toBeLessThanOrEqual(2);
      near(hurt[0]!.ev.amount, bossDmg(a.w, a.id, a.row, 0.8) * mitigation(a.w, p, 0), 0.005);
      // 14 m at 12 m/s: the first bolt lands ~1 s after it was fired
      expect(hurt[0]!.tick / 60).toBeGreaterThan(0.8 + 0.8);
      expect(hurt[0]!.tick / 60).toBeLessThan(0.8 + 1.4);
    });

    it('a single bolt per wave flies straight at the hero', () => {
      const a = arena('volley', { params: { count: 1, waves: 1 }, hero: [3, 0], at: [3, 14] });
      beginPattern(a);
      const batches = boltBatches(a.w, 3 * 60);
      expect(batches.length).toBe(1);
      expect(batches[0]!.bolts.length).toBe(1);
      const bolt = batches[0]!.bolts[0] as Bolt;
      expect(bolt.vx).toBeCloseTo(0, 4);
      expect(bolt.vz).toBeCloseTo(-12, 3);
    });
  });

  describe('summon', () => {
    it('spawns `count` minions 3–6 m from the boss after the windup, drawn from the band roster', () => {
      const a = arena('summon', { hero: [0, 0], at: [0, 20], params: { count: 6 } });
      const { w } = a;
      beginPattern(a);
      expect(teleRows(w).length).toBe(0); // summon has no ground telegraph
      const alive0 = w.spawner.alive;
      const evs = watch(w, 3 * 60, ['enemySpawn', 'vfx']);
      const spawns = evs.filter((e) => e.ev.t === 'enemySpawn') as Stamped<'enemySpawn'>[];
      expect(spawns.length).toBe(6);
      expect(w.spawner.alive - alive0).toBe(6);
      for (const s of spawns) {
        expect(Math.abs(s.tick - 1.2 * 60)).toBeLessThanOrEqual(3);
        expect(s.ev.source).toBe(4);
        expect(s.ev.tier).toBe(0);
        // band 0 roster: wolf / jackal (pack members included)
        expect(['wolf', 'jackal']).toContain(w.typeDefs[s.ev.type]?.id);
        const d = dist(s.ev.x, s.ev.z, 0, 20);
        expect(d).toBeGreaterThanOrEqual(3 - 1e-3);
        expect(d).toBeLessThanOrEqual(6 + 1e-3);
      }
      expect(evs.some((e) => e.ev.t === 'vfx' && e.ev.preset === 'vfx_boss_summon')).toBe(true);
    });

    it('follows the current time band (later bands bring the bigger roster, never pack leaders or elites)', () => {
      const roster = ['wolf', 'jackal', 'spitter', 'boar_charger', 'bear', 'fox', 'bomb_imp'];
      const seen = new Set<string>();
      for (let seed = 1; seed <= 6; seed++) {
        const a = arena('summon', { hero: [0, 0], at: [0, 20], params: { count: 10 }, setup: { seed } });
        a.w.time = 400;
        beginPattern(a);
        for (const s of watch(a.w, 3 * 60, ['enemySpawn'])) {
          const id = a.w.typeDefs[s.ev.type]?.id as string;
          expect(roster).toContain(id);
          expect(s.ev.source).toBe(4);
          seen.add(id);
        }
      }
      // more than the two band-0 species show up
      expect(seen.size).toBeGreaterThan(3);
    });

    it('minions arrive with a spawn-in animation', () => {
      const a = arena('summon', { hero: [0, 0], at: [0, 20] });
      beginPattern(a);
      const w = a.w;
      let first: EventOf<'enemySpawn'> | undefined;
      for (let i = 0; i < 3 * 60 && !first; i++) {
        w.step([NO_INPUT]);
        const ev = w.events.find((e) => e.t === 'enemySpawn');
        if (ev) first = { ...ev } as EventOf<'enemySpawn'>;
      }
      expect(first).toBeDefined();
      const row = w.enemies.find(first!.enemy);
      expect(w.enemies.state[row]).toBe(EnemyState.Spawn);
      expect(w.enemies.aiT[row]).toBeCloseTo(0.6, 5);
    });
  });

  describe('ring', () => {
    it('fires `waves` rings of `count` bolts evenly around the boss, alternate waves offset by half a step', () => {
      const a = arena('ring', { hero: [0, 0], at: [0, 20], setup: { fragile: false } });
      const { w } = a;
      beginPattern(a);
      const rows = teleRows(w);
      expect(rows.length).toBe(1);
      expect(rows[0]!.shape).toBe(TelegraphShape.Circle);
      expect(rows[0]!.owner).toBe(1);
      expect(rows[0]!.radius).toBeCloseTo(3.2, 5);
      expect(rows[0]!.dur).toBeCloseTo(1.0, 5);

      const evs: Stamped<'vfx'>[] = [];
      const batches: { tick: number; bolts: Bolt[] }[] = [];
      for (let t = 1; t <= 3 * 60; t++) {
        w.step([NO_INPUT]);
        for (const e of w.events) if (e.t === 'vfx' && e.preset === 'vfx_boss_ring') evs.push({ tick: t, ev: { ...e } });
        const bolts = newBolts(w);
        if (bolts.length > 0) batches.push({ tick: t, bolts });
      }
      expect(batches.length).toBe(2);
      expect(evs.length).toBe(2);
      expect(Math.abs(batches[0]!.tick - 1.0 * 60)).toBeLessThanOrEqual(3);
      expect(Math.abs(batches[1]!.tick - batches[0]!.tick - 0.55 * 60)).toBeLessThanOrEqual(2);
      batches.forEach((batch, wave) => {
        expect(batch.bolts.length).toBe(16);
        const off = (wave % 2) * (Math.PI / 16);
        const angles = batch.bolts.map((bolt) => Math.atan2(bolt.vx, bolt.vz));
        for (let k = 0; k < 16; k++) {
          const want = off + (k / 16) * Math.PI * 2;
          const got = angles.find((ang) => Math.abs(Math.atan2(Math.sin(ang - want), Math.cos(ang - want))) < 0.01);
          expect(got, `wave ${wave} bolt ${k}`).toBeDefined();
        }
        for (const bolt of batch.bolts) {
          near(Math.hypot(bolt.vx, bolt.vz), 8, 1e-4);
          expect(dist(bolt.x, bolt.z, 0, 20)).toBeCloseTo(1.6, 3);
          expect(bolt.radius).toBeCloseTo(0.4, 5);
          near(bolt.damage, bossDmg(w, a.id, a.row, 0.7), 1e-4);
        }
      });
    });

    it('a ring bolt hurts a hero in its way', () => {
      const a = arena('ring', { hero: [0, 8], at: [0, 0], params: { waves: 1 } });
      const p = player(a.w);
      beginPattern(a);
      const hurt = hurtEvents(watch(a.w, 4 * 60, ['playerHit']));
      expect(hurt.length).toBe(1);
      near(hurt[0]!.ev.amount, bossDmg(a.w, a.id, a.row, 0.7) * mitigation(a.w, p, 0), 0.005);
    });
  });

  describe('breath', () => {
    it('a boss-owned cone telegraph covering windup + duration; hits the hero inside only while breathing', () => {
      const a = arena('breath', { hero: [0, 0], at: [0, 5] });
      const { w } = a;
      const p = player(w);
      beginPattern(a);
      const rows = teleRows(w);
      expect(rows.length).toBe(1);
      const tele = rows[0] as TeleRow;
      expect(tele.shape).toBe(TelegraphShape.Cone);
      expect(tele.owner).toBe(1);
      expect(tele.radius).toBeCloseTo(9, 5); // length
      expect(tele.width).toBeCloseTo(0.9, 5); // angle
      expect(tele.dur).toBeCloseTo(1.0 + 2, 5);
      expect(tele.follow).toBe(a.b.enemy);

      const hits = hurtEvents(watch(w, 5 * 60, ['playerHit']));
      expect(hits.length).toBeGreaterThanOrEqual(3);
      for (const h of hits) near(h.ev.amount, bossDmg(w, a.id, a.row, 0.35) * mitigation(w, p, 0), 0.005);
      // nothing before the windup is over, nothing after the duration
      expect(hits[0]!.tick / 60).toBeGreaterThanOrEqual(1.0 - DT * 2);
      expect(hits[hits.length - 1]!.tick / 60).toBeLessThanOrEqual(3.1);
      expect(a.b.pattern).toBeNull();
    });

    it('deals one hit per `tick` seconds (a 0.25 s tick is not swallowed by the 0.25 s hazard i-frames)', () => {
      const a = arena('breath', { hero: [0, 0], at: [0, 5] });
      beginPattern(a);
      const hits = hurtEvents(watch(a.w, 5 * 60, ['playerHit']));
      // 2 s of breath at 0.25 s ticks: nominally 8 hits
      expect(hits.length).toBeGreaterThanOrEqual(7);
      expect(hits.length).toBeLessThanOrEqual(9);
    });

    it('only hits inside the cone (co-op: the second hero stands 90° off) and inside its length', () => {
      const a = arena('breath', { hero: [0, 0], at: [0, 5], setup: { coop: true } });
      place(a.w, 5.5, 5, 1); // beside the boss, perpendicular to where it faces
      beginPattern(a);
      const hits = watch(a.w, 4 * 60, ['playerHit']);
      expect(hurtEvents(hits, 0).length).toBeGreaterThanOrEqual(3);
      expect(hurtEvents(hits, 1).length).toBe(0);

      // beyond the cone length (9 m + body): safe
      const far = arena('breath', { hero: [0, 0], at: [0, 11] });
      beginPattern(far);
      expect(hurtEvents(watch(far.w, 4 * 60, ['playerHit'])).length).toBe(0);
    });
  });

  describe('meteor', () => {
    it('drops `count` delayed impact circles: the first on the hero, the rest within `spread`, one per `interval`', () => {
      const a = arena('meteor', { hero: [0, 0], at: [0, 12] });
      const { w } = a;
      const p = player(w);
      beginPattern(a);
      expect(teleRows(w).length).toBe(0); // no telegraph during the windup
      const evs = watch(w, 6 * 60, ['telegraph', 'playerHit']);
      const tele = evs.filter((e) => e.ev.t === 'telegraph') as Stamped<'telegraph'>[];
      expect(tele.length).toBe(8);
      for (const t of tele) {
        expect(t.ev.shape).toBe(TelegraphShape.Circle);
        expect(t.ev.source).toBe(1);
        expect(t.ev.a).toBeCloseTo(2.5, 5); // radius
        expect(t.ev.dur).toBeCloseTo(1.2, 5); // delay
        expect(dist(t.ev.x, t.ev.z, 0, 0)).toBeLessThanOrEqual(9 + 1e-3);
      }
      // the first meteor is aimed exactly at the hero; the first lands after windup 1.4 s
      expect(dist(tele[0]!.ev.x, tele[0]!.ev.z, 0, 0)).toBeLessThan(1e-3);
      expect(Math.abs(tele[0]!.tick - 1.4 * 60)).toBeLessThanOrEqual(3);
      for (let i = 1; i < tele.length; i++) expect(Math.abs(tele[i]!.tick - tele[i - 1]!.tick - 0.25 * 60)).toBeLessThanOrEqual(2);
      // not all on the same spot
      expect(tele.some((t) => dist(t.ev.x, t.ev.z, 0, 0) > 2)).toBe(true);
      // the hero standing still eats the first one 1.2 s later
      const hurt = hurtEvents(evs.filter((e) => e.ev.t === 'playerHit') as Stamped<'playerHit'>[]);
      expect(hurt.length).toBeGreaterThanOrEqual(1);
      expect(Math.abs(hurt[0]!.tick - tele[0]!.tick - 1.2 * 60)).toBeLessThanOrEqual(3);
      near(hurt[0]!.ev.amount, bossDmg(w, a.id, a.row, 1.5) * mitigation(w, p, 0), 0.005);
      expect(a.b.pattern).toBeNull();
    });

    it('a hero that moves off the first spot dodges it', () => {
      const a = arena('meteor', { hero: [0, 0], at: [0, 12], params: { count: 1 } });
      beginPattern(a);
      const hits: Stamped<'playerHit'>[] = [];
      for (let t = 0; t < 5 * 60; t++) {
        // run away from the marked spot as soon as it is placed
        a.w.step([t > 1.4 * 60 ? { moveX: 1, moveZ: 0 } : NO_INPUT]);
        for (const e of a.w.events) if (e.t === 'playerHit') hits.push({ tick: t, ev: { ...e } });
      }
      expect(hurtEvents(hits).length).toBe(0);
    });

    it('never marks ground outside the arena', () => {
      const a = arena('meteor', { hero: [0, 148], at: [0, 130], params: { count: 12, spread: 20 } });
      beginPattern(a);
      const tele = watch(a.w, 8 * 60, ['telegraph']);
      expect(tele.length).toBeGreaterThan(0);
      for (const t of tele) expect(Math.hypot(t.ev.x, t.ev.z)).toBeLessThan(a.w.arenaRadius);
    });
  });

  describe('nova', () => {
    const novaHits = (heroZ: number, params: Record<string, number> = {}): number => {
      const a = arena('nova', { hero: [0, heroZ], at: [0, 0], params });
      beginPattern(a);
      return hurtEvents(watch(a.w, 3 * 60, ['playerHit'])).length;
    };

    it('shows a ring telegraph (outer radius, safe inner radius) and the Impact resolves at the end of the windup', () => {
      const a = arena('nova', { hero: [0, 6], at: [0, 0] });
      const p = player(a.w);
      beginPattern(a);
      const rows = teleRows(a.w);
      expect(rows.length).toBe(1);
      const tele = rows[0] as TeleRow;
      expect(tele.shape).toBe(TelegraphShape.Ring);
      expect(tele.owner).toBe(1);
      expect(tele.act).toBe(TelegraphAct.Impact);
      expect(tele.radius).toBeCloseTo(8, 5);
      expect(tele.length).toBeCloseTo(3, 5);
      expect(tele.dur).toBeCloseTo(1.2, 5);
      expect(tele.knock).toBeCloseTo(3, 5);
      near(tele.damage, bossDmg(a.w, a.id, a.row, 1.4), 1e-4);
      const hurt = hurtEvents(watch(a.w, 3 * 60, ['playerHit']));
      expect(hurt.length).toBe(1);
      expect(Math.abs(hurt[0]!.tick - 1.2 * 60)).toBeLessThanOrEqual(3);
      near(hurt[0]!.ev.amount, bossDmg(a.w, a.id, a.row, 1.4) * mitigation(a.w, p, 0), 0.005);
    });

    it('the inner radius is safe; the band between inner and outer (+ body) is not; beyond is safe', () => {
      expect(novaHits(1.5)).toBe(0);
      expect(novaHits(2.9)).toBe(0);
      expect(novaHits(3.3)).toBe(1);
      expect(novaHits(6)).toBe(1);
      expect(novaHits(8 + PLAYER_RADIUS - 0.2)).toBe(1);
      expect(novaHits(8 + PLAYER_RADIUS + 0.3)).toBe(0);
      expect(novaHits(15)).toBe(0);
    });

    it('without an inner radius it is a full circle', () => {
      expect(novaHits(1.5, { inner: 0 })).toBe(1);
      const a = arena('nova', { hero: [0, 1.5], at: [0, 0], params: { inner: 0 } });
      beginPattern(a);
      expect(teleRows(a.w)[0]!.shape).toBe(TelegraphShape.Circle);
    });
  });

  describe('teleport', () => {
    it('marks a landing circle `range` from the hero, jumps there after the windup and slams', () => {
      const a = arena('teleport', { hero: [0, 0], at: [0, 25], params: { range: 6, radius: 2, damage: 1.2 } });
      const { w } = a;
      beginPattern(a);
      const rows = teleRows(w);
      expect(rows.length).toBe(1);
      const tele = rows[0] as TeleRow;
      expect(tele.shape).toBe(TelegraphShape.Circle);
      expect(tele.owner).toBe(1);
      expect(tele.follow).toBe(0);
      expect(tele.radius).toBeCloseTo(2, 5);
      expect(tele.dur).toBeCloseTo(0.8, 5);
      expect(dist(tele.x, tele.z, 0, 0)).toBeCloseTo(6, 3);

      const evs = watch(w, 60, ['vfx']);
      expect(evs.some((e) => e.ev.t === 'vfx' && e.ev.preset === 'vfx_boss_vanish')).toBe(true);
      expect(evs.some((e) => e.ev.t === 'vfx' && e.ev.preset === a.b.def.patterns[0]!.vfx)).toBe(true); // landing effect = the pattern's vfx
      expect(w.enemies.x[a.row]).toBeCloseTo(tele.x, 3);
      expect(w.enemies.z[a.row]).toBeCloseTo(tele.z, 3);
      // no render streak: previous position is the new one
      expect(w.enemies.px[a.row]).toBeCloseTo(tele.x, 3);
      expect(w.enemies.pz[a.row]).toBeCloseTo(tele.z, 3);
    });

    it('the landing slam hurts + shoves a hero within its radius, and spares one outside', () => {
      const near2 = arena('teleport', { hero: [0, 0], at: [0, 25], params: { range: 2, radius: 3.5 } });
      const p = player(near2.w);
      beginPattern(near2);
      const hurt = hurtEvents(watch(near2.w, 90, ['playerHit']));
      expect(hurt.length).toBe(1);
      near(hurt[0]!.ev.amount, bossDmg(near2.w, near2.id, near2.row, 1.2) * mitigation(near2.w, p, 0), 0.005);
      expect(Math.abs(hurt[0]!.tick - 0.8 * 60)).toBeLessThanOrEqual(3);
      // pushed away from the landing spot (the boss lands 2 m from the hero)
      expect(dist(player(near2.w).x, player(near2.w).z, near2.w.enemies.x[near2.row] as number, near2.w.enemies.z[near2.row] as number)).toBeGreaterThan(4);

      const far = arena('teleport', { hero: [0, 0], at: [0, 25], params: { range: 12, radius: 3.5 } });
      beginPattern(far);
      expect(hurtEvents(watch(far.w, 90, ['playerHit'])).length).toBe(0);
    });

    it('a different destination every time', () => {
      const spots = new Set<string>();
      for (let seed = 1; seed <= 6; seed++) {
        const a = arena('teleport', { hero: [0, 0], at: [0, 25], setup: { seed } });
        beginPattern(a);
        const t = teleRows(a.w)[0] as TeleRow;
        spots.add(`${t.x.toFixed(2)},${t.z.toFixed(2)}`);
      }
      expect(spots.size).toBeGreaterThan(3);
    });
  });

  describe('enrage', () => {
    it('the enrage pattern applies its multipliers exactly once (speed, damage, cooldowns) with a bossPhase{enrage} event', () => {
      const a = arena('enrage', { hero: [0, 0], at: [0, 12], params: { speedMul: 1.3, damageMul: 1.25, cooldownMul: 0.75 }, over: { cooldown: 10 } });
      const { w } = a;
      const speed0 = w.enemies.baseSpeed[a.row] as number;
      const dmg0 = w.enemies.dmgMul[a.row] as number;
      beginPattern(a);
      const evs = watch(w, 3 * 60, ['bossPhase', 'vfx']);
      const rage = evs.filter((e) => e.ev.t === 'bossPhase') as Stamped<'bossPhase'>[];
      expect(rage.length).toBe(1);
      expect(rage[0]!.ev.enrage).toBe(true);
      expect(rage[0]!.ev.bossId).toBe(ORK);
      expect(Math.abs(rage[0]!.tick - 1.2 * 60)).toBeLessThanOrEqual(3);
      expect(evs.some((e) => e.ev.t === 'vfx' && e.ev.preset === 'vfx_boss_enrage')).toBe(true);
      expect(a.b.enraged).toBe(true);
      near(w.enemies.baseSpeed[a.row] as number, speed0 * 1.3, 1e-5);
      near(w.enemies.dmgMul[a.row] as number, dmg0 * 1.25, 1e-5);
      expect(a.b.rageSpeed).toBeCloseTo(1.3, 5);
      expect(a.b.rageDamage).toBeCloseTo(1.25, 5);
      expect(a.b.rageCooldown).toBeCloseTo(0.75, 5);

      // run the pattern again and again (cooldown shrinks, but the buff never stacks)
      a.b.ready.fill(0);
      a.b.gap = 0;
      const more = watch(w, 6 * 60, ['bossPhase']);
      expect(more.length).toBe(0);
      near(w.enemies.baseSpeed[a.row] as number, speed0 * 1.3, 1e-5);
      near(w.enemies.dmgMul[a.row] as number, dmg0 * 1.25, 1e-5);
    });

    it('after def.enrageAfter seconds the boss enrages once: ×1.35 speed, ×1.5 damage, ×0.6 cooldowns', () => {
      const w = bossWorld({ boss: { [HORYEONG]: (d) => (d.enrageAfter = 5) } });
      place(w, 0, 0);
      const b = spawnBoss(w, HORYEONG, false, 0, 30) as BossState;
      const row = bossRow(w, b);
      const speed0 = w.enemies.baseSpeed[row] as number;
      const dmg0 = w.enemies.dmgMul[row] as number;
      const evs = watch(w, 8 * 60, ['bossPhase']);
      const rage = evs.filter((e) => e.ev.enrage);
      expect(rage.length).toBe(1);
      // measured from the boss's arrival (intro included)
      expect(Math.abs(rage[0]!.tick * DT - 5)).toBeLessThanOrEqual(2 * DT);
      expect(b.enraged).toBe(true);
      near(w.enemies.baseSpeed[row] as number, speed0 * 1.35, 1e-5);
      near(w.enemies.dmgMul[row] as number, dmg0 * 1.5, 1e-5);
      expect(b.rageCooldown).toBeCloseTo(0.6, 5);
      // nothing else ever re-applies it
      expect(watch(w, 20 * 60, ['bossPhase']).filter((e) => e.ev.enrage).length).toBe(0);
      near(w.enemies.dmgMul[row] as number, dmg0 * 1.5, 1e-5);
    });

    it('timed enrage first, then the enrage pattern: still a single application', () => {
      const w = bossWorld({
        boss: {
          [ORK]: (d) => {
            only('enrage', { speedMul: 2, damageMul: 3, cooldownMul: 0.1 })(d);
            d.enrageAfter = 2; // before the pattern's 1.2 s windup (started at 1.6 s) completes
          },
        },
      });
      place(w, 0, 0);
      const b = spawnBoss(w, ORK, false, 0, 30) as BossState;
      b.gap = 0;
      b.ready.fill(0);
      const row = bossRow(w, b);
      const dmg0 = w.enemies.dmgMul[row] as number;
      const speed0 = w.enemies.baseSpeed[row] as number;
      const evs = watch(w, 10 * 60, ['bossPhase']);
      expect(evs.filter((e) => e.ev.enrage).length).toBe(1);
      // the timed enrage (×1.5 / ×1.35) won; the pattern's own multipliers were ignored
      near(w.enemies.dmgMul[row] as number, dmg0 * 1.5, 1e-5);
      near(w.enemies.baseSpeed[row] as number, speed0 * 1.35, 1e-5);
    });

    it('enraged cooldowns are shorter (×0.6)', () => {
      const w = bossWorld({ boss: { [HORYEONG]: (d) => (d.enrageAfter = 2) } });
      place(w, 0, 0);
      const b = spawnBoss(w, HORYEONG, false, 0, 6) as BossState;
      until(w, () => b.enraged, 5 * 60, 'the enrage');
      until(w, () => b.pattern !== null, 10 * 60, 'a pattern');
      const pat = b.pattern as BossPattern;
      const idx = b.patIdx;
      until(w, () => b.pattern === null, 10 * 60, 'the pattern to end');
      expect((b.ready[idx] as number) - w.time).toBeCloseTo(pat.cooldown * 0.6, 1);
    });
  });
});

// ---------------------------------------------------------------------------

describe('boss crowd-control resistance', () => {
  function target(boss: boolean): { w: World; row: number } {
    const w = bossWorld();
    place(w, 0, 0);
    if (boss) {
      const b = spawnBoss(w, HORYEONG, false, 0, 20) as BossState;
      introOver(w, b);
      return { w, row: bossRow(w, b) };
    }
    return { w, row: spawn(w, 'wolf', 0, 20) };
  }

  /** one weak hit carrying stun / freeze / fear / slow (100 % chance) and a knockback */
  function ccHit(w: World, row: number, kind: number): void {
    const c = newHitCtx();
    c.player = 0;
    c.noCrit = true;
    c.statusKind = kind;
    c.statusChance = 1;
    c.statusPower = 0.5;
    c.statusDuration = 4;
    c.knock = 3; // 3 × KNOCK_DECAY 9 = 27 m/s on a unit-mass enemy, well below the 42 m/s cap
    c.sx = 0;
    c.sz = 10;
    expect(hitEnemy(w, row, 1, c)).toBeGreaterThan(0);
  }

  it('stun, freeze and fear last 25 % as long on a boss; slow is not cut', () => {
    for (const [kind, factor] of [[StatusIdx.Stun, 0.25], [StatusIdx.Freeze, 0.25], [StatusIdx.Fear, 0.25], [StatusIdx.Slow, 1]] as const) {
      const boss = target(true);
      ccHit(boss.w, boss.row, kind);
      expect(boss.w.enemies.statT[boss.row * 8 + kind], `boss kind ${kind}`).toBeCloseTo(4 * factor, 4);
      const wolf = target(false);
      ccHit(wolf.w, wolf.row, kind);
      expect(wolf.w.enemies.statT[wolf.row * 8 + kind], `wolf kind ${kind}`).toBeCloseTo(4, 4);
    }
  });

  it('knockback on a boss is 12 % of the normal shove (and mass still counts)', () => {
    const boss = target(true);
    ccHit(boss.w, boss.row, StatusIdx.Slow);
    const def = boss.w.ix.bosses.get(HORYEONG) as BossDef;
    const bossKick = Math.hypot(boss.w.enemies.kvx[boss.row] as number, boss.w.enemies.kvz[boss.row] as number);
    near(bossKick, ((3 / def.mass) * 0.12) * 9, 0.01);
    const wolf = target(false);
    ccHit(wolf.w, wolf.row, StatusIdx.Slow);
    const wolfKick = Math.hypot(wolf.w.enemies.kvx[wolf.row] as number, wolf.w.enemies.kvz[wolf.row] as number);
    near(wolfKick, 3 * 9, 0.01);
    expect(bossKick).toBeLessThan(wolfKick * 0.02);
  });
});

describe('boss death', () => {
  function armed(setup: Setup = {}): { w: World; b: BossState; row: number } {
    const w = bossWorld(setup);
    place(w, 0, 0);
    const b = spawnBoss(w, HORYEONG, false, 0, 15) as BossState;
    introOver(w, b);
    return { w, b, row: bossRow(w, b) };
  }

  it('emits bossDeath, tallies the kill and opens a free epic-or-better bossReward modal (no reroll/banish/skip)', () => {
    const { w, b, row } = armed();
    const x = w.enemies.x[row] as number;
    const z = w.enemies.z[row] as number;
    const evs = slay(w, row);
    const death = evs.filter((e) => e.t === 'bossDeath') as EventOf<'bossDeath'>[];
    expect(death.length).toBe(1);
    expect(death[0]!.bossId).toBe(HORYEONG);
    expect(death[0]!.boss).toBe(b.id);
    expect(death[0]!.final).toBe(false);
    expect(death[0]!.x).toBeCloseTo(x, 3);
    expect(death[0]!.z).toBeCloseTo(z, 3);
    const dead = evs.filter((e) => e.t === 'enemyDeath') as EventOf<'enemyDeath'>[];
    expect(dead.length).toBe(1);
    expect(dead[0]!.tier).toBe(3);
    expect(dead[0]!.killer).toBe(0);
    expect(w.tally.bossesKilled).toEqual([HORYEONG]);
    expect(w.tally.kills).toBe(1);

    expect(w.modals.length).toBe(1);
    const modal = w.modals[0]!;
    expect(modal.kind).toBe('bossReward');
    expect(modal.player).toBe(0);
    expect(modal.source).toBe(HORYEONG);
    expect(modal.free).toBe(true);
    expect(modal.cards.length).toBe(w.balance.cardsPerLevel);
    for (const c of modal.cards) expect(RARITIES.indexOf(c.rarity), `${c.kind} ${c.id} ${c.rarity}`).toBeGreaterThanOrEqual(3);
    expect(modal.canReroll).toBe(false);
    expect(modal.canBanish).toBe(false);
    expect(modal.canSkip).toBe(false);
    // picking a card closes it; the run goes on (a scheduled boss is not the end)
    expect(w.chooseCard(0)).toBe(true);
    expect(w.modals.length).toBe(0);
    runTicks(w, 3);
    expect(w.over).toBe(false);
    expect(w.bosses.length).toBe(0);
    expect(w.enemies.find(b.enemy)).toBe(-1);
    expect(w.buildResult(false).bossesKilled).toEqual([HORYEONG]);
  });

  it('heroes can kill a boss with their own skills (end to end)', () => {
    const w = bossWorld({ keepSkills: true, boss: { [HORYEONG]: (d) => (d.hp = 300) } });
    place(w, 0, 0);
    const b = spawnBoss(w, HORYEONG, false, 0, 4) as BossState;
    expect(b).not.toBeNull();
    let death: EventOf<'bossDeath'> | undefined;
    for (let i = 0; i < 90 * 60 && !death; i++) {
      w.step([NO_INPUT]);
      const ev = w.events.find((e) => e.t === 'bossDeath');
      if (ev) death = { ...ev } as EventOf<'bossDeath'>;
    }
    expect(death).toBeDefined();
    expect(death!.bossId).toBe(HORYEONG);
    expect(w.tally.bossesKilled).toEqual([HORYEONG]);
    expect(w.modals.some((m) => m.kind === 'bossReward')).toBe(true);
  });

  it('a boss without loot.chest opens no reward modal', () => {
    const { w, row } = armed({ boss: { [HORYEONG]: (d) => (d.loot.chest = false) } });
    slay(w, row);
    expect(w.modals.length).toBe(0);
    expect(w.tally.bossesKilled).toEqual([HORYEONG]);
  });

  it('every living hero gets a reward offer (co-op); a fallen hero gets none', () => {
    const both = armed({ coop: true });
    slay(both.w, both.row);
    expect(both.w.modals.map((m) => m.player).sort()).toEqual([0, 1]);
    for (const m of both.w.modals) expect(m.kind).toBe('bossReward');

    const one = armed({ coop: true });
    player(one.w, 1).alive = false;
    slay(one.w, one.row);
    expect(one.w.modals.map((m) => m.player)).toEqual([0]);
  });

  it('vacuums every xp gem on the field to the killer and drops a potion', () => {
    const { w, row } = armed();
    const gems: number[] = [];
    for (let i = 0; i < 5; i++) {
      const g = spawnPickup(w, PickupKind.Xp, 40 + i, -30, 1, 0, 0);
      gems.push(w.pickups.id[g] as number);
    }
    runTicks(w, 30);
    // out of reach: they just lie there
    for (const id of gems) expect(w.pickups.magnet[w.pickups.find(id)]).toBe(0);
    slay(w, row);
    for (const id of gems) {
      const g = w.pickups.find(id);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(w.pickups.magnet[g]).toBe(1);
      expect(w.pickups.target[g]).toBe(0);
    }
    // the boss's own loot: a heal potion (tier 3 always drops one)
    expect(pickupsOf(w, PickupKind.Heal).length).toBe(1);
    const p = player(w);
    const xp0 = p.xp + p.level * 1000;
    for (let t = 0; t < 8 * 60; t++) {
      drainModals(w);
      w.step([NO_INPUT]);
    }
    for (const id of gems) expect(w.pickups.find(id)).toBe(-1);
    expect(p.xp + p.level * 1000).toBeGreaterThan(xp0);
  });
});

// ---------------------------------------------------------------------------

describe('the final: Great Metin and the final boss', () => {
  /** the final starts 0.05 s from now; hero at the arena centre */
  function finalWorld(setup: Setup = {}): World {
    const w = bossWorld({ final: true, ...setup });
    place(w, 0, 0);
    w.time = w.zone.final.at - 0.05;
    return w;
  }

  function greatOf(w: World): MetinState {
    const g = w.metins.find((m) => m.great);
    if (!g) throw new Error('no great metin');
    return g;
  }

  /** run until the final boss exists and its intro is over */
  function readyFinalBoss(w: World): { b: BossState; row: number } {
    until(w, () => w.bosses.length > 0, 12 * 60, 'the final boss');
    const b = w.bosses[0] as BossState;
    until(w, () => b.age >= INTRO + 0.1, 5 * 60, 'the final boss intro');
    return { b, row: bossRow(w, b) };
  }

  it('at zone.final.at the Great Metin warns for 4 s at the arena centre (circle telegraph, story hook)', () => {
    const w = finalWorld();
    expect(w.zone.final.at).toBe(900);
    runTicks(w, 1);
    expect(w.metins.length).toBe(0); // 0.05 s early
    const evs = watch(w, 10, ['metinWarn', 'telegraph', 'story']);
    const warn = evs.find((e) => e.ev.t === 'metinWarn') as Stamped<'metinWarn'>;
    expect(warn).toBeDefined();
    expect(warn.ev.great).toBe(true);
    expect(warn.ev.def).toBe(w.zone.final.greatMetin);
    expect(warn.ev.dur).toBeCloseTo(4, 5);
    expect(warn.ev.x).toBe(0);
    expect(warn.ev.z).toBe(0);
    expect(Math.abs(w.time - 900 - (10 - warn.tick) * DT)).toBeLessThanOrEqual(2 * DT);
    const tele = evs.find((e) => e.ev.t === 'telegraph') as Stamped<'telegraph'>;
    expect(tele.ev.shape).toBe(TelegraphShape.Circle);
    expect(tele.ev.source).toBe(2);
    expect(tele.ev.dur).toBeCloseTo(4, 5);
    expect(tele.ev.a).toBeCloseTo(9, 5);
    const story = evs.find((e) => e.ev.t === 'story') as Stamped<'story'>;
    expect(story.ev.kind).toBe('bossIntro');
    expect(story.ev.ref).toBe(w.zone.final.boss);
    const g = greatOf(w);
    expect(g.phase).toBe(MetinPhase.Falling);
    expect(g.def.id).toBe('metin_great');
    expect(g.scale).toBeGreaterThan(1);
  });

  it('no ordinary stone falls once the final has started', () => {
    const w = finalWorld();
    runTicks(w, 6); // the final has started
    w.zone.metins.types = ['metin_lament'];
    w.metinSys.nextFallAt = 0;
    runTicks(w, 8 * 60);
    expect(w.metins.filter((m) => !m.great).length).toBe(0);
    expect(w.metins.filter((m) => m.great).length).toBe(1);
  });

  it('lands 4 s later: wide impact (9 m) hurts + shoves the hero, the stone is never vulnerable', () => {
    const w = finalWorld();
    place(w, 3, 0);
    const p = player(w);
    const first = watch(w, 6, ['metinWarn']);
    expect(first.length).toBe(1);
    const g = greatOf(w);
    until(w, () => g.phase !== MetinPhase.Falling, 5 * 60, 'the Great Metin to land');
    const impact = w.events.find((e) => e.t === 'metinImpact') as EventOf<'metinImpact'>;
    expect(impact).toBeDefined();
    expect(impact.great).toBe(true);
    expect(impact.radius).toBeCloseTo(9, 5);
    expect(impact.x).toBe(0);
    expect(impact.z).toBe(0);
    expect(Math.abs(w.time - 904)).toBeLessThanOrEqual(3 * DT);
    const hurt = w.events.find((e) => e.t === 'playerHit') as EventOf<'playerHit'>;
    near(hurt.amount, 45 * w.dmgScale() * mitigation(w, p, 1), 0.01);
    // shoved ≈ 9 m away from the centre
    runTicks(w, 90);
    expect(Math.hypot(p.x, p.z)).toBeGreaterThan(3 + 7);
    // its hit-row: full (unscaled) hp, Metin|Invuln|Pinned, and it never becomes hittable
    const row = w.enemies.find(g.enemy);
    expect(row).toBeGreaterThanOrEqual(0);
    const flags = w.enemies.flags[row] as number;
    expect(flags & EnemyFlag.Metin).toBe(EnemyFlag.Metin);
    expect(flags & EnemyFlag.Pinned).toBe(EnemyFlag.Pinned);
    expect(w.enemies.hpMax[row]).toBe(12000);
    runTicks(w, 10 * 60);
    expect(((w.enemies.flags[row] as number) & EnemyFlag.Invuln) !== 0).toBe(true);
    expect(hit(w, row, 1e6)).toBe(0);
    expect(g.phase).toBe(MetinPhase.Alive); // never awakens
  });

  it('its damage aura (16 m) hurts a hero near it every 0.5 s', () => {
    const w = finalWorld();
    place(w, 0, 20);
    const g = (() => {
      runTicks(w, 6);
      return greatOf(w);
    })();
    until(w, () => g.phase !== MetinPhase.Falling, 5 * 60, 'the Great Metin to land');
    const p = player(w);
    place(w, 10, 0);
    const hits = watch(w, 4.75 * 60, ['playerHit']).filter((e) => e.ev.element === 4);
    expect(hits.length).toBe(9);
    for (const h of hits) near(h.ev.amount, 6 * 0.5 * w.dmgScale() * mitigation(w, p, 4), 0.02);
    place(w, 17, 0);
    expect(watch(w, 3 * 60, ['playerHit']).filter((e) => e.ev.element === 4).length).toBe(0);
  });

  it('the Great Metin swarms too: 10 roster enemies every 12 s once it has landed, a third as often once its boss is out', () => {
    const w = finalWorld();
    runTicks(w, 6);
    const g = greatOf(w);
    until(w, () => g.phase !== MetinPhase.Falling, 5 * 60, 'the Great Metin to land');
    const landed = w.time;
    const waves: Stamped<'enemySpawn'>[] = [];
    // the boss emerges ~3 s after landing, so the 12 s interval stretches to 36 s
    for (let i = 1; i <= 36.5 * 60; i++) {
      w.step([NO_INPUT]);
      for (const e of w.events) if (e.t === 'enemySpawn' && e.source === 2) waves.push({ tick: i, ev: { ...e } });
    }
    expect(waves.length).toBe(10);
    expect(Math.abs(waves[0]!.tick * DT - 36)).toBeLessThanOrEqual(2 * DT);
    expect(waves.every((s) => s.tick === waves[0]!.tick)).toBe(true);
    for (const s of waves) {
      expect(['wolf', 'jackal', 'fox']).toContain(w.typeDefs[s.ev.type]?.id);
      const d = dist(s.ev.x, s.ev.z, g.x, g.z);
      expect(d).toBeGreaterThanOrEqual(4.5 - 1e-3);
      expect(d).toBeLessThanOrEqual(8.5 + 1e-3);
    }
    expect(w.time - landed).toBeGreaterThan(36);
  });

  it('the final boss emerges ~3 s after landing beside the stone, Pinned and invulnerable for its intro', () => {
    const w = finalWorld();
    runTicks(w, 6);
    const g = greatOf(w);
    until(w, () => g.phase !== MetinPhase.Falling, 5 * 60, 'the Great Metin to land');
    const landed = w.time;
    let spawnEv: EventOf<'bossSpawn'> | undefined;
    for (let i = 0; i < 6 * 60 && !spawnEv; i++) {
      w.step([NO_INPUT]);
      const ev = w.events.find((e) => e.t === 'bossSpawn');
      if (ev) spawnEv = { ...ev } as EventOf<'bossSpawn'>;
    }
    expect(spawnEv).toBeDefined();
    expect(Math.abs(w.time - landed - 3)).toBeLessThanOrEqual(3 * DT);
    expect(spawnEv!.final).toBe(true);
    expect(spawnEv!.bossId).toBe(w.zone.final.boss);
    expect(spawnEv!.x).toBeCloseTo(0, 3);
    expect(spawnEv!.z).toBeCloseTo(4.5, 3);
    const b = w.bosses[0] as BossState;
    expect(b.final).toBe(true);
    const row = bossRow(w, b);
    const flags = w.enemies.flags[row] as number;
    expect(flags & EnemyFlag.Boss).toBe(EnemyFlag.Boss);
    expect(flags & EnemyFlag.Pinned).toBe(EnemyFlag.Pinned);
    expect(flags & EnemyFlag.Invuln).toBe(EnemyFlag.Invuln);
    expect(hit(w, row, 1000)).toBe(0);
    runTicks(w, 100);
    expect(((w.enemies.flags[row] as number) & EnemyFlag.Invuln) !== 0).toBe(false);
    expect((w.enemies.flags[row] as number) & EnemyFlag.Pinned).toBe(EnemyFlag.Pinned);
    expect(hit(w, row, 1000)).toBe(1000);
    // only once
    expect(watch(w, 20 * 60, ['bossSpawn']).length).toBe(0);
    expect(w.bosses.length).toBe(1);
  });

  it('killing the final boss breaks the Great Metin, wipes the field without loot, and wins after the victory delay', () => {
    const w = finalWorld();
    const { b, row } = readyFinalBoss(w);
    const g = greatOf(w);
    expect(g.phase).toBe(MetinPhase.Alive);
    // a crowd of other enemies
    for (let i = 0; i < 12; i++) spawn(w, 'wolf', 20 + i, 25);
    spawn(w, 'alpha_wolf', 25, -25, { tier: 1 });
    const crowd = w.enemies.count - 2; // everything but the final boss and the metin row
    expect(crowd).toBeGreaterThanOrEqual(13);
    const xp0 = pickupsOf(w, PickupKind.Xp).length;
    const coins0 = pickupsOf(w, PickupKind.Yeop).length;
    const bossXp = (w.ix.bosses.get(w.zone.final.boss) as BossDef).xp;

    const evs = slay(w, row);
    // events
    const bd = evs.filter((e) => e.t === 'bossDeath') as EventOf<'bossDeath'>[];
    expect(bd.length).toBe(1);
    expect(bd[0]!.final).toBe(true);
    expect(bd[0]!.bossId).toBe(w.zone.final.boss);
    const mb = evs.filter((e) => e.t === 'metinBreak') as EventOf<'metinBreak'>[];
    expect(mb.length).toBe(1);
    expect(mb[0]!.great).toBe(true);
    expect(mb[0]!.awakened).toBe(false);
    expect(g.phase).toBe(MetinPhase.Broken);
    expect(w.tally.metinsBroken).toBe(0); // the Great Metin is not a loot stone
    expect(w.modals.some((m) => m.kind === 'bossReward' || m.kind === 'essence')).toBe(false);
    // everything else collapsed: killed by the environment (killer −1), no loot beyond the boss's own
    const deaths = evs.filter((e) => e.t === 'enemyDeath') as EventOf<'enemyDeath'>[];
    const env = deaths.filter((d) => d.killer === -1);
    expect(env.length).toBe(crowd);
    expect(w.noLoot).toBe(false);
    expect(pickupsOf(w, PickupKind.Xp).length - xp0).toBe(1);
    near(pickupsOf(w, PickupKind.Xp).reduce((s, x) => s + x.value, 0), bossXp * w.diff.reward * (1 + 0.5 * w.corruption), 0.01);
    expect(pickupsOf(w, PickupKind.Yeop).length - coins0).toBe(1);
    for (let i = 0; i < w.enemies.count; i++) expect(w.enemies.state[i]).toBe(EnemyState.Dying);
    expect(w.tally.bossesKilled).toEqual([w.zone.final.boss]);
    expect(w.over).toBe(false);
    expect(b.dead).toBe(true);

    // victory comes after VICTORY_DELAY of simulated time
    const t0 = w.time;
    let runEnd: EventOf<'runEnd'> | undefined;
    for (let i = 0; i < 600 && !w.over; i++) {
      drainModals(w);
      w.step([NO_INPUT]);
      const ev = w.events.find((e) => e.t === 'runEnd');
      if (ev) runEnd = { ...ev } as EventOf<'runEnd'>;
    }
    expect(w.over).toBe(true);
    near(w.time - t0, VICTORY_DELAY, 0.03);
    expect(runEnd).toBeDefined();
    expect(runEnd!.victory).toBe(true);
    expect(w.victory).toBe(true);
    const res = w.result;
    expect(res).not.toBeNull();
    expect(res!.victory).toBe(true);
    expect(res!.bossesKilled).toContain(w.zone.final.boss);
    expect(res!.bossesKilled[res!.bossesKilled.length - 1]).toBe(w.zone.final.boss);
    expect(res!.zone).toBe(w.zone.id);
    expect(res!.time).toBeCloseTo(w.time, 5);
    expect(res!.talentXp).toBeGreaterThanOrEqual(w.balance.talentXp.victory);
    // the end modal carries the result
    expect(w.modal?.kind).toBe('runEnd');
    expect(w.modal?.result).toBe(w.result);
    // the sim is finished: further steps do nothing
    const t1 = w.time;
    w.step([NO_INPUT]);
    expect(w.time).toBe(t1);
    expect(w.events.length).toBe(0);
    // the Great Metin shatters away
    expect(w.metins.length).toBeLessThanOrEqual(1);
  });

  it('the broken Great Metin is removed after the shatter animation', () => {
    const w = finalWorld();
    const { row } = readyFinalBoss(w);
    const g = greatOf(w);
    slay(w, row);
    for (let i = 0; i < 3 * 60 && w.metins.includes(g); i++) {
      drainModals(w);
      w.step([NO_INPUT]);
      if (w.over) break;
    }
    expect(w.metins.includes(g)).toBe(false);
  });

  it('the run is not won by anything else: a dead scheduled boss leaves the final pending', () => {
    const w = bossWorld({ schedule: true, final: true });
    place(w, 0, 0);
    w.time = 179.9;
    until(w, () => w.bosses.length > 0, 60, 'the scheduled boss');
    const b = w.bosses[0] as BossState;
    introOver(w, b);
    hit(w, bossRow(w, b));
    drainModals(w);
    runTicks(w, 5 * 60);
    expect(w.over).toBe(false);
    expect(w.endTimer).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------

describe('defeat, revives and co-op', () => {
  function withRevives(w: World, n: number, pi = 0): void {
    const p = player(w, pi);
    p.fixed.push({ revives: n });
    refreshStats(p, w.content, w.ix);
    expect(p.stats.revives).toBe(n);
  }

  /** a hit no hero survives (full pre-mitigation damage, from a point source) */
  function lethal(w: World, pi = 0): boolean {
    return hurtPlayer(w, pi, 1e6, 0, 0, 0, HurtKind.Melee);
  }

  function fragileWorld(coop = false): World {
    const w = bossWorld({ fragile: true, coop });
    place(w, 0, 0, 0);
    if (coop) place(w, 5, 0, 1);
    return w;
  }

  it('a revive restores half hp with 3 s of i-frames, no death event, and shoves enemies within 8 m away', () => {
    const w = fragileWorld();
    withRevives(w, 1);
    const p = player(w);
    const bodies = [
      { row: spawn(w, 'wolf', 0, 3), x0: 0, z0: 3, id: 0 },
      { row: spawn(w, 'wolf', 6, 0), x0: 6, z0: 0, id: 0 },
      { row: spawn(w, 'wolf', 0, -12), x0: 0, z0: -12, id: 0 }, // beyond the 8 m shockwave
    ];
    for (const b of bodies) b.id = w.enemies.id[b.row] as number;
    for (let r = 0; r < w.enemies.count; r++) {
      w.enemies.state[r] = EnemyState.Recover;
      w.enemies.aiT[r] = 1e9;
    }
    runTicks(w, 1); // spatial hash
    w.bus.clear();
    expect(lethal(w)).toBe(true);
    const evs = w.events.map((e) => ({ ...e }) as SimEvent);
    expect(p.alive).toBe(true);
    expect(p.hp).toBeCloseTo(p.hpMax * 0.5, 5);
    expect(p.iframes).toBe(3);
    expect(p.revivesUsed).toBe(1);
    const rev = evs.filter((e) => e.t === 'playerRevive') as EventOf<'playerRevive'>[];
    expect(rev.length).toBe(1);
    expect(rev[0]!.player).toBe(0);
    expect(rev[0]!.left).toBe(0);
    expect(evs.some((e) => e.t === 'playerDeath')).toBe(false);
    expect(evs.some((e) => e.t === 'vfx' && e.preset === 'vfx_revive')).toBe(true);
    // shockwave
    runTicks(w, 60);
    const [moved0, moved1, moved2] = bodies.map((b) => {
      const r = w.enemies.find(b.id);
      return dist(w.enemies.x[r] as number, w.enemies.z[r] as number, b.x0, b.z0);
    });
    expect(moved0).toBeGreaterThan(3);
    expect(moved1).toBeGreaterThan(3);
    expect(moved2).toBeLessThan(0.01);
    expect(w.over).toBe(false);
    expect(w.endTimer).toBeLessThan(0);
  });

  it('while the 3 s of revive i-frames last, nothing hurts; afterwards the hero is mortal again', () => {
    const w = fragileWorld();
    withRevives(w, 1);
    const p = player(w);
    lethal(w);
    const hp = p.hp;
    expect(lethal(w)).toBe(false);
    runTicks(w, 2 * 60);
    expect(lethal(w)).toBe(false);
    expect(p.hp).toBeGreaterThanOrEqual(hp); // untouched (only slow regen may have added a point)
    expect(p.hp).toBeLessThan(hp + 2);
    expect(p.alive).toBe(true);
    runTicks(w, 1.1 * 60);
    expect(p.iframes).toBeLessThanOrEqual(0);
    // the revive is spent: the next lethal hit is final
    expect(lethal(w)).toBe(true);
    expect(p.alive).toBe(false);
  });

  it.each([0, 1, 2])('with %i revive(s): the (n+1)-th lethal hit is the real death, then defeat after 1.6 s', (revives) => {
    const w = fragileWorld();
    if (revives > 0) withRevives(w, revives);
    const p = player(w);
    for (let k = 0; k < revives; k++) {
      w.bus.clear();
      expect(lethal(w)).toBe(true);
      expect(p.alive, `revive ${k + 1}`).toBe(true);
      expect(w.events.some((e) => e.t === 'playerRevive')).toBe(true);
      expect((w.events.find((e) => e.t === 'playerRevive') as EventOf<'playerRevive'>).left).toBe(revives - 1 - k);
      runTicks(w, 3.2 * 60); // i-frames over
    }
    expect(p.revivesUsed).toBe(revives);
    w.bus.clear();
    expect(lethal(w)).toBe(true);
    const death = w.events.filter((e) => e.t === 'playerDeath') as EventOf<'playerDeath'>[];
    expect(death.length).toBe(1);
    expect(death[0]!.player).toBe(0);
    expect(p.alive).toBe(false);
    expect(p.hp).toBe(0);
    expect(w.events.some((e) => e.t === 'playerRevive')).toBe(false);
    expect(w.over).toBe(false);

    // the defeat timer starts on the next step; the run ends DEFEAT_DELAY later
    const t0 = w.time;
    let story: EventOf<'story'> | undefined;
    let runEnd: EventOf<'runEnd'> | undefined;
    for (let i = 0; i < 300 && !w.over; i++) {
      w.step([NO_INPUT]);
      for (const e of w.events) {
        if (e.t === 'story' && e.kind === 'defeat') story = { ...e };
        if (e.t === 'runEnd') runEnd = { ...e };
      }
    }
    expect(story).toBeDefined();
    expect(story!.ref).toBe(w.zone.id);
    expect(w.over).toBe(true);
    near(w.time - t0, DEFEAT_DELAY, 0.04);
    expect(w.victory).toBe(false);
    expect(runEnd?.victory).toBe(false);
    expect(w.result?.victory).toBe(false);
    expect(w.result?.players[0]?.alive).toBe(false);
    expect(w.result?.time).toBeCloseTo(w.time, 5);
    expect(w.result?.bossesKilled).toEqual([]);
    expect(w.modal?.kind).toBe('runEnd');
    expect(w.modal?.result).toBe(w.result);
    // a finished world is inert
    const t1 = w.time;
    w.step([NO_INPUT]);
    expect(w.time).toBe(t1);
  });

  it('a dead hero stays dead: no more damage events, no movement', () => {
    const w = fragileWorld(true);
    const p = player(w);
    lethal(w);
    expect(p.alive).toBe(false);
    const before = { x: p.x, z: p.z };
    w.bus.clear();
    expect(lethal(w)).toBe(false);
    expect(w.events.some((e) => e.t === 'playerHit')).toBe(false);
    spawn(w, 'wolf', 0.5, 0);
    runTicks(w, 3 * 60);
    expect(dist(p.x, p.z, before.x, before.z)).toBeLessThan(1e-6);
    expect(p.hp).toBe(0);
  });

  it('co-op: the run goes on while one hero lives and ends 1.6 s after the last one falls', () => {
    const w = fragileWorld(true);
    const [a, b] = [player(w, 0), player(w, 1)];
    w.bus.clear();
    lethal(w, 0);
    expect(a.alive).toBe(false);
    expect(b.alive).toBe(true);
    expect((w.events.filter((e) => e.t === 'playerDeath') as EventOf<'playerDeath'>[]).map((e) => e.player)).toEqual([0]);
    runTicks(w, 10 * 60);
    expect(w.over).toBe(false);
    expect(w.endTimer).toBeLessThan(0);
    expect(w.time).toBeGreaterThan(9.9);

    lethal(w, 1);
    expect(b.alive).toBe(false);
    const t0 = w.time;
    for (let i = 0; i < 300 && !w.over; i++) w.step([NO_INPUT]);
    expect(w.over).toBe(true);
    near(w.time - t0, DEFEAT_DELAY, 0.04);
    expect(w.victory).toBe(false);
    expect(w.result?.players.map((p) => p.alive)).toEqual([false, false]);
  });

  it('co-op: a hero with a revive keeps the run alive when the other falls; revives are per hero', () => {
    const w = fragileWorld(true);
    withRevives(w, 1, 0);
    const [a, b] = [player(w, 0), player(w, 1)];
    expect(b.stats.revives).toBe(0);
    lethal(w, 1);
    expect(b.alive).toBe(false);
    runTicks(w, 4 * 60);
    expect(w.over).toBe(false);
    // the survivor is revived once, then dies for real → defeat
    lethal(w, 0);
    expect(a.alive).toBe(true);
    runTicks(w, 3.2 * 60);
    expect(w.over).toBe(false);
    lethal(w, 0);
    expect(a.alive).toBe(false);
    for (let i = 0; i < 300 && !w.over; i++) w.step([NO_INPUT]);
    expect(w.over).toBe(true);
    expect(w.result?.players.map((p) => p.alive)).toEqual([false, false]);
  });

  it('a defeat after killing bosses still reports them', () => {
    const w = bossWorld({ fragile: true });
    place(w, 0, 0);
    const b = spawnBoss(w, HORYEONG, false, 0, 15) as BossState;
    introOver(w, b);
    hit(w, bossRow(w, b));
    drainModals(w);
    place(w, 0, 0);
    lethal(w);
    for (let i = 0; i < 300 && !w.over; i++) {
      drainModals(w);
      w.step([NO_INPUT]);
    }
    expect(w.over).toBe(true);
    expect(w.result?.victory).toBe(false);
    expect(w.result?.bossesKilled).toEqual([HORYEONG]);
  });
});

/** all pickups of `kind` on the field */
function pickupsOf(w: World, kind: PickupKind): { id: number; value: number }[] {
  const P = w.pickups;
  const out: { id: number; value: number }[] = [];
  for (let i = 0; i < P.count; i++) if (P.kind[i] === kind) out.push({ id: P.id[i] as number, value: P.value[i] as number });
  return out;
}

describe('SIM-03: enemy & telegraph saturation safety for final boss and metins', () => {
  it('evicts a low-priority ordinary enemy when all 768 slots are full so the final boss spawns exactly once and can be killed for victory', () => {
    const w = bossWorld({ final: true });
    place(w, 0, 0);
    w.time = w.zone.final.at - 0.05;
    runTicks(w, 6);
    const g = w.metins.find((m) => m.great) as MetinState;
    expect(g).toBeDefined();
    until(w, () => g.phase !== MetinPhase.Falling, 5 * 60, 'great metin impact');

    // saturate every remaining enemy slot with ordinary (tier 0) wolves
    let k = 0;
    while (w.enemies.count < w.enemies.capacity) {
      const ang = (k++ * 2.399963) % (Math.PI * 2);
      const r = 35 + (k % 25);
      spawn(w, 'wolf', Math.cos(ang) * r, Math.sin(ang) * r);
    }
    expect(w.enemies.count).toBe(w.enemies.capacity);

    // step through the 3 s final-boss emergence window and confirm exactly one bossSpawn
    const spawns = watch(w, 5 * 60, ['bossSpawn']);
    expect(spawns).toHaveLength(1);
    expect(spawns[0]!.ev.final).toBe(true);
    expect(w.metinSys.finalBossSpawned).toBe(true);
    expect(w.bosses).toHaveLength(1);
    const b = w.bosses[0] as BossState;
    expect(b.final).toBe(true);
    expect(bossRow(w, b)).toBeGreaterThanOrEqual(0);

    // no duplicate final boss spawn on subsequent ticks
    expect(watch(w, 5 * 60, ['bossSpawn'])).toHaveLength(0);
    expect(w.bosses).toHaveLength(1);

    // wait out intro, kill final boss, and verify victory completes
    introOver(w, b);
    slay(w, bossRow(w, b));
    for (let i = 0; i < 600 && !w.over; i++) {
      drainModals(w);
      w.step([NO_INPUT]);
    }
    expect(w.over).toBe(true);
    expect(w.victory).toBe(true);
    expect(w.result?.victory).toBe(true);
  });

  it('keeps finalBossSpawned false when all 768 slots are non-evictable elites, then retries and spawns once a slot frees', () => {
    const w = bossWorld({ final: true });
    place(w, 0, 0);
    w.time = w.zone.final.at - 0.05;
    runTicks(w, 6);
    const g = w.metins.find((m) => m.great) as MetinState;
    until(w, () => g.phase !== MetinPhase.Falling, 5 * 60, 'great metin impact');

    let k = 0;
    while (w.enemies.count < w.enemies.capacity) {
      const ang = (k++ * 2.399963) % (Math.PI * 2);
      spawn(w, 'alpha_wolf', Math.cos(ang) * 45, Math.sin(ang) * 45, { tier: 1 });
    }
    expect(w.enemies.count).toBe(w.enemies.capacity);

    // wait well past the 3 s emergence time while all 768 slots are non-evictable
    runTicks(w, 5 * 60);
    expect(w.metinSys.finalBossSpawned).toBe(false);
    expect(w.bosses).toHaveLength(0);

    // free one elite slot -> next tick retries and spawns the final boss exactly once
    for (let i = 0; i < w.enemies.count; i++) {
      if (((w.enemies.flags[i] as number) & EnemyFlag.Metin) === 0) {
        w.enemies.free(i);
        w.spawner.alive = Math.max(0, w.spawner.alive - 1);
        w.hash.rebuild(w.enemies);
        break;
      }
    }
    const spawns = watch(w, 10, ['bossSpawn']);
    expect(spawns).toHaveLength(1);
    expect(spawns[0]!.ev.final).toBe(true);
    expect(w.metinSys.finalBossSpawned).toBe(true);
    expect(w.bosses).toHaveLength(1);

    const b = w.bosses[0] as BossState;
    introOver(w, b);
    slay(w, bossRow(w, b));
    for (let i = 0; i < 600 && !w.over; i++) {
      drainModals(w);
      w.step([NO_INPUT]);
    }
    expect(w.over).toBe(true);
    expect(w.victory).toBe(true);
  });

  it('handles full telegraph and enemy stores for metin fall/impact and enforces boss headroom on metin elites', () => {
    const w = bossWorld();
    place(w, 0, 0);
    w.zone.metins.types = ['metin_lament'];
    w.metinSys.finalStarted = false;

    // saturate all 128 telegraph rows with non-Metin damaging Impact telegraphs
    for (let i = 0; i < w.telegraphs.capacity; i++) {
      addTelegraph(w, {
        shape: TelegraphShape.Circle,
        x: 80 + i,
        z: 80,
        radius: 1,
        dur: 60,
        owner: 0,
        act: TelegraphAct.Impact,
        damage: 1,
      });
    }
    expect(w.telegraphs.count).toBe(w.telegraphs.capacity);

    // trigger an ordinary metin fall: MetinImpact evicts a non-Metin telegraph instead of dropping the warning
    w.metinSys.nextFallAt = 0;
    runTicks(w, 2);
    expect(w.metins).toHaveLength(1);
    const m = w.metins[0] as MetinState;
    expect(m.phase).toBe(MetinPhase.Falling);
    expect(m.tele).toBeGreaterThan(0);
    expect(w.telegraphs.find(m.tele)).toBeGreaterThanOrEqual(0);

    // simulate a lost telegraph AND a full store of non-evictable elites at impact time
    w.telegraphs.clear();
    m.tele = 0;
    m.warnLeft = 0.02;
    let k = 0;
    while (w.enemies.count < w.enemies.capacity) {
      const ang = (k++ * 2.399963) % (Math.PI * 2);
      spawn(w, 'alpha_wolf', Math.cos(ang) * 45, Math.sin(ang) * 45, { tier: 1 });
    }
    runTicks(w, 6);
    // stone still transitions out of Falling instead of remaining eternally falling
    expect(m.phase).toBe(MetinPhase.Alive);
    expect(m.enemy).toBe(0);

    // once one slot opens after DROP_ANIM, updateMetins attaches the hit-row and the stone becomes killable
    runTicks(w, 60);
    w.enemies.free(0);
    w.spawner.alive = Math.max(0, w.spawner.alive - 1);
    w.hash.rebuild(w.enemies);
    runTicks(w, 2);
    expect(m.enemy).toBeGreaterThan(0);
    const mRow = w.enemies.find(m.enemy);
    expect(mRow).toBeGreaterThanOrEqual(0);
    expect((w.enemies.flags[mRow] as number) & EnemyFlag.Invuln).toBe(0);
    expect(hit(w, mRow, 1e9)).toBeGreaterThan(0);
    expect(m.phase).toBe(MetinPhase.Broken);

    // verify spawnMetinElite respects enemy-cap boss headroom (capacity - 16)
    const w2 = bossWorld();
    place(w2, 0, 0);
    w2.zone.metins.types = ['metin_lament'];
    w2.metinSys.finalStarted = false;
    w2.metinSys.nextFallAt = 0;
    runTicks(w2, 2);
    const m2 = w2.metins[0] as MetinState;
    until(w2, () => m2.phase !== MetinPhase.Falling, 5 * 60, 'm2 impact');
    m2.phase = MetinPhase.Awakened;
    m2.eliteT = 0.01;
    let j = 0;
    while (w2.enemies.count < w2.enemies.capacity - 16) {
      const ang = (j++ * 2.399963) % (Math.PI * 2);
      spawn(w2, 'alpha_wolf', Math.cos(ang) * 45, Math.sin(ang) * 45, { tier: 1 });
    }
    const beforeElites = w2.enemies.count;
    runTicks(w2, 5);
    expect(w2.enemies.count).toBe(beforeElites);
  });
});
