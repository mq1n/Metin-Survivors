// Lightweight DOM / event / observer / rAF shim for running Preact + DOM UI regression tests under Vitest's node environment.
// Implements WHATWG-faithful DOMTokenList.add() mutation notifications, focus/inert/tabIndex semantics, capture/bubble events,
// MutationObserver/ResizeObserver, and controllable requestAnimationFrame + document.fonts.ready.
import { options as preactOptions } from 'preact';

export interface TestRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

type Listener = (ev: TestEvent) => void;
interface ListenerEntry {
  fn: Listener;
  capture: boolean;
}

export class TestEvent {
  readonly type: string;
  readonly bubbles: boolean;
  readonly cancelable: boolean;
  defaultPrevented = false;
  cancelBubble = false;
  immediateStopped = false;
  target: unknown = null;
  currentTarget: unknown = null;

  constructor(type: string, init: { bubbles?: boolean; cancelable?: boolean } = {}) {
    this.type = type;
    this.bubbles = init.bubbles ?? false;
    this.cancelable = init.cancelable ?? false;
  }

  preventDefault(): void {
    if (this.cancelable) this.defaultPrevented = true;
  }
  stopPropagation(): void {
    this.cancelBubble = true;
  }
  stopImmediatePropagation(): void {
    this.cancelBubble = true;
    this.immediateStopped = true;
  }
}

export class TestCustomEvent<T = unknown> extends TestEvent {
  readonly detail: T;
  constructor(type: string, init: { detail?: T; bubbles?: boolean; cancelable?: boolean } = {}) {
    super(type, init);
    this.detail = init.detail as T;
  }
}

export class TestKeyboardEvent extends TestEvent {
  readonly key: string;
  readonly code: string;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly repeat: boolean;

  constructor(
    type: string,
    init: {
      key?: string;
      code?: string;
      shiftKey?: boolean;
      ctrlKey?: boolean;
      metaKey?: boolean;
      altKey?: boolean;
      repeat?: boolean;
      bubbles?: boolean;
      cancelable?: boolean;
    } = {},
  ) {
    super(type, { bubbles: init.bubbles ?? true, cancelable: init.cancelable ?? true });
    this.key = init.key ?? '';
    this.code = init.code ?? '';
    this.shiftKey = init.shiftKey ?? false;
    this.ctrlKey = init.ctrlKey ?? false;
    this.metaKey = init.metaKey ?? false;
    this.altKey = init.altKey ?? false;
    this.repeat = init.repeat ?? false;
  }
}

export class TestFocusEvent extends TestEvent {
  constructor(type: string, init: { bubbles?: boolean } = {}) {
    super(type, { bubbles: init.bubbles ?? (type === 'focusin' || type === 'focusout'), cancelable: false });
  }
}

class TestEventTarget {
  private readonly listeners = new Map<string, ListenerEntry[]>();

  addEventListener(type: string, fn: Listener | null | undefined, opts?: boolean | { capture?: boolean }): void {
    if (!fn) return;
    const capture = typeof opts === 'boolean' ? opts : Boolean(opts?.capture);
    const list = this.listeners.get(type) ?? [];
    if (!list.some((e) => e.fn === fn && e.capture === capture)) {
      list.push({ fn, capture });
      this.listeners.set(type, list);
    }
  }

  removeEventListener(type: string, fn: Listener | null | undefined, opts?: boolean | { capture?: boolean }): void {
    if (!fn) return;
    const capture = typeof opts === 'boolean' ? opts : Boolean(opts?.capture);
    const list = this.listeners.get(type);
    if (!list) return;
    const next = list.filter((e) => !(e.fn === fn && e.capture === capture));
    if (next.length === 0) this.listeners.delete(type);
    else this.listeners.set(type, next);
  }

  protected invokeListeners(ev: TestEvent, capturePhase: boolean): void {
    const list = this.listeners.get(ev.type);
    if (!list) return;
    ev.currentTarget = this;
    for (const entry of list.slice()) {
      if (entry.capture !== capturePhase) continue;
      entry.fn.call(this, ev);
      if (ev.immediateStopped) break;
    }
  }

