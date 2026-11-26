// Ported from threejs-vfx src/materials/FrostFieldMaterial.js (MIT, © mohamedachrefelouafi — see ./LICENSE).
// The ground under a frost cast, frozen into the floor: one draped grid, one draw call. The sandbox's sheet is a disc built from the
// three things that read as frozen ground — plates (rime piled in the seams where two meet, a tone per plate), frost fingers
// (domain-warped ridged noise sampled in the plane, never on the angle, which would draw spokes) and an advancing front that stays
// lit while it travels. Here the footprint is a signed distance to a tapered lane plus a disc at its far end, so the same sheet
// serves a fracture line (`frost.lance`) and a radial nova (lane length 0). The freeze front and the thaw are geodesic distances
// from the origin (down the lane, then out across it): the lance freezes outward behind its own front and sublimates from the
// caster's end, the nova freezes outward and thaws from the middle. The seams are true voronoi edges (F2 − F1), which is what the
// cracks in the ice are. The grid is draped over the terrain once per cast, and the blend is premultiplied: the packed snow
// occludes the floor (alpha) while the seams, the rim band and the lip add light on top in the same draw.
import { BufferAttribute, BufferGeometry, Color, DoubleSide, Mesh, NormalBlending, ShaderMaterial, Sphere, Vector3 } from 'three';
import { putHex } from './color';
import { sharedUniforms } from './frame';
import { noiseGLSL } from './glsl/noise';
import type { FloorAt } from './shatterField';

/** Shading controls (defaults = the sandbox's `glacier.field*` block, re-balanced for a premultiplied sheet). Read on every `sync`. */
export interface FrostFieldLook {
  /** metres: thickness of the band that is the edge, and its light */
  boundary: number;
  boundaryGlow: number;
  /** packed-snow cover inside the footprint, and how hard it crowds to the rim */
  fill: number;
  falloff: number;
  /** plates per metre, the tonal break-up between them, the light in their seams and the seam width (cell units) */
  plateScale: number;
  plates: number;
  seam: number;
  seamWidth: number;
  /** frost fingers crawling over the sheet: strength, per metre, domain warp (what stops them reading as spokes), writhe speed */
  fingers: number;
  fingerScale: number;
  warp: number;
  crawl: number;
  /** metres the rim is pushed in and out by noise: frost reaches, it does not stop on a line */
  ragged: number;
  /** metres of softness on the freeze and thaw fronts */
  soft: number;
  /** brightness of the advancing lip */
  lipGlow: number;
  /** brightness breathing */
  pulse: number;
  pulseSpeed: number;
  opacity: number;
}

export function frostFieldLook(): FrostFieldLook {
  return {
    boundary: 0.35, boundaryGlow: 0.35, fill: 0.24, falloff: 1.4, plateScale: 1.1, plates: 1, seam: 0.9, seamWidth: 0.055, fingers: 0.9,
    fingerScale: 1.6, warp: 0.5, crawl: 0.12, ragged: 0.6, soft: 0.45, lipGlow: 1.4, pulse: 0.18, pulseSpeed: 1.6, opacity: 1,
  };
}

/** The footprint, metres: a lane from the origin along the cast direction, tapering `widthNear` → `widthFar`, plus a disc at its end. */
export interface FrostFieldShape {
  length: number;
  widthNear: number;
  widthFar: number;
  /** < 1 flares early */
  widthCurve: number;
  endRadius: number;
}

type FieldColorUniform = 'uColorField' | 'uColorEdge' | 'uColorSnow' | 'uColorShade';
type FieldFloatUniform =
  | 'uLength' | 'uWidthNear' | 'uWidthFar' | 'uWidthCurve' | 'uEndRadius' | 'uFront' | 'uThaw' | 'uLip' | 'uFade' | 'uSeed'
  | 'uBoundary' | 'uBoundaryGlow' | 'uFill' | 'uFalloff' | 'uPlateScale' | 'uPlates' | 'uSeam' | 'uSeamWidth' | 'uFingers'
  | 'uFingerScale' | 'uWarp' | 'uCrawl' | 'uRagged' | 'uSoft' | 'uLipGlow' | 'uPulse' | 'uPulseSpeed' | 'uOpacity';
/** Uniform boxes of one sheet (the frame clock and key light are shared by identity on top of these). */
export type FrostFieldUniforms = Record<FieldColorUniform, { value: Color }> & Record<FieldFloatUniform, { value: number }>;

