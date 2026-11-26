// Enemy projectiles + muzzle flashes (common VFX, owner: the enemy-projectiles builder). Moved verbatim from vfx/presets/cast.ts by the C0 ownership split (no visual
// change): rebuild freely inside vfx/common/enemy-projectiles/ — the preset ids are the contract (see ../README.md).
import { FO, SC, SPR, TAU, embers, flash, glow, smoke, sparks } from '../../presets/kit';
import type { PresetDef } from '../../presets/types';

/**
 * `proj.hostile`: the legacy launch flash of a hostile projectile (only aliased from `vfx_boss_bolt`, which the sim never emits;
 * the live launch flash is `sk.gen.ep_release_<look>`). Round 1 rebuild: no dark-outlined donut rings, no torus, no radial starburst;
 * a soft hot flash, an element glow, a puff of smoke and a short spark cone.
 */
function projHostile(): PresetDef {
  return {
    id: 'proj.hostile',
    cat: 'ranged',
    desc: 'enemy launch flash: soft hot flash, element glow, dark smoke puff and a short spark cone (light, many per second); the legacy id of the sk.gen.ep_release_* family.',
    size: 'mult',
    base: 0.5,
    palette: 'boss',
    variants: true,
    dur: 0,
    loop: false,
    demo: { dir: 0 },
    fire(fx, c) {
      const p = c.pal;
      const s = c.scale;
      const k = c.intensity;
      const rng = fx.rng;
      const dx = c.dx, dz = c.dz;
      const mx = c.x + dx * 0.45 * s, mz = c.z + dz * 0.45 * s, my = c.y + 0.9 * Math.min(s, 1.6);
      smoke(fx, mx, my, mz, 1, 0.08 * s, 0.3, 0.35, 0.55, 0.3 * s, 0.7 * s, p.smoke, 0.5, 0.0);
      flash(fx, mx, my, mz, 0.7 * s, 0.22 * s, 0.1, p.core, 1.9 * k);
      glow(fx, mx, my, mz, 1.2 * s, 0.5 * s, 0.22, p.main, 0.8, 1.3 * k);
      fx.add.at(mx, my, mz).size(0.5 * s, 1.0 * s).life(0.14).col(p.main, 1, p.edge, 0).int(1.6 * k).spr(SPR.glow).rot(rng.f() * TAU).fade(0, FO.quad, SC.out).emit();
      sparks(fx, mx, my, mz, fx.n(5), 4 * s, 9 * s, 0.3, 0.12, 0.26, 0.08 * s, p.core, p.edge, dx, dz, 0.7, 2.0 * k, -4);
      embers(fx, mx, my, mz, fx.n(2), 0.2 * s, 1.0, 0.35, 0.6, 0.12 * s, p.core, p.edge, 0, 1.8);
    },
  };
}

export const presets: PresetDef[] = [
  projHostile(),
];
