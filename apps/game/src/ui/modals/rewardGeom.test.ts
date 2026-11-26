import { describe, expect, it } from 'vitest';
import type { Card } from '../../sim/types';
import { GEM_HUES, hashStr, MED, marksOf, medallionFits, ringAngle, ringPoint, SOCKET_GEMS, sprayAt, sprayParticles, STONE_RING_DEG, stoneVariant } from './rewardGeom';

const card = (over: Partial<Card>): Card => ({ kind: 'newSkill', id: 'x', rarity: 'common', rank: 0, maxRank: 7, awakening: false, lines: [], amount: 0, slot: -1, replaces: null, ...over }) as Card;

describe('ring placement', () => {
  it('spaces n sockets evenly and starts at 12 o clock', () => {
    expect(ringAngle(0, 6)).toBe(0);
    expect(ringAngle(3, 6)).toBe(180);
    const p = ringPoint(0, 6, 0.36);
    expect(p.x).toBeCloseTo(0.5);
    expect(p.y).toBeCloseTo(0.14);
    const q = ringPoint(1, 4, 0.4);
    expect(q.x).toBeCloseTo(0.9);
    expect(q.y).toBeCloseTo(0.5);
  });
  it('puts the weapon trio on the upper arc and the armor trio on the lower arc, left to right', () => {
    const at = (i: number): { x: number; y: number } => {
      const a = ((STONE_RING_DEG[i] ?? 0) * Math.PI) / 180;
      return { x: Math.sin(a), y: -Math.cos(a) };
    };
    for (const i of [0, 1, 2]) expect(at(i).y).toBeLessThan(0.01);
    for (const i of [3, 4, 5]) expect(at(i).y).toBeGreaterThan(-0.01);
    expect(at(0).x).toBeLessThan(at(1).x);
    expect(at(1).x).toBeLessThan(at(2).x);
    expect(at(3).x).toBeLessThan(at(4).x);
    expect(at(4).x).toBeLessThan(at(5).x);
    expect(new Set(STONE_RING_DEG.map((d) => ((d % 360) + 360) % 360)).size).toBe(6);
  });
  it('has one gem colour per socket, all distinct', () => {
    expect(SOCKET_GEMS).toHaveLength(6);
    expect(new Set(SOCKET_GEMS).size).toBe(6);
  });
});

describe('per-metin stone pose', () => {
  it('is deterministic and stays inside its ranges', () => {
    const ids = ['metin_strife', 'metin_onslaught', 'metin_avarice', 'metin_murk', 'metin_lament', 'metin_ebon'];
    for (const id of ids) {
      const a = stoneVariant(id);
      expect(stoneVariant(id)).toEqual(a);
      expect(Math.abs(a.rot)).toBeLessThanOrEqual(4.6);
      expect(a.scale).toBeGreaterThanOrEqual(0.94);
      expect(a.scale).toBeLessThanOrEqual(1.06);
      expect(a.glow).toBeGreaterThanOrEqual(0.75);
      expect(a.glow).toBeLessThanOrEqual(1.25);
    }
  });
  it('gives the metins different poses (no mirrored twins)', () => {
    const keys = new Set(['a', 'b', 'c', 'd', 'e', 'f'].map((s) => JSON.stringify(stoneVariant(`metin_${s}`))));
    expect(keys.size).toBeGreaterThanOrEqual(5);
    expect(hashStr('metin_a')).not.toBe(hashStr('metin_b'));
  });
});

describe('coin / gem spray', () => {
  it('is deterministic for a seed and mixes coins and gems', () => {
    const a = sprayParticles(11, 60);
    expect(sprayParticles(11, 60)).toEqual(a);
    expect(sprayParticles(12, 60)).not.toEqual(a);
    const coins = a.filter((p) => p.kind === 'coin').length;
    expect(coins).toBeGreaterThan(25);
    expect(coins).toBeLessThan(55);
    for (const p of a) expect(p.hue).toBeLessThan(GEM_HUES.length);
  });
  it('flies up and out, falls back, and is gone after its life', () => {
    const p = sprayParticles(3, 1)[0];
    if (!p) throw new Error('no particle');
    expect(sprayAt(p, p.delay - 0.01)).toBeNull();
    const early = sprayAt(p, p.delay + 0.12);
    expect(early).not.toBeNull();
    expect(early?.y ?? 0).toBeLessThan(0);
    const late = sprayAt(p, p.delay + p.life - 0.01);
    expect((late?.y ?? -1)).toBeGreaterThan(early?.y ?? 0);
    expect((late?.alpha ?? 1)).toBeLessThan(0.1);
    expect(sprayAt(p, p.delay + p.life + 0.01)).toBeNull();
  });
});

describe('medallion geometry', () => {
  it('seats small gems on the ring track: inside the rim, clear of the hub and of each other', () => {
    expect(medallionFits()).toBe(true);
    expect(MED.socket).toBeGreaterThanOrEqual(0.12);
    expect(MED.socket).toBeLessThanOrEqual(0.15);
    expect(MED.track).toBeGreaterThan(MED.socket);
    // the ring point of every socket lies on the track circle, centred on the box
    for (let i = 0; i < 6; i++) {
      const a = ((STONE_RING_DEG[i] ?? 0) * Math.PI) / 180;
      const x = Math.sin(a) * MED.ring;
      const y = -Math.cos(a) * MED.ring;
      expect(Math.hypot(x, y)).toBeCloseTo(MED.ring, 6);
    }
  });
  it('rejects a ring that overhangs the rim or crowds its neighbours', () => {
    expect(medallionFits({ ...MED, socket: 0.25 })).toBe(false);
    expect(medallionFits({ ...MED, ring: 0.44 })).toBe(false);
    expect(medallionFits({ ...MED, ring: 0.2 })).toBe(false);
  });
});

describe('marksOf', () => {
  it('marks free, replaced and upgraded sockets by slot', () => {
    const m = marksOf([
      card({ kind: 'stone', slot: 2 }),
      card({ kind: 'stone', slot: 5, replaces: { kind: 'stone', id: 'old', level: 0, slot: 5 } }),
      card({ kind: 'trinketUp', slot: 0 }),
    ]);
    expect(m.stones[2]).toEqual([{ card: 0, kind: 'free' }]);
    expect(m.stones[5]).toEqual([{ card: 1, kind: 'replace' }]);
    expect(m.trinkets[0]).toEqual([{ card: 2, kind: 'upgrade' }]);
    expect(m.stones[0]).toEqual([]);
  });
  it('lets two cards share one socket and ignores skill cards', () => {
    const m = marksOf([card({ kind: 'stone', slot: 1 }), card({ kind: 'stoneUp', slot: 1 }), card({ kind: 'newSkill' })]);
    expect(m.stones[1]?.map((x) => x.kind)).toEqual(['free', 'upgrade']);
    expect(m.trinkets.every((t) => t.length === 0)).toBe(true);
  });
});
