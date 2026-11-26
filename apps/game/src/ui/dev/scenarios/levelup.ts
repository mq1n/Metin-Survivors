// Gallery scenarios: level-up card choice (owner: B6 levelup): three cards, four with a legendary, an all-upgrade set of
// rare cards and a mixed passive / treasure set. States (banish armed, hover, picked) are driven by the QA shot scripts
// through the buttons of the modal ([.ms-lu-act]).
import type { ClassId, ContentDB, DoctrineKey } from '../../../data/schema';
import type { Card } from '../../../sim/types';
import { classOf, mockRequest } from '../mock';
import { inRun, type Scenario } from '../scenarioKit';

export const order = 90;

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

function skillsOf(content: ContentDB, classId: ClassId, doctrine: DoctrineKey): string[] {
  const c = classOf(content, classId);
  const d = c.doctrines.find((x) => x.id === doctrine) ?? c.doctrines[0];
  return d ? d.skills : [];
}


function rareCards(content: ContentDB, classId: ClassId, doctrine: DoctrineKey): Card[] {
  const sk = skillsOf(content, classId, doctrine);
  const a = sk[0] ?? '';
  const b = sk[1] ?? a;
  const c = sk[2] ?? a;
  return [
    blank({ kind: 'skillUp', id: a, rarity: 'rare', rank: 4, lines: [{ stat: 'area', mode: 'pct', value: 0.25 }] }),
    blank({ kind: 'skillUp', id: b, rarity: 'uncommon', rank: 5, lines: [{ stat: 'damage', mode: 'pct', value: 0.12 }] }),
    blank({ kind: 'skillUp', id: c, rarity: 'rare', rank: 6, lines: [{ stat: 'cooldown', mode: 'pct', value: 0.11 }, { stat: 'critChance', mode: 'pct', value: 0.04 }] }),
  ];
}

/** New passive + passive upgrade + a treasure purse: no skill art, tag medals, description-only body. */
function mixedCards(content: ContentDB): Card[] {
  const p0 = content.passives[0]?.id ?? '';
  const p1 = content.passives[1]?.id ?? p0;
  return [
    blank({ kind: 'newPassive', id: p0, rarity: 'uncommon', rank: 1, maxRank: 5 }),
    blank({ kind: 'passiveUp', id: p1, rarity: 'epic', rank: 4, maxRank: 5, lines: [{ stat: 'maxHpPct', mode: 'pct', value: 0.136 }, { stat: 'xpGain', mode: 'pct', value: 0.08 }] }),
    blank({ kind: 'yeop', rarity: 'common', amount: 420 }),
  ];
}

export const scenarios: Scenario[] = [
  {
    id: 'levelUp',
    label: 'Level-up (3 cards)',
    run: (g) => {
      inRun(g);
      g.store.setSimModal(mockRequest('levelUp', g.content, { classId: g.classId, doctrine: g.doctrine }));
    },
  },
  {
    id: 'levelUp4',
    label: 'Level-up (4, legendary)',
    run: (g) => {
      inRun(g);
      g.store.setSimModal(mockRequest('levelUp', g.content, { classId: g.classId, doctrine: g.doctrine, variant: 1 }));
    },
  },
  {
    id: 'levelUpRare',
    label: 'Level-up (rare upgrades)',
    run: (g) => {
      inRun(g);
      g.store.setSimModal(mockRequest('levelUp', g.content, { classId: g.classId, doctrine: g.doctrine, cards: rareCards(g.content, g.classId, g.doctrine), level: 19, rerolls: 2, banishes: 1, skips: 1 }));
    },
  },
  {
    id: 'levelUpMixed',
    label: 'Level-up (passives + treasure)',
    run: (g) => {
      inRun(g);
      g.store.setSimModal(mockRequest('levelUp', g.content, { classId: g.classId, doctrine: g.doctrine, cards: mixedCards(g.content), level: 7, rerolls: 0, banishes: 0, skips: 2, canReroll: false, canBanish: false }));
    },
  },
];
