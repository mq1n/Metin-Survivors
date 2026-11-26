// Gauntlet round helper (run from the `eval` tool, JS, where the `browser` global exists):
//
//   const { prepareRound } = await import('<repo>/tools/painter/scripts/gauntlet.mjs');

//
// Renders ours + the reference in the SAME viewer presets (portrait + game, game cropped around the creature), assigns A/B at random,

import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');

async function grab(browser, src, clip, t, preset, w, h, port) {
  const tab = await browser.open({ name: `gauntlet-${preset}`, url: 'about:blank', viewport: { width: w, height: h, deviceScaleFactor: 1 } });
  try {
    const q = new URLSearchParams({ src, clip, preset, ui: '0', t: String(t) });
    await tab.goto(`http://localhost:${port}/?${q}`);
    for (let i = 0; i < 80; i++) {
      if (await tab.evaluate('window.__ready === true')) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    return await tab.screenshot({ format: 'png', silent: true });
  } finally {
    await tab.close();
  }
}

export async function prepareRound(browser, o) {
  const port = o.port ?? 5290;
  const dir = join(ROOT, '.research', 'gauntlet', o.id, `round-${o.round}`);
  mkdirSync(dir, { recursive: true });
  const presets = o.presets ?? ['portrait', 'game'];
  const shots = { ours: {}, ref: {} };
  for (const preset of presets) {
    const w = 1600, h = 1200; // the harness captures at DPR 1.25 -> 2000x1500
    const a = await grab(browser, o.ours, o.ourClip ?? 'idle', o.ourT ?? 0.3, preset, w, h, port);
    const b = await grab(browser, o.ref, o.refClip ?? 'WAIT', o.refT ?? 0.5, preset, w, h, port);
    const fa = join(dir, `ours_${preset}_full.png`), fb = join(dir, `ref_${preset}_full.png`);
    copyFileSync(a, fa);
    copyFileSync(b, fb);
    shots.ours[preset] = fa;
    shots.ref[preset] = fb;
  }
  const flip = Math.random() < 0.5;
  const assign = flip ? { A: 'ref', B: 'ours' } : { A: 'ours', B: 'ref' };
  const files = [];
  for (const preset of presets) {
    for (const L of ['A', 'B']) {
      const src = shots[assign[L]][preset];
      const dst = join(dir, `${L}_${preset}.png`);
      // game preset: crop a fixed box around the creature (same box for both) and upscale 5x so detail is judgeable
      const crop = preset === 'game' ? (o.gameCrop ?? [975, 668, 240, 180]) : null;
      const py = crop
        ? `from PIL import Image; im=Image.open(r'${src}').convert('RGB').crop((${crop[0]},${crop[1]},${crop[0] + crop[2]},${crop[1] + crop[3]})); im=im.resize((im.width*5,im.height*5),Image.LANCZOS); im.save(r'${dst}')`
        : `from PIL import Image; Image.open(r'${src}').convert('RGB').save(r'${dst}')`;
      const r = spawnSync('python', ['-c', py], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error(r.stderr);
      files.push(dst);
    }
  }
  writeFileSync(join(dir, 'assignment.json'), JSON.stringify({ ...assign, presets, ours: o.ours, ref: o.ref, ourClip: o.ourClip, ourT: o.ourT, refClip: o.refClip, refT: o.refT }, null, 1));
  return { dir, files, assign };
}
