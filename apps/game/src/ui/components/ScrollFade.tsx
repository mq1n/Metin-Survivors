// ScrollFade (C8 phone-tier foundation, UI core): a scroll container whose edges fade out only while more content lies

// scroll buttons, drawn with our own geometry) that pages the content on tap / click. Two ways in:
//
//   <ScrollFade class="my-wrap" viewClass="my-list">{rows}</ScrollFade>     wrapper (layout slot + cues) > scroller
//   const ref = useRef<HTMLDivElement>(null); useScrollFade(ref);           classes only, on your own scroll element
//   <div ref={ref} class="my-list ms-scroll">…</div>
//
// The scroller gets `ms-scrollfade` (+ `ms-scrollfade--x`) and the live state classes `is-scrollable` / `is-start` /
// `is-end` (measured from scrollHeight > clientHeight and the scroll position; re-measured on scroll, resize, content and
// font changes). style/base.css (C8 block) masks an edge only while `is-scrollable` and not at that edge, so a list that
// fits shows no fade and no cue. Fade length: `--sf-size` (default 2.2rem) — set it on the wrapper, the scroller or any
// ancestor, or pass `size`. Zero-JS alternative for plain lists (no cue): the class `ms-edgefade` (scroll-driven CSS).
import type { ComponentChildren, JSX, RefObject } from 'preact';
import { useEffect, useId, useRef } from 'preact/hooks';
import { useSignal, type Signal } from '@preact/signals';

export type ScrollAxis = 'y' | 'x';

export interface ScrollFadeState {
  /** content is larger than the view along the axis */
  scrollable: boolean;
  /** at the start edge (also true when not scrollable) */
  start: boolean;
  /** at the end edge (also true when not scrollable) */
  end: boolean;
}

/** Scroll state of an element along one axis (1 px tolerance for fractional layouts; RTL-safe). */
export function measureScroll(el: HTMLElement, axis: ScrollAxis = 'y'): ScrollFadeState {
  const y = axis === 'y';
  const view = y ? el.clientHeight : el.clientWidth;
  const total = y ? el.scrollHeight : el.scrollWidth;
  const pos = Math.abs(y ? el.scrollTop : el.scrollLeft);
  const scrollable = total - view > 1;
  return { scrollable, start: !scrollable || pos <= 1, end: !scrollable || pos + view >= total - 1 };
}

const STATE_CLASSES = ['is-scrollable', 'is-start', 'is-end'] as const;

export interface UseScrollFadeOptions {
  axis?: ScrollAxis;
  /** called whenever the state changes (and once on mount) */
  onChange?: (s: ScrollFadeState) => void;
}

function setClass(el: HTMLElement, token: string, on: boolean): boolean {
  if (el.classList.contains(token) === on) return false;
  if (on) el.classList.add(token);
  else el.classList.remove(token);
  return true;
}

/**
 * Turns the element in `ref` into a fading scroller: adds `ms-scrollfade` and keeps the state classes in sync. The
 * element must scroll itself (overflow auto, e.g. `ms-scroll`). Classes a re-render wipes are restored at once.
 */
