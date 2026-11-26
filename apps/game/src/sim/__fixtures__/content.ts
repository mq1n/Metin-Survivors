// Fixture ContentDB for headless sim tests (until the real content JSON lands).
//
// Shape: 1 class ('warrior', doctrines a/b), 18 skills (all 16 BehaviorKinds + 2 basics), 8 passives,
// 5 stones, 6 trinkets, 11 enemies, 3 bosses, 3 metins, 1 zone ('fx_plains'), balance, 3 empires.
// Every cross-reference (doctrine skills, band spawns/elites, metin swarms, boss slots, boss phase patterns) resolves.
//
// Tests that mutate content MUST use cloneContent(); never mutate `fixtureContent` itself.

import type {
  BalanceConfig,
  ClassDef,
  ContentDB,
  EmpireDef,
  PassiveDef,
  StatMods,
  StoneDef,
  StoryDef,
  TrinketDef,
} from '../../data/schema';
import type { RunOptionsConfig } from '../../data/loader';
import type { RunConfig } from '../run';
import { fixtureBosses, fixtureEnemies, fixtureMetins } from './enemies';
import { t } from './helpers';
import { fixtureSkills } from './skills';
import { FIXTURE_ZONE_ID, fixtureZone } from './zone';

export { FIXTURE_ZONE_ID };

// ---------------------------------------------------------------------------
// Classes

const warrior: ClassDef = {
  id: 'warrior',
  name: t('Savaşçı', 'Warrior'),
  desc: t(
    'Kılıcın ve iradenin ustası; ister bedenini ister ruhunu keskinleştirir.',
    'A master of blade and will who hones either body or spirit.',
  ),
  sexes: ['m', 'f'],
  doctrines: [
    {
      id: 'a',
      name: t('Bedensel', 'Body'),
      desc: t(
        'Çelik gibi beden: yakın dövüş, dayanıklılık ve saldırgan hamleler.',
        'A body of steel: close combat, resilience and aggressive lunges.',
      ),
      basic: 'sword_arc',
      starter: 'lightning_trio',
      skills: ['lightning_trio', 'bladewheel', 'fury_aura', 'lunge', 'aura_sword', 'war_leap'],
    },
    {
      id: 'b',
      name: t('Zihinsel', 'Mind'),
      desc: t(
        'Keskin zihin: ruh enerjisi, menzilli saldırılar ve çağrılan kılıçlar.',
        'A sharp mind: spirit energy, ranged strikes and summoned blades.',
      ),
      basic: 'spirit_bolt',
      starter: 'soul_crash',
      skills: [
        'soul_crash',
        'sky_blades',
        'chain_lightning',
        'sword_circle',
        'frost_cleave',
        'phantom_blades',
        'soul_beam',
      ],
    },
  ],
  base: { maxHp: 220, armor: 8, moveSpeed: 5.6, critChance: 0.05, critDamage: 0, regen: 0.4 },
  models: {
    m: ['warrior_m_t0', 'warrior_m_t1', 'warrior_m_t2', 'warrior_m_t3'],
    f: ['warrior_f_t0', 'warrior_f_t1', 'warrior_f_t2', 'warrior_f_t3'],
  },
  weapons: ['warrior_sword_t0', 'warrior_sword_t1', 'warrior_sword_t2', 'warrior_sword_t3'],
  portrait: { m: 'portrait_warrior_m', f: 'portrait_warrior_f' },
};

// ---------------------------------------------------------------------------
// Passives (pool of 8 > maxPassives 6, so the slot cap is testable)

