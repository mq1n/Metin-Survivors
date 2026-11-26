// Ported from threejs-vfx src/materials/BeamMaterial.js, src/vfx/Tube.js (STRAIGHT path) and the beam strips of
// src/assets/ProceduralGeometry.js (MIT, © mohamedachrefelouafi — see ./LICENSE).
// The Nova Beam column: ONE parametric tube drawn at three radii (halo / sheath / core — rim-weighted outside, axis-weighted inside,
// both faces adding: a volume integral, cheaply), the ribbons that spiral around it (coils), the shock discs racing down it and the
// charge orb at the muzzle. The sandbox draws these as six passes over four geometries; here they are merged into one static
// buffer and one program that picks its role per vertex (`aKind`), so the whole beam is a single draw call. Nothing about the shape
// touches the CPU: every metre is resolved in the vertex shader from the live `BeamLook` uniforms (I1), and the discs' travel and the
// coils' roll are pure functions of the shared clock.
// Changes from the sandbox: the settings tree is a typed `BeamLook`; palette colours are plain hex; the orb is placed by uniforms
// instead of a model matrix; the game has no depth prepass, so the soft fade stays plumbed but inert; strands / discs beyond the
// live counts are collapsed in the vertex stage; reversed-edge smoothsteps (undefined in GLSL) are rewritten as `1 − smoothstep`.
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, DoubleSide, IcosahedronGeometry, Mesh, ShaderMaterial, Sphere, Vector3 } from 'three';
import { putHex } from './color';
import { sharedUniforms } from './frame';
import { commonGLSL } from './glsl/common';
import { noiseGLSL } from './glsl/noise';
import { Easing, saturate } from './math';

/** The roles of the merged mesh (BeamMaterial.js's `BeamPass`; the numbering is the shader's). GROUND is new: the light the column spills on the floor. */
export const BeamKind = { CORE: 0, SHEATH: 1, HALO: 2, COIL: 3, RING: 4, ORB: 5, GROUND: 6 } as const;

/** How finely the merged mesh is cut (one set per quality tier). */
export interface BeamTessellation {
  /** tube rings along the barrel */
  nodes: number;
  /** facets around it */
  sides: number;
  /** nodes along a coil ribbon */
  coilNodes: number;
  /** most coil ribbons the look may ask for */
  coils: number;
  /** most shock discs */
  rings: number;
  /** segments around a disc */
  ringSegments: number;
  /** icosphere detail of the orb */
  orbDetail: number;
}

export const BEAM_TESSELLATION: readonly [BeamTessellation, BeamTessellation, BeamTessellation, BeamTessellation] = [
  { nodes: 40, sides: 12, coilNodes: 56, coils: 2, rings: 4, ringSegments: 24, orbDetail: 2 },
  { nodes: 64, sides: 18, coilNodes: 88, coils: 3, rings: 6, ringSegments: 32, orbDetail: 3 },
  { nodes: 96, sides: 26, coilNodes: 128, coils: 4, rings: 8, ringSegments: 44, orbDetail: 4 },
  { nodes: 112, sides: 30, coilNodes: 144, coils: 6, rings: 10, ringSegments: 48, orbDetail: 4 },
];

/**
 * The beam's live look. Defaults are the sandbox's (`config/abilities/beam.js`), in metres / seconds / turns. Every field is read on
 * every `sync`, so a standing beam re-bores, re-winds and re-opens when one changes.
 */
export interface BeamLook {
  // the column
  /** half-width at the target, metres */
  radius: number;
  /** half-width at the muzzle */
  radiusNear: number;
  /** < 1 opens out early, > 1 stays tight then flares late */
  radiusCurve: number;
  /** extra swell where it lands, × radius, over the last `flareWidth` of the span */
  flare: number;
  flareWidth: number;
  throb: number;
  throbScale: number;
  throbSpeed: number;
  wander: number;
  wanderScale: number;
  wanderSpeed: number;
  // the three tube passes (widths are × the column radius)
  coreWidth: number;
  coreSharp: number;
  coreFill: number;
  coreOpacity: number;
  shellWidth: number;
  shellRim: number;
  shellFill: number;
  shellOpacity: number;
  haloWidth: number;
  haloRim: number;
  haloOpacity: number;
  edgePower: number;
  // the surface
  ripple: number;
  rippleBands: number;
  rippleScale: number;
  rippleSpeed: number;
  streak: number;
  streakSharp: number;
  streakScale: number;
  streakBands: number;
  streakGlow: number;
  flowSpeed: number;
  mouthGlow: number;
  mouthLength: number;
  tipGlow: number;
  tipLength: number;
  softFade: number;
  glow: number;
  opacity: number;
  // coils
  coilTurns: number;
  /** turns per second */
  coilSpeed: number;
  /** × the column radius */
  coilRadius: number;
  coilFlare: number;
  /** half-width at the muzzle, metres */
  coilWidth: number;
  /** that width at the target, × */
  coilWidthTip: number;
  coilSharp: number;
  coilPulse: number;
  coilPulseFreq: number;
  coilPulseSpeed: number;
  coilGlow: number;
  coilOpacity: number;
  // shock discs
  /** trips down the beam per second */
  ringSpeed: number;
  ringInner: number;
  ringOuter: number;
  ringSwell: number;
  ringFade: number;
  ringSharp: number;
  ringGlow: number;
  ringOpacity: number;
  // charge orb
  /** radius once up to power, metres */
  orbSize: number;
  orbThrob: number;
  orbThrobSpeed: number;
  orbTurbulence: number;
  orbScale: number;
  orbFlow: number;
  orbBands: number;
  orbRim: number;
  orbGlow: number;
  orbOpacity: number;
  // the floor light under the column (new): its half-width × the column radius, brightness, how soft it is across, and its gain
  laneWidth: number;
  laneOpacity: number;
  laneSharp: number;
  laneGlow: number;
}

