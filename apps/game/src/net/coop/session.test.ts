import { afterEach, describe, expect, it } from 'vitest';
import { botInput } from '../../sim/__tests__/bot';
import { CoopHarness } from './harness';
import type { CoopGuest, MirrorWorld } from './mirror';

let h: CoopHarness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

describe('co-op session over the in-memory relay', () => {
  it('starts a 2-player run through the lobby flow and mirrors the world', async () => {
    h = await CoopHarness.create({ guests: 1, latencyMs: 30, tough: true });
    expect(h.runs.map((r) => r.role)).toEqual(['host', 'guest']);
    expect(h.runs[0]?.players.map((p) => p.name)).toEqual(['Player1', 'Player2']);
    expect(h.runs[1]?.players.map((p) => p.name)).toEqual(['Player2', 'Player1']);
    expect(h.hostWorld.players).toHaveLength(2);
    expect(h.guestWorlds[0]?.players).toHaveLength(2);
    for (let i = 0; i < 60 * 12; i++) h.tick({ x: 1, z: 0 }, [{ x: 0, z: 1 }]);
    const g = h.guests[0];
    expect(g?.phase).toBe('running');
    expect(g?.stats.decodeErrors).toBe(0);
    expect(h.room.traffic.violations).toEqual([]);
    const hostHero = h.hostWorld.players[0];
    const guestHeroOnHost = h.hostWorld.players[1];
    const mirror = h.guestWorlds[0];
    // local hero (index 0 on the guest) is the guest's own and has moved along +z
    expect(guestHeroOnHost?.z).toBeGreaterThan(5);
    expect(mirror?.players[0]?.z).toBeGreaterThan(5);
    expect(Math.abs((mirror?.players[0]?.z ?? 0) - (guestHeroOnHost?.z ?? 0))).toBeLessThan(2.5);
    // the host hero as seen by the guest (index 1) follows +x with a small lag
    expect(mirror?.players[1]?.x).toBeGreaterThan(5);
    expect(Math.abs((mirror?.players[1]?.x ?? 0) - (hostHero?.x ?? 0))).toBeLessThan(3);
  });
});

