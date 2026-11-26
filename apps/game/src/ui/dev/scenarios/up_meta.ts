// Gallery scenarios: the talent cap that Hard clears raise (MT-02, upgrade group A.meta-progress). Each state rebuilds the
// warrior of the lived-in gallery profile from the profile as it was when the first of these ran (so a state never stacks on
// the previous one) and loads it through the real `.msav` import path: the save is normalised with the cap derived from its
// own Hard clears, exactly as a reload would. `up-meta-reset` puts the original profile back for the scenarios that follow.
import type { ContentDB } from '../../../data/schema';
import { allocateTalent, exportMsav, talentCap, treeView, xpForPoints, type MetaService, type SaveData } from '../../../meta';
import { emptyZoneStats } from '../../../meta/save';
import type { GalleryCtx } from '../../gallery';
import { armoryClass, armoryDoctrine } from '../../screens/armory/state';
import { armoryTab, openView } from '../../view';
import type { Scenario } from '../scenarioKit';

export const order = 56;

interface CapState {
  /** zones cleared on Hard, in zone order (the cap is 40 + 2 per zone) */
  hard: number;
  /** the warrior's XP is worth this many points (above the cap it waits) */
  xpPoints: number;
  /** points spent, alternating between the two doctrine trees */
  spend: number;
}

const pristine = new WeakMap<MetaService, SaveData>();

function original(meta: MetaService): SaveData {
  let s = pristine.get(meta);
  if (!s) {
    s = structuredClone(meta.save);
    pristine.set(meta, s);
  }
  return s;
}

/** `base` with the warrior reshaped into `st`: Hard clears in the stats, XP, and a legal spread of spent points. */
export function capProfile(base: SaveData, content: ContentDB, st: CapState): SaveData {
  const save = structuredClone(base);
  content.zones.forEach((z, i) => {
    const entry = (save.stats.zones[z.id] ??= {});
    if (i < st.hard) {
      entry.normal = { ...emptyZoneStats(), runs: 4, clears: 2, bestScore: 410_000, bestTime: 880, bestLevel: 36 };
      entry.hard = { ...emptyZoneStats(), runs: 6, clears: 1, bestScore: 520_000, bestTime: 903, bestLevel: 41 };
    } else delete entry.hard;
  });
  const cs = save.classes.warrior;
  cs.talents = {};
  cs.xp = xpForPoints(st.xpPoints, 48) + 120;
  let cur = save;
  for (let n = 0; n < st.spend; n++) {
    const keys = n % 2 === 0 ? (['a', 'b'] as const) : (['b', 'a'] as const);
    let spent = false;
    for (const key of keys) {
      const node = treeView(content, cur.classes.warrior, 'warrior', key, talentCap(cur))?.nodes.find((x) => x.canAllocate);
      if (!node) continue;
      const r = allocateTalent(cur, content, 'warrior', key, node.node.id);
      if (r.ok) {
        cur = r.save;
        spent = true;
        break;
      }
    }
    if (!spent) break;
  }
  return cur;
}

function load(g: GalleryCtx, save: SaveData): void {
  // the device settings stay as they are (the import would apply the file's)
  void g.meta.importMsav(exportMsav({ ...save, settings: structuredClone(g.meta.save.settings) }));
}

const talentsWith = (id: string, label: string, st: CapState): Scenario => ({
  id,
  label,
  run: (g) => {
    g.store.setScreen('menu');
    openView('armory', 'talents');
    armoryTab.value = 'talents';
    armoryClass.value = 'warrior';
    armoryDoctrine.value = 'a';
    load(g, capProfile(original(g.meta), g.content, st));
  },
});

export const scenarios: Scenario[] = [
  talentsWith('up-meta-cap40', 'Talents · no Hard clear (cap 40, XP waiting above it)', { hard: 0, xpPoints: 46, spend: 40 }),
  talentsWith('up-meta-cap44', 'Talents · two zones cleared on Hard (cap 44, 2 to spend)', { hard: 2, xpPoints: 46, spend: 42 }),
  talentsWith('up-meta-cap48', 'Talents · every zone cleared on Hard (cap 48)', { hard: 4, xpPoints: 48, spend: 45 }),
  {
    id: 'up-meta-reset',
    label: 'Talents · back to the gallery profile',
    run: (g) => {
      g.store.setScreen('menu');
      load(g, original(g.meta));
    },
  },
];
