// Keyboard + gamepad navigation.
//
//  · Focus scopes: a screen or modal registers a scope (`useScope`); arrow keys / D-pad then move DOM focus between its
//    `[data-nav]` elements by screen geometry, Enter / Space / pad-A activate the focused one. The innermost scope wins.
//    With no scope registered (the HUD during a run) the UI never touches the keyboard — movement stays with the engine.
//  · Modal isolation: modal scopes (`{ modal: true }`, `aria-modal="true"`, or `.ms-modal`) trap Tab / Shift+Tab inside
//    their enabled focusable controls, mark background sibling subtrees `inert` via a stack-aware manager (supporting
//    nested dialogs such as Pause → Abandon), block native Enter / Space activation outside the topmost scope, and
//    restore the opener's focus on dismissal.
//  · Hotkey stack: modals push handlers that receive the engine's UiActions (digits, R/B/X, Esc…). The top-most handler
//    that returns true consumes the action.
import { useCallback, useEffect, useRef } from 'preact/hooks';
import type { UiAction } from '../engine/input';
import { deps, hasDeps } from './env';

export type KeyHandler = (a: UiAction) => boolean | void;

export interface ScopeOptions {
  /** Treat this scope as a modal dialog (Tab trap, inert background, opener focus restore). Auto-detected from `aria-modal="true"` / `.ms-modal` when omitted. */
  modal?: boolean;
}

export const NAV_ARROW_EVENT = 'ms-nav-arrow';

export interface NavArrowDetail {
  dir: Dir;
}

interface ScopeEntry {
  el: HTMLElement;
  modal: boolean;
  opener: HTMLElement | null;
  addedTabIndex: boolean;
}

const keyStack: KeyHandler[] = [];
const scopes: ScopeEntry[] = [];
const managedInert = new Set<HTMLElement>();
let root: HTMLElement | null = null;

export function pushKeys(h: KeyHandler): () => void {
  keyStack.push(h);
  return () => {
    const i = keyStack.lastIndexOf(h);
    if (i >= 0) keyStack.splice(i, 1);
  };
}

/** Registers the latest handler for the component's lifetime (handler identity may change every render). */
export function useKeys(handler: KeyHandler, enabled = true): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return undefined;
    return pushKeys((a) => ref.current(a));
  }, [enabled]);
}

function isInert(el: HTMLElement): boolean {
  let cur: HTMLElement | null = el;
  while (cur) {
    if ((cur as HTMLElement & { inert?: boolean }).inert || cur.hasAttribute('inert')) return true;
    cur = cur.parentElement;
  }
  return false;
}

