// Shared GLSL snippets. All shaders are authored in GLSL ES 3.00 style via three's ShaderMaterial prefixes
// (attribute/varying/texture2D are mapped by three), so they compile on WebGL2 only (project requirement).

export const GLSL_COMMON = /* glsl */ `
// NaN-safe pow: interpolated inputs can land a hair below 0 and a single NaN pixel poisons the whole bloom chain
float pw(float x, float e){ return pow(max(x, 0.0), e); }
vec3 pw(vec3 x, float e){ return pow(max(x, vec3(0.0)), vec3(e)); }
#define PI 3.14159265359
#define TAU 6.28318530718
float hash11(float p){ p = fract(p*0.1031); p *= p+33.33; p *= p+p; return fract(p); }
float hash21(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec3 srgb2lin(vec3 c){ return c*(c*(c*0.305306011+0.682171111)+0.012522878); }
mat3 rotY(float a){ float c=cos(a), s=sin(a); return mat3(c,0.0,-s, 0.0,1.0,0.0, s,0.0,c); }
mat3 rotX(float a){ float c=cos(a), s=sin(a); return mat3(1.0,0.0,0.0, 0.0,c,s, 0.0,-s,c); }
mat3 rotZ(float a){ float c=cos(a), s=sin(a); return mat3(c,s,0.0, -s,c,0.0, 0.0,0.0,1.0); }
float easeOut2(float x){ return 1.0-(1.0-x)*(1.0-x); }
float easeOut3(float x){ float u=1.0-x; return 1.0-u*u*u; }
float easeIn2(float x){ return x*x; }
// fade-out curve table shared by particles / shapes
float fadeOutCurve(int code, float u){
  if (code == 0) return 1.0 - u;
  if (code == 1) return 1.0 - u*u;
  if (code == 2) return 1.0 - u*u*u;
  if (code == 3) { float v = 1.0 - u; return v*v; }
  if (code == 4) return 1.0 - smoothstep(0.6, 1.0, u);
  if (code == 5) return 1.0;
  if (code == 6) return 1.0 - smoothstep(0.85, 1.0, u);
  float w = 1.0 - u; return w*w*w;
}
float fadeInTime(int code){
  if (code == 0) return 0.015;
  if (code == 1) return 0.05;
  if (code == 2) return 0.1;
  if (code == 3) return 0.2;
  if (code == 4) return 0.35;
  return 0.5;
}
`;

/** atlas cell → uv (see textures.ts for the layout) */
export const GLSL_ATLAS = /* glsl */ `
vec2 atlasUV(float cell, vec2 q){
  q = q*0.96 + 0.02;
  if (cell < 64.0) {
    float col = mod(cell, 8.0), row = floor(cell/8.0);
    return vec2((col + q.x)/16.0, 1.0 - (row + 1.0 - q.y)/16.0);
  }
  float f = cell - 64.0;
  float fb = floor(f/16.0);
  float fr = f - fb*16.0;
  float col = mod(fr, 4.0), row = floor(fr/4.0);
  float u0 = (fb == 1.0) ? 0.0 : 0.5;
  float vTop = (fb == 0.0) ? 1.0 : 0.5;
  return vec2(u0 + (col + q.x)*0.125, vTop - (row + 1.0 - q.y)*0.125);
}
`;

/**
 * C3 bridge: packed art roles (floats >= 65536, spec/art.ts packArtRole) in the LEGACY batches. The particle batch reads
 * the SAME generated-art texture array as the spec runtime (`uSpecArt`, shared uniform objects bound by Fx.spec), so there
 * is one art system and no second atlas. packed = 65536 + layer + 8 col + 64 row + 512 (w-1) + 2048 (h-1) + 8192 (frames-1).
 */
export const GLSL_ART = /* glsl */ `
uniform float uArtGrid;
// atlas rect (u0, v0, du, dv) of frame f of a packed art role
vec4 artRect(float pk, float f){
  float d = floor((pk - 65536.0) / 8.0);
  float c0 = mod(d, 8.0); d = floor(d / 8.0);
  float r0 = mod(d, 8.0); d = floor(d / 8.0);
  float aw = mod(d, 4.0) + 1.0; d = floor(d / 4.0);
  float ah = mod(d, 4.0) + 1.0;
  float G = max(uArtGrid, 1.0);
  float cc = c0 + f * aw;
  float arow = r0 + floor(cc / G) * ah;
  return vec4(mod(cc, G) / G, 1.0 - (arow + ah) / G, aw / G, ah / G);
}
float artFrames(float pk){ return floor((pk - 65536.0) / 8192.0) + 1.0; }
float artLayer(float pk){ return mod(pk - 65536.0, 8.0); }
`;

/** fragment side of the art bridge: rect sample with per-cell mip gradients (no bleed between neighbouring cells) */
export const GLSL_ART_SAMPLE = /* glsl */ `
uniform sampler2DArray uSpecArt;
vec4 artTex(vec4 rc, float layer, vec2 q, vec2 gx, vec2 gy){
  vec2 uv = q * 0.99 + 0.005;
  return textureGrad(uSpecArt, vec3(rc.xy + uv * rc.zw, floor(layer + 0.5)), gx * rc.zw, gy * rc.zw);
}
`;
