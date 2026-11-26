// Content schema — the typed contract for every piece of game data.
// Owner: orchestrator. Content JSON: apps/game/src/data/content/<collection>.json (owner: CONTENT).


export type Lang = 'tr' | 'en';
export interface L10n {
  tr: string;
  en: string;
}

export type ClassId = 'warrior' | 'ninja' | 'yacha' | 'shaman' | 'wolfman';
export type DoctrineKey = 'a' | 'b';
export type DoctrineId = `${ClassId}_${DoctrineKey}`;
export type EmpireId = 'saehwa' | 'chowon' | 'jihae';
export type Sex = 'm' | 'f';
export type Difficulty = 'normal' | 'hard';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export const RARITIES: readonly Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
/** Card rarity scales the magnitude of every upgrade line on the card. */
export const RARITY_MULT: Record<Rarity, number> = {
  common: 1,
  uncommon: 1.35,
  rare: 1.7,
  epic: 2.1,
  legendary: 2.6,
};


export const SKILL_RANKS = ['1', '2', '3', 'M1', 'M2', 'G1', 'G2', 'P'] as const;
export type SkillRankLabel = (typeof SKILL_RANKS)[number];
export const MAX_SKILL_RANK = SKILL_RANKS.length - 1;

export type Element = 'physical' | 'fire' | 'ice' | 'lightning' | 'dark' | 'poison' | 'holy' | 'wind';

export type RaceTag =
  | 'animal'
  | 'orc'
  | 'esoteric'
  | 'undead'
  | 'devil'
  | 'insect'
  | 'desert'
  | 'ice'
  | 'fire'
  | 'dragon'
  | 'human'
  | 'metin';
export type StatusKind = 'slow' | 'poison' | 'burn' | 'stun' | 'freeze' | 'bleed' | 'fear' | 'weaken';

export interface StatusEffect {
  kind: StatusKind;
  /** 0..1 proc chance per hit */
  chance: number;
  /** seconds */
  duration: number;
  /** slow: fraction; poison/burn/bleed: dps as fraction of hit damage; weaken: damage-taken bonus */
  power: number;
}

/**
 * Additive player stat modifiers. Percent-like values are fractions (0.1 = +10%).
 * Final value = (base + Σflat) × (1 + Σpct). Caps live in BalanceConfig.
 */
export interface StatMods {
  maxHp?: number;
  maxHpPct?: number;
  armor?: number;
  regen?: number;
  moveSpeed?: number;
  damage?: number;
  critChance?: number;
  critDamage?: number;
  cooldown?: number;
  area?: number;
  duration?: number;
  projectiles?: number;
  projSpeed?: number;
  pierce?: number;
  xpGain?: number;
  yeopGain?: number;
  pickupRadius?: number;
  luck?: number;
  revives?: number;
  lifesteal?: number;
  attackSpeed?: number;
  evasion?: number;
  thorns?: number;
  vsRace?: Partial<Record<RaceTag, number>>;
  vsBoss?: number;
  resist?: Partial<Record<Element, number>>;
}

// ---------------------------------------------------------------------------
// Skills

export type BehaviorKind =
  | 'meleeArc'
  | 'spinAura'
  | 'persistentAura'
  | 'dash'
  | 'projectile'
  | 'homingProjectile'
  | 'skyStrike'
  | 'chain'
  | 'groundZone'
  | 'orbit'
  | 'cone'
  | 'shockwave'
  | 'selfBuff'
  | 'summon'
  | 'leap'
  | 'beam';

export interface SkillParams {
  /** damage per hit at rank 1, before player multipliers */
  damage: number;
  /** seconds between activations */
  cooldown: number;
  /** radius / arc length / beam width in meters (behavior-specific) */
  area: number;
  /** projectiles, strikes, orbitals, chain jumps, summons */
  count: number;
  /** seconds (zones, auras, buffs, summons, orbit lifetime) */
  duration: number;
  /** projectile / dash / orbit speed m/s (rad/s for orbit) */
  speed: number;
  /** extra targets a projectile passes through */
  pierce: number;
  /** knockback impulse in meters */
  knockback: number;
  /** seconds between damage ticks for auras/zones/beams; 0 = single hit */
  tick: number;
  /** targeting / travel range in meters */
  range: number;
  /** melee arc / cone angle in radians (meleeArc, cone) */
  angle?: number;
  status?: StatusEffect;
  /** hp healed per activation (selfBuff, lifesteal auras) */
  heal?: number;
  /** temporary buff applied by selfBuff for `duration` seconds */
  buff?: StatMods;

