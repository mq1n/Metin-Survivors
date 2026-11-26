// chest_gold: red lacquer chest with brass fittings, 0.9 m: smooth curved lid (9 staves), brass frame bands, brass straps with
// studs, L corner caps, a lock plate with an endless-knot diamond, drop-ring side handles, brass feet. Lid on bone `lid`
// (`open` clip), faces +Z, hinge at the back.
import type { ModelData } from '../../core/model.ts';
import { Assembly } from './assembly.ts';
import { buildPickup } from './build.ts';
import { buildFrame, type FrameParams } from './chestFrame.ts';
import { coinDisc, coinHeap, lidRig, polyStaves } from './chestKit.ts';
import { type V3, arc, bar, chamferBox, clamp, compose, ellipse, hull, move, rotZ, sstep, stud } from './geom.ts';
import { Grain, type Rgb, hash1, mixRgb, rgb } from './paintkit.ts';

const Z = { frame: 2, foot: 3, brass: 4, rivet: 5, lock: 6, keyhole: 7, gold: 8, gem: 9, inner: 10, enamel: 11 } as const;
const PLANK = 20, BACK = 30, RIGHT = 40, LEFT = 50, STAVE = 60, PLATE = 80;

export const goldParams: FrameParams = {
  W: 1.1, D: 0.7, feet: 0.09, Hb: 0.46, t: 0.035,
  plinth: { h: 0.05, out: 0.014 }, rim: { h: 0.065, out: 0.014 },
  planks: 2, groove: { depth: 0.004, width: 0.004 },
  floorY: 0.3,
  lid: { rise: 0.3, wall: 0.045, staves: 9, t: 0.03, plate: 0.03, boards: 1 },
  foot: { size: 0.11, inset: 0.05 },
};

