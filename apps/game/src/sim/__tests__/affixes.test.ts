// EL-01: elite affixes - roll at spawn, the enemy store column and its compaction.
// EL-02 (second half of the file): what each affix does - swift, vampiric, warded, splitting. A behaviour keys on the store column only
// (a forced `affix` works with affixes.json disabled), so a run without an affixed row plays exactly as it did.

import { afterEach, describe, expect, it } from 'vitest';
import affixesJson from '../../data/content/affixes.json';
import { AFFIX_KINDS, DEFAULT_AFFIXES, type AffixesDef, type ContentDB } from '../../data/schema';
import { CoopHarness } from '../../net/coop/harness';
import type { MirrorWorld } from '../../net/coop/mirror';
import { applyStatus, hitEnemy, hurtPlayer, HurtKind, killEnemy, newHitCtx, type HitCtx } from '../combat';
import { CAP, ENEMY_SOFT_CAP, MAX_ATTACKS, Surface } from '../constants';
import { affixIdOf, affixKindOf, bandIndexAt, rollAffix, spawnEnemy } from '../enemies';
import { spawnable, updateSpawner } from '../spawner';
import { AffixId, EnemyFlag, EnemyState, EnemyStore, LOOT_XP_ONLY, PickupKind, StatusIdx } from '../stores';
import type { WorldEnv } from '../types';
import type { World } from '../world';
import { clearEnemies, collect, drainModals, dropSkills, freezeSchedules, makeWorld, NO_INPUT, player, runTicks, spawn, typeOf, type TestWorldOpts } from './helpers';

/** the fixture zone's bands start at 0, 120, 300, 540, 780 */
const BAND_START = [0, 120, 300, 540, 780];

function on(over: Partial<AffixesDef> = {}): (c: ContentDB) => void {
  return (c) => {
    c.affixes = { ...structuredClone(DEFAULT_AFFIXES), enabled: true, ...over };
  };
}

/** the fixture zone has no elites before band 1: give band 0 a pool too, so the spawner can be asked for a band 0 elite */
function withBand0Elites(inner: (c: ContentDB) => void): (c: ContentDB) => void {
  return (c) => {
    inner(c);
    const band0 = c.zones[0]?.bands[0];
    if (band0) band0.elites = { every: 60, pool: ['alpha_wolf'] };
  };
}

function elite(w: World, opts: Parameters<typeof spawnEnemy>[4] = {}): number {
  return spawn(w, 'alpha_wolf', 10, 10, { tier: 1, hpMul: 3, dmgMul: 1.3, source: 5, ...opts });
}

/** the affixes of `n` tier-1 elites spawned at sim time `t` */
function rolls(w: World, t: number, n: number): number[] {
  w.time = t;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    clearEnemies(w);
    out.push(w.enemies.affix[elite(w)] as number);
  }
  return out;
}

function rngState(w: World): string {
  return JSON.stringify(w.rng.spawn.getState());
}

describe('affix ids', () => {
  it('follow AFFIX_KINDS (swift 1 .. splitting 4) and fit the tier byte nibble', () => {
    expect(AFFIX_KINDS).toEqual(['swift', 'vampiric', 'warded', 'splitting']);
    expect([AffixId.Swift, AffixId.Vampiric, AffixId.Warded, AffixId.Splitting]).toEqual([1, 2, 3, 4]);
    for (const [i, k] of AFFIX_KINDS.entries()) {
      expect(affixIdOf(k)).toBe(i + 1);
      expect(affixKindOf(i + 1)).toBe(k);
    }
    expect(AFFIX_KINDS.length).toBeLessThan(16);
    expect(affixKindOf(AffixId.None)).toBeUndefined();
    expect(affixKindOf(15)).toBeUndefined();
  });

  it('the shipped affixes.json stays switched off (EL-03 turns it on)', () => {
    expect(affixesJson.enabled).toBe(false);
    const w = makeWorld();
    expect(w.ix.affixes.enabled).toBe(false);
  });
});

describe('bandIndexAt', () => {
  it('is the last band whose from is <= t', () => {
    const w = makeWorld();
    const bands = w.spawner.bands;
    expect(bands.map((b) => b.from)).toEqual(BAND_START);
    expect(bandIndexAt(bands, 0)).toBe(0);
    expect(bandIndexAt(bands, 119.99)).toBe(0);
    expect(bandIndexAt(bands, 120)).toBe(1);
    expect(bandIndexAt(bands, 779)).toBe(3);
    expect(bandIndexAt(bands, 5000)).toBe(4);
    expect(bandIndexAt([], 10)).toBe(0);
  });
});

describe('affixes disabled (default content)', () => {
  it('no affix and not one random draw, in any band', () => {
    for (const t of BAND_START) {
      const w = makeWorld();
      const twin = makeWorld();
      w.time = twin.time = t + 1;
      const before = rngState(w);
      expect(rngState(twin)).toBe(before);
      const row = elite(w);
      expect(w.enemies.affix[row]).toBe(AffixId.None);
      // the same call with the roll forced off draws exactly the same: the roll took nothing from rng.spawn
      elite(twin, { affix: 0 });
      expect(rngState(w)).toBe(rngState(twin));
      expect(rngState(w)).not.toBe(before); // the row's own variance draws did happen
      expect(rollAffix(w)).toBe(AffixId.None);
      expect(rngState(w)).toBe(rngState(twin));
    }
  });

  it('a world with affixes.json present but disabled keeps its rng stream and rows', () => {
    const a = makeWorld();
    const b = makeWorld({ content: (c) => (c.affixes = { ...structuredClone(DEFAULT_AFFIXES), enabled: false }) });
    a.time = b.time = 200;
    const ra = elite(a);
    const rb = elite(b);
    expect(rngState(a)).toBe(rngState(b));
    expect(a.enemies.x[ra]).toBe(b.enemies.x[rb]);
    expect(a.enemies.hp[ra]).toBe(b.enemies.hp[rb]);
    expect(a.enemies.affix[rb]).toBe(0);
  });
});

