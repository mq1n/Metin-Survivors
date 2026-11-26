// GPU-analytic particles. The CPU writes one record per particle at spawn time; position, size, colour and
// fade are evaluated analytically from (uTime - birth) in the vertex shader, so steady state costs no CPU.
import { HERO_GUARD_GLSL } from '../heroGuard';
import { GLSL_ART, GLSL_ART_SAMPLE, GLSL_ATLAS, GLSL_COMMON } from './common';

export const PARTICLE_VERT = /* glsl */ `
${GLSL_COMMON}
${GLSL_ART}
uniform float uTime;
attribute vec4 aA; // p0.xyz, birth
attribute vec4 aB; // v.xyz, life
attribute vec4 aC; // size0, size1, rot0, spin
attribute vec4 aD; // gravity, drag, stretch, intensity
attribute vec4 aE; // floorY, cell, flags, wobble
attribute vec4 aCol0;
attribute vec4 aCol1;

varying vec2 vQ;
varying vec4 vC0;
varying vec4 vC1;
varying vec4 vCell;
varying float vViewZ;
varying vec4 vArtA;  // generated-art rect of the (first) frame; vArtL < 0 = procedural atlas cell
varying vec4 vArtB;
varying float vArtL;

void main(){
  float t = uTime - aA.w;
  float life = aB.w;
  float u = t / life;
  if (t < 0.0 || u >= 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vQ = vec2(0.0); vC0 = vec4(0.0); vC1 = vec4(0.0); vCell = vec4(0.0); vViewZ = 0.0;
    vArtA = vec4(0.0); vArtB = vec4(0.0); vArtL = -1.0;
    return;
  }
  int f = int(aE.z + 0.5);
  int mode = f & 3;
  int frames = (f >> 2) & 63;
  int fin = (f >> 8) & 7;
  int fout = (f >> 11) & 7;
  int scurve = (f >> 14) & 3;
  bool ramp = ((f >> 16) & 1) == 1;
  bool twinkle = ((f >> 17) & 1) == 1;

  float d = aD.y;
  float A; float B; float e2 = 1.0;
  if (d > 0.001) { e2 = exp(-d * t); A = (1.0 - e2) / d; B = (t - A) / d; }
  else { A = t; B = 0.5 * t * t; }
  vec3 p = aA.xyz + aB.xyz * A + vec3(0.0, aD.x * B, 0.0);
  vec3 vel = aB.xyz * e2 + vec3(0.0, aD.x * A, 0.0);
  if (aE.x > -999.0) p.y = max(p.y, aE.x);
  if (aE.w != 0.0) {
    float ph = aC.z * 6.2831853;
    p += aE.w * min(t * 1.5, 1.0) * vec3(sin(t * 2.3 + ph), 0.6 * sin(t * 3.1 + ph * 1.7), cos(t * 1.9 + ph * 0.6));
  }

  float cu = u;
  if (scurve == 1) cu = 1.0 - (1.0 - u) * (1.0 - u);
  else if (scurve == 2) cu = u * u;
  float sz = (scurve == 3) ? mix(aC.x, aC.y, sin(PI * u)) : mix(aC.x, aC.y, cu);

  float mixF = pw(u, 0.75);
  float env = smoothstep(0.0, fadeInTime(fin), u) * fadeOutCurve(fout, u);
  float tw = twinkle ? (0.55 + 0.45 * sin(t * 37.0 + aC.z * 91.0)) : 1.0;
  float alpha = mix(aCol0.a, aCol1.a, mixF) * env * tw;
  vC0 = vec4(srgb2lin(aCol0.rgb) * aD.w, alpha);
  vC1 = vec4(srgb2lin(aCol1.rgb) * aD.w, mixF);

  float cellA = aE.y;
  float cellB = aE.y;
  float blend = 0.0;
  if (frames > 1) {
    float fr = min(u * float(frames), float(frames) - 0.001);
    float fi = floor(fr);
    cellA = aE.y + fi;
    cellB = aE.y + min(fi + 1.0, float(frames - 1));
    blend = fract(fr);
  }
  vCell = vec4(cellA, cellB, blend, ramp ? 1.0 : 0.0);
  vArtA = vec4(0.0); vArtB = vec4(0.0); vArtL = -1.0;
  if (aE.y > 65535.5) {
    // packed generated-art role: its own frame count (the flag's frames are for procedural flipbooks)
    float nf = artFrames(aE.y);
    float fa = 0.0; float fb = 0.0; float bl = 0.0;
    if (nf > 1.0) {
      float fr = min(u * nf, nf - 0.001);
      fa = floor(fr);
      fb = min(fa + 1.0, nf - 1.0);
      bl = fract(fr);
    }
    vArtA = artRect(aE.y, fa);
    vArtB = artRect(aE.y, fb);
    vArtL = artLayer(aE.y);
    vCell = vec4(0.0, 0.0, bl, 0.0);
  }

  vec2 q = position.xy;
  vQ = q + 0.5;
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float rot = aC.z + aC.w * t;
  float c = cos(rot);
  float s = sin(rot);
  vec2 r = vec2(q.x * c - q.y * s, q.x * s + q.y * c);
  vec3 wp;
  float bias = 1.0;
  if (mode == 0) {
    wp = p + (camRight * r.x + camUp * r.y) * sz;
  } else if (mode == 1) {
    float spd = length(vel);
    vec3 axis = spd > 0.001 ? vel / spd : vec3(0.0, 1.0, 0.0);
    vec3 toCam = normalize(cameraPosition - p);
    vec3 side = cross(axis, toCam);
    float sl = length(side);
    side = sl > 0.0001 ? side / sl : camRight;
    float len = sz + spd * aD.z;
    wp = p + axis * ((q.x + 0.5) - 0.9) * len + side * q.y * sz;
  } else if (mode == 2) {
    wp = p + vec3(r.x, 0.0, r.y) * sz;
    bias = 0.0;
  } else {
    vec3 rg = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]));
    float asp = aD.z > 0.0 ? aD.z : 1.0;
    wp = p + rg * q.x * sz + vec3(0.0, (q.y + 0.5) * sz * asp, 0.0);
  }
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  mv.z += bias * min(sz, 3.0) * 0.3;
  vViewZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

export const PARTICLE_FRAG = /* glsl */ `
${GLSL_COMMON}
${GLSL_ATLAS}
${GLSL_ART_SAMPLE}
${HERO_GUARD_GLSL}
uniform sampler2D uAtlas;
uniform sampler2D uDepth;
uniform vec2 uInvRes;
uniform vec2 uNearFar;
uniform float uSoft;
varying vec2 vQ;
varying vec4 vC0;
varying vec4 vC1;
varying vec4 vCell;
varying float vViewZ;
varying vec4 vArtA;
varying vec4 vArtB;
varying float vArtL;

