// FEEL-02: render-only hit-stop. The gate (HitStop) and the router that feeds it (RenderEventRouter): which events hold a frame, which never do,
// where they must happen (on the local player's screen), the rate limits, the screen-shake scaling and the dt arithmetic. The sim is never touched:
// a hold only changes the dt RenderWorld hands the corpses, the hero mixers, the metin stones and the VFX (render/world.ts; the living crowd samples
// the sim's feed and never freezes), which a frame-trace in the browser confirms (build/FEEL-02/after).
import { afterEach, describe, expect, it } from 'vitest';
import { EventBus, type SimEvent } from '../../sim/events';
import { ByteReader } from '../../net/coop/bytes';
import { decodeEvents, EventCollector, WireStrings, type EventSink } from '../../net/coop/events';
import { CameraRig } from '../../render/camera';
import { dictionaries } from '../../i18n/i18n';
import { hitEnemy, newHitCtx } from '../../sim/combat';
import { despawnEnemy } from '../../sim/spawner';
import { spawn, makeWorld, freezeSchedules } from '../../sim/__tests__/helpers';
import type { World } from '../../sim/world';
import { heroHoldScale, type HitStopClock, type RenderWorld } from '../../render/world';
import { runEvents } from '../runEvents';
import { HIT_STOP_DT_SCALE, HIT_STOP_GAP, HIT_STOP_LEADER_COOLDOWN, HIT_STOP_MS, HIT_STOP_PER_MINUTE, HIT_STOP_VIEW_MARGIN, HitStop, RenderEventRouter, type HitStopKind } from '../renderEvents';

const FRAME = 1 / 60;
const NO_WORLD = { players: [] } as unknown as World;

/** where the stand-in camera sees: an axis-aligned ground box (the router asks isVisible(x, z, margin)) */
interface View {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}
const EVERYWHERE: View = { x0: -1e9, x1: 1e9, z0: -1e9, z1: 1e9 };

/** a RenderWorld stand-in: the router only calls these (no WebGL). `camera` = the rig the router asks isVisible (default: a box that sees the whole map) */
function stubRenderWorld(shakeScale = 1, camera?: Pick<CameraRig, 'isVisible'>): { rw: RenderWorld; shakes: number[]; setShake(v: number): void; view: View } {
  const shakes: number[] = [];
  const view: View = { ...EVERYWHERE };
  const rig = {
    shakeScale,
    isVisible: (x: number, z: number, r: number): boolean =>
      camera ? camera.isVisible(x, z, r) : x >= view.x0 - r && x <= view.x1 + r && z >= view.z0 - r && z <= view.z1 + r,
  };
  const rw = {
    hitStop: null as HitStopClock | null,
    core: { rig },
    shake: (a: number) => void shakes.push(a),
    enemyDied: () => undefined,
    damage: { spawn: () => undefined, spawnText: () => undefined },
    heroes: { views: [] },
  } as unknown as RenderWorld;
  return { rw, shakes, setShake: (v) => void (rig.shakeScale = v), view };
}

interface Rig {
  router: RenderEventRouter;
  bus: EventBus;
  hs: HitStop;
  /** what the stand-in camera sees (mutable): set it to a box to put events off screen */
  view: View;
  setShake(v: number): void;
  /** dispatches what `fill` emitted on the bus as one sim step's events */
  step(fill: (bus: EventBus) => void, world?: World): void;
  /** `n` render frames at 60 fps (the clock the gate reads) */
  frames(n: number): void;
  /** seconds of render time */
  advance(seconds: number): void;
}

const routers: RenderEventRouter[] = [];

function rig(shakeScale = 1): Rig {
  const { rw, setShake, view } = stubRenderWorld(shakeScale);
  const router = new RenderEventRouter(rw);
  router.attach();
  routers.push(router);
  const bus = new EventBus();
  const hs = router.hitStop;
  return {
    router,
    bus,
    hs,
    view,
    setShake,
    step(fill, world = NO_WORLD) {
      bus.clear();
      fill(bus);
      runEvents.dispatch(bus.list, world);
    },
    frames(n) {
      for (let i = 0; i < n; i++) hs.scale(FRAME);
    },
    advance(seconds) {
      for (let t = 0; t < seconds - 1e-9; t += FRAME) hs.scale(FRAME);
    },
  };
}

afterEach(() => {
  while (routers.length) routers.pop()?.detach();
});

// enemyDeath(id, type, x, z, rot, scale, tier, killer, skill, crit)
const death = (tier: number, killer = 0, x = 0, z = 0) => (b: EventBus) => b.enemyDeath(1, 0, x, z, 0, 1, tier, killer, -1, false);
const metinBreak = (great = false, x = 0, z = 0) => (b: EventBus) => b.metinBreak(1, 'metin_a', x, z, great, false);
const bossPhase = (enrage = false) => (b: EventBus) => b.bossPhase(1, 'boss_a', 1, 0.5, enrage);
const bossDeath = (final: boolean) => (b: EventBus) => b.bossDeath(1, 'boss_a', 0, 0, final);
const championEnd = (id = 1, p = 1, kind = 'championHunt', phase: 'end' | 'active' = 'end') => (b: EventBus) => b.runEvent(kind, phase, id, 0, 0, 100, 160, -1, p);

