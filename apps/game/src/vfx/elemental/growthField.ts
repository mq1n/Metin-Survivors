// Ported from threejs-vfx src/vfx/GrowthField.js (MIT, © mohamedachrefelouafi — see ./LICENSE).
// Instanced procedural growth erupting along a line or across a zone: ice crystals, blade crowns, falling icicles. The sandbox's
// discipline is kept: a record holds nothing but dice and one timestamp, and every metre, radian and second is resolved against a
// live params object inside `update`, so the field owns placement, timing and matrices while the caller owns geometry and
// material. `variants` InstancedMeshes (= draw calls) share one record pool — distinct facets, not just proportions. Per-instance
// state reaches the material as instanced attributes: `aSeed` (0..10), `aBirth` (1 → 0 flash as it arrives), `aGrow` (0 → 1, the
// freeze front climbing the instance's own axis) and `aShatter` (0 → 1 break-up). Over the sandbox: deterministic dice from a seed,
// bases that follow the terrain (`FloorAt`), concentric `bands` and an uneven crest for ZONE crowns, a fanned lean, a DROP arrival
// (icicles falling point-first into the floor) and the per-instance shatter ramp the sandbox's GlacierAbility drove by hand.
import { InstancedBufferAttribute, InstancedMesh, Object3D, Quaternion, Vector3, type BufferGeometry, type Group, type Material } from 'three';
import { Easing, hash11, lerp, saturate, smoothstep } from './math';
import type { FloorAt } from './shatterField';

const TAU = Math.PI * 2;

/** module-scope scratch: nothing in the frame path allocates */
const _dummy = new Object3D();
const _lean = new Vector3();
const _axis = new Vector3();
const _up = new Vector3(0, 1, 0);
const _tilt = new Quaternion();
const _spin = new Quaternion();
const _flip = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI);
const _tip = new Vector3();
const _pos = new Vector3();

/** Where the field is laid out. */
export const GrowthLayout = {
  /** a band down the cast line, widening with `widthCurve`; the cluster lands about the far end */
  LINE: 0,
  /** an annulus about `centre`, `zoneInner`..`zoneRadius`; the cluster lands inside the inner radius */
  ZONE: 1,
} as const;
export type GrowthLayout = (typeof GrowthLayout)[keyof typeof GrowthLayout];

/** How an instance arrives. */
export const GrowthEmerge = {
  /** punches up out of the floor: buried, then slid into place with a springy overshoot */
  PUSH: 0,
  /** accretes in place, scaling from nothing */
  SCALE: 1,
  /** falls point-first along its own (flipped, leaned) axis and buries `embed` of its length in the floor */
  DROP: 2,
} as const;
export type GrowthEmerge = (typeof GrowthEmerge)[keyof typeof GrowthEmerge];

/** Live params, read fresh on every `update` (defaults = the sandbox's canonical names and values). */
export interface GrowthParams {
  layout: GrowthLayout;
  emerge: GrowthEmerge;
  /** LINE: where the line starts (bases sit on the floor sampler, the y is ignored) */
  readonly origin: Vector3;
  /** unit, flat: the LINE axis; in ZONE the bearing `leanForward` adds to every lean (DROP: where the rain comes from) */
  readonly direction: Vector3;
  /** unit, flat, lateral to `direction` */
  readonly side: Vector3;
  /** ZONE centre */
  readonly centre: Vector3;
  /** LINE length, metres */
  length: number;

  /** LINE: half-width of the band at the near and far end, metres; < 1 flares early */
  widthNear: number;
  width: number;
  widthCurve: number;
  /** < 1 crowds instances toward the far end */
  frontBias: number;
  /** > 1 pulls them toward the centre line */
  clumping: number;
  /** extra lateral jitter, fraction of the local half-width */
  scatter: number;