  dispatchEvent(ev: TestEvent): boolean {
    ev.target = this;
    this.invokeListeners(ev, true);
    if (!ev.immediateStopped) this.invokeListeners(ev, false);
    return !ev.defaultPrevented;
  }
}

export interface TestMutationRecord {
  type: 'attributes' | 'childList';
  target: TestNode;
  attributeName: string | null;
}

export class TestMutationObserver {
  private readonly cb: (records: TestMutationRecord[], observer: TestMutationObserver) => void;
  private readonly targets = new Map<TestNode, { childList: boolean; attributes: boolean; attributeFilter?: string[] }>();
  private queue: TestMutationRecord[] = [];
  private scheduled = false;

  constructor(cb: (records: TestMutationRecord[], observer: TestMutationObserver) => void) {
    this.cb = cb;
  }

  observe(target: TestNode, opts: { childList?: boolean; attributes?: boolean; attributeFilter?: string[] } = {}): void {
    const cfg: { childList: boolean; attributes: boolean; attributeFilter?: string[] } = {
      childList: Boolean(opts.childList),
      attributes: Boolean(opts.attributes),
      ...(opts.attributeFilter ? { attributeFilter: opts.attributeFilter } : {}),
    };
    this.targets.set(target, cfg);
    target._observers.add(this);
  }

  disconnect(): void {
    for (const t of this.targets.keys()) t._observers.delete(this);
    this.targets.clear();
    this.queue = [];
  }

  takeRecords(): TestMutationRecord[] {
    const out = this.queue;
    this.queue = [];
    return out;
  }

  _notify(record: TestMutationRecord): void {
    const cfg = this.targets.get(record.target);
    if (!cfg) return;
    if (record.type === 'childList' && !cfg.childList) return;
    if (record.type === 'attributes') {
      if (!cfg.attributes) return;
      if (cfg.attributeFilter && record.attributeName && !cfg.attributeFilter.includes(record.attributeName)) return;
    }
    this.queue.push(record);
    if (!this.scheduled) {
      this.scheduled = true;
      queueMicrotask(() => {
        this.scheduled = false;
        const batch = this.takeRecords();
        if (batch.length > 0) this.cb(batch, this);
      });
    }
  }
}

export class TestResizeObserver {
  static instances: TestResizeObserver[] = [];
  readonly cb: () => void;
  readonly observed = new Set<TestElement>();

  constructor(cb: () => void) {
    this.cb = cb;
    TestResizeObserver.instances.push(this);
  }

  observe(el: TestElement): void {
    this.observed.add(el);
  }

  unobserve(el: TestElement): void {
    this.observed.delete(el);
  }

  disconnect(): void {
    this.observed.clear();
  }

  trigger(): void {
    if (this.observed.size > 0) this.cb();
  }
}

export class TestNode extends TestEventTarget {
  nodeType: number;
  parentNode: TestNode | null = null;
  childNodes: TestNode[] = [];
  ownerDocument: TestDocument;
  readonly _observers = new Set<TestMutationObserver>();

  constructor(nodeType: number, doc: TestDocument) {
    super();
    this.nodeType = nodeType;
    this.ownerDocument = doc;
  }

  get parentElement(): TestElement | null {
    return this.parentNode instanceof TestElement ? this.parentNode : null;
  }

  get firstChild(): TestNode | null {
    return this.childNodes[0] ?? null;
  }

  get nextSibling(): TestNode | null {
    if (!this.parentNode) return null;
    const i = this.parentNode.childNodes.indexOf(this);
    return i >= 0 ? (this.parentNode.childNodes[i + 1] ?? null) : null;
  }

  get isConnected(): boolean {
    let cur: TestNode | null = this;
    while (cur) {
      if (cur === this.ownerDocument.documentElement) return true;
      cur = cur.parentNode;
    }
    return false;
  }

  contains(other: unknown): boolean {
    let cur: TestNode | null = other instanceof TestNode ? other : null;
    while (cur) {
      if (cur === this) return true;
      cur = cur.parentNode;
    }
    return false;
  }

  appendChild<T extends TestNode>(node: T): T {
    return this.insertBefore(node, null);
  }