void main(){
  // derivatives outside any branch (uniform control flow); the art sample scales them to its own cell
  vec2 gx = dFdx(vQ);
  vec2 gy = dFdy(vQ);
  vec4 tex;
  if (vArtL > -0.5) {
    tex = artTex(vArtA, vArtL, vQ, gx, gy);
    if (vCell.z > 0.001) tex = mix(tex, artTex(vArtB, vArtL, vQ, gx, gy), vCell.z);
  } else {
    tex = texture2D(uAtlas, atlasUV(vCell.x, vQ));
    if (vCell.z > 0.001) tex = mix(tex, texture2D(uAtlas, atlasUV(vCell.y, vQ)), vCell.z);
  }
  float a = tex.a * vC0.a;
  vec3 rgb;
  if (vCell.w > 0.5) {
    float heat = clamp(tex.r / max(tex.a, 0.03) * 1.15 - vC1.a * 0.9, 0.0, 1.0);
    rgb = (mix(vC1.rgb, vC0.rgb, heat) + mix(vC0.rgb, vec3(1.0), 0.55) * pw(heat, 5.0) * 0.45) * a;
  } else {
    rgb = tex.rgb * mix(vC0.rgb, vC1.rgb, vC1.a) * vC0.a;
  }
  if (uSoft > 0.5) {
    float sd = texture2D(uDepth, gl_FragCoord.xy * uInvRes).x;
    float n = uNearFar.x, fa = uNearFar.y;
    float lin = 2.0 * n * fa / (fa + n - (sd * 2.0 - 1.0) * (fa - n));
    float k = clamp((lin - vViewZ) / 0.7, 0.0, 1.0);
    rgb *= k; a *= k;
  }
  if (a < 0.0015 && max(rgb.r, max(rgb.g, rgb.b)) < 0.0015) discard;
  gl_FragColor = vec4(rgb, a) * heroGuardFade();
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
