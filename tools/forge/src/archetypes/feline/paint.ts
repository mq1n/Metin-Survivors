// Feline paint: coat zones (dorsal fade, pale belly / inner legs / paws), pattern markings (tapering forked tiger stripes, ember seams,
// frost shadows, gilt stripes), face (王 forehead mark, cheek stripes, whisker dots, eye liner, white brow patches), paws with toe lines,
// ringed tail, and fur texture (directional strands + clumps) — all baked per texel into the albedo. AO/cavity/hemi/rim go to COLOR_0.
import type { PaintSpec } from '../../core/build.ts';
import { clamp01, smoothstep, vnorm } from '../../core/math.ts';
import type { Vec3 } from '../../core/math.ts';
import { bakeAo, bones, cavity, custom, furClumps, grain, hemi, layer, region, rimTint, strands } from '../../core/paint/layers.ts';
import { type PaintLayer, type PaintVertex, type Rgb, adjust, mixRgb, rgb } from '../../core/paint/painter.ts';
import type { Anatomy } from './anatomy.ts';

/** stripe coverage: 1 at the centre of a band (f = 0.5) down to 0 at half-width `hw` (fraction of the period) */
const band = (f: number, hw: number, soft: number): number => 1 - smoothstep(Math.max(hw - soft, 0), Math.max(hw, 1e-4), Math.abs(f - Math.floor(f) - 0.5));

