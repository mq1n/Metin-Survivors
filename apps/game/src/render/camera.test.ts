// FEEL-03 (the last describes of this file): the climax pull-back of the final boss's emerge (CameraRig.pullBack: +6 m over 1.2 s, composed with the boss
// framing, back to exactly the user zoom), its QA switch, and the router that stages a boss spawn (the pull-back and the vignette pulses).
// FEEL-04 (second attempt): the run-start fly-in. The rig side (a cinematic that eases an establishing pose into the gameplay rig and ends
// exactly on it, at a camera height that never leaves the span of its two ends: no lift over the tree LOD window; a parameter that a stalled
// frame cannot swallow; the ground footprint that follows the pose), the gate (10 steady frames or 2 s of the run clock), the skip rules (low
// tier, screen shake 0, prefers-reduced-motion, a restart, a co-op guest) and the router that wires them (app/renderEvents.ts).
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutoQuality, QUALITY_PROFILES, QualityState } from './quality';
import { vegQuality } from './vegetation/types';
import {
  CAMERA_DIST_DEFAULT,
  CAMERA_DIST_MAX,
  CAMERA_FOV,
  CAMERA_PITCH,
  CLIMAX_DIST_CAP,
  CLIMAX_EXTRA,
  CLIMAX_FALL_S,
  CLIMAX_HOLD_S,
  CLIMAX_RISE_S,
  CameraRig,
  ESTABLISHING_POSE,
  ESTABLISH_DIST,
  ESTABLISH_PITCH,
  FLY_IN_MAX_STEP,
  FLY_IN_HURRY_S,
  FLY_IN_MAX_WAIT,
  FLY_IN_SECONDS,
  FLY_IN_STABLE_DT,
  FLY_IN_STABLE_FRAMES,
  FlyInGate,
  cinematicPose,
  easeInOut,
  flyInSkip,
  parseClimaxOff,
  parseFlyInOff,
  prefersReducedMotion,
  pullBackLevel,
} from './camera';
import type { RenderCore, RenderSystem } from './core';
import { PostPipeline } from './post';
import type { RenderWorld } from './world';
import type { World } from '../sim/world';
import { EventBus } from '../sim/events';
import { BAND_PULSE, FINAL_PULSE, FLY_IN_RESTART_MS, RenderEventRouter, refreshZone } from '../app/renderEvents';
import { runEvents } from '../app/runEvents';
import { MirrorWorld } from '../net/coop/mirror';
import { cloneContent, fixtureConfig } from '../sim/__fixtures__/content';
import { makeWorld } from '../sim/__tests__/helpers';

const FRAME = 1 / 60;

function newRig(zoom?: number): CameraRig {
  const rig = new CameraRig(16 / 9);
  if (zoom !== undefined) rig.setZoom(zoom);
  rig.setTarget(10, 2, -5);
  rig.snap();
  rig.update(0);
  return rig;
}

/** distance and pitch (rad) of the camera as seen from the focus */
function pose(rig: CameraRig): { dist: number; pitch: number } {
  const c = rig.camera.position;
  const f = rig.focus;
  const dy = c.y - f.y;
  const dz = c.z - f.z;
  return { dist: Math.hypot(dy, dz), pitch: Math.atan2(dy, dz) };
}

describe('CameraRig.cinematic: the establishing pose eases into the gameplay rig', () => {
  it('starts exactly on the establishing pose (17 deg, 62 m, centred on the hero)', () => {
    const rig = newRig();
    rig.cinematic(ESTABLISHING_POSE, FLY_IN_SECONDS);
    rig.update(0);
    const p = pose(rig);
    expect(p.dist).toBeCloseTo(ESTABLISH_DIST, 6);
    expect(p.pitch).toBeCloseTo(ESTABLISH_PITCH, 9);
    expect(ESTABLISH_PITCH).toBeCloseTo((17 * Math.PI) / 180, 12);
    expect(ESTABLISH_DIST).toBeGreaterThanOrEqual(60);
    expect(ESTABLISH_DIST).toBeLessThanOrEqual(70);
    // still hero-centred: the camera looks at the focus, which did not move
    expect(rig.camera.position.x).toBeCloseTo(10, 9);
    expect(rig.focus.x).toBeCloseTo(10, 9);
    expect(rig.focus.z).toBeCloseTo(-5, 9);
  });

  it('ends exactly at the gameplay pose and zoom (the same camera a rig without a cinematic has), then is over', () => {
    for (const zoom of [16, CAMERA_DIST_DEFAULT, 30]) {
      const fly = newRig(zoom);
      const plain = newRig(zoom);
      fly.cinematic(ESTABLISHING_POSE, FLY_IN_SECONDS);
      let frames = 0;
      while (fly.cinematicActive && frames < 1000) {
        fly.update(FRAME);
        plain.update(FRAME);
        frames++;
      }
      expect(fly.cinematicActive).toBe(false);
      // 2.5 s at 60 fps (a rounding error of the sum of 1/60 may cost one more frame)
      expect(frames).toBeGreaterThanOrEqual(150);
      expect(frames).toBeLessThanOrEqual(151);
      // the last frame of the cinematic IS the gameplay camera (not "close to it")
      expect(fly.camera.position.toArray()).toEqual(plain.camera.position.toArray());
      expect(fly.camera.quaternion.toArray()).toEqual(plain.camera.quaternion.toArray());
      expect(fly.pitch).toBe(CAMERA_PITCH);
      expect(pose(fly).dist).toBeCloseTo(zoom, 9);
      // and it stays there
      fly.update(FRAME);
      plain.update(FRAME);
      expect(fly.camera.position.toArray()).toEqual(plain.camera.position.toArray());
    }
  });

  it('follows the user zoom of the moment: a wheel turn during the flight changes where it lands', () => {
    const rig = newRig(22);
    rig.cinematic(ESTABLISHING_POSE, FLY_IN_SECONDS);
    for (let i = 0; i < 60; i++) rig.update(FRAME);
    rig.setZoom(28);
    while (rig.cinematicActive) rig.update(FRAME);
    for (let i = 0; i < 120; i++) rig.update(FRAME); // the zoom smoothing settles
    expect(pose(rig).dist).toBeCloseTo(28, 3);
  });

  it('is monotone and eased: slow at both ends, half way at half the time', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(-3)).toBe(0);
    expect(easeInOut(7)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 12);
    expect(easeInOut(0.1)).toBeLessThan(0.1);
    expect(easeInOut(0.9)).toBeGreaterThan(0.9);
    let prev = -1;
    for (let i = 0; i <= 100; i++) {
      const v = easeInOut(i / 100);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    const rig = newRig();
    rig.cinematic(ESTABLISHING_POSE, FLY_IN_SECONDS);
    let lastDist = Infinity;
    let lastPitch = -Infinity;
    while (rig.cinematicActive) {
      rig.update(FRAME);
      const p = pose(rig);
      expect(p.dist).toBeLessThanOrEqual(lastDist + 1e-9);
      expect(p.pitch).toBeGreaterThanOrEqual(lastPitch - 1e-9);
      lastDist = p.dist;
      lastPitch = p.pitch;
    }
    // half way (1.25 s): the pitch is the mean of the two poses, the camera height is the mean of their heights
    const mid = newRig();
    mid.cinematic(ESTABLISHING_POSE, FLY_IN_SECONDS);
    for (let i = 0; i < 75; i++) mid.update(FRAME);
    expect(mid.cinematicProgress).toBeCloseTo(0.5, 6);
    const midPitch = (ESTABLISH_PITCH + CAMERA_PITCH) / 2;
    expect(pose(mid).pitch).toBeCloseTo(midPitch, 6);
    const meanHeight = (ESTABLISH_DIST * Math.sin(ESTABLISH_PITCH) + CAMERA_DIST_DEFAULT * Math.sin(CAMERA_PITCH)) / 2;
    expect(pose(mid).dist * Math.sin(midPitch)).toBeCloseTo(meanHeight, 6);
  });

  it('progress is capped per frame: a 250 ms stall moves it by 1/30 s, not by 250 ms', () => {
    const rig = newRig();
    rig.cinematic(ESTABLISHING_POSE, FLY_IN_SECONDS);
    rig.update(0.25);
    expect(rig.cinematicProgress).toBeCloseTo(FLY_IN_MAX_STEP / FLY_IN_SECONDS, 12);
    rig.update(5);
    expect(rig.cinematicProgress).toBeCloseTo((2 * FLY_IN_MAX_STEP) / FLY_IN_SECONDS, 12);
    // a short frame advances by its own length
    rig.update(0.01);
    expect(rig.cinematicProgress).toBeCloseTo((2 * FLY_IN_MAX_STEP + 0.01) / FLY_IN_SECONDS, 12);
    // so the flight needs at least 75 frames whatever the frame rate, and a negative or zero dt moves nothing
    const slow = newRig();
    slow.cinematic(ESTABLISHING_POSE, FLY_IN_SECONDS);
    let n = 0;
    while (slow.cinematicActive && n < 1000) {
      slow.update(0.25);
      n++;
    }
    expect(n).toBe(75);
    const z = newRig();
    z.cinematic(ESTABLISHING_POSE, FLY_IN_SECONDS);
    z.update(0);
    z.update(-1);
    expect(z.cinematicProgress).toBe(0);
  });

  it('a held cinematic stays on the pose until it is released', () => {
    const rig = newRig();
    rig.cinematic(ESTABLISHING_POSE, FLY_IN_SECONDS, { hold: true });
    expect(rig.cinematicHeld).toBe(true);
    for (let i = 0; i < 300; i++) rig.update(FRAME);
    expect(rig.cinematicProgress).toBe(0);
    expect(rig.cinematicActive).toBe(true);
    expect(pose(rig).dist).toBeCloseTo(ESTABLISH_DIST, 6);
    rig.releaseCinematic();
    expect(rig.cinematicHeld).toBe(false);
    rig.update(FRAME);
    expect(rig.cinematicProgress).toBeGreaterThan(0);
  });

  it('snap() (a teleport), cancelCinematic() and a zero length end it at once; the camera is the gameplay rig again', () => {
    const plain = newRig();
    plain.update(FRAME);
    for (const end of [(r: CameraRig) => r.snap(), (r: CameraRig) => r.cancelCinematic(), (r: CameraRig) => r.cinematic(ESTABLISHING_POSE, 0)]) {
      const rig = newRig();
      rig.cinematic(ESTABLISHING_POSE, FLY_IN_SECONDS, { hold: true });
      rig.update(FRAME);
      end(rig);
      expect(rig.cinematicActive).toBe(false);
      rig.update(FRAME);
      expect(rig.camera.position.toArray()).toEqual(plain.camera.position.toArray());
    }
  });

  it('the ground footprint follows the current pose: a point 45 m up the screen is in view from the establishing pose, not from the gameplay one', () => {
    const rig = newRig();
    rig.update(FRAME);
    const fx = rig.focus.x;
    const fz = rig.focus.z;
    expect(rig.isVisible(fx, fz - 45, 1)).toBe(false);
    rig.cinematic(ESTABLISHING_POSE, FLY_IN_SECONDS, { hold: true });
    rig.update(FRAME);
    expect(rig.isVisible(fx, fz, 0)).toBe(true);
    expect(rig.isVisible(fx, fz - 45, 1)).toBe(true);
    expect(rig.isVisible(fx, fz - 120, 1)).toBe(true);
    // behind the camera is still out
    expect(rig.isVisible(fx, fz + 200, 1)).toBe(false);
    // back on the gameplay rig the footprint is the old one
    rig.cancelCinematic();
    rig.update(FRAME);
    expect(rig.isVisible(fx, fz - 45, 1)).toBe(false);
  });

  it('a cinematic does not touch the shake: trauma still decays on the same clock', () => {
    const rig = newRig();
    rig.addTrauma(1);
    rig.cinematic(ESTABLISHING_POSE, FLY_IN_SECONDS);
    for (let i = 0; i < 60; i++) rig.update(FRAME);
    expect(rig.trauma).toBeLessThan(0.1);
  });
});

