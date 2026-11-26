// SIM-06: RenderEventRouter honours SkillCastEvent.noHeroAnim so Shadow Clone mimic casts do not trigger animations
// on the real hero, while normal casts with an empty heroClip still fall back to 'attack' / 'cast'.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RenderWorld } from '../../render/world';
import { EventBus, type SkillCastEvent } from '../../sim/events';
import { castNow } from '../../sim/skills';
import type { SkillInstance } from '../../sim/stores';
import type { World } from '../../sim/world';
import { hero, only, realWorld, ringOf, step } from '../../sim/__tests__/skillLab';
import { RenderEventRouter } from '../renderEvents';
import { runEvents } from '../runEvents';

const NO_WORLD = { players: [] } as unknown as World;

interface TriggerCall {
  clip: string;
  speed: number;
  hold: boolean;
  aimYaw: number | undefined;
}

const activeRouters: RenderEventRouter[] = [];

function createRouterHarness(): {
  router: RenderEventRouter;
  bus: EventBus;
  calls: TriggerCall[];
  trigger: ReturnType<typeof vi.fn>;
} {
  const calls: TriggerCall[] = [];
  const trigger = vi.fn((clip: string, speed: number, hold: boolean, aimYaw?: number) => {
    calls.push({ clip, speed, hold, aimYaw });
  });
  const rw = {
    hitStop: null,
    core: { rig: { shakeScale: 1, isVisible: () => true } },
    shake: () => undefined,
    enemyDied: () => undefined,
    damage: { spawn: () => undefined, spawnText: () => undefined },
    heroes: { views: [{ trigger }] },
  } as unknown as RenderWorld;
  const router = new RenderEventRouter(rw);
  router.attach();
  activeRouters.push(router);
  return { router, bus: new EventBus(), calls, trigger };
}

afterEach(() => {
  while (activeRouters.length > 0) activeRouters.pop()?.detach();
});

describe('RenderEventRouter skillCast hero animation routing (SIM-06)', () => {
  it('suppresses view.trigger when noHeroAnim is true, even if heroClip is empty', () => {
    const { bus, calls, trigger } = createRouterHarness();
    bus.clear();
    bus.skillCast(0, 1, 'creeping_venom', 'chain', 0, 0, 1, 0, 2, false, '', true);
    runEvents.dispatch(bus.list, NO_WORLD);
    expect(trigger).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it('preserves the attack / cast fallback for normal casts with empty heroClip (noHeroAnim = false)', () => {
    const { bus, calls } = createRouterHarness();
    bus.clear();
    bus.skillCast(0, 0, 'basic_slash', 'meleeArc', 0, 0, 1, 0, 2, false, '', false);
    bus.skillCast(0, 1, 'creeping_venom', 'chain', 0, 0, 0, 1, 2, false, '', false);
    bus.skillCast(0, 2, 'wyrmstrike', 'projectile', 0, 0, 1, 0, 2, false, 'attack2', false);
    runEvents.dispatch(bus.list, NO_WORLD);

    expect(calls.map((c) => c.clip)).toEqual(['attack', 'cast', 'attack2']);
  });

  it('end-to-end: a Shadow Clone mimic cast emits noHeroAnim=true and does not trigger the real hero view', () => {
    const { trigger } = createRouterHarness();
    const w = realWorld({ classId: 'ninja', doctrine: 'a' });
    const [clone, venom] = only(w, ['shadow_clone', 'creeping_venom'], 0) as [SkillInstance, SkillInstance];
    const p = hero(w);
    p.iframes = 1e9;
    ringOf(w, 'wild_dog', 5, 3);
    w.hash.rebuild(w.enemies);
    for (const s of p.skills) s.cd = 1e9;

    clone.cd = 0;
    expect(castNow(w, p, clone)).toBe(true);
    step(w, 2);
    clone.cd = 1e9;

    // hero casts creeping_venom (normal cast -> hero animation triggers once)
    venom.cd = 0;
    w.hash.rebuild(w.enemies);
    w.bus.clear();
    expect(castNow(w, p, venom)).toBe(true);
    const heroCastEv = w.events.find((e): e is SkillCastEvent => e.t === 'skillCast' && e.skillId === 'creeping_venom');
    expect(heroCastEv?.noHeroAnim).toBe(false);
    runEvents.dispatch(w.events, w);
    expect(trigger).toHaveBeenCalledTimes(1);

    // now advance so the Shadow Clone dispatches its mimic copy; route every sim event to RenderEventRouter
    trigger.mockClear();
    let mimicCasts = 0;
    for (let k = 0; k < 30; k++) {
      w.step([{ moveX: 0, moveZ: 0 }]);
      for (const e of w.events) {
        if (e.t === 'skillCast' && e.skillId === 'creeping_venom') {
          expect(e.heroClip).toBe('');
          expect(e.noHeroAnim).toBe(true);
          mimicCasts++;
        }
      }
      runEvents.dispatch(w.events, w);
    }
    expect(mimicCasts).toBe(1);
    expect(trigger).not.toHaveBeenCalled();
  });
});
