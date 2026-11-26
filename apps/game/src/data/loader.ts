// Content loader: assembles the ContentDB from content/*.json and validates every cross-reference.
// `loadContent()` is the app entry (src/app/content.ts); `validateContent()` is also used by vitest, the asset pipeline
// and DEV tooling (with an AssetIndex it additionally checks model / icon / texture / audio / vfx ids).
import affixesJson from './content/affixes.json';
import empiresJson from './content/empires.json';
import balanceJson from './content/balance.json';
import bossesJson from './content/bosses.json';
import classesJson from './content/classes.json';
import enemiesJson from './content/enemies.json';
import gearJson from './content/gear.json';
import metinsJson from './content/metins.json';
import passivesJson from './content/passives.json';
import runEventsJson from './content/runEvents.json';
import skillsJson from './content/skills.json';
import stonesJson from './content/stones.json';
import storyJson from './content/story.json';
import talentsJson from './content/talents.json';
import trinketsJson from './content/trinkets.json';
import zonesJson from './content/zones.json';
import type {
  AffixKind,
  AffixesDef,
  BalanceConfig,
  BossDef,
  BossPatternKind,
  ClassDef,
  ClassId,
  ContentDB,
  EmpireDef,
  EnemyDef,
  GearDef,
  MetinDef,
  PassiveDef,
  RunEventKind,
  RunEventsDef,
  SkillDef,
  StoneDef,
  StoryDef,
  TalentTree,
  TrinketDef,
  ZoneDef,
} from './schema';
import { AFFIX_KINDS, DEFAULT_TRIGGERS, EDICT_MAX, GEAR_SLOTS, MAX_SKILL_RANK, RARITIES, RUN_EVENT_KINDS, SKILL_PAYLOAD_KEYS, SUMMON_ROLES, TRIGGER_KINDS } from './schema';

// The JSON is validated by `validateContent` (run by `loadContent` and by the vitest), so the assertion is the contract.
const DB: ContentDB = {
  classes: classesJson as unknown as ClassDef[],
  skills: skillsJson as unknown as SkillDef[],
  passives: passivesJson as unknown as PassiveDef[],
  stones: stonesJson as unknown as StoneDef[],
  trinkets: trinketsJson as unknown as TrinketDef[],
  enemies: enemiesJson as unknown as EnemyDef[],
  bosses: bossesJson as unknown as BossDef[],
  metins: metinsJson as unknown as MetinDef[],
  zones: zonesJson as unknown as ZoneDef[],
  gear: gearJson as unknown as GearDef[],
  talents: talentsJson as unknown as TalentTree[],
  empires: empiresJson as unknown as EmpireDef[],
  story: storyJson as unknown as StoryDef,
  balance: balanceJson as unknown as BalanceConfig,
  runEvents: runEventsJson as unknown as RunEventsDef,
  affixes: affixesJson as unknown as AffixesDef,
};

/** The typed, unvalidated content database. Prefer `loadContent()` in app code. */
export const content: ContentDB = DB;

export type AssetKind = 'models' | 'icons' | 'textures' | 'audio' | 'vfx';

/** Known asset ids per kind. A missing kind means "not checked"; `vfx` is a predicate (ids carry palette suffixes). */
export interface AssetIndex {
  models?: ReadonlySet<string>;
  icons?: ReadonlySet<string>;
  textures?: ReadonlySet<string>;
  audio?: ReadonlySet<string>;
  vfx?: (id: string) => boolean;
}

export interface ValidateOptions {
  assets?: AssetIndex;
  /** missing assets are errors in production, warnings in dev. `true` = all kinds production; or choose per kind */
  strict?: boolean | Partial<Record<AssetKind, boolean>>;
}

export interface ValidationReport {
  errors: string[];
  warnings: string[];
}

/** Run Options: pre-run difficulty sliders (multipliers, 1 = off). Reward multiplier = min(rewardMax, 1 + Σ rewardWeight·(value − 1)). */
export interface RunOptionSlider {
  min: number;
  max: number;
  step: number;
  rewardWeight: number;
}
export interface RunOptionsConfig {
  density: RunOptionSlider;
  health: RunOptionSlider;
  damage: RunOptionSlider;
  speed: RunOptionSlider;
  rewardMax: number;
}

export const RUN_LENGTH = 900;
export const BAND_LENGTH = 180;
export const MAX_ALIVE_CAP = 600;

const BEHAVIORS = ['meleeArc', 'spinAura', 'persistentAura', 'dash', 'projectile', 'homingProjectile', 'skyStrike', 'chain', 'groundZone', 'orbit', 'cone', 'shockwave', 'selfBuff', 'summon', 'leap', 'beam'];
const ELEMENTS = ['physical', 'fire', 'ice', 'lightning', 'dark', 'poison', 'holy', 'wind'];
const UPGRADE_STATS = ['damage', 'cooldown', 'area', 'count', 'duration', 'speed', 'pierce', 'knockback', 'tick', 'range', 'statusChance', 'statusPower', 'heal'];
const SKILL_PARAM_KEYS = ['damage', 'cooldown', 'area', 'count', 'duration', 'speed', 'pierce', 'knockback', 'tick', 'range'];
const AWAKEN_KEYS = ['damageMul', 'areaMul', 'countAdd', 'cooldownMul', 'durationMul', 'pierceAdd', 'speedMul', 'knockbackMul', 'rangeMul', 'statusChanceAdd', 'statusPowerMul', 'healAdd', 'tickMul', 'echo', 'nova', 'novaDamage', 'explode'];
const STATUS_KINDS = ['slow', 'poison', 'burn', 'stun', 'freeze', 'bleed', 'fear', 'weaken'];
const STAT_KEYS = ['maxHp', 'maxHpPct', 'armor', 'regen', 'moveSpeed', 'damage', 'critChance', 'critDamage', 'cooldown', 'area', 'duration', 'projectiles', 'projSpeed', 'pierce', 'xpGain', 'yeopGain', 'pickupRadius', 'luck', 'revives', 'lifesteal', 'attackSpeed', 'evasion', 'thorns', 'vsRace', 'vsBoss', 'resist'];
const RACES = ['animal', 'orc', 'esoteric', 'undead', 'devil', 'insect', 'desert', 'ice', 'fire', 'dragon', 'human', 'metin'];
const RANKS = ['pawn', 'pawnElite', 'knight', 'knightElite', 'boss', 'king'];
const ATTACK_KINDS = ['melee', 'ranged', 'charge', 'leap', 'explode', 'aura', 'breath'];
const AI_KINDS = ['chase', 'ranged', 'charger', 'swarm', 'tank', 'skirmisher'];
const CLASS_IDS: ClassId[] = ['warrior', 'ninja', 'yacha', 'shaman', 'wolfman'];
const MODIFIERS = ['slowAura', 'extraSwarm', 'summonElite', 'yeopRain', 'darkness', 'flicker', 'fireRing', 'poisonField', 'damageAura'];
const TRINKET_EFFECT_KEYS: Record<string, string[]> = {
  lifesteal: ['pct'],
  chainHit: ['chance', 'damage'],
  stunChance: ['chance', 'duration'],
  slowChance: ['chance', 'power', 'duration'],
  poisonChance: ['chance', 'power', 'duration'],
  thorns: ['pct'],
  critBurst: ['radius', 'damage'],
  shield: ['amount', 'regen'],
};
/** required numeric params per boss pattern kind (the sim reads exactly these keys) */
export const BOSS_PATTERN_PARAMS: Record<BossPatternKind, string[]> = {
  slam: ['radius', 'damage', 'knockback', 'atPlayer'],
  charge: ['length', 'width', 'speed', 'damage'],
  volley: ['count', 'speed', 'spread', 'radius', 'damage', 'waves', 'interval'],
  summon: ['count'],
  ring: ['count', 'speed', 'radius', 'damage', 'waves'],
  meteor: ['count', 'radius', 'spread', 'delay', 'interval', 'damage'],
  nova: ['radius', 'inner', 'damage', 'knockback'],
  teleport: ['range', 'radius', 'damage'],
  breath: ['length', 'angle', 'duration', 'tick', 'damage'],
  enrage: ['speedMul', 'damageMul', 'cooldownMul'],
};
export const WAVE_THRESHOLDS = [99, 90, 80, 70, 60, 50, 40, 30, 20, 10] as const;
export const MODIFIER_PARAMS: Record<string, string[]> = {
  slowAura: ['radius', 'slow'],
  extraSwarm: ['radius', 'swarmMul'],
  summonElite: ['radius', 'every'],
  yeopRain: ['radius', 'every', 'value'],
  darkness: ['radius', 'strength'],
  flicker: ['radius', 'period'],
  fireRing: ['radius', 'ringRadius', 'blob', 'damage'],
  poisonField: ['radius', 'patches', 'patchRadius', 'damage'],
  damageAura: ['radius', 'dps'],
};

