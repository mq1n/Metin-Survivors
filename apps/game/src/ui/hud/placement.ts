// HUD-aware placement of the off-screen pointers (edge arrows). Pure geometry, no DOM: the caller passes the viewport and
// the rectangles of the HUD widgets the arrows must never cover (taskbar, build strip, timer / boss plate, minimap …).
// An arrow sits where the ray from the screen centre to its target leaves the inset viewport. A reserved rectangle that
// spans most of an edge (the taskbar) moves that edge inward; any other rectangle the spot falls into makes the arrow
// slide along the edge to the nearest free spot (the heading it shows is unchanged). Two arrows never overlap.

export interface Rect {
  l: number;
  t: number;
  r: number;
  b: number;
}

export interface ArrowRequest {
  key: string;
  /** direction from the screen centre to the target (any length, not zero) */
  dx: number;
  dy: number;
  /** higher wins a contested spot (the boss keeps its place, Metins slide) */
  priority?: number;
}

export interface PlacedArrow {
  key: string;
  x: number;
  y: number;
  /** heading in degrees, 0 = right, 90 = down */
  angle: number;
}

export interface PlaceOptions {
  w: number;
  h: number;
  /** distance of the arrow centre from the viewport edge */
  inset: number;
  /** half size of an arrow (reserved rects are grown by it) */
  radius: number;
  blocked: readonly Rect[];
}

interface Ins {
  t: number;
  r: number;
  b: number;
  l: number;
}

const inside = (x: number, y: number, r: Rect): boolean => x > r.l && x < r.r && y > r.t && y < r.b;
const grow = (r: Rect, d: number): Rect => ({ l: r.l - d, t: r.t - d, r: r.r + d, b: r.b + d });

/** Per-edge inset: the base inset, moved inward past every reserved rectangle that spans >= 78 % of that edge. */
export function edgeInsets(o: PlaceOptions): Ins {
  const ins: Ins = { t: o.inset, r: o.inset, b: o.inset, l: o.inset };
  for (const r of o.blocked) {
    const spanW = (Math.min(r.r, o.w) - Math.max(r.l, 0)) / o.w;
    const spanH = (Math.min(r.b, o.h) - Math.max(r.t, 0)) / o.h;
    if (spanW >= 0.78) {
      if (r.b >= o.h - 1) ins.b = Math.max(ins.b, o.h - r.t + o.radius);
      else if (r.t <= 1) ins.t = Math.max(ins.t, r.b + o.radius);
    }
    if (spanH >= 0.78) {
      if (r.r >= o.w - 1) ins.r = Math.max(ins.r, o.w - r.l + o.radius);
      else if (r.l <= 1) ins.l = Math.max(ins.l, r.r + o.radius);
    }
  }
  return ins;
}

/** Point where the ray from the screen centre in direction (dx, dy) leaves the inset viewport. */
export function rayToEdge(dx: number, dy: number, o: Pick<PlaceOptions, 'w' | 'h'> & { ins: Ins }): { x: number; y: number } {
  const cx = o.w / 2;
  const cy = o.h / 2;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const tx = ux > 1e-9 ? (o.w - o.ins.r - cx) / ux : ux < -1e-9 ? (cx - o.ins.l) / -ux : Infinity;
  const ty = uy > 1e-9 ? (o.h - o.ins.b - cy) / uy : uy < -1e-9 ? (cy - o.ins.t) / -uy : Infinity;
  const k = Math.max(0, Math.min(tx, ty));
  return { x: cx + ux * k, y: cy + uy * k };
}

type Edge = 'top' | 'bottom' | 'left' | 'right';

function edgeOf(x: number, y: number, o: PlaceOptions, ins: Ins): Edge {
  const d: [Edge, number][] = [
    ['top', Math.abs(y - ins.t)],
    ['bottom', Math.abs(y - (o.h - ins.b))],
    ['left', Math.abs(x - ins.l)],
    ['right', Math.abs(x - (o.w - ins.r))],
  ];
  d.sort((a, b) => a[1] - b[1]);
  return d[0]?.[0] ?? 'top';
}

