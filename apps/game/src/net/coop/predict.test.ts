import { describe, expect, it } from 'vitest';
import { Surface } from '../../sim/constants';
import { dropSkills, freezeSchedules, clearEnemies, makeWorld } from '../../sim/__tests__/helpers';
import type { WorldEnv } from '../../sim/types';
import { HeroPredictor, newMoveState, stepMove, type MoveEnv, type MoveParams, type MoveState } from './predict';
import type { PlayerWire } from './protocol';

/** deterministic pseudo-random input script */
function inputAt(t: number): [number, number] {
  const phase = Math.floor(t / 23);
  const a = Math.sin(phase * 12.9898) * 43758.5453;
  const ang = (a - Math.floor(a)) * Math.PI * 2;
  const mag = phase % 7 === 0 ? 0 : phase % 5 === 0 ? 1.7 : 0.4 + (phase % 3) * 0.3;
  return [Math.cos(ang) * mag, Math.sin(ang) * mag];
}

const OBSTACLE = { x: 14, z: 3, r: 3 };
const TERRAIN: WorldEnv = {
  arenaRadius: 60,
  surfaceAt: (x, z) => (x > 20 ? Surface.Ice : z < -15 ? Surface.Shallow : 0),
  moveCircle: (x0, z0, x1, z1, r, out) => {
    // push the destination out of the obstacle circle
    const dx = x1 - OBSTACLE.x;
    const dz = z1 - OBSTACLE.z;
    const d = Math.hypot(dx, dz);
    const min = OBSTACLE.r + r;
    if (d < min && d > 1e-6) {
      out.x = OBSTACLE.x + (dx / d) * min;
      out.z = OBSTACLE.z + (dz / d) * min;
      return false;
    }
    out.x = x1;
    out.z = z1;
    return true;
  },
};

describe('stepMove mirrors the sim', () => {
  for (const [name, env] of [
    ['open field', undefined],
    ['obstacle + ice + shallows', TERRAIN],
  ] as const) {
    it(`matches updatePlayers tick for tick (${name})`, () => {
      const w = makeWorld(env ? { env } : {});
      freezeSchedules(w);
      clearEnemies(w);
      dropSkills(w, 0);
      const p = w.players[0]!;
      const ms: MoveState = newMoveState();
      ms.x = p.x;
      ms.z = p.z;
      ms.rot = p.rot;
      const params: MoveParams = { moveSpeed: p.stats.moveSpeed, slowMul: 1, radius: p.radius, castLock: false };
      const menv: MoveEnv = { arenaRadius: w.arenaRadius, walkable: w.env.walkable, moveCircle: w.env.moveCircle, surfaceAt: w.env.surfaceAt };
      let maxErr = 0;
      for (let t = 0; t < 60 * 40; t++) {
        if (t === 400) {
          p.kvx = 9;
          p.kvz = -4;
          ms.kvx = 9;
          ms.kvz = -4;
        }
        if (t === 700) {
          p.dashT = 0.25;
          p.dashVx = 18;
          p.dashVz = 6;
          ms.dashT = 0.25;
          ms.dashVx = 18;
          ms.dashVz = 6;
        }
        const [mx, mz] = t > 1500 ? [1, 0.2] : inputAt(t);
        w.step([{ moveX: mx, moveZ: mz }]);
        stepMove(ms, mx, mz, params, menv);
        maxErr = Math.max(maxErr, Math.abs(ms.x - p.x), Math.abs(ms.z - p.z), Math.abs(ms.vx - p.vx), Math.abs(ms.rot - p.rot));
      }
      expect(maxErr).toBeLessThan(1e-9);
      // the field is left behind: the run really covered ground and hit the boundary / obstacle logic
      expect(Math.hypot(p.x, p.z)).toBeGreaterThan(5);
    });
  }
});

