// REVERIFY-1 / JUDGE-1 (QA judge): the hero could walk into a notch between rocks and a cliff cell (or a corner wedge) and never leave it.
// field.env.moveCircle (= TerrainField.moveHero) refuses a step into such a trap, walks a hero that stands in one (or is pinned in a dead
// end, a confined spot or a narrow channel end, pushing out) along a disc-checked lattice path to the nearest roomy ground, keeps the
// circle rule for everything else (wall contact, sliding, corridors) and stays a pure function of its arguments (host, mirrors and
// client-side prediction all call it). The multi-tick wall-contact tests against the pre-REVERIFY-1 rule are in heroWallContact.test.ts.

import { describe, expect, it } from 'vitest';
import { content } from '../data/loader';
import { newMoveState, stepMove, type MoveEnv, type MoveParams } from '../net/coop/predict';
import { PLAYER_RADIUS } from '../sim/constants';
import { updatePlayers } from '../sim/player';
import type { WorldEnv } from '../sim/types';
import { createWorld, type World } from '../sim/world';
import { clearTerrainFieldCache, createTerrainField, type TerrainField } from './terrainField';

function mk(zoneId: string, seed: number): { w: World; field: TerrainField } {
  const zone = content.zones.find((z) => z.id === zoneId);
  if (!zone) throw new Error(`zone ${zoneId}`);
  const field = createTerrainField(zone.biome, seed);
  const cls = content.classes.find((c) => c.id === 'yacha');
  if (!cls) throw new Error('class yacha');
  const env: WorldEnv = { ...field.env, bossModel: () => ({ spawn: 0, breath: false }) };
  const w = createWorld(
    { zone: zoneId, difficulty: 'normal', classId: 'yacha', doctrine: 'a', sex: cls.sexes[0] as never, empire: (content.empires[0] as { id: string }).id as never, seed, meta: { stats: {} } } as never,
    content,
    undefined,
    env,
  );
  return { w, field };
}

function place(w: World, x: number, z: number): void {
  const p = w.players[0]!;
  p.x = x;
  p.z = z;
  p.px = x;
  p.pz = z;
  p.vx = 0;
  p.vz = 0;
  p.kvx = 0;
  p.kvz = 0;
  p.hp = p.hpMax;
}

/** the hero is placed at (x,z) and the stick held toward `deg` for `secs`: metres from the start */
function walkFrom(w: World, x: number, z: number, deg: number, secs: number): number {
  place(w, x, z);
  const p = w.players[0]!;
  const a = (deg * Math.PI) / 180;
  const input = [{ moveX: Math.cos(a), moveZ: Math.sin(a) }];
  for (let i = 0; i < Math.round(secs * 60); i++) updatePlayers(w, input);
  return Math.hypot(p.x - x, p.z - z);
}

function fan(w: World, x: number, z: number): number {
  let ok = 0;
  for (let k = 0; k < 16; k++) if (walkFrom(w, x, z, k * 22.5, 3) >= 1.5) ok++;
  return ok;
}

/** the four spots the QA judge recorded (REVERIFY-1): zone, run seed, hero x / z */
const SPOTS: { label: string; zone: string; seed: number; x: number; z: number }[] = [
  { label: 'suryeon 1790389457: two rocks + cliff notch', zone: 'suryeon', seed: 1790389457, x: 31.2, z: -51.1 },
  { label: 'daeryeol 1515625440: corner wedge', zone: 'daeryeol', seed: 1515625440, x: 6.1, z: 74.5 },
  { label: 'yeonmu 1731502408: hard repeat wedge', zone: 'yeonmu', seed: 1731502408, x: 60.1, z: 17.7 },
  { label: 'suryeon 31: soak hero-confined case', zone: 'suryeon', seed: 31, x: -20.9, z: 51.5 },
];

