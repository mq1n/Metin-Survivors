// First-time hints (HD-01): each hint shows once per profile, `showHints` off hides all of them, "Reset hints" brings them back, the
// awakening hint reads the real clock (90 s by default, 60 s on hard), a hint waits for a free screen (modal, banner, dead hero) and never
// replaces a boss / big banner, and the wiring (attachHints) follows the sim events, the HUD snapshot and the modal state.
// A hint is spent only when it was read: it is recorded after HINT_READ_MS of being readable (on screen, no modal, hero alive); a modal,
// a death, the pause menu or a replacing banner before that takes the plate back and queues the same hint again, first in line, for its
// full time; the breather between two hints starts when the previous plate has LEFT the screen.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameStore } from '../../app/store';
import type { ContentDB } from '../../data/schema';
import { settings } from '../../engine/settings';
import { dictionaries } from '../../i18n/i18n';
import type { SimEvent } from '../../sim/events';
import { runEventHudOf } from '../../sim/runEvents';
import type { HudSnapshot } from '../../sim/types';
import { setDeps, type UiDeps } from '../env';
import { announce, announcements, attachAnnounceFeed, clearAnnouncements, eventBanner, EVENT_STYLE, hintPlates, hintShown, withdrawHint, type Announcement } from './announce';
import {
  attachHints,
  bandIndexAt,
  CORRUPTION_HINT_AT,
  fmtAwakenTime,
  HINT_GAP_MS,
  HINT_IDS,
  HINT_QUEUE_MS,
  HINT_READ_MS,
  HINT_SETTLE_EVENT_MS,
  HINT_SETTLE_MS,
  HINT_TTL_MS,
  Hints,
  pactLineOf,
  type HintHost,
  type HintHud,
  type HintId,
  type HintPlate,
  type HintPlates,
} from './hints';

const ev = (e: Record<string, unknown>): SimEvent => e as unknown as SimEvent;
const hud = (over: Partial<HintHud> = {}): HintHud => ({ alive: true, corruption: 0, rerolls: 2, banishes: 1, ...over });

class MemStorage {
  private readonly m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v);
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemStorage());
  settings.update({ language: 'en', showHints: true, hintsSeen: [] });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  settings.update({ showHints: true, hintsSeen: [] });
});

/**
 * A controller on a fake screen: a clock, a feed that holds the hint plate for its time (like announce.ts: `show` puts it up, it runs
 * out after `ttlMs`, `withdraw` takes it off), an "other banner on" flag, a "modal open" flag, the metin table. `wait` moves the clock in
 * 100 ms steps and pumps at each (the wiring does at every 10 Hz HUD snapshot); `jump` moves it without a pump (a throttled tab).
 */
function rig(over: Partial<HintHost> = {}) {
  type Log = { what: 'show' | 'gone' | 'withdraw'; id: string; at: number };
  const r = {
    clock: 1000,
    plate: false,
    covered: false,
    mul: 1,
    shown: [] as HintPlate[],
    feed: null as { id: string; until: number } | null,
    log: [] as Log[],
  };
  const host: HintHost = {
    now: () => r.clock,
    show: (p) => {
      r.shown.push(p);
      r.feed = { id: p.id, until: r.clock + p.ttlMs };
      r.log.push({ what: 'show', id: p.id, at: r.clock });
    },
    plateOn: () => r.plate || r.feed !== null,
    hintOn: (id) => r.feed?.id === id,
    withdraw: (id) => {
      if (r.feed?.id !== id) return;
      r.feed = null;
      r.log.push({ what: 'withdraw', id, at: r.clock });
    },
    hudCovered: () => r.covered,
    awakenAfter: (d) => (d === 'metin_a' ? 90 : d === 'metin_b' ? 45 : undefined),
    awakenMul: () => r.mul,
    // HD-03: pacts on (an offer card with a pact line gives the words), affixes on from band 1, bands start at 0 / 180 / 360 s
    pactLine: (cards) => (cards.some((c) => c.needs !== undefined || c.pact !== undefined) ? { passive: 'Dragon Wrath', skill: 'Bladewheel', rank: 4 } : null),
    affixFrom: () => 1,
    bandAt: (sec) => (sec >= 360 ? 2 : sec >= 180 ? 1 : 0),
    ...over,
  };
  const hints = new Hints(host);
  const ids = (): string[] => r.shown.map((p) => p.id);
  const expire = (): void => {
    if (r.feed && r.clock >= r.feed.until) {
      r.log.push({ what: 'gone', id: r.feed.id, at: r.clock });
      r.feed = null;
    }
  };
  const wait = (ms: number): void => {
    for (let left = ms; left > 0; left -= 100) {
      r.clock += Math.min(100, left);
      expire();
      hints.pump();
    }
  };
  /** the clock moves with no pump in between (a hidden tab), then one pump */
  const jump = (ms: number): void => {
    r.clock += ms;
    expire();
    hints.pump();
  };
  /** another banner (a Metin / boss / level plate) takes the screen: announce() replaces the hint row */
  const replaceBy = (): void => {
    if (r.feed) r.log.push({ what: 'gone', id: r.feed.id, at: r.clock });
    r.feed = null;
    r.plate = true;
  };
  /** the hint settle time (a hint never shows in the instant it was queued) */
  const settle = (): void => wait(HINT_SETTLE_MS);
  /** the settle time of hint `id`: the run-event tip waits much longer, for its banner to be read first */
  const settleFor = (id: HintId): void => wait(id === 'event' ? HINT_SETTLE_EVENT_MS : HINT_SETTLE_MS);
  const seen = (): string[] => settings.value.hintsSeen;
  /** a modal opens / closes: the wiring pumps on the modal change (the pump sees the time up to now with the state it had before) */
  const cover = (on: boolean): void => {
    r.covered = on;
    hints.pump();
  };
  /** a HUD snapshot: the wiring pumps right after it */
  const snap = (over: Partial<HintHud> = {}): void => {
    hints.onHud(hud(over));
    hints.pump();
  };
  return { r, hints, ids, wait, jump, replaceBy, settle, settleFor, seen, cover, snap };
}

const TRIGGERS: Record<HintId, (h: Hints) => void> = {
  levelUp: (h) => h.onEvent(ev({ t: 'levelUp', player: 0, level: 2 })),
  metinWarn: (h) => h.onEvent(ev({ t: 'metinWarn', metin: 1, def: 'metin_a', x: 0, z: 0, dur: 3, great: false })),
  metinAwaken: (h) => h.onEvent(ev({ t: 'metinAwaken', metin: 1, def: 'metin_a', x: 0, z: 0 })),
  corruption: (h) => h.onHud(hud({ corruption: CORRUPTION_HINT_AT })),
  chestLocked: (h) => h.onEvent(ev({ t: 'chestLocked', player: 0, cost: 80, yeop: 10 })),
  boss: (h) => h.onEvent(ev({ t: 'bossSpawn', boss: 1, enemy: 1, bossId: 'b', x: 0, z: 0, final: false })),
  essence: (h) => h.onModal({ kind: 'essence', request: { player: 0 } }),
  reroll: (h) => {
    h.onHud(hud({ rerolls: 2 }));
    h.onHud(hud({ rerolls: 1 }));
  },
  banish: (h) => {
    h.onHud(hud({ banishes: 1 }));
    h.onHud(hud({ banishes: 0 }));
  },
  pact: (h) => h.onModal({ kind: 'levelUp', request: { player: 0, cards: [{ id: 'bladewheel', needs: 'sovereign_wrath' }] } }),
  event: (h) => h.onEvent(ev({ t: 'runEvent', kind: 'championHunt', phase: 'active', id: 1, x: 0, z: 0, startAt: 395, endAt: 455, player: -1, p: 0 })),
  affix: (h) => h.onEvent(ev({ t: 'enemySpawn', enemy: 1, type: 0, x: 0, z: 0, tier: 1, source: 5 }), { time: 400 }),
};

describe('each hint shows once per profile', () => {
  it('has a trigger for every hint id', () => {
    expect(Object.keys(TRIGGERS).sort()).toEqual([...HINT_IDS].sort());
  });

  for (const id of HINT_IDS) {
    it(`${id}: shown once, recorded once it was read, never again (also not after another trigger)`, () => {
      const { hints, r, ids, wait, settleFor, seen } = rig();
      TRIGGERS[id](hints);
      settleFor(id);
      expect(ids()).toEqual([id]);
      const p = r.shown[0] as HintPlate;
      expect(p.title.startsWith('Tip · ')).toBe(true);
      expect(p.sub).not.toMatch(/^hint\./);
      expect(p.sub).not.toMatch(/\{\w+\}/);
      expect(p.ttlMs).toBe(HINT_TTL_MS);
      expect(seen()).toEqual([]); // on screen, not yet read
      wait(HINT_READ_MS - 100);
      expect(seen()).toEqual([]);
      wait(100);
      expect(seen()).toEqual([id]); // readable for HINT_READ_MS: spent
      wait(HINT_GAP_MS + HINT_TTL_MS);
      TRIGGERS[id](hints);
      settleFor(id);
      hints.pump();
      expect(ids()).toEqual([id]);
    });
  }

  it('a profile that has seen a hint never gets it, even in a new controller (a new run / page load)', () => {
    settings.update({ hintsSeen: ['boss', 'levelUp'] });
    const { hints, ids, settle } = rig();
    TRIGGERS.boss(hints);
    TRIGGERS.levelUp(hints);
    settle();
    hints.pump();
    expect(ids()).toEqual([]);
    TRIGGERS.chestLocked(hints);
    settle();
    hints.pump();
    expect(ids()).toEqual(['chestLocked']);
  });

  it('two triggers of the same hint before it shows queue it once', () => {
    const { hints, r, ids, wait, settle } = rig();
    r.plate = true;
    TRIGGERS.levelUp(hints);
    TRIGGERS.levelUp(hints);
    r.plate = false;
    settle();
    hints.pump();
    wait(HINT_GAP_MS + 1);
    settle();
    hints.pump();
    expect(ids()).toEqual(['levelUp']);
  });

  it('the first level-up of another player (co-op) and a locked chest of another hero show nothing: hints are local', () => {
    const { hints, ids, settle } = rig();
    hints.onEvent(ev({ t: 'levelUp', player: 1, level: 2 }));
    hints.onEvent(ev({ t: 'chestLocked', player: 1, cost: 80, yeop: 10 }));
    hints.onModal({ kind: 'essence', request: { player: 1 } });
    settle();
    hints.pump();
    expect(ids()).toEqual([]);
  });
});

describe('showHints and "Reset hints"', () => {
  it('showHints off hides every hint and records nothing', () => {
    settings.update({ showHints: false });
    const { hints, ids, wait, settle } = rig();
    for (const id of HINT_IDS) TRIGGERS[id](hints);
    settle();
    hints.pump();
    wait(60_000);
    settle();
    hints.pump();
    expect(ids()).toEqual([]);
    expect(settings.value.hintsSeen).toEqual([]);
  });

  it('turning showHints off while a hint waits drops it; on again, the next trigger shows it', () => {
    const { hints, r, ids, wait, settle } = rig();
    r.plate = true;
    TRIGGERS.boss(hints);
    settings.update({ showHints: false });
    r.plate = false;
    settle();
    hints.pump();
    expect(ids()).toEqual([]);
    settings.update({ showHints: true });
    settle();
    hints.pump();
    expect(ids()).toEqual([]); // the dropped one is gone ...
    wait(1);
    TRIGGERS.boss(hints); // ... and comes back with the next occasion
    settle();
    hints.pump();
    expect(ids()).toEqual(['boss']);
  });

  it('Reset hints clears the list: the hints show again', () => {
    const { hints, ids, wait, settle } = rig();
    TRIGGERS.corruption(hints);
    settle();
    hints.pump();
    expect(ids()).toEqual(['corruption']);
    wait(HINT_READ_MS);
    expect(settings.value.hintsSeen).toEqual(['corruption']);
    settings.resetHints();
    expect(settings.value.hintsSeen).toEqual([]);
    wait(HINT_GAP_MS + HINT_TTL_MS);
    TRIGGERS.corruption(hints);
    settle();
    hints.pump();
    expect(ids()).toEqual(['corruption', 'corruption']);
  });

  it('a hint that was recorded as seen while it waited (another tab) is not shown a second time', () => {
    const { hints, r, ids, settle } = rig();
    r.plate = true;
    TRIGGERS.levelUp(hints);
    settings.markHintSeen('levelUp');
    r.plate = false;
    settle();
    hints.pump();
    expect(ids()).toEqual([]);
  });
});

