// Isometric-ish follow camera: perspective FOV 40°, pitch 55°, distance 22 m (zoom 16–30), fixed yaw.
// The camera sits on the +Z side looking toward -Z, so screen-up = -Z and screen-right = +X (map convention).
import { MathUtils, PerspectiveCamera, Vector3 } from 'three';

export const CAMERA_FOV = 40;
export const CAMERA_PITCH = (55 * Math.PI) / 180;
export const CAMERA_DIST_MIN = 16;
export const CAMERA_DIST_MAX = 30;
export const CAMERA_DIST_DEFAULT = 22;

const FOLLOW_SMOOTH = 0.045; // tight hero follow without independent camera drift
const LOOKAHEAD = 0; // pure hero-locked tracking: no independent velocity shift while moving
const ZOOM_SMOOTH = 0.15;
const TRAUMA_DECAY = 1.8;
const SHAKE_POS = 0.55; // metres at trauma 1
const SHAKE_ROLL = 0.025; // radians at trauma 1

const BOSS_EXTRA_MAX = 12;

// ---- FEEL-03: the climax pull-back ----------------------------------------------------------------------------------------------
// The final boss emerges from the Great Metin (app/renderEvents.ts, bossSpawn with `final`): the camera backs off by CLIMAX_EXTRA metres over
// CLIMAX_RISE_S seconds, holds a moment and eases back over CLIMAX_FALL_S. The pull-back is its OWN term on top of the distance the zoom
// setting and the boss framing (setBossFraming) ask for: `distance` (zoom + the boss's extra, smoothed) is never touched, the term is added
// when the camera is placed, so a pull-back that ends leaves exactly the user's zoom (plus whatever the boss framing is still easing to),
// and the two never push against each other (both only ever move the camera OUT; they add). The pitch and the focus stay: the hero stays
// on the same screen spot, only smaller (22 m -> 28 m is 79 % of the size), and the world around it widens for a breath.

/** metres the camera backs off at the peak of the pull-back */
export const CLIMAX_EXTRA = 6;
/** seconds the camera takes to reach the peak (ease-in-out) */
export const CLIMAX_RISE_S = 1.2;
/** seconds it stays at the peak */
export const CLIMAX_HOLD_S = 0.4;
/** seconds it takes to come back (ease-in-out) */
export const CLIMAX_FALL_S = 1.4;
/**
 * The camera never ends up further than this (the widest zoom the settings allow plus the largest boss framing): a pull-back only uses what is
 * left of it, so a player who already sits at the far end gets less (at the very end none), and the streamed ground / the shadow range that
 * were tuned for these distances are never asked for more.
 */
export const CLIMAX_DIST_CAP = CAMERA_DIST_MAX + BOSS_EXTRA_MAX;

/**
 * The pull-back's distance (m, before the shake scaling and the cap) `t` seconds after it started: it rises from `from` (the level a pull-back
 * that was still running had reached: no jump) to `extra` over `rise` s with a sine ease-in-out, holds `hold` s, and falls to 0 over `fall` s.
 * Exactly 0 from `rise + hold + fall` on, and for t <= 0 exactly `from`.
 */
export function pullBackLevel(t: number, from: number, extra: number, rise: number, hold: number, fall: number): number {
  if (!(t > 0)) return from;
  if (t < rise) return from + (extra - from) * easeInOut(t / rise);
  if (t < rise + hold) return extra;
  const u = (t - rise - hold) / fall;
  return u >= 1 ? 0 : extra * (1 - easeInOut(u));
}

// ---- FEEL-04: the run-start fly-in -----------------------------------------------------------------------------------------------
// The gameplay rig (pitch 55, FOV 40) never shows the sky or the backdrop. For 2.5 s at the start of a run the camera comes down from an
// establishing pose (low pitch, far out, still centred on the hero) into the rig. The pose is a cinematic of this rig: `update` eases the
// pitch and runs the camera height on a line from the pose to the gameplay rig (cinematicPose), so the ground footprint (`isVisible`)
// follows it and the last frame is exactly the gameplay camera. The fly-in is started and gated in app/renderEvents.ts; nothing here reads input.

