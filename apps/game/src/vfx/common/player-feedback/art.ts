// Sprites the player-feedback specs draw (manifest kind `vfx`, additive on black unless `alpha: true`; spec/README.md "Art roles").
// r1 reuses what the shipped set already has (hit sprites of the hits target, the kit's click-select arcs, soft glow / ring /
// flare sprites of the shared families) and, once the codex pause ended, six own sprites (vfx_player_feedback_*, generated from the

// `fallback`.
import type { ArtTex } from '../../spec/types';


export const ART_SPARK: ArtTex = { art: 'vfx_hit_spark', fallback: 'raysSoft' };

export const ART_PUFF: ArtTex = { art: 'vfx_hit_puff', fallback: 'cloud' };

export const ART_SLASH: ArtTex = { art: 'vfx_hit_slash', fallback: 'crescentGlow' };

export const ART_WIND: ArtTex = { art: 'vfx_streak_wind_soft_a', fallback: 'windStrip' };
/** sparse soft dust puff, straight alpha */
export const ART_DUST: ArtTex = { art: 'vfx_smoke_dustpuff_a', fallback: 'dust' };

export const ART_GLINT: ArtTex = { art: 'vfx_glint_halo_pin_a', fallback: 'flare4' };

export const ART_ORB: ArtTex = { art: 'vfx_disc_glow_even_a', fallback: 'glow' };

export const ART_HALO: ArtTex = { art: 'vfx_ring_halo_twin_a', fallback: 'ringInner' };
/** bright four-point star with a halo (neutral white): the shield impact point */
export const ART_FLAREORB: ArtTex = { art: 'vfx_flare_star_haloed_a', fallback: 'flare4' };


export const ART_SHELL: ArtTex = { art: 'vfx_player_feedback_shield_shell', fallback: 'ringInner' };

export const ART_VEIL: ArtTex = { art: 'vfx_player_feedback_ghost_veil', fallback: 'glow' };
/** three tapered streaks fanning from a point with flying sparks: the blow that struck the hero (click yy / up family) */
export const ART_HITSLASH: ArtTex = { art: 'vfx_player_feedback_hit_flash_slash', fallback: 'streakSoft' };


export const ART_WISP: ArtTex = { art: 'vfx_player_feedback_haste_wisp', fallback: 'wisp' };

/** every shipped sprite id the target references (audit list) */
/** lumpy smoke ball with a real alpha channel (alpha sprite): the saturated body of an event that must hold its hue on snow */
export const ART_SMOKEBALL: ArtTex = { art: 'vfx_smoke_lumpball_a', fallback: 'smoke0' };
/** r2 generated: a hero-silhouette afterimage (fine lines + speed streaks), a ring of three bold comet-tapered arcs (click_select), a spirit wolf in a smoke column */
export const ART_AFTERIMAGE: ArtTex = { art: 'vfx_player_feedback_afterimage', fallback: 'glow' };
export const ART_COMET_ARCS: ArtTex = { art: 'vfx_player_feedback_comet_arcs', fallback: 'arcThin' };
export const ART_WOLF_SPIRIT: ArtTex = { art: 'vfx_player_feedback_wolf_spirit', fallback: 'cloud' };
/** r2 generated (light017 / light010 family): a slender straight column of light with a glowing pool at its base and a long fade at the top (the summon.circle pillar; the shared ambush shaft is a wedge) */
export const ART_COLUMN: ArtTex = { art: 'vfx_player_feedback_light_column', fallback: 'streakSoft' };



export const ART_RAYSTAR: ArtTex = { art: 'vfx_player_feedback_ray_star', fallback: 'raysSoft' };

