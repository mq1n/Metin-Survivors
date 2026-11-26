// Ported from threejs-vfx src/vfx/FilamentPaths.js and src/materials/LightningMaterial.js (MIT, © mohamedachrefelouafi — see ./LICENSE).
// Every filament in the game's lightning is one instance of a ribbon strip whose vertices are placed by the vertex shader from a
// handful of uniforms: no path exists on the CPU to go stale, so a bundle re-kinks and re-strikes itself every frame for free.
//
//   * a *role* decides the parametric path an instance is threaded along (bolt, helix, crawl, chain, crack …); the instance index
//     is tested against the live per-role counts, so one strip draws a bolt, its forks and the floor crawl at once and a role
//     retires the moment its count hits zero;
//   * the *kinks* are octaves of linearly interpolated value noise (linear on purpose: smoothstep rounds the corners off and the
//     corners are what read as lightning); `restrike` snaps every filament onto a new shape N times a second, `crawl` slides the
//     kinks continuously in between;
//   * the strip is drawn twice — a wide soft halo underneath and the hot core on top — so the glow stays attached to every kink.
//
// Two draw calls per FilamentPaths however many roles or filaments are live. Game-side changes: the eight role slots of the
// original four, a per-role `bundle` (spine thickness, outer dimming, gain) lifted from LightningMaterial's bundle look, colours
// as 0xRRGGBB ints, no scene-hook/disruption field, no global slider multipliers.
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Group,
  Mesh,
  ShaderMaterial,
  Vector3,
  Vector4,
  type InstancedBufferGeometry,
} from 'three';
import type { Palette } from '../palette';
import { mixHex } from '../util';
import { putHex } from './color';
import { sharedUniforms } from './frame';
import { createBoltRibbonGeometry } from './geometry';
import { commonGLSL } from './glsl/common';
import { noiseGLSL } from './glsl/noise';

/** Which parametric path a role is threaded along. A mode, not a dimension. */
export const PathMode = {
  /** The bolt: straight axis + a fan opening downrange + linear-value-noise kinks. */
  LINE: 0,
  /** A coil around the axis between two points. */
  HELIX: 1,
  /** Great slow loops around a point, each on its own inclined plane. */
  ORBIT: 2,
  /** A committed veer running outward from a centre (floor crawl). */
  MEANDER: 3,
  /** An arc travelling around a boundary, lifting over it at mid-span. */
  RIM: 4,
  /** A polyline through scattered nodes, with a per-hop lighting clock (`ArcNetwork`). */
  CHAIN: 5,
  /** A sagging catenary between two points, with a slack→taut control. */
  LINK: 6,
  /** A spiral collapsing from one radius to another as it travels. */
  SPIRAL_IN: 7,
  /** A branching fracture: trunk, branches, twigs, three generations deep. */
  CRACK: 8,
} as const;

/** Role slots per instance. Eight, so a barrage can run several bolts + forks + crawls on one strip. */
export const MAX_FILAMENT_ROLES = 8;
/** Nodes a `CHAIN` may thread. */
export const MAX_CHAIN_NODES = 12;

const _dir = new Vector3();
const _lat = new Vector3();
const _up = new Vector3(0, 1, 0);

/** Look parameters read on every `sync()`; metres, seconds, 0xRRGGBB colours. */
export interface FilamentLook {
  /** half-width of the core ribbon */
  width: number;
  /** halo half-width as a multiple of `width` */
  glowWidth: number;
  /** halo alpha relative to the core */
  glowOpacity: number;
  /** metres of lateral kink at the coarsest octave, before the per-role multiplier */
  jitter: number;
  /** kinks per metre of path */
  jitterScale: number;
  /** 1..5 octaves of value noise */
  octaves: number;
  /** amplitude kept per octave */
  jitterFalloff: number;
  /** how fast the kinks slide along, per second */
  crawl: number;
  /** 0..1 of the path the kink is eased in over at each end */
  pinch: number;
  /** whole re-shapes per second */
  restrike: number;
  /** 0..1 depth of the whole-bundle brightness stutter */
  flicker: number;
  /** stutter steps per second */
  flickerSpeed: number;
  /** 0..1 depth of the per-filament blink */
  strandFlash: number;
  /** exponent on the core's edge falloff — higher is thinner */
  coreSharp: number;
  /** the same for the halo */
  glowFalloff: number;
  /** metres of depth fade against the opaque scene (only with a depth prepass) */
  softFade: number;
  opacity: number;
  /** emissive multiplier feeding the bloom */
  glow: number;
  /** the white-hot centre line */
  colorCore: number;
  colorInner: number;
  colorOuter: number;
  /** the wide, dim atmosphere */
  colorHalo: number;
}

/** A fresh look with the original library's defaults (violet; use `paletteLook` to recolour). */
export function createFilamentLook(): FilamentLook {
  return {
    width: 0.032,
    glowWidth: 6.2,
    glowOpacity: 0.44,
    jitter: 1,
    jitterScale: 1.4,
    octaves: 4,
    jitterFalloff: 0.55,
    crawl: 2.4,
    pinch: 0.16,
    restrike: 21,
    flicker: 0.26,
    flickerSpeed: 30,
    strandFlash: 0.45,
    coreSharp: 4.4,
    glowFalloff: 2.3,
    softFade: 0.7,
    opacity: 1,
    glow: 2.2,
    colorCore: 0xffffff,
    colorInner: 0xdcd2ff,
    colorOuter: 0x8f6bff,
    colorHalo: 0x290d8c,
  };
}

/** Recolours a look from an effect palette: white-hot core, pale inner, saturated outer, deep halo. */
export function paletteLook(look: FilamentLook, pal: Pick<Palette, 'main' | 'core' | 'edge'>): FilamentLook {
  look.colorCore = pal.core;
  look.colorInner = mixHex(pal.core, pal.main, 0.6);
  look.colorOuter = mixHex(pal.main, pal.edge, 0.45);
  look.colorHalo = pal.edge;
  return look;
}

// ---------------------------------------------------------------------------------------------------------------- shader

/**
 * Role parameters are lifted into globals (`g*`) in `main()` because `pathAt()` runs three times per vertex and threading eight
 * uniforms through every call would drown the maths. Uniform arrays are only ever indexed by a loop counter: GLSL ES only
 * guarantees indexing by a constant-index-expression, and a loop index counts while a value derived from an attribute does not.
 */
