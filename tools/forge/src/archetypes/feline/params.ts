import type { Rgb } from '../../core/paint/painter.ts';

/** Colours consumed by feline/paint.ts. Base albedo is a light/mid tone: game tints are multiplied on top. */
export interface FelinePalette {
  /** main coat on the back / flanks */
  coat: Rgb;
  /** lighter coat on shoulders, haunch tops, forehead */
  coatLight: Rgb;
  /** dark dorsal fade */
  coatDark: Rgb;
  /** belly, chest, inner legs, cheeks, muzzle */
  light: Rgb;
  /** stripes / markings */
  stripe: Rgb;
  /** secondary accent (ember glow, frost blue, gold) */
  accent: Rgb;
  /** hot core of the accent (flame yellow, ice white, gold highlight) */
  accentHot: Rgb;
  nose: Rgb;
  eye: Rgb;
  mouth: Rgb;
  /** ear inner / paw pads */
  inner: Rgb;
  claw: Rgb;
  /** horns / crystals / armour base colour (may equal `claw`) */
  horn: Rgb;
}

/** Coat pattern recipe */
export type FelinePattern =
  /** dense tapering vertical stripes, white belly/legs, 王 forehead mark */
  | 'tiger'
  /** charcoal hide with molten ember seams in stripe pattern, flame-tipped fur */
  | 'ember'
  /** snow lion: white shaggy fur with cold-blue shadows, ice-crystal accents */
  | 'frost'
  /** celestial tiger: white-gold coat with flowing gilt stripes, flame mane */
  | 'celestial';

export type ManeStyle = 'none' | 'fur' | 'flame';
export type RidgeStyle = 'none' | 'crystal' | 'ember' | 'gilt';

export interface FelineParams {
  id: string;
  kind: 'creature' | 'boss';
  seed: number;
  /** uniform scale (1 = a 1.1 m tall tiger) */
  scale: number;
  // ---- torso
  bodyLength: number;
  chestDepth: number;
  chestWidth: number;
  /** shoulder-blade prominence (stalking cats show the scapulae above the back line) */
  shoulderRise: number;
  /** hunched stalk: lowers the front, bends the legs (0 upright .. 1 stalking) */
  crouch: number;
  // ---- legs
  legLength: number;
  legThick: number;
  paw: number;
  /** visible claw length (0 = sheathed .. 1.5 = drawn talons) */
  claws: number;
  // ---- head / neck
  headScale: number;
  skullWidth: number;
  muzzleLength: number;
  muzzleWidth: number;
  /** upper canine length (0 hidden .. 2 sabre) */
  fangs: number;
  /** heaviness of the brow ridge */
  brow: number;
  neckThick: number;
  neckLength: number;
  earSize: number;
  // ---- tail
  tailLength: number;
  tailThick: number;
  /** -1 hanging .. 0 low horizontal S .. +1 held high */
  tailCurl: number;
  // ---- adornment
  /** cheek ruff (side-whiskers) 0..2 */
  cheekRuff: number;
  /** neck/chest/shoulder mane size (0 none .. 2 huge) */
  mane: number;
  maneStyle: ManeStyle;
  ridge: RidgeStyle;
  /** brow/temple horns (0 none .. 1.5) */
  horns: number;
  /** gilt armour: collar, bracers, forehead crest (tiger god) */
  regalia: boolean;
  /** war plates: shoulder + hip armour, forehead plate, bracers, bladed tail tip (fire tiger) */
  plates?: boolean;
  pattern: FelinePattern;
  palette: FelinePalette;
  // ---- mesh
  voxel?: number;
  tris?: number;
  texture?: number;
}
