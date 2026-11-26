// Camera framing of the hero preview (HeroSelect / Armory, app/heroPreview.ts).
//
// The preview used to frame the HERO only (E4: a 2 m polearm must not shrink the hero), so a long blade held up in the idle, a two-hander or a drawn
// bow ran out of the 520 x 760 armory frame at the top or the sides. Weapon-fit fix r1 (2026-10-30) framed the union of the hero and the held
// weapon(s) as a vertical cylinder about the turntable axis, which made a long weapon held out sideways (the warrior glaives, the female yacha
// blades) shrink the hero to about a third of the frame (weapon judge r2, MF12); fix r2 added a hero floor (>= 50 % of the frame height), which
// left the glaives cut by up to half their reach at the yaws where they lie across the view (rig1to1 ASP measure, 2026-11-06: with the camera
// centred on the hero the two rules cannot both hold for a 1.8 m glaive held at its butt).
//
// Now (rig1to1 ASP, 2026-11-06) the camera is HERO FIRST and FOLLOWS THE TURN with a lateral pan:
//   1. 'hero': the old hero-only framing (3.1 h in front, 0.55 h up, looking at 0.48 h) stays whenever the hero and its weapon(s), less the
//      weapon's tip (TIP_SHARE of its reach from the grip, the judge's allowance), fit it centred at every yaw: most heroes, unchanged;
//   2. 'pan': otherwise the camera backs off, never closer than that, to the smallest distance at which the hero and the weapon up to its tip fit
//      at EVERY yaw with a lateral pan of at most PAN_MAX of the frame's half width: the camera slides sideways (a parallel pan, the hero keeps its
//      size) by the per-yaw amount that puts the hero and the weapon inside the frame, as little as possible (none where the weapon fits centred;
//      the tip too when that costs no more than the cap). The pan is a table over the turntable yaw, read per frame (cameraAt): where a glaive
//      lies across the view the frame holds the hero at one side and the glaive across the rest, where it points along the view the hero is
//      centred again. The look-at height centres the union vertically, kept where the hero itself stays whole;
//   3. 'floor': the camera never backs off so far that the hero is less than HERO_MIN of the frame height; when that floor binds, the pan cap is
//      lifted (the hero may stand at the frame's margin) and the weapon is cut as little as the pan allows, from its tip inward.
// The weapon is a point cloud in the pivot frame (yaw taken out, heldPoints) over the shown pose(s); the hero is a vertical cylinder
// (previewBounds): its lateral extent is the same at every yaw. All fits use the camera's real perspective (every point at its own depth).
import { Vector3 } from 'three';
import type { Object3D } from 'three';

/** the shown model as a vertical cylinder about the turntable axis (x = z = 0 of the pivot): radius and height range, metres */
export interface PreviewBounds {
  r: number;
  y0: number;
  y1: number;
}

export interface PreviewFraming {
  /** camera position (pivot frame: the camera looks along -z) */
  pos: [number, number, number];
  /** look-at point */
  look: [number, number, number];
}

/** the old hero-only framing: camera at 3.1 h in front, 0.55 h up, looking at 0.48 h (h = hero height, at least 1 m) */
export function heroOnlyFraming(heroHeight: number): PreviewFraming {
  const h = Math.max(heroHeight, 1);
  return { pos: [0, h * 0.55, h * 3.1], look: [0, h * 0.48, 0] };
}

/** the rise of the preview camera per metre of distance along z: the old framing's 0.55 h up, looking at 0.48 h, from 3.1 h away */
export const PITCH = (0.55 - 0.48) / 3.1;
const N = Math.hypot(1, PITCH);

const _f = new Vector3();
const _r = new Vector3();
const _u = new Vector3();
const _p = new Vector3();

