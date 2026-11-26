// Run events (RS-02a, redo): ONE set piece per run (Metin Rain, Champion Hunt, Golden Hour, the Sky Sovereign's Bargain), picked at
// createWorld from `runEvents.zones[zone]`, scheduled inside `runEvents.window` and kept `bossGap` seconds away from every boss
// spawn (the whole stretch from the announcement to the planned end when the kind knows its `span`, else just the start). This file is the FRAMEWORK: the schedule, the phases (announce -> active -> end), the 'runEvent' SimEvents and the HUD
// view. The kinds themselves are entries of a registry (`registerRunEventKind`); each work package adds its own (Metin Rain: RS-02b,
// Champion Hunt: RS-03, Golden Hour: EV-01, the Sky Sovereign's Bargain shrine: EV-02a, at the end of this file).
//
// Rules the kinds live by:
//   * a zone without events (`zones: {}`, the shipped content) draws NO random number and does nothing at all;
//   * every random draw goes through `w.rng.spawn`; every spawn position through `placeWalkable` (spawner.ts);
//   * the state is host-authoritative. It reaches co-op guests as mirrored 'runEvent' events (net/coop/events.ts) carrying ABSOLUTE
//     sim times, so a guest derives the timer from its mirrored clock; while the event is up the sim re-emits its state every
//     RUN_EVENT_HEARTBEAT seconds so a guest that joins (or resyncs) mid-event shows it within that time. An event that MOVES (a kind
//     changes `run.x` / `run.z`) is re-emitted as soon as it is RUN_EVENT_MOVE_DIST away from the last emitted spot (at most
//     2 Hz), so a guest HUD pointer follows it instead of jumping every 5 s; `refreshRunEvent` makes the next tick re-emit (the host
//     calls it when a guest (re)joins).
//
// Event times. `startAt` = the sim second the event becomes ACTIVE (the scheduled start, what the window and bossGap apply to);
// the announce phase begins `announce` seconds earlier (5 s). `endAt` = the end of the active phase: planned (startAt + duration)
// while the event runs, the real moment once it ended (a kind may end early). The 'end' phase then lingers RUN_EVENT_LINGER s.

import type { MetinDef } from '../data/schema';
import { openBargain, tickBargainPace } from './cards';
import { DT } from './constants';
import { zoneEventKinds } from './content';
import { spawnEnemy } from './enemies';
import { METIN_WARN_TIME, fallSiteClear, findMetin, footprintClear, nearestFallSite, startFalling } from './metins';
import { dropEventChest } from './pickups';
import type { Rng } from './rng';
import { despawnEnemy, pickBandCreature, pickBandElite, placeWalkable, type Pos } from './spawner';
import { EnemyFlag, EnemyState, type PlayerState } from './stores';
import { MetinPhase, type HudRunEvent } from './types';
import type { World } from './world';

export type RunEventPhase = 'announce' | 'active' | 'end' | 'channel';

/** seconds between the announcement and the start (a kind may override it with `announce`) */
export const RUN_EVENT_ANNOUNCE = 5;
/** seconds the 'end' phase stays on the HUD */
export const RUN_EVENT_LINGER = 3;
/** seconds between two re-emissions of a running event's state (late joiners, resyncs) */
export const RUN_EVENT_HEARTBEAT = 5;
/** at most this many 'channel' events per second and hero */
export const RUN_EVENT_CHANNEL_HZ = 4;
/** a HUD view whose phase ended this long ago without a following event is dropped (a lost or late 'end') */
export const RUN_EVENT_STALE = 2;
/** a moving event is re-emitted once it is this far (m) from the last emitted spot ... */
export const RUN_EVENT_MOVE_DIST = 3;
/** ... and at least this many seconds after the last emission (so at most 2 Hz) */
export const RUN_EVENT_MOVE_GAP = 0.5;
/**
 * a guest view of a running event (announce / active) that no 'runEvent' has refreshed for RUN_EVENT_HEARTBEAT + this many seconds of
 * MIRRORED time (host sim time of the frame that carried it) is dropped: the host re-emits every RUN_EVENT_HEARTBEAT s while the event is up, so a live event is always refreshed
 * in time (a modal pause freezes both clocks), whereas a guest that was away while the event ended (its 'end' and the linger fell into
 * the gap) must not keep counting down to the PLANNED end.
 */
export const RUN_EVENT_REFRESH_GRACE = 1.5;

/** how the active phase ended */
export type RunEventEndReason = 'resolved' | 'time' | 'runEnd';

/** the lifecycle of the run's event; `pending` = scheduled, nothing announced yet; `done` = over */
export type RunEventStage = 'pending' | 'announce' | 'active' | 'end' | 'done';

/** the event of this run (`World.runEvent`; null = the run has none) */
export interface RunEventRun {
  /** 1-based, unique within the run (persistent handles of the vfx are keyed by it) */
  readonly id: number;
  /** registry key / runEvents.json kind id */
  readonly kind: string;
  /** sim second the announce begins */
  readonly announceAt: number;
  /** the scheduled start: the sim second the active phase begins */
  readonly startAt: number;
  /** end of the active phase: planned, then the real moment once the event ended */
  endAt: number;
  stage: RunEventStage;
  /** where it happens (set by the kind's `place` at the announce; default = the first living hero) */
  x: number;
  z: number;
  /** a kind sets it to report a failed event: the 'end' event then carries p = 0 (1 otherwise) */
  failed: boolean;
  /** sim second of the last state emission (the heartbeat clock) and where the event was then (the move rule) */
  lastEmit: number;
  emitX: number;
  emitZ: number;
  /** shrine channel progress 0..1 per hero (`setRunEventChannel`) and the time of its last emission */
  readonly channel: number[];
  readonly channelAt: number[];
  /** private scratch of the kind (spawned handles, counters ...) */
  readonly data: Record<string, unknown>;
}

/** one run-event kind; the framework calls the hooks, the kind does the gameplay */
export interface RunEventKindDef {
  /** seconds between the announcement and the start (default RUN_EVENT_ANNOUNCE) */
  announce?: number;
  /**
   * planned length of the active phase in seconds when it is known at the PICK (before the event exists: it may depend on the world
   * and the content only). With it the schedule keeps the whole stretch [announce, start + span] `bossGap` seconds away from every boss
   * spawn, not just the start; without it only the start (and its announce) is kept clear. A span that fits nowhere in the window
   * falls back to the plain start gap. Costs no random draw.
   */
  span?(w: World): number;
  /** length of the active phase, s (called once, when the announce begins) */
  duration(w: World, run: RunEventRun): number;
  /** the announce begins: set `run.x` / `run.z` (default: the position of the first living hero) */
  place?(w: World, run: RunEventRun): void;
  /** the active phase begins */
  onStart?(w: World, run: RunEventRun): void;
  /** every tick of the active phase, before the end checks */
  onTick?(w: World, run: RunEventRun): void;
  /** true = the event resolved before its time ran out */
  isDone?(w: World, run: RunEventRun): boolean;
  /** the active phase ended: undo whatever the kind did (mods, markers); set `run.failed` for a failed event. Not called when the event never became active */
  onEnd?(w: World, run: RunEventRun, reason: RunEventEndReason): void;
}

