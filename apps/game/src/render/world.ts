// RenderWorld: composes every render system for the app and feeds them from the sim's read-only views.
// Persistent for the page lifetime; `load()` prepares a run, `clearRun()` tears its content down.
import { WebGLRenderTarget, type Object3D } from 'three';
import type { RenderCore, RenderSystem } from './core';
import type { ProjectileStyleDef, RenderCatalog, RenderFeeds } from './feed';
import { CrowdRenderer } from './crowd/crowd';
import { DamageNumbers } from './fx/damageNumbers';
import { BEACON_ALLY_HEX, GroundRings } from './fx/groundRings';
import { Pickups } from './fx/pickups';
import { Projectiles } from './fx/projectiles';
import { Telegraphs } from './fx/telegraphs';
import { Heroes } from './hero';
import { MetinViews } from './metin';
import { PerfOverlay } from './perf';
import { PostPipeline } from './post';
import { lazyContent } from './payloadPolicy';
import { compileInSlices, eagerStreamTypes, primeZoneSystem, warmupPass, warmupPassSync } from './warmupPass';
import { VfxSystem } from '../vfx';
import { SET_FLOATS } from '../vfx/spec/sockets';
import { worldUniforms } from './terrain/zoneContext';

export interface HeroSpec {
  modelId: string;
  weaponId?: string;
  /** doctrine B: play the `<clip>_b` animation variants */
  styleB?: boolean;
}

/**
 * FEEL-02: the render-time clock of a hit-stop (app/renderEvents.ts HitStop). `scale(rawDt)` is called once per rendered frame and returns the
 * multiplier of this frame's dt for the systems that take the held dt: 1 outside a hit-stop, down to 0.05 inside.
 *
 * What a hold freezes (measured against the code, not the crowd as a whole):
 *  - the corpses of the crowd: their death clip and dissolve age (`cAge` in crowd.update);
 *  - the streaming clocks of the crowd and the metins (`pumpStream`): a hold delays the background model streaming by the summed hold time,
 *    about 3 s per run, harmless against the 60-120 s stream leads;
 *  - the hero mixers (render/hero.ts), but only while no hero is walking (see `heroHoldScale`), so a hero never slides in a frozen pose;
 *  - the metin stones' own clock (glow, break pieces) and the VFX (`vfx.update`).
 * What it does NOT freeze: the LIVING enemies. Their pose and hit flash are sampled from the sim's feed (`feed.animT` / `feed.flash`,
 * crowd.ts), which keeps ticking, so the crowd keeps moving around a held corpse and a held effect - the contrast is what gives the kill its weight.
 * The sim, the camera (shake included), the terrain and the damage numbers never see the hold.
 */
export interface HitStopClock {
  scale(rawDt: number): number;
  reset(): void;
}

export interface RenderWorldOptions {
  /** HDR + bloom + vignette pipeline (default true) */
  post?: boolean;
  /** VFX package (default true) */
  vfx?: boolean;
}

/**
 * DEV / QA only (never in a production build): `?up=noprime` skips the zone priming of the warm-up, to A/B the load time and the first-frame
 * links of PERF-01 on one machine in one go (shot.ts --query up=noprime, trace.ts --query up=noprime). Same family as `up=noarc,nocorr`.
 */
function primeDisabled(): boolean {
  return import.meta.env.DEV && typeof location !== 'undefined' && /[?&]up=(?:[^&]*,)?noprime(?:,|&|$)/.test(location.search);
}

/** a hero faster than this (m/s) is walking: the run cycle plays (render/hero.ts driveAnimation uses the same limit) */
const HERO_WALK_SPEED = 0.4;

/**
 * FEEL-02: the dt multiplier of the hero views during a hit-stop. The hero's position follows the sim and the player's input, so a mixer held
 * at 5 % while the hero keeps moving would slide it along in a frozen pose: the hero views take the hold only while no living hero walks (the
 * attack beat of a standing hero still lands), and run at full speed otherwise.
 */
export function heroHoldScale(hold: number, players: ReadonlyArray<{ speed: number; dead: boolean } | undefined>): number {
  if (hold >= 1) return 1;
  for (const p of players) if (p && !p.dead && p.speed > HERO_WALK_SPEED) return 1;
  return hold;
}

