import type { HumanoidParams } from '../../archetypes/humanoid/index.ts';
import { wolfmanParams } from './wolfman.ts';
import { ninjaParams } from './ninja.ts';
import { shamanParams } from './shaman.ts';
import { yachaParams } from './yacha.ts';
import { warriorParams } from './warrior.ts';

export function heroParams(): HumanoidParams[] {
  return [...warriorParams(), ...ninjaParams(), ...yachaParams(), ...shamanParams(), ...wolfmanParams()];
}
