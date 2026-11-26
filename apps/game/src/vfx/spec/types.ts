
// Units: metres, seconds, degrees for authored angles. Local frame of an effect: +Z = caster facing, +Y = up,

import type { TexRole } from './roles';

/**
 * Elements the host compiles per list (`elements` and `impact` each): the per-instance emitter state is MAX_ELEMENTS x 64 floats
 * (host.ts SInst), about 12 kB per instance at 40. The ONE definition: host.ts, the patch check (patch.ts re-exports it) and the
 * tests read it from here. Rank-gated elements count too (the host compiles the list as it is), so a family may hold up to this many.
 */
export const MAX_ELEMENTS = 40;

/** Piecewise-linear curve, flat `[t0, v0, t1, v1, …]` (t ascending). One key = constant. Clamped outside the keys. */
export type Curve = readonly number[];
/** Colour curve, flat `[t, 0xRRGGBB, alpha, …]`. */
export type ColorCurve = readonly number[];
export type Vec3 = readonly [number, number, number];
export type Blend = 'add' | 'alpha';











export type SpaceMode = 'display' | 'linear';
/** quality tier index: 0 low, 1 medium, 2 high, 3 ultra */
export type TierIdx = 0 | 1 | 2 | 3;

/** Sim behaviours that consume `def.vfx` (sim/skills/behaviors). */
export type SkillBehavior =
  | 'meleeArc'
  | 'spinAura'
  | 'persistentAura'
  | 'selfBuff'
  | 'dash'
  | 'leap'
  | 'shockwave'
  | 'groundZone'
  | 'skyStrike'
  | 'projectile'
  | 'homingProjectile'
  | 'beam'
  | 'chain'
  | 'cone'
  | 'orbit'
  | 'summon';







export type Place = 'origin' | 'target' | 'along';

/**
 * Body anchors of the caster, resolved every frame from the hero's skinned sockets (GLB extras, ARCHITECTURE §5.1):
 *  - `hand_r` `hand_l` `head` `chest`: the bone position; frame = the caster's facing (+Z forward, +Y up, −X right)
 *  - `weapon`: the blade TIP of the weapon in hand_r; frame +Y = along the blade toward the tip, +Z = cutting edge
 *  - `root`: the caster's feet (facing frame)
 * Galleries / compare strips use a stand-in body with fixed offsets and a scripted swing (sockets.ts).
 */
export type SocketName = 'root' | 'hand_r' | 'hand_l' | 'weapon' | 'head' | 'chest';






export interface ArtTex {
  /**
   * A manifest sprite id, or the ordered frame ids of a flipbook made of separate sprites
   * (`['vfx_bolt_wavy_h_1', …, 'vfx_bolt_wavy_h_6']`): the loader packs the frames into consecutive cells of the art
   * array, so the list animates like a sheet (`frames.fps` / `random` / `mode` as for any flipbook; generated art hard-cuts
   * between frames by default, see FrameMode). Same-size frames; every
   * frame must ship, else the whole list draws `fallback`.
   */
  art: string | readonly string[];
  /** procedural role drawn when the sprite is missing (default 'glow') */
  fallback?: TexRole;
  /** single-image sheet layout: columns, rows (default: the manifest entry's `grid`, else 1 × 1); ignored for a frame list */
  grid?: readonly [number, number];
  /** frames used: of a single-image sheet, read left → right, top → bottom (default columns × rows); of a frame list,
   *  the first n ids (default all) */
  frames?: number;
}









export type FrameMode = 'cut' | 'blend' | 'random';

/** texture of an element: a procedural role of the spec atlas or a generated sprite */
export type TexSrc = TexRole | ArtTex;


export type Grade = 0 | 1 | 2 | 3;





export interface Grades<T> {
  g1?: Partial<T>;
  g2?: Partial<T>;
  g3?: Partial<T>;
}

