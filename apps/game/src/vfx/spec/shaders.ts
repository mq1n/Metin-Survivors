
// read from the curve LUT (half-float, 4 logical 64-sample rows per texel row); attachment frames come from the anchor
// texture (row 0 instance anchors, row 1 alpha + tint, rows 2-3 body socket position + orientation quaternion).
// Textures: the procedural spec atlas (uSpecAtlas) or, for packed roles ≥ 65536, the generated-art texture array
// (uSpecArt, see art.ts).
import { HERO_GUARD_GLSL } from '../heroGuard';
import { GLSL_COMMON } from '../shaders/common';
import { ART_GUTTER } from './artGutter';
import { ART_DENSE_RATIO } from './artPage';

export const LUT_W = 256;
// 4096 rows of 4 curves = 16384 LUT rows (2048 before 2026-10-26: the registry alone used 6841 of 8192, the 63 generated families add
// ~10k): 256 x 4096 half-float RGBA = 8 MB of VRAM, still inside the 4096 texture limit every WebGL2 device has
export const LUT_H = 4096;
export const LUT_SAMPLES = 64;
export const ANCHORS = 256;
/** anchor texture rows: instance anchor, alpha + tint, socket position, socket quaternion */
export const ANCHOR_ROWS = 4;

const GLSL_SPEC = /* glsl */ `
uniform sampler2D uLut;
uniform sampler2D uAnchors;
uniform float uArtGrid;
vec4 lut(float row, float u){
  float r = floor(row + 0.5);
  float y = floor(r * 0.25);
  float x0 = (r - y * 4.0) * ${LUT_SAMPLES}.0;
  vec2 uv = vec2((x0 + 0.5 + clamp(u, 0.0, 1.0) * ${LUT_SAMPLES - 1}.0) / ${LUT_W}.0, (y + 0.5) / ${LUT_H}.0);
  return textureLod(uLut, uv, 0.0);
}
// colour curve (display values, 0xRRGGBB / 255) -> what the batch blends: linear light in the scene pass, the display value

#ifdef SPEC_DISPLAY
#define specCol(c) (c)
#else
#define specCol(c) srgb2lin(c)
#endif
vec3 qrot(vec4 q, vec3 v){ vec3 t = 2.0 * cross(q.xyz, v); return v + q.w * t + cross(q.xyz, t); }
mat3 qmat(vec4 q){ return mat3(qrot(q, vec3(1.0, 0.0, 0.0)), qrot(q, vec3(0.0, 1.0, 0.0)), qrot(q, vec3(0.0, 0.0, 1.0))); }
// role packing: cell + 256(w-1) + 1024(h-1) + 4096(frames-1)  (roles.ts packRole)
// art packing (≥ 65536): 65536 + layer + 8 col + 64 row + 512 (w-1) + 2048 (h-1) + 8192 (frames-1) + 262144 page  (art.ts packArtRole)
// returns the atlas rect (u0, v0, du, dv) of frame f
vec4 roleRect(float pk, float f){
  // single exit (FXC X4000 "(f_roleRect)" x6 per session: a return inside the if and one after it; the recipe of code_finish/a2/NOTES.txt)
  vec4 r;
  if (pk >= 65535.5) {
    float d = floor((pk - 65536.0) / 8.0);
    float c0 = mod(d, 8.0); d = floor(d / 8.0);
    float r0 = mod(d, 8.0); d = floor(d / 8.0);
    float aw = mod(d, 4.0) + 1.0; d = floor(d / 4.0);
    float ah = mod(d, 4.0) + 1.0; d = floor(d / 4.0);
    float G = max(uArtGrid, 1.0);
    // role page (d = frames - 1 + 32 page): 0 = a full layer (G x G cells), 1..4 = a dense layer, ART_DENSE_RATIO x the cells per side;
    // page - 1 holds the col / row bit 3 there (art.ts packArtRole, artPage.ts)
    float page = floor(d / 32.0);
    if (page > 0.5) {
      G *= ${ART_DENSE_RATIO}.0;
      c0 += 8.0 * mod(page - 1.0, 2.0);
      r0 += 8.0 * floor((page - 1.0) * 0.5);
    }
    float cc = c0 + f * aw;
    float arow = r0 + floor(cc / G) * ah;
    // the image of a run sits inside it, ART_GUTTER of a cell in from every side: the blit (art.ts addBlit) fills that gutter with the image's own edge
    // texels, so a texel read at the sprite's border (bilinear tap, coarse mip) never reaches the next run (artGutter.ts)
    float gut = ${ART_GUTTER} / G;
    r = vec4(mod(cc, G) / G + gut, 1.0 - (arow + ah) / G + gut, aw / G - 2.0 * gut, ah / G - 2.0 * gut);
  } else {
    float cell = mod(pk, 256.0);
    float w = floor(mod(pk, 1024.0) / 256.0) + 1.0;
    float h = floor(mod(pk, 4096.0) / 1024.0) + 1.0;
    float c0 = mod(cell, 16.0) + f * w;
    float row = floor(cell / 16.0) + floor(c0 / 16.0) * h;
    float col = mod(c0, 16.0);
    r = vec4(col / 16.0, 1.0 - (row + h) / 16.0, w / 16.0, h / 16.0);
  }
  return r;
}
float roleFrames(float pk){ return pk >= 65535.5 ? mod(floor((pk - 65536.0) / 8192.0), 32.0) + 1.0 : floor(pk / 4096.0) + 1.0; }
/** art array layer of a packed role, -1 for the procedural atlas */
float roleLayer(float pk){ return pk >= 65535.5 ? mod(pk - 65536.0, 8.0) : -1.0; }
uint pcg32(uint v){
  uint s = v * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
// Flipbook frame pair of a role with several frames: (frame a, frame b, cross-fade of b over a). mode = FrameMode

// client's CTextureAnimationDecorator; generated art), 2 random (cut, a NEW random frame at every step: texanitype
// random_frame). fps > 0: a step every 1 / fps s of the age t (blend / cut start on frame p, random hashes the step
// with the seed p); fps 0: once over the life u (random: one step per frame).
vec3 flipFrame(float frames, int mode, float fps, float t, float u, float p){
  if (mode == 2) {
    float step = fps > 0.0 ? floor(max(t, 0.0) * fps) : floor(min(u * frames, frames - 0.001));
    uint h = pcg32(uint(step) * 2654435761u + pcg32(uint(p)));
    float f = float(h % uint(frames));
    return vec3(f, f, 0.0);
  }
  float fr = fps > 0.0 ? mod(t * fps + p, frames) : min(u * frames, frames - 0.001);
  float fa = floor(fr);
  if (mode == 1) return vec3(fa, fa, 0.0);
  return vec3(fa, fps > 0.0 ? mod(fa + 1.0, frames) : min(fa + 1.0, frames - 1.0), fract(fr));
}
`;

