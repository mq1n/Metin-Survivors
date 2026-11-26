// Gallery-only data builders: cards / modal requests / run results / HUD snapshots derived from the real ContentDB, so
// every modal and the HUD can be rendered without a running simulation.
import type { ClassDef, ClassId, ContentDB, DoctrineKey } from '../../data/schema';
import type { SimEvent } from '../../sim/events';
import type { RunResult } from '../../sim/run';
import type { Card, HudSnapshot, ModalKind, ModalRequest } from '../../sim/types';

export function classOf(content: ContentDB, id: ClassId = 'warrior'): ClassDef {
  const c = content.classes.find((x) => x.id === id) ?? content.classes[0];
  if (!c) throw new Error('mock: content has no classes');
  return c;
}

function doctrineSkills(content: ContentDB, classId: ClassId, doctrine: DoctrineKey): string[] {
  const d = classOf(content, classId).doctrines.find((x) => x.id === doctrine) ?? classOf(content, classId).doctrines[0];
  return d ? d.skills : [];
}

const blank = (over: Partial<Card>): Card => ({
  kind: 'newSkill',
  id: '',
  rarity: 'common',
  rank: 0,
  maxRank: 7,
  awakening: false,
  lines: [],
  amount: 0,
  slot: -1,
  replaces: null,
  ...over,
});

export function mockLevelUpCards(content: ContentDB, classId: ClassId, doctrine: DoctrineKey, variant = 0): Card[] {
  const skills = doctrineSkills(content, classId, doctrine);
  const s0 = skills[0] ?? '';
  const s1 = skills[1] ?? s0;
  const s2 = skills[2] ?? s0;
  const passive = content.passives[0]?.id ?? '';
  if (variant === 1) {
    // legendary + awakening
    return [
      blank({ kind: 'skillUp', id: s0, rarity: 'legendary', rank: 7, awakening: true, lines: [{ stat: 'damage', mode: 'pct', value: 0.78 }, { stat: 'area', mode: 'pct', value: 0.26 }] }),
      blank({ kind: 'newSkill', id: s1, rarity: 'epic', rank: 0 }),
      blank({ kind: 'passiveUp', id: passive, rarity: 'rare', rank: 3, maxRank: 5, lines: [{ stat: 'maxHpPct', mode: 'pct', value: 0.136 }] }),
      blank({ kind: 'heal', rarity: 'common', amount: 0.3 }),
    ];
  }
  return [
    blank({ kind: 'newSkill', id: s1, rarity: 'epic', rank: 0 }),
    blank({ kind: 'skillUp', id: s0, rarity: 'rare', rank: 3, lines: [{ stat: 'damage', mode: 'pct', value: 0.34 }, { stat: 'cooldown', mode: 'pct', value: 0.1 }] }),
    blank({ kind: 'skillUp', id: s2, rarity: 'uncommon', rank: 2, lines: [{ stat: 'count', mode: 'flat', value: 1 }] }),
  ];
}

export function mockEssenceCards(content: ContentDB): Card[] {
  const stone = content.stones[0];
  const stone2 = content.stones[3] ?? content.stones[1];
  const trinket = content.trinkets[0];
  return [
    blank({ kind: 'stone', id: stone?.id ?? '', rarity: 'epic', rank: 2, maxRank: 4, slot: 0, lines: [{ stat: 'pierce', mode: 'flat', value: 0.8 }, { stat: 'projSpeed', mode: 'pct', value: 0.06 }] }),
    blank({ kind: 'stoneUp', id: stone2?.id ?? '', rarity: 'rare', rank: 3, maxRank: 4, slot: 1, lines: [{ stat: 'damage', mode: 'pct', value: 0.09 }] }),
    // the sim fills trinket card lines with the raw `perRank × rank` effect parameters; describeCard replaces them
    blank({ kind: 'trinket', id: trinket?.id ?? '', rarity: 'legendary', rank: 4, maxRank: 5, slot: 0, lines: [{ stat: 'pct', mode: 'pct', value: 0.024 }] }),
  ];
}

export function mockRequest(kind: ModalKind, content: ContentDB, over: Partial<ModalRequest> & { classId?: ClassId; doctrine?: DoctrineKey; variant?: number } = {}): ModalRequest {
  const { classId = 'warrior', doctrine = 'a', variant = 0, ...rest } = over;
  const cards = kind === 'levelUp' ? mockLevelUpCards(content, classId, doctrine, variant) : kind === 'runEnd' ? [] : mockEssenceCards(content);
  const boss = content.bosses[0]?.id ?? '';
  const metin = content.metins[0]?.id ?? '';
  return {
    id: 1,
    kind,
    player: 0,
    cards,
    canReroll: true,
    canBanish: true,
    canSkip: true,
    rerolls: 3,
    banishes: 1,
    skips: 2,
    level: 12,
    source: kind === 'bossReward' ? boss : kind === 'essence' ? metin : '',
    free: kind !== 'chest',
    awakened: false,
    waited: 0,
    result: null,
    ...rest,
  };
}

