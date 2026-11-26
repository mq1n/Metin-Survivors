// Structures system: instances every prop placement of the zone layout (a Forge GLB `prop_<id>` when the manifest has
// one, else the procedural builder from setA / setB) and adds the layout's walls and bridges (walls.ts / bridges.ts).
// One InstancedMesh per (prop id, part) with ≥ 2 placements, a plain Mesh otherwise. Each frame only the placements that
// intersect the camera frustum (and sit within the near range, landmarks excepted) are written into the instance buffers,
// so far / off-screen props cost neither draw calls nor vertices.
import {
  BufferGeometry,
  DynamicDrawUsage,
  Euler,
  Frustum,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Material,
  Matrix4,
  MeshDepthMaterial,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Sphere,
  Vector3,
  Vector4,
  type PerspectiveCamera,
  type Texture,
} from 'three';
import type { LoadedModel } from '../../../engine/assets';
import type { PropPlacement } from '../../../world/layoutTypes';
import { PROP_DEFS } from '../../../world/props';
import type { QualityProfile } from '../../quality';
import { applyAtmosphere } from '../atmosphere';
import { lazyContent } from '../../payloadPolicy';
import { applyObjectOcclusion, applyObjectOcclusionDepth, applyOcclusionFade, OBJECT_OCCLUSION_ATTR, occlusionRadius } from '../occlusion';
import { applyPropLook, propLookFor } from './propLook';
import { buildOccGrid, OCC_GATE_IDS, occModeOf, occOverhangLow, occTargetFor, stepFade, type OccGrid, type OccMode, type OccTarget, type OccView } from './propOcclusion';
import { afterPlaying } from '../layerTextures';
import { tryTexture, worldUniforms, type ZoneContext, type ZoneSystem } from '../zoneContext';
import { stoneLook } from './b_common';
import { isFlameSocketName, socketFlames } from './b_fire';
import { buildBridges, type BridgesResult } from './bridges';
import { setArchQuality } from './materials';
import { STRUCTURES_A } from './setA';
import { STRUCTURES_B } from './setB';
import type { StructureBuildContext, StructureDef, StructureModel, StructurePart } from './types';
import { buildWalls, type WallsResult } from './walls';

export interface StructuresOptions {
  /** replaces `layout.props` (gallery review sheets, stress tests) */
  placements?: readonly PropPlacement[];
  /** build the layout's walls and bridges (default true) */
  decor?: boolean;
  /** stream props out of reach of the first seconds in behind the HUD in a production build (default true, see FAR_PROP_M) */
  streamFar?: boolean;
}

/** props that stay drawable at any distance (fog hides them): skyline silhouettes */
const LANDMARK_IDS: Record<string, true> = { giant_pagoda: true, pagoda_gate: true, hall_tiled: true };
/** a caster's shadow reaches this far at most (sun is ~40° up): its culling sphere is inflated by up to this much */
const SHADOW_REACH_MAX = 14;
const SHADOW_RANGE = 38;
const NEAR_RANGE: Record<QualityProfile['tier'], number> = { low: 80, medium: 100, high: 115, ultra: 130 };

const DEFS: Record<string, StructureDef> = { ...STRUCTURES_A, ...STRUCTURES_B };

interface PartRuntime {
  mesh: Mesh | InstancedMesh;
  geometry: BufferGeometry;
  material: Material;
  castShadow: boolean;
}

/** r9 Z9: per-placement occlusion of a structure GLB (propOcclusion.ts decides, occlusion.ts applyObjectOcclusion draws) */
interface EntryOcc {
  mode: OccMode;
  grid: OccGrid;
  /** plain Mesh path (one placement): the materials' uniform */
  state: { value: Vector4 };
  /** InstancedMesh path: one vec4 per instance slot (the selected placements, in select order) */
  attr: InstancedBufferAttribute | null;
  /** current values per placement */
  whole: Float32Array;
  cap: Float32Array;
  capY: Float32Array;
  /** r9 ship: the camera stood inside the placement's footprint last frame (the inside test's hysteresis) */
  inside: Uint8Array;
  /** a value moved this frame (the instance slots need a rewrite) */
  dirty: boolean;
  /** any placement had a non-zero state last frame */
  live: boolean;
}