/** fragment helper: samples a role rect from the procedural atlas or the art array with explicit gradients (vArtLayer) */
const GLSL_SAMPLE = /* glsl */ `
uniform sampler2D uSpecAtlas;
uniform sampler2DArray uSpecArt;
vec4 sampleRole(vec4 rc, vec2 uv, vec2 duvx, vec2 duvy, float layer){
  vec2 p = rc.xy + uv * rc.zw;
  vec4 c;
  if (layer > -0.5) c = textureGrad(uSpecArt, vec3(p, floor(layer + 0.5)), duvx * rc.zw, duvy * rc.zw);
  else c = textureGrad(uSpecAtlas, p, duvx * rc.zw, duvy * rc.zw);
  return c;
}
#ifdef SPEC_DISPLAY
// display-space batches (display.ts): the texel is read back as the display value it was authored as (the sRGB art
// texture decodes to linear on sampling), colour curve and bright stay display values, and the result is drawn

uniform float uOverlay;
uniform float uDepthOn;
uniform sampler2D uSceneDepth;
uniform vec2 uInvRes;
uniform vec3 uSoftZ; // camera near, camera far, soft distance (m); z 0 = hard test
vec3 lin2srgb(vec3 c){ c = max(c, vec3(0.0)); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }
float lin2srgb1(float c){ c = max(c, 0.0); return c < 0.0031308 ? c * 12.92 : 1.055 * pow(c, 1.0 / 2.4) - 0.055; }
// the overlay has no depth buffer of its own (the canvas after the composite): test against the resolved scene depth
bool displayOccluded(){ return uDepthOn > 0.5 && gl_FragCoord.z > texture2D(uSceneDepth, gl_FragCoord.xy * uInvRes).r + 2e-5; }
float eyeZ(float d){ float z = d * 2.0 - 1.0; return 2.0 * uSoftZ.x * uSoftZ.y / (uSoftZ.y + uSoftZ.x - z * (uSoftZ.y - uSoftZ.x)); }
// 0 = hidden behind the scene, 1 = in front of it. A SOFT element (screen / upright billboard particle: vSoft 1) also fades out over the last
// uSoftZ.z metres in front of the surface it crosses (the floor a big smoke / burst quad sinks into) instead of being cut by a hard line;
// flat decals (lie quads), trails and surfaces keep the hard test, so a ring lying on the floor never fades
float displayFade(float soft){
  if (uDepthOn < 0.5) return 1.0;
  float sd = texture2D(uSceneDepth, gl_FragCoord.xy * uInvRes).r;
  if (gl_FragCoord.z > sd + 2e-5) return 0.0;
  if (soft < 0.5 || uSoftZ.z <= 0.0) return 1.0;
  return clamp((eyeZ(sd) - eyeZ(gl_FragCoord.z)) / uSoftZ.z, 0.0, 1.0);
}
#endif
`;

