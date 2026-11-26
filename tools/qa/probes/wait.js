// wait.js - a probe that only waits (fonts + __probeOpts.wait ms, default 3000) and reports the page's scroll-driven animations. Use it with run.ts --shots for a
// capture of what a player sees: no probe settles the page with Animation.finish() (overflow.js / contrast.js finish the finite animations of the document timeline
// before they measure, and fontsize / tapsize do not wait at all). Returns { scrollDriven, names, states } (the .ms-edgefade masks run on a ScrollTimeline; states =
// [name, playState, currentTime] of each, so `--probes wait,overflow,wait` shows that a settle step leaves them running).
const O = Object.assign({ wait: 3000 }, window.__probeOpts || {});
await document.fonts.ready;
await new Promise((r) => setTimeout(r, O.wait));
const sd = document.getAnimations().filter((a) => a.timeline && a.timeline !== document.timeline);
return {
  scrollDriven: sd.length,
  names: [...new Set(sd.map((a) => a.animationName || a.id || '?'))].slice(0, 8),
  states: sd.slice(0, 8).map((a) => [a.animationName || a.id || '?', a.playState, a.currentTime == null ? null : String(a.currentTime)]),
};
