import type { OrcParams } from '../../archetypes/orc/index.ts';
import { blackOrc } from './black_orc.ts';
import { orcFighter } from './orc_fighter.ts';
import { orcGeneral } from './orc_general.ts';
import { orcLord } from './orc_lord.ts';
import { orcScout } from './orc_scout.ts';
import { orcSorcerer } from './orc_sorcerer.ts';

export function orcParams(): OrcParams[] {
  return [orcScout(), orcFighter(), orcSorcerer(), orcGeneral(), blackOrc(), orcLord()];
}
