// Regression tests for UI-03 (modal Tab/Shift+Tab focus trap, inert background, focus restore, Enter/Space guard)
// and UI-04 (controller gamepad D-pad/stick adjustment on Slider at min/mid/max while up/down moves focus).
import { h, render } from 'preact';
import { useState } from 'preact/hooks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UiAction } from '../engine/input';
import { Slider } from './components/Controls';
import { Modal } from './components/Modal';
import { setDeps, type UiDeps } from './env';
import { installNav, registerScope, useScope } from './nav';
import { KitConfirm, KitDialog } from './screens/kitDialog';
import { installTestDom, TestKeyboardEvent, type TestDomEnv, type TestElement } from './testDom';

function makeButton(dom: TestDomEnv, id: string, rect: { left: number; top: number; width: number; height: number }, onClick?: () => void): TestElement {
  const btn = dom.document.createElement('button');
  btn.id = id;
  btn.setAttribute('type', 'button');
  btn.setAttribute('data-nav', '');
  btn.rect = rect;
  if (onClick) btn.addEventListener('click', onClick);
  return btn;
}

describe('UI-03: modal Tab/Shift+Tab focus trap, stack-aware inert background, and focus restore', () => {
  let dom: TestDomEnv;
  let disposeNav: () => void;

  beforeEach(() => {
    dom = installTestDom();
    const root = dom.document.createElement('div');
    root.id = 'ui';
    dom.body.appendChild(root);
    disposeNav = installNav(root as unknown as HTMLElement);
  });

  afterEach(() => {
    render(null, dom.body as unknown as Element);
    disposeNav();
    setDeps(null);
    dom.restore();
  });

  it('Pause -> Abandon confirm traps Shift+Tab and Tab inside confirmation, inerts Pause panel & HUD, and blocks background Enter/Space', () => {
    const uiRoot = dom.document.getElementById('ui')!;
    const hud = dom.document.createElement('div');
    hud.className = 'ms-hud';
    const hudPauseClicks = vi.fn();
    const hudPauseBtn = makeButton(dom, 'hud-pause', { left: 300, top: 700, width: 48, height: 48 }, hudPauseClicks);
    hud.appendChild(hudPauseBtn);
    uiRoot.appendChild(hud);

    // Pre-existing inert sibling must stay inert even after all modals close
    const preInert = dom.document.createElement('div');
    preInert.inert = true;
    uiRoot.appendChild(preInert);

    // Focus opener on HUD before opening Pause
    hudPauseBtn.focus();
    expect(dom.document.activeElement).toBe(hudPauseBtn);

    // Mount Pause modal
    const pauseEl = dom.document.createElement('div');
    pauseEl.className = 'ms-modal ms-pause';
    pauseEl.setAttribute('role', 'dialog');
    pauseEl.setAttribute('aria-modal', 'true');
    const pausePanel = dom.document.createElement('div');
    pausePanel.className = 'ms-panel';
    const resumeClicks = vi.fn();
    const resumeBtn = makeButton(dom, 'pause-resume', { left: 200, top: 400, width: 120, height: 40 }, resumeClicks);
    const abandonBtn = makeButton(dom, 'pause-abandon', { left: 40, top: 400, width: 120, height: 40 });
    pausePanel.appendChild(abandonBtn);
    pausePanel.appendChild(resumeBtn);
    pauseEl.appendChild(pausePanel);
    uiRoot.appendChild(pauseEl);

    const offPause = registerScope(pauseEl as unknown as HTMLElement);
    expect(hud.inert).toBe(true);
    expect(pausePanel.inert).toBe(false);

    // User focuses Abandon inside Pause, then opens nested Abandon confirmation
    abandonBtn.focus();
    expect(dom.document.activeElement).toBe(abandonBtn);

    const confirmEl = dom.document.createElement('div');
    confirmEl.className = 'ms-modal ms-kdlg';
    confirmEl.setAttribute('role', 'dialog');
    confirmEl.setAttribute('aria-modal', 'true');
    const closeBtn = makeButton(dom, 'confirm-close', { left: 320, top: 200, width: 32, height: 32 });
    const cancelBtn = makeButton(dom, 'confirm-cancel', { left: 100, top: 320, width: 90, height: 36 });
    const confirmBtn = makeButton(dom, 'confirm-yes', { left: 220, top: 320, width: 90, height: 36 });
    confirmEl.appendChild(closeBtn);
    confirmEl.appendChild(cancelBtn);
    confirmEl.appendChild(confirmBtn);
    pauseEl.appendChild(confirmEl);

    const offConfirm = registerScope(confirmEl as unknown as HTMLElement);

    // Both Pause panel (containing Resume/Abandon) AND HUD are now inert!
    expect(pausePanel.inert).toBe(true);
    expect(hud.inert).toBe(true);
    expect(confirmEl.inert).toBe(false);

    // Start at first focusable control in Abandon confirm and press Shift+Tab -> wraps to confirmBtn, NEVER reaches Resume!
    closeBtn.focus();
    expect(dom.document.activeElement).toBe(closeBtn);

    const shiftTab1 = new TestKeyboardEvent('keydown', { key: 'Tab', shiftKey: true });
    closeBtn.dispatchEvent(shiftTab1);
    expect(shiftTab1.defaultPrevented).toBe(true);
    expect(dom.document.activeElement).toBe(confirmBtn);

    // Keep reverse-tabbing through all 3 controls -> cycles strictly within confirmEl
    confirmBtn.dispatchEvent(new TestKeyboardEvent('keydown', { key: 'Tab', shiftKey: true }));
    expect(dom.document.activeElement).toBe(cancelBtn);
    cancelBtn.dispatchEvent(new TestKeyboardEvent('keydown', { key: 'Tab', shiftKey: true }));
    expect(dom.document.activeElement).toBe(closeBtn);

    // Forward Tab wraps cleanly from last -> first
    confirmBtn.focus();
    const tabWrap = new TestKeyboardEvent('keydown', { key: 'Tab', shiftKey: false });
    confirmBtn.dispatchEvent(tabWrap);
    expect(tabWrap.defaultPrevented).toBe(true);
    expect(dom.document.activeElement).toBe(closeBtn);

    // Native Enter / Space dispatched against background Resume button is blocked and pulls focus back inside confirmEl
    const enterBg = new TestKeyboardEvent('keydown', { key: 'Enter' });
    resumeBtn.dispatchEvent(enterBg);
    expect(enterBg.defaultPrevented).toBe(true);
    expect(resumeClicks).not.toHaveBeenCalled();
    expect(confirmEl.contains(dom.document.activeElement)).toBe(true);

    const spaceBg = new TestKeyboardEvent('keydown', { key: ' ' });
    hudPauseBtn.dispatchEvent(spaceBg);
    expect(spaceBg.defaultPrevented).toBe(true);
    expect(hudPauseClicks).not.toHaveBeenCalled();

    // Closing nested Abandon confirm un-inerts Pause panel (keeping HUD inert) and restores focus directly to Abandon opener!
    offConfirm();
    confirmEl.remove();
    expect(pausePanel.inert).toBe(false);
    expect(hud.inert).toBe(true);
    expect(dom.document.activeElement).toBe(abandonBtn);

    // Closing Pause un-inerts HUD, preserves pre-existing inert sibling, and restores focus to HUD Pause opener!
    offPause();
    pauseEl.remove();
    expect(hud.inert).toBe(false);
    expect(preInert.inert).toBe(true);
    expect(dom.document.activeElement).toBe(hudPauseBtn);
  });

  it('KitDialog, KitConfirm, and Modal trap Tab over enabled controls only, keep container focus when none enabled, and restore opener focus on unmount', () => {
    const uiRoot = dom.document.getElementById('ui')!;
    const bgScreen = dom.document.createElement('div');
    const openerBtn = makeButton(dom, 'settings-reset-btn', { left: 40, top: 40, width: 120, height: 36 });
    bgScreen.appendChild(openerBtn);
    uiRoot.appendChild(bgScreen);
    openerBtn.focus();

    // Test real KitConfirm + KitDialog + Modal mounted through Preact
    const mount = dom.document.createElement('div');
    uiRoot.appendChild(mount);

    render(
      h(KitDialog, {
        title: 'Reset',
        footer: h('button', { type: 'button', disabled: true, 'data-nav': '' }, 'Locked'),
      }),
      mount as unknown as Element,
    );
    dom.flushRaf(2);

    const kdlg = mount.querySelector('.ms-kdlg')!;
    expect(kdlg.getAttribute('aria-modal')).toBe('true');
    expect(kdlg.getAttribute('tabindex')).toBe('-1');
    expect(bgScreen.inert).toBe(true);
    // With zero enabled focusable controls (no onClose button, confirm disabled), Tab keeps focus on the dialog container
    kdlg.dispatchEvent(new TestKeyboardEvent('keydown', { key: 'Tab' }));
    expect(dom.document.activeElement).toBe(kdlg);

    // Unmount KitDialog -> bgScreen restored and openerBtn regains focus
    render(null, mount as unknown as Element);
    expect(bgScreen.inert).toBe(false);
    expect(dom.document.activeElement).toBe(openerBtn);

    // Mount Modal (legacy/Talents dialog) -> has aria-modal="true", traps Tab, inerts background, restores opener
    render(
      h(Modal, {
        title: 'Confirm Reset',
        onClose: () => {},
        footer: h('button', { type: 'button', 'data-nav': '' }, 'Confirm'),
      }),
      mount as unknown as Element,
    );
    dom.flushRaf(2);

    const modalEl = mount.querySelector('.ms-modal')!;
    expect(modalEl.getAttribute('role')).toBe('dialog');
    expect(modalEl.getAttribute('aria-modal')).toBe('true');
    expect(bgScreen.inert).toBe(true);

    // Mount KitConfirm with Cancel + Confirm buttons and test reverse Tab wrap
    render(
      h(KitConfirm, {
        title: 'Abandon',
        text: 'Sure?',
        onCancel: () => {},
        onConfirm: () => {},
      }),
      mount as unknown as Element,
    );
    dom.flushRaf(2);
    const confirmBtns = mount.querySelectorAll('button');
    expect(confirmBtns.length).toBeGreaterThanOrEqual(2);
    confirmBtns[0]!.focus();
    confirmBtns[0]!.dispatchEvent(new TestKeyboardEvent('keydown', { key: 'Tab', shiftKey: true }));
    expect(dom.document.activeElement).toBe(confirmBtns[confirmBtns.length - 1]);

    render(null, mount as unknown as Element);
    expect(bgScreen.inert).toBe(false);
    expect(dom.document.activeElement).toBe(openerBtn);
  });

  it('keeps nested KitConfirm on top and parent Pause panel inert when parent re-renders via useScope', () => {
    const uiRoot = dom.document.getElementById('ui')!;
    const mount = dom.document.createElement('div');
    uiRoot.appendChild(mount);

    let openConfirm!: () => void;
    let closeConfirm!: () => void;
    function ParentPause() {
      const scope = useScope();
      const [confirm, setConfirm] = useState(false);
      openConfirm = () => setConfirm(true);
      closeConfirm = () => setConfirm(false);
      return h(
        'div',
        { class: 'ms-modal ms-pause', ref: scope, role: 'dialog', 'aria-modal': 'true' },
        h(
          'div',
          { class: 'ms-panel ms-pause-panel' },
          h('button', { type: 'button', id: 'parent-abandon', 'data-nav': '' }, 'Abandon run'),
          h('button', { type: 'button', id: 'parent-resume', 'data-nav': '', 'data-autofocus': '' }, 'Resume'),
        ),
        confirm
          ? h(KitConfirm, {
              title: 'Abandon run?',
              text: 'Confirm abandon.',
              confirmLabel: 'Abandon',
              onCancel: () => setConfirm(false),
              onConfirm: () => setConfirm(false),
              danger: true,
            })
          : null,
      );
    }

    render(h(ParentPause, null), mount as unknown as Element);
    dom.flushRaf(2);
    const parentPanel = mount.querySelector('.ms-pause-panel')!;
    const abandonBtn = mount.querySelector('#parent-abandon')!;
    expect(parentPanel.inert).toBe(false);

    // Focus Abandon run and trigger parent re-render that mounts nested KitConfirm
    abandonBtn.focus();
    openConfirm();
    render(h(ParentPause, null), mount as unknown as Element);
    dom.flushRaf(2);

    const kdlg = mount.querySelector('.ms-kdlg')!;
    expect(parentPanel.inert).toBe(true);
    expect(kdlg.inert).toBe(false);
    expect(kdlg.contains(dom.document.activeElement)).toBe(true);

    // 4x Shift+Tab must stay strictly inside KitConfirm, never hitting parent Resume
    for (let i = 0; i < 4; i++) {
      const cur = dom.document.activeElement!;
      cur.dispatchEvent(new TestKeyboardEvent('keydown', { key: 'Tab', shiftKey: true }));
      expect(kdlg.contains(dom.document.activeElement)).toBe(true);
    }

    closeConfirm();
    render(h(ParentPause, null), mount as unknown as Element);
    dom.flushRaf(2);
    expect(parentPanel.inert).toBe(false);
    expect(dom.document.activeElement).toBe(abandonBtn);
  });
});