describe('the awakening clock in the Metin hint', () => {
  const warn = (hints: Hints, over: Record<string, unknown> = {}, w?: { mods?: { awaken?: number } }): void =>
    hints.onEvent(ev({ t: 'metinWarn', metin: 1, def: 'metin_a', x: 0, z: 0, dur: 3, great: false, ...over }), w);

  it('reads 1:30 by default', () => {
    const { hints, r, settle } = rig();
    warn(hints);
    settle();
    hints.pump();
    expect(r.shown[0]?.sub).toContain('1:30');
  });

  it('reads 1:00 on hard (mods.awaken .67 of the live world)', () => {
    const { hints, r, settle } = rig();
    warn(hints, {}, { mods: { awaken: 0.67 } });
    settle();
    hints.pump();
    expect(r.shown[0]?.sub).toContain('1:00');
    expect(r.shown[0]?.sub).not.toContain('1:30');
  });

  it('the live world beats the fallback; without a world the run difficulty (hard .67) is used', () => {
    const a = rig();
    a.r.mul = 0.67;
    warn(a.hints, {}, { mods: { awaken: 0.5 } });
    a.settle();
    a.hints.pump();
    expect(a.r.shown[0]?.sub).toContain('0:45');
    settings.update({ hintsSeen: [] });
    const b = rig();
    b.r.mul = 0.67;
    warn(b.hints);
    b.settle();
    b.hints.pump();
    expect(b.r.shown[0]?.sub).toContain('1:00');
    settings.update({ hintsSeen: [] });
    const c = rig();
    warn(c.hints, {}, {}); // a world without mods: 1
    c.settle();
    c.hints.pump();
    expect(c.r.shown[0]?.sub).toContain('1:30');
  });

  it("uses the warned Metin's own awakenAfter", () => {
    const { hints, r, settle } = rig();
    warn(hints, { def: 'metin_b' });
    settle();
    hints.pump();
    expect(r.shown[0]?.sub).toContain('0:45');
  });

  it('the Great Metin (it never awakens) and an unknown definition teach nothing', () => {
    const { hints, ids, settle } = rig();
    warn(hints, { great: true });
    warn(hints, { def: 'nope' });
    settle();
    hints.pump();
    expect(ids()).toEqual([]);
    expect(settings.value.hintsSeen).toEqual([]);
  });

  it('fmtAwakenTime: m:ss with unpadded minutes, whole seconds', () => {
    expect(fmtAwakenTime(90)).toBe('1:30');
    expect(fmtAwakenTime(90 * 0.67)).toBe('1:00');
    expect(fmtAwakenTime(45)).toBe('0:45');
    expect(fmtAwakenTime(605)).toBe('10:05');
    expect(fmtAwakenTime(-3)).toBe('0:00');
    expect(fmtAwakenTime(Number.NaN)).toBe('0:00');
  });
});

describe('a hint waits for a free screen', () => {
  it('never shows over a banner (a boss / big plate is never pushed off); it shows when the banner has gone', () => {
    const { hints, r, ids, settle } = rig();
    r.plate = true;
    TRIGGERS.boss(hints);
    TRIGGERS.corruption(hints);
    settle();
    hints.pump();
    r.clock += 3000;
    settle();
    hints.pump();
    expect(ids()).toEqual([]);
    expect(settings.value.hintsSeen).toEqual([]);
    r.plate = false;
    settle();
    hints.pump();
    expect(ids()).toEqual(['boss']);
  });

  it('waits under a modal or the pause menu, and the wait under it does not age the hint', () => {
    const { hints, ids, wait, settle, cover } = rig();
    cover(true);
    TRIGGERS.levelUp(hints);
    for (let i = 0; i < 20; i++) {
      wait(10_000);
      settle();
      hints.pump();
    }
    expect(ids()).toEqual([]); // 200 s under a modal: still queued
    cover(false);
    expect(ids()).toEqual([]); // not in the instant it closes
    settle();
    hints.pump();
    expect(ids()).toEqual(['levelUp']);
  });

  it('waits while the hero is dead, shows after the revive', () => {
    const { hints, ids, wait, settle, snap } = rig();
    snap({ alive: false });
    TRIGGERS.boss(hints);
    wait(5000);
    settle();
    hints.pump();
    expect(ids()).toEqual([]);
    snap({ alive: true });
    settle();
    hints.pump();
    expect(ids()).toEqual(['boss']);
  });

  it('a hint that finds no free moment for HINT_QUEUE_MS is dropped and NOT recorded: it shows at the next occasion', () => {
    const { hints, r, ids, wait, settle } = rig();
    r.plate = true;
    TRIGGERS.chestLocked(hints);
    wait(HINT_QUEUE_MS + 1);
    settle();
    hints.pump();
    r.plate = false;
    settle();
    hints.pump();
    expect(ids()).toEqual([]);
    expect(settings.value.hintsSeen).toEqual([]);
    TRIGGERS.chestLocked(hints);
    settle();
    hints.pump();
    expect(ids()).toEqual(['chestLocked']);
  });

  it('two hints queued: one at a time; the breather starts when the first plate has LEFT the screen', () => {
    const { hints, r, ids, wait, settle } = rig();
    TRIGGERS.levelUp(hints);
    TRIGGERS.boss(hints);
    settle();
    expect(ids()).toEqual(['levelUp']);
    // the first plate stays up for its full time: the second hint does not open under it, not even after HINT_GAP_MS of plate time
    wait(HINT_TTL_MS - 100);
    expect(ids()).toEqual(['levelUp']);
    expect(r.feed?.id).toBe('levelUp');
    wait(100); // the plate folds ...
    const left = r.log.find((l) => l.what === 'gone' && l.id === 'levelUp');
    expect(left?.at).toBe((r.log.find((l) => l.what === 'show')?.at ?? 0) + HINT_TTL_MS);
    expect(r.feed).toBeNull();
    // ... and the second one waits out the breather, measured from that moment
    wait(HINT_GAP_MS - 100);
    expect(ids()).toEqual(['levelUp']);
    wait(100);
    expect(ids()).toEqual(['levelUp', 'boss']);
    const opened = r.log.filter((l) => l.what === 'show')[1];
    expect((opened?.at ?? 0) - (left?.at ?? 0)).toBeGreaterThanOrEqual(HINT_GAP_MS);
  });

  it('a plate that is on screen holds the next hint back even when the breather is over', () => {
    const { hints, r, ids, wait, settle } = rig();
    TRIGGERS.levelUp(hints);
    settle();
    wait(HINT_TTL_MS + HINT_GAP_MS + 500); // the plate came and went and the breather is long over
    TRIGGERS.boss(hints);
    r.plate = true; // another banner is up
    settle();
    expect(ids()).toEqual(['levelUp']);
    r.plate = false;
    settle();
    expect(ids()).toEqual(['levelUp', 'boss']);
  });

  it('the run ending drops what waits (a hint never opens over the next run)', () => {
    const { hints, r, ids, settle } = rig();
    r.plate = true;
    TRIGGERS.boss(hints);
    hints.onEvent(ev({ t: 'runEnd', victory: false }));
    r.plate = false;
    settle();
    hints.pump();
    expect(ids()).toEqual([]);
  });
});

