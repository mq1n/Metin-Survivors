// GLSL for the liquid surface (water / lava / ice) and its shore decal. All three surfaces share the same inputs:
//   uHeight (terrain - level, m), uFlow (flow.xy, obstacle foam, signed shore distance), uNoise (sky/noiseAtlas.ts).
// QUALITY define: 0 = single layer, 1 = dual layer, 2 = full (caustics, parallax, extra foam).
// Zones core C3 (look.liquidLook), each behind a define set only when the zone asks, so the old look compiles unchanged:
//   WATER_V2  uShore (sand shelf + beach band instead of the cobble strip), uWaterOpt (soft foam streaks, glitter cap,
//             bed-stone strength, shore softness)
//   ICE_V2    pale translucent frozen sheet: uIceOpt (opacity, glitter, cracks, frost), uIceRim (0 = no hairline rim)
//             LIQ-02 (QUALITY >= 1, premultiplied blend): uIceSheen / uIceSheenTint = a clear cool-blue sheet at the same translucency,
//             sky light ADDED as drifting patches that grows with the grazing angle (fresnel), a thin glassy lip along the shore,
//             and crisp sparse sun glints (uIceOpt.y is their gain): the sheet reads as glossy ice against the matte snow while the
//             bed (frost grain, the hero's ring and shadow, telegraphs) stays visible through it
//   LAVA_V2   uLavaOpt (flow scale, emissive, contact shade, shore glow); LAVA_FLAT = bright molten orange-yellow with a
//             slow low-frequency flow, no black crust plates
//             LIQ-01 (QUALITY >= 1): uLavaHot (hot-vein HDR gain, cooling-skin coverage and size): the hottest flow lines carry
//             an HDR term in #ff7a2a's hue (bloom source), drifting darker cooling skins with glowing seams break the tile
// Zones core B2 (look.liquidLook.shade):
//   SHORE_SHADE  the lit colour of everything that lies ON the bank (the sand shelf of the surface, the sand / wet band of the
//             shore decal, the hoarfrost) takes the terrain's own shadow: the baked sun visibility and AO texels (uLight, the
//             terrain's light map) and the dynamic sun shadow map (the material is a `lights` material), so a bank in shadow
//             is not covered by a bright dusty veil
import { SKY_GRADIENT_GLSL } from '../sky/skyGlsl';

export const LIQUID_VERT = /* glsl */ `
varying vec3 vWorld;
uniform float uTime;
#include <fog_pars_vertex>
#ifdef SHORE_SHADE
  #include <common>
  #include <shadowmap_pars_vertex>
#endif

void main() {
  vec3 p = position;
  #ifdef LAVA_WAVE
    // slow viscous swell; the shader depth/edge test uses the undisplaced level
    p.y += (sin(p.x * 0.31 + uTime * 0.55) + sin(p.z * 0.37 - uTime * 0.47) + sin((p.x + p.z) * 0.19 + uTime * 0.3)) * 0.028;
  #endif
  vWorld = p;
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #ifdef SHORE_SHADE
    vec4 worldPosition = modelMatrix * vec4(p, 1.0);
    #include <shadowmap_vertex>
  #endif
  #include <fog_vertex>
}
`;

const COMMON = /* glsl */ `
#ifdef SHORE_SHADE
  #include <common>
  #include <packing>
  #include <lights_pars_begin>
  #include <shadowmap_pars_fragment>
  #include <shadowmask_pars_fragment>
  // the terrain's light map (R sun visibility, G AO) over the domain: x half edge, y edge, z baked shadow strength, w AO strength
  uniform sampler2D uLight;
  uniform vec4 uShadeA;
  // rgb tint added where the sun is blocked (the zone's shadow fill), w its strength
  uniform vec4 uShadeFill;
#endif
uniform sampler2D uHeight;
uniform sampler2D uFlow;
uniform sampler2D uNoise;
uniform float uTime;
uniform vec2 uWindDir;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSunRad;
uniform vec3 uAmbRad;
varying vec3 vWorld;

// Irradiance of a point on the bank: ambient x ambK + sun x sunK. With SHORE_SHADE the sun is blocked by the terrain's baked
// shadow and the dynamic shadow map, and the ambient by the baked AO, plus the zone's shadow fill: the ground's own lighting.
vec3 shoreLit(vec2 xz, float ambK, float sunK) {
#ifdef SHORE_SHADE
  vec4 bl = texture2D(uLight, (xz + uShadeA.x) / uShadeA.y);
  float vis = mix(1.0, bl.r * getShadowMask(), uShadeA.z);
  float ao = mix(1.0, bl.g, uShadeA.w);
  return uAmbRad * (ambK * ao) + uSunRad * (sunK * vis) + uShadeFill.rgb * uShadeFill.w * (1.0 - vis);
#else
  return uAmbRad * ambK + uSunRad * sunK;
#endif
}

vec2 gridUv(vec2 xz) { return (xz + (GRID_HALF + 0.5)) / GRID_N; }
float decodeSd(float a) { return (a * 2.0 - 1.0) * SD_RANGE; }

// two-phase flow-map sampling (Valve): the pattern slides with 'flow' (m/s) and is re-seeded invisibly every 'cycle' s
vec4 flowSample(vec2 p, vec2 flow, float scale, float cycle, float t, float seed) {
  float c = t / cycle + seed;
  float p0 = fract(c);
  float p1 = fract(c + 0.5);
  float w = abs(2.0 * p0 - 1.0);
  vec2 j0 = vec2(floor(c), floor(c) * 0.61) * 0.173;
  vec2 j1 = vec2(floor(c + 0.5), floor(c + 0.5) * 0.61) * 0.173;
  vec4 a = texture2D(uNoise, (p - flow * (p0 * cycle)) * scale + j0);
  vec4 b = texture2D(uNoise, (p - flow * (p1 * cycle)) * scale + j1);
  return mix(a, b, w);
}

vec2 rot(vec2 p, float c, float s) { return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }

// non-periodic glitter mask: two incommensurate samples multiplied (a single small tile would show as a regular dot lattice)
float sparkle(vec2 p, float t) {
  float a = texture2D(uNoise, p * 2.3 + vec2(t * 0.05, -t * 0.03)).b;
  float b = texture2D(uNoise, rot(p, 0.8, 0.6) * 1.57 + vec2(-t * 0.04, t * 0.06)).b;
  return smoothstep(0.41, 0.53, a * b);
}
`;