export function makePaint(a: Anatomy, textureSize = 1024): PaintSpec {
  const p = a.p;
  const pal = p.palette;
  const s = a.s;
  const pattern = p.pattern;
  const st = a.stations;

  const lerpAt = (z: number, key: 'top' | 'bot'): number => {
    const arr = st.map((q) => ({ z: q.z, y: key === 'top' ? q.y + q.hh : q.y - q.hh }));
    if (z <= arr[0]!.z) return arr[0]!.y;
    for (let i = 0; i < arr.length - 1; i++) {
      const A = arr[i]!, B = arr[i + 1]!;
      if (z <= B.z) return A.y + (B.y - A.y) * ((z - A.z) / (B.z - A.z));
    }
    return arr[arr.length - 1]!.y;
  };
  const withersTop = a.withersY;

  // head-local coordinates (inverse of the rigid part of the head placement)
  const hs = p.headScale * s;
  const cp = Math.cos(a.headPitch), sp = Math.sin(a.headPitch);
  const hl = (q: Vec3): Vec3 => {
    const dx = (q[0] - a.head[0]) / hs, dy = (q[1] - a.head[1]) / hs, dz = (q[2] - a.head[2]) / hs;
    return [dx, dy * cp + dz * sp, -dy * sp + dz * cp];
  };
  const noseZ = 0.1 + 0.115 * p.muzzleLength;

  const tailBase = a.tail[0]!;
  const pawCx: [number, number] = [a.front.fetlock[0], a.hind.fetlock[0]];
  const toeSp: [number, number] = [0.032 * p.paw * s, 0.027 * p.paw * s];

  const glow = pattern === 'ember';
  const frost = pattern === 'frost';
  const celestial = pattern === 'celestial';
  const striped = pattern === 'tiger' || glow || celestial;
  const stripeCol: Rgb = glow ? pal.accent : pal.stripe;
  const period = (glow ? 0.1 : celestial ? 0.12 : 0.105) * s;

  const out: PaintLayer[] = [];

  // ------------------------------------------------------------------ coat zones
  out.push(
    custom('coat', (v) => {
      const [x, y, z] = v.p;
      const top = Math.max(lerpAt(z, 'top'), 0);
      const bot = lerpAt(z, 'bot');
      const sd = clamp01((top - y) / (top - bot + 1e-5));
      const nz = v.noise.fbm(x * 6, y * 6, z * 6, { octaves: 2 });
      const sdN = clamp01(sd + 0.07 * nz);
      let c: Rgb;
      if (frost) {
        c = mixRgb(mixRgb(pal.coatDark, pal.coat, smoothstep(0, 0.35, sdN)), pal.light, smoothstep(0.35, 0.9, sdN) * 0.85);
      } else if (glow) {
        // charcoal hide: a little lighter on the flanks, black belly + inner legs
        c = mixRgb(mixRgb(pal.coat, pal.coatDark, smoothstep(0.5, 1, sdN)), pal.coatLight, smoothstep(0, 0.25, sdN) * 0.35);
      } else {
        c = mixRgb(pal.coatDark, pal.coat, smoothstep(0, 0.22, sdN) * 0.9 + 0.1);
        c = mixRgb(c, pal.coatLight, smoothstep(0.35, 0.6, sdN));
        c = mixRgb(c, pal.light, smoothstep(0.62, 0.86, sdN));
      }
      // legs: coat on top, pale toward the ground and on the inner side
      const lm = Math.max(v.region('leg', 0.025), v.region('paw', 0.02));
      if (lm > 0.01) {
        const side = x >= 0 ? 1 : -1;
        const outward = Math.max(0, side * v.n[0]);
        const inner = 1 - smoothstep(0.1, 0.75, outward);
        const lowW = smoothstep(0.42 * s, 0.08 * s, y);
        const w = clamp01(Math.max(inner * 0.9, lowW));
        const base = glow ? mixRgb(pal.coat, pal.coatDark, w * 0.6) : frost ? mixRgb(pal.coat, pal.light, w) : mixRgb(pal.coatLight, pal.light, w);
        c = mixRgb(c, base, lm);
      }
      // head: pale cheeks / muzzle / chin, coat on top
      const hm = Math.max(v.region('head', 0.02), v.region('muzzle', 0.02));
      if (hm > 0.01) {
        const q = hl(v.p);
        const lowFace = smoothstep(0.015, -0.045, q[1] + 0.012 * Math.abs(q[0]) * 2) * 0.55;
        const sideFace = smoothstep(0.05, 0.11, Math.abs(q[0])) * smoothstep(0.02, -0.03, q[1]) * 0.9;
        const muzzleW = Math.max(v.region('whisker', 0.012) * 0.95, v.region('jaw', 0.015), v.region('chin', 0.015), v.region('muzzle', 0.012) * smoothstep(-0.005, -0.04, q[1]), lowFace * 0.6, sideFace * v.region('cheek', 0.03));
        let hc: Rgb = frost ? mixRgb(pal.coat, pal.light, 0.5) : mixRgb(pal.coat, pal.coatLight, 0.5);
        hc = mixRgb(hc, pal.light, clamp01(muzzleW));
        // white patches above and under the eye
        const ex = Math.abs(q[0]);
        const pe = Math.max(1 - smoothstep(0.006, 0.016, Math.hypot(ex - 0.052, q[1] - 0.066, (q[2] - 0.118) * 0.8)), 1 - smoothstep(0.008, 0.02, Math.hypot(ex - 0.058, q[1] + 0.006, (q[2] - 0.122) * 0.8)));
        hc = mixRgb(hc, pal.light, pe * 0.9);
        c = mixRgb(c, hc, hm);
      }
      const rf = v.region('ruff', 0.012);
      if (rf > 0.01 && v.region('mane', 0.01) < 0.5) c = mixRgb(c, frost ? pal.light : mixRgb(pal.coatLight, pal.light, 0.75), rf * 0.9);
      // throat / chest bib
      const th = Math.max(v.region('throat', 0.04), v.region('chest', 0.05));
      if (th > 0.01) c = mixRgb(c, frost ? pal.light : mixRgb(pal.coatLight, pal.light, 0.8), th * 0.9);
      // belly
      const bl = v.region('belly', 0.03) * smoothstep(0.1, -0.5, v.n[1]);
      if (bl > 0.01) c = mixRgb(c, glow ? pal.coatDark : pal.light, bl * 0.8);
      v.color = c;
    }),
  );

  // ------------------------------------------------------------------ stripes
  if (striped) {
    out.push(
      custom('stripes', (v) => {
        const [x, y, z] = v.p;
        const bodyW = Math.max(v.region('torso', 0.03), v.region('neck', 0.03));
        const upperLeg = Math.max(v.region('upper_leg', 0.03), v.region('lower_leg', 0.02));
        const tailW = v.region('tail_body', 0.02);
        const headW = v.region('head', 0.015);
        let cov = 0;
        if ((bodyW > 0.01 || upperLeg > 0.01) && !glow) {
          const top = Math.max(lerpAt(z, 'top'), 0);
          const bot = lerpAt(z, 'bot');
          const sd = clamp01((top - y) / (top - bot + 1e-5));
          const w1 = v.noise.fbm(x * 7, y * 7, z * 7, { octaves: 2 });
          const w2 = v.noise.noise(x * 13 + 3, y * 13, z * 13 - 2);
          // body: bands across the barrel, leaning back as they descend; shoulder/haunch bend them
          const hz0 = a.hind.hip[2], hy0 = a.hind.hip[1];
          const hm = v.region('haunch', 0.04);
          const tHaunch = ((hy0 - y) * 0.85 + (z - hz0) * 0.55) / period;
          const tBody = z / period + 0.38 * sd * sd + 0.2 * w1 + 0.12 * Math.abs(x) / (0.3 * s);
          const t = tBody + (tHaunch + 0.3 * w1 - tBody) * hm;
          const taper = 1 - 0.8 * Math.pow(sd, 1.1);
          const hw = 0.34 * taper * (0.6 + 0.8 * w2);
          let cb = band(t, hw, 0.12 + 0.1 * sd);
          const t2 = t * 2;
          const mid = smoothstep(0.18, 0.4, sd) * (1 - smoothstep(0.62, 0.86, sd));
          cb = Math.max(cb, band(t2, 0.16 * taper * (0.7 + 0.5 * w2), 0.1) * mid * 0.95);
          // break the stripes up toward the belly
          cb *= smoothstep(-0.2, 0.08, 0.5 * w1 + 0.55 * (1 - sd));
          let cl = 0;
          if (upperLeg > 0.01) {
            const side = x >= 0 ? 1 : -1;
            const outward = smoothstep(0.0, 0.6, side * v.n[0]);
            const ty = y / (0.075 * s) + 0.4 * w1;
            const fade = smoothstep(0.07 * s, 0.34 * s, y);
            cl = band(ty, 0.3 * (0.7 + 0.5 * w2), 0.14) * outward * (0.35 + 0.65 * fade) * (v.region('upper_leg', 0.03) > 0.3 ? 1 : 0.55);
          }
          cov = Math.max(cb * bodyW * (1 - 0.6 * upperLeg), cl * upperLeg);
        }
        if (tailW > 0.01 && !glow) {
          const ring = (tailBase[2] - z + 0.35 * (tailBase[1] - y)) / (0.085 * s);
          const tc = band(ring, 0.28, 0.08) * 0.92;
          cov = Math.max(cov, tc * tailW);
        }
        const ruffW = v.region('ruff', 0.012) * (v.region('mane', 0.01) < 0.5 ? 1 : 0);
        if (ruffW > 0.01 && headW < 0.3) {
          const q = hl(v.p);
          const rt = (q[1] * 0.9 + q[2] * 0.7) / 0.03 + 0.5 * v.noise.noise(q[0] * 15, q[1] * 15, q[2] * 15);
          cov = Math.max(cov, band(rt, 0.28, 0.1) * ruffW * 0.95);
        }
        if (headW > 0.01 && !(bodyW > 0.5)) {
          const q = hl(v.p);
          const ax = Math.abs(q[0]);
          // forehead lines running back from the brow
          const top = smoothstep(0.25, 0.7, v.n[1]) * (1 - smoothstep(0.1, 0.16, q[2] - 0.0)) * smoothstep(0.1, 0.07, q[2] - 0.02);
          const fw = v.noise.noise(q[0] * 20 + 1, q[1] * 20, q[2] * 20);
          const lines = band(ax / 0.03 + 0.5 + 0.12 * fw, 0.28, 0.1) * top * smoothstep(0.012, 0.03, ax);
          // 王
          const bar = (zc: number, hwx: number): number => (1 - smoothstep(0.006, 0.0105, Math.abs(q[2] - zc))) * (1 - smoothstep(hwx - 0.004, hwx + 0.003, ax));
          const wang = Math.max(bar(0.0, 0.026), bar(0.03, 0.021), bar(0.062, 0.034), (1 - smoothstep(0.004, 0.0085, ax)) * (1 - smoothstep(0.012, 0.016, Math.abs(q[2] - 0.031) - 0.034)));
          const onTop = smoothstep(0.2, 0.55, v.n[1]) * (1 - smoothstep(0.035, 0.08, q[1] - 0.075));
          // cheek stripes sweeping back and down
          const side = smoothstep(0.3, 0.7, Math.abs(v.n[0]));
          const ct = (q[1] * 0.8 - (q[2] - 0.02) * 1.05) / 0.034 + 0.2 * fw;
          const cheek = band(ct, 0.3, 0.1) * side * smoothstep(0.075, 0.03, q[2]) * smoothstep(0.07, 0.03, q[1]) * smoothstep(-0.07, -0.03, q[1]);
          // temple stripes behind the eye
          const temple = band(((q[1] - 0.045) * 1.0 + (q[2] + 0.02) * 0.4) / 0.022 + 0.15 * fw, 0.25, 0.1) * side * smoothstep(-0.0, -0.035, q[2]) * smoothstep(-0.07, -0.02, q[2]) * smoothstep(0.0, 0.05, q[1]);
          cov = Math.max(cov, lines * 0.9, wang * onTop * (glow ? 0 : 1), cheek * 0.95, temple * 0.9);
        }
        if (glow) {
          // molten crack network: elongated voronoi seams that follow the body like charred tiger stripes
          const m = Math.max(bodyW, upperLeg * 0.9, tailW);
          if (m > 0.01) {
            const top = Math.max(lerpAt(z, 'top'), 0);
            const bot = lerpAt(z, 'bot');
            const sd = clamp01((top - y) / (top - bot + 1e-5));
            const f = 8.5 / s;
            const cell = v.noise.voronoi(x * f, y * f * 0.6, z * f * 0.95);
            const e = cell.f2 - cell.f1;
            const wob = 0.5 + 0.5 * v.noise.noise(x * 17, y * 17, z * 17);
            const crack = (1 - smoothstep(0.025 + 0.03 * wob, 0.12 + 0.05 * wob, e)) * (1 - smoothstep(0.55, 0.95, sd) * 0.85);
            cov = Math.max(cov, crack * m);
          }
        }
        if (cov <= 0.005) return;
        if (glow) {
          // molten seam: scorched edge -> ember -> hot core
          const deep = mixRgb(pal.accent, [0.04, 0.005, 0.0], 0.55);
          let c = mixRgb(v.color, deep, clamp01(cov * 1.6));
          c = mixRgb(c, pal.accent, smoothstep(0.25, 0.7, cov));
          c = mixRgb(c, pal.accentHot, smoothstep(0.7, 1, cov) * 0.95);
          v.color = c;
        } else if (celestial) {
          let c = mixRgb(v.color, pal.stripe, clamp01(cov) * 0.9);
          c = mixRgb(c, pal.accent, smoothstep(0.5, 1, cov) * 0.45);
          v.color = c;
        } else {
          v.color = mixRgb(v.color, stripeCol, clamp01(cov) * 0.94);
        }
      }),
    );
  }

  // ------------------------------------------------------------------ frost: cold shadow in the fur + glassy accents
  if (frost) {
    out.push(
      layer('frostShade', pal.accent, (v) => {
        const [x, y, z] = v.p;
        const n = v.noise.fbm(x * 9, y * 9, z * 9, { octaves: 3 });
        return smoothstep(0.0, 0.5, 0.3 + n * 0.8) * (0.35 + 0.45 * smoothstep(0.5, -0.8, v.n[1])) * clamp01(v.region('torso', 0.05) + v.region('neck', 0.05) + v.region('leg', 0.05) + v.region('mane', 0.03));
      }),
    );
  }

  // ------------------------------------------------------------------ legs / paws
  out.push(
    custom('paws', (v) => {
      const pw = v.region('paw', 0.012);
      if (pw < 0.01) return;
      const hind = v.p[2] < a.stations[3]!.z;
      const cx = pawCx[hind ? 1 : 0];
      const sp = toeSp[hind ? 1 : 0];
      const lx = Math.abs(v.p[0]) - cx;
      const fz = hind ? a.hind.fetlock[2] + 0.075 * s : a.front.fetlock[2] + 0.07 * s;
      const t = (Math.abs(v.p[0]) * (v.p[0] >= 0 ? 1 : 1) - cx) / sp;
      const near = Math.abs(t - Math.round(t));
      // dark line between toes on the front of the paw, fading toward the wrist
      const line = (1 - smoothstep(0.0, 0.1, near)) * smoothstep(fz - 0.07 * s, fz, v.p[2]) * smoothstep(1, 0, Math.abs(lx) / (2.2 * sp));
      const base = glow ? mixRgb(pal.coatDark, pal.coat, 0.5) : frost ? pal.light : mixRgb(pal.light, pal.coatLight, 0.18);
      let c = mixRgb(v.color, base, pw * 0.85);
      c = mixRgb(c, glow ? [0.01, 0.008, 0.007] : mixRgb(pal.stripe, pal.inner, 0.3), line * 0.8);
      v.color = c;
    }),
  );
  out.push(region('toe', glow ? mixRgb(pal.coatDark, pal.coat, 0.5) : mixRgb(pal.light, pal.inner, 0.25), 0.5, 0.005));
  out.push(region('claw', pal.claw, 1, 0.003));
  out.push(layer('tailUnder', pal.light, (v) => clamp01(v.region('tail', 0.02)) * smoothstep(0.1, -0.5, v.n[1]) * (glow ? 0 : 0.5)));
  out.push(region('tail_tip', glow ? mixRgb(pal.accent, pal.accentHot, 0.5) : frost ? pal.accent : pal.stripe, 0.95, 0.045));

  // ------------------------------------------------------------------ head details
  out.push(region('nose', pal.nose, 1, 0.006));
  out.push(region('nostril', [0.005, 0.003, 0.003], 1, 0.004));
  out.push(layer('lips', mixRgb(pal.stripe, [0, 0, 0], 0.4), (v) => v.region('lipline', 0.006) * 0.95));
  out.push(layer('muzzleTop', pal.stripe, (v) => v.region('bridge', 0.01) * smoothstep(0.6, 0.95, v.n[1]) * (glow ? 0.3 : 0.18) * (frost ? 0 : 1)));
  // whisker dots
  out.push(
    custom('whiskerDots', (v) => {
      const w = v.region('whisker', 0.008);
      if (w < 0.05) return;
      const q = hl(v.p);
      const gx = (q[2] - 0.12) / 0.019, gy = (q[1] + 0.045) / 0.017;
      const row = Math.round(gy), col = Math.round(gx - (row % 2) * 0.5 + 0.0);
      const cx = (col + (row % 2) * 0.5) * 0.019 + 0.12, cy = row * 0.017 - 0.045;
      const d = Math.hypot(q[2] - cx, (q[1] - cy) * 1.1);
      const inside = smoothstep(0.0045, 0.0025, d) * smoothstep(0.02, 0.035, Math.abs(q[0])) * smoothstep(0.1, 0.07, Math.abs(q[1] + 0.045));
      if (inside > 0) v.color = mixRgb(v.color, glow ? pal.accent : frost ? pal.accent : pal.stripe, inside * w * 0.85);
    }),
  );
  out.push(region('ear', mixRgb(glow ? pal.coatDark : pal.stripe, pal.coat, 0.1), 0.9, 0.012));
  out.push(
    custom('earSpot', (v) => {
      const e = v.region('ear', 0.01);
      if (e < 0.05 || frost) return;
      const q = hl(v.p);
      // white eye-spot on the back of each ear
      const d = Math.hypot(Math.abs(q[0]) - 0.125, (q[1] - 0.105) * 1.1, (q[2] + 0.062) * 1.3);
      const back = smoothstep(0.1, 0.5, -v.n[2] * 0.7 + Math.abs(v.n[0]) * 0.5);
      v.color = mixRgb(v.color, glow ? pal.accentHot : pal.light, smoothstep(0.009, 0.005, d) * back * 0.85);
    }),
  );
  out.push(region('ear_inner', mixRgb(pal.inner, pal.light, 0.4), 0.95, 0.008));
  // inside of the mouth: palate / gums on the underside of the snout and top of the jaw
  out.push(
    custom('mouthInside', (v) => {
      const q = hl(v.p);
      const m = Math.max(v.region('muzzle', 0.012) * smoothstep(-0.35, -0.8, v.n[1]), v.region('jaw', 0.012) * smoothstep(0.35, 0.8, v.n[1]));
      if (m > 0.02 && q[2] < noseZ - 0.02) v.color = mixRgb(v.color, pal.mouth, m * 0.9);
    }),
  );
  out.push(region('tongue', mixRgb(pal.mouth, [0.95, 0.55, 0.55], 0.25), 1, 0.006));
  out.push(region('fang', [0.92, 0.88, 0.76], 1, 0.003));
  out.push(
    custom('eyes', (v) => {
      const ring = v.region('eye', 0.016);
      if (ring > 0) v.color = mixRgb(v.color, glow ? mixRgb(pal.coatDark, [0, 0, 0], 0.5) : mixRgb(pal.stripe, [0, 0, 0], 0.5), 0.85 * ring);
      const e = v.region('eye', 0.002);
      if (e > 0) v.color = mixRgb(v.color, pal.eye, e);
      const pu = v.region('pupil', 0.0014);
      if (pu > 0) v.color = mixRgb(v.color, [0.01, 0.008, 0.008], pu);
    }),
  );

  // ------------------------------------------------------------------ adornment: mane, ridge, horns, gilt
  if (p.maneStyle !== 'none') {
    // lock gradient: distance from the neck axis (root 0 -> tip 1)
    const nA: Vec3 = [0, a.neck[1] - 0.05 * s, a.neck[2] - 0.17 * s];
    const nB: Vec3 = [0, a.head[1] - 0.005 * s, a.head[2] - 0.09 * hs];
    const ax = vnorm([nB[0] - nA[0], nB[1] - nA[1], nB[2] - nA[2]]);
    const lockK = (q: Vec3): number => {
      const rx = q[0] - nA[0], ry = q[1] - nA[1], rz = q[2] - nA[2];
      const pr = rx * ax[0] + ry * ax[1] + rz * ax[2];
      const d = Math.hypot(rx - ax[0] * pr, ry - ax[1] * pr, rz - ax[2] * pr);
      return clamp01((d - 0.2 * p.neckThick * s) / (0.2 * p.mane * s));
    };
    out.push(
      custom('mane', (v) => {
        const m = v.region('mane', 0.012);
        if (m < 0.01) return;
        const k = clamp01(lockK(v.p) + 0.25 * v.noise.noise(v.p[0] * 14, v.p[1] * 14, v.p[2] * 14));
        let c: Rgb;
        if (p.maneStyle === 'flame') {
          const root = mixRgb(pal.accent, [0.05, 0.01, 0.0], 0.5);
          c = k < 0.5 ? mixRgb(root, pal.accent, k * 2) : mixRgb(pal.accent, pal.accentHot, (k - 0.5) * 2);
          if (celestial) c = mixRgb(c, pal.light, smoothstep(0.78, 1, k) * 0.75);
        } else {
          c = frost ? mixRgb(mixRgb(pal.coatDark, pal.accent, 0.25), pal.light, smoothstep(0.05, 0.85, k)) : mixRgb(pal.coatDark, pal.coatLight, k);
        }
        v.color = mixRgb(v.color, c, m);
      }),
    );
  }
  out.push(
    custom('ridge', (v) => {
      const r = v.region('ridge', 0.01);
      if (r < 0.01) return;
      const k = smoothstep(0.0, 1, 0.1 + 5 * (v.p[1] - lerpAt(v.p[2], 'top')) / s);
      const base = p.ridge === 'crystal' ? mixRgb(mixRgb(pal.accent, pal.coatDark, 0.3), pal.accentHot, k) : p.ridge === 'ember' ? mixRgb(pal.coatDark, pal.accent, k) : mixRgb(pal.accent, pal.accentHot, k * 0.8);
      v.color = mixRgb(v.color, base, r);
    }),
  );
  out.push(layer('horn', pal.horn, (v) => v.region('horn', 0.008) * 1));
  out.push(
    custom('hornTip', (v) => {
      const h = v.region('horn', 0.01);
      if (h < 0.02) return;
      const q = hl(v.p);
      const tip = smoothstep(0.17, 0.26, q[1] + (Math.abs(q[0]) - 0.1) * 0.2);
      v.color = mixRgb(v.color, glow ? pal.accentHot : pal.light, tip * h * 0.8);
    }),
  );
  if (p.regalia) {
    out.push(
      custom('gilt', (v) => {
        const g = v.region('gilt', 0.006);
        if (g < 0.02) return;
        const k = 0.5 + 0.5 * v.noise.noise(v.p[0] * 40, v.p[1] * 40, v.p[2] * 40);
        let c = mixRgb(mixRgb(pal.accent, pal.accentHot, 0.6), pal.accentHot, k * 0.5);
        const gem = v.region('gem', 0.004);
        c = mixRgb(c, [0.15, 0.7, 0.55], gem);
        v.color = mixRgb(v.color, c, g);
      }),
    );
  }

  // ------------------------------------------------------------------ fur texture
  const flow = (v: PaintVertex): Vec3 => {
    const leg = clamp01(v.region('leg', 0.03));
    const tl = clamp01(v.region('tail', 0.03));
    const head = clamp01(v.region('head', 0.02));
    const mix3 = (x: Vec3, y: Vec3, t: number): Vec3 => [x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t];
    const baseD: Vec3 = [0, -0.3 * v.n[1] - 0.12, -1];
    return vnorm(mix3(mix3(mix3(baseD, [0, -1, -0.15], leg), [0, -0.5, -1], tl), [0, -0.12, 1], head * (1 - leg)));
  };
  const furAmt = frost ? 1.15 : 0.8;
  out.push(strands({ flow, freq: 80 / s, stretch: 4, amount: 0.16 * furAmt, octaves: 2 }));
  out.push(strands({ flow, freq: 260 / s, stretch: 8, amount: 0.3 * furAmt, octaves: 3 }));
  out.push(
    strands({
      flow, freq: 320 / s, stretch: 10, amount: 0.7, octaves: 1,
      tint: frost ? mixRgb(pal.light, [1, 1, 1], 0.5) : adjust(pal.coatLight, 0.04, 0.7),
      mask: (v) => smoothstep(0.1, 0.8, v.n[1]) * clamp01(v.region('torso', 0.03) + v.region('neck', 0.03)) * 0.35,
    }),
  );
  out.push(furClumps({ freq: 26 / s, amount: 0.12, stretch: [1, 1, 0.45] }));
  out.push(grain(0.04, 150 / s));
  void bones;

  const shade: PaintLayer[] = [
    cavity(0.3, 0.1),
    bakeAo(0.7, glow ? [0.45, 0.3, 0.3] : frost ? [0.5, 0.55, 0.75] : [0.5, 0.45, 0.5]),
    hemi(rgb('#fff6e6'), frost ? rgb('#9fb4d4') : rgb('#bba58a'), 0.55),
    rimTint(frost ? rgb('#d8ecff') : rgb('#ffe9c8'), { strength: 0.1 }),
  ];
  void withersTop;
  return { albedo: out, shade, ...(textureSize > 0 ? { texture: { size: textureSize, quality: 90 } } : {}) };
}
