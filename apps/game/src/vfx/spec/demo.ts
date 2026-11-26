// Dev-only demo specs of the spec runtime features (NOT skills: never in skills.json, not registered in production):
//   sk.__art_demo      art role (generated sprite `vfx_test_swirl`) in the off hand, a blade-tip weapon trail, rank
//                      escalation (per-grade colour / size / texture, rank-gated ground slash, sparks and a P-only
//                      hand ribbon), readability tone (occlude / clamp)
//   sk.__art_demo_raw  the same without occlude / clamp (A/B on bright floors)
//   sk.__art_sheets    the ART_SHEETS flipbooks (several sprites = frames of one animation) and the frame modes side by side
// Gallery: /vfx.html?ids=sk.__art_demo  ·  in game: cast it through a cloned skill def (see README "Demo").
import type { PresetDef } from '../presets/types';
import { ART_SHEETS, type ArtSheetName } from './artSheets';
import { specPreset } from './preset';
import type { TexRole } from './roles';
import type { ElementSpec, FrameMode, FxSpec } from './types';

const SWIRL = { art: 'vfx_test_swirl', fallback: 'twistDisc' } as const;

export const ART_DEMO: FxSpec = {
  id: 'sk.__art_demo',
  desc: 'Spec runtime demo: generated swirl sprite in the off hand, weapon trail on the blade, per-grade escalation (dev only)',
  behavior: 'meleeArc',
  ref: { family: 'warrior sword trace (runtime feature demo, not a skill)' },
  size: 'radius',
  base: 3,
  dur: 0.28,
  gradeScale: [1, 1.1, 1.2, 1.35],
  occlude: 0.6,
  clamp: 1,
  demo: { swing: { t0: 0.04, dur: 0.3, from: -125, to: 65, pitch: -10 } },
  elements: [
    {
      kind: 'particle',
      note: 'art swirl orb riding the off hand (hand_l socket), recoloured per grade',
      // burst: 2 particles in the first emitter step (rate is sampled per 1/60 s step), max-alive keeps it at 2
      cycle: 0.7,
      max: 2,
      rate: [0, 120, 0.04, 120, 0.05, 0],
      life: [0, 0.65],
      half: [0, 0.2],
      scale: [0, 0.6, 0.25, 1.15, 1, 1.3],
      color: [0, 0xffe6a8, 0, 0.15, 0xffe6a8, 1, 0.7, 0xffc060, 0.85, 1, 0xff9030, 0],
      rotation: { start: [0, 360], spin: 420 },
      billboard: 'screen',
      attach: 'hand_l',
      blend: 'add',
      bright: 1.6,
      tex: SWIRL,
      grade: {
        g1: { color: [0, 0xffd080, 0, 0.15, 0xffb050, 1, 0.7, 0xff7a20, 0.85, 1, 0xff4a10, 0], half: [0, 0.24] },
        g2: { color: [0, 0xffc0a0, 0, 0.15, 0xff6040, 1, 0.7, 0xe02a30, 0.85, 1, 0x901020, 0], half: [0, 0.28] },
        g3: { color: [0, 0xe0d0ff, 0, 0.15, 0xb080ff, 1, 0.7, 0x6a40ff, 0.9, 1, 0x30c0ff, 0], half: [0, 0.34], bright: 2 },
      },
    },
    {
      kind: 'trail',
      note: 'weapon trace: band from the blade tip 0.85 m toward the grip, fades along its 0.2 s length',
      attach: 'weapon',
      t0: 0.02,
      dur: 0.42,
      life: 0.2,
      width: 0.85,
      taper: [0, 1, 0.6, 0.8, 1, 0.25],
      color: [0, 0xfff4d0, 0.95, 0.3, 0xffd27a, 0.8, 1, 0xff8a2a, 0],
      fade: [0, 0, 0.06, 1, 0.75, 1, 1, 0],
      blend: 'add',
      bright: 1.5,
      tex: 'glowStrip',
      grade: {
        g1: { color: [0, 0xfff0c0, 0.95, 0.3, 0xffb050, 0.85, 1, 0xff5a10, 0] },
        g2: { color: [0, 0xffe0d0, 1, 0.3, 0xff6040, 0.9, 1, 0xa01020, 0], tex: 'energyStrip', life: 0.24 },
        g3: { color: [0, 0xf0e8ff, 1, 0.3, 0xa080ff, 0.9, 1, 0x30a0ff, 0], tex: SWIRL, life: 0.26 },
      },
    },
    {
      kind: 'surface',
      note: 'M1+: ground crescent in front of the caster',
      minRank: 3,
      t0: 0.12,
      life: 0.32,
      shape: { kind: 'arc', r0: 1.6, r1: 2.6, span: 140, a0: -70, taper: 0.8 },
      at: [0, 0.05, 0],
      scale: [0, 0.75, 1, 1.08],
      color: [0, 0xffc070, 0, 0.15, 0xffa040, 0.85, 1, 0xff5010, 0],
      sweep: [[0, 0, 0.45, 1], [0, 0, 0.5, 0, 1, 1]],
      blend: 'add',
      bright: 1.3,
      tex: 'slashArc',
    },
    {
      kind: 'particle',
      note: 'G1+: sparks shed by the blade tip (born at the weapon socket, then free)',
      minRank: 5,
      t0: 0.06,
      cycle: 0.32,
      max: 40,
      rate: [0, 110],
      life: [0, 0.35],
      half: [[0, 0.025], [0, 0.11]],
      vel: [0, 0.035],
      jitter: [0.2, 0.2, 0.2],
      gravity: [0, 6],
      air: [0, 0.04],
      color: [0, 0xffffff, 1, 0.5, 0xffc060, 0.9, 1, 0xff6020, 0],
      billboard: 'stretch',
      from: 'weapon',
      blend: 'add',
      bright: 1.6,
      tex: 'spark',
    },
    {
      kind: 'trail',
      note: 'P only: art ribbon trailing the off hand',
      minRank: 7,
      attach: 'hand_l',
      t0: 0,
      dur: 0.5,
      life: 0.3,
      mode: 'ribbon',
      width: 0.3,
      taper: [0, 1, 1, 0],
      color: [0, 0xd0c0ff, 1, 1, 0x40a0ff, 0],
      blend: 'add',
      bright: 1.4,
      tex: SWIRL,
    },
    {
      kind: 'particle',
      note: 'P only: big art flash on the off hand at the strike',
      minRank: 7,
      t0: 0.18,
      cycle: 0.5,
      max: 1,
      rate: [0, 120, 0.03, 120, 0.04, 0],
      life: [0, 0.45],
      half: [0, 0.55],
      scale: [0, 0.4, 0.3, 1.2, 1, 1.5],
      color: [0, 0xffffff, 0, 0.1, 0xc0a0ff, 1, 1, 0x4060ff, 0],
      rotation: { start: [0, 360], spin: -240 },
      billboard: 'screen',
      attach: 'hand_l',
      blend: 'add',
      bright: 1.8,
      tex: SWIRL,
    },
  ],
};