export function beamLook(): BeamLook {
  return {
    radius: 0.77, radiusNear: 0.16, radiusCurve: 1.27, flare: 1.74, flareWidth: 0.09, throb: 0, throbScale: 4.8, throbSpeed: 2.6,
    wander: 0, wanderScale: 0.9, wanderSpeed: 0.7,
    coreWidth: 0.2, coreSharp: 1.55, coreFill: 0.6, coreOpacity: 1, shellWidth: 1, shellRim: 1.15, shellFill: 0.18, shellOpacity: 0.95,
    haloWidth: 2.75, haloRim: 4.3, haloOpacity: 0.14, edgePower: 2.2,
    ripple: 0.2, rippleBands: 2.2, rippleScale: 4.25, rippleSpeed: 2, streak: 1.1, streakSharp: 0.45, streakScale: 4.2, streakBands: 1.8,
    streakGlow: 0.55, flowSpeed: 7, mouthGlow: 1.6, mouthLength: 0.1, tipGlow: 0.6, tipLength: 0.09, softFade: 0.62, glow: 0.74, opacity: 0.29,
    coilTurns: 1.45, coilSpeed: -0.69, coilRadius: 1.88, coilFlare: 0.57, coilWidth: 0.1, coilWidthTip: 1.9, coilSharp: 2.2, coilPulse: 0.65,
    coilPulseFreq: 3, coilPulseSpeed: 1.6, coilGlow: 8, coilOpacity: 2,
    ringSpeed: 1.31, ringInner: 2.42, ringOuter: 2.73, ringSwell: 0.55, ringFade: 0.18, ringSharp: 1.6, ringGlow: 2.4, ringOpacity: 0.7,
    orbSize: 0.39, orbThrob: 0.11, orbThrobSpeed: 6.9, orbTurbulence: 0.24, orbScale: 2.2, orbFlow: 0.9, orbBands: 5, orbRim: 1.8, orbGlow: 2.8, orbOpacity: 1,
    laneWidth: 2.2, laneOpacity: 0.5, laneSharp: 1.6, laneGlow: 1.6,
  };
}

// ------------------------------------------------------------------------------------------------------------------ geometry

/**
 * The merged buffer, in parameter space. Per vertex: `position` = (t along the barrel, a once around, 0) for a tube layer,
 * (t, side ±1, 0) for a coil strip or the floor strip, (band 0 inner / 1 outer, a, 0) for a disc and the unit direction for the
 * orb; `aKind` = the role; `aIdx` = coil / disc index. The seam column of tubes and discs is duplicated so `a` reaches 1.
 */
