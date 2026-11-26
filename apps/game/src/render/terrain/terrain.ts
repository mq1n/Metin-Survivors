// Terrain system: chunked heightfield (32 m chunks, quadtree-ish LOD: 1 m / 2 m near, one 4 m mesh per 128 m "mega" chunk
// far away, edge skirts hide cracks) drawn with the splat material, plus the baked static light.
// Zones core C6 (world edge): the skirts face outwards (they shade as rock, not as a vertically smeared ground texture),
// back faces of the terrain render as rock when the camera sits inside a rim wall (terrainMaterial.ts), and a far-field
// annulus (look.edge.farSkirt, default on) continues the rim beyond the domain as rock sinking into the fog.
import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  Group,
  LinearFilter,
  Mesh,
  NoColorSpace,
  RGBAFormat,
  UnsignedByteType,
  type PerspectiveCamera,
  type Vector3,
} from 'three';
import { fbm, ridged, smoothstep } from '../../world/noise';
import type { TreeSpecies } from '../../world/layoutTypes';
import type { PaintMaps, TerrainField } from '../../world/terrainField';
import type { TreeStyle } from '../vegetation/treeCommon';
import type { QualityProfile } from '../quality';
import { loadFoliageMasks } from '../vegetation/foliageMask';
import { treeStyleFor } from '../vegetation/trees';
import { acquireTreeVariants, releaseTreeVariants } from '../vegetation/treeVariants';
import { bakeLight, type TreeShadowBake } from './bakeLight';
import { bakedLightRef } from './bakedLightRef';
import { bakePools, POOL_RES } from './bakePools';
import { buildLayerArrays, normalsGate, type LayerArrays } from './layerTextures';
import { lookFor } from './look';
import { sharedNoise } from './macroNoise';
import { configureOcclusion, setOcclusionQuality } from './occlusion';
import { createTerrainMaterial, type TerrainMaterial } from './terrainMaterial';
import { tryTexture, type ZoneContext, type ZoneSystem } from './zoneContext';

const CHUNK = 32;
const MEGA = 4;
/** metres from the camera/focus up to which chunks use full resolution */
const LOD0_DIST = 62;
const MEGA_DIST = 118;

function dataTex(data: Uint8Array, res: number, linear = true): DataTexture {
  const t = new DataTexture(data, res, res, RGBAFormat, UnsignedByteType);
  t.colorSpace = NoColorSpace;
  t.minFilter = linear ? LinearFilter : LinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/** B1: light-map resolution for the crown-silhouette tree shadows by quality tier (the zone's `res` caps it; low keeps today's 1024) */
function bakeResFor(tier: QualityProfile['tier'], res: number | undefined): number {
  const want = res ?? 2048;
  return tier === 'low' ? 1024 : tier === 'medium' ? Math.min(1536, want) : want;
}

/** index buffers keyed by cell count (shared) */
const indexCache = new Map<number, BufferAttribute>();

function gridIndex(cells: number): BufferAttribute {
  const cached = indexCache.get(cells);
  if (cached) return cached;
  const n = cells + 1;
  const quads = cells * cells * 6;
  const skirt = cells * 4 * 6;
  const idx = new Uint16Array(quads + skirt);
  // skirt vertices (C6): per side a top row (at the edge, own normal) and a bottom row, each n entries:
  // [north top][north bottom][south top][south bottom][west top][west bottom][east top][east bottom]
  let k = 0;
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      // same diagonal (a–d) as TerrainField.heightAt
      idx[k++] = a;
      idx[k++] = d;
      idx[k++] = b;
      idx[k++] = a;
      idx[k++] = c;
      idx[k++] = d;
    }
  }
  const base = n * n;
  const top = (side: number, i: number): number => base + side * 2 * n + i;
  const bot = (side: number, i: number): number => base + side * 2 * n + n + i;
  const quad = (t0: number, t1: number, s0: number, s1: number): void => {
    // (t0,s0,t1) and (t1,s0,s1): outward facing for the traversal direction used by the callers
    idx[k++] = t0;
    idx[k++] = s0;
    idx[k++] = t1;
    idx[k++] = t1;
    idx[k++] = s0;
    idx[k++] = s1;
  };
  for (let i = 0; i < cells; i++) {
    // north edge (z = min): outward −z, traverse along −x
    quad(top(0, i + 1), top(0, i), bot(0, i + 1), bot(0, i));
    // south edge (z = max): outward +z, traverse along +x
    quad(top(1, i), top(1, i + 1), bot(1, i), bot(1, i + 1));
  }
  for (let j = 0; j < cells; j++) {
    // west edge (x = min): outward −x, traverse along +z
    quad(top(2, j), top(2, j + 1), bot(2, j), bot(2, j + 1));
    // east edge (x = max): outward +x, traverse along −z
    quad(top(3, j + 1), top(3, j), bot(3, j + 1), bot(3, j));
  }
  const attr = new BufferAttribute(idx, 1);
  indexCache.set(cells, attr);
  return attr;
}

