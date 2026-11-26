// Skill-logic WP3 (content builder 2): the SHIPPED shells, stealth, war oath and feather walk (real skills.json, not the fixture):
// the design table of triggers / vigil / payloads, then each skill in a live world (cast by its real trigger where that is cheap,
// castNow where the trigger is not the point): ward size from the holder's max HP, marker, end burst, steady, dodge charges, veil +
// decoy, the oath save, the party barrier rhythm, the mirror flip.

import { describe, expect, it } from 'vitest';
import { content } from '../../data/loader';
import type { SkillDef, TriggerKind } from '../../data/schema';
import { hurtPlayer, HurtKind } from '../combat';
import { spawnEnemy } from '../enemies';
import type { CoopPlayerInit } from '../run';
import { addSkill, castNow } from '../skills';
import { resolveParams, wardAmount } from '../skills/params';
import { ElementIdx, EnemyState, ProjKind, StatusBit, type PlayerState, type SkillInstance } from '../stores';
import { createWorld, type World } from '../world';
import { drainModals } from './helpers';

const skill = (id: string): SkillDef => {
  const d = content.skills.find((s) => s.id === id);
  if (!d) throw new Error(`no skill ${id}`);
  return d;
};

// ------------------------------------------------------------------------------------------------------------ the design table
/** id -> [trigger kinds, patience (0 = never), vigil keys] exactly as DESIGN section 0 / 5 */
const TABLE: Record<string, [TriggerKind[], number, string[]]> = {
  nightshroud: [['pinned', 'danger'], 0, ['evasion']],
  swallows_gait: [['pinned', 'hurt'], 0, ['moveSpeed']],
  graniteform: [['hurt', 'pinned'], 0, ['armor']],
  umbral_plate: [['hurt', 'pinned'], 0, ['armor']],
  obsidian_bulwark: [['pinned', 'hurt'], 0, ['lifesteal']],
  mirror_shell: [['volley', 'hurt', 'ally'], 14, ['armor']],
  stormglass_shell: [['engaged'], 0, ['regen']],
  radiant_favor: [['hurt', 'pinned', 'ally'], 14, ['regen']],
  war_oath: [['lethal'], 0, ['maxHpPct', 'armor']],
};