export class RenderWorld {
  readonly crowd: CrowdRenderer;
  readonly heroes: Heroes;
  readonly metins: MetinViews;
  readonly perf: PerfOverlay;
  readonly damage: DamageNumbers;
  readonly telegraphs: Telegraphs;
  readonly rings: GroundRings;
  readonly projectiles: Projectiles;
  readonly pickups: Pickups;
  readonly vfx: VfxSystem | null;
  catalog: RenderCatalog | null = null;
  /** FEEL-02: set by the RenderEventRouter; null = no hit-stop (menu previews, demos) */
  hitStop: HitStopClock | null = null;
  /** this frame's dt multiplier of the held systems (1 = no hit-stop); written once per frame before the systems update */
  private hold = 1;
  /** the same for the hero views: `hold`, except 1 while a hero is walking (heroHoldScale) */
  private heroHold = 1;

  private readonly vfxSystem: RenderSystem | null;
  /** the HDR post pipeline (null without post): its scene pass is what streamed materials are compiled for */
  private post: PostPipeline | null = null;
  /** 1x1 stand-in for the pipeline's scene target while a material compiles (programs are keyed by the bound target) */
  private compileTarget: WebGLRenderTarget | null = null;
  private readonly systems: RenderSystem[] = [];
  private readonly offQuality: (() => void) | null;
  private readonly offContextRestored: (() => void) | null;
  /** scratch for the per-frame hero socket feed (vfx/spec/sockets.ts layout) */
  private readonly sockBuf = new Float32Array(SET_FLOATS);

  constructor(
    readonly core: RenderCore,
    opts: RenderWorldOptions = {},
  ) {
    this.crowd = new CrowdRenderer(core);
    this.crowd.deferBlobEnd = true;
    this.heroes = new Heroes(core);
    this.metins = new MetinViews(core);
    this.heroes.blobs = this.crowd.blobs;
    this.metins.blobs = this.crowd.blobs;
    this.perf = new PerfOverlay(core);
    this.rings = new GroundRings(core);
    this.telegraphs = new Telegraphs(core);
    this.projectiles = new Projectiles(core);
    this.pickups = new Pickups(core);
    this.damage = new DamageNumbers(core);
    this.crowd.eliteSink = (x, z, r, tier) => this.rings.add(x, z, r, tier >= 3 ? 'boss' : tier === 2 ? 'champion' : 'elite');
    this.crowd.warmSink = (mesh) => this.compileAhead(mesh);
    this.metins.warmSink = (obj) => this.compileAhead(obj);

    // Order: the crowd resets the blob batch each frame, heroes/metins then append to it, and blobFlush submits the combined
    // batch to the GPU once all three have written; rings are flushed in their update.
    // (corpses / stream clocks, hero mixers and metin stones take the hit-stop dt, FEEL-02: the wrapper scales only the dt, the systems are untouched)
    const blobFlush: RenderSystem = {
      name: 'blobFlush',
      update: () => this.crowd.blobs.end(),
      dispose: () => undefined,
    };
    this.systems.push(
      this.held(this.crowd),
      this.held(this.heroes, () => this.heroHold),
      this.held(this.metins),
      blobFlush,
      this.telegraphs,
      this.rings,
      this.projectiles,
      this.pickups,
    );
    if (opts.vfx !== false) {
      const vfx = new VfxSystem(core.scene, core.camera, core.renderer, core.quality.tier, {
        heightAt: (x, z) => core.heightAt(x, z),
        onShake: (a) => core.rig.addTrauma(a),
      });
      this.vfx = vfx;
      // boss breath cones leave the drawn mouth (the crowd's baked `muzzle` socket), not the boss's feet
      vfx.events.breathOrigin = (x, z, out) => {
        const row = this.crowd.bossAt(x, z);
        return row >= 0 && this.crowd.socketWorld(row, 'muzzle', out);
      };
      // live boss position for phase / enrage bursts (the nearest eliteTier-3 row, not the point cached at spawn)
      vfx.events.bossOrigin = (x, z, out) => {
        const feed = this.crowd.feed;
        if (!feed) return false;
        let best = -1;
        let bestSq = Infinity;
        for (let i = 0; i < feed.count; i++) {
          if (feed.eliteTier[i] !== 3) continue;
          const dx = (feed.x[i] as number) - x;
          const dz = (feed.z[i] as number) - z;
          const d = dx * dx + dz * dz;
          if (d < bestSq) {
            bestSq = d;
            best = i;
          }
        }
        if (best < 0) return false;
        out.x = feed.x[best] as number;
        out.z = feed.z[best] as number;
        out.y = this.core.heightAt(out.x, out.z);
        return true;
      };
      // heroes animate before the VFX in the system list: feed their body sockets (hands, blade tip …) for socket-anchored
      // skill elements and weapon trails right before the VFX update, so nothing lags the animation by a frame
      this.vfxSystem = {
        name: 'vfx',
        update: (dt) => {
          this.feedSockets(vfx);
          vfx.update(dt * this.hold);
        },
        dispose: () => vfx.dispose(),
      };
      this.systems.push(this.vfxSystem);
      this.offQuality = core.quality.onChange((p) => vfx.setQuality(p.tier));
      // DEV only: window.__ms.vfx stage hooks (spawnNow / event / step) for QA captures (tools/qa/vfxstage.ts)
      if (import.meta.env.DEV) void import('../vfx/dev/stage').then((m) => m.installVfxDevHooks(this));
    } else {
      this.vfx = null;
      this.vfxSystem = null;
      this.offQuality = null;
    }
    this.systems.push(this.damage);
    for (const s of this.systems) core.addSystem(s);
    // DEV console: a program that links after the load-time warm-up, with the stall it cost (the F3 overlay and the QA traces read `perf.programs.late`)
    if (import.meta.env.DEV) {
      this.perf.programs.onLate = (p) => console.info(`[late-program] ${p.name} #${p.id} stalled a frame ${p.frameMs} ms`);
    }
    if (opts.post !== false) {
      this.post = new PostPipeline(core.renderer, core.quality);
      core.setComposer(this.post);
    }
    this.offContextRestored =
      typeof core.onContextRestored === 'function'
        ? core.onContextRestored(() => {
            this.compileTarget?.dispose();
            this.compileTarget = null;
            this.vfx?.onContextRestored();
          })
        : null;
  }

