// Ported from threejs-vfx src/effects/GroundDecals.js (MIT, © mohamedachrefelouafi — see ./LICENSE).
// Procedural ground marks — branching electric burn, scorch, rime, cracks, shock rings, dust — with no textures: every pattern is
// a function of the fragment's position inside a quad lying on the floor. The sandbox spawns one mesh per decal; here a pool is
// one instanced draw call per blend mode (additive: shock ring + electric burn; alpha: scorch, cracks, dust, rime) and a decal's
// whole animation is a function of (clock − birth) / life evaluated on the GPU, so live decals cost no per-frame CPU at all.
//
//   const decals = new GroundDecals({ additive: 16 });          // capacities per blend mode (0 / omitted = no mesh)
//   root.add(decals.group);                                      // once, in the effect's build()
//   decals.begin(DecalType.ARC, x, y, z).radius(2.4).life(0.9).col(0x4aa8ff, 0x9fdcff).emit();   // (y = terrain height)
//   decals.update(dt);                                           // every frame: advances the clock, hides idle meshes
//
// Decals overwrite the oldest slot of their blend mode when the ring is full. Colours are 0xRRGGBB (sRGB); `a` is the body of the
// mark and `b` its hot accent. Zero allocation after construction.
import {
  AdditiveBlending,
  BufferAttribute,
  Color,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  ShaderMaterial,
  Sphere,
  Vector3,
} from 'three';
import { putHex } from './color';
import { sharedUniforms } from './frame';
import { commonGLSL } from './glsl/common';
import { noiseGLSL } from './glsl/noise';

/** The decal patterns. SHOCKWAVE and ARC are additive, everything else alpha-blended. */
export const DecalType = {
  /** burnt ground with cooling embers */
  SCORCH: 0,
  /** radial fractures with hot glow */
  CRACK: 1,
  /** thin expanding ring */
  SHOCKWAVE: 2,
  /** soft ground-hugging dust puff */
  DUSTRING: 3,
  /** rime creeping outward in lit plates */
  FROST: 4,
  /** branching electric burn */
  ARC: 5,
} as const;
export type DecalType = (typeof DecalType)[keyof typeof DecalType];

export interface GroundDecalsOptions {
  /** ring-buffer capacity of the additive batch (shock ring, electric burn); 0 = none */
  additive?: number;
  /** ring-buffer capacity of the alpha batch (scorch, cracks, dust, rime); 0 = none */
  alpha?: number;
  /**
   * render order of the additive batch; the alpha batch draws two below it. Elemental meshes sort by their own order (an effect's
   * root group resets the host group's), and the batched layers sit at 35–44 — the default 41 lands the burn on top of their
   * alpha decals (a dark scorch must not darken it) and under their additive sprites.
   */
  renderOrder?: number;
}

const _col = new Color();
const DEAD = -1e9;

const DECAL_VERTEX = /* glsl */ `
  attribute vec3 aPos;     // centre, world metres
  attribute vec2 aSlope;   // terrain gradient (dy/dx, dy/dz) so the quad lies on a slope
  attribute vec4 aA;       // radius m, birth s, life s, seed
  attribute vec4 aB;       // intensity, width, type, yaw
  attribute vec3 aColA;
  attribute vec3 aColB;

  uniform float uClock;
  uniform vec3  uLightDir; // world space, toward the sun

  varying vec2  vC;        // -1..1 across the decal
  varying float vAge;
  varying vec4  vP;        // radius, seed, intensity, width
  varying float vType;
  varying vec3  vColA;
  varying vec3  vColB;
  varying vec3  vLight;    // the key light in the decal's own frame (x along local +x, z along local +z)

  void main() {
    float life = max(aA.z, 1e-3);
    float age = (uClock - aA.y) / life;
    // Not born yet, or already gone: park the quad outside the clip volume.
    if (age < 0.0 || age > 1.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    vAge = age;
    vP = vec4(aA.x, aA.w, aB.x, aB.y);
    vType = aB.z;
    vColA = aColA;
    vColB = aColB;

    vec2 c = position.xy * 2.0;
    vC = c;

    float cy = cos(aB.w);
    float sy = sin(aB.w);
    vec2 l = c * aA.x;
    vec3 off = vec3(cy * l.x + sy * l.y, 0.0, -sy * l.x + cy * l.y);
    off.y = aSlope.x * off.x + aSlope.y * off.z;
    // Decals are spawned with a random yaw to decorrelate their noise, so a key direction taken straight from world space would
    // light every patch from a different side of the room: rotate it into the quad's frame once, here.
    vLight = normalize(vec3(dot(uLightDir, vec3(cy, 0.0, -sy)), uLightDir.y, dot(uLightDir, vec3(sy, 0.0, cy))));

    gl_Position = projectionMatrix * viewMatrix * vec4(aPos + off, 1.0);
  }
`;