export function useScrollFade(ref: RefObject<HTMLElement>, opts: UseScrollFadeOptions = {}): void {
  const axis = opts.axis ?? 'y';
  const onChange = useRef(opts.onChange);
  onChange.current = opts.onChange;
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let last: ScrollFadeState | null = null;
    let raf = 0;
    let disposed = false;
    let mo: MutationObserver | null = null;
    let watch: () => void = () => undefined;
    const apply = (): void => {
      raf = 0;
      if (disposed) return;
      const s = measureScroll(el, axis);
      // Strictly mutation-idempotent: never write to classList when the token state already matches so MutationObserver stays quiet.
      let mutated = false;
      mutated = setClass(el, 'ms-scrollfade', true) || mutated;
      mutated = setClass(el, 'ms-scrollfade--x', axis === 'x') || mutated;
      mutated = setClass(el, 'is-scrollable', s.scrollable) || mutated;
      mutated = setClass(el, 'is-start', s.start) || mutated;
      mutated = setClass(el, 'is-end', s.end) || mutated;
      if (mutated && mo && typeof mo.takeRecords === 'function') {
        const recs = mo.takeRecords();
        if (recs.some((r) => r.type === 'childList')) watch();
      }
      if (last && last.scrollable === s.scrollable && last.start === s.start && last.end === s.end) return;
      last = s;
      onChange.current?.(s);
    };
    const schedule = (): void => {
      if (!disposed && !raf) raf = requestAnimationFrame(apply);
    };
    apply();
    el.addEventListener('scroll', schedule, { passive: true });
    // size changes of the view or of any direct child (content growth, images, wrapping text)
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    watch = (): void => {
      if (!ro) return;
      ro.disconnect();
      ro.observe(el);
      for (const c of Array.from(el.children)) ro.observe(c);
    };
    watch();
    // children added / removed, or the class attribute rewritten by a re-render of the owner
    mo =
      typeof MutationObserver === 'function'
        ? new MutationObserver((records) => {
            if (disposed) return;
            if (records.some((r) => r.type === 'childList')) watch();
            schedule();
          })
        : null;
    mo?.observe(el, { childList: true, attributes: true, attributeFilter: ['class'] });
    void document.fonts?.ready.then(() => {
      if (!disposed) schedule();
    });
    return () => {
      disposed = true;
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      el.removeEventListener('scroll', schedule);
      ro?.disconnect();
      mo?.disconnect();
      setClass(el, 'ms-scrollfade', false);
      setClass(el, 'ms-scrollfade--x', false);
      for (const c of STATE_CLASSES) setClass(el, c, false);
    };
  }, [ref, axis]);
}

/** Pages the scroller by ~85 % of its view towards `edge` (smooth unless reduced motion). */
export function pageScroll(el: HTMLElement, axis: ScrollAxis, edge: 'start' | 'end'): void {
  const y = axis === 'y';
  const step = Math.max(24, (y ? el.clientHeight : el.clientWidth) * 0.85) * (edge === 'end' ? 1 : -1);
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const behavior: ScrollBehavior = reduced ? 'auto' : 'smooth';
  el.scrollBy(y ? { top: step, behavior } : { left: step, behavior });
}

const ROT: Record<ScrollAxis, Record<'start' | 'end', number>> = { y: { start: 180, end: 0 }, x: { start: 90, end: -90 } };

