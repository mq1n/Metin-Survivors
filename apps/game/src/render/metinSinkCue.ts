// r8 M8a (r7 judge MF5): the cue of a metin break piece that goes under a liquid. A piece that lands on lava or in deep water sinks out of
// sight (render/metin.ts applyPieceRest); before r8 it slid under the surface silently. Each sinking piece now throws a small burst at the
// surface: on lava hot embers that rise and cool, a brief orange flare and a pale heat-steam wisp; in water a crown of spray drops and a white
// mist puff. One pooled Points batch per blend (additive light, plain alpha for the pale steam / spray), so a break costs two draws at most
// and no allocation per cue; the pool and the particles per cue follow the quality tier (low keeps a token cue). Nothing darkens: every
// particle is light added to the frame or a pale, half-transparent wisp (no dark smoke, no screen tint, no caster darkening).
import { AdditiveBlending, BufferAttribute, BufferGeometry, Mesh, NormalBlending, Points, ShaderMaterial, Vector2, type Object3D, type WebGLRenderer } from 'three';
import type { QualityTier } from './quality';

/** what a piece sank into (render/metin.ts metinLiquidAt) */
export const SINK_LAVA = 1;
export const SINK_WATER = 2;

/** particles per pool (additive / alpha) by tier: every cue reuses the oldest slot once a pool is full */
export const SINK_POOL: Readonly<Record<QualityTier, number>> = { low: 48, medium: 96, high: 160, ultra: 192 };
/** share of a cue's particles each tier emits (the flare and one wisp always come) */
export const SINK_SHARE: Readonly<Record<QualityTier, number>> = { low: 0.34, medium: 0.67, high: 1, ultra: 1 };
/** cues one break may throw (a great metin drops 40 pieces into a lava trench at once: the first ones tell the story) */
export const SINK_CUES_PER_BREAK = 10;

const VERT = /* glsl */ `
attribute vec4 aColor;
attribute float aSize;
uniform float uPx;
varying vec4 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  // world size (m) -> pixels: projectionMatrix[1][1] = 1 / tan(fov / 2), uPx = half the drawing buffer height
  gl_PointSize = aColor.a > 0.0 ? clamp(aSize * projectionMatrix[1][1] * uPx / max(-mv.z, 0.1), 1.0, 96.0) : 0.0;
  vColor = aColor;
}`;
const FRAG = /* glsl */ `
varying vec4 vColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = dot(d, d) * 4.0;
  if (r >= 1.0) discard;
  float a = vColor.a * (1.0 - r) * (1.0 - r);
  gl_FragColor = vec4(vColor.rgb * a, a);
}`;

interface Pool {
  points: Points;
  pos: Float32Array;
  col: Float32Array;
  size: Float32Array;
  /** per particle: vx, vy, vz, age, life, size0, size1, gravity, drag, r, g, b, a0, cool (1 = an ember: the green and blue fade with age) */
  st: Float32Array;
  next: number;
  alive: number;
}
const ST = 14;

function makePool(n: number, additive: boolean): Pool {
  const g = new BufferGeometry();
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 4), size = new Float32Array(n);
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('aColor', new BufferAttribute(col, 4));
  g.setAttribute('aSize', new BufferAttribute(size, 1));
  const mat = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: { uPx: { value: 540 } },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    // premultiplied in the shader: additive = light only; the alpha pool blends pale wisps over the frame (never darker than the wisp colour)
    blending: additive ? AdditiveBlending : NormalBlending,
    premultipliedAlpha: true,
  });
  const points = new Points(g, mat);
  points.frustumCulled = false;
  points.renderOrder = 6;
  points.name = additive ? 'metinSinkCue.add' : 'metinSinkCue.alpha';
  return { points, pos, col, size, st: new Float32Array(n * ST), next: 0, alive: 0 };
}

/** r9 M9b: rings per ring pool (a readable cue lays one expanding ring on the liquid per sinking piece; the oldest is reused) */
export const SINK_RINGS = 12;
const RING_VERT = /* glsl */ `
attribute vec2 aCorner;
attribute vec4 aRing;
attribute vec4 aRingCol;
varying vec2 vC;
varying vec4 vCol;
varying float vW;
void main() {
  vC = aCorner;
  vCol = aRingCol;
  vW = aRing.w;
  vec3 p = vec3(aRing.x + aCorner.x * aRing.w, aRing.y, aRing.z + aCorner.y * aRing.w);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const RING_FRAG = /* glsl */ `
