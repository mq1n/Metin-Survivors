// Zone select atlas geometry (B4 zone-select, round 2): ONE continuous landmass cut into the campaign's regions.
//   layoutContinent({ w, h, n, … })  -> the coast, the shared border polylines and one polygon per zone (serpentine order, so
//                                       every consecutive pair of zones shares a border and the road crosses it at a gate)
//   placeRegion(…)                   -> where the name plate, the banner pin and the map markers go inside a region, always
//                                       with a fixed gutter to every border (so two plates can never touch or overlap)
// Everything here is pure (no DOM): the painter (zoneContinentPaint.ts) and the component (ZoneAtlas.tsx) read the result.
// The landmass is a 2-column lattice of nodes joined by jagged edges (fractal midpoint displacement, seeded): an edge between two
// cells is ONE polyline shared by both polygons, so the regions tile without a gap or an overlap, like the empire map of the
// original (one shadowed relief landmass, dark ridge lines between the realms).

export interface Pt {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function mulberry32(a: number): () => number {
  let s = a >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Raster box of a zone map in px: the map is drawn centred on (cx, cy), sx x sy px big (the raster is square, the box may stretch a little). */
export interface MapBox {
  cx: number;
  cy: number;
  sx: number;
  sy: number;
}

export interface ContRegion {
  index: number;
  poly: Pt[];
  bbox: Rect;
  centroid: Pt;
  map: MapBox;
  /** keys of the lattice edges on this polygon's loop (used to find the gate to the next region) */
  edges: string[];
}

export interface ContGate {
  /** region indices (a, a + 1) */
  a: number;
  b: number;
  at: Pt;
  /** unit tangent of the border at the gate */
  tangent: Pt;
  /** the shared border polyline the gate sits on */
  line: Pt[];
}

export interface Continent {
  w: number;
  h: number;
  regions: ContRegion[];
  /** the closed coast loop */
  coast: Pt[];
  /** inner border polylines (each one shared by two regions) */
  borders: Pt[][];
  gates: ContGate[];
}

export interface ContinentOpts {
  w: number;
  h: number;
  /** number of zones */
  n: number;
  seed?: number;
  /** phone sizes: smaller sea margin, calmer coast */
  compact?: boolean;
}

const COLS = 2;

/** midpoint displacement between p and q (both included); `inward` (-1, 0, 1) leans the bumps toward one side of the line */
function jag(p: Pt, q: Pt, depth: number, amp: number, rnd: () => number, inward = 0): Pt[] {
  if (depth <= 0) return [p, q];
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const len = Math.hypot(dx, dy) || 1;
  const off = ((rnd() * 2 - 1) * 0.8 + inward * 0.5) * amp * len;
  const m: Pt = { x: (p.x + q.x) / 2 - (dy / len) * off, y: (p.y + q.y) / 2 + (dx / len) * off };
  const a = jag(p, m, depth - 1, amp * 0.6, rnd, inward * 0.6);
  const b = jag(m, q, depth - 1, amp * 0.6, rnd, inward * 0.6);
  return [...a.slice(0, -1), ...b];
}

export function polyArea(poly: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    if (p && q) a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function polyCentroid(poly: readonly Pt[]): Pt {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    if (!p || !q) continue;
    const f = p.x * q.y - q.x * p.y;
    a += f;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  if (Math.abs(a) < 1e-6) return poly[0] ?? { x: 0, y: 0 };
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

export function bboxOf(poly: readonly Pt[]): Rect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of poly) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function pointInPoly(p: Pt, poly: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (!a || !b) continue;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** the horizontal interval of the polygon that holds `near`, at scanline y (null when the line misses the polygon) */
function spanAt(poly: readonly Pt[], y: number, near: number): [number, number] | null {
  const xs: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (!a || !b || a.y === b.y) continue;
    if (a.y > y !== b.y > y) xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
  }
  xs.sort((m, k) => m - k);
  let best: [number, number] | null = null;
  let bestD = Infinity;
  for (let i = 0; i + 1 < xs.length; i += 2) {
    const l = xs[i] as number;
    const r = xs[i + 1] as number;
    const d = near >= l && near <= r ? 0 : Math.min(Math.abs(near - l), Math.abs(near - r));
    if (d < bestD) {
      bestD = d;
      best = [l, r];
    }
  }
  return best;
}

/** the x interval that is inside the polygon on EVERY scanline of the band [y0, y1] (null if there is none) */
export function bandSpan(poly: readonly Pt[], y0: number, y1: number, near: number): [number, number] | null {
  let l = -Infinity;
  let r = Infinity;
  const steps = 6;
  for (let i = 0; i <= steps; i++) {
    const s = spanAt(poly, y0 + ((y1 - y0) * i) / steps, near);
    if (!s) return null;
    l = Math.max(l, s[0]);
    r = Math.min(r, s[1]);
  }
  return r > l ? [l, r] : null;
}

const nodeId = (r: number, c: number): number => r * (COLS + 1) + c;
const edgeKey = (a: number, b: number): string => (a < b ? `${a}-${b}` : `${b}-${a}`);

/** The lattice boundary loop of cell `index` in serpentine order (zone 0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left, ...). */
function cellLoop(index: number, n: number): number[] {
  const row = Math.floor(index / COLS);
  const alone = n % COLS === 1 && index === n - 1;
  if (alone) return [nodeId(row, 0), nodeId(row, 1), nodeId(row, 2), nodeId(row + 1, 2), nodeId(row + 1, 1), nodeId(row + 1, 0)];
  const pos = index % COLS;
  const col = row % 2 === 0 ? pos : COLS - 1 - pos;
  return [nodeId(row, col), nodeId(row, col + 1), nodeId(row + 1, col + 1), nodeId(row + 1, col)];
}

export function layoutContinent(o: ContinentOpts): Continent {
  const { w, h } = o;
  const n = Math.max(1, o.n);
  const rows = Math.ceil(n / COLS);
  const rnd = mulberry32((o.seed ?? 0x5a17) >>> 0);
  const compact = o.compact === true;
  const m = Math.round(Math.min(w, h) * (compact ? 0.035 : 0.05));
  const cw = (w - 2 * m) / COLS;
  const ch = (h - 2 * m) / rows;

  // ---- lattice nodes -------------------------------------------------------------------------------------------------
  const nodes: Pt[] = [];
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= COLS; c++) {
      const p: Pt = { x: m + c * cw, y: m + r * ch };
      const edgeR = r === 0 || r === rows;
      const edgeC = c === 0 || c === COLS;
      const j1 = rnd() * 2 - 1;
      const j2 = rnd() * 2 - 1;
      if (edgeR && edgeC) {
        const cut = 0.04 + rnd() * 0.08;
        p.x += (c === 0 ? 1 : -1) * cut * cw;
        p.y += (r === 0 ? 1 : -1) * cut * ch;
      } else if (edgeR) {
        p.x += j1 * 0.14 * cw;
      } else if (edgeC) {
        p.y += j2 * 0.13 * ch;
      } else {
        p.x += j1 * 0.1 * cw;
        p.y += j2 * 0.09 * ch;
      }
      nodes.push(p);
    }
  }