  // ---- skill-logic payload keys (all optional; absent / 0 reproduces the legacy behavior). Units in comments; percent-like
  // values are WHOLE numbers in content (`shield: 11` = 11 %), params.ts turns them into fractions for FinalParams. ----
  /** s: creatures lose the hero as a target (stealth, smoke_bomb); scales with duration / base duration */
  veil?: number;
  /** m: bait radius of a decoy / knight that pulls creature movement */
  taunt?: number;
  /** % of the HOLDER's max HP: ward pool size (grown by the heal upgrade lines / healAdd) */
  shield?: number;
  /** m: radius of the ward's end burst (scales with the area multipliers) */
  burst?: number;
  /** %: shell burst = damage + power % of the absorbed amount; mimic copy %; wolf pack bonus; pylon arc %; oath HP floor */
  power?: number;
  /** 0 | 1: lifesteal refills the ward first */
  drain?: number;
  /** m: hostile bolts entering this radius around the holder are turned back (reflect) */
  mirror?: number;
  /** 0 | 1: pushes are ignored while the shell lives (graniteform) */
  steady?: number;
  /** m: buff, heal and ward also land on living allies in range (co-op; solo = self); coil host search radius */
  party?: number;
  /** m: radius of a burst at the cast (now allowed in the base kit; awakening `nova` takes the max) */
  nova?: number;
  /** x damage of that burst (default 0.6) */
  novaDamage?: number;
  /** % of max HP paid at the cast (never kills; blocked below trigger.minHp) */
  cost?: number;
  /** K: the K toughest foes in `range` get the skill status */
  mark?: number;
  /** s: between spectral bites on the nearest foe while the window is up */
  pulse?: number;
  /** % buff gain per kill (cap in balance.triggers.stackCap) */
  stack?: number;
  /** s added to the running window per kill (cap in balance.triggers.extendCap) */
  extend?: number;
  /** s taken off the cooldown per kill (cap in balance.triggers.refundCap) */
  refund?: number;
  /** s: Dispel sigil strips metin corruption / shadow flicker from creatures inside for this long */
  purge?: number;
  /** x: second_wind damage x (1 + missing x missing-HP fraction) */
  missing?: number;
  /** %: second_wind share of the damage dealt that heals the hero */
  leech?: number;
}

/** numeric optional SkillParams keys added by the skill-logic redesign (loader validation, tests, tooling) */
export const SKILL_PAYLOAD_KEYS = [
  'veil', 'taunt', 'shield', 'burst', 'power', 'drain', 'mirror', 'steady', 'party', 'nova', 'novaDamage', 'cost', 'mark',
  'pulse', 'stack', 'extend', 'refund', 'purge', 'missing', 'leech',
] as const;
export type SkillPayloadKey = (typeof SKILL_PAYLOAD_KEYS)[number];

/**
 * When a context skill auto-casts (DESIGN §4.1). A skill with a `trigger` stays ARMED (cd 0, retried every tick) until one
 * of `any` is true; `cooldown` is then the LOCKOUT after a fire.
 *  engaged  >= balance.triggers.engaged.n creatures within engaged.r
 *  pinned   >= `n` (default pinned.n) creatures within pinned.r
 *  hurt     lost >= hurt.frac of max HP within hurt.window s (measured after armor, before ward / shield)
 *  danger   HP <= `hp` (default danger.hp) of max, or lost >= danger.lossFrac within danger.window s
 *  elite    an elite or boss within elite.r
 *  boss     a boss within boss.r
 *  volley   >= volley.n hostile bolts within volley.r
 *  ally     a living ally within the skill's party radius (ally.r when party is 0) is hurt or at <= ally.hp of max HP
 *  lethal   a blow that would bring HP to 0 (evaluated in hurtPlayer; War Oath)
 */
export type TriggerKind = 'engaged' | 'pinned' | 'hurt' | 'danger' | 'elite' | 'boss' | 'volley' | 'ally' | 'lethal';
export const TRIGGER_KINDS: readonly TriggerKind[] = ['engaged', 'pinned', 'hurt', 'danger', 'elite', 'boss', 'volley', 'ally', 'lethal'];

export interface TriggerSpec {
  /** open when ANY of these kinds is true (non-empty, no duplicates) */
  any: TriggerKind[];
  /** seconds armed before the gate relaxes to `engaged` (0 / absent = never: pure insurance) */
  patience?: number;
  /** pinned threshold (integer >= 1) */
  n?: number;
  /** danger HP fraction (0..1) */
  hp?: number;
  /** the gate stays shut while HP / maxHp is below this fraction (cost skills; 0..1) */
  minHp?: number;
}

/** Summon brains (DESIGN M4). Absent = the legacy chaser. Only valid on `behavior: 'summon'`. */
export type SummonRole = 'orbiter' | 'coil' | 'hunter' | 'planted' | 'mimic';
export const SUMMON_ROLES: readonly SummonRole[] = ['orbiter', 'coil', 'hunter', 'planted', 'mimic'];

export type UpgradeStat =
  | 'damage'
  | 'cooldown'
  | 'area'
  | 'count'
  | 'duration'
  | 'speed'
  | 'pierce'
  | 'knockback'
  | 'tick'
  | 'range'
  | 'statusChance'
  | 'statusPower'
  | 'heal';

