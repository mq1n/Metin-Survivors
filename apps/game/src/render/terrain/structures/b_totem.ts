// Set B, orc camp: totem pole and weapon rack. Prop-local space, ground at y = 0, +Z front.
import { Color, Vector3 } from 'three';
import { PAL, TAU, rope, solidPart, vary } from './b_common';
import { MAT, MeshBuilder, V } from './b_geom';
import { banner, horn, skull } from './b_orc';
import type { StructureBuildContext, StructureModel } from './types';

interface FaceOpts {
  /** painted base colour of the carved block */
  paint: string;
  /** war-paint colour for the cheek stripes */
  stripe: string;
  tusks: boolean;
}

/** Carved orc face on a totem: block, brow, glowing eyes, nose, mouth, tusks and war paint. Faces +Z, centred at the origin. */
function orcFace(mb: MeshBuilder, o: FaceOpts): void {
  mb.scope(() => {
    mb.set({ mat: MAT.wood, color: o.paint, color2: PAL.woodDark, blend: 0.4, mottle: 0.14, uvs: 0.6, ao: 0 });
    mb.scope(() => {
      mb.t(0, 0, 0.2);
      mb.box(0.66, 0.8, 0.34, { soft: 0.4, grain: 'y' });
    });
    mb.scope(() => {
      mb.t(0, 0.22, 0.36);
      mb.box(0.62, 0.11, 0.16, { soft: 0.5 });
    });
    for (const sx of [-1, 1]) {
      mb.scope(() => {
        mb.t(sx * 0.27, -0.05, 0.34);
        mb.box(0.16, 0.2, 0.1, { soft: 0.5 });
      });
    }
    mb.set({ mat: MAT.plain, color: '#140e0a', ao: 0 });
    for (const sx of [-1, 1]) {
      mb.scope(() => {
        mb.t(sx * 0.15, 0.1, 0.375);
        mb.box(0.14, 0.085, 0.04);
      });
    }
    mb.set({ mat: MAT.glow, color: '#ff5a18', ao: 0, mottle: 0, jitter: 0 });
    for (const sx of [-1, 1]) {
      mb.scope(() => {
        mb.t(sx * 0.15, 0.1, 0.4);
        mb.box(0.065, 0.04, 0.012);
      });
    }
    mb.set({ mat: MAT.wood, color: o.paint, color2: PAL.woodDark, blend: 0.4, ao: 0 });
    mb.scope(() => {
      mb.t(0, -0.03, 0.4);
      mb.prism(
        [
          [-0.075, -0.1],
          [0.075, -0.1],
          [0, 0.13],
        ],
        0.1,
        { grain: 'y' },
      );
    });
    mb.set({ mat: MAT.plain, color: '#140e0a', ao: 0 });
    mb.scope(() => {
      mb.t(0, -0.26, 0.37);
      mb.box(0.4, 0.1, 0.06);
    });
    mb.set({ mat: MAT.stone, color: PAL.bone, color2: PAL.boneDark, blend: 0.4, ao: 0, uvs: 0.3 });
    if (o.tusks) {
      for (const sx of [-1, 1]) {
        mb.scope(() => {
          mb.t(sx * 0.15, -0.31, 0.4);
          mb.spike(0.038, 0.24, 5, { lean: [sx * -0.03, 0.05] });
        });
      }
    }
    for (let i = 0; i < 4; i++) {
      mb.scope(() => {
        mb.t(-0.12 + i * 0.08, -0.255, 0.41);
        mb.box(0.045, 0.06, 0.02);
      });
    }
    // war paint: cheek stripes and a brow slash
    mb.set({ mat: MAT.plain, color: o.stripe, ao: 0 });
    for (const sx of [-1, 1]) {
      mb.stroke([V(sx * 0.2, -0.14, 0.375), V(sx * 0.27, -0.03, 0.405), V(sx * 0.31, 0.06, 0.41)], [V(0, 0, 1), V(0, 0, 1), V(0, 0, 1)], 0.04, { lift: 0.003, taper: true });
      mb.stroke([V(sx * 0.12, -0.14, 0.375), V(sx * 0.19, -0.04, 0.395)], [V(0, 0, 1), V(0, 0, 1)], 0.03, { lift: 0.003, taper: true });
    }
    mb.stroke([V(-0.25, 0.3, 0.37), V(0, 0.33, 0.44), V(0.25, 0.3, 0.37)], [V(0, 0, 1), V(0, 0, 1), V(0, 0, 1)], 0.04, { lift: 0.003 });
  });
}