const FOG_OUT = /* glsl */ `
#ifdef USE_FOG
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, smoothstep(fogNear, fogFar, vFogDepth));
#endif
`;

// ---------------------------------------------------------------------------------------------------------------------
// WATER

export const WATER_FRAG = /* glsl */ `
${COMMON}
${SKY_GRADIENT_GLSL}
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uBed;
uniform float uClarity;
#ifdef WATER_V2
// rgb sand colour (linear) + shelf width (m, 0 = none)
uniform vec4 uShore;
// x foam 0..1, y glitter 0..1, z bed stones 0..1, w shore softness 0..1
uniform vec4 uWaterOpt;
#endif
#include <fog_pars_fragment>

// The surface is blended premultiplied (ONE, ONE_MINUS_SRC_ALPHA) over the bed the terrain has already drawn:
//   rgb   = light the water adds (in-scatter, sky reflection, glints, foam, caustics and stones painted onto the bed)
//   alpha = 1 - the share of the bed that still shows through (Beer-Lambert transmittance x stone gaps x foam)
// That is the whole "refraction": no screen copy and no extra pass.
// linear -> blend-stage colour: identity into the HDR scene target (medium and up); tone mapped + encoded on the canvas (low)
vec3 toOutput(vec3 c) {
  #ifdef TONE_MAPPING
    c = toneMapping(c);
  #endif
  return linearToOutputTexel(vec4(c, 1.0)).rgb;
}

void main() {
  vec2 uv = gridUv(vWorld.xz);
  float depth = -texture2D(uHeight, uv).r;
  if (depth <= 0.0) discard;
  vec4 fl = texture2D(uFlow, uv);
  vec2 flow = (fl.rg * 2.0 - 1.0) * MAX_FLOW;
  float obst = fl.b;
  float sd = decodeSd(fl.a);
  float speed = length(flow);
  vec2 p = vWorld.xz;
  vec3 toCam = cameraPosition - vWorld;
  float camDist = length(toCam);
  vec3 V = toCam / camDist;
  float near = 1.0 - smoothstep(40.0, 170.0, camDist);
  vec2 wind = uWindDir * 0.22;
  // 1 over fords, bars and banks, 0 in the channel
  float shallow = 1.0 - smoothstep(0.25, 1.3, depth);

  // ---- ripples: slow wind drift + flow-advected wavelets; shallow (and shallow running) water chops up harder
  vec2 s1 = flowSample(p, flow + wind, 0.16, 4.0, uTime, 0.0).rg * 2.0 - 1.0;
  #if QUALITY >= 1
    vec2 s2 = flowSample(rot(p, 0.83, 0.55), rot(flow, 0.83, 0.55) * 1.2 - wind, 0.41, 3.0, uTime, 0.5).rg * 2.0 - 1.0;
    vec2 slope = s1 * 0.55 + s2 * 0.45;
  #else
    vec2 slope = s1;
  #endif
  #if QUALITY >= 1
    float run = shallow * smoothstep(0.05, 0.6, speed);
  #else
    float run = 0.0;
  #endif
  slope *= (0.3 + 0.12 * clamp(speed, 0.0, 2.0)) * (1.0 + 0.8 * shallow + 0.5 * run);
  slope *= 0.3 + 0.7 * near;
  vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));

  // ---- transmittance: Beer-Lambert over the light path down to the bed and back up the refracted view ray. The framebuffer
  //      (terrain bed) can only be scaled by one factor; the light this shader paints onto the bed gets per-channel
  //      absorption (red goes first), which is what tints the sand teal as the water deepens
  float sinT = sqrt(max(1.0 - V.y * V.y, 0.0)) * 0.75;
  float cosT = sqrt(1.0 - sinT * sinT);
  float path = depth * (1.0 + 1.0 / cosT);
  float trans = exp(-uClarity * path);
  vec3 transRgb = exp(-uClarity * path * vec3(1.55, 0.85, 0.75));

  // ---- the bed seen through the water: looked up where the refracted ray meets it (depth parallax) and wobbling with the
  //      ripples; cobbles in patches over sand and pebbles, dark gaps between the stones. The wobble is high-frequency, so
  //      the lookups take their filter footprint from the smooth surface position (textureGrad) instead of letting noisy
  //      derivatives push the sampler into its widest anisotropic footprint.
  vec2 away = -V.xz / max(length(V.xz), 1e-3);
  vec2 pb = p + away * depth * (sinT / cosT) + slope * depth * 0.4;
  vec2 gx = dFdx(p);
  vec2 gy = dFdy(p);
  float cobbles = smoothstep(0.46, 0.64, textureGrad(uNoise, pb * 0.043 + 0.31, gx * 0.043, gy * 0.043).b);
  vec4 t1 = textureGrad(uNoise, pb * 0.17, gx * 0.17, gy * 0.17);
  // domed stones (brightest in the middle) with wide dark joints, so they read as rounded cobbles rather than cracks
  float stones = smoothstep(0.02, 0.55, t1.a) * cobbles;
  float gap = (1.0 - smoothstep(0.0, 0.16, t1.a)) * cobbles;
  float tone = t1.b;
  #if QUALITY >= 1
    vec4 t2 = textureGrad(uNoise, rot(pb, 0.6, 0.8) * 0.41 + 0.53, rot(gx, 0.6, 0.8) * 0.41, rot(gy, 0.6, 0.8) * 0.41);
    stones = max(stones, smoothstep(0.03, 0.45, t2.a) * (0.4 + 0.3 * (1.0 - cobbles)));
    gap = max(gap, (1.0 - smoothstep(0.0, 0.13, t2.a)) * 0.5);
    tone = t2.b;
  #endif
  #ifdef WATER_V2
    // C3: painted bed stones (and their dark joints, the "crack bed") scaled down or off
    stones *= uWaterOpt.z;
    gap *= uWaterOpt.z;
  #endif
  float bedMul = (1.0 - 0.6 * gap) * (0.75 + 0.25 * stones);
  // pale gravel / sand over the (dark, wet) terrain bed: the shallows read lighter than the channel
  vec3 bedAdd = uBed * (uAmbRad + uSunRad * clamp(uSunDir.y, 0.0, 1.0)) * (0.14 + 0.36 * stones * (0.6 + 0.8 * tone));
  // caustics: soft bright web scrolling against itself, strongest in the shallows
  #if QUALITY >= 2
    float c1 = textureGrad(uNoise, pb * 0.3 + vec2(uTime * 0.021, uTime * 0.013), gx * 0.3, gy * 0.3).a;
    float c2 = textureGrad(uNoise, rot(pb, 0.6, -0.8) * 0.37 - vec2(uTime * 0.017, -uTime * 0.02), rot(gx, 0.6, -0.8) * 0.37, rot(gy, 0.6, -0.8) * 0.37).a;
    float web = (1.0 - smoothstep(0.0, 0.13, c1)) * 0.8 + (1.0 - smoothstep(0.0, 0.13, c2)) * 0.8;
    bedAdd += uBed * uSunRad * web * (1.0 - smoothstep(0.15, 1.2, depth)) * near * 0.12;
  #endif

  // ---- in-scatter: shallow water barely tints the bed, the channel turns to a dark teal body; lit like the terrain, with
  //      the wavelet relief exaggerated in the diffuse term so ripples read from above
  float ndl = clamp(uSunDir.y - dot(slope * 2.4, uSunDir.xz), 0.0, 1.0);
  float nb = texture2D(uNoise, p * 0.3 + wind * uTime * 0.05).b;
  vec3 body = mix(uShallow, uDeep, smoothstep(0.2, 2.6, depth)) * (0.92 + 0.16 * nb);
  vec3 inscatter = body * (uAmbRad + uSunRad * ndl);

  // ---- reflection: sky gradient + sun lobe, painterly fresnel (a faint sheen even looking straight down)
  float ndv = max(dot(N, V), 0.0);
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 sky = skyGradient(R) + uSunColor * pow(max(dot(R, uSunDir), 0.0), 36.0) * 0.55;
  float fres = 0.03 + 0.97 * pow(1.0 - ndv, 4.0);

  // ---- sun glint + glitter
  vec3 H = normalize(uSunDir + V);
  float nh = max(dot(N, H), 0.0);
  float glint = pow(nh, 600.0) * 4.0;
  #if QUALITY >= 1
    float sp = sparkle(p, uTime);
    glint *= 0.35 + 0.65 * sp;
    glint += sp * pow(nh, 64.0) * 0.18 * near;
  #endif
  #ifdef WATER_V2
    // C3: glitter cap
    glint *= uWaterOpt.y;
  #endif

  float tb = trans * (1.0 - fres);
  float keep = tb * bedMul;
  vec3 add = inscatter * (1.0 - trans) * (1.0 - fres) + sky * fres + bedAdd * transRgb * (1.0 - fres) + uSunColor * glint;
  #ifdef WATER_V2
    if (uShore.w > 0.0) {
      // C3: a smooth sand shelf replaces the bed (and its cobbles) within uShore.w metres of the waterline
      float sn = texture2D(uNoise, p * 0.19 + 0.4).b;
      float sand = (1.0 - smoothstep(uShore.w * (1.0 - uWaterOpt.w), uShore.w + 1e-3, sd + (sn - 0.5) * uShore.w * 0.6)) * 0.9;
      vec3 sandCol = uShore.rgb * shoreLit(p, 1.0, clamp(uSunDir.y, 0.0, 1.0)) * (0.85 + 0.3 * sn) * transRgb;
      add += sandCol * tb * sand;
      keep *= 1.0 - sand;
    }
  #endif

  // ---- foam: broken lace riding the swash line (never a solid rim), lapping rings, fast-water streaks, riffles, rocks
  vec4 fs = flowSample(p, flow, 0.62, 3.0, uTime, 0.25);
  float nf = fs.b;
  float lap = 0.5 + 0.5 * sin(sd * 3.1 - uTime * 0.85 + nb * 6.0);
  // swash band: the first few centimetres of depth or up to ~1 m from the waterline (whichever is wider), breathing with the
  // lap; broken into blobs + a bubbly cell lace so it reads as foam, not a painted rim
  float shore = max(1.0 - smoothstep(0.0, 0.05 + 0.07 * lap, depth + (nf - 0.5) * 0.06),
                    1.0 - smoothstep(0.1, 0.55 + 0.6 * lap, sd + (nf - 0.5) * 0.5));
  #ifdef WATER_V2
    // C3: soft streaky foam (no bead lace, no lapping rings): a breathing swash band broken by the flow noise, long
    // low-frequency fast-water streaks and riffles, foam round rocks
    float foam = shore * smoothstep(0.42, 0.8, nf) * 0.7;
    #if QUALITY >= 1
      float st = flowSample(p, flow, 0.5, 2.8, uTime, 0.6).b;
      foam += smoothstep(0.85, 2.0, speed) * smoothstep(0.62, 0.88, st) * 0.55;
      foam += run * smoothstep(0.6, 0.84, st) * 0.4;
      foam += smoothstep(0.25, 0.75, obst + (nf - 0.5) * 0.5) * 0.8;
    #endif
    foam = smoothstep(0.2, 0.85, clamp(foam, 0.0, 1.0)) * 0.85 * uWaterOpt.x;
  #else
  float lace = smoothstep(0.5, 0.74, nf) * 0.75 + (1.0 - smoothstep(0.03, 0.18, fs.a)) * 0.35 * shore;
  float foam = shore * lace;
  #if QUALITY >= 1
    float ring = smoothstep(0.86, 0.98, lap) * (1.0 - smoothstep(0.3, 1.4, sd)) * smoothstep(0.45, 0.72, nf) * 0.4;
    float st = flowSample(p, flow, 1.35, 2.2, uTime, 0.6).b;
    float streak = smoothstep(0.85, 2.0, speed) * smoothstep(0.68, 0.84, st) * 0.7;
    float riffle = run * smoothstep(0.62, 0.8, st) * 0.6;
    float rocks = smoothstep(0.2, 0.7, obst + (nf - 0.5) * 0.6);
    foam = clamp(foam + ring + streak + riffle + rocks, 0.0, 1.0);
  #endif
  foam = smoothstep(0.25, 0.8, foam) * 0.9;
  #endif
  vec3 foamCol = mix(vec3(0.74, 0.82, 0.84), vec3(0.97, 0.99, 0.99), nf) * (uAmbRad * 1.4 + uSunRad * 0.78);
  add = mix(add, foamCol, foam);
  keep *= 1.0 - foam;

  // the very waterline melts into the wet bank
  float edge = smoothstep(0.0, 0.035, depth);
  add *= edge;
  keep = clamp(mix(1.0, keep, edge), 0.0, 1.0);
  float alpha = 1.0 - keep;

  vec3 outc = toOutput(add);
  #ifdef USE_FOG
    float fogK = smoothstep(fogNear, fogFar, vFogDepth);
    outc = outc * (1.0 - fogK) + fogColor * (fogK * alpha);
  #endif
  gl_FragColor = vec4(outc, alpha);
}
`;

