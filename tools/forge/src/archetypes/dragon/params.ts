// Dragon archetype parameters. One serpentine-necked, winged, four-legged dragon; variants differ by proportion + palette.
import type { Rgb } from '../../core/paint/painter.ts';

export interface DragonPalette {
  /** deep shadow scale colour (scale gaps, underside of plates) */
  scaleDark: Rgb;
  /** main body colour */
  scale: Rgb;
  /** sun-lit scale tops */
  scaleLight: Rgb;
  /** dorsal stripe / plate edges / accents */
  gold: Rgb;
  /** belly plates */
  belly: Rgb;
  /** horn root -> tip */
  hornDark: Rgb;
  hornTip: Rgb;
  claw: Rgb;
  tooth: Rgb;
  /** wing membrane root / trailing edge */
  membrane: Rgb;
  membraneEdge: Rgb;
  /** wing finger bones */
  bone: Rgb;
  /** eye iris */
  eye: Rgb;
  /** inner mouth */
  mouth: Rgb;
  /** emissive colour cores: ember (deep orange) and heat (yellow-white) */
  ember: Rgb;
  heat: Rgb;
}

export interface DragonParams {
  id: string;
  kind: 'boss' | 'creature';
  seed: number;
  /** uniform scale (1 = standing head height ~6.4 m, wing span ~11.5 m at rest / 14 m extended) */
  scale: number;
  /** head size multiplier (1 = skull-to-nose 1.8 m at scale 1) */
  headScale?: number;
  palette: DragonPalette;
  /** baked texture size (px); 0 = vertex colours only */
  texture?: number;
  /** surface-nets cell size at scale 1 (metres) */
  voxel?: number;
  /** final triangle target */
  tris?: number;
  /** footprint radius override (metres, post scale) */
  radius?: number;
}
