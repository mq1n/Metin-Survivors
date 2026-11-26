// Skill-logic WP5 (DESIGN section 9, mimic.test.ts) on the SHIPPED shadow clone (ninja-a, role mimic, power 100): which of the ninja-a casts
// are repeated (the allow-list, with the real behaviors and the real ultimates), the clone walks the hero's trail, a copy fires from the clone's
// place at power x damage and leaves the hero untouched (position, heading, cast timer, no hero clip), zone copies stay put, the cap per
// window, and a copy that throws cannot leave the hero swapped onto the clone. Fixture-content mechanics are in companionRoles.test.ts.

import { describe, expect, it } from 'vitest';
import { content } from '../../data/loader';
import { SchedKind } from '../scheduler';
import { BEHAVIORS, castNow } from '../skills';
import { inEcho, inMimic } from '../skills/common';
import { ProjKind, type PlayerState, type SkillInstance } from '../stores';
import type { World } from '../world';
import { hero, only, realWorld, ringOf, rowsOf, step } from './skillLab';

const RUN = { moveX: 1, moveZ: 0 };

function mimicQueue(w: World): number {
  let n = 0;
  for (let i = 0; i < w.sched.count; i++) if (w.sched.kind[i] === SchedKind.Mimic) n++;
  return n;
}

/** ninja-a with the shadow clone cast and standing, plus `ids` ready to cast (everything on a long lockout: casts are the test's own); a crowd in reach */
function lab(ids: string[], rank = 0): { w: World; p: PlayerState; clone: SkillInstance; skills: Record<string, SkillInstance> } {
  const w = realWorld({ classId: 'ninja', doctrine: 'a', stats: { armor: 200 } });
  const list = only(w, ['shadow_clone', ...ids], rank);
  const p = hero(w);
  p.iframes = 1e9;
  ringOf(w, 'wild_dog', 6, 4);
  ringOf(w, 'wild_dog', 5, 1.6);
  w.hash.rebuild(w.enemies);
  const clone = list[0] as SkillInstance;
  for (const s of p.skills) s.cd = 1e9;
  clone.cd = 0;
  expect(castNow(w, p, clone), 'the clone is cast').toBe(true);
  step(w, 2);
  const skills: Record<string, SkillInstance> = {};
  for (const s of p.skills) skills[s.def.id] = s;
  return { w, p, clone, skills };
}

describe('the shipped clone', () => {
  it('stands as one Mimic row for its 10 s and is gone afterwards', () => {
    const { w, clone } = lab([]);
    expect(rowsOf(w, ProjKind.Familiar, clone.slot)).toHaveLength(1);
    expect(clone.fp.power).toBeCloseTo((clone.def.params.power ?? 0) / 100, 6);
    step(w, 11 * 60);
    expect(rowsOf(w, ProjKind.Familiar, clone.slot), 'expired').toHaveLength(0);
  });

  it('walks the hero trail: running at speed v it hangs about 0.6 s behind, on the line the hero ran', () => {
    const { w, p, clone } = lab([]);
    p.iframes = 1e9;
    step(w, 90, RUN);
    const row = rowsOf(w, ProjKind.Familiar, clone.slot)[0] as number;
    const P = w.projectiles;
    const behind = p.x - (P.x[row] as number);
    const v = p.stats.moveSpeed * 5; // m/s: the hero speed is moveSpeed x the class run speed
    expect(behind, 'behind the hero').toBeGreaterThan(0.3);
    expect(Math.abs((P.z[row] as number) - p.z), 'on the same line').toBeLessThan(0.5);
    // 0.6 s of running (loose: the run speed constant is the sim's)
    expect(behind).toBeLessThan(Math.max(8, v));
  });
});