describe('co-op soak', () => {
  it('plays 4 minutes of a 400-enemy fight in sync within the bandwidth budget', async () => {
    h = await CoopHarness.create({ guests: 1, latencyMs: 35, jitterMs: 15, enemies: 400, skills: true, tough: true });
    const hw = h.hostWorld;
    const mw = h.guestWorlds[0] as MirrorWorld;
    const guest = h.guests[0] as CoopGuest;
    let maxRemoteErr = 0;
    let sumRemoteErr = 0;
    let nRemote = 0;
    let maxEnemies = 0;
    let ratioMin = 1;
    let picksHost = 0;
    let picksGuest = 0;
    const TICKS = 60 * 240;
    const histX: number[] = [];
    const histZ: number[] = [];
    for (let t = 0; t < TICKS; t++) {
      if (t % 20 === 0) {
        if (hw.modal && hw.modal.kind !== 'runEnd' && hw.chooseCard(0, 0)) picksHost++;
        if (mw.modal && mw.modal.kind !== 'runEnd' && mw.chooseCard(0)) picksGuest++;
      }
      const b = botInput(hw, t);
      const a = t / 150;
      h.tick({ x: b.moveX, z: b.moveZ }, [{ x: Math.cos(a), z: Math.sin(a) }]);
      expect(hw.over).toBe(false);
      histX[hw.tick] = hw.players[0]?.x ?? 0;
      histZ[hw.tick] = hw.players[0]?.z ?? 0;
      if (t > 600) {
        const seen = mw.players[1];
        const hx = histX[mw.tick];
        const hz = histZ[mw.tick];
        if (seen && hx !== undefined && hz !== undefined && !hw.modal && mw.tick > 120) {
          // where the host hero really was at the sim time the guest is displaying
          const e = Math.hypot(hx - seen.x, hz - seen.z);
          maxRemoteErr = Math.max(maxRemoteErr, e);
          sumRemoteErr += e;
          nRemote++;
        }
        if (t % 60 === 0 && hw.enemies.count > 0) {
          maxEnemies = Math.max(maxEnemies, hw.enemies.count);
          ratioMin = Math.min(ratioMin, mw.enemies.count / hw.enemies.count);
        }
      }
    }
    await h.settle(200);
    const hs = h.host.stats;
    const gs = guest.stats;
    const traffic = h.room.traffic;
    const secs = TICKS / 60;
    const kbpsDown = (traffic.down[1] as number) * 8 / 1000 / secs;
    const kbpsUp = (traffic.up[1] as number) * 8 / 1000 / secs;
    // eslint-disable-next-line no-console
    console.log(
      [
        `soak ${secs}s: host enemies≤${maxEnemies}, picks host ${picksHost} guest ${picksGuest}`,
        `snapshots ${hs.snapshots} (${hs.keyframes} key): avg ${(hs.bytes / hs.snapshots).toFixed(0)} B, max delta ${hs.maxDeltaBytes} B, max key ${hs.maxSnapshotBytes} B, events avg ${(hs.eventBytes / hs.snapshots).toFixed(0)} B (dropped ${hs.droppedEvents})`,
        `guest downstream ${kbpsDown.toFixed(0)} kbps, upstream ${kbpsUp.toFixed(1)} kbps, host upload ${h.host.kbps.toFixed(0)} kbps`,
        `remote hero error: avg ${(sumRemoteErr / nRemote).toFixed(2)} m, max ${maxRemoteErr.toFixed(2)} m; prediction: ${guest.prediction.count} reconciles, avg jump ${(guest.prediction.sumJump / guest.prediction.count).toFixed(3)} m, max ${guest.prediction.maxJump.toFixed(2)} m, snaps ${guest.prediction.snaps}`,
        `mirror/host enemy ratio min ${ratioMin.toFixed(2)}`,
      ].join('\n'),
    );
    expect(traffic.violations).toEqual([]);
    expect(gs.decodeErrors).toBe(0);
    expect(hs.droppedEvents).toBeLessThan(hs.snapshots * 20);
    expect(hs.maxDeltaBytes).toBeLessThan(12_500);
    expect(maxRemoteErr).toBeLessThan(1);
    expect(sumRemoteErr / nRemote).toBeLessThan(0.1);
    expect(ratioMin).toBeGreaterThan(0.8);
    expect(picksHost + picksGuest).toBeGreaterThan(4);
    expect(guest.phase).toBe('running');
  }, 240_000);
});

describe('co-op client prediction', () => {
  for (const jitterMs of [0, 15]) {
    it(`keeps the predicted hero on the authoritative path (jitter ${jitterMs} ms)`, async () => {
      h = await CoopHarness.create({ guests: 1, latencyMs: 40, jitterMs, enemies: 0, tough: true });
      const guest = h.guests[0] as CoopGuest;
      for (let t = 0; t < 60 * 60; t++) {
        const a = t / 90 + Math.sin(t / 400) * 2;
        h.tick({ x: 0, z: 0 }, [{ x: Math.cos(a), z: Math.sin(a) }]);
      }
      const p = guest.prediction;
      const avg = p.sumJump / p.count;
      // eslint-disable-next-line no-console
      console.log(`prediction jitter ${jitterMs} ms: ${p.count} reconciles, avg correction ${(avg * 100).toFixed(1)} cm, max ${(p.maxJump * 100).toFixed(1)} cm, snaps ${p.snaps}`);
      expect(p.snaps).toBe(0);
      expect(p.maxJump).toBeLessThan(jitterMs === 0 ? 0.3 : 0.6);
      expect(avg).toBeLessThan(jitterMs === 0 ? 0.03 : 0.1);
    }, 60_000);
  }
});

