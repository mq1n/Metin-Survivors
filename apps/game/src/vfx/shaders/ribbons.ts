// Camera-facing ribbons: trails, lightning, sword streaks. Geometry is written by the CPU (RibbonBatch);
// fade / taper over lifetime is evaluated per vertex from its birth time.
import { HERO_GUARD_GLSL } from '../heroGuard';
import { GLSL_COMMON } from './common';

export const RIBBON_VERT = /* glsl */ `
${GLSL_COMMON}
uniform float uTime;
attribute vec3 rDir;  // unit tangent
attribute vec4 rP;    // signed half width, uAlong, birth, life
attribute vec4 rQ;    // intensity, style, fadeCode, seed
attribute vec4 rCol;

varying vec4 vC;
varying vec4 vR;  // v across (-1..1), uAlong, age01, seed
varying float vStyle;

void main(){
  float t = uTime - rP.z;
  float u = t / rP.w;
  if (t < 0.0 || u >= 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vC = vec4(0.0); vR = vec4(0.0); vStyle = 0.0;
    return;
  }
  int style = int(rQ.y + 0.5);
  int fcode = int(rQ.z + 0.5);
  vec3 toCam = cameraPosition - position;
  vec3 side = cross(rDir, toCam);
  float sl = length(side);
  side = sl > 0.00001 ? side / sl : vec3(1.0, 0.0, 0.0);
  float taper = style == 0 ? (1.0 - 0.75 * u) : 1.0;
  float hw = rP.x * taper;
  vec3 wp = position + side * hw;
  float env = smoothstep(0.0, 0.03, u) * fadeOutCurve(fcode, u);
  vC = vec4(srgb2lin(rCol.rgb) * rQ.x, rCol.a * env);
  vR = vec4(rP.x >= 0.0 ? 1.0 : -1.0, rP.y, u, rQ.w);
  vStyle = float(style);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

export const RIBBON_FRAG = /* glsl */ `
${GLSL_COMMON}
${HERO_GUARD_GLSL}
uniform sampler2D uNoise;
uniform float uTime;
varying vec4 vC;
varying vec4 vR;
varying float vStyle;

void main(){
  float x = abs(vR.x);
  int style = int(vStyle + 0.5);
  float a;
  vec3 rgb = vC.rgb;
  if (style == 1) { // lightning: hot thin core + halo, flicker
    float core = exp(-x * x * 14.0);
    float halo = exp(-x * x * 2.6);
    float fl = 0.75 + 0.25 * sin(uTime * 90.0 + vR.w * 40.0 + vR.y * 9.0);
    a = (core + halo * 0.45) * fl;
    rgb = mix(rgb, vec3(1.0, 1.0, 1.0) * dot(rgb, vec3(0.333)) * 1.6 + rgb * 0.4, core * 0.85);
  } else if (style == 2) { // sword streak: crisp edge, fades along length
    float edge = smoothstep(1.0, 0.7, x);
    a = edge * pw(1.0 - clamp(vR.y, 0.0, 1.0), 1.2);
    rgb = mix(rgb, vec3(1.0) * dot(rgb, vec3(0.333)) * 1.5, pw(1.0 - vR.y, 4.0) * 0.6);
  } else if (style == 3) { // energy rope with scrolling noise
    float n = texture2D(uNoise, vec2(vR.y * 3.0 - uTime * 1.6 + vR.w, x * 0.8)).r;
    float core = exp(-x * x * 7.0);
    a = core * (0.55 + 0.9 * n);
  } else { // soft trail
    float s = 1.0 - x * x;
    a = s * s;
    rgb = mix(rgb, rgb * 1.25, pw(1.0 - clamp(vR.y, 0.0, 1.0), 2.0));
  }
  a *= vC.a;
  if (a < 0.002) discard;
  gl_FragColor = vec4(rgb * a, a) * heroGuardFade();
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