const KINDS = new Map<string, RunEventKindDef>();

/** add (or replace) a kind; the content may list it in `runEvents.zones` from then on (kinds nobody registered are ignored) */
export function registerRunEventKind(id: string, def: RunEventKindDef): void {
  KINDS.set(id, def);
}

/** remove a kind (tests that registered a stand-in) */
export function unregisterRunEventKind(id: string): void {
  KINDS.delete(id);
}

export function runEventKindDef(id: string): RunEventKindDef | undefined {
  return KINDS.get(id);
}

// ---- schedule ------------------------------------------------------------------------------------------------------------

/**
 * The seconds of [lo, hi] an event may START at, as [from, to] spans in ascending order: the event's whole stretch [start - lead,
 * start + span] stays at least `gap` seconds away from every boss spawn (`lead` = the announce, `span` = the planned active length;
 * both 0 = just the start is kept `gap` away).
 */
export function startSpans(lo: number, hi: number, gap: number, bossTimes: readonly number[], span = 0, lead = 0): [number, number][] {
  if (gap <= 0) return lo <= hi ? [[lo, hi]] : [];
  const spans: [number, number][] = [];
  let cursor = lo;
  for (const bt of [...bossTimes].sort((a, b) => a - b)) {
    const from = bt - gap - Math.max(0, span);
    const to = bt + gap + Math.max(0, lead);
    if (to <= cursor) continue;
    if (from >= cursor) spans.push([cursor, Math.min(from, hi)]);
    if (to > cursor) cursor = to;
    if (cursor > hi) break;
  }
  if (cursor <= hi) spans.push([cursor, hi]);
  return spans;
}

/** one uniform pick over the spans (exactly one draw of `rng`) */
function pickStart(rng: Rng, spans: readonly [number, number][]): number {
  let total = 0;
  for (const [a, b] of spans) total += b - a;
  let u = rng.next() * total;
  for (const [a, b] of spans) {
    if (u < b - a) return a + u;
    u -= b - a;
  }
  const last = spans[spans.length - 1] as [number, number];
  return total > 0 ? last[1] : last[0];
}

/**
 * Called once by the World constructor. Null (and NO random draw) unless `runEvents.zones[zone]` lists a registered kind and
 * the window has a second that is `bossGap` away from every boss spawn. Otherwise two draws of `w.rng.spawn`: the kind, the start.
 * The start keeps the kind's whole stretch (announce .. start + `span`) clear of the bosses; when that fits nowhere in the window the
 * plain start gap applies instead (an event next to a boss beats no event; the zone's window / timing is then a tuning matter).
 */
export function createRunEvent(w: World): RunEventRun | null {
  const kinds = zoneEventKinds(w.ix, w.zone.id).filter((k) => KINDS.has(k));
  if (kinds.length === 0) return null;
  const cfg = w.ix.runEvents;
  const bossTimes = [...w.zone.bosses.map((b) => b.at), w.zone.final.at];
  const leadOf = (k: string): number => (KINDS.get(k) as RunEventKindDef).announce ?? RUN_EVENT_ANNOUNCE;
  // a kind can be scheduled when the window has a second its announce + start keep `bossGap` away from every boss; with none, nothing is drawn
  const usable = kinds.filter((k) => startSpans(cfg.window[0], cfg.window[1], cfg.bossGap, bossTimes, 0, leadOf(k)).length > 0);
  if (usable.length === 0) return null;
  const rng = w.rng.spawn;
  const kind = usable[rng.int(usable.length)] as string;
  const def = KINDS.get(kind) as RunEventKindDef;
  const lead = leadOf(kind);
  const length = def.span?.(w) ?? 0;
  const whole = length > 0 ? startSpans(cfg.window[0], cfg.window[1], cfg.bossGap, bossTimes, length, lead) : [];
  const spans = whole.length > 0 ? whole : startSpans(cfg.window[0], cfg.window[1], cfg.bossGap, bossTimes, 0, lead);
  const startAt = pickStart(rng, spans);
  return {
    id: 1,
    kind,
    announceAt: Math.max(0, startAt - lead),
    startAt,
    endAt: startAt,
    stage: 'pending',
    x: 0,
    z: 0,
    failed: false,
    lastEmit: -1e9,
    emitX: 0,
    emitZ: 0,
    channel: w.players.map(() => 0),
    channelAt: w.players.map(() => -1e9),
    data: {},
  };
}

/** the hero events are centred on by default: the first living one (no random draw), else hero 0 */
export function anchorHero(w: World): PlayerState {
  for (const p of w.players) if (p.alive) return p;
  return w.players[0] as PlayerState;
}

function runEnding(w: World): boolean {
  return w.over || w.endTimer >= 0;
}

function emit(w: World, s: RunEventRun, phase: RunEventPhase): void {
  s.lastEmit = w.time;
  s.emitX = s.x;
  s.emitZ = s.z;
  w.bus.runEvent(s.kind, phase, s.id, s.x, s.z, s.startAt, s.endAt, -1, phase === 'end' ? (s.failed ? 0 : 1) : 0);
}