/** The free position nearest to `s0` on ONE line of an edge (a row for the top / bottom edge, a column for the left / right one):
 *  just outside either side of every rectangle that crosses the line, and the two ends. Null when the whole line is walled off. */
function freeOnLine(v: number, s0: number, horizontal: boolean, lo: number, hi: number, rects: readonly Rect[]): number | null {
  const free = (s: number): boolean => !rects.some((r) => (horizontal ? inside(s, v, r) : inside(v, s, r)));
  if (free(s0)) return s0;
  const cands: number[] = [lo, hi];
  for (const r of rects) {
    const crosses = horizontal ? v > r.t && v < r.b : v > r.l && v < r.r;
    if (!crosses) continue;
    if (horizontal) cands.push(r.l, r.r);
    else cands.push(r.t, r.b);
  }
  const ok = cands.map((c) => Math.min(hi, Math.max(lo, c))).filter(free);
  if (ok.length === 0) return null;
  ok.sort((a, b) => Math.abs(a - s0) - Math.abs(b - s0));
  return ok[0] ?? null;
}

/** Moves (x, y) along its edge until it is out of every reserved rectangle (nearest free spot; stays on the edge). When the
 *  whole edge line is walled off (portrait phones: vitals, timer and minimap fill the top band from side to side) the arrow
 *  rides the next line inward, just past the rectangle that walls it, up to the middle of the screen (the heading it shows is
 *  unchanged); only when no line is free either it stays where the ray left the viewport. */
function slide(x: number, y: number, o: PlaceOptions, ins: Ins, others: readonly Rect[]): { x: number; y: number } {
  const edge = edgeOf(x, y, o, ins);
  const horizontal = edge === 'top' || edge === 'bottom';
  const lo = horizontal ? ins.l : ins.t;
  const hi = horizontal ? o.w - ins.r : o.h - ins.b;
  const rects = [...o.blocked, ...others].map((r) => grow(r, o.radius));
  const at = (v: number, s: number): { x: number; y: number } => (horizontal ? { x: s, y: v } : { x: v, y: s });
  const s0 = horizontal ? x : y;
  const v0 = horizontal ? y : x;
  const here = freeOnLine(v0, s0, horizontal, lo, hi, rects);
  if (here !== null) return at(v0, here);
  // the line is walled off: candidate lines just past the far side of a rectangle, nearest first, never past the screen middle
  const dir = edge === 'top' || edge === 'left' ? 1 : -1;
  const mid = horizontal ? o.h / 2 : o.w / 2;
  const lines = rects
    .map((r) => (horizontal ? (dir > 0 ? r.b : r.t) : dir > 0 ? r.r : r.l) + dir * 0.5)
    .filter((v) => dir * (v - v0) > 0 && dir * (v - mid) <= 0)
    .sort((a, b) => dir * (a - b));
  for (const v of lines) {
    const s = freeOnLine(v, s0, horizontal, lo, hi, rects);
    if (s !== null) return at(v, s);
  }
  return { x, y };
}

/** Places every arrow; the result keeps the request order. */
export function placeArrows(reqs: readonly ArrowRequest[], o: PlaceOptions): PlacedArrow[] {
  const ins = edgeInsets(o);
  const order = reqs.map((r, i) => ({ r, i })).sort((a, b) => (b.r.priority ?? 0) - (a.r.priority ?? 0) || a.i - b.i);
  const placed: (PlacedArrow | undefined)[] = [];
  const taken: Rect[] = [];
  for (const { r, i } of order) {
    const p0 = rayToEdge(r.dx, r.dy, { w: o.w, h: o.h, ins });
    // arrows already placed are obstacles (two arrows never overlap)
    const p = slide(p0.x, p0.y, o, ins, taken);
    placed[i] = { key: r.key, x: p.x, y: p.y, angle: (Math.atan2(r.dy, r.dx) * 180) / Math.PI };
    taken.push({ l: p.x - o.radius, t: p.y - o.radius, r: p.x + o.radius, b: p.y + o.radius });
  }
  return placed.filter((a): a is PlacedArrow => a !== undefined);
}
