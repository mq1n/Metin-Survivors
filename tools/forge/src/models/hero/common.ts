// Shared helpers for the hero families: roster heights, tier tables, skin/palette defaults.
import type { Build, HumanoidParams, PieceSpec } from '../../archetypes/humanoid/index.ts';

export type Sex = 'm' | 'f';
export const TIERS = [0, 1, 2, 3] as const;
export const SKIN_M = { base: '#d89d70', shade: '#a8694a', lip: '#a65a4a', eye: '#2a1a10', brow: '#1c1410' };
export const SKIN_F = { base: '#e3ae84', shade: '#b4785a', lip: '#b8584c', eye: '#2a1a10', brow: '#2a1c16' };
/** roster heightM per class/sex (content/model_roster.json); bodyHeight = sole-to-skull so hair/helm crests add on top */
export const HEIGHT: Record<string, number> = {
  warrior_m: 1.8, warrior_f: 1.728, ninja_m: 1.72, ninja_f: 1.6512, yacha_m: 1.76, yacha_f: 1.6896, shaman_m: 1.68, shaman_f: 1.6128, wolfman_m: 2.15,
};

/** measured model heights (m) of the first calibration batch at bodyHeight = heightM - 0.045 - crown; bodyHeight is rescaled so the built model matches the roster heightM */
const MEASURED: Record<string, number> = {
  warrior_m_t0: 1.814, warrior_m_t1: 1.795, warrior_m_t2: 1.815, warrior_m_t3: 1.845, warrior_f_t0: 1.687, warrior_f_t1: 1.687, warrior_f_t2: 1.69, warrior_f_t3: 1.758,
  ninja_m_t0: 1.679, ninja_m_t1: 1.679, ninja_m_t2: 1.686, ninja_m_t3: 1.686, ninja_f_t0: 1.61, ninja_f_t1: 1.61, ninja_f_t2: 1.618, ninja_f_t3: 1.617,
  yacha_m_t0: 1.726, yacha_m_t1: 1.724, yacha_m_t2: 1.724, yacha_m_t3: 1.703, yacha_f_t0: 1.652, yacha_f_t1: 1.654, yacha_f_t2: 1.656, yacha_f_t3: 1.632,
  shaman_m_t0: 1.667, shaman_m_t1: 1.666, shaman_m_t2: 1.647, shaman_m_t3: 1.647, shaman_f_t0: 1.598, shaman_f_t1: 1.6, shaman_f_t2: 1.579, shaman_f_t3: 1.578,
  wolfman_m_t0: 1.909, wolfman_m_t1: 1.909, wolfman_m_t2: 1.909, wolfman_m_t3: 1.907,
};

export interface HeroSpec {
  cls: string;
  sex: Sex;
  tier: number;
  build: Partial<Build>;
  face?: HumanoidParams['face'];
  skin?: HumanoidParams['skin'];
  hair: HumanoidParams['hair'];
  outfit: PieceSpec[];
  palette: Record<string, string>;
  style: HumanoidParams['style'];
  styleB?: HumanoidParams['style'];
  rig: NonNullable<HumanoidParams['rig']>;
  head?: HumanoidParams['head'];
  glow?: HumanoidParams['glow'];
  crown?: number;
}

export function makeHero(h: HeroSpec): HumanoidParams {
  const id = `${h.cls}_${h.sex}_t${h.tier}`;
  const heightM = HEIGHT[`${h.cls}_${h.sex}`]!;
  return {
    id, kind: 'hero', seed: id, sex: h.sex,
    bodyHeight: (heightM - 0.045 - (h.crown ?? 0)) * (heightM / (MEASURED[id] ?? heightM)),
    build: h.build,
    face: h.face ?? { jaw: h.sex === 'm' ? 0.65 : 0.35, brow: h.sex === 'm' ? 0.4 : 0.25, nose: 0.5, lips: h.sex === 'm' ? 0.4 : 0.7, eyes: h.sex === 'm' ? 1.1 : 1.2, cheeks: 0.5, slant: 0.1 },
    skin: h.skin ?? (h.sex === 'm' ? SKIN_M : SKIN_F),
    hair: h.hair, outfit: h.outfit, palette: h.palette, style: h.style,
    ...(h.styleB ? { styleB: h.styleB } : {}),
    rig: h.rig, tier: h.tier, texture: 1024,
    ...(h.head ? { head: h.head } : {}),
    ...(h.glow ? { glow: h.glow } : {}),
  };
}