describe('CameraRig.cinematic: the opening shows the sky, the camera never climbs, a move input hurries it', () => {
  it('the top row of the opening frame is above the horizon (the backdrop ridge line and a band of sky are in it), the gameplay frame is not', () => {
    expect(ESTABLISH_PITCH).toBeLessThan((CAMERA_FOV / 2) * (Math.PI / 180));
    const rig = newRig();
    rig.cinematic(ESTABLISHING_POSE, FLY_IN_SECONDS, { hold: true });
    rig.update(0);
    const top = new Vector3(0, 1, 0.5).unproject(rig.camera).sub(rig.camera.position).normalize();
    expect(top.y).toBeGreaterThan(0.03); // about 3 degrees above the horizon
    const play = newRig();
    const topPlay = new Vector3(0, 1, 0.5).unproject(play.camera).sub(play.camera.position).normalize();
    expect(topPlay.y).toBeLessThan(0);
  });

  it('the camera height above the hero stays between the two ends of the flight, at every zoom: it never rises above the higher one (no lift)', () => {
    const h0 = ESTABLISH_DIST * Math.sin(ESTABLISH_PITCH);
    for (const zoom of [16, CAMERA_DIST_DEFAULT, 30]) {
      const rig = newRig(zoom);
      const h1 = zoom * Math.sin(CAMERA_PITCH);
      rig.cinematic(ESTABLISHING_POSE, FLY_IN_SECONDS);
      let prev = h0;
      let frames = 0;
      while (rig.cinematicActive && frames < 1000) {
        rig.update(FRAME);
        frames++;
        const h = rig.camera.position.y - rig.focus.y;
        expect(h).toBeLessThanOrEqual(Math.max(h0, h1) + 1e-6);
        expect(h).toBeGreaterThanOrEqual(Math.min(h0, h1) - 1e-6);
        // a straight line between the two heights: monotone
        if (h1 <= h0) expect(h).toBeLessThanOrEqual(prev + 1e-6);
        else expect(h).toBeGreaterThanOrEqual(prev - 1e-6);
        prev = h;
        // the hero stays on the optical axis: the focus projects to the screen centre
        const ndc = rig.focus.clone().project(rig.camera);
        expect(Math.abs(ndc.x)).toBeLessThan(1e-6);
        expect(Math.abs(ndc.y)).toBeLessThan(1e-6);
      }
    }
  });

  it('cinematicPose(): exactly the two ends at e = 0 and 1, the pitch eased in between, the height on the straight line, the distance falling', () => {
    const to = { pitch: CAMERA_PITCH, distance: CAMERA_DIST_DEFAULT };
    expect(cinematicPose(ESTABLISHING_POSE, to, 0)).toEqual({ pitch: ESTABLISH_PITCH, distance: ESTABLISH_DIST });
    expect(cinematicPose(ESTABLISHING_POSE, to, 1)).toEqual(to);
    expect(cinematicPose(ESTABLISHING_POSE, to, -2)).toEqual({ pitch: ESTABLISH_PITCH, distance: ESTABLISH_DIST });
    expect(cinematicPose(ESTABLISHING_POSE, to, 7)).toEqual(to);
    const h0 = ESTABLISH_DIST * Math.sin(ESTABLISH_PITCH);
    const h1 = to.distance * Math.sin(to.pitch);
    let lastDist = Infinity;
    for (let i = 0; i <= 100; i++) {
      const e = i / 100;
      const p = cinematicPose(ESTABLISHING_POSE, to, e);
      expect(p.distance * Math.sin(p.pitch)).toBeCloseTo(h0 + (h1 - h0) * e, 9);
      expect(p.pitch).toBeCloseTo(ESTABLISH_PITCH + (CAMERA_PITCH - ESTABLISH_PITCH) * e, 12);
      expect(p.distance).toBeLessThanOrEqual(lastDist + 1e-9);
      lastDist = p.distance;
    }
  });

  it('the tree LOD premise: the camera stays within 22 m above its foot at the default zoom, where the tree system chooses LOD instances by the flat distance but cross-fades by the 3D one', () => {
    // vegetation/trees.ts gather adds an LOD1 instance only beyond lodNear - 6 on the ground plane; the shader fades LOD0 out from lodNear in 3D.
    // A tree at flat distance lodNear - 6 therefore starts to dissolve once the camera is above sqrt(lodNear^2 - (lodNear - 6)^2) of it:
    // 22.2 m on medium, 24.7 m on high (attempt 1 flew 43 m up at the middle and trees blinked out)
    for (const tier of ['medium', 'high'] as const) {
      const { lodNear } = vegQuality(QUALITY_PROFILES[tier]);
      const dissolveAbove = Math.sqrt(lodNear * lodNear - (lodNear - 6) ** 2);
      const rig = newRig();
      rig.cinematic(ESTABLISHING_POSE, FLY_IN_SECONDS);
      let peak = 0;
      while (rig.cinematicActive) {
        rig.update(FRAME);
        peak = Math.max(peak, rig.camera.position.y - rig.focus.y);
      }
      expect(peak).toBeLessThan(dissolveAbove - 2);
    }
  });

  it('hurryCinematic(): what is left runs in 0.4 s, the camera does not jump, and it still lands exactly on the gameplay rig', () => {
    const rig = newRig();
    const plain = newRig();
    rig.cinematic(ESTABLISHING_POSE, FLY_IN_SECONDS);
    for (let i = 0; i < 40; i++) rig.update(FRAME);
    const before = rig.camera.position.clone();
    rig.hurryCinematic();
    rig.update(0); // no time passes: the pose is the same one
    expect(rig.camera.position.distanceTo(before)).toBeLessThan(1e-9);
    let n = 0;
    while (rig.cinematicActive && n < 1000) {
      rig.update(FRAME);
      n++;
    }
    expect(n * FRAME).toBeGreaterThan(FLY_IN_HURRY_S - 0.05);
    expect(n * FRAME).toBeLessThan(FLY_IN_HURRY_S + 0.05);
    for (let i = 0; i < 41; i++) plain.update(FRAME);
    plain.update(FRAME);
    rig.update(FRAME);
    expect(rig.camera.position.toArray()).toEqual(plain.camera.position.toArray());
    expect(rig.pitch).toBe(CAMERA_PITCH);
  });

  it('hurryCinematic() releases a held pose, never slows a flight down, and does nothing without one', () => {
    const rig = newRig();
    expect(() => rig.hurryCinematic()).not.toThrow();
    expect(rig.cinematicActive).toBe(false);
    rig.cinematic(ESTABLISHING_POSE, FLY_IN_SECONDS, { hold: true });
    rig.hurryCinematic();
    expect(rig.cinematicHeld).toBe(false);
    rig.update(FRAME);
    expect(rig.cinematicProgress).toBeGreaterThan(FLY_IN_MAX_STEP / FLY_IN_SECONDS); // faster than the plain rate
    // a flight with less than 0.4 s left keeps its own speed, and a second call does not change the first one's rate
    const late = newRig();
    late.cinematic(ESTABLISHING_POSE, FLY_IN_SECONDS);
    for (let i = 0; i < 140; i++) late.update(FRAME);
    const p0 = late.cinematicProgress;
    late.hurryCinematic();
    late.update(FRAME);
    expect(late.cinematicProgress - p0).toBeCloseTo(FRAME / FLY_IN_SECONDS, 9);
    const twice = newRig();
    twice.cinematic(ESTABLISHING_POSE, FLY_IN_SECONDS);
    twice.hurryCinematic();
    twice.update(FRAME);
    const q1 = twice.cinematicProgress;
    twice.hurryCinematic();
    twice.update(FRAME);
    expect(twice.cinematicProgress - q1).toBeGreaterThanOrEqual(q1 - 1e-9);
  });
});

