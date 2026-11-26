// Texture roles of the spec atlas (2048², 16 × 16 cells of 128 px). Pure data: the painter lives in atlas.ts.
// A role is a rectangle of w × h cells starting at `cell` (= col + row × 16); flipbooks are `frames` consecutive rectangles



export interface RoleRect {
  /** first cell index (col + row × 16) */
  cell: number;
  /** size in cells */
  w: number;
  h: number;
  /** flipbook frame count (1 = still) */
  frames: number;
  /** tileable along u (strips for ribbons / tubes / UV scroll) */
  tile?: boolean;
  /** one line for the README role table */
  desc: string;
}

/** Declaration order defines the layout: 1×1 roles fill rows 0-5, 2×1/1×2/2×2 rows 6-9, 4×1 strips rows 10-11, flipbooks rows 12-15. */
const SINGLE = {
  glow: 'soft gaussian glow',
  glowCore: 'hot white core inside a wide halo (orb, guard glow)',
  disc: 'soft-edged flat disc',
  flare: 'star flare: bright core, long thin rays (healing / holy sparkle)',
  flare4: 'four-point cross star',
  sparkle: 'small twinkle with tiny cross rays',
  spark: 'tight hot dot',
  dot: 'hard round dot',
  streakSoft: 'vertical soft streak (fades at both ends)',
  streakHard: 'vertical hard streak with a bright line core',
  ring: 'thin soft ring',
  ringThick: 'thick soft ring',
  ringRays: 'ring made of short radial lines (energy ring)',
  rays: 'full sunburst of thin radial lines',
  raysHalf: 'half sunburst: radial lines on one side of the centre (sweeping slash burst)',
  raysSoft: 'soft radial rays with a dark centre hole (shock bloom)',
  swirl2: 'two-arm swirl (twisting energy)',
  swirlRing: 'thin broken swirl ring (white twirl)',
  pinwheel: 'five thin curved arms around a dot (wind / talisman spin)',
  vortex: 'spiral vortex',
  smoke0: 'smoke puff A (lumpy)',
  smoke1: 'smoke puff B (wispy)',
  smoke2: 'smoke puff C (dense round)',
  smoke3: 'smoke puff D (multi-lobed cluster)',
  dust: 'grainy dust puff',
  cloud: 'very soft flat cloud',
  splashSpike: 'small spiky splash fan opening upward (impact spray)',
  splat: 'round splat with droplets',
  plasma: 'tangled lightning ball',
  petal: 'single petal',
  leaf: 'single leaf with vein',
  feather: 'feather',
  shard0: 'long crystal shard',
  shard1: 'short broken shard',
  ember: 'ember speck with glow',
  snow: 'soft snowflake star',
  rune0: 'rune glyph A',
  rune1: 'rune glyph B',
  rune2: 'rune glyph C',
  rune3: 'rune glyph D',
  claw: 'three parallel claw rips',
  crescent: 'thin crescent moon blade',
  drop: 'tear drop',
  bubble: 'hollow bubble with highlight',
  skull: 'stylised skull mark (curse / poison)',
  hex: 'hexagon cell (barrier)',
  star5: 'five-point star',
  heart: 'soft heart-shaped glow (heal)',
  
  fanLines: 'half fan of fine lines from the centre opening toward +u (half_ring_rainbow_line: slash flash)',
  splashArch: 'upper half-dome band, bright rim, fringe hanging toward the centre line (gihyeol_spash, halfsplash, y_splash)',
  splashSide: 'splashArch turned to bulge toward +u, fringe toward the centre (rotation of gihyeol_spash / halfsplash)',
  tufts: 'soft flame-like spike tufts rising in the upper third (nwegeomsplash, up)',
  ringInner: 'bright thin rim with a soft glow falling inward, dark centre (w_ring, noe_w_ring, circle, water_light01)',
  ringCloud: 'lumpy cloudy smoke annulus (ragged smoke ring)',
  arcPair: 'two thin crescent arcs on the left and right of a circle, fading at the ends (b_arc, jumagap_loop, empty_boho)',
  arcThin: 'one thin arc along the lower half of a circle, thickest at the bottom (outhalfcircle)',
  twistRing: 'hollow whirlpool ring of many fine twisted streaks, thin bright rim (8-1 copy, 5 copy, bokupanunred)',
  twistDisc: 'disc of fine spiral streaks around a small dark centre (16 copy, wheel, 16)',
  wisp: 'soft ball of thin curly smoke tendrils (curling smoke wisp)',
  spinBlur: 'two groups of concentric soft motion-blur arcs, top-right and bottom-left (palbang_spin_round, tornado2/3)',
  bubbles: 'soft disc holding glowing orbs of mixed size (muyeong_red, shwe_ryoung_ji_core_e)',
  comet: 'oval glowing head at the left with a streaky smear trailing to +u (ee_s, fragment, volcanostone)',
  smear: 'bundle of soft horizontal streaks, brighter toward +u (wind, tornado1, rotation of 3, light012)',
  curtain: 'vertical light shafts rising from the bottom edge, uneven heights (light017, uplinea01/02, light00/010)',
  ornateRing: 'engraved ornamental ring: two thin circles with scroll curls between them (roundpattern, kwaesok)',
  wolfHead: 'front-facing wolf head emblem in flame strokes, bright edges, dim interior (wolf_eff)',
  crescentGlow: 'soft glowing crescent band hugging the +u side of the cell centre, thickest at +u (cheonryongchuta_blow)',
  clawArcs: '4 concentric thin crescent arcs around the centre on the +u side, fading at both ends (spinning claw rakes)',
  ringLine: 'hairline soft circle at r ≈ 0.9 (FWHM ≈ 0.05 r) with a faint inner glow, empty centre (9-1 copy, w_am_ring)',
} as const;