const HEX = /^#[0-9a-fA-F]{6}$/;
const SNAKE = /^[a-z][a-z0-9_]*$/;
const CODEX_UNLOCK = /^(always|start|enter:[a-z0-9_]+|zone:[a-z0-9_]+|clear:[a-z0-9_]+|hard:[a-z0-9_]+|boss:[a-z0-9_]+|metin:[a-z0-9_]+|class:[a-z0-9_]+|(level|wins|runs|kills):\d+)$/;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** the accepted range of a roguelite content number: [lo, hi] ((lo, hi] when `gt`), integers only when `int` */
interface Range {
  lo: number;
  hi: number;
  int?: boolean;
  gt?: boolean;
}
/** a hard / zone multiplier: > 0 and at most MUL_MAX */
const MUL_MAX = 5;
const MUL: Range = { lo: 0, hi: MUL_MAX, gt: true };
const HARD_MUL_KEYS = ['awakenMul', 'eliteEveryMul', 'finalEnrageMul'] as const;
/** an empire edict number: an integer 0..EDICT_MAX */
const EDICT: Range = { lo: 0, hi: EDICT_MAX, int: true };

/** the named error of a number outside its range (or not a finite number / integer at all) */
function checkRange(r: Report, path: string, name: string, v: unknown, g: Range): void {
  const ok = (g.int ? isInt(v) : isNum(v)) && (v as number) <= g.hi && ((v as number) > g.lo || (!g.gt && (v as number) === g.lo));
  if (!ok) r.err(path, `${name} must be ${g.int ? 'an integer' : 'a number'} in ${g.gt ? '(' : '['}${g.lo}, ${g.hi}] (got ${typeof v === 'number' ? String(v) : (JSON.stringify(v) ?? 'undefined')})`);
}

/** `v` must be a plain object whose keys are all in `allowed` (a typo must not pass silently); null after reporting */
function checkObject(r: Report, path: string, v: unknown, allowed: readonly string[], noun = 'key'): Record<string, unknown> | null {
  if (!isObj(v)) {
    r.err(path, 'must be an object');
    return null;
  }
  for (const k of Object.keys(v)) if (!allowed.includes(k)) r.err(path, `unknown ${noun} '${k}' (${allowed.join(', ')})`);
  return v;
}

/** optional per-key ranges: every key that is present must be in range (absent keys keep their default) */
function checkOptionalRanges(r: Report, path: string, o: Record<string, unknown>, ranges: Record<string, Range>): void {
  for (const [k, g] of Object.entries(ranges)) if (o[k] !== undefined) checkRange(r, path, k, o[k], g);
}

class Report {
  errors: string[] = [];
  warnings: string[] = [];
  err(path: string, msg: string): void {
    this.errors.push(`${path}: ${msg}`);
  }
  warn(path: string, msg: string): void {
    this.warnings.push(`${path}: ${msg}`);
  }
}

function uniqueIds(r: Report, name: string, ids: string[]): Set<string> {
  const seen = new Set<string>();
  for (const id of ids) {
    if (!isStr(id) || !SNAKE.test(id)) r.err(name, `bad id '${String(id)}' (lowercase snake_case)`);
    else if (seen.has(id)) r.err(name, `duplicate id '${id}'`);
    seen.add(id);
  }
  return seen;
}

/** every { tr, en } pair anywhere in the database must be a non-empty string in both languages */
function checkL10n(r: Report, value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => checkL10n(r, v, `${path}[${i}]`));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  const o = value as Record<string, unknown>;
  if ('tr' in o && 'en' in o && Object.keys(o).length === 2) {
    if (!isStr(o.tr) || (o.tr as string).trim().length < 2) r.err(path, 'empty/short Turkish text');
    if (!isStr(o.en) || (o.en as string).trim().length < 2) r.err(path, 'empty/short English text');
    for (const lang of ['tr', 'en'] as const) {
      const s = o[lang];
      if (typeof s === 'string' && /TODO|FIXME|lorem ipsum|undefined|\[object/i.test(s)) r.err(path, `${lang} text looks like a placeholder`);
    }
    return;
  }
  for (const [k, v] of Object.entries(o)) checkL10n(r, v, `${path}.${k}`);
}

