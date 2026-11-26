// Aquatic archetype parameters: a heavy orca-hybrid that hovers a hand above the ground on two paddle-fins (ice whale).
import type { Rgb } from '../../core/paint/painter.ts';

export interface AquaticPalette {
  /** deep slate-blue back */
  back: Rgb;
  /** upper flank */
  flank: Rgb;
  /** white-cyan belly + eye patch */
  belly: Rgb;
  /** frosty crust (barnacle plates) body colour */
  crust: Rgb;
  /** bright crust highlight */
  crustHi: Rgb;
  /** crust crevice (cool deep blue) */
  crustLo: Rgb;
  /** ice crystal base / mid / tip */
  iceLo: Rgb;
  iceMid: Rgb;
  iceHi: Rgb;
  /** teeth */
  tooth: Rgb;
  /** gums / lips */
  gum: Rgb;
  /** inside of the mouth (palate) */
  mouth: Rgb;
  tongue: Rgb;
  /** warm accent: fin claws, scar glints */
  ember: Rgb;
  eye: Rgb;
}

export interface AquaticParams {
  id: string;
  kind: 'creature' | 'boss';
  seed: number;
  /** uniform scale (1 = ~3.2 m nose-to-fluke, 1.5 m with the dorsal fin) */
  scale: number;
  /** pectoral fin reach multiplier */
  finSpan: number;
  /** forehead horn height multiplier */
  horn: number;
  /** back-crest crystal size multiplier */
  crest: number;
  /** barnacle plate density multiplier */
  crust: number;
  /** bind-pose mouth opening (radians); clips close it by this amount */
  gape: number;
  palette: AquaticPalette;
  voxel?: number;
  tris?: number;
  texture?: number;
}
