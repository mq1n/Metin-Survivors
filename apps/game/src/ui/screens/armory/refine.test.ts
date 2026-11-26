import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fixtureContent } from '../../../meta/__fixtures__/content';
import { freshSave } from '../../../meta/__fixtures__/testkit';
import { quoteUpgrade } from '../../../meta/blacksmith';
import { chainState, plusBand, ratePoints, rateTone, reserveNumberShown, scrollIsChip, scrollToastKey, scrollView, scrollWish } from './refine';

describe('refine helpers', () => {
  it('maps success chances to palette tones at the documented edges', () => {
    expect(rateTone(1)).toBe('good');
    expect(rateTone(0.7)).toBe('good');
    expect(rateTone(0.69)).toBe('mid');
    expect(rateTone(0.4)).toBe('mid');
    expect(rateTone(0.39)).toBe('bad');
    expect(rateTone(0)).toBe('bad');
  });
  it('bands the +0..+9 chain', () => {
    expect([0, 1, 3].map(plusBand)).toEqual([1, 1, 1]);
    expect([4, 5, 6].map(plusBand)).toEqual([2, 2, 2]);
    expect([7, 8].map(plusBand)).toEqual([3, 3]);
    expect(plusBand(9)).toBe(4);
  });
  it('lights the grade chain of a talent node', () => {
    expect(chainState(0, 3, true)).toEqual({ lit: 0, next: 0 });
    expect(chainState(2, 3, true)).toEqual({ lit: 2, next: 2 });
    expect(chainState(3, 3, true)).toEqual({ lit: 3, next: -1 });
    expect(chainState(2, 3, false)).toEqual({ lit: 2, next: -1 });
    expect(chainState(9, 3, true).lit).toBe(3);
    expect(chainState(-1, 3, false).lit).toBe(0);
  });
});

/** the scroll side of a quote with the normal campaign done and spare Yeop (what the tests below bend) */
const OPEN = { rate: 0.7, yeop: 16_500, gain: 0.15, useful: true, canAfford: true, available: true, spare: true, plainAttempts: 2, spareShort: 0 };

describe('Blessing Scroll view', () => {
  const scroll = OPEN;
  it('counts whole points, rounding the float noise away', () => {
    expect(ratePoints(0.55, 0.7)).toBe(15);
    expect(ratePoints(0.9, 1)).toBe(10);
    expect(ratePoints(1, 1)).toBe(0);
    expect(ratePoints(0.5, 0.3)).toBe(0);
  });
  it('off / on follow the switch while the scroll is useful, spare and paid for', () => {
    expect(scrollView(scroll, false, 60_000)).toEqual({ state: 'off', active: false, enabled: true, points: 15, shortYeop: 0 });
    expect(scrollView(scroll, true, 60_000)).toEqual({ state: 'on', active: true, enabled: true, points: 15, shortYeop: 0 });
    expect(scrollView(scroll, true, 16_500).active).toBe(true); // exactly 3x is enough when the quote says it is spare
  });
  it('is never active when the bank cannot pay it and no plain attempt waits on the Yeop (no shards for one), with the missing Yeop to show', () => {
    const noShards = { ...scroll, plainAttempts: 0, spare: true };
    expect(scrollView(noShards, true, 16_499)).toEqual({ state: 'short', active: false, enabled: false, points: 15, shortYeop: 1 });
    expect(scrollView(noShards, false, 0)).toMatchObject({ state: 'short', active: false, shortYeop: 16_500 });
  });
  it('is never active on a certain step or a finished piece, however the switch is set', () => {
    expect(scrollView({ ...scroll, rate: 1, yeop: 1500, gain: 0, useful: false }, true, 1e6)).toEqual({ state: 'capped', active: false, enabled: false, points: 0, shortYeop: 0 });
    expect(scrollView(null, true, 1e6)).toEqual({ state: 'none', active: false, enabled: false, points: 0, shortYeop: 0 });
  });
  it('shows the capped gain of a step just under 100 % (90 % + 15 points = +10)', () => {
    expect(scrollView({ ...scroll, rate: 1, yeop: 6000, gain: 0.1 }, true, 9000).points).toBe(10);
  });
});