/** One upgrade line a level-up card can roll for a skill; magnitude × RARITY_MULT. */
export interface UpgradeLine {
  stat: UpgradeStat;
  /** magnitude at common rarity: pct → fraction (0.15 = +15%), flat → absolute */
  base: number;
  mode: 'pct' | 'flat';
  /** for cooldown/tick a positive base means "reduce by" */
}

export interface SkillDef {
  id: string;
  classId: ClassId | 'common';
  doctrine?: DoctrineKey;
  /** basic = doctrine auto-attack; active = card-acquired; ultimate = talent milestone */
  kind: 'basic' | 'active' | 'ultimate';
  name: L10n;
  /** may contain {damage} {cooldown} {area} {count} {duration} placeholders */
  desc: L10n;
  icon: string;
  behavior: BehaviorKind;
  element: Element;
  params: SkillParams;
  upgrades: UpgradeLine[];
  awaken: { desc: L10n; params: Record<string, number> };
  /** VFX preset id (vfx/presets) and SFX id (audio manifest) */
  vfx: string;
  sfx: string;
  /** hero animation clip to play on cast */
  heroClip?: string;
  unlock?: { talentMilestone?: 10 | 20 | 30 };
  /** context gate for the auto-cast (absent = fires on its cooldown, as before) */
  trigger?: TriggerSpec;
  /** summon brain (behavior 'summon' only; absent = the legacy chaser) */
  role?: SummonRole;
  /** standing StatMods that are always on while the skill is owned (insurance cards are never dead) */
  vigil?: StatMods;
}

export interface PassiveDef {
  id: string;
  name: L10n;
  desc: L10n;
  icon: string;
  perRank: StatMods;
  maxRank: number;
}

/** Soul pearls socketed during a run (Metin essence reward). */
export interface StoneDef {
  id: string;
  slot: 'weapon' | 'armor';
  name: L10n;
  desc: L10n;
  icon: string;
  perLevel: StatMods;
  /** +0..+4 */
  maxLevel: number;
}

export type TrinketEffect =
  | 'lifesteal'
  | 'chainHit'
  | 'stunChance'
  | 'slowChance'
  | 'poisonChance'
  | 'thorns'
  | 'critBurst'
  | 'shield';

/** Jewelry found during a run (Metin essence reward). */
export interface TrinketDef {
  id: string;
  slot: 'bracelet' | 'necklace' | 'earring';
  name: L10n;
  desc: L10n;
  icon: string;
  effect: TrinketEffect;
  perRank: Record<string, number>;
  maxRank: number;
}

// ---------------------------------------------------------------------------
// Enemies, bosses, metins


export type EnemyRank = 'pawn' | 'pawnElite' | 'knight' | 'knightElite' | 'boss' | 'king';
export type AttackKind = 'melee' | 'ranged' | 'charge' | 'leap' | 'explode' | 'aura' | 'breath';

export interface EnemyAttack {
  kind: AttackKind;
  /** meters */
  range: number;
  /** seconds */
  cooldown: number;
  /** telegraph time before the hit lands (seconds) */
  windup: number;
  damageMul: number;
  projectile?: { speed: number; radius: number; vfx: string };
  area?: number;
}

export interface EnemyDef {
  id: string;
  name: L10n;
  model: string;
  /** uniform scale applied to the model */
  scale: number;
  /** optional tint for variants sharing a model (#rrggbb) */
  tint?: string;
  /**
   * How `tint` applies: 'multiply' (default) darkens/shifts the albedo; 'colorize' replaces hue/saturation with the
   * tint while keeping the albedo's luminance detail (needed for e.g. a white variant of an orange model).
   */
  tintMode?: 'multiply' | 'colorize';
  race: RaceTag[];
  rank: EnemyRank;
  level: number;
  hp: number;
  /** damage per hit before attack damageMul and time scaling */
  damage: number;
  /** m/s */
  speed: number;
  /** collision radius (m) */
  radius: number;
  /** push resistance; 1 = normal */
  mass: number;
  attacks: EnemyAttack[];
  xp: number;
  yeop: [number, number];
  ai: 'chase' | 'ranged' | 'charger' | 'swarm' | 'tank' | 'skirmisher';
  resist?: Partial<Record<Element, number>>;
  sfx?: { hit?: string; death?: string; attack?: string };
}

export type BossPatternKind =
  | 'slam'
  | 'charge'
  | 'volley'
  | 'summon'
  | 'ring'
  | 'breath'
  | 'meteor'
  | 'nova'
  | 'teleport'
  | 'enrage';

export interface BossPattern {
  id: string;
  kind: BossPatternKind;
  cooldown: number;
  windup: number;
  params: Record<string, number>;
  vfx?: string;
  sfx?: string;
}

export interface BossDef extends EnemyDef {
  title: L10n;
  intro: L10n;
  phases: { hpPct: number; patterns: string[] }[];
  patterns: BossPattern[];
  /** seconds alive after which the boss enrages (VS reaper equivalent) */
  enrageAfter: number;
  music?: string;
  loot: { gearTier: number; chest: boolean };
  
  escorts?: string[];
}

