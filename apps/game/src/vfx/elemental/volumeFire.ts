// Ported from threejs-vfx src/vfx/VolumeHull.js (CONE hull + Medium.FLAME) (MIT, © mohamedachrefelouafi — see ./LICENSE), tuned with
// the dragonbreath ability's `flame*` block (src/config/abilities/dragonbreath.js).
// A gout of flame as a real volume: a hollow cone (the density peak sits off the axis, so it is a sheath with air down the middle and
// the far wall shows through the near one) raymarched in its own frame. The mesh drawn is only a back-faced proxy of that cone, so a
// pixel is shaded once however deep the flame is; every fragment intersects the exact cone analytically and marches inside it.
// Changes from the sandbox: the proxy is built in the vertex shader from a rigid basis (apex + right/up/forward + half-extents), so
// aiming costs a dozen uniform writes and no matrix; the floor is an analytic plane (the game has no depth prepass) with a soft
// contact; the settings tree is a typed `VolumeFireLook`; the medium is FLAME only (no shadow taps, scatter or phase function) and the
// step count and octave count are tier-scaled at runtime (`FIRE_QUALITY`) under a compile-time cap.
import { AddEquation, BackSide, BufferAttribute, BufferGeometry, Color, CustomBlending, Mesh, OneFactor, OneMinusSrcAlphaFactor, ShaderMaterial, Sphere, Vector3 } from 'three';
import { putHex } from './color';
import { sharedUniforms } from './frame';
import { commonGLSL } from './glsl/common';
import { noiseGLSL } from './glsl/noise';

/** Compile-time ceiling on march steps (the loop bound); the runtime step count is `look.steps`. */
const MAX_STEPS = 40;
/** Sides of the cone proxy. It is circumscribed, so the polygon always contains the true circle. */
const PROXY_SIDES = 20;

/** Per quality tier (low, medium, high, ultra): march steps and fbm octaves. Tier 0 never draws the volume; the row is a safe floor. */
export const FIRE_QUALITY: readonly [{ steps: number; octaves: number }, { steps: number; octaves: number }, { steps: number; octaves: number }, { steps: number; octaves: number }] = [
  { steps: 12, octaves: 2 },
  { steps: 20, octaves: 3 },
  { steps: 28, octaves: 4 },
  { steps: 38, octaves: 4 },
];

/** The flame's live look (defaults = the sandbox's `dragonbreath.flame*` / `cone*`). Read on every `sync`. */
export interface VolumeFireLook {
  steps: number;
  octaves: number;
  /** step dither, 0 = none (banding), 1 = full */
  jitter: number;
  /** metres over which the flame fades into the floor */
  contact: number;
  /** headroom inside the proxy: the nominal surface sits this fraction inside it, so the erosion has room to push density out */
  margin: number;
  /** extra proxy headroom past the margin compensation */
  slack: number;
  /** how far off-axis the density peak sits, 0..0.9 */
  hollow: number;
  /** fraction of the length the cone opens over at the apex */
  throat: number;
  /** feather on the mouth */
  feather: number;
  density: number;
  densityCurve: number;
  softness: number;
  /** features per metre */
  noiseFrequency: number;
  noiseStrength: number;
  noiseWarp: number;
  /** metres per second the flow crawls along the axis, outward */
  jet: number;
  /** buoyant rise, metres per second */
  rise: number;
  /** roll about the axis, radians per second */
  swirl: number;
  /** 1 / metre */
  absorption: number;
  emission: number;
  emissionCurve: number;
  /** how deep into the body the noise bites (the sandbox hard-codes 0.22): higher opens billows and tongues in the flame */
  coreErosion: number;
  /** how far the noise mottles the temperature across the body, 0..1 */
  heatNoise: number;
  /** how far the flame has cooled by the mouth, 0..1: white-gold at the throat, body colour mid-way, rim colour at the tip (the sandbox holds one temperature all the way) */
  cooling: number;
  /** how far the wall swells and pinches as it rolls downrange, 0..1: a gout instead of a funnel */
  billow: number;
  opacity: number;
}