function totem(ctx: StructureBuildContext): StructureModel {
  const mb = new MeshBuilder(31);
  const rng = mb.rng;
  const H = 5.1;
  const trunkR = (y: number): number => 0.36 - 0.06 * (y / H);
  // trunk: gnarled bark log with a slight lean
  mb.set({ mat: MAT.bark, color: '#7a6048', color2: '#44352a', blend: 0.4, uvs: 0.9, ao: 0.28, aoH: 0.8, mottle: 0.12 });
  const pts: Vector3[] = [];
  for (let i = 0; i <= 8; i++) pts.push(V(Math.sin(i * 1.3) * 0.02, (i / 8) * H, Math.cos(i * 0.9) * 0.015));
  mb.tube(pts, (t) => trunkR(t * H), { radial: 8, cap0: 'flat', cap1: 'flat', wobble: (t, a) => 1 + 0.05 * Math.sin(t * 19 + a * 7) });
  // painted collars between the carved segments
  const collars: Array<[number, string]> = [
    [0.55, PAL.red],
    [2.05, PAL.black],
    [3.4, PAL.red],
    [4.7, PAL.bone],
  ];
  for (const [y, c] of collars) {
    mb.set({ mat: MAT.wood, color: c, color2: PAL.woodDark, blend: 0.3, uvs: 0.6, ao: 0, mottle: 0.1 });
    const r = trunkR(y) + 0.035;
    mb.scope(() => {
      mb.t(0, y, 0);
      mb.lathe(
        [
          [r - 0.01, 0],
          [r + 0.02, 0.03],
          [r + 0.02, 0.2],
          [r - 0.01, 0.23],
        ],
        { seg: 8 },
      );
    });
  }
  // three carved faces: ogre, skull, horned demon
  mb.scope(() => {
    mb.t(0, 1.3, 0.04).s(1.3);
    orcFace(mb, { paint: '#d2bf93', stripe: PAL.red, tusks: true });
  });
  mb.scope(() => {
    mb.t(0, 2.62, 0.2).rx(-0.08);
    skull(mb, { scale: 2.5 });
  });
  mb.scope(() => {
    mb.t(0, 4.0, 0.0).s(1.3);
    orcFace(mb, { paint: '#6a5240', stripe: PAL.bone, tusks: true });
    mb.set({ mat: MAT.stone, color: PAL.boneDark, color2: PAL.bone, blend: 0.4, ao: 0 });
    for (const side of [1, -1] as const) {
      mb.scope(() => {
        mb.t(side * 0.3, 0.38, 0.12);
        horn(mb, { len: 0.62, r: 0.06, side, curl: 2.3, base: 0.35, seg: 6 });
      });
    }
  });
  // crown: big skull with swept horns
  mb.scope(() => {
    mb.t(0, H - 0.06, 0.02).rx(-0.18);
    skull(mb, { scale: 2.2 });
  });
  mb.set({ mat: MAT.stone, color: PAL.bone, color2: PAL.boneDark, blend: 0.4, ao: 0 });
  for (const side of [1, -1] as const) {
    mb.scope(() => {
      mb.t(side * 0.22, H - 0.18, -0.05);
      horn(mb, { len: 0.95, r: 0.075, side, curl: 2.6, base: 0.2, seg: 7 });
    });
  }
  // cross arm with hanging bone charms and two streamers
  mb.set({ mat: MAT.bark, color: '#6d543e', color2: '#44352a', blend: 0.4, uvs: 0.7, ao: 0 });
  mb.pole(V(-1.0, 4.55, 0.02), V(1.0, 4.58, 0.02), 0.055, 0.045, { radial: 5, lenSeg: 3 });
  for (let i = 0; i < 4; i++) {
    const x = -0.85 + i * 0.567;
    const len = 0.35 + rng() * 0.35;
    mb.set({ mat: MAT.cloth, color: PAL.rope, color2: PAL.ropeDark, blend: 0.3, ao: 0 });
    rope(mb, [V(x, 4.56, 0.04), V(x + 0.02, 4.56 - len * 0.5, 0.05), V(x, 4.56 - len, 0.04)], 0.012);
    mb.scope(() => {
      mb.t(x, 4.56 - len - 0.06, 0.04);
      if (i % 2 === 0) {
        mb.set({ mat: MAT.stone, color: PAL.bone, color2: PAL.boneDark, blend: 0.4, ao: 0 });
        mb.blob(0.04, 0.07, 0.04, { seg: 5, rings: 3, lump: 0.15 });
      } else {
        mb.rx(-0.2);
        skull(mb, { scale: 0.5 });
      }
    });
  }
  for (const [x, c] of [
    [-1.0, PAL.red],
    [1.0, PAL.black],
  ] as Array<[number, string]>) {
    mb.scope(() => {
      mb.t(x, 4.55, 0.05);
      banner(mb, { w: 0.26, h: 1.5, tail: 0.28, cloth: new Color(c).multiplyScalar(1.25), trim: PAL.rope, swayTop: 0.1, ragged: true });
    });
  }
  // base: leaning brace logs and a ring of stones with trophy skulls
  mb.set({ mat: MAT.bark, color: '#6d543e', color2: '#44352a', blend: 0.4, uvs: 0.7, ao: 0.3, aoH: 0.6 });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + 0.5;
    mb.pole(V(Math.cos(a) * 0.85, 0, Math.sin(a) * 0.85), V(Math.cos(a) * 0.3, 1.3, Math.sin(a) * 0.3), 0.1, 0.075, { radial: 5, lenSeg: 2 });
  }
  mb.set({ mat: MAT.stone, color: PAL.stone, color2: PAL.moss, blend: 0.4, ao: 0.35, aoH: 0.3, uvs: 0.9 });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + rng() * 0.3;
    const r = 0.5 + rng() * 0.08;
    mb.scope(() => {
      mb.t(Math.cos(a) * r, 0.1, Math.sin(a) * r).ry(rng() * TAU);
      mb.set({ color: vary(PAL.stone, rng, 0.15) });
      mb.blob(0.17 + rng() * 0.07, 0.12 + rng() * 0.05, 0.16 + rng() * 0.06, { seg: 6, rings: 3, lump: 0.2, seedOffset: i });
    });
  }
  for (const [x, z, yaw] of [
    [0.1, 0.62, 0.2],
    [-0.4, 0.45, -0.5],
  ] as Array<[number, number, number]>) {
    mb.scope(() => {
      mb.t(x, 0.08, z).ry(yaw);
      skull(mb, { scale: 1.0, horns: true });
    });
  }
  return { parts: [solidPart(mb, ctx, { roughness: 0.9, doubleSided: true, sway: true, glow: 2.6, detail: [0.8, 0.8, 0.6, 0.6] })] };
}

