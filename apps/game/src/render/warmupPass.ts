// The load-time warm-up pass (RenderWorld.warmup / warmupAsync delegate here; split out so it is testable without the render stack).
import { Group, type InstancedMesh, type Object3D } from 'three';
import { ESTABLISHING_POSE, FLY_IN_SECONDS } from './camera';
import type { RenderCore } from './core';

export type WarmCore = Pick<RenderCore, 'scene' | 'composer' | 'renderer' | 'rig' | 'quality' | 'env'>;

export interface WarmupOptions {
  /**
   * Builds the content a run only creates on its first rendered frame, so the compile and the warm frames below cover it (PERF-01):
   * RenderWorld passes the zone system's first update (vegetation BatchedMeshes, props), which used to link `treeBark`, `treeFoliage`
   * and the batched shadow-depth variant inside the first real frame (233-391 ms behind the story card). Runs once, first, after the
   * shadow frustum sits on the hero; a throw only skips the priming (the warm-up goes on without it).
   */
  prime?: () => void;
  /**
   * Starts the shader compiles of everything drawable in the scene without blocking (KHR_parallel_shader_compile, see
   * RenderWorld.compileScene) and resolves once the programs are ready. It runs BEFORE the scene is prepared for the warm
   * frames and never changes the scene, and it may yield through the `turn` it is handed. Without it (tests, no extension) the
   * warm frames compile everything synchronously, as before.
   */
  compile?: (turn: () => Promise<void>) => Promise<unknown>;
  /** gives the event loop a turn between two slices (default: a macrotask, and a paint turn about every 90 ms of work) */
  turn?: () => Promise<void>;
  /** 0..1 over the whole pass */
  onProgress?: (fraction: number) => void;
  /** number of warm frames (default 2) */
  frames?: number;
  /** most drawables (meshes, sprites, points, lines) one slice of a warm frame draws (default 36); 0 = the whole scene in one slice */
  sliceSize?: number;
}

/**
 * The dev server (no payload policy, render/payloadPolicy.ts `lazyContent()`) loads everything with the run, so a QA capture or a
 * jump of the run clock finds the whole content in place. A catalog still marks some types `load: 'stream'` (the zone's Great Metin
 * is due at the final wave), which on the dev server meant: nothing is fetched until the stream clock reaches it, and a clock jump
 * (`shot.ts --time 896`, `world.time = 860`) draws it for the first time inside a frame - the model, its textures (260 ms on a loaded
 * machine) and its shader link (160-320 ms) land in one 0.4-0.6 s frame. Without streaming such a type loads with the run, so the
 * load-time warm-up compiles and draws it. A production build (`lazy` true) keeps the catalog as it is.
 */
export function eagerStreamTypes<T extends object>(types: readonly T[], lazy: boolean): T[] {
  if (lazy) return types.slice();
  return types.map((t) => ((t as { load?: string }).load === 'stream' ? { ...t, load: 'now' } : t));
}

/** A macrotask: input and timers run, the compositor gets its turn, and unlike a timer it is not throttled in a hidden tab. */
export function messageTurn(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof MessageChannel === 'undefined') {
      setTimeout(resolve, 0);
      return;
    }
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      resolve();
    };
    ch.port2.postMessage(0);
  });
}

/**
 * Lets the page paint (the loading screen keeps animating while the warm-up works): resolves at the next animation frame, or
 * after 100 ms when frames are not delivered, and plainly at the next macrotask while the tab is hidden.
 */
export function paintTurn(): Promise<void> {
  if (typeof document === 'undefined' || document.hidden || typeof requestAnimationFrame !== 'function') return messageTurn();
  return new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      resolve();
    };
    requestAnimationFrame(finish);
    setTimeout(finish, 100);
  });
}

/** The default pacing: a macrotask between slices, a real paint turn whenever ~90 ms of work went by since the last one. */
function makePacer(): () => Promise<void> {
  let lastPaint = typeof performance !== 'undefined' ? performance.now() : 0;
  return () => {
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    if (now - lastPaint < 90) return messageTurn();
    return paintTurn().then(() => {
      lastPaint = typeof performance !== 'undefined' ? performance.now() : 0;
    });
  };
}

function mark(name: string): void {
  if (typeof performance !== 'undefined' && typeof performance.mark === 'function') performance.mark(name);
}

interface DrawableFlags {
  isMesh?: boolean;
  isLine?: boolean;
  isPoints?: boolean;
  isSprite?: boolean;
  isLight?: boolean;
}

