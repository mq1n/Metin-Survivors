// `kit.demo`: gallery / QA sheet of the 2026-10-19 kit helpers (ringArc, glints, cinders, groundFlare, crackHeat, stain, crater,
// lightShaft, pillarCross, rocks, art smoke + dust). NOT used by the game: `a` picks the sheet (0..5), the helpers sit side by
// side `base` metres apart. Shoot it with tools/qa/vfxstage.ts --ids kit.demo --opts '{"a":2}' (add --legacyKit for the pre-art look).
import { PALETTES } from '../palette';
import { cinders, crackHeat, crater, dustRing, glints, groundFlare, lightShaft, pillarCross, ringArc, rocks, smoke, stain } from './kit';
import type { PresetDef } from './types';

const SHEETS = 6;

export const KIT_DEMO: PresetDef = {
  id: 'kit.demo',
  cat: 'ui',
  desc: 'dev sheet of the soft-kit helpers (not used by the game): `a` = 0 arcs + flare, 1 glints + cinders, 2 crack / stain / crater, 3 shafts + crossed pillars, 4 rocks + smoke, 5 dust ring + ash smoke',
  size: 'radius',
  base: 3,
  palette: 'holy',
  dur: 3,
  loop: false,
  fire(fx, c) {
    const sheet = Math.max(0, Math.min(SHEETS - 1, Math.round(c.a)));
    const r = c.radius;
    const x = c.x;
    const z = c.z;
    const y = c.y;
    const pal = c.pal;
    const dx = r * 1.25;
    const life = Math.max(1.5, c.duration);
    switch (sheet) {
      case 0:
        ringArc(fx, x - dx, z, r * 0.2, r * 0.8, life, pal.main, 0.95, 1.6, 2.2);
        ringArc(fx, x - dx, z, r * 0.12, r * 0.55, life, pal.extra, 0.8, 1.4, -3.2, 0.1);
        groundFlare(fx, x + dx, z, r * 1.0, life, pal.main, 1.6);
        break;
      case 1:
        glints(fx, x - dx, y, z, fx.n(14), r * 0.8, r * 1.2, life * 0.5, life * 0.9, 0.7, pal.core, pal.main);
        cinders(fx, x + dx, y, z, fx.n(28), r * 0.7, 1.6, life * 0.7, life * 1.3, 0.34, 0xffb040, 0x7a3a18, 0, 2.6);
        break;
      case 2:
        crackHeat(fx, x - dx * 1.25, z, r * 0.95, life * 3, 0x1a1210, 0xff8a2a);
        stain(fx, x, z, r * 0.8, life * 3, 0x4a0c10, 0xff7a6a);
        crater(fx, x + dx * 1.25, z, r * 0.85, life * 3, 0x1c1814, 0xb8a888);
        break;
      case 3:
        lightShaft(fx, x - dx, y, z, r * 1.2, r * 2.6, life, pal.main, 0.85, 1.6);
        pillarCross(fx, x + dx, z, r * 0.45, r * 3, life, pal, 1.6);
        break;
      case 4:
        rocks(fx, x - dx, y + 0.6, z, fx.n(9), 5.5, 0.75, 1.4, fx.heightAt(x - dx, z));
        smoke(fx, x + dx, y + 0.2, z, fx.n(10), r * 0.5, 0.8, life * 0.9, life * 1.3, 1.2, 3.0, 0x4a423a, 0.85);
        break;
      default:
        dustRing(fx, x - dx, y, z, fx.n(18), r * 0.9, life * 0.9, PALETTES.dust.main, 0.9, 1.7);
        smoke(fx, x + dx, y + 0.2, z, fx.n(10), r * 0.5, 0.9, life * 0.9, life * 1.3, 1.2, 3.0, PALETTES.ash.smoke, 0.85);
        break;
    }
  },
};
