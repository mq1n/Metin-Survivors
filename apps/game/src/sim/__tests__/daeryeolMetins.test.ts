// PC-02 (upgrade stage A, group A.pacing): the final zone's stone roster. Daeryeol used to drop one stone type
// (metin_slaughter, a plain damage aura) against 5 / 4 / 3 in the other zones; the zone data now also rolls the Devil stone
// (fire ring) and the Shadow stone (flicker), both existing definitions (metins.json is untouched).
//
// Everything here runs on the REAL shipped content and the real Daeryeol terrain (lava included), like hazards.test.ts:
//  1. data: the roster, the other zones' rosters unchanged, every swarm creature known to the sim;
//  2. the fall roll: all three stones fall (fails with the old one-type list);
//  3. each new stone plays its whole life in the zone: impact, modifier, swarm of its own roster, break, no NaN;
//  4. edge cases: hero dead (co-op guest still alive), hero at the arena edge, co-op, Run Options max, lava / deep water;
//  5. payload: the new swarm creatures stream in at the first stone (metins.firstAt), the blocking NOW set is unchanged.

import { describe, expect, it } from 'vitest';
import { creatureLoadPlan } from '../../app/simFeed';
import { content } from '../../data/loader';
import type { ContentDB, ZoneDef } from '../../data/schema';
import { createTerrainField, type TerrainField } from '../../world/terrainField';
import { hitEnemy, newHitCtx } from '../combat';
import { Surface } from '../constants';
import { METIN_ROW_TYPE } from '../enemies';
import { runOptionsTable, type CoopPlayerInit, type RunConfig } from '../run';
import { EnemyFlag, ZoneKind, type PlayerState } from '../stores';
import { MetinPhase, type MetinState, type WorldEnv } from '../types';
import { createWorld, type World } from '../world';
import { findNonFinite, NO_INPUT, player, runTicks } from './helpers';

const ZONE = 'daeryeol';
const OLD_ROSTER = ['metin_slaughter'];
const NEW_STONES = ['metin_fiend', 'metin_dusk'] as const;
const ROSTER = ['metin_slaughter', ...NEW_STONES];
const GUEST: CoopPlayerInit = { classId: 'warrior', doctrine: 'a', sex: 'f', empire: 'chowon', meta: { stats: {} } };

interface Opts {
  seed?: number;
  /** replace zone.metins.types of the private content clone (default: the shipped roster) */
  types?: readonly string[];
  /** keep the shipped metin schedule (first stone at firstAt) instead of "falls on the first tick" */
  schedule?: boolean;
  coop?: boolean;
  runOptionsMax?: boolean;
  /** skip the real terrain field (a flat arena): enough for tests that only look at WHICH stone falls, and much cheaper */
  flat?: boolean;
}

interface Built {
  w: World;
  /** the real Daeryeol field (absent with `flat`) */
  field: TerrainField;
}

function zoneOf(db: ContentDB): ZoneDef {
  const z = db.zones.find((x) => x.id === ZONE);
  if (!z) throw new Error(`zone ${ZONE}`);
  return z;
}

/** the shipped sim on the real Daeryeol field: spawner and bosses off, the stone schedule under test control */
function mk(o: Opts = {}): Built {
  const db = structuredClone(content);
  const zone = zoneOf(db);
  if (o.types) zone.metins.types = [...o.types];
  const seed = o.seed ?? 3;
  const field = (o.flat ? undefined : createTerrainField(zone.biome, seed)) as TerrainField;
  const env: WorldEnv | undefined = o.flat ? undefined : { ...field.env, bossModel: () => ({ spawn: 0, breath: false }) };
  const config = {
    zone: ZONE,
    difficulty: 'normal',
    classId: 'yacha',
    doctrine: 'a',
    sex: 'm',
    empire: 'saehwa',
    seed,
    meta: { stats: {} },
    coop: o.coop ? [GUEST] : undefined,
  } as RunConfig;
  if (o.runOptionsMax) {
    const t = runOptionsTable(db.balance);
    config.runOptions = { density: t.density.max, health: t.health.max, damage: t.damage.max, speed: t.speed.max };
  }
  const w = createWorld(config, db, undefined, env);
  w.spawner.acc = -1e9;
  w.spawner.eliteT = 1e9;
  w.spawner.nextBoss = w.spawner.bosses.length;
  for (const p of w.players) p.skills.length = 0;
  if (!o.schedule) w.metinSys.nextFallAt = 0;
  return { w, field };
}

