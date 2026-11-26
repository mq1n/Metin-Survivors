// Metin stones must be breakable by a hero who fights at them (e2e audit P2-2: zone 3–4 stones were effectively
// unbreakable — 16.9k / 38.5k HP at impact while a hero next to the stone removed 4% / 1.2% in 45 s, because
// nearest-enemy auto-targeting always picked the swarm the stone keeps summoning around itself).
//  1. targeting: a hero standing at a breakable stone aims its skills at the stone (skills/common.ts focusStone);
//  2. data: regular metin HP follows each zone's power curve (the zone's boss / final-boss scale), not raw server HP;
//  3. a stone-focused autoplayer breaks the stones of every zone before they awaken (real content).

import { describe, expect, it } from 'vitest';
import { content } from '../../data/loader';
import type { ClassId, ContentDB, MetinDef, ZoneDef } from '../../data/schema';
import { cloneContent, fixtureConfig } from '../__fixtures__/content';
import { spawnBoss } from '../bosses';
import { aim, focusStone, STONE_FOCUS_GAP } from '../skills/common';
import { EnemyFlag, type PlayerState } from '../stores';
import { MetinPhase, type MetinState } from '../types';
import { createWorld, type World } from '../world';
import { botInput } from './bot';
import { drainModals, giveSkill, NO_INPUT, player, runTicks, spawn } from './helpers';

// ---------------------------------------------------------------------------
// fixture helpers (quiet world, one stone landed on demand)

function stoneWorld(): World {
  const c = cloneContent();
  const zone = c.zones[0] as ZoneDef;
  zone.metins.types = ['metin_lament'];
  zone.metins.interval = [1e6, 1e6];
  for (const d of c.metins) {
    d.swarm.every = 1e9;
    // no HP-threshold waves either: the test places every creature itself
    for (const k of Object.keys(d.modParams)) if (k.startsWith('wave_')) d.modParams[k] = 0;
  }
  const w = createWorld(fixtureConfig({ seed: 5 }), c);
  w.spawner.acc = -1e9;
  w.spawner.eliteT = 1e9;
  w.spawner.nextBoss = w.spawner.bosses.length;
  for (const p of w.players) p.skills.length = 0;
  w.metinSys.nextFallAt = 0;
  return w;
}

function place(p: PlayerState, x: number, z: number): void {
  p.x = p.px = x;
  p.z = p.pz = z;
  p.vx = p.vz = p.kvx = p.kvz = 0;
}

/** drop the scheduled stone, wait until it landed and its drop clip (invulnerable) is over */
function landStone(w: World): { m: MetinState; row: number } {
  runTicks(w, 1);
  const m = w.metins[0] as MetinState;
  for (let i = 0; i < 600 && (m.phase === MetinPhase.Falling || (w.enemies.flags[w.enemies.find(m.enemy)] ?? EnemyFlag.Invuln) & EnemyFlag.Invuln); i++) {
    w.step([NO_INPUT]);
  }
  const row = w.enemies.find(m.enemy);
  expect(m.phase).toBe(MetinPhase.Alive);
  expect(row).toBeGreaterThanOrEqual(0);
  expect((w.enemies.flags[row] as number) & EnemyFlag.Invuln).toBe(0);
  return { m, row };
}

/** a creature parked so the AI cannot move it (the spatial hash is rebuilt so targeting sees it before the next step) */
function parked(w: World, x: number, z: number): number {
  const row = spawn(w, 'wolf', x, z);
  w.enemies.aiT[row] = 1e9;
  w.hash.rebuild(w.enemies);
  return row;
}

