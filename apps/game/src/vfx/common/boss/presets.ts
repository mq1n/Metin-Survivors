// Boss set pieces: spawn, phase, enrage, death, slam, nova, volley, teleport, summon, charge (common VFX target `boss`; owner: the boss builder).



//    whitedragon_boss2's translucent blue-violet haze wall with light streaks and bright faceted crystals. Every event now opens with a standing
//    volume in the element hue, a mid-tone alpha body (never a dark stain on snow) with a luminous additive core, rising 1-2 x the boss height;
//  - every event has its OWN silhouette: spawn = columns erupting on a ring + a dark spiral; phase = one bright beam + wind; slam = a dust crown and
//    thrown chips; nova = a sweeping haze wall; death = a round boiling ball at hip height (+ a rising tower); enrage = red flame tongues + black smoke;
//    summon = smoke plumes + broken arcs where the minions come in; teleport = a spiral and a column; volley = a muzzle blast;
//  - chips are element chips (glowing cyan crystals under ice, lava-faced rocks under fire), never black dice;
//  - the floor keeps a short, faint memory (a thin scar in the floor's own darker shade, a faint broken ring), never the main shape;
//  - the element palette comes from the event (sim `elementOfRaces`) or the boss id (route.ts); enrage reads blood red whatever the element;
//  - nothing covers the screen: no full-screen tint, flashes are small and short, every block is bounded by the radius of the event.

// additive star-burst rings over a white flare core"; "the enrage burst grew into a 30-40 % flame field, orange even on the ice golem"):
//  - slam / nova / enrage burst / phase / volley / teleport open with `rayBurst`: a ring of fine rays racing over the floor + a white-hot flare core, <= 0.3 s;
//  - the enrage is the ELEMENT's swirl smoke hugging the body (orbitSmoke: it carries the body's velocity, so a walking boss keeps it), not a flame field;
//  - the slam has hot cracks that cool + a pit that lives (pit); ice chips are three kinds of shard at four sizes thrown over the whole disc;
//  - no hard + / x glints (motes / sparkle), summon + teleport are twisting columns, not lavender blobs; the set pieces are slimmer (crop coverage <= 30 %).
// Ids and sizes are the contract (ids: vfx/presets/boss.ts barrel; routes + sim aliases scale them): see each preset's `size` / `base`.
import type { Ctx, Fx } from '../../emit';
import type { Inst } from '../../system';
import { mixHex } from '../../util';
import { FO, M, SC, SPR, TAU, cinders, flash, glow, ringArc, sparks, wisps } from '../../presets/kit';
import type { PresetDef } from '../../presets/types';
import { BOSS_ART, BOSS_RING_ART } from './art';
import { TEX_BODY, accent, ball, beam, chips, dustFront, dustHex, flames, groundGlow, hazeWall, motes, orbitSmoke, orbitStreamer, pit, plume, rayBurst, ringOn, scar, smokeVol, sparkle, streamers, swirl, underlay, windOut } from './blocks';
import { EL, bossPal, enragePal, hazeTone } from './look';

/** the element of a spawn (0 = physical when the caller gave none) */
function elOf(c: Ctx): number {
  return c.element > 0 && c.element < 8 ? c.element : 0;
}

/** tint of a thin hot rim: the element hue pulled toward the core (never the bare cream core: it turns the ring white) */
function hot(p: { main: number; core: number }): number {
  return mixHex(p.main, p.core, 0.25);
}

/** the pit colour of a crater: the floor's own dark shade of the element (never a black blot) */
/** the dark underlay under a set piece: the element body pulled toward black; on snow barely (a navy patch on white is an ink blot) */
function under(el: number, body: number): number {
  return mixHex(body, 0x000000, el === EL.ice ? 0.1 : 0.45);
}

function pitColor(el: number): number {
  // snow keeps a cool grey-blue pit (a black pit on a white floor is an ink blot)
  return mixHex(hazeTone(el).scar, 0x000000, el === EL.ice ? 0.08 : 0.4);
}

// ---------------------------------------------------------------------------------------------------------------- spawn

/** the ground gives way: columns of smoke erupt on a ring round the body, a dark smoke spiral turns toward it, the boss rises through the haze */
function rupture(fx: Fx, c: Ctx, final: boolean): void {
  const rng = fx.rng;
  const p = bossPal(c);
  const el = elOf(c);
  const hz = hazeTone(el);
  const s = Math.min(c.scale, 1.5);
  /** a scarlet-wyrm sized boss would put smoke across the screen: the set piece is never wider than 7.5 m (5.8 m for the final one: r3 slimmed it, the critic measured 34-45 % of the tile) */
  const R = Math.min(c.radius, final ? 6.2 : 7.5);
  const Rs = Math.min(R, 5.2);
  /** the boss's height proxy (the sim has the radius only) */
  const H = 3.3 * s;
  const { x, y, z } = c;
  const f = final ? 1 : 0;
  const dust = dustHex(el);
  
  dustFront(fx, x, y, z, fx.n(12 + 2 * f), R * 0.9, 0.9, dust, 0.36, 1.3 * s);
  swirl(fx, x, z, R * 1.0, R * 0.5, 1.3, hz.body, hz.glow, 0.5, 2.0);
  if (final) swirl(fx, x, z, R * 0.45, R * 0.8, 1.0, hz.body, hz.glow, 0.24, -2.6, 0.25, 0.08);
  // the eruption: smoke columns on a ring round the body (never one dead centre: the model stays readable), each leaning outward
  const nP = final ? 5 : 4;
  const a0 = rng.f() * TAU;
  for (let k = 0; k < nP; k++) {
    const ang = a0 + (k / nP) * TAU + rng.s2(0.25);
    const rr = R * 0.5 * rng.r(0.85, 1.15);
    plume(fx, x + Math.sin(ang) * rr, y, z + Math.cos(ang) * rr, H * rng.r(1.5, 1.9) * (1 + 0.1 * f), Rs * (final ? 0.29 : 0.34), fx.n(7), 1.2, hz.body, hz.glow, 0.72, 0.5, k * 0.035, Math.sin(ang) * 0.7, Math.cos(ang) * 0.7);
  }
  streamers(fx, x, y, z, 3 + f, Rs * 1.4, 1.4, hz.body, hz.glow, 0.8, 0.5, 0.05, Rs * 0.5);
  // a bright beam rising behind the body, element chips thrown out, the element's accent (ice crowns / flame jets / violet threads), embers
  beam(fx, x, y, z, R * 0.45, H * 2.3, 0.8, p.main, 0.75, 1.3, 0.04);
  chips(fx, el, x, y + 0.4, z, fx.n(9 + 5 * f), R * 1.1, 0.55 * s, 1.6, y, 0.04);
  accent(fx, el, x, y, z, fx.n(6 + 3 * f), R * 0.8, 2.4 * s, 0.75, 0.05);
  cinders(fx, x, y, z, fx.n(18), R * 0.8, 3.2, 1.0, 2.0, 0.2 * s, p.core, p.main, 0.1);
  // the floor keeps only a faint memory: a thin broken ring, a thin scar in the floor's own shade, a faint dark patch
  ringOn(fx, BOSS_RING_ART.ringGrain, x, z, R * 0.25, R * 0.95, 0.75, p.main, 0.42, 1.1, -0.5, 0.06, 0.09, p.edge);
  if (final) ringArc(fx, x, z, R * 0.6, R * 0.95, 0.9, p.extra, 0.34, 1.0, -1.9, 0.25);
  scar(fx, x, z, R * 0.6, 1.5, el, p.main, 0.5, 0.35, 0, final ? 2 : 1);
  underlay(fx, x, z, R * 0.8, 1.2, under(el, hz.body), 0.15);
  fx.shake(0.45 + 0.1 * f);
}

