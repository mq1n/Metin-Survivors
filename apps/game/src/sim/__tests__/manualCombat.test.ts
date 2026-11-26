// Manual combat controls (Space/LMB basic attack, 1-6 skill hotkeys, manualCast mode, cursor aim).
import { describe, expect, it } from 'vitest';
import { content } from '../../data/loader';
import { createWorld } from '../world';
import { addSkill } from '../skills';
import type { PlayerInput } from '../stores';

function makeYeonmuWorld(classId: 'warrior' | 'ninja' | 'shaman' = 'warrior', doctrine: 'a' | 'b' = 'a') {
  return createWorld(
    { zone: 'yeonmu', difficulty: 'normal', classId, doctrine, sex: 'm', empire: 'saehwa', seed: 42, meta: { stats: {} } },
    content,
  );
}

describe('manual combat controls', () => {
  it('manualCast=true prevents idle auto-firing of basic and active skills', () => {
    const w = makeYeonmuWorld('warrior', 'a');
    const p = w.players[0]!;
    // clear starter cooldowns and place an enemy right next to hero
    for (const s of p.skills) s.cd = 0;
    const inp: PlayerInput = { moveX: 0, moveZ: 0, manualCast: true };
    let casts = 0;
    for (let i = 0; i < 120; i++) {
      w.step([inp]);
      for (const e of w.events) if (e.t === 'skillCast') casts++;
    }
    expect(casts).toBe(0);
  });

  it('attack=true fires basic attack immediately into open air along cursor aim even with no enemies', () => {
    const w = makeYeonmuWorld('warrior', 'a');
    const p = w.players[0]!;
    p.skills[0]!.cd = 0;
    const inp: PlayerInput = { moveX: 0, moveZ: 0, manualCast: true, attack: true, aimX: 1, aimZ: 0 };
    w.step([inp]);
    const cast = w.events.find((e) => e.t === 'skillCast');
    expect(cast).toBeDefined();
    if (cast && cast.t === 'skillCast') {
      expect(cast.skillId).toBe(p.skills[0]!.def.id);
      expect(cast.dirX).toBeCloseTo(1, 5);
      expect(cast.dirZ).toBeCloseTo(0, 5);
    }
    expect(p.skills[0]!.cd).toBeGreaterThan(0);
  });

  it('castMask bit 1 manually fires the first active skill (hotkey 2) even with no enemy in range', () => {
    const w = makeYeonmuWorld('warrior', 'a');
    const p = w.players[0]!;
    expect(p.skills.length).toBeGreaterThanOrEqual(2);
    for (const s of p.skills) s.cd = 0;
    // bit 1 = slot 2 (first active skill)
    const inp: PlayerInput = { moveX: 0, moveZ: 0, manualCast: true, castMask: 1 << 1, aimX: 0, aimZ: -1 };
    w.step([inp]);
    const cast = w.events.find((e) => e.t === 'skillCast');
    expect(cast).toBeDefined();
    if (cast && cast.t === 'skillCast') {
      expect(cast.skillId).toBe(p.skills[1]!.def.id);
    }
  });

  it('supports ranged bow basic attack into open air on Space/LMB', () => {
    const w = makeYeonmuWorld('ninja', 'b');
    const p = w.players[0]!;
    p.skills[0]!.cd = 0;
    const inp: PlayerInput = { moveX: 0, moveZ: 0, manualCast: true, attack: true, aimX: 0, aimZ: 1 };
    w.step([inp]);
    expect(w.events.some((e) => e.t === 'skillCast' && e.skillId === p.skills[0]!.def.id)).toBe(true);
    expect(w.projectiles.count).toBeGreaterThan(0);
  });

  it('supports shaman bell cone basic attack into open air on Space/LMB', () => {
    const w = makeYeonmuWorld('shaman', 'b');
    const p = w.players[0]!;
    p.skills[0]!.cd = 0;
    const inp: PlayerInput = { moveX: 0, moveZ: 0, manualCast: true, attack: true };
    w.step([inp]);
    expect(w.events.some((e) => e.t === 'skillCast' && e.skillId === p.skills[0]!.def.id)).toBe(true);
  });

  it('castMask maps active skills and ultimates identically to the taskbar slot order', () => {
    const w = makeYeonmuWorld('warrior', 'a');
    const p = w.players[0]!;
    const ult = content.skills.find((s) => s.kind === 'ultimate');
    if (ult) addSkill(w, p, ult, 0);
    for (const s of p.skills) s.cd = 0;
    const ultBit = 1 + w.balance.maxActiveSkills;
    const inp: PlayerInput = { moveX: 0, moveZ: 0, manualCast: true, castMask: 1 << ultBit };
    w.step([inp]);
    if (ult) {
      expect(w.events.some((e) => e.t === 'skillCast' && e.skillId === ult.id)).toBe(true);
    }
  });

  it('manual basic attack strictly aims toward cursor direction instead of snapping to a closer enemy behind hero', () => {
    const w = makeYeonmuWorld('warrior', 'a');
    const p = w.players[0]!;
    for (const s of p.skills) s.cd = 0;
    // Place an enemy right behind the hero (-X), while cursor points strictly +X.
    const row = w.enemies.alloc();
    w.enemies.type[row] = 0;
    w.enemies.x[row] = p.x - 1.5;
    w.enemies.z[row] = p.z;
    w.enemies.hp[row] = 100;
    w.enemies.hpMax[row] = 100;
    w.enemies.radius[row] = 0.5;
    const inp: PlayerInput = { moveX: 0, moveZ: 0, manualCast: true, attack: true, aimX: 1, aimZ: 0 };
    w.step([inp]);
    const cast = w.events.find((e) => e.t === 'skillCast');
    expect(cast).toBeDefined();
    if (cast && cast.t === 'skillCast') {
      expect(cast.dirX).toBeCloseTo(1, 5);
      expect(cast.dirZ).toBeCloseTo(0, 5);
    }
    expect(Math.sin(p.rot)).toBeCloseTo(1, 3);
  });

  it('manual attack without pointer aim follows hero facing instead of auto-locking onto nearby enemies', () => {
    const w = makeYeonmuWorld('warrior', 'a');
    const p = w.players[0]!;
    for (const s of p.skills) s.cd = 0;
    p.rot = 0; // facing +Z
    const row = w.enemies.alloc();
    w.enemies.type[row] = 0;
    w.enemies.x[row] = p.x;
    w.enemies.z[row] = p.z - 1.5; // directly behind (-Z)
    w.enemies.hp[row] = 100;
    w.enemies.hpMax[row] = 100;
    w.enemies.radius[row] = 0.5;
    const inp: PlayerInput = { moveX: 0, moveZ: 0, manualCast: true, attack: true };
    w.step([inp]);
    const cast = w.events.find((e) => e.t === 'skillCast');
    expect(cast).toBeDefined();
    if (cast && cast.t === 'skillCast') {
      expect(cast.dirX).toBeCloseTo(0, 5);
      expect(cast.dirZ).toBeCloseTo(1, 5);
    }
  });
});