describe('FlyInGate: when the held pose is released', () => {
  it('releases after 10 consecutive steady frames once the run clock moves, not before', () => {
    const g = new FlyInGate();
    for (let i = 0; i < FLY_IN_STABLE_FRAMES - 1; i++) expect(g.frame(FRAME, true)).toBe(false);
    expect(g.frame(FRAME, true)).toBe(true);
  });

  it('a frame over the steady limit starts the count again', () => {
    const g = new FlyInGate();
    for (let i = 0; i < 9; i++) g.frame(FRAME, true);
    expect(g.frame(0.04, true)).toBe(false);
    expect(g.stable).toBe(0);
    for (let i = 0; i < 9; i++) expect(g.frame(FRAME, true)).toBe(false);
    expect(g.frame(FRAME, true)).toBe(true);
    const h = new FlyInGate();
    expect(h.frame(FLY_IN_STABLE_DT + 1e-6, true)).toBe(false);
    expect(h.stable).toBe(0);
    expect(h.frame(0, true)).toBe(false);
    expect(h.stable).toBe(0);
  });

  it('a machine locked at 30 fps (33.3 ms frames, a little jitter) gets its steady frames: it does not sit out the 2 s wait', () => {
    expect(FLY_IN_STABLE_DT).toBeGreaterThan(1 / 30);
    const g = new FlyInGate();
    const jitter = [0, 0.0012, -0.0009, 0.002, -0.0015, 0.0031, 0, -0.002, 0.0011, 0.0025];
    let n = 0;
    let t = 0;
    for (; n < 200; n++) {
      const dt = 1 / 30 + (jitter[n % jitter.length] as number);
      t += dt;
      if (g.frame(dt, true)) break;
    }
    expect(n + 1).toBe(FLY_IN_STABLE_FRAMES);
    expect(t).toBeLessThan(0.5);
    // 25 fps is not steady: only the 2 s ceiling releases it
    const slow = new FlyInGate();
    for (let i = 0; i < 40; i++) expect(slow.frame(0.04, true)).toBe(false);
    expect(slow.stable).toBe(0);
  });

  it('never releases while the run clock stands (the intro card is open), however steady the frames; the steady frames still count', () => {
    const g = new FlyInGate();
    for (let i = 0; i < 600; i++) expect(g.frame(FRAME, false)).toBe(false);
    expect(g.waited).toBe(0);
    // the card closes: the frames behind it already count, so the very next frame releases
    expect(g.frame(FRAME, true)).toBe(true);
  });

  it('waits at most 2 s of the run clock for steady frames, then releases anyway', () => {
    const g = new FlyInGate();
    let t = 0;
    let released = -1;
    for (let i = 0; i < 200 && released < 0; i++) {
      // 40 ms frames never count as steady
      if (g.frame(0.04, true)) released = t;
      t += 0.04;
    }
    expect(g.stable).toBe(0);
    expect(released).toBeGreaterThanOrEqual(FLY_IN_MAX_WAIT - 0.04 - 1e-9);
    expect(released).toBeLessThanOrEqual(FLY_IN_MAX_WAIT + 1e-9);
    const early = new FlyInGate();
    expect(early.frame(1.9, true)).toBe(false);
    expect(early.frame(0.2, true)).toBe(true);
  });
});

describe('flyInSkip / parseFlyInOff', () => {
  const ok = { tier: 'high', shakeScale: 1, restart: false, guest: false };
  it('plays on medium, high and ultra with shake on, in a fresh run, for the host and solo', () => {
    for (const tier of ['medium', 'high', 'ultra']) expect(flyInSkip({ ...ok, tier })).toBeNull();
    expect(flyInSkip({ ...ok, shakeScale: 0.25 })).toBeNull();
  });

  it('skips with prefers-reduced-motion (the OS asks for less motion), and reads it from matchMedia only when there is one', () => {
    expect(flyInSkip({ ...ok, reducedMotion: true })).toBe('motion');
    expect(flyInSkip({ ...ok, reducedMotion: false })).toBeNull();
    expect(prefersReducedMotion()).toBe(false); // no matchMedia in the test environment
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('prefers-reduced-motion') }));
    expect(prefersReducedMotion()).toBe(true);
    vi.stubGlobal('matchMedia', () => {
      throw new Error('blocked');
    });
    expect(prefersReducedMotion()).toBe(false);
    vi.unstubAllGlobals();
  });

  it('skips on low, with screen shake 0, on a restart and for a co-op guest', () => {
    expect(flyInSkip({ ...ok, tier: 'low' })).toBe('low');
    expect(flyInSkip({ ...ok, shakeScale: 0 })).toBe('shake');
    expect(flyInSkip({ ...ok, shakeScale: Number.NaN })).toBe('shake');
    expect(flyInSkip({ ...ok, restart: true })).toBe('restart');
    expect(flyInSkip({ ...ok, guest: true })).toBe('guest');
    expect(flyInSkip({ ...ok, off: true })).toBe('off');
  });

  it('the page switch up=noflyin exists for QA only and ignores the other words', () => {
    expect(parseFlyInOff('?quality=high&up=noarc,noflyin', true)).toBe(true);
    expect(parseFlyInOff('?up=NoFlyIn', true)).toBe(true);
    expect(parseFlyInOff('?up=noarc,nocorr', true)).toBe(false);
    expect(parseFlyInOff('?up=noflyin', false)).toBe(false);
    expect(parseFlyInOff('', true)).toBe(false);
    expect(parseFlyInOff(null, true)).toBe(false);
  });
});

// ---- the router: when the fly-in starts, what skips it, how it ends ----------------------------------------------------------------