export type MetinModifier =
  | 'slowAura'
  | 'extraSwarm'
  | 'summonElite'
  | 'yeopRain'
  | 'darkness'
  | 'flicker'
  | 'fireRing'
  | 'poisonField'
  | 'damageAura';

export interface MetinDef {
  id: string;
  name: L10n;
  lore: L10n;
  /** rune glow color #rrggbb */
  rune: string;
  model: string;
  hp: number;
  modifier: MetinModifier;
  modParams: Record<string, number>;
  /** periodic swarm summoned from the zone roster */
  swarm: { enemies: string[]; every: number; count: number };
  /** seconds unbroken before it awakens */
  awakenAfter: number;
  rewards: { essence: number; yeop: [number, number]; shards: number; chestChance: number };
  /** true for the zone-final Great Metin */
  great?: boolean;
}

// ---------------------------------------------------------------------------
// Zones

export interface SpawnEntry {
  enemy: string;
  weight: number;
  /** spawn as a pack: optional leader + members */
  group?: { leader?: string; members: string[]; size: [number, number] };
}

export interface TimeBand {
  /** seconds from run start */
  from: number;
  to: number;
  /** spawns per second at band start (spawner ramps to next band) */
  rate: number;
  maxAlive: number;
  spawns: SpawnEntry[];
  elites?: { every: number; pool: string[] };
}

export interface BiomePreset {
  id: string;
  seed: number;
  /** terrain texture ids (texture manifest), blended by slope/height/noise */
  ground: string[];
  trees: string[];
  props: string[];
  fog: { color: string; near: number; far: number };
  sky: { top: string; horizon: string; bottom: string };
  sun: { color: string; intensity: number; dir: [number, number, number] };
  ambient: { sky: string; ground: string; intensity: number };
  water?: { level: number; color: string; kind: 'water' | 'lava' | 'ice' };
  relief: { height: number; roughness: number; features: string[] };
  /** ambient particles: falling leaves, snow, embers, dust */
  particles?: string;
}

export interface ZoneDef {
  id: string;
  order: number;
  name: L10n;
  subtitle: L10n;
  levelRange: [number, number];
  story: { intro: L10n[]; bossIntro?: L10n; victory: L10n[]; defeat: L10n[] };
  biome: BiomePreset;
  music: { calm: string; combat: string; boss: string };
  bands: TimeBand[];
  bosses: { at: number; boss: string }[];
  /**
   * `hpMul` (optional, (0, 5], absent = 1): multiplier on the final boss's HP in this zone only (a code multiplier at
   * spawn; bosses.json stays untouched).
   */
  final: { at: number; boss: string; greatMetin: string; hpMul?: number };
  metins: { types: string[]; firstAt: number; interval: [number, number] };
  gearTier: number;
  unlock?: { zone: string; difficulty?: Difficulty };
  /** illustration / card art texture id */
  art: string;
  /** optional, (0, 5], absent = 1: multiplier on the xp value of gems dropped in this zone */
  xpMul?: number;
  /**
   * optional per-zone override of the hard-difficulty multipliers (each (0, 5]); a missing key falls back to
   * `balance.hard`, then to 1. Read it through `resolveHardMuls(balance, zone)`.
   */
  hard?: Partial<HardMuls>;
}

// ---------------------------------------------------------------------------
// Meta: gear, talents, classes, empires, story

export type GearSlot = 'weapon' | 'armor' | 'helmet' | 'shield' | 'shoes' | 'bracelet' | 'necklace' | 'earrings';
export const GEAR_SLOTS: readonly GearSlot[] = [
  'weapon',
  'armor',
  'helmet',
  'shield',
  'shoes',
  'bracelet',
  'necklace',
  'earrings',
];

export interface GearDef {
  id: string;
  slot: GearSlot;
  classes: ClassId[];
  tier: number;
  name: L10n;
  icon: string;
  /** weapon/armor model id when it changes the hero's look */
  model?: string;
  stats: StatMods;
  /** extra stats per blacksmith +1 (0..9) */
  perPlus: StatMods;
  source: { zone: string; boss?: string; chance: number };
}

export interface TalentNode {
  id: string;
  row: number;
  col: number;
  max: number;
  name: L10n;
  desc: L10n;
  icon: string;
  perPoint?: StatMods;
  effect?: { kind: string; params: Record<string, number> };
  requires?: string;
}

export interface TalentTree {
  id: DoctrineId;
  classId: ClassId;
  name: L10n;
  nodes: TalentNode[];
  milestones: { at: 10 | 20 | 30; skill?: string; effect?: L10n }[];
}

export interface DoctrineDef {
  id: DoctrineKey;
  name: L10n;
  desc: L10n;
  /** auto-attack skill id */
  basic: string;
  /** skill granted at run start */
  starter: string;
  /** active skills offered on level-up cards */
  skills: string[];
}