const DECAL_FRAGMENT = /* glsl */ `
  uniform float uClock;
  uniform float uGlobalGlow;

  varying vec2  vC;
  varying float vAge;
  varying vec4  vP;
  varying float vType;
  varying vec3  vColA;
  varying vec3  vColB;
  varying vec3  vLight;

  ${noiseGLSL}
  ${commonGLSL}

  /** smoothstep that tolerates reversed and degenerate edges (every pattern shrinks an edge to zero at age 0) */
  float sm(float e0, float e1, float x) {
    float w = e1 - e0;
    w = abs(w) < 1e-4 ? (w < 0.0 ? -1e-4 : 1e-4) : w;
    float t = clamp((x - e0) / w, 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
  }

  #ifndef DECAL_ADD
  /**
   * Depth of settled snow at q (metres from the centre of the patch), ~0..1. Three scales, because that is what makes powder
   * read as powder rather than as a texture: banked drifts, the shouldered slabs where the crust has packed and cracked, and a
   * fine grain for the light to catch. It is a *height* field — FROST differentiates it for a normal.
   */
  float snowDepth(vec2 q, float seed, float sharpness) {
    float drift = fbm3(vec3(q * 0.85, seed)) * 0.5 + 0.5;
    vec2  cell  = voronoi2(q * (1.4 + sharpness * 0.9) + seed * 7.0);
    float slabs = sm(0.0, 0.55, cell.x) * 0.30 + cell.y * 0.12;
    float grain = snoise01(vec3(q * (7.0 + sharpness * 5.0), seed * 3.0)) * 0.15;
    return drift * 0.60 + slabs + grain;
  }
  #endif

  void main() {
    vec2 c = vC;
    float d = length(c);
    if (d > 1.0) discard;

    float age = vAge;
    float seed = vP.y;
    float intensity = vP.z;
    float width = vP.w;
    vec3 colA = vColA;
    vec3 colB = vColB;

    float alpha = 0.0;
    vec3 color = colA;
    float fadeOut = 1.0 - sm(0.55, 1.0, age);

    #ifdef DECAL_ADD
    if (vType < 2.5) {
      /* ---- SHOCKWAVE ---- */
      float radius = pow(age, 0.55);
      float ring = sm(width, 0.0, abs(d - radius));
      alpha = ring * (1.0 - age) * 0.9;
      color = mix(colA, colB, ring);
    } else {
      /* ---- ARC ---- */
      // The burn a bolt leaves where it earthed itself. The filament field is sampled in the *plane*, never on the angle: an
      // angular function hands every radius along a bearing the same value, which draws dead-straight spokes — a firework, not
      // a burn. Sampling in 2D and warping the lookup lets the filaments meander and fork the way current actually does. 'width'
      // is how finely it splits.
      float warp = fbm3(vec3(c * 1.7, seed * 3.0)) * 0.5;
      float fil = ridged(vec3(c * (2.4 + width * 4.0) + warp, seed * 11.0), 4);
      float veins = sm(0.70, 0.96, fil);

      // A ragged front that opens outward, so the mark spreads from the strike rather than appearing whole.
      float grow = pow(age, 0.35);
      float edge = d + fbm3(vec3(c * 2.2, seed * 5.0)) * 0.25;
      float front = sm(grow, grow * 0.15, edge);
      float hot = veins * front * (1.0 - sm(0.0, 0.45, age));

      alpha = clamp(veins * front * 1.1, 0.0, 1.0) * fadeOut;
      color = mix(colA, colB, clamp(veins * 1.4, 0.0, 1.0));
      color += colB * hot * 1.8;
    }
    #else
    if (vType < 0.5) {
      /* ---- SCORCH ---- */
      float n = fbm3(vec3(c * 2.4, seed * 13.0));
      float burn = sm(1.0, 0.15, d + n * 0.45);
      float embers = pow(max(0.0, snoise(vec3(c * 6.0, seed * 9.0 + uClock * 0.35))), 4.0);
      alpha = burn * (0.85 * fadeOut);
      color = mix(colA, colB, embers * (1.0 - age));
      color += embers * colB * 2.5 * (1.0 - sm(0.0, 0.6, age));
    } else if (vType < 1.5) {
      /* ---- CRACK ---- */
      vec2 dir = d > 1e-4 ? c / d : vec2(1.0, 0.0);
      float branch = ridged(vec3(dir, seed * 5.0) * 2.6, 4);
      float spread = sm(0.0, 0.45, age);
      float radial = sm(spread, spread * 0.35, d);
      float crack = sm(0.55 - width * 0.35, 0.85, branch) * radial;
      float glow = crack * (1.0 - sm(0.1, 0.8, age));
      alpha = clamp(crack * 0.95 * fadeOut, 0.0, 1.0);
      color = mix(colA, colB, glow);
      color += colB * glow * 1.8;
    } else if (vType < 3.5) {
      /* ---- DUSTRING ---- */
      float radius = mix(0.1, 1.0, pow(age, 0.4));
      float n = fbm3(vec3(c * 3.1, seed * 7.0 + uClock * 0.2));
      float puff = sm(radius, radius * 0.35, d) * (0.6 + n * 0.5);
      alpha = puff * (1.0 - age) * 0.7;
      color = mix(colA, colB, n * 0.5 + 0.5);
    } else {
      /* ---- FROST ---- */
      // Snow driven into the ground where the cold went through it. Everything is sampled in the *plane* (an angular lookup
      // hands every radius along a bearing the same lobe value — which is literally how you draw a star), and the patch is
      // **shaded** off a height field rather than tinted through a mask: forward differences give a normal, the key light
      // lights it, and the result banks and catches light like powder. 'width' is the grain frequency.
      float fseed = seed * 37.0;
      float sharp = clamp(width, 0.05, 4.0);
      // Sample in metres, so a small rime patch and the broad sheet under an impact have the same size of grain.
      vec2 q = c * max(0.35, vP.x);

      /* the drift: a ragged reach, never a disc */
      vec2 warp = vec2(fbm3(vec3(q * 0.55, fseed)), fbm3(vec3(q * 0.55, fseed + 5.7))) * 0.45;
      float lobes = fbm3(vec3(q * 0.8 + warp, fseed + 13.0));
      float grow = pow(age, 0.30);
      float reach = d * (1.0 - lobes * 0.40);
      float cover = sm(grow, grow - 0.38, reach);
      if (cover < 0.004) discard;

      /* relief */
      float e = 0.16;                               // metres between taps
      float h  = snowDepth(q, fseed, sharp);
      float hx = snowDepth(q + vec2(e, 0.0), fseed, sharp);
      float hy = snowDepth(q + vec2(0.0, e), fseed, sharp);
      // A shallow bump: snow is soft, and a steep fake normal reads as gravel.
      vec3 nrm = normalize(vec3((h - hx) / e * 0.30, 1.0, (h - hy) / e * 0.30));

      float lambert = clamp(dot(nrm, vLight), 0.0, 1.0);
      // Snow scatters deep, so its own shadow never goes black — it goes blue.
      float shade = 0.36 + 0.64 * pow(lambert, 0.8);

      /* how thickly it lies: thick in the middle, breaking into scattered grains at the rim, so there is no printed outline */
      float lie = sm(0.10, 0.52, cover * (0.34 + 0.78 * h));

      alpha = lie * fadeOut * 0.95;
      color = mix(colB * 0.55, mix(colA, vec3(1.0), 0.45), shade);

      // Ice glints where the crust catches the light — stepped in time so they twinkle as the patch settles.
      float glint = sm(0.90, 1.0, snoise01(vec3(q * 9.0, floor(uClock * 7.0) * 0.37 + fseed)));
      color += glint * pow(lambert, 2.0) * 1.5 * (1.0 - sm(0.0, 0.7, age));

      // The advancing lip is still freezing, so it stays lit while it travels.
      float lip = sm(0.10, 0.0, abs(reach - grow)) * (1.0 - sm(0.0, 0.5, age));
      color = mix(color, mix(colB, vec3(1.0), 0.6), lip * 0.55);
      alpha = clamp(alpha + lip * cover * 0.25 * fadeOut, 0.0, 1.0);
    }
    #endif

    alpha *= intensity;
    if (alpha < 0.004) discard;

    color *= uGlobalGlow;
    gl_FragColor = vec4(color, alpha);
  }
`;

