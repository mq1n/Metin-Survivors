// Run-event visuals (EV-03b): `ev.shrine` (the Sky Sovereign's shrine: a slow rotating ground sigil in a crisp gold ring, rising motes), `ev.shrinePillar`
// (its soft column of light, a loop of its own), `ev.shrineChannel` (ONE segment of the channel ring: eight of them fill the ring as the channel
// progresses), `ev.shrineClaim` (the pop when a channel completes), `ev.champion` (the Champion Hunt's crimson ring with a crown, riding the champion)
// and `ev.rainMark` (the crisp ring round the spot where a Metin Rain stone lands). Event routing: ./route.ts; art-scope rule: vfx/spec/artScope.ts.
//
// Rules every layer here follows (the critics of the level-up / aura specs, spec/README.md "Readability"):
//  - GROUND-LYING rings and sigils; the only upright layer is the shrine's pillar, a loop of its own that the route stops while a hero channels (the
//    channel happens at the centre, where a screen billboard would wash the hero out on snow), and that stands with its FOOT on the sigil centre;
//  - every additive layer has an ALPHA-blended saturated twin on the same sprite: additive gold over snow only whitens, the twin keeps the hue;
//  - nothing is drawn on the hero (the hero guard fades whatever overlaps the body), the champion ring stays 2.4 m out of the champion's own ground
//    ring, the rain mark sits OUTSIDE the stone's ~3.9 m warning circle so the telegraph stays readable;
//  - low tier (no composite pass: additive HDR clips at once): the alpha layers only, in pale gold (a deep amber reads as the orange of a telegraph);
//    the additive crests, the motes and the breath join from medium (`minTier: 1`); the rain mark is a surface: medium and up (a surface batch on
//    low costs draws the stone's own warning disc does not need);
//  - existing sprites only (./art.ts: no new raster), existing spec materials (no new program); nothing dark is drawn (noCasterDarkening stays the rule).
import type { ArtTex, ColorCurve, Curve, FxSpec, ParticleSpec, SpecRef, SurfaceSpec } from '../../spec/types';
import { flash, risingMotes } from '../../skills/common/momentKit';
import { CHAMPION_BASE, EVENT_PRESET_IDS as ID, RAIN_MARK_BASE, RAIN_MARK_LIFE, SHRINE_BASE, SHRINE_SEGMENTS } from './ids';
import { ART_CROWN, ART_GLOW, ART_HAIRLINE, ART_PILLAR, ART_PIP, ART_RING, ART_SIGIL } from './art';

/** seconds a persistent layer lives: its particle is born once and held (a run event lasts about 70 s; the route respawns an effect that ended) */
export const EVENT_LOOP_LIFE = 180;

const REF: SpecRef = { family: 'original roguelite run event', notes: 'EV-03b' };

/** a colour curve of a persistent layer: fades in over ~1.5 s (the particle lives EVENT_LOOP_LIFE s), then holds */
function held(hex: number, a: number, hexEnd: number = hex): ColorCurve {
  return [0, hex, 0, 1.5 / EVENT_LOOP_LIFE, hex, a, 0.99, hexEnd, a, 1, hexEnd, 0];
}

interface LayerOpts {
  half: number;
  color: ColorCurve;
  tex: ArtTex;
  blend: 'add' | 'alpha';
  /** seconds the sprite lives (a one-shot); absent = a persistent layer: ONE long-lived sprite, born at once and held */
  life?: number;
  /** deg / s (sign = direction) */
  spin?: number;
  scale?: Curve;
  bright?: number;
  clamp?: number;
  minTier?: 1;
}

