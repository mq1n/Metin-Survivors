// Zone palettes for the architecture props (setA). Colours stay mid-value and slightly desaturated: scenery must never
// out-shout the heroes, so lacquer red and ember orange are the only strong notes.
import { createArchMaterial, type ArchMaterialOptions } from './materials';
import type { MeshStandardMaterial } from 'three';
import type { StructureBuildContext } from './types';

export interface ArchPalette {
  roof: string;
  roofDark: string;
  ridge: string;
  lacquer: string;
  lacquerDark: string;
  gold: string;
  /** painted bracket / frieze colour (muted jade) */
  accent: string;
  timber: string;
  timberDark: string;
  plaster: string;
  plasterDark: string;
  stone: string;
  stoneDark: string;
  stoneLight: string;
  /** lantern paper / lit windows */
  paper: string;
  /** emissive seams (daeryeol embers, plague glow in seori ruins) */
  ember: string;
  snow: number;
  moss: number;
  mossColor: string;
  /** triplanar detail texture for stone */
  stoneTex: string;
}

const PALETTES: Record<string, ArchPalette> = {
  yeonmu: {
    roof: '#8c4b3c',
    roofDark: '#5d3a32',
    ridge: '#6c4338',
    lacquer: '#9c2b23',
    lacquerDark: '#6b1d19',
    gold: '#c99c3f',
    accent: '#2f6c66',
    timber: '#5b4130',
    timberDark: '#3b2a20',
    plaster: '#efe8d6',
    plasterDark: '#c2b8a1',
    stone: '#9b998d',
    stoneDark: '#706e65',
    stoneLight: '#b9b6a7',
    paper: '#f4d98c',
    ember: '#ff8a3a',
    snow: 0,
    moss: 0.12,
    mossColor: '#586a30',
    stoneTex: 'tex_rock_mossy',
  },
  suryeon: {
    roof: '#686c5b',
    roofDark: '#454639',
    ridge: '#4d5144',
    lacquer: '#8b2d23',
    lacquerDark: '#5c1e18',
    gold: '#b9923b',
    accent: '#36695d',
    timber: '#59412f',
    timberDark: '#3a2b20',
    plaster: '#d8ccaf',
    plasterDark: '#a99c80',
    stone: '#a39580',
    stoneDark: '#76695a',
    stoneLight: '#c1b498',
    paper: '#f0cf84',
    ember: '#ff8a3a',
    snow: 0,
    moss: 0.07,
    mossColor: '#6a7133',
    stoneTex: 'tex_rock_canyon',
  },
  seori: {
    roof: '#6e7b85',
    roofDark: '#4b5761',
    ridge: '#56626d',
    lacquer: '#7c3b37',
    lacquerDark: '#522724',
    gold: '#9d8751',
    accent: '#4b7876',
    timber: '#4b4139',
    timberDark: '#322b26',
    plaster: '#cdd2d6',
    plasterDark: '#9aa2a9',
    stone: '#9ba4ac',
    stoneDark: '#69727b',
    stoneLight: '#c2cad1',
    paper: '#e8e0b8',
    ember: '#6dff9a',
    snow: 0.62,
    moss: 0.08,
    mossColor: '#5b7260',
    stoneTex: 'tex_rock_frozen',
  },
  daeryeol: {
    roof: '#4b312a',
    roofDark: '#2b1b17',
    ridge: '#3c2923',
    lacquer: '#6b2b1d',
    lacquerDark: '#3b1911',
    gold: '#b87b2d',
    accent: '#6b4a38',
    timber: '#402b23',
    timberDark: '#2a1b16',
    plaster: '#b89b80',
    plasterDark: '#7e664f',
    stone: '#3d3737',
    stoneDark: '#262122',
    stoneLight: '#5b514e',
    paper: '#ffb25a',
    ember: '#ff6a1f',
    snow: 0,
    moss: 0,
    mossColor: '#55662f',
    stoneTex: 'tex_basalt',
  },
};

export function paletteFor(zone: string): ArchPalette {
  return PALETTES[zone] ?? (PALETTES.yeonmu as ArchPalette);
}

/** stone detail textures a palette may use (declared up front so the system preloads them) */
export function stoneTextures(zone: string): string[] {
  return [paletteFor(zone).stoneTex];
}

/** self-illumination that keeps props readable where the zone's own ambient is weak; daeryeol adds lava bounce light */
const ZONE_LIGHT: Record<string, Pick<ArchMaterialOptions, 'lift' | 'uplight'>> = {
  yeonmu: { lift: 0.03 },
  suryeon: { lift: 0.09 },
  seori: { lift: 0.08 },
  daeryeol: { lift: 0.4, uplight: '#8a3208' },
};

/** the architecture material with this palette's snow / moss / stone detail and the zone's light lift applied */
export function archMaterial(ctx: StructureBuildContext, pal: ArchPalette, o: ArchMaterialOptions = {}): MeshStandardMaterial {
  return createArchMaterial({
    detail: ctx.texture(pal.stoneTex),
    detailMix: 0.55,
    detailScale: 3.8,
    snow: pal.snow,
    moss: pal.moss,
    mossColor: pal.mossColor,
    ...ZONE_LIGHT[ctx.zone],
    ...o,
  });
}
