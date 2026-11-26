// Leaderboard (Hall of heroes): a board window with a title bar, zone art tabs, ONE control row (kit segmented filters + the
// class emblem tabs on the same stone plates), ranked rows (rank plates / laurel plates, class seal, class emblem, empire
// banner, result tag, number wells for score / kills / time / date), a footer strip and the "your rank" plate. The list is an

// instead of being sliced. Loading is a skeleton that mirrors the row grid; empty / error / offline states are seal-and-scene
// plates. Phones fold the filters behind one button and print two-line rows. Behaviour is unchanged from the old screen:
// filters persist in `lbFilters`, stale-cache banner, refresh, per-row tooltips (also on keyboard / pad focus).
import { signal } from '@preact/signals';
import {
  CLASS_IDS,
  DIFFICULTIES,
  LEADERBOARD_MODES,
  LEADERBOARD_PERIODS,
  ZONE_IDS,
  type ClassId,
  type Difficulty,
  type LeaderboardEntry,
  type LeaderboardMode,
  type LeaderboardPeriod,
  type LeaderboardQuery,
  type LeaderboardResponse,
  type ZoneId,
} from '@ms/shared/api';
import type { JSX } from 'preact';
import type { EmpireId } from '../../data/schema';
import { useEffect, useRef, useState } from 'preact/hooks';
import { fmtAgo, fmtDate, fmtDateTime, fmtInt, fmtTime, t, tl, tn } from '../../i18n/i18n';
import type { CloudFailure } from '../../meta';
import { sfx } from '../audio';
import { Button } from '../components/Button';
import { Segmented } from '../components/Controls';
import { EmberField } from '../components/Modal';
import { Panel } from '../components/Panel';
import { StatWell } from '../components/StatWell';
import { KeyCap, UiGlyph } from '../components/StatIcon';
import { TipBody, tipProps } from '../components/Tooltip';
import { className, indexOf, zoneName } from '../content';
import { deps } from '../env';
import { layout } from '../layout';
import { useKeys, useScope } from '../nav';
import { closeView } from '../view';
import { failureText, useNow } from './onlineShared';
import { ClassEmblem, ClassSeal, EmpireBanner, OlTag, RankPlate, RefreshGlyph, StateSeal, ZoneTab, leatherStyle, type SealKind } from './onlineArt';
import { OlScroll } from './onlineScroll';
import './online.css';

export interface LeaderboardFilters {
  mode: LeaderboardMode;
  zone: ZoneId;
  difficulty: Difficulty;
  cls: ClassId | 'all';
  period: LeaderboardPeriod;
}

/** The filters in use (module-level so reopening the screen keeps them; the gallery presets them). */
export const lbFilters = signal<LeaderboardFilters | null>(null);

const PAGE = 50;

type LbState =
  | { kind: 'loading'; prev: LeaderboardResponse | null }
  | {
      kind: 'ready';
      data: LeaderboardResponse;
      fetchedAt: number;
      stale: CloudFailure | null;
    }
  | { kind: 'error'; failure: CloudFailure };

function defaultFilters(): LeaderboardFilters {
  const sel = deps().store.selection.value;
  const zone = (ZONE_IDS as readonly string[]).includes(sel.zone) ? (sel.zone as ZoneId) : 'yeonmu';
  return {
    mode: 'solo',
    zone,
    difficulty: sel.difficulty,
    cls: 'all',
    period: 'all',
  };
}

