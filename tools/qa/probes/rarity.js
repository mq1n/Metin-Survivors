// rarity.js — IconSlot rarity cascade (C1.2): every `.ms-slot.ms-r-<tier>` must compute --rc / --rg of its tier, not the
// bronze slot default. Expected colours are read from the UI root tokens (--r-common … --r-legendary).
// Returns { checked, ok, bad: [{ el, tier, rc, want, rg }], byTier }.
const O = Object.assign({ wait: 600, limit: 20, sel: '.ms-slot[class*="ms-r-"]' }, window.__probeOpts || {});
await document.fonts.ready;
await new Promise((r) => setTimeout(r, O.wait));
const root = document.querySelector('.ms-ui');
if (!root) return { error: 'no .ms-ui' };
const norm = (s) => s.trim().toLowerCase().replace(/\s+/g, '');
const rs = getComputedStyle(root);
const tiers = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
const want = Object.fromEntries(tiers.map((t) => [t, norm(rs.getPropertyValue(`--r-${t}`))]));
const bad = [];
const byTier = {};
let ok = 0;
let checked = 0;
for (const el of document.querySelectorAll(O.sel)) {
  const tier = tiers.find((t) => el.classList.contains(`ms-r-${t}`));
  if (!tier) continue;
  const cs = getComputedStyle(el);
  const rc = norm(cs.getPropertyValue('--rc'));
  const rg = norm(cs.getPropertyValue('--rg'));
  checked++;
  byTier[tier] = (byTier[tier] || 0) + 1;
  // an inline --rc (a call site that tints its slot on purpose) is not a cascade failure
  const inline = el.style.getPropertyValue('--rc') !== '';
  if (rc === want[tier] || inline) ok++;
  else bad.push({ el: [...el.classList].slice(0, 4).join('.'), tier, rc, want: want[tier], rg });
}
return { checked, ok, bad: bad.slice(0, O.limit), byTier };
