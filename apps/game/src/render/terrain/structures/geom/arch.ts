// Reusable East-Asian architecture pieces on top of the primitives: paint sets, column feet and shafts, bracket
// clusters (dougong), name tablets, stairs and balustrades. All pieces are built at the builder's current origin, front = +Z.
import type { ArchPalette } from '../palette';
import { lit, paint, type MeshBuilder, type Paint } from './builder';
import { KIND } from './kinds';
import type { RoofStyle } from './roof';
import { box, boxAt, entasisProfile, lathe, quadZ } from './shapes';

export interface Paints {
  lacquer: Paint;
  lacquerDark: Paint;
  gold: Paint;
  accent: Paint;
  timber: Paint;
  timberDark: Paint;
  plaster: Paint;
  plasterDark: Paint;
  stone: Paint;
  stoneDark: Paint;
  stoneLight: Paint;
  masonry: Paint;
  masonryDark: Paint;
  paper: Paint;
  roof: RoofStyle;
}

export function makePaints(pal: ArchPalette): Paints {
  return {
    lacquer: paint(pal.lacquer, KIND.lacquer, 0, 0.035),
    lacquerDark: paint(pal.lacquerDark, KIND.lacquer, 0, 0.035),
    gold: paint(pal.gold, KIND.metal, 0, 0.03),
    accent: paint(pal.accent, KIND.lacquer, 0, 0.04),
    timber: paint(pal.timber, KIND.wood, 0, 0.05),
    timberDark: paint(pal.timberDark, KIND.wood, 0, 0.05),
    plaster: paint(pal.plaster, KIND.plaster, 0, 0.03),
    plasterDark: paint(pal.plasterDark, KIND.plaster, 0, 0.03),
    stone: paint(pal.stone, KIND.stone, 0, 0.05),
    stoneDark: paint(pal.stoneDark, KIND.stone, 0, 0.05),
    stoneLight: paint(pal.stoneLight, KIND.stone, 0, 0.04),
    masonry: paint(pal.stone, KIND.masonry, 0, 0.06),
    masonryDark: paint(pal.stoneDark, KIND.masonry, 0, 0.06),
    paper: paint(pal.paper, KIND.lattice, 0.3, 0),
    roof: {
      tile: paint(pal.roof, KIND.tile, 0, 0.05),
      under: paint(pal.timberDark, KIND.wood, 0, 0.04),
      fascia: paint(pal.lacquerDark, KIND.lacquer, 0, 0.03),
      end: paint(pal.roofDark, KIND.tileEnd, 0, 0.03),
      ridge: paint(pal.ridge, KIND.plaster, 0, 0.04),
    },
  };
}

/** round stone column foot standing on the ground (r = outer radius at the ground) */
export function plinth(b: MeshBuilder, P: Paints, r: number, h: number): void {
  lathe(b, [[r, -0.2], [r, 0.1], [r * 0.92, 0.2], [r * 0.78, 0.25], [r * 0.76, h - 0.08], [r * 0.7, h], [0, h]], 12, P.stone);
}

/** lacquered round shaft with entasis from y0 (radius r0) to y0 + h (radius r1), gold collars at both ends */
export function shaft(b: MeshBuilder, P: Paints, y0: number, h: number, r0: number, r1: number, collars = true): void {
  lathe(b, entasisProfile(r0, r1, y0, h, 4, 0.045), 12, P.lacquer, {
    shade: (p) => 0.9 + 0.1 * Math.min(1, (p[1] - y0) / (h * 0.5)),
  });
  if (collars) {
    lathe(b, [[r0 + 0.035, y0 + 0.04], [r0 + 0.035, y0 + 0.2], [r0, y0 + 0.2]], 12, P.gold);
    lathe(b, [[r1 + 0.04, y0 + h - 0.26], [r1 + 0.04, y0 + h - 0.06], [r1, y0 + h - 0.06]], 12, P.gold);
  }
}

/**
 * Bracket cluster (斗拱): square block, two stacked arms across the front and a cantilever arm through the depth.
 * Built at the origin, bottom centre; `w` = width of the widest arm, `d` = depth through which the cantilever runs.
 */