  // ---- edges (canonical orientation: low id -> high id) --------------------------------------------------------------------
  const edges = new Map<string, { pts: Pt[]; outer: boolean }>();
  const addEdge = (a: number, b: number, outer: boolean): void => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const k = edgeKey(a, b);
    if (edges.has(k)) return;
    const p = nodes[lo] as Pt;
    const q = nodes[hi] as Pt;
    const er = mulberry32(((lo + 1) * 7919 + (hi + 1) * 104729 + ((o.seed ?? 0x5a17) | 0)) >>> 0);
    // the coast leans toward the middle of the world (bays, never past the sea margin); borders wobble evenly
    const mx = (p.x + q.x) / 2;
    const my = (p.y + q.y) / 2;
    const toC = (w / 2 - mx) * (-(q.y - p.y)) + (h / 2 - my) * (q.x - p.x);
    const pts = outer ? jag(p, q, compact ? 3 : 4, compact ? 0.13 : 0.16, er, toC >= 0 ? 1 : -1) : jag(p, q, 3, 0.06, er);
    // keep the land inside the sea margin
    const lim = Math.max(2, m * 0.35);
    for (const pt of pts) {
      pt.x = Math.min(w - lim, Math.max(lim, pt.x));
      pt.y = Math.min(h - lim, Math.max(lim, pt.y));
    }
    edges.set(k, { pts, outer });
  };
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c < COLS; c++) addEdge(nodeId(r, c), nodeId(r, c + 1), r === 0 || r === rows);
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c <= COLS; c++) addEdge(nodeId(r, c), nodeId(r + 1, c), c === 0 || c === COLS);
  }
  const walk = (a: number, b: number): Pt[] => {
    const e = edges.get(edgeKey(a, b));
    if (!e) return [];
    const pts = e.pts.map((p) => ({ ...p }));
    return a < b ? pts : pts.reverse();
  };
  const loopPoly = (loop: readonly number[]): Pt[] => {
    const out: Pt[] = [];
    for (let i = 0; i < loop.length; i++) {
      const seg = walk(loop[i] as number, loop[(i + 1) % loop.length] as number);
      out.push(...seg.slice(0, -1));
    }
    return out;
  };

  // ---- regions -------------------------------------------------------------------------------------------------------
  const regions: ContRegion[] = [];
  for (let i = 0; i < n; i++) {
    const loop = cellLoop(i, n);
    const poly = loopPoly(loop);
    const bbox = bboxOf(poly);
    const centroid = polyCentroid(poly);
    const keys = loop.map((id, k) => edgeKey(id, loop[(k + 1) % loop.length] as number));
    const base = Math.min(bbox.w, bbox.h) * 1.14;
    const ratio = Math.min(1.2, Math.max(0.85, bbox.w / Math.max(1, bbox.h)));
    regions.push({
      index: i,
      poly,
      bbox,
      centroid,
      map: { cx: (bbox.x + bbox.w / 2 + centroid.x) / 2, cy: (bbox.y + bbox.h / 2 + centroid.y) / 2, sx: base * Math.sqrt(ratio), sy: base / Math.sqrt(ratio) },
      edges: keys,
    });
  }

  // ---- coast + borders ---------------------------------------------------------------------------------------------------
  const coastLoop: number[] = [];
  for (let c = 0; c <= COLS; c++) coastLoop.push(nodeId(0, c));
  for (let r = 1; r <= rows; r++) coastLoop.push(nodeId(r, COLS));
  for (let c = COLS - 1; c >= 0; c--) coastLoop.push(nodeId(rows, c));
  for (let r = rows - 1; r >= 1; r--) coastLoop.push(nodeId(r, 0));
  const coast = loopPoly(coastLoop);
  const borders: Pt[][] = [];
  for (const [, e] of edges) if (!e.outer) borders.push(e.pts.map((p) => ({ ...p })));

  // ---- gates (consecutive regions share a border) --------------------------------------------------------------------------
  const gates: ContGate[] = [];
  for (let i = 0; i + 1 < n; i++) {
    const a = regions[i] as ContRegion;
    const b = regions[i + 1] as ContRegion;
    const shared = a.edges.filter((k) => b.edges.includes(k) && !(edges.get(k)?.outer ?? true));
    const key = shared[0];
    const e = key ? edges.get(key) : undefined;
    if (!e) continue;
    let total = 0;
    for (let k = 0; k + 1 < e.pts.length; k++) total += Math.hypot((e.pts[k + 1] as Pt).x - (e.pts[k] as Pt).x, (e.pts[k + 1] as Pt).y - (e.pts[k] as Pt).y);
    let run = 0;
    let at: Pt = e.pts[0] as Pt;
    let tangent: Pt = { x: 1, y: 0 };
    for (let k = 0; k + 1 < e.pts.length; k++) {
      const p = e.pts[k] as Pt;
      const q = e.pts[k + 1] as Pt;
      const seg = Math.hypot(q.x - p.x, q.y - p.y);
      if (run + seg >= total / 2) {
        const f = seg > 0 ? (total / 2 - run) / seg : 0;
        at = { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f };
        tangent = { x: (q.x - p.x) / (seg || 1), y: (q.y - p.y) / (seg || 1) };
        break;
      }
      run += seg;
    }
    gates.push({ a: i, b: i + 1, at, tangent, line: e.pts.map((p) => ({ ...p })) });
  }

  return { w, h, regions, coast, borders, gates };
}