describe('shipped shells: triggers, vigil and payload keys of the design', () => {
  it('every shell / stealth / oath / feather skill carries its gate and its standing Vigil', () => {
    for (const [id, [any, patience, vigil]] of Object.entries(TABLE)) {
      const d = skill(id);
      expect([...(d.trigger?.any ?? [])].sort(), id).toEqual([...any].sort());
      expect(d.trigger?.patience ?? 0, `${id} patience`).toBe(patience);
      expect(Object.keys(d.vigil ?? {}).sort(), `${id} vigil`).toEqual([...vigil].sort());
      expect(d.behavior, id).toBe('selfBuff');
    }
  });

  it('the ward skills size a ward, name a burst where the design has one and keep base heal 0 (their heal lines grow the ward)', () => {
    // sizes are balance knobs (round 1 moved them): the test pins only that each ward skill sizes a sane ward
    const ward = ['graniteform', 'umbral_plate', 'obsidian_bulwark', 'mirror_shell', 'stormglass_shell', 'radiant_favor'];
    for (const id of ward) {
      const p = skill(id).params;
      expect(p.shield, id).toBeGreaterThanOrEqual(4);
      expect(p.shield, id).toBeLessThanOrEqual(20);
      expect(p.count, `${id}: count must stay 1 or the sim reads it as dodge charges`).toBe(1);
      if (id === 'radiant_favor') expect(p.burst ?? 0, 'blessing has no burst: the moment is the stamp').toBe(0);
      else expect(p.burst, id).toBeGreaterThan(0);
      if (id !== 'stormglass_shell' && id !== 'radiant_favor') expect(p.heal, `${id}: base heal 0 = no instant heal`).toBe(0);
    }
    expect(skill('graniteform').params).toMatchObject({ steady: 1, power: 100, burst: 4 });
    expect(skill('graniteform').params.status?.kind).toBe('stun');
    expect(skill('obsidian_bulwark').params.drain).toBe(1);
    expect(skill('mirror_shell').params).toMatchObject({ mirror: 4, party: 7 });
    expect(skill('stormglass_shell').params).toMatchObject({ party: 10, damage: 90, cooldown: 12 });
    expect(skill('radiant_favor').params).toMatchObject({ party: 8 });
    expect(skill('radiant_favor').params.heal, 'blessing keeps a real heal (balance round 1 raised it for the low-HP shaman)').toBeGreaterThanOrEqual(8);
  });

  it('stealth is a veil + decoy + ambush, feather walk two dodge charges, the oath a lethal save', () => {
    expect(skill('nightshroud').params).toMatchObject({ taunt: 6, damage: 30, area: 3 });
    expect(skill('nightshroud').params.veil).toBeGreaterThanOrEqual(3);
    expect(skill('nightshroud').params.buff?.critChance).toBeGreaterThan(0);
    expect(skill('nightshroud').params.buff?.evasion, 'the old flat evasion is gone').toBeUndefined();
    expect(skill('swallows_gait').params).toMatchObject({ count: 2, nova: 3, duration: 4 });
    expect(skill('swallows_gait').upgrades.some((u) => u.stat === 'count'), 'the +1 dodge charge line').toBe(true);
    expect(skill('war_oath').params).toMatchObject({ power: 30, heal: 20, nova: 5, novaDamage: 1, extend: 0.3, cooldown: 80 });
  });

  it('the dodge discriminator: only feather walk has a base count above 1 among the selfBuffs', () => {
    const over = content.skills.filter((s) => s.behavior === 'selfBuff' && (s.params.count ?? 1) > 1).map((s) => s.id);
    expect(over).toEqual(['swallows_gait']);
  });

  it('the milestone texts of war oath and aether ward describe the new skills (both languages)', () => {
    const find = (tree: string, at: number) => content.talents.find((t) => t.id === tree)?.milestones?.find((m) => m.at === at);
    const oath = find('warrior_a', 10);
    expect(oath?.skill).toBe('war_oath');
    expect(oath?.effect?.en).toMatch(/cheats death/);
    expect(oath?.effect?.tr).toMatch(/80/);
    const aether = find('shaman_b', 30);
    expect(aether?.skill).toBe('stormglass_shell');
    expect(aether?.effect?.en).toMatch(/recurring aether barrier/);
    expect(aether?.effect?.tr).toMatch(/12/);
  });
});

// ------------------------------------------------------------------------------------------------------------ live worlds
type Cls = 'warrior' | 'ninja' | 'yacha' | 'shaman' | 'wolfman';
const PARTNER: CoopPlayerInit = { classId: 'warrior', doctrine: 'b', sex: 'f', empire: 'chowon', meta: { stats: {} } };

function live(classId: Cls, doctrine: 'a' | 'b', zone: string, coop = false): World {
  const cls = content.classes.find((c) => c.id === classId);
  const w = createWorld(
    { zone, difficulty: 'normal', classId, doctrine, sex: cls?.sexes[0] ?? 'm', empire: 'saehwa', seed: 11, meta: { stats: {} }, ...(coop ? { coop: [PARTNER] } : {}) },
    content,
  );
  // a quiet field: no spawner, no schedules, no creatures, no skills except what a test gives
  w.spawner.acc = -1e9;
  w.spawner.eliteT = 1e9;
  w.spawner.nextBoss = w.spawner.bosses.length;
  w.metinSys.nextFallAt = 1e9;
  w.metinSys.finalStarted = true;
  w.enemies.clear();
  w.spawner.alive = 0;
  for (const q of w.players) {
    q.skills.length = 0;
    q.stats.critChance = 0;
  }
  return w;
}

