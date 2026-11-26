import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { isFlameSocketName, socketFlames } from './b_fire';

describe('E2 flame sockets of GLB props', () => {
  it('recognises the empty-node names flame, flame_1, flame.001 and nothing else', () => {
    for (const n of ['flame', 'Flame', 'flame_1', 'flame_12', 'flame.001', 'flame2']) expect(isFlameSocketName(n)).toBe(true);
    for (const n of ['flames', 'flame_a', 'brazier_flame', 'campfire', '', 'prop_brazier']) expect(isFlameSocketName(n)).toBe(false);
  });
  it('no socket = no flame (today\'s GLBs are untouched)', () => {
    expect(socketFlames('brazier', [])).toBeNull();
  });
  it('one additive part per prop with every socket merged, and an update hook', () => {
    const one = socketFlames('brazier', [new Vector3(0, 1, 0)]);
    const two = socketFlames('brazier', [new Vector3(0, 1, 0), new Vector3(2, 1, 0)]);
    expect(one).not.toBeNull();
    expect(two).not.toBeNull();
    // 3 cards + 2 glows per socket, 4 vertices each
    expect(one?.part.geometry.getAttribute('position').count).toBe(5 * 4);
    expect(two?.part.geometry.getAttribute('position').count).toBe(10 * 4);
    expect(one?.part.castShadow).toBe(false);
    expect(() => one?.update(1.5)).not.toThrow();
  });
  it('the cards of a socket sit on it, the ground glow on the prop ground', () => {
    const f = socketFlames('bonfire', [new Vector3(3, 0.5, -2)]);
    const pos = f?.part.geometry.getAttribute('position');
    expect(pos).toBeDefined();
    if (!pos) return;
    // first card: billboards collapse onto the anchor point
    expect(pos.getX(0)).toBeCloseTo(3, 5);
    expect(pos.getY(0)).toBeCloseTo(0.52, 5);
    expect(pos.getZ(0)).toBeCloseTo(-2, 5);
    // bonfire preset: 5 cards, then the ground glow (a real quad on y = 0.04) and the halo
    const g = 5 * 4;
    expect(pos.getY(g)).toBeCloseTo(0.04, 5);
  });
  it('the plague brazier takes the green palette, other ids the fire palette', () => {
    const plague = socketFlames('plague_brazier', [new Vector3()]);
    const fire = socketFlames('fire_altar', [new Vector3()]);
    const c0 = (m: unknown): number => ((m as { uniforms: { uC0: { value: { g: number } } } }).uniforms.uC0.value.g);
    expect(c0(plague?.part.material)).not.toBeCloseTo(c0(fire?.part.material), 3);
  });
});
