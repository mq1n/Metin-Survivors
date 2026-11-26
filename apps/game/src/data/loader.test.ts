import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assertContent, BAND_LENGTH, content, loadContent, RUN_LENGTH, validateContent, WAVE_THRESHOLDS, type AssetIndex } from './loader';
import {
  AFFIX_KINDS,
  DEFAULT_AFFIXES,
  DEFAULT_OVERFLOW,
  DEFAULT_RUN_EVENTS,
  EDICT_MAX,
  GEAR_SLOTS,
  RARITIES,
  RUN_EVENT_KINDS,
  resolveAffixes,
  resolveChest,
  resolveEdict,
  resolveHardMuls,
  resolveOverflow,
  resolvePacts,
  resolveRunEvents,
  resolveZoneMuls,
  runEventKindsOf,
  type BehaviorKind,
  type ContentDB,
} from './schema';
import { buildContentIndex, zoneEventKinds } from '../sim/content';
import { SKILL_SPECS } from '../vfx/skills';
import { ensureAllSkillVfx } from '../vfx/skills/loader';

// the class specs are lazy chunks (vfx/skills/loader.ts): load them all before this file reads the registry
await ensureAllSkillVfx();

const here = dirname(fileURLToPath(import.meta.url));
const gameRoot = resolve(here, '../..');

// --- asset indexes derived from what actually exists in the repo -------------------------------------------------------

const VFX_SUFFIXES = new Set(['physical', 'fire', 'ice', 'lightning', 'dark', 'poison', 'holy', 'wind', 'gold', 'white', 'green', 'purple', 'yacha', 'flame', 'blue', 'dragon', 'red', 'indigo']);

/** `base[.variant]` ids from the VFX README table (the registry test in src/vfx keeps README and registry identical) */
function vfxChecker(): (id: string) => boolean {
  const readme = readFileSync(resolve(gameRoot, 'src/vfx/presets/README.md'), 'utf8');
  const bases = new Map<string, boolean>();
  for (const line of readme.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cols = line.split('|').map((c) => c.trim());
    const variantable = cols[2] === 'V';
    for (const m of (cols[1] ?? '').matchAll(/`([a-z0-9_.]+)`/g)) bases.set(m[1] as string, variantable);
  }
  const skillSpecs = new Set(SKILL_SPECS.map((s) => s.id));
  return (id) => {
    // skill spec presets are documented by their FxSpec (src/vfx/spec/README.md), not by the README table
    if (id.startsWith('sk.')) return skillSpecs.has(id);
    if (bases.has(id)) return true;
    const i = id.lastIndexOf('.');
    return i > 0 && bases.get(id.slice(0, i)) === true && VFX_SUFFIXES.has(id.slice(i + 1));
  };
}

interface ManifestIds {
  models?: Set<string>;
  icons?: Set<string>;
  textures?: Set<string>;
  audio: Set<string>;
}

function manifestIds(): ManifestIds {
  const dir = resolve(gameRoot, 'public/assets');
  const out: ManifestIds = { audio: new Set() };
  const read = (p: string): Record<string, unknown> | null => (existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>) : null);
  const merged = read(resolve(dir, 'manifest.json'));
  const part = (name: string): Record<string, unknown> | null => read(resolve(dir, 'manifest', `${name}.json`));
  const take = (key: 'models' | 'icons' | 'textures' | 'audio', partName: string): Set<string> | undefined => {
    const fromMerged = merged?.[key];
    const src = (fromMerged && typeof fromMerged === 'object' ? fromMerged : part(partName)) as Record<string, unknown> | null;
    return src ? new Set(Object.keys(src)) : undefined;
  };
  out.models = take('models', 'models');
  out.icons = take('icons', 'icons');
  out.textures = take('textures', 'textures');
  const audio = take('audio', 'audio');
  if (audio) audio.forEach((id) => out.audio.add(id));
  // SFX files exist before the manifest part is merged: ids are `<id>[_NN].<hash>.mp3`, group id = id without `_NN`
  const sfxDir = resolve(dir, 'audio/sfx');
  if (existsSync(sfxDir)) {
    for (const f of readdirSync(sfxDir)) {
      const id = f.replace(/\.[0-9a-f]{8}\.mp3$/, '');
      out.audio.add(id);
      out.audio.add(id.replace(/_\d\d$/, ''));
    }
  }
  return out;
}

function sfxIdsUsed(): string[] {
  const ids = new Set<string>();
  const add = (id: string | undefined): void => {
    if (id?.startsWith('sfx_')) ids.add(id);
  };
  for (const s of content.skills) add(s.sfx);
  for (const e of [...content.enemies, ...content.bosses]) {
    add(e.sfx?.hit);
    add(e.sfx?.death);
    add(e.sfx?.attack);
  }
  for (const b of content.bosses) for (const p of b.patterns) add(p.sfx);
  return [...ids];
}

// ---------------------------------------------------------------------------------------------------------------------