// ---------------------------------------------------------------------------------------------------------------------
// LAVA

export const LAVA_FRAG = /* glsl */ `
${COMMON}
uniform vec3 uCore;
#ifdef LAVA_V2
// x flow pattern scale, y emissive multiplier, z contact shade 0..1, w shore glow multiplier
uniform vec4 uLavaOpt;
#endif
#if defined( LAVA_FLAT ) && QUALITY >= 1
// LIQ-01: x HDR gain on the hottest flow lines, y cooling-skin coverage 0..1, z skin feature size (m)
uniform vec4 uLavaHot;
// LIQ-01: the hot lines' hue (#ff7a2a, linear)
uniform vec3 uLavaHotTint;
// the noise atlas' smooth channel has its widest blobs 1 / 4 of a tile apart (sky/noiseAtlas.ts: lowest fbm lattice, 4 cells), so a
// tile of 4 x uLavaHot.z metres gives skin patches of about uLavaHot.z metres (the cellular channel then makes plates of ~0.45 x that)
#define LAVA_ATLAS_BLOBS 4.0
#endif
#include <fog_pars_fragment>

void main() {
  vec2 uv = gridUv(vWorld.xz);
  float depth = -texture2D(uHeight, uv).r;
  if (depth <= 0.0) discard;
  vec4 fl = texture2D(uFlow, uv);
  vec2 flow = (fl.rg * 2.0 - 1.0) * MAX_FLOW;
  float sd = decodeSd(fl.a);
  float speed = length(flow);
  vec2 p = vWorld.xz;

  // ---- heat shimmer: low-frequency wobble of the pattern coordinates
  vec2 wob = (texture2D(uNoise, p * 0.085 + vec2(0.0, uTime * 0.05)).rg - 0.5) * 1.2;
  vec2 q = p + wob * (0.3 + 0.2 * sin(uTime * 0.6));

#ifdef LAVA_FLAT
  // C3 flat molten lava: bright orange-yellow, slow low-frequency flow lines, a soft darker skin at the banks (never a
  // black plate, no crackle)
  vec2 lf = flow * 0.5;
  float f1 = flowSample(q, lf, 0.03 * uLavaOpt.x, 16.0, uTime, 0.0).b;
  #if QUALITY >= 1
    float f2 = flowSample(q + 3.7, lf * 1.25, 0.075 * uLavaOpt.x, 11.0, uTime, 0.5).b;
  #else
    float f2 = f1;
  #endif
  float heat = smoothstep(0.2, 0.85, f1 * 0.62 + f2 * 0.38);
  float skin = (1.0 - smoothstep(0.0, 2.2, sd + (f2 - 0.5) * 1.2)) * uLavaOpt.z;
  // palette calibrated to the filmic tone curve (ACES desaturates anything above ~1.3 linear towards cream, which is what
  // an HDR "bright" lava turns into): the three stops stay in 0.8..1.0 linear and come out as deep orange-red, orange and
  // amber-yellow, like a flat molten tile (the zone's lava colour tints the low end)
  vec3 cRed = uCore * vec3(0.8, 0.6, 0.5);
  vec3 cOrange = uCore * vec3(0.98, 1.9, 1.0);
  vec3 cHot = vec3(0.92, 0.46, 0.012);
  vec3 col = mix(mix(cRed, cOrange, smoothstep(0.0, 0.5, heat)), cHot, smoothstep(0.5, 1.0, heat));
  #if QUALITY >= 1
    // LIQ-01 cooling skins: plates of the crust path (the atlas' cellular channel) in patches of about uLavaHot.z metres that the
    // smooth channel has cooled; they drift with the flow, are darker and redder than the melt and never cover the hottest lines,
    // and their seams stay molten. thr = the smooth channel's threshold for the coverage uLavaHot.y (fit of the atlas quantiles,
    // 0.684 - 0.572 c, 0.04 lower because the flow cross-fade thins a patch part of the time)
    float skinPlate = 0.0;
    float skinSeam = 0.0;
    if (uLavaHot.y > 0.001) {
      vec4 sk = flowSample(q + 11.3, flow * 0.35, 1.0 / (LAVA_ATLAS_BLOBS * uLavaHot.z), 26.0, uTime, 0.3);
      float thr = 0.644 - 0.572 * uLavaHot.y;
      float cooled = smoothstep(thr - 0.05, thr + 0.1, sk.b) * (1.0 - smoothstep(0.5, 0.85, heat));
      skinPlate = cooled * smoothstep(0.03, 0.22, sk.a);
      skinSeam = cooled * (1.0 - smoothstep(0.0, 0.14, sk.a));
    }
    // LIQ-01 hot veins: x (1 + hotHdr) on the hottest flow lines only (heat > 0.8 at 3 / 4 of the gain, plus thin contour lines of
    // the flow noise inside the warm areas at the full gain), in #ff7a2a's hue: the base palette stays <= 1.0 linear, and a gain on
    // the amber base would turn cream under ACES
    float hotM = smoothstep(0.8, 0.92, heat) * 0.75;
    hotM = max(hotM, (1.0 - smoothstep(0.0, 0.05, abs(f1 * 0.62 + f2 * 0.38 - 0.6))) * smoothstep(0.5, 0.75, heat));
    hotM *= 1.0 - skinPlate;
    if (uLavaHot.x > 0.0) col = mix(col, uLavaHotTint * 0.8, hotM) * (1.0 + uLavaHot.x * hotM);
    col = mix(col, col * vec3(0.30, 0.13, 0.08), skinPlate * 0.92);
    col = mix(col, cHot, skinSeam * 0.85);
  #endif
  col = mix(col, col * vec3(0.5, 0.38, 0.3), skin * 0.75) * uLavaOpt.y;
  col *= 0.95 + 0.05 * sin(uTime * 0.7 + f1 * 6.0);
  #if QUALITY >= 1
    float molten = 1.0 - (skin + skinPlate * 0.8) * 0.6;
  #else
    float molten = 1.0 - skin * 0.6;
  #endif
#else
  float cool = 1.0 - smoothstep(0.0, 3.0, sd);
  float hot = smoothstep(0.5, 5.5, sd) * (0.65 + 0.35 * clamp(speed / 1.2, 0.0, 1.0));

  // ---- crust plates drifting with the flow, glowing cracks between them, faint hairline fractures inside the plates
  vec2 lf = flow * 0.7;
  float big = flowSample(q, lf, 0.05, 12.0, uTime, 0.0).a;
  #if QUALITY >= 1
    float fine = flowSample(q + 5.3, lf * 1.1, 0.17, 9.0, uTime, 0.4).a;
  #else
    float fine = 1.0;
  #endif
  float pulse = 0.5 + 0.5 * sin(uTime * 0.7 + big * 9.0);
  float macro = texture2D(uNoise, q * 0.021 + 0.2).b;
  float width = (0.045 + 0.085 * hot - 0.02 * cool + 0.015 * pulse) * (0.5 + 1.1 * macro);
  float molten = 1.0 - smoothstep(width * 0.6, width + 0.05, big);
  float core = (1.0 - smoothstep(0.0, width * 0.4, big)) * (0.35 + 0.65 * hot);
  float bleed = 1.0 - smoothstep(width, width + 0.3, big);
  float hair = (1.0 - smoothstep(0.0, 0.06, fine)) * smoothstep(0.12, 0.3, big);

  // ---- colours (linear HDR: the molten parts exceed 1.0 so the bloom pass picks them up)
  float var = texture2D(uNoise, q * 0.045).b;
  float bevel = smoothstep(0.08, 0.6, big);
  vec3 crust = mix(vec3(0.02, 0.009, 0.008), vec3(0.075, 0.042, 0.036), bevel) * (0.75 + 0.5 * var);
  crust *= 0.8 + (uAmbRad.r + uSunRad.r * 0.25) * 0.5;
  vec3 col = crust + vec3(0.9, 0.1, 0.015) * bleed * bleed * (0.3 + 0.8 * hot) + vec3(0.55, 0.07, 0.01) * hair * 0.45;
  vec3 magma = mix(uCore * 2.6, vec3(1.0, 0.5, 0.12) * 4.2, core);
  magma *= 0.92 + 0.1 * sin(uTime * 1.6 + var * 14.0);
  col = mix(col, magma, molten);
  #ifdef LAVA_V2
    col *= uLavaOpt.y;
  #endif
#endif

  float a = smoothstep(0.0, 0.1, depth);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #ifdef USE_FOG
    // keep the glow strong in the haze: emissive parts fade into the fog at only 55 % of the normal rate
    float ff = smoothstep(fogNear, fogFar, vFogDepth) * (1.0 - 0.45 * molten);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, ff);
  #endif
}
`;

