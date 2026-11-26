// Run end: the big VICTORY / DEFEAT / RUN ABANDONED report, rebuilt on the kit (B10). `RunEndView` is shared by the run-end modal
// (over the frozen world) and the results screen (key-art backdrop). It settles the run exactly once (`settleOnce`), then tells the
// story in a staggered reveal: heading + hero SCORE → run stats (gem tiles) → talent XP (animated across point thresholds, painted
// gauge + flash per point) → spoils → banked currency + leaderboard rank. Clicking anywhere skips the tally.
// Layout (T16): one board, one hero number, six gem tiles + a ledger, number wells for every value, stone buttons.
import type { ComponentChildren, JSX, RefObject } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useSignal, type Signal } from '@preact/signals';
import { fmtCompact, fmtDec, fmtInt, fmtPct, fmtTime, t, tl, tn } from '../../i18n/i18n';
import type { L10n } from '../../data/schema';
import type { SubmitOutcome } from '../../meta';
import { FAVOUR_CAP, FAVOUR_PER_FAIL } from '../../meta/bonuses';
import { MAX_TALENT_POINTS, talentProgress, xpForPoints } from '../../meta/talents';
import type { RunResult } from '../../sim/run';
import type { ModalRequest } from '../../sim/types';
import { sfx } from '../audio';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { ClassEmblem } from '../components/Icon';
import { EmberField } from '../components/Modal';
import { Orb } from '../components/Orb';
import { Panel } from '../components/Panel';
import { ScrollCue, ScrollFade, type ScrollFadeState } from '../components/ScrollFade';
import { Counter, IconSlot } from '../components/Slot';
import { CurrencyIcon, UiGlyph, type UiGlyphName, type UiTone } from '../components/StatIcon';
import { StatWell } from '../components/StatWell';
import { TipBody, tipProps } from '../components/Tooltip';
import { Burst, GodRays, Motes, shineProps } from '../components/UiFx';
import { indexOf, rankLabel, skillName, zoneName } from '../content';
import { deps } from '../env';
import { buildTip, gearRarity } from '../itemTips';
import { layout } from '../layout';
import { focusFirst, useKeys, useScope } from '../nav';
import { settleOnce, type Settlement } from '../settlement';
import { armoryTab, metaSave, openView, resultToMenu, type ArmoryTab } from '../view';
import { RunGauge, useRunTextures, type RunGaugeKind } from './RunGauge';
import { RunGem, type RunStat } from './RunGem';
import { deathRecap, fmtSpan, nextInputs, nextSteps, type BossDot, type DeathRecap, type Killer, type NextStep } from './runRecap';
import { runTone, type Tone } from './runTone';
import './runend.css';

export interface RunEndViewProps {
  result: RunResult;
  onRetry(): void;
  onArmory(): void;
  onMenu(): void;
  variant: 'modal' | 'screen';
}

// The banner rule (victory / defeat / abandoned) lives in ./runTone.ts (pure, unit-tested).
export { runTone };

const TONE_KEY: Record<Tone, string> = { victory: 'runEnd.victory', defeat: 'runEnd.defeat', ended: 'runEnd.abandonedTitle' };
const TONE_SUB: Record<Tone, string> = { victory: 'runEnd.victorySub', defeat: 'runEnd.defeatSub', ended: 'runEnd.abandonedSub' };
/** the crest engraved on the heading orb: trophy (won), skull (fell), hourglass-clock (cut short) */
const TONE_CREST: Record<Tone, { glyph: UiGlyphName; tone: UiTone }> = {
  victory: { glyph: 'trophy', tone: 'gold' },
  defeat: { glyph: 'skull', tone: 'crimson' },
  ended: { glyph: 'clock', tone: 'pewter' },
};
const TONE_GLOW: Record<Tone, string> = { victory: 'rgba(255, 176, 60, 0.7)', defeat: 'rgba(210, 40, 28, 0.6)', ended: 'rgba(150, 170, 205, 0.4)' };

/** Sections animate in sequence: delay (ms) of reveal step `n`. */
const stepMs = (n: number): number => 350 + n * 170;

// ---------------------------------------------------------------------------------------------------------------
// leaderboard outcome

type RankState = { kind: 'pending' } | { kind: 'done'; outcome: SubmitOutcome } | { kind: 'none' };

function useSubmitOutcome(settled: Settlement | null): RankState {
  const [state, setState] = useState<RankState>(settled ? { kind: 'pending' } : { kind: 'none' });
  useEffect(() => {
    if (!settled) {
      setState({ kind: 'none' });
      return undefined;
    }
    let live = true;
    setState({ kind: 'pending' });
    settled.submit.then(
      (outcome) => live && setState({ kind: 'done', outcome }),
      () => live && setState({ kind: 'done', outcome: { kind: 'queued' } }),
    );
    return () => {
      live = false;
    };
  }, [settled]);
  return state;
}

