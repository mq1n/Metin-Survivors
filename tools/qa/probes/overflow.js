// overflow.js — clipped and cut content (G3 / C4 / C8):
//   clipped   overflow hidden|clip boxes whose content is larger than the box (text or children cut off)
//   ellipsis  text-overflow: ellipsis boxes that actually truncate
//   offscreen visible elements reaching outside the viewport while no ancestor scrolls
//   badges    slot rank/hotkey badges, card gems … cut by an ancestor's overflow clip (C4: badges outside the clip)
//   scrollers scrollable boxes (overflow auto|scroll with more content than room) and whether they fade (mask / .ms-scrollfade)
// Decorative layers (aria-hidden, .ms-backdrop*, .ms-motes) are skipped. `.ms-layer` is NOT skipped any more: it is the root of the real HUD
// (div.ms-layer.ms-hud), which this probe never checked before (phone gate 2026-10-22; the decorative .ms-layer of Modal.tsx is aria-hidden anyway).
// Screen-reader-only labels (a 1-2 px box that is clipped: clip / clip-path / overflow, e.g. the icon-only tab and button labels of the phone
// tiers) are not content and are skipped with their subtree, they used to count as ~260 clipped + ellipsis rows. Returns counts + first offenders.
const O = Object.assign({ limit: 20, wait: 500, settle: true, badges: '.ms-slot-rank, .ms-slot-key, .ms-card-gem, .ms-tab-badge, .ms-chip, .ms-card-key' }, window.__probeOpts || {});
await document.fonts.ready;
await new Promise((r) => setTimeout(r, O.wait));
// finite animations that are still running (entry slides, deal-ins) are finished first: a banner caught mid-slide reads as clipped for a moment (infinite ones
// throw and are left alone). Animations that run on another timeline than document.timeline (the scroll-driven .ms-edgefade masks: ScrollTimeline /
// ViewTimeline) are NOT finished: finish() jumps them to their end state, which inverts the fades (start edge on, end edge off) in a capture.
// { settle: false } keeps the page as it is.
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
// screen-reader-only: a box of at most 2 px that is clipped away on purpose (cached per element; the subtree of such a box is skipped as well)
const srCache = new WeakMap();
const srBox = (el) => {
  if (srCache.has(el)) return srCache.get(el);
  const r = el.getBoundingClientRect();
  let v = false;
  if (r.width <= 2 && r.height <= 2) {
    const cs = getComputedStyle(el);
    v = cs.clipPath !== 'none' || (cs.clip !== 'auto' && cs.clip !== '') || /(hidden|clip)/.test(cs.overflowX + cs.overflowY);
  }
  srCache.set(el, v);
  return v;
};
const srOnly = (el) => {
  for (let e = el; e && e !== document.body; e = e.parentElement) if (srBox(e)) return true;
  return false;
};
const skip = (el) => !!el.closest('[aria-hidden="true"], .ms-backdrop, .ms-motes') || srOnly(el);
const shown = (el) => {
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false;
  }
  return true;
};
const scrolls = (cs) => /(auto|scroll)/.test(cs.overflowX + cs.overflowY);
const clips = (cs) => /(hidden|clip)/.test(cs.overflowX + cs.overflowY);
const out = { clipped: [], ellipsis: [], offscreen: [], badges: [], scrollers: [] };
const all = [...root.querySelectorAll('*')].filter((el) => !skip(el));
for (const el of all) {
  const cs = getComputedStyle(el);
  if (!shown(el)) continue;
  const dx = el.scrollWidth - el.clientWidth;
  const dy = el.scrollHeight - el.clientHeight;
  if (scrolls(cs) && (dy > 1 || dx > 1)) {
    const fade = cs.maskImage !== 'none' || cs.webkitMaskImage !== 'none' || el.classList.contains('ms-scrollfade') || !!el.closest('.ms-scrollfade');
    out.scrollers.push({ el: label(el), dy, dx, fade });
  } else if (clips(cs) && (dy > 2 || dx > 2) && el.textContent.trim()) {
    out.clipped.push({ el: label(el), dx, dy, text: el.textContent.trim().slice(0, 30) });
  }
  if (cs.textOverflow === 'ellipsis' && dx > 1) out.ellipsis.push({ el: label(el), text: el.textContent.trim().slice(0, 30) });
}
// off-screen: leaf-ish visible elements outside the viewport with no scrolling ancestor
for (const el of all) {
  if (el.children.length > 3 || !el.textContent.trim() || !shown(el)) continue;
  const r = el.getBoundingClientRect();
  if (r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 && r.left >= -1 && r.top >= -1) continue;
  let scrolled = false;
  for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) if (scrolls(getComputedStyle(e))) scrolled = true;
  if (!scrolled) out.offscreen.push({ el: label(el), rect: [r.left, r.top, r.right, r.bottom].map(Math.round), text: el.textContent.trim().slice(0, 30) });
}
// badges cut by an ancestor clip (C4). A scroll container counts as a clip too, but a badge that is cut TOGETHER WITH its host (the nearest
// ancestor at least 2.5x its area: the slot, the row, the tile) is just a row scrolled half out of view, not a defect: only a badge that is cut
// while its host sits inside the clip is reported.
const lostIn = (r, c) => {
  const w = Math.max(0, Math.min(r.right, c.right) - Math.max(r.left, c.left));
  const h = Math.max(0, Math.min(r.bottom, c.bottom) - Math.max(r.top, c.top));
  return 1 - (w * h) / Math.max(1, r.width * r.height);
};
for (const el of root.querySelectorAll(O.badges)) {
  if (skip(el) || !shown(el)) continue;
  const r = el.getBoundingClientRect();
  let host = null;
  for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
    const b = e.getBoundingClientRect();
    if (b.width * b.height >= 2.5 * r.width * r.height) {
      host = b;
      break;
    }
  }
  for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
    const cs = getComputedStyle(e);
    if (!clips(cs) && !scrolls(cs) && cs.clipPath === 'none') continue;
    const c = e.getBoundingClientRect();
    const lost = lostIn(r, c);
    if (lost > 0.02) {
      if (host && lostIn(host, c) > 0.02) break; // the host is cut by the same box: a row scrolled out of view
      out.badges.push({ el: label(el), by: label(e), lost: Math.round(lost * 100) / 100 });
      break;
    }
  }
}
const cut = (a) => a.slice(0, O.limit);
return {
  counts: { clipped: out.clipped.length, ellipsis: out.ellipsis.length, offscreen: out.offscreen.length, badges: out.badges.length, scrollers: out.scrollers.length, hardScrollers: out.scrollers.filter((s) => !s.fade).length },
  clipped: cut(out.clipped),
  ellipsis: cut(out.ellipsis),
  offscreen: cut(out.offscreen),
  badges: cut(out.badges),
  scrollers: cut(out.scrollers),
};
