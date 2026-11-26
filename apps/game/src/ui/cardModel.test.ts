// Card display model (owner B6): stat keys for the gem icons, rank medal indexes, slot pips, flavour lines, heal / treasure numbers.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { content } from '../data/loader';
import type { ContentDB } from '../data/schema';
import { dropSkills, giveSkill, makeWorld, player } from '../sim/__tests__/helpers';
import { createWorld } from '../sim/world';
import { MAX_SKILL_RANK } from '../data/schema';
import { applyCard, buildOffer, openChest } from '../sim/cards';
import { hud as simHud } from '../sim/hud';
import type { Card } from '../sim/types';
import { bandOf, cardStartsHidden, describeCard, pactLinks } from './cardModel';
import { setDeps } from './env';

const card = (over: Partial<Card>): Card => ({ kind: 'newSkill', id: '', rarity: 'common', rank: 0, maxRank: 7, awakening: false, lines: [], amount: 0, slot: -1, replaces: null, ...over });

describe('describeCard', () => {
  beforeAll(() => {
    // the model only reads `content` and `store.hud.value`
    setDeps({ content, store: { hud: { value: { skills: [], passives: [], stones: [], trinkets: [] } } } } as unknown as Parameters<typeof setDeps>[0]);
  });
  afterAll(() => setDeps(null));

  const skill = content.skills[0];
  const passive = content.passives[0];

  it('a skill upgrade carries rank indexes of both medals, stat keys per line and a flavour line', () => {
    expect(skill).toBeDefined();
    const m = describeCard(card({ kind: 'skillUp', id: skill?.id ?? '', rarity: 'rare', rank: 3, lines: [{ stat: 'damage', mode: 'pct', value: 0.34 }, { stat: 'cooldown', mode: 'pct', value: 0.1 }] }));
    expect(m.rankFrom).toBe('3');
    expect(m.rankTo).toBe('M1');
    expect(m.rankIdx).toBe(3);
    expect(m.rankFromIdx).toBe(2);
    expect(m.lines.map((l) => l.stat)).toEqual(['damage', 'cooldown']);
    expect(m.flavour && m.flavour.length).toBeGreaterThan(10);
    expect(m.slotUse).toBeUndefined();
  });

  it('a new skill takes a slot (pips) and has no rank row', () => {
    const m = describeCard(card({ kind: 'newSkill', id: skill?.id ?? '', rarity: 'epic', rank: 0 }));
    expect(m.rankFrom).toBeUndefined();
    expect(m.rankIdx).toBe(0);
    expect(m.isNew).toBe(true);
    expect(m.slotUse).toEqual({ n: 1, max: content.balance.maxActiveSkills });
    expect(m.desc && m.desc.length).toBeGreaterThan(10);
  });

  it('a passive upgrade keeps its numbers as lines and its description as flavour', () => {
    const m = describeCard(card({ kind: 'passiveUp', id: passive?.id ?? '', rarity: 'epic', rank: 4, maxRank: 5, lines: [{ stat: 'maxHpPct', mode: 'pct', value: 0.136 }] }));
    expect(m.rankFrom).toBe('3');
    expect(m.rankTo).toBe('4');
    expect(m.rankIdx).toBeUndefined();
    expect(m.lines[0]?.stat).toBe('maxHpPct');
    expect(m.flavour).toBeTruthy();
  });

  it('heal and treasure cards show one big number line', () => {
    const heal = describeCard(card({ kind: 'heal', amount: 0.3 }));
    expect(heal.lines).toHaveLength(1);
    expect(heal.lines[0]?.amount).toBe('30%');
    expect(heal.lines[0]?.stat).toBe('heal');
    const yeop = describeCard(card({ kind: 'yeop', amount: 420 }));
    expect(yeop.lines[0]?.amount).toBe('420');
    expect(yeop.lines[0]?.positive).toBe(true);
  });

  it('instant rewards carry the one-line note for the rank row and a short sentence for the inscription slab', () => {
    const heal = describeCard(card({ kind: 'heal', amount: 0.3 }));
    expect(heal.instant && heal.instant.length).toBeGreaterThan(3);
    expect(heal.flavour && heal.flavour.length).toBeGreaterThan(10);
    expect(describeCard(card({ kind: 'yeop', amount: 100 })).flavour).not.toBe(heal.flavour);
    expect(describeCard(card({ kind: 'yeop', amount: 100 })).instant).toBe(heal.instant);
    expect(describeCard(card({ kind: 'skillUp', id: skill?.id ?? '', rank: 2 })).instant).toBeUndefined();
  });

  it('the icon light band follows the skill rank (1-3 n, M m, G g, P p), the passive level (1-2 n, 3 m, 4 g, 5 p) and awakenings', () => {
    const band = (over: Partial<Card>) => bandOf(describeCard(card({ id: (over.kind === 'newPassive' || over.kind === 'passiveUp' ? passive?.id : skill?.id) ?? '', ...over })));
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((rank) => band({ kind: 'skillUp', rank }))).toEqual(['n', 'n', 'n', 'm', 'm', 'g', 'g', 'p']);
    expect([1, 2, 3, 4, 5].map((rank) => band({ kind: 'passiveUp', rank, maxRank: 5 }))).toEqual(['n', 'n', 'm', 'g', 'p']);
    expect(band({ kind: 'skillUp', rank: 2, awakening: true })).toBe('p');
    expect(band({ kind: 'heal', amount: 0.3 })).toBe('n');
  });
});