  /** FEEL-02: `sys` with its dt multiplied by the hit-stop scale of the frame (1 outside a hit-stop, so the dt is bit-identical to before). */
  private held(sys: RenderSystem, scale: () => number = () => this.hold): RenderSystem {
    return {
      name: sys.name,
      update: (dt, alpha) => sys.update(dt * scale(), alpha),
      onResize: sys.onResize ? (w, h, pr) => sys.onResize?.(w, h, pr) : undefined,
      dispose: sys.dispose ? () => sys.dispose?.() : undefined,
    };
  }

  /** Loads and bakes every model the run needs. */
  async load(catalog: RenderCatalog, heroes: HeroSpec[], onProgress?: (fraction: number) => void): Promise<void> {
    this.catalog = catalog;
    onProgress?.(0);
    await this.crowd.load(catalog.enemyTypes, catalog.enemyUsed, (f) => onProgress?.(f * 0.6), catalog.enemyLater);
    // the dev server has no streaming: its Great Metin loads (and warms) with the run, like everything else (see eagerStreamTypes)
    await Promise.all([this.metins.load(eagerStreamTypes(catalog.metinTypes, lazyContent())), this.pickups.load()]);
    onProgress?.(0.7);
    this.projectiles.setStyles(catalog.projectileStyles);
    let i = 0;
    for (const h of heroes) {
      await this.heroes.setHero(i++, h.modelId, h.weaponId, h.styleB);
      onProgress?.(0.7 + (0.3 * i) / heroes.length);
    }
    // generated sprites of the skill specs (art roles) are packed while the loading screen is up: no pop-in; a missing
    // sprite only warns and keeps its procedural fallback, it never fails the run load. A run packs only the specs its
    // heroes can spawn (catalog.vfxSpecs: their class + doctrine, the common pool, the common effects) within the
    // tier's VRAM budget; a catalog without the list (demos) packs everything. With `vfxTiers` (production) only the first
    // seconds' sprites are awaited here; the rest of the scope streams in behind the HUD (vfx/spec/artTier.ts)
    if (this.vfx) {
      try {
        await this.vfx.preloadArt(this.core.assets, catalog.vfxSpecs, catalog.vfxTiers);
      } catch (err) {
        console.warn('[vfx] art preload failed:', err);
      }
    }
  }

