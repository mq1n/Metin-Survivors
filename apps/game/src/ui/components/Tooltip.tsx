// Tooltips: one global dark stone tooltip (kit v1, C6) positioned next to the pointer / focused element. Components attach it with
// `tipProps(content)` (spread onto any element). Touch: long-press shows it, releasing hides it shortly after.
import { signal } from '@preact/signals';
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import type { Rarity } from '../../data/schema';
import { t } from '../../i18n/i18n';

export type TipContent = ComponentChildren | (() => ComponentChildren);

interface TipState {
  x: number;
  y: number;
  /** element rect when opened by focus/long-press */
  anchor: DOMRect | null;
  content: TipContent;
  rarity?: Rarity;
  parchment?: boolean;
}

const tip = signal<TipState | null>(null);

export function hideTip(): void {
  clearTimeout(hideTimer);
  hideTimer = undefined;
  if (tip.peek() !== null) tip.value = null;
}

export interface TipHandlers {
  onPointerEnter: (e: PointerEvent) => void;
  onPointerMove: (e: PointerEvent) => void;
  onPointerLeave: () => void;
  onPointerDown: (e: PointerEvent) => void;
  onPointerUp: (e?: PointerEvent) => void;
  onPointerCancel: () => void;
  onFocus: (e: FocusEvent) => void;
  onBlur: () => void;
}

let longPress: ReturnType<typeof setTimeout> | undefined;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
/** the element whose tip is open: when a screen change removes it no pointerleave/blur ever fires, so the host hides the tip itself */
let tipSrc: Element | null = null;

/** Spread onto the hover target. `content` may be a function so heavy tooltips are only built when shown. */
export function tipProps(content: TipContent, opts: { rarity?: Rarity; /** story / lore text on a parchment slip (default: dark stone) */ parchment?: boolean } = {}): TipHandlers {
  const open = (x: number, y: number, anchor: DOMRect | null, src: Element | null = null): void => {
    clearTimeout(hideTimer);
    hideTimer = undefined;
    tipSrc = src;
    tip.value = { x, y, anchor, content, ...(opts.rarity ? { rarity: opts.rarity } : {}), ...(opts.parchment ? { parchment: true } : {}) };
  };
  return {
    onPointerEnter: (e) => {
      if (e.pointerType === 'mouse') open(e.clientX, e.clientY, null, e.currentTarget as Element);
    },
    // Moving only repositions the open tip. pointermove bubbles, so re-opening here with this element's content let a
    // wrapper with its own tip replace the hovered inner icon's tip (C1); pointerenter is what picks the content.
    onPointerMove: (e) => {
      if (e.pointerType !== 'mouse') return;
      const cur = tip.peek();
      if (cur && !cur.anchor && (cur.x !== e.clientX || cur.y !== e.clientY)) tip.value = { ...cur, x: e.clientX, y: e.clientY };
    },
    onPointerLeave: () => hideTip(),
    onPointerDown: (e) => {
      if (e.pointerType === 'mouse') return;
      const el = e.currentTarget as HTMLElement;
      clearTimeout(longPress);
      clearTimeout(hideTimer);
      hideTimer = undefined;
      longPress = setTimeout(() => {
        const r = el.getBoundingClientRect();
        open(r.left + r.width / 2, r.top, r, el);
      }, 380);
    },
    onPointerUp: (e) => {
      if (e?.pointerType === 'mouse') return;
      clearTimeout(longPress);
      if (tip.peek()) {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(hideTip, 1800);
      }
    },
    onPointerCancel: () => {
      clearTimeout(longPress);
      hideTip();
    },
    onFocus: (e) => {
      const el = e.currentTarget as HTMLElement;
      if (!el.matches(':focus-visible') && !el.closest('.ms-kbd')) return;
      const r = el.getBoundingClientRect();
      open(r.left + r.width / 2, r.top, r, el);
    },
    onBlur: () => hideTip(),
  };
}

export function TooltipHost(): JSX.Element | null {
  const s = tip.value;
  const ref = useRef<HTMLDivElement>(null);
  const open = s !== null;
  // a tip whose source element left the DOM (screen / modal change under a still pointer) would never get its pointerleave
  useEffect(() => {
    if (!open) return undefined;
    const sweep = (): void => {
      if (tipSrc && !tipSrc.isConnected) hideTip();
    };
    window.addEventListener('pointermove', sweep, true);
    window.addEventListener('pointerdown', sweep, true);
    window.addEventListener('keydown', sweep, true);
    return () => {
      window.removeEventListener('pointermove', sweep, true);
      window.removeEventListener('pointerdown', sweep, true);
      window.removeEventListener('keydown', sweep, true);
    };
  }, [open]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !s) return;
    const pad = 12;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x: number;
    let y: number;
    if (s.anchor) {
      x = s.anchor.left + s.anchor.width / 2 - w / 2;
      y = s.anchor.top - h - 10;
      if (y < pad) y = s.anchor.bottom + 10;
    } else {
      x = s.x + 18;
      y = s.y + 18;
      if (x + w > vw - pad) x = s.x - w - 14;
      if (y + h > vh - pad) y = s.y - h - 14;
    }
    x = Math.min(Math.max(pad, x), Math.max(pad, vw - w - pad));
    y = Math.min(Math.max(pad, y), Math.max(pad, vh - h - pad));
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  });
  if (!s) return null;
  const body = typeof s.content === 'function' ? (s.content as () => ComponentChildren)() : s.content;
  return (
    <div ref={ref} class={`ms-tip ${s.parchment ? 'ms-tip--parchment' : ''} ${s.rarity ? `ms-tip-r ms-r-${s.rarity}` : ''}`} role="tooltip">
      {body}
    </div>
  );
}

export interface TipBodyProps {
  title: ComponentChildren;
  sub?: ComponentChildren;
  body?: ComponentChildren;
  /** stat lines: value green by default, red with `bad`, pale yellow with tone 'info' (neutral numbers: damage, cooldown) */
  rows?: { label: ComponentChildren; value: ComponentChildren; bad?: boolean; tone?: 'good' | 'bad' | 'info' }[];
  lore?: ComponentChildren;
  foot?: ComponentChildren;
}

/** Standard tooltip layout: title, sub-title, description, stat rows, lore. */
export function TipBody({ title, sub, body, rows, lore, foot }: TipBodyProps): JSX.Element {
  return (
    <>
      <div class="ms-tip-title">{title}</div>
      {sub !== undefined && <div class="ms-tip-sub">{sub}</div>}
      {body !== undefined && <div class="ms-tip-body">{body}</div>}
      {rows && rows.length > 0 && (
        <div class="ms-tip-rows">
          {rows.map((r, i) => (
            <div class="ms-tip-row" key={i}>
              <span>{r.label}</span>
              <b class={r.bad || r.tone === 'bad' ? 'is-bad' : r.tone === 'info' ? 'is-info' : ''}>{r.value}</b>
            </div>
          ))}
        </div>
      )}
      {lore !== undefined && <div class="ms-tip-lore">{lore}</div>}
      {foot !== undefined && <div class="ms-tip-sub" style={{ marginTop: '0.5rem' }}>{foot}</div>}
    </>
  );
}

/** Convenience for plain-text hints: `<span {...hint('key')}>`. */
export function hint(key: string): TipHandlers {
  return tipProps(() => <div>{t(key)}</div>);
}
