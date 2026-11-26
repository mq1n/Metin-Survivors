// Gallery scenarios: Metin essence, treasure chest and boss reward modals (owner: B7 essence-chest), plus their request
// builders: essence / chest / boss-reward requests with realistic slot states (moved from the old dev/mockRun.ts in C0).
import type { ClassId, ContentDB, DoctrineKey } from '../../../data/schema';
import type { Card, HudSnapshot, ModalRequest } from '../../../sim/types';
import { mockHud, mockLevelUpCards, mockRequest } from '../mock';
import { inRun, type Scenario } from '../scenarioKit';

export const order = 100;

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

/** HUD with a partly filled build: 1 free weapon slot, a weak armor stone, two trinkets. */
export function essenceHud(content: ContentDB, t = 372, classId: ClassId = 'warrior', doctrine: DoctrineKey = 'a'): HudSnapshot {
  const hud = mockHud(content, t, { classId, doctrine });
  const w = content.stones.filter((s) => s.slot === 'weapon');
  const a = content.stones.filter((s) => s.slot === 'armor');
  const st = (def: { id: string; icon: string } | undefined, level: number): { id: string; icon: string; level: number } | null => (def ? { id: def.id, icon: def.icon, level } : null);
  hud.stones = [st(w[0], 3), st(w[1], 1), null, st(a[0], 1), st(a[1], 2), st(a[2], 0)];
  const tr = content.trinkets;
  const braceletT = tr.find((x) => x.slot === 'bracelet');
  const necklaceT = tr.find((x) => x.slot === 'necklace');
  hud.trinkets = [braceletT ? { id: braceletT.id, icon: braceletT.icon, rank: 2 } : null, necklaceT ? { id: necklaceT.id, icon: necklaceT.icon, rank: 1 } : null, null];
  return hud;
}

/**
 * Essence cards matching `essenceHud`. `mixed` is the everyday offer (nothing replaced: a stone for the free weapon slot, an
 * upgrade of an owned stone, a trinket for the free earring slot); `full` replaces a weak armor stone and a bracelet;
 * `upgrade` upgrades owned items. Ranks / lines follow the sim (`stone rank = rarity step`, `lines = perLevel × (rank + 1)`).
 */
export function mockEssenceRun(content: ContentDB, over: { awakened?: boolean; metin?: string; variant?: 'full' | 'upgrade' | 'mixed' } = {}): ModalRequest {
  const w = content.stones.filter((s) => s.slot === 'weapon');
  const a = content.stones.filter((s) => s.slot === 'armor');
  const bracelets = content.trinkets.filter((x) => x.slot === 'bracelet');
  const earrings = content.trinkets.filter((x) => x.slot === 'earring');
  const lines = (stat: string, v: number): Card['lines'] => [{ stat, mode: 'pct', value: v }];
  let cards: Card[];
  if (over.variant === 'mixed') {
    const aw = over.awakened === true;
    cards = [
      blank({ kind: 'stone', id: w[2]?.id ?? '', rarity: aw ? 'legendary' : 'epic', rank: aw ? 4 : 3, maxRank: 4, slot: 2, lines: lines('attackSpeed', aw ? 0.2 : 0.16) }),
      blank({ kind: 'stoneUp', id: w[1]?.id ?? '', rarity: aw ? 'epic' : 'rare', rank: aw ? 3 : 2, maxRank: 4, slot: 1, lines: [{ stat: 'critChance', mode: 'pct', value: aw ? 0.08 : 0.06 }, { stat: 'critDamage', mode: 'pct', value: aw ? 0.2 : 0.15 }] }),
      blank({ kind: 'trinket', id: earrings[2]?.id ?? earrings[0]?.id ?? '', rarity: 'legendary', rank: 4, maxRank: 5, slot: 2 }),
    ];
  } else if (over.variant === 'upgrade') {
    cards = [
      blank({ kind: 'stoneUp', id: w[0]?.id ?? '', rarity: 'rare', rank: 4, maxRank: 4, slot: 0, lines: lines('damage', 0.12) }),
      blank({ kind: 'trinketUp', id: bracelets[0]?.id ?? '', rarity: 'epic', rank: 4, maxRank: 5, slot: 0 }),
      blank({ kind: 'stone', id: w[2]?.id ?? '', rarity: 'uncommon', rank: 1, maxRank: 4, slot: 2, lines: lines('critChance', 0.05) }),
    ];
  } else {
    cards = [
      blank({ kind: 'stone', id: w[2]?.id ?? '', rarity: over.awakened ? 'epic' : 'rare', rank: 2, maxRank: 4, slot: 2, lines: [{ stat: 'critChance', mode: 'pct', value: 0.06 }, { stat: 'attackSpeed', mode: 'pct', value: 0.04 }] }),
      blank({ kind: 'stone', id: a[3]?.id ?? a[0]?.id ?? '', rarity: 'uncommon', rank: 1, maxRank: 4, slot: 5, lines: lines('maxHpPct', 0.08), replaces: { kind: 'stone', id: a[2]?.id ?? '', level: 0, slot: 5 } }),
      blank({ kind: 'trinket', id: bracelets[1]?.id ?? bracelets[0]?.id ?? '', rarity: over.awakened ? 'legendary' : 'epic', rank: 2, maxRank: 5, slot: 0, replaces: { kind: 'trinket', id: bracelets[0]?.id ?? '', level: 2, slot: 0 } }),
    ];
    if (over.awakened) cards[2] = blank({ kind: 'trinket', id: earrings[0]?.id ?? '', rarity: 'legendary', rank: 3, maxRank: 5, slot: 2 });
  }
  return mockRequest('essence', content, {
    cards,
    awakened: over.awakened ?? false,
    ...(over.metin ? { source: over.metin } : {}),
    // the sim lets an essence reroll and skip, never banish; the player still holds a banish charge, so the shelf shows it sealed
    // (sim/cards.ts syncBudgets: `rerolls` / `banishes` / `skips` are the player's budgets, `can*` what this offer grants)
    rerolls: 2,
    banishes: 1,
    skips: 1,
    canBanish: false,
  });
}

