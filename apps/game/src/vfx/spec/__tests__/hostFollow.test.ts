// SIM-11: eagle_eye persistent selfBuff VFX follows its caster, and SpecHost binds follow directly to meta.caster
// (even when two co-op heroes overlap at cast time).

import { DataTexture, Scene, type WebGLRenderer } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { Ctx, type Fx } from '../../emit';
import { BLADE_SPECS } from '../../skills/ninja/blade';
import { VRng } from '../../util';
import { SpecHost } from '../host';
import type { FxSpec } from '../types';

vi.mock('../atlas', () => ({ bakeSpecAtlas: () => ({ texture: null, dispose: () => undefined }) }));

function eagleEyeSpec(): FxSpec {
  const s = BLADE_SPECS.find((sp) => sp.id === 'sk.eagle_eye');
  if (!s) throw new Error('sk.eagle_eye spec missing');
  return s;
}

function makeHost(): { h: SpecHost; fx: Fx; anchorPos: (handle: number) => [number, number, number] } {
  const fx = { time: 0, rng: new VRng(13), density: 1, budget: 1e9, spawned: 0, dropped: 0, heightAt: () => 0 } as unknown as Fx;
  const h = new SpecHost(new Scene(), {} as WebGLRenderer, { value: 0 }, fx, 3, 10, []);
  const tex = h.uniforms.uAnchors.value;
  if (!(tex instanceof DataTexture) || !(tex.image.data instanceof Float32Array)) {
    throw new Error('anchor texture: float DataTexture expected');
  }
  const data = tex.image.data;
  const anchorPos = (handle: number): [number, number, number] => {
    const o = (handle & 255) * 4;
    return [data[o] as number, data[o + 1] as number, data[o + 2] as number];
  };
  return { h, fx, anchorPos };
}

describe('SpecHost follow binding & sk.eagle_eye (SIM-11)', () => {
  it('sk.eagle_eye sets follow=true, tracks a moving solo caster throughout its buff duration, and clears on expiry', () => {
    const spec = eagleEyeSpec();
    expect(spec.follow).toBe(true);

    const { h, fx, anchorPos } = makeHost();
    const players = new Float32Array([0, 0, 0]);
    h.followSrc = { players, playerCount: 1 };

    const c = new Ctx();
    c.x = 0;
    c.y = 0;
    c.z = 0;
    c.duration = 2;
    const handle = h.play(spec, c, false, { rank: 0, awakened: false, caster: 0 });
    expect(h.alive(handle)).toBe(true);

    // hero runs from (0, 0) to (6, -3) while buff is active
    players[0] = 6;
    players[2] = -3;
    fx.time += 0.1;
    h.update(0.1);
    const [ax, , az] = anchorPos(handle);
    expect(ax).toBeCloseTo(6, 4);
    expect(az).toBeCloseTo(-3, 4);
    expect(h.alive(handle)).toBe(true);

    // advance well past duration + particle tail so the effect drains cleanly
    for (let i = 0; i < 60; i++) {
      fx.time += 0.1;
      h.update(0.1);
    }
    expect(h.alive(handle)).toBe(false);
  });

  it('binds follow explicitly to meta.caster when two co-op players are co-located at cast time', () => {
    const spec = eagleEyeSpec();
    const { h, fx, anchorPos } = makeHost();
    // player 0 and player 1 stand on the exact same spot (0, 0, 0) when player 1 casts
    const players = new Float32Array([0, 0, 0, 0, 0, 0]);
    h.followSrc = { players, playerCount: 2 };

    const c = new Ctx();
    c.x = 0;
    c.y = 0;
    c.z = 0;
    c.duration = 4;
    const handle = h.play(spec, c, false, { rank: 0, awakened: false, caster: 1 });

    // players separate in opposite directions
    players[0] = 10;
    players[2] = 0;
    players[3] = -7;
    players[5] = 4;
    fx.time += 0.05;
    h.update(0.05);

    const [ax, , az] = anchorPos(handle);
    expect(ax).toBeCloseTo(-7, 4);
    expect(az).toBeCloseTo(4, 4);
  });

  it('falls back to nearest player when caster is unspecified (-1)', () => {
    const spec = eagleEyeSpec();
    const { h, fx, anchorPos } = makeHost();
    const players = new Float32Array([10, 0, 10, 0.2, 0, -0.1]);
    h.followSrc = { players, playerCount: 2 };

    const c = new Ctx();
    c.x = 0;
    c.y = 0;
    c.z = 0;
    c.duration = 4;
    const handle = h.play(spec, c, false, { rank: 0, awakened: false, caster: -1 });

    players[3] = 3.5;
    players[5] = -2.5;
    fx.time += 0.05;
    h.update(0.05);

    const [ax, , az] = anchorPos(handle);
    expect(ax).toBeCloseTo(3.5, 4);
    expect(az).toBeCloseTo(-2.5, 4);
  });
});
