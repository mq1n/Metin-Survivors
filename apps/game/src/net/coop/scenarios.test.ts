import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_RUN_EVENTS, type ContentDB, type RunEventKind } from '../../data/schema';
import { FIXTURE_ZONE_ID } from '../../sim/__fixtures__/content';
import { openLevelUp } from '../../sim/cards';
import { hurtPlayer } from '../../sim/combat';
import { EventBus } from '../../sim/events';
import { registerRunEventKind, setRunEventChannel, unregisterRunEventKind } from '../../sim/runEvents';
import { giveSkill } from '../../sim/__tests__/helpers';
import { ByteReader } from './bytes';
import { decodeEvents, EventCollector, WireStrings } from './events';
import { CoopHarness } from './harness';
import { contentFingerprint } from './host';
import { DEFERRED_MAX_BLOCKS, DEFERRED_MAX_BYTES, type CoopGuest } from './mirror';
import { EV, SYNC_VERSION, type CoopStatus } from './protocol';

let h: CoopHarness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

function run(n: number, hostMove = { x: 0, z: 0 }, guestMove = { x: 0, z: 0 }): void {
  for (let i = 0; i < n; i++) (h as CoopHarness).tick(hostMove, [guestMove]);
}

async function create(opts: Parameters<typeof CoopHarness.create>[0] = {}): Promise<CoopHarness> {
  h = await CoopHarness.create({ guests: 1, latencyMs: 30, enemies: 0, tough: true, ...opts });
  return h;
}

/** a hit no hero survives */
function kill(h: CoopHarness, player: number): void {
  hurtPlayer(h.hostWorld, player, 1e9, 0, 0, 0, 0);
}

describe('card picks while the shared sim is paused', () => {
  it('pauses until the guest picks, then resumes', async () => {
    const t = await create();
    const hw = t.hostWorld;
    const mw = t.guestWorlds[0];
    run(120);
    openLevelUp(hw, hw.players[1]!, 2);
    run(30);
    // the host's own UI shows nothing (the pick belongs to the guest) but the sim is frozen
    expect(hw.modals).toHaveLength(1);
    expect(hw.modal).toBeNull();
    const frozen = hw.tick;
    run(60);
    expect(hw.tick).toBe(frozen);
    expect(mw?.modal?.kind).toBe('levelUp');
    expect(mw?.modal?.cards.length).toBeGreaterThan(0);
    expect(mw?.chooseCard(0)).toBe(true);
    // optimistic: the guest's modal is gone at once, the host needs a round trip
    expect(mw?.modal).toBeNull();
    run(30);
    expect(hw.modals).toHaveLength(0);
    run(30);
    expect(hw.tick).toBeGreaterThan(frozen + 10);
  });

  it('auto-picks after 20 s when nobody answers (both players pending)', async () => {
    const t = await create();
    const hw = t.hostWorld;
    let status: CoopStatus | null = null;
    t.runs[0]?.onStatus((s) => (status = s));
    run(120);
    openLevelUp(hw, hw.players[0]!, 2);
    openLevelUp(hw, hw.players[1]!, 2);
    run(5);
    const frozen = hw.tick;
    run(60 * 19);
    expect(hw.modals).toHaveLength(2);
    expect(hw.tick).toBe(frozen);
    const st = status as CoopStatus | null;
    expect(st?.pendingPicks.map((p) => p.name).sort()).toEqual(['Player1', 'Player2']);
    expect(st?.pendingPicks[0]?.left).toBeLessThan(2);
    run(60 * 2);
    expect(hw.modals).toHaveLength(0);
    run(30);
    expect(hw.tick).toBeGreaterThan(frozen);
    // both guests' pending offers are gone on the mirror too
    expect(t.guestWorlds[0]?.modal).toBeNull();
  });

  it('routes reroll / banish / skip to the host', async () => {
    const t = await create();
    const hw = t.hostWorld;
    const mw = t.guestWorlds[0]!;
    run(60);
    openLevelUp(hw, hw.players[1]!, 2);
    run(30);
    const before = mw.modal;
    expect(before).not.toBeNull();
    const rerolls = before?.rerolls ?? 0;
    expect(rerolls).toBeGreaterThan(0);
    expect(mw.reroll()).toBe(true);
    run(30);
    expect(mw.modal?.rerolls).toBe(rerolls - 1);
    expect(hw.modals[0]?.rerolls).toBe(rerolls - 1);
    const banishes = mw.modal?.banishes ?? 0;
    if (banishes > 0) {
      expect(mw.banish(0)).toBe(true);
      run(30);
      expect(hw.modals[0]?.banishes).toBe(banishes - 1);
    }
    const skips = mw.modal?.skips ?? 0;
    if (skips > 0) {
      expect(mw.skip()).toBe(true);
      run(30);
      expect(hw.modals).toHaveLength(0);
    }
  });
});

describe('connection loss', () => {
  it('ghosts a dropped guest and resyncs it on reconnect (< 15 s)', async () => {
    const t = await create();
    const hw = t.hostWorld;
    const mw = t.guestWorlds[0]!;
    const g = t.guests[0]!;
    run(120, { x: 1, z: 0 }, { x: 0, z: 1 });
    t.transports[1]?.drop();
    run(60 * 6, { x: 1, z: 0 }, { x: 0, z: 1 });
    expect(hw.players[1]?.alive).toBe(true);
    expect(t.host.status().players[1]?.connected).toBe(false);
    expect(g.phase).toBe('reconnecting');
    await t.reconnect(1);
    const keyframes = g.stats.keyframes;
    run(120, { x: 1, z: 0 }, { x: 0, z: 1 });
    await t.settle(100);
    expect(g.phase).toBe('running');
    expect(g.stats.keyframes).toBeGreaterThan(keyframes);
    expect(hw.players[1]?.alive).toBe(true);
    expect(t.host.status().players[1]?.connected).toBe(true);
    run(120, { x: 1, z: 0 }, { x: 0, z: 1 });
    expect(Math.abs((mw.players[0]?.z ?? 0) - (hw.players[1]?.z ?? 0))).toBeLessThan(3);
    expect(mw.time).toBeGreaterThan(8);
  });

  it('a guest that stays away longer than 15 s loses its hero', async () => {
    const t = await create();
    const hw = t.hostWorld;
    run(120);
    t.transports[1]?.drop();
    run(60 * 14);
    expect(hw.players[1]?.alive).toBe(true);
    run(60 * 3);
    expect(hw.players[1]?.alive).toBe(false);
    expect(hw.over).toBe(false);
    await t.reconnect(1);
    run(120);
    await t.settle(100);
    expect(t.guestWorlds[0]?.players[0]?.alive).toBe(false);
  });

  it('host leaving ends the run for everyone with the last checkpoint result', async () => {
    const t = await create();
    const mw = t.guestWorlds[0]!;
    const g = t.guests[0]!;
    run(60 * 13);
    expect(mw.over).toBe(false);
    t.transports[0]?.drop();
    run(60 * 2);
    expect(g.phase).toBe('hostLeft');
    expect(mw.over).toBe(true);
    expect(mw.result?.players.length).toBeGreaterThanOrEqual(1);
    expect(mw.result?.time).toBeGreaterThan(8);
    expect(mw.modal?.kind).toBe('runEnd');
    // the relay promoted the guest, which closes the run room
    expect(t.room.phase).toBe('lobby');
  });
});