  /** ZONE outer and inner radius, metres */
  zoneRadius: number;
  zoneInner: number;
  /** < 1 pushes the band toward the rim */
  radialCurve: number;
  /** metres of radial wander (unbanded) */
  radialJitter: number;
  /** radians of bearing wander */
  angleJitter: number;
  /** ZONE: > 0 snaps instances onto that many concentric rings, which then erupt ring by ring under a radial trigger */
  bands: number;
  /** ± fraction of a ring's width an instance wanders off it */
  bandJitter: number;
  /** metres; < 0 derives 1.25 × the far half-width (LINE) / the inner radius (ZONE) */
  clusterRadius: number;

  /** metres at the near end / centre and at the far end / rim; how late the ramp climbs */
  heightNear: number;
  height: number;
  heightCurve: number;
  /** ± fraction */
  heightJitter: number;
  /** 0..1 — how much shorter the flank instances are than the spine, and how sharply that dome falls off */
  crown: number;
  crownPower: number;
  /** extra height multiplier at the far end, and how much of the line the swell covers (0..1) */
  peak: number;
  peakWidth: number;
  /** ZONE: uneven crest — two harmonics of the bearing, phased per cast (0 = a flat crest, which reads as a fence) */
  crest: number;
  /** 0..1 chance an instance is demoted to ankle-height wreckage; its height and footprint multipliers */
  rubble: number;
  rubbleScale: number;
  rubbleSpread: number;
  minHeight: number;

  /** base radius at the near end / centre and at the far end / rim, metres; how the radius ramps */
  radiusNear: number;
  radiusFar: number;
  radiusCurve: number;
  radiusJitter: number;
  minRadius: number;

  /** radians away from the caster / out from the centre; ± fraction; 0 leans everything equally, 1 only the far end */
  lean: number;
  leanJitter: number;
  leanRamp: number;
  /** weights of "along `direction`" and "out across the band / radially" in the lean */
  leanForward: number;
  leanOutward: number;
  /** radians an instance is splayed off its own bearing, ± (blades cross instead of standing like pickets) */
  fan: number;
  /** 0..1 of a full turn of random yaw */
  twist: number;
  /** radians of extra random tip, any bearing */
  tilt: number;

  /** metres above the floor the base sits (air growth), ± fraction */
  baseHeight: number;
  baseJitter: number;

  /** seconds from buried to full height (DROP: the fall) */
  riseTime: number;
  /** how far past full height the punch carries, how long it rings, and its rate (rad/s) */
  riseOvershoot: number;
  settle: number;
  springRate: number;
  /** PUSH: fraction of its height an instance is buried at emerge = 0 */
  emergeSink: number;
  /** footprint scale at the moment it breaks through */
  birthScale: number;
  /** seconds the `aBirth` flash decays over */
  birthFade: number;
  /** emergence fraction that fires `onBreach` (DROP: on landing) */
  breachAt: number;
  /** > 0: the freeze front (`aGrow`) completes in `riseTime × growFront`; 0: instances arrive fully formed */
  growFront: number;
  /** DROP: metres fallen along the axis, and the fraction of the length driven into the floor */
  dropHeight: number;
  embed: number;

  /** extra metres a retracting instance drops beyond its own height */
  sinkDepth: number;
  /** seconds one instance takes to break up; how the break sweeps near → far / inside → out (s); random delay (s) */
  shatterTime: number;
  shatterSweep: number;
  shatterStagger: number;
  /** fraction of its height a breaking instance drops into the floor */
  shatterSink: number;

  /** multiplies every *Jitter above */
  randomness: number;
}