/** a ground-lying sprite (`cycle 0.05 / max 1 / rate 60` for a one-shot, the persistent idiom of the aura specs otherwise) */
function layer(o: LayerOpts): ParticleSpec {
  const p: ParticleSpec = {
    kind: 'particle',
    cycle: o.life === undefined ? 4 : 0.05,
    max: 1,
    rate: [0, 60],
    life: [0, o.life ?? EVENT_LOOP_LIFE],
    half: [0, o.half],
    color: o.color,
    billboard: 'ground',
    rotation: { start: [0, 0], spin: o.spin ?? 0 },
    attach: true,
    blend: o.blend,
    tex: o.tex,
  };
  const q = p as unknown as Record<string, unknown>;
  if (o.life === undefined) q['loops'] = 0;
  for (const k of ['scale', 'bright', 'clamp', 'minTier'] as const) if (o[k] !== undefined) q[k] = o[k];
  return p;
}

/** a breath: a sprite every 2 s that swells and fades at the same spot over 2.4 s (a steady pulse, nothing travels like a shockwave) */
function breath(o: Omit<LayerOpts, 'life' | 'minTier'>): ParticleSpec {
  return { ...layer({ ...o, life: 2.4 }), cycle: 2.4, loops: 0, max: 2, rate: [0, 0.5], minTier: 1 } as ParticleSpec;
}

// ---------------------------------------------------------------------------------------------------------------- the shrine
const GOLD = 0xffd070;
const GOLD_PALE = 0xfff0c0;

/**
 * The Sky Sovereign's shrine, a persistent aura on the ground at the shrine (scale = the channel radius, k = scale / SHRINE_BASE). From the gameplay
 * camera it reads as a SACRED POINT: a rune sigil turning slowly inside a crisp gold ring that IS the channel radius (stand inside it) and gold motes
 * lifting off the ring; the pillar of light over it is `ev.shrinePillar`. Nothing flashes or pulses fast: it is a place, not an attack, so it never
 * competes with a telegraph. The appearing flare plays once (`maxRank: 0`: the route respawns an evicted loop at rank 1, mid-event, without it).
 *  - tiers: low = the alpha layers (sigil, ring); medium adds the additive crests and the motes.
 */
const SHRINE: FxSpec = {
  id: ID.shrine,
  desc: 'Sky Sovereign shrine: slow rune sigil in a crisp gold ring (the channel radius), motes',
  behavior: 'persistentAura',
  ref: REF,
  size: 'radius',
  base: SHRINE_BASE,
  dur: EVENT_LOOP_LIFE,
  fadeOut: 0.9,
  artTier: 1,
  elements: [
    // sigil: the rune circle in gold, turning 6 deg/s, 2.6 m (alpha twin, then the hot additive core)
    layer({ half: 2.6, color: held(0xd49c1c, 0.55), tex: ART_SIGIL, blend: 'alpha', spin: 6 }),
    layer({ half: 2.6, color: held(GOLD, 0.6, 0xffe098), tex: ART_SIGIL, blend: 'add', spin: 6, bright: 1.15, clamp: 1, minTier: 1 }),
    // ring: the crisp ring that IS the channel radius (the hairline glow peaks at 0.62 of the half width: 2.5 m)
    layer({ half: 4.03, color: held(0xe8b030, 0.75), tex: ART_HAIRLINE, blend: 'alpha' }),
    layer({ half: 4.03, color: held(GOLD, 0.6), tex: ART_HAIRLINE, blend: 'add', bright: 1.1, clamp: 1, minTier: 1 }),
    // motes: gold pips lifting off the ring, 0.8 m/s, 2.4 s
    risingMotes('motes', {
      radius: 2.2, rate: 6, max: 20, life: 2.4, rise: 0.8, half: 0.09, y: 0.12, tex: ART_PIP, bright: 1.1, clamp: 1, minTier: 1,
      color: [0, GOLD_PALE, 0, 0.2, GOLD_PALE, 0.8, 0.7, GOLD, 0.6, 1, GOLD, 0],
    }),
    // appearing: a soft pale-gold flare on the floor, 3 m, gone in 1.2 s
    { ...flash('flare', { at: [0, 0.15, 0], half: 3.0, life: 1.2, grow: [0.3, 1.0], billboard: 'ground', tex: ART_GLOW, clamp: 1, color: [0, GOLD_PALE, 0.55, 0.4, GOLD, 0.32, 1, GOLD, 0] }), maxRank: 0 },
  ],
};

