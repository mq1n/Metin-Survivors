// RS-02a (redo) run events: the framework in sim/runEvents.ts (schedule, phases, heartbeat, run end, pause, channel, HUD) driven by test kinds,
// RS-02b (redo) the first real kind, Metin Rain, RS-03 (redo) the Champion Hunt, EV-01 the Golden Hour and EV-02a the Sky Sovereign's Bargain
// shrine at the end of this file.
// The shipped content lists no zone, so a default world has no event and draws no random number (HASH-EQ).

import { afterEach, describe, expect, it } from 'vitest';
import { content as realContent } from '../../data/loader';
import type { ContentDB, MetinDef, RunEventKind, RunEventsDef } from '../../data/schema';
import { DEFAULT_RUN_EVENTS } from '../../data/schema';
import { CoopHarness } from '../../net/coop/harness';
import { FIXTURE_ZONE_ID } from '../__fixtures__/content';
import { BARGAIN_SOURCE, BARGAIN_IDS, PACED_FLAG, bargainPace, bargainsTaken, freeChestsLeft, openBargain, openLevelUp } from '../cards';
import { hitEnemy, hurtPlayer, newHitCtx } from '../combat';
import { CAP, DT, ENEMY_SOFT_CAP, Surface } from '../constants';
import type { SimEvent } from '../events';
import { METIN_WARN_TIME, fallSiteClear, metinAwakenTime, startFalling } from '../metins';
import { dropEventChest } from '../pickups';
import { beginVictory } from '../progress';
import { refreshStats } from '../stats';
import { createStreams } from '../rng';
import type { CoopPlayerInit } from '../run';
import {
  BARGAIN_ACTIVE,
  BARGAIN_RING_MAX,
  BARGAIN_RING_MIN,
  CHAMPION_SCALE,
  GOLDEN_HOUR_MODS_ID,
  RUN_EVENT_ANNOUNCE,
  RUN_EVENT_CHANNEL_HZ,
  RUN_EVENT_HEARTBEAT,
  RUN_EVENT_LINGER,
  RUN_EVENT_MOVE_DIST,
  RUN_EVENT_MOVE_GAP,
  RAIN_FUSE,
  RUN_EVENT_REFRESH_GRACE,
  refreshRunEvent,
  registerRunEventKind,
  runEventBargainUsed,
  runEventChampion,
  runEventHudOf,
  runEventKindDef,
  runEventLeft,
  setRunEventChannel,
  startSpans,
  unregisterRunEventKind,
  type RunEventEndReason,
  type RunEventKindDef,
  type RunEventRun,
  type RunEventStage,
} from '../runEvents';
import { spawnEnemy } from '../enemies';
import { bandElitePool, despawnEnemy, pickBandCreature, pickBandElite, spawnable } from '../spawner';
import { EnemyFlag, EnemyState, PickupKind, type PlayerState } from '../stores';
import { MetinPhase, type MetinState, type WorldEnv } from '../types';
import { createWorld, type World } from '../world';
import { botInput } from './bot';
import { drainModals, freezeSchedules, makeWorld, NO_INPUT, player, runTicks, spawn, typeOf } from './helpers';

// ---------------------------------------------------------------------------
// helpers

type RunEventSim = Extract<SimEvent, { t: 'runEvent' }>;

const IMMORTAL = { meta: { stats: { maxHp: 1e9 } } } as const;
/** the fixture zone has bosses at 180 and 480 and the final boss at 900: with bossGap 30 the start may fall in [380, 450] or [510, 620] */
const BOSSES = [180, 480, 900];

const KIND_A = 'testA';
const KIND_B = 'testB';

interface Spy {
  starts: number;
  ticks: number;
  ends: RunEventEndReason[];
  def: RunEventKindDef;
  /** set by a test to end the event early */
  resolve: boolean;
  /** set by a test: the kind reports failure when it ends */
  failOnEnd: boolean;
}

/** a kind that lasts `duration` s, remembers every hook call and can be resolved / failed by the test */
function spyKind(duration: number, extra: Partial<RunEventKindDef> = {}): Spy {
  const spy: Spy = {
    starts: 0,
    ticks: 0,
    ends: [],
    resolve: false,
    failOnEnd: false,
    def: {
      duration: () => duration,
      onStart: () => void spy.starts++,
      onTick: () => void spy.ticks++,
      isDone: () => spy.resolve,
      onEnd: (_w, run, reason) => {
        spy.ends.push(reason);
        if (spy.failOnEnd) run.failed = true;
      },
      ...extra,
    },
  };
  return spy;
}

const registered: string[] = [];
function register(id: string, def: RunEventKindDef): void {
  registerRunEventKind(id, def);
  registered.push(id);
}
afterEach(() => {
  for (const id of registered.splice(0)) unregisterRunEventKind(id);
});

/** content patch: the fixture zone lists `kinds`; window / gap default to the shipped values */
function withEvents(kinds: string[], over: Partial<RunEventsDef> = {}): (c: ContentDB) => void {
  return (c) => {
    c.runEvents = { ...structuredClone(DEFAULT_RUN_EVENTS), ...over, zones: { [FIXTURE_ZONE_ID]: kinds as unknown as RunEventKind[] } };
  };
}

function ev(w: World): RunEventRun {
  if (w.runEvent === null) throw new Error('the world has no run event');
  return w.runEvent;
}

/** a quiet world (no spawns) with an immortal hero and one event of `kinds` */
function quiet(kinds: string[] = [KIND_A], over: Parameters<typeof makeWorld>[0] = {}, window?: RunEventsDef['window']): World {
  const w = makeWorld({
    ...over,
    config: { ...IMMORTAL, ...over.config },
    content: (c) => {
      withEvents(kinds, window ? { window } : {})(c);
      over.content?.(c);
    },
  });
  freezeSchedules(w);
  return w;
}

/** put the clock at `t` (the run itself is long; the framework only reads w.time) */
function jumpTo(w: World, t: number): void {
  w.time = t;
}

/** step until `pred` holds (max `limit` s of sim time), returning the runEvent events of every tick in order */
function stepUntil(w: World, pred: () => boolean, limit = 30): RunEventSim[] {
  const out: RunEventSim[] = [];
  for (let i = 0; i < Math.ceil(limit / DT) && !pred(); i++) {
    w.step([NO_INPUT]);
    for (const e of w.events) if (e.t === 'runEvent') out.push({ ...e });
  }
  return out;
}

function phases(list: readonly RunEventSim[]): string[] {
  return list.map((e) => e.phase);
}

// ---------------------------------------------------------------------------
// startSpans

describe('startSpans (the seconds a start may take)', () => {
  it('cuts bossGap seconds on both sides of every boss spawn out of the window', () => {
    expect(startSpans(380, 620, 30, BOSSES)).toEqual([
      [380, 450],
      [510, 620],
    ]);
  });

  it('keeps the whole window when no boss is near, and drops a window that sits inside a gap', () => {
    expect(startSpans(380, 620, 30, [100, 900])).toEqual([[380, 620]]);
    expect(startSpans(170, 190, 30, BOSSES)).toEqual([]);
  });

  it('bossGap 0 removes nothing; seconds exactly bossGap away stay allowed', () => {
    expect(startSpans(380, 620, 0, BOSSES)).toEqual([[380, 620]]);
    expect(startSpans(450, 510, 30, BOSSES)).toEqual([
      [450, 450],
      [510, 510],
    ]);
  });

  it('is independent of the order of the boss times', () => {
    expect(startSpans(380, 620, 30, [900, 180, 480])).toEqual(startSpans(380, 620, 30, [180, 480, 900]));
  });
});

// ---------------------------------------------------------------------------
// default content: nothing, and no random draw

