// xp_gem: elongated brilliant-cut spirit crystal: table, star + bezel + upper-girdle crown facets, a slightly flared girdle
// (never exactly vertical: the game shader hashes quantised derivative normals, a normal with a zero component sits on a
// hash boundary and speckles), a two-stage pavilion (lower-girdle + main facets down to a ring, then a steep culet pyramid)
// and a small floating needle above the table. Neutral light vertex colours: the game tints per tier.
import { HardMesh } from '../../core/hard/hardmesh.ts';
import type { ModelData } from '../../core/model.ts';
import { Assembly } from './assembly.ts';
import { buildPickup } from './build.ts';
import { type V3, vcross, vdot, vsub } from './geom.ts';
import { hash1 } from './paintkit.ts';

const ZONE = { table: 1, star: 2, bezel: 3, upper: 4, girdle: 5, lower: 6, main: 7, spike: 8, culet: 9 } as const;

export interface GemParams {
  /** girdle radius, table radius (m) */
  R: number;
  rT: number;
  /** y of table, girdle top / bottom (culet at 0) */
  yT: number;
  yGt: number;
  yGb: number;
  /** pavilion mid ring: height as a fraction of the girdle-bottom height, radius as a fraction of R */
  midY: number;
  midR: number;
  /** floating needle above the table (0 = none) */
  spike: number;
  /** whole-gem azimuth offset (rad): keeps facet normals off the shader's hash boundaries */
  twist: number;
}

export const gemParams: GemParams = { R: 0.105, rT: 0.058, yT: 0.292, yGt: 0.226, yGb: 0.212, midY: 0.46, midR: 0.46, spike: 0.05, twist: 0.2 };

export function gemMesh(p: GemParams): { mesh: HardMesh; height: number } {
  const asm = new Assembly();
  const polar = (r: number, ang: number, y: number): V3 => [Math.cos(ang + p.twist) * r, y, -Math.sin(ang + p.twist) * r];
  const centre: V3 = [0, p.yT * 0.55, 0];
  const orient = (m: HardMesh, c: V3, a: V3, b: V3, d: V3): void => {
    const n = vcross(vsub(b, a), vsub(d, a));
    const mid: V3 = [(a[0] + b[0] + d[0]) / 3 - c[0], (a[1] + b[1] + d[1]) / 3 - c[1], (a[2] + b[2] + d[2]) / 3 - c[2]];
    if (vdot(n, mid) < 0) m.tri(a, d, b);
    else m.tri(a, b, d);
  };
  const out = (m: HardMesh, a: V3, b: V3, c: V3): void => orient(m, centre, a, b, c);
  const N = 8;
  const step = (Math.PI * 2) / N;
  const crownH = p.yT - p.yGt;
  const yS = p.yGt + crownH * 0.4;
  const rS = p.rT + (p.R - p.rT) * 0.66;
  const flare = 0.0026; // girdle top radius is smaller than the bottom: faces tilt ~10 deg
  const T: V3[] = [], S: V3[] = [], G: V3[] = [], GM: V3[] = [], Gb: V3[] = [], GMb: V3[] = [], A: V3[] = [];
  const C: V3 = [0, 0, 0];
  for (let k = 0; k < N; k++) {
    const a = k * step, am = a + step / 2;
    T.push(polar(p.rT, a, p.yT));
    S.push(polar(rS, am, yS));
    G.push(polar(p.R - flare, a, p.yGt));
    GM.push(polar(p.R * 0.955 - flare, am, p.yGt));
    Gb.push(polar(p.R, a, p.yGb));
    GMb.push(polar(p.R * 0.955, am, p.yGb));
    A.push(polar(p.R * p.midR, am, p.yGb * p.midY));
  }
  const mod = (k: number): number => (k + N) % N;
  const table = new HardMesh(), star = new HardMesh(), bezel = new HardMesh(), upper = new HardMesh(), girdle = new HardMesh();
  const lower = new HardMesh(), main = new HardMesh(), culet = new HardMesh();
  for (let i = 1; i + 1 < N; i++) out(table, T[0]!, T[i]!, T[i + 1]!);
  for (let k = 0; k < N; k++) {
    out(star, T[k]!, S[k]!, T[mod(k + 1)]!);
    // bezel kite (T_k, S_{k-1}, G_k, S_k)
    out(bezel, T[k]!, S[mod(k - 1)]!, G[k]!);
    out(bezel, T[k]!, G[k]!, S[k]!);
    // upper girdle
    out(upper, S[k]!, G[k]!, GM[k]!);
    out(upper, S[k]!, GM[k]!, G[mod(k + 1)]!);
    // girdle band: G_k -> GM_k -> G_{k+1}
    out(girdle, G[k]!, Gb[k]!, GMb[k]!);
    out(girdle, G[k]!, GMb[k]!, GM[k]!);
    out(girdle, GM[k]!, GMb[k]!, Gb[mod(k + 1)]!);
    out(girdle, GM[k]!, Gb[mod(k + 1)]!, G[mod(k + 1)]!);
    // lower girdle facets
    out(lower, Gb[k]!, GMb[k]!, A[k]!);
    out(lower, GMb[k]!, Gb[mod(k + 1)]!, A[k]!);
    // main facets (apex at the girdle, base between two mid-ring points)
    out(main, Gb[k]!, A[mod(k - 1)]!, A[k]!);
    // culet pyramid
    out(culet, A[k]!, A[mod(k + 1)]!, C);
  }
  asm.add(table, ZONE.table);
  asm.add(star, ZONE.star);
  asm.add(bezel, ZONE.bezel);
  asm.add(upper, ZONE.upper);
  asm.add(girdle, ZONE.girdle);
  asm.add(lower, ZONE.lower);
  asm.add(main, ZONE.main);
  asm.add(culet, ZONE.culet);
  let height = p.yT;
  if (p.spike > 0) {
    // floating needle: a slender six-sided bipyramid hovering above the table
    const sp = new HardMesh();
    const y0 = p.yT + 0.016, y1 = y0 + p.spike;
    const ym = y0 + p.spike * 0.3;
    const r = 0.0135;
    const bot: V3 = [0, y0, 0], top: V3 = [0, y1, 0];
    const ring: V3[] = [];
    const ns = 6;
    for (let k = 0; k < ns; k++) ring.push(polar(r, (k / ns) * Math.PI * 2 + 0.31, ym));
    const c2: V3 = [0, (y0 + y1) / 2, 0];
    for (let k = 0; k < ns; k++) {
      orient(sp, c2, bot, ring[k]!, ring[(k + 1) % ns]!);
      orient(sp, c2, top, ring[(k + 1) % ns]!, ring[k]!);
    }
    asm.add(sp, ZONE.spike);
    height = y1;
  }
  return { mesh: asm.mesh, height };
}

