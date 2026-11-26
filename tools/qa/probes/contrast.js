// contrast.js — text contrast below WCAG AA (G3): 4.5:1, or 3:1 for large text (>= 24 px, or >= 18.66 px at weight >= 700).
// Background = what is painted behind THE TEXT BOX, alpha-composited over the page colour (#0b0806 unless __probeOpts.page):
//   solid     the ancestors' background-colors, up to the first opaque layer, their opacity accumulated;
//   gradient  linear and radial gradients are evaluated along their line / radius over the part the text covers (gold chips, plates, vignette veils:
//             the colours under the text, not every stop); 1-4 px hard-stop bands (the chamfer bevels of every kit plate) are no background. Conic
//             gradients count with every stretch longer than 4 px;
//   image     a url() background (parchment, stone grain, card art) drawn to a 64 x 64 canvas and read over the part the text covers (background-size /
//             -position / -repeat honoured): the 10th, mean and 90th percentile colours stand for it. `busy: true` = the luminance under the text
//             varies a lot (a photo): verify on a crop. Images that cannot be read (cross-origin, not decodable) are counted in `unverified`;
//   pseudo    ::before / ::after fills painted BEHIND the content (position absolute, z-index < 0, >= 70 % of the box): the kit plates (.ms-plate
//             ::before = the face over ::after = the outline), refine pips, gold plate faces. Overlays above the text are not backgrounds.
// The old flat background-color approximation reported ~80 false positives per phone gate (dark text on gold chips, parchment, gold refine pips at
// 1.0-1.2:1); what is left now is measured against the real colours under the text (a gold chip: 4.46:1 at its darkest end, as the online builder
// pixel-measured). Rows carry `onImage: true` when any gradient / image / pseudo layer took part, plus `via` (which kinds) and `rect` [x, y, w, h] in CSS px (crop the shot there). Gradient text
// (background-clip: text) and aria-hidden subtrees are skipped. Returns { checked, count, hard, unverified, offenders } worst first. Options (run.ts --opts):
// { limit, all: true (every row, not only failures), page: [r,g,b], settle: false (do not finish running animations first), debug: true (rows carry `stack`:
// the colour samples of every layer, topmost first) }.
const O = Object.assign({ page: [11, 8, 6], limit: 25, wait: 500, all: false, debug: false, settle: true }, window.__probeOpts || {});
await document.fonts.ready;
await new Promise((r) => setTimeout(r, O.wait));
// finite animations / transitions that are still running (card deal-in, fade-ins staggered by --i) are finished first: a text caught at opacity 0.3 reads as
// 1.0-1.5:1 for a moment and was the other big source of false positives (the infinite ones throw and are left alone). Animations on another timeline than
// document.timeline (the scroll-driven .ms-edgefade masks) are not finished: finish() would invert the fades in a capture. { settle: false } keeps them all.
if (O.settle) {
  for (const a of document.getAnimations()) {
    if (a.timeline && a.timeline !== document.timeline) continue;
    try {
      a.finish();
    } catch (e) {
      /* infinite */
    }
  }
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}
const root = document.querySelector('.ms-ui') || document.body;
const label = (el) => `${el.tagName.toLowerCase()}${el.classList.length ? '.' + [...el.classList].slice(0, 3).join('.') : ''}`;

