// chest_boss: black lacquer chest with gold fittings, 1.3 m: dragon-head clasp (upper jaw, horns and brow on the lid, lower jaw
// on the body so the mouth opens with the lid), glowing orange-red plank seams and inlays, horned corner posts, claw feet and a
// dragon spine of fins along the lid. Lid on bone `lid` (`open` clip), faces +Z, hinge at the back.
import type { ModelData } from '../../core/model.ts';
import { Assembly } from './assembly.ts';
import { buildPickup } from './build.ts';
import { buildFrame, type FrameParams } from './chestFrame.ts';
import { coinDisc, coinHeap, lidRig, polyStaves } from './chestKit.ts';
import { type Mat4, type V3, bar, chamferBox, clamp, compose, ellipse, hull, move, scaleM, spline, stud } from './geom.ts';
import { Grain, type Rgb, hash1, mixRgb, rgb } from './paintkit.ts';

const Z = { frame: 2, foot: 3, gold: 4, rivet: 5, glow: 6, ivory: 7, treasure: 8, gem: 9, inner: 10 } as const;
const PLANK = 20, BACK = 30, RIGHT = 40, LEFT = 50, STAVE = 60, PLATE = 80;

export const bossParams: FrameParams = {
  W: 1.5, D: 0.9, feet: 0.13, Hb: 0.58, t: 0.045,
  plinth: { h: 0.07, out: 0.018 }, rim: { h: 0.08, out: 0.018 },
  planks: 2, groove: { depth: 0.006, width: 0.006 },
  floorY: 0.4,
  lid: { rise: 0.42, wall: 0.06, staves: 9, t: 0.04, plate: 0.04, boards: 1 },
  foot: { size: 0.15, inset: 0.07 },
};

