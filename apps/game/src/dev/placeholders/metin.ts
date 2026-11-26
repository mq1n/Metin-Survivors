// DEV-only: metin stone — a tall cracked monolith split into irregular chunks (each its own bone so `shatter` really
// breaks it apart), glowing rune seams between the chunks, leaning crystal shards around the base and orbiting rune
// fragments. Clips: drop, idle, pulse, shatter.
import type { Matrix4 } from 'three';
import { BufferAttribute, BufferGeometry } from 'three';
import type { PlaceholderModel } from '../../engine/assets';
import { assembleModel } from './model';
import { MeshBuilder, circle, mat, type Section } from './parts';
import { Rng, noise3, smoothstep, type RGB, type Vec3 } from './math';
import { bakeClips, Rig, type ClipSpec, type Pose } from './rig';
import { rgb, toHex } from './sdf';

const TAU = Math.PI * 2;

const SCHEMES: { stone: string; stone2: string; glow: string; crystal: string }[] = [
  { stone: '#4d5578', stone2: '#7a82a8', glow: '#5be0ff', crystal: '#9fe9ff' },
  { stone: '#6a4034', stone2: '#98644e', glow: '#ff7a30', crystal: '#ffb066' },
  { stone: '#6a7e8a', stone2: '#a0b6c4', glow: '#c8f4ff', crystal: '#d8f8ff' },
  { stone: '#3f6350', stone2: '#68927d', glow: '#7dff9a', crystal: '#a8ffbf' },
  { stone: '#62497a', stone2: '#9272b0', glow: '#ff6ad0', crystal: '#ffa0e6' },
];

interface Chunk {
  name: string;
  b: MeshBuilder;
  centre: Vec3;
}