describe('HitStop: the table and the dt arithmetic', () => {
  it('holds 45 / 55 / 60 / 70 ms for a boss phase change / a tier >= 2 death / a metin break / the final boss death', () => {
    expect(HIT_STOP_MS.bossPhase).toBe(45);
    expect(HIT_STOP_MS.leaderDeath).toBe(55);
    expect(HIT_STOP_MS.championDeath).toBe(55);
    expect(HIT_STOP_MS.bossDeath).toBe(55);
    expect(HIT_STOP_MS.metinBreak).toBe(60);
    expect(HIT_STOP_MS.finalBossDeath).toBe(70);
    expect(HIT_STOP_DT_SCALE).toBe(0.05);
    expect(HIT_STOP_GAP).toBe(3);
  });

  it('scale() is exactly 1 outside a hold (the dt the systems get stays bit-identical) and counts the clamped frame delta', () => {
    const hs = new HitStop();
    expect(hs.scale(FRAME)).toBe(1);
    expect(hs.scale(0)).toBe(1);
    expect(hs.scale(-1)).toBe(1);
    expect(hs.scale(Number.NaN)).toBe(1);
    expect(hs.now).toBeCloseTo(FRAME, 9);
    hs.scale(5); // a hitch: the clock counts at most 0.25 s, like RenderCore.frame
    expect(hs.now).toBeCloseTo(FRAME + 0.25, 9);
  });

  it.each([30, 60, 144, 240])('a 55 ms hold is 55 ms of wall time at %d fps: the held dt sums to hold x 5 % + the rest', (fps) => {
    const hs = new HitStop();
    expect(hs.trigger('leaderDeath', 1)).toBe(55);
    const dt = 1 / fps;
    let wall = 0;
    let held = 0;
    let frames = 0;
    for (; wall < 0.2 - 1e-9; frames++) {
      const k = hs.scale(dt);
      expect(k).toBeGreaterThanOrEqual(HIT_STOP_DT_SCALE - 1e-12);
      expect(k).toBeLessThanOrEqual(1);
      held += dt * k;
      wall += dt;
    }
    // the sim-time equivalent the held systems advanced: wall time minus the 95 % of the hold they skipped
    expect(wall - held).toBeCloseTo(0.055 * (1 - HIT_STOP_DT_SCALE), 6);
    expect(hs.left).toBe(0);
    expect(hs.scale(dt)).toBe(1);
  });

  it('at 60 fps a 55 ms hold is three full held frames and the start of a fourth, then full speed', () => {
    const hs = new HitStop();
    hs.trigger('leaderDeath', 1);
    const ks = [hs.scale(FRAME), hs.scale(FRAME), hs.scale(FRAME), hs.scale(FRAME)];
    expect(ks[0]).toBeCloseTo(HIT_STOP_DT_SCALE, 9);
    expect(ks[1]).toBeCloseTo(HIT_STOP_DT_SCALE, 9);
    expect(ks[2]).toBeCloseTo(HIT_STOP_DT_SCALE, 9);
    // 55 - 3 x 16.67 = 5 ms of hold left: 5 ms at 5 %, 11.7 ms at 100 %
    expect(ks[3]).toBeGreaterThan(0.6);
    expect(ks[3]).toBeLessThan(0.8);
    expect(hs.scale(FRAME)).toBe(1);
  });

  it('a hitch frame longer than the hold only holds for the hold (the rest of the frame runs at full speed)', () => {
    const hs = new HitStop();
    hs.trigger('metinBreak', 1);
    const k = hs.scale(0.2);
    expect(k).toBeCloseTo((0.06 * HIT_STOP_DT_SCALE + 0.14) / 0.2, 9);
    expect(hs.scale(FRAME)).toBe(1);
  });
});

describe('HitStop: screen shake scales the hold, 0 turns it off', () => {
  it.each<[HitStopKind, number]>([
    ['bossPhase', 45],
    ['leaderDeath', 55],
    ['metinBreak', 60],
    ['finalBossDeath', 70],
  ])('%s at shake 0.5 holds half of %d ms', (kind, ms) => {
    const hs = new HitStop();
    expect(hs.trigger(kind, 0.5)).toBeCloseTo(ms / 2, 9);
    expect(hs.left).toBeCloseTo(ms / 2000, 9);
  });

  it('shake 0 (and a negative or NaN setting) holds nothing and uses up no rate limit', () => {
    const hs = new HitStop();
    for (const shake of [0, -1, Number.NaN]) expect(hs.trigger('metinBreak', shake)).toBe(0);
    expect(hs.left).toBe(0);
    expect(hs.stats.granted).toBe(0);
    expect(hs.scale(FRAME)).toBe(1);
    // the very next request at full shake is granted at once: the refused ones left no gap behind
    expect(hs.trigger('metinBreak', 1)).toBe(60);
    // a setting above 1 never lengthens it
    const hs2 = new HitStop();
    expect(hs2.trigger('metinBreak', 7)).toBe(60);
  });

  it('a hold shorter than a millisecond is no hold', () => {
    const hs = new HitStop();
    expect(hs.trigger('bossPhase', 0.01)).toBe(0);
    expect(hs.left).toBe(0);
  });
});

