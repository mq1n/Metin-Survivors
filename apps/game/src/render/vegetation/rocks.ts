// Rock system: one BatchedMesh per rock material (all stone kinds, variants and both LODs packed into the batch) plus one
// for crystals — a handful of multi-draws in total. A near-focus instance set is rebuilt only when the camera / focus
// moved more than 4 m or the quality changed; rocks are found through a spatial grid and ranked by distance, so
// nothing off-range is ever submitted and huge rim outcrops cost the same as a pebble.
import { BatchedMesh, Color, Euler, Group, Matrix4, Quaternion, Vector3, type BufferGeometry, type Material, type PerspectiveCamera, type Texture } from 'three';
import type { RockKind, RockPlacement } from '../../world/layoutTypes';
import { hash2 } from '../../world/rng';
import { findLook } from '../terrain/look';
import type { ZoneContext } from '../terrain/zoneContext';
import { generateRocks, ROCK_VARIANTS, type RockSet } from './rockGeom';
import { capStyleFor, createStoneMaterial, crystalMaterialFor, crystalStyleFor, type StoneLift, type StoneTune } from './rockMaterials';
import { rockGroupKey, rockLift, rockMeshOpts, rockStyleFor, rockTune } from './rockStyle';
import { loadOwnedVegTexture, loadVegNormal } from './textures';
import type { VegPart, VegQuality } from './types';

function linearRgb(hex: string): [number, number, number] {
  const c = new Color(hex);
  return [c.r, c.g, c.b];
}

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();
const _c = new Color();

const CELL = 32;

class RockLayer {
  readonly mesh: BatchedMesh;
  private readonly items: RockPlacement[];
  /** geometry id per kind, variant*2+lod */
  private readonly gids = new Map<RockKind, number[]>();
  private readonly grid = new Map<number, number[]>();
  private readonly mark: Uint32Array;
  private readonly capacity: number;
  private activeCap = 0;
  private range = 150;
  private lodNear = 54;
  private epoch = 0;
  private shown = 0;
  private dirty = true;
  private cand: Array<{ i: number; d: number }> = [];
  private last = { cx: 1e9, cz: 1e9, fx: 1e9, fz: 1e9 };

  constructor(name: string, items: RockPlacement[], sets: RockSet[], mat: Material, maxSlots: number) {
    this.items = items;
    this.mark = new Uint32Array(items.length);
    this.capacity = Math.min(maxSlots, items.length);
    let verts = 0;
    let idx = 0;
    for (const s of sets) {
      for (const g of s.geos) {
        verts += g.getAttribute('position').count;
        idx += g.getIndex()?.count ?? 0;
      }
    }
    this.mesh = new BatchedMesh(this.capacity, verts, idx, mat);
    for (const s of sets) {
      const ids: number[] = [];
      for (const g of s.geos as BufferGeometry[]) ids.push(this.mesh.addGeometry(g));
      this.gids.set(s.kind, ids);
    }
    for (let i = 0; i < this.capacity; i++) {
      this.mesh.addInstance(0);
      this.mesh.setVisibleAt(i, false);
    }
    // allocates the per-instance colour texture before the first compile so the material gets the colour path
    this.mesh.setColorAt(0, _c.setRGB(1, 1, 1));
    this.mesh.sortObjects = false;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.name = name;
    items.forEach((r, i) => {
      const key = this.key(Math.floor(r.x / CELL), Math.floor(r.z / CELL));
      const list = this.grid.get(key);
      if (list) list.push(i);
      else this.grid.set(key, [i]);
    });
    this.mesh.visible = false;
  }

  private key(cx: number, cz: number): number {
    return (cx + 64) * 256 + (cz + 64);
  }

  setBudget(slots: number, range: number, lodNear: number): void {
    const a = Math.min(this.capacity, slots);
    if (a !== this.activeCap || range !== this.range || lodNear !== this.lodNear) this.dirty = true;
    this.activeCap = a;
    this.range = range;
    this.lodNear = lodNear;
  }

  update(camera: PerspectiveCamera, focus: Vector3): void {
    const l = this.last;
    const cx = camera.position.x;
    const cz = camera.position.z;
    const moved = Math.abs(cx - l.cx) + Math.abs(cz - l.cz) + Math.abs(focus.x - l.fx) + Math.abs(focus.z - l.fz);
    if (!this.dirty && moved < 4) return;
    this.dirty = false;
    l.cx = cx;
    l.cz = cz;
    l.fx = focus.x;
    l.fz = focus.z;
    this.rebuild();
  }

