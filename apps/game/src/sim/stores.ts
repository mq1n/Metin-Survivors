// SoA entity stores (ARCHITECTURE §6). Typed arrays, capacity preallocated, swap-remove with stable handles.
//
// Render/audio/UI contract:
//  - iterate rows `0 .. store.count - 1`; read typed arrays directly; NEVER mutate.
//  - rows are DENSE and may be reordered by swap-remove between ticks; use `store.id[row]` (a stable handle,
//    unique for the lifetime of the entity, never 0) as the key for per-entity render state.
//  - `px/pz/prot` hold the position/rotation at the START of the current tick; `x/z/rot` the END. Render
//    interpolates `lerp(prev, cur, alpha)` (angles: shortest arc).
//  - `store.find(handle)` → row or -1 (entity gone).

import type { ClassId, DoctrineKey, EmpireId, Element, Sex, SkillDef, StatMods, RaceTag, Rarity, UpgradeStat } from '../data/schema';
import { CAP, MAX_ATTACKS, MAX_SKILL_SLOTS } from './constants';
import type { FinalParams } from './skills/params';

export type TypedArray = Float32Array | Uint8Array | Uint16Array | Uint32Array | Int32Array | Int16Array | Int8Array;

// ---------------------------------------------------------------------------
// Enums shared with render/vfx/audio

/** hero + creature clip indices; CLIP_NAMES[i] is the GLB clip name (ARCHITECTURE §5.1) */
export const enum AnimClip {
  Idle = 0,
  Walk = 1,
  Run = 2,
  Attack = 3,
  Attack2 = 4,
  Hit = 5,
  Death = 6,
  Spawn = 7,
  Special1 = 8,
  Special2 = 9,
  Special3 = 10,
}
export const CLIP_NAMES = [
  'idle',
  'walk',
  'run',
  'attack',
  'attack2',
  'hit',
  'death',
  'spawn',
  'special1',
  'special2',
  'special3',
] as const;

export const enum EnemyState {
  Spawn = 0, // spawn-in animation, harmless
  Move = 1,
  Windup = 2, // telegraphing an attack
  Strike = 3, // attack animation after the hit frame
  Recover = 4,
  Dash = 5, // charge in progress
  Leap = 6, // leap in progress
  Stunned = 7, // stun / freeze
  Dying = 8, // killed this tick; removed from the store at the end of the tick (render spawns the corpse from enemyDeath)
  Static = 9, // metin rows
}

/** EnemyStore.flags bits */
export const enum EnemyFlag {
  Boss = 1,
  Elite = 2,
  Leader = 4,
  /** metin / great-metin row: NOT a creature, skip in the crowd renderer (`type` indexes world.metinDefs) */
  Metin = 8,
  Invuln = 16,
  /** final boss / great metin pieces: never relocated */
  Pinned = 32,
  /** untargetable while flickering inside a Shadow metin aura */
  Phased = 64,
}

export const STATUS_KINDS = ['slow', 'poison', 'burn', 'stun', 'freeze', 'bleed', 'fear', 'weaken'] as const;
export const enum StatusBit {
  Slow = 1,
  Poison = 2,
  Burn = 4,
  Stun = 8,
  Freeze = 16,
  Bleed = 32,
  Fear = 64,
  Weaken = 128,
}
export const enum StatusIdx {
  Slow = 0,
  Poison = 1,
  Burn = 2,
  Stun = 3,
  Freeze = 4,
  Bleed = 5,
  Fear = 6,
  Weaken = 7,
}

export const ELEMENTS: readonly Element[] = ['physical', 'fire', 'ice', 'lightning', 'dark', 'poison', 'holy', 'wind'];
export const enum ElementIdx {
  Physical = 0,
  Fire = 1,
  Ice = 2,
  Lightning = 3,
  Dark = 4,
  Poison = 5,
  Holy = 6,
  Wind = 7,
}

export const enum ProjKind {
  /** player straight bolt */
  Bolt = 0,
  /** player homing bolt */
  Homing = 1,
  /** player orbital circling the player */
  Orbit = 2,
  /** summoned familiar that chases and strikes enemies */
  Familiar = 3,
  /** hostile projectile (damages players) */
  Hostile = 4,
  /**
   * hero-attached look / stationary look row (shell, veil ring, halo, decoy, bait ring): never collides, never hits.
   * `owner` = caster index, `anchor` = holder index it follows, `skill` = caster skill slot, `style` = vfx id, `radius` = look scale.
   * Spawn with companions.spawnMarker, free with companions.endMarker. Mirrored to guests like every projectile row.
   */
  Marker = 5,
}

