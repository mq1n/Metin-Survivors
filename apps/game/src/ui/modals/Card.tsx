// A reward card (Level-Up / Essence / Chest / Boss reward). Kit v1 look (owner B6): a charcoal stone card with a chamfered
// pewter bevel, rarity as an inner rim light, an octagon icon slot (rank-band tile + rank medal outside the icon), a
// stone name plate, gem-tile stat rows with big recessed number wells, slot pips in the footer, and a stamped banish seal.
import type { JSX } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { Card } from '../../sim/types';
import { t } from '../../i18n/i18n';
import { iconUrlForRank, texUrl } from '../assets';
import { bandOf, describeCard, type CardPactView, type PactLinkView } from '../cardModel';
import { rankLabel } from '../content';
import { Chip } from '../components/Chip';
import { ELEMENT_COLOR } from '../components/Icon';
import { Medal } from '../components/Medal';
import { IconSlot } from '../components/Slot';
import { CurrencyIcon, StatIcon } from '../components/StatIcon';
import { Burst } from '../components/UiFx';
import { sfx } from '../audio';
import { buildTip, type TipSubject } from '../itemTips';
import { RankAura, RankSparks, ReliefDefs } from './cardArt';

export interface CardViewProps {
  card: Card;
  index: number;
  onPick: (index: number) => void;
  /** banish mode: crimson rim + seal */
  banish?: boolean;
  picked?: boolean;
  dim?: boolean;
  /** deal-in stagger (s) */
  delay?: number;
  /** hotkey label override */
  keyLabel?: string;
  compact?: boolean;
}