describe('run end', () => {
  it('delivers each player their own result', async () => {
    const t = await create();
    const hw = t.hostWorld;
    const mw = t.guestWorlds[0]!;
    run(60 * 3);
    hw.players[0]!.kills = 11;
    hw.players[1]!.kills = 77;
    hw.players[1]!.yeopEarned = 1234;
    kill(t, 0);
    kill(t, 1);
    for (let i = 0; i < 400 && !hw.over; i++) t.tick();
    expect(hw.over).toBe(true);
    run(90);
    await t.settle(200);
    expect(mw.over).toBe(true);
    const own = mw.result;
    const hostRes = hw.result;
    expect(hostRes?.players).toHaveLength(2);
    expect(own?.players).toHaveLength(2);
    expect(own?.victory).toBe(false);
    expect(own?.kills).toBe(77);
    expect(own?.yeop).toBe(1234);
    expect(own?.doctrine).toBe('b');
    expect(hostRes?.kills).toBe(11);
    expect(hostRes?.doctrine).toBe('a');
    expect(mw.modal?.kind).toBe('runEnd');
    expect(t.guests[0]?.phase).toBe('ended');
  });
});

describe('interpolation', () => {
  it('shows a constant-speed remote hero as smooth motion under 20 ms of jitter', async () => {
    const t = await create({ jitterMs: 20, latencyMs: 40 });
    const hw = t.hostWorld;
    const mw = t.guestWorlds[0]!;
    run(240, { x: 1, z: 0 });
    const perTick = hw.players[0]!.stats.moveSpeed / 60;
    const deltas: number[] = [];
    let last = mw.players[1]!.x;
    for (let i = 0; i < 900; i++) {
      run(1, { x: 1, z: 0 });
      const x = mw.players[1]!.x;
      deltas.push(x - last);
      last = x;
    }
    const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    const worstLow = Math.min(...deltas) / perTick;
    const worstHigh = Math.max(...deltas) / perTick;
    // eslint-disable-next-line no-console
    console.log(`remote hero step: mean ${(mean / perTick).toFixed(3)}× expected, min ${worstLow.toFixed(2)}×, max ${worstHigh.toFixed(2)}×`);
    expect(mean / perTick).toBeGreaterThan(0.97);
    expect(mean / perTick).toBeLessThan(1.03);
    expect(worstLow).toBeGreaterThan(0.3);
    expect(worstHigh).toBeLessThan(1.8);
  });
});

