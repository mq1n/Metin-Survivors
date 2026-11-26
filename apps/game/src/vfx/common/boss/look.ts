// Boss look table + element palettes (common VFX target `boss`; owner: the boss builder).
// The sim's boss events carry the element only on `vfx` events (elementOfRaces(def.race)); bossSpawn / bossPhase / bossDeath carry the boss id
// alone, so the routes resolve the element (and the body size) from this table. `__tests__/boss.test.ts` pins it against data/content/bosses.json.
import type { Ctx } from '../../emit';
import { copyPalette, type Palette } from '../../palette';
import { mixHex } from '../../util';

/** sim ElementIdx values used here */
export const EL = { physical: 0, fire: 1, ice: 2, lightning: 3, dark: 4, poison: 5, holy: 6, wind: 7 } as const;

export interface BossLook {
  /** element of the boss race (sim `elementOfRaces`) */
  readonly el: number;
  /** sim body radius (m) */
  readonly r: number;
}

/** every boss of data/content/bosses.json: race -> element (fire / dragon = fire, ice = ice, undead / devil / esoteric = dark, else physical) and the sim radius */
export const BOSS_LOOK: Readonly<Record<string, BossLook>> = {
  boss_chan_dae: { el: EL.physical, r: 1.35 },
  boss_dol_gwan: { el: EL.physical, r: 1.8 },
  boss_ung_jae: { el: EL.physical, r: 2.12 },
  boss_ji_yul: { el: EL.physical, r: 0.77 },
  boss_horyeong: { el: EL.physical, r: 1.5 },
  boss_orc_sorcerer: { el: EL.physical, r: 1.04 },
  boss_feral_maniac: { el: EL.physical, r: 1.15 },
  boss_dark_inquisitor: { el: EL.dark, r: 1.65 },
  boss_black_orc_giant: { el: EL.physical, r: 1.92 },
  boss_chief_orc: { el: EL.physical, r: 1.75 },
  boss_blighted_swordsman: { el: EL.dark, r: 0.95 },
  boss_blighted_archer: { el: EL.dark, r: 0.8 },
  boss_blighted_marshal: { el: EL.dark, r: 1.3 },
  boss_ice_golem: { el: EL.ice, r: 2.6 },
  boss_miho: { el: EL.ice, r: 1.4 },
  boss_blaze_tiger: { el: EL.fire, r: 1.61 },
  boss_greater_ash_wisp: { el: EL.fire, r: 1.08 },
  boss_basalt_general: { el: EL.fire, r: 1.98 },
  boss_pyre_king: { el: EL.fire, r: 1.8 },
  boss_scarlet_wyrm: { el: EL.fire, r: 2.6 },
};

const FALLBACK_LOOK: BossLook = { el: EL.physical, r: 1.6 };

export function bossLook(id: string): BossLook {
  return BOSS_LOOK[id] ?? FALLBACK_LOOK;
}






const PAL: Record<number, Palette> = {
  // physical beasts / humans / orcs: ember-red dust over brown earth
  [EL.physical]: { main: 0xe8743a, core: 0xffe0b0, edge: 0x7a2a12, smoke: 0x2c1c16, extra: 0xffb060 },
  [EL.fire]: { main: 0xff7a22, core: 0xfff0c0, edge: 0xb02008, smoke: 0x26120c, extra: 0xffc83a },
  [EL.ice]: { main: 0x5aa8ff, core: 0xeaf6ff, edge: 0x1c4ab0, smoke: 0x16264a, extra: 0xa8e8ff },
  [EL.lightning]: { main: 0x8cc0ff, core: 0xffffff, edge: 0x3a56e8, smoke: 0x1e2850, extra: 0xc8a8ff },
  [EL.dark]: { main: 0xa84cff, core: 0xf0d8ff, edge: 0x4a1a90, smoke: 0x160a26, extra: 0xff4ab0 },
  [EL.poison]: { main: 0x70d84a, core: 0xe8ffb0, edge: 0x2a8a2a, smoke: 0x16260e, extra: 0xb865e8 },
  [EL.holy]: { main: 0xffd870, core: 0xfffbe0, edge: 0xd8901c, smoke: 0x3a2c14, extra: 0xffffff },
  [EL.wind]: { main: 0x6ad8c8, core: 0xe8fff8, edge: 0x1c8a80, smoke: 0x14282a, extra: 0xc0fff0 },
};