function checkMods(r: Report, mods: unknown, path: string): void {
  if (mods === undefined) return;
  if (mods === null || typeof mods !== 'object') return r.err(path, 'StatMods must be an object');
  for (const [k, v] of Object.entries(mods)) {
    if (!STAT_KEYS.includes(k)) r.err(path, `unknown StatMods key '${k}'`);
    else if (k === 'vsRace' || k === 'resist') {
      const keys = k === 'vsRace' ? RACES : ELEMENTS;
      for (const [sub, sv] of Object.entries(v as Record<string, unknown>)) {
        if (!keys.includes(sub) || !isNum(sv)) r.err(path, `${k}.${sub} invalid`);
      }
    } else if (!isNum(v)) r.err(path, `${k} not a finite number`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export function validateContent(db: ContentDB, options: ValidateOptions = {}): ValidationReport {
  const r = new Report();
  checkL10n(r, db, 'content');

  const skillIds = uniqueIds(r, 'skills', db.skills.map((s) => s.id));
  uniqueIds(r, 'passives', db.passives.map((s) => s.id));
  uniqueIds(r, 'stones', db.stones.map((s) => s.id));
  uniqueIds(r, 'trinkets', db.trinkets.map((s) => s.id));
  const enemyIds = uniqueIds(r, 'enemies', db.enemies.map((s) => s.id));
  const bossIds = uniqueIds(r, 'bosses', db.bosses.map((s) => s.id));
  const metinIds = uniqueIds(r, 'metins', db.metins.map((s) => s.id));
  const zoneIds = uniqueIds(r, 'zones', db.zones.map((s) => s.id));
  uniqueIds(r, 'gear', db.gear.map((s) => s.id));
  uniqueIds(r, 'classes', db.classes.map((s) => s.id));
  for (const id of enemyIds) if (bossIds.has(id)) r.err('enemies', `id '${id}' also used by a boss (typeIndex collision)`);

  const modelIds = new Set<string>();
  const iconIds = new Map<string, string>();
  const textureIds = new Set<string>();
  const audioIds = new Set<string>();
  const vfxIds = new Set<string>();
  const useIcon = (icon: unknown, where: string): void => {
    if (!isStr(icon) || !SNAKE.test(icon)) return r.err(where, `bad icon id '${String(icon)}'`);
    const prev = iconIds.get(icon);
    if (prev) r.err(where, `icon '${icon}' already used by ${prev}`);
    else iconIds.set(icon, where);
  };

  validateBalance(r, db.balance);
  validateSkills(r, db, skillIds, vfxIds, audioIds, useIcon);
  validateClasses(r, db, skillIds, modelIds, textureIds);
  validateTalents(r, db, skillIds, useIcon);
  validateItems(r, db, useIcon);
  validateEnemies(r, db, enemyIds, bossIds, modelIds, audioIds, vfxIds);
  validateMetins(r, db, enemyIds, modelIds);
  validateZones(r, db, enemyIds, bossIds, metinIds, zoneIds, textureIds, audioIds);
  validateRogueliteBalance(r, db);
  validateRunEvents(r, db, zoneIds);
  validateAffixes(r, db);
  validateGear(r, db, bossIds, zoneIds, modelIds);
  validateStory(r, db, zoneIds, bossIds, metinIds, enemyIds);
  checkAssets(r, options, { modelIds, iconIds, textureIds, audioIds, vfxIds });
  warnOrphans(r, db);
  return { errors: r.errors, warnings: r.warnings };
}

/** Throws with the first errors when the content is inconsistent; returns the warnings otherwise. */
export function assertContent(db: ContentDB, options: ValidateOptions = {}): string[] {
  const rep = validateContent(db, options);
  if (rep.errors.length > 0) {
    const head = rep.errors.slice(0, 25).join('\n  ');
    throw new Error(`content validation failed (${rep.errors.length} errors):\n  ${head}`);
  }
  return rep.warnings;
}

let validated = false;

/** App entry: the validated ContentDB. Validation runs once per page load (structure + cross-references, no assets). */
export function loadContent(): ContentDB {
  if (!validated) {
    const warnings = assertContent(DB);
    validated = true;
    if (import.meta.env?.DEV && warnings.length > 0) console.warn(`[content] ${warnings.length} warnings\n  ${warnings.slice(0, 10).join('\n  ')}`);
  }
  return DB;
}

// ---------------------------------------------------------------------------------------------------------------------

function validateBalance(r: Report, b: BalanceConfig): void {
  const p = 'balance';
  if (b.runLength !== RUN_LENGTH) r.err(p, `runLength must be ${RUN_LENGTH}`);
  for (const k of ['base', 'growth', 'accel'] as const) if (!isNum(b.xpCurve[k]) || b.xpCurve[k] < 0) r.err(p, `xpCurve.${k}`);
  for (const k of ['cardsPerLevel', 'rerollsPerRun', 'banishesPerRun', 'skipsPerRun', 'maxActiveSkills', 'maxPassives', 'armorK', 'enemyHpPerMin', 'enemyDamagePerMin'] as const) {
    if (!isNum(b[k]) || b[k] < 0) r.err(p, `${k} invalid`);
  }
  if (b.cardsPerLevel < 1 || b.maxActiveSkills < 1) r.err(p, 'cardsPerLevel / maxActiveSkills must be >= 1');
  for (const [k, v] of Object.entries(b.rarityWeights)) if (!isNum(v) || v <= 0) r.err(p, `rarityWeights.${k}`);
  if (!isNum(b.chestCost.base) || !isNum(b.chestCost.perOpen)) r.err(p, 'chestCost');
  for (const [k, v] of Object.entries(b.caps)) if (!isNum(v) || v <= 0) r.err(p, `caps.${k}`);
  const hard = checkObject(r, `${p}.hard`, b.hard, ['hp', 'damage', 'count', 'reward', ...HARD_MUL_KEYS]);
  if (hard) {
    for (const k of ['hp', 'damage', 'count', 'reward']) if (!isNum(hard[k]) || (hard[k] as number) <= 0) r.err(p, `hard.${k}`);
    checkOptionalRanges(r, `${p}.hard`, hard, { awakenMul: MUL, eliteEveryMul: MUL, finalEnrageMul: MUL });
  }
  for (const [k, v] of Object.entries(b.talentXp)) if (!isNum(v) || v < 0) r.err(p, `talentXp.${k}`);
  const ro = (b as BalanceConfig & { runOptions?: RunOptionsConfig }).runOptions;
  if (!ro) r.err(p, 'runOptions missing');
  else {
    if (!isNum(ro.rewardMax) || ro.rewardMax < 1 || ro.rewardMax > 2) r.err(p, 'runOptions.rewardMax must be 1..2');
    for (const k of ['density', 'health', 'damage', 'speed'] as const) {
      const o = ro[k];
      if (!o || !isNum(o.min) || !isNum(o.max) || !isNum(o.step) || !isNum(o.rewardWeight) || o.min !== 1 || o.max < o.min || o.step <= 0 || o.rewardWeight < 0) r.err(p, `runOptions.${k}`);
    }
  }
  validateTriggerConfig(r, b.triggers as unknown);
  const bs = b.blacksmith;
  if (bs.successRate.length !== 9 || bs.yeopCost.length !== 9 || bs.shardCost.length !== 9) r.err(p, 'blacksmith tables need 9 entries (+0..+8 -> +9)');
  for (const x of bs.successRate) if (!isNum(x) || x <= 0 || x > 1) r.err(p, 'blacksmith successRate must be in (0,1]');
  for (const x of [...bs.yeopCost, ...bs.shardCost]) if (!isNum(x) || x < 0) r.err(p, 'blacksmith costs must be >= 0');
}

/** fractions that must stay in (0, 1] */
const TRIGGER_FRACTIONS = new Set(['hurt.frac', 'danger.hp', 'danger.lossFrac', 'ally.hp', 'refundCap']);

/** balance.triggers (optional): only keys of DEFAULT_TRIGGERS, numbers >= 0, `bait` a boolean */
function validateTriggerConfig(r: Report, cfg: unknown): void {
  const p = 'balance.triggers';
  if (cfg === undefined) return;
  if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg)) return r.err(p, 'must be an object');
  const defaults = DEFAULT_TRIGGERS as unknown as Record<string, unknown>;
  const checkNum = (path: string, v: unknown): void => {
    if (!isNum(v) || v < 0) r.err(p, `${path} must be a finite number >= 0`);
    else if (TRIGGER_FRACTIONS.has(path) && (v <= 0 || v > 1)) r.err(p, `${path} must be in (0, 1]`);
  };
  for (const [k, v] of Object.entries(cfg as Record<string, unknown>)) {
    const d = defaults[k];
    if (d === undefined) r.err(p, `unknown key '${k}' (${Object.keys(defaults).join(', ')})`);
    else if (typeof d === 'boolean') {
      if (typeof v !== 'boolean') r.err(p, `${k} must be a boolean`);
    } else if (typeof d === 'number') checkNum(k, v);
    else if (v === null || typeof v !== 'object' || Array.isArray(v)) r.err(p, `${k} must be an object`);
    else {
      for (const [sk, sv] of Object.entries(v as Record<string, unknown>)) {
        if (!(sk in (d as object))) r.err(p, `unknown key '${k}.${sk}' (${Object.keys(d as object).join(', ')})`);
        else checkNum(`${k}.${sk}`, sv);
      }
    }
  }
}

function validateSkills(r: Report, db: ContentDB, skillIds: Set<string>, vfxIds: Set<string>, audioIds: Set<string>, useIcon: (i: unknown, w: string) => void): void {
  const ultimateOwners = new Map<string, string>();
  for (const t of db.talents) for (const m of t.milestones) if (m.skill) ultimateOwners.set(m.skill, t.id);
  for (const s of db.skills) {
    const p = `skill '${s.id}'`;
    if (s.classId !== 'common' && !CLASS_IDS.includes(s.classId)) r.err(p, `classId '${s.classId}'`);
    if (!['basic', 'active', 'ultimate'].includes(s.kind)) r.err(p, `kind '${s.kind}'`);
    if (s.classId === 'common' && (s.kind !== 'active' || s.doctrine !== undefined)) r.err(p, 'common skills are doctrine-less actives');
    if (s.classId !== 'common' && s.doctrine !== 'a' && s.doctrine !== 'b') r.err(p, 'doctrine must be a|b');
    useIcon(s.icon, p);
    if (!BEHAVIORS.includes(s.behavior)) r.err(p, `behavior '${s.behavior}'`);
    if (!ELEMENTS.includes(s.element)) r.err(p, `element '${s.element}'`);
    for (const k of SKILL_PARAM_KEYS) {
      const v = (s.params as unknown as Record<string, unknown>)[k];
      if (!isNum(v) || v < 0) r.err(p, `params.${k} must be a finite number >= 0`);
    }
    if (s.params.cooldown <= 0 && s.behavior !== 'persistentAura') r.err(p, 'cooldown must be > 0');
    if (s.params.count < 1) r.err(p, 'count must be >= 1');
    if (s.params.angle !== undefined && !isNum(s.params.angle)) r.err(p, 'angle');
    if (s.params.heal !== undefined && !isNum(s.params.heal)) r.err(p, 'heal');
    const st = s.params.status;
    if (st && (!STATUS_KINDS.includes(st.kind) || !isNum(st.chance) || st.chance < 0 || st.chance > 1 || !isNum(st.duration) || st.duration < 0 || !isNum(st.power))) r.err(p, 'bad status');
    if (s.behavior === 'selfBuff' && !s.params.buff) r.err(p, 'selfBuff requires params.buff');
    checkMods(r, s.params.buff, `${p}.buff`);
    validateSkillLogic(r, s, p);
    if (s.kind === 'basic' && s.params.cooldown > 1.2) r.err(p, 'basic cooldown too long');
    if (s.upgrades.length < 3 || s.upgrades.length > 5) r.err(p, `needs 3-5 upgrade lines (has ${s.upgrades.length})`);
    const seen = new Set<string>();
    for (const u of s.upgrades) {
      if (!UPGRADE_STATS.includes(u.stat) || !isNum(u.base) || u.base <= 0 || (u.mode !== 'pct' && u.mode !== 'flat')) r.err(p, `bad upgrade line ${JSON.stringify(u)}`);
      const key = `${u.stat}/${u.mode}`;
      if (seen.has(key)) r.err(p, `duplicate upgrade ${key}`);
      seen.add(key);
    }
    const aw = Object.entries(s.awaken.params);
    if (aw.length === 0) r.err(p, 'awaken.params empty');
    for (const [k, v] of aw) if (!AWAKEN_KEYS.includes(k) || !isNum(v)) r.err(p, `awaken key '${k}'`);
    if (!isStr(s.vfx)) r.err(p, 'vfx id missing');
    else vfxIds.add(s.vfx);
    if (!isStr(s.sfx)) r.err(p, 'sfx id missing');
    else audioIds.add(s.sfx);
    if (s.kind === 'ultimate') {
      const m = s.unlock?.talentMilestone;
      if (m !== 10 && m !== 20 && m !== 30) r.err(p, 'ultimate needs unlock.talentMilestone');
      if (!ultimateOwners.has(s.id)) r.err(p, 'ultimate is not granted by any talent milestone');
    }
    if (s.heroClip !== undefined && !['attack', 'attack2', 'cast', 'dash'].includes(s.heroClip)) r.err(p, `heroClip '${s.heroClip}'`);
  }
  if (MAX_SKILL_RANK !== 7) r.err('schema', 'unexpected MAX_SKILL_RANK');
  void skillIds;
}

/** skill-logic optional keys: payload numerics, trigger, role, vigil (DESIGN §4.2); every one is optional */
function validateSkillLogic(r: Report, s: SkillDef, p: string): void {
  const params = s.params as unknown as Record<string, unknown>;
  for (const k of SKILL_PAYLOAD_KEYS) {
    const v = params[k];
    if (v === undefined) continue;
    if (!isNum(v) || v < 0) r.err(p, `params.${k} must be a finite number >= 0`);
    else if (k === 'mark' && !Number.isInteger(v)) r.err(p, 'params.mark must be an integer');
    else if ((k === 'drain' || k === 'steady') && v !== 0 && v !== 1) r.err(p, `params.${k} must be 0 or 1`);
  }
  checkMods(r, s.vigil, `${p}.vigil`);
  if (s.role !== undefined) {
    if (!SUMMON_ROLES.includes(s.role)) r.err(p, `role '${String(s.role)}' unknown (${SUMMON_ROLES.join(', ')})`);
    else if (s.behavior !== 'summon') r.err(p, `role '${s.role}' needs behavior 'summon'`);
  }
  const t = s.trigger as unknown;
  if (t === undefined) return;
  if (t === null || typeof t !== 'object') return r.err(p, 'trigger must be an object');
  const tr = t as Record<string, unknown>;
  const any = tr.any;
  if (!Array.isArray(any) || any.length === 0) r.err(p, 'trigger.any must be a non-empty array');
  else {
    const seen = new Set<unknown>();
    for (const kind of any) {
      if (!TRIGGER_KINDS.includes(kind as never)) r.err(p, `trigger kind '${String(kind)}' unknown (${TRIGGER_KINDS.join(', ')})`);
      else if (seen.has(kind)) r.err(p, `trigger kind '${String(kind)}' listed twice`);
      seen.add(kind);
    }
  }
  if (tr.patience !== undefined && (!isNum(tr.patience) || tr.patience < 0)) r.err(p, 'trigger.patience must be a finite number >= 0');
  if (tr.n !== undefined && (!isNum(tr.n) || !Number.isInteger(tr.n) || tr.n < 1)) r.err(p, 'trigger.n must be an integer >= 1');
  if (tr.hp !== undefined && (!isNum(tr.hp) || tr.hp <= 0 || tr.hp > 1)) r.err(p, 'trigger.hp must be in (0, 1]');
  if (tr.minHp !== undefined && (!isNum(tr.minHp) || tr.minHp < 0 || tr.minHp >= 1)) r.err(p, 'trigger.minHp must be in [0, 1)');
  for (const k of Object.keys(tr)) if (!['any', 'patience', 'n', 'hp', 'minHp'].includes(k)) r.err(p, `trigger.${k} unknown`);
  if (s.kind === 'basic') r.err(p, 'a basic attack cannot have a trigger');
  if (s.behavior === 'persistentAura') r.err(p, 'a permanent aura cannot have a trigger (it never goes through the cast path)');
}

function validateClasses(r: Report, db: ContentDB, skillIds: Set<string>, modelIds: Set<string>, textureIds: Set<string>): void {
  const bySkill = new Map(db.skills.map((s) => [s.id, s]));
  for (const id of CLASS_IDS) if (!db.classes.some((c) => c.id === id)) r.err('classes', `missing class '${id}'`);
  for (const c of db.classes) {
    const p = `class '${c.id}'`;
    if (c.sexes.length === 0) r.err(p, 'no sexes');
    const base = c.base;
    if (!isNum(base.maxHp) || base.maxHp <= 0 || !isNum(base.armor) || base.armor < 0 || !isNum(base.moveSpeed) || base.moveSpeed <= 0) r.err(p, 'base maxHp/armor/moveSpeed');
    checkMods(r, base, `${p}.base`);
    for (const sex of c.sexes) {
      const models = c.models[sex];
      if (!models || models.length !== 4) r.err(p, `models.${sex} needs 4 armor tiers`);
      else models.forEach((m) => modelIds.add(m));
      const portrait = c.portrait[sex];
      if (!isStr(portrait)) r.err(p, `portrait.${sex} missing`);
      else textureIds.add(portrait);
    }
    if (c.weapons.length !== 4) r.err(p, 'weapons needs 4 tiers');
    c.weapons.forEach((m) => modelIds.add(m));
    if (c.weaponsB) {
      if (c.weaponsB.length !== 4) r.err(p, 'weaponsB needs 4 tiers');
      c.weaponsB.forEach((m) => modelIds.add(m));
    }
    c.doctrines.forEach((d, i) => {
      const key = i === 0 ? 'a' : 'b';
      const dp = `${p} doctrine ${key}`;
      if (d.id !== key) r.err(dp, `id must be '${key}'`);
      const basic = bySkill.get(d.basic);
      if (!basic || basic.kind !== 'basic' || basic.classId !== c.id || basic.doctrine !== key) r.err(dp, `basic '${d.basic}' invalid`);
      if (!d.skills.includes(d.starter)) r.err(dp, `starter '${d.starter}' not in skills`);
      if (d.skills.length < 6) r.err(dp, 'needs at least 6 active skills');
      for (const sid of d.skills) {
        const s = bySkill.get(sid);
        if (!skillIds.has(sid) || !s) r.err(dp, `unknown skill '${sid}'`);
        else if (s.kind !== 'active' || s.classId !== c.id || s.doctrine !== key) r.err(dp, `skill '${sid}' is not an active of this doctrine`);
      }
      const kinds = new Set(d.skills.map((sid) => bySkill.get(sid)?.behavior));
      if (kinds.size < 5) r.err(dp, `only ${kinds.size} distinct behaviors across the doctrine actives`);
    });
  }
  // every non-ultimate class skill belongs to a doctrine list or is a basic
  for (const s of db.skills) {
    if (s.classId === 'common' || s.kind !== 'active') continue;
    const c = db.classes.find((x) => x.id === s.classId);
    const d = c?.doctrines[s.doctrine === 'a' ? 0 : 1];
    if (!d?.skills.includes(s.id)) r.err(`skill '${s.id}'`, 'active skill is not in its doctrine skill list');
  }
  if (!db.skills.some((s) => s.classId === 'common' && s.kind === 'active')) r.err('skills', 'no common-pool skills');
}

function validateTalents(r: Report, db: ContentDB, skillIds: Set<string>, useIcon: (i: unknown, w: string) => void): void {
  const bySkill = new Map(db.skills.map((s) => [s.id, s]));
  const treeIds = uniqueIds(r, 'talents', db.talents.map((t) => t.id));
  for (const c of db.classes) for (const k of ['a', 'b']) if (!treeIds.has(`${c.id}_${k}`)) r.err('talents', `missing tree '${c.id}_${k}'`);
  for (const t of db.talents) {
    const p = `tree '${t.id}'`;
    const key = t.id.slice(-1);
    if (t.id !== `${t.classId}_${key}`) r.err(p, 'id must be <classId>_<a|b>');
    const ids = new Set<string>();
    const rows = new Map<number, number>();
    let capacity = 0;
    for (const n of t.nodes) {
      const np = `${p} node '${n.id}'`;
      if (ids.has(n.id)) r.err(np, 'duplicate node id');
      ids.add(n.id);
      if (!Number.isInteger(n.row) || n.row < 0 || n.row > 4 || !Number.isInteger(n.col) || n.col < 0) r.err(np, 'row 0..4 / col >= 0');
      if (!Number.isInteger(n.max) || n.max < 1) r.err(np, 'max >= 1');
      capacity += n.max;
      rows.set(n.row, (rows.get(n.row) ?? 0) + n.max);
      useIcon(n.icon, np);
      if (!n.perPoint && !n.effect) r.err(np, 'needs perPoint or effect');
      checkMods(r, n.perPoint, `${np}.perPoint`);
      if (n.effect) {
        const k = n.effect.kind;
        if (k.startsWith('skillMod:')) {
          const sid = k.slice('skillMod:'.length);
          const sk = bySkill.get(sid);
          if (!skillIds.has(sid) || !sk) r.err(np, `skillMod target '${sid}' unknown`);
          else if (sk.classId !== t.classId || sk.doctrine !== key) r.err(np, `skillMod target '${sid}' is not in this doctrine`);
          for (const [stat, v] of Object.entries(n.effect.params)) if (!UPGRADE_STATS.includes(stat) || !isNum(v)) r.err(np, `skillMod stat '${stat}'`);
        } else if (!['startLevel', 'rerolls', 'banishes', 'skips'].includes(k)) r.err(np, `unknown effect kind '${k}'`);
        else if (!isNum(n.effect.params.value)) r.err(np, 'effect.params.value');
      }
    }
    for (const n of t.nodes) if (n.requires !== undefined && !t.nodes.some((o) => o.id === n.requires && o.row < n.row)) r.err(`${p} node '${n.id}'`, `requires '${n.requires}' must be an earlier-row node`);
    // reachability: row r opens after 5·r points in the rows above
    let above = 0;
    for (let row = 0; row <= 4; row++) {
      if (!rows.has(row)) r.err(p, `row ${row} has no nodes`);
      if (row > 0 && above < 5 * row) r.err(p, `rows above row ${row} hold only ${above} points (< ${5 * row})`);
      above += rows.get(row) ?? 0;
    }
    if (capacity < 30) r.err(p, `capacity ${capacity} < 30 (cannot reach the last milestone)`);
    const startLevels = t.nodes.filter((n) => n.effect?.kind === 'startLevel').length;
    if (startLevels > 1) r.err(p, 'at most one startLevel node per tree');
    if (t.milestones.length !== 3 || t.milestones.map((m) => m.at).join() !== '10,20,30') r.err(p, 'milestones must be 10, 20, 30');
    for (const m of t.milestones) {
      if (!m.skill) {
        r.err(p, `milestone ${m.at} has no skill (milestones grant ultimates)`);
        continue;
      }
      const sk = bySkill.get(m.skill);
      if (!sk || sk.kind !== 'ultimate') r.err(p, `milestone ${m.at}: '${m.skill}' is not an ultimate`);
      else if (sk.unlock?.talentMilestone !== m.at || sk.classId !== t.classId || sk.doctrine !== key) r.err(p, `milestone ${m.at}: '${m.skill}' unlock/doctrine mismatch`);
    }
  }
}

function validateItems(r: Report, db: ContentDB, useIcon: (i: unknown, w: string) => void): void {
  for (const x of db.passives) {
    const p = `passive '${x.id}'`;
    useIcon(x.icon, p);
    checkMods(r, x.perRank, `${p}.perRank`);
    if (Object.keys(x.perRank).length === 0) r.err(p, 'empty perRank');
    if (!Number.isInteger(x.maxRank) || x.maxRank < 1) r.err(p, 'maxRank');
  }
  if (db.passives.length < db.balance.maxPassives + 4) r.err('passives', 'pool too small for the passive cap');
  for (const x of db.stones) {
    const p = `stone '${x.id}'`;
    useIcon(x.icon, p);
    if (x.slot !== 'weapon' && x.slot !== 'armor') r.err(p, 'slot');
    checkMods(r, x.perLevel, `${p}.perLevel`);
    if (Object.keys(x.perLevel).length === 0) r.err(p, 'empty perLevel');
    if (x.maxLevel !== 4) r.err(p, 'maxLevel must be 4 (+0..+4)');
  }
  for (const slot of ['weapon', 'armor'] as const) if (db.stones.filter((s) => s.slot === slot).length < 4) r.err('stones', `too few ${slot} stones`);
  for (const x of db.trinkets) {
    const p = `trinket '${x.id}'`;
    useIcon(x.icon, p);
    if (!['bracelet', 'necklace', 'earring'].includes(x.slot)) r.err(p, 'slot');
    const keys = TRINKET_EFFECT_KEYS[x.effect];
    if (!keys) r.err(p, `effect '${x.effect}'`);
    else for (const k of keys) if (!isNum(x.perRank[k]) || x.perRank[k] <= 0) r.err(p, `perRank.${k} required`);
    if (!Number.isInteger(x.maxRank) || x.maxRank < 1) r.err(p, 'maxRank');
  }
  for (const slot of ['bracelet', 'necklace', 'earring']) if (!db.trinkets.some((t) => t.slot === slot)) r.err('trinkets', `no ${slot} trinkets`);
  const emp = new Set(db.empires.map((e) => e.id));
  for (const id of ['saehwa', 'chowon', 'jihae']) if (!emp.has(id as 'saehwa')) r.err('empires', `missing empire '${id}'`);
  for (const e of db.empires) {
    if (!HEX.test(e.color)) r.err(`empire '${e.id}'`, 'color');
    checkMods(r, e.bonus, `empire '${e.id}'.bonus`);
    if (e.edict !== undefined) {
      const ep = `empire '${e.id}'.edict`;
      const o = checkObject(r, ep, e.edict, ['rerolls', 'banishes', 'skips']);
      if (o) checkOptionalRanges(r, ep, o, { rerolls: EDICT, banishes: EDICT, skips: EDICT });
    }
  }
}

function validateEnemyBase(r: Report, e: EnemyDef, p: string, modelIds: Set<string>, audioIds: Set<string>, vfxIds: Set<string>): void {
  if (!isStr(e.model) || !SNAKE.test(e.model)) r.err(p, 'model id');
  else modelIds.add(e.model);
  if (!RANKS.includes(e.rank)) r.err(p, `rank '${e.rank}'`);
  if (!AI_KINDS.includes(e.ai)) r.err(p, `ai '${e.ai}'`);
  if (e.race.length === 0 || e.race.some((x) => !RACES.includes(x))) r.err(p, 'race tags');
  for (const k of ['scale', 'hp', 'speed', 'radius', 'mass'] as const) if (!isNum(e[k]) || e[k] <= 0) r.err(p, `${k} must be > 0`);
  for (const k of ['damage', 'xp', 'level'] as const) if (!isNum(e[k]) || e[k] < 0) r.err(p, `${k} must be >= 0`);
  if (e.tint !== undefined && !HEX.test(e.tint)) r.err(p, 'tint must be #rrggbb');
  if (e.tintMode !== undefined && (e.tint === undefined || (e.tintMode !== 'multiply' && e.tintMode !== 'colorize'))) r.err(p, 'tintMode needs a tint and must be multiply|colorize');
  if (e.yeop.length !== 2 || !isNum(e.yeop[0]) || !isNum(e.yeop[1]) || e.yeop[0] < 0 || e.yeop[1] < e.yeop[0]) r.err(p, 'yeop range');
  if (e.attacks.length === 0) r.err(p, 'needs at least one attack');
  for (const a of e.attacks) {
    if (!ATTACK_KINDS.includes(a.kind)) r.err(p, `attack kind '${a.kind}'`);
    if (!isNum(a.range) || a.range <= 0 || !isNum(a.cooldown) || a.cooldown <= 0 || !isNum(a.windup) || a.windup < 0 || !isNum(a.damageMul) || a.damageMul <= 0) r.err(p, `attack ${a.kind} numbers`);
    if (a.kind === 'ranged') {
      if (!a.projectile || !isNum(a.projectile.speed) || a.projectile.speed <= 0 || !isNum(a.projectile.radius) || a.projectile.radius <= 0) r.err(p, 'ranged attack needs a projectile');
      else if (!isStr(a.projectile.vfx)) r.err(p, 'projectile vfx');
      else vfxIds.add(a.projectile.vfx);
    }
    if (['charge', 'leap', 'explode', 'aura', 'breath'].includes(a.kind) && (!isNum(a.area) || a.area <= 0)) r.err(p, `${a.kind} attack needs area`);
  }
  if (e.resist) for (const [k, v] of Object.entries(e.resist)) if (!ELEMENTS.includes(k) || !isNum(v)) r.err(p, `resist.${k}`);
  for (const k of ['hit', 'death', 'attack'] as const) {
    const id = e.sfx?.[k];
    if (id !== undefined) {
      if (!isStr(id)) r.err(p, `sfx.${k}`);
      else audioIds.add(id);
    }
  }
}

function validateEnemies(r: Report, db: ContentDB, enemyIds: Set<string>, bossIds: Set<string>, modelIds: Set<string>, audioIds: Set<string>, vfxIds: Set<string>): void {
  for (const e of db.enemies) {
    const p = `enemy '${e.id}'`;
    validateEnemyBase(r, e, p, modelIds, audioIds, vfxIds);
    if (e.rank === 'boss' || e.rank === 'king') r.err(p, 'regular enemies cannot be boss/king rank');
  }
  for (const b of db.bosses) {
    const p = `boss '${b.id}'`;
    validateEnemyBase(r, b, p, modelIds, audioIds, vfxIds);
    if (b.rank !== 'boss' && b.rank !== 'king') r.err(p, 'bosses must be rank boss/king');
    if (!isStr(b.title.tr) || !isStr(b.intro.tr)) r.err(p, 'title/intro');
    if (!isNum(b.enrageAfter) || b.enrageAfter <= 0) r.err(p, 'enrageAfter');
    if (!b.loot || !Number.isInteger(b.loot.gearTier) || b.loot.gearTier < 1 || b.loot.gearTier > 4) r.err(p, 'loot.gearTier 1..4');
    if (b.music !== undefined) audioIds.add(b.music);
    if (!b.escorts || b.escorts.length === 0 || b.escorts.length > 4) r.err(p, 'escorts: 1-4 enemy ids required');
    for (const id of b.escorts ?? []) if (!enemyIds.has(id)) r.err(p, `escort '${id}' unknown`);
    const pids = uniqueIds(r, `${p} patterns`, b.patterns.map((x) => x.id));
    for (const pat of b.patterns) {
      const pp = `${p} pattern '${pat.id}'`;
      const need = BOSS_PATTERN_PARAMS[pat.kind];
      if (!need) {
        r.err(pp, `kind '${pat.kind}'`);
        continue;
      }
      for (const k of need) if (!isNum(pat.params[k])) r.err(pp, `params.${k} missing`);
      for (const k of Object.keys(pat.params)) if (!need.includes(k)) r.err(pp, `unknown param '${k}'`);
      if (!isNum(pat.cooldown) || pat.cooldown <= 0 || !isNum(pat.windup) || pat.windup < 0) r.err(pp, 'cooldown/windup');
      if (pat.vfx !== undefined) vfxIds.add(pat.vfx);
      if (pat.sfx !== undefined) audioIds.add(pat.sfx);
    }
    if (b.phases.length === 0 || b.phases[0]?.hpPct !== 1) r.err(p, 'first phase must start at hpPct 1');
    let prev = 2;
    for (const ph of b.phases) {
      if (!(ph.hpPct < prev) || ph.hpPct <= 0) r.err(p, 'phase hpPct must strictly decrease within (0,1]');
      prev = ph.hpPct;
      if (ph.patterns.length === 0) r.err(p, 'empty phase');
      for (const id of ph.patterns) if (!pids.has(id)) r.err(p, `phase references unknown pattern '${id}'`);
    }
    const used = new Set(b.phases.flatMap((x) => x.patterns));
    for (const id of pids) if (!used.has(id)) r.warn(p, `pattern '${id}' is never used by a phase`);
  }
  void bossIds;
}

function validateMetins(r: Report, db: ContentDB, enemyIds: Set<string>, modelIds: Set<string>): void {
  for (const m of db.metins) {
    const p = `metin '${m.id}'`;
    if (!HEX.test(m.rune)) r.err(p, 'rune color');
    if (!isStr(m.model)) r.err(p, 'model');
    else modelIds.add(m.model);
    if (!isNum(m.hp) || m.hp <= 0) r.err(p, 'hp');
    if (!MODIFIERS.includes(m.modifier)) r.err(p, `modifier '${m.modifier}'`);
    for (const k of MODIFIER_PARAMS[m.modifier] ?? []) if (!isNum(m.modParams[k])) r.err(p, `modParams.${k} required by '${m.modifier}'`);
    for (const t of WAVE_THRESHOLDS) {
      const v = m.modParams[`wave_${t}`];
      if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 6) r.err(p, `modParams.wave_${t} must be an integer 0..6`);
    }
    const sMin = m.modParams.waveSizeMin;
    const sMax = m.modParams.waveSizeMax;
    if (!Number.isInteger(sMin) || !Number.isInteger(sMax) || (sMin as number) < 1 || (sMax as number) < (sMin as number)) r.err(p, 'waveSizeMin/Max');
    if (!isNum(m.modParams.waveRingMin) || !isNum(m.modParams.waveRingMax) || (m.modParams.waveRingMax as number) <= (m.modParams.waveRingMin as number)) r.err(p, 'waveRingMin/Max');
    if (m.swarm.enemies.length === 0 || !isNum(m.swarm.every) || m.swarm.every <= 0 || !isNum(m.swarm.count) || m.swarm.count < 1) r.err(p, 'swarm');
    for (const e of m.swarm.enemies) if (!enemyIds.has(e)) r.err(p, `swarm enemy '${e}' unknown`);
    if (!isNum(m.awakenAfter) || m.awakenAfter <= 0) r.err(p, 'awakenAfter');
    const rw = m.rewards;
    if (!isNum(rw.essence) || rw.essence < 0 || !isNum(rw.shards) || rw.shards < 0 || !isNum(rw.chestChance) || rw.chestChance < 0 || rw.chestChance > 1) r.err(p, 'rewards');
    if (rw.yeop.length !== 2 || rw.yeop[0] < 0 || rw.yeop[1] < rw.yeop[0]) r.err(p, 'rewards.yeop');
    if (m.great && rw.essence !== 0) r.err(p, 'great metins grant no essence (the boss is the reward)');
  }
}