function give(w: World, id: string, who = 0): SkillInstance {
  const def = w.ix.skills.get(id);
  if (!def) throw new Error(`skill ${id}`);
  const s = addSkill(w, w.players[who] as PlayerState, def, 0);
  s.cd = 0;
  return s;
}

/** n creatures on a ring of radius r around (cx, cz); frozen and tough so they only stand there */
function crowd(w: World, n: number, r: number, cx = 0, cz = 0): number[] {
  const t = w.ix.typeIndex.get('wolf');
  if (t === undefined) throw new Error('enemy wolf');
  const rows: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const row = spawnEnemy(w, t, cx + Math.sin(a) * r, cz + Math.cos(a) * r, { spawnTime: 0 });
    w.enemies.hp[row] = 1e4;
    rows.push(row);
  }
  freeze(w);
  return rows;
}

function freeze(w: World): void {
  for (let i = 0; i < w.enemies.count; i++) {
    w.enemies.state[i] = EnemyState.Recover;
    w.enemies.aiT[i] = 1e9;
  }
}

function step(w: World, n: number): void {
  for (let i = 0; i < n; i++) {
    drainModals(w);
    freeze(w);
    w.step(w.players.map(() => ({ moveX: 0, moveZ: 0 })));
  }
}

/** a melee blow from the east; iframes dropped so it lands */
function blow(w: World, p: PlayerState, amount: number, kind: number = HurtKind.Melee): boolean {
  p.iframes = 0;
  return hurtPlayer(w, p.index, amount, 3, 0, ElementIdx.Physical, kind, 0);
}

function markers(w: World, style: string): number[] {
  const P = w.projectiles;
  const out: number[] = [];
  for (let i = 0; i < P.count; i++) if (P.kind[i] === ProjKind.Marker && w.strings.name(P.style[i] as number) === style) out.push(i);
  return out;
}

function sawVfx(w: World, prefix: string): boolean {
  return w.events.some((e) => e.t === 'vfx' && e.preset.startsWith(prefix));
}