describe('a hint is spent only when it was read', () => {
  it('a modal 1 s after the plate opens takes it back unrecorded; after the modal it returns for its full time, then it is recorded', () => {
    const { hints, r, ids, wait, settle, seen, cover } = rig();
    TRIGGERS.levelUp(hints);
    settle();
    const first = r.shown[0] as HintPlate;
    wait(1000);
    expect(r.feed?.id).toBe('levelUp');
    expect(hints.showing).toBe('levelUp');
    cover(true); // a level-up offer opens over the HUD (the wiring pumps on the modal change)
    expect(r.feed).toBeNull(); // no text ghosts behind the offer
    expect(hints.showing).toBeNull();
    expect(r.log.at(-1)).toMatchObject({ what: 'withdraw', id: 'levelUp' });
    expect(seen()).toEqual([]); // not spent
    wait(20_000); // the player chooses a card
    expect(ids()).toEqual(['levelUp']);
    expect(seen()).toEqual([]);
    cover(false); // the offer closes
    expect(ids()).toEqual(['levelUp']); // not in the instant it closes (settle)
    settle();
    expect(ids()).toEqual(['levelUp', 'levelUp']); // the same hint, again
    expect(r.shown[1]).toEqual(first);
    const reopened = r.log.filter((l) => l.what === 'show')[1]?.at ?? 0;
    expect(r.feed?.until).toBe(reopened + HINT_TTL_MS); // its full time
    wait(HINT_READ_MS - 100);
    expect(seen()).toEqual([]);
    wait(100);
    expect(seen()).toEqual(['levelUp']);
    wait(HINT_TTL_MS + HINT_GAP_MS + 1000); // and it does not come a third time
    TRIGGERS.levelUp(hints);
    settle();
    expect(ids()).toEqual(['levelUp', 'levelUp']);
  });

  it('a plate that was not read comes back with the SAME sentence (the awakening time it was queued with)', () => {
    const { hints, r, wait, settle, cover } = rig();
    hints.onEvent(ev({ t: 'metinWarn', metin: 1, def: 'metin_a', x: 0, z: 0, dur: 3, great: false }), { mods: { awaken: 0.67 } });
    settle();
    expect(r.shown[0]?.sub).toContain('1:00');
    r.mul = 2; // whatever the run's clock says later, the plate keeps the number it was queued with
    wait(500);
    cover(true);
    wait(3000);
    cover(false);
    wait(HINT_GAP_MS);
    settle();
    expect(r.shown).toHaveLength(2);
    expect(r.shown[1]?.sub).toBe(r.shown[0]?.sub);
  });

  it('replaced by a Metin banner after 1 s: unrecorded, and back once the banner has gone', () => {
    const { hints, r, ids, wait, settle, replaceBy, seen } = rig();
    TRIGGERS.corruption(hints);
    settle();
    wait(1000);
    replaceBy(); // announce() put the Metin banner in the feed: the hint row is gone
    hints.pump();
    expect(seen()).toEqual([]);
    wait(3200); // the banner is up; the hint waits (a hint never opens over a banner)
    expect(ids()).toEqual(['corruption']);
    r.plate = false;
    hints.pump();
    expect(ids()).toEqual(['corruption', 'corruption']);
    expect(r.feed?.id).toBe('corruption');
    wait(HINT_READ_MS);
    expect(seen()).toEqual(['corruption']);
  });

  it('a boss banner after 1 s is the same: the boss plate stays, the hint is queued again and shows after it', () => {
    const { hints, r, ids, wait, settle, replaceBy, seen } = rig();
    TRIGGERS.chestLocked(hints);
    settle();
    wait(1000);
    replaceBy();
    hints.pump();
    wait(4600);
    expect(ids()).toEqual(['chestLocked']);
    r.plate = false;
    hints.pump();
    wait(HINT_GAP_MS);
    expect(ids()).toEqual(['chestLocked', 'chestLocked']);
    expect(seen()).toEqual([]);
  });

  it('covered AFTER it was readable for HINT_READ_MS: recorded, left alone, not repeated', () => {
    const { hints, r, ids, wait, settle, seen, cover } = rig();
    TRIGGERS.boss(hints);
    settle();
    wait(HINT_READ_MS);
    expect(seen()).toEqual(['boss']);
    cover(true); // a level-up offer opens
    expect(r.log.some((l) => l.what === 'withdraw')).toBe(false); // read already: no reason to pull it
    wait(10_000);
    r.covered = false;
    wait(HINT_TTL_MS + HINT_GAP_MS + 1000);
    TRIGGERS.boss(hints);
    settle();
    expect(ids()).toEqual(['boss']);
    expect(seen()).toEqual(['boss']);
  });

  it('replaced AFTER it was readable for HINT_READ_MS: recorded, not queued again', () => {
    const { hints, r, ids, wait, settle, replaceBy, seen } = rig();
    TRIGGERS.boss(hints);
    settle();
    wait(HINT_READ_MS + 100);
    replaceBy();
    hints.pump();
    r.plate = false;
    wait(HINT_GAP_MS + 1000);
    expect(ids()).toEqual(['boss']);
    expect(seen()).toEqual(['boss']);
  });

  it('a pump that comes late judges the plate by the last pump that saw it readable (a throttled tab does not spend it)', () => {
    const { hints, r, ids, jump, wait, settle, seen } = rig();
    TRIGGERS.corruption(hints);
    settle();
    wait(300);
    jump(7000); // no pump for 7 s: the plate has run out by the time the next one comes
    expect(r.feed).toBeNull();
    expect(seen()).toEqual([]);
    wait(HINT_GAP_MS + HINT_SETTLE_MS);
    expect(ids()).toEqual(['corruption', 'corruption']);
    wait(HINT_READ_MS);
    expect(seen()).toEqual(['corruption']);
  });

  it('the hero dying 1 s after the plate opened takes it back; after the revive it shows again', () => {
    const { hints, r, ids, wait, settle, seen, snap } = rig();
    TRIGGERS.boss(hints);
    settle();
    wait(1000);
    snap({ alive: false });
    expect(r.feed).toBeNull();
    expect(seen()).toEqual([]);
    wait(8000); // dead: nothing opens
    expect(ids()).toEqual(['boss']);
    r.plate = true; // the 'Revived' banner
    snap({ alive: true });
    wait(2600);
    r.plate = false;
    hints.pump();
    expect(ids()).toEqual(['boss', 'boss']);
    wait(HINT_READ_MS);
    expect(seen()).toEqual(['boss']);
  });

  it('the pause menu is a modal like any other: the unread plate is withdrawn and returns after the resume', () => {
    const { hints, r, ids, wait, settle, seen, cover } = rig();
    TRIGGERS.chestLocked(hints);
    settle();
    wait(1000);
    cover(true); // store.modal = { kind: 'pause' }
    expect(r.feed).toBeNull();
    wait(60_000);
    expect(ids()).toEqual(['chestLocked']);
    expect(seen()).toEqual([]);
    cover(false);
    settle();
    expect(ids()).toEqual(['chestLocked', 'chestLocked']);
    wait(HINT_READ_MS);
    expect(seen()).toEqual(['chestLocked']);
  });

  it('a modal that keeps opening and closing never spends the plate: it needs HINT_READ_MS in one piece', () => {
    const { hints, ids, wait, settle, seen, cover } = rig();
    TRIGGERS.levelUp(hints);
    settle();
    for (let i = 0; i < 4; i++) {
      wait(2000); // readable for 2 s ...
      cover(true); // ... then an offer ...
      wait(1000);
      cover(false); // ... then it is closed again
      wait(HINT_GAP_MS + HINT_SETTLE_MS); // the plate comes back after the breather
    }
    expect(seen()).toEqual([]);
    expect(ids()).toHaveLength(5);
    wait(HINT_READ_MS);
    expect(seen()).toEqual(['levelUp']);
  });

  it('the withdrawn hint goes back to the HEAD of the queue, ahead of the hint that waited behind it', () => {
    const { hints, r, ids, wait, settle, cover } = rig();
    TRIGGERS.levelUp(hints);
    settle();
    TRIGGERS.boss(hints); // queued behind the plate that is up
    wait(1000);
    cover(true);
    wait(5000);
    cover(false);
    settle();
    expect(ids()).toEqual(['levelUp', 'levelUp']);
  });

  it('the breather also counts from a withdrawn plate: a hint never opens in the instant a plate was pulled', () => {
    const { hints, r, ids, wait, settle, cover } = rig();
    TRIGGERS.levelUp(hints);
    settle();
    wait(500);
    cover(true);
    cover(false); // a one-frame modal
    wait(HINT_SETTLE_MS + 100);
    expect(ids()).toEqual(['levelUp']);
    wait(HINT_GAP_MS);
    expect(ids()).toEqual(['levelUp', 'levelUp']);
  });

  it('showHints turned off with a plate up: an unread plate is withdrawn and not queued again; nothing is recorded', () => {
    const { hints, r, ids, wait, settle, seen } = rig();
    TRIGGERS.boss(hints);
    settle();
    wait(1000);
    settings.update({ showHints: false });
    hints.pump();
    expect(r.feed).toBeNull();
    settings.update({ showHints: true });
    wait(HINT_GAP_MS + 2000);
    expect(ids()).toEqual(['boss']);
    expect(seen()).toEqual([]);
  });

  it('the run ending takes an unread plate off the screen and records nothing: it shows in the next run', () => {
    const { hints, r, ids, wait, settle, seen } = rig();
    TRIGGERS.boss(hints);
    settle();
    wait(1000);
    hints.onEvent(ev({ t: 'runEnd', victory: false }));
    expect(r.feed).toBeNull();
    expect(seen()).toEqual([]);
    wait(HINT_GAP_MS + 1000);
    TRIGGERS.boss(hints); // next run
    settle();
    expect(ids()).toEqual(['boss', 'boss']);
  });

  it('the hint that is up is not queued a second time by its own trigger', () => {
    const { hints, ids, wait, settle } = rig();
    TRIGGERS.levelUp(hints);
    settle();
    TRIGGERS.levelUp(hints);
    TRIGGERS.levelUp(hints);
    wait(HINT_READ_MS + HINT_TTL_MS + HINT_GAP_MS + 2000);
    expect(ids()).toEqual(['levelUp']);
  });
});

describe('what triggers corruption, reroll and banish', () => {
  it('corruption shows from CORRUPTION_HINT_AT (50 %), not below', () => {
    const { hints, ids, settle } = rig();
    hints.onHud(hud({ corruption: 0.49 }));
    settle();
    hints.pump();
    expect(ids()).toEqual([]);
    hints.onHud(hud({ corruption: 0.5 }));
    settle();
    hints.pump();
    expect(ids()).toEqual(['corruption']);
  });

  it('the first snapshot of a run is a baseline (no reroll / banish hint), a budget going UP never triggers', () => {
    const { hints, ids, settle } = rig();
    hints.onHud(hud({ rerolls: 3, banishes: 2 }));
    hints.onHud(hud({ rerolls: 4, banishes: 3 }));
    settle();
    hints.pump();
    expect(ids()).toEqual([]);
  });

  it('a new run (HUD gone, then back) starts from a new baseline: a refilled budget is not a use', () => {
    const { hints, ids, settle } = rig();
    hints.onHud(hud({ rerolls: 0 }));
    hints.onHud(null);
    hints.onHud(hud({ rerolls: 3 }));
    settle();
    hints.pump();
    expect(ids()).toEqual([]);
  });

  it('the reroll / banish hints name what is left', () => {
    const a = rig();
    TRIGGERS.reroll(a.hints);
    a.settle();
    a.hints.pump();
    expect(a.r.shown[0]?.sub).toContain('1 left');
    settings.update({ hintsSeen: [] });
    const b = rig();
    TRIGGERS.banish(b.hints);
    b.settle();
    b.hints.pump();
    expect(b.r.shown[0]?.sub).toContain('0 left');
  });

  it('only a local essence offer teaches the sockets; a level-up or pause modal does not', () => {
    const { hints, ids, settle } = rig();
    hints.onModal({ kind: 'levelUp', request: { player: 0 } });
    hints.onModal({ kind: 'pause' });
    hints.onModal(null);
    settle();
    hints.pump();
    expect(ids()).toEqual([]);
    hints.onModal({ kind: 'essence', request: { player: 0 } });
    settle();
    hints.pump();
    expect(ids()).toEqual(['essence']);
  });
});

describe('strings', () => {
  const en = dictionaries.en;
  const tr = dictionaries.tr;
  const ph = (s: string): string => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort().join(',');

  it('every hint has a topic and a sentence in English and Turkish with the same placeholders', () => {
    for (const id of HINT_IDS) {
      for (const k of [`hint.${id}.title`, `hint.${id}.text`]) {
        expect(en[k], k).toBeTruthy();
        expect(tr[k], k).toBeTruthy();
        expect(ph(en[k] as string), k).toBe(ph(tr[k] as string));
      }
    }
    expect(ph(en['hint.metinWarn.text'] as string)).toBe('time');
    expect(ph(en['hint.reroll.text'] as string)).toBe('n');
    expect(ph(en['hint.banish.text'] as string)).toBe('n');
  });

  it('the Settings strings exist in both languages', () => {
    for (const k of ['hint.tag', 'hint.setting', 'hint.setting.hint', 'hint.reset', 'hint.reset.hint', 'hint.reset.none', 'hint.reset.done']) {
      expect(en[k], k).toBeTruthy();
      expect(tr[k], k).toBeTruthy();
    }
    expect(ph(en['hint.reset.hint'] as string)).toBe('n,total');
    expect(ph(tr['hint.reset.hint'] as string)).toBe('n,total');
  });

  it('the metin sentence reads as the spec says in English', () => {
    expect((en['hint.metinWarn.text'] as string).replace('{time}', '1:30')).toBe('Break it before 1:30 or it awakens: stronger, but pays more.');
    expect(en['hint.corruption.text']).toContain('More enemies, better loot');
    expect(en['hint.chestLocked.text']).toContain('banked for the blacksmith');
    expect(en['hint.boss.text']).toContain('Bosses drop gear for your class');
  });
});