export function createBeamGeometry(t: BeamTessellation): BufferGeometry {
  const nodes = Math.max(2, Math.round(t.nodes));
  const sides = Math.max(3, Math.round(t.sides));
  const columns = sides + 1;
  const coilNodes = Math.max(2, Math.round(t.coilNodes));
  const coils = Math.max(1, Math.round(t.coils));
  const rings = Math.max(1, Math.round(t.rings));
  const segs = Math.max(6, Math.round(t.ringSegments));
  const ringColumns = segs + 1;
  const orb = new IcosahedronGeometry(1, t.orbDetail);
  const orbPos = orb.getAttribute('position') as BufferAttribute;

  const tubeVerts = nodes * columns;
  const vertCount = 3 * tubeVerts + coils * coilNodes * 2 + rings * 2 * ringColumns + nodes * 2 + orbPos.count;
  const indexCount = 3 * (nodes - 1) * sides * 6 + coils * (coilNodes - 1) * 6 + rings * segs * 6 + (nodes - 1) * 6 + orbPos.count;
  if (vertCount > 65535) throw new Error(`beam geometry needs ${vertCount} vertices (16-bit indices)`);

  const position = new Float32Array(vertCount * 3);
  const kind = new Float32Array(vertCount);
  const idx = new Float32Array(vertCount);
  const index = new Uint16Array(indexCount);
  let v = 0;
  let k = 0;
  const vert = (x: number, y: number, z: number, role: number, n: number): void => {
    position[v * 3] = x;
    position[v * 3 + 1] = y;
    position[v * 3 + 2] = z;
    kind[v] = role;
    idx[v] = n;
    v++;
  };

  // the three tube layers share one lattice
  for (const role of [BeamKind.CORE, BeamKind.SHEATH, BeamKind.HALO]) {
    const base = v;
    for (let i = 0; i < nodes; i++) for (let j = 0; j < columns; j++) vert(i / (nodes - 1), j / sides, 0, role, 0);
    for (let i = 0; i < nodes - 1; i++) {
      for (let j = 0; j < sides; j++) {
        const a = base + i * columns + j;
        const b = a + columns;
        index[k++] = a;
        index[k++] = b;
        index[k++] = a + 1;
        index[k++] = b;
        index[k++] = b + 1;
        index[k++] = a + 1;
      }
    }
  }
  // coil ribbons: a ladder of quads per strand
  for (let s = 0; s < coils; s++) {
    const base = v;
    for (let i = 0; i < coilNodes; i++) {
      const u = i / (coilNodes - 1);
      vert(u, -1, 0, BeamKind.COIL, s);
      vert(u, 1, 0, BeamKind.COIL, s);
    }
    for (let i = 0; i < coilNodes - 1; i++) {
      const a = base + i * 2;
      index[k++] = a;
      index[k++] = a + 1;
      index[k++] = a + 2;
      index[k++] = a + 1;
      index[k++] = a + 3;
      index[k++] = a + 2;
    }
  }
  // shock discs: an annulus per disc
  for (let r = 0; r < rings; r++) {
    const base = v;
    for (let band = 0; band < 2; band++) for (let j = 0; j < ringColumns; j++) vert(band, j / segs, 0, BeamKind.RING, r);
    for (let j = 0; j < segs; j++) {
      const a = base + j;
      const b = a + ringColumns;
      index[k++] = a;
      index[k++] = b;
      index[k++] = a + 1;
      index[k++] = b;
      index[k++] = b + 1;
      index[k++] = a + 1;
    }
  }
  // the strip of light on the floor
  const laneBase = v;
  for (let i = 0; i < nodes; i++) {
    const u = i / (nodes - 1);
    vert(u, -1, 0, BeamKind.GROUND, 0);
    vert(u, 1, 0, BeamKind.GROUND, 0);
  }
  for (let i = 0; i < nodes - 1; i++) {
    const a = laneBase + i * 2;
    index[k++] = a;
    index[k++] = a + 1;
    index[k++] = a + 2;
    index[k++] = a + 1;
    index[k++] = a + 3;
    index[k++] = a + 2;
  }
  // the orb (an icosphere is non-indexed)
  const orbBase = v;
  for (let i = 0; i < orbPos.count; i++) {
    vert(orbPos.getX(i), orbPos.getY(i), orbPos.getZ(i), BeamKind.ORB, 0);
    index[k++] = orbBase + i;
  }
  orb.dispose();

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(position, 3));
  g.setAttribute('aKind', new BufferAttribute(kind, 1));
  g.setAttribute('aIdx', new BufferAttribute(idx, 1));
  g.setIndex(new BufferAttribute(index, 1));
  g.boundingSphere = new Sphere(new Vector3(), 1e4); // placed in world space by the vertex shader: cull manually
  return g;
}

// ------------------------------------------------------------------------------------------------------------------ shaders

const BEAM_UNIFORMS = /* glsl */ `
  #define PI  3.141592653589793
  #define TAU 6.283185307179586

  uniform float uTime;
  uniform vec3  uOrigin;
  uniform vec3  uTarget;
  uniform vec3  uSide;
  uniform float uSeed;
  uniform float uProgress;
  uniform float uFade;
  uniform float uWidthFade;
  uniform float uCharge;
  uniform float uOrbSize;

  uniform float uRadius;
  uniform float uRadiusNear;
  uniform float uRadiusCurve;
  uniform float uFlare;
  uniform float uFlareWidth;
  uniform float uThrob;
  uniform float uThrobScale;
  uniform float uThrobSpeed;
  uniform float uWander;
  uniform float uWanderScale;
  uniform float uWanderSpeed;

  uniform float uRipple;
  uniform float uRippleBands;
  uniform float uRippleScale;
  uniform float uRippleSpeed;

  uniform float uStreak;
  uniform float uStreakSharp;
  uniform float uStreakScale;
  uniform float uStreakBands;
  uniform float uStreakGlow;
  uniform float uFlowSpeed;

  uniform float uCoreSharp;
  uniform float uCoreFill;
  uniform float uEdgePower;
  uniform float uShellRim;
  uniform float uShellFill;
  uniform float uHaloRim;

  uniform float uMouthGlow;
  uniform float uMouthLength;
  uniform float uTipGlow;
  uniform float uTipLength;

  uniform float uCoils;
  uniform float uCoilTurns;
  uniform float uCoilSpeed;
  uniform float uCoilRadius;
  uniform float uCoilFlare;
  uniform float uCoilWidth;
  uniform float uCoilWidthTip;
  uniform float uCoilSharp;
  uniform float uCoilPulse;
  uniform float uCoilPulseFreq;
  uniform float uCoilPulseSpeed;

  uniform float uRingCount;
  uniform float uRingSpeed;
  uniform float uRingInner;
  uniform float uRingOuter;
  uniform float uRingSwell;
  uniform float uRingFade;
  uniform float uRingSharp;

  uniform float uOrbTurbulence;
  uniform float uOrbScale;
  uniform float uOrbFlow;
  uniform float uOrbBands;
  uniform float uOrbRim;

  uniform float uOpacity;
  /* per role (core, sheath, halo, coil, ring, orb, floor light): x = radius scale, y = opacity, z = emissive gain */
  uniform vec3  uPass[7];
  uniform float uLaneWidth;
  uniform float uLaneSharp;
  uniform float uGroundY[12];
  uniform float uSoftFade;
  uniform vec3  uColorCore;
  uniform vec3  uColorInner;
  uniform vec3  uColorOuter;
  uniform vec3  uColorHalo;
  uniform vec3  uColorCoil;
  uniform vec3  uColorCoilEdge;
  uniform vec3  uColorRing;
`;

