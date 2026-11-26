// potion_hp: red health potion in a gourd (hulu) glass bottle: two bulbs + waist, red liquid with highlight ribbons, a pale glass
// neck, gold collar, tapered cork with a wound red lacquer cord, a knot with a hanging tassel and a gold seal plaque on the belly.
// Lathe glass (20 segments) with ring heights chosen by hand, everything else is small hull / sweep parts; budget <= 1200 tris.
import { HardMesh } from '../../core/hard/hardmesh.ts';
import type { ModelData } from '../../core/model.ts';
import { Assembly } from './assembly.ts';
import { buildPickup } from './build.ts';
import { type V3, bar, clamp, ellipse, hull, lerp, revolve, spline, sstep } from './geom.ts';
import { Grain, type Rgb, mixRgb, rgb } from './paintkit.ts';

const ZONE = { liquid: 1, glass: 2, gold: 3, cork: 4, cord: 5, tassel: 6, enamel: 7, hilite: 8, knot: 9 } as const;

const SEG = 18;
/** smooth gourd silhouette (r, y) through hand-placed control points */
const KEY: V3[] = [[0.058, 0, 0], [0.092, 0.02, 0], [0.1135, 0.06, 0], [0.1195, 0.1, 0], [0.108, 0.145, 0], [0.078, 0.178, 0], [0.05, 0.2, 0], [0.056, 0.222, 0], [0.074, 0.248, 0], [0.0805, 0.268, 0], [0.072, 0.292, 0], [0.052, 0.316, 0], [0.0345, 0.334, 0], [0.0315, 0.358, 0], [0.0315, 0.378, 0], [0.0365, 0.388, 0]];
const DENSE = spline(KEY, 480);
/** glass ring heights (hand placed: dense on the bulbs, sparse on the neck) */
const RING_Y = [0, 0.014, 0.038, 0.07, 0.105, 0.14, 0.168, 0.188, 0.205, 0.226, 0.25, 0.272, 0.292, 0.316, 0.338, 0.375, 0.388];

/** soft highlight ribbons on the glass: azimuth (rad from +Z towards +X), height range, half width at the middle, steps */
interface Ribbon { th: number; y0: number; y1: number; w: number; steps: number }
const RIBBONS: Ribbon[] = [{ th: -0.78, y0: 0.05, y1: 0.17, w: 0.0075, steps: 4 }, { th: -0.62, y0: 0.232, y1: 0.288, w: 0.0052, steps: 3 }];
function ribbonHalfWidth(rb: Ribbon, y: number): number {
  const t = clamp((y - rb.y0) / (rb.y1 - rb.y0), 0.04, 0.96);
  return rb.w * Math.pow(Math.sin(Math.PI * t), 0.6);
}
const LIQUID_Y = 0.292;
const NECK_R = 0.0315;

/** glass radius at height y */
export function rAt(y: number): number {
  const first = DENSE[0]!, last = DENSE[DENSE.length - 1]!;
  if (y <= first[1]) return first[0];
  if (y >= last[1]) return last[0];
  let lo = 0, hi = DENSE.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (DENSE[mid]![1] <= y) lo = mid;
    else hi = mid;
  }
  const a = DENSE[lo]!, b = DENSE[hi]!;
  const t = (y - a[1]) / (b[1] - a[1] || 1);
  return lerp(a[0], b[0], t);
}

/** point at azimuth `th` (rad from +Z towards +X) and height y, pushed `off` metres along the surface normal */
function surf(th: number, y: number, off: number): V3 {
  const d = 0.002;
  const s = (rAt(y + d) - rAt(y - d)) / (2 * d);
  const l = Math.hypot(1, s);
  const r = rAt(y) + (off * 1) / l;
  const yy = y + (off * -s) / l;
  return [Math.sin(th) * r, yy, Math.cos(th) * r];
}

/** flat polygon strip / fan builders in plaque coordinates (u right, v up, w out of the surface) */
type Mapper = (u: number, v: number, w: number) => V3;

