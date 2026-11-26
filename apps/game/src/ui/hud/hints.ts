// First-time hints (HD-01, R5; HD-03 added the pact, the run event and the elite affix): the first time a run shows something a newcomer
// cannot guess (a level-up, a falling Metin and its awakening clock, corruption, a locked chest, a boss, an essence offer, the first
// reroll / banish, an awakening pact, a run event, an affixed elite) one short plate explains it, once per profile
// (`settings.hintsSeen`), and never again. The plates are ordinary 'info' banners (announce.ts), so they sit in the last row of
// the top-centre tablet UNDER the boss row: they can never cover the boss plate or a HUD gauge.
//
// A hint waits (it is queued, not lost) while a modal or the pause menu covers the HUD, while any banner is on screen (a boss / big
// banner is never pushed off), while the hero is dead, for a short breather after the previous hint plate LEFT the screen and for
// HINT_SETTLE_MS after it was queued (the sim emits an event before the tick's modal reaches the store); the run-event tip waits
// HINT_SETTLE_EVENT_MS, so the banner it tells the player to read is on screen first. It is dropped after `HINT_QUEUE_MS` of visible
// waiting, without being marked as seen, so it shows at the next occasion instead.
//
// A hint is spent only when it was READ: the plate is recorded in `hintsSeen` after it has been readable for HINT_READ_MS, meaning on
// screen, no modal over the HUD, the hero alive and still the current banner. If a modal (level-up, chest, essence, story, pause) covers
// the HUD, the hero dies, or another banner (Metin / danger / victory / boss / level) replaces the plate before that, the plate is
// withdrawn from the feed and the SAME hint goes back to the head of the queue, unrecorded: it shows again, for its full
// HINT_TTL_MS, when the screen is free. After HINT_READ_MS it stays recorded and is not repeated, whatever covers it later.
// `showHints` off hides all of them and leaves the list alone. Co-op: local only (nothing here is sent to the host or the mirrors).
//
// `Hints` is a plain controller (injected clock / screen) so the tests drive it directly; `attachHints` wires it to the sim event
// stream (deps.events), the HUD snapshot and the modal state of the GameStore. announce.ts owns the banner list and calls it.
import { resolveHardMuls, resolvePacts, type ContentDB } from '../../data/schema';
import { settings } from '../../engine/settings';
import { t, tl, type Params } from '../../i18n/i18n';
import type { SimEvent } from '../../sim/events';
import type { UiDeps } from '../env';

export type HintId = 'levelUp' | 'metinWarn' | 'metinAwaken' | 'corruption' | 'chestLocked' | 'boss' | 'essence' | 'reroll' | 'banish' | 'pact' | 'event' | 'affix';

/**
 * Every hint, in the order a first run meets them (the three of HD-03 last: a pact card shows from the first level-ups, a run event from
 * about 6:20, an affixed elite from its first band). The i18n keys are `hint.<id>.title` / `hint.<id>.text` (up_hints parts).
 */
export const HINT_IDS: readonly HintId[] = ['levelUp', 'metinWarn', 'metinAwaken', 'corruption', 'chestLocked', 'boss', 'essence', 'reroll', 'banish', 'pact', 'event', 'affix'];

/** `EnemySpawnEvent.source` of an elite (sim/spawner.ts: tier 1 = the band's elite; the Champion Hunt's champion is tier 2) */
const ELITE_SOURCE = 5;

/** corruption (0..1) from which its hint shows */
export const CORRUPTION_HINT_AT = 0.5;
/** how long a hint plate stays up: the banner animation of hud.css (`.ms-an--info:has(.ms-an-sub)`) runs the same 6 s */
export const HINT_TTL_MS = 6000;
/** a hint plate counts as read (is recorded in `hintsSeen`) once it has been readable this long: on screen, no modal over the HUD, hero alive */
export const HINT_READ_MS = 3500;
/** free time between two hints: measured from the moment the previous hint plate LEFT the feed (expired, withdrawn or replaced), so a
 *  full 6 s plate is followed by a real breather */
export const HINT_GAP_MS = 2500;
/** a queued hint that finds no free moment for this long (time under a modal does not count) is dropped */
export const HINT_QUEUE_MS = 25000;
/** a hint is shown at the earliest this long after it was queued (the clock does not run while a modal covers the HUD): the sim emits an
 *  event BEFORE the tick's modal reaches the store (app/run.ts: dispatch, then syncModal), so the hint raised by the very event that opens
 *  a level-up or essence offer must not slip out in the instant before that modal covers the HUD */
