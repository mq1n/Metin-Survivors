// Ambient art (common VFX target `ambient`; owner: the ambient builder). Every sprite here is a manifest id of kind `vfx` made with tools/imagegen (jobs/gen/<id>.json:

// In use (r3): vfx_ambient_leaf_sheet, vfx_ambient_ash_flake_sheet, vfx_ambient_glitter_chip, vfx_ambient_dust_grain_sheet (the translucent granular dust veil of every one-shot),
// vfx_ambient_ember_chip_sheet (ragged angular ember shards), vfx_ambient_snow_soft_sheet (soft fluffy snow flakes) + the shared soft pips / cloud puffs. Superseded and no longer drawn
// (ids stay in the manifest, never deleted; dropped from the art scope so the shared atlas does not carry them): vfx_ambient_dust_puff_sheet (r1), vfx_ambient_dust_body_sheet (r2 cotton
// body), vfx_ambient_snow_flake_sheet (r1/r2 additive snow dots), vfx_ambient_cinder_sheet (r1/r2 teardrop cinders).
// A missing sprite draws `fb` / `fallback` (the procedural atlas cell), so nothing here can break a preset.
//
// Two consumers: the LEGACY kit presets (ambient.* loops, enemy.charge / enemy.leap) draw `AMBIENT_ART` through PBuilder.art; the FxSpecs (sk.gen.dust /
// sk.gen.running_dust) draw the `ART_*` ArtTex. A run packs only the art of the specs it can spawn, so carrier specs (never spawned: rate 0 / alpha 0) keep
// the ids below in the run scope (same trick as common/kitArt.ts `sk.gen.kit_art`). One carrier PER LOOP, `sk.gen.ambient_art.<name>` for `ambient.<name>`
// (AMBIENT_PRESET_ART says what each loop draws): a run spawns ONE ambient loop for its whole zone (app/run.ts), so artScope.ts runSpecIds(..., zone) keeps only
// that zone's carrier (none for a zone whose look has no ambient loop) and the other loops' sprites take no atlas cells. Without a zone (the galleries, the
// tools) every carrier stays.
import type { Fx, KitArt } from '../../emit';
import { ART_ROLE_BASE } from '../../spec/art';
import { AMBIENT_CARRIER_PREFIX } from '../../spec/artScope';
import { SPR } from '../../textures';
import type { ArtTex, FxSpec, ParticleSpec } from '../../spec/types';
import { KIT_ART_IDS } from '../kitArt';

export const AMBIENT_ART = {
  /** mottled cloud puff (veils, haze) */
  puffMottled: { id: 'vfx_cloud_puff_mottled_a', fb: SPR.smoke2 },
  
  pip: { id: 'vfx_glow_pip_soft_a', fb: SPR.glow },
  /** hot cinder core: bright centre in a tight round halo */
  hotcore: { id: 'vfx_glow_hotcore_a', fb: SPR.glowTight },
  /** cluster of dark cinder-smoke puffs */
  cinderPuffs: { id: 'vfx_smoke_cinder_puffs_a', fb: SPR.smoke2 },
  // ---- r1 sheets (2x2, `AMBIENT_SHEET` says how the packer cuts them; `sheetSpr` picks one cell) ----
  /** painted leaves, straight alpha, mid-grey (tinted per leaf): 0 maple, 1 birch blade, 2 curled / tumbling leaf, 3 petal */
  leafSheet: { id: 'vfx_ambient_leaf_sheet', fb: SPR.leaf0 },
  /** ragged ash / burnt-paper flakes, straight alpha, mid-grey with torn pale edges */
  ashSheet: { id: 'vfx_ambient_ash_flake_sheet', fb: SPR.flake },
  
  glitterChip: { id: 'vfx_ambient_glitter_chip', fb: SPR.glow },
  /** r3: FOUR very translucent, finely granular dust veils (thousands of fine grains, dense centre, sparse grains at a ragged rim), additive-on-black = alpha is the brightest channel, neutral
   *  light grey-white (tinted in game): the visible body of every foot / charge / leap / ground dust (the r2 filled cotton body drew near-opaque cauliflower billows). Four variants, not four times. */
  dustGrain: { id: 'vfx_ambient_dust_grain_sheet', fb: SPR.smoke2 },
  
  emberChip: { id: 'vfx_ambient_ember_chip_sheet', fb: SPR.glowTight },
  
  snowSoft: { id: 'vfx_ambient_snow_soft_sheet', fb: SPR.glow },
} as const satisfies Record<string, KitArt>;

