// GUARD: our skill VFX never darken the caster.
//
// USER RULE (2026-10-26): "bahsettiğim durum mevcut c++ clientinde bir bug, 3js'e karartma aktarılmamalı"
//   = what I described is a bug in the existing C++ client, the darkening must not be carried into three.js.
//


// blends: the destination colour is scaled by the framebuffer's destination alpha), not a look to port. The reference captures

// critic could copy it: a dark `alpha` body drawn on the hero, a high `occlude` (the soft dark core that darkens what is behind an
// additive element), or a "black silhouette is missing" resemblance gap. None of that is allowed. `sk.shadow_clone` (an original
// skill) had been designed from the bug ("darkened assassin"); its body is a translucent mid-luminance violet now (SETTLED 2026-10-27,

// on any guarded id turns this file red at once.
//
// Guarded ids: sk.vanishing_leap*, sk.seeking_stars*, sk.shadow_clone*, sk.umbral_plate*, sk.obsidian_bulwark* (every part: .cast / .aura / .explode / .loop / .burst ...). For each id the test
// collects every spec form that can reach the screen, live or not:
//   (a) the HAND specs of shadow.ts / blade.ts / yacha weaponry.ts / magic.ts (imported directly),
//   (b) what SHIPS: the registry after ensureAllSkillVfx() (SKILL_SPECS: every hand spec of every ninja file, companions in other files
//       included, with the live families swapped in) and the family the wiring files REGISTERED (skillFamily(id): an inline patch in a
//       `<id>.family.ts` is only visible here, live or not),
//   (c) the GENERATED family skills/_gen/<id>.gen.ts and (d) the family after its override patch skills/<class>/<id>.patch.ts
//       (applyPatch, the way registerPatchedFamily builds it), for a family that is not wired yet.
//
// What fails (per element, every grade band included):
//   1. DARKENING ALPHA: an element that is not additive (the host draws every `blend !== 'add'` element as alpha; an unset blend is
//      additive, withDefaults) pulls what is behind it toward its own colour by its alpha, so it darkens when its DRAWN luma is below
//      what a lit hero / ground has. The colour curve is sampled along its whole life with the engine's own evalColor (a mid-life
//      between two keys that each look fine is checked too), the drawn colour is the key x `bright` (a bright < 1 darkens), and
//      pull = alpha x (DARK_REF_LUMA - luma) must stay <= MAX_PULL. An alpha element of a `tint: true` template is flagged outright
//      (the run-time palette multiplies its colour keys: 0x40ff40 x the dark palette's 0xa24cff is drawn 0x284c40). Measured values:
//      the old shadow_clone body 0.24 (flagged; requiem_flurry's unguarded 0x2a0f50 tip smoke would be 0.14), the shipped V1 body 0.02,
//      a faded-in invisible dark key 0.04: the limit 0.08 sits between them. Additive blends cannot darken, near-black additive keys
//      are ignored.
//   2. `occlude` (spec default or element, base or grade band) above MAX_OCCLUDE. The current maximum of these ids is 0: none of them
//      uses it. Readability on bright floors for these skills is `clamp`, never `occlude` (README "Readability on bright floors":
//      READABLE = { occlude: 0.5, clamp: 1 } darkens everything behind the effect, the caster included).
//

// vfx_nova -> shock.wave, element palette smoke) is a classic preset of every skill, not a spec of these ids.
//
// Measured in game (cast.ts frame-stepped, hero model visible, body-crop luma, vanishing_leap / seeking_stars / shadow_clone at g0 + g3,

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { COMMON_MOMENT_IDS } from '../skills/common/moments';
import { WOLFMAN_MOMENT_IDS } from '../skills/wolfman/moments';
import { NINJA_MOMENT_IDS } from '../skills/ninja/moments';
import { SHAMAN_MOMENT_IDS } from '../skills/shaman/moments';
import { YACHA_MOMENT_IDS } from '../skills/yacha/moments';
import { WARRIOR_MOMENT_IDS } from '../skills/warrior/moments';
import { belongsToSkill, skillFamily } from '../skills/families';
import { ensureAllSkillVfx } from '../skills/loader';
import { SKILL_SPECS } from '../skills/index';
import { BLADE_SPECS } from '../skills/ninja/blade';
import { SHADOW_SPECS } from '../skills/ninja/shadow';
import { YACHA_MAGIC_SPECS } from '../skills/yacha/magic';
import { YACHA_WEAPONRY_SPECS } from '../skills/yacha/weaponry';
import { evalColor } from '../spec/curves';
import { applyPatch, type KeyTable, type SkillPatch } from '../spec/patch';
import type { ElementSpec, FxSpec } from '../spec/types';