/** fields every element kind understands */
export interface ElementCommon {
  /** stable id of the element inside its spec, written by the converter ('<mse basename>#<index in that effect file>', see "Generated
   *  families + patches" in the README); the address of override patches (spec/patch.ts). Ignored by the runtime. */
  key?: string;
  /** free text: what this element is in the reference (texture name, role) */
  note?: string;
  /** lowest quality tier that draws this element (default 0) */
  minTier?: TierIdx;
  /** lowest / highest skill rank (0..7 = 1,2,3,M1,M2,G1,G2,P) that draws this element (default 0 / 7) */
  minRank?: number;
  maxRank?: number;
  /**
   * readability on bright floors (snow, pale stone): share 0..1 of an ADDITIVE element's alpha that also darkens what is
   * behind it (premultiplied "soft core" in the same draw call; 0 = pure additive). Default FxSpec.occlude, else 0.
   */
  occlude?: number;
  /** HDR ceiling of the element's linear colour (e.g. 1 = never brighter than display white: no white-out / bloom
   *  blow-out when layers stack). Default FxSpec.clamp, else none. */
  clamp?: number;
  /** additive elements: the colour space the element blends in (see SpaceMode). Default FxSpec.space, else by provenance. */
  space?: SpaceMode;
  






  square?: boolean;
  /** socket-anchored elements and trails live at body scale (k = gradeScale only); true = also × the area scale */
  areaScale?: boolean;
  




  front?: boolean;
  /**
   * multi-pulse casts (FxSpec.castGap): 'first' = only the first pulse of a cast plays this element (the big flash, the
   * fire spray), 'later' = only pulses 2.. of the cast (a thinner echo). Default: every pulse.
   */
  pulse?: 'first' | 'later';
}


export interface ParticleSpec extends ElementCommon {
  kind: 'particle';
  /** StartTime, s */
  t0?: number;
  /** one-shots: `t0` counts from (caller's `duration` - tEnd) instead of the spawn, so an element can sit at the END of a
   *  moving effect (dash: duration = travel time + 0.2, `tEnd: 0.2` = the arrival at any rank / range). Backward compatible:
   *  unset = t0 from the spawn; loops and a missing caller duration (spec `dur` is used) behave as before. */
  tEnd?: number;
  /** CycleLength, s: emitter curves are sampled on the cycle-local time */
  cycle: number;
  /** cycles to run (CycleLoopEnable + LoopCount): default 1, 0 = repeat while the effect lives */
  loops?: number;
  /** MaxEmissionCount: max particles alive for this element */
  max: number;
  /** particles / s over cycle time */
  rate: Curve;
  /** particle life s over cycle time */
  life: Curve;
  /** emitter shape: point (default) | sphere / ellipse (radius, `edge` = on the surface) | box (full extents) */
  shape?: { kind: 'point' | 'sphere' | 'ellipse' | 'box'; radius?: number; edge?: boolean; box?: Vec3; size?: Curve };
  /** EmitterAdvancedType: free (default) | outer (away from centre at 1 m/s × vel) | inner (toward centre) */
  adv?: 'free' | 'outer' | 'inner';
  /** emitter offset in the local frame (or the socket frame), metres */
  at?: Vec3;
  place?: Place;
  
  path?: { x?: Curve; y?: Curve; z?: Curve };
  









  travel?: Curve;
  /** TimeEventEmittingDirection (local frame, unitless): velocity = (dir + jitter) × vel */
  dir?: { x?: Curve; y?: Curve; z?: Curve };
  
  jitter?: Vec3;
  /** TimeEventEmittingVelocity / 100 (so velocity comes out in m/s) */
  vel?: Curve;
  /** quad half extents (TimeEventSizeX/Y), metres, over cycle time; one curve = square */
  half: Curve | readonly [Curve, Curve];
  /** TimeEventScaleX/Y over life fraction; one curve = uniform; default constant 1 */
  scale?: Curve | readonly [Curve, Curve];
  /** colour + alpha over life fraction */
  color: ColorCurve;
  /** gravity over life, m/s² (positive pulls down) */
  gravity?: Curve;
  