function isDisabled(el: HTMLElement): boolean {
  return el.hasAttribute('disabled') || (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true';
}

function isVisible(el: HTMLElement): boolean {
  if (!el.isConnected || el.hidden) return false;
  if (typeof getComputedStyle === 'function') {
    const cs = getComputedStyle(el);
    if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return false;
  }
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function pickInnermost(predicate?: (s: ScopeEntry) => boolean): ScopeEntry | null {
  let best: ScopeEntry | null = null;
  for (let i = scopes.length - 1; i >= 0; i--) {
    const s = scopes[i];
    if (!s || !s.el.isConnected) continue;
    if (predicate && !predicate(s)) continue;
    if (!best) {
      best = s;
    } else if (best.el !== s.el && best.el.contains(s.el)) {
      best = s;
    }
  }
  return best;
}

function activeScopeEntry(): ScopeEntry | null {
  return pickInnermost();
}

function activeScope(): HTMLElement | null {
  return activeScopeEntry()?.el ?? null;
}

function activeModalScope(): HTMLElement | null {
  return pickInnermost((s) => s.modal)?.el ?? null;
}

function setElementInert(el: HTMLElement, on: boolean): void {
  (el as HTMLElement & { inert?: boolean }).inert = on;
  if (on) el.setAttribute('inert', '');
  else el.removeAttribute('inert');
}

function syncInert(): void {
  const topModal = activeModalScope();
  const desired = new Set<HTMLElement>();
  if (topModal) {
    const boundary = typeof document !== 'undefined' ? document.body : null;
    let cur: HTMLElement | null = topModal;
    while (cur && cur !== boundary && cur.parentElement) {
      const parent: HTMLElement = cur.parentElement;
      for (const child of Array.from(parent.children)) {
        if (child === cur || !(child instanceof HTMLElement)) continue;
        const tag = child.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK') continue;
        if (child.classList.contains('ms-toasts') || child.classList.contains('ms-tooltip')) continue;
        desired.add(child);
      }
      cur = parent;
    }
  }
  for (const el of Array.from(managedInert)) {
    if (!desired.has(el)) {
      setElementInert(el, false);
      managedInert.delete(el);
    }
  }
  for (const el of desired) {
    if (managedInert.has(el)) continue;
    if ((el as HTMLElement & { inert?: boolean }).inert || el.hasAttribute('inert')) continue;
    setElementInert(el, true);
    managedInert.add(el);
  }
}

export function registerScope(el: HTMLElement, opts?: ScopeOptions): () => void {
  const modal = opts?.modal ?? (el.getAttribute('aria-modal') === 'true' || el.classList.contains('ms-modal'));
  const doc = typeof document !== 'undefined' ? document : null;
  const active = doc?.activeElement ?? null;
  const opener =
    modal &&
    active instanceof HTMLElement &&
    active !== doc?.body &&
    active !== doc?.documentElement &&
    !el.contains(active)
      ? active
      : null;
  let addedTabIndex = false;
  if (modal && !el.hasAttribute('tabindex')) {
    el.tabIndex = -1;
    addedTabIndex = true;
  }
  const entry: ScopeEntry = { el, modal, opener, addedTabIndex };
  scopes.push(entry);
  syncInert();
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    const curDoc = typeof document !== 'undefined' ? document : null;
    const curActive = curDoc?.activeElement ?? null;
    const shouldRestore =
      entry.modal &&
      (curActive === null ||
        curActive === curDoc?.body ||
        curActive === curDoc?.documentElement ||
        (curActive instanceof HTMLElement && el.contains(curActive)));
    const i = scopes.lastIndexOf(entry);
    if (i >= 0) scopes.splice(i, 1);
    if (entry.addedTabIndex) el.removeAttribute('tabindex');
    syncInert();
    if (!shouldRestore) return;
    const nextScope = activeScope();
    if (
      entry.opener &&
      entry.opener.isConnected &&
      !isDisabled(entry.opener) &&
      !isInert(entry.opener) &&
      (!nextScope || nextScope.contains(entry.opener))
    ) {
      entry.opener.focus({ preventScroll: true });
    } else if (nextScope) {
      focusFirst();
    }
  };
}

/** Attaches a focus scope to the element returned by the ref for the component's lifetime. */
export function useScope(opts?: ScopeOptions): (el: HTMLElement | null) => void {
  const elRef = useRef<HTMLElement | null>(null);
  const offRef = useRef<(() => void) | null>(null);
  const modalRef = useRef<boolean | undefined>(opts?.modal);
  modalRef.current = opts?.modal;
  useEffect(
    () => () => {
      offRef.current?.();
      offRef.current = null;
      elRef.current = null;
    },
    [],
  );
  return useCallback((el: HTMLElement | null) => {
    if (el === elRef.current) return;
    offRef.current?.();
    offRef.current = null;
    elRef.current = el;
    if (el) offRef.current = registerScope(el, modalRef.current !== undefined ? { modal: modalRef.current } : undefined);
  }, []);
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
  '[tabindex]',
  '[contenteditable=""]',
  '[contenteditable="true"]',
].join(',');

/** Enabled, visible, tabbable controls inside `scope` in DOM order (used by modal Tab trapping). */
export function focusableElements(scope: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  scope.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR).forEach((el) => {
    if (isDisabled(el) || isInert(el)) return;
    const tiAttr = el.getAttribute('tabindex');
    if (tiAttr !== null) {
      const ti = Number(tiAttr);
      if (!Number.isFinite(ti) || ti < 0) return;
    }
    if (isVisible(el)) out.push(el);
  });
  return out;
}