describe('start-up race', () => {
  it('a guest that finishes loading before the host is not lost (its `ready` is replayed)', async () => {
    const t = await create({ hostLoadsLast: true });
    // without the replay the host would wait for the 25 s ready timeout before simulating anything
    run(120, { x: 1, z: 0 }, { x: 0, z: 1 });
    await t.settle(100);
    expect(t.hostWorld.tick).toBeGreaterThanOrEqual(100);
    expect(t.host.status().players[1]?.ready).toBe(true);
    expect(t.guests[0]?.phase).toBe('running');
    expect(t.guestWorlds[0]?.time).toBeGreaterThan(0.5);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// RS-02a: run events reach the guest HUD through mirrored 'runEvent' events

describe('run events (RS-02a)', () => {
  const KIND = 'rsTest';
  /** shrine progress each hero reports (host world index); `mute` stops reporting without a p = 0 (a lost stream) */
  const chan = { p: [0, 0, 0], mute: false, speed: 0 };

  function enableEvents(guests = 1, duration = 18): Promise<CoopHarness> {
    chan.p = [0, 0, 0];
    chan.mute = false;
    chan.speed = 0;
    registerRunEventKind(KIND, {
      duration: () => duration,
      place: (_w, run) => void ((run.x = 12.5), (run.z = -7.25)),
      onTick: (w, run) => {
        if (chan.speed !== 0) run.x += chan.speed * (1 / 60);
        if (chan.mute) return;
        for (let i = 0; i < w.players.length; i++) setRunEventChannel(w, i, chan.p[i] ?? 0);
      },
    });
    return create({
      guests,
      content: (c) => {
        c.runEvents = { ...structuredClone(DEFAULT_RUN_EVENTS), window: [20, 24], bossGap: 0, zones: { [FIXTURE_ZONE_ID]: [KIND as unknown as RunEventKind] } };
      },
    });
  }
  afterEach(() => unregisterRunEventKind(KIND));

  /** tick until `pred` (max `limit` s); returns the ticks spent */
  function until(pred: () => boolean, limit = 60): number {
    let n = 0;
    while (!pred() && n < limit * 60) {
      (h as CoopHarness).tick();
      n++;
    }
    return n;
  }

  it('the guest HUD shows the announcement, then the active event with a timer that counts down on the mirrored clock, then the end', async () => {
    const t = await enableEvents();
    const hw = t.hostWorld;
    const mw = t.guestWorlds[0]!;
    const s = hw.runEvent!;
    expect(s).not.toBeNull();
    expect(mw.hud(0).runEvent).toBeUndefined();

    until(() => s.stage === 'announce');
    expect(s.stage).toBe('announce');
    until(() => mw.hud(0).runEvent !== undefined, 5);
    let hud = mw.hud(0).runEvent;
    expect(hud).toMatchObject({ kind: KIND, phase: 'announce' });
    // quantised on the wire (1/64 m) and placed by the kind
    expect(hud?.x).toBeCloseTo(12.5, 1);
    expect(hud?.z).toBeCloseTo(-7.25, 1);
    // the timer is the absolute start minus the guest's own mirrored clock
    expect(hud?.left).toBeCloseTo(s.startAt - mw.time, 1);
    expect(hud?.left).toBeGreaterThan(3);
    expect(hud?.left).toBeLessThanOrEqual(5);

    until(() => mw.hud(0).runEvent?.phase === 'active', 8);
    hud = mw.hud(0).runEvent;
    expect(hud?.phase).toBe('active');
    const left1 = hud?.left ?? 0;
    expect(left1).toBeCloseTo(s.endAt - mw.time, 1);
    run(120);
    const left2 = mw.hud(0).runEvent?.left ?? 0;
    // two seconds later the guest timer is two seconds lower, and still equals endAt - clock
    expect(left1 - left2).toBeGreaterThan(1.8);
    expect(left1 - left2).toBeLessThan(2.2);
    expect(left2).toBeCloseTo(s.endAt - mw.time, 1);
    // within the playback delay of the host's own timer
    expect(Math.abs(left2 - (hw.hud(0).runEvent?.left ?? 0))).toBeLessThan(0.6);

    until(() => mw.hud(0).runEvent?.phase === 'end', 60);
    expect(mw.hud(0).runEvent?.phase).toBe('end');
    until(() => mw.hud(0).runEvent === undefined, 10);
    expect(mw.hud(0).runEvent).toBeUndefined();
    expect(hw.hud(0).runEvent).toBeUndefined();
  });

  it('the guest HUD of a run without events carries no runEvent or channel at all', async () => {
    const t = await create();
    run(200);
    expect('runEvent' in t.guestWorlds[0]!.hud(0)).toBe(false);
    expect('channel' in t.guestWorlds[0]!.hud(0)).toBe(false);
  });

  it('a guest that knows nothing of the event (late join, resync) shows it within 5 s: the host re-emits the state', async () => {
    const t = await enableEvents();
    const hw = t.hostWorld;
    const mw = t.guestWorlds[0]!;
    const g = t.guests[0]! as unknown as { runEventView: unknown; channels: unknown[] };
    until(() => hw.runEvent!.stage === 'active');
    until(() => mw.hud(0).runEvent?.phase === 'active', 5);
    expect(mw.hud(0).runEvent).toBeDefined();
    // the guest joins now: it has no state at all
    g.runEventView = null;
    g.channels.length = 0;
    expect(mw.hud(0).runEvent).toBeUndefined();
    const heartbeats: number[] = [];
    const ticks = until(() => {
      for (const e of mw.events) if (e.t === 'runEvent' && e.phase === 'active') heartbeats.push(mw.time);
      return mw.hud(0).runEvent !== undefined;
    }, 7);
    // 5 s of heartbeat (+ the playback delay and the latency)
    expect(ticks / 60).toBeLessThanOrEqual(5.5);
    expect(mw.hud(0).runEvent).toMatchObject({ kind: KIND, phase: 'active' });
    expect(mw.hud(0).runEvent?.left).toBeCloseTo(hw.runEvent!.endAt - mw.time, 1);
    expect(heartbeats.length).toBeGreaterThanOrEqual(1);
  });

  it('a guest that was away while the event ended shows no ghost event after the reconnect (the lost end must not leave a countdown to the planned end)', async () => {
    const t = await enableEvents();
    const hw = t.hostWorld;
    const mw = t.guestWorlds[0]!;
    const s = hw.runEvent!;
    until(() => s.stage === 'active');
    until(() => mw.hud(0).runEvent?.phase === 'active', 5);
    const plannedEnd = s.endAt;
    // the guest drops; the host ends the event early (the 'end' event and the 3 s linger fall into the gap) and is done long before the guest is back
    t.transports[1]?.drop();
    run(60 * 2);
    s.endAt = hw.time + 0.5;
    run(60 * 6);
    expect(s.stage).toBe('done');
    expect(hw.hud(0).runEvent).toBeUndefined();
    await t.reconnect(1);
    // the host emits nothing any more, so the guest view is a ghost: gone within 7 s of mirrored time (and it never comes back)
    const ticks = until(() => mw.hud(0).runEvent === undefined, 7);
    expect(ticks / 60).toBeLessThanOrEqual(7);
    expect(mw.hud(0).runEvent).toBeUndefined();
    // it would have counted down to the planned end for a long while yet
    expect(mw.time).toBeLessThan(plannedEnd);
    for (let i = 0; i < 60 * 8; i++) {
      run(1);
      expect(mw.hud(0).runEvent).toBeUndefined();
    }
  });

  it('a guest that drops mid-event and reconnects while it still runs shows it again within 5 s, timed from the mirrored clock', async () => {
    const t = await enableEvents();
    const hw = t.hostWorld;
    const mw = t.guestWorlds[0]!;
    const s = hw.runEvent!;
    const g = t.guests[0]! as unknown as { runEventView: { seenAt: number } | null };
    until(() => s.stage === 'active');
    until(() => mw.hud(0).runEvent?.phase === 'active', 5);
    t.transports[1]?.drop();
    run(60 * 6);
    expect(s.stage).toBe('active');
    await t.reconnect(1);
    // refreshed by an event received after the reconnect (the old view is only a ghost of the time before the drop)
    const back = hw.time;
    const ticks = until(() => (g.runEventView?.seenAt ?? 0) >= back - 1 && mw.hud(0).runEvent !== undefined, 6);
    expect(ticks / 60).toBeLessThanOrEqual(5.5);
    const hud = mw.hud(0).runEvent;
    expect(hud).toMatchObject({ kind: KIND, phase: 'active' });
    expect(hud?.left).toBeCloseTo(s.endAt - mw.time, 1);
    expect(hud?.left).toBeGreaterThan(0);
    // and it stays up (the heartbeat keeps refreshing it) until the host ends it
    for (let i = 0; i < 60 * 8; i++) {
      run(1);
      if (s.stage !== 'active') break;
      expect(mw.hud(0).runEvent?.phase).toBe('active');
    }
  });

  it('a modal pause (both clocks frozen for longer than a heartbeat) never drops a live event on the guest', async () => {
    const t = await enableEvents();
    const hw = t.hostWorld;
    const mw = t.guestWorlds[0]!;
    const s = hw.runEvent!;
    until(() => s.stage === 'active');
    until(() => mw.hud(0).runEvent?.phase === 'active', 5);
    openLevelUp(hw, hw.players[1]!, 2);
    run(30);
    expect(mw.modal?.kind).toBe('levelUp');
    const frozen = hw.tick;
    const left = mw.hud(0).runEvent?.left as number;
    // 12 s of pause: more than the 6.5 s a view may go unrefreshed, yet the clocks stand still, so nothing is dropped
    for (let i = 0; i < 60 * 12; i++) {
      run(1);
      expect(mw.hud(0).runEvent?.phase).toBe('active');
    }
    expect(hw.tick).toBe(frozen);
    expect(mw.hud(0).runEvent?.left as number).toBeCloseTo(left, 1);
    expect(mw.chooseCard(0)).toBe(true);
    run(60 * 8);
    expect(hw.tick).toBeGreaterThan(frozen);
    if (s.stage === 'active') expect(mw.hud(0).runEvent?.phase).toBe('active');
  });

  /** the guest's tab is hidden: the network and the host run, the guest world is not stepped (engine/loop.ts stops with the page) */
  function hide(t: CoopHarness, seconds: number): void {
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      t.net.advance(1000 / 60);
      t.hostWorld.step([{ moveX: 0, moveZ: 0 }]);
    }
  }

  // r2 mustFix: the stamp of a view was the mirror clock at DECODE time, which is stale for events decoded after a hidden tab or a stall
  // (the frames pile up past QUEUE_MAX and are decoded before the clock jumps), so a LIVE event blanked for up to 5 s.
  it.each([8, 10, 11.3, 12.7, 14.1])('a guest whose tab was hidden for %s s shows the LIVE event on the first tick back, with the timer from the mirrored clock, and never loses it', async (hidden) => {
    const t = await enableEvents(1, 120);
    const hw = t.hostWorld;
    const mw = t.guestWorlds[0]!;
    const s = hw.runEvent!;
    until(() => s.stage === 'active');
    until(() => mw.hud(0).runEvent?.phase === 'active', 5);
    // a few seconds in, so the heartbeat phase differs per run
    run(60 * 3);
    expect(mw.hud(0).runEvent?.phase).toBe('active');
    hide(t, hidden);
    expect(s.stage).toBe('active');
    let blank = 0;
    let worstLeft = 0;
    for (let i = 0; i < 60 * 12 && s.stage === 'active'; i++) {
      run(1);
      const r = mw.hud(0).runEvent;
      if (!r) blank++;
      else worstLeft = Math.max(worstLeft, Math.abs((r.left as number) - (s.endAt - mw.time)));
    }
    expect(blank).toBe(0);
    expect(worstLeft).toBeLessThan(0.2);
    expect(mw.hud(0).runEvent).toMatchObject({ kind: KIND, phase: 'active' });
  });

  it('a guest hidden while the host ends the event never shows an announce / active view after the return', async () => {
    const t = await enableEvents(1, 120);
    const hw = t.hostWorld;
    const mw = t.guestWorlds[0]!;
    const s = hw.runEvent!;
    until(() => s.stage === 'active');
    until(() => mw.hud(0).runEvent?.phase === 'active', 5);
    run(60 * 2);
    // the host resolves the event while the tab is hidden; the 'end', its 3 s linger and 'done' all fall into the gap
    s.endAt = hw.time + 0.5;
    hide(t, 14);
    expect(s.stage).toBe('done');
    expect(hw.hud(0).runEvent).toBeUndefined();
    for (let i = 0; i < 60 * 8; i++) {
      run(1);
      const phase = mw.hud(0).runEvent?.phase;
      expect(phase === 'active' || phase === 'announce').toBe(false);
    }
    expect(mw.hud(0).runEvent).toBeUndefined();
  });

  it('a guest hidden over the announce shows the announcement when it returns while it is still up, and the active event after it', async () => {
    const t = await enableEvents(1, 120);
    const hw = t.hostWorld;
    const mw = t.guestWorlds[0]!;
    const s = hw.runEvent!;
    until(() => s.stage === 'announce');
    until(() => mw.hud(0).runEvent?.phase === 'announce', 3);
    // hide for 2 s of the 5 s announcement
    hide(t, 2);
    expect(s.stage).toBe('announce');
    run(1);
    expect(mw.hud(0).runEvent).toMatchObject({ kind: KIND, phase: 'announce' });
    until(() => s.stage === 'active');
    until(() => mw.hud(0).runEvent?.phase === 'active', 3);
    expect(mw.hud(0).runEvent?.left).toBeCloseTo(s.endAt - mw.time, 1);
  });

  it('an event that moves reaches the guest HUD within a few metres of the host, not only with the 5 s heartbeat', async () => {
    const t = await enableEvents(1, 60);
    chan.speed = 3;
    const hw = t.hostWorld;
    const mw = t.guestWorlds[0]!;
    const s = hw.runEvent!;
    until(() => s.stage === 'active');
    until(() => mw.hud(0).runEvent?.phase === 'active', 5);
    let worst = 0;
    let n = 0;
    for (let i = 0; i < 60 * 14 && s.stage === 'active'; i++) {
      run(1);
      const r = mw.hud(0).runEvent;
      if (!r) continue;
      worst = Math.max(worst, Math.abs(r.x - s.x));
      n++;
    }
    expect(n).toBeGreaterThan(60 * 12);
    // 3 m of emission lag + the playback delay and latency at 3 m/s (about 0.2 s = 0.6 m)
    expect(worst).toBeLessThan(4.2);
    // the heartbeat alone would have left it up to 15 m behind (3 m/s x 5 s)
    expect(s.x).toBeGreaterThan(12.5 + 30);
  });

  it('channel progress reaches only its own hero: the channelling guest sees it, the other guest and the host do not', async () => {
    const t = await enableEvents(2);
    const hw = t.hostWorld;
    const gA = t.guestWorlds[0]!;
    const gB = t.guestWorlds[1]!;
    until(() => hw.runEvent!.stage === 'active');
    until(() => gA.hud(0).runEvent?.phase === 'active' && gB.hud(0).runEvent?.phase === 'active', 5);
    // host hero 1 (guest A's hero) channels
    chan.p[1] = 0.5;
    run(40);
    expect(gA.hud(0).channel).toBeCloseTo(0.5, 1);
    expect(gB.hud(0).channel).toBeUndefined();
    expect(hw.hud(0).channel).toBeUndefined();
    expect(hw.hud(1).channel).toBeCloseTo(0.5, 5);
    // progress rises: the guest follows
    chan.p[1] = 0.9;
    run(40);
    expect(gA.hud(0).channel).toBeCloseTo(0.9, 1);
    // host hero 2 (guest B's hero) starts, hero 1 leaves: the bars swap and nothing leaks across
    chan.p[1] = 0;
    chan.p[2] = 0.3;
    run(40);
    expect(gA.hud(0).channel).toBeUndefined();
    expect(gB.hud(0).channel).toBeCloseTo(0.3, 1);
    expect(hw.hud(0).channel).toBeUndefined();
    // the host hero channels: only the host HUD shows it
    chan.p[2] = 0;
    chan.p[0] = 0.7;
    run(40);
    expect(hw.hud(0).channel).toBeCloseTo(0.7, 5);
    expect(gA.hud(0).channel).toBeUndefined();
    expect(gB.hud(0).channel).toBeUndefined();
  });

  it('a channel stream that stops without a p = 0 (lost packets) does not freeze the guest bar', async () => {
    const t = await enableEvents();
    const hw = t.hostWorld;
    const mw = t.guestWorlds[0]!;
    until(() => hw.runEvent!.stage === 'active');
    until(() => mw.hud(0).runEvent?.phase === 'active', 5);
    chan.p[1] = 0.6;
    run(40);
    expect(mw.hud(0).channel).toBeCloseTo(0.6, 1);
    chan.mute = true;
    run(90);
    expect(mw.hud(0).channel).toBeUndefined();
  });

  it('a channel that ends because the event ended clears the guest bar with the end of the event', async () => {
    const t = await enableEvents();
    const hw = t.hostWorld;
    const mw = t.guestWorlds[0]!;
    until(() => hw.runEvent!.stage === 'active');
    until(() => mw.hud(0).runEvent?.phase === 'active', 5);
    chan.p[1] = 0.6;
    run(40);
    expect(mw.hud(0).channel).toBeDefined();
    // the event runs out under the channel: the host sends p = 0 before the end
    hw.runEvent!.endAt = hw.time + 0.5;
    until(() => mw.hud(0).runEvent?.phase === 'end', 5);
    expect(mw.hud(0).channel).toBeUndefined();
  });
});

describe('run event wire format (RS-02a)', () => {
  function roundTrip(events: Parameters<EventCollector['collect']>[0], budget?: number): { bus: EventBus; seen: unknown[]; dropped: number } {
    const strings = new WireStrings();
    const col = new EventCollector(strings);
    col.collect(events);
    const block = col.flush(budget);
    const bus = new EventBus();
    const seen: unknown[] = [];
    decodeEvents(new ByteReader(block.bytes), block.count, {
      bus,
      player: (i) => i,
      enemy: () => 0,
      str: (i) => strings.names[i] ?? '',
      onRunEvent: (e) => seen.push({ ...e }),
    });
    return { bus, seen, dropped: block.dropped };
  }
  const ev = (phase: 'announce' | 'active' | 'end' | 'channel', over: Record<string, unknown> = {}) =>
    ({ t: 'runEvent', kind: 'metinRain', phase, id: 1, x: -33.5, z: 71.25, startAt: 421.37, endAt: 466.37, player: -1, p: 0, ...over }) as const;

  it('carries kind, phase, id, position, absolute times (10 ms), hero and progress for every phase', () => {
    for (const phase of ['announce', 'active', 'end', 'channel'] as const) {
      const { seen, bus } = roundTrip([ev(phase, { player: phase === 'channel' ? 2 : -1, p: phase === 'channel' ? 0.4 : phase === 'end' ? 1 : 0 })]);
      expect(seen).toHaveLength(1);
      const e = seen[0] as ReturnType<typeof ev>;
      expect(e.kind).toBe('metinRain');
      expect(e.phase).toBe(phase);
      expect(e.id).toBe(1);
      expect(e.x).toBeCloseTo(-33.5, 1);
      expect(e.z).toBeCloseTo(71.25, 1);
      expect(e.startAt).toBeCloseTo(421.37, 2);
      expect(e.endAt).toBeCloseTo(466.37, 2);
      expect(e.player).toBe(phase === 'channel' ? 2 : -1);
      expect(e.p).toBeCloseTo(phase === 'channel' ? 0.4 : phase === 'end' ? 1 : 0, 2);
      // the decoded event is also on the guest bus for the renderer / audio / HUD
      expect(bus.list.map((x) => x.t)).toEqual(['runEvent']);
    }
  });

  it('never drops a phase under pressure, drops channel progress first', () => {
    const list = [ev('announce'), ev('channel', { player: 1, p: 0.2 }), ev('channel', { player: 1, p: 0.3 }), ev('active')];
    const { seen, dropped } = roundTrip(list, 1);
    expect((seen as { phase: string }[]).map((e) => e.phase)).toEqual(['announce', 'active']);
    expect(dropped).toBe(2);
  });

  it('rejects an unknown phase byte instead of guessing', () => {
    const strings = new WireStrings();
    const col = new EventCollector(strings);
    col.collect([ev('active')]);
    const block = col.flush();
    const bytes = block.bytes.slice();
    // layout: type(1) kind(varuint 1) phase(1): corrupt the phase
    bytes[2] = 9;
    expect(() => decodeEvents(new ByteReader(bytes), 1, { bus: new EventBus(), player: (i) => i, enemy: () => 0, str: (i) => strings.names[i] ?? '' })).toThrow();
  });
});

describe('the Sky Sovereign shrine over the wire (EV-02a)', () => {
  const KIND = 'bargain';
  /** a quiet fixture zone whose event is the shrine, inside 20-24 s */
  const shrineContent = (c: ContentDB): void => {
    c.runEvents = { ...structuredClone(DEFAULT_RUN_EVENTS), window: [20, 24], bossGap: 0, zones: { [FIXTURE_ZONE_ID]: [KIND as unknown as RunEventKind] } };
    const z = c.zones.find((q) => q.id === FIXTURE_ZONE_ID);
    if (z === undefined) throw new Error('no fixture zone');
    z.bands = [{ from: 0, to: 900, rate: 0, maxAlive: 0, spawns: [{ enemy: 'wolf', weight: 1 }] }];
    z.bosses = [];
    z.metins = { types: ['metin_lament'], firstAt: 1e6, interval: [1e6, 1e6] };
  };

  async function shrine(): Promise<{ hw: CoopHarness['hostWorld']; gw: NonNullable<CoopHarness['guestWorlds'][number]>; s: NonNullable<CoopHarness['hostWorld']['runEvent']> }> {
    h = await CoopHarness.create({ guests: 1, latencyMs: 30, tough: true, content: shrineContent });
    const hw = h.hostWorld;
    const gw = h.guestWorlds[0]!;
    const s = hw.runEvent!;
    expect(s.kind).toBe(KIND);
    until(() => s.stage === 'active', 40);
    until(() => gw.hud(0).runEvent?.phase === 'active', 5);
    expect(gw.hud(0).runEvent).toMatchObject({ kind: KIND, phase: 'active' });
    return { hw, gw, s };
  }

  /** the host puts hero `i` on the shrine, `dx` m east of it */
  function standOn(hw: CoopHarness['hostWorld'], i: number, dx = 0): void {
    const s = hw.runEvent!;
    const p = hw.players[i]!;
    p.x = p.px = s.x + dx;
    p.z = p.pz = s.z;
  }

  function until(pred: () => boolean, limit = 60): number {
    let n = 0;
    while (!pred() && n < limit * 60) {
      (h as CoopHarness).tick();
      n++;
    }
    return n;
  }

  it('each hero channels for their own modal: the guest sees its bar from the mirrored events and its modal on its machine, the host sees neither; both answer their own', async () => {
    const { hw, gw, s } = await shrine();
    // the guest hero (host index 1) is on the shrine, the host hero is away
    standOn(hw, 1);
    run(60);
    expect(gw.hud(0).channel).toBeGreaterThan(0.25);
    expect(gw.hud(0).channel).toBeLessThan(0.8);
    expect(hw.hud(0).channel).toBeUndefined();
    expect(hw.hud(1).channel).toBeGreaterThan(0.4);
    until(() => gw.modal !== null, 4);
    expect(gw.modal).toMatchObject({ kind: 'chest', source: 'bargain', free: true, canSkip: true });
    expect(gw.modal?.cards).toHaveLength(DEFAULT_RUN_EVENTS.kinds.bargain.offers);
    for (const c of gw.modal?.cards ?? []) expect(c.kind).toBe('bargain');
    // it belongs to the guest hero: the host's own UI shows nothing, and the shared sim waits for the answer
    expect(hw.modals.map((m) => [m.player, m.source])).toEqual([[1, 'bargain']]);
    expect(hw.modal).toBeNull();
    const frozen = hw.tick;
    run(60);
    expect(hw.tick).toBe(frozen);
    // the finished channel left no bar behind on the guest HUD (the p = 0 follows the p = 1, or the stale rule clears it)
    expect(gw.hud(0).channel).toBeUndefined();
    // the guest refuses: free, routed to the host
    const skips = gw.modal?.skips;
    expect(skips).toBe(1);
    expect(gw.skip()).toBe(true);
    run(30);
    expect(hw.modals).toHaveLength(0);
    expect(gw.modal).toBeNull();
    // one hero used it, the host hero has not: the shrine stands on
    expect(s.stage).toBe('active');
    run(60 * 3);
    expect(gw.hud(0).runEvent).toMatchObject({ kind: KIND, phase: 'active' });
    // the host hero walks on: its own modal, on the host only
    standOn(hw, 0, 1);
    until(() => hw.modals.length > 0, 4);
    expect(hw.modal).toMatchObject({ kind: 'chest', source: 'bargain', player: 0 });
    run(30);
    expect(gw.modal).toBeNull();
    expect(hw.chooseCard(0)).toBe(true);
    // both used it: the event ends for everyone with its p = 1
    until(() => gw.hud(0).runEvent?.phase === 'end', 6);
    expect(gw.hud(0).runEvent).toMatchObject({ kind: KIND, phase: 'end' });
    expect(s.failed).toBe(false);
  }, 60_000);

  it('a guest that never answers has the bargain refused by the host timer (20 s): its modal is retired on the guest too, nothing was picked', async () => {
    const { hw, gw } = await shrine();
    standOn(hw, 1);
    until(() => gw.modal !== null, 6);
    expect(gw.modal?.source).toBe('bargain');
    const picks: string[] = [];
    for (let i = 0; i < 60 * 21; i++) {
      (h as CoopHarness).tick();
      for (const e of hw.events) if (e.t === 'cardPick') picks.push(e.kind);
    }
    expect(hw.modals).toHaveLength(0);
    expect(gw.modal).toBeNull();
    expect(picks).toEqual([]);
  }, 60_000);

  it('the completion pair (p = 1, then the reset p = 0 in the same tick) crosses the wire in order, and under pressure the channel goes before the phases', () => {
    const strings = new WireStrings();
    const col = new EventCollector(strings);
    const ev = (phase: 'announce' | 'active' | 'end' | 'channel', over: Record<string, unknown> = {}) =>
      ({ t: 'runEvent', kind: 'bargain', phase, id: 1, x: 12.25, z: -8.5, startAt: 400, endAt: 460, player: -1, p: 0, ...over }) as const;
    col.collect([ev('channel', { player: 1, p: 1 }), ev('channel', { player: 1, p: 0 }), ev('active')]);
    const block = col.flush();
    const seen: { phase: string; player: number; p: number }[] = [];
    decodeEvents(new ByteReader(block.bytes), block.count, {
      bus: new EventBus(),
      player: (i) => i,
      enemy: () => 0,
      str: (i) => strings.names[i] ?? '',
      onRunEvent: (e) => seen.push({ phase: e.phase, player: e.player, p: e.p }),
    });
    // the phase is never dropped and goes first (priority 0); the pair keeps its order, so the guest ends on the reset
    expect(seen.map((e) => e.phase)).toEqual(['active', 'channel', 'channel']);
    expect(seen.slice(1).map((e) => [e.player, e.p])).toEqual([
      [1, 1],
      [1, 0],
    ]);
    // droppable: a tiny budget keeps the phase and loses the pair
    const col2 = new EventCollector(new WireStrings());
    col2.collect([ev('channel', { player: 1, p: 1 }), ev('channel', { player: 1, p: 0 }), ev('active')]);
    const tiny = col2.flush(1);
    expect(tiny.count).toBe(1);
    expect(tiny.dropped).toBe(2);
  });

  it('guest manual combat controls (manualCast, attack, castMask, aim) reach the host simulation', async () => {
    const harness = await create({ guests: 1, latencyMs: 10, enemies: 0, skills: false });
    const hw = harness.hostWorld;
    const guestHero = hw.players[1]!;
    // Ensure the guest has an active skill at taskbar slot 1 (bit 1 = hotkey 2) alongside its starting basic (slot 0).
    let activeSkill = guestHero.skills.find((s) => !s.basic && !s.ultimate);
    if (!activeSkill) {
      const activeDef = hw.content.skills.find((s) => s.kind === 'active' && s.behavior === 'meleeArc')
        ?? hw.content.skills.find((s) => s.kind === 'active');
      expect(activeDef).toBeDefined();
      giveSkill(hw, activeDef!.id, 1, 1);
      activeSkill = guestHero.skills.find((s) => s.def.id === activeDef!.id);
    }
    expect(activeSkill).toBeDefined();
    const activeId = activeSkill!.def.id;

    // Clear initial cooldowns and step in manualCast mode with NO attack/cast buttons: nothing should fire automatically.
    for (const s of guestHero.skills) s.cd = 0;
    const casts: { player: number; skillId: string; dirX: number; dirZ: number; rot: number }[] = [];
    for (let i = 0; i < 20; i++) {
      harness.tick({ x: 0, z: 0, manualCast: true }, [{ x: 0, z: 0, manualCast: true }]);
      for (const e of hw.events) {
        if (e.t === 'skillCast' && e.player === 1) {
          casts.push({ player: e.player, skillId: e.skillId, dirX: e.dirX, dirZ: e.dirZ, rot: guestHero.rot });
        }
      }
    }
    expect(guestHero.manualCast).toBe(true);
    expect(casts).toEqual([]);

    // Guest triggers manual basic attack aimed along +X (aimX = 1, aimZ = 0 → dirX ≈ 1, rot ≈ π/2).
    for (let i = 0; i < 15; i++) {
      harness.tick({ x: 0, z: 0, manualCast: true }, [{ x: 0, z: 0, manualCast: true, attack: i === 0, aimX: 1, aimZ: 0 }]);
      for (const e of hw.events) {
        if (e.t === 'skillCast' && e.player === 1) {
          casts.push({ player: e.player, skillId: e.skillId, dirX: e.dirX, dirZ: e.dirZ, rot: guestHero.rot });
        }
      }
    }
    const basicId = guestHero.skills.find((s) => s.basic)!.def.id;
    const basicCast = casts.find((c) => c.skillId === basicId);
    expect(basicCast).toBeDefined();
    expect(basicCast!.dirX).toBeGreaterThan(0.95);
    expect(Math.sin(basicCast!.rot)).toBeGreaterThan(0.95);

    // Guest triggers active skill slot 1 (castMask = 1 << 1) aimed along -Z (aimX = 0, aimZ = -1 → dirZ ≈ -1).
    casts.length = 0;
    for (const s of guestHero.skills) s.cd = 0;
    for (let i = 0; i < 15; i++) {
      harness.tick({ x: 0, z: 0, manualCast: true }, [{ x: 0, z: 0, manualCast: true, castMask: i === 0 ? 1 << 1 : 0, aimX: 0, aimZ: -1 }]);
      for (const e of hw.events) {
        if (e.t === 'skillCast' && e.player === 1) {
          casts.push({ player: e.player, skillId: e.skillId, dirX: e.dirX, dirZ: e.dirZ, rot: guestHero.rot });
        }
      }
    }
    const activeCast = casts.find((c) => c.skillId === activeId);
    expect(activeCast).toBeDefined();
    expect(activeCast!.dirZ).toBeLessThan(-0.95);
    expect(Math.cos(activeCast!.rot)).toBeLessThan(-0.95);
  });

  it('guest manual combat predicts local facing immediately, blocks stale/retransmitted edges across sync/reconnect, and stays within relay input limits (NET-04)', async () => {
    const harness = await create({ guests: 1, latencyMs: 10, enemies: 0, skills: false });
    const hw = harness.hostWorld;
    const gw = harness.guestWorlds[0]!;
    const guestHero = hw.players[1]!;
    let activeSkill = guestHero.skills.find((s) => !s.basic && !s.ultimate);
    if (!activeSkill) {
      const activeDef = hw.content.skills.find((s) => s.kind === 'active');
      giveSkill(hw, activeDef!.id, 1, 1);
      activeSkill = guestHero.skills.find((s) => s.def.id === activeDef!.id);
    }
    const activeId = activeSkill!.def.id;

    // Warm up so predictor is initialised on the guest.
    for (let i = 0; i < 20; i++) harness.tick({ x: 0, z: 0, manualCast: true }, [{ x: 0, z: 0, manualCast: true }]);

    // 1. Immediate local facing prediction on guest when manual aim + attack is supplied.
    harness.tick({ x: 0, z: 0, manualCast: true }, [{ x: 0, z: 0, manualCast: true, attack: true, aimX: -1, aimZ: 0 }]);
    expect(Math.sin(gw.players[0]!.rot)).toBeLessThan(-0.95);

    // 2. Capture a castMask input packet, then verify replaying the SAME seq after EV.sync and after reconnect does NOT double-fire.
    for (const s of guestHero.skills) s.cd = 0;
    const activeCasts: number[] = [];
    for (let i = 0; i < 15; i++) {
      harness.tick({ x: 0, z: 0, manualCast: true }, [{ x: 0, z: 0, manualCast: true, castMask: i === 0 ? 1 << 1 : 0, aimX: 0, aimZ: 1 }]);
      for (const e of hw.events) if (e.t === 'skillCast' && e.player === 1 && e.skillId === activeId) activeCasts.push(hw.tick);
    }
    expect(activeCasts).toHaveLength(1);

    // Trigger EV.sync (which calls clearGuestInput on host) and reset cooldowns, then inject a stale duplicate input packet with an old seq.
    const staleSeq = Math.max(1, harness.guests[0]!.predictor.tick - 5);
    const guestSlot = harness.transports[1]!.slot;
    harness.transports[1]!.event(EV.sync);
    await harness.settle(50);
    for (const s of guestHero.skills) s.cd = 0;
    harness.transports[1]!.input({ seq: staleSeq, tick: hw.tick, mx: 0, mz: 0, btn: (1 << 1) | 0x0800 | 0x0400, aim: 0 });
    for (let i = 0; i < 12; i++) {
      harness.tick({ x: 0, z: 0, manualCast: true }, [{ x: 0, z: 0, manualCast: true }]);
      for (const e of hw.events) if (e.t === 'skillCast' && e.player === 1 && e.skillId === activeId) activeCasts.push(hw.tick);
    }
    expect(activeCasts).toHaveLength(1);

    // Also drop & reconnect guest, then verify stale seq is STILL rejected on host (lastSeq monotonic across reconnect).
    harness.transports[1]!.drop();
    for (let i = 0; i < 20; i++) harness.tick({ x: 0, z: 0, manualCast: true }, [{ x: 0, z: 0, manualCast: true, castMask: 1 << 1 }]);
    await harness.reconnect(1);
    for (const s of guestHero.skills) s.cd = 0;
    // Inject stale seq directly on host via guest transport.
    harness.transports[1]!.input({ seq: staleSeq, tick: hw.tick, mx: 0, mz: 0, btn: (1 << 1) | 0x0800 | 0x0400, aim: 0 });
    for (let i = 0; i < 12; i++) {
      harness.tick({ x: 0, z: 0, manualCast: true }, [{ x: 0, z: 0, manualCast: true }]);
      for (const e of hw.events) if (e.t === 'skillCast' && e.player === 1 && e.skillId === activeId) activeCasts.push(hw.tick);
    }
    expect(activeCasts).toHaveLength(1);
    void guestSlot;

    // 3. Holding attack continuously for 3 seconds must never exceed relay input rate limits.
    for (let i = 0; i < 180; i++) {
      harness.tick({ x: 0, z: 0, manualCast: true }, [{ x: 1, z: 0, manualCast: true, attack: true, aimX: 1, aimZ: 0 }]);
    }
    expect(harness.room.traffic.violations).toEqual([]);
  });
});

describe('semantic contentFingerprint compatibility (NET-08)', () => {
  it('changes digest on same-count enemy reorder, replacement, and numeric stat/terrain edits while matching identical builds', async () => {
    const t = await create();
    const base = structuredClone(t.content);
    const clone = structuredClone(base);
    const fpBase = contentFingerprint(base, FIXTURE_ZONE_ID);
    expect(fpBase).toBe(contentFingerprint(clone, FIXTURE_ZONE_ID));

    // Same-count swap of two enemies MUST change the fingerprint.
    const swapped = structuredClone(base);
    const [e0, e1] = [swapped.enemies[0]!, swapped.enemies[1]!];
    swapped.enemies[0] = e1;
    swapped.enemies[1] = e0;
    expect(swapped.enemies.length).toBe(base.enemies.length);
    expect(contentFingerprint(swapped, FIXTURE_ZONE_ID)).not.toBe(fpBase);

    // Same-count ID replacement MUST change the fingerprint.
    const replaced = structuredClone(base);
    replaced.enemies[0] = { ...replaced.enemies[0]!, id: 'mutant_wolf' };
    expect(contentFingerprint(replaced, FIXTURE_ZONE_ID)).not.toBe(fpBase);

    // Numeric gameplay/prediction field changes MUST change the fingerprint.
    const radiusChanged = structuredClone(base);
    radiusChanged.enemies[0]!.radius += 0.25;
    expect(contentFingerprint(radiusChanged, FIXTURE_ZONE_ID)).not.toBe(fpBase);

    const speedChanged = structuredClone(base);
    speedChanged.enemies[0]!.speed += 1;
    expect(contentFingerprint(speedChanged, FIXTURE_ZONE_ID)).not.toBe(fpBase);

    const skillChanged = structuredClone(base);
    skillChanged.skills[0]!.params.damage += 5;
    expect(contentFingerprint(skillChanged, FIXTURE_ZONE_ID)).not.toBe(fpBase);

    const zoneChanged = structuredClone(base);
    zoneChanged.zones[0]!.biome.seed += 1;
    expect(contentFingerprint(zoneChanged, FIXTURE_ZONE_ID)).not.toBe(fpBase);

    // End-to-end: host init with swapped-enemy digest disconnects the guest with contentMismatch.
    const guest = t.guests[0] as CoopGuest;
    run(20);
    expect(guest.error).toBeNull();
    expect(guest.phase).toBe('running');
    t.transports[0]!.event(EV.init, { v: SYNC_VERSION, fp: contentFingerprint(swapped, FIXTURE_ZONE_ID) }, { to: t.transports[1]!.slot as 0 | 1 | 2 | 3 });
    await t.settle(100);
    expect(guest.error).toBe('contentMismatch');
    expect(guest.phase).toBe('disconnected');
  });
});

describe('bounded deferred event backlog on hidden guests (NET-09)', () => {
  it('bounds deferred event blocks and bytes across 200+ snapshots without guest ticks and resumes cleanly', async () => {
    const t = await create({ enemies: 25, skills: true, tough: true });
    const hw = t.hostWorld;
    const mw = t.guestWorlds[0]!;
    const guest = t.guests[0] as CoopGuest;
    const deferredOf = (): readonly { count: number; bytes: Uint8Array; time: number }[] =>
      (guest as unknown as { deferred: { count: number; bytes: Uint8Array; time: number }[] }).deferred;

    // Start normally so both sides are running.
    run(60, { x: 0.4, z: 0.2 }, { x: -0.2, z: 0.4 });
    expect(guest.phase).toBe('running');

    // Simulate a hidden/backgrounded guest tab: host and network run while guest.tick() is NEVER called.
    // Every 4 host ticks emits 1 snapshot, so 920 host ticks -> ~230 snapshots!
    const snapsBefore = guest.stats.snapshots;
    let maxDeferredBlocks = 0;
    let maxDeferredBytes = 0;
    for (let i = 0; i < 920; i++) {
      t.net.advance(1000 / 60);
      hw.step([{ moveX: 0.2, moveZ: 0 }]);
      const deferred = deferredOf();
      const curBlocks = deferred.length;
      const curBytes = deferred.reduce((acc, d) => acc + d.bytes.byteLength, 0);
      if (curBlocks > maxDeferredBlocks) maxDeferredBlocks = curBlocks;
      if (curBytes > maxDeferredBytes) maxDeferredBytes = curBytes;
      expect(curBlocks).toBeLessThanOrEqual(DEFERRED_MAX_BLOCKS);
      expect(curBytes).toBeLessThanOrEqual(DEFERRED_MAX_BYTES);
    }

    expect(guest.stats.snapshots - snapsBefore).toBeGreaterThanOrEqual(200);
    expect(maxDeferredBlocks).toBe(DEFERRED_MAX_BLOCKS);
    expect(maxDeferredBytes).toBeGreaterThan(0);
    expect(guest.stats.droppedEvents).toBeGreaterThan(0);

    // Resume foreground ticks: deferred backlog drains cleanly and HUD/time catch up without error.
    const keyframesBefore = guest.stats.keyframes;
    run(120, { x: 0, z: 0 }, { x: 0, z: 0 });
    expect(deferredOf().length).toBe(0);
    expect(guest.stats.decodeErrors).toBe(0);
    expect(guest.stats.keyframes).toBeGreaterThan(keyframesBefore);
    expect(Math.abs(mw.time - hw.time)).toBeLessThan(0.5);
  });
});

describe('SIM-06 & SIM-11 co-op event codec roundtrip', () => {
  it('preserves SkillCastEvent.noHeroAnim and VfxEvent.player with guest player-index remapping', () => {
    const strings = new WireStrings();
    const col = new EventCollector(strings);
    const hostBus = new EventBus();

    // Host index 0 (host) -> guest local index 1; host index 1 (guest) -> guest local index 0.
    hostBus.skillCast(1, 2, 'shadow_clone', 'meleeArc', 4.5, -3.25, 1, 0, 2.5, true, 'slash', true);
    hostBus.skillCast(0, 0, 'basic_slash', 'meleeArc', 1, 1, 0, 1, 1.8, false, 'slash', false);
    hostBus.skillCast(1, 3, 'mimic_bolt', 'projectile', 2, 2, 0, -1, 1.2, false, '', true);
    // Bound hero VFX (e.g. Eagle Eye persistent buff indicator) + bound vfxLine + unbound VFX (-1).
    hostBus.vfx('eagle_eye_buff', 3.5, 4.5, 0, 1, 1.5, 5.0, 2, 0x00ff88, 1);
    hostBus.vfxLine('chain_arc', 1.0, 2.0, 5.0, 6.0, 1.0, 0.4, 3, -1, 0);
    hostBus.vfx('ambient_spark', -2.0, 3.0, 1, 0, 1.0, 0.5, 0, -1, -1);

    col.collect(hostBus.list);
    const block = col.flush();
    expect(block.count).toBe(6);

    const guestBus = new EventBus();
    const remapHostToGuest = (hostIdx: number): number => (hostIdx === 1 ? 0 : hostIdx === 0 ? 1 : hostIdx);
    decodeEvents(new ByteReader(block.bytes), block.count, {
      bus: guestBus,
      player: remapHostToGuest,
      enemy: () => 0,
      str: (i) => strings.names[i] ?? '',
    });

    const casts = guestBus.list.filter((e) => e.t === 'skillCast');
    expect(casts).toHaveLength(3);
    expect(casts[0]).toMatchObject({ player: 0, skillId: 'shadow_clone', awakened: true, noHeroAnim: true });
    expect(casts[1]).toMatchObject({ player: 1, skillId: 'basic_slash', awakened: false, noHeroAnim: false });
    expect(casts[2]).toMatchObject({ player: 0, skillId: 'mimic_bolt', awakened: false, noHeroAnim: true });

    const vfx = guestBus.list.filter((e) => e.t === 'vfx');
    expect(vfx).toHaveLength(3);
    const eagle = vfx.find((e) => e.preset === 'eagle_eye_buff');
    const chain = vfx.find((e) => e.preset === 'chain_arc');
    const spark = vfx.find((e) => e.preset === 'ambient_spark');
    expect(eagle).toMatchObject({ player: 0, hasTarget: false }); // host 1 remapped to guest local 0
    expect(chain).toMatchObject({ player: 1, hasTarget: true }); // host 0 remapped to guest local 1
    expect(spark).toMatchObject({ player: -1, hasTarget: false }); // unbound stays -1
  });
});

describe('host abandon from pause & seamless lobby rematch handoff', () => {
  it('clears hostPaused on both host and guest when the host abandons while paused', async () => {
    const t = await create();
    const g = t.guests[0] as CoopGuest;
    run(60);
    t.host.setHostPaused(true);
    run(20);
    expect(t.host.status().hostPaused).toBe(true);
    expect(g.status().hostPaused).toBe(true);

    // Host abandons directly from pause menu: finish() must clear hostPaused before finalizing.
    t.host.dispose();
    run(30);
    await t.settle(100);
    expect(t.host.status().hostPaused).toBe(false);
    expect(g.status().hostPaused).toBe(false);
    expect(t.guestWorlds[0]?.over).toBe(true);
  });

  it('retains open room seats across run teardown when returning to lobby and launches a second match cleanly', async () => {
    const t = await create({ guests: 1 });
    run(60);
    // Finish match 1 cleanly (room returns to lobby phase).
    t.host.dispose();
    run(30);
    await t.settle(100);
    expect(t.room.phase).toBe('lobby');

    // Both clients choose "Back to Lobby": retainForLobby() keeps their open sockets without leaving or migrating host.
    t.runs[0]?.retainForLobby?.();
    t.runs[1]?.retainForLobby?.();
    t.runs[0]?.abort();
    t.runs[1]?.abort();
    await t.settle(100);

    expect(t.transports[0]?.isOpen).toBe(true);
    expect(t.transports[1]?.isOpen).toBe(true);
    expect(t.room.host).toBe(0);
    expect(t.sessions[0]?.reclaim()).toBe(true);
    expect(t.sessions[1]?.reclaim()).toBe(true);

    // Reclaimed CoopLobby calls connect() and gets immediate hello with original seats intact.
    const h0 = await t.sessions[0]!.connect();
    const h1 = await t.sessions[1]!.connect();
    expect(h0).toMatchObject({ slot: 0, host: 0, phase: 'lobby' });
    expect(h1).toMatchObject({ slot: 1, host: 0, phase: 'lobby' });
    expect(t.sessions[0]?.isHost).toBe(true);

    // Match 2 starts cleanly on the same room.
    t.sessions[1]?.join(t.transports[1]!.players[1]!.loadout!, true);
    await t.settle(100);
    expect(t.sessions[0]?.start(FIXTURE_ZONE_ID as never, 'normal', 2026)).toBe(true);
    await t.settle(100);
    expect(t.room.phase).toBe('running');
  });
});
