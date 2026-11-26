// HudSkillSlot.cdLeft: the countdown number of the HUD's quick slots, next to the fraction of the sweep.

import { describe, expect, it } from 'vitest';
import { hud } from '../hud';
import { clearEnemies, dropSkills, freezeSchedules, giveSkill, makeWorld } from './helpers';

describe('hud skill slots', () => {
  it('carry the seconds left on the cooldown with the fraction', () => {
    const w = makeWorld();
    freezeSchedules(w);
    clearEnemies(w);
    dropSkills(w);
    const s = giveSkill(w, 'bladewheel');
    s.fp.cooldown = 8;
    s.cd = 6;
    const slot = hud(w, 0).skills[0];
    expect(slot?.cdLeft).toBeCloseTo(6, 6);
    expect(slot?.cooldown).toBeCloseTo(0.75, 6);
  });

  it('say 0 when the skill is ready and for a permanent aura', () => {
    const w = makeWorld();
    freezeSchedules(w);
    clearEnemies(w);
    dropSkills(w);
    const ready = giveSkill(w, 'bladewheel');
    ready.fp.cooldown = 8;
    ready.cd = 0;
    const aura = giveSkill(w, 'fury_aura');
    aura.fp.cooldown = 8;
    aura.cd = 3;
    const skills = hud(w, 0).skills;
    expect(skills[0]?.cdLeft).toBe(0);
    expect(skills[1]?.cooldown).toBe(0);
    expect(skills[1]?.cdLeft).toBe(0);
  });
});
