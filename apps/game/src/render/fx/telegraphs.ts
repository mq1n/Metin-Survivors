// Telegraphs: ground decals that warn about incoming attacks (enemy / boss / metin).
//
// One draw call: every decal is a slot in a merged grid mesh (GRID×GRID quads per slot). Each slot's vertex
// heights are sampled CPU-side from `core.heightAt` only when the decal is new or moved (so the decal drapes over
// hills); the shape itself (circle / cone / line / ring, fill sweep, rim, patterns, danger flash) is evaluated
// analytically in the fragment shader from per-slot parameters stored in a float data texture.
//
// The decal infrastructure (`DecalSlots`, `DecalGrid`, FX_GLSL_LIB, pure helpers) lives in ./decalGrid.ts (core-owned,
// shared with groundRings.ts); this file is the telegraph look (owner: the telegraphs builder).
//

// outline. A warning is a stack of soft glowing layers on a soot-dark underlay: 2-3 slowly counter-rotating BROKEN ARCS
// (click_select) hugging the edge, an inward-travelling pulse (redd_meteo_circle's expanding discs), the filled part of the
// sweep as grainy heat with drifting embers, a hot soft sweep front, direction chevrons for cones and lanes, a calligraphic
// rune band + sigil for boss / metin circles (lit by an angular sweep), contracting thin rings for falling-body warnings.
// Colour = element / owner / the metin def's rune (per-slot payload); brightness adapts to the zone's ground (snow keeps
// an alpha body so the hue survives, lava keeps a dark underlay so the glow reads). The resolve is NOT a white wash: the
// last 15 % tighten and brighten, the 0.2 s fade shows one hot ring expanding through the shape.
import {
  Color,
  DataTexture,
  LinearFilter,
  RGBAFormat,
  RedFormat,
  RepeatWrapping,
  UnsignedByteType,
  type IUniform,
  type ShaderMaterial,
} from 'three';
import type { RenderCore, RenderSystem } from '../core';
import { TG_CIRCLE, TG_CONE, TG_LINE, TG_RING, type TelegraphFeed } from '../feed';
import type { QualityProfile } from '../quality';
import { DecalGrid, FX_GLSL_LIB, telegraphRect } from './decalGrid';
import { isFallingBody, isImpactAct, telegraphHook, wantsSpriteLayer } from './fallCue';
import { GLYPH_ATLAS_SIZE, GRAIN_SIZE, linearRgb, makeGlyphAtlas, makeGrainData, warnHex } from './telegraphArt';

// the decal infrastructure moved to ./decalGrid.ts (C0); re-exported for existing importers (tests, demos)
export {
  DECAL_GRID,
  DECAL_MARGIN,
  DECAL_VERT,
  DecalGrid,
  DecalSlots,
  FX_GLSL_LIB,
  HEIGHT_SAMPLE_M,
  NOISE_SIZE,
  SLOT_FADING,
  SLOT_FREE,
  SLOT_LIVE,
  decalWorld,
  makeNoiseData,
  selectClosest,
  telegraphRect,
  upsampleLattice,
  type DecalGridOptions,
  type DecalSlotsOptions,
  type RectFn,
} from './decalGrid';

// ---------------------------------------------------------------------------------------------------------------
// Telegraph fragment shader

