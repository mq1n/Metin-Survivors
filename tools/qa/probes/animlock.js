// animlock.js — animation end-state locks (C1.1 / G3). A finished CSS animation with fill forwards|both keeps painting
// its last keyframe; when that frame names opacity/transform explicitly it silently overrides the element's declared
// value (a dim backdrop at .3 renders at 1, a hover lift never moves). For every such animation: value with the fill
// vs value without it (cancel → read → finish). Also:
//   check   selectors whose resting opacity is reported as-is (default: armory backdrop portrait, boss ghost chest)
//   probe   selectors whose transform must follow a later declaration (default .ms-card, the hover lift): an inline
//           transform is applied and the computed value read back; `follows: false` = locked.
// Returns { locks: n, items: [{ el, anim, prop, filled, declared }], check: [...], probe: [...] }.
const O = Object.assign({ wait: 2500, limit: 30, check: ['.ms-chr-portrait.is-backdrop', '.ms-chr-portrait', '.ms-boss-chest'], probe: ['.ms-card'] }, window.__probeOpts || {});
await document.fonts.ready;
// let entry animations finish (finite ones), bounded
const t0 = performance.now();
while (performance.now() - t0 < O.wait) {
  const running = document.getAnimations().filter((a) => {
    const t = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : null;
    return a.playState === 'running' && t && Number.isFinite(t.endTime);
  });
  if (running.length === 0) break;
  await new Promise((r) => setTimeout(r, 120));
}
const label = (el, pe) => `${el.tagName.toLowerCase()}${el.classList.length ? '.' + [...el.classList].slice(0, 3).join('.') : ''}${pe || ''}`;
// identity matrix and `none` render the same (an interpolated end frame reports the matrix form)
const same = (prop, a, b) => (prop === 'opacity' ? Math.abs(Number(a) - Number(b)) < 0.005 : (a === 'none' ? 'matrix(1, 0, 0, 1, 0, 0)' : a) === (b === 'none' ? 'matrix(1, 0, 0, 1, 0, 0)' : b));
const items = [];
for (const a of document.getAnimations()) {
  if (!(a instanceof CSSAnimation) || a.playState !== 'finished') continue;
  const eff = a.effect;
  const fill = eff.getComputedTiming().fill;
  if (fill !== 'forwards' && fill !== 'both') continue;
  const el = eff.target;
  const pe = eff.pseudoElement || undefined;
  if (!el) continue;
  const read = () => {
    const cs = getComputedStyle(el, pe);
    return { opacity: cs.opacity, transform: cs.transform };
  };
  const filled = read();
  try {
    a.cancel();
    const declared = read();
    a.finish();
    for (const prop of ['opacity', 'transform']) {
      if (!same(prop, filled[prop], declared[prop])) items.push({ el: label(el, pe), anim: a.animationName, prop, filled: filled[prop], declared: declared[prop] });
    }
  } catch (e) {
    items.push({ el: label(el, pe), anim: a.animationName, error: String(e).slice(0, 80) });
  }
}
const check = [];
for (const sel of O.check) {
  for (const el of document.querySelectorAll(sel)) check.push({ sel, el: label(el), opacity: getComputedStyle(el).opacity });
}
const probe = [];
for (const sel of O.probe) {
  for (const el of [...document.querySelectorAll(sel)].slice(0, 4)) {
    const before = getComputedStyle(el).transform;
    const prev = el.style.transform;
    el.style.transform = 'translateY(-11px)';
    const after = getComputedStyle(el).transform;
    el.style.transform = prev;
    probe.push({ sel, el: label(el), before, withDeclared: after, follows: after !== before });
  }
}
return { locks: items.length, items: items.slice(0, O.limit), check, probe };
