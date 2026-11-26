// Player-side feedback: aura.ring, dash.streak (common VFX target `player-feedback`; owner: the player-feedback builder).
// r1 (2026-10-19): aura.ring is the persistentAura FxSpec of ./specs_self.ts (same id / flags: loop, follows the player, 900 s);
// dash.streak keeps its classic slot and plays the spec `sk.gen.pf_dash` along the lane (dir + length when no target is given).
import type { Inst } from '../../system';
import type { PresetDef } from '../../presets/types';
import { specPreset } from '../../spec/preset';
import { AURA_RING, DASH } from './specs_self';

function auraRing(): PresetDef {
  return { ...specPreset(AURA_RING), cat: 'melee', size: 'radius', base: 3, variants: true, palette: 'holy', dur: 900, follow: true, demo: { loopFor: 3 } };
}

function dash(): PresetDef {
  return {
    id: 'dash.streak',
    cat: 'melee',
    desc: 'dash: ground-hugging mint speed lane, dust wisps and glints along the path, arrival ring + ray flash. Needs tx,tz (or direction + length).',
    size: 'radius',
    base: 5,
    palette: 'wind',
    variants: true,
    dur: 0,
    loop: false,
    needsTarget: false,
    demo: { dir: 0, target: 5 },
    fire(fx, c) {
      if (!c.hasTarget) {
        c.tx = c.x + c.dx * c.radius;
        c.tz = c.z + c.dz * c.radius;
        c.ty = fx.heightAt(c.tx, c.tz);
        c.hasTarget = true;
      }
      fx.spec?.play(DASH, c, false, c as Inst);
    },
  };
}

export const presets: PresetDef[] = [auraRing(), dash()];
