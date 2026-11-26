// OlScroll (owner: B13 online): the scroll area of the online windows. A core ScrollFade (edge fade where more content lies


// Mouse: drag the thumb, click the channel to page, click or hold a cap to step, wheel over the bar. Touch: the bar is a
// picture (a finger scrolls the list itself, like the core cue). `always` keeps the bar (dimmed) when nothing scrolls so a
// list window keeps its frame; otherwise the bar only takes room while the content overflows.

import type { ComponentChildren, JSX, RefObject } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { ScrollFade } from '../components/ScrollFade';

export interface OlScrollProps {
  children?: ComponentChildren;
  /** layout slot of the whole assembly (list + bar): flex / grid child with a bounded height */
  class?: string;
  /** the scroller itself (inside the ScrollFade) */
  viewClass?: string;
  /** reach the scroller (scrollTop, focus ...) */
  viewRef?: RefObject<HTMLDivElement>;
  /** keep the bar (dimmed, full-length thumb) when the content fits */
  always?: boolean;
  /** fade length, any CSS length (core default 2.2rem) */
  size?: string;
  role?: JSX.HTMLAttributes<HTMLDivElement>['role'];
  'aria-label'?: string;
}

/** Triangle of a cap, drawn bronze with a dark rim; `up` points at the start of the list. */
function Tri({ up }: { up: boolean }): JSX.Element {
  return (
    <svg class="ms-ol-tri" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d={up ? 'M8 3.6 13.4 11.4H2.6z' : 'M8 12.4 2.6 4.6h10.8z'} fill="#c8953f" stroke="#150d05" stroke-width="1.2" stroke-linejoin="round" />
      <path d={up ? 'M8 5.6 11.2 10.2H4.8z' : 'M8 10.4 4.8 5.8h6.4z'} fill="#f1d58e" opacity=".55" />
    </svg>
  );
}

const MIN_THUMB = 26;

/** Thumb size / offset (px) inside a channel of `track` px for a scroller showing `view` of `total` px at `scrollTop`. */
export function thumbGeometry(total: number, view: number, scrollTop: number, track: number): { scrollable: boolean; size: number; top: number } {
  const room = total - view;
  if (!(room > 1)) return { scrollable: false, size: Math.max(0, track), top: 0 };
  // the bar is display:none while nothing scrolls (track 0): the verdict must not depend on the channel being laid out
  if (track <= 0) return { scrollable: true, size: 0, top: 0 };
  const size = Math.min(track, Math.max(MIN_THUMB, (track * view) / total));
  const top = (Math.min(Math.max(scrollTop, 0), room) / room) * Math.max(0, track - size);
  return { scrollable: true, size, top };
}