const BEAM_VARYINGS = /* glsl */ `
  varying float vKind;
  varying float vT;
  varying float vU;
  varying float vFacing;
  varying float vPhase;
  varying float vDisp;
  varying float vViewZ;
  varying vec3  vNrm;
`;

/**
 * The shape of the beam, shared by every role that lives on the column. `beamRadius` and `beamAxis` are the whole geometry: the
 * tube, the coils and the discs all place themselves against these two functions, which is why they stay welded together when the
 * radius or the flare changes. Nothing caches them.
 */
const BEAM_SHAPE = /* glsl */ `
  /** Half-width of the column at t, metres. */
  float beamRadius(float t) {
    float u = clamp(t, 0.0, 1.0);
    float r = mix(uRadiusNear, uRadius, pow(u, max(uRadiusCurve, 0.01)));
    // pressure waves travelling out along it: the beam breathing, not a sausage
    r *= 1.0 + uThrob * sin((u * uThrobScale - uTime * uThrobSpeed) * TAU);
    // ... and the cone opening out where it lands
    r *= 1.0 + uFlare * smoothstep(1.0 - max(uFlareWidth, 1e-3), 1.0, u);
    return max(r * uWidthFade, 1e-4);
  }

  /** The column's local frame. n1 / n2 span the plane across it. */
  void beamFrame(out vec3 dir, out vec3 n1, out vec3 n2) {
    vec3 delta = uTarget - uOrigin;
    float span = max(length(delta), 0.01);
    dir = delta / span;
    // Gram-Schmidt: the axis tilts from the muzzle, so uSide is only approximately perpendicular to it
    vec3 lateral = uSide - dir * dot(uSide, dir);
    vec3 fallback = cross(dir, vec3(0.0, 1.0, 0.0));
    n1 = length(lateral) > 1e-4 ? normalize(lateral) : (length(fallback) > 1e-4 ? normalize(fallback) : vec3(1.0, 0.0, 0.0));
    n2 = normalize(cross(dir, n1));
  }

  /** A point on the column's axis at t: smooth low-frequency drift, pinned at both ends (a beam that kinks is a bolt). */
  vec3 beamAxis(float t, vec3 n1, vec3 n2) {
    vec3 p = mix(uOrigin, uTarget, t);
    if (uWander > 0.0) {
      float ends = sin(clamp(t, 0.0, 1.0) * PI);
      float dx = snoise(vec3(t * uWanderScale, uTime * uWanderSpeed, uSeed));
      float dy = snoise(vec3(t * uWanderScale + 31.7, uTime * uWanderSpeed, uSeed + 7.3));
      p += (n1 * dx + n2 * dy) * uWander * ends;
    }
    return p;
  }

  /** A point on one spiralling ribbon. */
  vec3 coilPoint(float t, float phase, vec3 n1, vec3 n2) {
    float angle = (t * uCoilTurns + uTime * uCoilSpeed + phase) * TAU;
    float r = beamRadius(t) * uCoilRadius * (1.0 + uCoilFlare * pow(clamp(t, 0.0, 1.0), 3.0));
    return beamAxis(t, n1, n2) + (n1 * cos(angle) + n2 * sin(angle)) * r;
  }
`;