const FILAMENT_VERTEX = /* glsl */ `
  #define PI  3.141592653589793
  #define TAU 6.283185307179586
  #define ROLES ${MAX_FILAMENT_ROLES}
  #define NODES ${MAX_CHAIN_NODES}

  uniform float uTime;
  uniform float uSeed;
  uniform float uRestrike;
  uniform float uFade;

  /* --- per-role blocks. See the JSDoc on each FilamentRole method. --- */
  uniform float uMode[ROLES];   // PathMode
  uniform float uCount[ROLES];  // live filaments in this role
  uniform vec3  uFrom[ROLES];   // anchor A — start, or centre, metres
  uniform vec3  uTo[ROLES];     // anchor B — end, or axis reference, metres
  uniform vec4  uShape[ROLES];  // mode-specific
  uniform vec4  uShape2[ROLES]; // mode-specific, continued
  uniform vec4  uStyle[ROLES];  // kink amp, width multiplier, dim, ground damp
  uniform vec4  uBundle[ROLES]; // spine width multiplier, outer-filament dim, gain, kink frequency multiplier
  uniform vec4  uEnds[ROLES];   // fade start, fade end, taper start, taper end
  uniform vec4  uDraw[ROLES];   // progress, tip length, floor y (m), tip glow

  /* --- the chain's scatter, unitless fractions only --- */
  uniform vec4  uNodes[NODES];  // along 0..1, lateral -1..1, lift 0..1, spare
  uniform float uNodeCount;

  /* --- shared look --- */
  uniform float uJitter;
  uniform float uJitterScale;
  uniform float uOctaves;
  uniform float uJitterFalloff;
  uniform float uCrawl;
  uniform float uPinch;
  uniform float uWidth;
  uniform float uWidthScale;
  uniform float uStrandFlash;
  uniform float uFlickerSpeed;

  attribute float aStrand;

  varying float vSide;
  varying float vDim;
  varying float vFlash;
  varying float vLit;
  varying float vDrawn;
  varying float vTip;
  varying float vEndFade;
  varying float vGain;
  varying float vViewZ;

  ${noiseGLSL}

  /* --- the role, hoisted out of main so pathAt can see it --- */
  float gMode;
  vec3  gFrom;
  vec3  gTo;
  vec4  gShape;
  vec4  gShape2;
  vec4  gStyle;
  vec4  gBundle;
  vec4  gEnds;
  vec4  gDraw;
  float gF;    // this filament's place in its role, 0..1, half-open
  float gSeed; // per-filament, re-rolled on every strike

  /** Value noise with a *linear* ramp — piecewise-linear output, sharp corners. */
  float vnoise(float x, float seed) {
    float i = floor(x);
    float f = x - i;
    return mix(hash11(i + seed), hash11(i + 1.0 + seed), f) * 2.0 - 1.0;
  }

  /** ESSL 1.00 has no hyperbolics. The catenary needs one. */
  float coshf(float x) { return 0.5 * (exp(x) + exp(-x)); }

  /**
   * Offset of one filament from its path, in the perpendicular plane. 'span' is the length of that path, so 'uJitterScale'
   * stays kinks per *metre* whether the filament is a 20 m whip or a 1 m hop around a rim.
   */
  vec2 kink(float t, float seed, float span) {
    vec2 o = vec2(0.0);
    float amp = 1.0;
    float freq = max(uJitterScale, 0.01) * span;
    float scroll = uTime * uCrawl;

    // Fixed trip count with a per-octave gate: a dynamic bound is not portable, and five multiply-adds are cheaper than the
    // branch would be anyway.
    for (int i = 0; i < 5; i++) {
      float on = step(float(i), uOctaves - 1.0);
      o.x += on * amp * vnoise(t * freq + scroll, seed + 13.0 * float(i));
      o.y += on * amp * vnoise(t * freq + scroll * 1.17, seed + 71.3 + 13.0 * float(i));
      amp *= uJitterFalloff;
      freq *= 2.0;
      scroll *= 1.63;
    }
    return o;
  }

  /** Unit tangent plus two normals for the segment A→B. */
  void axisFrame(vec3 a, vec3 b, out vec3 dir, out vec3 n1, out vec3 n2) {
    vec3 d = b - a;
    float len = length(d);
    dir = len > 1e-4 ? d / len : vec3(0.0, 1.0, 0.0);
    // The usual world-up reference degenerates on exactly the paths that run vertically — the column, the spiral — which are
    // the ones that need a frame most.
    vec3 up = abs(dir.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    n1 = normalize(cross(dir, up));
    n2 = normalize(cross(dir, n1));
  }

  /** The chain's lateral and vertical, taken flat so 'lift' is genuinely up. */
  void chainBasis(out vec3 lat, out vec3 up) {
    vec3 d = gTo - gFrom;
    // 'flat' would be the obvious name and is a reserved word in GLSL ES.
    vec3 ground = vec3(d.x, 0.0, d.z);
    up = vec3(0.0, 1.0, 0.0);
    lat = length(ground) > 1e-4 ? normalize(cross(up, normalize(ground))) : vec3(1.0, 0.0, 0.0);
  }

  /** One chain node, resolved from its unitless fractions. Mirrored on the CPU (FilamentPaths.nodePoint). */
  vec3 nodeWorld(vec4 f, vec3 lat, vec3 up) {
    return mix(gFrom, gTo, f.x) + lat * (f.y * gShape.x) + up * (f.z * gShape.y);
  }

  /**
   * The role's centreline at 't', before any kink is added. Every branch reads only from the 'g*' globals and 'uTime', which
   * is what makes the whole thing re-resolve for free on a paused frame.
   */
  vec3 pathAt(float t) {
    vec3 dir, n1, n2;
    // One exit: with a return in every branch the D3D back end flags the function's result as possibly uninitialised.
    vec3 result = gFrom;

    if (gMode < 0.5) {
      /* ---- LINE: the bolt ---- */
      // shape  = (sag m, spreadNear m, spread m, spreadCurve)
      // shape2 = (twist turns, twistSpeed turns/s, converge, —)
      axisFrame(gFrom, gTo, dir, n1, n2);
      vec3 p = mix(gFrom, gTo, t);
      p.y += gShape.x * sin(t * PI);
      // A constant per-filament offset in the perpendicular plane, opening from spreadNear at the start to spread at the end
      // and rolling with twist. This, not the noise, is what separates one filament from the next.
      float a = gSeed * TAU + (t * gShape2.x + uTime * gShape2.y) * TAU;
      float reach = mix(gShape.y, gShape.z, pow(clamp(t, 0.0, 1.0), max(gShape.w, 0.01)));
      result = p + (n1 * cos(a) + n2 * sin(a)) * reach * gF;

    } else if (gMode < 1.5) {
      /* ---- HELIX: a coil around the axis ---- */
      // shape  = (radius m, radiusEnd m, turns, spin turns/s)
      // shape2 = (sag m, phaseSpread, taperCurve, —)
      axisFrame(gFrom, gTo, dir, n1, n2);
      vec3 p = mix(gFrom, gTo, t);
      p.y += gShape2.x * sin(t * PI);
      float a = (gF * gShape2.y + t * gShape.z + uTime * gShape.w) * TAU;
      float r = mix(gShape.x, gShape.y, pow(clamp(t, 0.0, 1.0), max(gShape2.z, 0.01)));
      result = p + (n1 * cos(a) + n2 * sin(a)) * r;

    } else if (gMode < 2.5) {
      /* ---- ORBIT: great slow loops around a point ---- */
      // shape  = (radius m, arc turns, spin turns/s, wobble)
      // shape2 = (tilt rad, tiltSpread rad, radiusJitter, —)
      // A caged orb's filaments do not radiate, they *circle*. The loops sit on different planes or the cage reads as one flat
      // ring, so each filament tips its plane by 'tilt' and rotates its ascending node by a per-filament hash.
      axisFrame(gFrom, gTo, dir, n1, n2);
      float tilt = gShape2.x + (hash11(gSeed + 2.7) - 0.5) * gShape2.y;
      vec3 u = n1;
      vec3 v = n2 * cos(tilt) + dir * sin(tilt);
      float node = hash11(gSeed + 8.3) * TAU;
      vec3 uu =  u * cos(node) + v * sin(node);
      vec3 vv = -u * sin(node) + v * cos(node);

      float theta = (gF + t * gShape.y + uTime * gShape.z) * TAU;
      float r = gShape.x * (1.0 + (hash11(gSeed + 5.1) - 0.5) * gShape2.z);
      r *= 1.0 + gShape.w * sin(theta * 3.0 + gSeed);
      result = gFrom + (uu * cos(theta) + vv * sin(theta)) * r;

    } else if (gMode < 3.5) {
      /* ---- MEANDER: a committed veer running outward ---- */
      // shape  = (inner m, reach m, curve, wander rad)
      // shape2 = (arch m, hug m, spin turns/s, —)
      // The veer is a per-filament constant rather than noise so the tendril curves *consistently*, the way a discharge that
      // has committed to a direction does; the kinks on top supply the rest.
      axisFrame(gFrom, gTo, dir, n1, n2);
      float veer = (hash11(gSeed + 5.0) - 0.5) * 2.0 * gShape.w;
      float a = gF * TAU + uTime * gShape2.z * TAU + hash11(gSeed) * 0.4 + veer * pow(t, 1.4);
      float r = mix(gShape.x, gShape.y, pow(clamp(t, 0.0, 1.0), max(gShape.z, 0.01)));
      result = gFrom + (n1 * cos(a) + n2 * sin(a)) * r
                     + dir * (gShape2.y + gShape2.x * sin(t * PI));

    } else if (gMode < 4.5) {
      /* ---- RIM: an arc travelling around a boundary ---- */
      // shape  = (radius m, span turns, speed turns/s, lift m)
      // shape2 = (jitter, hug m, phase turns, —)
      axisFrame(gFrom, gTo, dir, n1, n2);
      float a = (gF + uTime * gShape.z + gShape2.z) * TAU + hash11(gSeed) * 0.3 + t * gShape.y * TAU;
      float r = gShape.x * (1.0 + gShape2.x * 0.25 * sin(t * 6.0 + gSeed));
      result = gFrom + (n1 * cos(a) + n2 * sin(a)) * r
                     + dir * (gShape2.y + gShape.w * sin(t * PI));

    } else if (gMode < 5.5) {
      /* ---- CHAIN: a polyline through the scattered nodes ---- */
      // shape  = (scatter m, lift m, sag m, bow m)
      // shape2 = (lit cursor in hops, hold hops, overlap hops, tip hops)
      vec3 lat, up;
      chainBasis(lat, up);

      float segs = max(uNodeCount - 1.0, 1.0);
      float x = clamp(t, 0.0, 1.0) * segs;
      float s = min(floor(x), segs - 1.0);
      float u = x - s;

      // Constant-index-expression lookup: see the header. 'n + 1' is still one.
      vec4 fa = uNodes[0];
      vec4 fb = uNodes[1];
      for (int n = 0; n < NODES - 1; n++) {
        if (float(n) == s) { fa = uNodes[n]; fb = uNodes[n + 1]; }
      }

      // Linear between nodes, deliberately: a spline through the scatter would round off the corners, and the corners are
      // what say "this jumped".
      vec3 p = mix(nodeWorld(fa, lat, up), nodeWorld(fb, lat, up), u);
      float bowSign = mod(s, 2.0) < 0.5 ? 1.0 : -1.0;
      p += lat * (gShape.w * bowSign * sin(u * PI));
      p.y += gShape.z * sin(u * PI);
      result = p;

    } else if (gMode < 6.5) {
      /* ---- LINK: a sagging catenary ---- */
      // shape  = (slack m, curve, swing m, swingSpeed rad/s)
      // shape2 = (taut 0..1, spread m, —, —)
      // A real catenary, not a parabola: a hanging chain leaves its anchor much steeper than a parabola does, and that
      // steepness is most of what says "heavy".
      axisFrame(gFrom, gTo, dir, n1, n2);
      vec3 p = mix(gFrom, gTo, t);
      float k = max(gShape.y, 0.01);
      float bow = (coshf(k) - coshf(k * (2.0 * t - 1.0))) / max(coshf(k) - 1.0, 1e-4);
      p.y -= gShape.x * (1.0 - clamp(gShape2.x, 0.0, 1.0)) * bow;
      float swing = sin(uTime * gShape.w + gSeed) * gShape.z * sin(t * PI);
      result = p + n1 * (swing + (gF - 0.5) * 2.0 * gShape2.y);

    } else if (gMode < 7.5) {
      /* ---- SPIRAL_IN: a spiral collapsing as it travels ---- */
      // shape  = (radius m, radiusEnd m, turns, spin turns/s)
      // shape2 = (curve, phaseSpread, wobble, —)
      axisFrame(gFrom, gTo, dir, n1, n2);
      float e = pow(clamp(t, 0.0, 1.0), max(gShape2.x, 0.01));
      vec3 p = mix(gFrom, gTo, e);
      float theta = (gF * gShape2.y + t * gShape.z + uTime * gShape.w) * TAU;
      float r = mix(gShape.x, gShape.y, e) * (1.0 + gShape2.z * sin(theta * 2.0 + gSeed));
      result = p + (n1 * cos(theta) + n2 * sin(theta)) * r;

    } else {
      /* ---- CRACK: a branching fracture ---- */
      // shape  = (angle rad, lengthFrac, depthFalloff, spread)
      // shape2 = (start 0..1, sag m, forkBias 0..1, —)
      // Three generations, walked forward rather than recursed: a twig has to know where its branch went, and its branch has to
      // know where the trunk went, so each pass re-anchors A→B onto the child before the next one reads it. Filament 0 is always
      // the trunk, which is why a crack still reads with the count wound down to one.
      vec3 a = gFrom;
      vec3 b = gTo;
      float depth = gF > 0.0001 ? 1.0 + step(mix(0.75, 0.35, clamp(gShape2.z, 0.0, 1.0)), gF) : 0.0;

      for (int gen = 0; gen < 2; gen++) {
        if (float(gen) < depth) {
          vec3 d = b - a;
          float len = length(d);
          vec3 fd = len > 1e-4 ? d / len : vec3(0.0, -1.0, 0.0);
          vec3 up = abs(fd.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
          vec3 m1 = normalize(cross(fd, up));
          vec3 m2 = normalize(cross(fd, m1));

          float at = mix(clamp(gShape2.x, 0.0, 1.0), 1.0, hash11(gSeed + float(gen) * 17.0));
          float roll = hash11(gSeed + float(gen) * 7.3 + 3.1) * TAU;
          float sgn = hash11(gSeed + float(gen) * 5.5) < 0.5 ? -1.0 : 1.0;
          float ang = gShape.x * (1.0 + (hash11(gSeed + float(gen) * 2.9) - 0.5) * gShape.w);

          vec3 off = m1 * cos(roll) + m2 * sin(roll);
          vec3 nd = normalize(fd * cos(ang) + off * sin(ang) * sgn);

          vec3 root = mix(a, b, at);
          a = root;
          b = root + nd * len * gShape.y * pow(max(gShape.z, 0.01), float(gen));
        }
      }

      vec3 p = mix(a, b, t);
      p.y += gShape2.y * sin(t * PI);
      result = p;
    }

    return result;
  }

  /** Metres of path, so the kink frequency means the same thing in every mode. */
  float pathSpan() {
    float len = length(gTo - gFrom);
    if (gMode < 1.5) return max(len, 0.01);                        // LINE, HELIX
    if (gMode < 2.5) return max(gShape.x * gShape.y * TAU, 0.01);  // ORBIT
    if (gMode < 3.5) return max(abs(gShape.y - gShape.x), 0.05);   // MEANDER
    if (gMode < 4.5) return max(gShape.x * gShape.y * TAU, 0.01);  // RIM
    return max(len, 0.01);                                         // CHAIN, LINK, SPIRAL, CRACK
  }

  /**
   * How lit this point of a chain is. The clock is a cursor in *hops*, not seconds — 'ArcNetwork' integrates 'dt / hopTime' so
   * that changing the hop time never rewrites the past. A hop is dark until the cursor reaches it, holds for 'hold' hops, then
   * decays over 'overlap' hops: the knob that decides whether the discharge is a single travelling spark or a whole lit chain.
   */
  float chainLit(float t) {
    float segs = max(uNodeCount - 1.0, 1.0);
    float x = clamp(t, 0.0, 1.0) * segs;
    float s = min(floor(x), segs - 1.0);
    float u = x - s;

    float d = gShape2.x - s;
    float hold = max(gShape2.y, 0.0);
    float over = max(gShape2.z, 1e-3);
    float tip = max(gShape2.w, 1e-3);

    float lum = step(0.0, d) * (1.0 - smoothstep(hold, hold + over, d));
    // Inside the hop the front is crossing, only the part behind it exists.
    float drawn = mix(smoothstep(d, d - tip, u), 1.0, step(1.0, d));
    return lum * drawn;
  }

  void main() {
    float t = position.x;
    float side = position.y;
    vSide = side;

    /* ---- which role is this filament wearing ---- */
    // The instance index is tested against the live counts, so a role retires the instant its count hits zero and the rest
    // close up behind it.
    gMode = uMode[0]; gFrom = uFrom[0]; gTo = uTo[0];
    gShape = uShape[0]; gShape2 = uShape2[0]; gStyle = uStyle[0]; gBundle = uBundle[0];
    gEnds = uEnds[0]; gDraw = uDraw[0];

    float local = aStrand;
    float count = 1.0;
    float acc = 0.0;
    for (int i = 0; i < ROLES; i++) {
      float n = max(uCount[i], 0.0);
      if (aStrand >= acc && aStrand < acc + n) {
        local = aStrand - acc;
        count = max(n, 1.0);
        gMode = uMode[i]; gFrom = uFrom[i]; gTo = uTo[i];
        gShape = uShape[i]; gShape2 = uShape2[i]; gStyle = uStyle[i]; gBundle = uBundle[i];
        gEnds = uEnds[i]; gDraw = uDraw[i];
      }
      acc += n;
    }
    // Half-open on purpose: 0 and 1 would put two filaments on the same bearing for every mode that fans around a circle.
    gF = local / count;

    // The strike index snaps every filament onto a new shape uRestrike times a second; the crawl inside kink() slides it
    // continuously in between. Both together are what stops a held filament looking like a static ribbon.
    float strike = floor(uTime * max(uRestrike, 0.01));
    gSeed = hash11(aStrand * 7.13 + uSeed + strike * 3.77) * 97.0;

    vDim = gStyle.z * mix(1.0, gBundle.y, gF);
    vGain = gBundle.z;
    vLit = gMode > 4.5 && gMode < 5.5 ? chainLit(t) : 1.0;

    /* ---- the frame the offsets live in ---- */
    float step_ = 0.02;
    vec3 here = pathAt(t);
    vec3 behind = pathAt(max(t - step_, 0.0));
    vec3 ahead = pathAt(min(t + step_, 1.0));

    vec3 tangent = ahead - behind;
    tangent = length(tangent) > 1e-5 ? normalize(tangent) : vec3(0.0, 1.0, 0.0);
    vec3 upRef = abs(tangent.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 n1 = normalize(cross(tangent, upRef));
    vec3 n2 = normalize(cross(tangent, n1));

    /* ---- the kinks ---- */
    float pinch = max(uPinch, 1e-3);
    // Only LINE has an end it may leave loose: a bolt that lands somewhere other than where it was aimed reads as a bug, but
    // converge < 1 lets a fracture fray. Every other mode is pinched at both ends.
    float converge = gMode < 0.5 ? clamp(gShape2.z, 0.0, 1.0) : 1.0;
    float ends = smoothstep(0.0, pinch, t) * mix(1.0, smoothstep(0.0, pinch, 1.0 - t), converge);

    vec2 k = kink(t, gSeed, pathSpan() * max(gBundle.w, 0.01)) * gStyle.x * uJitter * ends;
    vec3 offset = n1 * k.x + n2 * k.y;
    // Ground roles keep their kinks in the floor plane. A free y here buries half of every tendril and the effect reads as a
    // broken dotted line.
    offset.y *= gStyle.w;

    vec3 world = here + offset;
    vec3 nextWorld = ahead + offset;
    world.y = max(world.y, gDraw.z);
    nextWorld.y = max(nextWorld.y, gDraw.z);

    /* ---- how much of it exists yet ---- */
    // The ribbon is drawn whole and clipped in the fragment rather than scaled, so the *shape* never changes as the front
    // travels — only how much of it is there. Roles that never travel sit at progress 2 and skip all of this.
    float tipLen = max(gDraw.y, 1e-3);
    vDrawn = smoothstep(gDraw.x, gDraw.x - tipLen, t);
    vTip = smoothstep(gDraw.x - tipLen * 2.0, gDraw.x, t) * gDraw.w;

    /* ---- turn the ribbon to face the camera ---- */
    vec3 tan2 = nextWorld - world;
    tan2 = length(tan2) > 1e-5 ? normalize(tan2) : tangent;
    vec3 toCamera = normalize(cameraPosition - world);
    vec3 binormal = cross(tan2, toCamera);
    float bl = length(binormal);
    binormal = bl > 1e-4 ? binormal / bl : n1;

    /* ---- width ---- */
    // A stuttering per-filament blink, quantised to uFlickerSpeed so the whole bundle strobes on one clock instead of
    // shimmering independently.
    float flash = mix(1.0, hash11(floor(uTime * uFlickerSpeed) + aStrand * 3.7 + uSeed), uStrandFlash);
    vFlash = flash;

    // One-sided tapers, so a filament pinned at the hand can keep its full width there while the loose end still comes to a
    // point.
    float taperS = pow(max(sin(min(t, 0.5) * PI), 0.0), 0.35);
    float taperE = pow(max(sin(max(t, 0.5) * PI), 0.0), 0.35);
    vEndFade = mix(1.0, taperS, gEnds.x) * mix(1.0, taperE, gEnds.y);

    // The spine (filament 0 of a role) can be thicker than the outer strands of its bundle.
    float halfWidth = uWidth * uWidthScale * gStyle.y * mix(gBundle.x, 1.0, gF);
    halfWidth *= mix(1.0, taperS, gEnds.z) * mix(1.0, taperE, gEnds.w);
    halfWidth *= flash * uFade;

    // World space throughout: the effect's group is an identity transform.
    vec4 mv = viewMatrix * vec4(world + binormal * side * halfWidth, 1.0);
    vViewZ = mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const FILAMENT_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uSeed;
  uniform float uCoreSharp;
  uniform float uGlowFalloff;
  uniform float uFlicker;
  uniform float uFlickerSpeed;
  uniform float uPassOpacity;
  uniform float uOpacity;
  uniform float uGlow;
  uniform float uFade;
  uniform float uSoftFade;
  uniform vec3  uColorCore;
  uniform vec3  uColorInner;
  uniform vec3  uColorOuter;
  uniform vec3  uColorHalo;

  uniform float uGlobalGlow;
  uniform vec2  uResolution;
  uniform sampler2D uSceneDepth;
  uniform float uCameraNear;
  uniform float uCameraFar;

  varying float vSide;
  varying float vDim;
  varying float vFlash;
  varying float vLit;
  varying float vDrawn;
  varying float vTip;
  varying float vEndFade;
  varying float vGain;
  varying float vViewZ;

  ${noiseGLSL}
  ${commonGLSL}

  void main() {
    // Ahead of the front, and behind a hop that has not lit yet, there is no filament at all.
    float presence = vDrawn * vLit;
    if (presence <= 0.002) discard;

    float v = clamp(abs(vSide), 0.0, 1.0);

    #ifdef FILAMENT_GLOW
      float profile = pow(1.0 - v, max(uGlowFalloff, 0.05));
      vec3 color = mix(uColorHalo, uColorOuter, profile);
      float alpha = profile;
    #else
      float profile = pow(1.0 - v, max(uCoreSharp, 0.05));
      vec3 color = mix(uColorOuter, uColorInner, smoothstep(0.0, 0.5, profile));
      color = mix(color, uColorCore, smoothstep(0.45, 1.0, profile));
      float alpha = profile;
    #endif

    // The leading edge is where the air is actually breaking down — a white-hot head on the core only: in the halo pass it
    // blooms into a washed ball.
    float gain = vGain;
    #ifdef FILAMENT_GLOW
      gain = mix(1.0, vGain, 0.35);
    #else
      color += uColorCore * vTip;
    #endif

    // Quantised, not sinusoidal: real lightning stutters between brightnesses, it does not breathe.
    float flicker = 1.0 - uFlicker * hash11(floor(uTime * uFlickerSpeed) + uSeed);

    // A loose end has to fade as well as thin. A ribbon that only narrows leaves a hard dot at its tip.
    alpha *= vEndFade * presence * flicker * vFlash * vDim * uFade * uPassOpacity * uOpacity;

    vec2 screenUV = gl_FragCoord.xy / uResolution;
    alpha *= softFade(uSceneDepth, screenUV, vViewZ, uCameraNear, uCameraFar, uSoftFade);
    if (alpha < 0.003) discard;

    color *= uGlow * uGlobalGlow * gain;
    gl_FragColor = vec4(color, alpha);
  }
`;

