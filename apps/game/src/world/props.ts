// Catalogue of structures/props the zone recipes can place. The renderer resolves each id to a Forge GLB
// (`prop_<id>` in the model manifest) when present, else to its procedural builder (render/terrain/structures).
// Footprints are the static collision shapes the sim sees (TerrainField.blockers).
import type { Blocker, PropPlacement } from './layoutTypes';

/** footprint part in prop-local metres: axis-aligned rectangle centred at (cx,cz) or a circle */
export type FootprintPart =
  | { rect: [cx: number, cz: number, w: number, d: number] }
  | { circle: [cx: number, cz: number, r: number] };

export interface PropDef {
  id: string;
  /** nominal height at scale 1 (m) */
  height: number;
  /** nominal half extent for culling / placement clearance (m) */
  radius: number;
  footprint: FootprintPart[];
  /** zones the prop belongs to (informational; recipes may use any) */
  zones: Array<'yeonmu' | 'suryeon' | 'seori' | 'daeryeol'>;
  note: string;
  /** false = the camera-to-hero occlusion cut-out (render/terrain/occlusion.ts) never cuts this prop. For thin camera-facing props
   *  (banners): the cut removed the middle of the cloth and left the arm and the hem floating beside the hero (r5 ship 10-29). */
  occlude?: boolean;
  /** Tall landmarks that hide play space from the z22 game camera: the prop may only stand at or beyond this fraction of the zone's
   *  arenaRadius from the arena centre (rims / arena edges). Enforced over every zone layout by world/propDefs.test.ts (r5 ship 10-29). */
  rimOnly?: number;
  /** The DRAWN half extent (m) when the model reaches beyond `radius` (eave / roof corners, banner arms, gate wings): the static-item
   *  extents of the metin fall-site check (world/terrainField.ts staticExtents / viewExtents) use max(radius, reach), so a roof corner
   *  can no longer hang over a fresh stone (r6 U6 critic: house_small drew 5.74 m against radius 4.5). Placement and collision ignore it,
   *  so no layout moves (r6 ship 10-29). */
  reach?: number;
}

const Y = 'yeonmu' as const;
const S = 'suryeon' as const;
const H = 'seori' as const;
const D = 'daeryeol' as const;

