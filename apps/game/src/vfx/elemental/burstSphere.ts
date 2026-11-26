// Ported from threejs-vfx src/effects/BurstSphere.js (MIT, © mohamedachrefelouafi — see ./LICENSE).
// Expanding shells for impacts: a noise-displaced icosphere whose fragment shader has one compile-time look per mode (fireball,
// splash dome, pressure shell, dust ball, freezing vapour, ionised air). The sandbox spawns one mesh per burst; here a pool is a
// single instanced draw call and a shell's whole animation (growth, billow, dissolve) is a function of (clock − birth) / life
// evaluated on the GPU. Colours are shared by the pool (one palette per cast); everything else is per shell.
//
//   const shells = new BurstSphere(BurstMode.STORM, 6);   // capacity
//   root.add(shells.mesh);                                // once, in the effect's build()
//   shells.setColors(0x2f7fff, 0xc9ecff, 0xffffff);
//   shells.begin(x, y + 0.05, z).radius(0.4, 3).life(0.7).int(1.4).emit();
//   shells.update(dt);                                    // every frame
import {
  AdditiveBlending,
  BufferAttribute,
  Color,
  DoubleSide,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
  Sphere,
  Vector3,
} from 'three';
import { putHex } from './color';
import { sharedUniforms } from './frame';
import { commonGLSL } from './glsl/common';
import { noiseGLSL } from './glsl/noise';

export const BurstMode = {
  /** billowing fireball */
  FIRE: 0,
  /** splash dome, fresnel heavy */
  WATER: 1,
  /** thin pressure shell */
  AIR: 2,
  /** dense dust ball */
  EARTH: 3,
  /** shell of freezing vapour tearing into plates */
  FROST: 4,
  /** ionised air, filaments racing over a near-invisible shell */
  STORM: 5,
} as const;
export type BurstMode = (typeof BurstMode)[keyof typeof BurstMode];

const DEAD = -1e9;