describe('a run without events', () => {
  it('shipped / default content: no event, no draw from rng.spawn, no runEvent in the HUD', () => {
    register(KIND_A, spyKind(20).def);
    const w = makeWorld();
    expect(w.runEvent).toBeNull();
    expect(w.rng.spawn.getState()).toEqual(createStreams(1234).spawn.getState());
    expect(w.hud().runEvent).toBeUndefined();
    expect(w.hud().channel).toBeUndefined();
    expect('runEvent' in w.hud()).toBe(false);
    freezeSchedules(w);
    runTicks(w, 600);
    expect(w.events.some((e) => e.t === 'runEvent')).toBe(false);
  });

  it('a zone that lists kinds nobody registered has no event and draws nothing', () => {
    const w = makeWorld({ content: withEvents(['neverRegistered', 'alsoNever']) });
    expect(w.runEvent).toBeNull();
    expect(w.rng.spawn.getState()).toEqual(createStreams(1234).spawn.getState());
  });

  it('a window that lies inside the boss gaps has no event and draws nothing', () => {
    register(KIND_A, spyKind(20).def);
    const w = makeWorld({ content: withEvents([KIND_A], { window: [170, 190] }) });
    expect(w.runEvent).toBeNull();
    expect(w.rng.spawn.getState()).toEqual(createStreams(1234).spawn.getState());
  });

  it('a zone that is not in runEvents.zones has no event even when kinds are registered', () => {
    register(KIND_A, spyKind(20).def);
    const w = makeWorld({
      content: (c) => void (c.runEvents = { ...structuredClone(DEFAULT_RUN_EVENTS), zones: { elsewhere: [KIND_A] as unknown as RunEventKind[] } }),
    });
    expect(w.runEvent).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// the pick: kind and start

describe('the pick', () => {
  it('is deterministic: the same seed gives the same kind and start, and exactly two draws of rng.spawn', () => {
    register(KIND_A, spyKind(20).def);
    register(KIND_B, spyKind(20).def);
    const a = quiet([KIND_A, KIND_B]);
    const b = quiet([KIND_A, KIND_B]);
    expect(ev(a).kind).toBe(ev(b).kind);
    expect(ev(a).startAt).toBe(ev(b).startAt);
    // the same two draws a stand-alone stream makes: one int over the kinds, one uniform over the spans
    const r = createStreams(1234).spawn;
    r.int(2);
    r.next();
    expect(a.rng.spawn.getState()).toEqual(r.getState());
  });

  it('different seeds give different starts and use both kinds; every start is in the window and >= bossGap from every boss', () => {
    register(KIND_A, spyKind(20).def);
    register(KIND_B, spyKind(20).def);
    const kinds = new Set<string>();
    const starts: number[] = [];
    for (let seed = 1; seed <= 120; seed++) {
      const w = quiet([KIND_A, KIND_B], { config: { seed } });
      const s = ev(w);
      kinds.add(s.kind);
      starts.push(s.startAt);
      expect(s.startAt).toBeGreaterThanOrEqual(380);
      expect(s.startAt).toBeLessThanOrEqual(620);
      for (const bt of BOSSES) expect(Math.abs(s.startAt - bt)).toBeGreaterThanOrEqual(30);
      expect(s.announceAt).toBeCloseTo(s.startAt - RUN_EVENT_ANNOUNCE, 9);
      expect(s.stage).toBe('pending');
    }
    expect([...kinds].sort()).toEqual([KIND_A, KIND_B]);
    // both allowed spans [380, 450] and [510, 620] are used, and the starts are spread (not one value)
    expect(starts.some((t) => t <= 450)).toBe(true);
    expect(starts.some((t) => t >= 510)).toBe(true);
    expect(new Set(starts.map((t) => Math.round(t))).size).toBeGreaterThan(40);
  });

  it('honours a narrower window and a kind that announces earlier', () => {
    register(KIND_A, spyKind(20, { announce: 8 }).def);
    const w = quiet([KIND_A], {}, [400, 410]);
    expect(ev(w).startAt).toBeGreaterThanOrEqual(400);
    expect(ev(w).startAt).toBeLessThanOrEqual(410);
    expect(ev(w).announceAt).toBeCloseTo(ev(w).startAt - 8, 9);
  });

  it('only registered kinds are drawn from the zone list', () => {
    register(KIND_B, spyKind(20).def);
    for (let seed = 1; seed <= 20; seed++) expect(ev(quiet(['neverRegistered', KIND_B], { config: { seed } })).kind).toBe(KIND_B);
  });

  it('hard difficulty and Run Options at their maximum pick the same way and still run the event', () => {
    register(KIND_A, spyKind(20).def);
    const easy = quiet([KIND_A], { config: { seed: 77 } });
    const hard = quiet([KIND_A], { config: { seed: 77, difficulty: 'hard', runOptions: { health: 3, damage: 3, density: 3, speed: 2 } } });
    expect(ev(hard).startAt).toBe(ev(easy).startAt);
    jumpTo(hard, ev(hard).announceAt - 0.1);
    const list = stepUntil(hard, () => ev(hard).stage === 'done', 60);
    expect(phases(list)).toEqual(['announce', 'active', 'active', 'active', 'active', 'end']);
  });
});

// ---------------------------------------------------------------------------
// phases

describe('phases', () => {
  it('announce 5 s before the start, active until startAt + duration, end, then gone from the HUD after the linger', () => {
    const spy = spyKind(20);
    register(KIND_A, spy.def);
    const w = quiet();
    const s = ev(w);
    jumpTo(w, s.announceAt - 0.5);
    expect(w.hud().runEvent).toBeUndefined();

    const seen = stepUntil(w, () => w.time >= s.announceAt + 0.1, 5);
    expect(phases(seen)).toEqual(['announce']);
    const a = seen[0] as RunEventSim;
    expect(a.t).toBe('runEvent');
    expect(a.kind).toBe(KIND_A);
    expect(a.id).toBe(1);
    expect(a.startAt).toBe(s.startAt);
    expect(a.endAt).toBeCloseTo(s.startAt + 20, 9);
    expect(a.player).toBe(-1);
    expect(a.p).toBe(0);
    // the event sits on the first living hero by default
    expect(a.x).toBeCloseTo(player(w).x, 5);
    expect(a.z).toBeCloseTo(player(w).z, 5);
    expect(spy.starts).toBe(0);
    let hud = w.hud().runEvent;
    expect(hud?.phase).toBe('announce');
    expect(hud?.kind).toBe(KIND_A);
    expect(hud?.left).toBeCloseTo(s.startAt - w.time, 6);
    expect(hud?.left).toBeGreaterThan(4.7);

    const act = stepUntil(w, () => w.time >= s.startAt + 0.2, 10);
    expect(phases(act)).toEqual(['active']);
    expect(spy.starts).toBe(1);
    expect(spy.ticks).toBeGreaterThan(0);
    hud = w.hud().runEvent;
    expect(hud?.phase).toBe('active');
    expect(hud?.left).toBeCloseTo(s.startAt + 20 - w.time, 6);

    const rest = stepUntil(w, () => s.stage === 'end', 40);
    // the heartbeat re-emits the active state in between (its own test); the end comes exactly at startAt + 20
    expect(phases(rest).at(-1)).toBe('end');
    const end = rest.at(-1) as RunEventSim;
    expect(end.endAt).toBeCloseTo(s.startAt + 20, 1);
    expect(end.p).toBe(1);
    expect(spy.ends).toEqual(['time']);
    hud = w.hud().runEvent;
    expect(hud?.phase).toBe('end');
    expect(hud?.left).toBeLessThanOrEqual(RUN_EVENT_LINGER);

    stepUntil(w, () => s.stage === 'done', 10);
    expect(w.hud().runEvent).toBeUndefined();
    expect(spy.ends).toHaveLength(1);
    // nothing more after the linger
    expect(stepUntil(w, () => false, 15)).toEqual([]);
  });

  it('absolute times stay put: startAt / endAt / id of every repeated event are the same numbers', () => {
    register(KIND_A, spyKind(20).def);
    const w = quiet();
    const s = ev(w);
    jumpTo(w, s.announceAt - 0.1);
    const list = stepUntil(w, () => s.stage === 'done', 60);
    const running = list.filter((e) => e.phase !== 'end');
    expect(new Set(running.map((e) => e.startAt)).size).toBe(1);
    expect(new Set(running.map((e) => e.endAt)).size).toBe(1);
    expect(new Set(list.map((e) => e.id)).size).toBe(1);
  });

  it('the kind decides the place (place hook) and the length (duration)', () => {
    register(KIND_A, spyKind(12, { place: (_w, run) => void ((run.x = 41), (run.z = -17)) }).def);
    const w = quiet();
    const s = ev(w);
    jumpTo(w, s.announceAt - 0.1);
    const list = stepUntil(w, () => s.stage === 'active', 20);
    expect(list.every((e) => e.x === 41 && e.z === -17)).toBe(true);
    expect(w.hud().runEvent).toMatchObject({ x: 41, z: -17, phase: 'active' });
    expect(s.endAt).toBeCloseTo(s.startAt + 12, 9);
  });

  it('a kind that resolves early ends at once with p = 1; one that reports a failure sends p = 0; onEnd runs once', () => {
    const win = spyKind(30);
    register(KIND_A, win.def);
    const w = quiet();
    const s = ev(w);
    jumpTo(w, s.startAt - 0.1);
    stepUntil(w, () => s.stage === 'active', 5);
    const t0 = w.time;
    win.resolve = true;
    const list = stepUntil(w, () => s.stage === 'end', 5);
    expect(phases(list)).toEqual(['end']);
    expect((list[0] as RunEventSim).p).toBe(1);
    expect((list[0] as RunEventSim).endAt).toBeCloseTo(t0 + DT, 2);
    expect(win.ends).toEqual(['resolved']);

    const fail = spyKind(30);
    register(KIND_B, fail.def);
    const w2 = quiet([KIND_B]);
    const s2 = ev(w2);
    jumpTo(w2, s2.startAt - 0.1);
    fail.failOnEnd = true;
    const list2 = stepUntil(w2, () => s2.stage === 'done', 60);
    const end = list2.find((e) => e.phase === 'end') as RunEventSim;
    expect(end.p).toBe(0);
    expect(fail.ends).toEqual(['time']);
  });

  it('the heartbeat re-emits the active state every 5 s', () => {
    register(KIND_A, spyKind(23).def);
    const w = quiet();
    const s = ev(w);
    jumpTo(w, s.announceAt - 0.1);
    const kinds: string[] = [];
    const activeAt: number[] = [];
    for (let i = 0; i < 60 / DT && s.stage !== 'done'; i++) {
      w.step([NO_INPUT]);
      for (const e of w.events) {
        if (e.t !== 'runEvent') continue;
        kinds.push(e.phase);
        if (e.phase === 'active') activeAt.push(w.time);
      }
    }
    // announce 5 s before, active at the start, then every 5 s while it lasts (23 s: beats at +5, +10, +15, +20), end
    expect(kinds).toEqual(['announce', 'active', 'active', 'active', 'active', 'active', 'end']);
    for (let i = 1; i < activeAt.length; i++) expect((activeAt[i] as number) - (activeAt[i - 1] as number)).toBeCloseTo(RUN_EVENT_HEARTBEAT, 1);
    expect(activeAt[0]).toBeGreaterThanOrEqual(s.startAt);
    expect(activeAt[0]).toBeLessThan(s.startAt + 0.05);
  });

  it('a hook-less kind (only a duration) works', () => {
    register(KIND_A, { duration: () => 4 });
    const w = quiet();
    const s = ev(w);
    jumpTo(w, s.announceAt - 0.1);
    const list = stepUntil(w, () => s.stage === 'done', 30);
    expect(phases(list)).toEqual(['announce', 'active', 'end']);
  });
});

// ---------------------------------------------------------------------------
// edge cases: run end, death, pause, late clock

describe('edges', () => {
  it('the hero dying during the active phase ends the event with reason runEnd before the run closes', () => {
    const spy = spyKind(40);
    register(KIND_A, spy.def);
    const w = makeWorld({ content: withEvents([KIND_A]) });
    freezeSchedules(w);
    const s = ev(w);
    jumpTo(w, s.announceAt - 0.1);
    stepUntil(w, () => s.stage === 'active', 10);
    runTicks(w, 10);
    expect(spy.ends).toEqual([]);
    hurtPlayer(w, 0, 1e9, 0, 0, 0, 0);
    const list = stepUntil(w, () => s.stage === 'end', 5);
    expect(spy.ends).toEqual(['runEnd']);
    expect(phases(list)).toEqual(['end']);
    expect(w.endTimer).toBeGreaterThanOrEqual(0);
    // the run finishes; nothing ticks afterwards and no second end arrives
    stepUntil(w, () => w.over, 10);
    expect(w.over).toBe(true);
    expect(spy.ends).toHaveLength(1);
  });

  it('a run that is ending when the announce is due announces nothing', () => {
    const spy = spyKind(40);
    register(KIND_A, spy.def);
    const w = quiet();
    const s = ev(w);
    w.endTimer = 5; // defeat / victory already pending
    jumpTo(w, s.announceAt + 0.1);
    expect(stepUntil(w, () => false, 1)).toEqual([]);
    expect(s.stage).toBe('done');
    expect(spy.starts).toBe(0);
  });

  it('the run ending during the announcement sends an end with p = 0 and never starts the kind', () => {
    const spy = spyKind(40);
    register(KIND_A, spy.def);
    const w = quiet();
    const s = ev(w);
    jumpTo(w, s.announceAt - 0.1);
    stepUntil(w, () => s.stage === 'announce', 2);
    w.endTimer = 5;
    const list = stepUntil(w, () => s.stage === 'end', 2);
    expect(phases(list)).toEqual(['end']);
    expect((list[0] as RunEventSim).p).toBe(0);
    expect(spy.starts).toBe(0);
    expect(spy.ends).toEqual([]);
  });

  it('a hero that is dead at the announce is not an anchor: the event sits on a living hero', () => {
    register(KIND_A, spyKind(20).def);
    const w = quiet([KIND_A], {
      config: { coop: [{ classId: 'warrior', doctrine: 'a', sex: 'm', empire: 'saehwa', meta: { stats: { maxHp: 1e9 } } }] },
    });
    const s = ev(w);
    player(w, 0).alive = false;
    player(w, 1).x = 12;
    player(w, 1).z = -9;
    jumpTo(w, s.announceAt - 0.1);
    const list = stepUntil(w, () => s.stage === 'announce', 2);
    expect(list[0]).toMatchObject({ x: 12, z: -9 });
  });

  it('a modal (level-up) freezes the event clock: the timer neither runs nor skips, the event resumes with the same absolute times', () => {
    const spy = spyKind(40);
    register(KIND_A, spy.def);
    const w = quiet();
    const s = ev(w);
    jumpTo(w, s.announceAt - 0.1);
    stepUntil(w, () => w.time >= s.startAt + 5, 20);
    expect(s.stage).toBe('active');
    runTicks(w, 5);
    const before = w.hud().runEvent;
    const ticks = spy.ticks;
    const endAt = s.endAt;
    openLevelUp(w, player(w), 2);
    expect(w.modals.length).toBeGreaterThan(0);
    runTicks(w, 600);
    expect(w.hud().runEvent).toEqual(before);
    expect(spy.ticks).toBe(ticks);
    w.chooseCard(0, 0);
    runTicks(w, 60);
    expect(spy.ticks).toBeGreaterThan(ticks);
    expect(s.endAt).toBe(endAt);
    expect((w.hud().runEvent?.left ?? 0) < (before?.left ?? 0)).toBe(true);
  });

  it('a clock that starts past the whole event runs the phases back to back instead of hanging', () => {
    const spy = spyKind(10);
    register(KIND_A, spy.def);
    const w = quiet();
    const s = ev(w);
    jumpTo(w, s.startAt + 50);
    const list = stepUntil(w, () => s.stage === 'done', 10);
    expect(phases(list)).toEqual(['announce', 'active', 'end']);
    expect(spy.starts).toBe(1);
    expect(spy.ends).toEqual(['time']);
  });

  it('a full real-time run (no jump) reaches the event and finishes it without disturbing the sim', () => {
    const spy = spyKind(15);
    register(KIND_A, spy.def);
    const w = quiet([KIND_A], {}, [20, 30]);
    const s = ev(w);
    expect(s.startAt).toBeGreaterThanOrEqual(20);
    const list = stepUntil(w, () => s.stage === 'done', 80);
    expect(phases(list)).toEqual(['announce', 'active', 'active', 'active', 'end']);
    expect(spy.starts).toBe(1);
    expect(player(w).alive).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// channel (the shrine, EV-02a): throttled events + the host HUD

describe('channel', () => {
  /** progress the test kind reports each tick (the kind calls setRunEventChannel from inside the step, like EV-02a) */
  const chan = { p0: 0, p1: 0 };
  function channelKind(duration: number): Spy {
    chan.p0 = 0;
    chan.p1 = 0;
    const spy = spyKind(duration, {
      onTick: (w) => {
        setRunEventChannel(w, 0, chan.p0);
        if (w.players.length > 1) setRunEventChannel(w, 1, chan.p1);
      },
    });
    register(KIND_A, spy.def);
    return spy;
  }
  const COOP: { coop: CoopPlayerInit[] } = { coop: [{ classId: 'warrior', doctrine: 'a', sex: 'm', empire: 'saehwa', meta: { stats: { maxHp: 1e9 } } }] };

  it('is ignored before the announce and after the end', () => {
    channelKind(10);
    const w = quiet();
    const s = ev(w);
    chan.p0 = 0.5;
    setRunEventChannel(w, 0, 0.5);
    w.step([NO_INPUT]);
    expect(w.events.some((e) => e.t === 'runEvent')).toBe(false);
    expect(w.hud().channel).toBeUndefined();
    jumpTo(w, s.announceAt - 0.1);
    stepUntil(w, () => s.stage === 'done', 60);
    chan.p0 = 0;
    setRunEventChannel(w, 0, 0.5);
    expect(w.hud().channel).toBeUndefined();
    expect(stepUntil(w, () => false, 2)).toEqual([]);
  });

  it('sends at most 4 channel events a second per hero, one at completion, one p = 0 on leaving; the host HUD shows its own hero', () => {
    channelKind(60);
    const w = quiet([KIND_A], { config: COOP });
    const s = ev(w);
    jumpTo(w, s.startAt - 0.1);
    stepUntil(w, () => s.stage === 'active', 5);
    const got: RunEventSim[] = [];
    // hero 0 channels for 2 s (p rises 0 -> 1 over 120 ticks), hero 1 does not
    for (let i = 0; i <= 120; i++) {
      chan.p0 = Math.min(1, i / 120);
      w.step([NO_INPUT]);
      for (const e of w.events) if (e.t === 'runEvent' && e.phase === 'channel') got.push({ ...e });
    }
    expect(got.every((e) => e.player === 0)).toBe(true);
    // 2 s at 4 Hz = 8, +1 at completion
    expect(got.length).toBeLessThanOrEqual(2 * RUN_EVENT_CHANNEL_HZ + 2);
    expect(got.length).toBeGreaterThanOrEqual(7);
    expect(got.at(-1)?.p).toBe(1);
    for (let i = 1; i < got.length; i++) expect((got[i] as RunEventSim).p).toBeGreaterThanOrEqual((got[i - 1] as RunEventSim).p);
    expect(got.filter((e) => e.p >= 1)).toHaveLength(1);
    // it carries the identity of the event
    expect(got[0]).toMatchObject({ kind: KIND_A, id: 1, startAt: s.startAt });
    // the HUD of hero 0 shows the progress, hero 1's none
    chan.p0 = 0.6;
    w.step([NO_INPUT]);
    expect(w.hud(0).channel).toBeCloseTo(0.6, 6);
    expect(w.hud(1).channel).toBeUndefined();
    // the other hero channels: its events name hero 1 and hero 0 gets its single p = 0
    chan.p0 = 0;
    chan.p1 = 0.3;
    const second: RunEventSim[] = [];
    for (let i = 0; i < 30; i++) {
      w.step([NO_INPUT]);
      for (const e of w.events) if (e.t === 'runEvent' && e.phase === 'channel') second.push({ ...e });
    }
    expect(second.filter((e) => e.player === 0)).toEqual([expect.objectContaining({ p: 0 })]);
    expect(second.filter((e) => e.player === 1).length).toBeGreaterThanOrEqual(1);
    expect(w.hud(0).channel).toBeUndefined();
    expect(w.hud(1).channel).toBeCloseTo(0.3, 6);
    // leaving: exactly one p = 0 event for hero 1, then silence
    chan.p1 = 0;
    const gone: RunEventSim[] = [];
    for (let i = 0; i < 60; i++) {
      w.step([NO_INPUT]);
      for (const e of w.events) if (e.t === 'runEvent' && e.phase === 'channel') gone.push({ ...e });
    }
    expect(gone).toHaveLength(1);
    expect(gone[0]).toMatchObject({ player: 1, p: 0 });
    expect(w.hud(1).channel).toBeUndefined();
  });

  it('an event that ends while a hero channels sends that hero a p = 0 (before the end) and clears the HUD value', () => {
    const spy = channelKind(40);
    const w = quiet();
    const s = ev(w);
    jumpTo(w, s.startAt - 0.1);
    stepUntil(w, () => s.stage === 'active', 5);
    chan.p0 = 0.5;
    w.step([NO_INPUT]);
    expect(w.hud().channel).toBe(0.5);
    // the next tick is inside the 4 Hz throttle; the event resolves on it
    spy.resolve = true;
    const list = stepUntil(w, () => s.stage === 'end', 5);
    expect(list.map((e) => e.phase)).toEqual(['channel', 'end']);
    expect(list[0]).toMatchObject({ player: 0, p: 0 });
    expect(w.hud().channel).toBeUndefined();
  });

  it('clamps nonsense progress and ignores a hero index that does not exist', () => {
    channelKind(60);
    const w = quiet();
    const s = ev(w);
    jumpTo(w, s.startAt - 0.1);
    stepUntil(w, () => s.stage === 'active', 5);
    setRunEventChannel(w, 0, 7);
    expect(w.hud().channel).toBe(1);
    setRunEventChannel(w, 0, Number.NaN);
    expect(w.hud().channel).toBeUndefined();
    expect(() => setRunEventChannel(w, 3, 0.5)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// the HUD view (shared by the host and the guest)

describe('HUD view', () => {
  const v = { kind: KIND_A, phase: 'active' as const, x: 1, z: 2, startAt: 400, endAt: 445 };

  it('left counts down to the end of the CURRENT phase', () => {
    expect(runEventLeft('announce', 400, 445, 396)).toBe(4);
    expect(runEventLeft('active', 400, 445, 400)).toBe(45);
    expect(runEventLeft('active', 400, 445, 430.5)).toBeCloseTo(14.5, 9);
    expect(runEventLeft('end', 400, 440, 441)).toBe(RUN_EVENT_LINGER - 1);
    expect(runEventLeft('active', 400, 445, 500)).toBe(0);
  });

  it('a view whose phase ended long ago without a following event reads as no event', () => {
    expect(runEventHudOf(v, 420)).toEqual({ kind: KIND_A, phase: 'active', left: 25, x: 1, z: 2 });
    expect(runEventHudOf(v, 446)?.left).toBe(0);
    expect(runEventHudOf(v, 460)).toBeNull();
  });

  it('a guest view that no event has refreshed for a heartbeat and a grace is a ghost; a refreshed one and the host view are not', () => {
    const limit = RUN_EVENT_HEARTBEAT + RUN_EVENT_REFRESH_GRACE;
    // refreshed at 410: shown through 410 + limit, gone after it (the next heartbeat of a live event brings it back)
    expect(runEventHudOf(v, 410, 410)?.left).toBe(35);
    expect(runEventHudOf(v, 410 + limit, 410)).not.toBeNull();
    expect(runEventHudOf(v, 410 + limit + 0.01, 410)).toBeNull();
    // an announce view is a running event too
    const a = { ...v, phase: 'announce' as const };
    expect(runEventHudOf(a, 396, 395)).not.toBeNull();
    expect(runEventHudOf(a, 395 + limit + 0.01, 395)).toBeNull();
    // the 'end' phase needs no heartbeat: it lingers on its own clock
    const e = { ...v, phase: 'end' as const, endAt: 440 };
    expect(runEventHudOf(e, 441, 440)?.left).toBe(RUN_EVENT_LINGER - 1);
    expect(runEventHudOf(e, 441, 400)?.left).toBe(RUN_EVENT_LINGER - 1);
    // the host passes no seenAt and reads its sim directly
    expect(runEventHudOf(v, 444)).not.toBeNull();
    // the limit is one heartbeat plus a grace, so a live event (re-emitted every RUN_EVENT_HEARTBEAT s) is never dropped
    expect(limit).toBeGreaterThan(RUN_EVENT_HEARTBEAT);
    expect(limit).toBeLessThanOrEqual(RUN_EVENT_HEARTBEAT + 2);
  });
});

// ---------------------------------------------------------------------------
// redo: the boss gap covers the whole planned span (attempt 1 kept only the START clear; a 60 s hunt ran into the next boss)

describe('the boss gap covers the planned span', () => {
  /** a pick's whole stretch [announceAt, startAt + span] */
  function clearOfBosses(announceAt: number, startAt: number, span: number, gap: number): boolean {
    return BOSSES.every((bt) => bt <= announceAt - gap || bt >= startAt + span + gap);
  }

  it('startSpans cuts gap + span before and gap + lead after every boss spawn (span 0 / lead 0 = the plain gap)', () => {
    expect(startSpans(380, 620, 30, BOSSES, 60, 5)).toEqual([
      [380, 390],
      [515, 620],
    ]);
    expect(startSpans(380, 620, 30, BOSSES, 0, 0)).toEqual(startSpans(380, 620, 30, BOSSES));
    expect(startSpans(380, 620, 30, BOSSES, 0, 5)).toEqual([
      [380, 450],
      [515, 620],
    ]);
    // a span too long for the window leaves nothing
    expect(startSpans(440, 460, 30, BOSSES, 60, 5)).toEqual([]);
  });

  it('a kind with a known span never runs into a boss: announce, active phase and the gap on both sides stay clear (120 seeds)', () => {
    register(KIND_A, spyKind(60, { span: () => 60 }).def);
    const seen: number[] = [];
    for (let seed = 1; seed <= 120; seed++) {
      const s = ev(quiet([KIND_A], { config: { seed } }));
      expect(clearOfBosses(s.announceAt, s.startAt, 60, 30)).toBe(true);
      seen.push(s.startAt);
    }
    // both stretches [380, 390] and [515, 620] are used
    expect(seen.some((t) => t <= 390)).toBe(true);
    expect(seen.some((t) => t >= 515)).toBe(true);
  });

  it('a kind without a span keeps only the START (and its announce) clear, as before', () => {
    register(KIND_A, spyKind(60).def);
    let into = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const s = ev(quiet([KIND_A], { config: { seed } }));
      expect(clearOfBosses(s.announceAt, s.startAt, 0, 30)).toBe(true);
      if (!clearOfBosses(s.announceAt, s.startAt, 60, 30)) into++;
    }
    // some of the 60 s events would reach the 480 s boss: that is what 'span' prevents
    expect(into).toBeGreaterThan(0);
  });

  it('a span that fits nowhere falls back to the plain start gap instead of dropping the event; still exactly two draws', () => {
    register(KIND_A, spyKind(60, { span: () => 60 }).def);
    const w = quiet([KIND_A], {}, [440, 460]);
    const s = ev(w);
    expect(s.startAt).toBeGreaterThanOrEqual(440);
    expect(s.startAt).toBeLessThanOrEqual(450);
    const r = createStreams(1234).spawn;
    r.int(1);
    r.next();
    expect(w.rng.spawn.getState()).toEqual(r.getState());
    // and a window that has no second even for the plain gap still has no event and no draw
    const none = quiet([KIND_A], {}, [455, 465]);
    expect(none.runEvent).toBeNull();
    expect(none.rng.spawn.getState()).toEqual(createStreams(1234).spawn.getState());
  });

  it('an announce lead that pushes every allowed start out of the window leaves that kind unscheduled (no draw); a kind with a shorter lead still runs', () => {
    register(KIND_A, spyKind(20, { announce: 0 }).def);
    register(KIND_B, spyKind(20, { announce: 8 }).def);
    // window [505, 512]: the 480 s boss keeps starts out of (450, 510) for a lead of 0 and out of (450, 518) for a lead of 8
    const only = quiet([KIND_B], {}, [505, 512]);
    expect(only.runEvent).toBeNull();
    expect(only.rng.spawn.getState()).toEqual(createStreams(1234).spawn.getState());
    for (let seed = 1; seed <= 20; seed++) {
      const w = quiet([KIND_A, KIND_B], { config: { seed } }, [505, 512]);
      expect(ev(w).kind).toBe(KIND_A);
      expect(ev(w).startAt).toBeGreaterThanOrEqual(510);
      const r = createStreams(seed).spawn;
      r.int(1);
      r.next();
      expect(w.rng.spawn.getState()).toEqual(r.getState());
    }
  });

  it('the span is read at the pick and costs no draw: the draw count is the same for every span', () => {
    register(KIND_A, spyKind(20, { span: () => 0 }).def);
    register(KIND_B, spyKind(20, { span: () => 90 }).def);
    for (const kinds of [[KIND_A], [KIND_B], [KIND_A, KIND_B]]) {
      const w = quiet(kinds);
      const r = createStreams(1234).spawn;
      r.int(kinds.length);
      r.next();
      expect(w.rng.spawn.getState()).toEqual(r.getState());
    }
  });
});

// ---------------------------------------------------------------------------
// redo: an event that moves (the champion) reaches a guest more often than the 5 s heartbeat

describe('a moving event', () => {
  function mover(speed: number, duration = 30): Spy {
    const spy = spyKind(duration, {
      place: (_w, run) => void ((run.x = 0), (run.z = 0)),
      onTick: (_w, run) => void (run.x += speed * DT),
    });
    register(KIND_A, spy.def);
    return spy;
  }

  it('re-emits the active state once it is RUN_EVENT_MOVE_DIST from the last emitted spot, so the emitted spot never lags by more', () => {
    mover(4);
    const w = quiet();
    const s = ev(w);
    jumpTo(w, s.announceAt - 0.1);
    let last = Number.NaN;
    let worst = 0;
    let moves = 0;
    for (let i = 0; i < 60 / DT && s.stage !== 'done'; i++) {
      w.step([NO_INPUT]);
      for (const e of w.events) {
        if (e.t === 'runEvent' && e.phase === 'active') {
          if (!Number.isNaN(last) && e.x !== last) moves++;
          last = e.x;
        }
      }
      if (s.stage === 'active' && !Number.isNaN(last)) worst = Math.max(worst, Math.abs(s.x - last));
    }
    // 30 s at 4 m/s = 120 m, one emission per 3 m
    expect(moves).toBeGreaterThanOrEqual(36);
    expect(moves).toBeLessThanOrEqual(42);
    expect(worst).toBeLessThanOrEqual(RUN_EVENT_MOVE_DIST + 4 * DT + 1e-6);
    expect(RUN_EVENT_MOVE_DIST).toBe(3);
  });

  it('never faster than 2 Hz, however far the kind jumps', () => {
    mover(40);
    const w = quiet();
    const s = ev(w);
    jumpTo(w, s.startAt - 0.1);
    const stamps: number[] = [];
    for (let i = 0; i < 20 / DT && s.stage !== 'end'; i++) {
      w.step([NO_INPUT]);
      if (s.stage === 'active' && w.events.some((e) => e.t === 'runEvent' && e.phase === 'active')) stamps.push(w.time);
    }
    expect(stamps.length).toBeGreaterThan(10);
    for (let i = 1; i < stamps.length; i++) expect((stamps[i] as number) - (stamps[i - 1] as number)).toBeGreaterThanOrEqual(RUN_EVENT_MOVE_GAP - DT);
  });

  it('an event that stands still emits nothing beyond the heartbeat (the move rule is inert)', () => {
    register(KIND_A, spyKind(23).def);
    const w = quiet();
    const s = ev(w);
    jumpTo(w, s.announceAt - 0.1);
    const kinds = phases(stepUntil(w, () => s.stage === 'done', 60));
    expect(kinds).toEqual(['announce', 'active', 'active', 'active', 'active', 'active', 'end']);
  });
});

// ---------------------------------------------------------------------------
// redo: refreshRunEvent (the hook for a guest that just (re)joined)

describe('refreshRunEvent', () => {
  it('makes the very next tick re-emit the running event instead of waiting for the heartbeat', () => {
    register(KIND_A, spyKind(40).def);
    const w = quiet();
    const s = ev(w);
    jumpTo(w, s.startAt - 0.1);
    stepUntil(w, () => s.stage === 'active', 5);
    // one second into the phase: the next heartbeat is 4 s away
    expect(stepUntil(w, () => w.time >= s.startAt + 1, 3)).toEqual([]);
    refreshRunEvent(w);
    w.step([NO_INPUT]);
    const e = w.events.filter((x): x is RunEventSim => x.t === 'runEvent');
    expect(e).toHaveLength(1);
    expect((e[0] as RunEventSim).phase).toBe('active');
    expect((e[0] as RunEventSim).endAt).toBeCloseTo(s.startAt + 40, 9);
    // and the heartbeat restarts from there
    const from = s.lastEmit;
    expect(stepUntil(w, () => w.time >= from + 4.5, 6)).toEqual([]);
    const next = stepUntil(w, () => w.time >= from + 5.2, 6);
    expect(phases(next)).toEqual(['active']);
  });

  it('works in the announce phase and the linger, and does nothing before the announce or after the event', () => {
    register(KIND_A, spyKind(6).def);
    const w = quiet();
    const s = ev(w);
    jumpTo(w, s.announceAt - 1);
    // before the announce: nothing to refresh, nothing emitted
    refreshRunEvent(w);
    expect(stepUntil(w, () => s.stage === 'announce', 3)).toHaveLength(1);
    stepUntil(w, () => w.time >= s.announceAt + 1, 3);
    refreshRunEvent(w);
    w.step([NO_INPUT]);
    expect(phases(w.events.filter((x): x is RunEventSim => x.t === 'runEvent'))).toEqual(['announce']);
    stepUntil(w, () => s.stage === 'end', 20);
    stepUntil(w, () => w.time >= s.endAt + 0.5, 3);
    refreshRunEvent(w);
    w.step([NO_INPUT]);
    expect(phases(w.events.filter((x): x is RunEventSim => x.t === 'runEvent'))).toEqual(['end']);
    stepUntil(w, () => s.stage === 'done', 10);
    refreshRunEvent(w);
    w.step([NO_INPUT]);
    expect(w.events.some((x) => x.t === 'runEvent')).toBe(false);
    // a run without an event: no throw
    const bare = makeWorld();
    expect(() => refreshRunEvent(bare)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Metin Rain (RS-02b, second attempt): the first real kind. Three stones of the zone list fall round the hero within 6 s on clear ground,
// the corruption meter rises by 0.15, the stones are unstable (they awaken after RAIN_FUSE x the usual time) and the event ends when every
// stone broke or awakened. The rain adds its three stones to the run (the plausibility envelope of the leaderboard is measured below).

const RAIN = 'metinRain';
const RAIN_CFG = DEFAULT_RUN_EVENTS.kinds.metinRain;
/** the active phase starts inside this window: the fixture zone's bosses (180, 480, 900) are 30 s away */
const RAIN_WINDOW: RunEventsDef['window'] = [400, 401];
const ARENA = 150;

/** a quiet world (natural stones and spawns off) whose event is Metin Rain; swarms off, `awakenAfter` as given (default: never) */
function rainWorld(over: Parameters<typeof makeWorld>[0] = {}, awakenAfter = 1e6): World {
  return quiet(
    [RAIN],
    {
      ...over,
      content: (c) => {
        for (const d of c.metins) {
          d.swarm.every = 1e9;
          d.awakenAfter = awakenAfter;
        }
        over.content?.(c);
      },
    },
    RAIN_WINDOW,
  );
}

interface RainLog {
  runEvents: RunEventSim[];
  warns: { t: number; metin: number; def: string; x: number; z: number; dur: number }[];
  impacts: { t: number; metin: number }[];
  awakens: { t: number; metin: number }[];
}

function newLog(): RainLog {
  return { runEvents: [], warns: [], impacts: [], awakens: [] };
}

/** one tick, its rain-relevant events appended to `log` with the sim time of the tick */
function stepLogged(w: World, log: RainLog): void {
  w.step([NO_INPUT]);
  for (const e of w.events) {
    if (e.t === 'runEvent') log.runEvents.push({ ...e });
    else if (e.t === 'metinWarn') log.warns.push({ t: w.time, metin: e.metin, def: e.def, x: e.x, z: e.z, dur: e.dur });
    else if (e.t === 'metinImpact') log.impacts.push({ t: w.time, metin: e.metin });
    else if (e.t === 'metinAwaken') log.awakens.push({ t: w.time, metin: e.metin });
  }
}

/** step until `pred` (max `limit` s of sim time) */
function runLogged(w: World, pred: () => boolean, limit: number, log: RainLog = newLog()): RainLog {
  for (let i = 0; i < Math.ceil(limit / DT) && !pred(); i++) stepLogged(w, log);
  return log;
}

/** run a rain world to the end of its fall phase: announce, the start, `seconds` of the active phase */
function fall(w: World, seconds = 8): RainLog {
  const s = ev(w);
  jumpTo(w, s.announceAt - 0.1);
  return runLogged(w, () => s.stage === 'active' && w.time >= s.startAt + seconds, seconds + 12);
}

const stones = (w: World): MetinState[] => w.metins.filter((m) => !m.great);
const dist2 = (a: { x: number; z: number }, b: { x: number; z: number }): number => Math.hypot(a.x - b.x, a.z - b.z);

/** land every stone and let it ripen, then break it with one huge hit (the essence modals are answered) */
function breakStone(w: World, m: MetinState): void {
  for (let i = 0; i < 600 && !(m.phase === MetinPhase.Alive && m.phaseT >= 1); i++) w.step([NO_INPUT]);
  expect(m.phase).toBe(MetinPhase.Alive);
  const c = newHitCtx();
  c.noCrit = true;
  hitEnemy(w, w.enemies.find(m.enemy), 1e9, c);
  drainModals(w);
}

describe('Metin Rain: the fall', () => {
  it('announces 5 s before the start; at the start the corruption meter rises by 0.15 once; the stones are called within the first 6 s and the last one lands 6 s after the start', () => {
    const w = rainWorld({ config: { seed: 21 } });
    const s = ev(w);
    expect(s.kind).toBe(RAIN);
    jumpTo(w, s.announceAt - 0.1);
    w.corruption = 0.2;
    const log = newLog();
    const stage = (): string => s.stage;
    while (stage() !== 'announce') stepLogged(w, log);
    expect(s.startAt - w.time).toBeCloseTo(RUN_EVENT_ANNOUNCE, 1);
    expect(w.metins).toHaveLength(0);
    let before = w.corruption;
    while (stage() !== 'active') {
      before = w.corruption;
      expect(w.metins).toHaveLength(0);
      stepLogged(w, log);
    }
    // the first stone is called on the activation tick and pays the whole rise (the meter drifts down 0.004 / s without stones)
    expect(w.corruption - before).toBeCloseTo(RAIN_CFG.corruption, 3);
    expect(stones(w)).toHaveLength(1);
    // ... and nothing else jumps: the stones' own rise is a few thousandths a tick
    let jumps = 0;
    let prev = w.corruption;
    while (w.time < s.startAt + 12) {
      stepLogged(w, log);
      if (w.corruption - prev > 0.01) jumps++;
      prev = w.corruption;
    }
    expect(jumps).toBe(0);
    expect(phases(log.runEvents).slice(0, 2)).toEqual(['announce', 'active']);
    expect(log.warns).toHaveLength(RAIN_CFG.count);
    expect(log.impacts).toHaveLength(RAIN_CFG.count);
    const span = RAIN_CFG.within - METIN_WARN_TIME;
    log.warns.forEach((e, k) => {
      expect(e.t - s.startAt).toBeGreaterThanOrEqual(-1e-9);
      expect(e.t - s.startAt).toBeCloseTo((span * k) / (RAIN_CFG.count - 1), 1);
      expect(e.dur).toBeCloseTo(METIN_WARN_TIME, 9);
    });
    // every stone lands METIN_WARN_TIME after its call; the last one `within` s after the start
    for (let k = 0; k < RAIN_CFG.count; k++) expect((log.impacts[k] as { t: number }).t - (log.warns[k] as { t: number }).t).toBeCloseTo(METIN_WARN_TIME, 1);
    expect((log.impacts.at(-1) as { t: number }).t - s.startAt).toBeCloseTo(RAIN_CFG.within, 1);
  });

  it('the stones are types of the zone list, the first ones all different, each on the ring round the hero and clear of the others', () => {
    const w = rainWorld({ config: { seed: 5 } });
    const log = fall(w);
    const list = ['metin_lament', 'metin_avarice'];
    expect(log.warns).toHaveLength(3);
    for (const e of log.warns) expect(list).toContain(e.def);
    expect(new Set(log.warns.slice(0, 2).map((e) => e.def)).size).toBe(2);
    const hero = player(w);
    for (const e of log.warns) {
      expect(dist2(e, hero)).toBeGreaterThanOrEqual(RAIN_CFG.ringRadius * 0.85 - 1e-9);
      expect(dist2(e, hero)).toBeLessThanOrEqual(RAIN_CFG.ringRadius * 1.15 + 1e-9);
    }
  });

  it('150 seeds on open ground: every stone on the ring and inside the arena, and 95 % of the rains keep every stone 10 m from the others', () => {
    let clear = 0;
    const seeds = 150;
    for (let seed = 1; seed <= seeds; seed++) {
      const w = rainWorld({ config: { seed } });
      const log = fall(w, 5);
      expect(log.warns).toHaveLength(3);
      const hero = player(w);
      let apart = true;
      for (const [i, e] of log.warns.entries()) {
        expect(dist2(e, hero)).toBeGreaterThanOrEqual(RAIN_CFG.ringRadius * 0.85 - 1e-9);
        expect(dist2(e, hero)).toBeLessThanOrEqual(RAIN_CFG.ringRadius * 1.15 + 1e-9);
        expect(Math.hypot(e.x, e.z)).toBeLessThanOrEqual(w.arenaRadius - 1.5 + 1e-9);
        for (const o of log.warns.slice(0, i)) if (dist2(e, o) < 10 - 1e-9) apart = false;
      }
      if (apart) clear++;
    }
    expect(clear / seeds).toBeGreaterThanOrEqual(0.95);
  });

  it('the same seed rains the same way; the other random streams do not move', () => {
    const a = fall(rainWorld({ config: { seed: 33 } }));
    const wb = rainWorld({ config: { seed: 33 } });
    const b = fall(wb);
    expect(a.warns).toEqual(b.warns);
    const fresh = createStreams(33);
    // (the loot stream moves: a Greed stone drops yeop by itself)
    expect(wb.rng.metin.getState()).toEqual(fresh.metin.getState());
    expect(wb.rng.boss.getState()).toEqual(fresh.boss.getState());
    expect(wb.rng.cards.getState()).toEqual(fresh.cards.getState());
  });

  it('real content, all four zones: three stones of the zone list, distinct types, 0.15 more corruption', () => {
    for (const zone of realContent.zones) {
      const w = createWorld(
        { zone: zone.id, difficulty: 'normal', classId: 'warrior', doctrine: 'a', sex: 'm', empire: 'saehwa', seed: 9, meta: { stats: { maxHp: 1e9 } } },
        (() => {
          const c = structuredClone(realContent);
          c.runEvents = { ...structuredClone(DEFAULT_RUN_EVENTS), zones: { [zone.id]: [RAIN] as unknown as RunEventKind[] } };
          return c;
        })(),
      );
      freezeSchedules(w);
      const s = ev(w);
      expect(s.kind).toBe(RAIN);
      const log = fall(w, 8);
      expect(log.warns, zone.id).toHaveLength(3);
      const defs = log.warns.map((e) => e.def);
      for (const d of defs) expect(zone.metins.types, zone.id).toContain(d);
      expect(new Set(defs).size, `${zone.id}: ${defs.join(',')}`).toBe(Math.min(3, zone.metins.types.length));
    }
  });
});

// ---------------------------------------------------------------------------
// attempt 1 fell short here: a late rain met a hero who cleared all three stones inside the 90 s fuse. The rain stones are unstable now.

describe('Metin Rain: unstable stones', () => {
  it('metinAwakenTime = awakenAfter x mods.awaken x the stone\'s own fuse; startFalling without a fuse (the natural fall) is unchanged', () => {
    const w = rainWorld({ config: { seed: 2 } }, 90);
    const def = w.ix.metins.get('metin_lament') as MetinDef;
    const plain = startFalling(w, def, 20, 20, false);
    const quick = startFalling(w, def, -20, 20, false, 0.5);
    expect(metinAwakenTime(w, plain)).toBe(90);
    expect(metinAwakenTime(w, quick)).toBe(45);
    // the factors stack with the run's own (hard difficulty, events, trials)
    w.setEventMods('test', { awaken: 0.5 });
    expect(metinAwakenTime(w, plain)).toBe(45);
    expect(metinAwakenTime(w, quick)).toBe(22.5);
    // a nonsense factor is ignored: the stone burns at the usual pace
    for (const [i, bad] of [0, -1, Number.NaN, Number.POSITIVE_INFINITY].entries()) {
      const m = startFalling(w, def, 40 + i * 12, -30, false, bad);
      expect(metinAwakenTime(w, m), `fuse ${bad}`).toBe(45);
    }
    // the Great Metin never takes one
    const great = startFalling(w, def, 0, 0, true, 0.1);
    expect(w.metinSys.fuse.has(great.id)).toBe(false);
  });

  it('the rain stones awaken after RAIN_FUSE x the usual time, a natural stone beside them after the full time', () => {
    const w = rainWorld({ config: { seed: 12 } }, 40);
    const s = ev(w);
    const log = fall(w, 8);
    const rain = stones(w);
    expect(rain).toHaveLength(3);
    // a natural stone lands next to the rain: the same type, the usual fuse
    const nat = startFalling(w, rain[0]!.def, 60, -60, false);
    runLogged(w, () => s.stage === 'end', 60, log);
    expect(log.awakens).toHaveLength(3);
    const landed = new Map(log.impacts.map((i) => [i.metin, i.t]));
    for (const a of log.awakens) {
      expect(rain.map((m) => m.id)).toContain(a.metin);
      expect(a.t - (landed.get(a.metin) as number), `stone ${a.metin}`).toBeCloseTo(40 * RAIN_FUSE, 0);
    }
    // the natural stone still stands, ripe in the remaining seconds only (40 s after its own landing)
    const natLanded = nat.phaseT;
    expect(nat.phase).toBe(MetinPhase.Alive);
    expect(natLanded).toBeLessThan(40);
    // (the awakened stones' escorts die to the idle hero's skills: level-ups open modals, which the player answers)
    for (let i = 0; i < 60 * 60 && nat.phase === MetinPhase.Alive; i++) {
      drainModals(w);
      stepLogged(w, log);
    }
    expect(nat.phase).toBe(MetinPhase.Awakened);
    expect(nat.age).toBeGreaterThanOrEqual(40 - 1e-6);
    expect(nat.age).toBeLessThan(40 + 0.5);
  });

  it('hard difficulty (mods.awaken) multiplies the rain fuse and the planned end follows', () => {
    const planned = (hard: boolean): number => {
      const w = rainWorld({ config: { seed: 2, difficulty: hard ? 'hard' : 'normal' } }, 90);
      const s = ev(w);
      jumpTo(w, s.announceAt - 0.1);
      runLogged(w, () => s.stage === 'announce', 2);
      return s.endAt - s.startAt;
    };
    const normal = planned(false);
    expect(normal).toBeCloseTo(RAIN_CFG.within - METIN_WARN_TIME + METIN_WARN_TIME + 90 * RAIN_FUSE + 2, 6);
    const w = rainWorld({ config: { seed: 2, difficulty: 'hard' } }, 90);
    const f = w.mods.awaken;
    expect(planned(true)).toBeCloseTo(RAIN_CFG.within + 90 * f * RAIN_FUSE + 2, 6);
  });

  it('the fuse entry goes with the stone: no leak after the stones are broken and gone', () => {
    const w = rainWorld({ config: { seed: 8 } }, 90);
    fall(w, 8);
    expect(w.metinSys.fuse.size).toBe(3);
    for (const m of [...stones(w)]) breakStone(w, m);
    runLogged(w, () => w.metins.length === 0, 6);
    expect(w.metins).toHaveLength(0);
    expect(w.metinSys.fuse.size).toBe(0);
  });
});

describe('Metin Rain: the schedule keeps the rain clear of the bosses', () => {
  it('real content, all four zones, 40 seeds: announce .. the unbroken end stays 30 s away from every boss and the final', () => {
    const starts: number[] = [];
    for (const zone of realContent.zones) {
      const bosses = [...zone.bosses.map((b) => b.at), zone.final.at];
      for (let seed = 1; seed <= 40; seed++) {
        const c = structuredClone(realContent);
        c.runEvents = { ...structuredClone(DEFAULT_RUN_EVENTS), zones: { [zone.id]: [RAIN] as unknown as RunEventKind[] } };
        const w = createWorld({ zone: zone.id, difficulty: 'normal', classId: 'warrior', doctrine: 'a', sex: 'm', empire: 'saehwa', seed, meta: { stats: { maxHp: 1e9 } } }, c);
        const s = ev(w);
        const span = (runEventKindDef(RAIN) as RunEventKindDef).span?.(w) ?? 0;
        // the whole unbroken rain: 6 s of falls + the shortened fuse + the tail
        expect(span, zone.id).toBeCloseTo(RAIN_CFG.within + 90 * RAIN_FUSE + 2, 6);
        expect(s.startAt, `${zone.id} s${seed}`).toBeGreaterThanOrEqual(380);
        expect(s.startAt, `${zone.id} s${seed}`).toBeLessThanOrEqual(620);
        for (const bt of bosses) {
          const clear = s.announceAt >= bt + 30 || s.startAt + span <= bt - 30;
          expect(clear, `${zone.id} s${seed}: rain ${s.announceAt.toFixed(1)}..${(s.startAt + span).toFixed(1)} vs boss ${bt}`).toBe(true);
        }
        starts.push(s.startAt);
      }
    }
    // both stretches the bosses leave are used (early 395-430 s, late 575-610 s)
    expect(starts.some((t) => t < 450)).toBe(true);
    expect(starts.some((t) => t > 560)).toBe(true);
  });

  it('a window no whole rain fits in falls back to the plain start gap (an event next to a boss beats none)', () => {
    const w = rainWorld({ config: { seed: 3 } });
    // [400, 401] lies inside the whole-rain gap of the boss at 480 (span 240 for stones that never awaken)
    expect(ev(w).startAt).toBeGreaterThanOrEqual(400);
    expect(ev(w).startAt).toBeLessThanOrEqual(401);
  });
});

describe('Metin Rain: walkable ground', () => {
  const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);

  /** every stone of every seed stands on spawnable ground; `hero` is where the hero stands */
  function sweep(env: WorldEnv, hero: { x: number; z: number }): { w: World; stones: { x: number; z: number }[] }[] {
    return SEEDS.map((seed) => {
      const w = rainWorld({ config: { seed }, env: { arenaRadius: ARENA, ...env } });
      const p = player(w);
      p.x = p.px = hero.x;
      p.z = p.pz = hero.z;
      const log = fall(w, 5);
      return { w, stones: log.warns };
    });
  }

  it('a hero on the arena rim: every stone is inside the arena', () => {
    for (const angle of [0, 1.9, 4.4]) {
      const hero = { x: Math.sin(angle) * (ARENA - 0.6), z: Math.cos(angle) * (ARENA - 0.6) };
      for (const { w, stones: list } of sweep({}, hero)) {
        expect(list).toHaveLength(3);
        for (const e of list) {
          expect(spawnable(w, e.x, e.z)).toBe(true);
          expect(Math.hypot(e.x, e.z)).toBeLessThanOrEqual(ARENA - 1.5 + 1e-9);
        }
      }
    }
  });

  it('next to a deep lake and a lava stream: no stone in the water or the lava', () => {
    const surfaceAt = (x: number, z: number): number => (x > 0 ? Surface.Deep : z >= 10 && z <= 16 ? Surface.Lava : Surface.Ground);
    for (const hero of [
      { x: -0.5, z: 0 },
      { x: -3, z: 8 },
      { x: -10, z: 12 },
    ]) {
      for (const { w, stones: list } of sweep({ surfaceAt }, hero)) {
        expect(list).toHaveLength(3);
        for (const e of list) {
          expect(surfaceAt(e.x, e.z)).toBe(Surface.Ground);
          expect(spawnable(w, e.x, e.z)).toBe(true);
        }
      }
    }
  });

  it('inside a blocker cluster only the pocket round the hero is free: the stones stand in the pocket, on clear ground', () => {
    // a 10 m pocket: the ring (12-16 m) is blocked, the sweep finds the stones' footprints 7-8 m from the hero
    const cluster: WorldEnv = { walkable: (x, z) => Math.hypot(x - 30, z) <= 10 || Math.hypot(x - 30, z) > 45 };
    for (const { w, stones: list } of sweep(cluster, { x: 30, z: 0 })) {
      expect(list).toHaveLength(3);
      for (const e of list) {
        expect(spawnable(w, e.x, e.z)).toBe(true);
        expect(fallSiteClear(w, e.x, e.z)).toBe(true);
        expect(dist2(e, { x: 30, z: 0 })).toBeLessThanOrEqual(10 + 1e-9);
      }
    }
  });

  it('a pocket too small for a stone (2.5 m): no stone falls into it and the hero is left alone', () => {
    const cluster: WorldEnv = { walkable: (x, z) => Math.hypot(x - 30, z) <= 2.5 || Math.hypot(x - 30, z) > 45 };
    for (const { w, stones: list } of sweep(cluster, { x: 30, z: 0 })) {
      for (const e of list) expect(fallSiteClear(w, e.x, e.z)).toBe(true);
      expect(player(w).hp).toBe(player(w).hpMax);
    }
  });

  it('a hero standing in lava has no clear ground: no stone falls, no corruption, and the event ends at once', () => {
    const lava: WorldEnv = { surfaceAt: () => Surface.Lava };
    const w = rainWorld({ config: { seed: 3 }, env: { arenaRadius: ARENA, ...lava } });
    w.corruption = 0.3;
    const s = ev(w);
    // the three calls are due at 0 / 1.7 / 3.4 s; each finds no ground, so the last call ends the event
    const log = fall(w, 4);
    expect(log.warns).toHaveLength(0);
    expect(w.metins).toHaveLength(0);
    expect(w.corruption).toBeLessThan(0.3 + 1e-9);
    expect(s.stage === 'end' || s.stage === 'done').toBe(true);
    expect(log.runEvents.at(-1)).toMatchObject({ phase: 'end', p: 0 });
  });

  it('a lava patch under the hero only: the stones still fall on the ground round it', () => {
    const surfaceAt = (x: number, z: number): number => (Math.hypot(x, z) < 3 ? Surface.Lava : Surface.Ground);
    for (const { w, stones: list } of sweep({ surfaceAt }, { x: 0, z: 0 })) {
      expect(list).toHaveLength(3);
      for (const e of list) expect(spawnable(w, e.x, e.z)).toBe(true);
    }
  });
});

// attempt 1 tested the ring on a fixture without statics; a real zone has props, rocks, trees and banks: a stone needs a CLEAR fall site
// (metins.ts fallSiteClear) like the natural fall, and the sweep for it must keep the stone on its ring as far as the ground allows
describe('Metin Rain: clear fall sites (props, rune carpet)', () => {
  const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);

  function rains(env: WorldEnv, hero = { x: 0, z: 0 }): { w: World; stones: { x: number; z: number }[] }[] {
    return SEEDS.map((seed) => {
      const w = rainWorld({ config: { seed }, env: { arenaRadius: ARENA, ...env } });
      const p = player(w);
      p.x = p.px = hero.x;
      p.z = p.pz = hero.z;
      return { w, stones: fall(w, 5).warns };
    });
  }

  it('props on half of the ring: every stone stands on the free half, still on the ring band', () => {
    const clearOfStatics: WorldEnv['clearOfStatics'] = (x, z) => !(z > 0 && Math.hypot(x, z) > 8 && Math.hypot(x, z) < 24);
    for (const { w, stones: list } of rains({ clearOfStatics })) {
      expect(list).toHaveLength(3);
      for (const e of list) {
        expect(fallSiteClear(w, e.x, e.z)).toBe(true);
        expect(e.z).toBeLessThanOrEqual(0);
        expect(Math.hypot(e.x, e.z)).toBeGreaterThanOrEqual(RAIN_CFG.ringRadius * 0.85 - 1e-9);
        expect(Math.hypot(e.x, e.z)).toBeLessThanOrEqual(RAIN_CFG.ringRadius * 1.15 + 1e-9);
      }
    }
  });

  it('the whole ring band blocked (a village square): the stones take the nearest clear ground, 7-45 m from the hero, 5 m apart', () => {
    const clearOfStatics: WorldEnv['clearOfStatics'] = (x, z) => Math.hypot(x, z) < 9 || Math.hypot(x, z) > 30;
    for (const { w, stones: list } of rains({ clearOfStatics })) {
      expect(list).toHaveLength(3);
      for (const [i, e] of list.entries()) {
        expect(fallSiteClear(w, e.x, e.z)).toBe(true);
        expect(Math.hypot(e.x, e.z)).toBeGreaterThanOrEqual(7 - 1e-6);
        expect(Math.hypot(e.x, e.z)).toBeLessThanOrEqual(45 + 1e-6);
        for (const o of list.slice(0, i)) expect(dist2(e, o)).toBeGreaterThanOrEqual(5 - 1e-6);
      }
    }
  });

  it('a bank the rune carpet would drape over (levelDisc false on one side): no stone on that side', () => {
    const levelDisc: WorldEnv['levelDisc'] = (x) => x < 0;
    for (const { w, stones: list } of rains({ levelDisc })) {
      expect(list).toHaveLength(3);
      for (const e of list) {
        expect(e.x).toBeLessThan(0);
        expect(fallSiteClear(w, e.x, e.z)).toBe(true);
      }
    }
  });

  it('no clear site anywhere round the hero: no stone, no corruption, the natural schedule untouched, a failed event', () => {
    const w = rainWorld({ config: { seed: 4 }, env: { arenaRadius: ARENA, clearOfStatics: () => false } });
    w.metinSys.nextFallAt = 1234;
    w.corruption = 0.1;
    const s = ev(w);
    const log = fall(w, 6);
    expect(log.warns).toHaveLength(0);
    expect(w.corruption).toBeLessThanOrEqual(0.1);
    expect(s.stage === 'end' || s.stage === 'done').toBe(true);
    expect(log.runEvents.at(-1)).toMatchObject({ phase: 'end', p: 0 });
    expect(w.metinSys.nextFallAt).toBe(1234);
  });
});

describe('Metin Rain: the end', () => {
  it('ends the moment the last stone breaks: phase end with p = 1, before the planned time, each stone paid its essence', () => {
    const w = rainWorld({ config: { seed: 8 } }, 90);
    const s = ev(w);
    const log = fall(w, 8);
    expect(s.stage).toBe('active');
    const planned = s.endAt;
    expect(stones(w)).toHaveLength(3);
    const all = [...stones(w)];
    for (const m of all.slice(0, 2)) breakStone(w, m);
    // two broke, one stands: the rain is still on
    runLogged(w, () => false, 1, log);
    expect(s.stage).toBe('active');
    expect(w.tally.metinsBroken).toBe(2);
    breakStone(w, all[2] as MetinState);
    expect(w.tally.metinsBroken).toBe(3);
    const t = w.time;
    runLogged(w, () => s.stage === 'end', 2, log);
    expect(s.stage).toBe('end');
    expect(s.endAt).toBeLessThan(planned - 20);
    expect(s.endAt).toBeGreaterThanOrEqual(t - 1e-9);
    expect(log.runEvents.at(-1)).toMatchObject({ phase: 'end', p: 1, startAt: s.startAt });
    expect(w.hud().runEvent?.phase).toBe('end');
    // the stones paid as ordinary stones: yeop and xp on the ground, shards
    expect(player(w).shards).toBeGreaterThan(0);
    // ... and then the event is over for good
    runLogged(w, () => s.stage === 'done', RUN_EVENT_LINGER + 2, log);
    expect(s.stage).toBe('done');
    expect(w.hud().runEvent).toBeUndefined();
  });

  it('stones nobody breaks awaken by themselves and that resolves them too: the event ends with the last awakening', () => {
    const w = rainWorld({ config: { seed: 12 } }, 20);
    const s = ev(w);
    const log = fall(w, 8);
    expect(s.stage).toBe('active');
    runLogged(w, () => s.stage === 'end', 60, log);
    expect(w.tally.metinsAwakened).toBe(3);
    expect(log.awakens).toHaveLength(3);
    // called at 0 / 1.7 / 3.4 s, they land 2.6 s later and awaken RAIN_FUSE x 20 s after landing: the last one at 3.4 + 2.6 + 11 = 17 s
    expect(s.endAt - s.startAt).toBeCloseTo(RAIN_CFG.within - METIN_WARN_TIME + METIN_WARN_TIME + 20 * RAIN_FUSE, 0);
    expect(log.runEvents.at(-1)).toMatchObject({ phase: 'end', p: 1 });
  });

  it('one broken, two awakened: the event ends when the last of them is resolved', () => {
    const w = rainWorld({ config: { seed: 14 } }, 25);
    const s = ev(w);
    fall(w, 8);
    const list = [...stones(w)];
    breakStone(w, list[0] as MetinState);
    expect(s.stage).toBe('active');
    runLogged(w, () => s.stage === 'end', 60);
    expect(w.tally.metinsBroken).toBe(1);
    expect(w.tally.metinsAwakened).toBe(2);
    expect(s.endAt - s.startAt).toBeCloseTo(RAIN_CFG.within + 25 * RAIN_FUSE, 0);
  });

  it('the planned end is the latest awakening (plus 2 s), follows the awaken factor and is capped', () => {
    const planned = (awakenAfter: number, awaken?: number): number => {
      const w = rainWorld({ config: { seed: 2 } }, awakenAfter);
      if (awaken !== undefined) w.setEventMods('test', { awaken });
      const s = ev(w);
      jumpTo(w, s.announceAt - 0.1);
      runLogged(w, () => s.stage === 'announce', 2);
      return s.endAt - s.startAt;
    };
    expect(planned(90)).toBeCloseTo(RAIN_CFG.within + 90 * RAIN_FUSE + 2, 6);
    expect(planned(90, 0.5)).toBeCloseTo(RAIN_CFG.within + 45 * RAIN_FUSE + 2, 6);
    expect(planned(1e6)).toBe(240);
  });

  it('a stone the hero never touches does not end the event while it stands: falling and standing stones keep it active', () => {
    const w = rainWorld({ config: { seed: 6 } }, 60);
    const s = ev(w);
    fall(w, 3);
    // only two of the three were called by 3 s
    expect(s.stage).toBe('active');
    expect(stones(w).length).toBeLessThanOrEqual(3);
    runLogged(w, () => w.time >= s.startAt + 12, 20);
    expect(s.stage).toBe('active');
    expect(stones(w).filter((m) => m.phase === MetinPhase.Alive)).toHaveLength(3);
  });

  it('a zone without stone types ends at once without a stone and without corruption, as a failed event', () => {
    const w = rainWorld({ config: { seed: 4 }, content: (c) => void ((c.zones[0] as { metins: { types: string[] } }).metins.types = []) });
    const s = ev(w);
    w.corruption = 0.1;
    const log = fall(w, 1);
    expect(log.warns).toHaveLength(0);
    expect(w.corruption).toBeLessThanOrEqual(0.1);
    expect(s.stage === 'end' || s.stage === 'done').toBe(true);
    expect(log.runEvents.at(-1)).toMatchObject({ phase: 'end', p: 0 });
  });
});

describe('Metin Rain: the rest of the run', () => {
  /** a rain world whose ordinary stones are switched on (the first fall is due at `due`) */
  function withNatural(seed: number, due: number, awakenAfter = 1e6): World {
    const w = rainWorld({ config: { seed } }, awakenAfter);
    w.metinSys.finalStarted = false;
    w.metinSys.nextFallAt = due;
    return w;
  }

  it('the rain does not touch the ordinary schedule: while three stones stand it waits (the cap), it resumes when one is gone', () => {
    const w = withNatural(10, 1e9);
    const s = ev(w);
    fall(w, 8);
    const rainIds = new Set(stones(w).map((m) => m.id));
    expect(rainIds.size).toBe(3);
    // the schedule is due now, but three stones stand (MAX_LIVE)
    w.metinSys.nextFallAt = 0;
    runLogged(w, () => false, 12);
    expect(stones(w).filter((m) => m.phase !== MetinPhase.Broken).map((m) => m.id).sort()).toEqual([...rainIds].sort());
    breakStone(w, stones(w)[0] as MetinState);
    runLogged(w, () => false, 8);
    const live = stones(w).filter((m) => m.phase !== MetinPhase.Broken);
    expect(live).toHaveLength(3);
    expect(live.filter((m) => !rainIds.has(m.id))).toHaveLength(1);
    expect(s.stage).toBe('active');
  });

  it('a rain that dropped nothing leaves the natural schedule alone', () => {
    const lava: WorldEnv = { surfaceAt: () => Surface.Lava };
    const w = rainWorld({ config: { seed: 3 }, env: { arenaRadius: ARENA, ...lava } });
    w.metinSys.nextFallAt = 1234;
    fall(w, 4);
    expect(w.metinSys.nextFallAt).toBe(1234);
  });

  it('a default run (no rain) keeps an empty fuse table: only the rain\'s stones burn faster', () => {
    const w = makeWorld();
    w.metinSys.nextFallAt = 0;
    w.metinSys.finalStarted = false;
    runTicks(w, 600);
    expect(w.metins.length).toBeGreaterThan(0);
    expect(w.metinSys.fuse.size).toBe(0);
  });

  it('co-op: the stones go round the living heroes in turn (host sim; guests see them as ordinary stones and the mirrored event)', () => {
    const w = rainWorld({
      config: { seed: 17, coop: [{ classId: 'warrior', doctrine: 'a', sex: 'm', empire: 'saehwa', meta: { stats: { maxHp: 1e9 } } }] },
    });
    const a = player(w, 0);
    const b = player(w, 1);
    a.x = a.px = 0;
    a.z = a.pz = 0;
    b.x = b.px = 60;
    b.z = b.pz = 40;
    const log = fall(w, 6);
    expect(log.warns).toHaveLength(3);
    const ring = (e: { x: number; z: number }, h: { x: number; z: number }): boolean => dist2(e, h) >= RAIN_CFG.ringRadius * 0.85 - 1e-9 && dist2(e, h) <= RAIN_CFG.ringRadius * 1.15 + 1e-9;
    expect(ring(log.warns[0] as { x: number; z: number }, a)).toBe(true);
    expect(ring(log.warns[1] as { x: number; z: number }, b)).toBe(true);
    expect(ring(log.warns[2] as { x: number; z: number }, a)).toBe(true);
    // the event carries its identity for the mirrors; the stones are in the world list a snapshot is built from
    expect(log.runEvents.find((e) => e.phase === 'active')).toMatchObject({ kind: RAIN, id: 1, startAt: ev(w).startAt });
    expect(stones(w)).toHaveLength(3);
  });

  it('a dead hero is skipped: the stones go round the hero that lives', () => {
    const w = rainWorld({ config: { seed: 19, coop: [{ classId: 'warrior', doctrine: 'a', sex: 'm', empire: 'saehwa', meta: { stats: { maxHp: 1e9 } } }] } });
    player(w, 0).alive = false;
    const b = player(w, 1);
    b.x = b.px = -50;
    b.z = b.pz = 20;
    const log = fall(w, 6);
    expect(log.warns).toHaveLength(3);
    for (const e of log.warns) expect(dist2(e, b)).toBeLessThanOrEqual(RAIN_CFG.ringRadius * 1.15 + 1e-9);
  });

  it('the hero dying mid-rain ends the event with the run; the stones are left standing and nothing throws', () => {
    const w = makeWorld({ content: withEvents([RAIN], { window: RAIN_WINDOW }) });
    freezeSchedules(w);
    const s = ev(w);
    fall(w, 4);
    expect(stones(w).length).toBeGreaterThan(0);
    hurtPlayer(w, 0, 1e9, 0, 0, 0, 0);
    runLogged(w, () => s.stage === 'end', 5);
    expect(s.stage).toBe('end');
    expect(() => runLogged(w, () => w.over, 15)).not.toThrow();
  });

  it('a modal (level-up) in the middle of the rain freezes the calls and the fuse: no stone falls or awakens while it is open', () => {
    const w = rainWorld({ config: { seed: 23 } }, 20);
    const s = ev(w);
    const log = newLog();
    jumpTo(w, s.announceAt - 0.1);
    // 3 s into the rain: two stones called, the first one has landed (and its fuse runs), the third is due at 3.4 s
    runLogged(w, () => s.stage === 'active' && w.time >= s.startAt + 3, 12, log);
    expect(log.warns).toHaveLength(2);
    const first = stones(w)[0] as MetinState;
    expect(first.phase).toBe(MetinPhase.Alive);
    const age = first.age;
    openLevelUp(w, player(w), 2);
    const t = w.time;
    runLogged(w, () => false, 30, log);
    expect(w.time).toBeCloseTo(t, 6);
    expect(log.warns).toHaveLength(2);
    expect(log.awakens).toHaveLength(0);
    expect(first.age).toBe(age);
    w.chooseCard(0, 0);
    runLogged(w, () => w.time >= s.startAt + 8, 12, log);
    expect(log.warns).toHaveLength(3);
    expect((log.warns[2] as { t: number }).t - s.startAt).toBeCloseTo(RAIN_CFG.within - METIN_WARN_TIME, 1);
  });

  it('hard difficulty and Run Options at their maximum rain the same way', () => {
    const hard = rainWorld({ config: { seed: 77, difficulty: 'hard', runOptions: { health: 3, damage: 3, density: 3, speed: 2 } } });
    const log = fall(hard, 8);
    expect(log.warns).toHaveLength(3);
    expect(stones(hard)).toHaveLength(3);
    // the stones are tougher on hard (hpScale), the event itself is the same
    expect(ev(hard).kind).toBe(RAIN);
  });

  it('a world whose zone lists no event has no rain, draws nothing and keeps the natural schedule', () => {
    const w = makeWorld();
    expect(w.runEvent).toBeNull();
    expect(w.rng.spawn.getState()).toEqual(createStreams(1234).spawn.getState());
    expect(w.metinSys.fuse.size).toBe(0);
    runTicks(w, 600);
    expect(w.events.some((e) => e.t === 'runEvent')).toBe(false);
    // the kind itself is registered (a zone that lists it gets the rain)
    expect(runEventKindDef(RAIN)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// the plausibility envelope of the leaderboard (workers/api/src/plausibility.ts): the 2026-10-13 calibration measured at most
// floor(t / 60) + 1 stones broken by second t and the server flags a run above its SOFT limit floor(t / 60) + 2. The rain adds its three
// stones to a run (the spec's count; skipping ordinary ones to make room costs the win rate, see the header of the kind), so the soft limit
// has to move by 3 when events ship (PLAUS-1 / PLAUS-2). What this file guarantees is that the rain adds THREE stones and no more, at every
// point of a run. Worst case for the envelope: a hero who breaks every stone the moment it lands (the real stone types and schedule of each
// zone, no creatures so that nothing but the stones matters). By any second t >= 380 the run with the rain has broken at most 3 stones
// more than the same run without it, give or take one stone for the timing of the ordinary falls (two chaotic runs), and 3 on average once the rain is over.
// (Attempt 1 tested floor(t / 60) + 3 on a god-stat bot whose runs without the rain already sat on the soft limit; a comparison with the
// run without the rain is what shows the rain's own share.)

describe('Metin Rain: plausibility envelope', () => {
  const ZONES = ['yeonmu', 'suryeon', 'seori', 'daeryeol'];

  /** stones broken (the stat the leaderboard submits) sampled every 15 s up to 780 s; every stone is broken the tick it can be hit */
  function brokenCurve(zoneId: string, seed: number, rain: boolean): { curve: Map<number, number>; fallen: number } {
    const db = structuredClone(realContent);
    (db.runEvents as RunEventsDef).zones = rain ? { [zoneId]: [RAIN as unknown as RunEventKind] } : {};
    // the stones' own swarms and elites are not what is measured
    for (const d of db.metins) d.swarm.every = 1e9;
    const w = createWorld({ zone: zoneId, difficulty: 'normal', classId: 'warrior', doctrine: 'a', sex: 'm', empire: 'saehwa', seed, meta: { stats: { maxHp: 1e9 } } }, db);
    // ordinary creatures and bosses are off, the stone schedule is on
    freezeSchedules(w);
    w.metinSys.finalStarted = false;
    w.metinSys.nextFallAt = w.zone.metins.firstAt;
    const out = new Map<number, number>();
    let next = 0;
    while (w.time < 780 && !w.over) {
      drainModals(w);
      w.step([NO_INPUT]);
      for (const m of w.metins) if (!m.great && m.phase === MetinPhase.Alive && m.phaseT >= 1) breakStone(w, m);
      if (w.time >= next) {
        out.set(next, w.tally.metinsBroken);
        next += 15;
      }
    }
    if (rain) {
      expect(w.runEvent?.kind, `${zoneId} has its rain`).toBe(RAIN);
      expect(['end', 'done'], `${zoneId} s${seed}: the rain is over`).toContain(w.runEvent?.stage);
    }
    return { curve: out, fallen: w.metinSys.nextId - 1 };
  }

  for (const zoneId of ZONES) {
    it(`${zoneId}: with the rain the broken stones exceed those of the same run without it by 3 (at most 4, 3 on average) from 380 s on`, () => {
      const leads: number[] = [];
      for (const seed of [7, 11, 13, 17]) {
        const on = brokenCurve(zoneId, seed, true);
        const off = brokenCurve(zoneId, seed, false);
        expect(on.curve.size).toBeGreaterThan(40);
        let worst = -99;
        for (const [t, broken] of on.curve) {
          // the earliest rain starts at 380 s: before it the run is an ordinary one
          if (t < 380) continue;
          const diff = broken - (off.curve.get(t) as number);
          worst = Math.max(worst, diff);
          // the settled lead (the rain is over, its stones broken)
          if (t >= 700) leads.push(diff);
        }
        expect(worst, `${zoneId} s${seed}: the largest lead over the run without the rain`).toBeLessThanOrEqual(4);
        expect(on.fallen, `${zoneId} s${seed}`).toBeGreaterThanOrEqual(3);
      }
      const mean = leads.reduce((a, b) => a + b, 0) / leads.length;
      expect(mean, `${zoneId}: the mean lead from 700 s`).toBeLessThanOrEqual(3.5);
      expect(mean, `${zoneId}: the mean lead from 700 s`).toBeGreaterThanOrEqual(2);
    }, 120_000);
  }
});


// ---------------------------------------------------------------------------
// Champion Hunt (RS-03, second attempt): the third kind. When the active phase starts a band elite stands up as the champion (tier 2, x5 HP,
// x1.3 damage, a larger body) 8-12 m from the hero with 4 escorts round it; slain within 60 s it drops a free tier-1 chest where it fell
// (on dry ground), otherwise it burrows away (quietly) and the event ends failed. The hunt hero is drawn at the announce.

const HUNT = 'championHunt';
const HUNT_CFG = DEFAULT_RUN_EVENTS.kinds.championHunt;
/** the active phase starts inside this window: the fixture zone's bosses (180, 480, 900) are 30 s away */
const HUNT_WINDOW: RunEventsDef['window'] = [400, 401];
/** the elite pool of the fixture zone's bands from 300 s on */
const HUNT_POOL = ['alpha_wolf', 'elder_bear'];
const MEMBER: CoopPlayerInit = { classId: 'warrior', doctrine: 'a', sex: 'm', empire: 'saehwa', meta: { stats: { maxHp: 1e9 } } };

/** a quiet world whose event is the Champion Hunt; `tank`: every creature has a million times the HP, so no hero kills the champion by accident */
function huntWorld(over: Parameters<typeof makeWorld>[0] = {}, tank = true): World {
  return quiet(
    [HUNT],
    {
      ...over,
      content: (c) => {
        if (tank) for (const d of c.enemies) d.hp *= 1e6;
        // a bomb imp that blows itself up is an ordinary kill (killer -1): keep the escorts steady so the tallies below are the hunt's own
        for (const z of c.zones) for (const b of z.bands) b.spawns = b.spawns.filter((s) => s.enemy !== 'bomb_imp');
        over.content?.(c);
      },
    },
    HUNT_WINDOW,
  );
}

interface HuntLog {
  runEvents: RunEventSim[];
  spawns: { t: number; id: number; type: number; x: number; z: number; tier: number; source: number }[];
  deaths: { t: number; id: number; killer: number; tier: number }[];
}

function newHuntLog(): HuntLog {
  return { runEvents: [], spawns: [], deaths: [] };
}

function stepHunt(w: World, log: HuntLog): void {
  w.step([NO_INPUT]);
  for (const e of w.events) {
    if (e.t === 'runEvent') log.runEvents.push({ ...e });
    else if (e.t === 'enemySpawn') log.spawns.push({ t: w.time, id: e.enemy, type: e.type, x: e.x, z: e.z, tier: e.tier, source: e.source });
    else if (e.t === 'enemyDeath') log.deaths.push({ t: w.time, id: e.id, killer: e.killer, tier: e.tier });
  }
}

function runHunt(w: World, pred: () => boolean, limit: number, log: HuntLog = newHuntLog()): HuntLog {
  for (let i = 0; i < Math.ceil(limit / DT) && !pred(); i++) stepHunt(w, log);
  return log;
}

/** run a hunt world to the tick the hunt becomes active (the champion and its escorts stand from that tick on) */
function startHunt(w: World): HuntLog {
  const s = ev(w);
  jumpTo(w, s.announceAt - 0.1);
  return runHunt(w, () => s.stage === 'active', 12);
}

const championSpawns = (log: HuntLog): HuntLog['spawns'] => log.spawns.filter((p) => p.source === 5);
const escortSpawns = (log: HuntLog): HuntLog['spawns'] => log.spawns.filter((p) => p.source === 1);

/** kill row `row` with one huge hit of hero `player`; the 'enemyDeath' it raises (cleared by the next step) is appended to `log` */
function slay(w: World, row: number, player = 0, log?: HuntLog): void {
  const c = newHitCtx();
  c.noCrit = true;
  c.player = player;
  hitEnemy(w, row, 1e15, c);
  if (log) for (const e of w.events) if (e.t === 'enemyDeath') log.deaths.push({ t: w.time, id: e.id, killer: e.killer, tier: e.tier });
}

/** the chest pickups on the field; `tier` filters (the event's chest is tier 1, the ordinary 12 % elite chest of a tier-2 kill is tier 0) */
function chests(w: World, tier = -1): { row: number; x: number; z: number; tier: number }[] {
  const P = w.pickups;
  const out: { row: number; x: number; z: number; tier: number }[] = [];
  for (let i = 0; i < P.count; i++) {
    if (P.kind[i] === PickupKind.Chest && (tier < 0 || P.tier[i] === tier)) out.push({ row: i, x: P.x[i] as number, z: P.z[i] as number, tier: P.tier[i] as number });
  }
  return out;
}

describe('Champion Hunt: the start', () => {
  it('is a registered kind of the shipped event content (hpMul 5, dmgMul 1.3, 4 escorts, 60 s, tier-1 chest)', () => {
    expect(runEventKindDef(HUNT)).toBeDefined();
    expect(HUNT_CFG).toMatchObject({ hpMul: 5, dmgMul: 1.3, escorts: 4, timeLimit: 60, chestTier: 1 });
    expect(realContent.runEvents?.kinds.championHunt).toMatchObject({ hpMul: 5, dmgMul: 1.3, escorts: 4, timeLimit: 60, chestTier: 1 });
  });

  it('announces 5 s ahead, then at the start one tier-2 band elite stands 8-12 m from the hero with 4 escorts round it and nothing stood before', () => {
    for (const seed of [3, 4, 5, 6]) {
      const w = huntWorld({ config: { seed } });
      const s = ev(w);
      expect(s.kind).toBe(HUNT);
      jumpTo(w, s.announceAt - 0.1);
      const log = newHuntLog();
      const stage = (): string => s.stage;
      while (stage() !== 'announce') stepHunt(w, log);
      expect(s.startAt - w.time).toBeCloseTo(RUN_EVENT_ANNOUNCE, 1);
      while (stage() !== 'active') {
        expect(w.enemies.count).toBe(0);
        stepHunt(w, log);
      }
      // the activation tick: one champion + four escorts, all at once
      const champs = championSpawns(log);
      const escorts = escortSpawns(log);
      expect(champs).toHaveLength(1);
      expect(escorts).toHaveLength(HUNT_CFG.escorts);
      expect(w.enemies.count).toBe(1 + HUNT_CFG.escorts);
      const c = champs[0] as HuntLog['spawns'][number];
      const hero = player(w);
      expect(c.tier).toBe(2);
      expect(HUNT_POOL).toContain(w.typeDefs[c.type]?.id);
      expect(Math.hypot(c.x - hero.x, c.z - hero.z)).toBeGreaterThanOrEqual(8 - 1e-6);
      expect(Math.hypot(c.x - hero.x, c.z - hero.z)).toBeLessThanOrEqual(12 + 1e-6);
      expect(spawnable(w, c.x, c.z)).toBe(true);
      for (const p of escorts) {
        expect(p.tier).toBe(0);
        expect(spawnable(w, p.x, p.z)).toBe(true);
        expect(Math.hypot(p.x - c.x, p.z - c.z)).toBeLessThanOrEqual(4.5 + 1e-6);
        expect(HUNT_POOL).not.toContain(w.typeDefs[p.type]?.id);
      }
      expect(new Set([c.id, ...escorts.map((p) => p.id)]).size).toBe(1 + HUNT_CFG.escorts);
      expect(runEventChampion(w)).toBe(c.id);
      // the event's own position is the champion's, for the HUD pointer
      expect(s.x).toBeCloseTo(c.x, 3);
      expect(s.z).toBeCloseTo(c.z, 3);
      const beat = log.runEvents.find((e) => e.phase === 'active') as RunEventSim;
      expect(beat.x).toBeCloseTo(c.x, 3);
      expect(beat.z).toBeCloseTo(c.z, 3);
    }
  });

  it('the champion has an elite-formula HP (x5), x1.3 damage and a body larger than an ordinary tier-2 pack leader of its type', () => {
    for (const seed of [8, 9, 10]) {
      const w = huntWorld({ config: { seed } });
      const log = startHunt(w);
      const c = championSpawns(log)[0] as HuntLog['spawns'][number];
      const e = w.enemies;
      const row = e.find(c.id);
      expect(row).toBeGreaterThanOrEqual(0);
      const def = w.typeDefs[c.type] as NonNullable<(typeof w.typeDefs)[number]>;
      expect((e.hpMax[row] as number) / (def.hp * w.hpScale() * HUNT_CFG.hpMul)).toBeCloseTo(1, 5);
      expect(e.hp[row]).toBe(e.hpMax[row]);
      expect((e.dmgMul[row] as number) / (w.dmgScale() * HUNT_CFG.dmgMul)).toBeCloseTo(1, 5);
      expect(e.eliteTier[row]).toBe(2);
      // the one row of the run that carries the champion marker (it reaches co-op guests in the snapshot flags column); the escorts do not
      expect((e.flags[row] as number) & EnemyFlag.Leader).toBe(EnemyFlag.Leader);
      for (const p of escortSpawns(log)) expect((e.flags[e.find(p.id)] as number) & EnemyFlag.Leader).toBe(0);
      // a pack leader of the same type: tier 2 as well, hpMul 2.2 and the plain tier-2 body (x1.12), +-6 % spawn variance
      const body = (e.scale[row] as number) / (def.scale * 1.12);
      expect(body).toBeGreaterThanOrEqual(CHAMPION_SCALE * 0.94 - 1e-6);
      expect(body).toBeLessThanOrEqual(CHAMPION_SCALE * 1.06 + 1e-6);
      expect(e.radius[row]).toBeGreaterThan(def.radius * 1.12 * 1.2);
    }
  });

  it('the escort count and the time limit come from the content', () => {
    for (const escorts of [0, 1, 7]) {
      const w = huntWorld({
        config: { seed: 12 },
        content: (c) => {
          (c.runEvents as RunEventsDef).kinds.championHunt.escorts = escorts;
          (c.runEvents as RunEventsDef).kinds.championHunt.timeLimit = 25;
        },
      });
      const log = startHunt(w);
      expect(escortSpawns(log)).toHaveLength(escorts);
      const s = ev(w);
      expect(s.endAt - s.startAt).toBe(25);
      expect(w.hud().runEvent?.left).toBeCloseTo(25, 1);
    }
  });

  it('the hunt scales with hard difficulty and the maximum Run Options exactly as an elite does (no extra factor)', () => {
    for (const config of [{ difficulty: 'hard' as const }, { difficulty: 'hard' as const, runOptions: { density: 3, health: 3, damage: 3, speed: 3 } }]) {
      const w = huntWorld({ config: { seed: 14, ...config } });
      const log = startHunt(w);
      const c = championSpawns(log)[0] as HuntLog['spawns'][number];
      const row = w.enemies.find(c.id);
      const def = w.typeDefs[c.type] as NonNullable<(typeof w.typeDefs)[number]>;
      expect((w.enemies.hpMax[row] as number) / (def.hp * w.hpScale() * HUNT_CFG.hpMul)).toBeCloseTo(1, 5);
      expect(w.hpScale()).toBeGreaterThan(1.5);
      expect(escortSpawns(log)).toHaveLength(HUNT_CFG.escorts);
    }
  });

  it('two worlds of one seed hunt identically: same champion, same ground, same state a minute later (determinism)', () => {
    const run = (): string => {
      const w = huntWorld({ config: { seed: 31 } });
      const log = startHunt(w);
      const c = championSpawns(log)[0] as HuntLog['spawns'][number];
      runHunt(w, () => false, 20, log);
      const e = w.enemies;
      const parts: unknown[] = [c.type, c.x, c.z, w.rng.spawn.getState()];
      for (let i = 0; i < e.count; i++) parts.push(e.x[i] as number, e.z[i] as number, e.hp[i] as number);
      return JSON.stringify(parts);
    };
    expect(run()).toBe(run());
  });
});

describe('Champion Hunt: slain in time', () => {
  it('a kill inside the limit resolves the event (p = 1) and a free tier-1 chest drops where the champion fell, on walkable ground', () => {
    const w = huntWorld({ config: { seed: 21 } });
    const log = startHunt(w);
    const s = ev(w);
    const c = championSpawns(log)[0] as HuntLog['spawns'][number];
    runHunt(w, () => w.time >= s.startAt + 12, 20, log);
    expect(chests(w)).toHaveLength(0);
    const row = w.enemies.find(c.id);
    const fell = { x: w.enemies.x[row] as number, z: w.enemies.z[row] as number };
    const kills = w.tally.kills;
    const elites = w.tally.elitesKilled;
    slay(w, row, 0, log);
    runHunt(w, () => s.stage === 'end', 2, log);
    expect(s.stage).toBe('end');
    expect(s.failed).toBe(false);
    expect(log.runEvents.at(-1)).toMatchObject({ phase: 'end', p: 1 });
    expect(s.endAt).toBeLessThan(s.startAt + HUNT_CFG.timeLimit);
    // exactly one chest, tier 1, within a pop slide of the spot the champion fell on
    const list = chests(w, HUNT_CFG.chestTier);
    expect(list).toHaveLength(1);
    const chest = list[0] as ReturnType<typeof chests>[number];
    expect(chest.tier).toBe(HUNT_CFG.chestTier);
    expect(Math.hypot(chest.x - fell.x, chest.z - fell.z)).toBeLessThanOrEqual(0.5);
    expect(spawnable(w, chest.x, chest.z)).toBe(true);
    // an ordinary kill: counted once as a kill and an elite; the champion row is gone and the event no longer names it
    expect(w.tally.kills).toBe(kills + 1);
    expect(w.tally.elitesKilled).toBe(elites + 1);
    expect(w.enemies.find(c.id)).toBe(-1);
    expect(runEventChampion(w)).toBe(0);
    expect(log.deaths.filter((d) => d.id === c.id)).toEqual([expect.objectContaining({ killer: 0, tier: 2 })]);
    // it never burrows afterwards: the escorts are ordinary creatures and stay
    runHunt(w, () => false, 5, log);
    expect(log.deaths.filter((d) => d.id === c.id)).toHaveLength(1);
    expect(chests(w, HUNT_CFG.chestTier)).toHaveLength(1);
    expect(escortSpawns(log).every((p) => w.enemies.find(p.id) >= 0)).toBe(true);
  });

  it('the chest is free: a broke hero standing on it opens it (a tier-1 chest costs no yeop and no chest-count)', () => {
    const w = huntWorld({ config: { seed: 22 } });
    const log = startHunt(w);
    const c = championSpawns(log)[0] as HuntLog['spawns'][number];
    slay(w, w.enemies.find(c.id));
    runHunt(w, () => false, 1.5, log);
    const chest = chests(w, HUNT_CFG.chestTier)[0] as ReturnType<typeof chests>[number];
    const p = player(w);
    p.yeop = 0;
    p.x = p.px = chest.x;
    p.z = p.pz = chest.z;
    const opened = w.tally.chestsOpened;
    const own = p.chestsOpened;
    expect(w.modals).toHaveLength(0);
    runHunt(w, () => w.modals.length > 0, 1, log);
    expect(w.modals.length).toBeGreaterThan(0);
    expect(chests(w, HUNT_CFG.chestTier)).toHaveLength(0);
    expect(w.tally.chestsOpened).toBe(opened + 1);
    expect(p.chestsOpened).toBe(own);
  });

  it('a kill on the very last tick of the timer still counts', () => {
    const w = huntWorld({ config: { seed: 23 } });
    const log = startHunt(w);
    const s = ev(w);
    const c = championSpawns(log)[0] as HuntLog['spawns'][number];
    jumpTo(w, s.endAt - 1.5 * DT);
    slay(w, w.enemies.find(c.id));
    runHunt(w, () => s.stage === 'end', 2, log);
    expect(s.failed).toBe(false);
    expect(log.runEvents.at(-1)).toMatchObject({ phase: 'end', p: 1 });
    expect(chests(w, HUNT_CFG.chestTier)).toHaveLength(1);
  });
});

describe('Champion Hunt: out of time', () => {
  it('after the limit the champion burrows away: dissolves without a kill, no loot, no chest, the event ends failed (p = 0), the escorts stay', () => {
    const w = huntWorld({ config: { seed: 24 } });
    const log = startHunt(w);
    const s = ev(w);
    const c = championSpawns(log)[0] as HuntLog['spawns'][number];
    const kills = w.tally.kills;
    const elites = w.tally.elitesKilled;
    const xp = w.pickups.count;
    // 59 s in: still there
    runHunt(w, () => w.time >= s.startAt + 59, 70, log);
    expect(w.enemies.find(c.id)).toBeGreaterThanOrEqual(0);
    expect(runEventChampion(w)).toBe(c.id);
    expect(s.stage).toBe('active');
    runHunt(w, () => s.stage === 'end', 5, log);
    expect(s.stage).toBe('end');
    expect(s.failed).toBe(true);
    expect(s.endAt).toBeCloseTo(s.startAt + HUNT_CFG.timeLimit, 1);
    expect(log.runEvents.at(-1)).toMatchObject({ phase: 'end', p: 0 });
    // a despawn: one enemyDeath with killer -1 (the dissolve) and tier 0 (a quiet burrow: no death shake, no boss smoke), and no kill, no elite kill, no pickups, no chest
    expect(log.deaths.filter((d) => d.id === c.id)).toEqual([expect.objectContaining({ killer: -1, tier: 0 })]);
    expect(w.tally.kills).toBe(kills);
    expect(w.tally.elitesKilled).toBe(elites);
    runTicks(w, 5);
    expect(w.enemies.find(c.id)).toBe(-1);
    expect(runEventChampion(w)).toBe(0);
    expect(chests(w)).toHaveLength(0);
    expect(w.pickups.count).toBe(xp);
    expect(escortSpawns(log).every((p) => w.enemies.find(p.id) >= 0)).toBe(true);
    // the event closes normally afterwards
    runHunt(w, () => s.stage === 'done', RUN_EVENT_LINGER + 2, log);
    expect(s.stage).toBe('done');
    expect(log.deaths.filter((d) => d.id === c.id)).toHaveLength(1);
  });

  it('the timer is sim time: an open modal stops it, the champion stays and the limit is neither skipped nor shortened', () => {
    const w = huntWorld({ config: { seed: 25 } });
    const log = startHunt(w);
    const s = ev(w);
    const c = championSpawns(log)[0] as HuntLog['spawns'][number];
    runHunt(w, () => w.time >= s.startAt + 30, 40, log);
    const endAt = s.endAt;
    const t0 = w.time;
    const left = w.hud().runEvent?.left as number;
    openLevelUp(w, player(w), 2);
    expect(w.modals.length).toBeGreaterThan(0);
    runTicks(w, 600);
    expect(w.time).toBe(t0);
    expect(s.stage).toBe('active');
    expect(w.enemies.find(c.id)).toBeGreaterThanOrEqual(0);
    expect(w.hud().runEvent?.left).toBe(left);
    w.chooseCard(0, 0);
    drainModals(w);
    runHunt(w, () => w.time >= t0 + 20, 25, log);
    expect(s.endAt).toBe(endAt);
    expect(s.stage).toBe('active');
    expect((w.hud().runEvent?.left as number) < left).toBe(true);
  });

  it('the run ending during the hunt (the hero falls) sends the end failed and the champion goes with it', () => {
    const w = huntWorld({ config: { seed: 26 } });
    const log = startHunt(w);
    const s = ev(w);
    const c = championSpawns(log)[0] as HuntLog['spawns'][number];
    runHunt(w, () => w.time >= s.startAt + 5, 10, log);
    player(w).iframes = 0;
    hurtPlayer(w, 0, 1e13, 0, 0, 0, 0);
    runHunt(w, () => s.stage === 'end', 5, log);
    expect(s.stage).toBe('end');
    expect(s.failed).toBe(true);
    expect(log.runEvents.at(-1)).toMatchObject({ phase: 'end', p: 0 });
    expect(chests(w)).toHaveLength(0);
    runTicks(w, 3);
    expect(w.enemies.find(c.id)).toBe(-1);
    expect(w.endTimer).toBeGreaterThanOrEqual(0);
  });

  it('a revive does not matter to the hunt: the hero falling and rising again leaves the champion and the timer alone', () => {
    const w = huntWorld({ config: { seed: 27, coop: [MEMBER] } });
    const log = startHunt(w);
    const s = ev(w);
    const c = championSpawns(log)[0] as HuntLog['spawns'][number];
    runHunt(w, () => w.time >= s.startAt + 5, 10, log);
    player(w, 0).alive = false;
    runHunt(w, () => w.time >= s.startAt + 15, 20, log);
    expect(s.stage).toBe('active');
    expect(w.enemies.find(c.id)).toBeGreaterThanOrEqual(0);
    player(w, 0).alive = true;
    runHunt(w, () => w.time >= s.startAt + 20, 10, log);
    expect(s.stage).toBe('active');
    const row = w.enemies.find(c.id);
    // the party stands well away from the corpse, so nobody opens the chest in the same breath (the hunt is round either hero)
    const side = (w.enemies.x[row] as number) > 0 ? -1 : 1;
    for (const p of w.players) {
      p.x = p.px = (w.enemies.x[row] as number) + side * 25;
      p.z = p.pz = w.enemies.z[row] as number;
    }
    slay(w, row, 1);
    runHunt(w, () => s.stage === 'end', 2, log);
    expect(log.runEvents.at(-1)).toMatchObject({ phase: 'end', p: 1 });
    expect(chests(w, HUNT_CFG.chestTier)).toHaveLength(1);
  });
});

describe('Champion Hunt: walkable ground', () => {
  const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);

  /** the champion, its escorts and (after a kill) the chest of every seed stand on spawnable ground; `hero` is where the hero stands */
  function sweep(env: WorldEnv, hero: { x: number; z: number }): { w: World; log: HuntLog }[] {
    return SEEDS.map((seed) => {
      const w = huntWorld({ config: { seed }, env: { arenaRadius: ARENA, ...env } });
      const p = player(w);
      p.x = p.px = hero.x;
      p.z = p.pz = hero.z;
      return { w, log: startHunt(w) };
    });
  }

  function expectGrounded(w: World, log: HuntLog): void {
    expect(championSpawns(log)).toHaveLength(1);
    expect(escortSpawns(log)).toHaveLength(HUNT_CFG.escorts);
    for (const p of log.spawns) {
      expect(spawnable(w, p.x, p.z)).toBe(true);
      expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(ARENA - 1.5 + 1e-9);
    }
  }

  it('a hero on the arena rim: the champion and its escorts stand inside the arena', () => {
    for (const angle of [0, 1.9, 4.4]) {
      const hero = { x: Math.sin(angle) * (ARENA - 0.6), z: Math.cos(angle) * (ARENA - 0.6) };
      for (const { w, log } of sweep({}, hero)) {
        expectGrounded(w, log);
        const c = championSpawns(log)[0] as HuntLog['spawns'][number];
        expect(Math.hypot(c.x - hero.x, c.z - hero.z)).toBeLessThanOrEqual(12 + 1e-6);
      }
    }
  });

  it('next to a deep lake and a lava stream: nobody stands in the water or the lava', () => {
    const surfaceAt = (x: number, z: number): number => (x > 0 ? Surface.Deep : z >= 10 && z <= 16 ? Surface.Lava : Surface.Ground);
    for (const hero of [
      { x: -0.5, z: 0 },
      { x: -3, z: 8 },
      { x: -10, z: 12 },
    ]) {
      for (const { w, log } of sweep({ surfaceAt }, hero)) {
        expectGrounded(w, log);
        for (const p of log.spawns) expect(surfaceAt(p.x, p.z)).toBe(Surface.Ground);
      }
    }
  });

  it('inside a blocker cluster only the pocket round the hero is free: champion and escorts stand in the pocket', () => {
    const cluster: WorldEnv = { walkable: (x, z) => Math.hypot(x - 30, z) <= 2.5 || Math.hypot(x - 30, z) > 45 };
    for (const { w, log } of sweep(cluster, { x: 30, z: 0 })) {
      expectGrounded(w, log);
      for (const p of log.spawns) expect(Math.hypot(p.x - 30, p.z)).toBeLessThanOrEqual(2.5 + 1e-9);
    }
  });

  it('a hero standing in lava has no walkable ground: no champion, no escorts, no chest, and the hunt ends failed at once', () => {
    const lava: WorldEnv = { surfaceAt: () => Surface.Lava };
    const w = huntWorld({ config: { seed: 3 }, env: { arenaRadius: ARENA, ...lava } });
    const log = startHunt(w);
    const s = ev(w);
    runHunt(w, () => s.stage === 'end', 3, log);
    expect(championSpawns(log)).toHaveLength(0);
    expect(log.spawns).toHaveLength(0);
    expect(w.enemies.count).toBe(0);
    expect(s.failed).toBe(true);
    expect(log.runEvents.at(-1)).toMatchObject({ phase: 'end', p: 0 });
    expect(chests(w)).toHaveLength(0);
  });

  it('a champion that fell at the edge of a lake or lava leaves its chest on dry ground (the pop slide never ends in the water)', () => {
    const surfaceAt = (x: number, z: number): number => (x > 0 ? Surface.Deep : z > 6 ? Surface.Lava : Surface.Ground);
    for (const [fx, fz] of [
      [-0.04, 0],
      [-0.2, 0],
      [-0.3, 5.96],
      [-0.03, 5.99],
    ] as const) {
      for (const seed of SEEDS) {
        const w = makeWorld({ config: { seed, ...IMMORTAL }, env: { arenaRadius: ARENA, surfaceAt } });
        freezeSchedules(w);
        const p = player(w);
        p.x = p.px = -40;
        p.z = p.pz = -40;
        const r = dropEventChest(w, fx, fz, 1);
        expect(r).toBeGreaterThanOrEqual(0);
        runTicks(w, 90);
        const list = chests(w);
        expect(list).toHaveLength(1);
        const c = list[0] as ReturnType<typeof chests>[number];
        expect(surfaceAt(c.x, c.z)).toBe(Surface.Ground);
        expect(Math.hypot(c.x - fx, c.z - fz)).toBeLessThanOrEqual(0.5);
      }
    }
  });
});

describe('Champion Hunt: the chest of a champion that fell in lava, water or a blocker', () => {
  const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);
  const LAVA = { x: 20, z: 0, r: 6 };
  const lavaAt = (x: number, z: number): number => (Math.hypot(x - LAVA.x, z - LAVA.z) <= LAVA.r ? Surface.Lava : Surface.Ground);
  const lakeAt = (x: number, z: number): number => (x > 0 ? Surface.Deep : Surface.Ground);

  /** a quiet world with the hero well away, one chest dropped at the death spot, the pop slide played out */
  function drop(seed: number, env: WorldEnv, fx: number, fz: number): { w: World; x: number; z: number } {
    const w = makeWorld({ config: { seed, ...IMMORTAL }, env: { arenaRadius: ARENA, ...env } });
    freezeSchedules(w);
    const p = player(w);
    p.x = p.px = -40;
    p.z = p.pz = -40;
    expect(dropEventChest(w, fx, fz, 1)).toBeGreaterThanOrEqual(0);
    runTicks(w, 120);
    const list = chests(w);
    expect(list).toHaveLength(1);
    const c = list[0] as ReturnType<typeof chests>[number];
    return { w, x: c.x, z: c.z };
  }

  it('a champion that dies 2.5 m inside a lava pool leaves the chest on dry ground, a few metres from where it fell (60 of 60 seeds)', () => {
    for (const seed of SEEDS) {
      const fx = LAVA.x + 2.5 * Math.cos(seed);
      const fz = 2.5 * Math.sin(seed);
      expect(lavaAt(fx, fz)).toBe(Surface.Lava);
      const { w, x, z } = drop(seed, { surfaceAt: lavaAt }, fx, fz);
      expect(spawnable(w, x, z)).toBe(true);
      expect(lavaAt(x, z)).toBe(Surface.Ground);
      // the pool edge is 3.5 m away; the sweep keeps 1 m of dry ground round the chest where it can
      expect(Math.hypot(x - fx, z - fz)).toBeLessThanOrEqual(6);
      expect(Math.hypot(x - LAVA.x, z - LAVA.z)).toBeGreaterThan(LAVA.r);
    }
  });

  it('a champion that dies in the middle of the pool, or 0.1 m inside its edge, still leaves a chest on dry ground', () => {
    for (const [fx, fz] of [
      [LAVA.x, LAVA.z],
      [LAVA.x + LAVA.r - 0.1, 0],
      [LAVA.x, LAVA.r - 0.1],
      [LAVA.x - LAVA.r + 0.1, 0],
    ] as const) {
      for (const seed of SEEDS.slice(0, 10)) {
        const { w, x, z } = drop(seed, { surfaceAt: lavaAt }, fx, fz);
        expect(spawnable(w, x, z)).toBe(true);
        expect(Math.hypot(x - fx, z - fz)).toBeLessThanOrEqual(LAVA.r + 2);
      }
    }
  });

  it('a champion that dies in deep water leaves the chest on the shore, a few metres from where it fell', () => {
    for (const seed of SEEDS) {
      for (const fx of [0.3, 2.5, 4]) {
        const fz = Math.sin(seed) * 3;
        const { w, x, z } = drop(seed, { surfaceAt: lakeAt }, fx, fz);
        expect(spawnable(w, x, z)).toBe(true);
        expect(lakeAt(x, z)).toBe(Surface.Ground);
        // the shore is fx away; 1 m of clearance, one ring step (0.5 m) and the pop slide (< 0.4 m) on top
        expect(Math.hypot(x - fx, z - fz)).toBeLessThanOrEqual(fx + 2);
      }
    }
  });

  it('a champion that dies inside a blocker cluster leaves the chest on the walkable ground round it', () => {
    const cluster: WorldEnv = { walkable: (x, z) => Math.hypot(x - 30, z) > 4 };
    for (const seed of SEEDS.slice(0, 20)) {
      const { w, x, z } = drop(seed, cluster, 30 + Math.cos(seed), Math.sin(seed));
      expect(spawnable(w, x, z)).toBe(true);
      expect(Math.hypot(x - 30, z)).toBeGreaterThan(4);
      expect(Math.hypot(x - 30, z)).toBeLessThanOrEqual(6.5);
    }
  });

  it('the chest never leaves the arena: a death spot on a lava rim at the edge puts it on dry ground inside', () => {
    const rim = (x: number, z: number): number => (Math.hypot(x, z) > ARENA - 6 ? Surface.Lava : Surface.Ground);
    for (const seed of SEEDS.slice(0, 20)) {
      const a = seed * 0.9;
      const { w, x, z } = drop(seed, { surfaceAt: rim }, Math.sin(a) * (ARENA - 3), Math.cos(a) * (ARENA - 3));
      expect(spawnable(w, x, z)).toBe(true);
      expect(Math.hypot(x, z)).toBeLessThanOrEqual(ARENA - 6);
    }
  });

  it('with no dry ground within reach the chest goes to the nearest living hero, else it stays where it fell', () => {
    // lava everywhere but a small meadow round the hero
    const meadow = (x: number, z: number): number => (Math.hypot(x + 60, z) <= 3 ? Surface.Ground : Surface.Lava);
    for (const seed of SEEDS.slice(0, 10)) {
      const w = makeWorld({ config: { seed, ...IMMORTAL }, env: { arenaRadius: ARENA, surfaceAt: meadow } });
      freezeSchedules(w);
      const p = player(w);
      p.x = p.px = -60;
      p.z = p.pz = 0;
      // the hero opens it at once (it lies at its feet), so look right after the drop
      const r = dropEventChest(w, 20, 0, 1);
      expect(r).toBeGreaterThanOrEqual(0);
      const cx = w.pickups.x[r] as number;
      const cz = w.pickups.z[r] as number;
      expect(spawnable(w, cx, cz)).toBe(true);
      expect(Math.hypot(cx + 60, cz)).toBeLessThanOrEqual(1e-9);
      expect(Math.hypot((w.pickups.vx[r] as number) / 4 + cx + 60, (w.pickups.vz[r] as number) / 4 + cz)).toBeLessThanOrEqual(3);
    }
    // nobody lives: nothing to fall back to, the chest rests where it fell (the run is over anyway)
    const w = makeWorld({ config: { seed: 1, ...IMMORTAL }, env: { arenaRadius: ARENA, surfaceAt: meadow } });
    freezeSchedules(w);
    player(w).alive = false;
    const r = dropEventChest(w, 20, 0, 1);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(w.pickups.x[r]).toBe(20);
    expect(w.pickups.z[r]).toBe(0);
  });

  it('moving the drop point draws no random number: the spawn stream is untouched, the loot stream spends the same draws as a dry drop, and the same drop twice is the same chest', () => {
    const mk = (): World => makeWorld({ config: { seed: 9, ...IMMORTAL }, env: { arenaRadius: ARENA, surfaceAt: lavaAt } });
    const dry = mk();
    const wet = mk();
    const again = mk();
    const rd = dropEventChest(dry, -30, 0, 1);
    const rw = dropEventChest(wet, LAVA.x, LAVA.z, 1);
    const ra = dropEventChest(again, LAVA.x, LAVA.z, 1);
    expect(rd).toBeGreaterThanOrEqual(0);
    expect(rw).toBeGreaterThanOrEqual(0);
    expect(ra).toBeGreaterThanOrEqual(0);
    expect(wet.rng.spawn.next()).toBe(mk().rng.spawn.next());
    expect(wet.rng.loot.next()).toBe(dry.rng.loot.next());
    expect(again.pickups.x[ra]).toBe(wet.pickups.x[rw]);
    expect(again.pickups.z[ra]).toBe(wet.pickups.z[rw]);
    // it moved: the chest is not in the pool
    expect(lavaAt(wet.pickups.x[rw] as number, wet.pickups.z[rw] as number)).toBe(Surface.Ground);
  });

  it('end to end: a champion slain in lava leaves a chest on dry ground, and the hunt records where it rests', () => {
    const w = huntWorld({ config: { seed: 51 }, env: { arenaRadius: ARENA, surfaceAt: lavaAt } });
    const p = player(w);
    p.x = p.px = LAVA.x - 12;
    p.z = p.pz = 0;
    const log = startHunt(w);
    const s = ev(w);
    const c = championSpawns(log)[0] as HuntLog['spawns'][number];
    const row = w.enemies.find(c.id);
    // creatures walk on lava: the champion has chased into the pool
    w.enemies.x[row] = LAVA.x + 1.5;
    w.enemies.z[row] = 1;
    runHunt(w, () => w.time >= s.startAt + 3, 6, log);
    const at = w.enemies.find(c.id);
    const fx = w.enemies.x[at] as number;
    const fz = w.enemies.z[at] as number;
    expect(lavaAt(fx, fz)).toBe(Surface.Lava);
    slay(w, at, 0, log);
    runHunt(w, () => s.stage === 'end', 3, log);
    expect(log.runEvents.at(-1)).toMatchObject({ phase: 'end', p: 1 });
    const list = chests(w, HUNT_CFG.chestTier);
    expect(list).toHaveLength(1);
    const k = list[0] as ReturnType<typeof chests>[number];
    expect(spawnable(w, k.x, k.z)).toBe(true);
    expect(lavaAt(k.x, k.z)).toBe(Surface.Ground);
    expect(Math.hypot(k.x - fx, k.z - fz)).toBeLessThanOrEqual(7);
  });
});

describe('Champion Hunt: the schedule keeps the whole hunt clear of the bosses', () => {
  it('announce .. start + timeLimit stays bossGap from every boss spawn, for every seed of the default window (the start alone would let a hunt run into a boss)', () => {
    const gap = DEFAULT_RUN_EVENTS.bossGap;
    expect(runEventKindDef(HUNT)?.span?.(quiet([HUNT]))).toBe(HUNT_CFG.timeLimit);
    let late = 0;
    for (let seed = 1; seed <= 80; seed++) {
      const w = quiet([HUNT], { config: { seed } });
      const s = ev(w);
      expect(s.kind).toBe(HUNT);
      const from = s.announceAt;
      const to = s.startAt + HUNT_CFG.timeLimit;
      for (const b of BOSSES) expect(from >= b + gap - 1e-9 || to <= b - gap + 1e-9, `seed ${seed}: hunt ${from.toFixed(1)}..${to.toFixed(1)} vs boss ${b}`).toBe(true);
      if (s.startAt > 450) late++;
    }
    // both spans of the window are used (380-390 s and 515-620 s of the fixture zone)
    expect(late).toBeGreaterThan(10);
    expect(late).toBeLessThan(80);
  });

  it('a window that cannot hold the whole hunt falls back to the plain start gap (a hunt next to a boss beats no hunt), and a hunt with the bosses far away is untouched', () => {
    const w = quiet([HUNT], { config: { seed: 3 } }, [392, 394]);
    expect(ev(w).kind).toBe(HUNT);
    expect(ev(w).startAt).toBeGreaterThanOrEqual(392);
    expect(ev(w).startAt).toBeLessThanOrEqual(394);
    const far = quiet([HUNT], { config: { seed: 3 } }, [600, 601]);
    expect(ev(far).startAt).toBeGreaterThanOrEqual(600);
    expect(ev(far).startAt).toBeLessThanOrEqual(601);
  });
});

describe('Champion Hunt: the event follows the champion', () => {
  it('the running hunt is re-emitted as soon as the champion has moved RUN_EVENT_MOVE_DIST m (a guest pointer follows it), with the champion position', () => {
    const w = huntWorld({ config: { seed: 42, coop: [MEMBER] } });
    const log = startHunt(w);
    const s = ev(w);
    const c = championSpawns(log)[0] as HuntLog['spawns'][number];
    runHunt(w, () => w.time >= s.startAt + 1, 3, log);
    const row = w.enemies.find(c.id);
    const before = log.runEvents.length;
    const tx = (w.enemies.x[row] as number) + 20;
    w.enemies.x[row] = tx;
    runHunt(w, () => false, RUN_EVENT_MOVE_GAP + 0.15, log);
    const beats = log.runEvents.slice(before).filter((e) => e.phase === 'active');
    expect(beats.length).toBeGreaterThanOrEqual(1);
    const b = beats[0] as RunEventSim;
    expect(Math.abs(b.x - tx)).toBeLessThan(RUN_EVENT_MOVE_DIST + 1);
    // the event's own position tracks the champion every tick
    const now = w.enemies.find(c.id);
    expect(Math.hypot(s.x - (w.enemies.x[now] as number), s.z - (w.enemies.z[now] as number))).toBeLessThan(1);
    // slain: the event ends where the champion fell and the next beat is the 'end'
    const fx = w.enemies.x[now] as number;
    const fz = w.enemies.z[now] as number;
    slay(w, now, 0, log);
    runHunt(w, () => s.stage === 'end', 2, log);
    expect(s.stage).toBe('end');
    expect(Math.hypot(s.x - fx, s.z - fz)).toBeLessThan(1);
    expect(log.runEvents.at(-1)).toMatchObject({ phase: 'end', p: 1 });
  });
});

describe('Champion Hunt: a hunt that cannot start', () => {
  it('a zone without any band elite has no champion: the hunt starts and ends failed at once, drawing nothing more', () => {
    const w = huntWorld({
      config: { seed: 33 },
      content: (c) => {
        for (const z of c.zones) for (const b of z.bands) delete b.elites;
      },
    });
    const log = startHunt(w);
    const s = ev(w);
    runHunt(w, () => s.stage === 'end', 3, log);
    expect(log.spawns).toHaveLength(0);
    expect(s.failed).toBe(true);
    expect(log.runEvents.at(-1)).toMatchObject({ phase: 'end', p: 0 });
    expect(chests(w)).toHaveLength(0);
  });

  it('a full enemy store has no room for the champion: the hunt ends failed without breaking the sim', () => {
    const w = huntWorld({ config: { seed: 34 } });
    const s = ev(w);
    jumpTo(w, s.announceAt - 0.1);
    const wolf = typeOf(w, 'wolf');
    while (spawnEnemy(w, wolf, 60 + (w.enemies.count % 40), 60 + Math.floor(w.enemies.count / 40), { spawnTime: 0 }) >= 0) {
      // fill it
    }
    expect(w.enemies.count).toBe(CAP.enemies);
    const log = runHunt(w, () => s.stage === 'end', 12);
    expect(championSpawns(log)).toHaveLength(0);
    expect(s.failed).toBe(true);
    expect(log.runEvents.at(-1)).toMatchObject({ phase: 'end', p: 0 });
    expect(chests(w)).toHaveLength(0);
  });

  it('with the zone listing the kind but no hero alive at the start, the hunt ends failed and spawns nothing', () => {
    const w = huntWorld({ config: { seed: 35, coop: [MEMBER] } });
    const s = ev(w);
    jumpTo(w, s.announceAt - 0.1);
    runHunt(w, () => s.stage === 'announce', 3);
    player(w, 0).alive = false;
    player(w, 1).alive = false;
    const log = runHunt(w, () => s.stage === 'end', 12);
    expect(championSpawns(log)).toHaveLength(0);
    expect(s.failed).toBe(true);
  });
});

describe('Champion Hunt: co-op', () => {
  it('the champion is placed round a LIVING hero drawn with rng.spawn (the host and the guests all get the hunt beside them), with the same HP formula as in a solo run (no party factor)', () => {
    const solo = huntWorld({ config: { seed: 41 } });
    const soloLog = startHunt(solo);
    const sc = championSpawns(soloLog)[0] as HuntLog['spawns'][number];
    const soloDef = solo.typeDefs[sc.type] as NonNullable<(typeof solo.typeDefs)[number]>;
    const soloRatio = (solo.enemies.hpMax[solo.enemies.find(sc.id)] as number) / (soloDef.hp * solo.hpScale());
    expect(soloRatio).toBeCloseTo(HUNT_CFG.hpMul, 4);

    // hero 0 stands at the origin, hero 1 far away: the hunt is round one of them, never anywhere else, and over the seeds BOTH get it
    const near = [0, 0];
    for (let seed = 1; seed <= 40; seed++) {
      const duo = huntWorld({ config: { seed, coop: [MEMBER] } });
      player(duo, 1).x = player(duo, 1).px = -70;
      player(duo, 1).z = player(duo, 1).pz = 55;
      const duoLog = startHunt(duo);
      const dc = championSpawns(duoLog)[0] as HuntLog['spawns'][number];
      const d0 = Math.hypot(dc.x, dc.z);
      const d1 = Math.hypot(dc.x + 70, dc.z - 55);
      expect(Math.min(d0, d1)).toBeLessThanOrEqual(12 + 1e-6);
      near[d0 <= d1 ? 0 : 1] = (near[d0 <= d1 ? 0 : 1] as number) + 1;
      const duoDef = duo.typeDefs[dc.type] as NonNullable<(typeof duo.typeDefs)[number]>;
      const duoRatio = (duo.enemies.hpMax[duo.enemies.find(dc.id)] as number) / (duoDef.hp * duo.hpScale());
      expect(duoRatio).toBeCloseTo(HUNT_CFG.hpMul, 4);
      expect(escortSpawns(duoLog)).toHaveLength(HUNT_CFG.escorts);
    }
    expect(near[0]).toBeGreaterThanOrEqual(8);
    expect(near[1]).toBeGreaterThanOrEqual(8);

    // hero 0 down at the start: the hunt is round hero 1 every time
    for (const seed of [41, 42, 43, 44, 45, 46]) {
      const down = huntWorld({ config: { seed, coop: [MEMBER] } });
      const s = ev(down);
      player(down, 1).x = player(down, 1).px = -70;
      player(down, 1).z = player(down, 1).pz = 55;
      jumpTo(down, s.announceAt - 0.1);
      runHunt(down, () => s.stage === 'announce', 3);
      player(down, 0).alive = false;
      const downLog = runHunt(down, () => s.stage === 'active', 8);
      const c2 = championSpawns(downLog)[0] as HuntLog['spawns'][number];
      expect(Math.hypot(c2.x + 70, c2.z - 55)).toBeLessThanOrEqual(12 + 1e-6);
    }
  });

  it('the hunt hero is drawn at the ANNOUNCE: the announce x / z is the hero the hunt goes to, and the champion later stands round that same hero', () => {
    const FAR = { x: -70, z: 55 };
    const seen = [0, 0];
    for (let seed = 1; seed <= 40; seed++) {
      const w = huntWorld({ config: { seed, coop: [MEMBER] } });
      player(w, 1).x = player(w, 1).px = FAR.x;
      player(w, 1).z = player(w, 1).pz = FAR.z;
      const s = ev(w);
      jumpTo(w, s.announceAt - 0.1);
      const log = newHuntLog();
      while (s.stage !== 'announce') stepHunt(w, log);
      const at0 = Math.hypot(s.x, s.z) < 1e-6;
      const at1 = Math.hypot(s.x - FAR.x, s.z - FAR.z) < 1e-6;
      expect(at0 !== at1, `seed ${seed}: the announce position is one of the heroes`).toBe(true);
      const beat = log.runEvents.find((e) => e.phase === 'announce') as RunEventSim;
      expect(Math.hypot(beat.x - s.x, beat.z - s.z)).toBeLessThan(1e-9);
      const hero = at0 ? 0 : 1;
      seen[hero] = (seen[hero] as number) + 1;
      while ((s.stage as string) !== 'active') stepHunt(w, log);
      const c = championSpawns(log)[0] as HuntLog['spawns'][number];
      const home = hero === 0 ? { x: 0, z: 0 } : FAR;
      expect(Math.hypot(c.x - home.x, c.z - home.z), `seed ${seed}: the champion stands round the announced hero`).toBeLessThanOrEqual(12 + 1e-6);
    }
    expect(seen[0]).toBeGreaterThanOrEqual(8);
    expect(seen[1]).toBeGreaterThanOrEqual(8);
  });

  it('when the announced hero falls before the start the champion stands round the first living hero (no extra draw), and the hunt still runs', () => {
    const FAR = { x: -70, z: 55 };
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const w = huntWorld({ config: { seed, coop: [MEMBER] } });
      player(w, 1).x = player(w, 1).px = FAR.x;
      player(w, 1).z = player(w, 1).pz = FAR.z;
      const s = ev(w);
      jumpTo(w, s.announceAt - 0.1);
      const log = newHuntLog();
      while (s.stage !== 'announce') stepHunt(w, log);
      const drawn = Math.hypot(s.x, s.z) < 1e-6 ? 0 : 1;
      player(w, drawn).alive = false;
      while ((s.stage as string) !== 'active') stepHunt(w, log);
      const other = drawn === 0 ? FAR : { x: 0, z: 0 };
      const c = championSpawns(log)[0] as HuntLog['spawns'][number];
      expect(c, `seed ${seed}`).toBeDefined();
      expect(Math.hypot(c.x - other.x, c.z - other.z)).toBeLessThanOrEqual(12 + 1e-6);
      expect(runEventChampion(w)).toBe(c.id);
    }
  });

  it('the hunt hero costs ONE spawn draw at the announce with two living heroes and none with one (a solo run and a party with a fallen hero spend the stream alike)', () => {
    const announceDraws = (coop: boolean, down: number): number => {
      const w = huntWorld({ config: { seed: 44, ...(coop ? { coop: [MEMBER] } : {}) } });
      const s = ev(w);
      jumpTo(w, s.announceAt - 0.1);
      if (down >= 0) player(w, down).alive = false;
      const rng = w.rng.spawn;
      let n = 0;
      const next = rng.next.bind(rng);
      rng.next = (): number => (n++, next());
      runHunt(w, () => s.stage === 'announce', 3);
      return n;
    };
    expect(announceDraws(false, -1)).toBe(0);
    expect(announceDraws(true, 1)).toBe(0);
    expect(announceDraws(true, 0)).toBe(0);
    expect(announceDraws(true, -1)).toBe(1);
  });

  it('the host re-emits the running hunt every 5 s with the champion position and the same absolute times, so a late joiner or guest shows it within 5 s', () => {
    const w = huntWorld({ config: { seed: 42, coop: [MEMBER] } });
    const log = startHunt(w);
    const s = ev(w);
    const c = championSpawns(log)[0] as HuntLog['spawns'][number];
    runHunt(w, () => w.time >= s.startAt + 22, 30, log);
    const beats = log.runEvents.filter((e) => e.phase === 'active');
    expect(beats.length).toBeGreaterThanOrEqual(4);
    for (const b of beats) {
      expect(b.kind).toBe(HUNT);
      expect(b.startAt).toBe(s.startAt);
      expect(b.endAt).toBe(s.startAt + HUNT_CFG.timeLimit);
    }
    // the position in the beat is the champion's at that moment: it moves over a minute, the beats follow it
    expect(beats.some((b) => Math.hypot(b.x - c.x, b.z - c.z) > 0.5)).toBe(true);
    const row = w.enemies.find(c.id);
    const last = beats.at(-1) as RunEventSim;
    expect(Math.hypot(last.x - (w.enemies.x[row] as number), last.z - (w.enemies.z[row] as number))).toBeLessThan(5 * 12);
    // a guest derives the HUD from the mirrored event and the mirrored clock: its timer is the host's
    const view = { kind: last.kind, phase: 'active' as const, x: last.x, z: last.z, startAt: last.startAt, endAt: last.endAt };
    expect(runEventHudOf(view, w.time)?.left).toBeCloseTo(w.hud().runEvent?.left as number, 6);
    expect(w.hud().runEvent).toMatchObject({ kind: HUNT, phase: 'active' });
    expect(w.hud(1).runEvent).toMatchObject({ kind: HUNT, phase: 'active', left: w.hud().runEvent?.left });
  });

  it('the chest opens for the hero that reaches it (hero 1 here), not for the hero far away', () => {
    const w = huntWorld({ config: { seed: 43, coop: [MEMBER] } });
    const log = startHunt(w);
    const c = championSpawns(log)[0] as HuntLog['spawns'][number];
    slay(w, w.enemies.find(c.id), 1);
    runHunt(w, () => false, 1.5, log);
    const chest = chests(w, HUNT_CFG.chestTier)[0] as ReturnType<typeof chests>[number];
    const p1 = player(w, 1);
    p1.x = p1.px = chest.x;
    p1.z = p1.pz = chest.z;
    player(w, 0).x = player(w, 0).px = chest.x + 60;
    runHunt(w, () => w.modals.length > 0, 1, log);
    expect(w.modals.length).toBeGreaterThan(0);
    expect(w.modals[0]?.player).toBe(1);
    expect(chests(w, HUNT_CFG.chestTier)).toHaveLength(0);
  });
});

describe('Champion Hunt: a co-op guest (host + guest + late join)', () => {
  let t: CoopHarness | null = null;
  afterEach(() => {
    t?.dispose();
    t = null;
  });

  /** the fixture zone with the hunt inside 20-24 s, nothing else spawning, a band elite pool to draw the champion from */
  const huntContent = (c: ContentDB): void => {
    c.runEvents = { ...structuredClone(DEFAULT_RUN_EVENTS), window: [20, 24], bossGap: 0, zones: { [FIXTURE_ZONE_ID]: [HUNT as unknown as RunEventKind] } };
    const z = c.zones.find((q) => q.id === FIXTURE_ZONE_ID);
    if (z === undefined) throw new Error('no fixture zone');
    z.bands = [{ from: 0, to: 900, rate: 0, maxAlive: 0, spawns: [{ enemy: 'wolf', weight: 1 }], elites: { every: 1e9, pool: ['alpha_wolf'] } }];
    z.bosses = [];
    z.metins = { types: ['metin_lament'], firstAt: 1e6, interval: [1e6, 1e6] };
  };

  interface Net {
    h: CoopHarness;
    guestEvents: RunEventSim[];
    tick(n?: number): void;
    until(pred: () => boolean, limit?: number): number;
  }

  async function party(): Promise<Net> {
    const h = await CoopHarness.create({ guests: 1, latencyMs: 30, tough: true, content: huntContent });
    t = h;
    const guestEvents: RunEventSim[] = [];
    const tick = (n = 1): void => {
      for (let i = 0; i < n; i++) {
        h.tick();
        for (const p of h.hostWorld.players) p.hp = p.hpMax;
        // both players answer every card modal at once (the shared sim pauses while one is open, and so does the hunt timer)
        if (h.hostWorld.modal !== null) h.hostWorld.chooseCard(0);
        const gw = h.guestWorlds[0] as World;
        if (gw.modal !== null) gw.chooseCard(0);
        for (const e of gw.events) if (e.t === 'runEvent') guestEvents.push({ ...e });
      }
    };
    const until = (pred: () => boolean, limit = 60): number => {
      let n = 0;
      while (!pred() && n < limit * 60) {
        tick();
        n++;
      }
      return n;
    };
    return { h, guestEvents, tick, until };
  }

  const leaderRows = (w: World): number[] => {
    const out: number[] = [];
    for (let i = 0; i < w.enemies.count; i++) if (((w.enemies.flags[i] as number) & EnemyFlag.Leader) !== 0) out.push(i);
    return out;
  };
  const guestChests = (w: World, tier: number): number =>
    Array.from({ length: w.pickups.count }, (_, i) => i).filter((i) => w.pickups.kind[i] === PickupKind.Chest && w.pickups.tier[i] === tier).length;

  it('the guest sees the announce, the champion (the Leader flag, tier 2, its larger body) with its escorts, and the hunt on its HUD; the host kill ends it for both and the free chest drops on both', async () => {
    const n = await party();
    const hw = n.h.hostWorld;
    const mw = n.h.guestWorlds[0] as World;
    const s = ev(hw);
    expect(s.kind).toBe(HUNT);
    n.until(() => s.stage === 'announce', 40);
    n.until(() => mw.hud(0).runEvent !== undefined, 5);
    expect(mw.hud(0).runEvent).toMatchObject({ kind: HUNT, phase: 'announce' });
    // the announce position is the hero the hunt goes to (the host's own position here: both heroes spawn together)
    expect(Math.hypot((mw.hud(0).runEvent?.x ?? 1e9) - s.x, (mw.hud(0).runEvent?.z ?? 1e9) - s.z)).toBeLessThan(0.1);
    n.until(() => s.stage === 'active', 10);
    const id = runEventChampion(hw);
    expect(id).toBeGreaterThan(0);
    n.until(() => leaderRows(mw).length === 1 && mw.enemies.count === 1 + HUNT_CFG.escorts, 4);
    const rows = leaderRows(mw);
    expect(rows).toHaveLength(1);
    const g = rows[0] as number;
    const hr = hw.enemies.find(id);
    expect(mw.enemies.eliteTier[g]).toBe(2);
    expect(mw.enemies.scale[g]).toBeCloseTo(hw.enemies.scale[hr] as number, 1);
    expect((mw.enemies.scale[g] as number) / (mw.typeDefs[mw.enemies.type[g] as number]?.scale ?? 1)).toBeGreaterThan(CHAMPION_SCALE * 1.12 * 0.9);
    expect(hw.enemies.count).toBe(1 + HUNT_CFG.escorts);
    expect(mw.hud(0).runEvent).toMatchObject({ kind: HUNT, phase: 'active' });
    expect(mw.hud(0).runEvent?.left).toBeCloseTo(s.endAt - mw.time, 0);
    // the host kills the champion: both worlds end the hunt, the guest event carries p = 1
    n.tick(120);
    slay(hw, hw.enemies.find(id), 0);
    n.until(() => n.guestEvents.some((e) => e.phase === 'end'), 5);
    expect(n.guestEvents.filter((e) => e.phase === 'end')).toEqual([expect.objectContaining({ kind: HUNT, p: 1 })]);
    n.until(() => guestChests(mw, HUNT_CFG.chestTier) === 1, 3);
    expect(guestChests(hw, HUNT_CFG.chestTier)).toBe(1);
    expect(guestChests(mw, HUNT_CFG.chestTier)).toBe(1);
    expect(leaderRows(mw)).toHaveLength(0);
    expect(mw.hud(0).runEvent).toMatchObject({ phase: 'end' });
  }, 60_000);

  it('a hunt nobody wins: the champion burrows at the limit on the host and vanishes from the guest, the end carries p = 0 and no chest drops', async () => {
    const n = await party();
    const hw = n.h.hostWorld;
    const mw = n.h.guestWorlds[0] as World;
    const s = ev(hw);
    n.until(() => s.stage === 'active', 40);
    // nobody kills this champion: it is made unkillable the tick it stands
    const id = runEventChampion(hw);
    expect(id).toBeGreaterThan(0);
    hw.enemies.hp[hw.enemies.find(id)] = 1e12;
    hw.enemies.hpMax[hw.enemies.find(id)] = 1e12;
    n.until(() => leaderRows(mw).length === 1, 4);
    expect(leaderRows(mw)).toHaveLength(1);
    n.until(() => s.stage === 'end', HUNT_CFG.timeLimit + 5);
    expect(s.failed).toBe(true);
    n.until(() => n.guestEvents.some((e) => e.phase === 'end'), 5);
    expect(n.guestEvents.filter((e) => e.phase === 'end')).toEqual([expect.objectContaining({ kind: HUNT, p: 0 })]);
    n.until(() => leaderRows(mw).length === 0, 4);
    expect(leaderRows(mw)).toHaveLength(0);
    expect(guestChests(mw, HUNT_CFG.chestTier)).toBe(0);
    expect(guestChests(hw, HUNT_CFG.chestTier)).toBe(0);
  }, 90_000);

  it('a guest that reconnects mid-hunt shows the hunt again within 5.5 s with the timer of the host, and sees the champion', async () => {
    const n = await party();
    const hw = n.h.hostWorld;
    const mw = n.h.guestWorlds[0] as World;
    const s = ev(hw);
    n.until(() => s.stage === 'active', 40);
    n.tick(300);
    expect(mw.hud(0).runEvent).toMatchObject({ kind: HUNT, phase: 'active' });
    await n.h.reconnect(1);
    const spent = n.until(() => mw.hud(0).runEvent?.phase === 'active' && leaderRows(mw).length === 1, 8);
    expect(spent / 60).toBeLessThan(5.5);
    expect(mw.hud(0).runEvent?.left).toBeCloseTo(s.endAt - mw.time, 0);
    expect(leaderRows(mw)).toHaveLength(1);
  }, 90_000);
});

describe('Champion Hunt: the spawner helpers', () => {
  it('bandElitePool: the pool of the band running now, the nearest band with one before the first elite band, [] when the zone has none', () => {
    const w = makeWorld();
    expect(bandElitePool(w, 400)).toEqual(HUNT_POOL);
    expect(bandElitePool(w, 200)).toEqual(['alpha_wolf']);
    expect(bandElitePool(w, 800)).toEqual(HUNT_POOL);
    // before the first elite band (0-120 s has none): the nearest band that has a pool, the later ones included
    expect(bandElitePool(w, 50)).toEqual(['alpha_wolf']);
    const bare = makeWorld({
      content: (c) => {
        for (const z of c.zones) for (const b of z.bands) delete b.elites;
      },
    });
    expect(bandElitePool(bare, 400)).toEqual([]);
    expect(pickBandElite(bare)).toBe(-1);
  });

  it('pickBandElite and pickBandCreature draw exactly once from rng.spawn and resolve a type of the band', () => {
    const w = makeWorld();
    w.time = 400;
    const twin = makeWorld();
    const before = w.rng.spawn.getState();
    const e = pickBandElite(w);
    twin.rng.spawn.next();
    expect(w.rng.spawn.getState()).toEqual(twin.rng.spawn.getState());
    expect(w.rng.spawn.getState()).not.toEqual(before);
    expect(HUNT_POOL).toContain(w.typeDefs[e]?.id);
    const c = pickBandCreature(w);
    twin.rng.spawn.next();
    expect(w.rng.spawn.getState()).toEqual(twin.rng.spawn.getState());
    expect(w.typeDefs[c]).toBeDefined();
    const bandIds = new Set((w.zone.bands.find((b) => b.from <= 400 && 400 < b.to) as { spawns: { enemy: string }[] }).spawns.map((s) => s.enemy));
    expect(bandIds.has(w.typeDefs[c]?.id as string)).toBe(true);
  });

  it('despawnEnemy removes a living creature without a kill, once', () => {
    const w = quiet([KIND_A]);
    const row = spawn(w, 'wolf', 6, 6);
    const alive = w.spawner.alive;
    const kills = w.tally.kills;
    const pickups = w.pickups.count;
    expect(despawnEnemy(w, row)).toBe(true);
    expect(w.enemies.state[row]).toBe(EnemyState.Dying);
    expect(w.spawner.alive).toBe(alive - 1);
    expect(despawnEnemy(w, row)).toBe(false);
    expect(w.spawner.alive).toBe(alive - 1);
    expect(despawnEnemy(w, -1)).toBe(false);
    expect(despawnEnemy(w, w.enemies.count + 3)).toBe(false);
    const deaths = w.events.filter((e) => e.t === 'enemyDeath');
    expect(deaths).toEqual([expect.objectContaining({ killer: -1, tier: 0 })]);
    runTicks(w, 3);
    expect(w.enemies.count).toBe(0);
    expect(w.tally.kills).toBe(kills);
    expect(w.pickups.count).toBe(pickups);
  });
});

describe('Champion Hunt: the quiet burrow', () => {
  it("despawnEnemy(quiet) reports tier 0 for a tier-2 row (no death shake or boss smoke for a creature that left); the default reports the row's tier; the row keeps its tier either way", () => {
    const w = quiet([KIND_A]);
    const a = spawn(w, 'wolf', 6, 6, { tier: 2 });
    const b = spawn(w, 'wolf', -6, 6, { tier: 2 });
    w.events.length = 0;
    expect(despawnEnemy(w, a)).toBe(true);
    expect(despawnEnemy(w, b, true)).toBe(true);
    const deaths = w.events.filter((e) => e.t === 'enemyDeath');
    expect(deaths).toEqual([expect.objectContaining({ tier: 2, killer: -1 }), expect.objectContaining({ tier: 0, killer: -1 })]);
    expect(w.enemies.eliteTier[a]).toBe(2);
    expect(w.enemies.eliteTier[b]).toBe(2);
    expect(w.spawner.alive).toBe(0);
  });
});

describe('Champion Hunt: the real content', () => {
  const ZONES = ['yeonmu', 'suryeon', 'seori', 'daeryeol'];

  it('every zone has a band elite pool for the whole event window and every id resolves to a creature', () => {
    for (const zoneId of ZONES) {
      const db = structuredClone(realContent);
      (db.runEvents as RunEventsDef).zones = { [zoneId]: [HUNT as unknown as RunEventKind] };
      const w = createWorld({ zone: zoneId, difficulty: 'normal', classId: 'warrior', doctrine: 'a', sex: 'm', empire: 'saehwa', seed: 5, meta: { stats: {} } }, db);
      expect(w.runEvent?.kind, zoneId).toBe(HUNT);
      for (const t of [380, 450, 500, 540, 600, 620]) {
        const pool = bandElitePool(w, t);
        expect(pool.length, `${zoneId} ${t}`).toBeGreaterThan(0);
        for (const id of pool) expect(w.ix.typeIndex.has(id), `${zoneId} ${id}`).toBe(true);
      }
      const s = w.runEvent as RunEventRun;
      expect(s.startAt).toBeGreaterThanOrEqual(380);
      expect(s.startAt).toBeLessThanOrEqual(620);
    }
  });

  it('shipped content lists no zone: the kind being registered changes nothing (no event, no draw)', () => {
    for (const zoneId of ZONES) {
      const w = createWorld({ zone: zoneId, difficulty: 'normal', classId: 'warrior', doctrine: 'a', sex: 'm', empire: 'saehwa', seed: 5, meta: { stats: {} } }, realContent);
      expect(w.runEvent, zoneId).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Golden Hour (EV-01): the fourth kind. For 45 s the zone's elites come twice as often (eliteEvery x0.5) and yeop is worth double (yeop x2):
// two run modifiers (RS-01 `setEventMods`) set the tick the active phase starts and cleared the tick it ends, however it ends.

const GOLD = 'goldenHour';
const GOLD_CFG = DEFAULT_RUN_EVENTS.kinds.goldenHour;
/** the active phase starts inside this window: the fixture zone's bosses (180, 480, 900) are 30 s away */
const GOLD_WINDOW: RunEventsDef['window'] = [400, 401];
type GoldCfg = RunEventsDef['kinds']['goldenHour'];
/** the soak's `god` meta stats (dev/soakCore.ts STATS.god): the calibration hero of the plausibility limits */
const GOLD_GOD = { maxHpPct: 8, armor: 150, regen: 10, damage: 4 };

/** a quiet world whose event is the Golden Hour; `cfg` patches its content (duration / eliteEveryMul / yeopMul) */
function goldWorld(over: Parameters<typeof makeWorld>[0] = {}, cfg: Partial<GoldCfg> = {}): World {
  return quiet(
    [GOLD],
    {
      ...over,
      content: (c) => {
        Object.assign((c.runEvents as RunEventsDef).kinds.goldenHour, cfg);
        over.content?.(c);
      },
    },
    GOLD_WINDOW,
  );
}

interface GoldTick {
  time: number;
  stage: RunEventStage;
  yeop: number;
  eliteEvery: number;
  hot: boolean;
}

/** step from just before the announce to the tick the event is gone, one sample per tick (the world's own modifiers as the sim reads them) */
function goldTrace(w: World, limit = 90): GoldTick[] {
  const s = ev(w);
  jumpTo(w, s.announceAt - 0.1);
  const out: GoldTick[] = [];
  for (let i = 0; i < Math.ceil(limit / DT) && s.stage !== 'done'; i++) {
    w.step([NO_INPUT]);
    out.push({ time: w.time, stage: s.stage, yeop: w.mods.yeop, eliteEvery: w.mods.eliteEvery, hot: w.hasEventMods(GOLDEN_HOUR_MODS_ID) });
  }
  return out;
}

/** content patch: one band with no ordinary spawns whose elites (`alpha_wolf`) come every `every` s, no bosses, no metins */
function eliteBand(every: number): (c: ContentDB) => void {
  return (c) => {
    const z = c.zones.find((q) => q.id === FIXTURE_ZONE_ID);
    if (z === undefined) throw new Error('no fixture zone');
    z.bands = [{ from: 0, to: 900, rate: 0, maxAlive: 0, spawns: [{ enemy: 'wolf', weight: 1 }], elites: { every, pool: ['alpha_wolf'] } }];
    z.bosses = [];
    z.metins = { types: ['metin_lament'], firstAt: 1e6, interval: [1e6, 1e6] };
  };
}

/** the ordinary elites (tier 1, spawner source 5) that stand up during the next `seconds` of sim time */
function eliteSpawns(w: World, seconds: number): number {
  let n = 0;
  for (let i = 0; i < Math.ceil(seconds / DT); i++) {
    w.step([NO_INPUT]);
    for (const e of w.events) if (e.t === 'enemySpawn' && e.tier === 1 && e.source === 5) n++;
  }
  return n;
}

describe('Golden Hour: the window', () => {
  it('is a registered kind of the shipped event content: 45 s, elites x0.5, yeop x2, and the schedule keeps the whole 45 s clear of the bosses', () => {
    expect(runEventKindDef(GOLD)).toBeDefined();
    expect(GOLD_CFG).toEqual({ duration: 45, eliteEveryMul: 0.5, yeopMul: 2 });
    const w = goldWorld();
    const def = runEventKindDef(GOLD) as RunEventKindDef;
    expect(def.duration(w, ev(w))).toBe(45);
    expect(def.span?.(w)).toBe(45);
  });

  it('sets eliteEvery x0.5 and yeop x2 the tick the active phase starts and clears them the tick it ends: 45 s of sim time, not a tick more', () => {
    const w = goldWorld({ config: { seed: 3 } });
    const s = ev(w);
    expect(w.mods.yeop).toBe(1);
    expect(w.mods.eliteEvery).toBe(1);
    const trace = goldTrace(w);
    expect(trace.at(-1)?.stage).toBe('done');
    // the factors are on exactly while the event is active
    for (const t of trace) {
      expect(t.hot, `t=${t.time} ${t.stage}`).toBe(t.stage === 'active');
      expect(t.yeop).toBe(t.hot ? 2 : 1);
      expect(t.eliteEvery).toBe(t.hot ? 0.5 : 1);
    }
    const hot = trace.filter((t) => t.hot);
    expect(hot.length * DT).toBeGreaterThan(45 - 2 * DT);
    expect(hot.length * DT).toBeLessThan(45 + 2 * DT);
    expect((hot[0] as GoldTick).time).toBeGreaterThanOrEqual(s.startAt - 1e-9);
    expect((hot[0] as GoldTick).time).toBeLessThan(s.startAt + 2 * DT);
    expect((hot.at(-1) as GoldTick).time).toBeLessThan(s.startAt + 45);
    // after the window the base values are back for good
    expect(w.mods.yeop).toBe(1);
    expect(w.mods.eliteEvery).toBe(1);
    expect(w.hasEventMods(GOLDEN_HOUR_MODS_ID)).toBe(false);
  });

  it('the factors are the content values (duration 20, eliteEveryMul 0.25, yeopMul 3), not constants of the kind', () => {
    const w = goldWorld({ config: { seed: 5 } }, { duration: 20, eliteEveryMul: 0.25, yeopMul: 3 });
    const trace = goldTrace(w);
    const hot = trace.filter((t) => t.hot);
    expect(hot.length * DT).toBeGreaterThan(20 - 2 * DT);
    expect(hot.length * DT).toBeLessThan(20 + 2 * DT);
    for (const t of hot) {
      expect(t.yeop).toBe(3);
      expect(t.eliteEvery).toBe(0.25);
    }
    expect(w.mods.yeop).toBe(1);
  });

  it('announce -> active -> end on the HUD with the time left (5 s, 45 s counting down, the 3 s linger), and the end event reports success (p = 1)', () => {
    const w = goldWorld({ config: { seed: 4 } });
    const s = ev(w);
    jumpTo(w, s.announceAt - 0.5);
    expect(w.hud().runEvent).toBeUndefined();
    const log: RunEventSim[] = [];
    const sample = (until: number): void => {
      while (w.time < until) {
        w.step([NO_INPUT]);
        for (const e of w.events) if (e.t === 'runEvent') log.push({ ...e });
      }
    };
    sample(s.announceAt + 0.2);
    expect(w.hud().runEvent).toMatchObject({ kind: GOLD, phase: 'announce' });
    expect(w.hud().runEvent?.left).toBeGreaterThan(4.6);
    expect(w.hud().runEvent?.left).toBeLessThanOrEqual(RUN_EVENT_ANNOUNCE);
    expect(w.hasEventMods(GOLDEN_HOUR_MODS_ID)).toBe(false);
    sample(s.startAt + 0.1);
    expect(w.hud().runEvent).toMatchObject({ kind: GOLD, phase: 'active' });
    expect(w.hud().runEvent?.left).toBeCloseTo(45 - 0.1, 0);
    sample(s.startAt + 20);
    expect(w.hud().runEvent?.left).toBeCloseTo(25, 0);
    expect(w.hasEventMods(GOLDEN_HOUR_MODS_ID)).toBe(true);
    sample(s.startAt + 45 + 0.1);
    expect(w.hud().runEvent).toMatchObject({ kind: GOLD, phase: 'end' });
    expect(w.hud().runEvent?.left).toBeLessThanOrEqual(RUN_EVENT_LINGER);
    expect(w.hasEventMods(GOLDEN_HOUR_MODS_ID)).toBe(false);
    sample(s.startAt + 45 + RUN_EVENT_LINGER + 2.5);
    expect(w.hud().runEvent).toBeUndefined();
    // the events a guest mirrors: announce, the heartbeats of the active phase (same absolute times), one end with p = 1
    const kinds = phases(log);
    expect(kinds[0]).toBe('announce');
    expect(kinds.at(-1)).toBe('end');
    expect(kinds.filter((p) => p === 'end')).toHaveLength(1);
    expect(kinds.filter((p) => p === 'active').length).toBeGreaterThanOrEqual(8);
    for (const e of log) {
      expect(e.kind).toBe(GOLD);
      expect(e.startAt).toBe(s.startAt);
    }
    const end = log.at(-1) as RunEventSim;
    expect(end.p).toBe(1);
    expect(end.endAt).toBeCloseTo(s.startAt + 45, 1);
    expect(s.failed).toBe(false);
  });

  it('costs no random number of its own: the window draws nothing from any stream', () => {
    const w = goldWorld({ config: { seed: 8 } });
    const counts: Record<string, number> = {};
    for (const [name, rng] of Object.entries(w.rng) as [string, { next: () => number }][]) {
      const next = rng.next.bind(rng);
      counts[name] = 0;
      rng.next = (): number => {
        counts[name] = (counts[name] as number) + 1;
        return next();
      };
    }
    const trace = goldTrace(w);
    expect(trace.at(-1)?.stage).toBe('done');
    expect(trace.some((t) => t.hot)).toBe(true);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe('Golden Hour: the window ends with the run, the hero or a pause', () => {
  it('the last hero falls inside the window: the factors are cleared at once, the window closes early and still counts as no failure', () => {
    const w = goldWorld({ config: { seed: 6 } });
    const s = ev(w);
    jumpTo(w, s.startAt - 0.1);
    stepUntil(w, () => s.stage === 'active', 3);
    stepUntil(w, () => w.time >= s.startAt + 15, 30);
    expect(w.hasEventMods(GOLDEN_HOUR_MODS_ID)).toBe(true);
    expect(w.mods.yeop).toBe(2);
    player(w).alive = false;
    const log = stepUntil(w, () => s.stage === 'end', 3);
    expect(w.hasEventMods(GOLDEN_HOUR_MODS_ID)).toBe(false);
    expect(w.mods.yeop).toBe(1);
    expect(w.mods.eliteEvery).toBe(1);
    expect(s.endAt).toBeLessThan(s.startAt + 20);
    expect(phases(log).at(-1)).toBe('end');
    expect((log.at(-1) as RunEventSim).p).toBe(1);
    // the run then runs out; nothing re-arms the factors
    stepUntil(w, () => w.over, 10);
    expect(w.over).toBe(true);
    expect(w.mods.yeop).toBe(1);
    expect(w.hasEventMods(GOLDEN_HOUR_MODS_ID)).toBe(false);
  });

  it('the run is won inside the window (the final boss falls): the factors are cleared before the run is over', () => {
    const w = goldWorld({ config: { seed: 6 } });
    const s = ev(w);
    jumpTo(w, s.startAt - 0.1);
    stepUntil(w, () => s.stage === 'active', 3);
    stepUntil(w, () => w.time >= s.startAt + 10, 30);
    expect(w.mods.eliteEvery).toBe(0.5);
    beginVictory(w);
    stepUntil(w, () => s.stage === 'end', 3);
    expect(w.mods.eliteEvery).toBe(1);
    expect(w.mods.yeop).toBe(1);
    expect(w.over).toBe(false);
    expect(s.endAt).toBeLessThan(s.startAt + 15);
  });

  it('the run ends during the announcement: the factors were never set, and the event counts as failed', () => {
    const w = goldWorld({ config: { seed: 6 } });
    const s = ev(w);
    jumpTo(w, s.announceAt - 0.1);
    stepUntil(w, () => s.stage === 'announce', 3);
    w.endTimer = 1;
    const trace: boolean[] = [];
    for (let i = 0; i < 30 && s.stage !== 'end'; i++) {
      w.step([NO_INPUT]);
      trace.push(w.hasEventMods(GOLDEN_HOUR_MODS_ID));
    }
    expect(s.stage).toBe('end');
    expect(s.failed).toBe(true);
    expect(trace.some(Boolean)).toBe(false);
    expect(w.mods.yeop).toBe(1);
  });

  it('a modal pause (a level-up, a chest) freezes the window with the clock: the factors stay on, and the full 45 s are played afterwards', () => {
    const w = goldWorld({ config: { seed: 9 } });
    const s = ev(w);
    jumpTo(w, s.startAt - 0.1);
    stepUntil(w, () => s.stage === 'active', 3);
    stepUntil(w, () => w.time >= s.startAt + 10, 30);
    const left = w.hud().runEvent?.left as number;
    openLevelUp(w, player(w), 2);
    expect(w.modal).not.toBeNull();
    const frozen = w.time;
    for (let i = 0; i < 1200; i++) w.step([NO_INPUT]);
    expect(w.time).toBe(frozen);
    expect(s.stage).toBe('active');
    expect(w.mods.yeop).toBe(2);
    expect(w.hud().runEvent?.left).toBeCloseTo(left, 6);
    drainModals(w);
    // the window ends 45 s of sim time after it began, whatever the modal took in wall time
    stepUntil(w, () => s.stage === 'end', 60);
    expect(s.endAt).toBeCloseTo(s.startAt + 45, 1);
    expect(w.hasEventMods(GOLDEN_HOUR_MODS_ID)).toBe(false);
  });

  it('co-op: a fallen hero does not close the window (the party goes on), a revived one finds it still running, and the last one falling clears it', () => {
    const w = goldWorld({ config: { seed: 10, coop: [MEMBER] } });
    const s = ev(w);
    jumpTo(w, s.startAt - 0.1);
    stepUntil(w, () => s.stage === 'active', 3);
    stepUntil(w, () => w.time >= s.startAt + 10, 30);
    player(w, 1).alive = false;
    stepUntil(w, () => w.time >= s.startAt + 20, 30);
    expect(s.stage).toBe('active');
    expect(w.mods.yeop).toBe(2);
    expect(w.mods.eliteEvery).toBe(0.5);
    player(w, 1).alive = true;
    stepUntil(w, () => w.time >= s.startAt + 30, 30);
    expect(s.stage).toBe('active');
    expect(w.mods.yeop).toBe(2);
    expect(w.hud(1).runEvent).toMatchObject({ kind: GOLD, phase: 'active' });
    expect(w.hud(1).runEvent?.left).toBeCloseTo(w.hud(0).runEvent?.left as number, 6);
    player(w, 0).alive = false;
    player(w, 1).alive = false;
    stepUntil(w, () => s.stage === 'end', 3);
    expect(w.hasEventMods(GOLDEN_HOUR_MODS_ID)).toBe(false);
    expect(w.mods.yeop).toBe(1);
  });

  it('hard difficulty and Run Options: the window multiplies the run base (hard muls, zone) and gives exactly that base back', () => {
    // the hard arm carries a hard elite interval of x0.8 (balance.hard.eliteEveryMul), so the base is not 1 and the stacking is visible
    const arms = [
      { config: { difficulty: 'hard' as const, seed: 12 }, content: (c: ContentDB): void => void ((c.balance.hard as { eliteEveryMul?: number }).eliteEveryMul = 0.8) },
      { config: { runOptions: { density: 3, health: 3, damage: 3, speed: 3 }, seed: 13 }, content: undefined },
    ];
    for (const arm of arms) {
      const w = goldWorld(arm.content ? { config: arm.config, content: arm.content } : { config: arm.config });
      const base = { ...w.mods };
      if (arm.content) expect(base.eliteEvery).toBeCloseTo(0.8, 12);
      const trace = goldTrace(w);
      const hot = trace.filter((t) => t.hot);
      expect(hot.length * DT).toBeGreaterThan(45 - 2 * DT);
      for (const t of hot) {
        expect(t.eliteEvery).toBeCloseTo(base.eliteEvery * 0.5, 12);
        expect(t.yeop).toBeCloseTo(base.yeop * 2, 12);
      }
      expect({ ...w.mods }).toEqual(base);
    }
  });

  it("stacks with another event's factors (the Bargain's curse later) and removes only its own", () => {
    const w = goldWorld({ config: { seed: 14 } });
    const s = ev(w);
    w.setEventMods('other', { eliteEvery: 0.8, yeop: 1.25 });
    jumpTo(w, s.startAt - 0.1);
    stepUntil(w, () => s.stage === 'active', 3);
    expect(w.mods.eliteEvery).toBeCloseTo(0.4, 12);
    expect(w.mods.yeop).toBeCloseTo(2.5, 12);
    stepUntil(w, () => s.stage === 'end', 60);
    expect(w.mods.eliteEvery).toBeCloseTo(0.8, 12);
    expect(w.mods.yeop).toBeCloseTo(1.25, 12);
    expect(w.hasEventMods('other')).toBe(true);
  });
});

describe('Golden Hour: what the player gets', () => {
  it('twice the yeop from a creature killed inside the window, the usual amount before and after it (same seed, same kill)', () => {
    /** the yeop a tier-1 elite drops when it is killed in the given phase of the event */
    const dropAt = (phase: 'before' | 'inside' | 'after'): number => {
      const w = goldWorld({ config: { seed: 21 } });
      const s = ev(w);
      jumpTo(w, s.announceAt - 0.1);
      if (phase !== 'before') stepUntil(w, () => s.stage === 'active', 12);
      if (phase === 'after') stepUntil(w, () => s.stage === 'end', 60);
      const c = newHitCtx();
      c.noCrit = true;
      const row = spawn(w, 'alpha_wolf', 3, 0, { tier: 1 });
      hitEnemy(w, row, 1e15, c);
      w.step([NO_INPUT]);
      let sum = 0;
      let n = 0;
      for (let i = 0; i < w.pickups.count; i++) {
        if (w.pickups.kind[i] === PickupKind.Yeop) {
          sum += w.pickups.value[i] as number;
          n++;
        }
      }
      expect(n, phase).toBe(1);
      return sum;
    };
    const before = dropAt('before');
    const inside = dropAt('inside');
    const after = dropAt('after');
    expect(before).toBeGreaterThanOrEqual(12);
    expect(after).toBe(before);
    expect(Math.abs(inside - 2 * before)).toBeLessThanOrEqual(1);
    expect(inside).toBeGreaterThan(before);
  });

  it("more elites inside the window: the interval between the spawner's elites halves for 45 s and is back to normal afterwards", () => {
    const control = makeWorld({ config: { seed: 31 }, content: eliteBand(20) });
    control.spawner.eliteT = 20;
    const baseline = eliteSpawns(control, 45);
    expect(baseline).toBe(2);

    const w = goldWorld({ config: { seed: 31 }, content: eliteBand(20) });
    const s = ev(w);
    jumpTo(w, s.startAt - 0.1);
    stepUntil(w, () => s.stage === 'active', 3);
    // the countdown to the next elite already running takes the new pace at once
    w.spawner.eliteT = 20;
    const inside = eliteSpawns(w, 44.5);
    expect(s.stage).toBe('active');
    expect(inside).toBeGreaterThanOrEqual(4);
    expect(inside).toBeGreaterThanOrEqual(2 * baseline);
    stepUntil(w, () => s.stage === 'end', 5);
    w.spawner.eliteT = 20;
    expect(eliteSpawns(w, 45)).toBe(2);
  });

  it("stays inside the spawner's caps: no elite while the field is full (the same limit as without the window)", () => {
    const w = goldWorld({ config: { seed: 32 }, content: eliteBand(5) });
    const s = ev(w);
    jumpTo(w, s.startAt - 0.1);
    stepUntil(w, () => s.stage === 'active', 3);
    w.spawner.eliteT = 1;
    w.spawner.alive = ENEMY_SOFT_CAP + 20;
    expect(eliteSpawns(w, 20)).toBe(0);
    // the field thins out: the elites come again at the window's pace
    w.spawner.alive = 0;
    expect(eliteSpawns(w, 20)).toBeGreaterThanOrEqual(3);
  });
});

describe('Golden Hour: the schedule and the real content', () => {
  const ZONES = ['yeonmu', 'suryeon', 'seori', 'daeryeol'];

  it('every zone schedules it inside the event window with all of announce .. start + 45 s at least bossGap from every boss spawn, over many seeds', () => {
    for (const zoneId of ZONES) {
      for (let seed = 1; seed <= 24; seed++) {
        const db = structuredClone(realContent);
        (db.runEvents as RunEventsDef).zones = { [zoneId]: [GOLD as unknown as RunEventKind] };
        const w = createWorld({ zone: zoneId, difficulty: 'normal', classId: 'warrior', doctrine: 'a', sex: 'm', empire: 'saehwa', seed, meta: { stats: {} } }, db);
        const s = w.runEvent as RunEventRun;
        expect(s.kind, zoneId).toBe(GOLD);
        expect(s.startAt).toBeGreaterThanOrEqual(380);
        expect(s.startAt).toBeLessThanOrEqual(620);
        const gap = (db.runEvents as RunEventsDef).bossGap;
        for (const b of [...w.zone.bosses.map((q) => q.at), w.zone.final.at]) {
          const clear = b + gap <= s.announceAt || b - gap >= s.startAt + 45;
          expect(clear, `${zoneId} s${seed}: boss at ${b}, window ${s.announceAt.toFixed(1)}..${(s.startAt + 45).toFixed(1)}`).toBe(true);
        }
      }
    }
  });

  it('every zone has elites for the whole window range (the extra elites come from the band pool of the moment)', () => {
    for (const zoneId of ZONES) {
      const db = structuredClone(realContent);
      (db.runEvents as RunEventsDef).zones = { [zoneId]: [GOLD as unknown as RunEventKind] };
      const w = createWorld({ zone: zoneId, difficulty: 'normal', classId: 'warrior', doctrine: 'a', sex: 'm', empire: 'saehwa', seed: 5, meta: { stats: {} } }, db);
      for (const t of [380, 450, 500, 540, 600, 665]) expect(bandElitePool(w, t).length, `${zoneId} ${t}`).toBeGreaterThan(0);
    }
  });

  it('shipped content lists no zone: the kind being registered changes nothing (no event, no factor, no draw)', () => {
    for (const zoneId of ZONES) {
      const w = createWorld({ zone: zoneId, difficulty: 'normal', classId: 'warrior', doctrine: 'a', sex: 'm', empire: 'saehwa', seed: 5, meta: { stats: {} } }, realContent);
      expect(w.runEvent, zoneId).toBeNull();
      expect(w.hasEventMods(GOLDEN_HOUR_MODS_ID)).toBe(false);
    }
  });
});

describe('Golden Hour: plausibility envelope', () => {
  // The leaderboard's soft limits (workers/api/src/plausibility.ts, hard x 0.7): yeop per kill yeonmu 42 / suryeon 84 / seori 154 /
  // daeryeol 280, kills per minute 2,030 on normal. A god-stat hero (the calibration's) on the real zones, the window forced: the window's
  // own numbers (kills per minute and yeop per kill between its first and last tick) stay inside them, and the yeop per kill is clearly
  // higher than in the same stretch of a run without the window.
  const ZONES = ['yeonmu', 'suryeon', 'seori', 'daeryeol'];
  const SOFT_YEOP_PER_KILL: Record<string, number> = { yeonmu: 42, suryeon: 84, seori: 154, daeryeol: 280 };
  const SOFT_KILLS_PER_MIN = 2030;

  /** kills and yeop earned (all heroes) between the first and the last tick of the window (or the same span of a run without it) */
  function windowNumbers(zoneId: string, seed: number, golden: boolean): { kills: number; yeop: number; seconds: number } {
    const db = structuredClone(realContent);
    (db.runEvents as RunEventsDef).zones = golden ? { [zoneId]: [GOLD as unknown as RunEventKind] } : {};
    const w = createWorld({ zone: zoneId, difficulty: 'normal', classId: 'warrior', doctrine: 'a', sex: 'm', empire: 'saehwa', seed, meta: { stats: GOLD_GOD } }, db);
    const startAt = golden ? (w.runEvent as RunEventRun).startAt : 420;
    const yeopOf = (): number => w.players.reduce((a, p) => a + p.yeopEarned, 0);
    let k0 = 0;
    let y0 = 0;
    let t0 = -1;
    let k1 = 0;
    let y1 = 0;
    let t1 = 0;
    while (w.time < startAt + 46 && !w.over) {
      drainModals(w);
      w.step([botInput(w, w.tick)]);
      if (t0 < 0 && w.time >= startAt) {
        t0 = w.time;
        k0 = w.tally.kills;
        y0 = yeopOf();
      }
      if (t0 >= 0 && w.time <= startAt + 45) {
        t1 = w.time;
        k1 = w.tally.kills;
        y1 = yeopOf();
      }
    }
    return { kills: k1 - k0, yeop: y1 - y0, seconds: t1 - t0 };
  }

  for (const zoneId of ZONES) {
    it(`${zoneId}: inside the window kills per minute and yeop per kill stay under the soft limits, and yeop per kill is higher than in a run without it`, () => {
      let onYeop = 0;
      let onKills = 0;
      let offYeop = 0;
      let offKills = 0;
      for (const seed of [7, 11]) {
        const on = windowNumbers(zoneId, seed, true);
        const off = windowNumbers(zoneId, seed, false);
        expect(on.seconds, `${zoneId} s${seed}`).toBeGreaterThan(44);
        expect((on.kills / on.seconds) * 60, `${zoneId} s${seed}: kills per minute`).toBeLessThan(SOFT_KILLS_PER_MIN);
        onYeop += on.yeop;
        onKills += on.kills;
        offYeop += off.yeop;
        offKills += off.kills;
      }
      expect(onKills).toBeGreaterThan(0);
      expect(offKills).toBeGreaterThan(0);
      const perKillOn = onYeop / onKills;
      const perKillOff = offYeop / offKills;
      expect(perKillOn, `${zoneId}: yeop per kill inside the window`).toBeLessThan(SOFT_YEOP_PER_KILL[zoneId] as number);
      expect(perKillOn, `${zoneId}: on ${perKillOn.toFixed(2)} vs off ${perKillOff.toFixed(2)}`).toBeGreaterThan(perKillOff * 1.3);
    }, 120_000);
  }
});

describe('Golden Hour: a co-op guest (host + guest + late join)', () => {
  let t: CoopHarness | null = null;
  afterEach(() => {
    t?.dispose();
    t = null;
  });

  /** the fixture zone with the window inside 20-24 s, nothing else spawning, elites out of the picture */
  const goldContent = (c: ContentDB): void => {
    c.runEvents = { ...structuredClone(DEFAULT_RUN_EVENTS), window: [20, 24], bossGap: 0, zones: { [FIXTURE_ZONE_ID]: [GOLD as unknown as RunEventKind] } };
    const z = c.zones.find((q) => q.id === FIXTURE_ZONE_ID);
    if (z === undefined) throw new Error('no fixture zone');
    z.bands = [{ from: 0, to: 900, rate: 0, maxAlive: 0, spawns: [{ enemy: 'wolf', weight: 1 }], elites: { every: 1e9, pool: ['alpha_wolf'] } }];
    z.bosses = [];
    z.metins = { types: ['metin_lament'], firstAt: 1e6, interval: [1e6, 1e6] };
  };

  async function party(): Promise<{ h: CoopHarness; guestEvents: RunEventSim[]; tick: (n?: number) => void; until: (pred: () => boolean, limit?: number) => number }> {
    const h = await CoopHarness.create({ guests: 1, latencyMs: 30, tough: true, content: goldContent });
    t = h;
    const guestEvents: RunEventSim[] = [];
    const tick = (n = 1): void => {
      for (let i = 0; i < n; i++) {
        h.tick();
        for (const p of h.hostWorld.players) p.hp = p.hpMax;
        if (h.hostWorld.modal !== null) h.hostWorld.chooseCard(0);
        const gw = h.guestWorlds[0] as World;
        if (gw.modal !== null) gw.chooseCard(0);
        for (const e of gw.events) if (e.t === 'runEvent') guestEvents.push({ ...e });
      }
    };
    const until = (pred: () => boolean, limit = 60): number => {
      let n = 0;
      while (!pred() && n < limit * 60) {
        tick();
        n++;
      }
      return n;
    };
    return { h, guestEvents, tick, until };
  }

  const yeopRows = (w: World): number[] => Array.from({ length: w.pickups.count }, (_, i) => i).filter((i) => w.pickups.kind[i] === PickupKind.Yeop);
  const yeopValues = (w: World): number[] => yeopRows(w).map((i) => Math.round(w.pickups.value[i] as number));
  /** a guest mirror keeps the kind and the coin tier of a pickup, not its amount (the host credits it) */
  const yeopTiers = (w: World): number[] => yeopRows(w).map((i) => w.pickups.tier[i] as number);

  it("the guest sees the announce, the window on its HUD with the host's timer, the end with p = 1; the doubled yeop pickups of the host are the ones it sees", async () => {
    const n = await party();
    const hw = n.h.hostWorld;
    const gw = n.h.guestWorlds[0] as World;
    const s = ev(hw);
    expect(s.kind).toBe(GOLD);
    n.until(() => s.stage === 'announce', 40);
    n.until(() => gw.hud(0).runEvent !== undefined, 5);
    expect(gw.hud(0).runEvent).toMatchObject({ kind: GOLD, phase: 'announce' });
    n.until(() => s.stage === 'active', 10);
    n.until(() => gw.hud(0).runEvent?.phase === 'active', 6);
    expect(gw.hud(0).runEvent?.left).toBeCloseTo(s.endAt - gw.time, 0);
    expect(hw.mods.yeop).toBe(2);
    // an elite falls on the host inside the window: its yeop is doubled (>= 24 where an ordinary alpha wolf drops 12-25) and the guest mirrors the same coin
    n.tick(120);
    // both heroes are 40 m away, so nobody picks the coin up before the guest has seen it
    for (const p of hw.players) {
      p.x = p.px = 40;
      p.z = p.pz = 40;
    }
    const c = newHitCtx();
    c.noCrit = true;
    const row = spawn(hw, 'alpha_wolf', 3, 0, { tier: 1 });
    hitEnemy(hw, row, 1e15, c);
    n.tick(2);
    const hostYeop = yeopValues(hw);
    expect(hostYeop.length).toBeGreaterThan(0);
    expect(Math.max(...hostYeop)).toBeGreaterThanOrEqual(24);
    const hostTiers = yeopTiers(hw);
    n.until(() => yeopRows(gw).length > 0, 3);
    expect(yeopTiers(gw)).toEqual(hostTiers);
    // the guest world is a mirror: it keeps no run modifiers of its own (nothing to mirror, the host's effects arrive as pickups and enemies)
    expect(gw.mods.yeop).toBe(1);
    n.until(() => n.guestEvents.some((e) => e.phase === 'end'), GOLD_CFG.duration + 5);
    expect(n.guestEvents.filter((e) => e.phase === 'end')).toEqual([expect.objectContaining({ kind: GOLD, p: 1 })]);
    expect(hw.mods.yeop).toBe(1);
    expect(gw.hud(0).runEvent).toMatchObject({ phase: 'end' });
  }, 90_000);

  it('a guest that reconnects (a late join) mid-window shows it again within 5.5 s with the timer of the host', async () => {
    const n = await party();
    const hw = n.h.hostWorld;
    const gw = n.h.guestWorlds[0] as World;
    const s = ev(hw);
    n.until(() => s.stage === 'active', 40);
    n.tick(600);
    expect(gw.hud(0).runEvent).toMatchObject({ kind: GOLD, phase: 'active' });
    await n.h.reconnect(1);
    const spent = n.until(() => gw.hud(0).runEvent?.phase === 'active', 8);
    expect(spent / 60).toBeLessThan(5.5);
    expect(gw.hud(0).runEvent?.left).toBeCloseTo(s.endAt - gw.time, 0);
    expect(hw.mods.yeop).toBe(2);
  }, 90_000);
});

// ---------------------------------------------------------------------------
// The Sky Sovereign's Bargain (EV-02a): the fifth kind. A shrine stands up 10-14 m from the hero (announce 5 s, then 60 s active, or until every
// living hero used it); a hero within radius 2.5 m for 2 s opens a free 'chest' modal with source 'bargain' (skippable, cards of openBargain), once
// per hero; each hero channels for their own modal. The channel is reported as throttled 'channel' runEvents (the framework's setRunEventChannel).

const BARGAIN = 'bargain';
const BARGAIN_CFG = DEFAULT_RUN_EVENTS.kinds.bargain;
/** the active phase starts inside this window: with the WHOLE stretch (announce .. start + 60 s) kept bossGap away from the fixture bosses (180, 480, 900) the start is <= 390 */
const SHRINE_WINDOW: RunEventsDef['window'] = [385, 386];
type BargainCfg = RunEventsDef['kinds']['bargain'];
type CardPickSim = Extract<SimEvent, { t: 'cardPick' }>;

/** a quiet world whose event is the shrine; `cfg` patches its content (radius / channel / offers) */
function shrineWorld(over: Parameters<typeof makeWorld>[0] = {}, cfg: Partial<BargainCfg> = {}): World {
  return quiet(
    [BARGAIN],
    {
      ...over,
      content: (c) => {
        Object.assign((c.runEvents as RunEventsDef).kinds.bargain, cfg);
        over.content?.(c);
      },
    },
    SHRINE_WINDOW,
  );
}

/** run a shrine world to the first tick of its announce (the shrine has its place from that tick) */
function shrineAnnounced(w: World): RunEventRun {
  const s = ev(w);
  jumpTo(w, s.announceAt - 0.1);
  stepUntil(w, () => s.stage === 'announce', 5);
  return s;
}

/** run a shrine world to the first tick of its active phase */
function shrineUp(w: World): RunEventRun {
  const s = ev(w);
  jumpTo(w, s.announceAt - 0.1);
  stepUntil(w, () => s.stage === 'active', 10);
  return s;
}

/** put hero `i` `dx` m east of the shrine (0 = on it) */
function standOn(w: World, i: number, dx = 0): void {
  const s = ev(w);
  const p = player(w, i);
  p.x = p.px = s.x + dx;
  p.z = p.pz = s.z;
}

/** step `n` ticks, appending every runEvent to `got` */
function tickShrine(w: World, n: number, got: RunEventSim[] = []): RunEventSim[] {
  for (let i = 0; i < n; i++) {
    w.step([NO_INPUT]);
    for (const e of w.events) if (e.t === 'runEvent') got.push({ ...e });
  }
  return got;
}

const channelOf = (list: readonly RunEventSim[], hero?: number): RunEventSim[] => list.filter((e) => e.phase === 'channel' && (hero === undefined || e.player === hero));

/** every random stream of the world, as a comparable snapshot */
const streamStates = (w: World): unknown[] => Object.values(w.rng).map((r) => r.getState());

describe('Bargain: the kind and its shrine', () => {
  it('is a registered kind of the shipped event content (radius 2.5 m, channel 2 s, 3 offers), 60 s active, and its schedule keeps announce .. end clear of every boss', () => {
    expect(runEventKindDef(BARGAIN)).toBeDefined();
    expect(BARGAIN_CFG).toEqual({ radius: 2.5, channel: 2, offers: 3 });
    expect(realContent.runEvents?.kinds.bargain).toEqual(BARGAIN_CFG);
    expect(BARGAIN_ACTIVE).toBe(60);
    expect(runEventKindDef(BARGAIN)?.span?.(shrineWorld())).toBe(60);
    for (let seed = 1; seed <= 25; seed++) {
      const s = ev(quiet([BARGAIN], { config: { seed } }, [380, 620]));
      for (const bt of BOSSES) {
        const clear = s.startAt + BARGAIN_ACTIVE <= bt - 30 + 1e-9 || s.announceAt >= bt + 30 - 1e-9;
        expect(clear, `seed ${seed}: shrine ${s.announceAt.toFixed(1)}..${(s.startAt + 60).toFixed(1)} vs boss ${bt}`).toBe(true);
      }
    }
  });

  it('stands 10-14 m from the hero from the announce on, and does not move', () => {
    expect(BARGAIN_RING_MIN).toBe(10);
    expect(BARGAIN_RING_MAX).toBe(14);
    for (let seed = 1; seed <= 30; seed++) {
      const w = shrineWorld({ config: { seed } });
      const s = shrineAnnounced(w);
      const d = Math.hypot(s.x, s.z);
      expect(d, `seed ${seed}`).toBeGreaterThanOrEqual(10 - 1e-6);
      expect(d, `seed ${seed}`).toBeLessThanOrEqual(14 + 1e-6);
      const at = { x: s.x, z: s.z };
      stepUntil(w, () => s.stage === 'end', 70);
      expect({ x: s.x, z: s.z }).toEqual(at);
    }
  });

  it('announce 5 s, active 60 s, end: a shrine nobody used ends with p = 0 and leaves no modal', () => {
    const w = shrineWorld({ config: { seed: 3 } });
    const s = ev(w);
    expect(s.startAt - s.announceAt).toBe(5);
    jumpTo(w, s.announceAt - 0.1);
    const log = stepUntil(w, () => s.stage === 'done', 90);
    const order = phases(log).filter((p, i, a) => p !== a[i - 1]);
    expect(order).toEqual(['announce', 'active', 'end']);
    expect(s.endAt).toBeCloseTo(s.startAt + 60, 1);
    expect(log.at(-1)).toMatchObject({ kind: BARGAIN, phase: 'end', p: 0 });
    expect(s.failed).toBe(true);
    expect(w.modals).toHaveLength(0);
    expect(channelOf(log)).toEqual([]);
  });

  it('the announce is a warning, not an offer: a hero standing on the shrine channels from the START, not before', () => {
    const w = shrineWorld({ config: { seed: 8 } });
    const s = shrineAnnounced(w);
    standOn(w, 0);
    const early = tickShrine(w, Math.floor((s.startAt - w.time) / DT) - 2);
    expect(s.stage).toBe('announce');
    expect(channelOf(early)).toEqual([]);
    expect(w.hud().channel).toBeUndefined();
    stepUntil(w, () => s.stage === 'active', 2);
    // it opens 2 s after the start, not 2 s after the hero arrived
    tickShrine(w, 110);
    expect(w.modals).toHaveLength(0);
    tickShrine(w, 20);
    expect(w.modals).toHaveLength(1);
  });
});

describe('Bargain: walkable ground', () => {
  const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);

  function sites(env: WorldEnv, hero: { x: number; z: number }): { x: number; z: number; w: World }[] {
    return SEEDS.map((seed) => {
      const w = shrineWorld({ config: { seed }, env: { arenaRadius: ARENA, ...env } });
      const p = player(w);
      p.x = p.px = hero.x;
      p.z = p.pz = hero.z;
      const s = shrineAnnounced(w);
      return { x: s.x, z: s.z, w };
    });
  }

  it('a hero on the arena rim: the shrine stands inside the arena, on spawnable ground, within 14 m', () => {
    for (const angle of [0, 1.9, 4.4]) {
      const hero = { x: Math.sin(angle) * (ARENA - 0.6), z: Math.cos(angle) * (ARENA - 0.6) };
      for (const s of sites({}, hero)) {
        expect(Math.hypot(s.x, s.z)).toBeLessThanOrEqual(ARENA - 1.5 + 1e-9);
        expect(spawnable(s.w, s.x, s.z)).toBe(true);
        expect(Math.hypot(s.x - hero.x, s.z - hero.z)).toBeLessThanOrEqual(14 + 1e-6);
      }
    }
  });

  it('next to a deep lake and a lava stream: the shrine never stands in the water or the lava', () => {
    const surfaceAt = (x: number, z: number): number => (x > 0 ? Surface.Deep : z >= 10 && z <= 16 ? Surface.Lava : Surface.Ground);
    for (const hero of [
      { x: -0.5, z: 0 },
      { x: -3, z: 8 },
      { x: -10, z: 12 },
    ]) {
      for (const s of sites({ surfaceAt }, hero)) {
        expect(surfaceAt(s.x, s.z)).toBe(Surface.Ground);
        expect(spawnable(s.w, s.x, s.z)).toBe(true);
      }
    }
  });

  it('inside a blocker cluster only the pocket round the hero is free: the shrine stands in the pocket, within reach of the hero', () => {
    const cluster: WorldEnv = { walkable: (x, z) => Math.hypot(x - 30, z) <= 2.5 || Math.hypot(x - 30, z) > 45 };
    for (const s of sites(cluster, { x: 30, z: 0 })) {
      expect(Math.hypot(s.x - 30, s.z)).toBeLessThanOrEqual(2.5 + 1e-9);
    }
  });

  it('a hero with no walkable ground anywhere: the shrine is put on the hero (never thrown into the lava) and the event still runs and ends', () => {
    const lava: WorldEnv = { surfaceAt: () => Surface.Lava };
    const w = shrineWorld({ config: { seed: 3 }, env: { arenaRadius: ARENA, ...lava } });
    const p = player(w);
    const s = shrineAnnounced(w);
    expect(Math.hypot(s.x - p.x, s.z - p.z)).toBeLessThan(1e-9);
    // (a hero standing in lava may not live to see the end of the event: the run then ends it)
    expect(() => stepUntil(w, () => s.stage === 'end' || s.stage === 'done', 90)).not.toThrow();
    expect(['end', 'done']).toContain(s.stage);
  });

  it('prefers a site the hero can reach: clear of statics and on level ground when the ring offers one, whatever the seed', () => {
    // the east half of the ring is full of props, the west half open
    const props: WorldEnv = { clearOfStatics: (x) => x < 0 };
    for (const s of sites(props, { x: 0, z: 0 })) expect(s.x).toBeLessThan(0);
    // hills on the north side: only the south is level
    const hills: WorldEnv = { levelDisc: (_x, z) => z < 0 };
    for (const s of sites(hills, { x: 0, z: 0 })) expect(s.z).toBeLessThan(0);
  });

  it('a ring with no clear site anywhere still gets its shrine: the first walkable point (an event beside a prop beats no event)', () => {
    const blocked: WorldEnv = { clearOfStatics: () => false, levelDisc: () => false };
    for (const s of sites(blocked, { x: 0, z: 0 })) {
      const d = Math.hypot(s.x, s.z);
      expect(d).toBeGreaterThanOrEqual(10 - 1e-6);
      expect(d).toBeLessThanOrEqual(14 + 1e-6);
      expect(spawnable(s.w, s.x, s.z)).toBe(true);
    }
  });
});

describe('Bargain: the channel', () => {
  it('2 s within 2.5 m opens a free, skippable chest modal with source bargain and the offered cards; not a tick sooner', () => {
    const w = shrineWorld({ config: { seed: 5 } });
    const s = shrineUp(w);
    standOn(w, 0, 2.4);
    tickShrine(w, 119);
    expect(w.modals).toHaveLength(0);
    expect(w.hud().channel).toBeGreaterThan(0.98);
    expect(s.stage).toBe('active');
    tickShrine(w, 1);
    expect(w.modals).toHaveLength(1);
    const m = w.modals[0] as NonNullable<World['modal']>;
    expect(m).toMatchObject({ kind: 'chest', player: 0, source: BARGAIN_SOURCE, free: true, canSkip: true, canReroll: false, canBanish: false, rerolls: 0, banishes: 0, skips: 1, awakened: false });
    expect(BARGAIN_SOURCE).toBe('bargain');
    expect(m.cards).toHaveLength(BARGAIN_CFG.offers);
    for (const c of m.cards) {
      expect(c.kind).toBe('bargain');
      expect(typeof c.bargain?.boon).toBe('string');
      expect(typeof c.bargain?.curse).toBe('string');
    }
    expect(new Set(m.cards.map((c) => c.id)).size).toBe(m.cards.length);
    expect(runEventBargainUsed(w, 0)).toBe(true);
  });

  it('the number of offered cards follows runEvents.kinds.bargain.offers (the table has three bargains: the content range 1..4 is capped there)', () => {
    for (const offers of [1, 2, 4]) {
      const w = shrineWorld({ config: { seed: 5 } }, { offers });
      shrineUp(w);
      standOn(w, 0);
      tickShrine(w, 125);
      expect(w.modals[0]?.cards, `offers ${offers}`).toHaveLength(Math.min(offers, BARGAIN_IDS.length));
    }
  });

  it('the radius and the channel time are the content numbers', () => {
    const w = shrineWorld({ config: { seed: 5 } }, { radius: 4, channel: 1 });
    shrineUp(w);
    standOn(w, 0, 3.9);
    tickShrine(w, 59);
    expect(w.modals).toHaveLength(0);
    tickShrine(w, 1);
    expect(w.modals).toHaveLength(1);
  });

  it('outside the radius nothing happens: 2.6 m away for the whole 60 s, no modal, no channel event', () => {
    const w = shrineWorld({ config: { seed: 5 } });
    const s = shrineUp(w);
    standOn(w, 0, 2.6);
    const log = stepUntil(w, () => s.stage === 'end', 70);
    expect(w.modals).toHaveLength(0);
    expect(channelOf(log)).toEqual([]);
    expect(runEventBargainUsed(w, 0)).toBe(false);
  });

  it('emits at most 4 channel events a second, then p = 1 once and the reset p = 0; the host HUD shows the progress while it runs', () => {
    const w = shrineWorld({ config: { seed: 5 } });
    shrineUp(w);
    standOn(w, 0);
    const got: RunEventSim[] = [];
    tickShrine(w, 60, got);
    expect(w.hud().channel).toBeCloseTo(0.5, 2);
    tickShrine(w, 60, got);
    const ch = channelOf(got, 0);
    // 2 s at 4 Hz is 8 progress events, plus the completion (p = 1) and the reset (p = 0) the same tick
    expect(ch.length).toBeGreaterThanOrEqual(8);
    expect(ch.length).toBeLessThanOrEqual(2 * RUN_EVENT_CHANNEL_HZ + 3);
    expect(ch.filter((e) => e.p >= 1)).toHaveLength(1);
    expect(ch.at(-1)).toMatchObject({ player: 0, p: 0 });
    const rise = ch.slice(0, -1).map((e) => e.p);
    for (let i = 1; i < rise.length; i++) expect(rise[i] as number).toBeGreaterThanOrEqual(rise[i - 1] as number);
    // the modal is open and the HUD has no stale bar
    expect(w.modals).toHaveLength(1);
    expect(w.hud().channel).toBeUndefined();
  });

  it('leaving resets it: 1.5 s in, one step out (a single p = 0), and the next stay needs the full 2 s again', () => {
    const w = shrineWorld({ config: { seed: 5 } });
    shrineUp(w);
    standOn(w, 0);
    const got: RunEventSim[] = [];
    tickShrine(w, 90, got);
    expect(w.hud().channel).toBeCloseTo(0.75, 2);
    standOn(w, 0, 6);
    tickShrine(w, 1, got);
    expect(w.hud().channel).toBeUndefined();
    const left = channelOf(got, 0).filter((e) => e.p === 0);
    expect(left).toHaveLength(1);
    tickShrine(w, 30, got);
    expect(channelOf(got, 0).filter((e) => e.p === 0)).toHaveLength(1);
    standOn(w, 0);
    tickShrine(w, 119, got);
    expect(w.modals).toHaveLength(0);
    tickShrine(w, 1, got);
    expect(w.modals).toHaveLength(1);
  });

  it('is paused while a modal is open (the sim stands still) and goes on from where it was after the answer', () => {
    const w = shrineWorld({ config: { seed: 5 } });
    shrineUp(w);
    standOn(w, 0);
    tickShrine(w, 60);
    const half = w.hud().channel as number;
    expect(half).toBeCloseTo(0.5, 2);
    openLevelUp(w, player(w), 2);
    const frozen = w.time;
    tickShrine(w, 600);
    expect(w.time).toBe(frozen);
    expect(w.hud().channel).toBe(half);
    // the pending level-up is NOT the bargain modal
    expect(w.modals.map((m) => m.source)).toEqual(['']);
    drainModals(w);
    tickShrine(w, 59);
    expect(w.modals).toHaveLength(0);
    tickShrine(w, 1);
    expect(w.modals.map((m) => m.source)).toEqual([BARGAIN_SOURCE]);
  });

  it('a modal that opened earlier in the very same tick (a level-up from a pickup) holds the channel for that tick too', () => {
    const w = shrineWorld({ config: { seed: 5 } });
    const s = shrineUp(w);
    standOn(w, 0);
    tickShrine(w, 30);
    const before = w.hud().channel as number;
    openLevelUp(w, player(w), 2);
    // the kind's own hook, as the framework would call it inside a step that has a modal pending
    (runEventKindDef(BARGAIN) as RunEventKindDef).onTick?.(w, s);
    expect(w.hud().channel).toBe(before);
    drainModals(w);
    (runEventKindDef(BARGAIN) as RunEventKindDef).onTick?.(w, s);
    expect(w.hud().channel as number).toBeGreaterThan(before);
  });

  it('a hero who falls mid-channel loses it (a p = 0, no modal even when the body stays); a revived hero starts again from nothing', () => {
    const w = shrineWorld({ config: { seed: 5, coop: [MEMBER] } });
    shrineUp(w);
    standOn(w, 1);
    standOn(w, 0, 8);
    const got: RunEventSim[] = [];
    tickShrine(w, 60, got);
    expect(w.hud(1).channel).toBeCloseTo(0.5, 2);
    player(w, 1).alive = false;
    tickShrine(w, 1, got);
    expect(w.hud(1).channel).toBeUndefined();
    expect(channelOf(got, 1).at(-1)).toMatchObject({ player: 1, p: 0 });
    tickShrine(w, 300, got);
    expect(w.modals).toHaveLength(0);
    expect(w.runEvent?.stage).toBe('active');
    player(w, 1).alive = true;
    tickShrine(w, 119, got);
    expect(w.modals).toHaveLength(0);
    tickShrine(w, 1, got);
    expect(w.modals.map((m) => m.player)).toEqual([1]);
  });

  it('the run ending cancels it: the last hero falls at 0.5, a p = 0 goes out before the end, no modal ever opens', () => {
    const w = shrineWorld({ config: { seed: 5 } });
    const s = shrineUp(w);
    standOn(w, 0);
    tickShrine(w, 60);
    expect(w.hud().channel).toBeCloseTo(0.5, 2);
    player(w).alive = false;
    const log = stepUntil(w, () => s.stage === 'end', 5);
    expect(channelOf(log, 0).at(-1)).toMatchObject({ player: 0, p: 0 });
    expect(phases(log).at(-1)).toBe('end');
    expect(s.failed).toBe(true);
    expect(w.hud().channel).toBeUndefined();
    tickShrine(w, 200);
    expect(w.modals.filter((m) => m.kind === 'chest')).toHaveLength(0);
  });

  it('a run that ends the tick before the channel would complete opens nothing (the final boss falls / endTimer)', () => {
    const w = shrineWorld({ config: { seed: 5 } });
    const s = shrineUp(w);
    standOn(w, 0);
    tickShrine(w, 118);
    w.endTimer = 1;
    tickShrine(w, 5);
    expect(s.stage).toBe('end');
    expect(w.modals.filter((m) => m.source === BARGAIN_SOURCE)).toHaveLength(0);
  });

  it('draws no random number once the shrine stands: the channel, the offer and the answer spend none', () => {
    const w = shrineWorld({ config: { seed: 6 } });
    shrineUp(w);
    const before = streamStates(w);
    standOn(w, 0);
    tickShrine(w, 125);
    expect(w.modals).toHaveLength(1);
    expect(streamStates(w)).toEqual(before);
    w.skip();
    tickShrine(w, 60);
    expect(streamStates(w)).toEqual(before);
  });
});

describe('Bargain: the modal', () => {
  /** a world with the shrine claimed by the hero: the bargain modal is open */
  function claimed(over: Parameters<typeof makeWorld>[0] = {}): World {
    const w = shrineWorld({ config: { seed: 5 }, ...over });
    shrineUp(w);
    standOn(w, 0);
    tickShrine(w, 121);
    expect(w.modals).toHaveLength(1);
    return w;
  }

  it('once per hero: standing on the spent shrine opens nothing more, and the shrine closes the event (p = 1) once the only hero used it', () => {
    const w = claimed();
    const s = ev(w);
    const id = w.nextModalId;
    expect(s.stage).toBe('end');
    expect(s.failed).toBe(false);
    drainModals(w);
    const log = tickShrine(w, 600);
    expect(w.nextModalId).toBe(id);
    expect(w.modals).toHaveLength(0);
    expect(channelOf(log)).toEqual([]);
    expect(runEventBargainUsed(w, 0)).toBe(true);
  });

  it('skip closes it and is free: no skip budget spent (also with none left), no card applied, nothing but the modal changes', () => {
    const w = claimed();
    const p = player(w);
    p.skips = 0;
    const hero = { hp: p.hp, yeop: p.yeop, shards: p.shards, rerolls: p.rerolls, banishes: p.banishes, level: p.level, skills: p.skills.length };
    expect(w.reroll()).toBe(false);
    expect(w.banish(0)).toBe(false);
    expect(w.modals).toHaveLength(1);
    const log: CardPickSim[] = [];
    expect(w.skip()).toBe(true);
    expect(w.modals).toHaveLength(0);
    for (let i = 0; i < 30; i++) {
      w.step([NO_INPUT]);
      for (const e of w.events) if (e.t === 'cardPick') log.push({ ...e });
    }
    expect(log).toEqual([]);
    expect({ hp: p.hp, yeop: p.yeop, shards: p.shards, rerolls: p.rerolls, banishes: p.banishes, level: p.level, skills: p.skills.length }).toEqual(hero);
    expect(p.skips).toBe(0);
    expect(w.skip()).toBe(false);
  });

  it("skip leaves the hero's own skip budget as it was", () => {
    const w = claimed();
    const p = player(w);
    p.skips = 2;
    expect(w.skip()).toBe(true);
    expect(p.skips).toBe(2);
  });

  it('a card pick closes it too and reports the pick; the first card (fury) is applied once: +25 % damage now, the monsters 15 % faster, nothing else changes', () => {
    const w = claimed();
    const p = player(w);
    refreshStats(p, w.content, w.ix);
    const hero = { hp: p.hp, hpMax: p.hpMax, yeop: p.yeop, level: p.level, skills: p.skills.length, damage: p.stats.damage };
    const wolf = spawn(w, 'wolf', 20, 0);
    const speed = w.enemies.baseSpeed[wolf] as number;
    expect((w.modals[0] as { cards: { id: string }[] }).cards.map((c) => c.id)).toEqual([...BARGAIN_IDS]);
    expect(w.chooseCard(0)).toBe(true);
    expect(w.modals).toHaveLength(0);
    const picks: CardPickSim[] = [];
    for (const e of w.events) if (e.t === 'cardPick') picks.push({ ...e });
    expect(picks).toHaveLength(1);
    expect(picks[0]).toMatchObject({ player: 0, kind: 'bargain', id: 'fury' });
    refreshStats(p, w.content, w.ix);
    expect({ hp: p.hp, hpMax: p.hpMax, yeop: p.yeop, level: p.level, skills: p.skills.length }).toEqual({ hp: hero.hp, hpMax: hero.hpMax, yeop: hero.yeop, level: hero.level, skills: hero.skills });
    expect(p.stats.damage).toBeCloseTo(hero.damage + 0.25, 9);
    expect(w.enemies.baseSpeed[wolf]).toBeCloseTo(speed * 1.15, 4);
    expect(bargainsTaken(p)).toEqual(['fury']);
  });

  it.each([
    ['fury', 0],
    ['cunning', 1],
    ['fortune', 2],
  ] as const)('%s through the real shrine: applied once by the picker; the curse outlasts the event, the shrine and the minutes after it', (id, index) => {
    const w = claimed();
    const s = ev(w);
    const p = player(w);
    refreshStats(p, w.content, w.ix);
    const before = { damage: p.stats.damage, hpMax: p.hpMax, rerolls: p.rerolls, banishes: p.banishes, elite: w.mods.eliteEvery };
    expect((w.modals[0] as { cards: { id: string }[] }).cards[index]?.id).toBe(id);
    expect(w.chooseCard(index)).toBe(true);
    refreshStats(p, w.content, w.ix);
    // the shrine is over (the only hero used it) and long gone: 700 ticks later the event is done, the bargain is still in force
    tickShrine(w, 700);
    expect(s.stage).toBe('done');
    refreshStats(p, w.content, w.ix);
    const now = { damage: p.stats.damage, hpMax: p.hpMax, rerolls: p.rerolls, banishes: p.banishes, elite: w.mods.eliteEvery };
    const late = spawn(w, 'wolf', 22, 0);
    const lateSpeed = w.enemies.baseSpeed[late] as number;
    tickShrine(w, 1);
    const paced = (w.enemies.baseSpeed[late] as number) / lateSpeed;
    expect(bargainsTaken(p)).toEqual([id]);
    if (id === 'fury') {
      expect(now.damage).toBeCloseTo(before.damage + 0.25, 9);
      expect(paced).toBeCloseTo(1.15, 4);
      expect(bargainPace(w)).toBeCloseTo(1.15, 9);
    } else {
      expect(now.damage).toBe(before.damage);
      expect(paced).toBeCloseTo(1, 6);
    }
    if (id === 'cunning') {
      expect(now.rerolls).toBe(before.rerolls + 1);
      expect(now.banishes).toBe(before.banishes + 1);
      expect(now.hpMax).toBeLessThan(before.hpMax);
    } else {
      expect([now.rerolls, now.banishes, now.hpMax]).toEqual([before.rerolls, before.banishes, before.hpMax]);
    }
    if (id === 'fortune') {
      expect(now.elite).toBeCloseTo(before.elite * 0.8, 9);
      expect(freeChestsLeft(p)).toBe(2);
    } else {
      expect(now.elite).toBe(before.elite);
      expect(freeChestsLeft(p)).toBe(0);
    }
  });

  it('openBargain on its own builds the same modal for any hero (no rng, nothing else changes)', () => {
    const w = quiet([BARGAIN], {}, SHRINE_WINDOW);
    const before = streamStates(w);
    const m = openBargain(w, player(w));
    expect(m).toMatchObject({ kind: 'chest', player: 0, source: 'bargain', free: true, canSkip: true });
    expect(m.cards).toHaveLength(BARGAIN_CFG.offers);
    expect(streamStates(w)).toEqual(before);
    expect(w.skip()).toBe(true);
  });

  it('a co-op party that does not answer: the 20 s timer REFUSES the bargain (no card picked, nothing applied), it never takes the first curse for an absent player', () => {
    const w = shrineWorld({ config: { seed: 5, coop: [MEMBER] } });
    shrineUp(w);
    standOn(w, 1);
    standOn(w, 0, 8);
    tickShrine(w, 121);
    expect(w.modals.map((m) => m.player)).toEqual([1]);
    expect(w.autoPickAfter).toBe(20);
    const picks: CardPickSim[] = [];
    for (let i = 0; i < 20 * 60 + 5; i++) {
      w.step([NO_INPUT]);
      for (const e of w.events) if (e.t === 'cardPick') picks.push({ ...e });
    }
    expect(w.modals).toHaveLength(0);
    expect(picks).toEqual([]);
    // an ordinary level-up still auto-picks its first card
    openLevelUp(w, player(w, 1), 2);
    const lv: CardPickSim[] = [];
    for (let i = 0; i < 20 * 60 + 5; i++) {
      w.step([NO_INPUT]);
      for (const e of w.events) if (e.t === 'cardPick') lv.push({ ...e });
    }
    expect(w.modals).toHaveLength(0);
    expect(lv).toHaveLength(1);
  });
});

describe('Bargain: a co-op guest (host + guest + late join)', () => {
  let t: CoopHarness | null = null;
  afterEach(() => {
    t?.dispose();
    t = null;
  });

  /** a quiet fixture zone whose event is the shrine, inside 20-24 s */
  const shrineContent = (c: ContentDB): void => {
    c.runEvents = { ...structuredClone(DEFAULT_RUN_EVENTS), window: [20, 24], bossGap: 0, zones: { [FIXTURE_ZONE_ID]: [BARGAIN as unknown as RunEventKind] } };
    const z = c.zones.find((q) => q.id === FIXTURE_ZONE_ID);
    if (z === undefined) throw new Error('no fixture zone');
    z.bands = [{ from: 0, to: 900, rate: 0, maxAlive: 0, spawns: [{ enemy: 'wolf', weight: 1 }] }];
    z.bosses = [];
    z.metins = { types: ['metin_lament'], firstAt: 1e6, interval: [1e6, 1e6] };
  };

  it("the guest's pick is applied on the host to the guest's hero; the world curses (elites) hit the host hero too; a reconnect keeps all of it; the guest mirror keeps no run modifier of its own", async () => {
    const h = await CoopHarness.create({ guests: 1, latencyMs: 30, tough: true, content: shrineContent });
    t = h;
    const hw = h.hostWorld;
    const gw = h.guestWorlds[0] as World;
    const s = ev(hw);
    const until = (pred: () => boolean, limit = 60): number => {
      let n = 0;
      while (!pred() && n < limit * 60) {
        h.tick();
        n++;
      }
      return n;
    };
    until(() => s.stage === 'active', 40);
    const [hostHero, guestHero] = [hw.players[0] as PlayerState, hw.players[1] as PlayerState];
    // the guest hero walks onto the shrine, the host hero stays away
    for (const [p, dx] of [[guestHero, 0], [hostHero, 30]] as const) {
      p.x = p.px = s.x + dx;
      p.z = p.pz = s.z;
    }
    until(() => gw.modal !== null, 6);
    // the cards reach the guest whole: the three bargains, the party flag on the two curses that change the world
    expect(gw.modal?.cards.map((c) => [c.id, c.bargain?.party === true])).toEqual([
      ['fury', true],
      ['cunning', false],
      ['fortune', true],
    ]);
    expect(gw.modal?.cards.map((c) => c.bargain?.curse)).toEqual(['bargain.fury.curse', 'bargain.cunning.curse', 'bargain.fortune.curse']);
    const base = hw.mods.eliteEvery;
    expect(gw.chooseCard(2)).toBe(true); // fortune
    until(() => hw.modals.length === 0, 3);
    expect(gw.modal).toBeNull();
    expect(bargainsTaken(guestHero)).toEqual(['fortune']);
    expect(bargainsTaken(hostHero)).toEqual([]);
    expect([freeChestsLeft(hostHero), freeChestsLeft(guestHero)]).toEqual([0, 2]);
    expect(hw.mods.eliteEvery).toBeCloseTo(base * 0.8, 9);
    // a late join / reconnect: the host state is untouched, the mirror grows no modifiers
    await h.reconnect(1);
    until(() => gw.hud(0).runEvent !== undefined, 8);
    h.tick();
    expect(hw.mods.eliteEvery).toBeCloseTo(base * 0.8, 9);
    expect(freeChestsLeft(guestHero)).toBe(2);
    expect(bargainPace(hw)).toBe(1);
    expect(gw.mods.eliteEvery).toBe(base);
  }, 60_000);

  it('fury over the wire: the paced creatures reach the guest like any other (the marker bit of the flags column is harmless there) and keep coming', async () => {
    const h = await CoopHarness.create({ guests: 1, latencyMs: 30, tough: true, content: shrineContent });
    t = h;
    const hw = h.hostWorld;
    const gw = h.guestWorlds[0] as World;
    const field = (w: World): number => {
      let n = 0;
      for (let i = 0; i < w.enemies.count; i++) if (((w.enemies.flags[i] as number) & EnemyFlag.Metin) === 0) n++;
      return n;
    };
    // creatures nothing kills, so the two fields can be compared tick for tick
    const tank = (row: number): void => {
      hw.enemies.hp[row] = hw.enemies.hpMax[row] = 1e15;
    };
    for (let i = 0; i < 16; i++) tank(spawn(hw, 'wolf', 8 + (i % 4) * 2, -4 + Math.floor(i / 4) * 2));
    for (let i = 0; i < 60; i++) h.tick();
    expect(field(hw)).toBe(16);
    expect(field(gw)).toBe(16);
    openBargain(hw, hw.players[0] as PlayerState);
    expect(hw.chooseCard(BARGAIN_IDS.indexOf('fury'), 0)).toBe(true);
    for (let i = 0; i < 20; i++) tank(spawn(hw, 'jackal', -8 - (i % 4) * 2, -4 + Math.floor(i / 4) * 2));
    for (let i = 0; i < 120; i++) h.tick();
    expect(bargainPace(hw)).toBeCloseTo(1.15, 9);
    let hostPaced = 0;
    for (let i = 0; i < hw.enemies.count; i++) if (((hw.enemies.flags[i] as number) & PACED_FLAG) !== 0) hostPaced++;
    expect(hostPaced).toBe(field(hw));
    expect(field(hw)).toBe(36);
    // the guest holds the same creatures, none dropped or doubled by the extra flag bit
    expect(field(gw)).toBe(36);
    let guestPaced = 0;
    for (let i = 0; i < gw.enemies.count; i++) if (((gw.enemies.flags[i] as number) & PACED_FLAG) !== 0) guestPaced++;
    expect(guestPaced).toBe(36);
  }, 60_000);
});

describe('Bargain: co-op (each hero channels for their own modal)', () => {
  it('two heroes on the shrine at once: two modals, one per hero in hero order, each answered by its own hero; the event ends when both used it', () => {
    const w = shrineWorld({ config: { seed: 5, coop: [MEMBER] } });
    const s = shrineUp(w);
    standOn(w, 0);
    standOn(w, 1, 1);
    const got: RunEventSim[] = [];
    tickShrine(w, 60, got);
    expect(w.hud(0).channel).toBeCloseTo(0.5, 2);
    expect(w.hud(1).channel).toBeCloseTo(0.5, 2);
    tickShrine(w, 61, got);
    expect(w.modals.map((m) => [m.player, m.source, m.free, m.canSkip])).toEqual([
      [0, BARGAIN_SOURCE, true, true],
      [1, BARGAIN_SOURCE, true, true],
    ]);
    // the channel events named both heroes
    expect(new Set(channelOf(got).map((e) => e.player))).toEqual(new Set([0, 1]));
    // both used it: the event is over as a success, whatever the two modals wait for
    expect(s.stage).toBe('end');
    expect(s.failed).toBe(false);
    expect(runEventBargainUsed(w, 0)).toBe(true);
    expect(runEventBargainUsed(w, 1)).toBe(true);
    // hero 1 answers first (a guest on its machine), hero 0's modal stays
    expect(w.skip(1)).toBe(true);
    expect(w.modals.map((m) => m.player)).toEqual([0]);
    expect(w.chooseCard(0, 0)).toBe(true);
    expect(w.modals).toHaveLength(0);
  });

  it('one hero used it, the other has not: the shrine keeps standing for the other until its 60 s are up; the second hero then gets their own modal', () => {
    const w = shrineWorld({ config: { seed: 5, coop: [MEMBER] } });
    const s = shrineUp(w);
    standOn(w, 0);
    standOn(w, 1, 9);
    tickShrine(w, 121);
    expect(w.modals.map((m) => m.player)).toEqual([0]);
    drainModals(w);
    tickShrine(w, 60 * 10);
    expect(s.stage).toBe('active');
    expect(w.hud(1).runEvent).toMatchObject({ kind: BARGAIN, phase: 'active' });
    standOn(w, 1, 1);
    tickShrine(w, 121);
    // hero 0 stands on the spent shrine: nothing more for them
    expect(w.modals.map((m) => m.player)).toEqual([1]);
    expect(w.modals[0]?.source).toBe(BARGAIN_SOURCE);
    drainModals(w);
    expect(s.stage).toBe('end');
    expect(s.failed).toBe(false);
  });

  it('two heroes take different bargains: every curse of the world hits both, the own-hero curse and each boon only its picker', () => {
    const w = shrineWorld({ config: { seed: 5, coop: [MEMBER] } });
    shrineUp(w);
    const [host, guest] = [player(w, 0), player(w, 1)];
    for (const h of [host, guest]) refreshStats(h, w.content, w.ix);
    const was = { hostMax: host.hpMax, guestMax: guest.hpMax, hostDmg: host.stats.damage, guestDmg: guest.stats.damage, hostRr: host.rerolls, guestRr: guest.rerolls };
    const wolf = spawn(w, 'wolf', 20, 0);
    const speed = w.enemies.baseSpeed[wolf] as number;
    standOn(w, 0);
    standOn(w, 1, 1);
    tickShrine(w, 121);
    expect(w.modals.map((m) => m.player)).toEqual([0, 1]);
    // the guest hero takes cunning, the host hero fury
    const cunning = (w.modals.find((m) => m.player === 1) as { cards: { id: string }[] }).cards.findIndex((c) => c.id === 'cunning');
    expect(w.chooseCard(cunning, 1)).toBe(true);
    expect(w.chooseCard(0, 0)).toBe(true);
    for (const h of [host, guest]) refreshStats(h, w.content, w.ix);
    // fury: the host hero hits harder, EVERY hero (and the field) meets the faster monsters
    expect(host.stats.damage).toBeCloseTo(was.hostDmg + 0.25, 9);
    expect(guest.stats.damage).toBe(was.guestDmg);
    expect(w.enemies.baseSpeed[wolf]).toBeCloseTo(speed * 1.15, 4);
    // cunning: the guest hero has the budgets and pays the max hp; the host hero neither
    expect(guest.rerolls).toBe(was.guestRr + 1);
    expect(host.rerolls).toBe(was.hostRr);
    expect(guest.hpMax).toBeLessThan(was.guestMax);
    expect(host.hpMax).toBe(was.hostMax);
    expect([bargainsTaken(host), bargainsTaken(guest)]).toEqual([['fury'], ['cunning']]);
  });

  it('a hero who is down does not hold the shrine open: the living hero used it, the event is done', () => {
    const w = shrineWorld({ config: { seed: 5, coop: [MEMBER] } });
    const s = shrineUp(w);
    player(w, 1).alive = false;
    standOn(w, 0);
    tickShrine(w, 121);
    expect(w.modals.map((m) => m.player)).toEqual([0]);
    expect(s.stage).toBe('end');
    expect(s.failed).toBe(false);
  });

  it('the channel progress of each hero is its own: the HUD of hero 0 never shows the progress of hero 1', () => {
    const w = shrineWorld({ config: { seed: 5, coop: [MEMBER] } });
    shrineUp(w);
    standOn(w, 1);
    standOn(w, 0, 8);
    tickShrine(w, 48);
    expect(w.hud(0).channel).toBeUndefined();
    expect(w.hud(1).channel).toBeCloseTo(0.4, 2);
    standOn(w, 1, 8);
    standOn(w, 0);
    tickShrine(w, 12);
    expect(w.hud(1).channel).toBeUndefined();
    expect(w.hud(0).channel).toBeCloseTo(0.1, 2);
  });
});
