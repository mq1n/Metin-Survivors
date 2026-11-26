// RP-01: the death recap rules (killer, boss strip, next steps), against the REAL shipped content.
import { describe, expect, it } from 'vitest';
import { content } from '../../data/loader';
import { dictionaries } from '../../i18n/i18n';
import runEndSource from './RunEnd.tsx?raw';
import { decodeResult, encodeResult } from '../../net/coop/results';
import type { RunResult } from '../../sim/run';
import { mockRunResult } from '../dev/mock';
import { collectablePieces } from '../../meta/gear';
import { seededRng } from '../../meta/rng';
import { emptyZoneStats, newProfile } from '../../meta/save';
import type { SaveData } from '../../meta/types';
import { bestRefine, bossStrip, deathRecap, fmtSpan, killerOf, nextInputs, nextSteps, type RecapNames } from './runRecap';

const byId = <T extends { id: string }>(list: readonly T[]): Map<string, T> => new Map(list.map((x) => [x.id, x]));
const names: RecapNames = { enemies: byId(content.enemies), bosses: byId(content.bosses), metins: byId(content.metins) };
const yeonmu = content.zones.find((z) => z.id === 'yeonmu')!;
const [cung, jug, young, jin] = yeonmu.bosses.map((b) => b.boss) as [string, string, string, string];
const finalBoss = yeonmu.final.boss;

/** the defeat of the brief: fell at 06:37 (397 s) to a Grizzly Bear, Chan-Dae killed, Dol-Gwan in the arena, Ung-Jae 2:23 away */
const FELL = { time: 401.4, killedAt: 397, killedBy: 'grizzly_bear', nextBoss: { id: young, inSec: 143 }, bossesKilled: [cung] };

describe('the killer of the defeat header', () => {
  it('names a creature, a boss and a metin from their tags', () => {
    expect(killerOf('grizzly_bear', names)).toMatchObject({ kind: 'enemy', id: 'grizzly_bear', name: { en: 'Grizzly Bear' } });
    expect(killerOf(`boss:${young}`, names)).toMatchObject({ kind: 'boss', id: young, name: { en: 'Ung-Jae' } });
    expect(killerOf('metin:metin_murk', names)).toMatchObject({ kind: 'metin', id: 'metin_murk', name: { en: 'Metin of Murk' } });
  });

  it('knows the ground hazards, and treats a hazard kind it has not heard of as a ground hazard', () => {
    expect(killerOf('hazard:lava', names)).toEqual({ kind: 'hazard', id: 'lava' });
    expect(killerOf('hazard:miasma', names)).toEqual({ kind: 'hazard', id: 'miasma' });
    expect(killerOf('hazard:zone', names)).toEqual({ kind: 'hazard', id: 'zone' });
    expect(killerOf('hazard:acid_rain', names)).toEqual({ kind: 'hazard', id: 'zone' });
  });

  it('says nothing for no record, an id the content does not know or a tag in the wrong table (never a raw id)', () => {
    for (const tag of [undefined, '', 'no_such_creature', 'boss:no_such_boss', 'metin:no_such_metin', 'boss:', 'hazard:', 'foo:bar', 'boss:grizzly_bear', young, 'metin:grizzly_bear']) {
      expect(killerOf(tag, names)).toBeNull();
    }
  });
});

describe('the boss strip', () => {
  it('marks defeated, arrived and ahead bosses in arrival order, the final boss last', () => {
    const dots = bossStrip(yeonmu, [cung], 397);
    expect(dots.map((d) => [d.id, d.state, d.final])).toEqual([
      [cung, 'killed', false],
      [jug, 'reached', false],
      [young, 'ahead', false],
      [jin, 'ahead', false],
      [finalBoss, 'ahead', true],
    ]);
    expect(dots.map((d) => d.at)).toEqual([180, 360, 540, 720, 900]);
  });

  it('a boss counts as arrived at its exact second, and a defeated one stays defeated whatever the clock says', () => {
    expect(bossStrip(yeonmu, [], 540).map((d) => d.state)).toEqual(['reached', 'reached', 'reached', 'ahead', 'ahead']);
    expect(bossStrip(yeonmu, [], 539.99).map((d) => d.state)).toEqual(['reached', 'reached', 'ahead', 'ahead', 'ahead']);
    expect(bossStrip(yeonmu, [young], 100)[2]?.state).toBe('killed');
  });

  it('survives a damaged clock: a run clock that is not a number reads as the start', () => {
    expect(bossStrip(yeonmu, [], Number.NaN).map((d) => d.state)).toEqual(['ahead', 'ahead', 'ahead', 'ahead', 'ahead']);
    expect(bossStrip(yeonmu, [], -5).map((d) => d.state)).toEqual(['ahead', 'ahead', 'ahead', 'ahead', 'ahead']);
  });

  it('all five bosses defeated or arrived at the end of the run', () => {
    expect(bossStrip(yeonmu, [cung, jug, young, jin], 905).map((d) => d.state)).toEqual(['killed', 'killed', 'killed', 'killed', 'reached']);
  });
});