varying vec2 vC;
varying vec4 vCol;
varying float vW;
void main() {
  float d = length(vC);
  if (d >= 1.0 || vCol.a <= 0.0) discard;
  // a soft band at the rim (its width a share of the radius, at least 6 cm) with a faint fill inside
  float bw = max(0.22, 0.08 / max(vW, 0.1));
  float band = smoothstep(1.0 - bw * 2.2, 1.0 - bw * 0.9, d) * (1.0 - smoothstep(1.0 - bw * 0.5, 1.0, d));
  float a = vCol.a * (band * 0.8 + 0.18 * (1.0 - d) * (1.0 - d));
  gl_FragColor = vec4(vCol.rgb * a, a);
}`;
interface RingPool { mesh: Mesh; ring: Float32Array; col: Float32Array; st: Float32Array; next: number; alive: number }
/** per ring: age, life, r0, r1, r, g, b, a0 */
const RST = 8;
function makeRings(n: number, additive: boolean): RingPool {
  const g = new BufferGeometry();
  const corner = new Float32Array(n * 4 * 2), ring = new Float32Array(n * 4 * 4), col = new Float32Array(n * 4 * 4), idx: number[] = [];
  const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (let i = 0; i < n; i++) {
    cs.forEach((c, k) => { corner[(i * 4 + k) * 2] = c[0]!; corner[(i * 4 + k) * 2 + 1] = c[1]!; });
    idx.push(i * 4, i * 4 + 2, i * 4 + 1, i * 4, i * 4 + 3, i * 4 + 2);
  }
  g.setAttribute('position', new BufferAttribute(new Float32Array(n * 4 * 3), 3));
  g.setAttribute('aCorner', new BufferAttribute(corner, 2));
  g.setAttribute('aRing', new BufferAttribute(ring, 4));
  g.setAttribute('aRingCol', new BufferAttribute(col, 4));
  g.setIndex(idx);
  const mat = new ShaderMaterial({ vertexShader: RING_VERT, fragmentShader: RING_FRAG, transparent: true, depthWrite: false, depthTest: true, blending: additive ? AdditiveBlending : NormalBlending, premultipliedAlpha: true });
  const mesh = new Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  mesh.name = additive ? 'metinSinkRing.add' : 'metinSinkRing.alpha';
  return { mesh, ring, col, st: new Float32Array(n * RST), next: 0, alive: 0 };
}

/** a deterministic small random stream (cues replay identically in captures) */
function rng(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export class MetinSinkCue {
  private add: Pool;
  private alpha: Pool;
  /** r9 M9b: the readable cue's rings on the liquid (lava: additive orange, water: pale foam) */
  private ringAdd: RingPool;
  private ringAlpha: RingPool;
  private tier: QualityTier;
  private seed = 1;
  private readonly px = new Vector2();
  /** drawn even when empty until `release` (the run's warm-up compiles both programs behind the loading screen, never at the first sinking piece) */
  private hold = true;

  constructor(private readonly parent: Object3D, tier: QualityTier) {
    this.tier = tier;
    this.add = makePool(SINK_POOL[tier], true);
    this.alpha = makePool(SINK_POOL[tier], false);
    parent.add(this.add.points, this.alpha.points);
    this.ringAdd = makeRings(SINK_RINGS, true);
    this.ringAlpha = makeRings(SINK_RINGS, false);
    parent.add(this.ringAdd.mesh, this.ringAlpha.mesh);
  }

  /** a tier change resizes the pools (live particles are dropped: a cue lasts about a second) */
  setTier(tier: QualityTier): void {
    if (tier === this.tier) return;
    this.tier = tier;
    for (const p of [this.add, this.alpha]) { this.parent.remove(p.points); p.points.geometry.dispose(); (p.points.material as ShaderMaterial).dispose(); }
    this.add = makePool(SINK_POOL[tier], true);
    this.alpha = makePool(SINK_POOL[tier], false);
    this.parent.add(this.add.points, this.alpha.points);
  }

  /** the warm-up is done: an empty pool is no longer drawn */
  release(): void { this.hold = false; }

  /** particles alive in both pools (tests, perf HUD) */
  get alive(): number { return this.add.alive + this.alpha.alive; }
  /** r9 M9b: rings alive in both ring pools */
  get rings(): number { return this.ringAdd.alive + this.ringAlpha.alive; }

  private ring(p: RingPool, x: number, y: number, z: number, life: number, r0: number, r1: number, r: number, g: number, b: number, a: number): void {
    const n = p.st.length / RST, i = p.next;
    p.next = (i + 1) % n;
    const o = i * RST;
    if (!(p.st[o + 1]! > 0 && p.st[o]! < p.st[o + 1]!)) p.alive++;
    p.st.set([0, life, r0, r1, r, g, b, a], o);
    for (let k = 0; k < 4; k++) { p.ring.set([x, y, z, r0], (i * 4 + k) * 4); p.col.set([r, g, b, a], (i * 4 + k) * 4); }
  }

  private spawn(p: Pool, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, grav: number, drag: number, r: number, g: number, b: number, a: number, cool = 0): void {
    const n = p.size.length;
    if (n === 0) return;
    const i = p.next;
    p.next = (i + 1) % n;
    const o = i * ST;
    if (!(p.st[o + 4]! > 0 && p.st[o + 3]! < p.st[o + 4]!)) p.alive++;
    p.st.set([vx, vy, vz, 0, life, s0, s1, grav, drag, r, g, b, a, cool], o);
    p.pos[i * 3] = x; p.pos[i * 3 + 1] = y; p.pos[i * 3 + 2] = z;
    p.size[i] = s0;
    p.col[i * 4] = r; p.col[i * 4 + 1] = g; p.col[i * 4 + 2] = b; p.col[i * 4 + 3] = a;
  }

  /**
   * One sinking piece at the liquid surface (x, y, z): `kind` SINK_LAVA | SINK_WATER, `size` = the piece's size (m, about its radius).
   */
  emit(kind: number, x: number, y: number, z: number, size: number, readable: boolean | 'steam' = false): void {
    const R = rng(this.seed++), share = SINK_SHARE[this.tier], s = Math.min(1.6, Math.max(0.35, size));
    const count = (n: number): number => Math.max(1, Math.round(n * share));
    // r10 M10b: the steam cue of a sinkSteam stone (lava only; a piece going into water keeps the readable foam ring and splash)
    if (readable === 'steam' && kind === SINK_LAVA) { this.emitSteam(x, y, z, s, R, count); return; }
    if (readable) { this.emitReadable(kind, x, y, z, s, R, count); return; }
    if (kind === SINK_LAVA) {
      // the flare: one big soft orange light at the surface, gone in a third of a second
      this.spawn(this.add, x, y + 0.15, z, 0, 0.2, 0, 0.32, 1.6 * s, 2.4 * s, 0, 0, 1.0, 0.42, 0.1, 0.55);
      // embers: hot yellow-orange sparks thrown up, cooling to deep red as they slow
      for (let k = count(10); k > 0; k--) {
        const a = R() * 6.2832, h = 0.6 + R() * 1.6, v = 0.6 + R() * 1.1;
        this.spawn(this.add, x + Math.cos(a) * 0.2 * s, y + 0.05, z + Math.sin(a) * 0.2 * s, Math.cos(a) * v, 2.2 + h * 1.6, Math.sin(a) * v, 0.7 + R() * 0.6, 0.11 + 0.06 * R(), 0.04, 4.5, 0.9, 1.0, 0.62 + 0.25 * R(), 0.18, 0.95, 1);
      }
      // heat steam: pale, slow, half transparent (it lightens the trench a little, it never darkens it)
      for (let k = count(2); k > 0; k--) this.spawn(this.alpha, x + (R() - 0.5) * 0.4 * s, y + 0.2, z + (R() - 0.5) * 0.4 * s, (R() - 0.5) * 0.3, 0.9 + 0.5 * R(), (R() - 0.5) * 0.3, 1.1 + 0.4 * R(), 0.6 * s, 1.8 * s, -0.2, 1.2, 0.86, 0.8, 0.76, 0.22);
    } else if (kind === SINK_WATER) {
      // spray: a crown of drops out of the hole, falling back
      for (let k = count(12); k > 0; k--) {
        const a = R() * 6.2832, v = 0.9 + R() * 1.3;
        this.spawn(this.alpha, x + Math.cos(a) * 0.18 * s, y + 0.05, z + Math.sin(a) * 0.18 * s, Math.cos(a) * v, 2.6 + R() * 2.2, Math.sin(a) * v, 0.55 + R() * 0.35, 0.09 + 0.05 * R(), 0.05, 9.8, 0.4, 0.9, 0.95, 1.0, 0.75);
      }
      // the white splash column and a mist puff over the ring
      this.spawn(this.add, x, y + 0.2, z, 0, 1.2, 0, 0.28, 0.9 * s, 1.5 * s, 0, 0, 0.55, 0.62, 0.7, 0.35);
      for (let k = count(2); k > 0; k--) this.spawn(this.alpha, x + (R() - 0.5) * 0.5 * s, y + 0.15, z + (R() - 0.5) * 0.5 * s, (R() - 0.5) * 0.4, 0.5 + 0.3 * R(), (R() - 0.5) * 0.4, 0.9 + 0.3 * R(), 0.5 * s, 1.5 * s, -0.1, 1.5, 0.92, 0.95, 1.0, 0.28);
    }
  }

  /**
   * r9 M9b (r8 M8a critic: "the sink cue is generic and small ... at z22 it would be a few pixels"): the cue of a rest9 stone's piece. Lava: an expanding
   * molten ring on the surface, a big flare, an ember fountain (2-4 m) and a pale steam column; water: a foam ring, a splash column and a spray crown.
   * Everything still adds light or a pale wisp (nothing darkens).
   */
  private emitReadable(kind: number, x: number, y: number, z: number, s: number, R: () => number, count: (n: number) => number): void {
    // one ring per break moment, not per piece: a ring only where no live ring of the same pool is within 2.5 m (three pieces in one spot = one ring)
    const ringed = (p: RingPool): boolean => { for (let i = 0; i < p.st.length / RST; i++) { const o = i * RST; if (p.st[o + 1]! > 0 && p.st[o]! < 0.6 && Math.hypot(p.ring[i * 16]! - x, p.ring[i * 16 + 2]! - z) < 2.5) return true; } return false; };
    if (kind === SINK_LAVA) {
      if (!ringed(this.ringAdd)) this.ring(this.ringAdd, x, y + 0.06, z, 1.0, 0.45 * s + 0.2, 1.9 * s + 0.9, 1.0, 0.45, 0.12, 0.6);
      this.spawn(this.add, x, y + 0.25, z, 0, 0.3, 0, 0.55, 2.6 * s, 3.6 * s, 0, 0, 1.0, 0.45, 0.12, 0.7);
      for (let k = count(22); k > 0; k--) {
        const a = R() * 6.2832, v = 0.9 + R() * 1.8;
        this.spawn(this.add, x + Math.cos(a) * 0.3 * s, y + 0.1, z + Math.sin(a) * 0.3 * s, Math.cos(a) * v, 5.5 + R() * 4.5, Math.sin(a) * v, 0.8 + R() * 0.7, 0.18 + 0.12 * R(), 0.06, 9.0, 0.6, 1.0, 0.66 + 0.25 * R(), 0.2, 1.0, 1);
      }
      for (let k = count(4); k > 0; k--) this.spawn(this.alpha, x + (R() - 0.5) * 0.6 * s, y + 0.3, z + (R() - 0.5) * 0.6 * s, (R() - 0.5) * 0.3, 1.8 + 0.9 * R(), (R() - 0.5) * 0.3, 1.4 + 0.5 * R(), 0.9 * s, 2.6 * s, -0.3, 0.9, 0.9, 0.84, 0.78, 0.3);
    } else if (kind === SINK_WATER) {
      if (!ringed(this.ringAlpha)) this.ring(this.ringAlpha, x, y + 0.04, z, 1.0, 0.4 * s + 0.2, 1.7 * s + 0.8, 0.92, 0.97, 1.0, 0.6);
      this.spawn(this.add, x, y + 0.4, z, 0, 2.2, 0, 0.4, 1.4 * s, 2.2 * s, 2.0, 0, 0.6, 0.68, 0.76, 0.45);
      for (let k = count(24); k > 0; k--) {
        const a = R() * 6.2832, v = 1.0 + R() * 1.8;
        this.spawn(this.alpha, x + Math.cos(a) * 0.25 * s, y + 0.05, z + Math.sin(a) * 0.25 * s, Math.cos(a) * v, 3.6 + R() * 3.0, Math.sin(a) * v, 0.6 + R() * 0.4, 0.14 + 0.08 * R(), 0.06, 9.8, 0.4, 0.9, 0.96, 1.0, 0.85);
      }
      for (let k = count(3); k > 0; k--) this.spawn(this.alpha, x + (R() - 0.5) * 0.7 * s, y + 0.2, z + (R() - 0.5) * 0.7 * s, (R() - 0.5) * 0.5, 0.7 + 0.4 * R(), (R() - 0.5) * 0.5, 1.0 + 0.3 * R(), 0.8 * s, 2.2 * s, -0.1, 1.4, 0.93, 0.96, 1.0, 0.32);
    }
  }

  /**
   * r10 M10b (r9 M9b critic on daeryeol: "the sink cue is opaque white puff sprites and flat orange donut rings ... it sits round the hero's area and
   * reads like a hero effect; spawn translucent steam with rising sparks at each sinking piece"): at the piece, no ring on the lava. A small hot glow
   * where it goes under, a plume of thin translucent steam that rises and spreads for about two seconds (alpha 0.12-0.2, warm pale grey: it lightens,
   * never darkens), and fine sparks that climb out of the plume and cool as they go. Everything is anchored at the piece's own surface point.
   */
  private emitSteam(x: number, y: number, z: number, s: number, R: () => number, count: (n: number) => number): void {
    this.spawn(this.add, x, y + 0.12, z, 0, 0.15, 0, 0.32, 0.8 * s, 1.3 * s, 0, 0, 1.0, 0.48, 0.14, 0.42);
    for (let k = count(7); k > 0; k--) {
      const a = R() * 6.2832, d = R() * 0.25 * s;
      this.spawn(this.alpha, x + Math.cos(a) * d, y + 0.15 + R() * 0.2, z + Math.sin(a) * d, (R() - 0.5) * 0.35, 0.7 + 0.6 * R(), (R() - 0.5) * 0.35, 1.6 + 0.8 * R(), 0.35 * s + 0.1, 2.0 * s + 0.4, -0.25, 0.7, 0.9, 0.86, 0.82, 0.12 + 0.08 * R());
    }
    for (let k = count(16); k > 0; k--) {
      const a = R() * 6.2832, v = 0.2 + R() * 0.5;
      this.spawn(this.add, x + Math.cos(a) * 0.2 * s, y + 0.1, z + Math.sin(a) * 0.2 * s, Math.cos(a) * v, 1.6 + R() * 2.2, Math.sin(a) * v, 0.9 + R() * 0.8, 0.06 + 0.05 * R(), 0.03, 1.2, 0.9, 1.0, 0.62 + 0.28 * R(), 0.22, 0.95, 1);
    }
  }

  private updateRings(p: RingPool, dt: number): void {
    p.mesh.visible = this.hold || p.alive > 0;
    if (p.alive === 0) return;
    let alive = 0;
    const n = p.st.length / RST;
    for (let i = 0; i < n; i++) {
      const o = i * RST, life = p.st[o + 1]!;
      if (!(life > 0)) continue;
      const age = p.st[o]! + dt;
      if (age >= life) { p.st[o + 1] = 0; for (let k = 0; k < 4; k++) p.col[(i * 4 + k) * 4 + 3] = 0; continue; }
      alive++;
      p.st[o] = age;
      const t = age / life, e = 1 - (1 - t) * (1 - t);
      const r = p.st[o + 2]! + (p.st[o + 3]! - p.st[o + 2]!) * e, a = p.st[o + 7]! * (1 - t) * Math.min(1, t * 10 + 0.3);
      for (let k = 0; k < 4; k++) { p.ring[(i * 4 + k) * 4 + 3] = r; p.col[(i * 4 + k) * 4 + 3] = a; }
    }
    p.alive = alive;
    (p.mesh.geometry.getAttribute('aRing') as BufferAttribute).needsUpdate = true;
    (p.mesh.geometry.getAttribute('aRingCol') as BufferAttribute).needsUpdate = true;
  }

  update(dt: number, renderer: WebGLRenderer): void {
    this.updateRings(this.ringAdd, dt);
    this.updateRings(this.ringAlpha, dt);
    const h = typeof renderer.getDrawingBufferSize === 'function' ? renderer.getDrawingBufferSize(this.px).y * 0.5 : 540;
    for (const p of [this.add, this.alpha]) {
      (p.points.material as ShaderMaterial).uniforms.uPx!.value = h;
      p.points.visible = this.hold || p.alive > 0;
      if (p.alive === 0) continue;
      let alive = 0;
      const n = p.size.length;
      for (let i = 0; i < n; i++) {
        const o = i * ST, life = p.st[o + 4]!;
        if (!(life > 0)) continue;
        const age = p.st[o + 3]! + dt;
        if (age >= life) { p.st[o + 4] = 0; p.col[i * 4 + 3] = 0; continue; }
        alive++;
        p.st[o + 3] = age;
        const t = age / life, drag = Math.exp(-p.st[o + 8]! * dt);
        p.st[o] = p.st[o]! * drag; p.st[o + 2] = p.st[o + 2]! * drag;
        p.st[o + 1] = p.st[o + 1]! * drag - p.st[o + 7]! * dt;
        p.pos[i * 3] = p.pos[i * 3]! + p.st[o]! * dt;
        p.pos[i * 3 + 1] = p.pos[i * 3 + 1]! + p.st[o + 1]! * dt;
        p.pos[i * 3 + 2] = p.pos[i * 3 + 2]! + p.st[o + 2]! * dt;
        p.size[i] = p.st[o + 5]! + (p.st[o + 6]! - p.st[o + 5]!) * t;
        // embers cool (the green and blue go first), everything fades out over the second half of its life
        const cool = 1 - 0.55 * t * p.st[o + 13]!;
        p.col[i * 4] = p.st[o + 9]!;
        p.col[i * 4 + 1] = p.st[o + 10]! * cool;
        p.col[i * 4 + 2] = p.st[o + 11]! * cool * cool;
        p.col[i * 4 + 3] = p.st[o + 12]! * Math.min(1, (1 - t) * 2) * Math.min(1, t * 12 + 0.25);
      }
      p.alive = alive;
      const g = p.points.geometry;
      (g.getAttribute('position') as BufferAttribute).needsUpdate = true;
      (g.getAttribute('aColor') as BufferAttribute).needsUpdate = true;
      (g.getAttribute('aSize') as BufferAttribute).needsUpdate = true;
    }
  }

  /** drop every live particle (run end) */
  clear(): void {
    for (const p of [this.ringAdd, this.ringAlpha]) { p.st.fill(0); p.col.fill(0); p.alive = 0; p.next = 0; (p.mesh.geometry.getAttribute('aRingCol') as BufferAttribute).needsUpdate = true; }
    for (const p of [this.add, this.alpha]) { p.st.fill(0); p.col.fill(0); p.alive = 0; p.next = 0; for (const n of ['aColor'] as const) (p.points.geometry.getAttribute(n) as BufferAttribute).needsUpdate = true; }
  }

  dispose(): void {
    for (const p of [this.add, this.alpha]) { this.parent.remove(p.points); p.points.geometry.dispose(); (p.points.material as ShaderMaterial).dispose(); }
    for (const p of [this.ringAdd, this.ringAlpha]) { this.parent.remove(p.mesh); p.mesh.geometry.dispose(); (p.mesh.material as ShaderMaterial).dispose(); }
  }
}