/** the screen billboard of the pillar is as tall as it is wide in half extents (m): hx x hy, the sprite is 341 x 512 */
const PILLAR_HY = 2.4;
const PILLAR_HX = (PILLAR_HY * 341) / 512;

/** one layer of the pillar: three at a time, so they drift into each other and the column breathes */
function column(blend: 'add' | 'alpha', a: number, extra: Partial<ParticleSpec> = {}): ParticleSpec {
  const hex = blend === 'add' ? GOLD : 0xe6aa28;
  return {
    kind: 'particle',
    cycle: 3,
    loops: 0,
    max: 3,
    rate: [0, 0.8],
    life: [0, 3.8],
    // the camera has a FIXED yaw and a 55 degree pitch: a screen quad centred at (y, z) = (0.574 h, -0.819 h) behind the sigil stands with its bottom edge
    // and its hot foot ON the sigil centre (centred at the sigil it would put its foot 2 m toward the camera, on the near edge of the ring)
    at: [0, 0.574 * PILLAR_HY, -0.819 * PILLAR_HY],
    half: [[0, PILLAR_HX], [0, PILLAR_HY]],
    scale: [0, 0.96, 0.5, 1.04, 1, 0.98],
    color: [0, hex, 0, 0.25, hex, a, 0.7, hex, a * 0.85, 1, hex, 0],
    billboard: 'screen',
    rotation: { start: [0, 0] },
    blend,
    tex: ART_PILLAR,
    ...extra,
  };
}

/**
 * The shrine's soft column of light, a persistent loop of its own (scale = the channel radius is ignored: the column does not grow with it): the
 * level-up's pillar sprite in gold, 4.8 m tall, never brighter than display white. The route stops it while a hero channels (a column behind a hero
 * in the centre washed him out on snow) and stands it again when the channel resets.
 */
const SHRINE_PILLAR: FxSpec = {
  id: ID.shrinePillar,
  desc: 'Sky Sovereign shrine: a soft column of gold light over the sigil',
  behavior: 'persistentAura',
  ref: REF,
  size: 'mult',
  base: 1,
  dur: EVENT_LOOP_LIFE,
  fadeOut: 0.5,
  artTier: 1,
  elements: [column('alpha', 0.5), column('add', 0.42, { bright: 1, clamp: 1, minTier: 1 })],
};

/** the arc of one channel segment: 360 / N deg less a 4 deg gap */
const SEGMENT_SPAN = 360 / SHRINE_SEGMENTS - 4;

/** one band of a channel segment (an arc surface on the ground; `life` = the period of a steady loop, or the length of the one-shot flash) */
function segment(r0: number, r1: number, blend: 'add' | 'alpha', color: ColorCurve, extra: Partial<SurfaceSpec> = {}): SurfaceSpec {
  return { kind: 'surface', life: 1, loop: true, shape: { kind: 'arc', r0, r1, span: SEGMENT_SPAN, a0: 2 }, at: [0, 0.09, 0], color, blend, tex: 'glowStrip', soft: 0.45, softU: 0.12, ...extra };
}

/**
 * ONE segment of the channel ring (a persistent aura, scale = the channel radius). The route spawns segment k turned by k x 45 deg once the channel
 * has reached (k + 1) / 8 and stops them all when it resets: the ring FILLS in eight steps exactly as fast as the sim's progress (the sim reports it
 * about every 0.25 s), whatever the channel time of the content, a pause or a co-op guest that joins late. A segment is a bright band inside the shrine
 * ring (1.9 - 2.5 m): a pale gold alpha body (every tier), a gold crest (medium and up) and a flash the moment it lights.
 */
