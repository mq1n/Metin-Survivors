// UiFx reduced-motion probe (C9, UI core lane D): stubs matchMedia(prefers-reduced-motion) = true, remounts the specimen
// page and reports how many Motes draws happen in 1.2 s (must be 0: only the initial still frames) plus leftover hosts.
const real = window.matchMedia.bind(window);
window.__rmStub = true;
window.matchMedia = (q) => (/prefers-reduced-motion/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false } : real(q));
const id = 'kit-fx-motes';
await window.__ui.apply('menu');
await new Promise((r) => setTimeout(r, 600));
await window.__ui.apply(id);
await new Promise((r) => setTimeout(r, 1500));
// the menu underneath was mounted before the stub: take its ember canvas out so only the specimen canvases are counted
document.querySelectorAll('.ms-fxmotes').forEach((el) => { if (!el.closest('.ms-kit-host')) el.remove(); });
await new Promise((r) => setTimeout(r, 400));
const hosts = document.querySelectorAll('.ms-kit-host').length;
const before = window.__uifx ? window.__uifx.motes.frames : -1;
await new Promise((r) => setTimeout(r, 1200));
const after = window.__uifx ? window.__uifx.motes.frames : -1;
return { id, stubbed: matchMedia('(prefers-reduced-motion: reduce)').matches, hosts, canvases: document.querySelectorAll('.ms-fxmotes canvas').length, drawsInLast1200ms: after - before, totalDraws: after };