export function buildChestGold(log: (s: string) => void): ModelData {
  const p = goldParams;
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
  const out = 0.014;
  const zBrass = zf + out;
  const stud4 = (c: V3, up: V3, r: number, bone = 0): void => {
    asm.add(stud(c, up, r, r * 0.75, 4, 0, Math.PI / 4), Z.rivet, undefined, bone, false);
  };

  // ---- brass straps over the lid and down the front, studded
  const segs = lid.poly.length - 1;
  for (const x of [-0.34, 0.34]) {
    asm.addAll(polyStaves(lid.poly, { t: 0.003, e0: x - 0.036, e1: x + 0.036, outset: out, chamferE: 0.005 }, lidMap), Z.brass, undefined, 1);
    asm.add(chamferBox([x, (f.y0 + y1) / 2, zf + (out - 0.003) / 2], [0.072, y1 - f.y0, out + 0.003], 0.004), Z.brass);
    for (let i = 1; i < segs - 1; i += 2) {
      const a = lid.poly[i]!, b = lid.poly[i + 1]!;
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const nz = (b[1] - a[1]) / l, ny = -(b[0] - a[0]) / l;
      stud4([x, y1 + (a[1] + b[1]) / 2 + ny * (out - 0.001), (a[0] + b[0]) / 2 + nz * (out - 0.001)], [0, ny, nz], 0.011, 1);
    }
    for (let k = 0; k < 3; k++) stud4([x, f.y0 + 0.075 + k * 0.15, zBrass - 0.001], [0, 0, 1], 0.011);
  }

  // ---- front corner caps (L wraps)
  for (const sx of [-1, 1]) {
    const mid = (f.y0 + y1) / 2, hgt = y1 - f.y0;
    asm.add(chamferBox([sx * (xo - 0.04), mid, zf + (out - 0.003) / 2], [0.1, hgt, out + 0.003], 0.004), Z.brass);
    asm.add(chamferBox([sx * (xo + (out - 0.003) / 2), mid, zf - 0.046], [out + 0.003, hgt, 0.086], 0.004), Z.brass);
    for (let k = 0; k < 3; k++) stud4([sx * (xo - 0.04), f.y0 + 0.075 + k * 0.15, zBrass - 0.001], [0, 0, 1], 0.011);
  }

  // ---- lock plate with an endless-knot diamond, keyhole and hasp
  const plateC: V3 = [0, y1 - 0.014, zf + 0.011];
  const zPlate = plateC[2] + 0.01;
  asm.add(chamferBox(plateC, [0.16, 0.19, 0.02], 0.008), Z.lock);
  for (const [sx, sy] of [[-1, 1], [1, 1], [1, -1], [-1, -1]] as const) {
    const ang = sx * sy > 0 ? -Math.PI / 4 : Math.PI / 4;
    asm.add(chamferBox([0, 0, 0], [0.088, 0.013, 0.007], 0.002), Z.rivet, compose(move(sx * 0.03, plateC[1] + sy * 0.03, zPlate + 0.0025), rotZ(ang)), 0, false);
    stud4([sx * 0.064, plateC[1] + sy * 0.074, zPlate - 0.001], [0, 0, 1], 0.009);
  }
  const disc: V3[] = [];
  for (let k = 0; k < 8; k++) {
    const a = ((k + 0.5) / 8) * Math.PI * 2;
    disc.push([Math.cos(a) * 0.026, plateC[1] + Math.sin(a) * 0.026, zPlate - 0.001], [Math.cos(a) * 0.02, plateC[1] + Math.sin(a) * 0.02, zPlate + 0.01]);
  }
  asm.add(hull(disc), Z.enamel, undefined, 0, false);
  asm.add(chamferBox([0, plateC[1] + 0.004, zPlate + 0.0105], [0.01, 0.026, 0.003], 0), Z.keyhole, undefined, 0, false);
  asm.addAll(polyStaves(lid.poly.slice(0, 4), { t: 0.003, e0: -0.036, e1: 0.036, outset: out, chamferE: 0.004 }, lidMap), Z.lock, undefined, 1);

  // ---- drop-ring handles on both sides
  for (const sx of [-1, 1]) {
    const cx = sx * (xo + 0.016), cy = (f.y0 + y1) / 2 + 0.02;
    asm.add(stud([sx * xo, cy + 0.045, 0], [sx, 0, 0], 0.024, 0.018, 8), Z.brass, undefined, 0, false);
    asm.add(bar(ellipse(0.0075, 0.0075, 4, Math.PI / 4), arc([cx, cy, 0], [0, 1, 0], [0, 0, 1], 0.05, Math.PI * 0.62, Math.PI * 2.38, 9)), Z.brass, undefined, 0, false);
  }

  // ---- hinge plates on the back
  for (const x of [-0.36, 0.36]) {
    asm.add(chamferBox([x, y1 + 0.07, -Dl / 2 - 0.006], [0.07, 0.14, 0.014], 0.003), Z.brass, undefined, 1);
    asm.add(chamferBox([x, y1 - 0.07, -zf - 0.006], [0.07, 0.14, 0.014], 0.003), Z.brass);
  }

  // ---- treasure
  asm.addAll(coinHeap(0.02, 0.0, 0.38, 0.22, p.floorY, 0.11, 11), Z.gold, undefined, 0, false);
  for (const [c, n] of [[[-0.26, p.floorY + 0.08, 0.1], [0.3, 0.9, 0.3]], [[0.2, p.floorY + 0.1, -0.05], [-0.35, 0.85, 0.4]]] as [V3, V3][]) {
    const l = Math.hypot(n[0], n[1], n[2]);
    asm.add(coinDisc(c, [n[0] / l, n[1] / l, n[2] / l], 0.048, 0.01), Z.gold, undefined, 0, false);
  }
  const gem: V3[] = [];
  const gc: V3 = [-0.05, p.floorY + 0.12, 0.05];
  for (let k = 0; k < 6; k++) gem.push([gc[0] + Math.cos((k / 6) * Math.PI * 2) * 0.036, gc[1], gc[2] + Math.sin((k / 6) * Math.PI * 2) * 0.036]);
  gem.push([gc[0], gc[1] + 0.05, gc[2]], [gc[0], gc[1] - 0.03, gc[2]]);
  asm.add(hull(gem), Z.gem, undefined, 0, false);

  // ---- rig + paint
  const rig = lidRig(f.hinge);
  const grain = new Grain('chest_gold');
  const red = rgb('#a40e17'), redDeep = rgb('#3f050a'), redHot = rgb('#c71f24');
  const brassLo = rgb('#8f5a10'), brassHi = rgb('#f5bd3c');
  const lidCentre: V3 = [0, y1 + 0.13, 0];
  const brass = (c: { ny: number; bevel: number; x: number; y: number; z: number }, o: Rgb, lift = 0): void => {
    const v = clamp(0.38 + 0.4 * clamp(c.ny, 0, 1) + 0.5 * clamp(c.bevel * 3, 0, 1) + lift + 0.12 * grain.at(c.x * 40, c.y * 40, c.z * 40), 0, 1);
    const b = mixRgb(brassLo, brassHi, v);
    o[0] = b[0]; o[1] = b[1]; o[2] = b[2];
  };
  const lacquer = (c: { zone: number; y: number; x: number; z: number; bevel: number; ny: number }, o: Rgb): void => {
    const tone = hash1(c.zone * 11 + 3);
    let b = mixRgb(red, redHot, 0.25 * tone + 0.25 * clamp(c.ny, 0, 1) + 0.12 * grain.fbm(c.x * 5, c.y * 5, c.z * 5));
    b = mixRgb(b, redDeep, 0.25 * sstep(0.1, -0.25, c.y - 0.5));
    if (c.zone < STAVE && Math.abs(c.ny) > 0.42) b = mixRgb(b, brassHi, 0.9);
    o[0] = b[0]; o[1] = b[1]; o[2] = b[2];
  };

  return buildPickup(
    {
      id: 'chest_gold',
      mesh: asm.mesh,
      covers: asm.covers,
      crease: 34,
      ao: {
        rays: 48, maxDist: 0.3, falloff: 1.2, ground: true,
        openIf: (x, y, z, nx, ny, nz, _zone, bone) => {
          if (bone === 1) return (lidCentre[0] - x) * nx + (lidCentre[1] - y) * ny + (lidCentre[2] - z) * nz > 0;
          if (ny > 0.5 && Math.abs(y - y1) < 0.002) return true;
          return y > p.floorY - 0.03 && Math.abs(x) < hx - p.t + 0.012 && Math.abs(z) < hz - p.t + 0.012 && y < y1 + 0.004;
        },
      },
      refine: { maxEdge: () => 2, minEdge: 0.012, tol: 0.045, passes: 3, budget: 2400 },
      skin: { skeleton: rig.skeleton, openXf: rig.openXf },
      clips: rig.clips,
      paint: (c, o) => {
        const z = c.zone;
        if (z === STAVE || z === STAVE + 8 || z === Z.frame || z === Z.foot || z === Z.brass || z === Z.lock) brass(c, o, z === Z.lock ? 0.1 : 0);
        else if (z >= PLANK && z < PLATE + 20 && z !== Z.inner) lacquer(c, o);
        else {
          let b: Rgb;
          switch (z) {
            case Z.rivet:
              b = mixRgb(brassLo, brassHi, 0.65 + 0.35 * clamp(c.ny, 0, 1));
              break;
            case Z.enamel:
              b = mixRgb(rgb('#7a0910'), rgb('#e03a2a'), 0.4 + 0.6 * clamp(c.ny, 0, 1));
              break;
            case Z.keyhole:
              b = rgb('#120406');
              break;
            case Z.inner:
              b = mixRgb(rgb('#2a0508'), rgb('#6a0f16'), 0.5 + 0.5 * grain.at(c.x * 8, c.y * 8, c.z * 8));
              break;
            case Z.gold:
              b = mixRgb(rgb('#c4841c'), rgb('#ffd24a'), 0.5 + 0.5 * clamp(c.ny, 0, 1));
              break;
            default:
              b = rgb('#2fd0b0');
          }
          o[0] = b[0]; o[1] = b[1]; o[2] = b[2];
        }
      },
      grade: { floor: 0.3, gamma: 1.1, tint: [1, 0.85, 0.85] },
    },
    log,
  );
}
