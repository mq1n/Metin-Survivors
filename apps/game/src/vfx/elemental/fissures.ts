// Ported from threejs-vfx src/effects/GroundFissures.js (MIT, © mohamedachrefelouafi — see ./LICENSE).
// Molten fissures: the ground tearing open under an impact. A network of cracks races outward from the point of impact — several
// main arms that meander rather than run straight, each shedding lightning-style side branches — drawn as one ribbon mesh that
// hugs the floor. Core (white-hot) and underglow (wide, orange) are two bands of the same ribbon, so the whole network is a single
// draw call; lumps of basalt are heaved up along the lips so the crack has relief instead of being a glowing decal.
// Changes from the sandbox: the network follows the terrain (per-node height from the host sampler), generation is seeded,
// allocation-free and closure-free, the two passes are merged, and the settings tree is a typed `FissureLook`.
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CustomBlending,
  DoubleSide,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Mesh,
  Object3D,
  OneFactor,
  ShaderMaterial,
  Sphere,
  Vector3,
  type Material,
} from 'three';
import { putHex } from './color';
import { sharedUniforms } from './frame';
import { createAsteroidGeometry } from './geometry';
import { Easing, clamp, hash11, lerp, saturate } from './math';
import type { FloorAt } from './shatterField';

/** Ribbon nodes across the whole network. The generator stops when it runs out. */
const MAX_NODES = 900;
/** Main arms the generator can lay. */
const MAX_ARMS = 12;
/** Branches are generated at this count; the density slider culls them. */
const MAX_BRANCHES = 8;
/** Basalt chunks heaved up along the lips. */
export const MAX_LIPS = 44;
const TAU = Math.PI * 2;
/** Centreline resample step, in unit space. */
const STEP = 0.045;
/** Width ratio between the underglow band (the whole ribbon) and the white-hot core (its centre). */
const CORE_RATIO = 4.6;

const _dummy = new Object3D();

export interface FissureLook {
  /** how far the cracks reach, metres */
  radius: number;
  /** width of the open seam, metres */
  width: number;
  /** core temperature */
  heat: number;
  /** speed of the heat waves travelling along the cracks */
  pulse: number;
  /** how fast the cracks race outward, metres / second */
  growth: number;
  /** fraction of the generated branches kept, 0..1 */
  branches: number;
  /** how far along a branch runs before its point, 0..1 */
  branchLength: number;
  /** basalt heaved up along the lips, metres */
  lipSize: number;
  /** seconds before the cracks close up */
  life: number;
  /** main cracks radiating from the impact */
  arms: number;
  /** how hard an arm veers, radians per unit walked */
  wander: number;
}

export function fissureLook(): FissureLook {
  return { radius: 5.2, width: 0.14, heat: 1.5, pulse: 1, growth: 9, branches: 0.75, branchLength: 0.85, lipSize: 0.3, life: 4.5, arms: 6, wander: 1.6 };
}