describe('attachHints: the wiring', () => {
  type Listener = (e: SimEvent, w?: unknown) => void;
  /** a hint needs the settle time plus one 400 ms tick of the wiring to show */
  const SETTLED = HINT_SETTLE_MS + 500;
  function wiring(opts: { hard?: boolean; zoneHard?: number } = {}) {
    const store = new GameStore();
    const subs = new Set<Listener>();
    const events = {
      subscribe: (fn: Listener) => {
        subs.add(fn);
        return () => void subs.delete(fn);
      },
    };
    const content = {
      metins: [{ id: 'metin_a', awakenAfter: 90 }],
      zones: [{ id: 'yeonmu', ...(opts.zoneHard ? { hard: { awakenMul: opts.zoneHard } } : {}) }],
      balance: { hard: { awakenMul: 0.67 } },
    } as unknown as ContentDB;
    if (opts.hard) store.select({ difficulty: 'hard', zone: 'yeonmu' });
    const shown: HintPlate[] = [];
    // a fake feed with the real one's behaviour: a hint plate stays its ttl, a banner of another kind replaces it, withdraw takes it off
    let feed: string | null = null;
    let token = 0;
    let other = false;
    const plates: HintPlates = {
      show: (p) => {
        shown.push(p);
        feed = p.id;
        const mine = ++token; // the expiry timer of a plate that was taken back must not remove the plate that replaced it
        setTimeout(() => {
          if (token === mine) feed = null;
        }, p.ttlMs);
      },
      busy: () => other || feed !== null,
      has: (id) => feed === id,
      withdraw: (id) => {
        if (feed === id) feed = null;
      },
    };
    const off = attachHints({ store, content, events: events as never }, plates);
    const emit = (e: Record<string, unknown>, w?: unknown): void => {
      for (const fn of subs) fn(ev(e), w);
    };
    const snap = (over: Partial<HudSnapshot> = {}): void => store.setHud({ alive: true, corruption: 0, rerolls: 2, banishes: 1, ...over } as unknown as HudSnapshot);
    const ids = (): string[] => shown.map((p) => p.id);
    /** another banner (Metin falling, boss incoming ...) replaces the hint row; `setPlate(false)` is that banner running out */
    const replace = (): void => {
      feed = null;
      other = true;
    };
    return { store, subs, shown, ids, emit, snap, off, feed: () => feed, replace, setPlate: (v: boolean) => (other = v) };
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance', 'Date'] });
  });

  it('shows the first level-up hint once the settle time has passed, and only once', () => {
    const w = wiring();
    w.snap();
    w.emit({ t: 'levelUp', player: 0, level: 2 });
    expect(w.shown).toEqual([]); // not in the instant of the event
    vi.advanceTimersByTime(SETTLED);
    expect(w.ids()).toEqual(['levelUp']);
    expect(settings.value.hintsSeen).toEqual([]); // on screen, not yet read
    vi.advanceTimersByTime(HINT_READ_MS);
    expect(settings.value.hintsSeen).toEqual(['levelUp']);
    vi.advanceTimersByTime(HINT_GAP_MS + HINT_TTL_MS);
    w.emit({ t: 'levelUp', player: 0, level: 3 });
    vi.advanceTimersByTime(SETTLED);
    expect(w.shown).toHaveLength(1);
    w.off();
  });

  it('the order of the real game: the level-up EVENT comes first, its MODAL reaches the store right after in the same tick: no hint over the modal', () => {
    const w = wiring();
    w.snap();
    w.emit({ t: 'levelUp', player: 0, level: 2 }); // app/run.ts: runEvents.dispatch(world.events) ...
    w.store.setSimModal({ id: 7, kind: 'levelUp', player: 0 } as never); // ... then syncModal()
    vi.advanceTimersByTime(30_000);
    expect(w.shown).toEqual([]); // 30 s under the offer: the player is choosing a card, the plate would be hidden behind it
    w.store.setSimModal(null); // the card is picked
    expect(w.shown).toEqual([]); // not in the instant the offer closes either
    vi.advanceTimersByTime(SETTLED);
    expect(w.ids()).toEqual(['levelUp']);
    w.off();
  });

  it('the settle time is not skipped when the offer closes between two ticks of the wiring', () => {
    const w = wiring();
    w.snap();
    w.emit({ t: 'levelUp', player: 0, level: 2 });
    w.store.setSimModal({ id: 7, kind: 'levelUp', player: 0 } as never);
    vi.advanceTimersByTime(30_000 + 170); // 170 ms into a tick of the wiring
    w.store.setSimModal(null);
    expect(w.shown).toEqual([]);
    vi.advanceTimersByTime(HINT_SETTLE_MS + 400);
    expect(w.ids()).toEqual(['levelUp']);
    w.off();
  });

  it('a modal that is already open holds a later hint back until it closes', () => {
    const w = wiring();
    w.snap();
    w.store.setSimModal({ id: 1, kind: 'levelUp', player: 0 } as never);
    w.emit({ t: 'chestLocked', player: 0, cost: 80, yeop: 5 });
    vi.advanceTimersByTime(5000);
    expect(w.shown).toEqual([]);
    w.store.setSimModal(null);
    vi.advanceTimersByTime(SETTLED);
    expect(w.ids()).toEqual(['chestLocked']);
    w.off();
  });

  it('a banner on screen holds the hint back until the tick finds the feed empty', () => {
    const w = wiring();
    w.snap();
    w.setPlate(true);
    w.emit({ t: 'bossSpawn', boss: 1, enemy: 1, bossId: 'b', x: 0, z: 0, final: false });
    vi.advanceTimersByTime(2000);
    expect(w.shown).toEqual([]);
    w.setPlate(false);
    vi.advanceTimersByTime(500);
    expect(w.ids()).toEqual(['boss']);
    w.off();
  });

  it('the first essence offer shows its hint once the offer is closed', () => {
    const w = wiring();
    w.snap();
    w.store.setSimModal({ id: 2, kind: 'essence', player: 0 } as never);
    vi.advanceTimersByTime(SETTLED);
    expect(w.shown).toEqual([]);
    w.store.setSimModal(null);
    vi.advanceTimersByTime(SETTLED);
    expect(w.ids()).toEqual(['essence']);
    w.off();
  });

  it('corruption and the first reroll come from the HUD snapshot; the second waits for the first plate to leave and the breather', () => {
    const w = wiring();
    w.snap({ corruption: 0.2 });
    vi.advanceTimersByTime(SETTLED);
    expect(w.shown).toEqual([]);
    w.snap({ corruption: 0.2, rerolls: 1 }); // a reroll was spent
    vi.advanceTimersByTime(SETTLED);
    expect(w.ids()).toEqual(['reroll']);
    w.snap({ corruption: 0.55, rerolls: 1 }); // corruption crosses 50 %: the reroll plate is still up
    vi.advanceTimersByTime(HINT_TTL_MS - 2 * SETTLED);
    expect(w.ids()).toEqual(['reroll']);
    vi.advanceTimersByTime(HINT_GAP_MS - 500); // the plate has folded, the breather is not over
    expect(w.ids()).toEqual(['reroll']);
    vi.advanceTimersByTime(2 * SETTLED + 1000);
    expect(w.ids()).toEqual(['reroll', 'corruption']);
    w.off();
  });

  it('the awakening time follows the run: a live world first, else the difficulty (hard = the zone / balance awakenMul)', () => {
    const warn = { t: 'metinWarn', metin: 1, def: 'metin_a', x: 0, z: 0, dur: 3, great: false };
    const sub = (w: ReturnType<typeof wiring>, world?: unknown): string | undefined => {
      settings.update({ hintsSeen: [] });
      w.snap();
      w.emit(warn, world);
      vi.advanceTimersByTime(SETTLED);
      const text = w.shown[0]?.sub;
      w.off();
      return text;
    };
    expect(sub(wiring())).toContain('1:30');
    expect(sub(wiring({ hard: true }))).toContain('1:00');
    expect(sub(wiring({ hard: true, zoneHard: 0.5 }))).toContain('0:45');
    // an event (or a trial) can move the clock: the live world wins over the difficulty
    expect(sub(wiring({ hard: true }), { mods: { awaken: 1 } })).toContain('1:30');
    expect(sub(wiring(), { mods: { awaken: 0.67 } })).toContain('1:00');
  });

  it('showHints off: nothing; the unsubscribe removes every listener and the tick', () => {
    settings.update({ showHints: false });
    const w = wiring();
    w.snap({ corruption: 0.9 });
    w.emit({ t: 'bossSpawn', boss: 1, enemy: 1, bossId: 'b', x: 0, z: 0, final: false });
    vi.advanceTimersByTime(10_000);
    expect(w.shown).toEqual([]);
    expect(w.subs.size).toBe(1);
    w.off();
    expect(w.subs.size).toBe(0);
    settings.update({ showHints: true });
    w.snap({ corruption: 0.9 });
    vi.advanceTimersByTime(10_000);
    expect(w.shown).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  describe('an unread plate is taken back and shown again', () => {
    /** a boss plate, 1 s on screen */
    function plateUp() {
      const w = wiring();
      w.snap();
      w.emit({ t: 'bossSpawn', boss: 1, enemy: 1, bossId: 'b', x: 0, z: 0, final: false });
      vi.advanceTimersByTime(SETTLED);
      expect(w.feed()).toBe('boss');
      vi.advanceTimersByTime(1000);
      return w;
    }

    it('a level-up offer 1 s after the plate: withdrawn at once, not recorded; after the offer it returns for its full time and is recorded', () => {
      const w = plateUp();
      w.store.setSimModal({ id: 7, kind: 'levelUp', player: 0 } as never);
      expect(w.feed()).toBeNull();
      expect(settings.value.hintsSeen).toEqual([]);
      vi.advanceTimersByTime(4000); // the player picks a card
      expect(w.ids()).toEqual(['boss']);
      w.store.setSimModal(null);
      expect(w.ids()).toEqual(['boss']); // not in the instant it closes
      vi.advanceTimersByTime(SETTLED);
      expect(w.ids()).toEqual(['boss', 'boss']);
      expect(w.shown[1]).toEqual(w.shown[0]);
      expect(settings.value.hintsSeen).toEqual([]);
      vi.advanceTimersByTime(HINT_READ_MS);
      expect(settings.value.hintsSeen).toEqual(['boss']);
      vi.advanceTimersByTime(HINT_TTL_MS); // the plate runs out ...
      expect(w.feed()).toBeNull();
      w.emit({ t: 'bossSpawn', boss: 2, enemy: 2, bossId: 'b', x: 0, z: 0, final: false }); // ... and does not come again
      vi.advanceTimersByTime(10_000);
      expect(w.ids()).toEqual(['boss', 'boss']);
      w.off();
    });

    it('another banner replaces the plate after 1 s: the hint is queued again and returns when the banner has gone', () => {
      const w = plateUp();
      w.replace(); // announce(): a Metin banner takes the row
      vi.advanceTimersByTime(3200);
      expect(w.ids()).toEqual(['boss']);
      expect(settings.value.hintsSeen).toEqual([]);
      w.setPlate(false);
      vi.advanceTimersByTime(500);
      expect(w.ids()).toEqual(['boss', 'boss']);
      vi.advanceTimersByTime(HINT_READ_MS);
      expect(settings.value.hintsSeen).toEqual(['boss']);
      w.off();
    });

    it('the pause menu is a modal: withdrawn while paused, back after the resume', () => {
      const w = plateUp();
      w.store.setScreen('run');
      w.store.setPaused(true);
      expect(w.feed()).toBeNull();
      vi.advanceTimersByTime(20_000);
      expect(w.ids()).toEqual(['boss']);
      w.store.setPaused(false);
      vi.advanceTimersByTime(SETTLED);
      expect(w.ids()).toEqual(['boss', 'boss']);
      expect(settings.value.hintsSeen).toEqual([]);
      w.off();
    });

    it('the hero dying: withdrawn at the next HUD snapshot, back after the revive', () => {
      const w = plateUp();
      w.snap({ alive: false });
      expect(w.feed()).toBeNull();
      vi.advanceTimersByTime(10_000);
      expect(w.ids()).toEqual(['boss']);
      w.snap({ alive: true });
      vi.advanceTimersByTime(SETTLED);
      expect(w.ids()).toEqual(['boss', 'boss']);
      vi.advanceTimersByTime(HINT_READ_MS);
      expect(settings.value.hintsSeen).toEqual(['boss']);
      w.off();
    });

    it('covered after it was readable for HINT_READ_MS: recorded and left alone', () => {
      const w = wiring();
      w.snap();
      w.emit({ t: 'bossSpawn', boss: 1, enemy: 1, bossId: 'b', x: 0, z: 0, final: false });
      vi.advanceTimersByTime(SETTLED + HINT_READ_MS);
      expect(settings.value.hintsSeen).toEqual(['boss']);
      w.store.setSimModal({ id: 8, kind: 'chest', player: 0 } as never);
      expect(w.feed()).toBe('boss'); // read already: nothing to pull back
      vi.advanceTimersByTime(30_000);
      w.store.setSimModal(null);
      vi.advanceTimersByTime(10_000);
      expect(w.ids()).toEqual(['boss']);
      w.off();
    });

    it('the unsubscribe (HUD unmount) takes an unread plate off and leaves the hint unrecorded', () => {
      const w = plateUp();
      w.off();
      expect(w.feed()).toBeNull();
      expect(settings.value.hintsSeen).toEqual([]);
    });
  });
});

describe('the hint plate over the real banner feed (announce.ts + attachHints)', () => {
  type Listener = (e: SimEvent, w?: unknown) => void;
  const SETTLED = HINT_SETTLE_MS + 500;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance', 'Date'] });
    // announce() runs its expiry timers on window.setTimeout
    vi.stubGlobal('window', { setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms) });
    clearAnnouncements();
  });

  function real() {
    const store = new GameStore();
    const subs = new Set<Listener>();
    const events = { subscribe: (fn: Listener) => (subs.add(fn), () => void subs.delete(fn)) };
    const content = { metins: [], zones: [], balance: {} } as unknown as ContentDB;
    const off = attachHints({ store, content, events: events as never }, hintPlates);
    store.setHud({ alive: true, corruption: 0, rerolls: 2, banishes: 1 } as unknown as HudSnapshot);
    const boss = (): void => {
      for (const fn of subs) fn(ev({ t: 'bossSpawn', boss: 1, enemy: 1, bossId: 'b', x: 0, z: 0, final: false }));
    };
    const rows = (): string[] => announcements.value.map((a) => `${a.hint ? 'hint' : a.tone}:${a.hintId ?? a.title}`);
    return { store, off, boss, rows };
  }

  it('the plate sits in the feed, a level-up offer pulls it out (no text behind the offer), and it comes back whole', () => {
    const w = real();
    w.boss();
    vi.advanceTimersByTime(SETTLED);
    expect(w.rows()).toEqual(['hint:boss']);
    const first = announcements.value[0];
    vi.advanceTimersByTime(1000);
    w.store.setSimModal({ id: 3, kind: 'levelUp', player: 0 } as never);
    expect(announcements.value).toEqual([]);
    expect(settings.value.hintsSeen).toEqual([]);
    vi.advanceTimersByTime(5000); // longer than the plate's own 6 s timer would have left: nothing may come out of the old timer
    expect(announcements.value).toEqual([]);
    w.store.setSimModal(null);
    vi.advanceTimersByTime(SETTLED);
    expect(w.rows()).toEqual(['hint:boss']);
    expect(announcements.value[0]).toMatchObject({ title: first?.title, sub: first?.sub, hint: true, tone: 'info' });
    expect(announcements.value[0]?.id).not.toBe(first?.id);
    vi.advanceTimersByTime(HINT_READ_MS);
    expect(settings.value.hintsSeen).toEqual(['boss']);
    vi.advanceTimersByTime(HINT_TTL_MS); // the old timer of the withdrawn plate must not cut this one short, this one runs out by itself
    expect(announcements.value).toEqual([]);
    w.off();
  });

  it('a Metin banner replaces the plate 1 s after it opened: the hint is not spent and returns once the banner has run out', () => {
    const w = real();
    w.boss();
    vi.advanceTimersByTime(SETTLED + 1000);
    expect(w.rows()).toEqual(['hint:boss']);
    announce({ tone: 'metin', title: 'A Metin is falling!', sub: 'Ebon Metin' }, 3200, 'rf-metin');
    vi.advanceTimersByTime(500);
    expect(w.rows()).toEqual(['metin:A Metin is falling!']);
    expect(settings.value.hintsSeen).toEqual([]);
    vi.advanceTimersByTime(3200); // the banner runs out ...
    vi.advanceTimersByTime(500); // ... and the hint opens again
    expect(w.rows()).toEqual(['hint:boss']);
    vi.advanceTimersByTime(HINT_READ_MS);
    expect(settings.value.hintsSeen).toEqual(['boss']);
    w.off();
  });

  it('a boss banner is never replaced by a hint; the hint opens under nothing after it', () => {
    const w = real();
    announce({ tone: 'boss', title: 'Boss approaches', big: true }, 4600, 'rf-boss');
    w.boss();
    vi.advanceTimersByTime(2000);
    expect(w.rows()).toEqual(['boss:Boss approaches']); // a banner is up 2.5 s at most
    vi.advanceTimersByTime(1500);
    expect(w.rows()).toEqual(['hint:boss']);
    w.off();
  });

  it('the pause menu and the hero dying pull the plate out of the feed too', () => {
    const w = real();
    w.boss();
    vi.advanceTimersByTime(SETTLED + 1000);
    w.store.setScreen('run');
    w.store.setPaused(true);
    expect(announcements.value).toEqual([]);
    vi.advanceTimersByTime(3000);
    w.store.setPaused(false);
    vi.advanceTimersByTime(SETTLED);
    expect(w.rows()).toEqual(['hint:boss']);
    vi.advanceTimersByTime(1000);
    w.store.setHud({ alive: false, corruption: 0, rerolls: 2, banishes: 1 } as unknown as HudSnapshot);
    expect(announcements.value).toEqual([]);
    expect(settings.value.hintsSeen).toEqual([]);
    vi.advanceTimersByTime(3000);
    w.store.setHud({ alive: true, corruption: 0, rerolls: 2, banishes: 1 } as unknown as HudSnapshot);
    vi.advanceTimersByTime(SETTLED);
    expect(w.rows()).toEqual(['hint:boss']);
    w.off();
  });

  it('withdrawHint / hintShown: by id, any hint when no id, nothing else', () => {
    announce({ tone: 'metin', title: 'A Metin is falling!' }, 3200, 'rf-k1');
    withdrawHint();
    expect(announcements.value).toHaveLength(1); // not a hint
    clearAnnouncements();
    announce({ tone: 'info', title: 'Tip · Boss', sub: 's', hint: true, hintId: 'boss' }, HINT_TTL_MS, 'hint:boss');
    expect(hintShown('boss')).toBe(true);
    expect(hintShown('levelUp')).toBe(false);
    withdrawHint('levelUp');
    expect(hintShown('boss')).toBe(true);
    withdrawHint('boss');
    expect(announcements.value).toEqual([]);
    expect(hintShown('boss')).toBe(false);
    announce({ tone: 'info', title: 'Tip · Boss', sub: 's', hint: true, hintId: 'boss' }, HINT_TTL_MS, 'hint:boss');
    withdrawHint();
    expect(announcements.value).toEqual([]);
  });
});