/** Fetches the page for `f`; `nonce` bumps force a refresh. Stale answers are dropped. */
function useLeaderboard(f: LeaderboardFilters, nonce: number): LbState {
  const client = deps().meta.leaderboard;
  const [state, setState] = useState<LbState>({ kind: 'loading', prev: null });
  const seq = useRef(0);
  const lastNonce = useRef(nonce);
  useEffect(() => {
    if (!client) return undefined;
    const id = ++seq.current;
    const force = lastNonce.current !== nonce;
    lastNonce.current = nonce;
    setState((s) => ({
      kind: 'loading',
      prev: s.kind === 'ready' ? s.data : s.kind === 'loading' ? s.prev : null,
    }));
    const query: LeaderboardQuery = {
      mode: f.mode,
      zone: f.zone,
      difficulty: f.difficulty,
      class: f.cls,
      period: f.period,
      limit: PAGE,
    };
    void client.fetch(query, force).then((r) => {
      if (id !== seq.current) return;
      if (!r.ok) setState({ kind: 'error', failure: r.failure });
      else
        setState({
          kind: 'ready',
          data: r.data,
          fetchedAt: r.fetchedAt,
          stale: r.stale ? r.failure : null,
        });
    });
    return () => {
      seq.current++;
    };
  }, [client, f.mode, f.zone, f.difficulty, f.cls, f.period, nonce]);
  return state;
}

function ResultChip({ win }: { win: boolean }): JSX.Element {
  return (
    <OlTag tone={win ? 'gold' : 'wine'} class="ms-lb-result-chip" icon={<UiGlyph name={win ? 'trophy' : 'skull'} tone={win ? 'bronze' : 'ivory'} flat />}>
      {win ? t('lb.victory') : t('lb.defeat')}
    </OlTag>
  );
}

function empireLabel(id: EmpireId): string {
  const e = indexOf().empires.get(id);
  return e ? tl(e.name) : id;
}

/** Empire of a board entry: the server may send one (`empire`); your own row falls back to the empire you picked. */
function empireOf(e: LeaderboardEntry): EmpireId | null {
  const v = (e as LeaderboardEntry & { empire?: unknown }).empire;
  if (v === 'saehwa' || v === 'chowon' || v === 'jihae') return v;
  return e.you ? deps().store.selection.value.empire : null;
}

function Row({ e, i }: { e: LeaderboardEntry; i: number }): JSX.Element {
  const empire = empireOf(e);
  const tip = tipProps(() => (
    <TipBody
      title={e.name}
      sub={`${className(e.classId)} · ${e.victory ? t('lb.victory') : t('lb.defeat')}`}
      rows={[
        { label: t('lb.col.score'), value: fmtInt(e.score) },
        { label: t('lb.col.level'), value: fmtInt(e.level) },
        { label: t('lb.col.kills'), value: fmtInt(e.kills) },
        { label: t('lb.col.time'), value: fmtTime(e.duration) },
        { label: t('lb.col.date'), value: fmtDateTime(e.achievedAt) },
        ...(e.party > 1 ? [{ label: t('lb.col.party'), value: fmtInt(e.party) }] : []),
      ]}
    />
  ));
  const top = e.rank <= 3;
  return (
    <div class={`ms-lb-row ${e.you ? 'is-you' : ''} ${top ? `is-top is-top${e.rank}` : ''}`} style={`--i:${Math.min(i, 16)}`} data-nav="" tabIndex={0} {...tip}>
      <span class="ms-lb-c ms-lb-rank">
        {top ? <RankPlate rank={e.rank as 1 | 2 | 3} /> : <b class="ms-lb-no ms-plate ms-num">{e.rank}</b>}
        {/* phone portrait only (online.css): the YOU plate leaves the name line (it cut the player's own name to 'Kahr...') and stands under the rank */}
        {e.you && (
          <OlTag tone="gold" class="ms-lb-you-chip ms-lb-you-chip--rank">
            {t('lb.you')}
          </OlTag>
        )}
      </span>
      <span class="ms-lb-c ms-lb-emp">{empire && <EmpireBanner empire={empire} width="3.3rem" class="ms-lb-flag" title={empireLabel(empire)} />}</span>
      <span class="ms-lb-c ms-lb-hero">
        <ClassSeal classId={e.classId} size={top ? '3.6rem' : '3rem'} />
        <span class="ms-lb-who">
          <span class="ms-lb-name-row">
            <span class="ms-lb-name">{e.name}</span>
            {e.you && (
              <OlTag tone="gold" class="ms-lb-you-chip">
                {t('lb.you')}
              </OlTag>
            )}
          </span>
          <span class="ms-lb-sub">
            <ClassEmblem classId={e.classId} size="1.5rem" class="ms-lb-emb" />
            <span class="ms-lb-cls">{className(e.classId)}</span>
            <span class="ms-lb-lv ms-num">
              {t('lb.col.level')} {e.level}
            </span>
            {e.party > 1 && (
              <OlTag class="ms-lb-party" icon={<UiGlyph name="person" tone="pewter" flat />}>
                <span class="ms-num" aria-label={t('lb.col.party')}>
                  {e.party}
                </span>
              </OlTag>
            )}
          </span>
        </span>
      </span>
      <span class="ms-lb-c ms-lb-result">
        <ResultChip win={e.victory} />
        {/* phone portrait only (online.css): the party size rides next to the result so the class name keeps its room on the hero line */}
        {e.party > 1 && (
          <OlTag class="ms-lb-party ms-lb-party--r" icon={<UiGlyph name="person" tone="pewter" flat />}>
            <span class="ms-num" aria-label={t('lb.col.party')}>
              {e.party}
            </span>
          </OlTag>
        )}
      </span>
      <span class="ms-lb-c ms-lb-score">
        <StatWell value={fmtInt(e.score)} size={top ? 'lg' : 'md'} tone="gold" />
      </span>
      <span class="ms-lb-c ms-lb-kills">
        <StatWell value={fmtInt(e.kills)} size="sm" icon={<UiGlyph name="skull" tone="pewter" flat />} />
      </span>
      <span class="ms-lb-c ms-lb-time">
        <StatWell value={fmtTime(e.duration)} size="sm" icon={<UiGlyph name="clock" tone="pewter" flat />} />
      </span>
      <span class="ms-lb-c ms-lb-date">
        <StatWell value={fmtDate(e.achievedAt)} size="sm" class="ms-lb-datewell" />
      </span>
    </div>
  );
}