/**
 * r2: tones of the standing smoke volumes (the upright haze every set piece throws above the boss). `body` = the alpha-blended smoke body: a
 * MID tone saturated in the element hue (the blue-violet haze of whitedragon_boss2, the maroon puff of monster_die), never near-black, so it
 * stays a lit volume on dark stone and does not turn into a dark stain on snow; `glow` = the luminous additive core inside it; `scar` = the
 * tint of the low-contrast ground memory (cracks, scuffs): the floor's own darker shade, never a black ink vein.
 */
export interface HazeTone {
  readonly body: number;
  readonly glow: number;
  readonly scar: number;
}
const HAZE: Record<number, HazeTone> = {
  [EL.physical]: { body: 0x5a3c38, glow: 0xff9058, scar: 0x6a5a4c },
  [EL.fire]: { body: 0x6a2c18, glow: 0xffa030, scar: 0x5e3c2c },
  [EL.ice]: { body: 0x5a68cc, glow: 0x86ecff, scar: 0x8a9ac2 },
  [EL.lightning]: { body: 0x4a62c0, glow: 0xb0d8ff, scar: 0x7a88b0 },
  [EL.dark]: { body: 0x6e3eb0, glow: 0xe078ff, scar: 0x5a4a6a },
  [EL.poison]: { body: 0x468a3a, glow: 0xc0ff78, scar: 0x566a44 },
  [EL.holy]: { body: 0xb08c48, glow: 0xfff0b0, scar: 0x8a7a50 },
  [EL.wind]: { body: 0x3a8a80, glow: 0xc8fff0, scar: 0x5a7a74 },
};




const HAZE_RAGE: Record<number, HazeTone> = {
  [EL.physical]: { body: 0x7a2018, glow: 0xff5424, scar: 0x5a3028 },
  [EL.fire]: { body: 0x6e1c08, glow: 0xffa030, scar: 0x5a3028 },
  [EL.ice]: { body: 0x3c46c4, glow: 0x9aeaff, scar: 0x8a9ac2 },
  [EL.lightning]: { body: 0x3450d0, glow: 0xc0e0ff, scar: 0x7a88b0 },
  [EL.dark]: { body: 0x7424c0, glow: 0xd154ff, scar: 0x5a4a6a },
  [EL.poison]: { body: 0x2e8a26, glow: 0xc8ff5a, scar: 0x566a44 },
  [EL.holy]: { body: 0xb0842c, glow: 0xfff0a0, scar: 0x8a7a50 },
  [EL.wind]: { body: 0x2a8a80, glow: 0xc8fff0, scar: 0x5a7a74 },
};

export function hazeTone(el: number, enraged = false): HazeTone {
  if (enraged) return HAZE_RAGE[el] ?? (HAZE_RAGE[EL.physical] as HazeTone);
  return HAZE[el] ?? (HAZE[EL.physical] as HazeTone);
}

/** the palette of an element (unknown / -1 = physical) */
export function elementPalette(el: number): Palette {
  return PAL[el] ?? (PAL[EL.physical] as Palette);
}

/**
 * Writes the element palette of the spawn into `c.pal` and returns it (in-place: every kit helper and spec layer of the preset then reads the same
 * colours). `dflt` = the element used when the caller gave none or physical (teleport / summon default to dark magic).
 */
export function bossPal(c: Ctx, dflt: number = EL.physical): Palette {
  const el = c.element > 0 && c.element < 8 ? c.element : dflt;
  copyPalette(elementPalette(el), c.pal);
  c.tinted = true;
  return c.pal;
}

/**
 * enrage hue (r3): the element palette, hotter. A physical boss (no hue of its own) is pulled toward blood red; fire a little; ice / dark / poison keep
 * their hue (the r2 enrage burned orange on the ice golem: the critic's reference sheet has the aura as a purple / blue swirl smoke, not a fire).
 */
export function enragePal(c: Ctx): Palette {
  const p = bossPal(c);
  const el = c.element > 0 && c.element < 8 ? c.element : 0;
  const k = el === EL.physical ? 0.62 : el === EL.fire ? 0.3 : 0.08;
  p.main = mixHex(p.main, 0xff2a14, k);
  p.edge = mixHex(p.edge, 0x8a0a0a, k * 0.9);
  p.core = mixHex(p.core, 0xffd0a0, k * 0.8);
  p.extra = mixHex(p.extra, 0xff7a20, k);
  return p;
}

/** body radius -> effect scale: the preset bases (5, 6, 7 m) are authored for a 1.8 m boss */
export function bossScale(r: number): number {
  return Math.max(0.6, Math.min(1.6, r / 1.8));
}