/** a hero that cannot die (the test measures state, not survival) */
function tough(p: PlayerState): void {
  p.hp = 1e7;
  p.hpMax = 1e7;
}

function place(p: PlayerState, x: number, z: number): void {
  p.x = p.px = x;
  p.z = p.pz = z;
  p.vx = p.vz = p.kvx = p.kvz = 0;
}

/** step until the first stone has landed (its warning telegraph resolved) */
function landFirst(w: World): MetinState {
  runTicks(w, 1);
  const m = w.metins[0] as MetinState;
  expect(m, 'a stone is falling').toBeDefined();
  for (let i = 0; i < 600 && m.phase === MetinPhase.Falling; i++) w.step([NO_INPUT]);
  expect(m.phase).toBe(MetinPhase.Alive);
  return m;
}

/** one huge hit once the drop clip (invulnerable) is over */
function smash(w: World, m: MetinState): void {
  for (let i = 0; i < 240 && (((w.enemies.flags[w.enemies.find(m.enemy)] as number) & EnemyFlag.Invuln) !== 0); i++) w.step([NO_INPUT]);
  const row = w.enemies.find(m.enemy);
  expect(row, 'the stone has a hit-row').toBeGreaterThanOrEqual(0);
  const c = newHitCtx();
  c.player = 0;
  c.noCrit = true;
  hitEnemy(w, row, 1e9, c);
}

function ringZones(w: World, src: number): number[] {
  const rows: number[] = [];
  for (let i = 0; i < w.zones.count; i++) if (w.zones.team[i] === 1 && w.zones.src[i] === src && w.zones.kind[i] === ZoneKind.FireRing) rows.push(i);
  return rows;
}

/** the creature rows that are not stones, as sim type indices */
function creatureTypes(w: World): number[] {
  const out: number[] = [];
  for (let r = 0; r < w.enemies.count; r++) {
    if (w.enemies.type[r] !== METIN_ROW_TYPE && ((w.enemies.flags[r] as number) & EnemyFlag.Metin) === 0) out.push(w.enemies.type[r] as number);
  }
  return out;
}

describe('PC-02 Daeryeol stone roster: data', () => {
  it('rolls murder, devil and shadow (three types, no duplicate), and the other zones keep their rosters', () => {
    const roster = zoneOf(content).metins.types;
    expect([...roster].sort()).toEqual([...ROSTER].sort());
    expect(new Set(roster).size).toBe(roster.length);
    const of = (id: string): readonly string[] => content.zones.find((z) => z.id === id)?.metins.types ?? [];
    expect(of('yeonmu')).toEqual(['metin_lament', 'metin_strife', 'metin_onslaught', 'metin_avarice', 'metin_ebon']);
    expect(of('suryeon')).toEqual(['metin_murk', 'metin_envy', 'metin_echoes', 'metin_dusk']);
    expect(of('seori')).toEqual(['metin_grit', 'metin_fiend', 'metin_demise']);
  });

  it('the three stones are three different threats, and every creature of their swarms is a known type', () => {
    const defs = ROSTER.map((id) => content.metins.find((m) => m.id === id));
    for (const d of defs) expect(d, 'metin def').toBeDefined();
    expect(new Set(defs.map((d) => d?.modifier)).size).toBe(3);
    const known = new Set(content.enemies.map((e) => e.id));
    for (const d of defs) for (const e of d?.swarm.enemies ?? []) expect(known.has(e), `${d?.id}: ${e}`).toBe(true);
    // the great metin stays the zone's own
    expect(zoneOf(content).final.greatMetin).toBe('metin_great_doomfire');
  });
});