/** the largest |NDC x| / |NDC y| of the cylinder's rim points (36 per rim, both rims) seen from `fr` with a vertical FOV `fovDeg` and `aspect` (w / h) */
export function maxNdc(b: PreviewBounds, fr: PreviewFraming, fovDeg: number, aspect: number): { x: number; y: number } {
  const [cx, cy, cz] = fr.pos;
  _f.set(fr.look[0] - cx, fr.look[1] - cy, fr.look[2] - cz).normalize();
  _r.crossVectors(_f, _u.set(0, 1, 0)).normalize();
  _u.crossVectors(_r, _f).normalize();
  const ty = Math.tan(((fovDeg * Math.PI) / 180) / 2), tx = ty * aspect;
  let mx = 0, my = 0;
  for (const y of [b.y0, b.y1]) {
    for (let k = 0; k < 36; k++) {
      const a = (k / 36) * Math.PI * 2;
      _p.set(b.r * Math.cos(a) - cx, y - cy, b.r * Math.sin(a) - cz);
      const d = _p.dot(_f);
      if (d <= 1e-6) return { x: Infinity, y: Infinity };
      mx = Math.max(mx, Math.abs(_p.dot(_r)) / (d * tx));
      my = Math.max(my, Math.abs(_p.dot(_u)) / (d * ty));
    }
  }
  return { x: mx, y: my };
}

/** the hero fills at least half of the frame height (judge r2: a sideways glaive shrank the hero to a third of the 760 px armory frame) */
export const HERO_MIN = 0.5;
/** headroom over the hero floor: the idle's breathing lowers the hero a hair under its cylinder's height at some instants of the loop */
export const HERO_HEADROOM = 0.01;
/** the share of a held weapon's reach (from its grip) that may cross the side edges: the tip (judge r2: <= 15 % of the weapon's length) */
export const TIP_SHARE = 0.15;
/** the lateral pan's cap as a share of the frame's half width while the hero floor does not bind (the hero's centre stays within the middle half) */
export const PAN_MAX = 0.25;
/** yaw samples of the pan table (5 deg) */
export const YAW_SAMPLES = 72;
/** the hero cylinder's rim samples per rim (the fits take its near and far points at every yaw) */
const RIM = 36;

/** the held weapon(s) in the shown pose(s) as points in the PIVOT frame (the turntable yaw taken out), each with its distance from its grip */
export interface PreviewPoints {
  /** 3 per point */
  xyz: Float32Array;
  /** per point: its distance from the grip (its instance's root) at that pose */
  s: Float32Array;
  /** the largest `s`: the weapon's reach from the grip */
  reach: number;
}

/** an accumulator for {@link heldPoints} over several poses */
export interface PointAcc {
  xyz: number[];
  s: number[];
}

const _v = new Vector3();
const _g = new Vector3();

/**
 * Appends every `stride`-th vertex of the meshes under the held weapon `roots` (rigid meshes in their current world pose; meshes marked
 * `userData.heldIgnore`, the bowstring, are left out) to `acc`, in the frame of `pivot` (the turntable group), with the vertex's distance from its
 * root's world position (the grip). Call once per shown pose; {@link toPreviewPoints} packs the result.
 */
export function heldPoints(roots: readonly Object3D[], pivot: Object3D, stride = 4, acc: PointAcc = { xyz: [], s: [] }): PointAcc {
  pivot.updateMatrixWorld(true);
  const pinv = pivot.matrixWorld.clone().invert();
  for (const root of roots) {
    root.updateMatrixWorld(true);
    root.getWorldPosition(_g).applyMatrix4(pinv);
    root.traverse((m) => {
      const mesh = m as Object3D & { isMesh?: boolean; geometry?: { getAttribute(n: string): { count: number } | undefined }; getVertexPosition?: (i: number, t: Vector3) => Vector3 };
      if (!mesh.isMesh || !mesh.geometry || !mesh.getVertexPosition || mesh.userData?.heldIgnore) return;
      const pos = mesh.geometry.getAttribute('position');
      if (!pos) return;
      for (let i = 0; i < pos.count; i += stride) {
        mesh.getVertexPosition(i, _v).applyMatrix4(mesh.matrixWorld).applyMatrix4(pinv);
        acc.xyz.push(_v.x, _v.y, _v.z);
        acc.s.push(_v.distanceTo(_g));
      }
    });
  }
  return acc;
}

/** packs a {@link heldPoints} accumulator; null when it holds no point */
export function toPreviewPoints(acc: PointAcc): PreviewPoints | null {
  if (!acc.s.length) return null;
  let reach = 0;
  for (const s of acc.s) if (s > reach) reach = s;
  return { xyz: Float32Array.from(acc.xyz), s: Float32Array.from(acc.s), reach };
}

/** which stage of {@link framePreview} set the camera (see the top of the file) */
export type PreviewFit = 'hero' | 'pan' | 'floor';

