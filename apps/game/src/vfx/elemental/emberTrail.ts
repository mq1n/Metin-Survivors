// Ported from threejs-vfx src/materials/VolumetricFireMaterial.js + src/effects/RibbonGeometry.js (MIT, © mohamedachrefelouafi —
// see ./LICENSE), driven by the meteor ability's `trail*` block (src/config/abilities/meteor.js).
// The burning wake of a falling body, raymarched as a black-body volume. The mesh drawn is only a camera-facing proxy hull around
// the flight path; every fragment reconstructs the curve's local frame, fires a ray from the camera and integrates emission and soot
// absorption through a field built in four layers (silhouette → vortex roll-up → turbulence → shred). Shading is temperature-driven:
// a Planckian radiator (red fringe → orange body → white core) blended with the effect palette.
// Changes from the sandbox: the hull is built in the vertex shader from path uniforms (A → B line with an optional lob, a window on
// it), so a frame costs 20 uniform writes and no buffer upload; occlusion by the ground is an analytic plane (the game has no depth
// prepass); the settings tree is a typed `EmberTrailLook`; tier scaling of steps / octaves.
import { Color, CustomBlending, DoubleSide, Mesh, OneFactor, OneMinusSrcAlphaFactor, ShaderMaterial, Sphere, Vector3, AddEquation, BufferAttribute, BufferGeometry } from 'three';
import { putHex } from './color';
import { sharedUniforms } from './frame';
import { commonGLSL } from './glsl/common';
import { noiseGLSL } from './glsl/noise';
import { saturate } from './math';

/** Interior hull nodes the geometry can carry (plus a cap at each end). */
const MAX_NODES = 32;

/** How far past the nominal tube radius the fringe shred can push density, before the low-frequency bulge. */
const FIRE_SHRED_REACH = 1.55;

/** Wake controls (defaults = the sandbox's `meteor.trail*`). Read on every `sync`. */
export interface EmberTrailLook {
  /** metres of path the fire covers behind the head */
  span: number;
  /** tube radius, metres */
  width: number;
  /** fireball radius at the head, × width */
  headSize: number;
  /** upward stretch of the volume (buoyant elongation) */
  plume: number;
  /** how far the spent gas behind the head has ballooned */
  wakeSpread: number;
  /** how far the far end of the wake has floated upward, metres */
  rise: number;
  /** metre-scale lobes in the silhouette: how far they swell and pinch the local radius, and their frequency (per metre) */
  bulge: number;
  bulgeScale: number;
  vortex: number;
  ringFrequency: number;
  ringSpeed: number;
  curl: number;
  turbulence: number;
  warp: number;
  tongue: number;
  streamStretch: number;
  lick: number;
  wisps: number;
  shred: number;
  octaves: number;
  speed: number;
  buoyancy: number;
  detachment: number;
  noiseStrength: number;
  noiseFrequency: number;
  softness: number;
  flicker: number;
  density: number;
  soot: number;
  coreClarity: number;
  steps: number;
  glow: number;
  opacity: number;
  tailFade: number;
  tempCore: number;
  tempEdge: number;
  emissionCurve: number;
  heatFocus: number;
  heatFalloff: number;
  heatFollow: number;
  tailHeat: number;
  /** 0 = pure black-body physics, 1 = the palette stops */
  palette: number;
  scatter: number;
  scatterFalloff: number;
}

export function emberTrailLook(): EmberTrailLook {
  return {
    span: 7, width: 0.66, headSize: 1.8, plume: 1.1, wakeSpread: 0.22, rise: 0.35, bulge: 0.18, bulgeScale: 0.34, vortex: 0,
    ringFrequency: 0, ringSpeed: 4, curl: 0, turbulence: 2.94, warp: 0.45, tongue: 0.94, streamStretch: 1.13, lick: 3.1, wisps: 0.81,
    shred: 1.57, octaves: 5, speed: 4.62, buoyancy: 3.5, detachment: 0.9, noiseStrength: 0.78, noiseFrequency: 3.23,
    softness: 0.42, flicker: 0.74, density: 2.09, soot: 1.42, coreClarity: 0.54, steps: 35, glow: 3.06, opacity: 0.96,
    tailFade: 0.71, tempCore: 1920, tempEdge: 1590, emissionCurve: 4.79, heatFocus: 1.54, heatFalloff: 2.46, heatFollow: 0.26,
    tailHeat: 0.36, palette: 0.62, scatter: 1.99, scatterFalloff: 4.4,
  };
}