// ---- colour helpers -------------------------------------------------------------------------------------------------------------------
const COLOR_RE = /rgba?\([^)]*\)|color\(srgb[^)]*\)/g;
const parse = (s) => {
  if (!s) return null;
  let m = /^rgba?\(([^)]+)\)/.exec(s);
  if (m) {
    const t = m[1].split(/[\s,/]+/).filter(Boolean);
    const num = (x) => (x.endsWith('%') ? (parseFloat(x) * 255) / 100 : Number(x));
    const a = t.length > 3 ? (t[3].endsWith('%') ? parseFloat(t[3]) / 100 : Number(t[3])) : 1;
    return [num(t[0]), num(t[1]), num(t[2]), a];
  }
  m = /^color\(srgb\s+([^)]+)\)/.exec(s);
  if (m) {
    const [rgb, alpha] = m[1].split('/');
    const p = rgb.trim().split(/\s+/).map((x) => Number(x) * 255);
    return [p[0], p[1], p[2], alpha === undefined ? 1 : alpha.trim().endsWith('%') ? parseFloat(alpha) / 100 : Number(alpha)];
  }
  return null;
};
const over = (top, under) => {
  const a = top[3];
  return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1];
};
const lum = (c) => {
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
/** the darkest, the middle and the lightest of a list of opaque colours (all a contrast has to hold against) */
const spread = (list) => {
  if (list.length <= 1) return list;
  const s = [...list].sort((p, q) => lum(p) - lum(q));
  const lo = s[0];
  const hi = s[s.length - 1];
  return [lo, [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2, 1], hi];
};
/** split a computed value list on its top-level commas */
const splitTop = (v) => {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of v) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
};
const urlOf = (layer) => {
  const m = /^url\((["']?)(.*)\1\)$/.exec(layer);
  return m ? m[2] : null;
};

// ---- images: a 64 x 64 read of every url() the UI paints, once ---------------------------------------------------------------------------
const GRID = 64;
const imgCache = (window.__ctrImg64 = window.__ctrImg64 || new Map());
const readImage = (url) => {
  if (imgCache.has(url)) return imgCache.get(url);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = c.height = GRID;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0, GRID, GRID);
        resolve({ nw: img.naturalWidth || GRID, nh: img.naturalHeight || GRID, data: g.getImageData(0, 0, GRID, GRID).data });
      } catch (e) {
        resolve(null); // tainted canvas
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
  imgCache.set(url, p);
  return p;
};
const allEls = [...root.querySelectorAll('*')];
const chain = new Set();
for (const el of allEls) for (let e = el; e && !chain.has(e); e = e.parentElement) chain.add(e);
const urls = new Set();
for (const e of chain) {
  for (const pe of [null, '::before', '::after']) {
    const bi = getComputedStyle(e, pe).backgroundImage;
    if (bi && bi !== 'none') for (const l of splitTop(bi)) { const u = urlOf(l); if (u) urls.add(u); }
  }
}
const images = new Map();
await Promise.all([...urls].map(async (u) => images.set(u, await readImage(u))));
let unverified = 0;
let busyNow = false; // set by imageSamples: the colours under the last text box varied a lot

/** the colours of an image over the text box (rect, in px) of a layer painted on `host` (a box in px) */
const imageSamples = (d, rect) => {
  const { img, host } = d;
  const W = host.width;
  const H = host.height;
  const dim = (tok, full) => (!tok || tok === 'auto' ? null : tok.endsWith('%') ? (parseFloat(tok) / 100) * full : parseFloat(tok));
  let tw;
  let th;
  const sz = d.size.trim();
  if (sz === 'cover' || sz === 'contain') {
    const k = (sz === 'cover' ? Math.max : Math.min)(W / img.nw, H / img.nh);
    tw = img.nw * k;
    th = img.nh * k;
  } else {
    const [a, b] = sz.split(/\s+/);
    tw = dim(a, W);
    th = dim(b ?? 'auto', H);
    if (tw === null && th === null) {
      tw = img.nw;
      th = img.nh;
    } else if (tw === null) tw = (th * img.nw) / img.nh;
    else if (th === null) th = (tw * img.nh) / img.nw;
  }
  if (!(tw > 0 && th > 0)) return [];
  const [px, py] = d.pos.trim().split(/\s+/);
  const off = (tok, full, tile) => (tok.endsWith('%') ? (parseFloat(tok) / 100) * (full - tile) : parseFloat(tok) || 0);
  const ox = off(px ?? '0%', W, tw);
  const oy = off(py ?? '0%', H, th);
  const rx = !/no-repeat|repeat-y/.test(d.repeat);
  const ry = !/no-repeat|repeat-x/.test(d.repeat);
  // a0..a1 = the text box on this axis (host coords); returns the covered part of the tile as [u0, u1] in 0..1, or null when nothing is painted
  const axis = (a0, a1, o, tile, rep) => {
    if (rep) {
      if (a1 - a0 >= tile) return [0, 1];
      const u0 = ((((a0 - o) / tile) % 1) + 1) % 1;
      const u1 = u0 + (a1 - a0) / tile;
      return u1 > 1 ? [0, 1] : [u0, u1];
    }
    const u0 = (a0 - o) / tile;
    const u1 = (a1 - o) / tile;
    if (u1 <= 0 || u0 >= 1) return null;
    return [Math.max(0, u0), Math.min(1, u1)];
  };
  const x0 = rect.left - host.left;
  const y0 = rect.top - host.top;
  const ur = axis(x0, x0 + rect.width, ox, tw, rx);
  const vr = axis(y0, y0 + rect.height, oy, th, ry);
  if (!ur || !vr) return [];
  const ix0 = Math.min(GRID - 1, Math.floor(ur[0] * GRID));
  const ix1 = Math.max(ix0, Math.min(GRID - 1, Math.ceil(ur[1] * GRID) - 1));
  const iy0 = Math.min(GRID - 1, Math.floor(vr[0] * GRID));
  const iy1 = Math.max(iy0, Math.min(GRID - 1, Math.ceil(vr[1] * GRID) - 1));
  const pix = [];
  let r = 0;
  let g = 0;
  let b = 0;
  let aSum = 0;
  let n = 0;
  for (let y = iy0; y <= iy1; y++) {
    for (let x = ix0; x <= ix1; x++) {
      const i = (y * GRID + x) * 4;
      const a = img.data[i + 3] / 255;
      pix.push([img.data[i], img.data[i + 1], img.data[i + 2], a]);
      r += img.data[i] * a;
      g += img.data[i + 1] * a;
      b += img.data[i + 2] * a;
      aSum += a;
      n++;
    }
  }
  if (!n || aSum === 0) return [];
  const mean = [r / aSum, g / aSum, b / aSum, aSum / n];
  const solid = pix.filter((q) => q[3] > 0.5).sort((p, q) => lum(p) - lum(q));
  const lo = solid.length ? solid[Math.floor(solid.length * 0.1)] : mean;
  const hi = solid.length ? solid[Math.floor(solid.length * 0.9)] : mean;
  if (solid.length && lum(hi) - lum(lo) > 0.12) busyNow = true;
  return [[lo[0], lo[1], lo[2], mean[3]], mean, [hi[0], hi[1], hi[2], mean[3]]];
};

// ---- gradients ------------------------------------------------------------------------------------------------------------------------
const MIN_PX = 4; // a stretch shorter than this is a decoration (the 1-2 px hard-stop bevel bands of every plate), not a background
const parseGradient = (layer, W, H) => {
  const open = layer.indexOf('(');
  const kind = layer.slice(0, open);
  const items = splitTop(layer.slice(open + 1, layer.lastIndexOf(')')));
  const linear = /^(repeating-)?linear-gradient$/.test(kind);
  const radial = /^(repeating-)?radial-gradient$/.test(kind);
  let deg = 180;
  let L = Math.hypot(W, H) / 2;
  let rad = null;
  if (radial) {
    // radial-gradient([circle | ellipse] [size] [at x y], stops): centre and radii in px of the box
    const head = items[0] && !items[0].match(COLOR_RE) ? items[0] : '';
    const [shape, at] = head.split(/at/);
    let cx = W / 2;
    let cy = H / 2;
    if (at) {
      const kw = { left: '0%', top: '0%', center: '50%', right: '100%', bottom: '100%' };
      const [ax, ay] = at.trim().split(/\s+/).map((t) => kw[t] ?? t);
      const len = (t, full) => (t === undefined ? full / 2 : t.endsWith('%') ? (parseFloat(t) / 100) * full : parseFloat(t));
      cx = len(ax, W);
      cy = len(ay ?? '50%', H);
    }
    const fx = Math.max(cx, W - cx);
    const fy = Math.max(cy, H - cy);
    const sx = Math.min(cx, W - cx);
    const sy = Math.min(cy, H - cy);
    const circle = /circle/.test(shape || '');
    const lens = ((shape || '').match(/-?[\d.]+(?:px|%)/g) || []).map((t, i) => (t.endsWith('%') ? (parseFloat(t) / 100) * (i === 0 ? W : H) : parseFloat(t)));
    let rx;
    let ry;
    if (lens.length >= 2) [rx, ry] = lens;
    else if (lens.length === 1) rx = ry = lens[0];
    else if (/closest-side/.test(shape || '')) {
      rx = circle ? Math.min(sx, sy) : sx;
      ry = circle ? rx : sy;
    } else if (/farthest-side/.test(shape || '')) {
      rx = circle ? Math.max(fx, fy) : fx;
      ry = circle ? rx : fy;
    } else if (/closest-corner/.test(shape || '')) {
      rx = circle ? Math.hypot(sx, sy) : sx * Math.SQRT2;
      ry = circle ? rx : sy * Math.SQRT2;
    } else {
      rx = circle ? Math.hypot(fx, fy) : fx * Math.SQRT2;
      ry = circle ? rx : fy * Math.SQRT2;
    }
    if (!(rx > 0 && ry > 0)) return null;
    rad = { cx, cy, rx, ry };
    L = rx;
  }
  if (linear) {
    const head = items[0] || '';
    if (!head.match(COLOR_RE)) {
      const m = /(-?[\d.]+)deg/.exec(head);
      if (m) deg = Number(m[1]);
      else if (/to\s+/.test(head)) {
        const h = /top/.test(head) ? 'T' : /bottom/.test(head) ? 'B' : '';
        const v = /left/.test(head) ? 'L' : /right/.test(head) ? 'R' : '';
        deg = { T: 0, B: 180, L: 270, R: 90, TL: 315, TR: 45, BL: 225, BR: 135 }[h + v] ?? 180;
      }
    }
    const a = (deg * Math.PI) / 180;
    L = Math.abs(W * Math.sin(a)) + Math.abs(H * Math.cos(a));
  }
  const stops = [];
  for (const it of items) {
    const cm = it.match(COLOR_RE);
    if (!cm) continue; // direction / size / colour hint
    const c = parse(cm[0]);
    if (!c) continue;
    const ps = (it.replace(cm[0], '').match(/-?[\d.]+(?:px|%)/g) || []).map((t) => (t.endsWith('%') ? (parseFloat(t) / 100) * L : parseFloat(t)));
    if (ps.length === 0) stops.push({ c, p: null });
    else for (const p of ps.slice(0, 2)) stops.push({ c, p });
  }
  if (!stops.length) return null;
  if (stops[0].p === null) stops[0].p = 0;
  if (stops[stops.length - 1].p === null) stops[stops.length - 1].p = L;
  for (let i = 0; i < stops.length; i++) {
    if (stops[i].p !== null) continue;
    let j = i;
    while (stops[j].p === null) j++;
    const a = stops[i - 1].p;
    const b = stops[j].p;
    for (let k = i; k < j; k++) stops[k].p = a + ((b - a) * (k - i + 1)) / (j - i + 1);
    i = j;
  }
  for (let i = 1; i < stops.length; i++) stops[i].p = Math.max(stops[i].p, stops[i - 1].p);
  return { linear, radial, rad, deg, L, stops };
};
/** colours of a gradient over the text box: for a linear one, the line segment the box projects onto; otherwise every stretch >= MIN_PX */
const gradientSamples = (d, rect0) => {
  const { g, tile } = d;
  const { stops, L } = g;
  // the text box in the coordinates of the (first) gradient tile; a tile that does not reach the text paints nothing there
  const fit = (a0, a1, o, size, rep) => {
    if (rep) {
      if (a1 - a0 >= size) return [o, o + size];
      const u = ((((a0 - o) % size) + size) % size) + o;
      return u + (a1 - a0) > o + size ? [o, o + size] : [u, u + (a1 - a0)];
    }
    return a1 <= o || a0 >= o + size ? null : [Math.max(a0, o), Math.min(a1, o + size)];
  };
  const hx = d.host.left;
  const hy = d.host.top;
  const fx = fit(rect0.left - hx, rect0.right - hx, tile.x, tile.w, tile.rx);
  const fy = fit(rect0.top - hy, rect0.bottom - hy, tile.y, tile.h, tile.ry);
  if (!fx || !fy) return [];
  const host = { left: hx + tile.x, top: hy + tile.y, width: tile.w, height: tile.h };
  const rect = { left: hx + fx[0], right: hx + fx[1], top: hy + fy[0], bottom: hy + fy[1] };
  // bands of the gradient line: [p0, p1, c0, c1], plus the flat head and tail
  const bands = [];
  if (stops[0].p >= MIN_PX) bands.push([0, stops[0].p, stops[0].c, stops[0].c]);
  for (let i = 0; i + 1 < stops.length; i++) if (stops[i + 1].p - stops[i].p >= MIN_PX) bands.push([stops[i].p, stops[i + 1].p, stops[i].c, stops[i + 1].c]);
  const last = stops[stops.length - 1];
  if (L - last.p >= MIN_PX) bands.push([last.p, L, last.c, last.c]);
  if (!bands.length) return [];
  let t0 = 0;
  let t1 = L;
  if (g.radial) {
    // distance (in gradient-line px, scaled so the horizontal radius = L) from the centre to the nearest / farthest point of the text box
    const { cx, cy, rx, ry } = g.rad;
    const px = cx + host.left;
    const py = cy + host.top;
    const nx = Math.min(Math.max(px, rect.left), rect.right);
    const ny = Math.min(Math.max(py, rect.top), rect.bottom);
    const dist = (x, y) => Math.hypot(((x - px) / rx) * L, ((y - py) / ry) * L);
    t0 = Math.min(L, dist(nx, ny));
    t1 = Math.min(L, Math.max(...[[rect.left, rect.top], [rect.right, rect.top], [rect.left, rect.bottom], [rect.right, rect.bottom]].map(([x, y]) => dist(x, y))));
    if (t1 < t0) t1 = t0;
  } else if (g.linear) {
    const a = (g.deg * Math.PI) / 180;
    const dx = Math.sin(a);
    const dy = -Math.cos(a);
    const cx = host.left + host.width / 2;
    const cy = host.top + host.height / 2;
    const ts = [[rect.left, rect.top], [rect.right, rect.top], [rect.left, rect.bottom], [rect.right, rect.bottom]].map(([x, y]) => L / 2 + (x - cx) * dx + (y - cy) * dy);
    t0 = Math.max(0, Math.min(...ts));
    t1 = Math.min(L, Math.max(...ts));
    if (t1 < t0) t1 = t0;
  }
  const out = [];
  for (const [p0, p1, c0, c1] of bands) {
    if (p1 < t0 || p0 > t1) continue;
    const at = (t) => mix(c0, c1, p1 > p0 ? Math.min(1, Math.max(0, (t - p0) / (p1 - p0))) : 0);
    out.push(at(Math.max(p0, t0)), at(Math.min(p1, t1)));
  }
  return out;
};

// ---- the painted layers of one element, topmost first -----------------------------------------------------------------------------------
const layerCache = new WeakMap();
const descsOfBox = (cs, host, pseudo) => {
  const out = [];
  const bi = cs.backgroundImage;
  const imgs = bi && bi !== 'none' ? splitTop(bi) : [];
  const sizes = splitTop(cs.backgroundSize || '');
  const poss = splitTop(cs.backgroundPosition || '');
  const reps = splitTop(cs.backgroundRepeat || '');
  const pick = (list, i) => (list.length ? list[i % list.length] : '');
  imgs.forEach((l, i) => {
    const u = urlOf(l);
    if (u) {
      const img = images.get(u);
      if (!img) {
        unverified++;
        return;
      }
      out.push({ kind: 'image', pseudo, img, host, size: pick(sizes, i) || 'auto', pos: pick(poss, i) || '0% 0%', repeat: pick(reps, i) || 'repeat' });
    } else if (/gradient\(/.test(l)) {
      // a gradient is as big as its background tile (a 2 px rule at the foot of a title is `linear-gradient(...) bottom / 100% 2px no-repeat`)
      const sz = (pick(sizes, i) || 'auto').trim();
      const [sa, sb] = sz.split(/\s+/);
      const dm = (t, full) => (!t || t === 'auto' ? full : t.endsWith('%') ? (parseFloat(t) / 100) * full : parseFloat(t));
      const tw = sz === 'cover' || sz === 'contain' ? host.width : dm(sa, host.width);
      const th = sz === 'cover' || sz === 'contain' ? host.height : dm(sb ?? 'auto', host.height);
      if (!(tw >= MIN_PX && th >= MIN_PX)) return; // a rule / hairline thinner than a few px is no background for text
      const [pa, pb] = (pick(poss, i) || '0% 0%').trim().split(/\s+/);
      const po = (t, full, tile) => (!t ? 0 : t.endsWith('%') ? (parseFloat(t) / 100) * (full - tile) : parseFloat(t) || 0);
      const rp = pick(reps, i) || 'repeat';
      const g = parseGradient(l, tw, th);
      if (g) out.push({ kind: 'gradient', pseudo, g, host, tile: { w: tw, h: th, x: po(pa, host.width, tw), y: po(pb ?? '50%', host.height, th), rx: !/no-repeat|repeat-y/.test(rp), ry: !/no-repeat|repeat-x/.test(rp) } });
    }
  });
  const col = parse(cs.backgroundColor);
  if (col && col[3] > 0) out.push({ kind: 'solid', pseudo, color: col });
  return out;
};
const layersOf = (e) => {
  if (layerCache.has(e)) return layerCache.get(e);
  const out = [];
  const r = e.getBoundingClientRect();
  const host = { left: r.left, top: r.top, width: r.width, height: r.height };
  // pseudo-elements with a negative z-index paint over the element's own background and under its content; the higher z-index paints on top
  // (ties: ::after over ::before). The kit plates are ::before (z -1, the face) over ::after (z -2, the 1 px outline).
  const pseudos = [];
  for (const pe of ['::after', '::before']) {
    const ps = getComputedStyle(e, pe);
    if (ps.display === 'none' || ps.content === 'none' || ps.content === 'normal' || ps.position !== 'absolute') continue;
    const z = parseInt(ps.zIndex, 10);
    if (!(z < 0)) continue;
    const pw = parseFloat(ps.width);
    const ph = parseFloat(ps.height);
    if (!(pw >= r.width * 0.7 && ph >= r.height * 0.7)) continue;
    pseudos.push({ ps, z, pw, ph });
  }
  pseudos.sort((a, b) => b.z - a.z);
  for (const { ps, pw, ph } of pseudos) {
    const k = Number(ps.opacity);
    const box = { left: r.left + (r.width - pw) / 2, top: r.top + (r.height - ph) / 2, width: pw, height: ph };
    for (const d of descsOfBox(ps, box, true)) out.push({ ...d, k: Number.isFinite(k) ? k : 1 });
  }
  for (const d of descsOfBox(getComputedStyle(e), host, false)) out.push({ ...d, k: 1 });
  layerCache.set(e, out);
  return out;
};
/** the colours (RGBA samples) a layer paints under the text box */
const samplesOf = (d, rect) => {
  let s;
  if (d.kind === 'solid') s = [d.color];
  else if (d.kind === 'gradient') s = gradientSamples(d, rect);
  else s = imageSamples(d, rect);
  return s.map((c) => [c[0], c[1], c[2], c[3] * d.k]);
};

// ---- the check ------------------------------------------------------------------------------------------------------------------------
const bad = [];
let checked = 0;
for (const el of allEls) {
  const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()).join(' ');
  if (!own || el.closest('[aria-hidden="true"]')) continue;
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > innerHeight) continue;
  const cs = getComputedStyle(el);
  if (cs.visibility === 'hidden' || /text/.test(cs.backgroundClip + cs.webkitBackgroundClip)) continue;
  const fg0 = parse(cs.color);
  if (!fg0) continue;
  // collect the painted layers inner -> outer until an opaque one; accumulate opacity
  const stack = [];
  const src = [];
  let alpha = 1;
  let hidden = false;
  busyNow = false;
  const via = new Set();
  for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
    const s = getComputedStyle(e);
    if (s.display === 'none' || s.visibility === 'hidden') hidden = true;
    alpha *= Number(s.opacity);
    let done = false;
    for (const d of layersOf(e)) {
      const samples = samplesOf(d, r);
      if (!samples.length) continue;
      stack.push(samples);
      if (O.debug) src.push(`${label(e)}${d.pseudo ? '::pseudo' : ''} ${d.kind}${d.tile ? ` tile ${Math.round(d.tile.w)}x${Math.round(d.tile.h)}@${Math.round(d.tile.x)},${Math.round(d.tile.y)}` : ''}`);
      if (d.kind !== 'solid') via.add(d.kind);
      if (d.pseudo) via.add('pseudo');
      if (samples.every((c) => c[3] >= 0.999)) {
        done = true;
        break;
      }
    }
    if (done) break;
  }
  if (hidden || alpha < 0.05) continue;
  // compose from the outermost layer inwards over the page colour
  let bases = [[...O.page, 1]];
  for (let i = stack.length - 1; i >= 0; i--) {
    const next = [];
    for (const c of stack[i]) for (const b of bases) next.push(over(c, b));
    bases = spread(next);
  }
  const px = parseFloat(cs.fontSize);
  const large = px >= 24 || (px >= 18.66 && Number(cs.fontWeight) >= 700);
  const need = large ? 3 : 4.5;
  let k = Infinity;
  for (const b of bases) k = Math.min(k, ratio(over([fg0[0], fg0[1], fg0[2], fg0[3] * alpha], b), b));
  checked++;
  if (k < need || O.all) {
    const row = { el: label(el), ratio: Math.round(k * 100) / 100, need, px: Math.round(px * 10) / 10, onImage: via.size > 0, text: own.slice(0, 32) };
    row.fg = [Math.round(fg0[0]), Math.round(fg0[1]), Math.round(fg0[2])];
    row.rect = [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
    if (via.size) row.via = [...via].join(',');
    if (busyNow) row.busy = true;
    if (O.debug) {
      row.stack = stack.map((l) => l.map((c) => c.map((v) => Math.round(v * 100) / 100)));
      row.src = src;
    }
    bad.push(row);
  }
}
bad.sort((a, b) => a.ratio - b.ratio);
// count = every row below its AA bar (4.5 / 3); hard = the rows below 3:1 whatever their size (gate on this one; the 3.2-4.4 rows are kit plates and
// medals measured at the worst pixel of their texture, real but marginal, pixel-checked within ~10 % on the phone-gate screens)
return { checked, count: bad.length, hard: bad.filter((b) => b.ratio < 3).length, unverified, offenders: bad.slice(0, O.limit) };