/** the sim end of the run's event, once per tick (world.ts, after the spawner) */
export function updateRunEvent(w: World): void {
  // the Bargain's fury curse outlasts the shrine (and any event): the creatures spawned this tick get the faster pace (cards.ts, EV-02b)
  tickBargainPace(w);
  const s = w.runEvent;
  if (s === null || s.stage === 'done') return;
  const def = KINDS.get(s.kind);
  const t = w.time;
  for (let guard = 0; guard < 5; guard++) {
    switch (s.stage) {
      case 'pending': {
        if (t < s.announceAt) return;
        if (def === undefined || runEnding(w)) {
          s.stage = 'done';
          return;
        }
        s.stage = 'announce';
        const a = anchorHero(w);
        s.x = a.x;
        s.z = a.z;
        def.place?.(w, s);
        s.endAt = s.startAt + Math.max(0, def.duration(w, s));
        emit(w, s, 'announce');
        continue;
      }
      case 'announce':
        if (def === undefined || runEnding(w)) {
          finish(w, s, def, 'runEnd');
          continue;
        }
        if (t < s.startAt) {
          heartbeat(w, s, 'announce');
          return;
        }
        s.stage = 'active';
        def.onStart?.(w, s);
        emit(w, s, 'active');
        continue;
      case 'active':
        if (def === undefined || runEnding(w)) {
          finish(w, s, def, 'runEnd');
          continue;
        }
        def.onTick?.(w, s);
        if (def.isDone?.(w, s) === true) {
          finish(w, s, def, 'resolved');
          continue;
        }
        if (t >= s.endAt) {
          finish(w, s, def, 'time');
          continue;
        }
        // a kind that moved the event: tell the guests as soon as it is RUN_EVENT_MOVE_DIST away from the last emitted spot
        if (t - s.lastEmit >= RUN_EVENT_MOVE_GAP - 1e-9 && Math.hypot(s.x - s.emitX, s.z - s.emitZ) >= RUN_EVENT_MOVE_DIST) emit(w, s, 'active');
        else heartbeat(w, s, 'active');
        return;
      case 'end':
        if (t < s.endAt + RUN_EVENT_LINGER) {
          heartbeat(w, s, 'end');
          return;
        }
        s.stage = 'done';
        return;
      default:
        return;
    }
  }
}

function heartbeat(w: World, s: RunEventRun, phase: RunEventPhase): void {
  if (w.time - s.lastEmit >= RUN_EVENT_HEARTBEAT - 1e-9) emit(w, s, phase);
}

/**
 * Re-emit the run's event on the next tick instead of waiting for the heartbeat. The host calls it when a guest joins, resyncs or
 * reconnects (net/coop/host.ts, where it requests the keyframe), so the guest HUD shows a running event within a frame, not within 5 s.
 * Nothing to refresh before the announce and after the end: a no-op there (and in a run without an event).
 */
export function refreshRunEvent(w: World): void {
  const s = w.runEvent;
  if (s !== null && (s.stage === 'announce' || s.stage === 'active' || s.stage === 'end')) s.lastEmit = -1e9;
}

function finish(w: World, s: RunEventRun, def: RunEventKindDef | undefined, reason: RunEventEndReason): void {
  const wasActive = s.stage === 'active';
  // an event that never became active (the run ended during the announcement) counts as failed
  if (!wasActive) s.failed = true;
  s.stage = 'end';
  s.endAt = w.time;
  if (wasActive) def?.onEnd?.(w, s, reason);
  for (let i = 0; i < s.channel.length; i++) {
    if ((s.channel[i] as number) > 0) {
      s.channel[i] = 0;
      w.bus.runEvent(s.kind, 'channel', s.id, s.x, s.z, s.startAt, s.endAt, i, 0);
    }
  }
  emit(w, s, 'end');
}

// ---- channel (the Sky Sovereign's shrine, EV-02a) ---------------------------------------------------------------------------

/**
 * Record hero `player`'s channel progress (0..1; 0 = not channelling). Emits a 'channel' runEvent {player, p} at most
 * RUN_EVENT_CHANNEL_HZ times a second per hero; a drop to 0 and a completed channel (p = 1) are always sent, once.
 * No-op while the run has no announced event.
 */
export function setRunEventChannel(w: World, player: number, p: number): void {
  const s = w.runEvent;
  if (s === null || (s.stage !== 'announce' && s.stage !== 'active')) return;
  const v = Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0;
  const prev = s.channel[player];
  if (prev === undefined) return;
  s.channel[player] = v;
  if (v === 0 && prev === 0) return;
  const t = w.time;
  const force = (v === 0 && prev > 0) || (v >= 1 && prev < 1);
  if (!force && t - (s.channelAt[player] as number) < 1 / RUN_EVENT_CHANNEL_HZ - 1e-9) return;
  s.channelAt[player] = t;
  w.bus.runEvent(s.kind, 'channel', s.id, s.x, s.z, s.startAt, s.endAt, player, v);
}

// ---- HUD ---------------------------------------------------------------------------------------------------------------------

/** the part of a run event the HUD needs: what the host reads from its sim and a guest keeps from the last mirrored event */
export interface RunEventView {
  kind: string;
  phase: 'announce' | 'active' | 'end';
  x: number;
  z: number;
  startAt: number;
  endAt: number;
}

/** seconds until the phase ends, from the absolute times of the event (>= 0) */
export function runEventLeft(phase: RunEventView['phase'], startAt: number, endAt: number, now: number): number {
  const end = phase === 'announce' ? startAt : phase === 'active' ? endAt : endAt + RUN_EVENT_LINGER;
  return Math.max(0, end - now);
}

/**
 * HudSnapshot.runEvent of a view at sim time `now`; null once its phase ended RUN_EVENT_STALE s ago without a following event.
 * `seenAt` (guests only) = the host sim time of the snapshot frame that carried the last 'runEvent' refreshing the view: an announce / active view that
 * nothing has refreshed for RUN_EVENT_HEARTBEAT + RUN_EVENT_REFRESH_GRACE s is a ghost (the 'end' was lost while the guest was away)
 * and is dropped; the next heartbeat of a running event brings it back. The host reads its sim directly and passes no `seenAt`.
 */
export function runEventHudOf(v: RunEventView, now: number, seenAt?: number): HudRunEvent | null {
  const left = runEventLeft(v.phase, v.startAt, v.endAt, now);
  const end = v.phase === 'announce' ? v.startAt : v.phase === 'active' ? v.endAt : v.endAt + RUN_EVENT_LINGER;
  if (now > end + RUN_EVENT_STALE) return null;
  if (seenAt !== undefined && v.phase !== 'end' && now - seenAt > RUN_EVENT_HEARTBEAT + RUN_EVENT_REFRESH_GRACE) return null;
  return { kind: v.kind, phase: v.phase, left, x: v.x, z: v.z };
}

/** HudSnapshot.runEvent on the host: null while nothing is announced, active or lingering */
export function runEventHud(w: World): HudRunEvent | null {
  const s = w.runEvent;
  if (s === null || (s.stage !== 'announce' && s.stage !== 'active' && s.stage !== 'end')) return null;
  return runEventHudOf({ kind: s.kind, phase: s.stage, x: s.x, z: s.z, startAt: s.startAt, endAt: s.endAt }, w.time);
}

/** HudSnapshot.channel of hero `player` on the host: its progress while it channels, else undefined */
export function runEventChannelOf(w: World, player: number): number | undefined {
  const v = w.runEvent?.channel[player];
  return v !== undefined && v > 0 ? v : undefined;
}