describe('Blessing Scroll view: locked until the normal campaign is complete', () => {
  const locked = { ...OPEN, available: false };
  const LOCKED = { state: 'locked', active: false, enabled: false, points: 0, shortYeop: 0 };

  it('is greyed and never active, however the switch is set and however rich the bank is', () => {
    expect(scrollView(locked, false, 1e9)).toEqual(LOCKED);
    expect(scrollView(locked, true, 1e9)).toEqual(LOCKED);
    expect(scrollView(locked, true, 0)).toEqual(LOCKED);
  });

  it('locked comes before capped, reserve and short (a certain step or a poor bank still reads "opens after the campaign")', () => {
    expect(scrollView({ ...locked, rate: 1, gain: 0, useful: false }, true, 1e9)).toEqual(LOCKED);
    expect(scrollView({ ...locked, spare: false, spareShort: 9_000 }, true, 100)).toEqual(LOCKED);
    expect(scrollView(locked, false, 100)).toEqual(LOCKED);
  });

  it('opens the moment the quote says available (the clear of the last zone): the same quote, now an ordinary switch', () => {
    expect(scrollView({ ...locked, available: true }, false, 1e9)).toEqual({ state: 'off', active: false, enabled: true, points: 15, shortYeop: 0 });
    expect(scrollView({ ...locked, available: true }, true, 1e9)).toMatchObject({ state: 'on', active: true });
  });

  it('a missing quote is still "none", not locked', () => {
    expect(scrollView(null, true, 1e9).state).toBe('none');
  });
});

describe('Blessing Scroll view: spare Yeop only (the reserve state)', () => {
  // +4 step: 5 500 Yeop, 8 shards; 20 shards pay 2 plain attempts, so the reserve is 5 500 x 4 = 22 000 and the scroll costs 16 500
  const tight = { ...OPEN, spare: false, plainAttempts: 2, spareShort: 4_000 };

  it('is greyed with the missing Yeop when the Yeop is still needed by plain attempts, even though the bank can pay the 3x price', () => {
    // 18 000 Yeop pays the 16 500 scroll, but not the reserve of 22 000
    expect(scrollView(tight, false, 18_000)).toEqual({ state: 'reserve', active: false, enabled: false, points: 15, shortYeop: 4_000 });
    expect(scrollView(tight, true, 18_000)).toMatchObject({ state: 'reserve', active: false, enabled: false });
  });

  it('shows the whole way to the reserve, not only to the price: a bank below 3x still reads reserve while plain attempts wait', () => {
    expect(scrollView({ ...tight, spareShort: 20_000 }, true, 2_000)).toMatchObject({ state: 'reserve', shortYeop: 20_000 });
  });

  it('opens at exactly the reserve (spare: the quote says so) and not a Yeop before', () => {
    expect(scrollView({ ...tight, spareShort: 1 }, true, 21_999).state).toBe('reserve');
    expect(scrollView({ ...OPEN }, false, 22_000)).toMatchObject({ state: 'off', enabled: true });
    expect(scrollView({ ...OPEN }, true, 22_000)).toMatchObject({ state: 'on', active: true });
  });

  it('with shards for no plain attempt nothing waits on the Yeop: the plain rule (short of the price) applies, not the reserve', () => {
    expect(scrollView({ ...tight, plainAttempts: 0, spare: false, spareShort: 11_000 }, true, 11_000)).toMatchObject({ state: 'short', shortYeop: 5_500 });
    expect(scrollView({ ...OPEN, plainAttempts: 0 }, false, 99_000)).toMatchObject({ state: 'off', enabled: true });
  });

  it('the order of the states: none, locked, capped, reserve, short, off / on', () => {
    const t = { ...OPEN, available: true, useful: true, spare: false, plainAttempts: 1, spareShort: 5 };
    expect(scrollView({ ...t, useful: false }, true, 1).state).toBe('capped');
    expect(scrollView(t, true, 1).state).toBe('reserve');
    expect(scrollView({ ...t, spare: true, spareShort: 0 }, true, 1).state).toBe('short');
    expect(scrollView({ ...t, spare: true, spareShort: 0 }, true, 1e9).state).toBe('on');
  });
});