/** What the builder collects for one decal. */
interface DecalSpec {
  type: number;
  x: number;
  y: number;
  z: number;
  gx: number;
  gz: number;
  radius: number;
  life: number;
  delay: number;
  intensity: number;
  width: number;
  colorA: number;
  colorB: number;
  /** < 0 = random */
  seed: number;
}

function resetSpec(s: DecalSpec): void {
  s.gx = 0;
  s.gz = 0;
  s.radius = 1;
  s.life = 1;
  s.delay = 0;
  s.intensity = 1;
  s.width = 0.12;
  s.colorA = 0xffffff;
  s.colorB = 0xffffff;
  s.seed = -1;
}

/** One instanced mesh and the ring buffer behind it. Per-instance floats: aPos 3, aSlope 2, aA 4, aB 4, aColA 3, aColB 3. */
class DecalBatch {
  readonly mesh: Mesh;
  /** clock time after which nothing in this batch is alive */
  liveUntil = 0;
  private readonly geometry: InstancedBufferGeometry;
  private readonly material: ShaderMaterial;
  private readonly uClock = { value: 0 };
  private readonly pos: Float32Array;
  private readonly slope: Float32Array;
  private readonly a: Float32Array;
  private readonly b: Float32Array;
  private readonly colA: Float32Array;
  private readonly colB: Float32Array;
  private readonly attrs: InstancedBufferAttribute[] = [];
  private cursor = 0;

