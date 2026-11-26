// Leafless trees: `bare` is a delicate winter tree (trunk forking into ever finer branches, sparse dead-twig cards at the
// tips); `charred` is a lumpy, twisted, blackened trunk with torn top, broken limb stubs and one dead fork.
import { add, dirFromAngles, madd, mul, norm, saturate, smoothstep, type V3 } from './geom';
import { limbPath, pointAt, randPerp, range, taper, TreeGen, UP, type TreeGenInput, type TreeParts } from './treeCommon';

export function buildBare(inp: TreeGenInput): TreeParts {
  const g = new TreeGen(inp);
  const r = g.r;
  const d = g.dims;
  const lod0 = g.lod === 0;
  const H = d.height * range(r, 0.92, 1.1);
  g.H = H;
  const crownR = d.crownRadius * range(r, 0.9, 1.15);
  const split = H * range(r, 0.3, 0.4);
  const r0 = d.trunkR * range(r, 0.8, 1.0);
  const leanAz = range(r, 0, Math.PI * 2);
  const lean = range(r, 0, 0.06);
  const curve = range(r, 0.08, 0.3);
  const curvePh = range(r, 0, 6.3);
  const trunkAt = (y: number): V3 => {
    const t = y / split;
    return [Math.cos(leanAz) * lean * y + curve * Math.sin(t * 2.4 + curvePh) * t, y, Math.sin(leanAz) * lean * y + curve * Math.cos(t * 2.0 + curvePh) * t];
  };
  const barkAo = (p: V3): number => (0.74 + 0.26 * smoothstep(0, 0.7, p[1])) * (0.78 + 0.22 * smoothstep(split * 0.5, H, p[1]));
  const crownC: V3 = [0, split + (H - split) * 0.55, 0];
  const twigNormal = (p: V3): V3 => norm([(p[0] - crownC[0]) * 0.5, 0.85, (p[2] - crownC[2]) * 0.5]);
  const twigAo = (p: V3): number => 0.55 + 0.45 * smoothstep(0, crownR, Math.hypot(p[0], p[2])) * (0.8 + 0.2 * saturate((p[1] - split) / (H - split)));

  const rings = lod0 ? 8 : 4;
  const tpts: V3[] = [];
  const trad: number[] = [];
  for (let i = 0; i < rings; i++) {
    const t = Math.pow(i / (rings - 1), 1.25);
    const y = t * (split + 0.2);
    tpts.push(trunkAt(y));
    trad.push(r0 * (1 - 0.45 * t) * (1 + 0.8 * Math.exp(-y / 0.35)));
  }
  g.tube(tpts, trad, { noThin: true, cap: true, sides: lod0 ? 9 : 5, ao: barkAo, wobble: (a, t) => 1 + 0.06 * Math.sin(a * 4 + t * 6 + curvePh) });
  if (lod0) {
    const rootAz0 = range(r, 0, 6.3);
    for (let i = 0; i < 4; i++) {
      const az = rootAz0 + (i / 4) * Math.PI * 2 + range(r, -0.3, 0.3);
      const dir: V3 = [Math.cos(az), 0, Math.sin(az)];
      g.tube([madd(trunkAt(0.6), dir, r0 * 0.5), madd(trunkAt(0.15), dir, r0 + 0.25), madd(trunkAt(-0.15), dir, r0 + 0.5)], [r0 * 0.4, r0 * 0.22, r0 * 0.06], { sides: 5, ao: () => 0.7, mask: 0 });
    }
  }

  const maxDepth = 5;
  const tips: Array<{ p: V3; d: V3; depth: number; len: number }> = [];
  const branch = (p: V3, dir: V3, L: number, rad: number, depth: number): void => {
    const pts = limbPath(r, p, dir, L, 4, 0.12, 0.2);
    const rEnd = Math.max(0.006, rad * 0.5);
    if (lod0 || depth <= 3) g.tube(pts, taper(pts.length, rad, rEnd, 1), { sides: rad > 0.05 ? 6 : rad > 0.02 ? 4 : 3, ao: barkAo, flutter: Math.min(0.6, depth * 0.12) });
    const { p: tp, d: td } = pointAt(pts, 1);
    if (depth >= maxDepth || rad < 0.014) {
      tips.push({ p: tp, d: td, depth, len: L });
      return;
    }
    // fork at the tip
    const side = randPerp(r, td);
    const spread = range(r, 0.45, 0.8);
    const a = norm(add(add(mul(td, 1 - spread * 0.6), mul(side, spread)), mul(UP, 0.18)));
    const b = norm(add(add(mul(td, 1 - spread * 0.6), mul(side, -spread * range(r, 0.6, 1.1))), mul(UP, 0.18)));
    const sub = rad * 0.66;
    branch(tp, a, L * range(r, 0.66, 0.82), sub, depth + 1);
    branch(tp, b, L * range(r, 0.62, 0.82), sub * range(r, 0.8, 1), depth + 1);
    // a side shoot from the middle of the branch
    if (r.next() < 0.6 && depth < maxDepth - 1) {
      const { p: mp, d: md } = pointAt(pts, range(r, 0.4, 0.7));
      const sd = norm(add(add(mul(md, 0.5), mul(randPerp(r, md), 0.85)), mul(UP, 0.15)));
      branch(mp, sd, L * range(r, 0.42, 0.6), rad * 0.45, depth + 2);
    } else {
      r.next();
      r.next();
    }
  };
  const start0 = trunkAt(split);
  const leaders = 2 + (r.next() < 0.5 ? 1 : 0);
  const az0 = range(r, 0, Math.PI * 2);
  for (let i = 0; i < leaders; i++) {
    const az = az0 + (i / leaders) * Math.PI * 2 + range(r, -0.4, 0.4);
    const dir = dirFromAngles(az, range(r, 0.85, 1.2));
    branch(madd(start0, [0, -range(r, 0, 0.3), 0], 1), dir, (H - split) * range(r, 0.34, 0.46), (trad[trad.length - 1] as number) * 0.7, 1);
  }
  // sparse dead-twig cards at the finest tips
  const cardTint: V3 = g.style.snowy ? [0.78, 0.76, 0.76] : [0.7, 0.62, 0.55];
  const rc = g.rc;
  const keep = lod0 ? 0.55 : 0.3;
  for (const t of tips) {
    if (rc.next() > keep) continue;
    const sz = range(rc, 1.1, 1.8) * (lod0 ? 1 : 1.35);
    const u = randPerp(rc, t.d);
    g.card(madd(t.p, t.d, -0.05), u, t.d, sz * 0.75, sz, {
      nu: 1,
      nv: lod0 ? 2 : 1,
      anchor: 0,
      bulge: 0.05,
      tint: cardTint,
      normal: twigNormal,
      ao: twigAo,
      flutter: 0.45,
      flip: rc.next() < 0.5,
    });
  }
  return { bark: g.bark, foliage: g.fol };
}

