// REVERIFY-1 round 2 (wedge check): the pocket escape of TerrainField.moveHero (field.env.moveCircle) must leave plain wall contact to
// the circle rule. The first fix turned pinned steps aside and pulled heroes out of creep "pockets" they had just walked into, so a
// hero held against a wall or a corner moved 7-9 cm back and forth every tick, and its point-walkable pull and point rule walked heroes
// into rocks. These multi-tick tests drive the real sim (updatePlayers) with the shipped hero step and with the pre-REVERIFY-1 rule
// (START: the circle rule, plus the point rule from a start disc that overlaps a cliff cell or a blocker) and demand: no shaking, no
// more direction reversals than START, no trajectory more than 0.5 m shorter than START, and no centre on a non-walkable point or deep
// inside a blocker.

import { describe, expect, it } from 'vitest';
import { content } from '../data/loader';
import { PLAYER_RADIUS } from '../sim/constants';
import { updatePlayers } from '../sim/player';
import type { WorldEnv } from '../sim/types';
import { createWorld, type World } from '../sim/world';
import { createTerrainField, type TerrainField, type Vec2Like } from './terrainField';

const R = PLAYER_RADIUS;

/** the hero step before REVERIFY-1 (the circle rule; the point rule only from a start disc that overlaps a cliff cell or a blocker) */
function startMoveHero(f: TerrainField, x0: number, z0: number, x1: number, z1: number, r: number, out: Vec2Like): boolean {
  const reached = f.moveCircle(x0, z0, x1, z1, r, out);
  if (reached) return true;
  if (out.x !== x0 || out.z !== z0 || (x1 === x0 && z1 === z0)) return false;
  const terrainBlocked = (f as unknown as { terrainBlockedCircle(x: number, z: number, r: number): boolean }).terrainBlockedCircle(x0, z0, r);
  if (!terrainBlocked && f.walkableCircle(x0, z0, r * 0.85)) return false;
  if (f.walkable(x1, z1)) {
    out.x = x1;
    out.z = z1;
    return true;
  }
  if (f.walkable(x1, z0)) out.x = x1;
  else if (f.walkable(x0, z1)) out.z = z1;
  return false;
}

function field(zone: string, seed: number): TerrainField {
  const z = content.zones.find((q) => q.id === zone);
  if (!z) throw new Error(`zone ${zone}`);
  return createTerrainField(z.biome, seed);
}

/** a yacha run on the field; `start` swaps in the pre-REVERIFY-1 hero step */
function world(zone: string, seed: number, f: TerrainField, start: boolean): World {
  const env: WorldEnv = { ...f.env, bossModel: () => ({ spawn: 0, breath: false }) };
  if (start) env.moveCircle = (x0, z0, x1, z1, r, out) => startMoveHero(f, x0, z0, x1, z1, r, out);
  const cls = content.classes.find((c) => c.id === 'yacha');
  if (!cls) throw new Error('class yacha');
  return createWorld(
    { zone, difficulty: 'normal', classId: 'yacha', doctrine: 'a', sex: cls.sexes[0] as never, empire: (content.empires[0] as { id: string }).id as never, seed, meta: { stats: {} } } as never,
    content,
    undefined,
    env,
  );
}

interface Run {
  xs: Float64Array;
  zs: Float64Array;
  /** ticks whose hero centre is on a non-walkable point, or within b.r + 0.25 R of a blocker centre */
  off: number;
  deep: number;
}

/** the hero placed at (x,z) at rest, the stick held toward `deg` for `ticks` (the real updatePlayers) */
function hold(w: World, f: TerrainField, x: number, z: number, deg: number, ticks: number): Run {
  const p = w.players[0]!;
  p.x = x;
  p.z = z;
  p.px = x;
  p.pz = z;
  p.vx = 0;
  p.vz = 0;
  p.kvx = 0;
  p.kvz = 0;
  p.dashT = 0;
  p.hp = p.hpMax;
  const a = (deg * Math.PI) / 180;
  const input = [{ moveX: Math.cos(a), moveZ: Math.sin(a) }];
  const xs = new Float64Array(ticks + 1);
  const zs = new Float64Array(ticks + 1);
  xs[0] = x;
  zs[0] = z;
  let off = 0;
  let deep = 0;
  for (let i = 1; i <= ticks; i++) {
    updatePlayers(w, input);
    xs[i] = p.x;
    zs[i] = p.z;
    if (!f.walkable(p.x, p.z)) off++;
    let d = false;
    f.blockersNear(p.x, p.z, R, (b) => {
      if (Math.hypot(p.x - b.x, p.z - b.z) < b.r + 0.25 * R) d = true;
    });
    if (d) deep++;
  }
  return { xs, zs, off, deep };
}