describe('HitStop: at most one hold per 3 s, the pack-leader lane, 12 a minute', () => {
  it('a second hold inside 3 s is refused, one at 3 s is granted', () => {
    const hs = new HitStop();
    expect(hs.trigger('metinBreak', 1)).toBe(60);
    for (let i = 0; i < 100; i++) hs.scale(FRAME); // 1.67 s
    expect(hs.trigger('bossPhase', 1)).toBe(0);
    expect(hs.trigger('leaderDeath', 1)).toBe(0);
    for (let i = 0; i < 82; i++) hs.scale(FRAME); // 3.03 s after the first
    expect(hs.now).toBeGreaterThanOrEqual(3);
    expect(hs.trigger('bossPhase', 1)).toBe(45);
    expect(hs.stats.granted).toBe(2);
    expect(hs.stats.denied).toBe(2);
  });

  it('a refused request does not restart the gap (3 s are counted from the last GRANT)', () => {
    const hs = new HitStop();
    hs.trigger('metinBreak', 1);
    for (let i = 0; i < 120; i++) hs.scale(FRAME); // 2 s
    expect(hs.trigger('bossPhase', 1)).toBe(0);
    for (let i = 0; i < 61; i++) hs.scale(FRAME); // 3.02 s since the grant
    expect(hs.trigger('bossPhase', 1)).toBe(45);
  });

  it('the pack-leader lane needs 15 s since the last leader hold; a metin or a phase change in between is fine', () => {
    const hs = new HitStop();
    expect(hs.trigger('leaderDeath', 1)).toBe(55);
    for (let i = 0; i < 5 * 60; i++) hs.scale(FRAME); // t = 5
    expect(hs.trigger('leaderDeath', 1)).toBe(0); // 5 s: still cooling
    expect(hs.trigger('metinBreak', 1)).toBe(60); // another lane: only the 3 s gap
    for (let i = 0; i < 9 * 60; i++) hs.scale(FRAME); // t = 14, 9 s after the metin
    expect(hs.trigger('leaderDeath', 1)).toBe(0); // 14 s since the leader: one more second
    for (let i = 0; i < 70; i++) hs.scale(FRAME); // t = 15.17
    expect(hs.trigger('leaderDeath', 1)).toBe(55);
    expect(HIT_STOP_LEADER_COOLDOWN).toBe(15);
  });

  it('a pack leader keeps quiet while a boss fights (bossUp .. bossDown); every other moment still holds', () => {
    const hs = new HitStop();
    hs.bossUp(4);
    expect(hs.trigger('leaderDeath', 1)).toBe(0);
    for (let i = 0; i < 4 * 60; i++) hs.scale(FRAME);
    expect(hs.trigger('bossPhase', 1)).toBe(45);
    for (let i = 0; i < 4 * 60; i++) hs.scale(FRAME);
    expect(hs.trigger('leaderDeath', 1)).toBe(0);
    hs.bossDown(4);
    expect(hs.trigger('leaderDeath', 1)).toBe(55);
  });

  it('a boss that never reports its death releases the pack-leader lane after 5 minutes', () => {
    const hs = new HitStop();
    hs.bossUp(9);
    for (let i = 0; i < 299 * 60; i++) hs.scale(FRAME);
    expect(hs.trigger('leaderDeath', 1)).toBe(0);
    for (let i = 0; i < 2 * 60; i++) hs.scale(FRAME);
    expect(hs.trigger('leaderDeath', 1)).toBe(55);
  });

  it('never more than 12 holds in any 60 s, even when every request is 3 s apart', () => {
    const hs = new HitStop();
    const grants: number[] = [];
    for (let t = 0; t < 120; t += 3) {
      if (hs.trigger('metinBreak', 1) > 0) grants.push(hs.now);
      for (let i = 0; i < 180; i++) hs.scale(FRAME);
    }
    for (const g of grants) expect(grants.filter((x) => x >= g && x < g + 60).length).toBeLessThanOrEqual(HIT_STOP_PER_MINUTE);
    expect(grants.length).toBeLessThan(40); // 40 requests in 120 s: the 12 per minute cap held back the surplus
    expect(grants.length).toBeGreaterThanOrEqual(20);
    for (let i = 1; i < grants.length; i++) expect((grants[i] as number) - (grants[i - 1] as number)).toBeGreaterThanOrEqual(HIT_STOP_GAP - 1e-6);
  });

  it('the final boss death ignores the gap (once per run, never swallowed by the hold a moment before) but still counts', () => {
    const hs = new HitStop();
    expect(hs.trigger('bossPhase', 1)).toBe(45);
    for (let i = 0; i < 60; i++) hs.scale(FRAME);
    expect(hs.trigger('finalBossDeath', 1)).toBe(70);
    expect(hs.left).toBeCloseTo(0.07, 6);
    // the next ordinary hold waits 3 s from the finale
    expect(hs.trigger('metinBreak', 1)).toBe(0);
  });

  it('a stronger request while a hold runs lengthens it, a weaker one never shortens it', () => {
    const hs = new HitStop();
    hs.trigger('bossPhase', 1); // 45
    hs.trigger('finalBossDeath', 1); // 70, no gap
    expect(hs.left).toBeCloseTo(0.07, 9);
    const hs2 = new HitStop();
    hs2.trigger('finalBossDeath', 1);
    hs2.trigger('metinBreak', 1); // refused by the gap
    expect(hs2.left).toBeCloseTo(0.07, 9);
  });

  it('reset() drops the hold and every limit (a new run starts clean)', () => {
    const hs = new HitStop();
    hs.trigger('metinBreak', 1);
    hs.scale(FRAME);
    hs.reset();
    expect(hs.now).toBe(0);
    expect(hs.left).toBe(0);
    expect(hs.stats.granted).toBe(0);
    expect(hs.log).toHaveLength(0);
    expect(hs.trigger('metinBreak', 1)).toBe(60);
  });
});

