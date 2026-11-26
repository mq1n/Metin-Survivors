import type { Rgb } from '../../core/paint/painter.ts';

/** Fur pattern recipe consumed by canine/paint.ts */
export interface CaninePalette {
  /** dark back / saddle colour */
  back: Rgb;
  /** flank / main body colour */
  flank: Rgb;
  /** belly, chest, inner legs, muzzle underside */
  light: Rgb;
  /** accent for ear backs / tail tip / socks */
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
  /** spirit-fire colour for tail tips / ember accents (enables an emissive map) */
  spirit?: Rgb;
}

export type CoatPattern =
  /** dark saddle over lighter flanks, pale cheeks, cream belly (timber wolf) */
  | 'saddle'
  /** solid with pale belly + white blaze, patchy back (mutt/dog) */
  | 'patch'
  /** frost mane: dark back fading to silver, white mask and chest */
  | 'frost'
  /** banded agouti guard hairs, dark mask, dark dorsal stripe */
  | 'agouti';

export interface CanineParams {
  id: string;
  kind: 'creature' | 'boss';
  seed: number;
  /** uniform scale (1 = shoulder height ~0.72 m) */
  scale: number;
  // ---- torso
  bodyLength: number;
  chestDepth: number;
  chestWidth: number;
  /** extra raise of the withers (hunched alpha) */
  hump: number;
  /** predatory crouch: lowers the torso over bent legs (0 upright, 1 stalking) */
  crouch: number;
  // ---- legs
  legLength: number;
  legThick: number;
  /** paw size multiplier */
  paw: number;
  // ---- head / neck
  headScale: number;
  skullWidth: number;
  snoutLength: number;
  snoutWidth: number;
  neckLength: number;
  neckThick: number;
  /** 0 erect .. 1 folded over */
  earFold: number;
  earSize: number;
  // ---- tail
  tailLength: number;
  tailThick: number;
  /** -1 hanging .. 0 horizontal-ish low .. +1 curled up over the back */
  tailCurl: number;
  /** total tails (default 1). >1 adds a fan of 2-bone tails `tailF<m>_1/_2` around the main tail (Miho = 9) */
  tails?: number;
  /** exposed ribs / spine knobs / sunken flanks (plague), 0..1 */
  ribs?: number;
  /** diseased fur loss + sores, 0..1 */
  mange?: number;
  // ---- fur
  /** neck ruff size (0 none, 1 standard, 2 huge) */
  ruff: number;
  /** spiky dorsal mane (0..1) */
  mane: number;
  /** leg / cheek / tail tufts amount (0..1.5) */
  tufts: number;
  /** facial scar on the left side (alphas) */
  scar: boolean;
  pattern: CoatPattern;
  palette: CaninePalette;
  /** mesh detail */
  voxel?: number;
  tris?: number;
  /** albedo texture size (px); 0 = vertex colours only */
  texture?: number;
}