/** placements whose bounding sphere is this much farther than the camera can reach are not tested (camera up to ~24 m behind the hero) */
const OCC_TEST_REACH = 40;
/** the camera's elevation over the focus (rad) below which only the camera-inside fade runs (the gameplay rig is at 55 degrees) */
const OCC_MIN_ELEVATION = (40 * Math.PI) / 180;

interface Entry {
  id: string;
  placements: PropPlacement[];
  /** world matrices, 16 floats per placement */
  matrices: Float32Array;
  /** culling spheres (cx, cy, cz, r) per placement */
  spheres: Float32Array;
  landmark: boolean;
  /** how far this prop's shadow can fall into view (0 = not a shadow caster) */
  shadowLen: number;
  parts: PartRuntime[];
  update?: (time: number) => void;
  /** currently selected placement indices */
  selected: Int32Array;
  selectedCount: number;
  /** r9 Z9 per-placement occlusion (GLB props only; the procedural fallback keeps the view-ray cut of its own materials) */
  occ: EntryOcc | null;
}

/** prop GLB downloads in flight at once (a page talks HTTP/2 to Pages: more would only queue behind the first six on HTTP/1.1) */
export const PROP_PREFETCH = 6;

/**
 * Far props (payload policy, ARCHITECTURE §11): a prop id whose nearest placement is at least this far (m) from the hero's
 * start is not built with the zone. The gameplay camera sees ~35 m past the hero on the ground and nothing above the
 * horizon, and a hero walks 5.4-6.2 m/s, so a placement 100 m out is out of view for the first ~15 s of a run. Its GLB
 * (atlas and all) streams in from FAR_PROP_AFTER_S of run rendering instead. `Infinity` turns the streaming off (revert).
 * Only in a production build (`lazyContent()`): the dev server builds every prop with the zone, like every other stream.
 */
export const FAR_PROP_M = 100;
/** run-render seconds before the far props are fetched (after the ground normals at 9 s, behind the 6 s of the payload window) */
export const FAR_PROP_AFTER_S = 10;

/**
 * Splits prop ids into the ones built with the zone (`near`) and the ones that stream in later (`far`, nearest first: what
 * a fast hero reaches first arrives first). A prop with any placement closer than `farM` to `from` is near.
 */
export function splitFarProps(
  placements: ReadonlyMap<string, readonly Pick<PropPlacement, 'x' | 'z'>[]>,
  from: { x: number; z: number },
  farM: number,
): { near: string[]; far: string[] } {
  const near: string[] = [];
  const far: { id: string; d: number }[] = [];
  for (const [id, list] of placements) {
    let d = Infinity;
    for (const p of list) d = Math.min(d, Math.hypot(p.x - from.x, p.z - from.z));
    if (d >= farM) far.push({ id, d });
    else near.push(id);
  }
  far.sort((a, b) => a.d - b.d);
  return { near, far: far.map((f) => f.id) };
}

/**
 * Starts `load` for every id, at most `limit` at a time and in list order, and returns the pending loads by id. The caller
 * keeps consuming them one by one in its own order, so the result is the same as awaiting each load in turn, minus one
 * network round trip per prop. A load that rejects stays rejected in the map (the caller's own try/catch decides what a
 * failed prop means); it never throws here.
 */
export function prefetch<T>(ids: readonly string[], limit: number, load: (id: string) => Promise<T>): Map<string, Promise<T>> {
  const loads = new Map<string, Promise<T>>();
  let next = 0;
  const lane = async (): Promise<void> => {
    for (;;) {
      const id = ids[next++];
      if (id === undefined) return;
      const p = load(id);
      loads.set(id, p);
      await p.catch(() => undefined);
    }
  };
  for (let i = 0; i < Math.min(Math.max(1, limit), ids.length); i++) void lane();
  return loads;
}