function ridgeOn(P: Mapper, cu: number, cv: number, ang: number, len: number, wid: number, hgt: number, w0: number): HardMesh {
  const m = new HardMesh();
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const Q = (a: number, b: number, h: number): V3 => P(cu + ca * a - sa * b, cv + sa * a + ca * b, w0 + h);
  const hl = len / 2, hw = wid / 2;
  const e = Math.min(hl * 0.5, wid * 0.55);
  const b0 = Q(-hl, -hw, 0), b1 = Q(hl, -hw, 0), b2 = Q(hl, hw, 0), b3 = Q(-hl, hw, 0);
  const c0 = Q(-hl + e, 0, hgt), c1 = Q(hl - e, 0, hgt);
  m.tri(b0, b1, c1).tri(b0, c1, c0).tri(b1, b2, c1).tri(b2, b3, c0).tri(b2, c0, c1).tri(b3, b0, c0);
  return m;
}

export function potionMesh(): HardMesh {
  const asm = new Assembly();
  // ---- glass: liquid below LIQUID_Y, pale glass above
  const profile = RING_Y.map((y) => [rAt(y), y] as [number, number]);
  const iL = RING_Y.indexOf(LIQUID_Y);
  const below: [number, number][] = [[0, 0], ...profile.slice(0, iL + 1)];
  const above: [number, number][] = [...profile.slice(iL), [rAt(0.388) - 0.0022, 0.392], [0.0275, 0.392]];
  asm.add(revolve(below, SEG), ZONE.liquid);
  asm.add(revolve(above, SEG), ZONE.glass);

  // ---- gold collar at the base of the neck (16 segments)
  asm.add(revolve([[0.0445, 0.318], [0.0485, 0.322], [0.0485, 0.335], [0.0335, 0.344]], 16), ZONE.gold);

  // ---- cork: tapered, slightly flared, domed top (12 segments)
  asm.add(revolve([[0.0272, 0.383], [0.0305, 0.415], [0.0328, 0.443], [0.0285, 0.45], [0, 0.4515]], 12), ZONE.cork);

  // ---- wound red cord: 2.5 turns round the neck, ending in a knot at the front-right
  const turns = 2.5, perTurn = 6;
  const n = Math.round(turns * perTurn);
  const rc = NECK_R + 0.0036;
  const a0 = -Math.PI * 0.62;
  const helix: V3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const th = a0 + t * turns * Math.PI * 2;
    helix.push([Math.sin(th) * rc, 0.353 + t * 0.026, Math.cos(th) * rc]);
  }
  asm.add(bar(ellipse(0.0042, 0.0042, 5, Math.PI / 2), helix), ZONE.cord);
  const knotAt = helix[n]!;
  // knot: small flattened diamond bead
  const kc: V3 = [knotAt[0] + 0.004, knotAt[1] + 0.001, knotAt[2] + 0.006];
  const kn: V3[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) kn.push([kc[0] + sx * 0.0085, kc[1] + sy * 0.0058, kc[2] + 0.002]);
  kn.push([kc[0], kc[1], kc[2] + 0.0085], [kc[0], kc[1], kc[2] - 0.004]);
  asm.add(hull(kn), ZONE.knot);

  // ---- tassel: cord hugging the shoulder down to a gold bead + fringe skirt
  const hang: V3[] = [];
  const th0 = Math.atan2(kc[0], kc[2]);
  const yTop = kc[1] - 0.004;
  for (let i = 0; i <= 4; i++) hang.push(surf(th0 + i * 0.07, lerp(yTop, 0.262, i / 4), 0.0085));
  asm.add(bar(ellipse(0.0027, 0.0027, 4, Math.PI / 4), hang), ZONE.tassel);
  const hb = hang[hang.length - 1]!;
  const bead: V3[] = [];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    bead.push([hb[0] + Math.cos(a) * 0.0095, hb[1] - 0.0065, hb[2] + Math.sin(a) * 0.0095]);
  }
  bead.push([hb[0], hb[1], hb[2]], [hb[0], hb[1] - 0.0135, hb[2]]);
  asm.add(hull(bead), ZONE.gold);
  const fr: V3[] = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.2;
    fr.push([hb[0] + Math.cos(a) * 0.0055, hb[1] - 0.0125, hb[2] + Math.sin(a) * 0.0055]);
    fr.push([hb[0] + Math.cos(a + 0.2) * 0.0145, hb[1] - 0.056, hb[2] + Math.sin(a + 0.2) * 0.0145]);
  }
  asm.add(hull(fr), ZONE.tassel);

  // ---- highlight ribbons on the glass (left-front): 3 vertices across so the colour can fade into the liquid
  const ribbon = (rb: Ribbon): HardMesh => {
    const m = new HardMesh();
    const rows: V3[][] = [];
    for (let i = 0; i <= rb.steps; i++) {
      const y = lerp(rb.y0, rb.y1, i / rb.steps);
      const wid = ribbonHalfWidth(rb, y);
      const dth = wid / rAt(y);
      rows.push([surf(rb.th - dth, y, 0.0006), surf(rb.th, y, 0.0024), surf(rb.th + dth, y, 0.0006)]);
    }
    for (let i = 0; i < rb.steps; i++) {
      const a = rows[i]!, b = rows[i + 1]!;
      m.quad(a[0]!, a[1]!, b[1]!, b[0]!);
      m.quad(a[1]!, a[2]!, b[2]!, b[1]!);
    }
    return m;
  };
  for (const rb of RIBBONS) asm.add(ribbon(rb), ZONE.hilite);

  // ---- gold seal plaque on the belly (conforms to the glass)
  const yc = 0.098, rc0 = rAt(yc);
  const P: Mapper = (u, v, w) => surf(u / rc0, yc + v, w);
  const O: [number, number][] = [[-0.03, -0.046], [0.03, -0.046], [0.04, -0.034], [0.04, 0.034], [0.03, 0.046], [-0.03, 0.046], [-0.04, 0.034], [-0.04, -0.034]];
  const sx = 0.8, sy = 0.82;
  const I: [number, number][] = O.map(([u, v]) => [u * sx, v * sy]);
  const hBase = -0.002, h1 = 0.0058, h2 = 0.0025;
  const gold = new HardMesh(), enamel = new HardMesh(), glyph = new HardMesh();
  const m8 = O.length;
  for (let i = 0; i < m8; i++) {
    const j = (i + 1) % m8;
    const [ou0, ov0] = O[i]!, [ou1, ov1] = O[j]!, [iu0, iv0] = I[i]!, [iu1, iv1] = I[j]!;
    gold.quad(P(ou0, ov0, hBase), P(ou1, ov1, hBase), P(ou1, ov1, h1), P(ou0, ov0, h1)); // outer wall
    gold.quad(P(ou0, ov0, h1), P(ou1, ov1, h1), P(iu1, iv1, h1), P(iu0, iv0, h1)); // rim top
    gold.quad(P(iu0, iv0, h1), P(iu1, iv1, h1), P(iu1, iv1, h2), P(iu0, iv0, h2)); // inner wall
    enamel.tri(P(iu0, iv0, h2), P(iu1, iv1, h2), P(0, 0, h2)); // panel fan
  }
  // glyph on the enamel: three bars + a stem (an original 'seal' mark)
  const bw = 0.0072, bh = 0.0026;
  for (const dv of [-0.022, 0, 0.022]) ridgeOn(P, 0, dv, 0, dv === 0 ? 0.03 : 0.04, bw, bh, h2).appendTo(glyph);
  ridgeOn(P, 0, 0, Math.PI / 2, 0.056, bw, bh, h2).appendTo(glyph);
  asm.add(gold, ZONE.gold);
  asm.add(enamel, ZONE.enamel);
  asm.add(glyph, ZONE.gold);
  return asm.mesh;
}

