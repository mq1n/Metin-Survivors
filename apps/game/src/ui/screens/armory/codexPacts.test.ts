// CX-01: the Pacts page of the Codex lists, for the viewed class, which passive awakens which skill. Its lines must be the table of
// balance.pacts and nothing else: the same rule as sim/cards.ts (a skill's awakening waits for the passive of its behaviour, held at least at
// the pact rank capped at the passive's own max rank), on the shipped content, on a changed table and with the pacts off. A run holds ONE
// doctrine, so a sheet names only skills that can share a run with its own (round 2: doctrine-aware lists, the page kept by the Armory).
import { afterEach, describe, expect, it } from 'vitest';
import { content } from '../../../data/loader';
import { MAX_SKILL_RANK, resolvePacts } from '../../../data/schema';
import type { BehaviorKind, ClassId, ContentDB } from '../../../data/schema';
import { dictionaries, tl } from '../../../i18n/i18n';
import { buildOffer } from '../../../sim/cards';
import { buildContentIndex } from '../../../sim/content';
import { cloneContent } from '../../../sim/__fixtures__/content';
import { giveSkill, makeWorld, player } from '../../../sim/__tests__/helpers';
import { pactNeedRank, pactRules } from '../../cardModel';
import {
  codexNeedsHero,
  codexPage,
  codexPages,
  pactGroupName,
  pactKindRuns,
  pactSiblings,
  pactSkillGroups,
  pactsOn,
  pactTable,
  pactTipRank,
  passivePactLine,
  sharesRun,
  showCodexPacts,
  skillPactLine,
} from './Codex';
import source from './Codex.tsx?raw';
import { armoryCodexSub } from './state';

const CLASSES: readonly ClassId[] = content.classes.map((c) => c.id);
/** the no-break space that binds a number to its word ("rank 4") so a phone never leaves "4)" alone on a line */
const NB = String.fromCharCode(160);

function withPacts(db: ContentDB, pacts: ContentDB['balance']['pacts']): ContentDB {
  return { ...db, balance: { ...db.balance, pacts } };
}

/** the skills the sim can offer a hero of `classId`: his own and the shared ones (sim/content.ts commonSkills: classId 'common' AND kind 'active') */
function offered(db: ContentDB, classId: ClassId): string[] {
  return db.skills.filter((s) => s.classId === classId || (s.classId === 'common' && s.kind === 'active')).map((s) => s.id);
}

afterEach(() => {
  armoryCodexSub.value = 'bestiary';
});

