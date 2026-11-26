// Generated hit sprites (common VFX target `hits`; owner: the hits builder). Produced by tools/imagegen (`cli.ts gen

// (additive on black, neutral grey: the spec colour curves tint them). Jobs: tools/imagegen/jobs/gen/vfx_hit_*.json.
// A missing sprite draws the `fallback` role (spec/README.md "Art roles").
import type { ArtTex } from '../../spec/types';



export const ART_SPARK: ArtTex = { art: 'vfx_hit_spark', fallback: 'raysSoft' };

export const ART_TWIRL: ArtTex = { art: 'vfx_hit_twirl', fallback: 'swirlRing' };

export const ART_BOLT: ArtTex = { art: 'vfx_hit_bolt', fallback: 'boltH', grid: [2, 2], frames: 4 };

export const ART_ICE: ArtTex = { art: 'vfx_hit_ice', fallback: 'shard0' };

export const ART_FLAME: ArtTex = { art: 'vfx_hit_flame', fallback: 'cloud' };

export const ART_INK: ArtTex = { art: 'vfx_hit_ink', fallback: 'wisp' };

export const ART_TOXIC: ArtTex = { art: 'vfx_hit_toxic', fallback: 'bubbles' };

export const ART_SLASH: ArtTex = { art: 'vfx_hit_slash', fallback: 'crescentGlow' };


export const ART_PUFF: ArtTex = { art: 'vfx_hit_puff', fallback: 'cloud' };

export const ART_HOLY: ArtTex = { art: 'vfx_hit_holy', fallback: 'flare4' };

/** every generated sprite id this target ships (snapshot / audit list) */
export const HIT_ART_IDS = ['vfx_hit_spark', 'vfx_hit_twirl', 'vfx_hit_bolt', 'vfx_hit_ice', 'vfx_hit_flame', 'vfx_hit_ink', 'vfx_hit_toxic', 'vfx_hit_slash', 'vfx_hit_puff', 'vfx_hit_holy'] as const;
