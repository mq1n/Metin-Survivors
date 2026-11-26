// Spec atlas painter: every role of roles.ts is drawn procedurally at runtime (canvas 2D for shapes, a GPU pass for the

// (glows, rays, swirls, puffs, strips) whose look is matched to the reference by the spec's colour/scale curves.
import {
  CanvasTexture,
  ClampToEdgeWrapping,
  Color,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  NoBlending,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  WebGLRenderTarget,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { VRng } from '../util';
import { ATLAS_SIZE, CELL_PX, ROLES, type TexRole } from './roles';

type C2 = CanvasRenderingContext2D;
type Painter = (c: C2, w: number, h: number, rng: VRng) => void;

const TAU = Math.PI * 2;

function radial(c: C2, cx: number, cy: number, r: number, stops: ReadonlyArray<readonly [number, number]>, rgb = '255,255,255'): void {
  const g = c.createRadialGradient(cx, cy, 0, cx, cy, r);
  for (const [o, a] of stops) g.addColorStop(o, `rgba(${rgb},${a})`);
  c.fillStyle = g;
  c.fillRect(cx - r, cy - r, r * 2, r * 2);
}

/** thin tapered line from (x0,y0) to (x1,y1), alpha a0 → a1 */
function ray(c: C2, x0: number, y0: number, x1: number, y1: number, w: number, a0: number, a1: number): void {
  const g = c.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, `rgba(255,255,255,${a0})`);
  g.addColorStop(1, `rgba(255,255,255,${a1})`);
  const dx = x1 - x0, dy = y1 - y0;
  const l = Math.hypot(dx, dy) || 1;
  const nx = (-dy / l) * w * 0.5, ny = (dx / l) * w * 0.5;
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(x0 + nx, y0 + ny);
  c.lineTo(x1, y1);
  c.lineTo(x0 - nx, y0 - ny);
  c.closePath();
  c.fill();
}

/** tileable value noise (period px along x when `px` > 0) */
function noiseField(seed: number, cells: number, px = 0): (x: number, y: number) => number {
  const rng = new VRng(seed);
  const n = cells + 1;
  const lat = new Float32Array(n * n);
  for (let i = 0; i < lat.length; i++) lat[i] = rng.f();
  return (x: number, y: number) => {
    let xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const wrap = px > 0 ? px : cells;
    xi = ((xi % wrap) + wrap) % wrap;
    const x1 = (xi + 1) % wrap;
    yi = ((yi % cells) + cells) % cells;
    const y1 = (yi + 1) % cells;
    const a = lat[yi * n + xi] as number, b = lat[yi * n + x1] as number;
    const cc = lat[y1 * n + xi] as number, d = lat[y1 * n + x1] as number;
    return a + (b - a) * sx + (cc - a) * sy + (a - b - cc + d) * sx * sy;
  };
}

function fbm(nf: (x: number, y: number) => number, x: number, y: number, oct: number, per: number): number {
  let s = 0, amp = 0.5, f = 1;
  for (let o = 0; o < oct; o++) {
    s += amp * nf((x * f) % (per * f), y * f);
    amp *= 0.5;
    f *= 2;
  }
  return s;
}

/** writes premultiplied-looking white pixels: fn returns [luminance 0..1, alpha 0..1] */
function pixels(c: C2, w: number, h: number, fn: (u: number, v: number, x: number, y: number) => readonly [number, number]): void {
  const img = c.getImageData(0, 0, w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [l, a] = fn((x + 0.5) / w, (y + 0.5) / h, x, y);
      const o = (y * w + x) * 4;
      const al = Math.max(0, Math.min(1, a));
      const lu = Math.max(0, Math.min(1, l));
      d[o] = d[o + 1] = d[o + 2] = Math.round(255 * lu);
      d[o + 3] = Math.round(255 * al);
    }
  }
  c.putImageData(img, 0, 0);
}

function puff(seed: number, rough: number, edge: number, lumps: number, stretch = 1): Painter {
  return (c, w, h) => {
    const nf = noiseField(seed, 16);
    const rng = new VRng(seed + 7);
    const blobs: Array<[number, number, number]> = [];
    for (let i = 0; i < lumps; i++) blobs.push([0.5 + rng.s2(0.17), 0.5 + rng.s2(0.17), 0.18 + rng.f() * 0.14]);
    pixels(c, w, h, (u, v) => {
      let d = 0;
      for (const [bx, by, br] of blobs) {
        const dd = Math.hypot((u - bx) * stretch, v - by) / br;
        d = Math.max(d, 1 - dd);
      }
      if (lumps === 0) d = 1 - Math.hypot(u - 0.5, v - 0.5) / 0.48;
      const n = fbm(nf, u * 8, v * 8, 4, 16);
      const a = Math.max(0, d * (1 + rough) - rough * (1 - n) * 1.4);
      const al = Math.pow(Math.min(1, a / edge), 1.4);
      const fade = Math.max(0, 1 - Math.hypot(u - 0.5, v - 0.5) / 0.5);
      return [0.75 + 0.25 * n, al * Math.min(1, fade * 3)];
    });
  };
}

function glyph(c: C2, w: number, h: number, rng: VRng, strokes: number, lw: number, style = '#fff'): void {
  c.strokeStyle = style;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  for (let s = 0; s < strokes; s++) {
    c.lineWidth = lw * (0.6 + rng.f() * 0.6);
    c.beginPath();
    let x = w * (0.25 + rng.f() * 0.5), y = h * (0.2 + rng.f() * 0.6);
    c.moveTo(x, y);
    const segs = 2 + rng.i(3);
    for (let k = 0; k < segs; k++) {
      const nx = Math.min(w * 0.85, Math.max(w * 0.15, x + rng.s2(w * 0.35)));
      const ny = Math.min(h * 0.85, Math.max(h * 0.15, y + rng.s2(h * 0.35)));
      if (rng.f() < 0.5) c.lineTo(nx, ny);
      else c.quadraticCurveTo(x + rng.s2(w * 0.2), y + rng.s2(h * 0.2), nx, ny);
      x = nx;
      y = ny;
    }
    c.stroke();
  }
}

function spiralArm(c: C2, cx: number, cy: number, a0: number, turns: number, r0: number, r1: number, wMax: number, aMax: number): void {
  const n = 80;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const a = a0 + t * turns * TAU;
    const r = r0 + (r1 - r0) * t;
    const wv = wMax * Math.sin(Math.PI * t);
    c.fillStyle = `rgba(255,255,255,${aMax * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.1)), 0.7)})`;
    c.beginPath();
    c.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, Math.max(0.6, wv), 0, TAU);
    c.fill();
  }
}

function jagLine(c: C2, x0: number, y0: number, x1: number, y1: number, rng: VRng, amp: number, levels: number): Array<[number, number]> {
  let pts: Array<[number, number]> = [[x0, y0], [x1, y1]];
  let a = amp;
  for (let l = 0; l < levels; l++) {
    const next: Array<[number, number]> = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i] as [number, number], q = pts[i + 1] as [number, number];
      next.push(p);
      next.push([(p[0] + q[0]) / 2 + rng.s2(a * 0.3), (p[1] + q[1]) / 2 + rng.s2(a)]);
    }
    next.push(pts[pts.length - 1] as [number, number]);
    pts = next;
    a *= 0.55;
  }
  return pts;
}

function strokePts(c: C2, pts: ReadonlyArray<readonly [number, number]>, lw: number, alpha: number): void {
  c.strokeStyle = `rgba(255,255,255,${alpha})`;
  c.lineWidth = lw;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? c.moveTo(x, y) : c.lineTo(x, y)));
  c.stroke();
}

function glowStroke(c: C2, pts: ReadonlyArray<readonly [number, number]>, w: number): void {
  strokePts(c, pts, w * 4, 0.08);
  strokePts(c, pts, w * 2.2, 0.22);
  strokePts(c, pts, w, 1);
}

/** arc from a0 to a1 (rad) drawn in short segments: width and alpha follow fw(t) / fa(t) along the length (t 0 → 1) */
function arcSeg(c: C2, cx: number, cy: number, r: number, a0: number, a1: number, fw: (t: number) => number, fa: (t: number) => number, n = 48): void {
  c.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n, tm = (t0 + t1) / 2;
    c.strokeStyle = `rgba(255,255,255,${Math.max(0, Math.min(1, fa(tm)))})`;
    c.lineWidth = Math.max(0.4, fw(tm));
    c.beginPath();
    c.arc(cx, cy, r, a0 + (a1 - a0) * t0, a0 + (a1 - a0) * t1, a1 < a0);
    c.stroke();
  }
}

/** gihyeol_spash layout: upper half-dome band (base on the centre line) with a bright rim and fringe hanging inward */
function splashArchPaint(c: C2, w: number, h: number, rng: VRng): void {
  const cx = w / 2, cy = h * 0.52, R = w * 0.4;
  const g = c.createRadialGradient(cx, cy, R * 0.6, cx, cy, R);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.1)');
  g.addColorStop(0.9, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.beginPath();
  c.arc(cx, cy, R, Math.PI, TAU);
  c.closePath();
  c.fill();
  // fringe: soft streaks from the rim toward the base line, brighter near the rim
  c.filter = 'blur(0.8px)';
  for (let i = 0; i < 80; i++) {
    const a = Math.PI + 0.08 + rng.f() * (Math.PI - 0.16);
    const x = cx + Math.cos(a) * R * 0.97, y = cy + Math.sin(a) * R * 0.97;
    ray(c, x, y, x, Math.min(cy, y + h * (0.04 + rng.f() * 0.14)), 1.5 + rng.f() * 3, 0.25 + rng.f() * 0.35, 0);
  }
  c.filter = 'none';
  // ends of the arch fade into the base line
  arcSeg(c, cx, cy, R * 0.97, Math.PI + 0.04, TAU - 0.04, (t) => 2 + 2.5 * Math.sin(Math.PI * t), (t) => 0.95 * Math.pow(Math.sin(Math.PI * t), 0.6));
}

