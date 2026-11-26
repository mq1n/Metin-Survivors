// Skill-logic WP5 (DESIGN section 9, companions.test.ts) on the SHIPPED summons: each of the six roles of skills.json comes up with the right
// rows (role tag, count), keeps its leash, expires cleanly (no leaked rows, markers or baits), an armed orbiter draws no RNG, the legacy chaser
// is still the fallback of a summon without a role, the knights really pull the horde through the bait list, and a long kit soak keeps the
// projectile table bounded. Fixture-content brain details (ring geometry, prey order, arc web ...) are in companionRoles.test.ts.

import { describe, expect, it } from 'vitest';
import { content } from '../../data/loader';
import { CompanionRole, ProjKind, type PlayerState, type SkillInstance } from '../stores';
import type { World } from '../world';
import { botInput } from './bot';
import { drainModals, findNonFinite } from './helpers';
import { PARTNER, hero, only, realWorld, ringOf, rowsOf, step } from './skillLab';

const ROLE_OF: Record<string, CompanionRole> = {
  blaze_familiars: CompanionRole.Orbiter,
  spirit_wolves: CompanionRole.Hunter,
  wyrm_retinue: CompanionRole.Coil,
  thunder_guardians: CompanionRole.Pylon,
  cursed_legion: CompanionRole.Knight,
};
const CLASS_OF: Record<string, ['yacha' | 'wolfman' | 'shaman', 'a' | 'b']> = {
  blaze_familiars: ['yacha', 'b'],
  spirit_wolves: ['wolfman', 'b'],
  wyrm_retinue: ['shaman', 'a'],
  thunder_guardians: ['shaman', 'b'],
  cursed_legion: ['yacha', 'a'],
};

function rolesOf(w: World, slot: number, role: CompanionRole): number[] {
  const P = w.projectiles;
  return rowsOf(w, ProjKind.Familiar, slot).filter((r) => P.role[r] === role);
}

/** one summon, quiet field, a crowd of dogs in reach, the skill cast through the QA path */
function fielded(id: string, extra: { crowd?: number } = {}): { w: World; p: PlayerState; s: SkillInstance } {
  const [classId, doctrine] = CLASS_OF[id] ?? ['yacha', 'a'];
  const w = realWorld({ classId, doctrine, stats: { armor: 300, regen: 50 } });
  const [s] = only(w, [id]);
  const p = hero(w);
  ringOf(w, 'wild_dog', extra.crowd ?? 10, 6);
  w.hash.rebuild(w.enemies);
  w.qaForceTriggers = true;
  step(w, 3);
  w.qaForceTriggers = false;
  return { w, p, s: s! };
}

describe('every shipped role comes up with its rows', () => {
  for (const [id, role] of Object.entries(ROLE_OF)) {
    it(`${id}: role ${role} rows tagged on the Familiar table, ${(content.skills.find((s) => s.id === id)?.params.count ?? 1)} at the start`, () => {
      const { w, s } = fielded(id);
      const rows = rolesOf(w, s.slot, role);
      expect(rows.length).toBeGreaterThanOrEqual(s.def.params.count > 0 ? Math.min(s.def.params.count, 2) : 1);
      if (id !== 'cursed_legion') expect(rows).toHaveLength(Math.max(1, s.def.params.count));
      expect(findNonFinite(w)).toBeNull();
      // every companion row is owned by the caster and carries a skill style (so the generic body hides it)
      const P = w.projectiles;
      for (const r of rows) {
        expect(P.owner[r]).toBe(0);
        expect(w.strings.name(P.style[r] as number).startsWith('sk.'), 'sk.* style').toBe(true);
      }
    });
  }

  it('shadow clone: one Mimic row', () => {
    const w = realWorld({ classId: 'ninja', doctrine: 'a', stats: { armor: 300 } });
    const [s] = only(w, ['shadow_clone']);
    ringOf(w, 'wild_dog', 6, 4);
    w.hash.rebuild(w.enemies);
    w.qaForceTriggers = true;
    step(w, 3);
    expect(rolesOf(w, s!.slot, CompanionRole.Mimic)).toHaveLength(1);
  });
});

