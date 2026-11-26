// Treasure chest: the painted lacquer chest drops in on an engraved dais and shakes; it springs open on its own (or on
// click / Enter): the old painting is swapped under a flash of light, god-rays pour out of it and a spray of coins and
// cut gems arcs over the table, then the reward cards deal in. Same pick flow as Level-Up (shared `useCardModal`).
import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { runEvents } from '../../app/runEvents';
import { fmtInt, t } from '../../i18n/i18n';
import type { ModalRequest } from '../../sim/types';
import { texUrl } from '../assets';
import { sfx } from '../audio';
import { Glyph } from '../components/glyphs';
import { Panel } from '../components/Panel';
import { StatWell } from '../components/StatWell';
import { KeyHint } from '../components/Slot';
import { CurrencyIcon, UiGlyph } from '../components/StatIcon';
import { Burst, GodRays, Motes } from '../components/UiFx';
import { deps } from '../env';
import { layout } from '../layout';
import { useKeys, useScope } from '../nav';
import { CardView } from './Card';
import { useCardModal } from './LevelUp';
import { CoinSpray, RewardActions, RewardHead } from './rewardKit';
import './chest.css';

/** Yeop paid for the chest that just opened: the sim emits `chestOpen` right before it raises the modal, i.e. before this mounts. */
let lastChestCost: number | null = null;
runEvents.subscribe((e) => {
  if (e.t === 'chestOpen') lastChestCost = e.boss ? 0 : e.cost;
});

type Phase = 'closed' | 'opening' | 'open';
const AUTO_OPEN_MS = 900;
const OPENING_MS = 700;

/**
 * Phone portrait (chest.css): the card column scrolls INSIDE the zone, above the pinned button bar, instead of running under the bar. `more` = cards
 * lie below the view (the column fades out at its foot and a chevron under it scrolls on a tap), `above` = it has been scrolled (a fade at its head).
 * Measured once the dealt cards have landed (their fly-in transform counts as scrollable overflow), on scroll, on resize and when the fonts arrive.
 */