export interface ClassDef {
  id: ClassId;
  name: L10n;
  desc: L10n;
  sexes: Sex[];
  doctrines: [DoctrineDef, DoctrineDef];
  base: { maxHp: number; armor: number; moveSpeed: number } & StatMods;
  /** hero model ids per sex, index = armor tier 0..3 */
  models: Partial<Record<Sex, string[]>>;
  /** weapon model ids per tier 0..3 (doctrine A, or both doctrines when weaponsB is absent) */
  weapons: string[];
  /** doctrine B weapon line per tier 0..3 (e.g. ninja bow vs daggers, shaman bell vs fan) */
  weaponsB?: string[];
  portrait: Partial<Record<Sex, string>>;
}

export interface EmpireDef {
  id: EmpireId;
  name: L10n;
  color: string;
  bonus: StatMods;
  desc: L10n;
  /**
   * Edict (optional): extra reroll / banish / skip budget of every hero of this empire, integers 0..2 each, absent or
   * a missing key = 0. Read it through `resolveEdict(empire)`.
   */
  edict?: Partial<Edict>;
}

export interface StoryDef {
  prologue: L10n[];
  chapters: { zone: string; title: L10n; text: L10n[] }[];
  codex: { id: string; title: L10n; text: L10n; unlock: string }[];
}

export interface BalanceConfig {
  runLength: number;
  /** xp to reach level n+1 = base + growth·n + accel·n² */
  xpCurve: { base: number; growth: number; accel: number };
  cardsPerLevel: number;
  rerollsPerRun: number;
  banishesPerRun: number;
  skipsPerRun: number;
  maxActiveSkills: number;
  maxPassives: number;
  /** rarity weights at luck 0 */
  rarityWeights: Record<Rarity, number>;
  chestCost: { base: number; perOpen: number };
  /** damage reduction = armor / (armor + armorK) */
  armorK: number;
  caps: { cooldown: number; lifesteal: number; regenPctPerSec: number; evasion: number; critChance: number };
  /** enemy scaling per minute of run time */
  enemyHpPerMin: number;
  enemyDamagePerMin: number;
  /**
   * hard difficulty multipliers. `awakenMul` / `eliteEveryMul` / `finalEnrageMul` are optional, each (0, 5], absent = 1
   * (today); a zone may override them (`ZoneDef.hard`). Read them through `resolveHardMuls(balance, zone)`.
   */
  hard: { hp: number; damage: number; count: number; reward: number } & Partial<HardMuls>;
  talentXp: { perMinute: number; perKill: number; perElite: number; perBoss: number; perMetin: number; victory: number };
  blacksmith: { successRate: number[]; yeopCost: number[]; shardCost: number[] };
  /** skill-logic thresholds and caps (DESIGN §4.1 / §8). Optional: every missing key falls back to DEFAULT_TRIGGERS. */
  triggers?: TriggerConfigInput;
  /** awakening pacts (R1). Optional: absent = `rank` 0 = off = today. Read it through `resolvePacts(balance.pacts)`. */
  pacts?: PactsConfigInput;
  /** chest tuning (R7). Optional: absent = today (elites drop a chest at 12 %, a chest offers `cardsPerLevel` cards). `chestCost` stays above. Read it through `resolveChest(balance)`. */
  chest?: Partial<ChestConfig>;
  /** overflow rewards (R6): what a full build gets instead of filler cards. Optional: absent = both switches off = today. Read it through `resolveOverflow(balance.overflow)`. */
  overflow?: Partial<OverflowConfig>;
}

// ---------------------------------------------------------------------------
// Roguelite systems (stage A0 data contract): every field below is OPTIONAL in the JSON, an absent field means the
// default, and the defaults reproduce today's behaviour exactly (every system is off). Nothing in the sim reads them
// until the work packages that own each system land; the loader (data/loader.ts) validates them.

/** the three hard-difficulty multipliers a zone may override; 1 = today */
export interface HardMuls {
  /** multiplier on the metin awakening clock (< 1 = metins awaken sooner) */
  awakenMul: number;
  /** multiplier on the elite spawn interval (< 1 = more elites) */
  eliteEveryMul: number;
  /** multiplier on the final boss's enrage stack interval (< 1 = enrages sooner) */
  finalEnrageMul: number;
}

export const DEFAULT_HARD_MULS: Readonly<HardMuls> = { awakenMul: 1, eliteEveryMul: 1, finalEnrageMul: 1 };

/** the multipliers that apply on hard in `zone`: the zone's override, else `balance.hard`, else 1 */
export function resolveHardMuls(balance: { hard: Partial<HardMuls> }, zone?: { hard?: Partial<HardMuls> }): HardMuls {
  return {
    awakenMul: zone?.hard?.awakenMul ?? balance.hard.awakenMul ?? 1,
    eliteEveryMul: zone?.hard?.eliteEveryMul ?? balance.hard.eliteEveryMul ?? 1,
    finalEnrageMul: zone?.hard?.finalEnrageMul ?? balance.hard.finalEnrageMul ?? 1,
  };
}