describe('stone focus targeting', () => {
  it('a hero standing at a breakable stone aims at the stone, not the creature that is nearer', () => {
    const w = stoneWorld();
    const p = player(w);
    const { m, row: stone } = landStone(w);
    const r = w.enemies.radius[stone] as number;
    // hero 1 m outside the stone's body; a wolf right next to the hero (much nearer than the stone)
    place(p, m.x - r - 1, m.z);
    const wolf = parked(w, p.x - 0.8, p.z);
    expect(focusStone(w, p, 10)).toBe(stone);
    expect(aim(w, p, 10)).toBe(stone);
    // the stone must also be within the skill's own reach
    expect(aim(w, p, 0.5)).toBe(wolf);
    expect(w.enemies.find(w.enemies.id[wolf] as number)).toBe(wolf);
  });

  it('away from the stone (beyond the focus gap) the nearest creature is the target again', () => {
    const w = stoneWorld();
    const p = player(w);
    const { m, row: stone } = landStone(w);
    const r = w.enemies.radius[stone] as number;
    place(p, m.x - r - STONE_FOCUS_GAP - 1.5, m.z);
    const wolf = parked(w, p.x - 1, p.z);
    expect(focusStone(w, p, 20)).toBe(-1);
    expect(aim(w, p, 20)).toBe(wolf);
  });

  it('invulnerable, phased, falling and Great stones are never focused', () => {
    const w = stoneWorld();
    const p = player(w);
    const { m, row: stone } = landStone(w);
    const r = w.enemies.radius[stone] as number;
    place(p, m.x - r - 1, m.z);
    const wolf = parked(w, p.x - 0.8, p.z);
    const flags = w.enemies.flags[stone] as number;
    w.enemies.flags[stone] = flags | EnemyFlag.Invuln;
    expect(aim(w, p, 10)).toBe(wolf);
    w.enemies.flags[stone] = flags | EnemyFlag.Phased;
    expect(aim(w, p, 10)).toBe(wolf);
    w.enemies.flags[stone] = flags;
    m.great = true;
    expect(aim(w, p, 10)).toBe(wolf);
    m.great = false;
    m.phase = MetinPhase.Broken;
    expect(focusStone(w, p, 10)).toBe(-1);
    m.phase = MetinPhase.Alive;
    expect(aim(w, p, 10)).toBe(stone);
  });

  it('a boss within reach keeps the plain nearest targeting (a stone never pulls attacks out of a boss fight)', () => {
    const w = stoneWorld();
    const p = player(w);
    const { m, row: stone } = landStone(w);
    const r = w.enemies.radius[stone] as number;
    place(p, m.x - r - 1, m.z);
    const wolf = parked(w, p.x - 0.8, p.z);
    expect(aim(w, p, 10)).toBe(stone);
    const boss = spawnBoss(w, 'boss_horyeong', false, p.x, p.z - 6);
    expect(boss).not.toBeNull();
    w.hash.rebuild(w.enemies);
    expect(focusStone(w, p, 10)).toBe(-1);
    expect(aim(w, p, 10)).toBe(wolf);
    // out of the skill's reach the boss does not matter
    expect(aim(w, p, 2)).toBe(stone);
  });

  it('a projectile hero at the stone damages the stone through a crowd of nearer creatures', () => {
    const w = stoneWorld();
    const p = player(w);
    p.hp = p.hpMax = 1e6;
    const { m, row: stone } = landStone(w);
    const r = w.enemies.radius[stone] as number;
    place(p, m.x - r - 1.2, m.z);
    for (let i = 0; i < 6; i++) parked(w, p.x - 1 - 0.3 * i, p.z + (i % 2 === 0 ? 0.6 : -0.6));
    giveSkill(w, 'spirit_bolt');
    const hp0 = w.enemies.hp[stone] as number;
    runTicks(w, 180);
    expect(w.enemies.hp[stone] as number).toBeLessThan(hp0);
  });
});

// ---------------------------------------------------------------------------
// real content

/** mean HP of the zone's regular metin types */
function meanMetinHp(c: ContentDB, z: ZoneDef): number {
  const defs = z.metins.types.map((id) => c.metins.find((d) => d.id === id)).filter((d): d is MetinDef => !!d);
  return defs.reduce((a, d) => a + d.hp, 0) / Math.max(1, defs.length);
}

function bossHp(c: ContentDB, id: string): number {
  const b = c.bosses.find((x) => x.id === id);
  if (!b) throw new Error(`unknown boss ${id}`);
  return b.hp;
}

