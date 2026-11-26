// Screenshot helper for the prop viewer (run from the eval tool, JS):
//   const { shoot } = await import('<repo>/tools/forge/propview/shoot.mjs');
//   await shoot(browser, { id: 'prop_stone_lantern', views: [{ name: 'three', preset: 'three' }, { name: 'iso', preset: 'iso', human: 1 }] });

import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');

export async function shoot(browser, o) {
  const port = o.port ?? 5291;
  const w = o.width ?? 1100, h = o.height ?? 900;
  const outDir = o.outDir ?? join(ROOT, '.research', 'forge', 'props', o.id);
  mkdirSync(outDir, { recursive: true });
  const tab = await browser.open({ name: `props-${o.id}`, url: 'about:blank', viewport: { width: w, height: h, deviceScaleFactor: 1 } });
  const written = [];
  try {
    for (const v of o.views ?? [{ name: 'three', preset: 'three' }]) {
      const q = new URLSearchParams({ src: o.src ?? `/tmp/${o.id}.glb`, ...Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'name').map(([k, val]) => [k, String(val)])) });
      await tab.goto(`http://localhost:${port}/?${q}`);
      for (let i = 0; i < 80; i++) {
        if (await tab.evaluate('window.__ready === true')) break;
        await new Promise((r) => setTimeout(r, 250));
      }
      const tmp = await tab.screenshot({ format: 'png', silent: true });
      const path = join(outDir, `${v.name ?? v.preset}.png`);
      copyFileSync(tmp, path);
      written.push(path);
    }
    return { written, info: JSON.parse(await tab.evaluate('JSON.stringify(window.__info)')) };
  } finally {
    await tab.close();
  }
}
