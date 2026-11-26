// Gallery scenarios: story popups (owner: B9 story): zone intro, boss intro, victory, defeat, metin lore.
import { inRun, type Scenario } from '../scenarioKit';

export const order = 110;

export const scenarios: Scenario[] = [
  {
    id: 'story',
    label: 'Story popup',
    run: (g) => {
      inRun(g, { t: 0 });
      g.store.setStory({ kind: 'zoneIntro', ref: g.content.zones[0]?.id ?? '' });
    },
  },
  {
    id: 'story-boss',
    label: 'Story · boss intro',
    run: (g) => {
      inRun(g, { t: 372, boss: true });
      g.store.setStory({ kind: 'bossIntro', ref: g.content.bosses[0]?.id ?? '' });
    },
  },
  {
    id: 'story-victory',
    label: 'Story · victory',
    run: (g) => {
      inRun(g, { t: 900 });
      g.store.setStory({ kind: 'victory', ref: g.content.zones[0]?.id ?? '' });
    },
  },
  {
    id: 'story-defeat',
    label: 'Story · defeat',
    run: (g) => {
      inRun(g, { t: 300 });
      g.store.setStory({ kind: 'defeat', ref: g.content.zones[1]?.id ?? '' });
    },
  },
  {
    id: 'story-metin',
    label: 'Story · metin lore',
    run: (g) => {
      inRun(g, { t: 241 });
      g.store.setStory({ kind: 'metin', ref: g.content.metins[3]?.id ?? '' });
    },
  },
];