export function navElements(scope: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  scope.querySelectorAll<HTMLElement>('[data-nav]').forEach((el) => {
    if (isDisabled(el) || isInert(el) || el.dataset.navSkip !== undefined) return;
    if (isVisible(el)) out.push(el);
  });
  return out;
}

export type Dir = 'left' | 'right' | 'up' | 'down';

function ownsAxis(el: HTMLElement, dir: Dir): boolean {
  const own = el.dataset.arrows;
  return own === 'xy' || (own === 'x' && (dir === 'left' || dir === 'right')) || (own === 'y' && (dir === 'up' || dir === 'down'));
}

function arrowOwner(el: HTMLElement, scope: HTMLElement, dir: Dir): HTMLElement | null {
  let cur: HTMLElement | null = el;
  while (cur) {
    if (ownsAxis(cur, dir)) return cur;
    if (cur === scope) break;
    cur = cur.parentElement;
  }
  return null;
}

/** Dispatches a directional adjustment event to the focused control (or nearest ancestor inside scope) if it owns `dir` via `data-arrows`. */
export function dispatchNavArrow(dir: Dir): boolean {
  const scope = activeScope();
  if (!scope) return false;
  const active = typeof document !== 'undefined' && document.activeElement instanceof HTMLElement && scope.contains(document.activeElement) ? document.activeElement : null;
  if (!active) return false;
  const owner = arrowOwner(active, scope, dir);
  if (!owner) return false;
  root?.classList.add('ms-kbd');
  const ev = new CustomEvent<NavArrowDetail>(NAV_ARROW_EVENT, { detail: { dir }, bubbles: true, cancelable: true });
  owner.dispatchEvent(ev);
  return ev.defaultPrevented;
}

