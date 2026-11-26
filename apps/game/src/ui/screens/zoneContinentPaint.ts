// Zone select atlas painter (B4 zone-select, round 3): paints ONE canvas = ONE continent, like the single shadowed relief landmass of the
// original world map. Layers, bottom to top:
//   sea (deep teal, soft light patches, wave strokes, two chart-style water-line contours round the coast) and the soft drop shadow
//   the land: ONE painted relief (uk_zone_select_relief, brown heightfield with dark vein lines) under the whole coast; on top of it the
//             live ZoneMap of every zone as DETAIL only (a high-pass of its luminance, so rivers, roads, forests and cliffs show but the
//             zone's own colours never do) and a faint tone lift, then a muted zone tint that fades smoothly across the borders
//   locked zones: desaturated, darkened and buried under drifting fog that creeps over the border
//   hand-inked frontier lines (smoothed, dash-dot, with a pale lip) between the zones, a crisp inked coast with a sand lip and cliff shading
// Pure canvas 2D, no DOM besides the canvases it makes; the maps come from the shared ZoneMap loader cache.
import type { ZoneMapAsset } from '../components/zoneMapLoader';
import type { Continent, Pt } from './zoneContinent';
import { mulberry32 } from './zoneContinent';

export interface PaintRegion {
  asset: ZoneMapAsset | null;
  locked: boolean;
  /** muted zone colour, '#rrggbb' */
  tint: string;
  /** -0.2 .. 0.2: lighten (snow) or darken the zone a little */
  lift: number;
}

/** muted tint + tone lift per campaign zone (value-matched, so the four read as ONE land, not as four tiles) */
export const ZONE_TINT: Record<string, { tint: string; lift: number }> = {
  yeonmu: { tint: '#7f8a4c', lift: 0 },
  suryeon: { tint: '#b27a46', lift: 0.02 },
  seori: { tint: '#8497a8', lift: 0.1 },
  daeryeol: { tint: '#6c5a72', lift: -0.06 },
};
const FALLBACK_TINTS: readonly string[] = ['#7f8a4c', '#b27a46', '#8497a8', '#6c5a72', '#a0904e', '#6a8f86'];
export const tintOfZone = (id: string, order: number): { tint: string; lift: number } => ZONE_TINT[id] ?? { tint: FALLBACK_TINTS[Math.max(0, order - 1) % FALLBACK_TINTS.length] ?? '#8a7a5a', lift: 0 };

interface Processed {
  /** neutral-grey high-pass of the map luminance (128 = no change), soft round mask: drawn with 'overlay' */
  detail: HTMLCanvasElement;
  /** the blurred luminance of the map (low frequencies), soft round mask: drawn with 'soft-light' */
  tone: HTMLCanvasElement;
}
const processed = new WeakMap<ZoneMapAsset, Processed>();

