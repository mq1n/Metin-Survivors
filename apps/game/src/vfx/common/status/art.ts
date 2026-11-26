// Status sprites (common VFX target `status`; owner: the status builder). Round 1 draws ONLY sprites that already ship (the


// (ids vfx_status_<role>). Every ArtTex has a procedural `fallback` role, so a missing / out-of-scope sprite degrades, never breaks.
// Neutral grey sprites on black (manifest alpha false) are additive and tinted by the colour curves; `A` sprites are straight alpha.
import type { ArtTex } from '../../spec/types';

/** stum_inter_pasthit: thin GRAINY ring band, crisp edge (not a perfect vector circle) -> the stun ring */
export const ART_RING_THIN: ArtTex = { art: 'vfx_ring_grainy_band_a', fallback: 'ring' };
/** crisp four-point star, thin long arms, small tight glow (additive) */
export const ART_STAR_THIN: ArtTex = { art: 'vfx_star_cross_thin_a', fallback: 'flare4' };
/** 2-starsmall: small crisp four-point star with a hot spiked core (additive) */
export const ART_STAR_SPIKE: ArtTex = { art: 'vfx_flare4_spiked_core_a', fallback: 'flare4' };

/** poison: marbled gas, fibrous filaments (additive) */
export const ART_MARBLE: ArtTex = { art: 'vfx_marble_smoke_a', fallback: 'cloud' };
/** ls1_1 copy: crackling tendrils (additive) -> the lime crackle core */
export const ART_CRACKLE: ArtTex = { art: 'vfx_wisp_tangle_a', fallback: 'wisp' };
/** bubble with a hazy rim (additive) */
export const ART_BUBBLE: ArtTex = { art: 'vfx_ring_bubble_haze_a', fallback: 'bubbles' };


export const ART_TONGUES: ArtTex = { art: 'vfx_hit_flame', fallback: 'flameFB' };
/** slim wavy flame fingers (coloured, additive) */
export const ART_TONGUES_SLIM: ArtTex = { art: 'vfx_flame_wisps_slim_a', fallback: 'flameFB' };
/** hot yellow-white core blob (additive) */
export const ART_HOTCORE: ArtTex = { art: 'vfx_glow_hotcore_a', fallback: 'glowCore' };
/** grainy billowing fire puff (additive) -> heat plume */
export const ART_FIRE_PUFF: ArtTex = { art: 'vfx_puff_fire_billow_a', fallback: 'cloud' };
/** soft round dot (additive): embers, droplets */
export const ART_PIP: ArtTex = { art: 'vfx_glow_pip_core_a', fallback: 'dot' };

/** dark soft smoke puff (STRAIGHT ALPHA): soot / dark gas body, keeps its hue on snow */
export const ART_SMOKE_DARK: ArtTex = { art: 'vfx_puff_energy_dark_a', fallback: 'smoke1' };
/** lumpy billowing cloud ball (STRAIGHT ALPHA): the slow pool, noisy edge */
export const ART_SMOKE_LUMPY: ArtTex = { art: 'vfx_smoke_lumpball_a', fallback: 'smoke2' };
/** mottled cloud puff (additive): violet glow under the slow smoke */
export const ART_CLOUD_MOTTLED: ArtTex = { art: 'vfx_cloud_puff_mottled_a', fallback: 'cloud' };
/** thin smoke threads (additive) -> rising wisps */
export const ART_WISP_THREADS: ArtTex = { art: 'vfx_wisp_smoke_threads_a', fallback: 'wisp' };

export const ART_VORTEX_RING: ArtTex = { art: 'vfx_vortex_smoke_ring_a', fallback: 'ringCloud' };

/** hits pilot sludge splash with flung droplets (additive): the poison / bleed tick splash */
export const ART_SPLASH: ArtTex = { art: 'vfx_hit_toxic', fallback: 'splat' };
/** upward spray of fine streaks and specks (additive): the bleed tick spray */
export const ART_SPRAY: ArtTex = { art: 'vfx_spray_up_streaks_a', fallback: 'streakSoft' };

// ---- r2 (2026-10-19): sprites for the rebuilt poison shell, the stun outline, the slow vortex and the tick pips (all already shipped)
/** a hollow ball of marbled filaments with a rounded, feathered outline (additive): the poison SHELL (used as an alpha twin it is the dark vein web) */
export const ART_VEIN_BALL: ArtTex = { art: 'vfx_wisp_swirl_ball_a', fallback: 'wisp' };
/** a dense web of thin crackling veins on black (additive): the lime crackle that carries the poison on stone */
export const ART_VEIN_WEB: ArtTex = { art: 'vfx_ambush_wisp', fallback: 'wisp' };
/** thin bright ring line with a small glow (additive; as an alpha twin it is a deep-violet outline round the pale stun ring) */
export const ART_RING_HAIR: ArtTex = { art: 'vfx_ring_hairline_glow_a', fallback: 'ring' };
/** crisp four-point twinkle with a small glow (additive): the third, tiny star layer */
export const ART_STAR_TWINKLE: ArtTex = { art: 'vfx_flare4_twinkle_small_a', fallback: 'flare4' };

