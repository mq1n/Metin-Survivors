
// (g0 1bipamaking/1bipa_throw/1bipa_blow, g1 bipabu_2_*/bipa_2_blow, g2 bipabu_3_*/bipa_3_blow, g3 bipabu_4_*).


import type { ArtTex, ColorCurve, ElementSpec, FxSpec, ParticleSpec, SurfaceSpec, TrailSpec } from '../../spec/types';



const U = 1 / 0.5;






const art = (id: string, fallback: ArtTex['fallback']): ArtTex => ({ art: `vfx_drifting_charms_${id}`, fallback });
const TEX = {
  glyph: art('glyph', 'glyphBurst'), 
  twirl: art('twirl', 'swirl2'), 
  ring: art('ring', 'ringInner'), 
  wheel: art('wheel', 'pinwheel'), 
  halo: art('halo', 'rays'), 
  rays: { art: 'vfx_disc_glow_dim_a', fallback: 'raysSoft' } as ArtTex, 
  
  rim: { art: 'vfx_swirl_mist_ring_a', fallback: 'swirlRing' } as ArtTex, 
  lit: { art: 'vfx_disc_milkglow_a', fallback: 'disc' } as ArtTex, // even milky glow disc: the luminous interior that fills the dome (a rim-lit disc drew a second concentric arc)
  burst: { art: 'vfx_rayfan_upspray_a', fallback: 'fanLines' } as ArtTex, 
  spray: { art: 'vfx_spray_up_streaks_a', fallback: 'fanLines' } as ArtTex, 
  tongue: { art: 'vfx_flame_curtain_a', fallback: 'flamePillar' } as ArtTex, // vertical orange-red flame tongues (P)
  orb: { art: 'vfx_ball_energy_white_a', fallback: 'glow' } as ArtTex, 
  hot: { art: 'vfx_glow_orb_smooth_a', fallback: 'glowCore' } as ArtTex, // the white-hot base of the flare
  chip: art('chip', 'spark'), 
  dust: art('dust', 'smoke3'), 
} as const;




interface Pal {
  glyph: readonly [number, number, number];
  twirl: number;
  twirlHalf: number;
  ring: number;
  ringScale: number;
  puff: ColorCurve;
  puffFringe: ColorCurve;
  puffHalf: number;
  wheel: number;
  wheelScale: number;
  wheelAlpha: number;
  core: number;
  halo: ColorCurve;
  shed: ColorCurve;
  tail: number;
  dome: ColorCurve;
  lit: ColorCurve;
  rays: ColorCurve;
  flare: ColorCurve;
  hot: ColorCurve;
  chip: ColorCurve;
  dust: ColorCurve;
  dustN: number;
  dustR: number;
  dustHalf: number;
}

const P0: Pal = {
  glyph: [0xd8ff98, 0xd8ff98, 0xd8ff98],
  twirl: 0xb8d070,
  twirlHalf: 0.5,
  ring: 0xd8ffc8,
  ringScale: 1,
  puff: [0, 0xe8ffd8, 0.4, 0.2, 0xc8f0b0, 0.28, 1, 0x7ac060, 0],
  puffFringe: [0, 0xd8f080, 0.22, 0.3, 0xc0e870, 0.16, 1, 0x80c050, 0],
  puffHalf: 1.0,
  wheel: 0xc4d4ff, 
  wheelScale: 0.36,
  wheelAlpha: 0.9,
  core: 0xf4ffe0,
  halo: [0, 0xb8f088, 0.8, 0.45, 0xb8f088, 0.3, 1, 0xb8f088, 0], 
  shed: [0, 0x9cffb4, 0.9, 1, 0x52aa9c, 0],
  tail: 0x07ff00,
  dome: [0, 0x3dff5a, 0, 0.18, 0x5aff5a, 1, 0.45, 0x5aff6a, 0.75, 0.68, 0x80ff90, 0.15, 1, 0xa8ffb8, 0],
  lit: [0, 0xb0ff60, 0, 0.2, 0xc8ff70, 0.245, 0.55, 0xa8f060, 0.158, 1, 0x70d050, 0],
  rays: [0, 0xfff070, 0, 0.16, 0xf4e450, 0.62, 0.4, 0xc8e850, 0.62, 0.7, 0x90f050, 0.2, 1, 0x60f060, 0],
  flare: [0, 0xfff6c8, 0, 0.12, 0xfff6c8, 1, 0.5, 0xffe070, 0.5, 1, 0xffb030, 0],
  hot: [0, 0xfffbd8, 0, 0.12, 0xfffbd8, 0.9, 0.5, 0xfff0a0, 0.45, 0.8, 0xffd060, 0.1, 1, 0xffd060, 0],
  chip: [0, 0xe8ffe0, 1, 0.62, 0xc0ffbd, 0],
  dust: [0, 0xe0f4b0, 0, 0.12, 0xd8f0a0, 0.13, 0.5, 0xc8e090, 0.09, 1, 0xb0c878, 0],
  dustN: 3,
  dustR: 1.2,
  dustHalf: 1.7,
};