interface Harness {
  router: RenderEventRouter;
  rig: CameraRig;
  systems: RenderSystem[];
  /** the sim world of the run */
  world: { time: number; zone: { id: string }; config: { classId: string }; players: { moveX: number; moveZ: number }[]; over?: boolean; guest?: null };
  /** one rendered frame in RenderCore.frame's order: the governor sees it, the rig moves, then the live system list runs (a splice during it skips a system, as it does there) */
  frame(dt?: number): void;
  /** the real governor of the harness core (opts.governor) and the tier it governs */
  gov: AutoQuality | null;
  qs: QualityState | null;
  /** the 'zone' system's calls (opts.zone system) */
  zoneCalls: number;
  setTier(t: string): void;
  clock: { now: number };
}

function harness(opts: { tier?: string; shake?: number; guest?: boolean; zone?: string; classId?: string; noSystems?: boolean; governor?: boolean; zoneSystem?: boolean; composer?: unknown } = {}): Harness {
  const rig = newRig();
  rig.shakeScale = opts.shake ?? 1;
  const systems: RenderSystem[] = [];
  const wall = { ms: 0 };
  const qs = opts.governor ? new QualityState((opts.tier ?? 'high') as 'high') : null;
  const gov = qs ? new AutoQuality(qs, () => wall.ms) : null;
  const quality = qs ?? { tier: opts.tier ?? 'high', profile: { shadows: false } };
  const zoneState = { calls: 0 };
  if (opts.zoneSystem) systems.push({ name: 'zone', update: () => void zoneState.calls++ });
  const core = {
    rig,
    quality,
    ...(gov ? { governor: gov } : {}),
    addSystem: (s: RenderSystem) => void systems.push(s),
    removeSystem: (s: RenderSystem) => {
      const i = systems.indexOf(s);
      if (i >= 0) systems.splice(i, 1);
    },
    // the zone system the second pass refreshes at the pose
    systems,
    renderer: { render: () => undefined },
    scene: { traverse: () => undefined, children: [] },
    composer: opts.composer ?? null,
    env: { followShadow: () => undefined },
  } as unknown as RenderCore;
  const rw = { core, hitStop: null, shake: () => undefined } as unknown as RenderWorld;
  const clock = { now: 1_000_000 };
  const router = new RenderEventRouter(rw, { now: () => clock.now });
  if (opts.noSystems) (core as unknown as { addSystem?: unknown }).addSystem = undefined;
  router.attach();
  routers.push(router);
  const world = {
    time: 0,
    zone: { id: opts.zone ?? 'yeonmu' },
    config: { classId: opts.classId ?? 'warrior' },
    players: [{ moveX: 0, moveZ: 0 }],
    ...(opts.guest ? { guest: null } : {}),
  } as Harness['world'];
  return {
    router,
    rig,
    systems,
    world,
    gov,
    qs,
    get zoneCalls() {
      return zoneState.calls;
    },
    frame(dt = FRAME) {
      wall.ms += dt * 1000;
      gov?.frame(dt);
      rig.update(dt);
      for (const s of systems) s.update(dt, 1);
    },
    setTier: (t) => void ((quality as { tier: string }).tier = t),
    clock,
  };
}

const routers: RenderEventRouter[] = [];
beforeEach(() => {
  // a harness core without a 'zone' system warns at every run start; the tests that care spy for themselves
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  for (const r of routers.splice(0)) r.detach();
  vi.restoreAllMocks();
});

/** the end of the frame: what a microtask queued during it has done by now */
const flush = (): Promise<void> => Promise.resolve();
const start = (h: Harness): void => runEvents.runStart(h.world as unknown as World);
const end = (h: Harness): void => runEvents.runEnd(h.world as unknown as World);

describe('RenderEventRouter: the run-start fly-in', () => {
  it('holds the establishing pose from the run start, behind the intro card (the run clock stands), and keeps it', () => {
    const h = harness();
    start(h);
    expect(h.rig.cinematicHeld).toBe(true);
    expect(h.systems).toHaveLength(1);
    for (let i = 0; i < 600; i++) h.frame(); // ten seconds of reading
    expect(h.rig.cinematicHeld).toBe(true);
    expect(h.rig.cinematicProgress).toBe(0);
    expect(pose(h.rig).dist).toBeCloseTo(ESTABLISH_DIST, 6);
  });

  it('starts when the card closes (the run clock moves) after the steady frames, flies 2.5 s and ends on the gameplay pose', async () => {
    const h = harness();
    start(h);
    for (let i = 0; i < 30; i++) h.frame();
    h.world.time = 0.02; // the card was dismissed and the sim ticked
    h.frame();
    expect(h.rig.cinematicHeld).toBe(false);
    expect(h.rig.cinematicActive).toBe(true);
    let n = 0;
    while (h.rig.cinematicActive && n < 1000) {
      h.frame();
      n++;
    }
    expect(n).toBeGreaterThanOrEqual(Math.floor(FLY_IN_SECONDS / FRAME) - 1);
    expect(n).toBeLessThanOrEqual(Math.ceil(FLY_IN_SECONDS / FRAME) + 2);
    await flush();
    expect(h.systems).toHaveLength(0); // the system removes itself when the fly-in is over (at the end of that frame)
    const plain = newRig();
    for (let i = 0; i < 40; i++) plain.update(FRAME);
    h.frame();
    expect(h.rig.camera.position.toArray()).toEqual(plain.camera.position.toArray());
  });

  it('without a card (the clock moves at once) it waits for 10 steady frames, or 2 s if the frames are never steady', () => {
    const h = harness();
    start(h);
    h.world.time = 0.02;
    for (let i = 0; i < 9; i++) h.frame();
    expect(h.rig.cinematicHeld).toBe(true);
    h.frame();
    h.frame();
    expect(h.rig.cinematicHeld).toBe(false);
    const slow = harness();
    start(slow);
    slow.world.time = 0.02;
    let t = 0;
    while (slow.rig.cinematicHeld && t < 10) {
      slow.frame(0.04); // never steady
      t += 0.04;
    }
    expect(t).toBeLessThanOrEqual(FLY_IN_MAX_WAIT + 0.1);
  });

  it('a stall frame in the middle of the wait restarts the count (the fly-in is not eaten by it)', () => {
    const h = harness();
    start(h);
    h.world.time = 0.02;
    for (let i = 0; i < 8; i++) h.frame();
    h.frame(0.25);
    for (let i = 0; i < 9; i++) h.frame();
    expect(h.rig.cinematicHeld).toBe(true);
    h.frame();
    h.frame();
    expect(h.rig.cinematicHeld).toBe(false);
  });

  it('is skipped on the low tier, with screen shake 0, for a co-op guest: the rig never leaves the gameplay pose', () => {
    for (const o of [{ tier: 'low' }, { shake: 0 }, { guest: true }]) {
      const h = harness(o);
      start(h);
      expect(h.rig.cinematicActive).toBe(false);
      expect(h.systems).toHaveLength(0);
      h.world.time = 1;
      for (let i = 0; i < 200; i++) h.frame();
      expect(pose(h.rig).dist).toBeCloseTo(CAMERA_DIST_DEFAULT, 6);
      expect(h.rig.pitch).toBe(CAMERA_PITCH);
    }
  });

  it('is skipped with prefers-reduced-motion, and a setting turned on while the pose is held cancels it when it would be released', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('prefers-reduced-motion') }));
    const h = harness();
    start(h);
    expect(h.rig.cinematicActive).toBe(false);
    expect(h.systems).toHaveLength(0);
    h.world.time = 1;
    for (let i = 0; i < 200; i++) h.frame();
    expect(h.rig.pitch).toBe(CAMERA_PITCH);
    expect(pose(h.rig).dist).toBeCloseTo(CAMERA_DIST_DEFAULT, 6);
    vi.unstubAllGlobals();
    // the OS setting changes while the pose is held (behind the intro card)
    const later = harness();
    start(later);
    expect(later.rig.cinematicHeld).toBe(true);
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('prefers-reduced-motion') }));
    later.world.time = 1;
    for (let i = 0; i < 40; i++) later.frame();
    expect(later.rig.cinematicActive).toBe(false);
    expect(later.rig.pitch).toBe(CAMERA_PITCH);
    vi.unstubAllGlobals();
  });

  it('a co-op host plays it (it is local to its camera); the guest is told from the host by its world (the real classes)', () => {
    const solo = harness({});
    runEvents.runStart(makeWorld());
    expect(solo.rig.cinematicActive).toBe(true);
    runEvents.runEnd(makeWorld());
    const guest = harness({});
    runEvents.runStart(new MirrorWorld(fixtureConfig(), cloneContent(), {}));
    expect(guest.rig.cinematicActive).toBe(false);
    expect(guest.systems).toHaveLength(0);
  });

  it('is skipped on a restart: the same zone and hero again within ten minutes of the run that just ended; another zone, another hero, or later, plays', () => {
    const h = harness();
    start(h);
    end(h);
    expect(h.rig.cinematicActive).toBe(false); // the run end cancels what was left over
    h.clock.now += 60_000;
    start(h);
    expect(h.rig.cinematicActive).toBe(false);
    expect(h.systems).toHaveLength(0);
    end(h);
    // another zone
    h.world.zone.id = 'seori';
    h.clock.now += 1000;
    start(h);
    expect(h.rig.cinematicActive).toBe(true);
    end(h);
    // the same zone again, immediately: now it is a restart
    h.clock.now += 1000;
    start(h);
    expect(h.rig.cinematicActive).toBe(false);
    end(h);
    // another hero in that zone
    h.world.config.classId = 'ninja';
    start(h);
    expect(h.rig.cinematicActive).toBe(true);
    end(h);
    // after the window
    h.clock.now += FLY_IN_RESTART_MS + 1;
    start(h);
    expect(h.rig.cinematicActive).toBe(true);
    end(h);
  });

  it('a run that never started (a failed load) is not a restart candidate', () => {
    const h = harness();
    end(h); // dispose of a load that failed before runStart
    start(h);
    expect(h.rig.cinematicActive).toBe(true);
  });

  it('input is never blocked: it holds no modal, no pause, does not touch the world', () => {
    const h = harness();
    const before = JSON.stringify(h.world);
    start(h);
    for (let i = 0; i < 20; i++) h.frame();
    h.world.time = 0.05;
    for (let i = 0; i < 200; i++) h.frame();
    expect(JSON.stringify({ ...h.world, time: 0 })).toBe(before);
  });

  it('the run ending mid-flight (death, quit) cancels it and removes the system', () => {
    const h = harness();
    start(h);
    h.world.time = 0.02;
    for (let i = 0; i < 40; i++) h.frame();
    expect(h.rig.cinematicActive).toBe(true);
    end(h);
    expect(h.rig.cinematicActive).toBe(false);
    expect(h.systems).toHaveLength(0);
    h.frame();
    expect(pose(h.rig).dist).toBeCloseTo(CAMERA_DIST_DEFAULT, 6);
  });

  it('a pause (the frames keep coming, the clock stands) neither stalls nor breaks it: held stays held, a flight in progress finishes', () => {
    const h = harness();
    start(h);
    h.world.time = 0.02;
    for (let i = 0; i < 30; i++) h.frame(); // released and flying
    expect(h.rig.cinematicHeld).toBe(false);
    const stand = h.world.time;
    for (let i = 0; i < 400; i++) h.frame(); // paused for the rest of the flight
    expect(h.world.time).toBe(stand);
    expect(h.rig.cinematicActive).toBe(false);
  });

  it('a teleport (rig.snap(), what the QA spot shots do) ends it for good: the router does not start it again', async () => {
    const h = harness();
    start(h);
    h.world.time = 0.02;
    h.frame();
    h.rig.snap();
    h.rig.update(FRAME);
    for (let i = 0; i < 100; i++) h.frame();
    await flush();
    expect(h.rig.cinematicActive).toBe(false);
    expect(h.systems).toHaveLength(0);
  });

  it('screen shake set to 0 or the low tier while the pose is held cancels it when it would be released', () => {
    const h = harness();
    start(h);
    for (let i = 0; i < 20; i++) h.frame();
    h.rig.shakeScale = 0;
    h.world.time = 0.02;
    h.frame();
    expect(h.rig.cinematicActive).toBe(false);
    const l = harness();
    start(l);
    l.setTier('low');
    l.world.time = 0.02;
    for (let i = 0; i < 20; i++) l.frame();
    expect(l.rig.cinematicActive).toBe(false);
  });

  it('a core without a render-system list or a rig without cinematics (menu previews, test stand-ins) is left alone', () => {
    const h = harness({ noSystems: true });
    expect(() => start(h)).not.toThrow();
    expect(h.rig.cinematicActive).toBe(false);
    const stub = new RenderEventRouter({ core: { rig: { shakeScale: 1 } } } as unknown as RenderWorld);
    stub.attach();
    routers.push(stub);
    expect(() => runEvents.runStart({ players: [] } as unknown as World)).not.toThrow();
    expect(() => runEvents.runEnd({ players: [] } as unknown as World)).not.toThrow();
  });

  it('detach() ends a fly-in in progress', () => {
    const h = harness();
    start(h);
    h.router.detach();
    expect(h.rig.cinematicActive).toBe(false);
    expect(h.systems).toHaveLength(0);
  });
});