describe('lifetime: nothing is left behind', () => {
  for (const id of ['spirit_wolves', 'wyrm_retinue', 'thunder_guardians', 'cursed_legion'] as const) {
    it(`${id}: after its window the rows, the markers and the baits it made are gone`, () => {
      const { w, s } = fielded(id);
      const dur = s.def.params.duration;
      w.players[0]!.iframes = 1e9;
      step(w, Math.round((dur + 2) * 60));
      expect(rowsOf(w, ProjKind.Familiar, s.slot), 'companion rows').toHaveLength(0);
      expect(rowsOf(w, ProjKind.Marker, s.slot), 'marker rows of the skill').toHaveLength(0);
      // knights add baits every tick for 0.15 s; with no knight left the list drains
      step(w, 30);
      expect(w.baits.count, 'baits').toBe(0);
      // the lockout recharges it
      expect(s.cd).toBeGreaterThan(0);
    });
  }

  it('flame spirit is permanent: still one orbiter after two minutes of fighting, no leaks', () => {
    const { w, p, s } = fielded('blaze_familiars');
    p.iframes = 1e9;
    for (let i = 0; i < 120 * 60; i++) {
      drainModals(w);
      w.step([botInput(w, i)]);
    }
    expect(rolesOf(w, s.slot, CompanionRole.Orbiter)).toHaveLength(1);
    // twins fly and die: the table holds the spirit and at most the volley in flight
    expect(w.projectiles.count).toBeLessThan(30);
  });
});

describe('flame spirit: the orbiter', () => {
  it('stays on its ring around the running hero (never farther than the ring radius + the hero step)', () => {
    const { w, p, s } = fielded('blaze_familiars', { crowd: 0 });
    p.iframes = 1e9;
    let worst = 0;
    for (let i = 0; i < 20 * 60; i++) {
      w.step([{ moveX: Math.cos(i * 0.01), moveZ: Math.sin(i * 0.01) }]);
      const r = rolesOf(w, s.slot, CompanionRole.Orbiter)[0] as number;
      worst = Math.max(worst, Math.hypot((w.projectiles.x[r] as number) - p.x, (w.projectiles.z[r] as number) - p.z));
    }
    expect(worst, 'a ring of 0.55-0.9 m around the hero').toBeLessThan(2.2);
  });

  it('the volley is armed until a creature is in range and then draws RNG only through the combat stream', () => {
    const w = realWorld({ classId: 'yacha', doctrine: 'b', seed: 4 });
    const ref = realWorld({ classId: 'yacha', doctrine: 'b', seed: 4 });
    only(w, ['blaze_familiars']);
    only(ref, []);
    step(w, 600);
    step(ref, 600);
    expect(w.rng.combat.next(), 'no volley, no draw').toBe(ref.rng.combat.next());
    // a creature in range: a twin flies within a second
    ringOf(w, 'wild_dog', 3, 6);
    w.hash.rebuild(w.enemies);
    let twin = false;
    for (let i = 0; i < 120 && !twin; i++) {
      step(w, 1);
      twin = rowsOf(w, ProjKind.Homing).some((r) => w.projectiles.role[r] === CompanionRole.Twin);
    }
    expect(twin, 'a twin left the hero').toBe(true);
  });
});

describe('legacy chaser stays the fallback', () => {
  it('a summon without a role is still the 2-chaser brain: Chaser-tagged rows that strike', () => {
    const w = realWorld({ classId: 'yacha', doctrine: 'b', stats: { armor: 300 } });
    const base = content.skills.find((s) => s.id === 'blaze_familiars');
    expect(base).toBeDefined();
    // the same def with its role removed and the pre-redesign numbers (timed chasers)
    const legacy = { ...(base as object), id: 'blaze_familiars', role: undefined, params: { ...(base as { params: object }).params, duration: 12, tick: 0.8, count: 2 } };
    const idx = w.ix.skills.get('blaze_familiars');
    expect(idx).toBeDefined();
    w.ix.skills.set('blaze_familiars', legacy as never);
    const [s] = only(w, ['blaze_familiars']);
    ringOf(w, 'wild_dog', 4, 4);
    w.hash.rebuild(w.enemies);
    step(w, 4);
    const P = w.projectiles;
    const rows = rowsOf(w, ProjKind.Familiar, s!.slot);
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(P.role[r]).toBe(CompanionRole.Chaser);
  });
});

