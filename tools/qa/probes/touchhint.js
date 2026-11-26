// touchhint.js — touch + safe-area hygiene (C1.7 / C8):
//   hints   visible keyboard sentences on a touch layout (.ms-touch): "Press …", "Click or press …", key-only hints
//   safe    with a simulated notch / home indicator (--safe-t / --safe-b set on .ms-ui, default 47 / 34 px) every visible
//           action row must end at least safe-b + 8 px above the viewport bottom, and modal heads start below safe-t
// The default `rows` / `heads` selectors list the action bars and head bands of the REBUILT screens (the old list predated the rebuild and matched
// nothing on most of them): level-up / essence / chest / boss reward, story, run end, pause, settings, hero select, zone select, co-op, leaderboard,
// the HUD taskbar buttons (.ms-tb-btns; the strip box itself bleeds to the screen edge by design). A selector that matches nothing is harmless; add the root of a new screen's footer / head band to the lists (or pass
// __probeOpts.rows / .heads). For the four sides (left / right insets in landscape) use safe4.js.
// Returns { touch, hints: [{ el, text }], safe: { b, t, rows: [{ el, gap, btnGap?, btn?, ok, comfy? }], heads: [...] } } (rows with buttons are judged on the buttons).
const O = Object.assign({ wait: 700, settle: true, safeB: 34, safeT: 47, rows: '.ms-cm-actions, .ms-cm-bottom, .ms-pause-actions, .ms-story-actions, .ms-story-foot, .ms-re-actions, .ms-modal-foot, .ms-chest-prompt, .ms-rw-actions, .ms-rw-bottom, .ms-lu-actions, .ms-lu-bottom, .ms-ess-foot, .ms-hs-actions, .ms-hs-dock, .ms-zs-cta, .ms-zs-dfoot, .ms-co-dock, .ms-co-gatefoot, .ms-lb-foot, .ms-lb-actions, .ms-set-foot, .ms-menu-dock, .ms-kdlg-foot, .ms-coll-foot, .ms-tb-btns', heads: '.ms-cm-head, .ms-pause-top, .ms-pause-head, .ms-story-head, .ms-story-frame, .ms-re-head, .ms-re-banner, .ms-modal-head, .ms-ess-head, .ms-chest-head, .ms-boss-head, .ms-hs-head, .ms-zs-head, .ms-lb-banner, .ms-arm-top, .ms-menu-top, .ms-bt-top, .ms-hud-tl, .ms-hud-tr, .ms-hud-tmp' }, window.__probeOpts || {});
await document.fonts.ready;
await new Promise((r) => setTimeout(r, O.wait));
// finite animations that are still running (a footer sliding in, a deal-in) are finished first, as overflow.js does: the run-end footer read btnGap 21 / 36 px
// 0.7 s after the apply and 32 / 51 px at rest. Animations of another timeline (the scroll-driven edge fades) are left alone; infinite ones throw and are skipped.
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
const ui = document.querySelector('.ms-ui');
if (!ui) return { error: 'no .ms-ui' };
const label = (el) => `${el.tagName.toLowerCase()}${el.classList.length ? '.' + [...el.classList].slice(0, 3).join('.') : ''}`;
const shown = (el) => {
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false;
  }
  return true;
};
const touch = ui.classList.contains('ms-touch');
const KEY = /\b(press|click)\b|tuşlarına bas|tuşuna bas|'a bas\b|enter'a|bir tuşa/i;
const hints = [];
// prose is not an instruction to the player: story chapters, codex lore / articles, the zone chronicle, card flavour and tooltip lore ('press' / 'click' in a
// codex paragraph is a word of the story) are skipped; the hint classes the probe is after are UI sentences
const PROSE = '.ms-lore, .ms-story, .ms-story-text, .ms-cdx-lore, .ms-cdx-intro, .ms-cdx-article, .ms-cdx-reading, .ms-cdx-story, .ms-zs-parch, .ms-card-flav, .ms-tip-lore';
if (touch) {
  const walker = document.createTreeWalker(ui, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const s = n.textContent.trim();
    if (s && KEY.test(s) && n.parentElement && !n.parentElement.closest(PROSE) && shown(n.parentElement)) hints.push({ el: label(n.parentElement), text: s.slice(0, 60) });
  }
}
const prevB = ui.style.getPropertyValue('--safe-b');
const prevT = ui.style.getPropertyValue('--safe-t');
ui.style.setProperty('--safe-b', `${O.safeB}px`);
ui.style.setProperty('--safe-t', `${O.safeT}px`);
await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
// A row BOX that reaches the screen edge is fine when its own inset padding keeps the BUTTONS clear of the home indicator (the HUD strip, the card-modal
// bars): so the lowest visible button / link / tab inside each row is measured too (the 2026-10-22 gate's rowgap.js). `gap` = box bottom to the viewport
// bottom, `btnGap` = lowest button bottom to the viewport bottom; `ok` is decided on the buttons when the row has any (>= safe-b), else on the box
// (>= safe-b + 8); `comfy` = the buttons also clear the inset by 8 px.
const SEL = 'button, a[href], [role="button"], [role="tab"], [data-nav]';
const rows = [];
for (const el of document.querySelectorAll(O.rows)) {
  if (!shown(el)) continue;
  const r = el.getBoundingClientRect();
  const gap = Math.round(innerHeight - r.bottom);
  let low = null;
  for (const b of el.querySelectorAll(SEL)) {
    if (!shown(b)) continue;
    const br = b.getBoundingClientRect();
    if (br.top >= innerHeight) continue;
    if (!low || br.bottom > low.bottom) low = { bottom: br.bottom, el: label(b), text: (b.textContent || b.getAttribute('aria-label') || '').trim().slice(0, 20) };
  }
  if (!low) {
    rows.push({ el: label(el), gap, ok: gap >= O.safeB + 8 });
    continue;
  }
  const btnGap = Math.round(innerHeight - low.bottom);
  rows.push({ el: label(el), gap, btnGap, btn: `${low.el} '${low.text}'`, ok: btnGap >= O.safeB - 1, comfy: btnGap >= O.safeB + 8 });
}
const heads = [];
for (const el of document.querySelectorAll(O.heads)) {
  if (!shown(el)) continue;
  const r = el.getBoundingClientRect();
  heads.push({ el: label(el), top: Math.round(r.top), ok: r.top >= O.safeT });
}
if (prevB) ui.style.setProperty('--safe-b', prevB);
else ui.style.removeProperty('--safe-b');
if (prevT) ui.style.setProperty('--safe-t', prevT);
else ui.style.removeProperty('--safe-t');
return { touch, hints, safe: { b: O.safeB, t: O.safeT, rows, heads } };