// ---- the fix round: governor, 30 Hz, move input, system list, zone refresh, guest marker ---------------------------------------------

describe('RenderEventRouter: the AutoQuality governor never judges the establishing pose', () => {
  /** frames of the heavier establishing view (22 ms) behind a story card that stays open */
  function readTheCard(h: Harness, seconds: number, dt = 0.022): void {
    for (let i = 0; i < Math.round(seconds / dt); i++) h.frame(dt);
  }

  it('a bare governor drops the tier on those frames (the cost of the pose, as a player reading a card feeds it) ...', () => {
    const qs = new QualityState('high');
    let wall = 0;
    const gov = new AutoQuality(qs, () => wall);
    for (let i = 0; i < Math.round(25 / 0.022); i++) {
      wall += 22;
      gov.frame(0.022);
    }
    expect(qs.tier).not.toBe('high');
  });

  it('... and with the router a 30 s read of the card at 22 ms frames leaves the tier alone', () => {
    const h = harness({ governor: true, tier: 'high' });
    start(h);
    readTheCard(h, 30);
    expect(h.rig.cinematicHeld).toBe(true);
    expect(h.qs?.tier).toBe('high');
    // the card closes: the flight runs on the same heavy frames, still unjudged
    h.world.time = 0.02;
    for (let i = 0; i < 3; i++) h.frame(0.022);
    expect(h.rig.cinematicHeld).toBe(false);
    let n = 0;
    while (h.rig.cinematicActive && n < 400) {
      h.frame(0.022);
      n++;
    }
    expect(h.rig.cinematicActive).toBe(false);
    expect(h.qs?.tier).toBe('high');
  });

  it('after the flight the governor has a fresh grace period on the gameplay camera and judges only those frames', async () => {
    const h = harness({ governor: true, tier: 'high' });
    start(h);
    readTheCard(h, 12);
    h.world.time = 0.02;
    while (h.rig.cinematicActive) h.frame(0.022);
    await flush();
    // 7 s of slow gameplay frames: still inside the 8 s grace that started when the fly-in ended
    for (let i = 0; i < Math.round(7 / 0.022); i++) h.frame(0.022);
    expect(h.qs?.tier).toBe('high');
    // a machine that really is slow on the gameplay camera is still caught: 8 s of grace, then 3 slow seconds
    for (let i = 0; i < Math.round(6 / 0.022); i++) h.frame(0.022);
    expect(h.qs?.tier).toBe('medium');
  });

  it('a fly-in that is skipped leaves the governor to run as it always did; the run ending while the pose is held ends the bookkeeping', () => {
    const h = harness({ governor: true, tier: 'high', guest: true });
    start(h);
    expect(h.systems).toHaveLength(0);
    for (let i = 0; i < Math.round(20 / 0.022); i++) h.frame(0.022);
    expect(h.qs?.tier).not.toBe('high');
    const g = harness({ governor: true, tier: 'high' });
    start(g);
    readTheCard(g, 5);
    end(g);
    expect(g.rig.cinematicActive).toBe(false);
    expect(g.systems).toHaveLength(0);
  });
});