// ----------------------------------------------------------------------------------------------------------------- roles

/** The uniform boxes the passes share by identity: one write in `sync()` updates the halo and the core together. */
interface SharedBoxes {
  uSeed: { value: number };
  uRestrike: { value: number };
  uFade: { value: number };
  uMode: { value: Float32Array };
  uCount: { value: Float32Array };
  uFrom: { value: Vector3[] };
  uTo: { value: Vector3[] };
  uShape: { value: Vector4[] };
  uShape2: { value: Vector4[] };
  uStyle: { value: Vector4[] };
  uBundle: { value: Vector4[] };
  uEnds: { value: Vector4[] };
  uDraw: { value: Vector4[] };
  uNodes: { value: Vector4[] };
  uNodeCount: { value: number };
  uJitter: { value: number };
  uJitterScale: { value: number };
  uOctaves: { value: number };
  uJitterFalloff: { value: number };
  uCrawl: { value: number };
  uPinch: { value: number };
  uWidth: { value: number };
  uStrandFlash: { value: number };
  uFlickerSpeed: { value: number };
  uFlicker: { value: number };
  uCoreSharp: { value: number };
  uGlowFalloff: { value: number };
  uSoftFade: { value: number };
  uOpacity: { value: number };
  uGlow: { value: number };
  uColorCore: { value: Color };
  uColorInner: { value: Color };
  uColorOuter: { value: Color };
  uColorHalo: { value: Color };
}

