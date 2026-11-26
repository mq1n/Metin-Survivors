// Dormant `telegraph.*` presets (the live telegraphs are render/fx/telegraphs.ts decals) — common VFX target `telegraphs` (see ../README.md for the builder contract).
import type { CommonTarget } from '../types';
import { presets } from './presets';
import { telegraphRoutes } from './route';

export const TELEGRAPHS: CommonTarget = { id: 'telegraphs', presets: presets, specs: [], routes: telegraphRoutes };
