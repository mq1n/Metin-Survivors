// Arthropod archetype parameters. Two families share one skeleton/leg-rig/gait toolkit but have their own body plan:
//   scorpion : flat plated prosoma + 7 mesosoma tergites, raised 5-segment metasoma with telson, two pedipalp claws, 8 legs
//   beetle   : domed elytra pair, pronotum + head with mandibles/antennae, crystal horns + dorsal crystal fan, 6 legs
import type { Rgb } from '../../core/paint/painter.ts';

export interface ArthropodBase {
  id: string;
  kind: 'creature';
  seed: number | string;
  /** overall scale on every anatomical dimension (1 = authored size) */
  scale: number;
  /** baked texture size (default 1024) */
  texture?: number;
  /** override surface-nets cell size (metres, pre-scale) */
  voxel?: number;
  /** override triangle target */
  tris?: number;
}

export interface ScorpionPalette {
  /** main chitin */
  chitin: Rgb;
  /** sun-bleached highlights on plates */
  light: Rgb;
  /** shadowed chitin */
  dark: Rgb;
  /** plate seams, grooves */
  edge: Rgb;
  /** joint membranes */
  joint: Rgb;
  /** underside */
  belly: Rgb;
  /** tail / telson body */
  tail: Rgb;
  /** stinger glow tone */
  sting: Rgb;
  /** stinger tip */
  stingTip: Rgb;
  /** claws / spine tips */
  claw: Rgb;
  eye: Rgb;
}

export interface ScorpionParams extends ArthropodBase {
  family: 'scorpion';
  /** body flatness / width multipliers */
  bodyWidth: number;
  bodyLength: number;
  /** tail length multiplier (segment length) */
  tailLength: number;
  /** extra tail height (arch) */
  tailArch: number;
  tailThick: number;
  /** pincer size multiplier */
  clawSize: number;
  /** how far the pincers are open at rest (0..1) */
  clawOpen: number;
  legThick: number;
  /** body ride height above the ground multiplier */
  stance: number;
  /** spine / granule intensity 0..1.5 */
  spines: number;
  palette: ScorpionPalette;
}

export interface BeetlePalette {
  /** deep core blue */
  deep: Rgb;
  /** shell body blue */
  shell: Rgb;
  /** bright cyan */
  cyan: Rgb;
  /** near-white rim */
  frost: Rgb;
  /** crystal body */
  crystal: Rgb;
  /** crystal tips */
  crystalTip: Rgb;
  /** underside / abdomen */
  belly: Rgb;
  /** legs (femur) */
  leg: Rgb;
  /** warm lower-leg accent (tibia / tarsus) */
  accent: Rgb;
  /** leg claws / mandible tips */
  claw: Rgb;
  /** eye glow */
  eye: Rgb;
  /** vein / crack tint under the shell */
  vein: Rgb;
}

export interface BeetleParams extends ArthropodBase {
  family: 'beetle';
  /** elytra dome length / width multipliers */
  bodyLength: number;
  bodyWidth: number;
  bodyHeight: number;
  /** main horn length multiplier */
  hornLength: number;
  /** dorsal crystal fan: count and height multiplier */
  crystals: number;
  crystalHeight: number;
  mandible: number;
  legThick: number;
  stance: number;
  palette: BeetlePalette;
}

export type ArthropodParams = ScorpionParams | BeetleParams;
