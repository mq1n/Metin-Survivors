// Deterministic autoplayer: kites in circles, avoids packed enemies, collects pickups, walks to metins, picks card 0.

import { MetinPhase } from '../types';
import type { PlayerInput } from '../stores';
import type { World } from '../world';
import { drainModals } from './helpers';

export interface BotOpts {
  /** seconds of sim time before the bot starts hunting metins */
  metinAfter?: number;
}

/** movement input for the next tick */
export function botInput(w: World, tick: number, opts: BotOpts = {}): PlayerInput {
  const p = w.players[0];
  if (!p || !p.alive) return { moveX: 0, moveZ: 0 };
  const e = w.enemies;
  let rx = 0;
  let rz = 0;
  let near = 0;
  let nearD2 = 1e9;
  let nearX = 0;
  let nearZ = 0;
  // repulsion from nearby enemies; remember the closest creature so a thin crowd is engaged instead of kited forever
  for (let i = 0; i < e.count; i++) {
    const dx = p.x - (e.x[i] as number);
    const dz = p.z - (e.z[i] as number);
    const d2 = dx * dx + dz * dz;
    if (d2 < 1e-6) continue;
    const flagged = ((e.flags[i] as number) & 8) !== 0;
    if (flagged) continue;
    if (d2 < nearD2) {
      nearD2 = d2;
      nearX = -dx;
      nearZ = -dz;
    }
    if (d2 > 49) continue;
    near++;
    const d = Math.sqrt(d2);
    const k = 1 / (d2 + 0.6);
    rx += (dx / d) * k;
    rz += (dz / d) * k;
  }
  let ex = 0;
  let ez = 0;
  // fight like a player: walk into a thin crowd, flee a dense one
  const dense = near >= 14;
  if (!dense && nearD2 > 9 && nearD2 < 900) {
    const d = Math.sqrt(nearD2);
    ex = nearX / d;
    ez = nearZ / d;
  }
  // pickups pull
  let ax = 0;
  let az = 0;
  const P = w.pickups;
  let best = 144;
  for (let i = 0; i < P.count; i++) {
    const dx = (P.x[i] as number) - p.x;
    const dz = (P.z[i] as number) - p.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < best && P.magnet[i] === 0) {
      best = d2;
      const d = Math.sqrt(d2) || 1;
      ax = dx / d;
      az = dz / d;
    }
  }
  // metin pull (walk up to it and circle it so skills reach it)
  let mx = 0;
  let mz = 0;
  const metinAfter = opts.metinAfter ?? 0;
  if (w.time >= metinAfter && w.bosses.length === 0) {
    for (const m of w.metins) {
      if (m.phase !== MetinPhase.Alive && m.phase !== MetinPhase.Awakened) continue;
      if (m.great) continue;
      const dx = m.x - p.x;
      const dz = m.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 1e-6) continue;
      if (d > 3.4) {
        mx = dx / d;
        mz = dz / d;
      } else {
        mx = (-dz / d) * 0.8;
        mz = (dx / d) * 0.8;
      }
      break;
    }
  }
  // bosses: close to fighting range, then circle
  if (w.bosses.length > 0) {
    const b = w.bosses[0];
    const row = b ? e.find(b.enemy) : -1;
    if (row >= 0) {
      const dx = (e.x[row] as number) - p.x;
      const dz = (e.z[row] as number) - p.z;
      const d = Math.hypot(dx, dz);
      if (d > 9) {
        mx = dx / d;
        mz = dz / d;
      } else {
        mx = (-dz / d) * 0.9;
        mz = (dx / d) * 0.9;
      }
    }
  }
  // circling component keeps the hero moving
  const a = tick * 0.02;
  const rep = dense ? 3 : 0.8;
  let vx = Math.cos(a) * 0.5 + rx * rep + ax * 0.6 + mx * 2.2 + ex * 1.4;
  let vz = Math.sin(a) * 0.5 + rz * rep + az * 0.6 + mz * 2.2 + ez * 1.4;
  // keep inside the arena
  const r = Math.hypot(p.x, p.z);
  const limit = w.arenaRadius - 14;
  if (r > limit) {
    vx -= (p.x / r) * (r - limit) * 0.3;
    vz -= (p.z / r) * (r - limit) * 0.3;
  }
  const m = Math.hypot(vx, vz) || 1;
  return { moveX: vx / m, moveZ: vz / m };
}

export interface BotRun {
  ticks: number;
  /** number of times the invariants were checked */
  checks: number;
}

/**
 * run the bot until the run ends or `maxSeconds` of sim time pass.
 * `onTick` is called after every step (invariant checks).
 */
export function runBot(w: World, maxSeconds: number, onTick?: (w: World, tick: number) => void, opts: BotOpts = {}): BotRun {
  const maxTicks = Math.round(maxSeconds * 60);
  let tick = 0;
  let checks = 0;
  while (tick < maxTicks && !w.over) {
    drainModals(w);
    w.step([botInput(w, tick, opts)]);
    tick++;
    if (onTick) {
      onTick(w, tick);
      checks++;
    }
  }
  return { ticks: tick, checks };
}