function buildGeometry(field: TerrainField, x0: number, z0: number, cells: number, step: number): BufferGeometry {
  const n = cells + 1;
  const total = n * n + 8 * n;
  const pos = new Float32Array(total * 3);
  const nrm = new Float32Array(total * 3);
  const g = field.grid;
  const gn = g.n;
  const half = field.size / 2;
  const drop = step * 1.1 + 1.2;
  const iBase = Math.round((x0 + half) / g.cell);
  const jBase = Math.round((z0 + half) / g.cell);
  const stepCells = Math.round(step / g.cell);
  const hAt = (i: number, j: number): number => g.bed[Math.min(gn - 1, Math.max(0, j)) * gn + Math.min(gn - 1, Math.max(0, i))] as number;
  /**
   * `ox / oz` != 0: skirt vertex (C6). On gentle ground it keeps the edge normal (a crack between LODs fills with the
   * ground colour); where the edge is steep it turns towards the outward direction, so the vertical skirt shades as rock
   * with a matching triplanar projection instead of a vertically smeared ground texture.
   */
  const put = (v: number, i: number, j: number, yOff: number, ox = 0, oz = 0): void => {
    const gi = iBase + i * stepCells;
    const gj = jBase + j * stepCells;
    const h = hAt(gi, gj);
    pos[v * 3] = x0 + i * step;
    pos[v * 3 + 1] = h + yOff;
    pos[v * 3 + 2] = z0 + j * step;
    // central-difference normal over ±1 grid cell (full resolution regardless of LOD)
    const dx = (hAt(gi + 1, gj) - hAt(gi - 1, gj)) / (2 * g.cell);
    const dz = (hAt(gi, gj + 1) - hAt(gi, gj - 1)) / (2 * g.cell);
    const inv = 1 / Math.sqrt(dx * dx + 1 + dz * dz);
    let nx = -dx * inv;
    let ny = inv;
    let nz = -dz * inv;
    if (ox !== 0 || oz !== 0) {
      const s = smoothstep(0.4, 0.9, Math.sqrt(dx * dx + dz * dz));
      nx += (ox - nx) * s;
      ny += (0 - ny) * s;
      nz += (oz - nz) * s;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= l;
      ny /= l;
      nz /= l;
    }
    nrm[v * 3] = nx;
    nrm[v * 3 + 1] = ny;
    nrm[v * 3 + 2] = nz;
  };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) put(j * n + i, i, j, 0);
  const base = n * n;
  // skirts: per side a top row (at the edge) and a bottom row (dropped), see gridIndex
  const sides: Array<[number, number, number, number]> = [
    // [fixed i or -1, fixed j or -1, outward x, outward z]
    [-1, 0, 0, -1],
    [-1, cells, 0, 1],
    [0, -1, -1, 0],
    [cells, -1, 1, 0],
  ];
  sides.forEach(([fi, fj, ox, oz], side) => {
    for (let k = 0; k < n; k++) {
      const i = fi >= 0 ? fi : k;
      const j = fj >= 0 ? fj : k;
      put(base + side * 2 * n + k, i, j, 0, ox, oz);
      put(base + side * 2 * n + n + k, i, j, -drop, ox, oz);
    }
  });
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('normal', new BufferAttribute(nrm, 3));
  geo.setIndex(gridIndex(cells));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/** C6: rows of the far-field annulus, metres beyond the domain edge */
const FAR_ROWS = [0, 3, 8, 16, 28, 45, 70, 105, 150, 210, 280, 360];
/** C6: perimeter step (m) of the annulus' inner ring (a multiple of the far LOD step, so the seams meet) */
const FAR_STEP = 4;

/**
 * C6 far field: an annulus from the square domain edge out to ~360 m beyond it. The inner ring follows the bed heights at
 * the edge (tucked 0.4 m under it), then the ground stays rugged near the rim and sinks away into the fog. Render-only.
 */