export function buildGem(log: (s: string) => void): ModelData {
  const p = gemParams;
  const { mesh, height } = gemMesh(p);
  const H = height;
  return buildPickup(
    {
      id: 'xp_gem',
      mesh,
      crease: 1,
      ao: { rays: 6, maxDist: 0.05, minElev: 0.3 },
      refine: { maxEdge: () => 10, minEdge: 1, tol: 10, passes: 0, budget: 0 },
      paint: (c, out) => {
        const facet = hash1(Math.round(c.nx * 37) * 7919 + Math.round(c.ny * 37) * 104729 + Math.round(c.nz * 37) * 1299709 + c.zone * 31);
        // alternate light / dark facets for sparkle, with a hot core near the table and culet
        const alt = facet > 0.5 ? 1 : 0;
        const t = Math.min(1, c.y / p.yGb);
        const rad = Math.min(1, Math.hypot(c.x, c.z) / p.R);
        let v: number;
        switch (c.zone) {
          case ZONE.table:
            v = 1;
            break;
          case ZONE.star:
            v = 0.9 + 0.1 * facet;
            break;
          case ZONE.bezel:
            v = 0.62 + 0.3 * alt + 0.12 * (1 - rad);
            break;
          case ZONE.upper:
            v = 0.5 + 0.34 * facet + 0.1 * alt;
            break;
          case ZONE.girdle:
            v = 0.5 + 0.12 * facet;
            break;
          case ZONE.lower:
            v = 0.56 + 0.36 * alt + 0.1 * facet;
            break;
          case ZONE.main:
            v = 0.5 + 0.24 * facet + 0.2 * (1 - t);
            break;
          case ZONE.culet:
            // hot spirit core towards the tip
            v = 0.58 + 0.2 * facet + 0.3 * (1 - Math.min(1, c.y / (p.yGb * p.midY)));
            break;
          default:
            v = 0.97;
        }
        const w = Math.min(1, v);
        out[0] = w; out[1] = w; out[2] = w;
      },
      grade: { floor: 1, gamma: 1 },
    },
    log,
  );
}
