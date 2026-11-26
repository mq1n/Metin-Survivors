// chest_wood: plain but crafted wooden chest, 0.8 m: groove-chamfered planks cut into grain rows, faceted barrel lid with
// vertical-board end plates, iron straps over the lid and down the front with rivets, iron lock plate + hasp, corner brackets,
// hinge straps, small feet, a hollow interior with a loose-coin heap. Lid on bone `lid` (`open` clip), faces +Z, hinge at the back.
import type { ModelData } from '../../core/model.ts';
import { Assembly } from './assembly.ts';
import { buildPickup } from './build.ts';
import { buildFrame, type FrameParams } from './chestFrame.ts';
import { coinDisc, coinHeap, lidRig, polyStaves } from './chestKit.ts';
import { type V3, chamferBox, clamp, hull, sstep, stud } from './geom.ts';
import { Grain, type Rgb, hash1, mixRgb, rgb } from './paintkit.ts';

const Z = { floor: 1, frame: 2, foot: 3, iron: 4, rivet: 5, lock: 6, keyhole: 7, gold: 8, gem: 9, inner: 10, brass: 11 } as const;
const PLANK = 20, BACK = 30, RIGHT = 40, LEFT = 50, STAVE = 60, PLATE = 80;

export const woodParams: FrameParams = {
  W: 1.04, D: 0.64, feet: 0.06, Hb: 0.44, t: 0.035,
  plinth: { h: 0.05, out: 0.012 }, rim: { h: 0.06, out: 0.012 },
  planks: 3, groove: { depth: 0.007, width: 0.007 },
  floorY: 0.28,
  lid: { rise: 0.255, wall: 0.04, staves: 7, t: 0.03, plate: 0.03, boards: 4 },
  foot: { size: 0.1, inset: 0.05 },
};