/** ProjectileStore.role: which brain / tag a row carries (0 = a plain row or the legacy chaser) */
export const enum CompanionRole {
  Chaser = 0,
  Orbiter = 1,
  Coil = 2,
  Hunter = 3,
  /** thunder_guardians idol */
  Pylon = 4,
  /** cursed_legion knight */
  Knight = 5,
  /** shadow_clone afterimage */
  Mimic = 6,
  /** blaze_familiars twin fireball (Homing row; bursts on impact) */
  Twin = 7,
  /** wyrm_retinue breath bolt (Homing row) */
  Breath = 8,
}

/** PlayerState.trail: ring of (x, z, rot) triples, one write per tick; DT = 1/60 so TRAIL_LEN entries are ~0.8 s */
export const TRAIL_LEN = 48;
/**
 * PlayerState hurt ring entries (time, post-armor damage). The `danger` gate sums 6 s of blows and a hazard tick lands every
 * HAZARD_IFRAMES = 0.25 s (melee 0.55 s), so the ring holds 6 / 0.25 = 24 blows: a shorter one under-reads sustained damage.
 */
export const HURT_RING = 24;

export const enum PickupKind {
  Xp = 0,
  Yeop = 1,
  /** health potion */
  Heal = 2,
  Chest = 3,
  /** vacuum all gems on the field */
  Magnet = 4,
}

export const enum ZoneKind {
  /** persistent ground AoE (groundZone, hazards) */
  Circle = 0,
  /** timed spinning blade ring around the player (spinAura) */
  Spin = 1,
  /** permanent ring that follows the player (persistentAura) */
  Aura = 2,
  /** continuous beam from owner along `rot` (beam) */
  Beam = 3,
  /** delayed strike mark (skyStrike); damage lands when t >= delay */
  Strike = 4,
  /** expanding damage ring (shockwave / boss ring); radius grows 0 → `radius` over `dur` */
  Shock = 5,
  /** fire ring orbiting a metin (fireRing modifier): `radius` = orbit radius, `length` = flame blob radius */
  FireRing = 6,
}

export const enum TelegraphShape {
  Circle = 0, // a = radius
  Cone = 1, // a = length, b = full angle (rad)
  Line = 2, // a = length, b = width
  Ring = 3, // a = outer radius, c = inner (safe) radius
}

/** what a telegraph does when it expires */
export const enum TelegraphAct {
  /** visual only; damage is dealt by the owner's own movement / projectiles */
  Visual = 0,
  /** damage players inside the shape (+ knockback) */
  Hit = 1,
  /** Hit, then a meteor-style impact shake */
  Impact = 2,
  /** metin impact: damage + knockback players and enemies, spawn the metin row */
  MetinImpact = 3,
  /** Hit then leave a hostile ground zone */
  HitZone = 4,
}

/**
 * Elite affix ids (EnemyStore.affix; 0 = none). The order is data/schema AFFIX_KINDS (swift, vampiric, warded, splitting) and every id
 * is < 16: the co-op snapshot ships it in the high nibble of the enemy tier byte (tier | affix << 4, net/coop/protocol.ts packTier).
 */
export const enum AffixId {
  None = 0,
  Swift = 1,
  Vampiric = 2,
  Warded = 3,
  Splitting = 4,
}

/**
 * EnemyStore.lootTier of a copy a splitting elite leaves behind (EL-02): when it dies it drops its XP and nothing else (no yeop, potion,
 * magnet or chest). Host-side only: the column is not in the co-op snapshot, a guest only sees the XP gems.
 */
export const LOOT_XP_ONLY = 255;

// ---------------------------------------------------------------------------
// Dense stable-handle store base

export abstract class DenseStore {
  count = 0;
  readonly capacity: number;
  /** stable handle per row: (generation << 16) | slot; never 0 */
  readonly id: Uint32Array;
  private readonly slotRow: Int32Array;
  private readonly slotGen: Uint16Array;
  private readonly rowSlot: Uint16Array;
  private readonly freeSlots: Uint16Array;
  private freeTop: number;
  private readonly fields: TypedArray[] = [];
  private readonly strides: number[] = [];

  protected constructor(capacity: number) {
    this.capacity = capacity;
    this.id = new Uint32Array(capacity);
    this.slotRow = new Int32Array(capacity).fill(-1);
    this.slotGen = new Uint16Array(capacity).fill(1);
    this.rowSlot = new Uint16Array(capacity);
    this.freeSlots = new Uint16Array(capacity);
    for (let i = 0; i < capacity; i++) this.freeSlots[i] = capacity - 1 - i;
    this.freeTop = capacity;
  }