/** direction reversals: consecutive tick moves over 1 cm that point more than 120 degrees apart (the wedge check's measure) */
function reversals(t: Run): number {
  let n = 0;
  for (let i = 2; i < t.xs.length; i++) {
    const ax = (t.xs[i - 1] as number) - (t.xs[i - 2] as number);
    const az = (t.zs[i - 1] as number) - (t.zs[i - 2] as number);
    const bx = (t.xs[i] as number) - (t.xs[i - 1] as number);
    const bz = (t.zs[i] as number) - (t.zs[i - 1] as number);
    const la = Math.hypot(ax, az);
    const lb = Math.hypot(bx, bz);
    if (la > 0.01 && lb > 0.01 && (ax * bx + az * bz) / (la * lb) < -0.5) n++;
  }
  return n;
}

/** shaking: the last second (60 ticks) has a path over 0.6 m and a net move under 0.15 m */
function shaking(t: Run): boolean {
  const T = t.xs.length - 1;
  let path = 0;
  for (let i = T - 59; i <= T; i++) path += Math.hypot((t.xs[i] as number) - (t.xs[i - 1] as number), (t.zs[i] as number) - (t.zs[i - 1] as number));
  const net = Math.hypot((t.xs[T] as number) - (t.xs[T - 60] as number), (t.zs[T] as number) - (t.zs[T - 60] as number));
  return path > 0.6 && net < 0.15;
}

const reach = (t: Run, i: number): number => Math.hypot((t.xs[i] as number) - (t.xs[0] as number), (t.zs[i] as number) - (t.zs[0] as number));

/** the wedge check's repros (where the first fix shuttled 7-9 cm every tick, or walked into a rock / over a non-walkable point) */
const REPROS: { zone: string; seed: number; x: number; z: number; deg: number; what: string }[] = [
  { zone: 'seori', seed: 842245671, x: 150.7, z: -85.1, deg: 225, what: 'slide down the crack: START 7.52 m in 1.5 s' },
  { zone: 'daeryeol', seed: 1515625440, x: -108.5, z: -120.2, deg: 112.5, what: 'slide: START 6.37 m' },
  { zone: 'yeonmu', seed: 1731502408, x: -77.0, z: -166.1, deg: 315, what: 'slide: START 6.44 m' },
  { zone: 'suryeon', seed: 1790389457, x: -44.6, z: -176.9, deg: 337.5, what: 'slide: START 2.29 m (the 90 degree turn shuttled)' },
  { zone: 'seori', seed: 842245671, x: -139.1, z: -104.0, deg: 180, what: 'START stops cleanly in the corner' },
  { zone: 'suryeon', seed: 1790389457, x: 31.2, z: -51.1, deg: 45, what: 'pushing into the REVERIFY-1 notch mouth' },
  { zone: 'yeonmu', seed: 1731502408, x: 129.6, z: -61.8, deg: 0, what: 'START stops at the wall; the first fix walked into the rock r 1.30' },
  { zone: 'seori', seed: 842245671, x: 96.6, z: 14.1, deg: 315, what: 'the first fix passed over the non-walkable point (101.50, 13.45)' },
];