export function mockRunResult(content: ContentDB, over: Partial<RunResult> = {}): RunResult {
  const cls = classOf(content, over.classId ?? 'warrior');
  const skills = doctrineSkills(content, cls.id, over.doctrine ?? 'a').slice(0, 6);
  const zone = content.zones[0];
  const dmg = [4_820_000, 2_310_000, 1_450_000, 980_000, 410_000, 120_000];
  return {
    victory: true,
    time: 918,
    kills: 5214,
    elitesKilled: 47,
    level: 41,
    yeop: 38250,
    yeopLeft: 21440,
    shards: 14,
    metinsBroken: 9,
    metinTypesBroken: content.metins.slice(0, 3).map((m) => m.id),
    metinsAwakened: 2,
    bossesKilled: (zone?.bosses ?? []).map((b) => b.boss),
    chestsOpened: 7,
    maxCorruption: 0.74,
    damageTaken: 18420,
    damageDealt: dmg.reduce((a, b) => a + b, 0),
    damageBySkill: skills.map((skillId, i) => ({ skillId, rank: 7 - i, damage: dmg[i] ?? 90_000 })),
    zone: zone?.id ?? 'yeonmu',
    difficulty: 'normal',
    classId: cls.id,
    doctrine: 'a',
    seed: 424242,
    talentXp: 1840,
    rewardMul: 1,
    runOptions: { density: 1, health: 1, damage: 1, speed: 1 },
    players: [{ index: 0, level: 41, kills: 5214, yeop: 38250, alive: true }],
    ...over,
  };
}

/** HUD snapshot for run-time `t` seconds. */
export function mockHud(content: ContentDB, t: number, opts: { classId?: ClassId; doctrine?: DoctrineKey; boss?: boolean; hpFrac?: number } = {}): HudSnapshot {
  const { classId = 'warrior', doctrine = 'a', boss = false, hpFrac } = opts;
  const skills = doctrineSkills(content, classId, doctrine).slice(0, 5);
  const hpMax = 420;
  const wave = 0.5 + 0.5 * Math.sin(t * 0.7);
  const hp = Math.round(hpMax * (hpFrac ?? 0.55 + 0.4 * wave));
  const bossDef = content.bosses[0];
  const dmgBase = [48_000, 31_000, 19_500, 11_200, 6_800];
  const dmg = skills.map((skillId, i) => ({ skillId, rank: Math.max(0, 6 - i), damage: Math.round((dmgBase[i] ?? 3000) * (t / 60 + 1)) }));
  return {
    time: t,
    player: 0,
    hp,
    hpMax,
    shield: 40,
    level: 17,
    xp: Math.round(180 + 140 * wave),
    xpNext: 420,
    yeop: 1840 + Math.floor(t * 3),
    shards: 3,
    kills: 612 + Math.floor(t * 2.3),
    corruption: 0.42,
    alive: true,
    skills: skills.map((id, i) => {
      const def = content.skills.find((s) => s.id === id);
      const cooldown = i === 0 ? 0 : ((t * (0.3 + i * 0.11)) % 1) > 0.5 ? 1 - (((t * (0.3 + i * 0.11)) % 1) - 0.5) * 2 : 0;
      return { id, icon: def?.icon ?? '', rank: Math.max(0, 6 - i), cooldown, cdLeft: Math.round(cooldown * 65) / 10, basic: i === 0, awakened: i === 1 };
    }),
    passives: content.passives.slice(0, 4).map((p, i) => ({ id: p.id, icon: p.icon, rank: 3 - (i % 3) + 1, maxRank: p.maxRank })),
    stones: [content.stones[0], content.stones[3], null, content.stones[5], null, null].map((s, i) => (s ? { id: s.id, icon: s.icon, level: 1 + (i % 3) } : null)),
    trinkets: [content.trinkets[0], content.trinkets[2], null].map((s) => (s ? { id: s.id, icon: s.icon, rank: 2 } : null)),
    rerolls: 2,
    banishes: 1,
    skips: 1,
    nextBoss: bossDef ? { at: 360, in: Math.max(0, 360 - t), id: bossDef.id } : null,
    boss: boss && bossDef ? { id: bossDef.id, hp: 0.62 * 52000, hpMax: 52000, phase: 1, enraged: false, final: false, x: 18, z: -12 } : null,
    metins: [
      { id: 1, x: 24, z: 6, awakened: false, hpFrac: 0.8, rune: '#5dff9a' },
      { id: 2, x: -30, z: -18, awakened: true, hpFrac: 0.4, rune: '#ff9a2e' },
    ],
    darkness: 0,
    px: 0,
    pz: 0,
    dmg,
    dps: Math.round(9800 + 1600 * wave),
  };
}

/** Cheap SimEvent builder for the announcement demo (only the fields the UI reads). */
export function mockEvent(e: Record<string, unknown>): SimEvent {
  return e as unknown as SimEvent;
}
