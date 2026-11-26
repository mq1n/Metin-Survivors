// Self feedback: level-up, skill-up, potions, heals, buffs, revive, death — common VFX target `levelup-heal` (see ../README.md for the builder contract).
import type { CommonTarget } from '../types';
import { presets } from './presets';
import { specs } from './specs';
import { levelupHealRoutes } from './route';

export const LEVELUP_HEAL: CommonTarget = { id: 'levelup-heal', presets: presets, specs: specs, routes: levelupHealRoutes };
