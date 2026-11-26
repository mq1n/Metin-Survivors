// RunSession: one run = sim World + its render content. Owns the per-tick (input → step → events) and per-frame
// (feeds → RenderWorld) glue, the 10 Hz HUD snapshot and the modal bridge to the GameStore.
import { Vector3, type Camera, type Object3D } from 'three';
import { autoCast } from './combatMode';
import type { ContentDB } from '../data/schema';
import type { MoveVector } from '../engine/input';
import type { RenderWorld, HeroSpec } from '../render/world';
import { createWorld, type World } from '../sim/world';
import type { RunConfig, RunResult } from '../sim/run';
import type { PlayerInput } from '../sim/stores';
import type { GameStore } from './store';
import { runEvents } from './runEvents';
import type { CoopRunStart } from '../net/coop';
import { ProjectileStyleTable, ambientLoopsForTier, buildCatalog, configureVfxEvents, worldFeeds, zoneAmbientLoops } from './simFeed';
import { SkillVfxFeed } from './skillVfxFeed';
import { FootDustFeed } from '../vfx/skills/common/dustFeed';
import { StatusVfxFeed } from '../vfx/skills/common/statusFeed';
import { ensureSkillVfx, runSkillClasses } from '../vfx/skills/loader';
import type { RenderFeeds } from '../render/feed';
import type { Input } from '../engine/input';
import { createTerrainField, type TerrainField } from '../world/terrainField';
import type { RenderCore, RenderSystem } from '../render/core';
import type { QualityProfile } from '../render/quality';
import { applyZoneReadability } from '../render/zoneReadability';
import { metinRestKind } from '../render/metin';
import { metinRestWorld } from '../render/metinBodies';
import { findLook, resolveBiome } from '../render/terrain/look';
import { asPostPipeline, type PostPipeline } from '../render/post';

const HUD_INTERVAL = 0.1;
const HUD_INTERVAL_MOBILE = 0.16;
/** ambient particle box half-extent (m) around the camera focus: covers the gameplay view at max zoom */
const AMBIENT_RADIUS = 26;
/** loop length (s) for the ambient preset: longer than any run (preset default 900 s would expire mid-run) */
const AMBIENT_FOREVER = 1e6;

export interface RunDeps {
  renderWorld: RenderWorld;
  input: Input;
  store: GameStore;
}

/** The TERRAIN agent's per-zone scene (src/render/terrain/zoneScene.ts). */
interface ZoneScene {
  group: Object3D;
  /** the zone's systems by name (sky, terrain, liquid, vegetation, structures) */
  systems?: readonly { name: string; update(dt: number, camera: Camera, focus: Vector3): void }[];
  update(dt: number, camera: Camera, focus: Vector3, run?: { time: number; corruption: number }): void;
  setQuality(profile: QualityProfile): void;
  dispose(): void;
  ready: Promise<void>;
}
type ZoneSceneFactory = (core: RenderCore, field: TerrainField, biome: ContentDB['zones'][number]['biome']) => ZoneScene;

export class RunSession {
  readonly world: World;
  readonly feeds: RenderFeeds;
  /** set when the run is over and the end modal was acknowledged */
  finished = false;

  private readonly move: MoveVector = { x: 0, z: 0 };
  private readonly inputs: PlayerInput[] = [];
  private readonly aimOrigin = new Vector3();
  private readonly aimRay = new Vector3();
  private readonly styles = new ProjectileStyleTable();
  private readonly skillVfx = new SkillVfxFeed();
  
  private readonly statusVfx = new StatusVfxFeed();
  private readonly footDust = new FootDustFeed();
  private hudAcc = 1;
  private warmLeft = 4;
  private disposed = false;
  private devGround: Object3D | null = null;
  private zoneScene: ZoneScene | null = null;
  private zoneSystem: RenderSystem | null = null;
  /** PL-03a: the run clock and corruption the zone's light arc is driven by (host: the sim's; guest: the mirrored world's, the ones the HUD timer / gauge show) */
  private readonly arcClock = { time: 0, corruption: 0 };
  /** PL-01: the composite pass this run set the zone's look on (setZonePost(null) at dispose) */
  private post: PostPipeline | null = null;
  private offQuality: (() => void) | null = null;
  /** PL-02: the zone's ambient loops this build can draw (biome.particles first, then look.ambientLoops), the ones alive with their VFX handles, and the tier-change subscription */
  private ambientIds: string[] = [];
  private readonly ambientLive: { id: string; handle: number }[] = [];
  private offAmbient: (() => void) | null = null;
  private previousHeightAt: ((x: number, z: number) => number) | null = null;
  private previousRestAt: ((x: number, z: number) => number) | null = null;
  readonly field: TerrainField;

