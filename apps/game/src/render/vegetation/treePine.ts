// Conifers: a gently curved, tapered trunk with spiralling whorls of drooping boughs; every bough carries two rolled
// needle-spray cards (a shallow V, so the spray reads from above and from the side) plus a smaller inner card.
import { cross, dirFromAngles, lerp, madd, mul, norm, saturate, smoothstep, sub, type V3 } from './geom';
import { range, taper, TreeGen, UP, type TreeGenInput, type TreeParts } from './treeCommon';

export function buildPine(inp: TreeGenInput): TreeParts {
  const g = new TreeGen(inp);
  const r = g.r;
  const d = g.dims;
  const snowy = inp.species === 'snowpine';
  const H = d.height * range(r, 0.9, 1.1);
  g.H = H;
  const crownR = d.crownRadius * range(r, 0.88, 1.14);
  const base = d.crownBase * range(r, 0.85, 1.3);
  const r0 = d.trunkR * range(r, 0.92, 1.1);
  const leanAz = range(r, 0, Math.PI * 2);
  const lean = range(r, 0.0, 0.035);
  const curve = range(r, 0.05, 0.22);
  const curvePh = range(r, 0, 6.3);
  const trunkAt = (y: number): V3 => {
    const t = y / H;
    return [Math.cos(leanAz) * lean * H * t * t + curve * Math.sin(t * 2.4 + curvePh) * t, y, Math.sin(leanAz) * lean * H * t * t + curve * Math.cos(t * 2.1 + curvePh) * t];
  };

  // ---- trunk (rings denser near the root flare)
  const lod0 = g.lod === 0;
  const rings = lod0 ? 13 : 6;
  const tpts: V3[] = [];
  const trad: number[] = [];
  for (let i = 0; i < rings; i++) {
    const t = Math.pow(i / (rings - 1), 1.5);
    const y = t * H * 0.985;
    tpts.push(trunkAt(y));
    const flare = 1 + 0.75 * Math.exp(-y / 0.3);
    trad.push((0.03 + r0 * Math.pow(1 - t, 0.85)) * flare);
  }
  const axisX = (y: number): number => trunkAt(y)[0];
  const axisZ = (y: number): number => trunkAt(y)[2];
  g.tube(tpts, trad, {
    noThin: true,
    sides: lod0 ? 9 : 5,
    ao: (p) => (0.72 + 0.28 * smoothstep(0, 0.7, p[1])) * (1 - 0.4 * smoothstep(base * 0.8, base * 1.5, p[1])),
  });
  // root buttresses (hidden at LOD1)
  const rootN = 4 + Math.floor(r.next() * 2);
  const rootAz0 = range(r, 0, 6.3);
  for (let i = 0; i < rootN; i++) {
    const az = rootAz0 + (i / rootN) * Math.PI * 2 + range(r, -0.3, 0.3);
    const len = range(r, 0.7, 1.2);
    if (!lod0) continue;
    const pts = [madd(trunkAt(0.45), [Math.cos(az), 0, Math.sin(az)], r0 * 0.5), madd(trunkAt(0.1), [Math.cos(az), 0, Math.sin(az)], r0 + len * 0.45), madd(trunkAt(-0.15), [Math.cos(az), 0, Math.sin(az)], r0 + len)];
    g.tube(pts, [r0 * 0.34, r0 * 0.2, r0 * 0.07], { sides: 5, ao: () => 0.7, mask: 0 });
  }

  // ---- boughs
  const W = 10 + Math.floor(r.next() * 4);
  const cropAo = (p: V3): number => {
    const t = saturate((p[1] - base) / (H - base));
    const prof = crownR * (0.16 + 0.84 * Math.pow(1 - t, 0.85));
    const rr = Math.hypot(p[0] - axisX(p[1]), p[2] - axisZ(p[1]));
    const inner = smoothstep(0.05, 0.95, rr / (prof + 0.25));
    const vert = 0.55 + 0.45 * smoothstep(base - 0.3, H * 0.95, p[1]);
    return (0.4 + 0.6 * inner) * vert;
  };
  const crownN = (p: V3): V3 => {
    const rx = p[0] - axisX(p[1]);
    const rz = p[2] - axisZ(p[1]);
    const rl = Math.hypot(rx, rz) + 1e-4;
    const t = saturate((p[1] - base) / (H - base));
    // upper tiers face the sky, the skirt faces outwards
    const up = 0.55 + 0.35 * t;
    return norm([(rx / rl) * 0.72, up, (rz / rl) * 0.72]);
  };
  const rc = g.rc;
  for (let j = 0; j < W; j++) {
    const t = (j + 0.5) / W;
    const y = base + 0.45 + (H * 0.955 - base - 0.45) * Math.pow(t, 0.9);
    const prof = Math.pow(1 - t, 0.82);
    const R = crownR * (0.2 + 0.8 * prof) * range(r, 0.92, 1.1);
    const nb = Math.max(3, Math.round(3 + (1 - t) * 3 + range(r, -0.4, 0.8)));
    const az0 = range(r, 0, Math.PI * 2);
    for (let i = 0; i < nb; i++) {
      const az = az0 + (i / nb) * Math.PI * 2 + range(r, -0.3, 0.3);
      const gap = r.next() < 0.08 && t < 0.8;
      const L = Math.max(0.5, R * range(r, 0.85, 1.12));
      const elev0 = lerp(-0.08, 0.5, t) + range(r, -0.08, 0.1);
      const dropTotal = lerp(0.75, 0.3, t) * range(r, 0.8, 1.15);
      if (gap) continue;
      // bough path: heading droops along its length
      const start = madd(trunkAt(y), [Math.cos(az), 0, Math.sin(az)], r0 * 0.35);
      const pts: V3[] = [start];
      const steps = 4;
      let p = start;
      for (let s = 0; s < steps; s++) {
        const f = (s + 0.5) / steps;
        const dir = dirFromAngles(az, elev0 - dropTotal * Math.pow(f, 1.25));
        p = madd(p, dir, L / steps);
        pts.push(p);
      }
      const rb = 0.008 + 0.02 * L;
      if (lod0) g.tube(pts.slice(0, 4), taper(4, rb, 0.005, 1), { sides: 4, ao: cropAo, flutter: 0.15 });
      // needle cards
      const at = (f: number): { p: V3; dir: V3 } => {
        const k = Math.min(steps - 0.001, f * steps);
        const a = pts[Math.floor(k)] as V3;
        const b = pts[Math.floor(k) + 1] as V3;
        const fr = k - Math.floor(k);
        return { p: [a[0] + (b[0] - a[0]) * fr, a[1] + (b[1] - a[1]) * fr, a[2] + (b[2] - a[2]) * fr], dir: norm(sub(b, a)) };
      };
      const flatLat = (dir: V3): V3 => norm(cross(UP, dir));
      const droopVec: V3 = [0, -0.28 * L * dropTotal, 0];
      const cardsAt: Array<{ f: number; w: number; h: number; rolls: number[] }> = lod0
        ? [
            { f: 0.62, w: 1.05, h: 0.78, rolls: [0.5, -0.5] },
            { f: 0.3, w: 0.75, h: 0.5, rolls: [0.0] },
          ]
        : [{ f: 0.55, w: 1.1, h: 0.9, rolls: [0.45, -0.45] }];
      for (const ca of cardsAt) {
        const { p: cp, dir } = at(ca.f);
        const lat = flatLat(dir);
        for (const roll of ca.rolls) {
          // roll the card about the bough axis
          const c = Math.cos(roll);
          const s = Math.sin(roll);
          const u: V3 = [lat[0] * c + UP[0] * s, lat[1] * c + UP[1] * s, lat[2] * c + UP[2] * s];
          const sz = L * ca.h * range(rc, 0.92, 1.12);
          const wid = Math.min(L * ca.w, 2.4) * range(rc, 0.92, 1.1);
          const tint: V3 = [range(rc, 0.92, 1.08), range(rc, 0.94, 1.08), range(rc, 0.92, 1.06)];
          const sel = snowy ? (rc.next() < 0.12 + 0.82 * smoothstep(0, 0.5, t) ? 0 : 1) : 0;
          g.card(madd(cp, mul(UP, -0.06), 1), u, dir, wid, sz * 1.5, {
            nu: lod0 ? 2 : 1,
            nv: lod0 ? 3 : 1,
            bulge: 0.06 * L,
            droop: droopVec,
            anchor: 0.5,
            sel,
            tint,
            normal: crownN,
            ao: cropAo,
            flutter: 0.6,
            flip: rc.next() < 0.5,
          });
        }
      }
    }
  }
  // ---- leader: three crossed vertical cards forming the tip
  const tipBase = H * 0.8;
  for (let i = 0; i < (lod0 ? 3 : 2); i++) {
    const az = (i / 3) * Math.PI + range(rc, 0, 0.5);
    const u: V3 = [Math.cos(az), 0, Math.sin(az)];
    const y0 = tipBase + range(rc, 0, 0.3);
    const ctr = trunkAt(y0);
    g.card(ctr, u, UP, 1.15, H * 1.02 - y0, {
      nu: 1,
      nv: lod0 ? 3 : 1,
      bulge: 0.05,
      anchor: 0,
      sel: snowy ? (i === 0 ? 0 : 1) : 0,
      tint: [1, 1, 1],
      normal: (p) => norm([(p[0] - axisX(p[1])) * 0.5, 0.9, (p[2] - axisZ(p[1])) * 0.5]),
      ao: (p) => 0.7 + 0.3 * smoothstep(tipBase, H, p[1]),
      flutter: 0.5,
    });
  }
  return { bark: g.bark, foliage: g.fol };
}