/** the preview camera for a shown model: a fixed distance and height, and a lateral pan per turntable yaw ({@link cameraAt}) */
export interface PreviewCamera {
  /** camera-to-axis distance along z of the pivot frame (the camera sits PITCH * dist higher than its look-at point) */
  dist: number;
  /** the look-at height */
  lookY: number;
  /** the lateral pan (camera x = look-at x, metres) at the yaws 2 pi k / pan.length; all zero for a centred camera */
  pan: number[];
  fit: PreviewFit;
  /** the hero's height over the frame height at the turntable axis */
  heroShare: number;
  /** the largest share of the weapon's reach outside the frame at any sampled yaw (from the first point outside to the tip); 0 = never cut */
  cut: number;
}

export interface FrameOptions {
  /** the hero's least share of the frame height (default {@link HERO_MIN}) */
  heroMin?: number;
  /** the share of the weapon's reach that may cross the side edges (default {@link TIP_SHARE}) */
  tipShare?: number;
  /** the pan cap as a share of the frame's half width (default {@link PAN_MAX}) */
  panMax?: number;
  /** yaw samples of the pan table (default {@link YAW_SAMPLES}) */
  samples?: number;
}

/** the pan table read at a yaw (periodic, linear between the samples) */
export function panAt(pan: readonly number[], yaw: number): number {
  const K = pan.length;
  if (!K) return 0;
  let u = (yaw / (Math.PI * 2)) * K;
  u -= Math.floor(u / K) * K;
  const k0 = Math.floor(u) % K, k1 = (k0 + 1) % K, t = u - Math.floor(u);
  return pan[k0]! * (1 - t) + pan[k1]! * t;
}

/** the camera position and look-at point of a {@link PreviewCamera} at a turntable yaw */
export function cameraAt(cam: PreviewCamera, yaw: number): PreviewFraming {
  const x = panAt(cam.pan, yaw);
  return { pos: [x, cam.lookY + PITCH * cam.dist, cam.dist], look: [x, cam.lookY, 0] };
}

/** the hero's share of the frame height for a framing (vertical FOV `fovDeg`): its height range over the frame height at the turntable axis */
export function heroShare(hero: PreviewBounds, fr: PreviewFraming, fovDeg: number): number {
  const d = Math.hypot(fr.pos[0] - fr.look[0], fr.pos[1] - fr.look[1], fr.pos[2] - fr.look[2]);
  return (hero.y1 - hero.y0) / (2 * d * Math.tan(((fovDeg * Math.PI) / 180) / 2));
}

// The camera family: at (camX, lookY + PITCH d, d) looking at (camX, lookY, 0), so its view axis is (0, -PITCH, -1) / N and its right axis +x. For a
// point of the pivot frame already turned by the yaw: the depth along the view (the same for every camX), the height above the look-at point in the
// view plane (NDC y = vert / (depth * ty)) and the lateral offset x - camX (NDC x = (x - camX) / (depth * tx): the pan shifts it alone).
function depthOf(d: number, lookY: number, y: number, z: number): number {
  return d * N - (z + PITCH * (y - lookY)) / N;
}
function vertOf(lookY: number, y: number, z: number): number {
  return (y - lookY - PITCH * z) / N;
}
const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

interface Solution {
  /** the weapon up to its tip fits at every yaw with pans within the cap, and the union fits vertically */
  okCapped: boolean;
  lookY: number;
  pan: number[];
  cut: number;
}

/** the fits of one model at one camera distance */
class Fitter {
  /** hero rim points (yaw invariant): x, y, z per point */
  private readonly rim: Float32Array;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  constructor(
    private readonly hero: PreviewBounds,
    private readonly pts: PreviewPoints,
    private readonly tipCut: number,
    private readonly K: number,
    private readonly lim: number,
    private readonly tx: number,
    private readonly ty: number,
    private readonly panMax: number,
  ) {
    this.rim = new Float32Array(RIM * 2 * 3);
    let o = 0;
    for (const y of [hero.y0, hero.y1]) {
      for (let k = 0; k < RIM; k++) {
        const a = (k / RIM) * Math.PI * 2;
        this.rim[o++] = hero.r * Math.cos(a);
        this.rim[o++] = y;
        this.rim[o++] = hero.r * Math.sin(a);
      }
    }
    this.cos = new Float64Array(K);
    this.sin = new Float64Array(K);
    for (let k = 0; k < K; k++) { this.cos[k] = Math.cos((k / K) * Math.PI * 2); this.sin[k] = Math.sin((k / K) * Math.PI * 2); }
  }