function centroid(b: MeshBuilder): Vec3 {
  const bb = b.bounds();
  return [(bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2, (bb.min[2] + bb.max[2]) / 2];
}

export function makeMetin(id: string, seed: number): PlaceholderModel {
  const rng = new Rng(seed ^ 0x3e71);
  const sch = (SCHEMES[/sorrow/.test(id) ? 0 : /ember|fire/.test(id) ? 1 : /frost|ice/.test(id) ? 2 : seed % SCHEMES.length] ?? SCHEMES[0]) as (typeof SCHEMES)[number];
  const stone = rgb(sch.stone);
  const stone2 = rgb(sch.stone2);
  const glow = rgb(sch.glow);
  const glowBright: RGB = [Math.min(1, glow[0] * 2.2), Math.min(1, glow[1] * 2.2), Math.min(1, glow[2] * 2.2)];
  const crystal = rgb(sch.crystal);
  const twist = rng.range(-0.35, 0.35);
  const lean = rng.range(0.02, 0.07);

  const tierY = [0, 0.95, 1.9, 2.7];
  const apexTop = [3.55, 4.1, 3.8];
  const R = (y: number): number => (y < 0.95 ? 1.0 - 0.06 * (y / 0.95) : y < 1.9 ? 0.94 - 0.14 * ((y - 0.95) / 0.95) : 0.8 - 0.14 * Math.min(1, (y - 1.9) / 0.8));
  const shift = tierY.map((_, i) => [(i === 0 ? 0 : rng.range(-0.09, 0.09)) as number, (i === 0 ? 0 : rng.range(-0.09, 0.09)) as number] as const);
  // hexagon-ish outline with chiselled irregularity, scaled to the radius `base`
  const outline = (th: number, y: number, base: number): number => {
    const sect = TAU / 6;
    const a = ((((th + twist * y) % sect) + sect) % sect) - sect / 2;
    const hex = Math.cos(Math.PI / 6) / Math.cos(a);
    const round = 0.3;
    const irr = 1 + 0.1 * Math.sin(th * 3 + 1.3 + y * 0.9) + 0.06 * Math.sin(th * 7 + y * 2.1) + 0.05 * (noise3(Math.cos(th) * 1.7, y * 1.3, Math.sin(th) * 1.7, seed) - 0.5);
    return base * (hex * (1 - round) + round) * irr;
  };
  const seam = (th: number, y: number): number => 0.04 * (noise3(th * 2.2, y * 2.6, 3.1, seed + 11) - 0.5);

  const chunks: Chunk[] = [];
  const sectors = 3;
  const AF = [0, 0.04, 0.14, 0.26, 0.38, 0.5, 0.62, 0.74, 0.86, 0.96, 1];
  const VF = [0, 0.04, 0.2, 0.36, 0.52, 0.68, 0.84, 0.96, 1];
  const groove = 0.022;
  const veinGlow: RGB = [glow[0] * 1.7, glow[1] * 1.7, glow[2] * 1.7];

  for (let t = 0; t < tierY.length; t++) {
    const y0 = tierY[t] as number;
    const off = t * 0.9 + rng.range(0, 0.4);
    for (let sct = 0; sct < sectors; sct++) {
      const y1 = t < 3 ? (tierY[t + 1] as number) : (apexTop[sct] as number);
      const th0 = off + (sct / sectors) * TAU;
      const th1 = off + ((sct + 1) / sectors) * TAU;
      const thMid = (th0 + th1) / 2;
      const b = new MeshBuilder();
      const grid: { p: Vec3; c: RGB }[][] = [];
      for (let vi = 0; vi < VF.length; vi++) {
        const edgeV = vi === 0 || vi === VF.length - 1;
        const row: { p: Vec3; c: RGB }[] = [];
        for (let ai = 0; ai < AF.length; ai++) {
          const edgeA = ai === 0 || ai === AF.length - 1;
          const thRaw = th0 + (th1 - th0) * (AF[ai] as number);
          const th = thRaw + (edgeA ? seam(thRaw, y0) : 0);
          let y = y0 + (y1 - y0) * (VF[vi] as number);
          if (edgeV && vi === 0) y += seam(th, y) * 0.6;
          const kk = t < 3 ? 0 : (y - y0) / (y1 - y0);
          const base = t < 3 ? R(y) : (R(2.7) * 0.9) * Math.pow(1 - kk, 0.72) + 0.02;
          let r = outline(th, y, base);
          const inset = edgeA || (edgeV && vi === 0) ? groove : 0;
          r = Math.max(0.01, r - inset);
          const ox = shift[t]![0] + (t === 3 ? Math.cos(thMid) * 0.34 * kk : 0);
          const oz = shift[t]![1] + (t === 3 ? Math.sin(thMid) * 0.34 * kk : 0);
          const pp: Vec3 = [Math.cos(th) * r + lean * y + ox, y, Math.sin(th) * r + oz];
          // stone colour: height gradient + chiselled noise + glowing vein contours
          const n1 = noise3(pp[0] * 3.1, pp[1] * 2.3, pp[2] * 3.1, seed);
          const n2 = noise3(pp[0] * 9, pp[1] * 7, pp[2] * 9, seed + 3);
          const k = 0.8 + 0.5 * n1 + 0.25 * (n2 - 0.5) + 0.12 * (pp[1] / 4);
          let c: RGB = [stone[0] + (stone2[0] - stone[0]) * n1, stone[1] + (stone2[1] - stone[1]) * n1, stone[2] + (stone2[2] - stone[2]) * n1];
          c = [c[0] * k, c[1] * k, c[2] * k];
          const vein = 1 - smoothstep(0.0, 0.1, Math.abs(noise3(pp[0] * 1.9, pp[1] * 0.85, pp[2] * 1.9, seed + 21) - 0.5));
          c = [c[0] + (veinGlow[0] - c[0]) * vein, c[1] + (veinGlow[1] - c[1]) * vein, c[2] + (veinGlow[2] - c[2]) * vein];
          if (edgeA || (edgeV && vi === 0)) c = glowBright;
          else if (ai === 1 || ai === AF.length - 2 || vi === 1) {
            c = [c[0] * 0.6 + glow[0] * 0.22, c[1] * 0.6 + glow[1] * 0.22, c[2] * 0.6 + glow[2] * 0.22];
          }
          row.push({ p: pp, c });
        }
        grid.push(row);
      }
      // outer surface (outward = counter-clockwise seen from outside: angle increases to the left, height up)
      for (let vi = 0; vi < VF.length - 1; vi++) {
        for (let ai = 0; ai < AF.length - 1; ai++) {
          const a = (grid[vi] as (typeof grid)[number])[ai] as { p: Vec3; c: RGB };
          const bq = (grid[vi] as (typeof grid)[number])[ai + 1] as { p: Vec3; c: RGB };
          const c = (grid[vi + 1] as (typeof grid)[number])[ai + 1] as { p: Vec3; c: RGB };
          const d = (grid[vi + 1] as (typeof grid)[number])[ai] as { p: Vec3; c: RGB };
          b.quadColors(a.p, bq.p, c.p, d.p, a.c, bq.c, c.c, d.c);
        }
      }
      // caps (fan to each ring's centroid) and radial sides — closes the chunk so shattered pieces are solid
      const dark: RGB = [stone[0] * 0.45, stone[1] * 0.45, stone[2] * 0.5];
      const rowCentre = (vi: number): Vec3 => {
        const y = ((grid[vi] as (typeof grid)[number])[0] as { p: Vec3 }).p[1];
        const kk = t < 3 ? 0 : (y - y0) / (y1 - y0);
        return [lean * y + shift[t]![0] + Math.cos(thMid) * 0.34 * kk, y, shift[t]![1] + Math.sin(thMid) * 0.34 * kk];
      };
      const capRing = (vi: number, up: boolean): void => {
        const row = grid[vi] as (typeof grid)[number];
        const ax = rowCentre(vi);
        for (let ai = 0; ai < row.length - 1; ai++) {
          const a = (row[ai] as { p: Vec3 }).p;
          const bq = (row[ai + 1] as { p: Vec3 }).p;
          if (up) b.tri(ax, bq, a, () => dark);
          else b.tri(ax, a, bq, () => dark);
        }
      };
      capRing(VF.length - 1, false);
      capRing(0, true);
      for (const end of [0, AF.length - 1]) {
        for (let vi = 0; vi < VF.length - 1; vi++) {
          const lo = (grid[vi] as (typeof grid)[number])[end] as { p: Vec3 };
          const hi = (grid[vi + 1] as (typeof grid)[number])[end] as { p: Vec3 };
          const a0 = rowCentre(vi);
          const a1 = rowCentre(vi + 1);
          const glowDim: RGB = [glow[0] * 0.7, glow[1] * 0.7, glow[2] * 0.7];
          if (end === 0) b.quadColors(a0, a1, hi.p, lo.p, dark, dark, glowDim, glowDim);
          else b.quadColors(a0, lo.p, hi.p, a1, dark, glowDim, glowDim, dark);
        }
      }
      chunks.push({ name: `chunk_${t}_${sct}`, b, centre: centroid(b) });
    }
  }

  // leaning crystal shards around the base
  const shardN = 5;
  for (let i = 0; i < shardN; i++) {
    const ang = (i / shardN) * TAU + rng.range(-0.3, 0.3);
    const dist = rng.range(0.95, 1.2);
    const h = rng.range(0.7, 1.15);
    const w = rng.range(0.13, 0.19);
    const sb = new MeshBuilder();
    const rings = [
      { y: 0, r: w * 0.85 },
      { y: h * 0.35, r: w },
      { y: h * 0.72, r: w * 0.7 },
      { y: h, r: 0.012 },
    ];
    const secs: Section[] = rings.map((rg, k) => ({
      c: [0, rg.y, 0],
      ax: [1, 0, 0],
      ay: [0, 0, -1],
      pts: circle(6, rg.r, rg.r, k * 0.15),
      color: (_p, _n, _i, j) => {
        const v = 0.55 + 0.45 * ((j * 37 + k * 11) % 7) / 6;
        const kk = 0.7 + 0.35 * (k / 3);
        return [crystal[0] * v * kk, crystal[1] * v * kk, crystal[2] * v * kk] as RGB;
      },
    }));
    sb.loft(secs, { flat: true, capStart: true, capEnd: true });
    const tilt = rng.range(0.25, 0.5);
    const m: Matrix4 = mat([Math.cos(ang) * dist, -0.03, Math.sin(ang) * dist], [Math.sin(ang) * tilt, 0, -Math.cos(ang) * tilt]);
    const placed = new MeshBuilder();
    placed.append(sb, m);
    chunks.push({ name: `shard_${i}`, b: placed, centre: centroid(placed) });
  }
  // orbiting rune fragments
  const fragN = 3;
  for (let i = 0; i < fragN; i++) {
    const ang = (i / fragN) * TAU + 0.5;
    const fb = new MeshBuilder();
    const rs = rng.range(0.09, 0.13);
    fb.lathe([[0.001, -rs * 1.5], [rs, 0], [0.001, rs * 1.5]], 4, {
      flat: true,
      color: (_p, _n, k, j) => {
        const v = 0.6 + 0.4 * (((j + k * 3) % 4) / 3);
        return [glow[0] * v * 1.4, glow[1] * v * 1.4, glow[2] * v * 1.4] as RGB;
      },
    });
    const placed = new MeshBuilder();
    placed.append(fb, mat([Math.cos(ang) * 0.95 + lean * 2.9, 2.9 + 0.2 * Math.sin(i * 2.1), Math.sin(ang) * 0.95], [0.3, ang, 0.2]));
    chunks.push({ name: `frag_${i}`, b: placed, centre: centroid(placed) });
  }

  // rig: root, core, apex + one bone per chunk (bone at the chunk centre)
  const rig = new Rig();
  rig.add('root', null, [0, 0, 0]);
  rig.add('core', 'root', [lean * 1.7, 1.7, 0]);
  rig.add('apex', 'root', [lean * 3.8, 3.8, 0]);
  for (const c of chunks) rig.add(c.name, 'root', c.centre);

  // merge all chunks into one skinned geometry (each vertex rigidly bound to its chunk bone)
  const merged = new MeshBuilder();
  const boneOfVertex: number[] = [];
  for (const c of chunks) {
    const bi = rig.i(c.name);
    const before = merged.vertexCount;
    merged.append(c.b);
    for (let i = before; i < merged.vertexCount; i++) boneOfVertex.push(bi);
  }
  const geometry: BufferGeometry = merged.toGeometry();
  const nv = merged.vertexCount;
  const skinIndex = new Uint16Array(nv * 4);
  const skinWeight = new Float32Array(nv * 4);
  for (let i = 0; i < nv; i++) {
    skinIndex[i * 4] = boneOfVertex[i] as number;
    skinWeight[i * 4] = 1;
  }
  geometry.setAttribute('skinIndex', new BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new BufferAttribute(skinWeight, 4));

  // ---------------------------------------------------------------- animation
  const chunkNames = chunks.map((c) => c.name);
  const idx = new Map(chunkNames.map((n, i) => [n, i] as const));
  const info = (n: string): { c: Vec3; tier: number; kind: 'chunk' | 'shard' | 'frag' } => {
    const c = (chunks[idx.get(n) as number] as Chunk).centre;
    return { c, tier: n.startsWith('chunk_') ? Number(n.split('_')[1]) : 0, kind: n.startsWith('chunk_') ? 'chunk' : n.startsWith('shard') ? 'shard' : 'frag' };
  };
  const vel = new Map<string, { v: Vec3; w: Vec3; delay: number }>();
  for (const n of chunkNames) {
    const { c, kind } = info(n);
    const dir = Math.atan2(c[2], c[0]) + rng.range(-0.4, 0.4);
    const sp = kind === 'chunk' ? rng.range(1.8, 3.4) : rng.range(2.5, 4.2);
    vel.set(n, {
      v: [Math.cos(dir) * sp, rng.range(2.5, 6) + (kind === 'frag' ? 2 : 0), Math.sin(dir) * sp],
      w: [rng.range(-6, 6), rng.range(-4, 4), rng.range(-6, 6)],
      delay: kind === 'chunk' ? rng.range(0, 0.12) : 0.05,
    });
  }

  const drop = (u: number, p: Pose): void => {
    const T = 1.3;
    const t = u * T;
    const tf = 0.55;
    const fall = t < tf ? 1 - (t / tf) ** 2 : 0;
    p.m('root', 0, 8 * fall, 0);
    p.r('root', 0.22 * fall, 0, -0.14 * fall);
    const after = Math.max(0, t - tf);
    const squash = Math.exp(-after * 6) * Math.sin(after * 22);
    p.s('root', 1);
    for (const n of chunkNames) {
      const { tier, kind } = info(n);
      const wob = Math.exp(-after * 5.5) * Math.sin(after * 20 - tier * 0.9);
      p.m(n, 0, (kind === 'chunk' ? 0.06 : 0.12) * wob * (after > 0 ? 1 : 0), 0);
      p.s(n, 1 + 0.05 * squash * (kind === 'chunk' ? 1 : 0.5) - (t < tf ? 0.0 : 0));
      if (kind === 'shard') p.r(n, 0.05 * wob, 0, 0);
    }
    if (t < tf) for (const n of chunkNames) p.r(n, 0.04 * Math.sin(t * 14 + info(n).c[0]), 0, 0);
  };
  const idle = (u: number, p: Pose): void => {
    const a = TAU * u;
    for (const n of chunkNames) {
      const { c, tier, kind } = info(n);
      if (kind === 'frag') {
        const k = Number(n.split('_')[1]);
        const r0 = Math.hypot(c[0] - lean * c[1], c[2]);
        const ph0 = Math.atan2(c[2], c[0] - lean * c[1]);
        const ph = ph0 + a * (k % 2 ? -1 : 1);
        p.m(n, Math.cos(ph) * r0 - Math.cos(ph0) * r0, 0.12 * Math.sin(a * 2 + k * 2), Math.sin(ph) * r0 - Math.sin(ph0) * r0);
        p.r(n, 0, a * 2, 0.3 * Math.sin(a + k));
      } else if (kind === 'chunk') {
        p.m(n, 0, 0.018 * tier * Math.sin(a + tier * 0.8 + info(n).c[0]), 0);
      } else {
        p.r(n, 0.02 * Math.sin(a + c[0]), 0, 0.02 * Math.cos(a + c[2]));
      }
    }
  };
  const pulse = (u: number, p: Pose): void => {
    const a = TAU * u;
    for (const n of chunkNames) {
      const { c, kind } = info(n);
      const wave = Math.max(0, Math.sin(a - (c[1] / 3.6) * 2.2));
      const w2 = wave * wave;
      p.s(n, 1 + (kind === 'chunk' ? 0.045 : 0.09) * w2);
      if (kind === 'frag') p.r(n, 0, a * 2, 0);
    }
    p.s('root', 1 + 0.012 * Math.sin(a));
  };
  const shatter = (u: number, p: Pose): void => {
    const T = 1.7;
    const t = u * T;
    const shake = t < 0.18 ? Math.sin(t * 90) * 0.03 * (1 - t / 0.18) : 0;
    p.m('root', shake, 0, 0);
    for (const n of chunkNames) {
      const { c } = info(n);
      const v = vel.get(n) as { v: Vec3; w: Vec3; delay: number };
      const tt = Math.max(0, t - 0.18 - v.delay);
      if (tt <= 0) continue;
      const g = -9.8;
      const floor = -c[1] + 0.12;
      const vy = v.v[1];
      // landing time on the ground plane, then a short damped bounce and a slide to rest
      const tl = (-vy - Math.sqrt(vy * vy + 2 * g * floor)) / g;
      let y: number;
      let along: number;
      let spin = 1;
      if (tt < tl) {
        y = vy * tt + 0.5 * g * tt * tt;
        along = tt;
      } else {
        const r = tt - tl;
        y = floor + 0.16 * Math.abs(Math.sin(r * 9)) * Math.exp(-r * 4.5);
        along = tl + 0.3 * (1 - Math.exp(-r * 4));
        spin = Math.exp(-r * 3);
      }
      const spinT = Math.min(tt, tl) + (tt > tl ? 0.35 * (1 - Math.exp(-(tt - tl) * 3)) : 0);
      p.m(n, v.v[0] * along, y, v.v[2] * along);
      p.r(n, v.w[0] * spinT * spin, v.w[1] * spinT * spin, v.w[2] * spinT * spin);
      p.s(n, 1 - smoothstep(1.0, 1.6, t));
    }
    p.s('root', 1);
  };

  const specs: ClipSpec[] = [
    { name: 'drop', duration: 1.3, loop: false, fn: drop, fps: 30 },
    { name: 'idle', duration: 3.2, loop: true, fn: idle },
    { name: 'pulse', duration: 1.2, loop: true, fn: pulse },
    { name: 'shatter', duration: 1.7, loop: false, fn: shatter, fps: 30 },
  ];
  const clips = bakeClips(rig, specs, { posBones: ['root', ...chunkNames], scaleBones: ['root', ...chunkNames] });
  const bb = merged.bounds();
  return assembleModel({
    id,
    kind: 'metin',
    rig,
    parts: [{ name: 'metin', geometry }],
    clips,
    hit: {},
    sockets: { head: 'apex', chest: 'core' },
    height: bb.max[1],
    radius: 1.2,
    palette: [sch.stone, sch.stone2, sch.glow, toHex(crystal)],
  });
}