describe('shipped shells in a live world: raise, soak, break, answer', () => {
  const SHELLS: [string, Cls, 'a' | 'b', string, string | null][] = [
    ['graniteform', 'warrior', 'b', 'yeonmu', 'sk.graniteform.shatter'],
    ['umbral_plate', 'yacha', 'a', 'seori', 'sk.umbral_plate.burst'],
    ['obsidian_bulwark', 'yacha', 'b', 'seori', 'sk.obsidian_bulwark.burst'],
    ['mirror_shell', 'shaman', 'a', 'daeryeol', 'sk.mirror_shell.burst'],
    ['stormglass_shell', 'shaman', 'b', 'daeryeol', 'sk.stormglass_shell.pulse'],
    ['radiant_favor', 'shaman', 'a', 'daeryeol', null],
  ];

  for (const [id, cls, doc, zone, burst] of SHELLS) {
    it(`${id}: a ward of its % of the hero's max HP, a loop marker, the end burst (${burst ?? 'none'}) when a blow breaks it`, () => {
      const w = live(cls, doc, zone);
      const s = give(w, id);
      const p = w.players[0] as PlayerState;
      const dummies = crowd(w, 3, 2.5);
      w.hash.rebuild(w.enemies);
      expect(castNow(w, p, s)).toBe(true);
      const fp = resolveParams(p, s, s.fp);
      expect(p.ward, 'ward = shield % x max HP').toBeCloseTo(wardAmount(fp, p.hpMax), 3);
      expect(p.ward).toBeCloseTo(((s.def.params.shield ?? 0) / 100) * p.hpMax, 3);
      expect(p.wardSlot).toBe(s.slot);
      expect(markers(w, `sk.${id}.loop`).length, 'the loop marker row follows the hero').toBe(1);
      // a blow bigger than the ward breaks it; what is left hurts, the shell answers
      const hp0 = p.hp;
      const big = p.ward * 4;
      const hpEnemy0 = w.enemies.hp[dummies[0] as number] as number;
      expect(blow(w, p, big)).toBe(true);
      expect(p.ward).toBe(0);
      expect(p.hp, 'only the part the ward could not soak got through').toBeGreaterThan(hp0 - big);
      expect(sawVfx(w, 'sk.gen.ward_break'), 'the shared break moment').toBe(true);
      if (burst) {
        expect(sawVfx(w, burst), burst).toBe(true);
        expect(w.enemies.hp[dummies[0] as number] as number, 'the burst hurt the creatures around').toBeLessThan(hpEnemy0);
      } else {
        expect(w.enemies.hp[dummies[0] as number] as number, 'no burst').toBe(hpEnemy0);
        expect(w.events.some((e) => e.t === 'vfx' && /^sk\.blessing\.(burst|pulse|shatter)/.test(e.preset))).toBe(false);
      }
      step(w, 2);
      expect(markers(w, `sk.${id}.loop`).length, 'the marker is freed with the ward').toBe(0);
    });
  }

  it('strong body: the shell makes the hero unpushable and the shatter stuns what it hits', () => {
    const w = live('warrior', 'b', 'yeonmu');
    const s = give(w, 'graniteform');
    const p = w.players[0] as PlayerState;
    const rows = crowd(w, 6, 2.5);
    p.iframes = 1e9;
    step(w, 4);
    expect(p.ward, 'pinned by six: the shell formed by its own trigger').toBeGreaterThan(0);
    expect(p.steadyT).toBeGreaterThan(7);
    const kvx = p.kvx;
    p.iframes = 0;
    hurtPlayer(w, 0, 1, 3, 0, ElementIdx.Physical, HurtKind.Melee, 0);
    expect(p.kvx, 'steady: no push').toBe(kvx);
    // let the shell expire: the shatter fires with the stun
    p.iframes = 1e9;
    let ended = false;
    const shellSecs = skill('graniteform').params.duration;
    for (let i = 0; i < (shellSecs + 1) * 60 && !ended; i++) {
      step(w, 1);
      ended = p.ward === 0;
    }
    expect(ended, `the ${shellSecs} s shell ran out`).toBe(true);
    expect(p.steadyT, 'steady ends with the shell').toBe(0);
    expect(rows.some((r) => ((w.enemies.status[r] as number) & StatusBit.Stun) !== 0), 'the shatter stunned the pack').toBe(true);
    expect(s.cd, 'lockout: 32 s from the cast, less the 8 s the shell stood').toBeGreaterThan(20);
  });

  it('aether ward in co-op: the party barrier is sized from each hero, and returns at most 12 s after it was raised', () => {
    const w = live('shaman', 'b', 'daeryeol', true);
    const s = give(w, 'stormglass_shell');
    const a = w.players[0] as PlayerState;
    const b = w.players[1] as PlayerState;
    a.x = a.px = 0;
    a.z = a.pz = 0;
    b.x = b.px = 6;
    b.z = b.pz = 0;
    b.hpMax = b.hp = 200;
    crowd(w, 5, 3);
    step(w, 3);
    expect(a.ward, 'engaged: the barrier is raised').toBeGreaterThan(0);
    expect(a.ward).toBeCloseTo(0.12 * a.hpMax, 2);
    expect(b.ward, 'the ally in range carries one sized from ITS max HP').toBeCloseTo(0.12 * 200, 2);
    expect(b.wardSlot).toBe(s.slot);
    const raisedAt = w.time;
    // a blow breaks the caster's barrier early: the window ends at the break, the cooldown counts from the raise
    blow(w, a, a.ward * 5);
    expect(a.ward).toBe(0);
    // the lockout is the skill's resolved cooldown (12 s base, less the hero's own cooldown stat)
    const lock = s.fp.cooldown;
    expect(lock).toBeLessThanOrEqual(12);
    expect(lock).toBeGreaterThan(9);
    step(w, 5 * 60);
    expect(a.ward, 'still on the lockout').toBe(0);
    while (w.time - raisedAt < lock - 0.4) step(w, 5);
    expect(a.ward, 'not before the lockout is over').toBe(0);
    while (w.time - raisedAt < lock + 0.5) step(w, 2);
    expect(a.ward, 'raised again one lockout after the first raise').toBeGreaterThan(0);
  });

  it('blessing in co-op: a hurt ally within 8 m opens the gate; both heroes heal and carry a ward of their own size', () => {
    const w = live('shaman', 'a', 'daeryeol', true);
    const s = give(w, 'radiant_favor');
    const a = w.players[0] as PlayerState;
    const b = w.players[1] as PlayerState;
    a.x = a.px = 0;
    b.x = b.px = 5;
    a.z = a.pz = b.z = b.pz = 0;
    b.hpMax = 150;
    b.hp = 150;
    a.hp = a.hpMax * 0.5;
    a.iframes = b.iframes = 1e9;
    step(w, 2);
    expect(s.cd, 'a quiet field and full health: the gate is shut').toBe(0);
    expect(a.ward + b.ward).toBe(0);
    b.hp = 70; // the ally is below 55%
    step(w, 3);
    const frac = (skill('radiant_favor').params.shield ?? 0) / 100;
    expect(a.ward, 'the caster too').toBeCloseTo(frac * a.hpMax, 2);
    expect(b.ward).toBeCloseTo(frac * 150, 2);
    expect(b.hp, 'the heal lands on the ally').toBeGreaterThanOrEqual(70 + (skill('radiant_favor').params.heal ?? 0) - 1e-3);
    expect(s.cd).toBeGreaterThan(20);
  });

  it('reflect: the dome turns a hostile bolt around as the shaman\'s own capped bolt', () => {
    const w = live('shaman', 'a', 'daeryeol');
    const s = give(w, 'mirror_shell');
    const p = w.players[0] as PlayerState;
    w.hash.rebuild(w.enemies);
    expect(castNow(w, p, s)).toBe(true);
    expect(p.mirrorT).toBeGreaterThan(9);
    expect(p.mirrorR).toBeCloseTo(4, 3);
    const P = w.projectiles;
    const r = P.alloc();
    P.kind[r] = ProjKind.Hostile;
    P.hostile[r] = 1;
    P.x[r] = 0;
    P.z[r] = 6;
    P.vx[r] = 0;
    P.vz[r] = -8;
    P.radius[r] = 0.3;
    P.life[r] = 3;
    P.damage[r] = 500;
    P.element[r] = ElementIdx.Fire;
    P.skill[r] = 255;
    p.iframes = 0;
    const hp0 = p.hp;
    step(w, 60);
    expect(p.hp, 'the bolt never reached the hero').toBe(hp0);
    let turned = -1;
    for (let i = 0; i < P.count; i++) if (P.kind[i] === ProjKind.Bolt && P.skill[i] === s.slot) turned = i;
    expect(turned).toBeGreaterThanOrEqual(0);
    expect(P.hostile[turned]).toBe(0);
    expect(P.damage[turned], 'capped at 3x the skill damage').toBeLessThanOrEqual(3 * s.fp.damage + 1e-3);
  });
});