  /** the largest cut of the weapon (share of its reach beyond the real frame edge) at any yaw with the camera centred (camX = 0) */
  cutStatic(d: number, lookY: number): number {
    const { tx, ty, pts, K, cos, sin } = this;
    const xyz = pts.xyz, sArr = pts.s;
    let cut = 0;
    for (let k = 0; k < K; k++) {
      const c = cos[k]!, s = sin[k]!;
      let minS = Infinity;
      for (let i = 0, j = 0; i < xyz.length; i += 3, j++) {
        const x0 = xyz[i]!, y = xyz[i + 1]!, z0 = xyz[i + 2]!;
        const x = c * x0 + s * z0, z = -s * x0 + c * z0, dep = depthOf(d, lookY, y, z);
        if (dep <= 1e-6 || Math.abs(x) > tx * dep || Math.abs(vertOf(lookY, y, z)) > ty * dep) { if (sArr[j]! < minS) minS = sArr[j]!; }
      }
      if (minS < Infinity && pts.reach > 0) cut = Math.max(cut, (pts.reach - minS) / pts.reach);
    }
    return cut;
  }

  /** the old framing's test with the camera centred (camX = 0) at every yaw: the hero and the weapon up to its tip inside the margin, the tip inside it
   *  vertically (the tip may cross the side edges; a weapon whose tip pokes out where it points along the view goes to the pan stage instead, where a
   *  few centimetres of pan show it whole) */
  fitsStatic(d: number, lookY: number): boolean {
    const { lim, tx, ty, rim, pts, K, tipCut, cos, sin } = this;
    const inside = (x: number, y: number, z: number, lat: number): boolean => {
      const dep = depthOf(d, lookY, y, z);
      return dep > 1e-6 && Math.abs(x) <= lat * tx * dep && Math.abs(vertOf(lookY, y, z)) <= lim * ty * dep;
    };
    for (let i = 0; i < rim.length; i += 3) if (!inside(rim[i]!, rim[i + 1]!, rim[i + 2]!, lim)) return false;
    const xyz = pts.xyz, sArr = pts.s;
    for (let k = 0; k < K; k++) {
      const c = cos[k]!, s = sin[k]!;
      for (let i = 0, j = 0; i < xyz.length; i += 3, j++) {
        const x = xyz[i]!, y = xyz[i + 1]!, z = xyz[i + 2]!;
        if (!inside(c * x + s * z, y, -s * x + c * z, sArr[j]! > tipCut ? Infinity : lim)) return false;
      }
    }
    return true;
  }