export function growthParams(): GrowthParams {
  return {
    layout: GrowthLayout.LINE,
    emerge: GrowthEmerge.PUSH,
    origin: new Vector3(),
    direction: new Vector3(0, 0, 1),
    side: new Vector3(1, 0, 0),
    centre: new Vector3(),
    length: 10,
    widthNear: 0.5,
    width: 2.5,
    widthCurve: 1,
    frontBias: 1,
    clumping: 1,
    scatter: 0.5,
    zoneRadius: 4,
    zoneInner: 0,
    radialCurve: 1,
    radialJitter: 0,
    angleJitter: 0,
    bands: 0,
    bandJitter: 0.5,
    clusterRadius: -1,
    heightNear: 0.5,
    height: 3,
    heightCurve: 1,
    heightJitter: 0.4,
    crown: 0,
    crownPower: 1.4,
    peak: 1,
    peakWidth: 0.25,
    crest: 0,
    rubble: 0,
    rubbleScale: 0.3,
    rubbleSpread: 1.25,
    minHeight: 0.02,
    radiusNear: 0.3,
    radiusFar: 0.3,
    radiusCurve: 0.6,
    radiusJitter: 0.4,
    minRadius: 0.01,
    lean: 0,
    leanJitter: 0,
    leanRamp: 0.65,
    leanForward: 0.75,
    leanOutward: 0.85,
    fan: 0,
    twist: 1,
    tilt: 0,
    baseHeight: 0,
    baseJitter: 0,
    riseTime: 0.18,
    riseOvershoot: 0.25,
    settle: 0.5,
    springRate: 14,
    emergeSink: 0.85,
    birthScale: 0.86,
    birthFade: 0.18,
    breachAt: 0.25,
    growFront: 0,
    dropHeight: 12,
    embed: 0.3,
    sinkDepth: 0.4,
    shatterTime: 0.35,
    shatterSweep: 0.3,
    shatterStagger: 0.15,
    shatterSink: 0.45,
    randomness: 1,
  };
}

/** Fired with the instance index, its base on the floor (or, for a crumble, its middle) and its live size. */
export type GrowthEvent = (index: number, x: number, y: number, z: number, radius: number, height: number) => void;

/** Dice and one timestamp — if a metre is tempting here, it belongs in the params. */
interface GrowthRecord {
  /** 0..1 stratified down the line, before `frontBias` */
  along: number;
  /** -1..1 across the band before clumping (ZONE: band wander / radial jitter) */
  lateral: number;
  /** -1..1 extra lateral / angular jitter */
  scatter: number;
  /** 0..1 of a turn: cluster / ZONE bearing */
  angle: number;
  /** 0..1 sqrt-uniform, so a disc fills evenly */
  radial: number;
  cluster: boolean;
  rubbleRoll: number;
  heightRoll: number;
  radiusRoll: number;
  leanRoll: number;
  fanRoll: number;
  tiltRoll: number;
  tiltBearing: number;
  baseRoll: number;
  yaw: number;
  /** 0..1 of the caller's stagger window */
  stagger: number;
  /** absolute time it was released at, or -1 while buried */
  eruptTime: number;
  breached: boolean;
  crumbled: boolean;
}

export interface GrowthOptions {
  /** unit-space factory: footprint inside a radius-0.5 circle on y = 0, tip at y = 1 (`createCrystalGeometry` is the reference) */
  geometry: (variant: number) => BufferGeometry;
  /** must consume the instanced `aSeed` / `aBirth` / `aGrow` / `aShatter` attributes (an IceMaterial) */
  material: Material;
  /** distinct silhouettes = draw calls */
  variants?: number;
  /** hard ceiling on instances per cast */
  capacity?: number;
  renderOrder?: number;
}

export class GrowthField {
  readonly meshes: InstancedMesh[] = [];
  readonly variants: number;
  readonly capacity: number;
  /** fired once per instance the frame it breaks the surface (DROP: lands). Assign once, at build: a closure per frame allocates. */
  onBreach: GrowthEvent | null = null;
  /** fired once per instance the frame its break-up passes 0.12 */
  onCrumble: GrowthEvent | null = null;
  private readonly slots: number;
  private readonly records: GrowthRecord[] = [];
  private readonly seedArr: Float32Array[] = [];
  private readonly birthArr: Float32Array[] = [];
  private readonly growArr: Float32Array[] = [];
  private readonly shatterArr: Float32Array[] = [];
  private readonly attrs: InstancedBufferAttribute[] = [];
  private readonly used: Int32Array;
  private n = 0;
  private clusterStart = 0;
  private seedBase = 0;
  private diceN = 0;
  /** per-cast phase of the crest harmonics */
  private crestPhase = 0;
  private shown = true;
  private drawn = 0;