/** `abandoned`: the run was cut short (runTone 'ended'); it is banked locally but never uploaded or ranked (ui/settlement.ts), so say that instead of 'online scores are off' */
function RankBlock({ state, abandoned }: { state: RankState; abandoned: boolean }): JSX.Element {
  if (abandoned) {
    return (
      <div class="ms-re-rank is-muted">
        <UiGlyph name="cloud" tone="pewter" flat />
        <span>{t('runEnd.rankAbandoned')}</span>
      </div>
    );
  }
  if (state.kind === 'none') {
    return (
      <div class="ms-re-rank is-muted">
        <UiGlyph name="cloud" tone="pewter" flat />
        <span>{t('runEnd.rankSkipped')}</span>
      </div>
    );
  }
  if (state.kind === 'pending') {
    return (
      <div class="ms-re-rank is-pending">
        <span class="ms-spinner ms-re-spin" />
        <span>{t('runEnd.rankSubmitting')}</span>
      </div>
    );
  }
  const o = state.outcome;
  if (o.kind === 'submitted') {
    const r = o.result;
    if (r.rank === null) {
      return (
        <div class="ms-re-rank is-warn">
          <UiGlyph name="lock" tone="crimson" flat />
          <span>{t('runEnd.rankFlagged')}</span>
        </div>
      );
    }
    return (
      <div class="ms-re-rank is-ranked">
        <div class="ms-re-rank-main">
          <UiGlyph name="trophy" tone="gold" flat />
          <b class="ms-num ms-re-rank-pos">{t('runEnd.rankPos', { n: fmtInt(r.rank) })}</b>
          {r.best && (
            <Chip tone="gold" size="sm">
              {t('runEnd.rankBest')}
            </Chip>
          )}
        </div>
        <div class="ms-re-rank-sub">
          {r.mode === 'coop' && (
            <Chip tone="info" size="sm">
              {t('runEnd.rankCoop')}
            </Chip>
          )}
          {r.weekRank !== null && (
            <Chip size="sm">{t('runEnd.rankWeek', { n: fmtInt(r.weekRank) })}</Chip>
          )}
          {r.classRank !== null && (
            <Chip size="sm">{t('runEnd.rankClass', { n: fmtInt(r.classRank) })}</Chip>
          )}
        </div>
      </div>
    );
  }
  if (o.kind === 'queued') {
    return (
      <div class="ms-re-rank is-muted">
        <UiGlyph name="cloud" tone="pewter" flat />
        <span>{t('runEnd.rankQueued')}</span>
      </div>
    );
  }
  if (o.kind === 'rejected') {
    return (
      <div class="ms-re-rank is-warn">
        <UiGlyph name="close" tone="crimson" flat />
        <span>{t('runEnd.rankRejected')}</span>
      </div>
    );
  }
  return (
    <div class="ms-re-rank is-muted">
      <UiGlyph name="cloud" tone="pewter" flat />
      <span>{t('runEnd.rankSkipped')}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// talent XP bar: animates from the old progress to the new one across point thresholds

export interface TalentBarInput {
  before: number;
  after: number;
  pointsBefore: number;
  pointsAfter: number;
  pointsGained: number;
  capBefore?: number;
  cap?: number;
}

export interface TalentBarModel {
  capBefore: number;
  cap: number;
  pointsBefore: number;
  pointsAfter: number;
  gained: number;
  p0: number;
  p1: number;
  nextXp: number | null;
}

export function talentBarModel(input: TalentBarInput): TalentBarModel {
  const capBefore = Math.max(0, Math.floor(input.capBefore ?? MAX_TALENT_POINTS));
  const cap = Math.max(capBefore, Math.floor(input.cap ?? capBefore));
  const a = talentProgress(input.before, capBefore);
  const b = talentProgress(input.after, cap);
  const pointsBefore = Math.max(0, Math.min(capBefore, Math.floor(input.pointsBefore)));
  const pointsAfter = Math.max(0, Math.min(cap, Math.floor(input.pointsAfter)));
  const gained = Math.max(0, Math.floor(input.pointsGained));
  const p0 = pointsBefore >= capBefore || a.next === null ? pointsBefore : pointsBefore + a.fraction;
  const p1 = pointsAfter >= cap || b.next === null ? pointsAfter : pointsAfter + b.fraction;
  return { capBefore, cap, pointsBefore, pointsAfter, gained, p0, p1, nextXp: b.next };
}

export function talentBarFrame(p: number, cap: number): { points: number; capped: boolean; frac: number; span: number } {
  const safeCap = Math.max(0, Math.floor(cap));
  const points = Math.min(safeCap, Math.max(0, Math.floor(p + 1e-6)));
  const capped = points >= safeCap;
  const frac = capped ? 1 : Math.min(1, Math.max(0, p - points));
  const span = capped ? 0 : xpForPoints(points + 1, safeCap) - xpForPoints(points, safeCap);
  return { points, capped, frac, span };
}

export function TalentBar({ before, after, pointsBefore, pointsAfter, pointsGained, capBefore, cap, skipped, delay, label }: TalentBarInput & { skipped: boolean; delay: number; label: string }): JSX.Element {
  const m = talentBarModel({ before, after, pointsBefore, pointsAfter, pointsGained, ...(capBefore !== undefined ? { capBefore } : {}), ...(cap !== undefined ? { cap } : {}) });
  const { p0, p1, gained } = m;





  const [p, setP] = useState(p0);
  useEffect(() => {
    if (skipped || p1 <= p0) {
      setP(p1);
      return undefined;
    }
    const dur = Math.min(4200, 1300 + 420 * (Math.floor(p1) - Math.floor(p0)));
    let raf = 0;
    let start = 0;
    const tick = (now: number): void => {
      if (start === 0) start = now + delay;
      const k = Math.min(1, Math.max(0, (now - start) / dur));
      setP(p0 + (p1 - p0) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [p0, p1, skipped, delay]);

  const { points, capped, frac, span } = talentBarFrame(p, m.cap);



  const done = p >= p1 - 1e-6;
  const celebrated = useRef(false);
  const lastPoints = useRef(points);
  const [flash, setFlash] = useState(0);
  // one flash + tick per threshold crossed while the bar sweeps (the old bar only played one sound at the very end)
  useEffect(() => {
    if (points > lastPoints.current && p > p0) {
      setFlash((n) => n + 1);
      sfx('tab');
    }
    lastPoints.current = points;
  }, [points, p, p0]);
  useEffect(() => {
    if (done && gained > 0 && !celebrated.current && p > p0) {
      celebrated.current = true;
      sfx('unlock');
    }
  }, [done, gained, p, p0]);

  return (
    <>
      <div class="ms-re-bar">
        <RunGauge kind="gold" value={frac} ch="1.35rem" flash={flash} ticks={10} label={capped ? t('runEnd.talentMax') : `${fmtInt(frac * span)} / ${fmtInt(span)}`} />
      </div>
      <div class="ms-re-points">
        <span class="ms-re-points-line">
          <span class="ms-re-points-l">{label}</span>
          <StatWell
            key={points}
            size="md"
            tone="gold"
            value={
              <>
                {fmtInt(points)}
                <span class="ms-re-points-max"> / {m.cap}</span>
              </>
            }
          />
        </span>
        {gained > 0 && done && (
          <Chip tone="gold" class="ms-re-points-chip" icon={<UiGlyph name="star" tone="ivory" flat />}>
            {tn('runEnd.pointsGained', gained)}
          </Chip>
        )}
        {gained === 0 && !capped && m.nextXp !== null && <span class="ms-re-points-next">{t('runEnd.talentNext', { n: fmtInt(Math.max(0, m.nextXp - after)) })}</span>}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// stat tiles

interface StatCell {
  key: RunStat;
  label: string;
  tip: string;
  node: JSX.Element;
  chip?: string;
}

/** damage-meter colour: the element's tint on the painted fill (physical + holy stay gold, fire red, cold / storm blue) */
function meterFill(el: string | undefined): { kind: RunGaugeKind; hue?: number } {
  switch (el) {
    case 'fire':
      return { kind: 'red' };
    case 'ice':
    case 'lightning':
      return { kind: 'blue' };
    case 'poison':
      return { kind: 'gold', hue: 62 };
    case 'wind':
      return { kind: 'gold', hue: 126 };
    case 'dark':
      return { kind: 'gold', hue: 236 };
    default:
      return { kind: 'gold' };
  }
}

function bigTile(c: StatCell, delay: number): JSX.Element {
  return (
    <div key={c.key} class={`ms-re-tile ${c.chip ? 'has-chip' : ''}`} {...tipProps(() => <TipBody title={c.label} body={c.tip} />)}>
      <RunGem stat={c.key} />
      <span class="ms-re-tile-b">
        <span class="ms-re-tile-l">{c.label}</span>
        <StatWell size="md" left value={c.node} />
      </span>
      {c.chip && (
        <span class="ms-re-tile-new ms-stamp" style={{ '--stamp-delay': `${delay}ms` } as JSX.CSSProperties} {...tipProps(() => <TipBody title={c.chip} />)}>
          <UiGlyph name="star" tone="ivory" flat />
        </span>
      )}
    </div>
  );
}

function ledgerRow(c: StatCell): JSX.Element {
  return (
    <div key={c.key} class="ms-re-led" {...tipProps(() => <TipBody title={c.label} body={c.tip} />)}>
      <RunGem stat={c.key} class="ms-re-gem--sm" />
      <span class="ms-re-led-l">{c.label}</span>
      <StatWell size="sm" value={c.node} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------

/**
 * Phone tiers: the whole report (banner included) scrolls above the pinned action bar, so a row was cut mid-line at the bar with only a dot
 * for a cue. This feeds the bar's fade + chevron (ScrollCue): `end` is false while more than a hair of the report lies below the view.
 * Re-measured on scroll, on resize of the view or of any direct child, when an entry animation lands (their transforms count as
 * scrollable overflow) and when the fonts arrive. Never scrolls on the desktop tiers (overflow is not auto there): nothing shows.
 */
function useMoreBelow(ref: RefObject<HTMLElement>, state: Signal<ScrollFadeState>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let raf = 0;
    let disposed = false;
    const apply = (): void => {
      raf = 0;
      if (disposed) return;
      raf = 0;
      const scrolls = /(auto|scroll)/.test(getComputedStyle(el).overflowY);
      const more = scrolls && el.scrollHeight - el.scrollTop - el.clientHeight > 8;
      const away = scrolls && el.scrollTop > 8;
      const cur = state.value;
      if (cur.scrollable !== (more || away) || cur.end === more || cur.start === away) state.value = { scrollable: more || away, start: !away, end: !more };
    };
    const schedule = (): void => {
      if (!disposed && !raf) raf = requestAnimationFrame(apply);
    };
    apply();
    el.addEventListener('scroll', schedule, { passive: true });
    el.addEventListener('animationend', schedule);
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    ro?.observe(el);
    for (const c of Array.from(el.children)) ro?.observe(c);
    void document.fonts?.ready.then(() => {
      if (!disposed) schedule();
    });
    const timer = window.setTimeout(schedule, 1500);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      el.removeEventListener('scroll', schedule);
      el.removeEventListener('animationend', schedule);
      ro?.disconnect();
    };
  }, [ref, state]);
}

// ---------------------------------------------------------------------------------------------------------------
// death recap (RP-01): who struck, where the run ended on the boss timeline, what to do next. Rules live in ./runRecap.ts.

const MARK = '\u2063'; // INVISIBLE SEPARATOR: cannot appear in a translation

/**
 * A translated line with nodes in its slots: the line stays ONE string per language, so a language may put the time, the killer or the
 * boss anywhere in it (and decline them as it needs); the slots are cut out of the finished text.
 */
function tNodes(key: string, nodes: Record<string, ComponentChildren>): ComponentChildren[] {
  const marked = t(key, Object.fromEntries(Object.keys(nodes).map((k) => [k, `${MARK}${k}${MARK}`])));
  return marked.split(MARK).map((part, i) => (i % 2 === 1 ? (nodes[part] ?? '') : part));
}

function killerText(k: Killer): string {
  switch (k.kind) {
    case 'enemy':
    case 'boss':
      return tl(k.name);
    case 'metin':
      return t('report.killer.metin', { name: tl(k.name) });
    case 'hazard':
      return k.id === 'lava' ? t('report.killer.hazard.lava') : k.id === 'miasma' ? t('report.killer.hazard.miasma') : t('report.killer.hazard.zone');
  }
}

const KILLER_GEM: Record<Killer['kind'], RunStat | null> = { enemy: 'kills', boss: 'bosses', metin: 'metins', hazard: null };

/** the defeat header's line: "Fell at 06:37 to Grizzly Bear" and, behind it, "2:23 before Ung-Jae" */
function FellLine({ recap }: { recap: DeathRecap }): JSX.Element | null {
  if (recap.fellAt === null) return null;
  const when = <b class="ms-num ms-re-fell-t">{fmtTime(recap.fellAt)}</b>;
  const k = recap.killer;
  const gem = k ? KILLER_GEM[k.kind] : null;
  const lead = k ? tNodes('report.fell.killer', { time: when, killer: <b class={`ms-re-fell-k is-${k.kind}`}>{killerText(k)}</b> }) : tNodes('report.fell.nokiller', { time: when });
  // the final boss that struck the hero is already named by the killer clause: do not say it twice
  const n = recap.next && recap.next.kind === 'final' && k?.kind === 'boss' && k.id === recap.next.id ? null : recap.next;
  const next = !n
    ? null
    : n.kind === 'boss'
      ? tNodes('report.fell.next', { span: <b class="ms-num">{fmtSpan(n.inSec)}</b>, boss: <b>{tl(n.name)}</b> })
      : tNodes('report.fell.final', { boss: <b>{tl(n.name)}</b> });
  return (
    <p class="ms-re-fell" data-killer={k?.kind ?? 'none'}>
      <span class="ms-re-fell-lead">
        {gem ? <RunGem stat={gem} class="ms-re-gem--xs" /> : <UiGlyph name={k ? 'flame' : 'skull'} tone="crimson" flat />}
        <span>{lead}</span>
      </span>
      {next && <span class="ms-re-fell-next">{next}</span>}
    </p>
  );
}

/** five dots, one per boss of the zone, in the order they arrive: defeated / arrived and standing / still ahead */
function BossStrip({ dots, bosses }: { dots: BossDot[]; bosses: ReadonlyMap<string, { name: L10n }> }): JSX.Element {
  const killed = dots.filter((d) => d.state === 'killed').length;
  return (
    <div class="ms-re-bosses">
      <span class="ms-re-recap-l">{t('report.bosses.title')}</span>
      <ol class="ms-re-dots" aria-label={`${t('report.bosses.list')}: ${t('report.bosses.count', { n: fmtInt(killed), total: fmtInt(dots.length) })}`}>
        {dots.map((d) => {
          const name = tl(bosses.get(d.id)?.name);
          const state = d.state === 'killed' ? t('report.dot.killed') : d.state === 'reached' ? t('report.dot.reached') : t('report.dot.ahead', { time: fmtTime(d.at) });
          const body = d.final ? `${t('report.dot.final')} · ${state}` : state;
          return (
            <li key={d.id} class={`ms-re-dot is-${d.state} ${d.final ? 'is-final' : ''}`} aria-label={`${name}: ${body}`} {...tipProps(() => <TipBody title={name} body={body} />)}>
              <i class="ms-re-dot-m" aria-hidden="true" />
              <span class="ms-re-dot-t ms-num" aria-hidden="true">
                {fmtSpan(d.at)}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function RunEndView({ result, onRetry, onArmory, onMenu, variant }: RunEndViewProps): JSX.Element {
  const { content } = deps();
  const ix = indexOf(content);
  const scope = useScope();
  const t0 = useRef(performance.now());
  const [skipped, setSkipped] = useState(false);
  const settled = useMemo(() => settleOnce(result), [result]);
  const summary = settled?.summary ?? null;
  const rank = useSubmitOutcome(settled);
  const tone = runTone(result);
  const lay = layout.value;
  const retrySize = lay.compact ? 'small' : lay.h < 820 ? 'normal' : 'big';
  const coop = result.players.length > 1;
  const subSize = lay.compact ? 'small' : 'normal';
  const tex = useRunTextures();
  const inner = useRef<HTMLDivElement>(null);
  const more = useSignal<ScrollFadeState>({ scrollable: false, start: true, end: true });
  useMoreBelow(inner, more);

  const zone = ix.zones.get(result.zone);
  const cls = ix.classes.get(result.classId);
  const doctrine = cls?.doctrines.find((d) => d.id === result.doctrine);

  // RP-01: the death recap of a defeat (never on a victory or an abandoned run). The next steps read the profile as the run settled it,
  // once per settlement (a later save change must not reshuffle the chips mid-reveal).
  const recap = useMemo(() => (tone === 'defeat' ? deathRecap(result, zone, ix) : null), [tone, result, zone, ix]);
  const steps = useMemo<NextStep[]>(
    () => (tone === 'defeat' && summary ? nextSteps(nextInputs(metaSave().peek(), content, result, summary.talentXp.available)) : []),
    [tone, summary, content, result],
  );
  const goArmory = (tab: ArmoryTab): void => {
    armoryTab.value = tab;
    onArmory();
  };

  useEffect(() => {
    sfx(tone === 'victory' ? 'unlock' : 'close');
    const id = requestAnimationFrame(() => {
      if (!layout.value.touch) focusFirst();
    });
    return () => cancelAnimationFrame(id);
  }, [tone]);

  const armed = (): boolean => performance.now() - t0.current > 700;
  const act = (fn: () => void) => (): void => {
    if (armed()) fn();
  };
  /** one chip of the next-step row: talents and the Blacksmith are buttons into the Armory, the Sky Sovereign's favour is a note */
  const stepNode = (s: NextStep): JSX.Element | null => {
    if (s.kind === 'talents') {
      return (
        <span key="talents" class="ms-re-stepwrap" {...tipProps(() => <TipBody title={tn('report.next.talents', s.points)} body={t('report.next.talentsTip')} />)}>
          <Button variant="wood" size="small" class="ms-re-step" onClick={act(() => goArmory('talents'))}>
            <UiGlyph name="star" tone="gold" flat /> {tn('report.next.talents', s.points)}
          </Button>
        </span>
      );
    }
    if (s.kind === 'smith') {
      const def = ix.gear.get(s.offer.gearId);
      if (!def) return null;
      const label = t('report.next.smith', { gear: tl(def.name), to: s.offer.to });
      const tip = t('report.next.smithTip', { rate: fmtPct(s.offer.rate), yeop: fmtInt(s.offer.yeop), shards: fmtInt(s.offer.shards) });
      return (
        <span key="smith" class="ms-re-stepwrap" {...tipProps(() => <TipBody title={label} body={tip} />)}>
          <Button variant="wood" size="small" class="ms-re-step" onClick={act(() => goArmory('blacksmith'))}>
            <UiGlyph name="shield" tone="gold" flat /> {label}
          </Button>
        </span>
      );
    }
    const per = fmtInt(Math.round(FAVOUR_PER_FAIL * 100));
    const cap = fmtInt(Math.round(FAVOUR_CAP * 100));
    return (
      <span key="favour" class="ms-re-favour" {...tipProps(() => <TipBody title={t('report.next.favour')} body={t('report.next.favourTip', { zone: zone ? tl(zone.name) : result.zone, per, cap })} />)}>
        <UiGlyph name="heart" tone="crimson" flat />
        <span>{t('report.next.favour')}</span>
        <b class="ms-num">{t('report.next.favourPct', { pct: fmtInt(s.pct) })}</b>
      </span>
    );
  };
  const skip = (): void => {
    if (!skipped && performance.now() - t0.current < 7000) setSkipped(true);
  };
  useKeys((a) => {
    if (a.kind !== 'cancel') return false;
    if (!skipped && performance.now() - t0.current < 4000) setSkipped(true);
    else if (armed()) onMenu();
    return true;
  });

  const records = summary?.records;
  const ro = result.runOptions;
  const optChips = (['density', 'health', 'damage', 'speed'] as const).flatMap((k) => (ro && Math.abs((ro[k] ?? 1) - 1) > 1e-6 ? [{ k, v: ro[k] }] : []));
  const rewardMul = result.rewardMul ?? 1;
  const countMs = skipped ? 1 : 1100;
  const count = (value: number, format: (n: number) => string): JSX.Element => <Counter value={value} format={format} ms={countMs} delay={stepMs(2)} />;
  // the six big gem tiles ...
  const tiles: StatCell[] = [
    { key: 'time', label: t('runEnd.time'), tip: t('runEnd.tip.time'), node: count(result.time, fmtTime), ...(records?.time ? { chip: t('runEnd.newBest') } : {}) },
    { key: 'level', label: t('runEnd.level'), tip: t('runEnd.tip.level'), node: count(result.level, fmtInt), ...(records?.level ? { chip: t('runEnd.newBest') } : {}) },
    { key: 'kills', label: t('runEnd.kills'), tip: t('runEnd.tip.kills'), node: count(result.kills, fmtInt) },
    { key: 'bosses', label: t('runEnd.bosses'), tip: t('runEnd.tip.bosses'), node: count(result.bossesKilled.length, fmtInt) },
    { key: 'damage', label: t('runEnd.damage'), tip: t('runEnd.tip.damage'), node: count(result.damageDealt, fmtCompact) },
    { key: 'yeop', label: t('runEnd.yeopCollected'), tip: t('runEnd.tip.yeop'), node: count(result.yeop, fmtInt) },
  ];
  // ... and the four quieter ones in the ledger
  const ledger: StatCell[] = [
    { key: 'elites', label: t('runEnd.elites'), tip: t('runEnd.tip.elites'), node: count(result.elitesKilled, fmtInt) },
    { key: 'metins', label: t('runEnd.metins'), tip: t('runEnd.tip.metins'), node: count(result.metinsBroken, fmtInt) },
    { key: 'chests', label: t('runEnd.chests'), tip: t('runEnd.tip.chests'), node: count(result.chestsOpened, fmtInt) },
    { key: 'taken', label: t('runEnd.damageTaken'), tip: t('runEnd.tip.damageTaken'), node: count(result.damageTaken, fmtCompact) },
  ];

  // damage meter
  const meter = result.damageBySkill.slice(0, 8);
  const meterTotal = Math.max(1, result.damageDealt, result.damageBySkill.reduce((s, m) => s + m.damage, 0));
  const meterMax = Math.max(1, meter[0]?.damage ?? 1);
  const avgDps = result.time > 0 ? result.damageDealt / result.time : 0;

  // talent xp
  const xp = summary?.talentXp ?? null;
  const xpAll: { key: RunStat; label: string; value: number }[] = xp
    ? [
        { key: 'time', label: t('runEnd.xp.time'), value: xp.time },
        { key: 'kills', label: t('runEnd.xp.kills'), value: xp.kills },
        { key: 'elites', label: t('runEnd.xp.elites'), value: xp.elites },
        { key: 'bosses', label: t('runEnd.xp.bosses'), value: xp.bosses },
        { key: 'metins', label: t('runEnd.xp.metins'), value: xp.metins },
        { key: 'victory', label: t('runEnd.xp.victory'), value: xp.victory },
      ]
    : [];
  const xpRows = xpAll.filter((r) => Math.round(r.value) > 0);

  // spoils
  const drops = summary?.drops ?? [];
  const newCount = drops.filter((d) => d.isNew).length;

  const unlocks = summary?.unlocks;
  const unlockLines: { key: string; text: string; glyph: UiGlyphName }[] = [];
  if (unlocks) {
    for (const z of unlocks.zones) unlockLines.push({ key: `z:${z}`, glyph: 'lock', text: t('runEnd.unlockZone', { name: zoneName(z) }) });
    for (const z of unlocks.hard) unlockLines.push({ key: `h:${z}`, glyph: 'flame', text: t('runEnd.unlockHard', { name: zoneName(z) }) });
    if (unlocks.codex.length > 0) unlockLines.push({ key: 'codex', glyph: 'book', text: tn('runEnd.unlockCodex', unlocks.codex.length) });
  }

  const sectionStyle = (n: number): JSX.CSSProperties => ({ '--i': n }) as JSX.CSSProperties;
  const rootCls = [
    'ms-re-root',
    `ms-re-root--${variant}`,
    variant === 'screen' ? 'ms-screen' : 'ms-modal ms-modal--blur',
    `ms-re--${tone}`,
    skipped ? 'is-skipped' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const title = t(TONE_KEY[tone]);
  const crest = TONE_CREST[tone];
  const shine = shineProps(title, { delay: 0.7 });

  return (
    <div class={rootCls} ref={scope} role="dialog" aria-modal={variant === 'modal' ? 'true' : undefined} aria-label={title} onPointerDown={skip} style={tex}>
      {variant === 'screen' && (
        <>
          <div class="ms-backdrop ms-backdrop--art" />
          <div class="ms-re-mood" aria-hidden="true" />
          <EmberField count={20} />
        </>
      )}
      <Panel variant="board" ornate class="ms-re-panel" title={t('runEnd.report')} titleIcon={<UiGlyph name={crest.glyph} tone="gold" flat />}>
        <div class={`ms-re-inner ${more.value.scrollable ? 'is-scrollable' : ''} ${more.value.start ? '' : 'is-away'}`} ref={inner}>
          <header class="ms-re-banner">
            <div class="ms-re-fx" aria-hidden="true">
              {tone === 'victory' && (
                <>
                  <GodRays tone="gold" rays={30} seed={11} x="12%" y="52%" size="80vmax" intensity={0.8} spin={190} />
                  <Motes preset="gold" count={30} seed={5} x={0.35} y={0.9} spread={1.2} intensity={0.9} />
                  <Burst play={1} tone="gold" x="12%" y="64%" scale={0.9} sparks={40} />
                </>
              )}
              {tone === 'defeat' && (
                <>
                  <GodRays tone="crimson" rays={24} seed={4} x="12%" y="52%" size="70vmax" intensity={0.5} spin={260} />
                  <Motes preset="snow" count={22} seed={9} color="#9b948b" intensity={0.55} speed={0.6} />
                </>
              )}
              {tone === 'ended' && <Motes preset="snow" count={14} seed={3} color="#aab4c8" intensity={0.4} speed={0.5} />}
            </div>
            <div class="ms-re-crest ms-stamp" style={{ '--stamp-delay': '120ms' } as JSX.CSSProperties}>
              <Orb size="var(--re-orb, 7.4rem)" glow={TONE_GLOW[tone]}>
                <UiGlyph name={crest.glyph} tone={crest.tone} size="calc(var(--re-orb, 7.4rem) * 0.5)" />
              </Orb>
            </div>
            <div class="ms-re-head">
              <h1 class={`ms-re-title ${shine.class}`} data-text={shine['data-text']} style={{ ...(shine.style ?? {}), '--n': Math.max(5, title.length) } as JSX.CSSProperties}>
                {title}
              </h1>
              {/* the factual line takes the italic lede's place: the record says more than the flavour does, and the board keeps its height */}
              {recap && recap.fellAt !== null ? <FellLine recap={recap} /> : <p class="ms-re-lede">{t(TONE_SUB[tone])}</p>}
              <div class="ms-re-meta">
                <span class="ms-re-who">
                  <ClassEmblem classId={result.classId} size="1.6rem" />
                  <span class="ms-head">{cls ? tl(cls.name) : result.classId}</span>
                  {doctrine && <span class="ms-muted">· {tl(doctrine.name)}</span>}
                </span>
                <span class="ms-re-sep" aria-hidden="true" />
                <span class="ms-re-zone">{zone ? tl(zone.name) : result.zone}</span>
                <Chip tone={result.difficulty === 'hard' ? 'red' : 'neutral'} size="sm">
                  {t(`runEnd.difficulty.${result.difficulty}`)}
                </Chip>
              </div>
            </div>
            {(optChips.length > 0 || rewardMul > 1.0001) && (
              <div class="ms-re-opts">
                {optChips.length > 0 && <span class="ms-eyebrow ms-re-opts-label">{t('runEnd.custom')}</span>}
                {optChips.map((o) => (
                  <Chip key={o.k} size="sm" class="ms-re-opt">
                    {t(`runEnd.opt.${o.k}`)} ×{fmtDec(o.v, 2)}
                  </Chip>
                ))}
                {rewardMul > 1.0001 && (
                  <Chip tone="gold" size="sm">
                    {t('runEnd.rewardMul', { m: fmtDec(rewardMul, 2) })}
                  </Chip>
                )}
              </div>
            )}

            {summary ? (
              <div class="ms-re-score ms-re-sec" style={sectionStyle(1)} {...tipProps(() => <TipBody title={t('runEnd.score')} body={t('runEnd.tip.score')} />)}>
                <span class="ms-re-score-l">{t('runEnd.score')}</span>
                <StatWell size="hero" tone="gold" class="ms-re-score-well" value={<Counter value={summary.score} format={fmtInt} ms={skipped ? 1 : 1500} delay={stepMs(2)} />} />
                {records?.score && (
                  <Chip tone="new" class="ms-re-record ms-stamp" icon={<UiGlyph name="star" tone="ivory" flat />}>
                    {t('runEnd.newRecord')}
                  </Chip>
                )}
                <RankBlock state={rank} abandoned={tone === 'ended'} />
              </div>
            ) : (
              <div class="ms-re-score ms-re-sec is-failed" style={sectionStyle(1)}>
                <span class="ms-re-score-l">{t('runEnd.score')}</span>
                <p class="ms-re-failed">
                  <UiGlyph name="warn" tone="crimson" flat /> {t('runEnd.settleFailed')}
                </p>
              </div>
            )}
          </header>

          {recap && (recap.dots || steps.length > 0) && (
            <div class="ms-re-recap ms-re-sec" style={sectionStyle(1)}>
              {recap.dots && <BossStrip dots={recap.dots} bosses={ix.bosses} />}
              {steps.length > 0 && (
                <div class="ms-re-next">
                  <span class="ms-re-recap-l">{t('report.next.title')}</span>
                  <div class="ms-re-steps">{steps.map((s) => stepNode(s))}</div>
                </div>
              )}
            </div>
          )}

          {unlockLines.length > 0 && (
            <div class="ms-re-strip ms-re-sec" style={sectionStyle(1)}>
              <span class="ms-re-strip-l">{t('runEnd.unlocks')}</span>
              {unlockLines.map((u, i) => (
                <Chip key={u.key} tone="gold" size="sm" class="ms-re-unlock" icon={<UiGlyph name={u.glyph} tone="ivory" flat />}>
                  <span style={{ animationDelay: `${stepMs(1) + i * 160}ms` }}>{u.text}</span>
                </Chip>
              ))}
            </div>
          )}

          <ScrollFade class="ms-re-bodywrap" viewClass="ms-re-body" cue="end" size="1.6rem">
            <div class="ms-re-col ms-re-col--left">
              <section class="ms-re-card ms-re-sec ms-re-stats" style={sectionStyle(2)}>
                <h2 class="ms-re-h">
                  <span class="ms-re-h-t">{t('runEnd.summary')}</span>
                </h2>
                <div class="ms-re-tiles">{tiles.map((c) => bigTile(c, stepMs(3)))}</div>
                <div class="ms-re-ledger">{ledger.map(ledgerRow)}</div>
                {result.players.length > 1 && (
                  <div class="ms-re-party">
                    <span class="ms-eyebrow">{t('runEnd.party')}</span>
                    {result.players.map((pl) => (
                      <Chip key={pl.index} size="sm" class={pl.alive ? '' : 'is-dead'} icon={pl.alive ? undefined : <UiGlyph name="skull" tone="pewter" flat />}>
                        {t('runEnd.partyMember', { n: pl.index + 1, level: pl.level, kills: fmtInt(pl.kills) })}
                      </Chip>
                    ))}
                  </div>
                )}
              </section>

              <section class="ms-re-card ms-re-sec ms-re-meter" style={sectionStyle(3)}>
                <h2 class="ms-re-h">
                  <span class="ms-re-h-t">{t('runEnd.damageMeter')}</span>
                </h2>
                {meter.length === 0 ? (
                  <p class="ms-muted ms-re-empty">{t('hud.damageMeter.empty')}</p>
                ) : (
                  <ol class="ms-re-meter-list">
                    {meter.map((m, i) => {
                      const def = ix.skills.get(m.skillId);
                      const fill = meterFill(def?.element);
                      const share = Math.max(0.02, m.damage / meterMax);
                      return (
                        <li key={m.skillId} class={`ms-re-m ${i === 0 ? 'is-top' : ''}`} {...tipProps(() => buildTip({ type: 'skill', id: m.skillId, rank: m.rank }))}>
                          <IconSlot size="xs" icon={def?.icon ?? `icon_skill_${m.skillId}`} kind="skill" {...(def ? { element: def.element } : {})} />
                          <span class="ms-re-m-name">
                            {skillName(m.skillId)} <i class="ms-num">{rankLabel(m.rank)}</i>
                          </span>
                          <RunGauge class="ms-re-m-bar" kind={fill.kind} {...(fill.hue !== undefined ? { hue: fill.hue } : {})} value={share} ch="0.62rem" grow={stepMs(3) + i * 90} />
                          <span class="ms-re-m-val ms-num">{fmtCompact(m.damage)}</span>
                          <span class="ms-re-m-pct ms-num">{fmtPct(m.damage / meterTotal)}</span>
                        </li>
                      );
                    })}
                  </ol>
                )}
                <div class="ms-re-meter-foot">
                  <StatWell layout="row" size="sm" label={t('hud.total')} value={fmtCompact(result.damageDealt)} />
                  <StatWell layout="row" size="sm" label={t('runEnd.dps')} value={fmtCompact(avgDps)} />
                </div>
              </section>
            </div>

            <div class="ms-re-col ms-re-col--right">
              {summary && xp ? (
                <section class="ms-re-card ms-re-sec ms-re-xp" style={sectionStyle(4)}>
                  <h2 class="ms-re-h">
                    <span class="ms-re-h-t">{t('runEnd.talentXp')}</span>
                    <span class="ms-re-h-x">
                      {xp.zoneMult !== 1 && (
                        <span {...tipProps(() => <TipBody title={t('runEnd.xpMult.zone', { m: fmtDec(xp.zoneMult, 2) })} body={t('runEnd.xpMult.zoneTip')} />)}>
                          <Chip size="sm">{t('runEnd.xpMult.zone', { m: fmtDec(xp.zoneMult, 2) })}</Chip>
                        </span>
                      )}
                      {xp.difficultyMult !== 1 && (
                        <span {...tipProps(() => <TipBody title={t('runEnd.xpMult.difficulty', { m: fmtDec(xp.difficultyMult, 2) })} body={t('runEnd.xpMult.difficultyTip')} />)}>
                          <Chip size="sm" tone="red">
                            {t('runEnd.xpMult.difficulty', { m: fmtDec(xp.difficultyMult, 2) })}
                          </Chip>
                        </span>
                      )}
                    </span>
                  </h2>
                  <div class="ms-re-xp-top">
                    <div class="ms-re-xp-rows">
                      {xpRows.map((r) => (
                        <div key={r.key} class="ms-re-xp-row">
                          <RunGem stat={r.key} class="ms-re-gem--xs" />
                          <span class="ms-re-xp-lab">{r.label}</span>
                          <b class="ms-num">+{fmtInt(r.value)}</b>
                        </div>
                      ))}
                    </div>
                    <div class="ms-re-xp-total" {...tipProps(() => <TipBody title={t('runEnd.talentXp')} />)}>
                      <span class="ms-re-xp-total-l">{t('runEnd.talentXp')}</span>
                      <StatWell size="lg" tone="gold" value={<>+<Counter value={xp.total} format={fmtInt} ms={countMs} delay={stepMs(4)} /></>} />
                    </div>
                  </div>
                  <TalentBar
                    before={xp.before}
                    after={xp.after}
                    pointsBefore={xp.pointsBefore}
                    pointsAfter={xp.pointsAfter}
                    pointsGained={xp.pointsGained}
                    capBefore={xp.capBefore}
                    cap={xp.cap}
                    skipped={skipped}
                    delay={stepMs(4)}
                    label={t('runEnd.talentPointsLine', { class: cls ? tl(cls.name) : result.classId })}
                  />
                </section>
              ) : (
                <section class="ms-re-card ms-re-sec ms-re-xp is-failed" style={sectionStyle(4)}>
                  <h2 class="ms-re-h">
                    <span class="ms-re-h-t">{t('runEnd.talentXp')}</span>
                  </h2>
                  <p class="ms-bad ms-re-failed">
                    <UiGlyph name="warn" tone="crimson" flat /> {t('runEnd.settleFailed')}
                  </p>
                  <StatWell layout="row" size="md" tone="gold" label={t('runEnd.talentXp')} value={`+${fmtInt(result.talentXp)}`} />
                </section>
              )}

              {summary && (
                <section class="ms-re-card ms-re-sec ms-re-spoils" style={sectionStyle(5)}>
                  <h2 class="ms-re-h">
                    <span class="ms-re-h-t">{t('runEnd.drops')}</span>
                    <span class="ms-re-h-x ms-re-spoils-count">{drops.length === 0 ? '' : newCount > 0 ? t('runEnd.dropsNew', { n: newCount }) : t('runEnd.dropsDupes')}</span>
                  </h2>
                  <Panel variant="sunken" framed class="ms-re-tray">
                    {drops.length === 0 ? (
                      <div class="ms-re-nodrops">
                        <UiGlyph name="chest" tone="pewter" size="2.6rem" />
                        <div>
                          <b>{t('runEnd.noDrops')}</b>
                          <span class="ms-muted">{t('runEnd.noDropsHint')}</span>
                        </div>
                      </div>
                    ) : (
                      <div class="ms-re-drops">
                        {drops.map((d, i) => {
                          const def = ix.gear.get(d.gearId);
                          const rarity = def ? gearRarity(def.tier) : 'common';
                          const boss = d.source.kind === 'boss' ? ix.bosses.get(d.source.key) : undefined;
                          return (
                            <div
                              key={`${d.gearId}:${i}`}
                              class={`ms-re-drop ms-r-${rarity} ${d.isNew ? 'is-new' : 'is-dupe'}`}
                              style={{ '--dd': `${stepMs(5) + i * 200}ms` } as JSX.CSSProperties}
                              {...tipProps(
                                () => (
                                  <>
                                    {buildTip({ type: 'gear', id: d.gearId })}
                                    {boss && <div class="ms-tip-sub" style={{ marginTop: '0.5rem' }}>{t('runEnd.dropSource', { name: tl(boss.name) })}</div>}
                                  </>
                                ),
                                { rarity },
                              )}
                            >
                              <IconSlot size="xl" icon={def?.icon ?? d.gearId} kind="gear" rarity={rarity} {...(def ? { slot: def.slot } : {})} />
                              <span class="ms-re-drop-name">{def ? tl(def.name) : d.gearId}</span>
                              {d.isNew ? (
                                <Chip tone="new" size="sm">
                                  {t('runEnd.dropNew')}
                                </Chip>
                              ) : (
                                <span class="ms-re-drop-dupe">
                                  <CurrencyIcon kind="shard" /> {t('runEnd.dropDuplicate', { n: fmtInt(d.shards) })}
                                </span>
                              )}
                              {d.autoEquipped && <span class="ms-re-drop-eq">{t('runEnd.dropEquipped')}</span>}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </Panel>
                </section>
              )}

              {summary && (
                <section class="ms-re-card ms-re-sec ms-re-bank" style={sectionStyle(6)}>
                  <div class="ms-re-plates">
                    <div class="ms-re-plate" {...tipProps(() => <TipBody title={t('runEnd.yeop')} body={t('runEnd.tip.bankYeop')} />)}>
                      <CurrencyIcon kind="yeop" size="2.6rem" />
                      <span class="ms-re-plate-body">
                        <span class="ms-re-plate-l">{t('runEnd.yeop')}</span>
                        <StatWell size="md" tone="gold" value={<>+<Counter value={summary.bank.yeop} format={fmtInt} ms={countMs} delay={stepMs(6)} /></>} />
                        <small>{t('runEnd.bankTotal', { n: fmtInt(summary.bank.yeopTotal) })}</small>
                      </span>
                    </div>
                    <div class="ms-re-plate" {...tipProps(() => <TipBody title={t('runEnd.shards')} body={t('runEnd.tip.bankShards')} />)}>
                      <CurrencyIcon kind="shard" size="2.6rem" />
                      <span class="ms-re-plate-body">
                        <span class="ms-re-plate-l">{t('runEnd.shards')}</span>
                        <StatWell size="md" tone="gold" value={<>+<Counter value={summary.bank.shards + summary.bank.duplicateShards} format={fmtInt} ms={countMs} delay={stepMs(6)} /></>} />
                        <small>
                          {summary.bank.duplicateShards > 0 ? `${t('runEnd.dupShards', { n: fmtInt(summary.bank.duplicateShards) })} · ` : ''}
                          {t('runEnd.bankTotal', { n: fmtInt(summary.bank.shardsTotal) })}
                        </small>
                      </span>
                    </div>
                  </div>
                </section>
              )}
            </div>
          </ScrollFade>

          <footer class={`ms-re-actions ms-re-sec ${more.value.end ? '' : 'has-more'}`} style={sectionStyle(7)}>
            <Button size={retrySize} autofocus onClick={act(onRetry)}>
              <UiGlyph name={coop ? 'link' : 'swords'} tone="ivory" flat /> {coop ? t('coop.backToLobby') : t('runEnd.retry')}
            </Button>
            <Button variant="wood" size={subSize} onClick={act(onArmory)}>
              <UiGlyph name="shield" tone="pewter" flat /> {t('runEnd.armory')}
            </Button>
            <Button variant="wood" size={subSize} onClick={act(onMenu)} sound="back">
              <UiGlyph name="back" tone="pewter" flat /> {t('runEnd.menu')}
            </Button>
            <span class="ms-re-hint">
              {skipped ? '' : (
                <>
                  <span class="ms-kbd-only">{t('runEnd.skipHint')}</span>
                  <span class="ms-touch-only">{t('runEnd.skipHintTap')}</span>
                </>
              )}
            </span>
            <ScrollCue view={inner} axis="y" edge="end" state={more} />
          </footer>
        </div>
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------

/** Solo: start the run again with the kept selection. Co-op: back to the lobby (menu → co-op) for a rematch. */
export function retryOrLobby(result: RunResult): void {
  const { store } = deps();
  if (result.players.length > 1) {
    openView('coop');
    store.go('menu', { keepCoopLobby: true });
  } else store.startRun();
}

export function RunEndModal({ request }: { request: ModalRequest }): JSX.Element {
  const { store } = deps();
  const result = request.result;
  const toMenu = (): void => resultToMenu(result?.players.length, () => store.go('menu'));
  if (!result) {
    return (
      <div class="ms-modal ms-modal--blur">
        <Panel variant="board" class="ms-re-empty-panel" title={t('runEnd.report')}>
          <div class="ms-re-empty-body">
            <p>{t('runEnd.noResult')}</p>
            <Button onClick={toMenu}>{t('runEnd.menu')}</Button>
          </div>
        </Panel>
      </div>
    );
  }
  return (
    <RunEndView
      result={result}
      variant="modal"
      onRetry={() => retryOrLobby(result)}
      onArmory={() => {
        openView('armory');
        store.go('menu');
      }}
      onMenu={toMenu}
    />
  );
}
