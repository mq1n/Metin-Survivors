// Shared parts of the three reward modals (Metin essence, treasure chest, boss reward; owner: B7 essence-chest).
// All of it is built on the UI kit (rust-copper plate, stone buttons, UiFx light) with our own geometry: the head
// (eyebrow plate + title with a light sweep + subtitle on a scrim), the Reroll / Banish / Leave action row with engraved
// count wells, a one-shot coin / gem spray (canvas, deterministic from a seed), and the pure helpers that place sockets

import type { ComponentChildren, JSX } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { fmtInt, t } from '../../i18n/i18n';
import type { ModalRequest } from '../../sim/types';
import { Button } from '../components/Button';
import { KeyHint } from '../components/Slot';
import { UiGlyph } from '../components/StatIcon';
import { prefersReducedMotion, shineProps } from '../components/UiFx';
import { layout } from '../layout';
import type { CardModalState } from './LevelUp';
import { GEM_HUES, sprayAt, sprayParticles } from './rewardGeom';
import './reward.css';

export { GEM_HUES, hashStr, MED, marksOf, medallionFits, ringAngle, ringPoint, SOCKET_GEMS, sprayAt, sprayParticles, STONE_RING_DEG, stoneVariant, type Chip3, type Mark, type MarkKind, type StoneVariant } from './rewardGeom';

// ---------------------------------------------------------------------------------------------------------------
// small icons (own geometry)

const svgProps = { viewBox: '0 0 24 24', 'aria-hidden': 'true' as const, focusable: 'false' as const };

export function RerollIcon(): JSX.Element {
  return (
    <svg class="ms-rw-ico" {...svgProps}>
      <path d="M12 4.2a7.8 7.8 0 1 1-7.4 5.4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
      <path d="M2.6 4.6l2.2 6.2 5.6-3z" fill="currentColor" />
      <circle cx="12" cy="12" r="2.1" fill="currentColor" />
    </svg>
  );
}

export function BanishIcon(): JSX.Element {
  return (
    <svg class="ms-rw-ico" {...svgProps}>
      <path d="M12 2.4l8.4 5v9.2l-8.4 5-8.4-5V7.4z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" />
      <path d="M8.2 8.2l7.6 7.6M15.8 8.2l-7.6 7.6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
    </svg>
  );
}

