// modalscroll.js — dead scroll in modal bodies (C1.6): for every scroll container of a modal (default .ms-cardmodal and
// other scrolling roots) compare scrollHeight with where the real content ends (children boxes; pseudo-element ray
// layers do not count). Returns [{ el, scrollH, clientH, contentH, dead }] — dead > 0 = blank scroll.
const O = Object.assign({ wait: 900, sel: '.ms-cardmodal, .ms-pause, .ms-story, .ms-re-root, .ms-modal' }, window.__probeOpts || {});
await document.fonts.ready;
await new Promise((r) => setTimeout(r, O.wait));
const out = [];
for (const el of document.querySelectorAll(O.sel)) {
  const r = el.getBoundingClientRect();
  if (r.height < 1) continue;
  let bottom = 0;
  const walk = (node) => {
    for (const c of node.children) {
      const cr = c.getBoundingClientRect();
      if (cr.height > 0 && getComputedStyle(c).position !== 'fixed') bottom = Math.max(bottom, cr.bottom - r.top + el.scrollTop);
      if (c.children.length && getComputedStyle(c).overflow === 'visible') walk(c);
    }
  };
  walk(el);
  const pb = parseFloat(getComputedStyle(el).paddingBottom) || 0;
  const contentH = Math.ceil(bottom + pb);
  out.push({ el: [...el.classList].slice(0, 3).join('.'), scrollH: el.scrollHeight, clientH: el.clientHeight, contentH, dead: Math.max(0, el.scrollHeight - Math.max(contentH, el.clientHeight)) });
}
return out;
