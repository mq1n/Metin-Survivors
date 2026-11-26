// Phone-tier specimen (C8, UI core lane C). Shoot it at 1920x1080, 1366x768, 390x844 dpr3 touch, 844x390 dpr2 touch:

// The broader kit specimen (board, buttons, slots, gauges …) is ./kit.ts (lane B); this module only covers C8.
import type { Scenario } from '../scenarioKit';
import { showKitPhone } from '../KitPhone';

export const order = 5;

export const scenarios: Scenario[] = [{ id: 'kit-phone', label: 'Kit · phone tier (C8)', run: (g) => showKitPhone(g) }];
