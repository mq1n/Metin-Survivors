// Bootstrap. Production: boot the App state machine. DEV: ?demo=<name> / ?bench=<name> route to src/dev/demos/*.
type DemoModule = { default: () => Promise<void> | void };

async function main(): Promise<void> {
  // UI gallery (mock store, no engine): DEV, or a build made with VITE_UI_GALLERY=1 (staging review builds). A plain
  // production build neither routes /?ui=gallery nor bundles the gallery (the condition folds to false, the glob goes).
  if ((import.meta.env.DEV || import.meta.env.VITE_UI_GALLERY === '1') && new URLSearchParams(location.search).get('ui') === 'gallery') {
    const galleries = import.meta.glob<{ default: () => Promise<void> | void }>('./ui/gallery.ts');
    const load = galleries['./ui/gallery.ts'];
    if (load) {
      await (await load()).default();
      return;
    }
  }
  if (import.meta.env.DEV) {
    const q = new URLSearchParams(location.search);
    const name = q.get('demo') ?? (q.has('bench') ? `bench-${q.get('bench')}` : null);
    if (name) {
      const demos = import.meta.glob<DemoModule>('./dev/demos/*.ts');
      const loader = demos[`./dev/demos/${name}.ts`];
      if (!loader) throw new Error(`unknown demo "${name}" (have: ${Object.keys(demos).join(', ')})`);
      await (await loader()).default();
      return;
    }
  }
  // Lazy on purpose: render demos/benchmarks must keep working while the sim package is mid-edit, and the
  // app graph (sim, content, UI) stays out of the demo bundles.
  const { boot } = await import('./app/app');
  await boot();
}

main().catch((err: unknown) => {
  console.error(err);
  const el = document.getElementById('ui');
  if (el) {
    el.textContent = `Fatal: ${err instanceof Error ? (import.meta.env.DEV ? (err.stack ?? err.message) : err.message) : String(err)}`;
    el.style.cssText = 'color:#f88;font:14px monospace;padding:16px;white-space:pre-wrap';
    // The UI (and its i18n) may be the thing that failed to load, so this is plain DOM with a fixed bilingual label.
    // Retry = one clean page reload, never a second boot() in this page (it would attach every listener twice); it also
    // fetches a fresh index.html, which fixes the usual cause (a stale chunk/manifest hash after a deploy).
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.id = 'boot-retry';
    retry.textContent = 'Retry / Yeniden dene';
    retry.style.cssText = 'display:block;margin-top:16px;padding:10px 18px;font:14px monospace;cursor:pointer';
    retry.addEventListener('click', () => location.reload());
    el.appendChild(retry);
  }
});