  /**
   * The camera at the distance `d`: the look-at height (the union centred vertically where the hero stays whole), the pan per yaw (the smallest
   * that shows the hero and the weapon up to its tip; the tip itself too where that costs no more than the cap; where even the hero and the
   * weapon's body cannot share the frame, the hero whole at the margin on the side away from the weapon) and the largest cut of the weapon.
   */
  solve(d: number): Solution {
    const { hero, lim, tx, ty, rim, pts, K, tipCut, panMax, cos, sin } = this;
    const xyz = pts.xyz, sArr = pts.s, reach = pts.reach;
    const cap = panMax * d * N * tx;
    const fail = (lookY: number): Solution => ({ okCapped: false, lookY, pan: new Array(K).fill(0), cut: 1 });
    // the look-at height: the feasible interval of lookY from the hero rims and every weapon point at every yaw (two passes: the depth depends weakly on it)
    let lookY = (hero.y0 + hero.y1) / 2;
    let hLo = -Infinity, hHi = Infinity, vOk = true;
    for (let pass = 0; pass < 2; pass++) {
      hLo = -Infinity; hHi = Infinity;
      for (let i = 0; i < rim.length; i += 3) {
        const y = rim[i + 1]!, z = rim[i + 2]!, dep = depthOf(d, lookY, y, z);
        if (dep <= 1e-6) return fail(lookY);
        const vb = (y - PITCH * z) / N, w = lim * ty * dep;
        hLo = Math.max(hLo, N * (vb - w));
        hHi = Math.min(hHi, N * (vb + w));
      }
      let yLo = hLo, yHi = hHi;
      for (let k = 0; k < K; k++) {
        const c = cos[k]!, s = sin[k]!;
        for (let i = 0; i < xyz.length; i += 3) {
          const x = xyz[i]!, y = xyz[i + 1]!, z = -s * x + c * xyz[i + 2]!;
          const dep = depthOf(d, lookY, y, z);
          if (dep <= 1e-6) return fail(lookY);
          const vb = (y - PITCH * z) / N, w = lim * ty * dep;
          yLo = Math.max(yLo, N * (vb - w));
          yHi = Math.min(yHi, N * (vb + w));
        }
      }
      vOk = yLo <= yHi && hLo <= hHi;
      const want = vOk ? (yLo + yHi) / 2 : (hero.y0 + hero.y1) / 2;
      lookY = hLo <= hHi ? clamp(want, hLo, hHi) : want;
    }
    // the lateral pan per yaw: the hero's feasible camX interval (yaw invariant), the whole weapon's and the weapon body's (less the tip)
    let hP = -Infinity, hM = Infinity, hP2 = -Infinity, hM2 = Infinity; // the hero inside the margin, and inside the frame's real edge
    for (let i = 0; i < rim.length; i += 3) {
      const x = rim[i]!, w = tx * depthOf(d, lookY, rim[i + 1]!, rim[i + 2]!);
      hP = Math.max(hP, x - lim * w);
      hM = Math.min(hM, x + lim * w);
      hP2 = Math.max(hP2, x - w);
      hM2 = Math.min(hM2, x + w);
    }
    if (hP > hM) return fail(lookY);
    let okCapped = vOk, cut = 0;
    const pan: number[] = new Array(K).fill(0);
    for (let k = 0; k < K; k++) {
      const c = cos[k]!, s = sin[k]!;
      let aP = -Infinity, aM = Infinity, bP = -Infinity, bM = Infinity;
      for (let i = 0, j = 0; i < xyz.length; i += 3, j++) {
        const x0 = xyz[i]!, y = xyz[i + 1]!, z0 = xyz[i + 2]!;
        const x = c * x0 + s * z0, z = -s * x0 + c * z0;
        const w = lim * tx * depthOf(d, lookY, y, z), lo = x - w, hi = x + w;
        if (lo > aP) aP = lo;
        if (hi < aM) aM = hi;
        if (sArr[j]! <= tipCut) { if (lo > bP) bP = lo; if (hi < bM) bM = hi; }
      }
      // the body's pan: the smallest that shows the hero and the weapon up to its tip; when they cannot share the frame (a glaive longer than the
      // frame, or the two daggers of a dual weapon poking out on both sides) the pan that splits the shortfall between the two sides: the hero may
      // then use its margin band, never past the frame's real edge
      const nP = Math.max(hP, bP), nM = Math.min(hM, bM);
      let panBody: number;
      if (nP <= nM) panBody = clamp(0, nP, nM);
      else { panBody = clamp((nP + nM) / 2, hP2, hM2); okCapped = false; }
      if (Math.abs(panBody) > cap + 1e-9) okCapped = false;
      // the tip too when the whole weapon can fit and that costs no more than the cap (any pan between the two keeps every body inside); when the
      // whole cannot fit, chasing the tip would only cut the other side (dual weapons), so the body's pan stands
      const wP = Math.max(hP, aP), wM = Math.min(hM, aM);
      let p = panBody;
      if (wP <= wM) {
        const panWhole = clamp(0, wP, wM);
        p = panWhole >= 0 ? Math.max(panBody, Math.min(panWhole, cap)) : Math.min(panBody, Math.max(panWhole, -cap));
      }
      pan[k] = p;
      // the cut of the weapon at this yaw with this pan (the real frame edge, every weapon point)
      let minS = Infinity;
      for (let i = 0, j = 0; i < xyz.length; i += 3, j++) {
        const x0 = xyz[i]!, y = xyz[i + 1]!, z0 = xyz[i + 2]!;
        const x = c * x0 + s * z0, z = -s * x0 + c * z0;
        const dep = depthOf(d, lookY, y, z);
        if (dep <= 1e-6 || Math.abs(x - p) > tx * dep || Math.abs(vertOf(lookY, y, z)) > ty * dep) { if (sArr[j]! < minS) minS = sArr[j]!; }
      }
      if (minS < Infinity && reach > 0) cut = Math.max(cut, (reach - minS) / reach);
    }
    return { okCapped, lookY, pan, cut };
  }
}