/** Loading skeleton: the real row grid with carved, empty cells and a slow warm light sweep (no grey shimmer bars). */
function SkeletonRows(): JSX.Element {
  return (
    <>
      {Array.from({ length: 9 }, (_, i) => (
        <div class="ms-lb-row ms-lb-row--skel" key={i} style={`--i:${i}`} aria-hidden="true">
          <span class="ms-lb-c ms-lb-rank">
            <i class="ms-lb-sk ms-lb-sk--plate" />
          </span>
          <span class="ms-lb-c ms-lb-emp" />
          <span class="ms-lb-c ms-lb-hero">
            <i class="ms-lb-sk ms-lb-sk--seal" />
            <span class="ms-lb-who">
              <i class="ms-lb-sk ms-lb-sk--name" style={`width:${52 + ((i * 17) % 36)}%`} />
              <i class="ms-lb-sk ms-lb-sk--sub" />
            </span>
          </span>
          <span class="ms-lb-c ms-lb-result">
            <i class="ms-lb-sk ms-lb-sk--chip" />
          </span>
          <span class="ms-lb-c ms-lb-score">
            <i class="ms-lb-sk ms-lb-sk--well" />
          </span>
          <span class="ms-lb-c ms-lb-kills">
            <i class="ms-lb-sk ms-lb-sk--wells" />
          </span>
          <span class="ms-lb-c ms-lb-time">
            <i class="ms-lb-sk ms-lb-sk--wells" />
          </span>
          <span class="ms-lb-c ms-lb-date">
            <i class="ms-lb-sk ms-lb-sk--wells" />
          </span>
        </div>
      ))}
    </>
  );
}

function SkeletonNote(): JSX.Element {
  return (
    <div class="ms-lb-skel-note" role="status">
      <span class="ms-ol-loader" aria-hidden="true">
        <i />
      </span>
      <span>{t('lb.loading')}</span>
    </div>
  );
}