export const ART_VORTEX_DISC: ArtTex = { art: 'vfx_death_spawn_vortex_disc', fallback: 'twistDisc' };
/** a tall ragged smoke column (additive sprite): the rising slow wisps */
export const ART_SMOKE_COLUMN: ArtTex = { art: 'vfx_boss_smokecolumn', fallback: 'wisp' };
/** soft glowing orb with a hot centre (additive): poison motes, tick pips */
export const ART_ORB: ArtTex = { art: 'vfx_glow_orb_core_a', fallback: 'dot' };


// dark rim and hue and keeps its read on snow / pale stone: the critic found the additive-only stun ring and stars vanish into white)
/** a crisp four-point sparkle star: violet-blue body, white-lavender hot centre, thin indigo rim (STRAIGHT ALPHA, own colours: tint it white) */
export const ART_STAR_ALPHA: ArtTex = { art: 'vfx_status_star', fallback: 'flare4' };
/** a thin crisp ring: pale lavender core line with a deep-indigo edge on both sides, slightly uneven (STRAIGHT ALPHA, own colours) */
export const ART_RING_ALPHA: ArtTex = { art: 'vfx_status_stun_ring', fallback: 'ring' };
/** three or four torn curls of dark violet smoke rising off a darker smoky base, violet rim light (STRAIGHT ALPHA, own colours); base sits at 78-92 % of the height */
export const ART_SLOW_WISPS: ArtTex = { art: 'vfx_status_slow_wisps', fallback: 'wisp' };

// ---- r3 (2026-10-20): sprites for the continuous stun ring + luminous stars, the fibrous poison gas, the flame variety and the slow smoke columns (all already shipped;
// codex image generation was paused for the whole round, the sprites a better look still needs are in DEFERRED_GEN.txt)
/** bold four-point star with a soft glow (additive): the luminous white-core twinkle of the stun stars */
export const ART_STAR_GLOW: ArtTex = { art: 'vfx_flare_star4_glow_a', fallback: 'flare4' };
/** ragged fibrous marbled cloud with an irregular outline (additive sprite, drawn ALPHA for the dark green body): the poison gas puff and its DoT tick */
export const ART_WISP_CURL: ArtTex = { art: 'vfx_metin_wisp_curl', fallback: 'cloud' };
/** three coloured flame tongues rising from a hot base (additive, keeps its own red-orange-yellow): the second tongue family of the burning loop */
export const ART_FLAME_CURTAIN: ArtTex = { art: 'vfx_flame_curtain_a', fallback: 'flameFB' };


/** a dense marbled gas billow: fibrous filaments + curls with dark gaps and bright veins, round irregular outline (ADDITIVE on black, neutral grey: tint green / lime) */
export const ART_POISON_GAS: ArtTex = { art: 'vfx_status_poison_gas', fallback: 'cloud' };
/** one fast flame burst: hot core, several ragged tongues of different lengths, flying sparks (ADDITIVE on black, neutral grey: tint yellow-white -> orange -> red) */
export const ART_FIRE_BURST: ArtTex = { art: 'vfx_status_fire_burst', fallback: 'flameFB' };
/** a dark drained smoke bank with torn edges and tall curling wisps (STRAIGHT ALPHA, neutral grey: tint dark grey-violet) */
export const ART_SLOW_SMOKE: ArtTex = { art: 'vfx_status_slow_smoke', fallback: 'wisp' };

/** every manifest sprite this target draws (snapshot / audit / test list; vfx_status_star and vfx_status_slow_wisps stay shipped but are no longer drawn) */
export const STATUS_ART_IDS: readonly string[] = [
  ART_RING_THIN, ART_STAR_THIN, ART_STAR_SPIKE, ART_STAR_GLOW, ART_MARBLE, ART_CRACKLE, ART_TONGUES, ART_TONGUES_SLIM, ART_FLAME_CURTAIN, ART_HOTCORE,
  ART_FIRE_PUFF, ART_PIP, ART_SMOKE_LUMPY, ART_CLOUD_MOTTLED, ART_WISP_THREADS, ART_WISP_CURL, ART_VORTEX_RING, ART_SPLASH,
  ART_VEIN_WEB, ART_VORTEX_DISC, ART_SMOKE_COLUMN, ART_ORB, ART_RING_ALPHA, ART_POISON_GAS, ART_FIRE_BURST, ART_SLOW_SMOKE,
].map((a) => a.art as string);