export const HINT_SETTLE_MS = 300;
/** the run-event tip says "read the banner, watch its timer": it opens only after the event's plate (a standing plate does not count as a busy
 *  screen) has been readable this long, instead of covering its countdown from the first moment */
export const HINT_SETTLE_EVENT_MS = 4000;
/** how long a queued hint waits before it may open (the shorter default, the run-event tip's longer wait) */
const settleOf = (id: HintId): number => (id === 'event' ? HINT_SETTLE_EVENT_MS : HINT_SETTLE_MS);
/** the wiring re-checks a waiting hint this often (a no-op while nothing is queued) */
const PUMP_MS = 400;

/** What a hint plate carries (announce.ts turns it into an 'info' banner: `title` over a one-sentence `sub`). */
export interface HintPlate {
  id: HintId;
  title: string;
  sub: string;
  ttlMs: number;
}

/** The part of the sim World a hint (and a run-event banner, announce.ts) reads (`runEvents` hands the live World as the second argument of every event). */
export interface HintWorld {
  mods?: { awaken?: number };
  /** the sim clock (s): the band of an elite spawn */
  time?: number;
  /** the run's zone: the World of the host, or a co-op guest's mirror, knows it; the menu's selection does not (a co-op run never writes the room's zone into it) */
  zone?: { bands?: readonly { from: number }[]; metins?: { types?: readonly string[] } };
}

/** The part of the HUD snapshot a hint reads. */
export interface HintHud {
  alive: boolean;
  corruption: number;
  rerolls: number;
  banishes: number;
  /** the run clock (s): the band of an elite spawn when the event source has no World (a co-op guest) */
  time?: number;
}

/** The part of an offered card the pact hint reads (sim/types.ts `Card`): `needs` = the passive a skill card still needs, `pact` = the owned skills a passive card awakens. */
export interface HintCard {
  id: string;
  needs?: string;
  pact?: { awakens: readonly string[] };
}

/** What the controller needs from the screen: announce.ts supplies the real ones, the tests fakes. */
export interface HintHost {
  /** milliseconds, monotonic */
  now(): number;
  show(plate: HintPlate): void;
  /** a banner of any tone is on screen right now */
  plateOn(): boolean;
  /** the plate of hint `id` is still the banner on screen (it was not replaced and has not expired) */
  hintOn(id: HintId): boolean;
  /** takes the plate of hint `id` off the screen (no text may sit behind a modal) */
  withdraw(id: HintId): void;
  /** a modal (level-up, chest, pause, story ...) covers the HUD */
  hudCovered(): boolean;
  /** `awakenAfter` seconds of a Metin definition */
  awakenAfter(def: string): number | undefined;
  /** x the awakening time when the event carries no world (the run's difficulty: hard = the zone's `awakenMul`) */
  awakenMul(): number;
  /** the pact hint's words for the first offered card that carries a pact line ({passive, rank, skill}); null = none (or pacts off) */
  pactLine?(cards: readonly HintCard[]): Params | null;
  /** affixes.fromBand while affixes are enabled; undefined = affixes off (no affix hint) */
  affixFrom?(): number | undefined;
  /** the 0-based band of the zone at run second `t` */
  bandAt?(t: number): number;
}

interface Queued {
  id: HintId;
  params: Params | undefined;
  /** host.now() when queued, moved forward while the HUD is covered */
  at: number;
}

/** The hint plate on screen now: it is recorded in `hintsSeen` only after it was readable for HINT_READ_MS. */
interface Showing {
  id: HintId;
  params: Params | undefined;
  /** host.now() when the plate opened */
  shownAt: number;
  /** the last pump that found it readable (on screen, no modal over the HUD, hero alive) */
  lastOk: number;
  /** markHintSeen has been called */
  recorded: boolean;
}

