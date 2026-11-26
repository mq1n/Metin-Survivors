import { describe, expect, it } from 'vitest';
import { CameraRig } from './camera';
import { AutoQuality, QUALITY_PROFILES, QualityState } from './quality';

/** Feeds `seconds` of frames of `dt` seconds each (a real clock is not needed: the governor sums the frame times). */
function feed(gov: AutoQuality, seconds: number, dt: number): void {
  const n = Math.ceil(seconds / dt - 1e-9);
  for (let i = 0; i < n; i++) gov.frame(dt);
}

/** Plays out the 8 s grace after a reset with healthy frames (512 x 1/64 s: exact, the next window starts clean). */
function warm(gov: AutoQuality): void {
  feed(gov, 8, 1 / 64);
}

// Binary-exact frame times: 16 x 0.0625 s and 64 x 0.015625 s are exactly one second, so a window closes on a known frame.
const SLOW = 0.0625;
const FAST = 0.015625;

describe('AutoQuality', () => {
  it('drops one tier after three consecutive slow seconds', () => {
    const state = new QualityState('ultra');
    const gov = new AutoQuality(state);
    warm(gov);
    const seen: string[] = [];
    state.onChange((p) => seen.push(p.tier));
    // 3 seconds of 30 ms frames
    for (let i = 0; i < 110; i++) gov.frame(0.03);
    expect(state.tier).toBe('high');
    expect(seen).toEqual(['high']);
  });

  it('a sustained 25 ms median still drops after 3 s and not before', () => {
    const state = new QualityState('high');
    const gov = new AutoQuality(state);
    warm(gov);
    feed(gov, 2.5, 0.025);
    expect(state.tier).toBe('high');
    feed(gov, 1.2, 0.025);
    expect(state.tier).toBe('medium');
  });

  it('a sustained 15 ms (and 19 ms) median never drops', () => {
    for (const dt of [0.015, 0.019]) {
      const state = new QualityState('high');
      const gov = new AutoQuality(state);
      warm(gov);
      feed(gov, 120, dt);
      expect(state.tier).toBe('high');
    }
  });

  it('does not react to short hitches or fast frames', () => {
    const state = new QualityState('high');
    const gov = new AutoQuality(state);
    warm(gov);
    for (let s = 0; s < 6; s++) {
      for (let i = 0; i < 60; i++) gov.frame(i === 0 ? 0.1 : 0.0165);
    }
    expect(state.tier).toBe('high');
  });

  it('a recovered second resets the counter and low is the floor', () => {
    const state = new QualityState('low');
    const gov = new AutoQuality(state);
    warm(gov);
    for (let i = 0; i < 400; i++) gov.frame(0.05);
    expect(state.tier).toBe('low');
    const s2 = new QualityState('medium');
    const g2 = new AutoQuality(s2);
    warm(g2);
    for (let i = 0; i < 70; i++) g2.frame(0.03); // 2.1 s bad
    for (let i = 0; i < 70; i++) g2.frame(0.0165); // 1.2 s good
    for (let i = 0; i < 70; i++) g2.frame(0.03); // 2.1 s bad
    expect(s2.tier).toBe('medium');
  });

  describe('run-start grace', () => {
    it('slow loading frames in the first 8 s never drop the tier', () => {
      const state = new QualityState('high');
      const gov = new AutoQuality(state);
      feed(gov, 7.5, 0.04); // texture uploads / compiles at the start of the run
      expect(state.tier).toBe('high');
      feed(gov, 60, 0.0165);
      expect(state.tier).toBe('high');
    });

    it('the grace is 8 s, not forever: the same slow frames drop once it is over', () => {
      const state = new QualityState('high');
      const gov = new AutoQuality(state);
      feed(gov, 8.2, 0.04); // grace
      expect(state.tier).toBe('high');
      feed(gov, 3.3, 0.04); // sustained
      expect(state.tier).toBe('medium');
    });

    it('reset() starts the grace again (settings back to auto, run start)', () => {
      const state = new QualityState('high');
      const gov = new AutoQuality(state);
      warm(gov);
      gov.reset();
      feed(gov, 7.5, 0.04);
      expect(state.tier).toBe('high');
      gov.reset();
      feed(gov, 8.2 + 3.3, 0.04);
      expect(state.tier).toBe('medium');
    });

    it('slow frames before the reset do not count toward a drop after it', () => {
      const state = new QualityState('high');
      const gov = new AutoQuality(state);
      warm(gov);
      feed(gov, 2, SLOW); // two slow windows
      gov.reset();
      warm(gov);
      feed(gov, 1, SLOW); // one slow window: 1 of 3
      expect(state.tier).toBe('high');
    });

    it('a gap in the feed (menu, loading, results) followed by frames starts a new grace; a long frame is not a gap', () => {
      let wall = 0;
      const clock = (): number => wall;
      const step = (gov: AutoQuality, seconds: number, dt: number): void => {
        const n = Math.ceil(seconds / dt - 1e-9);
        for (let i = 0; i < n; i++) {
          wall += dt * 1000;
          gov.frame(dt);
        }
      };
      // control: no gap, 30 ms frames after the first run's grace drop
      const a = new QualityState('high');
      const ga = new AutoQuality(a, clock);
      step(ga, 8, 1 / 64);
      step(ga, 3.3, 0.03);
      expect(a.tier).toBe('medium');
      // second run: 40 s of menu / loading without frames, then slow frames at its start
      const b = new QualityState('high');
      const gb = new AutoQuality(b, clock);
      step(gb, 8, 1 / 64);
      wall += 40_000;
      step(gb, 7.5, 0.03);
      expect(b.tier).toBe('high');
      step(gb, 10, 1 / 64);
      expect(b.tier).toBe('high');
      // a stall frame that reports its own length (a harness that does not clamp) leaves no gap: the grace is not restarted
      const c = new QualityState('high');
      const gc = new AutoQuality(c, clock);
      step(gc, 8, 1 / 64);
      step(gc, 5, 5);
      step(gc, 3.3, 0.03);
      expect(c.tier).toBe('medium');
      // the game: a 5 s freeze arrives as one 0.25 s frame (engine/loop.ts clamps) while the wall clock moved 5 s -> a new grace,
      // so the slow catch-up frames after it do not count; once the grace is over sustained load drops again
      const d = new QualityState('high');
      const gd = new AutoQuality(d, clock);
      step(gd, 8, 1 / 64);
      wall += 5000;
      gd.frame(0.25);
      step(gd, 7.5, 0.03);
      expect(d.tier).toBe('high');
      step(gd, 1, 0.03);
      step(gd, 3.3, 0.03);
      expect(d.tier).toBe('medium');
    });
  });

  describe('stalls', () => {
    it('a 5 s stall (one frame, or half-second frames) never drops the tier', () => {
      for (const frames of [[5], [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], [1.2, 1.2, 1.2, 1.2]]) {
        const state = new QualityState('high');
        const gov = new AutoQuality(state);
        warm(gov);
        for (const f of frames) gov.frame(f);
        feed(gov, 30, 1 / 60);
        expect(state.tier).toBe('high');
      }
    });

    it('a stall in the first seconds of a run (the 5 s run-start freeze) never drops the tier', () => {
      const state = new QualityState('high');
      const gov = new AutoQuality(state);
      gov.frame(5); // first frame of the run
      feed(gov, 30, 1 / 60);
      for (let i = 0; i < 8; i++) gov.frame(0.5); // chugging while the zone streams in
      feed(gov, 30, 1 / 60);
      expect(state.tier).toBe('high');
    });

    it('stalls above 250 ms are ignored even when the rest of the window is slow', () => {
      const state = new QualityState('high');
      const gov = new AutoQuality(state);
      warm(gov);
      // six windows of "one 0.3 s frame + 40 ms frames": slow median, but each contains a stall
      for (let w = 0; w < 6; w++) {
        gov.frame(0.3);
        feed(gov, 0.7, 0.04);
      }
      expect(state.tier).toBe('high');
    });

    it('the fixed loop clamps every frame delta at 0.25 s: a frame of exactly 0.25 is a stall, 0.2 s frames are load', () => {
      const a = new QualityState('high');
      const ga = new AutoQuality(a);
      warm(ga);
      feed(ga, 8, 0.25); // 5 s ... 8 s freezes as the render callback sees them
      expect(a.tier).toBe('high');
      const b = new QualityState('high');
      const gb = new AutoQuality(b);
      warm(gb);
      feed(gb, 3.2, 0.2); // 5 fps for 3 s: sustained load
      expect(b.tier).toBe('medium');
    });

    it('a stall window counts neither good nor bad: it keeps the slow counter', () => {
      // two slow windows, a stall, one more slow window -> three slow windows in a row (the stall is skipped)
      const a = new QualityState('high');
      const ga = new AutoQuality(a);
      warm(ga);
      feed(ga, 2, SLOW);
      ga.frame(1); // stall window
      expect(a.tier).toBe('high');
      feed(ga, 1, SLOW);
      expect(a.tier).toBe('medium');
      // two slow windows, a stall, a good window, one slow window -> the good window reset the counter
      const b = new QualityState('high');
      const gb = new AutoQuality(b);
      warm(gb);
      feed(gb, 2, SLOW);
      gb.frame(1);
      feed(gb, 1, FAST);
      feed(gb, 1, SLOW);
      expect(b.tier).toBe('high');
    });

    it('stall windows between slow ones neither reset the counter nor add to it', () => {
      const state = new QualityState('high');
      const gov = new AutoQuality(state);
      warm(gov);
      feed(gov, 1, SLOW);
      gov.frame(2);
      gov.frame(2);
      feed(gov, 1, SLOW);
      expect(state.tier).toBe('high'); // 2 slow windows only
      feed(gov, 1, SLOW);
      expect(state.tier).toBe('medium'); // the third
    });

    it('more than 12 s of back-to-back stall windows is a slow machine and does drop', () => {
      const state = new QualityState('high');
      const gov = new AutoQuality(state);
      warm(gov);
      feed(gov, 14.5, 0.5); // 12 s of stall windows are skipped, then 13 and 14 count as slow
      expect(state.tier).toBe('high');
      feed(gov, 1, 0.5); // the third slow window
      expect(state.tier).toBe('medium');
    });
  });

  it('a disabled governor ignores every frame (fixed quality, user tier)', () => {
    const state = new QualityState('high');
    const gov = new AutoQuality(state);
    gov.enabled = false;
    feed(gov, 60, 0.05);
    expect(state.tier).toBe('high');
  });

  it('invokes onSlowAtFloor when already on low and frame times stay slow', () => {
    const state = new QualityState('low');
    let floorDrops = 0;
    const gov = new AutoQuality(state, undefined, () => floorDrops++);
    warm(gov);
    feed(gov, 3.2, 0.04);
    expect(state.tier).toBe('low');
    expect(floorDrops).toBe(1);
    feed(gov, 3.2, 0.04);
    expect(floorDrops).toBe(2);
  });

  it('profiles are monotonic in cost-driving knobs', () => {
    const t = ['low', 'medium', 'high', 'ultra'] as const;
    for (let i = 1; i < t.length; i++) {
      const a = QUALITY_PROFILES[t[i - 1] as (typeof t)[number]];
      const b = QUALITY_PROFILES[t[i] as (typeof t)[number]];
      expect(b.crowdCap).toBeGreaterThanOrEqual(a.crowdCap);
      expect(b.dprCap).toBeGreaterThanOrEqual(a.dprCap);
      expect(b.damageGlyphCap).toBeGreaterThanOrEqual(a.damageGlyphCap);
    }
  });
});

