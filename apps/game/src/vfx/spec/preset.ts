// specPreset(): wraps an FxSpec into a PresetDef that is drop-in compatible with the sim behaviour that fires it.
import type { Inst } from '../system';
import type { PresetCategory, PresetDef } from '../presets/types';
import type { FxSpec, SkillBehavior } from './types';

/**
 * How each behaviour reaches the VFX layer (see README "Behaviour contracts"):
 *  path `event`  = w.bus.vfx one-shot (EventAdapter.onVfx → spawn), `line` = w.bus.vfxLine (hasTarget = segment end),
 *       `zone`   = zone row preset, started / moved / stopped by app/skillVfxFeed (loop handle),
 *       `track`  = projectile row preset, vfx.track() every frame, impact when tracking stops.
 *  scale = what SpawnOpts.scale carries; dur = what SpawnOpts.duration carries.
 */
export interface BehaviorContract {
  path: 'event' | 'line' | 'zone' | 'track';
  loop: boolean;
  needsTarget: boolean;
  size: 'radius' | 'mult';
  cat: PresetCategory;
  scale: string;
  dur: string;
}

export const BEHAVIOR_CONTRACTS: Readonly<Record<SkillBehavior, BehaviorContract>> = {
  meleeArc: { path: 'event', loop: false, needsTarget: false, size: 'radius', cat: 'melee', scale: 'reach m (b = -1 mirrored swing)', dur: '0.28 combo window' },
  cone: { path: 'event', loop: false, needsTarget: false, size: 'radius', cat: 'melee', scale: 'cone length m', dur: '0.4 per pulse' },
  selfBuff: { path: 'event', loop: false, needsTarget: false, size: 'radius', cat: 'buff', scale: 'max(2, area) m', dur: 'buff duration s (repeating elements run this long)' },
  leap: { path: 'event', loop: false, needsTarget: false, size: 'radius', cat: 'melee', scale: 'landing radius m', dur: '0.5' },
  dash: { path: 'line', loop: false, needsTarget: true, size: 'radius', cat: 'trail', scale: 'area m (segment = origin → target)', dur: 'travel time s' },
  chain: { path: 'line', loop: false, needsTarget: true, size: 'mult', cat: 'beam', scale: '1', dur: '0.22 per hop' },
  skyStrike: { path: 'event', loop: false, needsTarget: false, size: 'radius', cat: 'sky', scale: 'strike radius m', dur: '0.4 (fired at impact)' },
  summon: { path: 'track', loop: true, needsTarget: false, size: 'mult', cat: 'summon', scale: 'familiar radius (cast / strike events: 2.5 / strike radius)', dur: 'cast 0.6, strike 0.3, tracked body until it despawns' },
  spinAura: { path: 'zone', loop: true, needsTarget: false, size: 'radius', cat: 'area', scale: 'zone radius m', dur: 'zone duration s (follows the caster)' },
  persistentAura: { path: 'zone', loop: true, needsTarget: false, size: 'radius', cat: 'buff', scale: 'zone radius m', dur: 'until removed (follows the caster)' },
  groundZone: { path: 'zone', loop: true, needsTarget: false, size: 'radius', cat: 'area', scale: 'zone radius m', dur: 'zone duration s' },
  shockwave: { path: 'zone', loop: true, needsTarget: false, size: 'radius', cat: 'area', scale: 'final ring radius m', dur: 'expand time + 0.25 s' },
  beam: { path: 'zone', loop: true, needsTarget: false, size: 'radius', cat: 'beam', scale: 'beam width m (target = beam tip)', dur: 'zone duration s (follows the caster)' },
  projectile: { path: 'track', loop: true, needsTarget: false, size: 'mult', cat: 'ranged', scale: 'projectile radius m', dur: 'until the projectile ends (impact list plays)' },
  homingProjectile: { path: 'track', loop: true, needsTarget: false, size: 'mult', cat: 'ranged', scale: 'projectile radius m', dur: 'until the projectile ends (impact list plays)' },
  orbit: { path: 'track', loop: true, needsTarget: false, size: 'mult', cat: 'ranged', scale: 'orb hit radius m', dur: 'until the orb ends' },
};

/** the SkillParams fields `shippedScale` reads (skills.json `params`) */
export interface ScaleParams {
  area?: number;
  range?: number;
}














