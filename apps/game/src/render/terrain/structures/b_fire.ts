// Set B, fire props: bonfire, brazier (bronze, orange fire), plague_brazier (iron, green fire). The solid part is a
// vertex-painted mesh; the flame is a second additive part (b_mat flameParts) animated through StructureModel.update.
import { Vector3 } from 'three';
import { PAL, TAU, solidPart, vary } from './b_common';
import { MAT, MeshBuilder, V, smooth } from './b_geom';
import { flameParts, type FlameCard, type FlameGlow, type FlamePalette } from './b_mat';
import { banner, skull } from './b_orc';
import type { StructureBuildContext, StructureModel, StructurePart } from './types';

function withFlames(solid: StructurePart, cards: FlameCard[], glows: FlameGlow[], palette: FlamePalette, gain?: number): StructureModel {
  const f = flameParts(cards, glows, palette, gain);
  return { parts: [solid, { geometry: f.geometry, material: f.material, castShadow: false }], update: (t) => f.update(t) };
}

// ---- bonfire ------------------------------------------------------------------------------------------------------

function bonfire(ctx: StructureBuildContext): StructureModel {
  const mb = new MeshBuilder(41);
  const rng = mb.rng;
  // scorched ground + ash bed
  mb.set({ mat: MAT.stone, color: '#2b2622', color2: '#4a3f36', blend: 0.5, ao: 0, mottle: 0.25, uvs: 0.8 });
  mb.disc(0.95, 0.025, 1, 14);
  mb.set({ color: '#4a4540', color2: '#241f1c', blend: 0.6 });
  mb.disc(0.62, 0.05, 1, 12);
  // stone ring, warm-lit on the inside
  mb.set({ mat: MAT.stone, color: PAL.stone, color2: '#c26a2e', blend: 0.18, mottle: 0.16, uvs: 0.7, ao: 0.4, aoH: 0.25 });
  const stones = 11;
  for (let i = 0; i < stones; i++) {
    const a = (i / stones) * TAU + (rng() - 0.5) * 0.12;
    const r = 0.76 + (rng() - 0.5) * 0.06;
    mb.scope(() => {
      mb.t(Math.cos(a) * r, 0.1, Math.sin(a) * r).ry(-a);
      mb.set({ color: vary(i % 3 === 0 ? '#8b867b' : PAL.stone, rng, 0.15) });
      mb.blob(0.12 + rng() * 0.03, 0.12 + rng() * 0.04, 0.2 + rng() * 0.05, { seg: 6, rings: 3, lump: 0.2, seedOffset: i });
    });
  }
  // log pile: leaning logs with charred, glowing ends
  mb.set({ mat: MAT.bark, color: '#6a5139', color2: '#1d1612', blend: 0.45, uvs: 0.6, ao: 0.25, aoH: 0.5, mottle: 0.14 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.4 + (rng() - 0.5) * 0.3;
    const from = V(Math.cos(a) * 0.68, 0.14, Math.sin(a) * 0.68);
    const to = V(Math.cos(a) * 0.1, 0.78 + rng() * 0.12, Math.sin(a) * 0.1);
    mb.pole(from, to, 0.085, 0.065, { radial: 6, lenSeg: 3, shade: (t) => 1 - 0.6 * smooth(0.5, 1, t), bend: 0.02 });
  }
  for (const [yaw, off] of [
    [0.3, 0.1],
    [1.9, -0.05],
  ] as Array<[number, number]>) {
    mb.scope(() => {
      mb.ry(yaw).t(0, 0.11, off);
      mb.pole(V(-0.55, 0, 0), V(0.55, 0, 0), 0.09, 0.08, { radial: 6, lenSeg: 2, shade: (t) => 1 - 0.55 * smooth(0.4, 0.5, Math.abs(t - 0.5) * 2 * -1 + 1) });
    });
  }
  // glowing coals
  mb.set({ mat: MAT.glow, color: '#ff6a1c', color2: '#ffb347', blend: 0.4, ao: 0, mottle: 0.3, jitter: 0.2 });
  for (let i = 0; i < 8; i++) {
    const a = rng() * TAU;
    const r = Math.sqrt(rng()) * 0.38;
    mb.scope(() => {
      mb.t(Math.cos(a) * r, 0.1 + rng() * 0.04, Math.sin(a) * r).ry(rng() * TAU);
      mb.blob(0.07 + rng() * 0.05, 0.05 + rng() * 0.03, 0.07 + rng() * 0.05, { seg: 5, rings: 3, lump: 0.25, seedOffset: 50 + i });
    });
  }
  const cards: FlameCard[] = [
    { x: 0, y: 0.32, z: 0, w: 1.0, h: 1.45, ph: 0.0 },
    { x: -0.2, y: 0.28, z: 0.14, w: 0.72, h: 1.05, ph: 0.37 },
    { x: 0.22, y: 0.28, z: -0.12, w: 0.7, h: 1.1, ph: 0.71 },
    { x: 0.1, y: 0.25, z: 0.26, w: 0.5, h: 0.7, ph: 0.15 },
    { x: -0.15, y: 0.25, z: -0.25, w: 0.45, h: 0.65, ph: 0.55 },
  ];
  const glows: FlameGlow[] = [
    { x: 0, y: 0.05, z: 0, r: 2.3, ground: true },
    { x: 0, y: 0.7, z: 0, r: 1.15 },
  ];
  return withFlames(solidPart(mb, ctx, { roughness: 0.92, glow: 2.8 }), cards, glows, 'fire');
}

// ---- braziers -----------------------------------------------------------------------------------------------------

interface BrazierStyle {
  metal: string;
  metalDark: string;
  metalLight: string;
  age: string;
}

function basin(mb: MeshBuilder, rimY: number, rimR: number, st: BrazierStyle, seg: number): void {
  const depth = 0.42;
  const profile: Array<[number, number]> = [
    [0.05, rimY - depth - 0.06],
    [0.2, rimY - depth - 0.03],
    [rimR * 0.62, rimY - depth * 0.7],
    [rimR * 0.92, rimY - depth * 0.28],
    [rimR, rimY],
    [rimR + 0.05, rimY + 0.03],
    [rimR + 0.04, rimY + 0.06],
    [rimR - 0.05, rimY + 0.045],
    [rimR - 0.07, rimY - 0.02],
    [rimR * 0.8, rimY - depth * 0.55],
    [0.18, rimY - depth + 0.04],
  ];
  mb.set({ mat: MAT.plain, color: st.metal, color2: st.age, blend: 0.45, mottle: 0.2, mottleFreq: 2.8, ao: 0, jitter: 0.05 });
  mb.lathe(profile, { seg, crease: 1.1, rad: (a) => 1 + 0.012 * Math.sin(a * TAU * 6) });
}

function brazierBase(ctx: StructureBuildContext, o: { seed: number; style: BrazierStyle; plague: boolean }): StructureModel {
  const mb = new MeshBuilder(o.seed);
  const rng = mb.rng;
  const st = o.style;
  const rimY = o.plague ? 1.18 : 1.1;
  const rimR = o.plague ? 0.42 : 0.52;
  const legR = o.plague ? 0.5 : 0.62;
  mb.set({ mat: MAT.plain, color: st.metal, color2: st.age, blend: 0.4, mottle: 0.2, ao: 0.3, aoH: 0.5 });
  // three claw-footed legs
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + 0.3;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const pts = [
      V(ca * (legR + 0.1), 0.0, sa * (legR + 0.1)),
      V(ca * (legR + 0.14), 0.07, sa * (legR + 0.14)),
      V(ca * (legR + 0.02), 0.34, sa * (legR + 0.02)),
      V(ca * (rimR * 0.6), rimY * 0.66, sa * (rimR * 0.6)),
      V(ca * (rimR * 0.5), rimY - 0.3, sa * (rimR * 0.5)),
    ];
    mb.tube(pts, (t) => 0.055 - 0.02 * t, { radial: 5, cap0: 'flat', cap1: 'flat', shade: (t) => 0.8 + 0.3 * t });
    // claw foot
    mb.scope(() => {
      mb.t(ca * (legR + 0.12), 0.05, sa * (legR + 0.12));
      mb.blob(0.075, 0.05, 0.075, { seg: 5, rings: 3, lump: 0.1 });
    });
  }
  // ring brace between the legs
  const ring: Vector3[] = [];
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * TAU + 0.3;
    const rr = legR * 0.62 + 0.02;
    ring.push(V(Math.cos(a) * rr, 0.46, Math.sin(a) * rr));
  }
  mb.tube(ring, 0.022, { radial: 4, cap0: 'flat', cap1: 'flat' });
  basin(mb, rimY, rimR, st, 12);
  // decorative bands on the bowl
  mb.set({ mat: MAT.plain, color: st.metalLight, color2: st.metal, blend: 0.3, ao: 0, mottle: 0.15 });
  const bandY = rimY - 0.2;
  const br = rimR * 0.9;
  mb.scope(() => {
    mb.t(0, bandY, 0);
    mb.lathe(
      [
        [br, -0.03],
        [br + 0.025, 0],
        [br, 0.03],
      ],
      { seg: 12 },
    );
  });
  // side handle rings
  for (const side of [0, Math.PI]) {
    mb.scope(() => {
      mb.ry(side);
      const hp: Vector3[] = [];
      for (let i = 0; i <= 8; i++) {
        const t = (i / 8) * TAU;
        hp.push(V(rimR + 0.1 + Math.cos(t) * 0.07, rimY - 0.12 + Math.sin(t) * 0.07, 0));
      }
      mb.tube(hp, 0.014, { radial: 4, cap0: 'flat', cap1: 'flat' });
    });
  }
  // glowing coals in the bowl
  mb.set({ mat: MAT.glow, color: o.plague ? '#46d85a' : '#ff6a1c', color2: o.plague ? '#b8ff9a' : '#ffb347', blend: 0.4, ao: 0, mottle: 0.3, jitter: 0.2 });
  for (let i = 0; i < 6; i++) {
    const a = rng() * TAU;
    const r = Math.sqrt(rng()) * rimR * 0.6;
    mb.scope(() => {
      mb.t(Math.cos(a) * r, rimY - 0.12 + rng() * 0.04, Math.sin(a) * r).ry(rng() * TAU);
      mb.blob(0.07 + rng() * 0.04, 0.05 + rng() * 0.02, 0.07 + rng() * 0.04, { seg: 5, rings: 3, lump: 0.25, seedOffset: 70 + i });
    });
  }
  if (o.plague) {
    // spiked rim, a trophy skull and tattered green-stained rags
    mb.set({ mat: MAT.plain, color: st.metalDark, color2: st.age, blend: 0.4, ao: 0, mottle: 0.2 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      mb.scope(() => {
        mb.t(Math.cos(a) * (rimR + 0.02), rimY + 0.03, Math.sin(a) * (rimR + 0.02)).rz(-Math.cos(a) * 0.5).rx(Math.sin(a) * 0.5);
        mb.spike(0.025, 0.2, 4);
      });
    }
    mb.scope(() => {
      mb.t(0, rimY - 0.3, rimR + 0.1).rx(-0.1);
      skull(mb, { scale: 0.7 });
    });
    for (const [yaw, len] of [
      [0.6, 0.6],
      [3.4, 0.5],
    ] as Array<[number, number]>) {
      mb.scope(() => {
        mb.ry(yaw).t(0, rimY - 0.05, rimR + 0.04);
        banner(mb, { w: 0.14, h: len, tail: 0.3, cloth: '#4a583b', trim: '#6e8a52', swayTop: 0.15, ragged: true });
      });
    }
  }
  const y0 = rimY - 0.12;
  const cards: FlameCard[] = o.plague
    ? [
        { x: 0, y: y0, z: 0, w: 0.62, h: 1.1, ph: 0.0 },
        { x: -0.12, y: y0, z: 0.08, w: 0.42, h: 0.8, ph: 0.4 },
        { x: 0.13, y: y0, z: -0.09, w: 0.42, h: 0.85, ph: 0.7 },
      ]
    : [
        { x: 0, y: y0, z: 0, w: 0.82, h: 1.1, ph: 0.0 },
        { x: -0.17, y: y0, z: 0.11, w: 0.56, h: 0.8, ph: 0.4 },
        { x: 0.18, y: y0, z: -0.1, w: 0.56, h: 0.85, ph: 0.7 },
      ];
  const glows: FlameGlow[] = [
    { x: 0, y: 0.04, z: 0, r: o.plague ? 1.5 : 1.8, ground: true },
    { x: 0, y: rimY + 0.3, z: 0, r: o.plague ? 0.75 : 0.9 },
  ];
  return withFlames(
    solidPart(mb, ctx, { roughness: o.plague ? 0.85 : 0.62, sway: o.plague, doubleSided: o.plague, glow: 2.6 }),
    cards,
    glows,
    o.plague ? 'plague' : 'fire',
  );
}

