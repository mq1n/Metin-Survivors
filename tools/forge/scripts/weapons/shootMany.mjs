// Weapons screenshot helper (eval `browser` global):
//   const { shootMany, montage } = await import('<repo>/tools/forge/scripts/weapons/shootMany.mjs');
//   const files = await shootMany(browser, [{ name:'a', src:'/tmp/a.glb', preset:'portrait', yaw:0 }, ...], { outDir, width, height });
import { copyFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = new URL('../../../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');

export async function shootMany(browser, items, o = {}) {
  const port = o.port ?? 5290;
  const w = o.width ?? 900, h = o.height ?? 900;
  const outDir = o.outDir ?? join(ROOT, '.research', 'forge', 'weapons');
  mkdirSync(outDir, { recursive: true });
  const tab = await browser.open({ name: 'weapons-shoot', url: 'about:blank', viewport: { width: w, height: h, deviceScaleFactor: 1 } });
  const written = [];
  try {
    for (const it of items) {
      const q = new URLSearchParams({ src: it.src, clip: it.clip ?? 'idle', preset: it.preset ?? 'portrait', ui: '0' });
      if (it.yaw !== undefined) q.set('yaw', String(it.yaw));
      if (it.wire) q.set('wire', '1');
      await tab.goto(`http://localhost:${port}/?${q}`);
      for (let i = 0; i < 60; i++) {
        if (await tab.evaluate('window.__ready === true')) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      const path = join(outDir, `${it.name}.png`);
      const tmp = await tab.screenshot({ format: 'png', silent: true });
      copyFileSync(tmp, path);
      written.push(path);
    }
  } finally {
    await tab.close();
  }
  return written;
}

export function montage(out, files, cols = 4, tileWidth = 400) {
  const r = spawnSync('python', [join(ROOT, 'tools', 'forge', 'scripts', 'montage.py'), out, String(cols), String(tileWidth), ...files], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return out;
}