/** a zone's own multipliers: gem xp (`xpMul`) and the final boss's HP (`final.hpMul`), 1 when absent */
export function resolveZoneMuls(zone: { xpMul?: number; final: { hpMul?: number } }): { xp: number; finalHp: number } {
  return { xp: zone.xpMul ?? 1, finalHp: zone.final.hpMul ?? 1 };
}

/** Awakening pacts (R1): a skill awakens (rank P) only while its pact passive is owned at `rank` or higher. */
export interface PactsConfig {
  /** 0 = pacts off (today); otherwise the minimum rank of the pact passive (an integer, at most that passive's maxRank) */
  rank: number;
  /**
   * behavior -> pact passive id. Unknown behaviors and passive ids are rejected by the loader; with `rank` > 0 EVERY
   * BehaviorKind must be mapped (a skill of an unmapped behavior could never awaken).
   */
  byBehavior: Partial<Record<BehaviorKind, string>>;
  /** weight multiplier of a ready awakening card in chest / boss offers, [1, 20] (1 = no preference) */
  readyWeight: number;
}
export type PactsConfigInput = Partial<PactsConfig>;
export const DEFAULT_PACTS: Readonly<PactsConfig> = { rank: 0, byBehavior: {}, readyWeight: 1 };

/** `balance.pacts` over DEFAULT_PACTS; a fresh object, safe to keep */
export function resolvePacts(input?: PactsConfigInput): PactsConfig {
  return { rank: input?.rank ?? DEFAULT_PACTS.rank, byBehavior: { ...input?.byBehavior }, readyWeight: input?.readyWeight ?? DEFAULT_PACTS.readyWeight };
}

/** Chest tuning (R7). `chestCost` stays on BalanceConfig. */
export interface ChestConfig {
  /** chance that an elite (tier 1-2) drops a chest, [0, 1] */
  eliteDrop: number;
  /** cards a chest offers, 1..4 (the card UI lays out at most 4); absent = `cardsPerLevel` */
  cards: number;
  /**
   * boss rewards are the run's build milestones (OF-04): three cards, never a filler, all epic+ - one awakening (a pact that is
   * ready; else the rank-up of the lowest-ranked skill), one essence card (spirit stone or trinket), one level-up card. Absent or
   * false = today's boss offer (`cards` cards from the ordinary pool). Ordinary chests are not affected.
   */
  bossMilestone: boolean;
}
/** the elite chest chance of the shipped game (sim/pickups.ts before the contract) */
export const DEFAULT_CHEST_ELITE_DROP = 0.12;

/** `balance.chest` over today's values (cards follow `cardsPerLevel`); a fresh object */
export function resolveChest(balance: { cardsPerLevel: number; chest?: Partial<ChestConfig> }): ChestConfig {
  return {
    eliteDrop: balance.chest?.eliteDrop ?? DEFAULT_CHEST_ELITE_DROP,
    cards: balance.chest?.cards ?? balance.cardsPerLevel,
    bossMilestone: balance.chest?.bossMilestone ?? false,
  };
}

/** Overflow rewards (R6): shard cards replace the yeop filler, the Sky Sovereign's Boon card replaces filler on a full build. */
export interface OverflowConfig {
  /** shard cards instead of the yeop filler card */
  shards: boolean;
  /** the stacking Boon card once nothing new can be offered (every skill and passive slot is full, or what is left is owned / banished) */
  boon: boolean;
  /** shards a shard card pays per rarity (common .. legendary): RARITIES.length integers >= 0 */
  shardsByRarity: number[];
  /** Boon: damage added per pick, [0, 0.5] */
  boonDamage: number;
  /** Boon: max HP added per pick, [0, 0.5] */
  boonHp: number;
  /** shards refunded when a card offer is skipped, an integer 0..20 */
  skipRefund: number;
}
export const DEFAULT_OVERFLOW: Readonly<OverflowConfig> = { shards: false, boon: false, shardsByRarity: [2, 3, 4, 5, 6], boonDamage: 0.03, boonHp: 0.02, skipRefund: 0 };

/** `balance.overflow` over DEFAULT_OVERFLOW; a fresh object, safe to keep */
export function resolveOverflow(input?: Partial<OverflowConfig>): OverflowConfig {
  const d = DEFAULT_OVERFLOW;
  return {
    shards: input?.shards ?? d.shards,
    boon: input?.boon ?? d.boon,
    shardsByRarity: [...(input?.shardsByRarity ?? d.shardsByRarity)],
    boonDamage: input?.boonDamage ?? d.boonDamage,
    boonHp: input?.boonHp ?? d.boonHp,
    skipRefund: input?.skipRefund ?? d.skipRefund,
  };
}

/** Empire edict: extra budgets of every hero of the empire, integers 0..2 each. */
export interface Edict {
  rerolls: number;
  banishes: number;
  skips: number;
}
export const EDICT_MAX = 2;

/** an empire's edict with 0 for every missing key */
export function resolveEdict(empire?: { edict?: Partial<Edict> }): Edict {
  return { rerolls: empire?.edict?.rerolls ?? 0, banishes: empire?.edict?.banishes ?? 0, skips: empire?.edict?.skips ?? 0 };
}