const BURST_VERTEX = /* glsl */ `
  attribute vec3 aPos;   // centre, world metres
  attribute vec4 aA;     // radius at birth, radius at death, birth s, life s
  attribute vec4 aB;     // seed, intensity, opacity, fresnel
  attribute vec2 aC;     // displace, squash

  uniform float uClock;

  varying vec3  vNormalW;
  varying vec3  vViewDir;
  varying float vDisp;
  varying float vAge;
  varying vec4  vB;
  varying float vViewZ;

  ${noiseGLSL}

  void main() {
    float age = (uClock - aA.z) / max(aA.w, 1e-3);
    // Not born yet, or already gone: park the whole sphere outside the clip volume before any noise is spent on it.
    if (age < 0.0 || age > 1.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    vAge = age;
    vB = aB;

    // Billowing surface pushed along the normal, scrolling outward as the burst expands. The sandbox sums four octaves on a
    // 500-triangle sphere, whose vertex spacing drops the top two; here the mesh is dense enough to resolve all four and they
    // crumple the shell into paper, so the soft lobes (two octaves) and one rounded crease are what is evaluated.
    vec3 np = normal * (1.6 + age * 1.4) + vec3(aB.x * 13.0) - vec3(0.0, uClock * 0.6, 0.0);
    float crease = snoise(np * 1.3);
    float n = (snoise(np) * 0.5 + snoise(np * 2.03 + vec3(17.3, 5.1, 9.7)) * 0.25) * 0.6 + (1.0 - sqrt(crease * crease + 0.05)) * 1.29 * 0.4;
    vDisp = n;

    float amount = aC.x * (0.35 + age * 0.9);
    vec3 pos = position + normal * n * amount;

    // Fast expansion that eases out — the classic explosion silhouette.
    float e = 1.0 - pow(1.0 - age, 5.0);
    float scale = mix(aA.x, aA.y, e);
    pos *= vec3(scale, scale * aC.y, scale);

    vec3 world = aPos + pos;
    vNormalW = normalize(vec3(normal.x, normal.y * aC.y, normal.z));
    vViewDir = cameraPosition - world;

    vec4 mv = viewMatrix * vec4(world, 1.0);
    vViewZ = mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const BURST_FRAGMENT = /* glsl */ `
  uniform float uClock;
  uniform vec3  uColorA;
  uniform vec3  uColorB;
  uniform vec3  uColorC;
  uniform float uGlobalGlow;
  uniform float uShaderIntensity;
  uniform vec2  uResolution;
  uniform sampler2D uSceneDepth;
  uniform float uCameraNear;
  uniform float uCameraFar;

  varying vec3  vNormalW;
  varying vec3  vViewDir;
  varying float vDisp;
  varying float vAge;
  varying vec4  vB;
  varying float vViewZ;

  ${noiseGLSL}
  ${commonGLSL}

  void main() {
    float uAge = vAge;
    float uSeed = vB.x;
    float fres = fresnelTerm(vViewDir, vNormalW, 2.2, 1.0) * vB.w;
    float heat = clamp(vDisp * 0.5 + 0.5, 0.0, 1.0);

    // Dissolve the shell away over the burst's life.
    vec2 dis = dissolveMask(heat, uAge * 1.15 - 0.15, 0.3);

    float alpha = vB.z;
    vec3 color;

    #if BURST_MODE == 0                     /* FIRE */
      color = gradient4(uColorA, uColorB, uColorC, uColorC * 0.15, 1.0 - heat);
      color += dis.y * uColorA * 3.0;
      alpha *= (1.0 - uAge) * (0.55 + fres * 0.8) * dis.x;

    #elif BURST_MODE == 1                   /* WATER */
      // A splash dome is water with foam riding on it: the billowing noise the vertex stage already computed doubles as the
      // foam mask, so the crests of the dome go white and opaque while the troughs stay deep and glassy.
      float crestFoam = smoothstep(0.5, 0.95, heat);
      float bubbles = smoothstep(0.55, 0.05, voronoi2(vNormalW.xy * 11.0 + vNormalW.z * 4.0 + uSeed).x);
      color = mix(uColorA, uColorB, heat * 0.85);
      color = mix(color, uColorC * (0.75 + 0.5 * bubbles), crestFoam);
      color += uColorC * fres * 0.9;
      alpha *= (1.0 - uAge) * (0.2 + fres * 0.85 + crestFoam * 0.8) * dis.x;

    #elif BURST_MODE == 2                   /* AIR */
      color = mix(uColorA, uColorB, fres);
      alpha *= (1.0 - uAge) * fres * 0.85 * dis.x;

    #elif BURST_MODE == 3                   /* EARTH */
      color = mix(uColorA, uColorB, heat * 0.8);
      alpha *= (1.0 - uAge) * (0.5 + heat * 0.4) * dis.x;

    #elif BURST_MODE == 4                   /* FROST */
      // Freezing vapour rather than an explosion: the billowing noise is reused as a crystallisation mask, so the shell goes
      // glassy and opaque in plates and stays clear between them — it tears apart as it expands instead of fading as a ball.
      float plates = smoothstep(0.42, 0.95, heat);
      float rime = smoothstep(0.55, 0.05, voronoi2(vNormalW.xy * 9.0 + vNormalW.z * 3.0 + uSeed).x);
      color = mix(uColorA, uColorB, heat * 0.9);
      color = mix(color, uColorC * (0.7 + 0.6 * rime), plates);
      color += uColorC * fres * 1.3;
      alpha *= (1.0 - uAge) * (0.16 + fres * 0.95 + plates * 0.7) * dis.x;

    #else                                   /* STORM */
      // Ionised air, not a fireball. The shell has to stay *empty*: the body of it contributes almost nothing, and what you see
      // is thin filaments racing over the surface plus the fresnel rim. Ridged noise scrolling in the normal direction gives
      // branching arcs that skate across it as it expands. Thresholded hard on purpose — a wide band here fills the shell in and
      // it immediately reads as a rock.
      float fil = ridged(vNormalW * (5.0 + uAge * 7.0) + vec3(uSeed * 9.0) + vec3(0.0, uClock * 3.4, 0.0), 4);
      float arcs = smoothstep(0.80, 0.97, fil) * (1.0 - uAge * 0.6);
      float rim = pow(max(fres, 0.0), 1.6);
      color = mix(uColorA, uColorB, heat * 0.5);
      color = mix(color, uColorC, arcs);
      color += uColorC * rim * 1.2 + uColorC * arcs * 2.4;
      // The sandbox cuts the shell away with a hard threshold on the interpolated vertex noise, which on a dense mesh leaves
      // triangular flakes; noise per fragment and a soft edge let it fray into specks instead.
      float fine = snoise01(vNormalW * 5.0 + vec3(uSeed * 7.0));
      float thr = uAge * 1.15 - 0.15;
      float keep = smoothstep(thr - 0.1, thr + 0.1, mix(heat, fine, 0.5));
      alpha *= (1.0 - uAge) * (rim * 0.55 + arcs * 0.9) * keep;
    #endif

    alpha = clamp(alpha, 0.0, 1.0);
    vec2 screenUV = gl_FragCoord.xy / uResolution;
    alpha *= softFade(uSceneDepth, screenUV, vViewZ, uCameraNear, uCameraFar, 0.6);
    if (alpha < 0.004) discard;

    color *= vB.y * uGlobalGlow * mix(0.7, 1.0, uShaderIntensity);
    gl_FragColor = vec4(color, alpha);
  }