/** the 2x2 sheets of AMBIENT_ART: id -> [cols, rows]. The packer reads this from the carrier spec's `tex.grid` (first declaration of a key wins), so every sheet draws ONE frame per cell. */
export const AMBIENT_SHEET: Readonly<Record<string, readonly [number, number]>> = {
  [AMBIENT_ART.leafSheet.id]: [2, 2],
  [AMBIENT_ART.ashSheet.id]: [2, 2],
  [AMBIENT_ART.dustGrain.id]: [2, 2],
  [AMBIENT_ART.emberChip.id]: [2, 2],
  [AMBIENT_ART.snowSoft.id]: [2, 2],
};

/**
 * Frame `k` of a sheet as ONE static packed art role for the legacy kit (`PBuilder.spr`): the legacy particle shader plays a sheet's frames as a flipbook
 * over the particle's life, so a particle that wants a fixed variant (a leaf, a snow puff) gets the cell of frame k with the frame count cleared. Same decode
 * as the GLSL `artRect` (spec/art.ts `artRect` is its JS mirror; the test pins both). `fb` (a procedural atlas cell) while the art array does not hold the sprite.
 */
export function sheetSpr(fx: Fx, a: KitArt, k: number, fb: number = a.fb): number {
  const pk = fx.artCell(a);
  if (pk < ART_ROLE_BASE) return fb;
  const d0 = pk - ART_ROLE_BASE;
  const frames = Math.floor(d0 / 8192) + 1;
  if (frames <= 1) return pk;
  const G = Math.max(1, fx.spec?.art.grid ?? 1);
  const layer = d0 % 8;
  let d = Math.floor(d0 / 8);
  const c0 = d % 8;
  d = Math.floor(d / 8);
  const r0 = d % 8;
  d = Math.floor(d / 8);
  const w = (d % 4) + 1;
  d = Math.floor(d / 4);
  const h = (d % 4) + 1;
  const cc = c0 + Math.max(0, Math.min(frames - 1, Math.floor(k))) * w;
  return ART_ROLE_BASE + layer + 8 * (cc % G) + 64 * (r0 + Math.floor(cc / G) * h) + 512 * (w - 1) + 2048 * (h - 1);
}

/** r3: one of the four granular dust veils (r in 0..1 picks the cell) as a packed art cell; the procedural smoke cell while the sheet is not packed */
export function grainCell(fx: Fx, r: number): number {
  return sheetSpr(fx, AMBIENT_ART.dustGrain, Math.min(3, Math.floor(r * 4)), SPR.smoke2);
}

/**
 * The sprites each `ambient.<name>` loop draws (presets_warn.ts; ambient.test.ts runs every loop and pins that it asks the art array for nothing else).
 * The key is the preset name after `ambient.`: `sk.gen.ambient_art.<name>` carries exactly this list (minus the ids carried elsewhere, below).
 */
export const AMBIENT_PRESET_ART: Readonly<Record<string, readonly KitArt[]>> = {
  leaves: [AMBIENT_ART.leafSheet],
  leaves_autumn: [AMBIENT_ART.leafSheet],
  motes: [AMBIENT_ART.pip],
  dust: [AMBIENT_ART.puffMottled, AMBIENT_ART.pip, AMBIENT_ART.dustGrain],
  // AMB-02: the snow lost its blown-snow veils (puffMottled): the flakes are the painted soft sheet alone
  snow: [AMBIENT_ART.snowSoft],
  embers: [AMBIENT_ART.emberChip, AMBIENT_ART.hotcore, AMBIENT_ART.cinderPuffs, AMBIENT_ART.puffMottled],
  ash: [AMBIENT_ART.hotcore, AMBIENT_ART.ashSheet, AMBIENT_ART.dustGrain],
  sparks: [AMBIENT_ART.glitterChip, AMBIENT_ART.emberChip],
  // AMB-02: the smoke wisps are granular veils (dustGrain, carried by the dust specs) and mottled billows
  smoke: [AMBIENT_ART.puffMottled, AMBIENT_ART.dustGrain],
};