/** 90 -> "1:30", 60.3 -> "1:00" (whole seconds, minutes unpadded) */
export function fmtAwakenTime(sec: number): string {
  const s = Math.max(0, Math.round(Number.isFinite(sec) ? sec : 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class Hints {
  private queue: Queued[] = [];
  /** the plate that is up now, until it leaves the feed */
  private cur: Showing | null = null;
  /** host.now() when the last hint plate left the feed (expired, withdrawn or replaced) */
  private lastLeft = -Infinity;
  private lastPump: number;
  /** the HUD was covered (modal, dead hero) at the last pump: the time since then did not age the queue */
  private wasCovered = false;
  private alive = true;
  private rerolls: number | null = null;
  private banishes: number | null = null;
  /** the run clock of the last HUD snapshot */
  private clock = 0;

  constructor(private readonly host: HintHost) {
    this.lastPump = host.now();
  }

  /** a sim event (the optional world of `runEvents` lets the awakening hint read the live `mods.awaken`) */
  onEvent(e: SimEvent, w?: HintWorld): void {
    switch (e.t) {
      case 'levelUp':
        if (e.player === 0) this.enqueue('levelUp');
        break;
      case 'metinWarn': {
        // the Great Metin never awakens: its warning teaches nothing about the clock
        if (e.great) break;
        const base = this.host.awakenAfter(e.def);
        if (base === undefined) break;
        const mul = w?.mods?.awaken ?? this.host.awakenMul();
        this.enqueue('metinWarn', { time: fmtAwakenTime(base * mul) });
        break;
      }
      case 'metinAwaken':
        this.enqueue('metinAwaken');
        break;
      case 'chestLocked':
        if (e.player === 0) this.enqueue('chestLocked');
        break;
      case 'bossSpawn':
        this.enqueue('boss');
        break;
      case 'runEvent':
        // the first event of the profile, once it runs (a co-op guest that joins mid-event meets the running one): the banner says what it
        // is, the tip says that it is a one-per-run set piece worth reading
        if (e.phase === 'active') this.enqueue('event');
        break;
      case 'enemySpawn':
        // the band's elite (tier 1): from affixes.fromBand on it carries an affix (the champion, tier 2, is none of that)
        if (e.source === ELITE_SOURCE && e.tier === 1) this.onElite(w?.time, w?.zone?.bands);
        break;
      case 'runEnd':
        this.clear();
        break;
      default:
        break;
    }
  }

  /** the HUD snapshot (10 Hz); null = no run. Corruption, and the reroll / banish budgets going down (= the player used one). */
  onHud(h: HintHud | null): void {
    if (!h) {
      this.alive = false;
      this.rerolls = null;
      this.banishes = null;
      return;
    }
    this.alive = h.alive;
    if (h.time !== undefined) this.clock = h.time;
    if (h.corruption >= CORRUPTION_HINT_AT) this.enqueue('corruption');
    if (this.rerolls !== null && h.rerolls < this.rerolls) this.enqueue('reroll', { n: h.rerolls });
    if (this.banishes !== null && h.banishes < this.banishes) this.enqueue('banish', { n: h.banishes });
    this.rerolls = h.rerolls;
    this.banishes = h.banishes;
  }

  /** the open modal (null = none): the first essence offer of the local hero, the first offer with a pact card in it */
  onModal(m: { kind: string; request?: { player: number; cards?: readonly HintCard[] } } | null): void {
    if (!m || m.request?.player !== 0) return;
    if (m.kind === 'essence') this.enqueue('essence');
    else if ((m.kind === 'levelUp' || m.kind === 'chest') && m.request.cards && m.request.cards.length > 0) {
      const line = this.host.pactLine?.(m.request.cards);
      if (line) this.enqueue('pact', line);
    }
  }

  /**
   * an elite of tier 1 spawned (`time` = the sim clock and `bands` = the run's zone bands when the event source has a World): the affix hint
   * once its band carries affixes. The World's own bands win over the host's lookup (the menu's zone is not a co-op run's zone).
   */
  private onElite(time?: number, bands?: readonly { from: number }[]): void {
    const from = this.host.affixFrom?.();
    if (from === undefined) return;
    const at = time ?? this.clock;
    const band = bands ? bandIndexAt(bands, at) : (this.host.bandAt?.(at) ?? 0);
    if (band >= from) this.enqueue('affix');
  }

  /** The hint plate on screen now (null = none): for the tests and the dev tools. */
  get showing(): HintId | null {
    return this.cur?.id ?? null;
  }

  /**
   * Watches the plate that is up (records it once it was read, takes it back when it was not) and shows the next queued hint when the
   * screen is free. Call it whenever something that gates a hint may have changed: the wiring does on every HUD snapshot (10 Hz), every
   * modal change and a 400 ms tick, so a modal, a death or a replacing banner is seen within a snapshot of happening.
   */
  pump(): void {
    // the idle case is the hot one: one length check and one null check, no clock read
    if (this.queue.length === 0 && this.cur === null) return;
    const now = this.host.now();
    const dt = now - this.lastPump;
    this.lastPump = now;
    const s = settings.value;
    const covered = this.host.hudCovered() || !this.alive;
    if (this.cur) this.watch(now, covered, s.showHints);
    if (!s.showHints) {
      this.queue = [];
      return;
    }
    // time under a modal (or while dead) does not age a hint: the player could not have seen it. Every change of the screen state pumps,
    // so the state the previous pump saw is the state of the time since: the moment a modal closes still counts the time it was open.
    if (this.wasCovered && dt > 0) for (const q of this.queue) q.at += dt;
    this.wasCovered = covered;
    this.queue = this.queue.filter((q) => now - q.at <= HINT_QUEUE_MS && !s.hintsSeen.includes(q.id));
    const idx = this.cur || covered ? -1 : this.nextReady(now);
    const next = this.queue[idx];
    if (!next || this.host.plateOn() || now - this.lastLeft < HINT_GAP_MS) return;
    this.queue.splice(idx, 1);
    this.cur = { id: next.id, params: next.params, shownAt: now, lastOk: now, recorded: false };
    this.host.show({ id: next.id, title: `${t('hint.tag')} · ${t(`hint.${next.id}.title`)}`, sub: t(`hint.${next.id}.text`, next.params), ttlMs: HINT_TTL_MS });
  }

  /**
   * The place in the queue of the hint that may open now (-1 = none). The head of the line keeps its place while it waits out the short
   * settle; the run-event tip waits much longer for its plate to be read first, and lets the hints behind it by meanwhile.
   */
  private nextReady(now: number): number {
    for (let i = 0; i < this.queue.length; i++) {
      const q = this.queue[i] as Queued;
      if (now - q.at >= settleOf(q.id)) return i;
      if (settleOf(q.id) <= HINT_SETTLE_MS) return -1;
    }
    return -1;
  }

  /** drops everything queued, takes an unread plate off the screen and forgets the run-local baselines (run end, HUD unmount) */
  clear(): void {
    if (this.cur && !this.cur.recorded) this.host.withdraw(this.cur.id);
    this.cur = null;
    this.queue = [];
    this.rerolls = null;
    this.banishes = null;
  }

  /** the plate that is up: record it once it was read, take it back (and queue it again) when it was not */
  private watch(now: number, covered: boolean, showHints: boolean): void {
    const c = this.cur as Showing;
    const onFeed = this.host.hintOn(c.id);
    const readable = onFeed && !covered && showHints;
    if (readable) c.lastOk = now;
    // read = readable up to the last pump that saw it so (a plate replaced between two pumps is judged by the pump before)
    if (!c.recorded && c.lastOk - c.shownAt >= HINT_READ_MS) {
      c.recorded = true;
      settings.markHintSeen(c.id);
    }
    // being read, or already read and only running out its time (hidden or not: it is spent either way)
    if (onFeed && showHints && (readable || c.recorded)) return;
    if (onFeed) this.host.withdraw(c.id);
    this.cur = null;
    this.lastLeft = now;
    // unread: it comes back, first in line, for its full time when the screen is free (the event tip's long wait for its plate is over)
    if (!c.recorded && showHints && !settings.value.hintsSeen.includes(c.id)) {
      this.queue.unshift({ id: c.id, params: c.params, at: now - (settleOf(c.id) - HINT_SETTLE_MS) });
    }
  }

  private enqueue(id: HintId, params?: Params): void {
    const s = settings.value;
    if (!s.showHints || s.hintsSeen.includes(id) || this.cur?.id === id || this.queue.some((q) => q.id === id)) return;
    const now = this.host.now();
    if (this.queue.length === 0) {
      this.lastPump = now;
      this.wasCovered = this.host.hudCovered() || !this.alive;
    }
    this.queue.push({ id, params, at: now });
  }
}

/** the 0-based index of the band running at run second `sec` (the last band that has started; 0 before the first) */
export function bandIndexAt(bands: readonly { from: number }[] | undefined, sec: number): number {
  let idx = 0;
  if (bands) for (let i = 0; i < bands.length; i++) if ((bands[i] as { from: number }).from <= sec) idx = i;
  return idx;
}

/**
 * The words of the pact hint from the first card of an offer that carries a pact line: a skill card that cannot reach its awakening yet
 * (`needs` = the passive it still asks for) or a passive card that awakens an owned skill (`pact.awakens`). The rank is the pact rank
 * capped at the passive's own maximum (ui/cardModel.ts `pactNeedRank`). Null while pacts are off (`balance.pacts.rank` 0 = today's cards).
 */
export function pactLineOf(content: Pick<ContentDB, 'balance' | 'passives' | 'skills'>, cards: readonly HintCard[]): Params | null {
  const rank = resolvePacts(content.balance.pacts).rank;
  if (rank <= 0) return null;
  for (const c of cards) {
    const passiveId = c.needs ?? (c.pact && c.pact.awakens.length > 0 ? c.id : undefined);
    const skillId = c.needs !== undefined ? c.id : c.pact?.awakens[0];
    if (passiveId === undefined || skillId === undefined) continue;
    const passive = content.passives.find((p) => p.id === passiveId);
    const skill = content.skills.find((k) => k.id === skillId);
    return { passive: passive ? tl(passive.name) : passiveId, skill: skill ? tl(skill.name) : skillId, rank: Math.min(rank, passive?.maxRank ?? rank) };
  }
  return null;
}

/** What announce.ts gives the wiring: the banner feed. */
export interface HintPlates {
  /** puts the plate on screen as an 'info' banner */
  show(plate: HintPlate): void;
  /** a banner of any tone is on screen */
  busy(): boolean;
  /** the plate of hint `id` is still the banner on screen */
  has(id: HintId): boolean;
  /** takes the plate of hint `id` off the screen */
  withdraw(id: HintId): void;
}

/**
 * Subscribes a `Hints` controller to the sim events, the HUD snapshot and the modal state while the HUD is mounted; returns the
 * unsubscribe. The awakening time of a falling Metin is its `awakenAfter` x `w.mods.awaken` of the live World (hard: `awakenMul`,
 * events and trials move it too); a source without a World (the gallery) falls back to the run's difficulty.
 */
export function attachHints(d: Pick<UiDeps, 'store' | 'content' | 'events'>, plates: HintPlates): () => void {
  const hints = new Hints({
    now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
    show: plates.show,
    plateOn: plates.busy,
    hintOn: plates.has,
    withdraw: plates.withdraw,
    hudCovered: () => d.store.modal.value !== null,
    awakenAfter: (def) => d.content.metins.find((m) => m.id === def)?.awakenAfter,
    awakenMul: () => {
      const sel = d.store.runSelection.value;
      if (sel.difficulty !== 'hard') return 1;
      return resolveHardMuls(d.content.balance, d.content.zones.find((z) => z.id === sel.zone)).awakenMul;
    },
    pactLine: (cards) => pactLineOf(d.content, cards),
    affixFrom: () => {
      const a = d.content.affixes;
      return a?.enabled ? a.fromBand : undefined;
    },
    bandAt: (sec) => bandIndexAt(d.content.zones.find((z) => z.id === d.store.runSelection.value.zone)?.bands, sec),
  });
  // UiEventSource declares one argument; the real hub (app/runEvents.ts) passes the World as a second one
  // no pump here: the event of a level-up / essence offer comes BEFORE its modal reaches the store (see HINT_SETTLE_MS)
  const offEvents = d.events?.subscribe((e: SimEvent, w?: HintWorld) => hints.onEvent(e, w));
  const offHud = d.store.hud.subscribe((h) => {
    hints.onHud(h);
    hints.pump();
  });
  const offModal = d.store.modal.subscribe((m) => {
    hints.onModal(m);
    hints.pump();
  });
  // a banner ending or a modal closing changes no signal the three above watch: a slow tick lets a waiting hint through
  const tick = setInterval(() => hints.pump(), PUMP_MS);
  return () => {
    clearInterval(tick);
    offEvents?.();
    offHud();
    offModal();
    hints.clear();
  };
}