// ---------------------------------------------------------------------------------------------------------------------
// placing the pin (banner + name plate) inside a region
//
// One FIXED ANCHOR per region: the banner and its plate form one unit (a signpost: banner standing on / beside its plate). The unit is
// slid to the spot nearest the heart of the region where the whole unit, grown by the gutter, lies inside the region polygon; when
// the region is too small the plate gets narrower and the banner shorter in fixed steps (never the plate's height, whose content is
// designed to fit). So a plate can never spill over a border, touch a neighbour's plate, or cover the whole map.

export interface PlaceOpts {
  plateW: number;
  plateH: number;
  /** banner box (width, height) at scale 1 */
  bannerW: number;
  bannerH: number;
  /** fixed gap between the unit and any border, px */
  gutter: number;
  /** narrowest plate that still shows its longest zone name (px); the plate shrinks no further, the banner does instead */
  plateMin?: number;
}

export interface Placed {
  plate: Rect;
  /** banner box (scaled) and its foot (the pole's base) */
  banner: Rect;
  foot: Pt;
  bannerScale: number;
  /** banner + plate as one box (the anchor) */
  unit: Rect;
  layout: 'stack' | 'side';
}

const rectsHit = (a: Rect, b: Rect, pad = 0): boolean => a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;
export { rectsHit };

