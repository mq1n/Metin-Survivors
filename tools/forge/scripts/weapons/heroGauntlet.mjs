



//   const cp = copy this file to a unique name (the eval runtime caches imports by path); const { heroGauntlet } = await import(cp);
//   await heroGauntlet(browser, [{ hero: 'warrior_m_t3', ref: 'warrior_m_s6', dist: 4.6 }], 2);
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { loadout } from './holdCheck.mjs';

const ROOT = new URL('../../../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');
const R = `${ROOT}/.research/`;

const COMPOSE = `
import sys
from PIL import Image
d=sys.argv[1]
P=[Image.open(d+'A_portrait.png').convert('RGB'),Image.open(d+'B_portrait.png').convert('RGB')]
G=[Image.open(d+'A_game.png').convert('RGB'),Image.open(d+'B_game.png').convert('RGB')]
w,h=P[0].size
bg=P[0].getpixel((4,4))
pb=(int(w*0.25),int(h*0.04),int(w*0.75),int(h*0.96))
P=[i.crop(pb) for i in P]
gb=(int(w*0.42),int(h*0.40),int(w*0.58),int(h*0.60))
G=[i.crop(gb).resize((480,int(480*(gb[3]-gb[1])/(gb[2]-gb[0])))) for i in G]
pw,ph=P[0].size
s=Image.new('RGB',(pw*2,ph+G[0].height),bg)
s.paste(P[0],(0,0)); s.paste(P[1],(pw,0))
s.paste(G[0],((pw-480)//2,ph)); s.paste(G[1],(pw+(pw-480)//2,ph))
s.save(d+'pair.png')`;

export async function heroGauntlet(browser, pairs, round, o = {}) {
  const man = JSON.parse(readFileSync(`${ROOT}/apps/game/public/assets/manifest/models.json`, 'utf8'));
  const url = (id) => `/${man[id].url.replace(/^assets\//, '')}`;
  const tab = await browser.open({ name: 'hero-gauntlet', url: 'about:blank', viewport: { width: 1600, height: 1200, deviceScaleFactor: 1 } });
  const key = {};
  try {
    for (const p of pairs) {
      const dir = `${R}gauntlet/${p.hero}/round-${round}/`;
      mkdirSync(dir, { recursive: true });
      const shots = {};
      const lo = loadout(p.hero, p.doctrine ?? 'A');
      const clip = p.doctrine === 'B' ? 'idle_b' : 'idle';
      for (const preset of ['portrait', 'game']) {
        for (const who of ['ours', 'ref']) {
          const q = new URLSearchParams({ preset, ui: '0', t: String(p.t ?? 0.5) });
          if (preset === 'portrait') {
            q.set('focus', who === 'ours' ? 'chest' : 'Spine1');
            q.set('dist', String(p.dist ?? 4.6));
          }
          if (who === 'ours') {
            q.set('src', url(p.hero));
            q.set('clip', clip);
            if (lo.r) q.set('weapon', url(lo.r));
            if (lo.l) q.set('weapon2', url(lo.l));
          } else {
            q.set('src', `/research/gauntlet/heroes/ref/${p.ref}.glb`);
            q.set('clip', 'WAIT');
          }
          await tab.goto(`http://localhost:5290/?${q}`);
          for (let i = 0; i < 100; i++) {
            if (await tab.evaluate('window.__ready === true')) break;
            await new Promise((r) => setTimeout(r, 200));
          }
          if (who === 'ours' && lo.flipL) {
            await tab.evaluate(`(() => { const b = window.__scene?.getObjectByName('hand_l'); const wp = b?.children[b.children.length - 1]; if (wp) wp.rotation.z = Math.PI; })()`);
          }
          const f = `${dir}_${who}_${preset}.png`;
          copyFileSync(await tab.screenshot({ format: 'png', silent: true }), f);
          shots[`${who}_${preset}`] = f;
        }
      }
      const oursFirst = o.oursFirst ?? Math.random() < 0.5;
      const A = oursFirst ? 'ours' : 'ref', B = oursFirst ? 'ref' : 'ours';
      for (const pr of ['portrait', 'game']) {
        copyFileSync(shots[`${A}_${pr}`], `${dir}A_${pr}.png`);
        copyFileSync(shots[`${B}_${pr}`], `${dir}B_${pr}.png`);
      }
      const r = spawnSync('python', ['-c', COMPOSE, dir], { encoding: 'utf8' });
      if (r.stderr) throw new Error(r.stderr);
      key[p.hero] = { A: oursFirst ? p.hero : p.ref, B: oursFirst ? p.ref : p.hero };
    }
  } finally {
    await tab.close();
  }
  const kf = `${R}gauntlet/heroes/round-${round}-key.json`;
  const prev = existsSync(kf) ? JSON.parse(readFileSync(kf, 'utf8')) : {};
  writeFileSync(kf, JSON.stringify({ ...prev, ...key }, null, 1));
  return key;
}