function fill<T>(count: number, make: () => T): T[] {
  const out: T[] = [];
  for (let i = 0; i < count; i++) out.push(make());
  return out;
}

/**
 * A handle onto one role slot. Every setter is positional and writes straight into the uniform vectors — no options object
 * anywhere, because these run every frame. The argument order of each mode method is the order of the two `vec4`s it fills; the
 * comments in the vertex shader list the same.
 */
export class FilamentRole {
  private readonly mode: Float32Array;
  private readonly counts: Float32Array;
  private readonly from: Vector3;
  private readonly to: Vector3;
  private readonly shape: Vector4;
  private readonly shape2: Vector4;
  private readonly styleV: Vector4;
  private readonly bundleV: Vector4;
  private readonly endsV: Vector4;
  private readonly drawV: Vector4;

  constructor(
    u: SharedBoxes,
    readonly index: number,
  ) {
    this.mode = u.uMode.value;
    this.counts = u.uCount.value;
    this.from = u.uFrom.value[index] as Vector3;
    this.to = u.uTo.value[index] as Vector3;
    this.shape = u.uShape.value[index] as Vector4;
    this.shape2 = u.uShape2.value[index] as Vector4;
    this.styleV = u.uStyle.value[index] as Vector4;
    this.bundleV = u.uBundle.value[index] as Vector4;
    this.endsV = u.uEnds.value[index] as Vector4;
    this.drawV = u.uDraw.value[index] as Vector4;
    this.mode[index] = PathMode.LINE;
    this.counts[index] = 0;
    this.style(1, 1, 1, 1).bundle(1, 1, 1, 1).ends(1, 1, 1, 1).draw(2, 0.08, -1e4, 0);
  }

