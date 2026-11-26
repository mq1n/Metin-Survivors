// Gallery scenarios: kit v1 specimen pages (owner: UI core lane B). Every kit component in every state, rendered by
// ui/dev/kitSpecimen.tsx over an empty run screen. Shots: 1920x1080 en, 1366x768, 390x844 dpr3, 844x390 dpr2.
import { mountKitSpecimen, type KitPage } from '../kitSpecimen';
import type { Scenario } from '../scenarioKit';

export const order = 990;

const page = (id: string, label: string, kp: KitPage): Scenario => ({
  id,
  label,
  run: (g) => {
    g.store.setScreen('run');
    mountKitSpecimen(g, kp);
  },
});

export const scenarios: Scenario[] = [
  page('kit', 'Kit · boards, title bars', 'boards'),
  page('kit-buttons', 'Kit · plates, tabs, controls', 'buttons'),
  page('kit-slots', 'Kit · slots, wells, chips, medals', 'slots'),
  page('kit-gauges', 'Kit · gauges', 'gauges'),
  page('kit-tips', 'Kit · tooltips', 'tips'),
  page('kit-type', 'Kit · type scale', 'type'),
];
