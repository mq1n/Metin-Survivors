// Per-sound playback rules (priority, concurrency, spacing, variation, distance) and sim-id → manifest-id resolution.
//
// The simulation / content name sounds freely (`sfx_death_wolf`, `sfx_boss_slam`, `sfx_bear_swipe_heavy`, …). Every id is
// resolved ONCE (cached) to a manifest id: exact match → explicit alias → keyword rules → null (silently ignored; one DEV
// warning per unknown id so content authors can fix it).

export interface SfxRule {
  /** 0..9. When the voice pool is full a higher priority steals the oldest lower-priority voice. */
  prio: number;
  /** max simultaneous instances of this id */
  max: number;
  /** minimum seconds between two starts of this id */
  gap: number;
  /** random pitch spread, ± cents */
  pitch: number;
  /** random level spread, ± dB */
  vol: number;
  /** metres up to which the sound is at full level (0 + falloff 0 = not positional) */
  range: number;
  /** metres at which the sound is inaudible (distance attenuation between range..falloff) */
  falloff: number;
  /** extra linear trim on top of the manifest gain */
  trim: number;
  /** duck the music bus: [dB, holdSeconds] */
  duck?: readonly [number, number];
}

const BASE: SfxRule = { prio: 4, max: 3, gap: 0.03, pitch: 60, vol: 1, range: 9, falloff: 46, trim: 1 };

type RuleSpec = readonly [RegExp, Partial<SfxRule>];

// First match wins.
const RULES: readonly RuleSpec[] = [
  // picked by the UI and again by the sim at the hero position: the second one inside 0.3 s is dropped
  [/^sfx_card_pick/, { prio: 7, max: 1, gap: 0.3, pitch: 0, vol: 0, range: 0, falloff: 0 }],
  [/^sfx_ui_|^sfx_card_/, { prio: 7, max: 3, gap: 0.015, pitch: 0, vol: 0.4, range: 0, falloff: 0 }],
  [/^sfx_xp_pickup/, { prio: 2, max: 5, gap: 0.028, pitch: 0, vol: 0, range: 20, falloff: 70, trim: 0.9 }],
  [/^sfx_yeop_/, { prio: 2, max: 3, gap: 0.05, pitch: 80, vol: 1, range: 20, falloff: 70 }],
  [/^sfx_potion/, { prio: 5, max: 2, gap: 0.2, pitch: 0, range: 20, falloff: 70 }],
  [/^sfx_magnet/, { prio: 5, max: 1, gap: 0.5, pitch: 0, range: 30, falloff: 90 }],
  [/^sfx_hit_/, { prio: 3, max: 4, gap: 0.04, pitch: 150, vol: 1.5, range: 8, falloff: 38 }],
  [/^sfx_crit/, { prio: 6, max: 2, gap: 0.07, pitch: 80, range: 10, falloff: 44 }],
  [/^sfx_burn_tick/, { prio: 1, max: 2, gap: 0.14, pitch: 200, vol: 2, range: 8, falloff: 30, trim: 0.7 }],
  [/^sfx_death_/, { prio: 3, max: 4, gap: 0.05, pitch: 120, vol: 1.5, range: 8, falloff: 40 }],
  [/^sfx_enemy_|^sfx_telegraph/, { prio: 3, max: 3, gap: 0.06, pitch: 100, vol: 1.5, range: 8, falloff: 34 }],
  [/^sfx_player_hurt/, { prio: 8, max: 1, gap: 0.15, pitch: 60, vol: 1, range: 0, falloff: 0 }],
  [/^sfx_player_death/, { prio: 9, max: 1, gap: 1, pitch: 0, vol: 0, range: 0, falloff: 0 }],
  [/^sfx_(level_up|awaken|revive|run_start|essence_pick)/, { prio: 9, max: 1, gap: 0.35, pitch: 0, vol: 0, range: 0, falloff: 0, duck: [7, 1.1] }],
  [/^sfx_chest_open|^sfx_forge_/, { prio: 6, max: 1, gap: 0.3, pitch: 0, vol: 0, range: 20, falloff: 80 }],
  [/^sfx_boss_(spawn|death|roar|phase)/, { prio: 9, max: 2, gap: 0.25, pitch: 0, vol: 0, range: 30, falloff: 160, duck: [6, 1.3] }],
  [/^sfx_boss_/, { prio: 7, max: 2, gap: 0.15, pitch: 40, vol: 1, range: 22, falloff: 110 }],
  [/^sfx_metin_/, { prio: 9, max: 2, gap: 0.5, pitch: 0, vol: 0, range: 30, falloff: 170, duck: [5, 0.9] }],
  [/^sfx_(explosion_large|lightning_strike|ground_slam|shockwave)/, { prio: 6, max: 3, gap: 0.08, pitch: 100, vol: 1, range: 14, falloff: 80 }],
  [/^sfx_explosion/, { prio: 5, max: 3, gap: 0.06, pitch: 120, vol: 1, range: 12, falloff: 60 }],
  [/^sfx_(wolf_howl|dragon_roar)/, { prio: 8, max: 1, gap: 0.5, pitch: 0, vol: 0, range: 18, falloff: 90, duck: [4, 0.8] }],
  [/^sfx_(sword|dagger|bow|claw|dash|projectile|talisman|arrow)/, { prio: 4, max: 3, gap: 0.05, pitch: 100, vol: 1, range: 10, falloff: 46 }],
];

