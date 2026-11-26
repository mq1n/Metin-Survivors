// Hero-select turntable (T12 stage), UI-side fallback until core's HeroStage kit (C10, app/heroPreview.ts) lands.
//
// app/heroPreview.ts spins the hero forever (0.35 rad/s), so the back or the profile is on screen about half the time.
// A character-select stage shows the figure facing the viewer. This adapter wraps the handle that `mount` returned and
// takes over the yaw WITHOUT touching core: heroPreview stops auto-spinning while a pointer is "dragging" and adds
// 0.012 rad per CSS px of pointer movement, so one synthetic pointerdown holds it and synthetic pointermoves steer it.
//   · rest pose = a slight 3/4 turn toward the viewer's right, with a slow sway (the figure is alive, never a statue);
//   · class change = the new figure swings in from ~65 degrees and settles on the rest pose (hides behind the CSS swap fade);
//   · a real drag works as before; 3 s after the release the figure eases back to the nearest rest pose;
//   · reduced motion = rest pose only, no sway.
// Synthetic events do not bubble (no window listener hears them: nav / input / tooltip stay untouched) and are never
// `isTrusted`, so the adapter ignores its own events. If core ships C10 the mount call in HeroSelect.tsx loses this wrapper.
import type { HeroPreviewHandle, HeroPreviewSelection } from '../env';

export const TWO_PI = Math.PI * 2;
/** heroPreview.ts: yaw starts here (rad) */
export const PREVIEW_YAW0 = 0.35;
/** heroPreview.ts: rad added per CSS px of horizontal drag */
export const PREVIEW_DRAG_K = 0.012;
/** how far (rad) the rest pose is turned off the model's own front, so the weapon side shows (3/4 view) */
export const REST_TURN = 0.3;
/** yaw at which each model looks into the camera (heroPreview's camera is on +z; the models are not authored alike) */
export const FRONT_YAW: Record<string, number> = {};
export const frontOf = (classId: string, sex: string): number => FRONT_YAW[`${classId}_${sex}`] ?? 0;
export const restOf = (classId: string, sex: string): number => frontOf(classId, sex) + REST_TURN;
/** default rest, kept for the pure helpers */
export const REST_YAW = REST_TURN;
/** sway amplitude (rad) and angular speed (rad/s of the sine) */
export const SWAY = 0.13;
export const SWAY_W = 0.85;
/** seconds the figure stays where the user left it before easing home */
export const IDLE_RETURN_S = 3;
/** class change: the figure starts this far (rad) from the rest pose and swings in over SWING_MS */
export const SWING_FROM = 1.15;
export const SWING_MS = 1100;

/** The rest pose closest to `yaw` (the figure may have been dragged through several turns). */
export function nearestRest(yaw: number, rest: number = REST_YAW): number {
  return rest + TWO_PI * Math.round((yaw - rest) / TWO_PI);
}

/** Sway offset at time `t` seconds. */
export function swayAt(t: number, amp: number = SWAY): number {
  return amp * Math.sin(t * SWAY_W);
}

/** Frame-rate independent exponential approach (rate in 1/s). */
export function approach(cur: number, target: number, dt: number, rate: number): number {
  return cur + (target - cur) * (1 - Math.exp(-rate * dt));
}

/** Eased swing-in: from `from` at k = 0 to `rest` at k = 1 (ease-out cubic). */
export function swingAt(k: number, from: number, rest: number = REST_YAW): number {
  const c = Math.min(1, Math.max(0, k));
  const e = 1 - (1 - c) ** 3;
  return from + (rest - from) * e;
}