  constructor(
    private readonly deps: RunDeps,
    readonly config: RunConfig,
    readonly content: ContentDB,
    /** co-op: the world is the host's `CoopHostWorld` / a guest's `MirrorWorld` (both are sim Worlds) */
    readonly coop: CoopRunStart | null = null,
  ) {
    const zone = content.zones.find((z) => z.id === config.zone);
    if (!zone) throw new Error(`zone "${config.zone}" not in content`);
    this.field = createTerrainField(zone.biome, config.seed);
    // bosses pace by their render assets: the intro waits for the model's spawn clip, and a fire breath authored into
    // special1 (GLB extras.breath) plays there (models are loaded before the first tick that can spawn a boss)
    const assets = deps.renderWorld.core.assets;
    const env = {
      ...this.field.env,
      bossModel: (id: string) => ({
        spawn: assets.manifest.models[id]?.clips.spawn?.duration ?? 0,
        breath: assets.isModelLoaded(id) && assets.model(id).extras.breath !== undefined,
      }),
    };
    this.world = coop ? coop.createWorld(config, content, env) : createWorld(config, content, config.meta, env);
    this.feeds = worldFeeds(this.world);
    for (let i = 0; i < this.world.players.length; i++) this.inputs.push({ moveX: 0, moveZ: 0 });
  }

  /** Loads and bakes render assets for this world. */
  async load(heroes: HeroSpec[], onProgress: (fraction: number, label: string) => void): Promise<void> {
    const rw = this.deps.renderWorld;
    // the party's skill effects are lazy chunks (vfx/skills/loader.ts): first, because buildCatalog reads SPEC_REGISTRY. A chunk that cannot be
    // fetched rejects here and App.startRun shows loadFailureMessage + RETRY (the hero-select prefetch usually has it in the cache already)
    await ensureSkillVfx(runSkillClasses(this.world));
    const catalog = buildCatalog(this.world);
    await rw.load(catalog, heroes, (f) => onProgress(f, 'models'));
    if (rw.vfx) configureVfxEvents(rw.vfx.events, this.world);
    const core = rw.core;
    // render biome: the content preset with the zone look's render-only override (fog / sky / sun / ambient / particles)
    const biome = resolveBiome(this.world.zone.id, this.world.zone.biome);
    core.env.setBiome(biome);
    // PL-01: the zone's bloom / vignette / colour grade in the composite pass. This fixes the GRADE define for the whole run (the
    // arc, corruption and vignette pulses only write uniforms later) and starts compiling the composite program now, awaited
    // below before the warm-up: nothing of it links after the loading screen. No zone sets values yet: the neutral grade is an identity.
    this.post = asPostPipeline(core.composer);
    const postReady = this.post?.setZonePost(findLook(this.world.zone.id)?.post);
    applyZoneReadability(this.world.zone.id);
    this.previousHeightAt = core.heightAt;
    core.heightAt = (x, z) => this.field.heightAt(x, z);
    // r7: metin break pieces sink into lava / deep water and out of static bodies instead of resting on them
    this.previousRestAt = core.restAt;
    // r8 M8a: the piece's footprint against the real body circles; the pieces fly round the static bodies and cue their sink into a liquid
    core.restAt = (x, z, r) => metinRestKind(this.field, x, z, r);
    rw.metins.restWorld = metinRestWorld(this.field);
    onProgress(0.9, 'terrain');
    // Optional module: the TERRAIN agent's zone scene. Absent → DEV flat ground.
    const factories = import.meta.glob<{ createZoneScene: ZoneSceneFactory }>('../render/terrain/zoneScene.ts');
    const loadFactory = factories['../render/terrain/zoneScene.ts'];
    if (loadFactory) {
      const { createZoneScene } = await loadFactory();
      const zs = createZoneScene(core, this.field, biome);
      this.zoneScene = zs;
      core.scene.add(zs.group);
      zs.setQuality(core.quality.profile);
      this.offQuality = core.quality.onChange((p) => zs.setQuality(p));
      this.zoneSystem = {
        name: 'zone',
        update: (dt) => {
          const clock = this.arcClock;
          clock.time = this.world.time;
          clock.corruption = this.world.corruption;
          zs.update(dt, core.camera, core.rig.focus, clock);
        },
      };
      core.addSystem(this.zoneSystem);
      await zs.ready;
    } else if (import.meta.env.DEV) {
      // DEV only; runtime-selected so it never reaches production.
      const { createDevGround } = await import('../dev/devGround');
      this.devGround = await createDevGround(core, biome);
      core.scene.add(this.devGround);
    }
    this.syncStyles();
    const p = this.world.players[0];
    if (p) {
      rw.core.rig.setTarget(p.x, rw.core.heightAt(p.x, p.z), p.z);
      rw.core.rig.snap();
    }
    // Put the camera and its focus where the first frame will have them and run the TERRAIN's first update now: it creates the
    // ground chunks (and the far field) lazily, so the warm-up compiles and draws them (before, the terrain's own 1.5 s program
    // compiled inside the first real frame). The other zone systems stay lazy as before: their meshes also feed three's shared
    // shadow depth material, whose program variant depends on the draw order (a pre-warmed prop set linked a new variant, a 300-400 ms
    // stall, the first time a fence reached the shadow pass - measured with step.ts, A1 notes).
    rw.core.rig.update(0);
    this.zoneScene?.systems?.find((s) => s.name === 'terrain')?.update(0, core.camera, core.rig.focus);
    // Shader compiles run in parallel and the warm frames are separate tasks, so the loading screen keeps animating (the old
    // synchronous pass froze the page for 10-14 s in the production build). Same caption as the terrain stage: a stage name
    // without an i18n entry would log a missing-key warning.
    await postReady;
    await rw.warmupAsync((f) => onProgress(0.9 + 0.09 * f, 'terrain'));
    // ambient zone particles (leaves / snow / embers / dust / motes): the zone's loops (biome.particles, then look.ambientLoops: PL-02) for the
    // whole run, each following the camera focus (RenderWorld.setFocus); low keeps only the first loop, a quality change mid-run re-syncs them;
    // RenderWorld.clearRun drops them with the rest of the run's VFX. Their sprites are in the run scope (simFeed.buildCatalog, same list).
    if (rw.vfx) {
      const vfx = rw.vfx;
      this.ambientIds = zoneAmbientLoops(this.world.zone.id, this.world.zone.biome).filter((id) => vfx.has(id));
      this.syncAmbient(p?.x ?? 0, p?.z ?? 0);
      this.offAmbient = core.quality.onChange(() => this.syncAmbient());
    }
    runEvents.runStart(this.world);
    this.pushHud();
    this.syncModal();
  }