const ruleCache = new Map<string, SfxRule>();

export function ruleFor(id: string): SfxRule {
  let r = ruleCache.get(id);
  if (r) return r;
  r = { ...BASE };
  for (const [re, patch] of RULES) {
    if (re.test(id)) {
      Object.assign(r, patch);
      break;
    }
  }
  ruleCache.set(id, r);
  return r;
}

// ---------------------------------------------------------------------------------------------------------------------
// id resolution

const ALIASES: Readonly<Record<string, string>> = {
  sfx_metin_warn: 'sfx_metin_warning',
  sfx_metin_break: 'sfx_metin_shatter',
  sfx_metin_land: 'sfx_metin_impact',
  sfx_boss_enrage: 'sfx_boss_roar',
  sfx_awakening: 'sfx_awaken',
  sfx_heal: 'sfx_holy_chime',
  sfx_pickup_yeop: 'sfx_yeop_pickup',
  sfx_pickup_xp: 'sfx_xp_pickup',
  sfx_pickup_potion: 'sfx_potion',
  sfx_pickup_magnet: 'sfx_magnet',
  sfx_chest: 'sfx_chest_open',
  sfx_levelup: 'sfx_level_up',
};

// Ordered keyword rules for ids that are not in the manifest. First match wins.
const KEYWORDS: readonly (readonly [RegExp, string])[] = [
  // deaths by race / creature
  [/^sfx_death_boss|^sfx_boss_death/, 'sfx_boss_death'],
  [/^sfx_death_.*(golem|stone|rock|statue|metin)/, 'sfx_death_golem'],
  [/^sfx_death_.*(ice|frost|snow|yeti|whale|glacier)/, 'sfx_death_ice'],
  [/^sfx_death_.*(fire|flame|ember|lizard|lava|salamander|imp|demon|devil)/, 'sfx_death_fire'],
  [/^sfx_death_.*(ghost|spirit|mystic|wraith|witch|shaman|zealot|cult|esoteric|mage|wizard|fox)/, 'sfx_death_mystic'],
  [/^sfx_death_.*(skeleton|undead|bone|zombie|ghoul|corpse|dead)/, 'sfx_death_undead'],
  [/^sfx_death_.*(orc|ogre|goblin|troll|human|brute|warrior|executioner|general)/, 'sfx_death_orc'],
  [/^sfx_death_.*(wolf|dog|boar|bear|tiger|jackal|rat|animal|beast|cat|lion|scorpion|insect|spider|bug|hound|deer|snake|ant)/, 'sfx_death_animal'],
  [/^sfx_death_/, 'sfx_death_generic'],
  // impacts
  [/^sfx_hit_.*(chitin|scale|armor|metal|shell|iron|steel|crystal)/, 'sfx_hit_armor'],
  [/^sfx_hit_.*(stone|rock|golem|ice|imp)/, 'sfx_hit_stone'],
  [/^sfx_hit_.*(heavy|big|boss)/, 'sfx_hit_flesh_heavy'],
  [/^sfx_hit_/, 'sfx_hit_flesh'],
  // enemy attacks
  [/(bite|chomp|snap|fang)/, 'sfx_enemy_bite'],
  [/(roar|howl_boss|growl)/, 'sfx_boss_roar'],
  [/(breath|flamethrower)/, 'sfx_boss_breath'],
  [/(spit|fuse|hiss|plague|hum|toxic|venom|poison)/, 'sfx_poison_hiss'],
  [/(charge|stampede|rush|boar)/, 'sfx_enemy_whoosh_heavy'],
  [/(swipe|claw|scratch|slash_enemy|maul|paw)/, 'sfx_enemy_swipe'],
  // bosses
  [/^sfx_boss_(slam|stomp|smash)/, 'sfx_boss_slam'],
  [/^sfx_boss_(land|jump|leap)/, 'sfx_boss_land'],
  [/^sfx_boss_(volley|barrage|shot|bolt|spit)/, 'sfx_boss_volley'],
  [/^sfx_boss_(summon|call|spawn_adds)/, 'sfx_boss_summon'],
  [/^sfx_boss_(ring|wave|shock)/, 'sfx_boss_ring'],
  [/^sfx_boss_(meteor|rain|comet|fall)/, 'sfx_boss_meteor'],
  [/^sfx_boss_(nova|burst|blast)/, 'sfx_boss_nova'],
  [/^sfx_boss_(teleport|blink|vanish)/, 'sfx_boss_teleport'],
  [/^sfx_boss_/, 'sfx_boss_phase'],
  // player skills / generic effects
  [/(lightning|thunder|chain|bolt|spark|beam|electr)/, 'sfx_lightning_cast'],
  [/(meteor|explo|blast|bomb|nova)/, 'sfx_explosion_small'],
  [/(earthquake|quake|slam|stomp|ground|smash|landing)/, 'sfx_ground_slam'],
  [/(wave|shock|arc_of_might|ring)/, 'sfx_shockwave'],
  [/(fire|flame|burn|ember|inferno|blaze)/, 'sfx_fire_cast'],
  [/(frost|ice|freeze|glacier|snow|cold)/, 'sfx_ice_cast'],
  [/(dark|shadow|ghost|phantom|curse|soul|death|spirit|wraith|hex)/, 'sfx_dark_cast'],
  [/(heal|bless|holy|light|will_to_live|life|revive|protect|shield)/, 'sfx_holy_chime'],
  [/(wind|gust|tornado|air_blade)/, 'sfx_wind_gust'],
  [/(summon|familiar|dragon_help|call)/, 'sfx_summon_cast'],
  [/(dragon|roar_skill)/, 'sfx_dragon_roar'],
  [/(wolf|wolfman|kurt)/, 'sfx_wolf_howl'],
  [/(talisman|charm|fan|bell|flying)/, 'sfx_talisman_throw'],
  [/(arrow|bow|shot|volley|snipe)/, 'sfx_bow_shot'],
  [/(dagger|stab|assassin|knife|blade_spin|throw)/, 'sfx_dagger'],
  [/(dash|lunge|leap|jump|sprint|step|blink)/, 'sfx_dash_whoosh'],
  [/(aura|buff|fury|rage|strength|haste|speed|boost|power_up|armor_up|magic_armor)/, 'sfx_buff_cast'],
  [/(spin|circle|tornado_blade|whirl|sweep)/, 'sfx_sword_swing_heavy'],
  [/(sword|cut|arc|slash|blade|strike|three_way|swing|finger|claw)/, 'sfx_sword_swing_light'],
  [/(projectile|bolt|spirit_bolt|missile|orb)/, 'sfx_projectile_whoosh'],
];