function wireOf(s: MoveState, ackSeq: number, ackAge: number, moveSpeed: number): PlayerWire {
  return {
    alive: true,
    connected: true,
    x: s.x,
    z: s.z,
    vx: s.vx,
    vz: s.vz,
    kvx: s.kvx,
    kvz: s.kvz,
    dashT: s.dashT,
    dashVx: s.dashVx,
    dashVz: s.dashVz,
    rot: s.rot,
    clip: 1,
    moveSpeed,
    slowMul: 1,
    corrupted: 0,
    hp: 100,
    hpMax: 100,
    shield: 0,
    level: 1,
    xp: 0,
    xpNext: 10,
    yeop: 0,
    shards: 0,
    kills: 0,
    ackSeq,
    ackAge,
    hudVer: 1,
    cds: [],
  };
}

interface Link {
  predictor: HeroPredictor;
  maxJump: number;
  sumJump: number;
  n: number;
  snaps: number;
}

/**
 * Guest ↔ host loop in whole ticks: the guest predicts and sends its held input every tick (arrives `up` ticks later), the
 * host applies the newest arrived input before each step and snapshots every 4th tick (arrives `down` ticks later with the
 * ack the real host stamps: seq of the held input, ticks it has been in effect).
 */
function simulate(opts: { up: (w: number) => number; down: (w: number) => number; ticks: number; warm: number }): Link {
  const env: MoveEnv = { arenaRadius: 80 };
  const params: MoveParams = { moveSpeed: 5.6, slowMul: 1, radius: 0.55, castLock: false };
  const truth = newMoveState();
  const predictor = new HeroPredictor(env);
  predictor.snapTo(wireOf(truth, 0, 0, 5.6));
  const link: Link = { predictor, maxJump: 0, sumJump: 0, n: 0, snaps: 0 };
  const hostInbox: { at: number; seq: number; mx: number; mz: number }[] = [];
  const guestInbox: { at: number; wire: PlayerWire }[] = [];
  let held = { seq: 0, mx: 0, mz: 0 };
  let recvTick = 0;
  let hostTick = 0;
  let lastAt = 0;
  for (let w = 1; w <= opts.ticks; w++) {
    // network → guest (snapshots), in order
    while (guestInbox.length > 0 && (guestInbox[0] as { at: number }).at <= w) {
      const s = guestInbox.shift() as { at: number; wire: PlayerWire };
      const r = predictor.reconcile(s.wire, true);
      if (w > opts.warm) {
        link.maxJump = Math.max(link.maxJump, r.jump);
        link.sumJump += r.jump;
        link.n++;
        if (r.snapped) link.snaps++;
      }
    }
    // guest: send held input, predict
    const [mx, mz] = inputAt(w);
    const at = Math.max(w + opts.up(w), lastAt);
    lastAt = at;
    hostInbox.push({ at, seq: predictor.tick, mx, mz });
    predictor.step(mx, mz, true);
    // host: newest arrived input, step, snapshot
    while (hostInbox.length > 0 && (hostInbox[0] as { at: number }).at <= w) {
      const m = hostInbox.shift() as { at: number; seq: number; mx: number; mz: number };
      held = m;
      recvTick = hostTick;
    }
    stepMove(truth, held.mx, held.mz, params, env);
    hostTick++;
    if (w % 4 === 0) guestInbox.push({ at: w + opts.down(w), wire: wireOf(truth, held.seq, hostTick - recvTick, 5.6) });
  }
  return link;
}