export function buildChestBoss(log: (s: string) => void): ModelData {
  const p = bossParams;
  const asm = new Assembly('drop');
  const hx = p.W / 2, hz = p.D / 2;
  const f = buildFrame(asm, p, {
    plank: (w, k) => (w === 0 ? PLANK : w === 1 ? BACK : w === 2 ? RIGHT : LEFT) + k,
    frame: Z.frame, floor: Z.inner, foot: Z.foot,
    lidStave: (k) => STAVE + k,
    lidPlate: (s, k) => PLATE + s * 10 + k,
  });
  const { y1, Dl, lid } = f;
  const lidMap = (a: number, b: number, e: number): V3 => [e, y1 + b, a];
  const zf = hz + p.rim.out;
  const xo = hx + p.rim.out;
  const out = 0.018;
  let xform: Mat4 | undefined;
  const stud4 = (c: V3, up: V3, r: number, zone: number = Z.rivet, bone = 0): void => {
    asm.add(stud(c, up, r, r * 0.75, 4, 0, Math.PI / 4), zone, xform, bone, false);
  };
  const decor = (part: ReturnType<typeof hull>, zone: number, bone = 0): void => {
    asm.add(part, zone, xform, bone, false);
  };

  // ---- gold straps over the lid and down the front with a glowing inlay line
  const segs = lid.poly.length - 1;
  for (const x of [-0.52, 0.52]) {
    asm.addAll(polyStaves(lid.poly, { t: 0.003, e0: x - 0.045, e1: x + 0.045, outset: out, chamferE: 0.006 }, lidMap), Z.gold, undefined, 1);
    asm.addAll(polyStaves(lid.poly, { t: 0.002, e0: x - 0.007, e1: x + 0.007, outset: out + 0.005 }, lidMap), Z.glow, undefined, 1, false);
    asm.add(chamferBox([x, (f.y0 + y1) / 2, zf + (out - 0.003) / 2], [0.09, y1 - f.y0, out + 0.003], 0.005), Z.gold);
    decor(chamferBox([x, (f.y0 + y1) / 2, zf + out + 0.0015], [0.014, y1 - f.y0 - 0.06, 0.005], 0), Z.glow);
    for (let i = 1; i < segs - 1; i += 2) {
      const a = lid.poly[i]!, b = lid.poly[i + 1]!;
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const nz = (b[1] - a[1]) / l, ny = -(b[0] - a[0]) / l;
      for (const sx of [-0.03, 0.03]) stud4([x + sx, y1 + (a[1] + b[1]) / 2 + ny * (out - 0.001), (a[0] + b[0]) / 2 + nz * (out - 0.001)], [0, ny, nz], 0.013, Z.rivet, 1);
    }
  }

  // ---- horned corner posts (curved gold horns rising from the four body corners)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const base: V3 = [sx * (xo - 0.02), y1 - 0.02, sz * (zf - 0.02)];
    const path = spline([base, [base[0] + sx * 0.03, base[1] + 0.12, base[2] + sz * 0.03], [base[0] + sx * 0.09, base[1] + 0.25, base[2] + sz * 0.07], [base[0] + sx * 0.17, base[1] + 0.34, base[2] + sz * 0.1]], 7);
    asm.add(bar(ellipse(0.034, 0.034, 6), path, (t) => 1 - 0.92 * t), Z.gold, undefined, 0, false);
    decor(chamferBox([base[0], y1 + 0.01, base[2]], [0.1, 0.03, 0.1], 0.008), Z.gold);
  }

  // ---- dragon-head clasp: upper jaw + horns + brow + eyes on the lid, lower jaw + pearl on the body
  const hy = y1, hzf = zf + out;
  xform = compose(move(0, hy, hzf), scaleM(1.45), move(0, -hy, -hzf));
  const wedge = (x0: number, x1: number, ya: number, yb: number, yc: number, yd: number, za: number, zb: number): V3[] => [
    [-x0, ya, za], [x0, ya, za], [-x0, yb, za], [x0, yb, za],
    [-x1, yc, zb], [x1, yc, zb], [-x1, yd, zb], [x1, yd, zb],
  ];
  decor(hull(wedge(0.095, 0.058, hy + 0.0, hy + 0.14, hy + 0.025, hy + 0.09, hzf, hzf + 0.12)), Z.gold, 1);
  decor(hull(wedge(0.095, 0.075, hy - 0.005, hy + 0.0, hy - 0.005, hy + 0.0, hzf, hzf + 0.1)), Z.gold, 1);
  for (const sx of [-1, 1]) {
    decor(hull([[sx * 0.025, hy + 0.14, hzf + 0.05], [sx * 0.105, hy + 0.13, hzf + 0.0], [sx * 0.105, hy + 0.2, hzf - 0.02], [sx * 0.04, hy + 0.15, hzf - 0.015], [sx * 0.025, hy + 0.115, hzf + 0.075], [sx * 0.105, hy + 0.11, hzf + 0.01]]), Z.gold, 1);
    const eye: V3 = [sx * 0.062, hy + 0.1, hzf + 0.045];
    decor(hull([[eye[0] + 0.018, eye[1], eye[2]], [eye[0] - 0.018, eye[1], eye[2]], [eye[0], eye[1] + 0.014, eye[2]], [eye[0], eye[1] - 0.014, eye[2]], [eye[0], eye[1], eye[2] + 0.02], [eye[0], eye[1], eye[2] - 0.01]]), Z.glow, 1);
    stud4([sx * 0.025, hy + 0.085, hzf + 0.118], [0, 0.4, 1], 0.012, Z.gold, 1);
    const hornPath = spline([[sx * 0.075, hy + 0.13, hzf + 0.0], [sx * 0.12, hy + 0.2, hzf - 0.03], [sx * 0.2, hy + 0.31, hzf - 0.08], [sx * 0.3, hy + 0.4, hzf - 0.2]], 7);
    asm.add(bar(ellipse(0.022, 0.022, 5), hornPath, (t) => 1 - 0.9 * t), Z.gold, xform, 1, false);
    for (const tx of [0.03, 0.065]) stud4([sx * tx, hy - 0.002, hzf + 0.075], [0, -1, 0.15], 0.011, Z.ivory, 1);
  }
  decor(hull(wedge(0.085, 0.055, hy - 0.11, hy - 0.025, hy - 0.1, hy - 0.05, hzf, hzf + 0.1)), Z.gold);
  for (const tx of [-0.065, -0.03, 0.03, 0.065]) stud4([tx, hy - 0.027, hzf + 0.08], [0, 1, 0.15], 0.011, Z.ivory);
  const pearl: V3[] = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    pearl.push([Math.cos(a) * 0.028, hy - 0.06 + Math.sin(a) * 0.028, hzf + 0.06], [Math.cos(a) * 0.018, hy - 0.06 + Math.sin(a) * 0.018, hzf + 0.088]);
  }
  decor(hull(pearl), Z.glow);
  decor(chamferBox([0, hy - 0.06, hzf + 0.008], [0.2, 0.17, 0.012], 0.004), Z.gold);
  xform = undefined;

  // ---- dragon spine: gold fins along the lid crown
  for (let k = 1; k < segs; k++) {
    const a = lid.poly[k]!, b = lid.poly[k + 1]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const nz = (b[1] - a[1]) / l, ny = -(b[0] - a[0]) / l;
    const z = (a[0] + b[0]) / 2, y = y1 + (a[1] + b[1]) / 2;
    if (z > 0.22 || z < -0.3) continue;
    const tip: V3 = [0, y + ny * 0.075, z + nz * 0.075 - 0.03];
    decor(hull([[-0.014, y - 0.006, z - 0.035], [0.014, y - 0.006, z - 0.035], [-0.014, y - 0.006, z + 0.035], [0.014, y - 0.006, z + 0.035], tip]), Z.gold, 1);
  }

  // ---- claw feet
  const fx = hx - p.foot.inset, fz = hz - p.foot.inset;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    for (const tx of [-0.04, 0.04]) {
      const c: V3 = [sx * fx + tx, 0.075, sz * (fz + p.foot.size / 2 - 0.01)];
      decor(hull([[c[0] - 0.014, c[1] + 0.03, c[2] - 0.02], [c[0] + 0.014, c[1] + 0.03, c[2] - 0.02], [c[0] - 0.014, c[1] - 0.02, c[2]], [c[0] + 0.014, c[1] - 0.02, c[2]], [c[0] + tx * 0.2, 0.0, c[2] + sz * 0.075]]), Z.ivory);
    }
  }

  // ---- hinge plates on the back
  for (const x of [-0.45, 0.45]) {
    decor(chamferBox([x, y1 + 0.08, -Dl / 2 - 0.007], [0.08, 0.16, 0.014], 0.003), Z.gold, 1);
    decor(chamferBox([x, y1 - 0.08, -zf - 0.007], [0.08, 0.16, 0.014], 0.003), Z.gold);
  }

  // ---- treasure
  asm.addAll(coinHeap(0.02, 0.0, 0.5, 0.3, p.floorY, 0.14, 21), Z.treasure, undefined, 0, false);
  for (const [c, n] of [[[-0.34, p.floorY + 0.1, 0.12], [0.3, 0.9, 0.3]]] as [V3, V3][]) {
    const l = Math.hypot(n[0], n[1], n[2]);
    decor(coinDisc(c, [n[0] / l, n[1] / l, n[2] / l], 0.055, 0.012), Z.treasure);
  }
  const gem: V3[] = [];
  const gc: V3 = [-0.08, p.floorY + 0.16, 0.05];
  for (let k = 0; k < 6; k++) gem.push([gc[0] + Math.cos((k / 6) * Math.PI * 2) * 0.045, gc[1], gc[2] + Math.sin((k / 6) * Math.PI * 2) * 0.045]);
  gem.push([gc[0], gc[1] + 0.06, gc[2]], [gc[0], gc[1] - 0.04, gc[2]]);
  decor(hull(gem), Z.gem);

  // ---- rig + paint
  const rig = lidRig(f.hinge);
  const grain = new Grain('chest_boss');
  const blackLo = rgb('#0a080d'), blackHi = rgb('#2b2236');
  const goldLo = rgb('#8e5a10'), goldHi = rgb('#f6c040');
  const glowC = rgb('#ff5a14'), glowHot = rgb('#ffb347');
  const lidCentre: V3 = [0, y1 + 0.18, 0];
  const gold = (c: { ny: number; bevel: number; x: number; y: number; z: number }, o: Rgb): void => {
    const v = clamp(0.36 + 0.4 * clamp(c.ny, 0, 1) + 0.5 * clamp(c.bevel * 3, 0, 1) + 0.12 * grain.at(c.x * 40, c.y * 40, c.z * 40), 0, 1);
    const b = mixRgb(goldLo, goldHi, v);
    o[0] = b[0]; o[1] = b[1]; o[2] = b[2];
  };

  return buildPickup(
    {
      id: 'chest_boss',
      mesh: asm.mesh,
      covers: asm.covers,
      crease: 34,
      ao: {
        rays: 48, maxDist: 0.34, falloff: 1.2, ground: true,
        openIf: (x, y, z, nx, ny, nz, _zone, bone) => {
          if (bone === 1) return (lidCentre[0] - x) * nx + (lidCentre[1] - y) * ny + (lidCentre[2] - z) * nz > 0;
          if (ny > 0.5 && Math.abs(y - y1) < 0.002) return true;
          return y > p.floorY - 0.03 && Math.abs(x) < hx - p.t + 0.012 && Math.abs(z) < hz - p.t + 0.012 && y < y1 + 0.004;
        },
      },
      refine: { maxEdge: () => 2, minEdge: 0.012, tol: 0.045, passes: 3, budget: 2450 },
      skin: { skeleton: rig.skeleton, openXf: rig.openXf },
      clips: rig.clips,
      paint: (c, o) => {
        const z = c.zone;
        if (z === Z.gold || z === Z.frame || z === Z.foot || z === STAVE || z === STAVE + 8) gold(c, o);
        else if (z >= PLANK && z < PLATE + 20) {
          let b = mixRgb(blackLo, blackHi, 0.25 * hash1(z * 7 + 1) + 0.35 * clamp(c.ny, 0, 1) + 0.15 * grain.fbm(c.x * 4, c.y * 4, c.z * 4));
          if (z < STAVE && Math.abs(c.ny) > 0.42) b = mixRgb(b, mixRgb(glowC, glowHot, 0.3 * grain.at(c.x * 30, c.y * 30, c.z * 30) + 0.4), 0.95);
          o[0] = b[0]; o[1] = b[1]; o[2] = b[2];
        } else {
          let b: Rgb;
          switch (z) {
            case Z.rivet:
              b = mixRgb(goldLo, goldHi, 0.7 + 0.3 * clamp(c.ny, 0, 1));
              break;
            case Z.glow:
              b = mixRgb(glowC, glowHot, 0.5 + 0.5 * clamp(c.ny, 0, 1));
              break;
            case Z.ivory:
              b = mixRgb(rgb('#a99a7c'), rgb('#f2e6c8'), 0.4 + 0.6 * clamp(c.ny + 0.3, 0, 1));
              break;
            case Z.inner:
              b = mixRgb(rgb('#0c0810'), rgb('#33140c'), 0.5 + 0.5 * grain.at(c.x * 8, c.y * 8, c.z * 8));
              break;
            case Z.treasure:
              b = mixRgb(rgb('#c4841c'), rgb('#ffd24a'), 0.5 + 0.5 * clamp(c.ny, 0, 1));
              break;
            default:
              b = rgb('#e03060');
          }
          o[0] = b[0]; o[1] = b[1]; o[2] = b[2];
        }
      },
      grade: { floor: 0.3, gamma: 1.1, tint: [1, 0.9, 0.95] },
    },
    log,
  );
}