export function OlScroll(p: OlScrollProps): JSX.Element {
  const own = useRef<HTMLDivElement>(null);
  const view = p.viewRef ?? own;
  const root = useRef<HTMLDivElement>(null);
  const chan = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLDivElement>(null);
  const hold = useRef(0);
  const holdTimer = useRef(0);

  // keep the thumb in step with the scroller: size from view / total, position from scrollTop (CSS vars on the bar, no re-render)
  useEffect(() => {
    const el = view.current;
    const box = root.current;
    const ch = chan.current;
    if (!el || !box || !ch) return undefined;
    let raf = 0;
    const sync = (): void => {
      raf = 0;
      const total = el.scrollHeight;
      const vh = el.clientHeight;
      const g = thumbGeometry(total, vh, el.scrollTop, ch.clientHeight);
      const scrollable = g.scrollable;
      box.style.setProperty('--ol-th', `${g.size.toFixed(1)}px`);
      box.style.setProperty('--ol-tt', `${g.top.toFixed(1)}px`);
      box.dataset.rail = scrollable || p.always ? 'on' : 'off';
      box.dataset.scrollable = scrollable ? '1' : '0';
      box.dataset.start = !scrollable || el.scrollTop <= 1 ? '1' : '0';
      box.dataset.end = !scrollable || el.scrollTop + vh >= total - 1 ? '1' : '0';
    };
    const schedule = (): void => {
      if (!raf) raf = requestAnimationFrame(sync);
    };
    sync();
    el.addEventListener('scroll', schedule, { passive: true });
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    const watch = (): void => {
      if (!ro) return;
      ro.disconnect();
      ro.observe(el);
      ro.observe(ch);
      for (const c of Array.from(el.children)) ro.observe(c);
    };
    watch();
    const mo =
      typeof MutationObserver === 'function'
        ? new MutationObserver((records) => {
            if (records.some((r) => r.type === 'childList')) watch();
            schedule();
          })
        : null;
    mo?.observe(el, { childList: true });
    void document.fonts?.ready.then(schedule);
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      ro?.disconnect();
      mo?.disconnect();
    };
  }, [view, p.always]);

  useEffect(
    () => () => {
      clearInterval(hold.current);
      clearTimeout(holdTimer.current);
    },
    [],
  );

  const stopHold = (): void => {
    clearInterval(hold.current);
    clearTimeout(holdTimer.current);
    hold.current = 0;
  };
  /** One step of a cap: about two thirds of a row block; held, it repeats. */
  const step = (dir: 1 | -1): void => {
    const el = view.current;
    if (!el) return;
    const by = Math.max(40, el.clientHeight * 0.22) * dir;
    el.scrollBy({ top: by, behavior: 'auto' });
  };
  const capDown =
    (dir: 1 | -1) =>
    (e: PointerEvent): void => {
      if (e.button !== 0) return;
      e.preventDefault();
      step(dir);
      stopHold();
      holdTimer.current = window.setTimeout(() => {
        hold.current = window.setInterval(() => step(dir), 70);
      }, 360);
      const up = (): void => {
        stopHold();
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
      };
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    };

  const drag = useRef<{
    y: number;
    top: number;
    room: number;
    track: number;
    th: number;
  } | null>(null);
  const onThumbDown = (e: PointerEvent): void => {
    const el = view.current;
    const ch = chan.current;
    const th = thumb.current;
    if (!el || !ch || !th || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    th.setPointerCapture(e.pointerId);
    drag.current = {
      y: e.clientY,
      top: el.scrollTop,
      room: el.scrollHeight - el.clientHeight,
      track: ch.clientHeight,
      th: th.offsetHeight,
    };
    root.current?.classList.add('is-drag');
  };
  const onThumbMove = (e: PointerEvent): void => {
    const d = drag.current;
    const el = view.current;
    if (!d || !el) return;
    const span = Math.max(1, d.track - d.th);
    el.scrollTop = d.top + ((e.clientY - d.y) / span) * d.room;
  };
  const onThumbUp = (e: PointerEvent): void => {
    drag.current = null;
    root.current?.classList.remove('is-drag');
    try {
      thumb.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  };
  const onChannelDown = (e: PointerEvent): void => {
    const el = view.current;
    const th = thumb.current;
    if (!el || !th || e.button !== 0 || e.target === th || th.contains(e.target as Node)) return;
    e.preventDefault();
    const r = th.getBoundingClientRect();
    const dir = e.clientY < r.top ? -1 : 1;
    el.scrollBy({ top: el.clientHeight * 0.85 * dir, behavior: 'smooth' });
  };

  return (
    <div ref={root} class={`ms-ol-sc ${p.class ?? ''}`} data-rail={p.always ? 'on' : 'off'} data-scrollable="0" data-start="1" data-end="1">
      <ScrollFade class="ms-ol-sc-view" cue={false} viewClass={p.viewClass} viewRef={view} size={p.size} role={p.role} aria-label={p['aria-label']}>
        {p.children}
      </ScrollFade>
      <div
        class="ms-ol-rail"
        aria-hidden="true"
        onWheel={(e) => {
          const el = view.current;
          if (!el) return;
          e.preventDefault();
          el.scrollTop += e.deltaY;
        }}
      >
        <button type="button" tabIndex={-1} class="ms-ol-cap ms-ol-cap--up ms-plate" onPointerDown={capDown(-1)}>
          <Tri up />
        </button>
        <div ref={chan} class="ms-ol-rail-ch" onPointerDown={onChannelDown}>
          <div ref={thumb} class="ms-ol-thumb ms-plate" onPointerDown={onThumbDown} onPointerMove={onThumbMove} onPointerUp={onThumbUp} onPointerCancel={onThumbUp}>
            <svg class="ms-ol-grip" viewBox="0 0 12 10" aria-hidden="true" focusable="false">
              <path d="M1.5 2h9M1.5 5h9M1.5 8h9" stroke="#14110d" stroke-width="1.2" stroke-linecap="round" />
              <path d="M1.5 3h9M1.5 6h9M1.5 9h9" stroke="#cdbf9f" stroke-opacity=".55" stroke-width=".8" stroke-linecap="round" />
            </svg>
          </div>
        </div>
        <button type="button" tabIndex={-1} class="ms-ol-cap ms-ol-cap--down ms-plate" onPointerDown={capDown(1)}>
          <Tri up={false} />
        </button>
      </div>
    </div>
  );
}