// ---- kind: Metin Rain (RS-02b, second attempt) ---------------------------------------------------------------------------------
//
// R4 (2/4): letting a metin awaken is the one optional risk of a run and is rarely engaged; a rain of stones is a set piece that pushes it.
// At the start of the active phase `count` stones of the zone's own list fall round the hero within `within` s: stone k is called
// `k * (within - METIN_WARN_TIME) / (count - 1)` s after the start, so the last one LANDS `within` s after it (each stone still opens its
// own 2.6 s warning circle: `startFalling`, the same call as the natural fall). The corruption meter jumps by `corruption` once, in total,
// with the first stone. The ring is `ringRadius` m round the hero (+- RAIN_BAND), every point through `placeWalkable` and, like the natural
// fall, a CLEAR fall site (`fallSiteClear`: footprint, props, rune carpet); in co-op the stones go round the living heroes in turn.
// From then on the stones are ordinary metins (essence, yeop, xp, shards and a chest as usual) and the event ENDS when every stone has
// broken or awakened ('resolved'); a stone nobody breaks awakens by itself, so the planned end (what the HUD counts down to) is the
// latest awakening, and `span` (the whole unbroken rain) keeps the rain clear of every boss spawn, not only its start. The natural
// schedule keeps its cap of 3 standing ordinary stones and so waits while the rain stands; the rain itself is not capped.
//
// What the second attempt changed (the critics of attempt 1, then the gate on the current tree):
//   * UNSTABLE stones: they awaken after RAIN_FUSE x the usual time (`startFalling`'s `fuse`). A late rain met a hero who broke all three
//     stones well inside the old 90 s fuse (26 % of the rains after 570 s ended in an awakening against 58 % of the early ones, so the
//     "pushes awakening" part of T9 held only by the start mix). Gate (events --pair, 200 runs per arm): at fuse 1 the awakenings per run
//     shift by -0.09 [-0.48, 0.29]; at 0.75 / 0.65 / 0.55 with two extra stones they shift by 0.03 / 0.31 / 0.67; shipped (0.55, three
//     extra stones, 400 runs per arm): +0.97 [0.66, 1.28], rains before 500 s +1.31, after it +1.22.
//   * CLEAR ground. Attempt 1's tests had no props, and a later edit of its site search nudged a blocked ring point by up to 8 m (on a
//     real map the stones then stood at 17.9 and 19.5 m, off the 11.9-16.1 m ring); the sites are searched on the ring itself now (random
//     tries that pass `fallSiteClear`, then the sweep of metins.ts `nearestFallSite` on the ring band, then wider): on the four real zones
//     every stone of the probe stood walkable, clear and inside the band.
//   * The whole stretch (announce .. unbroken end) keeps `bossGap` from every boss (RunEventKindDef.span).
//   * NOT done, with the numbers: the rain adds its three stones to the run (the spec's count), it does not stand in for ordinary ones.
//     Skipping all three ordinary falls round it (the stones of a run unchanged; tried before the rain, after it and split) keeps the
//     runs above the leaderboard's soft limit (floor(t / 60) + 2) at the level of the runs without a rain (32-34 of 200 against 37, the
//     tree's own runs are above it already) but costs the win rate 3 to 7 points at every fuse: the rain's three stones at once cost the
//     hero more than the awakenings and the extra stones are what pays for the risk. Skipping one (two extra stones) left 69 of 200 runs
//     above the limit and the win rate at -3.5 / 0 (fuse 0.55 / 0.65); three extra stones (shipped) 143 of 400 (71 without the rain) and
//     +0.06 [-0.01, 0.13].
//     The soft limit has to move with the rain: PLAUS-1 / PLAUS-2 raise metinsSoft by 3 when events ship.
// Draws: the types at the announce (without repeats while the zone list has enough of them) and the `placeWalkable` calls of the site
// search at each fall, all `w.rng.spawn`; the metin, loot, boss and cards streams are never touched by the event itself.

/** a stone keeps this far from every other standing or falling stone (the natural fall's rule, metins.ts pickFallSite) */
const RAIN_SEP = 10;
/** ... and this far from every living hero when the ground allows it (the impact circle is 4.2 m + the hero's radius) */
const RAIN_HERO_GAP = 7;
/** ... and this far inside the arena rim when the ground allows it (the natural fall's limit) */
const RAIN_RIM = 8;
/** `placeWalkable` calls per stone before the deterministic sweep takes over */
const RAIN_TRIES = 6;
/** the ring is `ringRadius` +- this share */
const RAIN_BAND = 0.15;
/** the widest sweep for a clear site, m round the hero (from every walkable spot of the four zones a clear site lies within 45 m, world/metinSites.test.ts) */
const RAIN_FAR = 45;
/** the rain stones awaken after this share of the usual time (90 s -> about 50 s): the redo's push, see the header */
export const RAIN_FUSE = 0.55;
/** the planned active phase never exceeds this, s */
const RAIN_MAX_ACTIVE = 240;
/** slack after the latest awakening, s (the end is normally the stones' own resolution, earlier) */
const RAIN_TAIL = 2;

/** `RunEventRun.data.rain`: the stones of this event */
interface RainData {
  /** the type of each stone, picked at the announce */
  defs: MetinDef[];
  /** seconds after the activation each stone is called */
  at: number[];
  /** ids of the stones that were called (`MetinState.id`) */
  ids: number[];
  /** how many stones were called (placed or skipped) */
  called: number;
  /** the corruption rise was paid (with the first stone that found a site) */
  rose: boolean;
  /** sim second of the activation */
  t0: number;
}

function rainOf(w: World, run: RunEventRun): RainData {
  const have = run.data['rain'] as RainData | undefined;
  if (have !== undefined) return have;
  const cfg = w.ix.runEvents.kinds.metinRain;
  const types = w.zone.metins.types;
  const rng = w.rng.spawn;
  const defs: MetinDef[] = [];
  let pool: string[] = [];
  for (let k = 0; k < (types.length > 0 ? cfg.count : 0); k++) {
    if (pool.length === 0) pool = [...types];
    const def = w.ix.metins.get(pool.splice(rng.int(pool.length), 1)[0] as string);
    if (def !== undefined) defs.push(def);
  }
  // the last stone lands `within` s after the start, so it is called METIN_WARN_TIME earlier
  const span = Math.max(0, cfg.within - METIN_WARN_TIME);
  const made: RainData = { defs, at: defs.map((_, k) => (defs.length > 1 ? (span * k) / (defs.length - 1) : 0)), ids: [], called: 0, rose: false, t0: 0 };
  run.data['rain'] = made;
  return made;
}

const rainPos: Pos = { x: 0, z: 0 };
const rainBest: Pos = { x: 0, z: 0 };