describe('HeroPredictor reconciliation', () => {
  it('is exact when the latency is constant (no visible correction at all)', () => {
    const l = simulate({ up: () => 5, down: () => 5, ticks: 1200, warm: 120 });
    expect(l.n).toBeGreaterThan(200);
    expect(l.maxJump).toBeLessThan(1e-6);
    expect(l.snaps).toBe(0);
  });

  it('stays within a couple of ticks of travel under jitter', () => {
    let s = 7;
    const rnd = (): number => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x100000000;
    };
    const l = simulate({ up: () => 4 + Math.floor(rnd() * 3), down: () => 4 + Math.floor(rnd() * 3), ticks: 2400, warm: 120 });
    // the hero moves 5.6 m/s = 9.3 cm per tick; arrival jitter of ±1 tick can displace the host path by that much
    expect(l.maxJump).toBeLessThan(0.5);
    expect(l.sumJump / l.n).toBeLessThan(0.1);
    expect(l.snaps).toBe(0);
  });

  it('keeps the rendered position continuous across a correction and then converges', () => {
    const env: MoveEnv = { arenaRadius: 80 };
    const p = new HeroPredictor(env);
    const truth = newMoveState();
    p.snapTo(wireOf(truth, 0, 0, 5.6));
    for (let i = 0; i < 30; i++) p.step(1, 0, true);
    const beforeX = p.renderX;
    // the host says the hero is 1.2 m behind where the guest believes it is
    const auth = newMoveState();
    auth.x = p.state.x - 1.2;
    auth.vx = p.state.vx;
    const r = p.reconcile(wireOf(auth, 31, 0, 5.6), true);
    expect(r.snapped).toBe(false);
    expect(r.jump).toBeCloseTo(1.2, 5);
    expect(p.renderX).toBeCloseTo(beforeX, 5);
    for (let i = 0; i < 60; i++) p.step(0, 0, true);
    expect(Math.abs(p.errX)).toBeLessThan(0.01);
  });

  it('snaps on a large divergence and while the sim is not running', () => {
    const p = new HeroPredictor({ arenaRadius: 80 });
    const a = newMoveState();
    p.snapTo(wireOf(a, 0, 0, 5.6));
    for (let i = 0; i < 10; i++) p.step(1, 0, true);
    a.x = 40;
    expect(p.reconcile(wireOf(a, 10, 0, 5.6), true).snapped).toBe(true);
    expect(p.renderX).toBeCloseTo(40 + p.state.x - 40, 5);
    expect(Math.abs(p.errX)).toBe(0);
    // paused host: no prediction, the hero stands where the host says
    for (let i = 0; i < 10; i++) p.step(1, 0, false);
    const x = p.state.x;
    expect(x).toBeLessThan(41);
    a.x = 12;
    p.reconcile(wireOf(a, 10, 0, 5.6), false);
    expect(p.state.x).toBe(12);
  });

  it('predicts and reconciles manual-cast aim facing tick for tick with updatePlayers (NET-04)', () => {
    const w = makeWorld();
    freezeSchedules(w);
    clearEnemies(w);
    dropSkills(w, 0);
    const hero = w.players[0]!;
    const ms: MoveState = newMoveState();
    ms.x = hero.x;
    ms.z = hero.z;
    ms.rot = hero.rot;
    const params: MoveParams = { moveSpeed: hero.stats.moveSpeed, slowMul: 1, radius: hero.radius, castLock: false };
    const menv: MoveEnv = { arenaRadius: w.arenaRadius, walkable: w.env.walkable, moveCircle: w.env.moveCircle, surfaceAt: w.env.surfaceAt };

    // Running +X while firing manual attack aimed along -Z -> facing snaps to Math.PI (not +X movement).
    for (let t = 0; t < 20; t++) {
      const aimNow = t === 5 || t === 12;
      const aimX = aimNow ? 0 : undefined;
      const aimZ = aimNow ? -1 : undefined;
      w.step([{ moveX: 1, moveZ: 0, manualCast: true, attack: aimNow, ...(aimNow ? { aimX, aimZ } : {}) }]);
      stepMove(ms, 1, 0, params, menv, aimNow ? Math.atan2(0, -1) : NaN);
      expect(ms.rot).toBeCloseTo(hero.rot, 9);
    }

    // HeroPredictor records manual aim in its history ring so reconcile() replays aimed facing accurately.
    const predictor = new HeroPredictor({ arenaRadius: 80 });
    const base = newMoveState();
    predictor.snapTo(wireOf(base, 0, 0, 5.6));
    predictor.step(0, 0, true, Math.PI / 2); // tick 1 aimed along +X
    expect(predictor.state.rot).toBeCloseTo(Math.PI / 2, 6);
    predictor.step(0, 0, true, NaN); // tick 2 holds facing
    // Authoritative snapshot acking before tick 1 arrives with rot = 0; reconcile must replay tick 1's manual aim.
    predictor.reconcile(wireOf(base, 0, 0, 5.6), true);
    expect(predictor.state.rot).toBeCloseTo(Math.PI / 2, 6);
  });
});