export function attachTurntable(container: HTMLElement, handle: HeroPreviewHandle, first: Pick<HeroPreviewSelection, 'classId' | 'sex'>): HeroPreviewHandle {
  const canvas = container.querySelector('canvas');
  if (!canvas || typeof PointerEvent === 'undefined') return handle;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rec = canvas as unknown as Record<string, unknown>;
  let yaw = PREVIEW_YAW0; // our mirror of heroPreview's yaw (nothing has spun it yet: the first frame comes after mount returns)
  let px = 0; // the virtual pointer x we feed (heroPreview only looks at differences)
  let user = false;
  let userX = 0;
  let idleSince = -1e9;
  let cls = first.classId;
  let sex = first.sex;
  let rest = restOf(cls, sex);
  // entrance: the figure turns to face the viewer while its model loads (the canvas is empty until then)
  let swing: { t0: number; from: number } | null = reduced ? null : { t0: performance.now(), from: rest + 0.9 };
  let disposed = false;
  let raf = 0;
  const born = performance.now();
  let last = born;

  /** dispatch one synthetic pointer event to the canvas; returns the clientX the listeners will see */
  const fire = (type: 'pointerdown' | 'pointermove', x: number): number => {
    // heroPreview calls setPointerCapture on pointerdown: a synthetic pointer id has none, so no-op it for this dispatch
    rec['setPointerCapture'] = () => {};
    rec['releasePointerCapture'] = () => {};
    try {
      const ev = new PointerEvent(type, { pointerId: 9731, pointerType: 'mouse', isPrimary: false, clientX: x, clientY: 0, bubbles: false, cancelable: false });
      canvas.dispatchEvent(ev);
      return ev.clientX;
    } finally {
      delete rec['setPointerCapture'];
      delete rec['releasePointerCapture'];
    }
  };
  const hold = (): void => {
    px = fire('pointerdown', px);
    canvas.style.cursor = 'grab';
  };
  hold();

  const onDown = (e: PointerEvent): void => {
    if (!e.isTrusted) return;
    user = true;
    userX = e.clientX;
    swing = null;
  };
  const onMove = (e: PointerEvent): void => {
    if (!e.isTrusted || !user) return;
    yaw += (e.clientX - userX) * PREVIEW_DRAG_K;
    userX = e.clientX;
  };
  const onUp = (e: PointerEvent): void => {
    if (!e.isTrusted || !user) return;
    user = false;
    idleSince = performance.now();
    hold(); // heroPreview's own pointerup just released the drag: grab it again
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  const frame = (now: number): void => {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (user) return;
    let next = yaw;
    const forced = import.meta.env.DEV ? (window as unknown as { __hsYaw?: number }).__hsYaw : undefined; // QA: pin the yaw
    if (typeof forced === 'number') {
      next = approach(yaw, forced, dt, 24);
    } else if (swing) {
      const k = (now - swing.t0) / SWING_MS;
      next = swingAt(k, swing.from, rest);
      if (k >= 1) swing = null;
    } else if (now - idleSince >= IDLE_RETURN_S * 1000) {
      const target = nearestRest(yaw, rest) + (reduced ? 0 : swayAt((now - born) / 1000));
      next = approach(yaw, target, dt, reduced ? 4 : 3);
    }
    if (import.meta.env.DEV) (window as unknown as { __hsTurn?: unknown }).__hsTurn = { yaw, rest, px, swing: swing !== null, user };
    if (Math.abs(next - yaw) < 1e-5) return;
    const to = fire('pointermove', px + (next - yaw) / PREVIEW_DRAG_K);
    yaw += (to - px) * PREVIEW_DRAG_K;
    px = to;
  };
  raf = requestAnimationFrame(frame);

  return {
    update(sel: HeroPreviewSelection): void {
      if (sel.classId !== cls || sel.sex !== sex) {
        const classChanged = sel.classId !== cls;
        cls = sel.classId;
        sex = sel.sex;
        rest = restOf(cls, sex);
        // a class change swings the new figure in; a sex change only re-seats it (the model pops, as before)
        if (!reduced) swing = { t0: performance.now(), from: rest + (classChanged ? SWING_FROM : 0.45) };
      }
      handle.update(sel);
    },
    dispose(): void {
      disposed = true;
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      handle.dispose();
    },
  };
}
