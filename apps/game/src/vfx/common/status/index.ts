// Status / DoT feedback (stun, slow, poison, burn loops, DoT ticks) — common VFX target `status` (see ../README.md for the builder contract).
import type { CommonTarget } from '../types';
import { presets } from './presets';
import { specs } from './specs';
import { statusRoutes } from './route';

export const STATUS: CommonTarget = { id: 'status', presets: presets, specs: specs, routes: statusRoutes };