  insertBefore<T extends TestNode>(node: T, ref: TestNode | null): T {
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    const idx = ref ? this.childNodes.indexOf(ref) : -1;
    if (idx >= 0) this.childNodes.splice(idx, 0, node);
    else this.childNodes.push(node);
    this._emitMutation({ type: 'childList', target: this, attributeName: null });
    return node;
  }

  removeChild<T extends TestNode>(node: T): T {
    const idx = this.childNodes.indexOf(node);
    if (idx >= 0) {
      this.childNodes.splice(idx, 1);
      node.parentNode = null;
      this._emitMutation({ type: 'childList', target: this, attributeName: null });
    }
    return node;
  }

  remove(): void {
    this.parentNode?.removeChild(this);
  }

  get textContent(): string {
    return this.childNodes.map((c) => c.textContent).join('');
  }

  set textContent(v: string) {
    for (const c of this.childNodes.slice()) this.removeChild(c);
    if (v) this.appendChild(new TestText(v, this.ownerDocument));
  }

  _emitMutation(record: TestMutationRecord): void {
    for (const o of this._observers) o._notify(record);
  }
}

export class TestText extends TestNode {
  data: string;
  constructor(data: string, doc: TestDocument) {
    super(3, doc);
    this.data = String(data);
  }
  get nodeValue(): string {
    return this.data;
  }
  set nodeValue(v: string) {
    this.data = String(v);
  }
  override get textContent(): string {
    return this.data;
  }
  override set textContent(v: string) {
    this.data = String(v);
  }
}

class TestClassList {
  private readonly el: TestElement;
  constructor(el: TestElement) {
    this.el = el;
  }
  private tokens(): string[] {
    const raw = this.el.getAttribute('class') ?? '';
    return raw.trim() ? raw.trim().split(/\s+/) : [];
  }
  contains(token: string): boolean {
    return this.tokens().includes(token);
  }
  add(...tokens: string[]): void {
    // WHATWG DOM Standard: DOMTokenList.add() ALWAYS runs its update steps and notifies attribute MutationObservers,
    // even if every token was already present!
    const set = new Set(this.tokens());
    for (const tok of tokens) if (tok) set.add(tok);
    this.el.setAttribute('class', Array.from(set).join(' '));
  }
  remove(...tokens: string[]): void {
    const set = new Set(this.tokens());
    for (const tok of tokens) set.delete(tok);
    this.el.setAttribute('class', Array.from(set).join(' '));
  }
  toggle(token: string, force?: boolean): boolean {
    const has = this.contains(token);
    if (force === true) {
      if (has) return true;
      this.add(token);
      return true;
    }
    if (force === false) {
      if (!has) return false;
      this.remove(token);
      return false;
    }
    if (has) {
      this.remove(token);
      return false;
    }
    this.add(token);
    return true;
  }
}

