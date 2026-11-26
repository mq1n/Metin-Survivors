// CrowdRenderer: one InstancedMesh per enemy type, GPU-skinned from baked bone-matrix textures.
// Reads the sim's EnemyFeed each frame, interpolates prev→cur, culls against the camera footprint, and also
// renders death "corpses" (death clip + dissolve) spawned from enemyDeath events, plus instanced blob shadows.
import {
  BufferGeometry,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  type MeshLambertMaterial,
  type Texture,
} from 'three';
import type { RenderCore, RenderSystem } from '../core';
import type { QualityProfile } from '../quality';
import { CLIP_NAMES, type CrowdTypeDef, type EnemyFeed, type EnemyStreamDef } from '../feed';
import { bakeModel, bakeModelSteps, sampleRows, sampleSocket, type BakedClip, type BakedModel, type BakedSocket, type SocketPoint } from './bake';
import { BlobShadows } from './blobShadows';
import { createCrowdMaterial, crowdShared, setAnimLerp } from './crowdMaterial';

const DEATH_IDX = CLIP_NAMES.indexOf('death');
const IDLE_IDX = CLIP_NAMES.indexOf('idle');
const SPECIAL1_IDX = CLIP_NAMES.indexOf('special1');
/** EnemyFlag.Metin bit (sim/stores.ts): metin hit-rows are rendered by the metin view, not the crowd */
const EnemyFlagMetin = 8;
/** a boss closer than this (m) to the camera focus influences the camera framing */
const BOSS_NEAR_SQ = 25 * 25;
/** render-only boss size cue (×) for boss bodies shorter than BOSS_CUE_MAX_H (m) */
const BOSS_CUE_SCALE = 1.35;
const BOSS_CUE_MAX_H = 4.5;
const MAX_CORPSES = 160;
const DISSOLVE_TIME = 0.7;
/** an event at a boss's sim position (breath ticks) matches the boss row within this distance² (m²) */
const BOSS_AT_SQ = 0.5 * 0.5;

// ---- background streaming of the types a run only meets later (RenderCatalog.enemyLater) -------------------------------
/** a streamed type's model starts to download this many seconds of run rendering before the type can first spawn (rendering
 *  runs ahead of the sim clock: modals pause the sim, not the renderer), so it is baked and compiled well before its band */
export const CROWD_STREAM_LEAD = 90;
/** no background download starts before this many seconds of run rendering: the first seconds belong to the zone music, the
 *  first sounds and the first fights (and to the payload gate's HUD + 6 s window, ARCHITECTURE §11) */
export const CROWD_STREAM_DELAY = 10;
/** a streamed model's bake slices may take this long (ms) out of one frame */
const STREAM_STAGE_MS = 2;
/** seconds of run rendering before a failed model download is tried again */
const STREAM_RETRY_S = 5;
/** concurrent downloads: one for the schedule, a few more for types that are on screen already (on demand) */
const STREAM_FETCHES = 1;
const STREAM_FETCHES_URGENT = 3;

type StreamStage = 'queued' | 'fetching' | 'fetched' | 'baking' | 'baked' | 'built' | 'warming' | 'ready';

/** One model on its way into the live crowd: download → bake (sliced) → batches + GPU upload → program compile → active. */
interface StreamItem {
  modelId: string;
  /** run seconds from which one of its types can appear */
  at: number;
  /** a feed row of one of its types is on screen already: no delay, no lead, ahead of the schedule */
  urgent: boolean;
  /** type indexes using this model that still need a batch */
  types: number[];
  stage: StreamStage;
  /** stream time from which a failed download may be retried */
  retryAt: number;
  baker: Generator<void, BakedModel, void> | null;
  built: Batch[];
}

const byPriority = (a: StreamItem, b: StreamItem): number => Number(b.urgent) - Number(a.urgent) || a.at - b.at;