const drawable = (o: Object3D): boolean => {
  const d = o as Object3D & DrawableFlags;
  return d.isMesh === true || d.isLine === true || d.isPoints === true || d.isSprite === true;
};

const isLight = (o: Object3D): boolean => (o as Object3D & DrawableFlags).isLight === true;

const holdsLight = (root: Object3D): boolean => {
  let found = false;
  root.traverse((o) => {
    if (isLight(o)) found = true;
  });
  return found;
};

const drawables = (root: Object3D): number => {
  let n = 0;
  root.traverse((o) => {
    if (drawable(o)) n++;
  });
  return n;
};

/** objects handed to one compile call while a scene is compiled in slices */
const COMPILE_BATCH = 192;
/** main-thread budget (ms) of one compile slice before the event loop gets a turn: the sync part of compileAsync (program parameters, shader sources, the links) */
const COMPILE_SLICE_MS = 30;

/**
 * A shallow list of drawable objects, passed to renderer.compileAsync as the "scene" to compile: three only calls `traverse`
 * (materials) and `traverseVisible` (lights, which the real scene already provides as the target scene) on it, so the batch
 * compiles exactly those objects with the real scene's lights, fog and shadow set-up, without re-parenting anything.
 */
export class CompileBatch extends Group {
  items: Object3D[] = [];
  override traverse(callback: (object: Object3D) => unknown): void {
    for (const o of this.items) callback(o);
  }
  override traverseVisible(_callback?: (object: Object3D) => unknown): void {
    /* the target scene's lights are already collected */
  }
}

/**
 * Hands every drawable of `scene` (hidden and pooled ones included) to `compileOne` in batches, giving the event loop a `turn`
 * whenever ~`sliceMs` of main-thread work went by, and resolves when everything `compileOne` started is ready. `compileOne` is
 * RenderWorld.compileAhead (renderer.compileAsync with the HDR stand-in target bound): the programs link on the driver's worker
 * threads while the main thread keeps running.
 */
export async function compileInSlices(
  scene: Object3D,
  compileOne: (batch: CompileBatch) => Promise<unknown> | void,
  turn: () => Promise<void>,
  opts: { batch?: number; sliceMs?: number; now?: () => number } = {},
): Promise<void> {
  const size = opts.batch ?? COMPILE_BATCH;
  const sliceMs = opts.sliceMs ?? COMPILE_SLICE_MS;
  const now = opts.now ?? (() => performance.now());
  const objs: Object3D[] = [];
  scene.traverse((o) => {
    if (drawable(o)) objs.push(o);
  });
  const ready: Promise<unknown>[] = [];
  let sliceStart = now();
  for (let i = 0; i < objs.length; i += size) {
    const batch = new CompileBatch();
    batch.items = objs.slice(i, i + size);
    const p = compileOne(batch);
    if (p) ready.push(p);
    if (now() - sliceStart >= sliceMs) {
      await turn();
      sliceStart = now();
    }
  }
  await Promise.all(ready);
}

/**
 * Splits the scene's drawable content into slices of at most about `sliceSize` drawables. A unit is a subtree that is drawn as a
 * whole: a drawable object (with whatever hangs under it), or a container (Group, Object3D) that is small enough; heavier
 * containers are opened up. Lights are never part of a unit - they stay in the scene for every slice, so the light state (and
 * with it every program key) is the one the real frames have.
 */
export function planWarmSlices(scene: Object3D, sliceSize: number): Object3D[][] {
  const units: { root: Object3D; weight: number }[] = [];
  const visit = (o: Object3D): void => {
    if (isLight(o)) return;
    const weight = drawables(o);
    if (weight === 0) return;
    // a container holding a light is never a unit (hiding it for the other slices would change their light state)
    if (drawable(o) || (!holdsLight(o) && (weight <= sliceSize || o.children.length === 0))) {
      units.push({ root: o, weight });
      return;
    }
    for (const c of o.children) visit(c);
  };
  for (const c of scene.children) visit(c);
  const slices: Object3D[][] = [];
  let cur: Object3D[] = [];
  let curWeight = 0;
  for (const u of units) {
    if (cur.length > 0 && curWeight + u.weight > sliceSize) {
      slices.push(cur);
      cur = [];
      curWeight = 0;
    }
    cur.push(u.root);
    curWeight += u.weight;
  }
  if (cur.length > 0) slices.push(cur);
  return slices;
}

