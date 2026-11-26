// Player/enemy combat feedback, pickups, chests: hit.player, player.*, enemy.*, pickup.*, chest.* (owner: VfxFeedback).
// Legacy barrel since the C0 ownership split: [hit.*, player.*] → vfx/common/player-feedback, [player.*] → vfx/common/levelup-heal, [enemy.*] → vfx/common/enemy-projectiles, [enemy.*] → vfx/common/ambient, [chest.*, pickup.*] → vfx/common/pickups. FEEDBACK_PRESETS keeps the original ids and
// order for presets/index.ts, tests and tools.

import { AMBIENT } from '../common/ambient';
import { ENEMY_PROJECTILES } from '../common/enemy-projectiles';
import { LEVELUP_HEAL } from '../common/levelup-heal';
import { PICKUPS } from '../common/pickups';
import { PLAYER_FEEDBACK } from '../common/player-feedback';
import { pickPresets } from '../common/registry';
import { PALETTES } from '../palette';
import { FO, PAT, TAU, chunks, dustRing, embers, fireBurst, flash, glow, haloRing, scorch, shockRing, smokeBurst, sparks } from './kit';
import type { PresetDef } from './types';

function explode(): PresetDef {
  return {
    id: 'enemy.explode',
    cat: 'area',
    desc: 'Fiery explosion (bomber attack / death): flash, fireballs, smoke, double shockwave, sparks, embers, glowing debris, scorch. scale multiplies the 3 m blast.',
    size: 'mult',
    base: 3,
    palette: 'fire',
    variants: false,
    dur: 0,
    loop: false,
    demo: {},
    fire(fx, c) {
      const p = c.pal;
      const rng = fx.rng;
      const s = c.scale;
      const R = c.radius;
      const x = c.x, y = c.y, z = c.z;
      const cy = y + 0.7 * s;
      flash(fx, x, cy, z, R * 0.9, R * 0.25, 0.1, p.core, 3.5);
      glow(fx, x, cy, z, R * 1.7, R * 1.0, 0.38, p.main, 0.6, 1.3);
      for (let k = 0; k < 5; k++) {
        const a = rng.f() * TAU;
        const r = rng.r(0, k < 3 ? 0.25 : 0.5) * R;
        fireBurst(fx, x + Math.sin(a) * r, cy + rng.r(-0.1, 0.5) * s, z + Math.cos(a) * r, R * (k < 3 ? rng.r(0.85, 1.2) : rng.r(0.6, 0.8)), rng.r(0.5, 0.75), p, 2, k < 3 ? k * 0.03 : 0.1 + k * 0.04);
      }
      for (let k = 0; k < 3; k++) {
        const a = rng.f() * TAU;
        smokeBurst(fx, x + Math.sin(a) * R * 0.2, cy + 0.2 * s, z + Math.cos(a) * R * 0.2, R * rng.r(0.8, 1.1), rng.r(0.9, 1.3), 0x6a5646, 0x1c1612, 0.8, 0.12 + k * 0.05, 0.9);
      }
      shockRing(fx, x, z, R * 1.25, 0.45, p, 0.22, 2);
      shockRing(fx, x, z, R * 0.85, 0.38, p, 0.14, 1.4, 0.05);
      haloRing(fx, x, cy, z, R * 0.3, R * 2.1, 0.3, p.main, 0.6, 1.5);
      dustRing(fx, x, y, z, fx.n(8), R * 1.1, 0.7, PALETTES.dust.main, 0.45, 1.1 * s);
      sparks(fx, x, cy, z, fx.n(16), 5 * s, 13 * s, 1.4, 0.3, 0.65, 0.12 * s, p.core, p.edge, 0, 0, 1, 2.6, -10);
      embers(fx, x, cy, z, fx.n(8), R * 0.5, 2.2, 0.8, 1.5, 0.2 * s, p.core, p.edge, 0.05);
      chunks(fx, x, cy, z, fx.n(6), R * 1.5, 0.15 * s, 0x4a3a2c, 0x2a2018, 0.4, 1.2, y);
      chunks(fx, x, cy, z, fx.n(3), R * 1.3, 0.1 * s, p.main, p.edge, 1.4, 1.0, y);
      scorch(fx, x, z, R * 0.8, 5, 0x14100c, p.edge);
      if (fx.detail >= 2) fx.shp.ground(x, z, 0.05).disk(R * 0.85).pat(PAT.cracks).life(1.4).col(p.edge, 1, p.edge, 1).int(1.0).fade(FO.late).seed(rng.f() * 9).emit();
      fx.shake(0.22 * s);
    },
  };
}

const LOCAL: PresetDef[] = [
  explode(),
];

export const FEEDBACK_PRESETS: PresetDef[] = pickPresets(
  [
    'hit.player',
    'player.evade',
    'player.shield',
    'player.death',
    'player.revive',
    'enemy.muzzle',
    'enemy.charge',
    'enemy.leap',
    'enemy.explode',
    'pickup.xp',
    'pickup.yeop',
    'pickup.heal',
    'pickup.magnet',
    'pickup.shard',
    'chest.open',
    'chest.open.boss',
  ],
  LOCAL, PLAYER_FEEDBACK.presets, LEVELUP_HEAL.presets, ENEMY_PROJECTILES.presets, AMBIENT.presets, PICKUPS.presets,
);