export function buildPotion(log: (s: string) => void): ModelData {
  const mesh = potionMesh();
  const grain = new Grain('potion_hp');
  const liquidDeep = rgb('#6d0612'), liquidMid = rgb('#b50f22'), liquidTop = rgb('#d9283b');
  const glassPale = rgb('#cfe8ea'), glassEdge = rgb('#8fbcc4');
  const goldLight = rgb('#f2b52a'), goldMid = rgb('#cf8612');
  const corkLight = rgb('#c79a62'), corkDark = rgb('#8e6236');
  const cordRed = rgb('#c4161f'), cordDark = rgb('#7d0b12');
  const enamel = rgb('#8c0c18');
  const hilite = rgb('#f7b3ad');
  return buildPickup(
    {
      id: 'potion_hp',
      mesh,
      crease: 75,
      ao: { rays: 40, maxDist: 0.07, minElev: 0.22 },
      refine: { maxEdge: () => 0.09, minEdge: 0.012, tol: 0.045, passes: 1, budget: 1160 },
      paint: (c, out) => {
        const ang = Math.atan2(c.x, c.z); // azimuth from +Z
        let base: Rgb;
        switch (c.zone) {
          case ZONE.liquid: {
            // darker towards the base, brighter ruby up the shoulder, meniscus at the top
            const t = c.y / LIQUID_Y;
            base = mixRgb(liquidDeep, liquidMid, sstep(0.0, 0.5, t));
            base = mixRgb(base, liquidTop, sstep(0.55, 1.0, t) * 0.8);
            const n = grain.fbm(c.x * 25, c.y * 25, c.z * 25, 2);
            base = mixRgb(base, liquidDeep, 0.12 * (0.5 + 0.5 * n));
            {
              // broad painted sheen on the lit (left-front) side of both bulbs
              let d = ang + 0.7;
              if (d > Math.PI) d -= Math.PI * 2;
              const sheen = Math.exp(-(d * d) / 0.22) * (c.y < 0.2 ? sstep(0.03, 0.12, c.y) * (1 - sstep(0.14, 0.2, c.y)) : sstep(0.22, 0.26, c.y) * (1 - sstep(0.28, 0.292, c.y)));
              base = mixRgb(base, rgb('#ff6a6c'), 0.5 * sheen);
            }
            break;
          }
          case ZONE.glass: {
            const t = sstep(LIQUID_Y, 0.39, c.y);
            base = mixRgb(glassPale, glassEdge, 0.25 + 0.35 * t);
            // thin liquid film just above the meniscus
            if (c.y < LIQUID_Y + 0.012) base = mixRgb(base, liquidTop, 0.55 * (1 - (c.y - LIQUID_Y) / 0.012));
            break;
          }
          case ZONE.gold: {
            const n = grain.fbm(c.x * 60, c.y * 60, c.z * 60, 2);
            base = mixRgb(goldMid, goldLight, clamp(0.5 + 0.5 * c.ny + 0.2 * n + 3 * c.bevel, 0, 1));
            break;
          }
          case ZONE.cork: {
            const n = grain.fbm(c.x * 90, c.y * 40, c.z * 90, 3);
            base = mixRgb(corkDark, corkLight, clamp(0.5 + 0.7 * n, 0, 1));
            break;
          }
          case ZONE.cord: {
            // twisted-rope bands: every other segment of the helix is darker
            const band = Math.floor((ang / (Math.PI * 2) + 1) * 14 + c.y * 400) & 1;
            base = mixRgb(cordRed, cordDark, band ? 0.55 : 0.0);
            base = mixRgb(base, rgb('#ff6a5a'), clamp(0.9 * c.ny, 0, 0.5));
            break;
          }
          case ZONE.tassel:
            base = mixRgb(cordRed, rgb('#e0382e'), 0.4 * clamp(c.ny + 0.5, 0, 1));
            break;
          case ZONE.knot:
            base = mixRgb(cordRed, cordDark, 0.25);
            break;
          case ZONE.enamel:
            base = mixRgb(enamel, rgb('#b3151f'), 0.3 * (0.5 + 0.5 * grain.at(c.x * 80, c.y * 80, c.z * 80)));
            break;
          case ZONE.hilite: {
            // fade from a bright core into the liquid at the ribbon edges
            const rb = c.y < 0.2 ? RIBBONS[0]! : RIBBONS[1]!;
            let dth = ang - rb.th;
            if (dth > Math.PI) dth -= Math.PI * 2;
            if (dth < -Math.PI) dth += Math.PI * 2;
            const e = clamp((Math.abs(dth) * Math.hypot(c.x, c.z)) / Math.max(1e-4, ribbonHalfWidth(rb, c.y)), 0, 1);
            base = mixRgb(hilite, liquidTop, Math.pow(e, 1.4));
            break;
          }
          default:
            base = goldMid;
        }
        out[0] = base[0]; out[1] = base[1]; out[2] = base[2];
      },
      grade: { floor: 0.34, gamma: 1.15, tint: [1, 0.85, 0.9] },
    },
    log,
  );
}
