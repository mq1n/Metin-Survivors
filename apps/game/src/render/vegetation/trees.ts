// Tree system: one bark + one foliage BatchedMesh per species in the layout (all variants and both LODs packed into the
// batch, drawn with a single multi-draw each). A near-focus instance set is rebuilt only when the camera/focus moved
// more than 4 m or the quality changed; trees are looked up through a spatial grid, nearest first, and everything
// beyond the fog plane is dropped. LOD0/LOD1 copies of an instance overlap inside the fade window and are separated per
// pixel by complementary dither masks in the shader (see treeMaterials.ts).
import { BatchedMesh, Color, Group, Matrix4, Quaternion, Euler, Vector3, type BufferGeometry, type Material, type PerspectiveCamera } from 'three';
import type { TreePlacement, TreeSpecies, ZoneLayout } from '../../world/layoutTypes';
import { hash2 } from '../../world/rng';
import { findLook } from '../terrain/look';
import type { ZoneContext } from '../terrain/zoneContext';
import { loadOwnedVegTexture, loadVegNormal, type OwnedVegTexture } from './textures';
import { createBarkMaterial, createFoliageMaterial, lodWindow, type TreeLook } from './treeMaterials';
import { acquireTreeVariants, releaseTreeVariants, TREE_VARIANTS, type TreeVariantSet } from './treeVariants';
import type { TreeStyle } from './treeCommon';
import type { VegPart, VegQuality } from './types';

export interface SpeciesAssets {
  bark: string;
  fol: [string, string | null];
  look: TreeLook;
}

const NO_SNOW = { snow: 0, ember: 0 };
const SPECIES_ASSETS: Record<TreeSpecies, SpeciesAssets> = {
  pine: { bark: 'tex_bark_pine', fol: ['tex_fol_pine_branch', null], look: { grade: [0.9, 0.95, 0.92], barkGrade: [0.58, 0.48, 0.42], translucency: 0.3, ...NO_SNOW } },
  broadleaf: { bark: 'tex_bark_oak', fol: ['tex_fol_broadleaf', null], look: { grade: [0.86, 0.92, 0.8], barkGrade: [0.9, 0.88, 0.85], translucency: 0.45, ...NO_SNOW } },
  autumn: { bark: 'tex_bark_oak', fol: ['tex_fol_autumn', 'tex_fol_broadleaf'], look: { grade: [0.88, 0.84, 0.8], barkGrade: [0.95, 0.85, 0.78], translucency: 0.5, ...NO_SNOW } },
  snowpine: { bark: 'tex_bark_pine', fol: ['tex_fol_pine_snow', 'tex_fol_pine_branch'], look: { grade: [0.95, 0.97, 1.0], barkGrade: [0.52, 0.46, 0.43], translucency: 0.2, snow: 1, ember: 0 } },
  bare: { bark: 'tex_bark_oak', fol: ['tex_fol_dead_branch', null], look: { grade: [0.9, 0.88, 0.86], barkGrade: [0.86, 0.84, 0.82], translucency: 0, ...NO_SNOW } },
  charred: { bark: 'tex_bark_charred', fol: ['tex_fol_dead_branch', null], look: { grade: [0.5, 0.45, 0.42], barkGrade: [0.9, 0.85, 0.85], translucency: 0, snow: 0, ember: 1.5 } },
};

/** per-zone adaptation of a species' look (snowy bare trees, scorched bare trees) */
function assetsFor(species: TreeSpecies, style: TreeStyle, scorched: boolean): SpeciesAssets {
  const base = SPECIES_ASSETS[species];
  if (species === 'bare' && style.snowy) return { ...base, look: { ...base.look, grade: [0.8, 0.82, 0.86], barkGrade: [0.78, 0.8, 0.86], snow: 0.9 } };
  if (species === 'bare' && scorched) return { bark: 'tex_bark_charred', fol: base.fol, look: { grade: [0.42, 0.38, 0.36], barkGrade: [0.8, 0.78, 0.78], translucency: 0, snow: 0, ember: 0.4 } };
  return base;
}

/**
 * Per-zone, per-species tree override (C4) = `look.trees.<species>` of render/terrain/look/<zone>.ts: the material knobs
 * of TreeLook (grade, barkGrade, translucency, snow, ember) plus the optional texture ids `bark` and `fol`, e.g.
 * { grade: [1, 0.9, 0.8], fol: ['tex_fol_yeonmu_autumn', null] } swaps the autumn crown texture in one zone only.
 */
export type TreeSpeciesLook = Partial<TreeLook>;