export const SPEC_PARTICLE_VERT = /* glsl */ `
${GLSL_COMMON}
${GLSL_SPEC}
uniform float uTime;
attribute vec4 aA; // origin.xyz, birth                  | trail: point A, sample time A
attribute vec4 aB; // offset.xyz, life                   | trail: base / tangent at A, point life
attribute vec4 aC; // v0.xyz, swirl rad/s                | trail: point B, sample time B
attribute vec4 aD; // halfX, halfY, rot0, spin           | trail: base / tangent at B, texture repeats
attribute vec4 aE; // lut row, role, flags, anchor (slot | socket texel << 8)
attribute vec4 aF; // bright, fps, frame0, gravity scale | trail: bright, fade A, fade B, ribbon half width
varying vec2 vQ;
varying vec4 vCol;
varying vec4 vRectA;
varying vec4 vRectB;
varying float vMix;
varying vec4 vMisc; // art layer (-1 = procedural), occlude, clamp (0 = off), wrap u
varying float vSq; // ElementCommon.square: the display-space element adds (texel x colour)^2
varying float vSoft; // 1 = screen / upright billboard particle: the display overlay fades it out in front of the surface it crosses

void hide(){
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  vQ = vec2(0.0); vCol = vec4(0.0); vRectA = vec4(0.0); vRectB = vec4(0.0); vMix = 0.0; vMisc = vec4(-1.0, 0.0, 0.0, 0.0); vSq = 0.0; vSoft = 0.0;
}

void main(){
  int fl = int(aE.z + 0.5);
  int an = int(aE.w + 0.5);
  int slot = an & 255;
  int sock = an >> 8;
  vec4 an2 = texelFetch(uAnchors, ivec2(slot, 1), 0);
  float occ = float((fl >> 6) & 15) / 15.0;
  float clampV = float((fl >> 10) & 31) * 0.125;
  vSq = float((fl >> 21) & 1);
  vSoft = 0.0;
  vec2 q = position.xy;
  if (((fl >> 4) & 1) == 1) {
    // trail segment A → B: each end fades with its own age (u = age / life along the trail)
    float tlife = aB.w;
    float ageA = uTime - aA.w;
    float ageB = uTime - aC.w;
    if (ageB < 0.0 || (ageA >= tlife && ageB >= tlife) || an2.x <= 0.0) { hide(); return; }
    bool endB = q.x > 0.0;
    float tu = clamp((endB ? ageB : ageA) / tlife, 0.0, 1.0);
    vec3 P = endB ? aC.xyz : aA.xyz;
    vec3 Q = endB ? aD.xyz : aB.xyz;
    vec4 T0 = lut(aE.x, tu);
    vec4 T1 = lut(aE.x + 1.0, tu);
    vec3 wp;
    if (((fl >> 5) & 1) == 1) {
      // ribbon: Q is the path tangent, the strip faces the camera
      vec3 side = cross(Q, cameraPosition - P);
      float sl = length(side);
      side = sl > 1e-5 ? side / sl : vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
      wp = P + side * (q.y * 2.0) * aF.w * T0.x;
    } else {
      // band: swept between the sampled point (tip, v = 1) and the base point, narrowed by the taper
      wp = q.y > 0.0 ? P : mix(P, Q, T0.x);
    }
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
    vQ = vec2(tu * aD.w, q.y + 0.5);
    vRectA = roleRect(aE.y, 0.0);
    vRectB = vRectA;
    vMix = 0.0;
    vMisc = vec4(roleLayer(aE.y), occ, clampV, aD.w > 1.0001 ? 1.0 : 0.0);
    vCol = vec4(specCol(clamp(T1.rgb * an2.yzw, 0.0, 1.0)) * aF.x, clamp(T1.a, 0.0, 1.0) * (endB ? aF.z : aF.y) * an2.x);
    return;
  }
  float t = uTime - aA.w;
  float life = aB.w;
  float u = t / life;
  if (t < 0.0 || u >= 1.0 || an2.x <= 0.0) { hide(); return; }
  int bb = fl & 3;
  bool attached = ((fl >> 2) & 1) == 1;
  vSoft = (bb == 1 || bb == 3 || ((fl >> 4) & 1) == 1) ? 0.0 : 1.0;
  vec4 L0 = lut(aE.x, u);
  vec4 L1 = lut(aE.x + 1.0, u);
  vec4 L2 = lut(aE.x + 2.0, u);
  vec3 rel = aB.xyz + aC.xyz * (L0.z * life) + vec3(0.0, L2.x * life * life * aF.w, 0.0);
  vec3 vel = aC.xyz * L0.w + vec3(0.0, L2.y * life * aF.w, 0.0);
  if (aC.w != 0.0) {
    float a = aC.w * t;
    float c = cos(a), s = sin(a);
    rel.xz = vec2(c * rel.x + s * rel.z, -s * rel.x + c * rel.z);
    vel.xz = vec2(c * vel.x + s * vel.z, -s * vel.x + c * vel.z);
  }
  
  // the position, so the displacement that orients a stretch quad contains the tangential step: add d(rel)/dt of the rotation above
  // (vel only feeds the stretch branch below)
  if (((fl >> 22) & 1) == 1) vel += aC.w * vec3(rel.z, 0.0, -rel.x);
  vec3 p = aA.xyz + rel;
  float yawA = 0.0;
  if (sock > 0) {
    // lives in a body socket frame (hand, blade tip …) that moves every frame
    vec4 sp = texelFetch(uAnchors, ivec2(sock, 2), 0);
    vec4 sq = texelFetch(uAnchors, ivec2(sock, 3), 0);
    p = sp.xyz + qrot(sq, p);
    vel = qrot(sq, vel);
    vec3 fw = qrot(sq, vec3(0.0, 0.0, 1.0));
    yawA = atan(fw.x, fw.z);
  } else if (attached) {
    vec4 an = texelFetch(uAnchors, ivec2(slot, 0), 0);
    mat3 R = rotY(an.w);
    p = an.xyz + R * p;
    vel = R * vel;
    yawA = an.w;
  }
  float sx = aD.x * L0.x * 2.0;
  float sy = aD.y * L0.y * 2.0;
  float rot = aD.z + aD.w * t;
  vQ = q + 0.5;
  
  if (((fl >> 3) & 1) == 1) q.x = -q.x;
  
  // along "Cross" sized by SizeX·ScaleX, so screen / lie quads take their width from y and their height from x
  vec2 cq = bb <= 1 ? vec2(q.x * sy, q.y * sx) : vec2(q.x * sx, q.y * sy);
  float cr = cos(rot), sr = sin(rot);
  vec2 r = vec2(cq.x * cr - cq.y * sr, cq.x * sr + cq.y * cr);
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 wp;
  float bias = 1.0;
  if (bb == 0) {
    wp = p + camRight * r.x + camUp * r.y;
  } else if (bb == 1) {
    wp = p + rotY(rot + yawA) * vec3(cq.x, 0.0, cq.y);
    // lie quads: pulled toward the camera (scaled by size, ≤ 0.8 m) so wide decals survive uneven terrain
    vec3 toC = cameraPosition - wp;
    float dC = max(length(toC), 0.001);
    wp += toC * (min(min(0.1 + 0.08 * max(sx, sy), 0.8), dC * 0.4) / dC);
    bias = 0.0;
  } else if (bb == 2) {
    vec3 rg = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]));
    
    int fc = (fl >> 18) & 7;
    if (fc > 0) rg = rotY(fc == 1 ? -0.5236 : fc == 2 ? 0.5236 : fc == 3 ? -1.0472 : 1.0472) * rg;
    wp = p + rg * r.x + vec3(0.0, r.y, 0.0);
  } else {
    float spd = length(vel);
    vec3 axis = spd > 0.001 ? vel / spd : vec3(0.0, 1.0, 0.0);
    vec3 side = cross(axis, cameraPosition - p);
    float sl = length(side);
    side = sl > 0.0001 ? side / sl : camRight;
    float len = sy * (1.0 + log(1.0 + spd * 100.0 / 60.0));
    
    // (ParticleInstance.cpp __Initialize / Transform); the default keeps v along the motion (hand specs, pixel-identical)
    if (((fl >> 22) & 1) == 1) wp = p + axis * q.x * len + side * q.y * sx;
    else wp = p + axis * q.y * len + side * q.x * sx;
  }
  // front flag (ElementCommon.front): screen / upright flashes slide along their view ray to 0.45 x the distance, so they
  // look identical on screen but are never cut by the floor or hidden behind the scene
  if (((fl >> 15) & 1) == 1 && (bb == 0 || bb == 2)) wp = cameraPosition + (wp - cameraPosition) * 0.45;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  mv.z += bias * min(max(sx, sy), 3.0) * 0.25;
  gl_Position = projectionMatrix * mv;

  float frames = roleFrames(aE.y);
  float fa = 0.0, fb = 0.0, mixF = 0.0;
  if (frames > 1.0) {
    vec3 ff = flipFrame(frames, (fl >> 16) & 3, aF.y, t, u, aF.z);
    fa = ff.x; fb = ff.y; mixF = ff.z;
  }
  vRectA = roleRect(aE.y, fa);
  vRectB = roleRect(aE.y, fb);
  vMix = mixF;
  vMisc = vec4(roleLayer(aE.y), occ, clampV, 0.0);
  // anchor row 1 = (alpha, per-spawn tint rgb): the tint multiplies the colour curve before linearisation
  vCol = vec4(specCol(clamp(L1.rgb * an2.yzw, 0.0, 1.0)) * aF.x, clamp(L1.a, 0.0, 1.0) * an2.x);
}
`;

