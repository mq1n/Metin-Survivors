
import { existsSync, readdirSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { modelsDir, repoRoot } from '../src/core/export/manifest.ts';

const port = Number(process.argv[2] ?? process.env.FORGE_PORT ?? 5290);
const tmpDir = join(repoRoot(), '.research', 'forge', 'tmp');
const here = import.meta.dir;

async function bundle(): Promise<string> {
  const r = await Bun.build({ entrypoints: [join(here, 'main.ts')], target: 'browser', format: 'esm', minify: false });
  if (!r.success) throw new Error(r.logs.map(String).join('\n'));
  return r.outputs[0]!.text();
}
let js = await bundle(); // fail fast on bundle errors

function listModels(): { label: string; url: string }[] {
  const out: { label: string; url: string }[] = [];
  if (existsSync(tmpDir)) for (const f of readdirSync(tmpDir)) if (f.endsWith('.glb')) out.push({ label: `tmp/${f}`, url: `/tmp/${f}` });
  const md = modelsDir();
  if (existsSync(md)) {
    for (const kind of readdirSync(md)) {
      const kd = join(md, kind);
      for (const f of readdirSync(kd)) if (f.endsWith('.glb')) out.push({ label: `${kind}/${f.replace(/\.[0-9a-f]{6,}\.glb$/, '')}`, url: `/models/${kind}/${f}` });
    }
  }
  return out;
}

Bun.serve({
  port,
  async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === '/' || u.pathname === '/index.html') {
      // version the script URL so a long-lived browser never serves a stale bundle
      const html = (await Bun.file(join(here, 'index.html')).text()).replace('/viewer.js', `/viewer.js?v=${Date.now()}`);
      return new Response(html, { headers: { 'content-type': 'text/html', 'cache-control': 'no-store' } });
    }
    if (u.pathname === '/viewer.js') {
      js = await bundle(); // always rebuild: dev tool, ~100 ms
      return new Response(js, { headers: { 'content-type': 'text/javascript', 'cache-control': 'no-store' } });
    }
    if (u.pathname === '/api/models') return Response.json(listModels());
    let file: string | null = null;
    if (u.pathname.startsWith('/tmp/')) file = join(tmpDir, normalize(u.pathname.slice(5)).replace(/^(\.\.[\\/])+/, ''));
    else if (u.pathname.startsWith('/research/')) file = join(repoRoot(), '.research', normalize(u.pathname.slice(10)).replace(/^(\.\.[\\/])+/, ''));
    else if (u.pathname.startsWith('/models/')) file = join(modelsDir(), normalize(u.pathname.slice(8)).replace(/^(\.\.[\\/])+/, ''));
    if (file && existsSync(file)) return new Response(Bun.file(file), { headers: { 'cache-control': 'no-store' } });
    return new Response('not found', { status: 404 });
  },
});
console.log(`forge viewer on http://localhost:${port}/`);