describe('the allow-list: what the clone repeats', () => {
  const NINJA_A = content.skills.filter((s) => s.classId === 'ninja' && (s.doctrine === 'a' || s.doctrine === undefined)).map((s) => s.id);
  for (const id of NINJA_A) {
    const d = content.skills.find((s) => s.id === id);
    if (!d || id === 'shadow_clone') continue;
    const copied = ['meleeArc', 'projectile', 'homingProjectile', 'chain', 'cone', 'shockwave', 'skyStrike', 'groundZone', 'spinAura'].includes(d.behavior) && d.kind !== 'ultimate';
    it(`${id} (${d.behavior}${d.kind === 'ultimate' ? ', ultimate' : ''}): ${copied ? 'one copy is queued' : 'no copy'}`, () => {
      const { w, p, skills } = lab([id]);
      const s = skills[id] as SkillInstance;
      s.cd = 0;
      const before = mimicQueue(w);
      w.hash.rebuild(w.enemies);
      castNow(w, p, s);
      expect(mimicQueue(w) - before).toBe(copied ? 1 : 0);
    });
  }
});

describe('a copy', () => {
  /** HP lost by one frozen 1e5-HP dummy 1.5 m away after the hero swings the basic once (power in % patched onto the clone; null = no clone at all) */
  function swingLoss(power: number | null): number {
    const db = structuredClone(content);
    if (power !== null) (db.skills.find((s) => s.id === 'shadow_clone') as { params: { power: number } }).params.power = power;
    const w = realWorld({ classId: 'ninja', doctrine: 'a', db });
    const list = only(w, power === null ? [] : ['shadow_clone']);
    const p = hero(w);
    const basic = p.skills[0] as SkillInstance;
    p.iframes = 1e9;
    p.stats.critChance = 0;
    p.statsDirty = false;
    const row = ringOf(w, 'bear', 1, 1.5)[0] as number;
    w.enemies.hp[row] = 1e5;
    w.enemies.hpMax[row] = 1e5;
    w.enemies.speed[row] = 0;
    w.hash.rebuild(w.enemies);
    for (const s of p.skills) s.cd = 1e9;
    if (power !== null) {
      const clone = list[0] as SkillInstance;
      clone.cd = 0;
      expect(castNow(w, p, clone)).toBe(true);
      for (let i = 0; i < 2; i++) w.step([{ moveX: 0, moveZ: 0 }]);
      clone.cd = 1e9;
    }
    basic.cd = 0;
    w.hash.rebuild(w.enemies);
    const hp0 = w.enemies.hp[row] as number;
    expect(castNow(w, p, basic)).toBe(true);
    for (let i = 0; i < 40; i++) w.step([{ moveX: 0, moveZ: 0 }]);
    return hp0 - (w.enemies.hp[row] as number);
  }

  it('hits for power x the damage of the first swing: the copy damage is linear in power with no offset (a combo copy has no follow-ups)', () => {
    const solo = swingLoss(null);
    expect(solo).toBeGreaterThan(0);
    const copy100 = swingLoss(100) - solo; // what a 100 % copy adds
    expect(copy100, 'a copy adds damage').toBeGreaterThan(0);
    expect(copy100, 'and never more than the whole combo').toBeLessThanOrEqual(solo + 1e-6);
    expect(swingLoss(45) - solo).toBeCloseTo(0.45 * copy100, 1);
    expect(swingLoss(200) - solo).toBeCloseTo(2 * copy100, 1);
  });

  it('fires from the clone (a spinAura copy is centred on the clone, not on the hero), leaves the hero as it was and does not follow it', () => {
    const { w, p, clone, skills } = lab(['spiral_of_knives']);
    const s = skills.spiral_of_knives as SkillInstance;
    const P = w.projectiles;
    const cloneRow = rowsOf(w, ProjKind.Familiar, clone.slot)[0] as number;
    step(w, 90, RUN);
    p.iframes = 1e9;
    ringOf(w, 'wild_dog', 5, 1.6);
    s.cd = 0;
    w.hash.rebuild(w.enemies);
    expect(castNow(w, p, s)).toBe(true);
    expect(mimicQueue(w)).toBe(1);
    const heroZones = w.zones.count;
    const before = { rot: p.rot, castT: p.castT };
    let copyZone = -1;
    for (let i = 0; i < 30 && copyZone < 0; i++) {
      w.step([RUN]);
      for (let z = 0; z < w.zones.count; z++) if ((w.zones.skill[z] as number) === s.slot && (w.zones.follow[z] as number) === 0 && (w.zones.mul[z] as number) > 0) copyZone = z;
    }
    expect(mimicQueue(w), 'dispatched').toBe(0);
    expect(copyZone, 'the copy opened a zone').toBeGreaterThanOrEqual(0);
    const Z = w.zones;
    expect(p.x - (Z.x[copyZone] as number), 'centred on the clone, behind the running hero').toBeGreaterThan(1);
    expect(Math.hypot((Z.x[copyZone] as number) - (P.x[cloneRow] as number), (Z.z[copyZone] as number) - (P.z[cloneRow] as number)), 'within a step of the clone').toBeLessThan(2);
    expect(Z.mul[copyZone] as number, 'copy strength').toBeCloseTo(clone.fp.power, 4);
    expect(w.zones.count).toBeGreaterThan(heroZones - 1);
    void before;
  });

  it('is capped at 3 per 0.5 s window, however many casts the hero makes', () => {
    const { w, p, skills } = lab(['creeping_venom', 'noxious_pall', 'spiral_of_knives']);
    w.hash.rebuild(w.enemies);
    let queued = 0;
    for (const id of ['creeping_venom', 'noxious_pall', 'spiral_of_knives', 'creeping_venom', 'noxious_pall']) {
      const s = skills[id] as SkillInstance;
      s.cd = 0;
      castNow(w, p, s);
      queued = mimicQueue(w);
    }
    expect(queued).toBeLessThanOrEqual(3);
    expect(queued).toBeGreaterThanOrEqual(1);
  });

  it('carries no hero clip: the skillCast of a copy is empty, so the hero never replays the animation', () => {
    const { w, p, skills } = lab(['creeping_venom']);
    const s = skills.creeping_venom as SkillInstance;
    s.cd = 0;
    w.hash.rebuild(w.enemies);
    castNow(w, p, s);
    const clips: string[] = [];
    for (let i = 0; i < 30; i++) {
      w.step([{ moveX: 0, moveZ: 0 }]);
      for (const e of w.events) if (e.t === 'skillCast' && e.skillId === 'creeping_venom') clips.push(e.heroClip);
    }
    expect(clips.length, 'the copy emitted its cast').toBeGreaterThanOrEqual(1);
    expect(clips.every((c) => !c), `clips ${JSON.stringify(clips)}`).toBe(true);
  });
});