  /** Live filaments in this role. 0 retires it outright. */
  get count(): number {
    return this.counts[this.index] as number;
  }

  set count(n: number) {
    this.counts[this.index] = Math.max(0, Math.round(n));
  }

  retire(): void {
    this.counts[this.index] = 0;
  }

  /**
   * Per-role modifiers on the shared look.
   * @param kink       multiplier on the shared `jitter`
   * @param width      multiplier on the shared `width`
   * @param dim        0..1 alpha multiplier — how secondary this role is
   * @param groundDamp 0..1 on the kink's world y; 0.3 for anything flat
   */
  style(kink: number, width: number, dim: number, groundDamp: number): this {
    this.styleV.set(kink, width, dim, groundDamp);
    return this;
  }

  /**
   * How the filaments of one role differ from each other: the spine (filament 0) can be thicker than the outer strands, the
   * outer strands dimmer, the whole role brighter than the shared `glow` (a strike's flash) and its kinks finer or coarser.
   * @param spine    width multiplier of the spine; the outer strands stay at 1
   * @param outerDim alpha multiplier reached by the outermost strand (the spine is 1)
   * @param gain     emissive multiplier of the whole role
   * @param freq     multiplier on the shared `jitterScale` for this role (a short floor crawl wants a finer kink than a bolt)
   */
  bundle(spine: number, outerDim: number, gain: number, freq: number): this {
    this.bundleV.set(spine, outerDim, gain, freq);
    return this;
  }