describe('metin HP follows the zone power curve (real content)', () => {
  const zones = [...content.zones].sort((a, b) => a.order - b.order);

  it('relative to the final boss, every zone keeps the first zone ratio (±35%)', () => {
    const first = zones[0] as ZoneDef;
    const ref = meanMetinHp(content, first) / bossHp(content, first.final.boss);
    for (const z of zones) {
      const ratio = meanMetinHp(content, z) / bossHp(content, z.final.boss);
      expect(ratio / ref, `${z.id}: mean metin ${meanMetinHp(content, z).toFixed(0)} vs final ${bossHp(content, z.final.boss)}`).toBeGreaterThan(0.65);
      expect(ratio / ref, `${z.id}: mean metin ${meanMetinHp(content, z).toFixed(0)} vs final ${bossHp(content, z.final.boss)}`).toBeLessThan(1.35);
    }
  });

  it('no regular stone is tougher than the zone 12:00 boss', () => {
    for (const z of zones) {
      const strongest = Math.max(...z.bosses.map((b) => bossHp(content, b.boss)));
      for (const id of z.metins.types) {
        const d = content.metins.find((x) => x.id === id);
        expect(d?.hp ?? 0, `${z.id}/${id}`).toBeLessThan(strongest);
      }
    }
  });
});

/** autoplayer that walks to the standing stone and circles it (a player who goes for the stone) */
function playFocused(zone: string, classId: ClassId, secs: number): { broken: number; awakened: number; impacts: number } {
  const cls = content.classes.find((c) => c.id === classId);
  // a hero with the survivability to stay at the stone and modest meta offence (gear / talents of the earlier zones)
  const w = createWorld({ zone, difficulty: 'normal', classId, doctrine: 'a', sex: cls?.sexes[0] ?? 'm', empire: 'saehwa', seed: 7919, meta: { stats: { maxHpPct: 8, armor: 150, regen: 10, damage: 0.5 } } }, content);
  // no scheduled bosses: a boss in reach deliberately keeps nearest targeting (boss fights come first), so this measures
  // the stone itself — HP, swarm waves, modifiers — against a hero who stands at it
  w.spawner.nextBoss = w.spawner.bosses.length;
  const impacts = new Map<number, number>();
  let broken = 0;
  let awakened = 0;
  let tick = 0;
  while (tick < secs * 60 && !w.over) {
    drainModals(w);
    const p = w.players[0] as PlayerState;
    let input = botInput(w, tick);
    const m = w.metins.find((x) => !x.great && (x.phase === MetinPhase.Alive || x.phase === MetinPhase.Awakened));
    if (m) {
      const dx = m.x - p.x;
      const dz = m.z - p.z;
      const d = Math.hypot(dx, dz) || 1;
      input = d > 3.2 ? { moveX: dx / d, moveZ: dz / d } : { moveX: -dz / d, moveZ: dx / d };
    }
    w.step([input]);
    tick++;
    for (const e of w.events) {
      if (e.t === 'metinImpact' && !e.great) impacts.set(e.metin, w.time);
      else if (e.t === 'metinAwaken' && impacts.has(e.metin)) {
        awakened++;
        impacts.delete(e.metin);
      } else if (e.t === 'metinBreak' && !e.great && impacts.has(e.metin)) {
        broken++;
        impacts.delete(e.metin);
      }
    }
  }
  return { broken, awakened, impacts: broken + awakened };
}

describe('a hero who fights at the stone breaks it before it awakens (real content)', () => {
  for (const [zone, cls] of [
    ['yeonmu', 'warrior'],
    ['suryeon', 'ninja'],
    ['seori', 'yacha'],
    ['daeryeol', 'shaman'],
  ] as const) {
    it(`${zone} / ${cls}`, () => {
      const r = playFocused(zone, cls, 300);
      expect(r.impacts, `${zone}: stones resolved in 300 s`).toBeGreaterThanOrEqual(2);
      // the stones resolved in the first five minutes mostly break before their 90 s awakening
      expect(r.broken, `${zone}: broken ${r.broken} / awakened ${r.awakened}`).toBeGreaterThan(r.awakened);
    }, 60_000);
  }
});
