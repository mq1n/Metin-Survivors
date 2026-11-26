// tipcheck.js — tooltip ownership (C1.4 / C6). Replays a real mouse entering each target: pointerenter on every ancestor
// (outermost → target, like the browser), then a bubbling pointermove on the target, then reads the tooltip text. A
// wrapper with its own tip must not replace the hovered icon's tip. Default targets: every IconSlot inside .ms-ui
// (__probeOpts.sel to narrow, e.g. '.ms-hs-doc .ms-slot'). Returns { targets, distinct, items: [{ el, tip }] }.
const O = Object.assign({ wait: 600, sel: '.ms-ui .ms-slot', limit: 24 }, window.__probeOpts || {});
await document.fonts.ready;
await new Promise((r) => setTimeout(r, O.wait));
const root = document.querySelector('.ms-ui');
const label = (el) => `${el.tagName.toLowerCase()}${el.classList.length ? '.' + [...el.classList].slice(0, 3).join('.') : ''}`;
const fire = (el, type, x, y, bubbles) => el.dispatchEvent(new PointerEvent(type, { bubbles, cancelable: true, composed: true, pointerType: 'mouse', isPrimary: true, clientX: x, clientY: y }));
const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const items = [];
const targets = [...document.querySelectorAll(O.sel)].filter((el) => el.getBoundingClientRect().width > 0).slice(0, O.limit);
for (const el of targets) {
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const chain = [];
  for (let e = el; e && e !== root; e = e.parentElement) chain.unshift(e);
  for (const e of chain) fire(e, 'pointerenter', x, y, false);
  fire(el, 'pointermove', x + 1, y + 1, true);
  await frame();
  const tip = document.querySelector('.ms-tip');
  items.push({ el: label(el), tip: tip ? tip.innerText.replace(/\s+/g, ' ').trim().slice(0, 70) : null });
  for (const e of chain.reverse()) fire(e, 'pointerleave', x, y, false);
  await frame();
}
const texts = items.map((i) => i.tip).filter(Boolean);
return { targets: items.length, distinct: new Set(texts).size, items };