/** Chevron cue: a decorative pager (aria-hidden, not in the tab order: keyboard / gamepad focus scrolls by itself). */
export function ScrollCue({ view, axis, edge, state }: { view: RefObject<HTMLElement>; axis: ScrollAxis; edge: 'start' | 'end'; state: Signal<ScrollFadeState> }): JSX.Element {
  const id = useId().replace(/[^A-Za-z0-9_-]/g, '');
  const s = state.value;
  const on = s.scrollable && !(edge === 'end' ? s.end : s.start);
  return (
    <button
      type="button"
      class={`ms-sf-cue ms-sf-cue--${edge} ${on ? 'is-on' : ''}`}
      tabIndex={-1}
      aria-hidden="true"
      onClick={() => {
        if (view.current) pageScroll(view.current, axis, edge);
      }}
    >
      <svg class="ms-sf-cue-art" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={`${id}s`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#57534c" />
            <stop offset="0.45" stop-color="#3c3a35" />
            <stop offset="1" stop-color="#26241f" />
          </linearGradient>
          <linearGradient id={`${id}b`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#f7dc95" />
            <stop offset="0.5" stop-color="#c8913f" />
            <stop offset="1" stop-color="#7a4a18" />
          </linearGradient>
          <filter id={`${id}n`} x="0" y="0" width="1" height="1">
            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" result="t" />
            <feColorMatrix in="t" values="0 0 0 0 0.62  0 0 0 0 0.6  0 0 0 0 0.56  0 0 0 0.9 -0.32" />
            <feComposite in2="SourceGraphic" operator="in" />
          </filter>
        </defs>
        {/* chamfered stone plate: dark outer line, stone body + grain, two-tone pewter bevel */}
        <path d="M7 1h18l6 6v18l-6 6H7l-6-6V7z" fill={`url(#${id}s)`} stroke="#0c0b09" stroke-width="1.2" />
        <path d="M7 1h18l6 6v18l-6 6H7l-6-6V7z" fill="#fff" filter={`url(#${id}n)`} opacity="0.5" />
        <path d="M2.6 24.6V7.6L7.6 2.6h16.8" fill="none" stroke="#77716a" stroke-width="1.1" stroke-linecap="square" />
        <path d="M24.4 2.6l5 5v16.8l-5 5H7.6" fill="none" stroke="#1f1d1a" stroke-width="1.1" stroke-linecap="square" opacity="0.9" />
        <path d="M2.6 24.6l5 5" fill="none" stroke="#3a3733" stroke-width="1.1" />
        <g transform={`rotate(${ROT[axis][edge]} 16 16)`}>
          {/* bronze arrowhead: concave shoulders, one engraved ridge */}
          <g class="ms-sf-cue-arrow">
            <path d="M7.8 11.2c2.9 1.7 13.5 1.7 16.4 0L16 22.6z" fill={`url(#${id}b)`} stroke="#1b1108" stroke-width="1" stroke-linejoin="round" />
            <path d="M16 14.3v6.1" stroke="#5a3510" stroke-width="0.9" stroke-linecap="round" opacity="0.8" />
            <path d="M10.6 12.6c2.1.8 8.7.8 10.8 0" fill="none" stroke="#fff3c6" stroke-width="0.7" stroke-linecap="round" opacity="0.75" />
          </g>
        </g>
      </svg>
    </button>
  );
}

export interface ScrollFadeProps {
  children?: ComponentChildren;
  /** scroll axis (default 'y') */
  axis?: ScrollAxis;
  /** wrapper: takes the scroller's place in your layout (flex/grid child) and positions the cues */
  class?: string;
  style?: JSX.CSSProperties;
  /** the scroll container itself (it always gets `ms-scroll`) */
  viewClass?: string;
  viewStyle?: JSX.CSSProperties;
  /** pass your own ref to reach the scroller (scrollTop, focus …) */
  viewRef?: RefObject<HTMLDivElement>;
  /** chevron cues: true = end cue + start cue once scrolled away (default) · 'end' = end cue only · false = none */
  cue?: boolean | 'end';
  /** fade length, any CSS length (default 2.2rem) */
  size?: string;
  role?: JSX.HTMLAttributes<HTMLDivElement>['role'];
  'aria-label'?: string;
  /** called on every state change (and once on mount) */
  onState?: (s: ScrollFadeState) => void;
}

/** Fading scroller with chevron cues (see the header of this file). */
export function ScrollFade(p: ScrollFadeProps): JSX.Element {
  const own = useRef<HTMLDivElement>(null);
  const ref = p.viewRef ?? own;
  const axis = p.axis ?? 'y';
  const cue = p.cue ?? true;
  const state = useSignal<ScrollFadeState>({ scrollable: false, start: true, end: true });
  useScrollFade(ref, {
    axis,
    onChange: (s) => {
      state.value = s;
      p.onState?.(s);
    },
  });
  const style = p.size ? ({ ...(p.style ?? {}), '--sf-size': p.size } as JSX.CSSProperties) : p.style;
  return (
    <div class={`ms-sf ms-sf--${axis} ${p.class ?? ''}`} style={style}>
      <div ref={ref} class={`ms-scroll ${p.viewClass ?? ''}`} style={p.viewStyle} role={p.role} aria-label={p['aria-label']}>
        {p.children}
      </div>
      {cue === true && <ScrollCue view={ref} axis={axis} edge="start" state={state} />}
      {cue !== false && <ScrollCue view={ref} axis={axis} edge="end" state={state} />}
    </div>
  );
}