/**
 * the establishing pose: 17 degrees of pitch from 62 m (far chunks and props stay inside the 60-70 m the streaming covers). With the 40 degree
 * vertical FOV the top row of the frame looks 3 degrees above the horizon, so the backdrop ridge line and a band of sky are in the opening frames
 * (at 22 degrees the top row looked 2 degrees below it: only fog).
 */
export const ESTABLISH_PITCH = (17 * Math.PI) / 180;
export const ESTABLISH_DIST = 62;
/** length of the fly-in (s) */
export const FLY_IN_SECONDS = 2.5;
/** the fly-in advances by at most this much per rendered frame (s): a startup stall (a 250 ms frame) cannot swallow it */
export const FLY_IN_MAX_STEP = 1 / 30;
/** the held pose is released after this many consecutive frames no longer than FLY_IN_STABLE_DT, ... */
export const FLY_IN_STABLE_FRAMES = 10;
/** ... a frame of a 30 fps machine (33.3 ms plus 4 ms of jitter) is steady: a locked 30 Hz display must not wait the full 2 s */
export const FLY_IN_STABLE_DT = 1 / 30 + 0.004;
/** ... or after this long (s) of the run clock moving without them */
export const FLY_IN_MAX_WAIT = 2;

/** what is left of the fly-in (s) once the player moves: the camera is back on the gameplay rig by then */
export const FLY_IN_HURRY_S = 0.4;

export interface CinematicPose {
  /** radians above the horizon the camera looks down from */
  pitch: number;
  /** metres from the focus */
  distance: number;
}

export const ESTABLISHING_POSE: Readonly<CinematicPose> = Object.freeze({ pitch: ESTABLISH_PITCH, distance: ESTABLISH_DIST });

/**
 * The camera of a cinematic at eased parameter `e` (0 = `from`, 1 = the gameplay rig `to`): the pitch eases between the two poses and the camera
 * HEIGHT above the focus runs on the straight line between their heights (the pose's 62 m x sin 17 deg = 18.1 m, the rig's 22 m x sin 55 deg = 18.0 m),
 * so the distance follows (height / sin pitch). The camera comes in over the ground at about the height it started at and tilts down onto the hero.
 * It never rises above the higher end: attempt 1 lifted it 18 m over its circle (43 m up at mid-flight), where the tree system's horizontal LOD
 * choice (vegetation/trees.ts gather) and the shader's 3D cross-fade (treeMaterials.ts) disagree and trees 33-48 m away blinked out. At e = 1 the
 * gameplay values themselves, not a lerp that may miss them by a rounding error.
 */
export function cinematicPose(from: CinematicPose, to: CinematicPose, e: number): CinematicPose {
  if (e >= 1) return { pitch: to.pitch, distance: to.distance };
  if (e <= 0) return { pitch: from.pitch, distance: from.distance };
  const pitch = from.pitch + (to.pitch - from.pitch) * e;
  const h0 = from.distance * Math.sin(from.pitch);
  const h1 = to.distance * Math.sin(to.pitch);
  return { pitch, distance: (h0 + (h1 - h0) * e) / Math.sin(pitch) };
}

/** ease-in-out (sine) of a 0..1 parameter; exactly 0 and 1 at the ends */
export function easeInOut(p: number): number {
  const x = p <= 0 ? 0 : p >= 1 ? 1 : p;
  return 0.5 - 0.5 * Math.cos(Math.PI * x);
}

export type FlyInSkip = 'off' | 'guest' | 'low' | 'shake' | 'motion' | 'restart';

/** The OS asks for less motion (the UI honours it too: Modal, ScrollFade, UiFx, StoryStage, Credits, heroTurn). False without a matchMedia (tests, workers). */
export function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Why the fly-in does not play (null = it plays): switched off by the page, a co-op guest, the low tier, screen shake 0 (the in-game motion
 * setting), the OS setting prefers-reduced-motion (a 2.5 s, 40 m camera move is the motion it asks to remove), a restart of the run just played.
 */