function mk(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function roundMask(c: HTMLCanvasElement, from: number, to: number): void {
  const S = c.width;
  const x = c.getContext('2d');
  if (!x) return;
  x.globalCompositeOperation = 'destination-in';
  const g = x.createRadialGradient(S / 2, S / 2, S * from, S / 2, S / 2, S * to);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(0.7, 'rgba(0,0,0,0.85)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
}

function processOf(asset: ZoneMapAsset): Processed {
  const hit = processed.get(asset);
  if (hit) return hit;
  const S = Math.min(asset.canvas.width, 512);
  const src = mk(S, S);
  const sc = src.getContext('2d', { willReadFrequently: true });
  const detail = mk(S, S);
  const tone = mk(S, S);
  if (sc) {
    sc.imageSmoothingQuality = 'high';
    sc.drawImage(asset.canvas, 0, 0, S, S);
    try {
      const px = sc.getImageData(0, 0, S, S).data;
      const n = S * S;
      const L = new Float32Array(n);
      const voidAt = new Uint8Array(n);
      let sum = 0;
      let cnt = 0;
      for (let i = 0; i < n; i++) {
        const r = px[i * 4] ?? 0;
        const g = px[i * 4 + 1] ?? 0;
        const b = px[i * 4 + 2] ?? 0;
        const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        L[i] = l;
        if (r + g + b < 24) voidAt[i] = 1;
        else {
          sum += l;
          cnt++;
        }
      }
      const mean = cnt > 0 ? sum / cnt : 0.4;
      // the black void outside the playable area becomes the mean luminance, so it neither darkens nor makes a ring
      const flat = mk(S, S);
      const fc = flat.getContext('2d');
      const fi = fc?.createImageData(S, S);
      if (fc && fi) {
        for (let i = 0; i < n; i++) {
          const v = Math.round((voidAt[i] ? mean : (L[i] as number)) * 255);
          fi.data[i * 4] = v;
          fi.data[i * 4 + 1] = v;
          fi.data[i * 4 + 2] = v;
          fi.data[i * 4 + 3] = 255;
          L[i] = v / 255;
        }
        fc.putImageData(fi, 0, 0);
        // low frequencies: shrink then stretch back (bilinear)
        const small = mk(28, 28);
        const smc = small.getContext('2d');
        const tc = tone.getContext('2d');
        if (smc && tc) {
          smc.imageSmoothingQuality = 'high';
          smc.drawImage(flat, 0, 0, 28, 28);
          tc.imageSmoothingEnabled = true;
          tc.imageSmoothingQuality = 'high';
          tc.drawImage(small, 0, 0, S, S);
          const lb = tc.getImageData(0, 0, S, S).data;
          const dc = detail.getContext('2d');
          const di = dc?.createImageData(S, S);
          if (dc && di) {
            for (let i = 0; i < n; i++) {
              const d = (L[i] as number) - (lb[i * 4] ?? 128) / 255;
              const v = Math.max(0, Math.min(255, Math.round(128 + d * 255 * 2.6)));
              di.data[i * 4] = v;
              di.data[i * 4 + 1] = v;
              di.data[i * 4 + 2] = v;
              di.data[i * 4 + 3] = 255;
            }
            dc.putImageData(di, 0, 0);
          }
        }
      }
    } catch {
      // tainted / unreadable canvas: use the picture as it is (overlay of the plain map)
      const dc = detail.getContext('2d');
      dc?.drawImage(asset.canvas, 0, 0, S, S);
    }
  }
  roundMask(detail, 0.34, 0.5);
  roundMask(tone, 0.3, 0.5);
  const out = { detail, tone };
  processed.set(asset, out);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// the relief picture (async) + the fog clouds (procedural, cached)

const reliefCache = new Map<string, Promise<HTMLImageElement | null>>();
export function loadRelief(url: string | null): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  let p = reliefCache.get(url);
  if (!p) {
    p = new Promise((res) => {
      const im = new Image();
      im.decoding = 'async';
      im.onload = () => res(im);
      im.onerror = () => res(null);
      im.src = url;
    });
    reliefCache.set(url, p);
  }
  return p;
}

let cloudCv: HTMLCanvasElement | null = null;
function clouds(): HTMLCanvasElement {
  if (cloudCv) return cloudCv;
  const S = 192;
  const c = mk(S, S);
  const x = c.getContext('2d');
  if (!x) return c;
  const rnd = mulberry32(4242);
  const G = 12;
  const grid: number[][] = [];
  for (let i = 0; i <= G; i++) {
    grid.push([]);
    for (let j = 0; j <= G; j++) (grid[i] as number[]).push(rnd());
  }
  const sm = (t: number): number => t * t * (3 - 2 * t);
  const noise = (u: number, v: number, f: number): number => {
    const fu = u * f;
    const fv = v * f;
    const i = Math.floor(fu) % G;
    const j = Math.floor(fv) % G;
    const a = sm(fu - Math.floor(fu));
    const b = sm(fv - Math.floor(fv));
    const g = (ii: number, jj: number): number => (grid[ii % G] as number[])[jj % G] as number;
    const top = g(i, j) * (1 - a) + g(i + 1, j) * a;
    const bot = g(i, j + 1) * (1 - a) + g(i + 1, j + 1) * a;
    return top * (1 - b) + bot * b;
  };
  const im = x.createImageData(S, S);
  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      const u = px / S;
      const v = py / S;
      const val = noise(u, v, 2) * 0.5 + noise(u, v, 4.3) * 0.3 + noise(u, v, 8.9) * 0.2;
      const a = Math.max(0, Math.min(1, (val - 0.4) * 2.6));
      const k = (py * S + px) * 4;
      im.data[k] = 205;
      im.data[k + 1] = 214;
      im.data[k + 2] = 220;
      im.data[k + 3] = Math.round(Math.pow(a, 1.25) * 215);
    }
  }
  x.putImageData(im, 0, 0);
  cloudCv = c;
  return c;
}