const FISSURE_VERTEX = /* glsl */ `
  uniform float uRadius;
  uniform float uWidth;
  uniform float uBranchFrac;
  uniform float uLenFrac;

  attribute vec3  aSide;
  attribute float aAcross;
  attribute float aDist;
  attribute float aJit;
  attribute float aWalk;
  attribute float aMaxWalk;
  attribute float aRank;

  varying float vAcross;
  varying float vDist;
  varying float vTaper;
  varying float vSel;

  void main() {
    // A branch survives while its rank sits under the density fraction; the main arms are rank 0, so they can never be culled.
    float sel = step(aRank, uBranchFrac);
    // ... and is pinched to a point wherever the length slider currently ends.
    float taper = pow(clamp(1.0 - aWalk / (aMaxWalk * uLenFrac + 1e-4), 0.0, 1.0), 0.7);

    vAcross = aAcross;
    vDist = aDist;
    vTaper = taper;
    vSel = sel;

    // The network is baked in a unit disc (x, z); y is the terrain offset in metres. The reach is a live uniform.
    vec3 centre = vec3(position.x * uRadius, position.y, position.z * uRadius);
    vec3 pos = centre + aSide * (uWidth * 0.5 * aAcross * aJit * taper * sel);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const FISSURE_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uGrown;
  uniform float uHeat;
  uniform float uPulse;
  uniform float uFade;
  uniform float uCoreRatio;
  uniform float uGlobalGlow;
  uniform vec3  uColorSeam;
  uniform vec3  uColorRed;
  uniform vec3  uColorOrange;
  uniform vec3  uColorWhite;

  varying float vAcross;
  varying float vDist;
  varying float vTaper;
  varying float vSel;

  void main() {
    // The crack is only open behind the racing front.
    float openness = smoothstep(0.0, 0.08, uGrown - vDist);
    if (openness <= 0.001 || vSel < 0.5) discard;

    float a = abs(vAcross);
    float ak = a * uCoreRatio;                      // |across| in units of the core band

    // ---- core: the narrow white-hot centre of the ribbon
    float centre = 1.0 - smoothstep(0.12, 1.0, ak);
    float pulse = sin(vDist * 22.0 - uTime * uPulse * 2.6);
    float flicker = sin(uTime * 9.0 + vDist * 120.0) * 0.08 + 0.94;
    // a white flash rides the propagating crack front
    float flash = (1.0 - smoothstep(0.0, 0.14, abs(uGrown - vDist))) * 1.6;
    float coreMask = 1.0 - smoothstep(0.82, 1.0, ak);
    float heat = centre * (pulse * 0.28 + 0.72) * flicker * uHeat * (vTaper * 0.35 + 0.65) + flash * coreMask;

    vec3 coreColor = mix(uColorSeam, uColorRed, smoothstep(0.0, 0.55, heat));
    coreColor = mix(coreColor, uColorOrange, smoothstep(0.55, 1.15, heat));
    coreColor = mix(coreColor, uColorWhite, smoothstep(1.15, 2.1, heat));
    float coreA = openness * coreMask * uFade;

    // ---- underglow: wide and additive, paints radiant colour onto the stone around the seam
    float falloff = pow(max(1.0 - a, 0.0), 1.6);
    float strength = falloff * (pulse * 0.22 + 0.78) * uHeat * (vTaper * 0.5 + 0.5) * 0.42;
    float glowA = openness * uFade * clamp(strength * 2.2, 0.0, 1.0);

    vec3 color = coreColor * coreA + uColorOrange * strength * glowA;
    if (max(color.r, max(color.g, color.b)) < 0.002) discard;
    gl_FragColor = vec4(color * uGlobalGlow, 1.0);
  }
`;

function makeUniforms() {
  return sharedUniforms({
    uRadius: { value: 3 },
    uWidth: { value: 0.64 },
    uBranchFrac: { value: 0.7 },
    uLenFrac: { value: 0.8 },
    uGrown: { value: 0 },
    uHeat: { value: 1.4 },
    uPulse: { value: 1 },
    uFade: { value: 1 },
    uCoreRatio: { value: CORE_RATIO },
    uColorSeam: { value: new Color(0.02, 0.004, 0.002) },
    uColorRed: { value: new Color(1.1, 0.1, 0.01) },
    uColorOrange: { value: new Color(2.6, 0.85, 0.1) },
    uColorWhite: { value: new Color(4.6, 3.6, 2.4) },
  });
}

// seeded dice, module scope: generation allocates nothing
let diceSeed = 0;
let diceN = 0;
const roll = (): number => hash11(diceSeed + diceN++ * 0.7071);
const rollRange = (a: number, b: number): number => a + (b - a) * roll();

