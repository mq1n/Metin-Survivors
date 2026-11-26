// Regression tests for UI-06: ScrollFade class updates are strictly mutation-idempotent (no idle rAF/mutation loop),
// external scroll/class changes settle cleanly, and unmount cancels scheduled work including late document.fonts.ready.
import { h, render } from 'preact';
import { useRef } from 'preact/hooks';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installTestDom, TestEvent, TestResizeObserver, type TestDomEnv, type TestElement } from '../testDom';
import { useScrollFade, type ScrollFadeState } from './ScrollFade';

describe('UI-06: ScrollFade mutation idempotence and unmount disposal', () => {
  let dom: TestDomEnv;

  beforeEach(() => {
    dom = installTestDom();
  });

  afterEach(() => {
    render(null, dom.body as unknown as Element);
    dom.restore();
  });

  it('idle scroller settles with zero further rAFs or class mutations under WHATWG DOMTokenList.add() semantics', async () => {
    let scroller: TestElement | null = null;
    const states: ScrollFadeState[] = [];

    function Demo() {
      const ref = useRef<HTMLDivElement>(null);
      useScrollFade(ref, { onChange: (s) => states.push(s) });
      return h('div', {
        ref: (el: HTMLDivElement | null) => {
          ref.current = el;
          scroller = el as unknown as TestElement | null;
          if (scroller) {
            scroller.clientHeight = 120;
            scroller.scrollHeight = 400;
            scroller.scrollTop = 0;
          }
        },
        class: 'ms-scroll',
      });
    }

    const host = dom.document.createElement('div');
    dom.body.appendChild(host);
    render(h(Demo, null), host as unknown as Element);
    await dom.flushMicrotasks();

    expect(scroller).not.toBeNull();
    const el = scroller!;
    expect(el.classList.contains('ms-scrollfade')).toBe(true);
    expect(el.classList.contains('is-scrollable')).toBe(true);
    expect(el.classList.contains('is-start')).toBe(true);
    expect(el.classList.contains('is-end')).toBe(false);

    // Simulate initial ResizeObserver + fonts.ready triggers (the exact triggers that started the old infinite loop!)
    for (const ro of TestResizeObserver.instances) ro.trigger();
    dom.document.resolveFontsReady();
    await dom.flushMicrotasks();

    const mutationsBeforeIdle = el.classMutationCount;
    // Run the one bounded scheduled frame
    const initialRan = dom.flushRaf(10);
    expect(initialRan).toBeLessThanOrEqual(2);
    await dom.flushMicrotasks();

    // Advance 20 idle frames: ZERO new rAFs scheduled, ZERO class attribute mutations!
    dom.resetRafCount();
    for (let i = 0; i < 20; i++) {
      expect(dom.pendingRafCount()).toBe(0);
      dom.flushRaf(1);
      await dom.flushMicrotasks();
    }
    expect(dom.rafScheduledCount()).toBe(0);
    expect(el.classMutationCount).toBe(mutationsBeforeIdle);

    // External scroll changes state once and settles immediately without re-looping
    el.scrollTop = 100;
    el.dispatchEvent(new TestEvent('scroll'));
    expect(dom.flushRaf(10)).toBe(1);
    await dom.flushMicrotasks();
    expect(el.classList.contains('is-start')).toBe(false);
    expect(el.classList.contains('is-end')).toBe(false);
    expect(dom.pendingRafCount()).toBe(0);

    // Owner re-render wiping className restores scrollfade classes in 1 bounded rAF and settles back to idle
    el.className = 'ms-scroll';
    await dom.flushMicrotasks();
    expect(dom.flushRaf(10)).toBe(1);
    await dom.flushMicrotasks();
    expect(el.classList.contains('ms-scrollfade')).toBe(true);
    expect(el.classList.contains('is-scrollable')).toBe(true);
    expect(dom.pendingRafCount()).toBe(0);
  });

  it('unmounting cancels pending rAF and guards late document.fonts.ready against scheduling any callback', async () => {
    let scroller: TestElement | null = null;
    const states: ScrollFadeState[] = [];

    function Demo() {
      const ref = useRef<HTMLDivElement>(null);
      useScrollFade(ref, { onChange: (s) => states.push(s) });
      return h('div', {
        ref: (el: HTMLDivElement | null) => {
          ref.current = el;
          if (el) {
            scroller = el as unknown as TestElement;
            scroller.clientHeight = 100;
            scroller.scrollHeight = 300;
          }
        },
        class: 'ms-scroll',
      });
    }

    const host = dom.document.createElement('div');
    dom.body.appendChild(host);
    render(h(Demo, null), host as unknown as Element);
    await dom.flushMicrotasks();

    // Queue a scroll rAF, then unmount before it runs and before document.fonts.ready resolves
    scroller!.dispatchEvent(new TestEvent('scroll'));
    expect(dom.pendingRafCount()).toBe(1);

    const stateCountBeforeUnmount = states.length;
    render(null, host as unknown as Element);
    expect(dom.pendingRafCount()).toBe(0);

    // Now resolve document.fonts.ready AFTER unmount -> must schedule 0 rAFs and fire 0 callbacks!
    dom.resetRafCount();
    dom.document.resolveFontsReady();
    await dom.flushMicrotasks();
    expect(dom.pendingRafCount()).toBe(0);
    expect(dom.rafScheduledCount()).toBe(0);
    expect(states.length).toBe(stateCountBeforeUnmount);
  });
});