describe('UI-04: controller gamepad navigation adjusts Slider at min, mid, and max while up/down moves focus', () => {
  let dom: TestDomEnv;
  let disposeNav: () => void;
  let emitAction: (a: UiAction) => void;

  beforeEach(() => {
    dom = installTestDom();
    const listeners = new Set<(a: UiAction) => void>();
    emitAction = (a: UiAction) => {
      for (const fn of listeners) fn(a);
    };
    setDeps({
      input: {
        onAction: (fn: (a: UiAction) => void) => {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
      },
    } as unknown as UiDeps);

    const root = dom.document.createElement('div');
    root.id = 'ui';
    dom.body.appendChild(root);
    disposeNav = installNav(root as unknown as HTMLElement);
  });

  afterEach(() => {
    render(null, dom.body as unknown as Element);
    disposeNav();
    setDeps(null);
    dom.restore();
  });

  it('gamepad left/right steps audio & custom-run sliders at min, mid, and max without losing focus, while up/down moves to adjacent controls', () => {
    const uiRoot = dom.document.getElementById('ui')!;
    const scopeEl = dom.document.createElement('div');
    uiRoot.appendChild(scopeEl);

    const observedAudio: number[] = [];
    const observedDensity: number[] = [];

    function Harness() {
      const [audio, setAudio] = useState(0);
      const [density, setDensity] = useState(1.5);
      return h(
        'div',
        null,
        h('button', { type: 'button', id: 'top-btn', 'data-nav': '' }, 'Top'),
        h(Slider, {
          value: audio,
          min: 0,
          max: 1,
          step: 0.05,
          label: 'Master Volume',
          onChange: (v) => {
            observedAudio.push(v);
            setAudio(v);
          },
        }),
        h(Slider, {
          value: density,
          min: 1,
          max: 3,
          step: 0.25,
          label: 'Enemy Density',
          onChange: (v) => {
            observedDensity.push(v);
            setDensity(v);
          },
        }),
        h('button', { type: 'button', id: 'side-btn', 'data-nav': '' }, 'Test'),
        h('button', { type: 'button', id: 'bot-btn', 'data-nav': '' }, 'Done'),
      );
    }

    render(h(Harness, null), scopeEl as unknown as Element);
    dom.flushEffects();

    const topBtn = scopeEl.querySelector('#top-btn')!;
    const sliders = scopeEl.querySelectorAll('[role="slider"]');
    const audioSlider = sliders[0]!;
    const densitySlider = sliders[1]!;
    const sideBtn = scopeEl.querySelector('#side-btn')!;
    const botBtn = scopeEl.querySelector('#bot-btn')!;

    // Position elements vertically (with sideBtn to the right of audioSlider, like Settings SFX Test button!)
    topBtn.rect = { left: 40, top: 20, width: 200, height: 32 };
    audioSlider.rect = { left: 40, top: 80, width: 200, height: 32 };
    sideBtn.rect = { left: 260, top: 80, width: 80, height: 32 };
    densitySlider.rect = { left: 40, top: 140, width: 200, height: 32 };
    botBtn.rect = { left: 40, top: 200, width: 200, height: 32 };

    const offScope = registerScope(scopeEl as unknown as HTMLElement);
    const pad = (kind: UiAction['kind']): void => emitAction({ kind, index: 0, repeat: false, source: 'gamepad' });

    // 1. Focus audioSlider at MIN (0): gamepad left clamps at 0 and stays focused on audioSlider
    audioSlider.focus();
    expect(dom.document.activeElement).toBe(audioSlider);
    pad('left');
    expect(audioSlider.getAttribute('aria-valuenow')).toBe('0');
    expect(observedAudio).toEqual([]);
    expect(dom.document.activeElement).toBe(audioSlider);

    // 2. Gamepad right steps by 0.05 (0 -> 0.05 -> 0.1)
    pad('right');
    expect(audioSlider.getAttribute('aria-valuenow')).toBe('0.05');
    pad('right');
    expect(audioSlider.getAttribute('aria-valuenow')).toBe('0.1');
    expect(observedAudio).toEqual([0.05, 0.1]);

    // 3. Step up to MAX (1.0): pressing right at max clamps at 1 and does NOT jump focus to sideBtn!
    for (let i = 0; i < 20; i++) pad('right');
    expect(audioSlider.getAttribute('aria-valuenow')).toBe('1');
    expect(dom.document.activeElement).toBe(audioSlider);
    const countAtMax = observedAudio.length;
    pad('right');
    expect(audioSlider.getAttribute('aria-valuenow')).toBe('1');
    expect(observedAudio.length).toBe(countAtMax);
    expect(dom.document.activeElement).toBe(audioSlider);

    // Step left from max -> 0.95
    pad('left');
    expect(audioSlider.getAttribute('aria-valuenow')).toBe('0.95');

    // 4. Gamepad DOWN moves focus cleanly to densitySlider (at MID = 1.5, step = 0.25)
    pad('down');
    expect(dom.document.activeElement).toBe(densitySlider);
    pad('left');
    expect(densitySlider.getAttribute('aria-valuenow')).toBe('1.25');
    pad('right');
    expect(densitySlider.getAttribute('aria-valuenow')).toBe('1.5');
    pad('right');
    expect(densitySlider.getAttribute('aria-valuenow')).toBe('1.75');
    expect(observedDensity).toEqual([1.25, 1.5, 1.75]);

    // 5. Gamepad DOWN moves focus to botBtn; UP returns to densitySlider -> audioSlider -> topBtn
    pad('down');
    expect(dom.document.activeElement).toBe(botBtn);
    pad('up');
    expect(dom.document.activeElement).toBe(densitySlider);
    pad('up');
    expect(dom.document.activeElement).toBe(audioSlider);
    pad('up');
    expect(dom.document.activeElement).toBe(topBtn);

    offScope();
  });
});
