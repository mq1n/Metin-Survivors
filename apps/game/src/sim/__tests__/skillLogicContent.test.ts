// Skill-logic WP3 (content builder 1): the SHIPPED skills.json / talents.json of the buff, utility and companion skills carry the
// design's triggers, roles and payloads, every card text placeholder resolves, and the real content behaves in a live world
// (ring state armed -> active, the orbiter is permanent, a smoke bomb veils, a heal waits for need). Real content, not the fixture.

import { describe, expect, it } from 'vitest';
import { content } from '../../data/loader';
import type { SkillDef, TriggerKind } from '../../data/schema';
import { hud } from '../hud';
import { spawnEnemy } from '../enemies';
import { addSkill } from '../skills';
import { ProjKind, type SkillInstance } from '../stores';
import { createWorld, type World } from '../world';
import { drainModals } from './helpers';

const skill = (id: string): SkillDef => {
  const d = content.skills.find((s) => s.id === id);
  if (!d) throw new Error(`no skill ${id}`);
  return d;
};

/** id -> [trigger kinds, patience (0 = never), spec.n (0 = default)] exactly as DESIGN §0 / §5 */
const GATES: Record<string, [TriggerKind[], number, number]> = {
  warfever: [['pinned', 'elite'], 12, 0],
  redmane_spirit: [['elite', 'pinned'], 12, 0],
  blood_frenzy: [['elite', 'pinned'], 14, 8],
  surging_arms: [['elite', 'pinned'], 12, 0],
  sovereigns_ire: [['boss', 'pinned'], 20, 8],
  eagle_eye: [['elite', 'boss'], 14, 0],
  dark_covenant: [['elite', 'pinned'], 11, 8], // balance round 1: patience 20 -> 11 (uptime band)
  tailwind: [['pinned', 'hurt', 'ally'], 14, 0],
  moonmane_spirit: [['hurt', 'pinned', 'ally'], 14, 0],
  mending_light: [['danger', 'ally'], 0, 0],
  second_wind: [['hurt', 'danger'], 14, 0],
  chilling_dread: [['pinned', 'hurt'], 3, 0], // balance round 1: patience 6 -> 3 (the gate had halved Fear)
  smoke_bomb: [['pinned', 'hurt'], 6, 0],
  shadow_clone: [['engaged'], 0, 0],
  spirit_wolves: [['elite', 'pinned'], 6, 0],
  wyrm_retinue: [['elite', 'pinned'], 10, 0],
  thunder_guardians: [['elite', 'pinned'], 10, 7],
  cursed_legion: [['pinned', 'boss'], 12, 8],
};

const ROLES: Record<string, string> = {
  blaze_familiars: 'orbiter',
  spirit_wolves: 'hunter',
  wyrm_retinue: 'coil',
  thunder_guardians: 'planted',
  cursed_legion: 'planted',
  shadow_clone: 'mimic',
};

