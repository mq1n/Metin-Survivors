// gauge.js — progress bar fills (C1.3 / C5): the fill glow must be a valid box-shadow (a gradient inside var(--fill) used to
// drop the whole declaration), and no mint fills. Returns { bars: [{ el, variant, boxShadow, fill, glow, mint }], invalid, mint }.
const O = Object.assign({ wait: 500, limit: 40 }, window.__probeOpts || {});
await document.fonts.ready;
await new Promise((r) => setTimeout(r, O.wait));
const MINT = /3fae83|8ff0c0|6fd1a6|rgb\(63, 174, 131\)|rgb\(143, 240, 192\)|rgb\(111, 209, 166\)/i;
const bars = [];
for (const fill of document.querySelectorAll('.ms-bar-fill')) {
  const bar = fill.closest('.ms-bar');
  const cs = getComputedStyle(fill);
  const variant = bar ? ([...bar.classList].find((c) => /^ms-bar--(hp|xp|boss)$/.test(c)) || '').replace('ms-bar--', '') : '';
  const fillVal = bar ? getComputedStyle(bar).getPropertyValue('--fill').trim() : '';
  const glow = bar ? getComputedStyle(bar).getPropertyValue('--fill-glow').trim() : '';
  bars.push({
    el: bar ? [...bar.classList].slice(0, 4).join('.') : 'ms-bar-fill',
    variant,
    boxShadow: cs.boxShadow.slice(0, 90),
    fill: fillVal.slice(0, 70),
    glow: glow.slice(0, 40),
    mint: MINT.test(cs.backgroundImage + fillVal),
  });
}
return { count: bars.length, invalid: bars.filter((b) => b.boxShadow === 'none').length, mint: bars.filter((b) => b.mint).length, bars: bars.slice(0, O.limit) };