function makeUniforms(): FrostFieldUniforms {
  return {
    uColorField: { value: new Color(0.66, 0.9, 1) },
    uColorEdge: { value: new Color(1, 1, 1) },
    uColorSnow: { value: new Color(0.94, 0.98, 1) },
    uColorShade: { value: new Color(0.47, 0.71, 0.87) },
    uLength: { value: 0 },
    uWidthNear: { value: 0 },
    uWidthFar: { value: 0 },
    uWidthCurve: { value: 1 },
    uEndRadius: { value: 4 },
    uFront: { value: 0 },
    uThaw: { value: -1 },
    uLip: { value: 0 },
    uFade: { value: 1 },
    uSeed: { value: 0 },
    uBoundary: { value: 0.4 },
    uBoundaryGlow: { value: 1.6 },
    uFill: { value: 0.34 },
    uFalloff: { value: 1.4 },
    uPlateScale: { value: 1.1 },
    uPlates: { value: 1 },
    uSeam: { value: 1.1 },
    uSeamWidth: { value: 0.07 },
    uFingers: { value: 0.9 },
    uFingerScale: { value: 1.6 },
    uWarp: { value: 0.5 },
    uCrawl: { value: 0.12 },
    uRagged: { value: 0.6 },
    uSoft: { value: 0.45 },
    uLipGlow: { value: 1.6 },
    uPulse: { value: 0.18 },
    uPulseSpeed: { value: 1.6 },
    uOpacity: { value: 1 },
  };
}

const FIELD_VERTEX = /* glsl */ `
  varying vec2 vP;
  void main() {
    vP = uv;
    gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
  }
`;