const BRONZE: BrazierStyle = { metal: '#b9803a', metalDark: '#6a4720', metalLight: '#e2b25a', age: '#58947a' };
const IRON: BrazierStyle = { metal: '#3f3f46', metalDark: '#27272c', metalLight: '#6a6a72', age: '#6b3b24' };

// ---- flame sockets of GLB props (E2, forge-audit plan) ------------------------------------------------------------------
// A Tripo prop GLB carries no flame geometry: an empty node named `flame` / `flame_1` / ... marks where the fire burns (its base),
// and the engine attaches the same additive flame as the procedural props above. Coordinates are relative to the socket, ground
// discs sit on the prop's ground (y = GROUND_GLOW_Y) under the socket. Today's GLBs have no such node: nothing changes for them.

export interface FlameSocketPreset {
  cards: FlameCard[];
  glows: FlameGlow[];
  palette: FlamePalette;
  gain?: number;
}

const GROUND_GLOW_Y = 0.04;

const BONFIRE_FLAME: FlameSocketPreset = {
  cards: [
    { x: 0, y: 0.02, z: 0, w: 1.0, h: 1.45, ph: 0.0 },
    { x: -0.2, y: -0.02, z: 0.14, w: 0.72, h: 1.05, ph: 0.37 },
    { x: 0.22, y: -0.02, z: -0.12, w: 0.7, h: 1.1, ph: 0.71 },
    { x: 0.1, y: -0.05, z: 0.26, w: 0.5, h: 0.7, ph: 0.15 },
    { x: -0.15, y: -0.05, z: -0.25, w: 0.45, h: 0.65, ph: 0.55 },
  ],
  glows: [
    { x: 0, y: GROUND_GLOW_Y, z: 0, r: 2.3, ground: true },
    { x: 0, y: 0.4, z: 0, r: 1.15 },
  ],
  palette: 'fire',
};