  constructor(parent: Group, { geometry, material, variants = 3, capacity = 288, renderOrder = 42 }: GrowthOptions) {
    this.variants = Math.max(1, Math.round(variants));
    this.capacity = Math.max(1, Math.round(capacity));
    this.slots = Math.ceil(this.capacity / this.variants);
    this.used = new Int32Array(this.variants);
    for (let v = 0; v < this.variants; v++) {
      const geo = geometry(v);
      const seeds = this.attribute(geo, 'aSeed', this.seedArr);
      seeds.needsUpdate = true;
      this.attribute(geo, 'aBirth', this.birthArr);
      this.attribute(geo, 'aGrow', this.growArr);
      this.attribute(geo, 'aShatter', this.shatterArr);
      const mesh = new InstancedMesh(geo, material, this.slots);
      // placed in world space from the CPU every frame: its own bounds are a lie
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.renderOrder = renderOrder;
      parent.add(mesh);
      this.meshes.push(mesh);
    }
    for (let i = 0; i < this.capacity; i++) {
      this.records.push({
        along: 0, lateral: 0, scatter: 0, angle: 0, radial: 0, cluster: false, rubbleRoll: 1, heightRoll: 0, radiusRoll: 0, leanRoll: 0,
        fanRoll: 0, tiltRoll: 0, tiltBearing: 0, baseRoll: 0, yaw: 0, stagger: 0, eruptTime: -1, breached: false, crumbled: false,
      });
    }
  }

  private attribute(geo: BufferGeometry, name: string, list: Float32Array[]): InstancedBufferAttribute {
    const array = new Float32Array(this.slots);
    const attr = new InstancedBufferAttribute(array, 1);
    geo.setAttribute(name, attr);
    list.push(array);
    this.attrs.push(attr);
    return attr;
  }

  /** instances planted this cast */
  get count(): number {
    return this.n;
  }

  /** instances drawn after the last `update` (unburied, unbroken) */
  get standing(): number {
    return this.drawn;
  }

  /** deterministic dice: hash of (seed, running counter) */
  private dice(): number {
    return hash11(this.seedBase + this.diceN++ * 1.618);
  }

  /**
   * Rolls a fresh field — the only place dice are thrown. `clusterShare` holds the last slice back: in LINE they land about the
   * far end, in ZONE inside `zoneInner`. Reproducible from `seed`.
   * @returns instances actually planted
   */
  plant(count: number, clusterShare: number, seed: number): number {
    const wanted = Math.min(this.capacity, Math.max(0, Math.round(count)));
    this.n = wanted;
    this.clusterStart = wanted - Math.round(wanted * saturate(clusterShare));
    this.seedBase = seed * 77.3 + 1.7;
    this.diceN = 0;
    this.crestPhase = this.dice() * TAU;
    const spine = Math.max(1, this.clusterStart);
    for (let i = 0; i < wanted; i++) {
      const r = this.records[i] as GrowthRecord;
      r.cluster = i >= this.clusterStart;
      r.eruptTime = -1;
      r.breached = false;
      r.crumbled = false;
      r.yaw = this.dice();
      r.stagger = this.dice();
      r.heightRoll = this.dice() * 2 - 1;
      r.radiusRoll = this.dice() * 2 - 1;
      r.leanRoll = this.dice() * 2 - 1;
      r.fanRoll = this.dice() * 2 - 1;
      r.tiltRoll = this.dice() * 2 - 1;
      r.tiltBearing = this.dice();
      r.baseRoll = this.dice() * 2 - 1;
      r.scatter = this.dice() * 2 - 1;
      r.rubbleRoll = this.dice();
      r.lateral = this.dice() * 2 - 1;
      r.angle = this.dice();
      r.radial = Math.sqrt(this.dice());
      // stratified, not uniform: one instance per slot down the line plus a jitter inside it, so a sparse field still covers the cast
      r.along = r.cluster ? 1 : (i + this.dice()) / spine;
      (this.seedArr[i % this.variants] as Float32Array)[(i / this.variants) | 0] = this.dice() * 10;
    }
    for (let i = wanted; i < this.capacity; i++) (this.records[i] as GrowthRecord).eruptTime = -1;
    for (let v = 0; v < this.variants; v++) {
      (this.attrs[v * 4] as InstancedBufferAttribute).needsUpdate = true;
      (this.meshes[v] as InstancedMesh).count = 0;
    }
    this.drawn = 0;
    return wanted;
  }