export function flyInSkip(o: {
  tier: string | undefined;
  shakeScale: number;
  restart: boolean;
  guest: boolean;
  off?: boolean;
  reducedMotion?: boolean;
}): FlyInSkip | null {
  if (o.off) return 'off';
  if (o.guest) return 'guest';
  if (o.tier === 'low') return 'low';
  if (!(o.shakeScale > 0)) return 'shake';
  if (o.reducedMotion) return 'motion';
  if (o.restart) return 'restart';
  return null;
}

/** QA only (dev server, VITE_QA_HOOKS=1 builds): the page query `up=noflyin` switches the fly-in off, so a live capture starts on the gameplay camera. Other `up=` words are ignored here. */
export function parseFlyInOff(search: string | null | undefined, qa: boolean): boolean {
  return hasUpWord(search, qa, 'noflyin');
}

/** QA only (same rules as `parseFlyInOff`): the word `word` is among the comma separated words of a page query `up=` (not case sensitive). */
function hasUpWord(search: string | null | undefined, qa: boolean, word: string): boolean {
  if (!qa || !search) return false;
  for (const m of search.matchAll(/[?&]up=([^&#]*)/g)) {
    let v = m[1] ?? '';
    try {
      v = decodeURIComponent(v);
    } catch {
      /* keep the raw text */
    }
    if (v.split(',').some((w) => w.trim().toLowerCase() === word)) return true;
  }
  return false;
}

export function flyInOffByPage(): boolean {
  if (!(import.meta.env.DEV || import.meta.env.VITE_QA_HOOKS === '1')) return false;
  return parseFlyInOff(typeof location !== 'undefined' ? location.search : '', true);
}

/** QA only (FEEL-03): the page query `up=noclimax` switches the final-boss staging (camera pull-back and vignette pulses) off: the same-tree "before" arm of a blind pair. */
export function parseClimaxOff(search: string | null | undefined, qa: boolean): boolean {
  return hasUpWord(search, qa, 'noclimax');
}

export function climaxOffByPage(): boolean {
  if (!(import.meta.env.DEV || import.meta.env.VITE_QA_HOOKS === '1')) return false;
  return parseClimaxOff(typeof location !== 'undefined' ? location.search : '', true);
}

/**
 * When the held establishing pose is released into the fly-in: once the run clock moves (the intro card is closed, or there was none) and
 * either 10 consecutive frames were shorter than 33 ms (the startup stalls are over, so the 2.5 s are not eaten by them) or the clock has
 * moved for 2 s. Frames count while the card is open, too: a long read leaves nothing to wait for.
 */
export class FlyInGate {
  /** consecutive steady frames so far */
  stable = 0;
  /** seconds the run clock has moved */
  waited = 0;

  /** One rendered frame (`dt` s, the clamped frame delta); `running`: the run clock moves. True = release now. */
  frame(dt: number, running: boolean): boolean {
    this.stable = dt > 0 && dt < FLY_IN_STABLE_DT ? this.stable + 1 : 0;
    if (running && dt > 0) this.waited += dt;
    return running && (this.stable >= FLY_IN_STABLE_FRAMES || this.waited >= FLY_IN_MAX_WAIT);
  }
}

/** touch devices / short landscape viewports: closer camera so the hero reads at ~12-13 % of the screen height */
const compactScreen =
  typeof matchMedia === 'function' && (matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 520);
const DEFAULT_ZOOM = compactScreen ? 16.5 : CAMERA_DIST_DEFAULT;

export class CameraRig {
  readonly camera: PerspectiveCamera;
  /** current focus point (smoothed), world space */
  readonly focus = new Vector3();
  /** requested camera distance; smoothed into `distance` */
  zoom = DEFAULT_ZOOM;
  /** extra distance (m) requested by a nearby large boss; smoothed into `bossExtra` */
  private bossTarget = 0;
  private bossExtra = 0;
  distance = DEFAULT_ZOOM;
  /** 0..1 user multiplier from settings.screenShake */
  shakeScale = 1;
  trauma = 0;

  private readonly target = new Vector3();
  private vx = 0;
  private vz = 0;
  private snapNext = true;
  private time = 0;
  /** FEEL-04: the establishing pose being flown (or held) into the gameplay rig, null = the plain gameplay rig */
  private cine: { pitch: number; distance: number; dur: number; t: number; rate: number; hold: boolean } | null = null;
  private pitchNow = CAMERA_PITCH;
  /** FEEL-03: the climax pull-back in progress (null = none), the level (m, before the shake scaling and the cap) it has reached, and what it added at the last `update` */
  private pull: { t: number; from: number; extra: number; rise: number; hold: number; fall: number } | null = null;
  private pullLevel = 0;
  private pullNow = 0;
  // Ground-plane visibility quad (XZ), counter-clockwise; plane normals/offsets for circle tests.
  private readonly quad = new Float32Array(8);
  private readonly edgeNx = new Float32Array(4);
  private readonly edgeNz = new Float32Array(4);
  private readonly edgeD = new Float32Array(4);
  private readonly tmp = new Vector3();
  private readonly ray = new Vector3();

  constructor(aspect = 16 / 9) {
    this.camera = new PerspectiveCamera(CAMERA_FOV, aspect, 0.5, 320);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Sets the follow target (world y = ground height at the hero) and its velocity for look-ahead. */
  setTarget(x: number, y: number, z: number, vx = 0, vz = 0): void {
    this.target.set(x, y, z);
    this.vx = vx;
    this.vz = vz;
  }

  /** Jump to the target without smoothing (run start, teleport). A teleport ends a fly-in: the camera is back on the gameplay rig at once. */
  snap(): void {
    this.snapNext = true;
    this.cine = null;
  }

  /**
   * FEEL-04: eases the camera from `pose` into the gameplay rig (pitch 55, the user zoom, a boss's extra distance) over `durS` seconds,
   * ease-in-out, hero-centred. The parameter advances by min(frame dt, FLY_IN_MAX_STEP) per `update`, so a stalled frame cannot skip the
   * move. `hold` keeps the camera on `pose` (parameter 0) until `releaseCinematic()`. Replaces a running cinematic; `durS <= 0` ends it.
   */
  cinematic(pose: CinematicPose, durS: number, opts: { hold?: boolean } = {}): void {
    if (!(durS > 0) || !(pose.distance > 0)) {
      this.cine = null;
      return;
    }
    this.cine = { pitch: pose.pitch, distance: pose.distance, dur: durS, t: 0, rate: 1, hold: opts.hold === true };
  }

  /** A held cinematic starts to move. */
  releaseCinematic(): void {
    if (this.cine) this.cine.hold = false;
  }

  /**
   * The player is moving: the rest of the cinematic runs faster, so that `remainS` seconds of it are left (the position stays continuous, only the
   * speed changes). A held cinematic is released. A cinematic with less than that left, or none, is left alone.
   */
  hurryCinematic(remainS = FLY_IN_HURRY_S): void {
    const c = this.cine;
    if (!c) return;
    c.hold = false;
    const left = c.dur - c.t;
    if (left > remainS && remainS > 0) c.rate = Math.max(c.rate, left / remainS);
  }

  /** Back on the gameplay rig from the next `update`. */
  cancelCinematic(): void {
    this.cine = null;
  }

  get cinematicActive(): boolean {
    return this.cine !== null;
  }

  get cinematicHeld(): boolean {
    return this.cine !== null && this.cine.hold;
  }

  /** 0..1 progress of the cinematic's parameter (linear, before the ease); 0 when there is none or it is held */
  get cinematicProgress(): number {
    const c = this.cine;
    return c ? c.t / c.dur : 0;
  }

  /** the pitch (rad) of the last `update` (CAMERA_PITCH on the gameplay rig) */
  get pitch(): number {
    return this.pitchNow;
  }

  setZoom(d: number): void {
    this.zoom = MathUtils.clamp(d, CAMERA_DIST_MIN, CAMERA_DIST_MAX);
  }

  /**
   * A boss with a large footprint is near: ease the camera out so it fits (height in metres of the tallest such boss,
   * 0 = none). Stacks on top of the user zoom, so the zoom setting is still respected.
   */
  setBossFraming(heightM: number): void {
    this.bossTarget = heightM > 4 ? Math.min(BOSS_EXTRA_MAX, (heightM - 4) * 1.6) : 0;
  }

  /**
   * FEEL-03: the climax pull-back (app/renderEvents.ts, the final boss's emerge): backs the camera off by `extraM` metres over `riseS` s (ease-in-out),
   * holds `holdS` s and eases back over `fallS` s, to exactly the distance the zoom and the boss framing ask for. It is a term of its own that
   * `update` adds when it places the camera (never mixed into `zoom`, `distance` or the boss framing), so it composes with `setBossFraming` and a
   * zoom change during it. The pitch and the focus stay: the hero stays where it is on the screen. It runs on the frame clock (at most
   * FLY_IN_MAX_STEP per frame: a stalled frame cannot swallow it), is scaled by `shakeScale` (0 = no camera motion at all) and never takes the
   * camera beyond CLIMAX_DIST_CAP. A pull-back that starts while another runs continues from the level reached (no jump). Nonsense
   * (extra <= 0, riseS <= 0, fallS <= 0, holdS < 0, NaN) starts nothing and changes nothing.
   */
  pullBack(extraM = CLIMAX_EXTRA, riseS = CLIMAX_RISE_S, holdS = CLIMAX_HOLD_S, fallS = CLIMAX_FALL_S): void {
    if (!(extraM > 0) || !(riseS > 0) || !(fallS > 0) || !(holdS >= 0)) return;
    this.pull = { t: 0, from: this.pullLevel, extra: extraM, rise: riseS, hold: holdS, fall: fallS };
  }

  /** Ends a pull-back at once (a new run, the end of one): the camera is back on the zoom / boss-framing distance from the next `update`. */
  cancelPullBack(): void {
    this.pull = null;
    this.pullLevel = 0;
    this.pullNow = 0;
  }

  get pullBackActive(): boolean {
    return this.pull !== null;
  }

  /** metres the pull-back added to the camera distance at the last `update` (0 when none runs) */
  get pullBackExtra(): number {
    return this.pullNow;
  }

  addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  update(dt: number): void {
    this.time += dt;
    const tx = this.target.x + this.vx * LOOKAHEAD;
    const tz = this.target.z + this.vz * LOOKAHEAD;
    const ty = this.target.y;
    if (this.snapNext) {
      this.focus.set(tx, ty, tz);
      this.bossExtra = this.bossTarget;
      this.distance = this.zoom + this.bossExtra;
      this.snapNext = false;
    } else {
      const k = 1 - Math.exp(-dt / FOLLOW_SMOOTH);
      this.focus.x += (tx - this.focus.x) * k;
      this.focus.z += (tz - this.focus.z) * k;
      this.focus.y += (ty - this.focus.y) * (1 - Math.exp(-dt / 0.25));
      this.bossExtra += (this.bossTarget - this.bossExtra) * (1 - Math.exp(-dt / (this.bossTarget > this.bossExtra ? 0.9 : 1.6)));
      this.distance += (this.zoom + this.bossExtra - this.distance) * (1 - Math.exp(-dt / ZOOM_SMOOTH));
    }
    this.trauma = Math.max(0, this.trauma - TRAUMA_DECAY * dt);

    // FEEL-03: the pull-back's own term, added below to whatever distance the zoom, the boss framing and a cinematic give
    const pb = this.pull;
    if (pb) {
      pb.t += dt > 0 ? Math.min(dt, FLY_IN_MAX_STEP) : 0;
      if (pb.t >= pb.rise + pb.hold + pb.fall) {
        this.pull = null;
        this.pullLevel = 0;
      } else this.pullLevel = pullBackLevel(pb.t, pb.from, pb.extra, pb.rise, pb.hold, pb.fall);
    }
    const motion = this.shakeScale >= 1 ? 1 : this.shakeScale > 0 ? this.shakeScale : 0;
    const room = CLIMAX_DIST_CAP - this.distance;
    this.pullNow = this.pullLevel > 0 ? Math.min(this.pullLevel * motion, room > 0 ? room : 0) : 0;

    let pitch = CAMERA_PITCH;
    let dist = this.distance;
    const c = this.cine;
    if (c) {
      if (!c.hold) c.t = Math.min(c.dur, c.t + Math.min(Math.max(dt, 0), FLY_IN_MAX_STEP) * c.rate);
      const now = cinematicPose(c, { pitch: CAMERA_PITCH, distance: this.distance }, easeInOut(c.t / c.dur));
      pitch = now.pitch;
      dist = now.distance;
      if (!c.hold && c.t >= c.dur) this.cine = null;
    }
    dist += this.pullNow;
    this.pitchNow = pitch;
    const cam = this.camera;
    const cosP = Math.cos(pitch);
    const sinP = Math.sin(pitch);
    let ox = 0;
    let oy = 0;
    let roll = 0;
    const amp = this.trauma * this.trauma * this.shakeScale;
    if (amp > 1e-4) {
      const t = this.time * 38;
      ox = Math.sin(t * 1.13) * Math.cos(t * 0.71) * SHAKE_POS * amp;
      oy = Math.sin(t * 1.37 + 1.7) * SHAKE_POS * 0.7 * amp;
      roll = Math.sin(t * 0.93 + 0.4) * SHAKE_ROLL * amp;
    }
    cam.position.set(this.focus.x + ox, this.focus.y + dist * sinP + oy, this.focus.z + dist * cosP);
    cam.up.set(0, 1, 0);
    this.tmp.set(this.focus.x + ox, this.focus.y, this.focus.z);
    cam.lookAt(this.tmp);
    if (roll !== 0) cam.rotateZ(roll);
    cam.updateMatrixWorld();
    this.updateGroundQuad();
  }

  /** Intersects the frustum corners (slightly padded) with the plane y = focus.y. */
  private updateGroundQuad(): void {
    const cam = this.camera;
    const planeY = this.focus.y;
    const pad = 1.12;
    const corners: [number, number][] = [
      [-pad, -pad],
      [pad, -pad],
      [pad, pad],
      [-pad, pad],
    ];
    for (let i = 0; i < 4; i++) {
      const c = corners[i] as [number, number];
      this.ray.set(c[0], c[1], 0.5).unproject(cam).sub(cam.position).normalize();
      // Rays pointing at/above the horizon can only happen with extreme zoom; clamp to a far distance.
      const dy = this.ray.y;
      const s = dy < -0.05 ? (planeY - cam.position.y) / dy : 400;
      this.quad[i * 2] = cam.position.x + this.ray.x * s;
      this.quad[i * 2 + 1] = cam.position.z + this.ray.z * s;
    }
    // Quad order: bottom-left, bottom-right, top-right, top-left in NDC. Orientation depends on handedness,
    // so compute edge normals pointing inward using the centroid.
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < 4; i++) {
      cx += this.quad[i * 2] as number;
      cz += this.quad[i * 2 + 1] as number;
    }
    cx *= 0.25;
    cz *= 0.25;
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) & 3;
      const ax = this.quad[i * 2] as number;
      const az = this.quad[i * 2 + 1] as number;
      const bx = this.quad[j * 2] as number;
      const bz = this.quad[j * 2 + 1] as number;
      let nx = -(bz - az);
      let nz = bx - ax;
      const len = Math.hypot(nx, nz) || 1;
      nx /= len;
      nz /= len;
      let d = nx * ax + nz * az;
      if (nx * cx + nz * cz - d < 0) {
        nx = -nx;
        nz = -nz;
        d = -d;
      }
      this.edgeNx[i] = nx;
      this.edgeNz[i] = nz;
      this.edgeD[i] = d;
    }
  }

  /** True when a ground circle (x,z,r) can intersect the camera's view footprint. */
  isVisible(x: number, z: number, r: number): boolean {
    for (let i = 0; i < 4; i++) {
      if ((this.edgeNx[i] as number) * x + (this.edgeNz[i] as number) * z - (this.edgeD[i] as number) < -r) return false;
    }
    return true;
  }
}