describe('PC-02 Daeryeol stone roster: the fall roll', () => {
  it('all three stones fall over a set of runs (the old one-type list only ever dropped murder)', () => {
    const seen = new Map<string, number>();
    for (let seed = 1; seed <= 30; seed++) {
      const { w } = mk({ seed, flat: true });
      runTicks(w, 1);
      const id = (w.metins[0] as MetinState).def.id;
      seen.set(id, (seen.get(id) ?? 0) + 1);
    }
    for (const id of ROSTER) expect(seen.get(id) ?? 0, `${id} never fell`).toBeGreaterThan(0);
    expect([...seen.keys()].every((id) => ROSTER.includes(id))).toBe(true);
  });

  it('the old roster still drops only murder (the OFF arm of the gate is the old behaviour)', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const { w } = mk({ seed, types: OLD_ROSTER, flat: true });
      runTicks(w, 1);
      expect((w.metins[0] as MetinState).def.id).toBe('metin_slaughter');
    }
  });

  it('the shipped schedule is unchanged: the first stone falls at metins.firstAt, one of the three', () => {
    const { w } = mk({ schedule: true, flat: true });
    const firstAt = w.zone.metins.firstAt;
    expect(w.metinSys.nextFallAt).toBe(firstAt);
    runTicks(w, Math.round((firstAt - 1) * 60));
    expect(w.metins.length).toBe(0);
    runTicks(w, 3 * 60);
    expect(w.metins.length).toBeGreaterThan(0);
    expect(ROSTER).toContain((w.metins[0] as MetinState).def.id);
  });
});

describe('PC-02 each new stone plays its life in Daeryeol', () => {
  for (const id of NEW_STONES) {
    it(`${id}: impact, modifier, swarm of its own roster, break, no NaN`, () => {
      const { w } = mk({ types: [id] });
      tough(player(w));
      const m = landFirst(w);
      expect(m.def.id).toBe(id);
      expect(m.def.modifier).toBe(id === 'metin_fiend' ? 'fireRing' : 'flicker');
      // the devil stone lights its fire ring (a hostile ground zone tied to the stone); the shadow stone has none
      const rings = ringZones(w, m.id);
      if (id === 'metin_fiend') {
        expect(rings.length).toBe(1);
        expect(w.zones.radius[rings[0] as number]).toBeCloseTo(m.def.modParams['ringRadius'] as number, 5);
        expect(w.zones.damage[rings[0] as number]).toBeGreaterThan(0);
      } else {
        expect(rings.length).toBe(0);
      }
      // its swarm: the timed pack pours creatures of the stone's own roster only (the spawner is off, so every creature is the stone's)
      const roster = new Set(m.def.swarm.enemies.map((e) => w.ix.typeIndex.get(e)));
      expect(roster.has(undefined)).toBe(false);
      runTicks(w, 14 * 60);
      const types = creatureTypes(w);
      expect(types.length).toBeGreaterThan(0);
      for (const t of types) expect(roster.has(t), `type ${t} is not in the roster of ${id}`).toBe(true);
      expect(findNonFinite(w)).toBeNull();
      // breaking it takes the ring with it
      smash(w, m);
      runTicks(w, 3 * 60);
      expect(m.phase).toBe(MetinPhase.Broken);
      expect(ringZones(w, m.id).length).toBe(0);
      expect(findNonFinite(w)).toBeNull();
    }, 120_000);
  }

  it('the devil ring hurts a hero standing on it and spares one standing clear of it', () => {
    const { w } = mk({ types: ['metin_fiend'] });
    const p = player(w);
    const m = landFirst(w);
    const ring = ringZones(w, m.id)[0] as number;
    const radius = w.zones.radius[ring] as number;
    // the ring orbits (RING_BLOBS flames at `radius`): a hero on the ring line is hit by some blob within a full turn
    tough(p);
    p.hp = 1e7;
    const hp0 = p.hp;
    const x = m.x + radius;
    place(p, x, m.z);
    for (let i = 0; i < 6 * 60 && p.hp === hp0; i++) {
      place(p, m.x + radius, m.z);
      p.iframes = 0;
      w.step([NO_INPUT]);
    }
    expect(p.hp).toBeLessThan(hp0);
    // far from the stone: nothing hurts
    place(p, m.x + radius + 12, m.z);
    const hp1 = p.hp;
    runTicks(w, 2 * 60);
    expect(p.hp).toBeGreaterThanOrEqual(hp1);
  }, 120_000);
});