interface Batch {
  /** index into the type table */
  type: number;
  def: CrowdTypeDef;
  baked: BakedModel;
  material: MeshLambertMaterial;
  base: BufferGeometry;
  mesh: InstancedMesh;
  capacity: number;
  anim: InstancedBufferAttribute;
  fx: InstancedBufferAttribute;
  count: number;
  /** model height × def scale reference used for culling radius */
  cullR: number;
  shadowR: number;
  /** base emissiveIntensity of the source material (0 = no emissive) */
  emissiveBase: number;
  /** some instance plays its `special1` clip this frame */
  special: boolean;
  /** model extras.breath window (seconds into special1); null = any special1 surges */
  breath: { start: number; end: number } | null;
}

const rows = { a: 0, b: 0, mix: 0 };

export class CrowdRenderer implements RenderSystem {
  readonly name = 'crowd';
  /** assigned by the owner before each core.frame() */
  feed: EnemyFeed | null = null;
  /** optional sink for ground rings under elites/bosses: (x, z, radius, tier) */
  eliteSink: ((x: number, z: number, radius: number, tier: number) => void) | null = null;
  readonly blobs: BlobShadows;
  /** When true, the caller (RenderWorld) calls `blobs.end()` after heroes and metins finish appending their shadows. */
  deferBlobEnd = false;
  /**
   * Compiles a streamed batch's material ahead of its first draw (RenderWorld wires it to renderer.compileAsync with the
   * render-target state of the scene pass). Resolves when the program is ready; absent = nothing to wait for.
   */
  warmSink: ((mesh: InstancedMesh) => Promise<unknown> | void) | null = null;
  /** last frame stats */
  readonly stats = { drawn: 0, culled: 0, corpses: 0, over: 0 };

  private batches: (Batch | undefined)[] = [];
  private types: CrowdTypeDef[] = [];
  private readonly baked = new Map<string, BakedModel>();
  /** streaming: models still on their way in, run-render seconds since `load`, and which types were asked for on demand */
  private items: StreamItem[] = [];
  private streamTime = 0;
  private wanted = new Uint8Array(0);
  /** bumped by every `load` / dispose: a download or compile that finishes for an older run is dropped */
  private gen = 0;
  private readonly unsub: Array<() => void> = [];
  // Distance cull radius² adapts so the drawn count stays under quality.crowdCap.
  private cullRadiusSq = Infinity;
  /** height (m) of the tallest boss within BOSS_NEAR of the camera focus this frame; 0 = none (drives camera framing) */
  bossHeight = 0;
  private lastDrawn = 0;
  // Corpse ring buffer (SoA).
  private readonly cType = new Int16Array(MAX_CORPSES);
  private readonly cX = new Float32Array(MAX_CORPSES);
  private readonly cZ = new Float32Array(MAX_CORPSES);
  private readonly cRot = new Float32Array(MAX_CORPSES);
  private readonly cScale = new Float32Array(MAX_CORPSES);
  private readonly cAge = new Float32Array(MAX_CORPSES);
  private readonly cDeathDur = new Float32Array(MAX_CORPSES);
  private cCount = 0;

  constructor(private readonly core: RenderCore) {
    this.blobs = new BlobShadows(core.scene);
    this.unsub.push(core.quality.onChange((p) => this.onQuality(p)));
  }

  /**
   * Declares the type table (index = sim enemy type index) and bakes/loads every model of the `used` types (default: all)
   * before resolving. `later` types stream in the background instead (see pumpStream): their models download
   * CROWD_STREAM_LEAD seconds of run rendering before `at`, bake in idle slices and compile ahead of their first draw. A
   * feed row of a type that is neither loaded nor scheduled is fetched on demand (it stays hidden until it is ready).
   */
  async load(types: CrowdTypeDef[], used?: number[], onProgress?: (fraction: number) => void, later: readonly EnemyStreamDef[] = []): Promise<void> {
    this.disposeBatches();
    const gen = ++this.gen;
    this.types = types;
    this.wanted = new Uint8Array(types.length);
    const useSet = used ? new Set(used) : null;
    const ids = [...new Set(types.filter((_, i) => !useSet || useSet.has(i)).map((t) => t.modelId))];
    await this.core.assets.loadBatch(
      ids.map((id) => ({ kind: 'model' as const, id, hint: 'creature' as const })),
      (p) => onProgress?.(p.fraction * 0.8),
    );
    if (gen !== this.gen) return;
    let i = 0;
    for (const id of ids) {
      if (!this.baked.has(id)) this.baked.set(id, bakeModel(this.core.assets.model(id)));
      onProgress?.(0.8 + (0.2 * ++i) / ids.length);
    }
    this.batches = types.map((def, i) => (!useSet || useSet.has(i) ? this.createBatch(def, 64, i) : undefined));
    this.streamTime = 0;
    for (const l of later) this.enqueue(l.type, l.at, false);
  }

