// Content fixtures for the meta tests/dev (typed by data/schema.ts). Shaped like the real content: 5 classes with two
// doctrine trees (5 rows × 3 nodes), 4 zones in a chain, per-zone gear tiers over the 8 slots, 3 empires, a codex.
// Generated programmatically so the shape stays valid when schema.ts evolves (compile errors point here).

import type {
  BiomePreset,
  BalanceConfig,
  ClassDef,
  ClassId,
  EmpireDef,
  GearDef,
  GearSlot,
  L10n,
  StatMods,
  StoryDef,
  TalentNode,
  TalentTree,
  ZoneDef,
} from '../../data/schema';
import { GEAR_SLOTS } from '../../data/schema';
import type { MetaContent } from '../types';

const L = (en: string): L10n => ({ tr: `${en} (tr)`, en });

export const FIXTURE_CLASSES: readonly ClassId[] = ['warrior', 'ninja', 'yacha', 'shaman', 'wolfman'];

function mkClass(id: ClassId): ClassDef {
  return {
    id,
    name: L(id),
    desc: L(`${id} desc`),
    sexes: ['m', 'f'],
    doctrines: [
      { id: 'a', name: L(`${id} A`), desc: L('a'), basic: `${id}_basic_a`, starter: `${id}_start_a`, skills: [`${id}_a1`, `${id}_a2`] },
      { id: 'b', name: L(`${id} B`), desc: L('b'), basic: `${id}_basic_b`, starter: `${id}_start_b`, skills: [`${id}_b1`, `${id}_b2`] },
    ],
    base: { maxHp: 100, armor: 5, moveSpeed: 5 },
    models: { m: [`${id}_m_t0`], f: [`${id}_f_t0`] },
    weapons: [`${id}_w0`],
    portrait: { m: `portrait_${id}_m`, f: `portrait_${id}_f` },
  };
}

const biome = (id: string, seed: number): BiomePreset => ({
  id,
  seed,
  ground: ['tex_grass_a'],
  trees: ['tree_oak'],
  props: ['prop_rock'],
  fog: { color: '#aabbcc', near: 20, far: 120 },
  sky: { top: '#6699ff', horizon: '#ccddff', bottom: '#eeffff' },
  sun: { color: '#fff4d0', intensity: 2, dir: [0.4, -1, 0.3] },
  ambient: { sky: '#88aaff', ground: '#554433', intensity: 0.6 },
  relief: { height: 6, roughness: 0.5, features: [] },
});

export const FIXTURE_ZONE_IDS = ['yeonmu', 'suryeon', 'seori', 'daeryeol'] as const;

function mkZone(id: string, order: number, gearTier: number, finalBoss: string): ZoneDef {
  const zone: ZoneDef = {
    id,
    order,
    name: L(id),
    subtitle: L(`${id} sub`),
    levelRange: [order * 10, order * 10 + 15],
    story: { intro: [L('intro')], victory: [L('victory')], defeat: [L('defeat')] },
    biome: biome(`${id}_biome`, order),
    music: { calm: 'mus_calm', combat: 'mus_combat', boss: 'mus_boss' },
    bands: [],
    bosses: [
      { at: 180, boss: `${id}_boss1` },
      { at: 360, boss: `${id}_boss2` },
    ],
    final: { at: 900, boss: finalBoss, greatMetin: `${id}_great_metin` },
    metins: { types: [`${id}_metin`], firstAt: 60, interval: [60, 75] },
    gearTier,
    art: `art_${id}`,
  };
  const prev = order > 1 ? FIXTURE_ZONE_IDS[order - 2] : undefined;
  if (prev) zone.unlock = { zone: prev };
  return zone;
}

const ZONES: ZoneDef[] = FIXTURE_ZONE_IDS.map((id, i) => mkZone(id, i + 1, i + 1, `${id}_final`));

// --- gear: weapon/armor/helmet/shield per class; shoes/bracelet/necklace/earrings shared by all classes ------------