describe('RenderEventRouter: only the four big moments hold a frame', () => {
  it('RenderWorld gets the hit-stop clock from the router', () => {
    const { rw } = stubRenderWorld();
    const router = new RenderEventRouter(rw);
    expect(rw.hitStop).toBe(router.hitStop);
  });

  it('a tier-2 death (pack leader) a hero caused holds 55 ms; tier 0, tier 1 and the metin stone row never do', () => {
    const r = rig();
    r.step(death(0));
    r.step(death(1));
    expect(r.hs.stats.granted).toBe(0);
    expect(r.hs.left).toBe(0);
    r.step(death(2));
    expect(r.hs.stats.granted).toBe(1);
    expect(r.hs.left).toBeCloseTo(0.055, 9);
  });

  it('plain elites (tier 1) die every ~2 s in a late band for 15 minutes and never hold once', () => {
    const r = rig();
    for (let t = 0; t < 15 * 60; t += 2) {
      r.step(death(1));
      r.advance(2);
    }
    expect(r.hs.stats.granted).toBe(0);
    expect(r.hs.stats.denied).toBe(0);
  });

  it('a boss (tier 3) holds through its bossDeath event, not through its enemyDeath: one hold, 55 ms, or 70 ms for the final', () => {
    const r = rig();
    r.step((b) => {
      death(3)(b);
      bossDeath(false)(b);
    });
    expect(r.hs.stats.granted).toBe(1);
    expect(r.hs.log[0]).toMatchObject({ kind: 'bossDeath', ms: 55 });
    const f = rig();
    f.step((b) => {
      death(3)(b);
      bossDeath(true)(b);
    });
    expect(f.hs.stats.granted).toBe(1);
    expect(f.hs.log[0]).toMatchObject({ kind: 'finalBossDeath', ms: 70 });
  });

  it('no pack-leader hold while a boss fights; the boss own phases and death still hold, and the lane reopens when it falls', () => {
    const r = rig();
    r.step((b) => b.bossSpawn(1, 50, 'boss_a', 0, 0, false));
    r.step(death(2));
    expect(r.hs.stats.granted).toBe(0);
    r.step(bossPhase());
    expect(r.hs.stats.granted).toBe(1);
    r.advance(4);
    r.step((b) => bossDeath(false)(b));
    r.advance(4);
    r.step(death(2));
    expect(r.hs.stats.byKind.leaderDeath).toBe(1);
  });

  it('a killer of -1 (the Champion Hunt burrowing away, a bomb imp) is not a kill: no hold', () => {
    const r = rig();
    r.step(death(2, -1));
    expect(r.hs.stats.granted).toBe(0);
  });

  it('a boss phase change and the enrage hold 45 ms', () => {
    const r = rig();
    r.step(bossPhase(false));
    expect(r.hs.log[0]).toMatchObject({ kind: 'bossPhase', ms: 45 });
    r.advance(3.1);
    r.step(bossPhase(true));
    expect(r.hs.stats.granted).toBe(2);
    expect(r.hs.stats.byKind.bossPhase).toBe(2);
  });

  it('a metin break holds 60 ms (small and great)', () => {
    const r = rig();
    r.step(metinBreak(false));
    expect(r.hs.log[0]).toMatchObject({ kind: 'metinBreak', ms: 60 });
    r.advance(3.1);
    r.step(metinBreak(true));
    expect(r.hs.stats.byKind.metinBreak).toBe(2);
  });

  it('nothing else holds: hits, crits, kills of ordinary creatures, player hits, casts, level-ups, pickups, shakes, spawns, impacts', () => {
    const r = rig();
    r.step((b) => {
      b.damage(0, 0, 50, true, 0, 1, 0, 0, true, false, false);
      b.damage(0, 0, 5000, false, 0, 2, 0, 0, true, false, true); // a hit on a boss
      b.enemyDeath(1, 0, 0, 0, 0, 1, 0, 0, -1, true);
      b.playerHit(0, 40, 0, 0, 0, 1, 1, 0, 100);
      b.playerDeath(0, 0, 0);
      b.levelUp(0, 5);
      b.shake(1, 1);
      b.bossSpawn(1, 1, 'boss_a', 0, 0, true);
      b.metinWarn(1, 'metin_a', 0, 0, 2, false);
      b.metinImpact(1, 'metin_a', 0, 0, 5, true);
      b.metinAwaken(1, 'metin_a', 0, 0);
      b.chestOpen(0, 0, 0, true, 0);
    }, { players: [{ x: 0, z: 0 }] } as unknown as World);
    expect(r.hs.stats.granted).toBe(0);
    expect(r.hs.left).toBe(0);
  });

  it('a Champion Hunt runEvent that is not an end, an end that failed, or another kind never holds', () => {
    const r = rig();
    r.step(death(2));
    r.advance(16);
    r.step((b) => {
      death(2)(b);
      championEnd(1, 1, 'championHunt', 'active')(b);
    });
    const afterActive = r.hs.stats.granted;
    r.advance(16);
    r.step((b) => {
      death(2)(b);
      championEnd(2, 0)(b); // failed
    });
    r.advance(16);
    r.step((b) => {
      death(2)(b);
      championEnd(3, 1, 'metinRain')(b);
    });
    expect(r.hs.stats.byKind.championDeath ?? 0).toBe(0);
    expect(afterActive).toBe(2); // only the two pack leaders of those steps
  });

  it('the champion: its death and the hunt\'s end (p 1) of the same step hold once even while the pack-leader lane is cooling', () => {
    const r = rig();
    r.step(death(2)); // a pack leader fell 4 s ago and held
    r.advance(4);
    expect(r.hs.stats.granted).toBe(1);
    r.step((b) => {
      death(2)(b); // the champion: the leader lane (15 s) refuses it ...
      championEnd(7)(b); // ... the hunt's end (the gap alone) grants it
    });
    expect(r.hs.stats.granted).toBe(2);
    expect(r.hs.log[1]).toMatchObject({ kind: 'championDeath', ms: 55 });
  });

  it('when the champion\'s own death already held (quiet lane), the hunt\'s end adds nothing: still one hold for that kill', () => {
    const r = rig();
    r.step((b) => {
      death(2)(b);
      championEnd(7)(b);
    });
    expect(r.hs.stats.granted).toBe(1);
    expect(r.hs.log[0]?.ms).toBe(55);
  });

  it('the hunt\'s end re-sent every 5 s while it lingers, or met by a late-joining guest, holds nothing (no champion fell just now)', () => {
    const r = rig();
    r.step((b) => {
      death(2)(b);
      championEnd(7)(b);
    });
    r.advance(5);
    r.step(championEnd(7)); // the heartbeat
    r.advance(5);
    r.step(championEnd(7));
    const late = rig();
    late.step(championEnd(9)); // a guest that joins during the linger: the 'end' without any death
    expect(r.hs.stats.granted).toBe(1);
    expect(late.hs.stats.granted).toBe(0);
  });

  it('two separate hunts hold twice (the id tells them apart)', () => {
    const r = rig();
    r.step((b) => {
      death(2)(b);
      championEnd(7)(b);
    });
    r.advance(16);
    r.step((b) => {
      death(2)(b);
      championEnd(8)(b);
    });
    expect(r.hs.stats.granted).toBe(2);
  });
});

