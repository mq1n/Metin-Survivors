// Pickup + chest feedback — common VFX target `pickups` (see ../README.md for the builder contract).
import type { CommonTarget } from '../types';
import { presets } from './presets';
import { pickupRoutes } from './route';
import { specs } from './specs';

export const PICKUPS: CommonTarget = { id: 'pickups', presets: presets, specs: specs, routes: pickupRoutes };
