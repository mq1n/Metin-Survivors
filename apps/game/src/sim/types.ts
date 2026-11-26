// Shared sim types: cards/modal requests (UI contract), metin/boss runtime state, world environment, HUD snapshot.

import type { BossDef, BossPattern, MetinDef, Rarity, UpgradeStat, StatMods } from '../data/schema';
import type { RunResult } from './run';

// ---------------------------------------------------------------------------
// Cards & modal requests

export type CardKind =
  | 'newSkill'
  | 'skillUp'
  | 'newPassive'
  | 'passiveUp'
  | 'heal'
  | 'yeop'
  | 'stone'
  | 'stoneUp'
  | 'trinket'
  | 'trinketUp'
  /** overflow reward (R6): Sky Sovereign shards instead of a useless card (A0-CARD defines the kind only; offers-sim generates and applies it) */
  | 'shards'
  /** Sky Sovereign's Boon (OF-03): the stacking overflow card (A0-CARD: the kind only) */
  | 'boon'
  /** Sky Sovereign's Bargain (EV-02): a boon paired with a curse, offered at the event shrine (A0-CARD: the kind only) */
  | 'bargain';

export interface CardLine {
  /** skill upgrade stat (skillUp), or a StatMods key (passive/stone/trinket description lines) */
  stat: UpgradeStat | keyof StatMods | string;
  mode: 'pct' | 'flat';
  /** rolled magnitude AFTER RARITY_MULT (cooldown/tick: positive = reduce by). pct values are fractions. */
  value: number;
}

export interface CardReplace {
  kind: 'stone' | 'trinket';
  id: string;
  /** stone level (+N) or trinket rank being replaced */
  level: number;
  slot: number;
}

export interface Card {
  kind: CardKind;
  /** skill / passive / stone / trinket id; '' for the fallback cards (heal / yeop / shards / boon: they cannot be banished) */
  id: string;
  rarity: Rarity;
  /** resulting rank after picking: skill rank 0..7 (SKILL_RANKS label), passive rank, stone +N, trinket rank; boon: the stack it becomes (boons held + 1, unlimited) */
  rank: number;
  maxRank: number;
  /** picking this reaches rank P and awakens the skill */
  awakening: boolean;
  /** rolled upgrade lines (skillUp) or the stat lines this card grants */
  lines: CardLine[];
  /** heal: fraction of max hp, yeop: amount, shards: Metin shards banked at the run's end (balance.overflow.shardsByRarity); boon: 0 (its gains are the card's `lines`) */
  amount: number;
  /** stone/trinket target slot (0..5 stones, 0..2 trinkets), -1 otherwise */
  slot: number;
  /** set when the target slot is full: picking replaces this item ("Yerine koy") */
  replaces: CardReplace | null;
  /**
   * Pact line (R1, OF-01): set on a passive card whose pact partner is an owned skill: `awakens` = the ids of those owned skills
   * the passive unlocks the awakening (P) of. Optional: absent (and the field is never written) = no pact = today's card.
   */
  pact?: { awakens: string[] };
  /**
   * Pact requirement (R1, OF-01): set on a skill card that cannot reach its awakening yet: the id of the passive it still needs
   * (the card reads "Awakens with <passive>"). Optional: absent = nothing is missing = today's card.
   */
  needs?: string;
  /**
   * Sky Sovereign's Bargain (EV-02, kind 'bargain'): `boon` / `curse` are i18n keys of the two halves of the deal, `party` = the deal
   * binds every hero of a co-op run (default: the picker only). Optional: absent = today's card.
   */
  bargain?: { boon: string; curse: string; party?: boolean };
}

export type ModalKind = 'levelUp' | 'essence' | 'chest' | 'bossReward' | 'runEnd';

export interface ModalRequest {
  /** unique, monotonically increasing */
  id: number;
  kind: ModalKind;
  /** player this modal belongs to */
  player: number;
  cards: Card[];
  canReroll: boolean;
  canBanish: boolean;
  canSkip: boolean;
  /** remaining budgets */
  rerolls: number;
  banishes: number;
  skips: number;
  /** levelUp: level reached */
  level: number;
  /** boss id (bossReward) / metin id (essence) / '' */
  source: string;
  /** boss chest / metin chest cost 0 */
  free: boolean;
  /** essence offered by an awakened metin (better rarity floor) */
  awakened: boolean;
  /** seconds this request has been waiting (co-op auto-pick timer) */
  waited: number;
  /** runEnd only */
  result: RunResult | null;
}

// ---------------------------------------------------------------------------
// Metins & bosses runtime state (small arrays on World)