  private createBatch(def: CrowdTypeDef, capacity: number, type: number): Batch {
    const baked = this.baked.get(def.modelId);
    if (!baked) throw new Error(`crowd: model "${def.modelId}" not baked`);
    const src = baked.mesh;
    const srcMat = src.material as MeshLambertMaterial & { map?: Texture | null };
    const hasEmissive = srcMat.emissiveMap != null || srcMat.emissive.getHex() !== 0;
    const geo = src.geometry;
    const material = createCrowdMaterial({
      bake: baked.texture,
      boneCount: baked.boneCount,
      map: srcMat.map ?? null,
      vertexColors: geo.getAttribute('color') !== undefined,
      tint: def.tint,
      tintMode: def.tintMode,
      emissive: srcMat.emissive,
      emissiveMap: srcMat.emissiveMap ?? null,
      emissiveIntensity: srcMat.emissiveIntensity,
      animLerp: this.core.quality.profile.animLerp,
    });
    const batch = {
      type,
      def,
      baked,
      material,
      base: geo,
      cullR: baked.height * 0.8 + 1,
      shadowR: def.radius,
      emissiveBase: hasEmissive ? srcMat.emissiveIntensity : 0,
      special: false,
      breath: this.core.assets.model(def.modelId).extras.breath ?? null,
      count: 0,
    } as Batch;
    this.buildMesh(batch, capacity);
    return batch;
  }

  private buildMesh(b: Batch, capacity: number): void {
    const geo = new BufferGeometry();
    for (const name of ['position', 'normal', 'color', 'uv', 'skinIndex', 'skinWeight'] as const) {
      const a = b.base.getAttribute(name);
      if (a) geo.setAttribute(name, a);
    }
    geo.index = b.base.index;
    const anim = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    const fx = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    anim.setUsage(DynamicDrawUsage);
    fx.setUsage(DynamicDrawUsage);
    geo.setAttribute('aAnim', anim);
    geo.setAttribute('aFx', fx);
    const mesh = new InstancedMesh(geo, b.material, capacity);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.count = 0;
    // `update` shows a batch once it has instances; a streamed batch must not draw before its program is compiled
    // (a drawn mesh with 0 instances still compiles its program inside the frame)
    mesh.visible = false;
    b.mesh = mesh;
    b.anim = anim;
    b.fx = fx;
    b.capacity = capacity;
    this.core.scene.add(mesh);
  }

  /** Doubles a batch's capacity, carrying over the `b.count` rows already written this frame. */
  private ensure(b: Batch, need: number): void {
    if (need <= b.capacity) return;
    let cap = b.capacity;
    while (cap < need) cap *= 2;
    const old = b.mesh;
    const matrices = (old.instanceMatrix.array as Float32Array).subarray(0, b.count * 16);
    const anim = (b.anim.array as Float32Array).subarray(0, b.count * 4);
    const fx = (b.fx.array as Float32Array).subarray(0, b.count * 4);
    this.buildMesh(b, cap);
    (b.mesh.instanceMatrix.array as Float32Array).set(matrices);
    (b.anim.array as Float32Array).set(anim);
    (b.fx.array as Float32Array).set(fx);
    this.core.scene.remove(old);
    old.geometry.dispose();
    old.dispose();
  }

  private onQuality(p: QualityProfile): void {
    for (const b of this.batches) if (b) setAnimLerp(b.material, p.animLerp);
  }