/**
 * The preview camera for a hero of height `heroHeight` (its own, before the weapon), its cylinder `hero` over the shown pose(s) (previewBounds
 * without the held roots) and its held weapon(s) `pts` (heldPoints over the same poses; null without a weapon), for a vertical FOV `fovDeg` and the
 * frame `aspect`; `margin` is the fraction of the half frame kept free on every side (default 5 %). The stages are described at the top of the file.
 */
export function framePreview(heroHeight: number, hero: PreviewBounds, pts: PreviewPoints | null, fovDeg: number, aspect: number, margin = 0.05, opts: FrameOptions = {}): PreviewCamera {
  const lim = 1 - margin;
  const ty = Math.tan(((fovDeg * Math.PI) / 180) / 2), tx = ty * aspect;
  const K = Math.max(4, Math.round(opts.samples ?? YAW_SAMPLES));
  const old = heroOnlyFraming(heroHeight);
  const d0 = old.pos[2], y0 = old.look[1];
  const hh = Math.max(1e-3, hero.y1 - hero.y0);
  const share = (d: number): number => hh / (2 * d * N * ty);
  const zeros = (): number[] => new Array(K).fill(0);
  if (!pts || pts.reach <= 0 || pts.xyz.length < 3) return { dist: d0, lookY: y0, pan: zeros(), fit: 'hero', heroShare: share(d0), cut: 0 };
  const tipCut = (1 - clamp(opts.tipShare ?? TIP_SHARE, 0, 1)) * pts.reach;
  const fit = new Fitter(hero, pts, tipCut, K, lim, tx, ty, Math.max(0, opts.panMax ?? PAN_MAX));
  // 1. the old hero-only framing stays when the hero and the weapon up to its tip fit it centred at every yaw
  if (fit.fitsStatic(d0, y0)) return { dist: d0, lookY: y0, pan: zeros(), fit: 'hero', heroShare: share(d0), cut: fit.cutStatic(d0, y0) };
  // the hero floor: the camera never backs off so far that the hero is less than heroMin of the frame height (never closer than the old framing)
  const dMax = Math.max(d0, hh / (clamp((opts.heroMin ?? HERO_MIN) + HERO_HEADROOM, 0.05, 0.95) * 2 * ty) / N);
  // 2. the smallest distance at which the hero and the weapon body fit at every yaw with pans within the cap (more room with more distance)
  if (fit.solve(dMax).okCapped) {
    let lo = d0, hi = dMax;
    if (fit.solve(lo).okCapped) hi = lo;
    else for (let i = 0; i < 16; i++) { const mid = (lo + hi) / 2; if (fit.solve(mid).okCapped) hi = mid; else lo = mid; }
    const s = fit.solve(hi);
    return { dist: hi, lookY: s.lookY, pan: s.pan, fit: 'pan', heroShare: share(hi), cut: s.cut };
  }
  // 3. the hero floor binds: the cap is lifted, the weapon is cut as little as the pan allows
  const s = fit.solve(dMax);
  return { dist: dMax, lookY: s.lookY, pan: s.pan, fit: 'floor', heroShare: share(dMax), cut: s.cut };
}

/** a projector for a framing: NDC x / y and the depth of a point (the camera's real perspective, as maxNdc) */
export function projector(fr: PreviewFraming, fovDeg: number, aspect: number): (x: number, y: number, z: number) => { x: number; y: number; depth: number } {
  const [cx, cy, cz] = fr.pos;
  const f = new Vector3(fr.look[0] - cx, fr.look[1] - cy, fr.look[2] - cz).normalize();
  const r = new Vector3().crossVectors(f, new Vector3(0, 1, 0)).normalize();
  const u = new Vector3().crossVectors(r, f).normalize();
  const ty = Math.tan(((fovDeg * Math.PI) / 180) / 2), tx = ty * aspect;
  const p = new Vector3();
  return (x, y, z) => {
    p.set(x - cx, y - cy, z - cz);
    const depth = p.dot(f);
    if (depth <= 1e-6) return { x: Infinity, y: Infinity, depth };
    return { x: p.dot(r) / (depth * tx), y: p.dot(u) / (depth * ty), depth };
  };
}

