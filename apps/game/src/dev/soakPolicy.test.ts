// The soak's card picker (soakCore.makeCardPolicy): a sensible player's wishes first (awakening, pact passive, new skill), the mode among the rest.
import { describe, expect, it } from 'vitest';
import type { Card, ModalRequest } from '../sim/types';
import { cardWish, makeCardPolicy, STATS } from './soakCore';

function card(over: Partial<Card> & Pick<Card, 'kind'>): Card {
  return { id: 'x', rarity: 'common', rank: 1, maxRank: 5, awakening: false, lines: [], amount: 0, slot: -1, replaces: null, ...over };
}

function modal(cards: Card[]): ModalRequest {
  return { id: 1, kind: 'levelUp', player: 0, cards } as unknown as ModalRequest;
}

const FILLER = card({ kind: 'heal', id: '' });
const PASSIVE = card({ kind: 'passiveUp', id: 'combo' });
const PACT = card({ kind: 'newPassive', id: 'saddlecraft', pact: { awakens: ['berserk'] } });
const NEWSKILL = card({ kind: 'newSkill', id: 'bladewheel' });
const AWAKEN = card({ kind: 'skillUp', id: 'sword_arc', rank: 7, awakening: true });
const RANKUP = card({ kind: 'skillUp', id: 'sword_arc', rank: 3 });

describe('soak card policy: the wishes of a sensible player', () => {
  it('wish order: awakening > pact passive > new skill > anything else', () => {
    expect(cardWish(AWAKEN)).toBeGreaterThan(cardWish(PACT));
    expect(cardWish(PACT)).toBeGreaterThan(cardWish(NEWSKILL));
    expect(cardWish(NEWSKILL)).toBeGreaterThan(cardWish(PASSIVE));
    expect(cardWish(PASSIVE)).toBe(0);
    expect(cardWish(RANKUP)).toBe(0);
    expect(cardWish(FILLER)).toBe(0);
    // a passive card with an empty awakens list moves nothing
    expect(cardWish(card({ kind: 'newPassive', id: 'fury', pact: { awakens: [] } }))).toBe(0);
  });

  it.each(['first', 'last', 'random'] as const)('%s mode takes the wished card whatever its place', (mode) => {
    const pol = makeCardPolicy(mode, 7);
    for (let seed = 0; seed < 20; seed++) {
      expect(pol.pick(modal([FILLER, PASSIVE, AWAKEN]))).toBe(2);
      expect(pol.pick(modal([AWAKEN, PACT, NEWSKILL]))).toBe(0);
      expect(pol.pick(modal([NEWSKILL, PACT, RANKUP]))).toBe(1);
      expect(pol.pick(modal([RANKUP, FILLER, NEWSKILL]))).toBe(2);
    }
  });

  it('without a wish the mode decides: first = 0, last = the end, random = anything, and a single card is index 0', () => {
    const none = [RANKUP, PASSIVE, FILLER];
    expect(makeCardPolicy('first', 1).pick(modal(none))).toBe(0);
    expect(makeCardPolicy('last', 1).pick(modal(none))).toBe(2);
    const random = makeCardPolicy('random', 1);
    const seen = new Set<number>();
    for (let i = 0; i < 60; i++) seen.add(random.pick(modal(none)));
    expect(seen.size).toBe(3);
    expect(makeCardPolicy('last', 1).pick(modal([AWAKEN]))).toBe(0);
  });

  it('a wish draws no random number: the random policy answers the same afterwards', () => {
    const a = makeCardPolicy('random', 3);
    const b = makeCardPolicy('random', 3);
    for (let i = 0; i < 10; i++) a.pick(modal([FILLER, AWAKEN]));
    const none = [RANKUP, PASSIVE, FILLER];
    for (let i = 0; i < 10; i++) expect(a.pick(modal(none))).toBe(b.pick(modal(none)));
  });
});

describe('soak stat presets', () => {
  it('god and veteran stay equal (veteran = god + ultimates); damage 4', () => {
    expect(STATS.god).toEqual(STATS.veteran);
    expect(STATS.god.damage).toBe(4);
  });
});
