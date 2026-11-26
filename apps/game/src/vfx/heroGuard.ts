// Hero guard: keeps the local hero readable under VFX. Every VFX material multiplies its final colour (rgb and alpha;
// premultiplied/additive output is scaled as a whole) by `heroGuardFade()`, which drops towards `uHeroGuardFloor`
// inside a screen ellipse fitted to the hero's body. RenderWorld updates the uniforms once per frame from the projected
// hero; with no hero (menus, demos) the ellipse has zero size and the fade is 1 everywhere.
import { Vector4, type IUniform } from 'three';

export interface HeroGuardUniforms {
  /** xy: hero body centre in drawing-buffer px (gl_FragCoord space), zw: ellipse half-axes in px (0 = off) */
  uHeroGuard: IUniform<Vector4>;
  /** fade at the ellipse centre (0..1) */
  uHeroGuardFloor: IUniform<number>;
  [name: string]: IUniform;
}

/** Shared by every VFX material: spread into the material's uniforms (same objects, no copies). */
export const heroGuardUniforms: HeroGuardUniforms = {
  uHeroGuard: { value: new Vector4(0, 0, 0, 0) },
  uHeroGuardFloor: { value: 0.35 },
};

/** Fragment-shader snippet: declares the uniforms and `float heroGuardFade()`. Include once, before `main`. */
export const HERO_GUARD_GLSL = /* glsl */ `
uniform vec4 uHeroGuard;
uniform float uHeroGuardFloor;
float heroGuardFade() {
  if (uHeroGuard.z <= 0.0) return 1.0;
  vec2 d = (gl_FragCoord.xy - uHeroGuard.xy) / uHeroGuard.zw;
  return mix(uHeroGuardFloor, 1.0, smoothstep(0.45, 1.0, length(d)));
}
`;

/** Sets the guard ellipse (drawing-buffer px). `halfW`/`halfH` 0 disables it. */
export function setHeroGuard(cx: number, cy: number, halfW: number, halfH: number): void {
  heroGuardUniforms.uHeroGuard.value.set(cx, cy, halfW, halfH);
}
