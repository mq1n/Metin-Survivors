// Gallery scenarios: zone select (owner: B4 zone-select). Variants: the locked / hard-locked / hard-mode zone states and
// a fully maxed Custom run (reward capped).
import type { Difficulty } from '../../../data/schema';
import type { Scenario } from '../scenarioKit';

export const order = 40;

const zone = (id: string, label: string, zoneId: string, difficulty: Difficulty, runOptions?: { density: number; health: number; damage: number; speed: number }): Scenario => ({
  id,
  label,
  run: (g) => {
    g.store.select({ zone: zoneId, difficulty, ...(runOptions ? { runOptions } : {}) });
    g.store.setScreen('zoneSelect');
  },
});

export const scenarios: Scenario[] = [
  zone('zoneSelect', 'Zone select', 'yeonmu', 'normal', { density: 1, health: 1, damage: 1, speed: 1 }),
  zone('zoneSelect-locked', 'Zone select · locked zone', 'daeryeol', 'normal'),
  zone('zoneSelect-hardlocked', 'Zone select · Hard locked (Seori)', 'seori', 'hard'),
  zone('zoneSelect-hard', 'Zone select · Hard + custom run', 'suryeon', 'hard', { density: 2, health: 1.5, damage: 1.25, speed: 1.25 }),
  zone('zoneSelect-maxopts', 'Zone select · maxed custom run', 'yeonmu', 'hard', { density: 3, health: 3, damage: 3, speed: 3 }),
];