  air?: Curve;
  
  billboard: 'screen' | 'ground' | 'upright' | 'stretch';
  






  stretchU?: boolean;
  




  faces?: 1 | 2 | 3;
  /** RotationRandomStarting [begin, end] deg; spin deg/s (sign = direction, `randomDir` flips half of them) */
  rotation?: { start?: readonly [number, number]; spin?: number; randomDir?: boolean };
  /** TimeEventEmittingAngularVelocity: deg per 1/60 s around local up, over cycle time (swirling emitters) */
  swirl?: Curve;
  /**
   * AttachEnable: `true` = particles live in the emitter (effect anchor) frame and follow it; a socket name = they live
   * in that body socket's frame and follow it every frame (orb in the hand, glow on the blade)
   */
  attach?: boolean | SocketName;
  /** the emitter rides this body socket but the particles stay where they were born (sparks shed by the blade tip,
   *  embers from the hand); `at` / `shape` / `dir` are in the socket frame */
  from?: SocketName;
  blend: Blend;
  
  bright?: number;
  tex: TexSrc;
  /** texture animation: frames of the role's flipbook; `fps` 0 = once over the particle life; `random` = the particle
   *  starts on a random frame (texanirandomstartframeenable); `mode` = how frames change (see FrameMode) */
  frames?: { fps?: number; random?: boolean; mode?: FrameMode };
  
  grade?: Grades<Omit<ParticleSpec, 'kind' | 'grade'>>;
}

export type SurfaceShape =
  /** textured quad w × h in the local XY plane (faces +Z), `bend` = cylindrical bend in radians across w */
  | { kind: 'card'; w: number; h: number; bend?: number }
  /** flat annulus sector in the local XZ plane: inner/outer radius, span deg (360 = ring/disc), a0 start deg (0 = +Z, + toward +X),
   *  `taper` 0..1 narrows both ends (crescent slashes) */
  | { kind: 'arc'; r0: number; r1: number; span: number; a0?: number; taper?: number }
  


  | { kind: 'cyl'; rb: number; rt: number; h: number; span?: number; bulge?: number }
  /** sphere shell / dome: radius, latitude range deg (-90..90) */
  | { kind: 'sphere'; r: number; lat0?: number; lat1?: number }
  /** helix ribbon around local +Y: radius, span deg, rise metres over the span, width; `wall` = vertical band, else flat */
  | { kind: 'ribbon'; r: number; span: number; rise?: number; w: number; wall?: boolean; a0?: number }
  /** helix tube (wind swirl, dragon coil): path radius, span deg, rise, tube radius, `taper` 0..1 thins the tail */
  | { kind: 'tube'; r: number; span: number; rise?: number; tr: number; taper?: number; a0?: number }
  /** camera-facing lightning strip along local +Z: length, width, jaggedness 0..1, re-strike rate Hz */
  | { kind: 'bolt'; len: number; w: number; jag?: number; hz?: number };