export function shippedScale(behavior: SkillBehavior, p: ScaleParams, aw?: { areaMul?: number; rangeMul?: number }): number {
  const area = Math.max(0.2, (p.area ?? 0) * (aw?.areaMul ?? 1));
  const range = Math.max(0, (p.range ?? 0) * (aw?.rangeMul ?? 1));
  switch (behavior) {
    case 'meleeArc':
      return Math.max(0.8, area);
    case 'cone':
      return range > 0 ? range : area;
    case 'selfBuff':
      return Math.max(2, area);
    case 'leap':
      return Math.max(1.5, area);
    case 'beam':
      return Math.max(0.4, area);
    case 'projectile':
    case 'homingProjectile':
      return Math.max(0.25, area);
    case 'orbit':
      return range > 0 ? Math.max(0.4, area) : 0.7;
    case 'chain':
      return 1;
    case 'summon':
      return 2.5;
    case 'dash':
    case 'skyStrike':
    case 'spinAura':
    case 'persistentAura':
    case 'groundZone':
    case 'shockwave':
      return area;
  }
}

/**
 * Scale of the `sk.<id>.cast` helper preset (hand / weapon / head cast accents): the EventAdapter fires it on the sim's `skillCast`
 * event with scale = the cast's final area (adapter.onSkillCast: `e.area > 0 ? e.area : 1`, area = resolveParams' `max(0.2, …)`),
 * whatever the skill's behaviour (a cone's cast part gets its tiny area, not the cone length). A cast spec plays at k = 1 with
 * base = this value.
 */
export function castScale(p: ScaleParams, aw?: { areaMul?: number }): number {
  return Math.max(0.2, (p.area ?? 0) * (aw?.areaMul ?? 1));
}

/** the three scales one `summon` spec plays at (sim/skills/behaviors/summon.ts): cast event, tracked body, strike events */
export function summonScales(p: ScaleParams): { cast: number; body: number; strike: number } {
  // resolveParams clamps area to >= 0.2, so summon.ts' `fp.area > 0 ? fp.area : 1.3` fallback never triggers
  return { cast: 2.5, body: 0.5, strike: Math.max(0.2, p.area ?? 0) };
}

/** every spec registered through specPreset (the host compiles them at load so the curve LUT uploads once) */
export const SPEC_REGISTRY: FxSpec[] = [];

/** PresetDef for a spec; behaviour decides loop / target / size so the sim and the feeds can use it unchanged */
export function specPreset(spec: FxSpec): PresetDef {
  const ct = BEHAVIOR_CONTRACTS[spec.behavior];
  SPEC_REGISTRY.push(spec);
  const def: PresetDef = {
    id: spec.id,
    cat: ct.cat,
    desc: spec.desc,
    size: ct.size,
    base: spec.base,
    palette: 'physical',
    // tint templates accept palette variant ids (`sk.<id>.fire`) and element hints like the classic presets
    variants: spec.tint === true,
    dur: spec.dur,
    loop: ct.loop,
    // zone / track loops end when their owner stops them (skillVfxFeed, status / metin feeds): a spawn without an
    // explicit duration must not fall back to `dur` and die after it (persistent auras, infinite zones)
    untilStopped: ct.loop || undefined,
    needsTarget: ct.needsTarget || undefined,
    demo: { ...spec.demo, ...(ct.needsTarget && spec.demo?.target === undefined ? { target: 5 } : {}) },
    fire(fx, c) {
      // rank / awakened / caster ride on the VfxSystem's Inst (SpawnOpts.rank …); plain Ctx callers get rank 0
      const h = fx.spec?.play(spec, c, ct.loop, c as Inst) ?? 0;
      if (ct.loop) {
        const inst = c as Inst;
        inst.acc0 = h;
        // line loops (beams) keep their length and swing with the caster's facing
        inst.acc1 = c.hasTarget ? Math.hypot(c.tx - c.x, c.tz - c.z) : 0;
      }
    },
  };
  if (ct.loop) {
    def.tick = (fx, inst: Inst) => {
      const h = inst.acc0;
      if (h === 0 || !fx.spec) return;
      if (inst.moved) fx.spec.move(h, inst.x, inst.y, inst.z, inst.dx, inst.dz);
      if (inst.acc1 > 0) fx.spec.setTarget(h, inst.x + inst.dx * inst.acc1, inst.y, inst.z + inst.dz * inst.acc1);
    };
    def.end = (fx, inst: Inst) => {
      if (inst.acc0 !== 0) fx.spec?.stop(inst.acc0);
      inst.acc0 = 0;
    };
  }
  return def;
}