describe('shipped triggers, roles and payloads', () => {
  it('every redesigned skill carries the trigger of the design table', () => {
    for (const [id, [any, patience, n]] of Object.entries(GATES)) {
      const t = skill(id).trigger;
      expect(t, id).toBeDefined();
      expect([...(t?.any ?? [])].sort(), id).toEqual([...any].sort());
      expect(t?.patience ?? 0, `${id} patience`).toBe(patience);
      expect(t?.n ?? 0, `${id} n`).toBe(n);
    }
    // no trigger: damage skills and permanent auras stay plain (blaze_familiars, dispel, haunted_steel, swordlight_ring)
    for (const id of ['blaze_familiars', 'unbinding_sigil', 'haunted_steel', 'swordlight_ring']) expect(skill(id).trigger, id).toBeUndefined();
  });

  it('summon roles are set and their brains find the keys they read', () => {
    for (const [id, role] of Object.entries(ROLES)) expect(skill(id).role, id).toBe(role);
    const fs = skill('blaze_familiars').params;
    expect([fs.count, fs.range, fs.speed, fs.area, fs.damage, fs.cooldown].every((v) => v > 0)).toBe(true);
    expect(fs.duration, 'permanent spirits carry no duration').toBe(0);
    const da = skill('wyrm_retinue').params;
    expect(da.party, 'the coil host search').toBeGreaterThan(0);
    expect(da.buff?.damage, 'the host buff').toBeGreaterThan(0);
    expect(skill('cursed_legion').params.taunt, 'a knight taunts').toBeGreaterThan(0);
    expect(skill('thunder_guardians').params.taunt ?? 0, 'idols do not taunt').toBe(0);
    expect(skill('thunder_guardians').params.power, 'the arc').toBeGreaterThan(0);
    const sc = skill('shadow_clone').params;
    expect([sc.power, sc.tick, sc.speed].every((v) => v !== undefined && v > 0)).toBe(true);
    expect(skill('spirit_wolves').params.power, 'the pack bonus').toBeGreaterThan(0);
  });

  it('payload keys sit on the skills that read them', () => {
    expect(skill('warfever').params).toMatchObject({ nova: 3.5, extend: 0.1, refund: 0.05 });
    expect(Object.keys(skill('warfever').params.buff?.resist ?? {}).length, 'berserk pays with -15% resist on all eight elements').toBe(8);
    expect(skill('redmane_spirit').params.pulse).toBeGreaterThan(0);
    expect(skill('blood_frenzy').params.stack).toBe(2);
    expect(skill('eagle_eye').params).toMatchObject({ mark: 3, range: 14 });
    expect(skill('eagle_eye').params.status?.kind).toBe('weaken');
    expect(skill('dark_covenant').params.cost).toBe(12);
    expect(skill('dark_covenant').trigger?.minHp).toBe(0.5);
    for (const id of ['surging_arms', 'sovereigns_ire', 'tailwind', 'moonmane_spirit', 'mending_light']) expect(skill(id).params.party, id).toBeGreaterThan(0);
    expect(skill('unbinding_sigil').params.purge).toBe(6);
    expect(skill('smoke_bomb').params.veil).toBeGreaterThan(0);
    expect(skill('chilling_dread').params.status?.chance).toBeGreaterThanOrEqual(0.9);
    // Vigil on the insurance cards
    for (const id of ['second_wind', 'mending_light', 'tailwind', 'moonmane_spirit']) expect(Object.keys(skill(id).vigil ?? {}).length, id).toBeGreaterThan(0);
    
    expect(skill('second_wind').behavior).toBe('cone');
    expect(skill('second_wind').params.missing, 'the missing-HP scaling').toBeGreaterThan(0);
    expect(skill('second_wind').params.leech, 'the life-steal share').toBeGreaterThan(0);
  });

  it('every {key} of a card / awakening text is a numeric param of the skill (both languages)', () => {
    const bad: string[] = [];
    for (const def of content.skills) {
      const p = def.params as unknown as Record<string, unknown>;
      for (const [where, texts] of [['desc', def.desc], ['awaken', def.awaken.desc]] as const) {
        for (const lang of ['tr', 'en'] as const) {
          for (const m of texts[lang].matchAll(/\{(\w+)\}/g)) {
            if (typeof p[m[1] as string] !== 'number') bad.push(`${def.id}.${where}.${lang}: {${m[1]}}`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('talents that named a removed line now name a live one', () => {
    const mods = (node: string, tree: string): Record<string, number> => {
      const t = content.talents.find((x) => x.id === tree);
      const n = t?.nodes.find((x) => x.id === node);
      return (n?.effect as { params: Record<string, number> }).params;
    };
    const fs = skill('blaze_familiars');
    for (const [tree, node] of [['yacha_b', 'r1c1'], ['yacha_b', 'r4c1']] as const) {
      const keys = Object.keys(mods(node, tree));
      expect(keys, `${tree}.${node}`).not.toContain('duration');
      expect(keys.every((k) => fs.upgrades.some((u) => u.stat === k) || k === 'count' || k === 'area'), `${tree}.${node}`).toBe(true);
    }
    // Wellspring: duration / heal mean nothing on a cone, so it raises the blow (+10% damage) and shortens the lockout
    expect(Object.keys(mods('r3c0', 'warrior_a')).sort()).toEqual(['cooldown', 'damage']);
    expect(skill('second_wind').params.damage, 'a damage talent needs a base damage').toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------------- live world
function live(classId: 'warrior' | 'ninja' | 'yacha' | 'shaman' | 'wolfman', doctrine: 'a' | 'b', zone: string): World {
  const cls = content.classes.find((c) => c.id === classId);
  const w = createWorld({ zone, difficulty: 'normal', classId, doctrine, sex: cls?.sexes[0] ?? 'm', empire: 'saehwa', seed: 11, meta: { stats: {} } }, content);
  const p = w.players[0];
  if (!p) throw new Error('no hero');
  // a quiet field: no spawner, no schedules; only the studied skill (+ the basic)
  w.spawner.acc = -1e9;
  w.spawner.eliteT = 1e9;
  w.spawner.nextBoss = w.spawner.bosses.length;
  w.metinSys.nextFallAt = 1e9;
  w.metinSys.finalStarted = true;
  w.enemies.clear();
  w.spawner.alive = 0;
  const basic = p.skills[0];
  p.skills.length = 0;
  if (basic) p.skills.push(basic);
  return w;
}

function give(w: World, id: string): SkillInstance {
  const def = w.ix.skills.get(id);
  if (!def) throw new Error(`skill ${id}`);
  const p = w.players[0];
  if (!p) throw new Error('no hero');
  const s = addSkill(w, p, def, 0);
  s.cd = 0;
  return s;
}

function crowd(w: World, id: string, n: number, r: number): void {
  const t = w.ix.typeIndex.get(id);
  if (t === undefined) throw new Error(`enemy ${id}`);
  const p = w.players[0];
  if (!p) throw new Error('no hero');
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    spawnEnemy(w, t, p.x + Math.sin(a) * r, p.z + Math.cos(a) * r, { spawnTime: 0 });
  }
}

function step(w: World, n: number): void {
  for (let i = 0; i < n; i++) {
    drainModals(w);
    w.step([{ moveX: 0, moveZ: 0 }]);
  }
}

describe('shipped skills in a live world', () => {
  it('a context skill is ARMED in the HUD until its trigger, then ACTIVE for its window', () => {
    const w = live('warrior', 'a', 'yeonmu');
    const s = give(w, 'warfever');
    const p = w.players[0]!;
    p.iframes = 1e9; // the crowd must not hurt: this reads the ring only
    const idx = p.skills.indexOf(s);
    step(w, 120);
    let slot = hud(w, 0).skills[idx];
    expect(slot?.state, 'ready, nothing pins the hero').toBe('armed');
    crowd(w, 'wolf', 6, 2.5);
    step(w, 4);
    slot = hud(w, 0).skills[idx];
    expect(slot?.state, 'pinned by 6 wolves: it fired').toBe('active');
    expect(slot?.activeLeft ?? 0).toBeGreaterThan(5);
    expect(p.buffs.some((b) => b.skillSlot === s.slot)).toBe(true);
  });

  it('cure waits for need: no cast at full health with a crowd on top, a cast under 55% HP', () => {
    const w = live('shaman', 'b', 'daeryeol');
    const s = give(w, 'mending_light');
    const p = w.players[0]!;
    p.iframes = 1e9;
    crowd(w, 'wild_dog', 3, 2);
    step(w, 120);
    expect(s.aux, 'full health: no pillar').toBeLessThanOrEqual(w.time - 1);
    p.hp = p.hpMax * 0.5;
    step(w, 4);
    expect(p.buffs.some((b) => b.skillSlot === s.slot), 'half health: the pillar fell').toBe(true);
  });

  it('smoke bomb: pinned -> the ring fires and the hero is veiled', () => {
    const w = live('ninja', 'b', 'suryeon');
    give(w, 'smoke_bomb');
    const p = w.players[0]!;
    p.iframes = 1e9;
    crowd(w, 'wolf', 7, 2.2);
    step(w, 6);
    expect(p.veilT, 'veil from the cast').toBeGreaterThan(0);
  });

  it('flame spirit: one permanent orbiter row from the first tick, no foe needed, still there 40 s later', () => {
    const w = live('yacha', 'b', 'seori');
    const s = give(w, 'blaze_familiars');
    const rows = (): number => {
      const P = w.projectiles;
      let n = 0;
      for (let i = 0; i < P.count; i++) if (P.kind[i] === ProjKind.Familiar && P.skill[i] === s.slot) n++;
      return n;
    };
    step(w, 3);
    expect(rows()).toBe(1);
    step(w, 40 * 60);
    expect(rows(), 'permanent: the spirit never expires').toBe(1);
  });
});