export function bracket(b: MeshBuilder, P: Paints, w: number, d: number, full = true): void {
  const unit = w / 1.5;
  box(b, 0.44 * unit, 0.22 * unit, 0.44 * unit, P.lacquerDark);
  boxAt(b, 0, 0.22 * unit, 0, 1.04 * unit, 0.2 * unit, 0.28 * unit, P.accent);
  if (!full) return;
  boxAt(b, 0, 0.42 * unit, 0, 0.3 * unit, 0.2 * unit, d, P.accent);
  boxAt(b, -0.46 * unit, 0.42 * unit, 0, 0.26 * unit, 0.18 * unit, 0.3 * unit, P.lacquerDark);
  boxAt(b, 0.46 * unit, 0.42 * unit, 0, 0.26 * unit, 0.18 * unit, 0.3 * unit, P.lacquerDark);
  boxAt(b, 0, 0.6 * unit, 0, w, 0.2 * unit, 0.28 * unit, P.accent);
}

/** name tablet: dark board with gold frame and abstract gold glyph strokes (front = +Z) */
export function tablet(b: MeshBuilder, P: Paints, w: number, h: number, glyphs = 4): void {
  const board = lit(P.timberDark, 0.7);
  box(b, w, h, 0.14, board);
  const t = 0.07;
  boxAt(b, 0, h - t, 0.01, w, t, 0.18, P.gold);
  boxAt(b, 0, 0, 0.01, w, t, 0.18, P.gold);
  boxAt(b, -(w - t) / 2, t, 0.01, t, h - 2 * t, 0.18, P.gold);
  boxAt(b, (w - t) / 2, t, 0.01, t, h - 2 * t, 0.18, P.gold);
  // glyph strokes: flat gold quads in a row, pseudo-random but deterministic
  const cell = (w - 4 * t) / glyphs;
  for (let g = 0; g < glyphs; g++) {
    const cx = -w / 2 + 2 * t + cell * (g + 0.5);
    const strokes = 3 + (g % 2);
    for (let s = 0; s < strokes; s++) {
      const horizontal = (g + s) % 2 === 0;
      const sw = horizontal ? cell * 0.7 : cell * 0.1;
      const sh = horizontal ? h * 0.07 : h * 0.5;
      const ox = horizontal ? 0 : (s - 1) * cell * 0.22;
      const oy = h * 0.5 + (horizontal ? (s - 1.5) * h * 0.2 : 0) - sh / 2;
      quadZ(b, cx + ox - sw / 2, oy, sw, sh, 0.075, P.gold);
    }
  }
}

/** straight stair flight rising towards -Z: bottom step front edge at z = 0, `steps` treads of `run` depth */
export function stairs(b: MeshBuilder, P: Paints, w: number, steps: number, rise: number, run: number, cheek = true): void {
  for (let i = 0; i < steps; i++) {
    const h = rise * (i + 1);
    boxAt(b, 0, -0.3, -run * (i + 0.5), w, h + 0.3, run, P.masonry, { bevel: 0.025, y0: 0 });
  }
  if (cheek) {
    // sloped side cheeks (垂带石)
    for (const sx of [-1, 1]) {
      b.at(sx * (w / 2 + 0.17), 0, 0);
      const x0 = -0.17;
      const x1 = 0.17;
      const total = steps * run;
      const top = steps * rise;
      b.grid(1, 1, (u, v, out) => {
        const z = -u * total;
        out[0] = x0 + (x1 - x0) * v;
        out[1] = top * u + 0.12 + 0.1 * (1 - u);
        out[2] = z;
      }, P.stoneLight, { flip: sx > 0, uv: (u, v) => [u * total, v * 0.34] });
      b.grid(1, 1, (u, v, out) => {
        const z = -u * total;
        out[0] = sx > 0 ? x1 : x0;
        out[1] = -0.3 + (top * u + 0.22 + 0.1 * (1 - u)) * v;
        out[2] = z;
      }, P.masonryDark, { flip: sx < 0, uv: (u, v) => [u * total, v * 1] });
      b.pop();
    }
  }
}

/** low balustrade along +x from x = 0 to len at the origin height: posts with caps, top rail, lattice-free panels */
export function balustrade(b: MeshBuilder, P: Paints, len: number, h: number, post = 1.6): void {
  const n = Math.max(1, Math.round(len / post));
  const step = len / n;
  for (let i = 0; i <= n; i++) {
    boxAt(b, i * step, 0, 0, 0.12, h, 0.12, P.lacquer, { bevel: 0.015 });
    boxAt(b, i * step, h, 0, 0.17, 0.08, 0.17, P.gold, { bevel: 0.015 });
  }
  boxAt(b, len / 2, h - 0.12, 0, len, 0.09, 0.09, P.lacquer, { bevel: 0.012 });
  boxAt(b, len / 2, h * 0.3, 0, len, 0.07, 0.07, P.lacquerDark, { bevel: 0.01 });
}