function validateZones(r: Report, db: ContentDB, enemyIds: Set<string>, bossIds: Set<string>, metinIds: Set<string>, zoneIds: Set<string>, textureIds: Set<string>, audioIds: Set<string>): void {
  const bossById = new Map(db.bosses.map((b) => [b.id, b]));
  const metinById = new Map(db.metins.map((m) => [m.id, m]));
  const orders = db.zones.map((z) => z.order).sort((a, b) => a - b);
  if (orders.some((o, i) => o !== i + 1)) r.err('zones', 'order must be 1..N without gaps');
  const greatUsed = new Set<string>();
  for (const z of db.zones) {
    const p = `zone '${z.id}'`;
    if (z.biome.id !== z.id) r.err(p, 'biome.id must equal the zone id');
    if (!Array.isArray(z.levelRange) || z.levelRange[0] > z.levelRange[1]) r.err(p, 'levelRange');
    if (z.story.intro.length === 0 || z.story.victory.length === 0 || z.story.defeat.length === 0 || !z.story.bossIntro) r.err(p, 'story intro/bossIntro/victory/defeat required');
    const b = z.biome;
    for (const [k, v] of [['fog.color', b.fog.color], ['sky.top', b.sky.top], ['sky.horizon', b.sky.horizon], ['sky.bottom', b.sky.bottom], ['sun.color', b.sun.color], ['ambient.sky', b.ambient.sky], ['ambient.ground', b.ambient.ground]] as const) {
      if (!HEX.test(v)) r.err(p, `biome.${k} must be #rrggbb`);
    }
    if (!(b.fog.near >= 0 && b.fog.far > b.fog.near)) r.err(p, 'fog near/far');
    if (b.sun.dir.length !== 3 || !b.sun.dir.every(isNum) || b.sun.dir[1] <= 0) r.err(p, 'sun.dir must be a direction toward the sun (y > 0)');
    if (b.ground.length === 0) r.err(p, 'biome.ground');
    b.ground.forEach((t) => textureIds.add(t));
    textureIds.add(z.art);
    for (const k of ['calm', 'combat', 'boss'] as const) audioIds.add(z.music[k]);

    // bands: contiguous cover of the whole run
    if (z.bands.length === 0) r.err(p, 'no bands');
    let at = 0;
    z.bands.forEach((band, i) => {
      const bp = `${p} band ${i}`;
      if (band.from !== at) r.err(bp, `must start at ${at} (starts at ${band.from})`);
      if (!(band.to > band.from)) r.err(bp, 'to <= from');
      at = band.to;
      if (!isNum(band.rate) || band.rate <= 0) r.err(bp, 'rate');
      if (!Number.isInteger(band.maxAlive) || band.maxAlive <= 0 || band.maxAlive > MAX_ALIVE_CAP) r.err(bp, `maxAlive 1..${MAX_ALIVE_CAP}`);
      if (band.spawns.length === 0) r.err(bp, 'no spawns');
      for (const s of band.spawns) {
        if (!enemyIds.has(s.enemy)) r.err(bp, `spawn enemy '${s.enemy}' unknown`);
        if (!isNum(s.weight) || s.weight <= 0) r.err(bp, `weight of '${s.enemy}'`);
        if (s.group) {
          if (s.group.leader !== undefined && !enemyIds.has(s.group.leader)) r.err(bp, `group leader '${s.group.leader}' unknown`);
          if (s.group.members.length === 0) r.err(bp, 'empty group');
          for (const m of s.group.members) if (!enemyIds.has(m)) r.err(bp, `group member '${m}' unknown`);
          const [lo, hi] = s.group.size;
          if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < 1 || hi < lo) r.err(bp, 'group size');
        }
      }
      if (band.elites) {
        if (!isNum(band.elites.every) || band.elites.every <= 0 || band.elites.pool.length === 0) r.err(bp, 'elites');
        for (const e of band.elites.pool) if (!enemyIds.has(e)) r.err(bp, `elite '${e}' unknown`);
      }
    });
    if (at !== RUN_LENGTH) r.err(p, `bands must end at ${RUN_LENGTH} (end at ${at})`);

    // bosses: four timed + the final
    if (z.bosses.length !== 4) r.err(p, 'needs 4 timed bosses');
    z.bosses.forEach((slot, i) => {
      if (slot.at !== 180 * (i + 1)) r.err(p, `timed boss ${i} must spawn at ${180 * (i + 1)} s`);
      const bd = bossById.get(slot.boss);
      if (!bd) r.err(p, `timed boss '${slot.boss}' unknown`);
      else if (bd.loot.gearTier !== z.gearTier) r.err(p, `boss '${slot.boss}' gearTier mismatch`);
    });
    if (z.final.at !== RUN_LENGTH) r.err(p, `final must spawn at ${RUN_LENGTH} s`);
    checkObject(r, `${p}.final`, z.final, ['at', 'boss', 'greatMetin', 'hpMul']);
    if (z.final.hpMul !== undefined) checkRange(r, p, 'final.hpMul', z.final.hpMul, MUL);
    if (z.xpMul !== undefined) checkRange(r, p, 'xpMul', z.xpMul, MUL);
    if (z.hard !== undefined) {
      const o = checkObject(r, `${p}.hard`, z.hard, HARD_MUL_KEYS);
      if (o) checkOptionalRanges(r, `${p}.hard`, o, { awakenMul: MUL, eliteEveryMul: MUL, finalEnrageMul: MUL });
    }
    const fb = bossById.get(z.final.boss);
    if (!fb) r.err(p, `final boss '${z.final.boss}' unknown`);
    else if (fb.rank !== 'boss' && fb.rank !== 'king') r.err(p, 'final boss rank');
    const all = [...z.bosses.map((x) => x.boss), z.final.boss];
    if (new Set(all).size !== all.length) r.err(p, 'duplicate boss within the zone');
    const gm = metinById.get(z.final.greatMetin);
    if (!gm?.great) r.err(p, `greatMetin '${z.final.greatMetin}' must be a metin with great:true`);
    else if (greatUsed.has(gm.id)) r.err(p, 'great metin shared between zones');
    else greatUsed.add(gm.id);
    // metins
    if (z.metins.types.length === 0) r.err(p, 'no metin types');
    for (const t of z.metins.types) {
      if (!metinIds.has(t)) r.err(p, `metin type '${t}' unknown`);
      else if (metinById.get(t)?.great) r.err(p, `metin type '${t}' is a great metin`);
    }
    if (!isNum(z.metins.firstAt) || z.metins.firstAt < 0 || z.metins.interval[0] <= 0 || z.metins.interval[1] < z.metins.interval[0]) r.err(p, 'metins timing');
    // the swarm roster of every metin must be creatures that the zone itself fields (bands, elites, packs)
    const roster = new Set<string>();
    for (const band of z.bands) {
      for (const s of band.spawns) {
        roster.add(s.enemy);
        s.group?.members.forEach((m) => roster.add(m));
        if (s.group?.leader) roster.add(s.group.leader);
      }
      band.elites?.pool.forEach((e) => roster.add(e));
    }
    for (const mid of [...z.metins.types, z.final.greatMetin]) {
      const m = metinById.get(mid);
      if (m) for (const e of m.swarm.enemies) if (!roster.has(e)) r.warn(p, `metin '${mid}' swarms '${e}' which the zone never spawns itself`);
    }
    if (!Number.isInteger(z.gearTier) || z.gearTier < 1 || z.gearTier > 4) r.err(p, 'gearTier 1..4');
    if (z.unlock && !zoneIds.has(z.unlock.zone)) r.err(p, `unlock zone '${z.unlock.zone}' unknown`);
    if (z.unlock && (db.zones.find((o) => o.id === z.unlock?.zone)?.order ?? 99) >= z.order) r.err(p, 'unlock must reference an earlier zone');
    if (z.order > 1 && !z.unlock) r.err(p, 'zones after the first need an unlock');
  }
  void bossIds;
}

