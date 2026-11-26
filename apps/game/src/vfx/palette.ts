// Effect palettes. Every preset draws from a Palette (main / core / edge / smoke / extra) so one recipe serves every
// element and class; `color` overrides derive a full palette from a single hex.
import { mixHex, scaleHex } from './util';

export interface Palette {
  /** body colour */
  main: number;
  /** white-hot core */
  core: number;
  /** saturated dark edge */
  edge: number;
  /** smoke / dust / residue */
  smoke: number;
  /** accent (second hue) */
  extra: number;
}

export const PALETTES = {
  physical: { main: 0xffe6a8, core: 0xffffff, edge: 0xff9a2e, smoke: 0x8c8068, extra: 0xffd36a },
  fire: { main: 0xffa032, core: 0xfff3c0, edge: 0xd8280a, smoke: 0x2b1a14, extra: 0xffd23a },
  ice: { main: 0x9be6ff, core: 0xffffff, edge: 0x2f86ff, smoke: 0xcfe8ff, extra: 0xe9fbff },
  lightning: { main: 0x9fd0ff, core: 0xffffff, edge: 0x3a62ff, smoke: 0x3a4a80, extra: 0xc7a6ff },
  dark: { main: 0xa24cff, core: 0xf0d6ff, edge: 0x4b1597, smoke: 0x140a1e, extra: 0xff5a2a },
  poison: { main: 0x7fe04c, core: 0xeaffb4, edge: 0x2a8a2e, smoke: 0x2d4a24, extra: 0xb061e8 },
  holy: { main: 0xfff0a4, core: 0xffffff, edge: 0xffbf3c, smoke: 0xfff4d0, extra: 0xffe08a },
  wind: { main: 0xc9ffe9, core: 0xffffff, edge: 0x56d8c0, smoke: 0xb8d8cc, extra: 0xe8fff6 },
  // class identities (PLAN §4)
  warriorGold: { main: 0xffd25a, core: 0xfffbe8, edge: 0xe08a14, smoke: 0x8c7a50, extra: 0xffffff },
  warriorWhite: { main: 0xf4f7ff, core: 0xffffff, edge: 0xa7c4ff, smoke: 0x9aa4b4, extra: 0xffe9a8 },
  ninjaGreen: { main: 0x7ff06a, core: 0xf0ffd0, edge: 0x1f8a3a, smoke: 0x2b4a2a, extra: 0xb870f0 },
  ninjaPurple: { main: 0xb070f0, core: 0xf0e0ff, edge: 0x5a2aa8, smoke: 0x261a3a, extra: 0x7ff06a },
  yachaDark: { main: 0x9a4cf0, core: 0xf0d8ff, edge: 0x3a1088, smoke: 0x120a1c, extra: 0xff8a2a },
  yachaFlame: { main: 0xff8a2a, core: 0xfff0c0, edge: 0xc8200a, smoke: 0x2a1812, extra: 0xb060ff },
  shamanBlue: { main: 0x86c4ff, core: 0xffffff, edge: 0x2f5cff, smoke: 0x2a3a78, extra: 0xd2b4ff },
  shamanGold: { main: 0xffd66a, core: 0xfffbe0, edge: 0xd88a1a, smoke: 0xc8a860, extra: 0x6fd0ff },
  wolfmanRed: { main: 0xff4a3a, core: 0xffe0c8, edge: 0x9a0f18, smoke: 0x3a1010, extra: 0xffa050 },
  wolfmanIndigo: { main: 0x6a7cff, core: 0xe6ecff, edge: 0x2a2ea8, smoke: 0x161a40, extra: 0x9ad0ff },
  // world
  boss: { main: 0xff3a2a, core: 0xffe6c8, edge: 0x8a0a10, smoke: 0x2a0c0c, extra: 0xffb040 },
  warn: { main: 0xff5a2a, core: 0xffd0a0, edge: 0x7a0f10, smoke: 0x2a0808, extra: 0xffcf40 },
  dust: { main: 0xcdbd9a, core: 0xf0e6cc, edge: 0x8a7a58, smoke: 0x7c705a, extra: 0xe8dcb8 },
  ash: { main: 0xa89888, core: 0xe0d6c8, edge: 0x5a4c40, smoke: 0x3a322c, extra: 0xff9a40 },
  yeop: { main: 0xffd23a, core: 0xfffbe0, edge: 0xd88a10, smoke: 0xc8a040, extra: 0xffffff },
  xp: { main: 0x5ab8ff, core: 0xffffff, edge: 0x2a58e8, smoke: 0x2a4888, extra: 0xb8e4ff },
  heal: { main: 0x7ff08a, core: 0xf0ffe0, edge: 0x20a850, smoke: 0x2a6a3a, extra: 0xfff6a0 },
  metin: { main: 0x9ad0ff, core: 0xffffff, edge: 0x3a62d8, smoke: 0x1a2038, extra: 0xffffff },
} as const satisfies Record<string, Palette>;

export type PaletteId = keyof typeof PALETTES;

/** sim ElementIdx order */
export const ELEMENT_PALETTE: readonly PaletteId[] = ['physical', 'fire', 'ice', 'lightning', 'dark', 'poison', 'holy', 'wind'];

/** XP gem tier colours (render feed: blue, green, violet, gold, diamond-white; never fire-orange / red / magenta) */
export const XP_TIER_COLORS: readonly number[] = [0x5ab8ff, 0x62e07a, 0xb07bff, 0xffd84a, 0xeef2ff];

/** Writes a palette derived from one colour into `out`. */
export function derivePalette(hex: number, out: Palette): void {
  out.main = hex;
  out.core = mixHex(hex, 0xffffff, 0.72);
  out.edge = scaleHex(hex, 0.5);
  out.smoke = scaleHex(hex, 0.22);
  out.extra = mixHex(hex, 0xffffff, 0.35);
}

export function copyPalette(src: Palette, out: Palette): void {
  out.main = src.main;
  out.core = src.core;
  out.edge = src.edge;
  out.smoke = src.smoke;
  out.extra = src.extra;
}

export interface Variant {
  palette: PaletteId;
  /** sim ElementIdx that picks the flavour layers of a recipe */
  element: number;
  index: number;
}

/** id suffixes (`melee.slash.gold`) → palette + element flavour; see presets/README.md */
export const VARIANT_NAMES = [
  'physical', 'fire', 'ice', 'lightning', 'dark', 'poison', 'holy', 'wind',
  'gold', 'white', 'green', 'purple', 'yacha', 'flame', 'blue', 'dragon', 'red', 'indigo',
] as const;

const VARIANT_DEFS: ReadonlyArray<readonly [PaletteId, number]> = [
  ['physical', 0], ['fire', 1], ['ice', 2], ['lightning', 3], ['dark', 4], ['poison', 5], ['holy', 6], ['wind', 7],
  ['warriorGold', 0], ['warriorWhite', 0], ['ninjaGreen', 5], ['ninjaPurple', 4], ['yachaDark', 4], ['yachaFlame', 1],
  ['shamanBlue', 3], ['shamanGold', 6], ['wolfmanRed', 0], ['wolfmanIndigo', 0],
];

export const VARIANTS: Readonly<Record<string, Variant>> = (() => {
  const out: Record<string, Variant> = {};
  VARIANT_NAMES.forEach((name, index) => {
    const d = VARIANT_DEFS[index] as readonly [PaletteId, number];
    out[name] = { palette: d[0], element: d[1], index };
  });
  return out;
})();
