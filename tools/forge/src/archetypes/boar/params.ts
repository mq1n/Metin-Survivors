import type { Rgb } from '../../core/paint/painter.ts';

/**
 * Boar colouring. The albedo is a LIGHT/MID base: the game multiplies a per-enemy tint into it (linear), so every channel
 * must keep headroom (no near-black hide) and the mane must carry the warm hue that red tints turn into a red boar.
 */
export interface BoarPalette {
  /** flank / main body hide */
  hide: Rgb;
  /** dark underparts: lower legs, belly line, face mask, shoulder shield */
  dark: Rgb;
  /** mid-to-pale belly / inner leg / chest */
  belly: Rgb;
  /** bristle saddle (mane colour on the upper back, nape and shoulders) */
  mane: Rgb;
  /** pale hair tips and grizzle */
  tip: Rgb;
  /** warm rust streaks running through the saddle */
  rust: Rgb;
  /** dark dorsal band + dark bristle roots */
  ridge: Rgb;
  /** cheek / jaw hair */
  cheek: Rgb;
  /** rhinarium disc */
  snout: Rgb;
  nostril: Rgb;
  hoof: Rgb;
  hoofDark: Rgb;
  tusk: Rgb;
  eye: Rgb;
  mouth: Rgb;
  /** inside of the ear */
  inner: Rgb;
}

export interface BoarParams {
  id: string;
  kind: 'creature' | 'boss';
  seed: number;
  /** uniform scale (1 = withers height ~0.75 m, overall height 0.85 m with the bristle ridge) */
  scale: number;
  /** tusk length multiplier */
  tusk: number;
  /** bristle ridge height multiplier */
  mane: number;
  palette: BoarPalette;
  voxel?: number;
  tris?: number;
  /** albedo texture size (px); 0 = vertex colours only */
  texture?: number;
}