/** balance.pacts / chest / overflow (all optional; absent = off = today) */
function validateRogueliteBalance(r: Report, db: ContentDB): void {
  const b = db.balance;
  if (b.pacts !== undefined) {
    const p = 'balance.pacts';
    const o = checkObject(r, p, b.pacts, ['rank', 'byBehavior', 'readyWeight']);
    if (o) {
      if (o.rank !== undefined) checkRange(r, p, 'rank', o.rank, { lo: 0, hi: 10, int: true });
      if (o.readyWeight !== undefined) checkRange(r, p, 'readyWeight', o.readyWeight, { lo: 1, hi: 20 });
      const rank = isInt(o.rank) ? o.rank : 0;
      if (o.byBehavior !== undefined && !isObj(o.byBehavior)) r.err(p, 'byBehavior must be an object (behavior -> passive id)');
      const bb = isObj(o.byBehavior) ? o.byBehavior : {};
      const passives = new Map(db.passives.map((x) => [x.id, x]));
      for (const [beh, pid] of Object.entries(bb)) {
        if (!BEHAVIORS.includes(beh)) {
          r.err(`${p}.byBehavior`, `unknown behavior '${beh}' (${BEHAVIORS.join(', ')})`);
          continue;
        }
        const pass = typeof pid === 'string' ? passives.get(pid) : undefined;
        if (!pass) r.err(`${p}.byBehavior`, `${beh}: passive '${String(pid)}' unknown`);
        else if (rank > pass.maxRank) r.err(`${p}.byBehavior`, `${beh}: rank ${rank} exceeds the maxRank ${pass.maxRank} of passive '${pass.id}'`);
      }
      if (rank > 0) {
        for (const beh of BEHAVIORS) if (bb[beh] === undefined) r.err(`${p}.byBehavior`, `behavior '${beh}' has no pact passive (rank > 0 needs all ${BEHAVIORS.length} behaviors)`);
      }
    }
  }
  if (b.chest !== undefined) {
    const p = 'balance.chest';
    const o = checkObject(r, p, b.chest, ['eliteDrop', 'cards', 'bossMilestone']);
    if (o) {
      checkOptionalRanges(r, p, o, { eliteDrop: { lo: 0, hi: 1 }, cards: { lo: 1, hi: 4, int: true } });
      if (o.bossMilestone !== undefined && typeof o.bossMilestone !== 'boolean') r.err(p, `bossMilestone must be true or false (got ${JSON.stringify(o.bossMilestone)})`);
    }
  }
  if (b.overflow !== undefined) {
    const p = 'balance.overflow';
    const o = checkObject(r, p, b.overflow, ['shards', 'boon', 'shardsByRarity', 'boonDamage', 'boonHp', 'skipRefund']);
    if (o) {
      for (const k of ['shards', 'boon']) if (o[k] !== undefined && typeof o[k] !== 'boolean') r.err(p, `${k} must be true or false (got ${JSON.stringify(o[k])})`);
      checkOptionalRanges(r, p, o, { boonDamage: { lo: 0, hi: 0.5 }, boonHp: { lo: 0, hi: 0.5 }, skipRefund: { lo: 0, hi: 20, int: true } });
      const sr = o.shardsByRarity;
      if (sr !== undefined) {
        if (!Array.isArray(sr) || sr.length !== RARITIES.length) r.err(p, `shardsByRarity must be a list of ${RARITIES.length} integers (one per rarity: ${RARITIES.join(', ')})`);
        else sr.forEach((v, i) => checkRange(r, p, `shardsByRarity[${i}]`, v, { lo: 0, hi: 99, int: true }));
      }
    }
  }
}