const FIELD_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform vec3  uLightDir;
  uniform float uGlobalGlow;

  uniform vec3  uColorField;
  uniform vec3  uColorEdge;
  uniform vec3  uColorSnow;
  uniform vec3  uColorShade;
  uniform float uLength;
  uniform float uWidthNear;
  uniform float uWidthFar;
  uniform float uWidthCurve;
  uniform float uEndRadius;
  uniform float uFront;
  uniform float uThaw;
  uniform float uLip;
  uniform float uFade;
  uniform float uSeed;
  uniform float uBoundary;
  uniform float uBoundaryGlow;
  uniform float uFill;
  uniform float uFalloff;
  uniform float uPlateScale;
  uniform float uPlates;
  uniform float uSeam;
  uniform float uSeamWidth;
  uniform float uFingers;
  uniform float uFingerScale;
  uniform float uWarp;
  uniform float uCrawl;
  uniform float uRagged;
  uniform float uSoft;
  uniform float uLipGlow;
  uniform float uPulse;
  uniform float uPulseSpeed;
  uniform float uOpacity;

  varying vec2 vP;

  ${noiseGLSL}

  #define TAU 6.28318530718

  float pw(float x, float e) { return pow(max(x, 0.0), e); }

  /** Plates: x = distance to the nearest site, y = F2 − F1 (how far to the seam between two plates), z = the plate's id. */
  vec3 plates(vec2 p) {
    vec2 n = floor(p);
    vec2 f = fract(p);
    float d1 = 8.0;
    float d2 = 8.0;
    float id = 0.0;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 g = vec2(float(i), float(j));
        vec2 r = g + hash21(dot(n + g, vec2(7.13, 113.17))) - f;
        float d = dot(r, r);
        if (d < d1) {
          d2 = d1;
          d1 = d;
          id = hash11(dot(n + g, vec2(31.7, 57.1)));
        } else if (d < d2) {
          d2 = d;
        }
      }
    }
    d1 = sqrt(d1);
    return vec3(d1, sqrt(d2) - d1, id);
  }

  void main() {
    /* ---- the footprint: a tapered lane from the origin plus a disc at its end, as a signed distance ---- */
    vec2 p = vP;
    float L = uLength;
    float t = L > 1e-3 ? clamp(p.x / L, 0.0, 1.0) : 0.0;
    vec2 onAxis = vec2(t * L, 0.0);
    float hw = mix(uWidthNear, uWidthFar, pw(t, uWidthCurve));
    vec2 toEnd = p - vec2(L, 0.0);
    float d = min(length(p - onAxis) - hw, length(toEnd) - uEndRadius);
    d += fbm3(vec3(p * 0.45, uSeed * 3.0)) * uRagged;
    if (d > uBoundary) discard;

    /* ---- how far the ice has got: geodesic distance from the origin, down the lane and then out across it ---- */
    float g = min(t * L + length(p - onAxis), L + length(toEnd));
    g += fbm3(vec3(p * 0.8, uSeed * 5.0 + 2.0)) * uSoft * 1.6;
    float frozen = smoothstep(uFront, uFront - uSoft, g);
    float kept = smoothstep(uThaw - uSoft, uThaw + uSoft, g);
    float live = frozen * kept * uFade;
    if (live < 0.004) discard;

    float scaleR = max(max(uWidthFar, uEndRadius), 0.5);
    float inside = smoothstep(uBoundary * 0.5, -uBoundary * 0.5, d);
    float depth = clamp(-d / scaleR, 0.0, 1.0);
    float band = 1.0 - smoothstep(0.0, uBoundary * 0.5, abs(d + uBoundary * 0.2));

    /* ---- frost fingers crawling over it ---- */
    float warp = fbm3(vec3(p * 0.5, uTime * 0.12 + uSeed)) * uWarp;
    float fil = ridged(vec3(p * uFingerScale + warp, uSeed * 11.0 + uTime * uCrawl), 4);
    float frost = smoothstep(0.66, 0.95, fil) * uFingers;

    /* ---- plates, and the cracks between them (warped, so the network is ice and not a honeycomb) ---- */
    vec3 pl = plates(p * uPlateScale + uSeed * 20.0 + vec2(warp, -warp) * 0.9);
    float seam = 1.0 - smoothstep(0.0, uSeamWidth, pl.y);
    float plate = mix(1.0 - uPlates * 0.45, 1.0, pl.z);

    /* ---- packed snow on the plates, each tipped a little so the sheet catches the key light in facets, not as a wash ---- */
    vec2 tipv = (hash21(pl.z * 91.7) - 0.5) * 0.7;
    float lambert = clamp(dot(normalize(vec3(tipv.x, 1.0, tipv.y)), normalize(uLightDir)), 0.0, 1.0);
    vec3 snow = mix(uColorShade, uColorSnow, 0.3 + 0.7 * lambert) * plate;

    // thickest along the rim, in the seams and on the fingers, a thin glaze in the middle — what stands on it stays readable
    float cover = inside * (uFill * (0.25 + 0.75 * pw(1.0 - depth, uFalloff)) + frost * 0.35 + seam * 0.45) + band * 0.12;
    float a = clamp(cover, 0.0, 1.0) * live * uOpacity;

    // light: the seams (brightest just behind the front, where the floor is still cracking), the rim, the fingers, the lip
    float breathe = 1.0 + uPulse * sin(uTime * uPulseSpeed * TAU);
    float lip = (1.0 - smoothstep(0.0, uSoft * 1.5, abs(g - uFront))) * uLip;
    float fresh = (1.0 - smoothstep(0.0, 2.5, uFront - g)) * uLip;
    vec3 glow = uColorEdge * (band * uBoundaryGlow + seam * inside * uSeam * (1.0 + 2.5 * fresh) + lip * uLipGlow) * breathe;
    glow += uColorField * frost * 0.4 * inside;
    glow *= live * uOpacity * uGlobalGlow;

    // premultiplied: the snow occludes the floor by its alpha, the light adds on top
    gl_FragColor = vec4(snow * a + glow, a);
  }
