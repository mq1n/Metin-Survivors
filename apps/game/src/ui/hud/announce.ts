// HUD announcements (boss incoming, Metin falling, boss phases, run events …) and the damage-flash counter. Fed by the sim event
// stream (deps.events), the HUD snapshot and by GameStore.toasts; everything is localised here.
//
// Run events (HD-03, R4): a SimEvent 'runEvent' becomes a banner per kind and phase (`EVENT_STYLE`, `eventBanner`): Metin Rain in the metin
// tone with the zone's rune colour, Champion Hunt in the danger tone, Golden Hour in the victory tone (its end, which is no victory, in the
// gold info tone), the Sky Sovereign's shrine in the info tone. The countdown on a banner is NEVER a timer of this file: it reads
// `HudSnapshot.runEvent.left` (the host's sim, a co-op guest's mirrored clock) on every HUD snapshot, so a guest shows the same banner and
// the same number as the host. The two timed kinds (Champion Hunt, Golden Hour) keep ONE standing plate for their whole announce + active
// stretch: it sits in the banner row of the top-centre tablet whenever no other banner is up, a transient banner (boss, Metin, a hint) takes
// the row for its 2.5 s and the plate is back after it. A verdict (won / lost) shows only when the event ended by its own clock or, for a
// kind that can be won early (the hunt's champion), by its own win: an event the run cut short (the hero fell, the final boss died) gives none.
// The zone (its rune colour) comes from the World that the event hub passes with every event (the host's, or a co-op guest's mirror) and
// only falls back to the menu's selection when there is none (the gallery). The final boss's card (A-11) is the same row, longer and
// larger (`final`, hud.css).
import { computed, signal, type ReadonlySignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { resolveRunEvents } from '../../data/schema';
import { fmtDec, fmtInt, fmtTime, t, tl } from '../../i18n/i18n';
import type { Params } from '../../i18n/i18n';
import type { RunEventEvent, SimEvent } from '../../sim/events';
import type { HudSnapshot } from '../../sim/types';
import { indexOf } from '../content';
import { deps, type UiDeps } from '../env';
import { attachHints, HINT_TTL_MS, type HintPlate, type HintPlates, type HintWorld } from './hints';

export type AnnounceTone = 'metin' | 'danger' | 'boss' | 'victory' | 'info' | 'level';

/** The run event a banner belongs to (HD-03): which one, which stage it shows, and the numbers its countdown line is built from. */
export interface EventBannerInfo {
  /** runEvents.json kind id */
  kind: string;
  /** the event's id (unique within the run) */
  id: number;
  phase: 'announce' | 'active';
  /** absolute sim seconds: the active phase starts / its planned end (what the countdown falls back on while the HUD is a snapshot behind) */
  startAt: number;
  endAt: number;
  /** i18n keys of the title and of the countdown line, and the fixed parameters of the line (`time` is added on every update): the
   *  wording is rebuilt on every HUD snapshot, so a language switched mid-event shows on the plate at once */
  titleKey: string;
  subKey: string;
  params: Params;
}

export interface Announcement {
  id: number;
  tone: AnnounceTone;
  title: string;
  sub?: string;
  /** accent colour (metin rune) */
  color?: string;
  big?: boolean;
  /** a first-time hint (hints.ts): an 'info' plate with a sentence under its title that stays up for `HINT_TTL_MS`; a plain info
   *  toast never replaces it while it is being read */
  hint?: boolean;
  /** which hint (hints.ts `HintId`): hints.ts asks whether its plate is still the banner on screen, and takes it back by id */
  hintId?: string;
  /** a run-event banner (HD-03): its `sub` is a countdown that this file keeps current from HudSnapshot.runEvent */
  ev?: EventBannerInfo;
  /** the final boss's card (A-11): it holds `FINAL_CARD_MS` instead of 2.5 s, and hud.css makes it larger */
  final?: boolean;
}

const list = signal<Announcement[]>([]);
/** the standing plate of a timed run event: shown while no other banner is, never expires by a timer (see the header) */
const standing = signal<Announcement | null>(null);
/** what the top-centre tablet shows: the newest transient banner, else the standing event plate */
export const announcements: ReadonlySignal<Announcement[]> = computed(() => (list.value.length > 0 ? list.value : standing.value ? [standing.value] : []));

/** Bumps whenever the hero is hit (screen flash). */
export const hitFlash = signal(0);
/** Bumps when the hero levels up (badge pop). */
export const levelPop = signal(0);

let seq = 1;
const lastByKey = new Map<string, number>();

/** a banner's lifetime never outlasts its CSS animation (`ms-announce-in`, 2.4 s): invisible rows would push later ones down */
const ANNOUNCE_MAX_MS = 2500;
/** the final boss's card holds this long (hud.css `.is-final`: its animation runs the same 4.6 s) */
export const FINAL_CARD_MS = 4600;

export function announce(a: Omit<Announcement, 'id'>, ttlMs = 3600, dedupeKey?: string): void {
  const now = performance.now();
  const key = dedupeKey ?? `${a.tone}:${a.title}`;
  // a hint is already once-per-profile (hints.ts records it once it was read) and may come back after a modal: the 0.9 s de-duplication
  // must never swallow it
  if (!a.hint && now - (lastByKey.get(key) ?? -1e9) < 900) return;
  if (lastByKey.size > 64) lastByKey.clear();
  lastByKey.set(key, now);
  const id = seq++;
  // ONE banner plate at a time: the newest replaces the earlier one (two or three red plates stacked under the boss plate hid the
  // play area). Info toasts never push a boss / big banner off the screen, nor a hint plate that is still being read (a hint is the
  // one info plate that may follow another: hints.ts only shows one while the feed is empty). A run event's info banner (the shrine)
  // is news a tip must give way to: it replaces a hint, never a boss / big banner.
  const keepBig = a.tone === 'info' ? list.value.filter((x) => x.big || x.tone === 'boss' || (x.hint === true && a.hint !== true && a.ev === undefined)) : [];
  list.value = keepBig.length > 0 ? keepBig.slice(-1) : [{ ...a, id }];
  // an info banner with a sentence under it animates 6 s (hud.css `.ms-an--info:has(.ms-an-sub)`), so it has to stay in the feed that long or
  // its row snaps shut at full opacity. That is the hint plate and both banners of the Sky Sovereign's shrine; any other banner folds after 2.4 s.
  const hold = a.final ? FINAL_CARD_MS : a.hint || (a.tone === 'info' && a.sub !== undefined) ? HINT_TTL_MS : ANNOUNCE_MAX_MS;
  window.setTimeout(() => {
    list.value = list.value.filter((x) => x.id !== id);
  }, Math.min(ttlMs, hold));
}

/** A first-time hint (hints.ts) as the 'info' banner: the topic as its title, the sentence under it. */
function showHint(p: HintPlate): void {
  announce({ tone: 'info', title: p.title, sub: p.sub, hint: true, hintId: p.id }, p.ttlMs, `hint:${p.id}`);
}

/** The plate of hint `id` is still the banner on screen (not replaced by another banner, not expired). */
export function hintShown(id: string): boolean {
  return list.value.some((x) => x.hint === true && x.hintId === id);
}

/**
 * Takes the plate of hint `id` (any hint plate when omitted) off the screen. hints.ts does this when a modal covers the HUD or the hero
 * dies before the plate was read, so no text ghosts behind the offer; it puts the hint back in its queue. The plate's expiry timer is
 * keyed by the banner id, so it finds nothing to remove later.
 */
export function withdrawHint(id?: string): void {
  const isIt = (x: Announcement): boolean => x.hint === true && (id === undefined || x.hintId === id);
  if (!list.value.some(isIt)) return;
  list.value = list.value.filter((x) => !isIt(x));
}

/** The banner feed as hints.ts sees it (`attachHints(deps, hintPlates)`): show a plate, is any banner on, is my plate still the banner, take it back. */
export const hintPlates: HintPlates = { show: showHint, busy: () => list.value.length > 0, has: hintShown, withdraw: withdrawHint };

export function clearAnnouncements(): void {
  list.value = [];
  standing.value = null;
  resetEvents();
}

// ---------------------------------------------------------------------------------------------------- run events (HD-03)

interface EventStyle {
  tone: AnnounceTone;
  /** Champion Hunt / Golden Hour: ONE plate stands for the whole announce + active stretch (their countdown matters for a minute) */
  standing: boolean;
  /** the kind can be WON before its planned end (the hunt's champion slain): that early 'end' is a verdict. For any other kind an 'end'
   *  that comes early is the run ending, and shows nothing */
  earlyWin?: boolean;
  /** the tone of a verdict where the plain one would mislead: 'victory' for a won event, 'danger' for a lost one */
  verdict?: { won?: AnnounceTone; lost?: AnnounceTone };
}

/**
 * Which tone each run-event kind speaks in (the spec): Metin Rain = metin (the zone's rune colour), Champion Hunt = danger, Golden Hour =
 * victory, the Sky Sovereign's shrine = info. A kind that is not listed (a future one) shows nothing. The standing plates rely on hud.css:
 * a danger / victory banner that carries a sub line is a standing plate (no other banner of those tones has one). Golden Hour's end is
 * no victory (nothing was won or lost, the hour is simply over): it speaks in the gold info tone, so it carries no "Victory" eyebrow and
 * folds like any banner (a sub line would make it a standing plate).
 */
export const EVENT_STYLE: Readonly<Record<string, EventStyle>> = {
  metinRain: { tone: 'metin', standing: false },
  championHunt: { tone: 'danger', standing: true, earlyWin: true },
  goldenHour: { tone: 'victory', standing: true, verdict: { won: 'info' } },
  bargain: { tone: 'info', standing: false },
};

/** What a banner's wording needs besides the event itself: the numbers of the content and the zone's rune colour. */
export interface EventCtx {
  /** rune colour of the zone's first Metin (Metin Rain's accent) */
  rune?: string | undefined;
  /** Golden Hour: Yeop multiplier and elite frequency multiplier (1 / eliteEveryMul) */
  yeop: number;
  elite: number;
  /** the shrine: channel seconds */
  channel: number;
}

export type EventStage = 'announce' | 'active' | 'won' | 'lost';

/**
 * The banner of run event `kind` at `stage` with `left` seconds on its clock, or null when the kind / stage has no wording. Pure over the
 * i18n dictionaries: the mapping is tested without a screen. 'won' / 'lost' are the verdict banners of an event that ended (p = 1 / 0).
 */
export function eventBanner(kind: string, stage: EventStage, left: number, ctx: EventCtx): Omit<Announcement, 'id'> | null {
  const style = EVENT_STYLE[kind];
  if (!style) return null;
  const base = `announce.ev.${kind}.${stage}`;
  const title = t(base);
  if (title === base) return null;
  const params: Params = { yeop: fmtDec(ctx.yeop, 1), elite: fmtDec(ctx.elite, 1), channel: fmtInt(ctx.channel) };
  const verdict = stage === 'won' || stage === 'lost';
  const subKey = `${base}.sub`;
  const sub = verdict ? subKey : t(subKey, { ...params, time: fmtTime(Math.ceil(left)) });
  const tone: AnnounceTone = stage === 'won' ? (style.verdict?.won ?? 'victory') : stage === 'lost' ? (style.verdict?.lost ?? 'danger') : style.tone;
  const out: Omit<Announcement, 'id'> = { tone, title };
  if (sub !== subKey) out.sub = sub;
  if (tone === 'metin' && ctx.rune) out.color = ctx.rune;
  // the gold of the Sky Sovereign's shrine and of Golden Hour's end (an info banner that carries an accent; hud.css puts a scrim under it, a
  // hint plate has none)
  else if (tone === 'info') out.color = EVENT_GOLD;
  if (!verdict && sub !== subKey) out.ev = { kind, id: 0, phase: stage, startAt: 0, endAt: 0, titleKey: base, subKey, params };
  return out;
}

/** the accent of an info-tone event banner (the info tone has none of its own) */
const EVENT_GOLD = '#e4bd62';

/** how long (in seconds of the HUD clock) a standing plate may stay up while the HUD shows no such event before the plate is taken away (a lost 'end') */
const EV_HUD_GRACE = 1.5;
/** an 'end' that came this much before the planned end ended with the run, not with the event's own clock */
const EV_END_SLACK = 0.5;

/** the events already bannered (`id:phase`), the ones that ended, each event's planned end, whether the run is over, the HUD clock when the HUD last had no event */
const evShown = new Set<string>();
const evEnded = new Set<number>();
const evPlanned = new Map<number, number>();
let runOver = false;
let hudGone = -1;
/** the HUD clock of the last snapshot: it going backwards means a new run on the same mounted HUD */
let hudTime = -1;

function resetEvents(): void {
  evShown.clear();
  evEnded.clear();
  evPlanned.clear();
  runOver = false;
  hudGone = -1;
  hudTime = -1;
}

/**
 * The content numbers and the zone's rune colour for the banner wording (read when a banner is built). The zone is the run's: the live
 * World's (`w`, which the event hub passes on the host and on a guest's mirror), never the menu's selection when a World is there, because
 * a co-op run does not write the room's zone into the selection. Without a World (the gallery) the selection is the best there is.
 */
function eventCtx(d: Pick<UiDeps, 'store' | 'content'>, w?: HintWorld): EventCtx {
  const kinds = resolveRunEvents(d.content.runEvents).kinds;
  const types = w?.zone?.metins?.types ?? d.content.zones.find((z) => z.id === d.store.runSelection.value.zone)?.metins?.types;
  const first = types?.[0];
  const rune = first === undefined ? undefined : d.content.metins.find((m) => m.id === first)?.rune;
  return { rune, yeop: kinds.goldenHour.yeopMul, elite: 1 / Math.max(0.05, kinds.goldenHour.eliteEveryMul), channel: kinds.bargain.channel };
}

/** seconds left on the clock of banner `ev`: the HUD's own `runEvent.left` while it shows this event and stage, else the planned times against the HUD clock */
function leftOn(ev: EventBannerInfo, h: HudSnapshot): number {
  const r = h.runEvent;
  if (r && r.kind === ev.kind && r.phase === ev.phase) return r.left;
  return Math.max(0, (ev.phase === 'announce' ? ev.startAt : ev.endAt) - h.time);
}

function withSub(a: Announcement, h: HudSnapshot): Announcement {
  const ev = a.ev;
  if (!ev) return a;
  const sub = t(ev.subKey, { ...ev.params, time: fmtTime(Math.ceil(leftOn(ev, h))) });
  const title = t(ev.titleKey);
  return sub === a.sub && title === a.title ? a : { ...a, sub, title };
}

/** The countdown lines follow the HUD snapshot (10 Hz; they change once a second); a standing plate whose event the HUD no longer shows goes. */
function onHudEvent(h: HudSnapshot | null): void {
  if (h === null) {
    standing.value = null;
    resetEvents();
    return;
  }
  if (h.time < hudTime - 0.5) {
    standing.value = null;
    resetEvents();
  }
  hudTime = h.time;
  const cur = standing.value;
  if (cur?.ev) {
    const r = h.runEvent;
    if (r && r.kind === cur.ev.kind) hudGone = -1;
    else if (hudGone < 0) hudGone = h.time;
    else if (h.time - hudGone > EV_HUD_GRACE) {
      standing.value = null;
      hudGone = -1;
      return;
    }
    const next = withSub(cur, h);
    if (next !== cur) standing.value = next;
  }
  if (list.value.some((a) => a.ev !== undefined)) {
    const next = list.value.map((a) => (a.ev ? withSub(a, h) : a));
    if (next.some((a, i) => a !== list.value[i])) list.value = next;
  }
}

/** a 'runEvent' of the sim (or, on a co-op guest, of the mirror): the banner of its phase */
function onRunEvent(e: RunEventEvent, d: Pick<UiDeps, 'store' | 'content'>, w?: HintWorld): void {
  const style = EVENT_STYLE[e.kind];
  if (!style || e.phase === 'channel') return;
  if (e.phase === 'end') {
    if (evEnded.has(e.id)) return;
    evEnded.add(e.id);
    if (standing.value?.ev?.id === e.id) standing.value = null;
    if (runOver) return;
    // An 'end' that came before the planned end is the run ending (the hero fell, the final boss died): the framework ends the event with
    // it, and Golden Hour, which never fails, reports p = 1. It is a verdict only for a kind that can be won early (the champion slain).
    const planned = evPlanned.get(e.id);
    const early = planned !== undefined && e.endAt < planned - EV_END_SLACK;
    if (early && !(style.earlyWin && e.p >= 1)) return;
    const b = eventBanner(e.kind, e.p >= 1 ? 'won' : 'lost', 0, eventCtx(d, w));
    if (b) announce(b, 2600, `ev:${e.id}:end`);
    return;
  }
  if (runOver || evEnded.has(e.id)) return;
  evPlanned.set(e.id, e.endAt);
  const cur = standing.value;
  const same = cur?.ev?.id === e.id;
  // the sim re-emits the phase every 5 s (late joiners, a moving event): a repeat only refreshes the planned end, never makes a second banner
  if (style.standing && same && cur?.ev) {
    if (cur.ev.phase === 'active' && e.phase === 'announce') return;
    if (cur.ev.phase === e.phase) {
      if (cur.ev.endAt !== e.endAt || cur.ev.startAt !== e.startAt) standing.value = { ...cur, ev: { ...cur.ev, startAt: e.startAt, endAt: e.endAt } };
      return;
    }
  }
  const key = `${e.id}:${e.phase}`;
  if (!style.standing && evShown.has(key)) return;
  evShown.add(key);
  const h = d.store.hud.value;
  const left = h ? Math.max(0, (e.phase === 'announce' ? e.startAt : e.endAt) - h.time) : 0;
  const b = eventBanner(e.kind, e.phase, left, eventCtx(d, w));
  if (!b) return;
  if (b.ev) b.ev = { ...b.ev, id: e.id, startAt: e.startAt, endAt: e.endAt };
  if (style.standing) {
    // a new stage is a new plate: the row opens again and the title pops, so the player sees the hunt begin
    const plate: Announcement = { ...b, id: seq++ };
    standing.value = h ? withSub(plate, h) : plate;
    hudGone = -1;
  } else {
    announce(b, style.tone === 'info' ? HINT_TTL_MS : 2500, `ev:${key}`);
  }
}

function bossLabel(id: string): { name: string; title: string } {
  const b = indexOf().bosses.get(id);
  return { name: b ? tl(b.name) : id, title: b ? tl(b.title) : '' };
}

/** Metin Rain's own active call ("The stones are falling!") is the banner on the feed right now */
function rainCallOn(): boolean {
  return list.value.some((a) => a.ev?.kind === 'metinRain' && a.ev.phase === 'active');
}

function metinLabel(id: string): { name: string; rune: string } {
  const m = indexOf().metins.get(id);
  return { name: m ? tl(m.name) : id, rune: m?.rune ?? '#ff9a2e' };
}

function onEvent(e: SimEvent, d: Pick<UiDeps, 'store' | 'content'>, w?: HintWorld): void {
  switch (e.t) {
    case 'metinWarn': {
      // Metin Rain: the sim emits the rain's 'active' event and, in the same tick, the first stone's warning. The feed keeps one banner and
      // the newest wins, so the stone's generic row would replace "The stones are falling!" before a frame draws it. The rain's call is the
      // news of that moment and holds its 2.5 s; the stones are still marked by their ground circles and the minimap (and the Great Metin
      // is never held back).
      if (!e.great && rainCallOn()) break;
      const m = metinLabel(e.def);
      announce({ tone: 'metin', title: t(e.great ? 'announce.greatMetinFalling' : 'announce.metinFalling'), sub: m.name, color: m.rune, big: e.great }, 3200, 'metinWarn');
      break;
    }
    case 'metinAwaken': {
      const m = metinLabel(e.def);
      announce({ tone: 'danger', title: t('announce.metinAwakened', { name: m.name }), color: m.rune }, 3400, `awaken${e.metin}`);
      break;
    }
    case 'metinBreak': {
      const m = metinLabel(e.def);
      announce({ tone: 'victory', title: t('announce.metinBroken', { name: m.name }), color: m.rune }, 2600, `break${e.metin}`);
      break;
    }
    case 'bossSpawn': {
      const b = bossLabel(e.bossId);
      // the final boss gets the climax card (A-11): the Great Metin has fallen and its boss rises, long and large (hud.css .is-final);
      // a band boss keeps the plate plus the smaller big-title card
      if (e.final) announce({ tone: 'boss', title: t('announce.finalCard', { name: b.name }), ...(b.title ? { sub: b.title } : {}), big: true, final: true }, FINAL_CARD_MS, `boss${e.boss}`);
      else announce({ tone: 'boss', title: t('announce.bossIncoming', { name: b.name }), sub: b.title, big: true }, 4600, `boss${e.boss}`);
      break;
    }
    case 'runEvent':
      onRunEvent(e, d, w);
      break;
    case 'runEnd':
      // the run is over: no verdict banner for an event the run cut short, and no standing plate over the end screen
      runOver = true;
      standing.value = null;
      break;
    case 'bossPhase': {
      const b = bossLabel(e.bossId);
      announce(
        e.enrage
          ? { tone: 'danger', title: t('announce.bossEnraged', { name: b.name }) }
          : { tone: 'boss', title: t('announce.bossPhase', { name: b.name, n: e.phase + 1 }) },
        3200,
        `phase${e.boss}:${e.phase}:${e.enrage}`,
      );
      break;
    }
    case 'bossDeath': {
      const b = bossLabel(e.bossId);
      announce({ tone: 'victory', title: t('announce.bossDefeated', { name: b.name }), big: true }, 4000, `bossdown${e.boss}`);
      break;
    }
    case 'playerRevive':
      announce({ tone: 'level', title: t('announce.revived') }, 2600);
      break;
    case 'chestLocked':
      announce({ tone: 'info', title: t('announce.chestLocked', { cost: fmtInt(e.cost), yeop: fmtInt(e.yeop) }) }, 2400, 'chestLocked');
      break;
    case 'chestOpen':
      announce({ tone: 'info', title: t('announce.chestOpened') }, 1800);
      break;
    case 'playerHit':
      if (e.result === 0 && e.player === 0) hitFlash.value++;
      break;
    case 'levelUp':
      if (e.player === 0) levelPop.value++;
      break;
    default:
      break;
  }
}

/**
 * Subscribes to the sim events, the HUD snapshot (the countdown of a run-event banner) and the store toasts; returns the unsubscribe.
 * `useAnnounceFeed` runs it while the HUD is mounted; the tests drive it with fake deps.
 */
export function attachAnnounceFeed(d: Pick<UiDeps, 'store' | 'content' | 'events'>): () => void {
  const off = d.events?.subscribe((e: SimEvent, w?: HintWorld) => onEvent(e, d, w));
  // the countdown of a run-event banner is the HUD snapshot's runEvent.left (host: the sim, guest: the mirrored clock)
  const offHud = d.store.hud.subscribe(onHudEvent);
  let seen = 0;
  const offToasts = d.store.toasts.subscribe((ts) => {
    for (const toast of ts) {
      if (toast.id <= seen) continue;
      seen = toast.id;
      const key = `announce.${toast.kind}`;
      const text = t(key, toast.data as Record<string, string | number>);
      if (text !== key) announce({ tone: 'info', title: text }, 2800, `toast:${toast.kind}`);
    }
  });
  // first-time hints: they wait for a free screen (no modal, no banner on), are shown through `announce` above and are taken back (and
  // queued again) when a modal or a replacing banner covers the plate before it was read
  const offHints = attachHints(d, hintPlates);
  return () => {
    off?.();
    offHud();
    offToasts();
    offHints();
    clearAnnouncements();
  };
}

/** Subscribes to sim events + the HUD snapshot + store toasts while the HUD is mounted. */
export function useAnnounceFeed(): void {
  useEffect(() => attachAnnounceFeed(deps()), []);
}