/** jagged bolt from (x0, y0) to (x1, y1) with a glow, a white core, 0-2 side branches and optional spark dots */
function boltPaint(c: C2, x0: number, y0: number, x1: number, y1: number, rng: VRng, amp: number, branches: number, sparks: number): void {
  const len = Math.hypot(x1 - x0, y1 - y0);
  c.save();
  c.translate(x0, y0);
  c.rotate(Math.atan2(y1 - y0, x1 - x0));
  const pts = jagLine(c, 0, 0, len, 0, rng, amp, 6);
  c.filter = 'blur(3px)';
  strokePts(c, pts, 12, 0.45);
  c.filter = 'none';
  glowStroke(c, pts, 2.4);
  for (let b = 0; b < branches; b++) {
    const p = pts[Math.floor(pts.length * (0.25 + rng.f() * 0.4))] as [number, number];
    const bl = len * (0.2 + rng.f() * 0.25), ang = rng.s2(0.9);
    const bp = jagLine(c, p[0], p[1], p[0] + Math.cos(ang) * bl, p[1] + Math.sin(ang) * bl, rng, amp * 0.6, 4);
    strokePts(c, bp, 2.4, 0.2);
    strokePts(c, bp, 1, 0.75);
  }
  for (let i = 0; i < sparks; i++) {
    const p = pts[rng.i(pts.length)] as [number, number];
    radial(c, p[0] + rng.s2(10), p[1] + rng.s2(14), 1 + rng.f() * 2, [[0, 1], [1, 0]]);
  }
  c.restore();
}