// ---- weapon rack --------------------------------------------------------------------------------------------------

function axe(mb: MeshBuilder, len: number): void {
  mb.set({ mat: MAT.wood, color: '#7d5b3a', color2: PAL.woodDark, blend: 0.35, uvs: 0.5, ao: 0 });
  mb.pole(V(0, 0, 0), V(0, len, 0), 0.026, 0.022, { radial: 5, lenSeg: 2 });
  mb.set({ mat: MAT.plain, color: '#8f9099', color2: '#8a5a34', blend: 0.35, ao: 0, mottle: 0.2 });
  mb.scope(() => {
    mb.t(0, len - 0.12, 0);
    mb.prism(
      [
        [-0.03, -0.12],
        [0.28, -0.22],
        [0.34, 0.0],
        [0.28, 0.2],
        [-0.03, 0.12],
      ],
      0.035,
    );
  });
  mb.set({ mat: MAT.cloth, color: PAL.red, color2: PAL.redDark, blend: 0.3, ao: 0 });
  mb.scope(() => {
    mb.t(0, len - 0.3, 0);
    mb.lathe(
      [
        [0.03, 0],
        [0.042, 0.04],
        [0.03, 0.08],
      ],
      { seg: 5 },
    );
  });
}

function spear(mb: MeshBuilder, len: number): void {
  mb.set({ mat: MAT.wood, color: '#8a6842', color2: PAL.woodDark, blend: 0.35, uvs: 0.5, ao: 0 });
  mb.pole(V(0, 0, 0), V(0, len, 0), 0.022, 0.018, { radial: 5, lenSeg: 3 });
  mb.set({ mat: MAT.plain, color: '#a2a3ab', color2: '#8a5a34', blend: 0.3, ao: 0, mottle: 0.2 });
  mb.scope(() => {
    mb.t(0, len - 0.02, 0);
    mb.prism(
      [
        [-0.055, 0],
        [0.055, 0],
        [0.035, 0.18],
        [0, 0.36],
        [-0.035, 0.18],
      ],
      0.022,
      { grain: 'y' },
    );
  });
  mb.set({ mat: MAT.cloth, color: PAL.red, color2: PAL.redDark, blend: 0.3, ao: 0 });
  mb.blade(V(0.02, len - 0.04, 0), V(0.08, len - 0.34, 0.03), 0.03, 0.04, { swTip: 0.8 });
  mb.set({ mat: MAT.cloth, color: PAL.rope, color2: PAL.ropeDark, blend: 0.3, ao: 0 });
  mb.scope(() => {
    mb.t(0, len - 0.1, 0);
    mb.lathe(
      [
        [0.02, 0],
        [0.03, 0.03],
        [0.02, 0.06],
      ],
      { seg: 5 },
    );
  });
}

