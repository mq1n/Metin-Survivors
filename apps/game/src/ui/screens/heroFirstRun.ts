// Recommended first hero (HD-02, upgrade group A.hud): while a profile has never played a run, the hero select marks one class as the
// forgiving pick for a newcomer (a badge on its card, a line on its record plate). The pick is the Shaman: in the balance campaigns
// (R5) it cleared all four normal zones fastest (6-10 runs against 7-32+ for the other heroes), and it fights from range with a heal and
// buffs of its own. Pure and tiny so a test can pin the rule without mounting the screen.
import type { ClassId } from '../../data/schema';
import type { SaveData } from '../../meta';

/** the class recommended to a profile with no runs */
export const FIRST_RUN_HERO: ClassId = 'shaman';

/**
 * The class to recommend on this profile, or null: the profile has played a run (the total or any one class), or the content has no
 * such class (a QA override that removes it must not leave a badge pointing at nothing).
 */
export function firstRunHero(save: Pick<SaveData, 'stats'>, classes: readonly { id: ClassId }[]): ClassId | null {
  const { runs, classes: per } = save.stats;
  if (runs > 0) return null;
  for (const c of Object.values(per)) if (c.runs > 0) return null;
  return classes.some((c) => c.id === FIRST_RUN_HERO) ? FIRST_RUN_HERO : null;
}