  private gather(x: number, z: number): void {
    const R = this.range + 24;
    const l = this.last;
    for (let cx = Math.floor((x - R) / CELL); cx <= Math.floor((x + R) / CELL); cx++) {
      for (let cz = Math.floor((z - R) / CELL); cz <= Math.floor((z + R) / CELL); cz++) {
        const list = this.grid.get(this.key(cx, cz));
        if (!list) continue;
        for (const i of list) {
          if (this.mark[i] === this.epoch) continue;
          const r = this.items[i] as RockPlacement;
          const half = 0.5 * Math.max(r.sx, r.sz);
          // pebbles are only worth drawing close up
          const reach = (r.kind === 'pebbles' ? this.range * 0.4 : this.range) + half;
          const d = Math.min(Math.hypot(r.x - l.cx, r.z - l.cz), Math.hypot(r.x - l.fx, r.z - l.fz));
          this.mark[i] = this.epoch;
          if (d <= reach) this.cand.push({ i, d: d - half });
        }
      }
    }
  }

  private rebuild(): void {
    this.epoch++;
    this.cand.length = 0;
    this.gather(this.last.cx, this.last.cz);
    this.gather(this.last.fx, this.last.fz);
    this.cand.sort((a, b) => a.d - b.d);
    const n = Math.min(this.cand.length, this.activeCap);
    for (let s = 0; s < n; s++) this.place(s, this.cand[s] as { i: number; d: number });
    for (let s = n; s < this.shown; s++) this.mesh.setVisibleAt(s, false);
    this.shown = n;
    this.mesh.visible = n > 0;
  }

  private place(slot: number, c: { i: number; d: number }): void {
    const r = this.items[c.i] as RockPlacement;
    const ids = this.gids.get(r.kind) as number[];
    const ext = Math.max(r.sx, r.sz, r.sy);
    const lod = c.d > this.lodNear + ext * 1.5 ? 1 : 0;
    this.mesh.setGeometryIdAt(slot, ids[(r.seed % ROCK_VARIANTS) * 2 + lod] as number);
    _e.set(r.tiltX ?? 0, r.yaw, r.tiltZ ?? 0, 'YXZ');
    _q.setFromEuler(_e);
    _p.set(r.x, r.y - (r.sink ?? 0), r.z);
    _s.set(r.sx, r.sy, r.sz);
    this.mesh.setMatrixAt(slot, _m.compose(_p, _q, _s));
    const h1 = hash2(c.i, r.seed, 5);
    const h2 = hash2(c.i, r.seed, 17);
    const v = 0.88 + h1 * 0.2;
    this.mesh.setColorAt(slot, _c.setRGB(v * (1 + (h2 - 0.5) * 0.1), v, v * (1 - (h2 - 0.5) * 0.1)));
    this.mesh.setVisibleAt(slot, true);
  }

  dispose(): void {
    this.mesh.dispose();
  }
}

export interface RockSystemInit {
  ctx: ZoneContext;
  placements: RockPlacement[];
}

