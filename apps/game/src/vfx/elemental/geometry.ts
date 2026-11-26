// Ported from threejs-vfx src/assets/ProceduralGeometry.js (MIT, © mohamedachrefelouafi — see ./LICENSE).
// CPU-side procedural geometry: ice crystals, shards, fractured meteor rock, and the parameter-space strips that vertex shaders
// turn into lightning ribbons, beam tubes and shock discs. Everything is deterministic in `seed`.
import {
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Sphere,
  Vector3,
} from 'three';
import { clamp, hash11, smoothstep } from './math';

const TAU = Math.PI * 2;
const RING_HEIGHTS = [0, 0.22, 0.5, 0.75, 0.92] as const;

function profileRadius(t: number, taper: number): number {
  return taper + (1 - taper) * Math.pow(1 - t, 1.15);
}

export interface CrystalOptions {
  seed?: number;
  /** facet count around the prism (5–8 read best) */
  sides?: number;
  /** tip radius as a fraction of the base */
  taper?: number;
  /** how far facets are pushed off a clean prism */
  roughness?: number;
  /** sideways curve from base to tip */
  bend?: number;
}

/**
 * A single ice crystal: a tapered, faceted, slightly bent prism. Unit space — base ring on y = 0 with circumscribed radius 0.5,
 * apex at y = 1 — so an instance scales footprint and height independently and `local.y` reads as "how far up the crystal".
 */