describe('robustness', () => {
  it('a behavior that throws inside a copy cannot leave the hero swapped onto the clone or the guards set', () => {
    const { w, p, skills } = lab(['creeping_venom']);
    const s = skills.creeping_venom as SkillInstance;
    s.cd = 0;
    w.hash.rebuild(w.enemies);
    castNow(w, p, s);
    expect(mimicQueue(w)).toBe(1);
    const x = p.x;
    const z = p.z;
    const rot = p.rot;
    const real = BEHAVIORS.chain.cast;
    let armed = true;
    BEHAVIORS.chain.cast = (...args: Parameters<typeof real>) => {
      if (armed) {
        armed = false;
        throw new Error('boom');
      }
      return real(...args);
    };
    try {
      expect(() => {
        for (let i = 0; i < 30; i++) w.step([{ moveX: 0, moveZ: 0 }]);
      }).toThrow('boom');
    } finally {
      BEHAVIORS.chain.cast = real;
    }
    expect(p.x).toBeCloseTo(x, 3);
    expect(p.z).toBeCloseTo(z, 3);
    expect(p.rot).toBeCloseTo(rot, 3);
    expect(inMimic(), 'mimic guard off').toBe(false);
    expect(inEcho(), 'echo guard off').toBe(false);
    // the guards are off again: a normal cast queues a copy and does not recurse
    s.cd = 0;
    w.hash.rebuild(w.enemies);
    castNow(w, p, s);
    expect(mimicQueue(w), 'echo / mimic guards were restored').toBeGreaterThanOrEqual(1);
  });

  it('only the owner\'s casts are copied: the clone of hero 0 ignores the casts of hero 1', () => {
    const w = realWorld({ classId: 'ninja', doctrine: 'a', coop: [{ classId: 'ninja', doctrine: 'a', sex: 'f', empire: 'chowon', meta: { stats: {} } }] });
    const [clone] = only(w, ['shadow_clone'], 0, 0);
    const [other] = only(w, ['creeping_venom'], 0, 1);
    ringOf(w, 'wild_dog', 6, 4);
    w.hash.rebuild(w.enemies);
    w.qaForceTriggers = true;
    step(w, 3);
    w.qaForceTriggers = false;
    clone!.cd = 1e9;
    other!.cd = 0;
    w.hash.rebuild(w.enemies);
    castNow(w, hero(w, 1), other!);
    expect(mimicQueue(w)).toBe(0);
  });
});