function useColumnMore(zone: { current: HTMLElement | null }, on: boolean, deps: unknown[]): { more: boolean; above: boolean } {
  const [more, setMore] = useState(false);
  const [above, setAbove] = useState(false);
  useLayoutEffect(() => {
    const el = on ? zone.current?.querySelector<HTMLElement>('.ms-chest-cards') : null;
    if (!el) {
      setMore(false);
      setAbove(false);
      return undefined;
    }
    const upd = (): void => {
      const portrait = !!el.closest('.ms-portrait');
      setMore(portrait && el.scrollHeight - el.scrollTop - el.clientHeight > 8);
      setAbove(portrait && el.scrollTop > 8);
    };
    const timer = window.setTimeout(upd, 1100);
    upd();
    let roRaf = 0;
    const onResize = (): void => {
      if (roRaf) return;
      roRaf = requestAnimationFrame(() => {
        roRaf = 0;
        upd();
      });
    };
    el.addEventListener('scroll', upd, { passive: true });
    el.addEventListener('animationend', upd);
    void document.fonts?.ready.then(upd);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onResize);
    ro?.observe(el);
    return () => {
      window.clearTimeout(timer);
      if (roRaf) cancelAnimationFrame(roRaf);
      el.removeEventListener('scroll', upd);
      el.removeEventListener('animationend', upd);
      ro?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { more, above };
}

export function Chest({ request }: { request: ModalRequest }): JSX.Element {
  const { content, events } = deps();
  const scope = useScope();
  const st = useCardModal(request);
  const [phase, setPhase] = useState<Phase>('closed');
  const phaseRef = useRef<Phase>('closed');
  const openTimerRef = useRef(0);
  const zoneRef = useRef<HTMLDivElement>(null);
  // where the light and the coins come from: the chest's mouth, as percentages of the modal (measured in layout effect, never synchronously inside open())
  const [mouth, setMouth] = useState({ x: 50, y: 50 });
  const [paid, setPaid] = useState<number | null>(() => {
    const v = lastChestCost;
    lastChestCost = null;
    return v;
  });
  // the free boss chest is the black horned chest (a registered pair like the red one); the red one stands in until it is shipped
  const closedUrl = texUrl(request.free ? 'art_chest_boss_closed' : 'art_chest_closed') ?? texUrl('art_chest_closed');
  const openUrl = texUrl(request.free ? 'art_chest_boss_open' : 'art_chest_open') ?? texUrl('art_chest_open');
  const cost = request.free ? 0 : (paid ?? Math.round(content.balance.chestCost.base));

  useLayoutEffect(() => {
    const zone = zoneRef.current;
    const root = zone?.closest<HTMLElement>('.ms-cardmodal');
    if (!zone || !root) return undefined;
    const measure = (): void => {
      const a = zone.getBoundingClientRect();
      const b = root.getBoundingClientRect();
      if (b.width > 0 && b.height > 0) {
        const nx = ((a.left + a.width / 2 - b.left) / b.width) * 100;
        const ny = ((a.top + a.height * 0.42 - b.top) / b.height) * 100;
        setMouth((prev) => (Math.abs(prev.x - nx) < 0.2 && Math.abs(prev.y - ny) < 0.2 ? prev : { x: nx, y: ny }));
      }
    };
    measure();
    let raf = 0;
    const schedule = (): void => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        measure();
      });
    };
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    ro?.observe(root);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, []);

  const open = (): void => {
    if (phaseRef.current !== 'closed') return;
    phaseRef.current = 'opening';
    setPhase('opening');
    sfx('chestOpen');
    window.clearTimeout(openTimerRef.current);
    openTimerRef.current = window.setTimeout(() => {
      openTimerRef.current = 0;
      phaseRef.current = 'open';
      setPhase('open');
    }, OPENING_MS);
  };

  useEffect(() => {
    const id = window.setTimeout(open, AUTO_OPEN_MS);
    const off = events?.subscribe((e) => {
      if (e.t === 'chestOpen') setPaid(e.boss ? 0 : e.cost);
    });
    return () => {
      window.clearTimeout(id);
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = 0;
      off?.();
    };
  }, []);

  // until the cards are on the table, digits / R / B / X / Enter only open the chest (never pick blind)
  useKeys((a) => {
    if (phaseRef.current === 'open') return false;
    if (a.kind === 'card' || a.kind === 'reroll' || a.kind === 'banish' || a.kind === 'skip' || a.kind === 'confirm') {
      if (!a.repeat) open();
      return true;
    }
    return false;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'KeyS' && phaseRef.current !== 'open') e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const isOpen = phase === 'open';
  const lit = phase !== 'closed';
  const { more, above } = useColumnMore(zoneRef, isOpen, [isOpen, st.dealKey, request.cards]);

  // where the open chest docks: in the free band left of the cards. On wide screens that band is fixed by CSS; on a phone in
  // landscape it is whatever the three cards leave (a few rem), so it is measured once the cards are on the table and handed
  // to the CSS as --dock-x (px, towards the left edge) and --dock-k (scale). Unused outside phone landscape.
  useLayoutEffect(() => {
    if (!isOpen) return undefined;
    const zone = zoneRef.current;
    const cards = zone?.querySelector<HTMLElement>('.ms-chest-cards');
    const box = zone?.querySelector<HTMLElement>('.ms-chest-box');
    if (!zone || !cards || !box) return undefined;
    const fit = (): void => {
      const room = cards.offsetLeft;
      const bw = box.offsetWidth;
      if (bw <= 0) return;
      const k = Math.max(0.22, Math.min(0.9, (room - 10) / bw));
      zone.style.setProperty('--dock-x', `${(-(zone.clientWidth / 2 - room / 2)).toFixed(1)}px`);
      zone.style.setProperty('--dock-k', k.toFixed(3));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [isOpen]);
  const costPlate = (cls: string): JSX.Element =>
    cost > 0 ? (
      <span class={`ms-chest-cost ms-plate ${cls}`}>
        <CurrencyIcon kind="yeop" size="1.2rem" />
        <span class="ms-chest-cost-t">{t('chest.paid', { n: fmtInt(cost) })}</span>
      </span>
    ) : (
      <span class={`ms-chest-cost ms-plate is-free ${cls}`}>
        <UiGlyph name="star" tone="gold" flat size="1.1rem" />
        {t('common.free')}
      </span>
    );
  const costNode = costPlate('ms-chest-cost--head');
  const sub = phase === 'closed' ? t('chest.sealed') : phase === 'opening' ? t('chest.opening') : st.banishMode ? <b>{t('levelup.banishMode')}</b> : t('chest.reward');
  const name = t(request.free ? 'chest.nameBoss' : 'chest.name');
  const n = Math.max(1, Math.min(4, request.cards.length));
  const mx = `${mouth.x.toFixed(1)}%`;
  const my = `${mouth.y.toFixed(1)}%`;

  return (
    // 1-4 cards (balance.chest.cards; a dry build is dealt only the Boon and shards): `ms-chest--n<count>` + `--n` drive the layout; four cards
    // share LevelUp's four-column card contract (`ms-lu--n4`: card.css) and give the ledger's room to the cards (chest.css)
    <div
      class={`ms-cardmodal ms-rw ms-chest ms-chest--n${n} ${n >= 4 ? 'ms-lu--n4' : ''} ms-norays is-${phase} ${request.free ? 'is-free' : ''}`}
      style={{ '--n': String(n) } as JSX.CSSProperties}
      ref={scope}
      role="dialog"
      aria-modal="true"
      aria-label={name}
    >
      {lit && (
        <div key="rays" class="ms-chest-rays" aria-hidden="true">
          <GodRays tone="gold" x={mx} y={my} intensity={0.62} seed={request.free ? 19 : 7} />
        </div>
      )}
      <Motes preset="gold" count={26} color="#ffc65a" seed={5} />
      {phase === 'opening' && <Burst key="burst" play={1} tone="gold" x={mx} y={my} scale={1.1} sparks={36} seed={9} />}
      {lit && <CoinSpray key="spray" play={1} x={mouth.x / 100} y={mouth.y / 100} seed={request.free ? 31 : 17} count={request.free ? 64 : 48} />}

      <RewardHead
        class="ms-chest-head"
        eyebrow={t(request.free ? 'chest.titleBoss' : 'chest.title')}
        eyebrowIcon={<UiGlyph name="chest" tone="gold" flat size="1.3rem" />}
        title={name}
        sub={sub}
        extra={costNode}
      />

      <div class="ms-chest-zone" ref={zoneRef}>
        <div class="ms-chest-halo" aria-hidden="true" />
        <div class="ms-chest-dais" aria-hidden="true" />
        <button type="button" class={`ms-chest-box ${isOpen ? 'is-behind' : ''}`} data-nav="" data-autofocus="" disabled={phase !== 'closed'} onClick={open} aria-label={t('chest.open')}>
          {closedUrl || openUrl ? (
            <>
              {closedUrl && <img class="ms-chest-img is-shut" src={closedUrl} alt="" draggable={false} />}
              {openUrl && <img class="ms-chest-img is-lid" src={openUrl} alt="" draggable={false} />}
            </>
          ) : (
            <Glyph name="chest" class="ms-chest-glyph" />
          )}
        </button>
        <Panel variant="board" thin title={t('chest.ledger')} class="ms-chest-ledger">
          <div class="ms-chest-lg">
            <StatWell
              layout="stack"
              size="hero"
              tone="gold"
              dotted
              label={cost > 0 ? t('chest.ledgerPaid') : t('chest.ledgerFree')}
              icon={cost > 0 ? <CurrencyIcon kind="yeop" size="2.6rem" /> : <UiGlyph name="star" tone="gold" flat size="2.2rem" />}
              value={cost > 0 ? fmtInt(cost) : '0'}
            />
            <hr class="ms-groove" />
            <StatWell layout="stack" size="lg" tone="good" dotted icon={<UiGlyph name="star" tone="gold" flat size="1.8rem" />} label={t('chest.ledgerFloor')} value={`${t(`rarity.${request.free ? 'epic' : 'rare'}`)}+`} />
            <hr class="ms-groove" />
            <div class="ms-chest-offer" role="list" aria-label={t('chest.ledgerOffer')}>
              <span class="ms-chest-offer-h">{t('chest.ledgerOffer')}</span>
              {request.cards.map((c, i) => (
                <span key={i} role="listitem" class={`ms-chest-offer-row ms-r-${c.rarity}`}>
                  <b class="ms-chest-offer-n ms-plate ms-num">{i + 1}</b>
                  <span class="ms-chest-offer-r">{t(`rarity.${c.rarity}`)}</span>
                </span>
              ))}
            </div>
          </div>
        </Panel>
        {isOpen && (
          <div class={`ms-cm-cards ms-chest-cards ${more ? 'has-more' : ''} ${above ? 'has-above' : ''}`} key={st.dealKey}>
            {request.cards.map((card, i) => (
              <CardView
                key={`${card.kind}:${card.id}:${i}`}
                card={card}
                index={i}
                delay={0.1 + i * 0.12}
                banish={st.banishMode}
                picked={st.picked === i}
                dim={st.picked !== null && st.picked !== i}
                onPick={st.choose}
              />
            ))}
          </div>
        )}
        {isOpen && more && (
          <button
            type="button"
            class="ms-chest-more"
            data-nav=""
            aria-label={t('levelup.moreCards')}
            onClick={(e) => {
              const col = e.currentTarget.parentElement?.querySelector<HTMLElement>('.ms-chest-cards');
              col?.scrollBy({ top: Math.round(col.clientHeight * 0.7), behavior: 'smooth' });
            }}
          >
            <svg viewBox="0 0 24 14" aria-hidden="true">
              <path d="M2 2.5 12 11.5 22 2.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
        )}
      </div>

      {!isOpen && (
        // phone portrait only (CSS): what the chest holds, under the chest instead of an empty lower half: three picks and the rarity each will be
        <div class="ms-chest-peek" role="list" aria-label={t('chest.ledgerOffer')}>
          {request.cards.map((c, i) => (
            <span key={i} role="listitem" class={`ms-chest-peek-it ms-r-${c.rarity}`}>
              <b class="ms-chest-offer-n ms-plate ms-num">{i + 1}</b>
              <span class="ms-chest-offer-r">{t(`rarity.${c.rarity}`)}</span>
            </span>
          ))}
        </div>
      )}
      {isOpen ? (
        <RewardActions st={st} request={request} sealedNote={t('chest.sealedNote')} above={costPlate('ms-chest-cost--col')} class="ms-chest-bottom" />
      ) : phase === 'closed' ? (
        <div class="ms-chest-prompt">
          <KeyHint k="Enter" kit class="ms-kbd-only" />
          <span>{layout.value.touch ? t('chest.tapToOpenTouch') : t('chest.tapToOpen')}</span>
        </div>
      ) : (
        <div class="ms-chest-prompt is-hidden" aria-hidden="true" />
      )}
      {isOpen && request.waited > 0 && <div class="ms-cm-hint">{t('levelup.waiting', { s: Math.max(0, Math.ceil(20 - request.waited)) })}</div>}
    </div>
  );
}