/**
 * A clear fall site for one stone on the ring round `hero`. First up to RAIN_TRIES `placeWalkable` points (random, `w.rng.spawn`) that
 * pass `fallSiteClear`: the first that keeps its distance from the other stones / the heroes / the rim wins, else the one that comes
 * closest to that. When none of them is clear (a village square, a forest edge, a bank) the deterministic sweep of metins.ts
 * (`nearestFallSite`, no draw) takes the nearest clear site on the ring band, then anywhere RAIN_HERO_GAP .. RAIN_FAR m round the hero,
 * so a stone lands as close to its ring as the ground lets it instead of being nudged off a blocked point. False = no clear site
 * anywhere round the hero (not even walkable ground: the hero stands in lava), so the stone is skipped.
 */
export function rainSite(w: World, hero: PlayerState, ringRadius: number, out: Pos): boolean {
  const lo = ringRadius * (1 - RAIN_BAND);
  const hi = ringRadius * (1 + RAIN_BAND);
  const limit = w.arenaRadius - RAIN_RIM;
  let best = -1;
  for (let attempt = 0; attempt < RAIN_TRIES; attempt++) {
    if (!placeWalkable(w, hero.x, hero.z, lo, hi, rainPos)) break;
    if (!fallSiteClear(w, rainPos.x, rainPos.z)) continue;
    let sep = Infinity;
    for (const m of w.metins) if (m.phase !== MetinPhase.Broken) sep = Math.min(sep, Math.hypot(m.x - rainPos.x, m.z - rainPos.z));
    let gap = Infinity;
    for (const p of w.players) if (p.alive) gap = Math.min(gap, Math.hypot(p.x - rainPos.x, p.z - rainPos.z));
    const score = Math.min(sep / RAIN_SEP, gap / RAIN_HERO_GAP, Math.hypot(rainPos.x, rainPos.z) <= limit ? 1 : 0.5);
    if (score > best) {
      best = score;
      rainBest.x = rainPos.x;
      rainBest.z = rainPos.z;
    }
    if (score >= 1) break;
  }
  if (best >= 0) {
    out.x = rainBest.x;
    out.z = rainBest.z;
    return true;
  }
  const away = (x: number, z: number): boolean => w.players.every((p) => !p.alive || Math.hypot(p.x - x, p.z - z) >= RAIN_HERO_GAP);
  return (
    nearestFallSite(w, hero.x, hero.z, lo, hi, limit, RAIN_SEP / 2, out, away) ||
    nearestFallSite(w, hero.x, hero.z, RAIN_HERO_GAP, Math.max(RAIN_FAR, hi), limit, RAIN_SEP / 2, out, away)
  );
}

/** call stone `k`: the heroes that live take the stones in turn, the first living one first */
function callStone(w: World, d: RainData, k: number, ringRadius: number): void {
  const alive = w.players.filter((p) => p.alive);
  const hero = alive.length > 0 ? (alive[k % alive.length] as PlayerState) : anchorHero(w);
  const at: Pos = { x: 0, z: 0 };
  if (!rainSite(w, hero, ringRadius, at)) return;
  d.ids.push(startFalling(w, d.defs[k] as MetinDef, at.x, at.z, false, RAIN_FUSE).id);
  if (!d.rose) {
    d.rose = true;
    w.corruption = Math.min(1, w.corruption + w.ix.runEvents.kinds.metinRain.corruption);
    if (w.corruption > w.maxCorruption) w.maxCorruption = w.corruption;
  }
}

registerRunEventKind('metinRain', {
  span(w) {
    const cfg = w.ix.runEvents.kinds.metinRain;
    let slowest = 0;
    for (const id of w.zone.metins.types) slowest = Math.max(slowest, w.ix.metins.get(id)?.awakenAfter ?? 0);
    return slowest <= 0 ? 0 : Math.min(RAIN_MAX_ACTIVE, Math.max(cfg.within, METIN_WARN_TIME) + slowest * w.mods.awaken * RAIN_FUSE + RAIN_TAIL);
  },
  duration(w, run) {
    const d = rainOf(w, run);
    let end = 0;
    for (let k = 0; k < d.defs.length; k++) end = Math.max(end, (d.at[k] as number) + METIN_WARN_TIME + (d.defs[k] as MetinDef).awakenAfter * w.mods.awaken * RAIN_FUSE);
    return d.defs.length === 0 ? 0 : Math.min(RAIN_MAX_ACTIVE, end + RAIN_TAIL);
  },
  onStart(w, run) {
    const d = rainOf(w, run);
    d.t0 = w.time;
    // the event is "round the hero" where the hero stands now (HUD / vfx read it from the 'active' event)
    const a = anchorHero(w);
    run.x = a.x;
    run.z = a.z;
  },
  onTick(w, run) {
    const d = rainOf(w, run);
    const ring = w.ix.runEvents.kinds.metinRain.ringRadius;
    const since = w.time - d.t0;
    while (d.called < d.defs.length && since >= (d.at[d.called] as number) - 1e-9) {
      const k = d.called;
      d.called++;
      callStone(w, d, k, ring);
    }
  },
  isDone(w, run) {
    const d = run.data['rain'] as RainData | undefined;
    if (d === undefined || d.called < d.defs.length) return false;
    for (const id of d.ids) {
      const m = findMetin(w, id);
      if (m !== undefined && (m.phase === MetinPhase.Falling || m.phase === MetinPhase.Alive)) return false;
    }
    return true;
  },
  onEnd(_w, run) {
    const d = run.data['rain'] as RainData | undefined;
    // a rain that dropped no stone at all (no clear ground round the hero, a zone without stone types) failed
    if (d === undefined || d.ids.length === 0) run.failed = true;
  },
});

