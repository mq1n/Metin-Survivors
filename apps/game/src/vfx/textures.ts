// Runtime-generated VFX textures (no shipped bytes):
//  - one 2048² premultiplied-alpha atlas: top-left quadrant = 8×8 sprite sheet (128 px cells, canvas-painted),
//    other three quadrants = 4×4 flipbooks (256 px frames) baked on the GPU (fire burst, smoke puff, energy swirl)
//  - one 256² tileable noise texture (R fbm, G fbm hi-freq, B cellular, A ridged), baked on the GPU.
import {
  CanvasTexture,
  ClampToEdgeWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  NoBlending,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  RepeatWrapping,
  Color,
  Scene,
  ShaderMaterial,
  Texture,
  UnsignedByteType,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';
import { VRng } from './util';

/** sprite cell indices in the 8×8 sheet */
export const SPR = {
  glow: 0,
  glowTight: 1,
  glowRing: 2,
  disc: 3,
  spark4: 4,
  streak: 5,
  streakSoft: 6,
  flare: 7,
  ringThin: 8,
  ringThick: 9,
  ringDash: 10,
  star6: 11,
  glint: 12,
  cross: 13,
  drop: 14,
  shard: 15,
  smoke0: 16,
  smoke1: 17,
  smoke2: 18,
  smoke3: 19,
  dust0: 20,
  dust1: 21,
  cloud: 22,
  wisp: 23,
  ember0: 24,
  ember1: 25,
  snow0: 26,
  snow1: 27,
  leaf0: 28,
  leaf1: 29,
  petal: 30,
  flake: 31,
  rune0: 32,
  rune1: 33,
  rune2: 34,
  rune3: 35,
  rune4: 36,
  rune5: 37,
  rune6: 38,
  rune7: 39,
  claw0: 40,
  claw1: 41,
  claw2: 42,
  slash: 43,
  crack: 44,
  boltSeg: 45,
  splat: 46,
  burst: 47,
  flame0: 48,
  flame1: 49,
  flame2: 50,
  flame3: 51,
  flameBlob: 52,
  arc0: 53,
  arc1: 54,
  arc2: 55,
  coinGlint: 56,
  gemSparkle: 57,
  sparkle: 58,
  sunburst: 59,
  rays: 60,
  crescent: 61,
  chevron: 62,
  dot: 63,
} as const;

/** flipbook base cell ids (≥ 64): 16 frames each */
export const FB = { fire: 64, smoke: 80, swirl: 96 } as const;

export interface VfxTextures {
  atlas: Texture;
  noise: Texture;
  /** render targets backing the textures (debug read-back) */
  atlasRT: WebGLRenderTarget;
  noiseRT: WebGLRenderTarget;
  /** re-bakes GPU render targets after WebGL context restoration */
  onContextRestored(): void;
  dispose(): void;
}

const CELL = 128;

type Ctx = CanvasRenderingContext2D;

function paint(ctx: Ctx, i: number, fn: (c: Ctx) => void): void {
  ctx.save();
  ctx.translate((i % 8) * CELL, Math.floor(i / 8) * CELL);
  ctx.beginPath();
  ctx.rect(0, 0, CELL, CELL);
  ctx.clip();
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  fn(ctx);
  ctx.restore();
}

function radial(c: Ctx, stops: ReadonlyArray<readonly [number, number]>, cx = 64, cy = 64, r = 62): void {
  const g = c.createRadialGradient(cx, cy, 0, cx, cy, r);
  for (const [o, a] of stops) g.addColorStop(o, `rgba(255,255,255,${a})`);
  c.fillStyle = g;
  c.fillRect(0, 0, CELL, CELL);
}

/** Fills the cell with periodic-free value-noise modulated radial puff (ImageData). */
function noisePuff(c: Ctx, i: number, seed: number, rough: number, edge: number, hard: number, stretchX = 1, stretchY = 1): void {
  const rng = new VRng(seed);
  const gx = 9;
  const lat = new Float32Array((gx + 1) * (gx + 1));
  const lat2 = new Float32Array((gx + 1) * (gx + 1));
  for (let k = 0; k < lat.length; k++) {
    lat[k] = rng.f();
    lat2[k] = rng.f();
  }
  const vn = (a: Float32Array, x: number, y: number): number => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const i00 = (yi % gx) * (gx + 1) + (xi % gx);
    const i10 = (yi % gx) * (gx + 1) + ((xi + 1) % gx);
    const i01 = ((yi + 1) % gx) * (gx + 1) + (xi % gx);
    const i11 = ((yi + 1) % gx) * (gx + 1) + ((xi + 1) % gx);
    const a00 = a[i00] ?? 0, a10 = a[i10] ?? 0, a01 = a[i01] ?? 0, a11 = a[i11] ?? 0;
    return (a00 + (a10 - a00) * sx) * (1 - sy) + (a01 + (a11 - a01) * sx) * sy;
  };
  const img = c.createImageData(CELL, CELL);
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      const nx = (x / CELL - 0.5) * 2 / stretchX, ny = (y / CELL - 0.5) * 2 / stretchY;
      const r = Math.sqrt(nx * nx + ny * ny);
      const u = (x / CELL) * 4, v = (y / CELL) * 4;
      let n = vn(lat, u, v) * 0.55 + vn(lat2, u * 2.1 + 3, v * 2.1 + 1) * 0.3 + vn(lat, u * 4.3 + 7, v * 4.3 + 5) * 0.15;
      n = (n - 0.5) * rough + 0.5;
      let a = (1 - r / edge) + (n - 0.5) * 0.9;
      a = a < 0 ? 0 : a > 1 ? 1 : a;
      a = Math.pow(a, hard);
      const k = (y * CELL + x) * 4;
      const b = Math.round(255 * (0.78 + 0.22 * n));
      img.data[k] = b;
      img.data[k + 1] = b;
      img.data[k + 2] = b;
      img.data[k + 3] = Math.round(a * 255);
    }
  }
  const tmp = document.createElement('canvas');
  tmp.width = tmp.height = CELL;
  tmp.getContext('2d')!.putImageData(img, 0, 0);
  c.save();
  c.translate((i % 8) * CELL, Math.floor(i / 8) * CELL);
  c.drawImage(tmp, 0, 0);
  c.restore();
}

