// tapsize.js — touch targets smaller than 44×44 CSS px (G3 / C3 / C8). Interactive = button, a[href], input, select,
// textarea, [role=button|tab|slider|switch|radio|checkbox], [data-nav], [tabindex>=0]. Visible ones only.
// Returns { touch, count, offenders: [{ el, w, h, text }] } — run it at 390x844 / 844x390 with --touch --mobile.
const O = Object.assign({ min: 44, limit: 30, wait: 400 }, window.__probeOpts || {});
await document.fonts.ready;
await new Promise((r) => setTimeout(r, O.wait));
const root = document.querySelector('.ms-ui') || document.body;
const SEL = 'button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="slider"], [role="switch"], [role="radio"], [role="checkbox"], [data-nav], [tabindex]:not([tabindex="-1"])';
const label = (el) => `${el.tagName.toLowerCase()}${el.classList.length ? '.' + [...el.classList].slice(0, 3).join('.') : ''}`;
const visible = (el) => {
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false;
  // pointer-events is inherited and the UI host itself is `none` (children opt back in): only the element's own value counts
  if (getComputedStyle(el).pointerEvents === 'none') return false;
  for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false;
  }
  return true;
};
const bad = [];
for (const el of new Set(root.querySelectorAll(SEL))) {
  if (!visible(el)) continue;
  let r = el.getBoundingClientRect();
  // kit controls extend their touch area with an invisible `.ms-hit` child (kit.css): the target is the union of both
  for (const h of el.querySelectorAll(':scope > .ms-hit')) {
    if (getComputedStyle(h).pointerEvents === 'none') continue;
    const hr = h.getBoundingClientRect();
    r = { width: Math.max(r.width, hr.width), height: Math.max(r.height, hr.height) };
  }
  if (r.width < O.min || r.height < O.min) bad.push({ el: label(el), w: Math.round(r.width), h: Math.round(r.height), text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30) });
}
bad.sort((a, b) => Math.min(a.w, a.h) - Math.min(b.w, b.h));
return { touch: !!document.querySelector('.ms-touch'), count: bad.length, offenders: bad.slice(0, O.limit) };