describe('RenderEventRouter: screen shake setting, run lifecycle', () => {
  it('settings.screenShake scales every hold; 0 turns hit-stop off (the camera shake path is untouched)', () => {
    const r = rig(0.5);
    r.step(metinBreak());
    expect(r.hs.log[0]?.ms).toBeCloseTo(30, 9);
    r.advance(3.1);
    r.setShake(0);
    r.step(metinBreak());
    r.step(bossPhase());
    r.step(death(2));
    r.step(bossDeath(true));
    expect(r.hs.stats.granted).toBe(1);
    r.setShake(1);
    r.step(bossPhase()); // the refused ones used no gap
    expect(r.hs.stats.granted).toBe(2);
  });

  it('a run start or end resets the clock and the limits', () => {
    const r = rig();
    r.step(metinBreak());
    r.advance(1);
    runEvents.runEnd(NO_WORLD);
    expect(r.hs.now).toBe(0);
    expect(r.hs.left).toBe(0);
    r.step(metinBreak()); // 1 s after the last hold, but it is a new run
    expect(r.hs.stats.granted).toBe(1);
    runEvents.runStart(NO_WORLD);
    r.step(metinBreak());
    expect(r.hs.stats.granted).toBe(1);
  });

  it('detach() unsubscribes: no hold after it', () => {
    const r = rig();
    r.router.detach();
    r.step(metinBreak());
    expect(r.hs.stats.granted).toBe(0);
  });

  it('the camera shake the router always asked for is unchanged (death 0.35, tier-1 0.08, metin break 0.5 / 0.9, boss death 0.8)', () => {
    const { rw, shakes } = stubRenderWorld();
    const router = new RenderEventRouter(rw);
    router.attach();
    routers.push(router);
    const bus = new EventBus();
    const go = (fill: (b: EventBus) => void): void => {
      bus.clear();
      fill(bus);
      runEvents.dispatch(bus.list, NO_WORLD);
    };
    go(death(1));
    go(death(2));
    go(metinBreak(false));
    go(metinBreak(true));
    go(bossDeath(false));
    expect(shakes).toEqual([0.08, 0.35, 0.5, 0.9, 0.8]);
  });
});

