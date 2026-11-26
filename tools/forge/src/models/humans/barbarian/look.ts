// Barbarian look: palette, skin, face. The albedo stays mid-value (the game multiplies it by a per-instance tint #a89880 / #b08868 / #c09870),
// with clear value + hue separation between the families: ruddy tan skin, near-black pelt, light tan pelt, ivory bone, mid leather, dark
// ironwood club, dark iron, rust cloth, woad-blue war paint.
import type { FaceParams } from '../../../archetypes/humanoid/index.ts';

export const BARB_SKIN = { base: '#c98e66', shade: '#a06848', lip: '#8e4a3c', eye: '#c9a13a', brow: '#241812', mark: '#35557a' };

export const BARB_PALETTE = {
  leather: '#74492f', leather2: '#3c2a1d', leather3: '#3f2c1c',
  pelt: '#3d2d21', pelt2: '#8b6e4b',
  bone: '#ece2c6', horn: '#d6c9a5',
  plate: '#4b5059', plateHi: '#b9bec6',
  hair: '#5b4329', cloth: '#8a3c2c', gold: '#b8923e',
};

/** heavy brow, square jaw, flat broad nose, narrow slanted eyes: a glowering brute */
export const BARB_FACE: FaceParams = { jaw: 0.95, brow: 1.0, nose: 0.78, lips: 0.45, eyes: 0.82, cheeks: 0.85, slant: 0.28, ears: 1.1 };