export const SPEC_PARTICLE_FRAG = /* glsl */ `
${GLSL_COMMON}
${GLSL_SAMPLE}
${HERO_GUARD_GLSL}
varying vec2 vQ;
varying vec4 vCol;
varying vec4 vRectA;
varying vec4 vRectB;
varying float vMix;
varying vec4 vMisc;
varying float vSq;
varying float vSoft;
void main(){
  vec2 qs = vec2(vMisc.w > 0.5 ? fract(vQ.x) : vQ.x, vQ.y);
  vec2 q = qs * 0.96 + 0.02;
  vec2 dx = dFdx(vQ) * 0.96, dy = dFdy(vQ) * 0.96;
  vec4 tex = sampleRole(vRectA, q, dx, dy, vMisc.x);
  if (vMix > 0.001) tex = mix(tex, sampleRole(vRectB, q, dx, dy, vMisc.x), vMix);
  float a = tex.a * vCol.a;
#ifdef SPEC_DISPLAY
  
  // elements (ElementCommon.square) add the square of that colour: out = dst + src x src
  vec3 rgb = min(lin2srgb(tex.rgb) * vCol.rgb, vec3(1.0));
  if (vSq > 0.5) rgb *= rgb;
  rgb *= vCol.a;
  if (vMisc.z > 0.0) rgb = min(rgb, vec3(lin2srgb1(vMisc.z)));
#else
  vec3 rgb = tex.rgb * vCol.rgb * vCol.a;
  if (vMisc.z > 0.0) rgb = min(rgb, vec3(vMisc.z));
#endif
  if (a < 0.002 && max(rgb.r, max(rgb.g, rgb.b)) < 0.002) discard;
#ifdef SPEC_DISPLAY
  if (uOverlay > 0.5) {
    // display-referred overlay on the canvas: premultiplied (ONE, ONE_MINUS_SRC_ALPHA), no tone mapping, no encoding
    float dfade = displayFade(vSoft);
    if (dfade <= 0.0) discard;
    gl_FragColor = vec4(rgb, a * vMisc.y) * (heroGuardFade() * dfade);
  } else {
    // no cooperating post pipeline: the same light inside the scene pass, in linear light
    gl_FragColor = vec4(srgb2lin(rgb), a * vMisc.y) * heroGuardFade();
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
#else
#ifdef SPEC_ADD
  // additive batch with premultiplied blending (ONE, ONE_MINUS_SRC_ALPHA): alpha 0 = pure add, > 0 = soft core
  gl_FragColor = vec4(rgb, a * vMisc.y) * heroGuardFade();
#else
  gl_FragColor = vec4(rgb, a) * heroGuardFade();
#endif
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
#endif
}
`;