describe('co-op bandwidth', () => {
  for (const enemies of [100, 400]) {
    it(`measures snapshot sizes with ${enemies} enemies alive (1 guest, 60 s)`, async () => {
      h = await CoopHarness.create({ guests: 1, latencyMs: 30, jitterMs: 10, enemies, skills: true, tough: true });
      const hw = h.hostWorld;
      const mw = h.guestWorlds[0] as MirrorWorld;
      const TICKS = 60 * 60;
      for (let t = 0; t < TICKS; t++) {
        if (t % 20 === 0) {
          if (hw.modal && hw.modal.kind !== 'runEnd') hw.chooseCard(0, 0);
          if (mw.modal && mw.modal.kind !== 'runEnd') mw.chooseCard(0);
        }
        const b = botInput(hw, t);
        h.tick({ x: b.moveX, z: b.moveZ }, [{ x: Math.cos(t / 120), z: Math.sin(t / 120) }]);
      }
      const hs = h.host.stats;
      const secs = TICKS / 60;
      const down = ((h.room.traffic.down[1] as number) * 8) / 1000 / secs;
      // eslint-disable-next-line no-console
      console.log(`bandwidth @${enemies} enemies (alive ${hw.enemies.count}, projectiles ${hw.projectiles.count}): ${(hs.bytes / hs.snapshots).toFixed(0)} B/snapshot avg, max delta ${hs.maxDeltaBytes} B, max keyframe ${hs.maxSnapshotBytes} B, ${down.toFixed(0)} kbps per guest downstream`);
      expect(h.room.traffic.violations).toEqual([]);
      expect(hs.maxDeltaBytes).toBeLessThan(12_500);
      expect(hs.maxSnapshotBytes).toBeLessThan(32_000);
    }, 120_000);
  }

  it('runs a 4-player room (3 guests, 300 enemies) for 90 s', async () => {
    h = await CoopHarness.create({ guests: 3, latencyMs: 40, jitterMs: 15, enemies: 300, skills: true, tough: true });
    const hw = h.hostWorld;
    expect(hw.players).toHaveLength(4);
    const TICKS = 60 * 90;
    for (let t = 0; t < TICKS; t++) {
      if (t % 20 === 0) {
        if (hw.modal && hw.modal.kind !== 'runEnd') hw.chooseCard(0, 0);
        for (const m of h.guestWorlds) if (m.modal && m.modal.kind !== 'runEnd') m.chooseCard(0);
      }
      const b = botInput(hw, t);
      h.tick(
        { x: b.moveX, z: b.moveZ },
        [0, 1, 2].map((i) => ({ x: Math.cos(t / 100 + i * 2), z: Math.sin(t / 100 + i * 2) })),
      );
      expect(hw.over).toBe(false);
    }
    const traffic = h.room.traffic;
    // eslint-disable-next-line no-console
    console.log(`4 players: ${h.host.stats.snapshots} snapshots, avg ${(h.host.stats.bytes / h.host.stats.snapshots).toFixed(0)} B, max delta ${h.host.stats.maxDeltaBytes} B; per-guest downstream ${(((traffic.down[1] as number) * 8) / 1000 / 90).toFixed(0)} kbps, host upload ${(((traffic.up[0] as number) * 8) / 1000 / 90).toFixed(0)} kbps, guest upstream ${(((traffic.up[1] as number) * 8) / 1000 / 90).toFixed(1)} kbps`);
    expect(traffic.violations).toEqual([]);
    for (let g = 0; g < 3; g++) {
      const m = h.guestWorlds[g] as MirrorWorld;
      expect(m.players).toHaveLength(4);
      expect(h.guests[g]?.stats.decodeErrors).toBe(0);
      // every guest sees the host hero (local order index 1.. holds the others) where the host had it ~0.15 s ago
      const hostSeen = m.players.find((p, i) => i > 0 && Math.hypot(p.x - (hw.players[0]?.x ?? 0), p.z - (hw.players[0]?.z ?? 0)) < 4);
      expect(hostSeen).toBeDefined();
      expect(m.players[0]?.level).toBe(hw.players[g + 1]?.level);
    }
    expect(h.host.status().players.every((p) => p.connected)).toBe(true);
  }, 120_000);
});