/** texture ids one procedural builder samples (its declarations + the zone's palette stone) */
function builderTextures(id: string, zone: string): string[] {
  const def = DEFS[id];
  return [...(def?.textures ?? []), ...(def?.zoneTextures?.(zone) ?? [])];
}

/**
 * Texture ids the zone actually samples (every id costs a download, see ARCHITECTURE §11 payload policy):
 *  - walls and bridges bind wood (fences, planks) + bark (palisade posts) and the zone's own stone detail
 *    (`stoneLook(zone).tex`, never the other zones' stones: frozen / basalt are not fetched for Yeonmu);
 *  - a prop with a Forge GLB is drawn from the GLB's embedded textures, so its procedural builder's declarations are
 *    only fetched on the fallback path (GLB failed to load, see `init`).
 * Normal maps are never requested: no structure material samples one.
 */
export function neededTextures(ids: Iterable<string>, zone: string, withDecor: boolean, hasGlb: (id: string) => boolean): string[] {
  const out = new Set<string>();
  for (const id of ids) if (!hasGlb(id)) for (const tex of builderTextures(id, zone)) out.add(tex);
  if (withDecor) for (const t of ['tex_bark_oak', 'tex_wood_plank', stoneLook(zone).tex]) out.add(t);
  return [...out];
}

