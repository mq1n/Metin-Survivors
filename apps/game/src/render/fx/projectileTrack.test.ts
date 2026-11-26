import { describe, expect, it } from 'vitest';
import { LOOK, ProjEventKind, clearProjEvents, drainProjEvents, pendingProjEvents, pushProjEvent } from './projectileEvents';
import { LOOK_OF_C9, lookOfColor, lookOfStyle } from './projectileLooks';
import { HOSTILE_ARROW_LEN, HOSTILE_BLADE_LEN, HOSTILE_ORB_SCALE, compileProjectileStyles } from './projectiles';
import { LAUNCH_MAX_AGE, ProjectileTracker } from './projectileTrack';

describe('hostile looks of the style table', () => {
  it('compiles the element look of every style from its simFeed colour', () => {
    const c = compileProjectileStyles([
      { shape: 'orb', color: '#ff7a1a' },
      { shape: 'orb', color: '#7fdcff' },
      { shape: 'arrow', color: '#7bff52' },
      { shape: 'blade', color: '#bff6e0' },
      undefined,
    ]);
    expect(Array.from(c.look)).toEqual([LOOK.fire, LOOK.ice, LOOK.poison, LOOK.wind, LOOK.physical, LOOK.physical].slice(0, 6));
  });

  it('a `look` key of the feed (schema C9 projectile.look) wins over the colour', () => {
    expect(lookOfStyle({ color: '#fff2c4', look: 'fireball' })).toBe(LOOK.fire);
    expect(lookOfStyle({ color: '#ff7a1a', look: 'claw_slash' })).toBe(LOOK.blood);
    expect(lookOfStyle({ color: '#ff7a1a', look: 'nonsense' })).toBe(LOOK.fire);
    for (const v of Object.values(LOOK_OF_C9)) expect(v).toBeGreaterThanOrEqual(0);
  });

  it('draws hostile bodies larger than the hit radius and the arrows longer (readable at the 55 degree camera)', () => {
    expect(HOSTILE_ORB_SCALE).toBeGreaterThan(1);
    expect(HOSTILE_ARROW_LEN).toBeGreaterThan(1);
    expect(HOSTILE_BLADE_LEN).toBeLessThan(1); // the old ~3.5 m white crescent doily becomes a small bolt
    expect(lookOfColor('#000000')).toBeGreaterThanOrEqual(0);
  });
});

describe('ProjectileTracker (launch / vanish detection from the dense feed)', () => {
  const see = (t: ProjectileTracker, x: number, age: number, over: Partial<{ style: number; rot: number }> = {}) => {
    const speed = 10;
    return t.see(over.style ?? 3, over.rot ?? 1.5707963, x, 1, 0, 1, 0, speed, age, 100 + 0 * age, 0.3, LOOK.fire, 0);
  };

  it('a new projectile is a launch only while it is young', () => {
    const t = new ProjectileTracker();
    t.begin();
    const a = see(t, 0.5, 0.0);
    expect(a?.isNew).toBe(true);
    t.end(() => undefined);
    t.begin();
    expect(see(t, 0.67, 1 / 60)?.isNew).toBe(false);
    t.end(() => undefined);
    // a projectile first seen late (camera / join) is new but older than the launch window
    const t2 = new ProjectileTracker();
    t2.begin();
    expect(LAUNCH_MAX_AGE).toBeLessThan(0.3);
    expect(see(t2, 5, 0.5)?.isNew).toBe(true);
  });

  it('a projectile that stops being fed is reported gone once, at its last position', () => {
    const t = new ProjectileTracker();
    const gone: number[] = [];
    for (let f = 0; f < 5; f++) {
      t.begin();
      see(t, f * 0.17, f / 60);
      t.end((r) => gone.push(r.x));
    }
    expect(gone).toEqual([]);
    t.begin();
    t.end((r) => gone.push(r.x));
    expect(gone.length).toBe(1);
    expect(gone[0]).toBeCloseTo(4 * 0.17, 5);
    t.begin();
    t.end((r) => gone.push(r.x));
    expect(gone.length).toBe(1);
  });

  it('keeps volley waves apart (same yaw and launch point, different birth) and tracks a ring of distinct yaws', () => {
    const t = new ProjectileTracker();
    t.begin();
    // two waves of one volley: same style / yaw / launch point (x - dir * speed * age is 0), born 0.35 s apart
    t.see(3, 1, 3.5, 1, 0, 1, 0, 10, 0.35, 99.65, 0.3, LOOK.fire, 0);
    t.see(3, 1, 0, 1, 0, 1, 0, 10, 0, 100, 0.3, LOOK.fire, 0);
    expect(t.recs.length).toBe(2);
    t.end(() => undefined);
    t.begin();
    for (let k = 0; k < 20; k++) t.see(7, k * 0.3, 1, 1, 1, 1, 0, 8, 0.2, 99.8, 0.4, LOOK.ice, 2);
    expect(t.recs.length).toBe(22);
  });
});

describe('projectile events queue', () => {
  it('drains in order, bounded, and clears', () => {
    clearProjEvents();
    pushProjEvent(ProjEventKind.Launch, LOOK.fire, 0, 1, 2, 3, 0, 1, 0.3, 9, false);
    pushProjEvent(ProjEventKind.Blow, LOOK.ice, 1, 4, 5, 6, 1, 0, 0.4, 8, true);
    expect(pendingProjEvents()).toBe(2);
    const seen: number[] = [];
    expect(drainProjEvents((e) => seen.push(e.kind * 10 + e.look))).toBe(2);
    expect(seen).toEqual([LOOK.fire, 10 + LOOK.ice]);
    expect(pendingProjEvents()).toBe(0);
    for (let i = 0; i < 500; i++) pushProjEvent(ProjEventKind.Launch, 0, 0, 0, 0, 0, 0, 1, 0.3, 9, false);
    expect(pendingProjEvents()).toBeLessThanOrEqual(128);
    clearProjEvents();
    expect(pendingProjEvents()).toBe(0);
  });
});
