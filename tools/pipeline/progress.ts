

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..');
const RESEARCH = join(ROOT, '.research');
const OUT_DIR = join(RESEARCH, 'progress');
const OUT = join(OUT_DIR, 'index.html');
const IMG = /\.(png|jpe?g|webp|gif)$/i;

interface FileInfo {
  path: string;
  mtime: number;
}

function walk(dir: string, depth = 4): FileInfo[] {
  if (!existsSync(dir) || depth < 0) return [];
  const out: FileInfo[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'progress' || name === 'raw' || name === 'frames') continue;
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) out.push(...walk(p, depth - 1));
    else out.push({ path: p, mtime: st.mtimeMs });
  }
  return out;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const rel = (p: string) => relative(OUT_DIR, p).replace(/\\/g, '/');
const ago = (ms: number) => {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 90) return `${s}s`;
  if (s < 5400) return `${Math.round(s / 60)}m`;
  return `${(s / 3600).toFixed(1)}h`;
};

function tail(path: string, lines: number): string {
  const text = readFileSync(path, 'utf8').trimEnd().split(/\r?\n/);
  return text.slice(-lines).join('\n');
}

function render(): string {
  const agentsDir = join(RESEARCH, 'agents');
  const agents = existsSync(agentsDir)
    ? readdirSync(agentsDir)
        .filter((f) => f.endsWith('.md'))
        .map((f) => ({ name: f.replace(/\.md$/, ''), path: join(agentsDir, f), mtime: statSync(join(agentsDir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)
    : [];

  const gauntletDir = join(RESEARCH, 'gauntlet');
  const pieces = existsSync(gauntletDir)
    ? readdirSync(gauntletDir).filter((d) => statSync(join(gauntletDir, d)).isDirectory())
    : [];

  const reports = walk(RESEARCH, 2).filter((f) => /REPORT\.md$|LAB\.md$/.test(f.path));
  const images = walk(RESEARCH, 4)
    .filter((f) => IMG.test(f.path) && !f.path.includes(`${join('.research', 'bar')}`))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 36);

  const pieceHtml = pieces
    .map((piece) => {
      const files = walk(join(gauntletDir, piece), 2).sort((a, b) => b.mtime - a.mtime);
      const rounds = files.filter((f) => /round-\d+\.md$/.test(f.path));
      const latest = rounds[0];
      const imgs = files.filter((f) => IMG.test(f.path)).slice(0, 4);
      return `<section class="piece"><h3>${esc(piece)} <small>${rounds.length} round(s)${latest ? ` · ${ago(latest.mtime)} ago` : ''}</small></h3>
${latest ? `<pre>${esc(tail(latest.path, 18))}</pre>` : '<p class="muted">no rounds yet</p>'}
<div class="imgs">${imgs.map((i) => `<a href="${rel(i.path)}"><img src="${rel(i.path)}" loading="lazy"></a>`).join('')}</div></section>`;
    })
    .join('\n');

  const agentHtml = agents
    .map(
      (a) => `<section class="agent"><h3>${esc(a.name)} <small>${ago(a.mtime)} ago</small></h3><pre>${esc(tail(a.path, 14))}</pre></section>`,
    )
    .join('\n');

  const reportHtml = reports
    .sort((a, b) => b.mtime - a.mtime)
    .map((r) => `<li><a href="${rel(r.path)}">${esc(relative(RESEARCH, r.path).replace(/\\/g, '/'))}</a> <small>${ago(r.mtime)} ago</small></li>`)
    .join('');

  const imgHtml = images
    .map(
      (i) =>
        `<figure><a href="${rel(i.path)}"><img src="${rel(i.path)}" loading="lazy"></a><figcaption>${esc(relative(RESEARCH, i.path).replace(/\\/g, '/'))} · ${ago(i.mtime)}</figcaption></figure>`,
    )
    .join('');

  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta http-equiv="refresh" content="20">
<title>Metin Survivors — progress</title>
<style>
body{background:#14100c;color:#e8dcc4;font:14px/1.45 system-ui,sans-serif;margin:0;padding:18px 24px}
h1{color:#e0b45a;margin:0 0 4px}h2{color:#c9a24a;border-bottom:1px solid #4a3a26;padding-bottom:4px;margin-top:28px}
h3{margin:0 0 6px;color:#f0d79a}small,.muted{color:#9a8a70;font-weight:normal}
pre{white-space:pre-wrap;background:#0d0a07;border:1px solid #3a2c1c;padding:8px;max-height:260px;overflow:auto;font-size:12px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:14px}
.piece,.agent{background:#1c1610;border:1px solid #3a2c1c;padding:10px;border-radius:6px}
.imgs img{height:120px;margin:4px 4px 0 0;border:1px solid #3a2c1c}
.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}
figure{margin:0}figure img{width:100%;border:1px solid #3a2c1c}figcaption{font-size:11px;color:#9a8a70;word-break:break-all}
a{color:#e0b45a}
</style></head><body>
<h1>Metin Survivors — canlı ilerleme</h1><div class="muted">güncellendi ${new Date().toLocaleString('tr-TR')} · 20 sn'de bir yenilenir</div>
<h2>Gauntlet parçaları</h2><div class="grid">${pieceHtml || '<p class="muted">henüz yok</p>'}</div>
<h2>Ajanlar</h2><div class="grid">${agentHtml || '<p class="muted">henüz log yok</p>'}</div>
<h2>Raporlar</h2><ul>${reportHtml}</ul>
<h2>Son görseller</h2><div class="gallery">${imgHtml}</div>
</body></html>`;
}

function once() {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT, render());
}

once();
console.log(`progress page: ${OUT}`);
if (process.argv.includes('--watch')) setInterval(once, 15_000);
