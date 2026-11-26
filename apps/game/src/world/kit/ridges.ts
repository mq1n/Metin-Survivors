// World kit (C7) relief: internal cliff spines (ridges with passes) and raised plateau steps with walkable ramps.

// dark cliff corridors; the flame map has a raised dais. Both return heights to ADD to a recipe's height(), a cliff
// mask for paint() and a distance. Deterministic (see util.ts).
import { clamp, fbm, ridged, smoothstep } from '../noise';
import { terrace } from '../shapes';
import type { PlateauSpec, Relief, RidgeSpec } from './types';
import { Path2, smoothCurve, subSeed, unit } from './util';


export function ridge(spec: RidgeSpec): Relief {
  const path = new Path2(smoothCurve(spec.pts, 3));
  const total = path.total;
  const H = Math.max(0, spec.height);
  const width = Math.max(0.5, spec.width);
  const steep = clamp(spec.steep, 0, 1);
  const passes = spec.passes ?? [];
  const s1 = subSeed(spec.seed, 1);
  const s2 = subSeed(spec.seed, 2);
  const s3 = subSeed(spec.seed, 3);
  const taperLen = Math.max(1e-3, Math.min(width * 1.6, total * 0.3));
  const reachW = width * 1.25 + 1;
  const along = { s: 0 };
  // a pass ramps from the floor to the crest over this many metres along the spine
  const passRamp = 2 + (1 - steep) * H * 1.2;

  /** u = distance / local half width, env = taper · passes · local crest height; returns false outside the footprint */
  const frame = (x: number, z: number, o: { u: number; env: number; d: number }): boolean => {
    const d = path.nearest(x, z, along, reachW);
    o.d = d;
    if (d >= reachW) return false;
    const s = along.s;
    const w = width * (1 + 0.18 * fbm(s / 45, 3.3, s1, 2));
    o.u = d / w;
    if (o.u >= 1) return false;
    let env = smoothstep(0, taperLen, s) * smoothstep(0, taperLen, total - s);
    for (const p of passes) env *= smoothstep(p.width * 0.5, p.width * 0.5 + passRamp, Math.abs(s - p.at));
    o.env = env * H * (0.78 + 0.44 * clamp(0.5 + 1.6 * fbm(s / 38, 7.7, s2, 2), 0, 1));
    return o.env > 0;
  };
  const f = { u: 0, env: 0, d: 0 };

  return {
    height(x, z) {
      if (H <= 0 || !frame(x, z, f)) return 0;
      const u = f.u;
      // rolling hill vs rock spine: a narrow crest, walls between u 0.42 and 0.72, a talus apron at the foot
      const soft = 1 - smoothstep(0, 1, u);
      const wall = (1 - 0.22 * smoothstep(0, 0.5, u)) * (1 - smoothstep(0.42, 0.72, u)) + 0.1 * (1 - smoothstep(0.6, 1, u)) * smoothstep(0.42, 0.72, u);
      let h = f.env * (soft + (wall - soft) * steep);
      if (steep > 0) {
        // crag on the crest and strata benches on the walls (no smooth curtain)
        const cr = ridged(x / 16, z / 16, s3, 2);
        h *= 1 - steep * 0.12 + steep * 0.24 * cr;
        // benches fade in above 1 m so the foot apron stays continuous
        if (h > 1) h += (terrace(h, 3.5 + 2 * cr, 0.45) - h) * steep * 0.6 * smoothstep(1, 3, h);
      }
      return h;
    },
    cliff(x, z) {
      if (H <= 0 || steep <= 0 || !frame(x, z, f)) return 0;
      // rock from the crest down to the wall foot, scaled by how tall the spine is here
      return steep * (1 - smoothstep(0.7, 0.9, f.u)) * smoothstep(0.5, 3, f.env);
    },
    distance(x, z) {
      return path.nearest(x, z, along);
    },
  };
}

