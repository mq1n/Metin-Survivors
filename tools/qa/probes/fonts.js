// fonts.js — type stack check (C1.5 / C7): which faces the document actually loaded, the display face used by titles,
// and whether body text renders lining numerals. Returns { loaded: [...], decorative, titles: [{ el, family }], numeric }.
const O = Object.assign({ wait: 800, limit: 12 }, window.__probeOpts || {});
await document.fonts.ready;
await new Promise((r) => setTimeout(r, O.wait));
const loaded = [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family.replace(/"/g, '')} ${f.weight} ${f.style}`);
const titles = [];
for (const el of document.querySelectorAll('.ms-title, [class*="-title"], h1, h2')) {
  if (!el.textContent.trim() || el.getBoundingClientRect().width < 1) continue;
  const cs = getComputedStyle(el);
  titles.push({ el: `${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 2).join('.')}`, family: cs.fontFamily.split(',')[0].replace(/["']/g, '').trim(), text: el.textContent.trim().slice(0, 24) });
  if (titles.length >= O.limit) break;
}
const ui = document.querySelector('.ms-ui');
const numeric = ui ? getComputedStyle(ui).fontVariantNumeric : null;
const nums = [...document.querySelectorAll('.ms-num')].slice(0, 3).map((el) => getComputedStyle(el).fontVariantNumeric);
return { loaded: [...new Set(loaded)], decorative: loaded.some((f) => /decorative/i.test(f)), titles, numeric, numClass: nums };
