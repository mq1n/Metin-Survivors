// The element looks of the hostile projectiles, shared by the three stages of an attack: MAKING (charge at the hand while the
// enemy winds up), THROW (the flying body, drawn by render/fx/projectiles.ts with the SAME palette, see projectileLooks.ts)
// and BLOW (the impact). Colours follow our element palette: fire #ff6632/#ff4623/#fc3205, ice
// #6baaff/#5d8fff/#3a53ff, dark/chaos #ff7214 core over #200730 smoke, poison/recycle #bff0ff/#6cffed over #0a314b, wind/cult
// #8222c5 over #690548 (we keep it a cold teal, wind is not violet in our palette).
import { LOOK, LOOK_NAMES } from '../../../render/fx/projectileEvents';
import type { ArtTex } from '../../spec/types';
import {
  ART_EMBER_BURST,
  ART_FLAME,
  ART_ICE,
  ART_ICE_ORB,
  ART_INK,
  ART_POISON_GLOB,
  ART_SLASH,
  ART_SWIRL_CORE,
  ART_TOXIC,
  ART_VORTEX,
} from './art';

/** the looks that have their own effects (lightning / holy fold into physical / wind, blood into fire) */
export const EP_LOOKS = ['physical', 'fire', 'ice', 'dark', 'poison', 'wind'] as const;
export type EpLook = (typeof EP_LOOKS)[number];

export interface LookDef {
  name: EpLook;
  /** hot core / mid body / rim / smoke colours (sRGB), the shader palette of projectileLooks.ts */
  core: number;
  mid: number;
  rim: number;
  smoke: number;
  
  swirl: ArtTex;
  
  spin: number;
  /** the element burst of the blow */
  burst: ArtTex;
  burstHalf: number;
  burstLife: number;
  /** burst drawn with real alpha as well (so the hue survives on snow) */
  burstAlpha: boolean;
}

export const LOOKS: Readonly<Record<EpLook, LookDef>> = {
  physical: { name: 'physical', core: 0xffeeb8, mid: 0xe09a3c, rim: 0x9e5214, smoke: 0x1c140c, swirl: ART_SWIRL_CORE, spin: 260, burst: ART_EMBER_BURST, burstHalf: 0.85, burstLife: 0.26, burstAlpha: false },
  fire: { name: 'fire', core: 0xfff0a0, mid: 0xff8010, rim: 0xe0360c, smoke: 0x1c0802, swirl: ART_SWIRL_CORE, spin: 320, burst: ART_FLAME, burstHalf: 0.95, burstLife: 0.36, burstAlpha: true },
  ice: { name: 'ice', core: 0xe6faff, mid: 0x2a80ff, rim: 0x1a46e8, smoke: 0x061030, swirl: ART_ICE_ORB, spin: 200, burst: ART_ICE, burstHalf: 0.85, burstLife: 0.42, burstAlpha: false },
  dark: { name: 'dark', core: 0xffa050, mid: 0xcc1c34, rim: 0x80103a, smoke: 0x0c0108, swirl: ART_SWIRL_CORE, spin: -500, burst: ART_INK, burstHalf: 1.0, burstLife: 0.34, burstAlpha: true },
  poison: { name: 'poison', core: 0xe8ffa0, mid: 0x54d018, rim: 0x1c9030, smoke: 0x061408, swirl: ART_POISON_GLOB, spin: 240, burst: ART_TOXIC, burstHalf: 0.9, burstLife: 0.36, burstAlpha: true },
  wind: { name: 'wind', core: 0xf4fffa, mid: 0x46d8b4, rim: 0x1c9c88, smoke: 0x041a16, swirl: ART_VORTEX, spin: 420, burst: ART_SLASH, burstHalf: 1.0, burstLife: 0.3, burstAlpha: false },
};

/** projectile look code (render/fx/projectileEvents LOOK) -> the look that owns its effects */
export function epLookOf(code: number): EpLook {
  switch (code) {
    case LOOK.fire:
    case LOOK.blood:
      return 'fire';
    case LOOK.ice:
      return 'ice';
    case LOOK.dark:
      return 'dark';
    case LOOK.poison:
      return 'poison';
    case LOOK.wind:
      return 'wind';
    default:
      return 'physical';
  }
}

/** the look of a content projectile vfx name (`proj.hostile.fire`, `proj.arrow.poison`, `proj.blade.ice` ...): its element suffix */
export function epLookOfName(name: string): EpLook {
  const i = name.lastIndexOf('.');
  const suffix = i >= 0 ? name.slice(i + 1) : name;
  if (suffix === 'fire' || suffix === 'flame' || suffix === 'dragon') return 'fire';
  if (suffix === 'ice' || suffix === 'blue' || suffix === 'indigo') return 'ice';
  if (suffix === 'dark' || suffix === 'purple' || suffix === 'yacha') return 'dark';
  if (suffix === 'poison' || suffix === 'green') return 'poison';
  if (suffix === 'wind') return 'wind';
  return 'physical';
}

export { LOOK_NAMES };
