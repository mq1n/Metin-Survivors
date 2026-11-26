// Client-side prediction of the LOCAL hero's locomotion (guest only).
//
// `stepMove` is a line-for-line copy of the movement part of sim/player.ts `updatePlayers` (acceleration toward the held
// input, dash / knockback integration, arena clamp, terrain collision, facing). A test drives the real sim and this function
// with the same inputs and demands identical positions, so any drift of the sim's movement shows up there.
//
// Input model: the guest HOLDS the last input it sent (20 Hz zero-order hold, quantised to 1/127). The host applies exactly
// that held input on its own ticks after the message arrives; the guest applies it immediately. `HeroPredictor` keeps the
// held input per local tick, and on every snapshot rewinds to the authoritative state (position, velocity, knockback, dash)
// and re-applies the ticks the host has not seen yet (reconciliation). The remaining visual error is smoothed away.

import { DT, Surface } from '../../sim/constants';
import type { WorldEnv } from '../../sim/types';
import type { PlayerWire } from './protocol';

const ACCEL = 16;
const TAU = Math.PI * 2;

export interface MoveEnv {
  /** playable radius around the origin (the sim keeps heroes `arenaRadius − 0.5` inside) */
  arenaRadius: number;
  walkable?: WorldEnv['walkable'];
  moveCircle?: WorldEnv['moveCircle'];
  surfaceAt?: WorldEnv['surfaceAt'];
}

export interface MoveState {
  x: number;
  z: number;
  vx: number;
  vz: number;
  kvx: number;
  kvz: number;
  dashT: number;
  dashVx: number;
  dashVz: number;
  rot: number;
  speed: number;
}

export interface MoveParams {
  moveSpeed: number;
  slowMul: number;
  radius: number;
  /** hero is casting (rotation frozen) */
  castLock: boolean;
}

export function newMoveState(): MoveState {
  return { x: 0, z: 0, vx: 0, vz: 0, kvx: 0, kvz: 0, dashT: 0, dashVx: 0, dashVz: 0, rot: 0, speed: 0 };
}

const moveOut = { x: 0, z: 0 };

/** Advances `s` by one fixed tick under held input (mx, mz). Mirrors sim/player.ts updatePlayers. */
export function stepMove(s: MoveState, inX: number, inZ: number, p: MoveParams, env: MoveEnv, aimRot = NaN): void {
  let mx = inX;
  let mz = inZ;
  const ml = Math.hypot(mx, mz);
  if (ml > 1) {
    mx /= ml;
    mz /= ml;
  } else if (!Number.isFinite(ml)) {
    mx = 0;
    mz = 0;
  }
  const surf = env.surfaceAt ? env.surfaceAt(s.x, s.z) : 0;
  let vx: number;
  let vz: number;
  if (s.dashT > 0) {
    s.dashT -= DT;
    vx = s.dashVx;
    vz = s.dashVz;
    if (s.dashT <= 0) {
      s.dashT = 0;
      s.vx = mx * p.moveSpeed;
      s.vz = mz * p.moveSpeed;
    }
  } else {
    const speed = p.moveSpeed * p.slowMul * (surf === Surface.Shallow ? 0.8 : surf === Surface.Miasma ? 0.9 : 1);
    const tx = mx * speed;
    const tz = mz * speed;
    const k = Math.min(1, ACCEL * (surf === Surface.Ice ? 0.2 : 1) * DT);
    s.vx += (tx - s.vx) * k;
    s.vz += (tz - s.vz) * k;
    vx = s.vx;
    vz = s.vz;
  }

  let kx = s.kvx;
  let kz = s.kvz;
  if (kx !== 0 || kz !== 0) {
    const decay = Math.exp(-9 * DT);
    s.kvx *= decay;
    s.kvz *= decay;
    if (Math.abs(s.kvx) < 0.02) s.kvx = 0;
    if (Math.abs(s.kvz) < 0.02) s.kvz = 0;
    kx = s.kvx;
    kz = s.kvz;
  }

  let nx = s.x + (vx + kx) * DT;
  let nz = s.z + (vz + kz) * DT;
  const arena = env.arenaRadius - 0.5;
  const rr = Math.hypot(nx, nz);
  if (rr > arena) {
    nx = (nx / rr) * arena;
    nz = (nz / rr) * arena;
  }
  if (env.moveCircle) {
    env.moveCircle(s.x, s.z, nx, nz, p.radius, moveOut);
    nx = moveOut.x;
    nz = moveOut.z;
  } else if (env.walkable && !env.walkable(nx, nz)) {
    if (env.walkable(nx, s.z)) nz = s.z;
    else if (env.walkable(s.x, nz)) nx = s.x;
    else {
      nx = s.x;
      nz = s.z;
    }
  }
  s.x = nx;
  s.z = nz;
  const sp = Math.hypot(vx, vz);
  s.speed = sp;
  if (Number.isFinite(aimRot)) {
    s.rot = aimRot;
  } else if (sp > 0.4 && !p.castLock) {
    const want = Math.atan2(vx, vz);
    let d = want - s.rot;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    s.rot += d * Math.min(1, 14 * DT);
  }
}