/** The serrated rim of the banish seal (our own geometry: 14 soft lobes). */
const SEAL_RIM = (() => {
  const pts: string[] = [];
  for (let i = 0; i < 168; i++) {
    const a = (i / 168) * Math.PI * 2;
    const r = 53 + 3.6 * Math.cos(a * 14);
    pts.push(`${(60 + r * Math.sin(a)).toFixed(2)} ${(60 - r * Math.cos(a)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
})();

function BanishSeal(): JSX.Element {
  return (
    <svg class="ms-card-seal" viewBox="0 0 120 120" aria-hidden="true">
      <defs>
        <radialGradient id="ms-seal-g" cx="0.36" cy="0.3" r="0.95">
          <stop offset="0" stop-color="#f08a76" />
          <stop offset="0.38" stop-color="#b3281d" />
          <stop offset="0.8" stop-color="#58100b" />
          <stop offset="1" stop-color="#2a0705" />
        </radialGradient>
        <linearGradient id="ms-seal-x" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#fff0dc" />
          <stop offset="1" stop-color="#d9a98a" />
        </linearGradient>
      </defs>
      <path d={SEAL_RIM} fill="#1a0302" transform="translate(1.6 3.2)" opacity=".55" />
      <path d={SEAL_RIM} fill="url(#ms-seal-g)" stroke="#1d0402" stroke-width="2" stroke-linejoin="round" />
      <circle cx="60" cy="60" r="40" fill="none" stroke="#f3b9a4" stroke-opacity=".38" stroke-width="2" />
      <circle cx="60" cy="60" r="37" fill="none" stroke="#2a0705" stroke-opacity=".6" stroke-width="2" />
      <g stroke-linecap="round" fill="none">
        <path d="M43 43 77 77M77 43 43 77" stroke="#2a0705" stroke-opacity=".7" stroke-width="12" transform="translate(1 2.2)" />
        <path d="M43 43 77 77M77 43 43 77" stroke="url(#ms-seal-x)" stroke-width="9.5" />
        <path d="M42.5 41.5 76.5 75.5" stroke="#fff" stroke-opacity=".5" stroke-width="2" />
      </g>
    </svg>
  );
}

const TO_ARROW = (
  <svg class="ms-card-rank-arrow" viewBox="0 0 24 14" aria-hidden="true">
    <path d="M1 7h15" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none" />
    <path d="M14 1.6 22 7l-8 5.4z" fill="currentColor" />
  </svg>
);

/** Two interlocked gold rings: the mark of an awakening pact (cards, the level-up build bar). Drawn in currentColor. `broken` = the pact cannot be kept: the rings are apart and struck through. */
export function PactGlyph({ class: cls, broken }: { class?: string; broken?: boolean }): JSX.Element {
  return (
    <svg class={cls} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {broken ? (
        <>
          <rect x="1.6" y="7.4" width="10" height="9.2" rx="4.6" fill="none" stroke="currentColor" stroke-width="2.2" />
          <rect x="12.4" y="7.4" width="10" height="9.2" rx="4.6" fill="none" stroke="currentColor" stroke-width="2.2" />
          <path d="M8.6 3.6 15.4 20.4" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
        </>
      ) : (
        <>
          <rect x="2.4" y="7.4" width="12.4" height="9.2" rx="4.6" fill="none" stroke="currentColor" stroke-width="2.2" />
          <rect x="9.2" y="7.4" width="12.4" height="9.2" rx="4.6" fill="none" stroke="currentColor" stroke-width="2.2" />
        </>
      )}
    </svg>
  );
}

/**
 * A skill's tooltip with its pact state under it (the level-up build bar, the build board). A phone has no hover and no board in the HUD:
 * the long-press tooltip is where "Needs Saddlecraft, rank 1 of 2" can be read, so the chain mark of the bar and the chain of the board
 * are explained there (and by the aria label), never by a native `title` that a desktop would show twice.
 */
export function pactTip(subject: TipSubject, link: PactLinkView | undefined): JSX.Element {
  return (
    <>
      {buildTip(subject)}
      {link && (
        <div class={`ms-tip-pact is-${link.state}`}>
          <PactGlyph class="ms-tip-pact-glyph" broken={link.state === 'blocked'} />
          <span>{link.text}</span>
        </div>
      )}
    </>
  );
}

/**
 * The pact line of a card (OF-02): a stone slab in the body with the icon(s) of the partner(s) and the sentence. `needs` = a G2
 * skill that waits for a passive, `awakens` = a passive that moves owned skills toward their awakening, `ready` = the pact is kept,
 * `blocked` / `warn` = the pact cannot be kept (no passive slot left). Under pressure the slab sheds parts in steps (useFlavourFit):
 * `is-tight` drops the icons and the note, `is-min` shows the chain mark and the names alone (a `ready` slab is left out: the ribbon says it).
 */
function PactSlab({ pact }: { pact: CardPactView }): JSX.Element {
  const label = [pact.text, pact.note, pact.warn].filter(Boolean).join('. ');
  return (
    <span class={`ms-card-pact is-${pact.mode} ${pact.icons.length > 1 ? 'is-multi' : ''}`} role="note" title={label} aria-label={label}>
      <span class="ms-card-pact-icons" aria-hidden="true">
        {pact.icons.map((ic) => (
          <IconSlot key={ic.id} kit size="sm" icon={ic.icon} kind={ic.kind} />
        ))}
        {pact.more > 0 && <i class="ms-card-pact-more">{t('offers.pact.more', { n: pact.more })}</i>}
      </span>
      <span class="ms-card-pact-txt" aria-hidden="true">
        <b>
          <PactGlyph class="ms-card-pact-glyph" broken={pact.mode === 'blocked' || pact.mode === 'warn'} />
          <span class="ms-card-pact-full">{pact.text}</span>
          <span class="ms-card-pact-short">{pact.short}</span>
        </b>
        {pact.note && <em>{pact.note}</em>}
        {pact.warn && (
          <em class="is-warn">
            <span class="ms-card-pact-full">{pact.warn}</span>
            <span class="ms-card-pact-short">{pact.warnShort ?? pact.warn}</span>
          </em>
        )}
      </span>
    </span>
  );
}

/** A rank medal label with the band letter and the number set apart (G2 must never read as 62): `G` `2`, plain for 1 2 3 and P. */
function rankText(idx: number): JSX.Element | string {
  const lbl = rankLabel(idx);
  const m = /^([A-Za-z]+)(\d+)$/.exec(lbl);
  if (!m) return lbl;
  return (
    <>
      <span class="ms-rk-l">{m[1]}</span>
      <span class="ms-rk-n">{m[2]}</span>
    </>
  );
}

/**
 * The name sits on a plaque with scroll ends: the text is shrunk (down to 80 %) until it fits between the ends on one line,
 * and only a name that is still too long wraps to two lines at a smaller size. Re-fits when the fonts load or the box resizes.
 */
function NamePlate({ title }: { title: string }): JSX.Element {
  const box = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    const txt = el?.firstElementChild as HTMLElement | null | undefined;
    if (!el || !txt) return;
    let busy = false;
    const fit = (): void => {
      if (busy) return;
      busy = true;
      el.classList.remove('is-wrap');
      txt.style.fontSize = '';
      const cs = getComputedStyle(el);
      const avail = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const natural = txt.scrollWidth;
      if (avail > 0 && natural > avail + 0.5) {
        const base = parseFloat(getComputedStyle(txt).fontSize);
        const k = avail / natural;
        if (k >= 0.86) txt.style.fontSize = `${(base * k * 0.985).toFixed(2)}px`;
        else {
          // two lines at (nearly) the same size as the single-line names; the plaque is taller on every card of the row
          el.classList.add('is-wrap');
          txt.style.fontSize = `${(base * 0.94).toFixed(2)}px`;
          const longest = Math.max(...txt.textContent!.split(/\s+/).map((w) => w.length), 1);
          // a single long word still has to fit between the scroll ends
          if (txt.scrollWidth > avail + 0.5 && longest > 6) txt.style.fontSize = `${(base * 0.94 * Math.max(0.7, avail / txt.scrollWidth)).toFixed(2)}px`;
        }
      }
      busy = false;
    };
    fit();
    void document.fonts?.ready.then(fit);
    let roRaf = 0;
    const onResize = (): void => {
      if (roRaf) return;
      roRaf = requestAnimationFrame(() => {
        roRaf = 0;
        fit();
      });
    };
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onResize);
    ro?.observe(el);
    return () => {
      if (roRaf) cancelAnimationFrame(roRaf);
      ro?.disconnect();
    };
  }, [title]);
  return (
    <span class="ms-card-name" ref={box}>
      <span class="ms-card-name-t">{title}</span>
    </span>
  );
}

/**
 * The flavour line is a slab under the stat rows: when the card is too short to show all its lines (a line clamp would end it
 * with an ellipsis mid-sentence) the slab is left out instead. Re-checked when the card resizes or the fonts load.
 */
function useFlavourFit(card: { current: HTMLElement | null }, key: string): void {
  useLayoutEffect(() => {
    const el = card.current;
    if (!el) return;
    const fit = (): void => {
      // the pact slab (OF-02) stays whole: after the flavour slab is left out, a body that still overflows puts the slab on its
      // tight form (no icons, no note); checked once more after the flavour slab has been settled below
      const pk = el.querySelector<HTMLElement>('.ms-card-pact');
      const settlePact = (): void => {
        const body = pk?.parentElement;
        if (!pk || !body) return;
        const over = (): boolean => body.scrollHeight > body.clientHeight + 1;
        pk.classList.remove('is-tight', 'is-min');
        el.removeAttribute('data-squeeze');
        if (over()) pk.classList.add('is-tight');
        // still too tall (a very narrow column): the chain mark and the names alone, two lines at most (a `ready` slab is left out by
        // the CSS: the awakening ribbon already says it); a name is wrapped, never cut mid-word
        if (over()) pk.classList.add('is-min');
        // the name still does not fit under two tall stat rows: the rows give up a few pixels (a `needs` name is never the thing that is cut); an attribute,
        // not a class: the card's own class list is rewritten by every render (picked / dim / banish)
        if (over()) el.setAttribute('data-squeeze', '');
      };
      const f = el.querySelector<HTMLElement>('.ms-card-flav');
      const inner = f?.firstElementChild as HTMLElement | null | undefined;
      if (!f || !inner) return settlePact();
      f.classList.remove('is-cut');
      // the text is clamped to a few lines inside the slab; a slab too short for all of them is left out (no ellipsis mid-sentence)
      const cs = getComputedStyle(f);
      const need = inner.scrollHeight + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      const body = f.parentElement;
      const out = body ? f.getBoundingClientRect().bottom > body.getBoundingClientRect().bottom - 3 : false;
      if (inner.scrollHeight > inner.clientHeight + 2 || need > f.clientHeight + 1.5 || out) f.classList.add('is-cut');
      settlePact();
    };
    fit();
    void document.fonts?.ready.then(fit);
    let roRaf = 0;
    const onResize = (): void => {
      if (roRaf) return;
      roRaf = requestAnimationFrame(() => {
        roRaf = 0;
        fit();
      });
    };
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onResize);
    ro?.observe(el);
    return () => {
      if (roRaf) cancelAnimationFrame(roRaf);
      ro?.disconnect();
    };
  }, [card, key]);
}

export function CardView({ card, index, onPick, banish, picked, dim, delay = 0, keyLabel, compact }: CardViewProps): JSX.Element {
  const m = describeCard(card);
  const cardRef = useRef<HTMLButtonElement>(null);
  const scrolledRef = useRef(false);
  useFlavourFit(cardRef, `${m.flavour ?? ''}|${m.pact?.text ?? ''}|${m.pact?.note ?? ''}|${m.pact?.warn ?? ''}`);
  const rot = (index - 1) * 2.2;
  const stone = texUrl('uk_hud_bar');
  // painted name plaque (uk_levelup_plaque); the drawn bevel + cloud-scroll plaque in card.css is the fallback
  const plaque = texUrl('uk_levelup_plaque');
  const band = bandOf(m);
  const reliefId = `ms-rl-${band}-${index}`;
  // the icon tile again as a CSS image: card.css screens a blurred copy of it over the slot (the bloom) and tints it with the element
  // (a card with an emblem drawn over its plate gets none: the blurred copy would glow with the plate's own picture, the coins the emblem covers)
  const icUrl = m.emblem ? null : iconUrlForRank(m.icon, m.rankIdx);
  const elColor = m.element ? ELEMENT_COLOR[m.element] : undefined;
  const classes = [
    'ms-card',
    `ms-r-${m.rarity}`,
    `ms-card--${m.kind}`,
    `ms-band-${band}`,
    m.rarity === 'legendary' ? 'ms-frame-legendary' : '',
    plaque ? 'has-plaque' : '',
    m.pact ? 'has-pact' : '',
    m.lines.length <= 1 ? 'ms-card--sparse' : '',
    banish ? 'is-banish' : '',
    picked ? 'is-picked' : '',
    dim ? 'is-dim' : '',
    compact ? 'ms-card--compact' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const upgrade = m.rankFrom !== undefined && m.rankTo !== undefined;
  // the slot medal: a NEW skill wears its rank (1 2 3 M1 M2 G1 G2 P), other new items their level as a plain tag. An upgrade shows
  // its rank once, in the from -> to row (the rank-band tile of the icon carries the new band, no second medal on the slot)
  const slotMark = upgrade
    ? m.rankIdx !== undefined
      ? { iconRank: m.rankIdx }
      : {}
    : m.rankIdx !== undefined
      ? { rank: m.rankIdx }
      : m.rankTo !== undefined && m.iconKind !== 'misc'
        ? { badge: m.rankTo }
        : {};
  return (
    <button
      type="button"
      ref={cardRef}
      class={classes}
      data-nav=""
      data-band={band}
      style={
        {
          '--deal-delay': `${delay}s`,
          '--deal-rot': `${rot}deg`,
          '--ci0': String(index),
          ...(stone ? { '--card-stone': `url("${stone}")` } : {}),
          ...(plaque ? { '--lu-plaque': `url("${plaque}")` } : {}),
          ...(icUrl ? { '--ic-url': `url("${icUrl}")` } : {}),
          ...(elColor ? { '--el-c': elColor } : {}),
        } as JSX.CSSProperties
      }
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') sfx('cardHover');
      }}
      onFocus={() => sfx('cardHover')}
      onClick={() => {
        if (scrolledRef.current) {
          scrolledRef.current = false;
          return;
        }
        onPick(index);
      }}
    >
      <span class="ms-card-bg" aria-hidden="true" />
      <span class="ms-card-gem" aria-hidden="true" />
      <span class="ms-card-key">{keyLabel ?? index + 1}</span>
      <span class="ms-card-flags">
        {m.isNew && (
          <Chip tone="new" size="sm">
            {t('card.new')}
          </Chip>
        )}
        {!m.isNew && m.rankTo !== undefined && m.rankFrom === undefined && (
          <Chip tone="gold" size="sm">
            {t('card.rankTo', { to: m.rankTo })}
          </Chip>
        )}
      </span>

      <span class="ms-card-art">
        <span class="ms-card-halo" />
        <span class="ms-card-ring" aria-hidden="true" />
        <span class="ms-card-slotwrap" style={{ '--rl': `url(#${reliefId})` } as JSX.CSSProperties}>
          <ReliefDefs band={band} id={reliefId} />
          <RankAura band={band} />
          <IconSlot
            kit
            size="xxl"
            icon={m.icon}
            kind={m.iconKind}
            rarity={m.rarity}
            {...(m.element ? { element: m.element } : {})}
            {...(m.glyph ? { glyph: m.glyph } : {})}
            {...(m.slot ? { slot: m.slot } : {})}
            {...slotMark}
            awakened={m.awakening}
          />
          {m.emblem === 'shard' && (
            <span class="ms-card-emblem is-shard" aria-hidden="true">
              <CurrencyIcon kind="shard" size="78%" />
            </span>
          )}
          <RankSparks band={band} />
        </span>
      </span>

      <span class="ms-card-rarity">{m.rarityLabel ?? t(`rarity.${m.rarity}`)}</span>
      <NamePlate title={m.title} />
      {(m.sub || m.slotLabel) && (
        <span class="ms-card-kind">
          {m.iconKind === 'skill' && m.element && (
            <>
              <b class="ms-card-el" style={{ '--el': `var(--el-${m.element})` } as JSX.CSSProperties}>
                {t(`element.${m.element}`)}
              </b>
              {' · '}
            </>
          )}
          {m.sub}
          {m.slotLabel ? ` · ${m.slotLabel}` : ''}
        </span>
      )}
      {upgrade && (
        <span class="ms-card-rank" role="group" aria-label={t('card.rankFromTo', { from: m.rankFrom ?? '', to: m.rankTo ?? '' })}>
          {m.rankFromIdx !== undefined ? <Medal rank={m.rankFromIdx} label={rankText(m.rankFromIdx)} size="md" class="ms-card-rm" /> : <Medal tag label={m.rankFrom} size="md" class="ms-card-rm" />}
          {TO_ARROW}
          {m.rankIdx !== undefined ? <Medal rank={m.rankIdx} label={rankText(m.rankIdx)} size="md" class={`ms-card-rm is-to ${m.awakening ? 'is-p' : ''}`} /> : <Medal tag label={m.rankTo} size="md" class="ms-card-rm is-to" />}
        </span>
      )}
      {m.instant && <span class="ms-card-rank is-note">{m.instant}</span>}
      {m.awakening && (
        <span class={`ms-card-awaken ${m.pact?.mode === 'ready' ? 'is-pact' : ''}`} title={m.pact?.mode === 'ready' ? `${t('card.awakens')} · ${m.pact.text}` : t('card.awakens')}>
          {m.pact?.mode === 'ready' && <PactGlyph class="ms-card-awaken-glyph" />}
          <span class="ms-card-awaken-full">{t('card.awakens')}</span>
          <span class="ms-card-awaken-short" aria-hidden="true">
            {t('card.awakensShort')}
          </span>
        </span>
      )}

      <span class="ms-card-rule" aria-hidden="true" />
      <span
        class={`ms-card-body ${m.lines.length === 0 ? 'is-desc' : ''}`}
        onScroll={() => {
          scrolledRef.current = true;
        }}
      >
        {m.desc && (
          <span
            class="ms-card-desc"
            onScroll={() => {
              scrolledRef.current = true;
            }}
            onPointerDown={(e) => {
              const el = e.currentTarget;
              if (el.scrollHeight > el.clientHeight + 2 && e.clientX - el.getBoundingClientRect().left >= el.clientWidth) {
                scrolledRef.current = true;
                e.stopPropagation();
              }
            }}
          >
            <span class="ms-card-desc-t">{m.desc}</span>
          </span>
        )}
        {m.lines.map((l, i) => (
          <span class={`ms-card-line ${l.from ? 'has-from' : ''} ${l.stat || l.currency ? 'has-ico' : ''} ${l.positive ? 'is-up' : 'is-down'}`} key={i}>
            {l.currency ? (
              <span class="ms-card-lico ms-card-lico--cur" aria-hidden="true">
                <CurrencyIcon kind={l.currency} size="100%" />
              </span>
            ) : (
              l.stat && <StatIcon stat={l.stat} class="ms-card-lico" />
            )}
            <span class="ms-card-llabel">{l.label}</span>
            <span class={`ms-card-well ${l.positive ? 'is-up' : 'is-down'}`}>
              {l.from && (
                <span class="ms-card-from">
                  {l.from}
                  <i>→</i>
                </span>
              )}
              <b class={l.positive ? 'ms-good' : 'ms-bad'}>
                {l.sign}
                {l.amount}
              </b>
            </span>
          </span>
        ))}
        {m.pact && <PactSlab pact={m.pact} />}
        {m.flavour && (
          <span class="ms-card-flav">
            <span class="ms-card-flav-t">{m.flavour}</span>
          </span>
        )}
        {m.replaces && <span class="ms-card-replaces">{m.replaces}</span>}
      </span>
      {m.footer && (
        <span class="ms-card-foot">
          <span class="ms-card-foottext">{m.footer}</span>
          {m.slotUse && (
            <span class="ms-card-pips" aria-hidden="true">
              {Array.from({ length: Math.min(12, m.slotUse.max) }, (_, k) => (
                <i key={k} class={k + 1 < m.slotUse!.n ? 'is-on' : k + 1 === m.slotUse!.n ? 'is-new' : ''} />
              ))}
            </span>
          )}
        </span>
      )}
      {banish && (
        <span class="ms-card-banish" aria-hidden="true">
          <BanishSeal />
        </span>
      )}
      {picked && (
        <span class="ms-card-chosen" aria-hidden="true">
          <i class="ms-flash" style={{ '--fx-x': '50%', '--fx-y': '30%' } as JSX.CSSProperties} />
          <Burst play={1} tone={m.rarity === 'legendary' ? 'legendary' : 'gold'} x="50%" y="28%" scale={0.55} halo />
        </span>
      )}
    </button>
  );
}