export function buildCharred(inp: TreeGenInput): TreeParts {
  const g = new TreeGen(inp);
  const r = g.r;
  const d = g.dims;
  const lod0 = g.lod === 0;
  const H = d.height * range(r, 0.88, 1.1);
  g.H = H;
  const r0 = d.trunkR * range(r, 0.95, 1.15);
  const ph = range(r, 0, 6.3);
  const twist = range(r, 0.2, 0.42);
  // the trunk snaps off at ~70 % of the nominal height; the prongs above it make up the rest
  const Ht = H * range(r, 0.62, 0.74);
  const trunkAt = (y: number): V3 => {
    const t = y / Ht;
    const a = y * 1.2 + ph;
    const tp = Math.pow(Math.max(0, t), 0.7);
    return [twist * Math.sin(a) * tp + 0.1 * y * Math.cos(ph), y, twist * Math.cos(a * 0.9) * tp + 0.1 * y * Math.sin(ph)];
  };
  const barkAo = (p: V3, t: number): number => (0.6 + 0.4 * smoothstep(0, 0.9, p[1])) * (0.84 + 0.16 * t);
  const rings = lod0 ? 12 : 6;
  const tpts: V3[] = [];
  const trad: number[] = [];
  for (let i = 0; i < rings; i++) {
    const t = Math.pow(i / (rings - 1), 1.15);
    const y = t * Ht;
    tpts.push(trunkAt(y));
    trad.push(r0 * (1 - 0.48 * t) * (1 + 1.1 * Math.exp(-y / 0.5)));
  }
  const lumpy = (a: number, t: number): number => 1 + 0.17 * Math.sin(a * 3 + t * 8 + ph) + 0.1 * Math.sin(a * 5 - t * 13) + 0.05 * Math.sin(a * 9 + t * 21);
  g.tube(tpts, trad, { noThin: true, sides: lod0 ? 10 : 6, ao: barkAo, cap: true, mask: 0.6, wobble: lumpy });
  if (lod0) {
    for (let i = 0; i < 5; i++) {
      const az = ph + (i / 5) * Math.PI * 2 + range(r, -0.3, 0.3);
      const dir: V3 = [Math.cos(az), 0, Math.sin(az)];
      g.tube([madd(trunkAt(0.7), dir, r0 * 0.5), madd(trunkAt(0.2), dir, r0 + 0.35), madd(trunkAt(-0.2), dir, r0 + 0.9)], [r0 * 0.45, r0 * 0.25, r0 * 0.07], { sides: 5, ao: () => 0.6 });
    }
  }
  const topR = trad[trad.length - 1] as number;
  const topP = trunkAt(Ht);
  // torn crown: three prongs of different heights, each cut at a slant
  for (let i = 0; i < 3; i++) {
    const az = ph + (i / 3) * Math.PI * 2 + range(r, -0.4, 0.4);
    const dir = dirFromAngles(az, range(r, 1.05, 1.4));
    const L = (H - Ht) * range(r, 0.55, 1.15);
    const pts = limbPath(r, madd(topP, [0, -0.1, 0], 1), dir, L, 3, 0.05, 0.3);
    const last = pts[pts.length - 1] as V3;
    pts[pts.length - 1] = madd(last, randPerp(r, dir), 0.14);
    g.tube(pts, taper(pts.length, topR * 0.78, topR * 0.36, 1), { sides: lod0 ? 7 : 5, ao: barkAo, cap: true, mask: 1, wobble: lumpy });
  }
  // broken limb stubs
  for (let i = 0; i < 2; i++) {
    const y = Ht * range(r, 0.35, 0.8);
    const az = ph + range(r, 0, Math.PI * 2);
    const dir = dirFromAngles(az, range(r, 0.1, 0.7));
    const L = range(r, 0.9, 1.7);
    const rad = (trad[Math.min(trad.length - 1, Math.floor((y / Ht) * (rings - 1)))] as number) * 0.5;
    const pts = limbPath(r, trunkAt(y), dir, L, 4, range(r, -0.15, 0.2), 0.3);
    g.tube(pts, taper(pts.length, rad, rad * 0.5, 1), { sides: lod0 ? 7 : 5, ao: barkAo, cap: true, mask: 1, wobble: lumpy });
  }
  // one dead fork carrying sparse burnt twigs
  const fy = Ht * range(r, 0.55, 0.75);
  const faz = ph + range(r, 0, Math.PI * 2);
  const fpts = limbPath(r, trunkAt(fy), dirFromAngles(faz, 0.75), 2.4, 4, 0.12, 0.2);
  g.tube(fpts, taper(fpts.length, r0 * 0.3, 0.04, 1), { sides: lod0 ? 5 : 4, ao: barkAo, mask: 0.8 });
  const rc = g.rc;
  const tint: V3 = [0.26, 0.22, 0.2];
  const twigs = [pointAt(fpts, 1), pointAt(fpts, 0.65)];
  for (let i = 0; i < twigs.length; i++) {
    const tw = twigs[i] as { p: V3; d: V3 };
    const dir = i === 0 ? tw.d : norm(add(tw.d, mul(randPerp(r, tw.d), 0.9)));
    const sz = range(rc, 1.2, 1.7);
    g.card(tw.p, randPerp(rc, dir), dir, sz * 0.75, sz, {
      nu: 1,
      nv: lod0 ? 2 : 1,
      anchor: 0,
      bulge: 0.05,
      tint,
      normal: () => norm([0.2, 0.9, 0.2]),
      ao: () => 0.8,
      flutter: 0.25,
      flip: rc.next() < 0.5,
    });
  }
  return { bark: g.bark, foliage: g.fol };
}
