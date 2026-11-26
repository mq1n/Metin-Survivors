// Shared look of the Silver Vow family: palette, skin, face presets.
import type { FaceParams } from '../../../archetypes/humanoid/index.ts';

export const OATH_SKIN = { base: '#d4a984', shade: '#a97c5a', lip: '#a65a4a', eye: '#2a1a10', brow: '#1c1410' };

export const OATH_PALETTE = {
  cloth: '#e8e1d2', cloth2: '#cdc4b0', sash: '#b3302a', leather: '#6a4a2e', leather2: '#47321f', leather3: '#8a6a42',
  plate: '#6d737a', plateHi: '#d3d6da', lacquer: '#2b2428', lacquer2: '#7a1f1a', gold: '#c9a24a', trim: '#b3302a', bone: '#d9d0b8',
};

export const OATH_FACE: FaceParams = { jaw: 0.55, brow: 0.5, nose: 0.5, lips: 0.4, eyes: 0.95, cheeks: 0.5, slant: 0.18, ears: 1 };