/**
 * One warm frame (or one slice of it): every hidden / pooled object is shown and frustum culling is off for the pass, then
 * the actual composer path renders, then everything is put back (also when the frame throws). It is synchronous on purpose:
 * the scene is in its prepared state only inside this call, so no other frame can ever draw a half-prepared scene.
 *
 * The main pass draws only what the camera sees and the shadow pass only the casters inside the sun's frustum, so a prop,
 * tree or weapon that first comes into view while playing used to pay the driver's first-draw cost of its program x
 * vertex-format variant there (ANGLE/D3D11 builds that variant at the first draw, not at link time: a 645 ms stall on the
 * depth draw of `prop_banner_pole` on a loaded machine, the 45-50 ms "first combat" link of the hero's weapon depth
 * program on a quiet one). So frustum culling is switched off for the warm frames - one of everything is drawn, in both
 * passes.
 *
 * `units` (from planWarmSlices) limits the frame to those subtrees: every other unit is hidden for the call. Without it the
 * whole scene is drawn.
 */
export function warmFrame(core: WarmCore, units?: { show: Object3D[]; hide: Object3D[] }): void {
  const hidden: { visible: boolean }[] = [];
  const emptied: InstancedMesh[] = [];
  const unculled: Object3D[] = [];
  const away: Object3D[] = [];
  const prepare = (o: Object3D): void => {
    if (!o.visible) {
      hidden.push(o);
      o.visible = true;
    }
    const im = o as InstancedMesh;
    if (im.isInstancedMesh && im.count === 0) {
      emptied.push(im);
      im.count = 1;
    }
    if (o.frustumCulled && drawable(o)) {
      unculled.push(o);
      o.frustumCulled = false;
    }
  };
  try {
    if (units) {
      for (const u of units.hide) {
        if (u.visible) {
          away.push(u);
          u.visible = false;
        }
      }
      for (const u of units.show) {
        // a unit under a hidden container (a pooled group) needs the container visible, too
        for (let p = u.parent; p && p !== core.scene; p = p.parent) {
          if (!p.visible) {
            hidden.push(p);
            p.visible = true;
          }
        }
        u.traverse(prepare);
      }
    } else {
      core.scene.traverse(prepare);
    }
    if (core.composer) core.composer.render(core.scene, core.rig.camera, 0);
    else core.renderer.render(core.scene, core.rig.camera);
  } finally {
    for (const o of hidden) o.visible = false;
    for (const im of emptied) im.count = 0;
    for (const o of unculled) o.frustumCulled = true;
    for (const o of away) o.visible = true;
  }
}

/**
 * The zone system's first update, called under the loading screen (the `prime` of the warm-up). Looks the system up by name in the
 * render core's list (RenderCore keeps it private; run.ts registers the zone as 'zone'), and runs its update with dt 0 - the same call
 * the first rendered frame makes, minus the time step. Returns whether a zone system was found. Calling it more than once is fine.
 */
export function primeZoneSystem(core: unknown): boolean {
  const systems = (core as { systems?: readonly { name: string; update(dt: number, alpha: number): void }[] }).systems;
  const zone = systems?.find((s) => s.name === 'zone');
  if (!zone) return false;
  zone.update(0, 0);
  return true;
}

/** The sun's shadow frustum goes where the run starts (the hero): the real light setup of the first frames. */
function placeShadow(core: WarmCore): void {
  const quality = core.quality.profile;
  if (quality.shadows) core.env.followShadow(core.rig.focus, quality.shadowMapSize);
}

/**
 * Synchronous pass (the frame-4 re-warm behind the intro modal; the dev demos; tests): two whole-scene warm frames in one task,
 * the compile left to the frames themselves. `removeWarmSlots` undoes whatever the caller added to the scene for the pass (the
 * metin stand-ins); it runs last.
 */
export function warmupPassSync(core: WarmCore, removeWarmSlots: () => void, frames = 2): void {
  placeShadow(core);
  try {
    for (let i = 0; i < frames; i++) warmFrame(core);
  } finally {
    removeWarmSlots();
  }
}

export interface WarmEstablishingOptions {
  /**
   * Runs once the camera sits on the establishing pose and before the warm frame: the zone's lazy content for that view (the terrain
   * creates its far chunks and the far field from the camera position) is made here, so the warm frame uploads it. RenderEventRouter
   * passes the zone system's update.
   */
  refresh?: () => void;
  /** whole-scene warm frames at the pose (default 1) */
  frames?: number;
}

