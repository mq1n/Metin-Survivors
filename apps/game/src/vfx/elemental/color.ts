// Allocation-free colour helpers: our palettes are 0xRRGGBB ints (sRGB); three converts to the linear working space.
import { Color } from 'three';

/** Writes a 0xRRGGBB int into a uniform Color in place. */
export function putHex(target: Color, hex: number): Color {
  return target.setHex(hex);
}

/** Linear mix of two hex colours into `target` (sRGB-space mix, then converted). */
export function mixHexInto(target: Color, a: number, b: number, t: number): Color {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t), g = Math.round(ag + (bg - ag) * t), bl = Math.round(ab + (bb - ab) * t);
  return target.setHex((r << 16) | (g << 8) | bl);
}
