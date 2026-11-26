// Sprites of the enemy-projectile effects (common VFX target `enemy-projectiles`).
// Shared factory sprites + custom sprites (swirl_core, claw_slash, ember_arrow_fin, smoke_ball_dark, ice_orb, poison_glob,
// charge_sphere, fire_orb, claw_slash_b). The `fallback` roles keep every effect drawing when a sprite is missing.
import type { ArtTex } from '../../spec/types';


export const ART_SMOKE: ArtTex = { art: 'vfx_smoke_lumpball_a', fallback: 'smoke0' };


export const ART_SMOKE_DARK: ArtTex = { art: 'vfx_enemy_projectiles_smoke_ball_dark', fallback: 'smoke0' };

export const ART_ICE_ORB: ArtTex = { art: 'vfx_enemy_projectiles_ice_orb', fallback: 'swirlRing' };

export const ART_POISON_GLOB: ArtTex = { art: 'vfx_enemy_projectiles_poison_glob', fallback: 'bubbles' };


export const ART_CHARGE_SPHERE: ArtTex = { art: 'vfx_enemy_projectiles_charge_sphere', fallback: 'glow' };
/** OWN sprite (round 3): a head-on turbulent fireball with licking lobes and a swirl of dark gaps (the fire orb's spinning layer, atlas cell 20) */
export const ART_FIRE_ORB: ArtTex = { art: 'vfx_enemy_projectiles_fire_orb', fallback: 'cloud' };
/** OWN sprite (round 3): a second fibre crescent of flame-like torn fibres with flung embers (the blade bodies, atlas cell 21) */
export const ART_CLAW_B: ArtTex = { art: 'vfx_enemy_projectiles_claw_slash_b', fallback: 'crescentGlow' };
/** curly energy tangle (older swirl layer, still the fallback of the swirl core) */
export const ART_TANGLE: ArtTex = { art: 'vfx_wisp_tangle_a', fallback: 'wisp' };

export const ART_SWIRL_CORE: ArtTex = { art: 'vfx_enemy_projectiles_swirl_core', fallback: 'wisp' };
/** swirl ring ball (cold / holy swirl) */
export const ART_SWIRL_BALL: ArtTex = { art: 'vfx_wisp_swirl_ball_a', fallback: 'swirlRing' };
/** vortex arms (wind) */
export const ART_VORTEX: ArtTex = { art: 'vfx_swirl_vortex_arms_a', fallback: 'vortex' };

export const ART_FLAME: ArtTex = { art: 'vfx_hit_flame', fallback: 'cloud' };

export const ART_ICE: ArtTex = { art: 'vfx_hit_ice', fallback: 'shard0' };

export const ART_INK: ArtTex = { art: 'vfx_hit_ink', fallback: 'wisp' };
/** toxic blob with flung droplets (hits builder) */
export const ART_TOXIC: ArtTex = { art: 'vfx_hit_toxic', fallback: 'bubbles' };
/** crescent of air-slash streaks (hits builder) */
export const ART_SLASH: ArtTex = { art: 'vfx_hit_slash', fallback: 'crescentGlow' };
/** ember-speckled ray burst (physical blow) */
export const ART_EMBER_BURST: ArtTex = { art: 'vfx_burst_rays_ember_a', fallback: 'raysSoft' };

export const ART_RING_SMOKE: ArtTex = { art: 'vfx_ring_smoke_ragged_a', fallback: 'ringCloud' };
/** soft glow orb (muzzle flash core) */
export const ART_GLOW: ArtTex = { art: 'vfx_glow_orb_core_a', fallback: 'glow' };
/** comet head + tail: a spark with its streak */
export const ART_COMET: ArtTex = { art: 'vfx_comet_egg_a', fallback: 'comet' };
/** fine needle sparks */
export const ART_NEEDLE: ArtTex = { art: 'vfx_streak_needle_a', fallback: 'streakSoft' };

/** every shipped sprite id the effects of this target draw (the manifest test and the snapshot read it) */
export const ENEMY_PROJECTILE_ART_IDS: readonly string[] = [
  // own sprites of this target (vfx_enemy_projectiles_<role>); the last two live only in the projectile atlas (render/fx/projectileLooks.ts)
  'vfx_enemy_projectiles_swirl_core',
  'vfx_enemy_projectiles_claw_slash',
  'vfx_enemy_projectiles_ember_arrow_fin',
  'vfx_enemy_projectiles_smoke_ball_dark',
  'vfx_enemy_projectiles_ice_orb',
  'vfx_enemy_projectiles_poison_glob',
  'vfx_enemy_projectiles_charge_sphere',
  'vfx_enemy_projectiles_fire_orb',
  'vfx_enemy_projectiles_claw_slash_b',
  'vfx_enemy_projectiles_ember_streak',
  'vfx_smoke_lumpball_a',
  'vfx_wisp_tangle_a',
  'vfx_wisp_swirl_ball_a',
  'vfx_swirl_vortex_arms_a',
  'vfx_hit_flame',
  'vfx_hit_ice',
  'vfx_hit_ink',
  'vfx_hit_toxic',
  'vfx_hit_slash',
  'vfx_burst_rays_ember_a',
  'vfx_ring_smoke_ragged_a',
  'vfx_glow_orb_core_a',
  'vfx_comet_egg_a',
  'vfx_streak_needle_a',
];
