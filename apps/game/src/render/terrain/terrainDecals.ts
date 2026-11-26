// GLSL for the terrain shader's procedural ground dressing: up to 6 decal families (pebbles, leaves, scratches, crack
// networks, specks, wind ridges, per-cell tint; zones core C8: glints, scuffs, soft embers, fissures) and the central
// ritual seal. Evaluated per pixel from world position only: no geometry, no draw calls, no textures beyond the shared
// noise. Spec -> uniforms lives in terrainMaterial.ts.
//
// Contract with the host shader (terrainMaterial.ts): `uNoise`, `uTime`, `uWindDir`, the global
// `gLW[8]` per-layer weights and `gDecalSun` (unit xz vector towards the sun) are declared before this chunk, and the
// defines DECALS (uniform array length, 4 or 6) and DECALS_V2 (the C8 kinds are compiled in) are set by the material.
// `fall(lo, hi, x)` is 1 at x <= lo and 0 at x >= hi (a well-defined stand-in for smoothstep(hi, lo, x)).
import type { DecalKind, DecalSpec } from './look/types';

/**
 * Decal kinds added by the zones core C8 (appended after the C0 `DecalKind` union of look/types.ts):
 *  - `glint`: sparse twinkling glitter points (ice / frost), round and pixel-aware, never a 4-point star; cluster them
 *    with `patch`. `size` = point radius (m), `emissive` = flash strength.
 *  - `scuff`: soft trampled / worn blots (irregular, no rim) that multiply the ground by mix(a, b); replaces ink puddles.
 *    `size` = blot radius (m, <= 0.45 * cell).
 *  - `ember`: the soft round variant of `speck` (at least ~2 px wide, smooth falloff, energy spread so bloom stays round).
 *  - `fissure`: wide glowing cracks (`size` = width in metres, 0.3-1) along a voronoi network of `cell` metres that runs
 *    along the relief (contour-aligned on slopes); `density` = share of the borders that crack; clustered by the baked
 *    liquid / lava proximity: `canopy` (0..1, here the proximity weight) = 0 everywhere, 1 only near the lava / shore band.
 */
export type DecalKindV2 = DecalKind | 'glint' | 'scuff' | 'ember' | 'fissure';
export type DecalSpecV2 = Omit<DecalSpec, 'kind'> & { kind: DecalKindV2 };

/** Typed constructor for a decal family of any kind (incl. the C8 kinds) inside look/<zone>.ts `decals: [...]`. */
export function decal(spec: DecalSpecV2): DecalSpec {
  return spec as unknown as DecalSpec;
}

/** shader id of every kind (0 = empty slot) */
export const DECAL_KIND_ID: Record<DecalKindV2, number> = { pebble: 1, leaf: 2, scratch: 3, crack: 4, speck: 5, streak: 6, cell: 7, glint: 8, scuff: 9, ember: 10, fissure: 11 };

/** true when a decal list needs the C8 code path */
export function usesDecalsV2(decals: readonly DecalSpec[]): boolean {
  return decals.some((d) => (DECAL_KIND_ID[d.kind as DecalKindV2] ?? 0) >= 8);
}

