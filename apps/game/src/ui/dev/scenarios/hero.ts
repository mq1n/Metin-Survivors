// Gallery scenarios: hero select (owner: B3 hero-select). Variants: a male-only class, a doctrine-B shaman, a class-colour
// sweep (ninja / yacha / warrior at the Jihae and Chowon kingdoms) for the stage rim light and the flag selection states.
import type { ClassId, DoctrineKey, EmpireId, Sex } from '../../../data/schema';
import type { Scenario } from '../scenarioKit';

export const order = 30;

const hero = (id: string, label: string, classId: ClassId, doctrine: DoctrineKey, sex: Sex, empire: EmpireId): Scenario => ({
  id,
  label,
  run: (g) => {
    g.store.select({ classId, doctrine, sex, empire });
    g.store.setScreen('heroSelect');
  },
});

export const scenarios: Scenario[] = [
  { id: 'heroSelect', label: 'Hero select', run: (g) => g.store.setScreen('heroSelect') },
  hero('heroSelect-wolfman', 'Hero select · Wolfman (male only, last class: next blade grey)', 'wolfman', 'b', 'm', 'jihae'),
  hero('heroSelect-shaman', 'Hero select · Shaman B (female)', 'shaman', 'b', 'f', 'chowon'),
  hero('heroSelect-ninja', 'Hero select · Ninja A (Jihae)', 'ninja', 'a', 'f', 'jihae'),
  hero('heroSelect-yacha', 'Hero select · Yacha B (Chowon)', 'yacha', 'b', 'm', 'chowon'),
];