/** accepted ranges of every run event parameter (all of them are required for every kind) */
const RUN_EVENT_PARAMS: Record<RunEventKind, Record<string, Range>> = {
  metinRain: { count: { lo: 1, hi: 8, int: true }, ringRadius: { lo: 2, hi: 40 }, within: { lo: 0, hi: 60, gt: true }, corruption: { lo: 0, hi: 1 } },
  championHunt: { hpMul: { lo: 1, hi: 50 }, dmgMul: { lo: 0, hi: 10, gt: true }, escorts: { lo: 0, hi: 12, int: true }, timeLimit: { lo: 0, hi: 300, gt: true }, chestTier: { lo: 0, hi: 2, int: true } },
  goldenHour: { duration: { lo: 0, hi: 300, gt: true }, eliteEveryMul: { lo: 0, hi: MUL_MAX, gt: true }, yeopMul: { lo: 0, hi: 10, gt: true } },
  bargain: { radius: { lo: 0, hi: 20, gt: true }, channel: { lo: 0, hi: 30, gt: true }, offers: { lo: 1, hi: 4, int: true } },
};

/** data/content/runEvents.json (optional as a whole; `zones: {}` = no events) */
function validateRunEvents(r: Report, db: ContentDB, zoneIds: Set<string>): void {
  if (db.runEvents === undefined) return;
  const p = 'runEvents';
  const o = checkObject(r, p, db.runEvents, ['window', 'bossGap', 'zones', 'kinds']);
  if (!o) return;
  let lo = Number.NaN;
  let hi = Number.NaN;
  const w = o.window;
  if (!Array.isArray(w) || w.length !== 2 || !isNum(w[0]) || !isNum(w[1]) || w[0] < 0 || w[0] >= w[1] || w[1] >= RUN_LENGTH) {
    r.err(p, `window must be [from, to] in seconds with 0 <= from < to < ${RUN_LENGTH} (got ${JSON.stringify(w) ?? 'undefined'})`);
  } else {
    lo = w[0];
    hi = w[1];
  }
  checkRange(r, p, 'bossGap', o.bossGap, { lo: 0, hi: 89 });
  const gap = isNum(o.bossGap) ? o.bossGap : Number.NaN;
  if (!isObj(o.zones)) r.err(p, 'zones must be an object (zone id -> event kinds; {} = no events)');
  else {
    for (const [zid, kinds] of Object.entries(o.zones)) {
      const zp = `${p}.zones.${zid}`;
      if (!zoneIds.has(zid)) {
        r.err(p, `zones: unknown zone '${zid}' (${[...zoneIds].join(', ')})`);
        continue;
      }
      if (!Array.isArray(kinds)) {
        r.err(zp, 'must be a list of event kinds');
        continue;
      }
      const seen = new Set<string>();
      for (const k of kinds as unknown[]) {
        if (typeof k !== 'string' || !(RUN_EVENT_KINDS as readonly string[]).includes(k)) r.err(zp, `unknown event kind '${String(k)}' (${RUN_EVENT_KINDS.join(', ')})`);
        else if (seen.has(k)) r.err(zp, `duplicate event kind '${k}'`);
        else seen.add(k);
      }
      // an event needs at least one start second that is bossGap away from every boss spawn of the zone
      const z = db.zones.find((x) => x.id === zid);
      if (kinds.length > 0 && z && Number.isFinite(lo) && Number.isFinite(gap)) {
        const times = [...z.bosses.map((x) => x.at), z.final.at];
        let free = false;
        for (let t = Math.ceil(lo); t <= hi && !free; t++) free = times.every((bt) => Math.abs(t - bt) >= gap);
        if (!free) r.err(zp, `no start second in the window [${lo}, ${hi}] is at least bossGap (${gap} s) away from every boss spawn`);
      }
    }
  }
  const ks = checkObject(r, `${p}.kinds`, o.kinds, RUN_EVENT_KINDS, 'event kind');
  if (ks) {
    for (const kind of RUN_EVENT_KINDS) {
      const kp = `${p}.kinds.${kind}`;
      if (ks[kind] === undefined) {
        r.err(`${p}.kinds`, `missing event kind '${kind}'`);
        continue;
      }
      const ranges = RUN_EVENT_PARAMS[kind];
      const ko = checkObject(r, kp, ks[kind], Object.keys(ranges));
      if (ko) for (const [k, g] of Object.entries(ranges)) checkRange(r, kp, k, ko[k], g);
    }
  }
}