describe('PC-02 edge cases', () => {
  it('a dead host hero: the stone still falls (anchored on the living guest) and the world stays finite', () => {
    for (const id of NEW_STONES) {
      const { w } = mk({ types: [id], coop: true });
      player(w, 0).alive = false;
      tough(player(w, 1));
      const m = landFirst(w);
      expect(m.def.id).toBe(id);
      runTicks(w, 5 * 60);
      expect(findNonFinite(w)).toBeNull();
    }
  }, 120_000);

  it('co-op (host + guest): every stone of the roster falls and lands', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 24 && seen.size < ROSTER.length; seed++) {
      const { w } = mk({ seed, coop: true, flat: true });
      for (const p of w.players) tough(p);
      const m = landFirst(w);
      seen.add(m.def.id);
      expect(findNonFinite(w)).toBeNull();
    }
    expect([...seen].sort()).toEqual([...ROSTER].sort());
  }, 120_000);

  it('a hero at the arena edge: the stone falls inside the arena, never on lava or deep water', () => {
    for (let seed = 1; seed <= 16; seed++) {
      const { w, field } = mk({ seed });
      const p = player(w);
      tough(p);
      const r = field.arenaRadius - 9;
      place(p, r * Math.sin(seed), r * Math.cos(seed));
      runTicks(w, 1);
      const m = w.metins[0] as MetinState;
      expect(Math.hypot(m.x, m.z), `seed ${seed} (${m.def.id})`).toBeLessThanOrEqual(field.arenaRadius - 8 + 1e-6);
      const s = field.surfaceAt(m.x, m.z);
      expect(s === Surface.Lava || s === Surface.Deep, `seed ${seed} (${m.def.id}) landed on surface ${s}`).toBe(false);
    }
  }, 120_000);

  it('Run Options at their maximum: the new stones still play out without a NaN', () => {
    for (const id of NEW_STONES) {
      const { w } = mk({ types: [id], runOptionsMax: true });
      tough(player(w));
      landFirst(w);
      runTicks(w, 14 * 60);
      expect(findNonFinite(w)).toBeNull();
    }
  }, 120_000);
});

describe('PC-02 payload: the blocking load does not grow', () => {
  it('the NOW creature set is the old one; the swarm creatures the zone does not spawn yet stream in at metins.firstAt', () => {
    const now = mk({ flat: true }).w;
    const old = mk({ types: OLD_ROSTER, flat: true }).w;
    const planNew = creatureLoadPlan(now.zone, now.ix, now.usedTypes);
    const planOld = creatureLoadPlan(old.zone, old.ix, old.usedTypes);
    expect(planNew.now).toEqual(planOld.now);
    const firstAt = now.zone.metins.firstAt;
    expect(firstAt).toBeGreaterThan(30);
    const oldLater = new Set(planOld.later.map((l) => l.type));
    const added = planNew.later.filter((l) => !oldLater.has(l.type));
    // every swarm creature of the two new stones is either already in the zone's plan or streams in at the first stone
    const wanted = new Set<number>();
    for (const id of NEW_STONES) for (const e of content.metins.find((x) => x.id === id)?.swarm.enemies ?? []) wanted.add(now.ix.typeIndex.get(e) as number);
    const covered = new Set([...planNew.now, ...planNew.later.map((l) => l.type)]);
    for (const t of wanted) expect(covered.has(t), `type ${t} is neither NOW nor streamed`).toBe(true);
    for (const l of added) expect(l.at).toBe(firstAt);
    expect(planNew.later.length).toBeGreaterThanOrEqual(planOld.later.length);
  });
});
