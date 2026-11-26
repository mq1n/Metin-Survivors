// Ported from threejs-vfx src/vfx/ShatterField.js (MIT, © mohamedachrefelouafi — see ./LICENSE).
// Instanced fragments with a closed-form flight: position is a function of (age, dice, live params), never integrated, so a
// fragment stores nothing but dice and one timestamp. The sandbox's LINE/ZONE layouts and settings tree are replaced by a
// typed params object and a radial burst model (bearing, loft, disc anchor) that suits impacts: rock chunks thrown out of a
// crater, slabs lifting off a quake, crystal shards leaving a broken stone. Fragment geometry is the caller's; this module owns
// the flight, the tumble, the shrink / sink and the draw.
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  NormalBlending,
  Object3D,
  Quaternion,
  ShaderMaterial,
  Vector3,
  type BufferGeometry,
  type Group,
  type Material,
} from 'three';
import { sharedUniforms } from './frame';
import { commonGLSL } from './glsl/common';
import { hash11, saturate } from './math';

const TAU = Math.PI * 2;

/** module-scope scratch: nothing here allocates per frame */
const _dummy = new Object3D();
const _axis = new Vector3();
const _spin = new Quaternion();

/** Live params, read fresh on every `update` (no dimension is captured at burst time except the dice). */
export interface ShatterParams {
  /** burst centre, world space (y = the floor the fragments start on) */
  readonly centre: Vector3;
  /** radius of the disc the fragments start in; 0 = point burst */
  radius: number;
  /** metres of scatter about the anchor */
  spawnRadius: number;
  /** metres above `centre.y` the anchor sits */
  spawnHeight: number;
  /** metres / second */
  speed: number;
  /** ± fraction */
  speedJitter: number;
  /** loft cone, radians above the horizon (min…max) */
  elevMin: number;
  elevMax: number;
  /** extra throw velocity of whatever broke, metres / second */
  readonly inherit: Vector3;
  /** metres / second², signed */
  gravity: number;
  /** 1 / second; 0 = pure ballistics */
  drag: number;
  /** metres, the unit geometry's scale */
  size: number;
  sizeJitter: number;
  /** 0..1 of its size lost by the end of life */
  shrink: number;
  /** how late that shrink bites */
  shrinkPower: number;
  /** radians / second of tumble */
  spin: number;
  spinJitter: number;
  /** fraction of the tumble rate kept once grounded */
  floorSpin: number;
  /** seconds a fragment lives */
  lifetime: number;
  /** fraction of the life at which fragments start to sink into the floor (1 = never) */
  sinkStart: number;
}

export function shatterParams(): ShatterParams {
  return {
    centre: new Vector3(),
    radius: 0,
    spawnRadius: 0.4,
    spawnHeight: 0.3,
    speed: 6,
    speedJitter: 0.6,
    elevMin: 0.12,
    elevMax: 1.3,
    inherit: new Vector3(),
    gravity: -17,
    drag: 0.4,
    size: 0.28,
    sizeJitter: 0.55,
    shrink: 0.5,
    shrinkPower: 1.6,
    spin: 6,
    spinJitter: 0.8,
    floorSpin: 0.25,
    lifetime: 1.4,
    sinkStart: 1,
  };
}

// ---------------------------------------------------------------------------------------------------------------- material

