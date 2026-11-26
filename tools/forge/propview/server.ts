// bun tools/forge/propview/server.ts [port]  — static-prop viewer (game-like lighting, shadow frustum sized to the model).

import { existsSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { modelsDir, repoRoot } from '../src/core/export/manifest.ts';

const port = Number(process.argv[2] ?? process.env.PROPVIEW_PORT ?? 5291);
const tmpDir = join(repoRoot(), '.research', 'forge', 'tmp');
const here = import.meta.dir;

async function bundle(): Promise<string> {
  const r = await Bun.build({ entrypoints: [join(here, 'view.ts')], target: 'browser', format: 'esm', minify: false });
  if (!r.success) throw new Error(r.logs.map(String).join('\n'));
  return r.outputs[0]!.text();
}
await bundle();

Bun.serve({
  port,
  async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === '/' || u.pathname === '/index.html') {
      const html = (await Bun.file(join(here, 'index.html')).text()).replace('/view.js', `/view.js?v=${Date.now()}`);
      return new Response(html, { headers: { 'content-type': 'text/html', 'cache-control': 'no-store' } });
    }
    if (u.pathname === '/view.js') return new Response(await bundle(), { headers: { 'content-type': 'text/javascript', 'cache-control': 'no-store' } });
    let file: string | null = null;
    const clean = (p: string): string => normalize(p).replace(/^(\.\.[\\/])+/, '');
    if (u.pathname.startsWith('/tmp/')) file = join(tmpDir, clean(u.pathname.slice(5)));
    else if (u.pathname.startsWith('/research/')) file = join(repoRoot(), '.research', clean(u.pathname.slice(10)));
    else if (u.pathname.startsWith('/models/')) file = join(modelsDir(), clean(u.pathname.slice(8)));
    if (file && existsSync(file)) return new Response(Bun.file(file), { headers: { 'cache-control': 'no-store' } });
    return new Response('not found', { status: 404 });
  },
});
console.log(`prop viewer on http://localhost:${port}/`);