export function createCrystalGeometry({ seed = 1, sides = 6, taper = 0.13, roughness = 0.28, bend = 0.22 }: CrystalOptions = {}): BufferGeometry {
  const facets = Math.max(3, Math.round(sides));
  const tipRadius = Math.min(0.9, Math.max(0.01, taper));
  const bendAngle = hash11(seed * 1.77) * TAU;
  const bendX = Math.cos(bendAngle);
  const bendZ = Math.sin(bendAngle);
  const axisOffset = (t: number): number => bend * 0.5 * Math.pow(t, 1.6);

  const angles: number[] = [];
  for (let i = 0; i < facets; i++) {
    const jitter = (hash11(seed * 3.13 + i * 7.7) - 0.5) * (TAU / facets) * 0.55 * roughness * 3;
    angles.push((i / facets) * TAU + jitter);
  }

  type P3 = readonly [number, number, number];
  const rings: P3[][] = RING_HEIGHTS.map((t, ringIndex) => {
    const baseR = profileRadius(t, tipRadius) * 0.5;
    const drift = axisOffset(t);
    const y = t + (hash11(seed * 5.9 + ringIndex * 2.3) - 0.5) * 0.06 * roughness * (t > 0 ? 1 : 0);
    return angles.map((angle, i): P3 => {
      const wobble = 1 + (hash11(seed * 11.1 + ringIndex * 13.7 + i * 3.9) - 0.5) * roughness * 1.3 * (0.35 + 0.65 * t);
      const r = Math.max(0.002, baseR * wobble);
      return [Math.cos(angle) * r + bendX * drift, y, Math.sin(angle) * r + bendZ * drift];
    });
  });

  const apexDrift = axisOffset(1);
  const apex: P3 = [bendX * apexDrift + (hash11(seed * 17.3) - 0.5) * 0.09 * roughness, 1, bendZ * apexDrift + (hash11(seed * 19.7) - 0.5) * 0.09 * roughness];
  const floorCentre: P3 = [0, 0, 0];

  const positions: number[] = [];
  const push = (p: P3): void => {
    positions.push(p[0], p[1], p[2]);
  };

  for (let ring = 0; ring < rings.length - 1; ring++) {
    const lower = rings[ring] as P3[];
    const upper = rings[ring + 1] as P3[];
    for (let i = 0; i < facets; i++) {
      const j = (i + 1) % facets;
      push(lower[i] as P3); push(lower[j] as P3); push(upper[i] as P3);
      push(lower[j] as P3); push(upper[j] as P3); push(upper[i] as P3);
    }
  }
  const top = rings[rings.length - 1] as P3[];
  const base = rings[0] as P3[];
  for (let i = 0; i < facets; i++) {
    const j = (i + 1) % facets;
    push(top[i] as P3); push(top[j] as P3); push(apex);
    push(floorCentre); push(base[j] as P3); push(base[i] as P3);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals(); // non-indexed + per-face normals: crisp facets
  return geometry;
}

/** Short, wide crystal shard — the ankle-height rubble that fills in around the main spikes. */
export function createShardGeometry(seed = 5, sides = 5): BufferGeometry {
  return createCrystalGeometry({ seed: seed * 2.7 + 41, sides, taper: 0.22, roughness: 0.55, bend: 0.35 });
}

// ---------------------------------------------------------------------------------------------------------------- asteroid

function lattice(ix: number, iy: number, iz: number, seed: number): number {
  return hash11(ix * 127.1 + iy * 311.7 + iz * 74.7 + seed * 19.19);
}

/** Deterministic 3D value noise, 0..1. */
function valueNoise3(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const c000 = lattice(ix, iy, iz, seed), c100 = lattice(ix + 1, iy, iz, seed);
  const c010 = lattice(ix, iy + 1, iz, seed), c110 = lattice(ix + 1, iy + 1, iz, seed);
  const c001 = lattice(ix, iy, iz + 1, seed), c101 = lattice(ix + 1, iy, iz + 1, seed);
  const c011 = lattice(ix, iy + 1, iz + 1, seed), c111 = lattice(ix + 1, iy + 1, iz + 1, seed);
  const x00 = c000 + (c100 - c000) * ux, x10 = c010 + (c110 - c010) * ux;
  const x01 = c001 + (c101 - c001) * ux, x11 = c011 + (c111 - c011) * ux;
  const y0 = x00 + (x10 - x00) * uy, y1 = x01 + (x11 - x01) * uy;
  return y0 + (y1 - y0) * uz;
}

function fbmValue(x: number, y: number, z: number, seed: number, octaves: number): number {
  let value = 0, amplitude = 0.5, frequency = 1;
  for (let i = 0; i < octaves; i++) {
    value += amplitude * (valueNoise3(x * frequency, y * frequency, z * frequency, seed + i * 7.7) * 2 - 1);
    frequency *= 2.03;
    amplitude *= 0.5;
  }
  return value;
}

export interface AsteroidOptions {
  seed?: number;
  /** icosphere subdivisions, 0–3 */
  detail?: number;
  lumpiness?: number;
  noiseScale?: number;
  roughness?: number;
  /** planar fracture faces sliced off */
  cuts?: number;
  cutDepth?: number;
  craters?: number;
  craterDepth?: number;
  craterSize?: number;
}

interface Dir {
  x: number;
  y: number;
  z: number;
  offset: number;
  radius: number;
  depth: number;
}

function direction(a: number, b: number): Dir {
  const phi = Math.acos(2 * hash11(a) - 1);
  const theta = hash11(b) * TAU;
  const s = Math.sin(phi);
  return { x: s * Math.cos(theta), y: Math.cos(phi), z: s * Math.sin(theta), offset: 0, radius: 0, depth: 0 };
}

/**
 * A meteor: a fractured, cratered ball of rock in unit space (icosphere radius 1, vertices pushed along their own direction).
 * fbm lumps + planar cuts (genuine flat faces at hard edges) + craters with heaped rims. Non-indexed, flat-shaded.
 */
export function createAsteroidGeometry({
  seed = 1,
  detail = 3,
  lumpiness = 0.26,
  noiseScale = 1.5,
  roughness = 0.16,
  cuts = 7,
  cutDepth = 0.2,
  craters = 5,
  craterDepth = 0.18,
  craterSize = 0.5,
}: AsteroidOptions = {}): BufferGeometry {
  const baseGeo = new IcosahedronGeometry(1, clamp(Math.round(detail), 0, 3));
  let geometry: BufferGeometry = baseGeo;
  if (baseGeo.index) {
    geometry = baseGeo.toNonIndexed();
    baseGeo.dispose();
  }
  const array = (geometry.attributes.position as BufferAttribute).array as Float32Array;

  const planes: Dir[] = [];
  for (let i = 0; i < Math.max(0, Math.round(cuts)); i++) {
    const n = direction(seed * 2.3 + i * 9.1, seed * 5.7 + i * 4.3);
    n.offset = 1 - cutDepth * (0.35 + 0.9 * hash11(seed * 13.1 + i * 6.7));
    planes.push(n);
  }
  const bowls: Dir[] = [];
  for (let i = 0; i < Math.max(0, Math.round(craters)); i++) {
    const c = direction(seed * 3.1 + i * 12.9, seed * 7.7 + i * 5.3);
    c.radius = Math.max(0.08, craterSize * (0.45 + 0.8 * hash11(seed * 11.3 + i * 3.7)));
    c.depth = craterDepth * (0.5 + hash11(seed * 17.9 + i * 2.1));
    bowls.push(c);
  }

  for (let i = 0; i < array.length; i += 3) {
    const x = array[i] as number, y = array[i + 1] as number, z = array[i + 2] as number;
    let radius = 1;
    radius += fbmValue(x * noiseScale, y * noiseScale, z * noiseScale, seed, 3) * lumpiness;
    radius += fbmValue(x * noiseScale * 4.3, y * noiseScale * 4.3, z * noiseScale * 4.3, seed + 31.7, 2) * roughness * 0.5;
    for (const bowl of bowls) {
      const angle = Math.acos(clamp(x * bowl.x + y * bowl.y + z * bowl.z, -1, 1));
      const q = angle / bowl.radius;
      if (q >= 1.4) continue;
      radius -= bowl.depth * Math.max(0, 1 - q * q);
      radius += bowl.depth * 0.5 * smoothstep(0.72, 1.0, q) * (1 - smoothstep(1.0, 1.4, q));
    }
    radius = Math.max(0.35, radius);
    let px = x * radius, py = y * radius, pz = z * radius;
    for (const plane of planes) {
      const over = px * plane.x + py * plane.y + pz * plane.z - plane.offset;
      if (over <= 0) continue;
      px -= plane.x * over;
      py -= plane.y * over;
      pz -= plane.z * over;
    }
    array[i] = px;
    array[i + 1] = py;
    array[i + 2] = pz;
  }
  (geometry.attributes.position as BufferAttribute).needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

// ------------------------------------------------------------------------------------------------ parameter-space strips

/**
 * The strip a lightning filament is drawn on: a ladder of quads in *parameter* space, position = (t, side, 0), one instance per
 * filament (`aStrand` = instance index). A vertex shader turns (t, side) into a world position every frame.
 */
export function createBoltRibbonGeometry(nodes = 72, strands = 24): InstancedBufferGeometry {
  const steps = Math.max(2, Math.round(nodes));
  const count = Math.max(1, Math.round(strands));
  const positions = new Float32Array(steps * 2 * 3);
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const o = i * 6;
    positions[o] = t;
    positions[o + 1] = -1;
    positions[o + 3] = t;
    positions[o + 4] = 1;
  }
  const indices = new Uint16Array((steps - 1) * 6);
  for (let i = 0; i < steps - 1; i++) {
    const a = i * 2;
    const o = i * 6;
    indices[o] = a;
    indices[o + 1] = a + 1;
    indices[o + 2] = a + 2;
    indices[o + 3] = a + 1;
    indices[o + 4] = a + 3;
    indices[o + 5] = a + 2;
  }
  const strandIndex = new Float32Array(count);
  for (let i = 0; i < count; i++) strandIndex[i] = i;
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('aStrand', new InstancedBufferAttribute(strandIndex, 1));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.instanceCount = count;
  geometry.boundingSphere = new Sphere(new Vector3(), 1e4); // placed in world space by the vertex shader: cull manually
  return geometry;
}

/**
 * The beam column: a tube in parameter space, position = (t along the barrel, a once around, 0). The seam column is duplicated so
 * `a` reaches 1.0 and angular noise shows no join.
 */
export function createBeamTubeGeometry(nodes = 96, sides = 26): BufferGeometry {
  const steps = Math.max(2, Math.round(nodes));
  const facets = Math.max(3, Math.round(sides));
  const columns = facets + 1;
  const positions = new Float32Array(steps * columns * 3);
  let v = 0;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    for (let j = 0; j < columns; j++) {
      positions[v++] = t;
      positions[v++] = j / facets;
      positions[v++] = 0;
    }
  }
  const indices = new Uint16Array((steps - 1) * facets * 6);
  let k = 0;
  for (let i = 0; i < steps - 1; i++) {
    for (let j = 0; j < facets; j++) {
      const a = i * columns + j;
      const b = a + columns;
      indices[k++] = a;
      indices[k++] = b;
      indices[k++] = a + 1;
      indices[k++] = b;
      indices[k++] = b + 1;
      indices[k++] = a + 1;
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.boundingSphere = new Sphere(new Vector3(), 1e4);
  return geometry;
}

/** Shock discs that race down a beam: an instanced annulus in parameter space, position = (band 0 inner / 1 outer, a, 0). */
export function createBeamRingGeometry(rings = 10, segments = 44): InstancedBufferGeometry {
  const count = Math.max(1, Math.round(rings));
  const facets = Math.max(6, Math.round(segments));
  const columns = facets + 1;
  const positions = new Float32Array(2 * columns * 3);
  let v = 0;
  for (let band = 0; band < 2; band++) {
    for (let j = 0; j < columns; j++) {
      positions[v++] = band;
      positions[v++] = j / facets;
      positions[v++] = 0;
    }
  }
  const indices = new Uint16Array(facets * 6);
  let k = 0;
  for (let j = 0; j < facets; j++) {
    const a = j;
    const b = columns + j;
    indices[k++] = a;
    indices[k++] = b;
    indices[k++] = a + 1;
    indices[k++] = b;
    indices[k++] = b + 1;
    indices[k++] = a + 1;
  }
  const ringIndex = new Float32Array(count);
  for (let i = 0; i < count; i++) ringIndex[i] = i;
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('aRing', new InstancedBufferAttribute(ringIndex, 1));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.instanceCount = count;
  geometry.boundingSphere = new Sphere(new Vector3(), 1e4);
  return geometry;
}