/**
 * FEEL-04: the second compile / upload pass, at the run-start fly-in's establishing pose. The gameplay camera (pitch 55, 22 m) sees a few
 * dozen metres of ground; the fly-in starts 62 m out at 17 degrees, where the terrain's far chunks and the far field, the distant props, the sky
 * dome and the backdrop come into view for the first time. Drawn for the first time inside the fly-in, their uploads and first-draw costs would
 * land in its frames, so this pass puts the camera on the pose (a held cinematic of the rig, see CameraRig.cinematic), lets the zone create
 * what that view needs (`refresh`), draws one whole-scene frame unculled (both passes: everything the pose could ever show is uploaded and
 * compiled) and puts the camera back, unless the caller already holds the pose (the router does: it keeps it for the fly-in). Synchronous,
 * like the frame-4 re-warm: it runs at the end of the load, behind the loading screen. Returns false (and does nothing) when the rig has no
 * cinematic (a test stand-in, a demo core).
 */
export function warmEstablishing(core: WarmCore, opts: WarmEstablishingOptions = {}): boolean {
  const rig = core.rig as WarmCore['rig'] | Partial<WarmCore['rig']>;
  if (typeof rig.cinematic !== 'function' || typeof rig.cancelCinematic !== 'function' || typeof rig.update !== 'function') return false;
  const held = rig.cinematicActive === true;
  if (!held) rig.cinematic(ESTABLISHING_POSE, FLY_IN_SECONDS, { hold: true });
  mark('ms:warmup:establishing');
  try {
    rig.update(0);
    placeShadow(core);
    opts.refresh?.();
    const frames = opts.frames ?? 1;
    for (let i = 0; i < frames; i++) warmFrame(core);
  } finally {
    if (!held) {
      rig.cancelCinematic();
      rig.update(0);
    }
  }
  return true;
}

/**
 * Compiles every shader program the run will use while the loading screen is still up: the programs are compiled in parallel
 * first (`opts.compile`: the driver's worker threads, the main thread stays free), then pooled / hidden meshes are shown for
 * two real frames through the actual composer path, each frame cut into slices of a few dozen objects (one task each, the
 * event loop gets a turn between them), then restored. Kills first-use hitches (boss VFX, metin, rings) without freezing the
 * loading screen for the 10-14 s the synchronous compile of ~80 programs took in the production build (prod4 verify I2).
 *
 * Invariants: the shadow frustum sits on the hero for the pass; culling is off in both passes of each warm frame; the scene
 * is untouched while this function waits (compile) and while it yields (each slice restores it before returning); the
 * caller's `removeWarmSlots` runs last, also when something throws.
 */
export async function warmupPass(core: WarmCore, removeWarmSlots: () => void, opts: WarmupOptions = {}): Promise<void> {
  const turn = opts.turn ?? makePacer();
  const frames = opts.frames ?? 2;
  const sliceSize = opts.sliceSize ?? 36;
  const progress = opts.onProgress;
  mark('ms:warmup:start');
  try {
    placeShadow(core);
    progress?.(0);
    if (opts.prime) {
      try {
        opts.prime();
      } catch (err) {
        // the warm-up still covers everything that exists; the lazily created content then links in its first frame, as before
        console.warn('[warmup] priming the zone failed:', err);
      }
      mark('ms:warmup:primed');
    }
    if (opts.compile) {
      await opts.compile(turn);
      mark('ms:warmup:compiled');
    }
    progress?.(0.8);
    const slices = sliceSize > 0 ? planWarmSlices(core.scene, sliceSize) : [];
    const all = slices.flat();
    // no slices (sliceSize 0, or nothing drawable): one whole-scene frame per round
    const plan: (Object3D[] | null)[] = slices.length > 0 ? slices : [null];
    const total = frames * plan.length;
    let done = 0;
    for (let f = 0; f < frames; f++) {
      for (const show of plan) {
        if (show) {
          const inSlice = new Set(show);
          warmFrame(core, { show, hide: all.filter((u) => !inSlice.has(u)) });
        } else {
          warmFrame(core);
        }
        done++;
        progress?.(0.8 + (0.2 * done) / total);
        // the stand-ins of `removeWarmSlots` leave the scene right after the last slice, with no turn in between
        if (done < total) await turn();
      }
    }
  } finally {
    removeWarmSlots();
    mark('ms:warmup:end');
  }
}