describe('affixes enabled', () => {
  it('rolls one affix for a tier-1 elite from fromBand on, none in band 0', () => {
    const w = makeWorld({ content: on() });
    expect(rolls(w, 1, 40)).toEqual(new Array(40).fill(0)); // band 0: plain (fromBand 1)
    expect(rolls(w, 119.5, 10).every((a) => a === 0)).toBe(true);
    for (const t of [120, 200, 300, 600, 850]) {
      const got = rolls(w, t, 30);
      expect(got.every((a) => a >= 1 && a <= 4)).toBe(true);
    }
  });

  it('band 0 draws nothing while it stays plain', () => {
    const w = makeWorld({ content: on() });
    const twin = makeWorld({ content: on() });
    w.time = twin.time = 10;
    elite(w);
    elite(twin, { affix: 0 });
    expect(rngState(w)).toBe(rngState(twin));
  });

  it('a roll is exactly one draw of rng.spawn, taken after the row is complete', () => {
    const w = makeWorld({ content: on() });
    const twin = makeWorld({ content: on() });
    w.time = twin.time = 200;
    const row = elite(w);
    const trow = elite(twin, { affix: 0 });
    // every other value of the row is the one of the forced-plain twin (the roll is the last draw)
    for (const k of ['x', 'z', 'hp', 'hpMax', 'scale', 'speed', 'aiA', 'aiB', 'dmgMul'] as const) expect(w.enemies[k][row]).toBe(twin.enemies[k][trow]);
    expect(w.enemies.affix[row]).toBeGreaterThanOrEqual(1);
    twin.rng.spawn.next(); // the one extra draw
    expect(rngState(w)).toBe(rngState(twin));
  });

  it('is deterministic: the same seed rolls the same affixes, another seed rolls others', () => {
    const run = (seed: number): number[] => rolls(makeWorld({ content: on(), config: { seed } }), 400, 60);
    expect(run(7)).toEqual(run(7));
    expect(run(7)).not.toEqual(run(8));
  });

  it('follows the weights', () => {
    const w = makeWorld({ content: on({ weights: { swift: 1, vampiric: 0, warded: 3, splitting: 0 } }) });
    const got = rolls(w, 400, 400);
    const count = (id: number): number => got.filter((a) => a === id).length;
    expect(count(AffixId.Vampiric)).toBe(0);
    expect(count(AffixId.Splitting)).toBe(0);
    expect(count(AffixId.Swift) + count(AffixId.Warded)).toBe(400);
    expect(count(AffixId.Warded)).toBeGreaterThan(count(AffixId.Swift) * 2); // 3 : 1
    // the default weights reach all four kinds
    const all = rolls(makeWorld({ content: on() }), 400, 400);
    for (const id of [1, 2, 3, 4]) expect(all.includes(id)).toBe(true);
  });

  it('fromBand moves the first affixed band', () => {
    const w0 = makeWorld({ content: on({ fromBand: 0 }) });
    expect(rolls(w0, 5, 20).every((a) => a >= 1)).toBe(true);
    const w2 = makeWorld({ content: on({ fromBand: 2 }) });
    expect(rolls(w2, 200, 20).every((a) => a === 0)).toBe(true); // band 1
    expect(rolls(w2, 300, 20).every((a) => a >= 1)).toBe(true); // band 2 starts at 300
  });

  it('rollAffix takes the first affixed band from its caller (the Elite Storm trial rolls from band 0)', () => {
    const w = makeWorld({ content: on() }); // affixes.json fromBand 1
    w.time = 10; // band 0
    expect(rollAffix(w)).toBe(AffixId.None);
    expect(rollAffix(w, 0)).toBeGreaterThanOrEqual(1);
    w.time = 200; // band 1
    expect(rollAffix(w, 2)).toBe(AffixId.None);
    expect(rollAffix(w, 1)).toBeGreaterThanOrEqual(1);
    // disabled content never rolls, whatever the caller asks
    const off = makeWorld();
    off.time = 200;
    const before = rngState(off);
    expect(rollAffix(off, 0)).toBe(AffixId.None);
    expect(rngState(off)).toBe(before);
  });

  it('only tier-1 elites roll: normal, champion and boss rows stay plain and draw nothing', () => {
    const w = makeWorld({ content: on() });
    w.time = 400;
    const before = rngState(w);
    for (const tier of [0, 2, 3]) {
      clearEnemies(w);
      const row = spawn(w, 'wolf', 5, 5, { tier });
      expect(w.enemies.affix[row]).toBe(0);
    }
    // the spawns above drew for their own variance, never for an affix: replay them on a disabled twin
    const twin = makeWorld();
    twin.time = 400;
    for (const tier of [0, 2, 3]) {
      clearEnemies(twin);
      spawn(twin, 'wolf', 5, 5, { tier });
    }
    expect(rngState(w)).toBe(rngState(twin));
    expect(rngState(w)).not.toBe(before);
  });

  it('opts.affix forces an affix (or none) without a draw, on any tier', () => {
    const w = makeWorld({ content: on() });
    const twin = makeWorld({ content: on() });
    w.time = twin.time = 400;
    const a = elite(w, { affix: AffixId.Warded });
    expect(w.enemies.affix[a]).toBe(AffixId.Warded);
    const b = spawn(w, 'wolf', 3, 3, { tier: 0, affix: AffixId.Swift });
    expect(w.enemies.affix[b]).toBe(AffixId.Swift);
    elite(twin, { affix: 0 });
    spawn(twin, 'wolf', 3, 3, { tier: 0, affix: 0 });
    expect(rngState(w)).toBe(rngState(twin));
  });

  it('a degenerate all-zero weight set rolls nothing instead of throwing', () => {
    const w = makeWorld({ content: on({ weights: { swift: 0, vampiric: 0, warded: 0, splitting: 0 } }) });
    expect(rolls(w, 400, 5)).toEqual([0, 0, 0, 0, 0]);
  });

  it("the spawner's elite timer produces an affixed elite in band 1+ and a plain one in band 0", () => {
    for (const [t, affixed] of [
      [30, false],
      [130, true],
      [650, true],
    ] as const) {
      const w = makeWorld({ content: withBand0Elites(on()) });
      freezeSchedules(w);
      w.time = t;
      w.spawner.eliteT = 0;
      const hero = player(w);
      hero.hp = hero.hpMax = 1e9;
      updateSpawner(w);
      const e = w.enemies;
      const elites: number[] = [];
      for (let i = 0; i < e.count; i++) if (e.eliteTier[i] === 1) elites.push(i);
      expect(elites).toHaveLength(1);
      expect((e.affix[elites[0] as number] as number) > 0).toBe(affixed);
    }
  });

  it('a 4 minute run with affixes on: every elite born in band 1+ carries an affix, every band 0 elite is plain, nothing else does', () => {
    const w = makeWorld({ content: withBand0Elites(on()), config: { seed: 21 } });
    w.metinSys.nextFallAt = 1e9;
    w.spawner.nextBoss = w.spawner.bosses.length;
    const hero = player(w);
    hero.hp = hero.hpMax = 1e9;
    w.spawner.eliteT = 5;
    // first sight of every elite row (rows die fast: look at every tick)
    const seen = new Map<number, { t: number; affix: number }>();
    const stray: string[] = [];
    for (let tick = 0; tick < 60 * 240; tick++) {
      drainModals(w);
      w.step([{ moveX: 0, moveZ: 0 }]);
      const e = w.enemies;
      for (let i = 0; i < e.count; i++) {
        const id = e.id[i] as number;
        if (e.affix[i] !== 0 && e.eliteTier[i] !== 1) stray.push(`tier ${e.eliteTier[i]} affix ${e.affix[i]}`);
        if (e.eliteTier[i] === 1 && !seen.has(id)) seen.set(id, { t: w.time, affix: e.affix[i] as number });
      }
    }
    expect(stray).toEqual([]);
    const born = [...seen.values()];
    const early = born.filter((b) => b.t < 119);
    const late = born.filter((b) => b.t >= 121);
    expect(early.length).toBeGreaterThan(0);
    expect(late.length).toBeGreaterThan(0);
    expect(early.every((b) => b.affix === 0)).toBe(true);
    expect(late.every((b) => b.affix >= 1 && b.affix <= 4)).toBe(true);
  }, 60_000);
});