// ---- kind: Champion Hunt (RS-03, second attempt) -------------------------------------------------------------------------------
//
// R4 (2/4): a named, timed fight with a reward (the ordinary elite is only x3 HP and nobody hunts it). When the active phase starts, a
// band elite of the zone (the pool of the band running now, `pickBandElite`) stands up as the CHAMPION: tier 2, `hpMul` x HP, `dmgMul` x
// damage, a larger body (CHAMPION_SCALE) and the one row of the run flagged EnemyFlag.Leader (a bit nothing else sets or reads; it rides
// in the snapshot flags column, so co-op guests see it too): that is how it reads apart from the ordinary tier-2 pack leaders, whose
// ground ring is the same 'champion' style (its own red event ring is EV-03b's, keyed on the flag / `runEventChampion`). It stands on a
// `placeWalkable` point CHAMPION_RING_MIN..MAX m from one of the living heroes with `escorts` ordinary creatures of the band placed
// round it (`placeWalkable` again). The active phase is the hunt: `timeLimit` s.
//   * slain in time -> the event resolves ('resolved', end p = 1) and a free chest of `chestTier` drops where it fell (`dropEventChest`:
//                      creatures walk on lava, so a death spot in lava / deep water / a blocker moves to the nearest spawnable point
//                      first, and the pop slide never ends on blocked ground);
//   * not slain     -> at `timeLimit` it burrows away (`despawnEnemy`, quiet: it dissolves from an 'enemyDeath' with killer -1 and tier 0,
//                      so no death shake / boss smoke plays for a creature that LEFT; it is no kill: no loot, no xp) and the event ends
//                      failed (end p = 0). The escorts stay: they are ordinary creatures.
// A run that ends first ('runEnd') and a hunt that could not start (no hero alive at the start, a band without elites, no walkable
// ground, a full enemy store) end failed too, with no chest. Pause and modals stop the clock (the timer is sim time); a dead hero does
// not stop the hunt (a revive, or the other heroes of a co-op party, go on); the event's x / z follow the champion (the framework
// re-emits a moving event every RUN_EVENT_MOVE_DIST m, so a guest pointer follows it). HP is exactly an elite's: `type.hp x w.hpScale()
// x hpMul` with no party factor (elites have none either: a co-op party's extra damage is its advantage, the timer is the same).
//
// What the second attempt changed (the critics of attempt 1: A.run-sim r1 / r2, then the redo brief):
//   * The chest of a champion that fell in lava / deep water / a blocker was left there (creatures walk on lava): `dropEventChest`
//     moves it to the nearest dry ground first (pickups.ts, no random number).
//   * CO-OP: the hunt hero is DRAWN AT THE ANNOUNCE (`place`, the kind's own hook) among the living heroes, so the announce x / z (what a
//     HUD pointer / ground mark keyed on the event shows during the 5 s) is where the hunt will be, not always the host; at the start the
//     champion stands round that hero, or round the first living one when it fell in between (no further draw).
//   * `span`: the schedule keeps the WHOLE hunt (announce .. start + timeLimit) `bossGap` from every boss, not just the start: in attempt
//     1 half of the failed hunts were the few that ran into a boss spawn.
//   * The burrow is quiet (above). It used to play the tier-2 death shake and the boss-sized death smoke for a champion that fled.
//   * T9 for this kind. The hunt cannot shift the metins awakened per run (it never touches a stone: measured -0.26 .. +0.49 over four
//     seed lists, pooled about 0), so that part of T9 belongs to the Metin Rain; the hunt's gate is: fires in every run alive at the
//     start, win rate NI(10), metins awakened not worse (NI), kills/min inside the soft limits.
//   * NOT done, with the reason: the champion chases like any elite (the AI has no guard state, and ai.ts is not this WP's file); what
//     marks the hunt as a chosen fight is its red event ring (EV-03b, keyed on EnemyFlag.Leader / `runEventChampion`) and the 60 s
//     burrow, which costs nothing.
// Draws, all `w.rng.spawn`: the hero (only with two or more heroes alive), the type, then the `placeWalkable` search, the creature pick
// of each escort and the spawn variance of each row; the chest's pop is `w.rng.loot` like any pickup. None while off.

/** the champion stands this far (m) from the hero it was placed round (`placeWalkable` may pull it closer on hard ground, never farther) */
export const CHAMPION_RING_MIN = 8;
export const CHAMPION_RING_MAX = 12;
/** the escorts stand this far (m) from the champion */
const ESCORT_RING_MIN = 2.5;
const ESCORT_RING_MAX = 4.5;
/** body scale of the champion on top of its tier's (x1.12): large enough to be picked out of a pack at a glance */
export const CHAMPION_SCALE = 1.3;

/** `RunEventRun.data.champion`: the hunt of this event */
interface ChampionData {
  /** index in `World.players` of the hero the hunt goes to, drawn at the announce (-1 = not drawn yet) */
  hero: number;
  /** stable id of the champion row (`EnemyStore.find`); 0 = it never stood or is gone */
  id: number;
  /** enemy type id of the champion ('' = none) */
  type: string;
  /** stable ids of the escorts that stood */
  escorts: number[];
  /** last known position of the champion */
  x: number;
  z: number;
  /** the champion died before the time ran out (the chest dropped) */
  slain: boolean;
  /** sim second it fell (0 = not slain) */
  slainAt: number;
  /** where the chest dropped (null = none) */
  chestAt: Pos | null;
  /** the hunt cannot go on: it never started (no hero alive, no band elite, no walkable ground, store full) or the champion vanished */
  over: boolean;
}

function championOf(run: RunEventRun): ChampionData {
  const have = run.data['champion'] as ChampionData | undefined;
  if (have !== undefined) return have;
  const made: ChampionData = { hero: -1, id: 0, type: '', escorts: [], x: 0, z: 0, slain: false, slainAt: 0, chestAt: null, over: false };
  run.data['champion'] = made;
  return made;
}

/** stable enemy id of the run event's champion while it stands (0 = no hunt on, not started, or over); for renderers / HUD */
export function runEventChampion(w: World): number {
  const s = w.runEvent;
  if (s === null || s.kind !== 'championHunt' || s.stage !== 'active') return 0;
  const d = s.data['champion'] as ChampionData | undefined;
  if (d === undefined || d.id === 0 || d.slain) return 0;
  return w.enemies.find(d.id) >= 0 ? d.id : 0;
}

const champPos: Pos = { x: 0, z: 0 };
const escortPos: Pos = { x: 0, z: 0 };

/**
 * The hero the hunt goes to: the only living hero, else one of the living heroes drawn with `w.rng.spawn` (a co-op guest gets the
 * champion beside it as often as the host does). No draw with a single living hero, so a solo run is exactly as before.
 */
function huntHero(w: World): PlayerState {
  let alive = 0;
  for (const p of w.players) if (p.alive) alive++;
  if (alive <= 1) return anchorHero(w);
  let k = w.rng.spawn.int(alive);
  for (const p of w.players) if (p.alive && k-- === 0) return p;
  return anchorHero(w);
}

/** the hero drawn at the announce, or the first living one when it fell before the start (no draw) */
function huntTarget(w: World, d: ChampionData): PlayerState {
  const drawn = w.players[d.hero];
  return drawn !== undefined && drawn.alive ? drawn : anchorHero(w);
}