/** the rect, grown by the gutter, lies inside the polygon (no vertex pokes in, the whole outline is inside) */
export function rectFits(poly: readonly Pt[], r: Rect, g: number): boolean {
  const x0 = r.x - g;
  const y0 = r.y - g;
  const x1 = r.x + r.w + g;
  const y1 = r.y + r.h + g;
  for (const p of poly) if (p.x > x0 && p.x < x1 && p.y > y0 && p.y < y1) return false;
  const step = Math.max(5, g * 0.8);
  const nx = Math.max(1, Math.ceil((x1 - x0) / step));
  const ny = Math.max(1, Math.ceil((y1 - y0) / step));
  for (let i = 0; i <= nx; i++) {
    const x = x0 + ((x1 - x0) * i) / nx;
    if (!pointInPoly({ x, y: y0 }, poly) || !pointInPoly({ x, y: y1 }, poly)) return false;
  }
  for (let j = 1; j < ny; j++) {
    const y = y0 + ((y1 - y0) * j) / ny;
    if (!pointInPoly({ x: x0, y }, poly) || !pointInPoly({ x: x1, y }, poly)) return false;
  }
  return true;
}

/** shrink steps: [plate width factor, banner scale] */
const SHRINK: readonly (readonly [number, number])[] = [
  [1, 1],
  [0.92, 0.9],
  [0.84, 0.8],
  [0.76, 0.7],
  [0.68, 0.6],
  [0.6, 0.5],
];

function buildUnit(layout: 'stack' | 'side', o: PlaceOpts, pw: number, sc: number, cx: number, cy: number): Placed {
  const bw = o.bannerW * sc;
  const bh = o.bannerH * sc;
  const ph = o.plateH;
  if (layout === 'stack') {
    const ov = Math.min(6, bh * 0.05);
    const w = Math.max(pw, bw);
    const h = bh + ph - ov;
    const top = cy - h / 2;
    const banner: Rect = { x: cx - bw / 2, y: top, w: bw, h: bh };
    const plate: Rect = { x: cx - pw / 2, y: top + bh - ov, w: pw, h: ph };
    return { plate, banner, foot: { x: cx, y: top + bh }, bannerScale: sc, unit: { x: cx - w / 2, y: top, w, h }, layout };
  }
  const gap = Math.max(4, bw * 0.25);
  const w = bw + gap + pw;
  const h = Math.max(bh, ph);
  const left = cx - w / 2;
  const bottom = cy + h / 2;
  const banner: Rect = { x: left, y: bottom - bh, w: bw, h: bh };
  const plate: Rect = { x: left + bw + gap, y: bottom - ph, w: pw, h: ph };
  return { plate, banner, foot: { x: left + bw / 2, y: bottom }, bannerScale: sc, unit: { x: left, y: bottom - h, w, h }, layout };
}

