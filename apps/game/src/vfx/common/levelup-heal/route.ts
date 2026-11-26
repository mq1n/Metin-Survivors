// Self-feedback routes (C0 split of the old EventAdapter.onHeal / onLevelUp / onCardPick / onPlayerRevive / onPlayerDeath)
// with the C1 fixes: revive plays once (the sim also emits the `vfx_revive` alias), lifesteal at full size but rate
// limited, and no holy.heal on top of a skill that already plays its own cure.
import { route, type EventRoute } from '../route';
import { LEVEL_UP_MILESTONE_EVERY, LEVEL_UP_MILESTONE_RANK } from './levelSpecs';

/** seconds within which the typed playerRevive event and the `vfx_revive` alias count as one revive */
export const REVIVE_DEDUPE = 0.25;
/** a lifesteal heal decoration at most this often (lifesteal fires on many hits per second) */
export const DRAIN_GAP = 0.4;
/** skill heals skip holy.heal when the skill's own cure effect (sk.mending_light) played within this window */
export const CURE_WINDOW = 0.25;

export function levelupHealRoutes(): readonly EventRoute[] {
  // LVL-01: the level-ups one hero gets in ONE VFX frame (a big XP burst: grantXp emits one levelUp event per level) play ONE beat, not a stack of
  // rings. Per player: the frame (adapter clock) of the last beat and whether it was the milestone beat. A later level of the same frame is skipped,
  // unless it is a milestone and the beat on screen is not (the events come in ascending order, so a batch that holds a multiple of 5 plays the
  // milestone beat after the plain one: the only case that still stacks two beats, and a cheap one, see levelSpecs.ts).
  const lastFrame = [-1, -1, -1, -1];
  const lastMilestone = [false, false, false, false];
  return [
    route(['heal'], (e, ctx) => {
      
      if (e.source === 0 || e.source === 2) return;
      // 5 = the caster's own cast heal (HealSource.CastSelf): the self buff plays its own look, a cream holy.heal pillar on top of it bleached the hero (recheck B2); the number still shows
      if (e.source === 5) return;
      if (e.source === 1 && !ctx.once('heal.drain', DRAIN_GAP)) return;
      if (e.source === 3 && ctx.since('sk.mending_light') < CURE_WINDOW) return;
      const p = ctx.players;
      const i = e.player < 0 || e.player > 3 ? 0 : e.player;
      const o = ctx.o(p[i * 3] as number, p[i * 3 + 2] as number, 1);
      
      ctx.fire(e.source === 1 ? 'heal.drain' : e.source === 4 ? 'sk.gen.potion_auto_red' : 'holy.heal', o);
    }),
    route(['levelUp'], (e, ctx) => {
      const p = ctx.players;
      const i = e.player < 0 || e.player > 3 ? 0 : e.player;
      const milestone = e.level > 0 && e.level % LEVEL_UP_MILESTONE_EVERY === 0;
      if (lastFrame[i] === ctx.time && (!milestone || lastMilestone[i])) return;
      const o = ctx.o(p[i * 3] as number, p[i * 3 + 2] as number, 1);
      // LVL-01: every 5th level is the bigger milestone beat (the spec's `minRank` elements: a 5 m ring, a second ring, a wider crown, more sparks)
      if (milestone) o.rank = LEVEL_UP_MILESTONE_RANK;
      lastFrame[i] = ctx.time;
      lastMilestone[i] = milestone;
      ctx.fire('sk.gen.level_up', o);
    }, {
      reset: () => {
        lastFrame.fill(-1);
        lastMilestone.fill(false);
      },
    }),
    route(['cardPick'], (e, ctx) => {
      
      if (e.kind === 'heal') return;
      const p = ctx.players;
      const i = e.player < 0 || e.player > 3 ? 0 : e.player;
      ctx.fire('sk.gen.skillup', ctx.o(p[i * 3] as number, p[i * 3 + 2] as number, 1));
    }),
    route(['playerRevive'], (e, ctx) => {
      if (ctx.once('player.revive', REVIVE_DEDUPE)) ctx.fire('player.revive', ctx.o(e.x, e.z, 1));
    }),
    route(['playerDeath'], (e, ctx) => {
      ctx.fire('player.death', ctx.o(e.x, e.z, 1));
    }),
  ];
}