  protected f32(stride = 1): Float32Array {
    const a = new Float32Array(this.capacity * stride);
    this.fields.push(a);
    this.strides.push(stride);
    return a;
  }
  protected u8(stride = 1): Uint8Array {
    const a = new Uint8Array(this.capacity * stride);
    this.fields.push(a);
    this.strides.push(stride);
    return a;
  }
  protected u16(stride = 1): Uint16Array {
    const a = new Uint16Array(this.capacity * stride);
    this.fields.push(a);
    this.strides.push(stride);
    return a;
  }
  protected u32(stride = 1): Uint32Array {
    const a = new Uint32Array(this.capacity * stride);
    this.fields.push(a);
    this.strides.push(stride);
    return a;
  }
  protected i32(stride = 1): Int32Array {
    const a = new Int32Array(this.capacity * stride);
    this.fields.push(a);
    this.strides.push(stride);
    return a;
  }

  /** allocate a zeroed row; returns row index or -1 when full */
  alloc(): number {
    if (this.freeTop === 0) return -1;
    const slot = this.freeSlots[--this.freeTop] as number;
    const row = this.count++;
    this.slotRow[slot] = row;
    this.rowSlot[row] = slot;
    this.id[row] = (((this.slotGen[slot] as number) << 16) | slot) >>> 0;
    const fields = this.fields;
    const strides = this.strides;
    for (let i = 0; i < fields.length; i++) {
      const s = strides[i] as number;
      (fields[i] as TypedArray).fill(0, row * s, row * s + s);
    }
    return row;
  }

  /** swap-remove `row` (the last row moves into it) */
  free(row: number): void {
    const slot = this.rowSlot[row] as number;
    const last = --this.count;
    this.slotRow[slot] = -1;
    let g = ((this.slotGen[slot] as number) + 1) & 0xffff;
    if (g === 0) g = 1;
    this.slotGen[slot] = g;
    this.freeSlots[this.freeTop++] = slot;
    if (row !== last) {
      const fields = this.fields;
      const strides = this.strides;
      for (let i = 0; i < fields.length; i++) {
        const s = strides[i] as number;
        const f = fields[i] as TypedArray;
        const dst = row * s;
        const src = last * s;
        for (let k = 0; k < s; k++) f[dst + k] = f[src + k] as number;
      }
      const movedSlot = this.rowSlot[last] as number;
      this.slotRow[movedSlot] = row;
      this.rowSlot[row] = movedSlot;
      this.id[row] = this.id[last] as number;
    }
    this.id[last] = 0;
  }

  /** row of a stable handle or -1 when the entity no longer exists */
  find(handle: number): number {
    if (handle === 0) return -1;
    const slot = handle & 0xffff;
    if (slot >= this.capacity) return -1;
    const row = this.slotRow[slot] as number;
    return row >= 0 && this.id[row] === handle ? row : -1;
  }

  clear(): void {
    while (this.count > 0) this.free(this.count - 1);
  }
}

// ---------------------------------------------------------------------------
// Enemies (also metin rows, see EnemyFlag.Metin)

export class EnemyStore extends DenseStore {
  // --- render-visible
  /** index into world.typeDefs (creatures/bosses); for EnemyFlag.Metin rows: index into world.metinDefs */
  readonly type = this.u16();
  readonly x = this.f32();
  readonly z = this.f32();
  readonly px = this.f32();
  readonly pz = this.f32();
  readonly vx = this.f32();
  readonly vz = this.f32();
  readonly rot = this.f32();
  readonly prot = this.f32();
  readonly hp = this.f32();
  readonly hpMax = this.f32();
  readonly radius = this.f32();
  /** final render scale (def.scale × tier multiplier) */
  readonly scale = this.f32();
  /** current locomotion speed m/s (after slow/corruption) */
  readonly speed = this.f32();
  readonly state = this.u8();
  /** seconds in the current state (Dying: seconds since death) */
  readonly stateT = this.f32();
  readonly animClip = this.u8();
  /** seconds into the current clip (one-shots start at 0; loops: render wraps) */
  readonly animT = this.f32();
  /** hit flash 0..1 decaying */
  readonly flash = this.f32();
  /** StatusBit mask */
  readonly status = this.u16();
  /** 0 normal, 1 elite, 2 champion (knight / pack leader), 3 boss/king */
  readonly eliteTier = this.u8();
  /** elite affix (AffixId, 0 = none): rolled at spawn for tier-1 elites while affixes are enabled (EL-01), read by the host-side affix behaviours; the co-op snapshot carries it in the tier byte */
  readonly affix = this.u8();
  /** 0..1 corruption (1 = awakened-metin aura, ~0.6 live-metin aura) */
  readonly corrupted = this.f32();
  readonly flags = this.u8();