  /**
   * How each end finishes, 0 (square) .. 1 (tapered to nothing). A bolt leaving a hand wants `ends(0, 1, 0, 1)`; a rim arc with
   * two loose ends wants the default `ends(1, 1, 1, 1)`.
   */
  ends(fadeStart: number, fadeEnd: number, taperStart: number, taperEnd: number): this {
    this.endsV.set(fadeStart, fadeEnd, taperStart, taperEnd);
    return this;
  }

  /**
   * The travelling front and the floor.
   * @param progress  0..1 of the path that exists; ≥ 1 + tip draws it whole
   * @param tipLength 0..1 of the path the front is smeared over
   * @param floorY    metres — the result is clamped above this; -1e4 for none
   * @param tipGlow   additive core colour at the front
   */
  draw(progress: number, tipLength: number, floorY: number, tipGlow: number): this {
    this.drawV.set(progress, tipLength, floorY, tipGlow);
    return this;
  }

  /**
   * `LINE` — the bolt: a straight axis bowed by `sag`, a fan opening downrange, and the kinks on top.
   * @param sag         metres of bow at mid-span; negative droops
   * @param spreadNear  metres the bundle is fanned at `from`
   * @param spread      metres it is fanned at `to`
   * @param spreadCurve how late the fan opens; >1 stays tight then flares
   * @param twist       turns of roll from end to end
   * @param twistSpeed  turns per second the whole fan rolls
   * @param converge    0..1 — how hard the far end's kink is pinned to `to`
   */
  line(from: Vector3, to: Vector3, sag: number, spreadNear: number, spread: number, spreadCurve: number, twist: number, twistSpeed: number, converge: number): this {
    return this.set(PathMode.LINE, from, to, sag, spreadNear, spread, spreadCurve, twist, twistSpeed, converge, 0);
  }

  /**
   * `HELIX` — a coil wound around the axis between two points.
   * @param radius      metres at `from`
   * @param radiusEnd   metres at `to`
   * @param turns       full turns from end to end
   * @param spin        turns per second the coil rotates
   * @param sag         metres of bow at mid-span
   * @param phaseSpread how far the filaments are spread around the coil, 1 = evenly
   * @param taperCurve  how late the radius reaches `radiusEnd`
   */
  helix(from: Vector3, to: Vector3, radius: number, radiusEnd: number, turns: number, spin: number, sag: number, phaseSpread: number, taperCurve: number): this {
    return this.set(PathMode.HELIX, from, to, radius, radiusEnd, turns, spin, sag, phaseSpread, taperCurve, 0);
  }

  /**
   * `ORBIT` — great slow loops around a point, each on its own inclined plane.
   * @param centre       the point being orbited
   * @param pole         a point along the mean orbital axis
   * @param radius       metres
   * @param arc          turns one filament covers; 0.4 is an open loop
   * @param spin         turns per second the loops travel
   * @param wobble       0..1 — how far from a clean circle
   * @param tilt         radians the orbital plane is tipped by
   * @param tiltSpread   radians of per-filament variation on that
   * @param radiusJitter ± fraction of `radius` per filament
   */
  orbit(centre: Vector3, pole: Vector3, radius: number, arc: number, spin: number, wobble: number, tilt: number, tiltSpread: number, radiusJitter: number): this {
    return this.set(PathMode.ORBIT, centre, pole, radius, arc, spin, wobble, tilt, tiltSpread, radiusJitter, 0);
  }

  /**
   * `MEANDER` — a committed veer running out from a centre (the floor crawl of a strike).
   * @param centre where it starts
   * @param up     a point along the plane's normal (usually centre + up)
   * @param inner  metres from the centre at t = 0
   * @param reach  metres at t = 1
   * @param curve  how late it covers the ground; <1 sprints out
   * @param wander radians of per-filament veer
   * @param arch   metres it lifts at mid-span
   * @param hug    metres it floats above the plane throughout
   * @param spin   turns per second the whole crawl rotates
   */
  meander(centre: Vector3, up: Vector3, inner: number, reach: number, curve: number, wander: number, arch: number, hug: number, spin: number): this {
    return this.set(PathMode.MEANDER, centre, up, inner, reach, curve, wander, arch, hug, spin, 0);
  }