// ---------------------------------------------------------------------------------------------------------------------
// ICE

export const ICE_FRAG = /* glsl */ `
${COMMON}
${SKY_GRADIENT_GLSL}
uniform sampler2D uIce;
uniform sampler2D uIceN;
uniform vec3 uIceTint;
#ifdef ICE_V2
// x opacity, y glitter, z cracks, w frost (0..1 each); uIceRim: frosted hairline rim strength (0 = none)
uniform vec4 uIceOpt;
uniform float uIceRim;
#if QUALITY >= 1
// LIQ-02: x sheen strength 0..1 (0 = no sheen); the sheen colour (linear)
uniform vec4 uIceSheen;
uniform vec3 uIceSheenTint;

float iceHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

// layers a reflection (HDR colour c, coverage k) over the translucent sheet (col, alpha): exactly what NormalBlending gives for
// 'sheet over bed, then reflection over both'. Only the thin shore lip and the grazing-angle sheen use it (they cover the bed)
void iceOver(inout vec3 col, inout float alpha, vec3 c, float k) {
  float a2 = 1.0 - (1.0 - alpha) * (1.0 - k);
  col = (col * alpha * (1.0 - k) + c * k) / max(a2, 0.0001);
  alpha = a2;
}

// linear -> blend-stage colour of the light added on top: identity into the HDR scene target (medium and up), tone mapped + encoded
// where the canvas is the target
vec3 iceOut(vec3 c) {
  #ifdef TONE_MAPPING
    c = toneMapping(c);
  #endif
  return linearToOutputTexel(vec4(c, 1.0)).rgb;
}
#endif
#endif
#include <fog_pars_fragment>

void main() {
  vec2 uv = gridUv(vWorld.xz);
  float depth = -texture2D(uHeight, uv).r;
  if (depth <= 0.0) discard;
  vec4 fl = texture2D(uFlow, uv);
  float sd = decodeSd(fl.a);
  vec2 p = vWorld.xz;
  vec3 toCam = cameraPosition - vWorld;
  float camDist = length(toCam);
  vec3 V = toCam / camDist;
  float near = 1.0 - smoothstep(30.0, 140.0, camDist);

  // ---- fractures on two depths: long, sparse cell borders (only part of them cracked) on top; the lower layer is offset
  // along the view ray (fake parallax) and only darkens
  vec2 par = -V.xz / max(V.y, 0.35);
  vec2 warp = (texture2D(uNoise, p * 0.013).rg - 0.5) * 1.4;
  float cTop = texture2D(uNoise, (p + warp) * 0.017).a;
  float cLow = texture2D(uNoise, (p + warp + par * 0.7) * 0.024 + 0.31).a;
  float crackTop = (1.0 - smoothstep(0.0, 0.016, cTop)) * smoothstep(0.32, 0.62, texture2D(uNoise, p * 0.009 + 0.47).b);
  float crackLow = 1.0 - smoothstep(0.0, 0.1, cLow);

#ifdef ICE_V2
  {
  // C3 pale frozen sheet: the ice tint lit like snow-dusted ice, faint fractures, matte frost patches, sparse glitter in the
  // clear parts, a soft sky sheen; translucent by the opacity knob; the hairline frosted rim only when asked
  vec3 driftV = texture2D(uIce, p * 0.011, 6.0).rgb;
  float cloudV = texture2D(uNoise, p * 0.017 + 0.2).r;
  vec3 nmV = texture2D(uIceN, p * 0.021, 3.0).rgb * 2.0 - 1.0;
  vec3 N = normalize(vec3(nmV.x * 0.04, 1.0, nmV.y * 0.04));
  float ndl = max(dot(N, uSunDir), 0.0);
  float dl = dot(driftV, vec3(0.333));
  vec3 base = uIceTint * mix(vec3(1.0), driftV / max(dl, 0.05), 0.12) * (0.92 + 0.16 * cloudV);
  vec3 col = base * (uAmbRad * 1.3 + uSunRad * ndl * 0.9);
  col *= 1.0 - (crackTop * 0.32 + crackLow * 0.1) * uIceOpt.z;
  float frostP = smoothstep(0.42, 0.78, texture2D(uNoise, p * 0.043 + 0.13).b);
  vec3 frostCol = vec3(0.9, 0.95, 1.0) * (uAmbRad * 1.5 + uSunRad * 0.9);
  col = mix(col, frostCol, frostP * 0.55 * uIceOpt.w);
  float ndv = max(dot(N, V), 0.0);
  vec3 R = reflect(-V, N);
  vec3 sky = skyGradient(R) + uSunColor * pow(max(dot(R, uSunDir), 0.0), 30.0) * 0.3;
  float fres = 0.06 + 0.94 * pow(1.0 - ndv, 4.0);
  col = mix(col, sky, fres * 0.4);
  vec3 H = normalize(uSunDir + V);
  float nh = max(dot(N, H), 0.0);
  col += uSunColor * (pow(nh, 70.0) * 0.18);
  float nbV = texture2D(uNoise, p * 0.23).b;
  float rimV = (1.0 - smoothstep(0.0, 1.2, sd + (nbV - 0.5) * 1.2)) * uIceRim;
  col = mix(col, frostCol, rimV * 0.85);
  float edge = smoothstep(0.0, 0.012, depth);
  float alpha = mix(uIceOpt.x * 0.75, uIceOpt.x, smoothstep(0.0, 2.5, sd)) * edge;
  alpha = max(alpha, rimV * 0.8 * edge);
  #if QUALITY >= 1
  // light added on top of the bed (premultiplied blend: it does not veil the bed, so the frost grain, the hero's ring and shadow and
  // the telegraphs on the ice keep their contrast)
  vec3 iceAdd = vec3(0.0);
  {
    // LIQ-02 sheen. What makes the mere read as ice against the matte snow without hiding what lies on it: (1) the sheet itself takes a
    // clear cool-blue tint at the SAME translucency (no extra veil), (2) a soft sky reflection is ADDED as drifting patches (reflected
    // cloud), and (3) the reflection and a little cover grow with the grazing angle (fresnel), which is what lifts the establishing
    // views while the top-down game camera keeps its bed visible, (4) a thin glassy lip follows the shore
    float sheen = uIceSheen.x;
    if (sheen > 0.001) {
      float f1 = 1.0 - ndv;
      float graze = pow(f1, 1.5);
      vec2 pd = p - uWindDir * (uTime * 0.18);
      float pa = texture2D(uNoise, pd * 0.019 + 0.61).b;
      float pb = texture2D(uNoise, pd * 0.047 + 0.27).b;
      float pm = smoothstep(0.28, 0.72, mix(pa, pb, 0.35));
      float lip = 1.0 - smoothstep(0.0, 1.1, sd + (nbV - 0.5) * 0.8);
      float sn = sheen * (1.0 - rimV) * edge;
      vec3 litCool = uIceSheenTint * (uAmbRad * 1.5 + uSunRad * 0.9);
      // a saturated deep sky blue (the sheen colour squared: the red all but gone), the hue the sheet is tinted with
      vec3 deep = uIceSheenTint * litCool * vec3(0.15, 0.7, 1.0) * 1.3;
      // (1) the sheet's own colour: clear cool blue, frost patches stay matte; a hair more cover (about 4 % at full sheen)
      col = mix(col, deep, clamp(sn * 3.0, 0.0, 1.0) * (1.0 - frostP * 0.7));
      alpha = min(alpha + sn * 0.04 * (1.0 - frostP * 0.5), 1.0);
      // (2) + (3) added sky light
      vec3 skyRefl = mix(litCool, sky, 0.3);
      iceAdd += skyRefl * sn * (0.16 * pm + 0.55 * graze) * (1.0 - frostP * 0.6);
      // (3) cover at grazing angles, (4) the lip: both bury the bed, so only where it does not matter
      float kOver = clamp(sn * (1.1 * graze + 0.9 * lip * lip), 0.0, 0.7);
      iceOver(col, alpha, mix(deep * 0.8, litCool, pm * 0.4), kOver);
    }
    // LIQ-02 glitter: crisp sparse sun glints (a small star), added light. Every 0.5 m cell holds one micro-facet whose normal scatters around the half
    // vector, and only the few that point at the sun flash (about 1.5 % of the cells at gain 1): they re-roll as the camera moves
    // and twinkle slowly, so a walk across the mere shimmers. uIceOpt.y (look ice.glitter) gates the cells and scales the glint
    float gl = uIceOpt.y;
    if (gl > 0.001) {
      vec2 gp = p * 2.0;
      vec2 gc = floor(gp);
      vec2 gf = fract(gp);
      float h1 = iceHash(gc);
      float h2 = iceHash(gc + 17.3);
      float h3 = iceHash(gc + 41.7);
      float h4 = iceHash(gc + 73.1);
      vec2 tilt = (vec2(h1, h2) - 0.5) * 1.0 + 0.06 * vec2(sin(uTime * (0.7 + 1.6 * h3) + h1 * 40.0), cos(uTime * (0.6 + 1.4 * h2) + h3 * 40.0));
      float hy = max(H.y, 0.2);
      vec3 Nf = normalize(vec3(H.x / hy + tilt.x, 1.0, H.z / hy + tilt.y));
      float align = smoothstep(0.9975, 0.9993, dot(Nf, H));
      vec2 d = gf - vec2(0.25 + 0.5 * h3, 0.25 + 0.5 * fract(h3 * 7.7 + h1));
      float core = 1.0 - smoothstep(0.02, 0.085, length(d));
      float arms = (1.0 - smoothstep(0.0, 0.03, abs(d.x))) * (1.0 - smoothstep(0.0, 0.2, abs(d.y))) + (1.0 - smoothstep(0.0, 0.03, abs(d.y))) * (1.0 - smoothstep(0.0, 0.2, abs(d.x)));
      float glint = align * max(core, arms * 0.7) * step(h4, gl) * (1.0 - frostP) * near * edge;
      // the glint is sunlight: it follows the sun's radiance (a dusk or overcast arc dims it, a sun below the horizon has none)
      float sunGain = clamp(dot(uSunRad, vec3(0.3333)) * 1.28, 0.0, 1.5);
      iceAdd += mix(uSunColor, vec3(0.85, 0.95, 1.0), 0.4) * ((2.0 + 2.0 * gl) * sunGain) * clamp(glint, 0.0, 1.0);
    }
  }
  #endif
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  ${FOG_OUT}
  #if QUALITY >= 1
    // premultiplied output (the material blends ONE, ONE_MINUS_SRC_ALPHA from medium up): the sheet over the bed, plus the added light
    // (fading in the haze like the sheet)
    #ifdef USE_FOG
      float iceFogI = 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
    #else
      float iceFogI = 1.0;
    #endif
    gl_FragColor.rgb = gl_FragColor.rgb * gl_FragColor.a + iceOut(iceAdd) * iceFogI;
  #endif
  return;
  }
#endif

  // ---- surface: a clean, slightly cloudy sheet. The ice texture (bubbles, white veins) only feeds a broad colour drift
  // through a deep mip: sampled directly it reads as white speckle at the gameplay camera. The normal is a slow, shallow swell.
  vec3 drift = texture2D(uIce, p * 0.011, 6.0).rgb;
  float cloud = texture2D(uNoise, p * 0.017 + 0.2).r;
  vec3 nm = texture2D(uIceN, p * 0.021, 3.0).rgb * 2.0 - 1.0;
  vec3 N = normalize(vec3(nm.x * 0.05, 1.0, nm.y * 0.05));

  vec3 base = vec3(0.21, 0.43, 0.45) * mix(vec3(1.0), drift * 2.2, 0.25) * (0.82 + 0.36 * cloud) * uIceTint;
  float ndl = max(dot(N, uSunDir), 0.0);
  vec3 lit = base * (uAmbRad * 1.1 + uSunRad * ndl * 0.8);

  // deep layer: dark teal 'black ice' with darker fractures, visible through the clear windows of the top layer
  vec3 deep = uIceTint * vec3(0.02, 0.085, 0.1) * (uAmbRad + uSunRad * 0.3) * (1.0 - 0.5 * crackLow);
  float clear = smoothstep(0.35, 0.65, texture2D(uNoise, p * 0.026 + 0.7).b);
  vec3 col = mix(lit, deep, (0.3 + 0.45 * clear) * (1.0 - crackTop));
  vec3 frostCol = vec3(0.86, 0.94, 1.0) * (uAmbRad * 1.5 + uSunRad * 0.9);
  col = mix(col, frostCol * 0.85, crackTop * 0.5);

  // ---- sheen: sky reflection (a veil from above, strong at grazing angles), one soft sun lobe, sparse glints in the clear ice
  float ndv = max(dot(N, V), 0.0);
  vec3 R = reflect(-V, N);
  vec3 sky = skyGradient(R) + uSunColor * pow(max(dot(R, uSunDir), 0.0), 30.0) * 0.3;
  float fres = 0.08 + 0.92 * pow(1.0 - ndv, 3.4);
  col = mix(col, sky, fres * (0.5 + 0.35 * clear));
  vec3 H = normalize(uSunDir + V);
  float nh = max(dot(N, H), 0.0);
  col += uSunColor * (pow(nh, 60.0) * 0.2 + pow(nh, 400.0) * 0.8);
  #if QUALITY >= 1
    // rare, dim glints (a dense field of white points on dark ice reads as speckle at the gameplay camera)
    float sparse = step(0.8, texture2D(uNoise, p * 0.37 + 0.13).g) * clear;
    col += uSunColor * sparkle(p * 1.1, uTime * 0.25) * sparse * (0.03 + 0.22 * pow(nh, 12.0)) * near;
  #endif

  // ---- frosted rim and a little drifting snow dust near the shore
  float nb = texture2D(uNoise, p * 0.23).b;
  float rim = 1.0 - smoothstep(0.0, 1.5, sd + (nb - 0.5) * 1.6);
  float dustN = texture2D(uNoise, (p - uWindDir * uTime * 0.5) * 0.35).b;
  float dust = (1.0 - smoothstep(0.0, 2.5, sd)) * smoothstep(0.6, 0.85, dustN) * 0.3;
  float snow = max(rim * 0.85, dust);
  col = mix(col, frostCol, snow);

  // translucent near the shore so the lake bed fades through; opaque out in the lake. Recipes often make the ice a thin sheet
  // over a flat bed (depth of a few cm), so the fade follows the shore distance, not the depth. The depth fade is kept short
  // so the frosted rim meets the shore frost decal (a wider fade left a dark line of bare bank between them on steep banks)
  float edge = smoothstep(0.0, 0.012, depth);
  float alpha = mix(0.4, 0.97, smoothstep(0.0, 3.5, sd)) * edge;
  alpha = max(alpha, snow * 0.8 * edge);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  ${FOG_OUT}
}
`;

