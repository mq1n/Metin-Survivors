// Falling-body cue (owner: the telegraphs builder): what the boss-meteor warning needs on top of the ground decal, and the
// hand-off between the render-side decal system and the vfx layer.
//
//  - `telegraphHook`: the Telegraphs system (render) calls `onBegin` once for every NEW decal it starts to draw; the vfx route of
//    the telegraphs target (vfx/common/telegraphs/route.ts) installs the listener and fires the sprite layer (light shafts,
//    cinders, falling debris, dust haze, the closing scorch). Render code never imports vfx: this is a plain module-level slot,
//    a no-op until a listener is set (tests, the fx-overlay demo, a client without a vfx system).
//  - `isFallingBody`: which telegraph rows are "something falls here" (the boss meteor rain). The sim has no flag for it, so the
//    rows are recognised by the way bosses.ts creates them (owner boss, circle, Impact act, not following the boss, small
//    radius, knockback 2). Request in notes: a real `meteor` bit in the telegraph store.
//  - `fallPath`: the ballistic path of the falling debris: starts above and beside the circle, lands on its centre exactly at
//    resolve (y = H (1 - (t/T)^2): constant sideways drift, gravity chosen so that the body touches down at t = T).

//    contracting rings. The cue therefore sends debris + streaks, never a second big meteor (the sim's `sky.meteor` still plays
//    its own fall after the resolve).

/** TelegraphAct.Impact (sim/stores.ts; a const enum there, mirrored here as render code must not import the sim) */
const ACT_IMPACT = 2;
const ACT_METIN_IMPACT = 3;

/** does the resolve of a row with sim act `act` land an impact (slam / nova / meteor / metin)? */
export function isImpactAct(act: number): boolean {
  return act === ACT_IMPACT || act === ACT_METIN_IMPACT;
}

export interface TelegraphBegin {
  /** 0 enemy, 1 boss, 2 metin */
  owner: number;
  /** 0 circle, 1 cone, 2 line, 3 ring */
  shape: number;
  x: number;
  z: number;
  rot: number;
  radius: number;
  /** line length / ring inner radius */
  length: number;
  /** cone full angle / line width */
  width: number;
  element: number;
  /** metin id for owner 2 (rune lookup), else 0 */
  aux: number;
  /** warning time in seconds (0 = unknown, estimate) */
  dur: number;
  /** progress when the decal first drew (late starts skip the layer) */
  progress: number;
  /** a falling-body (boss meteor) row */
  meteor: boolean;
  /** the resolve lands an impact (TelegraphAct.Impact / MetinImpact): worth a scorch + dust payoff */
  impact: boolean;
}

export const telegraphHook: { onBegin: ((b: TelegraphBegin) => void) | null } = { onBegin: null };

/** is this row a boss meteor (see the file header)? `follow` / `act` / `knock` come from the sim store when the feed has them */
export function isFallingBody(owner: number, shape: number, act: number, follow: number, radius: number, knock: number): boolean {
  return owner === 1 && shape === 0 && act === ACT_IMPACT && follow === 0 && radius >= 0.8 && radius <= 4.2 && knock <= 2.05;
}

/** does the warning deserve the vfx sprite layer (shafts, cinders, scorch)? trash windups stay decal-only unless they are big */
export function wantsSpriteLayer(owner: number, shape: number, radius: number, length: number): boolean {
  if (owner >= 1) return true;
  if (shape === 2) return length >= 9;
  return radius >= 4;
}

export interface FallPath {
  /** start offset from the impact point */
  ox: number;
  oy: number;
  oz: number;
  /** constant lateral velocity (m/s) */
  vx: number;
  vz: number;
  /** vertical acceleration (negative) */
  g: number;
  /** fall time (s) */
  T: number;
}

/** start height for a circle of `radius`: higher for bigger bodies, never above the camera's useful range */
export function fallHeight(radius: number): number {
  return Math.min(14, 9 + radius * 1.4);
}

/** path of a body that touches down at the circle centre exactly after T seconds; `angle` picks the side it comes from */
export function fallPath(T: number, radius: number, angle: number): FallPath {
  const H = fallHeight(radius);
  const side = H * 0.45;
  const ox = Math.sin(angle) * side;
  const oz = -Math.abs(Math.cos(angle)) * side * 0.8 - 1.2;
  const t = Math.max(0.05, T);
  return { ox, oy: H, oz, vx: -ox / t, vz: -oz / t, g: (-2 * H) / (t * t), T: t };
}

/** height above the ground after `t` seconds of the fall (0 at t = T) */
export function heightAtFall(p: FallPath, t: number): number {
  const u = Math.min(Math.max(t, 0), p.T);
  return Math.max(0, p.oy + 0.5 * p.g * u * u);
}

/** where the ground shadow of the body is at `t`: grows from a speck to the circle radius as the body descends (0..1) */
export function shadowGrowth(p: FallPath, t: number): number {
  const h = heightAtFall(p, t);
  return 1 - Math.min(1, h / p.oy);
}