  /** A killed enemy lingers: plays its death clip then dissolves. */
  addCorpse(type: number, x: number, z: number, rot: number, scale: number): void {
    const b = this.batches[type];
    if (!b) return;
    if (this.cCount >= MAX_CORPSES) {
      // drop the oldest by shifting; MAX_CORPSES is small so a copyWithin is cheaper than a ring bookkeeping bug
      this.cType.copyWithin(0, 1);
      this.cX.copyWithin(0, 1);
      this.cZ.copyWithin(0, 1);
      this.cRot.copyWithin(0, 1);
      this.cScale.copyWithin(0, 1);
      this.cAge.copyWithin(0, 1);
      this.cDeathDur.copyWithin(0, 1);
      this.cCount--;
    }
    const i = this.cCount++;
    const clip = b.baked.byIndex[DEATH_IDX];
    this.cType[i] = type;
    this.cX[i] = x;
    this.cZ[i] = z;
    this.cRot[i] = rot;
    this.cScale[i] = scale;
    this.cAge[i] = 0;
    this.cDeathDur[i] = clip ? clip.duration : 0;
  }

  clearCorpses(): void {
    this.cCount = 0;
  }

  update(dt: number, alpha: number): void {
    const core = this.core;
    crowdShared.time.value = core.clock.time;
    const feed = this.feed;
    const batches = this.batches;
    for (const b of batches) {
      if (!b) continue;
      b.count = 0;
      b.special = false;
    }
    const blobs = this.blobs;
    blobs.begin();
    const rig = core.rig;
    const fx0 = rig.focus.x;
    const fz0 = rig.focus.z;
    const heightAt = core.heightAt;
    const cap = core.quality.profile.crowdCap;
    const cullSq = this.cullRadiusSq;
    const sink = this.eliteSink;
    let drawn = 0;
    let culled = 0;
    let bossH = 0;
    const sunX = core.env.sunDir.x;
    const sunZ = core.env.sunDir.z;

    if (feed) {
      const n = feed.count;
      const fxx = feed.x;
      const fzz = feed.z;
      const pxx = feed.px;
      const pzz = feed.pz;
      const rotA = feed.rot;
      const scaleA = feed.scale;
      for (let i = 0; i < n; i++) {
        if (((feed.flags[i] as number) & EnemyFlagMetin) !== 0) continue;
        const b = batches[feed.type[i] as number];
        if (!b) {
          // a type that is not loaded yet is on screen (clock jump, slow download, a type the schedule missed): fetch it
          // now; the row stays hidden until its batch is ready
          this.wantType(feed.type[i] as number);
          continue;
        }
        const px = pxx[i] as number;
        const pz = pzz[i] as number;
        const x = px + ((fxx[i] as number) - px) * alpha;
        const z = pz + ((fzz[i] as number) - pz) * alpha;
        const s = scaleA[i] as number;
        const dx = x - fx0;
        const dz = z - fz0;
        if (feed.eliteTier[i] === 3 && dx * dx + dz * dz < BOSS_NEAR_SQ) {
          const bh = b.baked.height * s;
          if (bh > bossH) bossH = bh;
        }
        if (dx * dx + dz * dz > cullSq || !rig.isVisible(x, z, b.cullR * s)) {
          culled++;
          continue;
        }
        const y = heightAt(x, z);
        const tier = feed.eliteTier[i] as number;
        const clip = b.baked.byIndex[feed.animClip[i] as number] ?? (b.baked.byIndex[IDLE_IDX] as BakedClip | null);
        const slot = b.count++;
        if (feed.animClip[i] === SPECIAL1_IDX) {
          const br = b.breath;
          const at = feed.animT[i] as number;
          if (!br || (at >= br.start && at <= br.end)) b.special = true;
        }
        if (slot >= b.capacity) this.ensure(b, slot + 1);
        const rs = drawScale(b, tier, s);
        writeMatrix(b.mesh.instanceMatrix.array as Float32Array, slot, x, y, z, rotA[i] as number, rs);
        const a = b.anim.array as Float32Array;
        const o = slot * 4;
        if (clip) {
          sampleRows(clip, feed.animT[i] as number, rows);
          a[o] = rows.a;
          a[o + 1] = rows.b;
          a[o + 2] = rows.mix;
        } else {
          a[o] = a[o + 1] = a[o + 2] = 0;
        }
        a[o + 3] = feed.status[i] as number;
        const f = b.fx.array as Float32Array;
        f[o] = feed.flash[i] as number;
        f[o + 1] = 0;
        f[o + 2] = feed.corrupted[i] as number;
        f[o + 3] = tier;
        blobs.add(x - sunX * 0.12 * rs, y, z - sunZ * 0.12 * rs, b.shadowR * rs * 1.25, 0.85);
        if (tier > 0 && sink) sink(x, z, b.shadowR * rs * 1.3 + 0.35, tier);
        drawn++;
      }
    }

    this.bossHeight = bossH;

    // emissive pulse: slow breathing, strong surge while any instance plays its special (scarlet_wyrm breath, boss casts)
    const t = core.clock.time;
    for (const b of batches) {
      if (!b || !b.emissiveBase) continue;
      b.material.emissiveIntensity = b.emissiveBase * (0.85 + 0.15 * Math.sin(t * 2.1 + b.def.radius * 3)) * (b.special ? 2.4 : 1);
    }

    // corpses
    let nc = 0;
    for (let i = 0; i < this.cCount; ) {
      const age = (this.cAge[i] as number) + dt;
      this.cAge[i] = age;
      const dd = this.cDeathDur[i] as number;
      const dStart = dd * 0.55;
      if (age >= dStart + DISSOLVE_TIME) {
        const last = --this.cCount;
        if (i !== last) {
          this.cType[i] = this.cType[last] as number;
          this.cX[i] = this.cX[last] as number;
          this.cZ[i] = this.cZ[last] as number;
          this.cRot[i] = this.cRot[last] as number;
          this.cScale[i] = this.cScale[last] as number;
          this.cAge[i] = this.cAge[last] as number;
          this.cDeathDur[i] = this.cDeathDur[last] as number;
        }
        continue;
      }
      const b = batches[this.cType[i] as number];
      const x = this.cX[i] as number;
      const z = this.cZ[i] as number;
      const s = this.cScale[i] as number;
      if (b && rig.isVisible(x, z, b.cullR * s)) {
        const y = heightAt(x, z);
        const clip = b.baked.byIndex[DEATH_IDX] ?? (b.baked.byIndex[IDLE_IDX] as BakedClip | null);
        const slot = b.count++;
        if (slot >= b.capacity) this.ensure(b, slot + 1);
        writeMatrix(b.mesh.instanceMatrix.array as Float32Array, slot, x, y, z, this.cRot[i] as number, s);
        const a = b.anim.array as Float32Array;
        const o = slot * 4;
        if (clip) {
          sampleRows(clip, age, rows);
          a[o] = rows.a;
          a[o + 1] = rows.b;
          a[o + 2] = rows.mix;
        } else {
          a[o] = a[o + 1] = a[o + 2] = 0;
        }
        a[o + 3] = 0;
        const f = b.fx.array as Float32Array;
        const dis = Math.max(0, (age - dStart) / DISSOLVE_TIME);
        f[o] = Math.max(0, 1 - age * 7);
        f[o + 1] = dis * dis * (3 - 2 * dis);
        f[o + 2] = 0;
        f[o + 3] = 0;
        blobs.add(x, y, z, b.shadowR * s * 1.25, 0.85 * (1 - dis));
        nc++;
      }
      i++;
    }

    for (const b of batches) {
      if (!b) continue;
      const mesh = b.mesh;
      mesh.count = b.count;
      mesh.visible = b.count > 0;
      if (b.count === 0) continue;
      const im = mesh.instanceMatrix;
      im.clearUpdateRanges();
      im.addUpdateRange(0, b.count * 16);
      im.needsUpdate = true;
      b.anim.clearUpdateRanges();
      b.anim.addUpdateRange(0, b.count * 4);
      b.anim.needsUpdate = true;
      b.fx.clearUpdateRanges();
      b.fx.addUpdateRange(0, b.count * 4);
      b.fx.needsUpdate = true;
    }
    if (!this.deferBlobEnd) blobs.end();

    // Adapt the distance cull so we stay under the quality cap (shrink fast, grow slowly).
    const total = drawn + nc;
    if (total > cap) {
      const r = Math.sqrt(Number.isFinite(this.cullRadiusSq) ? this.cullRadiusSq : 90 * 90);
      this.cullRadiusSq = Math.max(8 * 8, (r * 0.94) ** 2);
    } else if (Number.isFinite(this.cullRadiusSq)) {
      const r = Math.sqrt(this.cullRadiusSq) * 1.01;
      this.cullRadiusSq = r > 120 ? Infinity : r * r;
    }
    this.lastDrawn = total;
    this.stats.drawn = drawn;
    this.stats.culled = culled;
    this.stats.corpses = nc;
    this.stats.over = Math.max(0, total - cap);
    if (this.items.length > 0) this.pumpStream(dt);
  }