describe('the recap of a defeat', () => {
  it('reads the DT-01 record: when, who, which boss comes next, and the strip at that moment', () => {
    const r = deathRecap(FELL, yeonmu, names);
    expect(r.fellAt).toBe(397);
    expect(r.killer).toMatchObject({ kind: 'enemy', id: 'grizzly_bear' });
    expect(r.next).toMatchObject({ kind: 'boss', id: young, inSec: 143, name: { en: 'Ung-Jae' } });
    expect(r.dots?.map((d) => d.state)).toEqual(['killed', 'reached', 'ahead', 'ahead', 'ahead']);
  });

  it('no killer on record: the fall time, the next boss and the strip stay', () => {
    const { killedBy: _k, ...noKiller } = FELL;
    const r = deathRecap(noKiller, yeonmu, names);
    expect(r.killer).toBeNull();
    expect(r.fellAt).toBe(397);
    expect(r.next).toMatchObject({ kind: 'boss', id: young });
    expect(r.dots).toHaveLength(5);
  });

  it('a result from before the record has no line, only the strip, placed by the run time', () => {
    const r = deathRecap({ time: 401.4, bossesKilled: [cung] }, yeonmu, names);
    expect(r.fellAt).toBeNull();
    expect(r.killer).toBeNull();
    expect(r.next).toBeNull();
    expect(r.dots?.map((d) => d.state)).toEqual(['killed', 'reached', 'ahead', 'ahead', 'ahead']);
  });

  it('a wire result that lost the next-boss field gets it from the zone schedule', () => {
    const { nextBoss: _n, ...lost } = FELL;
    expect(deathRecap(lost, yeonmu, names).next).toMatchObject({ kind: 'boss', id: young, inSec: 143 });
    // between the fourth boss and the final one the final boss is next
    expect(deathRecap({ ...lost, killedAt: 800 }, yeonmu, names).next).toMatchObject({ kind: 'boss', id: finalBoss, inSec: 100 });
  });

  it('once the final boss has arrived there is no next boss: the line says so', () => {
    const r = deathRecap({ time: 936, killedAt: 932, killedBy: `boss:${finalBoss}`, bossesKilled: [cung, jug, young, jin] }, yeonmu, names);
    expect(r.next).toMatchObject({ kind: 'final', id: finalBoss });
    expect(r.killer).toMatchObject({ kind: 'boss', id: finalBoss });
    expect(r.dots?.map((d) => d.state)).toEqual(['killed', 'killed', 'killed', 'killed', 'reached']);
  });

  it('a boss id the content does not know is not named; a zone it does not know has no strip', () => {
    expect(deathRecap({ ...FELL, nextBoss: { id: 'boss_from_the_future', inSec: 30 } }, yeonmu, names).next).toBeNull();
    const r = deathRecap(FELL, undefined, names);
    expect(r.dots).toBeNull();
    expect(r.next).toMatchObject({ kind: 'boss', id: young });
    expect(deathRecap({ ...FELL, nextBoss: undefined }, undefined, names).next).toBeNull();
  });

  it('survives damaged numbers', () => {
    expect(deathRecap({ ...FELL, killedAt: Number.NaN }, yeonmu, names).fellAt).toBeNull();
    expect(deathRecap({ ...FELL, killedAt: -3 }, yeonmu, names).fellAt).toBe(0);
    expect(deathRecap({ ...FELL, nextBoss: { id: young, inSec: Number.NaN } }, yeonmu, names).next).toMatchObject({ kind: 'boss', id: young, inSec: 143 });
  });
});

