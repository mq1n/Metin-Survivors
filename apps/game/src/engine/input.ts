// Input: keyboard (WASD/arrows), gamepad left stick, touch virtual joystick → one move vector; plus UI action events
// (card picks 1-4, reroll, banish, skip, confirm, cancel/pause, navigation, F3 perf) from keyboard and gamepad.
//
// Move vector convention (matches the camera): x = screen-right (+X world), z = screen-down (+Z world); W moves z = -1.
import { signal, type ReadonlySignal } from '@preact/signals';

export interface MoveVector {
  x: number;
  z: number;
}

export type UiActionKind =
  | 'card'
  | 'reroll'
  | 'banish'
  | 'skip'
  | 'confirm'
  | 'cancel'
  | 'pause'
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'perf'
  | 'dev';

export interface UiAction {
  kind: UiActionKind;
  /** card index 0..3 for kind 'card' */
  index: number;
  repeat: boolean;
  source: 'keyboard' | 'gamepad';
}

export interface JoystickState {
  active: boolean;
  /** CSS px, viewport coordinates */
  baseX: number;
  baseY: number;
  knobX: number;
  knobY: number;
  /** normalised −1..1 (x right, y down) */
  x: number;
  y: number;
  radius: number;
}

const IDLE_STICK: JoystickState = { active: false, baseX: 0, baseY: 0, knobX: 0, knobY: 0, x: 0, y: 0, radius: 64 };

const KEY_ACTIONS: Record<string, { kind: UiActionKind; index?: number }> = {
  Digit1: { kind: 'card', index: 0 },
  Digit2: { kind: 'card', index: 1 },
  Digit3: { kind: 'card', index: 2 },
  Digit4: { kind: 'card', index: 3 },
  Numpad1: { kind: 'card', index: 0 },
  Numpad2: { kind: 'card', index: 1 },
  Numpad3: { kind: 'card', index: 2 },
  Numpad4: { kind: 'card', index: 3 },
  KeyR: { kind: 'reroll' },
  KeyB: { kind: 'banish' },
  KeyX: { kind: 'skip' },
  Enter: { kind: 'confirm' },
  NumpadEnter: { kind: 'confirm' },
  Space: { kind: 'confirm' },
  Escape: { kind: 'cancel' },
  KeyP: { kind: 'pause' },
  ArrowLeft: { kind: 'left' },
  ArrowRight: { kind: 'right' },
  ArrowUp: { kind: 'up' },
  ArrowDown: { kind: 'down' },
  F3: { kind: 'perf' },
  Backquote: { kind: 'dev' },
};

// Standard gamepad mapping button → action
const PAD_ACTIONS: Array<[number, UiActionKind, number]> = [
  [0, 'confirm', 0],
  [1, 'cancel', 0],
  [2, 'banish', 0],
  [3, 'reroll', 0],
  [4, 'left', 0],
  [5, 'right', 0],
  [9, 'pause', 0],
  [12, 'up', 0],
  [13, 'down', 0],
  [14, 'left', 0],
  [15, 'right', 0],
];

const STICK_DEADZONE = 0.18;

const SKILL_KEYS: Record<string, number> = {
  Digit1: 0,
  Digit2: 1,
  Digit3: 2,
  Digit4: 3,
  Digit5: 4,
  Digit6: 5,
  Digit7: 6,
  Digit8: 7,
  Digit9: 8,
  Digit0: 9,
  Numpad1: 0,
  Numpad2: 1,
  Numpad3: 2,
  Numpad4: 3,
  Numpad5: 4,
  Numpad6: 5,
  Numpad7: 6,
  Numpad8: 7,
  Numpad9: 8,
  Numpad0: 9,
};

function isUiClickTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  return el.closest('button, a, input, textarea, select, [data-block], .ms-modal, .ms-tb, .ms-mm, .ms-bb, .ms-atlas, .ms-slot') !== null;
}

function isTextTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

/** Floating virtual joystick bound to a DOM element (touch/pen). The UI renders it from `state`. */
export class TouchJoystick {
  private readonly sig = signal<JoystickState>(IDLE_STICK);
  readonly state: ReadonlySignal<JoystickState> = this.sig;
  /** current normalised vector; read by Input.sampleMove */
  x = 0;
  y = 0;
  radius = 64;
  /** fraction of the element width (from the left) where a new stick may start */
  zoneFraction = 0.6;

  private pointerId = -1;
  private baseX = 0;
  private baseY = 0;
  private el: HTMLElement | null = null;

  attach(el: HTMLElement): void {
    this.detach();
    this.el = el;
    el.addEventListener('pointerdown', this.down);
    el.addEventListener('pointermove', this.move);
    el.addEventListener('pointerup', this.up);
    el.addEventListener('pointercancel', this.up);
    el.addEventListener('lostpointercapture', this.up);
  }