function star(c: Ctx, cx: number, cy: number, spikes: number, rOut: number, rIn: number, rot: number, rng?: VRng): void {
  c.beginPath();
  for (let k = 0; k < spikes * 2; k++) {
    const a = rot + (k * Math.PI) / spikes;
    let r = k % 2 === 0 ? rOut : rIn;
    if (rng && k % 2 === 0) r *= 0.65 + rng.f() * 0.5;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if (k === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  c.closePath();
}

function drawSprites(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  paint(ctx, SPR.glow, (c) => radial(c, [[0, 1], [0.15, 0.78], [0.35, 0.36], [0.6, 0.1], [0.82, 0.02], [1, 0]]));
  paint(ctx, SPR.glowTight, (c) => radial(c, [[0, 1], [0.08, 0.95], [0.22, 0.5], [0.45, 0.14], [0.7, 0.03], [1, 0]]));
  paint(ctx, SPR.glowRing, (c) => radial(c, [[0, 0], [0.5, 0.0], [0.66, 0.5], [0.72, 1], [0.78, 0.55], [0.92, 0.08], [1, 0]]));
  paint(ctx, SPR.disc, (c) => radial(c, [[0, 1], [0.7, 0.96], [0.86, 0.5], [1, 0]]));

  // 4-point spark: two long thin diamonds + core
  paint(ctx, SPR.spark4, (c) => {
    radial(c, [[0, 1], [0.12, 0.7], [0.3, 0.15], [0.5, 0]], 64, 64, 50);
    for (let k = 0; k < 2; k++) {
      c.save();
      c.translate(64, 64);
      c.rotate((k * Math.PI) / 2);
      const g = c.createLinearGradient(-62, 0, 62, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.45, 'rgba(255,255,255,0.9)');
      g.addColorStop(0.5, 'rgba(255,255,255,1)');
      g.addColorStop(0.55, 'rgba(255,255,255,0.9)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(-62, 0);
      c.quadraticCurveTo(-6, -4, 0, -10 + (k ? 3 : 0));
      c.quadraticCurveTo(6, -4, 62, 0);
      c.quadraticCurveTo(6, 4, 0, 10 - (k ? 3 : 0));
      c.quadraticCurveTo(-6, 4, -62, 0);
      c.fill();
      c.restore();
    }
  });

  // velocity streak: bright head on the right (+x), long fading tail to the left
  paint(ctx, SPR.streak, (c) => {
    const g = c.createLinearGradient(0, 0, CELL, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.35)');
    g.addColorStop(0.88, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, CELL, CELL);
    c.globalCompositeOperation = 'destination-in';
    const v = c.createLinearGradient(0, 0, 0, CELL);
    v.addColorStop(0, 'rgba(255,255,255,0)');
    v.addColorStop(0.3, 'rgba(255,255,255,0.35)');
    v.addColorStop(0.5, 'rgba(255,255,255,1)');
    v.addColorStop(0.7, 'rgba(255,255,255,0.35)');
    v.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = v;
    c.fillRect(0, 0, CELL, CELL);
    c.globalCompositeOperation = 'source-over';
  });
  paint(ctx, SPR.streakSoft, (c) => {
    const g = c.createLinearGradient(0, 0, CELL, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, CELL, CELL);
    c.globalCompositeOperation = 'destination-in';
    const v = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    v.addColorStop(0, 'rgba(255,255,255,1)');
    v.addColorStop(0.5, 'rgba(255,255,255,0.5)');
    v.addColorStop(1, 'rgba(255,255,255,0)');
    c.save();
    c.translate(64, 64);
    c.scale(1, 0.22);
    c.translate(-64, -64);
    c.fillStyle = v;
    c.fillRect(0, 0, CELL, CELL);
    c.restore();
    c.globalCompositeOperation = 'source-over';
  });
  paint(ctx, SPR.flare, (c) => {
    radial(c, [[0, 1], [0.1, 0.8], [0.3, 0.2], [0.55, 0]]);
    const h = c.createLinearGradient(0, 0, CELL, 0);
    h.addColorStop(0, 'rgba(255,255,255,0)');
    h.addColorStop(0.5, 'rgba(255,255,255,0.95)');
    h.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = h;
    c.fillRect(0, 62, CELL, 4);
    const v = c.createLinearGradient(0, 0, 0, CELL);
    v.addColorStop(0, 'rgba(255,255,255,0)');
    v.addColorStop(0.5, 'rgba(255,255,255,0.8)');
    v.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = v;
    c.fillRect(63, 0, 2, CELL);
  });

  paint(ctx, SPR.ringThin, (c) => radial(c, [[0, 0], [0.8, 0], [0.9, 0.9], [0.94, 1], [0.98, 0.7], [1, 0]]));
  paint(ctx, SPR.ringThick, (c) => radial(c, [[0, 0], [0.5, 0], [0.7, 0.5], [0.85, 1], [0.93, 0.6], [1, 0]]));
  paint(ctx, SPR.ringDash, (c) => {
    c.lineWidth = 5;
    for (let k = 0; k < 16; k++) {
      c.beginPath();
      c.arc(64, 64, 52, (k * Math.PI) / 8, (k * Math.PI) / 8 + 0.26);
      c.stroke();
    }
  });
  paint(ctx, SPR.star6, (c) => {
    radial(c, [[0, 0.8], [0.3, 0.2], [0.55, 0]], 64, 64, 60);
    c.fillStyle = 'rgba(255,255,255,0.95)';
    star(c, 64, 64, 6, 58, 6, -Math.PI / 2);
    c.fill();
  });
  paint(ctx, SPR.glint, (c) => {
    radial(c, [[0, 1], [0.12, 0.6], [0.3, 0.1], [0.45, 0]], 64, 64, 50);
    const mk = (len: number, wid: number, rot: number): void => {
      c.save();
      c.translate(64, 64);
      c.rotate(rot);
      const g = c.createLinearGradient(-len, 0, len, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(-len, 0);
      c.quadraticCurveTo(0, -wid, len, 0);
      c.quadraticCurveTo(0, wid, -len, 0);
      c.fill();
      c.restore();
    };
    mk(62, 5, Math.PI / 2);
    mk(40, 4, 0);
  });
  paint(ctx, SPR.cross, (c) => {
    radial(c, [[0, 0.7], [0.4, 0.15], [0.8, 0]]);
    c.fillStyle = '#fff';
    c.beginPath();
    c.roundRect(52, 14, 24, 100, 5);
    c.roundRect(14, 44, 100, 24, 5);
    c.fill();
  });
  paint(ctx, SPR.drop, (c) => {
    c.beginPath();
    c.moveTo(64, 14);
    c.bezierCurveTo(90, 52, 100, 70, 100, 82);
    c.arc(64, 82, 36, 0, Math.PI, false);
    c.bezierCurveTo(28, 70, 38, 52, 64, 14);
    c.fill();
    c.globalCompositeOperation = 'destination-out';
    radial(c, [[0, 0], [0.5, 0], [1, 0.45]], 50, 70, 60);
    c.globalCompositeOperation = 'source-over';
  });
  paint(ctx, SPR.shard, (c) => {
    const g = c.createLinearGradient(30, 100, 90, 20);
    g.addColorStop(0, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,1)');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(62, 8);
    c.lineTo(88, 96);
    c.lineTo(58, 120);
    c.lineTo(40, 80);
    c.closePath();
    c.fill();
  });

  noisePuff(ctx, SPR.smoke0, 11, 1.1, 0.95, 1.1);
  noisePuff(ctx, SPR.smoke1, 23, 1.2, 0.9, 1.0);
  noisePuff(ctx, SPR.smoke2, 37, 1.0, 1.0, 1.25);
  noisePuff(ctx, SPR.smoke3, 51, 1.3, 0.92, 0.9);
  noisePuff(ctx, SPR.dust0, 61, 1.7, 0.85, 1.4);
  noisePuff(ctx, SPR.dust1, 73, 1.9, 0.8, 1.6);
  noisePuff(ctx, SPR.cloud, 87, 1.2, 0.95, 1.1, 1.0, 0.45);

  // soul wisp: teardrop head with a curling tail (vertical, head at bottom)
  paint(ctx, SPR.wisp, (c) => {
    radial(c, [[0, 1], [0.3, 0.55], [0.7, 0.1], [1, 0]], 64, 92, 30);
    const g = c.createLinearGradient(0, 100, 0, 6);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(48, 96);
    c.bezierCurveTo(48, 60, 78, 50, 70, 6);
    c.bezierCurveTo(88, 50, 84, 70, 80, 96);
    c.closePath();
    c.fill();
  });

  const emb = (i: number, seed: number): void => {
    paint(ctx, i, (c) => {
      const rng = new VRng(seed);
      radial(c, [[0, 1], [0.15, 0.55], [0.4, 0.12], [0.7, 0]], 64, 64, 60);
      c.fillStyle = '#fff';
      star(c, 64, 64, 5, 26, 11, rng.f() * 6, rng);
      c.fill();
    });
  };
  emb(SPR.ember0, 5);
  emb(SPR.ember1, 9);

  // snowflakes: 6-fold branched crystals
  const flake = (i: number, branches: number, len: number): void => {
    paint(ctx, i, (c) => {
      c.translate(64, 64);
      c.lineWidth = 4;
      for (let k = 0; k < 6; k++) {
        c.save();
        c.rotate((k * Math.PI) / 3);
        c.beginPath();
        c.moveTo(0, 0);
        c.lineTo(0, -len);
        c.stroke();
        for (let b = 1; b <= branches; b++) {
          const y = -len * (b / (branches + 0.6));
          const w = (len * 0.42) * (1 - b / (branches + 1.4));
          c.beginPath();
          c.moveTo(0, y);
          c.lineTo(-w, y - w * 0.8);
          c.moveTo(0, y);
          c.lineTo(w, y - w * 0.8);
          c.stroke();
        }
        c.restore();
      }
      radial(c, [[0, 0.9], [0.5, 0.2], [1, 0]], 0, 0, 22);
    });
  };
  flake(SPR.snow0, 2, 50);
  flake(SPR.snow1, 3, 56);

  // leaves (grey-scale veined shapes, tinted at runtime)
  const leaf = (i: number, curl: number, fat: number): void => {
    paint(ctx, i, (c) => {
      c.translate(64, 64);
      c.rotate(-Math.PI / 4);
      const g = c.createLinearGradient(-50, 0, 50, 0);
      g.addColorStop(0, 'rgba(255,255,255,0.75)');
      g.addColorStop(0.5, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0.8)');
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(-54, 0);
      c.bezierCurveTo(-24, -fat - curl, 24, -fat + curl, 56, 4);
      c.bezierCurveTo(24, fat + curl, -24, fat - curl, -54, 0);
      c.fill();
      c.strokeStyle = 'rgba(0,0,0,0.38)';
      c.lineWidth = 2.4;
      c.beginPath();
      c.moveTo(-54, 0);
      c.quadraticCurveTo(0, curl * 0.8, 56, 4);
      c.stroke();
      c.lineWidth = 1.5;
      for (let k = -3; k <= 3; k++) {
        if (k === 0) continue;
        c.beginPath();
        c.moveTo(k * 12, k * 0.5 + 1);
        c.lineTo(k * 12 + 12, (k > 0 ? 1 : -1) * (fat * 0.8));
        c.stroke();
      }
    });
  };
  leaf(SPR.leaf0, 6, 26);
  leaf(SPR.leaf1, -8, 20);
  paint(ctx, SPR.petal, (c) => {
    c.translate(64, 64);
    const g = c.createRadialGradient(0, 20, 4, 0, 0, 52);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0.6)');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(0, 52);
    c.bezierCurveTo(-46, 20, -30, -46, 0, -52);
    c.bezierCurveTo(30, -46, 46, 20, 0, 52);
    c.fill();
  });
  paint(ctx, SPR.flake, (c) => {
    const rng = new VRng(77);
    c.beginPath();
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2;
      const r = 24 + rng.f() * 28;
      const x = 64 + Math.cos(a) * r, y = 64 + Math.sin(a) * r * 0.7;
      if (k === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.closePath();
    c.fill();
  });

  // runes: bilateral original sigils
  for (let k = 0; k < 8; k++) {
    paint(ctx, SPR.rune0 + k, (c) => {
      const rng = new VRng(1000 + k * 17);
      c.lineWidth = 6;
      c.shadowColor = 'rgba(255,255,255,0.9)';
      c.shadowBlur = 8;
      c.translate(64, 64);
      const strokes = 3 + (k % 3);
      for (let s = 0; s < strokes; s++) {
        const kind = rng.i(5);
        const y0 = rng.r(-46, 40), x0 = rng.r(4, 38), y1 = y0 + rng.r(14, 44), x1 = rng.r(2, 44);
        for (let side = -1; side <= 1; side += 2) {
          c.beginPath();
          if (kind === 0) {
            c.moveTo(side * x0, y0);
            c.lineTo(side * x1, y1);
          } else if (kind === 1) {
            c.moveTo(side * x0, y0);
            c.lineTo(side * x1, y0);
            c.lineTo(side * x1, y1);
          } else if (kind === 2) {
            c.arc(side * x0, y0 + 12, rng.r(8, 16), 0, Math.PI * 2);
          } else if (kind === 3) {
            c.moveTo(side * x0, y0);
            c.quadraticCurveTo(side * (x0 + 22), (y0 + y1) / 2, side * x1, y1);
          } else {
            c.moveTo(side * x0, y0);
            c.lineTo(side * (x0 + 14), y0 + 18);
            c.lineTo(side * x0, y0 + 36);
          }
          c.stroke();
        }
      }
      c.beginPath();
      c.moveTo(0, -54);
      c.lineTo(0, 54);
      c.stroke();
      c.lineWidth = 3;
      c.beginPath();
      c.arc(0, 0, 58, 0, Math.PI * 2);
      c.stroke();
    });
  }

  // claw rakes: three tapered diagonal slashes
  const claw = (i: number, n: number, spread: number): void => {
    paint(ctx, i, (c) => {
      for (let k = 0; k < n; k++) {
        const off = (k - (n - 1) / 2) * spread;
        c.save();
        c.translate(64 + off, 64);
        c.rotate(0.28);
        const g = c.createLinearGradient(0, -60, 0, 60);
        g.addColorStop(0, 'rgba(255,255,255,0)');
        g.addColorStop(0.25, 'rgba(255,255,255,1)');
        g.addColorStop(0.7, 'rgba(255,255,255,0.9)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g;
        c.beginPath();
        c.moveTo(0, -62);
        c.quadraticCurveTo(9 - k, -10, 2, 62);
        c.quadraticCurveTo(-4, -8, 0, -62);
        c.fill();
        c.restore();
      }
    });
  };
  claw(SPR.claw0, 3, 24);
  claw(SPR.claw1, 4, 18);
  claw(SPR.claw2, 2, 34);
  paint(ctx, SPR.slash, (c) => {
    const g = c.createLinearGradient(0, 0, CELL, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,1)');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(0, 74);
    c.quadraticCurveTo(70, 30, CELL, 56);
    c.quadraticCurveTo(70, 64, 0, 74);
    c.fill();
  });
  paint(ctx, SPR.crack, (c) => {
    const rng = new VRng(333);
    c.lineWidth = 3;
    const branch = (x: number, y: number, a: number, len: number, w: number): void => {
      c.lineWidth = w;
      c.beginPath();
      c.moveTo(x, y);
      let cx = x, cy = y;
      const steps = 7;
      for (let s = 0; s < steps; s++) {
        a += rng.s2(0.45);
        cx += Math.cos(a) * (len / steps);
        cy += Math.sin(a) * (len / steps);
        c.lineTo(cx, cy);
      }
      c.stroke();
      if (len > 26 && w > 1.2) {
        branch(cx, cy, a + rng.s2(1.0), len * 0.55, w * 0.6);
        branch(x + (cx - x) * 0.5, y + (cy - y) * 0.5, a + (rng.f() < 0.5 ? 1 : -1) * rng.r(0.5, 1.1), len * 0.4, w * 0.55);
      }
    };
    branch(64, 64, 0.2, 60, 3.4);
    branch(64, 64, 2.4, 52, 3.0);
    branch(64, 64, 4.4, 46, 2.6);
  });
  paint(ctx, SPR.boltSeg, (c) => {
    c.lineWidth = 5;
    c.shadowColor = '#fff';
    c.shadowBlur = 10;
    c.beginPath();
    c.moveTo(10, 70);
    c.lineTo(36, 54);
    c.lineTo(52, 72);
    c.lineTo(80, 50);
    c.lineTo(100, 62);
    c.lineTo(118, 44);
    c.stroke();
  });
  paint(ctx, SPR.splat, (c) => {
    const rng = new VRng(444);
    for (let k = 0; k < 9; k++) {
      const a = rng.f() * Math.PI * 2, r = rng.r(10, 44);
      const rr = rng.r(3, 11) * (1 - r / 60);
      c.beginPath();
      c.arc(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, rr, 0, Math.PI * 2);
      c.fill();
    }
    radial(c, [[0, 1], [0.3, 0.8], [0.45, 0]], 64, 64, 30);
  });
  paint(ctx, SPR.burst, (c) => {
    const rng = new VRng(555);
    radial(c, [[0, 1], [0.25, 0.7], [0.55, 0.12], [0.8, 0]]);
    c.fillStyle = 'rgba(255,255,255,0.97)';
    star(c, 64, 64, 11, 60, 9, 0.2, rng);
    c.fill();
    c.fillStyle = '#fff';
    star(c, 64, 64, 7, 30, 6, 0.5, rng);
    c.fill();
  });

  // flame tongues, upright (tip up)
  const flame = (i: number, lean: number, w: number): void => {
    paint(ctx, i, (c) => {
      const g = c.createLinearGradient(0, 124, 0, 6);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.8)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(64 - w, 120);
      c.bezierCurveTo(64 - w - 14, 80, 64 - 6 + lean, 56, 64 + lean * 1.4, 6);
      c.bezierCurveTo(64 + 8 + lean, 56, 64 + w + 14, 80, 64 + w, 120);
      c.bezierCurveTo(64 + w * 0.5, 128, 64 - w * 0.5, 128, 64 - w, 120);
      c.fill();
      c.globalCompositeOperation = 'destination-out';
      radial(c, [[0, 0], [0.6, 0], [1, 0.6]], 64, 100, 70);
      c.globalCompositeOperation = 'source-over';
    });
  };
  flame(SPR.flame0, 6, 30);
  flame(SPR.flame1, -10, 26);
  flame(SPR.flame2, 14, 34);
  flame(SPR.flame3, -4, 22);
  paint(ctx, SPR.flameBlob, (c) => radial(c, [[0, 1], [0.25, 0.85], [0.5, 0.4], [0.75, 0.1], [1, 0]], 64, 74, 56));

  // lightning arc sprites: jagged glowing bolt across the cell
  const arc = (i: number, seed: number): void => {
    paint(ctx, i, (c) => {
      const rng = new VRng(seed);
      c.shadowColor = '#fff';
      c.shadowBlur = 10;
      for (let pass = 0; pass < 2; pass++) {
        c.lineWidth = pass === 0 ? 6 : 2.4;
        c.strokeStyle = pass === 0 ? 'rgba(255,255,255,0.45)' : '#fff';
        c.beginPath();
        let x = 6, y = 64;
        c.moveTo(x, y);
        for (let s = 0; s < 9; s++) {
          x += 13;
          y = 64 + rng.s2(26) * (s === 8 ? 0.3 : 1);
          c.lineTo(x, y);
        }
        c.stroke();
      }
    });
  };
  arc(SPR.arc0, 801);
  arc(SPR.arc1, 802);
  arc(SPR.arc2, 803);

  paint(ctx, SPR.coinGlint, (c) => {
    radial(c, [[0, 1], [0.08, 0.8], [0.25, 0.2], [0.4, 0]], 64, 64, 56);
    const mk = (len: number, wid: number, rot: number): void => {
      c.save();
      c.translate(64, 64);
      c.rotate(rot);
      const g = c.createLinearGradient(-len, 0, len, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(-len, 0);
      c.quadraticCurveTo(0, -wid, len, 0);
      c.quadraticCurveTo(0, wid, -len, 0);
      c.fill();
      c.restore();
    };
    mk(62, 3.5, Math.PI / 2);
    mk(62, 3.5, 0);
    mk(30, 2.5, Math.PI / 4);
    mk(30, 2.5, -Math.PI / 4);
  });
  paint(ctx, SPR.gemSparkle, (c) => {
    radial(c, [[0, 1], [0.2, 0.5], [0.5, 0]], 64, 64, 40);
    c.fillStyle = '#fff';
    star(c, 64, 64, 4, 52, 8, Math.PI / 4);
    c.fill();
  });
  paint(ctx, SPR.sparkle, (c) => {
    radial(c, [[0, 1], [0.2, 0.4], [0.5, 0]], 64, 64, 30);
    c.fillStyle = '#fff';
    star(c, 64, 64, 4, 36, 4, 0);
    c.fill();
  });
  paint(ctx, SPR.sunburst, (c) => {
    radial(c, [[0, 1], [0.2, 0.5], [0.5, 0.1], [1, 0]]);
    for (let k = 0; k < 18; k++) {
      c.save();
      c.translate(64, 64);
      c.rotate((k / 18) * Math.PI * 2 + (k % 2) * 0.05);
      const len = k % 2 === 0 ? 62 : 40;
      const g = c.createLinearGradient(0, 0, len, 0);
      g.addColorStop(0, 'rgba(255,255,255,0.9)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(0, -2.2);
      c.lineTo(len, 0);
      c.lineTo(0, 2.2);
      c.fill();
      c.restore();
    }
  });
  paint(ctx, SPR.rays, (c) => {
    for (let k = 0; k < 7; k++) {
      c.save();
      c.translate(64, 120);
      c.rotate(-0.9 + k * 0.3);
      const g = c.createLinearGradient(0, 0, 0, -120);
      g.addColorStop(0, 'rgba(255,255,255,0.8)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(-5 - (k % 3) * 2, 0);
      c.lineTo(0, -118);
      c.lineTo(5 + (k % 3) * 2, 0);
      c.fill();
      c.restore();
    }
  });
  paint(ctx, SPR.crescent, (c) => {
    c.beginPath();
    c.arc(64, 64, 56, Math.PI * 1.1, Math.PI * 1.9, false);
    c.arc(64, 82, 52, Math.PI * 1.85, Math.PI * 1.15, true);
    c.closePath();
    const g = c.createLinearGradient(8, 0, 120, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.1)');
    g.addColorStop(0.5, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0.1)');
    c.fillStyle = g;
    c.fill();
  });
  paint(ctx, SPR.chevron, (c) => {
    c.lineWidth = 14;
    c.beginPath();
    c.moveTo(30, 90);
    c.lineTo(64, 36);
    c.lineTo(98, 90);
    c.stroke();
  });
  paint(ctx, SPR.dot, (c) => {
    c.beginPath();
    c.arc(64, 64, 20, 0, Math.PI * 2);
    c.fill();
  });
}

// ---------------------------------------------------------------------------
// GPU bake

const BAKE_VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }
`;

const NOISE_LIB = /* glsl */ `
float h31(vec3 p){ p = fract(p*0.1031); p += dot(p, p.zyx+31.32); return fract((p.x+p.y)*p.z); }
float vnoise(vec3 p){
  vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(h31(i), h31(i+vec3(1,0,0)), f.x), mix(h31(i+vec3(0,1,0)), h31(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i+vec3(0,0,1)), h31(i+vec3(1,0,1)), f.x), mix(h31(i+vec3(0,1,1)), h31(i+vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p){ float a = 0.5, s = 0.0; for(int i=0;i<5;i++){ s += a*vnoise(p); p = p*2.03 + vec3(7.1,3.7,1.3); a *= 0.5; } return s; }
`;

const COPY_FRAG = /* glsl */ `
uniform sampler2D map; varying vec2 vUv;
void main(){ gl_FragColor = texture2D(map, vUv); }
`;

// tileable noise: periodic lattice hash
const NOISE_FRAG = /* glsl */ `
varying vec2 vUv;
float hp(vec2 p, float per){ p = mod(p, per); vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float pn(vec2 p, float per){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hp(i,per), hp(i+vec2(1,0),per), f.x), mix(hp(i+vec2(0,1),per), hp(i+vec2(1,1),per), f.x), f.y);
}
float pfbm(vec2 p, float per){ float a=0.5,s=0.0; for(int i=0;i<5;i++){ s+=a*pn(p,per); p*=2.0; per*=2.0; a*=0.5; } return s; }
vec2 hp2(vec2 p, float per){ p = mod(p, per); vec3 p3 = fract(vec3(p.xyx)*vec3(0.1031,0.1030,0.0973)); p3 += dot(p3, p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }
float worley(vec2 p, float per){
  vec2 i = floor(p), f = fract(p); float d = 8.0;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){ vec2 g = vec2(float(x),float(y)); vec2 o = hp2(i+g, per); vec2 r = g + o - f; d = min(d, dot(r,r)); }
  return sqrt(d);
}
void main(){
  vec2 p = vUv;
  float a = pfbm(p*4.0, 4.0);
  float b = pfbm(p*8.0+3.0, 8.0);
  float w = 1.0 - clamp(worley(p*6.0, 6.0)*1.15, 0.0, 1.0);
  float r = 1.0 - abs(pfbm(p*4.0+1.7, 4.0)*2.0-1.0);
  gl_FragColor = vec4(a, b, w, r*r);
}
`;

// flipbook bake: type 0 fire burst, 1 smoke puff, 2 energy swirl. Output: r = heat*a, a = density (premultiplied).
const FLIP_FRAG = /* glsl */ `
varying vec2 vUv; uniform float uT; uniform float uType; uniform float uSeed;
${NOISE_LIB}
float fireDensity(vec2 p, float t, out float heat){
  float R = 0.2 + 0.62*(1.0-pow(1.0-t, 2.2));
  vec3 q = vec3(p*2.2, t*1.6 + uSeed);
  vec2 w = vec2(fbm(q), fbm(q + 11.3)) - 0.5;
  vec2 pw = p + w*(0.5 + 0.5*t);
  float r = length(pw);
  float n = fbm(vec3(pw*3.2, t*2.3 + uSeed*2.0));
  float d = (R - r)/R;
  float dens = smoothstep(-0.05, 0.45, d + (n-0.5)*1.05);
  heat = clamp(d*1.3 + (n-0.5)*0.55 - t*0.95 + 0.05, 0.0, 1.0);
  float fade = 1.0 - smoothstep(0.35, 1.0, t);
  return dens * (0.25 + 0.75*fade);
}
float smokeDensity(vec2 p, float t, out float heat, vec2 L){
  float R = 0.36 + 0.28*(1.0-pow(1.0-t, 2.0));
  vec3 q = vec3(p*1.7, t*0.55 + uSeed);
  vec2 w = vec2(fbm(q), fbm(q + 5.7)) - 0.5;
  vec2 pw = p + w*0.55;
  float r = length(pw);
  float n = fbm(vec3(pw*2.4, t*0.7 + uSeed*3.0));
  float d = (R - r)/R;
  float dens = smoothstep(0.0, 0.5, d + (n-0.5)*0.85);
  float e = 0.03;
  vec2 pw2 = p + L*e; vec2 w2 = vec2(fbm(vec3(pw2*1.7, t*0.55 + uSeed)), fbm(vec3(pw2*1.7, t*0.55 + uSeed) + 5.7)) - 0.5;
  float n2 = fbm(vec3((pw2 + w2*0.55)*2.4, t*0.7 + uSeed*3.0));
  float d2 = (R - length(pw2 + w2*0.55))/R;
  float dens2 = smoothstep(0.0, 0.5, d2 + (n2-0.5)*0.85);
  heat = clamp(0.5 + (dens2 - dens)*6.0 + (n-0.5)*0.4, 0.0, 1.0);
  return dens * (1.0 - smoothstep(0.55, 1.0, t));
}
void main(){
  vec2 p = (vUv - 0.5) * 2.0;
  float t = uT;
  float heat = 0.0, dens = 0.0;
  if (uType < 0.5) { dens = fireDensity(p, t, heat); }
  else if (uType < 1.5) { dens = smokeDensity(p, t, heat, normalize(vec2(-0.6, 0.8))); }
  else {
    float r = length(p); float a = atan(p.y, p.x);
    float front = 0.25 + 0.7*(1.0-pow(1.0-t, 2.0));
    float spiral = 0.5 + 0.5*sin(a*3.0 + r*9.0 - t*9.0);
    float n = fbm(vec3(p*2.5, t*1.2 + uSeed));
    float ring = exp(-pow((r-front)/(0.12 + 0.1*t), 2.0));
    float arms = smoothstep(0.35, 0.95, spiral) * smoothstep(front+0.12, front*0.2, r) * (0.4+0.6*n);
    float core = exp(-r*r*(5.0+10.0*t)) * (1.0-t*0.8);
    dens = clamp(ring*0.9 + arms*0.8 + core, 0.0, 1.0) * (1.0 - smoothstep(0.55, 1.0, t)) * smoothstep(1.0, 0.85, r);
    heat = clamp(core*1.2 + ring*0.7 + arms*0.35, 0.0, 1.0);
  }
  dens = clamp(dens, 0.0, 1.0);
  gl_FragColor = vec4(heat*dens, 0.0, 0.0, dens);
}
`;

function paintVfxTargets(renderer: WebGLRenderer, atlasRT: WebGLRenderTarget, noiseRT: WebGLRenderTarget): void {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1024;
  drawSprites(canvas);
  const sheet = new CanvasTexture(canvas);
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
  const prevClearColor = new Color();
  renderer.getClearColor(prevClearColor);
  const prevClearAlpha = renderer.getClearAlpha();
  renderer.autoClear = false;

  const run = (rt: WebGLRenderTarget, mat: ShaderMaterial, x: number, y: number, w: number, h: number, clear: boolean): void => {
    quad.material = mat;
    rt.viewport.set(x, y, w, h);
    rt.scissor.set(x, y, w, h);
    rt.scissorTest = true;
    renderer.setRenderTarget(rt);
    if (clear) renderer.clear(true, false, false);
    renderer.render(scene, cam);
  };

  // sprites → top-left quadrant
  const copyMat = new ShaderMaterial({ vertexShader: BAKE_VERT, fragmentShader: COPY_FRAG, uniforms: { map: { value: sheet } }, blending: NoBlending, depthTest: false, depthWrite: false });
  atlasRT.scissorTest = false;
  renderer.setRenderTarget(atlasRT);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, false, false);
  run(atlasRT, copyMat, 0, 1024, 1024, 1024, false);

  // flipbooks
  const flipMat = new ShaderMaterial({
    vertexShader: BAKE_VERT,
    fragmentShader: FLIP_FRAG,
    uniforms: { uT: { value: 0 }, uType: { value: 0 }, uSeed: { value: 0 } },
    blending: NoBlending,
    depthTest: false,
    depthWrite: false,
  });
  const origin: ReadonlyArray<readonly [number, number]> = [
    [1024, 1024], // fire: right-top (GL y from bottom)
    [0, 0], // smoke: left-bottom
    [1024, 0], // swirl: right-bottom
  ];
  for (let fb = 0; fb < 3; fb++) {
    const [ox, oy] = origin[fb] as readonly [number, number];
    flipMat.uniforms.uType!.value = fb;
    flipMat.uniforms.uSeed!.value = 1.7 + fb * 3.1;
    for (let f = 0; f < 16; f++) {
      const col = f % 4, row = Math.floor(f / 4);
      flipMat.uniforms.uT!.value = f / 15;
      run(atlasRT, flipMat, ox + col * 256, oy + (3 - row) * 256, 256, 256, false);
    }
  }
  atlasRT.scissorTest = false;
  atlasRT.viewport.set(0, 0, 2048, 2048);

  // noise
  const noiseMat = new ShaderMaterial({ vertexShader: BAKE_VERT, fragmentShader: NOISE_FRAG, blending: NoBlending, depthTest: false, depthWrite: false });
  noiseRT.scissorTest = false;
  run(noiseRT, noiseMat, 0, 0, 256, 256, true);
  noiseRT.scissorTest = false;

  // restore state; three generates mipmaps for the targets on setRenderTarget(prev)
  renderer.setRenderTarget(prevTarget);
  renderer.autoClear = prevAutoClear;
  renderer.setClearColor(prevClearColor, prevClearAlpha);

  copyMat.dispose();
  flipMat.dispose();
  noiseMat.dispose();
  quad.geometry.dispose();
  sheet.dispose();
}

export function bakeTextures(renderer: WebGLRenderer): VfxTextures {
  const atlasRT = new WebGLRenderTarget(2048, 2048, {
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
  atlasRT.texture.premultiplyAlpha = true;
  const noiseRT = new WebGLRenderTarget(256, 256, {
    format: RGBAFormat,
    type: UnsignedByteType,
    depthBuffer: false,
    generateMipmaps: true,
    minFilter: LinearMipmapLinearFilter,
    magFilter: LinearFilter,
    wrapS: RepeatWrapping,
    wrapT: RepeatWrapping,
  });

  paintVfxTargets(renderer, atlasRT, noiseRT);
  let disposed = false;

  return {
    atlas: atlasRT.texture,
    noise: noiseRT.texture,
    atlasRT,
    noiseRT,
    onContextRestored() {
      if (disposed) return;
      paintVfxTargets(renderer, atlasRT, noiseRT);
    },
    dispose() {
      disposed = true;
      atlasRT.dispose();
      noiseRT.dispose();
    },
  };
}
