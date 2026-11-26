// Enemy projectiles + muzzle flashes — common VFX target `enemy-projectiles` (see ../README.md for the builder contract).
import type { CommonTarget } from '../types';
import { presets } from './presets';
import { enemyProjectileRoutes } from './route';
import { specs } from './specs';

export const ENEMY_PROJECTILES: CommonTarget = { id: 'enemy-projectiles', presets: presets, specs: specs, routes: enemyProjectileRoutes };