export interface SurfaceSpec extends ElementCommon {
  kind: 'surface';
  t0?: number;
  /** element life, s (one pass of the curves) */
  life: number;
  /** repeat the life period until the effect ends / is stopped */
  loop?: boolean;
  shape: SurfaceShape;
  at?: Vec3;
  place?: Place;
  /** static orientation in the local frame, deg: yaw (about +Y), pitch (about +X), roll (about +Z) */
  rot?: Vec3;
  /** none (default, uses rot) | screen (faces camera, cards) | upright (yaw toward camera) */
  billboard?: 'none' | 'screen' | 'upright';
  /** follows the effect anchor (default true for follow/projectile effects, false in world); a socket name = follows
   *  that body socket every frame (`at` / `rot` in the socket frame: a card along the blade, a ring around the hand) */
  attach?: boolean | SocketName;
  /** animated over element life fraction u: size multipliers (one curve = uniform, or x/y/z) */
  scale?: Curve | readonly [Curve, Curve, Curve];
  color: ColorCurve;
  /** reveal window along the shape's u axis: head and tail fractions (arc / ribbon / tube sweeps); default [1, 0] = full */
  sweep?: readonly [Curve, Curve];
  /** texture u spans the visible sweep window (default true with `sweep`) instead of staying fixed to the shape */
  uvWindow?: boolean;
  /** texture offset (u, v) over life: UV scroll */
  uv?: readonly [Curve, Curve];
  /** texture repeat along u / v (default 1, 1) */
  tile?: readonly [number, number];
  /** position offset over life, metres local */
  move?: { x?: Curve; y?: Curve; z?: Curve };
  /** extra rotation about local +Y over life, deg */
  spin?: Curve;
  blend: Blend;
  bright?: number;
  tex: TexSrc;
  /** flipbook frames of the role; fps 0 = once over the life; `mode` = how frames change (see FrameMode) */
  frames?: { fps?: number; mode?: FrameMode };
  /** soft edge across v (0 = hard texture edge, 1 = fully feathered) */
  soft?: number;
  /** soft edge ALONG the shape (the u / sweep direction: the two ends of a partial arc / cyl / ribbon / card): fraction 0..0.5 of the span
   *  that fades in at the start and out at the end (smoothstep). Takes the vertical cut edge off a shell narrowed to its lit part
   *  (converter lit_refine: a 106 deg arc of a closed 360 deg mesh). Resolution 0.01. Default 0 = hard ends. */
  softU?: number;
  grade?: Grades<Omit<SurfaceSpec, 'kind' | 'grade'>>;
}






export interface TrailSpec extends ElementCommon {
  kind: 'trail';
  /** effect time the sampling starts, s */
  t0?: number;
  /** sampling window, s (default: until the one-shot's duration ends / the loop stops) */
  dur?: number;
  /** what the trail follows: a body socket (`weapon` = blade tip) or `origin` (the effect anchor: projectile head, zone) */
  attach: SocketName | 'origin';
  /** sampled point in the anchor frame (weapon: +Y toward the tip, so [0, -0.1, 0] sits 10 cm inside the tip) */
  at?: Vec3;
  
  life: number;
  



  mode?: 'band' | 'ribbon';
  width: number;
  /** width multiplier along the trail (u = 0 at the anchor → 1 at the tail), e.g. [0, 1, 1, 0] tapers to a point */
  taper?: Curve;
  /** colour + alpha along the trail (u = 0 at the anchor → 1 at the tail) */
  color: ColorCurve;
  /** alpha multiplier over the sampling window (0 → 1 of `dur`): fades the whole trail in / out over the element life */
  fade?: Curve;
  blend: Blend;
  bright?: number;
  /** u along the trail (0 at the anchor), v across (0 = base / left side, 1 = tip / right side) */
  tex: TexSrc;
  /** texture repeats along the trail (default 1: the texture spans the whole trail) */
  tile?: number;
  grade?: Grades<Omit<TrailSpec, 'kind' | 'grade'>>;
}

export type ElementSpec = ParticleSpec | SurfaceSpec | TrailSpec;


export interface SpecRef {
  family?: string;
  notes?: string;
}

/** scripted weapon swing of the stand-in body (galleries / compare strips): blade yaw from → to (deg, 0 = facing,
 *  + toward the caster's left), over `dur` s from `t0` s after the spawn, blade pitch (deg, + up) */
export interface StandInSwing {
  t0?: number;
  dur?: number;
  from?: number;
  to?: number;
  pitch?: number;
}





