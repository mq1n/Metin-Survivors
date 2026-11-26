// Broadleaf and autumn trees: flared, slightly leaning trunk that divides into 3-4 curving primary limbs plus a central
// leader; limbs fork into sub-branches and twigs; every branch tip carries a leaf lobe (outward-facing cards with
// crown-spherical normals). Autumn reuses the skeleton with warm, lobe-coherent hue patches.
import { add, dirFromAngles, madd, mul, norm, smoothstep, type V3 } from './geom';
import { emitBlob, limbPath, pointAt, radiusAt, randPerp, range, taper, TreeGen, UP, type Blob, type TreeGenInput, type TreeParts } from './treeCommon';

// patches mix the red/orange maple card with the green oak card pushed to gold/amber so no crown is a flat red ball
const AUTUMN_PATCHES: Array<{ tint: V3; alt: number }> = [
  { tint: [0.82, 0.78, 0.72], alt: 0 },
  { tint: [1.05, 1.6, 1.0], alt: 0 },
  { tint: [1.55, 1.3, 0.28], alt: 1 },
  { tint: [1.2, 0.85, 0.3], alt: 1 },
];

export function buildBroadleaf(inp: TreeGenInput): TreeParts {
  const g = new TreeGen(inp);
  const r = g.r;
  const d = g.dims;
  const autumn = inp.species === 'autumn';
  const lod0 = g.lod === 0;
  const H = d.height * range(r, 0.92, 1.1);
  g.H = H;
  const crownR = d.crownRadius * range(r, 0.9, 1.1);
  const split = d.crownBase * range(r, 0.85, 1.15);
  const r0 = d.trunkR * range(r, 0.78, 0.95);
  const leanAz = range(r, 0, Math.PI * 2);
  const lean = range(r, 0, 0.05);
  const curve = range(r, 0.1, 0.35);
  const curvePh = range(r, 0, 6.3);
  const trunkAt = (y: number): V3 => {
    const t = y / split;
    return [Math.cos(leanAz) * lean * y + curve * Math.sin(t * 2.6 + curvePh) * t, y, Math.sin(leanAz) * lean * y + curve * Math.cos(t * 2.3 + curvePh) * t];
  };
  const crownCy = split + (H - split) * 0.55;
  const barkAo = (p: V3): number => {
    const radial = Math.hypot(p[0], p[2]) / crownR;
    const under = smoothstep(split * 0.8, split * 1.5, p[1]) * (1 - smoothstep(0.3, 0.95, radial)) * (1 - smoothstep(crownCy + 1.5, H, p[1]));
    return (0.72 + 0.28 * smoothstep(0, 0.7, p[1])) * (1 - 0.42 * under);
  };

  // ---- trunk
  const rings = lod0 ? 9 : 4;
  const tpts: V3[] = [];
  const trad: number[] = [];
  for (let i = 0; i < rings; i++) {
    const t = Math.pow(i / (rings - 1), 1.3);
    const y = t * (split + 0.25);
    tpts.push(trunkAt(y));
    const flare = 1 + 0.9 * Math.exp(-y / 0.38);
    trad.push(r0 * (1 - 0.42 * t) * flare);
  }
  g.tube(tpts, trad, {
    noThin: true,
    cap: true,
    sides: lod0 ? 10 : 6,
    ao: barkAo,
    wobble: (a, t) => 1 + 0.07 * Math.sin(a * 3 + t * 5 + curvePh) * (1 - t * 0.5),
  });
  // root buttresses
  const rootN = 5;
  const rootAz0 = range(r, 0, 6.3);
  for (let i = 0; i < rootN; i++) {
    const az = rootAz0 + (i / rootN) * Math.PI * 2 + range(r, -0.3, 0.3);
    const rl = range(r, 0.9, 1.6);
    if (!lod0) continue;
    const dir: V3 = [Math.cos(az), 0, Math.sin(az)];
    g.tube([madd(trunkAt(0.7), dir, r0 * 0.55), madd(trunkAt(0.2), dir, r0 + rl * 0.4), madd(trunkAt(-0.2), dir, r0 + rl)], [r0 * 0.5, r0 * 0.3, r0 * 0.08], { sides: 5, ao: () => 0.7, mask: 0 });
  }

  // ---- limbs
  const blobs: Blob[] = [];
  const scaleC = crownR / 3.4;
  const pickTint = (): { tint: V3; alt: number } => {
    if (!autumn) return { tint: [1, 1, 1], alt: 0 };
    const w = r.next();
    return AUTUMN_PATCHES[w < 0.35 ? 0 : w < 0.6 ? 1 : w < 0.85 ? 2 : 3] as { tint: V3; alt: number };
  };
  const addBlob = (c: V3, rad: number): void => {
    const t = pickTint();
    blobs.push({ c, r: rad, tint: t.tint, alt: t.alt });
  };
  const limbCount = 3 + (r.next() < 0.45 ? 1 : 0);
  const az0 = range(r, 0, Math.PI * 2);
  const start0 = trunkAt(split);
  for (let li = 0; li <= limbCount; li++) {
    const central = li === limbCount;
    const az = central ? 0 : az0 + (li / limbCount) * Math.PI * 2 + range(r, -0.5, 0.5);
    const elev = central ? range(r, 1.25, 1.45) : range(r, 0.7, 1.05);
    const L = central ? (H - split) * range(r, 0.82, 0.95) : (crownR * 0.85 * range(r, 0.85, 1.1)) / Math.cos(0.85);
    const dir = central ? norm([range(r, -0.15, 0.15), 1, range(r, -0.15, 0.15)]) : dirFromAngles(az, elev);
    const rStart = (trad[trad.length - 1] as number) * (central ? 0.62 : 0.9 / Math.sqrt(limbCount + 1));
    const start = madd(start0, [0, -range(r, 0, 0.35), 0], 1);
    const steps = 7;
    const pts = limbPath(r, start, dir, L, steps, central ? 0.04 : 0.3, 0.12);
    const rEnd = 0.04;
    const limbRad = taper(pts.length, rStart, rEnd, 1.15);
    g.tube(pts, limbRad, { sides: lod0 ? 7 : 4, ao: barkAo, flutter: 0.05 });
    const tip = pts[pts.length - 1] as V3;
    addBlob(tip, range(r, 1.0, 1.3) * scaleC);
    // sub-branches
    const fractions = [0.38, 0.6, 0.82];
    for (const tc of fractions) {
      const kids = r.next() < 0.45 ? 2 : 1;
      for (let ki = 0; ki < kids; ki++) {
        const { p, d: pd } = pointAt(pts, tc);
        const side = randPerp(r, pd);
        const cdir = norm(add(add(mul(pd, 0.55), mul(side, 0.8)), mul(UP, 0.28)));
        const Lc = L * (0.6 - 0.32 * tc) * range(r, 0.8, 1.15);
        const rc0 = radiusAt(rStart, rEnd, 1.15, tc) * 0.58;
        const cpts = limbPath(r, p, cdir, Lc, 4, 0.2, 0.16);
        g.tube(cpts, taper(cpts.length, rc0, 0.02, 1.0), { sides: lod0 ? 5 : 4, ao: barkAo, flutter: 0.25 });
        const ctip = cpts[cpts.length - 1] as V3;
        addBlob(ctip, range(r, 0.85, 1.15) * scaleC);
        // twigs poking out of the lobe (skipped at LOD1)
        const twigs = r.next() < 0.7 ? 2 : 1;
        for (let ti = 0; ti < twigs; ti++) {
          const { p: tp, d: td } = pointAt(cpts, range(r, 0.45, 0.8));
          const tdir = norm(add(add(mul(td, 0.5), mul(randPerp(r, td), 0.85)), mul(UP, 0.2)));
          const tl = Lc * range(r, 0.35, 0.55);
          const tpts2 = limbPath(r, tp, tdir, tl, 2, 0.1, 0.2);
          const addTwigBlob = r.next() < 0.5;
          const tr = r.next();
          if (lod0) g.tube(tpts2, taper(tpts2.length, rc0 * 0.55, 0.012, 1), { sides: 4, ao: barkAo, flutter: 0.4 });
          if (addTwigBlob) addBlob(tpts2[tpts2.length - 1] as V3, (0.6 + tr * 0.3) * scaleC);
        }
      }
    }
  }

  // ---- leaf lobes
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const b of blobs) {
    cx += b.c[0];
    cy += b.c[1];
    cz += b.c[2];
  }
  const crownC: V3 = [cx / blobs.length, cy / blobs.length - 0.1, cz / blobs.length];
  let maxD = 0;
  for (const b of blobs) maxD = Math.max(maxD, Math.hypot(b.c[0] - crownC[0], (b.c[1] - crownC[1]) * 1.3, b.c[2] - crownC[2]) + b.r);
  const cardsPer = lod0 ? 7 : 3;
  for (const b of blobs) emitBlob(g, b, crownC, maxD, cardsPer, lod0 ? [1.15, 1.6] : [1.5, 2.0], 0.12);
  return { bark: g.bark, foliage: g.fol };
}