export function buildFarSkirt(field: TerrainField, seed: number): BufferGeometry {
  const half = field.size / 2;
  const perSide = Math.round(field.size / FAR_STEP);
  const ring: Array<[number, number]> = [];
  for (let s = 0; s < 4; s++) {
    for (let k = 0; k < perSide; k++) {
      const t = -half + k * FAR_STEP;
      // north edge west→east, east edge north→south, south edge east→west, west edge south→north
      if (s === 0) ring.push([t, -half]);
      else if (s === 1) ring.push([half, t]);
      else if (s === 2) ring.push([-t, half]);
      else ring.push([-half, -t]);
    }
  }
  const M = ring.length;
  const K = FAR_ROWS.length;
  const pos = new Float32Array(M * K * 3);
  for (let m = 0; m < M; m++) {
    const [bx, bz] = ring[m] as [number, number];
    const l = Math.sqrt(bx * bx + bz * bz) || 1;
    const rx = bx / l;
    const rz = bz / l;
    const h0 = field.bedHeightAt(Math.max(-half, Math.min(half, bx)), Math.max(-half, Math.min(half, bz))) - 0.4;
    for (let k = 0; k < K; k++) {
      const d = FAR_ROWS[k] as number;
      const x = bx + rx * d;
      const z = bz + rz * d;
      const env = smoothstep(0, 30, d);
      const rugged = ridged(x / 70, z / 70, seed + 11, 3) * 34 + fbm(x / 23, z / 23, seed + 5, 3) * 7 - 12;
      const sink = 0.32 * Math.max(0, d - 35);
      const v = (m * K + k) * 3;
      pos[v] = x;
      pos[v + 1] = h0 + env * rugged - sink;
      pos[v + 2] = z;
    }
  }
  const idx = new Uint32Array(M * (K - 1) * 6);
  let q = 0;
  for (let m = 0; m < M; m++) {
    const m1 = (m + 1) % M;
    for (let k = 0; k < K - 1; k++) {
      const a = m * K + k;
      const b = m1 * K + k;
      const c = m * K + k + 1;
      const d = m1 * K + k + 1;
      idx[q++] = a;
      idx[q++] = b;
      idx[q++] = c;
      idx[q++] = b;
      idx[q++] = d;
      idx[q++] = c;
    }
  }
  // the ring runs clockwise seen from above; make sure the triangles face up whatever the walk direction
  const p = (i: number): [number, number, number] => [pos[i * 3] as number, pos[i * 3 + 1] as number, pos[i * 3 + 2] as number];
  const [a0, b0, c0] = [p(idx[0] as number), p(idx[1] as number), p(idx[2] as number)];
  const ny = (b0[2] - a0[2]) * (c0[0] - a0[0]) - (b0[0] - a0[0]) * (c0[2] - a0[2]);
  if (ny < 0) {
    for (let t = 0; t < idx.length; t += 3) {
      const s = idx[t + 1] as number;
      idx[t + 1] = idx[t + 2] as number;
      idx[t + 2] = s;
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setIndex(new BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

interface ChunkSet {
  cx: number;
  cz: number;
  x0: number;
  z0: number;
  /** lazily created meshes by lod 0/1 */
  meshes: [Mesh | null, Mesh | null];
}

interface Mega {
  mx: number;
  mz: number;
  x0: number;
  z0: number;
  far: Mesh | null;
  chunks: ChunkSet[];
}

export interface TerrainSystem extends ZoneSystem {
  /** baked static light (for debugging / other systems) */
  readonly lightRes: number;
}

export function createTerrain(ctx: ZoneContext): TerrainSystem {
  const field = ctx.field;
  const layout = field.layout;
  const look = lookFor(layout.zone);
  const group = new Group();
  group.name = 'terrain';
  const half = field.size / 2;
  const megaCount = Math.round(field.size / (CHUNK * MEGA));
  const perMega = MEGA;

  let tm: TerrainMaterial | null = null;
  let arrays: LayerArrays | null = null;
  let splatTex: [DataTexture, DataTexture] | null = null;
  let lightTex: DataTexture | null = null;
  let lightResBaked = 1024;
  const heldVariants: TreeSpecies[] = [];
  let heldStyle: TreeStyle = { snowy: false };
  let poolTex: DataTexture | null = null;
  const megas: Mega[] = [];
  const geometries: BufferGeometry[] = [];
  let disposed = false;

  const layerSize = (p: QualityProfile): number => (p.tier === 'low' ? 512 : 1024);
  let builtFor: { size: number; normals: boolean } | null = null;
  let farGeo: BufferGeometry | null = null;
  let qualGen = 0;

  // C5: the zone's occlusion cut-out knobs and the tier's path (alpha-to-coverage on multisampled tiers)
  configureOcclusion(look.occlusion);
  setOcclusionQuality(ctx.quality);

  const ready = (async (): Promise<void> => {
    const p = ctx.quality;
    const size = layerSize(p);
    const normals = p.tier !== 'low';
    // the normal maps (1.9 MB of the zone's payload) are fetched after the first seconds of the run and fade in
    // (started first: the fine paint bake below overlaps the texture download)
    const arraysP = buildLayerArrays(ctx.assets, layout.groundLayers, size, normals, normalsGate(ctx.core.clock));
    void arraysP.then(
      (l) => {
        if (disposed) {
          l.albedo.dispose();
          l.normal?.dispose();
          return;
        }
        arrays = l;
      },
      () => undefined,
    );
    // B1: the foliage card alphas (crown-silhouette tree shadows) load while the paint bakes
    const tcfg = look.shadow.trees;
    const useTrees = tcfg !== undefined && layout.trees.length > 0;
    const masksP = useTrees ? loadFoliageMasks(ctx.assets, layout, look.trees) : null;
    void masksP?.catch(() => undefined);
    // zones core A1: the zone's splat density (recipe knob `paintRes`, default 512 = 1 m texels as before; the low and medium tiers keep
    // the 512 px map). The fine map is baked in slices so a load never has one long main-thread block.
    const paint: PaintMaps = p.tier === 'high' || p.tier === 'ultra' ? await field.paintFineAsync() : field.paint();
    if (disposed) return;
    splatTex = [dataTex(paint.w0, paint.res), dataTex(paint.w1, paint.res)];
    // B1: crown-silhouette tree shadows (look.shadow.trees): the light map is baked finer (the terrain horizon keeps its 1 m
    // grid) and the leaf-card alphas come from the shipped foliage textures
    const lightRes = useTrees ? bakeResFor(p.tier, tcfg.res) : 1024;
    const treeBake: TreeShadowBake | undefined = useTrees ? { ...tcfg, style: treeStyleFor(layout), masks: (await masksP) ?? undefined } : undefined;
    if (disposed) return;
    if (treeBake) {
      // hold the species' variant geometry for the zone's life: the tree system draws the same set, so it is generated once
      for (const sp of new Set(layout.trees.map((t) => t.species))) {
        acquireTreeVariants(sp, treeBake.style);
        heldVariants.push(sp);
      }
      heldStyle = treeBake.style;
    }
    // C2 soft baked shadows, C1 cliff-foot proximity (both off unless the look asks)
    const baked = bakeLight(field, ctx.core.env.sunDir, lightRes, { soft: look.shadow.soft, footWidth: look.style.cliff?.foot?.width, trees: treeBake, rocks: look.shadow.rocks });
    lightResBaked = baked.res;
    lightTex = dataTex(baked.data, baked.res);
    bakedLightRef(field).tex = lightTex; // the liquid shore shading (B2) reads the same texels
    poolTex = dataTex(bakePools(field, look.pools), POOL_RES);
    const built = await arraysP;
    if (disposed) return;
    arrays = built;
    builtFor = { size, normals };
    const sealLm = look.seal ? field.landmark(look.seal.landmark ?? 'centre') : undefined;
    // A4: the plaza medallion (one non-tiling picture); a missing file or landmark leaves the ground as it was
    const med = look.medallion;
    const medLm = med && !med.at ? field.landmark(med.landmark ?? 'centre') : undefined;
    const medAt = med ? (med.at ? { x: med.at[0], z: med.at[1] } : medLm ? { x: medLm.x, z: medLm.z } : null) : null;
    const medTex = med && medAt ? await tryTexture(ctx.assets, med.tex) : null;
    if (disposed) return;
    tm = createTerrainMaterial({
      layers: arrays,
      splat0: splatTex[0],
      splat1: splatTex[1],
      noise: sharedNoise(),
      light: lightTex,
      pools: poolTex,
      layout,
      look,
      sealAt: sealLm ? { x: sealLm.x, z: sealLm.z } : null,
      size: field.size,
      medallion: medTex,
      medallionAt: medAt,
    });
    tm.setQuality(p);
    // C6: far-field annulus beyond the domain edge (look.edge.farSkirt, default on)
    if (look.edge?.farSkirt !== false) {
      farGeo = buildFarSkirt(field, field.seed);
      const farMesh = new Mesh(farGeo, tm.farMaterial());
      farMesh.name = 'terrain:far';
      farMesh.frustumCulled = false;
      farMesh.matrixAutoUpdate = false;
      farMesh.receiveShadow = false;
      group.add(farMesh);
    }
    for (let mz = 0; mz < megaCount; mz++) {
      for (let mx = 0; mx < megaCount; mx++) {
        const x0 = -half + mx * CHUNK * MEGA;
        const z0 = -half + mz * CHUNK * MEGA;
        const chunks: ChunkSet[] = [];
        for (let cz = 0; cz < perMega; cz++) {
          for (let cx = 0; cx < perMega; cx++) {
            chunks.push({ cx, cz, x0: x0 + cx * CHUNK, z0: z0 + cz * CHUNK, meshes: [null, null] });
          }
        }
        megas.push({ mx, mz, x0, z0, far: null, chunks });
      }
    }
  })();

  const makeMesh = (x0: number, z0: number, cells: number, step: number): Mesh => {
    const geo = buildGeometry(field, x0, z0, cells, step);
    geometries.push(geo);
    const mesh = new Mesh(geo, (tm as TerrainMaterial).material);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    group.add(mesh);
    return mesh;
  };

  const dist2D = (x0: number, z0: number, size: number, px: number, pz: number): number => {
    const dx = Math.max(x0 - px, 0, px - (x0 + size));
    const dz = Math.max(z0 - pz, 0, pz - (z0 + size));
    return Math.sqrt(dx * dx + dz * dz);
  };

  return {
    name: 'terrain',
    group,
    ready,
    get lightRes(): number {
      return lightResBaked;
    },
    update(_dt: number, camera: PerspectiveCamera, focus: Vector3) {
      if (!tm) return;
      const cx = camera.position.x;
      const cz = camera.position.z;
      const fx = focus.x;
      const fz = focus.z;
      const dist = (x0: number, z0: number, size: number): number => Math.min(dist2D(x0, z0, size, cx, cz), dist2D(x0, z0, size, fx, fz));
      for (const m of megas) {
        const md = dist(m.x0, m.z0, CHUNK * MEGA);
        const useFar = md > MEGA_DIST;
        if (useFar) {
          m.far ??= makeMesh(m.x0, m.z0, CHUNK, MEGA);
          m.far.visible = true;
        } else if (m.far) {
          m.far.visible = false;
        }
        for (const c of m.chunks) {
          if (useFar) {
            if (c.meshes[0]) c.meshes[0].visible = false;
            if (c.meshes[1]) c.meshes[1].visible = false;
            continue;
          }
          const d = dist(c.x0, c.z0, CHUNK);
          const lod = d < LOD0_DIST ? 0 : 1;
          c.meshes[lod] ??= makeMesh(c.x0, c.z0, lod === 0 ? CHUNK : CHUNK / 2, lod === 0 ? 1 : 2);
          (c.meshes[lod] as Mesh).visible = true;
          const other = c.meshes[1 - lod];
          if (other) other.visible = false;
        }
      }
    },
    setQuality(p: QualityProfile) {
      setOcclusionQuality(p);
      tm?.setQuality(p);
      const want = { size: layerSize(p), normals: p.tier !== 'low' };
      const have = builtFor;
      if (!tm || !have || (have.size === want.size && have.normals === want.normals)) return;
      builtFor = want;
      const gen = ++qualGen;
      void buildLayerArrays(ctx.assets, layout.groundLayers, want.size, want.normals).then(
        (l) => {
          if (disposed || !tm || gen !== qualGen) {
            l.albedo.dispose();
            l.normal?.dispose();
            return;
          }
          arrays?.albedo.dispose();
          arrays?.normal?.dispose();
          arrays = l;
          tm.setLayers(l);
          tm.setQuality(p);
        },
        () => undefined,
      );
    },
    dispose() {
      disposed = true;
      qualGen++;
      for (const g of geometries) g.dispose();
      farGeo?.dispose();
      tm?.dispose();
      arrays?.albedo.dispose();
      arrays?.normal?.dispose();
      arrays = null;
      splatTex?.[0].dispose();
      splatTex?.[1].dispose();
      for (const sp of heldVariants) releaseTreeVariants(sp, heldStyle);
      heldVariants.length = 0;
      const lref = bakedLightRef(field);
      if (lref.tex === lightTex) lref.tex = null;
      lightTex?.dispose();
      poolTex?.dispose();
      group.clear();
    },
  };
}