  /** One fixed 60 Hz simulation tick. */
  tick(dt: number): void {
    const { world, deps } = this;
    deps.input.sampleMove(this.move);
    const inp = this.inputs[0];
    if (inp) {
      // a guest's pause menu does not stop the shared sim (the hero just stands still while it is open)
      const held = this.coop?.role === 'guest' && deps.store.paused.value;
      const wantAttack = deps.input.consumeAttackRequested();
      const wantCastMask = deps.input.consumeCastMask();
      inp.moveX = held ? 0 : this.move.x;
      inp.moveZ = held ? 0 : this.move.z;
      inp.manualCast = !autoCast.value;
      inp.attack = !held && wantAttack;
      inp.castMask = held ? 0 : wantCastMask;
      inp.aimX = undefined;
      inp.aimZ = undefined;
      if (!held && !deps.renderWorld.core.isMobile) {
        // Always resolve cursor world direction when a desktop mouse pointer is present so LMB, Space, and 1-8 aim where the player points.
        const ptr = deps.input.pointerClient();
        const p0 = world.players[0];
        if (ptr && p0) {
          const core = deps.renderWorld.core;
          const rect = core.renderer.domElement.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            const ndcX = ((ptr.x - rect.left) / rect.width) * 2 - 1;
            const ndcY = -((ptr.y - rect.top) / rect.height) * 2 + 1;
            const cam = core.camera;
            this.aimOrigin.setFromMatrixPosition(cam.matrixWorld);
            this.aimRay.set(ndcX, ndcY, 0.5).unproject(cam).sub(this.aimOrigin);
            if (Math.abs(this.aimRay.y) > 1e-4) {
              const planeY = core.heightAt(p0.x, p0.z);
              const tHit = (planeY - this.aimOrigin.y) / this.aimRay.y;
              if (tHit > 0) {
                const wx = this.aimOrigin.x + this.aimRay.x * tHit;
                const wz = this.aimOrigin.z + this.aimRay.z * tHit;
                const dx = wx - p0.x;
                const dz = wz - p0.z;
                const len = Math.hypot(dx, dz);
                if (len > 0.08) {
                  inp.aimX = dx / len;
                  inp.aimZ = dz / len;
                }
              }
            }
          }
        }
      }
    }
    world.step(this.inputs);
    deps.renderWorld.vfx?.handleEvents(world.events);
    runEvents.dispatch(world.events, world);
    this.syncModal();
    void dt;
  }

  /** Once per rendered frame. */
  frame(alpha: number, rawDt: number): void {
    const rw = this.deps.renderWorld;
    if (this.syncStyles()) {
      /* the fx system picks the table up through RenderWorld.fx.projectiles when present */
      rw.setProjectileStyles(this.styles.table);
    }
    this.hudAcc += rawDt;
    const hudInterval = rw.core.isMobile ? HUD_INTERVAL_MOBILE : HUD_INTERVAL;
    if (this.hudAcc >= hudInterval) {
      this.hudAcc = 0;
      this.pushHud();
    }
    // The load-time warm-up does not reach every program (stone/sprite programs only compile once the scene has rendered
    // real frames); a second pass a few frames in, still behind the intro modal, removes the first-metin hitch.
    if (this.warmLeft > 0 && --this.warmLeft === 0) rw.warmup();
    if (rw.vfx) {
      this.skillVfx.update(this.world, rw.vfx, alpha, rw.core.heightAt);
      this.statusVfx.update(this.world, rw.vfx, alpha, rw.core.heightAt);
      this.footDust.update(this.world, rw.vfx, alpha, rw.core.heightAt);
    }
    rw.frame(this.feeds, rawDt, alpha);
  }

  get modalOpen(): boolean {
    return this.world.modal !== null;
  }

  /** Final result (valid once `world.over`). */
  result(victory = false): RunResult {
    return this.world.result ?? this.world.buildResult(victory);
  }

  /**
   * PL-02: makes the ambient loops alive match the quality tier: spawns the ones the tier wants and the run does not have yet, stops (graceful
   * fade) the ones it no longer wants. Called once at load (at the hero) and on every tier change (at the camera focus).
   */
  private syncAmbient(x?: number, z?: number): void {
    const rw = this.deps.renderWorld;
    const vfx = rw.vfx;
    if (!vfx || this.disposed) return;
    const want = ambientLoopsForTier(this.ambientIds, rw.core.quality.tier);
    for (let i = this.ambientLive.length - 1; i >= 0; i--) {
      const live = this.ambientLive[i] as { id: string; handle: number };
      if (want.includes(live.id)) continue;
      vfx.stop(live.handle);
      this.ambientLive.splice(i, 1);
    }
    const focus = rw.core.rig.focus;
    for (const id of want) {
      if (this.ambientLive.some((l) => l.id === id)) continue;
      const handle = vfx.spawn(id, { x: x ?? focus.x, z: z ?? focus.z, scale: AMBIENT_RADIUS, duration: AMBIENT_FOREVER });
      if (handle !== 0) this.ambientLive.push({ id, handle });
    }
  }

  private syncStyles(): boolean {
    return this.styles.sync(this.world);
  }

  private pushHud(): void {
    this.deps.store.setHud(this.world.hud(0));
  }

  private syncModal(): void {
    const m = this.world.modal;
    this.deps.store.setSimModal(m);
    this.deps.input.movementEnabled =
      this.deps.store.screen.value === 'run' && this.deps.store.modal.value === null && m === null && !this.deps.store.contextLost.value;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    runEvents.runEnd(this.world);
    this.offAmbient?.();
    this.offAmbient = null;
    this.ambientLive.length = 0;
    this.deps.renderWorld.clearRun();
    this.deps.renderWorld.crowd.releaseRun(); // baked crowd textures + batches: GPU memory must not outlive the run
    // the VFX event adapter outlives the run: drop its rank/caster lookup, a closure over this run's skill feed and world
    this.deps.renderWorld.vfx?.setSkillMeta?.(null);
    const core = this.deps.renderWorld.core;
    if (this.devGround) {
      core.scene.remove(this.devGround);
      this.devGround = null;
    }
    if (this.zoneScene) {
      this.offQuality?.();
      if (this.zoneSystem) core.removeSystem(this.zoneSystem);
      core.scene.remove(this.zoneScene.group);
      this.zoneScene.dispose();
      this.zoneScene = null;
    }
    if (this.previousHeightAt) core.heightAt = this.previousHeightAt;
    if (this.previousRestAt) core.restAt = this.previousRestAt;
    this.deps.renderWorld.metins.restWorld = null;
    // PL-01: back to the menu's composite (no grade define, today's bloom / vignette numbers, a pulse in flight dropped)
    this.post?.setZonePost(null);
    this.post = null;
    // three keeps the last frame's render items (object + material per draw) per scene until that scene renders again, which
    // is the next run: the zone's terrain material's onBeforeCompile closure alone kept this run's TerrainField (~6 MB) alive
    core.renderer.renderLists?.dispose();
    this.deps.store.setHud(null);
    this.deps.store.setSimModal(null);
    this.deps.input.movementEnabled = false;
  }
}