describe('CameraRig', () => {
  it('looks at the focus from +Z with the configured pitch and distance', () => {
    const rig = new CameraRig(16 / 9);
    rig.setTarget(10, 0, -5);
    rig.snap();
    rig.update(0.016);
    const c = rig.camera.position;
    expect(c.x).toBeCloseTo(10, 4);
    expect(c.z).toBeGreaterThan(-5);
    expect(Math.hypot(c.y, c.z + 5)).toBeCloseTo(22, 3);
    expect(Math.atan2(c.y, c.z + 5)).toBeCloseTo((55 * Math.PI) / 180, 4);
  });

  it('ground footprint contains the focus and rejects far points', () => {
    const rig = new CameraRig(16 / 9);
    rig.setTarget(0, 0, 0);
    rig.snap();
    rig.update(0.016);
    expect(rig.isVisible(0, 0, 0)).toBe(true);
    expect(rig.isVisible(0, -8, 0.5)).toBe(true);
    expect(rig.isVisible(0, -200, 1)).toBe(false);
    expect(rig.isVisible(150, 0, 1)).toBe(false);
    expect(rig.isVisible(0, 200, 1)).toBe(false);
    // radius extends visibility across the edge
    expect(rig.isVisible(0, -48, 40)).toBe(true);
  });

  it('follows with smoothing and shake decays to zero', () => {
    const rig = new CameraRig();
    rig.setTarget(0, 0, 0);
    rig.snap();
    rig.update(0.016);
    rig.setTarget(10, 0, 0);
    rig.update(0.016);
    expect(rig.focus.x).toBeGreaterThan(0);
    expect(rig.focus.x).toBeLessThan(10);
    rig.addTrauma(1);
    for (let i = 0; i < 200; i++) rig.update(0.016);
    expect(rig.trauma).toBe(0);
    expect(rig.focus.x).toBeCloseTo(10, 2);
  });

  it('zoom clamps to 16..30', () => {
    const rig = new CameraRig();
    rig.setZoom(5);
    expect(rig.zoom).toBe(16);
    rig.setZoom(99);
    expect(rig.zoom).toBe(30);
  });
});
