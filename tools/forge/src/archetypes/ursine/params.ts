import type { Rgb } from '../../core/paint/painter.ts';

/** Coat recipe consumed by ursine/paint.ts. The BASE colours must stay light/mid: the game multiplies roster tints into the albedo. */
export interface UrsinePalette {
  /** dorsal saddle / hump undercoat */
  back: Rgb;
  /** flanks, haunch, main body */
  flank: Rgb;
  /** belly, inner arms, chest underside */
  light: Rgb;
  /** guard-hair tips (golden grizzling on the cape) */
  tip: Rgb;
  /** lower legs / ear backs / paw fur */
  dark: Rgb;
  /** muzzle & cheeks */
  muzzle: Rgb;
  nose: Rgb;
  eye: Rgb;
  /** inner mouth / tongue */
  mouth: Rgb;
  /** ear inner / pads */
  inner: Rgb;
  claw: Rgb;
}

export interface UrsineParams {
  id: string;
  kind: 'creature' | 'boss';
  seed: number;
  /** uniform scale (1 = hump height ~1.35 m) */
  scale: number;
  // ---- torso
  /** torso length stretch behind the shoulders (1 = reference) */
  bodyLength: number;
  /** barrel girth multiplier */
  girth: number;
  /** shoulder hump size (0 flat back .. 1.5 pronounced) */
  hump: number;
  // ---- legs
  legLength: number;
  legThick: number;
  /** paw size multiplier */
  paw: number;
  /** claw length multiplier */
  claw: number;
  // ---- head
  headScale: number;
  snoutLength: number;
  earSize: number;
  // ---- tail
  tailLength: number;
  // ---- fur
  /** shagginess: length/amount of the silhouette fur locks (0 sleek .. 1.5 shaggy) */
  fur: number;
  palette: UrsinePalette;
  /** mesh detail */
  voxel?: number;
  tris?: number;
  /** albedo texture size (px); 0 = vertex colours only */
  texture?: number;
}