describe('the affix column of the enemy store', () => {
  it('is zeroed on alloc and moves with its row when a row is swap-removed', () => {
    const s = new EnemyStore(16);
    const rows = [s.alloc(), s.alloc(), s.alloc(), s.alloc()];
    expect(rows).toEqual([0, 1, 2, 3]);
    const ids = rows.map((r) => s.id[r] as number);
    for (const [i, r] of rows.entries()) {
      s.affix[r] = i + 1;
      s.eliteTier[r] = i === 0 ? 0 : 1;
    }
    s.free(1); // the last row (affix 4) moves into row 1
    expect(s.count).toBe(3);
    expect(s.find(ids[3] as number)).toBe(1);
    expect(s.affix[1]).toBe(4);
    expect(s.affix[0]).toBe(1);
    expect(s.find(ids[2] as number)).toBe(2);
    expect(s.affix[2]).toBe(3);
    // the freed tail row is reused clean
    const r = s.alloc();
    expect(r).toBe(3);
    expect(s.affix[r]).toBe(0);
    expect(s.eliteTier[r]).toBe(0);
    // freeing the last row just drops it
    s.free(3);
    expect(s.affix[0]).toBe(1);
    s.clear();
    expect(s.count).toBe(0);
    expect(s.affix[s.alloc()]).toBe(0);
  });

  it('survives a real sweep of dead rows in a world', () => {
    const w = makeWorld({ content: on() });
    w.time = 400;
    freezeSchedules(w);
    const a = elite(w, { affix: AffixId.Swift });
    const b = elite(w, { affix: AffixId.Vampiric });
    const c = elite(w, { affix: AffixId.Splitting });
    const idC = w.enemies.id[c] as number;
    const idB = w.enemies.id[b] as number;
    expect([a, b, c]).toEqual([0, 1, 2]);
    w.enemies.free(a);
    expect(w.enemies.affix[w.enemies.find(idC)]).toBe(AffixId.Splitting);
    expect(w.enemies.affix[w.enemies.find(idB)]).toBe(AffixId.Vampiric);
  });
});

// ===========================================================================
// EL-02: the behaviours

/** a quiet arena: schedules frozen, no enemies, no hero skills, crit off, a hero that survives anything, content with affixes on */
function arena(opts: TestWorldOpts = {}): World {
  const w = makeWorld({ content: on(), ...opts });
  freezeSchedules(w);
  clearEnemies(w);
  dropSkills(w);
  const hero = player(w);
  hero.stats.critChance = 0;
  hero.hp = hero.hpMax = 1e9;
  hero.iframes = 0;
  w.bus.clear();
  return w;
}

function ctx(over: Partial<HitCtx> = {}): HitCtx {
  return Object.assign(newHitCtx(), { player: 0, noCrit: true }, over);
}

function handleOf(w: World, row: number): number {
  return w.enemies.id[row] as number;
}

/** pin a row: it can still walk and strike, but is never relocated */
function pin(w: World, row: number, extra = 0): void {
  w.enemies.flags[row] = (w.enemies.flags[row] as number) | EnemyFlag.Pinned | extra;
}

/** a tier-1 elite of fixed move speed 4 with `hp` of `hpMax` HP */
function eliteOf(w: World, type: string, affix: number, x: number, z: number, hp = 1000, hpMax = hp): number {
  const row = spawn(w, type, x, z, { tier: 1, hpMul: 3, dmgMul: 1.3, source: 5, affix });
  w.enemies.baseSpeed[row] = 4;
  w.enemies.hp[row] = hp;
  w.enemies.hpMax[row] = hpMax;
  return row;
}

/** hurt the hero (player 0) with a melee blow from the elite `row`; returns the HP the hero lost */
function strike(w: World, row: number, amount = 40): number {
  const hero = player(w);
  hero.iframes = 0;
  const before = hero.hp;
  hurtPlayer(w, 0, amount, w.enemies.x[row] as number, w.enemies.z[row] as number, 0, HurtKind.Melee, handleOf(w, row));
  return before - hero.hp;
}

/** content: affixes on, and the fixture wolf attacks with an aura only */
function auraWolf(c: ContentDB): void {
  on()(c);
  const d = c.enemies.find((x) => x.id === 'wolf');
  if (d) d.attacks = [{ kind: 'aura', range: 3, cooldown: 1, windup: 0, damageMul: 1 }];
}