const P1: Pal = {
  ...P0,
  glyph: [0x1b0088, 0x8090ff, 0xceff88],
  twirl: 0x462c8b,
  ring: 0x2727fc,
  ringScale: 1.5,
  puff: [0, 0x8a8aff, 0.5, 0.2, 0x6a70ff, 0.34, 1, 0x2040ff, 0],
  puffFringe: [0, 0xb090ff, 0.22, 0.3, 0x8080ff, 0.16, 1, 0x4060ff, 0],
  wheel: 0xc8d4ff,
  wheelScale: 0.58,
  core: 0xd8e0ff,
  halo: [0, 0x9797ff, 0.8, 0.45, 0x9797ff, 0.3, 1, 0x9797ff, 0],
  shed: [0, 0x6f8cff, 0.9, 1, 0x3f68ff, 0],
  dome: [0, 0xb020ff, 0, 0.18, 0xc040ff, 1, 0.45, 0x6a60ff, 0.75, 0.68, 0x4060ff, 0.15, 1, 0x3060ff, 0],
  lit: [0, 0xe0a0ff, 0, 0.2, 0xd890ff, 0.27, 0.55, 0x7080ff, 0.17, 1, 0x3050ff, 0],
  rays: [0, 0xf0c0ff, 0, 0.2, 0xd890ff, 0.55, 0.4, 0x7080ff, 0.55, 0.7, 0x4060ff, 0.18, 1, 0x3050ff, 0],
  flare: [0, 0xffffff, 0, 0.14, 0xf4e0ff, 1, 0.5, 0xd890ff, 0.5, 1, 0x8060ff, 0],
  hot: [0, 0xffffff, 0, 0.12, 0xf8f0ff, 0.9, 0.55, 0xe0c8ff, 0.6, 1, 0xa080ff, 0],
  chip: [0, 0x9ab0ff, 1, 0.62, 0x0836ff, 0],
  dust: [0, 0x7088ff, 0, 0.12, 0xa0b8ff, 0.13, 0.5, 0x7090fc, 0.09, 1, 0x4060fc, 0],
};

const P2: Pal = {
  ...P1,
  glyph: [0x7efc1f, 0x7efc1f, 0x7efc1f],
  twirl: 0x2a8c3a,
  ring: 0xd8ffc8,
  puff: [0, 0xe8ffd8, 0.5, 0.2, 0xbbffab, 0.34, 1, 0x36fd0a, 0],
  puffFringe: [0, 0xe8f060, 0.22, 0.3, 0xa0ff70, 0.16, 1, 0x40e040, 0],
  wheel: 0x7ae088,
  core: 0xeaffb0,
  halo: [0, 0x3a9a50, 0.8, 0.45, 0x3a9a50, 0.3, 1, 0x3a9a50, 0],
  shed: [0, 0x7ad050, 0.9, 1, 0x34610e, 0],
  dome: [0, 0xffb000, 0, 0.18, 0xffc830, 1, 0.45, 0xd0e020, 0.75, 0.68, 0x60f060, 0.15, 1, 0x40ff60, 0],
  lit: [0, 0xffe080, 0, 0.2, 0xffd060, 0.27, 0.55, 0xa0ff80, 0.17, 1, 0x50ff90, 0],
  rays: [0, 0xffe080, 0, 0.2, 0xffd060, 0.55, 0.4, 0x90ff80, 0.55, 0.7, 0x50ff90, 0.18, 1, 0x40ff90, 0],
  flare: [0, 0xffffff, 0, 0.14, 0xffffc0, 1, 0.5, 0xffd060, 0.5, 1, 0xffa030, 0],
  hot: [0, 0xffffff, 0, 0.12, 0xfffff0, 0.9, 0.55, 0xffffa0, 0.6, 1, 0xc0ff60, 0],
  chip: [0, 0x08ff22, 1, 0.62, 0x08ff22, 0],
  dust: [0, 0xe7f93b, 0, 0.12, 0xe7f93b, 0.13, 0.5, 0xb0f060, 0.09, 1, 0x3afb63, 0],
};