// --- run events (data/content/runEvents.json) ---

export type RunEventKind = 'metinRain' | 'championHunt' | 'goldenHour' | 'bargain';
export const RUN_EVENT_KINDS: readonly RunEventKind[] = ['metinRain', 'championHunt', 'goldenHour', 'bargain'];

/** One set-piece event per run, picked from the zone's list. `zones: {}` (or a zone with no list) = no events = today. */
export interface RunEventsDef {
  /** earliest and latest start of the event in run seconds, 0 <= lo < hi < runLength */
  window: [number, number];
  /** an event never starts within this many seconds of a boss spawn, [0, 89] */
  bossGap: number;
  /** zone id -> event kinds eligible in that zone (no repeats); a zone that is missing has no events */
  zones: Record<string, RunEventKind[]>;
  kinds: {
    /** `count` metins fall on a ring of `ringRadius` m around the hero within `within` s; each adds `corruption` (0..1) */
    metinRain: { count: number; ringRadius: number; within: number; corruption: number };
    /** a champion (`hpMul` x HP, `dmgMul` x damage) with `escorts` guards, to be slain within `timeLimit` s for a chest of `chestTier` */
    championHunt: { hpMul: number; dmgMul: number; escorts: number; timeLimit: number; chestTier: number };
    /** for `duration` s elites come `eliteEveryMul` x as often (smaller = more) and yeop is worth `yeopMul` x */
    goldenHour: { duration: number; eliteEveryMul: number; yeopMul: number };
    /** the Sky Sovereign's Bargain shrine: stand within `radius` m for `channel` s to be offered `offers` bargains */
    bargain: { radius: number; channel: number; offers: number };
  };
}

/** no events: the content of a build without runEvents.json */
export const DEFAULT_RUN_EVENTS: Readonly<RunEventsDef> = {
  window: [380, 620],
  bossGap: 30,
  zones: {},
  kinds: {
    metinRain: { count: 3, ringRadius: 14, within: 6, corruption: 0.15 },
    championHunt: { hpMul: 5, dmgMul: 1.3, escorts: 4, timeLimit: 60, chestTier: 1 },
    goldenHour: { duration: 45, eliteEveryMul: 0.5, yeopMul: 2 },
    bargain: { radius: 2.5, channel: 2, offers: 3 },
  },
};

/** `ContentDB.runEvents`, or the defaults (no events) when the content has none */
export function resolveRunEvents(def?: RunEventsDef): RunEventsDef {
  return def ?? (DEFAULT_RUN_EVENTS as RunEventsDef);
}

/** the event kinds eligible in `zoneId` ([] = no event that run) */
export function runEventKindsOf(def: RunEventsDef | undefined, zoneId: string): readonly RunEventKind[] {
  return resolveRunEvents(def).zones[zoneId] ?? [];
}

// --- elite affixes (data/content/affixes.json) ---

export type AffixKind = 'swift' | 'vampiric' | 'warded' | 'splitting';
export const AFFIX_KINDS: readonly AffixKind[] = ['swift', 'vampiric', 'warded', 'splitting'];

/** Affixes of tier-1 elites. `enabled: false` = no affix, no random draw = today. */
export interface AffixesDef {
  enabled: boolean;
  /** first band (0-based, 0..4) whose elites may roll an affix; band 0 stays plain when 1 */
  fromBand: number;
  /** relative roll weights, every kind present, each >= 0, the sum > 0 */
  weights: Record<AffixKind, number>;
  params: {
    /** speed / attackRate: fractions added to move speed and attack rate, (0, 2] */
    swift: { speed: number; attackRate: number };
    /** heal: fraction of the damage dealt to heroes that the elite heals, (0, 1] */
    vampiric: { heal: number };
    /** reduction: damage taken is cut by this fraction, (0, 0.9]; only while the elite's HP fraction is above `above` (0, 1] */
    warded: { reduction: number; above: number };
    /** on death: `copies` (1..4) tier-0 copies at `hp` (0, 1] of the elite's HP */
    splitting: { copies: number; hp: number };
  };
  /** bosses may roll an affix on hard */
  bossOnHard: boolean;
  /** the kinds a boss may roll (unique; non-empty when bossOnHard) */
  bossKinds: AffixKind[];
}

/** affixes off: the content of a build without affixes.json */
export const DEFAULT_AFFIXES: Readonly<AffixesDef> = {
  enabled: false,
  fromBand: 1,
  weights: { swift: 3, vampiric: 2, warded: 2, splitting: 2 },
  params: {
    swift: { speed: 0.35, attackRate: 0.2 },
    vampiric: { heal: 0.25 },
    warded: { reduction: 0.4, above: 0.5 },
    splitting: { copies: 2, hp: 0.3 },
  },
  bossOnHard: false,
  bossKinds: ['swift', 'warded'],
};

/** `ContentDB.affixes`, or the defaults (disabled) when the content has none */
export function resolveAffixes(def?: AffixesDef): AffixesDef {
  return def ?? (DEFAULT_AFFIXES as AffixesDef);
}