/** Radius of the flame at `u` along the stream, in units of `uRadius`. Shared by the hull (vertex) and the volume (fragment). */
const PROFILE_GLSL = /* glsl */ `
  uniform float uWakeSpread;
  uniform float uHeadSize;
  float flameProfile(float u) {
    float body = (0.34 + 0.66 * pow(u, 0.55)) * (1.0 + uWakeSpread * pow(1.0 - u, 1.8));
    return body * (1.0 + (uHeadSize - 1.0) * smoothstep(0.62, 1.0, u));
  }
`;

const PATH_GLSL = /* glsl */ `
  #define PI 3.141592653589793
  uniform vec3  uPathA;
  uniform vec3  uPathB;
  uniform float uArc;
  uniform float uArcCurve;

  vec3 pathAt(float q) {
    float c = clamp(q, 0.0, 1.0);
    vec3 p = mix(uPathA, uPathB, c);
    p.y += uArc * pow(max(sin(PI * c), 0.0), uArcCurve);
    return p;
  }
  vec3 tangentAt(float q) {
    vec3 d = pathAt(q + 0.012) - pathAt(q - 0.012);
    float l = length(d);
    return l > 1e-5 ? d / l : normalize(uPathB - uPathA + vec3(0.0, -1e-3, 0.0));
  }
`;