const P3: Pal = {
  ...P2,
  glyph: [0x2b8b88, 0xce9f13, 0xce9f13],
  twirl: 0xf31647,
  twirlHalf: 1.15,
  ring: 0xd900ff,
  ringScale: 1,
  puff: [0, 0xfff6f0, 0.7, 0.12, 0xfff0e8, 0.62, 0.45, 0xffd0c8, 0.16, 1, 0xffb8b0, 0],
  puffFringe: [0, 0xe0f060, 0.32, 0.3, 0xd0e860, 0.2, 1, 0x90c040, 0],
  puffHalf: 1.0,
  wheel: 0xff6a1a,
  wheelScale: 0.6,
  wheelAlpha: 0.95,
  core: 0xffd070,
  halo: [0, 0xfb4a10, 0.8, 0.45, 0xfb4a10, 0.3, 1, 0xfb1600, 0],
  shed: [0, 0xff7050, 0.78, 1, 0x672030, 0],
  tail: 0x006dff,
  dome: [0, 0xffe060, 0, 0.18, 0xffd040, 1, 0.45, 0xffbc30, 0.8, 0.68, 0xffa030, 0.16, 1, 0xff8820, 0],
  lit: [0, 0xffa848, 0, 0.2, 0xff9438, 0.17, 0.55, 0xff7828, 0.11, 1, 0xff5818, 0],
  rays: [0, 0xffb050, 0, 0.2, 0xff9838, 0.22, 0.4, 0xff8020, 0.22, 0.7, 0xff7018, 0.08, 1, 0xff6010, 0],
  flare: [0, 0xffe890, 0, 0.12, 0xffd860, 1, 0.5, 0xffa020, 0.6, 1, 0xff5010, 0],
  hot: [0, 0xfffff0, 0, 0.12, 0xfff4c0, 0.8, 0.55, 0xffe070, 0.5, 1, 0xff9020, 0],
  chip: [0, 0xffa060, 1, 0.62, 0xff6026, 0],
  dust: [0, 0xffc060, 0, 0.12, 0xffc060, 0.14, 0.5, 0xffb050, 0.1, 1, 0xff9040, 0],
  dustN: 5,
  dustR: 2.1,
  dustHalf: 1.9,
};

const PALS = [P0, P1, P2, P3] as const;

/** element built per grade → g0 element + `grade` with only the fields each band changes (bands stack: g2 on g1, g3 on g2) */
function graded<T extends ElementSpec>(make: (p: Pal, g: number) => T): T {
  const v = PALS.map((p, g) => make(p, g));
  const base = v[0] as T;
  const out: Record<string, Record<string, unknown>> = {};
  for (let g = 1; g < 4; g++) {
    const cur = v[g] as unknown as Record<string, unknown>;
    const prev = v[g - 1] as unknown as Record<string, unknown>;
    const d: Record<string, unknown> = {};
    for (const k of Object.keys(cur)) if (k !== 'kind' && k !== 'note' && JSON.stringify(cur[k]) !== JSON.stringify(prev[k])) d[k] = cur[k];
    if (Object.keys(d).length > 0) out[`g${g}`] = d;
  }
  return (Object.keys(out).length > 0 ? { ...base, grade: out } : base) as T;
}


function flicker(cols: readonly number[], a: number): number[] {
  const c = (i: number): number => cols[Math.min(cols.length - 1, i)] as number;
  return [0, c(0), 0.33 * a, 0.16, c(0), a, 0.2, c(1), 0.4 * a, 0.42, c(1), a, 0.48, c(2), 0.45 * a, 0.72, c(2), a, 1, c(2), 0];
}