const passives: PassiveDef[] = [
  {
    id: 'sovereign_blood',
    name: t('Gök Hükümdarı’nın Kanı', 'Sky Sovereign\u2019s Blood'),
    desc: t('Her rütbede azami canı %8 artırır.', 'Increases max HP by 8% per rank.'),
    icon: 'icon_passive_sovereign_blood',
    perRank: { maxHpPct: 0.08 },
    maxRank: 5,
  },
  {
    id: 'holy_armor',
    name: t('Arınmış Zırh', 'Holy Armor'),
    desc: t('Her rütbede zırhı 6 artırır.', 'Increases armor by 6 per rank.'),
    icon: 'icon_passive_holy_armor',
    perRank: { armor: 6 },
    maxRank: 5,
  },
  {
    id: 'haste',
    name: t('Hızlandırma', 'Haste'),
    desc: t('Her rütbede hareket hızını %4 artırır.', 'Increases movement speed by 4% per rank.'),
    icon: 'icon_passive_haste',
    perRank: { moveSpeed: 0.04 },
    maxRank: 5,
  },
  {
    id: 'fury',
    name: t('Gök Hükümdarı’nın Gazabı', 'Sky Sovereign\u2019s Fury'),
    desc: t(
      'Her rütbede kritik şansını %3, kritik hasarını %5 artırır.',
      'Increases crit chance by 3% and crit damage by 5% per rank.',
    ),
    icon: 'icon_passive_fury',
    perRank: { critChance: 0.03, critDamage: 0.05 },
    maxRank: 5,
  },
  {
    id: 'focus',
    name: t('Süratli Çağrı', 'Spell Support'),
    desc: t('Her rütbede bekleme sürelerini %4 kısaltır.', 'Reduces cooldowns by 4% per rank.'),
    icon: 'icon_passive_focus',
    perRank: { cooldown: 0.04 },
    maxRank: 5,
  },
  {
    id: 'eyes',
    name: t('Hükümdar Gözleri', 'Sovereign Eyes'),
    desc: t('Her rütbede yeteneklerin alanını %6 genişletir.', 'Widens skill areas by 6% per rank.'),
    icon: 'icon_passive_eyes',
    perRank: { area: 0.06 },
    maxRank: 5,
  },
  {
    id: 'fortune',
    name: t('Karizma', 'Charisma'),
    desc: t('Her rütbede şansı 0,05 artırır; nadir kartlar daha sık gelir.', 'Raises luck by 0.05 per rank; rare cards appear more often.'),
    icon: 'icon_passive_fortune',
    perRank: { luck: 0.05 },
    maxRank: 5,
  },
  {
    id: 'ghostly_grasp',
    name: t('Görünmez Avuç', 'Ghostly Grasp'),
    desc: t('Her rütbede toplama menzilini %12 artırır.', 'Increases pickup range by 12% per rank.'),
    icon: 'icon_passive_ghostly_grasp',
    perRank: { pickupRadius: 0.12 },
    maxRank: 5,
  },
];

// ---------------------------------------------------------------------------
// Soul pearls (3 weapon, 2 armor). perLevel applies × (level + 1).

const stones: StoneDef[] = [
  {
    id: 'piercing',
    slot: 'weapon',
    name: t('Delici İnci', 'Piercing Stone'),
    desc: t(
      'Seviye başına %4 hasar ve 1 delme kazandırır.',
      'Grants 4% damage and 1 pierce per level.',
    ),
    icon: 'icon_pearl_piercing',
    perLevel: { damage: 0.04, pierce: 1 },
    maxLevel: 4,
  },
  {
    id: 'deadly',
    slot: 'weapon',
    name: t('Ölümcül İnci', 'Deadly Stone'),
    desc: t('Seviye başına kritik şansını %3 artırır.', 'Increases crit chance by 3% per level.'),
    icon: 'icon_stone_deadly',
    perLevel: { critChance: 0.03 },
    maxLevel: 4,
  },
  {
    id: 'beast_hunter',
    slot: 'weapon',
    name: t('Canavar Avcısı Taşı', 'Beast Hunter Stone'),
    desc: t(
      'Seviye başına hayvanlara karşı %6 fazla hasar verir.',
      'Deals 6% more damage to animals per level.',
    ),
    icon: 'icon_stone_beast_hunter',
    perLevel: { vsRace: { animal: 0.06 } },
    maxLevel: 4,
  },
  {
    id: 'evasion',
    slot: 'armor',
    name: t('Sıyrılma İncisi', 'Evasion Stone'),
    desc: t('Seviye başına kaçınma şansını %2 artırır.', 'Increases evasion by 2% per level.'),
    icon: 'icon_pearl_evasion',
    perLevel: { evasion: 0.02 },
    maxLevel: 4,
  },
  {
    id: 'life',
    slot: 'armor',
    name: t('Can İncisi', 'Life Stone'),
    desc: t(
      'Seviye başına azami canı %3 ve yenilenmeyi 0,15 artırır.',
      'Increases max HP by 3% and regeneration by 0.15 per level.',
    ),
    icon: 'icon_pearl_life',
    perLevel: { maxHpPct: 0.03, regen: 0.15 },
    maxLevel: 4,
  },
];