describe('swift (EL-02)', () => {
  it('moves 35 % faster than a plain twin, also while slowed', () => {
    const w = arena();
    const plain = eliteOf(w, 'wolf', AffixId.None, 40, 0);
    const swift = eliteOf(w, 'wolf', AffixId.Swift, -40, 0);
    runTicks(w, 1);
    expect(w.enemies.speed[plain]).toBeCloseTo(4, 5);
    expect(w.enemies.speed[swift]).toBeCloseTo(4 * 1.35, 5);
    // distance covered towards the hero in 40 ticks
    const x0 = [w.enemies.x[plain] as number, w.enemies.x[swift] as number];
    runTicks(w, 40);
    const dPlain = Math.abs((w.enemies.x[plain] as number) - (x0[0] as number));
    const dSwift = Math.abs((w.enemies.x[swift] as number) - (x0[1] as number));
    expect(dSwift / dPlain).toBeCloseTo(1.35, 2);
    // a slow takes its share first, the affix multiplies what is left
    applyStatus(w, plain, StatusIdx.Slow, 5, 0.5, -1, false);
    applyStatus(w, swift, StatusIdx.Slow, 5, 0.5, -1, false);
    runTicks(w, 1);
    expect(w.enemies.speed[plain]).toBeCloseTo(2, 5);
    expect(w.enemies.speed[swift]).toBeCloseTo(2 * 1.35, 5);
  });

  it('takes its speed bonus from affixes.json', () => {
    const w = arena({ content: on({ params: { ...DEFAULT_AFFIXES.params, swift: { speed: 0.6, attackRate: 0.2 } } }) });
    const swift = eliteOf(w, 'wolf', AffixId.Swift, -40, 0);
    runTicks(w, 1);
    expect(w.enemies.speed[swift]).toBeCloseTo(4 * 1.6, 5);
  });

  it('attacks 20 % more often over a minute next to the hero (four seeds, same windup)', () => {
    let plainN = 0;
    let swiftN = 0;
    for (const seed of [3, 4, 5, 6]) {
      for (const affix of [AffixId.None, AffixId.Swift]) {
        const w = arena({ config: { seed } });
        const row = eliteOf(w, 'wolf', affix, 0.9, 0);
        pin(w, row);
        const handle = handleOf(w, row);
        const n = collect(w, 60 * 60, ['enemyAttack']).filter((e) => e.enemy === handle).length;
        if (affix === AffixId.Swift) swiftN += n;
        else plainN += n;
      }
    }
    expect(plainN).toBeGreaterThan(150);
    expect(swiftN / plainN).toBeGreaterThan(1.15);
    expect(swiftN / plainN).toBeLessThan(1.26);
  });

  it('keeps the windup of every telegraph and takes the gain out of the cooldown', () => {
    for (const affix of [AffixId.None, AffixId.Swift]) {
      const w = arena({ config: { seed: 11 } });
      const row = eliteOf(w, 'wolf', affix, 0.9, 0);
      const atk = w.typeDefs[w.enemies.type[row] as number]?.attacks[0];
      expect(atk).toBeDefined();
      const windup = atk?.windup ?? 0;
      const cooldown = atk?.cooldown ?? 0;
      // run to the first strike: the row leaves Windup into Recover, and atkReady was set from the cooldown
      let seenWindup = -1;
      let ready = 0;
      for (let i = 0; i < 600 && ready === 0; i++) {
        w.step([NO_INPUT]);
        if (w.enemies.state[row] === EnemyState.Windup && seenWindup < 0) seenWindup = w.enemies.aiT[row] as number;
        if (w.enemies.state[row] === EnemyState.Recover) ready = (w.enemies.atkReady[row * MAX_ATTACKS] as number) - w.time;
      }
      expect(seenWindup).toBeCloseTo(windup, 6);
      const span = (j: number): number => (affix === AffixId.Swift ? (windup + cooldown * j) / 1.2 - windup : cooldown * j);
      expect(ready).toBeGreaterThan(span(0.9) - 0.05);
      expect(ready).toBeLessThan(span(1.1) + 0.05);
    }
  });

  it('an aura ticks 20 % faster', () => {
    const count = (affix: number): number => {
      const w = arena({ content: auraWolf });
      const row = eliteOf(w, 'wolf', affix, 1, 0);
      pin(w, row);
      return collect(w, 60 * 30, ['enemyAttack']).length;
    };
    const plain = count(AffixId.None);
    const swift = count(AffixId.Swift);
    expect(plain).toBeGreaterThan(20);
    expect(swift / plain).toBeCloseTo(1.2, 1);
  });

  it('a plain elite keeps its speed', () => {
    const w = arena();
    const row = eliteOf(w, 'wolf', AffixId.None, 30, 0);
    runTicks(w, 1);
    expect(w.enemies.speed[row]).toBeCloseTo(4, 5);
  });
});