describe('Blessing Scroll wish: the switch turns itself off when the purse runs short or the Yeop is reserved, and stays off', () => {
  const scroll = OPEN;

  it('keeps the wish in every state where the knob can show it', () => {
    expect(scrollWish(scrollView(scroll, true, 1e6), true)).toBe(true); // on
    expect(scrollWish(scrollView(scroll, false, 1e6), false)).toBe(false); // off
    expect(scrollWish(scrollView({ ...scroll, rate: 1, gain: 0, useful: false }, true, 1e6), true)).toBe(true); // capped: the choice stands for the next step
    expect(scrollWish(scrollView(null, true, 1e6), true)).toBe(true); // none
  });

  it('drops the wish when the view is short, reserve or locked (the knob shows off and cannot be pressed there)', () => {
    expect(scrollWish(scrollView({ ...scroll, plainAttempts: 0 }, true, 16_499), true)).toBe(false); // short
    expect(scrollWish(scrollView({ ...scroll, spare: false, spareShort: 100 }, true, 1e6), true)).toBe(false); // reserve
    expect(scrollWish(scrollView({ ...scroll, available: false }, true, 1e6), true)).toBe(false); // locked
  });

  it('a wish written while the view is locked or reserved is taken back by the next settle (the effect also depends on the switch)', () => {
    // Blacksmith.tsx settles `scrollWanted` to `scrollWish(view, scrollWanted)` in an effect keyed on [wish, scrollWanted]: a wish that is
    // set while the derived wish is already false (locked / reserve) changes the second key and runs it again
    const settle = (view: ReturnType<typeof scrollView>, wanted: boolean): boolean => scrollWish(view, wanted);
    const lockedView = (w: boolean) => scrollView({ ...scroll, available: false }, w, 1e9);
    let wanted = false;
    let ran = 0;
    let lastKey: [boolean, boolean] | null = null;
    const render = (): void => {
      const wish = settle(lockedView(wanted), wanted);
      const key: [boolean, boolean] = [wish, wanted];
      if (!lastKey || lastKey[0] !== key[0] || lastKey[1] !== key[1]) {
        ran++;
        if (wanted !== wish) wanted = wish;
      }
      lastKey = key;
    };
    render();
    wanted = true; // written while locked
    render();
    expect(wanted).toBe(false);
    expect(ran).toBe(2);
    // with the old key [wish] alone the effect would not have run: wish stayed false
    expect(settle(lockedView(true), true)).toBe(false);
  });

  it('flow: a blessed attempt uses up the spare Yeop, the view drops to reserve, the wish goes, and the Yeop coming back does not re-arm it', () => {
    let wanted = true;
    // 1 the switch is on and the quote is spare (bank 40 000 >= reserve 22 000)
    expect(scrollView(scroll, wanted, 40_000)).toMatchObject({ state: 'on', active: true });
    // 2 the blessed attempt spent 16 500 and 8 shards: 23 500 Yeop, 12 shards = 1 plain attempt, reserve 3 x 5 500 = 16 500 -> still spare;
    //   a second one leaves 7 000 Yeop and 4 shards (no plain attempt by shards): 'short' of the 16 500 price
    const afterTwo = scrollView({ ...scroll, plainAttempts: 0, spare: true }, wanted, 7_000);
    expect(afterTwo).toMatchObject({ state: 'short', active: false, enabled: false });
    // 3 the UI takes the wish back (what its effect does with `scrollWish`): the knob and the wish agree
    wanted = scrollWish(afterTwo, wanted);
    expect(wanted).toBe(false);
    // 4 a run pays out: the switch comes back as OFF, not as a 3x price nobody asked for
    const refilled = scrollView(scroll, wanted, 7_000 + 60_000);
    expect(refilled).toMatchObject({ state: 'off', active: false, enabled: true });
    expect(scrollWish(refilled, wanted)).toBe(false);
    // 5 and the player can still choose it
    expect(scrollView(scroll, true, 67_000)).toMatchObject({ state: 'on', active: true });
  });

  it('flow: the Yeop a blessed attempt took drops the next view to reserve and the wish with it', () => {
    let wanted = true;
    // bank 22 000, 20 shards: spare (reserve 22 000). The attempt costs 16 500 and 8 shards: 5 500 Yeop, 12 shards = 1 plain attempt, reserve 16 500
    const next = scrollView({ ...scroll, spare: false, plainAttempts: 1, spareShort: 11_000 }, wanted, 5_500);
    expect(next).toMatchObject({ state: 'reserve', shortYeop: 11_000 });
    wanted = scrollWish(next, wanted);
    expect(wanted).toBe(false);
    expect(scrollView({ ...scroll, spare: true, plainAttempts: 1, spareShort: 0 }, wanted, 40_000)).toMatchObject({ state: 'off' });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// MT-03-redo fix round 1 (critic r1 M3): the dormant states are quiet. A late bank sits in 'reserve' for good, so the plate must not
// be a wall of numbers (wide container) nor squeeze the success gauge (narrow container), and each greyed state explains itself on a tap.

describe("Blessing Scroll: which states are the narrow container's charm chip", () => {
  it('every state that cannot be pressed is a chip; only on / off are the full plate', () => {
    for (const st of ['locked', 'reserve', 'short', 'capped', 'none'] as const) expect(scrollIsChip(st)).toBe(true);
    for (const st of ['on', 'off'] as const) expect(scrollIsChip(st)).toBe(false);
  });

  it('follows scrollView: a chip exactly when the switch is not enabled (a switch that can be pressed is never a chip)', () => {
    const cases: [ReturnType<typeof scrollView>, boolean][] = [
      [scrollView(OPEN, false, 60_000), false], // off
      [scrollView(OPEN, true, 60_000), false], // on
      [scrollView({ ...OPEN, available: false }, true, 60_000), true], // locked
      [scrollView({ ...OPEN, spare: false, spareShort: 4_000 }, true, 18_000), true], // reserve
      [scrollView({ ...OPEN, plainAttempts: 0 }, true, 100), true], // short
      [scrollView({ ...OPEN, rate: 1, gain: 0, useful: false }, true, 60_000), true], // capped
      [scrollView(null, true, 60_000), true], // none (draws no plate)
    ];
    for (const [view, chip] of cases) {
      expect(scrollIsChip(view.state)).toBe(chip);
      expect(chip).toBe(!view.enabled);
    }
  });
});

describe('Blessing Scroll: the tap toast of every state that cannot be pressed', () => {
  it('names a message for locked, reserve, short and capped, and none for the states that are pressed', () => {
    expect(scrollToastKey('locked')).toBe('smith.fail.scrollLocked');
    expect(scrollToastKey('reserve')).toBe('smith.scroll.reserveToast');
    expect(scrollToastKey('short')).toBe('smith.scroll.shortToast');
    expect(scrollToastKey('capped')).toBe('smith.scroll.cappedToast');
    for (const st of ['on', 'off', 'none'] as const) expect(scrollToastKey(st)).toBeNull();
  });

  it('the messages exist in English and Turkish with the same placeholders', () => {
    const dir = fileURLToPath(new URL('../../../i18n/parts/', import.meta.url));
    const en = JSON.parse(readFileSync(`${dir}up_smith.en.json`, 'utf8')) as Record<string, string>;
    const tr = JSON.parse(readFileSync(`${dir}up_smith.tr.json`, 'utf8')) as Record<string, string>;
    const holes = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string).sort();
    for (const st of ['locked', 'reserve', 'short', 'capped'] as const) {
      const key = scrollToastKey(st) as string;
      expect(en[key], `en ${key}`).toBeTruthy();
      expect(tr[key], `tr ${key}`).toBeTruthy();
      expect(holes(tr[key] as string)).toEqual(holes(en[key] as string));
    }
    // the short toast quotes the price and the missing Yeop; the reserve toast the missing Yeop
    expect(holes(en['smith.scroll.shortToast'] as string)).toEqual(['n', 'yeop']);
    expect(holes(en['smith.scroll.reserveToast'] as string)).toEqual(['n']);
  });
});

describe('Blessing Scroll: the reserve line prints a number only while the missing Yeop is within reach', () => {
  it('shows it while it is no more than the bank holds, and says "plain attempts first" beyond that', () => {
    expect(reserveNumberShown(4_000, 18_000)).toBe(true);
    expect(reserveNumberShown(11_000, 11_000)).toBe(true); // exactly the bank: still a goal
    expect(reserveNumberShown(11_001, 11_000)).toBe(false);
    expect(reserveNumberShown(595_506, 16_494)).toBe(false);
    expect(reserveNumberShown(1, 0)).toBe(false); // an empty purse never reads a number
  });

  it('on real quotes: the late-meta banks read "plain attempts first", a bank near its reserve keeps the number', () => {
    const W = 'yeonmu_weapon_warrior';
    const view = (plus: number, yeop: number, shards: number) => {
      const s = freshSave();
      s.classes.warrior.collection.push(W);
      s.classes.warrior.gear.weapon = W;
      if (plus > 0) s.classes.warrior.plus[W] = plus;
      s.bank.yeop = yeop;
      s.bank.shards = shards;
      const zones = fixtureContent.zones.slice().sort((a, b) => a.order - b.order);
      const last = zones[zones.length - 1];
      if (last) s.stats.zones[last.id] = { normal: { runs: 1, clears: 1, bestScore: 0, bestTime: 0, bestLevel: 0 } };
      const q = quoteUpgrade(s, fixtureContent, 'warrior', W);
      if (!q.ok) throw new Error('quote');
      const v = scrollView(q.quote.scroll, true, yeop);
      return { v, shown: reserveNumberShown(v.shortYeop, yeop), chip: scrollIsChip(v.state) };
    };
    // the critic's realistic banks (r1 captures): +7 at 16,494 Yeop / 857 shards, +5 at 250,000 / 1,966
    expect(view(7, 16_494, 857)).toMatchObject({ v: { state: 'reserve', shortYeop: 595_506 }, shown: false, chip: true });
    expect(view(5, 250_000, 1_966)).toMatchObject({ v: { state: 'reserve', shortYeop: 1_070_000 }, shown: false, chip: true });
    // a bank that is close: +4 at 18,000 / 20 shards misses 4,000 of the 22,000 reserve
    expect(view(4, 18_000, 20)).toMatchObject({ v: { state: 'reserve', shortYeop: 4_000 }, shown: true, chip: true });
    // the boundary of the line: +4 with 20 shards has a reserve of 22,000, so a bank of 11,000 misses exactly 11,000 (shown), 10,999 misses 11,001 (not)
    expect(view(4, 11_000, 20)).toMatchObject({ v: { state: 'reserve', shortYeop: 11_000 }, shown: true });
    expect(view(4, 10_999, 20)).toMatchObject({ v: { state: 'reserve', shortYeop: 11_001 }, shown: false });
    // at the reserve the plate is an ordinary switch: no chip, no reserve line
    expect(view(4, 22_000, 20)).toMatchObject({ v: { state: 'on' }, chip: false });
  });
});

describe('Blessing Scroll: the window wires the chip, the toast and the quiet reserve line (source checks)', () => {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const tsx = readFileSync(`${here}Blacksmith.tsx`, 'utf8').replace(/\r\n/g, '\n');
  const css = readFileSync(`${here}blacksmith.css`, 'utf8').replace(/\r\n/g, '\n');

  it("the plate carries the chip class from scrollIsChip and a tap on a plate that cannot be pressed pushes that state's toast", () => {
    expect(tsx).toContain("scrollIsChip(view.state) ? 'sm-scroll--chip' : ''");
    expect(tsx).toContain('scrollToastKey(scrollV.state)');
    expect(tsx).toContain('reserveNumberShown(view.shortYeop, bankYeop)');
    expect(tsx).toContain("t('smith.scroll.reserveFirst')");
  });

  it('the reserve tooltip formats the count of plain attempts (no raw 1211 next to 1,000)', () => {
    expect(tsx).toContain('n: fmtInt(scroll.plainAttempts)');
    expect(tsx).not.toContain('n: scroll.plainAttempts');
  });

  it('the narrow container (portrait phone) draws the chip alone: text, rates and switch are hidden, the tap target is kept', () => {
    const start = css.indexOf('@container sm (max-width: 29.99rem) {');
    expect(start).toBeGreaterThan(0);
    const end = css.indexOf('\n}\n', start);
    const block = css.slice(start, end);
    expect(block).toMatch(/\.sm-scroll--chip \{[^}]*grid-template-areas: 'ic';[^}]*min-width: var\(--k-tap/);
    expect(block).toMatch(/\.sm-scroll--chip \.sm-scroll-t,\s*\.sm-scroll--chip \.sm-scroll-r,\s*\.sm-scroll--chip \.sm-scroll-sw \{\s*display: none;/);
    expect(block).toMatch(/\.sm-scroll--chip \.sm-scroll-ic \{\s*display: grid;/);
    // no state-specific plate text rule is left in the block: reserve / short never get a words-and-number plate there
    expect(block).not.toMatch(/\.sm-scroll--(reserve|short|capped|locked) \.sm-scroll-(s|r)/);
  });

  it('guards Turkish diacritic height on .sm-scroll-s and landscape phone safe-area compact rules', () => {
    expect(css).toMatch(/\.sm-scroll-s \{[^}]*line-height:\s*1\.35;/);
    expect(css).toContain('.ms-compact.ms-landscape .sm-scroll:not(.sm-scroll--chip)');
    expect(css).toContain('.ms-compact.ms-landscape .sm-scroll--chip');
  });

  it('no string of the scroll is left unused (the dead short forms are gone)', () => {
    const dir = fileURLToPath(new URL('../../../i18n/parts/', import.meta.url));
    const en = JSON.parse(readFileSync(`${dir}up_smith.en.json`, 'utf8')) as Record<string, string>;
    const src = tsx + readFileSync(`${here}refine.ts`, 'utf8');
    for (const key of Object.keys(en)) {
      // refusal reasons are looked up as smith.fail.<reason> and the result / log lines by their own template
      if (key.startsWith('smith.fail.') || key.startsWith('smith.result.') || key === 'smith.log.scroll') continue;
      expect(src, key).toContain(key);
    }
    for (const gone of ['lockedShort', 'cappedShort', 'shortShort', 'reserveShort']) expect(en[`smith.scroll.${gone}`]).toBeUndefined();
  });
});