describe('announce(): the hint plate in the banner feed', () => {
  const timers: { fn: () => void; ms: number }[] = [];
  beforeEach(() => {
    timers.length = 0;
    vi.stubGlobal('window', {
      setTimeout: (fn: () => void, ms: number) => {
        timers.push({ fn, ms });
        return timers.length;
      },
    });
    clearAnnouncements();
  });
  afterEach(() => clearAnnouncements());

  // the banner feed de-duplicates a key within 0.9 s: every test uses its own hint id
  const hint = (id: string): void => announce({ tone: 'info', title: 'Tip · Boss', sub: 'Bosses drop gear', hint: true }, HINT_TTL_MS, `hint:${id}`);

  it('a hint plate is an info banner with a sentence that stays up HINT_TTL_MS (a plain banner is capped at 2.5 s)', () => {
    hint('h1');
    expect(announcements.value).toHaveLength(1);
    expect(announcements.value[0]).toMatchObject({ tone: 'info', hint: true, sub: 'Bosses drop gear' });
    expect(timers[0]?.ms).toBe(HINT_TTL_MS);
    announce({ tone: 'info', title: 'Chest opened' }, 9000, 'plain');
    expect(timers.at(-1)?.ms).toBe(2500);
  });

  it('a plain info toast does not replace a hint that is being read; a danger / metin / boss banner does', () => {
    hint('h2');
    const id = announcements.value[0]?.id;
    announce({ tone: 'info', title: 'Chest opened' }, 1800, 'chestOpened');
    expect(announcements.value.map((a) => a.id)).toEqual([id]);
    announce({ tone: 'metin', title: 'A Metin is falling!' }, 3200, 'metinWarn');
    expect(announcements.value).toHaveLength(1);
    expect(announcements.value[0]?.tone).toBe('metin');
  });

  it('a boss / big banner is never replaced by a hint', () => {
    announce({ tone: 'boss', title: 'Boss approaches', big: true }, 4600, 'boss1');
    hint('h3');
    expect(announcements.value).toHaveLength(1);
    expect(announcements.value[0]?.tone).toBe('boss');
  });

  it('a hint is never swallowed by the 0.9 s de-duplication of banners (it is once-per-profile already)', () => {
    announce({ tone: 'info', title: 'Tip · A', sub: 'a', hint: true }, HINT_TTL_MS, 'hint:dup');
    clearAnnouncements();
    announce({ tone: 'info', title: 'Tip · A', sub: 'a', hint: true }, HINT_TTL_MS, 'hint:dup');
    expect(announcements.value.map((a) => a.title)).toEqual(['Tip · A']);
    // a plain banner under the same key within 0.9 s still is swallowed (the old rule)
    announce({ tone: 'danger', title: 'Same' }, 2000, 'k-plain');
    clearAnnouncements();
    announce({ tone: 'danger', title: 'Same' }, 2000, 'k-plain');
    expect(announcements.value).toEqual([]);
  });

  it('the banner expires through its timer and the feed is empty again', () => {
    hint('h4');
    timers[0]?.fn();
    expect(announcements.value).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// HD-03: the pact / run event / elite affix hints, the run-event banners and the final-boss card
// ---------------------------------------------------------------------------------------------------------------------------------

describe('HD-03 hints: pact, run event, elite affix (the Hints controller)', () => {
  const offer = (cards: { id: string; needs?: string; pact?: { awakens: string[] } }[], player = 0, kind = 'levelUp') => ({ kind, request: { player, cards } });

  it('pact: the first offer with a skill card that still needs its pact passive shows the hint with the passive, the rank and the skill', () => {
    const { hints, r, ids, settle } = rig();
    hints.onModal(offer([{ id: 'bladewheel', needs: 'sovereign_wrath' }]));
    settle();
    expect(ids()).toEqual(['pact']);
    expect((r.shown[0] as HintPlate).sub).toBe('Own Dragon Wrath at rank 4 to awaken Bladewheel.');
  });

  it('pact: a passive card that awakens an owned skill does too; plain offers, another hero\'s offer and pacts off show nothing', () => {
    const a = rig();
    a.hints.onModal(offer([{ id: 'sovereign_wrath', pact: { awakens: ['bladewheel'] } }]));
    a.settle();
    expect(a.ids()).toEqual(['pact']);
    const b = rig();
    b.hints.onModal(offer([{ id: 'bash' }, { id: 'bladewheel' }]));
    b.hints.onModal(offer([{ id: 'bladewheel', needs: 'sovereign_wrath' }], 1)); // co-op: the other hero's offer
    b.hints.onModal(offer([{ id: 'bladewheel', needs: 'sovereign_wrath' }], 0, 'bossReward')); // not an offer the hint is read from
    b.settle();
    expect(b.ids()).toEqual([]);
    const c = rig({ pactLine: () => null }); // balance.pacts.rank 0
    c.hints.onModal(offer([{ id: 'bladewheel', needs: 'sovereign_wrath' }]));
    c.settle();
    expect(c.ids()).toEqual([]);
  });

  it('pact: a chest offer counts; an essence offer still gives the essence hint, not the pact one', () => {
    const a = rig();
    a.hints.onModal(offer([{ id: 'bladewheel', needs: 'sovereign_wrath' }], 0, 'chest'));
    a.settle();
    expect(a.ids()).toEqual(['pact']);
    const b = rig();
    b.hints.onModal({ kind: 'essence', request: { player: 0 } });
    b.settle();
    expect(b.ids()).toEqual(['essence']);
  });

  it('event: only the running phase raises it (the announcement and the shrine channel do not), once', () => {
    const { hints, ids, settle, settleFor } = rig();
    const e = (phase: string): SimEvent => ev({ t: 'runEvent', kind: 'championHunt', phase, id: 1, x: 0, z: 0, startAt: 395, endAt: 455, player: -1, p: 0 });
    hints.onEvent(e('announce'));
    hints.onEvent(e('channel'));
    hints.onEvent(e('end'));
    settle();
    expect(ids()).toEqual([]);
    hints.onEvent(e('active'));
    settleFor('event');
    expect(ids()).toEqual(['event']);
  });

  it('event: the tip tells the player to read the banner, so it opens only after the banner has been on screen HINT_SETTLE_EVENT_MS', () => {
    const { hints, r, ids, wait } = rig();
    hints.onEvent(ev({ t: 'runEvent', kind: 'championHunt', phase: 'active', id: 1, x: 0, z: 0, startAt: 395, endAt: 455, player: -1, p: 0 }));
    wait(HINT_SETTLE_EVENT_MS - 200); // the plate is up and counting; the default settle (0.3 s) is long past
    expect(ids()).toEqual([]);
    wait(200);
    expect(ids()).toEqual(['event']);
    expect(HINT_SETTLE_EVENT_MS).toBeGreaterThanOrEqual(3000);
    expect((r.shown[0] as HintPlate).sub).toContain('Read the banner');
  });

  it("event: the tip's long wait does not hold the other tips back, and an unread event tip returns without waiting again", () => {
    const { hints, r, ids, wait, replaceBy, seen } = rig();
    TRIGGERS.event(hints);
    wait(100);
    TRIGGERS.levelUp(hints); // queued after the event tip, but ready long before it
    wait(HINT_SETTLE_MS);
    expect(ids()).toEqual(['levelUp']);
    wait(HINT_TTL_MS); // the level-up tip is read and leaves; the event tip's wait is over by then
    expect(seen()).toEqual(['levelUp']);
    wait(HINT_GAP_MS);
    expect(ids()).toEqual(['levelUp', 'event']);
    // a banner takes the event tip's row before it was read: it is queued again, first in line, and only has the short settle to wait out
    replaceBy();
    wait(100);
    expect(seen()).toEqual(['levelUp']);
    r.plate = false;
    wait(HINT_GAP_MS + HINT_SETTLE_MS + 200);
    expect(ids()).toEqual(['levelUp', 'event', 'event']);
  });

  const elite = (over: Record<string, unknown> = {}): SimEvent => ev({ t: 'enemySpawn', enemy: 1, type: 0, x: 0, z: 0, tier: 1, source: 5, ...over });

  it('affix: the band\'s elite (tier 1, source 5) from affixes.fromBand on, read at the sim clock of the World', () => {
    const early = rig();
    early.hints.onEvent(elite(), { time: 100 }); // band 0: no affix yet
    early.settle();
    expect(early.ids()).toEqual([]);
    early.hints.onEvent(elite(), { time: 200 }); // band 1
    early.settle();
    expect(early.ids()).toEqual(['affix']);
  });

  it('affix: not for the champion (tier 2), an ordinary creature, a boss spawn, or while affixes are off; a source without a World reads the HUD clock', () => {
    const a = rig();
    for (const o of [{ tier: 2 }, { source: 0 }, { source: 3, tier: 0 }, { tier: 0 }]) a.hints.onEvent(elite(o), { time: 400 });
    a.settle();
    expect(a.ids()).toEqual([]);
    const off = rig({ affixFrom: () => undefined });
    off.hints.onEvent(elite(), { time: 400 });
    off.settle();
    expect(off.ids()).toEqual([]);
    const guest = rig();
    guest.hints.onHud(hud({ time: 250 }));
    guest.hints.onEvent(elite()); // a guest's event source passes no World
    guest.settle();
    expect(guest.ids()).toEqual(['affix']);
  });

  it("affix: the band is the World's zone, not the host's lookup (a co-op room's zone is not the menu's)", () => {
    // the host lookup (the menu's zone) says band 0 for ever; the World's bands (the room's zone) start the second band at 100 s
    const room = rig({ bandAt: () => 0 });
    room.hints.onEvent(elite(), { time: 150, zone: { bands: [{ from: 0 }, { from: 100 }] } });
    room.settle();
    expect(room.ids()).toEqual(['affix']);
    // and the other way round: the host lookup says band 2, the room's zone has not left band 0 yet
    const early = rig({ bandAt: () => 2 });
    early.hints.onEvent(elite(), { time: 150, zone: { bands: [{ from: 0 }, { from: 400 }] } });
    early.settle();
    expect(early.ids()).toEqual([]);
    // no World zone (the gallery): the host lookup
    const gallery = rig({ bandAt: () => 2 });
    gallery.hints.onEvent(elite(), { time: 150 });
    gallery.settle();
    expect(gallery.ids()).toEqual(['affix']);
  });

  it('affix: a late elite of band 2 shows it after a band-0 elite did not', () => {
    const { hints, ids, settle, wait } = rig();
    hints.onEvent(elite(), { time: 50 });
    settle();
    expect(ids()).toEqual([]);
    wait(1000);
    hints.onEvent(elite(), { time: 380 });
    settle();
    expect(ids()).toEqual(['affix']);
  });

  it('the plates read as the spec says in English', () => {
    const { hints, r, settle } = rig();
    TRIGGERS.affix(hints);
    settle();
    expect((r.shown[0] as HintPlate).title).toBe('Tip · Elite affixes');
    expect((r.shown[0] as HintPlate).sub).toContain('Elites carry affixes');
    expect((r.shown[0] as HintPlate).sub).toContain('sigil on the ground beneath them'); // EL-03 draws the sigil under the elite, not over its head
  });
});

describe('HD-03: pactLineOf and bandIndexAt', () => {
  const content = (rank: number | undefined, passiveMax = 5): Pick<ContentDB, 'balance' | 'passives' | 'skills'> =>
    ({
      balance: rank === undefined ? {} : { pacts: { rank } },
      passives: [{ id: 'sovereign_wrath', maxRank: passiveMax, name: { en: 'Dragon Wrath', tr: 'Ejderha Gazabı' } }],
      skills: [{ id: 'bladewheel', name: { en: 'Bladewheel', tr: 'Kılıç Dönüşü' } }],
    }) as unknown as Pick<ContentDB, 'balance' | 'passives' | 'skills'>;

  it('a skill card that needs a passive: the passive, the skill, the pact rank', () => {
    expect(pactLineOf(content(4), [{ id: 'bash' }, { id: 'bladewheel', needs: 'sovereign_wrath' }])).toEqual({ passive: 'Dragon Wrath', skill: 'Bladewheel', rank: 4 });
  });

  it('a passive card that awakens a skill: the card is the passive, the first awakened skill is the skill', () => {
    expect(pactLineOf(content(2), [{ id: 'sovereign_wrath', pact: { awakens: ['bladewheel', 'bash'] } }])).toEqual({ passive: 'Dragon Wrath', skill: 'Bladewheel', rank: 2 });
  });

  it('the rank is capped at the passive\'s own maximum; pacts off (rank 0 or none) and cards without a pact line give null', () => {
    expect(pactLineOf(content(4, 2), [{ id: 'bladewheel', needs: 'sovereign_wrath' }])?.rank).toBe(2);
    expect(pactLineOf(content(0), [{ id: 'bladewheel', needs: 'sovereign_wrath' }])).toBeNull();
    expect(pactLineOf(content(undefined), [{ id: 'bladewheel', needs: 'sovereign_wrath' }])).toBeNull();
    expect(pactLineOf(content(4), [{ id: 'bash' }, { id: 'sovereign_wrath', pact: { awakens: [] } }])).toBeNull();
  });

  it('a card whose ids the content does not know falls back to the ids', () => {
    expect(pactLineOf(content(4), [{ id: 'ghost_skill', needs: 'ghost_passive' }])).toEqual({ passive: 'ghost_passive', skill: 'ghost_skill', rank: 4 });
  });

  it('bandIndexAt: the last band that has started (0 before the first, 0 without bands)', () => {
    const bands = [{ from: 0 }, { from: 180 }, { from: 360 }];
    expect([0, 179, 180, 359, 360, 900].map((s) => bandIndexAt(bands, s))).toEqual([0, 0, 1, 1, 2, 2]);
    expect(bandIndexAt(undefined, 500)).toBe(0);
    expect(bandIndexAt([], 500)).toBe(0);
  });
});

describe('HD-03 strings', () => {
  const en = dictionaries.en;
  const tr = dictionaries.tr;
  const ph = (s: string): string => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort().join(',');
  const keys = Object.keys(en).filter((k) => k.startsWith('announce.ev.') || k === 'announce.finalCard');

  it('every run-event banner line exists in English and Turkish with the same placeholders', () => {
    expect(keys.length).toBeGreaterThanOrEqual(20);
    for (const k of keys) {
      expect(tr[k], k).toBeTruthy();
      expect(ph(en[k] as string), k).toBe(ph(tr[k] as string));
    }
    for (const k of Object.keys(tr).filter((x) => x.startsWith('announce.ev.'))) expect(en[k], k).toBeTruthy();
  });

  it('every banner sub line that counts down carries {time}; the verdicts carry no sub (they fold like any banner)', () => {
    for (const kind of ['championHunt', 'goldenHour']) {
      for (const stage of ['announce', 'active']) expect(ph(en[`announce.ev.${kind}.${stage}.sub`] as string), `${kind}.${stage}`).toContain('time');
    }
    expect(en['announce.ev.championHunt.won.sub']).toBeUndefined();
    expect(en['announce.ev.championHunt.lost.sub']).toBeUndefined();
    expect(en['announce.ev.goldenHour.won.sub']).toBeUndefined();
  });

  it('the elite affix tip points at the sigil on the ground, in both languages (EL-03 draws it under the elite)', () => {
    expect(en['hint.affix.text']).toContain('on the ground beneath them');
    expect(en['hint.affix.text']).not.toMatch(/over their head/);
    expect(tr['hint.affix.text']).toContain('ayaklarının altındaki');
    expect(tr['hint.affix.text']).not.toMatch(/başlarındaki/);
  });

  it('the pact hint reads "Own <passive> at rank N to awaken <skill>" with its three placeholders', () => {
    expect(ph(en['hint.pact.text'] as string)).toBe('passive,rank,skill');
    expect(ph(tr['hint.pact.text'] as string)).toBe('passive,rank,skill');
    expect((en['hint.pact.text'] as string).startsWith('Own {passive} at rank {rank} to awaken')).toBe(true);
  });
});

describe('attachHints: the HD-03 hints over the HUD, the sim events and the modal state', () => {
  type Listener = (e: SimEvent, w?: unknown) => void;
  const SETTLED = HINT_SETTLE_MS + 500;

  function wire(contentOver: Record<string, unknown> = {}) {
    const store = new GameStore();
    const subs = new Set<Listener>();
    const events = { subscribe: (fn: Listener) => (subs.add(fn), () => void subs.delete(fn)) };
    const content = {
      metins: [],
      zones: [{ id: 'yeonmu', bands: [{ from: 0 }, { from: 180 }, { from: 360 }] }],
      skills: [{ id: 'bladewheel', name: { en: 'Bladewheel', tr: 'Kılıç Dönüşü' } }],
      passives: [{ id: 'sovereign_wrath', maxRank: 5, name: { en: 'Dragon Wrath', tr: 'Ejderha Gazabı' } }],
      balance: { pacts: { rank: 4 } },
      affixes: { enabled: true, fromBand: 1 },
      ...contentOver,
    } as unknown as ContentDB;
    const shown: HintPlate[] = [];
    let feed: string | null = null;
    const plates: HintPlates = {
      show: (p) => {
        shown.push(p);
        feed = p.id;
      },
      busy: () => feed !== null,
      has: (id) => feed === id,
      withdraw: (id) => {
        if (feed === id) feed = null;
      },
    };
    const off = attachHints({ store, content, events: events as never }, plates);
    const emit = (e: Record<string, unknown>, w?: unknown): void => {
      for (const fn of subs) fn(ev(e), w);
    };
    return { store, shown, emit, off, ids: (): string[] => shown.map((p) => p.id) };
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance', 'Date'] });
  });

  it('a level-up offer with a pact card: its plate follows the offer, with the real names from the content', () => {
    const w = wire();
    w.store.setHud({ alive: true, corruption: 0, rerolls: 2, banishes: 1 } as unknown as HudSnapshot);
    w.store.setSimModal({ id: 5, kind: 'levelUp', player: 0, cards: [{ id: 'bladewheel', needs: 'sovereign_wrath' }] } as never);
    vi.advanceTimersByTime(SETTLED);
    expect(w.ids()).toEqual([]); // the offer covers the HUD
    w.store.setSimModal(null);
    vi.advanceTimersByTime(SETTLED);
    expect(w.ids()).toEqual(['pact']);
    expect(w.shown[0]?.sub).toBe('Own Dragon Wrath at rank 4 to awaken Bladewheel.');
    w.off();
  });

  it('pacts off in the content: the same offer shows no pact plate', () => {
    const w = wire({ balance: {} });
    w.store.setHud({ alive: true, corruption: 0, rerolls: 2, banishes: 1 } as unknown as HudSnapshot);
    w.store.setSimModal({ id: 5, kind: 'levelUp', player: 0, cards: [{ id: 'bladewheel', needs: 'sovereign_wrath' }] } as never);
    w.store.setSimModal(null);
    vi.advanceTimersByTime(SETTLED);
    expect(w.ids()).toEqual([]);
    w.off();
  });

  it('the first elite in band 1 with affixes on shows the affix plate; with affixes off (the shipped content) it never does', () => {
    const on = wire();
    on.store.setHud({ alive: true, corruption: 0, rerolls: 2, banishes: 1, time: 200 } as unknown as HudSnapshot);
    on.emit({ t: 'enemySpawn', enemy: 1, type: 0, x: 0, z: 0, tier: 1, source: 5 }, { time: 200 });
    vi.advanceTimersByTime(SETTLED);
    expect(on.ids()).toEqual(['affix']);
    on.off();
    settings.update({ hintsSeen: [] });
    const off = wire({ affixes: { enabled: false, fromBand: 1 } });
    off.emit({ t: 'enemySpawn', enemy: 1, type: 0, x: 0, z: 0, tier: 1, source: 5 }, { time: 200 });
    vi.advanceTimersByTime(SETTLED);
    expect(off.ids()).toEqual([]);
    off.off();
  });

  it('the first running run event shows the event plate', () => {
    const w = wire();
    w.store.setHud({ alive: true, corruption: 0, rerolls: 2, banishes: 1 } as unknown as HudSnapshot);
    w.emit({ t: 'runEvent', kind: 'goldenHour', phase: 'announce', id: 1, x: 0, z: 0, startAt: 395, endAt: 440, player: -1, p: 0 });
    vi.advanceTimersByTime(SETTLED);
    expect(w.ids()).toEqual([]);
    w.emit({ t: 'runEvent', kind: 'goldenHour', phase: 'active', id: 1, x: 0, z: 0, startAt: 395, endAt: 440, player: -1, p: 0 });
    vi.advanceTimersByTime(SETTLED);
    expect(w.ids()).toEqual([]); // the event's plate is on screen and being read first
    vi.advanceTimersByTime(HINT_SETTLE_EVENT_MS);
    expect(w.ids()).toEqual(['event']);
    w.off();
  });

  it("the affix plate reads the band from the World the event hub passes, not from the menu's zone (co-op)", () => {
    // the selection (the menu's pick) is yeonmu, whose bands start at 0 / 180 / 360; the room's zone has its second band from 60 s
    const w = wire();
    w.store.setHud({ alive: true, corruption: 0, rerolls: 2, banishes: 1, time: 100 } as unknown as HudSnapshot);
    w.emit({ t: 'enemySpawn', enemy: 1, type: 0, x: 0, z: 0, tier: 1, source: 5 }, { time: 100, zone: { bands: [{ from: 0 }, { from: 60 }] } });
    vi.advanceTimersByTime(SETTLED);
    expect(w.ids()).toEqual(['affix']);
    w.off();
    settings.update({ hintsSeen: [] });
    const x = wire();
    x.store.setHud({ alive: true, corruption: 0, rerolls: 2, banishes: 1, time: 200 } as unknown as HudSnapshot);
    x.emit({ t: 'enemySpawn', enemy: 1, type: 0, x: 0, z: 0, tier: 1, source: 5 }, { time: 200, zone: { bands: [{ from: 0 }, { from: 300 }] } }); // the menu's zone would say band 1 here
    vi.advanceTimersByTime(SETTLED);
    expect(x.ids()).toEqual([]);
    x.off();
  });
});

describe('run-event banners: announce.ts over the HUD snapshot (HD-03)', () => {
  type Listener = (e: SimEvent, w?: unknown) => void;
  /** every wire gets its own event id and boss number: the banner feed de-duplicates a key within 0.9 s */
  let nextId = 7000;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance', 'Date'] });
    // announce() runs its expiry timers on window.setTimeout
    vi.stubGlobal('window', { setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms) });
    settings.update({ showHints: false });
    clearAnnouncements();
  });
  afterEach(() => {
    setDeps(null);
    clearAnnouncements();
  });

  const mkContent = (): ContentDB =>
    ({
      classes: [],
      skills: [],
      passives: [],
      stones: [],
      trinkets: [],
      enemies: [],
      gear: [],
      empires: [],
      bosses: [{ id: 'boss_horyeong', name: { en: 'Horyeong', tr: 'Horyeong' }, title: { en: 'Lord of the Cave', tr: 'Mağara Lordu' } }],
      metins: [{ id: 'metin_a', awakenAfter: 90, rune: '#4cc9f0', name: { en: 'Metin of Lament', tr: 'Keder Metini' } }],
      zones: [{ id: 'yeonmu', order: 1, metins: { types: ['metin_a'] }, bands: [{ from: 0 }, { from: 180 }] }],
      balance: {},
    }) as unknown as ContentDB;

  function wire() {
    const store = new GameStore();
    const subs = new Set<Listener>();
    const events = { subscribe: (fn: Listener) => (subs.add(fn), () => void subs.delete(fn)) };
    const content = mkContent();
    setDeps({ store, content } as unknown as UiDeps);
    const off = attachAnnounceFeed({ store, content, events: events as never });
    const id = nextId++;
    const emit = (e: Record<string, unknown>): void => {
      for (const fn of subs) fn(ev(e));
    };
    const runEv = (kind: string, phase: string, extra: Record<string, unknown> = {}): void =>
      emit({ t: 'runEvent', kind, phase, id, x: 0, z: 0, startAt: 395, endAt: 455, player: -1, p: 0, ...extra });
    /** a HUD snapshot at run second `time`, carrying the run event the way the host's sim / the guest's mirror fills it (null = none) */
    const hudAt = (time: number, runEvent: { kind: string; phase: string; left: number } | null = null): void =>
      store.setHud({ alive: true, corruption: 0, rerolls: 2, banishes: 1, time, runEvent: runEvent ? { x: 0, z: 0, ...runEvent } : null } as unknown as HudSnapshot);
    const rows = (): string[] => announcements.value.map((a) => `${a.tone}|${a.title}|${a.sub ?? ''}`);
    return { store, emit, runEv, hudAt, rows, off, id };
  }

  const CTX = { rune: '#4cc9f0', yeop: 2, elite: 2, channel: 2 };

  describe('the mapping (eventBanner)', () => {
    it('Metin Rain: the metin tone in the zone\'s rune colour, the stones\' countdown, then the call to break them', () => {
      const a = eventBanner('metinRain', 'announce', 4.2, CTX);
      expect(a).toMatchObject({ tone: 'metin', title: 'A rain of Metins!', sub: 'The stones fall in 00:05', color: '#4cc9f0' });
      expect(eventBanner('metinRain', 'active', 40, CTX)).toMatchObject({ tone: 'metin', title: 'The stones are falling!', sub: 'Break them before they awaken', color: '#4cc9f0' });
    });

    it('Champion Hunt: the danger tone, the 60 s countdown on the sub line', () => {
      expect(eventBanner('championHunt', 'announce', 2.5, CTX)).toMatchObject({ tone: 'danger', title: 'A champion hunts you!', sub: 'It arrives in 00:03' });
      expect(eventBanner('championHunt', 'active', 60, CTX)).toMatchObject({ tone: 'danger', title: 'Champion Hunt', sub: 'Slay it before it escapes: 01:00' });
      expect(eventBanner('championHunt', 'active', 59.2, CTX)?.sub).toBe('Slay it before it escapes: 01:00'); // whole seconds, rounded up
      expect(eventBanner('championHunt', 'active', 0.2, CTX)?.sub).toBe('Slay it before it escapes: 00:01');
    });

    it('Golden Hour: the victory tone, the content\'s Yeop and elite multipliers, a countdown', () => {
      expect(eventBanner('goldenHour', 'announce', 5, CTX)).toMatchObject({ tone: 'victory', title: 'Golden Hour', sub: 'Begins in 00:05' });
      expect(eventBanner('goldenHour', 'active', 45, CTX)).toMatchObject({ tone: 'victory', title: 'Golden Hour', sub: 'Yeop x2, elites x2: 00:45' });
      expect(eventBanner('goldenHour', 'active', 45, { ...CTX, yeop: 1.5, elite: 1.7 })?.sub).toBe('Yeop x1.5, elites x1.7: 00:45');
    });

    it('the Sky Sovereign\'s shrine: the info tone, "a shrine appeared", the channel seconds from the content', () => {
      expect(eventBanner('bargain', 'active', 40, CTX)).toMatchObject({ tone: 'info', title: 'A Sky Sovereign shrine appeared', sub: 'Stand on it for 2 s to make a bargain: 00:40' });
      expect(eventBanner('bargain', 'announce', 5, CTX)).toMatchObject({ tone: 'info', title: 'A Sky Sovereign shrine stirs' });
      expect(eventBanner('bargain', 'active', 40, { ...CTX, channel: 3 })?.sub).toContain('3 s');
    });

    it('the verdicts: Champion slain (victory) / escaped (danger) / Golden Hour is over (victory), none with a sub line; Metin Rain and the shrine have none', () => {
      expect(eventBanner('championHunt', 'won', 0, CTX)).toEqual({ tone: 'victory', title: 'Champion slain! Claim its chest' });
      expect(eventBanner('championHunt', 'lost', 0, CTX)).toEqual({ tone: 'danger', title: 'The champion escaped' });
      expect(eventBanner('goldenHour', 'won', 0, CTX)).toEqual({ tone: 'info', color: '#e4bd62', title: 'Golden Hour is over' });
      expect(eventBanner('metinRain', 'won', 0, CTX)).toBeNull();
      expect(eventBanner('bargain', 'lost', 0, CTX)).toBeNull();
    });

    it('a kind nobody wrote wording for shows nothing; a banner that counts down remembers its key, the others do not', () => {
      expect(eventBanner('mystery', 'active', 10, CTX)).toBeNull();
      expect(eventBanner('championHunt', 'active', 10, CTX)?.ev?.subKey).toBe('announce.ev.championHunt.active.sub');
      expect(eventBanner('championHunt', 'won', 0, CTX)?.ev).toBeUndefined();
    });

    it('the tones are the spec\'s', () => {
      expect(Object.fromEntries(Object.entries(EVENT_STYLE).map(([k, v]) => [k, v.tone]))).toEqual({ metinRain: 'metin', championHunt: 'danger', goldenHour: 'victory', bargain: 'info' });
    });

    it('Turkish reads the same numbers', () => {
      settings.update({ language: 'tr' });
      expect(eventBanner('championHunt', 'active', 60, CTX)?.sub).toBe('Kaçmadan önce öldür: 01:00');
      expect(eventBanner('goldenHour', 'active', 45, CTX)?.sub).toBe('Yeop x2, elitler x2: 00:45');
      settings.update({ language: 'en' });
    });
  });

  describe('Champion Hunt: one standing plate whose countdown is the HUD snapshot\'s', () => {
    it('announce -> active -> verdict: the plate counts down from runEvent.left, a new stage opens a new plate, a repeat changes nothing', () => {
      const w = wire();
      w.hudAt(390);
      w.runEv('championHunt', 'announce');
      expect(w.rows()).toEqual(['danger|A champion hunts you!|It arrives in 00:05']);
      const first = announcements.value[0] as Announcement;
      w.hudAt(391.2, { kind: 'championHunt', phase: 'announce', left: 3.8 });
      expect(w.rows()).toEqual(['danger|A champion hunts you!|It arrives in 00:04']);
      expect(announcements.value[0]?.id).toBe(first.id); // the same plate: the number changed, nothing re-opened
      const same = announcements.value;
      w.hudAt(391.3, { kind: 'championHunt', phase: 'announce', left: 3.7 }); // the same second: no new render
      expect(announcements.value).toBe(same);
      w.runEv('championHunt', 'announce'); // the 5 s heartbeat of the sim
      expect(announcements.value[0]?.id).toBe(first.id);

      w.hudAt(395.1, { kind: 'championHunt', phase: 'active', left: 59.9 });
      w.runEv('championHunt', 'active');
      expect(w.rows()).toEqual(['danger|Champion Hunt|Slay it before it escapes: 01:00']);
      const active = announcements.value[0] as Announcement;
      expect(active.id).not.toBe(first.id); // the row opens again for the hunt
      w.hudAt(425.5, { kind: 'championHunt', phase: 'active', left: 29.5 });
      expect(w.rows()).toEqual(['danger|Champion Hunt|Slay it before it escapes: 00:30']);
      w.runEv('championHunt', 'active'); // heartbeat
      w.runEv('championHunt', 'announce'); // a stale repeat of the earlier stage never takes the plate back
      expect(announcements.value[0]?.id).toBe(active.id);
      expect(w.rows()).toEqual(['danger|Champion Hunt|Slay it before it escapes: 00:30']);

      w.hudAt(430, { kind: 'championHunt', phase: 'end', left: 0 });
      w.runEv('championHunt', 'end', { endAt: 430, p: 1 });
      expect(w.rows()).toEqual(['victory|Champion slain! Claim its chest|']);
      vi.advanceTimersByTime(2600);
      expect(w.rows()).toEqual([]);
      w.off();
    });

    it('the plate never expires by a timer: a minute later it is still there, with the HUD\'s number', () => {
      const w = wire();
      w.hudAt(395.1, { kind: 'championHunt', phase: 'active', left: 59.9 });
      w.runEv('championHunt', 'active');
      vi.advanceTimersByTime(60_000);
      expect(w.rows()).toHaveLength(1);
      w.hudAt(450, { kind: 'championHunt', phase: 'active', left: 5 });
      expect(w.rows()).toEqual(['danger|Champion Hunt|Slay it before it escapes: 00:05']);
      w.off();
    });

    it('a language switched mid-event shows on the plate at the next HUD snapshot (title and countdown line)', () => {
      const w = wire();
      w.hudAt(395.1, { kind: 'championHunt', phase: 'active', left: 59.9 });
      w.runEv('championHunt', 'active');
      expect(w.rows()).toEqual(['danger|Champion Hunt|Slay it before it escapes: 01:00']);
      settings.update({ language: 'tr' });
      w.hudAt(395.2, { kind: 'championHunt', phase: 'active', left: 59.8 });
      expect(w.rows()).toEqual(['danger|Şampiyon Avı|Kaçmadan önce öldür: 01:00']);
      settings.update({ language: 'en' });
      w.off();
    });

    it('a transient banner (a boss) takes the row for its own time, then the plate is back with the current number', () => {
      const w = wire();
      w.hudAt(395.1, { kind: 'championHunt', phase: 'active', left: 59.9 });
      w.runEv('championHunt', 'active');
      const plate = announcements.value[0] as Announcement;
      announce({ tone: 'boss', title: 'Horyeong approaches', big: true }, 4600, `hd03-boss-${w.id}`);
      expect(w.rows()).toEqual(['boss|Horyeong approaches|']);
      w.hudAt(397, { kind: 'championHunt', phase: 'active', left: 58 }); // the clock runs under the banner
      vi.advanceTimersByTime(2500);
      expect(w.rows()).toEqual(['danger|Champion Hunt|Slay it before it escapes: 00:58']);
      expect(announcements.value[0]?.id).toBe(plate.id);
      w.off();
    });

    it('the verdict of a failed hunt: it ran out of time (the end is at the planned end) = the champion escaped; the run ending first = no verdict', () => {
      const lost = wire();
      lost.hudAt(395.1, { kind: 'championHunt', phase: 'active', left: 59.9 });
      lost.runEv('championHunt', 'active');
      lost.runEv('championHunt', 'end', { endAt: 455, p: 0 });
      expect(lost.rows()).toEqual(['danger|The champion escaped|']);
      lost.off();
      clearAnnouncements();

      const cut = wire();
      cut.hudAt(395.1, { kind: 'championHunt', phase: 'active', left: 59.9 });
      cut.runEv('championHunt', 'active');
      cut.runEv('championHunt', 'end', { endAt: 410, p: 0 }); // the hero fell at 410: the framework ends the event with the run
      expect(cut.rows()).toEqual([]);
      cut.off();
      clearAnnouncements();

      const over = wire();
      over.hudAt(395.1, { kind: 'championHunt', phase: 'active', left: 59.9 });
      over.runEv('championHunt', 'active');
      over.emit({ t: 'runEnd', victory: false });
      expect(over.rows()).toEqual([]); // no plate over the end screen
      over.runEv('championHunt', 'end', { endAt: 455, p: 0 });
      expect(over.rows()).toEqual([]);
      over.off();
    });

    it('a plate whose event the HUD no longer shows (a lost "end") goes after 1.5 s of the HUD clock; a HUD that still shows it keeps it', () => {
      const w = wire();
      w.hudAt(395.1, { kind: 'championHunt', phase: 'active', left: 59.9 });
      w.runEv('championHunt', 'active');
      w.hudAt(396, null); // one snapshot without the event (it was emitted after it was built)
      expect(w.rows()).toHaveLength(1);
      w.hudAt(396.2, { kind: 'championHunt', phase: 'active', left: 58.8 });
      w.hudAt(400, null);
      w.hudAt(401, null);
      expect(w.rows()).toHaveLength(1); // 1.0 s
      w.hudAt(401.6, null);
      expect(w.rows()).toEqual([]);
      w.off();
    });

    it('no HUD (the run is over): the plate is gone; a new run on the same HUD (the clock went back) starts clean', () => {
      const w = wire();
      w.hudAt(395.1, { kind: 'championHunt', phase: 'active', left: 59.9 });
      w.runEv('championHunt', 'active');
      w.emit({ t: 'runEnd', victory: true });
      w.store.setHud(null);
      expect(w.rows()).toEqual([]);
      // a new run on the same mounted HUD: the clock restarts, the old event id is forgotten
      w.hudAt(5);
      w.hudAt(390);
      w.runEv('championHunt', 'announce');
      expect(w.rows()).toEqual(['danger|A champion hunts you!|It arrives in 00:05']);
      w.off();
    });
  });

  describe('Golden Hour, Metin Rain and the shrine', () => {
    it('Golden Hour: a gold standing plate with the content\'s multipliers and the HUD\'s countdown, then "is over"', () => {
      const w = wire();
      w.hudAt(395.1, { kind: 'goldenHour', phase: 'active', left: 44.9 });
      w.runEv('goldenHour', 'active', { endAt: 440 });
      expect(w.rows()).toEqual(['victory|Golden Hour|Yeop x2, elites x2: 00:45']);
      w.hudAt(420, { kind: 'goldenHour', phase: 'active', left: 20 });
      expect(w.rows()).toEqual(['victory|Golden Hour|Yeop x2, elites x2: 00:20']);
      w.runEv('goldenHour', 'end', { endAt: 440, p: 1 });
      expect(w.rows()).toEqual(['info|Golden Hour is over|']);
      w.off();
    });

    it('Metin Rain: a transient banner in the rune colour, its countdown live while it shows, bannered once per phase (a heartbeat is no new banner)', () => {
      const w = wire();
      w.hudAt(390);
      w.runEv('metinRain', 'announce', { startAt: 395, endAt: 470 });
      expect(w.rows()).toEqual(['metin|A rain of Metins!|The stones fall in 00:05']);
      expect(announcements.value[0]?.color).toBe('#4cc9f0');
      const id = announcements.value[0]?.id;
      w.hudAt(392.5, { kind: 'metinRain', phase: 'announce', left: 2.5 });
      expect(w.rows()).toEqual(['metin|A rain of Metins!|The stones fall in 00:03']);
      w.runEv('metinRain', 'announce', { startAt: 395, endAt: 470 }); // the heartbeat
      expect(announcements.value[0]?.id).toBe(id);
      vi.advanceTimersByTime(2500);
      expect(w.rows()).toEqual([]); // an ordinary banner: it folds after 2.5 s, no standing plate for the rain
      w.runEv('metinRain', 'active', { startAt: 395, endAt: 470 });
      expect(w.rows()).toEqual(['metin|The stones are falling!|Break them before they awaken']);
      w.off();
    });

    it('the shrine: an info banner that holds 6 s, replaces a hint plate but never a boss card', () => {
      const w = wire();
      w.hudAt(430);
      announce({ tone: 'info', title: 'Tip · Boss', sub: 'Bosses drop gear', hint: true, hintId: 'boss' }, HINT_TTL_MS, `hd03-hint-${w.id}`);
      w.runEv('bargain', 'active', { endAt: 470 });
      expect(w.rows()).toEqual(['info|A Sky Sovereign shrine appeared|Stand on it for 2 s to make a bargain: 00:40']);
      vi.advanceTimersByTime(5900);
      expect(w.rows()).toHaveLength(1);
      vi.advanceTimersByTime(200);
      expect(w.rows()).toEqual([]);
      clearAnnouncements();

      const x = wire();
      x.hudAt(430);
      announce({ tone: 'boss', title: 'Horyeong approaches', big: true }, 4600, `hd03-boss2-${x.id}`);
      x.runEv('bargain', 'active', { endAt: 470 });
      expect(x.rows()).toEqual(['boss|Horyeong approaches|']);
      x.off();
    });

    it('the shrine\'s channel progress and kinds nobody wrote wording for make no banner', () => {
      const w = wire();
      w.hudAt(430);
      w.runEv('bargain', 'channel', { player: 0, p: 0.5 });
      w.runEv('mystery', 'active');
      w.runEv('mystery', 'announce');
      expect(w.rows()).toEqual([]);
      w.off();
    });
  });

  describe('a co-op guest shows the same banner and the same timer', () => {
    it('the HUD view a guest builds from the mirrored event (runEventHudOf, the mirror\'s own function) gives the host\'s text, also when the event is first met mid-way (late join)', () => {
      const view = { kind: 'championHunt', phase: 'active' as const, x: 3, z: 4, startAt: 395, endAt: 455 };
      const asHud = (w: ReturnType<typeof wire>, now: number): void =>
        w.store.setHud({ alive: true, corruption: 0, rerolls: 2, banishes: 1, time: now, runEvent: runEventHudOf(view, now) } as unknown as HudSnapshot);

      const host = wire();
      host.hudAt(390);
      host.runEv('championHunt', 'announce');
      host.runEv('championHunt', 'active');
      asHud(host, 417.4);

      const guest = wire(); // joins at 417.4: the first thing it meets is the 5 s heartbeat of the active phase
      asHud(guest, 417.4);
      guest.runEv('championHunt', 'active');

      expect(guest.rows()).toEqual(host.rows());
      expect(guest.rows()).toEqual(['danger|Champion Hunt|Slay it before it escapes: 00:38']);
      asHud(guest, 440);
      asHud(host, 440);
      expect(guest.rows()).toEqual(host.rows());
      expect(guest.rows()).toEqual(['danger|Champion Hunt|Slay it before it escapes: 00:15']);
      host.off();
      guest.off();
    });

    it('with no HUD view of the event yet (the event came a snapshot before the HUD did), the plate counts from the planned times against the HUD clock', () => {
      const w = wire();
      w.hudAt(420); // no runEvent in the snapshot
      w.runEv('championHunt', 'active', { startAt: 395, endAt: 455 });
      expect(w.rows()).toEqual(['danger|Champion Hunt|Slay it before it escapes: 00:35']);
      w.off();
    });
  });

  describe('the first-event hint sits over the plate, and the plate comes back after it', () => {
    it('hints on: the event plate is the banner until the tip opens, the tip takes the row for its 6 s, the plate returns', () => {
      settings.update({ showHints: true, hintsSeen: [] });
      const w = wire();
      w.hudAt(395.1, { kind: 'championHunt', phase: 'active', left: 59.9 });
      w.runEv('championHunt', 'active');
      expect(w.rows()).toEqual(['danger|Champion Hunt|Slay it before it escapes: 01:00']);
      vi.advanceTimersByTime(HINT_SETTLE_EVENT_MS + 500);
      expect(w.rows()[0]?.startsWith('info|Tip · Run event|')).toBe(true);
      vi.advanceTimersByTime(HINT_TTL_MS + 100);
      expect(w.rows()[0]?.startsWith('danger|Champion Hunt|')).toBe(true);
      w.off();
    });
  });

  describe('the final boss\'s card (A-11)', () => {
    const bossEv = (final: boolean, boss: number): Record<string, unknown> => ({ t: 'bossSpawn', boss, enemy: 1, bossId: 'boss_horyeong', x: 0, z: 0, final });

    it('the final boss: a big boss card "The Great Metin falls: <boss> rises" with the epithet, held 4.6 s', () => {
      const w = wire();
      w.emit(bossEv(true, w.id));
      expect(w.rows()).toEqual(['boss|The Great Metin falls: Horyeong rises|Lord of the Cave']);
      expect(announcements.value[0]).toMatchObject({ tone: 'boss', big: true, final: true });
      vi.advanceTimersByTime(4500);
      expect(w.rows()).toHaveLength(1);
      vi.advanceTimersByTime(200);
      expect(w.rows()).toEqual([]);
      w.off();
    });

    it('a band boss keeps the smaller big-title card: "<boss> approaches", the 2.5 s of every banner, no final flag', () => {
      const w = wire();
      w.emit(bossEv(false, w.id));
      expect(w.rows()).toEqual(['boss|Horyeong approaches|Lord of the Cave']);
      expect(announcements.value[0]?.big).toBe(true);
      expect(announcements.value[0]?.final).toBeUndefined();
      vi.advanceTimersByTime(2600);
      expect(w.rows()).toEqual([]);
      w.off();
    });

    it('the final card is never pushed off by an info toast, and it reads in Turkish too', () => {
      const w = wire();
      w.emit(bossEv(true, w.id));
      announce({ tone: 'info', title: 'Chest opened' }, 1800, `hd03-chest-${w.id}`);
      expect(announcements.value[0]?.final).toBe(true);
      settings.update({ language: 'tr' });
      const x = wire();
      x.emit(bossEv(true, x.id));
      expect(announcements.value[0]?.title).toBe('Büyük Metin düştü: Horyeong yükseliyor');
      settings.update({ language: 'en' });
      w.off();
      x.off();
    });
  });
});
