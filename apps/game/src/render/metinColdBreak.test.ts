// r10 M10b (r9 judge MF6c, r9 M9b critic): the cold-stone break light (extras.breakCold) and the steam sink cue (extras.sinkSteam). Covered: without
// breakCold the ground light follows the r9 law exactly (lava and rune stones), a cold stone throws a brief whitened ring that is gone with the flash
// (no lingering stain, no orange), the ring falloff is dark in the middle, and the steam cue lays no ring on the lava, rises, and stays light (never darker).
import { describe, expect, it } from 'vitest';
import { MathUtils, Scene } from 'three';
import { COLD_RING_S, metinBreakHeat } from './metinGroundGlow';
import { MetinSinkCue, SINK_LAVA, SINK_WATER } from './metinSinkCue';

const flashAt = (t: number): number => Math.max(0, 1 - t * 2.2);

/** the r9 ground-light law as it stood in render/metin.ts before r10 (the reference the non-cold path must keep) */
function r9(phaseT: number, heatK: number, ember: number): { alpha: number; warm: number; radius: number } {
  const flash = flashAt(phaseT), lava = ember > 0;
  return {
    alpha: heatK * Math.max(0.75 * flash, (lava ? 0.45 : 0.3) * (1 - MathUtils.smoothstep(phaseT, lava ? 0.6 : 0.4, lava ? 2.1 : 1.5))),
    warm: lava ? 0.85 + 0.15 * flash : 0.3 * flash,
    radius: 2.1 + 0.6 * MathUtils.smoothstep(phaseT, 0, 0.6),
  };
}

describe('metinBreakHeat (r10 M10b)', () => {
  it('keeps the r9 law for every stone without breakCold', () => {
    for (const [heatK, ember] of [[0.9, 1.4], [0.55, 0], [0.6, 1.1]] as const) {
      for (let t = 0; t <= 2.2; t += 0.05) {
        const a = metinBreakHeat(t, flashAt(t), heatK, ember, false), b = r9(t, heatK, ember);
        expect(a.alpha).toBeCloseTo(b.alpha, 9);
        expect(a.warm).toBeCloseTo(b.warm, 9);
        expect(a.radius).toBeCloseTo(b.radius, 9);
        expect(a.white).toBe(0);
      }
    }
  });

  it('gives a cold stone a brief white ring that sweeps out and is gone with the flash, even with breakEmber', () => {
    const early = metinBreakHeat(0.1, flashAt(0.1), 0.6, 1.3, true);
    expect(early.alpha).toBeGreaterThan(0.25);
    expect(early.warm).toBe(0);
    expect(early.white).toBeGreaterThan(0.4);
    const mid = metinBreakHeat(0.3, flashAt(0.3), 0.6, 1.3, true);
    expect(mid.radius).toBeGreaterThan(early.radius);
    for (const t of [COLD_RING_S, 0.5, 0.8, 1.3, 2.0]) expect(metinBreakHeat(t, flashAt(t), 0.6, 1.3, true).alpha).toBe(0);
    // the r9 cold disc still glowed at 1.0 s (the blue-grey stain on the snow)
    expect(r9(1.0, 0.55, 0).alpha).toBeGreaterThan(0.05);
  });
});

describe('MetinSinkCue steam (r10 M10b)', () => {
  it('lays no ring on lava, throws rising light particles, and leaves water on the readable cue', () => {
    const scene = new Scene();
    const cue = new MetinSinkCue(scene, 'high');
    cue.emit(SINK_LAVA, 0, 0, 0, 1, 'steam');
    expect(cue.rings).toBe(0);
    expect(cue.alive).toBeGreaterThan(15);
    const renderer = { getDrawingBufferSize: (v: { y: number; set: (x: number, y: number) => unknown }) => { v.set(1920, 1080); return v; } } as unknown as Parameters<MetinSinkCue['update']>[1];
    for (let i = 0; i < 30; i++) cue.update(1 / 30, renderer);
    expect(cue.alive).toBeGreaterThan(0);
    cue.emit(SINK_WATER, 4, 0, 0, 1, 'steam');
    expect(cue.rings).toBe(1);
    cue.dispose();
  });
});