  /**
   * `RIM` — an arc travelling around a boundary.
   * @param centre metres
   * @param up     a point along the plane's normal
   * @param radius metres
   * @param span   turns one arc covers; 0.19 is a short hop
   * @param speed  turns per second the arcs travel
   * @param lift   metres it hops over the boundary at mid-span
   * @param jitter 0..1 radial wobble
   * @param hug    metres above the plane
   * @param phase  turns of constant offset, for a second ring
   */
  rim(centre: Vector3, up: Vector3, radius: number, span: number, speed: number, lift: number, jitter: number, hug: number, phase: number): this {
    return this.set(PathMode.RIM, centre, up, radius, span, speed, lift, jitter, hug, phase, 0);
  }

  /**
   * `CHAIN` — a polyline through the nodes set with `FilamentPaths.setNode()`; the lighting arguments are what `ArcNetwork`
   * drives (a static chain passes `lit` far past the node count and gets the whole thing).
   * @param scatter metres the lateral fractions are scaled by
   * @param lift    metres the lift fractions are scaled by
   * @param sag     metres each hop bows downward at mid-hop
   * @param bow     metres each hop bows sideways, alternating
   * @param lit     the front, in hops
   * @param hold    hops a lit segment stays at full
   * @param overlap hops it then decays over
   * @param tip     how much of a hop the front is smeared over
   */
  chain(from: Vector3, to: Vector3, scatter: number, lift: number, sag: number, bow: number, lit: number, hold: number, overlap: number, tip: number): this {
    return this.set(PathMode.CHAIN, from, to, scatter, lift, sag, bow, lit, hold, overlap, tip);
  }

  /**
   * `LINK` — a sagging catenary between two points.
   * @param slack      metres of droop at mid-span when fully slack
   * @param curve      1 is rope, 3 is heavy chain, 0.01 is a parabola
   * @param swing      metres of lateral sway
   * @param swingSpeed radians per second of that sway
   * @param taut       0..1 — 1 pulls the sag out entirely
   * @param spread     metres between parallel filaments
   */
  link(from: Vector3, to: Vector3, slack: number, curve: number, swing: number, swingSpeed: number, taut: number, spread: number): this {
    return this.set(PathMode.LINK, from, to, slack, curve, swing, swingSpeed, taut, spread, 0, 0);
  }

  /**
   * `SPIRAL_IN` — a spiral collapsing from one radius to another as it travels.
   * @param radius      metres at `from`
   * @param radiusEnd   metres at `to`
   * @param turns       full turns along the way
   * @param spin        turns per second
   * @param curve       how late the travel happens; >1 lingers wide
   * @param phaseSpread how far the filaments are spread around, 1 = evenly
   * @param wobble      0..1 radial wobble
   */
  spiralIn(from: Vector3, to: Vector3, radius: number, radiusEnd: number, turns: number, spin: number, curve: number, phaseSpread: number, wobble: number): this {
    return this.set(PathMode.SPIRAL_IN, from, to, radius, radiusEnd, turns, spin, curve, phaseSpread, wobble, 0);
  }

  /**
   * `CRACK` — a branching fracture, three generations deep. Filament 0 is always the trunk from `from` to `to`; the rest fork
   * off it and off each other, so the count is "how much fracture", not "how many lines".
   * @param angle        radians a branch leaves its parent by
   * @param lengthFrac   branch length as a fraction of its parent's
   * @param depthFalloff extra shortening per generation
   * @param spread       ± fraction of variation on `angle`
   * @param start        0..1 — earliest point on a parent a fork may happen
   * @param sag          metres of bow on each segment
   * @param forkBias     0..1 — slides the branch/twig split
   */
  crack(from: Vector3, to: Vector3, angle: number, lengthFrac: number, depthFalloff: number, spread: number, start: number, sag: number, forkBias: number): this {
    return this.set(PathMode.CRACK, from, to, angle, lengthFrac, depthFalloff, spread, start, sag, forkBias, 0);
  }

  private set(mode: number, from: Vector3, to: Vector3, a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number): this {
    this.mode[this.index] = mode;
    this.from.copy(from);
    this.to.copy(to);
    this.shape.set(a, b, c, d);
    this.shape2.set(e, f, g, h);
    return this;
  }
}

// ----------------------------------------------------------------------------------------------------------------- system

export interface FilamentPathsOptions {
  /** nodes along one filament: the ceiling on how fine a kink can be (anything above one kink per two nodes only aliases) */
  samples?: number;
  /** hard ceiling on filaments across all roles */
  capacity?: number;
  /** halo draws here, core at +2 */
  renderOrder?: number;
}

export class FilamentPaths {
  /** the two meshes (halo, core): add under the effect's root */
  readonly group = new Group();
  readonly capacity: number;
  readonly geometry: InstancedBufferGeometry;
  readonly materials: ShaderMaterial[] = [];
  private readonly roles: FilamentRole[];
  private readonly boxes: SharedBoxes;
  /** the halo pass's own width multiplier and alpha: the only two uniforms the passes do not share */
  private readonly glowWidth = { value: 6.2 };
  private readonly glowOpacity = { value: 0.44 };