  detach(): void {
    const el = this.el;
    if (!el) return;
    el.removeEventListener('pointerdown', this.down);
    el.removeEventListener('pointermove', this.move);
    el.removeEventListener('pointerup', this.up);
    el.removeEventListener('pointercancel', this.up);
    el.removeEventListener('lostpointercapture', this.up);
    this.el = null;
    this.release();
  }

  /** Programmatic stick (tests, accessibility remappers). Values clamp to the unit disc. */
  set(x: number, y: number): void {
    const len = Math.hypot(x, y);
    const k = len > 1 ? 1 / len : 1;
    this.x = x * k;
    this.y = y * k;
  }

  private readonly down = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' || this.pointerId !== -1) return;
    const rect = this.el?.getBoundingClientRect();
    if (rect && e.clientX - rect.left > rect.width * this.zoneFraction) return;
    this.pointerId = e.pointerId;
    this.baseX = e.clientX;
    this.baseY = e.clientY;
    this.el?.setPointerCapture(e.pointerId);
    this.publish(e.clientX, e.clientY, true);
  };

  private readonly move = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.publish(e.clientX, e.clientY, true);
  };

  private readonly up = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.release();
  };

  private publish(px: number, py: number, active: boolean): void {
    let dx = px - this.baseX;
    let dy = py - this.baseY;
    const len = Math.hypot(dx, dy);
    if (len > this.radius) {
      // drag the base along so direction changes stay responsive
      const over = len - this.radius;
      this.baseX += (dx / len) * over;
      this.baseY += (dy / len) * over;
      dx = px - this.baseX;
      dy = py - this.baseY;
    }
    const nx = dx / this.radius;
    const ny = dy / this.radius;
    const m = Math.hypot(nx, ny);
    const dead = 0.12;
    const scale = m < dead ? 0 : Math.min(1, (m - dead) / (1 - dead)) / m;
    this.x = nx * scale;
    this.y = ny * scale;
    this.sig.value = {
      active,
      baseX: this.baseX,
      baseY: this.baseY,
      knobX: this.baseX + dx,
      knobY: this.baseY + dy,
      x: this.x,
      y: this.y,
      radius: this.radius,
    };
  }

  release(): void {
    if (this.pointerId !== -1 && this.el?.hasPointerCapture(this.pointerId)) this.el.releasePointerCapture(this.pointerId);
    this.pointerId = -1;
    this.x = 0;
    this.y = 0;
    this.sig.value = { ...IDLE_STICK, radius: this.radius };
  }
}