// ---------------------------------------------------------------------------------------------------------------------
// DECALS (terrain-conforming ring around the shore)

const DECAL_HEAD = /* glsl */ `
${COMMON}
#include <fog_pars_fragment>
`;

export const WET_FRAG = /* glsl */ `
${DECAL_HEAD}
uniform vec3 uWet;
#ifdef WATER_V2
uniform vec4 uShore;
uniform vec4 uWaterOpt;
#endif
void main() {
  vec2 uv = gridUv(vWorld.xz);
  float rel = texture2D(uHeight, uv).r;
  if (rel <= 0.0) discard;
  float dd = -decodeSd(texture2D(uFlow, uv).a);
  float n = texture2D(uNoise, vWorld.xz * 0.33).b;
  float band = 1.0 - smoothstep(0.1, 0.55 + n * 0.9, dd);
  float a = band * smoothstep(0.0, 0.05, rel) * 0.5;
  #ifdef WATER_V2
    if (uShore.w > 0.0) {
      // C3 beach: a sand band on the dry bank (soft, broken outer edge) with a thin darker wet line at the water
      float n2 = texture2D(uNoise, vWorld.xz * 0.11 + 0.3).b;
      // grain: fine speckle and faint wind ripples so the beach is not a flat painted band
      float g1 = texture2D(uNoise, vWorld.xz * 1.9 + 0.17).b;
      float g2 = texture2D(uNoise, vec2(dot(vWorld.xz, vec2(0.8, 0.6)) * 0.9, dot(vWorld.xz, vec2(-0.6, 0.8)) * 0.12)).b;
      float sandA = (1.0 - smoothstep(uShore.w * (1.0 - uWaterOpt.w) * 0.6, uShore.w, dd + (n2 - 0.5) * uShore.w * 0.7)) * smoothstep(0.0, 0.05, rel);
      vec3 sandLit = uShore.rgb * shoreLit(vWorld.xz, 1.0, clamp(uSunDir.y, 0.0, 1.0)) * (0.84 + 0.2 * n) * (0.9 + 0.14 * g1) * (0.95 + 0.08 * g2);
      // wet sand at the waterline: the same sand a shade darker, never a dark outline
      vec3 wetLit = uShore.rgb * 0.72 * shoreLit(vWorld.xz, 1.0, 0.6);
      float wetK = (1.0 - smoothstep(0.0, 0.5 + n * 0.5, dd)) * 0.55;
      float aS = max(sandA * 0.9, a * 0.4);
      if (aS < 0.004) discard;
      gl_FragColor = vec4(mix(sandLit, wetLit, wetK), aS);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      ${FOG_OUT}
      return;
    }
  #endif
  if (a < 0.004) discard;
  gl_FragColor = vec4(uWet * shoreLit(vWorld.xz, 1.0, 0.5), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  ${FOG_OUT}
}
`;