  // ---- streaming ----------------------------------------------------------------------------------------------------

  /** a feed row of `type` is on screen without a batch: schedule it ahead of everything else (once per type) */
  private wantType(type: number): void {
    if (!(type >= 0 && type < this.wanted.length) || this.wanted[type] === 1) return;
    this.wanted[type] = 1;
    this.enqueue(type, 0, true);
  }

  /** puts a type on the stream queue (its model joins the item of a type that shares it) */
  private enqueue(type: number, at: number, urgent: boolean): void {
    const def = this.types[type];
    if (!def || this.batches[type]) return;
    let it = this.items.find((i) => i.modelId === def.modelId);
    if (it) {
      if (!it.types.includes(type)) it.types.push(type);
      it.at = Math.min(it.at, at);
      it.urgent ||= urgent;
    } else {
      const stage: StreamStage = this.baked.has(def.modelId)
        ? 'baked'
        : this.core.assets.isModelLoaded(def.modelId)
          ? 'fetched'
          : 'queued';
      it = { modelId: def.modelId, at, urgent, types: [type], stage, retryAt: 0, baker: null, built: [] };
      this.items.push(it);
    }
    this.items.sort(byPriority);
  }

  /**
   * One frame of background work, never more than the bake slice budget: starts due downloads (one at a time on the
   * schedule, several for types already on screen), advances one model by one stage (bake slices → batches + bake texture
   * upload → diffuse upload + program compile request) and activates the models whose programs are ready. A type's batch
   * only becomes visible to the draw loop when it is activated, so nothing compiles or uploads in a drawing frame.
   */
  private pumpStream(dt: number): void {
    const t0 = performance.now();
    this.streamTime += dt;
    const items = this.items;
    let fetching = 0;
    for (const it of items) if (it.stage === 'fetching') fetching++;
    for (const it of items) {
      if (it.stage !== 'queued' || it.retryAt > this.streamTime) continue;
      const early = this.streamTime < CROWD_STREAM_DELAY || this.streamTime < it.at - CROWD_STREAM_LEAD;
      if (it.urgent ? fetching >= STREAM_FETCHES_URGENT : fetching >= STREAM_FETCHES || early) continue;
      this.fetchItem(it);
      fetching++;
    }
    for (let k = items.length - 1; k >= 0; k--) {
      const it = items[k] as StreamItem;
      if (it.stage !== 'ready') continue;
      for (const b of it.built) {
        const prev = this.batches[b.type];
        if (prev && prev !== b) this.disposeBatch(prev);
        setAnimLerp(b.material, this.core.quality.profile.animLerp);
        this.batches[b.type] = b;
      }
      it.built = [];
      const pending = it.types.filter((t) => !this.batches[t]);
      if (pending.length > 0) {
        it.types = pending;
        it.stage = this.baked.has(it.modelId) ? 'baked' : this.core.assets.isModelLoaded(it.modelId) ? 'fetched' : 'queued';
      } else {
        items.splice(k, 1);
      }
    }
    const isWaitingOnPeerBake = (it: StreamItem): boolean =>
      it.stage === 'fetched' && items.some((o) => o !== it && o.modelId === it.modelId && o.stage === 'baking');
    const next = items.find(
      (i) => (i.stage === 'fetched' || i.stage === 'baking' || i.stage === 'baked' || i.stage === 'built') && !isWaitingOnPeerBake(i),
    );
    if (next) this.advance(next, t0);
  }

