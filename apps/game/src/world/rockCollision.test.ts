// SIM-08: rock collision blockers are derived from finalized RockPlacement dimensions and tilt (never stale pre-mutation
// sx/sy/sz), preventing heroes from walking into the solid rendered interior of scaled or tilted rocks.

import { Euler, Matrix4, Mesh, MeshBasicMaterial, Quaternion, Raycaster, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { content } from '../data/loader';
import { findLook } from '../render/terrain/look';
import { generateRocks, ROCK_VARIANTS, type RockSet } from '../render/vegetation/rockGeom';
import { rockMeshOpts } from '../render/vegetation/rockStyle';
import { PLAYER_RADIUS } from '../sim/constants';
import type { Blocker, RockKind, RockPlacement } from './layoutTypes';
import { clearTerrainFieldCache, createTerrainField, rockBlockers, type TerrainField } from './terrainField';

const _e = new Euler();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _m = new Matrix4();
const _ray = new Raycaster();
const _origin = new Vector3();
const _down = new Vector3(0, -1, 0);
const _mat = new MeshBasicMaterial();

function fieldOf(zoneId: string, seed = 1): TerrainField {
  const z = content.zones.find((q) => q.id === zoneId);
  if (!z) throw new Error(`missing zone ${zoneId}`);
  return createTerrainField(z.biome, seed);
}

/** true when vertical column (x, z) intersects solid rock mesh at hero torso height */
function insideRockMesh(r: RockPlacement, sets: Map<RockKind, RockSet>, x: number, z: number, groundY: number): boolean {
  const set = sets.get(r.kind);
  if (!set) return false;
  const geo = set.geos[(r.seed % ROCK_VARIANTS) * 2];
  if (!geo) return false;
  _e.set(r.tiltX ?? 0, r.yaw, r.tiltZ ?? 0, 'YXZ');
  _q.setFromEuler(_e);
  _p.set(r.x, r.y - (r.sink ?? 0), r.z);
  _s.set(r.sx, r.sy, r.sz);
  _m.compose(_p, _q, _s);

  const mesh = new Mesh(geo, _mat);
  mesh.matrixAutoUpdate = false;
  mesh.matrix.copy(_m);
  mesh.matrixWorld.copy(_m);

  _origin.set(x, r.y + Math.max(r.sx, r.sy, r.sz) * 3 + 5, z);
  _ray.set(_origin, _down);
  const hits = _ray.intersectObject(mesh, false);
  if (hits.length === 0) return false;
  let maxY = -Infinity;
  let minY = Infinity;
  for (const h of hits) {
    if (h.point.y > maxY) maxY = h.point.y;
    if (h.point.y < minY) minY = h.point.y;
  }
  const heroMid = groundY + 0.8;
  return maxY > groundY + 0.35 && minY <= heroMid && maxY >= groundY + 0.55;
}

describe('SIM-08: finalized rock collision blockers', () => {
  it('yeonmu seed 1 north-side boulder (-6.88, -56.08) blocks the hero outside its solid rendered mesh', () => {
    clearTerrainFieldCache();
    const field = fieldOf('yeonmu', 1);
    const boulder = field.layout.rocks.find((r) => Math.hypot(r.x - -6.88, r.z - -56.08) < 1.0);
    expect(boulder).toBeDefined();

    // exact destination that previously walked deep inside the scaled rock
    expect(field.walkableCircle(-5.352154323464786, -55.446095893061106, PLAYER_RADIUS)).toBe(false);

    // step repeatedly from outside toward the boulder centre using field.env.moveCircle
    let x = -3.5043952584422127;
    let z = -54.68072902833092;
    const out = { x, z };
    for (let step = 0; step < 60; step++) {
      const dx = boulder!.x - x;
      const dz = boulder!.z - z;
      const d = Math.hypot(dx, dz);
      if (d < 1e-6) break;
      const s = Math.min(0.12, d);
      field.env.moveCircle(x, z, x + (dx / d) * s, z + (dz / d) * s, PLAYER_RADIUS, out);
      if (Math.hypot(out.x - x, out.z - z) < 1e-5) break;
      x = out.x;
      z = out.z;
    }

    const look = findLook('yeonmu')?.rocks;
    const sets = new Map<RockKind, RockSet>([[boulder!.kind, generateRocks(boulder!.kind, rockMeshOpts(look, boulder!.kind))]]);
    expect(insideRockMesh(boulder!, sets, x, z, field.heightAt(x, z))).toBe(false);
    expect(field.walkableCircle(x, z, PLAYER_RADIUS * 0.85)).toBe(true);
  }, 60_000);

  it('walking toward every collidable interior rock in yeonmu seed 1 stops outside its 3D mesh at hero height', () => {
    const field = fieldOf('yeonmu', 1);
    const look = findLook('yeonmu')?.rocks;
    const sets = new Map<RockKind, RockSet>();
    const kinds = new Set<RockKind>(field.layout.rocks.map((r) => r.kind));
    for (const k of kinds) {
      sets.set(k, generateRocks(k, k === 'crystal' || k === 'pebbles' || k === 'basalt' ? undefined : rockMeshOpts(look, k)));
    }

    const out = { x: 0, z: 0 };
    let checked = 0;
    let penetrations = 0;
    for (const r of field.layout.rocks) {
      // match terrainField.ts blocking kinds (pebbles / rim wall outcrops & ledges do not emit rock blockers)
      if (r.sy <= 0.7 || r.kind === 'pebbles' || r.kind === 'outcrop' || r.kind === 'ledge') continue;
      if (Math.hypot(r.x, r.z) > field.arenaRadius - 8) continue;
      const startDist = Math.max(r.sx, r.sz) * 0.9 + 2.5;
      for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        let x = r.x + ax * startDist;
        let z = r.z + az * startDist;
        if (!field.walkableCircle(x, z, PLAYER_RADIUS)) continue;
        checked++;
        for (let step = 0; step < 60; step++) {
          const dx = r.x - x;
          const dz = r.z - z;
          const d = Math.hypot(dx, dz);
          if (d < 1e-5) break;
          const s = Math.min(0.14, d);
          field.env.moveCircle(x, z, x + (dx / d) * s, z + (dz / d) * s, PLAYER_RADIUS, out);
          if (Math.hypot(out.x - x, out.z - z) < 1e-5) break;
          x = out.x;
          z = out.z;
        }
        if (insideRockMesh(r, sets, x, z, field.heightAt(x, z))) penetrations++;
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(penetrations).toBe(0);
  }, 60_000);

  it('rockBlockers derives capsule/circle blockers from final dimensions, tilt, and sy > 0.7 threshold', () => {
    const overlaps = (bs: readonly Blocker[], x: number, z: number, r = PLAYER_RADIUS): boolean =>
      bs.some((b) => Math.hypot(x - b.x, z - b.z) < b.r + r);

    // 1. Elongated boulder (5.0 × 2.2 × 1.4): capsule circles cover both ends along X while staying tight along Z
    const elongated: RockPlacement = { kind: 'boulder', x: 10, z: 0, y: 0, sx: 5.0, sy: 2.2, sz: 1.4, yaw: 0, seed: 1, mat: 0, sink: 0.25 };
    const b1: Blocker[] = [];
    rockBlockers(elongated, undefined, b1);
    expect(b1.length).toBeGreaterThanOrEqual(2);
    expect(overlaps(b1, 10, 0)).toBe(true);
    expect(overlaps(b1, 7.8, 0)).toBe(true);
    expect(overlaps(b1, 12.2, 0)).toBe(true);
    expect(overlaps(b1, 10, 2.2)).toBe(false);

    // 2. Rock shrunk below sy = 0.7 emits no blocker unless explicitly forced blocking=true
    const low: RockPlacement = { kind: 'boulder', x: -10, z: 0, y: 0, sx: 2.4, sy: 0.45, sz: 2.4, yaw: 0, seed: 2, mat: 0, sink: 0.05 };
    const b2: Blocker[] = [];
    rockBlockers(low, undefined, b2);
    expect(b2).toHaveLength(0);
    rockBlockers(low, true, b2);
    expect(b2.length).toBeGreaterThanOrEqual(1);

    // 3. Tilted tall spire shifts and expands its footprint along the tilt lean direction
    const upright: RockPlacement = { kind: 'spire', x: 0, z: 0, y: 0, sx: 1.2, sy: 3.0, sz: 1.2, yaw: 0, seed: 3, mat: 0, sink: 0.2, tiltX: 0, tiltZ: 0 };
    const tilted: RockPlacement = { ...upright, tiltZ: 0.5 };
    const bu: Blocker[] = [];
    const bt: Blocker[] = [];
    rockBlockers(upright, undefined, bu);
    rockBlockers(tilted, undefined, bt);
    const maxExtentX = (bs: readonly Blocker[]): number => Math.max(...bs.map((b) => Math.abs(b.x) + b.r));
    expect(maxExtentX(bt)).toBeGreaterThan(maxExtentX(bu) + 0.35);
  });
});
