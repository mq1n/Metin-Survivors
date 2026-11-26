// Hit feedback (element hits, crit) — common VFX target `hits` (see ../README.md for the builder contract).
import type { CommonTarget } from '../types';
import { presets } from './presets';
import { specs } from './specs';
import { hitRoutes } from './route';

export const HITS: CommonTarget = { id: 'hits', presets: presets, specs: specs, routes: hitRoutes };