export function volumeFireLook(): VolumeFireLook {
  return {
    steps: 28,
    octaves: 4,
    jitter: 1,
    contact: 0.8,
    margin: 0.3,
    slack: 1.06,
    hollow: 0.46,
    throat: 0.16,
    feather: 0.3,
    density: 2.6,
    densityCurve: 1.15,
    softness: 0.34,
    noiseFrequency: 2.2,
    noiseStrength: 1,
    noiseWarp: 0.38,
    jet: 7.5,
    rise: 0.9,
    swirl: 0.6,
    absorption: 0.85,
    emission: 7.5,
    emissionCurve: 1.4,
    coreErosion: 0.22,
    heatNoise: 0,
    cooling: 0,
    billow: 0,
    opacity: 1,
  };
}

const FIRE_VERTEX = /* glsl */ `
  uniform vec3  uApex;
  uniform vec3  uRight;
  uniform vec3  uUp;
  uniform vec3  uFwd;
  uniform vec3  uSize;
  uniform float uCirc;

  varying vec3 vWorld;

  void main() {
    // position = (cos a, sin a, z along the cone 0..1): the apex at z = 0, the mouth ring and its centre at z = 1
    vec3 lp = vec3(position.xy * uSize.xy * (uCirc * position.z), position.z * uSize.z);
    vec3 world = uApex + uRight * lp.x + uUp * lp.y + uFwd * lp.z;
    vWorld = world;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const FIRE_FRAGMENT = /* glsl */ `
  #define MAX_STEPS ${MAX_STEPS}

  uniform float uTime;
  uniform float uGlobalGlow;
  uniform vec3  uApex;
  uniform vec3  uRight;
  uniform vec3  uUp;
  uniform vec3  uFwd;
  uniform vec3  uSize;
  uniform float uGroundY;
  uniform float uSeed;

  uniform float uSteps;
  uniform float uOctaves;
  uniform float uJitter;
  uniform float uContact;
  uniform float uMargin;
  uniform float uHollow;
  uniform float uThroat;
  uniform float uFeather;
  uniform float uDensity;
  uniform float uDensityCurve;
  uniform float uSoftness;
  uniform float uNoiseFrequency;
  uniform float uNoiseStrength;
  uniform float uNoiseWarp;
  uniform float uJet;
  uniform float uRise;
  uniform float uSwirl;
  uniform float uAbsorption;
  uniform float uEmission;
  uniform float uEmissionCurve;
  uniform float uOpacity;
  uniform float uCoreErosion;
  uniform float uHeatNoise;
  uniform float uCooling;
  uniform float uBillow;
  uniform vec3  uColorCore;
  uniform vec3  uColorMid;
  uniform vec3  uColorEdge;
  uniform vec3  uColorDeep;

  varying vec3 vWorld;

  ${noiseGLSL}
  ${commonGLSL}

  /* Trilinear value noise on a hashed lattice: a third of the cost of simplex, and indistinguishable once four octaves of it are
     advected and warped. It is called up to MAX_STEPS times per pixel. */
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

    return mix(
      mix(mix(a, b, f.x), mix(c, d, f.x), f.y),
      mix(mix(e, g, f.x), mix(h, k, f.x), f.y),
      f.z
    );
  }

  /* Rotation between octaves: value noise sits on an axis-aligned lattice and stacking octaves on the same axes lines them up. */
  const mat3 OCTAVE_ROT = mat3(
     0.00,  0.80,  0.60,
    -0.80,  0.36, -0.48,
    -0.60, -0.48,  0.64
  );

  /** Progressively domain-warped fbm, 0..1. */
  float volFbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    float norm = 0.0;
    for (int i = 0; i < 4; i++) {
      if (float(i) >= uOctaves) break;
      float n = vnoise(p);
      v += a * n;
      norm += a;
      p = OCTAVE_ROT * p * 2.13 + (n - 0.5) * uNoiseWarp * vec3(1.7, 0.9, 1.3);
      a *= 0.55;
    }
    return v / max(norm, 1e-4);
  }

  /* Clip an interval against the slab a <= o + d t <= b. */
  bool clipSlab(float o, float d, float a, float b, inout float lo, inout float hi) {
    if (abs(d) < 1e-6) return o >= a && o <= b;
    float ta = (a - o) / d;
    float tb = (b - o) / d;
    if (ta > tb) { float s = ta; ta = tb; tb = s; }
    lo = max(lo, ta);
    hi = min(hi, tb);
    return hi > lo;
  }

  /* Clip an interval against the solid { A t^2 + 2 B t + C <= 0 }. The A < 0 branch is the cone's: clipped to the +Z nappe by the
     slab the solid is convex, so a line meets it in one interval and keeping the longer overlap is exact. */
  bool clipQuadric(float A, float B, float C, inout float lo, inout float hi) {
    if (abs(A) < 1e-7) {
      if (abs(B) < 1e-9) return C <= 0.0;
      float r = -C / (2.0 * B);
      if (B > 0.0) hi = min(hi, r); else lo = max(lo, r);
      return hi > lo;
    }
    float disc = B * B - A * C;
    if (disc < 0.0) return A < 0.0;
    float s = sqrt(disc);
    float r0 = (-B - s) / A;
    float r1 = (-B + s) / A;
    if (r0 > r1) { float t = r0; r0 = r1; r1 = t; }
    if (A > 0.0) {
      lo = max(lo, r0);
      hi = min(hi, r1);
    } else {
      float loA = max(lo, r1), hiA = hi;
      float loB = lo,          hiB = min(hi, r0);
      if (hiA - loA >= hiB - loB) { lo = loA; hi = hiA; }
      else                        { lo = loB; hi = hiB; }
    }
    return hi > lo;
  }

  /* The ray's span inside the cone (apex at the origin, +Z, mouth half-extents uSize.xy at z = uSize.z), in world metres: the basis
     is rigid, so t means the same thing in both frames. */
  bool hullSpan(vec3 ro, vec3 rd, out float t0, out float t1) {
    t0 = 0.0;
    t1 = 1e6;
    if (!clipSlab(ro.z, rd.z, 0.0, uSize.z, t0, t1)) return false;
    vec3 o = ro / uSize;
    vec3 d = rd / uSize;
    if (!clipQuadric(d.x * d.x + d.y * d.y - d.z * d.z,
                     o.x * d.x + o.y * d.y - o.z * d.z,
                     o.x * o.x + o.y * o.y - o.z * o.z, t0, t1)) return false;
    t0 = max(t0, 0.0);
    return t1 > t0;
  }

  /* Hull-relative silhouette: 1 in the shear layer, 0 at the nominal surface, negative beyond it. Local on purpose: the silhouette IS
     the hull, so it must ride with it. */
  float hullShape(vec3 p) {
    float inv = 1.0 / max(1.0 - uMargin, 0.05);
    float zn = clamp(p.z / max(uSize.z, 1e-4) * inv, 0.0, 1.0);
    // normalised by the local radius so r is 0 on the axis and 1 on the wall at every station
    float w = max(zn, 0.02);
    float r = length(vec2(p.x / (uSize.x * w), p.y / (uSize.y * w))) * inv;
    // lobes: the wall swells and pinches as it rolls downrange, so the silhouette is a gout and not a funnel
    vec2 around = p.xy / max(length(p.xy), 1e-3);
    r *= 1.0 - uBillow * (vnoise(vec3(around * 1.3 + uSeed, zn * 3.2 - uTime * 2.4)) - 0.5);
    // hollow: fuel burns at the shear layer, not in the core, and that is what lets the far wall show through the near one
    float core = 1.0 - abs(r - uHollow) / max(1.0 - uHollow, 1e-3);
    return core * smoothstep(0.0, max(uThroat, 1e-3), zn) * (1.0 - smoothstep(1.0 - uFeather, 1.0, zn));
  }

  /* The noise domain rides with the cone: the jet pushes it outward along +Z and the swirl rolls it about the axis. */
  vec3 localDomain(vec3 lp) {
    vec3 p = lp;
    p.z -= uJet * uTime;
    p.xy = rot2(uSwirl * uTime) * p.xy;
    return p * uNoiseFrequency + uSeed;
  }

  float flameDensity(vec3 lp, out float shape, out float detail) {
    shape = hullShape(lp);
    detail = 0.5;
    // conservative reject before the fbm: the erosion can lift the field by at most 3.34 uNoiseStrength
    if (shape < -3.34 * uNoiseStrength) return 0.0;

    vec3 domain = localDomain(lp);
    domain.y -= uRise * uTime * uNoiseFrequency;
    detail = volFbm(domain);
    float n = detail * 2.0 - 1.0;

    // erosion is weak on the axis and violent at the fringe: a solid heart with an edge dissolving into wisps
    float fringe = clamp(1.0 - shape, 0.0, 2.0);
    float field = shape + n * uNoiseStrength * (uCoreErosion + (1.0 - uCoreErosion) * fringe * fringe);

    float d = smoothstep(0.0, max(uSoftness, 0.02), field);
    if (d <= 0.0) return 0.0;
    d = pow(d, max(uDensityCurve, 0.05)) * uDensity;
    // nothing past the nominal mouth: the noise would otherwise fill the whole margin of the proxy with soot
    float zr = lp.z / max(uSize.z * (1.0 - uMargin), 1e-4);
    return d * (1.0 - smoothstep(0.95, 1.12, zr));
  }

  void main() {
    vec3 roW = cameraPosition;
    vec3 rdW = normalize(vWorld - roW);
    vec3 oW = roW - uApex;
    vec3 roL = vec3(dot(oW, uRight), dot(oW, uUp), dot(oW, uFwd));
    vec3 rdL = vec3(dot(rdW, uRight), dot(rdW, uUp), dot(rdW, uFwd));

    float t0, t1;
    if (!hullSpan(roL, rdL, t0, t1)) discard;
    t0 = max(t0, 0.02);

    // The game has no depth prepass: the floor is an analytic plane, and the march fades into it instead of slicing flat.
    float tScene = rdW.y < -1e-4 ? (uGroundY - roW.y) / rdW.y : 1e6;
    t1 = min(t1, tScene);
    if (t1 <= t0) discard;

    float steps = clamp(uSteps, 4.0, float(MAX_STEPS));
    float baseStep = (t1 - t0) / steps;
    // dither the entry point: a fixed start turns the slices into onion rings, a per-pixel offset into grain the bloom eats
    float dither = hash13(vec3(gl_FragCoord.xy, fract(uTime) * 64.0));
    float t = t0 + baseStep * mix(0.5, dither, clamp(uJitter, 0.0, 1.0));

    vec3 acc = vec3(0.0);
    float transmittance = 1.0;
    // coast through empty space at a coarser stride, and drop back to the fine one the moment anything is hit
    float stride = 1.0;

    for (int i = 0; i < MAX_STEPS; i++) {
      if (t >= t1 || transmittance < 0.012) break;

      vec3 lp = roL + rdL * t;
      float shape, detail;
      float d = flameDensity(lp, shape, detail);
      float stepSize = baseStep * stride;

      if (d > 0.002) {
        stride = 1.0;
        stepSize = baseStep;
        d *= clamp((tScene - t) / max(uContact, 1e-3), 0.0, 1.0);

        // temperature from the silhouette (geometry), not from the density field: its level sets are nested loops and a high
        // emission exponent on them renders the flame as polished agate. The fbm only mottles it (heatNoise) and the flame cools
        // toward the mouth (cooling): white-gold at the throat, body colour mid-way, rim colour at the tip.
        float heat = clamp(clamp(shape, 0.0, 1.0) * 1.35 + (detail - 0.5) * uHeatNoise * clamp(shape * 2.0, 0.0, 1.0), 0.0, 1.0);
        heat *= 1.0 - uCooling * clamp(lp.z / max(uSize.z * (1.0 - uMargin), 1e-4), 0.0, 1.0);
        vec3 emit = gradient4(uColorCore, uColorMid, uColorEdge, uColorDeep, pow(1.0 - heat, 0.85));
        vec3 radiance = emit * uEmission * pow(clamp(d, 0.0, 1.0), max(uEmissionCurve, 0.05));

        acc += radiance * d * transmittance * stepSize;
        transmittance *= exp(-d * uAbsorption * stepSize);
      } else {
        stride = min(stride * 1.6, 2.4);
      }

      t += stepSize;
    }

    float alpha = clamp((1.0 - transmittance) * uOpacity, 0.0, 1.0);
    vec3 color = acc * uOpacity * uGlobalGlow;
    if (alpha < 0.002 && max(color.r, max(color.g, color.b)) < 0.002) discard;

    gl_FragColor = vec4(min(color, vec3(64.0)), alpha);
  }