const TRAIL_VERTEX = /* glsl */ `
  ${PATH_GLSL}
  ${PROFILE_GLSL}

  uniform float uQTail;
  uniform float uQHead;
  uniform float uNodes;
  uniform float uStreamLength;
  uniform float uTailPad;
  uniform float uHeadPad;
  uniform float uHullRadius;
  uniform float uRadius;
  uniform float uRise;

  varying vec3  vCenter;
  varying vec3  vTangent;
  varying float vS;
  varying float vRadius;
  varying vec3  vWorld;

  void main() {
    float k = position.x;          // 0 = tail cap, 1..N = path nodes, N+1 = head cap
    float side = position.y;       // -1 / +1 across the hull
    float n = max(uNodes, 2.0);
    float f = clamp((k - 1.0) / (n - 1.0), 0.0, 1.0);
    float q = mix(uQTail, uQHead, f);

    vec3 tangent = tangentAt(q);
    vec3 center = pathAt(q);
    float s = f * uStreamLength;   // metres from the tail of the *stream*

    // The wake is hot gas: the further behind the head it is, the longer it has had to climb.
    float age = 1.0 - f;
    center.y += uRise * pow(age, 1.5);
    if (k < 0.5) {
      center -= tangent * uTailPad;
      s = -uTailPad;
    } else if (k > n + 0.5) {
      center += tangent * uHeadPad;
      s = uStreamLength + uHeadPad;
    }

    // Local tube radius, so the fragment can size its march window to the flame in front of it.
    float u = clamp(s / max(uStreamLength, 0.01), 0.0, 1.0);
    float local = flameProfile(u);
    vRadius = uRadius * local;

    // Camera-facing strip through the axis: the hull only has to *contain* the volume.
    vec3 view = cameraPosition - center;
    vec3 across = cross(tangent, view);
    float al = length(across);
    across = al > 1e-5 ? across / al : vec3(1.0, 0.0, 0.0);
    vec3 world = center + across * (side * uHullRadius * local);

    vCenter = center;
    vTangent = tangent;
    vS = s;
    vWorld = world;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const TRAIL_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uRadius;
  uniform float uPlume;
  uniform float uStreamLength;
  uniform float uDetachment;
  uniform float uSoftness;
  uniform float uShred;
  uniform float uBulge;
  uniform float uBulgeScale;
  uniform float uFlow;
  uniform float uBuoyancy;
  uniform float uSwirl;
  uniform float uSwirlSpeed;
  uniform float uVortex;
  uniform float uRingFreq;
  uniform float uRingSpeed;
  uniform float uNoiseFrequency;
  uniform float uNoiseStrength;
  uniform float uWarp;
  uniform float uTongue;
  uniform float uStreamStretch;
  uniform float uWisp;
  uniform float uFlicker;
  uniform float uLick;
  uniform float uOctaves;
  uniform float uTempCore;
  uniform float uTempEdge;
  uniform float uEmissionCurve;
  uniform float uHeatFocus;
  uniform float uHeatFalloff;
  uniform float uHeatFollow;
  uniform float uTailHeat;
  uniform float uPalette;
  uniform float uScatter;
  uniform float uScatterFalloff;
  uniform float uDensity;
  uniform float uSoot;
  uniform float uCoreClarity;
  uniform float uEmission;
  uniform float uOpacity;
  uniform float uSteps;
  uniform float uSeed;
  uniform float uHeadFade;
  uniform float uTailFade;
  uniform float uGroundY;
  uniform vec3  uOccCenter;
  uniform float uOccRadius;
  uniform vec3  uColorCore;
  uniform vec3  uColorMid;
  uniform vec3  uColorEdge;
  uniform vec3  uColorSmoke;
  uniform float uShaderIntensity;
  uniform float uGlobalGlow;

  varying vec3  vCenter;
  varying vec3  vTangent;
  varying float vS;
  varying float vRadius;
  varying vec3  vWorld;

  ${noiseGLSL}
  ${commonGLSL}
  ${PROFILE_GLSL}

  /* Where the fringe shred starts and stops. REACH_HI bounds how far outside the nominal tube the noise can push density, and
     therefore how wide the proxy hull has to be (mirrored by FIRE_SHRED_REACH on the JS side). */
  const float REACH_LO = 1.15;
  const float REACH_HI = 1.55;

  /* A volume march needs a cheap field: trilinear value noise on a hashed lattice, roughly a third of the cost of the simplex noise
     the surface shaders use, and indistinguishable once five octaves of it are being advected, warped and rolled. */
  float vnoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash13(i);
    float b = hash13(i + vec3(1.0, 0.0, 0.0));
    float c = hash13(i + vec3(0.0, 1.0, 0.0));
    float d = hash13(i + vec3(1.0, 1.0, 0.0));
    float e = hash13(i + vec3(0.0, 0.0, 1.0));
    float g = hash13(i + vec3(1.0, 0.0, 1.0));
    float h = hash13(i + vec3(0.0, 1.0, 1.0));
    float k = hash13(i + vec3(1.0, 1.0, 1.0));
    return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z);
  }

  /* Unit-determinant rotation applied between octaves: stacking octaves along the same axes lines their features up into a visible
     grid; rotating the domain between them scatters that structure. */
  const mat3 OCTAVE_ROT = mat3(
     0.00,  0.80,  0.60,
    -0.80,  0.36, -0.48,
    -0.60, -0.48,  0.64
  );

  /* Turbulent flame field, normalised to 0..1: progressive domain warping (each octave displaced by the one before), buoyant shear
     (every octave drifts upward faster than the last so fine detail outruns the coarse shapes) and inter-octave rotation.
     ridge = sharp filaments from the two finest octaves, coarse = the field truncated to its two largest scales (temperature is
     read off that, see flameSample). */
  float flameFbm(vec3 p, float rise, out float ridge, out float coarse) {
    float v = 0.0;
    float a = 0.5;
    float norm = 0.0;
    float scale = 1.0;
    ridge = 0.0;
    coarse = 0.5;
    for (int i = 0; i < 5; i++) {
      if (float(i) >= uOctaves) break;
      float n = vnoise(p);
      v += a * n;
      norm += a;
      if (i == 1) coarse = v / norm;
      // Ridges come from the finest octaves alone: averaging the coarse ones in draws contour lines on the flame.
      if (i >= 3) ridge = max(ridge, 1.0 - abs(n * 2.0 - 1.0));
      p = OCTAVE_ROT * p * 2.17 + (n - 0.5) * uWarp * vec3(1.7, 0.9, 1.3);
      scale *= 2.17;
      p.y -= rise * scale * (1.0 + 0.6 * float(i));
      a *= 0.55;
    }
    return v / max(norm, 1e-4);
  }

  /* Planckian radiator in the linear working space (Tanner Helland's fit, valid 1000-40000 K). Fire is not a palette, it is a
     temperature: the red fringe, orange body and white core are the colours a grey body emits between ~1200 and ~3300 K. */
  vec3 blackbody(float kelvin) {
    float t = clamp(kelvin, 1000.0, 12000.0) * 0.01;
    vec3 c;
    if (t <= 66.0) {
      c.r = 1.0;
      c.g = 0.3900816 * log(t) - 0.6318414;
      c.b = t <= 19.0 ? 0.0 : 0.5432068 * log(t - 10.0) - 1.1962540;
    } else {
      c.r = 1.2929362 * pow(t - 60.0, -0.1332047);
      c.g = 1.1298909 * pow(t - 60.0, -0.0755148);
      c.b = 1.0;
    }
    c = clamp(c, 0.0, 1.0);
    return c * c * (0.6 + 0.4 * c);
  }

  /* Density of the flame at a world point. heat: 0 at the perturbed surface, 1 in the burning core. bath: how strongly this point
     is lit by the flame around it, for the single-scatter term. */
  float flameSample(vec3 p, out float heat, out float bath) {
    heat = 0.0;
    bath = 0.0;

    vec3 rel = p - vCenter;
    float ax = dot(rel, vTangent);
    vec3 perp = rel - vTangent * ax;

    float s = vS + ax;                                  // metres from the tail
    float u = clamp(s / max(uStreamLength, 0.01), 0.0, 1.0);
    float age = 1.0 - u;

    // Billowing wake behind a fireball at the nose.
    float radius = uRadius * flameProfile(u);

    // A local frame whose "up" is world up (projected off the tangent), so buoyancy, the teardrop stretch and the vertical
    // elongation of the noise all pull in the direction gravity actually cares about.
    vec3 upAxis = vec3(0.0, 1.0, 0.0) - vTangent * vTangent.y;
    float upLen = length(upAxis);
    upAxis = upLen > 1e-3 ? upAxis / upLen : vec3(1.0, 0.0, 0.0);
    vec3 sideAxis = cross(vTangent, upAxis);

    float py = dot(perp, upAxis);
    float px = dot(perp, sideAxis);

    // Buoyant stretch: mostly upward, so the cross-section is a teardrop; the underside gets a quarter of it so the flame drapes.
    float plume = max(uPlume, 0.05);
    float shapedY = py > 0.0 ? py / plume : py / (1.0 + (plume - 1.0) * 0.25);
    float rad = length(vec2(px, shapedY));

    // Fold the axial overshoot past either end into the radius: a capsule, so the stream ends in round caps.
    float over = s - clamp(s, 0.0, uStreamLength);
    rad = sqrt(rad * rad + over * over);

    // Conservative reject before paying for any noise.
    float qNominal = rad / max(radius, 1e-3);
    if (qNominal > REACH_HI * (1.0 + uBulge)) return 0.0;

    float sFlow = s - uTime * uFlow;                    // streams backwards

    // ---- 1. silhouette: metre-scale lobes. A fireball's outline is dominated by lobes as wide as the flame itself.
    float lobe = vnoise(vec3(px, py * 0.8, sFlow * 0.7) * uBulgeScale + vec3(uSeed, uTime * 0.25, 0.0)) * 2.0 - 1.0;
    radius *= 1.0 + uBulge * lobe;

    float q = rad / max(radius, 1e-3);
    float edge = 1.0 - q;
    if (edge < -1.2) return 0.0;

    // ---- 2. vortex roll-up: hot gas sheds ring vortices that travel back and grow; rotating the domain by a travelling wave
    // folds the field over itself (curling, mushrooming billows; plain fbm only ever makes clouds).
    vec2 rp = rot2(s * uSwirl * 0.3 + uTime * uSwirlSpeed + uSeed) * vec2(px, py);
    float phase = s * uRingFreq - uTime * uRingSpeed + uSeed;
    float roll = uVortex * sin(phase * 6.2831853) * smoothstep(0.0, 0.32, age) * exp(-q * q * 0.7);
    vec2 rolled = rot2(roll) * vec2(sFlow * uStreamStretch, rp.y * uTongue);

    // ---- 3. turbulence: anisotropic on purpose, a lower frequency vertically and along the flow draws every structure out
    // into a tall, streamwise tongue.
    vec3 np = vec3(rp.x, rolled.y, rolled.x) * uNoiseFrequency;
    np.y -= uTime * uBuoyancy;                          // hot gas climbs
    // Radial shear: gas at the fringe is dragged upward and backward in proportion to how far out it sits (licking tongues).
    np.y -= uLick * q * q;
    np.z += uLick * 0.45 * q * q;

    float ridge, coarse;
    float n = flameFbm(np, uTime * uBuoyancy * 0.06, ridge, coarse) * 2.0 - 1.0;
    coarse = coarse * 2.0 - 1.0;

    // Filaments belong to the fringe. Subtracting the ridge deepens the gaps between lobes (strands) instead of drawing contours.
    float fringe = smoothstep(0.3, 1.05, q);
    float turbulent = n * 0.75 + (0.5 - ridge) * uWisp * fringe;

    // ---- 4. shred: the heart of the flame is barely touched by the noise while the fringe is torn apart by it. The falloff past
    // REACH_LO bounds how far outside the nominal tube the noise can push density (or the hull slices the flame along a line).
    float shred = mix(mix(0.26, 1.0, age), 1.8 * uShred, smoothstep(0.06, 1.05, q)) * (1.0 - smoothstep(REACH_LO, REACH_HI, q));
    // Turbulence is fully developed in the wake and still growing at the head.
    float erosion = uNoiseStrength * shred * (1.0 + 1.3 * age);
    float field = edge + turbulent * erosion;
    field -= uDetachment * age * 0.55;                  // the tail tears into puffs

    // Temperature gets its own, deliberately blunter field: radiated power goes as a high power of temperature, so whatever
    // drives it gets its contrast multiplied several-fold on screen; driven from the full noise it renders as polished agate.
    float heatField = edge + coarse * uHeatFollow * uNoiseStrength * shred - uDetachment * age * 0.55;

    float d = smoothstep(0.0, clamp(uSoftness, 0.05, 1.0), field);
    if (d <= 0.0) return 0.0;

    d *= smoothstep(0.0, max(uTailFade, 0.01), u);
    d *= 1.0 - smoothstep(1.0 - uHeadFade, 1.0, u) * step(0.001, uHeadFade);

    // ---- temperature, from the perturbed shape (a tongue stays hot along its own spine and cools toward its own tip)
    float interior = clamp(heatField * uHeatFocus, 0.0, 1.0);
    // Spent gas has mixed: flatten the radial profile with age (also what keeps the thin tail from rendering as nested rings).
    interior = mix(interior, 0.55, age * age * 0.65);
    // ...and behind the head it has also had time to radiate away.
    float cool = mix(uTailHeat, 1.0, pow(u, 0.55));
    heat = clamp(pow(interior, max(uHeatFalloff, 0.05)) * cool, 0.0, 1.0);

    // Cool gas close to the burning core is bathed in its light.
    bath = exp(-max(q - 0.5, 0.0) * uScatterFalloff) * (1.0 - heat);

    return d * uDensity;
  }

  void main() {
    vec3 ro = cameraPosition;
    vec3 rd = normalize(vWorld - ro);

    // Bound the volume with the ellipsoid it actually occupies (upward-stretched capsule) instead of a sphere: one extra dot
    // product buys back the factor directly as step density.
    float reach = REACH_HI * (1.0 + uBulge);
    vec3 up = vec3(0.0, 1.0, 0.0) - vTangent * vTangent.y;
    float upLen = length(up);
    up = upLen > 1e-3 ? up / upLen : vec3(1.0, 0.0, 0.0);
    vec3 side = cross(vTangent, up);

    float rPerp = max(vRadius * reach, uRadius * 0.2);
    float rUp   = rPerp * max(uPlume, 1.0);
    float rDown = rPerp * (1.0 + (max(uPlume, 1.0) - 1.0) * 0.25);
    float rVert = (rUp + rDown) * 0.5;
    vec3 origin = vCenter + up * (rUp - rDown) * 0.5;
    // Looking down the barrel of the stream a ray stays inside the volume for its whole length; broadside it is through in one diameter.
    float axial = abs(dot(rd, vTangent));
    float rLong = mix(rPerp, max(uStreamLength * 0.6, rPerp), axial * axial);

    vec3 o = ro - origin;
    vec3 eo = vec3(dot(o, side) / rPerp, dot(o, up) / rVert, dot(o, vTangent) / rLong);
    vec3 ed = vec3(dot(rd, side) / rPerp, dot(rd, up) / rVert, dot(rd, vTangent) / rLong);
    float ea = max(dot(ed, ed), 1e-8);
    float eb = dot(eo, ed);
    float ec = dot(eo, eo) - 1.0;
    float disc = eb * eb - ea * ec;
    if (disc <= 0.0) discard;
    float esq = sqrt(disc);
    float maxRadius = rPerp;
    float t0 = max((-eb - esq) / ea, 0.02);
    float t1 = (-eb + esq) / ea;

    // The game has no depth prepass: the floor is an analytic plane at the impact height (correct occlusion near the landing).
    float tScene = rd.y < -1e-4 ? (uGroundY - ro.y) / rd.y : 1e6;
    t1 = min(t1, tScene);
    // The rock is the one opaque body inside the volume. An analytic sphere stands in for the sandbox's depth prepass: the fire
    // behind it is hidden, the fire in front of it burns over its face.
    if (uOccRadius > 0.0) {
      vec3 oc = ro - uOccCenter;
      float ob = dot(oc, rd);
      float od = ob * ob - (dot(oc, oc) - uOccRadius * uOccRadius);
      if (od > 0.0) {
        float oT = -ob - sqrt(od);
        if (oT > 0.0) t1 = min(t1, oT);
      }
    }
    if (t1 <= t0) discard;

    float steps = clamp(uSteps, 6.0, 72.0);
    float baseStep = (t1 - t0) / steps;
    // Dither the entry point: a fixed start turns the slices into visible onion rings, a per-pixel offset into grain the bloom eats.
    float t = t0 + baseStep * hash13(vec3(gl_FragCoord.xy, fract(uTime) * 64.0));

    // One flicker value for the whole ray: the flame brightens and dims as a body (slow roll of the bulk + fast tremor of the burn).
    float flickN = vnoise(vec3(uTime * 5.3, uSeed, 0.0)) * 0.7 + vnoise(vec3(uTime * 13.1, uSeed * 2.0, 5.0)) * 0.3;
    float flick = clamp(1.0 + uFlicker * 0.6 * (flickN * 2.0 - 1.0), 0.4, 1.7);

    vec3 acc = vec3(0.0);
    float transmittance = 1.0;
    // Coast through empty space at a coarser stride, and drop back to the fine one the moment anything is hit.
    float stride = 1.0;

    for (int i = 0; i < 72; i++) {
      if (t >= t1 || transmittance < 0.012) break;

      float heat, bath;
      float d = flameSample(ro + rd * t, heat, bath);
      float stepSize = baseStep * stride;

      if (d > 0.002) {
        stride = 1.0;
        stepSize = baseStep;
        // Soften the contact with the floor.
        d *= clamp((tScene - t) / max(maxRadius * 0.6, 1e-3), 0.0, 1.0);

        float kelvin = mix(uTempEdge, uTempCore, heat);
        // The palette blend keeps the effect colours meaningful without letting them fight the physics.
        vec3 artistic = gradient4(uColorCore, uColorMid, uColorEdge, uColorSmoke, pow(1.0 - heat, 0.85));
        vec3 tint = mix(blackbody(kelvin), artistic, clamp(uPalette, 0.0, 1.0));

        // Stefan-Boltzmann: the single exponent that gives the volume its enormous internal dynamic range.
        float power = pow(kelvin / max(uTempCore, 1.0), uEmissionCurve);
        vec3 emission = tint * power;

        // Single scatter: the sooty gas wrapped around the burn does not radiate, it reflects.
        emission += mix(uColorEdge, uColorMid, bath) * uScatter * bath * bath * 0.06;

        acc += emission * uEmission * flick * d * transmittance * stepSize;

        // Soot extinction: the cool fringe blocks the background hard, and even the hot gas keeps enough to occlude its own far
        // side (squared, so only the genuinely white-hot gas turns clear).
        transmittance *= exp(-d * uSoot * mix(1.0, uCoreClarity, heat * heat) * stepSize);
      } else {
        stride = min(stride * 1.6, 2.2);
      }

      t += stepSize;
    }

    float alpha = clamp((1.0 - transmittance) * uOpacity, 0.0, 1.0);
    vec3 color = acc * uOpacity * uGlobalGlow * mix(0.65, 1.0, uShaderIntensity);
    if (alpha < 0.002 && max(color.r, max(color.g, color.b)) < 0.002) discard;

    gl_FragColor = vec4(min(color, vec3(64.0)), alpha);
  }
`;

