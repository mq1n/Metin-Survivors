// Metin stone fall, crash, corruption loops, awaken, break — common VFX target `metin` (see ../README.md for the builder contract).
import type { CommonTarget } from '../types';
import { presets } from './presets';
import { specs } from './specs';
import { metinRoutes } from './route';

export const METIN: CommonTarget = { id: 'metin', presets: presets, specs: specs, routes: metinRoutes };
