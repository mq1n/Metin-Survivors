// fontsize.js — smallest rendered text (G3 / C7): every visible element with its own text, computed font-size in CSS px.
// Floor: 12 px on desktop, 10.5 px when the short viewport side is < 600 px (phone); override with __probeOpts.min.
// aria-hidden / decorative subtrees are skipped. Returns { min, floor, count, offenders: [{ el, px, text }] } (worst first).
const O = Object.assign({ min: null, limit: 25, wait: 400 }, window.__probeOpts || {});
await document.fonts.ready;
await new Promise((r) => setTimeout(r, O.wait));
const phone = Math.min(innerWidth, innerHeight) < 600;
const floor = O.min ?? (phone ? 10.5 : 12);
const root = document.querySelector('.ms-ui') || document.body;
const label = (el) => `${el.tagName.toLowerCase()}${el.classList.length ? '.' + [...el.classList].slice(0, 3).join('.') : ''}`;
const visible = (el) => {
  if (el.closest('[aria-hidden="true"]')) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false;
  for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false;
  }
  return true;
};
const seen = [];
let min = Infinity;
for (const el of root.querySelectorAll('*')) {
  const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()).join(' ');
  if (!own || !visible(el)) continue;
  const px = parseFloat(getComputedStyle(el).fontSize);
  min = Math.min(min, px);
  if (px < floor) seen.push({ el: label(el), px: Math.round(px * 10) / 10, text: own.slice(0, 40) });
}
seen.sort((a, b) => a.px - b.px);
return { min: Number.isFinite(min) ? Math.round(min * 10) / 10 : null, floor, count: seen.length, offenders: seen.slice(0, O.limit) };