`;

export class FrostField {
  readonly mesh: Mesh;
  readonly look: FrostFieldLook = frostFieldLook();
  readonly shape: FrostFieldShape = { length: 0, widthNear: 0, widthFar: 0, widthCurve: 1, endRadius: 4 };
  readonly u: FrostFieldUniforms;
  private readonly material: ShaderMaterial;
  private readonly geometry = new BufferGeometry();
  private readonly pos: Float32Array;
  private readonly uv: Float32Array;
  private readonly segments: number;

  /** @param segments grid cells per side (the drape's resolution over the terrain) */
  constructor(segments = 28, renderOrder = 41) {
    const n = Math.max(2, Math.round(segments));
    this.segments = n;
    const verts = (n + 1) * (n + 1);
    this.pos = new Float32Array(verts * 3);
    this.uv = new Float32Array(verts * 2);
    const index = new Uint16Array(n * n * 6);
    let k = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = j * (n + 1) + i;
        const b = a + 1;
        const c = a + n + 1;
        const d = c + 1;
        index[k++] = a;
        index[k++] = c;
        index[k++] = b;
        index[k++] = b;
        index[k++] = c;
        index[k++] = d;
      }
    }
    this.geometry.setIndex(new BufferAttribute(index, 1));
    this.geometry.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geometry.setAttribute('uv', new BufferAttribute(this.uv, 2));
    // placed in world space per cast
    this.geometry.boundingSphere = new Sphere(new Vector3(), 1e4);

    const u = makeUniforms();
    this.u = u;
    this.material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: NormalBlending,
      premultipliedAlpha: true,
      side: DoubleSide,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      uniforms: { ...sharedUniforms(u) },
      vertexShader: FIELD_VERTEX,
      fragmentShader: FIELD_FRAGMENT,
    });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = renderOrder;
  }

  /** 0xRRGGBB: the frost tint of the fingers, the light in the seams / rim / lip, snow in the key light and snow in its own shade. */
  setColors(field: number, edge: number, snow: number, shade: number): void {
    putHex(this.u.uColorField.value, field);
    putHex(this.u.uColorEdge.value, edge);
    putHex(this.u.uColorSnow.value, snow);
    putHex(this.u.uColorShade.value, shade);
  }

  /** metres the freeze front has to travel to cover the whole footprint */
  get reach(): number {
    const s = this.shape;
    return s.length + Math.max(s.endRadius, s.widthFar) + this.look.ragged + this.look.soft;
  }

  /**
   * Drapes the sheet over the floor for a cast at (x, z) along the unit direction (dx, dz), sized by `shape` (fill it first).
   * Writes the grid in place: no allocation.
   */
  lay(x: number, z: number, dx: number, dz: number, seed: number, floorAt: FloorAt): void {
    const s = this.shape;
    const n = this.segments;
    const pad = this.look.boundary + this.look.ragged + 0.2;
    const half = Math.max(s.widthNear, s.widthFar, s.endRadius) + pad;
    const u0 = -Math.max(s.widthNear, s.length > 1e-3 ? 0 : s.endRadius) - pad;
    const u1 = s.length + s.endRadius + pad;
    // side = up × direction's lateral (-dz, dx); the sheet is symmetric across the lane, so the sign is free
    const sx = -dz;
    const sz = dx;
    const pos = this.pos;
    const uv = this.uv;
    for (let j = 0; j <= n; j++) {
      const v = -half + (2 * half * j) / n;
      for (let i = 0; i <= n; i++) {
        const uu = u0 + ((u1 - u0) * i) / n;
        const k = j * (n + 1) + i;
        const wx = x + dx * uu + sx * v;
        const wz = z + dz * uu + sz * v;
        pos[k * 3] = wx;
        pos[k * 3 + 1] = floorAt(wx, wz) + 0.05;
        pos[k * 3 + 2] = wz;
        uv[k * 2] = uu;
        uv[k * 2 + 1] = v;
      }
    }
    (this.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('uv') as BufferAttribute).needsUpdate = true;
    const u = this.u;
    u.uLength.value = s.length;
    u.uWidthNear.value = s.widthNear;
    u.uWidthFar.value = s.widthFar;
    u.uWidthCurve.value = s.widthCurve;
    u.uEndRadius.value = s.endRadius;
    u.uSeed.value = seed;
  }

  /**
   * Per frame: `front` metres the freeze has travelled, `thaw` metres eaten back from the origin (< 0: none), `lip` 0..1 how lit
   * the advancing edge is, `fade` 0..1 overall. Also pushes `look`.
   */
  sync(front: number, thaw: number, lip: number, fade: number): void {
    const l = this.look;
    const u = this.u;
    u.uFront.value = front;
    u.uThaw.value = thaw;
    u.uLip.value = lip;
    u.uFade.value = fade;
    u.uBoundary.value = l.boundary;
    u.uBoundaryGlow.value = l.boundaryGlow;
    u.uFill.value = l.fill;
    u.uFalloff.value = l.falloff;
    u.uPlateScale.value = l.plateScale;
    u.uPlates.value = l.plates;
    u.uSeam.value = l.seam;
    u.uSeamWidth.value = l.seamWidth;
    u.uFingers.value = l.fingers;
    u.uFingerScale.value = l.fingerScale;
    u.uWarp.value = l.warp;
    u.uCrawl.value = l.crawl;
    u.uRagged.value = l.ragged;
    u.uSoft.value = l.soft;
    u.uLipGlow.value = l.lipGlow;
    u.uPulse.value = l.pulse;
    u.uPulseSpeed.value = l.pulseSpeed;
    u.uOpacity.value = l.opacity;
    this.mesh.visible = fade > 0.004;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.parent?.remove(this.mesh);
  }
}