function Message({ seal, title, text, children }: { seal: SealKind; title: string; text: string; children?: JSX.Element }): JSX.Element {
  return (
    <div class="ms-lb-msg ms-ol-state">
      <StateSeal kind={seal} size="10rem" />
      <h3 class="ms-head ms-ol-state-title">{title}</h3>
      <p class="ms-ol-state-text">{text}</p>
      {children}
    </div>
  );
}

function YouBar({ data }: { data: LeaderboardResponse }): JSX.Element {
  const you = data.you;
  return (
    <div class={`ms-lb-youbar ${you ? '' : 'is-none'}`}>
      <span class="ms-ol-eyebrow ms-lb-youbar-eyebrow">{t('lb.yourRank')}</span>
      {you ? (
        <>
          <span class="ms-lb-youbar-rank">
            <StatWell value={`#${fmtInt(you.rank)}`} size="lg" tone="gold" class="ms-lb-youbar-well" />
            <span class="ms-lb-youbar-of">{t('lb.yourRank.of', { total: fmtInt(data.total) })}</span>
          </span>
          <span class="ms-lb-youbar-stat">
            <ClassSeal classId={you.classId} size="2.7rem" />
            <StatWell value={fmtInt(you.score)} size="md" tone="gold" />
            <ResultChip win={you.victory} />
          </span>
        </>
      ) : (
        <span class="ms-lb-youbar-none">{t('lb.unranked')}</span>
      )}
    </div>
  );
}

/**
 * Class filter: a strip of stone plates on the same material as the kit segmented filters beside it (round 3: one control row,
 * not three tab styles). Each class is its brass emblem on the plate; the lit tab (tan leather) also prints the class name, the
 * rest name themselves through the tooltip and the radio label (phones print every name).
 */