function weaponRack(ctx: StructureBuildContext): StructureModel {
  const mb = new MeshBuilder(32);
  const W = 1.1;
  const barkSet = (): void => {
    mb.set({ mat: MAT.bark, color: '#7a6048', color2: '#44352a', blend: 0.4, uvs: 0.7, ao: 0.3, aoH: 0.5, mottle: 0.12 });
  };
  barkSet();
  // two A-frame ends, crossbars and a lower rail
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) mb.pole(V(sx * W, 0, sz * 0.34), V(sx * (W - 0.05), 1.92, sz * 0.02), 0.075, 0.06, { radial: 5, lenSeg: 3, bend: 0.01 });
  }
  mb.pole(V(-W - 0.12, 1.78, 0), V(W + 0.12, 1.78, 0), 0.06, 0.06, { radial: 5, lenSeg: 4 });
  mb.pole(V(-W + 0.05, 0.85, -0.12), V(W - 0.05, 0.85, -0.12), 0.05, 0.05, { radial: 5, lenSeg: 4 });
  mb.pole(V(-W + 0.12, 0.42, 0.12), V(W - 0.12, 0.42, 0.12), 0.045, 0.045, { radial: 4, lenSeg: 3 });
  // rope lashings at the A-frame tops
  mb.set({ mat: MAT.cloth, color: PAL.rope, color2: PAL.ropeDark, blend: 0.3, ao: 0 });
  for (const sx of [-1, 1]) {
    mb.scope(() => {
      mb.t(sx * (W - 0.04), 1.7, 0);
      mb.lathe(
        [
          [0.095, 0],
          [0.115, 0.06],
          [0.095, 0.12],
        ],
        { seg: 6 },
      );
    });
  }
  // axes and spears leaning on the back of the rack
  const lean = (x: number, z: number, tiltX: number, tiltZ: number, build: () => void): void => {
    mb.scope(() => {
      mb.t(x, 0, z).rx(tiltX).rz(tiltZ);
      build();
    });
  };
  lean(-0.85, -0.2, -0.1, -0.05, () => axe(mb, 1.9));
  lean(-0.5, -0.22, -0.12, 0.03, () => axe(mb, 1.75));
  lean(-0.15, -0.2, -0.09, -0.02, () => axe(mb, 1.85));
  lean(0.3, -0.22, -0.1, 0.02, () => spear(mb, 2.15));
  lean(0.6, -0.2, -0.13, -0.03, () => spear(mb, 2.05));
  lean(0.88, -0.21, -0.1, 0.02, () => spear(mb, 2.2));
  // round shield on the front, boss + red/black paint
  mb.scope(() => {
    mb.t(-0.45, 1.05, 0.34).rx(Math.PI / 2 - 0.12);
    mb.set({ mat: MAT.wood, color: '#6f4f31', color2: PAL.woodDark, blend: 0.35, uvs: 0.6, ao: 0 });
    mb.lathe(
      [
        [0.0, 0.05],
        [0.12, 0.055],
        [0.3, 0.015],
        [0.32, -0.01],
        [0.3, -0.035],
        [0.0, -0.035],
      ],
      { seg: 12, crease: 1.2 },
    );
    mb.set({ mat: MAT.plain, color: PAL.red, ao: 0 });
    mb.stroke([V(-0.25, 0.062, -0.25), V(0, 0.062, 0), V(0.25, 0.062, 0.25)], [V(0, 1, 0), V(0, 1, 0), V(0, 1, 0)], 0.07, { lift: 0 });
    mb.stroke([V(0.25, 0.062, -0.25), V(0, 0.062, 0), V(-0.25, 0.062, 0.25)], [V(0, 1, 0), V(0, 1, 0), V(0, 1, 0)], 0.07, { lift: 0 });
    mb.set({ mat: MAT.plain, color: '#4b4a50', ao: 0 });
    mb.scope(() => {
      mb.t(0, 0.05, 0);
      mb.lathe(
        [
          [0.1, 0],
          [0.09, 0.03],
          [0.045, 0.07],
          [0, 0.08],
        ],
        { seg: 8 },
      );
    });
  });
  // spiked club leaning in front
  mb.scope(() => {
    mb.t(0.35, 0, 0.3).rx(0.12).rz(-0.1);
    mb.set({ mat: MAT.wood, color: '#6c4b2e', color2: PAL.woodDark, blend: 0.35, uvs: 0.5, ao: 0 });
    mb.tube([V(0, 0, 0), V(0, 0.6, 0), V(0, 1.1, 0)], (t) => 0.025 + 0.07 * t * t, { radial: 6, cap0: 'flat', cap1: 'flat', wobble: (t, a) => 1 + 0.08 * Math.sin(a * 9 + t * 4) });
    mb.set({ mat: MAT.plain, color: '#4b4a50', ao: 0 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      mb.scope(() => {
        mb.t(Math.cos(a) * 0.075, 0.95 + (i % 2) * 0.1, Math.sin(a) * 0.075).rz(-Math.cos(a) * 1.2).rx(Math.sin(a) * 1.2);
        mb.spike(0.018, 0.075, 4);
      });
    }
  });
  // skull trophy and a red cloth on the top bar
  mb.scope(() => {
    mb.t(0.0, 1.84, 0.05).rx(-0.12);
    skull(mb, { scale: 1.2, horns: true });
  });
  mb.scope(() => {
    mb.t(-0.7, 1.76, 0.06);
    banner(mb, { w: 0.34, h: 0.9, tail: 0.3, cloth: new Color(PAL.red).multiplyScalar(1.25), trim: PAL.rope, swayTop: 0.1, ragged: true });
  });
  return { parts: [solidPart(mb, ctx, { roughness: 0.9, doubleSided: true, sway: true, detail: [0.8, 0.8, 0.6, 0.6] })] };
}

export const TOTEM_DEFS = {
  totem: { build: totem, textures: ['tex_wood_plank', 'tex_bark_oak', 'tex_rock_mossy'] },
  weapon_rack: { build: weaponRack, textures: ['tex_wood_plank', 'tex_bark_oak'] },
};