  private fetchItem(it: StreamItem): void {
    const gen = this.gen;
    const assets = this.core.assets;
    it.stage = 'fetching';
    (assets.isModelLoaded(it.modelId) ? Promise.resolve() : assets.loadModel(it.modelId, 'creature')).then(
      () => {
        if (gen === this.gen) it.stage = 'fetched';
      },
      (err: unknown) => {
        if (gen !== this.gen) return;
        it.stage = 'queued';
        it.retryAt = this.streamTime + STREAM_RETRY_S;
        console.warn(`[crowd] model ${it.modelId} failed to load, retrying`, err);
      },
    );
  }

  private advance(it: StreamItem, t0: number): void {
    const r = this.core.renderer;
    switch (it.stage) {
      case 'fetched':
        // another item of the same model is baking it: wait for its result instead of baking twice
        if (this.items.some((o) => o !== it && o.modelId === it.modelId && o.stage === 'baking')) return;
        if (this.baked.has(it.modelId)) it.stage = 'baked';
        else {
          it.baker = bakeModelSteps(this.core.assets.model(it.modelId));
          it.stage = 'baking';
        }
        return;
      case 'baking': {
        const baker = it.baker as Generator<void, BakedModel, void>;
        for (;;) {
          const step = baker.next();
          if (step.done) {
            this.baked.set(it.modelId, step.value);
            it.baker = null;
            it.stage = 'baked';
            return;
          }
          if (performance.now() - t0 >= STREAM_STAGE_MS) return;
        }
      }
      case 'baked': {
        // the batches join the scene hidden (count 0); the bake texture goes to the GPU now, not in a drawing frame
        for (const type of it.types) {
          const def = this.types[type];
          if (def && !this.batches[type] && !it.built.some((b) => b.type === type)) it.built.push(this.createBatch(def, 64, type));
        }
        const baked = this.baked.get(it.modelId);
        if (baked && r) r.initTexture(baked.texture);
        it.stage = 'built';
        return;
      }
      case 'built': {
        for (const type of it.types) {
          const def = this.types[type];
          if (def && !this.batches[type] && !it.built.some((b) => b.type === type)) {
            it.built.push(this.createBatch(def, 64, type));
          }
        }
        const waits: Promise<unknown>[] = [];
        for (const b of it.built) {
          const m = b.material;
          for (const tex of [m.map, m.emissiveMap]) if (tex && r) r.initTexture(tex);
          try {
            const p = this.warmSink?.(b.mesh);
            if (p) waits.push(p);
          } catch (err) {
            console.warn(`[crowd] warmSink threw for ${it.modelId}`, err);
          }
        }
        it.stage = 'warming';
        const gen = this.gen;
        void Promise.all(waits).then(
          () => {
            if (gen === this.gen) it.stage = 'ready';
          },
          () => {
            if (gen === this.gen) it.stage = 'ready';
          },
        );
        return;
      }
      default:
        return;
    }
  }