const BEAM_VERTEX = /* glsl */ `
  ${BEAM_UNIFORMS}
  ${BEAM_VARYINGS}

  attribute float aKind;
  attribute float aIdx;

  ${noiseGLSL}
  ${BEAM_SHAPE}

  void main() {
    int kind = int(aKind + 0.5);
    vec3 dir, n1, n2;
    beamFrame(dir, n1, n2);

    vec3 here = uOrigin;
    vKind = aKind;
    vT = 0.0;
    vU = 0.0;
    vFacing = 0.0;
    vPhase = 0.0;
    vDisp = 0.0;
    vNrm = vec3(0.0, 1.0, 0.0);

    if (kind <= 2) {                                     /* the column: core / sheath / halo */
      float t = position.x;
      float a = position.y;
      float angle = a * TAU;
      vec3 nrm = n1 * cos(angle) + n2 * sin(angle);

      // Break the barrel up so it is a gas column and not a machined pipe; the noise crawls downrange with the flow.
      float rip = snoise(vec3(cos(angle) * uRippleBands, sin(angle) * uRippleBands, t * uRippleScale - uTime * uRippleSpeed + uSeed));
      float r = beamRadius(t) * uPass[kind].x * (1.0 + uRipple * rip);

      here = beamAxis(t, n1, n2) + nrm * r;
      vT = t;
      vU = a;
      vNrm = nrm;
      // 1 looking down the barrel, 0 at the silhouette: both tube weightings are built out of this one number
      vFacing = abs(dot(normalize(cameraPosition - here), nrm));

    } else if (kind == 3) {                              /* the coils */
      if (aIdx >= uCoils) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
      float t = position.x;
      vU = position.y;
      vT = t;

      float phase = uCoils <= 1.0 ? 0.0 : aIdx / uCoils;
      phase += hash11(aIdx * 5.31 + uSeed) * 0.12;
      here = coilPoint(t, phase, n1, n2);

      // tangent by finite difference, mirrored at the far end so the last node still has a neighbour to look at
      float ahead = t + 0.015;
      float flip = 1.0;
      if (ahead > 1.0) { ahead = t - 0.015; flip = -1.0; }
      vec3 tangent = (coilPoint(ahead, phase, n1, n2) - here) * flip;
      tangent = length(tangent) > 1e-5 ? normalize(tangent) : dir;

      vec3 binormal = cross(tangent, normalize(cameraPosition - here));
      float bl = length(binormal);
      binormal = bl > 1e-4 ? binormal / bl : n1;

      float halfWidth = uCoilWidth * mix(1.0, uCoilWidthTip, clamp(t, 0.0, 1.0));
      // drawn to a point at the muzzle so the ribbons grow out of the orb
      halfWidth *= smoothstep(0.0, 0.05, t) * uWidthFade * uFade;
      here += binormal * position.y * halfWidth;

    } else if (kind == 4) {                              /* the shock discs */
      if (aIdx >= uRingCount) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
      // Evenly spaced along the column and slid downrange by the clock: the train is a pure function of time.
      float phase = fract(aIdx / max(uRingCount, 1.0) + uTime * uRingSpeed + uSeed * 0.37);
      float t = phase;
      float angle = position.y * TAU;
      float r = beamRadius(t) * mix(uRingInner, uRingOuter, position.x) * (1.0 + uRingSwell * phase);

      here = beamAxis(t, n1, n2) + (n1 * cos(angle) + n2 * sin(angle)) * r;
      vT = t;
      vU = position.x;
      vPhase = phase;

    } else if (kind == 6) {                              /* the light the column spills on the floor */
      float t = position.x;
      // the floor under the axis, from the terrain heights sampled at cast time (piecewise linear between 12 stations)
      float f = clamp(t, 0.0, 1.0) * 11.0;
      int i0 = int(min(floor(f), 10.0));
      float gy = mix(uGroundY[i0], uGroundY[i0 + 1], f - float(i0));
      vec3 axis = beamAxis(t, n1, n2);
      vec3 lateral = vec3(uSide.x, 0.0, uSide.z);
      float ll = length(lateral);
      lateral = ll > 1e-4 ? lateral / ll : vec3(1.0, 0.0, 0.0);
      here = vec3(axis.x, gy + 0.07, axis.z) + lateral * (position.y * max(beamRadius(t) * uLaneWidth, 0.22));
      vT = t;
      vU = position.y;

    } else {                                             /* the charge orb */
      if (uOrbSize < 0.002) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
      vec3 np = position * uOrbScale + vec3(uSeed * 3.1) - vec3(0.0, uTime * uOrbFlow, 0.0);
      float n = fbm4(np) * 0.6 + ridged(np * 1.4, 4) * 0.4;
      vDisp = n;
      vec3 nrm = normalize(position);
      here = uOrigin + nrm * (1.0 + n * uOrbTurbulence) * uOrbSize;
      vNrm = nrm;
      vFacing = abs(dot(normalize(cameraPosition - here), nrm));
    }

    vec4 mv = viewMatrix * vec4(here, 1.0);
    vViewZ = mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const BEAM_FRAGMENT = /* glsl */ `
  ${BEAM_UNIFORMS}
  ${BEAM_VARYINGS}

  uniform float uGlobalGlow;
  uniform vec2  uResolution;
  uniform sampler2D uSceneDepth;
  uniform float uCameraNear;
  uniform float uCameraFar;

  ${noiseGLSL}
  ${commonGLSL}

  void main() {
    int kind = int(vKind + 0.5);
    vec3 color = vec3(0.0);
    float alpha = 0.0;

    if (kind == 5) {                                     /* the charge orb */
      float rim = pow(clamp(1.0 - vFacing, 0.0, 1.0), max(uOrbRim, 0.05));
      float heat = clamp(vDisp * 0.5 + 0.5, 0.0, 1.0);
      // Filaments crawling over the surface, thresholded hard: a wide band here fills the orb in and it stops reading as contained energy.
      float fil = smoothstep(0.74, 0.98, ridged(normalize(vNrm) * uOrbBands + vec3(0.0, uTime * uOrbFlow * 2.0, 0.0) + uSeed, 4));

      color = mix(uColorOuter, uColorInner, heat);
      color = mix(color, uColorCore, clamp(fil + rim * 0.35, 0.0, 1.0));
      color += uColorCore * fil * 1.6;
      alpha = (0.2 + rim * 0.9 + fil * 0.75) * uCharge;

    } else {
      // Ahead of the leading edge there is no beam yet. The column is built whole and clipped here rather than scaled, so its
      // shape never changes as the front travels — only how much of it exists.
      float tip = max(uTipLength, 1e-3);
      float drawn = 1.0 - smoothstep(uProgress - tip, uProgress, vT);
      if (drawn <= 0.002) discard;

      if (kind <= 2) {                                   /* the column */
        float facing = clamp(vFacing, 0.0, 1.0);
        float axisward = pow(facing, max(uCoreSharp, 0.05));
        float rim = pow(1.0 - facing, max(uEdgePower, 0.05));

        float streak = 0.0;
        if (kind <= 1) {
          // Filaments streaming downrange, stretched hard along the axis: gas pushed through a barrel, not a bolt looking for ground.
          float angle = vU * TAU;
          float flow = ridged(vec3(vT * uStreakScale - uTime * uFlowSpeed, cos(angle) * uStreakBands, sin(angle) * uStreakBands + uSeed), 4);
          streak = smoothstep(mix(0.42, 0.86, clamp(uStreakSharp, 0.0, 1.0)), 0.99, flow) * uStreak;
        }

        if (kind == 0) {                                 /* CORE: the white-hot rod */
          color = mix(uColorInner, uColorCore, clamp(0.35 + streak, 0.0, 1.0));
          alpha = uCoreFill * mix(0.28, 1.0, axisward) + streak * 0.35;
        } else if (kind == 1) {                          /* SHEATH: hollow, rim-weighted */
          color = mix(uColorOuter, uColorInner, clamp(rim * 0.55 + streak, 0.0, 1.0));
          color += uColorCore * streak * uStreakGlow;
          alpha = rim * uShellRim + uShellFill * mix(0.12, 1.0, axisward) + streak * 0.4;
        } else {                                         /* HALO: the atmosphere it is pushing */
          float wide = pow(1.0 - facing, max(uHaloRim, 0.05));
          color = mix(uColorHalo, uColorOuter, wide);
          alpha = wide;
        }

        // the mouth, where the column is still being fed out of the orb
        float mouth = 1.0 - smoothstep(0.0, max(uMouthLength, 1e-3), vT);
        color += uColorCore * mouth * uMouthGlow;
        alpha += mouth * uMouthGlow * 0.2;

        // the leading edge while it travels — and, once it has landed, the white-hot end where it is still burning into the floor
        float lead = smoothstep(uProgress - tip * 2.0, uProgress, vT);
        color += uColorCore * lead * uTipGlow;
        alpha += lead * uTipGlow * 0.18;

      } else if (kind == 3) {                            /* the coils */
        float v = clamp(abs(vU), 0.0, 1.0);
        float profile = pow(1.0 - v, max(uCoilSharp, 0.05));
        // a charge running out along the ribbon, which is what stops the coils reading as static piping wrapped around the beam
        float pulse = 0.5 + 0.5 * sin((vT * uCoilPulseFreq - uTime * uCoilPulseSpeed) * TAU);
        color = mix(uColorCoilEdge, uColorCoil, profile);
        color += uColorCore * pulse * profile * uCoilPulse;
        alpha = profile * mix(1.0 - clamp(uCoilPulse, 0.0, 0.9) * 0.5, 1.0, pulse);

      } else if (kind == 4) {                            /* the shock discs */
        float band = 1.0 - abs(vU * 2.0 - 1.0);
        float profile = pow(clamp(band, 0.0, 1.0), max(uRingSharp, 0.05));
        // discs thin out as they run downrange and the pressure behind them drops off
        color = mix(uColorRing, uColorCore, profile);
        alpha = profile * mix(1.0, uRingFade, vPhase);

      } else {                                           /* the floor light */
        float v = clamp(abs(vU), 0.0, 1.0);
        float across = pow(1.0 - v, max(uLaneSharp, 0.05));
        // flowing, so the light on the floor breathes with the column instead of lying there like a decal
        float flow = snoise(vec3(vT * 5.0 - uTime * 3.0, vU * 1.7, uSeed)) * 0.5 + 0.5;
        color = mix(uColorHalo, uColorOuter, across);
        alpha = across * (0.7 + 0.5 * flow) * smoothstep(0.0, 0.06, vT);
      }

      alpha *= drawn;
    }

    vec3 pass = uPass[kind];
    alpha *= uFade * uOpacity * pass.y;
    if (alpha < 0.003) discard;

    vec2 screenUV = gl_FragCoord.xy / uResolution;
    alpha *= softFade(uSceneDepth, screenUV, vViewZ, uCameraNear, uCameraFar, uSoftFade);
    if (alpha < 0.003) discard;

    color *= pass.z * uGlobalGlow;
    gl_FragColor = vec4(clamp(color, 0.0, 64.0), clamp(alpha, 0.0, 1.0));
  }