export const ART_SPIKEEGG: ArtTex = { art: 'vfx_player_feedback_spike_egg', fallback: 'ringInner' };
/** a crouched, sidestepping fighter smeared by speed streaks, facing right (the dodge afterimage; replaces the standing mannequin) */
export const ART_CROUCH: ArtTex = { art: 'vfx_player_feedback_crouch_ghost', fallback: 'glow' };
/** side profile of a howling wolf head and chest in luminous mist (summon.wolf) */
export const ART_WOLFHEAD: ArtTex = { art: 'vfx_player_feedback_wolf_head', fallback: 'cloud' };
/** hooded flame wraith with a skull face and long flame arms (summon.ghost) */
export const ART_WRAITH: ArtTex = { art: 'vfx_player_feedback_fire_wraith', fallback: 'cloud' };

export const PF_ART_IDS = [
  'vfx_player_feedback_ray_star',
  'vfx_player_feedback_spike_egg',
  'vfx_player_feedback_crouch_ghost',
  'vfx_player_feedback_wolf_head',
  'vfx_player_feedback_fire_wraith',
  'vfx_smoke_lumpball_a',
  'vfx_player_feedback_afterimage',
  'vfx_player_feedback_comet_arcs',
  'vfx_player_feedback_wolf_spirit',
  'vfx_player_feedback_light_column',
  'vfx_hit_spark',
  'vfx_hit_puff',
  'vfx_hit_slash',
  'vfx_streak_wind_soft_a',
  'vfx_smoke_dustpuff_a',
  'vfx_glint_halo_pin_a',
  'vfx_disc_glow_even_a',
  'vfx_ring_halo_twin_a',
  'vfx_flare_star_haloed_a',
  'vfx_player_feedback_shield_shell',
  'vfx_player_feedback_ghost_veil',
  'vfx_player_feedback_hit_flash_slash',
  'vfx_player_feedback_haste_wisp',
  'vfx_hit_flame',
  'vfx_hit_ice',
  'vfx_hit_bolt',
  'vfx_hit_ink',
  'vfx_hit_toxic',
  'vfx_hit_holy',
  'vfx_hit_twirl',
  'vfx_ring_rimlit_disc_a',
  'vfx_glow_ball_smooth_a',
  'vfx_glow_pip_core_a',
  'vfx_ring_soft_band_b',
  'vfx_rayring_ground_burst_a',
] as const;

// ---- r2 (2026-10-20): element families of hit.player + the saturated-body sprites -------------------------------------------------
/** the hits-target element sprites (shared set, additive on black): one family per element so the player's hit differs by element */
export const ART_HIT_FLAME: ArtTex = { art: 'vfx_hit_flame', fallback: 'cloud' };
export const ART_HIT_ICE: ArtTex = { art: 'vfx_hit_ice', fallback: 'raysSoft' };
export const ART_HIT_BOLT: ArtTex = { art: 'vfx_hit_bolt', fallback: 'streakSoft' };
export const ART_HIT_INK: ArtTex = { art: 'vfx_hit_ink', fallback: 'cloud' };
export const ART_HIT_TOXIC: ArtTex = { art: 'vfx_hit_toxic', fallback: 'cloud' };
export const ART_HIT_HOLY: ArtTex = { art: 'vfx_hit_holy', fallback: 'ringInner' };
export const ART_HIT_TWIRL: ArtTex = { art: 'vfx_hit_twirl', fallback: 'ringInner' };
/** translucent bubble disc with a bright lit rim (alpha twin = the saturated body of the shield) */
export const ART_RIMDISC: ArtTex = { art: 'vfx_ring_rimlit_disc_a', fallback: 'glow' };
/** smooth round glow ball */
export const ART_BALL: ArtTex = { art: 'vfx_glow_ball_smooth_a', fallback: 'glow' };
/** small round mote with a hot core (replaces the milky disc as "bokeh") */
export const ART_PIP: ArtTex = { art: 'vfx_glow_pip_core_a', fallback: 'glow' };
/** soft thick ring band */
export const ART_BAND: ArtTex = { art: 'vfx_ring_soft_band_b', fallback: 'ringThick' };
