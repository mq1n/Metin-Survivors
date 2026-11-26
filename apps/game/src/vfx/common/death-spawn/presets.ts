// Enemy death + spawn classic ids (common VFX, owner: the death-spawn builder). Rebuilt r1 (2026-10-19): the old kit presets (flat ellipse
// stacks, lightning-crack decal, prism debris, light pillars, sticker discs, 12 recoloured race pops) are gone. Every id keeps its slot in


// `sk.gen.monster_die` (they are never routed: simFeed maps every creature to sk.gen.monster_die; deprecated for the C11 registry sweep).
import type { Inst } from '../../system';
import { specPreset } from '../../spec/preset';
import type { FxSpec } from '../../spec/types';
import type { PresetDef } from '../../presets/types';
import { appearSpec, corruptSpec, dieSpec } from './elements';
import { MONSTER_DIE } from './specs';

/** elite death: the same smoke, taller and heavier: dark lumps flung out of the cloud past the body, a skirt of dust along the floor and a slow tail rising on (no flash, ring, crack decal or debris) */
export const DEATH_ELITE: FxSpec = dieSpec(
  'death.elite',
  'Elite death: the monster death smoke, bigger and heavier: a tall plum-maroon column, dark lumps flung out past the body, a skirt of dust along the floor and a slow tail rising on; no flash, no ring',
  {
    soft: 8, core: 3, grain: 3, half: 1.3, box: [0.5, 0.4, 0.5], up: 190, life: [0.42, 0.66], alpha: 0.6,
    fling: 6, flingSpeed: 0.022, flingShell: 0.25, flingSize: 0.62, flingAlpha: 0.64,
    skirt: 4, skirtSpeed: 0.016, skirtSize: 0.5, skirtAlpha: 0.5,
    tail: 2, tailLife: 1.0,
  },
);

/** boss death: the same smoke on a bigger body, two bursts, lumps flung out past the outline, a skirt of dust and a slow tail (~1 s) */
export const DEATH_BOSS: FxSpec = dieSpec(
  'death.boss',
  'Boss death: the monster death smoke on a boss body: a big double burst of dark plum-maroon dust, heavy lumps thrown out past the silhouette, a skirt of dust along the floor and a slow rising tail; no flash, no ring, no pillar',
  {
    soft: 10, core: 3, grain: 3, half: 1.2, box: [0.9, 0.6, 0.9], lift: 1.0, up: 170, life: [0.5, 0.78], alpha: 0.6, again: 0.2,
    fling: 10, flingSpeed: 0.03, flingShell: 0.85, flingSize: 0.75, flingAlpha: 0.78,
    skirt: 5, skirtSpeed: 0.02, skirtSize: 0.6, skirtAlpha: 0.66,
    tail: 6, tailLife: 1.1, tailSpread: 1.2,
  },
);

/** elite spawn: the appear vortex bigger and redder, dark smoke boiling up out of it, more red specks */
export const SPAWN_ELITE: FxSpec = appearSpec(
  'spawn.elite',
  'Elite spawn: the monster_appear vortex, bigger and redder: a translucent crimson-violet spiral that thickens into a near-black wine mass, two lit rings (violet then pink) growing out of it, dark smoke boiling up, more red specks',
  { strands: 0x7a1c44, core: 0x240a1a, rim: 0xd890e0, specks: 13, half: 1.25, puffs: 5, alpha: 0.96, rimAlpha: 0.74, rise: 3, twin: true },
  0.8,
);

/** metin swarm spawn: monster_change, dirty grey smoke thrown out of a dark ground patch (not the vortex) */
export const SPAWN_CORRUPT: FxSpec = corruptSpec(
  'spawn.corrupt',
  'Metin swarm spawn: monster_change dirty grey-violet smoke thrown out of a dark grimy ground patch with a turning ragged smoke ring; no vortex, no spiral, never a sticker disc',
  { half: 2.0, puffs: 5 },
);

/** summoned enemy: npc2_appear, the vortex with a pinker violet rim */
export const SPAWN_SUMMON: FxSpec = appearSpec(
  'spawn.summon',
  'Summoned enemy: the monster_appear vortex (npc2_appear colours: a translucent violet spiral thickening into a near-black violet mass, a pale pink-violet lit ring growing out of it, red specks)',
  { strands: 0x5a1f86, core: 0x1c0828, rim: 0xd0a0ff, specks: 13, half: 1.15, puffs: 5 },
);

/** a spec as a classic death / spawn preset: size `mult` at the caller's scale (route.ts sizes it from the creature's radius) */
function asPreset(spec: FxSpec, cat: 'death' | 'spawn'): PresetDef {
  return { ...specPreset(spec), cat, size: 'mult', base: 1 };
}


function alias(id: string, race: string): PresetDef {
  return {
    id,
    cat: 'death',
    desc: `Deprecated alias of sk.gen.monster_die (${race}): uses the unified dark magenta smoke death; never routed.`,
    size: 'mult',
    base: 1,
    palette: 'dark',
    dur: 0,
    loop: false,
    fire(fx, c) {
      fx.spec?.play(MONSTER_DIE, c, false, c as Inst);
    },
  };
}

export const presets: PresetDef[] = [
  alias('death.dust', 'dust'),
  alias('death.animal', 'animal'),
  alias('death.orc', 'orc'),
  alias('death.undead', 'undead'),
  alias('death.ice', 'ice'),
  alias('death.fire', 'fire'),
  alias('death.desert', 'desert'),
  alias('death.devil', 'devil'),
  alias('death.insect', 'insect'),
  alias('death.dragon', 'dragon'),
  alias('death.human', 'human'),
  alias('death.metin', 'metin'),
  asPreset(DEATH_ELITE, 'death'),
  asPreset(DEATH_BOSS, 'death'),
  asPreset(SPAWN_ELITE, 'spawn'),
  asPreset(SPAWN_CORRUPT, 'spawn'),
  asPreset(SPAWN_SUMMON, 'spawn'),
];