const P: Record<TexRole, Painter> = {
  glow: (c, w) => radial(c, w / 2, w / 2, w / 2 - 1, [[0, 1], [0.2, 0.62], [0.5, 0.2], [0.8, 0.04], [1, 0]]),
  glowCore: (c, w) => {
    radial(c, w / 2, w / 2, w / 2 - 1, [[0, 0.5], [0.4, 0.22], [0.75, 0.06], [1, 0]]);
    radial(c, w / 2, w / 2, w * 0.2, [[0, 1], [0.55, 1], [1, 0]]);
  },
  disc: (c, w) => radial(c, w / 2, w / 2, w / 2 - 2, [[0, 0.9], [0.72, 0.85], [0.9, 0.35], [1, 0]]),
  flare: (c, w, _h, rng) => {
    radial(c, w / 2, w / 2, w / 2, [[0, 0.7], [0.18, 0.3], [0.5, 0.06], [1, 0]]);
    for (let i = 0; i < 26; i++) {
      const a = rng.f() * TAU;
      const l = w * (0.18 + rng.f() * 0.3);
      ray(c, w / 2, w / 2, w / 2 + Math.cos(a) * l, w / 2 + Math.sin(a) * l, 2 + rng.f() * 2, 0.75, 0);
    }
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2 + 0.3;
      ray(c, w / 2, w / 2, w / 2 + Math.cos(a) * w * 0.49, w / 2 + Math.sin(a) * w * 0.49, 4, 1, 0);
    }
    radial(c, w / 2, w / 2, w * 0.1, [[0, 1], [0.5, 0.9], [1, 0]]);
  },
  flare4: (c, w) => {
    radial(c, w / 2, w / 2, w * 0.3, [[0, 0.8], [0.4, 0.2], [1, 0]]);
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      ray(c, w / 2, w / 2, w / 2 + Math.cos(a) * w * 0.49, w / 2 + Math.sin(a) * w * 0.49, 7, 1, 0);
    }
    radial(c, w / 2, w / 2, w * 0.08, [[0, 1], [1, 0]]);
  },
  sparkle: (c, w) => {
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      ray(c, w / 2, w / 2, w / 2 + Math.cos(a) * w * 0.42, w / 2 + Math.sin(a) * w * 0.42, 5, 1, 0);
      const b = a + Math.PI / 4;
      ray(c, w / 2, w / 2, w / 2 + Math.cos(b) * w * 0.18, w / 2 + Math.sin(b) * w * 0.18, 3, 0.7, 0);
    }
    radial(c, w / 2, w / 2, w * 0.16, [[0, 1], [0.4, 0.6], [1, 0]]);
  },
  spark: (c, w) => radial(c, w / 2, w / 2, w * 0.3, [[0, 1], [0.25, 0.95], [0.55, 0.25], [1, 0]]),
  dot: (c, w) => {
    c.fillStyle = '#fff';
    c.beginPath();
    c.arc(w / 2, w / 2, w * 0.36, 0, TAU);
    c.fill();
  },
  streakSoft: (c, w, h) => {
    c.save();
    c.translate(w / 2, h / 2);
    c.scale(0.16, 1);
    radial(c, 0, 0, h / 2 - 1, [[0, 1], [0.35, 0.5], [0.75, 0.1], [1, 0]]);
    c.restore();
  },
  streakHard: (c, w, h) => {
    c.save();
    c.translate(w / 2, h / 2);
    c.scale(0.22, 1);
    radial(c, 0, 0, h / 2 - 1, [[0, 0.7], [0.6, 0.25], [1, 0]]);
    c.restore();
    ray(c, w / 2, h / 2, w / 2, 2, 5, 1, 0.1);
    ray(c, w / 2, h / 2, w / 2, h - 2, 5, 1, 0.1);
  },
  ring: (c, w) => radial(c, w / 2, w / 2, w / 2 - 1, [[0, 0], [0.66, 0], [0.8, 1], [0.92, 0.25], [1, 0]]),
  ringThick: (c, w) => radial(c, w / 2, w / 2, w / 2 - 1, [[0, 0], [0.38, 0], [0.66, 1], [0.86, 0.5], [1, 0]]),
  ringRays: (c, w, _h, rng) => {
    for (let i = 0; i < 90; i++) {
      const a = rng.f() * TAU;
      const r0 = w * (0.26 + rng.f() * 0.1), r1 = w * (0.38 + rng.f() * 0.11);
      ray(c, w / 2 + Math.cos(a) * r0, w / 2 + Math.sin(a) * r0, w / 2 + Math.cos(a) * r1, w / 2 + Math.sin(a) * r1, 1.6 + rng.f() * 1.5, 0.2 + rng.f() * 0.5, 0.9);
    }
  },
  rays: (c, w, _h, rng) => {
    for (let i = 0; i < 110; i++) {
      const a = rng.f() * TAU;
      const l = w * (0.25 + rng.f() * 0.24);
      ray(c, w / 2, w / 2, w / 2 + Math.cos(a) * l, w / 2 + Math.sin(a) * l, 1.4 + rng.f() * 2.2, 0.5 + rng.f() * 0.5, 0);
    }
    radial(c, w / 2, w / 2, w * 0.14, [[0, 0.9], [1, 0]]);
  },
  raysHalf: (c, w, h, rng) => {
    // fan of thin rays from the centre opening toward +v (one half only): on long thin quads it reads as a beam
    for (let i = 0; i < 80; i++) {
      const a = -Math.PI / 2 + (rng.f() - 0.5) * Math.PI * 0.9;
      const l = h * (0.15 + rng.f() * 0.33);
      ray(c, w / 2, h * 0.5, w / 2 + Math.cos(a) * l, h * 0.5 + Math.sin(a) * l, 1.4 + rng.f() * 2.4, 0.55 + rng.f() * 0.45, 0);
    }
    radial(c, w / 2, h * 0.5, w * 0.12, [[0, 0.9], [1, 0]]);
  },
  raysSoft: (c, w, _h, rng) => {
    c.filter = 'blur(1.5px)';
    for (let i = 0; i < 80; i++) {
      const a = rng.f() * TAU;
      const r0 = w * 0.1, r1 = w * (0.35 + rng.f() * 0.14);
      ray(c, w / 2 + Math.cos(a) * r0, w / 2 + Math.sin(a) * r0, w / 2 + Math.cos(a) * r1, w / 2 + Math.sin(a) * r1, 3 + rng.f() * 4, 0.05, 0.55);
    }
    c.filter = 'none';
  },
  swirl2: (c, w) => {
    spiralArm(c, w / 2, w / 2, 0, 0.62, w * 0.08, w * 0.44, w * 0.075, 0.9);
    spiralArm(c, w / 2, w / 2, Math.PI, 0.62, w * 0.08, w * 0.44, w * 0.075, 0.9);
  },
  swirlRing: (c, w, _h, rng) => {
    for (let k = 0; k < 3; k++) {
      const a0 = k * 2.2 + rng.f();
      const n = 50;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const a = a0 + t * 1.8;
        const r = w * (0.36 + 0.04 * Math.sin(t * 3 + k));
        c.fillStyle = `rgba(255,255,255,${0.9 * Math.sin(Math.PI * t)})`;
        c.beginPath();
        c.arc(w / 2 + Math.cos(a) * r, w / 2 + Math.sin(a) * r, 1 + 3 * Math.sin(Math.PI * t), 0, TAU);
        c.fill();
      }
    }
  },
  pinwheel: (c, w) => {
    for (let k = 0; k < 5; k++) spiralArm(c, w / 2, w / 2, (k * TAU) / 5, 0.22, w * 0.05, w * 0.46, w * 0.03, 1);
    radial(c, w / 2, w / 2, w * 0.1, [[0, 1], [1, 0]]);
  },
  vortex: (c, w) => {
    for (let k = 0; k < 7; k++) spiralArm(c, w / 2, w / 2, (k * TAU) / 7, 0.9, w * 0.02, w * 0.46, w * 0.018, 0.75);
  },
  smoke0: puff(11, 0.55, 0.55, 4),
  smoke1: puff(23, 0.8, 0.7, 3, 1.3),
  smoke2: puff(37, 0.35, 0.45, 0),
  smoke3: puff(51, 0.5, 0.5, 6),
  dust: (c, w, h) => {
    const nf = noiseField(91, 32);
    const g = new VRng(5);
    pixels(c, w, h, (u, v) => {
      const d = Math.max(0, 1 - Math.hypot(u - 0.5, v - 0.5) / 0.48);
      const n = fbm(nf, u * 16, v * 16, 3, 32);
      return [0.8 + 0.2 * g.f(), Math.pow(d, 1.2) * (0.35 + 0.65 * n) * (g.f() < 0.85 ? 1 : 0.4)];
    });
  },
  cloud: puff(67, 0.25, 0.9, 0),
  splashSpike: (c, w, h, rng) => {
    for (let i = 0; i < 26; i++) {
      const a = -Math.PI / 2 + (rng.f() - 0.5) * 1.9;
      const l = h * (0.22 + rng.f() * 0.32);
      ray(c, w / 2, h * 0.68, w / 2 + Math.cos(a) * l, h * 0.68 + Math.sin(a) * l, 3 + rng.f() * 3, 1, 0);
    }
    radial(c, w / 2, h * 0.68, w * 0.14, [[0, 0.9], [1, 0]]);
  },
  splat: (c, w, _h, rng) => {
    radial(c, w / 2, w / 2, w * 0.3, [[0, 1], [0.7, 0.9], [1, 0]]);
    for (let i = 0; i < 12; i++) {
      const a = rng.f() * TAU, r = w * (0.3 + rng.f() * 0.15);
      radial(c, w / 2 + Math.cos(a) * r, w / 2 + Math.sin(a) * r, w * (0.03 + rng.f() * 0.05), [[0, 1], [0.7, 0.8], [1, 0]]);
    }
  },
  plasma: (c, w, _h, rng) => {
    radial(c, w / 2, w / 2, w * 0.45, [[0, 0.35], [0.6, 0.12], [1, 0]]);
    for (let i = 0; i < 9; i++) {
      const a0 = rng.f() * TAU, a1 = a0 + 1.5 + rng.f() * 2;
      const r = w * (0.2 + rng.f() * 0.22);
      const pts = jagLine(c, w / 2 + Math.cos(a0) * r, w / 2 + Math.sin(a0) * r, w / 2 + Math.cos(a1) * r * 0.8, w / 2 + Math.sin(a1) * r * 0.8, rng, w * 0.12, 4);
      glowStroke(c, pts, 1.4);
    }
  },
  petal: (c, w, h) => {
    c.fillStyle = '#fff';
    c.beginPath();
    c.moveTo(w / 2, h * 0.1);
    c.bezierCurveTo(w * 0.95, h * 0.35, w * 0.7, h * 0.85, w / 2, h * 0.92);
    c.bezierCurveTo(w * 0.3, h * 0.85, w * 0.05, h * 0.35, w / 2, h * 0.1);
    c.fill();
    radial(c, w / 2, h * 0.6, w * 0.3, [[0, 0.5], [1, 0]], '255,255,255');
  },
  leaf: (c, w, h) => {
    c.fillStyle = 'rgba(255,255,255,0.95)';
    c.beginPath();
    c.moveTo(w / 2, h * 0.06);
    c.quadraticCurveTo(w * 0.98, h * 0.45, w / 2, h * 0.94);
    c.quadraticCurveTo(w * 0.02, h * 0.45, w / 2, h * 0.06);
    c.fill();
    c.strokeStyle = 'rgba(120,120,120,0.8)';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(w / 2, h * 0.1);
    c.lineTo(w / 2, h * 0.9);
    c.stroke();
  },
  feather: (c, w, h, rng) => {
    c.strokeStyle = 'rgba(255,255,255,0.9)';
    for (let i = 0; i < 40; i++) {
      const t = i / 39;
      const y = h * (0.12 + t * 0.76);
      const l = w * 0.36 * Math.sin(Math.PI * (0.15 + t * 0.85));
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(w / 2, y);
      c.lineTo(w / 2 - l, y - h * 0.08 + rng.s2(2));
      c.moveTo(w / 2, y);
      c.lineTo(w / 2 + l, y - h * 0.08 + rng.s2(2));
      c.stroke();
    }
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(w / 2, h * 0.05);
    c.lineTo(w / 2, h * 0.97);
    c.stroke();
  },
  shard0: (c, w, h) => {
    const g = c.createLinearGradient(w * 0.35, 0, w * 0.65, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.5, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0.4)');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(w / 2, h * 0.04);
    c.lineTo(w * 0.64, h * 0.6);
    c.lineTo(w / 2, h * 0.96);
    c.lineTo(w * 0.38, h * 0.55);
    c.closePath();
    c.fill();
  },
  shard1: (c, w, h) => {
    c.fillStyle = 'rgba(255,255,255,0.85)';
    c.beginPath();
    c.moveTo(w * 0.3, h * 0.2);
    c.lineTo(w * 0.78, h * 0.32);
    c.lineTo(w * 0.66, h * 0.8);
    c.lineTo(w * 0.24, h * 0.66);
    c.closePath();
    c.fill();
    c.strokeStyle = '#fff';
    c.lineWidth = 3;
    c.stroke();
  },
  ember: (c, w) => {
    radial(c, w / 2, w / 2, w * 0.4, [[0, 0.5], [1, 0]]);
    radial(c, w / 2, w / 2, w * 0.1, [[0, 1], [1, 0.6]]);
  },
  snow: (c, w) => {
    for (let k = 0; k < 6; k++) {
      const a = (k * TAU) / 6;
      ray(c, w / 2, w / 2, w / 2 + Math.cos(a) * w * 0.44, w / 2 + Math.sin(a) * w * 0.44, 6, 1, 0.3);
    }
    radial(c, w / 2, w / 2, w * 0.14, [[0, 1], [1, 0]]);
  },
  rune0: (c, w, h) => glyph(c, w, h, new VRng(101), 4, 9),
  rune1: (c, w, h) => glyph(c, w, h, new VRng(202), 5, 8),
  rune2: (c, w, h) => glyph(c, w, h, new VRng(303), 3, 11),
  rune3: (c, w, h) => glyph(c, w, h, new VRng(404), 6, 7),
  claw: (c, w, h) => {
    for (let k = 0; k < 3; k++) {
      const x = w * (0.3 + k * 0.2);
      c.fillStyle = '#fff';
      c.beginPath();
      c.moveTo(x - w * 0.12, h * 0.08);
      c.quadraticCurveTo(x + w * 0.05, h * 0.5, x + w * 0.1, h * 0.92);
      c.quadraticCurveTo(x - w * 0.01, h * 0.5, x - w * 0.12, h * 0.08);
      c.fill();
    }
  },
  crescent: (c, w, h) => {
    c.fillStyle = '#fff';
    c.beginPath();
    c.arc(w / 2, h / 2, w * 0.44, 0, TAU);
    c.fill();
    c.globalCompositeOperation = 'destination-out';
    c.beginPath();
    c.arc(w * 0.62, h * 0.42, w * 0.4, 0, TAU);
    c.fill();
    c.globalCompositeOperation = 'source-over';
  },
  drop: (c, w, h) => {
    c.fillStyle = '#fff';
    c.beginPath();
    c.moveTo(w / 2, h * 0.08);
    c.bezierCurveTo(w * 0.85, h * 0.55, w * 0.78, h * 0.92, w / 2, h * 0.92);
    c.bezierCurveTo(w * 0.22, h * 0.92, w * 0.15, h * 0.55, w / 2, h * 0.08);
    c.fill();
  },
  bubble: (c, w) => {
    radial(c, w / 2, w / 2, w * 0.45, [[0, 0.08], [0.8, 0.25], [0.93, 0.9], [1, 0]]);
    radial(c, w * 0.38, w * 0.36, w * 0.1, [[0, 1], [1, 0]]);
  },
  skull: (c, w, h) => {
    c.fillStyle = '#fff';
    c.beginPath();
    c.arc(w / 2, h * 0.42, w * 0.3, 0, TAU);
    c.fill();
    c.fillRect(w * 0.34, h * 0.55, w * 0.32, h * 0.25);
    c.globalCompositeOperation = 'destination-out';
    c.beginPath();
    c.arc(w * 0.39, h * 0.45, w * 0.08, 0, TAU);
    c.arc(w * 0.61, h * 0.45, w * 0.08, 0, TAU);
    c.fill();
    c.fillRect(w * 0.42, h * 0.7, w * 0.04, h * 0.1);
    c.fillRect(w * 0.54, h * 0.7, w * 0.04, h * 0.1);
    c.globalCompositeOperation = 'source-over';
  },
  hex: (c, w) => {
    c.strokeStyle = '#fff';
    for (const [lw, a] of [[10, 0.2], [5, 0.5], [2.5, 1]] as const) {
      c.lineWidth = lw;
      c.strokeStyle = `rgba(255,255,255,${a})`;
      c.beginPath();
      for (let k = 0; k <= 6; k++) {
        const ang = (k * TAU) / 6;
        const x = w / 2 + Math.cos(ang) * w * 0.4, y = w / 2 + Math.sin(ang) * w * 0.4;
        if (k === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      c.stroke();
    }
  },
  star5: (c, w) => {
    c.fillStyle = '#fff';
    c.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + (k * Math.PI) / 5;
      const r = k % 2 === 0 ? w * 0.45 : w * 0.18;
      if (k === 0) c.moveTo(w / 2 + Math.cos(a) * r, w / 2 + Math.sin(a) * r);
      else c.lineTo(w / 2 + Math.cos(a) * r, w / 2 + Math.sin(a) * r);
    }
    c.fill();
  },
  heart: (c, w, h) => {
    c.filter = 'blur(3px)';
    c.fillStyle = '#fff';
    c.beginPath();
    c.moveTo(w / 2, h * 0.84);
    c.bezierCurveTo(w * 0.05, h * 0.5, w * 0.2, h * 0.12, w / 2, h * 0.32);
    c.bezierCurveTo(w * 0.8, h * 0.12, w * 0.95, h * 0.5, w / 2, h * 0.84);
    c.fill();
    c.filter = 'none';
  },
  fanLines: (c, w, h, rng) => {
    // half_ring_rainbow_line: fine lines fanning from the centre toward +u over about ±70°, bright at the root
    for (let i = 0; i < 80; i++) {
      const a = rng.s2(1.15) * (0.35 + 0.65 * rng.f());
      const l = w * (0.34 + rng.f() * 0.16);
      ray(c, w / 2, h / 2, w / 2 + Math.cos(a) * l, h / 2 + Math.sin(a) * l, 1.2 + rng.f() * 1.4, 0.55 + rng.f() * 0.45, 0.05);
    }
    radial(c, w / 2, h / 2, w * 0.07, [[0, 0.9], [1, 0]]);
  },
  splashArch: (c, w, h, rng) => splashArchPaint(c, w, h, rng),
  splashSide: (c, w, h, rng) => {
    c.translate(w / 2, h / 2);
    c.rotate(Math.PI / 2);
    c.translate(-w / 2, -h / 2);
    splashArchPaint(c, w, h, rng);
  },
  tufts: (c, w, h, rng) => {
    // nwegeomsplash: a row of soft flame tufts rising from y ≈ 0.38 in the upper part of the texture
    c.filter = 'blur(1.2px)';
    for (let g = 0; g < 5; g++) {
      const gx = w * (0.3 + g * 0.1), gh = h * (0.12 + 0.1 * Math.sin((Math.PI * (g + 0.5)) / 5));
      for (let i = 0; i < 9; i++) {
        const a = -Math.PI / 2 + rng.s2(0.5);
        const l = gh * (0.6 + rng.f() * 0.6);
        const x = gx + rng.s2(w * 0.03);
        ray(c, x, h * 0.38, x + Math.cos(a) * l, h * 0.38 + Math.sin(a) * l, 3 + rng.f() * 4, 0.55 + rng.f() * 0.35, 0);
      }
    }
    c.filter = 'none';
  },
  ringInner: (c, w) => radial(c, w / 2, w / 2, w / 2 - 1, [[0, 0], [0.35, 0.03], [0.65, 0.16], [0.84, 0.45], [0.93, 1], [0.97, 0.5], [1, 0]]),
  ringCloud: (c, w, h) => {
    const nf = noiseField(307, 16);
    pixels(c, w, h, (u, v) => {
      const r = Math.hypot(u - 0.5, v - 0.5) / 0.5;
      const n = fbm(nf, u * 8, v * 8, 4, 16);
      const prof = Math.exp(-Math.pow((r - 0.72 + (n - 0.5) * 0.12) / 0.15, 2));
      return [0.75 + 0.25 * n, Math.max(0, prof * (0.2 + 1.1 * n) - 0.12)];
    });
  },
  arcPair: (c, w) => {
    const R = w * 0.42;
    for (const mid of [0, Math.PI]) {
      c.filter = 'blur(1.5px)';
      arcSeg(c, w / 2, w / 2, R, mid - 1.05, mid + 1.05, (t) => 2 + 5 * Math.sin(Math.PI * t), (t) => 0.3 * Math.sin(Math.PI * t));
      c.filter = 'none';
      arcSeg(c, w / 2, w / 2, R, mid - 1.05, mid + 1.05, (t) => 0.8 + 2.4 * Math.sin(Math.PI * t), (t) => Math.pow(Math.sin(Math.PI * t), 0.8));
    }
  },
  arcThin: (c, w) => {
    const R = w * 0.44, mid = Math.PI / 2;
    c.filter = 'blur(1.5px)';
    arcSeg(c, w / 2, w / 2, R, mid - 1.5, mid + 1.5, (t) => 2 + 5 * Math.sin(Math.PI * t), (t) => 0.3 * Math.sin(Math.PI * t));
    c.filter = 'none';
    arcSeg(c, w / 2, w / 2, R, mid - 1.5, mid + 1.5, (t) => 0.6 + 2.6 * Math.pow(Math.sin(Math.PI * t), 2), (t) => Math.pow(Math.sin(Math.PI * t), 0.7));
  },
  twistRing: (c, w, _h, rng) => {
    // whirlpool ring: fine streaks spiralling from the inner to the outer radius, thin bright outer rim
    radial(c, w / 2, w / 2, w * 0.49, [[0, 0], [0.62, 0], [0.82, 0.14], [0.92, 0.45], [0.97, 0.15], [1, 0]]);
    c.filter = 'blur(0.6px)';
    for (let i = 0; i < 44; i++) {
      const a0 = rng.f() * TAU, sweep = 0.5 + rng.f() * 0.35, r0 = w * (0.3 + rng.f() * 0.04), r1 = w * (0.45 + rng.f() * 0.03);
      const al = 0.3 + rng.f() * 0.55, lw = 0.7 + rng.f() * 1.3;
      const pts: Array<[number, number]> = [];
      for (let k = 0; k <= 16; k++) {
        const t = k / 16, a = a0 + sweep * t, r = r0 + (r1 - r0) * t;
        pts.push([w / 2 + Math.cos(a) * r, w / 2 + Math.sin(a) * r]);
      }
      strokePts(c, pts, lw, al);
    }
    c.filter = 'none';
    arcSeg(c, w / 2, w / 2, w * 0.455, 0, TAU, () => 1.4, () => 0.7, 64);
  },
  twistDisc: (c, w, _h, rng) => {
    radial(c, w / 2, w / 2, w * 0.48, [[0, 0], [0.15, 0.05], [0.5, 0.22], [0.85, 0.1], [1, 0]]);
    c.filter = 'blur(0.5px)';
    for (let i = 0; i < 110; i++) {
      const a0 = rng.f() * TAU, sweep = 1.2 + rng.f() * 0.9, r0 = w * (0.05 + rng.f() * 0.12), r1 = w * (0.36 + rng.f() * 0.12);
      const al = 0.25 + rng.f() * 0.5, lw = 0.7 + rng.f() * 1.4;
      const pts: Array<[number, number]> = [];
      for (let k = 0; k <= 20; k++) {
        const t = k / 20, a = a0 + sweep * t, r = r0 + (r1 - r0) * t;
        pts.push([w / 2 + Math.cos(a) * r, w / 2 + Math.sin(a) * r]);
      }
      strokePts(c, pts, lw, al);
    }
    c.filter = 'none';
  },
  wisp: (c, w, h, rng) => {
    // ls1_1: smoky tendrils curling inside a soft ball (each a smooth random walk: soft halo + thin brighter core)
    radial(c, w / 2, h / 2, w * 0.44, [[0, 0.2], [0.6, 0.1], [1, 0]]);
    for (let i = 0; i < 16; i++) {
      let x = w / 2 + rng.s2(w * 0.25), y = h / 2 + rng.s2(h * 0.25), hd = rng.f() * TAU, turn = rng.s2(0.25);
      const pts: Array<[number, number]> = [];
      for (let k = 0; k < 36; k++) {
        pts.push([x, y]);
        turn += rng.s2(0.08);
        hd += turn;
        x += Math.cos(hd) * w * 0.012;
        y += Math.sin(hd) * w * 0.012;
      }
      c.filter = 'blur(2px)';
      strokePts(c, pts, 4, 0.18);
      c.filter = 'blur(0.6px)';
      strokePts(c, pts, 1.1, 0.3 + rng.f() * 0.35);
    }
    c.filter = 'none';
    c.globalCompositeOperation = 'destination-in';
    radial(c, w / 2, h / 2, w * 0.48, [[0, 1], [0.6, 0.85], [1, 0]]);
    c.globalCompositeOperation = 'source-over';
  },
  spinBlur: (c, w) => {
    // palbang_spin_round: concentric motion-blur arcs at the top-right and bottom-left, bright at the leading end
    for (const mid of [-Math.PI / 4, (3 * Math.PI) / 4]) {
      for (const [rk, lw] of [[0.17, 6], [0.25, 8], [0.33, 8], [0.41, 7]] as const) {
        c.filter = 'blur(2px)';
        arcSeg(c, w / 2, w / 2, w * rk, mid - 0.8, mid + 0.8, () => lw, (t) => 0.75 * Math.pow(t, 1.4) * Math.min(1, (1 - t) * 8));
        c.filter = 'none';
      }
    }
  },
  bubbles: (c, w, _h, rng) => {
    radial(c, w / 2, w / 2, w * 0.47, [[0, 0.35], [0.75, 0.28], [0.92, 0.12], [1, 0]]);
    const orbs: Array<[number, number, number]> = [[0, 0, 0.07]];
    for (let k = 0; k < 7; k++) orbs.push([(k / 7) * TAU + rng.s2(0.25), 0.3 + rng.s2(0.05), 0.05 + rng.f() * 0.04]);
    for (let k = 0; k < 4; k++) orbs.push([rng.f() * TAU, 0.14 + rng.f() * 0.06, 0.025 + rng.f() * 0.02]);
    for (const [a, r, s] of orbs) radial(c, w / 2 + Math.cos(a) * r * w, w / 2 + Math.sin(a) * r * w, s * w * 1.6, [[0, 1], [0.35, 0.95], [0.6, 0.35], [1, 0]]);
  },
  comet: (c, w, h, rng) => {
    c.filter = 'blur(1.4px)';
    for (let i = 0; i < 34; i++) {
      const y = h * (0.5 + rng.s2(0.19));
      ray(c, w * (0.45 + rng.f() * 0.1), y, w * (0.72 + rng.f() * 0.26), y + rng.s2(h * 0.02), 3 + rng.f() * 5, 0.55, 0);
    }
    c.filter = 'none';
    c.save();
    c.translate(w * 0.36, h / 2);
    c.scale(1, 0.84);
    radial(c, 0, 0, w * 0.3, [[0, 1], [0.7, 0.92], [0.88, 0.5], [1, 0]]);
    c.restore();
  },
  smear: (c, w, h, rng) => {
    c.filter = 'blur(1.2px)';
    for (let i = 0; i < 42; i++) {
      const y = h * (0.5 + (rng.f() + rng.f() + rng.f() - 1.5) * 0.2);
      const x1 = w * (0.7 + rng.f() * 0.27), x0 = x1 - w * (0.2 + rng.f() * 0.45);
      ray(c, x1, y, x0, y, 2 + rng.f() * 3.5, 0.3 + rng.f() * 0.5, 0);
    }
    c.filter = 'none';
  },
  curtain: (c, w, h, rng) => {
    c.filter = 'blur(0.8px)';
    for (let i = 0; i < 46; i++) {
      const x = w * (0.05 + rng.f() * 0.9);
      ray(c, x, h, x, h * (1 - 0.3 - rng.f() * 0.62), 1.5 + rng.f() * 3, 0.45 + rng.f() * 0.55, 0);
    }
    c.filter = 'none';
  },
  ornateRing: (c, w) => {
    c.strokeStyle = 'rgba(255,255,255,0.95)';
    for (const r of [0.46, 0.3]) {
      c.lineWidth = 1.6;
      c.beginPath();
      c.arc(w / 2, w / 2, w * r, 0, TAU);
      c.stroke();
    }
    c.lineWidth = 1.4;
    const n = 12, rr = w * 0.034;
    for (let k = 0; k < n; k++) {
      const th = (k / n) * TAU;
      for (const [dr, dir] of [[-0.02, 1], [0.02, -1]] as const) {
        const px = w / 2 + Math.cos(th + (dir * 0.13)) * w * (0.38 + dr), py = w / 2 + Math.sin(th + (dir * 0.13)) * w * (0.38 + dr);
        c.beginPath();
        c.arc(px, py, rr, th, th + dir * 4.4, dir < 0);
        c.stroke();
      }
      // stem between the curls along the band
      c.beginPath();
      c.arc(w / 2, w / 2, w * 0.38, th - 0.12, th + 0.12);
      c.stroke();
    }
  },
  wolfHead: (c, w, h, rng) => {
    const X = (u: number) => u * w, Y = (v: number) => v * h;
    // flaring mane: flame tongues around the head
    c.filter = 'blur(1.5px)';
    for (let i = 0; i < 26; i++) {
      const a = -Math.PI / 2 + rng.s2(2.3);
      const r0 = w * 0.24, l = w * (0.14 + rng.f() * 0.12);
      const x0 = X(0.5) + Math.cos(a) * r0, y0 = Y(0.5) + Math.sin(a) * r0 * 1.1;
      const bend = rng.s2(0.35) - 0.25 * Math.sign(Math.cos(a));
      ray(c, x0, y0, x0 + Math.cos(a + bend) * l, y0 + Math.sin(a + bend) * l - w * 0.05, 5 + rng.f() * 5, 0.55, 0);
    }
    c.filter = 'none';
    const face = (): void => {
      c.beginPath();
      c.moveTo(X(0.5), Y(0.92));
      c.lineTo(X(0.36), Y(0.72));
      c.lineTo(X(0.22), Y(0.52));
      c.lineTo(X(0.27), Y(0.3));
      c.lineTo(X(0.22), Y(0.05));
      c.lineTo(X(0.42), Y(0.24));
      c.lineTo(X(0.5), Y(0.22));
      c.lineTo(X(0.58), Y(0.24));
      c.lineTo(X(0.78), Y(0.05));
      c.lineTo(X(0.73), Y(0.3));
      c.lineTo(X(0.78), Y(0.52));
      c.lineTo(X(0.64), Y(0.72));
      c.closePath();
    };
    c.fillStyle = 'rgba(255,255,255,0.22)';
    face();
    c.fill();
    c.lineJoin = 'round';
    c.lineCap = 'round';
    for (const [lw, a] of [[7, 0.18], [3.5, 0.5], [1.8, 1]] as const) {
      c.strokeStyle = `rgba(255,255,255,${a})`;
      c.lineWidth = lw;
      face();
      c.stroke();
      c.beginPath(); // forehead V, muzzle bridge, inner ears
      c.moveTo(X(0.38), Y(0.36)); c.lineTo(X(0.5), Y(0.5)); c.lineTo(X(0.62), Y(0.36));
      c.moveTo(X(0.45), Y(0.56)); c.lineTo(X(0.47), Y(0.82));
      c.moveTo(X(0.55), Y(0.56)); c.lineTo(X(0.53), Y(0.82));
      c.moveTo(X(0.27), Y(0.13)); c.lineTo(X(0.36), Y(0.27));
      c.moveTo(X(0.73), Y(0.13)); c.lineTo(X(0.64), Y(0.27));
      c.stroke();
    }
    // slanted eye slits + nose
    c.strokeStyle = '#fff';
    c.lineWidth = 3.2;
    c.beginPath();
    c.moveTo(X(0.31), Y(0.44)); c.lineTo(X(0.43), Y(0.5));
    c.moveTo(X(0.69), Y(0.44)); c.lineTo(X(0.57), Y(0.5));
    c.stroke();
    c.fillStyle = '#fff';
    c.beginPath();
    c.moveTo(X(0.45), Y(0.83)); c.lineTo(X(0.55), Y(0.83)); c.lineTo(X(0.5), Y(0.9));
    c.fill();
  },
  crescentGlow: (c, w) => {
    // cheonryongchuta_blow: soft band on a circle of r ≈ 0.4, thickest and brightest at +u, fading toward ±100°
    for (const [blur, wMul, aMul] of [[4, 2.2, 0.35], [1.2, 1, 0.9]] as const) {
      c.filter = `blur(${blur}px)`;
      arcSeg(c, w / 2, w / 2, w * 0.4, -1.75, 1.75, (t) => wMul * (2 + 13 * Math.pow(Math.sin(Math.PI * t), 1.6)), (t) => aMul * Math.pow(Math.sin(Math.PI * t), 0.9), 64);
    }
    c.filter = 'none';
  },
  clawArcs: (c, w) => {
    for (const [rk, al] of [[0.2, 1], [0.27, 0.9], [0.35, 0.8], [0.43, 0.7]] as const) {
      c.filter = 'blur(2px)';
      arcSeg(c, w / 2, w / 2, w * rk, -1.35, 1.35, (t) => 2 + 4 * Math.sin(Math.PI * t), (t) => 0.35 * al * Math.sin(Math.PI * t));
      c.filter = 'none';
      arcSeg(c, w / 2, w / 2, w * rk, -1.35, 1.35, (t) => 0.6 + 1.6 * Math.sin(Math.PI * t), (t) => al * Math.pow(Math.sin(Math.PI * t), 0.8));
    }
  },
  ringLine: (c, w, h) => {
    // assassin blow rings (9-1 copy, w_am_ring): gaussian line at r = 0.9 (FWHM 0.05 r), 0.15 glow rising inward toward it
    const sig = 0.05 / 2.3548;
    pixels(c, w, h, (u, v) => {
      const d = Math.hypot(u - 0.5, v - 0.5) * 2;
      const line = Math.exp(-((d - 0.9) ** 2) / (2 * sig * sig));
      const t = Math.min(1, Math.max(0, (d - 0.45) / 0.45));
      const inner = d < 0.9 ? 0.15 * t * t * (3 - 2 * t) : 0;
      return [1, Math.max(line, inner)];
    });
  },
  boltH: (c, w, h, rng) => boltPaint(c, w * 0.03, h * (0.5 + rng.s2(0.08)), w * 0.97, h * (0.5 + rng.s2(0.08)), rng, h * 0.22, rng.i(2), 6),
  boltV: (c, w, h, rng) => boltPaint(c, w * (0.5 + rng.s2(0.08)), h * 0.03, w * (0.5 + rng.s2(0.08)), h * 0.97, rng, w * 0.18, 1 + rng.i(2), 0),
  rock: (c, w, h, rng) => {
    // lumpy silhouette r(θ) from 9 random radii, sphere-ish normal lit from the top-left, facet noise
    const radii = Array.from({ length: 9 }, () => 0.3 + rng.f() * 0.15);
    const nf = noiseField(400 + rng.i(1000), 8);
    pixels(c, w, h, (u, v) => {
      const dx = u - 0.5, dy = v - 0.5, d = Math.hypot(dx, dy);
      const s = ((Math.atan2(dy, dx) / TAU + 1) % 1) * 9, i0 = Math.floor(s) % 9;
      const f = s - Math.floor(s);
      const r = (radii[i0] as number) * (1 - f) + (radii[(i0 + 1) % 9] as number) * f;
      if (d > r + 0.01) return [0, 0];
      const q = Math.min(1, d / r), nz = Math.sqrt(Math.max(0, 1 - q * q));
      const lit = Math.max(0, (-dx / r) * 0.5 + (-dy / r) * 0.55 + nz * 0.65);
      const n = fbm(nf, u * 6, v * 6, 3, 8);
      return [0.18 + 0.7 * lit * (0.7 + 0.5 * n), Math.min(1, (r + 0.01 - d) / 0.02)];
    });
  },
  flamePillar: (c, w, h) => {
    const nf = noiseField(503, 16);
    pixels(c, w, h, (u, v) => {
      const y = 1 - v; // 0 = base, 1 = top
      const half = 0.44 * (1 - 0.5 * y);
      const dx = Math.abs(u - 0.5) / half;
      const n = fbm(nf, u * 14, v * 2.2, 4, 16); // stretched along v: vertical fibres
      const core = Math.max(0, 1 - dx * dx);
      const top = y < 0.55 ? 1 : Math.max(0, Math.min(1, (n - (y - 0.55) * 1.6) * 3));
      const base = Math.min(1, y / 0.04);
      return [Math.min(1, 0.6 + 0.35 * n + 0.3 * (1 - y)), core * (0.3 + 0.95 * n) * top * base];
    });
  },
  lensStreak: (c, w, h) => {
    c.save();
    c.translate(w / 2, h / 2);
    c.scale(1, 0.12);
    radial(c, 0, 0, w / 2 - 1, [[0, 1], [0.3, 0.55], [0.7, 0.12], [1, 0]]);
    c.restore();
    radial(c, w / 2, h / 2, h * 0.3, [[0, 1], [1, 0]]);
  },
  slashArc: (c, w, h, rng) => {
    // crescent band: outer edge bright, fibres along the arc, open toward the bottom
    const cx = w / 2, cy = h * 1.45, R = h * 1.3;
    for (let i = 0; i < 70; i++) {
      const r = R - rng.f() * h * 0.42;
      const a0 = -Math.PI / 2 - 0.62 + rng.f() * 0.2, a1 = -Math.PI / 2 + 0.62 - rng.f() * 0.2;
      const k = 1 - (R - r) / (h * 0.42);
      c.strokeStyle = `rgba(255,255,255,${0.1 + 0.6 * k * k})`;
      c.lineWidth = 1 + 2.5 * k;
      c.beginPath();
      c.arc(cx, cy, r, a0, a1);
      c.stroke();
    }
    c.strokeStyle = '#fff';
    c.lineWidth = 4;
    c.beginPath();
    c.arc(cx, cy, R, -Math.PI / 2 - 0.58, -Math.PI / 2 + 0.58);
    c.stroke();
  },
  splashDome: (c, w, h, rng) => {
    // broad half-dome band (bright outer edge, soft inner gradient) with drips hanging from it
    const cx = w / 2, cy = h * 0.98, R = w * 0.47;
    c.save();
    c.translate(cx, cy);
    c.scale(1, (h * 0.92) / R);
    const g = c.createRadialGradient(0, 0, R * 0.45, 0, 0, R);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.35)');
    g.addColorStop(0.9, 'rgba(255,255,255,0.95)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.beginPath();
    c.arc(0, 0, R, Math.PI, TAU);
    c.fill();
    c.restore();
    for (let i = 0; i < 70; i++) {
      const a = Math.PI + 0.1 + rng.f() * (Math.PI - 0.2);
      const rr = R * (0.8 + rng.f() * 0.18);
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * ((h * 0.92) / R);
      ray(c, x, y, x, y + h * (0.08 + rng.f() * 0.25), 2 + rng.f() * 4, 0.7, 0);
    }
  },
  glyphBurst: (c, w, h, rng) => {
    for (let i = 0; i < 140; i++) {
      const a = rng.f() * TAU;
      const l = w * (0.2 + rng.f() * 0.28);
      ray(c, w / 2, h / 2, w / 2 + Math.cos(a) * l, h / 2 + Math.sin(a) * l, 1.5 + rng.f() * 2, 0.55, 0);
    }
    glyph(c, w, h, new VRng(77), 3, 20);
  },
  talisman: (c, w, h, rng) => {
    c.fillStyle = 'rgb(246,232,186)';
    c.fillRect(w * 0.12, h * 0.04, w * 0.76, h * 0.92);
    c.strokeStyle = 'rgb(196,40,32)';
    c.lineWidth = 4;
    c.strokeRect(w * 0.18, h * 0.07, w * 0.64, h * 0.86);
    c.save();
    c.translate(w * 0.2, h * 0.14);
    glyph(c, w * 0.6, h * 0.72, rng, 5, 7, 'rgb(186,30,26)');
    c.restore();
  },
  runeCircle: (c, w, h, rng) => {
    const cx = w / 2, cy = h / 2;
    for (const [r, lw] of [[0.47, 4], [0.4, 2], [0.26, 3], [0.2, 1.5]] as const) {
      c.strokeStyle = '#fff';
      c.lineWidth = lw;
      c.beginPath();
      c.arc(cx, cy, w * r, 0, TAU);
      c.stroke();
    }
    for (let k = 0; k < 48; k++) {
      const a = (k * TAU) / 48;
      ray(c, cx + Math.cos(a) * w * 0.4, cy + Math.sin(a) * w * 0.4, cx + Math.cos(a) * w * (k % 4 === 0 ? 0.47 : 0.44), cy + Math.sin(a) * w * (k % 4 === 0 ? 0.47 : 0.44), 3, 1, 1);
    }
    for (let k = 0; k < 8; k++) {
      const a = (k * TAU) / 8 + 0.2;
      c.save();
      c.translate(cx + Math.cos(a) * w * 0.33, cy + Math.sin(a) * w * 0.33);
      c.rotate(a + Math.PI / 2);
      c.translate(-18, -18);
      glyph(c, 36, 36, rng, 2, 3);
      c.restore();
    }
    c.lineWidth = 2.5;
    c.beginPath();
    for (let k = 0; k <= 6; k++) {
      const a = (k * 2 * TAU) / 6 - Math.PI / 2;
      const x = cx + Math.cos(a) * w * 0.26, y = cy + Math.sin(a) * w * 0.26;
      if (k === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.stroke();
  },
  crack: (c, w, h, rng) => {
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * TAU + rng.s2(0.25);
      const l = w * (0.3 + rng.f() * 0.18);
      const pts = jagLine(c, w / 2, h / 2, w / 2 + Math.cos(a) * l, h / 2 + Math.sin(a) * l, rng, w * 0.06, 4);
      strokePts(c, pts, 6, 0.25);
      strokePts(c, pts, 2.5, 1);
      if (rng.f() < 0.6) {
        const m = pts[Math.floor(pts.length * 0.55)] as [number, number];
        const b = a + rng.s2(0.9);
        strokePts(c, jagLine(c, m[0], m[1], m[0] + Math.cos(b) * l * 0.4, m[1] + Math.sin(b) * l * 0.4, rng, w * 0.03, 3), 1.6, 0.9);
      }
    }
    radial(c, w / 2, h / 2, w * 0.12, [[0, 0.8], [1, 0]]);
  },
  scorch: (c, w, h) => {
    const nf = noiseField(131, 16);
    pixels(c, w, h, (u, v) => {
      const d = 1 - Math.hypot(u - 0.5, v - 0.5) / 0.48;
      const n = fbm(nf, u * 8, v * 8, 4, 16);
      return [0.15 + 0.2 * n, Math.max(0, Math.min(1, d * 1.6 - (1 - n) * 0.9))];
    });
  },
  swordBlade: (c, w, h) => {
    const g = c.createLinearGradient(w * 0.38, 0, w * 0.62, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.65)');
    g.addColorStop(0.5, '#fff');
    g.addColorStop(1, 'rgba(255,255,255,0.5)');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(w / 2, h * 0.02);
    c.lineTo(w * 0.6, h * 0.12);
    c.lineTo(w * 0.6, h * 0.72);
    c.lineTo(w * 0.4, h * 0.72);
    c.lineTo(w * 0.4, h * 0.12);
    c.closePath();
    c.fill();
    c.fillStyle = 'rgba(255,255,255,0.9)';
    c.fillRect(w * 0.22, h * 0.72, w * 0.56, h * 0.03);
    c.fillRect(w * 0.45, h * 0.75, w * 0.1, h * 0.17);
    radial(c, w / 2, h * 0.95, w * 0.07, [[0, 1], [1, 0.4]]);
  },
  dragonHead: (c, w, h) => {
    // stylised profile facing +x: skull, open jaw, horns, mane spikes, eye
    c.save();
    c.translate(w * 0.06, h * 0.08);
    const s = w / 256;
    c.scale(s, s);
    c.fillStyle = 'rgba(255,255,255,0.92)';
    c.beginPath();
    c.moveTo(20, 120);
    c.quadraticCurveTo(40, 70, 100, 62);
    c.quadraticCurveTo(160, 58, 222, 84);
    c.lineTo(230, 98);
    c.quadraticCurveTo(180, 100, 140, 108);
    c.lineTo(214, 130);
    c.lineTo(206, 146);
    c.quadraticCurveTo(150, 150, 110, 156);
    c.quadraticCurveTo(60, 172, 20, 150);
    c.closePath();
    c.fill();
    for (let k = 0; k < 6; k++) {
      c.beginPath();
      c.moveTo(30 + k * 14, 96 - k * 4);
      c.lineTo(8 + k * 10, 40 + k * 3 - (k % 2) * 16);
      c.lineTo(44 + k * 14, 92 - k * 4);
      c.fill();
    }
    c.beginPath();
    c.moveTo(96, 66);
    c.quadraticCurveTo(70, 20, 30, 10);
    c.quadraticCurveTo(80, 30, 112, 64);
    c.fill();
    c.fillStyle = 'rgba(255,255,255,1)';
    for (let k = 0; k < 5; k++) {
      c.beginPath();
      c.moveTo(150 + k * 14, 102);
      c.lineTo(155 + k * 14, 116);
      c.lineTo(160 + k * 14, 102);
      c.fill();
    }
    c.globalCompositeOperation = 'destination-out';
    c.beginPath();
    c.ellipse(118, 80, 10, 6, -0.2, 0, TAU);
    c.fill();
    c.globalCompositeOperation = 'source-over';
    radial(c, 118, 80, 9, [[0, 1], [1, 0]]);
    c.strokeStyle = 'rgba(120,120,120,0.6)';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(60, 120);
    c.quadraticCurveTo(110, 112, 140, 108);
    c.stroke();
    c.restore();
  },
  shockwave: (c, w, h) => {
    const nf = noiseField(171, 24);
    pixels(c, w, h, (u, v) => {
      const r = Math.hypot(u - 0.5, v - 0.5) / 0.5;
      const a = Math.atan2(v - 0.5, u - 0.5);
      const n = fbm(nf, ((a / TAU + 1) % 1) * 24, r * 6, 3, 24);
      const ring = Math.exp(-Math.pow((r - 0.8 - (n - 0.5) * 0.12) / 0.07, 2));
      const inner = Math.max(0, r - 0.45) * 0.4 * Math.max(0, 0.9 - r);
      return [0.85 + 0.15 * n, ring + inner * n];
    });
  },
  burstStar: (c, w, h, rng) => {
    radial(c, w / 2, h / 2, w * 0.48, [[0, 0.9], [0.3, 0.35], [0.7, 0.08], [1, 0]]);
    for (let layer = 0; layer < 2; layer++) {
      const n = layer === 0 ? 9 : 14;
      c.fillStyle = `rgba(255,255,255,${layer === 0 ? 0.5 : 0.85})`;
      c.beginPath();
      for (let k = 0; k < n * 2; k++) {
        const a = (k * Math.PI) / n + rng.s2(0.08);
        const r = k % 2 === 0 ? w * (layer === 0 ? 0.46 : 0.32) * (0.75 + rng.f() * 0.25) : w * (layer === 0 ? 0.2 : 0.12);
        if (k === 0) c.moveTo(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r);
        else c.lineTo(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r);
      }
      c.closePath();
      c.fill();
    }
  },
  energyStrip: (c, w, h) => {
    const nf = noiseField(211, 16, 16);
    pixels(c, w, h, (u, v) => {
      let a = 0;
      for (let k = 0; k < 4; k++) {
        const y = 0.5 + 0.28 * Math.sin(TAU * (u * (k + 2)) + k * 1.7) * (0.6 + 0.4 * nf(u * 16, k * 3));
        a += Math.exp(-Math.pow((v - y) / 0.035, 2)) * (0.5 + 0.5 * nf(u * 16 + k * 5, 1));
      }
      const band = Math.exp(-Math.pow((v - 0.5) / 0.3, 2)) * 0.25;
      return [1, Math.min(1, a + band)];
    });
  },
  windStrip: (c, w, h) => {
    const rng = new VRng(223);
    const lines: Array<[number, number, number, number]> = [];
    for (let i = 0; i < 26; i++) lines.push([rng.f(), 0.12 + rng.f() * 0.76, 0.15 + rng.f() * 0.5, 0.008 + rng.f() * 0.02]);
    pixels(c, w, h, (u, v) => {
      let a = 0;
      for (const [x0, y, l, th] of lines) {
        const d = ((u - x0 + 1) % 1) / l;
        if (d < 1) a += Math.sin(Math.PI * d) * Math.exp(-Math.pow((v - y) / th, 2));
      }
      return [1, Math.min(1, a) * Math.sin(Math.PI * v)];
    });
  },
  glowStrip: (c, w, h) => pixels(c, w, h, (_u, v) => [1, Math.exp(-Math.pow((v - 0.5) / 0.22, 2)) * 0.7 + Math.exp(-Math.pow((v - 0.5) / 0.04, 2)) * 0.3]),
  fireStrip: (c, w, h) => {
    const nf = noiseField(239, 16, 16);
    pixels(c, w, h, (u, v) => {
      const n = fbm(nf, u * 16, v * 4, 4, 16);
      const y = 1 - v;
      const tongue = Math.max(0, 1 - y / (0.35 + 0.6 * n));
      const a = Math.pow(tongue, 1.3) * Math.min(1, y * 8);
      return [0.55 + 0.45 * tongue, a];
    });
  },
  dragonScale: (c, w, h) => {
    pixels(c, w, h, (u, v, x, y) => {
      const sx = 32, sy = 22;
      const row = Math.floor(y / sy);
      const off = (row % 2) * sx * 0.5;
      const cx = ((x + off) % sx) - sx / 2;
      const cy = (y % sy) - sy * 0.2;
      const d = Math.hypot(cx / (sx * 0.55), cy / (sy * 0.9));
      const edge = Math.max(0, 1 - d);
      const rim = Math.exp(-Math.pow((d - 0.85) / 0.12, 2));
      const band = Math.sin(Math.PI * v);
      return [0.55 + 0.45 * Math.min(1, edge * 1.4) + rim * 0.2, Math.min(1, 0.4 + band) * (0.8 + 0.2 * edge)];
    });
  },
  lightningStrip: (c, w, h) => {
    const rng = new VRng(251);
    for (let k = 0; k < 2; k++) {
      const pts = jagLine(c, 0, h / 2, w, h / 2, rng, h * 0.35, 6);
      glowStroke(c, pts, k === 0 ? 3 : 1.6);
    }
  },
  smokeStrip: (c, w, h) => {
    const nf = noiseField(263, 16, 16);
    pixels(c, w, h, (u, v) => {
      const n = fbm(nf, u * 16, v * 4, 4, 16);
      return [0.8 + 0.2 * n, Math.max(0, Math.sin(Math.PI * v) * 1.3 - (1 - n) * 0.9)];
    });
  },
  chainStrip: (c, w, h) => {
    c.strokeStyle = '#fff';
    c.lineWidth = 8;
    for (let k = 0; k < 8; k++) {
      c.beginPath();
      if (k % 2 === 0) c.ellipse(k * 64 + 32, h / 2, 34, 22, 0, 0, TAU);
      else c.ellipse(k * 64 + 32, h / 2, 34, 5, 0, 0, TAU);
      c.stroke();
    }
  },
  lightning: (c, w, h, rng) => {
    // 4 frames of 2×1 cells are painted by the caller (frame index in rng seed)
    const pts = jagLine(c, w * 0.04, h / 2, w * 0.96, h / 2, rng, h * 0.32, 6);
    glowStroke(c, pts, 2.2);
    for (let i = 0; i < 30; i++) {
      const p = pts[rng.i(pts.length)] as [number, number];
      radial(c, p[0] + rng.s2(18), p[1] + rng.s2(26), 2 + rng.f() * 3, [[0, 1], [1, 0]]);
    }
  },
  flameFB: () => undefined,
  iceFB: () => undefined,
  poisonFB: () => undefined,
  smokeFB: () => undefined,
};

const FLIP_FRAG = /* glsl */ `
varying vec2 vUv; uniform float uT; uniform float uType;
float h31(vec3 p){ p = fract(p*0.1031); p += dot(p, p.zyx+31.32); return fract((p.x+p.y)*p.z); }
float vn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(h31(i), h31(i+vec3(1,0,0)), f.x), mix(h31(i+vec3(0,1,0)), h31(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i+vec3(0,0,1)), h31(i+vec3(1,0,1)), f.x), mix(h31(i+vec3(0,1,1)), h31(i+vec3(1,1,1)), f.x), f.y), f.z); }
float fbm(vec3 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * vn(p); p *= 2.03; a *= 0.5; } return s; }
void main(){
  vec2 p = vUv * 2.0 - 1.0;
  float t = uT;
  float r = length(p);
  float lum = 1.0, a = 0.0;
  if (uType < 0.5) { // flame burst: rising tongues, heat → luminance
    vec2 q = vec2(p.x, p.y + 0.35 - t * 0.5);
    float n = fbm(vec3(q * 2.6 + vec2(0.0, -t * 2.2), t * 1.3));
    float shape = 1.0 - length(vec2(q.x * 1.25, q.y * (q.y > 0.0 ? 0.62 : 1.4))) / (0.62 + 0.25 * t);
    float d = clamp(shape * 1.6 + (n - 0.5) * 1.3, 0.0, 1.0);
    float life = smoothstep(0.0, 0.12, t) * (1.0 - smoothstep(0.55, 1.0, t));
    a = d * life;
    lum = clamp(0.35 + d * 0.9 - t * 0.35, 0.0, 1.0);
  } else if (uType < 1.5) { // frost burst: crystalline spikes growing then fading
    float ang = atan(p.y, p.x);
    float spikes = pow(abs(cos(ang * 3.0 + 0.4)), 18.0) + 0.6 * pow(abs(cos(ang * 6.0 + 1.1)), 30.0);
    float reach = 0.25 + 0.7 * smoothstep(0.0, 0.5, t);
    float body = smoothstep(reach, reach * 0.4, r) * (0.35 + spikes);
    float n = fbm(vec3(p * 5.0, 3.1));
    a = clamp(body * (0.7 + 0.6 * n), 0.0, 1.0) * (1.0 - smoothstep(0.65, 1.0, t)) * smoothstep(0.0, 0.08, t);
    lum = 0.75 + 0.25 * spikes;
  } else if (uType < 2.5) { // poison: bubbling dense cloud
    float n = fbm(vec3(p * 2.4, t * 1.6 + 7.0));
    float b = 0.0;
    for (int k = 0; k < 5; k++) {
      float fk = float(k);
      vec2 c = vec2(sin(fk * 2.1 + 1.0) * 0.45, cos(fk * 1.7) * 0.35 - 0.1 + fract(t + fk * 0.21) * 0.5);
      float rr = 0.08 + 0.06 * sin(fk * 3.0 + t * 6.0);
      b += smoothstep(rr, rr * 0.6, length(p - c)) * (1.0 - smoothstep(rr * 0.6, 0.0, length(p - c)) * 0.7);
    }
    float body = smoothstep(0.95, 0.35, r + (n - 0.5) * 0.7);
    a = clamp(body * (0.55 + 0.6 * n) + b * 0.5, 0.0, 1.0) * smoothstep(0.0, 0.15, t) * (1.0 - smoothstep(0.7, 1.0, t) * 0.8);
    lum = clamp(0.55 + 0.45 * n + b * 0.4, 0.0, 1.0);
  } else { // rolling smoke
    float n = fbm(vec3(p * 2.0 + vec2(0.0, -t * 0.8), t * 0.9 + 13.0));
    float body = smoothstep(0.9, 0.2, r * (0.8 + 0.4 * t) + (n - 0.5) * 0.8);
    a = clamp(body * (0.4 + 0.8 * n), 0.0, 1.0) * smoothstep(0.0, 0.1, t) * (1.0 - smoothstep(0.6, 1.0, t));
    lum = 0.7 + 0.3 * n;
  }
  a *= smoothstep(1.0, 0.9, r);
  gl_FragColor = vec4(vec3(lum) * a, a);
}
`;
const BAKE_VERT = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }`;
const COPY_FRAG = /* glsl */ `uniform sampler2D map; varying vec2 vUv; void main(){ gl_FragColor = texture2D(map, vUv); }`;

/** paints every 2D role into a 2048² canvas (top row = cell row 0); exported for the gallery's atlas page */
export function paintSpecSheet(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = ATLAS_SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as C2;
  let seed = 1;
  for (const role of Object.keys(ROLES) as TexRole[]) {
    const r = ROLES[role];
    if (r.frames === 16) continue;
    const w = r.w * CELL_PX, h = r.h * CELL_PX;
    for (let f = 0; f < r.frames; f++) {
      const c0 = (r.cell % 16) + f * r.w;
      const col = c0 % 16;
      const row = Math.floor(r.cell / 16) + Math.floor(c0 / 16) * r.h;
      ctx.save();
      ctx.translate(col * CELL_PX, row * CELL_PX);
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      ctx.clip();
      // pixel painters read back their own rect: give them a dedicated sub-context
      const sub = document.createElement('canvas');
      sub.width = w;
      sub.height = h;
      P[role](sub.getContext('2d', { willReadFrequently: true }) as C2, w, h, new VRng(0x5eed + seed * 977 + f * 131));
      ctx.drawImage(sub, 0, 0);
      ctx.restore();
    }
    seed++;
  }
  return canvas;
}

export interface SpecAtlas {
  texture: Texture;
  rt: WebGLRenderTarget;
  /** re-bakes the GPU fallback atlas after WebGL context restoration */
  onContextRestored(): void;
  dispose(): void;
}

function paintSpecAtlas(renderer: WebGLRenderer, rt: WebGLRenderTarget): void {
  const sheet = new CanvasTexture(paintSpecSheet());
  sheet.premultiplyAlpha = true;
  sheet.generateMipmaps = false;
  sheet.minFilter = LinearFilter;
  sheet.magFilter = LinearFilter;
  sheet.flipY = true;
  sheet.needsUpdate = true;
  const cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const scene = new Scene();
  const quad = new Mesh(new PlaneGeometry(1, 1));
  quad.frustumCulled = false;
  scene.add(quad);
  const prevTarget = renderer.getRenderTarget();
  const prevAutoClear = renderer.autoClear;
  const prevClear = new Color();
  renderer.getClearColor(prevClear);
  const prevAlpha = renderer.getClearAlpha();
  renderer.autoClear = false;
  const copy = new ShaderMaterial({ vertexShader: BAKE_VERT, fragmentShader: COPY_FRAG, uniforms: { map: { value: sheet } }, blending: NoBlending, depthTest: false, depthWrite: false });
  const flip = new ShaderMaterial({ vertexShader: BAKE_VERT, fragmentShader: FLIP_FRAG, uniforms: { uT: { value: 0 }, uType: { value: 0 } }, blending: NoBlending, depthTest: false, depthWrite: false });
  rt.scissorTest = false;
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, false, false);
  quad.material = copy;
  rt.viewport.set(0, 0, ATLAS_SIZE, ATLAS_SIZE);
  renderer.setRenderTarget(rt);
  renderer.render(scene, cam);
  const books: TexRole[] = ['flameFB', 'iceFB', 'poisonFB', 'smokeFB'];
  quad.material = flip;
  books.forEach((role, b) => {
    const r = ROLES[role];
    const row = Math.floor(r.cell / 16);
    flip.uniforms.uType!.value = b;
    for (let f = 0; f < r.frames; f++) {
      flip.uniforms.uT!.value = f / (r.frames - 1);
      const x = ((r.cell % 16) + f) * CELL_PX;
      const y = (16 - row - 1) * CELL_PX;
      rt.viewport.set(x, y, CELL_PX, CELL_PX);
      rt.scissor.set(x, y, CELL_PX, CELL_PX);
      rt.scissorTest = true;
      renderer.setRenderTarget(rt);
      renderer.render(scene, cam);
    }
  });
  rt.scissorTest = false;
  rt.viewport.set(0, 0, ATLAS_SIZE, ATLAS_SIZE);
  renderer.setRenderTarget(prevTarget);
  renderer.autoClear = prevAutoClear;
  renderer.setClearColor(prevClear, prevAlpha);
  copy.dispose();
  flip.dispose();
  quad.geometry.dispose();
  sheet.dispose();
}

/** bakes the spec atlas on the GPU: canvas roles copied in, flipbooks rendered; mipmapped, premultiplied alpha */
export function bakeSpecAtlas(renderer: WebGLRenderer): SpecAtlas {
  const rt = new WebGLRenderTarget(ATLAS_SIZE, ATLAS_SIZE, {
    format: RGBAFormat,
    type: UnsignedByteType,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: true,
    minFilter: LinearMipmapLinearFilter,
    magFilter: LinearFilter,
    wrapS: ClampToEdgeWrapping,
    wrapT: ClampToEdgeWrapping,
  });
  rt.texture.premultiplyAlpha = true;
  paintSpecAtlas(renderer, rt);
  let disposed = false;
  return {
    texture: rt.texture,
    rt,
    onContextRestored() {
      if (disposed) return;
      paintSpecAtlas(renderer, rt);
    },
    dispose() {
      disposed = true;
      rt.dispose();
    },
  };
}