`;

export class BurstSphere {
  readonly mesh: Mesh;
  private readonly geometry: InstancedBufferGeometry;
  private readonly material: ShaderMaterial;
  private readonly uClock = { value: 0 };
  private readonly colorA = { value: new Color(1, 0.9, 0.6) };
  private readonly colorB = { value: new Color(1, 0.45, 0.1) };
  private readonly colorC = { value: new Color(0.4, 0.08, 0.03) };
  private readonly pos: Float32Array;
  private readonly a: Float32Array;
  private readonly b: Float32Array;
  private readonly c: Float32Array;
  private readonly attrs: InstancedBufferAttribute[] = [];
  private readonly capacity: number;
  private cursor = 0;
  private clock = 0;
  private liveUntil = 0;

  // the shell being described by the builder
  private bx = 0;
  private by = 0;
  private bz = 0;
  private bR0 = 0.4;
  private bR1 = 3;
  private bLife = 0.9;
  private bDelay = 0;
  private bInt = 1;
  private bOpacity = 1;
  private bFresnel = 1;
  private bDisplace = 0.45;
  private bSquash = 1;
  private bSeed = -1;

  /**
   * @param capacity shells that may be alive at once (a ring: the oldest is overwritten)
   * @param detail   icosphere detail: every edge is split into `detail + 1` segments, 20·(detail + 1)² triangles (10 = 2420)
   * @param renderOrder additive shell: draws after the batched alpha layers (35–44), which would otherwise darken it
   */
  constructor(mode: BurstMode, capacity: number, detail = 10, renderOrder = 44) {
    const n = capacity;
    this.capacity = n;
    this.pos = new Float32Array(n * 3);
    this.a = new Float32Array(n * 4);
    this.b = new Float32Array(n * 4);
    this.c = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      this.a[i * 4 + 2] = DEAD;
      this.a[i * 4 + 3] = 1;
    }

    const ico = new IcosahedronGeometry(1, detail);
    const g = new InstancedBufferGeometry();
    g.setAttribute('position', ico.getAttribute('position') as BufferAttribute);
    g.setAttribute('normal', ico.getAttribute('normal') as BufferAttribute);
    this.instanced(g, 'aPos', this.pos, 3);
    this.instanced(g, 'aA', this.a, 4);
    this.instanced(g, 'aB', this.b, 4);
    this.instanced(g, 'aC', this.c, 2);
    g.instanceCount = n;
    g.boundingSphere = new Sphere(new Vector3(), 1e4); // placed in world space by the vertex shader
    this.geometry = g;

    this.material = new ShaderMaterial({
      defines: { BURST_MODE: mode },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: AdditiveBlending,
      side: DoubleSide,
      toneMapped: false,
      uniforms: { ...sharedUniforms({ uClock: this.uClock, uColorA: this.colorA, uColorB: this.colorB, uColorC: this.colorC }) },
      vertexShader: BURST_VERTEX,
      fragmentShader: BURST_FRAGMENT,
    });
    this.mesh = new Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = renderOrder;
  }

  private instanced(g: InstancedBufferGeometry, name: string, array: Float32Array, size: number): void {
    const attribute = new InstancedBufferAttribute(array, size);
    g.setAttribute(name, attribute);
    this.attrs.push(attribute);
  }

  /** shell body gradient, 0xRRGGBB: A→B is mixed across the billowing noise; C carries the read (filaments, rim) */
  setColors(a: number, b: number, c: number): void {
    putHex(this.colorA.value, a);
    putHex(this.colorB.value, b);
    putHex(this.colorC.value, c);
  }

  /** true while a shell is alive or waiting for its delay */
  get busy(): boolean {
    return this.liveUntil > this.clock;
  }

  /** Starts describing a shell centred on (x, y, z). Finish the chain with `emit()`. */
  begin(x: number, y: number, z: number): this {
    this.bx = x;
    this.by = y;
    this.bz = z;
    return this;
  }

  /** radius at birth and at death, metres (it eases out from one to the other) */
  radius(r0: number, r1: number): this {
    this.bR0 = r0;
    this.bR1 = r1;
    return this;
  }

  life(s: number): this {
    this.bLife = Math.max(0.05, s);
    return this;
  }

  /** seconds from now until it appears */
  delay(s: number): this {
    this.bDelay = s;
    return this;
  }

  /** emissive gain */
  int(i: number): this {
    this.bInt = i;
    return this;
  }

  opacity(o: number): this {
    this.bOpacity = o;
    return this;
  }

  /** rim strength */
  fresnel(f: number): this {
    this.bFresnel = f;
    return this;
  }

  /** how far the billowing noise pushes the surface, as a fraction of the radius */
  displace(d: number): this {
    this.bDisplace = d;
    return this;
  }

  /** vertical scale (< 1 flattens it into a dome) */
  squash(s: number): this {
    this.bSquash = s;
    return this;
  }

  /** noise seed, 0..10 (default random) */
  seed(s: number): this {
    this.bSeed = s;
    return this;
  }

  /** Writes the shell into the ring (overwriting the oldest) and resets the builder. */
  emit(): void {
    const i = this.cursor;
    this.cursor = (i + 1) % this.capacity;
    this.pos[i * 3] = this.bx;
    this.pos[i * 3 + 1] = this.by;
    this.pos[i * 3 + 2] = this.bz;
    const o = i * 4;
    const birth = this.clock + this.bDelay;
    this.a[o] = this.bR0;
    this.a[o + 1] = this.bR1;
    this.a[o + 2] = birth;
    this.a[o + 3] = this.bLife;
    this.b[o] = this.bSeed >= 0 ? this.bSeed : Math.random() * 10;
    this.b[o + 1] = this.bInt;
    this.b[o + 2] = this.bOpacity;
    this.b[o + 3] = this.bFresnel;
    this.c[i * 2] = this.bDisplace;
    this.c[i * 2 + 1] = this.bSquash;
    for (let k = 0; k < this.attrs.length; k++) (this.attrs[k] as InstancedBufferAttribute).needsUpdate = true;
    this.liveUntil = Math.max(this.liveUntil, birth + this.bLife);
    this.mesh.visible = true;
    this.bR0 = 0.4;
    this.bR1 = 3;
    this.bLife = 0.9;
    this.bDelay = 0;
    this.bInt = 1;
    this.bOpacity = 1;
    this.bFresnel = 1;
    this.bDisplace = 0.45;
    this.bSquash = 1;
    this.bSeed = -1;
  }

  /** Advances the pool clock; with nothing alive the mesh is hidden (no draw call). */
  update(dt: number): void {
    this.clock += dt;
    this.uClock.value = this.clock;
    this.mesh.visible = this.liveUntil > this.clock;
  }

  clear(): void {
    for (let i = 0; i < this.capacity; i++) this.a[i * 4 + 2] = DEAD;
    for (let k = 0; k < this.attrs.length; k++) (this.attrs[k] as InstancedBufferAttribute).needsUpdate = true;
    this.liveUntil = 0;
    this.cursor = 0;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.parent?.remove(this.mesh);
  }
}
