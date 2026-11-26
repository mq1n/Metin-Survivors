// Distant mountain backdrop: three silhouette rings (one geometry, one draw call) around the camera. The profile of each
// ring is a function of the bearing only; the fragment shader adds faceting, strata, snow caps, crater glow and haze.
//   attributes: aTint (linear rgb) · aA = (height above foot, ring height at this bearing, dh/ds, cone mask) · aB = (bearing 0..1, haze)
import { BufferAttribute, BufferGeometry, Color } from 'three';
import { fbm, ridged, smoothstep } from '../../../world/noise';
import type { RingSpec, SkyStyle } from './styles';

export const RING_COLS = 384;
/** how far (m) below the foot the ring walls reach (hidden behind the haze) */
export const FOOT_DEPTH = 45;
const TAU = Math.PI * 2;

export interface Crater {
  /** unit XZ direction of the crater from the camera */
  dirX: number;
  dirZ: number;
  /** crater rim height relative to the camera's eye (m) */
  y: number;
  /** horizontal distance (m) */
  radius: number;
}

export interface Backdrop {
  geometry: BufferGeometry;
  craters: Crater[];
}

const CONE_RING = 1;
const CONE_HALF_WIDTH = 100;

/** Height (m above the foot) of ring `k` at bearing `theta`, plus the cone mask used for crater glow. */
function profile(style: SkyStyle, ring: RingSpec, k: number, theta: number, seed: number, out: { cone: number }): number {
  // walk a circle through noise space whose circumference spans about `freq` lattice cells
  const r = ring.freq / TAU;
  const cx = Math.cos(theta) * r;
  const cz = Math.sin(theta) * r;
  const s = seed + k * 17;
  out.cone = 0;
  switch (style.profile) {
    case 'rolling': {
      const n = fbm(cx, cz, s, 4) * 0.5 + 0.5;
      const d = fbm(cx * 3.1 + 9, cz * 3.1, s + 3, 3) * 0.5 + 0.5;
      const peaks = ridged(cx * 1.4 + 3, cz * 1.4, s + 8, 3);
      return ring.amp * (0.14 + 0.5 * smoothstep(0.3, 0.72, n) + 0.36 * peaks * peaks) * (0.8 + 0.2 * d);
    }
    case 'mesa': {
      // buttes and tablelands: a talus apron, a lower strata bench, then a sheer wall up to a near-flat cap rock
      const n = Math.min(1, Math.max(0, fbm(cx, cz, s, 3) * 0.7 + 0.5));
      const talus = smoothstep(0.12, 0.42, n);
      const bench = smoothstep(0.36, 0.4, n);
      const wall = smoothstep(0.47, 0.52, n);
      return ring.amp * (0.08 + 0.22 * talus + 0.2 * bench + 0.5 * wall) * (0.97 + 0.03 * fbm(cx * 9, cz * 9, s + 5, 2));
    }
    case 'alpine': {
      const m = ridged(cx, cz, s, 4);
      return ring.amp * (0.1 + 0.9 * Math.pow(m, 1.55)) * (0.94 + 0.06 * fbm(cx * 7, cz * 7, s + 4, 2));
    }
    case 'volcano': {
      let h = ring.amp * 0.42 * (0.35 + 0.65 * ridged(cx, cz, s, 3));
      if (k === CONE_RING) {
        for (const b of style.cones) {
          let d = theta - b;
          d -= Math.round(d / TAU) * TAU;
          const arc = Math.abs(d) * ring.radius;
          const m = Math.max(0, 1 - arc / CONE_HALF_WIDTH);
          if (m <= 0) continue;
          const top = ring.amp * 1.3;
          const crater = Math.max(0, 1 - arc / 11);
          const flank = 1 + 0.07 * fbm(theta * 40, k, seed + 11, 3);
          const cone = Math.max(0, top * Math.pow(m, 1.45) * flank - crater * crater * 9);
          if (cone > h) h = cone;
          if (m > out.cone) out.cone = m;
        }
      }
      return h;
    }
  }
}

export interface BackdropOptions {
  /** C6 (look.edge.ringBase): metres added to every ring's foot height (raises / sinks the ranges against the horizon) */
  ringBase?: number;
}

export function buildBackdrop(style: SkyStyle, seed: number, opts: BackdropOptions = {}): Backdrop {
  const lift = opts.ringBase ?? 0;
  const cols = RING_COLS + 1;
  const vertCount = 3 * cols * 2;
  const pos = new Float32Array(vertCount * 3);
  const tint = new Float32Array(vertCount * 3);
  const aA = new Float32Array(vertCount * 4);
  const aB = new Float32Array(vertCount * 2);
  const index = new Uint16Array(3 * RING_COLS * 6);
  const craters: Crater[] = [];
  const color = new Color();
  const hs = new Float32Array(RING_COLS);
  const cones = new Float32Array(RING_COLS);
  const out = { cone: 0 };
  let ii = 0;

  style.rings.forEach((ring, k) => {
    color.set(ring.tint);
    for (let i = 0; i < RING_COLS; i++) {
      hs[i] = profile(style, ring, k, (i / RING_COLS) * TAU, seed, out);
      cones[i] = out.cone;
    }
    const ds = (TAU / RING_COLS) * ring.radius;
    for (let i = 0; i < cols; i++) {
      const w = i % RING_COLS;
      const theta = (i / RING_COLS) * TAU;
      const h = hs[w] as number;
      const slope = ((hs[(w + 1) % RING_COLS] as number) - (hs[(w + RING_COLS - 1) % RING_COLS] as number)) / (2 * ds);
      const x = Math.sin(theta) * ring.radius;
      const z = -Math.cos(theta) * ring.radius;
      const top = (k * cols + i) * 2;
      for (let side = 0; side < 2; side++) {
        const v = top + side;
        const bottom = side === 1;
        pos[v * 3] = x;
        pos[v * 3 + 1] = bottom ? ring.base + lift - FOOT_DEPTH : ring.base + lift + h;
        pos[v * 3 + 2] = z;
        tint[v * 3] = color.r;
        tint[v * 3 + 1] = color.g;
        tint[v * 3 + 2] = color.b;
        aA[v * 4] = bottom ? -FOOT_DEPTH : h;
        aA[v * 4 + 1] = h;
        aA[v * 4 + 2] = slope;
        aA[v * 4 + 3] = cones[w] as number;
        aB[v * 2] = i / RING_COLS;
        aB[v * 2 + 1] = ring.haze;
      }
    }
    for (let i = 0; i < RING_COLS; i++) {
      const a = (k * cols + i) * 2;
      index.set([a, a + 1, a + 2, a + 2, a + 1, a + 3], ii);
      ii += 6;
    }
    if (k === CONE_RING) {
      for (const b of style.cones) {
        const peak = hs[Math.round((((b % TAU) + TAU) % TAU) / TAU * RING_COLS) % RING_COLS] as number;
        craters.push({ dirX: Math.sin(b), dirZ: -Math.cos(b), y: ring.base + lift + peak, radius: ring.radius });
      }
    }
  });

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(pos, 3));
  geometry.setAttribute('aTint', new BufferAttribute(tint, 3));
  geometry.setAttribute('aA', new BufferAttribute(aA, 4));
  geometry.setAttribute('aB', new BufferAttribute(aB, 2));
  geometry.setIndex(new BufferAttribute(index, 1));
  return { geometry, craters };
}
