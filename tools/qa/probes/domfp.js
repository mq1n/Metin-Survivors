// domfp.js — deterministic DOM fingerprint of the UI (C0 rail: "zero visual change" proof for refactors).
// Body of an async function: `bun tools/qa/shot.ts ui --screens menu --eval @tools/qa/probes/domfp.js --out x/` or the
// batch runner `bun tools/qa/probes/run.ts --probes domfp …` (full per-element lines + seeded Math.random).
//
// What it hashes, for every element whose class contains "ms-" (plus ::before/::after when they render):
//   tag, class, getBoundingClientRect, colour, background (colour + image + size/position), font (size/family/weight/
//   variant-numeric), opacity, transform, filter, box-shadow, border (colour/width/radius/image), display, visibility,
//   z-index, overflow, animation-name/duration/fill-mode.
// Animations are put into a canonical state before measuring (finite → their end, infinite → t = 0) and restored after,
// so rotating rays / pulsing glows / tallies never make two runs differ. Random particles (EmberField, Motes) have no
// ms- class and are skipped by construction. Options (window.__probeOpts): { full, chunk, quiet, max, exclude: [css] }.
const O = Object.assign({ full: false, chunk: 40, quiet: 700, max: 12000, exclude: [] }, window.__probeOpts || {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- settle: fonts, images, and a quiet DOM (structure, text and class changes; inline style ticks are ignored) ----
await document.fonts.ready;
await new Promise((resolve) => {
  let last = performance.now();
  const t0 = last;
  const mo = new MutationObserver(() => (last = performance.now()));
  mo.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'hidden', 'src'] });
  const tick = () => {
    const now = performance.now();
    if (now - last >= O.quiet || now - t0 >= O.max) {
      mo.disconnect();
      resolve();
    } else setTimeout(tick, 100);
  };
  setTimeout(tick, 150);
});
await Promise.all([...document.images].map((img) => (img.complete ? null : Promise.race([img.decode().catch(() => null), sleep(4000)]))));
await document.fonts.ready;

// ---- canonical animation state ----
const saved = [];
for (const a of document.getAnimations()) {
  try {
    const timing = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : null;
    saved.push({ a, t: a.currentTime, state: a.playState });
    a.pause();
    a.currentTime = timing && Number.isFinite(timing.endTime) ? timing.endTime : 0;
  } catch {
    /* animation without a timeline */
  }
}

const fnv = (s) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
};
const r1 = (v) => (Math.round(v * 10) / 10).toString();
const PROPS = ['color', 'background-color', 'background-image', 'background-size', 'background-position', 'font-size', 'font-family', 'font-weight', 'font-variant-numeric', 'font-style', 'letter-spacing', 'line-height', 'opacity', 'transform', 'filter', 'box-shadow', 'text-shadow', 'border-top-color', 'border-top-width', 'border-bottom-width', 'border-left-width', 'border-top-left-radius', 'border-image-source', 'border-image-width', 'outline-style', 'display', 'visibility', 'z-index', 'overflow-x', 'overflow-y', 'clip-path', 'mask-image', 'animation-name', 'animation-duration', 'animation-fill-mode'];
const PSEUDO = ['content', 'position', 'background-color', 'background-image', 'opacity', 'transform', 'filter', 'border-image-source', 'border-image-width', 'border-top-width', 'box-shadow', 'width', 'height', 'top', 'left', 'animation-name'];
const excl = O.exclude.length ? O.exclude.join(',') : null;
const used = new Set();
const lines = [];
const els = [...document.querySelectorAll('[class*="ms-"]')];
for (const el of els) {
  if (excl && el.matches(excl)) continue;
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const parts = [el.tagName.toLowerCase(), el.getAttribute('class') || '', [r.x, r.y, r.width, r.height].map(r1).join(',')];
  for (const p of PROPS) parts.push(cs.getPropertyValue(p));
  for (const n of cs.animationName.split(',')) if (n.trim() !== 'none') used.add(n.trim());
  for (const pe of ['::before', '::after']) {
    const ps = getComputedStyle(el, pe);
    const c = ps.getPropertyValue('content');
    if (c === 'none' || c === 'normal') continue;
    parts.push(pe + ':' + PSEUDO.map((p) => ps.getPropertyValue(p)).join('|'));
    for (const n of ps.animationName.split(',')) if (n.trim() !== 'none') used.add(n.trim());
  }
  lines.push(parts.join('|'));
}

// ---- keyframes referenced but not defined (a split stylesheet that lost its @keyframes) ----
const defined = new Set();
const walk = (rules) => {
  for (const rule of rules) {
    if (rule.type === CSSRule.KEYFRAMES_RULE) defined.add(rule.name);
    else if (rule.cssRules) walk(rule.cssRules);
  }
};
for (const sh of document.styleSheets) {
  try {
    walk(sh.cssRules);
  } catch {
    /* cross-origin sheet */
  }
}
const missingKeyframes = [...used].filter((n) => !defined.has(n)).sort();

// ---- restore the page ----
for (const { a, t, state } of saved) {
  try {
    if (state === 'finished') a.finish();
    else {
      a.currentTime = t;
      if (state === 'running') a.play();
    }
  } catch {
    /* gone */
  }
}

const chunks = [];
for (let i = 0; i < lines.length; i += O.chunk) chunks.push(fnv(lines.slice(i, i + O.chunk).join('\n')));
const out = { n: lines.length, hash: fnv(lines.join('\n')), chunks: chunks.join(' '), missingKeyframes, vp: `${innerWidth}x${innerHeight}@${devicePixelRatio}` };
if (O.full) out.lines = lines;
return out;