function centre(r: DOMRect): { x: number; y: number } {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Moves focus to the nearest element in `dir`; focuses the first element when nothing is focused yet. */
export function moveFocus(dir: Dir): boolean {
  const scope = activeScope();
  if (!scope) return false;
  const items = navElements(scope);
  if (items.length === 0) return false;
  const cur = document.activeElement instanceof HTMLElement && items.includes(document.activeElement) ? document.activeElement : null;
  root?.classList.add('ms-kbd');
  if (!cur) {
    const pref = scope.querySelector<HTMLElement>('[data-autofocus]');
    const first = pref && items.includes(pref) ? pref : items[0];
    first?.focus({ preventScroll: true });
    return true;
  }
  const a = centre(cur.getBoundingClientRect());
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of items) {
    if (el === cur) continue;
    const c = centre(el.getBoundingClientRect());
    const dx = c.x - a.x;
    const dy = c.y - a.y;
    let main: number;
    let cross: number;
    if (dir === 'left') [main, cross] = [-dx, Math.abs(dy)];
    else if (dir === 'right') [main, cross] = [dx, Math.abs(dy)];
    else if (dir === 'up') [main, cross] = [-dy, Math.abs(dx)];
    else [main, cross] = [dy, Math.abs(dx)];
    if (main <= 2) continue;
    const score = main + cross * 2.2;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  if (best) {
    best.focus({ preventScroll: false });
    best.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return true;
  }
  return false;
}

export function clickFocused(): boolean {
  const scope = activeScope();
  const el = document.activeElement;
  if (scope && el instanceof HTMLElement && scope.contains(el) && el.hasAttribute('data-nav')) {
    el.click();
    return true;
  }
  return false;
}

/** Focuses the preferred (or first) nav element of the innermost scope (or the dialog container when a modal has no enabled controls). */
export function focusFirst(): void {
  const scope = activeScope();
  if (!scope) return;
  const items = navElements(scope);
  const pref = scope.querySelector<HTMLElement>('[data-autofocus]');
  const target = pref && items.includes(pref) ? pref : (items[0] ?? focusableElements(scope)[0]);
  if (target) target.focus({ preventScroll: true });
  else if (activeModalScope() === scope) scope.focus({ preventScroll: true });
}

function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

const KEY_DIR: Record<string, Dir> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
const PAD_DIR: Record<string, Dir> = { left: 'left', right: 'right', up: 'up', down: 'down' };

function trapTab(modal: HTMLElement, reverse: boolean): void {
  root?.classList.add('ms-kbd');
  const items = focusableElements(modal);
  if (items.length === 0) {
    modal.focus({ preventScroll: true });
    return;
  }
  const cur = typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const idx = cur ? items.indexOf(cur) : -1;
  if (idx >= 0) {
    const nextIdx = reverse ? (idx - 1 + items.length) % items.length : (idx + 1) % items.length;
    items[nextIdx]?.focus({ preventScroll: false });
    return;
  }
  if (cur && cur !== modal && modal.contains(cur) && typeof cur.compareDocumentPosition === 'function') {
    if (reverse) {
      for (let i = items.length - 1; i >= 0; i--) {
        const cand = items[i];
        if (cand && (cur.compareDocumentPosition(cand) & 2) !== 0) {
          cand.focus({ preventScroll: false });
          return;
        }
      }
      items[items.length - 1]?.focus({ preventScroll: false });
      return;
    }
    for (const cand of items) {
      if ((cur.compareDocumentPosition(cand) & 4) !== 0) {
        cand.focus({ preventScroll: false });
        return;
      }
    }
    items[0]?.focus({ preventScroll: false });
    return;
  }
  (reverse ? items[items.length - 1] : items[0])?.focus({ preventScroll: false });
}

/** Installs the global handlers; returns the dispose function. */
export function installNav(rootEl: HTMLElement): () => void {
  root = rootEl;

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Tab') {
      const modal = activeModalScope();
      if (!modal) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      trapTab(modal, e.shiftKey);
      return;
    }
    const scope = activeScope();
    if (!scope) return;
    const target = e.target;
    const dir = KEY_DIR[e.key];
    if (dir) {
      if (isEditable(target)) return;
      if (target instanceof HTMLElement && scope.contains(target) && arrowOwner(target, scope, dir)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      moveFocus(dir);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      const inScope = target instanceof HTMLElement && scope.contains(target);
      if (!inScope) {
        const doc = typeof document !== 'undefined' ? document : null;
        if (target instanceof HTMLElement && target !== doc?.body && target !== doc?.documentElement) {
          e.preventDefault();
          e.stopImmediatePropagation();
          const modal = activeModalScope();
          if (modal) (focusableElements(modal)[0] ?? modal).focus({ preventScroll: true });
        }
        return;
      }
      if (isEditable(target)) return;
      if (target.hasAttribute('data-nav')) {
        if (target.dataset.arrows === 'xy') return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!e.repeat) target.click();
      }
    }
  };
  const onFocusIn = (e: FocusEvent): void => {
    const modal = activeModalScope();
    if (!modal) return;
    const target = e.target;
    if (target instanceof HTMLElement && modal.contains(target)) return;
    (focusableElements(modal)[0] ?? modal).focus({ preventScroll: true });
  };
  const onPointer = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') rootEl.classList.remove('ms-kbd');
  };
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('pointermove', onPointer, { passive: true });
  if (typeof document !== 'undefined') document.addEventListener('focusin', onFocusIn, true);

  const offInput = hasDeps()
    ? (deps().input?.onAction((a) => {
        for (let i = keyStack.length - 1; i >= 0; i--) {
          const h = keyStack[i];
          if (h && h(a) === true) return;
        }
        if (a.source === 'gamepad') {
          const dir = PAD_DIR[a.kind];
          if (dir) {
            if (!dispatchNavArrow(dir)) moveFocus(dir);
          } else if (a.kind === 'confirm') {
            clickFocused();
          }
        }
      }) ?? null)
    : null;

  return () => {
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('pointermove', onPointer);
    if (typeof document !== 'undefined') document.removeEventListener('focusin', onFocusIn, true);
    offInput?.();
    keyStack.length = 0;
    scopes.length = 0;
    syncInert();
    root = null;
  };
}