/** `assetsFor` with the zone's override merged over it, key by key (undefined keys are ignored). Pure. */
export function withTreeLook(a: SpeciesAssets, o: TreeSpeciesLook | undefined): SpeciesAssets {
  if (!o) return a;
  const look: TreeLook = { ...a.look };
  if (o.grade) look.grade = o.grade;
  if (o.barkGrade) look.barkGrade = o.barkGrade;
  if (o.translucency !== undefined) look.translucency = o.translucency;
  if (o.snow !== undefined) look.snow = o.snow;
  if (o.ember !== undefined) look.ember = o.ember;
  return { bark: o.bark ?? a.bark, fol: o.fol ?? a.fol, look };
}

/** The foliage texture ids [A, B] a species draws in a zone (the tree system's own choice, `look.trees.<species>.fol` included). */
export function foliageIdsFor(species: TreeSpecies, layout: Pick<ZoneLayout, 'groundLayers'>, override: TreeSpeciesLook | undefined): [string, string | null] {
  const scorched = layout.groundLayers.some((l) => /basalt|lava|scorched|ash/.test(l.tex));
  return withTreeLook(assetsFor(species, treeStyleFor(layout), scorched), override).fol;
}

/** Zone-derived generation switches shared by the tree system and the baked crown shadows (same variants in both). */
export function treeStyleFor(layout: Pick<ZoneLayout, 'groundLayers'>): TreeStyle {
  return { snowy: layout.groundLayers.some((l) => /snow|ice/.test(l.tex)) };
}

/**
 * Per-instance look of a tree (yaw comes from the placement): a small lean about X / Z and independent horizontal /
 * vertical scale jitter. `item` is the tree's index in its species list, in layout order. TreeLayer.place and the baked
 * crown shadows (terrain/treeShadow.ts) both read this, so the shadow follows the drawn crown.
 */
export function treeJitter(item: number, t: TreePlacement): { rx: number; rz: number; sxz: number; sy: number } {
  const h1 = hash2(item, t.seed, 11);
  const h2 = hash2(item, t.seed, 23);
  const h3 = hash2(item, t.seed, 37);
  return { rx: (h1 - 0.5) * 0.07, rz: (h2 - 0.5) * 0.07, sxz: t.scale * (0.92 + h3 * 0.16), sy: t.scale * (0.9 + hash2(item, t.seed, 51) * 0.2) };
}

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();
const _c = new Color();

class TreeLayer {
  readonly bark: BatchedMesh;
  readonly foliage: BatchedMesh;
  private readonly items: TreePlacement[];
  private readonly nVar = TREE_VARIANTS;
  /** slot (BatchedMesh instance id) per item and LOD, -1 = none */
  private readonly slot0: Int32Array;
  private readonly slot1: Int32Array;
  private readonly mark: Uint32Array;
  private readonly owner: Int32Array;
  private readonly free: number[] = [];
  private epoch = 0;
  private readonly grid = new Map<number, number[]>();
  private readonly cell = 32;
  private readonly capacity: number;
  private activeCap = 0;
  private cand: Array<{ i: number; d: number; dc: number }> = [];
  private lastCam = { x: 1e9, z: 1e9 };
  private lastFocus = { x: 1e9, z: 1e9 };
  dirty = true;
  range = 150;

  constructor(readonly species: TreeSpecies, items: TreePlacement[], set: TreeVariantSet, barkMat: Material, folMat: Material, maxSlots: number) {
    this.items = items;
    this.slot0 = new Int32Array(items.length).fill(-1);
    this.slot1 = new Int32Array(items.length).fill(-1);
    this.mark = new Uint32Array(items.length);
    this.capacity = Math.min(maxSlots, items.length * 2);
    this.owner = new Int32Array(this.capacity).fill(-1);
    this.bark = this.makeBatch(set.bark, barkMat);
    this.foliage = this.makeBatch(set.foliage, folMat);
    for (let s = this.capacity - 1; s >= 0; s--) this.free.push(s);
    for (let i = 0; i < items.length; i++) {
      const t = items[i] as TreePlacement;
      const key = this.key(Math.floor(t.x / this.cell), Math.floor(t.z / this.cell));
      const list = this.grid.get(key);
      if (list) list.push(i);
      else this.grid.set(key, [i]);
    }
  }

  private key(cx: number, cz: number): number {
    return (cx + 64) * 256 + (cz + 64);
  }

  private makeBatch(geos: BufferGeometry[], mat: Material): BatchedMesh {
    let verts = 0;
    let idx = 0;
    for (const g of geos) {
      verts += g.getAttribute('position').count;
      idx += g.getIndex()?.count ?? 0;
    }
    const mesh = new BatchedMesh(this.capacity, verts, idx, mat);
    for (const g of geos) mesh.addGeometry(g);
    for (let i = 0; i < this.capacity; i++) {
      mesh.addInstance(0);
      mesh.setVisibleAt(i, false);
    }
    mesh.sortObjects = false;
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.name = `trees_${this.species}`;
    return mesh;
  }