const _a = new Vector3();
const _b = new Vector3();

export class EmberTrail {
  readonly mesh: Mesh;
  readonly look: EmberTrailLook = emberTrailLook();
  /** metres of the whole path A → B (arc included) */
  pathLength = 1;
  /** hull nodes in use */
  private nodes = 8;
  private readonly geometry: BufferGeometry;
  private readonly material: ShaderMaterial;
  private readonly u = {
    ...sharedUniforms({
      // path & window
      uPathA: { value: new Vector3() },
      uPathB: { value: new Vector3(0, -1, 0) },
      uArc: { value: 0 },
      uArcCurve: { value: 0.85 },
      uQTail: { value: 0 },
      uQHead: { value: 1 },
      uNodes: { value: 8 },
      uStreamLength: { value: 6 },
      uTailPad: { value: 0.3 },
      uHeadPad: { value: 1 },
      uHullRadius: { value: 1 },
      uRise: { value: 0 },
      uGroundY: { value: 0 },
      uOccCenter: { value: new Vector3() },
      uOccRadius: { value: 0 },
      // shape
      uRadius: { value: 0.66 },
      uHeadSize: { value: 1.8 },
      uPlume: { value: 1.1 },
      uWakeSpread: { value: 0.22 },
      uDetachment: { value: 0.9 },
      uSoftness: { value: 0.42 },
      uShred: { value: 1.57 },
      uBulge: { value: 0.18 },
      uBulgeScale: { value: 0.34 },
      // motion
      uFlow: { value: 4.62 },
      uBuoyancy: { value: 3.5 },
      uSwirl: { value: 0 },
      uSwirlSpeed: { value: 1.6 },
      uVortex: { value: 0 },
      uRingFreq: { value: 0 },
      uRingSpeed: { value: 4 },
      uNoiseFrequency: { value: 3.23 },
      uNoiseStrength: { value: 0.64 },
      uWarp: { value: 0.45 },
      uTongue: { value: 0.94 },
      uStreamStretch: { value: 1.13 },
      uWisp: { value: 0.81 },
      uFlicker: { value: 0.74 },
      uLick: { value: 3.1 },
      uOctaves: { value: 5 },
      // temperature & radiance
      uTempCore: { value: 1920 },
      uTempEdge: { value: 1590 },
      uEmissionCurve: { value: 4.79 },
      uHeatFocus: { value: 1.54 },
      uHeatFalloff: { value: 2.46 },
      uHeatFollow: { value: 0.26 },
      uTailHeat: { value: 0.36 },
      uPalette: { value: 0.62 },
      uScatter: { value: 1.99 },
      uScatterFalloff: { value: 4.4 },
      // rendering
      uDensity: { value: 2.09 },
      uSoot: { value: 1.42 },
      uCoreClarity: { value: 0.54 },
      uEmission: { value: 7.3 },
      uOpacity: { value: 1 },
      uSteps: { value: 24 },
      uSeed: { value: 0 },
      uHeadFade: { value: 0 },
      uTailFade: { value: 0.71 },
      uColorCore: { value: new Color(1, 0.96, 0.82) },
      uColorMid: { value: new Color(1, 0.69, 0.18) },
      uColorEdge: { value: new Color(1, 0.24, 0.06) },
      uColorSmoke: { value: new Color(0.14, 0.1, 0.09) },
    }),
  };