`;

/** The cone proxy: apex, a ring of `PROXY_SIDES` at the mouth, and the mouth's centre; position = (cos a, sin a, z along the cone). */
function createProxyGeometry(): BufferGeometry {
  const ring = PROXY_SIDES;
  const position = new Float32Array((ring + 2) * 3);
  const index = new Uint16Array(ring * 6);
  // 0 = apex (all zero), 1..ring = mouth ring, ring + 1 = mouth centre
  for (let j = 0; j < ring; j++) {
    const a = (j / ring) * Math.PI * 2;
    position[(1 + j) * 3] = Math.cos(a);
    position[(1 + j) * 3 + 1] = Math.sin(a);
    position[(1 + j) * 3 + 2] = 1;
  }
  position[(ring + 1) * 3 + 2] = 1;
  for (let j = 0; j < ring; j++) {
    const a = 1 + j;
    const b = 1 + ((j + 1) % ring);
    index.set([0, b, a, ring + 1, a, b], j * 6);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(position, 3));
  g.setIndex(new BufferAttribute(index, 1));
  g.boundingSphere = new Sphere(new Vector3(), 1e4); // placed in world space by the vertex shader: cull manually
  return g;
}

export class VolumeFire {
  readonly mesh: Mesh;
  readonly look: VolumeFireLook = volumeFireLook();
  /** apex-to-mouth distance of the last `place`, metres */
  span = 1;

  private readonly geometry: BufferGeometry;
  private readonly material: ShaderMaterial;
  private readonly u = {
    ...sharedUniforms({
      uApex: { value: new Vector3() },
      uRight: { value: new Vector3(1, 0, 0) },
      uUp: { value: new Vector3(0, 1, 0) },
      uFwd: { value: new Vector3(0, 0, 1) },
      uSize: { value: new Vector3(1, 1, 1) },
      uCirc: { value: 1 / Math.cos(Math.PI / PROXY_SIDES) },
      uGroundY: { value: 0 },
      uSeed: { value: 0 },
      uSteps: { value: 28 },
      uOctaves: { value: 4 },
      uJitter: { value: 1 },
      uContact: { value: 0.8 },
      uMargin: { value: 0.3 },
      uHollow: { value: 0.46 },
      uThroat: { value: 0.16 },
      uFeather: { value: 0.3 },
      uDensity: { value: 2.6 },
      uDensityCurve: { value: 1.15 },
      uSoftness: { value: 0.34 },
      uNoiseFrequency: { value: 2.2 },
      uNoiseStrength: { value: 1 },
      uNoiseWarp: { value: 0.38 },
      uJet: { value: 7.5 },
      uRise: { value: 0.9 },
      uSwirl: { value: 0.6 },
      uAbsorption: { value: 0.85 },
      uEmission: { value: 7.5 },
      uEmissionCurve: { value: 1.4 },
      uCoreErosion: { value: 0.22 },
      uHeatNoise: { value: 0 },
      uCooling: { value: 0 },
      uBillow: { value: 0 },
      uOpacity: { value: 1 },
      uColorCore: { value: new Color(1, 0.96, 0.82) },
      uColorMid: { value: new Color(1, 0.62, 0.2) },
      uColorEdge: { value: new Color(0.85, 0.16, 0.04) },
      uColorDeep: { value: new Color(0.17, 0.1, 0.08) },
    }),
  };

  constructor(renderOrder = 45) {
    this.geometry = createProxyGeometry();
    this.material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      // the per-sample floor clip inside the march does the occlusion job; testing the proxy's own depth would slice the volume
      depthTest: false,
      // flame both emits and blocks: premultiplied "over", not additive
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      blendSrcAlpha: OneFactor,
      blendDstAlpha: OneMinusSrcAlphaFactor,
      // back faces only: each pixel under the cone is shaded once, and a camera inside it still sees the far wall
      side: BackSide,
      toneMapped: false,
      uniforms: { ...this.u },
      vertexShader: FIRE_VERTEX,
      fragmentShader: FIRE_FRAGMENT,
    });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.visible = false;
  }

  /** Colour ramp as 0xRRGGBB (sRGB): the white-hot shear layer, the body, the cool edge, the soot / haze it fades into. */
  setPalette(core: number, mid: number, edge: number, deep: number): void {
    putHex(this.u.uColorCore.value, core);
    putHex(this.u.uColorMid.value, mid);
    putHex(this.u.uColorEdge.value, edge);
    putHex(this.u.uColorDeep.value, deep);
  }

  /**
   * Pins the cone: apex at (ax, ay, az), axis toward the mouth's centre (mx, my, mz), mouth half-width `halfWidth` and half-height
   * `halfWidth × squash`, floor plane at `groundY`. The basis is rigid (the march carries t in world metres) with local up as close
   * to world up as the pitch allows.
   */
  place(ax: number, ay: number, az: number, mx: number, my: number, mz: number, halfWidth: number, squash: number, groundY: number, seed: number): void {
    const u = this.u;
    const l = this.look;
    let fx = mx - ax;
    let fy = my - ay;
    let fz = mz - az;
    const span = Math.max(0.05, Math.hypot(fx, fy, fz));
    fx /= span;
    fy /= span;
    fz /= span;
    // right = up × forward, flattened to the floor; straight up / down has no heading, so any horizontal axis will do
    let rx = fz;
    let rz = -fx;
    const rl = Math.hypot(rx, rz);
    if (rl < 1e-3) {
      rx = 1;
      rz = 0;
    } else {
      rx /= rl;
      rz /= rl;
    }
    // up = forward × right
    u.uApex.value.set(ax, ay, az);
    u.uRight.value.set(rx, 0, rz);
    u.uUp.value.set(fy * rz, fz * rx - fx * rz, -fy * rx);
    u.uFwd.value.set(fx, fy, fz);
    // the nominal surface sits `margin` of the way inside the proxy, so the proxy is that much bigger for the flame's own reach to equal `span`
    const k = Math.max(1, l.slack) / Math.max(0.2, 1 - l.margin);
    u.uSize.value.set(halfWidth * k, Math.max(0.05, halfWidth * squash) * k, span * k);
    u.uGroundY.value = groundY;
    u.uSeed.value = seed;
    this.span = span;
  }

  /** Pushes the live look into the material; `fade` is the master opacity, 0..1. */
  sync(fade: number): void {
    const l = this.look;
    const u = this.u;
    u.uSteps.value = l.steps;
    u.uOctaves.value = l.octaves;
    u.uJitter.value = l.jitter;
    u.uContact.value = l.contact;
    u.uMargin.value = l.margin;
    u.uHollow.value = l.hollow;
    u.uThroat.value = l.throat;
    u.uFeather.value = l.feather;
    u.uDensity.value = l.density;
    u.uDensityCurve.value = l.densityCurve;
    u.uSoftness.value = l.softness;
    u.uNoiseFrequency.value = l.noiseFrequency;
    u.uNoiseStrength.value = l.noiseStrength;
    u.uNoiseWarp.value = l.noiseWarp;
    u.uJet.value = l.jet;
    u.uRise.value = l.rise;
    u.uSwirl.value = l.swirl;
    u.uAbsorption.value = l.absorption;
    u.uEmission.value = l.emission;
    u.uEmissionCurve.value = l.emissionCurve;
    u.uCoreErosion.value = l.coreErosion;
    u.uHeatNoise.value = l.heatNoise;
    u.uCooling.value = l.cooling;
    u.uBillow.value = l.billow;
    u.uOpacity.value = l.opacity * fade;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.parent?.remove(this.mesh);
  }
}