describe('hero wall contact is the circle rule (REVERIFY-1 round 2)', () => {
  for (const r of REPROS) {
    it(`${r.zone} ${r.seed} (${r.x}, ${r.z}) holding ${r.deg} deg (${r.what}): no shaking, reversals and reach as START, no clipping`, () => {
      const f = field(r.zone, r.seed);
      const shipped = hold(world(r.zone, r.seed, f, false), f, r.x, r.z, r.deg, 180);
      const start = hold(world(r.zone, r.seed, f, true), f, r.x, r.z, r.deg, 180);
      expect(shaking(shipped), 'shaking over the last second').toBe(false);
      expect(reversals(shipped), 'direction reversals').toBeLessThanOrEqual(reversals(start));
      expect(reach(shipped, 90), 'metres from the start after 1.5 s, against START').toBeGreaterThan(reach(start, 90) - 0.5);
      expect(reach(shipped, 180), 'metres from the start after 3 s, against START').toBeGreaterThan(reach(start, 180) - 0.5);
      expect(shipped.off, 'ticks with the centre on a non-walkable point').toBe(0);
      expect(shipped.deep, 'ticks with the centre within b.r + 0.25 R of a blocker').toBe(0);
    });
  }

  it('the first fix rock clip: yeonmu 1731502408 from (129.6, -61.8) holding east stops at the wall where START stops (130.111, -61.800)', () => {
    const f = field('yeonmu', 1731502408);
    const t = hold(world('yeonmu', 1731502408, f, false), f, 129.6, -61.8, 0, 180);
    const s = hold(world('yeonmu', 1731502408, f, true), f, 129.6, -61.8, 0, 180);
    const end = { x: t.xs[180] as number, z: t.zs[180] as number };
    expect(Math.hypot(end.x - (s.xs[180] as number), end.z - (s.zs[180] as number)), 'metres from where START stops').toBeLessThan(0.01);
    expect(f.walkableCircle(end.x, end.z, R * 0.85), 'the disc is out of the rock').toBe(true);
  });

  // near-wall disc-free starts (a 2.7 m lattice: every third start of the wedge check's 0.9 m one) x 16 held directions x 1.5 s
  for (const [zone, seed] of [
    ['seori', 842245671],
    ['suryeon', 1790389457],
    ['yeonmu', 1731502408],
    ['daeryeol', 1515625440],
  ] as [string, number][]) {
    it(`${zone} ${seed}: near-wall sweep against START (shaking, reversals, > 0.5 m shorter) and clipping`, () => {
      const f = field(zone, seed);
      const wNew = world(zone, seed, f, false);
      const wOld = world(zone, seed, f, true);
      const lim = f.arenaRadius - 3;
      let n = 0;
      let shakeNew = 0;
      let shakeOld = 0;
      let revNew = 0;
      let revOld = 0;
      let shorter = 0;
      let off = 0;
      let deep = 0;
      const bad: string[] = [];
      for (let z = -lim; z <= lim; z += 2.7) {
        for (let x = -lim; x <= lim; x += 2.7) {
          if (x * x + z * z > lim * lim) continue;
          if (!f.walkableCircle(x, z, R) || f.walkableCircle(x, z, R + 0.4)) continue;
          for (let k = 0; k < 16; k++) {
            n++;
            const a = hold(wNew, f, x, z, k * 22.5, 90);
            const b = hold(wOld, f, x, z, k * 22.5, 90);
            if (shaking(a)) shakeNew++;
            if (shaking(b)) shakeOld++;
            revNew += reversals(a);
            revOld += reversals(b);
            if (reach(a, 90) < reach(b, 90) - 0.5) {
              shorter++;
              if (bad.length < 6) bad.push(`(${x.toFixed(1)}, ${z.toFixed(1)}) ${k * 22.5}: ${reach(a, 90).toFixed(2)} m vs START ${reach(b, 90).toFixed(2)} m`);
            }
            off += a.off;
            deep += a.deep;
          }
        }
      }
      expect(n, 'trajectories').toBeGreaterThan(800);
      expect(shakeNew, 'shaking trajectories').toBeLessThanOrEqual(shakeOld);
      expect(revNew, 'direction reversals').toBeLessThanOrEqual(revOld);
      expect(bad, 'trajectories ending more than 0.5 m shorter than START').toEqual([]);
      expect(shorter).toBe(0);
      expect(off, 'ticks with the centre on a non-walkable point').toBe(0);
      expect(deep, 'ticks with the centre within b.r + 0.25 R of a blocker').toBe(0);
    }, 240_000);
  }

  it('nobody walks into the REVERIFY-1 notch: walk-ins from free ground end where at least one held direction leaves 1.5 m', () => {
    const f = field('suryeon', 1790389457);
    const w = world('suryeon', 1790389457, f, false);
    const p = w.players[0]!;
    const X = 31.2;
    const Z = -51.1;
    let walkIns = 0;
    const trapped: string[] = [];
    for (const rad of [1, 1.5, 2, 2.5, 3]) {
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        const sx = X + Math.cos(a) * rad;
        const sz = Z + Math.sin(a) * rad;
        if (!f.walkableCircle(sx, sz, R + 0.05)) continue;
        walkIns++;
        hold(w, f, sx, sz, 0, 0);
        for (let i = 0; i < 180; i++) {
          const ex = X - p.x;
          const ez = Z - p.z;
          const el = Math.hypot(ex, ez);
          if (el < 0.02) break;
          updatePlayers(w, [{ moveX: ex / el, moveZ: ez / el }]);
        }
        const ex = p.x;
        const ez = p.z;
        let leaves = false;
        for (let d = 0; d < 16 && !leaves; d++) leaves = reach(hold(w, f, ex, ez, d * 22.5, 180), 180) >= 1.5;
        if (!leaves) trapped.push(`from (${sx.toFixed(2)}, ${sz.toFixed(2)}) ended (${ex.toFixed(2)}, ${ez.toFixed(2)})`);
      }
    }
    expect(walkIns).toBeGreaterThan(15);
    expect(trapped).toEqual([]);
  }, 120_000);
});
