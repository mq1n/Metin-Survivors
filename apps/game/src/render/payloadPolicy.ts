// Payload policy switch (ARCHITECTURE §11). A production build streams what a run needs later (creatures of the later time
// bands, the ground's normal maps) behind the first seconds of play. The dev server keeps loading everything with the run
// instead: the QA captures (tools/qa/shot.ts: `--time`, `--boss`, `--still`) expect the complete content right away, and a
// capture must not depend on how long the page has been open. `?payload=1` turns the production behaviour on in dev
// (frame-time probes, tools/qa/payload.ts against the dev server).
let cached: boolean | null = null;

/** true when later content is streamed in the background instead of loading with the run */
export function lazyContent(): boolean {
  if (cached !== null) return cached;
  let on = !import.meta.env.DEV;
  if (!on) {
    try {
      on = typeof location !== 'undefined' && new URLSearchParams(location.search).has('payload');
    } catch {
      on = false;
    }
  }
  cached = on;
  return on;
}