const MAKING: ElementSpec[] = [
  graded((p) => ({
    kind: 'particle',
    note: '',
    cycle: 0.1,
    loops: 1,
    max: 1,
    rate: [0, 1000],
    life: [0, 0.27],
    half: [0, 0.55],
    scale: [[0, 0.66, 1, 0.46], [0, 0.64, 1, 0.44]],
    color: flicker(p.glyph, 0.8),
    billboard: 'screen',
    attach: 'hand_r',
    blend: 'add',
    clamp: 1.1,
    tex: TEX.glyph,
  }) satisfies ParticleSpec),
  graded((p) => ({
    kind: 'particle',
    note: '',
    cycle: 0.1,
    loops: 1,
    max: 1,
    rate: [0, 1000],
    life: [0, 0.27],
    half: [0, p.twirlHalf],
    scale: [0, 0.66, 1, 0.5],
    color: flicker([p.twirl, p.twirl, p.twirl], 0.85),
    billboard: 'screen',
    rotation: { start: [0, 360], spin: 500 },
    attach: 'hand_r',
    blend: 'add',
    clamp: 1.1,
    tex: TEX.twirl,
  }) satisfies ParticleSpec),
  {
    kind: 'particle',
    note: '',
    minRank: 7,
    cycle: 0.1,
    loops: 1,
    max: 1,
    rate: [0, 1000],
    life: [0, 0.3],
    half: [0, 0.85],
    scale: [[0, 0.8351, 0.971, 0.1031], [0, 1, 0.983, 0.2887]],
    color: [0, 0xff240a, 0.3, 0.24, 0xff240a, 0.45, 1, 0xff8a45, 0.6],
    billboard: 'screen',
    rotation: { start: [0, 360], spin: 500 },
    attach: 'hand_r',
    blend: 'add',
    clamp: 1.1,
    tex: TEX.twirl,
  },
  graded((p) => ({
    kind: 'particle',
    note: '',
    cycle: 0.1,
    loops: 1,
    max: 1,
    rate: [0, 1000],
    life: [0, 0.2062],
    half: [0, 0.8],
    scale: [[0, 0.2784, 0.691, p.ringScale], [0, 0.2887, 0.72, p.ringScale]],
    color: [0, p.ring, 0.5, 0.27, p.ring, 0.14, 0.53, p.ring, 0],
    billboard: 'screen',
    attach: 'hand_r',
    blend: 'add',
    tex: TEX.ring,
  }) satisfies ParticleSpec),
  graded((p, g) => ({
    kind: 'particle',
    note: '',
    t0: g === 3 ? 0 : 0.12,
    cycle: 0.1,
    loops: 1,
    max: 2,
    rate: [0, 1000],
    life: [0, g === 3 ? 0.24 : 0.31],
    shape: { kind: 'sphere', radius: g === 3 ? 0.1 : 0.05, edge: g === 3 },
    adv: 'outer',
    dir: { z: [0, 14] },
    vel: [0, 0.04],
    half: [0, g === 3 ? p.puffHalf * 0.72 : p.puffHalf],
    scale: g === 3 ? [[0, 0.62, 1, 1], [0, 0.62, 1, 1]] : [[0, 0.55, 1, 1], [0, 0.55, 1, 1]],
    color: p.puff,
    air: [0, 0.3608],
    billboard: 'screen',
    from: 'hand_r',
    blend: 'add',
    clamp: 1,
    tex: TEX.orb,
  }) satisfies ParticleSpec),
  graded((p, g) => ({
    kind: 'particle',
    note: '',
    t0: g === 3 ? 0 : 0.12,
    cycle: 0.1,
    loops: 1,
    max: 1,
    rate: [0, 1000],
    life: [0, g === 3 ? 0.28 : 0.3],
    half: [0, p.puffHalf * 1.3],
    scale: g === 3 ? [[0, 0.6, 1, 1], [0, 0.6, 1, 1]] : [[0, 0.5, 1, 1], [0, 0.5, 1, 1]],
    color: p.puffFringe,
    air: [0, 0.3608],
    billboard: 'screen',
    from: 'hand_r',
    blend: 'add',
    tex: TEX.orb,
  }) satisfies ParticleSpec),
  {
    kind: 'particle',
    note: '',
    minRank: 7,
    t0: 0,
    cycle: 0.1,
    loops: 1,
    max: 2,
    rate: [0, 1000],
    life: [0, 0.24],
    shape: { kind: 'sphere', radius: 0.06 },
    adv: 'outer',
    dir: { z: [0, 14] },
    vel: [0, 0.04],
    half: [0, 1.15],
    scale: [[0, 0.62, 1, 1], [0, 0.62, 1, 1]],
    color: [0, 0xff9ad8, 0.85, 0.12, 0xff8ad0, 0.6, 0.45, 0xff70b8, 0.2, 1, 0xff54a6, 0],
    air: [0, 0.3608],
    billboard: 'screen',
    from: 'hand_r',
    blend: 'add',
    clamp: 1,
    tex: TEX.orb,
  },
  graded((_p, g) => ({
    kind: 'particle',
    note: '',
    minRank: 5,
    cycle: 0.1,
    loops: 1,
    max: 1,
    rate: [0, 1000],
    life: [0, 0.34],
    half: [0, 0.55],
    scale: [[0, 0.72, 1, 1], [0, 0.65, 1, 1]],
    color: [0, g === 3 ? 0x2a3cb0 : 0x2a34b0, 0.45, 0.41, g === 3 ? 0x2a3cb0 : 0x2a34b0, 0.45, 1, 0x2a34b0, 0],
    billboard: 'screen',
    attach: 'hand_r',
    blend: 'add',
    tex: TEX.glyph,
  }) satisfies ParticleSpec),
];

