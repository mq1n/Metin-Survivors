
// beside it (rust title bar, a short forge header strip with the [now] >> [next] octagon sockets, a dotted-corner item box
// with now > next stats, three ingredient rows (the piece, shards, Yeop) with their octagon slots, the +0 > +9 chain, then
// the foot: success gauge, the Blessing Scroll switch (MT-03: +15 points of chance for 3x the Yeop, both rates shown; it opens
// once the normal campaign is complete; on the narrow container the switch shares the chance row and every state that cannot be pressed is a
// charm chip), cost
// line, REFINE + ODDS). The ledger, the odds table (with the scroll's chance and Yeop beside the plain ones once the scroll
// is on offer) and the attempt log live in a small
// sub-window that the ODDS button opens over the window body. The attempt is resolved by `meta.upgradeGear` at the moment
// the hammer strikes (after a short charge-up), and the forge plays the success / failure reveal from the returned result.
import { signal } from '@preact/signals';
import { Fragment, type JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { GEAR_SLOTS, type ClassId, type GearSlot } from '../../../data/schema';
import { fmtInt, fmtPct, lang, t, tl } from '../../../i18n/i18n';
import { BLESSING_RATE_BONUS, BLESSING_YEOP_MULT, MAX_PLUS, blessedRate, gearStats, ownedPieces, quoteUpgrade, scrollUnlocked, type OwnedPiece, type UpgradeQuote } from '../../../meta';
import { iconForm, texUrl } from '../../assets';
import { sfx } from '../../audio';
import { Button } from '../../components/Button';
import { Glyph } from '../../components/glyphs';
import { IconArt, slotGlyph } from '../../components/Icon';
import { Medal } from '../../components/Medal';
import { KitCtx } from '../../components/Panel';
import { CurrencyIcon, UiGlyph } from '../../components/StatIcon';
import { StatWell } from '../../components/StatWell';
import { TitleBar } from '../../components/TitleBar';
import { TipBody, tipProps } from '../../components/Tooltip';
import { Burst, Motes } from '../../components/UiFx';
import { itemName, statModRows } from '../../content';
import { deps } from '../../env';
import { buildTip, gearRarity } from '../../itemTips';
import { metaSave, pushToast } from '../../view';
import { ArmGauge, useArmTex } from './ArmGauge';
import { plusBand, rateTone, reserveNumberShown, scrollIsChip, scrollToastKey, scrollView, scrollWish, type ScrollView } from './refine';
import { armoryClass } from './state';
import './blacksmith.css';

/** one entry of the running attempt log */
interface Attempt {
  n: number;
  gearId: string;
  success: boolean;
  from: number;
  to: number;
  /** read under a Blessing Scroll */
  blessed: boolean;
}

/** the selected piece / the Blessing Scroll switch: exported so the gallery scenarios (ui/dev/scenarios/up_smith.ts) can set the window up */
export const selectedId = signal<string | null>(null);
const slotFilter = signal<GearSlot | 'all'>('all');
const attemptLog = signal<Attempt[]>([]);
/** the ledger / odds / attempts sub-window is open over the refine window body (exported for the gallery scenarios) */
export const oddsOpen = signal(false);
/** the player's Blessing Scroll switch (session only; it takes effect only while the scroll adds something and the bank can pay it) */
export const scrollWanted = signal(false);
let attemptSeq = 0;

type Phase = 'charge' | 'strike' | 'success' | 'fail';

interface Run {
  seq: number;
  gearId: string;
  phase: Phase;
  from: number;
  to: number;
  success: boolean;
  blessed: boolean;
}

/** ms from the click: hammer strikes (and the attempt is resolved) → reveal → button unlocks */
const CHARGE_MS = 540;
const REVEAL_MS = 130;
const LOCK_MS = 1250;

// ---------------------------------------------------------------------------------------------------------------
// Effects: deterministic particle sets (re-rolled per attempt)

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

interface Puff {
  x: number;
  delay: number;
  size: number;
}

function makePuffs(seed: number): Puff[] {
  const r = mulberry(seed * 104729 + 7);
  return Array.from({ length: 7 }, (_, i) => ({ x: (r() - 0.5) * 7, delay: i * 70 + r() * 80, size: 2.2 + r() * 2.4 }));
}

// ---------------------------------------------------------------------------------------------------------------
// Little pieces

/** A kit octagon socket made of spans (safe inside a <button>). `--s` sets the size. */
function Octa({ size, icon, kind, slot, rarity, badge, tag, selected, dim, awakened, children, class: cls, hotkey }: { size: string; icon?: string; kind?: 'gear'; slot?: string; rarity?: string; badge?: string; tag?: boolean; selected?: boolean; dim?: boolean; awakened?: boolean; children?: JSX.Element | null; class?: string; hotkey?: string }): JSX.Element {
  const form = icon ? (iconForm(icon) ?? 'legacy') : null;
  return (
    <span class={`ms-slot ms-slot--k ${form ? `ms-slot--${form}` : 'ms-slot--empty'} ${rarity ? `ms-r-${rarity}` : ''} ${selected ? 'is-selected' : ''} ${dim ? 'sm-dim' : ''} ${awakened ? 'ms-slot--awakened' : ''} ${cls ?? ''}`} style={{ '--s': size } as JSX.CSSProperties}>
      <span class="ms-slot-fx">
        <span class="ms-slot-frame ms-plate">
          <span class="ms-slot-art">{icon ? <IconArt id={icon} kind={kind ?? 'gear'} {...(slot ? { slot } : {})} /> : children}</span>
        </span>
      </span>
      {hotkey && <span class="ms-slot-key">{hotkey}</span>}
      {badge !== undefined && <Medal tag={tag ?? true} label={badge} class="ms-slot-rank" />}
    </span>
  );
}

/** the carved double chevron between the two sockets: two same-way chevrons that light one after the other */
function Chevrons(): JSX.Element {
  return (
    <svg class="sm-chev" viewBox="0 0 60 40" aria-hidden="true">
      <defs>
        <linearGradient id="sm-chev-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#a39b8a" />
          <stop offset=".5" stop-color="#5f584d" />
          <stop offset="1" stop-color="#2a2622" />
        </linearGradient>
      </defs>
      <path class="sm-chev-1" d="M3 3h11l19 17-19 17H3l19-17z" />
      <path class="sm-chev-2" d="M27 3h11l19 17-19 17H27l19-17z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Forge stage: [now] ⟫ [next] sockets over a hearth of coals

interface StageProps {
  piece: OwnedPiece;
  shownPlus: number;
  run: Run | null;
}

function ForgeStage({ piece, shownPlus, run }: StageProps): JSX.Element {
  const phase: Phase | 'idle' = run && run.gearId === piece.def.id ? run.phase : 'idle';
  const seq = run?.seq ?? 0;
  const puffs = useMemo(() => makePuffs(seq), [seq]);
  const rarity = gearRarity(piece.def.tier);
  const revealed = phase === 'success' || phase === 'fail';
  const maxed = shownPlus >= MAX_PLUS;
  const next = Math.min(MAX_PLUS, shownPlus + 1);
  // painted forge plate (uk_armory_b_forge, generated when the image engine is back); the drawn coal hearth is the fallback
  const forgeArt = texUrl('uk_armory_b_forge');
  return (
    <div class="sm-stagewrap">
      <div class={`sm-stage ms-sunken ms-sunken--plain ${forgeArt ? 'has-art' : ''} ${run?.blessed && phase !== 'idle' ? 'is-blessed' : ''}`} data-phase={phase} {...(forgeArt ? { style: { '--sm-forge-art': `url("${forgeArt}")` } as JSX.CSSProperties } : {})}>
        <div class="sm-hearth" aria-hidden="true">
          <svg class="sm-coals" viewBox="0 0 400 100" preserveAspectRatio="none">
            <defs>
              <filter id="sm-lava" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
                <feTurbulence type="turbulence" baseFrequency="0.022 0.07" numOctaves="3" seed="11" result="n" />
                <feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 0.52  0 0 0 0 0.12  -4.2 0 0 0 1.38" result="cracks" />
                <feGaussianBlur in="cracks" stdDeviation="2.2" result="glow" />
                <feMerge>
                  <feMergeNode in="glow" />
                  <feMergeNode in="cracks" />
                </feMerge>
              </filter>
              <linearGradient id="sm-coal-fade" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="#fff" stop-opacity="0" />
                <stop offset=".55" stop-color="#fff" stop-opacity=".75" />
                <stop offset="1" stop-color="#fff" stop-opacity="1" />
              </linearGradient>
              <mask id="sm-coal-mask">
                <rect width="400" height="100" fill="url(#sm-coal-fade)" />
              </mask>
            </defs>
            <g mask="url(#sm-coal-mask)">
              <rect width="400" height="100" filter="url(#sm-lava)" />
            </g>
          </svg>
          <i class="sm-heat" />
        </div>
        <Motes preset="ember" count={22} seed={5} intensity={0.8} />
        <div class="sm-pair">
          <figure class={`sm-box sm-box--now ${phase === 'success' ? 'is-ignite' : ''} ${phase === 'fail' ? 'is-hurt' : ''}`} aria-label={`${t('smith.stats.now')} +${shownPlus}`}>
            <Octa size="var(--sm-slot)" icon={piece.def.icon} slot={piece.def.slot} rarity={rarity} badge={`+${shownPlus}`} awakened={maxed} />
          </figure>
          {!maxed && (
            <>
              <Chevrons />
              <figure class="sm-box sm-box--next" aria-label={t('smith.stats.next', { n: next })}>
                <Octa size="var(--sm-slot)" icon={piece.def.icon} slot={piece.def.slot} rarity={rarity} badge={`+${next}`} class="sm-next-slot" />
              </figure>
            </>
          )}
        </div>
        {phase === 'strike' && <i class="sm-flash" key={`f${seq}`} />}
        {phase === 'success' && <Burst key={`b${seq}`} play={seq} tone="gold" x="50%" y="58%" scale={run?.blessed ? 1.05 : 0.9} sparks={run?.blessed ? 56 : 40} />}
        {phase === 'fail' && (
          <div class="sm-fx" aria-hidden="true">
            <i class="sm-dull" />
            {puffs.map((p, i) => (
              <i key={i} class="sm-puff" style={{ '--x': `${p.x}rem`, '--dl': `${p.delay}ms`, '--sz': `${p.size}rem` } as JSX.CSSProperties} />
            ))}
          </div>
        )}
      </div>
      {revealed && run && (
        <div class={`sm-banner ms-plate ${run.success ? 'is-ok' : 'is-bad'}`} role="status">
          <b>{run.success ? t('smith.result.success', { from: run.from, to: run.to }) : t('smith.result.fail')}</b>
          <span>
            {run.success
              ? run.blessed
                ? t('smith.result.successScroll')
                : t('smith.result.successSub')
              : run.blessed
                ? t('smith.result.failScroll', { n: run.from })
                : t('smith.result.failSub', { n: run.from })}
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// +0…+9 chain

function PlusTrack({ shown, ignite }: { shown: number; ignite: number | null }): JSX.Element {
  return (
    <div class="sm-track" {...tipProps(() => <TipBody title={t('smith.track')} body={t('smith.track.level', { n: shown, max: MAX_PLUS })} />)}>
      <div class="sm-track-head">
        <span class="sm-track-l">{t('smith.track')}</span>
        <span class="sm-track-v ms-num">{t('smith.track.level', { n: shown, max: MAX_PLUS })}</span>
      </div>
      <div class="sm-chain" role="img" aria-label={t('smith.track.level', { n: shown, max: MAX_PLUS })}>
        {Array.from({ length: MAX_PLUS + 1 }, (_, i) => (
          <Fragment key={i}>
            <span class={`sm-pip sm-pip--${plusBand(i)} ${i <= shown ? 'is-lit' : ''} ${i === shown ? 'is-now' : ''} ${i === shown + 1 && shown < MAX_PLUS ? 'is-next' : ''} ${ignite === i ? 'is-ignite' : ''}`}>{i}</span>
            {i < MAX_PLUS && <b class={`sm-arr ${i < shown ? 'is-on' : ''}`} />}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Item box: name +N, kind line, stats now > next

function ItemBox({ piece, shownPlus }: { piece: OwnedPiece; shownPlus: number }): JSX.Element {
  const maxed = piece.plus >= MAX_PLUS;
  const now = statModRows(gearStats(piece.def, piece.plus));
  const next = maxed ? [] : statModRows(gearStats(piece.def, piece.plus + 1));
  const delta = statModRows(piece.def.perPlus);
  const nowBy = new Map(now.map((r) => [r.label, r]));
  const nextBy = new Map(next.map((r) => [r.label, r]));
  const deltaBy = new Map(delta.map((r) => [r.label, r]));
  const labels = [...new Set([...now.map((r) => r.label), ...next.map((r) => r.label)])];
  const rarity = gearRarity(piece.def.tier);
  return (
    <div class="sm-info ms-sunken ms-sunken--plain">
      <div class="sm-info-t">
        <h3 class={`sm-info-name ms-r-${rarity}`}>
          {tl(piece.def.name)}
          {shownPlus > 0 && <span class="sm-info-plus"> +{shownPlus}</span>}
        </h3>
        <p class="sm-info-kind">
          <Glyph name={slotGlyph(piece.def.slot)} />
          <span>
            {t(`gear.slot.${piece.def.slot}`)} · {t('smith.tier', { n: piece.def.tier })} · {t(`rarity.${rarity}`)}
          </span>
          {piece.equipped && <span class="sm-info-eq">[ {t('smith.equipped')} ]</span>}
        </p>
      </div>
      <div class={`sm-stat-grid ${maxed ? 'is-max' : ''}`}>
        <span class="sm-sg-h" />
        <span class="sm-sg-h">{t('smith.stats.now')}</span>
        {!maxed && (
          <>
            <span class="sm-sg-h" />
            <span class="sm-sg-h">{t('smith.stats.next', { n: piece.plus + 1 })}</span>
            <span class="sm-sg-h">{t('smith.stats.gain')}</span>
          </>
        )}
        {labels.map((label) => {
          const a = nowBy.get(label);
          const b = nextBy.get(label);
          const d = deltaBy.get(label);
          return (
            <Fragment key={label}>
              <span class="sm-sg-l">{label}</span>
              <b class={`sm-sg-v ${a && !a.positive ? 'is-bad' : ''}`}>{a?.value ?? '—'}</b>
              {!maxed && (
                <>
                  <span class="sm-sg-arrow">›</span>
                  <b class={`sm-sg-v sm-sg-next ${b && !b.positive ? 'is-bad' : ''}`}>{b?.value ?? '—'}</b>
                  <span class={`sm-sg-d ${d && !d.positive ? 'is-bad' : ''}`}>{d ? d.value : ''}</span>
                </>
              )}
            </Fragment>
          );
        })}
      </div>
      {maxed && <p class="sm-stats-max">{t('smith.stats.max')}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Ingredients, success gauge, cost line, buttons

interface QuoteProps {
  quote: UpgradeQuote | null;
  bank: { yeop: number; shards: number };
  locked: boolean;
  onRefine: () => void;
  /** the Blessing Scroll switch (what it shows and whether it is read over the next attempt) */
  scroll: ScrollView;
  onScroll: () => void;
}

function IngredientRow({ kind, name, qty, have, piece, scroll }: { kind: 'yeop' | 'shard' | 'piece'; name: string; qty: number; have: number; piece?: OwnedPiece; scroll?: boolean }): JSX.Element {
  const short = kind === 'piece' ? 0 : Math.max(0, qty - have);
  return (
    <div class={`sm-ing sm-ing--${kind} ms-sunken ms-sunken--plain ${short > 0 ? 'is-short' : 'is-ok'}`}>
      {piece ? (
        <Octa size="var(--sm-ing-slot)" icon={piece.def.icon} slot={piece.def.slot} rarity={gearRarity(piece.def.tier)} />
      ) : (
        <Octa size="var(--sm-ing-slot)" rarity="common">
          <CurrencyIcon kind={kind === 'piece' ? 'yeop' : kind} />
        </Octa>
      )}
      <span class="sm-ing-n">
        <b>{name}</b>
        <span class="sm-ing-q ms-num"> × {fmtInt(qty)}</span>
        {scroll && (
          <span class="sm-ing-tag" title={t('smith.scroll.title')}>
            <Glyph name="talisman" />
            {BLESSING_YEOP_MULT}×
          </span>
        )}
      </span>
      <span class="sm-ing-have">
        <UiGlyph name={short > 0 ? 'warn' : 'check'} tone={short > 0 ? 'crimson' : 'jade'} flat />
        <span class="sm-ing-have-t">{kind === 'piece' ? (piece?.equipped ? t('smith.equipped') : t('smith.ing.owned')) : short > 0 ? t('smith.short', { n: fmtInt(short) }) : t('smith.have', { n: fmtInt(have) })}</span>
      </span>
    </div>
  );
}

function Ingredients({ piece, quote, bank }: { piece: OwnedPiece; quote: UpgradeQuote | null; bank: { yeop: number; shards: number } }): JSX.Element {
  return (
    <div class="sm-ings">
      <div class="sm-block-h">{t('smith.ingredients')}</div>
      <IngredientRow kind="piece" name={tl(piece.def.name)} qty={1} have={1} piece={piece} />
      {quote ? (
        <>
          <IngredientRow kind="shard" name={t('smith.cost.shards')} qty={quote.shards} have={bank.shards} />
          <IngredientRow kind="yeop" name={t('smith.cost.yeop')} qty={quote.yeop} have={bank.yeop} scroll={quote.blessed} />
        </>
      ) : (
        <p class="sm-none">{t('smith.btn.maxed')}</p>
      )}
    </div>
  );
}

/** the scroll's bonus in whole points (what the tooltips say before a quote has numbers to show) */
const SCROLL_POINTS = Math.round(BLESSING_RATE_BONUS * 100);

/**
 * The Blessing Scroll switch (MT-03): a plate under the success gauge (on the narrow container: in the chance row) that names the
 * scroll, says what it does and shows the plain chance next to the chance with the scroll. Before the normal campaign is complete
 * it is greyed and says when it opens; while the bank's Yeop is still needed by plain attempts it is greyed and says how much more
 * Yeop opens it (the scroll reads over spare Yeop only). `aria-disabled` (not `disabled`) so a capped / short / reserve / locked
 * switch keeps its tooltip. The reserve line prints the missing Yeop only while it is within reach (no more than the bank holds);
 * a late bank far below its reserve reads "Plain attempts first" and keeps the number in the tooltip and the aria label.
 * Only 'on' / 'off' are the full plate on the narrow container: every state that cannot be pressed is the charm chip alone
 * (`sm-scroll--chip`), so the success gauge keeps its width, and a tap on it gives that state's toast.
 */
function ScrollToggle({ quote, view, locked, bankYeop, onToggle }: { quote: UpgradeQuote; view: ScrollView; locked: boolean; bankYeop: number; onToggle: () => void }): JSX.Element {
  const { base, scroll } = quote;
  const on = view.state === 'on';
  const sub =
    view.state === 'locked'
      ? t('smith.scroll.locked')
      : view.state === 'capped'
        ? t('smith.scroll.capped')
        : view.state === 'short'
          ? t('smith.scroll.short', { n: fmtInt(view.shortYeop) })
          : view.state === 'reserve'
            ? reserveNumberShown(view.shortYeop, bankYeop)
              ? t('smith.scroll.reserve', { n: fmtInt(view.shortYeop) })
              : t('smith.scroll.reserveFirst')
            : t('smith.scroll.sub', { pts: view.points, mult: BLESSING_YEOP_MULT });
  const tipBody = (): JSX.Element => (
    <TipBody
      title={t('smith.scroll.title')}
      body={
        view.state === 'locked'
          ? t('smith.scroll.lockedTip', { pts: SCROLL_POINTS, mult: BLESSING_YEOP_MULT })
          : view.state === 'capped'
            ? t('smith.scroll.cappedTip')
            : view.state === 'reserve'
              ? t('smith.scroll.reserveTip', { n: fmtInt(scroll.plainAttempts), y: fmtInt(base.yeop), extra: fmtInt(scroll.yeop - base.yeop), reserve: fmtInt(scroll.reserve) })
              : t('smith.scroll.tip', { pts: view.points || SCROLL_POINTS, mult: BLESSING_YEOP_MULT })
      }
      {...(view.state === 'short' ? { sub: t('smith.scroll.shortTip', { mult: BLESSING_YEOP_MULT, yeop: fmtInt(scroll.yeop) }) } : {})}
    />
  );
  const showRates = view.state === 'on' || view.state === 'off' || view.state === 'short' || view.state === 'reserve';
  const ariaLabel =
    view.state === 'locked'
      ? t('smith.scroll.ariaLocked')
      : view.state === 'reserve'
        ? t('smith.scroll.reserveAria', { n: fmtInt(view.shortYeop) })
        : view.state === 'capped'
          ? t('smith.scroll.cappedAria')
          : view.state === 'short'
            ? t('smith.scroll.shortAria', { n: fmtInt(view.shortYeop), yeop: fmtInt(scroll.yeop) })
            : t('smith.scroll.aria', { base: fmtPct(base.rate), blessed: fmtPct(scroll.rate), yeop: fmtInt(scroll.yeop) });
  return (
    <button
      type="button"
      class={`sm-scroll ms-plate sm-scroll--${view.state} ${scrollIsChip(view.state) ? 'sm-scroll--chip' : ''} ${locked ? 'is-locked' : ''}`}
      role="switch"
      aria-checked={on}
      aria-disabled={!view.enabled || locked}
      aria-label={ariaLabel}
      data-nav=""
      onClick={onToggle}
      {...tipProps(tipBody)}
    >
      <span class="sm-scroll-ic" aria-hidden="true">
        <Glyph name="talisman" />
      </span>
      <span class="sm-scroll-t">
        <b class="sm-scroll-n">
          <span class="sm-sc-full">{t('smith.scroll.title')}</span>
          <span class="sm-sc-short">{t('smith.scroll.titleShort')}</span>
        </b>
        <span class="sm-scroll-s">{sub}</span>
      </span>
      {showRates && (
        <span class="sm-scroll-r ms-num" aria-hidden="true">
          <i class="sm-scroll-from">{fmtPct(base.rate)}</i>
          <span class="sm-scroll-to-arrow">›</span>
          <b class={`sm-scroll-to sm-tone-${rateTone(scroll.rate)}`}>{fmtPct(scroll.rate)}</b>
        </span>
      )}
      <span class="sm-scroll-sw" aria-hidden="true">
        <span class="sm-scroll-knob" />
      </span>
    </button>
  );
}

function ActionBar({ quote, bank, locked, onRefine, scroll, onScroll }: QuoteProps): JSX.Element {
  const maxed = quote === null;
  const shortYeop = quote ? Math.max(0, quote.yeop - bank.yeop) : 0;
  const shortShards = quote ? Math.max(0, quote.shards - bank.shards) : 0;
  const canGo = quote !== null && shortYeop === 0 && shortShards === 0;
  let reason = '';
  if (maxed) reason = t('smith.reason.maxed', { max: MAX_PLUS });
  else if (shortYeop > 0 && shortShards > 0) reason = t('smith.reason.both');
  else if (shortYeop > 0) reason = t('smith.reason.noYeop');
  else if (shortShards > 0) reason = t('smith.reason.noShards');
  const rate = quote?.rate ?? 0;
  const tone = rateTone(rate);
  return (
    <div class="sm-foot">
      <div class={`sm-rate sm-rate--${maxed ? 'none' : tone}`} {...tipProps(() => <TipBody title={t('smith.chance')} body={maxed ? t('smith.reason.maxed', { max: MAX_PLUS }) : t('smith.rule')} />)}>
        <div class="sm-rate-h">
          <span class="sm-rate-l">
            <span class="sm-rate-full">{t('smith.chance')}</span>
            <span class="sm-rate-short">{t('smith.odds.rate')}</span>
          </span>
          <b class={`sm-rate-v ms-num ${quote?.blessed ? 'is-blessed' : ''}`}>{maxed ? '—' : fmtPct(rate)}</b>
        </div>
        <ArmGauge kind={!maxed && tone === 'bad' ? 'red' : 'gold'} ch="1.4rem" value={maxed ? 0 : rate} ticks={10} labelEnd={maxed ? '—' : fmtPct(rate)} title={maxed ? t('smith.chance') : `${t('smith.chance')} ${fmtPct(rate)}`} />
      </div>
      {quote && <ScrollToggle quote={quote} view={scroll} locked={locked} bankYeop={bank.yeop} onToggle={onScroll} />}
      <div class="sm-costline">
        <span class="sm-costline-l">{t('smith.costLine')}</span>
        {quote ? (
          <span class="sm-costline-v">
            <span class={`sm-cl ${shortYeop > 0 ? 'is-short' : ''}`}>
              <CurrencyIcon kind="yeop" />
              <b class="ms-num">{fmtInt(quote.yeop)}</b> {t('smith.cost.yeop')}
              {quote.blessed && <i class="sm-cl-tag">{t('smith.scroll.cost', { mult: BLESSING_YEOP_MULT })}</i>}
            </span>
            <span class={`sm-cl ${shortShards > 0 ? 'is-short' : ''}`}>
              <CurrencyIcon kind="shard" />
              <b class="ms-num">{fmtInt(quote.shards)}</b> {t('smith.cost.shards')}
            </span>
          </span>
        ) : (
          <span class="sm-costline-v">—</span>
        )}
      </div>
      <div class="sm-btns">
        <Button size="big" class="sm-refine" disabled={!canGo || locked} onClick={onRefine} sound="confirm" sub={quote ? t('smith.btn.sub', { from: quote.from, to: quote.to }) : undefined}>
          {maxed ? t('smith.btn.maxed') : locked ? t('smith.btn.working') : t('smith.btn.upgrade')}
        </Button>
        <Button variant="wood" class="sm-odds-btn" active={oddsOpen.value} aria-label={t('smith.odds.title')} onClick={() => (oddsOpen.value = !oddsOpen.value)}>
          {t('smith.odds.btn')}
        </Button>
      </div>
      <p class={`sm-reason ${reason ? 'is-on' : ''}`} aria-live="polite">
        {reason}
      </p>
      <p class="sm-rule">
        <UiGlyph name="info" tone="pewter" flat />
        {t('smith.rule')}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Gear board

/** How many shelf cells fit the scroller (cols x rows): empty octagons fill the page like an inventory tab. */
function useShelfFill(ref: { current: HTMLElement | null }, visible: number): number {
  const [fit, setFit] = useState(12);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = (): void => {
      const grid = el.querySelector<HTMLElement>('.sm-grid');
      const cell = el.querySelector<HTMLElement>('.sm-piece-wrap:not(.sm-ghost)') ?? el.querySelector<HTMLElement>('.sm-piece-wrap');
      if (!grid || !cell) return;
      const cs = getComputedStyle(grid);
      if (cs.display !== 'grid') {
        setFit(0);
        return;
      }
      const cols = Math.max(1, cs.gridTemplateColumns.split(' ').length);
      const gap = parseFloat(cs.rowGap) || 0;
      const rowH = cell.getBoundingClientRect().height;
      const pad = parseFloat(getComputedStyle(el).paddingTop) + parseFloat(getComputedStyle(el).paddingBottom);
      const rows = Math.max(1, Math.floor((el.clientHeight - pad + gap) / (rowH + gap)));
      setFit(cols * rows);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, visible]);
  return fit;
}

function PieceCard({ p, selected, busy, onSelect }: { p: OwnedPiece; selected: boolean; busy: boolean; onSelect: () => void }): JSX.Element {
  const rarity = gearRarity(p.def.tier);
  return (
    <button
      type="button"
      class={`sm-piece ${selected ? 'is-selected' : ''} ${p.equipped ? 'is-equipped' : ''} ${busy && !selected ? 'is-busy' : ''}`}
      data-nav=""
      aria-pressed={selected}
      aria-label={`${tl(p.def.name)}${p.plus > 0 ? ` +${p.plus}` : ''}${p.equipped ? ` (${t('smith.equipped')})` : ''}`}
      onClick={onSelect}
      {...tipProps(() => buildTip({ type: 'gear', id: p.def.id, plus: p.plus }), { rarity })}
    >
      <Octa size="var(--sm-card-slot)" icon={p.def.icon} slot={p.def.slot} rarity={rarity} selected={selected} badge={p.plus > 0 ? `+${p.plus}` : undefined} />
      {p.equipped && <i class="sm-eqdot" aria-hidden="true" />}
      <span class="sm-piece-name">{tl(p.def.name)}</span>
    </button>
  );
}

function PieceList({ pieces, visible, filter, selId, busy, onSelect }: { pieces: OwnedPiece[]; visible: OwnedPiece[]; filter: GearSlot | 'all'; selId: string | null; busy: boolean; onSelect: (id: string) => void }): JSX.Element {
  const countBy = (slot: GearSlot): number => pieces.filter((p) => p.def.slot === slot).length;
  const scroller = useRef<HTMLDivElement>(null);
  const fit = useShelfFill(scroller, visible.length);
  const ghosts = Math.min(60, Math.max(0, fit - visible.length));
  return (
    <KitCtx.Provider value={true}>
      <section class={`sm-list ms-board ms-kit ${pieces.length > 10 ? 'is-many' : ''}`}>
        <TitleBar small>{t('smith.pieces')}</TitleBar>
        <div class="sm-list-in">
          <div class="sm-list-head">
            <div class="sm-chips" role="tablist">
              <button
                type="button"
                class={`sm-chip ms-plate ${filter === 'all' ? 'is-active' : ''}`}
                role="tab"
                aria-selected={filter === 'all'}
                data-nav=""
                onClick={() => {
                  if (filter !== 'all') sfx('tab');
                  slotFilter.value = 'all';
                }}
              >
                {t('smith.filter.all')}
              </button>
              {GEAR_SLOTS.map((slot) => {
                const n = countBy(slot);
                return (
                  <button
                    key={slot}
                    type="button"
                    role="tab"
                    aria-selected={filter === slot}
                    class={`sm-chip sm-chip--icon ms-plate ${filter === slot ? 'is-active' : ''} ${n === 0 ? 'is-empty' : ''}`}
                    data-nav=""
                    aria-label={`${t(`gear.slot.${slot}`)} ${n}`}
                    onClick={() => {
                      if (filter !== slot) sfx('tab');
                      slotFilter.value = filter === slot ? 'all' : slot;
                    }}
                    {...tipProps(() => <TipBody title={t(`gear.slot.${slot}`)} sub={t('smith.filter.tip', { slot: t(`gear.slot.${slot}`), n })} />)}
                  >
                    <Glyph name={slotGlyph(slot)} />
                    <span class="sm-chip-n">{n}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div class="sm-pieces ms-sunken ms-sunken--plain ms-scroll ms-edgefade" ref={scroller}>
            {visible.length === 0 && <p class="sm-none">{pieces.length === 0 ? t('smith.empty.text') : t('smith.empty.filter')}</p>}
            <div class="sm-grid">
              {visible.map((p, i) => (
                <div class="sm-piece-wrap" style={{ '--i': i } as JSX.CSSProperties} key={p.def.id}>
                  <PieceCard p={p} selected={p.def.id === selId} busy={busy} onSelect={() => onSelect(p.def.id)} />
                </div>
              ))}
              {Array.from({ length: ghosts }, (_, i) => (
                <div class="sm-piece-wrap sm-ghost" key={`g${i}`} aria-hidden="true">
                  <div class="sm-piece">
                    <Octa size="var(--sm-card-slot)" />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <span class="sm-count">{t('smith.pieces.count', { n: fmtInt(pieces.length) })}</span>
        </div>
      </section>
    </KitCtx.Provider>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Attempt log, ledger, odds

function AttemptLog(): JSX.Element {
  lang.value;
  const log = attemptLog.value;
  return (
    <section class="sm-sub sm-log-board">
      <div class="sm-block-h">{t('smith.log.title')}</div>
      <div class="sm-log-box ms-sunken ms-sunken--plain">
          {log.length === 0 ? (
            <p class="sm-none">{t('smith.log.empty')}</p>
          ) : (
            <ul class="sm-log">
              {log.map((a) => (
                <li key={a.n} class={`sm-att ${a.success ? 'is-ok' : 'is-bad'}`} title={a.success ? t('smith.log.success') : t('smith.log.fail')}>
                  <UiGlyph name={a.success ? 'check' : 'close'} tone={a.success ? 'jade' : 'crimson'} flat />
                  <span class="sm-att-n">
                    {itemName(a.gearId)}
                    {a.blessed && (
                      <span class="sm-att-scroll" title={t('smith.log.scroll')}>
                        <Glyph name="talisman" />
                      </span>
                    )}
                  </span>
                  <span class="sm-att-lv ms-num">{a.success ? `+${a.from} › +${a.to}` : `+${a.from}`}</span>
                </li>
              ))}
            </ul>
          )}
      </div>
    </section>
  );
}

function Ledger(): JSX.Element {
  const save = metaSave().value;
  lang.value;
  const s = save.stats.blacksmith;
  const rate = s.attempts > 0 ? s.successes / s.attempts : 0;
  return (
    <section class="sm-sub sm-ledger">
      <div class="sm-block-h">{t('smith.life.title')}</div>
      <div class="sm-ledger-in">
          <StatWell layout="row" size="sm" label={t('smith.life.attempts')} value={fmtInt(s.attempts)} />
          <StatWell layout="row" size="sm" label={t('smith.life.successes')} value={fmtInt(s.successes)} />
          <StatWell layout="row" size="sm" label={t('smith.life.rate')} value={s.attempts > 0 ? fmtPct(rate) : '—'} tone={s.attempts > 0 ? (rateTone(rate) === 'bad' ? 'bad' : rateTone(rate) === 'good' ? 'good' : 'gold') : 'neutral'} />
          <StatWell layout="row" size="sm" label={t('smith.life.yeop')} value={fmtInt(s.yeopSpent)} icon={<CurrencyIcon kind="yeop" />} />
          <StatWell layout="row" size="sm" label={t('smith.life.shards')} value={fmtInt(s.shardsSpent)} icon={<CurrencyIcon kind="shard" />} />
      </div>
    </section>
  );
}

function OddsTable({ plus }: { plus: number | null }): JSX.Element {
  const { content } = deps();
  lang.value;
  const b = content.balance.blacksmith;
  const steps = Math.min(b.successRate.length, b.yeopCost.length, b.shardCost.length);
  // once the Blessing Scroll is on offer its chance and Yeop stand beside the plain ones, so a player sees where it pays (the risky
  // steps) and where it is a poor trade (the early, nearly certain ones); a step it cannot improve shows a dash
  const withScroll = scrollUnlocked(metaSave().value, content);
  return (
    <section class="sm-sub sm-odds-board">
      <div class={`sm-odds ms-sunken ms-sunken--plain ${withScroll ? 'sm-odds--scroll' : ''}`}>
          <div class="sm-odds-row sm-odds-head">
            <span>{t('smith.odds.step')}</span>
            <span>{t('smith.odds.rate')}</span>
            <span class="sm-ic-row" title={t('smith.odds.yeop')}>
              <CurrencyIcon kind="yeop" />
            </span>
            <span class="sm-ic-row" title={t('smith.odds.shards')}>
              <CurrencyIcon kind="shard" />
            </span>
            {withScroll && (
              <>
                <span class="sm-ic-row sm-odds-sc" title={`${t('smith.scroll.title')}: ${t('smith.odds.rate')}`}>
                  <Glyph name="talisman" />%
                </span>
                <span class="sm-ic-row sm-odds-sc" title={`${t('smith.scroll.title')}: ${t('smith.odds.yeop')}`}>
                  <Glyph name="talisman" />
                  <CurrencyIcon kind="yeop" />
                </span>
              </>
            )}
          </div>
          {Array.from({ length: steps }, (_, i) => {
            const rate = b.successRate[i] ?? 0;
            const yeop = b.yeopCost[i] ?? 0;
            const scrollRate = blessedRate(rate);
            const state = plus === null ? '' : i < plus ? 'is-done' : i === plus ? 'is-next' : '';
            return (
              <div class={`sm-odds-row ${state}`} key={i} {...(state === 'is-next' ? { title: t('smith.odds.next') } : state === 'is-done' ? { title: t('smith.odds.done') } : {})}>
                <span class="ms-num">
                  +{i} › +{i + 1}
                </span>
                <b class={`ms-num sm-tone-${rateTone(rate)}`}>{fmtPct(rate)}</b>
                <span class="ms-num">{fmtInt(yeop)}</span>
                <span class="ms-num">{fmtInt(b.shardCost[i] ?? 0)}</span>
                {withScroll &&
                  (scrollRate > rate ? (
                    <>
                      <b class={`ms-num sm-odds-sc sm-tone-${rateTone(scrollRate)}`}>{fmtPct(scrollRate)}</b>
                      <span class="ms-num sm-odds-sc">{fmtInt(yeop * BLESSING_YEOP_MULT)}</span>
                    </>
                  ) : (
                    <>
                      <span class="ms-num sm-odds-sc sm-odds-na">—</span>
                      <span class="ms-num sm-odds-sc sm-odds-na">—</span>
                    </>
                  ))}
              </div>
            );
          })}
      </div>
    </section>
  );
}

/** The small sub-window the ODDS button opens over the refine window body: odds table, ledger and attempt log. */
function OddsSheet({ plus }: { plus: number | null }): JSX.Element {
  lang.value;
  return (
    <KitCtx.Provider value={true}>
      <section class="sm-sheet ms-board ms-kit" aria-label={t('smith.odds.title')}>
        <TitleBar small onClose={() => (oddsOpen.value = false)} closeLabel={t('smith.odds.back')}>
          {t('smith.odds.title')}
        </TitleBar>
        <div class="sm-sheet-in ms-scroll">
          <div class="sm-sheet-a">
            <div class="sm-block-h">{t('smith.odds.title')}</div>
            <OddsTable plus={plus} />
          </div>
          <div class="sm-sheet-b">
            <Ledger />
            <AttemptLog />
          </div>
        </div>
      </section>
    </KitCtx.Provider>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Tab

export function BlacksmithTab(): JSX.Element {
  const { meta, content } = deps();
  const save = metaSave().value;
  const classId = armoryClass.value;
  lang.value;

  const pieces = ownedPieces(save, content, classId);
  const filter = slotFilter.value;
  const visible = filter === 'all' ? pieces : pieces.filter((p) => p.def.slot === filter);
  const piece = pieces.find((p) => p.def.id === selectedId.value) ?? visible[0] ?? pieces[0] ?? null;

  const [run, setRun] = useState<Run | null>(null);
  const [locked, setLocked] = useState(false);
  const timers = useRef<number[]>([]);
  const seqRef = useRef(0);
  const clearTimers = (): void => {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
  };
  useEffect(() => clearTimers, []);
  // another class: drop any pending / displayed attempt
  const lastClass = useRef<ClassId>(classId);
  useEffect(() => {
    if (lastClass.current === classId) return;
    lastClass.current = classId;
    clearTimers();
    setRun(null);
    setLocked(false);
  }, [classId]);

  // the plain quote carries both sides (`base` / `scroll`); the switch decides which one the window works with
  const plainRes = piece ? quoteUpgrade(save, content, classId, piece.def.id) : null;
  const plainQuote = plainRes && plainRes.ok ? plainRes.quote : null;
  const scrollV = scrollView(plainQuote?.scroll ?? null, scrollWanted.value, save.bank.yeop);
  const blessedRes = piece && scrollV.active ? quoteUpgrade(save, content, classId, piece.def.id, { blessing: true }) : null;
  const quote = blessedRes && blessedRes.ok ? blessedRes.quote : plainQuote;
  // the wish is taken back when the view drops to 'short' (a blessed attempt emptied the purse), 'reserve' (the Yeop left is needed by plain
  // attempts) or 'locked': the knob shows off there and cannot be pressed, so a wish that stayed would arm itself again the day the Yeop
  // comes back. The effect is keyed on the switch too: a wish written while the derived wish is already false (a locked / reserved view)
  // changes only the switch, and would otherwise survive until the scroll opens
  const wished = scrollWanted.value;
  const wish = scrollWish(scrollV, wished);
  useEffect(() => {
    if (scrollWanted.value !== wish) scrollWanted.value = wish;
  }, [wish, wished]);

  const toggleScroll = (): void => {
    if (locked) {
      sfx('error');
      return;
    }
    if (!scrollV.enabled) {
      // a phone has no hover (and the narrow chip no words): every state that cannot be pressed says why it does not move
      const key = scrollToastKey(scrollV.state);
      if (key) pushToast(t(key, { n: fmtInt(scrollV.shortYeop), yeop: fmtInt(plainQuote?.scroll.yeop ?? 0) }), 'info');
      else sfx('error');
      return;
    }
    sfx(scrollV.active ? 'toggleOff' : 'toggleOn');
    scrollWanted.value = !scrollV.active;
  };

  const select = (id: string): void => {
    if (locked) return;
    if (id !== piece?.def.id) sfx('click');
    selectedId.value = id;
    setRun(null);
  };

  const refine = (): void => {
    if (!piece || !quote || locked) return;
    if (!quote.canAfford) {
      sfx('error');
      return;
    }
    oddsOpen.value = false;
    const seq = ++seqRef.current;
    const gearId = piece.def.id;
    const cls = classId;
    setLocked(true);
    const blessed = quote.blessed;
    setRun({ seq, gearId, phase: 'charge', from: quote.from, to: quote.to, success: false, blessed });
    const later = (ms: number, fn: () => void): void => {
      timers.current.push(window.setTimeout(fn, ms));
    };
    later(CHARGE_MS, () => {
      const res = meta.upgradeGear(cls, gearId, undefined, { blessing: blessed });
      if (!res.ok) {
        sfx('error');
        pushToast(t(`smith.fail.${res.reason}`), 'bad');
        setRun(null);
        setLocked(false);
        return;
      }
      attemptLog.value = [{ n: ++attemptSeq, gearId, success: res.success, from: res.from, to: res.to, blessed: res.blessed }, ...attemptLog.value].slice(0, 6);
      setRun({ seq, gearId, phase: 'strike', from: res.from, to: res.to, success: res.success, blessed: res.blessed });
      later(REVEAL_MS, () => {
        setRun({ seq, gearId, phase: res.success ? 'success' : 'fail', from: res.from, to: res.to, success: res.success, blessed: res.blessed });
        sfx(res.success ? 'forgeSuccess' : 'forgeFail');
      });
    });
    later(LOCK_MS, () => setLocked(false));
  };

  const shownPlus = piece ? (run && run.gearId === piece.def.id && (run.phase === 'charge' || run.phase === 'strike') ? run.from : piece.plus) : 0;
  const ignite = run && run.phase === 'success' && piece && run.gearId === piece.def.id ? run.to : null;

  const showOdds = oddsOpen.value && piece !== null;
  const tex = useArmTex() as Record<string, string>;
  const forgeUrl = texUrl('uk_armory_b_forge');
  const rootStyle = { ...tex, ...(forgeUrl ? { '--sm-forge-art': `url("${forgeUrl}")` } : {}) } as JSX.CSSProperties;

  return (
    <div class={`sm ${pieces.length === 0 ? 'sm--empty' : ''}`} style={rootStyle}>
      <div class="sm-scene">
        <div class="sm-layout">
          <PieceList pieces={pieces} visible={visible} filter={filter} selId={piece?.def.id ?? null} busy={locked} onSelect={select} />

          <KitCtx.Provider value={true}>
            <section class="sm-forge ms-board ms-kit">
              <TitleBar small icon={<Glyph name="gem" />}>
                {t('smith.window')}
              </TitleBar>
              {piece ? (
                <div class={`sm-win ${showOdds ? 'is-odds' : ''}`}>
                  <div class="sm-win-body ms-scroll ms-edgefade">
                    {showOdds ? (
                      <OddsSheet plus={piece.plus} />
                    ) : (
                      <>
                        <ForgeStage piece={piece} shownPlus={shownPlus} run={run} />
                        <div class="sm-win-grid">
                          <ItemBox piece={piece} shownPlus={shownPlus} />
                          <div class="sm-win-b">
                            <Ingredients piece={piece} quote={quote} bank={save.bank} />
                            <PlusTrack shown={shownPlus} ignite={ignite} />
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                  <ActionBar quote={quote} bank={save.bank} locked={locked} onRefine={refine} scroll={scrollV} onScroll={toggleScroll} />
                </div>
              ) : (
                <div class="sm-empty">
                  <div class="sm-empty-pair" aria-hidden="true">
                    <Octa size="5rem" />
                    <Chevrons />
                    <Octa size="5rem" />
                  </div>
                  <h3>{t('smith.empty.title')}</h3>
                  <p>{t('smith.empty.text')}</p>
                </div>
              )}
            </section>
          </KitCtx.Provider>
        </div>
      </div>
    </div>
  );
}
