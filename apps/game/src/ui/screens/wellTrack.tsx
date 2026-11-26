// WellTrack (B8 pause-settings, R2): the scroll affordance of the stone wells. A carved track (arrow caps + a pewter thumb that
// follows the scroll position) laid over the right edge of the well, outside the faded scroller, so "there is more below" reads

// It hides itself while the content fits. Pure view of the scroller's state (no layout of its own).
import type { JSX, RefObject } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { pageScroll } from '../components/ScrollFade';

export function WellTrack({ view, class: cls }: { view: RefObject<HTMLElement>; class?: string }): JSX.Element {
  const track = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = view.current;
    const tr = track.current;
    if (!el || !tr) return undefined;
    let raf = 0;
    const apply = (): void => {
      raf = 0;
      const total = el.scrollHeight;
      const vis = el.clientHeight;
      const range = total - vis;
      const on = range > 1;
      tr.classList.toggle('is-on', on);
      if (!on) return;
      const h = Math.min(1, Math.max(0.1, vis / total));
      const top = Math.min(1, Math.max(0, el.scrollTop / range)) * (1 - h);
      tr.style.setProperty('--th', `${(h * 100).toFixed(2)}%`);
      tr.style.setProperty('--tt', `${(top * 100).toFixed(2)}%`);
      tr.classList.toggle('is-start', el.scrollTop <= 1);
      tr.classList.toggle('is-end', el.scrollTop + vis >= total - 1);
    };
    const schedule = (): void => {
      if (!raf) raf = requestAnimationFrame(apply);
    };
    apply();
    el.addEventListener('scroll', schedule, { passive: true });
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    const watch = (): void => {
      if (!ro) return;
      ro.disconnect();
      ro.observe(el);
      for (const c of Array.from(el.children)) ro.observe(c);
    };
    watch();
    const mo =
      typeof MutationObserver === 'function'
        ? new MutationObserver(() => {
            watch();
            schedule();
          })
        : null;
    mo?.observe(el, { childList: true });
    void document.fonts?.ready.then(schedule);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('scroll', schedule);
      ro?.disconnect();
      mo?.disconnect();
    };
  }, [view]);
  return (
    <div class={`ms-wtrack ${cls ?? ''}`} ref={track} aria-hidden="true">
      <i class="ms-wtrack-cap is-up" onClick={() => view.current && pageScroll(view.current, 'y', 'start')} />
      <div class="ms-wtrack-groove">
        <i class="ms-wtrack-thumb" />
      </div>
      <i class="ms-wtrack-cap is-down" onClick={() => view.current && pageScroll(view.current, 'y', 'end')} />
    </div>
  );
}