  // --- sim internals (render must not rely on them)
  readonly baseSpeed = this.f32();
  /** damage multiplier (time scaling × hard × tier × corruption) */
  readonly dmgMul = this.f32();
  readonly kvx = this.f32();
  readonly kvz = this.f32();
  readonly target = this.u8();
  readonly atk = this.u8();
  /** generic AI timers/params */
  readonly aiT = this.f32();
  readonly aiA = this.f32();
  readonly aiB = this.f32();
  /** skirmisher: absolute time until which it retreats */
  readonly aiC = this.f32();
  readonly dirX = this.f32();
  readonly dirZ = this.f32();
  /** absolute-time stamps when each attack is ready again */
  readonly atkReady = this.f32(MAX_ATTACKS);
  /** absolute time before which skill-slot `s` may hit this enemy again (orbit/aura/zone ticks) */
  readonly hitStamp = this.f32(MAX_SKILL_SLOTS);
  readonly statT = this.f32(8);
  readonly statP = this.f32(8);
  readonly statSkill = this.u8(8);
  readonly dotT = this.f32();
  /** boss index in world.bosses, metin index in world.metins, else -1 stored as 0xFFFF */
  readonly ref = this.u16();
  /** last player that damaged this enemy (xp/kill attribution) and skill slot */
  readonly lastHitter = this.u8();
  /** owner pack / spawn wave for loot rules (elite chests); LOOT_XP_ONLY = a splitting elite's copy (XP only) */
  readonly lootTier = this.u8();
  /** absolute time before which a Dispel sigil keeps this creature free of metin corruption / shadow flicker (0 = never purged) */
  readonly purgedUntil = this.f32();

  constructor(capacity: number = CAP.enemies) {
    super(capacity);
  }
}

// ---------------------------------------------------------------------------
// Projectiles (player bolts, orbitals, familiars, hostile bolts)

/** per-projectile distinct-target hit history capacity (supports high pierce + upgrades without evicting active targets) */
export const PROJ_HIT_MEM = 64;

export class ProjectileStore extends DenseStore {
  readonly kind = this.u8(); // ProjKind
  readonly x = this.f32();
  readonly z = this.f32();
  readonly px = this.f32();
  readonly pz = this.f32();
  readonly vx = this.f32();
  readonly vz = this.f32();
  readonly rot = this.f32();
  readonly radius = this.f32();
  /** seconds remaining */
  readonly life = this.f32();
  readonly lifeMax = this.f32();
  /** vfx preset / style id: index into world.strings.names (render builds its style table from the names) */
  readonly style = this.u16();
  readonly element = this.u8();
  /** 0..MAX_PLAYERS-1 owner (Bolt/Homing/Orbit/Familiar); Hostile: source enemy type for sfx */
  readonly owner = this.u8();
  /** global skill slot (damage meter, hit stamps); 255 for hostile */
  readonly skill = this.u8();
  readonly damage = this.f32();
  /** pierce charges left */
  readonly pierce = this.u8();
  // --- internals
  readonly target = this.u32();
  readonly hitMem = this.u32(PROJ_HIT_MEM);
  readonly knock = this.f32();
  readonly orbitA = this.f32();
  readonly orbitR = this.f32();
  readonly orbitW = this.f32();
  readonly aux = this.f32();
  readonly aux2 = this.f32();
  /** height above ground (m) for render */
  readonly h = this.f32();
  /** 1 = hostile (fired by an enemy) */
  readonly hostile = this.u8();
  /** seconds since spawn */
  readonly age = this.f32();
  /** CompanionRole tag (0 = plain row / legacy chaser) */
  readonly role = this.u8();
  /** player index a Marker follows / a Coil is anchored on (host); 255 = none (a stationary Marker). Zero-filled on alloc, so only Marker / Coil rows (which always set it) may read it */
  readonly anchor = this.u8();
  /** third scratch float of the role brains (lap phase, bite count, timers) */
  readonly aux3 = this.f32();
  /** damage scale of a mimic-copied projectile (0 = unset, read as `mul || 1`) */
  readonly mul = this.f32();
  /** global skill slot + 1 to credit damage to (mimic copies; 0 = none, credit to `skill`) */
  readonly credit = this.u8();

  constructor(capacity: number = CAP.projectiles) {
    super(capacity);
  }
}

// ---------------------------------------------------------------------------
// Pickups