export const DECAL_GLSL = /* glsl */ `
uniform vec4 uDK[DECALS];
uniform int uDecalCount;
uniform vec4 uDA[DECALS];
uniform vec4 uDB[DECALS];
uniform vec4 uDM0[DECALS];
uniform vec4 uDM1[DECALS];
uniform vec4 uDX[DECALS];
uniform vec4 uDP[DECALS];
uniform vec4 uSeal;
uniform vec4 uSealCol;
uniform vec4 uSealOpt;
uniform vec4 uSealOpt2;
uniform vec4 uSealBand;
uniform vec3 uSealBandCol;

float fall(float lo, float hi, float x) {
  return 1.0 - smoothstep(lo, hi, x);
}

float dHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 dHash2(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

mat2 dRot(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c);
}

#ifdef DECALS_V2
// C8 kinds (8 glint, 9 scuff, 10 ember, 11 fissure). liq: baked liquid / lava proximity 0..1; Ng: geometric normal.
void groundDecalsV2(inout vec3 alb, inout vec3 emi, vec2 wxz, float pix, float ao, float liq, vec3 Ng, int s, float kind, float cov0) {
  vec4 k = uDK[s];
  float cell = k.y;
  float dens = k.z;
  float size = k.w;
  vec3 colA = uDA[s].rgb;
  vec3 colB = uDB[s].rgb;
  float emis = uDA[s].a;
  float seed = uDX[s].w;
  if (kind > 10.5) {
    // fissure: wide relief-following cracks with a molten core, a charred lip and a heat bleed, hugging the lava band
    float gate = mix(1.0, smoothstep(0.03, 0.45, liq), clamp(uDX[s].x, 0.0, 1.0));
    float cov = cov0 * gate;
    if (cov < 0.01) return;
    // contour-aligned frame: the voronoi cells are squeezed across the slope, so the long borders run along the relief
    vec2 gd = Ng.xz;
    float gl = length(gd);
    vec2 ax = gl > 1e-3 ? gd / gl : vec2(1.0, 0.0);
    float an = smoothstep(0.04, 0.3, gl);
    vec2 pr = vec2(dot(wxz, vec2(-ax.y, ax.x)), dot(wxz, ax) * (1.0 + 1.6 * an));
    vec2 p = pr / cell + seed;
    vec4 wa = texture2D(uNoise, wxz / (cell * 6.0) + float(s) * 0.29);
    float jag = texture2D(uNoise, wxz / (cell * 2.0) + 0.53).b - 0.5;
    p += (wa.gb - 0.5) * 1.5 + vec2(jag, -jag) * 0.22;
    vec2 g = floor(p);
    vec2 fp = fract(p);
    float d1 = 9.0;
    float d2 = 9.0;
    vec2 n1 = g;
    vec2 n2 = g;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 o = vec2(float(i), float(j));
        vec2 r = o + dHash2(g + o) - fp;
        float d = dot(r, r);
        if (d < d1) { d2 = d1; n2 = n1; d1 = d; n1 = g + o; }
        else if (d < d2) { d2 = d; n2 = g + o; }
      }
    }
    float pairH = dHash(n1 + n2);
    if (step(dHash(n1 + n2 + 5.5), dens) < 0.5) return;
    // edge distance in metres (cell units x cell); width pinches out along the crack
    float edgeM = (sqrt(d2) - sqrt(d1)) * cell / (1.0 + 0.8 * an);
    float pinch = smoothstep(0.2, 0.7, texture2D(uNoise, wxz / (cell * 1.7) + pairH * 3.1).b);
    float w = max(size * (0.3 + 0.7 * pinch) * (0.7 + 0.6 * dHash(n1 + n2 + 2.2)), pix * 1.2);
    float core = 1.0 - smoothstep(w * 0.18, w * 0.5, edgeM);
    float lip = fall(w * 0.4, w * 1.6, edgeM) * (1.0 - core);
    float bleed = fall(0.0, w * 3.5, edgeM);
    float flick = 0.82 + 0.18 * sin(uTime * 1.9 + pairH * 13.0);
    float calmR = mix(0.45, 1.0, smoothstep(3.0, 11.0, distance(wxz, uFocus.xz)));
    alb *= 1.0 - lip * 0.45 * cov;
    alb = mix(alb, colA * 0.3, core * cov);
    float hotK = 1.0 - smoothstep(0.0, w * 0.22, edgeM);
    emi += mix(colA, colB, hotK) * (emis * core * cov * flick * calmR);
    emi += colA * (emis * 0.12 * bleed * bleed * cov * flick * calmR);
    return;
  }
  vec2 cp = wxz / cell;
  vec2 id = floor(cp) + seed * 17.0;
  vec2 f = (fract(cp) - 0.5) * cell;
  vec2 h1 = dHash2(id);
  vec2 h2 = dHash2(id + 7.7);
  float dd = dens * (1.0 + clamp((1.0 - ao) * uDX[s].x, 0.0, 3.0));
  if (h1.x > dd) return;
  if (kind < 8.5) {
    // glint: a point of light that flashes now and then (round, at least ~1.2 px, never a star)
    vec2 q = f - (h2 - 0.5) * max(cell - 2.0 * size, 0.0);
    float r = max(size * (0.6 + 0.8 * h1.y), pix * 1.2);
    float c = fall(0.0, r, length(q));
    c *= c;
    float tw = 0.5 + 0.5 * sin(uTime * (0.9 + 2.2 * h1.y) + h2.x * 40.0);
    tw *= tw;
    tw *= tw;
    vec3 col = mix(colA, colB, h2.y);
    alb = mix(alb, col, c * cov0 * 0.35);
    emi += col * (emis * c * cov0 * (0.12 + 0.88 * tw));
  } else if (kind < 9.5) {
    // scuff: soft irregular blot multiplied into the ground (no rim, no ink)
    float sz = size * (0.6 + 0.8 * h1.y);
    vec2 q = dRot(h2.x * 6.2831) * (f - (h2 - 0.5) * max(cell - 2.2 * sz, 0.0));
    float wob = (texture2D(uNoise, wxz * (0.35 / max(size, 0.05)) + h2 * 3.1).g - 0.5) * 0.8;
    float d = length(q / vec2(sz, sz * (0.55 + 0.4 * h2.y))) + wob;
    float c = fall(0.3, 1.0, d);
    alb *= mix(vec3(1.0), mix(colA, colB, h2.y), c * cov0);
  } else {
    // ember: soft round glowing speck; the energy is spread over >= 2 px so the bloom stays round
    vec2 q = f - (h2 - 0.5) * max(cell - 2.6 * size, 0.0);
    float r = max(size * (0.7 + 0.6 * h1.y), pix * 2.0);
    float d = length(q) / r;
    float c = fall(0.0, 1.0, d);
    c = c * c * (3.0 - 2.0 * c);
    float tw = 0.7 + 0.3 * sin(uTime * (1.2 + 1.6 * h1.y) + h2.x * 40.0);
    vec3 col = mix(colA, colB, h2.y);
    float spread = clamp(size / r, 0.25, 1.0);
    alb = mix(alb, col * 0.5, c * cov0 * 0.5);
    emi += col * (emis * c * cov0 * tw * spread * spread);
  }
}
#endif

// alb: ground albedo (in/out); emi: emissive radiance (in/out); ao: baked occlusion (1 = open);
// noGround: 0..1 how much this pixel is a cliff face (decals only dress the ground);
// liq: baked liquid / lava proximity 0..1 and Ng: geometric normal (C8 kinds only)
void groundDecals(inout vec3 alb, inout vec3 emi, vec2 wxz, float pix, float dist, float ao, float noGround, float liq, vec3 Ng) {
  for (int s = 0; s < uDecalCount; s++) {
    vec4 k = uDK[s];
    float kind = k.x;
    float mask = dot(vec4(gLW[0], gLW[1], gLW[2], gLW[3]), uDM0[s]) + dot(vec4(gLW[4], gLW[5], gLW[6], gLW[7]), uDM1[s]);
    float cov0 = mask * fall(uDX[s].y, uDX[s].z, dist) * (1.0 - noGround) * uDB[s].a;
    if (cov0 < 0.01 || kind < 0.5) continue;
    if (uDP[s].x > 0.0) cov0 *= smoothstep(uDP[s].y, uDP[s].z, texture2D(uNoise, wxz / uDP[s].x + float(s) * 0.37).r);
#ifdef DECALS_V2
    if (kind > 7.5) {
      groundDecalsV2(alb, emi, wxz, pix, ao, liq, Ng, s, kind, cov0);
      continue;
    }
#endif
    float cell = k.y;
    float dens = k.z;
    float size = k.w;
    vec3 colA = uDA[s].rgb;
    vec3 colB = uDB[s].rgb;
    float emis = uDA[s].a;
    float seed = uDX[s].w;

    if (kind > 6.5) {
      // per-cell tint (multiply): weathered flagstones, stain patches
      vec2 w = (texture2D(uNoise, wxz * 0.11).rg - 0.5) * 0.35;
      float h = dHash(floor(wxz / cell + w) + seed);
      alb *= mix(vec3(1.0), mix(colA, colB, h), dens * cov0);
      continue;
    }
    if (kind > 5.5) {
      // wind ridges (sastrugi): lighter / darker bands elongated along the wind
      vec2 wd = uWindDir;
      vec2 pd = vec2(-wd.y, wd.x);
      float across = dot(wxz, pd);
      float along = dot(wxz, wd);
      float warp = (texture2D(uNoise, wxz * 0.018).g - 0.5) * 3.2 + (texture2D(uNoise, vec2(along, across) * 0.06).b - 0.5) * 0.9;
      float u = across / cell + warp;
      float fr = fract(u);
      float prof = fr < 0.72 ? fr / 0.72 : (1.0 - fr) / 0.28;
      float seg = smoothstep(0.32, 0.68, texture2D(uNoise, vec2(along * 0.035, floor(u) * 0.173)).r);
      float calm = fall(0.6, 1.8, pix / cell * 8.0);
      float rel = (prof - 0.5) * seg * calm;
      alb *= 1.0 + rel * dens * 0.9 * cov0;
      alb += vec3(0.05, 0.055, 0.07) * smoothstep(0.88, 1.0, prof) * seg * calm * dens * cov0 * 2.0;
      continue;
    }
    if (kind > 3.5 && kind < 4.5) {
      // crack network: voronoi cell borders, width varies along the crack. uDP.w > 0 = domain-warped fissures (meandering,
      // per-crack width, hot core + glow halo when emissive); 0 keeps the plain straight-border network.
      float wp = uDP[s].w;
      vec2 p = wxz / cell + seed;
      if (wp > 0.0) {
        // one cell-sized meander + a faint jag; amplitudes stay below the fold limit so no extra borders appear
        vec4 wa = texture2D(uNoise, wxz / (cell * 6.0) + float(s) * 0.29);
        float jag = texture2D(uNoise, wxz / (cell * 2.0) + 0.53).b - 0.5;
        p += (wa.gb - 0.5) * (1.5 * wp) + vec2(jag, -jag) * (0.22 * wp);
      }
      vec2 g = floor(p);
      vec2 fp = fract(p);
      float d1 = 9.0;
      float d2 = 9.0;
      vec2 n1 = g;
      vec2 n2 = g;
      for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
          vec2 o = vec2(float(i), float(j));
          vec2 r = o + dHash2(g + o) - fp;
          float d = dot(r, r);
          if (d < d1) { d2 = d1; n2 = n1; d1 = d; n1 = g + o; }
          else if (d < d2) { d2 = d; n2 = g + o; }
        }
      }
      float edge = sqrt(d2) - sqrt(d1);
      float vary = 0.45 + 1.1 * texture2D(uNoise, wxz * 0.07 + float(s)).g;
      float pairH = dHash(n1 + n2);
      if (wp > 0.0) {
        // per-crack width (hairlines next to wide fissures) that pinches out along its length
        float pinch = smoothstep(0.25, 0.65, texture2D(uNoise, wxz / (cell * 1.7) + pairH * 3.1).b);
        vary *= (0.35 + 1.3 * dHash(n1 + n2 + 2.2)) * (0.25 + 0.75 * pinch);
      }
      float width = max(dens * vary, pix / cell * 0.9);
      float edgeOn = step(dHash(n1 + n2 + 5.5), size > 0.0 ? size : 1.0);
      float c = (1.0 - smoothstep(width * 0.12, width, edge)) * edgeOn;
      float halo = fall(0.0, width * 4.0, edge) * edgeOn;
      float flick = 0.75 + 0.25 * sin(uTime * 2.3 + pairH * 11.0);
      alb *= 1.0 - halo * 0.22 * cov0;
      alb = mix(alb, mix(colA, colB, pairH) * (emis > 0.0 ? 0.35 : 1.0), c * cov0);
      if (wp > 0.0 && emis > 0.0) {
        // molten fissure: white-hot core fading to the rim colour, heat bleeding onto the scorched lip; dimmed inside the
        // combat radius so the glow frames the fight instead of competing with the hero and the telegraphs
        float core = 1.0 - smoothstep(0.0, width * 0.5, edge);
        float glow = fall(0.0, width * 7.0, edge) * edgeOn;
        float calm = mix(0.4, 1.0, smoothstep(3.0, 11.0, distance(wxz, uFocus.xz)));
        emi += mix(colA, colB, core) * (emis * c * cov0 * flick * calm);
        emi += colA * (emis * 0.16 * glow * glow * cov0 * flick * calm);
      } else {
        emi += mix(colA, colB, 0.5 + 0.5 * sin(uTime * 1.7 + pairH * 30.0)) * (emis * c * cov0) * flick;
      }
      continue;
    }

    vec2 cp = wxz / cell;
    vec2 id = floor(cp) + seed * 17.0;
    vec2 f = (fract(cp) - 0.5) * cell;
    vec2 h1 = dHash2(id);
    vec2 h2 = dHash2(id + 7.7);
    float dd = dens * (1.0 + clamp((1.0 - ao) * uDX[s].x, 0.0, 3.0));
    if (h1.x > dd) continue;
    float sz = size * (0.6 + 0.8 * h1.y);
    vec2 off = (h2 - 0.5) * max(cell - 2.6 * sz, 0.0);
    vec2 q = f - off;
    mat2 R = dRot(h1.y * 6.2831);
    vec2 qr = R * q;

    if (kind < 1.5) {
      // pebble: shaded stone with a contact shadow away from the sun
      float aspect = 0.62 + 0.38 * h2.x;
      float d = length(qr / vec2(sz, sz * aspect));
      float aa = max(0.1, pix / sz);
      float c = 1.0 - smoothstep(1.0 - aa * 1.6, 1.0, d);
      float lit = clamp(dot(q / max(sz, 1e-3), gDecalSun) * 0.55 + 0.4, 0.0, 1.0);
      vec3 col = mix(colA, colB, h2.y) * (0.62 + 0.62 * lit) * (1.0 - 0.3 * d * d);
      float sh = fall(0.5, 1.25, length((q + gDecalSun * sz * 0.55) / (sz * 1.1))) * (1.0 - c);
      alb *= 1.0 - sh * 0.5 * cov0;
      alb = mix(alb, col, c * cov0);
    } else if (kind < 2.5) {
      // leaf: lens shape with a mid-rib
      float len = sz * 1.5;
      float wid = sz * 0.5 * (0.8 + 0.4 * h2.x);
      float t = clamp(qr.x / len, -1.0, 1.0);
      float hw = wid * (1.0 - t * t);
      float dy = abs(qr.y);
      float c = (1.0 - smoothstep(max(hw - pix, 0.0), hw + pix, dy)) * step(abs(qr.x), len);
      float rib = fall(0.0, wid * 0.14 + pix, dy) * 0.28;
      vec3 col = mix(colA, colB, h2.y) * (0.78 + 0.3 * dHash(id + 3.3));
      col *= (1.0 - rib) * (0.86 + 0.28 * clamp(dot(R[0], gDecalSun) * 0.5 + 0.5, 0.0, 1.0));
      float sh = fall(0.0, wid * 1.6, length(vec2(qr.x * 0.55, qr.y + 0.012)) - wid * 0.4) * (1.0 - c) * 0.18;
      alb *= 1.0 - sh * cov0;
      alb = mix(alb, col, c * cov0);
    } else if (kind < 3.5) {
      // scratch: a short wobbling line
      vec2 qs = R * (f - off * 0.3);
      float wob = sin(qs.x * 9.0 / max(size, 1e-3) + h2.y * 20.0) * size * 0.06;
      float dy = abs(qs.y + wob);
      float wd = max(size * 0.05, pix * 0.9);
      float c = (1.0 - smoothstep(wd * 0.2, wd, dy)) * fall(size * 0.7, size, abs(qs.x));
      float halo = fall(0.0, wd * 5.0, dy) * fall(size * 0.6, size * 1.1, abs(qs.x)) * 0.14;
      alb *= 1.0 - halo * cov0;
      alb = mix(alb, mix(colA, colB, h2.y), c * cov0);
    } else {
      // speck: tiny dots, optionally glowing and flickering
      float d = length(q) / sz;
      float c = fall(0.25, 1.0, d);
      float tw = 0.55 + 0.45 * sin(uTime * (1.8 + 3.0 * h1.y) + h2.x * 40.0);
      vec3 col = mix(colA, colB, h2.y);
      alb = mix(alb, col * 0.55, c * cov0 * (emis > 0.0 ? 0.4 : 1.0));
      emi += col * emis * c * cov0 * tw;
    }
  }
}

// distance (m) from p to the segment a-b
float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}

// Ritual seal inlaid in the ground around a landmark, drawn as an AGED inlay: thin metal/stone strips set in chiselled
// grooves, value tied to the ground underneath (hue from the seal colour), partly lost (empty dark groove), partly filled with
// dirt / snow (gone), lit by a bevelled groove lip. Everything is a distance (metres) to the nearest inlay line, so the
// groove, the inlay, the lip and the chiselled edge all come from one evaluation. Called BEFORE groundDecals so leaves and
// pebbles lie on top of it.
float sealLines(vec2 d, float R, float cells, out float r) {
  float rm = length(d);
  r = rm / R;
  float a = atan(d.y, d.x);
  float dl = 9.0;
  // plain rings: double outer band, rune band edges, inner rings
  dl = min(dl, abs(r - 0.985) * R);
  dl = min(dl, abs(r - 0.958) * R);
  dl = min(dl, abs(r - 0.912) * R);
  dl = min(dl, abs(r - 0.778) * R);
  dl = min(dl, abs(r - 0.34) * R);
  dl = min(dl, abs(r - 0.15) * R);
  // two interlaced wavy rings around r = 0.56
  float lobes = floor(cells * 0.5 + 0.5);
  float wv = 0.065 * cos(a * lobes);
  dl = min(dl, abs(r - 0.56 - wv) * R * 0.92);
  dl = min(dl, abs(r - 0.56 + wv) * R * 0.92);
  // eight short spokes between the inner rings
  float sp = (fract(a / 6.2831853 * 8.0 + 0.5) - 0.5) * 6.2831853 / 8.0 * rm;
  dl = min(dl, max(abs(sp), max(0.15 * R - rm, rm - 0.34 * R)));
  // rune glyph band (r 0.79..0.90): every sector gets its own invented glyph out of a few strokes
  float sector = a / 6.2831853 * cells + 0.5;
  float cid = mod(floor(sector), cells);
  float cw = 6.2831853 * 0.845 * R / cells;
  vec2 g = vec2((fract(sector) - 0.5) * cw, (r - 0.845) * R);
  float hh = 0.042 * R;
  if (abs(g.y) < hh * 1.6) {
    float sx = min(cw * 0.3, hh * 0.9);
    float gd = 9.0;
    if (dHash(vec2(cid, 1.3)) > 0.15) gd = min(gd, segDist(g, vec2(0.0, -hh), vec2(0.0, hh)));
    if (dHash(vec2(cid, 2.9)) > 0.5) gd = min(gd, segDist(g, vec2(-sx, hh * 0.55), vec2(sx, hh * 0.55)));
    if (dHash(vec2(cid, 4.1)) > 0.5) gd = min(gd, segDist(g, vec2(-sx, -hh * 0.55), vec2(sx, -hh * 0.55)));
    if (dHash(vec2(cid, 5.7)) > 0.6) gd = min(gd, segDist(g, vec2(-sx, -hh), vec2(sx, hh)));
    if (dHash(vec2(cid, 7.3)) > 0.7) gd = min(gd, abs(length(g - vec2(sx * 0.9, 0.0)) - hh * 0.3));
    dl = min(dl, gd);
  }
  return dl;
}

// Optional stone frame around the seal (uSealBand: x width m, y value offset, z block length m, w how much the cut stone
// colour uSealBandCol replaces the ground texture): two courses of kerb blocks, staggered radial joints, per-block tone,
// granite speckle, dark grout and bevelled block edges (normal tilt) so the frame reads as raised cut stone, not a flat ring.
void sealBand(inout vec3 alb, inout vec3 N, vec2 d, vec2 wxz, float R, float aa, float k) {
  float bw = uSealBand.x;
  float rm = length(d);
  float b0 = R + 0.04;
  float b1 = R + bw;
  float inside = clamp((rm - b0) / aa + 0.5, 0.0, 1.0) * clamp((b1 - rm) / aa + 0.5, 0.0, 1.0);
  if (inside <= 0.0) return;
  float mid = b0 + bw * 0.5;
  float course = step(mid, rm);
  float nb = floor(6.2831853 * mid / max(uSealBand.z, 0.3));
  float arc = 6.2831853 * mid / nb;
  float u = atan(d.y, d.x) / 6.2831853 * nb + course * 0.5;
  float blk = floor(u);
  float fu = fract(u);
  // distances to the four edges of this block: inner / outer (radial), left / right (joints)
  float e0 = rm - mix(b0, mid, course);
  float e1 = mix(mid, b1, course) - rm;
  float t0 = fu * arc;
  float t1 = (1.0 - fu) * arc;
  float joint = min(min(t0, t1), min(e0, e1));
  float hb = dHash(vec2(blk, course + 3.0));
  vec3 stone = uSealBandCol * (0.86 + 0.28 * texture2D(uNoise, wxz * 3.1 + hb).a) * (0.88 + 0.24 * hb);
  float grout = 1.0 - clamp((joint - 0.022) / aa + 0.5, 0.0, 1.0);
  vec3 b = mix(alb, stone, uSealBand.w) * (1.0 + uSealBand.y) * (1.0 - 0.6 * grout);
  alb = mix(alb, b, inside * k);
  // rounded block edges: the surface falls away towards each edge
  float bev = 0.08;
  vec2 rd = d / max(rm, 1e-4);
  vec2 td = vec2(-rd.y, rd.x);
  vec2 tilt = rd * (fall(0.0, bev, e1) - fall(0.0, bev, e0)) + td * (fall(0.0, bev, t1) - fall(0.0, bev, t0));
  N = normalize(N + vec3(tilt.x, 0.0, tilt.y) * (0.8 * inside * k * (1.0 - grout)));
}

#ifdef MEDALLION
// Zones core A4: the plaza medallion, one non-tiling picture mapped to the disc of radius uMedalA.z round uMedalA.xy.
uniform sampler2D uMedal;
uniform vec4 uMedalA;
uniform vec4 uMedalB;
uniform vec3 uMedalTint;
uniform vec4 uMedalL0;
uniform vec4 uMedalL1;

// world xz offset -> image space: u to the east, v to the north (the screen's up is -z), turned by the rotation
vec2 medalImg(vec2 v, float cs, float sn) {
  v = vec2(v.x, -v.y);
  return mat2(cs, sn, -sn, cs) * v;
}

// alb / emi / N in and out; wxz world position; dx dy its screen derivatives; noGround 0..1 cliff weight
void groundMedallion(inout vec3 alb, inout vec3 emi, inout vec3 N, vec2 wxz, vec2 dx, vec2 dy, float noGround) {
  float R = uMedalA.z;
  vec2 d = wxz - uMedalA.xy;
  float r2 = dot(d, d);
  if (R <= 0.0 || r2 > R * R) return;
  float r = sqrt(r2);
  float cs = cos(uMedalA.w);
  float sn = sin(uMedalA.w);
  float inv = 0.5 / R;
  vec2 uv = medalImg(d, cs, sn) * inv + 0.5;
  vec2 gx = medalImg(dx, cs, sn) * inv;
  vec2 gy = medalImg(dy, cs, sn) * inv;
  vec4 t = textureGrad(uMedal, uv, gx, gy);
  float allow = dot(vec4(gLW[0], gLW[1], gLW[2], gLW[3]), uMedalL0) + dot(vec4(gLW[4], gLW[5], gLW[6], gLW[7]), uMedalL1);
  float m = (1.0 - smoothstep(R - max(uMedalB.y, 1e-3), R, r)) * t.a * uMedalB.x * clamp(allow, 0.0, 1.0) * (1.0 - noGround);
  if (m <= 0.002) return;
  vec3 col = t.rgb * uMedalTint;
  alb = mix(alb, col, m);
  float l0 = dot(t.rgb, vec3(0.3, 0.5, 0.2));
  if (uMedalB.w > 0.0) {
    // relief: the picture's brightness is a height; its gradient (taken a texel and a half away) tilts the normal
    vec2 px = 1.5 / vec2(textureSize(uMedal, 0));
    float lu = dot(textureGrad(uMedal, uv + vec2(px.x, 0.0), gx, gy).rgb, vec3(0.3, 0.5, 0.2));
    float lv = dot(textureGrad(uMedal, uv + vec2(0.0, px.y), gx, gy).rgb, vec3(0.3, 0.5, 0.2));
    vec2 gi = vec2(lu - l0, lv - l0) * (uMedalB.w * 3.0);
    vec2 gw = mat2(cs, -sn, sn, cs) * gi;
    gw.y = -gw.y;
    N = normalize(N + vec3(-gw.x, 0.0, -gw.y) * m);
  }
  emi += col * (uMedalB.z * m * smoothstep(0.55, 0.95, l0));
}
#endif

// N: world normal (in/out, the groove lip tilts it); rough: perceptual roughness (in/out, the inlay is smoother)
void groundSeal(inout vec3 alb, inout vec3 emi, inout vec3 N, inout float rough, vec2 wxz, float pix, float noGround) {
  float R = uSeal.z;
  if (R <= 0.0) return;
  vec2 d = wxz - uSeal.xy;
  float Rb = R + uSealBand.x;
  if (dot(d, d) > Rb * Rb * 1.12) return;
  float aa = max(pix, 1e-4);
  if (uSealBand.x > 0.0) sealBand(alb, N, d, wxz, R, aa, uSealOpt.y * (1.0 - noGround));
  float r;
  float dl = sealLines(d, R, max(uSeal.w, 8.0), r);
  // chiselled, slightly irregular edge
  dl += (texture2D(uNoise, wxz * 1.9).a - 0.5) * 0.016;
  float hw = uSealOpt.z;
  float bw = hw * 1.3 + 0.012;
  // strips thinner than a pixel fade out instead of shimmering
  float thin = clamp(hw * 2.5 / aa, 0.0, 1.0);
  float core = clamp((hw - dl) / aa + 0.5, 0.0, 1.0);
  float line = core * thin;
  float lip = (1.0 - smoothstep(hw, hw + bw + aa * 0.5, dl)) * (1.0 - core) * thin;
  float k = uSealOpt.y * fall(0.99, 1.05, r) * (1.0 - noGround);
  // ageing: dirt / snow filled the groove (line gone), the inlay fell out (empty dark groove)
  float nA = texture2D(uNoise, wxz * 0.19 + 0.13).r * 0.6 + texture2D(uNoise, wxz * 0.83 + 0.71).g * 0.4;
  float filled = smoothstep(0.92 - uSealOpt2.x * 0.55, 1.0 - uSealOpt2.x * 0.55, nA);
  float nB = texture2D(uNoise, wxz * 0.47 + 0.4).b * 0.6 + texture2D(uNoise, wxz * 2.1).a * 0.4;
  float lost = smoothstep(0.94 - uSealOpt.x * 0.55, 1.0 - uSealOpt.x * 0.55, nB);
  float vis = k * (1.0 - filled);
  // groove lip: world-space gradient of the line distance from its screen derivatives; the lip slopes into the groove
  vec2 sg = vec2(dFdx(dl), dFdy(dl));
  vec2 c0 = dFdx(wxz);
  vec2 c1 = dFdy(wxz);
  float det = c0.x * c1.y - c0.y * c1.x;
  vec2 gw = abs(det) > 1e-12 ? vec2(c1.y * sg.x - c0.y * sg.y, c0.x * sg.y - c1.x * sg.x) / det : vec2(0.0);
  vec2 gdir = gw / max(length(gw), 1e-5);
  N = normalize(N - vec3(gdir.x, 0.0, gdir.y) * (uSealOpt2.z * lip * vis));
  alb *= 1.0 - 0.16 * lip * vis;
  // inlay: hue of the seal colour at the value of the ground (+ contrast), mottled patina
  float gl = dot(alb, vec3(0.3, 0.5, 0.2));
  vec3 hue = uSealCol.rgb / max(dot(uSealCol.rgb, vec3(0.3, 0.5, 0.2)), 1e-3);
  vec3 inlay = mix(alb, hue * gl, 0.8) * (1.0 + uSealOpt.w) * (0.86 + 0.28 * texture2D(uNoise, wxz * 2.7 + 0.2).a);
  float inl = line * vis * (1.0 - lost);
  alb = mix(alb, inlay, inl);
  alb *= 1.0 - 0.42 * line * vis * lost;
  rough = mix(rough, rough * (1.0 - 0.6 * uSealOpt2.y), inl);
  // optional glow breathes in patches along the strips (embers in a crack, not a neon tube)
  float breathe = (0.3 + 0.7 * smoothstep(0.3, 0.75, texture2D(uNoise, wxz * 0.09 + vec2(uTime * 0.012, 0.0)).r)) * (0.85 + 0.15 * sin(uTime * 1.6 + r * 9.0));
  emi += uSealCol.rgb * (uSealCol.a * inl * breathe);
}
`;
