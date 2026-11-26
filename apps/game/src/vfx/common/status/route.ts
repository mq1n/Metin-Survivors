// Status route (C0 split of the old EventAdapter.onDamage, DoT part): damage-over-time tick puffs. The persistent status
// loops on enemies (stun / slow / poison / burn) are driven by vfx/skills/common/statusFeed.ts, not by events.
import { VRng } from '../../util';
import type { Resolved } from '../../presets';
import { route, type EventRoute } from '../route';

/** C1: share of DoT ticks that show a puff (was a hard 30 % roll); the per-element bucket below caps the volume */
export const DOT_CHANCE = 1;
/** puffs per second per element (token bucket refill) and the burst size */
export const DOT_RATE = 10;
export const DOT_BURST = 4;
/** r1-r3: tick size (scale of the hit.dot.* specs, authored at humanoid size): 1.7 = a ~0.5 m flame lick / gas puff / splatter, ~30 px at the game camera (r2 2.3 read as big as the hero's torso; 1.0 was a 15 px speck on snow) */
export const DOT_SCALE = 1.7;

export function statusRoutes(): readonly EventRoute[] {
  const dot: (Resolved | null)[] = [];
  let resolved = false;
  const tokens = new Float32Array(8).fill(DOT_BURST);
  const rng = new VRng(77);
  return [
    route(
      ['damage'],
      (e, ctx) => {
        if (!e.dot) return;
        if (!resolved) {
          dot[0] = ctx.resolve('hit.dot.bleed');
          dot[1] = ctx.resolve('hit.dot.burn');
          dot[5] = ctx.resolve('hit.dot.poison');
          resolved = true;
        }
        if (DOT_CHANCE < 1 && rng.f() > DOT_CHANCE) return;
        const el = e.element >= 0 && e.element < 8 ? e.element : 0;
        if ((tokens[el] as number) < 1) return;
        tokens[el] = (tokens[el] as number) - 1;
        const d = dot[el] ?? dot[0];
        if (!d) return;
        const o = ctx.o(e.x, e.z, DOT_SCALE);
        o.y = ctx.heightAt(e.x, e.z) + 0.8;
        ctx.spawnResolved(d, o);
      },
      {
        update: (dt) => {
          for (let i = 0; i < 8; i++) tokens[i] = Math.min(DOT_BURST, (tokens[i] as number) + DOT_RATE * dt);
        },
      },
    ),
  ];
}