export class PickupStore extends DenseStore {
  readonly kind = this.u8(); // PickupKind
  readonly x = this.f32();
  readonly z = this.f32();
  readonly px = this.f32();
  readonly pz = this.f32();
  readonly vx = this.f32();
  readonly vz = this.f32();
  /** hop height above ground (m) during the spawn pop; render adds terrain height */
  readonly h = this.f32();
  readonly vh = this.f32();
  /** seconds until a locked chest may warn again */
  readonly lockCd = this.f32();
  /** xp amount / yeop amount / heal fraction / chest cost */
  readonly value = this.f32();
  /** gems: 0..4 (blue, green, yellow, orange, red); coins: 0..2; chest: 0 paid, 1 free (metin), 2 boss */
  readonly tier = this.u8();
  readonly age = this.f32();
  /** 1 while magnetised towards `target` player */
  readonly magnet = this.u8();
  readonly target = this.u8();

  constructor(capacity: number = CAP.pickups) {
    super(capacity);
  }
}

// ---------------------------------------------------------------------------
// Ground AoEs (skill zones, auras, beams, strikes, hostile hazards)

export class ZoneStore extends DenseStore {
  readonly kind = this.u8(); // ZoneKind
  /** 0 = player-owned (hurts enemies), 1 = hostile (hurts players) */
  readonly team = this.u8();
  readonly x = this.f32();
  readonly z = this.f32();
  readonly px = this.f32();
  readonly pz = this.f32();
  readonly rot = this.f32();
  readonly radius = this.f32();
  /** beam length / FireRing blob radius */
  readonly length = this.f32();
  /** arc / cone angle (rad) when relevant */
  readonly angle = this.f32();
  /** age and total duration (seconds) */
  readonly t = this.f32();
  readonly dur = this.f32();
  /** Strike: seconds until the impact; others 0 */
  readonly delay = this.f32();
  readonly tick = this.f32();
  readonly tickT = this.f32();
  /** owner player index + 1 whose position the zone follows (0 = fixed) */
  readonly follow = this.u8();
  readonly preset = this.u16();
  readonly element = this.u8();
  readonly owner = this.u8();
  readonly skill = this.u8();
  readonly damage = this.f32();
  readonly knock = this.f32();
  /** Strike/Shock/Beam bookkeeping */
  readonly aux = this.f32();
  readonly aux2 = this.f32();
  /** source metin/boss handle for hostile zones (0 = none) */
  readonly src = this.u32();
  /** damage scale of a ticking zone (mimic copies); 0 = unset, read it as `mul || 1` */
  readonly mul = this.f32();
  /** global skill slot + 1 to credit damage to (mimic copies; 0 = none, credit to `skill`) */
  readonly credit = this.u8();

  constructor(capacity: number = CAP.zones) {
    super(capacity);
  }
}

// ---------------------------------------------------------------------------
// Telegraphs (boss/elite/metin warning decals; resolve into hits)

export class TelegraphStore extends DenseStore {
  readonly shape = this.u8(); // TelegraphShape
  readonly act = this.u8(); // TelegraphAct
  readonly x = this.f32();
  readonly z = this.f32();
  readonly rot = this.f32();
  /** Circle: radius; Cone: length; Ring: outer radius; Line: unused */
  readonly radius = this.f32();
  /** Line: length; Ring: inner (safe) radius */
  readonly length = this.f32();
  /** Cone: full angle (rad); Line: width (m) */
  readonly width = this.f32();
  readonly t = this.f32();
  readonly dur = this.f32();
  /** 0..1 wind-up progress (t / dur), maintained by the sim */
  readonly progress = this.f32();
  /** source enemy handle the decal follows (0 = fixed in world) */
  readonly follow = this.u32();
  /** 0 enemy attack, 1 boss attack, 2 metin */
  readonly owner = this.u8();
  readonly element = this.u8();
  readonly damage = this.f32();
  readonly knock = this.f32();
  /** vfx preset for the resolved impact */
  readonly preset = this.u16();
  /** extra payload: HitZone → zone duration; MetinImpact → metin id */
  readonly aux = this.f32();

  constructor(capacity: number = CAP.telegraphs) {
    super(capacity);
  }
}

// ---------------------------------------------------------------------------
// Players

export type HeroClip = 'idle' | 'run' | 'cast' | 'dash' | 'attack' | 'hit' | 'death' | 'victory';