describe('vampiric (EL-02)', () => {
  it('heals 25 % of the damage its blow takes from the hero, on every blow', () => {
    const w = arena();
    const row = eliteOf(w, 'wolf', AffixId.Vampiric, 5, 0, 500, 1000);
    const lost = strike(w, row, 40);
    expect(lost).toBeGreaterThan(5);
    expect(w.enemies.hp[row]).toBeCloseTo(500 + lost * 0.25, 4);
    const lost2 = strike(w, row, 60);
    expect(w.enemies.hp[row]).toBeCloseTo(500 + (lost + lost2) * 0.25, 4);
  });

  it('plain elites and the other affixes do not heal', () => {
    for (const affix of [AffixId.None, AffixId.Swift, AffixId.Warded, AffixId.Splitting]) {
      const w = arena();
      const row = eliteOf(w, 'wolf', affix, 5, 0, 500, 1000);
      strike(w, row, 40);
      expect(w.enemies.hp[row]).toBe(500);
    }
  });

  it('takes the share from affixes.json and never heals above the maximum', () => {
    const w = arena({ content: on({ params: { ...DEFAULT_AFFIXES.params, vampiric: { heal: 0.5 } } }) });
    const row = eliteOf(w, 'wolf', AffixId.Vampiric, 5, 0, 500, 1000);
    const lost = strike(w, row, 40);
    expect(w.enemies.hp[row]).toBeCloseTo(500 + lost * 0.5, 4);
    w.enemies.hp[row] = 999.99;
    strike(w, row, 200);
    expect(w.enemies.hp[row]).toBeCloseTo(1000, 3);
    expect(w.enemies.hp[row]).toBeLessThanOrEqual(1000);
  });

  it('heals only for damage that reaches the hero HP: a shield, i-frames and a dead hero heal nothing', () => {
    const w = arena();
    const row = eliteOf(w, 'wolf', AffixId.Vampiric, 5, 0, 500, 1000);
    const hero = player(w);
    hero.shield = 1e9;
    strike(w, row, 40);
    expect(w.enemies.hp[row]).toBe(500);
    hero.shield = 0;
    hero.iframes = 5;
    hurtPlayer(w, 0, 40, 5, 0, 0, HurtKind.Melee, handleOf(w, row));
    expect(w.enemies.hp[row]).toBe(500);
    hero.iframes = 0;
    hero.alive = false;
    expect(hurtPlayer(w, 0, 40, 5, 0, 0, HurtKind.Melee, handleOf(w, row))).toBe(false);
    expect(w.enemies.hp[row]).toBe(500);
  });

  it('an overkill heals by the HP the hero had left; after a revive the next blow heals again', () => {
    const w = arena();
    const row = eliteOf(w, 'wolf', AffixId.Vampiric, 5, 0, 500, 1000);
    const hero = player(w);
    hero.stats.revives = 1;
    hero.hp = 10;
    hero.hpMax = 200;
    strike(w, row, 1e6);
    expect(w.enemies.hp[row]).toBeCloseTo(500 + 10 * 0.25, 4);
    expect(hero.alive).toBe(true); // the revive took the lethal blow
    expect(hero.hp).toBeCloseTo(100, 4);
    const lost = strike(w, row, 40);
    expect(w.enemies.hp[row]).toBeCloseTo(500 + 10 * 0.25 + lost * 0.25, 4);
  });

  it('a striker that is gone (a stale handle) heals nothing and throws nothing', () => {
    const w = arena();
    const row = eliteOf(w, 'wolf', AffixId.Vampiric, 5, 0, 500, 1000);
    const handle = handleOf(w, row);
    w.enemies.free(row);
    player(w).iframes = 0;
    expect(hurtPlayer(w, 0, 40, 5, 0, 0, HurtKind.Melee, handle)).toBe(true);
  });

  it('a real melee blow in the sim heals the elite by 25 % of the playerHit amount, every blow of 40 s', () => {
    const w = arena();
    const row = eliteOf(w, 'wolf', AffixId.Vampiric, 0.9, 0, 400, 1000);
    pin(w, row);
    const hero = player(w);
    hero.hp = hero.hpMax = 5000;
    let hp = 400;
    let hits = 0;
    for (let i = 0; i < 60 * 40; i++) {
      w.step([NO_INPUT]);
      for (const ev of w.events) {
        if (ev.t !== 'playerHit' || ev.amount <= 0) continue;
        hits++;
        hp = Math.min(1000, hp + ev.amount * 0.25);
        expect(w.enemies.hp[row]).toBeCloseTo(hp, 3);
      }
    }
    expect(hits).toBeGreaterThan(10);
  });

  it('a ranged elite heals from its bolts (the bolt carries the shooter); a plain shooter heals nothing', () => {
    const run = (affix: number): { hits: number; gain: number } => {
      const w = arena({ config: { seed: 5 } });
      const row = eliteOf(w, 'spitter', affix, 6, 0, 400, 1000);
      pin(w, row);
      const hero = player(w);
      hero.hp = hero.hpMax = 5000;
      let hits = 0;
      let gain = 0;
      let seen = 400;
      for (let i = 0; i < 60 * 40; i++) {
        w.step([NO_INPUT]);
        const now = w.enemies.hp[row] as number;
        for (const ev of w.events) {
          if (ev.t !== 'playerHit' || ev.amount <= 0) continue;
          hits++;
          gain += now - seen;
          if (affix === AffixId.Vampiric) expect(now - seen).toBeCloseTo(ev.amount * 0.25, 3);
        }
        seen = now;
      }
      return { hits, gain };
    };
    const vamp = run(AffixId.Vampiric);
    const plain = run(AffixId.None);
    expect(vamp.hits).toBeGreaterThan(5);
    expect(vamp.gain).toBeGreaterThan(5);
    expect(plain.hits).toBeGreaterThan(5);
    expect(plain.gain).toBe(0);
  });

  it('a bolt whose shooter died heals nobody (and the bystander vampire keeps its HP)', () => {
    const w = arena({ config: { seed: 5 } });
    const row = eliteOf(w, 'spitter', AffixId.Vampiric, 6, 0, 400, 1000);
    pin(w, row);
    const bystander = eliteOf(w, 'wolf', AffixId.Vampiric, 80, 0, 300, 1000);
    const bystanderHandle = handleOf(w, bystander);
    pin(w, bystander);
    const hero = player(w);
    hero.hp = hero.hpMax = 5000;
    let fired = false;
    for (let i = 0; i < 60 * 10 && !fired; i++) {
      w.step([NO_INPUT]);
      fired = w.projectiles.count > 0;
    }
    expect(fired).toBe(true);
    w.enemies.free(w.enemies.find(handleOf(w, row)));
    let hit = false;
    for (let i = 0; i < 60 * 3; i++) {
      w.step([NO_INPUT]);
      if (w.events.some((e) => e.t === 'playerHit' && e.amount > 0)) hit = true;
    }
    expect(hit).toBe(true);
    expect(w.enemies.hp[w.enemies.find(bystanderHandle)]).toBe(300);
  });

  it('an aura heals the elite that burns the hero', () => {
    const w = arena({ content: auraWolf });
    const row = eliteOf(w, 'wolf', AffixId.Vampiric, 1, 0, 300, 1000);
    pin(w, row);
    let hits = 0;
    let seen = 300;
    for (let i = 0; i < 60 * 12; i++) {
      w.step([NO_INPUT]);
      const now = w.enemies.hp[row] as number;
      for (const ev of w.events) {
        if (ev.t !== 'playerHit' || ev.amount <= 0) continue;
        hits++;
        expect(now - seen).toBeCloseTo(ev.amount * 0.25, 3);
      }
      seen = now;
    }
    expect(hits).toBeGreaterThan(3);
  });
});

describe('warded (EL-02)', () => {
  it('takes 40 % less from a hit while above half HP, full damage from half down (a blow across the line is still reduced)', () => {
    const w = arena();
    const plain = eliteOf(w, 'wolf', AffixId.None, 40, 0);
    const warded = eliteOf(w, 'wolf', AffixId.Warded, -40, 0);
    expect(hitEnemy(w, plain, 100, ctx())).toBeCloseTo(100, 5);
    expect(hitEnemy(w, warded, 100, ctx())).toBeCloseTo(60, 5);
    expect(w.enemies.hp[warded]).toBeCloseTo(940, 4);
    // exactly half is not "above"
    w.enemies.hp[warded] = 500;
    expect(hitEnemy(w, warded, 100, ctx())).toBeCloseTo(100, 5);
    w.enemies.hp[warded] = 500.01;
    expect(hitEnemy(w, warded, 100, ctx())).toBeCloseTo(60, 5);
    // 520 HP and a blow of 800: reduced to 480, it lands at 40; the next one takes its full value
    w.enemies.hp[warded] = 520;
    expect(hitEnemy(w, warded, 800, ctx())).toBeCloseTo(480, 4);
    expect(w.enemies.hp[warded]).toBeCloseTo(40, 3);
    expect(hitEnemy(w, warded, 10, ctx())).toBeCloseTo(10, 5);
  });

  it('takes the numbers from affixes.json', () => {
    const w = arena({ content: on({ params: { ...DEFAULT_AFFIXES.params, warded: { reduction: 0.9, above: 0.8 } } }) });
    const warded = eliteOf(w, 'wolf', AffixId.Warded, -40, 0);
    expect(hitEnemy(w, warded, 100, ctx())).toBeCloseTo(10, 5);
    w.enemies.hp[warded] = 790;
    expect(hitEnemy(w, warded, 100, ctx())).toBeCloseTo(100, 5);
  });

  it('applies to damage over time too, and to no other affix', () => {
    const w = arena();
    const plain = eliteOf(w, 'wolf', AffixId.None, 400, 400);
    const warded = eliteOf(w, 'wolf', AffixId.Warded, -400, 400);
    const swift = eliteOf(w, 'wolf', AffixId.Swift, 400, -400);
    for (const r of [plain, warded, swift]) {
      pin(w, r);
      applyStatus(w, r, StatusIdx.Burn, 4, 20, -1, false);
    }
    runTicks(w, 60 * 3);
    const lost = (r: number): number => 1000 - (w.enemies.hp[r] as number);
    expect(lost(plain)).toBeGreaterThan(30);
    expect(lost(swift)).toBeCloseTo(lost(plain), 3);
    expect(lost(warded) / lost(plain)).toBeCloseTo(0.6, 2);
    // below half HP the burn lands in full
    w.enemies.hp[warded] = 400;
    w.enemies.hp[plain] = 400;
    applyStatus(w, warded, StatusIdx.Burn, 4, 20, -1, false);
    applyStatus(w, plain, StatusIdx.Burn, 4, 20, -1, false);
    runTicks(w, 60);
    expect(400 - (w.enemies.hp[warded] as number)).toBeCloseTo(400 - (w.enemies.hp[plain] as number), 3);
  });

  it('a warded elite below half HP dies to one blow, and counts as an elite kill', () => {
    const w = arena();
    const warded = eliteOf(w, 'wolf', AffixId.Warded, 10, 0, 40, 100);
    expect(hitEnemy(w, warded, 100, ctx())).toBeCloseTo(100, 5);
    expect(w.enemies.state[warded]).toBe(EnemyState.Dying);
    expect(w.tally.elitesKilled).toBe(1);
  });

  it('a blow that would kill from above half HP is reduced and does not', () => {
    const w = arena();
    const warded = eliteOf(w, 'wolf', AffixId.Warded, 10, 0, 100);
    expect(hitEnemy(w, warded, 70, ctx())).toBeCloseTo(42, 5);
    expect(w.enemies.state[warded]).not.toBe(EnemyState.Dying);
  });
});