// ---------------------------------------------------------------------------
// Trinkets. perRank keys: chance/pct/amount/power/damage/regen scale linearly with rank; radius/duration do not.

const trinkets: TrinketDef[] = [
  {
    id: 'lifesteal',
    slot: 'bracelet',
    name: t('Kan Emici Bilezik', 'Bloodsipper Bracelet'),
    desc: t(
      'Verdiğin hasarın her rütbede %1,2\u2019si canına döner.',
      'Heals you for 1.2% of damage dealt per rank.',
    ),
    icon: 'icon_trinket_lifesteal',
    effect: 'lifesteal',
    perRank: { pct: 0.012 },
    maxRank: 3,
  },
  {
    id: 'stun_chance',
    slot: 'necklace',
    name: t('Sersemletici Kolye', 'Stunning Necklace'),
    desc: t(
      'Vuruşların her rütbede %3 şansla düşmanı 0,6 sn sersemletir.',
      'Your hits have a 3% chance per rank to stun the enemy for 0.6 s.',
    ),
    icon: 'icon_trinket_stun_chance',
    effect: 'stunChance',
    perRank: { chance: 0.03, duration: 0.6 },
    maxRank: 3,
  },
  {
    id: 'poison_chance',
    slot: 'earring',
    name: t('Zehirli Küpe', 'Venomous Earring'),
    desc: t(
      'Vuruşların her rütbede %8 şansla düşmanı 3 sn zehirler.',
      'Your hits have an 8% chance per rank to poison the enemy for 3 s.',
    ),
    icon: 'icon_trinket_poison_chance',
    effect: 'poisonChance',
    perRank: { chance: 0.08, power: 0.3, duration: 3 },
    maxRank: 3,
  },
  {
    id: 'thorns',
    slot: 'bracelet',
    name: t('Dikenli Bilezik', 'Thorned Bracelet'),
    desc: t(
      'Aldığın hasarın her rütbede %25\u2019ini saldırgana yansıtır.',
      'Reflects 25% of the damage you take back at the attacker per rank.',
    ),
    icon: 'icon_trinket_thorns',
    effect: 'thorns',
    perRank: { pct: 0.25 },
    maxRank: 3,
  },
  {
    id: 'crit_burst',
    slot: 'necklace',
    name: t('Patlayıcı Kolye', 'Bursting Necklace'),
    desc: t(
      'Kritik vuruşlar 3 m çevrede hasarının %25\u2019i kadar patlama yaratır.',
      'Critical hits explode for 25% of their damage in a 3 m radius per rank.',
    ),
    icon: 'icon_trinket_crit_burst',
    effect: 'critBurst',
    perRank: { radius: 3, damage: 0.25 },
    maxRank: 3,
  },
  {
    id: 'shield',
    slot: 'earring',
    name: t('Kalkan Küpesi', 'Shield Earring'),
    desc: t(
      'Her rütbede 12 puanlık bir kalkan verir; kalkan saniyede 0,8 yenilenir.',
      'Grants a 12 point barrier per rank that regenerates 0.8 per second.',
    ),
    icon: 'icon_trinket_shield',
    effect: 'shield',
    perRank: { amount: 12, regen: 0.8 },
    maxRank: 3,
  },
];

// ---------------------------------------------------------------------------
// Empires