const GUARDED = ['vanishing_leap', 'seeking_stars', 'shadow_clone', 'umbral_plate', 'obsidian_bulwark'] as const;
type GuardedId = (typeof GUARDED)[number];

/** luma (Rec.709 on sRGB, 0..1) of a lit hero / ground: an alpha colour below it darkens what it covers */
const DARK_REF_LUMA = 0.45;
/** the most an alpha element may darken: alpha x (DARK_REF_LUMA - drawn luma), see the header for the calibration */
const MAX_PULL = 0.08;
/** an element below this alpha is invisible (fade-in / fade-out keys) */
const DARK_MIN_ALPHA = 0.1;
/** colour-curve samples along the life (0..1) */
const SAMPLES = 33;
/** the highest `occlude` any guarded spec / element carries today (none uses it); raising it needs a measured reason, see header */
const MAX_OCCLUDE = 0;

interface GenModule {
  GEN: readonly FxSpec[];
}
interface PatchModule {
  PATCH: SkillPatch<KeyTable>;
}
const GENS = import.meta.glob<GenModule>('../skills/_gen/*.gen.ts');
const PATCHES = import.meta.glob<PatchModule>('../skills/*/*.patch.ts');
// wiring files: not imported here (the loader imports them), listed so the failure text can say whether a family is wired
const WIRING = Object.keys(import.meta.glob('../skills/*/*.family.ts'));

const HAND: readonly FxSpec[] = [...SHADOW_SPECS, ...BLADE_SPECS, ...YACHA_WEAPONRY_SPECS, ...YACHA_MAGIC_SPECS];

interface Source {
  label: string;
  specs: readonly FxSpec[];
}

/** every spec form of a guarded skill that can reach the screen */
async function collect(id: GuardedId): Promise<Source[]> {
  const out: Source[] = [
    { label: 'hand spec', specs: HAND.filter((s) => belongsToSkill(s.id, id)) },
    { label: 'registry (ships)', specs: SKILL_SPECS.filter((s) => belongsToSkill(s.id, id)) },
  ];
  const fam = skillFamily(id);
  if (fam) out.push({ label: `registered family (${fam.live ? 'live' : 'not live'})`, specs: fam.specs });
  const genPath = Object.keys(GENS).find((p) => p.endsWith(`/_gen/${id}.gen.ts`));
  if (!genPath) return out;
  const gen = (await (GENS[genPath] as () => Promise<GenModule>)()).GEN;
  out.push({ label: 'generated family', specs: gen });
  const patchPath = Object.keys(PATCHES).find((p) => p.endsWith(`/${id}.patch.ts`));
  if (patchPath) {
    const patch = (await (PATCHES[patchPath] as () => Promise<PatchModule>)()).PATCH;
    out.push({ label: `family + patch (${patchPath.split('/').slice(-2).join('/')}${WIRING.some((w) => w.endsWith(`/${id}.family.ts`)) ? ', wired' : ', not wired'})`, specs: applyPatch(gen, patch) });
  }
  return out;
}

interface Band {
  name: string;
  color?: readonly number[];
  blend?: string;
  occlude?: number;
  bright?: number;
}

/** the base element plus each grade band that overrides colour / blend / occlude / bright, with the base values inherited */
function bands(el: ElementSpec): Band[] {
  const base = el as unknown as { color?: readonly number[]; blend?: string; occlude?: number; bright?: number; grade?: Record<string, Partial<Band>> };
  const out: Band[] = [{ name: 'base', color: base.color, blend: base.blend, occlude: base.occlude, bright: base.bright }];
  for (const [g, b] of Object.entries(base.grade ?? {})) {
    out.push({ name: g, color: b.color ?? base.color, blend: b.blend ?? base.blend, occlude: b.occlude ?? base.occlude, bright: b.bright ?? base.bright });
  }
  return out;
}