const SHRINE_CHANNEL: FxSpec = {
  id: ID.shrineChannel,
  desc: 'One segment of the shrine channel ring (a gold band that lights with a flash)',
  behavior: 'persistentAura',
  ref: REF,
  size: 'radius',
  base: SHRINE_BASE,
  dur: EVENT_LOOP_LIFE,
  fadeOut: 0.3,
  artTier: 1,
  elements: [
    segment(1.9, 2.5, 'alpha', [0, 0xeab42c, 0.95, 1, 0xeab42c, 0.95], { soft: 0.3 }),
    segment(2.02, 2.38, 'add', [0, GOLD, 0.9, 1, GOLD, 0.9], { bright: 1.2, clamp: 1, minTier: 1 }),
    // lighting flash: the band flares white-gold and settles in 0.5 s
    segment(1.7, 2.6, 'add', [0, 0xffffff, 0.95, 0.3, GOLD_PALE, 0.55, 1, GOLD, 0], { life: 0.5, loop: false, scale: [0, 0.94, 0.35, 1.06, 1, 1.0], clamp: 1 }),
  ],
};

/**
 * The pop when a shrine channel completes (`ev.shrineClaim`, one-shot): a gold ring expands cleanly out from the shrine ring over half a second
 * right as the bargain modal opens.
 */
const SHRINE_CLAIM: FxSpec = {
  id: ID.shrineClaim,
  desc: 'Shrine channel completed: a gold ring runs out from the shrine ring, over in half a second',
  behavior: 'selfBuff',
  ref: REF,
  size: 'radius',
  base: SHRINE_BASE,
  dur: 1,
  artTier: 1,
  elements: [
    layer({ life: 0.55, half: 3.1, scale: [0, 0.82, 0.3, 1.25, 1, 1.5], color: [0, 0xd89018, 0.6, 0.6, 0xd08818, 0.4, 1, 0xb87810, 0], tex: ART_RING, blend: 'alpha' }),
    layer({ life: 0.5, half: 3.1, scale: [0, 0.82, 0.3, 1.25, 1, 1.5], color: [0, 0xffffff, 0.8, 0.5, GOLD_PALE, 0.45, 1, GOLD, 0], tex: ART_RING, blend: 'add', clamp: 1, bright: 1.2, minTier: 1 }),
  ],
};

// ---------------------------------------------------------------------------------------------------------------- the champion
const BLOOD = 0xc4182e;
const EMBER_HOT = 0xff7a52;
const CREST = 0xffd0a0;

/**
 * The Champion Hunt's ring, a persistent aura that the route moves with the champion every frame (scale = CHAMPION_BASE x k). It must read apart from the
 * escorts AND from an ordinary pack leader, whose ground ring is the small orange `champion` arcs of render/world.ts: this one is bigger (2.4 m, outside
 * that ring), crimson instead of orange, a FULL ring (not arcs) with a pale-gold crest that BREATHES (a steady 2 s swell, nothing travels: a ring that
 * expands would read as a shockwave), carries a slow turning crown of spikes inside it and lifts red embers. Ground-lying only.
 *  - tiers: low = the alpha ring + the alpha crown; medium adds the additive crests, the breath and the embers.
 */