export class Input {
  readonly touch = new TouchJoystick();
  /** true after the first touch pointer was seen; UI uses it to show the joystick */
  readonly touchSeen = signal(false);
  private readonly held = new Set<string>();
  private readonly listeners = new Set<(a: UiAction) => void>();
  private readonly padPrev: boolean[] = [];
  private attached = false;
  private mouseAttack = false;
  private pendingAttack = false;
  private pointerX = 0;
  private pointerY = 0;
  private pointerSeen = false;
  private pendingCastMask = 0;
  private _movementEnabled = true;
  /** when false (modal open, pause, menus) movement samples as zero, queued combat inputs are cleared, and UI actions still fire */
  get movementEnabled(): boolean {
    return this._movementEnabled;
  }
  set movementEnabled(v: boolean) {
    if (this._movementEnabled === v) return;
    this._movementEnabled = v;
    if (!v) {
      this.mouseAttack = false;
      this.pendingAttack = false;
      this.pendingCastMask = 0;
      this.touch.release();
    }
  }

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('pointerdown', this.onPointer, { passive: true });
    window.addEventListener('pointermove', this.onPointerMove, { passive: true });
    window.addEventListener('pointerup', this.onPointerUp, { passive: true });
    window.addEventListener('pointercancel', this.onPointerUp, { passive: true });
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('pointerdown', this.onPointer);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    this.held.clear();
    this.mouseAttack = false;
    this.pendingAttack = false;
    this.pendingCastMask = 0;
    this.touch.detach();
  }

  /** True when the player is actively triggering manual basic attack (Space or LMB on the world). */
  isAttackHeld(): boolean {
    return this.movementEnabled && (this.held.has('Space') || this.mouseAttack);
  }

  /** True when basic attack is held OR was clicked/tapped since the previous simulation tick (prevents dropped quick clicks). */
  consumeAttackRequested(): boolean {
    if (!this.movementEnabled) {
      this.pendingAttack = false;
      return false;
    }
    const req = this.held.has('Space') || this.mouseAttack || this.pendingAttack;
    this.pendingAttack = false;
    return req;
  }

  /** True specifically when left mouse button is held on the game world (enables cursor raycast aim). */
  isMouseAttackHeld(): boolean {
    return this.movementEnabled && this.mouseAttack;
  }

  /** Last known mouse client coordinates, or null before any mouse pointer event. */
  pointerClient(): { x: number; y: number } | null {
    return this.pointerSeen ? { x: this.pointerX, y: this.pointerY } : null;
  }

  /** Queues a manual cast of taskbar slot `index` (0 = basic / hotkey 1, 1..7 = active / ultimate skills). */
  triggerSkillSlot(index: number): void {
    if (!this.movementEnabled || index < 0 || index >= 30) return;
    this.pendingCastMask |= 1 << index;
  }

  /** Reads and clears queued manual skill-slot casts for this simulation tick. */
  consumeCastMask(): number {
    if (!this.movementEnabled) {
      this.pendingCastMask = 0;
      return 0;
    }
    const mask = this.pendingCastMask;
    this.pendingCastMask = 0;
    return mask;
  }

  /** Subscribe to UI actions. Returns an unsubscribe function. */
  onAction(fn: (a: UiAction) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  isHeld(code: string): boolean {
    return this.held.has(code);
  }

  /** Combines keyboard, gamepad and touch into `out` (length ≤ 1). Call once per sim tick. */
  sampleMove(out: MoveVector): MoveVector {
    let x = 0;
    let z = 0;
    if (this.movementEnabled) {
      const h = this.held;
      if (h.has('KeyA') || h.has('ArrowLeft')) x -= 1;
      if (h.has('KeyD') || h.has('ArrowRight')) x += 1;
      if (h.has('KeyW') || h.has('ArrowUp')) z -= 1;
      if (h.has('KeyS') || h.has('ArrowDown')) z += 1;
      const kl = Math.hypot(x, z);
      if (kl > 1) {
        x /= kl;
        z /= kl;
      }
      const pad = this.activePad();
      if (pad) {
        let ax = pad.axes[0] ?? 0;
        let ay = pad.axes[1] ?? 0;
        const len = Math.hypot(ax, ay);
        if (len < STICK_DEADZONE) {
          ax = 0;
          ay = 0;
        } else {
          const s = Math.min(1, (len - STICK_DEADZONE) / (1 - STICK_DEADZONE)) / len;
          ax *= s;
          ay *= s;
        }
        x += ax;
        z += ay;
      }
      x += this.touch.x;
      z += this.touch.y;
      const len = Math.hypot(x, z);
      if (len > 1) {
        x /= len;
        z /= len;
      }
    }
    out.x = x;
    out.z = z;
    return out;
  }

  /** Polls gamepad buttons for UI actions; call once per rendered frame. */
  pollGamepad(): void {
    const pad = this.activePad();
    if (!pad) return;
    for (const [btn, kind, index] of PAD_ACTIONS) {
      const down = pad.buttons[btn]?.pressed ?? false;
      if (down && !this.padPrev[btn]) this.emit({ kind, index, repeat: false, source: 'gamepad' });
      this.padPrev[btn] = down;
    }
  }

  private activePad(): Gamepad | null {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    for (const p of navigator.getGamepads()) if (p?.connected) return p;
    return null;
  }

  private emit(a: UiAction): void {
    for (const fn of this.listeners) fn(a);
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (isTextTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (this.movementEnabled && !e.repeat) {
      if (e.code === 'Space') this.pendingAttack = true;
      const slot = SKILL_KEYS[e.code];
      if (slot !== undefined) this.pendingCastMask |= 1 << slot;
    }
    const map = KEY_ACTIONS[e.code];
    if (map) {
      if (e.code === 'F3' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      // In active gameplay, Space is basic attack rather than UI confirm so focused HUD controls are never accidentally activated.
      if (!(this.movementEnabled && e.code === 'Space')) {
        this.emit({ kind: map.kind, index: map.index ?? 0, repeat: e.repeat, source: 'keyboard' });
      }
    }
    this.held.add(e.code);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.held.delete(e.code);
  };

  private readonly onBlur = (): void => {
    this.held.clear();
    this.mouseAttack = false;
    this.pendingAttack = false;
    this.pendingCastMask = 0;
    this.touch.release();
  };

  private readonly onPointer = (e: PointerEvent): void => {
    if (e.pointerType === 'touch' && !this.touchSeen.value) this.touchSeen.value = true;
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') {
      this.pointerX = e.clientX;
      this.pointerY = e.clientY;
      this.pointerSeen = true;
      if (e.button === 0 && this.movementEnabled && !isUiClickTarget(e.target)) {
        this.mouseAttack = true;
        this.pendingAttack = true;
        if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
      }
    }
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') {
      this.pointerX = e.clientX;
      this.pointerY = e.clientY;
      this.pointerSeen = true;
    }
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen' && (e.button === 0 || (e.buttons & 1) === 0)) {
      this.mouseAttack = false;
    }
  };
}
