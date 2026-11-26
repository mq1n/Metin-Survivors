// Generated sprites the pickups target draws (owner: the pickups builder). All of them are shipped (manifest kind `vfx`, made by

// gathering ga_center / ga_piece, gathering energy swirls). `vfx_pickups_*` are this target's own (round 1: chest burst, money

// The classic presets draw them through `fx.add.at(..).art(KitArt)`: the packed sprite while the art array holds it, the
// procedural cell `fb` otherwise (missing file, tests, `fx.legacyKit`). The carrier spec (specs.ts) keeps them in every run's scope.
import type { KitArt } from '../../emit';
import { SPR } from '../../textures';

export const PK_ART = {
  
  cross: { id: 'vfx_star_cross_thin_a', fb: SPR.glint },
  /** four-point star with a soft halo: the big collect glint */
  crossHalo: { id: 'vfx_flare_star_haloed_a', fb: SPR.gemSparkle },
  /** fine radial spokes round a hot heart: the gathering `ga_center_small` burst */
  burst: { id: 'vfx_starburst_spokes_a', fb: SPR.sunburst },
  /** soft hot core */
  core: { id: 'vfx_glow_hotcore_a', fb: SPR.glowTight },
  
  monround: { id: 'vfx_ring_soft_band_a', fb: SPR.glowRing },
  /** grainy broken ring band: the absorb wave of the magnet */
  waveGrain: { id: 'vfx_ring_grain_soft_a', fb: SPR.glowRing },
  /** swirling vortex arms: the magnet pull */
  vortex: { id: 'vfx_swirl_vortex_arms_a', fb: SPR.glowRing },
  /** spray of fine streaks fanning up from a point: the chest fountain */
  spray: { id: 'vfx_spray_up_streaks_a', fb: SPR.streakSoft },
  /** rays fanning up from the ground: chest burst */
  fan: { id: 'vfx_rayfan_upspray_a', fb: SPR.sunburst },
  /** soft rainbow band (boss chest gem halo) */
  rainbow: { id: 'vfx_ring_rainbow_band_a', fb: SPR.glowRing },
  /** soft rising streak: potion / heal column */
  rise: { id: 'vfx_streak_rise_soft_a', fb: SPR.streakSoft },
  /** the chest burst: hot heart, 14-18 fine unequal spikes (a loose cross) and sparkle motes (additive; ga_center + dropitem cross look) */
  chestBurst: { id: 'vfx_pickups_chest_burst', fb: SPR.sunburst },
  
  moneyRing: { id: 'vfx_pickups_money_ring', fb: SPR.glowRing },
  /** one coin turning on a vertical axis: 2 x 2 frames (face, three-quarter, edge-on, three-quarter back), straight alpha, silver (tinted gold) */
  coin: { id: 'vfx_pickups_coin_tumble', fb: SPR.glowTight },
} as const satisfies Record<string, KitArt>;

/** sheet layout of the art that is a flipbook image (the manifest carries no grid; the carrier spec passes it as the packer hint) */
export const PK_ART_GRID: Readonly<Record<string, readonly [number, number]>> = { vfx_pickups_coin_tumble: [2, 2] };

/** every manifest id the target draws */
export const PICKUP_ART_IDS: readonly string[] = [...new Set(Object.values(PK_ART).map((a) => a.id))];