registerRunEventKind('championHunt', {
  span(w) {
    return w.ix.runEvents.kinds.championHunt.timeLimit;
  },
  duration(w) {
    return w.ix.runEvents.kinds.championHunt.timeLimit;
  },
  place(w, run) {
    const d = championOf(run);
    const hero = huntHero(w);
    d.hero = w.players.indexOf(hero);
    run.x = hero.x;
    run.z = hero.z;
  },
  onStart(w, run) {
    const d = championOf(run);
    const cfg = w.ix.runEvents.kinds.championHunt;
    const hero = huntTarget(w, d);
    const type = hero.alive ? pickBandElite(w) : -1;
    if (type < 0 || !placeWalkable(w, hero.x, hero.z, CHAMPION_RING_MIN, CHAMPION_RING_MAX, champPos)) {
      d.over = true;
      return;
    }
    const e = w.enemies;
    const row = spawnEnemy(w, type, champPos.x, champPos.z, { tier: 2, hpMul: cfg.hpMul, dmgMul: cfg.dmgMul, scaleMul: CHAMPION_SCALE, flags: EnemyFlag.Leader, source: 5 });
    if (row < 0) {
      d.over = true;
      return;
    }
    d.id = e.id[row] as number;
    d.type = w.typeDefs[type]?.id ?? '';
    d.x = run.x = champPos.x;
    d.z = run.z = champPos.z;
    for (let k = 0; k < cfg.escorts; k++) {
      const et = pickBandCreature(w);
      if (et < 0 || !placeWalkable(w, d.x, d.z, ESCORT_RING_MIN, ESCORT_RING_MAX, escortPos)) continue;
      const er = spawnEnemy(w, et, escortPos.x, escortPos.z, { source: 1 });
      if (er >= 0) d.escorts.push(e.id[er] as number);
    }
  },
  onTick(w, run) {
    const d = championOf(run);
    if (d.id === 0 || d.slain) return;
    const e = w.enemies;
    const row = e.find(d.id);
    if (row >= 0 && e.state[row] !== EnemyState.Dying) {
      // the event's position follows the champion (the framework re-emits it to the guests once it moved RUN_EVENT_MOVE_DIST)
      d.x = run.x = e.x[row] as number;
      d.z = run.z = e.z[row] as number;
      return;
    }
    if (row < 0) {
      // the row is gone without dying (nothing in the sim does that): no reward, the hunt is over
      d.id = 0;
      d.over = true;
      return;
    }
    // a Dying row = a kill this tick (the sweep comes after the event update)
    d.slain = true;
    d.slainAt = w.time;
    d.x = e.x[row] as number;
    d.z = e.z[row] as number;
    const chest = dropEventChest(w, d.x, d.z, w.ix.runEvents.kinds.championHunt.chestTier);
    // where the chest RESTS (a death spot in lava / deep water / a blocker moved to the nearest spawnable point)
    d.chestAt = chest >= 0 ? { x: w.pickups.x[chest] as number, z: w.pickups.z[chest] as number } : { x: d.x, z: d.z };
  },
  isDone(_w, run) {
    const d = championOf(run);
    return d.slain || d.over;
  },
  onEnd(w, run) {
    const d = championOf(run);
    if (d.slain) return;
    // out of time, out of run or never started: whatever still stands of the champion burrows away (quietly), and the hunt failed
    const row = d.id !== 0 ? w.enemies.find(d.id) : -1;
    if (row >= 0) despawnEnemy(w, row, true);
    run.failed = true;
  },
});

// ---- kind: Golden Hour (EV-01) --------------------------------------------------------------------------------------------------
//
// R4 (3/4, the optional kind): a short greedy window that makes the player choose to fight harder. For `duration` s (45) the zone's elites
// come `eliteEveryMul` x as often (0.5: half the interval) and every creature's yeop is worth `yeopMul` x (2): both are run modifiers
// (`World.setEventMods`, RS-01) applied the tick the active phase starts and removed the tick it ends, so nothing else in the sim knows
// about the event. The spawner's countdown to the next elite runs at 1 / mods.eliteEvery, so the faster pace takes hold on the countdown
// already running (the first extra elite can come at once), and it keeps the spawner's own limits: no elite while the field is full
// (ENEMY_SOFT_CAP + 20 alive), the same band pool, tier and stats as every elite. `dropLoot` reads mods.yeop for each yeop drop.
//   * The window is SIM time: a modal pause (a level-up, a chest) freezes it with the clock, so the player never loses part of the 45 s to a
//     card choice; a dead hero in a co-op party does not close it (the party goes on), a run that ends inside it (the last hero falls, the
//     final boss dies) does: the framework ends the active phase with 'runEnd' and the mods are cleared with it.
//   * It cannot fail (there is nothing to miss), so the 'end' event always carries p = 1.
//   * `span` = the duration: the schedule keeps the whole stretch (announce .. start + 45 s) `bossGap` from every boss spawn, so the window
//     never overlaps a boss fight (bosses already thin the field and the extra elites would be a spike on top of them).
//   * No random draw of its own: the pick of the kind and of the start are the framework's two draws at createWorld; the window itself draws
//     nothing (the elites it brings are drawn by the spawner exactly as an ordinary elite is).
// The mods are host-authoritative sim state and need no mirror: the extra elites and the doubled yeop pickups reach co-op guests as the enemies
// and pickups the host already sends, and the HUD view of the window (phase, time left) is the framework's.

/** the id the window files its factors under (`World.setEventMods` / `clearEventMods`) */
export const GOLDEN_HOUR_MODS_ID = 'goldenHour';

registerRunEventKind('goldenHour', {
  span(w) {
    return w.ix.runEvents.kinds.goldenHour.duration;
  },
  duration(w) {
    return w.ix.runEvents.kinds.goldenHour.duration;
  },
  onStart(w) {
    const cfg = w.ix.runEvents.kinds.goldenHour;
    w.setEventMods(GOLDEN_HOUR_MODS_ID, { eliteEvery: cfg.eliteEveryMul, yeop: cfg.yeopMul });
  },
  onEnd(w) {
    w.clearEventMods(GOLDEN_HOUR_MODS_ID);
  },
});

