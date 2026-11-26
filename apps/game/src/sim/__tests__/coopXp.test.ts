// Co-op XP is shared (PLAN §3.10 "Ortak XP"): when any hero collects an XP gem every living hero receives the full gem xp
// (times their own xpGain). Each hero levels independently; collection / magnet stay per hero.

import { describe, expect, it } from 'vitest';
import { spawnXp } from '../pickups';
import type { CoopPlayerInit } from '../run';
import type { World } from '../world';
import { clearEnemies, collect, freezeSchedules, makeWorld, player, runTicks } from './helpers';

const PARTNER: CoopPlayerInit = { classId: 'warrior', doctrine: 'b', sex: 'f', empire: 'chowon', meta: { stats: {} } };

function party(partner: CoopPlayerInit = PARTNER): World {
  const w = makeWorld({ config: { coop: [partner] } });
  freezeSchedules(w);
  clearEnemies(w);
  for (const p of w.players) p.skills.length = 0;
  const a = player(w, 0);
  const b = player(w, 1);
  a.x = a.px = 0;
  a.z = a.pz = 0;
  b.x = b.px = 60;
  b.z = b.pz = 0;
  return w;
}

describe('co-op shared xp', () => {
  it('a gem collected by one hero gives every living hero the full amount', () => {
    const w = party();
    const a = player(w, 0);
    const b = player(w, 1);
    const need = a.xpNext;
    const amount = need * 0.4;
    spawnXp(w, 0.3, 0, amount);
    const events = collect(w, 90, ['pickup']);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ player: 0 });
    // empire bonuses differ (saehwa none, chowon +10 % xp): each hero gets the gem times its own xpGain
    expect(a.xp).toBeCloseTo(amount * a.stats.xpGain, 5);
    expect(b.xp).toBeCloseTo(amount * b.stats.xpGain, 5);
    expect(b.stats.xpGain).toBeGreaterThan(a.stats.xpGain);
    expect(w.xpGems).toBe(0);
  });

  it('the partner collecting it works the same way in reverse', () => {
    const w = party();
    const a = player(w, 0);
    const b = player(w, 1);
    spawnXp(w, 60.3, 0, 2);
    const events = collect(w, 90, ['pickup']);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ player: 1 });
    expect(a.xp).toBeCloseTo(2 * a.stats.xpGain, 5);
    expect(b.xp).toBeCloseTo(2 * b.stats.xpGain, 5);
  });

  it('each hero levels independently from the same gem (own xpGain, own pending levels, own modals)', () => {
    const w = party({ ...PARTNER, meta: { stats: { xpGain: 0.5 } } });
    const a = player(w, 0);
    const b = player(w, 1);
    expect(b.stats.xpGain).toBeCloseTo(1.6, 6);
    expect(a.stats.xpGain).toBe(1);
    spawnXp(w, 0.3, 0, 3 * a.xpNext);
    runTicks(w, 30);
    // 31.65 xp for the plain hero (level 3), 50.6 xp for the boosted partner (level 4)
    expect(a.level).toBe(3);
    expect(b.level).toBe(4);
    expect(a.pendingLevels + w.modals.filter((m) => m.player === 0).length).toBe(2);
    expect(b.pendingLevels + w.modals.filter((m) => m.player === 1).length).toBe(3);
    expect(w.modals.some((m) => m.kind === 'levelUp' && m.player === 0)).toBe(true);
    expect(w.modals.some((m) => m.kind === 'levelUp' && m.player === 1)).toBe(true);
  });

  it('a fallen hero receives nothing, and a collector alone in the party shares with nobody', () => {
    const w = party();
    const a = player(w, 0);
    const b = player(w, 1);
    b.alive = false;
    spawnXp(w, 0.3, 0, 3);
    runTicks(w, 90);
    expect(a.xp).toBeCloseTo(3 * a.stats.xpGain, 5);
    expect(b.xp).toBe(0);
    expect(b.level).toBe(1);
  });

  it('solo runs are unchanged: the collector gets exactly gem × xpGain', () => {
    const w = makeWorld();
    freezeSchedules(w);
    clearEnemies(w);
    const a = player(w);
    a.skills.length = 0;
    spawnXp(w, 0.3, 0, 4);
    const events = collect(w, 90, ['pickup']);
    expect(events).toHaveLength(1);
    expect(a.xp).toBeCloseTo(4 * a.stats.xpGain, 5);
  });

  it('only the collecting hero gets the pickup event; the magnet stays per hero', () => {
    const w = party();
    spawnXp(w, 0.3, 0, 2);
    spawnXp(w, 60.3, 0, 2);
    const events = collect(w, 120, ['pickup']);
    expect(events.map((e) => e.player).sort()).toEqual([0, 1]);
    const a = player(w, 0);
    const b = player(w, 1);
    // two gems of 2: each hero got both of them
    expect(a.xp).toBeCloseTo(4 * a.stats.xpGain, 5);
    expect(b.xp).toBeCloseTo(4 * b.stats.xpGain, 5);
  });
});