describe("RenderEventRouter: only moments the local player can see hold a frame (a partner's kill elsewhere holds nothing)", () => {
  /** the hero stands at the origin and sees x in [-10, 10], z in [-8, 8] */
  const SEES: View = { x0: -10, x1: 10, z0: -8, z1: 8 };

  it('an off-screen pack-leader death holds nothing and leaves the 3 s gap and the 15 s leader lane free; an on-screen one holds', () => {
    const r = rig();
    Object.assign(r.view, SEES);
    r.step(death(2, 0, 60, 0));
    r.step(death(2, 1, 0, -40));
    expect(r.hs.stats.granted).toBe(0);
    expect(r.hs.stats.denied).toBe(0); // never asked: no budget used
    expect(r.hs.left).toBe(0);
    // the very next on-screen leader kill (same instant) is granted: neither the gap nor the lane was spent
    r.step(death(2, 0, 4, 3));
    expect(r.hs.stats.granted).toBe(1);
    expect(r.hs.log[0]).toMatchObject({ kind: 'leaderDeath', ms: 55 });
    // an off-screen and an on-screen kill in the same step: exactly the on-screen one holds
    const q = rig();
    Object.assign(q.view, SEES);
    q.step((b) => {
      death(2, 0, 99, 99)(b);
      death(2, 0, -3, 2)(b);
    });
    expect(q.hs.stats.granted).toBe(1);
  });

  it('the view margin: a death just outside the footprint but within HIT_STOP_VIEW_MARGIN holds, one beyond it does not', () => {
    expect(HIT_STOP_VIEW_MARGIN).toBe(2.5);
    const r = rig();
    Object.assign(r.view, SEES);
    r.step(death(2, 0, SEES.x1 + HIT_STOP_VIEW_MARGIN + 0.5, 0));
    expect(r.hs.stats.granted).toBe(0);
    r.step(death(2, 0, SEES.x1 + HIT_STOP_VIEW_MARGIN - 0.5, 0));
    expect(r.hs.stats.granted).toBe(1);
  });

  it('a regular metin that breaks off screen holds nothing; in view it holds; the Great Metin (announced by the HUD) holds from anywhere', () => {
    const r = rig();
    Object.assign(r.view, SEES);
    r.step(metinBreak(false, 70, 70));
    expect(r.hs.stats.granted).toBe(0);
    expect(r.hs.stats.denied).toBe(0);
    r.step(metinBreak(false, 5, 1));
    expect(r.hs.log[0]).toMatchObject({ kind: 'metinBreak', ms: 60 });
    r.advance(3.1);
    r.step(metinBreak(true, 120, -120));
    expect(r.hs.stats.byKind.metinBreak).toBe(2);
  });

  it('boss phase, boss death and the final boss death stay global (the HUD announces them): they hold with nothing in view', () => {
    const r = rig();
    Object.assign(r.view, { x0: 1000, x1: 1001, z0: 1000, z1: 1001 }); // the camera is far away from everything
    r.step(bossPhase());
    r.advance(3.1);
    r.step(bossDeath(false));
    r.advance(3.1);
    r.step(bossDeath(true));
    expect(r.hs.stats.byKind).toEqual({ bossPhase: 1, bossDeath: 1, finalBossDeath: 1 });
  });

  it('the champion is not paired with a kill that fell out of view: its hunt end holds nothing either', () => {
    const r = rig();
    Object.assign(r.view, SEES);
    r.step((b) => {
      death(2, 0, 80, 80)(b);
      championEnd(5)(b);
    });
    expect(r.hs.stats.granted).toBe(0);
    r.advance(1);
    r.step((b) => {
      death(2, 0, 2, 2)(b);
      championEnd(6)(b);
    });
    expect(r.hs.stats.granted).toBe(1);
  });

  it('a kill that is out of view uses no budget: 40 off-screen leader kills, then one in view is still granted at once', () => {
    const r = rig();
    Object.assign(r.view, SEES);
    for (let i = 0; i < 40; i++) {
      r.step(death(2, 0, 50 + i, 50));
      r.advance(0.5);
    }
    expect(r.hs.stats.granted + r.hs.stats.denied).toBe(0);
    r.step(death(2, 0, 0, 0));
    expect(r.hs.stats.granted).toBe(1);
  });

  it("with the real camera footprint (CameraRig.isVisible): the hero's surroundings are in view, a spot 60 m to the side and the far side of the map are not", () => {
    const cam = new CameraRig();
    cam.setTarget(10, 0, -20);
    cam.snap();
    cam.update(0);
    const { rw } = stubRenderWorld(1, cam);
    const router = new RenderEventRouter(rw);
    router.attach();
    routers.push(router);
    const bus = new EventBus();
    const go = (fill: (b: EventBus) => void): void => {
      bus.clear();
      fill(bus);
      runEvents.dispatch(bus.list, NO_WORLD);
    };
    go(death(2, 0, 10, -20)); // on the hero
    expect(router.hitStop.stats.granted).toBe(1);
    router.hitStop.reset();
    go(death(2, 0, 70, -20)); // 60 m to the side
    go(death(2, 0, 10, 60)); // 80 m behind
    go(death(2, 0, -90, -90));
    expect(router.hitStop.stats.granted).toBe(0);
    go(metinBreak(false, 10, -35)); // a bit ahead: inside the footprint
    expect(router.hitStop.stats.byKind.metinBreak).toBe(1);
  });
});