/** values match render/feed.ts MetinPhase (0 falling, 1 alive, 2 awakened, 3 breaking) */
export const enum MetinPhase {
  /** shadow + flaming trail telegraph on the ground; the stone has not landed yet */
  Falling = 0,
  /** landed (the `drop` clip plays during the first ~0.9 s of phaseT while the stone is invulnerable) */
  Alive = 1,
  Awakened = 2,
  /** shatter animation; removed from `world.metins` when phaseT > 2.2 s */
  Broken = 3,
}

export interface MetinState {
  /** unique id (events reference it) */
  id: number;
  def: MetinDef;
  /** index into world.metinDefs (render metin type table order) */
  type: number;
  x: number;
  z: number;
  phase: MetinPhase;
  /** seconds in the current phase */
  phaseT: number;
  /** seconds since landing (drives awaken + modifiers) */
  age: number;
  /** EnemyStore handle of its hit-row (0 while Falling / after Broken) */
  enemy: number;
  hp: number;
  hpMax: number;
  /** 0..1 */
  hpFrac: number;
  /** world scale of the model */
  scale: number;
  great: boolean;
  /** corruption aura radius (m) */
  auraRadius: number;
  /** collision radius of the hit row */
  radius: number;
  swarmT: number;
  eliteT: number;
  /** next HP-threshold wave index (modParams wave_99 … wave_10) */
  waveIdx: number;
  modT: number;
  /** telegraph handle while Falling */
  tele: number;
  /** seconds to impact while Falling */
  warnLeft: number;
}

export interface BossState {
  id: number;
  def: BossDef;
  /** index into world.typeDefs */
  typeIndex: number;
  /** EnemyStore handle */
  enemy: number;
  phase: number;
  age: number;
  /** seconds of arrival (spawn clip): invulnerable and passive until `age` reaches it */
  intro: number;
  /** the model's fire breath is authored into `special1` (GLB extras.breath): breath plays there, other patterns on special2/3 */
  breathSpecial1: boolean;
  enraged: boolean;
  final: boolean;
  /** next-ready absolute time per pattern (index = def.patterns) */
  ready: number[];
  /** index into def.patterns of the active pattern (-1 none) */
  patIdx: number;
  /** active pattern (windup/execution) */
  pattern: BossPattern | null;
  /** seconds into the active pattern */
  patternT: number;
  /** scratch for the active pattern */
  a: number;
  b: number;
  c: number;
  dirX: number;
  dirZ: number;
  /** seconds until the next pattern may be picked */
  gap: number;
  dead: boolean;
  /** damage multiplier from enrage */
  rageDamage: number;
  rageSpeed: number;
  rageCooldown: number;
  /** extra enrage stacks gained by the final boss after its first enrage (damage, speed, faster patterns) */
  rageStacks: number;
  /** sim time of the next stack */
  nextStackAt: number;
}

// ---------------------------------------------------------------------------
// Environment hooks (TerrainField provides these; the sim stays DOM/three free)

export interface WorldEnv {
  /** playable radius around the origin (m) */
  arenaRadius?: number;
  /** false when the XZ point cannot be walked (cliff / deep water / outside); enemies are kept out, spawns avoid it */
  walkable?: (x: number, z: number) => boolean;
  /** hero movement against terrain blockers: resolve (x0,z0)→(x1,z1) for a circle of radius r into `out`; true if unobstructed */
  moveCircle?: (x0: number, z0: number, x1: number, z1: number, r: number, out: { x: number; z: number }) => boolean;
  /** terrain surface id at a point (constants.ts Surface): lava / miasma hurt, shallow slows, ice slides; lava + deep never spawn anything */
  surfaceAt?: (x: number, z: number) => number;
  /**
   * r6 U6: true when no static scatter item (prop, rock, tree, wall) reaches with its VISUAL extent into the disc of radius `r`
   * round (x, z). Collision circles are smaller than what the eye sees (a stone lantern blocks 0.45 m but stands 0.9 m wide), so
   * `walkable` alone lets a falling metin land in a lantern, a fence end or a boulder's flank. With `view` (a body of height h and
   * foot radius r standing at (x, z)) also no tall static's crown / roof / top hides that body from the game camera. Absent = no
   * check (flat test arenas).
   */
  clearOfStatics?: (x: number, z: number, r: number, view?: { h: number; r: number; carpet?: number }) => boolean;
  /**
   * r7 U7: true when the disc of radius r round (x, z) is open, level ground for a flat ground decal (the metin rune carpet): its rim
   * and half radius stand on walkable ground that is neither lava nor deep water, none more than dh m above or below the centre
   * (a carpet over a bank edge or a cliff stretches its glyphs). Absent = no check (flat test arenas).
   */
  levelDisc?: (x: number, z: number, r: number, dh: number) => boolean;
  /**
   * r9 Z9: metres (summed) the banners and the roofs reach into a small metin's 13 m fight ring at (x, z), as the game camera draws
   * them (0 = a clean ring). The fall-site search takes the cleanest clear site near the one it found; it never refuses a site for it.
   * Absent = every ring counts as clean (flat test arenas).
   */
  ringScore?: (x: number, z: number) => number;
  /**
   * r9 ship: bad-ground samples (water, lava, cliff, steep slope) of the 13 m fight ring at (x, z): the fall-site search never trades a site
   * for one whose ring has more of it (a moved suryeon site hung over the ravine, a daeryeol one ran into a lava pit). Absent = no veto.
   */
  ringGround?: (x: number, z: number) => number;
  /**
   * Render-asset facts about a boss model the sim paces by (absent / null → defaults): `spawn` = seconds of its `spawn`
   * clip (0 = none), `breath` = its fire breath is authored into `special1` (GLB extras.breath).
   */
  bossModel?: (model: string) => { spawn: number; breath: boolean } | null;
}

