import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Input, TouchJoystick, type MoveVector, type UiAction } from './input';

class FakeWindow extends EventTarget {}

function key(win: EventTarget, type: 'keydown' | 'keyup', code: string, extra: Record<string, unknown> = {}): void {
  win.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { code, repeat: false, ctrlKey: false, metaKey: false, altKey: false }, extra));
}

describe('Input', () => {
  let win: FakeWindow;
  let input: Input;
  const prevWindow = (globalThis as { window?: unknown }).window;

  beforeEach(() => {
    win = new FakeWindow();
    (globalThis as { window?: unknown }).window = win;
    input = new Input();
    input.attach();
  });

  afterEach(() => {
    input.detach();
    (globalThis as { window?: unknown }).window = prevWindow;
  });

  it('maps WASD to screen-space axes (up = -z)', () => {
    const v: MoveVector = { x: 0, z: 0 };
    key(win, 'keydown', 'KeyW');
    input.sampleMove(v);
    expect(v).toEqual({ x: 0, z: -1 });
    key(win, 'keydown', 'KeyD');
    input.sampleMove(v);
    expect(v.x).toBeCloseTo(Math.SQRT1_2, 5);
    expect(v.z).toBeCloseTo(-Math.SQRT1_2, 5);
    key(win, 'keyup', 'KeyW');
    key(win, 'keyup', 'KeyD');
    input.sampleMove(v);
    expect(v).toEqual({ x: 0, z: 0 });
  });

  it('opposite keys cancel and arrows work', () => {
    const v: MoveVector = { x: 0, z: 0 };
    key(win, 'keydown', 'ArrowLeft');
    key(win, 'keydown', 'ArrowRight');
    key(win, 'keydown', 'ArrowDown');
    input.sampleMove(v);
    expect(v).toEqual({ x: 0, z: 1 });
  });

  it('blur releases held keys', () => {
    const v: MoveVector = { x: 0, z: 0 };
    key(win, 'keydown', 'KeyA');
    win.dispatchEvent(new Event('blur'));
    input.sampleMove(v);
    expect(v).toEqual({ x: 0, z: 0 });
  });

  it('movementEnabled=false zeroes movement but keeps UI actions', () => {
    const got: UiAction[] = [];
    input.onAction((a) => got.push(a));
    input.movementEnabled = false;
    key(win, 'keydown', 'KeyW');
    key(win, 'keydown', 'Digit2');
    const v: MoveVector = { x: 9, z: 9 };
    input.sampleMove(v);
    expect(v).toEqual({ x: 0, z: 0 });
    expect(got.some((a) => a.kind === 'card' && a.index === 1)).toBe(true);
  });

  it('emits shortcut actions and ignores modified keys', () => {
    const got: UiAction[] = [];
    input.onAction((a) => got.push(a));
    key(win, 'keydown', 'KeyR');
    key(win, 'keydown', 'Escape');
    key(win, 'keydown', 'Enter');
    key(win, 'keydown', 'KeyR', { ctrlKey: true });
    expect(got.map((a) => a.kind)).toEqual(['reroll', 'cancel', 'confirm']);
  });

  it('touch joystick adds to the move vector and clamps to the unit disc', () => {
    const v: MoveVector = { x: 0, z: 0 };
    const touch: TouchJoystick = input.touch;
    touch.set(3, 4);
    input.sampleMove(v);
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(1, 5);
    expect(v.x).toBeCloseTo(0.6, 5);
    key(win, 'keydown', 'KeyD');
    input.sampleMove(v);
    expect(Math.hypot(v.x, v.z)).toBeLessThanOrEqual(1.0000001);
  });
});