export function placeRegion(reg: ContRegion, o: PlaceOpts): Placed {
  const { bbox, poly, centroid } = reg;
  const g = o.gutter;
  const minPlate = Math.min(o.plateW, o.plateMin ?? 96);
  const tall = bbox.h >= bbox.w * 0.92;
  const layouts: ('stack' | 'side')[] = tall ? ['stack', 'side'] : ['side', 'stack'];
  // candidate centres, nearest to the heart of the region first
  const step = Math.max(4, Math.min(bbox.w, bbox.h) / 36);
  const cands: Pt[] = [];
  for (let y = bbox.y; y <= bbox.y + bbox.h; y += step) {
    for (let x = bbox.x; x <= bbox.x + bbox.w; x += step) if (pointInPoly({ x, y }, poly)) cands.push({ x, y });
  }
  cands.sort((p, q) => Math.hypot(p.x - centroid.x, p.y - centroid.y) - Math.hypot(q.x - centroid.x, q.y - centroid.y));
  for (const [pf, sc] of SHRINK) {
    const pw = Math.max(minPlate, Math.min(o.plateW * pf, bbox.w - 2 * g));
    for (const layout of layouts) {
      // the unit's size does not depend on where it sits: test the shape once at the first candidate for a cheap size reject
      const probe = buildUnit(layout, o, pw, sc, 0, 0).unit;
      if (probe.w + 2 * g > bbox.w || probe.h + 2 * g > bbox.h) continue;
      for (const c of cands) {
        const u = buildUnit(layout, o, pw, sc, c.x, c.y);
        if (rectFits(poly, u.unit, g)) return u;
      }
    }
  }
  const last = SHRINK[SHRINK.length - 1] as readonly [number, number];
  return buildUnit(tall ? 'stack' : 'side', o, Math.max(minPlate * 0.8, Math.min(o.plateW * last[0], bbox.w - 2 * g)), last[1], centroid.x, centroid.y);
}

/** the point where the ray from the centre of `r` toward `p` leaves the rect (pushed out by `out` px) */
export function rectEdgeToward(r: Rect, p: Pt, out = 0): Pt {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const dx = p.x - cx;
  const dy = p.y - cy;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return { x: cx, y: r.y + r.h };
  const k = Math.min(dx !== 0 ? r.w / 2 / Math.abs(dx) : Infinity, dy !== 0 ? r.h / 2 / Math.abs(dy) : Infinity);
  const len = Math.hypot(dx, dy);
  return { x: cx + dx * k + (dx / len) * out, y: cy + dy * k + (dy / len) * out };
}

const distToRect = (p: Pt, r: Rect): number => Math.hypot(Math.max(r.x - p.x, 0, p.x - (r.x + r.w)), Math.max(r.y - p.y, 0, p.y - (r.y + r.h)));

/**
 * Slide every gate along its border to the stretch that is farthest from the plates and banners of the two regions it joins, so a seal
 * medallion never sits on a name plate (phone landscape regions are only about a hundred pixels tall). `clear` = seal radius + gutter.
 */
export function refineGates(gates: readonly ContGate[], avoid: readonly (readonly Rect[])[], clear: number): ContGate[] {
  return gates.map((g) => {
    const rects = [...(avoid[g.a] ?? []), ...(avoid[g.b] ?? [])];
    const line = g.line;
    let total = 0;
    for (let k = 0; k + 1 < line.length; k++) total += Math.hypot((line[k + 1] as Pt).x - (line[k] as Pt).x, (line[k + 1] as Pt).y - (line[k] as Pt).y);
    if (rects.length === 0 || total <= 0) return g;
    let best = g;
    let bestScore = Math.min(Math.min(...rects.map((r) => distToRect(g.at, r))), clear * 2);
    for (let t = 0.12; t <= 0.88 + 1e-9; t += 0.04) {
      let run = 0;
      let at: Pt = line[0] as Pt;
      let tangent: Pt = g.tangent;
      for (let k = 0; k + 1 < line.length; k++) {
        const p = line[k] as Pt;
        const q = line[k + 1] as Pt;
        const seg = Math.hypot(q.x - p.x, q.y - p.y);
        if (run + seg >= total * t) {
          const f = seg > 0 ? (total * t - run) / seg : 0;
          at = { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f };
          tangent = { x: (q.x - p.x) / (seg || 1), y: (q.y - p.y) / (seg || 1) };
          break;
        }
        run += seg;
      }
      const d = Math.min(...rects.map((r) => distToRect(at, r)));
      const score = Math.min(d, clear * 2) - Math.abs(t - 0.5) * clear * 0.4;
      if (score > bestScore) {
        bestScore = score;
        best = { ...g, at, tangent };
      }
    }
    return best;
  });
}

/** map raster fraction (u, v) of a landmark -> px in the world box, through the region's map box */
export function mapPoint(map: MapBox, u: number, v: number): Pt {
  return { x: map.cx + (u - 0.5) * map.sx, y: map.cy + (v - 0.5) * map.sy };
}

export const polyPoints = (poly: readonly Pt[], ox = 0, oy = 0): string => poly.map((p) => `${(p.x - ox).toFixed(1)},${(p.y - oy).toFixed(1)}`).join(' ');