export type HasId = (id: string) => boolean;

export class SfxResolver {
  private readonly cache = new Map<string, string | null>();
  private readonly warned = new Set<string>();

  constructor(
    private readonly has: HasId,
    private readonly onUnknown?: (id: string) => void,
  ) {}

  /** manifest id for a sim/content sound name, or null (= silent). */
  resolve(id: string): string | null {
    const hit = this.cache.get(id);
    if (hit !== undefined) return hit;
    let out: string | null = null;
    if (this.has(id)) out = id;
    else {
      const a = ALIASES[id];
      if (a && this.has(a)) out = a;
      else {
        for (const [re, target] of KEYWORDS) {
          if (re.test(id) && this.has(target)) {
            out = target;
            break;
          }
        }
      }
    }
    if (out === null && !this.warned.has(id)) {
      this.warned.add(id);
      this.onUnknown?.(id);
    }
    this.cache.set(id, out);
    return out;
  }
}

/** sounds that a dedicated sim event already covers; the generic `sfx` event for these ids is dropped to avoid doubling. */
export const EVENT_DRIVEN: Readonly<Record<string, true>> = {
  sfx_metin_warning: true,
  sfx_metin_impact: true,
  sfx_metin_awaken: true,
  sfx_metin_shatter: true,
  sfx_boss_spawn: true,
  sfx_boss_death: true,
  sfx_level_up: true,
};