export function LeaveIcon(): JSX.Element {
  return (
    <svg class="ms-rw-ico" {...svgProps}>
      <path d="M5 4.5h8v3M5 4.5v15h8v-3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" />
      <path d="M10.5 12h9.2M16.4 8.4l3.6 3.6-3.6 3.6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// head + actions

export interface RewardHeadProps {
  /** small rust-copper plate above the title (chest name, metin name, boss epithet) */
  eyebrow: ComponentChildren;
  eyebrowIcon?: ComponentChildren;
  title: string;
  /** subtitle line (may carry a <b>) */
  sub?: ComponentChildren;
  /** anything between the subtitle and the cards (cost plate, awakened badge) */
  extra?: ComponentChildren;
  class?: string;
  titleClass?: string;
  /** replays the title light sweep when it changes */
  sweepKey?: string | number;
  /** replaces the eyebrow plate (boss banner) */
  banner?: ComponentChildren;
}

/** Eyebrow plate, title with the C9 light sweep and the subtitle, all on a soft scrim so rays never swallow the text. */
export function RewardHead({ eyebrow, eyebrowIcon, title, sub, extra, class: cls = '', titleClass = '', sweepKey, banner }: RewardHeadProps): JSX.Element {
  const sp = shineProps(title, { delay: 0.45 });
  return (
    <div class={`ms-cm-head ms-rw-head ${cls}`}>
      {banner ?? (
        <span class="ms-rw-eyebrow ms-plate">
          {eyebrowIcon !== undefined && <span class="ms-rw-eyebrow-ico">{eyebrowIcon}</span>}
          <span class="ms-rw-eyebrow-text">{eyebrow}</span>
        </span>
      )}
      <h2 key={sweepKey} class={`ms-cm-title ms-rw-title ${sp.class} ${titleClass}`} data-text={sp['data-text']} style={sp.style}>
        {title}
      </h2>
      {sub !== undefined && <p class="ms-cm-sub ms-rw-sub">{sub}</p>}
      {extra}
    </div>
  );
}

/** A small engraved well with a number (remaining Reroll / Banish / Leave charges). */
export function CountWell({ n }: { n: number }): JSX.Element {
  return <b class="ms-rw-cnt ms-plate ms-num">{fmtInt(n)}</b>;
}

export interface RewardActionsProps {
  st: CardModalState;
  request: ModalRequest;
  /** override the third button's label (essence says "Leave it", the others "Skip") */
  skipLabel?: string;
  class?: string;
  /** why a charge the player holds cannot be used on this offer (tooltip of a sealed plate + a line under the shelf) */
  sealedNote?: string;
  /** something that stands over the shelf in the phone-landscape column (the chest's cost plate) */
  above?: ComponentChildren;
}

interface ActionDef {
  key: 'reroll' | 'banish' | 'skip';
  label: string;
  icon: JSX.Element;
  hotkey: string;
  n: number;
  can: boolean;
  onClick: () => void;
  active?: boolean;
  hint?: string;
}

/**
 * Phone portrait: the modal scrolls when its cards do not fit above the pinned button bar (the essence's socket tray alone is 190 px, so
 * its third card sat under the bar with nothing to say so). True while more than a hair of the modal lies below the view; the same
 * measuring as the level-up's chevron (LevelUp.tsx useMoreBelow): once the dealt cards have landed (their fly-in transform counts as
 * scrollable overflow), on scroll, on resize and when the fonts arrive.
 */
function useMoreBelow(bar: { current: HTMLElement | null }, deps: unknown[]): boolean {
  const [more, setMore] = useState(false);
  useLayoutEffect(() => {
    const el = bar.current?.closest<HTMLElement>('.ms-cardmodal');
    if (!el) return undefined;
    const upd = (): void => {
      if (!el.closest('.ms-portrait')) return setMore(false);
      if (el.scrollHeight - el.scrollTop - el.clientHeight <= 14) return setMore(false);
      // a card that already shows its header above the button shelf is cue enough (the chevron plate would sit on its rarity word): the tab
      // only appears while a card lies under the shelf with less than its header showing (about 32 px), or more than the cards lies below
      const shelfTop = (bar.current?.querySelector('.ms-rw-shelf') ?? bar.current)?.getBoundingClientRect().top ?? 0;
      const under = Array.from(el.querySelectorAll<HTMLElement>('.ms-card')).filter((c) => c.getBoundingClientRect().bottom > shelfTop + 2);
      setMore(under.length === 0 || under.some((c) => c.getBoundingClientRect().top > shelfTop - 32));
    };
    const timer = window.setTimeout(upd, 1100);
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
  return more;
}

/**
 * The button shelf of every reward board: Reroll / Banish / Skip as three stone plates, each with its icon, an engraved count
 * well and its key. A plate the player holds charges for but this offer never grants (the sim hands a chest or a boss reward no
 * reroll / banish / skip, an essence no banish) stays on the shelf, sealed: dim stone, the lock in place of the key, and the
 * reason as its tooltip, so the choices and their counts read the same on every reward board.
 */
export function RewardActions({ st, request, skipLabel, class: cls = '', sealedNote, above }: RewardActionsProps): JSX.Element {
  const defs: ActionDef[] = [
    { key: 'reroll', label: t('levelup.reroll'), icon: <RerollIcon />, hotkey: 'R', n: request.rerolls, can: request.canReroll && request.rerolls > 0, onClick: st.reroll },
    { key: 'banish', label: t('levelup.banish'), icon: <BanishIcon />, hotkey: 'B', n: request.banishes, can: request.canBanish && request.banishes > 0, onClick: st.banishArm, active: st.banishMode },
    { key: 'skip', label: skipLabel ?? t('levelup.skip'), icon: <LeaveIcon />, hotkey: 'X', n: request.skips, can: request.canSkip && request.skips > 0, onClick: st.skip, hint: t('levelup.skipHint') },
  ];
  const anySealed = defs.some((d) => !d.can && d.n > 0);
  // phone landscape: the shelf is an upright column on the right, so the reason a plate is sealed stands under it, inside the column (a touch screen
  // shows no tooltip); everywhere else the line follows the bar
  const noteInColumn = layout.value.tier === 'phone-l';
  // phone portrait: the note stands in the pinned bar above the shelf (as the last line of the scrolling modal it lay under the bar, or in the
  // home-indicator band under the boss / chest cards)
  const noteInBar = layout.value.tier === 'phone-p';
  const note = anySealed && sealedNote ? <p class={`ms-rw-note ${noteInColumn ? 'ms-rw-note--col' : noteInBar ? 'ms-rw-note--bar' : ''}`}>{sealedNote}</p> : null;
  const bar = useRef<HTMLDivElement>(null);
  const more = useMoreBelow(bar, [st.dealKey, request.cards]);
  return (
    <>
      <div class={`ms-cm-bottom ms-rw-bottom ${cls}`} ref={bar}>
        {above}
        {noteInBar && note}
        <div class="ms-rw-shelf ms-plate">
          {more && (
            // docked at the left end of the shelf (a tab floating over the bar sat on the text of the card under it)
            <button
              type="button"
              class="ms-lu-more ms-rw-more"
              data-nav=""
              aria-label={t('levelup.moreCards')}
              onClick={() => {
                const el = bar.current?.closest<HTMLElement>('.ms-cardmodal');
                el?.scrollBy({ top: Math.round(el.clientHeight * 0.6), behavior: 'smooth' });
              }}
            >
              <svg viewBox="0 0 24 14" aria-hidden="true">
                <path d="M2 2.5 12 11.5 22 2.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
          )}
          <div class="ms-cm-actions ms-rw-actions">
            {defs.map((d) => {
              const sealed = !d.can && d.n > 0;
              return (
                <span key={d.key} class={`ms-rw-slot ${sealed ? 'is-sealed' : ''}`} title={sealed ? sealedNote : undefined}>
                  <Button kit variant="wood" active={d.active} onClick={d.onClick} disabled={!d.can} sound="none" title={d.can ? d.hint : undefined} class={`ms-rw-btn ms-rw-btn--${d.key}`}>
                    {d.icon}
                    <span class="ms-rw-lbl">{d.label}</span>
                    <CountWell n={d.n} />
                    {sealed ? <UiGlyph name="lock" tone="pewter" flat size="1rem" class="ms-rw-lock" /> : <KeyHint k={d.hotkey} kit />}
                  </Button>
                </span>
              );
            })}
          </div>
        </div>
        {noteInColumn && note}
      </div>
      {!noteInColumn && !noteInBar && note}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// coin / gem spray

function drawCoin(g: CanvasRenderingContext2D, x: number, y: number, r: number, tilt: number, alpha: number): void {
  const sx = Math.max(0.12, Math.abs(Math.cos(tilt)));
  g.save();
  g.globalAlpha = alpha;
  g.translate(x, y);
  g.rotate(-0.35);
  g.scale(sx, 1);
  const rim = g.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r);
  rim.addColorStop(0, '#fff2b8');
  rim.addColorStop(0.55, '#e8b33c');
  rim.addColorStop(1, '#8a5a12');
  g.fillStyle = rim;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = Math.max(1, r * 0.14);
  g.strokeStyle = '#5b3a0b';
  g.stroke();
  g.fillStyle = '#4a2f08';
  const h = r * 0.34;
  g.fillRect(-h, -h, h * 2, h * 2);
  g.restore();
}

function drawGem(g: CanvasRenderingContext2D, x: number, y: number, r: number, tilt: number, hue: string, alpha: number): void {
  const sx = Math.max(0.3, Math.abs(Math.cos(tilt * 0.6)));
  g.save();
  g.globalAlpha = alpha;
  g.translate(x, y);
  g.rotate(Math.sin(tilt) * 0.5);
  g.scale(sx, 1);
  g.shadowColor = hue;
  g.shadowBlur = r * 1.6;
  g.fillStyle = hue;
  g.beginPath();
  g.moveTo(0, -r * 1.15);
  g.lineTo(r * 0.9, -r * 0.1);
  g.lineTo(0, r * 1.15);
  g.lineTo(-r * 0.9, -r * 0.1);
  g.closePath();
  g.fill();
  g.shadowBlur = 0;
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.beginPath();
  g.moveTo(0, -r * 1.15);
  g.lineTo(r * 0.9, -r * 0.1);
  g.lineTo(0, -r * 0.1);
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(0,0,0,0.28)';
  g.beginPath();
  g.moveTo(0, -r * 0.1);
  g.lineTo(r * 0.9, -r * 0.1);
  g.lineTo(0, r * 1.15);
  g.closePath();
  g.fill();
  g.restore();
}

export interface CoinSprayProps {
  /** change it to fire again */
  play?: number | string;
  seed?: number;
  count?: number;
  /** origin as fractions of the host box */
  x?: number;
  y?: number;
  /** seconds before it fires */
  delay?: number;
  /** freeze at time t (QA) */
  t?: number;
  class?: string;
}

/** One-shot spray of tumbling coins and cut gems (canvas, <= 80 particles, stops drawing when done). */
export function CoinSpray({ play, seed = 11, count = 52, x = 0.5, y = 0.5, delay = 0, t: freezeAt, class: cls = '' }: CoinSprayProps): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const cv = ref.current;
    if (!cv) return undefined;
    const g = cv.getContext('2d');
    if (!g) return undefined;
    const parts = sprayParticles(seed, Math.min(80, count));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const fit = (): void => {
      const w = Math.max(2, Math.round(cv.clientWidth * dpr));
      const h = Math.max(2, Math.round(cv.clientHeight * dpr));
      if (cv.width !== w || cv.height !== h) {
        cv.width = w;
        cv.height = h;
      }
    };
    const paint = (time: number): boolean => {
      fit();
      g.clearRect(0, 0, cv.width, cv.height);
      const H = cv.height;
      const ox = cv.width * x;
      const oy = H * y;
      let live = false;
      for (const p of parts) {
        const s = sprayAt(p, time);
        if (!s) {
          if (time - p.delay < p.life) live = true;
          continue;
        }
        live = true;
        const px = ox + s.x * H;
        const py = oy + s.y * H;
        if (py > H * 1.05) continue;
        const tilt = p.ph + p.w * (time - p.delay);
        if (p.kind === 'coin') drawCoin(g, px, py, p.r * H, tilt, s.alpha);
        else drawGem(g, px, py, p.r * H, tilt, GEM_HUES[p.hue] ?? '#f0b73e', s.alpha);
      }
      return live;
    };
    if (freezeAt !== undefined) {
      paint(freezeAt);
      return undefined;
    }
    if (prefersReducedMotion()) {
      g.clearRect(0, 0, cv.width, cv.height);
      return undefined;
    }
    let raf = 0;
    const t0 = performance.now() + delay * 1000;
    const tick = (now: number): void => {
      const time = (now - t0) / 1000;
      if (time < 0) {
        raf = requestAnimationFrame(tick);
        return;
      }
      if (paint(time)) raf = requestAnimationFrame(tick);
      else g.clearRect(0, 0, cv.width, cv.height);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [play, seed, count, x, y, delay, freezeAt]);
  return <canvas ref={ref} class={`ms-rw-spray ${cls}`} aria-hidden="true" />;
}