const TG_FRAG = /* glsl */ `
uniform float uTime;
uniform float uGround;
uniform float uCrowd;
uniform sampler2D uGrain;
uniform sampler2D uGlyph;
flat varying float vKind;
flat varying float vSub;
flat varying float vProg;
flat varying float vR1;
flat varying float vR2;
flat varying float vR3;
flat varying float vAlpha;
flat varying float vSeed;
flat varying float vAux;
flat varying vec4 vExtra;
varying vec2 vL;

${FX_GLSL_LIB}

#define TAU 6.2831853
#define PI 3.14159265

// exact pie (sector) distance, aperture c = (sin, cos) of the HALF angle, axis +y
float sdPie(vec2 p, vec2 c, float r) {
  p.x = abs(p.x);
  float l = length(p) - r;
  float m = length(p - c * clamp(dot(p, c), 0.0, r));
  return max(l, m * sign(c.y * p.x - c.x * p.y));
}
float gband(float d, float c, float w) { float x = (d - c) / w; return exp(-x * x); }

// broken arc along a perimeter phase: every cell holds one dash of random length / position. arcU = position 0..1 inside the dash
// (-1 outside); arcShape = brush profile (thin tips, full belly) used for both the width and the brightness of the stroke
float arcU(float ph, float cells, float seed, float cover) {
  float id = mod(floor(ph), cells);
  float f = fract(ph);
  float h = hash11(id * 1.731 + seed);
  float h2 = hash11(id * 3.17 + seed + 9.1);
  float len = clamp(cover * (0.5 + 0.95 * h), 0.14, 0.97);
  float st = (1.0 - len) * h2;
  float u = (f - st) / len;
  return (u > 0.0 && u < 1.0) ? u : -1.0;
}
float arcShape(float u) { return u < 0.0 ? 0.0 : pow(sin(PI * u), 0.7); }
float arcMask(float ph, float cells, float seed, float cover) { return arcShape(arcU(ph, cells, seed, cover)); }

// one soft ember per cell, rising and cooling; q in cells
float emberCell(vec2 q, float seed, float tt, float dirSign) {
  vec2 c = floor(q);
  vec2 f = fract(q);
  float h = hash21(c + seed);
  if (h > 0.30) return 0.0;
  float cyc = fract(tt * (0.3 + 0.35 * hash21(c + 1.9 + seed)) + h * 9.0);
  vec2 pos = vec2(0.28 + 0.44 * hash21(c + 7.7 + seed) + 0.07 * sin(cyc * 9.0 + h * 20.0), 0.5 + dirSign * (cyc - 0.5) * 0.36);
  float dd = length(f - pos);
  float rad = 0.085 + 0.06 * hash21(c + 3.3 + seed);
  return exp(-dd * dd / (rad * rad)) * (1.0 - smoothstep(0.17, 0.26, dd)) * sin(cyc * PI);
}

void main() {
  vec2 l = vL;
  float t = uTime;
  float isBoss = step(0.5, vSub) * (1.0 - step(1.5, vSub));
  float isMetin = step(1.5, vSub);
  float isBig = max(isBoss, isMetin);
  float meteor = step(15.5, vExtra.w);
  vec3 cMain = vExtra.rgb;
  // highlight family: ochre-gold for warm hues, pale ice for cold ones (never plain white: white goes pastel on snow)
  vec3 hl = mix(vec3(0.78, 0.94, 1.0), vec3(1.0, 0.72, 0.3), step(cMain.b, cMain.r));
  vec3 cHot = mix(cMain, hl, 0.5);
  vec3 cDeep = cMain * vec3(0.3, 0.17, 0.2);
  float G = uGround;
  float wAdd = mix(1.0, 0.55, G);
  float wBody = mix(0.62, 1.0, G);
  // many trash windups at once (a horde fight): their fills calm down so the rims, the boss and the metin warnings stay the read
  float calm = mix(uCrowd, 1.0, isBig);

  // ---- shape: signed distance d (m, <0 inside), sweep coordinate s (0..1), sweep length dimM (m), perimeter coord ----------
  float R = vR1;
  float r = length(l);
  float ang = atan(l.x, l.y);
  float d;
  float s;
  float dimM;
  float uu = ang * R;
  bool periodic = false;
  float rimR = R;
  if (vKind < 0.5) { // circle
    d = r - R; s = r / R; dimM = R; periodic = true;
  } else if (vKind < 1.5) { // cone: R = length, vR3 = full angle; rounded apex + corners (Minkowski offset of a shrunk pie)
    float half_ = clamp(vR3 * 0.5, 0.05, 3.1);
    float rr = min(0.45, R * 0.1);
    vec2 q = vec2(abs(l.x), l.y - rr / max(sin(half_), 0.25));
    d = sdPie(q, vec2(sin(half_), cos(half_)), max(R - rr, 0.1)) - rr;
    s = r / R; dimM = R;
    float dFront = r - R;
    float dSide = (abs(ang) - half_) * r;
    uu = dFront > dSide ? ang * R : r + (ang > 0.0 ? 40.0 : 90.0);
  } else if (vKind < 2.5) { // line: vR2 = length, vR3 = width, runs along +y from the origin
    float L = vR2; float W = vR3;
    float rc = min(0.16, W * 0.2);
    vec2 q = abs(vec2(l.x, l.y - L * 0.5)) - vec2(W * 0.5 - rc, L * 0.5 - rc);
    d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - rc;
    s = l.y / L; dimM = L;
    float sideDist = W * 0.5 - abs(l.x);
    float capDist = min(l.y, L - l.y);
    uu = sideDist < capDist ? l.y + (l.x > 0.0 ? 40.0 : 90.0) : l.x * 1.6 + (l.y > L * 0.5 ? 140.0 : 190.0);
  } else { // ring: R outer, vR2 inner (safe) radius
    float rin = vR2;
    d = max(r - R, rin - r);
    s = (r - rin) / max(R - rin, 0.01); dimM = max(R - rin, 0.01); periodic = true;
    bool outer = (R - r) < (r - rin);
    rimR = outer ? R : rin;
    uu = ang * rimR + (outer ? 0.0 : 71.0);
  }
  float aa = max(fwidth(d) * 0.9, 1e-4);
  if (d > 0.62) discard;

  float p = clamp(vProg, 0.0, 1.0);
  float rel = vAux; // 0 while the sim still owns the decal, (0..1] while it fades after the resolve
  float inside = 1.0 - smoothstep(-0.34, 0.1, d);
  float insideHard = 1.0 - smoothstep(-aa, aa, d);
  float widthM = (vKind > 1.5 && vKind < 2.5) ? vR3 : dimM;
  float kS = clamp(sqrt(max(min(dimM, widthM * 2.0), 0.5)) / 1.7, 0.7, 1.4); // rim thickness scale (narrow lanes get thin rims)
  float narrow = mix(0.62, 1.0, smoothstep(1.2, 3.2, widthM)); // narrow lanes carry less area glow
  float edgeIn = exp(-max(-d, 0.0) / (0.55 * kS));
  float sw = clamp(0.3 / dimM, 0.012, 0.12);
  float live = smoothstep(0.0, 0.04, p) * (1.0 - smoothstep(0.985, 1.0, p));
  float filled = (1.0 - smoothstep(p - sw, p + sw * 0.25, s)) * insideHard * smoothstep(0.0, 0.03, p);
  float behind = max((p - s) * dimM, 0.0);
  float heat = exp(-behind / 0.75) * filled;
  float front = exp(-pow((s - p) * dimM / 0.16, 2.0)) * inside * live;

  vec4 gr = vec4(0.5, 0.5, 1.0, 0.5);
  vec4 gr2 = vec4(0.5, 0.5, 1.0, 0.5);
#ifndef LOW
  gr = texture2D(uGrain, l * 0.07 + vec2(vSeed * 0.173, vSeed * 0.311) + vec2(0.0, -t * 0.025));
  gr2 = texture2D(uGrain, l * 0.29 + vec2(vSeed * 0.71, vSeed * 0.43) + vec2(-t * 0.045, t * 0.02));
#endif
  float mottle = gr.a;
  float flow = gr.r;
  float grain = 0.52 + 0.96 * gr2.g;
  float wave = 0.62 + 0.38 * cos(s * dimM * 2.3 - t * (2.2 + 2.0 * vProg));
  // cones and lanes: the heat streams along the attack direction (lane +y, cone radial) in thin streaks, so the fill is moving heat, never a flat plate
  float streak = flow;
#ifndef LOW
  if (vKind > 0.5 && vKind < 2.5) {
    vec2 sq = vKind < 1.5 ? vec2(ang * R * 0.55, r * 0.16 - t * (0.35 + 0.5 * vProg)) : vec2(l.x * 0.85, l.y * 0.14 - t * (0.35 + 0.5 * vProg));
    streak = mix(flow, texture2D(uGrain, sq + vec2(vSeed * 0.37, 0.0)).r, 0.85);
  }
#endif

  vec3 cA = vec3(0.0); float aA = 0.0; vec3 gl = vec3(0.0);

  // 0. soot underlay + burnt rim: darkens the floor so the glow keeps its hue on stone, snow and lava alike
  float soot = inside * (0.3 + 0.12 * G) * (0.72 + 0.56 * mottle) * mix(0.55, 1.0, calm);
  layer(cA, aA, vec3(0.03, 0.012, 0.012), soot);
  layer(cA, aA, cDeep * 0.55, insideHard * exp(-max(-d, 0.0) / 0.45) * 0.26 * (0.6 + 0.4 * G));
  float outD = max(d, 0.0) * (1.0 - insideHard);
  layer(cA, aA, vec3(0.02, 0.008, 0.008), (1.0 - insideHard) * exp(-outD / 0.14) * 0.4 * (0.6 + 0.4 * G));
  // falling-body warnings: a shadow that grows as the body comes down
  float shadowR = R * (0.12 + 0.88 * p * p);
  layer(cA, aA, vec3(0.0), meteor * insideHard * (1.0 - smoothstep(shadowR - 0.5, shadowR + 0.12, r)) * (0.2 + 0.3 * p));

  // 1. coloured alpha body of the filled part (the hue survives on snow where additive light goes pastel)
  layer(cA, aA, mix(cMain, cDeep, 0.3), filled * (0.1 + 0.3 * streak * wave) * wBody * (1.0 + 0.5 * G) * mix(0.7, 1.0, narrow) * calm);
  layer(cA, aA, cDeep, heat * 0.12 * wBody * calm);

  // 2. additive heat of the filled part: grainy, mottled, brightest right behind the sweep front
  float fillLit = filled * (0.03 + 0.24 * streak * grain * wave + 0.07 * edgeIn) * narrow * calm;
  gl += mix(cMain, cHot, clamp(heat * 0.7 + flow * 0.15, 0.0, 1.0)) * fillLit * wAdd;
  gl += cHot * heat * 0.17 * grain * wAdd * calm;

  // 3. travelling pulses: one soft ring born at the centre per second, a second one on bosses / metins (redd_meteo_circle's expanding discs)
  float pa = fract(t * 0.8 + vSeed * 0.131);
  float pw = exp(-pow((s - pa * 1.12) / (0.1 + 0.05 * pa), 2.0)) * (1.0 - pa) * inside;
  float pb = fract(t * 0.8 + vSeed * 0.131 + 0.5);
  float pw2 = exp(-pow((s - pb * 1.12) / (0.1 + 0.05 * pb), 2.0)) * (1.0 - pb) * inside * isBig;
  gl += cMain * (pw + pw2 * 0.8) * (0.11 + 0.12 * p) * wAdd * grain * (1.0 - 0.5 * filled);

  // 4. rim: three counter-rotating layers of broken, brush-tapered arcs (click_select). Cover grows with the progress: gaps close in.
  float cover = mix(0.5, 0.92, p);
  float spd = 1.0 + 1.6 * p;
  float segA = 1.5 * kS;
  float segB = 0.7 * kS;
  float segC = 1.05 * kS;
  float phA; float phB; float phC; float nA = 1.0e4; float nB = 1.0e4; float nC = 1.0e4;
  if (periodic) {
    nA = max(5.0, floor(TAU * rimR / segA + 0.5));
    nB = max(9.0, floor(TAU * rimR / segB + 0.5));
    nC = max(7.0, floor(TAU * rimR / segC + 0.5));
    phA = (ang + t * 0.22 * spd) / TAU * nA;
    phB = (ang - t * 0.36 * spd) / TAU * nB;
    phC = (ang + t * 0.12 * spd) / TAU * nC;
  } else {
    phA = (uu + t * 0.5 * spd) / segA;
    phB = (uu - t * 0.8 * spd) / segB;
    phC = (uu + t * 0.28 * spd) / segC;
  }
  float tA = arcShape(arcU(phA, nA, vSeed, cover));
  float tB = arcShape(arcU(phB, nB, vSeed + 5.0, cover * 0.8));
  float tC = arcShape(arcU(phC, nC, vSeed + 11.0, cover * 0.7));
  float dw = d + (gr2.g - 0.5) * 0.07 * kS; // grainy wobble: the arcs are never perfect circles
  float bandA = gband(dw, -0.14 * kS, 0.12 * kS * (0.3 + 0.7 * tA)) * tA;
  float bandB = gband(dw, -0.5 * kS, 0.07 * kS * (0.3 + 0.7 * tB)) * tB;
  float bandC = gband(dw, 0.1 * kS, 0.06 * kS * (0.3 + 0.7 * tC)) * tC;
  float rimGlow = gband(d, -0.18 * kS, 0.4 * kS); // the unbroken, very soft boundary read: where the damage is
  float rimLit = 0.6 + 0.4 * p;
  // alpha under-stroke (hue survives on snow) + the additive stroke
  layer(cA, aA, cDeep, bandA * 0.55 * wBody);
  layer(cA, aA, cDeep, bandB * 0.3 * wBody);
  gl += cMain * (bandA * 0.7 * grain + bandB * 0.55 + bandC * 0.4) * rimLit * wAdd;
  gl += cHot * bandA * bandA * 0.3 * wAdd * (0.4 + 0.8 * p);
  gl += cMain * rimGlow * (0.16 + 0.2 * p) * wAdd * inside * narrow * mix(0.45, 1.0, calm);
  layer(cA, aA, cDeep, rimGlow * inside * 0.14 * wBody * mix(0.5, 1.0, calm));
  // the rim of a warning that is about to land: arcs fuse into a soft closed ring
  float closing = smoothstep(0.8, 0.98, p);
  gl += cHot * gband(d, -0.15 * kS, 0.13 * kS) * closing * 0.4 * wAdd;

  // 5. direction chevrons (cone: claws sweeping out of the apex, line: running arrows) scrolling along the attack
  if (vKind > 0.5 && vKind < 2.5) {
    float ph;
    float env;
    if (vKind < 1.5) { ph = (l.y + abs(l.x) * 0.7) / 1.35 - t * (0.9 + p); env = smoothstep(0.5, 2.0, r) * (1.0 - smoothstep(R - 1.0, R - 0.2, r)); }
    else { ph = (l.y + abs(l.x) * 0.9) / 1.3 - t * (1.0 + 1.2 * p); env = smoothstep(0.2, 1.4, l.y) * (1.0 - smoothstep(vR2 - 0.9, vR2 - 0.1, l.y)); }
    float cv = exp(-pow((fract(ph) - 0.5) / 0.075, 2.0));
    float cvMask = env * insideHard * (1.0 - smoothstep(-0.2, -0.55, d) * 0.0);
    gl += mix(cMain, cHot, 0.4) * cv * cvMask * (0.16 + 0.28 * p) * wAdd * grain * calm;
    layer(cA, aA, cDeep, cv * cvMask * 0.12 * wBody * calm);
  }
  // lane origin cap: a bright bar where the charge starts
  if (vKind > 1.5 && vKind < 2.5) {
    float cap = exp(-pow(l.y / 0.22, 2.0)) * insideHard;
    gl += mix(cMain, cHot, 0.5) * cap * (0.12 + 0.2 * p) * wAdd * calm;
  }

  // 6. embers rising out of the filled part (soft glints, never single pixels)
#ifndef LOW
  float ds = vKind < 0.5 || vKind > 2.5 ? -1.0 : 1.0;
  float emb = emberCell(l / 0.55 + vec2(vSeed * 0.37, 0.0), vSeed, t, ds) + 0.6 * emberCell(l / 0.37 + vec2(3.1, vSeed * 0.21), vSeed + 17.0, t * 1.3, ds);
  gl += mix(cHot, vec3(1.0, 0.86, 0.6), 0.4) * emb * (filled * 0.8 + (1.0 - filled) * 0.14 * p) * inside * wAdd * (isBig * 0.35 + 0.65) * 1.1 * calm;
#endif

  // 7. molten seams (boss / metin): thin heat cracks in the filled part, different on every decal (seeded offset / spin)
#ifndef LOW
  if (isBig > 0.5) {
    float cs = cos(vSeed), sn = sin(vSeed);
    vec2 lr = vec2(cs * l.x - sn * l.y, sn * l.x + cs * l.y);
    float seam = texture2D(uGrain, lr * 0.055 + vec2(vSeed * 0.23, vSeed * 0.57)).b;
    float crack = 1.0 - smoothstep(0.0, 0.1, seam);
    float crackMask = filled * inside * (1.0 - smoothstep(R * 0.85, R, r) * 0.0) * (0.5 + 0.5 * heat);
    gl += mix(cMain, cHot, heat) * crack * crackMask * 0.5 * wAdd;
    layer(cA, aA, vec3(0.03, 0.01, 0.01), crack * filled * inside * 0.28);
  }
#endif

  // 8. rune band + sigil (boss / metin circles and rings): our own glyph set, lit around the ring by the sweep
#ifndef LOW
  if (isBig > 0.5 && (vKind < 0.5 || vKind > 2.5) && R > 2.6) {
    float rb0 = R - 1.1;
    float bw = 0.72;
    float inBand = step(rb0, r) * step(r, rb0 + bw) * insideHard * step(vR2 + 0.2, r);
    float nCell = max(8.0, floor(TAU * (rb0 + bw * 0.5) / (bw * 0.9)));
    float ph = (ang - t * 0.045) / TAU * nCell;
    float cid = mod(floor(ph), nCell);
    float gid = floor(hash11(cid * 2.37 + vSeed * 0.013) * 64.0);
    float gx = mod(gid, 8.0);
    float gy = floor(gid / 8.0);
    vec2 guv = vec2(fract(ph), clamp((r - rb0) / bw, 0.0, 1.0));
    vec2 auv = vec2((gx + 0.05 + guv.x * 0.9) / 8.0, (gy + 0.05 + (1.0 - guv.y) * 0.9) / 8.0);
    float gcov = texture2D(uGlyph, auv).r * inBand;
    float a01 = fract(ang / TAU + 0.5);
    float rev = smoothstep(a01 - 0.025, a01 + 0.025, p * 1.04);
    float flick = 0.8 + 0.2 * hash21(vec2(cid, floor(t * 3.0 + cid)));
    gl += mix(cMain, cHot, 0.35 + 0.4 * rev) * gcov * (0.2 + 0.7 * rev) * flick * 0.85 * wAdd;
    layer(cA, aA, cDeep, gcov * 0.26 * wBody * (0.4 + 0.6 * rev));
    // the guide lines of the band are broken thin arcs, never full circles
    float gd = gband(r, rb0, 0.03) + gband(r, rb0 + bw, 0.03);
    float gArc = arcMask((ang + t * 0.1) / TAU * 11.0, 11.0, vSeed + 3.0, 0.62);
    gl += cMain * gd * gArc * insideHard * 0.28 * wAdd;
    // medallion: faint spoked sun + tick ring at the heart (only when the circle is big enough to carry it)
    if (vKind < 0.5 && R > 3.2) {
      float rm = R * 0.3;
      float spokes = pow(abs(cos(ang * 7.0 + t * 0.08)), 5.0);
      float sun = spokes * (1.0 - smoothstep(0.1, rm, r)) * smoothstep(0.0, 0.3, r) * 0.5;
      float tick = step(0.5, fract(ang / TAU * 40.0)) * gband(r, rm, 0.05) * 0.5;
      gl += mix(cMain, cHot, 0.3) * (sun + tick) * insideHard * (0.35 + 0.35 * p) * wAdd;
    }
  }
#endif

  // 9. falling-body warnings (boss meteor) and metin drops: three thin rings contracting onto the impact point
  float ringsOn = max(meteor, isMetin * 0.8);
  if (ringsOn > 0.0) {
    for (int k = 0; k < 3; k++) {
      float u = fract(t * 1.05 + float(k) / 3.0);
      float rk = R * (1.18 - 0.98 * u);
      float wk = gband(r, rk, 0.07 * kS + 0.04 * u);
      gl += mix(cMain, cHot, 0.5) * wk * sin(u * PI) * ringsOn * (0.2 + 0.4 * p) * wAdd * insideHard;
    }
  }

  // 10. sweep front: a hot soft band with a bright grainy lip
  gl += cHot * front * (0.45 + 0.3 * p) * grain * wAdd * mix(0.7, 1.0, calm);
  layer(cA, aA, cDeep, front * 0.18 * wBody * calm);

  // 11. resolve: no white wash. Impact is the last 15 %: the fill brightens a little, arcs close; the release fade shows
  // one hot ring racing through the shape (the sim freed the decal; vAux = fade progress)
  float rr = rel * 1.25;
  float relRing = exp(-pow((s - rr) / 0.12, 2.0)) * inside * (1.0 - rel);
  gl += cHot * relRing * 1.1 * wAdd;

  float fade = vAlpha * (rel > 0.0 ? (1.0 - smoothstep(0.0, 0.85, rel)) : 1.0);
  vec3 rgb = (cA + gl) * fade;
  float outA = aA * fade;
  if (max(max(rgb.r, rgb.g), rgb.b) < 0.003 && outA < 0.003) discard;
  gl_FragColor = vec4(rgb, outA);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------------------------------------------------------
// Telegraphs system

/**
 * how much the fills of ordinary (owner 0) warnings are calmed when `n` of them are on screen at once: 1 up to 5, then -6 % each,
 * floor 0.4 (the shader never dims boss / metin warnings and never the broken arcs of the rim)
 */
export function crowdCalm(n: number): number {
  return Math.min(1, Math.max(0.4, 1 - 0.06 * (n - 5)));
}

/** optional per-row fields the sim store has (the minimal TelegraphFeed type does not list them; coop / demo feeds lack them) */
interface RichFeed {
  readonly element?: ArrayLike<number>;
  readonly aux?: ArrayLike<number>;
  readonly act?: ArrayLike<number>;
  readonly follow?: ArrayLike<number>;
  readonly knock?: ArrayLike<number>;
  readonly dur?: ArrayLike<number>;
}

/** Hero collision radius padding (m) for determining whether a telegraph danger region covers the local hero. */
const HERO_HIT_PAD = 0.55;

/**
 * Signed distance (m) from world point (px, pz) to the telegraph's actual danger region (<= 0 means inside the hazard;
 * > 0 is distance outside the boundary of the circle, ring/annulus, line/rect, or cone/arc).
 */
export function telegraphSignedDist(
  shape: number,
  ox: number,
  oz: number,
  rot: number,
  radius: number,
  length: number,
  width: number,
  px: number,
  pz: number,
): number {
  const dx = px - ox;
  const dz = pz - oz;
  if (shape === TG_CIRCLE) return Math.hypot(dx, dz) - radius;
  if (shape === TG_RING) {
    const r = Math.hypot(dx, dz);
    return Math.max(r - radius, length - r);
  }
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const lx = c * dx - s * dz;
  const lz = s * dx + c * dz;
  if (shape === TG_LINE) {
    const hw = width * 0.5;
    const hl = length * 0.5;
    const qx = Math.abs(lx) - hw;
    const qz = Math.abs(lz - hl) - hl;
    return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
  }
  if (shape === TG_CONE) {
    const half = Math.min(Math.PI, Math.max(0.05, width * 0.5));
    const ax = Math.abs(lx);
    const l = Math.hypot(ax, lz) - radius;
    const cs = Math.sin(half);
    const cc = Math.cos(half);
    const proj = Math.max(0, Math.min(radius, ax * cs + lz * cc));
    const m = Math.hypot(ax - cs * proj, lz - cc * proj);
    const side = cc * ax - cs * lz >= 0 ? 1 : -1;
    return Math.max(l, m * side);
  }
  return Math.hypot(dx, dz) - radius;
}

/**
 * Selects up to `cap` telegraphs in priority order:
 *  1. Danger region intersects/covers the local hero (`covers`)
 *  2. Boss/metin/hazard severity (`major`), with reserved capacity for non-covering boss/metin warnings
 *  3. Soonest resolve time (`rem`)
 *  4. Proximity to the danger boundary (`dist`), then origin distance² (`d2`)
 */
export function selectPriorityTelegraphs(
  idx: Int32Array,
  covers: Uint8Array,
  major: Uint8Array,
  rem: Float32Array,
  dist: Float32Array,
  d2: Float32Array,
  n: number,
  cap: number,
): number {
  const better = (
    ac: number,
    am: number,
    ar: number,
    ad: number,
    ad2: number,
    bc: number,
    bm: number,
    br: number,
    bd: number,
    bd2: number,
  ): boolean => {
    if (ac !== bc) return ac > bc;
    if (am !== bm) return am > bm;
    if (Math.abs(ar - br) > 1e-4) return ar < br;
    if (Math.abs(ad - bd) > 1e-4) return ad < bd;
    return ad2 < bd2;
  };

  for (let i = 1; i < n; i++) {
    const iv = idx[i] as number;
    const cv = covers[i] as number;
    const mv = major[i] as number;
    const rv = rem[i] as number;
    const dv = dist[i] as number;
    const d2v = d2[i] as number;
    let j = i - 1;
    while (
      j >= 0 &&
      better(
        cv,
        mv,
        rv,
        dv,
        d2v,
        covers[j] as number,
        major[j] as number,
        rem[j] as number,
        dist[j] as number,
        d2[j] as number,
      )
    ) {
      idx[j + 1] = idx[j] as number;
      covers[j + 1] = covers[j] as number;
      major[j + 1] = major[j] as number;
      rem[j + 1] = rem[j] as number;
      dist[j + 1] = dist[j] as number;
      d2[j + 1] = d2[j] as number;
      j--;
    }
    idx[j + 1] = iv;
    covers[j + 1] = cv;
    major[j + 1] = mv;
    rem[j + 1] = rv;
    dist[j + 1] = dv;
    d2[j + 1] = d2v;
  }

  const keep = n < cap ? n : cap;
  if (n > cap && cap > 0) {
    // Reserve bounded capacity for visible boss/metin warnings even when cap ordinary warnings cover the hero.
    const reserve = cap >= 4 ? Math.min(4, cap >> 2) : 1;
    let majorInCap = 0;
    for (let k = 0; k < keep; k++) if (major[k] === 1) majorInCap++;
    let tail = keep - 1;
    for (let k = keep; k < n && majorInCap < reserve; k++) {
      if (major[k] !== 1) continue;
      while (tail >= 0 && major[tail] === 1) tail--;
      if (tail < 0) break;
      const ti = idx[tail] as number;
      idx[tail] = idx[k] as number;
      idx[k] = ti;
      const tc = covers[tail] as number;
      covers[tail] = covers[k] as number;
      covers[k] = tc;
      const tm = major[tail] as number;
      major[tail] = major[k] as number;
      major[k] = tm;
      const tr = rem[tail] as number;
      rem[tail] = rem[k] as number;
      rem[k] = tr;
      const td = dist[tail] as number;
      dist[tail] = dist[k] as number;
      dist[k] = td;
      const td2 = d2[tail] as number;
      d2[tail] = d2[k] as number;
      d2[k] = td2;
      majorInCap++;
      tail--;
    }
  }
  return keep;
}

export class Telegraphs implements RenderSystem {
  readonly name = 'telegraphs';
  /** set by the owner (RenderWorld) before each frame */
  feed: TelegraphFeed | null = null;
  /** debug counters */
  readonly stats = { entries: 0, drawn: 0, heights: 0 };

  private readonly core: RenderCore;
  private grid: DecalGrid;
  private readonly uniforms: Record<string, IUniform>;
  private cap: number;
  private d2 = new Float32Array(256);
  private dist = new Float32Array(256);
  private rem = new Float32Array(256);
  private covers = new Uint8Array(256);
  private major = new Uint8Array(256);
  private idx = new Int32Array(256);
  private slotOf = new Int32Array(256);
  private readonly unsub: () => void;
  private readonly grainTex: DataTexture;
  private glyphTex: DataTexture;
  private lite = false;
  private readonly gcol = new Color();

  constructor(core: RenderCore) {
    this.core = core;
    this.lite = core.quality.tier === 'low';
    const grain = new DataTexture(makeGrainData(), GRAIN_SIZE, GRAIN_SIZE, RGBAFormat, UnsignedByteType);
    grain.wrapS = RepeatWrapping;
    grain.wrapT = RepeatWrapping;
    grain.minFilter = LinearFilter;
    grain.magFilter = LinearFilter;
    grain.generateMipmaps = false;
    grain.needsUpdate = true;
    this.grainTex = grain;
    // the glyph atlas is only read by the full-quality shader: the low tier gets a 1x1 stand-in (no 160 ms bake)
    const glyph = this.lite
      ? new DataTexture(new Uint8Array([0]), 1, 1, RedFormat, UnsignedByteType)
      : new DataTexture(makeGlyphAtlas(), GLYPH_ATLAS_SIZE, GLYPH_ATLAS_SIZE, RedFormat, UnsignedByteType);
    glyph.minFilter = LinearFilter;
    glyph.magFilter = LinearFilter;
    glyph.generateMipmaps = false;
    glyph.needsUpdate = true;
    this.glyphTex = glyph;
    this.uniforms = { uTime: { value: 0 }, uGround: { value: 0.3 }, uCrowd: { value: 1 }, uGrain: { value: grain }, uGlyph: { value: glyph } };
    this.cap = core.quality.profile.decalCap;
    this.grid = this.makeGrid(this.cap);
    core.scene.add(this.grid.mesh);
    this.unsub = core.quality.onChange((p) => this.onQuality(p));
  }

  update(dt: number, _alpha?: number): void {
    const feed = this.feed;
    const grid = this.grid;
    const slots = grid.slots;
    const n = feed ? feed.count : 0;
    if (n === 0 && slots.high === 0) {
      grid.mesh.visible = false;
      return;
    }
    // candidates: visible decals prioritized by hero-coverage, boss/metin severity, resolve time, and danger proximity
    let m = 0;
    if (feed && n > 0) {
      if (n > this.idx.length) {
        this.d2 = new Float32Array(n * 2);
        this.dist = new Float32Array(n * 2);
        this.rem = new Float32Array(n * 2);
        this.covers = new Uint8Array(n * 2);
        this.major = new Uint8Array(n * 2);
        this.idx = new Int32Array(n * 2);
        this.slotOf = new Int32Array(n * 2);
      }
      const fx = this.core.rig.focus.x;
      const fz = this.core.rig.focus.z;
      const rig = this.core.rig;
      const rich = feed as unknown as RichFeed;
      const durArr = rich.dur;
      for (let i = 0; i < n; i++) {
        const shape = feed.shape[i] as number;
        const radius = feed.radius[i] as number;
        const length = feed.length[i] as number;
        const width = feed.width[i] as number;
        const reach = shape === TG_LINE ? length : radius;
        if (reach <= 0.01) continue;
        const x = feed.x[i] as number;
        const z = feed.z[i] as number;
        if (!rig.isVisible(x, z, reach + 1.2)) continue;
        const rot = feed.rot[i] as number;
        const sd = telegraphSignedDist(shape, x, z, rot, radius, length, width, fx, fz);
        const dx = x - fx;
        const dz = z - fz;
        const prog = feed.progress[i] as number;
        const dur = durArr ? (durArr[i] as number) : 0;
        const owner = feed.owner[i] as number;
        this.covers[m] = sd <= HERO_HIT_PAD ? 1 : 0;
        this.major[m] = owner > 0 ? 1 : 0;
        this.rem[m] = dur > 0 ? Math.max(0, dur * (1 - prog)) : Math.max(0, 1 - prog);
        this.dist[m] = sd > 0 ? sd : 0;
        this.d2[m] = dx * dx + dz * dz;
        this.idx[m] = i;
        m++;
      }
    }
    const keep = selectPriorityTelegraphs(this.idx, this.covers, this.major, this.rem, this.dist, this.d2, m, this.cap);
    let trash = 0;
    if (feed) for (let k = 0; k < keep; k++) if ((feed.owner[this.idx[k] as number] as number) === 0) trash++;
    slots.begin();
    if (feed) {
      const rich = feed as unknown as RichFeed;
      // pass 1: match against last frame's slots; pass 2: new decals take the remaining slots
      for (let k = 0; k < keep; k++) {
        const i = this.idx[k] as number;
        const slot = slots.match(
          feed.shape[i] as number,
          feed.owner[i] as number,
          feed.x[i] as number,
          feed.z[i] as number,
          feed.rot[i] as number,
          feed.radius[i] as number,
          feed.length[i] as number,
          feed.width[i] as number,
          feed.progress[i] as number,
        );
        this.slotOf[k] = slot;
        if (slot >= 0) this.writeExtra(grid, slot, feed, rich, i);
      }
      for (let k = 0; k < keep; k++) {
        if ((this.slotOf[k] as number) >= 0) continue;
        const i = this.idx[k] as number;
        const slot = slots.create(
          feed.shape[i] as number,
          feed.owner[i] as number,
          feed.x[i] as number,
          feed.z[i] as number,
          feed.rot[i] as number,
          feed.radius[i] as number,
          feed.length[i] as number,
          feed.width[i] as number,
          feed.progress[i] as number,
        );
        if (slot >= 0) {
          this.writeExtra(grid, slot, feed, rich, i);
          this.announce(feed, rich, i);
        }
      }
    }
    slots.end(dt);
    this.uniforms.uTime!.value = this.core.clock.time;
    this.uniforms.uGround!.value = this.groundBrightness();
    this.uniforms.uCrowd!.value = crowdCalm(trash);
    grid.commit(this.core.heightAt);
    this.stats.entries = n;
    this.stats.drawn = slots.liveCount;
    this.stats.heights = grid.heightsComputed;
  }

  /** Call when the terrain under live decals changed without swapping `core.heightAt` (a swap is detected automatically). */
  invalidateTerrain(): void {
    this.grid.invalidate();
  }

  dispose(): void {
    this.unsub();
    this.core.scene.remove(this.grid.mesh);
    this.grid.dispose();
    this.grainTex.dispose();
    this.glyphTex.dispose();
  }

  /** per-slot payload: p4 = (warning colour rgb, flags = element + 16 * falling-body) */
  private writeExtra(grid: DecalGrid, slot: number, feed: TelegraphFeed, rich: RichFeed, i: number): void {
    const owner = feed.owner[i] as number;
    const element = rich.element ? (rich.element[i] as number) : 0;
    const aux = rich.aux ? (rich.aux[i] as number) : 0;
    const meteor = this.isMeteor(feed, rich, i);
    const rgb = linearRgb(warnHex(owner, element, aux));
    const e = grid.extra;
    const o = slot * 4;
    e[o] = rgb[0] as number;
    e[o + 1] = rgb[1] as number;
    e[o + 2] = rgb[2] as number;
    e[o + 3] = (element & 7) + (meteor ? 16 : 0);
  }

  private isMeteor(feed: TelegraphFeed, rich: RichFeed, i: number): boolean {
    if (!rich.act) return false;
    return isFallingBody(
      feed.owner[i] as number,
      feed.shape[i] as number,
      rich.act[i] as number,
      rich.follow ? (rich.follow[i] as number) : 0,
      feed.radius[i] as number,
      rich.knock ? (rich.knock[i] as number) : 99,
    );
  }

  /** a decal starts: hand it to the vfx layer (route in vfx/common/telegraphs) when it deserves sprites */
  private announce(feed: TelegraphFeed, rich: RichFeed, i: number): void {
    const hook = telegraphHook.onBegin;
    if (hook === null) return;
    const owner = feed.owner[i] as number;
    const shape = feed.shape[i] as number;
    const radius = feed.radius[i] as number;
    const length = feed.length[i] as number;
    if (!wantsSpriteLayer(owner, shape, radius, length)) return;
    const progress = feed.progress[i] as number;
    if (progress > 0.15) return;
    hook({
      owner,
      shape,
      x: feed.x[i] as number,
      z: feed.z[i] as number,
      rot: feed.rot[i] as number,
      radius,
      length,
      width: feed.width[i] as number,
      element: rich.element ? (rich.element[i] as number) : 0,
      aux: rich.aux ? (rich.aux[i] as number) : 0,
      dur: rich.dur ? (rich.dur[i] as number) : 0,
      progress,
      meteor: this.isMeteor(feed, rich, i),
      impact: rich.act ? isImpactAct(rich.act[i] as number) : false,
    });
  }

  /** how bright the zone's ground reads (0 dark lava / stone .. 1 snow): from the hemisphere ground colour of the biome */
  private groundBrightness(): number {
    const c = this.gcol.copy(this.core.env.hemi.groundColor);
    const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    return Math.min(1, Math.max(0, (Math.sqrt(lum) - 0.26) / 0.22));
  }

  private makeGrid(cap: number): DecalGrid {
    this.lite = this.core.quality.tier === 'low';
    const grid = new DecalGrid({
      cap,
      rect: telegraphRect,
      fragmentShader: TG_FRAG,
      uniforms: this.uniforms,
      defines: this.lite ? { LOW: 1 } : {},
      renderOrder: -20,
      name: 'telegraphs',
      slots: { fadeOut: 0.2, fadeIn: 0.12, monotonic: true, maxMove: 3 },
    });
    // the shader outputs premultiplied colour: alpha-over for the dark underlay + additive glow in ONE draw call
    (grid.mesh.material as ShaderMaterial).premultipliedAlpha = true;
    return grid;
  }

  private onQuality(p: QualityProfile): void {
    if (p.decalCap === this.cap && (p.tier === 'low') === this.lite) return;
    this.cap = p.decalCap;
    this.core.scene.remove(this.grid.mesh);
    this.grid.dispose();
    this.grid = this.makeGrid(this.cap);
    if (!this.lite && this.glyphTex.image.width === 1) this.bakeGlyphs();
    this.core.scene.add(this.grid.mesh);
  }

  /** the rune atlas is baked lazily: the low tier never needs it, a later upgrade to a full tier does */
  private bakeGlyphs(): void {
    const old = this.glyphTex;
    const tex = new DataTexture(makeGlyphAtlas(), GLYPH_ATLAS_SIZE, GLYPH_ATLAS_SIZE, RedFormat, UnsignedByteType);
    tex.minFilter = LinearFilter;
    tex.magFilter = LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    this.glyphTex = tex;
    this.uniforms.uGlyph!.value = tex;
    old.dispose();
  }
}