describe('RenderEventRouter: a locked 30 fps machine, a move input, the system list', () => {
  it('a 30 fps machine flies as soon as the card closes (10 steady frames), not after the 2 s ceiling', () => {
    const h = harness();
    start(h);
    h.world.time = 0.02;
    let waited = 0;
    while (h.rig.cinematicHeld && waited < 5) {
      h.frame(1 / 30 + 0.001);
      waited += 1 / 30;
    }
    expect(h.rig.cinematicHeld).toBe(false);
    expect(waited).toBeLessThan(0.5);
  });

  it('a move input while the pose is held releases it at once and runs the flight in 0.4 s', () => {
    const h = harness();
    start(h);
    for (let i = 0; i < 3; i++) h.frame();
    h.world.time = 0.02;
    h.world.players[0] = { moveX: 1, moveZ: 0 };
    h.frame();
    expect(h.rig.cinematicHeld).toBe(false);
    let n = 0;
    while (h.rig.cinematicActive && n < 400) {
      h.frame();
      n++;
    }
    expect(n * FRAME).toBeLessThan(FLY_IN_HURRY_S + 0.1);
    expect(h.rig.pitch).toBe(CAMERA_PITCH);
  });

  it('a move input in the middle of the flight compresses what is left, once; it never touches the sim', () => {
    const h = harness();
    start(h);
    h.world.time = 0.02;
    for (let i = 0; i < 60; i++) h.frame(); // one second in
    expect(h.rig.cinematicActive).toBe(true);
    const sim = JSON.stringify({ ...h.world, players: [] });
    h.world.players[0] = { moveX: 0, moveZ: -1 };
    h.frame();
    let n = 0;
    while (h.rig.cinematicActive && n < 400) {
      h.frame();
      n++;
    }
    expect(n * FRAME).toBeLessThan(FLY_IN_HURRY_S + 0.1);
    expect(JSON.stringify({ ...h.world, players: [] })).toBe(sim);
  });

  it('an input while the card is open (the run clock stands) does not release the pose', () => {
    const h = harness();
    start(h);
    h.world.players[0] = { moveX: 1, moveZ: 1 };
    for (let i = 0; i < 120; i++) h.frame();
    expect(h.rig.cinematicHeld).toBe(true);
  });

  it('the move input does not override the skip rules (screen shake set to 0 while the pose is held)', () => {
    const h = harness();
    start(h);
    h.rig.shakeScale = 0;
    h.world.time = 0.02;
    h.world.players[0] = { moveX: 1, moveZ: 0 };
    h.frame();
    expect(h.rig.cinematicActive).toBe(false);
  });

  it('the system leaves the list at the end of the frame it finishes in: a system registered after it never misses a frame', async () => {
    const h = harness();
    start(h);
    const later = { calls: 0 };
    h.systems.push({ name: 'later', update: () => void later.calls++ });
    h.world.time = 0.02;
    let frames = 0;
    while (h.rig.cinematicActive && frames < 500) {
      h.frame();
      frames++;
    }
    h.frame(); // the router sees the end of the flight in this frame
    await flush();
    expect(later.calls).toBe(frames + 1);
    expect(h.systems.map((s) => s.name)).toEqual(['later']);
    // and a teleport (the QA spot shots) in the middle does the same
    const t = harness();
    start(t);
    const after = { calls: 0 };
    t.systems.push({ name: 'later', update: () => void after.calls++ });
    t.world.time = 0.02;
    t.frame();
    t.rig.snap();
    for (let i = 0; i < 5; i++) t.frame();
    await flush();
    expect(after.calls).toBe(6);
    expect(t.systems.map((s) => s.name)).toEqual(['later']);
  });
});