describe('the recap on a co-op guest', () => {
  const fallen = [{ index: 0, level: 22, kills: 900, yeop: 100, alive: false }, { index: 1, level: 20, kills: 580, yeop: 100, alive: false }];
  const wire = (r: RunResult): RunResult => decodeResult(JSON.parse(JSON.stringify(encodeResult(r)))) as RunResult;

  it('reads the same line, strip and next boss from the wire as the host does', () => {
    const host = mockRunResult(content, { victory: false, players: fallen, ...FELL });
    expect(deathRecap(wire(host), yeonmu, names)).toEqual(deathRecap(host, yeonmu, names));
  });

  it('a result from an older host (no record on the wire) still gets its strip', () => {
    const old = mockRunResult(content, { victory: false, players: fallen, time: 401.4, bossesKilled: [cung] });
    const r = deathRecap(wire(old), yeonmu, names);
    expect(r.fellAt).toBeNull();
    expect(r.killer).toBeNull();
    expect(r.dots?.map((d) => d.state)).toEqual(['killed', 'reached', 'ahead', 'ahead', 'ahead']);
  });

  it('a boss tag the wire refuses leaves no killer and no raw id', () => {
    const w = JSON.parse(JSON.stringify(encodeResult(mockRunResult(content, { victory: false, players: fallen, ...FELL }))));
    w.kb = 'boss:' + 'x'.repeat(80);
    const r = deathRecap(decodeResult(w) as RunResult, yeonmu, names);
    expect(r.killer).toBeNull();
    expect(r.fellAt).toBe(397);
  });
});

describe('fmtSpan', () => {
  it('shows a span as m:ss', () => {
    expect(fmtSpan(143)).toBe('2:23');
    expect(fmtSpan(142.97)).toBe('2:23');
    expect(fmtSpan(0)).toBe('0:00');
    expect(fmtSpan(59.4)).toBe('0:59');
    expect(fmtSpan(3600)).toBe('60:00');
    expect(fmtSpan(-4)).toBe('0:00');
    expect(fmtSpan(Number.NaN)).toBe('0:00');
  });
});

