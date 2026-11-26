// A0-CARD contract: the new optional card fields (pact / needs / bargain) and card kinds (shards / boon / bargain) travel host -> guest
// inside the modal message unchanged, a pick of a not-yet-implemented kind (the bargain) is a harmless no-op on both sides, the card model
// draws such a card plain, and the HUD snapshots of host and guest keep today's shape while the optional run-event fields stay absent.
// OF-03: the shards and Boon cards are implemented now: a guest's pick of one lands on the guest hero on the host.
import { afterEach, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { content } from '../../data/loader';
import { setDeps } from '../../ui/env';
import { describeCard } from '../../ui/cardModel';
import { spawnBoss } from '../../sim/bosses';
import { openChest, openEssence, openLevelUp } from '../../sim/cards';
import { boonCount } from '../../sim/stats';
import type { Card, HudSnapshot, ModalKind, ModalRequest } from '../../sim/types';
import { CoopHarness } from './harness';

let h: CoopHarness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

function run(n: number): void {
  for (let i = 0; i < n; i++) (h as CoopHarness).tick();
}

async function create(opts: Parameters<typeof CoopHarness.create>[0] = {}): Promise<CoopHarness> {
  h = await CoopHarness.create({ guests: 1, latencyMs: 30, enemies: 0, tough: true, ...opts });
  return h;
}

const card = (over: Partial<Card>): Card => ({ kind: 'newPassive', id: '', rarity: 'rare', rank: 1, maxRank: 5, awakening: false, lines: [], amount: 0, slot: -1, replaces: null, ...over });

/** one card per new field / kind, plus a plain card that carries none of them */
function crafted(): Card[] {
  return [
    // a passive card with a pact line: the owned skills it awakens
    card({ kind: 'passiveUp', id: 'sovereign_wrath', rank: 2, lines: [{ stat: 'damage', mode: 'pct', value: 0.12 }], pact: { awakens: ['lightning_trio', 'bladewheel'] } }),
    // a G2 skill card that waits for its pact passive
    card({ kind: 'skillUp', id: 'lightning_trio', rank: 5, maxRank: 7, slot: 0, needs: 'sovereign_wrath' }),
    // the Bargain: both halves are i18n keys, party binds every hero
    card({ kind: 'bargain', id: 'bargain_blood', rarity: 'epic', bargain: { boon: 'up.bargain.boon.damage', curse: 'up.bargain.curse.hp', party: true } }),
    card({ kind: 'bargain', id: 'bargain_gold', rarity: 'legendary', bargain: { boon: 'up.bargain.boon.yeop', curse: 'up.bargain.curse.speed' } }),
    // overflow rewards
    card({ kind: 'shards', id: '', rarity: 'epic', amount: 4 }),
    card({ kind: 'boon', id: 'dragon_boon', rarity: 'legendary', lines: [{ stat: 'maxHpPct', mode: 'pct', value: 0.02 }] }),
    // today's card: none of the optional fields
    card({ kind: 'yeop', rarity: 'common', amount: 120 }),
  ];
}

/** what the wire does to a card: JSON (the relay and the real transport both serialise events as JSON text) */
const viaJson = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function open(t: CoopHarness, kind: ModalKind): ModalRequest {
  const hw = t.hostWorld;
  const p = hw.players[1]!;
  const m = kind === 'levelUp' ? openLevelUp(hw, p, 2) : kind === 'essence' ? openEssence(hw, p, 'metin_lament', false) : openChest(hw, p, kind === 'bossReward' ? 'boss_horyeong' : null);
  expect(m.kind).toBe(kind);
  // the host announces on its next step: swap the offer before that
  m.cards = crafted();
  return m;
}

describe('modal cards carry the new optional fields to the guest', () => {
  it.each(['levelUp', 'essence', 'chest', 'bossReward'] as const)('a %s modal keeps pact / needs / bargain and the new kinds intact', async (kind) => {
    const t = await create();
    run(60);
    const sent = open(t, kind);
    run(30);
    const got = t.guestWorlds[0]?.modal;
    expect(got?.kind).toBe(kind);
    expect(got?.id).toBe(sent.id);
    // field for field, as the wire serialises it
    expect(got?.cards).toEqual(viaJson(sent.cards));
    expect(got?.cards).toHaveLength(7);
    const [pact, needs, bargainParty, bargainSolo, shards, boon, plain] = got!.cards as [Card, Card, Card, Card, Card, Card, Card];
    expect(pact.pact).toEqual({ awakens: ['lightning_trio', 'bladewheel'] });
    expect(needs.needs).toBe('sovereign_wrath');
    expect(bargainParty.kind).toBe('bargain');
    expect(bargainParty.bargain).toEqual({ boon: 'up.bargain.boon.damage', curse: 'up.bargain.curse.hp', party: true });
    expect(bargainSolo.bargain).toEqual({ boon: 'up.bargain.boon.yeop', curse: 'up.bargain.curse.speed' });
    expect(bargainSolo.bargain && 'party' in bargainSolo.bargain).toBe(false);
    expect(shards.kind).toBe('shards');
    expect(shards.amount).toBe(4);
    expect(boon.kind).toBe('boon');
    // a card without the fields stays without them: no key is invented on the way (absent = today)
    for (const k of ['pact', 'needs', 'bargain']) expect(k in plain).toBe(false);
  });

  it('the guest still sees the fields after a dropped connection (the host re-announces the pending modal)', async () => {
    const t = await create();
    run(60);
    const sent = open(t, 'levelUp');
    run(20);
    expect(t.guestWorlds[0]?.modal?.cards).toEqual(viaJson(sent.cards));
    t.transports[1]?.drop();
    run(30);
    await t.reconnect(1);
    run(60);
    await t.settle(100);
    const got = t.guestWorlds[0]?.modal;
    expect(got?.id).toBe(sent.id);
    expect(got?.cards).toEqual(viaJson(sent.cards));
  });

  it('a re-sync delivers the host current offer fields, not a stale copy', async () => {
    const t = await create();
    run(60);
    const sent = open(t, 'levelUp');
    run(20);
    expect(t.guestWorlds[0]?.modal?.cards[0]?.pact).toEqual({ awakens: ['lightning_trio', 'bladewheel'] });
    // the host's offer changes in place while the guest is away (the next announce carries the new fields)
    const first = sent.cards[0] as Card;
    first.pact = { awakens: ['lunge'] };
    first.needs = 'acceleration';
    t.transports[1]?.drop();
    run(10);
    await t.reconnect(1);
    run(60);
    await t.settle(100);
    const got = t.guestWorlds[0]?.modal?.cards[0];
    expect(got?.pact).toEqual({ awakens: ['lunge'] });
    expect(got?.needs).toBe('acceleration');
  });
});

describe('picking a kind nothing implements yet', () => {
  it.each([2])('card %i (the bargain): the pick closes the modal on host and guest and changes no hero state', async (index) => {
    const t = await create();
    const hw = t.hostWorld;
    const mw = t.guestWorlds[0]!;
    run(60);
    open(t, 'levelUp');
    run(30);
    const hero = hw.players[1]!;
    const before = { hp: hero.hp, yeop: hero.yeop, shards: hero.shards, level: hero.level, skills: hero.skills.length, passives: hero.passives.length, stones: hero.stones.filter(Boolean).length, trinkets: hero.trinkets.filter(Boolean).length };
    const frozen = hw.tick;
    expect(mw.modal?.cards[index]?.kind).toMatch(/shards|boon|bargain/);
    expect(mw.chooseCard(index)).toBe(true);
    run(60);
    expect(hw.modals).toHaveLength(0);
    expect(mw.modal).toBeNull();
    // the sim resumes
    run(30);
    expect(hw.tick).toBeGreaterThan(frozen + 10);
    expect({ hp: hero.hp, yeop: hero.yeop, shards: hero.shards, level: hero.level, skills: hero.skills.length, passives: hero.passives.length, stones: hero.stones.filter(Boolean).length, trinkets: hero.trinkets.filter(Boolean).length }).toEqual(before);
  });
});

describe('picking the overflow cards (OF-03)', () => {
  it.each([
    [4, 'shards'],
    [5, 'boon'],
  ] as const)('card %i (%s): the guest pick closes the modal on host and guest and lands on the guest hero of the host only', async (index, kind) => {
    const t = await create();
    const hw = t.hostWorld;
    const mw = t.guestWorlds[0]!;
    run(60);
    open(t, 'levelUp');
    run(30);
    const hero = hw.players[1]!;
    const host = hw.players[0]!;
    const before = { shards: hero.shards, yeop: hero.yeop, boons: boonCount(hero), hpMax: hero.hpMax, damage: hero.stats.damage, hostShards: host.shards, hostBoons: boonCount(host), hostDamage: host.stats.damage };
    const frozen = hw.tick;
    expect(mw.modal?.cards[index]?.kind).toBe(kind);
    expect(mw.chooseCard(index)).toBe(true);
    run(60);
    expect(hw.modals).toHaveLength(0);
    expect(mw.modal).toBeNull();
    run(30);
    expect(hw.tick).toBeGreaterThan(frozen + 10); // the sim resumes
    if (kind === 'shards') {
      expect(hero.shards).toBe(before.shards + 4); // the amount of the crafted card
      expect(hero.yeop).toBe(before.yeop);
      expect(boonCount(hero)).toBe(0);
    } else {
      expect(boonCount(hero)).toBe(1);
      expect(hero.hpMax).toBeGreaterThan(before.hpMax);
      expect(hero.stats.damage).toBeCloseTo(before.damage + 0.03, 9);
      expect(hero.shards).toBe(before.shards);
    }
    // the other hero is untouched
    expect(host.shards).toBe(before.hostShards);
    expect(boonCount(host)).toBe(before.hostBoons);
    expect(host.stats.damage).toBeCloseTo(before.hostDamage, 9);
  });
});

// OF-05 gave the shards and Boon cards their faces (cardModel.test.ts pins them); only the bargain (EV-03a) is still the plain stub
describe('card model of a kind nothing draws yet', () => {
  beforeAll(() => {
    setDeps({ content, store: { hud: { value: { skills: [], passives: [], stones: [], trinkets: [] } } } } as unknown as Parameters<typeof setDeps>[0]);
  });
  afterAll(() => setDeps(null));

  it.each(['bargain'] as const)('%s describes as a plain card without a raw i18n key', (kind) => {
    const m = describeCard(card({ kind, id: 'x_id', bargain: { boon: 'b', curse: 'c' } }));
    expect(m.kind).toBe(kind);
    expect(m.title).toBe('x_id');
    expect(m.iconKind).toBe('misc');
    expect(m.sub).toBe('');
    expect(m.isNew).toBe(false);
  });

  // OF-02 (ui/cardModel.ts) draws the pact line: the fields now add that line and nothing else to the model of the existing kinds
  it('the new optional fields add only the pact line to the model of the existing kinds', () => {
    const passive = content.passives[0];
    const bare = describeCard(card({ kind: 'passiveUp', id: passive?.id ?? '', rank: 2, lines: [{ stat: 'maxHpPct', mode: 'pct', value: 0.1 }] }));
    const withFields = describeCard(card({ kind: 'passiveUp', id: passive?.id ?? '', rank: 2, lines: [{ stat: 'maxHpPct', mode: 'pct', value: 0.1 }], pact: { awakens: ['lightning_trio'] }, needs: 'x' }));
    const { pact, ...rest } = withFields;
    expect(rest).toEqual(bare);
    expect(bare.pact).toBeUndefined();
    // `needs` belongs to skill cards: on a passive card it draws nothing
    expect(pact?.mode).toBe('awakens');
  });
});

describe('HUD snapshots keep today\'s shape', () => {
  /** every key a HudSnapshot has today, plus the three optional A0-CARD fields (filled by RS-02a / EV-02a / EL-04 later) */
  const TODAY = ['time', 'player', 'hp', 'hpMax', 'shield', 'level', 'xp', 'xpNext', 'yeop', 'shards', 'kills', 'corruption', 'alive', 'skills', 'passives', 'stones', 'trinkets', 'rerolls', 'banishes', 'skips', 'nextBoss', 'boss', 'metins', 'darkness', 'px', 'pz', 'dmg', 'dps'];
  const OPTIONAL = ['runEvent', 'channel'];

  function expectToday(hud: HudSnapshot): void {
    for (const k of Object.keys(hud)) expect([...TODAY, ...OPTIONAL]).toContain(k);
    for (const k of TODAY) expect(k in hud).toBe(true);
    // default content has no run events and no shrine: the optional fields are absent or neutral
    expect(hud.runEvent ?? null).toBeNull();
    expect(hud.channel ?? 0).toBe(0);
    expect(hud.boss?.affix).toBeUndefined();
    if (hud.boss) expect('affix' in hud.boss).toBe(false);
  }

  it('host and guest HUDs of a run (with a boss on the field) carry no run event, channel or boss affix', async () => {
    const t = await create();
    run(120);
    expectToday(t.hostWorld.hud(0));
    expectToday(t.guestWorlds[0]!.hud(0));
    const boss = spawnBoss(t.hostWorld, 'boss_horyeong', false, 8, 8);
    expect(boss).not.toBeNull();
    run(120);
    const host = t.hostWorld.hud(0);
    const guest = t.guestWorlds[0]!.hud(0);
    expect(host.boss?.id).toBe('boss_horyeong');
    expect(guest.boss?.id).toBe('boss_horyeong');
    expectToday(host);
    expectToday(guest);
    // same key set on both sides (the guest HUD is built separately in net/coop/mirror.ts buildHud)
    expect(Object.keys(guest).sort()).toEqual(Object.keys(host).sort());
    expect(Object.keys(guest.boss ?? {}).sort()).toEqual(Object.keys(host.boss ?? {}).sort());
  });

  it('the optional fields type-check with their documented shapes', () => {
    const base = {} as HudSnapshot;
    const hud: HudSnapshot = {
      ...base,
      runEvent: { kind: 'metinRain', phase: 'announce', left: 5, x: 1, z: -2 },
      channel: 0.4,
      boss: { id: 'b', hp: 1, hpMax: 2, phase: 0, enraged: false, final: false, x: 0, z: 0, affix: 'swift' },
    };
    expect(hud.runEvent?.phase).toBe('announce');
    expect(hud.channel).toBe(0.4);
    expect(hud.boss?.affix).toBe('swift');
    const none: HudSnapshot = { ...base, runEvent: null };
    expect(none.runEvent).toBeNull();
  });
});