  setBudget(slots: number, range: number): void {
    const a = Math.min(this.capacity, slots);
    if (a !== this.activeCap || range !== this.range) this.dirty = true;
    this.activeCap = a;
    this.range = range;
  }

  update(camera: PerspectiveCamera, focus: Vector3): void {
    const cx = camera.position.x;
    const cz = camera.position.z;
    const moved = Math.max(Math.abs(cx - this.lastCam.x) + Math.abs(cz - this.lastCam.z), Math.abs(focus.x - this.lastFocus.x) + Math.abs(focus.z - this.lastFocus.z));
    if (!this.dirty && moved < 4) return;
    this.dirty = false;
    this.lastCam.x = cx;
    this.lastCam.z = cz;
    this.lastFocus.x = focus.x;
    this.lastFocus.z = focus.z;
    this.rebuild(cx, cz, focus.x, focus.z);
  }

  private gather(x: number, z: number): void {
    const R = this.range;
    const c0x = Math.floor((x - R) / this.cell);
    const c1x = Math.floor((x + R) / this.cell);
    const c0z = Math.floor((z - R) / this.cell);
    const c1z = Math.floor((z + R) / this.cell);
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cz = c0z; cz <= c1z; cz++) {
        const list = this.grid.get(this.key(cx, cz));
        if (!list) continue;
        for (const i of list) {
          if (this.mark[i] === this.epoch) continue;
          this.mark[i] = this.epoch;
          const t = this.items[i] as TreePlacement;
          const dc = Math.hypot(t.x - this.lastCam.x, t.z - this.lastCam.z);
          const df = Math.hypot(t.x - this.lastFocus.x, t.z - this.lastFocus.z);
          const d = Math.min(dc, df);
          if (d <= R) this.cand.push({ i, d, dc });
        }
      }
    }
  }

  private rebuild(cx: number, cz: number, fx: number, fz: number): void {
    this.epoch++;
    this.cand.length = 0;
    this.gather(cx, cz);
    this.gather(fx, fz);
    this.cand.sort((a, b) => a.d - b.d);
    const lo = lodWindow.value.x - 6;
    const hi = lodWindow.value.y + 6;
    let budget = this.activeCap;
    const want0 = new Set<number>();
    const want1 = new Set<number>();
    for (const c of this.cand) {
      if (budget <= 0) break;
      if (c.dc < hi) {
        want0.add(c.i);
        budget--;
      }
      if (c.dc > lo && budget > 0) {
        want1.add(c.i);
        budget--;
      }
    }
    // release slots no longer wanted
    for (let s = 0; s < this.capacity; s++) {
      const o = this.owner[s] as number;
      if (o < 0) continue;
      const item = o >> 1;
      const lod = o & 1;
      if ((lod === 0 ? want0 : want1).has(item)) continue;
      this.bark.setVisibleAt(s, false);
      this.foliage.setVisibleAt(s, false);
      this.owner[s] = -1;
      (lod === 0 ? this.slot0 : this.slot1)[item] = -1;
      this.free.push(s);
    }
    let live = 0;
    for (const [lod, set] of [[0, want0], [1, want1]] as const) {
      const slots = lod === 0 ? this.slot0 : this.slot1;
      for (const item of set) {
        if ((slots[item] as number) >= 0) continue;
        const s = this.free.pop();
        if (s === undefined) break;
        slots[item] = s;
        this.owner[s] = item * 2 + lod;
        this.place(s, item, lod);
      }
    }
    for (let s = 0; s < this.capacity; s++) if ((this.owner[s] as number) >= 0) live++;
    this.bark.visible = this.foliage.visible = live > 0;
  }

  private place(slot: number, item: number, lod: number): void {
    const t = this.items[item] as TreePlacement;
    const variant = t.seed % this.nVar;
    const h1 = hash2(item, t.seed, 11);
    const h2 = hash2(item, t.seed, 23);
    const h3 = hash2(item, t.seed, 37);
    const j = treeJitter(item, t);
    _e.set(j.rx, t.yaw, j.rz, 'YXZ');
    _q.setFromEuler(_e);
    _p.set(t.x, t.y, t.z);
    _s.set(j.sxz, j.sy, j.sxz);
    _m.compose(_p, _q, _s);
    const geo = variant * 2 + lod;
    this.bark.setGeometryIdAt(slot, geo);
    this.foliage.setGeometryIdAt(slot, geo);
    this.bark.setMatrixAt(slot, _m);
    this.foliage.setMatrixAt(slot, _m);
    // per-instance tint: brightness plus a small warm/cool shift
    const v = 0.92 + h2 * 0.16;
    const warm = (h1 - 0.5) * 0.12;
    this.foliage.setColorAt(slot, _c.setRGB(v * (1 + warm), v, v * (1 - warm)));
    const bv = 0.88 + h3 * 0.2;
    this.bark.setColorAt(slot, _c.setRGB(bv, bv, bv));
    this.bark.setVisibleAt(slot, true);
    this.foliage.setVisibleAt(slot, true);
  }

  dispose(): void {
    this.bark.dispose();
    this.foliage.dispose();
  }
}

