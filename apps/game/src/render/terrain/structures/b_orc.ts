// Orc-camp decoration helpers shared by the set-B builders: horns, skulls, painted glyphs, stitched patches.
import { Color, Vector3 } from 'three';
import { PAL, TAU } from './b_common';
import { MAT, type MeshBuilder, V } from './b_geom';

/** A parametric surface (u,v ∈ 0..1) painted on: position (lifted off the surface) and outward normal. */
export interface Surf {
  pos(u: number, v: number, lift: number): Vector3;
  nrm(u: number, v: number): Vector3;
}

/** Curved tapering horn from the local origin. side = +1 curls toward +x, -1 toward -x; curl in radians over its length. */
export function horn(mb: MeshBuilder, o: { len?: number; r?: number; side?: 1 | -1; curl?: number; base?: number; seg?: number } = {}): void {
  const len = o.len ?? 0.4;
  const r = o.r ?? 0.04;
  const side = o.side ?? 1;
  const curl = o.curl ?? 1.8;
  const seg = o.seg ?? 7;
  const base = o.base ?? 0.5;
  const pts: Vector3[] = [];
  let x = 0;
  let y = 0;
  const step = len / seg;
  for (let i = 0; i <= seg; i++) {
    pts.push(V(x, y, 0));
    const ang = base + curl * (i / seg);
    x += side * Math.cos(ang) * step;
    y += Math.sin(ang) * step;
  }
  mb.tube(pts, (t) => r * (1 - t * 0.93), {
    radial: 4,
    cap0: 'flat',
    cap1: 'open',
    shade: (t) => 0.78 + 0.32 * t,
    wobble: (t, a) => 1 + 0.05 * Math.sin(t * 25 + a * 6),
  });
}

/** Horned beast / orc skull facing +Z, origin at the base of the jaw, ≈ 0.3 m wide at scale 1. */
export function skull(mb: MeshBuilder, o: { scale?: number; horns?: boolean; tint?: string } = {}): void {
  const sc = o.scale ?? 1;
  mb.scope(() => {
    mb.s(sc);
    mb.set({ mat: MAT.stone, color: o.tint ?? PAL.bone, color2: PAL.boneDark, blend: 0.55, ao: 0, mottle: 0.12, uvs: 0.5 });
    // cranium
    mb.scope(() => {
      mb.t(0, 0.14, -0.02);
      mb.blob(0.125, 0.12, 0.15, { seg: 7, rings: 4, lump: 0.05 });
    });
    // brow ridge + muzzle
    mb.scope(() => {
      mb.t(0, 0.17, 0.09);
      mb.box(0.24, 0.045, 0.1, { soft: 0.7 });
    });
    mb.scope(() => {
      mb.t(0, 0.065, 0.14);
      mb.box(0.13, 0.1, 0.17, { soft: 0.65 });
    });
    // eye sockets, nostrils
    mb.set({ mat: MAT.plain, color: '#120d0a', ao: 0 });
    for (const sx of [-1, 1]) {
      mb.scope(() => {
        mb.t(sx * 0.06, 0.15, 0.1);
        mb.blob(0.034, 0.036, 0.03, { seg: 6, rings: 3, lump: 0.1 });
      });
    }
    mb.scope(() => {
      mb.t(0, 0.095, 0.23);
      mb.box(0.07, 0.022, 0.02);
    });
    // teeth
    mb.set({ mat: MAT.plain, color: '#e6ddc2', ao: 0 });
    for (let i = 0; i < 3; i++) {
      mb.scope(() => {
        mb.t(-0.04 + i * 0.04, 0.02, 0.215);
        mb.box(0.016, 0.034, 0.014);
      });
    }
    if (o.horns) {
      mb.set({ mat: MAT.stone, color: PAL.boneDark, color2: PAL.bone, blend: 0.4 });
      for (const side of [1, -1] as const) {
        mb.scope(() => {
          mb.t(side * 0.1, 0.22, -0.02);
          horn(mb, { len: 0.34, r: 0.032, side, curl: 2.0, base: 0.25, seg: 6 });
        });
      }
    }
  });
}

/** stroke along (u,v) points of a surface */
export function strokeUV(mb: MeshBuilder, s: Surf, pts: ReadonlyArray<readonly [number, number]>, width: number, lift = 0.018, taper = false): void {
  mb.stroke(
    pts.map(([u, v]) => s.pos(u, v, 0)),
    pts.map(([u, v]) => s.nrm(u, v)),
    width,
    { lift, taper },
  );
}

export type GlyphKind = 'sun' | 'hand' | 'zig' | 'tally' | 'eye';

