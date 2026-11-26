// Pickup build orchestrator: HardMesh soup (group = bone * 256 + zone) -> welded mesh -> exact hidden-face clip -> ray-cast AO +
// painter driven adaptive refinement -> ModelData (static, or rigidly skinned with a lid bone).
import type { ClipData } from '../../core/anim/clip.ts';
import type { HardMesh } from '../../core/hard/hardmesh.ts';
import type { Mat4 } from '../../core/math.ts';
import type { ModelData } from '../../core/model.ts';
import type { Rgb } from '../../core/paint/painter.ts';
import type { Skeleton } from '../../core/skin/skeleton.ts';
import { AoField, type AoSpec, type ColorFn, type RefineSpec, poseSoup, refineShaded } from './bake.ts';
import { Bvh } from './bvh.ts';
import { type CarveOpts, type Cover, carveCovered } from './clip.ts';
import { TriMesh } from './mesh.ts';

export interface PaintCtx {
  /** position (model space, m) */
  x: number;
  y: number;
  z: number;
  /** smooth vertex normal */
  nx: number;
  ny: number;
  nz: number;
  zone: number;
  bone: number;
  /** baked ambient visibility 0..1 */
  ao: number;
  /** 0 on flats, grows on bevelled / curved surface (1 - cos to the incident faces) */
  bevel: number;
}
/** writes the base (pre-AO) linear albedo into `out` */
export type PaintFn = (c: PaintCtx, out: Rgb) => void;

export interface Grade {
  /** brightness multiplier at ao = 0 (default 0.3) */
  floor?: number;
  /** ao contrast (default 1.2) */
  gamma?: number;
  /** per-channel multiplier of the floor (shadows tint; default neutral) */
  tint?: Rgb;
}

export interface PickupSpec {
  id: string;
  mesh: HardMesh;
  /** crease angle for smooth normals (deg, default 40) */
  crease?: number;
  paint: PaintFn;
  grade?: Grade;
  ao: AoSpec;
  refine: RefineSpec;
  /** convex solids that hide the faces of other parts on the same bone (see clip.ts) */
  covers?: readonly Cover[];
  /** per-face slicing into rows (wood grain), applied together with the cover clip */
  slice?: CarveOpts['slice'];
  /** rigid skin: bone ids come from the group (group >> 8) */
  skin?: { skeleton: Skeleton; openXf: Mat4 };
  clips?: ClipData[];
  extras?: Record<string, unknown>;
}

/** linear grade helper shared by every pickup */
export function applyGrade(base: Rgb, ao: number, g: Grade, out: number[]): void {
  const floor = g.floor ?? 0.3;
  const k = Math.pow(Math.max(0, Math.min(1, ao)), g.gamma ?? 1.2);
  const t = g.tint ?? [1, 1, 1];
  for (let i = 0; i < 3; i++) {
    const dark = base[i]! * floor * t[i]!;
    out[i] = Math.min(1, dark + (base[i]! - dark) * k);
  }
}

export function buildPickup(spec: PickupSpec, log: (s: string) => void = () => {}): ModelData {
  const t0 = performance.now();
  const hm = spec.mesh.finish({ crease: spec.crease ?? 40 });
  let m = TriMesh.fromHard(hm);
  const baseTris = m.nt;
  const openXf = spec.skin?.openXf ?? null;
  if (spec.covers || spec.slice) m = carveCovered(m, spec.covers ?? [], { slice: spec.slice });
  const carvedTris = m.nt;
  const closedBvh = new Bvh(m.soup());
  const openBvh = openXf ? new Bvh(poseSoup(m, openXf)) : null;
  const field = new AoField(closedBvh, openBvh, spec.ao, openXf);
  const base: Rgb = [0, 0, 0];
  const ctx: PaintCtx = { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, zone: 0, bone: 0, ao: 1, bevel: 0 };
  const grade = spec.grade ?? {};
  const fn: ColorFn = (px, py, pz, nx, ny, nz, grp, bevel, out) => {
    const zone = grp & 255, bone = grp >> 8;
    const ao = field.at(px, py, pz, nx, ny, nz, zone, bone);
    ctx.x = px; ctx.y = py; ctx.z = pz; ctx.nx = nx; ctx.ny = ny; ctx.nz = nz; ctx.zone = zone; ctx.bone = bone; ctx.ao = ao; ctx.bevel = bevel;
    base[0] = 0.5; base[1] = 0.5; base[2] = 0.5;
    spec.paint(ctx, base);
    applyGrade(base, ao, grade, out);
  };
  const shaded = refineShaded(m, fn, { ...spec.refine, log: spec.refine.log ?? log });

  const nv = m.nv;
  const positions = Float32Array.from(m.pos);
  let minY = Infinity, maxY = -Infinity, r2 = 0;
  for (let i = 0; i < nv; i++) {
    minY = Math.min(minY, positions[i * 3 + 1]!);
    maxY = Math.max(maxY, positions[i * 3 + 1]!);
    r2 = Math.max(r2, positions[i * 3]! ** 2 + positions[i * 3 + 2]! ** 2);
  }
  if (Math.abs(minY) > 2e-3) log(`  warning: base at y=${minY.toFixed(4)} (expected 0)`);
  const model: ModelData = {
    id: spec.id,
    kind: 'pickup',
    positions,
    normals: Float32Array.from(m.nrm),
    colors: Float32Array.from(shaded.color),
    indices: Uint32Array.from(m.idx),
    clips: spec.clips ?? [],
    height: maxY - Math.min(0, minY),
    radius: Math.sqrt(r2),
    ...(spec.extras ? { extras: spec.extras } : {}),
  };
  if (spec.skin) {
    const joints = new Uint8Array(nv * 4);
    const weights = new Uint8Array(nv * 4);
    for (let i = 0; i < nv; i++) {
      joints[i * 4] = m.grp[i]! >> 8;
      weights[i * 4] = 255;
    }
    model.skin = { skeleton: spec.skin.skeleton, joints, weights };
  }
  const perZone = new Map<number, number>();
  for (let t = 0; t < m.nt; t++) perZone.set(m.triGroup(t) & 255, (perZone.get(m.triGroup(t) & 255) ?? 0) + 1);
  log(`  ${spec.id}: base ${baseTris} -> carved ${carvedTris} -> ${model.indices.length / 3} tris, ${nv} verts, ${Math.round(performance.now() - t0)} ms`);
  log(`  zones: ${[...perZone].sort((a, b) => a[0] - b[0]).map(([z, n]) => `${z}:${n}`).join(' ')}`);
  return model;
}