export interface StandInPose {
  fps: number;
  /** frames per track */
  n: number;
  /** clip length (s) */
  dur: number;
  /** socket name → n × 7 numbers [x y z qx qy qz qw]; a socket without a track keeps its fixed stand-in offset (`root` is the origin) */
  sockets: Partial<Record<SocketName, ArrayLike<number>>>;
  /** blade length of the `weapon` socket (the converter's BLADE_REF, 1 m) */
  bladeLen?: number;
  /** orientation of the hand / head / chest sockets: 'yaw' (default) = the caster's yaw only, like the player sockets of the game; 'bone' = the full
   *  bone quaternion of the track. `weapon` always takes the full quaternion. The converter turns bone-attached content by the measured bone rotation
   *  (`--bone-axes measured`), so 'bone' would turn it twice; use it only with drafts made with `--bone-axes socket`. */
  orient?: 'yaw' | 'bone';
  /** drawing joints (gallery/standin.ts): name → n × 3 */
  joints?: Record<string, ArrayLike<number>>;
}

export interface FxSpec {
  /** preset id, `sk.<skillId>` (or `sk.<skillId>.<part>` for helpers) */
  id: string;
  desc: string;
  behavior: SkillBehavior;
  ref: SpecRef;
  /** authored footprint: radius presets scale every length by (radius / base); mult presets by `scale` */
  size: 'mult' | 'radius';
  base: number;
  /** default duration s (loops: default loop length; one-shots: nominal visual length, informational) */
  dur: number;
  /** one-shot timeline (meleeArc/cone/selfBuff/leap/dash/chain/summon/skyStrike) or loop (zones, auras, tracked) */
  elements: readonly ElementSpec[];
  /** tracked projectiles / zones: played once at the last position when the effect ends */
  impact?: readonly ElementSpec[];
  
  impactGround?: boolean;
  

  fadeOut?: number;
  /** extra lift of the origin above the ground, metres (projectile bodies, hand height) */
  lift?: number;
  /** one-shot effects (selfBuff casts): the origin rides the player the effect was cast on (the nearest tracked player
   *  within 2 m of the spawn point; NPC casts stay put) until every record is dead; `attach` elements move with it,
   *  free particles keep their world birth spot */
  follow?: boolean;
  /** neutral template (author it white / pale): the caller's colour (SpawnOpts.color), a palette variant suffix
   *  (`sk.<id>.fire`) or the element hint multiplies every colour key by that palette's main colour; default false
   *  (the spec keeps its authored colours whatever the caller passes) */
  tint?: boolean;
  /**
   * pulse train of one cast (cone skills fire one event per pulse, ~0.2 s apart): a spawn of this spec by the same caster
   * less than `castGap` s after the previous one is a LATER pulse of the same cast (ElementCommon.pulse). Default 0 =
   * every spawn is a first pulse (nothing changes).
   */
  castGap?: number;
  








  explode?: 'generic' | 'none';
  /** size multiplier of the whole effect per grade band [g0, g1, g2, g3] (default all 1) */
  gradeScale?: readonly [number, number, number, number];
  /** default `occlude` / `clamp` of every element (readability on bright floors, see ElementCommon) */
  occlude?: number;
  clamp?: number;
  /** default blend space of every additive element (see SpaceMode); unset = `display` for converter drafts (`sk.raw_*` / `sk.draft_*`) and generated families (applyPatch), else `linear` */
  space?: SpaceMode;
  


  artGain?: boolean;
  /** when a production run needs this spec's art: 0 = awaited before the run starts, 1 = streamed first, 2 = streamed last
   *  (spec/artTier.ts). Unset = derived from the id and the skills that own it (the default; set it only when that guesses
   *  wrong). The dev server and the galleries load every sprite up front whatever this says. */
  artTier?: 0 | 1 | 2;
  






  moment?: boolean;
  /** gallery hints (forwarded to PresetDef.demo); `swing` scripts the stand-in weapon for `weapon` anchors */
  demo?: { target?: number; dir?: number; loopFor?: number; swing?: StandInSwing };
}