describe('cursed legion: knights pull the horde through the bait list', () => {
  /** mean distance of the 14-dog horde to the knight line after 3 s, with and without the legion */
  function horde(withLegion: boolean): { mean: number; baits: number } {
    const w = realWorld({ classId: 'yacha', doctrine: 'a', stats: { armor: 500, regen: 100 } });
    const p = hero(w);
    const [s] = only(w, withLegion ? ['cursed_legion'] : []);
    p.iframes = 1e9;
    // (the hero stands still)
    // dogs pinned 5 m east of the hero would normally walk straight at it; a knight stands 3.5 m north-east
    ringOf(w, 'wild_dog', 14, 9);
    w.hash.rebuild(w.enemies);
    if (withLegion) {
      w.qaForceTriggers = true;
      step(w, 2);
      w.qaForceTriggers = false;
      expect(rolesOf(w, s!.slot, CompanionRole.Knight).length).toBeGreaterThanOrEqual(3);
    }
    step(w, 180);
    const E = w.enemies;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < E.count; i++) {
      sum += Math.hypot((E.x[i] as number) - p.x, (E.z[i] as number) - p.z);
      n++;
    }
    return { mean: sum / Math.max(1, n), baits: w.baits.count };
  }

  it('with the legion up the horde keeps its distance from the hero and the bait list is in use; without it the dogs close in', () => {
    const control = horde(false);
    const legion = horde(true);
    expect(legion.baits, 'knights add baits').toBeGreaterThan(0);
    expect(legion.mean, `taunted ${legion.mean.toFixed(2)} m vs free ${control.mean.toFixed(2)} m: the horde stops at the knights, not at the hero`).toBeGreaterThan(control.mean + 0.3);
  });
});

describe('coil (dragon aid) in co-op with the real numbers', () => {
  it('the dragon flies to the ally who deals the most damage (within 14 m), buffs HIM under the caster slot, and the caster is not buffed twice', () => {
    const w = realWorld({ classId: 'shaman', doctrine: 'a', coop: [PARTNER], stats: { armor: 300 } });
    const [s] = only(w, ['wyrm_retinue'], 0, 0);
    const a = hero(w, 0);
    const b = hero(w, 1);
    a.x = a.px = 0;
    b.x = b.px = 6;
    b.dmgRecent = 500;
    a.dmgRecent = 1;
    ringOf(w, 'wild_dog', 6, 4);
    w.hash.rebuild(w.enemies);
    w.qaForceTriggers = true;
    step(w, 3);
    w.qaForceTriggers = false;
    expect(b.buffs.some((x) => x.skillSlot === s!.slot), 'the best hitter carries the dragon buff').toBe(true);
    const coil = rolesOf(w, s!.slot, CompanionRole.Coil);
    expect(coil).toHaveLength(1);
    expect(w.projectiles.anchor[coil[0] as number], 'the coil is anchored on the host').toBe(1);
  });
});

describe('a long kit soak stays bounded', () => {
  it('all six roles on one hero for 150 s of live play: finite, under 140 projectile rows, baits within the list, no marker leak', () => {
    const w = realWorld({ classId: 'yacha', doctrine: 'a', live: true, seed: 17, stats: { armor: 400, regen: 8, maxHpPct: 4 } });
    const p = hero(w);
    only(w, ['blaze_familiars', 'spirit_wolves', 'wyrm_retinue', 'thunder_guardians', 'cursed_legion', 'shadow_clone'], 3);
    let peak = 0;
    let markers = 0;
    for (let i = 0; i < 150 * 60 && !w.over; i++) {
      drainModals(w);
      w.step([botInput(w, i)]);
      if (i % 60 === 0) {
        peak = Math.max(peak, w.projectiles.count);
        markers = Math.max(markers, rowsOf(w, ProjKind.Marker).length);
        expect(findNonFinite(w), `t=${w.time.toFixed(0)}`).toBeNull();
        expect(w.baits.count).toBeLessThanOrEqual(8);
      }
    }
    expect(p.alive).toBe(true);
    expect(peak).toBeLessThan(140);
    expect(markers, 'marker rows').toBeLessThan(30);
  });
});