  /** Feed row of the boss (eliteTier 3) nearest to (x, z) within 0.5 m — the row a boss-sourced sim event came from; -1 = none. */
  bossAt(x: number, z: number): number {
    const feed = this.feed;
    if (!feed) return -1;
    let best = -1;
    let bestSq = BOSS_AT_SQ;
    for (let i = 0; i < feed.count; i++) {
      if (feed.eliteTier[i] !== 3) continue;
      const dx = (feed.x[i] as number) - x;
      const dz = (feed.z[i] as number) - z;
      const d = dx * dx + dz * dz;
      if (d <= bestSq) {
        bestSq = d;
        best = i;
      }
    }
    return best;
  }

  /**
   * World position of a baked socket (e.g. `muzzle`) on the unit at feed row `i` this tick: the socket's position in the
   * row's current clip frame, placed by the same transform the crowd draws it with (x, z, ground height, yaw, draw scale).
   * False when the row is out of range or its model has no such socket.
   */
  socketWorld(i: number, socket: BakedSocket, out: SocketPoint): boolean {
    const feed = this.feed;
    if (!feed || i < 0 || i >= feed.count) return false;
    const b = this.batches[feed.type[i] as number];
    const track = b?.baked.sockets[socket];
    if (!b || !track) return false;
    const clip = b.baked.byIndex[feed.animClip[i] as number] ?? b.baked.byIndex[IDLE_IDX];
    if (!clip) return false;
    sampleRows(clip, feed.animT[i] as number, rows);
    sampleSocket(track, rows, out);
    const x = feed.x[i] as number;
    const z = feed.z[i] as number;
    const s = drawScale(b, feed.eliteTier[i] as number, feed.scale[i] as number);
    instancePoint(out, x, this.core.heightAt(x, z), z, feed.rot[i] as number, s, out);
    return true;
  }

