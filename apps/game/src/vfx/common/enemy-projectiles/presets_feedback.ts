// Enemy projectiles + muzzle flashes (common VFX, owner: the enemy-projectiles builder). Moved verbatim from vfx/presets/feedback.ts by the C0 ownership split (no visual
// change): rebuild freely inside vfx/common/enemy-projectiles/ — the preset ids are the contract (see ../README.md).
import { FO, M, SPR, TAU, cinders, embers, flash, glints, glow, smoke, sparks } from '../../presets/kit';
import type { PresetDef } from '../../presets/types';

/**
 * `enemy.muzzle` (the alias `vfx_enemy_bolt`, and the route's fallback for a ranged attacker of an unknown type). Round 1 rebuild:
 * the two red light-sabre rods, the torus ring and the `PAT.beam` cone are gone. The real attack cues are the MAKING / RELEASE /
 * BLOW specs of ./specs.ts (route.ts); this preset is the same family in the legacy kit: a soft hot flash, an element glow, a puff
 * of dark smoke, stretched sparks along the throw and one element flavour (embers / glints / smoke / drops).
 */
function muzzle(): PresetDef {
  return {
    id: 'enemy.muzzle',
    cat: 'ranged',
    desc: 'Enemy ranged attack cue: soft hot flash + element glow + dark smoke puff + stretched sparks along dir at chest height (no rods, no rings), element flavour from the palette variant.',
    size: 'mult',
    base: 0.8,
    palette: 'warn',
    variants: false,
    dur: 0,
    loop: false,
    demo: { dir: 0 },
    fire(fx, c) {
      const p = c.pal;
      const rng = fx.rng;
      const s = c.scale;
      const dx = c.dx, dz = c.dz;
      const my = c.y + 1.0 * s;
      const mx = c.x + dx * 0.45 * s;
      const mz = c.z + dz * 0.45 * s;
      smoke(fx, mx, my, mz, 2, 0.12 * s, 0.4, 0.4, 0.7, 0.35 * s, 0.85 * s, p.smoke, 0.55, 0.0);
      flash(fx, mx, my, mz, 0.9 * s, 0.3 * s, 0.1, p.core, 1.9);
      glow(fx, mx + dx * 0.15 * s, my, mz + dz * 0.15 * s, 1.5 * s, 0.7 * s, 0.24, p.main, 0.75, 1.25);
      for (let k = 0; k < 2; k++) {
        const v = 14 + k * 7;
        fx.add.at(mx, my, mz).vel(dx * v, 0, dz * v).drag(5).size((0.42 - k * 0.2) * s, 0.1 * s).stretch(0.1).life(0.17 + k * 0.03)
          .col(p.core, 1, p.main, 0).int(2.0).spr(SPR.streak).mode(M.streak).fade(0, FO.cubic).emit();
      }
      sparks(fx, mx, my, mz, fx.n(7), 4.5 * s, 10 * s, 0.45, 0.14, 0.3, 0.1 * s, p.core, p.edge, dx, dz, 0.55, 2.2);
      switch (c.element) {
        case 1:
          cinders(fx, mx, my, mz, fx.n(3), 0.15 * s, 1.2, 0.4, 0.7, 0.2 * s, p.core, p.edge, 0.02);
          break;
        case 2:
          glints(fx, mx, my, mz, fx.n(3), 0.3 * s, 0.2, 0.25, 0.4, 0.28 * s, p.core, p.main, 0.0);
          break;
        case 3:
          fx.add.at(mx + dx * 0.5 * s, my, mz + dz * 0.5 * s).size(1.1 * s, 1.5 * s).life(0.1).col(p.core, 1, p.main, 0).int(2.2).spr(SPR.arc0 + rng.i(3)).rot(-c.rot + Math.PI / 2 + rng.s2(0.4)).twinkle().fade(0, FO.cube).emit();
          break;
        case 4:
          smoke(fx, mx, my, mz, 2, 0.1, 0.5, 0.45, 0.8, 0.3 * s, 0.9 * s, p.smoke, 0.6, 0.02);
          break;
        case 5:
          for (let i = 0; i < 2; i++) fx.alp.at(mx, my, mz).vel(dx * 2.5, rng.r(0.4, 1.2), dz * 2.5).size(0.2 * s, 0.1 * s).life(0.45).col(p.main, 0.95, p.edge, 0.7).spr(SPR.drop).grav(-9).fade(0, FO.snap).emit();
          break;
        default:
          embers(fx, mx, my, mz, fx.n(2), 0.12, 0.8, 0.3, 0.5, 0.12 * s, p.core, p.edge, 0.02, 1.6);
          break;
      }
      void TAU;
    },
  };
}

export const presets: PresetDef[] = [
  muzzle(),
];