/** surface kinds (SurfaceShape.kind order) */
export const SURF_KIND = { card: 0, arc: 1, cyl: 2, sphere: 3, ribbon: 4, tube: 5, bolt: 6 } as const;
export const SURF_NU = 48;
export const SURF_NV = 8;

export const SPEC_SURFACE_VERT = /* glsl */ `
${GLSL_COMMON}
${GLSL_SPEC}
uniform float uTime;
attribute vec4 sA; // pos.xyz, birth
attribute vec4 sB; // yaw, pitch, roll, life
attribute vec4 sC; // shape params p0..p3
attribute vec4 sD; // p4, kind, lut row, role
attribute vec4 sE; // tileU, tileV, flags, anchor (slot | socket texel << 8)
attribute vec4 sF; // bright, soft, seed, fps  (seed: the spawn's; random frame mode: per record, flip.ts recordSeed)
varying vec2 vUv;
varying vec4 vCol;
varying vec4 vRectA;
varying vec4 vRectB;
varying float vMix;
varying vec3 vMisc; // tile flag, soft, v
varying vec2 vEdgeU; // softU (fraction of the span feathered at each end of the shape), s (position along the shape 0..1)
varying vec3 vTone; // art layer (-1 = procedural), occlude, clamp (0 = off)
varying float vSq; // ElementCommon.square (see the particle shader)

float h1(float n){ return fract(sin(n * 127.1) * 43758.5453); }
float vn(float x, float s){ float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h1(i + s), h1(i + 1.0 + s), f) * 2.0 - 1.0; }

void main(){
  float t = uTime - sA.w;
  float life = sB.w;
  int fl = int(sE.z + 0.5);
  bool loopEl = ((fl >> 6) & 1) == 1;
  float u = loopEl ? fract(t / life) : t / life;
  int an = int(sE.w + 0.5);
  int slot = an & 255;
  int sock = an >> 8;
  vec4 an2 = texelFetch(uAnchors, ivec2(slot, 1), 0);
  if (t < 0.0 || (!loopEl && u >= 1.0) || an2.x <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vUv = vec2(0.0); vCol = vec4(0.0); vRectA = vec4(0.0); vRectB = vec4(0.0); vMix = 0.0; vMisc = vec3(0.0); vEdgeU = vec2(0.0); vTone = vec3(-1.0, 0.0, 0.0); vSq = 0.0;
    return;
  }
  int kind = int(sD.y + 0.5);
  int bb = fl & 3;
  bool attached = ((fl >> 2) & 1) == 1;
  bool window = ((fl >> 3) & 1) == 1;
  bool groundBias = ((fl >> 5) & 1) == 1;
  vec4 L0 = lut(sD.z, u);
  vec4 L1 = lut(sD.z + 1.0, u);
  vec4 L2 = lut(sD.z + 2.0, u);
  vec4 L3 = lut(sD.z + 3.0, u);
  float head = L2.x, tail = L2.y;
  float gu = position.x, gv = position.y;
  float s = mix(tail, head, gu);
  vec2 tuv = vec2(window ? gu : s, gv);
  vec3 lp;
  bool camSpace = false;
  if (kind == 0) { // card
    float w = sC.x, h = sC.y, bend = sC.z;
    float x = (s - 0.5) * w;
    if (abs(bend) > 0.001) { float R = w / bend; float a = x / R; lp = vec3(R * sin(a), (gv - 0.5) * h, R * (1.0 - cos(a))); }
    else lp = vec3(x, (gv - 0.5) * h, 0.0);
    camSpace = bb != 0;
  } else if (kind == 1) { // arc
    float a = radians(sC.w) + s * radians(sC.z);
    float taper = sD.x;
    float mid = 0.5 * (sC.x + sC.y), hw = 0.5 * (sC.y - sC.x);
    float k = taper > 0.0 ? pw(sin(PI * clamp(s, 0.0, 1.0)), taper * 1.5) : 1.0;
    float rr = mid + (gv - 0.5) * 2.0 * hw * k;
    lp = vec3(rr * sin(a), 0.0, rr * cos(a));
  } else if (kind == 2) { // cylinder / cone
    float a = s * radians(sC.w);
    float rr = mix(sC.x, sC.y, gv) + sD.x * sin(PI * gv); // sD.x = bulge (barrel: extra radius at mid height)
    lp = vec3(rr * sin(a), gv * sC.z, rr * cos(a));
  } else if (kind == 3) { // sphere shell
    float lon = s * TAU;
    float lat = radians(mix(sC.y, sC.z, gv));
    lp = sC.x * vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon));
  } else if (kind == 4) { // helix ribbon
    float a = radians(sD.x) + s * radians(sC.y);
    float y = s * sC.z;
    bool wall = ((fl >> 7) & 1) == 1;
    vec3 rad = vec3(sin(a), 0.0, cos(a));
    lp = wall ? rad * sC.x + vec3(0.0, y + (gv - 0.5) * sC.w, 0.0) : rad * (sC.x + (gv - 0.5) * sC.w) + vec3(0.0, y, 0.0);
  } else if (kind == 5) { // helix tube
    float a = radians(sD.x) + s * radians(sC.y);
    float dA = radians(sC.y);
    vec3 rad = vec3(sin(a), 0.0, cos(a));
    vec3 tng = normalize(vec3(cos(a) * sC.x * dA, sC.z, -sin(a) * sC.x * dA) + vec3(1e-5));
    vec3 bin = normalize(cross(tng, rad));
    vec3 nrm = cross(bin, tng);
    float taper = float((fl >> 8) & 15) / 15.0;
    float tr = sC.w * (1.0 - taper * clamp(s, 0.0, 1.0));
    float th = gv * TAU;
    lp = rad * sC.x + vec3(0.0, s * sC.z, 0.0) + (nrm * cos(th) + bin * sin(th)) * tr;
  } else { // bolt: handled in world space below
    lp = vec3(0.0, 0.0, s * sC.x);
  }
  lp *= L0.xyz;
  if (abs(L3.w) > 1e-5 && !camSpace) lp = rotY(L3.w) * lp;
  mat3 R = rotY(sB.x) * rotX(sB.y) * rotZ(sB.z);
  vec3 centre = sA.xyz + L3.xyz;
  vec3 wp;
  mat3 RA = mat3(1.0);
  vec3 origin = vec3(0.0);
  if (sock > 0) {
    // follows a body socket frame (blade, hand …)
    vec4 sp = texelFetch(uAnchors, ivec2(sock, 2), 0);
    RA = qmat(texelFetch(uAnchors, ivec2(sock, 3), 0));
    origin = sp.xyz;
  } else if (attached) {
    vec4 an = texelFetch(uAnchors, ivec2(slot, 0), 0);
    RA = rotY(an.w);
    origin = an.xyz;
  }
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  if (kind == 6) {
    float hz = max(sD.x, 0.001);
    float seed = floor(t * hz) * 7.13 + sF.z * 31.0;
    float jag = sC.z;
    float env = sin(PI * clamp(s, 0.0, 1.0));
    vec3 off = vec3(vn(s * 9.0, seed) + 0.5 * vn(s * 23.0, seed + 3.1), vn(s * 9.0, seed + 11.7) + 0.5 * vn(s * 23.0, seed + 5.3), 0.0) * jag * sC.x * 0.12 * env;
    vec3 c0 = origin + RA * (centre + R * ((vec3(0.0, 0.0, s * sC.x) + off) * L0.xyz));
    vec3 c1 = origin + RA * (centre + R * ((vec3(0.0, 0.0, (s + 0.01) * sC.x) + off) * L0.xyz));
    vec3 tng = normalize(c1 - c0 + vec3(1e-5));
    vec3 side = cross(tng, cameraPosition - c0);
    float sl = length(side);
    side = sl > 0.0001 ? side / sl : camRight;
    wp = c0 + side * (gv - 0.5) * sC.y * L0.x;
  } else if (camSpace) {
    vec3 c = origin + RA * centre;
    if (bb == 1) {
      float cr = cos(sB.z + L3.w), sr = sin(sB.z + L3.w);
      vec2 r = vec2(lp.x * cr - lp.y * sr, lp.x * sr + lp.y * cr);
      wp = c + camRight * r.x + camUp * r.y;
    } else {
      vec3 rg = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]));
      wp = c + rg * lp.x + vec3(0.0, lp.y, 0.0);
    }
  } else {
    wp = origin + RA * (centre + R * lp);
  }
  if (groundBias) {
    vec3 toC = cameraPosition - wp;
    float dC = max(length(toC), 0.001);
    wp += toC * (min(0.12 + 0.03 * sC.y, dC * 0.4) / dC);
  }
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);

  tuv.x = tuv.x * sE.x + L2.z;
  tuv.y = tuv.y * sE.y + L2.w;
  vUv = tuv;
  float frames = roleFrames(sD.w);
  float fa = 0.0, fb = 0.0, mixF = 0.0;
  if (frames > 1.0) {
    int fmode = (fl >> 21) & 3;
    vec3 ff = flipFrame(frames, fmode, sF.w, t, u, fmode == 2 ? floor(sF.z * 16777216.0) : 0.0);
    fa = ff.x; fb = ff.y; mixF = ff.z;
  }
  vRectA = roleRect(sD.w, fa);
  vRectB = roleRect(sD.w, fb);
  vMix = mixF;
  // sF.y packs soft (0..1, the fractional part) and softU (hundredths, in the even integer part: 2 x round(softU x 100))
  float softQ = floor(sF.y * 0.5);
  vMisc = vec3(((fl >> 4) & 1) == 1 ? 1.0 : 0.0, sF.y - 2.0 * softQ, gv);
  vEdgeU = vec2(softQ * 0.01, s);
  vTone = vec3(roleLayer(sD.w), float((fl >> 12) & 15) / 15.0, float((fl >> 16) & 31) * 0.125);
  vSq = float((fl >> 23) & 1);
  vCol = vec4(specCol(clamp(L1.rgb * an2.yzw, 0.0, 1.0)) * sF.x, clamp(L0.w, 0.0, 1.0) * an2.x);
}
`;

