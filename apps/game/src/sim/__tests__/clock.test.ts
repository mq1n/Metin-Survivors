// One run clock: world.time (seconds of unpaused play) drives the HUD timer, time-scaled difficulty, the boss schedule and
// RunResult.time. Modals freeze it; a finished run freezes it; the result carries exactly the value the HUD shows.

import { describe, expect, it } from 'vitest';
import { DEFEAT_DELAY, DT, VICTORY_DELAY } from '../constants';
import { hud } from '../hud';
import { beginVictory, grantXp } from '../progress';
import { hurtPlayer, HurtKind } from '../combat';
import type { World } from '../world';
import { clearEnemies, freezeSchedules, makeWorld, NO_INPUT, player, runTicks } from './helpers';

function calm(): World {
  const w = makeWorld();
  freezeSchedules(w);
  clearEnemies(w);
  return w;
}

function kill(w: World): void {
  const p = player(w);
  p.iframes = 0;
  p.stats.revives = 0;
  hurtPlayer(w, 0, 1e9, 50, 0, 0, HurtKind.Melee);
}

describe('run clock', () => {
  it('advances by exactly one tick per step and the HUD shows the same value', () => {
    const w = calm();
    for (let i = 1; i <= 600; i++) {
      w.step([NO_INPUT]);
      expect(w.tick).toBe(i);
      expect(w.time).toBeCloseTo(i * DT, 9);
      expect(hud(w, 0).time).toBe(w.time);
    }
  });

  it('does not advance while a modal is open (level-up, chest …) and resumes after it is answered', () => {
    const w = calm();
    runTicks(w, 120);
    const p = player(w);
    grantXp(w, p, p.xpNext);
    runTicks(w, 1);
    expect(w.modal?.kind).toBe('levelUp');
    const frozen = w.time;
    runTicks(w, 300);
    expect(w.time).toBe(frozen);
    expect(hud(w, 0).time).toBe(frozen);
    expect(w.chooseCard(0, 0)).toBe(true);
    runTicks(w, 60);
    expect(w.time).toBeCloseTo(frozen + 60 * DT, 9);
  });

  it('defeat: the result is built DEFEAT_DELAY after the last hero fell, carries the HUD time, and the clock then stops', () => {
    const w = calm();
    runTicks(w, 5 * 60);
    const diedAt = w.time;
    kill(w);
    expect(player(w).alive).toBe(false);
    let guard = 0;
    while (!w.over && guard++ < 600) w.step([NO_INPUT]);
    expect(w.over).toBe(true);
    const r = w.result;
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.victory).toBe(false);
    expect(r.time).toBe(w.time);
    expect(hud(w, 0).time).toBe(r.time);
    expect(r.time - diedAt).toBeGreaterThanOrEqual(DEFEAT_DELAY - DT);
    expect(r.time - diedAt).toBeLessThanOrEqual(DEFEAT_DELAY + 2 * DT);
    // finished: stepping on neither moves the clock nor changes the result
    const before = w.time;
    w.bus.clear();
    runTicks(w, 240);
    expect(w.time).toBe(before);
    expect(w.result).toBe(r);
    expect(w.buildResult(false).time).toBe(r.time);
  });

  it('victory: the result is built VICTORY_DELAY after the final boss fell, with the HUD time', () => {
    const w = calm();
    runTicks(w, 10 * 60);
    const wonAt = w.time;
    beginVictory(w);
    let guard = 0;
    while (!w.over && guard++ < 600) w.step([NO_INPUT]);
    const r = w.result;
    expect(r?.victory).toBe(true);
    if (!r) return;
    expect(r.time).toBe(w.time);
    expect(hud(w, 0).time).toBe(r.time);
    expect(r.time - wonAt).toBeGreaterThanOrEqual(VICTORY_DELAY - DT);
    expect(r.time - wonAt).toBeLessThanOrEqual(VICTORY_DELAY + 2 * DT);
  });

  it('abandoning mid-run reports the clock the HUD shows right now', () => {
    const w = calm();
    runTicks(w, 7 * 60 + 13);
    expect(w.buildResult(false).time).toBe(w.time);
    expect(w.buildResult(false).time).toBe(hud(w, 0).time);
  });

  it('time spent in modals never counts: a run with many level-ups ends at the same clock as without', () => {
    const w = calm();
    const p = player(w);
    for (let i = 0; i < 20; i++) {
      grantXp(w, p, p.xpNext);
      runTicks(w, 1);
      while (w.modal) w.chooseCard(0, w.modal.player);
    }
    runTicks(w, 60);
    // 20 single ticks + 60 free ticks, nothing else
    expect(w.tick).toBe(80);
    expect(w.time).toBeCloseTo(80 * DT, 9);
  });
});