/** crude painted glyph centred at (u0,v0), half-size (du,dv) in surface parameter units */
export function glyph(mb: MeshBuilder, s: Surf, kind: GlyphKind, u0: number, v0: number, du: number, dv: number, color: Color | string, width = 0.05): void {
  const at = (x: number, y: number): [number, number] => [u0 + x * du, v0 + y * dv];
  mb.scope(() => {
    mb.set({ mat: MAT.plain, color, ao: 0, mottle: 0.1, jitter: 0.04 });
    const line = (...pts: Array<[number, number]>): void => strokeUV(mb, s, pts.map(([x, y]) => at(x, y)), width, 0.02, false);
    switch (kind) {
      case 'sun': {
        const ring: Array<[number, number]> = [];
        for (let i = 0; i <= 12; i++) ring.push([Math.cos((i / 12) * TAU) * 0.5, Math.sin((i / 12) * TAU) * 0.5]);
        line(...ring);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * TAU + 0.2;
          line([Math.cos(a) * 0.72, Math.sin(a) * 0.72], [Math.cos(a) * 1.0, Math.sin(a) * 1.0]);
        }
        break;
      }
      case 'hand': {
        const palm: Array<[number, number]> = [];
        for (let i = 0; i <= 9; i++) palm.push([Math.cos((i / 9) * TAU) * 0.38, -0.28 + Math.sin((i / 9) * TAU) * 0.34]);
        line(...palm);
        line([-0.28, 0.0], [-0.34, 0.5]);
        line([-0.09, 0.05], [-0.1, 0.78]);
        line([0.1, 0.05], [0.14, 0.82]);
        line([0.28, 0.0], [0.38, 0.58]);
        line([-0.38, -0.25], [-0.82, 0.12]);
        break;
      }
      case 'zig': {
        const z: Array<[number, number]> = [];
        for (let i = 0; i <= 8; i++) z.push([-1 + (i / 8) * 2, i % 2 === 0 ? -0.35 : 0.35]);
        line(...z);
        break;
      }
      case 'tally': {
        for (let i = 0; i < 4; i++) line([-0.6 + i * 0.35, -0.8], [-0.62 + i * 0.35, 0.8]);
        line([-0.8, 0.5], [0.7, -0.5]);
        break;
      }
      case 'eye': {
        line([-1, 0], [-0.4, 0.45], [0.4, 0.45], [1, 0]);
        line([-1, 0], [-0.4, -0.35], [0.4, -0.35], [1, 0]);
        line([-0.12, 0], [0.12, 0]);
        break;
      }
    }
  });
}

/** stitched hide patch over (u0..u1, v0..v1) */
export function patch(mb: MeshBuilder, s: Surf, u0: number, v0: number, u1: number, v1: number, color: Color | string): void {
  mb.scope(() => {
    mb.set({ color, ao: 0 });
    mb.surface(3, 3, (u, v, p) => {
      const q = s.pos(u0 + (u1 - u0) * u, v0 + (v1 - v0) * v, 0.014);
      p.x = q.x;
      p.y = q.y;
      p.z = q.z;
      const edge = Math.min(u, 1 - u, v, 1 - v);
      p.m = 0.9 + 0.2 * Math.min(1, edge * 4);
    });
    mb.set({ mat: MAT.plain, color: PAL.black, ao: 0 });
    const loop: Array<[number, number]> = [
      [u0, v0],
      [u1, v0],
      [u1, v1],
      [u0, v1],
      [u0, v0],
    ];
    const du = (u1 - u0) * 0.1;
    const dv = (v1 - v0) * 0.1;
    strokeUV(
      mb,
      s,
      loop.map(([u, v]): [number, number] => [u + (u === u0 ? du : -du), v + (v === v0 ? dv : -dv)]),
      0.012,
      0.02,
    );
  });
}

export interface BannerOpts {
  w: number;
  h: number;
  /** swallow-tail depth as a fraction of h */
  tail?: number;
  cloth: Color | string;
  trim?: Color | string;
  emblem?: GlyphKind;
  emblemColor?: Color | string;
  /** sway weight at the top edge (the free bottom edge is always 1) */
  swayTop?: number;
  /** painted torn edge: ragged bottom */
  ragged?: boolean;
}

/**
 * Hanging swallow-tail banner in the local XY plane (attached along y = 0, hangs to -h, faces +Z). The cloth and the
 * trim/emblem decals share one position-driven sway weight so they flutter together (see b_mat sway).
 */
export function banner(mb: MeshBuilder, o: BannerOpts): void {
  const tail = o.tail ?? 0.2;
  const top = o.swayTop ?? 0.05;
  const hEdge = (u: number): number => o.h * (1 - tail * (1 - Math.abs(2 * u - 1))) * (o.ragged ? 1 + 0.05 * Math.sin(u * 37) : 1);
  const surf: Surf = {
    pos: (u, v, lift) => V((u - 0.5) * o.w, -v * hEdge(u), lift + 0.03 * Math.sin(Math.PI * u) * v),
    nrm: () => V(0, 0, 1),
  };
  mb.scope(() => {
    mb.set({
      mat: MAT.cloth,
      color: o.cloth,
      color2: PAL.black,
      blend: 0.3,
      mottle: 0.16,
      jitter: 0.03,
      ao: 0,
      uvs: 0.8,
      swayFn: (_x, y) => top + (1 - top) * Math.pow(Math.min(1, Math.max(0, -y / o.h)), 1.15),
    });
    mb.surface(4, 8, (u, v, p) => {
      const q = surf.pos(u, v, 0);
      p.x = q.x;
      p.y = q.y;
      p.z = q.z;
      p.m = v < 0.06 ? 0.7 : 0.9 + 0.12 * Math.sin(u * 9 + v * 3);
      p.u = u * o.w;
      p.v = v * o.h;
    });
    mb.set({ mat: MAT.plain, color: o.trim ?? PAL.gold, mottle: 0.08 });
    const border = (pts: Array<[number, number]>, width: number): void => strokeUV(mb, surf, pts, width, 0.012);
    border(
      [
        [0.04, 0.025],
        [0.5, 0.025],
        [0.96, 0.025],
      ],
      0.07,
    );
    border(
      [
        [0.035, 0.04],
        [0.035, 0.5],
        [0.035, 0.95],
      ],
      0.045,
    );
    border(
      [
        [0.965, 0.04],
        [0.965, 0.5],
        [0.965, 0.95],
      ],
      0.045,
    );
    border(
      [
        [0.04, 0.97],
        [0.27, 0.975],
        [0.5, 0.97],
        [0.73, 0.975],
        [0.96, 0.97],
      ],
      0.045,
    );
    if (o.emblem) glyph(mb, surf, o.emblem, 0.5, 0.45, (Math.min(o.w, o.h) * 0.3) / o.w, (Math.min(o.w, o.h) * 0.3) / o.h, o.emblemColor ?? PAL.gold, 0.05);
  });
}