const WIDE = {
  // [w, h, desc]
  lensStreak: [2, 1, 'horizontal lens streak with bright centre'],
  slashArc: [2, 1, 'curved slash crescent with fibrous streaks (melee trail sprite)'],
  splashDome: [2, 1, 'half dome splash with dripping fringe (sword impact)'],
  glyphBurst: [2, 2, 'calligraphy talisman stroke over a radial burst'],
  talisman: [1, 2, 'paper talisman card with a red glyph'],
  runeCircle: [2, 2, 'magic circle: rings, ticks and glyphs'],
  crack: [2, 2, 'ground crack star decal'],
  scorch: [2, 2, 'scorched ground decal'],
  swordBlade: [1, 2, 'sword silhouette, tip up (spirit swords)'],
  dragonHead: [2, 2, 'stylised dragon head in profile, jaw open, facing +u'],
  shockwave: [2, 2, 'ground shock ring with noisy edge'],
  burstStar: [2, 2, 'large layered explosion star'],
  flamePillar: [1, 2, 'tall fibrous flame pillar: dense bright base, vertical licking tongues, ragged wispy top (yongsin, skin)'],
} as const satisfies Record<string, readonly [number, number, string]>;

const STRIPS = {
  // tileable along u, 4 × 1 cells
  energyStrip: 'tileable energy band with flowing filaments',
  windStrip: 'tileable wind streaks (swirl tubes, dash)',
  glowStrip: 'tileable soft band, bright centre line',
  fireStrip: 'tileable flame tongues band (fire ribbons)',
  dragonScale: 'tileable dragon scale strip (coils, bodies)',
  lightningStrip: 'tileable jagged lightning line',
  smokeStrip: 'tileable smoky band',
  chainStrip: 'tileable chain links',
} as const;

const FLIPBOOKS = {
  flameFB: 'flame burst flipbook (16 frames, heat in red channel → use colour curves)',
  iceFB: 'frost crystallisation burst flipbook (16 frames)',
  poisonFB: 'bubbling poison smoke flipbook (16 frames)',
  smokeFB: 'rolling smoke flipbook (16 frames)',
} as const;

const ANIM = {
  
  boltH: [6, 'horizontal jagged lightning bolt with glow, 6 frames (horizontal lightning strike sequence)'],
  boltV: [6, 'vertical branching lightning bolt with glow, 6 frames (vertical lightning strike sequence)'],
  rock: [4, 'lumpy shaded stone chunk (alpha, light from the top-left), 4 variants (rock fragment variants)'],
} as const satisfies Record<string, readonly [number, string]>;

export type TexRole = keyof typeof SINGLE | keyof typeof ANIM | keyof typeof WIDE | keyof typeof STRIPS | keyof typeof FLIPBOOKS | 'lightning';

export const ATLAS_SIZE = 2048;
export const CELLS = 16;
export const CELL_PX = ATLAS_SIZE / CELLS;

function build(): Record<TexRole, RoleRect> {
  const out: Record<string, RoleRect> = {};
  let i = 0;
  for (const [k, d] of Object.entries(SINGLE)) {
    out[k] = { cell: i++, w: 1, h: 1, frames: 1, desc: d };
  }
  for (const [k, [n, d]] of Object.entries(ANIM)) {
    out[k] = { cell: i, w: 1, h: 1, frames: n, desc: d };
    i += n;
  }
  if (i > 6 * CELLS) throw new Error('spec atlas: too many 1×1 roles');
  // rows 6-9: packed shelf of wide roles
  let col = 0;
  let row = 6;
  let shelfH = 1;
  for (const [k, [w, h, d]] of Object.entries(WIDE)) {
    if (col + w > CELLS) {
      col = 0;
      row += shelfH;
      shelfH = 1;
    }
    out[k] = { cell: col + row * CELLS, w, h, frames: 1, desc: d };
    col += w;
    if (h > shelfH) shelfH = h;
  }
  if (row + shelfH > 10) throw new Error('spec atlas: wide roles overflow rows 6-9');
  // lightning flipbook: 4 frames of 2 × 1 at the end of the wide area (row 9)
  out.lightning = { cell: 8 + 9 * CELLS, w: 2, h: 1, frames: 4, desc: 'lightning bolt strip with sparks, 4 frames (2 × 1 cells each)' };
  // rows 10-11: 4×1 strips
  let s = 0;
  for (const [k, d] of Object.entries(STRIPS)) {
    out[k] = { cell: (s % 4) * 4 + (10 + Math.floor(s / 4)) * CELLS, w: 4, h: 1, frames: 1, tile: true, desc: d };
    s++;
  }
  // rows 12-15: flipbooks
  let f = 0;
  for (const [k, d] of Object.entries(FLIPBOOKS)) {
    out[k] = { cell: (12 + f) * CELLS, w: 1, h: 1, frames: 16, desc: d };
    f++;
  }
  return out as Record<TexRole, RoleRect>;
}

export const ROLES: Readonly<Record<TexRole, RoleRect>> = build();
export const ROLE_NAMES = Object.keys(ROLES) as TexRole[];

/** packs a role (+ optional fixed frame) into the float the shaders decode: cell + 256·(w-1) + 1024·(h-1) + 4096·(frames-1) */
export function packRole(r: RoleRect): number {
  return r.cell + 256 * (r.w - 1) + 1024 * (r.h - 1) + 4096 * (r.frames - 1);
}