const BRAZIER_FLAME: FlameSocketPreset = {
  cards: [
    { x: 0, y: 0, z: 0, w: 0.82, h: 1.1, ph: 0.0 },
    { x: -0.17, y: 0, z: 0.11, w: 0.56, h: 0.8, ph: 0.4 },
    { x: 0.18, y: 0, z: -0.1, w: 0.56, h: 0.85, ph: 0.7 },
  ],
  glows: [
    { x: 0, y: GROUND_GLOW_Y, z: 0, r: 1.8, ground: true },
    { x: 0, y: 0.42, z: 0, r: 0.9 },
  ],
  palette: 'fire',
};

// r7 ship 10-30: the plague brazier GLB is the 1.3 m stone lantern (socket over the coal bed, 0.72 m; roof underside ~0.92 m): a lantern-sized
// flame that stays inside the chamber (the 1.1 m cards burned through the roof at the game camera), a soft chamber halo and a ground glow
const PLAGUE_FLAME: FlameSocketPreset = {
  cards: [
    { x: 0, y: 0, z: 0, w: 0.16, h: 0.18, ph: 0.0 },
    { x: -0.05, y: 0, z: 0.04, w: 0.11, h: 0.13, ph: 0.4 },
    { x: 0.05, y: 0, z: -0.04, w: 0.11, h: 0.14, ph: 0.7 },
  ],
  glows: [
    { x: 0, y: GROUND_GLOW_Y, z: 0, r: 1.2, ground: true },
    { x: 0, y: 0.08, z: 0, r: 0.4 },
  ],
  palette: 'plague',
};

