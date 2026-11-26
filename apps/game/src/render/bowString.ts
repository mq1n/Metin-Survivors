// The bowstring of the ninja's bows (weapon-make must-fix: no bow had a string, every armory icon shows one).
//
// Data: every bow GLB carries its two string anchors in the scene extras, `weapon.string = { top, bottom }` (bow frame: grip at the origin, limbs along

// of the bow root (so it rides the hand, the per-clip hold and the left-hand mount for free): a thin dark unlit prism from the top anchor to the nock
// and from the nock to the bottom anchor. The nock rests on the straight line between the anchors; in a draw (attack / attack2 of the bow doctrine)
// it follows the RIGHT hand from the draw to the release and snaps back with a short decaying twang.
//
// The string is shaped right before it is drawn (`onBeforeRender` of its prisms calls `onSync`, where the hero reads the animation state and the
// hand joints from the world matrices of that very frame), so it follows any driver of the pose: the game loop, the armory preview, and the QA
// tools that pose the mixer by hand and render.
//
// Pure helpers (anchors, draw weight, nock path) are exported for the unit tests; {@link BowStringRig} is the three.js side.
import { CylinderGeometry, Group, Matrix4, Mesh, MeshBasicMaterial, Quaternion, Vector2, Vector3 } from 'three';
import type { Camera, Object3D, WebGLRenderer } from 'three';

export type V3 = readonly [number, number, number];

/** the two string anchors at the limb tips, in the bow (weapon GLB) frame */
export interface BowAnchors {
  top: V3;
  bottom: V3;
}

/** the share of the bow length (per tip) whose vertices the tip anchor averages (the dragon heads of t2 take a wider band than the thin limb tips) */
export const BOW_TIP_FRAC = 0.04;

const isV3 = (v: unknown): v is V3 => Array.isArray(v) && v.length === 3 && v.every((c) => typeof c === 'number' && Number.isFinite(c));

/** The anchors a bow GLB declares (`extras.weapon.string`), or null for a weapon without them (no string is drawn). */
export function bowAnchorsFromExtras(extras: unknown): BowAnchors | null {
  const s = (extras as { weapon?: { type?: unknown; string?: { top?: unknown; bottom?: unknown } } } | null | undefined)?.weapon?.string;
  if (!s || !isV3(s.top) || !isV3(s.bottom)) return null;
  // a degenerate string (both ends in one place) draws nothing useful
  const d = Math.hypot(s.top[0] - s.bottom[0], s.top[1] - s.bottom[1], s.top[2] - s.bottom[2]);
  return d > 0.05 ? { top: s.top, bottom: s.bottom } : null;
}

/** whether a weapon model (its scene extras) is a bow */
export function isBow(extras: unknown): boolean {
  return (extras as { weapon?: { type?: unknown } } | null | undefined)?.weapon?.type === 'bow';
}

/**
 * The anchors of a bow from its vertices (bow frame, flat xyz triples): the centroid of the vertices within `tipFrac` of the length at each end of
 * the limb axis Z (top = +Z end). Rounded to the millimetre. Null for fewer than two vertices or a bow shorter than 20 cm.
 */
export function measureBowAnchors(positions: ArrayLike<number>, tipFrac = BOW_TIP_FRAC): { top: [number, number, number]; bottom: [number, number, number] } | null {
  const n = Math.floor(positions.length / 3);
  if (n < 2) return null;
  let zmin = Infinity;
  let zmax = -Infinity;
  for (let i = 0; i < n; i++) {
    const z = positions[i * 3 + 2] as number;
    if (z < zmin) zmin = z;
    if (z > zmax) zmax = z;
  }
  const len = zmax - zmin;
  if (!(len > 0.2)) return null;
  const centroid = (lo: number, hi: number): [number, number, number] => {
    let sx = 0, sy = 0, sz = 0, k = 0;
    for (let i = 0; i < n; i++) {
      const z = positions[i * 3 + 2] as number;
      if (z < lo || z > hi) continue;
      sx += positions[i * 3] as number;
      sy += positions[i * 3 + 1] as number;
      sz += z;
      k++;
    }
    const r = (v: number): number => Math.round((v / Math.max(1, k)) * 1000) / 1000;
    return [r(sx), r(sy), r(sz)];
  };
  return { top: centroid(zmax - len * tipFrac, zmax), bottom: centroid(zmin, zmin + len * tipFrac) };
}

/** the rest nock: the middle of the straight string */
export function restNock(a: BowAnchors, out = new Vector3()): Vector3 {
  return out.set((a.top[0] + a.bottom[0]) / 2, (a.top[1] + a.bottom[1]) / 2, (a.top[2] + a.bottom[2]) / 2);
}