describe('hero pocket escape (REVERIFY-1)', () => {
  for (const s of SPOTS) {
    it(
      `${s.label} (${s.x}, ${s.z}): >= 8 of 16 directions move >= 1.5 m in 3 s, no cell within 0.3 m has 0 of 16`,
      () => {
        const { w, field } = mk(s.zone, s.seed);
        expect(fan(w, s.x, s.z), 'directions moving >= 1.5 m at the recorded spot').toBeGreaterThanOrEqual(8);
        const dead: string[] = [];
        let cells = 0;
        for (let i = -3; i <= 3; i++) {
          for (let j = -3; j <= 3; j++) {
            const x = +(s.x + i * 0.1).toFixed(2);
            const z = +(s.z + j * 0.1).toFixed(2);
            if (!field.walkable(x, z)) continue;
            cells++;
            if (fan(w, x, z) === 0) dead.push(`(${x}, ${z})`);
          }
        }
        expect(cells).toBeGreaterThan(20);
        expect(dead, 'cells with 0 of 16 directions moving >= 1.5 m').toEqual([]);
      },
      180_000,
    );
  }

  it('a hero held against a pocket wall walks out and stays out: 3 s of pushing into the Suryeon notch ends on roomy ground', () => {
    const { w, field } = mk('suryeon', 1790389457);
    const p = w.players[0]!;
    for (const deg of [0, 45, 90]) {
      walkFrom(w, 31.2, -51.1, deg, 3);
      // outside the notch: the disc is free again (the circle rule works from here), never a point that is blocked
      expect(field.walkable(p.x, p.z), `direction ${deg}`).toBe(true);
      expect(field.walkableCircle(p.x, p.z, PLAYER_RADIUS * 0.85), `direction ${deg}`).toBe(true);
    }
  });

  it('wall contact is unchanged: on every step the circle rule moves (or slides) at least 10 %, moveHero returns exactly that step', () => {
    let slides = 0;
    let free = 0;
    let differing = 0;
    let steps = 0;
    const raw = { x: 0, z: 0 };
    const hero = { x: 0, z: 0 };
    for (const [zone, seed] of [
      ['seori', 3],
      ['suryeon', 3],
      ['yeonmu', 3],
    ] as [string, number][]) {
      const f = createTerrainField(content.zones.find((z) => z.id === zone)!.biome, seed);
      for (let z = -70; z <= 70; z += 1.3) {
        for (let x = -70; x <= 70; x += 1.3) {
          if (!f.walkableCircle(x, z, PLAYER_RADIUS) || f.walkableCircle(x, z, PLAYER_RADIUS + 0.4)) continue; // near a wall, disc free
          for (let k = 0; k < 16; k++) {
            const a = (k * Math.PI) / 8;
            const len = k % 2 === 0 ? 0.1 : 0.04;
            const x1 = x + Math.cos(a) * len;
            const z1 = z + Math.sin(a) * len;
            const reached = f.moveCircle(x, z, x1, z1, PLAYER_RADIUS, raw);
            const progress = ((raw.x - x) * Math.cos(a) + (raw.z - z) * Math.sin(a)) / len;
            if (progress < 0.1) continue; // pinned steps are the escape's business
            steps++;
            if (reached) free++;
            else slides++;
            f.env.moveCircle!(x, z, x1, z1, PLAYER_RADIUS, hero);
            if (hero.x !== raw.x || hero.z !== raw.z) differing++;
          }
        }
      }
    }
    expect(steps).toBeGreaterThan(2000);
    expect(slides).toBeGreaterThan(200); // the sample contains real wall slides, not just free steps
    expect(free).toBeGreaterThan(500);
    // only pockets (rare) may differ: a start that is a pocket keeps the pull, everything else is the circle rule
    expect(differing / steps).toBeLessThan(0.005);
  }, 120_000);

  it('plain wall contact slides as before: a hero pushed at a shallow angle into the straight Seori fence slides along it, step for step the circle rule', () => {
    const f = createTerrainField(content.zones.find((z) => z.id === 'seori')!.biome, 842245671);
    // the centre fence runs from (-13.5, -15.5) to (-6.5, -17.2); the hero starts 1.5 m south of it
    const FX = 7;
    const FZ = -1.7;
    const fl = Math.hypot(FX, FZ);
    const fx = FX / fl;
    const fz = FZ / fl;
    const raw = { x: 0, z: 0 };
    const hero = { x: 0, z: 0 };
    for (const incidence of [15, 25, 35]) {
      const a = (incidence * Math.PI) / 180;
      const dx = fx * Math.cos(a) - fz * Math.sin(a); // the fence direction turned towards the fence (+z side)
      const dz = fz * Math.cos(a) + fx * Math.sin(a);
      let x = -13;
      let z = -15.5 + ((x + 13.5) / 7) * -1.7 - 1.5;
      const x0 = x;
      const z0 = z;
      let differing = 0;
      for (let t = 0; t < 60; t++) {
        f.moveCircle(x, z, x + dx * 0.1, z + dz * 0.1, PLAYER_RADIUS, raw);
        f.env.moveCircle!(x, z, x + dx * 0.1, z + dz * 0.1, PLAYER_RADIUS, hero);
        if (raw.x !== hero.x || raw.z !== hero.z) differing++;
        x = hero.x;
        z = hero.z;
      }
      expect(differing, `incidence ${incidence}: steps that differ from the circle rule`).toBe(0);
      expect((x - x0) * fx + (z - z0) * fz, `incidence ${incidence}: metres along the fence in 1 s`).toBeGreaterThan(4);
    }
  });

  it('co-op: the guest prediction (net/coop/predict stepMove) and the host sim agree tick for tick through the pocket escape', () => {
    const { w } = mk('suryeon', 1790389457);
    const p = w.players[0]!;
    place(w, 31.2, -51.1);
    const ms = newMoveState();
    ms.x = p.x;
    ms.z = p.z;
    ms.rot = p.rot;
    const params: MoveParams = { moveSpeed: p.stats.moveSpeed, slowMul: 1, radius: p.radius, castLock: false };
    const menv: MoveEnv = { arenaRadius: w.arenaRadius, walkable: w.env.walkable, moveCircle: w.env.moveCircle, surfaceAt: w.env.surfaceAt };
    let maxErr = 0;
    let far = 0;
    for (let t = 0; t < 600; t++) {
      // the stick sweeps the compass in 40-tick holds, so the hero is pushed into the notch walls and out of them
      const a = (Math.floor(t / 40) * Math.PI) / 4;
      const input = { moveX: Math.cos(a), moveZ: Math.sin(a) };
      updatePlayers(w, [input]);
      stepMove(ms, input.moveX, input.moveZ, params, menv);
      maxErr = Math.max(maxErr, Math.abs(ms.x - p.x), Math.abs(ms.z - p.z), Math.abs(ms.vx - p.vx), Math.abs(ms.vz - p.vz));
      far = Math.max(far, Math.hypot(p.x - 31.2, p.z + 51.1));
    }
    expect(maxErr).toBeLessThan(1e-9);
    expect(far, 'the run really left the notch').toBeGreaterThan(1.5);
  });

  it('moveHero is deterministic: same field, same arguments, same answer (host, mirror and prediction agree)', () => {
    const a = mk('suryeon', 1790389457).field;
    const b = createTerrainField(content.zones.find((z) => z.id === 'suryeon')!.biome, 1790389457);
    const o1 = { x: 0, z: 0 };
    const o2 = { x: 0, z: 0 };
    for (let k = 0; k < 16; k++) {
      const ang = (k * Math.PI) / 8;
      const x1 = 31.2 + Math.cos(ang) * 0.1;
      const z1 = -51.1 + Math.sin(ang) * 0.1;
      const r1 = a.env.moveCircle!(31.2, -51.1, x1, z1, PLAYER_RADIUS, o1);
      const r2 = b.env.moveCircle!(31.2, -51.1, x1, z1, PLAYER_RADIUS, o2);
      expect(o1).toEqual(o2);
      expect(r1).toBe(r2);
    }
  });

  it('the pocket-test memos change no answer: a field that has answered thousands of other steps walks the hero exactly like a fresh one', () => {
    const biome = content.zones.find((z) => z.id === 'suryeon')!.biome;
    const walkFromNotch = (f: TerrainField): number[] => {
      const out = { x: 0, z: 0 };
      const trail: number[] = [];
      for (let k = 0; k < 16; k++) {
        const a = (k * Math.PI) / 8;
        let x = 31.2;
        let z = -51.1;
        for (let t = 0; t < 90; t++) {
          f.env.moveCircle!(x, z, x + Math.cos(a) * 0.093, z + Math.sin(a) * 0.093, PLAYER_RADIUS, out);
          x = out.x;
          z = out.z;
        }
        trail.push(x, z);
      }
      return trail;
    };
    clearTerrainFieldCache();
    const warm = createTerrainField(biome, 1790389457);
    const out = { x: 0, z: 0 };
    // fill the memos with answers about other places near walls and pockets
    for (let z = -60; z <= -40; z += 0.37) {
      for (let x = 20; x <= 40; x += 0.37) {
        if (!warm.walkable(x, z) || warm.walkableCircle(x, z, PLAYER_RADIUS + 0.3)) continue;
        for (let k = 0; k < 16; k += 3) warm.env.moveCircle!(x, z, x + Math.cos(k) * 0.09, z + Math.sin(k) * 0.09, PLAYER_RADIUS, out);
      }
    }
    const a = walkFromNotch(warm);
    clearTerrainFieldCache();
    const fresh = createTerrainField(biome, 1790389457);
    expect(fresh).not.toBe(warm);
    expect(walkFromNotch(fresh)).toEqual(a);
  }, 120_000);
});
