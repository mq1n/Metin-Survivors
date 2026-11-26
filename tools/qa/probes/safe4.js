// safe4.js — simulated device insets on all four sides (--safe-t/-r/-b/-l on .ms-ui), then every visible interactive element and every visible
// text leaf must sit inside the safe rectangle (anything inside a scroller may pass the edge: it scrolls into view). Options: __probeOpts.t/r/b/l (px),
// wait, limit. Portrait iPhone-like: t47 b34 l0 r0 (the defaults). Landscape: t0 b21 l47 r47, e.g. --opts '{"t":0,"b":21,"l":47,"r":47}'.
// Returns { insets, n, offenders: [{ kind: tap|text, el, side: 'l12,b4' (px past the safe edge), text }] }. A screen that sizes itself with raw
// env(safe-area-inset-*) instead of the --safe-* tokens (the old settings card) cannot be moved by this simulation.
const O = Object.assign({ t: 47, r: 0, b: 34, l: 0, wait: 700, limit: 12, reapply: true }, window.__probeOpts || {});
await document.fonts.ready;
const ui = document.querySelector('.ms-ui');
if (!ui) return { error: 'no .ms-ui' };
const prev = {};
for (const k of ['t', 'r', 'b', 'l']) {
  prev[k] = ui.style.getPropertyValue(`--safe-${k}`);
  ui.style.setProperty(`--safe-${k}`, `${O[k]}px`);
}
await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
// the scenario is applied AGAIN with the insets on (as run.ts --insets does): a layout that reads the insets at render time or places widgets from measured rects
// (the boss-reward note under the shelf, the HUD edge arrows) is otherwise judged with the inset-free first render. The gallery keeps the current id in the URL.
// { reapply: false } keeps the page as it is (a real game page has no __ui).
if (O.reapply && window.__ui && typeof window.__ui.apply === 'function') {
  const id = new URL(location.href).searchParams.get('screen');
  if (id) window.__ui.apply(id);
}
await new Promise((r) => setTimeout(r, O.wait));
await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 120))));
const label = (el) => `${el.tagName.toLowerCase()}${el.classList.length ? '.' + [...el.classList].slice(0, 3).join('.') : ''}`;
const shown = (el) => {
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  if (el.closest('[aria-hidden="true"]')) return false;
  for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false;
  }
  return true;
};
// elements inside a scroller are allowed to pass the edge (they scroll into the safe area)
const inScroller = (el) => {
  for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
    const cs = getComputedStyle(e);
    if (/(auto|scroll)/.test(cs.overflowX + cs.overflowY) && (e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1)) return true;
  }
  return false;
};
const SEL = 'button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="slider"], [role="switch"], [data-nav]';
const safe = { l: O.l, t: O.t, r: innerWidth - O.r, b: innerHeight - O.b };
const out = [];
const check = (el, kind) => {
  const r = el.getBoundingClientRect();
  if (r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) return; // off-screen: overflow probe's job
  const over = { l: Math.round(safe.l - r.left), t: Math.round(safe.t - r.top), r: Math.round(r.right - safe.r), b: Math.round(r.bottom - safe.b) };
  const worst = Object.entries(over).filter(([, v]) => v > 1).sort((a, b) => b[1] - a[1]);
  if (worst.length && !inScroller(el)) out.push({ kind, el: label(el), side: worst.map(([k, v]) => `${k}${v}`).join(','), text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24) });
};
for (const el of new Set(ui.querySelectorAll(SEL))) if (shown(el) && getComputedStyle(el).pointerEvents !== 'none') check(el, 'tap');
for (const el of ui.querySelectorAll('*')) {
  if (el.closest(SEL)) continue;
  const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  if (own && shown(el)) check(el, 'text');
}
for (const k of ['t', 'r', 'b', 'l']) {
  if (prev[k]) ui.style.setProperty(`--safe-${k}`, prev[k]);
  else ui.style.removeProperty(`--safe-${k}`);
}
return { insets: O, n: out.length, offenders: out.slice(0, O.limit) };