// ---------------------------------------------------------------------------------------------------------------------

function tracePath(ctx: CanvasRenderingContext2D, pts: readonly Pt[], close = true): void {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  if (close) ctx.closePath();
}

/** a hand-drawn looking path: quadratic curves through the midpoints of the polyline */
function smoothPath(ctx: CanvasRenderingContext2D, pts: readonly Pt[]): void {
  ctx.beginPath();
  const first = pts[0];
  if (!first) return;
  ctx.moveTo(first.x, first.y);
  if (pts.length < 3) {
    for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
    return;
  }
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i] as Pt;
    const q = pts[i + 1] as Pt;
    ctx.quadraticCurveTo(p.x, p.y, (p.x + q.x) / 2, (p.y + q.y) / 2);
  }
  const last = pts[pts.length - 1] as Pt;
  ctx.lineTo(last.x, last.y);
}

const rgba = (hex: string, a: number): string => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

export function paintContinent(cv: HTMLCanvasElement, cont: Continent, regs: readonly PaintRegion[], dpr: number, relief: CanvasImageSource | null): void {
  const W = Math.max(1, Math.round(cont.w * dpr));
  const H = Math.max(1, Math.round(cont.h * dpr));
  if (cv.width !== W || cv.height !== H) {
    cv.width = W;
    cv.height = H;
  }
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cont.w, cont.h);
  const u = Math.max(0.75, Math.min(1.3, Math.min(cont.w, cont.h) / 760));

  // ---- sea ----------------------------------------------------------------------------------------------------------------
  const sea = ctx.createLinearGradient(0, 0, cont.w * 0.5, cont.h);
  sea.addColorStop(0, '#1e3438');
  sea.addColorStop(0.5, '#142428');
  sea.addColorStop(1, '#0b1316');
  ctx.fillStyle = sea;
  ctx.fillRect(0, 0, cont.w, cont.h);
  const wr = mulberry32(77);
  for (let i = 0; i < 6; i++) {
    const x = wr() * cont.w;
    const y = wr() * cont.h;
    const r = (0.25 + wr() * 0.3) * Math.max(cont.w, cont.h);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, i % 2 ? 'rgba(70,112,120,0.16)' : 'rgba(10,18,22,0.34)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cont.w, cont.h);
  }
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(160,200,206,0.11)';
  ctx.lineWidth = 1 * u;
  for (let i = 0; i < 90; i++) {
    const x = wr() * cont.w;
    const y = wr() * cont.h;
    const l = (10 + wr() * 24) * u;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + l * 0.5, y - 2.6 * u, x + l, y);
    ctx.stroke();
  }
  // chart-style water-line contours round the coast: two thin pale rings (a wide stroke with a narrower one punched out)
  const ring = mk(W, H);
  const rc = ring.getContext('2d');
  if (rc) {
    rc.setTransform(dpr, 0, 0, dpr, 0, 0);
    rc.lineJoin = 'round';
    for (const [d, a] of [
      [10, 0.42],
      [22, 0.22],
    ] as const) {
      rc.globalCompositeOperation = 'source-over';
      rc.strokeStyle = `rgba(176,214,218,${a})`;
      rc.lineWidth = 2 * d * u + 1.3;
      tracePath(rc, cont.coast);
      rc.stroke();
      rc.globalCompositeOperation = 'destination-out';
      rc.lineWidth = 2 * d * u - 1.3;
      rc.strokeStyle = '#000';
      tracePath(rc, cont.coast);
      rc.stroke();
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(ring, 0, 0);
    ctx.restore();
  }

  // shallows: a pale teal glow in the water round the whole coast
  ctx.save();
  ctx.shadowColor = 'rgba(118,184,190,0.55)';
  ctx.shadowBlur = 40 * u * dpr;
  ctx.fillStyle = '#0b1316';
  tracePath(ctx, cont.coast);
  ctx.fill();
  ctx.restore();
  // ---- drop shadow + shallows of the landmass ---------------------------------------------------------------------------
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.85)';
  ctx.shadowBlur = 26 * u * dpr;
  ctx.shadowOffsetY = 9 * u * dpr;
  ctx.fillStyle = '#000';
  tracePath(ctx, cont.coast);
  ctx.fill();
  ctx.restore();
  ctx.lineJoin = 'round';
  for (const [lw, a] of [
    [16, 0.07],
    [10, 0.1],
    [5, 0.15],
  ] as const) {
    ctx.strokeStyle = `rgba(132,176,182,${a})`;
    ctx.lineWidth = lw * u;
    tracePath(ctx, cont.coast);
    ctx.stroke();
  }

  // ---- the land: one relief ---------------------------------------------------------------------------------------------------
  ctx.save();
  tracePath(ctx, cont.coast);
  ctx.clip();
  ctx.fillStyle = '#3b2e1f';
  ctx.fillRect(0, 0, cont.w, cont.h);
  if (relief) {
    const rw = (relief as { width?: number }).width ?? 1024;
    const rh = (relief as { height?: number }).height ?? 1024;
    const k = Math.max(cont.w / rw, cont.h / rh) * 1.12;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(relief, (cont.w - rw * k) / 2, (cont.h - rh * k) / 2, rw * k, rh * k);
  } else {
    // no relief picture yet: quiet earthen gradient
    const g = ctx.createRadialGradient(cont.w * 0.5, cont.h * 0.45, 0, cont.w * 0.5, cont.h * 0.5, Math.max(cont.w, cont.h) * 0.7);
    g.addColorStop(0, '#5a4730');
    g.addColorStop(1, '#2a2116');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cont.w, cont.h);
  }
  // soften the picture's own contrast a little, so the zone detail and the inked borders lead
  ctx.fillStyle = 'rgba(70,52,32,0.22)';
  ctx.fillRect(0, 0, cont.w, cont.h);

  cont.regions.forEach((reg, i) => {
    const pr = regs[i];
    if (!pr?.asset) return;
    const pc = processOf(pr.asset);
    const box = { x: reg.map.cx - reg.map.sx / 2, y: reg.map.cy - reg.map.sy / 2, w: reg.map.sx, h: reg.map.sy };
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = 0.55;
    ctx.drawImage(pc.tone, box.x, box.y, box.w, box.h);
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.85;
    ctx.drawImage(pc.detail, box.x, box.y, box.w, box.h);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  });

  // muted zone tints, feathered across the borders (a 'color' blend keeps the relief's light and shade)
  cont.regions.forEach((reg, i) => {
    const pr = regs[i];
    if (!pr) return;
    const r = Math.max(reg.bbox.w, reg.bbox.h) * 0.78;
    const g = ctx.createRadialGradient(reg.centroid.x, reg.centroid.y, 0, reg.centroid.x, reg.centroid.y, r);
    g.addColorStop(0, rgba(pr.tint, 0.62));
    g.addColorStop(0.55, rgba(pr.tint, 0.4));
    g.addColorStop(1, rgba(pr.tint, 0));
    ctx.globalCompositeOperation = 'color';
    ctx.fillStyle = g;
    ctx.fillRect(reg.bbox.x - r, reg.bbox.y - r, reg.bbox.w + 2 * r, reg.bbox.h + 2 * r);
    ctx.globalCompositeOperation = pr.lift >= 0 ? 'screen' : 'multiply';
    const lg = ctx.createRadialGradient(reg.centroid.x, reg.centroid.y, 0, reg.centroid.x, reg.centroid.y, r);
    const la = Math.abs(pr.lift);
    const dk = Math.round(255 * (1 - la * 1.8));
    lg.addColorStop(0, pr.lift >= 0 ? `rgba(214,224,236,${la})` : `rgb(${dk},${dk},${Math.min(255, dk + 8)})`);
    lg.addColorStop(1, pr.lift >= 0 ? 'rgba(214,224,236,0)' : 'rgb(255,255,255)');
    ctx.fillStyle = lg;
    ctx.fillRect(reg.bbox.x - r, reg.bbox.y - r, reg.bbox.w + 2 * r, reg.bbox.h + 2 * r);
    ctx.globalCompositeOperation = 'source-over';
  });

  // warm unifying wash + vignette
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = '#ead6ac';
  ctx.fillRect(0, 0, cont.w, cont.h);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  const vg = ctx.createRadialGradient(cont.w / 2, cont.h / 2, Math.min(cont.w, cont.h) * 0.3, cont.w / 2, cont.h / 2, Math.max(cont.w, cont.h) * 0.74);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.34)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, cont.w, cont.h);

  // ---- locked zones: desaturated, dim, fogged --------------------------------------------------------------------------------
  cont.regions.forEach((reg, i) => {
    if (!regs[i]?.locked) return;
    ctx.save();
    tracePath(ctx, reg.poly);
    ctx.clip();
    ctx.globalCompositeOperation = 'saturation';
    ctx.fillStyle = 'rgb(128,128,128)';
    ctx.globalAlpha = 0.92;
    ctx.fillRect(reg.bbox.x - 4, reg.bbox.y - 4, reg.bbox.w + 8, reg.bbox.h + 8);
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = '#676665';
    ctx.fillRect(reg.bbox.x - 4, reg.bbox.y - 4, reg.bbox.w + 8, reg.bbox.h + 8);
    ctx.restore();
  });
  cont.regions.forEach((reg, i) => {
    if (!regs[i]?.locked) return;
    const cl = clouds();
    const rr = mulberry32(900 + i * 31);
    ctx.save();
    tracePath(ctx, reg.poly);
    ctx.clip();
    // drifting fog banks inside the region: the terrain under it stays readable, only veiled
    const big = Math.max(reg.bbox.w, reg.bbox.h);
    for (let k = 0; k < 3; k++) {
      const cx = reg.centroid.x + (rr() - 0.5) * reg.bbox.w * 0.7;
      const cy = reg.centroid.y + (rr() - 0.5) * reg.bbox.h * 0.7;
      const s = big * (0.95 + rr() * 0.35);
      ctx.save();
      ctx.globalAlpha = [0.3, 0.22, 0.17][k] ?? 0.17;
      ctx.translate(cx, cy);
      ctx.rotate(rr() * Math.PI);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(cl, -s / 2, -s / 2, s, s);
      ctx.restore();
    }
    // the haze thickens toward the middle of the region and thins at its edge
    const fg = ctx.createRadialGradient(reg.centroid.x, reg.centroid.y, 0, reg.centroid.x, reg.centroid.y, big * 0.7);
    fg.addColorStop(0, 'rgba(150,164,176,0.14)');
    fg.addColorStop(1, 'rgba(90,104,116,0)');
    ctx.fillStyle = fg;
    ctx.fillRect(reg.bbox.x - 4, reg.bbox.y - 4, reg.bbox.w + 8, reg.bbox.h + 8);
    ctx.restore();
  });

  // shadowed relief along the coast and every border (cliff light from the upper left)
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const [lw, a] of [
    [30, 0.07],
    [18, 0.1],
    [9, 0.16],
  ] as const) {
    ctx.strokeStyle = `rgba(0,0,0,${a})`;
    ctx.lineWidth = lw * u;
    tracePath(ctx, cont.coast);
    ctx.stroke();
    for (const b of cont.borders) {
      smoothPath(ctx, b);
      ctx.stroke();
    }
  }
  ctx.restore();

  // ---- hand-inked frontiers ------------------------------------------------------------------------------------------------------
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const b of cont.borders) {
    // a pale lip below-right (paper catching the light), a soft shadow, then the ink: a long dash and a dot, hand-wobbled
    ctx.save();
    ctx.translate(1.2 * u, 1.3 * u);
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(238,218,170,0.3)';
    ctx.lineWidth = 1.2 * u;
    smoothPath(ctx, b);
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = 'rgba(14,8,4,0.26)';
    ctx.lineWidth = 5.2 * u;
    smoothPath(ctx, b);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(22,12,5,0.96)';
    ctx.lineWidth = 2.6 * u;
    ctx.setLineDash([13 * u, 4 * u, 2 * u, 4 * u]);
    smoothPath(ctx, b);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(28,16,8,0.55)';
    ctx.lineWidth = 1 * u;
    smoothPath(ctx, b);
    ctx.stroke();
  }
  // coast: an inked outline with a sand lip on the lit side
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(8,5,3,0.96)';
  ctx.lineWidth = 3 * u;
  tracePath(ctx, cont.coast);
  ctx.stroke();
  ctx.save();
  ctx.translate(-0.7 * u, -0.7 * u);
  ctx.strokeStyle = 'rgba(214,192,146,0.5)';
  ctx.lineWidth = 1.1 * u;
  tracePath(ctx, cont.coast);
  ctx.stroke();
  ctx.restore();
}