  constructor(readonly capacity: number, additive: boolean, renderOrder: number) {
    const n = capacity;
    this.pos = new Float32Array(n * 3);
    this.slope = new Float32Array(n * 2);
    this.a = new Float32Array(n * 4);
    this.b = new Float32Array(n * 4);
    this.colA = new Float32Array(n * 3);
    this.colB = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      this.a[i * 4 + 1] = DEAD;
      this.a[i * 4 + 2] = 1;
    }

    const g = new InstancedBufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    g.setIndex(new BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));
    this.instanced(g, 'aPos', this.pos, 3);
    this.instanced(g, 'aSlope', this.slope, 2);
    this.instanced(g, 'aA', this.a, 4);
    this.instanced(g, 'aB', this.b, 4);
    this.instanced(g, 'aColA', this.colA, 3);
    this.instanced(g, 'aColB', this.colB, 3);
    g.instanceCount = n;
    g.boundingSphere = new Sphere(new Vector3(), 1e4); // placed in world space by the vertex shader
    this.geometry = g;

    this.material = new ShaderMaterial({
      defines: additive ? { DECAL_ADD: '' } : {},
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: additive ? AdditiveBlending : NormalBlending,
      // the quad lies in the XZ plane under an arbitrary yaw, and from above its winding is back-facing
      side: DoubleSide,
      // pulled toward the camera so a decal on a slope or a hair above the terrain mesh never z-fights it
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
      toneMapped: false,
      uniforms: { ...sharedUniforms({ uClock: this.uClock }) },
      vertexShader: DECAL_VERTEX,
      fragmentShader: DECAL_FRAGMENT,
    });
    this.mesh = new Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = additive ? renderOrder : renderOrder - 2;
  }

  private instanced(g: InstancedBufferGeometry, name: string, array: Float32Array, size: number): void {
    const attribute = new InstancedBufferAttribute(array, size);
    g.setAttribute(name, attribute);
    this.attrs.push(attribute);
  }

  set clock(t: number) {
    this.uClock.value = t;
  }

  /** claims the next ring slot (overwriting the oldest) and writes one decal born at clock time `birth` */
  write(s: DecalSpec, birth: number): void {
    const i = this.cursor;
    this.cursor = (i + 1) % this.capacity;
    this.pos[i * 3] = s.x;
    this.pos[i * 3 + 1] = s.y;
    this.pos[i * 3 + 2] = s.z;
    this.slope[i * 2] = s.gx;
    this.slope[i * 2 + 1] = s.gz;
    const o = i * 4;
    this.a[o] = s.radius;
    this.a[o + 1] = birth;
    this.a[o + 2] = s.life;
    this.a[o + 3] = s.seed >= 0 ? s.seed : Math.random();
    this.b[o] = s.intensity;
    this.b[o + 1] = s.width;
    this.b[o + 2] = s.type;
    this.b[o + 3] = Math.random() * Math.PI * 2;
    putHex(_col, s.colorA);
    this.colA[i * 3] = _col.r;
    this.colA[i * 3 + 1] = _col.g;
    this.colA[i * 3 + 2] = _col.b;
    putHex(_col, s.colorB);
    this.colB[i * 3] = _col.r;
    this.colB[i * 3 + 1] = _col.g;
    this.colB[i * 3 + 2] = _col.b;
    for (let k = 0; k < this.attrs.length; k++) (this.attrs[k] as InstancedBufferAttribute).needsUpdate = true;
    this.liveUntil = Math.max(this.liveUntil, birth + s.life);
    this.mesh.visible = true;
  }

  clear(): void {
    for (let i = 0; i < this.capacity; i++) this.a[i * 4 + 1] = DEAD;
    for (let k = 0; k < this.attrs.length; k++) (this.attrs[k] as InstancedBufferAttribute).needsUpdate = true;
    this.liveUntil = 0;
    this.cursor = 0;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

export class GroundDecals {
  /** the (up to two) instanced meshes: add under the effect's root */
  readonly group = new Group();
  private readonly add: DecalBatch | null;
  private readonly alp: DecalBatch | null;
  private clock = 0;
  private readonly spec: DecalSpec = {
    type: DecalType.ARC, x: 0, y: 0, z: 0, gx: 0, gz: 0, radius: 1, life: 1, delay: 0, intensity: 1, width: 0.12,
    colorA: 0xffffff, colorB: 0xffffff, seed: -1,
  };

  constructor(options: GroundDecalsOptions = {}) {
    this.group.name = 'GroundDecals';
    const addN = options.additive ?? 0;
    const alpN = options.alpha ?? 0;
    const order = options.renderOrder ?? 41;
    this.add = addN > 0 ? new DecalBatch(addN, true, order) : null;
    this.alp = alpN > 0 ? new DecalBatch(alpN, false, order) : null;
    if (this.alp !== null) this.group.add(this.alp.mesh);
    if (this.add !== null) this.group.add(this.add.mesh);
  }

  /** draw calls currently issued: one per batch that has something alive */
  get drawCalls(): number {
    return (this.add?.mesh.visible === true ? 1 : 0) + (this.alp?.mesh.visible === true ? 1 : 0);
  }

  /** true while any decal is alive or waiting for its delay */
  get busy(): boolean {
    return (this.add !== null && this.add.liveUntil > this.clock) || (this.alp !== null && this.alp.liveUntil > this.clock);
  }

  /** Starts describing a decal of `type` centred on (x, y, z) — y is the terrain height. Finish the chain with `emit()`. */
  begin(type: DecalType, x: number, y: number, z: number): this {
    const s = this.spec;
    s.type = type;
    s.x = x;
    s.y = y + 0.03;
    s.z = z;
    return this;
  }

  /** footprint radius, metres */
  radius(r: number): this {
    this.spec.radius = r;
    return this;
  }

  /** seconds the decal lives (its pattern animates over exactly this span) */
  life(s: number): this {
    this.spec.life = Math.max(0.05, s);
    return this;
  }

  /** seconds from now until it appears */
  delay(s: number): this {
    this.spec.delay = s;
    return this;
  }

  /** body colour, hot accent colour (0xRRGGBB) */
  col(a: number, b: number): this {
    this.spec.colorA = a;
    this.spec.colorB = b;
    return this;
  }

  /** alpha multiplier; the additive types may exceed 1 */
  int(i: number): this {
    this.spec.intensity = i;
    return this;
  }

  /** pattern thickness: ring width (SHOCKWAVE), vein splitting (ARC), crack width (CRACK), grain frequency (FROST) */
  width(w: number): this {
    this.spec.width = w;
    return this;
  }

  /** terrain gradient (dy/dx, dy/dz) so the quad lies on the slope instead of cutting into it */
  slope(gx: number, gz: number): this {
    this.spec.gx = gx;
    this.spec.gz = gz;
    return this;
  }

  /** pattern seed, 0..1 (default random) */
  seed(s: number): this {
    this.spec.seed = s;
    return this;
  }

  /** Writes the decal into its blend mode's ring and resets the builder. A type whose blend mode has no batch is ignored. */
  emit(): void {
    const s = this.spec;
    const batch = s.type === DecalType.SHOCKWAVE || s.type === DecalType.ARC ? this.add : this.alp;
    batch?.write(s, this.clock + s.delay);
    resetSpec(s);
  }

  /** Advances the pool clock; meshes with nothing alive are hidden (no draw call). */
  update(dt: number): void {
    this.clock += dt;
    this.tick(this.add);
    this.tick(this.alp);
  }

  private tick(batch: DecalBatch | null): void {
    if (batch === null) return;
    batch.clock = this.clock;
    batch.mesh.visible = batch.liveUntil > this.clock;
  }

  /** Kills every decal at once. */
  clear(): void {
    this.add?.clear();
    this.alp?.clear();
  }

  dispose(): void {
    this.add?.dispose();
    this.alp?.dispose();
    this.group.parent?.remove(this.group);
  }
}