function bossSpawn(final: boolean): PresetDef {
  return {
    id: final ? 'boss.spawn.final' : 'boss.spawn',
    cat: 'boss',
    desc: final
      ? 'Final boss emerges: six smoke columns erupt on a ring round the body (mid-tone element smoke with a luminous core, 1.5-2 x the boss height), two dark smoke spirals, a bright beam, element chips and accents, embers; the floor keeps a thin scar.'
      : 'Boss emerges: four smoke columns erupt on a ring round the body (mid-tone element smoke with a luminous core), a dark smoke spiral, a bright beam, element chips and accents, embers; the floor keeps a thin scar.',
    size: 'mult',
    base: final ? 7 : 5,
    palette: 'boss',
    dur: 2.2,
    loop: false,
    demo: {},
    fire(fx, c) {
      rupture(fx, c, final);
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------- phase

function bossPhase(): PresetDef {
  return {
    id: 'boss.phase',
    cat: 'boss',
    desc: 'Phase change roar: a short ray-ring burst over a flare core at the chest, a tall bright beam bursts up beside the body, a boiling smoke ball is thrown up, wind streaks and a dust skirt run out along the floor, embers lift; a thin faint ring is all the floor keeps.',
    size: 'mult',
    base: 6,
    palette: 'boss',
    dur: 1.2,
    loop: false,
    demo: {},
    fire(fx, c) {
      const p = bossPal(c);
      const el = elOf(c);
      const hz = hazeTone(el);
      const s = Math.min(c.scale, 1.5);
      const R = 6 * s;
      const H = 3.3 * s;
      const { x, y, z } = c;
      const dust = dustHex(el);
      // the roar: a star-burst at the chest (rays racing out over the floor + a flare core), tall luminous beams bursting up BESIDE the body (a beam on the body is hidden by the model)
      rayBurst(fx, x, y, z, R * 0.7, hz.glow, p.edge, { ring: BOSS_RING_ART.rayStreak, life: 0.26, h: 1.3 * s, fs: R * 0.5, fz: 1.9 * s + 0.4, a: 0.85, int: 1.4 });
      for (const sgn of [-1, 1]) beam(fx, x + sgn * R * 0.5, y, z - R * 0.1, R * 0.45, H * 2.7, 0.75, p.main, 0.85, 1.5, sgn > 0 ? 0 : 0.03);
      beam(fx, x, y, z - R * 0.3, R * 0.3, H * 3.0, 0.55, hz.glow, 0.7, 1.5, 0.02);
      // the blast: smoke thrown up out of the body, wind and dust racing out along the floor
      ball(fx, x, y + 1.0 * s, z, fx.n(10), R * 0.2, 3.2, 2.8, 0.8, 1.3, R * 0.28, R * 0.85, hz.body, hz.glow, 0.66, 0.5, 0, 0.03);
      windOut(fx, x, z, fx.n(14), R * 0.2, R * 1.15, 0.7, 3.0 * s, hot(p), 0.65, 1.4);
      dustFront(fx, x, y, z, fx.n(14), R * 0.95, 0.9, dust, 0.45, 1.5 * s);
      accent(fx, el, x, y, z, fx.n(5), R * 0.6, 2.3 * s, 0.6, 0.06);
      cinders(fx, x, y, z, fx.n(12), R * 0.55, 2.8, 0.8, 1.5, 0.18 * s, p.core, p.main, 0.05);
      // the floor: one thin faint band
      ringOn(fx, BOSS_RING_ART.ringShock, x, z, R * 0.15, R * 1.1, 0.6, hot(p), 0.5, 1.4, 0.3, 0.04, 0.07, p.edge);
      fx.shake(0.22);
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------- enrage

/** the body radius the loop hugs: the presets' bases are authored for a 1.8 m body (route.ts passes scale = r / 1.8) */
function bodyRadius(c: Ctx): number {
  return 1.8 * Math.min(1.6, Math.max(0.6, c.scale));
}

/**
 * loop start (r3): a breathing glow on the floor under the body in the rage tone and a faint underlay; the swirl smoke, the ember stream and the turning
 * ground spiral come from `enrageTick`. The route re-spawns this short loop every AURA_EVERY s at the live boss position, so it stays faint (the critic:
 * "a tracked aura that hugs the body, under 15 % of the frame").
 */
function enragePulse(fx: Fx, c: Ctx): void {
  const hz = hazeTone(elOf(c), true);
  const bR = bodyRadius(c);
  const life = Math.min(0.9, Math.max(0.55, c.duration + 0.4));
  underlay(fx, c.x, c.z, bR * 1.1, life, mixHex(hz.body, 0x000000, elOf(c) === EL.ice ? 0.15 : 0.5), 0.26);
  groundGlow(fx, c.x, c.z, bR * 1.25, life, hz.glow, 0.45, 1.0, 0.02);
}

/** loop start: one pulse now; `c.b` = the age of the next pulse (a hand-spawned loop breathes every 0.8 s, the route's short loops only once) */
function enrageFire(fx: Fx, c: Ctx): void {
  enragePulse(fx, c);
  c.b = 0.8;
}

function enrageTick(fx: Fx, c: Inst, dt: number): void {
  const el = elOf(c);
  const p = enragePal(c);
  const hz = hazeTone(el, true);
  const s = Math.min(c.scale, 1.6);
  const bR = bodyRadius(c);
  const k = fx.density;
  if (c.age >= c.b) {
    c.b += 0.8;
    enragePulse(fx, c);
  }
  // where the body is NOW: the route hands the speed (c.a) and the heading, so the smoke is born on the walking body and carries its velocity (r2: the
  // flames were born at the loop's start point and trailed a body-width behind a moving boss)
  const moving = c.a > 0.5;
  const vx = moving ? c.dx * c.a : 0;
  const vz = moving ? c.dz * c.a : 0;
  const x = c.x + vx * c.age;
  const z = c.z + vz * c.age;
  const y = fx.heightAt(x, z);
  const H = 3.3 * s;
  // swirl smoke in the element's rage tone, turning round the body and rising along it (volcano_greatsmoke: rising swirl + curling wisp)
  c.acc0 += dt * 17 * k;
  while (c.acc0 >= 1) {
    c.acc0 -= 1;
    orbitSmoke(fx, x, y, z, vx, vz, bR, H, 2.3 * s, mixHex(hz.body, 0x000000, 0.3), hz.glow, 1.0, 1.7 * s, 3.4 * s, 0.9, 1.4);
  }
  
  if (Math.floor(c.age * 8 * k) !== Math.floor((c.age - dt) * 8 * k)) orbitStreamer(fx, x, y, z, vx, vz, bR, H * 1.1, 2.0 * s, mixHex(hz.body, 0x000000, 0.2), hz.glow, 1.0, 0.9, 1.3);
  // a heavier dark base of the same smoke hugging the feet
  c.acc1 += dt * 3.5 * k;
  while (c.acc1 >= 1) {
    c.acc1 -= 1;
    orbitSmoke(fx, x, y, z, vx, vz, bR * 0.9, H * 0.4, 1.8 * s, mixHex(hz.body, 0x000000, 0.45), -1, 0.5, 1.4 * s, 2.6 * s, 0.8, 1.2);
  }
  // the ground spiral turning under it (a ragged smoke vortex, not a ring outline)
  c.acc2 += dt * 3.3 * k;
  while (c.acc2 >= 1) {
    c.acc2 -= 1;
    swirl(fx, x, z, bR * 1.0, bR * 1.6, 0.7, hz.body, hz.glow, 0.3, 2.6, 0, 0.07);
  }
  // rising embers in the element's hot colour
  c.acc3 += dt * 14 * k;
  while (c.acc3 >= 1) {
    c.acc3 -= 1;
    cinders(fx, x, y, z, 1, bR * 1.0, 3.2, 0.9, 1.6, 0.16 * s, mixHex(hz.glow, 0xffffff, 0.4), hz.glow, 0, 1.8);
  }
  // a fire boss also burns: a few short tongues at its feet (fire is its own element: the r2 flame field on every boss was the critic's cheap flag)
  if (el === EL.fire && Math.floor(c.age * 2.5 * k) !== Math.floor((c.age - dt) * 2.5 * k)) {
    flames(fx, x, y, z, 1, bR * 0.95, 2.6 * s, 1.5 * s, 0.6, 0.9, 0xffd0a0, p.main, 0x5a0a06, 0.95, 1.5);
  }
}

function bossEnrage(): PresetDef {
  return {
    id: 'boss.enrage',
    cat: 'boss',
    desc: 'Enrage aura (tracked on the boss: route.ts re-spawns it at the live boss position with its velocity): the element\'s swirl smoke turning round the body and rising along it (crimson on a plain boss, blue-violet on ice, purple on dark), a turning smoke spiral on the floor, rising embers in the hot colour of the element; a fire boss also gets a few short tongues.',
    size: 'mult',
    base: 3,
    palette: 'boss',
    dur: 900,
    loop: true,
    demo: { loopFor: 4 },
    fire: enrageFire,
    tick: enrageTick,
  };
}

function bossEnrageBurst(): PresetDef {
  return {
    id: 'boss.enrage.burst',
    cat: 'boss',
    desc: 'Enrage trigger: a star-burst (ray ring + flare core, 0.3 s) at the chest in the element\'s rage tone, the rage smoke whirled out of the body in a spiral, an ember fountain and chips; no flame field, a thin band on the floor.',
    size: 'mult',
    base: 6.5,
    palette: 'boss',
    dur: 1.4,
    loop: false,
    demo: {},
    fire(fx, c) {
      const p = enragePal(c);
      const el = elOf(c);
      const hz = hazeTone(el, true);
      // the sim sends the stacked-rage alias at scale 4: one burst is never bigger than 1.5 x the authored size
      const s = Math.min(c.scale, 1.5);
      const R = 6.5 * s;
      const bR = 1.8 * s;
      const H = 3.3 * s;
      const { x, y, z } = c;
      const dust = dustHex(el);
      // the burst: a white-hot flare with rays over the chest and a ring of bristling rays racing out over the floor, both over in 0.3 s
      rayBurst(fx, x, y, z, R * 0.85, hz.glow, hz.body, { ring: BOSS_RING_ART.rayStreak, life: 0.3, h: 1.3 * s, fs: R * 0.8, fz: 1.9 * s + 0.4, a: 0.95, int: 1.6 });
      flash(fx, x, y + 1.3 * s, z, R * 0.3, R * 0.1, 0.12, p.core, 2.0);
      // the rage smoke is whirled out of the body: a ground spiral and puffs flung round it (orbit speed 4 m/s), a boiling ball at the chest
      swirl(fx, x, z, bR * 0.9, bR * 2.0, 0.9, hz.body, hz.glow, 0.5, 3.4);
      for (let i = 0, n = fx.n(14); i < n; i++) orbitSmoke(fx, x, y, z, 0, 0, bR * 1.1, H * 0.9, 4.2 * s, hz.body, hz.glow, 0.6, 1.3 * s, 2.8 * s, 0.9, 1.5);
      for (let i = 0, n = fx.n(5); i < n; i++) orbitStreamer(fx, x, y, z, 0, 0, bR * 1.05, H * 1.05, 3.4 * s, hz.body, hz.glow, 0.72, 0.8, 1.2);
      ball(fx, x, y + 1.1 * s, z, fx.n(8), R * 0.15, 3.0, 2.2, 0.8, 1.3, R * 0.2, R * 0.6, hz.body, hz.glow, 0.62, 0.6, 0, 0.04);
      dustFront(fx, x, y, z, fx.n(8), R * 0.75, 0.8, dust, 0.35, 1.2 * s);
      // a fire boss also throws four short tongues (its own element), nothing else does
      if (el === EL.fire) flames(fx, x, y, z, fx.n(4), bR * 1.1, 2.8 * s, 1.5 * s, 0.5, 0.8, 0xffd0a0, p.main, 0x5a0a06, 0.95, 1.5, 0.05);
      chips(fx, el === EL.ice || el === EL.dark || el === EL.poison ? el : EL.fire, x, y + 0.4, z, fx.n(8), R * 1.0, 0.5 * s, 1.3, y, 0.04);
      cinders(fx, x, y, z, fx.n(26), R * 0.65, 4.0, 1.0, 1.9, 0.19 * s, mixHex(hz.glow, 0xffffff, 0.4), hz.glow, 0.05, 2.0);
      sparks(fx, x, y + 0.5, z, fx.n(14), R * 0.9, R * 1.9, 2, 0.35, 0.7, 0.1 * s, p.core, hz.glow, 0, 0, 1, 2.4, -8);
      ringOn(fx, BOSS_RING_ART.ringShock, x, z, R * 0.2, R * 1.0, 0.5, hz.glow, 0.5, 1.3, 0.4, 0.02, 0.07, hz.body);
      scar(fx, x, z, R * 0.45, 1.2, el, hz.glow, 0.4, 0.4, 0.03, 1);
      fx.shake(0.4);
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------- death

function bossDeath(final: boolean): PresetDef {
  return {
    id: final ? 'boss.death.final' : 'boss.death',
    cat: 'boss',
    desc: final
      ? 'Final boss death (<= 1.9 s of action incl. a 0.4 s windup): embers and smoke are pulled into the body, then a round boiling smoke ball is thrown out of the hip and a second, taller one rises over it, a thin beam, element chips, souls and gold glints; the floor keeps almost nothing.'
      : 'Boss death (<= 1.5 s): a round boiling smoke ball (mid-tone element smoke, luminous core) thrown out of the hip with a tower of smoke rising over the body, element chips, a thin beam, rising embers and wisps; the floor keeps almost nothing.',
    size: 'mult',
    base: final ? 9 : 6,
    palette: 'boss',
    dur: final ? 2.4 : 1.8,
    loop: false,
    demo: {},
    fire(fx, c) {
      const rng = fx.rng;
      const p = bossPal(c);
      const el = elOf(c);
      const hz = hazeTone(el);
      const s = Math.min(c.scale, 1.6);
      const R = Math.min((final ? 9 : 6) * s, final ? 5.8 : 7);
      const { x, y, z } = c;
      const dust = dustHex(el);
      const f = final ? 1 : 0;
      const T = final ? 0.4 : 0;
      const Rs = Math.min(R, 5.4);
      const H = 3.3 * s;
      const cy = y + 1.1 * s;
      
      const crashN = el === EL.physical || el === EL.fire ? 2 + f : 0;
      if (final) {
        // the last breath: embers and smoke are pulled into the body while a core of light grows in it, then it lets go
        for (let i = 0, n = fx.n(26); i < n; i++) {
          const a = rng.f() * TAU;
          const r = R * rng.r(0.7, 1.2);
          const t0 = rng.r(0.22, T);
          fx.add.at(x + Math.sin(a) * r, y + rng.r(0.2, 2.2 * s), z + Math.cos(a) * r).vel(-Math.sin(a) * r / t0, rng.r(0, 1.2), -Math.cos(a) * r / t0).life(t0).size(0.13 * s, 0.05 * s)
            .stretch(0.07).col(p.core, 1, p.main, 0).int(2.2).spr(SPR.streak).mode(M.streak).fade(0, FO.cubic).emit();
        }
        for (let i = 0, n = fx.n(7); i < n; i++) {
          const a = rng.f() * TAU;
          const r = R * rng.r(0.6, 1.0);
          const t0 = rng.r(0.3, T);
          fx.alp.at(x + Math.sin(a) * r, y + 0.6 * s, z + Math.cos(a) * r).vel(-Math.sin(a) * r / t0, rng.r(0.4, 1.2), -Math.cos(a) * r / t0).life(t0).size(1.4 * s, 0.7 * s)
            .col(hz.body, 0.55, hz.body, 0).art(BOSS_ART.hazeRound).rot(rng.f() * TAU, rng.s2(1)).fade(0, FO.sq).emit();
        }
        swirl(fx, x, z, R * 0.9, R * 0.3, T, hz.body, hz.glow, 0.4, 3);
        fx.add.at(x, cy, z).size(0.4 * s, R * 0.55).life(T).col(hz.glow, 0.15, p.core, 0.85).int(1.4).art(BOSS_ART.hotcore).fade(0, FO.none).emit();
      }
      // the release: a small hot flash (never a white-out) and the boiling ball thrown out of the hip, round, in the element's mid-tone smoke
      flash(fx, x, cy, z, R * 0.36, R * 0.11, 0.12, p.core, 1.5, T);
      ball(fx, x, cy, z, fx.n(15 + 4 * f), Rs * 0.3, 3.6, 2.2, 0.9, 1.5, Rs * 0.3, Rs * 1.0, hz.body, hz.glow, 0.78, 0.5, crashN, T);
      // a tower of smoke rising over the body, 1.9 x its height
      plume(fx, x, y + 0.4, z, H * 1.9 * (1 + 0.15 * f), Rs * 0.55, fx.n(9), 1.35, hz.body, hz.glow, 0.68, 0.5, T + 0.08);
      if (final) {
        ball(fx, x, y + 2.2 * s, z, fx.n(9), Rs * 0.25, 2.6, 2.4, 1.0, 1.5, Rs * 0.35, Rs * 1.15, hz.body, hz.glow, 0.7, 0.6, 0, T + 0.25);
        plume(fx, x, y + 0.4, z, H * 2.7, Rs * 0.5, fx.n(8), 1.4, hz.body, hz.glow, 0.6, 0.45, T + 0.22);
      }
      dustFront(fx, x, y, z, fx.n(14), R * 1.0, 1.0, dust, 0.4, 1.4 * s, T);
      // chips: element chips and hot sparks
      chips(fx, el, x, cy, z, fx.n(12 + 6 * f), R * 0.95, 0.55 * s, 1.5, y, T);
      if (el !== EL.ice) sparks(fx, x, cy, z, fx.n(14), R * 1.0, R * 2.2, 1.6, 0.4, 0.9, 0.11 * s, p.core, p.extra, 0, 0, 1, 2.3, -9, T);
      else sparkle(fx, x, cy, z, fx.n(12), R * 0.7, 2.6 * s, 0.7, 1.3, 0.55 * s, 0xd8f8ff, hz.glow, T + 0.05, 2.0);
      // souls / embers released upward under a thin beam
      beam(fx, x, y, z, R * 0.3, H * 2.7, 0.8, p.core, 0.55, 1.2, T + 0.05);
      wisps(fx, x, y + 0.3, z, fx.n(4 + 2 * f), R * 0.4, 3.6 * s, 1.0, 1.5, 0.9 * s, p.core, p.extra, T + 0.1, 1.6);
      cinders(fx, x, y, z, fx.n(26 + 12 * f), R * 0.7, 4.2, 1.0, 1.7, 0.2 * s, p.core, p.main, T + 0.05, 2.0);
      if (final) motes(fx, x, y + 0.5, z, fx.n(18), R * 0.7, 3.2 * s, 0.7, 1.4, 0.34 * s, 0xffe9a0, p.extra, T + 0.2, 2.0);
      // the floor remembers almost nothing: a faint patch and a thin scar that is gone in a second
      underlay(fx, x, z, R * 0.9, 1.3 + 0.3 * f, under(el, hz.body), 0.2, T);
      scar(fx, x, z, R * 0.5, 1.3, el, p.main, 0.4, 0.3, T, 1);
      fx.shake(final ? 0.55 : 0.5);
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------- slam / nova

function bossSlam(): PresetDef {
  return {
    id: 'boss.slam',
    cat: 'boss',
    desc: 'Slam resolve (radius = the telegraph): a white-hot flare core and a ring of fine rays racing out over the floor (0.26 s), a CROWN of dust and smoke thrown up and out, element chips thrown wide, accents (ice crowns / flame jets), hot cracks that cool to a scar and a pit that puffs.',
    size: 'radius',
    base: 4,
    palette: 'boss',
    dur: 0.7,
    loop: false,
    demo: {},
    fire(fx, c) {
      const p = bossPal(c);
      const R = c.radius;
      const s = R / 4;
      const { x, y, z } = c;
      const el = elOf(c);
      const hz = hazeTone(el);
      const dust = dustHex(el);
      
      rayBurst(fx, x, y, z, R * 1.15, hz.glow, p.edge, { ring: BOSS_RING_ART.rayHazy, life: 0.28, h: 0.9 * s, fs: R * 1.25, fz: Math.min(3.6, Math.max(2.6, R * 0.55)), a: 1.0, int: 1.7 });
      flash(fx, x, y + 0.5 * s, z, R * 0.4, R * 0.12, 0.1, p.core, 2.0);
      // the crown: dust racing out low, smoke thrown up in a ring of billows
      dustFront(fx, x, y, z, fx.n(16), R * 1.15, 0.85, dust, 0.62, 1.9 * s);
      hazeWall(fx, x, y, z, R * 0.3, R * 1.0, 0.45, 2.0 + 0.2 * R, mixHex(dust, hz.body, 0.4), hz.glow, 0.68, 0.02, 0.35, 14, 0.9);
      ball(fx, x, y + 0.5 * s, z, fx.n(6), R * 0.22, 3.0, 2.4, 0.7, 1.1, R * 0.2, R * 0.6, mixHex(dust, hz.body, 0.5), hz.glow, 0.58, 0.5);
      chips(fx, el, x, y + 0.3, z, fx.n(11), R * 1.1, 0.5 * s, 1.3, y, 0.02);
      accent(fx, el, x, y, z, fx.n(5), R * 0.8, 2.2 * s, 0.6, 0.03);
      sparks(fx, x, y + 0.3, z, fx.n(12), R * 1.2, R * 2.4, 1.6, 0.3, 0.6, 0.09 * s, p.core, p.extra, 0, 0, 1, 2.2, -9);
      cinders(fx, x, y, z, fx.n(10), R * 0.7, 2.6, 0.7, 1.3, 0.15 * s, p.core, p.main, 0.04);
      // the floor: the shock band follows the rays, the cracks glow hot while they open (0.55 s) and cool to a scar, the pit puffs
      ringOn(fx, BOSS_RING_ART.ringGrain, x, z, R * 0.2, R * 1.0, 0.5, p.main, 0.6, 1.4, 0.5, 0.06, 0.09, p.edge);
      scar(fx, x, z, R * 1.0, 1.8, el, el === EL.ice ? hz.glow : p.main, 0.7, 0.7, 0, 4, 1.0);
      pit(fx, x, z, R * 0.5, el === EL.ice ? 2.0 : 3.0, el === EL.ice ? 0xa6b4d8 : pitColor(el), mixHex(dust, el === EL.ice ? 0xdfe6f6 : 0x5a4e46, 0.5), 0.02);
      fx.shake(0.3 * Math.min(1.5, Math.max(0.6, s)));
    },
  };
}

function bossNova(): PresetDef {
  return {
    id: 'boss.nova',
    cat: 'boss',
    desc: 'Nova (radius = the telegraph, duration = expand time): a flare core with spokes at the centre and a ring of soft rays racing out in 0.3 s, a smoke ball, then a translucent haze wall in the element hue sweeps out to the radius with light streaks running up its front, a low dust skirt and wind streaks below it; ice sprouts crystal crowns on the front.',
    size: 'radius',
    base: 8,
    palette: 'boss',
    dur: 0.8,
    loop: false,
    demo: {},
    fire(fx, c) {
      const rng = fx.rng;
      const p = bossPal(c);
      const el = elOf(c);
      const hz = hazeTone(el);
      const R = c.radius;
      const s = R / 8;
      const T = Math.max(0.35, c.duration);
      const { x, y, z } = c;
      const dust = dustHex(el);
      const wallH = Math.min(3.5, 2.2 + R * 0.11);
      
      rayBurst(fx, x, y, z, R * 0.95, hz.glow, p.edge, { ring: BOSS_RING_ART.rayHazy, flare: BOSS_ART.flareSpokes, life: 0.34, h: 1.3, fs: R * 0.7, fz: Math.min(3.6, Math.max(2.6, R * 0.55)), r0: 0.12, a: 0.95, int: 1.7 });
      flash(fx, x, y + 1.0, z, R * 0.24, R * 0.09, 0.12, p.core, 2.0);
      ball(fx, x, y + 0.8, z, fx.n(8), R * 0.1, 2.6, 2.4, 0.8, 1.2, R * 0.09, R * 0.36, hz.body, hz.glow, 0.66, 0.6);
      // the wall of haze and what runs below it
      hazeWall(fx, x, y, z, R * 0.22, R * 0.95, T * 1.1, wallH, hz.body, hz.glow, 0.72, 0.02, 0.58, 12, 0.85);
      dustFront(fx, x, y, z, fx.n(8), R * 0.95, T * 1.4, dust, 0.26, 1.6 * s + 0.4);
      windOut(fx, x, z, fx.n(8), R * 0.15, R * 0.95, T * 1.1, 2.4 * s + 0.6, p.extra, 0.4);
      // chips and crowns riding the front
      for (let i = 0, n = fx.n(14); i < n; i++) {
        const f = rng.f();
        const r = R * (0.1 + 0.9 * (1 - Math.pow(1 - f, 3)));
        const a = rng.f() * TAU;
        fx.add.at(x + Math.sin(a) * r, y + 0.3, z + Math.cos(a) * r).vel(Math.sin(a) * 2, rng.r(1, 3.2), Math.cos(a) * 2).life(rng.r(0.25, 0.5)).delay(T * f).size(0.1 * s + 0.05, 0.03)
          .stretch(0.05).col(p.core, 1, p.main, 0).int(2.0).spr(SPR.streak).mode(M.streak).drag(2).grav(-8).fade(0, FO.cubic).emit();
      }
      if (el === EL.ice) accent(fx, el, x, y, z, fx.n(10), R * 0.8, 2.6 * s + 0.6, 0.6, T * 0.55);
      chips(fx, el, x, y + 0.6, z, fx.n(7), R * 0.5, 0.5 * s + 0.1, 1.2, y, T * 0.3);
      cinders(fx, x, y, z, fx.n(12), R * 0.7, 2.4, 0.8, 1.5, 0.17, p.core, p.main, 0.05);
      // the floor: no extra band (r3: the ray ring is the front; the r2 grain band tinted the whole disc under the wall)
      fx.shake(0.4);
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------- volley / teleport / summon

function bossVolley(): PresetDef {
  return {
    id: 'boss.volley',
    cat: 'boss',
    desc: 'Volley muzzle: a flare core with a short ray ring ahead of the body (0.22 s), a luminous glow ball, a billow of smoke thrown forward, a needle fan and a spark spray, embers.',
    size: 'mult',
    base: 1.6,
    palette: 'boss',
    dur: 0.5,
    loop: false,
    demo: { dir: 0 },
    fire(fx, c) {
      const p = bossPal(c);
      const hz = hazeTone(elOf(c));
      const s = c.scale;
      const R = c.radius;
      const hasDir = c.hasDir;
      const fdx = hasDir ? c.dx : 0;
      const fdz = hasDir ? c.dz : 0;
      // the muzzle sits well ahead of the body centre (a flash inside the model is hidden by it)
      const x = c.x + fdx * 2.6 * s;
      const z = c.z + fdz * 2.6 * s;
      const y = c.y + 1.4 * s;
      // r3: a flare core and a short ray ring (the critic: "no flash core, no radial burst")
      rayBurst(fx, x, c.y, z, R * 2.3, p.main, p.edge, { ring: BOSS_RING_ART.rayStreak, life: 0.22, h: 1.4 * s, fs: R * 2.6, r0: 0.2, a: 0.85, int: 1.4 });
      flash(fx, x, y, z, R * 1.5, R * 0.45, 0.14, p.core, 1.8);
      glow(fx, x, y, z, R * 3.0, R * 1.1, 0.3, p.main, 0.8, 1.3);
      // smoke thrown forward in a fan of billows
      ball(fx, x + fdx * R * 0.5, y - 0.3 * s, z + fdz * R * 0.5, fx.n(7), R * 0.3, 3.6 * s, 0.5, 0.5, 1.0, 0.9 * s, 2.6 * s, hz.body, hz.glow, 0.65, 0.5);
      // flame needles fanning along the shot
      for (let i = 0, n = fx.n(6); i < n; i++) {
        const a = hasDir ? Math.atan2(fdx, fdz) + fx.rng.s2(0.45) : fx.rng.f() * TAU;
        const v = fx.rng.r(6, 11) * s;
        fx.add.at(x + Math.sin(a) * R * 0.2, y, z + Math.cos(a) * R * 0.2).vel(Math.sin(a) * v, 0.2, Math.cos(a) * v).life(0.26).size(0.75 * s, 0.45 * s).stretch(0.07)
          .col(p.core, 0.95, p.main, 0).int(1.8).art(BOSS_ART.needle).mode(M.streak).drag(2.5).fade(0, FO.quad).emit();
      }
      sparks(fx, x, y, z, fx.n(16), 5 * s, 11 * s, 0.6, 0.2, 0.5, 0.11 * s, p.core, p.main, fdx, fdz, hasDir ? 0.8 : 1, 2.4, -6, 0.02);
      cinders(fx, x, y, z, fx.n(8), R * 0.5, 1.8, 0.4, 0.9, 0.14 * s, p.core, p.main, 0.02);
      fx.shake(0.08);
    },
  };
}

function teleport(inward: boolean): PresetDef {
  return {
    id: inward ? 'boss.teleport.in' : 'boss.teleport.out',
    cat: 'boss',
    desc: inward
      ? 'Boss appears (radius = the landing telegraph): a reveal flare with a ray ring, twisting smoke columns bursting up on a ring round the landing and two beams beside it, a dark smoke spiral unwinding on the floor, soft motes and embers.'
      : 'Boss vanishes: a dark smoke spiral collapses onto the boss, smoke is pulled in and drawn up in twisting columns through and beside the body, then a closing flare with a ray ring, embers.',
    size: 'radius',
    base: 3.5,
    palette: 'dark',
    dur: 0.9,
    loop: false,
    demo: {},
    fire(fx, c) {
      const rng = fx.rng;
      const p = bossPal(c, EL.dark);
      const el = c.element > 0 && c.element < 8 ? c.element : EL.dark;
      const hz = hazeTone(el);
      /** the landing telegraph is 3-3.5 m, smaller than the body: the volumes stand on a ring of at least 4 m so they are not hidden by the model */
      const R = Math.max(c.radius, 4.0);
      const s = R / 3.5;
      const H = 3.3 * Math.min(s, 1.5);
      const { x, y, z } = c;
      const cy = y + 1.1 * s;
      // a darker, richer body than the element's mid-tone: the r2 lavender / pale-blue blobs read as airbrush on the floor
      const body = mixHex(hz.body, 0x10081e, 0.22);
      if (inward) {
        rayBurst(fx, x, y, z, R * 1.0, hz.glow, p.edge, { ring: BOSS_RING_ART.rayHazy, flare: BOSS_ART.flareSpokes, life: 0.26, h: 1.4 * s, fs: R * 0.9, fz: 2.4, a: 0.85, int: 1.4, delay: 0.03 });
        const nP = 5;
        const a0 = rng.f() * TAU;
        for (let k = 0; k < nP; k++) {
          const ang = a0 + (k / nP) * TAU + rng.s2(0.3);
          const rr = R * 0.9 * rng.r(0.9, 1.1);
          plume(fx, x + Math.sin(ang) * rr, y, z + Math.cos(ang) * rr, H * rng.r(1.4, 1.8), R * 0.36, fx.n(7), 0.95, body, hz.glow, 0.74, 0.5, 0.02 + k * 0.03, Math.sin(ang) * 0.5, Math.cos(ang) * 0.5, TEX_BODY);
        }
        for (const sgn of [-1, 1]) beam(fx, x + sgn * R * 0.55, y, z - R * 0.1, R * 0.4, H * 2.3, 0.55, p.main, 0.75, 1.3, 0.02);
        // three twisting columns standing round the landing (the generated teleport column: a bright narrow core, smoke wound round it)
        streamers(fx, x, y, z, 4, H * 1.6, 0.8, body, hz.glow, 0.75, 0.6, 0.05, R * 0.5, BOSS_ART.tpColumn);
        swirl(fx, x, z, R * 0.4, R * 1.3, 0.85, body, hz.glow, 0.45, -2.2);
        ringOn(fx, BOSS_RING_ART.ringShock, x, z, R * 0.2, R * 1.1, 0.45, hot(p), 0.4, 1.3, 0.4, 0, 0.07, p.edge);
        dustFront(fx, x, y, z, fx.n(8), R * 0.85, 0.7, mixHex(body, 0x9a8a7c, 0.4), 0.42, 1.0 * s);
        if (el === EL.ice) sparkle(fx, x, y + 0.4, z, fx.n(8), R * 0.6, 2.8 * s, 0.4, 0.8, 0.5 * s, 0xd8f8ff, hz.glow, 0.05, 1.8);
        else motes(fx, x, y + 0.4, z, fx.n(10), R * 0.6, 2.8 * s, 0.5, 0.9, 0.3 * s, p.core, p.extra, 0.05, 1.8);
        cinders(fx, x, y, z, fx.n(8), R * 0.5, 2.0, 0.6, 1.1, 0.14 * s, p.core, p.main, 0.04);
      } else {
        const T = 0.36;
        swirl(fx, x, z, R * 1.5, R * 0.25, T + 0.25, body, hz.glow, 0.55, 3.2);
        // dark smoke is pulled in toward the body and up
        for (let i = 0, n = fx.n(14); i < n; i++) {
          const a = rng.f() * TAU;
          const r = R * rng.r(0.9, 1.6);
          const t0 = rng.r(0.26, 0.36);
          fx.alp.at(x + Math.sin(a) * r, y + 0.5 * s, z + Math.cos(a) * r).vel(-Math.sin(a) * r / t0, rng.r(1.0, 2.4), -Math.cos(a) * r / t0).life(t0).size(1.8 * s, 0.8 * s)
            .col(body, 0.75, body, 0).art(i % 2 === 0 ? BOSS_ART.hazeRound : BOSS_ART.fogBall).rot(rng.f() * TAU, rng.s2(1)).fade(0, FO.sq).emit();
        }
        // the columns the body leaves up through: one on it, two beside it
        plume(fx, x, y, z + R * 0.5, H * 1.7, R * 0.4, fx.n(7), 1.0, body, hz.glow, 0.78, 0.5, T - 0.12, 0, 0, TEX_BODY);
        for (const sgn of [-1, 1]) plume(fx, x + sgn * R * 0.85, y, z + R * 0.1, H * 1.4, R * 0.34, fx.n(6), 0.95, body, hz.glow, 0.72, 0.5, T - 0.08, 0, 0, TEX_BODY);
        // the pulled-up columns (generated teleport column) standing through and beside the body
        streamers(fx, x, y, z, 4, H * 1.5, 0.7, body, hz.glow, 0.75, 0.6, T - 0.1, R * 0.35, BOSS_ART.tpColumn);
        sparks(fx, x, cy, z, fx.n(10), R * 1.0, R * 1.6, 0.4, 0.2, 0.32, 0.09 * s, p.core, p.main, 0, 0, 1, 2.2, 0);
        // the closing flare: rays race out where the body was
        rayBurst(fx, x, y, z, R * 1.0, hz.glow, p.edge, { ring: BOSS_RING_ART.rayHazy, flare: BOSS_ART.flareSpokes, life: 0.24, h: 1.3 * s, fs: R * 0.85, fz: 2.4, a: 0.85, int: 1.4, delay: T });
        flash(fx, x, cy, z, R * 0.36, R * 0.11, 0.14, hz.glow, 1.7, T);
        cinders(fx, x, y, z, fx.n(8), R * 0.5, 2.0, 0.6, 1.1, 0.14 * s, p.core, p.main, T);
      }
    },
  };
}

function bossSummon(): PresetDef {
  return {
    id: 'boss.summon',
    cat: 'boss',
    desc: 'Boss summon (radius 5): a flare core with a ray ring where the call goes out, a dark smoke spiral turns on the floor under two counter-turning broken arcs, twisting smoke columns and tall plumes rise where the summoned come in, thin beams between them, soft motes, wisps and embers; element hued (dark violet by default). No emblem sprites, no + / x glints.',
    size: 'radius',
    base: 3,
    palette: 'dark',
    dur: 1.8,
    loop: false,
    demo: {},
    fire(fx, c) {
      const rng = fx.rng;
      const p = bossPal(c, EL.dark);
      const el = c.element > 0 && c.element < 8 ? c.element : EL.dark;
      const hz = hazeTone(el);
      const R = c.radius;
      const s = R / 3;
      const H = 3.3 * Math.min(s, 1.5);
      const { x, y, z } = c;
      // a darker, richer body than the element's mid-tone (the r2 violet read as flat lavender airbrush)
      const body = mixHex(hz.body, 0x10081e, 0.25);
      groundGlow(fx, x, z, R * 0.6, 1.2, p.main, 0.16, 1.0, 0.04);
      swirl(fx, x, z, R * 0.95, R * 0.45, 1.4, body, hz.glow, 0.34, 2.0);
      // two counter-turning broken glowing arcs (the click_select ring), one thin band
      ringArc(fx, x, z, R * 0.5, R * 0.95, 1.4, hot(p), 0.3, 1.2, 1.3, 0.1);
      ringArc(fx, x, z, R * 0.36, R * 0.72, 1.2, p.main, 0.26, 1.1, -1.6, 0.18);
      // plumes where the summoned come in, narrow beams between them
      const nP = 5;
      const a0 = rng.f() * TAU;
      for (let k = 0; k < nP; k++) {
        const ang = a0 + (k / nP) * TAU + rng.s2(0.2);
        const rr = R * 0.78 * rng.r(0.9, 1.1);
        const px = x + Math.sin(ang) * rr;
        const pz = z + Math.cos(ang) * rr;
        plume(fx, px, y, pz, H * rng.r(1.2, 1.6), R * 0.26, fx.n(7), 1.05, body, hz.glow, 0.74, 0.4, 0.12 + k * 0.05, 0, 0, TEX_BODY);
        if (k % 2 === 0) beam(fx, px, y, pz, R * 0.18, H * 1.9, 0.8, p.main, 0.7, 1.4, 0.18 + k * 0.05);
      }
      // twisting columns (the generated teleport column) between the plumes: a bright narrow core with smoke wound round it
      streamers(fx, x, y, z, 4, H * 1.5, 0.9, body, hz.glow, 0.62, 0.55, 0.15, R * 0.5, BOSS_ART.tpColumn);
      // the call: a flare with a ray ring over the middle
      rayBurst(fx, x, y, z, R * 1.0, hz.glow, p.edge, { ring: BOSS_RING_ART.rayHazy, flare: BOSS_ART.flareSpokes, life: 0.28, h: 0.9 * s, fs: R * 0.7, fz: 1.2, a: 0.8, int: 1.3, delay: 0.1 });
      flash(fx, x, y + 0.5 * s, z, R * 0.3, R * 0.1, 0.14, hz.glow, 1.7, 0.1);
      if (el === EL.ice) sparkle(fx, x, y, z, fx.n(8), R * 0.8, 2.4 * s, 0.8, 1.4, 0.5 * s, 0xd8f8ff, hz.glow, 0.1, 1.8);
      else motes(fx, x, y, z, fx.n(12), R * 0.8, 2.4 * s, 0.8, 1.4, 0.3 * s, p.core, p.extra, 0.1, 1.8);
      wisps(fx, x, y, z, fx.n(6), R * 0.8, 1.9, 0.9, 1.5, 0.9 * s, p.main, p.edge, 0.05, 1.6);
      cinders(fx, x, y, z, fx.n(8), R * 0.8, 2.4, 1, 1.8, 0.16 * s, p.extra, p.main, 0.1);
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------- charge

/** loop start: nothing (the trail is all emission); the route spawns short loops along the charge, `c.a` = the boss speed m/s along (dx, dz) */
function chargeFire(fx: Fx, c: Ctx): void {
  const el = elOf(c);
  const s = Math.min(c.scale, 1.6);
  underlay(fx, c.x, c.z, 1.6 * s, 0.7, under(el, hazeTone(el).body), 0.2);
}

function chargeTick(fx: Fx, c: Inst, dt: number): void {
  const rng = fx.rng;
  const p = bossPal(c);
  const el = elOf(c);
  const hz = hazeTone(el);
  const s = Math.min(c.scale, 1.6);
  const k = fx.density;
  const dust = dustHex(el);
  // the low tier has no soft particles (no depth fade where a puff meets the floor): the same overlapping dust puffs pile up to a white-hot glare
  // (low r2/low charge t1.20: 1.16 % white), so its alpha is scaled down
  const lowA = fx.profile.soft ? 1 : 0.5;
  // where the body is NOW: the route hands the speed (c.a) and the heading; a hand-spawned loop follows move() instead
  const mx = c.x - c.px;
  const mz = c.z - c.pz;
  const ml = Math.hypot(mx, mz);
  const moving = c.a > 0.5;
  const dx = moving ? c.dx : ml > 1e-4 ? mx / ml : c.dx;
  const dz = moving ? c.dz : ml > 1e-4 ? mz / ml : c.dz;
  const x = moving ? c.x + c.dx * c.a * c.age : c.x;
  const z = moving ? c.z + c.dz * c.a * c.age : c.z;
  const y = fx.heightAt(x, z);
  // kicked-up dust billowing behind the feet
  c.acc0 += dt * 46 * k;
  while (c.acc0 >= 1) {
    c.acc0 -= 1;
    const back = rng.r(0, 1.4) * s;
    fx.alp.at(x - dx * back + rng.s2(0.6 * s), y + 0.5 * s, z - dz * back + rng.s2(0.6 * s)).vel(-dx * rng.r(1, 3) + rng.s2(1.2), rng.r(0.5, 1.5), -dz * rng.r(1, 3) + rng.s2(1.2)).life(rng.r(0.6, 1.0))
      .size(1.0 * s, 3.2 * s).col(dust, 0.7 * lowA, dust, 0.35 * lowA).art(rng.f() < 0.5 ? BOSS_ART.puffHaze : BOSS_ART.smudge).rot(rng.f() * TAU, rng.s2(0.8)).drag(1.8).fade(1, FO.quad, SC.out).emit();
  }
  // a mid-tone smoke body behind it rising off the dust, a hued glow where the feet scrape
  c.acc1 += dt * 9 * k;
  while (c.acc1 >= 1) {
    c.acc1 -= 1;
    smokeVol(fx, x - dx * 0.8 * s, y + 0.2, z - dz * 0.8 * s, 1, 0.5 * s, 1.6, 0.8, 1.3, 0.9 * s, 2.6 * s, mixHex(hz.body, dust, 0.35), 0.5 * lowA);
  }
  c.acc2 += dt * 14 * k;
  while (c.acc2 >= 1) {
    c.acc2 -= 1;
    const back = rng.r(0, 1.0) * s;
    fx.add.at(x - dx * back, y + 0.18, z - dz * back).size(1.8 * s, 0.6 * s).life(0.4).col(p.main, 0.5, p.edge, 0).int(1.3).spr(SPR.glow).mode(M.ground).fade(0, FO.quad).emit();
    sparks(fx, x - dx * 0.5 * s, y + 0.1, z - dz * 0.5 * s, 1, 2, 6, 1.4, 0.2, 0.4, 0.07 * s, p.core, p.extra, -dx, -dz, 1.3, 2.2, -9);
  }
  // chips kicked up by the hooves (the element's own chips, small)
  c.acc3 += dt * 5 * k;
  while (c.acc3 >= 1) {
    c.acc3 -= 1;
    chips(fx, el, x - dx * rng.r(0, 1.2) * s, y + 0.15, z - dz * rng.r(0, 1.2) * s, 1, 2.6, 0.26 * s, 0.7, y);
  }
}

function chargeTrail(): PresetDef {
  return {
    id: 'boss.charge.trail',
    cat: 'boss',
    desc: 'Charge trail (tracked on the boss: route.ts spawns short loops along the run): dust billowing behind the feet, a mid-tone smoke body rising off it, hued scrape glow and sparks, faint hoof scuffs.',
    size: 'mult',
    base: 1.6,
    palette: 'boss',
    dur: 900,
    loop: true,
    demo: { loopFor: 3 },
    fire: chargeFire,
    tick: chargeTick,
  };
}

export const presets: PresetDef[] = [
  bossSpawn(false),
  bossSpawn(true),
  bossPhase(),
  bossEnrage(),
  bossEnrageBurst(),
  bossDeath(false),
  bossDeath(true),
  bossSlam(),
  bossNova(),
  bossVolley(),
  teleport(false),
  teleport(true),
  bossSummon(),
  chargeTrail(),
];
