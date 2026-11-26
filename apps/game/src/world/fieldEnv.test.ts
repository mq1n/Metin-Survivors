// SOAK-4: the sim env the shipped game builds (app/run.ts: { ...field.env, bossModel }) carries the terrain hooks of ARCHITECTURE 7.1:
// moveCircle (hero movement against blockers) and surfaceAt (lava / miasma hurt, shallow slows, ice slides; spawns avoid lava / deep).

import { describe, expect, it } from 'vitest';
import { content } from '../data/loader';
import { Surface } from '../sim/constants';
import { updatePlayers } from '../sim/player';
import { spawnable } from '../sim/spawner';
import type { WorldEnv } from '../sim/types';
import { createWorld, type World } from '../sim/world';
import { createTerrainField, type TerrainField } from './terrainField';

function mk(zoneId: string, seed: number, env?: (field: TerrainField) => WorldEnv): { w: World; field: TerrainField } {
  const zone = content.zones.find((z) => z.id === zoneId);
  if (!zone) throw new Error(`zone ${zoneId}`);
  const field = createTerrainField(zone.biome, seed);
  const cls = content.classes.find((c) => c.id === 'yacha');
  if (!cls) throw new Error('class yacha');
  const worldEnv: WorldEnv = env ? env(field) : { ...field.env, bossModel: () => ({ spawn: 0, breath: false }) };
  const w = createWorld(
    { zone: zoneId, difficulty: 'normal', classId: 'yacha', doctrine: 'a', sex: cls.sexes[0] as never, empire: (content.empires[0] as { id: string }).id as never, seed, meta: { stats: {} } } as never,
    content,
    undefined,
    worldEnv,
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
}

function walk(w: World, dx: number, dz: number, ticks: number): void {
  const m = Math.hypot(dx, dz) || 1;
  const input = [{ moveX: dx / m, moveZ: dz / m }];
  for (let i = 0; i < ticks; i++) updatePlayers(w, input);
}

/** first walkable point on `surface` found on a coarse scan of the arena (null when the zone has none) */
function findSurface(field: TerrainField, surface: number): { x: number; z: number } | null {
  const R = field.arenaRadius - 5;
  for (let z = -R; z <= R; z += 1) {
    for (let x = -R; x <= R; x += 1) {
      if (Math.hypot(x, z) < R && field.surfaceAt(x, z) === surface && field.walkableCircle(x, z, 0.6)) return { x, z };
    }
  }
  return null;
}

describe('SOAK-4: field.env wires the terrain hooks into the sim', () => {
  for (const zone of ['yeonmu', 'suryeon', 'seori', 'daeryeol']) {
    it(`${zone}: env carries arenaRadius, walkable, moveCircle and surfaceAt`, () => {
      const { field } = mk(zone, 11);
      // r6 U6: + clearOfStatics (metin fall sites keep the drawn props, rocks, trees and walls out of the stone and its rubble)
      // r7 U7: + levelDisc (the metin rune carpet lies on open, level ground)
      // r9 Z9: + ringScore (a small metin's fall site prefers a fight ring the banners and roofs reach least into); r9 ship: + ringGround (no move onto worse ground)
      expect(Object.keys(field.env).sort()).toEqual(['arenaRadius', 'clearOfStatics', 'levelDisc', 'moveCircle', 'ringGround', 'ringScore', 'surfaceAt', 'walkable']);
      expect(typeof field.env.moveCircle).toBe('function');
      expect(typeof field.env.surfaceAt).toBe('function');
      expect(typeof field.env.clearOfStatics).toBe('function');
    });
  }

  it('standing in lava hurts the hero (and spawns avoid it); with the old env (no surfaceAt) it did not', () => {
    const { w, field } = mk('daeryeol', 11);
    const spot = findSurface(field, Surface.Lava);
    expect(spot, 'daeryeol has lava').not.toBeNull();
    place(w, spot!.x, spot!.z);
    const p = w.players[0]!;
    const hp0 = p.hp;
    for (let i = 0; i < 5 * 60; i++) updatePlayers(w, [{ moveX: 0, moveZ: 0 }]);
    expect(p.hp).toBeLessThan(hp0 - 1);
    expect(spawnable(w, spot!.x, spot!.z)).toBe(false);
    // the pre-fix env: arenaRadius + walkable only
    const old = mk('daeryeol', 11, (f) => ({ arenaRadius: f.env.arenaRadius, walkable: f.env.walkable }));
    place(old.w, spot!.x, spot!.z);
    const q = old.w.players[0]!;
    const hq = q.hp;
    for (let i = 0; i < 5 * 60; i++) updatePlayers(old.w, [{ moveX: 0, moveZ: 0 }]);
    expect(q.hp).toBe(hq);
  });

  it('miasma hurts, shallow water slows, ice keeps the hero sliding', () => {
    const seori = mk('seori', 11);
    const miasma = findSurface(seori.field, Surface.Miasma);
    expect(miasma, 'seori has miasma').not.toBeNull();
    place(seori.w, miasma!.x, miasma!.z);
    const hp0 = seori.w.players[0]!.hp;
    for (let i = 0; i < 5 * 60; i++) updatePlayers(seori.w, [{ moveX: 0, moveZ: 0 }]);
    expect(seori.w.players[0]!.hp).toBeLessThan(hp0 - 1);

    const ice = findSurface(seori.field, Surface.Ice);
    expect(ice, 'seori has ice').not.toBeNull();
    place(seori.w, ice!.x, ice!.z);
    walk(seori.w, 1, 0, 30);
    const before = { x: seori.w.players[0]!.x, z: seori.w.players[0]!.z };
    walk(seori.w, 0, 0, 20); // stick released: the hero keeps sliding on ice
    const slid = Math.hypot(seori.w.players[0]!.x - before.x, seori.w.players[0]!.z - before.z);
    expect(slid).toBeGreaterThan(0.5);
  });

  it('the Seori centre fence does not pin a hero walking into it (point rule: 72 of 73 start points pinned for 30 s)', () => {
    const { w, field } = mk('seori', 842245671);
    const p = w.players[0]!;
    const DX = -0.21;
    const DZ = 0.98;
    let tried = 0;
    let pinned = 0;
    for (let sx = -13.6; sx <= -6.4; sx += 0.1) {
      const fenceZ = -15.5 + ((sx + 13.5) / 7) * (-17.2 + 15.5);
      const sz = fenceZ - 1.5;
      if (!field.walkable(sx, sz)) continue;
      tried++;
      place(w, sx, sz);
      walk(w, DX, DZ, 180);
      const ax = p.x;
      const az = p.z;
      walk(w, DX, DZ, 1800);
      if (Math.hypot(p.x - ax, p.z - az) < 0.05) pinned++;
    }
    expect(tried).toBeGreaterThan(50);
    expect(pinned).toBe(0);
  });

  it('a hero standing in a pocket the circle rule refuses (every direction) still walks out', () => {
    // MATRIX-2 ledge: the point is not walkable for a hero disc; field.moveCircle alone refuses all 16 directions
    const { field } = mk('seori', 1000544849);
    const x0 = -32.5;
    const z0 = 81.5;
    const out = { x: 0, z: 0 };
    let rawMoves = 0;
    let heroMoves = 0;
    for (let k = 0; k < 16; k++) {
      const a = (k * Math.PI) / 8;
      const x1 = x0 + Math.cos(a) * 0.1;
      const z1 = z0 + Math.sin(a) * 0.1;
      field.moveCircle(x0, z0, x1, z1, 0.55, out);
      if (out.x !== x0 || out.z !== z0) rawMoves++;
      field.env.moveCircle(x0, z0, x1, z1, 0.55, out);
      if (out.x !== x0 || out.z !== z0) heroMoves++;
    }
    expect(rawMoves).toBe(0);
    expect(heroMoves).toBeGreaterThan(0);
  });

  it('plain wall contact is still circle-based: the hero never ends inside a blocker disc', () => {
    const { w, field } = mk('suryeon', 3);
    const p = w.players[0]!;
    // walk 16 directions from a free point for 6 s: the hero never rests where its disc overlaps a blocker or blocked cell
    const start = { x: 0, z: 0 };
    expect(field.nearestWalkable(0, 0, 20, start, 0.6)).toBe(true);
    for (let k = 0; k < 16; k++) {
      const a = (k * Math.PI) / 8;
      place(w, start.x, start.z);
      walk(w, Math.cos(a), Math.sin(a), 360);
      expect(field.walkableCircle(p.x, p.z, p.radius * 0.8), `direction ${k} ended at (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`).toBe(true);
    }
  });
});