const CHAMPION: FxSpec = {
  id: ID.champion,
  desc: 'Champion Hunt ring: full crimson ground ring, breathing gold crest, crown of spikes, embers',
  behavior: 'persistentAura',
  ref: REF,
  size: 'radius',
  base: CHAMPION_BASE,
  dur: EVENT_LOOP_LIFE,
  fadeOut: 0.5,
  artTier: 1,
  elements: [
    // ring skirt: the wide soft band under the ring, faint (the band crest sits at 0.79 of the half width)
    layer({ half: 3.04, color: held(BLOOD, 0.26), tex: ART_RING, blend: 'alpha' }),
    // ring: a crisp full crimson ring (the hairline glow peaks at 0.62 of the half width: 2.4 m), saturated so it holds on snow and stone; its pale-gold crest
    layer({ half: 3.87, color: held(0xc00f2a, 0.95), tex: ART_HAIRLINE, blend: 'alpha' }),
    layer({ half: 3.87, color: held(CREST, 0.45, 0xffe0b8), tex: ART_HAIRLINE, blend: 'add', bright: 1.2, clamp: 1, minTier: 1 }),
    // the breath: the same ring swelling to white-gold and fading, every 2 s
    breath({ half: 3.87, color: [0, 0xffe8c8, 0, 0.5, 0xffe8c8, 0.7, 1, 0xffe8c8, 0], tex: ART_HAIRLINE, blend: 'add', bright: 1.3, clamp: 1 }),
    // crown: spikes turning 10 deg/s, 2.3 m out (alpha crimson twin, then the hot additive crown)
    layer({ half: 2.7, color: held(0xc41030, 0.9), tex: ART_CROWN, blend: 'alpha', spin: 10 }),
    layer({ half: 2.7, color: held(CREST, 0.9, 0xff9060), tex: ART_CROWN, blend: 'add', spin: 10, bright: 1.35, clamp: 1, minTier: 1 }),
    // embers: red embers lifting off the ring, 0.9 m/s, 1.6 s
    risingMotes('embers', {
      radius: 2.3, rate: 5, max: 14, life: 1.6, rise: 0.9, half: 0.08, y: 0.1, tex: ART_PIP, bright: 1.1, clamp: 1, minTier: 1,
      color: [0, 0xffc090, 0, 0.2, 0xffa070, 0.8, 0.7, EMBER_HOT, 0.55, 1, BLOOD, 0],
    }),
  ],
};

// ---------------------------------------------------------------------------------------------------------------- the rain mark
/** the crisp ring of a rain mark: an annulus on the ground, 0.5 m wide at 4.35 m, in over 0.25 s, held, gone at the landing; white keys (the stone's rune colour tints them) */
function markRing(blend: 'add' | 'alpha', a: number, extra: Partial<SurfaceSpec> = {}): SurfaceSpec {
  return {
    kind: 'surface',
    life: RAIN_MARK_LIFE,
    shape: { kind: 'arc', r0: 4.35, r1: 4.85, span: 360 },
    at: [0, 0.08, 0],
    scale: [0, 0.96, 0.15, 1, 1, 1],
    color: [0, 0xffffff, 0, 0.09, 0xffffff, a, 0.82, 0xffffff, a * 0.9, 1, 0xffffff, 0],
    blend,
    tex: 'glowStrip',
    soft: 0.55,
    minTier: 1,
    ...extra,
  };
}

/**
 * The ring of a Metin Rain stone, a one-shot at the spot the stone will land (RAIN_MARK_LIFE s; scale = RAIN_MARK_BASE, the radius of its crisp ring:
 * 4.2 m of impact + the hero's body is its real edge). `tint`: the route passes the stone's rune colour, so each ring is the colour of its own stone.
 * The stone's own warning (a ~3.9 m disc with a rune ring of its own, render/metin.ts) is NOT touched: the annulus at 4.35 - 4.85 m lies entirely
 * OUTSIDE it, no fill, never above 0.66 alpha. Medium and up (a surface; low keeps the stone's own warning, which reads on its own).
 */
const RAIN_MARK: FxSpec = {
  id: ID.rainMark,
  desc: 'Metin Rain stone landing here: a crisp ring in the stone colour, outside its warning circle',
  behavior: 'selfBuff',
  ref: REF,
  size: 'radius',
  base: RAIN_MARK_BASE,
  dur: RAIN_MARK_LIFE,
  artTier: 1,
  tint: true,
  elements: [markRing('alpha', 0.66), markRing('add', 0.45, { bright: 1.1, clamp: 1 })],
};

/** every spec of the target (ids are the contract: vfx/spec/artScope.ts EVENT_SPEC_KINDS lists them per event kind) */
export const specs: FxSpec[] = [SHRINE, SHRINE_PILLAR, SHRINE_CHANNEL, SHRINE_CLAIM, CHAMPION, RAIN_MARK];