  /**
   * Starts compiling `obj`'s materials without blocking the frame (KHR_parallel_shader_compile through compileAsync) so its
   * first draw finds the program ready. Programs are keyed by the bound render target (colour space + tone mapping), and the
   * HDR pipeline draws the scene into a linear target: compile with a stand-in target bound, exactly like that pass.
   */
  private compileAhead(obj: Object3D): Promise<unknown> | void {
    const r = this.core.renderer;
    if (typeof r.compileAsync !== 'function') return;
    const hdr = this.post?.active === true;
    const prev = r.getRenderTarget();
    if (hdr) r.setRenderTarget((this.compileTarget ??= new WebGLRenderTarget(1, 1)));
    try {
      return r.compileAsync(obj, this.core.rig.camera, this.core.scene);
    } finally {
      if (hdr) r.setRenderTarget(prev);
    }
  }

  private feedSockets(vfx: VfxSystem): void {
    const views = this.heroes.views;
    for (let i = 0; i < views.length && i < 4; i++) {
      const v = views[i];
      if (v && v.sockets(this.sockBuf)) vfx.setSockets(i, this.sockBuf);
    }
  }

  /**
   * Starts the parallel compile (KHR_parallel_shader_compile) of every material in the scene, in slices that give the event loop
   * a turn, and resolves when all programs are ready. Programs are keyed by the bound target and the scene's lights / fog /
   * shadow set-up, which `compileAhead` reproduces (HDR stand-in target, the real scene as the target scene), so the warm
   * frames and the first real frames find them linked. Objects that only exist after a frame ran (lazy chunks) are not here.
   */
  private compileScene(turn: () => Promise<void>): Promise<void> {
    if (typeof this.core.renderer.compileAsync !== 'function') return Promise.resolve();
    return compileInSlices(this.core.scene, (batch) => this.compileAhead(batch), turn);
  }

  /**
   * Compiles every shader program the run will use while the loading screen is still up (details: render/warmupPass.ts): the
   * programs compile in parallel first, then pooled/hidden meshes are shown and frustum culling is off for two real frames
   * through the actual composer path, one task each. The loading screen keeps animating (the event loop gets a turn between the
   * slices); `onProgress` reports 0..1.
   */
  async warmupAsync(onProgress?: (fraction: number) => void): Promise<void> {
    // `prime`: the zone system's first update runs now, so the vegetation / props it creates lazily are compiled and drawn under the
    // loading screen too (before: treeBark, treeFoliage and a batched depth variant linked inside the first real frame, 233-391 ms)
    await warmupPass(this.core, this.metins.addWarmSlots(), { compile: (turn) => this.compileScene(turn), onProgress, prime: primeDisabled() ? undefined : () => primeZoneSystem(this.core) });
    // what is linked now is the load-time set: the F3 readout and the late-link list count from here (PERF-01)
    this.perf.programs.markLoaded();
  }

  /** The same pass in one synchronous task (the frame-4 re-warm behind the intro modal, the dev demos). */
  warmup(): void {
    warmupPassSync(this.core, this.metins.addWarmSlots());
    this.perf.programs.markLoaded();
  }