export interface TreeSystemInit {
  ctx: ZoneContext;
  placements: TreePlacement[];
}

export function createTrees(init: TreeSystemInit): VegPart & { stats: () => string } {
  const { ctx, placements } = init;
  const group = new Group();
  group.name = 'trees';
  const layers: TreeLayer[] = [];
  const disposables: Array<{ dispose(): void }> = [];
  const layout = ctx.field.layout;
  const style: TreeStyle = treeStyleFor(layout);
  const acquired: TreeSpecies[] = [];
  const scorched = layout.groundLayers.some((l) => /basalt|lava|scorched|ash/.test(l.tex));
  // zone look override per species (render/terrain/look/<zone>.ts `trees`); absent = the global species table
  const overrides = findLook(ctx.biome.id)?.trees;
  let quality = null as VegQuality | null;
  let disposed = false;
  const tris: string[] = [];

  const bySpecies = new Map<TreeSpecies, TreePlacement[]>();
  for (const t of placements) {
    const list = bySpecies.get(t.species);
    if (list) list.push(t);
    else bySpecies.set(t.species, [t]);
  }

  const ready = (async () => {
    for (const [species, items] of bySpecies) {
      const a = withTreeLook(assetsFor(species, style, scorched), overrides?.[species]);
      const [barkRes, norm, folARes, folBRes] = await Promise.all([
        loadOwnedVegTexture(ctx.assets, a.bark),
        loadVegNormal(ctx.assets, a.bark),
        loadOwnedVegTexture(ctx.assets, a.fol[0]),
        a.fol[1] ? loadOwnedVegTexture(ctx.assets, a.fol[1]) : Promise.resolve<OwnedVegTexture | null>(null),
      ]);
      if (disposed) {
        barkRes.dispose();
        folARes.dispose();
        folBRes?.dispose();
        return;
      }
      if (barkRes.owned) disposables.push(barkRes);
      if (folARes.owned) disposables.push(folARes);
      if (folBRes?.owned) disposables.push(folBRes);
      const t0 = performance.now();
      const set = acquireTreeVariants(species, style);
      acquired.push(species);
      const barkMat = createBarkMaterial(a.look, barkRes.texture, norm);
      const folMat = createFoliageMaterial(a.look, folARes.texture, folBRes?.texture ?? null);
      disposables.push(barkMat, folMat);
      const layer = new TreeLayer(species, items, set, barkMat, folMat, 1100);
      for (const g of [...set.bark, ...set.foliage]) disposables.push(g);
      layers.push(layer);
      group.add(layer.bark, layer.foliage);
      const avg = set.tris.reduce((s, t) => [s[0] + t[0], s[1] + t[1]] as [number, number], [0, 0] as [number, number]);
      tris.push(`${species}: ${items.length} trees, tris/variant LOD0 ${Math.round(avg[0] / set.tris.length)} LOD1 ${Math.round(avg[1] / set.tris.length)}, gen ${(performance.now() - t0).toFixed(0)} ms`);
      if (quality) layer.setBudget(quality.treeSlots, effectiveRange(quality));
    }
  })();

  function effectiveRange(q: VegQuality): number {
    return Math.min(q.treeRange, ctx.core.env.fog.far + 8);
  }

  return {
    group,
    ready,
    stats: () => tris.join('\n'),
    update(_dt, camera, focus) {
      for (const l of layers) l.update(camera, focus);
    },
    setQuality(q) {
      quality = q;
      lodWindow.value.set(q.lodNear, q.lodFar);
      for (const l of layers) l.setBudget(q.treeSlots, effectiveRange(q));
    },
    dispose() {
      disposed = true;
      for (const l of layers) l.dispose();
      layers.length = 0;
      for (const d of disposables) d.dispose();
      disposables.length = 0;
      for (const sp of acquired) releaseTreeVariants(sp, style);
      acquired.length = 0;
      group.clear();
    },
  };
}