export const SPEC_SURFACE_FRAG = /* glsl */ `
${GLSL_COMMON}
${GLSL_SAMPLE}
${HERO_GUARD_GLSL}
varying vec2 vUv;
varying vec4 vCol;
varying vec4 vRectA;
varying vec4 vRectB;
varying float vMix;
varying vec3 vMisc;
varying vec2 vEdgeU;
varying vec3 vTone;
varying float vSq;
void main(){
  vec2 uv = vMisc.x > 0.5 ? fract(vUv) : clamp(vUv, 0.0, 1.0);
  uv = uv * 0.97 + 0.015;
  vec2 dx = dFdx(vUv), dy = dFdy(vUv);
  vec4 tex = sampleRole(vRectA, uv, dx, dy, vTone.x);
  if (vMix > 0.001) tex = mix(tex, sampleRole(vRectB, uv, dx, dy, vTone.x), vMix);
  float soft = vMisc.y;
  float edge = soft > 0.001 ? smoothstep(0.0, soft * 0.5, vMisc.z) * smoothstep(1.0, 1.0 - soft * 0.5, vMisc.z) : 1.0;
  if (vEdgeU.x > 0.001) edge *= smoothstep(0.0, vEdgeU.x, vEdgeU.y) * smoothstep(1.0, 1.0 - vEdgeU.x, vEdgeU.y);
  float a = tex.a * vCol.a * edge;
#ifdef SPEC_DISPLAY
  vec3 rgb = min(lin2srgb(tex.rgb) * vCol.rgb, vec3(1.0));
  if (vSq > 0.5) rgb *= rgb;
  rgb *= vCol.a * edge;
  if (vTone.z > 0.0) rgb = min(rgb, vec3(lin2srgb1(vTone.z)));
#else
  vec3 rgb = tex.rgb * vCol.rgb * vCol.a * edge;
  if (vTone.z > 0.0) rgb = min(rgb, vec3(vTone.z));
#endif
  if (a < 0.002 && max(rgb.r, max(rgb.g, rgb.b)) < 0.002) discard;
#ifdef SPEC_DISPLAY
  if (uOverlay > 0.5) {
    if (displayOccluded()) discard;
    gl_FragColor = vec4(rgb, a * vTone.y) * heroGuardFade();
  } else {
    gl_FragColor = vec4(srgb2lin(rgb), a * vTone.y) * heroGuardFade();
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
#else
#ifdef SPEC_ADD
  gl_FragColor = vec4(rgb, a * vTone.y) * heroGuardFade();
#else
  gl_FragColor = vec4(rgb, a) * heroGuardFade();
#endif
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
#endif
}
`;