  /** Renders one frame. `rawDt` = real frame time (s), `alpha` = sim interpolation. */
  frame(feeds: RenderFeeds, rawDt: number, alpha: number): void {
    const core = this.core;
    this.crowd.feed = feeds.enemies;
    this.heroes.players = feeds.players;
    this.metins.feed = feeds.metins ?? null;
    this.telegraphs.feed = feeds.telegraphs ?? null;
    this.projectiles.feed = feeds.projectiles ?? null;
    this.pickups.feed = feeds.pickups ?? null;
    const vfx = this.vfx;
    const players = feeds.players;
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      if (!p) continue;
      const x = p.px + (p.x - p.px) * alpha;
      const z = p.pz + (p.z - p.pz) * alpha;
      const y = core.heightAt(x, z);
      if (i === 0) {
        const hasVel = typeof p.vx === 'number' && typeof p.vz === 'number' && p.vx * p.vx + p.vz * p.vz > 0.16;
        const mdx = hasVel ? (p.vx as number) : p.x - p.px;
        const mdz = hasVel ? (p.vz as number) : p.z - p.pz;
        const md = Math.hypot(mdx, mdz);
        const vx = md > 1e-4 ? (mdx / md) * p.speed : Math.sin(p.rot) * p.speed;
        const vz = md > 1e-4 ? (mdz / md) * p.speed : Math.cos(p.rot) * p.speed;
        core.rig.setTarget(x, y, z, vx, vz);
        this.damage.setHero(x, z, !p.dead);
      }
      // slot 0 = the local hero on every client (gold ring); every other co-op hero carries the ally colour (azure ring, ringLook swaps the gold)
      if (!p.dead) this.rings.add(x, z, 1.05, 'hero', 1, i === 0 ? undefined : BEACON_ALLY_HEX, p.rot);
      // FEEL-01: while a crowd stands on the hero (>= 6 creatures within 3 m, a full world, held 0.5 s) its ring is drawn a second time over the
      // enemies plus a chevron over the head (render/fx/groundRings.ts beacon: depth test off, stencil-masked against the hero, the ring thinner /
      // fainter under a telegraph); a dead hero fades it out. Slot 0 = the local hero (gold), every other co-op hero is azure on every client.
      this.rings.beacon(i, x, z, p.rot, feeds.enemies, feeds.telegraphs, !p.dead);
      vfx?.setPlayer(i, x, z, y);
    }
    // r8 Z8: the ground cover draws no tuft on a living metin's rune carpet (0.28 x its aura radius, render/fx/rings/metin.ts, plus the glow)
    const clears = worldUniforms.uCoverClear.value;
    let nClear = 0;
    if (feeds.metins && this.catalog) {
      for (const m of feeds.metins) {
        if (m.phase === 0 || m.phase === 3) continue;
        const rune = this.catalog.metinTypes[m.type]?.rune;
        this.rings.add(m.x, m.z, m.auraRadius, 'metin', m.phase === 2 ? 1.4 : 1, rune);
        if (nClear < clears.length) (clears[nClear++] as (typeof clears)[number]).set(m.x, m.z, 0.28 * m.auraRadius + 0.45, 0);
      }
    }
    for (let i = nClear; i < clears.length; i++) (clears[i] as (typeof clears)[number]).z = 0;
    vfx?.setFocus(core.rig.focus.x, core.rig.focus.z, core.rig.focus.y);
    core.rig.setBossFraming(this.crowd.bossHeight);
    // FEEL-02: one clock read per frame; core.frame still gets the real dt (camera, terrain, governor), only the held systems scale theirs
    this.hold = this.hitStop ? this.hitStop.scale(rawDt) : 1;
    this.heroHold = heroHoldScale(this.hold, players);
    // PERF-01: the render time is measured here, around the work that links programs; `rawDt` is the gap BEFORE this frame, so a link of this
    // render only shows in the next frame's gap (ProgramWatch stamps a program with the larger of the two)
    const t0 = performance.now();
    core.frame(rawDt, alpha);
    this.perf.frame(rawDt * 1000, performance.now() - t0);
  }

  /** Adds a killed enemy's corpse (death clip + dissolve). */
  enemyDied(type: number, x: number, z: number, rot: number, scale: number): void {
    this.crowd.addCorpse(type, x, z, rot, scale);
  }

  /** Style table indexed by the sim's interned vfx-name ids (grows during a run). */
  setProjectileStyles(table: ProjectileStyleDef[]): void {
    this.projectiles.setStyles(table);
  }

  shake(amount: number): void {
    this.core.rig.addTrauma(amount);
  }

  /** Drops everything that belongs to the finished run (keeps systems alive for the next one). */
  clearRun(): void {
    this.hold = 1;
    this.heroHold = 1;
    this.hitStop?.reset();
    this.rings.clearBeacons();
    this.crowd.clearCorpses();
    this.crowd.feed = null;
    this.metins.feed = null;
    this.telegraphs.feed = null;
    this.projectiles.feed = null;
    this.pickups.feed = null;
    this.heroes.clear();
    this.damage.clear();
    this.vfx?.clear();
  }

  dispose(): void {
    this.offContextRestored?.();
    this.offQuality?.();
    this.perf.dispose();
    this.compileTarget?.dispose();
    this.compileTarget = null;
    for (const s of this.systems) {
      this.core.removeSystem(s);
      s.dispose?.();
    }
    this.systems.length = 0;
  }
}