const smooth = (x: number): number => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};


export const DRAW_RAMP = 0.25;
/** the string lets go this share of the clip after the hit time (the fingers open as the draw hand starts to follow through; ~30 ms of a 0.9 s shot) */
export const RELEASE_DELAY = 0.035;
/** the string lets go over this share of the clip (a snap, not a blend) */
export const RELEASE_SPAN = 0.03;
/** the string's twang after the release: amplitude (m, at most), decay time constant (s), frequency (Hz) */
export const TWANG_AMP = 0.045;
export const TWANG_TAU = 0.075;
export const TWANG_HZ = 17;

export interface DrawState {
  /** 0 = the string is straight, 1 = the nock is at the drawing hand */
  draw: number;
  /** seconds since the release (0 before it), for the twang */
  sinceRelease: number;
}


const SHOTS = new Set(['attack', 'attack2', 'cast', 'attack_b', 'attack2_b', 'cast_b']);

/**
 * The draw of a bow one-shot. Only the bow's shots (`attack`, `attack2`, `cast`, also their `_b` clip names) pull the string: the nock follows the hand while
 * the authored right arm raises (`DRAW_RAMP`), is held, and lets go at the hit (`hitU` = hit time / clip duration, plus `RELEASE_DELAY`; a clip without a hit
 * time releases at 55 %). `u` = the clip's own progress 0..1, `duration` its length in seconds (the twang is real time).
 */
export function bowDraw(action: string, u: number, duration: number, hitU: number | undefined): DrawState {
  if (!SHOTS.has(action)) return { draw: 0, sinceRelease: 0 };
  const hit = (hitU !== undefined && hitU > 0.1 && hitU < 0.95 ? hitU : 0.55) + RELEASE_DELAY;
  const raise = smooth(u / DRAW_RAMP);
  const let_go = smooth((u - hit) / RELEASE_SPAN);
  return { draw: raise * (1 - let_go), sinceRelease: u > hit ? (u - hit) * Math.max(duration, 0.01) : 0 };
}

const _rest = new Vector3();
const _dir = new Vector3();

/**
 * The nock in the bow frame: the rest nock moved toward the drawing hand (`handLocal`, the hand in the bow frame; null = no drawing hand, e.g. the
 * legacy right-hand bow) by `state.draw`; after the release a damped oscillation along the same axis (the twang), bounded by the pull it replaces.
 */
export function nockPosition(a: BowAnchors, handLocal: Vector3 | null, state: DrawState, out = new Vector3()): Vector3 {
  restNock(a, _rest);
  out.copy(_rest);
  if (!handLocal) return out;
  _dir.copy(handLocal).sub(_rest);
  const pull = _dir.length();
  if (state.draw > 1e-4) return out.addScaledVector(_dir, state.draw);
  if (state.sinceRelease > 0 && pull > 1e-4) {
    const amp = Math.min(TWANG_AMP, pull * 0.12);
    const k = amp * Math.exp(-state.sinceRelease / TWANG_TAU) * Math.cos(2 * Math.PI * TWANG_HZ * state.sinceRelease);
    out.addScaledVector(_dir, k / pull);
  }
  return out;
}

const _hp = new Vector3();
const _inv = new Matrix4();

/**
 * Shapes the string of a bow from this frame's world matrices: `hand` is the drawing hand's joint (null = no drawing hand), `state` the draw. Call it
 * where the matrices are current (the string's own onSync, which runs right before it is drawn).
 */
export function poseBowString(rig: BowStringRig, bow: Object3D, hand: Object3D | null, state: DrawState): void {
  if (!hand || (state.draw <= 1e-4 && state.sinceRelease <= 0)) {
    rig.set(null, { draw: 0, sinceRelease: 0 });
    return;
  }
  _hp.setFromMatrixPosition(hand.matrixWorld).applyMatrix4(_inv.copy(bow.matrixWorld).invert());
  rig.set(_hp, state);
}

/** radius of the string prism (m, bow frame; the bow is held at scale 1) */
export const STRING_RADIUS = 0.0045;
/** the string never draws thinner than this radius on screen (drawing-buffer px): at the game camera a 9 mm string is under half a pixel and would vanish; the prism grows to this and stays a hairline */
export const MIN_PIXEL_RADIUS = 0.8;
/** at most this many times the model radius (a very distant hero keeps a believable string) */
export const MAX_THICKEN = 6;