/** Derived stats, recomputed whenever passives/stones/trinkets/buffs change (see stats.ts). */
export interface PlayerStats {
  maxHp: number;
  armor: number;
  regen: number;
  moveSpeed: number;
  /** damage multiplier (1 = base) */
  damage: number;
  critChance: number;
  /** total crit multiplier (≥ 1.5 by default) */
  critMul: number;
  /** multiplier applied to every skill cooldown (≤ 1 is faster) */
  cooldownMul: number;
  area: number;
  duration: number;
  /** extra projectiles / strikes / orbitals (flat) */
  projectiles: number;
  projSpeed: number;
  pierce: number;
  xpGain: number;
  yeopGain: number;
  pickupRadius: number;
  luck: number;
  revives: number;
  lifesteal: number;
  evasion: number;
  thorns: number;
  vsBoss: number;
  /** per-race damage bonus (fractions) */
  vsRace: Partial<Record<RaceTag, number>>;
  /** per-element damage reduction (fractions, capped) indexed by ElementIdx */
  resist: Float32Array;
  // trinket effects (0 = not equipped)
  chainChance: number;
  chainDamage: number;
  stunChance: number;
  stunDuration: number;
  slowChance: number;
  slowPower: number;
  slowDuration: number;
  poisonChance: number;
  poisonPower: number;
  poisonDuration: number;
  critBurstRadius: number;
  critBurstDamage: number;
  shieldMax: number;
  shieldRegen: number;
}

export interface UpgradeAcc {
  pct: number;
  flat: number;
}

export const UPGRADE_STATS = [
  'damage',
  'cooldown',
  'area',
  'count',
  'duration',
  'speed',
  'pierce',
  'knockback',
  'tick',
  'range',
  'statusChance',
  'statusPower',
  'heal',
] as const;

/** A skill the player owns. */
export interface SkillInstance {
  /** global slot across all players (index into damage meter / hit stamps) */
  slot: number;
  owner: number;
  def: SkillDef;
  /** 0..7 (SKILL_RANKS[rank] is the label); 7 = P = awakened */
  rank: number;
  /** accumulated upgrade lines, indexed like UPGRADE_STATS */
  upg: UpgradeAcc[];
  /** seconds until the next activation */
  cd: number;
  /** behavior scratch (aura zone handle, beam handle, queued echo casts…) */
  h1: number;
  h2: number;
  aux: number;
  /** total damage dealt (damage meter) */
  damage: number;
  /** resolved parameters, refreshed every tick by updateSkills (zones/projectiles read live status/knockback here) */
  fp: FinalParams;
  basic: boolean;
  ultimate: boolean;
  /** seconds this skill has been armed (gate shut, cd 0); reset when it fires (patience) */
  armedT: number;
  /** stable handles of permanent companion / marker rows this skill owns (orbiter spirits, coil, decoy, shell marker) */
  pets: number[];
  /** seconds of cooldown refunded by kills in the current cooldown cycle (cap balance.triggers.refundCap) */
  refunded: number;
  /** vfx only: sim time of the last kill pulse / brand re-emit of this skill (throttle) */
  fxT: number;
  /** vfx only: stable handles of the creatures a `mark` skill branded (eagle eye) and when the brand look ends */
  marks: number[];
  markEnd: number;
}

export interface PassiveInstance {
  id: string;
  rank: number;
  /** Σ RARITY_MULT of the cards picked for this passive; effect = perRank × power */
  power: number;
}

export interface StoneInstance {
  id: string;
  /** 0..4 shown as +N */
  level: number;
}

export interface TrinketInstance {
  id: string;
  rank: number;
}

export interface ActiveBuff {
  /** the CASTER's skill slot: two casters' buffs of the same skill stack independently */
  skillSlot: number;
  mods: StatMods;
  left: number;
  total: number;
  /** magnitude multiplier of `mods` (kill-fed stack); absent = 1 */
  scale?: number;
  /** seconds added to the window by kills so far (cap balance.triggers.extendCap x base duration); absent = 0 */
  ext?: number;
}

/**
 * Per-hero gate context (DESIGN M1), filled lazily by sim/skills/trigger.ts heroCtx() and valid while `tick === w.tick`.
 * Counts use the radii of World.trig. -1 in a lazily evaluated field = not evaluated this tick.
 */
export interface HeroCtx {
  tick: number;
  /** creatures within trig.pinned.r */
  nPinned: number;
  /** creatures within trig.engaged.r */
  nEngaged: number;
  /** an elite or boss within trig.elite.r */
  eliteNear: boolean;
  /** a boss within trig.boss.r */
  bossNear: boolean;
  /** hostile bolts within trig.volley.r, -1 = not evaluated */
  volleyN: number;
  /** 1 = a living ally within reach is hurt / low, 0 = no, -1 = not evaluated */
  allyNeed: number;
}