function camelToDash(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

function dashToCamel(s: string): string {
  return s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

export class TestElement extends TestNode {
  readonly tagName: string;
  readonly localName: string;
  readonly attributesMap = new Map<string, string>();
  readonly style: Record<string, string> & {
    setProperty: (k: string, v: string) => void;
    removeProperty: (k: string) => void;
    cssText: string;
  };
  readonly classList: TestClassList;
  readonly dataset: Record<string, string | undefined>;
  hidden = false;
  scrollTop = 0;
  scrollLeft = 0;
  clientHeight = 100;
  scrollHeight = 100;
  clientWidth = 100;
  scrollWidth = 100;
  rect: TestRect = { left: 0, top: 0, width: 80, height: 32 };
  classMutationCount = 0;
  private _innerHTML = '';
  // Standard DOM event-handler IDL properties so Preact lowercases `onError` -> `error`, `onClick` -> `click`, etc.
  onclick: unknown = null;
  onerror: unknown = null;
  onkeydown: unknown = null;
  onkeyup: unknown = null;
  oninput: unknown = null;
  onfocus: unknown = null;
  onblur: unknown = null;
  onscroll: unknown = null;
  onpointerdown: unknown = null;
  onpointermove: unknown = null;
  onpointerup: unknown = null;
  onpointercancel: unknown = null;
  onpointerenter: unknown = null;
  onpointerleave: unknown = null;
  oncontextmenu: unknown = null;

  constructor(tagName: string, doc: TestDocument) {
    super(1, doc);
    this.localName = tagName.toLowerCase();
    this.tagName = tagName.toUpperCase();
    this.classList = new TestClassList(this);
    const styleStore: Record<string, string> = {};
    this.style = new Proxy(styleStore as TestElement['style'], {
      get(target, prop) {
        if (prop === 'setProperty') return (k: string, v: string) => { styleStore[k] = String(v); };
        if (prop === 'removeProperty') return (k: string) => { delete styleStore[k]; };
        if (prop === 'cssText') return Object.entries(styleStore).map(([k, v]) => `${k}:${v}`).join(';');
        return target[prop as string] ?? '';
      },
      set(_target, prop, value) {
        if (prop === 'cssText') {
          for (const k of Object.keys(styleStore)) delete styleStore[k];
          for (const part of String(value).split(';')) {
            const i = part.indexOf(':');
            if (i > 0) styleStore[part.slice(0, i).trim()] = part.slice(i + 1).trim();
          }
          return true;
        }
        if (value === null || value === undefined || value === '') delete styleStore[prop as string];
        else styleStore[prop as string] = String(value);
        return true;
      },
    });
    const el = this;
    this.dataset = new Proxy({} as Record<string, string | undefined>, {
      get(_t, prop) {
        if (typeof prop !== 'string') return undefined;
        return el.attributesMap.get(`data-${camelToDash(prop)}`);
      },
      set(_t, prop, value) {
        if (typeof prop === 'string') {
          if (value === undefined) el.removeAttribute(`data-${camelToDash(prop)}`);
          else el.setAttribute(`data-${camelToDash(prop)}`, String(value));
        }
        return true;
      },
      deleteProperty(_t, prop) {
        if (typeof prop === 'string') el.removeAttribute(`data-${camelToDash(prop)}`);
        return true;
      },
      ownKeys() {
        return Array.from(el.attributesMap.keys())
          .filter((k) => k.startsWith('data-'))
          .map((k) => dashToCamel(k.slice(5)));
      },
    });
  }

  get children(): TestElement[] {
    return this.childNodes.filter((n): n is TestElement => n instanceof TestElement);
  }

  get className(): string {
    return this.getAttribute('class') ?? '';
  }

  set className(v: string) {
    this.setAttribute('class', String(v));
  }

  get id(): string {
    return this.getAttribute('id') ?? '';
  }

  set id(v: string) {
    this.setAttribute('id', String(v));
  }

  get disabled(): boolean {
    return this.hasAttribute('disabled');
  }

  set disabled(v: boolean) {
    if (v) this.setAttribute('disabled', '');
    else this.removeAttribute('disabled');
  }

  get inert(): boolean {
    return this.hasAttribute('inert');
  }

  set inert(v: boolean) {
    if (v) this.setAttribute('inert', '');
    else this.removeAttribute('inert');
  }

  get tabIndex(): number {
    const raw = this.getAttribute('tabindex');
    if (raw !== null) return Number(raw);
    return ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A'].includes(this.tagName) ? 0 : -1;
  }

  set tabIndex(v: number) {
    this.setAttribute('tabindex', String(v));
  }

  get isContentEditable(): boolean {
    const v = this.getAttribute('contenteditable');
    return v === '' || v === 'true';
  }

  get innerHTML(): string {
    return this._innerHTML;
  }

  set innerHTML(v: string) {
    this._innerHTML = String(v);
  }

  get value(): string {
    return this.getAttribute('value') ?? '';
  }

  set value(v: string) {
    this.setAttribute('value', String(v));
  }

  get src(): string {
    return this.getAttribute('src') ?? '';
  }

  set src(v: string) {
    this.setAttribute('src', String(v));
  }

  getAttributeNames(): string[] {
    return Array.from(this.attributesMap.keys());
  }

  getAttribute(name: string): string | null {
    return this.attributesMap.get(name.toLowerCase()) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attributesMap.has(name.toLowerCase());
  }

  setAttribute(name: string, value: string): void {
    const key = name.toLowerCase();
    this.attributesMap.set(key, String(value));
    if (key === 'class') this.classMutationCount++;
    this._emitMutation({ type: 'attributes', target: this, attributeName: key });
  }

  removeAttribute(name: string): void {
    const key = name.toLowerCase();
    if (!this.attributesMap.has(key)) return;
    this.attributesMap.delete(key);
    if (key === 'class') this.classMutationCount++;
    this._emitMutation({ type: 'attributes', target: this, attributeName: key });
  }

  getBoundingClientRect(): DOMRect {
    const { left, top, width, height } = this.rect;
    return {
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
      x: left,
      y: top,
      toJSON: () => ({ left, top, width, height }),
    } as DOMRect;
  }

  scrollIntoView(): void {
    /* no-op */
  }

  scrollTo(opts?: { top?: number; left?: number }): void {
    if (opts?.top !== undefined) this.scrollTop = opts.top;
    if (opts?.left !== undefined) this.scrollLeft = opts.left;
  }

  scrollBy(opts?: { top?: number; left?: number }): void {
    if (opts?.top !== undefined) this.scrollTop += opts.top;
    if (opts?.left !== undefined) this.scrollLeft += opts.left;
  }

  getContext(): null {
    return null;
  }

  private isInertChain(): boolean {
    let cur: TestElement | null = this;
    while (cur) {
      if (cur.inert) return true;
      cur = cur.parentElement;
    }
    return false;
  }

  focus(): void {
    if (!this.isConnected || this.disabled || this.isInertChain()) return;
    const prev = this.ownerDocument.activeElement;
    this.ownerDocument.activeElement = this;
    if (prev !== this) {
      this.dispatchEvent(new TestFocusEvent('focusin', { bubbles: true }));
    }
  }

  blur(): void {
    if (this.ownerDocument.activeElement === this) {
      this.ownerDocument.activeElement = this.ownerDocument.body;
    }
  }

  click(): void {
    if (this.disabled || this.isInertChain()) return;
    this.dispatchEvent(new TestEvent('click', { bubbles: true, cancelable: true }));
  }

  override dispatchEvent(ev: TestEvent): boolean {
    ev.target = this;
    const path: TestEventTarget[] = [];
    let cur: TestNode | null = this;
    while (cur) {
      path.push(cur);
      cur = cur.parentNode;
    }
    if (this.isConnected) {
      path.push(this.ownerDocument);
      path.push(this.ownerDocument.defaultView);
    }
    // Capture phase (outermost -> target)
    for (let i = path.length - 1; i >= 0; i--) {
      if (ev.cancelBubble) break;
      (path[i] as unknown as { invokeListeners: (e: TestEvent, cap: boolean) => void }).invokeListeners(ev, true);
    }
    // Target + bubble phase
    if (!ev.cancelBubble) {
      for (let i = 0; i < path.length; i++) {
        if (i > 0 && !ev.bubbles) break;
        if (ev.cancelBubble) break;
        (path[i] as unknown as { invokeListeners: (e: TestEvent, cap: boolean) => void }).invokeListeners(ev, false);
      }
    }
    return !ev.defaultPrevented;
  }

  compareDocumentPosition(other: TestNode): number {
    if (other === this) return 0;
    const all: TestNode[] = [];
    const walk = (n: TestNode): void => {
      all.push(n);
      for (const c of n.childNodes) walk(c);
    };
    walk(this.ownerDocument.documentElement);
    const a = all.indexOf(this);
    const b = all.indexOf(other);
    if (a < 0 || b < 0) return 1;
    return b < a ? 2 : 4;
  }

  matches(selector: string): boolean {
    return selector
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .some((part) => this.matchesCompound(part));
  }

  private matchesCompound(sel: string): boolean {
    const parts = sel.trim().split(/\s+/);
    const leaf = parts[parts.length - 1];
    if (!leaf || !this.matchesSimple(leaf)) return false;
    let cur: TestElement | null = this.parentElement;
    for (let i = parts.length - 2; i >= 0; i--) {
      const ancSel = parts[i]!;
      while (cur && !cur.matchesSimple(ancSel)) cur = cur.parentElement;
      if (!cur) return false;
      cur = cur.parentElement;
    }
    return true;
  }

  private matchesSimple(sel: string): boolean {
    let rest = sel;
    // Handle :not([type="hidden"])
    const notMatch = /:not\(([^)]+)\)/.exec(rest);
    if (notMatch) {
      const inner = notMatch[1] ?? '';
      if (this.matchesSimple(inner)) return false;
      rest = rest.replace(notMatch[0], '');
    }
    // Tag prefix
    const tagMatch = /^([a-zA-Z0-9_-]+)/.exec(rest);
    if (tagMatch) {
      if (this.localName !== tagMatch[1]?.toLowerCase()) return false;
      rest = rest.slice(tagMatch[0].length);
    }
    // IDs, classes & attributes
    const tokenRe = /(#[a-zA-Z0-9_-]+)|(\.[a-zA-Z0-9_-]+)|(\[([^\]=]+)(?:="([^"]*)")?\])/g;
    let m: RegExpExecArray | null;
    while ((m = tokenRe.exec(rest)) !== null) {
      if (m[1]) {
        if (this.id !== m[1].slice(1)) return false;
      } else if (m[2]) {
        if (!this.classList.contains(m[2].slice(1))) return false;
      } else if (m[4]) {
        const attr = m[4].toLowerCase();
        if (m[5] !== undefined) {
          if (this.getAttribute(attr) !== m[5]) return false;
        } else if (!this.hasAttribute(attr)) {
          return false;
        }
      }
    }
    return true;
  }

  closest<T extends TestElement = TestElement>(selector: string): T | null {
    let cur: TestElement | null = this;
    while (cur) {
      if (cur.matches(selector)) return cur as T;
      cur = cur.parentElement;
    }
    return null;
  }

  querySelector<T extends TestElement = TestElement>(selector: string): T | null {
    return (this.querySelectorAll<T>(selector)[0] ?? null);
  }

  querySelectorAll<T extends TestElement = TestElement>(selector: string): T[] {
    const out: T[] = [];
    const visit = (n: TestNode): void => {
      for (const c of n.childNodes) {
        if (c instanceof TestElement) {
          if (c.matches(selector)) out.push(c as T);
          visit(c);
        }
      }
    };
    visit(this);
    return out;
  }
}

export class TestWindow extends TestEventTarget {
  devicePixelRatio = 1;
  innerWidth = 1920;
  innerHeight = 1080;
  setTimeout = (fn: () => void, ms?: number): ReturnType<typeof setTimeout> => setTimeout(fn, ms);
  clearTimeout = (id: ReturnType<typeof setTimeout>): void => clearTimeout(id);
}

export class TestDocument extends TestEventTarget {
  readonly defaultView: TestWindow;
  readonly documentElement: TestElement;
  readonly head: TestElement;
  readonly body: TestElement;
  activeElement: TestElement | null;
  fonts: { ready: Promise<void> };
  resolveFontsReady!: () => void;

  constructor(win: TestWindow) {
    super();
    this.defaultView = win;
    this.documentElement = new TestElement('html', this);
    this.head = new TestElement('head', this);
    this.body = new TestElement('body', this);
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this.activeElement = this.body;
    let res!: () => void;
    const p = new Promise<void>((r) => {
      res = r;
    });
    this.fonts = { ready: p };
    this.resolveFontsReady = res;
  }

  createElement(tag: string): TestElement {
    return new TestElement(tag, this);
  }

  createElementNS(_ns: string, tag: string): TestElement {
    return new TestElement(tag, this);
  }

  createTextNode(text: string): TestText {
    return new TestText(text, this);
  }

  getElementById(id: string): TestElement | null {
    return this.documentElement.querySelector(`[id="${id}"]`);
  }

  querySelector<T extends TestElement = TestElement>(selector: string): T | null {
    return this.documentElement.querySelector<T>(selector);
  }

  querySelectorAll<T extends TestElement = TestElement>(selector: string): T[] {
    return this.documentElement.querySelectorAll<T>(selector);
  }
}

export interface TestDomEnv {
  window: TestWindow;
  document: TestDocument;
  body: TestElement;
  flushEffects: () => void;
  flushRaf: (maxFrames?: number) => number;
  pendingRafCount: () => number;
  rafScheduledCount: () => number;
  resetRafCount: () => void;
  flushMicrotasks: () => Promise<void>;
  restore: () => void;
}

class TestImageData {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}

export function installTestDom(): TestDomEnv {
  const prev = {
    window: globalThis.window,
    document: globalThis.document,
    HTMLElement: globalThis.HTMLElement,
    Element: globalThis.Element,
    Node: globalThis.Node,
    Event: globalThis.Event,
    CustomEvent: globalThis.CustomEvent,
    KeyboardEvent: globalThis.KeyboardEvent,
    FocusEvent: globalThis.FocusEvent,
    ImageData: globalThis.ImageData,
    MutationObserver: globalThis.MutationObserver,
    ResizeObserver: globalThis.ResizeObserver,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    getComputedStyle: globalThis.getComputedStyle,
    localStorage: globalThis.localStorage,
  };

  TestResizeObserver.instances = [];
  const win = new TestWindow();
  const doc = new TestDocument(win);
  let nextRaf = 1;
  let scheduledCount = 0;
  const rafs = new Map<number, (t: number) => void>();
  let now = 16;
  const effectQueue: (() => void)[] = [];

  const flushEffects = (): void => {
    while (effectQueue.length > 0) {
      const batch = effectQueue.splice(0, effectQueue.length);
      for (const fn of batch) fn();
    }
  };

  const raf = (cb: (t: number) => void): number => {
    scheduledCount++;
    const id = nextRaf++;
    rafs.set(id, cb);
    return id;
  };
  const caf = (id: number): void => {
    rafs.delete(id);
  };

  const storage = new Map<string, string>();
  const fakeStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, String(v)),
    removeItem: (k: string) => void storage.delete(k),
    clear: () => storage.clear(),
    key: (i: number) => Array.from(storage.keys())[i] ?? null,
    get length() {
      return storage.size;
    },
  };

  const prevDebounce = preactOptions.debounceRendering;
  const prevPreactRaf = preactOptions.requestAnimationFrame;
  preactOptions.debounceRendering = (cb) => cb();
  preactOptions.requestAnimationFrame = (cb) => {
    effectQueue.push(cb);
  };

  Object.assign(globalThis, {
    window: win,
    document: doc,
    HTMLElement: TestElement,
    Element: TestElement,
    Node: TestNode,
    Event: TestEvent,
    CustomEvent: TestCustomEvent,
    KeyboardEvent: TestKeyboardEvent,
    FocusEvent: TestFocusEvent,
    ImageData: TestImageData,
    MutationObserver: TestMutationObserver,
    ResizeObserver: TestResizeObserver,
    requestAnimationFrame: raf,
    cancelAnimationFrame: caf,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', overflowY: 'auto' }),
    localStorage: fakeStorage,
  });

  return {
    window: win,
    document: doc,
    body: doc.body,
    flushEffects,
    flushRaf(maxFrames = 1): number {
      flushEffects();
      let ran = 0;
      while (ran < maxFrames && rafs.size > 0) {
        const batch = Array.from(rafs.entries());
        rafs.clear();
        now += 16;
        for (const [, cb] of batch) {
          cb(now);
          ran++;
        }
        flushEffects();
      }
      return ran;
    },
    pendingRafCount: () => rafs.size,
    rafScheduledCount: () => scheduledCount,
    resetRafCount: () => {
      scheduledCount = 0;
    },
    flushMicrotasks: async () => {
      flushEffects();
      await Promise.resolve();
      flushEffects();
      await Promise.resolve();
      flushEffects();
      await Promise.resolve();
    },
    restore: () => {
      effectQueue.length = 0;
      if (prevDebounce === undefined) delete preactOptions.debounceRendering;
      else preactOptions.debounceRendering = prevDebounce;
      if (prevPreactRaf === undefined) delete preactOptions.requestAnimationFrame;
      else preactOptions.requestAnimationFrame = prevPreactRaf;
      rafs.clear();
      TestResizeObserver.instances = [];
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete (globalThis as Record<string, unknown>)[k];
        else (globalThis as Record<string, unknown>)[k] = v;
      }
    },
  };
}