const luma709 = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** the strongest darkening of an alpha band: the worst sample of the colour curve (its own evalColor), or null when none is visible */
function worstPull(color: readonly number[], bright: number): { t: number; hex: number; luma: number; alpha: number; pull: number } | null {
  let worst: { t: number; hex: number; luma: number; alpha: number; pull: number } | null = null;
  const rgba = [0, 0, 0, 0];
  for (let i = 0; i < SAMPLES; i++) {
    const t = i / (SAMPLES - 1);
    evalColor(color as number[], t, rgba);
    const [r, g, b, a] = rgba as [number, number, number, number];
    if (a <= DARK_MIN_ALPHA) continue;
    const luma = luma709(r, g, b) * bright;
    const pull = a * Math.max(0, DARK_REF_LUMA - luma);
    if (worst === null || pull > worst.pull) {
      const hex = (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
      worst = { t: Math.round(t * 100) / 100, hex, luma, alpha: a, pull };
    }
  }
  return worst;
}

/** why this spec darkens the caster (empty = it does not) */
function darkeningIssues(spec: FxSpec): string[] {
  const issues: string[] = [];
  const specOcc = spec.occlude ?? 0;
  if (specOcc > MAX_OCCLUDE) issues.push(`${spec.id}: spec occlude ${specOcc} > ${MAX_OCCLUDE} (darkens what is behind the effect, the caster included)`);
  const lists: [string, readonly ElementSpec[]][] = [['elements', spec.elements ?? []], ['impact', spec.impact ?? []]];
  for (const [listName, list] of lists) {
    list.forEach((el, i) => {
      const where = `${spec.id} ${listName}[${i}]${(el as { key?: string }).key ? ` (${(el as { key?: string }).key})` : ''}`;
      for (const b of bands(el)) {
        const occ = b.occlude ?? 0;
        if (occ > MAX_OCCLUDE) issues.push(`${where} ${b.name}: occlude ${occ} > ${MAX_OCCLUDE} (soft dark core behind the light)`);
        if ((b.blend ?? 'add') === 'add' || !b.color) continue; // additive (an unset blend is additive): cannot darken
        if (spec.tint === true) {
          issues.push(`${where} ${b.name}: alpha element in a tint template (the run-time palette multiplies its colour keys: a dark palette darkens it); guarded skills stay untinted`);
          continue;
        }
        const w = worstPull(b.color, b.bright ?? 1);
        if (w !== null && w.pull > MAX_PULL) {
          issues.push(
            `${where} ${b.name}: darkening alpha, t=${w.t} drawn 0x${w.hex.toString(16).padStart(6, '0')} (luma ${w.luma.toFixed(2)}${b.bright !== undefined && b.bright !== 1 ? `, bright ${b.bright}` : ''}) at alpha ${w.alpha.toFixed(2)}: pull ${w.pull.toFixed(3)} > ${MAX_PULL}`,
          );
        }
      }
    });
  }
  return issues;
}

describe('no caster darkening (caster silhouette stays legible)', () => {
  const sources = new Map<GuardedId, Source[]>();
  beforeAll(async () => {
    // the class packs are lazy chunks since S0b: load them all, then read what ships
    await ensureAllSkillVfx();
    for (const id of GUARDED) sources.set(id, await collect(id));
  });
  afterAll(() => sources.clear());

  for (const id of GUARDED) {
    describe(`sk.${id}`, () => {
      test('the guard sees the hand spec of the skill and what ships', () => {
        const srcs = sources.get(id) as Source[];
        const hand = srcs.find((s) => s.label === 'hand spec') as Source;
        expect(hand.specs.map((s) => s.id), `no hand spec sk.${id}: renamed? update GUARDED / HAND in this test`).toContain(`sk.${id}`);
        const ships = srcs.find((s) => s.label === 'registry (ships)') as Source;
        expect(ships.specs.map((s) => s.id), `sk.${id} is not in the loaded registry: the guard reads nothing that ships`).toContain(`sk.${id}`);
      });

      test('no element darkens the caster (hand spec, registry, registered / generated / patched family)', () => {
        const found: string[] = [];
        for (const src of sources.get(id) as Source[]) {
          for (const spec of src.specs) for (const msg of darkeningIssues(spec)) found.push(`[${src.label}] ${msg}`);
        }
        expect(found, `caster darkening is forbidden`).toEqual([]);
      });
    });
  }
});

// SKILL-LOGIC MOMENTS (DESIGN section 5 / 7): every look the redesigned shells, veils, companions and riders put on or near the hero. The guard
// reads the registry (what ships) and fails on the same two things as above: a darkening alpha element and any `occlude`. It selects by the
// `moment: true` flag, so a class builder's new `sk.<skill>.<moment>` is guarded the moment it is registered; the shared `sk.gen.*` ids are
// ALSO listed (COMMON_MOMENT_IDS) so removing one fails here instead of silently leaving the hero unguarded.
describe('moment specs (skill-logic: shared sk.gen.* moments and every class moment) never darken the hero', () => {
  let moments: FxSpec[] = [];
  beforeAll(async () => {
    await ensureAllSkillVfx();
    moments = SKILL_SPECS.filter((s) => s.moment === true);
  });

  test('the guard sees every shared moment of the registry', () => {
    const ids = new Set(moments.map((s) => s.id));
    expect(COMMON_MOMENT_IDS.filter((id) => !ids.has(id)), 'a shared moment is not registered as `moment: true`').toEqual([]);
    expect(COMMON_MOMENT_IDS.length).toBeGreaterThanOrEqual(9);
    for (const id of ["sk.gen.veil_ring_smoke", "sk.gen.ward_ring"]) expect(COMMON_MOMENT_IDS, `${id} dropped from the shared moment list`).toContain(id);
  });

  // class moments A (warrior / ninja / wolfman): listed so removing one fails here instead of silently leaving the hero unguarded
  test('the guard sees every warrior / ninja / wolfman moment and marker of the registry (graniteform, war_oath, stealth, swallows_gait, eagle_eye, spirit_wolves, redmane_spirit)', () => {
    const ids = new Set(moments.map((s) => s.id));
    const listed = [...WARRIOR_MOMENT_IDS, ...NINJA_MOMENT_IDS, ...WOLFMAN_MOMENT_IDS];
    expect(listed.filter((id) => !ids.has(id)), 'a class A moment is not registered as `moment: true`').toEqual([]);
    for (const id of ['sk.graniteform.loop', 'sk.graniteform.shatter', 'sk.war_oath.save', 'sk.war_oath.guard', 'sk.swallows_gait.loop', 'sk.nightshroud.decoy', 'sk.nightshroud.burst', 'sk.eagle_eye.mark', 'sk.spirit_wolves.pounce', 'sk.redmane_spirit.bite', // fix round 2 (vfx critic): every new moment / marker id is named so dropping one fails
      'sk.graniteform.loop_worn', 'sk.warfever.loop', 'sk.warfever.kill', 'sk.warfever.nova', 'sk.war_oath.nova', 'sk.swallows_gait.nova', 'sk.eagle_eye.brand',
      'sk.redmane_spirit.loop', 'sk.redmane_spirit.kill', 'sk.redmane_spirit.nova', 'sk.blood_frenzy.loop', 'sk.blood_frenzy.kill', 'sk.blood_frenzy.nova',
      'sk.moonmane_spirit.loop', 'sk.moonmane_spirit.nova',
    ]) {
      expect(listed, `${id} dropped from the class A moment lists`).toContain(id);
    }
  });

  // class moments B (yacha / shaman): listed here too (captures step); umbral_plate / obsidian_bulwark casts are in GUARDED above
  test('the guard sees every yacha / shaman moment and marker of the registry (umbral_plate, obsidian_bulwark, cursed_legion, dark_covenant, blaze_familiars parts, reflect, blessing, stormglass_shell, thunder_guardians, wyrm_retinue breath)', () => {
    const ids = new Set(moments.map((s) => s.id));
    const listed = [...YACHA_MOMENT_IDS, ...SHAMAN_MOMENT_IDS];
    expect(listed.filter((id) => !ids.has(id)), 'a class B moment is not registered as `moment: true`').toEqual([]);
    for (const id of [
      'sk.umbral_plate.loop', 'sk.umbral_plate.burst', 'sk.obsidian_bulwark.loop', 'sk.obsidian_bulwark.burst', 'sk.cursed_legion.rise', 'sk.dark_covenant.pay', 'sk.unbinding_sigil.purge',
      'sk.blaze_familiars.cast', 'sk.blaze_familiars.explode', 'sk.mirror_shell.loop', 'sk.mirror_shell.burst', 'sk.mirror_shell.turn', 'sk.radiant_favor.loop', 'sk.stormglass_shell.loop', 'sk.stormglass_shell.pulse',
      'sk.thunder_guardians.plant', 'sk.thunder_guardians.arc', 'sk.thunder_guardians.blink', 'sk.wyrm_retinue.breath', 'sk.sovereigns_ire.descent',
      'sk.stormglass_shell.nova', 'sk.surging_arms.nova', 'sk.tailwind.nova',
    ]) {
      expect(listed, `${id} dropped from the class B moment lists`).toContain(id);
    }
  });

  test('no moment element darkens the caster (alpha pull / occlude, base and every grade band)', () => {
    const found: string[] = [];
    for (const spec of moments) for (const msg of darkeningIssues(spec)) found.push(msg);
    expect(found, 'a moment is a hero-attached look: additive or clamp only (caster darkening is forbidden)').toEqual([]);
  });

  test('a moment that darkens is flagged (the block detects)', () => {
    const base = moments[0] as FxSpec;
    const bad = { ...base, elements: [...base.elements, { kind: 'particle', cycle: 0.5, max: 2, rate: [0, 10], life: [0, 0.5], half: [0, 1], color: [0, 0x101018, 0.7, 1, 0x101018, 0], billboard: 'screen', blend: 'alpha', tex: 'smoke2' } as unknown as ElementSpec] };
    expect(darkeningIssues(bad).join(String.fromCharCode(10))).toMatch(/darkening alpha/);
  });
});

describe('the detector detects (synthetic specs, so a silent regression of the checker itself fails here)', () => {
  const vanishingLeap = SHADOW_SPECS.find((s) => s.id === 'sk.vanishing_leap') as FxSpec;
  const shadowClone = SHADOW_SPECS.find((s) => s.id === 'sk.shadow_clone') as FxSpec;
  const veil = (color: readonly number[], extra: Record<string, unknown> = {}): ElementSpec =>
    ({
      kind: 'particle',
      note: 'MUTATION: veil on the caster',
      cycle: 0.5,
      max: 4,
      rate: [0, 10],
      life: [0, 0.6],
      half: [0, 1],
      color,
      billboard: 'screen',
      blend: 'alpha',
      tex: 'smoke2',
      ...extra,
    }) as unknown as ElementSpec;
  const withEl = (el: ElementSpec, over: Partial<FxSpec> = {}): FxSpec => ({ ...vanishingLeap, ...over, elements: [...vanishingLeap.elements, el] });
  const flagged = (spec: FxSpec): string => darkeningIssues(spec).join('\n');

  test('the live hand specs are clean (vanishing_leap, seeking_stars, shadow_clone)', () => {
    expect(darkeningIssues(vanishingLeap)).toEqual([]);
    expect(darkeningIssues(BLADE_SPECS.find((s) => s.id === 'sk.seeking_stars') as FxSpec)).toEqual([]);
    expect(darkeningIssues(shadowClone)).toEqual([]);
  });
  test('a near-black alpha body is flagged', () => {
    expect(flagged(withEl(veil([0, 0x101010, 0, 0.3, 0x0a0a14, 0.6, 1, 0x101018, 0])))).toMatch(/darkening alpha/);
  });
  test('the old shadow_clone body (the bug copy, 0x140826 / 0x24104a at alpha 0.6 / 0.4) is flagged', () => {
    const old = veil([0, 0x1a0830, 0, 0.2, 0x140826, 0.6, 0.7, 0x24104a, 0.4, 1, 0x2a0f50, 0]);
    expect(flagged(withEl(old))).toMatch(/darkening alpha/);
  });
  test('a dark but saturated veil (the converter DESTALPHA cloud colours, max channel above 0x50) is flagged', () => {
    expect(flagged(withEl(veil([0, 0x241daa, 0, 0.1, 0x241daa, 0.85, 0.8, 0x241daa, 0.85, 1, 0x241daa, 0])))).toMatch(/darkening alpha/);
    expect(flagged(withEl(veil([0, 0x4b1aea, 1, 0.8, 0x2a1580, 0.9, 1, 0x2a1580, 0])))).toMatch(/darkening alpha/);
  });
  test('bright < 1 on an alpha element darkens it and is flagged (a white veil drawn at 12 % brightness)', () => {
    expect(flagged(withEl(veil([0, 0xffffff, 0, 0.1, 0xffffff, 0.8, 1, 0xffffff, 0], { bright: 0.12 })))).toMatch(/bright 0\.12/);
  });
  test('an alpha element of a tint template is flagged (the palette multiplies it at run time)', () => {
    expect(flagged(withEl(veil([0, 0x40ff40, 0, 0.1, 0x40ff40, 0.75, 1, 0x40ff40, 0]), { tint: true }))).toMatch(/tint template/);
  });
  test('a blend value other than add is drawn as alpha and is checked (a patch that clears blend leaves the additive default)', () => {
    const black = [0, 0x0a0a14, 0.8, 1, 0x0a0a14, 0.8];
    expect(flagged(withEl(veil(black, { blend: 'multiply' })))).toMatch(/darkening alpha/);
    expect(darkeningIssues(withEl(veil(black, { blend: undefined })))).toEqual([]); // withDefaults: unset = additive
  });
  test('a dark mid-life between two keys that each look fine is flagged (the curve is sampled, not only its keys)', () => {
    expect(flagged(withEl(veil([0, 0x000000, 0.08, 1, 0x5a5a5a, 1])))).toMatch(/darkening alpha/);
  });
  test('a near-black key inside a grade band is flagged', () => {
    const first = vanishingLeap.elements[0] as ElementSpec;
    const withBand = { ...first, blend: 'alpha', grade: { g3: { color: [0, 0x180830, 0.5, 1, 0x180830, 0] } } } as unknown as ElementSpec;
    const mutated: FxSpec = { ...vanishingLeap, elements: [withBand] };
    expect(flagged(mutated)).toMatch(/g3: darkening alpha/);
  });
  test('occlude on the spec or on an element is flagged', () => {
    expect(flagged({ ...vanishingLeap, occlude: 0.5 })).toMatch(/spec occlude 0\.5/);
    const first = vanishingLeap.elements[0] as ElementSpec;
    const mutated: FxSpec = { ...vanishingLeap, elements: [{ ...first, occlude: 0.5 } as ElementSpec] };
    expect(flagged(mutated)).toMatch(/base: occlude 0\.5/);
  });
  test('legit alpha smoke, invisible dark end keys and additive near-black are not flagged', () => {
    // the V1 shadow_clone body: translucent deep violet at mid luminance
    expect(darkeningIssues(withEl(veil([0, 0x5a44b0, 0, 0.2, 0x6850c8, 0.3, 0.7, 0x7a60dc, 0.24, 1, 0x7a60dc, 0])))).toEqual([]);
    // dark keys only where the element is invisible (alpha 0 at both ends), the fade-in passes through a mid colour
    expect(darkeningIssues(withEl(veil([0, 0x101010, 0, 0.3, 0x6850c8, 0.3, 1, 0x101010, 0])))).toEqual([]);
    // additive black adds nothing
    expect(darkeningIssues(withEl(veil([0, 0x101010, 0, 0.3, 0x0a0a14, 0.6, 1, 0x101018, 0], { blend: 'add' })))).toEqual([]);
  });
});
