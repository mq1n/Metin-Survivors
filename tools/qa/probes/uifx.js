// UiFx draw-loop probe (C9, UI core lane D): samples window.__uifx.motes (draw ms per Motes canvas) for `ms` after resetting it.
// bun tools/qa/shot.ts ui --screens kit-fx-motes --delay 3 --eval @tools/qa/probes/uifx.js --out dir
const ms = 4000;
const w = window;
if (w.__uifx) w.__uifx.motes = { frames: 0, avgMs: 0, maxMs: 0 };
let raf = 0, frames = 0, last = performance.now(), worstGap = 0;
const t0 = last;
await new Promise((res) => {
  const f = (now) => { frames++; worstGap = Math.max(worstGap, now - last); last = now; if (now - t0 < ms) raf = requestAnimationFrame(f); else res(); };
  raf = requestAnimationFrame(f);
});
const st = w.__uifx ? w.__uifx.motes : null;
const canvases = document.querySelectorAll('.ms-fxmotes canvas').length;
const out = { canvases, rafFrames: frames, fps: +(frames / (ms / 1000)).toFixed(1), worstGapMs: +worstGap.toFixed(1), motes: st, perFrameEstimateMs: st ? +(st.avgMs * canvases).toFixed(3) : null };
return out;