`;

// ------------------------------------------------------------------------------------------------------------------ the beam

/** Per-role triples written to `uPass` (radius scale, opacity, glow) are rebuilt from the look on every sync. */
const PASS_COUNT = 7;

export class BeamTube {
  readonly mesh: Mesh;
  readonly look: BeamLook = beamLook();
  /** muzzle and impact point (world), and the reference vector the column's frame is built across */
  readonly origin = new Vector3();
  readonly target = new Vector3(0, 0, 1);
  readonly side = new Vector3(1, 0, 0);
  /** leading edge, 0..1 of the span */
  progress = 0;
  /** brightness while it dies, 1 → 0 */
  fade = 1;
  /** the column pinches faster than it dims: 1 → ~0 */
  widthFade = 1;
  /** how far the orb has wound up, 0..1 */
  charge = 0;
  seed = 0;
  /** live strand / disc counts (clamped to what the tessellation carries) */
  coils = 4;
  rings = 8;
  /** gain on every pass (the preset's `intensity`) */
  gain = 1;
  readonly maxCoils: number;
  readonly maxRings: number;
  /** terrain height under the axis at 12 stations along the span (the floor light follows it) */
  readonly ground = new Float32Array(12);

  private readonly geometry: BufferGeometry;
  private readonly material: ShaderMaterial;
  private readonly pass: Vector3[] = [];
  private readonly u;

  constructor(tess: BeamTessellation, renderOrder = 45) {
    this.maxCoils = tess.coils;
    this.maxRings = tess.rings;
    this.geometry = createBeamGeometry(tess);
    for (let i = 0; i < PASS_COUNT; i++) this.pass.push(new Vector3(1, 1, 1));
    this.u = sharedUniforms({
      uOrigin: { value: this.origin },
      uTarget: { value: this.target },
      uSide: { value: this.side },
      uSeed: { value: 0 },
      uProgress: { value: 0 },
      uFade: { value: 1 },
      uWidthFade: { value: 1 },
      uCharge: { value: 0 },
      uOrbSize: { value: 0 },

      uRadius: { value: 0.77 },
      uRadiusNear: { value: 0.16 },
      uRadiusCurve: { value: 1.27 },
      uFlare: { value: 1.74 },
      uFlareWidth: { value: 0.09 },
      uThrob: { value: 0 },
      uThrobScale: { value: 4.8 },
      uThrobSpeed: { value: 2.6 },
      uWander: { value: 0 },
      uWanderScale: { value: 0.9 },
      uWanderSpeed: { value: 0.7 },

      uRipple: { value: 0.2 },
      uRippleBands: { value: 2.2 },
      uRippleScale: { value: 4.25 },
      uRippleSpeed: { value: 2 },

      uStreak: { value: 1.1 },
      uStreakSharp: { value: 0.45 },
      uStreakScale: { value: 4.2 },
      uStreakBands: { value: 1.8 },
      uStreakGlow: { value: 0.55 },
      uFlowSpeed: { value: 7 },

      uCoreSharp: { value: 1.55 },
      uCoreFill: { value: 0.6 },
      uEdgePower: { value: 2.2 },
      uShellRim: { value: 1.15 },
      uShellFill: { value: 0.18 },
      uHaloRim: { value: 4.3 },

      uMouthGlow: { value: 1.6 },
      uMouthLength: { value: 0.1 },
      uTipGlow: { value: 0.6 },
      uTipLength: { value: 0.09 },

      uCoils: { value: 4 },
      uCoilTurns: { value: 1.45 },
      uCoilSpeed: { value: -0.69 },
      uCoilRadius: { value: 1.88 },
      uCoilFlare: { value: 0.57 },
      uCoilWidth: { value: 0.1 },
      uCoilWidthTip: { value: 1.9 },
      uCoilSharp: { value: 2.2 },
      uCoilPulse: { value: 0.65 },
      uCoilPulseFreq: { value: 3 },
      uCoilPulseSpeed: { value: 1.6 },

      uRingCount: { value: 8 },
      uRingSpeed: { value: 1.31 },
      uRingInner: { value: 2.42 },
      uRingOuter: { value: 2.73 },
      uRingSwell: { value: 0.55 },
      uRingFade: { value: 0.18 },
      uRingSharp: { value: 1.6 },

      uOrbTurbulence: { value: 0.24 },
      uOrbScale: { value: 2.2 },
      uOrbFlow: { value: 0.9 },
      uOrbBands: { value: 5 },
      uOrbRim: { value: 1.8 },

      uLaneWidth: { value: 2.2 },
      uLaneSharp: { value: 1.6 },
      uGroundY: { value: this.ground },
      uOpacity: { value: 0.29 },
      uPass: { value: this.pass },
      uSoftFade: { value: 0.62 },
      uColorCore: { value: new Color(1, 1, 1) },
      uColorInner: { value: new Color(0.82, 0.96, 1) },
      uColorOuter: { value: new Color(0.24, 0.78, 1) },
      uColorHalo: { value: new Color(0.05, 0.2, 0.85) },
      uColorCoil: { value: new Color(1, 0.86, 0.5) },
      uColorCoilEdge: { value: new Color(1, 0.45, 0.12) },
      uColorRing: { value: new Color(0.6, 0.94, 1) },
    });
    this.material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: AdditiveBlending,
      side: DoubleSide,
      toneMapped: false,
      uniforms: { ...this.u },
      vertexShader: BEAM_VERTEX,
      fragmentShader: BEAM_FRAGMENT,
    });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.visible = false;
  }

  /** Column colours as 0xRRGGBB (sRGB): the axis, just off the axis, the sheath body, the wide bloom, coil body / edge, disc rim. */
  setColors(core: number, inner: number, outer: number, halo: number, coil: number, coilEdge: number, ring: number): void {
    const u = this.u;
    putHex(u.uColorCore.value, core);
    putHex(u.uColorInner.value, inner);
    putHex(u.uColorOuter.value, outer);
    putHex(u.uColorHalo.value, halo);
    putHex(u.uColorCoil.value, coil);
    putHex(u.uColorCoilEdge.value, coilEdge);
    putHex(u.uColorRing.value, ring);
  }

  /** Samples the floor height at 12 stations from the muzzle to the impact (call once per cast; the terrain does not move). */
  sampleGround(heightAt: (x: number, z: number) => number): void {
    const o = this.origin;
    const t = this.target;
    for (let i = 0; i < 12; i++) {
      const s = i / 11;
      this.ground[i] = heightAt(o.x + (t.x - o.x) * s, o.z + (t.z - o.z) * s);
    }
  }

  /** Mean axis point `s` of the way from the muzzle to the impact (the wander noise is left out on purpose). */
  axisPoint(s: number, out: Vector3): Vector3 {
    return out.lerpVectors(this.origin, this.target, saturate(s));
  }

  /** Half-width of the sheath at `s`, metres (mirror of `beamRadius`, minus the throb). */
  radiusAt(s: number): number {
    const l = this.look;
    const t = saturate(s);
    const r = l.radiusNear + (l.radius - l.radiusNear) * Math.pow(t, Math.max(0.01, l.radiusCurve));
    const f = saturate((t - (1 - Math.max(1e-3, l.flareWidth))) / Math.max(1e-3, l.flareWidth));
    return r * (1 + l.flare * f * f * (3 - 2 * f)) * this.widthFade;
  }

  /** Radius of the orb right now, metres: it swells as the charge winds up, throbs, and pinches with the column. */
  orbRadius(age: number): number {
    const l = this.look;
    const swell = 1 + l.orbThrob * Math.sin(age * l.orbThrobSpeed * Math.PI * 2);
    return l.orbSize * (0.28 + 0.72 * Easing.outCubic(saturate(this.charge))) * swell * this.widthFade;
  }

  /** Pushes the live look and the cast state into the material. `orbSize` = `orbRadius(age)`. */
  sync(orbSize: number): void {
    const l = this.look;
    const u = this.u;
    const g = this.gain;
    this.coils = Math.max(1, Math.min(this.maxCoils, Math.round(this.coils)));
    this.rings = Math.max(1, Math.min(this.maxRings, Math.round(this.rings)));

    u.uSeed.value = this.seed;
    u.uProgress.value = this.progress;
    u.uFade.value = this.fade;
    u.uWidthFade.value = this.widthFade;
    u.uCharge.value = this.charge;
    u.uOrbSize.value = orbSize;

    u.uRadius.value = l.radius;
    u.uRadiusNear.value = l.radiusNear;
    u.uRadiusCurve.value = l.radiusCurve;
    u.uFlare.value = l.flare;
    u.uFlareWidth.value = l.flareWidth;
    u.uThrob.value = l.throb;
    u.uThrobScale.value = l.throbScale;
    u.uThrobSpeed.value = l.throbSpeed;
    u.uWander.value = l.wander;
    u.uWanderScale.value = l.wanderScale;
    u.uWanderSpeed.value = l.wanderSpeed;

    u.uRipple.value = l.ripple;
    u.uRippleBands.value = l.rippleBands;
    u.uRippleScale.value = l.rippleScale;
    u.uRippleSpeed.value = l.rippleSpeed;

    u.uStreak.value = l.streak;
    u.uStreakSharp.value = l.streakSharp;
    u.uStreakScale.value = l.streakScale;
    u.uStreakBands.value = l.streakBands;
    u.uStreakGlow.value = l.streakGlow;
    u.uFlowSpeed.value = l.flowSpeed;

    u.uCoreSharp.value = l.coreSharp;
    u.uCoreFill.value = l.coreFill;
    u.uEdgePower.value = l.edgePower;
    u.uShellRim.value = l.shellRim;
    u.uShellFill.value = l.shellFill;
    u.uHaloRim.value = l.haloRim;

    u.uMouthGlow.value = l.mouthGlow;
    u.uMouthLength.value = l.mouthLength;
    u.uTipGlow.value = l.tipGlow;
    u.uTipLength.value = l.tipLength;

    u.uCoils.value = this.coils;
    u.uCoilTurns.value = l.coilTurns;
    u.uCoilSpeed.value = l.coilSpeed;
    u.uCoilRadius.value = l.coilRadius;
    u.uCoilFlare.value = l.coilFlare;
    u.uCoilWidth.value = l.coilWidth;
    u.uCoilWidthTip.value = l.coilWidthTip;
    u.uCoilSharp.value = l.coilSharp;
    u.uCoilPulse.value = l.coilPulse;
    u.uCoilPulseFreq.value = l.coilPulseFreq;
    u.uCoilPulseSpeed.value = l.coilPulseSpeed;

    u.uRingCount.value = this.rings;
    u.uRingSpeed.value = l.ringSpeed;
    u.uRingInner.value = l.ringInner;
    u.uRingOuter.value = l.ringOuter;
    u.uRingSwell.value = l.ringSwell;
    u.uRingFade.value = l.ringFade;
    u.uRingSharp.value = l.ringSharp;

    u.uOrbTurbulence.value = l.orbTurbulence;
    u.uOrbScale.value = l.orbScale;
    u.uOrbFlow.value = l.orbFlow;
    u.uOrbBands.value = l.orbBands;
    u.uOrbRim.value = l.orbRim;

    u.uSoftFade.value = l.softFade;
    u.uLaneWidth.value = l.laneWidth;
    u.uLaneSharp.value = l.laneSharp;
    // the three radii of the column, and how hard each role is drawn
    const pass = this.pass;
    (pass[BeamKind.CORE] as Vector3).set(l.coreWidth, l.coreOpacity, l.glow * g);
    (pass[BeamKind.SHEATH] as Vector3).set(l.shellWidth, l.shellOpacity, l.glow * g);
    (pass[BeamKind.HALO] as Vector3).set(l.haloWidth, l.haloOpacity, l.glow * 0.8 * g);
    (pass[BeamKind.COIL] as Vector3).set(1, l.coilOpacity, l.coilGlow * g);
    (pass[BeamKind.RING] as Vector3).set(1, l.ringOpacity, l.ringGlow * g);
    (pass[BeamKind.ORB] as Vector3).set(1, l.orbOpacity, l.orbGlow * g);
    (pass[BeamKind.GROUND] as Vector3).set(1, l.laneOpacity, l.laneGlow * g);
    u.uOpacity.value = l.opacity;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.parent?.remove(this.mesh);
  }
}