/** the same without the readability tone (A/B on bright floors) */
export const ART_DEMO_RAW: FxSpec = {
  ...ART_DEMO,
  id: 'sk.__art_demo_raw',
  desc: 'sk.__art_demo without occlude / clamp (readability A/B, dev only)',
  occlude: undefined,
  clamp: undefined,
  elements: ART_DEMO.elements.map((e): ElementSpec => ({ ...e, occlude: undefined, clamp: undefined }) as ElementSpec),
};

interface SheetRow {
  sheet: ArtSheetName;
  fallback: TexRole;
  /** column (m, local frame: -X = the caster's right); never 0, that is where the gallery's body stands */
  x: number;
  /** row height (m) */
  y: number;
  /** explicit frame mode (default: what the art draws by default, hard cuts) */
  mode?: FrameMode;
}






const SHEET_DEMO: readonly SheetRow[] = [
  { sheet: 'boltFlickerV', fallback: 'boltV', x: -3.25, y: 0.6 },
  { sheet: 'boltWavyH', fallback: 'boltH', x: -2.05, y: 0.6 },
  { sheet: 'boltForkV', fallback: 'boltV', x: -0.85, y: 0.6 },
  { sheet: 'boltBlowBodyH', fallback: 'boltH', x: 0.85, y: 0.6 },
  { sheet: 'boltBlowTwinH', fallback: 'boltH', x: 2.05, y: 0.6 },
  { sheet: 'boltBlowWeaponH', fallback: 'boltH', x: 3.25, y: 0.6 },
  { sheet: 'boltBlowH', fallback: 'boltH', x: -3.25, y: 1.9, mode: 'random' },
  { sheet: 'boltForkH', fallback: 'boltH', x: -2.05, y: 1.9, mode: 'random' },
  { sheet: 'boltWavyH', fallback: 'boltH', x: -0.85, y: 1.9, mode: 'blend' },
  { sheet: 'boltWavyH', fallback: 'boltH', x: 0.85, y: 1.9, mode: 'cut' },
  { sheet: 'boltWavyH', fallback: 'boltH', x: 2.05, y: 1.9, mode: 'random' },
];

/** one particle per row, each frame list playing at 8 fps (a sheet of N sprites = N cells of the art array) */
export const ART_SHEETS_DEMO: FxSpec = {
  id: 'sk.__art_sheets',
  desc: '',
  behavior: 'selfBuff',
  ref: { family: 'runtime feature demo, not a skill' },
  size: 'radius',
  base: 2,
  dur: 1.8,
  elements: SHEET_DEMO.map(
    (r): ElementSpec => ({
      kind: 'particle',
      note: `${r.sheet}: ${ART_SHEETS[r.sheet].length} sprites as one flipbook, ${r.mode ?? 'default (cut)'}`,
      cycle: 1.8,
      max: 1,
      rate: [0, 120, 0.02, 120, 0.03, 0],
      life: [0, 1.7],
      at: [r.x, r.y, 0],
      half: [0, 0.45],
      color: [0, 0xffffff, 0, 0.04, 0xe6eeff, 1, 0.9, 0xc0d4ff, 1, 1, 0x90b0ff, 0],
      billboard: 'screen',
      blend: 'add',
      bright: 1.3,
      tex: { art: ART_SHEETS[r.sheet], fallback: r.fallback },
      frames: r.mode ? { fps: 8, mode: r.mode } : { fps: 8 },
    }),
  ),
};

/** dev-only spec presets (registered by VfxSystem; empty in production builds) */
export const DEV_SPEC_PRESETS: PresetDef[] = import.meta.env.DEV ? [specPreset(ART_DEMO), specPreset(ART_DEMO_RAW), specPreset(ART_SHEETS_DEMO)] : [];