describe('the zone refresh and the guest marker: loud when their premise changes', () => {
  it('refreshZone() runs the zone system update when it is registered, and says so (false + a warning) when it is not', () => {
    const h = harness({ zoneSystem: true });
    expect(refreshZone({ core: { systems: h.systems } } as unknown as RenderWorld)).toBe(true);
    expect(h.zoneCalls).toBe(1);
    start(h);
    expect(h.zoneCalls).toBe(2); // the second warm pass refreshes the zone once at the establishing pose
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(refreshZone({ core: { systems: [] } } as unknown as RenderWorld)).toBe(false);
    expect(refreshZone({ core: {} } as unknown as RenderWorld)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(2);
    const bare = harness();
    start(bare);
    expect(warn).toHaveBeenCalledTimes(3); // a run start without a zone system warns too
    expect(bare.rig.cinematicHeld).toBe(true); // ... and still flies
  });

  it('the two private names it relies on exist in the real sources: RenderCore keeps `systems`, app/run.ts registers a system named zone', () => {
    const core = readFileSync(new URL('./core.ts', import.meta.url), 'utf8');
    expect(core).toMatch(/private\s+readonly\s+systems\s*:\s*RenderSystem\[\]/);
    const run = readFileSync(new URL('../app/run.ts', import.meta.url), 'utf8');
    expect(run).toMatch(/name:\s*'zone'/);
  });

  it('the guest is told from the host and from a solo player by its world: a plain World has no guest field, a MirrorWorld has one', () => {
    expect('guest' in (makeWorld() as object)).toBe(false);
    expect('guest' in (new MirrorWorld(fixtureConfig(), cloneContent(), {}) as object)).toBe(true);
  });
});

// ---- FEEL-03: the climax pull-back and the boss-spawn staging --------------------------------------------------------------------------

/** `seconds` of frames at 60 fps through the rig's update; `each` sees the time after every frame */
function runRig(rig: CameraRig, seconds: number, each?: (t: number) => void): void {
  const n = Math.round(seconds * 60);
  for (let i = 1; i <= n; i++) {
    rig.update(FRAME);
    each?.(i * FRAME);
  }
}

const PB_TOTAL = CLIMAX_RISE_S + CLIMAX_HOLD_S + CLIMAX_FALL_S;

describe('pullBackLevel: the shape of the climax pull-back', () => {
  it('rises from 0 to the full extra over the rise, holds, falls back, and is exactly 0 from the end on', () => {
    const lv = (t: number): number => pullBackLevel(t, 0, CLIMAX_EXTRA, CLIMAX_RISE_S, CLIMAX_HOLD_S, CLIMAX_FALL_S);
    expect(lv(0)).toBe(0);
    expect(lv(-1)).toBe(0);
    expect(lv(CLIMAX_RISE_S / 2)).toBeCloseTo(CLIMAX_EXTRA / 2, 9);
    expect(lv(CLIMAX_RISE_S)).toBe(CLIMAX_EXTRA);
    expect(lv(CLIMAX_RISE_S + CLIMAX_HOLD_S / 2)).toBe(CLIMAX_EXTRA);
    expect(lv(CLIMAX_RISE_S + CLIMAX_HOLD_S + CLIMAX_FALL_S / 2)).toBeCloseTo(CLIMAX_EXTRA / 2, 9);
    expect(lv(PB_TOTAL)).toBeCloseTo(0, 9);
    expect(lv(PB_TOTAL + 0.001)).toBe(0);
    expect(lv(60)).toBe(0);
  });

  it('is monotone: up during the rise, down during the fall, always inside 0..extra', () => {
    let prev = 0;
    for (let i = 1; i <= 120; i++) {
      const v = pullBackLevel((i / 120) * CLIMAX_RISE_S, 0, 6, CLIMAX_RISE_S, CLIMAX_HOLD_S, CLIMAX_FALL_S);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeLessThanOrEqual(6);
      prev = v;
    }
    for (let i = 1; i <= 140; i++) {
      const v = pullBackLevel(CLIMAX_RISE_S + CLIMAX_HOLD_S + (i / 140) * CLIMAX_FALL_S, 0, 6, CLIMAX_RISE_S, CLIMAX_HOLD_S, CLIMAX_FALL_S);
      expect(v).toBeLessThanOrEqual(prev + 1e-12);
      expect(v).toBeGreaterThanOrEqual(0);
      prev = v;
    }
  });

  it('a restart continues from the level reached (no jump) and still ends on the extra / 0', () => {
    expect(pullBackLevel(0, 2.5, 6, 1.2, 0.4, 1.4)).toBe(2.5);
    expect(pullBackLevel(1.2, 2.5, 6, 1.2, 0.4, 1.4)).toBe(6);
    expect(pullBackLevel(0.6, 2.5, 6, 1.2, 0.4, 1.4)).toBeCloseTo(4.25, 9);
    expect(pullBackLevel(9, 2.5, 6, 1.2, 0.4, 1.4)).toBe(0);
  });

  it('the spec numbers: +6 m over 1.2 s, the vignette pulses .25 / 1200 ms (final) and .12 / 800 ms (a band boss)', () => {
    expect(CLIMAX_EXTRA).toBe(6);
    expect(CLIMAX_RISE_S).toBe(1.2);
    expect(FINAL_PULSE).toEqual({ amount: 0.25, ms: 1200 });
    expect(BAND_PULSE).toEqual({ amount: 0.12, ms: 800 });
    expect(CLIMAX_DIST_CAP).toBe(CAMERA_DIST_MAX + 12);
  });
});

describe('CameraRig.pullBack: +6 m, back to exactly the user zoom, composed with the boss framing', () => {
  it.each([16, 22, 30])('at the user zoom %d m: +6 m at the peak, and exactly the zoom again afterwards (bit-identical to a camera that never pulled back)', (zoom) => {
    const rig = newRig(zoom);
    const control = newRig(zoom);
    expect(pose(rig).dist).toBeCloseTo(zoom, 9);
    rig.pullBack();
    expect(rig.pullBackActive).toBe(true);
    runRig(rig, CLIMAX_RISE_S);
    runRig(control, CLIMAX_RISE_S);
    expect(rig.pullBackExtra).toBeCloseTo(CLIMAX_EXTRA, 6);
    expect(pose(rig).dist).toBeCloseTo(zoom + CLIMAX_EXTRA, 6);
    runRig(rig, PB_TOTAL - CLIMAX_RISE_S + 0.2);
    runRig(control, PB_TOTAL - CLIMAX_RISE_S + 0.2);
    expect(rig.pullBackActive).toBe(false);
    expect(rig.pullBackExtra).toBe(0);
    expect(pose(rig).dist).toBeCloseTo(zoom, 9);
    expect(rig.camera.position.toArray()).toEqual(control.camera.position.toArray());
    expect(rig.distance).toBe(control.distance);
  });

  it('rises monotonically to the peak, holds, and falls monotonically back: never below the zoom, never above zoom + 6', () => {
    const rig = newRig(22);
    rig.pullBack();
    let prev = 0;
    let peakAt = -1;
    runRig(rig, PB_TOTAL + 0.1, (t) => {
      const e = rig.pullBackExtra;
      expect(e).toBeGreaterThanOrEqual(0);
      expect(e).toBeLessThanOrEqual(CLIMAX_EXTRA + 1e-9);
      if (t <= CLIMAX_RISE_S) expect(e).toBeGreaterThanOrEqual(prev - 1e-12);
      else if (t >= CLIMAX_RISE_S + CLIMAX_HOLD_S + 1 / 60) expect(e).toBeLessThanOrEqual(prev + 1e-12);
      if (e >= CLIMAX_EXTRA - 1e-6 && peakAt < 0) peakAt = t;
      prev = e;
    });
    expect(peakAt).toBeGreaterThan(CLIMAX_RISE_S - 0.05);
    expect(peakAt).toBeLessThan(CLIMAX_RISE_S + 0.05);
  });

  it('is a term of its own: the pitch, the focus and the hero\'s place on the screen stay, only the distance changes', () => {
    const rig = newRig(22);
    const control = newRig(22);
    rig.pullBack();
    runRig(rig, CLIMAX_RISE_S);
    runRig(control, CLIMAX_RISE_S);
    expect(rig.pitch).toBeCloseTo(CAMERA_PITCH, 12);
    expect(pose(rig).pitch).toBeCloseTo(CAMERA_PITCH, 9);
    expect(rig.focus.toArray()).toEqual(control.focus.toArray());
    const ndc = new Vector3().copy(rig.focus).project(rig.camera);
    expect(Math.abs(ndc.x)).toBeLessThan(1e-6);
    expect(Math.abs(ndc.y)).toBeLessThan(1e-6);
    // the hero is 22 / 28 = 79 % of its size at the peak: still well over three quarters of what it was
    expect(22 / pose(rig).dist).toBeGreaterThan(0.78);
  });

  it('the ground footprint follows the camera: wider at the peak (a point 18 m to the side comes into view), the gameplay one again after', () => {
    const rig = newRig(22);
    const fx = rig.focus.x;
    const fz = rig.focus.z;
    expect(rig.isVisible(fx + 18, fz, 0)).toBe(false);
    rig.pullBack();
    runRig(rig, CLIMAX_RISE_S);
    expect(rig.isVisible(fx + 18, fz, 0)).toBe(true);
    runRig(rig, PB_TOTAL);
    expect(rig.isVisible(fx + 18, fz, 0)).toBe(false);
  });

  it('composes with the boss framing: against a camera with the same framing and no pull-back the difference is exactly the pull-back, frame after frame, and both end on the same place', () => {
    const rig = newRig(22);
    const control = newRig(22);
    rig.setBossFraming(8); // a boss of 8 m: +6.4 m of framing, easing out over about 1 s
    control.setBossFraming(8);
    rig.pullBack();
    let framingRising = false;
    let lastControl = pose(control).dist;
    for (let i = 1; i <= 900; i++) {
      rig.update(FRAME);
      control.update(FRAME);
      expect(pose(rig).dist - pose(control).dist).toBeCloseTo(rig.pullBackExtra, 9);
      if (i < 40 && pose(control).dist > lastControl + 1e-9) framingRising = true;
      lastControl = pose(control).dist;
    }
    expect(framingRising).toBe(true); // the framing kept easing out while the pull-back ran: nothing pushed it back
    expect(rig.pullBackActive).toBe(false);
    expect(rig.camera.position.toArray()).toEqual(control.camera.position.toArray());
    expect(pose(rig).dist).toBeCloseTo(22 + 6.4, 3);
  });

  it('a boss that appears, or goes, in the middle of the pull-back does not disturb it', () => {
    const rig = newRig(22);
    const control = newRig(22);
    rig.pullBack();
    for (let i = 1; i <= 900; i++) {
      if (i === 30) {
        rig.setBossFraming(10);
        control.setBossFraming(10);
      }
      if (i === 100) {
        rig.setBossFraming(0);
        control.setBossFraming(0);
      }
      rig.update(FRAME);
      control.update(FRAME);
      expect(pose(rig).dist - pose(control).dist).toBeCloseTo(rig.pullBackExtra, 9);
    }
    expect(rig.camera.position.toArray()).toEqual(control.camera.position.toArray());
    expect(pose(rig).dist).toBeCloseTo(22, 2);
  });

  it('a zoom change during the pull-back is honoured: it ends on the NEW zoom', () => {
    const rig = newRig(22);
    rig.pullBack();
    runRig(rig, 1);
    rig.setZoom(18);
    runRig(rig, PB_TOTAL + 2);
    expect(rig.pullBackActive).toBe(false);
    expect(pose(rig).dist).toBeCloseTo(18, 6);
  });

  it('never takes the camera past the widest zoom plus the largest boss framing: it only uses what is left of CLIMAX_DIST_CAP', () => {
    // the player is already at the far end: widest zoom + the biggest boss framing = the cap, nothing left
    const wide = newRig(30);
    wide.setBossFraming(30);
    runRig(wide, 12); // the framing settles at +12
    expect(wide.distance).toBeCloseTo(CLIMAX_DIST_CAP, 3);
    wide.pullBack();
    let maxExtra = 0;
    runRig(wide, PB_TOTAL, () => {
      maxExtra = Math.max(maxExtra, wide.pullBackExtra);
      expect(pose(wide).dist).toBeLessThanOrEqual(CLIMAX_DIST_CAP + 1e-6);
    });
    expect(maxExtra).toBeLessThan(0.01);
    // 2 m short of the cap: at most 2 m of pull-back
    const near = newRig(28);
    near.setBossFraming(30);
    runRig(near, 12);
    near.pullBack();
    maxExtra = 0;
    runRig(near, PB_TOTAL, () => {
      maxExtra = Math.max(maxExtra, near.pullBackExtra);
      expect(pose(near).dist).toBeLessThanOrEqual(CLIMAX_DIST_CAP + 1e-6);
    });
    expect(maxExtra).toBeGreaterThan(1.9);
    expect(maxExtra).toBeLessThanOrEqual(2 + 1e-3); // the framing settles from below: a hair more room early on
    // the widest zoom alone (no boss framing) still gets the full 6 m (30 + 6 = 36 < 42)
    const alone = newRig(30);
    alone.pullBack();
    runRig(alone, CLIMAX_RISE_S);
    expect(alone.pullBackExtra).toBeCloseTo(6, 6);
  });

  it('follows the screen-shake setting: 0 = no camera motion at all, 0.5 = half the distance', () => {
    const off = newRig(22);
    off.shakeScale = 0;
    off.pullBack();
    runRig(off, CLIMAX_RISE_S, () => expect(off.pullBackExtra).toBe(0));
    expect(pose(off).dist).toBeCloseTo(22, 9);
    const half = newRig(22);
    half.shakeScale = 0.5;
    half.pullBack();
    runRig(half, CLIMAX_RISE_S);
    expect(half.pullBackExtra).toBeCloseTo(3, 6);
    expect(pose(half).dist).toBeCloseTo(25, 6);
  });

  it('runs on the frame clock, so a stalled frame (a 250 ms hitch) cannot swallow it; a pause does not stop it', () => {
    const rig = newRig(22);
    rig.pullBack();
    rig.update(0.25); // FLY_IN_MAX_STEP of it, not 250 ms
    expect(rig.pullBackExtra).toBeCloseTo(6 * easeInOut(FLY_IN_MAX_STEP / CLIMAX_RISE_S), 9);
    expect(rig.pullBackExtra).toBeLessThan(0.05);
    // no sim is involved: only `update` moves it (a paused sim, an open card, the pause menu: the camera still plays it to the end)
    runRig(rig, PB_TOTAL + 0.1);
    expect(rig.pullBackActive).toBe(false);
  });

  it('a second pull-back continues from the level reached (no jump); cancelPullBack ends it at once; nonsense starts nothing', () => {
    const rig = newRig(22);
    rig.pullBack();
    runRig(rig, 0.6);
    const mid = rig.pullBackExtra;
    expect(mid).toBeGreaterThan(1);
    expect(mid).toBeLessThan(6);
    rig.pullBack(); // again: from `mid`, not from 0
    rig.update(0);
    expect(rig.pullBackExtra).toBeCloseTo(mid, 9);
    runRig(rig, CLIMAX_RISE_S);
    expect(rig.pullBackExtra).toBeCloseTo(6, 6);
    rig.cancelPullBack();
    expect(rig.pullBackActive).toBe(false);
    expect(rig.pullBackExtra).toBe(0);
    rig.update(FRAME);
    expect(pose(rig).dist).toBeCloseTo(22, 9);
    for (const bad of [() => rig.pullBack(0), () => rig.pullBack(-3), () => rig.pullBack(NaN), () => rig.pullBack(6, 0), () => rig.pullBack(6, 1, -1), () => rig.pullBack(6, 1, 0.4, 0)]) {
      bad();
      expect(rig.pullBackActive).toBe(false);
    }
  });

  it('a camera that never pulled back is exactly what it was (no extra term, bit for bit)', () => {
    const a = newRig(22);
    const b = newRig(22);
    a.setBossFraming(9);
    b.setBossFraming(9);
    runRig(a, 3);
    runRig(b, 3);
    expect(a.camera.position.toArray()).toEqual(b.camera.position.toArray());
    expect(a.pullBackExtra).toBe(0);
    expect(a.pullBackActive).toBe(false);
  });
});

describe('parseClimaxOff: the QA switch of the boss-spawn staging', () => {
  it('finds noclimax among the up= words (any case, comma separated), only for QA', () => {
    expect(parseClimaxOff('?up=noclimax', true)).toBe(true);
    expect(parseClimaxOff('?quality=high&up=noarc,NoClimax', true)).toBe(true);
    expect(parseClimaxOff('?up=noarc,nocorr', true)).toBe(false);
    expect(parseClimaxOff('?up=noflyin', true)).toBe(false);
    expect(parseClimaxOff('?up=noclimax', false)).toBe(false);
    expect(parseClimaxOff('', true)).toBe(false);
    expect(parseClimaxOff(null, true)).toBe(false);
    // the other switch still reads its own word only
    expect(parseFlyInOff('?up=noclimax', true)).toBe(false);
    expect(parseFlyInOff('?up=noflyin,noclimax', true)).toBe(true);
  });
});

/** a PostPipeline stand-in (no WebGL): the router finds it through `asPostPipeline` (instanceof) and calls pulseVignette */
function postStub(): { post: PostPipeline; pulses: [number, number][] } {
  const pulses: [number, number][] = [];
  const post = Object.create(PostPipeline.prototype) as PostPipeline;
  post.pulseVignette = (amount: number, ms: number): void => void pulses.push([amount, ms]);
  return { post, pulses };
}

/** one sim step that emitted a bossSpawn, dispatched to the router like the run does */
function spawnBoss(world: unknown, final: boolean): void {
  const bus = new EventBus();
  bus.bossSpawn(1, 1, 'boss_a', 0, 0, final);
  runEvents.dispatch(bus.list, world as World);
}

describe('RenderEventRouter: the boss-spawn staging (FEEL-03)', () => {
  it('the final boss: the camera backs off +6 m over 1.2 s, eases back to exactly the user zoom, and the vignette pulses .25 / 1200 ms', () => {
    const { post, pulses } = postStub();
    const h = harness({ composer: post });
    start(h);
    h.rig.cancelCinematic();
    h.rig.snap();
    h.frame(); // the gameplay camera
    const zoom = pose(h.rig).dist;
    spawnBoss(h.world, true);
    expect(pulses).toEqual([[0.25, 1200]]);
    expect(h.rig.pullBackActive).toBe(true);
    for (let i = 0; i < 72; i++) h.frame();
    expect(h.rig.pullBackExtra).toBeCloseTo(6, 6);
    expect(pose(h.rig).dist).toBeCloseTo(zoom + 6, 6);
    for (let i = 0; i < 200; i++) h.frame();
    expect(h.rig.pullBackActive).toBe(false);
    expect(pose(h.rig).dist).toBeCloseTo(zoom, 9);
  });

  it('a band boss: only the smaller vignette pulse (.12 / 800 ms), the camera is left alone', () => {
    const { post, pulses } = postStub();
    const h = harness({ composer: post });
    start(h);
    h.rig.cancelCinematic();
    spawnBoss(h.world, false);
    expect(pulses).toEqual([[0.12, 800]]);
    expect(h.rig.pullBackActive).toBe(false);
  });

  it('the screen-shake setting scales the camera part (0 = no motion) and leaves the vignette pulse', () => {
    const { post, pulses } = postStub();
    const h = harness({ composer: post, shake: 0 });
    start(h);
    h.rig.cancelCinematic();
    h.rig.snap();
    h.frame();
    const zoom = pose(h.rig).dist;
    spawnBoss(h.world, true);
    for (let i = 0; i < 72; i++) {
      h.frame();
      expect(h.rig.pullBackExtra).toBe(0);
    }
    expect(pose(h.rig).dist).toBeCloseTo(zoom, 9);
    expect(pulses).toEqual([[0.25, 1200]]);
  });

  it('prefers-reduced-motion drops the camera move, the vignette pulse (a light change, not motion) stays', () => {
    const { post, pulses } = postStub();
    const h = harness({ composer: post });
    start(h);
    h.rig.cancelCinematic();
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce') }));
    try {
      spawnBoss(h.world, true);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(h.rig.pullBackActive).toBe(false);
    expect(pulses).toEqual([[0.25, 1200]]);
  });

  it('up=noclimax (QA) switches the whole staging off: the same-tree "before" arm of a blind pair', () => {
    const { post, pulses } = postStub();
    const h = harness({ composer: post });
    start(h);
    h.rig.cancelCinematic();
    vi.stubGlobal('location', { search: '?quality=high&up=noclimax' });
    try {
      spawnBoss(h.world, true);
      spawnBoss(h.world, false);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(h.rig.pullBackActive).toBe(false);
    expect(pulses).toEqual([]);
  });

  it('a co-op guest stages it like the host (the events reach both), and a plain run too', () => {
    for (const guest of [false, true]) {
      const { post, pulses } = postStub();
      const h = harness({ composer: post, guest });
      start(h);
      h.rig.cancelCinematic();
      spawnBoss(h.world, true);
      expect(h.rig.pullBackActive).toBe(true);
      expect(pulses).toEqual([[0.25, 1200]]);
    }
  });

  it('a new run and the end of a run drop a pull-back in flight: the next run never starts out of position', () => {
    const { post } = postStub();
    const h = harness({ composer: post });
    start(h);
    h.rig.cancelCinematic();
    h.rig.snap();
    h.frame();
    const zoom = pose(h.rig).dist;
    spawnBoss(h.world, true);
    for (let i = 0; i < 40; i++) h.frame();
    expect(h.rig.pullBackExtra).toBeGreaterThan(1);
    end(h); // death / victory / abandon during the climax
    expect(h.rig.pullBackActive).toBe(false);
    h.frame();
    expect(pose(h.rig).dist).toBeCloseTo(zoom, 9);
    start(h);
    h.rig.cancelCinematic();
    spawnBoss(h.world, true);
    h.frame();
    start(h); // a restart in the middle of it
    expect(h.rig.pullBackActive).toBe(false);
  });

  it('a core without a composite pass or a rig without the pull-back (menu previews, stand-ins) is left alone', () => {
    const h = harness(); // composer: null
    start(h);
    h.rig.cancelCinematic();
    expect(() => spawnBoss(h.world, true)).not.toThrow();
    expect(h.rig.pullBackActive).toBe(true); // the rig is real, the composite pass is not there
    const stub = new RenderEventRouter({ core: { rig: { shakeScale: 1 } }, shake: () => undefined } as unknown as RenderWorld);
    stub.attach();
    routers.push(stub);
    expect(() => spawnBoss({ players: [] }, true)).not.toThrow();
    expect(() => spawnBoss({ players: [] }, false)).not.toThrow();
  });
});