const HIST = 512;

export interface ReconcileResult {
  /** metres the predicted position moved because of the correction */
  jump: number;
  snapped: boolean;
}

export class HeroPredictor {
  readonly state: MoveState = newMoveState();
  readonly params: MoveParams = { moveSpeed: 5, slowMul: 1, radius: 0.55, castLock: false };
  /** local tick counter; the next input sent carries `tick` as its seq (starts at 1: seq 0 means "host has none") */
  tick = 1;
  /** visual correction offset, decays toward 0 */
  errX = 0;
  errZ = 0;
  private readonly hx = new Float32Array(HIST);
  private readonly hz = new Float32Array(HIST);
  private readonly hAim = new Float32Array(HIST).fill(NaN);
  private initialised = false;

  constructor(private readonly env: MoveEnv) {}

  get ready(): boolean {
    return this.initialised;
  }

  /** hard reset to an authoritative state (run start, respawn, long gap) */
  snapTo(a: PlayerWire): void {
    const s = this.state;
    s.x = a.x;
    s.z = a.z;
    s.vx = a.vx;
    s.vz = a.vz;
    s.kvx = a.kvx;
    s.kvz = a.kvz;
    s.dashT = a.dashT;
    s.dashVx = a.dashVx;
    s.dashVz = a.dashVz;
    s.rot = a.rot;
    this.errX = 0;
    this.errZ = 0;
    this.initialised = true;
  }

  private params_(a: PlayerWire): void {
    this.params.moveSpeed = a.moveSpeed;
    this.params.slowMul = a.slowMul;
    this.params.castLock = a.clip === 2;
  }

  /** applies held input (and optional manual-combat aim facing) for the current local tick and advances the counter */
  step(mx: number, mz: number, simRunning: boolean, aimRot = NaN): void {
    const i = this.tick & (HIST - 1);
    this.hx[i] = mx;
    this.hz[i] = mz;
    this.hAim[i] = aimRot;
    this.tick++;
    const decay = Math.exp(-DT / 0.12);
    this.errX *= decay;
    this.errZ *= decay;
    if (!this.initialised || !simRunning) return;
    stepMove(this.state, mx, mz, this.params, this.env, aimRot);
  }

  /** drops the correction offset (teleports, respawns) */
  clearError(): void {
    this.errX = 0;
    this.errZ = 0;
  }

  /**
   * Rewinds to the authoritative state `a` (valid for local tick `ackSeq + ackAge`) and re-applies the inputs of the ticks
   * the host has not simulated yet. `a.ackSeq === 0` means the host has not received any input from us.
   */
  reconcile(a: PlayerWire, simRunning: boolean): ReconcileResult {
    const s = this.state;
    const ox = s.x;
    const oz = s.z;
    const first = !this.initialised;
    this.params_(a);
    if (!a.alive || !simRunning) {
      this.snapTo(a);
      return { jump: 0, snapped: !first };
    }
    let from = a.ackSeq === 0 ? 1 : a.ackSeq + a.ackAge;
    if (from > this.tick) from = this.tick;
    if (this.tick - from >= HIST - 2) {
      this.snapTo(a);
      return { jump: Math.hypot(ox - a.x, oz - a.z), snapped: !first };
    }
    s.x = a.x;
    s.z = a.z;
    s.vx = a.vx;
    s.vz = a.vz;
    s.kvx = a.kvx;
    s.kvz = a.kvz;
    s.dashT = a.dashT;
    s.dashVx = a.dashVx;
    s.dashVz = a.dashVz;
    s.rot = a.rot;
    for (let t = from; t < this.tick; t++) {
      const i = t & (HIST - 1);
      stepMove(s, this.hx[i] as number, this.hz[i] as number, this.params, this.env, this.hAim[i] as number);
    }
    if (first) {
      // the first snapshot (inputs sent before it was taken are still in flight): start from the replayed state
      this.initialised = true;
      this.errX = 0;
      this.errZ = 0;
      return { jump: 0, snapped: false };
    }
    const dx = ox - s.x;
    const dz = oz - s.z;
    const jump = Math.hypot(dx, dz);
    if (jump > 2.5) {
      this.errX = 0;
      this.errZ = 0;
      return { jump, snapped: true };
    }
    // keep what is on screen continuous: the offset absorbs the correction and decays
    this.errX += dx;
    this.errZ += dz;
    return { jump, snapped: false };
  }

  get renderX(): number {
    return this.state.x + this.errX;
  }
  get renderZ(): number {
    return this.state.z + this.errZ;
  }
}