/**
 * Every threshold, cap and switch of the context-trigger system, resolved (balance.triggers over DEFAULT_TRIGGERS).
 * Read it through `World.trig`; never read `balance.triggers` directly.
 */
export interface TriggerConfig {
  /** `pinned`: >= n creatures within r metres (a TriggerSpec.n overrides n) */
  pinned: { n: number; r: number };
  /** `engaged`: >= n creatures within r metres (also the patience fallback) */
  engaged: { n: number; r: number };
  /** `hurt`: lost >= frac of max HP within window seconds (post-armor, pre-ward / shield) */
  hurt: { frac: number; window: number };
  /** `danger`: HP <= hp (a TriggerSpec.hp overrides it) or lost >= lossFrac of max HP within window seconds */
  danger: { hp: number; lossFrac: number; window: number };
  /** `elite`: an elite or boss within r */
  elite: { r: number };
  /** `boss`: a boss within r */
  boss: { r: number };
  /** `volley`: >= n hostile bolts within r */
  volley: { n: number; r: number };
  /** `ally`: a living ally within r (the skill's `party` radius wins when > 0) is hurt or at <= hp of max HP */
  ally: { r: number; hp: number };
  /** multiplier on every TriggerSpec.patience (global tuning knob; 1 = as authored) */
  patienceMul: number;
  /** kill refund cap: at most this fraction of a skill's cooldown can be refunded per cooldown cycle */
  refundCap: number;
  /** window extension cap: at most this fraction of the base duration can be added by kills */
  extendCap: number;
  /** kill-fed buff stack cap: the buff magnitude grows by at most this fraction (0.6 = +60 %) */
  stackCap: number;
  /** ward end burst damage cap: the absorbed share is clamped to burstCap x the ward size */
  burstCap: number;
  /** drain cap: lifesteal can refill the ward up to drainCap x its size */
  drainCap: number;
  /** veil: re-pick radius (m) for a creature whose target is veiled; an ally within it takes the aggro */
  veilRepick: number;
  /** war_oath: seconds of invulnerability after the oath save */
  lethalGuard: number;
  /** mimic: at most `cap` copies per `window` seconds */
  mimic: { cap: number; window: number };
  /** kill switch for bait points (false: addBait adds nothing, creature movement is untouched) */
  bait: boolean;
}

/** deep-partial form accepted in balance.json */
export type TriggerConfigInput = {
  [K in keyof TriggerConfig]?: TriggerConfig[K] extends object ? Partial<TriggerConfig[K]> : TriggerConfig[K];
};

/** the design's thresholds (DESIGN §8: pinned n5 r4, engaged n4 r8, hurt .06 / 2 s, danger .40 or .25 / 6 s, ...) */
export const DEFAULT_TRIGGERS: Readonly<TriggerConfig> = {
  pinned: { n: 5, r: 4 },
  engaged: { n: 4, r: 8 },
  hurt: { frac: 0.06, window: 2 },
  danger: { hp: 0.4, lossFrac: 0.25, window: 6 },
  elite: { r: 10 },
  boss: { r: 14 },
  volley: { n: 2, r: 8 },
  ally: { r: 12, hp: 0.55 },
  patienceMul: 1,
  refundCap: 0.35,
  extendCap: 0.5,
  stackCap: 0.6,
  burstCap: 2,
  drainCap: 1.5,
  veilRepick: 16,
  lethalGuard: 2.5,
  mimic: { cap: 3, window: 0.5 },
  bait: true,
};

/** `balance.triggers` merged over DEFAULT_TRIGGERS (one level deep); a fresh object, safe to keep */
export function resolveTriggers(input?: TriggerConfigInput): TriggerConfig {
  const out = {} as Record<string, unknown>;
  const given = (input ?? {}) as Record<string, unknown>;
  for (const [k, d] of Object.entries(DEFAULT_TRIGGERS)) {
    const v = given[k];
    if (d !== null && typeof d === 'object') out[k] = { ...(d as object), ...(v !== null && typeof v === 'object' ? (v as object) : {}) };
    else out[k] = typeof v === typeof d ? v : d;
  }
  return out as unknown as TriggerConfig;
}

export interface ContentDB {
  classes: ClassDef[];
  skills: SkillDef[];
  passives: PassiveDef[];
  stones: StoneDef[];
  trinkets: TrinketDef[];
  enemies: EnemyDef[];
  bosses: BossDef[];
  metins: MetinDef[];
  zones: ZoneDef[];
  gear: GearDef[];
  talents: TalentTree[];
  empires: EmpireDef[];
  story: StoryDef;
  balance: BalanceConfig;
  /** run events (data/content/runEvents.json); optional so that content built without it (test fixtures) means "no events". Read it through `resolveRunEvents`. */
  runEvents?: RunEventsDef;
  /** elite affixes (data/content/affixes.json); optional: absent = disabled. Read it through `resolveAffixes`. */
  affixes?: AffixesDef;
}
