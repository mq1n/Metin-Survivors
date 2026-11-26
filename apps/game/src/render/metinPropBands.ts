// r9 M9b (r8 M8a critic: "a prop body is one vertical cylinder of footprint radius from the ground to the PROP_DEFS height"): the stacked body

// [from, to] shares of the prop's height and the band's radius as a share of its footprint circle (the 95th percentile of the drawn vertices; a
// banner's cloth and a lamp's arm are capped at 1.4 x the base: a piece may brush a cloth, it must not slide down an invisible wall round it).
// A stone lantern is a plinth, a slender column and a roof; a well, an urn, a crate stay near one cylinder. Props with several footprint
// circles (halls, gates, houses) keep their full-height circles.
export const METIN_PROP_BANDS: Readonly<Record<string, readonly (readonly [number, number, number])[]>> = {
  banner_pole: [[0, 0.12, 1], [0.12, 1, 0.5]], // the pole: the cloth is a thin sheet a piece may pass
  barrel: [[0, 0.12, 1], [0.12, 0.55, 1.21], [0.55, 0.85, 1.2], [0.85, 1, 1.03]],
  bonfire: [[0, 0.12, 1], [0.12, 0.55, 0.93], [0.55, 0.85, 0.9], [0.85, 1, 0.34]],
  brazier: [[0, 0.12, 1], [0.12, 0.55, 0.74], [0.55, 0.85, 1.2], [0.85, 1, 1.25]],
  crate: [[0, 0.12, 1], [0.12, 0.55, 1.07], [0.55, 0.85, 1.07], [0.85, 1, 0.99]],
  fire_altar: [[0, 0.12, 1], [0.12, 0.55, 0.87], [0.55, 0.85, 0.21], [0.85, 1, 0.22]],
  fire_brazier: [[0, 0.12, 1], [0.12, 0.55, 0.9], [0.55, 0.85, 0.87], [0.85, 1, 0.75]],
  frozen_tree: [[0, 0.12, 1], [0.12, 0.55, 1.4], [0.55, 0.85, 1.4], [0.85, 1, 1.4]],
  giant_pagoda: [[0, 0.12, 1], [0.12, 0.55, 0.83], [0.55, 0.85, 0.41], [0.85, 1, 0.38]],
  haystack: [[0, 0.12, 1], [0.12, 0.55, 0.76], [0.55, 0.85, 0.34], [0.85, 1, 0.52]],
  ice_crystal: [[0, 0.12, 1], [0.12, 0.55, 0.97], [0.55, 0.85, 1.05], [0.85, 1, 0.33]],
  lamp_post: [[0, 0.12, 1], [0.12, 0.55, 0.54], [0.55, 0.85, 1.4], [0.85, 1, 1.4]],
  lava_pillar: [[0, 0.12, 1], [0.12, 0.55, 0.91], [0.55, 0.85, 0.65], [0.85, 1, 0.78]],
  lava_rock: [[0, 0.12, 1], [0.12, 0.55, 0.98], [0.55, 0.85, 0.96], [0.85, 1, 1.02]],
  obelisk: [[0, 0.12, 1], [0.12, 0.55, 0.91], [0.55, 0.85, 0.54], [0.85, 1, 0.53]],
  obsidian_spire: [[0, 0.12, 1], [0.12, 0.55, 0.77], [0.55, 0.85, 0.6], [0.85, 1, 0.75]],
  orc_tent: [[0, 0.12, 1], [0.12, 0.55, 0.95], [0.55, 0.85, 0.61], [0.85, 1, 0.24]],
  plague_brazier: [[0, 0.12, 1], [0.12, 0.55, 0.87], [0.55, 0.85, 1.12], [0.85, 1, 0.65]],
  signpost: [[0, 0.12, 1], [0.12, 0.55, 1.4], [0.55, 0.85, 1.4], [0.85, 1, 0.87]],
  snow_shrine: [[0, 0.12, 1], [0.12, 0.55, 0.79], [0.55, 0.85, 1.02], [0.85, 1, 0.61]],
  stone_lantern: [[0, 0.12, 1], [0.12, 0.55, 0.51], [0.55, 0.85, 1.14], [0.85, 1, 0.95]],
  totem: [[0, 0.12, 1], [0.12, 0.55, 0.58], [0.55, 0.85, 0.59], [0.85, 1, 0.59]],
  urn: [[0, 0.12, 1], [0.12, 0.55, 1.4], [0.55, 0.85, 1.4], [0.85, 1, 1]],
  war_banner: [[0, 0.12, 1], [0.12, 1, 0.5]], // the pole: the cloth is a thin sheet a piece may pass
  well: [[0, 0.12, 1], [0.12, 0.55, 0.93], [0.55, 0.85, 1], [0.85, 1, 0.18]],
  yurt: [[0, 0.12, 1], [0.12, 0.55, 0.97], [0.55, 0.85, 0.86], [0.85, 1, 0.25]],
};
