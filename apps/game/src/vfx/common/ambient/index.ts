// Ambient zone particles, foot dust, enemy charge / leap dust — common VFX target `ambient` (see ../README.md for the builder contract).
import type { CommonTarget } from '../types';
import { presets } from './presets';
import { specs } from './specs';
import { ambientRoutes } from './route';

export const AMBIENT: CommonTarget = { id: 'ambient', presets: presets, specs: specs, routes: ambientRoutes };