const SLOT_STATS: Record<GearSlot, { stats: StatMods; perPlus: StatMods }> = {
  weapon: { stats: { damage: 0.08 }, perPlus: { damage: 0.02 } },
  armor: { stats: { armor: 6, maxHp: 20 }, perPlus: { armor: 1.5, maxHp: 6 } },
  helmet: { stats: { maxHpPct: 0.04 }, perPlus: { maxHpPct: 0.01 } },
  shield: { stats: { armor: 4, evasion: 0.02 }, perPlus: { armor: 1, evasion: 0.004 } },
  shoes: { stats: { moveSpeed: 0.03 }, perPlus: { moveSpeed: 0.006 } },
  bracelet: { stats: { critChance: 0.03 }, perPlus: { critChance: 0.006 } },
  necklace: { stats: { xpGain: 0.05, vsRace: { animal: 0.05 } }, perPlus: { xpGain: 0.01, vsRace: { animal: 0.01 } } },
  earrings: { stats: { luck: 0.05, yeopGain: 0.05 }, perPlus: { luck: 0.01, yeopGain: 0.01 } },
};
const CLASS_SLOTS: readonly GearSlot[] = ['weapon', 'armor', 'helmet', 'shield'];
/** boss1: weapon+armor, boss2: helmet+shield, final: shoes, zone (no boss): jewelry */
const SLOT_SOURCE: Record<GearSlot, 'boss1' | 'boss2' | 'final' | 'zone'> = {
  weapon: 'boss1',
  armor: 'boss1',
  helmet: 'boss2',
  shield: 'boss2',
  shoes: 'final',
  bracelet: 'zone',
  necklace: 'zone',
  earrings: 'zone',
};

function mkGear(): GearDef[] {
  const out: GearDef[] = [];
  for (const zone of ZONES) {
    for (const slot of GEAR_SLOTS) {
      const perClass = CLASS_SLOTS.includes(slot);
      const targets: { suffix: string; classes: ClassId[] }[] = perClass
        ? FIXTURE_CLASSES.map((c) => ({ suffix: `_${c}`, classes: [c] }))
        : [{ suffix: '', classes: [...FIXTURE_CLASSES] }];
      for (const t of targets) {
        const src = SLOT_SOURCE[slot];
        const boss = src === 'zone' ? undefined : src === 'final' ? zone.final.boss : `${zone.id}_${src}`;
        out.push({
          id: `${zone.id}_${slot}${t.suffix}`,
          slot,
          classes: t.classes,
          tier: zone.gearTier,
          name: L(`${zone.id} ${slot}${t.suffix}`),
          icon: `icon_${slot}`,
          stats: SLOT_STATS[slot].stats,
          perPlus: SLOT_STATS[slot].perPlus,
          source: { zone: zone.id, ...(boss ? { boss } : {}), chance: src === 'zone' ? 0.2 : src === 'final' ? 0.5 : 0.3 },
          ...(slot === 'weapon' || slot === 'armor' ? { model: `${zone.id}_${slot}_model` } : {}),
        });
      }
    }
  }
  return out;
}

// --- talents ------------------------------------------------------------------------------------------------------

function mkNode(tree: string, row: number, col: number, classId: ClassId): TalentNode {
  const id = `r${row}c${col}`;
  const node: TalentNode = {
    id,
    row,
    col,
    max: 3,
    name: L(`${tree} ${id}`),
    desc: L('desc'),
    icon: `icon_talent_${row}_${col}`,
    perPoint: col === 0 ? { damage: 0.01 } : col === 1 ? { maxHp: 5, armor: 0.5 } : { critChance: 0.005, vsRace: { orc: 0.01 } },
  };
  if (row > 0 && col === 1) node.requires = `r${row - 1}c1`;
  if (row === 2 && col === 2) node.effect = { kind: 'startLevel', params: { value: 1 } };
  if (row === 3 && col === 2) node.effect = { kind: `skillMod:${classId}_a1`, params: { damage: 0.05, area: 0.02, bogus: 1 } };
  if (row === 4 && col === 2) node.effect = { kind: 'rerolls', params: { value: 1 } };
  if (row === 4 && col === 0) node.effect = { kind: 'banishes', params: { value: 1 } };
  if (row === 1 && col === 2) node.effect = { kind: 'weirdUnknownKind', params: { x: 1 } };
  return node;
}