describe('Codex pacts: the shipped table', () => {
  const rules = resolvePacts(content.balance.pacts);

  it('the content ships pacts (rank > 0) over several passives and leaves some passives free', () => {
    expect(pactsOn(content)).toBe(true);
    expect(rules.rank).toBeGreaterThan(0);
    const partners = new Set(Object.values(rules.byBehavior));
    expect(partners.size).toBeGreaterThan(5);
    expect(content.passives.some((p) => !partners.has(p.id))).toBe(true);
  });

  it('the page reads the rule of the display twin (ui/cardModel.ts pactRules / pactNeedRank), not a copy', () => {
    const twin = pactRules(content);
    expect(twin?.rank).toBe(rules.rank);
    expect(twin?.by).toEqual(rules.byBehavior);
    for (const row of pactTable(content, 'warrior')?.pacts ?? []) expect(row.need).toBe(twin ? pactNeedRank(twin, row.def) : -1);
  });

  it.each(CLASSES)('%s: every skill line names the passive of its behaviour at the pact rank', (classId) => {
    const table = pactTable(content, classId);
    expect(table).not.toBeNull();
    const ids = table?.skills.map((s) => s.def.id) ?? [];
    // every skill the class can be offered (both doctrines, milestone skills, the shared ones), once each
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(offered(content, classId).sort());
    for (const row of table?.skills ?? []) {
      const partner = rules.byBehavior[row.def.behavior as BehaviorKind];
      expect(partner, `${row.def.id}: behaviour ${row.def.behavior} must have a pact`).toBeDefined();
      const passive = content.passives.find((p) => p.id === partner);
      expect(row.passive?.id).toBe(partner);
      expect(row.need).toBe(Math.min(rules.rank, passive?.maxRank ?? rules.rank));
      expect(skillPactLine(row)).toBe(`Awakens with ${tl(passive?.name)} (rank${NB}${row.need})`);
    }
  });

  it.each(CLASSES)('%s: a passive lists exactly the skills of the class whose behaviour maps to it', (classId) => {
    const table = pactTable(content, classId);
    const all = [...(table?.pacts ?? []), ...(table?.free ?? [])];
    expect(all.map((p) => p.def.id).sort()).toEqual(content.passives.map((p) => p.id).sort());
    for (const row of table?.pacts ?? []) {
      const behaviors = (Object.keys(rules.byBehavior) as BehaviorKind[]).filter((b) => rules.byBehavior[b] === row.def.id);
      expect(row.behaviors).toEqual(behaviors);
      expect(row.behaviors.length).toBeGreaterThan(0);
      const want = content.skills.filter((s) => offered(content, classId).includes(s.id) && behaviors.includes(s.behavior)).map((s) => s.id);
      expect(row.skills.map((s) => s.def.id).sort()).toEqual([...want].sort());
      expect(row.need).toBe(Math.min(rules.rank, row.def.maxRank));
      const line = passivePactLine(row, 'Hero', Infinity);
      if (want.length === 0) expect(line).toBe('Pact: awakens no Hero skill');
      else expect(line).toBe(`Pact: awakens ${row.skills.map((s) => tl(s.def.name)).join(', ')}`);
    }
    // every skill of the class is awakened by exactly one pact passive
    const awakened = (table?.pacts ?? []).flatMap((p) => p.skills.map((s) => s.def.id));
    expect([...awakened].sort()).toEqual((table?.skills ?? []).map((s) => s.def.id).sort());
    for (const row of table?.free ?? []) {
      expect(row.behaviors).toEqual([]);
      expect(row.skills).toEqual([]);
      expect(row.need, `${row.def.id}: a free passive has no pact rank`).toBe(0);
      expect(pactTipRank(row), `${row.def.id}: its tooltip shows rank 1, the rank 'Per rank' describes`).toBe(1);
      expect(passivePactLine(row, 'Hero')).toBe('No pact: awakens no skill');
    }
    for (const row of table?.pacts ?? []) expect(pactTipRank(row)).toBe(row.need);
  });

  it('a long list of skills is cut after three names in the list row and spelled out in full in the detail line', () => {
    const table = pactTable(content, 'warrior');
    const wide = (table?.pacts ?? []).find((p) => p.skills.length > 4);
    expect(wide, 'a warrior pact over more than four skills').toBeDefined();
    if (!wide) return;
    const short = passivePactLine(wide, 'Warrior');
    expect(short).toBe(`Pact: awakens ${wide.skills.slice(0, 3).map((s) => tl(s.def.name)).join(', ')} and${NB}${wide.skills.length - 3}${NB}more`);
    for (const s of wide.skills) expect(passivePactLine(wide, 'Warrior', Infinity)).toContain(tl(s.def.name));
  });

  it.each(CLASSES)('%s: the pact passives that awaken a skill of this hero come first, the ones that awaken none after them (content order in each)', (classId) => {
    const table = pactTable(content, classId);
    const pacts = table?.pacts ?? [];
    const firstNone = pacts.findIndex((p) => p.skills.length === 0);
    if (firstNone >= 0) expect(pacts.slice(firstNone).every((p) => p.skills.length === 0), 'no relevant pact after an irrelevant one').toBe(true);
    const order = (ids: string[]): number[] => ids.map((id) => content.passives.findIndex((p) => p.id === id));
    const sorted = (ns: number[]): boolean => ns.every((n, i) => i === 0 || (ns[i - 1] ?? 0) < n);
    expect(sorted(order(pacts.filter((p) => p.skills.length > 0).map((p) => p.def.id)))).toBe(true);
    expect(sorted(order(pacts.filter((p) => p.skills.length === 0).map((p) => p.def.id)))).toBe(true);
  });

  it('the warrior: Leadership and Precision (no warrior skill) stand after every pact that awakens a warrior skill', () => {
    const ids = (pactTable(content, 'warrior')?.pacts ?? []).map((p) => p.def.id);
    const none = (pactTable(content, 'warrior')?.pacts ?? []).filter((p) => p.skills.length === 0).map((p) => p.def.id);
    expect(none.length).toBeGreaterThan(0);
    for (const id of none) {
      const rest = ids.slice(ids.indexOf(id));
      expect(rest.every((x) => none.includes(x))).toBe(true);
    }
  });
});