  constructor(renderOrder = 11) {
    // the hull strip in parameter space: position = (node k, side, 0), one pair per node plus a cap at each end
    const pairs = MAX_NODES + 2;
    const positions = new Float32Array(pairs * 2 * 3);
    for (let k = 0; k < pairs; k++) {
      positions[k * 6] = k;
      positions[k * 6 + 1] = -1;
      positions[k * 6 + 3] = k;
      positions[k * 6 + 4] = 1;
    }
    const indices = new Uint16Array((pairs - 1) * 6);
    for (let k = 0; k < pairs - 1; k++) {
      const a = k * 2;
      indices.set([a, a + 1, a + 2, a + 2, a + 1, a + 3], k * 6);
    }
    this.geometry = new BufferGeometry();
    this.geometry.setAttribute('position', new BufferAttribute(positions, 3));
    this.geometry.setIndex(new BufferAttribute(indices, 1));
    this.geometry.boundingSphere = new Sphere(new Vector3(), 1e4);
    this.geometry.setDrawRange(0, 0);

    this.material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      // the per-sample ground clip inside the march does the occlusion job; testing the flat hull's own depth would slice the volume
      depthTest: false,
      // a real flame both emits and blocks: premultiplied "over", not additive
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      blendSrcAlpha: OneFactor,
      blendDstAlpha: OneMinusSrcAlphaFactor,
      side: DoubleSide,
      toneMapped: false,
      uniforms: { ...this.u },
      vertexShader: TRAIL_VERTEX,
      fragmentShader: TRAIL_FRAGMENT,
    });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.visible = false;
  }

  /** Gradient stops, 0xRRGGBB sRGB: white-hot core, mid, edge, smoke; `palette` 0..1 = how far the stops override the black body. */
  setPalette(core: number, mid: number, edge: number, smoke: number, palette: number): void {
    putHex(this.u.uColorCore.value, core);
    putHex(this.u.uColorMid.value, mid);
    putHex(this.u.uColorEdge.value, edge);
    putHex(this.u.uColorSmoke.value, smoke);
    this.look.palette = palette;
  }

  /** The straight path A (sky end) → B (ground end), with an optional lob of `arc` metres at mid-path. */
  setPath(ax: number, ay: number, az: number, bx: number, by: number, bz: number, arc: number, arcCurve: number): void {
    this.u.uPathA.value.set(ax, ay, az);
    this.u.uPathB.value.set(bx, by, bz);
    this.u.uArc.value = arc;
    this.u.uArcCurve.value = arcCurve;
    this.u.uSeed.value = (ax * 12.9898 + az * 78.233) % 20;
    // arc length by sampling (exact for a straight line)
    let len = 0;
    this.pointAt(0, _a);
    for (let i = 1; i <= 12; i++) {
      this.pointAt(i / 12, _b);
      len += _b.distanceTo(_a);
      _a.copy(_b);
    }
    this.pathLength = Math.max(len, 1e-3);
    this.nodes = arc > 0.01 ? MAX_NODES : 6;
    this.u.uNodes.value = this.nodes;
    this.geometry.setDrawRange(0, (this.nodes + 1) * 6);
  }

  /** point on the path at fraction q (mirror of `pathAt` in the vertex shader) */
  pointAt(q: number, out: Vector3): Vector3 {
    const c = saturate(q);
    out.lerpVectors(this.u.uPathA.value, this.u.uPathB.value, c);
    out.y += this.u.uArc.value * Math.pow(Math.max(Math.sin(Math.PI * c), 0), this.u.uArcCurve.value);
    return out;
  }

  /** An opaque sphere inside the volume (the rock): fire behind it is hidden. Radius 0 clears it. */
  setOccluder(x: number, y: number, z: number, radius: number): void {
    this.u.uOccCenter.value.set(x, y, z);
    this.u.uOccRadius.value = radius;
  }

  /** unit direction of travel at fraction q */
  headingAt(q: number, out: Vector3): Vector3 {
    this.pointAt(q + 0.012, _a);
    this.pointAt(q - 0.012, out);
    out.subVectors(_a, out);
    const l = out.length();
    return l > 1e-5 ? out.multiplyScalar(1 / l) : out.set(0, -1, 0);
  }

  /** Quality: raymarch steps, octaves. */
  setTier(tier: number): void {
    const look = this.look;
    look.steps = tier >= 3 ? 34 : tier === 2 ? 24 : 14;
    look.octaves = tier >= 3 ? 5 : tier === 2 ? 4 : 3;
  }

  /**
   * Places the wake on the path and pushes the live look into the material.
   * @param qHead path fraction of the head (the falling body)
   * @param burn 0 while the head is feeding the wake → 1 as it dies out (the tail eats up to the head)
   * @param groundY height of the floor plane the volume is clipped against
   * @param fade master opacity multiplier 0..1
   */
  sync(qHead: number, burn: number, groundY: number, fade: number): void {
    const l = this.look;
    const u = this.u;
    const head = saturate(qHead);
    const span = Math.max(0.05, l.span) / this.pathLength;
    // once the head is gone the tail eats its way up to it
    const tail = saturate(head - span * (1 - burn));
    const length = (head - tail) * this.pathLength;
    if (length < 0.06 || fade < 0.004) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;

    // the volume thins out as it dies rather than only fading
    const radius = Math.max(0.01, l.width) * (1 - burn * 0.65);
    const reach = FIRE_SHRED_REACH * (1 + l.bulge) * 1.3;
    const headRadius = radius * l.headSize;
    // profile(0) mirror: (0.34 + 0) · (1 + wakeSpread)
    const tailPad = radius * 0.34 * (1 + l.wakeSpread) * reach;
    const headPad = headRadius * reach;

    u.uQTail.value = tail;
    u.uQHead.value = head;
    u.uStreamLength.value = length;
    u.uTailPad.value = tailPad;
    u.uHeadPad.value = headPad;
    u.uRadius.value = radius;
    u.uHullRadius.value = radius * 1.08 * reach * Math.max(1, l.plume);
    u.uRise.value = l.rise;
    u.uGroundY.value = groundY;

    u.uHeadSize.value = l.headSize;
    u.uPlume.value = l.plume;
    u.uWakeSpread.value = l.wakeSpread;
    u.uDetachment.value = l.detachment + (1.1 - l.detachment) * burn;
    u.uSoftness.value = l.softness;
    u.uShred.value = l.shred;
    u.uBulge.value = l.bulge;
    u.uBulgeScale.value = l.bulgeScale;

    u.uFlow.value = l.speed;
    u.uBuoyancy.value = l.buoyancy;
    u.uSwirl.value = l.curl;
    u.uSwirlSpeed.value = l.speed * 0.35;
    u.uVortex.value = l.vortex;
    u.uRingFreq.value = l.ringFrequency;
    u.uRingSpeed.value = l.ringSpeed;
    u.uNoiseFrequency.value = l.noiseFrequency;
    u.uNoiseStrength.value = 0.28 * l.turbulence * l.noiseStrength;
    u.uWarp.value = l.warp;
    u.uTongue.value = l.tongue;
    u.uStreamStretch.value = l.streamStretch;
    u.uWisp.value = l.wisps;
    u.uFlicker.value = l.flicker;
    u.uLick.value = l.lick;
    u.uOctaves.value = l.octaves;

    u.uTempCore.value = l.tempCore;
    u.uTempEdge.value = l.tempEdge;
    u.uEmissionCurve.value = l.emissionCurve;
    u.uHeatFocus.value = l.heatFocus;
    u.uHeatFalloff.value = l.heatFalloff;
    u.uHeatFollow.value = l.heatFollow;
    u.uTailHeat.value = l.tailHeat;
    u.uPalette.value = l.palette;
    u.uScatter.value = l.scatter;
    u.uScatterFalloff.value = l.scatterFalloff;

    u.uDensity.value = l.density;
    u.uSoot.value = l.soot;
    u.uCoreClarity.value = l.coreClarity;
    u.uEmission.value = l.glow * 2.4;
    u.uOpacity.value = l.opacity * fade * (1 - burn);
    u.uSteps.value = l.steps;
    u.uHeadFade.value = burn * 0.35;
    u.uTailFade.value = l.tailFade;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.parent?.remove(this.mesh);
  }
}