/** B. the fly body (1bipa_throw: msf MULTI_LINE attach = at the bolt, no wobble) + the msf tail */
const BODY: ElementSpec[] = [
  graded((p) => ({
    kind: 'particle',
    note: '',
    cycle: 1,
    loops: 0,
    max: 1,
    rate: [0, 1000],
    life: [0, 2.113],
    half: [0, 0.64 * U],
    scale: [0, p.wheelScale],
    color: [0, p.wheel, p.wheelAlpha],
    billboard: 'screen',
    rotation: { spin: 468 },
    attach: true,
    blend: 'add',
    tex: TEX.wheel,
  }) satisfies ParticleSpec),
  graded((p) => ({
    kind: 'particle',
    note: 'hot hub of the wheel (ours: keeps the bolt readable at gameplay distance; the strips show a bright round core)',
    cycle: 0.2,
    loops: 0,
    max: 2,
    rate: [0, 12],
    life: [0, 0.2],
    half: [0, 0.46 * U],
    scale: [0, 0.9, 1, 1.1],
    color: [0, p.core, 0.95, 1, p.core, 0.7],
    billboard: 'screen',
    attach: true,
    blend: 'add',
    tex: TEX.chip,
  }) satisfies ParticleSpec),
  graded((p) => ({
    kind: 'particle',
    note: '',
    cycle: 1,
    loops: 0,
    max: 15,
    rate: [0, 50],
    life: [0, 0.15],
    shape: { kind: 'sphere', radius: 0.01 * U },
    dir: { z: [0, -13.92] },
    vel: [0, 0.22 * U],
    half: [0, 0.64 * U],
    scale: [[0, 0.2887, 1, 0.5567], [0, 0.2887, 1, 0.567]],
    color: p.halo,
    billboard: 'screen',
    rotation: { spin: 500 },
    attach: true,
    blend: 'add',
    tex: TEX.halo,
  }) satisfies ParticleSpec),
  graded((p) => ({
    kind: 'particle',
    note: '',
    cycle: 1,
    loops: 0,
    max: 16,
    rate: [0, 64],
    life: [0, 0.22],
    shape: { kind: 'sphere', radius: 0.01 * U },
    adv: 'outer',
    vel: [0, 0.02 * U],
    half: [0, 0.2 * U],
    scale: [0, 1, 1, 0.5],
    color: p.shed,
    billboard: 'screen',
    blend: 'add',
    tex: TEX.chip,
  }) satisfies ParticleSpec),
  graded((p, g) => ({
    kind: 'trail',
    note: 'msf tail (FlyTrace: 0.2 s, TailColor 0x07ff00 / g3 0x006dff, half-width 3 cm; ours 5 cm so it survives the camera)',
    attach: 'origin',
    life: 0.2,
    mode: 'ribbon',
    width: 0.1,
    taper: [0, 1, 1, 0.2],
    color: [0, p.tail, g === 3 ? 0.1 : 0.26, 1, p.tail, 0],
    blend: 'add',
    tex: 'glowStrip',
  }) satisfies TrailSpec),
];







const T0 = 0.05;

