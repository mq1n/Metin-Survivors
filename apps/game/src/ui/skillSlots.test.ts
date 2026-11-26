// The skill slots of the HUD (QA PLAYREV-2): the basic attack and talent ultimates take no active slot, so the count and the slot rows
// of the taskbar / pause panel / level-up board follow the actives only and still list every skill the hero holds.
import { describe, expect, it } from 'vitest';
import type { HudSkillSlot } from '../sim/types';
import { skillBar, splitSkills, type SkillKindOf } from './skillSlots';

const slot = (id: string, basic = false): HudSkillSlot => ({ id, icon: `icon_${id}`, rank: 1, cooldown: 0, cdLeft: 0, basic, awakened: false });
const kindOf: SkillKindOf = (id) => (id.startsWith('ult') ? 'ultimate' : id.startsWith('basic') ? 'basic' : 'active');

const six = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'].map((id) => slot(id));

describe('splitSkills', () => {
  it('separates the basic attack, the actives and the ultimates', () => {
    const s = splitSkills([slot('basic1', true), slot('ult1'), ...six.slice(0, 2), slot('ult2')], kindOf);
    expect(s.basic.map((x) => x.id)).toEqual(['basic1']);
    expect(s.actives.map((x) => x.id)).toEqual(['a1', 'a2']);
    expect(s.ultimates.map((x) => x.id)).toEqual(['ult1', 'ult2']);
  });

  it('a hero with the basic attack and six actives holds six actives, not seven (the pause panel read 7/6)', () => {
    const s = splitSkills([slot('basic1', true), ...six], kindOf);
    expect(s.actives).toHaveLength(6);
  });

  it('no snapshot is an empty split', () => {
    expect(splitSkills(undefined, kindOf)).toEqual({ basic: [], actives: [], ultimates: [] });
  });
});

describe('skillBar', () => {
  it('lists the basic attack and all six actives: seven icons, none cut', () => {
    const bar = skillBar(splitSkills([slot('basic1', true), ...six], kindOf), 6);
    expect(bar.map((x) => x?.id)).toEqual(['basic1', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6']);
  });

  it('pads the actives with empty sockets up to the maximum and puts the ultimates after them', () => {
    const bar = skillBar(splitSkills([slot('basic1', true), slot('ult1'), slot('a1'), slot('a2')], kindOf), 6);
    expect(bar).toHaveLength(1 + 6 + 1);
    expect(bar.map((x) => x?.id ?? null)).toEqual(['basic1', 'a1', 'a2', null, null, null, null, 'ult1']);
  });

  it('a hero without a snapshot yet shows the empty sockets', () => {
    expect(skillBar(splitSkills(undefined, kindOf), 6)).toEqual([null, null, null, null, null, null]);
  });
});
