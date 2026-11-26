// Humanoid archetype parameters. One body generator serves heroes (4 classes x 2 sexes x 4 armour tiers + wolfman), humanoid
// enemies and bosses: proportions come from `build`, looks from `outfit`, `hair`, `skin` and `palette`.
import type { ClipSpec } from '../../core/anim/clip.ts';
import type { Vec3 } from '../../core/math.ts';
import type { FocusRegion } from '../../core/mesh/simplify.ts';
import type { SkinOpts } from '../../core/skin/weights.ts';
import type { Skeleton } from '../../core/skin/skeleton.ts';
import type { Anatomy } from './anatomy.ts';
import type { StyleDef } from './anim/clips.ts';
import type { Ctx } from './kit/ctx.ts';
import type { PieceEnv } from './outfit/util.ts';
import type { HumanoidPaint } from './paint.ts';

export type Sex = 'm' | 'f';
export type HeadKind = 'human' | 'wolf';

/** weapon style that drives the stance and attack clips */
export type WeaponStyle = 'sword1h' | 'sword2h' | 'dagger' | 'bow' | 'fan' | 'bell' | 'claw' | 'spear' | 'club' | 'fist' | 'staff' | 'axe2h' | 'none';

/** Body proportion multipliers, 1 = reference adult of the chosen sex. */
export interface Build {
  shoulder: number;
  chest: number;
  waist: number;
  hips: number;
  arms: number;
  forearms: number;
  legs: number;
  calves: number;
  neck: number;
  hands: number;
  feet: number;
  head: number;
  /** leg length multiplier (torso fixed): changes the sole -> hip height */
  legLength: number;
  armLength: number;
  /** 0..1.3 muscle relief (deltoids, biceps, pecs, quads, calves) */
  muscle: number;
  /** 0..1 bust (female) */
  bust: number;
  /** forward torso lean in radians (hunch) */
  lean: number;
  /** extra forward head carriage (m) */
  headForward: number;
  /** stance width multiplier (feet apart) */
  stance: number;
  /** arm abduction in the rest pose, radians (A-pose angle) */
  armSpread: number;
}

export interface FaceParams {
  /** 0..1 jaw squareness / strength */
  jaw: number;
  /** brow ridge heaviness 0..1 */
  brow: number;
  nose: number;
  /** lip fullness */
  lips: number;
  /** eye size multiplier */
  eyes: number;
  /** cheekbone prominence */
  cheeks: number;
  /** slant of the eyes (+ = outer corners up) */
  slant: number;
  ears: number;
}

export interface SkinPalette {
  base: string;
  shade: string;
  /** lips / nails / flush */
  lip: string;
  eye: string;
  brow: string;
  /** scar / tattoo ink */
  mark?: string;
}

export type HairStyle =
  | 'none'
  | 'topknot' // tied warrior knot with side locks
  | 'short' // cropped
  | 'ponytail'
  | 'long' // loose long hair to the shoulder blades
  | 'spiky' // wild upswept spikes
  | 'bun' // coiled bun (shaman / female)
  | 'braid'
  | 'swept' // long swept-back mane (yacha)
  | 'wolf'; // lupine head fur (wolfman)

export interface HairParams {
  style: HairStyle;
  color: string;
  highlight?: string;
  /** hair bulk multiplier */
  volume?: number;
  /** extra length multiplier for the trailing parts (ponytail, mane) */
  length?: number;
}

/** an outfit piece: `id` selects a builder from the outfit library, `mat` a material colour set, the rest is per-piece options */
export interface PieceSpec {
  id: string;
  /** palette key: resolved by paint ('cloth', 'cloth2', 'leather', 'plate', 'lacquer', 'gold', ...) */
  mat?: string;
  /** free-form tuning (sizes, variants) read by the piece builder */
  o?: Record<string, number | string | boolean>;
  /** custom builder: when set, `id` is only a label and this function adds the geometry (see PieceEnv / cover / Ctx) */
  build?: (e: PieceEnv) => void;
  /** default material key for a custom piece (default 'cloth') */
  defMat?: string;
}

