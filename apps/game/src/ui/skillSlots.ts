// Which of the hero's skills fill the build slots. The hero holds its class basic attack, up to `balance.maxActiveSkills` card-acquired
// actives and any talent ultimates; the sim counts only the actives against the maximum (sim/cards.ts activeSlotCount: basic and ultimate
// do not take a slot), and so must every number and slot row the UI draws (QA PLAYREV-2: the pause panel read "7/6", the sixth active
// skill had no slot on the taskbar, the pause panel or the level-up board). Pure: `kindOf` is injected so the rule is unit-tested in node.
import type { SkillDef } from '../data/schema';
import type { HudSkillSlot } from '../sim/types';
import { indexOf } from './content';

export interface SkillSplit {
  /** the class basic attack (always first in the snapshot) */
  basic: HudSkillSlot[];
  /** card-acquired actives: the only skills that take one of the `maxActiveSkills` slots */
  actives: HudSkillSlot[];
  /** talent-milestone ultimates: a free slot of their own */
  ultimates: HudSkillSlot[];
}

export type SkillKindOf = (id: string) => SkillDef['kind'] | undefined;

/** The kind of a skill from the content the UI runs on (a co-op guest's mirror carries no `ultimate` flag, the content always knows). */
export const contentKindOf: SkillKindOf = (id) => indexOf().skills.get(id)?.kind;

export function splitSkills(skills: readonly HudSkillSlot[] | undefined, kindOf: SkillKindOf): SkillSplit {
  const out: SkillSplit = { basic: [], actives: [], ultimates: [] };
  for (const s of skills ?? []) {
    if (s.basic) out.basic.push(s);
    else if (kindOf(s.id) === 'ultimate') out.ultimates.push(s);
    else out.actives.push(s);
  }
  return out;
}

/** Every skill the hero holds in bar order: the basic, then the actives padded with `null` (an empty socket) up to `max`, then the ultimates. */
export function skillBar(split: SkillSplit, max: number): (HudSkillSlot | null)[] {
  const actives: (HudSkillSlot | null)[] = [...split.actives];
  while (actives.length < max) actives.push(null);
  return [...split.basic, ...actives, ...split.ultimates];
}
