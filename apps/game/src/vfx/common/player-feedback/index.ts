// Player-side feedback: hit, evade, shield, aura ring, dash, summons — common VFX target `player-feedback` (see ../README.md for the builder contract).
import type { CommonTarget } from '../types';
import { presets } from './presets';
import { SELF_SPECS } from './specs_self';
import { playerFeedbackRoutes } from './route';

export const PLAYER_FEEDBACK: CommonTarget = { id: 'player-feedback', presets: presets, specs: SELF_SPECS, routes: playerFeedbackRoutes };