// ---- kind: the Sky Sovereign's Bargain (EV-02a) ---------------------------------------------------------------------------------------
//
// The Sky Sovereign appears in names only and the run has no opt-in risk but letting a metin awaken: a shrine is a point of interest the
// player CHOOSES to walk to. It stands up on the announce, 10-14 m from the hero (`placeWalkable`; a site a hero can reach is preferred
// below), and is open for BARGAIN_ACTIVE s - or until every living hero has used it. A hero within `radius` m of it for `channel` s opens a
// free, skippable 'chest' modal (source 'bargain', the cards of `openBargain`); each hero channels for their OWN modal, once.
//   * the channel counts sim time, so a modal pause freezes it with the clock (a level-up that opens mid-channel holds it; the hook also
//     stops for a modal already pending in this very tick); leaving the radius, dying or the run ending resets it (one 'channel' event
//     with p = 0); a hero who is down channels nothing, and a revived one starts from nothing;
//   * progress goes out as throttled 'channel' runEvents {player, p} (RUN_EVENT_CHANNEL_HZ per hero, framework: `setRunEventChannel`): the
//     host HUD reads it from the sim, a co-op guest's from the mirrored events (net/coop/mirror.ts). A finished channel sends p = 1 and, the
//     same tick, the reset p = 0: the cue and the ring pop play once and no bar is left behind;
//   * the event ends 'resolved' (p = 1) when every living hero has used it, else 'time' with p = 0 (nobody took the offer) - no banner
//     is worded for either, the p only tells a test or a log whether the shrine was used;
//   * `span` = the active length: the schedule keeps the whole stretch clear of every boss (a shrine walk in the middle of a boss fight is
//     not an offer, it is a trap);
//   * the only random draws are the shrine's `placeWalkable` tries at the announce (`w.rng.spawn`); the channel, the offer (the three
//     bargains of cards.ts, EV-02b: a boon and its curse each) and the answers draw none, so a run without the event is exactly as before
//     (HASH-EQ). The curses outlast the event: the elite pace is a run modifier, the monsters' pace a per-tick sweep (`tickBargainPace`).
// Co-op: all of it is host state. The modal of each hero travels to that hero like any other; a modal nobody answers is REFUSED by the
// co-op auto-pick timer (cards.ts `tickModalWait`), never auto-picked.

/** the shrine stands this far (m) from the hero it is placed round */
export const BARGAIN_RING_MIN = 10;
export const BARGAIN_RING_MAX = 14;
/** seconds the shrine stays open once it is up (the announce comes before) */
export const BARGAIN_ACTIVE = 60;
/** `placeWalkable` tries for a site a hero can reach before the first walkable one is taken */
const SHRINE_TRIES = 30;
/** the foot of the altar (m): the ground this far round the centre is spawnable (no lava, deep water or cliff edge) */
const SHRINE_FOOT_R = 1.5;
/** no static (prop, rock, tree, wall) reaches into this disc (m) round the centre with its drawn extent: a hero can walk onto it */
const SHRINE_CLEAR_R = 2;
/** the ground inside the channel ring is level to within this many metres (the ring is a flat decal) */
const SHRINE_LEVEL_DH = 1;

/** `RunEventRun.data.bargain`: who used the shrine and how long each hero has channelled */
interface BargainData {
  /** per hero: the shrine's offer was opened for them (once) */
  used: boolean[];
  /** per hero: seconds channelled so far (0 = not channelling) */
  t: number[];
  /** how many heroes used it */
  claimed: number;
}

function bargainOf(w: World, run: RunEventRun): BargainData {
  const have = run.data['bargain'] as BargainData | undefined;
  if (have !== undefined) return have;
  const made: BargainData = { used: w.players.map(() => false), t: w.players.map(() => 0), claimed: 0 };
  run.data['bargain'] = made;
  return made;
}

/** has hero `player` used this run's shrine? (false without a shrine) */
export function runEventBargainUsed(w: World, player: number): boolean {
  const s = w.runEvent;
  if (s === null || s.kind !== 'bargain') return false;
  return (s.data['bargain'] as BargainData | undefined)?.used[player] === true;
}

const shrinePos: Pos = { x: 0, z: 0 };

/** a shrine site the hero can use: spawnable foot, no static in the way, level ground under the channel ring (absent hooks = clear) */
function shrineClear(w: World, x: number, z: number, radius: number): boolean {
  if (!footprintClear(w, x, z, SHRINE_FOOT_R)) return false;
  const clear = w.env.clearOfStatics;
  if (clear !== undefined && !clear(x, z, SHRINE_CLEAR_R)) return false;
  const level = w.env.levelDisc;
  return level === undefined || level(x, z, radius, SHRINE_LEVEL_DH);
}

/**
 * The shrine's place: a `placeWalkable` point BARGAIN_RING_MIN..MAX m from the hero. Up to SHRINE_TRIES points are drawn and the first one
 * that is `shrineClear` is taken, else the first walkable one (an event beside a prop beats no event); with no walkable ground at all
 * (a hero standing in lava) the shrine goes where the hero is.
 */
function placeShrine(w: World, hero: PlayerState, run: RunEventRun): void {
  const radius = w.ix.runEvents.kinds.bargain.radius;
  let firstX = hero.x;
  let firstZ = hero.z;
  let have = false;
  for (let k = 0; k < SHRINE_TRIES; k++) {
    if (!placeWalkable(w, hero.x, hero.z, BARGAIN_RING_MIN, BARGAIN_RING_MAX, shrinePos)) break;
    if (!have) {
      have = true;
      firstX = shrinePos.x;
      firstZ = shrinePos.z;
    }
    if (shrineClear(w, shrinePos.x, shrinePos.z, radius)) {
      run.x = shrinePos.x;
      run.z = shrinePos.z;
      return;
    }
  }
  run.x = firstX;
  run.z = firstZ;
}

registerRunEventKind('bargain', {
  span() {
    return BARGAIN_ACTIVE;
  },
  duration() {
    return BARGAIN_ACTIVE;
  },
  place(w, run) {
    placeShrine(w, anchorHero(w), run);
  },
  onStart(w, run) {
    bargainOf(w, run);
  },
  onTick(w, run) {
    // a modal is pending (it opened earlier in this very tick): the channel waits with the clock
    if (w.modals.length > 0) return;
    const cfg = w.ix.runEvents.kinds.bargain;
    const d = bargainOf(w, run);
    for (const p of w.players) {
      const i = p.index;
      if (d.used[i] === true) continue;
      const inside = p.alive && Math.hypot(p.x - run.x, p.z - run.z) <= cfg.radius;
      if (!inside) {
        // left the radius, or fell: back to nothing (one p = 0 if there was progress)
        if ((d.t[i] as number) !== 0) {
          d.t[i] = 0;
          setRunEventChannel(w, i, 0);
        }
        continue;
      }
      const t = (d.t[i] as number) + DT;
      d.t[i] = t;
      if (t < cfg.channel - 1e-9) {
        setRunEventChannel(w, i, t / cfg.channel);
        continue;
      }
      // channelled: the offer opens for this hero, once. p = 1 (the cue and the pop), then the reset the same tick
      d.used[i] = true;
      d.t[i] = 0;
      d.claimed++;
      setRunEventChannel(w, i, 1);
      setRunEventChannel(w, i, 0);
      openBargain(w, p);
    }
  },
  isDone(w, run) {
    const d = bargainOf(w, run);
    let living = 0;
    for (const p of w.players) {
      if (!p.alive) continue;
      living++;
      if (d.used[p.index] !== true) return false;
    }
    return living > 0;
  },
  onEnd(w, run) {
    // nobody took the offer: the shrine faded unused (end p = 0)
    if (bargainOf(w, run).claimed === 0) run.failed = true;
  },
});