describe('Codex pacts: a run holds one doctrine', () => {
  const doctrineOf = (classId: ClassId, key: 'a' | 'b'): string[] => {
    const d = content.classes.find((c) => c.id === classId)?.doctrines[key === 'a' ? 0 : 1];
    return d ? [d.basic, d.starter, ...d.skills] : [];
  };

  it('sharesRun: the same doctrine, and the shared skills with both', () => {
    expect(sharesRun('a', 'a')).toBe(true);
    expect(sharesRun('a', 'b')).toBe(false);
    expect(sharesRun('b', 'a')).toBe(false);
    expect(sharesRun('a', 'common')).toBe(true);
    expect(sharesRun('common', 'b')).toBe(true);
    expect(sharesRun('common', 'common')).toBe(true);
  });

  it.each(CLASSES)('%s: a doctrine skill\'s "awakened by the same passive" list has nothing from the other doctrine', (classId) => {
    const table = pactTable(content, classId);
    for (const row of table?.skills ?? []) {
      const sibs = pactSiblings(table ?? { rank: 0, skills: [], pacts: [], free: [] }, row);
      expect(sibs.every((s) => s.passive?.id === row.passive?.id && s.def.id !== row.def.id)).toBe(true);
      if (row.group === 'common') {
        // a shared skill meets both doctrines: every other skill of its passive is listed
        const want = (table?.skills ?? []).filter((s) => s.passive?.id === row.passive?.id && s.def.id !== row.def.id).map((s) => s.def.id);
        expect(sibs.map((s) => s.def.id).sort()).toEqual(want.sort());
      } else {
        const other = row.group === 'a' ? 'b' : 'a';
        expect(sibs.filter((s) => s.group === other), `${row.def.id} (${row.group})`).toEqual([]);
        for (const s of sibs) expect(s.group === row.group || s.group === 'common').toBe(true);
      }
    }
  });

  it('the groups follow the doctrine trees of the class (basic, starter and skills of a doctrine; every milestone skill is in its own)', () => {
    for (const classId of CLASSES) {
      const table = pactTable(content, classId);
      for (const row of table?.skills ?? []) {
        if (row.group === 'common') expect(row.def.classId).toBe('common');
        else if (row.def.kind !== 'ultimate') expect(doctrineOf(classId, row.group), `${row.def.id} belongs to doctrine ${row.group}`).toContain(row.def.id);
        else expect(row.def.doctrine, `${row.def.id} (milestone skill) carries its doctrine`).toBe(row.group);
      }
    }
  });

  it('Blaze Familiars (yacha, Hexcraft) does not list a skill of the Weaponry doctrine; Lightning Trio (warrior, Body) none of the Mind doctrine', () => {
    const yacha = pactTable(content, 'yacha');
    const flame = yacha?.skills.find((s) => s.def.id === 'blaze_familiars');
    expect(flame?.group).toBe('b');
    const fSibs = flame && yacha ? pactSiblings(yacha, flame) : [];
    expect(fSibs.every((s) => s.group !== 'a')).toBe(true);
    const war = pactTable(content, 'warrior');
    const cut = war?.skills.find((s) => s.def.id === 'lightning_trio');
    expect(cut?.group).toBe('a');
    const cSibs = (cut && war ? pactSiblings(war, cut) : []).map((s) => s.def.id);
    expect(cSibs).not.toContain('soul_crash');
    expect(cSibs).not.toContain('crushing_blow');
    expect(cSibs).toContain('sword_arc');
  });

  it.each(CLASSES)('%s: the groups of a passive sheet cover exactly the skills it awakens, doctrine a, doctrine b, shared', (classId) => {
    const table = pactTable(content, classId);
    for (const row of table?.pacts ?? []) {
      const groups = pactSkillGroups(row.skills);
      expect(groups.flatMap((g) => g.skills.map((s) => s.def.id)).sort(), row.def.id).toEqual(row.skills.map((s) => s.def.id).sort());
      for (const g of groups) {
        expect(g.skills.length).toBeGreaterThan(0);
        expect(g.skills.every((s) => s.group === g.group)).toBe(true);
      }
      expect(groups.map((g) => g.group)).toEqual((['a', 'b', 'common'] as const).filter((k) => row.skills.some((s) => s.group === k)));
    }
  });

  it('a Wrath of the Sky Sovereign sheet for the warrior stands in two doctrines (Body and Mind) instead of one mixed list', () => {
    const row = pactTable(content, 'warrior')?.pacts.find((p) => p.def.id === 'sovereign_wrath');
    const groups = pactSkillGroups(row?.skills ?? []);
    expect(groups.map((g) => g.group)).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('the skills list is cut by kind inside a doctrine: basic attack, skills, milestone skills; a one-kind group gets no heading', () => {
    const table = pactTable(content, 'warrior');
    const a = (table?.skills ?? []).filter((s) => s.group === 'a');
    const runs = pactKindRuns(a);
    expect(runs.map((r) => r.kind)).toEqual(['basic', 'active', 'ultimate']);
    expect(runs.every((r) => r.head)).toBe(true);
    expect(runs.flatMap((r) => r.rows.map((s) => s.def.id)).sort()).toEqual(a.map((s) => s.def.id).sort());
    expect(runs[0]?.rows.map((s) => s.def.id)).toEqual([content.classes.find((c) => c.id === 'warrior')?.doctrines[0].basic]);
    expect(runs[2]?.rows.map((s) => s.def.id)).toEqual(expect.arrayContaining(['war_oath', 'mountain_splitter', 'faultline']));
    const shared = pactKindRuns((table?.skills ?? []).filter((s) => s.group === 'common'));
    expect(shared.length).toBe(1);
    expect(shared[0]?.head).toBe(false);
    expect(pactKindRuns([])).toEqual([]);
  });

  it('the shared skills are the sim\'s: a shared skill that is not an active skill is never listed as obtainable', () => {
    const real = content.skills.find((s) => s.classId === 'common');
    expect(real).toBeDefined();
    if (!real) return;
    const extra = (kind: 'basic' | 'ultimate') => ({ ...real, id: `zz_shared_${kind}`, kind });
    const db: ContentDB = { ...content, skills: [...content.skills, extra('basic'), extra('ultimate')] };
    const sim = buildContentIndex(db).commonSkills.map((s) => s.id).sort();
    expect(sim).not.toContain('zz_shared_basic');
    for (const classId of CLASSES) {
      const ids = (pactTable(db, classId)?.skills ?? []).filter((s) => s.group === 'common').map((s) => s.def.id);
      expect(ids.sort(), classId).toEqual(sim);
      expect(ids).not.toContain('zz_shared_basic');
      expect(ids).not.toContain('zz_shared_ultimate');
    }
  });
});

describe('Codex pacts: the table follows balance.pacts', () => {
  const partner = (c: ContentDB): string => c.passives.find((p) => p.maxRank > 2)?.id ?? '';

  it('a changed table changes the lines: the rank is read from balance.pacts and capped at the passive max rank', () => {
    const real = resolvePacts(content.balance.pacts);
    const lowId = content.passives.find((p) => p.maxRank <= 2)?.id ?? '';
    expect(lowId, 'a passive with max rank 2').not.toBe('');
    const byBehavior = { ...real.byBehavior, meleeArc: lowId };
    const t6 = pactTable(withPacts(content, { rank: 6, readyWeight: 1, byBehavior }), 'warrior');
    const arc = t6?.skills.find((s) => s.def.behavior === 'meleeArc');
    expect(arc?.passive?.id).toBe(lowId);
    expect(arc?.need).toBe(2);
    expect(arc ? skillPactLine(arc) : '').toContain(`(rank${NB}2)`);
    const other = t6?.skills.find((s) => s.def.behavior === 'selfBuff');
    expect(other?.need).toBe(Math.min(6, content.passives.find((p) => p.id === real.byBehavior.selfBuff)?.maxRank ?? 6));
    const t1 = pactTable(withPacts(content, { rank: 1, readyWeight: 1, byBehavior }), 'warrior');
    expect(t1?.skills.every((s) => s.need === 1)).toBe(true);
  });

  it('a behaviour left out of the table awakens freely, and its passive turns free', () => {
    const real = resolvePacts(content.balance.pacts);
    const byBehavior = { ...real.byBehavior };
    const lost = byBehavior.summon;
    delete byBehavior.summon;
    const table = pactTable(withPacts(content, { ...real, byBehavior }), 'ninja');
    const shadow = table?.skills.find((s) => s.def.behavior === 'summon');
    expect(shadow?.passive).toBeNull();
    expect(shadow?.need).toBe(0);
    expect(shadow ? skillPactLine(shadow) : '').toBe('Awakens on its own');
    expect(table?.free.some((p) => p.def.id === lost)).toBe(true);
    expect(table?.pacts.some((p) => p.def.id === lost)).toBe(false);
  });

  it('pacts off (rank 0 or absent) = no table and no Pacts page', () => {
    for (const off of [{ rank: 0, readyWeight: 1, byBehavior: {} }, { rank: 0, byBehavior: resolvePacts(content.balance.pacts).byBehavior }, undefined]) {
      const c = withPacts(content, off);
      expect(pactsOn(c)).toBe(false);
      for (const id of CLASSES) expect(pactTable(c, id)).toBeNull();
    }
  });

  it('agrees with the sim: a G2 skill is offered its awakening only while its listed passive is held at the listed rank', () => {
    const fx = cloneContent();
    const id = partner(fx);
    fx.balance.pacts = { rank: 2, readyWeight: 1, byBehavior: { ...Object.fromEntries((['meleeArc', 'cone', 'spinAura'] as const).map((b) => [b, id])) } };
    const table = pactTable(fx, 'warrior');
    const rows = (table?.skills ?? []).filter((s) => s.passive !== null);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const mk = (held: number) => {
        const w = makeWorld({
          content: (c) => {
            c.balance.pacts = fx.balance.pacts;
            c.balance.maxActiveSkills = 0;
            c.balance.maxPassives = 0;
          },
        });
        const p = player(w);
        giveSkill(w, row.def.id, MAX_SKILL_RANK - 1);
        if (held > 0) p.passives.push({ id: row.passive?.id ?? '', rank: held, power: held });
        const cards = [];
        for (let i = 0; i < 40; i++) cards.push(...buildOffer(w, p, { count: w.balance.cardsPerLevel }));
        return cards.some((c) => c.kind === 'skillUp' && c.id === row.def.id && c.awakening);
      };
      expect(mk(0), `${row.def.id} without ${row.passive?.id}`).toBe(false);
      expect(mk(row.need - 1), `${row.def.id} with ${row.passive?.id} one rank short`).toBe(false);
      expect(mk(row.need), `${row.def.id} with ${row.passive?.id} at rank ${row.need}`).toBe(true);
    }
  });
});

describe('Codex pacts: the page is a real Codex page', () => {
  const off = withPacts(content, undefined);

  it('the Codex lists the Pacts page only while the pacts are on', () => {
    expect(codexPages(content)).toEqual(['bestiary', 'metin', 'story', 'pacts']);
    expect(codexPages(off)).toEqual(['bestiary', 'metin', 'story']);
    expect(codexPages(withPacts(content, { rank: 0, readyWeight: 1, byBehavior: {} }))).toEqual(['bestiary', 'metin', 'story']);
  });

  it('the page shown for the shared Armory signal: every page is kept, Pacts falls back to the bestiary while the pacts are off', () => {
    for (const k of ['bestiary', 'metin', 'story'] as const) {
      expect(codexPage(k, content)).toBe(k);
      expect(codexPage(k, off)).toBe(k);
    }
    expect(codexPage('pacts', content)).toBe('pacts');
    expect(codexPage('pacts', off)).toBe('bestiary');
  });

  it('opening the Pacts page sets the shared signal, so it survives a round trip through another Armory tab like the other pages', () => {
    expect(armoryCodexSub.value).toBe('bestiary');
    showCodexPacts({ mode: 'passives', id: 'sovereign_wrath' });
    expect(armoryCodexSub.value).toBe('pacts');
    // Armory.tsx remounts the Codex tab after Character: nothing but seedArmoryState (the Armory opening) resets the signal
    expect(codexPage(armoryCodexSub.value, content)).toBe('pacts');
    armoryCodexSub.value = 'metin';
    expect(codexPage(armoryCodexSub.value, content)).toBe('metin');
  });

  it('only the Pacts page keeps the hero rail on phones (it depends on the viewed hero); the three chronicle pages hand the room back', () => {
    expect(codexNeedsHero('pacts', content)).toBe(true);
    for (const k of ['bestiary', 'metin', 'story'] as const) expect(codexNeedsHero(k, content)).toBe(false);
    // pacts off: a stale 'pacts' shows the bestiary, which does not need the hero
    expect(codexNeedsHero('pacts', off)).toBe(false);
  });

  it('every hero of the rail has a Pacts table (the rail switches the list)', () => {
    const names = CLASSES.map((c) => pactTable(content, c)?.skills.map((s) => s.def.id).join(',') ?? '');
    expect(new Set(names).size).toBe(CLASSES.length);
  });

  it('the group names are the doctrines of the hero (a run holds one of them) and "Shared skills"', () => {
    const cls = content.classes.find((c) => c.id === 'warrior');
    expect(pactGroupName('warrior', 'a', content)).toBe(tl(cls?.doctrines[0].name));
    expect(pactGroupName('warrior', 'b', content)).toBe(tl(cls?.doctrines[1].name));
    expect(pactGroupName('warrior', 'common', content)).toBe('Shared skills');
  });
});

describe('Codex pacts: strings and wiring', () => {
  const keys = Object.keys(dictionaries.en).filter((k) => k.startsWith('codex.pact.'));
  /** the codex.pact.* keys the page names (a template key `codex.pact.kind.${x}` stands for its three skill kinds) */
  const used = (): Set<string> => {
    const out = new Set<string>();
    for (const m of source.matchAll(/['"`](codex\.pact\.[A-Za-z.]+)(\$\{[^}]*\})?/g)) {
      if (m[2]) for (const kind of ['basic', 'active', 'ultimate']) out.add(`${m[1]}${kind}`);
      else out.add(m[1] ?? '');
    }
    return out;
  };

  it('every codex.pact.* string exists in English and Turkish with the same placeholders', () => {
    expect(keys.length).toBeGreaterThan(20);
    const ph = (s: string): string => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort().join(',');
    for (const k of keys) {
      expect(dictionaries.tr[k], `tr ${k}`).toBeTruthy();
      expect(ph(dictionaries.tr[k] ?? ''), k).toBe(ph(dictionaries.en[k] ?? ''));
    }
    expect(Object.keys(dictionaries.tr).filter((k) => k.startsWith('codex.pact.')).sort()).toEqual([...keys].sort());
  });

  it('every codex.pact.* key the page reads exists, and no codex.pact.* string is left unread', () => {
    const read = used();
    expect(read.size).toBeGreaterThan(15);
    for (const k of read) expect(dictionaries.en[k], `en ${k}`).toBeTruthy();
    expect(keys.filter((k) => !read.has(k)), 'strings nothing reads').toEqual([]);
  });

  it('a number stays with its word: "rank N" never breaks inside the parenthesis (no-break space), in English and Turkish', () => {
    for (const lang of ['en', 'tr'] as const) {
      const d = dictionaries[lang];
      for (const k of ['codex.pact.awakensWith', 'codex.pact.without', 'codex.pact.pactRank', 'codex.pact.maxRank']) {
        expect(d[k], `${lang} ${k}`).toMatch(new RegExp(`${NB}\\{(rank|n)\\}`));
        expect(d[k], `${lang} ${k}: no plain space before the number`).not.toMatch(/ \{(rank|n)\}/);
      }
    }
  });

  it('the "without" line says at least: the rule is rank >= need, not exactly that rank', () => {
    expect(dictionaries.en['codex.pact.without']).toContain('or higher');
    expect(dictionaries.tr['codex.pact.without']).toContain('en az');
    expect(dictionaries.en['codex.pact.intro']).toContain('at least');
    expect(dictionaries.tr['codex.pact.intro']).toContain('en az');
  });

  it('every behaviour of the shipped pact table has a name for the behaviour strip', () => {
    for (const b of Object.keys(resolvePacts(content.balance.pacts).byBehavior)) {
      expect(dictionaries.en[`hero.behavior.${b}`], b).toBeTruthy();
      expect(dictionaries.tr[`hero.behavior.${b}`], b).toBeTruthy();
    }
  });
});
