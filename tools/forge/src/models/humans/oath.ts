// Silver Vow family: foot soldier, archer, captain, mage-captain (one file per model in ./oath/, shared look in ./oath/common.ts).
import type { HumanModel } from '../../archetypes/humans/rigx.ts';
import { archer } from './oath/archer.ts';
import { captain } from './oath/captain.ts';
import { leader } from './oath/leader.ts';
import { soldier } from './oath/soldier.ts';

export const models: HumanModel[] = [soldier, archer, captain, leader];