const RIM = 5.9 * U;
const FLARE_H = 1.5 * U;
const IMPACT: ElementSpec[] = [
  graded((p) => ({
    kind: 'surface',
    note: '',
    t0: T0 + 0.01,
    life: 0.15,
    shape: { kind: 'card', w: RIM, h: RIM },
    billboard: 'screen',
    scale: [0, 0.38, 0.25, 0.54, 0.6, 0.64, 1, 0.7],
    spin: [0, 0, 1, 90],
    color: p.dome,
    blend: 'add',
    bright: 1.35,
    occlude: 0.8,
    clamp: 1,
    tex: TEX.rim,
  }) satisfies SurfaceSpec),
  graded((p) => ({
    kind: 'surface',
    note: '',
    t0: T0 + 0.01,
    life: 0.15,
    shape: { kind: 'card', w: RIM, h: RIM },
    billboard: 'screen',
    scale: [0, 0.38, 0.25, 0.54, 0.6, 0.64, 1, 0.7],
    color: p.lit,
    blend: 'add',
    bright: 1.2,
    occlude: 0.6,
    clamp: 1,
    tex: TEX.lit,
  }) satisfies SurfaceSpec),
  graded((p) => ({
    kind: 'surface',
    note: '',
    t0: T0,
    life: 0.17,
    shape: { kind: 'card', w: 5.0 * U, h: 5.0 * U },
    billboard: 'screen',
    scale: [0, 0.4, 0.3, 0.6, 1, 0.74],
    color: p.rays,
    blend: 'add',
    bright: 1.1,
    occlude: 0.55,
    clamp: 1,
    tex: TEX.rays,
  }) satisfies SurfaceSpec),
  graded((p, g) => ({
    kind: 'surface',
    note: '',
    t0: T0,
    life: 0.16,
    shape: { kind: 'card', w: (g === 3 ? 1.6 : 1.1) * U, h: (g === 3 ? 2.2 : 1.6) * U },
    at: [0, 0.5 * (g === 3 ? 2.2 : 1.6) * U - 0.05, 0],
    billboard: 'upright',
    scale: [[0, 0.75, 0.25, 1, 1, 1], [0, 0.4, 0.25, 1, 1, 1], [0, 1, 1, 1]],
    color: g === 3 ? [0, 0xffd060, 0, 0.14, 0xffb840, 0.4, 0.45, 0xff9020, 0.32, 0.75, 0xff6810, 0.1, 1, 0xff4808, 0] : [0, 0xfff6c0, 0, 0.14, 0xfff0a0, 0.42, 0.45, 0xffe070, 0.3, 0.75, 0xffd050, 0.1, 1, 0xffc040, 0],
    blend: 'add',
    bright: 1.4,
    occlude: 0.4,
    clamp: 1.1,
    tex: TEX.hot,
  }) satisfies SurfaceSpec),
  graded((p, g) => ({
    kind: 'surface',
    note: '',
    t0: T0,
    life: 0.16,
    shape: { kind: 'card', w: (g === 3 ? 3.0 : 2.4) * U, h: (g === 3 ? 2.3 : 2.8) * U },
    // spray sprite: hot base 3 % above its bottom edge; burst sprite: hot base 30 % above its bottom edge
    at: [0, (g === 3 ? 0.47 * 2.3 * U : 0.2 * 2.8 * U + 0.04), 0],
    billboard: 'upright',
    scale: [[0, 0.8, 0.2, 1, 1, 1.04], [0, 0.4, 0.2, 1, 1, 1.04], [0, 1, 1, 1]],
    color: p.flare,
    blend: 'add',
    bright: 1.7,
    occlude: 0.4,
    clamp: 1.2,
    tex: g === 3 ? TEX.spray : TEX.burst,
  }) satisfies SurfaceSpec),
  {
    kind: 'surface',
    note: '',
    minRank: 7,
    t0: T0,
    life: 0.16,
    shape: { kind: 'card', w: 1.9 * U, h: 1.9 * U },
    at: [0, 0.5 * 1.9 * U - 0.03, 0],
    billboard: 'upright',
    scale: [[0, 0.7, 0.25, 1, 1, 1.05], [0, 0.35, 0.25, 1, 1, 1.05], [0, 1, 1, 1]],
    color: [0, 0xffffff, 0, 0.14, 0xfff0d0, 1, 0.4, 0xffd890, 0.85, 0.75, 0xffa060, 0.3, 1, 0xff7030, 0],
    blend: 'add',
    bright: 1.4,
    occlude: 0.4,
    clamp: 1.15,
    tex: TEX.tongue,
  },
  graded((p) => ({
    kind: 'surface',
    note: '',
    t0: T0,
    life: 0.15,
    shape: { kind: 'card', w: 1.5 * U, h: 1.0 * U },
    at: [0, 0.2 * U, 0],
    billboard: 'upright',
    scale: [0, 0.7, 0.3, 1, 1, 0.85],
    color: p.hot,
    blend: 'add',
    bright: 1.5,
    occlude: 0.25,
    clamp: 1.1,
    tex: TEX.hot,
  }) satisfies SurfaceSpec),
  graded((p) => ({
    kind: 'particle',
    note: '',
    t0: T0,
    cycle: 0.1,
    loops: 1,
    max: 12,
    rate: [0, 1000],
    life: [0, 0.12],
    at: [0, 0.3 * U, 0],
    shape: { kind: 'sphere', radius: 0.1 * U, edge: true },
    adv: 'outer',
    vel: [0, 0.09 * U],
    half: [0, 0.34 * U],
    scale: [[0, 0.2784, 0.36, 0.2, 1, 0], [0, 0.5464, 1, 0]],
    color: p.chip,
    air: [0, 0.0722],
    billboard: 'stretch',
    blend: 'add',
    tex: TEX.chip,
  }) satisfies ParticleSpec),
  graded((p) => ({
    kind: 'particle',
    note: '',
    t0: T0,
    cycle: 0.1,
    loops: 1,
    max: p.dustN,
    rate: [0, 1000],
    life: [0, 0.26],
    at: [0, 1.25 * U, 0],
    shape: { kind: 'box', box: [2 * p.dustR * U, 0.5 * U, 2 * p.dustR * U] },
    adv: 'outer',
    vel: [0, 0.004 * U],
    half: [0, p.dustHalf * 0.8 * U],
    scale: [[0, 0.5, 0.994, 1], [0, 0.5, 0.989, 1]],
    color: p.dust,
    air: [0, 0.06],
    billboard: 'screen',
    rotation: { start: [0, 360], spin: 6, randomDir: true },
    blend: 'add',
    tex: TEX.dust,
  }) satisfies ParticleSpec),
];