  constructor(options: FilamentPathsOptions = {}) {
    const samples = Math.max(2, Math.round(options.samples ?? 72));
    this.capacity = Math.max(1, Math.round(options.capacity ?? 48));
    this.geometry = createBoltRibbonGeometry(samples, this.capacity);
    this.geometry.instanceCount = 0;

    const R = MAX_FILAMENT_ROLES;
    const boxes: SharedBoxes = {
      uSeed: { value: 0 },
      uRestrike: { value: 21 },
      uFade: { value: 1 },
      uMode: { value: new Float32Array(R) },
      uCount: { value: new Float32Array(R) },
      uFrom: { value: fill(R, () => new Vector3()) },
      uTo: { value: fill(R, () => new Vector3(0, 1, 0)) },
      uShape: { value: fill(R, () => new Vector4()) },
      uShape2: { value: fill(R, () => new Vector4()) },
      uStyle: { value: fill(R, () => new Vector4(1, 1, 1, 1)) },
      uBundle: { value: fill(R, () => new Vector4(1, 1, 1, 1)) },
      uEnds: { value: fill(R, () => new Vector4(1, 1, 1, 1)) },
      uDraw: { value: fill(R, () => new Vector4(2, 0.08, -1e4, 0)) },
      uNodes: { value: fill(MAX_CHAIN_NODES, () => new Vector4()) },
      uNodeCount: { value: 2 },
      uJitter: { value: 1 },
      uJitterScale: { value: 1.4 },
      uOctaves: { value: 4 },
      uJitterFalloff: { value: 0.55 },
      uCrawl: { value: 2.4 },
      uPinch: { value: 0.16 },
      uWidth: { value: 0.032 },
      uStrandFlash: { value: 0.45 },
      uFlickerSpeed: { value: 30 },
      uFlicker: { value: 0.26 },
      uCoreSharp: { value: 4.4 },
      uGlowFalloff: { value: 2.3 },
      uSoftFade: { value: 0.7 },
      uOpacity: { value: 1 },
      uGlow: { value: 2.2 },
      uColorCore: { value: new Color(1, 1, 1) },
      uColorInner: { value: new Color(0.86, 0.82, 1) },
      uColorOuter: { value: new Color(0.56, 0.42, 1) },
      uColorHalo: { value: new Color(0.16, 0.05, 0.55) },
    };
    this.boxes = boxes;

    const order = options.renderOrder ?? 11;
    const coreWidth = { value: 1 };
    const coreOpacity = { value: 1 };
    // Halo first so the core adds on top of it.
    for (const glow of [true, false]) {
      const material = new ShaderMaterial({
        defines: glow ? { FILAMENT_GLOW: '' } : {},
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: AdditiveBlending,
        side: DoubleSide,
        toneMapped: false,
        uniforms: {
          ...sharedUniforms({
            ...boxes,
            uWidthScale: glow ? this.glowWidth : coreWidth,
            uPassOpacity: glow ? this.glowOpacity : coreOpacity,
          }),
        },
        vertexShader: FILAMENT_VERTEX,
        fragmentShader: FILAMENT_FRAGMENT,
      });
      const mesh = new Mesh(this.geometry, material);
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = order + (glow ? 0 : 2);
      this.group.add(mesh);
      this.materials.push(material);
    }

    this.group.name = 'FilamentPaths';
    this.roles = [];
    for (let i = 0; i < R; i++) this.roles.push(new FilamentRole(boxes, i));

    // Two nodes is the minimum chain: a straight hop from A to B.
    this.setNode(0, 0, 0, 0);
    this.setNode(1, 1, 0, 0);
  }

  /** Two. Four roles or one, forty filaments or three. */
  get drawCalls(): number {
    return this.materials.length;
  }

  /** Filaments actually being drawn this frame, after the capacity clamp. */
  get liveCount(): number {
    return this.geometry.instanceCount;
  }

  role(i: number): FilamentRole {
    return this.roles[i] as FilamentRole;
  }

  /** How many chain nodes are live. Clamped to `MAX_CHAIN_NODES`; returns the applied count. */
  setNodeCount(n: number): number {
    const v = Math.max(2, Math.min(MAX_CHAIN_NODES, Math.round(n)));
    this.boxes.uNodeCount.value = v;
    return v;
  }

  /**
   * One chain node, as **unitless fractions only** — the metres come from the role's `scatter` and `lift` when the shader
   * resolves it, which is what lets a chain re-route under a slider mid-flight.
   * @param along   0..1 from the role's `from` to its `to`
   * @param lateral −1..1, scaled by the role's `scatter`
   * @param lift    0..1, scaled by the role's `lift`
   */
  setNode(i: number, along: number, lateral: number, lift: number): void {
    if (i < 0 || i >= MAX_CHAIN_NODES) return;
    const node = this.boxes.uNodes.value[i] as Vector4;
    node.set(along, lateral, lift, 0);
  }

  /**
   * Where node `i` of a `CHAIN` role actually is, in metres: the shader's `nodeWorld()` line for line, so a burst fired at a
   * node lands *on* it rather than near it.
   */
  nodePoint(roleIndex: number, i: number, out: Vector3): Vector3 {
    const b = this.boxes;
    const from = b.uFrom.value[roleIndex] as Vector3;
    const to = b.uTo.value[roleIndex] as Vector3;
    const shape = b.uShape.value[roleIndex] as Vector4;
    const f = b.uNodes.value[Math.max(0, Math.min(MAX_CHAIN_NODES - 1, i))] as Vector4;

    _dir.set(to.x - from.x, 0, to.z - from.z);
    if (_dir.lengthSq() > 1e-8) {
      _dir.normalize();
      _lat.crossVectors(_up, _dir).normalize();
    } else {
      _lat.set(1, 0, 0);
    }
    out.copy(from).lerp(to, f.x);
    out.addScaledVector(_lat, f.y * shape.x);
    out.y += f.z * shape.y;
    return out;
  }

  /**
   * Pushes the look and the cast state into both passes. Call every frame after the roles are configured: the role counts pass
   * through the capacity clamp here and become the instance count.
   * @param fade 1 while lit, ramping to 0 as it blows out (scales width and alpha of every role)
   * @param seed the cast's one captured dice roll
   */
  sync(look: FilamentLook, fade: number, seed: number): void {
    const u = this.boxes;
    u.uFade.value = fade;
    u.uSeed.value = seed;
    u.uRestrike.value = look.restrike;

    // A role that overruns the capacity is truncated rather than wrapping into the next role's index space, which would
    // silently redraw it as the wrong path. Roles earlier in the list win.
    const counts = u.uCount.value;
    let total = 0;
    for (let i = 0; i < MAX_FILAMENT_ROLES; i++) {
      const want = counts[i] as number;
      const got = Math.min(want, Math.max(0, this.capacity - total));
      counts[i] = got;
      total += got;
    }
    this.geometry.instanceCount = total;

    u.uJitter.value = look.jitter;
    u.uJitterScale.value = look.jitterScale;
    u.uOctaves.value = Math.round(look.octaves);
    u.uJitterFalloff.value = look.jitterFalloff;
    u.uCrawl.value = look.crawl;
    u.uPinch.value = look.pinch;

    u.uWidth.value = look.width;
    this.glowWidth.value = look.glowWidth;
    this.glowOpacity.value = look.glowOpacity;

    u.uStrandFlash.value = look.strandFlash;
    u.uFlickerSpeed.value = look.flickerSpeed;
    u.uFlicker.value = look.flicker;
    u.uCoreSharp.value = look.coreSharp;
    u.uGlowFalloff.value = look.glowFalloff;
    u.uSoftFade.value = look.softFade;
    u.uOpacity.value = look.opacity;
    u.uGlow.value = look.glow;
    putHex(u.uColorCore.value, look.colorCore);
    putHex(u.uColorInner.value, look.colorInner);
    putHex(u.uColorOuter.value, look.colorOuter);
    putHex(u.uColorHalo.value, look.colorHalo);
  }

  /** Retires every role and stops drawing (the instance stays reusable). */
  clear(): void {
    this.boxes.uCount.value.fill(0);
    this.geometry.instanceCount = 0;
    this.boxes.uFade.value = 0;
  }

  dispose(): void {
    this.geometry.dispose();
    for (const m of this.materials) m.dispose();
    this.group.parent?.remove(this.group);
  }
}