/** the live (not dying) rows */
function liveRows(w: World): number[] {
  const out: number[] = [];
  for (let i = 0; i < w.enemies.count; i++) if (w.enemies.state[i] !== EnemyState.Dying) out.push(i);
  return out;
}

/** the values of the pickups of one kind */
function pickupValues(w: World, kind: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < w.pickups.count; i++) if (w.pickups.kind[i] === kind) out.push(w.pickups.value[i] as number);
  return out;
}

describe('splitting (EL-02)', () => {
  it('leaves two small tier-0 copies at 30 % of the elite HP, XP only, standing round the corpse', () => {
    const w = arena();
    const row = eliteOf(w, 'alpha_wolf', AffixId.Splitting, 10, 10, 900);
    const type = w.enemies.type[row] as number;
    const def = w.typeDefs[type];
    w.bus.clear();
    expect(w.spawner.alive).toBe(1);
    killEnemy(w, row, 0, -1, false);
    const copies = liveRows(w);
    expect(copies).toHaveLength(2);
    expect(w.spawner.alive).toBe(2);
    for (const c of copies) {
      expect(w.enemies.type[c]).toBe(type);
      expect(w.enemies.eliteTier[c]).toBe(0);
      expect(w.enemies.affix[c]).toBe(AffixId.None);
      expect(w.enemies.flags[c]).toBe(0);
      expect(w.enemies.lootTier[c]).toBe(LOOT_XP_ONLY);
      expect(w.enemies.hp[c]).toBeCloseTo(270, 3);
      expect(w.enemies.hpMax[c]).toBeCloseTo(270, 3);
      expect(w.enemies.state[c]).toBe(EnemyState.Spawn); // stands up before it strikes
      expect(w.enemies.scale[c]).toBeLessThan((def?.scale ?? 1) * 0.9);
      const d = Math.hypot((w.enemies.x[c] as number) - 10, (w.enemies.z[c] as number) - 10);
      expect(d).toBeGreaterThanOrEqual(0.8 - 1e-6);
      expect(d).toBeLessThanOrEqual(1.8 + 1e-6);
    }
    // the spawn events say summon (4), never elite (5): the hint system keys on the elite source
    const spawns = w.events.filter((e) => e.t === 'enemySpawn');
    expect(spawns).toHaveLength(2);
    for (const e of spawns) {
      if (e.t !== 'enemySpawn') continue;
      expect(e.source).toBe(4);
      expect(e.tier).toBe(0);
    }
    // the elite itself paid out its usual loot (a gem and yeop)
    expect(pickupValues(w, PickupKind.Xp)).toHaveLength(1);
    expect(pickupValues(w, PickupKind.Yeop).length).toBeGreaterThan(0);
  });

  it('a copy drops its XP and nothing else; its kill counts, as no elite', () => {
    const w = arena();
    const row = eliteOf(w, 'alpha_wolf', AffixId.Splitting, 10, 10, 900);
    killEnemy(w, row, 0, -1, false);
    const [a, b] = liveRows(w) as [number, number];
    const def = w.typeDefs[w.enemies.type[a] as number];
    const gems0 = pickupValues(w, PickupKind.Xp).length;
    const all0 = w.pickups.count;
    killEnemy(w, a, 0, -1, false);
    killEnemy(w, b, 0, -1, false);
    expect(w.pickups.count).toBe(all0 + 2);
    const gems = pickupValues(w, PickupKind.Xp);
    expect(gems).toHaveLength(gems0 + 2);
    const expected = (def?.xp ?? 0) * w.diff.reward * (1 + 0.5 * w.corruption) * w.mods.xp;
    expect(gems[gems0]).toBeCloseTo(expected, 5);
    expect(gems[gems0 + 1]).toBeCloseTo(expected, 5);
    expect(pickupValues(w, PickupKind.Heal)).toHaveLength(0);
    expect(pickupValues(w, PickupKind.Chest)).toHaveLength(0);
    expect(pickupValues(w, PickupKind.Magnet)).toHaveLength(0);
    expect(w.tally.kills).toBe(3);
    expect(w.tally.elitesKilled).toBe(1);
    // the copies are tier 0 without an affix: nothing splits again
    expect(liveRows(w)).toHaveLength(0);
    expect(w.spawner.alive).toBe(0);
  });

  it('no copies from the other affixes, from a plain elite, or in the final collapse (w.noLoot)', () => {
    for (const affix of [AffixId.None, AffixId.Swift, AffixId.Vampiric, AffixId.Warded]) {
      const w = arena();
      killEnemy(w, eliteOf(w, 'wolf', affix, 10, 10), 0, -1, false);
      expect(liveRows(w)).toHaveLength(0);
    }
    const w = arena();
    const row = eliteOf(w, 'wolf', AffixId.Splitting, 10, 10);
    w.noLoot = true;
    killEnemy(w, row, -1, -1, false);
    w.noLoot = false;
    expect(liveRows(w)).toHaveLength(0);
  });

  it('copies and HP come from affixes.json (3 copies at half HP); on hard with Run Options up the copies keep 30 % of the scaled elite HP', () => {
    const w = arena({ content: on({ params: { ...DEFAULT_AFFIXES.params, splitting: { copies: 3, hp: 0.5 } } }) });
    killEnemy(w, eliteOf(w, 'wolf', AffixId.Splitting, 10, 10, 800), 0, -1, false);
    const rows = liveRows(w);
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(w.enemies.hp[r]).toBeCloseTo(400, 3);

    const hard = arena({ config: { difficulty: 'hard', runOptions: { health: 2, damage: 2, speed: 1.5, density: 1.5 } } });
    const e = spawn(hard, 'alpha_wolf', 10, 10, { tier: 1, hpMul: 3, dmgMul: 1.3, affix: AffixId.Splitting });
    const eliteMax = hard.enemies.hpMax[e] as number;
    expect(eliteMax).toBeGreaterThan(160 * 3);
    killEnemy(hard, e, 0, -1, false);
    const hr = liveRows(hard);
    expect(hr).toHaveLength(2);
    for (const r of hr) {
      expect(hard.enemies.hp[r]).toBeCloseTo(eliteMax * 0.3, 2);
      // a copy runs at the Run Options speed like any creature
      expect(hard.enemies.baseSpeed[r]).toBeGreaterThan(3.8 * hard.options.speed * 0.9);
    }
  });

  it('none over the soft enemy cap, one at it, two below it, and a full store throws nothing', () => {
    // the elite's own death takes it off the alive count first; a copy is made while the count is below the cap
    for (const [alive, copies] of [
      [ENEMY_SOFT_CAP + 1, 0],
      [ENEMY_SOFT_CAP, 1],
      [ENEMY_SOFT_CAP - 1, 2],
    ] as const) {
      const w = arena();
      const row = eliteOf(w, 'wolf', AffixId.Splitting, 10, 10);
      w.spawner.alive = alive;
      killEnemy(w, row, 0, -1, false);
      expect(liveRows(w)).toHaveLength(copies);
    }

    const w3 = arena();
    const row3 = eliteOf(w3, 'wolf', AffixId.Splitting, 10, 10);
    while (w3.enemies.count < CAP.enemies) spawn(w3, 'wolf', 50, 50);
    w3.spawner.alive = 0;
    killEnemy(w3, row3, 0, -1, false);
    expect(w3.enemies.count).toBe(CAP.enemies);
    expect(w3.enemies.state[row3]).toBe(EnemyState.Dying);
  });

  describe('placement (placeWalkable): never in blocked ground', () => {
    const R = 150;
    const SEEDS = Array.from({ length: 80 }, (_, i) => i + 1);

    /** kill a splitting elite standing at (x, z) in a world on `env`: the spots of the copies */
    function split(env: WorldEnv, x: number, z: number, seed: number): { at: { x: number; z: number }[]; w: World } {
      const w = arena({ env: { arenaRadius: R, ...env }, config: { seed } });
      const row = eliteOf(w, 'wolf', AffixId.Splitting, x, z);
      killEnemy(w, row, 0, -1, false);
      const at = liveRows(w).map((r) => ({ x: w.enemies.x[r] as number, z: w.enemies.z[r] as number }));
      return { at, w };
    }

    it('at the arena edge: both copies on ground and no farther out than the corpse, almost all of them inside the placement limit', () => {
      let inside = 0;
      let total = 0;
      for (const angle of [0, 0.8, 2.1, 3.3, 4.7, 5.9]) {
        for (const seed of SEEDS.slice(0, 40)) {
          const { at, w } = split({}, Math.sin(angle) * (R - 0.4), Math.cos(angle) * (R - 0.4), seed);
          expect(at).toHaveLength(2);
          for (const p of at) {
            const r = Math.hypot(p.x, p.z);
            // placeWalkable's last resort is the anchor itself (the corpse's own spot, still inside the arena); the rows are Float32
            expect(r).toBeLessThanOrEqual(R - 0.4 + 1e-3);
            expect(spawnable(w, p.x, p.z)).toBe(true);
            total++;
            if (r <= R - 1.5 + 1e-3) inside++;
          }
        }
      }
      expect(inside / total).toBeGreaterThan(0.9);
    });

    it('on a shore: no copy in deep water, with the elite on the bank of a lake and on a causeway', () => {
      const lake = (x: number): number => (x > 0 ? Surface.Deep : Surface.Ground);
      for (const ex of [-0.1, -0.5, -1.2]) {
        for (const seed of SEEDS) {
          const { at, w } = split({ surfaceAt: (x) => lake(x) }, ex, 20, seed);
          expect(at).toHaveLength(2);
          for (const p of at) {
            expect(lake(p.x)).toBe(Surface.Ground);
            expect(spawnable(w, p.x, p.z)).toBe(true);
          }
        }
      }
      // a 2 m wide causeway with deep water either side: the copies stay on it
      const strip: WorldEnv = { surfaceAt: (x) => (Math.abs(x) <= 1 ? Surface.Ground : Surface.Deep) };
      for (const seed of SEEDS) {
        const { at } = split(strip, 0, 30, seed);
        expect(at).toHaveLength(2);
        for (const p of at) expect(Math.abs(p.x)).toBeLessThanOrEqual(1 + 1e-9);
      }
    });

    it('beside lava and a wall: every copy stands on walkable ground', () => {
      const env: WorldEnv = {
        walkable: (x, z) => !(x > 1 && x < 6 && z > -50 && z < 50),
        surfaceAt: (x, z) => (x <= 1 && x > -3 && z > 10 && z < 14 ? Surface.Lava : Surface.Ground),
      };
      for (const [ex, ez] of [
        [0.5, 0],
        [0.2, 8],
        [-0.5, 15],
        [-3.2, 12],
      ] as const) {
        for (const seed of SEEDS) {
          const { at, w } = split(env, ex, ez, seed);
          expect(at.length).toBeGreaterThan(0);
          for (const p of at) expect(spawnable(w, p.x, p.z)).toBe(true);
        }
      }
    });

    it('a pocket of open ground inside a blocker field: the copies stay in the pocket', () => {
      const env: WorldEnv = { walkable: (x, z) => Math.hypot(x - 30, z) <= 2.5 || Math.hypot(x - 30, z) > 45 };
      for (const seed of SEEDS) {
        const { at } = split(env, 30, 0, seed);
        expect(at).toHaveLength(2);
        for (const p of at) expect(Math.hypot(p.x - 30, p.z)).toBeLessThanOrEqual(2.5 + 1e-9);
      }
    });

    it('an elite whose own spot is not walkable (it fell into lava) leaves no copies', () => {
      const { at } = split({ surfaceAt: () => Surface.Lava }, 4, -6, 9);
      expect(at).toHaveLength(0);
    });

    it('is deterministic per seed, varies across seeds and draws only from rng.spawn', () => {
      const a = split({}, 12, 7, 31);
      const b = split({}, 12, 7, 31);
      expect(a.at).toEqual(b.at);
      expect(new Set(SEEDS.map((s) => split({}, 12, 7, s).at[0]?.x.toFixed(3))).size).toBeGreaterThan(40);
      // a twin whose elite is plain: the kill draws the same loot, combat, ai ... numbers; only rng.spawn differs
      const others = (x: World): string => JSON.stringify([x.rng.combat.getState(), x.rng.loot.getState(), x.rng.metin.getState(), x.rng.boss.getState(), x.rng.cards.getState(), x.rng.ai.getState()]);
      const w = arena({ config: { seed: 31 } });
      const twin = arena({ config: { seed: 31 } });
      const row = eliteOf(w, 'wolf', AffixId.Splitting, 12, 7);
      const trow = eliteOf(twin, 'wolf', AffixId.None, 12, 7);
      const spawnBefore = JSON.stringify(w.rng.spawn.getState());
      killEnemy(w, row, 0, -1, false);
      killEnemy(twin, trow, 0, -1, false);
      expect(others(w)).toBe(others(twin));
      expect(JSON.stringify(w.rng.spawn.getState())).not.toBe(spawnBefore);
      expect(JSON.stringify(twin.rng.spawn.getState())).toBe(spawnBefore);
    });

    it('copies that stand up on a shore stay off the water for the next 8 s of play', () => {
      const dry = (x: number): boolean => x <= 0;
      const w = arena({ env: { arenaRadius: R, walkable: (x) => dry(x), surfaceAt: (x) => (dry(x) ? Surface.Ground : Surface.Deep) }, config: { seed: 8 } });
      const hero = player(w);
      hero.x = -8;
      hero.z = 0;
      for (let k = 0; k < 12; k++) killEnemy(w, eliteOf(w, 'wolf', AffixId.Splitting, -0.3 - (k % 3) * 0.3, -20 + k * 3), 0, -1, false);
      const n0 = liveRows(w).length;
      expect(n0).toBe(24);
      for (let i = 0; i < 60 * 8; i++) {
        w.step([NO_INPUT]);
        for (const r of liveRows(w)) expect(dry(w.enemies.x[r] as number)).toBe(true);
      }
    });
  });
});

