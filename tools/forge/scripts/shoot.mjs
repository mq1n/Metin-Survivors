// Screenshot helper for the forge viewer. Run from the `eval` tool (JS) where the `browser` global exists:
//
//   const { shoot } = await import('<repo>/tools/forge/scripts/shoot.mjs');
//   await shoot(browser, { id: 'wolf', src: '/tmp/wolf.glb', presets: ['portrait','side','game'], clips: ['idle'] });
//

import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');

export async function shoot(browser, o) {
  const port = o.port ?? 5290;
  const w = o.width ?? 1280, h = o.height ?? 960;
  const outDir = o.outDir ?? join(ROOT, '.research', 'forge', o.id);
  mkdirSync(outDir, { recursive: true });
  const tab = await browser.open({ name: `forge-${o.id}`, url: 'about:blank', viewport: { width: w, height: h, deviceScaleFactor: 1 } });
  const written = [];
  try {
    for (const clip of o.clips ?? ['idle']) {
      for (const preset of o.presets ?? ['portrait']) {
        const q = new URLSearchParams({ src: o.src, clip, preset, ui: '0' });
        if (o.t !== undefined) q.set('t', String(o.t));
        if (o.yaw !== undefined) q.set('yaw', String(o.yaw));
        if (o.wire) q.set('wire', '1');
        if (o.bones) q.set('bones', '1');
        for (const [k, v] of Object.entries(o.query ?? {})) q.set(k, String(v));
        await tab.goto(`http://localhost:${port}/?${q}`);
        for (let i = 0; i < 60; i++) {
          const ready = await tab.evaluate('window.__ready === true');
          if (ready) break;
          await new Promise((r) => setTimeout(r, 250));
        }
        const path = join(outDir, `${preset}_${clip}${o.suffix ?? ''}.png`);
        const tmp = await tab.screenshot({ format: 'png', silent: true });
        copyFileSync(tmp, path);
        written.push(path);
      }
    }
    const info = await tab.evaluate('JSON.stringify(window.__info)');
    return { written, info: JSON.parse(info) };
  } finally {
    await tab.close();
  }
}

/**
 * Contact sheet of one clip: N frames across the clip, one preset, tiled with scripts/montage.py.
 * await sheet(browser, { id:'wolf', src:'/tmp/wolf.glb', clip:'run', frames:8, preset:'side', cols:4, out:'...png' })
 */
export async function sheet(browser, o) {
  const { spawnSync } = await import('node:child_process');
  const port = o.port ?? 5290;
  const w = o.width ?? 800, h = o.height ?? 600;
  const dir = join(ROOT, '.research', 'forge', o.id, 'frames');
  mkdirSync(dir, { recursive: true });
  const tab = await browser.open({ name: `forge-sheet-${o.id}`, url: 'about:blank', viewport: { width: w, height: h, deviceScaleFactor: 1 } });
  const files = [];
  try {
    const q = new URLSearchParams({ src: o.src, clip: o.clip, preset: o.preset ?? 'side', ui: '0', t: '0' });
    if (o.yaw !== undefined) q.set('yaw', String(o.yaw));
    await tab.goto(`http://localhost:${port}/?${q}`);
    for (let i = 0; i < 80; i++) {
      if (await tab.evaluate('window.__ready === true')) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    const dur = await tab.evaluate(`(window.__info.clips.find(c => c.name === ${JSON.stringify(o.clip)}) || {duration: 1}).duration`);
    const n = o.frames ?? 8;
    for (let i = 0; i < n; i++) {
      const t = (o.t0 ?? 0) + ((o.t1 ?? dur) - (o.t0 ?? 0)) * (i / (o.loop === false ? n - 1 : n));
      await tab.evaluate(`window.__setPose(${JSON.stringify(o.clip)}, ${t})`);
      const tmp = await tab.screenshot({ format: 'png', silent: true });
      const f = join(dir, `${o.clip}_${String(i).padStart(2, '0')}.png`);
      copyFileSync(tmp, f);
      files.push(`${f}::${t.toFixed(2)}s`);
    }
  } finally {
    await tab.close();
  }
  const out = o.out ?? join(ROOT, '.research', 'forge', o.id, `sheet_${o.clip}.png`);
  const r = spawnSync('python', [join(ROOT, 'tools', 'forge', 'scripts', 'montage.py'), out, String(o.cols ?? 4), String(o.tileWidth ?? 400), ...files], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return out;
}






export async function gauntlet(browser, o) {
  const preset = o.preset ?? 'portrait';
  const ours = await shoot(browser, { id: o.id, src: o.src ?? `/tmp/${o.id}.glb`, presets: [preset], clips: [o.ourClip ?? 'idle'], t: o.ourT ?? 0.3, suffix: `_r${o.round}` });
  const theirs = await shoot(browser, { id: `ref_${o.id}`, src: o.ref, presets: [preset], clips: [o.refClip ?? 'WAIT'], t: o.refT ?? 0.5, suffix: `_r${o.round}` });
  const dir = join(ROOT, '.research', 'gauntlet', o.group ?? o.id, `round-${o.round}`);
  mkdirSync(dir, { recursive: true });
  const oursFirst = Math.random() < 0.5;
  copyFileSync(oursFirst ? ours.written[0] : theirs.written[0], join(dir, 'A.png'));
  copyFileSync(oursFirst ? theirs.written[0] : ours.written[0], join(dir, 'B.png'));
  copyFileSync(ours.written[0], join(dir, 'ours_key.png'));
  copyFileSync(theirs.written[0], join(dir, 'ref_key.png'));
  writeFileSync(join(dir, 'assignment.json'), JSON.stringify({ A: oursFirst ? 'ours' : 'baseline-reference', B: oursFirst ? 'baseline-reference' : 'ours', preset, ourClip: o.ourClip ?? 'idle', ourT: o.ourT ?? 0.3, refClip: o.refClip ?? 'WAIT', refT: o.refT ?? 0.5 }, null, 1));
  return { dir, A: oursFirst ? 'ours' : 'reference' };
}