const SHATTER_VERTEX = /* glsl */ `
  attribute float aSeed;
  attribute float aLife;

  varying float vSeed;
  varying float vLife;
  varying vec3  vNormalW;
  varying vec3  vViewDir;

  void main() {
    vSeed = aSeed;
    vLife = aLife;

    mat4 im = mat4(1.0);
    #ifdef USE_INSTANCING
      im = instanceMatrix;
    #endif

    vec4 world = modelMatrix * im * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * mat3(im) * normal);
    vViewDir = cameraPosition - world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const SHATTER_FRAGMENT = /* glsl */ `
  uniform vec3  uColorA;
  uniform vec3  uColorB;
  uniform vec3  uColorEdge;
  uniform float uOpacity;
  uniform float uGlow;
  uniform float uRim;
  uniform float uRimPower;
  uniform float uAmbient;
  uniform float uFadeStart;
  uniform vec3  uLightDir;
  uniform float uGlobalGlow;
  uniform float uShaderIntensity;

  varying float vSeed;
  varying float vLife;
  varying vec3  vNormalW;
  varying vec3  vViewDir;

  void main() {
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(vViewDir);

    // Faceted debris lit off the key direction. Two-sided: a shard is thin enough that its back face shows constantly.
    float lambert = max(dot(N, uLightDir), 0.0);
    if (dot(N, V) < 0.0) lambert = max(dot(-N, uLightDir), 0.0);
    float shade = uAmbient + (1.0 - uAmbient) * lambert;

    float fres = pow(1.0 - clamp(abs(dot(N, V)), 0.0, 1.0), max(uRimPower, 0.1));

    vec3 body = mix(uColorA, uColorB, clamp(vLife, 0.0, 1.0)) * shade;
    // the rim is the only emissive term: debris that glows all over reads as confetti
    vec3 color = body + uColorEdge * fres * uRim * uGlow * uGlobalGlow * mix(0.7, 1.0, uShaderIntensity);

    float alpha = uOpacity * (1.0 - smoothstep(uFadeStart, 1.0, clamp(vLife, 0.0, 1.0)));
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(color, alpha);
  }