describe('RenderEventRouter: co-op guest through the real codec (host EventCollector -> decodeEvents -> runEvents.dispatch -> router)', () => {
  /** the host collects a step's events; a guest decodes the block into its own bus and dispatches it to its router (what net/coop/mirror.ts does) */
  function guestRig(hero: { x: number; z: number }) {
    const strings = new WireStrings();
    const collector = new EventCollector(strings);
    const cam = new CameraRig();
    cam.setTarget(hero.x, 0, hero.z);
    cam.snap();
    cam.update(0);
    const { rw } = stubRenderWorld(1, cam);
    const router = new RenderEventRouter(rw);
    router.attach();
    routers.push(router);
    const guestBus = new EventBus();
    const sink: EventSink = { bus: guestBus, player: (host) => host, enemy: (n) => n, str: (id) => strings.names[id] ?? '' };
    return {
      router,
      deliver(fill: (b: EventBus) => void): void {
        const hostBus = new EventBus();
        fill(hostBus);
        collector.collect(hostBus.list);
        const block = collector.flush();
        guestBus.clear();
        decodeEvents(new ByteReader(block.bytes), block.count, sink);
        runEvents.dispatch(guestBus.list, NO_WORLD);
      },
    };
  }

  it("the partner's pack-leader kill on the guest's screen holds; the partner's kill far across the map does not, and spends nothing", () => {
    const g = guestRig({ x: 0, z: 0 });
    // the partner (host player 1) kills a leader 90 m away and breaks a metin 100 m away: the events reach the guest, its screen shows nothing there
    g.deliver(death(2, 1, 90, 40));
    g.deliver(metinBreak(false, -85, 60));
    expect(g.router.hitStop.stats.granted).toBe(0);
    expect(g.router.hitStop.stats.denied).toBe(0);
    expect(g.router.hitStop.left).toBe(0);
    // the partner's kill next to the guest hero (quantised on the wire) holds, at once
    g.deliver(death(2, 1, 5, 4));
    expect(g.router.hitStop.stats.granted).toBe(1);
    expect(g.router.hitStop.log[0]).toMatchObject({ kind: 'leaderDeath', ms: 55 });
    // the same rule for the guest's own kill (host index 0 on the wire) and for a metin
    g.router.hitStop.reset();
    g.deliver(death(2, 0, -120, 0));
    expect(g.router.hitStop.stats.granted).toBe(0);
    g.deliver(metinBreak(false, 4, -3));
    expect(g.router.hitStop.log[0]).toMatchObject({ kind: 'metinBreak', ms: 60 });
  });

  it('a boss phase still reaches the guest as a hold (global), and a late-joining guest starts with a clean gate and its own view', () => {
    const g = guestRig({ x: 0, z: 0 });
    g.deliver(bossPhase());
    expect(g.router.hitStop.log[0]).toMatchObject({ kind: 'bossPhase', ms: 45 });
    // a guest that joins later has a fresh router (new clock, no gap) and stands elsewhere: the old fight at the origin is off its screen
    const late = guestRig({ x: 200, z: 200 });
    late.deliver(death(2, 1, 0, 0));
    expect(late.router.hitStop.stats.granted).toBe(0);
    late.deliver(death(2, 1, 205, 198));
    expect(late.router.hitStop.stats.granted).toBe(1);
  });
});

describe('the screen shake setting says it also scales the hit-stop (up_feel i18n part)', () => {
  it.each(['en', 'tr'] as const)('%s: the shake slider hint names the hit-stop and the 0 % case', (lang) => {
    const hint = dictionaries[lang]['settings.gfx.shake.hint'] ?? '';
    expect(hint).toMatch(lang === 'en' ? /hit-stop/i : /duraksama/i);
    expect(hint).toContain(lang === 'en' ? '0%' : '%0');
  });
});