/** extension points for archetype users (enemies, bosses): every hook is optional */
export interface HumanoidHooks {
  /** replace the head (default: human or wolf head per `head`) with your own SDF parts: orc, tusks, beast... */
  head?: (ctx: Ctx) => void;
  /** called after the nude body, before hair/outfit: add extra anatomy (tails, extra arms, horns, spikes, fur) */
  afterBody?: (ctx: Ctx) => void;
  /** called after hair and outfit pieces: props, banners, ornaments. Reserve paint with ctx.piece(mat) and tag parts with the returned `tag`. */
  afterOutfit?: (ctx: Ctx) => void;
  /** adjust the paint stack (append layers, replace skin look) */
  paint?: (paint: HumanoidPaint, a: Anatomy) => HumanoidPaint;
  /** adjust or replace the clip set (e.g. add special1..3, drop unused clips) */
  clips?: (clips: ClipSpec[], a: Anatomy, sk: Skeleton) => ClipSpec[];
}

export interface MeshOverrides {
  voxel?: number;
  tris?: number;
  focus?: FocusRegion[];
  relax?: number;
  normalStep?: number;
  skin?: SkinOpts;

}

export interface Palette {
  /** named colours (hex sRGB) used by materials; pieces refer to them with `mat` */
  [name: string]: string;
}

export interface RigOpts {
  /** coat / skirt flap bones (front, back, left, right) */
  skirt?: boolean;
  /** hair chain bones: 0 none, 1-3 segments */
  hairBones?: number;
  /** scarf chain segments (trail from the neck) */
  scarfBones?: number;
  /** cape chain segments */
  capeBones?: number;
  /** tail chain segments (wolfman) */
  tailBones?: number;
  /** wolf ear bones */
  earBones?: boolean;
}

export interface HumanoidParams {
  id: string;
  kind: 'hero' | 'creature' | 'boss';
  seed: number | string;
  sex: Sex;
  /** sole to top of skull, metres (hair / helm crests add on top) */
  bodyHeight: number;
  build?: Partial<Build>;
  face?: Partial<FaceParams>;
  head?: HeadKind;
  skin: SkinPalette;
  hair: HairParams;
  /** ordered outfit layers, inner to outer */
  outfit: PieceSpec[];
  palette: Palette;
  style: WeaponStyle;
  /** secondary-doctrine weapon style: the clips are also exported with a `_b` suffix (idle_b, attack_b ...) */
  styleB?: WeaponStyle;
  rig?: RigOpts;
  /** which armour tier this is (0-3), informs animation weight and paint wear */
  tier?: number;
  /** emit an emissive map (rune glow) */
  glow?: { color: string; tags: string[] } | undefined;
  /** baked albedo size */
  texture?: number;
  /** surface-nets cell (m) */
  voxel?: number;
  tris?: number;
  /** full mesh/skin overrides (crowd enemies: voxel 0.008, tris 4500) */
  mesh?: MeshOverrides;
  hooks?: HumanoidHooks;
  /** custom weapon-style definitions (merged over the built-in STYLES) */
  styles?: Partial<Record<WeaponStyle, StyleDef>>;
  /** low-detail hands: palm + fingers as one mitten (saves ~400 tris on crowd enemies) */
  liteHands?: boolean;
  /** authored ground speeds, m/s */
  speed?: { walk: number; run: number };
  /** cosmetic extras (e.g. 'weapon grip pose') */
  extras?: Record<string, unknown>;
}

export const DEFAULT_BUILD: Build = {
  shoulder: 1,
  chest: 1,
  waist: 1,
  hips: 1,
  arms: 1,
  forearms: 1,
  legs: 1,
  calves: 1,
  neck: 1,
  hands: 1,
  feet: 1,
  head: 1,
  legLength: 1,
  armLength: 1,
  muscle: 0.6,
  bust: 0,
  lean: 0,
  headForward: 0,
  stance: 1,
  armSpread: 0.3,
};

export const DEFAULT_FACE: FaceParams = { jaw: 0.5, brow: 0.5, nose: 0.5, lips: 0.5, eyes: 1, cheeks: 0.5, slant: 0.15, ears: 1 };

export type Side = 1 | -1; // +1 = character's left (+X), -1 = right (-X)
export const sideName = (sx: Side): 'l' | 'r' => (sx === 1 ? 'l' : 'r');
export const mirrorV = (v: Vec3, sx: Side): Vec3 => [v[0] * sx, v[1], v[2]];