export class Fissures {
  readonly ribbon: Mesh;
  readonly lips: InstancedMesh;
  readonly look: FissureLook = fissureLook();
  /** seconds since `start`; the host effect advances it through `step` */
  age = 0;
  private readonly geometry = new BufferGeometry();
  private readonly material: ShaderMaterial;
  private readonly u = makeUniforms();
  private readonly positions = new Float32Array(MAX_NODES * 2 * 3);
  private readonly sides = new Float32Array(MAX_NODES * 2 * 3);
  private readonly across = new Float32Array(MAX_NODES * 2);
  private readonly dists = new Float32Array(MAX_NODES * 2);
  private readonly jitters = new Float32Array(MAX_NODES * 2);
  private readonly walks = new Float32Array(MAX_NODES * 2);
  private readonly maxWalks = new Float32Array(MAX_NODES * 2);
  private readonly ranks = new Float32Array(MAX_NODES * 2);
  private readonly indices = new Uint16Array(MAX_NODES * 6);
  // per node: unit position, heading and distance, so branches can hang off the arms
  private readonly nX = new Float32Array(MAX_NODES);
  private readonly nZ = new Float32Array(MAX_NODES);
  private readonly nAng = new Float32Array(MAX_NODES);
  private readonly nDist = new Float32Array(MAX_NODES);
  private readonly armFirst = new Int32Array(MAX_ARMS);
  private readonly armCount = new Int32Array(MAX_ARMS);
  private node = 0;
  private quad = 0;
  // lip records: dice and anchors only; metres come from the live look
  private readonly lipX = new Float32Array(MAX_LIPS);
  private readonly lipZ = new Float32Array(MAX_LIPS);
  private readonly lipSX = new Float32Array(MAX_LIPS);
  private readonly lipSZ = new Float32Array(MAX_LIPS);
  private readonly lipYaw = new Float32Array(MAX_LIPS);
  private readonly lipDist = new Float32Array(MAX_LIPS);
  private readonly lipSize = new Float32Array(MAX_LIPS);
  private readonly lipFlat = new Float32Array(MAX_LIPS);
  private readonly lipOffset = new Float32Array(MAX_LIPS);
  private readonly lipGround = new Float32Array(MAX_LIPS);
  private lipCount = 0;
  private readonly lipLife: InstancedBufferAttribute;