describe('heroHoldScale: the hero views hold only while no hero walks (a hero never slides along in a frozen pose)', () => {
  const stand = { speed: 0, dead: false };
  const walk = { speed: 5.5, dead: false };
  it('is 1 outside a hold, whatever the heroes do', () => {
    expect(heroHoldScale(1, [stand])).toBe(1);
    expect(heroHoldScale(1, [walk])).toBe(1);
  });
  it('holds a standing hero and lets a walking one run at full speed; one walking hero frees all of them', () => {
    expect(heroHoldScale(0.05, [stand])).toBe(0.05);
    expect(heroHoldScale(0.05, [walk])).toBe(1);
    expect(heroHoldScale(0.05, [stand, walk])).toBe(1);
    expect(heroHoldScale(0.05, [stand, stand])).toBe(0.05);
  });
  it('a dead hero or a missing slot does not count as walking; the walking limit is the run-cycle limit', () => {
    expect(heroHoldScale(0.05, [{ speed: 6, dead: true }, undefined, stand])).toBe(0.05);
    expect(heroHoldScale(0.05, [{ speed: 0.4, dead: false }])).toBe(0.05);
    expect(heroHoldScale(0.05, [{ speed: 0.41, dead: false }])).toBe(1);
    expect(heroHoldScale(0.05, [])).toBe(0.05);
  });
});

describe('RenderEventRouter: the real sim emits what the router expects', () => {
  it('a hero killing a pack leader holds; the same leader despawning (the Champion Hunt out of time) does not; a tier-1 elite never does', () => {
    const w = makeWorld();
    freezeSchedules(w);
    const { rw } = stubRenderWorld();
    const router = new RenderEventRouter(rw);
    router.attach();
    routers.push(router);
    const kill = (row: number): SimEvent[] => {
      w.events.length = 0;
      const c = newHitCtx();
      c.noCrit = true;
      c.player = 0;
      hitEnemy(w, row, 1e15, c);
      return w.events.slice();
    };
    const leader = spawn(w, 'alpha_wolf', 6, 0, { tier: 2 });
    const evs = kill(leader);
    const d = evs.find((e) => e.t === 'enemyDeath');
    expect(d).toMatchObject({ t: 'enemyDeath', tier: 2, killer: 0 });
    runEvents.dispatch(evs, w);
    expect(router.hitStop.stats.granted).toBe(1);

    // a tier-1 elite a hero kills: no hold (the late bands kill one every ~2 s)
    router.hitStop.reset();
    const elite = spawn(w, 'alpha_wolf', 6, 1, { tier: 1 });
    runEvents.dispatch(kill(elite), w);
    expect(router.hitStop.stats.granted).toBe(0);

    // the despawn of the Champion Hunt: killer -1
    const burrow = spawn(w, 'alpha_wolf', 6, 2, { tier: 2 });
    w.events.length = 0;
    expect(despawnEnemy(w, burrow)).toBe(true);
    const gone = w.events.find((e) => e.t === 'enemyDeath');
    expect(gone).toMatchObject({ tier: 2, killer: -1 });
    runEvents.dispatch(w.events.slice(), w);
    expect(router.hitStop.stats.granted).toBe(0);
  });
});

describe('dense late band: a minute of pack leaders, elites, metins and phases never stutters', () => {
  /** one simulated minute at 60 fps: events from a rate table, every frame advances the clock */
  function minute(rates: { leader: number; elite: number; metin: number; phase: number }, seconds = 60): HitStop {
    const r = rig();
    const frames = Math.round(seconds * 60);
    for (let f = 0; f < frames; f++) {
      r.step((b) => {
        if (rates.leader > 0 && f % Math.round(60 / rates.leader) === 0) death(2)(b);
        if (rates.elite > 0 && f % Math.round(60 / rates.elite) === 0) death(1)(b);
        if (rates.metin > 0 && f % Math.round(60 / rates.metin) === 17) metinBreak()(b);
        if (rates.phase > 0 && f % Math.round(60 / rates.phase) === 31) bossPhase()(b);
      });
      r.hs.scale(1 / 60);
    }
    return r.hs;
  }

  it.each([
    ['Yeonmu late (a leader every 2 s, an elite every 2 s, a metin a minute)', { leader: 0.5, elite: 0.5, metin: 1 / 60, phase: 0 }],
    ['doubled band rates (a leader every second, an elite every second)', { leader: 1, elite: 1, metin: 1 / 30, phase: 0 }],
    ['worst case: a leader every second, a metin every 4 s, a phase every 4 s', { leader: 1, elite: 2, metin: 0.25, phase: 0.25 }],
  ])('%s: at most 1 per 3 s and 12 per minute', (_name, rates) => {
    const hs = minute(rates);
    expect(hs.stats.granted).toBeLessThanOrEqual(HIT_STOP_PER_MINUTE);
    expect(hs.stats.granted).toBeGreaterThan(0);
    const times = hs.log.map((g) => g.at);
    for (let i = 1; i < times.length; i++) expect((times[i] as number) - (times[i - 1] as number)).toBeGreaterThanOrEqual(HIT_STOP_GAP - 1e-6);
    // the total time the world spent held in that minute stays well under a second
    expect(hs.stats.ms).toBeLessThan(800);
  });
});