const empires: EmpireDef[] = [
  {
    id: 'saehwa',
    name: t('Saehwa', 'Saehwa'),
    color: '#d9363e',
    bonus: { maxHpPct: 0.1 },
    desc: t('Kızıl krallık: azami can %10 artar.', 'The crimson kingdom: max HP +10%.'),
  },
  {
    id: 'chowon',
    name: t('Chowon', 'Chowon'),
    color: '#e8c13a',
    bonus: { xpGain: 0.1 },
    desc: t('Sarı krallık: kazanılan XP %10 artar.', 'The golden kingdom: XP gain +10%.'),
  },
  {
    id: 'jihae',
    name: t('Jihae', 'Jihae'),
    color: '#3a6fd9',
    bonus: { yeopGain: 0.1, luck: 0.1 },
    desc: t(
      'Mavi krallık: kazanılan Yeop %10 ve şans 0,1 artar.',
      'The azure kingdom: Yeop gain +10% and luck +0.1.',
    ),
  },
];

// ---------------------------------------------------------------------------
// Story (minimal)

const story: StoryDef = {
  prologue: [
    t(
      'Gökyüzü yarıldı ve Metin taşları üç krallığın topraklarına yağmaya başladı.',
      'The sky has split, and Metin stones are raining down on the lands of the three kingdoms.',
    ),
  ],
  chapters: [
    {
      zone: FIXTURE_ZONE_ID,
      title: t('Yeonmu Ovası', 'The Yeonmu Plains'),
      text: [
        t(
          'Yağmurun ilk düştüğü ovada hayvanlar canavara dönüştü.',
          'On the plains where the rain first fell, the animals have turned into monsters.',
        ),
      ],
    },
  ],
  codex: [],
};

// ---------------------------------------------------------------------------
// Balance

const balance: BalanceConfig & { runOptions: RunOptionsConfig } = {
  runLength: 900,
  xpCurve: { base: 6, growth: 4, accel: 0.55 },
  cardsPerLevel: 3,
  rerollsPerRun: 3,
  banishesPerRun: 2,
  skipsPerRun: 2,
  maxActiveSkills: 6,
  maxPassives: 6,
  rarityWeights: { common: 60, uncommon: 25, rare: 10, epic: 4, legendary: 1 },
  chestCost: { base: 15, perOpen: 12 },
  armorK: 100,
  caps: { cooldown: 0.5, lifesteal: 0.15, regenPctPerSec: 0.02, evasion: 0.6, critChance: 0.8 },
  enemyHpPerMin: 0.16,
  enemyDamagePerMin: 0.09,
  hard: { hp: 1.6, damage: 1.4, count: 1.25, reward: 1.5 },
  runOptions: {
    density: { min: 1, max: 3, step: 0.25, rewardWeight: 0.25 },
    health: { min: 1, max: 3, step: 0.25, rewardWeight: 0.2 },
    damage: { min: 1, max: 3, step: 0.25, rewardWeight: 0.3 },
    speed: { min: 1, max: 3, step: 0.25, rewardWeight: 0.2 },
    rewardMax: 2,
  },
  talentXp: { perMinute: 20, perKill: 0.05, perElite: 2, perBoss: 40, perMetin: 12, victory: 300 },
  blacksmith: {
    successRate: [100, 100, 100, 90, 80, 70, 60, 50, 40, 30],
    yeopCost: [500, 1000, 2000, 4000, 7000, 11000, 16000, 24000, 35000, 50000],
    shardCost: [1, 1, 2, 3, 4, 6, 8, 10, 13, 16],
  },
};

// ---------------------------------------------------------------------------
// Exports

export const fixtureContent: ContentDB = {
  classes: [warrior],
  skills: fixtureSkills,
  passives,
  stones,
  trinkets,
  enemies: fixtureEnemies,
  bosses: fixtureBosses,
  metins: fixtureMetins,
  zones: [fixtureZone],
  gear: [],
  talents: [],
  empires,
  story,
  balance,
};

/** Deep copy of fixtureContent so tests can mutate freely. */
export function cloneContent(): ContentDB {
  return structuredClone(fixtureContent);
}

/** Default run config against the fixture zone; override any field per test. */
export function fixtureConfig(over?: Partial<RunConfig>): RunConfig {
  return {
    zone: FIXTURE_ZONE_ID,
    difficulty: 'normal',
    classId: 'warrior',
    doctrine: 'a',
    sex: 'm',
    empire: 'saehwa',
    seed: 1234,
    meta: { stats: {} },
    ...over,
  };
}