describe('shipped stealth, feather walk and war oath in a live world', () => {
  it('stealth: pinned -> the horde loses the hero, a decoy bait stands where he was and pops when the veil ends', () => {
    const w = live('ninja', 'a', 'suryeon');
    const s = give(w, 'nightshroud');
    const p = w.players[0] as PlayerState;
    const rows = crowd(w, 7, 2.2);
    p.iframes = 1e9;
    step(w, 4);
    expect(p.veilT, 'veil from the cast').toBeGreaterThan(2.5);
    expect(p.decoySlot).toBe(s.slot);
    expect(w.baits.count, 'the decoy pulls creatures').toBe(1);
    expect(markers(w, 'sk.gen.veil_ring').length).toBe(1);
    expect(markers(w, 'sk.nightshroud.decoy').length).toBe(1);
    expect(p.buffs.some((b) => b.skillSlot === s.slot && (b.mods.critChance ?? 0) > 0), 'the ambush window').toBe(true);
    expect(p.iframes, 'stealth, not invulnerability: the test froze the clock on purpose').toBeGreaterThan(0);
    const hp0 = w.enemies.hp[rows[0] as number] as number;
    p.iframes = 0;
    // the veil ends after 3 s: the decoy bursts over its 3 m
    let burst = false;
    for (let i = 0; i < 4 * 60 && !burst; i++) {
      step(w, 1);
      burst = sawVfx(w, 'sk.nightshroud.burst');
    }
    expect(burst, 'the decoy burst fires when the veil ends').toBe(true);
    expect(p.veilT).toBe(0);
    expect(w.enemies.hp[rows[0] as number] as number, 'the burst hurt the pack').toBeLessThan(hp0);
    expect(s.cd, '26 s lockout').toBeGreaterThan(20);
  });

  it('feather walk: two dodge charges slip the next two blows, a hazard tick spends none', () => {
    const w = live('ninja', 'b', 'suryeon');
    give(w, 'swallows_gait');
    const p = w.players[0] as PlayerState;
    crowd(w, 6, 2.5);
    p.iframes = 1e9;
    step(w, 4);
    expect(p.dodgeN).toBe(2);
    expect(p.dodgeT).toBeGreaterThan(3.5);
    const hp0 = p.hp;
    expect(blow(w, p, 30, HurtKind.Hazard), 'a hazard tick lands').toBe(true);
    expect(p.dodgeN, 'and spends no charge').toBe(2);
    p.hp = hp0;
    expect(blow(w, p, 30)).toBe(false);
    expect(p.dodgeN).toBe(1);
    expect(sawVfx(w, 'sk.gen.dodge_hop')).toBe(true);
    expect(blow(w, p, 30)).toBe(false);
    expect(p.dodgeN).toBe(0);
    expect(p.hp).toBe(hp0);
    expect(blow(w, p, 30), 'the third blow lands').toBe(true);
    expect(p.hp).toBeLessThan(hp0);
  });

  it('war oath: armed from the start, a killing blow is undone once, then the lockout is on', () => {
    const w = live('warrior', 'a', 'yeonmu');
    const p = w.players[0] as PlayerState;
    p.stats.revives = 0;
    const hpMax0 = p.hpMax;
    const s = give(w, 'war_oath');
    const dummy = crowd(w, 1, 3)[0] as number;
    step(w, 3);
    expect(p.lethalSlot, 'armed: the oath waits for the killing blow').toBe(s.slot);
    expect(p.hpMax, 'the Vigil: +6% max HP while the ultimate is owned').toBeGreaterThan(hpMax0 * 1.05);
    p.hp = 10;
    const dummyHp = w.enemies.hp[dummy] as number;
    expect(blow(w, p, 1e5), 'the blow is undone').toBe(false);
    expect(p.alive).toBe(true);
    expect(p.hp, '30% of max HP + 20').toBeCloseTo(p.hpMax * 0.3 + 20, 0);
    expect(p.iframes, '2.5 s untouchable').toBeGreaterThan(2.3);
    expect(p.buffs.some((b) => b.skillSlot === s.slot && (b.mods.damage ?? 0) > 0), 'the surge window').toBe(true);
    expect(w.enemies.hp[dummy] as number, 'the nova hurled the pack back for damage').toBeLessThan(dummyHp);
    expect(sawVfx(w, 'sk.war_oath.save')).toBe(true);
    expect(s.cd).toBeGreaterThan(75);
    step(w, 2);
    expect(p.lethalSlot, 'spent: no second oath inside the lockout').toBe(-1);
    p.hp = 10;
    blow(w, p, 1e5);
    expect(p.alive, 'the second killing blow is real').toBe(false);
  });
});