  /** Overrides the placement dice of one instance (ZONE bearing and radial fraction, 0..1 each) and its size rolls (-1..1). */
  pin(index: number, angle: number, radial: number, heightRoll: number, radiusRoll: number): void {
    if (index < 0 || index >= this.n) return;
    const r = this.records[index] as GrowthRecord;
    r.cluster = false;
    r.angle = angle;
    r.radial = radial;
    r.heightRoll = heightRoll;
    r.radiusRoll = radiusRoll;
  }

  /** Un-plants everything. */
  clear(): void {
    this.n = 0;
    this.drawn = 0;
    for (const m of this.meshes) m.count = 0;
  }

  setVisible(v: boolean): void {
    this.shown = v;
    for (const m of this.meshes) m.visible = v;
  }

  /** Releases everything the travelling front has reached (LINE): `limit` 0..1 down the line, `stagger` seconds of random delay. */
  triggerUpTo(now: number, limit: number, stagger: number, frontBias: number, includeCluster: boolean): void {
    for (let i = 0; i < this.n; i++) {
      const r = this.records[i] as GrowthRecord;
      if (r.eruptTime >= 0) continue;
      if (r.cluster) {
        if (!includeCluster) continue;
      } else if (Math.pow(saturate(r.along), frontBias) > limit) {
        continue;
      }
      r.eruptTime = now + r.stagger * stagger;
    }
  }

  /** Releases everything a radial front has reached (ZONE): `limit` 0..1 of `zoneRadius`. */
  triggerRadial(now: number, limit: number, stagger: number, p: GrowthParams, includeCluster: boolean): void {
    const outer = Math.max(1e-3, p.zoneRadius);
    for (let i = 0; i < this.n; i++) {
      const r = this.records[i] as GrowthRecord;
      if (r.eruptTime >= 0) continue;
      if (r.cluster) {
        if (!includeCluster) continue;
      } else if (this.zoneDistance(r, this.curveT(r, p), p) / outer > limit) {
        continue;
      }
      r.eruptTime = now + r.stagger * stagger;
    }
  }

  /** Releases instance `index` `delay` seconds from `now`. */
  triggerIndex(now: number, index: number, delay: number): void {
    if (index < 0 || index >= this.n) return;
    const r = this.records[index] as GrowthRecord;
    if (r.eruptTime < 0) r.eruptTime = now + delay;
  }

  // ------------------------------------------------------------------------------------------------- resolving (live params)

  /** The curve parameter an instance is sampled at: 0 at the caster / centre, 1 at the far end / rim. */
  private curveT(r: GrowthRecord, p: GrowthParams): number {
    if (p.layout === GrowthLayout.ZONE) {
      if (p.bands >= 1) {
        const b = Math.min(p.bands - 1, Math.floor(r.radial * p.bands));
        return saturate((b + 0.5 + r.lateral * p.bandJitter * 0.5) / p.bands);
      }
      return r.radial;
    }
    if (r.cluster) return 1;
    return Math.pow(saturate(r.along), p.frontBias);
  }

  private halfWidth(t: number, p: GrowthParams): number {
    return lerp(p.widthNear, p.width, Math.pow(saturate(t), p.widthCurve));
  }

  /** signed lateral offset as a fraction of the local half-width */
  private lateralNorm(r: GrowthRecord, p: GrowthParams): number {
    const raw = r.lateral;
    return Math.sign(raw) * Math.pow(Math.abs(raw), p.clumping) + r.scatter * p.scatter;
  }