/** Raised plateau step with ramps (snowm plateaus, the flame dais). */
export function plateau(spec: PlateauSpec): Relief {
  const [cx, cz] = spec.centre;
  const R = Math.max(0.5, spec.radius);
  const wobble = spec.wobble ?? R * 0.12;
  const H = spec.height;
  const E = Math.max(0.25, spec.edge);
  const grade = clamp(spec.rampGrade ?? 0.4, 0.05, 0.8);
  const rampLen = Math.abs(H) / grade;
  const s0 = subSeed(spec.seed, 1);
  const s1 = subSeed(spec.seed, 2);
  const s2 = subSeed(spec.seed, 3);
  const edgeR = (ux: number, uz: number): number => R + wobble * clamp(1.8 * fbm(ux * 1.7 + 3.1, uz * 1.7 - 1.9, s0, 3), -1, 1);
  const ramps = (spec.ramps ?? []).map((r) => {
    const [dx, dz] = unit(r.dir[0], r.dir[1]);
    return { dx, dz, half: Math.max(0.5, r.width * 0.5), r0: edgeR(dx, dz) };
  });
  const reach = R + Math.abs(wobble) + Math.max(E, rampLen) + 3;
  /** riser frame: t (0 at the top edge, 1 at the foot), ramp mask and ramp height */
  const f = { t: 0, ramp: 0, rh: 0, r: 0, er: 0 };
  const frame = (x: number, z: number): boolean => {
    const dx = x - cx;
    const dz = z - cz;
    const r2 = dx * dx + dz * dz;
    if (r2 > reach * reach) return false;
    const r = Math.sqrt(r2);
    const ux = r > 1e-6 ? dx / r : 1;
    const uz = r > 1e-6 ? dz / r : 0;
    const er = edgeR(ux, uz);
    f.r = r;
    f.er = er;
    f.t = (r - er) / E;
    f.ramp = 0;
    f.rh = 0;
    for (const rp of ramps) {
      const al = dx * rp.dx + dz * rp.dz;
      if (al < rp.r0 - E - 1) continue;
      const lat = Math.abs(dx * rp.dz - dz * rp.dx);
      const m = 1 - smoothstep(rp.half, rp.half + 1.5, lat);
      if (m <= 0) continue;
      const rh = H * (1 - clamp((al - rp.r0) / rampLen, 0, 1));
      if (m > f.ramp) {
        f.ramp = m;
        f.rh = rh;
      }
    }
    return true;
  };
  return {
    height(x, z) {
      if (!frame(x, z)) return 0;
      let h = H * (1 - smoothstep(0, 1, f.t));
      // a little crag on the riser, a gentle swell on the top (never a perfect disc)
      if (f.t > -0.2 && f.t < 1.2) h += H * 0.08 * fbm(x / 7, z / 7, s1, 2) * smoothstep(-0.2, 0.2, f.t) * (1 - smoothstep(0.8, 1.2, f.t));
      if (f.t < 0) h += 0.25 * fbm(x / 22, z / 22, s2, 2) * smoothstep(0, -0.5, f.t);
      if (f.ramp > 0) {
        const up = H >= 0 ? Math.max(h, f.rh) : Math.min(h, f.rh);
        h += (up - h) * f.ramp;
      }
      return h;
    },
    cliff(x, z) {
      if (!frame(x, z)) return 0;
      // only a riser too steep to walk counts as cliff (max riser slope of the smoothstep = 1.5 H / E)
      const steepness = smoothstep(0.6, 1.2, (1.5 * Math.abs(H)) / E);
      return steepness * smoothstep(-0.1, 0.15, f.t) * (1 - smoothstep(0.85, 1.1, f.t)) * (1 - f.ramp);
    },
    distance(x, z) {
      const dx = x - cx;
      const dz = z - cz;
      const r = Math.sqrt(dx * dx + dz * dz);
      const ux = r > 1e-6 ? dx / r : 1;
      const uz = r > 1e-6 ? dz / r : 0;
      return r - edgeR(ux, uz);
    },
  };
}