/** The radius factor (>= 1) that keeps a string of `STRING_RADIUS` at least `minPx` wide on a perspective camera: `distance` (m) from the camera, vertical fov (deg), drawing-buffer height (px). */
export function stringThickening(distance: number, fovDeg: number, bufferHeight: number, minPx = MIN_PIXEL_RADIUS): number {
  if (!(distance > 0) || !(bufferHeight > 0)) return 1;
  const metresPerPx = (2 * distance * Math.tan((fovDeg * Math.PI) / 360)) / bufferHeight;
  return Math.min(MAX_THICKEN, Math.max(1, (minPx * metresPerPx) / STRING_RADIUS));
}
/** an unlit dark waxed-silk brown: it needs no light and reads against the lit ground and the bright limbs alike */
export const STRING_COLOR = 0x2b2119;

const Y = new Vector3(0, 1, 0);

/** The string meshes: two unit prisms placed between the three points; a child of the bow root. */
export class BowStringRig {
  readonly root = new Group();
  private readonly segs: [Mesh, Mesh];
  private readonly geo = new CylinderGeometry(STRING_RADIUS, STRING_RADIUS, 1, 5, 1, true);
  private readonly mat = new MeshBasicMaterial({ color: STRING_COLOR });
  readonly nock = new Vector3();
  /** called right before either prism is drawn: the owner shapes the string from the pose of this frame (see the file header) */
  onSync: (() => void) | null = null;
  private readonly top = new Vector3();
  private readonly bottom = new Vector3();

  constructor(readonly anchors: BowAnchors) {
    this.root.name = 'bowstring';
    this.top.set(...anchors.top);
    this.bottom.set(...anchors.bottom);
    const make = (): Mesh => {
      const m = new Mesh(this.geo, this.mat);
      m.frustumCulled = false;
      m.castShadow = false;
      m.receiveShadow = false;
      m.matrixAutoUpdate = false;
      m.userData.heldIgnore = true; 
      m.onBeforeRender = (renderer, _scene, camera) => {
        this.fit(renderer, camera);
        this.onSync?.();
      };
      this.root.add(m);
      return m;
    };
    this.segs = [make(), make()];
    this.set(null, { draw: 0, sinceRelease: 0 });
  }

  private resting = false;
  /** radius factor of the prisms for the camera that draws them (see {@link stringThickening}) */
  private thick = 1;
  private readonly _buf = new Vector2();
  private readonly _w = new Vector3();
  private readonly _c = new Vector3();

  /** keeps the string a visible hairline at the distance of the camera about to draw it */
  private fit(renderer: WebGLRenderer, camera: Camera): void {
    const persp = camera as { isPerspectiveCamera?: boolean; fov?: number };
    if (!persp.isPerspectiveCamera) return;
    const buf = renderer.getDrawingBufferSize(this._buf);
    const mid = restNock(this.anchors, this._w).applyMatrix4(this.root.matrixWorld);
    const t = stringThickening(mid.distanceTo(camera.getWorldPosition(this._c)), persp.fov ?? 50, buf.y);
    if (Math.abs(t - this.thick) > 0.05 * this.thick) {
      this.thick = t;
      this.resting = false;
    }
  }

  /** Shapes the string: the nock follows `handLocal` by `state` (see {@link nockPosition}); the prisms are re-placed (not again while it stays at rest). */
  set(handLocal: Vector3 | null, state: DrawState): void {
    const rest = handLocal === null && state.draw <= 1e-4 && state.sinceRelease <= 0;
    if (rest && this.resting) return;
    this.resting = rest;
    nockPosition(this.anchors, handLocal, state, this.nock);
    this.place(this.segs[0], this.top, this.nock);
    this.place(this.segs[1], this.nock, this.bottom);
  }

  private readonly _q = new Quaternion();
  private readonly _d = new Vector3();
  private readonly _s = new Vector3();
  private readonly _p = new Vector3();
  private place(m: Mesh, a: Vector3, b: Vector3): void {
    this._d.copy(b).sub(a);
    const len = this._d.length();
    if (len < 1e-5) {
      m.visible = false;
      return;
    }
    m.visible = true;
    this._q.setFromUnitVectors(Y, this._d.divideScalar(len));
    m.matrix.compose(this._p.copy(a).add(b).multiplyScalar(0.5), this._q, this._s.set(this.thick, len, this.thick));
    // the prism's world matrix of the frame being drawn (the scene graph computed it before onBeforeRender ran, from the previous shape)
    m.matrixWorld.multiplyMatrices(this.root.matrixWorld, m.matrix);
    m.matrixWorldNeedsUpdate = true;
  }

  /** Adds the string to a bow root. */
  attachTo(bow: Object3D): void {
    bow.add(this.root);
  }

  dispose(): void {
    this.root.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}