  /** ZONE: metres from the centre */
  private zoneDistance(r: GrowthRecord, t: number, p: GrowthParams): number {
    const outer = p.zoneRadius;
    const inner = Math.min(outer, p.zoneInner);
    if (r.cluster) return (p.clusterRadius >= 0 ? p.clusterRadius : inner) * r.radial;
    const d = lerp(inner, outer, Math.pow(saturate(t), p.radialCurve));
    return p.bands >= 1 ? d : d + r.lateral * p.radialJitter;
  }

  /** where an instance stands on the XZ plane right now (y = 0) */
  private place(r: GrowthRecord, t: number, p: GrowthParams, out: Vector3): Vector3 {
    if (p.layout === GrowthLayout.ZONE) {
      const a = (r.angle + r.scatter * (p.angleJitter / TAU)) * TAU;
      const d = this.zoneDistance(r, t, p);
      return out.set(p.centre.x + Math.cos(a) * d, 0, p.centre.z + Math.sin(a) * d);
    }
    if (r.cluster) {
      const reach = (p.clusterRadius >= 0 ? p.clusterRadius : this.halfWidth(1, p) * 1.25) * r.radial;
      const a = r.angle * TAU;
      return out.set(
        p.origin.x + p.direction.x * p.length + Math.cos(a) * reach,
        0,
        p.origin.z + p.direction.z * p.length + Math.sin(a) * reach,
      );
    }
    const along = t * p.length;
    const lateral = this.lateralNorm(r, p) * this.halfWidth(t, p);
    return out.set(p.origin.x + p.direction.x * along + p.side.x * lateral, 0, p.origin.z + p.direction.z * along + p.side.z * lateral);
  }

  private heightOf(r: GrowthRecord, t: number, p: GrowthParams): number {
    const jitter = p.randomness;
    let h = lerp(p.heightNear, p.height, Math.pow(saturate(t), p.heightCurve));
    // the swell at the far end
    if (p.peak !== 1) h *= 1 + (p.peak - 1) * smoothstep(1 - p.peakWidth, 1, t);
    // domed silhouette: the flanks are shorter than the spine
    const crown = saturate(p.crown);
    if (crown > 0) {
      const edge = p.layout === GrowthLayout.ZONE ? saturate(Math.abs(r.lateral)) : r.cluster ? r.radial : saturate(Math.abs(this.lateralNorm(r, p)));
      h *= lerp(1, 1 - crown, Math.pow(edge, p.crownPower));
    }
    // an uneven crest: a crown of blades all the same height reads as a fence
    if (p.crest !== 0 && p.layout === GrowthLayout.ZONE) {
      const a = r.angle * TAU;
      h *= 1 + p.crest * (Math.sin(a * 3 + this.crestPhase) * 0.62 + Math.sin(a * 5 - this.crestPhase * 2.1) * 0.38);
    }
    h *= 1 + r.heightRoll * p.heightJitter * jitter;
    if (r.rubbleRoll < p.rubble) h *= p.rubbleScale;
    return Math.max(p.minHeight, h);
  }

  private radiusOf(r: GrowthRecord, t: number, p: GrowthParams): number {
    const grow = lerp(p.radiusNear, p.radiusFar, Math.pow(saturate(t), p.radiusCurve));
    const jitter = 1 + r.radiusRoll * p.radiusJitter * p.randomness;
    return Math.max(p.minRadius, grow * jitter * (r.rubbleRoll < p.rubble ? p.rubbleSpread : 1));
  }

  /** 0 → 1 with a springy overshoot past 1 (DROP: linear fall, 1 = landed); negative while still buried and waiting */
  private emergence(r: GrowthRecord, now: number, p: GrowthParams): number {
    if (r.eruptTime < 0) return -1;
    const elapsed = now - r.eruptTime;
    if (elapsed < 0) return -1;
    const rise = Math.max(0.02, p.riseTime);
    if (p.emerge === GrowthEmerge.DROP) return Math.min(1, elapsed / rise);
    if (elapsed <= rise) return Easing.outQuint(elapsed / rise);
    // the punch-through carries past full height and settles back
    const after = elapsed - rise;
    return 1 + p.riseOvershoot * Math.sin(after * p.springRate) * Math.exp(-after / Math.max(0.05, p.settle));
  }