/** accepted ranges of every affix parameter (all of them are required for every kind) */
const AFFIX_PARAMS: Record<AffixKind, Record<string, Range>> = {
  swift: { speed: { lo: 0, hi: 2, gt: true }, attackRate: { lo: 0, hi: 2, gt: true } },
  vampiric: { heal: { lo: 0, hi: 1, gt: true } },
  warded: { reduction: { lo: 0, hi: 0.9, gt: true }, above: { lo: 0, hi: 1, gt: true } },
  splitting: { copies: { lo: 1, hi: 4, int: true }, hp: { lo: 0, hi: 1, gt: true } },
};

/** data/content/affixes.json (optional as a whole; `enabled: false` = no affixes) */
function validateAffixes(r: Report, db: ContentDB): void {
  if (db.affixes === undefined) return;
  const p = 'affixes';
  const o = checkObject(r, p, db.affixes, ['enabled', 'fromBand', 'weights', 'params', 'bossOnHard', 'bossKinds']);
  if (!o) return;
  for (const k of ['enabled', 'bossOnHard']) if (typeof o[k] !== 'boolean') r.err(p, `${k} must be true or false (got ${JSON.stringify(o[k]) ?? 'undefined'})`);
  const bands = db.zones.length > 0 ? Math.min(...db.zones.map((z) => z.bands.length)) : RUN_LENGTH / BAND_LENGTH;
  checkRange(r, p, 'fromBand', o.fromBand, { lo: 0, hi: bands - 1, int: true });
  const ws = checkObject(r, `${p}.weights`, o.weights, AFFIX_KINDS, 'affix kind');
  if (ws) {
    let sum = 0;
    for (const kind of AFFIX_KINDS) {
      if (ws[kind] === undefined) r.err(`${p}.weights`, `missing affix kind '${kind}'`);
      else {
        checkRange(r, `${p}.weights`, kind, ws[kind], { lo: 0, hi: 100 });
        if (isNum(ws[kind])) sum += ws[kind] as number;
      }
    }
    if (sum <= 0) r.err(`${p}.weights`, 'at least one weight must be > 0');
  }
  const ps = checkObject(r, `${p}.params`, o.params, AFFIX_KINDS, 'affix kind');
  if (ps) {
    for (const kind of AFFIX_KINDS) {
      const kp = `${p}.params.${kind}`;
      if (ps[kind] === undefined) {
        r.err(`${p}.params`, `missing affix kind '${kind}'`);
        continue;
      }
      const ranges = AFFIX_PARAMS[kind];
      const ko = checkObject(r, kp, ps[kind], Object.keys(ranges));
      if (ko) for (const [k, g] of Object.entries(ranges)) checkRange(r, kp, k, ko[k], g);
    }
  }
  if (!Array.isArray(o.bossKinds)) r.err(p, 'bossKinds must be a list of affix kinds');
  else {
    const seen = new Set<string>();
    for (const k of o.bossKinds as unknown[]) {
      if (typeof k !== 'string' || !(AFFIX_KINDS as readonly string[]).includes(k)) r.err(p, `bossKinds: unknown affix kind '${String(k)}' (${AFFIX_KINDS.join(', ')})`);
      else if (seen.has(k)) r.err(p, `bossKinds: duplicate affix kind '${k}'`);
      else seen.add(k);
    }
    if (o.bossOnHard === true && o.bossKinds.length === 0) r.err(p, 'bossKinds must not be empty while bossOnHard is true');
  }
}

