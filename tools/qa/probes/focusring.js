// focusring.js — keyboard focus ring (C1.8). Switches the UI to keyboard modality (.ms-kbd), focuses the target
// (__probeOpts.sel, else the autofocus element, else the first visible [data-nav]) and reports what draws the ring:
// outline (box-shaped, wrong on painted plates), box-shadow, filter (drop-shadow follows the plate). The focus is kept,
// so `shot.ts ui --eval @tools/qa/probes/focusring.js` captures the focused state.
// Returns { el, outline, boxShadow, filter, plate, rect, ringOutside }.
const O = Object.assign({ wait: 900, sel: null }, window.__probeOpts || {});
await document.fonts.ready;
await new Promise((r) => setTimeout(r, O.wait));
const ui = document.querySelector('.ms-ui');
if (!ui) return { error: 'no .ms-ui' };
ui.classList.add('ms-kbd');
const visible = (el) => el.getBoundingClientRect().width > 0 && getComputedStyle(el).visibility !== 'hidden';
const target = (O.sel && document.querySelector(O.sel)) || [...document.querySelectorAll('[data-autofocus]')].find(visible) || [...document.querySelectorAll('.ms-ui [data-nav]')].find(visible);
if (!target) return { error: 'nothing focusable' };
target.focus();
await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const cs = getComputedStyle(target);
const r = target.getBoundingClientRect();
return {
  el: `${target.tagName.toLowerCase()}.${[...target.classList].slice(0, 4).join('.')}`,
  focused: document.activeElement === target,
  outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineOffset}`,
  boxShadow: cs.boxShadow.slice(0, 120),
  filter: cs.filter.slice(0, 160),
  plate: cs.borderImageSource !== 'none',
  rect: [r.left, r.top, r.width, r.height].map(Math.round),
  ringOutside: cs.outlineStyle !== 'none' || (cs.boxShadow !== 'none' && /0px 0px 0px/.test(cs.boxShadow)),
};