describe('content database', () => {
  it('loads and validates (structure + cross-references)', () => {
    const db = loadContent();
    expect(db).toBe(content);
    const rep = validateContent(db);
    expect(rep.errors).toEqual([]);
    expect(() => assertContent(db)).not.toThrow();
  });

  it('every VFX preset id resolves against the VFX catalogue and every SFX id against the audio files', () => {
    const ids = manifestIds();
    const assets: AssetIndex = { vfx: vfxChecker(), audio: ids.audio };
    // music ids are produced later than SFX: only check what exists today as errors (sfx), music as warnings
    const rep = validateContent(content, { assets, strict: { vfx: true, audio: false } });
    expect(rep.errors).toEqual([]);
    const missingSfx = rep.warnings.filter((w) => w.includes("audio '") && w.includes("'sfx_"));
    expect(missingSfx).toEqual([]);
    expect(sfxIdsUsed().length).toBeGreaterThan(20);
  });

  it('reports missing models/icons/textures only as warnings in dev mode', () => {
    const rep = validateContent(content, { assets: { models: new Set(), icons: new Set(), textures: new Set() } });
    expect(rep.errors).toEqual([]);
    expect(rep.warnings.some((w) => w.startsWith('assets:'))).toBe(true);
    const strict = validateContent(content, { assets: { models: new Set() }, strict: true });
    expect(strict.errors.some((e) => e.startsWith('assets:'))).toBe(true);
  });

  it('has the roster the design promises', () => {
    expect(content.classes.map((c) => c.id)).toEqual(['warrior', 'ninja', 'yacha', 'shaman', 'wolfman']);
    expect(content.talents).toHaveLength(10);
    expect(content.zones.map((z) => z.id)).toEqual(['yeonmu', 'suryeon', 'seori', 'daeryeol']);
    expect(content.empires.map((e) => e.id).sort()).toEqual(['chowon', 'jihae', 'saehwa']);
    expect(content.passives.length).toBeGreaterThanOrEqual(15);
    expect(content.stones.length).toBeGreaterThanOrEqual(15);
    expect(content.trinkets.length).toBeGreaterThanOrEqual(9);
    expect(content.skills.filter((s) => s.kind === 'ultimate')).toHaveLength(30);
    expect(content.skills.filter((s) => s.kind === 'basic')).toHaveLength(10);
    for (const c of content.classes) {
      expect(c.doctrines[0].skills).toHaveLength(7);
      expect(c.doctrines[1].skills).toHaveLength(7);
    }
    const wolfman = content.classes.find((c) => c.id === 'wolfman');
    expect(wolfman?.sexes).toEqual(['m']);
    expect(Object.keys(wolfman?.models ?? {})).toEqual(['m']);
  });

  it('keeps the creature model economy (<= 87 distinct creature/boss models: 43 + the five dedicated wolf models + the ten Tripo albedo-variant models of the Yeonmu wave + hungry_tiger and cursed_bear of the W1 polish + the Suryeon wave: high_executioner, inquisitor x3, high_zealot, ascetic_fighter x2, conjurer_high, three orc sorcerer variants, and the five dedicated boar builds + the Seori wave: angry_shambling_corpse and frost_wisp_mean + the Daeryeol wave: ash_wisp_strong, ash_wisp_boss and blaze_tiger_armored + the Seori plague completion: blighted_swordsman_angry, blighted_spearman, blighted_spearman_angry and blighted_marshal_boss + the F4 Seori motion-fix round: angry_blighted_hound and ice_golem_heart) and shares models across variants', () => {
    const models = new Set([...content.enemies, ...content.bosses].map((e) => e.model));
    expect(models.size).toBeLessThanOrEqual(87);
    expect(content.enemies.length).toBeGreaterThan(models.size * 1.3); // 114 enemies / 87 models after the F4 Seori motion-fix round (1.31: angry_blighted_hound and ice_golem_heart are own albedo / gait builds); 114 / 85 after the Seori plague completion (1.34, ratio loosened 1.4 -> 1.3 on purpose: +4 own models for the swordsman / spearman / leader variants); 114 / 81 after the W4 Daeryeol wave (1.41; 114 / 78 after the W3 Seori wave (1.46; 114 / 76 after the W2 wave (was 1.8: 114 / 60 after the W1 polish, 1.9: 114 / 58, 2.0: 114 / 48)
  });

  it('gives every canine variant its dedicated model and recolours only where the model cannot carry the look', () => {
    const e = (id: string) => content.enemies.find((x) => x.id === id);
    for (const id of ['alpha_wolf', 'blue_wolf', 'alpha_blue_wolf', 'grey_wolf', 'alpha_grey_wolf']) {
      expect(e(id)?.model, id).toBe(id);
      expect(e(id)?.tint, id).toBeUndefined();
    }
    expect(content.bosses.find((b) => b.id === 'boss_chan_dae')?.model).toBe('alpha_blue_wolf');
    // the Yeonmu wave: a baked albedo variant per look that a tint cannot carry (white tigers, bears, the hungry dog / alpha, craven soldier), colorize on the shared donors
    for (const id of ['white_tiger', 'hungry_white_tiger', 'cursed_white_tiger', 'brown_bear', 'grizzly_bear', 'craven_silver_vow_soldier', 'hungry_tiger']) {
      expect(e(id)?.model, id).toBe(id);
      if (id !== 'craven_silver_vow_soldier') expect(e(id)?.tint, id).toBeUndefined();
    }
    // W2 must-fix: the craven soldier has its own model but read as the oath soldier in game, a cool multiply tint (not colorize) tells them apart
    expect(e('craven_silver_vow_soldier')?.tint).toBeDefined();
    expect(e('craven_silver_vow_soldier')?.tintMode).toBeUndefined();
    expect(e('hungry_stray_dog')?.model).toBe('hungry_wild_dog');
    expect(e('hungry_alpha_wolf')?.model).toBe('alpha_wolf_hungry');
    expect(content.bosses.find((b) => b.id === 'boss_ung_jae')?.model).toBe('elder_bear');
    for (const id of ['hungry_wolf', 'black_bear', 'hungry_grizzly', 'hungry_blue_wolf', 'hungry_grey_wolf', 'hungry_alpha_grey_wolf', 'cursed_alpha_grey_wolf']) expect(e(id)?.tintMode, id).toBe('colorize');
    expect(e('cursed_brown_bear')?.model).toBe('cursed_bear'); // W1 polish r2: a baked dusk-plum bear with pale tan paws instead of the magenta colorize of the grizzly
    expect(e('angry_blighted_hound')?.model).toBe('angry_blighted_hound'); // F4 Seori round: an own albedo build (dark crimson hide, brighter flayed head), a colorize tint turned head and body one rose-maroon
  });

  it('gives every zone contiguous time bands over the full run, four timed bosses and a final with a Great Metin', () => {
    for (const z of content.zones) {
      expect(z.bands[0]?.from).toBe(0);
      for (let i = 1; i < z.bands.length; i++) expect(z.bands[i]?.from).toBe(z.bands[i - 1]?.to);
      expect(z.bands.at(-1)?.to).toBe(RUN_LENGTH);
      expect(z.bands).toHaveLength(RUN_LENGTH / BAND_LENGTH);
      expect(z.bosses.map((b) => b.at)).toEqual([180, 360, 540, 720]);
      expect(z.final.at).toBe(RUN_LENGTH);
      expect(content.metins.find((m) => m.id === z.final.greatMetin)?.great).toBe(true);
      expect(z.metins.firstAt).toBeLessThanOrEqual(120);
      const rates = z.bands.map((b) => b.rate);
      expect([...rates].sort((a, b) => a - b)).toEqual(rates);
    }
  });

  it('puts every enemy, boss and metin in the bestiary and every L10n pair in both languages', () => {
    const ids = new Set(content.story.codex.map((c) => c.id));
    for (const e of content.enemies) expect(ids.has(`codex_enemy_${e.id}`), e.id).toBe(true);
    for (const b of content.bosses) expect(ids.has(`codex_boss_${b.id}`), b.id).toBe(true);
    for (const m of content.metins) expect(ids.has(`codex_metin_${m.id}`), m.id).toBe(true);
    for (const c of content.story.codex) {
      expect(c.title.tr.length).toBeGreaterThan(1);
      expect(c.text.en.length).toBeGreaterThan(20);
      expect(c.text.tr.length).toBeGreaterThan(20);
    }
  });

  it('numbers are finite and positive where required', () => {
    for (const e of [...content.enemies, ...content.bosses]) {
      for (const k of ['hp', 'speed', 'radius', 'mass', 'scale'] as const) expect(Number.isFinite(e[k]) && e[k] > 0, `${e.id}.${k}`).toBe(true);
      expect(Number.isFinite(e.damage) && e.damage > 0, `${e.id}.damage`).toBe(true);
      expect(e.yeop[1]).toBeGreaterThanOrEqual(e.yeop[0]);
    }
    for (const s of content.skills) for (const [k, v] of Object.entries(s.params)) if (typeof v === 'number') expect(Number.isFinite(v) && v >= 0, `${s.id}.${k}`).toBe(true);
    expect(Object.keys(content.balance.rarityWeights)).toEqual([...RARITIES]);
  });

  it('boss and final HP climb along the progression ladder', () => {
    const hp = (id: string): number => content.bosses.find((b) => b.id === id)?.hp ?? 0;
    const finals = content.zones.map((z) => hp(z.final.boss));
    expect([...finals].sort((a, b) => a - b)).toEqual(finals);
    for (const z of content.zones) {
      const timed = z.bosses.map((b) => hp(b.boss));
      expect([...timed].sort((a, b) => a - b)).toEqual(timed);
      expect(hp(z.final.boss)).toBeGreaterThan((timed.at(-1) ?? 0) * 1.5);
    }
  });

  it('adopts the HP-threshold waves (22 groups per stone)', () => {
    for (const m of content.metins) {
      const groups = WAVE_THRESHOLDS.reduce((s, t) => s + (m.modParams[`wave_${t}`] ?? 0), 0);
      expect(groups, m.id).toBe(22);
      expect(m.modParams.wave_99).toBe(1);
      expect(m.modParams.wave_10).toBe(3);
    }
  });

  it('covers 8 gear slots x 4 tiers for every class and never reuses an icon id', () => {
    for (const c of content.classes) {
      for (const slot of GEAR_SLOTS) {
        for (let t = 1; t <= 4; t++) {
          expect(content.gear.some((g) => g.slot === slot && g.tier === t && g.classes.includes(c.id)), `${c.id}/${slot}/${t}`).toBe(true);
        }
      }
    }
    const icons = [
      ...content.skills.map((s) => s.icon),
      ...content.passives.map((s) => s.icon),
      ...content.stones.map((s) => s.icon),
      ...content.trinkets.map((s) => s.icon),
      ...content.gear.map((s) => s.icon),
      ...content.talents.flatMap((t) => t.nodes.map((n) => n.icon)),
    ];
    expect(new Set(icons).size).toBe(icons.length);
  });

  it('gives every talent tree room for 30 points with row gates and three milestone ultimates', () => {
    for (const t of content.talents) {
      expect(t.nodes).toHaveLength(15);
      expect(t.nodes.reduce((s, n) => s + n.max, 0)).toBeGreaterThanOrEqual(30);
      expect(t.milestones.map((m) => m.at)).toEqual([10, 20, 30]);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// A0-DATA: the roguelite data contract. Every new field is optional, absent = default = today, nothing reads it yet.

/** the behavior -> pact passive table of the R1 design (every BehaviorKind mapped, passive ids that exist) */
const PACT_TABLE: Record<BehaviorKind, string> = {
  meleeArc: 'sovereign_wrath',
  cone: 'sovereign_wrath',
  spinAura: 'quickening',
  orbit: 'quickening',
  persistentAura: 'sovereign_eyes',
  skyStrike: 'sovereign_eyes',
  dash: 'saddlecraft',
  groundZone: 'saddlecraft',
  selfBuff: 'saddlecraft',
  projectile: 'follow_through',
  homingProjectile: 'true_flight',
  beam: 'swift_invocation',
  chain: 'swift_invocation',
  leap: 'sovereign_blood',
  shockwave: 'sanctified_mail',
  summon: 'marshals_voice',
};

const cloneDb = (): ContentDB => structuredClone(content);
const errorsOf = (db: ContentDB): string[] => validateContent(db).errors;
/** content with every new roguelite field removed (what a build from before the contract looks like) */
function stripped(): ContentDB {
  const db = cloneDb();
  delete db.runEvents;
  delete db.affixes;
  delete db.balance.pacts;
  delete db.balance.chest;
  delete db.balance.overflow;
  for (const k of ['awakenMul', 'eliteEveryMul', 'finalEnrageMul'] as const) delete db.balance.hard[k];
  for (const z of db.zones) {
    delete z.xpMul;
    delete z.hard;
    delete z.final.hpMul;
  }
  for (const e of db.empires) delete e.edict;
  return db;
}
/** content with every new field present, valid, and every system switched on */
function populated(): ContentDB {
  const db = cloneDb();
  db.balance.pacts = { rank: 2, byBehavior: { ...PACT_TABLE }, readyWeight: 2 };
  db.balance.chest = { eliteDrop: 0.06, cards: 4, bossMilestone: true };
  db.balance.overflow = { shards: true, boon: true, shardsByRarity: [1, 2, 3, 4, 5], boonDamage: 0.04, boonHp: 0.03, skipRefund: 1 };
  db.balance.hard = { ...db.balance.hard, awakenMul: 0.67, eliteEveryMul: 0.75, finalEnrageMul: 0.8 };
  const [yeonmu, suryeon] = db.zones;
  if (!yeonmu || !suryeon) throw new Error('zones');
  yeonmu.xpMul = 1;
  suryeon.xpMul = 1.25;
  suryeon.final.hpMul = 0.8;
  suryeon.hard = { awakenMul: 0.5, finalEnrageMul: 0.9 };
  db.empires[0]!.edict = { skips: 1 };
  db.empires[1]!.edict = { rerolls: 1, banishes: 0 };
  db.empires[2]!.edict = { banishes: 2 };
  db.runEvents = {
    ...structuredClone(DEFAULT_RUN_EVENTS),
    zones: { yeonmu: ['metinRain', 'championHunt', 'goldenHour'], suryeon: ['bargain'] },
  };
  db.affixes = { ...structuredClone(DEFAULT_AFFIXES), enabled: true, bossOnHard: true, bossKinds: ['swift'] };
  return db;
}

describe('roguelite data contract: absent = default = today', () => {
  it('ships the two new content files with every system off, except the awakening pacts (OF-01), the overflow cards (OF-03) and the boss milestones (OF-04)', () => {
    expect(content.runEvents).toBeDefined();
    expect(content.affixes).toBeDefined();
    expect(content.runEvents?.zones).toEqual({});
    expect(content.affixes?.enabled).toBe(false);
    // OF-01 ships the awakening pacts ON (rank 4, readyWeight 1; the passive must be held at 4 of its max 4-5 ranks), OF-03 the overflow cards (shards 1-4 by rarity, the Boon, a 1-shard skip refund; the rest of the table is the
    // schema default); OF-04 ships the boss milestones ON and nothing else of the chest block (3 cards a chest, the 12 % elite drop; PC-06 / A0-DATA values until then)
    expect(resolvePacts(content.balance.pacts).rank).toBe(4);
    expect(resolvePacts(content.balance.pacts).readyWeight).toBe(1);
    expect(content.balance.overflow).toEqual({ shards: true, boon: true, shardsByRarity: [1, 1, 2, 3, 4], skipRefund: 1 });
    expect(content.balance.chest).toEqual({ bossMilestone: true });
    expect(resolveChest(content.balance)).toEqual({ eliteDrop: 0.12, cards: content.balance.cardsPerLevel, bossMilestone: true });
    // PC-03 ships the gem-xp multiplier of zones 2-4 ON (a nudge above 1 that rises with the zone, see sim/__tests__/zoneParity.test.ts); Yeonmu and every other zone field stays absent
    let xpBefore = 1;
    for (const z of content.zones) {
      if (z.id === 'yeonmu') expect(z.xpMul, z.id).toBeUndefined();
      else {
        expect(z.xpMul, z.id).toBeGreaterThan(1);
        expect(z.xpMul, z.id).toBeLessThanOrEqual(1.6);
        expect(z.xpMul as number, z.id).toBeGreaterThanOrEqual(xpBefore);
        xpBefore = z.xpMul as number;
      }
      // PC-04 ships the final boss's HP multiplier of every zone ON (a cut below 1 that keeps the finale a fight, see sim/__tests__/finalPace.test.ts)
      expect(z.final.hpMul, z.id).toBeGreaterThanOrEqual(0.5);
      expect(z.final.hpMul, z.id).toBeLessThan(1);
      expect(z.hard, z.id).toBeUndefined();
    }
    // DA-01 ships the empire edicts (one bounded +1 each); the other roguelite fields stay absent
    expect(Object.fromEntries(content.empires.map((e) => [e.id, resolveEdict(e)]))).toEqual({
      saehwa: { rerolls: 0, banishes: 0, skips: 1 },
      chowon: { rerolls: 1, banishes: 0, skips: 0 },
      jihae: { rerolls: 0, banishes: 1, skips: 0 },
    });
    for (const k of ['awakenMul', 'eliteEveryMul', 'finalEnrageMul'] as const) expect(content.balance.hard[k], k).toBeUndefined();
    expect(Object.keys(content.balance.hard).sort()).toEqual(['count', 'damage', 'hp', 'reward']);
  });

  it('keeps runEvents.json and affixes.json equal to the schema defaults', () => {
    expect(content.runEvents).toEqual(DEFAULT_RUN_EVENTS);
    expect(content.affixes).toEqual(DEFAULT_AFFIXES);
    expect(resolveRunEvents(content.runEvents)).toBe(content.runEvents);
    expect(resolveAffixes(content.affixes)).toBe(content.affixes);
  });

  it('validates content that has none of the new fields (a build from before the contract)', () => {
    const db = stripped();
    expect(errorsOf(db)).toEqual([]);
    expect(() => assertContent(db)).not.toThrow();
  });

  it("resolves every absent field to today's value", () => {
    const db = stripped();
    expect(resolvePacts(db.balance.pacts)).toEqual({ rank: 0, byBehavior: {}, readyWeight: 1 });
    // a chest offers cardsPerLevel cards and elites drop one at 12 % until the content says otherwise
    expect(resolveChest(db.balance)).toEqual({ eliteDrop: 0.12, cards: db.balance.cardsPerLevel, bossMilestone: false });
    expect(resolveChest({ cardsPerLevel: 5 }).cards).toBe(5);
    // OF-04: the boss reward is today's offer until the content says milestone; an explicit false is the same as absent
    expect(resolveChest({ cardsPerLevel: 3, chest: { bossMilestone: false } })).toEqual({ eliteDrop: 0.12, cards: 3, bossMilestone: false });
    expect(resolveChest({ cardsPerLevel: 3, chest: { bossMilestone: true } }).bossMilestone).toBe(true);
    expect(resolveOverflow(db.balance.overflow)).toEqual({ shards: false, boon: false, shardsByRarity: [2, 3, 4, 5, 6], boonDamage: 0.03, boonHp: 0.02, skipRefund: 0 });
    expect(DEFAULT_OVERFLOW.shardsByRarity).toHaveLength(RARITIES.length);
    for (const z of db.zones) {
      expect(resolveHardMuls(db.balance, z), z.id).toEqual({ awakenMul: 1, eliteEveryMul: 1, finalEnrageMul: 1 });
      expect(resolveZoneMuls(z), z.id).toEqual({ xp: 1, finalHp: 1 });
    }
    for (const e of db.empires) expect(resolveEdict(e), e.id).toEqual({ rerolls: 0, banishes: 0, skips: 0 });
    expect(resolveEdict(undefined)).toEqual({ rerolls: 0, banishes: 0, skips: 0 });
    expect(resolveRunEvents(db.runEvents).zones).toEqual({});
    expect(resolveAffixes(db.affixes).enabled).toBe(false);
    expect(runEventKindsOf(undefined, 'yeonmu')).toEqual([]);
  });

  it('hands the resolved tables to the sim through the content index (no events, no affixes when absent)', () => {
    const ix = buildContentIndex(stripped());
    expect(ix.runEvents.zones).toEqual({});
    expect(ix.affixes.enabled).toBe(false);
    for (const z of content.zones) expect(zoneEventKinds(ix, z.id)).toEqual([]);
    const real = buildContentIndex(content);
    expect(real.runEvents).toBe(content.runEvents);
    expect(real.affixes).toBe(content.affixes);
  });

  it('does not mutate the shared defaults through the resolvers', () => {
    const o = resolveOverflow();
    o.shardsByRarity[0] = 99;
    expect(DEFAULT_OVERFLOW.shardsByRarity[0]).toBe(2);
    const p = resolvePacts({ byBehavior: { dash: 'saddlecraft' } });
    p.byBehavior.beam = 'swift_invocation';
    expect(resolvePacts().byBehavior).toEqual({});
  });
});

describe('roguelite data contract: valid values are accepted and read back', () => {
  it('accepts every new field at once with every system on', () => {
    const db = populated();
    expect(errorsOf(db)).toEqual([]);
    expect(() => assertContent(db)).not.toThrow();
    expect(resolvePacts(db.balance.pacts)).toEqual({ rank: 2, byBehavior: PACT_TABLE, readyWeight: 2 });
    expect(resolveChest(db.balance)).toEqual({ eliteDrop: 0.06, cards: 4, bossMilestone: true });
    expect(resolveOverflow(db.balance.overflow).shards).toBe(true);
    expect(resolveOverflow(db.balance.overflow).shardsByRarity).toEqual([1, 2, 3, 4, 5]);
    const suryeon = db.zones[1]!;
    // zone override first, then balance.hard, then 1
    expect(resolveHardMuls(db.balance, suryeon)).toEqual({ awakenMul: 0.5, eliteEveryMul: 0.75, finalEnrageMul: 0.9 });
    expect(resolveHardMuls(db.balance, db.zones[0])).toEqual({ awakenMul: 0.67, eliteEveryMul: 0.75, finalEnrageMul: 0.8 });
    expect(resolveZoneMuls(suryeon)).toEqual({ xp: 1.25, finalHp: 0.8 });
    expect(db.empires.map((e) => resolveEdict(e))).toEqual([
      { rerolls: 0, banishes: 0, skips: 1 },
      { rerolls: 1, banishes: 0, skips: 0 },
      { rerolls: 0, banishes: 2, skips: 0 },
    ]);
    const ix = buildContentIndex(db);
    expect(zoneEventKinds(ix, 'yeonmu')).toEqual(['metinRain', 'championHunt', 'goldenHour']);
    expect(zoneEventKinds(ix, 'suryeon')).toEqual(['bargain']);
    expect(zoneEventKinds(ix, 'seori')).toEqual([]);
    expect(ix.affixes.enabled).toBe(true);
  });

  it('accepts the boundary values of every range', () => {
    const db = populated();
    db.balance.pacts = { rank: 0 }; // off: no table needed
    db.balance.chest = { eliteDrop: 0, cards: 1, bossMilestone: false };
    db.balance.overflow = { shardsByRarity: [0, 0, 0, 0, 99], boonDamage: 0.5, boonHp: 0, skipRefund: 20 };
    db.zones[0]!.xpMul = 5;
    db.zones[0]!.final.hpMul = 0.01;
    db.empires[0]!.edict = { rerolls: EDICT_MAX, banishes: 0, skips: EDICT_MAX };
    db.runEvents = { ...structuredClone(DEFAULT_RUN_EVENTS), window: [0, 899], bossGap: 0, zones: { yeonmu: [...RUN_EVENT_KINDS] } };
    db.affixes = { ...structuredClone(DEFAULT_AFFIXES), fromBand: 4, weights: { swift: 0, vampiric: 0, warded: 0.5, splitting: 0 }, bossOnHard: false, bossKinds: [] };
    expect(errorsOf(db)).toEqual([]);
    db.balance.chest = { eliteDrop: 1, cards: 4, bossMilestone: true };
    db.runEvents.bossGap = 89;
    db.affixes.fromBand = 0;
    db.affixes.bossKinds = [...AFFIX_KINDS];
    db.affixes.bossOnHard = true;
    expect(errorsOf(db)).toEqual([]);
  });

  it('lets a pacts block with rank 0 (off) carry a partial or empty table, and rank > 0 only a complete one', () => {
    const db = cloneDb();
    db.balance.pacts = { rank: 0, byBehavior: { dash: 'saddlecraft' } };
    expect(errorsOf(db)).toEqual([]);
    db.balance.pacts = {};
    expect(errorsOf(db)).toEqual([]);
    db.balance.pacts = { rank: 2, byBehavior: { dash: 'saddlecraft' } };
    const e = errorsOf(db);
    expect(e.some((x) => x.includes("behavior 'meleeArc' has no pact passive"))).toBe(true);
    expect(e.filter((x) => x.includes('has no pact passive'))).toHaveLength(15);
  });

  it('covers every BehaviorKind in the design table with an existing passive (rank 2 is within every maxRank)', () => {
    const db = cloneDb();
    db.balance.pacts = { rank: 2, byBehavior: { ...PACT_TABLE } };
    expect(errorsOf(db)).toEqual([]);
    expect(Object.keys(PACT_TABLE).sort()).toEqual([...new Set(db.skills.map((s) => s.behavior))].sort());
  });
});

describe('roguelite data contract: invalid values are rejected with a named error', () => {
  /** [label, how to break a valid populated copy, a fragment the named error must contain] */
  const bad: [string, (db: ContentDB) => void, string][] = [
    // balance.pacts
    ['pacts not an object', (d) => void (d.balance.pacts = [] as never), 'balance.pacts: must be an object'],
    ['pacts unknown key', (d) => void ((d.balance.pacts as Record<string, unknown>).weight = 2), "balance.pacts: unknown key 'weight'"],
    ['pacts rank fraction', (d) => void (d.balance.pacts!.rank = 1.5), 'balance.pacts: rank must be an integer in [0, 10]'],
    ['pacts rank negative', (d) => void (d.balance.pacts!.rank = -1), 'balance.pacts: rank must be an integer in [0, 10]'],
    ['pacts rank too big', (d) => void (d.balance.pacts!.rank = 11), 'balance.pacts: rank must be an integer in [0, 10]'],
    ['pacts rank above the passive maxRank', (d) => void (d.balance.pacts!.rank = 6), 'exceeds the maxRank 5 of passive'],
    ['pacts rank above a low maxRank', (d) => void ((d.balance.pacts!.rank = 3), (d.balance.pacts!.byBehavior!.dash = 'waters_of_return')), "dash: rank 3 exceeds the maxRank 2 of passive 'waters_of_return'"],
    ['pacts readyWeight below 1', (d) => void (d.balance.pacts!.readyWeight = 0.5), 'readyWeight must be a number in [1, 20]'],
    ['pacts readyWeight above 20', (d) => void (d.balance.pacts!.readyWeight = 21), 'readyWeight must be a number in [1, 20]'],
    ['pacts readyWeight NaN', (d) => void (d.balance.pacts!.readyWeight = Number.NaN), 'readyWeight must be a number in [1, 20] (got NaN)'],
    ['pacts unknown behavior', (d) => void ((d.balance.pacts!.byBehavior as Record<string, string>).teleport = 'combo'), "unknown behavior 'teleport'"],
    ['pacts unknown passive', (d) => void (d.balance.pacts!.byBehavior!.beam = 'no_such_passive'), "beam: passive 'no_such_passive' unknown"],
    ['pacts byBehavior not an object', (d) => void (d.balance.pacts!.byBehavior = 'sovereign_wrath' as never), 'byBehavior must be an object'],
    ['pacts incomplete at rank > 0', (d) => void delete d.balance.pacts!.byBehavior!.summon, "behavior 'summon' has no pact passive"],
    // balance.chest
    ['chest unknown key', (d) => void ((d.balance.chest as Record<string, unknown>).perOpen = 22), "balance.chest: unknown key 'perOpen'"],
    ['chest eliteDrop above 1', (d) => void (d.balance.chest!.eliteDrop = 1.5), 'eliteDrop must be a number in [0, 1]'],
    ['chest eliteDrop negative', (d) => void (d.balance.chest!.eliteDrop = -0.1), 'eliteDrop must be a number in [0, 1]'],
    ['chest cards zero', (d) => void (d.balance.chest!.cards = 0), 'cards must be an integer in [1, 4]'],
    ['chest cards five', (d) => void (d.balance.chest!.cards = 5), 'cards must be an integer in [1, 4]'],
    ['chest cards fraction', (d) => void (d.balance.chest!.cards = 2.5), 'cards must be an integer in [1, 4]'],
    ['chest bossMilestone a string', (d) => void (d.balance.chest!.bossMilestone = 'yes' as never), 'bossMilestone must be true or false (got "yes")'],
    ['chest bossMilestone a number', (d) => void (d.balance.chest!.bossMilestone = 1 as never), 'bossMilestone must be true or false (got 1)'],
    ['chest bossMilestone null', (d) => void (d.balance.chest!.bossMilestone = null as never), 'bossMilestone must be true or false (got null)'],
    ['chest bossMilestone misspelt', (d) => void ((d.balance.chest as Record<string, unknown>).bossMilestones = true), "balance.chest: unknown key 'bossMilestones'"],
    // balance.overflow
    ['overflow unknown key', (d) => void ((d.balance.overflow as Record<string, unknown>).skipRefundShards = 1), "balance.overflow: unknown key 'skipRefundShards'"],
    ['overflow shards not a boolean', (d) => void (d.balance.overflow!.shards = 'yes' as never), 'shards must be true or false'],
    ['overflow boon not a boolean', (d) => void (d.balance.overflow!.boon = 1 as never), 'boon must be true or false'],
    ['overflow shardsByRarity too short', (d) => void (d.balance.overflow!.shardsByRarity = [2, 3, 4, 5]), 'shardsByRarity must be a list of 5 integers'],
    ['overflow shardsByRarity not a list', (d) => void (d.balance.overflow!.shardsByRarity = 3 as never), 'shardsByRarity must be a list of 5 integers'],
    ['overflow shardsByRarity negative', (d) => void (d.balance.overflow!.shardsByRarity![2] = -1), 'shardsByRarity[2] must be an integer in [0, 99]'],
    ['overflow shardsByRarity fraction', (d) => void (d.balance.overflow!.shardsByRarity![4] = 1.5), 'shardsByRarity[4] must be an integer in [0, 99]'],
    ['overflow boonDamage too big', (d) => void (d.balance.overflow!.boonDamage = 0.6), 'boonDamage must be a number in [0, 0.5]'],
    ['overflow boonHp negative', (d) => void (d.balance.overflow!.boonHp = -0.01), 'boonHp must be a number in [0, 0.5]'],
    ['overflow skipRefund too big', (d) => void (d.balance.overflow!.skipRefund = 21), 'skipRefund must be an integer in [0, 20]'],
    ['overflow skipRefund fraction', (d) => void (d.balance.overflow!.skipRefund = 0.5), 'skipRefund must be an integer in [0, 20]'],
    // balance.hard
    ['hard awakenMul zero', (d) => void (d.balance.hard.awakenMul = 0), 'balance.hard: awakenMul must be a number in (0, 5]'],
    ['hard eliteEveryMul above 5', (d) => void (d.balance.hard.eliteEveryMul = 6), 'balance.hard: eliteEveryMul must be a number in (0, 5]'],
    ['hard finalEnrageMul not a number', (d) => void (d.balance.hard.finalEnrageMul = 'x' as never), 'balance.hard: finalEnrageMul must be a number in (0, 5]'],
    ['hard unknown key', (d) => void ((d.balance.hard as Record<string, unknown>).awakenmul = 0.5), "balance.hard: unknown key 'awakenmul'"],
    ['hard base multiplier still required', (d) => void (d.balance.hard.reward = 0), 'hard.reward'],
    // zones
    ['zone xpMul zero', (d) => void (d.zones[1]!.xpMul = 0), "zone 'suryeon': xpMul must be a number in (0, 5]"],
    ['zone xpMul negative', (d) => void (d.zones[1]!.xpMul = -1), "zone 'suryeon': xpMul must be a number in (0, 5]"],
    ['zone xpMul above 5', (d) => void (d.zones[1]!.xpMul = 5.5), "zone 'suryeon': xpMul must be a number in (0, 5]"],
    ['zone xpMul string', (d) => void (d.zones[1]!.xpMul = '1.2' as never), "zone 'suryeon': xpMul must be a number in (0, 5]"],
    ['zone final.hpMul zero', (d) => void (d.zones[1]!.final.hpMul = 0), "zone 'suryeon': final.hpMul must be a number in (0, 5]"],
    ['zone final unknown key', (d) => void ((d.zones[1]!.final as Record<string, unknown>).hpmul = 0.8), "final: unknown key 'hpmul'"],
    ['zone hard awakenMul zero', (d) => void (d.zones[1]!.hard!.awakenMul = 0), "zone 'suryeon'.hard: awakenMul must be a number in (0, 5]"],
    ['zone hard unknown key', (d) => void ((d.zones[1]!.hard as Record<string, unknown>).hp = 2), "zone 'suryeon'.hard: unknown key 'hp'"],
    ['zone hard not an object', (d) => void (d.zones[1]!.hard = 0.8 as never), "zone 'suryeon'.hard: must be an object"],
    // empires
    ['edict skips above 2', (d) => void (d.empires[0]!.edict!.skips = 3), "empire 'saehwa'.edict: skips must be an integer in [0, 2]"],
    ['edict rerolls negative', (d) => void (d.empires[1]!.edict!.rerolls = -1), "empire 'chowon'.edict: rerolls must be an integer in [0, 2]"],
    ['edict banishes fraction', (d) => void (d.empires[2]!.edict!.banishes = 0.5), "empire 'jihae'.edict: banishes must be an integer in [0, 2]"],
    ['edict unknown key', (d) => void ((d.empires[0]!.edict as Record<string, unknown>).revives = 1), "edict: unknown key 'revives'"],
    ['edict not an object', (d) => void (d.empires[0]!.edict = 1 as never), "empire 'saehwa'.edict: must be an object"],
    // runEvents
    ['runEvents unknown top-level key', (d) => void ((d.runEvents as unknown as Record<string, unknown>).extra = 1), "runEvents: unknown key 'extra'"],
    ['runEvents window reversed', (d) => void (d.runEvents!.window = [620, 380]), 'runEvents: window must be [from, to]'],
    ['runEvents window negative', (d) => void (d.runEvents!.window = [-1, 100]), 'runEvents: window must be [from, to]'],
    ['runEvents window past the run', (d) => void (d.runEvents!.window = [380, 900]), 'runEvents: window must be [from, to]'],
    ['runEvents window not a pair', (d) => void (d.runEvents!.window = [380] as never), 'runEvents: window must be [from, to]'],
    ['runEvents bossGap negative', (d) => void (d.runEvents!.bossGap = -1), 'runEvents: bossGap must be a number in [0, 89]'],
    ['runEvents bossGap 90', (d) => void (d.runEvents!.bossGap = 90), 'runEvents: bossGap must be a number in [0, 89]'],
    ['runEvents zones not an object', (d) => void (d.runEvents!.zones = [] as never), 'runEvents: zones must be an object'],
    ['runEvents unknown zone', (d) => void (d.runEvents!.zones.atlantis = ['metinRain']), "runEvents: zones: unknown zone 'atlantis'"],
    ['runEvents unknown event kind', (d) => void (d.runEvents!.zones.yeonmu = ['metinRain', 'tsunami' as never]), "unknown event kind 'tsunami'"],
    ['runEvents duplicate event kind', (d) => void (d.runEvents!.zones.yeonmu = ['bargain', 'bargain']), "duplicate event kind 'bargain'"],
    ['runEvents zone list not a list', (d) => void (d.runEvents!.zones.yeonmu = 'bargain' as never), 'runEvents.zones.yeonmu: must be a list'],
    ['runEvents window inside a boss gap', (d) => void ((d.runEvents!.window = [350, 370]), (d.runEvents!.bossGap = 30)), 'runEvents.zones.yeonmu: no start second in the window [350, 370]'],
    ['runEvents kinds unknown kind', (d) => void ((d.runEvents!.kinds as Record<string, unknown>).meteorShower = {}), "runEvents.kinds: unknown event kind 'meteorShower'"],
    ['runEvents kinds missing kind', (d) => void delete (d.runEvents!.kinds as Record<string, unknown>).bargain, "missing event kind 'bargain'"],
    ['runEvents metinRain count zero', (d) => void (d.runEvents!.kinds.metinRain.count = 0), 'runEvents.kinds.metinRain: count must be an integer in [1, 8]'],
    ['runEvents metinRain count 9', (d) => void (d.runEvents!.kinds.metinRain.count = 9), 'runEvents.kinds.metinRain: count must be an integer in [1, 8]'],
    ['runEvents metinRain count fraction', (d) => void (d.runEvents!.kinds.metinRain.count = 2.5), 'runEvents.kinds.metinRain: count must be an integer in [1, 8]'],
    ['runEvents metinRain ringRadius 1', (d) => void (d.runEvents!.kinds.metinRain.ringRadius = 1), 'metinRain: ringRadius must be a number in [2, 40]'],
    ['runEvents metinRain within zero', (d) => void (d.runEvents!.kinds.metinRain.within = 0), 'metinRain: within must be a number in (0, 60]'],
    ['runEvents metinRain corruption above 1', (d) => void (d.runEvents!.kinds.metinRain.corruption = 1.5), 'metinRain: corruption must be a number in [0, 1]'],
    ['runEvents championHunt hpMul below 1', (d) => void (d.runEvents!.kinds.championHunt.hpMul = 0.5), 'championHunt: hpMul must be a number in [1, 50]'],
    ['runEvents championHunt dmgMul zero', (d) => void (d.runEvents!.kinds.championHunt.dmgMul = 0), 'championHunt: dmgMul must be a number in (0, 10]'],
    ['runEvents championHunt escorts 13', (d) => void (d.runEvents!.kinds.championHunt.escorts = 13), 'championHunt: escorts must be an integer in [0, 12]'],
    ['runEvents championHunt timeLimit zero', (d) => void (d.runEvents!.kinds.championHunt.timeLimit = 0), 'championHunt: timeLimit must be a number in (0, 300]'],
    ['runEvents championHunt chestTier 3', (d) => void (d.runEvents!.kinds.championHunt.chestTier = 3), 'championHunt: chestTier must be an integer in [0, 2]'],
    ['runEvents goldenHour duration zero', (d) => void (d.runEvents!.kinds.goldenHour.duration = 0), 'goldenHour: duration must be a number in (0, 300]'],
    ['runEvents goldenHour eliteEveryMul zero', (d) => void (d.runEvents!.kinds.goldenHour.eliteEveryMul = 0), 'goldenHour: eliteEveryMul must be a number in (0, 5]'],
    ['runEvents goldenHour yeopMul 11', (d) => void (d.runEvents!.kinds.goldenHour.yeopMul = 11), 'goldenHour: yeopMul must be a number in (0, 10]'],
    ['runEvents bargain radius zero', (d) => void (d.runEvents!.kinds.bargain.radius = 0), 'bargain: radius must be a number in (0, 20]'],
    ['runEvents bargain channel 31', (d) => void (d.runEvents!.kinds.bargain.channel = 31), 'bargain: channel must be a number in (0, 30]'],
    ['runEvents bargain offers 5', (d) => void (d.runEvents!.kinds.bargain.offers = 5), 'bargain: offers must be an integer in [1, 4]'],
    ['runEvents bargain offers zero', (d) => void (d.runEvents!.kinds.bargain.offers = 0), 'bargain: offers must be an integer in [1, 4]'],
    ['runEvents param unknown key', (d) => void ((d.runEvents!.kinds.bargain as Record<string, unknown>).cost = 5), "runEvents.kinds.bargain: unknown key 'cost'"],
    ['runEvents param missing', (d) => void delete (d.runEvents!.kinds.goldenHour as Record<string, unknown>).yeopMul, 'goldenHour: yeopMul must be a number in (0, 10] (got undefined)'],
    ['runEvents kind not an object', (d) => void (d.runEvents!.kinds.bargain = 3 as never), 'runEvents.kinds.bargain: must be an object'],
    // affixes
    ['affixes unknown top-level key', (d) => void ((d.affixes as unknown as Record<string, unknown>).chance = 1), "affixes: unknown key 'chance'"],
    ['affixes enabled not a boolean', (d) => void (d.affixes!.enabled = 'no' as never), 'affixes: enabled must be true or false'],
    ['affixes bossOnHard not a boolean', (d) => void (d.affixes!.bossOnHard = 0 as never), 'affixes: bossOnHard must be true or false'],
    ['affixes fromBand 5', (d) => void (d.affixes!.fromBand = 5), 'affixes: fromBand must be an integer in [0, 4]'],
    ['affixes fromBand negative', (d) => void (d.affixes!.fromBand = -1), 'affixes: fromBand must be an integer in [0, 4]'],
    ['affixes fromBand fraction', (d) => void (d.affixes!.fromBand = 1.5), 'affixes: fromBand must be an integer in [0, 4]'],
    ['affixes weights unknown kind', (d) => void ((d.affixes!.weights as Record<string, number>).explosive = 1), "affixes.weights: unknown affix kind 'explosive'"],
    ['affixes weights missing kind', (d) => void delete (d.affixes!.weights as Record<string, number>).warded, "affixes.weights: missing affix kind 'warded'"],
    ['affixes weights negative', (d) => void (d.affixes!.weights.swift = -1), 'affixes.weights: swift must be a number in [0, 100]'],
    ['affixes weights all zero', (d) => void (d.affixes!.weights = { swift: 0, vampiric: 0, warded: 0, splitting: 0 }), 'affixes.weights: at least one weight must be > 0'],
    ['affixes swift speed zero', (d) => void (d.affixes!.params.swift.speed = 0), 'affixes.params.swift: speed must be a number in (0, 2]'],
    ['affixes swift attackRate 3', (d) => void (d.affixes!.params.swift.attackRate = 3), 'affixes.params.swift: attackRate must be a number in (0, 2]'],
    ['affixes vampiric heal above 1', (d) => void (d.affixes!.params.vampiric.heal = 1.5), 'affixes.params.vampiric: heal must be a number in (0, 1]'],
    ['affixes warded reduction 0.95', (d) => void (d.affixes!.params.warded.reduction = 0.95), 'affixes.params.warded: reduction must be a number in (0, 0.9]'],
    ['affixes warded above zero', (d) => void (d.affixes!.params.warded.above = 0), 'affixes.params.warded: above must be a number in (0, 1]'],
    ['affixes splitting copies 5', (d) => void (d.affixes!.params.splitting.copies = 5), 'affixes.params.splitting: copies must be an integer in [1, 4]'],
    ['affixes splitting copies fraction', (d) => void (d.affixes!.params.splitting.copies = 1.5), 'affixes.params.splitting: copies must be an integer in [1, 4]'],
    ['affixes splitting hp zero', (d) => void (d.affixes!.params.splitting.hp = 0), 'affixes.params.splitting: hp must be a number in (0, 1]'],
    ['affixes params unknown kind', (d) => void ((d.affixes!.params as Record<string, unknown>).explosive = {}), "affixes.params: unknown affix kind 'explosive'"],
    ['affixes params missing kind', (d) => void delete (d.affixes!.params as Record<string, unknown>).vampiric, "affixes.params: missing affix kind 'vampiric'"],
    ['affixes param unknown key', (d) => void ((d.affixes!.params.swift as Record<string, unknown>).armor = 1), "affixes.params.swift: unknown key 'armor'"],
    ['affixes bossKinds unknown kind', (d) => void (d.affixes!.bossKinds = ['swift', 'explosive' as never]), "bossKinds: unknown affix kind 'explosive'"],
    ['affixes bossKinds duplicate', (d) => void (d.affixes!.bossKinds = ['swift', 'swift']), "bossKinds: duplicate affix kind 'swift'"],
    ['affixes bossKinds empty while bossOnHard', (d) => void (d.affixes!.bossKinds = []), 'bossKinds must not be empty while bossOnHard is true'],
    ['affixes bossKinds not a list', (d) => void (d.affixes!.bossKinds = 'swift' as never), 'affixes: bossKinds must be a list'],
  ];

  it('starts from a valid populated copy', () => {
    expect(errorsOf(populated())).toEqual([]);
  });

  it.each(bad)('%s', (_label, mutate, fragment) => {
    const db = populated();
    mutate(db);
    const errors = errorsOf(db);
    expect(
      errors.some((e) => e.includes(fragment)),
      `expected an error containing "${fragment}" in:\n${errors.join('\n')}`,
    ).toBe(true);
    expect(() => assertContent(db)).toThrow(/content validation failed/);
  });

  it('reports the offending value and keeps every other field of the copy valid', () => {
    const db = populated();
    db.balance.chest!.eliteDrop = 1.5;
    expect(errorsOf(db)).toEqual(['balance.chest: eliteDrop must be a number in [0, 1] (got 1.5)']);
  });

  it('keeps the live content untouched by validation of a broken clone', () => {
    const db = populated();
    db.runEvents!.window = [620, 380];
    expect(errorsOf(db).length).toBeGreaterThan(0);
    expect(errorsOf(content)).toEqual([]);
    expect(content.runEvents).toEqual(DEFAULT_RUN_EVENTS);
  });
});