export function newHeroCtx(): HeroCtx {
  return { tick: -1, nPinned: 0, nEngaged: 0, eliteNear: false, bossNear: false, volleyN: -1, allyNeed: -1 };
}

export interface PlayerInput {
  /** desired movement direction in WORLD XZ (any length; sim clamps to unit) */
  moveX: number;
  moveZ: number;
  /** manual basic attack trigger (Space / LMB); omitted/false = existing auto behavior */
  attack?: boolean;
  /** bitmask of manually requested skill bar slots (bit 0 = slot 1 basic, bit 1..7 = actives/ultimates) */
  castMask?: number;
  /** optional world-space XZ aim vector (mouse cursor raycast); omitted = auto/facing */
  aimX?: number;
  aimZ?: number;
  /** when true, skips automatic skill/basic casting unless triggered manually; omitted/false = auto-cast on */
  manualCast?: boolean;
}

export class PlayerState {
  index = 0;
  classId: ClassId = 'warrior';
  doctrine: DoctrineKey = 'a';
  sex: Sex = 'm';
  empire: EmpireId = 'saehwa';
  alive = true;
  /** hero armor tier look is chosen by render from meta gear; sim does not track it */
  x = 0;
  z = 0;
  px = 0;
  pz = 0;
  vx = 0;
  vz = 0;
  rot = 0;
  prot = 0;
  /** last normalized input */
  moveX = 0;
  moveZ = 0;
  /** transient manual combat input for this tick (never serialized) */
  wantAttack = false;
  wantCastMask = 0;
  manualCast = false;
  aimX = 0;
  aimZ = 0;
  hasAim = false;
  /** true only inside a manual behavior.cast() invocation so aimOrManual allows firing into open air */
  manualAim = false;
  radius = 0.55;
  /** current move speed m/s (drives run-cycle speed) */
  speed = 0;
  /** 0..1 hit flash / i-frame blink */
  flash = 0;
  /** 0..1 corruption near a metin aura */
  corrupted = 0;
  get dead(): boolean {
    return !this.alive;
  }
  hp = 100;
  hpMax = 100;
  shield = 0;
  level = 1;
  xp = 0;
  xpNext = 10;
  yeop = 0;
  shards = 0;
  /** total yeop collected over the run (not reduced by spending) */
  yeopEarned = 0;
  kills = 0;
  /** seconds of invulnerability left */
  iframes = 0;
  /** forced movement (dash / leap): remaining seconds, velocity, and the skill slot that owns it (-1 none) */
  dashT = 0;
  dashVx = 0;
  dashVz = 0;
  dashSlot = -1;
  /** knockback velocity applied to the hero (decays) */
  kvx = 0;
  kvz = 0;
  /** slows from hostile auras: multiplier on move speed this tick */
  slowMul = 1;
  /** seconds the hero has stood on a hurting surface (tick timer) */
  surfT = 0;
  stats!: PlayerStats;
  statsDirty = true;
  /** always-on additive mods: empire, meta (gear/talents), class base extras */
  fixed: StatMods[] = [];
  /** per-skill talent modifiers (pct fractions per UpgradeStat) from MetaBonuses.skillMods */
  skillMods: Record<string, Partial<Record<UpgradeStat, number>>> = {};
  /** damage multiplier vs each world.typeDefs index (race bonuses), rebuilt with the stats */
  raceMul: Float32Array = new Float32Array(0);
  skills: SkillInstance[] = [];
  passives: PassiveInstance[] = [];
  /** spirit stones: indices 0..2 weapon, 3..5 armor; null = empty */
  stones: (StoneInstance | null)[] = [null, null, null, null, null, null];
  /** [bracelet, necklace, earring] */
  trinkets: (TrinketInstance | null)[] = [null, null, null];
  buffs: ActiveBuff[] = [];
  banished = new Set<string>();
  rerolls = 0;
  banishes = 0;
  skips = 0;
  revivesUsed = 0;
  /** hero animation */
  clip: HeroClip = 'idle';
  clipT = 0;
  /** seconds the 'cast' clip is forced */
  castT = 0;
  /** lifesteal heal budget accumulator (per second cap) */
  healBudget = 0;
  shieldCd = 0;
  regenAcc = 0;
  /** pending level-ups waiting to be offered */
  pendingLevels = 0;
  /** chests opened (chest cost formula, per player) */
  chestsOpened = 0;
  /** damage taken (stats) */
  damageTaken = 0;
  /** seconds since the last damage was taken (regen delay etc.) */
  sinceHit = 99;
  /**
   * what dealt the last blow that took hit points (DT-01, sim/combat.ts hurtPlayer): an EnemyDef id, 'boss:<id>', 'metin:<id>'
   * (aura, impact or ground field) or 'hazard:<kind>' (lava, miasma, zone); '' = no blow yet / the source could not be told.
   * Pure bookkeeping for the defeat report: nothing in the sim reads it.
   */
  lastHitBy = '';
  /** the run clock (w.time) of that blow; -1 = none */
  lastHitAt = -1;
  /** the killer as of the real death (no revive left): lastHitBy frozen by playerDown; '' = not dead / unknown source */
  killedBy = '';
  /** the run clock of the real death; -1 = alive (a revive is not a death) */
  killedAt = -1;
  /** last rarity picked etc. for UI */
  lastPickRarity: Rarity = 'common';

