// Instanced tumbling shards (stone chips, ice shards, metin crystal fragments). Ballistic motion with one bounce is
// evaluated analytically per vertex; shading is a fixed three-light fake so the batch is a single draw call.
import { GLSL_COMMON } from './common';

export const DEBRIS_VERT = /* glsl */ `
${GLSL_COMMON}
uniform float uTime;
attribute vec4 dA; // p0.xyz, birth
attribute vec4 dB; // v.xyz, life
attribute vec4 dC; // seed, spin rate, size, floorY
attribute vec4 dD; // gravity, restitution, emissive, aspect
attribute vec4 dCol0;
attribute vec4 dCol1;

varying vec3 vN;
varying vec3 vCol;
varying float vEm;
varying float vFres;

vec3 rodrigues(vec3 v, vec3 k, float ang){
  float c = cos(ang), s = sin(ang);
  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}

void main(){
  float t = uTime - dA.w;
  float life = dB.w;
  float u = t / life;
  if (t < 0.0 || u >= 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vN = vec3(0.0, 1.0, 0.0); vCol = vec3(0.0); vEm = 0.0; vFres = 0.0;
    return;
  }
  float g = dD.x;
  float fl = dC.w;
  vec3 p0 = dA.xyz;
  vec3 v0 = dB.xyz;
  float disc = v0.y * v0.y - 2.0 * g * (p0.y - fl);
  float tl = (-v0.y - sqrt(max(disc, 0.0))) / g;
  vec3 pos;
  float spinT = t;
  if (t < tl) {
    pos = p0 + v0 * t + vec3(0.0, 0.5 * g * t * t, 0.0);
  } else {
    vec3 land = p0 + v0 * tl + vec3(0.0, 0.5 * g * tl * tl, 0.0);
    float vy1 = -(v0.y + g * tl) * dD.y;
    vec3 vh = vec3(v0.x, 0.0, v0.z) * 0.55;
    float tb = vy1 > 0.2 ? 2.0 * vy1 / (-g) : 0.0;
    float tt = t - tl;
    if (tt < tb) {
      pos = land + vh * tt + vec3(0.0, vy1 * tt + 0.5 * g * tt * tt, 0.0);
      pos.y = max(pos.y, fl);
    } else {
      vec3 land2 = land + vh * tb;
      float ts = tt - tb;
      pos = land2 + vh * (1.0 - exp(-5.0 * ts)) / 5.0 * 0.45;
      pos.y = fl;
      spinT = tl + tb;
    }
  }
  float shrink = 1.0 - smoothstep(0.72, 1.0, u);
  float size = dC.z * shrink;
  float h1 = hash11(dC.x * 91.7), h2 = hash11(dC.x * 37.3 + 1.0), h3 = hash11(dC.x * 11.9 + 2.0);
  vec3 axis = normalize(vec3(h1 - 0.5, h2 - 0.2, h3 - 0.5));
  float ang = dC.y * spinT + h1 * 6.28;
  vec3 sc = vec3(0.6 + h1 * 0.8, (0.7 + h2 * 0.9) * dD.w, 0.6 + h3 * 0.8);
  vec3 lp = rodrigues(position * sc, axis, ang) * size;
  vec3 n = rodrigues(normalize(normal / sc), axis, ang);
  vec3 wp = pos + lp;
  vN = n;
  float mixF = u;
  vCol = mix(srgb2lin(dCol0.rgb), srgb2lin(dCol1.rgb), mixF);
  vEm = dD.z;
  vFres = pw(1.0 - clamp(abs(dot(n, normalize(cameraPosition - wp))), 0.0, 1.0), 2.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

export const DEBRIS_FRAG = /* glsl */ `
varying vec3 vN;
varying vec3 vCol;
varying float vEm;
varying float vFres;
void main(){
  vec3 n = normalize(vN);
  vec3 L1 = normalize(vec3(0.45, 0.85, 0.3));
  vec3 L2 = normalize(vec3(-0.6, 0.25, -0.5));
  float d1 = max(dot(n, L1), 0.0);
  float d2 = max(dot(n, L2), 0.0);
  vec3 lit = vCol * (0.28 + d1 * 1.05 + d2 * 0.25);
  lit += vCol * vEm * (0.6 + 0.8 * vFres) + vec3(1.0) * vFres * 0.12;
  gl_FragColor = vec4(lit, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const FLASH_VERT = /* glsl */ `
void main(){ gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }
`;
export const FLASH_FRAG = /* glsl */ `
uniform vec4 uColor;
void main(){
  gl_FragColor = uColor;
}
`;