export const GLOW_FRAG = /* glsl */ `
${DECAL_HEAD}
uniform vec3 uCore;
#ifdef LAVA_V2
uniform vec4 uLavaOpt;
#endif
void main() {
  vec2 uv = gridUv(vWorld.xz);
  float rel = texture2D(uHeight, uv).r;
  if (rel <= 0.0) discard;
  float dd = -decodeSd(texture2D(uFlow, uv).a);
  float n = texture2D(uNoise, vWorld.xz * 0.12 + vec2(0.0, uTime * 0.02)).b;
  float g = exp(-dd * 0.85) * (0.7 + 0.6 * n) * smoothstep(0.0, 0.06, rel);
  g *= 1.0 - smoothstep(3.0, 5.5, dd);
  #ifdef LAVA_V2
    g *= uLavaOpt.w;
  #endif
  if (g < 0.004) discard;
  gl_FragColor = vec4(uCore * g * 0.32, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #ifdef USE_FOG
    gl_FragColor.rgb *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth) * 0.55;
  #endif
}
`;

export const FROST_FRAG = /* glsl */ `
${DECAL_HEAD}
void main() {
  vec2 uv = gridUv(vWorld.xz);
  float rel = texture2D(uHeight, uv).r;
  if (rel <= 0.0) discard;
  float dd = -decodeSd(texture2D(uFlow, uv).a);
  vec2 p = vWorld.xz;
  float n = texture2D(uNoise, p * 0.4).b;
  float d2 = texture2D(uNoise, p * 0.55 + 0.3).b;
  float band = 1.0 - smoothstep(0.3, 1.4 + n * 1.8, dd);
  // soft hoarfrost clumps (fine flecks read as white speckle at the gameplay camera); dense right at the waterline so it
  // continues the ice surface's frosted rim without a gap (fading with the bank height left a thin line of bare bank)
  float flecks = smoothstep(0.3, 0.75, d2);
  float a = band * mix(0.8, 0.42 + 0.33 * flecks, smoothstep(0.0, 0.9, dd));
  if (a < 0.004) discard;
  gl_FragColor = vec4(vec3(0.86, 0.93, 1.0) * shoreLit(vWorld.xz, 1.5, 0.85), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  ${FOG_OUT}
}
`;