  // ---- skill-logic hero shells (DESIGN M2); all zero / -1 = nothing active ----
  /** ward: absorb pool HP left, its size, seconds left, global skill slot that granted it (-1), caster player index (-1), damage absorbed so far */
  ward = 0;
  wardMax = 0;
  wardT = 0;
  wardSlot = -1;
  wardOwner = -1;
  wardAbsorbed = 0;
  /** the marker row (handle) that draws the ward / shell look; ended with the ward (0 = none) */
  wardMark = 0;
  /** vfx only: sim time of the last `sk.gen.ward_hit` drawn for this hero (throttle, <= 4 per second) and whether the shell marker already wears its WORN look (ward under 40 %) */
  wardHitT = -9;
  wardWorn = false;
  /** seconds non-boss creatures drop this hero as a target (veil) */
  veilT = 0;
  /** the stealth decoy left at the cast point: position and the caster skill slot (-1 = none); it bursts when the veil ends */
  decoyX = 0;
  decoyZ = 0;
  decoySlot = -1;
  /** dodge charges left (negate the next non-hazard blows) and the seconds they last */
  dodgeN = 0;
  dodgeT = 0;
  /** seconds pushes are ignored (steady shell) */
  steadyT = 0;
  /** mirror shell: seconds left and radius (m) in which hostile bolts are turned */
  mirrorT = 0;
  mirrorR = 0;
  /** hurt ring: sim time and post-armor / pre-ward damage of the last HURT_RING blows; `hurtN` counts all writes */
  readonly hurtT = new Float64Array(HURT_RING);
  readonly hurtA = new Float32Array(HURT_RING);
  hurtN = 0;
  /** damage dealt by this hero, exponentially decayed (~5 s); the coil picks the ally with the most */
  dmgRecent = 0;
  /** global skill slot of the lethal-armed skill (War Oath) that will cancel the next killing blow; -1 = none */
  lethalSlot = -1;
  /** position trail, TRAIL_LEN (x, z, rot) triples written one per tick (mimic follows it); `trailN` counts all writes */
  readonly trail = new Float32Array(TRAIL_LEN * 3);
  trailN = 0;
  /** gate context cache (trigger.ts) */
  readonly ctx: HeroCtx = newHeroCtx();

  /** record one blow (post-armor, before ward / shield) in the hurt ring */
  pushHurt(time: number, amount: number): void {
    const i = this.hurtN % HURT_RING;
    this.hurtT[i] = time;
    this.hurtA[i] = amount;
    this.hurtN++;
  }

  /** total post-armor damage recorded within the last `window` seconds before `now` */
  hurtSum(now: number, window: number): number {
    let sum = 0;
    const n = Math.min(this.hurtN, HURT_RING);
    for (let k = 0; k < n; k++) if (now - (this.hurtT[k] as number) <= window) sum += this.hurtA[k] as number;
    return sum;
  }

  /** append the current position / facing to the trail ring */
  pushTrail(x: number, z: number, rot: number): void {
    const i = (this.trailN % TRAIL_LEN) * 3;
    this.trail[i] = x;
    this.trail[i + 1] = z;
    this.trail[i + 2] = rot;
    this.trailN++;
  }

  /**
   * trail entry `back` ticks ago (0 = the newest) as the flat offset of its x in `trail` (z = +1, rot = +2);
   * clamps to the oldest recorded entry, -1 when nothing was recorded yet
   */
  trailOffset(back: number): number {
    if (this.trailN === 0) return -1;
    const b = Math.min(Math.max(0, Math.floor(back)), Math.min(this.trailN, TRAIL_LEN) - 1);
    return ((((this.trailN - 1 - b) % TRAIL_LEN) + TRAIL_LEN) % TRAIL_LEN) * 3;
  }
}