/** every manifest id the ambient presets draw */
export const AMBIENT_ART_IDS: readonly string[] = [...new Set(Object.values(AMBIENT_ART).map((a) => a.id))];

/**
 * ids the carriers do NOT list: the kit's own sprites (glint, rock: `sk.gen.kit_art` carries them) and the ones `sk.gen.dust` / `sk.gen.running_dust`
 * draw themselves (specs.ts; common specs are always in a run's art scope, so the legacy charge / leap presets find them packed too). A spec holds <= 16 elements.
 */
const CARRIED_ELSEWHERE = new Set<string>([
  ...KIT_ART_IDS,
  AMBIENT_ART.dustGrain.id,
]);
/** the ids the carriers carry (one never-drawn element each, in the carrier of every loop that draws it) */
export const AMBIENT_CARRIED_IDS: readonly string[] = AMBIENT_ART_IDS.filter((id) => !CARRIED_ELSEWHERE.has(id));
/** the ids the carriers leave to the kit carrier / the dust specs (the test pins carried + elsewhere = every id) */
export const AMBIENT_ELSEWHERE_IDS: readonly string[] = AMBIENT_ART_IDS.filter((id) => CARRIED_ELSEWHERE.has(id));

// ArtTex for the FxSpecs (procedural role while the sprite is not packed)
/** r3: the very translucent, finely granular dust veil: FOUR VARIANTS in a 2x2 sheet (a random one per puff), additive-on-black art drawn through the alpha pipeline (alpha = brightest channel), neutral */
export const ART_DUST_GRAIN: ArtTex = { art: AMBIENT_ART.dustGrain.id, fallback: 'smoke2', grid: [2, 2], frames: 4 };

/** one never-drawn element per sprite (rate 0, alpha 0): compile still collects its art key, nothing ever emits */
function carrier(id: string): ParticleSpec {
  return {
    kind: 'particle',
    note: `ambient art carrier: keeps ${id} in the run's art scope for the legacy ambient presets (never drawn)`,
    cycle: 1,
    max: 1,
    rate: [0, 0],
    life: [0, 1],
    half: [0, 0.1],
    color: [0, 0xffffff, 0, 1, 0xffffff, 0],
    billboard: 'screen',
    blend: 'add',
    tex: { art: id, fallback: 'glow', ...(AMBIENT_SHEET[id] ? { grid: AMBIENT_SHEET[id] } : {}) },
  };
}

/** `sk.gen.ambient_art.<name>`: scope carrier of the loop `ambient.<name>` (never spawned by the sim or a preset); runSpecIds(..., zone) keeps the one of the run's zone */
function carrierSpec(name: string, art: readonly KitArt[]): FxSpec {
  return {
    id: AMBIENT_CARRIER_PREFIX + name,
    desc: `art-scope carrier for the sprites of the zone ambient loop ambient.${name}; never spawned, only in the scope of a run whose zone spawns that loop`,
    behavior: 'selfBuff',
    ref: { family: 'ambient art carrier', notes: 'see vfx/common/ambient/art.ts' },
    size: 'radius',
    base: 1,
    dur: 0.1,
    elements: art.filter((a) => !CARRIED_ELSEWHERE.has(a.id)).map((a) => carrier(a.id)),
  };
}

/** the nine carriers, one per ambient loop, in the order of AMBIENT_PRESET_ART */
export const AMBIENT_ART_SPECS: readonly FxSpec[] = Object.entries(AMBIENT_PRESET_ART).map(([name, art]) => carrierSpec(name, art));