  /** `lipMaterial` must consume the instanced `aSeed` / `aLife` attributes the lip geometry carries (a MeteorMaterial). */
  constructor(lipMaterial: Material, renderOrder = 7) {
    const g = this.geometry;
    const attribute = (array: Float32Array, size: number): BufferAttribute => new BufferAttribute(array, size).setUsage(DynamicDrawUsage);
    g.setAttribute('position', attribute(this.positions, 3));
    g.setAttribute('aSide', attribute(this.sides, 3));
    g.setAttribute('aAcross', attribute(this.across, 1));
    g.setAttribute('aDist', attribute(this.dists, 1));
    g.setAttribute('aJit', attribute(this.jitters, 1));
    g.setAttribute('aWalk', attribute(this.walks, 1));
    g.setAttribute('aMaxWalk', attribute(this.maxWalks, 1));
    g.setAttribute('aRank', attribute(this.ranks, 1));
    g.setIndex(new BufferAttribute(this.indices, 1).setUsage(DynamicDrawUsage));
    g.setDrawRange(0, 0);
    g.boundingSphere = new Sphere(new Vector3(), 1e4);
    for (let i = 0; i < MAX_NODES * 2; i++) this.across[i] = i % 2 === 0 ? -1 : 1;

    this.material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      // additive, premultiplied in the shader: core and underglow add into the same fragment
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneFactor,
      blendSrcAlpha: OneFactor,
      blendDstAlpha: OneFactor,
      side: DoubleSide,
      toneMapped: false,
      // keeps the ribbon above a coarse terrain triangulation
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      uniforms: { ...this.u },
      vertexShader: FISSURE_VERTEX,
      fragmentShader: FISSURE_FRAGMENT,
    });
    this.ribbon = new Mesh(g, this.material);
    this.ribbon.frustumCulled = false;
    this.ribbon.renderOrder = renderOrder;
    this.ribbon.visible = false;

    // Few cuts: at this subdivision a heavily sliced rock flattens into a pebble, and these want to read as blocks of crust
    // shouldered out of the ground.
    const lipGeometry = createAsteroidGeometry({ seed: 4.2, detail: 1, lumpiness: 0.34, cuts: 3, cutDepth: 0.16, craters: 2 });
    const seeds = new InstancedBufferAttribute(new Float32Array(MAX_LIPS), 1);
    for (let i = 0; i < MAX_LIPS; i++) (seeds.array as Float32Array)[i] = hash11(i * 3.7 + 1.3) * 10;
    this.lipLife = new InstancedBufferAttribute(new Float32Array(MAX_LIPS), 1);
    lipGeometry.setAttribute('aSeed', seeds);
    lipGeometry.setAttribute('aLife', this.lipLife);
    this.lips = new InstancedMesh(lipGeometry, lipMaterial, MAX_LIPS);
    this.lips.frustumCulled = false;
    this.lips.count = 0;
    this.lips.visible = false;
  }

  /** Palette (0xRRGGBB sRGB) → HDR band colours: seam (scorched stone), red (edge), orange (body), white (core). */
  setPalette(smoke: number, edge: number, main: number, core: number): void {
    const u = this.u;
    putHex(u.uColorSeam.value, smoke).multiplyScalar(0.06);
    putHex(u.uColorRed.value, edge).multiplyScalar(1.5);
    putHex(u.uColorOrange.value, main).multiplyScalar(1.9);
    putHex(u.uColorWhite.value, core).multiplyScalar(2.8);
  }

  /**
   * Generates a fresh network in unit space (seeded), follows the terrain under it and arms the front at the impact.
   * `maxLips` caps the basalt (0 hides the lips mesh).
   */
  start(seed: number, cx: number, cy: number, cz: number, floorAt: FloorAt, maxLips: number): void {
    const look = this.look;
    this.age = 0;
    this.ribbon.position.set(cx, cy, cz);
    this.lips.position.set(0, 0, 0);
    this.generate(seed, Math.max(2, Math.min(MAX_ARMS, Math.round(look.arms))), look.wander);
    this.groundNodes(cx, cy, cz, look.radius, floorAt);
    this.groundLips(cx, cz, look.radius, floorAt, maxLips);
    this.ribbon.visible = true;
    this.lips.visible = this.lipCount > 0;
    this.step(0);
  }

  /** Walks one crack across the floor, laying nodes into the buffers. */
  private walk(startX: number, startZ: number, heading: number, length: number, rank: number, originDist: number, widthScale: number): void {
    let x = startX;
    let z = startZ;
    let angle = heading;
    let jitter = 1;
    const curvature = rollRange(-this.look.wander, this.look.wander);
    const first = this.node;

    for (let travelled = 0; travelled <= length && this.node < MAX_NODES; travelled += STEP) {
      // Smoothed random walk → organic width variation baked per node.
      jitter = clamp(jitter + rollRange(-0.18, 0.18), 0.6, 1.45);
      const dist = saturate(originDist + travelled);
      // A crack terminates in a needle, not a rounded cap.
      const tip = Math.pow(saturate((length - travelled) / 0.22), 0.65);
      const width = jitter * widthScale * (rank > 0 ? 0.62 : tip);
      const n = this.node;
      const sx = Math.cos(angle + Math.PI / 2);
      const sz = Math.sin(angle + Math.PI / 2);
      for (let k = 0; k < 2; k++) {
        const i = n * 2 + k;
        this.positions[i * 3] = x;
        this.positions[i * 3 + 1] = 0;
        this.positions[i * 3 + 2] = z;
        this.sides[i * 3] = sx;
        this.sides[i * 3 + 1] = 0;
        this.sides[i * 3 + 2] = sz;
        this.dists[i] = dist;
        this.jitters[i] = width;
        this.walks[i] = rank > 0 ? travelled : 0;
        this.maxWalks[i] = rank > 0 ? length : 1;
        this.ranks[i] = rank;
      }
      this.nX[n] = x;
      this.nZ[n] = z;
      this.nAng[n] = angle;
      this.nDist[n] = dist;
      this.node++;

      x += Math.cos(angle) * STEP;
      z += Math.sin(angle) * STEP;
      // Veer, plus a little high-frequency stagger so the line is never smooth.
      angle += curvature * STEP + rollRange(-0.35, 0.35) * STEP;
      // ... but pull it back toward its launch bearing, or a steady veer curls an arm into a circle instead of driving it away.
      angle = lerp(angle, heading, 0.05);
    }

    // Stitch this run into the index buffer. Separate runs are never joined.
    for (let i = first; i < this.node - 1; i++) {
      const a = i * 2;
      const o = this.quad * 6;
      this.indices[o] = a;
      this.indices[o + 1] = a + 1;
      this.indices[o + 2] = a + 2;
      this.indices[o + 3] = a + 1;
      this.indices[o + 4] = a + 3;
      this.indices[o + 5] = a + 2;
      this.quad++;
    }
  }

  private generate(seed: number, arms: number, wander: number): void {
    diceSeed = seed * 57.3 + 11.1;
    diceN = 0;
    this.node = 0;
    this.quad = 0;
    void wander;

    const spin = roll() * TAU;
    for (let i = 0; i < arms; i++) {
      // Uneven spacing: equal angles read as a star however much they meander.
      const heading = spin + (i / arms) * TAU + rollRange(-0.45, 0.45);
      const length = rollRange(0.6, 1.0);
      // Start just outside the crater mouth rather than at a single point.
      const r0 = rollRange(0.04, 0.12);
      this.armFirst[i] = this.node;
      this.walk(Math.cos(heading) * r0, Math.sin(heading) * r0, heading, length, 0, r0, 1);
      this.armCount[i] = this.node - (this.armFirst[i] as number);
    }

    // branches, hung off the arms
    for (let b = 0; b < MAX_BRANCHES; b++) {
      const arm = Math.floor(roll() * arms);
      const count = this.armCount[arm] as number;
      if (count < 4) continue;
      const at = (this.armFirst[arm] as number) + Math.floor(rollRange(1, count - 1));
      const side = roll() < 0.5 ? 1 : -1;
      // 32°–72° off the parent, like a lightning fork
      const heading = (this.nAng[at] as number) + side * rollRange(0.55, 1.25);
      this.walk(this.nX[at] as number, this.nZ[at] as number, heading, rollRange(0.18, 0.42), (b + 1) / MAX_BRANCHES, this.nDist[at] as number, 0.8);
    }

    this.geometry.setDrawRange(0, this.quad * 6);
    const attrs = this.geometry.attributes;
    for (const name of ['position', 'aSide', 'aAcross', 'aDist', 'aJit', 'aWalk', 'aMaxWalk', 'aRank']) {
      (attrs[name] as BufferAttribute).needsUpdate = true;
    }
    (this.geometry.index as BufferAttribute).needsUpdate = true;
  }

  /** y of every node = terrain under it relative to the impact point, plus a small lift */
  private groundNodes(cx: number, cy: number, cz: number, radius: number, floorAt: FloorAt): void {
    for (let n = 0; n < this.node; n++) {
      const y = floorAt(cx + (this.nX[n] as number) * radius, cz + (this.nZ[n] as number) * radius) - cy + 0.035;
      this.positions[n * 6 + 1] = y;
      this.positions[n * 6 + 4] = y;
    }
  }

  /** basalt along the lips of the main arms */
  private groundLips(cx: number, cz: number, radius: number, floorAt: FloorAt, maxLips: number): void {
    let lip = 0;
    const cap = Math.min(MAX_LIPS, Math.max(0, Math.round(maxLips)));
    const arms = Math.max(2, Math.min(MAX_ARMS, Math.round(this.look.arms)));
    for (let a = 0; a < arms && lip < cap; a++) {
      const count = this.armCount[a] as number;
      for (let i = 2; i < count && lip < cap; i += 3) {
        const n = (this.armFirst[a] as number) + i;
        const ang = this.nAng[n] as number;
        const flip = i % 6 === 2 ? 1 : -1;
        this.lipX[lip] = this.nX[n] as number;
        this.lipZ[lip] = this.nZ[n] as number;
        this.lipSX[lip] = Math.cos(ang + Math.PI / 2) * flip;
        this.lipSZ[lip] = Math.sin(ang + Math.PI / 2) * flip;
        this.lipYaw[lip] = ang + rollRange(-0.5, 0.5);
        this.lipDist[lip] = this.nDist[n] as number;
        this.lipSize[lip] = roll();
        this.lipFlat[lip] = roll();
        this.lipOffset[lip] = roll();
        this.lipGround[lip] = floorAt(cx + (this.nX[n] as number) * radius, cz + (this.nZ[n] as number) * radius);
        lip++;
      }
    }
    this.lipCount = lip;
  }

  /** True once the cracks have closed. */
  get done(): boolean {
    return this.age >= this.look.life;
  }

  /** Advances to `age` seconds after the impact and pushes the live look into the material and the lips. */
  step(age: number): void {
    this.age = age;
    const look = this.look;
    const u = this.u;
    const t = saturate(age / Math.max(look.life, 0.2));
    // the front races out from the impact and keeps going past the longest crack (so its white flash leaves the network), then
    // the lips sink back as it dies
    const grown = Math.min(1.4, Math.max(0, (age * look.growth) / Math.max(0.05, look.radius)));
    const sink = Easing.inCubic(saturate((t - 0.82) / 0.18));
    // the melt cools long before the crack closes, then the whole thing fades
    const heat = look.heat * (1 - Easing.inQuad(saturate((t - 0.25) / 0.75)));
    const fade = 1 - Easing.inQuad(saturate((t - 0.7) / 0.3));

    u.uRadius.value = look.radius;
    u.uWidth.value = look.width * 4.6 + 0.2;
    u.uCoreRatio.value = (look.width * 4.6 + 0.2) / look.width;
    u.uBranchFrac.value = saturate(look.branches);
    u.uLenFrac.value = saturate(look.branchLength);
    u.uGrown.value = grown;
    u.uHeat.value = heat;
    u.uPulse.value = look.pulse;
    u.uFade.value = fade;
    this.ribbon.visible = fade > 0.004;

    this.poseLips(grown, sink, t);
  }

  private poseLips(grown: number, sink: number, t: number): void {
    const look = this.look;
    const radius = look.radius;
    const life = this.lipLife.array as Float32Array;
    let used = 0;
    for (let i = 0; i < this.lipCount; i++) {
      // chunks are heaved up as the crack front passes them
      const emerge = saturate((grown - (this.lipDist[i] as number)) / 0.18);
      const size = look.lipSize * lerp(0.55, 1.35, this.lipSize[i] as number);
      if (emerge <= 0) {
        _dummy.position.set(0, -999, 0);
        _dummy.scale.setScalar(0.0001);
        _dummy.quaternion.identity();
      } else {
        const flat = this.lipFlat[i] as number;
        const out = look.width * 0.55 + (this.lipOffset[i] as number) * look.width * 0.6 + size * 0.15;
        _dummy.position.set(
          (this.lipX[i] as number) * radius + (this.lipSX[i] as number) * out + this.ribbon.position.x,
          // sunk well in, so only the top ridge breaks through: broken crust, not pebbles scattered on a floor
          (this.lipGround[i] as number) - size * lerp(0.3, 0.6, flat) - sink * (size * 2 + 0.4),
          (this.lipZ[i] as number) * radius + (this.lipSZ[i] as number) * out + this.ribbon.position.z,
        );
        _dummy.rotation.set(0, this.lipYaw[i] as number, 0);
        const grow = Easing.outBack(emerge);
        _dummy.scale.set(size * grow, size * lerp(0.45, 0.85, flat) * grow, size * 0.8 * grow);
      }
      _dummy.updateMatrix();
      this.lips.setMatrixAt(i, _dummy.matrix);
      life[i] = t;
      used = i + 1;
    }
    this.lips.count = used;
    this.lips.instanceMatrix.needsUpdate = true;
    this.lipLife.needsUpdate = true;
  }

  /** Hides both meshes. */
  hide(): void {
    this.ribbon.visible = false;
    this.lips.visible = false;
    this.lips.count = 0;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.lips.geometry.dispose();
    this.lips.dispose();
    this.ribbon.parent?.remove(this.ribbon);
    this.lips.parent?.remove(this.lips);
  }
}