describe('next steps', () => {
  const profile = (): SaveData => newProfile(content, { now: 1_700_000_000_000, rng: seededRng(1), name: 'T' });
  const warriorPieces = collectablePieces(content, 'warrior');

  it('lists what is waiting first, then the refine, then the favour', () => {
    const refine = { gearId: 'x', from: 0, to: 1, rate: 1, yeop: 500, shards: 1, equipped: true };
    expect(nextSteps({ talentPoints: 3, refine, favour: 0.09 })).toEqual([
      { kind: 'talents', points: 3 },
      { kind: 'smith', offer: refine },
      { kind: 'favour', pct: 9 },
    ]);
    expect(nextSteps({ talentPoints: 0, refine: null, favour: 0 })).toEqual([]);
    expect(nextSteps({ talentPoints: 0, refine, favour: 0 }).map((s) => s.kind)).toEqual(['smith']);
  });

  it('shows the favour in whole percent, only from one percent up, and survives bad numbers', () => {
    expect(nextSteps({ talentPoints: 0, refine: null, favour: 0.15 })).toEqual([{ kind: 'favour', pct: 15 }]);
    expect(nextSteps({ talentPoints: 0, refine: null, favour: 0.004 })).toEqual([]);
    expect(nextSteps({ talentPoints: Number.NaN, refine: null, favour: Number.NaN })).toEqual([]);
    expect(nextSteps({ talentPoints: 2.9, refine: null, favour: 0 })).toEqual([{ kind: 'talents', points: 2 }]);
    expect(nextSteps({ talentPoints: -1, refine: null, favour: 0 })).toEqual([]);
  });

  it('points at a refine only when the bank covers one', () => {
    const save = profile();
    save.classes.warrior.collection = warriorPieces.slice(0, 2).map((d) => d.id);
    save.bank = { yeop: 0, shards: 0 };
    expect(bestRefine(save, content, 'warrior')).toBeNull();
    save.bank = { yeop: 10_000, shards: 0 };
    expect(bestRefine(save, content, 'warrior')).toBeNull(); // Yeop alone is not enough: shards too
    save.bank = { yeop: 10_000, shards: 5 };
    expect(bestRefine(save, content, 'warrior')).toMatchObject({ from: 0, to: 1, rate: 1, yeop: 500, shards: 1 });
  });

  it('prefers an equipped piece, then the better chance', () => {
    const save = profile();
    const [a, b] = warriorPieces.filter((d) => d.slot !== warriorPieces[0]?.slot).length > 0 ? [warriorPieces[0]!, warriorPieces.find((d) => d.slot !== warriorPieces[0]!.slot)!] : [warriorPieces[0]!, warriorPieces[1]!];
    save.classes.warrior.collection = [a.id, b.id];
    save.classes.warrior.gear = { [b.slot]: b.id };
    save.classes.warrior.plus = { [b.id]: 4, [a.id]: 0 }; // the equipped piece is the dearer, worse-odds refine; it still comes first
    save.bank = { yeop: 100_000, shards: 100 };
    expect(bestRefine(save, content, 'warrior')).toMatchObject({ gearId: b.id, from: 4, equipped: true });
    save.classes.warrior.gear = {};
    expect(bestRefine(save, content, 'warrior')).toMatchObject({ gearId: a.id, from: 0, rate: 1, equipped: false });
  });

  it('skips pieces at +9 and classes without a profile entry', () => {
    const save = profile();
    const a = warriorPieces[0]!;
    save.classes.warrior.collection = [a.id];
    save.classes.warrior.plus = { [a.id]: 9 };
    save.bank = { yeop: 1e6, shards: 1e4 };
    expect(bestRefine(save, content, 'warrior')).toBeNull();
    expect(bestRefine(save, content, 'no_such_class' as never)).toBeNull();
  });

  it('reads the favour of the next attempt from the settled profile: 3 % a failed attempt, none once the zone is cleared', () => {
    const save = profile();
    const run = { classId: 'warrior', zone: 'yeonmu', difficulty: 'normal' } as const;
    save.stats.zones.yeonmu = { normal: { ...emptyZoneStats(), runs: 3 } };
    expect(nextInputs(save, content, run, 4)).toMatchObject({ talentPoints: 4, favour: expect.closeTo(0.09, 9) });
    save.stats.zones.yeonmu = { normal: { ...emptyZoneStats(), runs: 3, clears: 1 } };
    expect(nextInputs(save, content, run, 0).favour).toBe(0);
    // Hard keeps its own count
    save.stats.zones.yeonmu = { normal: { ...emptyZoneStats(), runs: 3, clears: 1 }, hard: { ...emptyZoneStats(), runs: 6 } };
    expect(nextInputs(save, content, { ...run, difficulty: 'hard' }, 0).favour).toBeCloseTo(0.15, 9);
  });
});


describe('the recap strings', () => {
  // t('...') keys are checked by ui/i18n.test.ts; the lines built with tNodes() and the plural pair of tn() are read from the source here
  const used = new Set<string>();
  for (const m of runEndSource.matchAll(/'(report\.[A-Za-z.]+)'/g)) used.add(m[1] ?? '');

  it('the report uses recap strings at all', () => {
    expect(used.size).toBeGreaterThan(15);
  });

  it('every key the report names exists in both languages (a count key as its .one / .other pair)', () => {
    const missing: string[] = [];
    for (const key of used) {
      const keys = key in dictionaries.en || key in dictionaries.tr ? [key] : [`${key}.one`, `${key}.other`];
      for (const k of keys) for (const lang of ['en', 'tr'] as const) if (!(k in dictionaries[lang])) missing.push(`${lang}:${k}`);
    }
    expect(missing).toEqual([]);
  });

  it('every slot of a line is filled by the caller in both languages', () => {
    const slots: Record<string, string[]> = {
      'report.fell.killer': ['time', 'killer'],
      'report.fell.nokiller': ['time'],
      'report.fell.next': ['span', 'boss'],
      'report.fell.final': ['boss'],
    };
    for (const lang of ['en', 'tr'] as const) {
      for (const [key, want] of Object.entries(slots)) {
        const got = [...(dictionaries[lang][key] ?? '').matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
        expect({ lang, key, got }).toEqual({ lang, key, got: [...want].sort() });
      }
    }
  });
});