export function buildChestWood(log: (s: string) => void): ModelData {
  const p = woodParams;
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
  const zf = hz + p.rim.out; // front plane of the proud frame bands
  const xo = hx + p.rim.out; // side plane of the proud frame bands
  const out = 0.015; // iron proud of the frame bands / lid wood
  const zIron = zf + out;
  const rivet = (c: V3, up: V3, bone = 0): void => {
    asm.add(stud(c, up, 0.0105, 0.0075, 4, 0, Math.PI / 4), Z.rivet, undefined, bone, false);
  };

  // ---- iron straps over the lid and down the front of the body
  const segs = lid.poly.length - 1;
  for (const x of [-0.29, 0.29]) {
    asm.addAll(polyStaves(lid.poly, { t: 0.003, e0: x - 0.04, e1: x + 0.04, outset: out, chamferE: 0.005 }, lidMap), Z.iron, undefined, 1);
    asm.add(chamferBox([x, (f.y0 + y1) / 2, zf + (out - 0.003) / 2], [0.08, y1 - f.y0, out + 0.003], 0.004), Z.iron);
    for (let i = 1; i < segs - 1; i += 2) {
      const a = lid.poly[i]!, b = lid.poly[i + 1]!;
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const nz = (b[1] - a[1]) / l, ny = -(b[0] - a[0]) / l;
      const mz = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      for (const sx of [-0.022, 0.022]) rivet([x + sx, y1 + my + ny * (out - 0.001), mz + nz * (out - 0.001)], [0, ny, nz], 1);
    }
    for (let k = 0; k < 3; k++) for (const sx of [-0.022, 0.022]) rivet([x + sx, f.y0 + 0.07 + k * 0.14, zIron - 0.001], [0, 0, 1]);
  }

  // ---- front corner brackets (L wraps) with rivets
  for (const sx of [-1, 1]) {
    const mid = (f.y0 + y1) / 2, hgt = y1 - f.y0;
    asm.add(chamferBox([sx * (xo - 0.036), mid, zf + (out - 0.003) / 2], [0.092, hgt, out + 0.003], 0.004), Z.iron);
    asm.add(chamferBox([sx * (xo + (out - 0.003) / 2), mid, zf - 0.044], [out + 0.003, hgt, 0.082], 0.004), Z.iron);
    for (let k = 0; k < 3; k++) {
      const y = f.y0 + 0.07 + k * 0.14;
      rivet([sx * (xo - 0.036), y, zIron - 0.001], [0, 0, 1]);
      rivet([sx * (xo + out - 0.001), y, zf - 0.044], [sx, 0, 0]);
    }
  }

  // ---- lock plate, keyhole with a brass escutcheon, hasp
  const plateC: V3 = [0, y1 - 0.012, zf + 0.011];
  const zPlate = plateC[2] + 0.01;
  asm.add(chamferBox(plateC, [0.125, 0.16, 0.02], 0.007), Z.lock);
  for (const [dx, dy] of [[-0.045, 0.062], [0.045, 0.062], [-0.045, -0.062], [0.045, -0.062]] as const) {
    asm.add(stud([dx, plateC[1] + dy, zPlate - 0.001], [0, 0, 1], 0.009, 0.006, 4, 0, Math.PI / 4), Z.rivet, undefined, 0, false);
  }
  const ring: V3[] = [];
  const keyY = plateC[1] + 0.014;
  for (let k = 0; k < 8; k++) {
    const a = ((k + 0.5) / 8) * Math.PI * 2;
    ring.push([Math.cos(a) * 0.026, keyY + Math.sin(a) * 0.026, zPlate - 0.002], [Math.cos(a) * 0.022, keyY + Math.sin(a) * 0.022, zPlate + 0.004]);
  }
  asm.add(hull(ring), Z.brass, undefined, 0, false);
  const eye: V3[] = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    eye.push([Math.cos(a) * 0.012, keyY + Math.sin(a) * 0.012, zPlate + 0.0035]);
  }
  asm.add(hull([...eye, ...eye.map((q): V3 => [q[0], q[1], q[2] - 0.003])]), Z.keyhole, undefined, 0, false);
  asm.add(chamferBox([0, keyY - 0.026, zPlate + 0.0025], [0.009, 0.034, 0.003], 0), Z.keyhole, undefined, 0, false);
  asm.addAll(polyStaves(lid.poly.slice(0, 4), { t: 0.003, e0: -0.032, e1: 0.032, outset: out, chamferE: 0.004 }, lidMap), Z.lock, undefined, 1);

  // ---- hinge straps on the back (the lid part rotates, the body part is fixed) and the barrel between them
  for (const x of [-0.33, 0.33]) {
    asm.add(chamferBox([x, y1 + 0.07, -Dl / 2 - 0.006], [0.07, 0.14, 0.014], 0.003), Z.iron, undefined, 1);
    asm.add(chamferBox([x, y1 - 0.07, -zf - 0.006], [0.07, 0.14, 0.014], 0.003), Z.iron);
    const bar: V3[] = [];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      for (const sx of [-0.035, 0.035]) bar.push([x + sx, y1 + Math.cos(a) * 0.014, -Dl / 2 - 0.012 + Math.sin(a) * 0.014]);
    }
    asm.add(hull(bar), Z.iron, undefined, 0, false);
  }

  // ---- interior: loose coins and a gem on the floor
  asm.addAll(coinHeap(0.02, 0.0, 0.34, 0.2, p.floorY, 0.1, 7), Z.gold, undefined, 0, false);
  const discs: [V3, V3][] = [
    [[-0.24, p.floorY + 0.075, 0.1], [0.3, 0.9, 0.3]], [[0.18, p.floorY + 0.098, -0.06], [-0.35, 0.85, 0.4]],
  ];
  for (const [c, n] of discs) {
    const l = Math.hypot(n[0], n[1], n[2]);
    asm.add(coinDisc(c, [n[0] / l, n[1] / l, n[2] / l], 0.045, 0.01), Z.gold, undefined, 0, false);
  }
  const gem: V3[] = [];
  const gc: V3 = [-0.06, p.floorY + 0.115, 0.04];
  for (let k = 0; k < 6; k++) gem.push([gc[0] + Math.cos((k / 6) * Math.PI * 2) * 0.035, gc[1], gc[2] + Math.sin((k / 6) * Math.PI * 2) * 0.035]);
  gem.push([gc[0], gc[1] + 0.045, gc[2]], [gc[0], gc[1] - 0.03, gc[2]]);
  asm.add(hull(gem), Z.gem, undefined, 0, false);

  // ---- rig + paint
  const rig = lidRig(f.hinge);
  const grain = new Grain('chest_wood');
  const woodLight = rgb('#b07a42'), woodMid = rgb('#7d4b26'), woodDark = rgb('#3a2110');
  const ironDark = rgb('#1d2028'), ironMid = rgb('#383d49'), ironHi = rgb('#8892a6'), rust = rgb('#6e3b1d');
  const goldC = rgb('#e8ae2c'), gemC = rgb('#d0202c'), brassC = rgb('#d9a13a');
  const lidCentre: V3 = [0, y1 + 0.12, 0];

  const wood = (c: { x: number; y: number; z: number; zone: number; bevel: number }, axis: 0 | 1 | 2, o: Rgb): void => {
    const tone = hash1(c.zone * 13 + 5);
    const base = mixRgb(woodDark, woodLight, 0.18 + 0.62 * tone);
    const s = grain.streak(c.x, c.y, c.z, axis, 85, 2.2);
    const wear = clamp(c.bevel * 4, 0, 1);
    const k = (1 + 0.42 * s) * (1 + 0.3 * wear);
    o[0] = base[0] * k; o[1] = base[1] * k; o[2] = base[2] * k;
  };

  return buildPickup(
    {
      id: 'chest_wood',
      mesh: asm.mesh,
      covers: asm.covers,
      slice: (zone, n) => {
        if (zone >= PLANK && zone < PLANK + 10) return n[2] > 0.9 ? { axis: 1, step: 0.017 } : null;
        if (zone >= RIGHT && zone < LEFT + 10) return Math.abs(n[0]) > 0.9 ? { axis: 1, step: 0.017 } : null;
        if (zone > STAVE && zone < STAVE + 8) return n[1] > 0.15 ? { axis: Math.abs(n[1]) > Math.abs(n[2]) ? 2 : 1, step: 0.018 } : null;
        return null;
      },
      crease: 38,
      ao: {
        rays: 48, maxDist: 0.28, falloff: 1.2, ground: true,
        openIf: (x, y, z, nx, ny, nz, _zone, bone) => {
          if (bone === 1) return (lidCentre[0] - x) * nx + (lidCentre[1] - y) * ny + (lidCentre[2] - z) * nz > 0;
          if (ny > 0.5 && Math.abs(y - y1) < 0.002) return true;
          return y > p.floorY - 0.03 && Math.abs(x) < hx - p.t + 0.012 && Math.abs(z) < hz - p.t + 0.012 && y < y1 + 0.004;
        },
      },
      refine: { maxEdge: () => 2, minEdge: 0.012, tol: 0.05, passes: 3, budget: 2350 },
      skin: { skeleton: rig.skeleton, openXf: rig.openXf },
      clips: rig.clips,
      paint: (c, o) => {
        const z = c.zone;
        if (z >= PLANK && z < PLANK + 10) wood(c, 0, o);
        else if (z >= BACK && z < BACK + 10) wood(c, 0, o);
        else if (z >= RIGHT && z < LEFT + 10) wood(c, 2, o);
        else if (z >= STAVE && z < STAVE + 10) wood(c, 0, o);
        else if (z >= PLATE && z < PLATE + 20) wood(c, 1, o);
        else {
          let b: Rgb;
          switch (z) {
            case Z.frame:
              b = mixRgb(woodMid, woodLight, 0.35 + 0.3 * grain.at(c.x * 6, c.y * 6, c.z * 6));
              b = mixRgb(b, woodLight, clamp(c.bevel * 4, 0, 0.5));
              break;
            case Z.foot:
              b = woodDark;
              break;
            case Z.inner:
            case Z.floor:
              b = mixRgb(woodDark, woodMid, 0.4 + 0.3 * grain.at(c.x * 8, c.y * 8, c.z * 8));
              break;
            case Z.iron:
            case Z.lock: {
              const wear = clamp(c.bevel * 5, 0, 1);
              b = mixRgb(ironMid, ironHi, 0.3 * wear + 0.2 * clamp(c.ny, 0, 1));
              const sp = grain.at(c.x * 90, c.y * 90, c.z * 90);
              b = mixRgb(b, ironDark, sstep(-0.2, 0.7, -sp) * 0.5);
              if (sp > 0.55) b = mixRgb(b, rust, 0.5);
              break;
            }
            case Z.rivet:
              b = mixRgb(ironMid, ironHi, 0.55 + 0.4 * clamp(c.ny + 0.2, 0, 1));
              break;
            case Z.keyhole:
              b = rgb('#0a0a0c');
              break;
            case Z.brass:
              b = mixRgb(rgb('#a8731d'), brassC, 0.4 + 0.6 * clamp(c.ny + 0.3, 0, 1));
              break;
            case Z.gold:
              b = mixRgb(rgb('#b9791a'), goldC, 0.5 + 0.5 * clamp(c.ny, 0, 1));
              break;
            default:
              b = gemC;
          }
          o[0] = b[0]; o[1] = b[1]; o[2] = b[2];
        }
      },
      grade: { floor: 0.3, gamma: 1.15, tint: [1, 0.85, 0.8] },
    },
    log,
  );
}
