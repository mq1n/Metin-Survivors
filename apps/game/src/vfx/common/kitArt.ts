// C3 bridge: generated sprites (asset manifest kind 'vfx') the LEGACY kit (vfx/presets/kit.ts, PBuilder.art) draws. They sit
// in the spec runtime's art array (vfx/spec/art.ts) next to the skill / hit art: one art system, no second atlas. A run
// packs only the art of the specs it can spawn, so every id below is referenced by the carrier spec `sk.gen.kit_art` (never
// spawned: its elements emit nothing, rate 0 / alpha 0). The carrier is unclaimed by any skill, i.e. "common": always in the run scope.
//

// the look; the shipped file is our own render). Colour: neutral white / grey, the kit tints it (additive on black for
// the glow sprites, straight alpha for the smoke / rock / crack sprites: the manifest `alpha` flag).
//
// A missing sprite (not in the manifest, art outside the run's scope, `fx.legacyKit`, tests without a GPU) draws `fb`, the
// procedural atlas cell the kit used before, so nothing here can break a preset.
import type { KitArt } from '../emit';
import type { FxSpec, ParticleSpec } from '../spec/types';
import { SPR } from '../textures';

export const KIT_ART = {
  /** sparse soft dust puff (alpha) */
  smokeDust: { id: 'vfx_smoke_dustpuff_a', fb: SPR.smoke0 },
  /** grainy dust / smoke clump (alpha) */
  smokeClump: { id: 'vfx_smoke_dustclump_a', fb: SPR.smoke1 },
  /** dense billowing cloud ball, lit from above (alpha) */
  smokeBillow: { id: 'vfx_smoke_lumpball_a', fb: SPR.smoke2 },
  /** broken glowing arcs of a ring, open gaps (click-select style; alpha) */
  ringArcs: { id: 'vfx_ring_arcs_select_a', fb: SPR.ringDash },
  /** ground flare: fine radial spikes around a dark hub (additive) */
  groundBurst: { id: 'vfx_rayring_ground_burst_a', fb: SPR.sunburst },
  /** pinpoint glint with a halo and 4 hair rays (additive) */
  glintPin: { id: 'vfx_glint_halo_pin_a', fb: SPR.glint },
  /** light shafts growing from the bottom edge, three heights (additive) */
  shafts: { id: 'vfx_curtain_shafts_a', fb: SPR.streakSoft },
  /** facet-cut rock chunk, lit (alpha) */
  rockFacet: { id: 'vfx_rock_chunk_facet_a', fb: SPR.shard },
  /** branching crack with a glowing ember seam and charred edges, full colour (alpha) */
  crackScar: { id: 'vfx_crack_thorn_scorch_a', fb: SPR.crack },
} as const satisfies Record<string, KitArt>;

/** every manifest id the kit draws (the carrier spec references them all) */
export const KIT_ART_IDS: readonly string[] = [...new Set(Object.values(KIT_ART).map((a) => a.id))];

/** one never-drawn element per sprite (rate 0, alpha 0): compile still collects its art key, nothing ever emits */
function carrier(id: string): ParticleSpec {
  return {
    kind: 'particle',
    note: `kit art carrier: keeps ${id} in the run's art scope for the legacy kit (never drawn)`,
    cycle: 1,
    max: 1,
    rate: [0, 0],
    life: [0, 1],
    half: [0, 0.1],
    color: [0, 0xffffff, 0, 1, 0xffffff, 0],
    billboard: 'screen',
    blend: 'add',
    tex: { art: id, fallback: 'glow' },
  };
}

/** `sk.gen.kit_art`: scope carrier for the legacy kit's generated sprites (never spawned by the sim or a preset) */
export const KIT_ART_SPEC: FxSpec = {
  id: 'sk.gen.kit_art',
  desc: 'art-scope carrier for the legacy kit sprites (smoke, ring arcs, glint, shafts, rock, crack); never spawned',
  behavior: 'selfBuff',
  ref: { family: 'kit art carrier', notes: 'see vfx/common/kitArt.ts and vfx/presets/README.md "Generated art in the legacy kit"' },
  size: 'radius',
  base: 1,
  dur: 0.1,
  elements: KIT_ART_IDS.map(carrier),
};