`;

/** A lit, rim-glowing fragment material (crystal shards, slate, ice). Rock debris passes its own material instead. */
export function createShatterMaterial(additive = false): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: !additive,
    depthTest: true,
    side: DoubleSide,
    blending: additive ? AdditiveBlending : NormalBlending,
    toneMapped: false,
    uniforms: {
      ...sharedUniforms({
        uColorA: { value: new Color(1, 1, 1) },
        uColorB: { value: new Color(0.4, 0.6, 0.8) },
        uColorEdge: { value: new Color(1, 1, 1) },
        uOpacity: { value: 1 },
        uGlow: { value: 1 },
        uRim: { value: 0.8 },
        uRimPower: { value: 2.4 },
        uAmbient: { value: 0.35 },
        uFadeStart: { value: 0.6 },
      }),
    },
    vertexShader: SHATTER_VERTEX,
    fragmentShader: `${commonGLSL}\n${SHATTER_FRAGMENT}`,
  });
}

// ------------------------------------------------------------------------------------------------------------------ field

export interface ShatterOptions {
  /** unit-space fragment factory: a body inside a unit sphere centred on its own origin (the tumble rotates about it) */
  geometry: (variant: number) => BufferGeometry;
  /** fragment material; must consume the instanced `aSeed` / `aLife` attributes */
  material: Material;
  /** distinct fragment shapes = draw calls */
  variants?: number;
  /** hard ceiling on live fragments */
  capacity?: number;
  renderOrder?: number;
}

/** Floor height callback (world x, z → y); the host's terrain sampler. */
export type FloorAt = (x: number, z: number) => number;

export class ShatterField {
  readonly meshes: InstancedMesh[] = [];
  readonly variants: number;
  readonly capacity: number;
  private readonly slots: number;
  private readonly seeds: InstancedBufferAttribute[] = [];
  private readonly lives: InstancedBufferAttribute[] = [];
  private readonly used: Int32Array;
  // dice: one timestamp and a handful of unitless rolls per fragment
  private readonly born: Float32Array;
  private readonly bearing: Float32Array;
  private readonly loft: Float32Array;
  private readonly radial: Float32Array;
  private readonly offX: Float32Array;
  private readonly offY: Float32Array;
  private readonly offZ: Float32Array;
  private readonly axisX: Float32Array;
  private readonly axisY: Float32Array;
  private readonly axisZ: Float32Array;
  private readonly speedRoll: Float32Array;
  private readonly sizeRoll: Float32Array;
  private readonly spinRoll: Float32Array;
  private cursor = 0;
  private live = 0;
  private seedBase = 0;
  private diceN = 0;

  constructor(parent: Group, { geometry, material, variants = 1, capacity = 32, renderOrder = 6 }: ShatterOptions) {
    this.variants = Math.max(1, Math.round(variants));
    this.capacity = Math.max(1, Math.round(capacity));
    this.slots = Math.ceil(this.capacity / this.variants);
    this.used = new Int32Array(this.variants);
    const n = this.capacity;
    this.born = new Float32Array(n).fill(-1);
    this.bearing = new Float32Array(n);
    this.loft = new Float32Array(n);
    this.radial = new Float32Array(n);
    this.offX = new Float32Array(n);
    this.offY = new Float32Array(n);
    this.offZ = new Float32Array(n);
    this.axisX = new Float32Array(n);
    this.axisY = new Float32Array(n);
    this.axisZ = new Float32Array(n);
    this.speedRoll = new Float32Array(n);
    this.sizeRoll = new Float32Array(n);
    this.spinRoll = new Float32Array(n);

    for (let v = 0; v < this.variants; v++) {
      const seeds = new InstancedBufferAttribute(new Float32Array(this.slots), 1);
      const lives = new InstancedBufferAttribute(new Float32Array(this.slots), 1);
      const geo = geometry(v);
      geo.setAttribute('aSeed', seeds);
      geo.setAttribute('aLife', lives);
      const mesh = new InstancedMesh(geo, material, this.slots);
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.renderOrder = renderOrder;
      parent.add(mesh);
      this.meshes.push(mesh);
      this.seeds.push(seeds);
      this.lives.push(lives);
    }
  }

  /** live fragments after the last `update` */
  get count(): number {
    return this.live;
  }

  /** deterministic dice: hash of (seed, running counter) */
  private dice(): number {
    return hash11(this.seedBase + this.diceN++ * 1.618);
  }

  /**
   * Throws `count` fragments. Everything captured is unitless (bearing, loft, rolls) plus the absolute time `now`; the metres
   * arrive in `update`. `seed` makes a burst reproducible.
   * @returns fragments actually thrown
   */
  burst(now: number, count: number, seed: number): number {
    this.seedBase = seed * 91.7 + 3.1;
    this.diceN = 0;
    const wanted = Math.max(0, Math.round(count));
    for (let k = 0; k < wanted; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;
      this.born[i] = now;
      this.bearing[i] = this.dice() * TAU;
      this.loft[i] = this.dice();
      this.radial[i] = Math.sqrt(this.dice());
      this.speedRoll[i] = this.dice() * 2 - 1;
      this.sizeRoll[i] = this.dice() * 2 - 1;
      this.spinRoll[i] = this.dice() * 2 - 1;
      // unit scatter about the anchor and a unit tumble axis (z-then-angle: exact, constant time)
      let z = this.dice() * 2 - 1;
      let a = this.dice() * TAU;
      let r = Math.sqrt(Math.max(0, 1 - z * z));
      this.offX[i] = Math.cos(a) * r;
      this.offY[i] = z;
      this.offZ[i] = Math.sin(a) * r;
      z = this.dice() * 2 - 1;
      a = this.dice() * TAU;
      r = Math.sqrt(Math.max(0, 1 - z * z));
      this.axisX[i] = Math.cos(a) * r;
      this.axisY[i] = z;
      this.axisZ[i] = Math.sin(a) * r;
      const variant = i % this.variants;
      const slot = (i / this.variants) | 0;
      const seeds = this.seeds[variant] as InstancedBufferAttribute;
      (seeds.array as Float32Array)[slot] = this.dice() * 10;
      seeds.needsUpdate = true;
    }
    return wanted;
  }

  /** Kills everything in the air. */
  clear(): void {
    this.born.fill(-1);
    this.live = 0;
    this.cursor = 0;
    for (const m of this.meshes) m.count = 0;
  }

  setVisible(v: boolean): void {
    for (const m of this.meshes) m.visible = v;
  }

  /**
   * Re-flies every fragment from the live params. Allocation-free.
   * @param now absolute time (same clock as `burst`)
   * @returns live fragments
   */
  update(now: number, p: ShatterParams, floorAt: FloorAt): number {
    const variants = this.variants;
    const used = this.used;
    used.fill(0);
    const lifetime = Math.max(0.02, p.lifetime);
    const shrink = saturate(p.shrink);
    const k = p.drag;
    const g = p.gravity;
    let live = 0;

    for (let i = 0; i < this.capacity; i++) {
      const variant = i % variants;
      const slot = (i / variants) | 0;
      const mesh = this.meshes[variant] as InstancedMesh;
      const lives = this.lives[variant] as InstancedBufferAttribute;
      const born = this.born[i] as number;
      const age = born < 0 ? -1 : now - born;
      const life = age / lifetime;
      if (age < 0 || life >= 1) {
        if (born >= 0 && life >= 1) this.born[i] = -1;
        // dead or unborn: park it, keep the slot contiguous
        _dummy.position.set(0, -999, 0);
        _dummy.quaternion.identity();
        _dummy.scale.setScalar(0.0001);
        _dummy.updateMatrix();
        mesh.setMatrixAt(slot, _dummy.matrix);
        (lives.array as Float32Array)[slot] = 1;
        used[variant] = Math.max(used[variant] as number, slot + 1);
        continue;
      }

      const size = Math.max(0.001, p.size * (1 + (this.sizeRoll[i] as number) * p.sizeJitter)) * (1 - shrink * Math.pow(life, p.shrinkPower));

      // launch velocity: bearing + loft cone, scaled by the speed roll
      const bearing = this.bearing[i] as number;
      const elev = p.elevMin + (p.elevMax - p.elevMin) * (this.loft[i] as number);
      const speed = p.speed * (1 + (this.speedRoll[i] as number) * p.speedJitter);
      const horiz = Math.cos(elev) * speed;
      const vx = Math.cos(bearing) * horiz + p.inherit.x;
      const vy = Math.sin(elev) * speed + p.inherit.y;
      const vz = Math.sin(bearing) * horiz + p.inherit.z;

      // anchor: a disc (or point) about the centre, plus unit scatter
      const disc = p.radius * (this.radial[i] as number);
      let x = p.centre.x + Math.cos(bearing) * disc + (this.offX[i] as number) * p.spawnRadius;
      let y = p.centre.y + p.spawnHeight + (this.offY[i] as number) * p.spawnRadius;
      let z = p.centre.z + Math.sin(bearing) * disc + (this.offZ[i] as number) * p.spawnRadius;

      // analytic drag solution: p(t) = p0 + (v0 − g/k)(1 − e^{−kt})/k + (g/k)·t  (ballistic below k ≈ 0)
      if (k > 1e-3) {
        const decay = (1 - Math.exp(-k * age)) / k;
        const terminal = g / k;
        x += vx * decay;
        z += vz * decay;
        y += (vy - terminal) * decay + terminal * age;
      } else {
        x += vx * age;
        z += vz * age;
        y += vy * age + 0.5 * g * age * age;
      }

      const floor = floorAt(x, z) + size * 0.35;
      let grounded = false;
      if (y < floor) {
        y = floor;
        grounded = true;
      }
      if (p.sinkStart < 1 && life > p.sinkStart) {
        const s = saturate((life - p.sinkStart) / (1 - p.sinkStart));
        y -= s * s * s * (size * 2 + 0.3);
      }

      // a grounded fragment keeps `floorSpin` of its rate rather than stopping dead (no closed form for the contact time with drag)
      const rate = p.spin * (1 + (this.spinRoll[i] as number) * p.spinJitter) * (grounded ? saturate(p.floorSpin) : 1);
      _axis.set(this.axisX[i] as number, this.axisY[i] as number, this.axisZ[i] as number);
      _spin.setFromAxisAngle(_axis, rate * age);
      _dummy.position.set(x, y, z);
      _dummy.quaternion.copy(_spin);
      _dummy.scale.setScalar(size);
      _dummy.updateMatrix();
      mesh.setMatrixAt(slot, _dummy.matrix);
      (lives.array as Float32Array)[slot] = life;
      used[variant] = Math.max(used[variant] as number, slot + 1);
      live++;
    }

    for (let v = 0; v < variants; v++) {
      const mesh = this.meshes[v] as InstancedMesh;
      mesh.count = used[v] as number;
      mesh.instanceMatrix.needsUpdate = true;
      (this.lives[v] as InstancedBufferAttribute).needsUpdate = true;
    }
    this.live = live;
    return live;
  }

  dispose(): void {
    for (const m of this.meshes) {
      m.geometry.dispose();
      m.dispose();
      m.parent?.remove(m);
    }
    this.meshes.length = 0;
  }
}