export const PROP_DEFS: Record<string, PropDef> = {
  // --- East-Asian village / temple architecture -------------------------------------------------------------
  pagoda_gate: {
    id: 'pagoda_gate',
    height: 11,
    radius: 7.5,
    footprint: [{ circle: [-3.4, 0, 0.95] }, { circle: [3.4, 0, 0.95] }],
    zones: [Y, S, H],
    note: 'Gate: two lacquered-red pillars on stone plinths, curved tiled double roof with upturned eaves, 7 m clear passage; faces +Z.',
  },
  hall_tiled: {
    id: 'hall_tiled',
    height: 10.3,
    radius: 9,
    reach: 9.5, // r6 ship 10-29: drawn half extent (the r6 hall eave corners (15.2 x 11.2 m)) for the metin fall-site check only
    // r6 ship 10-29: the r6 hall plinth is 13 x 9 m (+ stairs to z +-5.3): a ring of 20 circles r 1.3 (1.0 m inside the edge: 0.3 m bulge, 0.08 m dips, corner overhang 0.11 m) + 3 core circles r 2.8 (no pocket); one 13 x 9 rect was ONE circle r 7.67 (an invisible wall 3.7 m in front of the facades); radius (placement clearance) unchanged, so no layout moves
    footprint: [{ circle: [-5.5, -3.5, 1.3] }, { circle: [-5.5, 3.5, 1.3] }, { circle: [-3.667, -3.5, 1.3] }, { circle: [-3.667, 3.5, 1.3] }, { circle: [-1.833, -3.5, 1.3] }, { circle: [-1.833, 3.5, 1.3] }, { circle: [0, -3.5, 1.3] }, { circle: [0, 3.5, 1.3] }, { circle: [1.833, -3.5, 1.3] }, { circle: [1.833, 3.5, 1.3] }, { circle: [3.667, -3.5, 1.3] }, { circle: [3.667, 3.5, 1.3] }, { circle: [5.5, -3.5, 1.3] }, { circle: [5.5, 3.5, 1.3] }, { circle: [-5.5, -1.75, 1.3] }, { circle: [-5.5, 0, 1.3] }, { circle: [-5.5, 1.75, 1.3] }, { circle: [5.5, -1.75, 1.3] }, { circle: [5.5, 0, 1.3] }, { circle: [5.5, 1.75, 1.3] }, { circle: [-3, 0, 2.8] }, { circle: [0, 0, 2.8] }, { circle: [3, 0, 2.8] }],
    zones: [Y, S],
    note: 'Two-storey guesthouse hall on a granite plinth: double hip-and-gable tiled roof, lattice galleries, plank decks, lanterns and a signboard.',
  },
  house_small: {
    id: 'house_small',
    height: 6.4,
    radius: 5.0, // r7 ship 10-30: placement clearance 4.5 -> 5.0 (plinth corners 4.76 m, eave corners 5.67 m: the scatter no longer grows into the house; r7 H7 scatter proof: every hall / house placement survives in 12 seeds per zone)
    reach: 5.75, // r6 ship 10-29: drawn half extent (the r5/r6 house GLB corners (8.75 x 7.44 m, eave corners)) for the metin fall-site check only
    // r5 ship 10-29: the r5 house plinth is 7.4 x 6.0 m + a side stair (x 3.70-4.34): two rects (4 circles r 2.18) = corner overhang 0.20 m (one 6.5 x 5 circle: 0.95); radius (placement clearance) unchanged, so no layout moves
    footprint: [{ rect: [-1.85, 0, 3.7, 6.0] }, { rect: [1.85, 0, 3.7, 6.0] }],
    zones: [Y, S, H],
    note: 'Hip-and-gable tiled house on a stone plinth: railed plank veranda, octagonal lattice windows, studded double door, lantern, clay jars, firewood.',
  },
  stone_lantern: {
    id: 'stone_lantern',
    height: 4.8,
    radius: 0.9,
    reach: 1.3, // r6 ship 10-29: drawn half extent (the cap corners) for the metin fall-site check only
    footprint: [{ circle: [0, 0, 0.45] }],
    zones: [Y, S, H, D],
    note: 'Tall carved stone lantern (base, shaft, fire box with openings, tiled cap).',
  },
  lamp_post: {
    id: 'lamp_post',
    height: 4.8,
    radius: 0.5,
    reach: 1.4, // r6 ship 10-29: drawn half extent (the lamp bracket) for the metin fall-site check only
    footprint: [{ circle: [0, 0, 0.22] }],
    zones: [Y, S],
    note: 'Wooden post with a hanging yellow paper lantern and iron bracket.',
  },
  urn: {
    id: 'urn',
    height: 1.2,
    radius: 0.6,
    footprint: [{ circle: [0, 0, 0.5] }],
    zones: [Y, S, H],
    note: 'Large clay storage urn / bronze incense cauldron.',
  },
  well: {
    id: 'well',
    height: 2.7,
    radius: 1.4,
    footprint: [{ circle: [0, 0, 1.25] }],
    zones: [Y, S],
    note: 'Round stone village well with wooden roof frame.',
  },
  barrel: { id: 'barrel', height: 1, radius: 0.5, footprint: [{ circle: [0, 0, 0.42] }], zones: [Y, S, H], note: 'Wooden barrel with iron hoops.' },
  crate: { id: 'crate', height: 0.9, radius: 0.6, footprint: [{ circle: [0, 0, 0.55] }], zones: [Y, S, H], note: 'Wooden crate, rope-bound.' },
  haystack: {
    id: 'haystack',
    height: 2.2,
    radius: 1.5,
    // fitted 10-27 (r3b ship) to the Tripo tied stook (hem x -0.84..0.94, z -0.89..0.85; 95 % of the vertices below 1.2 m inside): the forge dome's
    // r 1.25 circle was an invisible wall ~0.35 m outside the hem. radius (placement clearance) stays 1.5, so no zone layout moves.
    footprint: [{ circle: [0.05, -0.02, 0.87] }],
    zones: [Y, S],
    note: 'Conical haystack.',
  },
  signpost: { id: 'signpost', height: 2.4, radius: 0.6, footprint: [{ circle: [0, 0, 0.2] }], zones: [Y, S, H], note: 'Wooden direction sign.' },
  banner_pole: {
    id: 'banner_pole',
    
    height: 4.76,
    radius: 0.8,
    reach: 1.85, // r6 ship 10-29: drawn half extent (the arm and the cloth) for the metin fall-site check only
    // r4 ship 10-28: the Tripo banner stands on a 1.2 m stone foot: footprint r 0.25 -> 0.6 (r8: x0.68 -> 0.41); radius (placement clearance) unchanged, so no layout moves
    footprint: [{ circle: [0, 0, 0.41] }],
    zones: [Y, S, H, D],
    note: 'Dark-wood pole on a stone foot with a side spear arm and a dark-crimson brush-glyph banner (4.76 m).',
    // r5 ship 10-29: the banners face the fixed camera (yaw 0 / PI), so the hero cut-out would float the arm and the hem; a 1.2 m cloth hides the hero only briefly
    occlude: false,
  },
  stele: {
    id: 'stele',
    height: 4,
    radius: 1.8,
    // fitted 10-27 (r3 ship) to the Tripo bixi base (x +-1.15, z -1.78..1.67 below 1 m): two circles along the turtle; the forge r 0.9 circle let heroes walk into its head and tail
    footprint: [{ circle: [0, -0.75, 1.0] }, { circle: [0, 0.7, 1.0] }],
    zones: [Y, S, H, D],
    note: 'Carved stone stele on a tortoise-shaped base.',
  },
  // --- orc territory -----------------------------------------------------------------------------------------
  orc_tent: {
    id: 'orc_tent',
    height: 4.5,
    radius: 3.6,
    footprint: [{ circle: [0, 0, 2.6] }],
    zones: [S],
    note: 'Hide-and-timber tent with bone trim, crude paint, entrance flap (+Z).',
  },
  watchtower: {
    id: 'watchtower',
    height: 9.5,
    radius: 3.2,
    reach: 3.9, // r6 ship 10-29: drawn half extent (the platform corners) for the metin fall-site check only
    // fitted 10-27 to the Tripo GLB's legs, stakes and ladder foot (98 % of the vertices below 1.2 m inside); the old single r 1.9 circle let heroes walk through the back legs
    footprint: [
      { circle: [-2.06, -2.13, 0.69] },
      { circle: [-1.28, -2.44, 0.68] },
      { circle: [1.47, -2.34, 0.78] },
      { circle: [-0.87, -0.78, 1.06] },
      { circle: [-1.55, 1.35, 0.84] },
      { circle: [1.73, 1.05, 0.88] },
      { circle: [1.9, 2.62, 0.62] },
    ],
    zones: [S],
    note: 'Lashed-timber watchtower with a platform and banners.',
  },
  bonfire: {
    id: 'bonfire',
    height: 0.6,
    radius: 1,
    footprint: [{ circle: [0, 0, 0.9] }],
    zones: [S, H],
    note: 'Ring of stones with log pile (flame is a VFX/emissive quad).',
  },
  totem: {
    id: 'totem',
    height: 6.35, // r9 ship: the P9 totem's feather crest tips reach 6.345 m (the renderer scales the GLB to this height)
    radius: 1.4,
    // fitted 10-27 (r3 ship) to the Tripo totem base (x +-1.0, z +-0.98 below 1.5 m); the forge pole was r 0.55
    // r4 ship 10-28: the r4 totem is x/z 0.8 (girth fix, base +-0.8 m): footprint r 0.95 -> 0.82
    footprint: [{ circle: [0, 0, 0.82] }],
    zones: [S],
    note: 'Carved orc totem pole with skulls and horns.',
  },
  weapon_rack: {
    id: 'weapon_rack',
    height: 2.9,
    radius: 1.4,
    footprint: [{ rect: [0, 0, 2.4, 0.8] }],
    zones: [S],
    note: 'Wood rack with crude axes and spears.',
  },
  giant_pagoda: {
    id: 'giant_pagoda',
    height: 55,
    radius: 16,
    footprint: [{ circle: [0, 0, 13.5] }],
    zones: [S],
    note: 'Landmark: multi-tier (7) tiled pagoda tower on a tiered stone platform. Seen from afar; dominates the skyline.',
  },
  // --- seori --------------------------------------------------------------------------------------------------
  ruined_shrine: {
    id: 'ruined_shrine',
    height: 8,
    radius: 9,
    footprint: [{ rect: [0, 0, 11, 8] }],
    zones: [H],
    note: 'Plague-ruined shrine: collapsed roof half, broken pillars, torn banners, snow drifts, sickly green glow.',
  },
  ruin_pillar: {
    id: 'ruin_pillar',
    height: 5,
    radius: 1.85, // r5 P5 10-29: 1.3 -> 1.85 = the footprint's reach (|(0.29, -0.85)| + 0.95), so the placement clearance covers the collider
    // r4 ship 10-28: two circles fitted to the Tripo plinth (x -0.62..1.19, z -1.59..1.02): overhang p90 0.83 -> 0.13 m
    footprint: [{ circle: [0.29, -0.85, 0.95] }, { circle: [0.29, 0.35, 0.95] }],
    zones: [H, D],
    note: 'Broken stone pillar, chipped top, moss/frost.',
  },
  broken_gate: {
    id: 'broken_gate',
    height: 8,
    radius: 5.6,
    footprint: [{ circle: [-3.2, 0, 0.9] }, { circle: [2.6, 0, 0.7] }],
    zones: [H],
    note: 'Half-collapsed pagoda gate, one pillar snapped, roof slumped.',
  },
  yurt: {
    id: 'yurt',
    height: 4.3,
    radius: 4,
    footprint: [{ circle: [0, 0, 3.4] }],
    zones: [H],
    note: 'Snow-covered round felt tent with timber lattice door.',
  },
  plague_brazier: {
    id: 'plague_brazier',
    height: 1.42, // r9 ship: the P9 brazier opens its chamber 12 cm (1.30 -> 1.42 m; bakeLight / metinBodies use def.height)
    radius: 0.8,
    
    footprint: [{ circle: [0, 0, 0.38] }],
    zones: [H],
    note: 'Mossy stone lantern: horned roof, a square chamber burning a small green plague fire over sickly coals, bulb belly on four splayed legs.',
  },
  // --- daeryeol -------------------------------------------------------------------------------------------
  lava_pillar: {
    id: 'lava_pillar',
    height: 13,
    radius: 2.4,
    footprint: [{ circle: [0, 0, 1.9] }],
    zones: [D],
    note: 'Stacked tapering octagonal pillar of rust-red carved sandstone with glowing ember seams and a flared capital.',
  },
  stone_gate: {
    id: 'stone_gate',
    height: 9,
    radius: 5,
    reach: 5.5, // r6 ship 10-29: drawn half extent (the gate wings) for the metin fall-site check only
    footprint: [{ circle: [-2.9, 0, 0.85] }, { circle: [2.9, 0, 0.85] }],
    zones: [D, H],
    note: 'Small carved stone gate with a curved roof (rust sandstone).',
  },
  obelisk: {
    id: 'obelisk',
    height: 7,
    radius: 1.7, // r5 P5 10-29: 1.6 -> 1.7 = the footprint circle (r 1.7), so the placement clearance covers the collider
    // r4 ship 10-28: the Tripo plinth is +-1.54 m: r 1.1 -> 1.7 (overhang p90 0.75 -> 0.15 m; r 1.75 would re-roll the daeryeol scatter)
    footprint: [{ circle: [0, 0, 1.7] }],
    zones: [D],
    note: 'Cracked basalt obelisk with a faint ember rune column.',
  },
  brazier: {
    id: 'brazier',
    height: 1.4,
    radius: 1,
    footprint: [{ circle: [0, 0, 0.7] }],
    zones: [D, Y, S],
    note: 'Bronze fire basin on three legs (flame is emissive/VFX).',
  },
  fire_altar: {
    id: 'fire_altar',
    height: 3,
    radius: 5,
    // r4 ship 10-28: fitted to the Tripo dais (flat sides 3.94-4.16 m, corners 4.3-4.5): low overhang p90 0.66 -> 0.10 m; the stair flight stays outside
    footprint: [{ circle: [0.15, 0.03, 4.2] }],
    zones: [D],
    note: 'Round stepped altar with carved dragon reliefs, ember cracks.',
  },
  // --- Content roster ids (biome.props `prop_<id>`) ----------------------------------------------------------
  wooden_fence: { id: 'wooden_fence', height: 1.4, radius: 1.2, footprint: [{ rect: [0, 0, 2, 0.35] }], zones: [Y, S, H], note: 'Fence section, 2 m long along local +X (ends at x = ±1).' },
  war_banner: { id: 'war_banner', height: 4.6, radius: 1.1, footprint: [{ circle: [0, 0, 0.6] }], zones: [S, D], occlude: false, note: 'Orc war standard: spear-tipped pole, crossbar with a black-red sawtooth banner and a bone-white clan glyph, red horsehair plume, stone cairn foot.' },
  ice_crystal: { id: 'ice_crystal', height: 2.6, radius: 1.25, footprint: [{ circle: [0, 0, 1.0] }], zones: [H], note: 'Glassy glacier-ice shards breaking out of a snow-and-rock mound.' },
  snow_shrine: { id: 'snow_shrine', height: 3.5, radius: 2, footprint: [{ circle: [0, 0, 1.5] }], zones: [H], note: 'Small snow-covered roadside shrine.' },
  frozen_tree: { id: 'frozen_tree', height: 5.6, radius: 2.0, reach: 3.2, footprint: [{ circle: [0, 0, 0.45] }], zones: [H], note: 'Bare winter tree: gnarled trunk, root flare over the snow, frost-tipped twig sprays.' },
  lava_rock: { id: 'lava_rock', height: 2, radius: 1.5, footprint: [{ circle: [0, 0, 1.15] }], zones: [D], note: 'Jagged layered volcanic rock, dark charcoal crust with a glowing molten crack web between the blocks.' },
  obsidian_spire: { id: 'obsidian_spire', height: 10, radius: 3.3, footprint: [{ circle: [0, 0, 2.6] }], zones: [D], rimOnly: 0.85, note: 'Single leaning 10 m volcanic horn with lava veins and cinder rubble. Placed only on arena edges and zone rims.' },
  fire_brazier: { id: 'fire_brazier', height: 1.2, radius: 0.9, footprint: [{ circle: [0, 0, 0.6] }], zones: [D, S], note: 'Bronze fire urn with masks and ring handles on a knotwork plinth over a glowing coal bed.' },
};