function mkTree(classId: ClassId, key: 'a' | 'b'): TalentTree {
  const id = `${classId}_${key}` as const;
  const nodes: TalentNode[] = [];
  for (let row = 0; row < 5; row++) for (let col = 0; col < 3; col++) nodes.push(mkNode(id, row, col, classId));
  return {
    id,
    classId,
    name: L(id),
    nodes,
    milestones: [
      { at: 10, skill: `${id}_ult10` },
      { at: 20, effect: L('twenty') },
      { at: 30, skill: `${id}_ult30`, effect: L('thirty') },
    ],
  };
}

// --- balance / empires / story --------------------------------------------------------------------------------------

export const FIXTURE_BALANCE: BalanceConfig = {
  runLength: 900,
  xpCurve: { base: 10, growth: 6, accel: 0.4 },
  cardsPerLevel: 3,
  rerollsPerRun: 3,
  banishesPerRun: 3,
  skipsPerRun: 2,
  maxActiveSkills: 6,
  maxPassives: 6,
  rarityWeights: { common: 60, uncommon: 25, rare: 10, epic: 4, legendary: 1 },
  chestCost: { base: 15, perOpen: 12 },
  armorK: 100,
  caps: { cooldown: 0.6, lifesteal: 0.3, regenPctPerSec: 0.05, evasion: 0.6, critChance: 1 },
  enemyHpPerMin: 0.1,
  enemyDamagePerMin: 0.09,
  hard: { hp: 1.6, damage: 1.4, count: 1.25, reward: 1.5 },
  talentXp: { perMinute: 40, perKill: 0.6, perElite: 8, perBoss: 120, perMetin: 60, victory: 600 },
  blacksmith: {
    successRate: [1, 0.9, 0.8, 0.7, 0.55, 0.4, 0.3, 0.2, 0.12],
    yeopCost: [500, 1000, 2000, 3500, 5500, 8000, 12000, 18000, 26000],
    shardCost: [1, 2, 3, 5, 8, 12, 18, 26, 40],
  },
};

const EMPIRES: EmpireDef[] = [
  { id: 'saehwa', name: L('Saehwa'), color: '#cc2222', bonus: { maxHpPct: 0.1 }, desc: L('hp') },
  { id: 'chowon', name: L('Chowon'), color: '#ddbb22', bonus: { xpGain: 0.1 }, desc: L('xp') },
  { id: 'jihae', name: L('Jihae'), color: '#2255cc', bonus: { yeopGain: 0.1, luck: 0.1 }, desc: L('yeop') },
];

const STORY: StoryDef = {
  prologue: [L('prologue')],
  chapters: ZONES.map((z) => ({ zone: z.id, title: L(z.id), text: [L('chapter')] })),
  codex: [
    { id: 'codex_start', title: L('start'), text: L('always'), unlock: '' },
    { id: 'codex_enter_yeonmu', title: L('enter'), text: L('enter'), unlock: 'enter:yeonmu' },
    { id: 'codex_clear_yeonmu', title: L('clear'), text: L('clear'), unlock: 'clear:yeonmu' },
    { id: 'codex_hard_yeonmu', title: L('hard'), text: L('hard'), unlock: 'hard:yeonmu' },
    { id: 'codex_boss', title: L('boss'), text: L('boss'), unlock: 'boss:yeonmu_boss1' },
    { id: 'codex_metin', title: L('metin'), text: L('metin'), unlock: 'metin:yeonmu_metin' },
    { id: 'codex_class_ninja', title: L('ninja'), text: L('ninja'), unlock: 'class:ninja' },
    { id: 'codex_wins3', title: L('wins'), text: L('wins'), unlock: 'wins:3' },
    { id: 'codex_garbage', title: L('garbage'), text: L('garbage'), unlock: 'frobnicate:7' },
  ],
};

export const fixtureContent: MetaContent = {
  classes: FIXTURE_CLASSES.map(mkClass),
  zones: ZONES,
  gear: mkGear(),
  talents: FIXTURE_CLASSES.flatMap((c) => [mkTree(c, 'a'), mkTree(c, 'b')]),
  empires: EMPIRES,
  story: STORY,
  balance: FIXTURE_BALANCE,
};