/** per prop id; an id without an entry takes the brazier flame (fire_brazier, fire_altar, lava_pillar ...) */
const FLAME_PRESETS: Record<string, FlameSocketPreset> = { bonfire: BONFIRE_FLAME, brazier: BRAZIER_FLAME, plague_brazier: PLAGUE_FLAME };

/** `flame`, `flame_1`, `flame.001` ... : the empty nodes of a prop GLB that mark a fire */
export const isFlameSocketName = (name: string): boolean => /^flame([_.]?\d+)?$/i.test(name);

/**
 * The engine flame for the fire sockets of prop `id` (points in prop space, y up, ground at 0): one additive part (cards + glows of every
 * socket merged) and its per-frame `update`. Null when there is no socket.
 */
export function socketFlames(id: string, sockets: readonly Vector3[]): { part: StructurePart; update: (t: number) => void } | null {
  if (sockets.length === 0) return null;
  const preset = FLAME_PRESETS[id] ?? BRAZIER_FLAME;
  const cards: FlameCard[] = [];
  const glows: FlameGlow[] = [];
  sockets.forEach((s, i) => {
    for (const c of preset.cards) cards.push({ ...c, x: c.x + s.x, y: c.y + s.y, z: c.z + s.z, ph: (c.ph + i * 0.29) % 1 });
    for (const g of preset.glows) glows.push({ ...g, x: g.x + s.x, y: g.ground ? g.y : g.y + s.y, z: g.z + s.z });
  });
  const f = flameParts(cards, glows, preset.palette, preset.gain);
  return { part: { geometry: f.geometry, material: f.material, castShadow: false }, update: (t) => f.update(t) };
}

export const FIRE_DEFS = {
  bonfire: { build: bonfire, textures: ['tex_rock_mossy', 'tex_bark_oak'] },
  brazier: { build: (ctx: StructureBuildContext) => brazierBase(ctx, { seed: 42, style: BRONZE, plague: false }) },
  plague_brazier: { build: (ctx: StructureBuildContext) => brazierBase(ctx, { seed: 43, style: IRON, plague: true }) },
};
