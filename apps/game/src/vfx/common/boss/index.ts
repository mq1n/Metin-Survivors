// Boss spawn, phase, enrage, death, slam, nova, volley, teleport, summon, charge — common VFX target `boss` (see ../README.md for the builder contract).
import type { CommonTarget } from '../types';
import { presets } from './presets';
import { bossRoutes } from './route';
import { specs } from './specs';

export const BOSS: CommonTarget = { id: 'boss', presets: presets, specs: specs, routes: bossRoutes };