function ClassTabs({ value, onPick }: { value: ClassId | 'all'; onPick: (c: ClassId | 'all') => void }): JSX.Element {
  return (
    <div class="ms-ol-ctabs" role="radiogroup" aria-label={t('lb.class')}>
      {(['all', ...CLASS_IDS] as const).map((c) => {
        const on = c === value;
        const label = c === 'all' ? t('lb.class.all') : className(c);
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={label}
            data-nav=""
            class={`ms-ol-ctab ms-plate ${on ? 'is-active' : ''} ${c === 'all' ? 'is-all' : ''}`}
            {...tipProps(() => <div>{label}</div>)}
            onClick={() => {
              if (!on) {
                sfx('tab');
                onPick(c);
              }
            }}
          >
            {c !== 'all' && <ClassEmblem classId={c} size="2rem" class="ms-ol-ctab-emb" />}
            <span class="ms-ol-ctab-t">
              {c === 'all' ? (
                <>
                  <span class="ms-ol-ctab-long">{label}</span>
                  <span class="ms-ol-ctab-short">{t('lb.class.allShort')}</span>
                </>
              ) : (
                label
              )}
            </span>
            <span class="ms-hit" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

export function LeaderboardScreen(): JSX.Element {
  const { meta, content } = deps();
  const scope = useScope();
  useKeys((a) => {
    if (a.kind !== 'cancel') return false;
    sfx('back');
    closeView();
    return true;
  });
  const f = lbFilters.value ?? defaultFilters();
  const set = (patch: Partial<LeaderboardFilters>): void => {
    lbFilters.value = { ...f, ...patch };
  };
  const compact = layout.value.compact;
  const [drawer, setDrawer] = useState(false);
  const [nonce, setNonce] = useState(0);
  const state = useLeaderboard(f, nonce);
  const now = useNow(30_000, state.kind === 'ready');
  const offline = meta.leaderboard === null;
  const loading = state.kind === 'loading';
  const data = state.kind === 'ready' ? state.data : state.kind === 'loading' ? state.prev : null;
  const zones = indexOf(content).zonesOrdered.filter((z) => (ZONE_IDS as readonly string[]).includes(z.id));
  const refresh = (): void => {
    if (loading || offline) return;
    sfx('click');
    setNonce((n) => n + 1);
  };
  const clsLabel = f.cls === 'all' ? t('lb.class.all') : className(f.cls);
  const showFilters = !compact || drawer;
  const summary = [zoneName(f.zone), t(`lb.mode.${f.mode}`), t(`lb.difficulty.${f.difficulty}`), t(`lb.period.${f.period}`), clsLabel];
  const hasRows = data !== null && data.entries.length > 0 && !offline && state.kind !== 'error';

  return (
    <div class="ms-screen ms-on-screen ms-lb-screen" ref={scope}>
      <div class="ms-backdrop ms-backdrop--art ms-backdrop--dim" />
      <EmberField count={12} />
      <div class="ms-ol-stage">
        <Panel variant="board" ornate class="ms-ol-win ms-lb-win" title={t('lb.title')} titleIcon={<UiGlyph name="trophy" tone="gold" flat />} onClose={closeView} closeLabel={t('common.back')}>
          <div class="ms-ol-body ms-lb-body" style={leatherStyle()}>
            <div class="ms-lb-brow">
              <span class="ms-ol-eyebrow">{t('lb.eyebrow')}</span>
              {data && (
                <StatWell
                  layout="row"
                  label={t('lb.players')}
                  value={fmtInt(data.total)}
                  size="sm"
                  tone="gold"
                  icon={<UiGlyph name="person" tone="pewter" flat />}
                  class="ms-lb-total"
                  title={tn('lb.total', data.total)}
                />
              )}
              <Button variant="wood" size="small" disabled={loading || offline} sound="none" class="ms-lb-refreshbtn" title={t('lb.refresh')} aria-label={t('lb.refresh')} onClick={refresh}>
                <span class={loading ? 'ms-ol-spin' : 'ms-ol-spin is-idle'}>
                  <RefreshGlyph />
                </span>
                <span class="ms-lb-refresh-text">{t('lb.refresh')}</span>
              </Button>
              {compact && (
                <Button variant="wood" size="small" class="ms-lb-fbtn" active={drawer} onClick={() => setDrawer((v) => !v)} aria-label={t('lb.filters')}>
                  <UiGlyph name={drawer ? 'up' : 'down'} tone="gold" flat /> {t('lb.filters')}
                </Button>
              )}
              {compact && !drawer && (
                <div class="ms-lb-summary" aria-label={t('lb.filters')}>
                  {summary.map((x, i) => (
                    <OlTag key={i} tone={i === 0 ? 'gold' : 'stone'}>
                      {x}
                    </OlTag>
                  ))}
                </div>
              )}
            </div>

            {showFilters && (
              <div class="ms-lb-filters">
                <div class="ms-lb-zones" role="radiogroup" aria-label={t('lb.zone')}>
                  {zones.map((z) => (
                    <ZoneTab key={z.id} zone={z} active={z.id === f.zone} onPick={() => set({ zone: z.id as ZoneId })} />
                  ))}
                </div>
                <div class="ms-lb-filter-row">
                  <Segmented
                    options={LEADERBOARD_MODES.map((m) => ({
                      key: m,
                      label: t(`lb.mode.${m}`),
                    }))}
                    value={f.mode}
                    onChange={(m) => set({ mode: m })}
                  />
                  <Segmented
                    options={DIFFICULTIES.map((d) => ({
                      key: d,
                      label: t(`lb.difficulty.${d}`),
                    }))}
                    value={f.difficulty}
                    onChange={(d) => set({ difficulty: d })}
                  />
                  <Segmented
                    options={LEADERBOARD_PERIODS.map((p) => ({
                      key: p,
                      label: t(`lb.period.${p}`),
                    }))}
                    value={f.period}
                    onChange={(p) => set({ period: p })}
                  />
                  <ClassTabs value={f.cls} onPick={(c) => set({ cls: c })} />
                </div>
              </div>
            )}

            <div class={`ms-lb-board ms-ol-tray ${data && data.entries.some((e) => empireOf(e) !== null) ? 'has-emp' : ''}`}>
              {offline ? (
                <Message seal="offline" title={t('lb.offline.title')} text={t('lb.offline.text')} />
              ) : state.kind === 'error' ? (
                <Message seal="error" title={t('lb.error.title')} text={failureText(state.failure)}>
                  <Button size="small" variant="wood" onClick={() => setNonce((n) => n + 1)}>
                    {t('common.retry')}
                  </Button>
                </Message>
              ) : state.kind === 'loading' && !data ? (
                <>
                  <div class="ms-lb-colhead" aria-hidden="true">
                    <ColHead />
                  </div>
                  <div class="ms-lb-slot">
                    <OlScroll always class="ms-lb-sc" viewClass="ms-lb-scroll">
                      <SkeletonRows />
                    </OlScroll>
                    <SkeletonNote />
                  </div>
                </>
              ) : data && data.entries.length === 0 ? (
                <Message seal="empty" title={t('lb.empty.title')} text={f.mode === 'coop' ? t('lb.empty.coop') : t('lb.empty')} />
              ) : data ? (
                <>
                  {state.kind === 'ready' && state.stale && (
                    <div class="ms-lb-banner" role="status">
                      <UiGlyph name="cloud" tone="gold" flat />
                      <span class="ms-lb-banner-t">{t('lb.stale', { ago: fmtAgo(state.fetchedAt, now) })}</span>
                      <Button size="small" variant="wood" onClick={() => setNonce((n) => n + 1)}>
                        {t('common.retry')}
                      </Button>
                    </div>
                  )}
                  <div class="ms-lb-colhead" aria-hidden="true">
                    <ColHead />
                  </div>
                  <div class="ms-lb-slot">
                    <OlScroll always class="ms-lb-sc" viewClass={`ms-lb-scroll ${loading ? 'is-loading' : ''}`} key={`${f.mode}|${f.zone}|${f.difficulty}|${f.cls}|${f.period}`}>
                      {data.entries.map((e, i) => (
                        <Row key={`${e.rank}:${e.name}`} e={e} i={i} />
                      ))}
                    </OlScroll>
                  </div>
                </>
              ) : null}
            </div>

            {hasRows && data && <YouBar data={data} />}

            <div class="ms-lb-actions">
              <Button variant="wood" size="small" sound="back" class="ms-lb-back" onClick={closeView}>
                <UiGlyph name="back" tone="pewter" flat /> {t('common.back')} <KeyCap class="ms-kbd-only">Esc</KeyCap>
              </Button>
              {hasRows && data && (
                <span class="ms-lb-foot">
                  <span class="ms-lb-foot-l">
                    {t('lb.showing', {
                      n: fmtInt(data.entries.length),
                      total: fmtInt(data.total),
                    })}
                    {data.period === 'week' && data.weekStart !== null ? ` · ${t('lb.weekFrom', { date: fmtDate(data.weekStart) })}` : ''}
                  </span>
                  {state.kind === 'ready' && !state.stale && <span class="ms-lb-foot-r">{t('lb.updated', { ago: fmtAgo(state.fetchedAt, now) })}</span>}
                </span>
              )}
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function ColHead(): JSX.Element {
  return (
    <>
      <span class="ms-lb-c ms-lb-rank">{t('lb.col.rank')}</span>
      <span class="ms-lb-c ms-lb-emp" />
      <span class="ms-lb-c ms-lb-hero">{t('lb.col.player')}</span>
      <span class="ms-lb-c ms-lb-result">{t('lb.col.result')}</span>
      <span class="ms-lb-c ms-lb-score">{t('lb.col.score')}</span>
      <span class="ms-lb-c ms-lb-kills">{t('lb.col.kills')}</span>
      <span class="ms-lb-c ms-lb-time">{t('lb.col.time')}</span>
      <span class="ms-lb-c ms-lb-date">{t('lb.col.date')}</span>
    </>
  );
}