export function createStructures(ctx: ZoneContext, opts: StructuresOptions = {}): ZoneSystem {
  const group = new Group();
  group.name = 'structures';
  const decor = opts.decor !== false;
  const placements = opts.placements ?? ctx.field.layout.props;
  let quality = ctx.quality;

  const byId = new Map<string, PropPlacement[]>();
  for (const p of placements) {
    if (!PROP_DEFS[p.id]) {
      console.warn(`[structures] unknown prop id "${p.id}"`);
      continue;
    }
    const list = byId.get(p.id);
    if (list) list.push(p);
    else byId.set(p.id, [p]);
  }

  const entries: Entry[] = [];
  const decorUpdates: Array<(t: number) => void> = [];
  let walls: WallsResult | null = null;
  let bridges: BridgesResult | null = null;
  let disposed = false;

  const frustum = new Frustum();
  const projView = new Matrix4();
  const sphere = new Sphere();
  const tmpPos = new Vector3();
  const tmpQuat = new Quaternion();
  const tmpScale = new Vector3();
  const yAxis = new Vector3(0, 1, 0);
  const tmpEuler = new Euler();
  const m4 = new Matrix4();
  /** r9 Z9: the occlusion state uniform of each GLB prop id (glbParts) */
  const occStates = new Map<string, { value: Vector4 }>();
  // the hero estimate: the camera focus leads a moving hero by ~0.23 s of its speed (render/camera.ts LOOKAHEAD 0.35 - FOLLOW_SMOOTH 0.12)
  const prevFocus = new Vector3();
  let haveFocus = false;
  const focusVel = new Vector3();
  const camPos = new Vector3();
  const occHeroes = [
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
  ];
  // a standing hero is one point (the focus); a moving one adds the estimate behind the focus
  const occStill = [occHeroes[0]!];
  const occView: OccView = { camX: 0, camY: 0, camZ: 0, heroes: occHeroes };
  const occOut: OccTarget = { whole: 0, cap: 0, capY: 0, inside: false };

  /** meshes of a Forge GLB baked into prop space, one part per mesh */
  async function glbParts(id: string, pending?: Promise<LoadedModel>): Promise<StructureModel | null> {
    try {
      const model = await (pending ?? ctx.assets.loadModel(`prop_${id}`, 'prop'));
      if (disposed) return null;
      model.scene.updateMatrixWorld(true);
      const parts: StructurePart[] = [];
      // r9 Z9: the per-placement occlusion state (whole fade / capped cut) every material of this prop reads (propOcclusion.ts)
      const occState = { value: new Vector4() };
      const mode = occModeOf(id);
      for (const mesh of model.meshes) {
        const src = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        if (!src) continue;
        // the loaded GLB material is a shared asset: clone it so haze, cloud shadows and the hero-occlusion fade can be patched in
        const material = src.clone();
        if (material instanceof MeshStandardMaterial) {
          const prior = material.onBeforeCompile;
          // r9 Z9: the old view-ray cut stays on a landmark only (the rare eave in front of the hero; never on a banner: occlude false).
          // Every other prop ghosts whole or loses everything above the cap height instead (r8 judge MF2: no drum, sliver, shard or stub).
          const viewRayCut = mode === 'landmark' && PROP_DEFS[id]?.occlude !== false;
          // r8 Z8: the ice crystal's fresnel / glint and the lava rock's varied crack heat (propLook.ts)
          const look = propLookFor(id, material.roughness);
          material.onBeforeCompile = (shader, renderer) => {
            prior.call(material, shader, renderer);
            if (look) applyPropLook(shader, look);
            if (viewRayCut) applyOcclusionFade(shader);
            applyObjectOcclusion(shader, occState);
            applyAtmosphere(shader);
          };
          const key = viewRayCut ? 'glbProp-v2-ray' : 'glbProp-v2';
          material.customProgramCacheKey = () => (look ? `${key}-${look}` : key);
          occStates.set(id, occState);
        }
        const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
        // r9 ship (Z9 critic): the shadow pass reads the whole fade too, so a faded prop (the pagoda with the camera inside it, a ghosted lamp
        // post) throws no shadow; three copies side / map / alphaTest of the part's material onto it per draw (alpha-tested cards keep their cut)
        let depthMaterial: MeshDepthMaterial | undefined;
        if (material instanceof MeshStandardMaterial) {
          depthMaterial = new MeshDepthMaterial();
          depthMaterial.onBeforeCompile = (shader) => applyObjectOcclusionDepth(shader, occState);
          depthMaterial.customProgramCacheKey = () => 'glbPropDepth-v1';
        }
        parts.push({ geometry, material, castShadow: true, ...(depthMaterial ? { depthMaterial } : {}) });
      }
      // E2: empty nodes named `flame*` mark where a fire prop burns; the engine flame attaches there (no node = nothing changes)
      const sockets: Vector3[] = [];
      model.scene.traverse((o) => {
        if (isFlameSocketName(o.name) && !(o as { isMesh?: boolean }).isMesh) sockets.push(new Vector3().setFromMatrixPosition(o.matrixWorld));
      });
      const flame = socketFlames(id, sockets);
      if (flame && parts.length) {
        parts.push(flame.part);
        return { parts, update: flame.update };
      }
      return parts.length ? { parts } : null;
    } catch (err) {
      console.warn(`[structures] GLB prop_${id} failed, using procedural`, err);
      return null;
    }
  }

  // what init() sets up for every prop it builds (also for the far props that stream in after the zone is ready)
  const tex = new Map<string, Texture | null>();
  let buildCtx: StructureBuildContext | null = null;
  const loadTextures = async (texIds: Iterable<string>): Promise<void> => {
    const need = [...new Set(texIds)].filter((t) => !tex.has(t));
    const loaded = await Promise.all(need.map(async (t) => [t, await tryTexture(ctx.assets, t)] as const));
    for (const [t, a] of loaded) tex.set(t, a);
  };

  /** builds one prop id (its Forge GLB, else the procedural builder) and adds it to `entries`; false once the system is disposed */
  async function addProp(id: string, pending?: Promise<LoadedModel>): Promise<boolean> {
    const list = byId.get(id) as PropPlacement[];
    let model: StructureModel | null = null;
    if (ctx.assets.hasModel(`prop_${id}`)) model = await glbParts(id, pending);
    // r9 Z9: only the GLB materials read the per-object occlusion state (the procedural fallback keeps its own view-ray cut)
    const occState = model ? occStates.get(id) : undefined;
    if (!model) {
      const def = DEFS[id];
      if (!def) {
        console.warn(`[structures] no builder or GLB for prop "${id}"`);
        return !disposed;
      }
      try {
        // procedural fallback: fetch the builder's own textures now (skipped up front when the prop has a GLB)
        await loadTextures(builderTextures(id, ctx.biome.id));
        if (disposed) return false;
        model = def.build(buildCtx as StructureBuildContext);
      } catch (err) {
        console.error(`[structures] builder for "${id}" failed`, err);
        return !disposed;
      }
    }
    if (disposed) {
      for (const p of model.parts) {
        p.geometry.dispose();
        p.material.dispose();
        p.depthMaterial?.dispose();
      }
      return false;
    }
    entries.push(makeEntry(id, list, model, occState));
    return true;
  }

  async function init(): Promise<void> {
    const ids = [...byId.keys()];
    const layout = ctx.field.layout;
    // production: props that no placement of is within reach of the first seconds stream in later (FAR_PROP_M)
    const spawn = layout.landmarks.find((l) => l.kind === 'spawn') ?? { x: 0, z: 0 };
    const { near, far } = lazyContent() && opts.streamFar !== false ? splitFarProps(byId, spawn, FAR_PROP_M) : { near: ids, far: [] as string[] };
    // walls / bridges only need their textures when the zone layout has some
    const withDecor = decor && (layout.walls.length > 0 || layout.bridges.length > 0);
    // the prop GLBs download in parallel (bounded) alongside the textures; the loop below still builds them in layout order
    const glbLoads = prefetch(
      near.filter((id) => ctx.assets.hasModel(`prop_${id}`)),
      PROP_PREFETCH,
      (id) => ctx.assets.loadModel(`prop_${id}`, 'prop'),
    );
    await loadTextures(neededTextures(near, ctx.biome.id, withDecor, (id) => ctx.assets.hasModel(`prop_${id}`)));
    if (disposed) return;
    buildCtx = {
      texture: (id) => tex.get(id) ?? null,
      // no structure material samples a normal map: none is downloaded (payload policy)
      normal: () => null,
      quality,
      zone: ctx.biome.id,
    };

    for (const id of near) if (!(await addProp(id, glbLoads.get(id)))) return;

    if (decor) {
      walls = buildWalls(layout.walls, ctx.field, buildCtx);
      bridges = buildBridges(layout.bridges, ctx.field, buildCtx);
      group.add(walls.group, bridges.group);
      if (walls.update) decorUpdates.push(walls.update.bind(walls));
      if (bridges.update) decorUpdates.push(bridges.update.bind(bridges));
    }
    applyQuality();
    // not awaited: `ready` (the loading screen) is the near props and the decor; the far props follow behind the HUD
    if (far.length > 0) void streamFar(far).catch((err: unknown) => console.warn('[structures] streaming the far props failed', err));
  }

  /** the far props, after FAR_PROP_AFTER_S of run rendering: downloaded like the near ones (bounded, nearest first), built one per turn */
  async function streamFar(far: readonly string[]): Promise<void> {
    await afterPlaying(ctx.core.clock, FAR_PROP_AFTER_S);
    if (disposed) return;
    const loads = prefetch(
      far.filter((id) => ctx.assets.hasModel(`prop_${id}`)),
      PROP_PREFETCH,
      (id) => ctx.assets.loadModel(`prop_${id}`, 'prop'),
    );
    for (const id of far) {
      if (!(await addProp(id, loads.get(id)))) return;
      applyQuality();
    }
  }

  function makeEntry(id: string, list: PropPlacement[], model: StructureModel, occState?: { value: Vector4 }): Entry {
    const def = PROP_DEFS[id];
    const n = list.length;
    // r9 Z9: the height grid of the GLB's solid parts (the flame cards are a ShaderMaterial part and stay out of it)
    let occ: EntryOcc | null = null;
    if (occState) {
      const solids = model.parts.filter((p) => p.material instanceof MeshStandardMaterial);
      const grid = buildOccGrid(
        solids.map((p) => ({ position: p.geometry.getAttribute('position').array, index: p.geometry.getIndex()?.array ?? null })),
      );
      if (grid) {
        let attr: InstancedBufferAttribute | null = null;
        if (n >= 2) {
          attr = new InstancedBufferAttribute(new Float32Array(n * 4), 4);
          attr.setUsage(DynamicDrawUsage);
          for (const p of solids) p.geometry.setAttribute(OBJECT_OCCLUSION_ATTR, attr);
        }
        // r9 ship (Z9 critic MF2c): a gate caps under its lowest roof / lintel underside, so no drooping eave corner stays as a shard
        if (OCC_GATE_IDS.has(id)) {
          const low = occOverhangLow(grid);
          if (Number.isFinite(low)) grid.capCeil = low - 0.08;
        }
        occ = {
          mode: occModeOf(id),
          grid,
          state: occState,
          attr,
          whole: new Float32Array(n),
          cap: new Float32Array(n),
          capY: new Float32Array(n),
          inside: new Uint8Array(n),
          dirty: true,
          live: false,
        };
      }
    }
    const matrices = new Float32Array(n * 16);
    const spheres = new Float32Array(n * 4);
    // local bounding sphere over all parts
    const local = new Sphere();
    let have = false;
    for (const part of model.parts) {
      part.geometry.computeBoundingSphere();
      const s = part.geometry.boundingSphere;
      if (!s) continue;
      if (have) local.union(s);
      else {
        local.copy(s);
        have = true;
      }
    }
    if (!have) local.set(new Vector3(0, (def?.height ?? 2) / 2, 0), Math.hypot(def?.radius ?? 2, (def?.height ?? 2) / 2));
    for (let i = 0; i < n; i++) {
      const p = list[i] as PropPlacement;
      tmpPos.set(p.x, p.y, p.z);
      // r9 Z9: an optional lean (about the prop's own X / Z after the yaw, like a tree) and height factor (layoutTypes PropPlacement)
      if (p.tiltX || p.tiltZ) tmpQuat.setFromEuler(tmpEuler.set(p.tiltX ?? 0, p.yaw, p.tiltZ ?? 0, 'YXZ'));
      else tmpQuat.setFromAxisAngle(yAxis, p.yaw);
      tmpScale.set(p.scale, p.scale * (p.squash ?? 1), p.scale);
      m4.compose(tmpPos, tmpQuat, tmpScale);
      m4.toArray(matrices, i * 16);
      tmpPos.copy(local.center).applyMatrix4(m4);
      spheres[i * 4] = tmpPos.x;
      spheres[i * 4 + 1] = tmpPos.y;
      spheres[i * 4 + 2] = tmpPos.z;
      spheres[i * 4 + 3] = local.radius * p.scale * Math.max(1, p.squash ?? 1);
    }
    const parts: PartRuntime[] = [];
    for (const part of model.parts) {
      let mesh: Mesh | InstancedMesh;
      if (n >= 2) {
        const im = new InstancedMesh(part.geometry, part.material, n);
        im.instanceMatrix.setUsage(DynamicDrawUsage);
        im.count = 0;
        mesh = im;
      } else {
        mesh = new Mesh(part.geometry, part.material);
        mesh.matrixAutoUpdate = false;
        mesh.matrix.fromArray(matrices);
        mesh.matrixWorldNeedsUpdate = true;
      }
      mesh.name = `prop_${id}`;
      if (part.depthMaterial) mesh.customDepthMaterial = part.depthMaterial;
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      mesh.visible = false;
      group.add(mesh);
      parts.push({
        mesh,
        geometry: part.geometry,
        material: part.material,
        castShadow: part.castShadow ?? (def?.height ?? 2) >= 1.2,
      });
    }
    return {
      id,
      placements: list,
      matrices,
      spheres,
      landmark: id in LANDMARK_IDS,
      shadowLen: parts.some((p) => p.castShadow) ? Math.min(SHADOW_REACH_MAX, (def?.height ?? 2) * 1.2) : 0,
      parts,
      update: model.update,
      selected: new Int32Array(n).fill(-1),
      selectedCount: -1,
      occ,
    };
  }

  /**
   * r9 Z9: steps every placement's occlusion state toward this frame's target (propOcclusion.ts occTargetFor). Placements out of the
   * camera's reach fade back to drawn without a test. `enabled` false (terrain gallery `?fade=0`) fades everything back.
   */
  function updateOcclusion(e: Entry, dt: number, enabled: boolean): void {
    const o = e.occ;
    if (!o) return;
    const n = e.placements.length;
    let live = false;
    for (let i = 0; i < n; i++) {
      let tWhole = 0;
      let tCap = 0;
      let tCapY = o.capY[i] as number;
      if (enabled) {
        const cx = e.spheres[i * 4] as number;
        const cz = e.spheres[i * 4 + 2] as number;
        const r = e.spheres[i * 4 + 3] as number;
        const near = Math.hypot(cx - occHeroes[0]!.x, cz - occHeroes[0]!.z) - r < OCC_TEST_REACH;
        if (near) {
          occTargetFor(o.grid, o.mode, e.placements[i] as PropPlacement, occView, occOut, o.inside[i] === 1);
          tWhole = occOut.whole;
          tCap = occOut.cap;
          if (occOut.cap > 0) tCapY = occOut.capY;
        }
        o.inside[i] = near && occOut.inside ? 1 : 0;
      } else o.inside[i] = 0;
      const w0 = o.whole[i] as number;
      const c0 = o.cap[i] as number;
      const y0 = o.capY[i] as number;
      const w1 = stepFade(w0, tWhole, dt);
      const c1 = stepFade(c0, tCap, dt);
      // the cap height snaps when a cut starts, follows the hero while it runs (0.12 s) and stays put while it fades out
      const y1 = tCap > 0 ? (c0 <= 0 ? tCapY : y0 + (tCapY - y0) * Math.min(1, dt / 0.12)) : y0;
      if (w1 !== w0 || c1 !== c0 || y1 !== y0) {
        o.whole[i] = w1;
        o.cap[i] = c1;
        o.capY[i] = y1;
        o.dirty = true;
      }
      if (w1 > 0 || c1 > 0) live = true;
    }
    o.live = live;
  }

  /** r9 Z9: writes the occlusion state of the selected placements into the instance slots (or the single mesh's uniform) */
  function writeOcclusion(e: Entry, selectionChanged: boolean): void {
    const o = e.occ;
    if (!o || (!o.dirty && !selectionChanged)) return;
    o.dirty = false;
    if (o.attr) {
      const arr = o.attr.array as Float32Array;
      for (let k = 0; k < e.selectedCount; k++) {
        const i = e.selected[k] as number;
        arr[k * 4] = o.whole[i] as number;
        arr[k * 4 + 1] = o.cap[i] as number;
        arr[k * 4 + 2] = o.capY[i] as number;
        arr[k * 4 + 3] = 0;
      }
      o.attr.needsUpdate = true;
    } else {
      o.state.value.set(o.whole[0] as number, o.cap[0] as number, o.capY[0] as number, 0);
    }
  }

  function applyQuality(): void {
    for (const e of entries) for (const p of e.parts) setArchQuality(p.material, quality);
  }

  function select(e: Entry, focus: Vector3, near: number): void {
    const n = e.placements.length;
    let count = 0;
    let changed = false;
    let shadow = false;
    for (let i = 0; i < n; i++) {
      const cx = e.spheres[i * 4] as number;
      const cy = e.spheres[i * 4 + 1] as number;
      const cz = e.spheres[i * 4 + 2] as number;
      const r = e.spheres[i * 4 + 3] as number;
      const dx = cx - focus.x;
      const dz = cz - focus.z;
      const d = Math.hypot(dx, dz);
      let show = false;
      if (e.landmark || d - r < near) {
        sphere.center.set(cx, cy, cz);
        // a caster just outside the view can still throw its shadow into it
        sphere.radius = r + (quality.shadows ? e.shadowLen : 0);
        show = frustum.intersectsSphere(sphere);
      }
      if (!show) continue;
      if (d - r < SHADOW_RANGE) shadow = true;
      if (e.selected[count] !== i) changed = true;
      e.selected[count++] = i;
    }
    if (count !== e.selectedCount) changed = true;
    e.selectedCount = count;
    for (const part of e.parts) {
      const mesh = part.mesh;
      mesh.visible = count > 0;
      mesh.castShadow = shadow && part.castShadow && quality.shadows;
      if (!changed || count === 0) continue;
      if (mesh instanceof InstancedMesh) {
        const arr = mesh.instanceMatrix.array as Float32Array;
        for (let k = 0; k < count; k++) {
          const src = (e.selected[k] as number) * 16;
          arr.set(e.matrices.subarray(src, src + 16), k * 16);
        }
        mesh.count = count;
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
    if (count > 0) writeOcclusion(e, changed);
  }

  /** r9 Z9: the camera and the hero points of this frame's occlusion tests */
  function updateOcclusionView(dt: number, camera: PerspectiveCamera, focus: Vector3): void {
    camPos.setFromMatrixPosition(camera.matrixWorld);
    occView.camX = camPos.x;
    occView.camY = camPos.y;
    occView.camZ = camPos.z;
    if (haveFocus && dt > 1e-4) {
      // the focus velocity, smoothed over ~0.15 s and clamped (a snap / teleport is not a run)
      const k = 1 - Math.exp(-dt / 0.15);
      focusVel.x += ((focus.x - prevFocus.x) / dt - focusVel.x) * k;
      focusVel.z += ((focus.z - prevFocus.z) / dt - focusVel.z) * k;
      const sp = Math.hypot(focusVel.x, focusVel.z);
      if (sp > 8) focusVel.multiplyScalar(8 / sp);
    }
    prevFocus.copy(focus);
    haveFocus = true;
    const a = occHeroes[0]!;
    const b = occHeroes[1]!;
    a.x = focus.x;
    a.y = focus.y;
    a.z = focus.z;
    b.x = focus.x - focusVel.x * 0.23;
    b.y = focus.y;
    b.z = focus.z - focusVel.z * 0.23;
    occView.heroes = Math.hypot(focusVel.x, focusVel.z) > 0.3 ? occHeroes : occStill;
    // the gameplay rig looks down at 55 degrees; the run-start fly-in (render/camera.ts FEEL-04) comes in from 17: no ray test below 40
    occView.rays = Math.atan2(camPos.y - focus.y, Math.hypot(camPos.x - focus.x, camPos.z - focus.z)) > OCC_MIN_ELEVATION;
  }

  const system: ZoneSystem = {
    name: 'structures',
    group,
    ready: init(),
    update(dt: number, camera: PerspectiveCamera, focus: Vector3) {
      const t = worldUniforms.uTime.value;
      for (const e of entries) e.update?.(t);
      for (const u of decorUpdates) u(t);
      camera.updateMatrixWorld();
      projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projView);
      updateOcclusionView(dt, camera, focus);
      // a frame without a time step (the first, a warm-up draw) settles at once
      const occDt = dt > 0 ? Math.min(dt, 0.1) : 1;
      const occOn = occlusionRadius.value > 0;
      for (const e of entries) updateOcclusion(e, occDt, occOn);
      const near = NEAR_RANGE[quality.tier];
      for (const e of entries) select(e, focus, near);
    },
    setQuality(p: QualityProfile) {
      quality = p;
      applyQuality();
    },
    dispose() {
      disposed = true;
      for (const e of entries) {
        for (const p of e.parts) {
          p.geometry.dispose();
          p.material.dispose();
          // r9 ship: the part's shadow-pass material (glbParts)
          (p.mesh.customDepthMaterial as Material | undefined)?.dispose();
          if (p.mesh instanceof InstancedMesh) p.mesh.dispose();
          group.remove(p.mesh);
        }
      }
      entries.length = 0;
      walls?.dispose();
      bridges?.dispose();
    },
  };
  return system;
}
