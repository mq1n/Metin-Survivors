// DEV-only: face detail as a fine-resolution overlay mesh (eyes, brows, nose, mouth). The body mesher runs at ~3–4 cm,
// far too coarse for a readable face, so features are meshed separately at ~7 mm and concatenated into the same
// skinned geometry (all bound to `head`), keeping the "one skinned mesh" contract.
import type { BufferGeometry } from 'three';
import type { Landmarks } from './humanoid';
import { buildMesh } from './mesher';
import { Shape } from './sdf';
import type { Rig } from './rig';

export interface FaceStyle {
  iris: string;
  sclera?: string;
  brow: string;
  skin: string;
  lips?: string;
  /** 1 = natural, >1 stylised/creature eyes */
  eyeScale?: number;
  /** brow tilt: >0 angry, <0 sad */
  angry?: number;
  /** eyes are emissive-looking (bright iris, no sclera) */
  glow?: boolean;
  /** draw a mouth line (false for masked faces) */
  mouth?: boolean;
  /** facial hair / ear details */
  ears?: 'none' | 'human' | 'pointed';
  /** the lower face is covered by cloth of this colour (painted on the body by the caller; no nose/mouth here) */
  mask?: string;
  /** vertical eye offset (fraction of head height) */
  eyeY?: number;
  /** draw a nose bump (creature bodies model their own) */
  nose?: boolean;
}

export function faceOverlay(rig: Rig, L: Landmarks, style: FaceStyle, cell = 0.0075): BufferGeometry {
  const shape = new Shape();
  shape.minRadius = cell * 0.55;
  const head = rig.i('head');
  const jaw = rig.i('jaw');
  const [rx, ry, rz] = L.headR;
  const [hx, hy, hz] = L.head;
  const es = style.eyeScale ?? 1;
  const ang = style.angry ?? 0;
  const eyeY = hy + ry * (style.eyeY ?? 0.08);
  // head surface depth at (x, y) offsets
  const surf = (x: number, y: number): number => hz + rz * Math.sqrt(Math.max(0.02, 1 - (x / rx) ** 2 - ((y - hy) / ry) ** 2));

  for (const s of [1, -1]) {
    const ex = hx + s * rx * 0.43;
    const ez = surf(ex - hx, eyeY);
    const wEye = 0.17 * rx * es;
    const hEye = 0.105 * ry * es;
    if (!style.glow) {
      shape.ell(head, [ex, eyeY, ez - 0.004], [wEye, hEye, 0.05 * rz], { op: 'add', k: 0, color: style.sclera ?? '#f4efe6', rot: [0, 0, s * ang * 0.25] });
      shape.ell(head, [ex - s * wEye * 0.1, eyeY, ez + 0.002], [hEye * 0.85, hEye * 0.9, 0.035 * rz], { k: 0, color: style.iris, cw: 3 });
      shape.ell(head, [ex - s * wEye * 0.1, eyeY, ez + 0.006], [hEye * 0.42, hEye * 0.45, 0.03 * rz], { k: 0, color: '#0c0908', cw: 6 });
      shape.sph(head, [ex - s * wEye * 0.1 + hEye * 0.22, eyeY + hEye * 0.28, ez + 0.012], hEye * 0.18, { k: 0, color: '#ffffff', cw: 8 });
      // upper lid line
      shape.rc(head, [ex - s * wEye, eyeY + hEye * 0.55, ez - 0.002], [ex + s * wEye, eyeY + hEye * 0.7, ez - 0.002], hEye * 0.28, hEye * 0.28, { k: 0.002, color: '#24160f', cw: 5 });
    } else {
      shape.ell(head, [ex, eyeY, ez - 0.002], [wEye * 1.1, hEye * 1.05, 0.05 * rz], { k: 0, color: style.iris, rot: [0, 0, s * ang * 0.3] });
      shape.ell(head, [ex - s * wEye * 0.05, eyeY, ez + 0.004], [wEye * 0.35, hEye * 0.9, 0.04 * rz], { k: 0, color: '#150b06', cw: 5 });
    }
    // brow
    const by = eyeY + ry * 0.26;
    shape.rc(head, [hx + s * rx * 0.14, by - s * 0 + ry * ang * 0.04, surf(rx * 0.14, by) + 0.002], [hx + s * rx * 0.74, by - ry * ang * 0.07 + ry * 0.02, surf(rx * 0.74, by) + 0.002], ry * 0.032 * es, ry * 0.026 * es, {
      k: 0.004,
      color: style.brow,
      cw: 2,
    });
    if (style.ears && style.ears !== 'none') {
      const pointed = style.ears === 'pointed';
      shape.rc(head, [hx + s * rx * 0.95, hy + ry * 0.04, hz - rz * 0.08], [hx + s * (rx * (pointed ? 1.6 : 1.12)), hy + ry * (pointed ? 0.42 : 0.12), hz - rz * (pointed ? 0.3 : 0.1)], ry * 0.18, ry * (pointed ? 0.025 : 0.1), {
        k: 0.005,
        color: style.skin,
      });
    }
  }
  // nose (a masked face has none)
  const ny = hy - ry * 0.24;
  if (!style.mask && style.nose !== false) {
    shape.ell(head, [hx, ny, surf(0, ny) + 0.006], [rx * 0.075, ry * 0.15, rz * 0.08], { k: 0.006, color: style.skin });
    shape.ell(head, [hx, ny - ry * 0.12, surf(0, ny - ry * 0.12) + 0.008], [rx * 0.13, ry * 0.06, rz * 0.07], { k: 0.006, color: style.skin });
  }
  // mouth
  const my = hy - ry * 0.46;
  if (style.mouth !== false) {
    shape.rc(jaw, [hx - rx * 0.22, my, surf(rx * 0.22, my) - 0.002], [hx + rx * 0.22, my, surf(rx * 0.22, my) - 0.002], ry * 0.025, ry * 0.025, { k: 0.004, color: '#5a2420', cw: 3 });
    shape.ell(jaw, [hx, my - ry * 0.04, surf(0, my) + 0.002], [rx * 0.2, ry * 0.045, rz * 0.04], { k: 0.004, color: style.lips ?? '#b2685c', cw: 1 });
  }
  return buildMesh(shape, { cell, boneCount: rig.count, sigma: 0.01, tau: 0.004, seed: 3 }).geometry;
}