export function mockChestRequest(content: ContentDB, free: boolean): ModalRequest {
  const cards = mockLevelUpCards(content, 'warrior', 'a', 1).slice(0, 3);
  // a chest is a plain pick-one: the sim hands it no reroll / banish / skip (sim/cards.ts syncBudgets) although the player holds
  // charges (3 / 1 / 2 here), so the shelf shows all three plates sealed with their real counts
  return mockRequest('chest', content, { cards, free, rerolls: 3, banishes: 1, skips: 2, canReroll: false, canBanish: false, canSkip: false });
}

export function mockBossRequest(content: ContentDB, boss?: string): ModalRequest {
  const cards = mockLevelUpCards(content, 'warrior', 'a', 1).slice(0, 3);
  return mockRequest('bossReward', content, { cards, ...(boss ? { source: boss } : {}), rerolls: 3, banishes: 1, skips: 2, canReroll: false, canBanish: false, canSkip: false });
}

export const scenarios: Scenario[] = [
  {
    id: 'essence',
    label: 'Metin essence',
    run: (g) => {
      inRun(g, { t: 372 });
      g.store.setHud(essenceHud(g.content));
      g.store.setSimModal(mockEssenceRun(g.content, { variant: 'mixed', metin: g.content.metins[0]?.id ?? '' }));
    },
  },
  {
    id: 'essence-awakened',
    label: 'Metin essence (awakened)',
    run: (g) => {
      inRun(g, { t: 372 });
      g.store.setHud(essenceHud(g.content));
      g.store.setSimModal(mockEssenceRun(g.content, { variant: 'mixed', awakened: true, metin: g.content.metins[0]?.id ?? '' }));
    },
  },
  {
    id: 'chest',
    label: 'Chest',
    run: (g) => {
      inRun(g);
      g.store.setSimModal(mockChestRequest(g.content, false));
    },
  },
  {
    id: 'bossReward',
    label: 'Boss reward',
    run: (g) => {
      inRun(g, { t: 372 });
      g.store.setSimModal(mockBossRequest(g.content));
    },
  },
  {
    id: 'essence-replace',
    label: 'Essence · replace / free slots',
    run: (g) => {
      inRun(g, { t: 372 });
      g.store.setHud(essenceHud(g.content));
      g.store.setSimModal(mockEssenceRun(g.content, { metin: g.content.metins[1]?.id ?? '' }));
    },
  },
  {
    id: 'essence-upgrade',
    label: 'Essence · upgrades',
    run: (g) => {
      inRun(g, { t: 372 });
      g.store.setHud(essenceHud(g.content));
      g.store.setSimModal(mockEssenceRun(g.content, { metin: g.content.metins[3]?.id ?? '', variant: 'upgrade' }));
    },
  },
  {
    id: 'essence-awakened-metin',
    label: 'Essence · awakened Metin',
    run: (g) => {
      inRun(g, { t: 372 });
      g.store.setHud(essenceHud(g.content));
      g.store.setSimModal(mockEssenceRun(g.content, { metin: g.content.metins[4]?.id ?? '', awakened: true }));
    },
  },
  {
    id: 'chest-opening',
    label: 'Chest · opening (paid)',
    run: (g) => {
      inRun(g, { t: 372 });
      g.store.setHud(essenceHud(g.content));
      g.store.setSimModal(mockChestRequest(g.content, false));
      window.setTimeout(() => g.events.emit({ t: 'chestOpen', player: 0, x: 0, z: 0, boss: false, cost: 39 }), 120);
    },
  },
  {
    id: 'chest-boss',
    label: 'Chest · boss (free)',
    run: (g) => {
      inRun(g, { t: 372 });
      g.store.setSimModal(mockChestRequest(g.content, true));
    },
  },
  {
    id: 'boss-spoils',
    label: 'Boss spoils · legendary flip',
    run: (g) => {
      inRun(g, { t: 372 });
      g.store.setSimModal(mockBossRequest(g.content, g.content.bosses[4]?.id ?? g.content.bosses[0]?.id));
    },
  },
];