// ---------------------------------------------------------------------------
// HUD snapshot (10 Hz) built by `world.hud(player)`

export interface HudSkillSlot {
  id: string;
  icon: string;
  rank: number;
  /** 0 = ready, 1 = just fired */
  cooldown: number;
  /** seconds left on the cooldown (the HUD's countdown number); 0 when ready. A co-op guest's mirror only receives the fraction above and reports 0. */
  cdLeft: number;
  basic: boolean;
  awakened: boolean;
  /**
   * ring state (DESIGN M1): 'active' while the skill's window / shell is up (`activeLeft` s), 'armed' for a ready CONTEXT skill
   * (def.trigger) that waits for its trigger, 'cooling' for everything else (the ring sweeps `cooldown`). Absent on a co-op
   * guest's mirror (it only receives the cooldown fraction): read absent as 'cooling'.
   */
  state?: 'cooling' | 'armed' | 'active';
  /** seconds of the window / shell still up while state is 'active', else 0 (absent on a guest's mirror) */
  activeLeft?: number;
  /**
   * true for an INSURANCE skill (War Oath, Cure: the trigger lists only emergency kinds and has no patience) that is 'armed': it sits
   * ready for most of the run, so the HUD draws its ring as a calm static rim instead of the pulsing one (absent on a guest's mirror)
   */
  calm?: boolean;
}

export interface HudSnapshot {
  time: number;
  player: number;
  hp: number;
  hpMax: number;
  shield: number;
  level: number;
  xp: number;
  xpNext: number;
  yeop: number;
  shards: number;
  kills: number;
  corruption: number;
  alive: boolean;
  skills: HudSkillSlot[];
  passives: { id: string; icon: string; rank: number; maxRank: number }[];
  stones: ({ id: string; icon: string; level: number } | null)[];
  trinkets: ({ id: string; icon: string; rank: number } | null)[];
  rerolls: number;
  banishes: number;
  skips: number;
  /** next scheduled boss: seconds and id; null when none left */
  nextBoss: { at: number; in: number; id: string } | null;
  /** boss bar (first living boss); `affix` = the boss's elite affix id (EL-04, hard only), absent = none (today) */
  boss: { id: string; hp: number; hpMax: number; phase: number; enraged: boolean; final: boolean; x: number; z: number; affix?: string } | null;
  /** live metins for the minimap / compass */
  metins: { id: number; x: number; z: number; awakened: boolean; hpFrac: number; rune: string }[];
  /** 0..1 screen darkening requested by a Black metin */
  darkness: number;
  /** hero world position (off-screen arrows to metins / boss) */
  px: number;
  pz: number;
  /** live damage meter of this hero's skills, sorted descending (top 8) */
  dmg: { skillId: string; rank: number; damage: number }[];
  /** damage dealt per second by the whole party over the last ~5 s */
  dps: number;
  /**
   * The active run event (RS-02a): `kind` = the event kind id, `phase` its stage, `left` = seconds until that stage ends (the host
   * reads it from the sim, a co-op guest from the mirrored 'runEvent' event and its mirrored clock), `x` / `z` = where it is.
   * Optional: absent or null = no event, exactly today's HUD. Filled by sim/hud.ts (host) and net/coop/mirror.ts buildHud (guest).
   */
  runEvent?: HudRunEvent | null;
  /**
   * The LOCAL hero's Sky Sovereign shrine channel progress, 0..1 (EV-02a). Optional: absent = not channelling = today's HUD. In co-op
   * each machine shows only its own hero's progress.
   */
  channel?: number;
}

/** HudSnapshot.runEvent: the stage of the active run event as the HUD shows it */
export interface HudRunEvent {
  /** run event kind id (data/content/runEvents.json) */
  kind: string;
  phase: 'announce' | 'active' | 'end';
  /** seconds until the current phase ends */
  left: number;
  x: number;
  z: number;
}