export const DRIFTING_CHARMS: FxSpec = {
  id: 'sk.drifting_charms',
  desc: '',
  behavior: 'homingProjectile',
  ref: {},
  size: 'mult',
  base: 0.5,
  dur: 1.5,
  elements: [...MAKING, ...BODY],
  impact: IMPACT,
  impactGround: true,
  fadeOut: 0.08,
  demo: { dir: 0 },
};

/**
 * Awakening (P) of 91, "Charm Cascade": every talisman flares in a 1.3 m burst of light where it lands (the sim's
 * `explodeAt` -> `vfx_explode`, which used to play the shared red hellfire + scorch decal and hid the whole talisman look).
 * The event adapter plays this instead (`sk.<id>.explode`; projectile skills reach it through `EventAdapter.noteTrack`).
 * Built from the g3 blow language of the strips (golden dome rim, glow fill, white-hot spike flare, faint dust) at the
 * blast size, so the ring marks the 1.3 m damage radius. scale = the blast radius (k = scale / 1.3).
 */
export const DRIFTING_CHARMS_EXPLODE: FxSpec = {
  id: 'sk.drifting_charms.explode',
  desc: 'Drifting Charms awakening burst: golden-yellow half-dome rim flaring out to the 1.3 m blast edge, a white-gold flash core and glow fill with a white-hot upward spike flare, a second fainter light ring and a few spark chips (replaces the generic red explosion)',
  behavior: 'skyStrike',
  ref: {},
  size: 'radius',
  base: 1.3,
  dur: 0.5,
  clamp: 1.2,
  elements: [
    {
      kind: 'particle',
      note: 'amber flash core at the heart of the burst (soft mist sprite, small and not white: on pale stone a white core washed the whole burst out)',
      cycle: 0.05,
      max: 1,
      rate: [0, 200],
      life: [0, 0.18],
      at: [0, 0.35, 0],
      half: [0, 0.85],
      scale: [0, 0.55, 0.3, 1, 1, 1.1],
      color: [0, 0xffe8a0, 0.7, 0.3, 0xffd070, 0.55, 1, 0xffa040, 0],
      billboard: 'screen',
      blend: 'add',
      occlude: 0.5,
      clamp: 1,
      tex: TEX.rays,
    },
    {
      kind: 'surface',
      note: '',
      life: 0.22,
      shape: { kind: 'card', w: 3.6, h: 3.6 },
      billboard: 'screen',
      scale: [0, 0.34, 0.3, 0.74, 1, 0.86],
      spin: [0, 0, 1, 80],
      color: [0, 0xffe060, 0, 0.18, 0xffc030, 1, 0.45, 0xffa820, 0.8, 0.7, 0xff9020, 0.16, 1, 0xff7820, 0],
      blend: 'add',
      bright: 1.35,
      occlude: 0.75,
      clamp: 1,
      tex: TEX.rim,
    },
    {
      kind: 'surface',
      note: '',
      life: 0.22,
      shape: { kind: 'card', w: 3.6, h: 3.6 },
      billboard: 'screen',
      scale: [0, 0.34, 0.3, 0.74, 1, 0.86],
      color: [0, 0xffd060, 0, 0.2, 0xffbc48, 0.3, 0.55, 0xff9830, 0.2, 1, 0xff6820, 0],
      blend: 'add',
      bright: 1.2,
      occlude: 0.4,
      clamp: 1,
      tex: TEX.lit,
    },
    {
      kind: 'surface',
      note: '',
      t0: 0.07,
      life: 0.2,
      shape: { kind: 'card', w: 4.6, h: 4.6 },
      billboard: 'screen',
      scale: [0, 0.4, 1, 0.9],
      spin: [0, 40, 1, -60],
      color: [0, 0xffd040, 0, 0.2, 0xffb030, 0.45, 0.6, 0xff9020, 0.18, 1, 0xff7820, 0],
      blend: 'add',
      occlude: 0.5,
      clamp: 1,
      tex: TEX.rim,
    },
    {
      kind: 'surface',
      note: '',
      life: 0.2,
      shape: { kind: 'card', w: 1.9, h: 1.7 },
      at: [0, 0.47 * 1.7, 0],
      billboard: 'upright',
      scale: [[0, 0.8, 0.25, 1, 1, 1.04], [0, 0.4, 0.25, 1, 1, 1.04], [0, 1, 1, 1]],
      color: [0, 0xffe890, 0, 0.14, 0xffd860, 1, 0.5, 0xffa020, 0.55, 1, 0xff5010, 0],
      blend: 'add',
      bright: 1.6,
      occlude: 0.45,
      clamp: 1.15,
      tex: TEX.spray,
    },
    {
      kind: 'surface',
      note: '',
      life: 0.2,
      shape: { kind: 'card', w: 1.0, h: 1.1 },
      at: [0, 0.5 * 1.1 - 0.02, 0],
      billboard: 'upright',
      scale: [[0, 0.7, 0.25, 1, 1, 1.05], [0, 0.35, 0.25, 1, 1, 1.05], [0, 1, 1, 1]],
      color: [0, 0xffffff, 0, 0.14, 0xfff0d0, 1, 0.4, 0xffd890, 0.85, 0.75, 0xffa060, 0.3, 1, 0xff7030, 0],
      blend: 'add',
      bright: 1.4,
      occlude: 0.4,
      clamp: 1.1,
      tex: TEX.tongue,
    },
    {
      kind: 'particle',
      note: '',
      cycle: 0.1,
      max: 14,
      rate: [0, 1000],
      life: [0, 0.16],
      at: [0, 0.3, 0],
      shape: { kind: 'sphere', radius: 0.1, edge: true },
      adv: 'outer',
      vel: [0, 0.07],
      half: [0, 0.3],
      scale: [[0, 0.28, 0.36, 0.2, 1, 0], [0, 0.55, 1, 0]],
      color: [0, 0xffd080, 1, 0.62, 0xffa040, 0],
      air: [0, 0.0722],
      billboard: 'stretch',
      blend: 'add',
      tex: TEX.chip,
    },
    {
      kind: 'particle',
      note: '',
      t0: 0.04,
      cycle: 0.1,
      max: 3,
      rate: [0, 1000],
      life: [0, 0.4],
      at: [0, 0.9, 0],
      shape: { kind: 'box', box: [1.8, 0.3, 1.8] },
      adv: 'outer',
      vel: [0, 0.003],
      half: [0, 1.0],
      scale: [[0, 0.5, 1, 1], [0, 0.5, 1, 1]],
      color: [0, 0xffc060, 0, 0.12, 0xffc060, 0.12, 0.5, 0xffb050, 0.08, 1, 0xff9040, 0],
      billboard: 'screen',
      rotation: { start: [0, 360], spin: 6, randomDir: true },
      blend: 'add',
      tex: TEX.dust,
    },
  ],
};