  get drawnLastFrame(): number {
    return this.lastDrawn;
  }

  private disposeBatch(b: Batch): void {
    this.core.scene.remove(b.mesh);
    b.mesh.geometry.dispose();
    b.mesh.dispose();
    b.material.dispose();
  }

  private disposeBatches(): void {
    this.gen++; // downloads / compiles still in flight belong to the run that is going away
    for (const it of this.items) for (const b of it.built) this.disposeBatch(b);
    this.items = [];
    this.wanted = new Uint8Array(0); // nothing may be fetched on demand until the next `load`
    for (const b of this.batches) if (b) this.disposeBatch(b);
    this.batches = [];
    for (const m of this.baked.values()) m.dispose();
    this.baked.clear();
    this.cCount = 0;
  }

  /**
   * End of a run: frees the run's batches and the baked bone-matrix textures now instead of at the next `load()`
   * (quit to menu / "try again" otherwise keeps them alive on the GPU). The renderer stays usable: the next run's
   * `load()` rebuilds everything, and with no batches `update`/`addCorpse`/`socketWorld` are no-ops.
   */
  releaseRun(): void {
    this.feed = null;
    this.disposeBatches();
  }

  dispose(): void {
    for (const u of this.unsub) u();
    this.disposeBatches();
    this.blobs.dispose();
  }
}

function writeMatrix(m: Float32Array, slot: number, x: number, y: number, z: number, rot: number, s: number): void {
  const c = Math.cos(rot) * s;
  const sn = Math.sin(rot) * s;
  const o = slot * 16;
  m[o] = c;
  m[o + 1] = 0;
  m[o + 2] = -sn;
  m[o + 3] = 0;
  m[o + 4] = 0;
  m[o + 5] = s;
  m[o + 6] = 0;
  m[o + 7] = 0;
  m[o + 8] = sn;
  m[o + 9] = 0;
  m[o + 10] = c;
  m[o + 11] = 0;
  m[o + 12] = x;
  m[o + 13] = y;
  m[o + 14] = z;
  m[o + 15] = 1;
}

/**
 * Scale a unit is drawn at. Bosses that share a rank-and-file body (Blaze Tiger, Plagued Swordsman…) are drawn larger
 * so they read as the boss at a glance; already-huge models (dragon, golems) keep their size.
 */
function drawScale(b: Batch, tier: number, s: number): number {
  return tier === 3 && b.baked.height * s < BOSS_CUE_MAX_H ? s * BOSS_CUE_SCALE : s;
}

/** Model-space point `p` through writeMatrix's transform (translate · yaw `rot` · uniform `s`) into `out` (may alias `p`). */
export function instancePoint(p: SocketPoint, x: number, y: number, z: number, rot: number, s: number, out: SocketPoint): void {
  const c = Math.cos(rot) * s;
  const sn = Math.sin(rot) * s;
  const px = p.x;
  const py = p.y;
  const pz = p.z;
  out.x = x + c * px + sn * pz;
  out.y = y + s * py;
  out.z = z - sn * px + c * pz;
}
