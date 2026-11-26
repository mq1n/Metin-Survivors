// Gallery scenarios: main menu + credits (owner: B2 main-menu).
import { openView } from '../../view';
import type { Scenario } from '../scenarioKit';

export const order = 20;

export const scenarios: Scenario[] = [
  { id: 'menu', label: 'Main menu', run: (g) => g.store.setScreen('menu') },
  {
    id: 'credits',
    label: 'Credits',
    run: (g) => {
      g.store.setScreen('menu');
      openView('credits');
    },
  },
];