describe('affixes switched on but never rolled', () => {
  it('play exactly like default content: same rng streams, same rows after 150 s', () => {
    const sim = (content?: (c: ContentDB) => void): string => {
      const w = makeWorld({ content, config: { seed: 17 } });
      const hero = player(w);
      hero.hp = hero.hpMax = 1e9;
      for (let i = 0; i < 60 * 150; i++) {
        drainModals(w);
        w.step([{ moveX: Math.sin(i / 90), moveZ: Math.cos(i / 130) }]);
      }
      let sum = 0;
      for (let i = 0; i < w.enemies.count; i++) sum += (w.enemies.x[i] as number) * 3 + (w.enemies.z[i] as number) + (w.enemies.hp[i] as number);
      return JSON.stringify([sum, w.enemies.count, w.tally.kills, w.rng.spawn.getState(), w.rng.loot.getState(), w.rng.ai.getState(), w.rng.combat.getState()]);
    };
    // fromBand 99: enabled, but every band is "before fromBand": no roll, no draw
    expect(sim(on({ fromBand: 99 }))).toBe(sim());
  }, 60_000);
});

describe('co-op (EL-02): the behaviours are host-side, the guest sees the result', () => {
  let h: CoopHarness | null = null;
  afterEach(() => {
    h?.dispose();
    h = null;
  });
  const run = (n: number): void => {
    for (let i = 0; i < n; i++) (h as CoopHarness).tick();
  };
  /** type / tier / affix of the live creature rows of a world, sorted */
  const rowsOf = (w: World): string[] => {
    const E = w.enemies;
    const out: string[] = [];
    for (let i = 0; i < E.count; i++) if (E.state[i] !== EnemyState.Dying && ((E.flags[i] as number) & EnemyFlag.Metin) === 0) out.push(`${E.type[i]}/${E.eliteTier[i]}/${E.affix[i]}`);
    return out.sort();
  };

  it('a splitting elite killed on the host: the guest sees the two copies, also after a rejoin', async () => {
    h = await CoopHarness.create({ guests: 1, latencyMs: 30, enemies: 0, tough: true, content: on() });
    const hw = h.hostWorld;
    const gw = h.guestWorlds[0] as MirrorWorld;
    run(60);
    const hero = hw.players[0] as { x: number; z: number };
    const wolf = typeOf(hw, 'alpha_wolf');
    const held = EnemyFlag.Pinned | EnemyFlag.Invuln;
    const row = spawnEnemy(hw, wolf, hero.x + 5, hero.z + 4, { tier: 1, affix: AffixId.Splitting, spawnTime: 0, speedMul: 0, flags: held });
    spawnEnemy(hw, wolf, hero.x - 5, hero.z + 4, { tier: 1, affix: AffixId.Warded, spawnTime: 0, speedMul: 0, flags: held });
    run(60);
    expect(rowsOf(gw)).toEqual(rowsOf(hw));
    expect(rowsOf(gw)).toContain(`${wolf}/1/${AffixId.Splitting}`);
    expect(rowsOf(gw)).toContain(`${wolf}/1/${AffixId.Warded}`);
    // the elite falls (the test pin keeps the hero's skills off the rest)
    killEnemy(hw, row, 0, -1, false);
    for (const r of liveRows(hw)) if (hw.enemies.eliteTier[r] === 0) hw.enemies.flags[r] = (hw.enemies.flags[r] as number) | held;
    run(120);
    expect(rowsOf(hw).filter((r) => r === `${wolf}/0/0`)).toHaveLength(2);
    expect(rowsOf(gw)).toEqual(rowsOf(hw));
    expect(pickupValues(gw, PickupKind.Xp).length).toBeGreaterThan(0);
    // the guest drops and comes back mid-fight: the keyframe carries the same rows
    await h.reconnect(1);
    run(240);
    expect(rowsOf(h.guestWorlds[0] as World)).toEqual(rowsOf(hw));
  }, 60_000);
});
