// Barbarian family (bestial soldiers / maniacs / archers / specialists share one model): see ./barbarian/barbarian.ts.
import type { HumanModel } from '../../archetypes/humans/rigx.ts';
import { barbarian } from './barbarian/barbarian.ts';

export const models: HumanModel[] = [barbarian];