/** what a {@link PreviewCamera} shows at a yaw: the hero's projected height share, the weapon's crossing share and NDC extents */
export interface FrameMeasure {
  /** the hero cylinder's projected height over the frame height */
  heroShare: number;
  /** the largest |NDC x| / |NDC y| of the hero cylinder */
  hero: { x: number; y: number };
  /** the share of the weapon's reach outside the frame: from the first point outside (|NDC| > 1) to the tip, over the reach; 0 = all inside */
  cross: number;
  /** the weapon's NDC extents */
  weapon: { x0: number; x1: number; y0: number; y1: number } | null;
}

/** measures a {@link PreviewCamera} at a yaw with the camera's real perspective (tests and the QA sweeps) */
export function frameMeasure(cam: PreviewCamera, hero: PreviewBounds, pts: PreviewPoints | null, yaw: number, fovDeg: number, aspect: number): FrameMeasure {
  const fr = cameraAt(cam, yaw);
  const proj = projector(fr, fovDeg, aspect);
  let hy0 = Infinity, hy1 = -Infinity, hx = 0, hy = 0;
  for (const y of [hero.y0, hero.y1]) {
    for (let k = 0; k < RIM; k++) {
      const a = (k / RIM) * Math.PI * 2;
      const n = proj(hero.r * Math.cos(a), y, hero.r * Math.sin(a));
      hy0 = Math.min(hy0, n.y); hy1 = Math.max(hy1, n.y);
      hx = Math.max(hx, Math.abs(n.x)); hy = Math.max(hy, Math.abs(n.y));
    }
  }
  let weapon: FrameMeasure['weapon'] = null, cross = 0;
  if (pts && pts.reach > 0) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, minS = Infinity;
    for (let i = 0, j = 0; i < pts.xyz.length; i += 3, j++) {
      const x = pts.xyz[i]!, y = pts.xyz[i + 1]!, z = pts.xyz[i + 2]!;
      const n = proj(c * x + s * z, y, -s * x + c * z);
      x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x); y0 = Math.min(y0, n.y); y1 = Math.max(y1, n.y);
      if (Math.abs(n.x) > 1 || Math.abs(n.y) > 1) minS = Math.min(minS, pts.s[j]!);
    }
    weapon = { x0, x1, y0, y1 };
    cross = Number.isFinite(minS) ? (pts.reach - minS) / pts.reach : 0;
  }
  return { heroShare: (hy1 - hy0) / 2, hero: { x: hx, y: hy }, cross, weapon };
}

/**
 * The cylinder of every mesh under `objects` (skinned meshes in their CURRENT pose: the caller updates the mixer first) in the frame of `pivot`
 * (the turntable group): the farthest vertex from the pivot's vertical axis and the vertical range. Every `stride`-th vertex; meshes under a node
 * of `skip` (the held weapon roots) are left out.
 */
export function previewBounds(objects: readonly Object3D[], pivot: Object3D, stride = 1, skip?: ReadonlySet<Object3D>): PreviewBounds {
  let r = 0, y0 = Infinity, y1 = -Infinity;
  pivot.updateMatrixWorld(true);
  const pinv = pivot.matrixWorld.clone().invert();
  const skipped = (m: Object3D): boolean => { for (let x: Object3D | null = m; x; x = x.parent) if (skip?.has(x)) return true; return false; };
  for (const o of objects) {
    o.updateMatrixWorld(true);
    o.traverse((m) => {
      if (skip && skipped(m)) return; // the hero alone (the held weapon roots are skipped)
      const mesh = m as Object3D & { isMesh?: boolean; geometry?: { getAttribute(n: string): { count: number } | undefined }; getVertexPosition?: (i: number, t: Vector3) => Vector3 };
      if (!mesh.isMesh || !mesh.geometry || !mesh.getVertexPosition) return;
      const pos = mesh.geometry.getAttribute('position');
      if (!pos) return;
      for (let i = 0; i < pos.count; i += stride) {
        mesh.getVertexPosition(i, _v);
        _v.applyMatrix4(mesh.matrixWorld).applyMatrix4(pinv);
        r = Math.max(r, Math.hypot(_v.x, _v.z));
        if (_v.y < y0) y0 = _v.y;
        if (_v.y > y1) y1 = _v.y;
      }
    });
  }
  if (!Number.isFinite(y0)) return { r: 0, y0: 0, y1: 0 };
  return { r, y0, y1 };
}