  /** World position of instance `index`'s base at the live params (y = 0). */
  positionOf(index: number, p: GrowthParams, out: Vector3): Vector3 {
    const r = this.records[Math.max(0, Math.min(this.capacity - 1, index))] as GrowthRecord;
    return this.place(r, this.curveT(r, p), p, out);
  }

  // ------------------------------------------------------------------------------------------------------------------ frame

  /**
   * Rebuilds every instance matrix and per-instance attribute from the live params. Allocation-free.
   * @param now absolute time (the clock the triggers were stamped with)
   * @param retract 0..1, the whole field withdrawing into the floor
   * @param shatterAge seconds since the break-up began (< 0: standing); each instance breaks after its own sweep + stagger delay
   * @returns instances drawn
   */
  update(now: number, p: GrowthParams, floorAt: FloorAt, retract = 0, shatterAge = -1): number {
    const variants = this.variants;
    const used = this.used;
    used.fill(0);
    const jitter = p.randomness;
    const zone = p.layout === GrowthLayout.ZONE;
    const drop = p.emerge === GrowthEmerge.DROP;
    const birthFade = Math.max(0.02, p.birthFade);
    const growTime = Math.max(0.02, p.riseTime) * p.growFront;
    const shatterTime = Math.max(0.05, p.shatterTime);
    const sink = retract > 0 ? Easing.inCubic(saturate(retract)) : 0;
    let drawn = 0;

    for (let i = 0; i < this.n; i++) {
      const r = this.records[i] as GrowthRecord;
      const variant = i % variants;
      const slot = (i / variants) | 0;
      const mesh = this.meshes[variant] as InstancedMesh;
      used[variant] = Math.max(used[variant] as number, slot + 1);
      const e = this.emergence(r, now, p);
      const t = this.curveT(r, p);
      const shatter = e >= 0 && shatterAge >= 0 ? saturate((shatterAge - t * p.shatterSweep - r.stagger * p.shatterStagger) / shatterTime) : 0;
      if (e < 0 || shatter >= 1) {
        // buried or gone: park it outside the view rather than draw a degenerate matrix at the origin
        _dummy.position.set(0, -999, 0);
        _dummy.quaternion.identity();
        _dummy.scale.setScalar(0.0001);
        _dummy.updateMatrix();
        mesh.setMatrixAt(slot, _dummy.matrix);
        (this.birthArr[variant] as Float32Array)[slot] = 0;
        (this.growArr[variant] as Float32Array)[slot] = 0;
        (this.shatterArr[variant] as Float32Array)[slot] = 0;
        continue;
      }

      const height = this.heightOf(r, t, p);
      const radius = this.radiusOf(r, t, p);
      this.place(r, t, p, _pos);
      const floor = floorAt(_pos.x, _pos.z);

      // lean: away from the caster and out across the band (LINE), radially out and fanned off the bearing (ZONE, cluster)
      if (zone || r.cluster) {
        const a = r.angle * TAU + r.fanRoll * p.fan;
        const out = p.leanOutward * (zone ? Math.max(0.25, r.radial) : r.radial);
        _lean.set(Math.cos(a) * out + p.direction.x * p.leanForward, 0, Math.sin(a) * out + p.direction.z * p.leanForward);
      } else {
        const outward = this.lateralNorm(r, p) * p.leanOutward;
        _lean.set(p.direction.x * p.leanForward + p.side.x * outward, 0, p.direction.z * p.leanForward + p.side.z * outward);
        if (p.fan !== 0) _lean.applyAxisAngle(_up, r.fanRoll * p.fan);
      }
      if (_lean.lengthSq() < 1e-6) _lean.copy(p.direction);
      _lean.normalize();
      const leanAngle = p.lean * lerp(1 - p.leanRamp, 1, t) * (1 + r.leanRoll * p.leanJitter * jitter);
      // rotating about (up × lean) tips the instance's own +Y toward `lean`
      _axis.crossVectors(_up, _lean);
      if (_axis.lengthSq() < 1e-8) _axis.set(1, 0, 0);
      _axis.normalize();
      _tilt.setFromAxisAngle(_axis, leanAngle);
      if (p.tilt !== 0) {
        // a second, bearing-random tip so a field never looks combed
        const b = r.tiltBearing * TAU;
        _axis.set(Math.cos(b), 0, Math.sin(b));
        _spin.setFromAxisAngle(_axis, p.tilt * r.tiltRoll * jitter);
        _tilt.multiply(_spin);
      }
      // an icicle hangs from the sky: base up, point leading
      if (drop) _tilt.multiply(_flip);
      _spin.setFromAxisAngle(_up, r.yaw * TAU * p.twist);
      _tilt.multiply(_spin);
      _tip.set(0, 1, 0).applyQuaternion(_tilt);

      const settled = Math.min(1, e);
      let x = _pos.x;
      let y = floor + p.baseHeight * (1 + r.baseRoll * p.baseJitter * jitter);
      let z = _pos.z;
      let scale = 1;
      if (drop) {
        // the point is driven `embed` of the length into the floor; before it lands it is still up the line it fell along
        const back = height * (1 - p.embed) + (1 - e) * p.dropHeight;
        x -= _tip.x * back;
        y -= _tip.y * back;
        z -= _tip.z * back;
      } else if (p.emerge === GrowthEmerge.PUSH) {
        scale = lerp(p.birthScale, 1, settled);
        y += (e - 1) * height * p.emergeSink;
      } else {
        scale = lerp(p.birthScale, 1, settled) * Math.max(1e-4, e);
      }
      if (sink > 0) y -= sink * (height + radius + p.sinkDepth);
      if (shatter > 0) y -= Easing.inCubic(shatter) * (height * p.shatterSink + radius + 0.3);

      if (!r.breached && (drop ? e >= 1 : e > p.breachAt)) {
        r.breached = true;
        this.onBreach?.(i, _pos.x, floor, _pos.z, radius, height);
      }
      if (!r.crumbled && shatter > 0.12) {
        r.crumbled = true;
        const mid = height * 0.45;
        this.onCrumble?.(i, x + _tip.x * mid, y + _tip.y * mid, z + _tip.z * mid, radius, height);
      }

      _dummy.position.set(x, y, z);
      _dummy.quaternion.copy(_tilt);
      _dummy.scale.set(radius * scale, height * scale, radius * scale);
      _dummy.updateMatrix();
      mesh.setMatrixAt(slot, _dummy.matrix);
      const arrive = r.eruptTime + (drop ? Math.max(0.02, p.riseTime) : 0);
      (this.birthArr[variant] as Float32Array)[slot] = now >= arrive ? saturate(1 - (now - arrive) / birthFade) : 0;
      (this.growArr[variant] as Float32Array)[slot] = growTime > 0 ? saturate((now - r.eruptTime) / growTime) : 1;
      (this.shatterArr[variant] as Float32Array)[slot] = shatter;
      drawn++;
    }

    for (let v = 0; v < variants; v++) {
      const mesh = this.meshes[v] as InstancedMesh;
      const n = used[v] as number;
      mesh.count = n;
      mesh.visible = this.shown && n > 0;
      mesh.instanceMatrix.needsUpdate = true;
      for (let k = 1; k < 4; k++) (this.attrs[v * 4 + k] as InstancedBufferAttribute).needsUpdate = true;
    }
    this.drawn = drawn;
    return drawn;
  }

  /** Geometry and meshes; the material belongs to the caller. */
  dispose(): void {
    for (const m of this.meshes) {
      m.geometry.dispose();
      m.dispose();
      m.parent?.remove(m);
    }
    this.meshes.length = 0;
    this.onBreach = null;
    this.onCrumble = null;
  }
}