function validateGear(r: Report, db: ContentDB, bossIds: Set<string>, zoneIds: Set<string>, modelIds: Set<string>): void {
  const zoneById = new Map(db.zones.map((z) => [z.id, z]));
  const combos = new Set<string>();
  for (const g of db.gear) {
    const p = `gear '${g.id}'`;
    if (!GEAR_SLOTS.includes(g.slot)) r.err(p, 'slot');
    if (g.classes.length === 0 || g.classes.some((c) => !CLASS_IDS.includes(c))) r.err(p, 'classes');
    if (!Number.isInteger(g.tier) || g.tier < 1 || g.tier > 4) r.err(p, 'tier 1..4');
    checkMods(r, g.stats, `${p}.stats`);
    checkMods(r, g.perPlus, `${p}.perPlus`);
    if (Object.keys(g.stats).length === 0 || Object.keys(g.perPlus).length === 0) r.err(p, 'stats/perPlus must not be empty');
    if (g.model !== undefined) modelIds.add(g.model);
    if (!zoneIds.has(g.source.zone)) r.err(p, `source zone '${g.source.zone}' unknown`);
    if (!isNum(g.source.chance) || g.source.chance <= 0 || g.source.chance > 1) r.err(p, 'source.chance');
    const z = zoneById.get(g.source.zone);
    if (z && z.gearTier !== g.tier) r.err(p, `tier ${g.tier} != zone gearTier ${z.gearTier}`);
    if (g.source.boss !== undefined) {
      if (!bossIds.has(g.source.boss)) r.err(p, `source boss '${g.source.boss}' unknown`);
      else if (z && ![...z.bosses.map((b) => b.boss), z.final.boss].includes(g.source.boss)) r.err(p, `boss '${g.source.boss}' does not appear in zone '${g.source.zone}'`);
    }
    for (const c of g.classes) combos.add(`${c}/${g.slot}/${g.tier}`);
  }
  for (const c of CLASS_IDS) for (const slot of GEAR_SLOTS) for (let t = 1; t <= 4; t++) if (!combos.has(`${c}/${slot}/${t}`)) r.err('gear', `no ${slot} for ${c} at tier ${t}`);
}

function validateStory(r: Report, db: ContentDB, zoneIds: Set<string>, bossIds: Set<string>, metinIds: Set<string>, enemyIds: Set<string>): void {
  const s = db.story;
  if (s.prologue.length < 3) r.err('story', 'prologue too short');
  const ch = new Set(s.chapters.map((c) => c.zone));
  for (const z of db.zones) if (!ch.has(z.id)) r.err('story', `no chapter for zone '${z.id}'`);
  for (const c of s.chapters) if (!zoneIds.has(c.zone) || c.text.length === 0) r.err('story', `chapter '${c.zone}'`);
  const ids = uniqueIds(r, 'story.codex', s.codex.map((e) => e.id));
  const classIds = new Set<string>(CLASS_IDS);
  for (const e of s.codex) {
    const p = `codex '${e.id}'`;
    if (!CODEX_UNLOCK.test(e.unlock)) r.err(p, `unlock '${e.unlock}' does not follow the grammar`);
    const [kind, arg = ''] = e.unlock.split(':');
    const table: Record<string, Set<string> | undefined> = { enter: zoneIds, zone: zoneIds, clear: zoneIds, hard: zoneIds, boss: bossIds, metin: metinIds, class: classIds };
    const set = kind ? table[kind] : undefined;
    if (set && !set.has(arg)) r.err(p, `unlock refers to unknown id '${arg}'`);
  }
  for (const id of enemyIds) if (!ids.has(`codex_enemy_${id}`)) r.err('story.codex', `missing entry codex_enemy_${id}`);
  for (const id of bossIds) if (!ids.has(`codex_boss_${id}`)) r.err('story.codex', `missing entry codex_boss_${id}`);
  for (const id of metinIds) if (!ids.has(`codex_metin_${id}`)) r.err('story.codex', `missing entry codex_metin_${id}`);
}

function checkAssets(r: Report, options: ValidateOptions, used: { modelIds: Set<string>; iconIds: Map<string, string>; textureIds: Set<string>; audioIds: Set<string>; vfxIds: Set<string> }): void {
  const a = options.assets;
  if (!a) return;
  const strictFor = (kind: AssetKind): boolean => (typeof options.strict === 'object' ? options.strict[kind] === true : options.strict === true);
  const report = (kind: AssetKind, id: string, owner: string): void => {
    const msg = `${kind.slice(0, -1) || kind} '${id}' is not in the asset index${owner ? ` (${owner})` : ''}`;
    if (strictFor(kind)) r.err('assets', msg);
    else r.warn('assets', msg);
  };
  if (a.models) for (const id of used.modelIds) if (!a.models.has(id)) report('models', id, '');
  if (a.icons) for (const [id, owner] of used.iconIds) if (!a.icons.has(id)) report('icons', id, owner);
  if (a.textures) for (const id of used.textureIds) if (!a.textures.has(id)) report('textures', id, '');
  if (a.audio) for (const id of used.audioIds) if (!a.audio.has(id)) report('audio', id, '');
  const vfx = a.vfx;
  if (vfx) for (const id of used.vfxIds) if (!vfx(id)) report('vfx', id, '');
}

/** enemies nothing spawns: reported as warnings (dead content) */
function warnOrphans(r: Report, db: ContentDB): void {
  const used = new Set<string>();
  for (const z of db.zones) {
    for (const band of z.bands) {
      for (const s of band.spawns) {
        used.add(s.enemy);
        s.group?.members.forEach((m) => used.add(m));
        if (s.group?.leader) used.add(s.group.leader);
      }
      band.elites?.pool.forEach((e) => used.add(e));
    }
  }
  for (const m of db.metins) m.swarm.enemies.forEach((e) => used.add(e));
  for (const e of db.enemies) if (!used.has(e.id)) r.warn(`enemy '${e.id}'`, 'is never spawned by any band, pack, elite pool or metin');
}
