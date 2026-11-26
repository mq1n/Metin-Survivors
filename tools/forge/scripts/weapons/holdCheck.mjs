// Hero weapon-hold verification (eval `browser` global). Attaches the shipped weapon GLBs (hand frame baked in) to hand_r / hand_l of a
// shipped hero GLB in the shared viewer and screenshots chosen clip/time pairs.
//   const { holdCheck } = await import('./holdCheck.mjs');
//   await holdCheck(browser, [{ hero: 'ninja_m_t1', doctrine: 'A', shots: [{ clip: 'idle', t: 0.4 }, { clip: 'attack', t: 0.26, focus: 'hand_r', dist: 0.7 }] }], { outDir });
// Weapon mapping (hero tier N -> weapon tier N):
//   warrior A twohand (hand_r; the hand_l hand rides the grip via IK) / B warrior_sword; ninja A dagger x2 (hand_l copy rotated 180 deg
//   about Z) / B bow (hand_l); yacha sword; shaman A fan / B bell; wolfman claw x2.
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');

export function manifest() {
  return JSON.parse(readFileSync(join(ROOT, 'apps/game/public/assets/manifest/models.json'), 'utf8'));
}

/** which weapon models a hero carries, per doctrine: { r?: id, l?: id, flipL?: bool } */
export function loadout(hero, doctrine) {
  const [cls, , t] = hero.split('_');
  const n = t.slice(1);
  const w = (f) => `${f}_t${n}`;
  const B = doctrine === 'B';
  switch (cls) {
    case 'warrior': return { r: B ? w('warrior_sword') : w('warrior_twohand') };
    case 'ninja': return B ? { l: w('ninja_bow') } : { r: w('ninja_dagger'), l: w('ninja_dagger'), flipL: true };
    case 'yacha': return { r: w('yacha_sword') };
    case 'shaman': return { r: B ? w('shaman_bell') : w('shaman_fan') };
    case 'wolfman': return { r: w('wolfman_claw'), l: w('wolfman_claw'), flipL: true };
    default: throw new Error(`unknown class ${hero}`);
  }
}

export async function holdCheck(browser, items, o = {}) {
  const port = o.port ?? 5290;
  const w = o.width ?? 800, h = o.height ?? 800;
  const outDir = o.outDir ?? join(ROOT, '.research', 'forge', 'weapons', 'hold');
  mkdirSync(outDir, { recursive: true });
  const man = manifest();
  const url = (id) => {
    const m = man[id];
    if (!m) throw new Error(`not in manifest: ${id}`);
    return `/${m.url.replace(/^assets\//, '')}`;
  };
  const tab = await browser.open({ name: 'hold-check', url: 'about:blank', viewport: { width: w, height: h, deviceScaleFactor: 1 } });
  const written = [];
  try {
    for (const it of items) {
      const doctrine = it.doctrine ?? 'A';
      const lo = loadout(it.hero, doctrine);
      for (const s of it.shots) {
        const q = new URLSearchParams({ src: url(it.hero), clip: s.clip, t: String(s.t), preset: s.preset ?? 'portrait', ui: '0' });
        if (lo.r) q.set('weapon', url(lo.r));
        if (lo.l) q.set('weapon2', url(lo.l));
        if (s.yaw !== undefined) q.set('yaw', String(s.yaw));
        if (s.focus) {
          q.set('focus', s.focus);
          q.set('dist', String(s.dist ?? 0.8));
        }
        await tab.goto(`http://localhost:${port}/?${q}`);
        for (let i = 0; i < 80; i++) {
          if (await tab.evaluate('window.__ready === true')) break;
          await new Promise((r) => setTimeout(r, 200));
        }
        if (lo.flipL) {
          // off-hand copy of a dual weapon: the rig rotates the (X-symmetric) right-hand model 180 degrees about hand Z
          await tab.evaluate(`(() => { const b = window.__scene?.getObjectByName('hand_l'); const wp = b?.children[b.children.length - 1]; if (wp) wp.rotation.z = Math.PI; })()`);
        }
        const tag = `${it.hero}_${doctrine}_${s.clip}_t${s.t}_${s.preset ?? 'portrait'}${s.focus ? `_${s.focus}` : ''}${s.yaw !== undefined ? `_y${s.yaw}` : ''}`;
        const path = join(outDir, `${tag}.png`);
        copyFileSync(await tab.screenshot({ format: 'png', silent: true }), path);
        written.push(path);
      }
    }
  } finally {
    await tab.close();
  }
  return written;
}