describe('describeCard slot use (QA PLAYREV-2)', () => {
  const basic = content.skills.find((s) => s.kind === 'basic');
  const actives = content.skills.filter((s) => s.kind === 'active');
  const ultimate = content.skills.find((s) => s.kind === 'ultimate');
  const slot = (id: string, isBasic = false) => ({ id, icon: '', rank: 1, cooldown: 0, cdLeft: 0, basic: isBasic, awakened: false });
  const withHud = (ids: { id: string; basic?: boolean }[]) =>
    setDeps({ content, store: { hud: { value: { skills: ids.map((s) => slot(s.id, s.basic === true)), passives: [], stones: [], trinkets: [] } } } } as unknown as Parameters<typeof setDeps>[0]);
  afterAll(() => setDeps(null));

  it('the basic attack and an ultimate do not use up skill slots: basic + 5 actives + ultimate, a new skill takes the 6th of 6', () => {
    expect(basic && ultimate && actives.length >= 7).toBe(true);
    withHud([{ id: basic?.id ?? '', basic: true }, { id: ultimate?.id ?? '' }, ...actives.slice(0, 5).map((s) => ({ id: s.id }))]);
    const m = describeCard(card({ kind: 'newSkill', id: actives[6]?.id ?? '', rank: 0 }));
    expect(m.slotUse).toEqual({ n: 6, max: content.balance.maxActiveSkills });
  });

  it('the new-skill footer reads 6/6, never 7/6, when the basic attack and five actives are held', () => {
    withHud([{ id: basic?.id ?? '', basic: true }, ...actives.slice(0, 5).map((s) => ({ id: s.id }))]);
    const m = describeCard(card({ kind: 'newSkill', id: actives[6]?.id ?? '', rank: 0 }));
    expect(m.footer).toContain('6/6');
    expect(m.footer).not.toContain('7/6');
  });

  it('an upgrade of a held skill shows no slot use', () => {
    withHud([{ id: basic?.id ?? '', basic: true }, ...actives.slice(0, 6).map((s) => ({ id: s.id }))]);
    expect(describeCard(card({ kind: 'skillUp', id: actives[0]?.id ?? '', rank: 2 })).slotUse).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Awakening pacts on the cards and on the build board (OF-02): `needs` / `pact.awakens` / a ready awakening card, and pactLinks
describe('describeCard pacts (OF-02)', () => {
  const skillOf = (behavior: string) => content.skills.find((s) => s.kind === 'active' && s.behavior === behavior);
  const cutDef = skillOf('meleeArc'); // pact passive: sovereign_wrath
  const berserk = skillOf('selfBuff'); // pact passive: saddlecraft
  const dashDef = skillOf('dash'); // pact passive: saddlecraft
  const pactOn = { ...content, balance: { ...content.balance, pacts: { rank: 2, readyWeight: 2, byBehavior: { meleeArc: 'sovereign_wrath', selfBuff: 'saddlecraft', dash: 'saddlecraft' } } } };
  const pactOff = { ...content, balance: { ...content.balance, pacts: { rank: 0, readyWeight: 1, byBehavior: {} } } };
  const held = (passives: { id: string; rank: number }[]) => ({
    skills: [],
    passives: passives.map((p) => ({ ...p, icon: '', maxRank: 5 })),
    stones: [],
    trinkets: [],
  });
  const use = (c: typeof content, hud: ReturnType<typeof held>) => setDeps({ content: c, store: { hud: { value: hud } } } as unknown as Parameters<typeof setDeps>[0]);
  afterAll(() => setDeps(null));

  it('the fixture content really maps three skills to two pact passives', () => {
    expect(cutDef && berserk && dashDef).toBeTruthy();
  });

  it('a G2 skill card that cannot awaken yet reads "Awakens with <passive>" with the passive icon and the rank it needs', () => {
    use(pactOn, held([]));
    const m = describeCard(card({ kind: 'skillUp', id: berserk?.id ?? '', rank: 6, needs: 'saddlecraft' }));
    expect(m.pact?.mode).toBe('needs');
    expect(m.pact?.text).toBe('Awakens with Saddlecraft');
    expect(m.pact?.icons).toEqual([{ id: 'saddlecraft', icon: content.passives.find((p) => p.id === 'saddlecraft')?.icon, kind: 'passive', name: 'Saddlecraft' }]);
    expect(m.pact?.note).toBe('Needs rank 2');
    expect(m.pact?.more).toBe(0);
    expect(m.awakening).toBe(false);
  });

  it('a passive held below the pact rank shows the progress ("Rank 1 of 2")', () => {
    use(pactOn, held([{ id: 'saddlecraft', rank: 1 }]));
    const m = describeCard(card({ kind: 'skillUp', id: dashDef?.id ?? '', rank: 6, needs: 'saddlecraft' }));
    expect(m.pact?.note).toBe('Rank 1 of 2');
  });

  it('a passive card lists the owned skills it awakens, with their icons and names; more than three are counted', () => {
    use(pactOn, held([]));
    const m = describeCard(card({ kind: 'newPassive', id: 'saddlecraft', rank: 1, maxRank: 5, pact: { awakens: [berserk?.id ?? '', dashDef?.id ?? ''] } }));
    expect(m.pact?.mode).toBe('awakens');
    expect(m.pact?.icons.map((i) => i.id)).toEqual([berserk?.id, dashDef?.id]);
    expect(m.pact?.icons.every((i) => i.kind === 'skill' && i.icon.length > 0)).toBe(true);
    expect(m.pact?.text.startsWith('Pact: awakens ')).toBe(true);
    expect(m.pact?.text).toContain(berserk?.name.en);
    expect(m.pact?.text).toContain(dashDef?.name.en);
    const ids = content.skills.filter((s) => s.kind === 'active').slice(0, 5).map((s) => s.id);
    const many = describeCard(card({ kind: 'passiveUp', id: 'saddlecraft', rank: 2, maxRank: 5, pact: { awakens: ids } }));
    expect(many.pact?.icons).toHaveLength(3);
    expect(many.pact?.more).toBe(2);
    // the sentence still names every skill (the icons are the short form)
    expect(ids.every((id) => many.pact?.text.includes(content.skills.find((s) => s.id === id)?.name.en ?? '?'))).toBe(true);
  });

  it('a ready awakening card (pact passive held at the pact rank) shows "Pact kept" and keeps the awakening flag for the ribbon', () => {
    use(pactOn, held([{ id: 'sovereign_wrath', rank: 3 }]));
    const m = describeCard(card({ kind: 'skillUp', id: cutDef?.id ?? '', rank: 7, awakening: true }));
    expect(m.awakening).toBe(true);
    expect(m.pact?.mode).toBe('ready');
    expect(m.pact?.text).toBe('Pact kept: Wrath of the Sky Sovereign');
    expect(m.pact?.note).toBeUndefined();
  });

  it('an awakening card is never labelled "pact kept" while the hero does not hold the passive', () => {
    use(pactOn, held([{ id: 'sovereign_wrath', rank: 1 }]));
    expect(describeCard(card({ kind: 'skillUp', id: cutDef?.id ?? '', rank: 7, awakening: true })).pact).toBeUndefined();
    use(pactOn, held([]));
    expect(describeCard(card({ kind: 'skillUp', id: cutDef?.id ?? '', rank: 7, awakening: true })).pact).toBeUndefined();
  });

  it('pacts off (rank 0): no pact line on any card, awakening cards look as before', () => {
    use(pactOff, held([{ id: 'sovereign_wrath', rank: 3 }]));
    expect(describeCard(card({ kind: 'skillUp', id: cutDef?.id ?? '', rank: 7, awakening: true })).pact).toBeUndefined();
    // plain cards of the sim never carry the fields; cards of other kinds ignore them
    expect(describeCard(card({ kind: 'heal', amount: 0.3 })).pact).toBeUndefined();
    expect(describeCard(card({ kind: 'skillUp', id: cutDef?.id ?? '', rank: 3 })).pact).toBeUndefined();
    expect(describeCard(card({ kind: 'newPassive', id: 'saddlecraft', rank: 1, maxRank: 5 })).pact).toBeUndefined();
  });

  it('the card fields are the only input: a skill card without needs and a passive card with an empty pact list have no pact line (pacts on)', () => {
    use(pactOn, held([{ id: 'sovereign_wrath', rank: 3 }]));
    expect(describeCard(card({ kind: 'skillUp', id: cutDef?.id ?? '', rank: 4 })).pact).toBeUndefined();
    expect(describeCard(card({ kind: 'newPassive', id: 'sanctified_mail', rank: 1, maxRank: 5, pact: { awakens: [] } })).pact).toBeUndefined();
  });
});

describe('pactLinks (OF-02 build board)', () => {
  const skills = ['meleeArc', 'selfBuff', 'dash', 'persistentAura'].map((b) => content.skills.find((s) => s.kind === 'active' && s.behavior === b));
  const [cut, berserk, dash, aura] = skills;
  const pacts = { rank: 2, readyWeight: 2, byBehavior: { meleeArc: 'sovereign_wrath', selfBuff: 'saddlecraft', dash: 'saddlecraft', persistentAura: 'sovereign_eyes' } };
  const on = { ...content, balance: { ...content.balance, pacts } };
  const off = { ...content, balance: { ...content.balance, pacts: { ...pacts, rank: 0 } } };
  const slot = (id: string | undefined, rank: number, awakened = false) => ({ id: id ?? '', icon: `icon_skill_${id}`, rank, cooldown: 0, cdLeft: 0, basic: false, awakened });
  const hud = {
    skills: [slot(cut?.id, 6), slot(berserk?.id, 6), slot(dash?.id, 3), slot(aura?.id, 7, true)],
    passives: [
      { id: 'sovereign_wrath', icon: 'icon_passive_sovereign_wrath', rank: 4, maxRank: 5 },
      { id: 'saddlecraft', icon: 'icon_passive_saddlecraft', rank: 1, maxRank: 5 },
    ],
  };
  afterAll(() => setDeps(null));

  it('classifies every owned skill: ready at G2 with the passive, open without it (with the rank progress), kept below G2, awakened', () => {
    setDeps({ content: on, store: { hud: { value: null } } } as unknown as Parameters<typeof setDeps>[0]);
    const links = pactLinks(hud);
    const by = Object.fromEntries(links.map((l) => [l.skillId, l]));
    expect(links).toHaveLength(4);
    expect(by[cut?.id ?? '']).toMatchObject({ state: 'ready', passiveId: 'sovereign_wrath', have: 4, need: 2 });
    expect(by[berserk?.id ?? '']).toMatchObject({ state: 'open', passiveId: 'saddlecraft', have: 1, need: 2 });
    expect(by[berserk?.id ?? '']?.text).toBe('Needs Saddlecraft, rank 1 of 2');
    expect(by[dash?.id ?? '']).toMatchObject({ state: 'open', skillRank: 3 });
    expect(by[aura?.id ?? '']).toMatchObject({ state: 'awakened', have: 0 });
    // the same passive at rank 2 keeps the pact of both skills that wait for it
    const kept = pactLinks({ ...hud, passives: [{ id: 'saddlecraft', icon: '', rank: 2, maxRank: 5 }] });
    expect(kept.find((l) => l.skillId === dash?.id)?.state).toBe('kept');
    expect(kept.find((l) => l.skillId === berserk?.id)?.state).toBe('ready');
  });

  it('the pact rank is capped at the passive max rank, and pacts off / no HUD give no links', () => {
    const capped = { ...content, balance: { ...content.balance, pacts: { ...pacts, rank: 9 } } };
    setDeps({ content: capped, store: { hud: { value: null } } } as unknown as Parameters<typeof setDeps>[0]);
    const l = pactLinks({ ...hud, passives: [{ id: 'sovereign_wrath', icon: '', rank: 5, maxRank: 5 }] }).find((x) => x.skillId === cut?.id);
    expect(l).toMatchObject({ state: 'ready', need: 5 });
    setDeps({ content: off, store: { hud: { value: null } } } as unknown as Parameters<typeof setDeps>[0]);
    expect(pactLinks(hud)).toEqual([]);
    expect(pactLinks(null)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The fix round of OF-02 (critic A.offers-ui r1): how far a passive card moves the pact, the pact that can no longer be kept, the last passive slot
describe('pact progress, blocked pacts and the last passive slot (OF-02 fix round)', () => {
  const find = (behavior: string) => content.skills.find((s) => s.kind === 'active' && s.behavior === behavior);
  const berserk = find('selfBuff'); // pact passive: saddlecraft
  const dashDef = find('dash'); // pact passive: saddlecraft
  const cutDef = find('meleeArc'); // pact passive: sovereign_wrath
  const aura = find('persistentAura'); // pact passive: sovereign_eyes
  const pacts = { rank: 2, readyWeight: 2, byBehavior: { meleeArc: 'sovereign_wrath', selfBuff: 'saddlecraft', dash: 'saddlecraft', persistentAura: 'sovereign_eyes' } };
  const on = { ...content, balance: { ...content.balance, maxPassives: 6, pacts } };
  const slot = (id: string | undefined, rank: number, awakened = false) => ({ id: id ?? '', icon: `icon_skill_${id}`, rank, cooldown: 0, cdLeft: 0, basic: false, awakened });
  const passives = (ids: [string, number][]) => ids.map(([id, rank]) => ({ id, rank, icon: `icon_passive_${id}`, maxRank: 5 }));
  /** n filler passives (never a pact passive of the fixture) */
  const filler = (n: number): [string, number][] => ['sanctified_mail', 'sovereign_boon', 'blood_oath', 'fortunes_favour', 'marshals_voice', 'true_flight'].slice(0, n).map((id) => [id, 1]);
  const showing = (c: typeof content, hud: { skills: ReturnType<typeof slot>[]; passives: ReturnType<typeof passives> }) =>
    setDeps({ content: c, store: { hud: { value: { ...hud, stones: [], trinkets: [] } } } } as unknown as Parameters<typeof setDeps>[0]);
  afterAll(() => setDeps(null));

  it('a passive card shows how far it moves the pact: "Rank 1 of 2" below the pact rank, "Keeps the pact" at it', () => {
    showing(on, { skills: [slot(berserk?.id, 6)], passives: [] });
    const first = describeCard(card({ kind: 'newPassive', id: 'saddlecraft', rank: 1, maxRank: 5, pact: { awakens: [berserk?.id ?? ''] } }));
    expect(first.pact?.note).toBe('Rank 1 of 2');
    const second = describeCard(card({ kind: 'passiveUp', id: 'saddlecraft', rank: 2, maxRank: 5, pact: { awakens: [berserk?.id ?? ''] } }));
    expect(second.pact?.note).toBe('Keeps the pact');
    expect(describeCard(card({ kind: 'passiveUp', id: 'saddlecraft', rank: 4, maxRank: 5, pact: { awakens: [berserk?.id ?? ''] } })).pact?.note).toBe('Keeps the pact');
    // the same sentence for both: the note is what tells them apart
    expect(first.pact?.text).toBe(second.pact?.text);
  });

  it('the pact rank is capped at the passive max rank on a passive card as well, and pacts off give no note', () => {
    const capped = { ...on, balance: { ...on.balance, pacts: { ...pacts, rank: 9 } } };
    showing(capped, { skills: [slot(berserk?.id, 6)], passives: passives([['saddlecraft', 4]]) });
    expect(describeCard(card({ kind: 'passiveUp', id: 'saddlecraft', rank: 4, maxRank: 5, pact: { awakens: [berserk?.id ?? ''] } })).pact?.note).toBe('Rank 4 of 5');
    expect(describeCard(card({ kind: 'passiveUp', id: 'saddlecraft', rank: 5, maxRank: 5, pact: { awakens: [berserk?.id ?? ''] } })).pact?.note).toBe('Keeps the pact');
    showing({ ...on, balance: { ...on.balance, pacts: { ...pacts, rank: 0 } } }, { skills: [slot(berserk?.id, 6)], passives: [] });
    // a card that still carries the field (stale) while pacts are off: the sentence stays, no progress is claimed
    expect(describeCard(card({ kind: 'newPassive', id: 'saddlecraft', rank: 1, maxRank: 5, pact: { awakens: [berserk?.id ?? ''] } })).pact?.note).toBeUndefined();
  });

  it('a queued "needs" card whose passive the HUD now holds at the pact rank reads "Pact kept", not "Rank 2 of 2"', () => {
    showing(on, { skills: [slot(berserk?.id, 6)], passives: passives([['saddlecraft', 2]]) });
    const m = describeCard(card({ kind: 'skillUp', id: berserk?.id ?? '', rank: 6, needs: 'saddlecraft' }));
    expect(m.pact?.mode).toBe('needs');
    expect(m.pact?.note).toBe('Pact kept');
    showing(on, { skills: [slot(berserk?.id, 6)], passives: passives([['saddlecraft', 1]]) });
    expect(describeCard(card({ kind: 'skillUp', id: berserk?.id ?? '', rank: 6, needs: 'saddlecraft' })).pact?.note).toBe('Rank 1 of 2');
  });

  it('every pact line has a short form (the names alone) for the narrowest columns', () => {
    showing(on, { skills: [slot(berserk?.id, 6), slot(dashDef?.id, 6)], passives: [] });
    expect(describeCard(card({ kind: 'skillUp', id: berserk?.id ?? '', rank: 6, needs: 'saddlecraft' })).pact?.short).toBe('Saddlecraft');
    const awakens = describeCard(card({ kind: 'newPassive', id: 'saddlecraft', rank: 1, maxRank: 5, pact: { awakens: [berserk?.id ?? '', dashDef?.id ?? ''] } }));
    expect(awakens.pact?.short).toBe(`${berserk?.name.en}, ${dashDef?.name.en}`);
    showing(on, { skills: [slot(cutDef?.id, 6)], passives: passives([['sovereign_wrath', 3]]) });
    expect(describeCard(card({ kind: 'skillUp', id: cutDef?.id ?? '', rank: 7, awakening: true })).pact?.short).toBe('Wrath of the Sky Sovereign');
  });

  it('a G2 skill whose pact passive can no longer be taken (every passive slot used, passive not held) is "blocked": the card promises nothing', () => {
    showing(on, { skills: [slot(berserk?.id, 6)], passives: passives(filler(6)) });
    const m = describeCard(card({ kind: 'skillUp', id: berserk?.id ?? '', rank: 6, needs: 'saddlecraft' }));
    expect(m.pact?.mode).toBe('blocked');
    expect(m.pact?.text).toBe('No passive slot left for Saddlecraft');
    expect(m.pact?.short).toBe('No slot: Saddlecraft');
    expect(m.pact?.note).toBeUndefined();
    expect(m.pact?.icons.map((i) => i.id)).toEqual(['saddlecraft']);
    // one slot short of full, or the passive held below the pact rank (a passive upgrade needs no slot): still open
    showing(on, { skills: [slot(berserk?.id, 6)], passives: passives(filler(5)) });
    expect(describeCard(card({ kind: 'skillUp', id: berserk?.id ?? '', rank: 6, needs: 'saddlecraft' })).pact?.mode).toBe('needs');
    showing(on, { skills: [slot(berserk?.id, 6)], passives: passives([...filler(5), ['saddlecraft', 1]]) });
    const held = describeCard(card({ kind: 'skillUp', id: berserk?.id ?? '', rank: 6, needs: 'saddlecraft' }));
    expect(held.pact?.mode).toBe('needs');
    expect(held.pact?.note).toBe('Rank 1 of 2');
  });

  it('pactLinks: a link is blocked while the passive is not held and no passive slot is left; open once a slot is free or the passive is held', () => {
    const skills = [slot(berserk?.id, 3), slot(cutDef?.id, 6), slot(aura?.id, 7, true)];
    setDeps({ content: on, store: { hud: { value: null } } } as unknown as Parameters<typeof setDeps>[0]);
    const full = pactLinks({ skills, passives: passives([['sovereign_wrath', 3], ...filler(5)]) });
    const by = Object.fromEntries(full.map((l) => [l.skillId, l]));
    expect(by[berserk?.id ?? '']).toMatchObject({ state: 'blocked', have: 0 });
    expect(by[berserk?.id ?? '']?.text).toBe('No passive slot left for Saddlecraft');
    expect(by[cutDef?.id ?? '']?.state).toBe('ready'); // its pact is kept: slots do not matter any more
    expect(by[aura?.id ?? '']?.state).toBe('awakened');
    expect(pactLinks({ skills, passives: passives([['sovereign_wrath', 3], ...filler(4)]) }).find((l) => l.skillId === berserk?.id)?.state).toBe('open');
    // held below the pact rank: never blocked (an upgrade of the held passive needs no slot)
    expect(pactLinks({ skills, passives: passives([['saddlecraft', 1], ...filler(5)]) }).find((l) => l.skillId === berserk?.id)?.state).toBe('open');
    expect(pactLinks({ skills, passives: passives([['saddlecraft', 2], ...filler(5)]) }).find((l) => l.skillId === berserk?.id)?.state).toBe('kept');
    // a smaller passive bar makes the same run blocked earlier
    const tight = { ...on, balance: { ...on.balance, maxPassives: 2 } };
    setDeps({ content: tight, store: { hud: { value: null } } } as unknown as Parameters<typeof setDeps>[0]);
    expect(pactLinks({ skills, passives: passives(filler(2)) }).find((l) => l.skillId === berserk?.id)?.state).toBe('blocked');
  });

  it('the board text of a ready link no longer tells a G2 skill to "awaken it at G2"', () => {
    setDeps({ content: on, store: { hud: { value: null } } } as unknown as Parameters<typeof setDeps>[0]);
    const ready = pactLinks({ skills: [slot(cutDef?.id, 6)], passives: passives([['sovereign_wrath', 3]]) })[0];
    expect(ready?.state).toBe('ready');
    expect(ready?.text).toBe('Pact kept: its next rank awakens it');
    expect(ready?.text).not.toContain('G2');
  });

  it('a new passive that takes the LAST passive slot warns the skills that wait for a different pact passive', () => {
    const hud = { skills: [slot(berserk?.id, 6), slot(dashDef?.id, 4), slot(cutDef?.id, 6)], passives: passives([['sovereign_wrath', 3], ...filler(4)]) };
    showing(on, hud);
    // a pact passive of another skill (Sovereign Eyes: Swordlight Ring): the pact line stays, the warning is a second line
    const eyes = describeCard(card({ kind: 'newPassive', id: 'sovereign_eyes', rank: 1, maxRank: 5, pact: { awakens: [aura?.id ?? ''] } }));
    expect(eyes.pact?.mode).toBe('awakens');
    expect(eyes.pact?.warn).toBe(`Last passive slot: ${berserk?.name.en}, ${dashDef?.name.en} stop at G2`);
    // the last resort of a very narrow card counts the skills instead of naming them: a short sentence, never one cut in the middle
    expect(eyes.pact?.warnShort).toBe('Last slot: 2 skills stop at G2');
    // a plain passive: the warning stands alone, with the icons of the stranded skills
    const plain = describeCard(card({ kind: 'newPassive', id: 'thorned_hide', rank: 1, maxRank: 5 }));
    expect(plain.pact?.mode).toBe('warn');
    expect(plain.pact?.text).toBe(`Last passive slot: ${berserk?.name.en}, ${dashDef?.name.en} stop at G2`);
    expect(plain.pact?.icons.map((i) => i.id)).toEqual([berserk?.id, dashDef?.id]);
    expect(plain.pact?.short).toBe('Last slot: 2 skills stop at G2');
    // one skill: singular
    showing(on, { ...hud, skills: [slot(berserk?.id, 6)] });
    expect(describeCard(card({ kind: 'newPassive', id: 'thorned_hide', rank: 1, maxRank: 5 })).pact?.text).toBe(`Last passive slot: ${berserk?.name.en} stops at G2`);
    expect(describeCard(card({ kind: 'newPassive', id: 'thorned_hide', rank: 1, maxRank: 5 })).pact?.short).toBe('Last slot: 1 skill stops at G2');
  });

  it('no last-slot warning: slots left, the card is the missing pact passive, an upgrade, awakened / maxed skills, pacts off', () => {
    const skills = [slot(berserk?.id, 6), slot(dashDef?.id, 4)];
    const plain = (kind: 'newPassive' | 'passiveUp', id = 'thorned_hide') => card({ kind, id, rank: kind === 'newPassive' ? 1 : 2, maxRank: 5 });
    // two slots left: this card does not take the last one
    showing(on, { skills, passives: passives(filler(3)) });
    expect(describeCard(plain('newPassive')).pact).toBeUndefined();
    // the last slot, but the card IS the passive they wait for (a new Saddlecraft at rank 1 is the pact passive: no warning, progress "Rank 1 of 2")
    showing(on, { skills, passives: passives(filler(5)) });
    const hr = describeCard(card({ kind: 'newPassive', id: 'saddlecraft', rank: 1, maxRank: 5, pact: { awakens: skills.map((k) => k.id) } }));
    expect(hr.pact?.warn).toBeUndefined();
    expect(hr.pact?.note).toBe('Rank 1 of 2');
    // a passive upgrade takes no slot
    expect(describeCard(plain('passiveUp')).pact).toBeUndefined();
    // an awakened skill, a skill at the max rank and a pact passive already held: nothing is stranded
    showing(on, { skills: [slot(berserk?.id, 7, true), slot(dashDef?.id, 7), slot(cutDef?.id, 6)], passives: passives([['sovereign_wrath', 3], ...filler(4)]) });
    expect(describeCard(plain('newPassive')).pact).toBeUndefined();
    // pacts off: no line anywhere
    showing({ ...on, balance: { ...on.balance, pacts: { ...pacts, rank: 0 } } }, { skills, passives: passives(filler(5)) });
    expect(describeCard(plain('newPassive')).pact).toBeUndefined();
  });
});

// The real offers of the sim (OF-01: sim/cards.ts writes `needs` / `pact`) through the model, with the sim's own HUD snapshot behind it.
describe('sim offers -> pact line (OF-01 -> OF-02)', () => {
  const PACTS = { meleeArc: 'fury', cone: 'fury', spinAura: 'haste', orbit: 'haste', persistentAura: 'eyes', skyStrike: 'eyes', dash: 'focus', groundZone: 'focus', selfBuff: 'focus', beam: 'focus', chain: 'focus', projectile: 'fortune', homingProjectile: 'fortune', leap: 'sovereign_blood', shockwave: 'sovereign_blood', summon: 'sovereign_blood' };
  const world = (pacts: boolean) =>
    makeWorld({
      content: (c: ContentDB) => {
        c.balance.maxActiveSkills = 0; // no new skills: only rank-ups and passives are rolled
        if (pacts) c.balance.pacts = { rank: 2, readyWeight: 2, byBehavior: { ...PACTS } } as ContentDB['balance']['pacts'];
      },
    });
  const scan = (w: ReturnType<typeof world>, n: number): Card[] => Array.from({ length: n }, () => buildOffer(w, player(w), { count: w.balance.cardsPerLevel })).flat();
  const showing = (w: ReturnType<typeof world>): void => setDeps({ content: w.content, store: { hud: { value: simHud(w, 0) } } } as unknown as Parameters<typeof setDeps>[0]);
  afterAll(() => setDeps(null));

  it('the G2 card of a skill whose pact is open, the passive card of its partner and the awakening card once the pact is kept', () => {
    const w = world(true);
    const p = player(w);
    const spin = giveSkill(w, 'bladewheel', 5);
    showing(w);
    const g2 = scan(w, 150).find((c) => c.kind === 'skillUp' && c.id === 'bladewheel');
    expect(g2?.needs).toBe('haste');
    const needs = describeCard(g2 as Card).pact;
    expect(needs?.mode).toBe('needs');
    expect(needs?.icons.map((i) => i.id)).toEqual(['haste']);
    expect(needs?.note).toBe('Needs rank 2');

    const passiveCard = scan(w, 250).find((c) => c.kind === 'newPassive' && c.id === 'haste');
    const awakens = describeCard(passiveCard as Card).pact;
    expect(awakens?.mode).toBe('awakens');
    expect(awakens?.icons.map((i) => i.id)).toEqual(['bladewheel']);

    // the pact is kept (Haste at rank 2) and the skill stands at G2: its next card is the awakening, with the gold "pact kept" line
    p.passives.push({ id: 'haste', rank: 2, power: 2 });
    spin.rank = 6;
    showing(w);
    const awake = scan(w, 150).find((c) => c.kind === 'skillUp' && c.id === 'bladewheel');
    expect(awake?.awakening).toBe(true);
    expect('needs' in (awake as Card)).toBe(false);
    const ready = describeCard(awake as Card);
    expect(ready.awakening).toBe(true);
    expect(ready.pact?.mode).toBe('ready');
    expect(ready.pact?.icons.map((i) => i.id)).toEqual(['haste']);
    // and the build board links the same state
    expect(pactLinks(simHud(w, 0)).find((l) => l.skillId === 'bladewheel')?.state).toBe('ready');
  });

  it('pacts off: the same offers carry no fields and the model no pact line', () => {
    const w = world(false);
    giveSkill(w, 'bladewheel', 5);
    showing(w);
    const cards = scan(w, 150);
    expect(cards.some((c) => 'needs' in c || 'pact' in c)).toBe(false);
    expect(cards.map((c) => describeCard(c).pact).filter(Boolean)).toEqual([]);
    expect(pactLinks(simHud(w, 0))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The overflow cards (OF-05): the faces of the shards and Boon cards OF-03 generates, mixed boss rewards, the bargain stub
describe('describeCard overflow cards (OF-05)', () => {
  beforeAll(() => {
    setDeps({ content, store: { hud: { value: { skills: [], passives: [], stones: [], trinkets: [] } } } } as unknown as Parameters<typeof setDeps>[0]);
  });
  afterAll(() => setDeps(null));

  const boonLines = [{ stat: 'damage', mode: 'pct' as const, value: 0.03 }, { stat: 'maxHpPct', mode: 'pct' as const, value: 0.02 }];
  const boon = (rank: number) => card({ kind: 'boon', rarity: 'legendary', rank, maxRank: 0, lines: boonLines });

  it('a shards card is the yeop plate with a shard emblem, one number line of the shards it banks and a note that says when', () => {
    const m = describeCard(card({ kind: 'shards', rarity: 'rare', amount: 4 }));
    expect(m.title).not.toBe('');
    expect(m.title).toContain('Shards');
    expect(m.icon).toBe('icon_card_yeop');
    expect(m.iconKind).toBe('misc');
    expect(m.emblem).toBe('shard');
    expect(m.lines).toHaveLength(1);
    expect(m.lines[0]).toMatchObject({ sign: '+', amount: '4', positive: true, currency: 'shard' });
    expect(m.instant && m.instant.length).toBeGreaterThan(10);
    expect(m.flavour && m.flavour.length).toBeGreaterThan(10);
    expect(m.isNew).toBe(false);
    expect(m.slotUse).toBeUndefined();
    expect(m.rarity).toBe('rare');
    // the number is the card's own (the sim rolled it by rarity)
    expect(describeCard(card({ kind: 'shards', rarity: 'legendary', amount: 6 })).lines[0]?.amount).toBe('6');
  });

  it('a Boon card shows its stack as a rank row and the totals it brings, per stat, from -> to', () => {
    const first = describeCard(boon(1));
    expect(first.title).toContain('Boon');
    expect(first.sub).not.toBe('');
    expect(first.glyph).toBe('dragon');
    expect(first.element).toBe('holy');
    expect(first.rankFrom).toBe('0');
    expect(first.rankTo).toBe('1');
    expect(first.lines.map((l) => [l.stat, l.sign + l.amount, l.from])).toEqual([['damage', '+3%', undefined], ['maxHpPct', '+2%', undefined]]);
    expect(first.footer).toBeTruthy();
    expect(first.slotUse).toBeUndefined();
    expect(first.isNew).toBe(false);

    const fourth = describeCard(boon(4));
    expect(fourth.rankFrom).toBe('3');
    expect(fourth.rankTo).toBe('4');
    expect(fourth.lines.map((l) => [l.sign + l.amount, l.from])).toEqual([['+12%', '+9%'], ['+8%', '+6%']]);
    expect(fourth.flavour && fourth.flavour.length).toBeGreaterThan(10);
  });

  it('a Boon with no lines (both gains set to 0) still describes without a number row', () => {
    const m = describeCard(card({ kind: 'boon', rarity: 'legendary', rank: 2, lines: [] }));
    expect(m.lines).toEqual([]);
    expect(m.rankTo).toBe('2');
    expect(m.title).not.toBe('');
  });

  it('the bargain card keeps the plain A0-CARD stub until EV-03a gives it a face (no crash, no kind label, no lines)', () => {
    const m = describeCard(card({ kind: 'bargain', rarity: 'epic', bargain: { boon: 'a', curse: 'b' } }));
    expect(m.kind).toBe('bargain');
    expect(m.sub).toBe('');
    expect(m.lines).toEqual([]);
    expect(m.emblem).toBeUndefined();
  });

  it('only a surprise stays face down in a boss reward: a legendary card turns over by hand, the always-known Boon is dealt face up', () => {
    expect(cardStartsHidden(card({ kind: 'skillUp', rarity: 'legendary' }))).toBe(true);
    expect(cardStartsHidden(card({ kind: 'trinket', rarity: 'legendary' }))).toBe(true);
    expect(cardStartsHidden(card({ kind: 'skillUp', rarity: 'epic' }))).toBe(false);
    expect(cardStartsHidden(boon(3))).toBe(false);
    expect(cardStartsHidden(card({ kind: 'shards', rarity: 'epic', amount: 5 }))).toBe(false);
  });

  it('the cards the sim really deals on a dry build (Boon + shards) describe in full, in an offer, a chest and a boss reward, and the stack follows the picks', () => {
    const w = makeWorld({
      content: (c: ContentDB) => {
        c.balance.maxActiveSkills = 0;
        c.balance.maxPassives = 0;
        c.balance.overflow = { shards: true, boon: true, skipRefund: 1 } as ContentDB['balance']['overflow'];
      },
    });
    const p = player(w);
    for (const s of p.skills) s.rank = MAX_SKILL_RANK;
    setDeps({ content: w.content, store: { hud: { value: simHud(w, 0) } } } as unknown as Parameters<typeof setDeps>[0]);
    const offer = buildOffer(w, p, { count: 3 });
    expect(offer.map((c) => c.kind)).toEqual(['boon', 'shards']);
    const models = offer.map(describeCard);
    for (const m of models) {
      expect(m.title).not.toBe('');
      expect(m.icon).not.toBe('');
      expect(m.lines.length).toBeGreaterThan(0);
    }
    expect(new Set(models.map((m) => m.title)).size).toBe(2);
    expect(models[0]?.rankTo).toBe('1');
    const chest = openChest(w, p, null);
    expect(chest.cards.map((c) => describeCard(c).title)).toEqual(models.map((m) => m.title));
    w.modals.length = 0;
    expect(openChest(w, p, 'boss_x').cards.map((c) => cardStartsHidden(c))).toEqual([false, false]);
    applyCard(w, p, offer[0] as Card);
    applyCard(w, p, offer[0] as Card);
    const next = describeCard(buildOffer(w, p, { count: 3 })[0] as Card);
    expect(next.rankFrom).toBe('2');
    expect(next.rankTo).toBe('3');
    expect(next.lines[0]?.from).toBe('+6%');
    setDeps(null);
  });

  it('the boss reward of a full build with the milestone on is an epic essence card and the Boon, never Boon + shards; with nothing to take it is the Boon alone (gallery: upOffersBossDry / upOffersBossBoon)', () => {
    const full = (essence: boolean) =>
      makeWorld({
        content: (c: ContentDB) => {
          c.balance.maxActiveSkills = 0;
          c.balance.maxPassives = 0;
          c.balance.chest = { bossMilestone: true } as ContentDB['balance']['chest'];
          c.balance.overflow = { shards: true, boon: true, shardsByRarity: [1, 1, 2, 3, 4], skipRefund: 1 } as ContentDB['balance']['overflow'];
          if (!essence) {
            c.stones = [];
            c.trinkets = [];
          }
        },
      });
    for (const essence of [true, false]) {
      const w = full(essence);
      const p = player(w);
      for (const sk of p.skills) sk.rank = MAX_SKILL_RANK;
      setDeps({ content: w.content, store: { hud: { value: simHud(w, 0) } } } as unknown as Parameters<typeof setDeps>[0]);
      const kinds = openChest(w, p, 'boss_x').cards.map((c) => c.kind);
      expect(kinds).not.toContain('shards');
      if (essence) {
        expect(kinds).toHaveLength(2);
        expect(['stone', 'trinket']).toContain(kinds[0]);
        expect(kinds[1]).toBe('boon');
      } else {
        expect(kinds).toEqual(['boon']);
      }
      w.modals.length = 0;
      // every card of it has a face: the Boon is dealt face up, the essence card is a plain epic+ card
      const cards = openChest(w, p, 'boss_x').cards;
      expect(cards.map((c) => describeCard(c).title).every((title) => title !== '')).toBe(true);
      expect(cards.map((c) => cardStartsHidden(c)).filter(Boolean).length).toBeLessThanOrEqual(1);
      expect(cardStartsHidden(cards.find((c) => c.kind === 'boon') as Card)).toBe(false);
    }
    setDeps(null);
  });

  it('the Boon card is always legendary, so its rarity row says "Endless" instead of a rarity; every other card keeps its rarity word', () => {
    setDeps({ content, store: { hud: { value: { skills: [], passives: [], stones: [], trinkets: [] } } } } as unknown as Parameters<typeof setDeps>[0]);
    expect(describeCard(boon(3)).rarityLabel).toBe('Endless');
    expect(describeCard(card({ kind: 'shards', rarity: 'rare', amount: 2 })).rarityLabel).toBeUndefined();
    expect(describeCard(card({ kind: 'heal', amount: 0.3 })).rarityLabel).toBeUndefined();
    setDeps(null);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The shipped balance.pacts (OF-02 redo): every other pact test above pins its own fixture mapping, which hides a content change. These read
// the shipped rules (a lane may change rank / byBehavior at any time, attempt 1 of OF-02 failed on exactly that) and check that the offers
// of the real sim, the build board and the gallery's mock states all name the same partner and the same progress for one skill.
describe('shipped balance.pacts: cards, build board and gallery agree (OF-02 redo)', () => {
  const rules = content.balance.pacts;
  const on = (rules?.rank ?? 0) > 0;
  const needOf = (passiveId: string): number => Math.min(rules?.rank ?? 0, content.passives.find((p) => p.id === passiveId)?.maxRank ?? rules?.rank ?? 0);
  const partnerOf = (skillId: string): string | undefined => {
    const def = content.skills.find((s) => s.id === skillId);
    return def ? rules?.byBehavior?.[def.behavior] : undefined;
  };
  afterAll(() => setDeps(null));

  it.skipIf(!on)('the sim\'s needs cards and pact.awakens lists, the board link and the card line agree on the partner, and "Keeps the pact" means the rank reaches the pact rank', () => {
    const db = structuredClone(content);
    db.balance.maxActiveSkills = 0; // no new skills: only rank-ups and passives are rolled
    const w = createWorld({ zone: 'yeonmu', difficulty: 'normal', classId: 'warrior', doctrine: 'a', sex: 'm', empire: 'saehwa', seed: 11, meta: { stats: {} } }, db);
    dropSkills(w);
    const p = player(w);
    // G1 skills that wait (Berserk), a skill at G2 that waits (Swordlight Ring), Dash with its passive one rank short, the cut with its passive held
    giveSkill(w, 'warfever', 5);
    giveSkill(w, 'swordlight_ring', 6);
    giveSkill(w, 'spearhead', 4);
    giveSkill(w, 'giant_leap', 2);
    giveSkill(w, 'lightning_trio', 5);
    const dashPassive = partnerOf('spearhead') ?? '';
    const cutPassive = partnerOf('lightning_trio') ?? '';
    p.passives.push({ id: dashPassive, rank: Math.max(1, needOf(dashPassive) - 1), power: 1 }, { id: cutPassive, rank: needOf(cutPassive), power: 1 });
    const hud = simHud(w, 0);
    setDeps({ content: w.content, store: { hud: { value: hud } } } as unknown as Parameters<typeof setDeps>[0]);
    const links = pactLinks(hud);
    const cards = Array.from({ length: 400 }, () => buildOffer(w, p, { count: w.balance.cardsPerLevel })).flat();

    const needsCards = cards.filter((c) => c.needs !== undefined);
    expect(needsCards.length).toBeGreaterThan(0);
    for (const c of needsCards) {
      const link = links.find((l) => l.skillId === c.id);
      expect(link?.passiveId).toBe(c.needs);
      expect(['open', 'blocked']).toContain(link?.state);
      const pact = describeCard(c).pact;
      expect(pact?.icons[0]?.id).toBe(c.needs);
      expect(pact?.text).toContain(link?.passiveName ?? '?');
    }
    const passiveCards = cards.filter((c) => c.pact !== undefined);
    expect(passiveCards.length).toBeGreaterThan(0);
    for (const c of passiveCards) {
      const pact = describeCard(c).pact;
      for (const id of c.pact?.awakens ?? []) {
        const link = links.find((l) => l.skillId === id);
        expect(link?.passiveId).toBe(c.id);
        expect(['open', 'blocked']).toContain(link?.state);
      }
      expect(pact?.icons.map((i) => i.id)).toEqual((c.pact?.awakens ?? []).slice(0, 3));
      // the note is "Keeps the pact" exactly when this card brings the passive to the pact rank
      expect(pact?.note === 'Keeps the pact').toBe(c.rank >= needOf(c.id));
    }
    // a skill whose pact is kept is never promised by a passive card
    const kept = new Set(links.filter((l) => l.state === 'kept' || l.state === 'ready' || l.state === 'awakened').map((l) => l.skillId));
    expect(passiveCards.some((c) => (c.pact?.awakens ?? []).some((id) => kept.has(id)))).toBe(false);
  });

  it.skipIf(!on)('every pact state of the gallery (up_offers.ts) is derived from balance.pacts: needs / awakens / ready / blocked / warn name the board partner of the same skill', async () => {
    const { scenarios } = await import('./dev/scenarios/up_offers');
    const ids = ['upOffersPacts', 'upOffersPactsLong', 'upOffersPactsChest', 'upOffersPactsChest3', 'upOffersPactsBoss', 'upOffersPactsMix', 'upOffersPactsSlot', 'upOffersPactsFull', 'upOffersShards', 'upOffersBossMixed', 'upOffersBossAwaken', 'upOffersChest4', 'upOffersChest4Boss'];
    const seen = { needs: 0, awakens: 0, ready: 0, blocked: 0, warn: 0 };
    for (const id of ids) {
      const run = scenarios.find((s) => s.id === id)?.run;
      expect(run, id).toBeTypeOf('function');
      let hud: ReturnType<typeof simHud> | null = null;
      let cards: Card[] = [];
      const g = {
        content,
        store: {
          setScreen: () => undefined,
          setHud: (h: unknown) => {
            hud = h as ReturnType<typeof simHud>;
          },
          setSimModal: (m: { cards: Card[] }) => {
            cards = m.cards;
          },
        },
        hud: () => undefined,
      };
      run?.(g as unknown as Parameters<NonNullable<typeof run>>[0]);
      expect(hud, id).not.toBeNull();
      setDeps({ content, store: { hud: { value: hud } } } as unknown as Parameters<typeof setDeps>[0]);
      const links = pactLinks(hud);
      for (const c of cards) {
        const view = describeCard(c).pact;
        if (c.needs !== undefined) {
          const link = links.find((l) => l.skillId === c.id);
          expect(link?.passiveId, `${id} ${c.id} needs`).toBe(c.needs);
          expect(c.needs, `${id} ${c.id}`).toBe(partnerOf(c.id));
          expect(link?.have ?? 99, `${id} ${c.id} the passive is short of the pact rank`).toBeLessThan(link?.need ?? 0);
          expect(['needs', 'blocked']).toContain(view?.mode);
          seen[view?.mode === 'blocked' ? 'blocked' : 'needs']++;
        }
        if (c.pact) {
          for (const sid of c.pact.awakens) {
            const link = links.find((l) => l.skillId === sid);
            expect(link?.passiveId, `${id} ${c.id} awakens ${sid}`).toBe(c.id);
            expect(['open', 'blocked']).toContain(link?.state);
            // a card never both awakens a skill and strands it (the warning lists the skills the card does NOT serve)
            const name = content.skills.find((s) => s.id === sid)?.name.en ?? sid;
            expect(view?.warn ?? '', `${id} ${c.id}`).not.toContain(name);
          }
          expect(view?.mode).toBe('awakens');
          seen.awakens++;
        }
        if (c.awakening && view) {
          const link = links.find((l) => l.skillId === c.id);
          expect(view.mode, `${id} ${c.id}`).toBe('ready');
          expect(link?.state).toBe('ready');
          seen.ready++;
        }
        if (view?.warn || view?.mode === 'warn') seen.warn++;
      }
    }
    // the gallery shows every state at least once
    expect(seen.needs).toBeGreaterThan(0);
    expect(seen.awakens).toBeGreaterThan(0);
    expect(seen.ready).toBeGreaterThan(0);
    expect(seen.blocked).toBeGreaterThan(0);
    expect(seen.warn).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The room of the build board (OF-02 redo, BuildBoard.tsx boardRoom): the board stops under the whole top-right column and never over the minimap
// or the corruption gauge. The numbers are the 1920x1080 / 1366x768 columns of the critic's captures (px of the board's offset parent): the minimap
// ends at 247, the gauge at 287, the open damage-meter table at 508; the board's bottom edge is 986 / 682 and its chrome 33.
describe('build board room (OF-02 redo)', () => {
  const room = async (i: { bottom: number; frame: number; hard: number; whole: number }): Promise<number> => (await import('./hud/BuildBoard')).boardRoom(i);

  it('stops under the corruption gauge when the meter is closed, and under the minimap when the gauge is gone', async () => {
    expect(await room({ bottom: 986, frame: 33, hard: 287, whole: 287 })).toBe(658);
    expect(await room({ bottom: 986, frame: 33, hard: 247, whole: 247 })).toBe(698);
  });

  it('refits when the column changes: the gauge coming back takes the room back, an unfolded minimap takes more', async () => {
    const without = await room({ bottom: 986, frame: 33, hard: 247, whole: 247 });
    const withGauge = await room({ bottom: 986, frame: 33, hard: 287, whole: 287 });
    const folded = await room({ bottom: 986, frame: 33, hard: 62, whole: 62 });
    expect(withGauge).toBeLessThan(without);
    expect(folded).toBeGreaterThan(without);
  });

  it('stops under the open damage-meter table, not under the gauge', async () => {
    const table = await room({ bottom: 986, frame: 33, hard: 287, whole: 508 });
    expect(table).toBe(437); // the board's top edge sits 8 px under the table
    expect(986 - (table + 33)).toBeGreaterThanOrEqual(508 + 8 - 1);
  });

  it('gives up the room under the table only when less than the floor is left, and then still stops under the gauge', async () => {
    const { BOARD_FLOOR } = await import('./hud/BuildBoard');
    // 1366x768: 204 px under the table (above the floor): the board keeps clear of the table
    expect(await room({ bottom: 682, frame: 33, hard: 237, whole: 439 })).toBe(202);
    // a screen where the table leaves 150 px: the board covers the table and stops under the gauge
    const small = await room({ bottom: 600, frame: 33, hard: 237, whole: 439 });
    expect(small).toBe(600 - 237 - 8 - 33);
    expect(small).toBeGreaterThanOrEqual(BOARD_FLOOR);
  });

  it('never lifts the board over the gauge or the minimap to reach the floor, and never goes negative', async () => {
    const { BOARD_FLOOR } = await import('./hud/BuildBoard');
    // only 52 px under the gauge: the body is 52, not the 192 floor (the old code took max(192, room) and covered the gauge by 140 px)
    const tight = await room({ bottom: 400, frame: 33, hard: 307, whole: 307 });
    expect(tight).toBe(52);
    expect(tight).toBeLessThan(BOARD_FLOOR);
    expect(400 - (tight + 33)).toBeGreaterThanOrEqual(307);
    expect(await room({ bottom: 300, frame: 33, hard: 307, whole: 307 })).toBe(0);
  });

  it('a meter table that ends above the gauge (an empty column) cannot pull the limit above the hard limit', async () => {
    expect(await room({ bottom: 986, frame: 33, hard: 287, whole: 100 })).toBe(658);
  });
});