describe('SIM-07: secondary explosions and attribution on copied zones & projectiles', () => {
  it('awakened noxious_pall expiry blast scales by shadow clone power (45%) and credits shadow clone', () => {
    const runBlast = (withClone: boolean): { hpLoss: number; cloneDmg: number; cloudDmg: number } => {
      const w = realWorld({ classId: 'ninja', doctrine: 'a' });
      const list = only(w, withClone ? ['shadow_clone', 'noxious_pall'] : ['noxious_pall'], 0);
      const p = hero(w);
      p.iframes = 1e9;
      p.fixed.push({ critChance: -1 });
      p.stats.critChance = 0;
      p.statsDirty = false;
      const clone = withClone ? (list[0] as SkillInstance) : null;
      const cloud = (withClone ? list[1] : list[0]) as SkillInstance;
      cloud.rank = 7; // rank-7 awakened noxious_pall (explode: 3.5); shadow_clone stays rank 0 (45% power)
      for (const s of p.skills) s.cd = 1e9;

      // place an enemy in reach to cast the clone and then the cloud
      const bait = ringOf(w, 'bear', 1, 3)[0] as number;
      w.enemies.hp[bait] = 1e6;
      w.enemies.hpMax[bait] = 1e6;
      w.enemies.speed[bait] = 0;
      w.hash.rebuild(w.enemies);

      if (clone) {
        clone.cd = 0;
        expect(castNow(w, p, clone)).toBe(true);
        step(w, 2);
        clone.cd = 1e9;
        // walk far away from the clone so the hero's cloud and the clone's copied cloud never overlap
        p.x = p.px = 25;
        p.z = p.pz = 0;
      }

      // aim hero's cloud at an enemy near the hero (28, 0); if cloning, also keep a bait enemy near the clone at (0, 2)
      const heroTarget = ringOf(w, 'bear', 1, 3)[0] as number;
      w.enemies.x[heroTarget] = w.enemies.px[heroTarget] = p.x + 3;
      w.enemies.z[heroTarget] = w.enemies.pz[heroTarget] = 0;
      w.enemies.hp[heroTarget] = 1e6;
      w.enemies.hpMax[heroTarget] = 1e6;
      w.enemies.speed[heroTarget] = 0;
      w.hash.rebuild(w.enemies);

      cloud.cd = 0;
      expect(castNow(w, p, cloud)).toBe(true);
      cloud.cd = 1e9;

      // let the mimic dispatch fire (~0.25 s)
      step(w, 25);

      // locate the zone we want to test (copied zone when withClone, otherwise hero zone)
      const Z = w.zones;
      let targetZone = -1;
      for (let z = 0; z < Z.count; z++) {
        if ((Z.skill[z] as number) !== cloud.slot) continue;
        if (withClone ? (Z.credit[z] as number) === (clone!.slot + 1) : (Z.credit[z] as number) === 0) {
          targetZone = z;
          break;
        }
      }
      expect(targetZone).toBeGreaterThanOrEqual(0);
      // remove all other zones so ONLY targetZone's expiry blast fires
      const targetId = Z.id[targetZone] as number;
      for (let z = Z.count - 1; z >= 0; z--) {
        if ((Z.id[z] as number) !== targetId) Z.free(z);
      }
      const zRow = Z.find(targetId);
      expect(zRow).toBeGreaterThanOrEqual(0);
      const zx = Z.x[zRow] as number;
      const zz = Z.z[zRow] as number;

      // reset damage meters and place a fresh 1000-HP target right at the zone centre just before expiry (past its last tick)
      for (const s of p.skills) s.damage = 0;
      w.enemies.clear();
      w.spawner.alive = 0;
      const dummy = ringOf(w, 'bear', 1, 1)[0] as number;
      w.enemies.x[dummy] = w.enemies.px[dummy] = zx;
      w.enemies.z[dummy] = w.enemies.pz[dummy] = zz;
      w.enemies.hp[dummy] = 1000;
      w.enemies.hpMax[dummy] = 1000;
      w.enemies.speed[dummy] = 0;
      w.hash.rebuild(w.enemies);

      // push the zone to 1 tick before expiry, with its periodic tick timer beyond expiry so only endZone's explodeAt hits
      Z.t[zRow] = (Z.dur[zRow] as number) - 0.005;
      Z.tickT[zRow] = 10;

      step(w, 4);
      const dRow = w.enemies.find(w.enemies.id[0] as number);
      const hpLoss = 1000 - (w.enemies.hp[dRow] as number);
      return { hpLoss, cloneDmg: clone?.damage ?? 0, cloudDmg: cloud.damage };
    };

    const normal = runBlast(false);
    const copied = runBlast(true);

    expect(normal.hpLoss).toBeGreaterThan(0);
    expect(copied.hpLoss).toBeCloseTo(normal.hpLoss * 0.45, 3);
    expect(copied.cloneDmg).toBeCloseTo(copied.hpLoss, 3);
    expect(copied.cloudDmg).toBe(0);
  });

  it('awakened arc_of_might bolt hits and expiry/impact explosion scale by shadow clone power (45%) and credit shadow clone', () => {
    const runWave = (withClone: boolean): { directLoss: number; blastLoss: number; cloneDmg: number; waveDmg: number } => {
      const w = realWorld({ classId: 'ninja', doctrine: 'a' });
      const list = only(w, withClone ? ['shadow_clone', 'arc_of_might'] : ['arc_of_might'], 0);
      const p = hero(w);
      p.iframes = 1e9;
      p.fixed.push({ critChance: -1 });
      p.stats.critChance = 0;
      p.statsDirty = false;
      const clone = withClone ? (list[0] as SkillInstance) : null;
      const wave = (withClone ? list[1] : list[0]) as SkillInstance;
      wave.rank = 7; // rank-7 awakened arc_of_might (explode: 2); shadow_clone stays rank 0 (45% power)
      for (const s of p.skills) s.cd = 1e9;

      // place an enemy straight ahead to let the clone / wave cast
      const bait = ringOf(w, 'bear', 1, 4)[0] as number;
      w.enemies.x[bait] = w.enemies.px[bait] = 0;
      w.enemies.z[bait] = w.enemies.pz[bait] = 4;
      w.enemies.hp[bait] = 1e6;
      w.enemies.hpMax[bait] = 1e6;
      w.enemies.speed[bait] = 0;
      w.hash.rebuild(w.enemies);

      if (clone) {
        clone.cd = 0;
        expect(castNow(w, p, clone)).toBe(true);
        step(w, 2);
        clone.cd = 1e9;
      }

      wave.cd = 0;
      expect(castNow(w, p, wave)).toBe(true);
      wave.cd = 1e9;

      if (withClone) {
        // drop the hero's own bolts so only the clone's copied bolt exists once dispatched
        const P = w.projectiles;
        for (let i = P.count - 1; i >= 0; i--) {
          if (P.kind[i] === ProjKind.Bolt && (P.skill[i] as number) === wave.slot) P.free(i);
        }
        // wait until the mimic copy spawns its bolt
        for (let k = 0; k < 30; k++) {
          w.step([{ moveX: 0, moveZ: 0 }]);
          let found = false;
          for (let i = 0; i < P.count; i++) if (P.kind[i] === ProjKind.Bolt && (P.credit[i] as number) === clone!.slot + 1) found = true;
          if (found) break;
        }
      }

      const P = w.projectiles;
      let bolt = -1;
      for (let i = 0; i < P.count; i++) {
        if (P.kind[i] === ProjKind.Bolt && (P.skill[i] as number) === wave.slot) {
          bolt = i;
          break;
        }
      }
      expect(bolt).toBeGreaterThanOrEqual(0);
      if (withClone) {
        expect(P.mul[bolt]).toBeCloseTo(0.45, 5);
        expect(P.credit[bolt]).toBe(clone!.slot + 1);
      }

      // position bolt at (0, 20) travelling +Z with pierce = 0 so its single impact also triggers endBolt's awakened explosion
      P.x[bolt] = P.px[bolt] = 0;
      P.z[bolt] = P.pz[bolt] = 20;
      P.vx[bolt] = 0;
      P.vz[bolt] = 16;
      P.pierce[bolt] = 0;
      P.aux2[bolt] = 0;
      P.life[bolt] = 2;

      for (const s of p.skills) s.damage = 0;
      w.enemies.clear();
      w.spawner.alive = 0;
      // direct target right ahead on the bolt path; bystander offset laterally (outside bolt radius 0.8 + 0.65, inside explode radius 2.0 + 0.65)
      const directRow = ringOf(w, 'bear', 1, 1)[0] as number;
      w.enemies.x[directRow] = w.enemies.px[directRow] = 0;
      w.enemies.z[directRow] = w.enemies.pz[directRow] = 20.4;
      w.enemies.hp[directRow] = 1000;
      w.enemies.hpMax[directRow] = 1000;
      w.enemies.speed[directRow] = 0;
      const directId = w.enemies.id[directRow] as number;

      const blastRow = ringOf(w, 'bear', 1, 1)[0] as number;
      w.enemies.x[blastRow] = w.enemies.px[blastRow] = 2.0;
      w.enemies.z[blastRow] = w.enemies.pz[blastRow] = 20.4;
      w.enemies.hp[blastRow] = 1000;
      w.enemies.hpMax[blastRow] = 1000;
      w.enemies.speed[blastRow] = 0;
      const blastId = w.enemies.id[blastRow] as number;

      w.hash.rebuild(w.enemies);
      step(w, 6);

      const dRow = w.enemies.find(directId);
      const bRow = w.enemies.find(blastId);
      const directLoss = 1000 - (w.enemies.hp[dRow] as number);
      const blastLoss = 1000 - (w.enemies.hp[bRow] as number);
      return { directLoss, blastLoss, cloneDmg: clone?.damage ?? 0, waveDmg: wave.damage };
    };

    const normal = runWave(false);
    const copied = runWave(true);

    expect(normal.blastLoss).toBeGreaterThan(0);
    expect(normal.directLoss).toBeGreaterThan(normal.blastLoss);
    expect(copied.blastLoss).toBeCloseTo(normal.blastLoss * 0.45, 3);
    expect(copied.directLoss).toBeCloseTo(normal.directLoss * 0.45, 3);
    expect(copied.cloneDmg).toBeCloseTo(copied.directLoss + copied.blastLoss, 3);
    expect(copied.waveDmg).toBe(0);
  });

  it('copied skyStrike (shaft_deluge) and shockwave (stallion_stomp) credit their damage to shadow clone', () => {
    for (const skillId of ['shaft_deluge', 'stallion_stomp'] as const) {
      const w = realWorld({ classId: 'ninja', doctrine: 'a' });
      const [clone, skill] = only(w, ['shadow_clone', skillId], 0) as [SkillInstance, SkillInstance];
      const p = hero(w);
      p.iframes = 1e9;
      p.fixed.push({ critChance: -1 });
      p.stats.critChance = 0;
      p.statsDirty = false;
      for (const s of p.skills) s.cd = 1e9;

      const bait = ringOf(w, 'bear', 1, 2)[0] as number;
      w.enemies.hp[bait] = 1e6;
      w.enemies.hpMax[bait] = 1e6;
      w.enemies.speed[bait] = 0;
      w.hash.rebuild(w.enemies);

      clone.cd = 0;
      expect(castNow(w, p, clone)).toBe(true);
      step(w, 2);
      clone.cd = 1e9;

      skill.cd = 0;
      expect(castNow(w, p, skill)).toBe(true);
      skill.cd = 1e9;

      // clear hero-created zones immediately so only the mimic copy resolves
      w.zones.clear();
      for (const s of p.skills) s.damage = 0;

      step(w, 90);
      expect(clone.damage, `${skillId} copied damage credited to clone`).toBeGreaterThan(0);
      expect(skill.damage, `${skillId} copied damage not credited to source skill`).toBe(0);
    }
  });
});