/** Collision circles for a placed prop (world space). */
export function propBlockers(p: PropPlacement, out: Blocker[]): void {
  const def = PROP_DEFS[p.id];
  if (!def) return;
  const c = Math.cos(p.yaw);
  const s = Math.sin(p.yaw);
  for (const part of def.footprint) {
    if ('circle' in part) {
      const [cx, cz, r] = part.circle;
      const lx = cx * p.scale;
      const lz = cz * p.scale;
      out.push({ x: p.x + lx * c + lz * s, z: p.z - lx * s + lz * c, r: r * p.scale, kind: 'prop' });
    } else {
      const [cx, cz, w, d] = part.rect;
      // tile the rectangle with squares along its long side
      const n = Math.max(1, Math.round(Math.max(w, d) / Math.min(w, d)));
      const long = w >= d;
      const side = long ? w / n : d / n;
      const r = Math.max(side, Math.min(w, d)) * 0.5 * 1.18 * p.scale;
      for (let i = 0; i < n; i++) {
        const off = (i + 0.5) * side - (long ? w : d) * 0.5;
        const lx = (long ? cx + off : cx) * p.scale;
        const lz = (long ? cz : cz + off) * p.scale;
        out.push({ x: p.x + lx * c + lz * s, z: p.z - lx * s + lz * c, r, kind: 'prop' });
      }
    }
  }
}