export function createRocks(init: RockSystemInit): VegPart & { stats: () => string } {
  const { ctx, placements } = init;
  const group = new Group();
  group.name = 'rocks';
  const layers: RockLayer[] = [];
  const disposables: Array<{ dispose(): void }> = [];
  const info: string[] = [];
  let quality = null as VegQuality | null;
  const mats = ctx.field.layout.rockMaterials;

  function budget(l: RockLayer, q: VegQuality): void {
    l.setBudget(q.rockSlots, Math.min(q.rockRange, ctx.core.env.fog.far + 8), q.lodNear);
  }

  let disposed = false;
  const ready = (async () => {
    const kinds = new Set<RockKind>(placements.map((r) => r.kind));
    const sets = new Map<RockKind, RockSet>();
    const t0 = performance.now();
    const look = findLook(ctx.biome.id);
    const rockLook = look?.rocks;
    for (const k of kinds) {
      // A2: the zone's mesh relief / roughness for this kind (absent = the meshes as before)
      const s = generateRocks(k, k === 'crystal' || k === 'pebbles' || k === 'basalt' ? undefined : rockMeshOpts(rockLook, k));
      sets.set(k, s);
      for (const g of s.geos) disposables.push(g);
    }
    info.push(`rocks: ${placements.length} placements, ${kinds.size} kinds, gen ${(performance.now() - t0).toFixed(0)} ms`);
    const stoneSets = [...sets.values()].filter((s) => s.kind !== 'crystal');
    // one batch per material group: the placement's material index (as before), or - when the zone look has rock knobs - the
    // texture id (own tile per kind) plus the resolved style of its kind, so every group has its own uniforms
    const groups = new Map<string, { id: string; kind: RockKind; items: RockPlacement[] }>();
    const crystals: RockPlacement[] = [];
    for (const r of placements) {
      if (r.kind === 'crystal') {
        crystals.push(r);
        continue;
      }
      const m = mats.length > 0 ? r.mat % mats.length : 0;
      const id = rockLook?.tex?.[r.kind] ?? mats[m] ?? 'tex_rock_mossy';
      const key = rockLook ? rockGroupKey(id, rockStyleFor(rockLook, r.kind)) : String(m);
      const g = groups.get(key);
      if (g) g.items.push(r);
      else groups.set(key, { id, kind: r.kind, items: [r] });
    }
    // C1: the zone's cliff knobs also lift rock walls (outcrops, boulders) in shade; absent = the old shading
    const cliff = look?.style.cliff;
    const sky = linearRgb(look?.fill.sky ?? '#ffffff');
    for (const g of groups.values()) {
      if (disposed) return;
      const { id, items } = g;
      const style = rockStyleFor(rockLook, g.kind);
      const lift: StoneLift | null = rockLift(cliff, style, sky);
      const tune: StoneTune | null = rockTune(style);
      const [texRes, nrm] = await Promise.all([loadOwnedVegTexture(ctx.assets, id), loadVegNormal(ctx.assets, id)]);
      if (disposed) {
        texRes.dispose();
        return;
      }
      if (texRes.owned) disposables.push(texRes);
      const tex = texRes.texture;
      // basalt-like stone is nearly black in its texture: lift it so the silhouette stays readable under a dark sky
      const dark = /basalt|scorched|ash|lava|obsidian/.test(id);
      // cap: the zone look's explicit entry for this rock id first, the id-substring guess second
      // (A2: a kind style may set its own cap, or null for none: snow only on the tops of the wall blocks, not on every boulder)
      const cap = style?.cap !== undefined ? style.cap : (look?.rockCaps?.[id] ?? capStyleFor(id));
      const gain = style?.gain;
      const tint = style?.tint ? linearRgb(style.tint) : null;
      const base: [number, number, number] = gain !== undefined ? [gain, gain, gain] : dark ? [2.8, 2.6, 2.5] : [0.9, 0.9, 0.9];
      const grade: [number, number, number] = tint ? [base[0] * tint[0], base[1] * tint[1], base[2] * tint[2]] : base;
      const mat = createStoneMaterial({ map: tex as Texture, normal: nrm, texScale: (1 / 3.2) * (style?.scale ?? 1), cap, grade, lift, tune });
      disposables.push(mat);
      const layer = new RockLayer(`rocks_${id}`, items, stoneSets.filter((s) => items.some((r) => r.kind === s.kind)), mat, 1000);
      layers.push(layer);
      group.add(layer.mesh);
      info.push(`  ${id}: ${items.length} stone rocks${style ? ` (${g.kind} style)` : ''}`);
    }
    if (disposed) return;
    const crystalSet = sets.get('crystal');
    if (crystals.length > 0 && crystalSet) {
      const crystalMatId = mats[(crystals[0] as RockPlacement).mat % Math.max(1, mats.length)] ?? '';
      const style = crystalStyleFor(crystalMatId);
      // ROCK-01: the zone look's crystal knobs (look.rocks.kind.crystal over look.rocks.all) reach the material
      const mat = crystalMaterialFor(crystalMatId, rockLook);
      disposables.push(mat);
      const layer = new RockLayer('rocks_crystal', crystals, [crystalSet], mat, 400);
      layers.push(layer);
      group.add(layer.mesh);
      info.push(`  crystal(${style}): ${crystals.length}`);
    }
    if (quality) for (const l of layers) budget(l, quality);
  })();

  return {
    group,
    ready,
    stats: () => info.join('\n'),
    update(_dt, camera, focus) {
      for (const l of layers) l.update(camera, focus);
    },
    setQuality(q) {
      quality = q;
      for (const l of layers) budget(l, q);
    },
    dispose() {
      disposed = true;
      for (const l of layers) l.dispose();
      layers.length = 0;
      for (const d of disposables) d.dispose();
      disposables.length = 0;
      group.clear();
    },
  };
}
