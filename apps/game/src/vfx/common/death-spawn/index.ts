// Enemy death + spawn feedback — common VFX target `death-spawn` (see ../README.md for the builder contract).
import type { CommonTarget } from '../types';
import { presets } from './presets';
import { specs } from './specs';
import { deathSpawnRoutes } from './route';

export const DEATH_SPAWN: CommonTarget = { id: 'death-spawn', presets: presets, specs: specs, routes: deathSpawnRoutes };
