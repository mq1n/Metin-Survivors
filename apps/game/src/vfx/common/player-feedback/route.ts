// Player-feedback route (C0 split of the old EventAdapter.onPlayerHit): hit / evade / shield-absorb on the hero.
import { route, type EventRoute } from '../route';
import { HIT_BY_ELEMENT } from './specs';

export function playerFeedbackRoutes(): readonly EventRoute[] {
  /** alternates the dodge side of player.evade when the attacker is level with the hero on the screen (SpawnOpts.b < 0 mirrors the spec's x axis) */
  let side = 1;
  return [
    route(['playerHit'], (e, ctx) => {
      // result: 0 hit, 1 evaded, 2 absorbed by the trinket shield, 3 soaked by a skill ward / the war oath. A ward draws NOTHING here: the saturated blue
      // `player.shield` spike egg on every absorbed blow turned every shell (granite, violet, gold, green) blue and, at 10+ blows a second, caged the hero
      // (skill-logic vfx critic X4); `sk.gen.ward_hit` (tinted by the ward's element, throttled by the sim) is the read of a soaked blow.
      if (e.result === 3) return;
      if (e.result === 1) {
        // r3: the dodge afterimage is a screen sprite of a crouched fighter that FACES its motion (b > 0 faces screen-left, b < 0 screen-right), so the
        // frame is pinned to the screen: local +X = world -X (screen-left), local +Z = world -Z (up the screen). The hero slips AWAY from the attacker
        // along the screen's horizontal (attacker on the right -> dodge left); an attacker straight above / below alternates the side.
        const o = ctx.o(e.x, e.z, 1, 0, -1);
        o.y = ctx.heightAt(e.x, e.z) + 1.0;
        o.element = e.element;
        const away = e.srcX - e.x;
        if (Math.abs(away) < 0.6) side = -side;
        o.b = Math.abs(away) < 0.6 ? side : away > 0 ? 1 : -1;
        ctx.fire('player.evade', o);
        return;
      }
      const o = ctx.o(e.x, e.z, 1, e.x - e.srcX, e.z - e.srcZ);
      o.y = ctx.heightAt(e.x, e.z) + 1.0;
      o.element = e.element;
      // hit: SpawnOpts.b mirrors the slash toward the side the blow travels to (screen x of the heading)
      o.b = e.result === 0 ? (e.x - e.srcX < 0 ? 1 : -1) : 0;
      // r2: a hit plays the family of its element (sim element index -> spec id), an unknown element the physical one
      const hitId = HIT_BY_ELEMENT[e.element] ?? 'hit.player';
      ctx.fire(e.result === 0 ? hitId : 'player.shield', o);
    }),
  ];
}
