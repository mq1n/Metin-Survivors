// Skill VFX feed: the sim stores skill presets on zone rows (spinAura, persistentAura, groundZone, shockwave, beam) and
// projectile rows (projectile, homingProjectile, orbit, summon familiars); this module turns those rows into VFX handles.
//  - player zone rows (team 0, not Strike: sky strikes fire their own one-shot): spawn once with radius / duration /
//    facing (beams: target = beam tip), move every frame (follow zones ride the caster), stop when the row is gone;
//  - projectile rows whose preset is a skill spec (`sk.*`): vfx.track() every frame at the interpolated position (the
//    generic projectile body skips those styles, see simFeed.styleFromName); the spec plays its impact list when the
//    row disappears.
// Every spawn carries the casting skill's rank (SpawnOpts.rank / awakened) and caster player, so `sk.*` specs escalate

// .setSkillMeta → EventAdapter).
import { MAX_SKILL_RANK } from '../data/schema';
import { ProjKind, ZoneKind } from '../sim/stores';
import type { World } from '../sim/world';
import type { SkillMeta, SpawnOpts, Vfx } from '../vfx/types';

/**
 * A hero-attached `sk.<skill>.loop` MARKER row (a ward / dodge / mirror window, sim/skills/shell.ts) whose skill has no spec of that id (a
 * generated family that folded its AFFECT loop into the cast) draws this shared pale ring instead of nothing (DESIGN section 7 (3);
 * vfx/skills/common/moments.ts). A real `sk.<skill>.loop` spec always wins.
 */
export const SHELL_RING_FALLBACK = 'sk.gen.shell_ring';

interface ZoneFx {
  handle: number;
  stamp: number;
}

export class SkillVfxFeed {
  private readonly zones = new Map<number, ZoneFx>();
  private readonly opts: SpawnOpts = {};
  private readonly meta: SkillMeta = { rank: 0, awakened: false, caster: -1 };
  private stamp = 0;
  private world: World | null = null;
  private bound: Vfx | null = null;

  /** rank / caster of the skill whose preset (or skill id) is `key`, owned by the player nearest (x, z) */
  readonly skillMeta = (key: string, x: number, z: number, out: SkillMeta): boolean => {
    const w = this.world;
    if (w === null) return false;
    let best = Infinity;
    let found = false;
    for (const p of w.players) {
      for (const s of p.skills) {
        if (s.def.vfx !== key && s.def.id !== key) continue;
        const d = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (d < best) {
          best = d;
          found = true;
          out.rank = s.rank;
          out.awakened = s.rank >= MAX_SKILL_RANK;
          out.caster = p.index;
        }
      }
    }
    return found;
  };

  /** rank / caster of the skill in global slot `slot` (zone and projectile rows) */
  private slotMeta(w: World, slot: number, owner: number, out: SkillMeta): SkillMeta {
    const s = w.skillSlots[slot];
    out.rank = s ? s.rank : 0;
    out.awakened = s ? s.rank >= MAX_SKILL_RANK : false;
    out.caster = owner;
    return out;
  }

  update(world: World, vfx: Vfx, alpha: number, heightAt: (x: number, z: number) => number): void {
    this.world = world;
    if (this.bound !== vfx) {
      this.bound = vfx;
      vfx.setSkillMeta?.(this.skillMeta);
    }
    const stamp = ++this.stamp;
    const Z = world.zones;
    const names = world.strings.names;
    for (let i = 0; i < Z.count; i++) {
      if (Z.team[i] !== 0 || Z.kind[i] === ZoneKind.Strike) continue;
      const id = Z.id[i] as number;
      const x = Z.x[i] as number;
      const z = Z.z[i] as number;
      const rot = Z.rot[i] as number;
      const dx = Math.sin(rot);
      const dz = Math.cos(rot);
      let zf = this.zones.get(id);
      if (zf === undefined) {
        const o = this.opts;
        const beam = Z.kind[i] === ZoneKind.Beam;
        const len = Z.length[i] as number;
        o.x = x;
        o.z = z;
        o.dirX = dx;
        o.dirZ = dz;
        o.scale = Z.radius[i] as number;
        o.duration = (Z.dur[i] as number) < 1e6 ? (Z.dur[i] as number) : 0;
        o.element = Z.element[i] as number;
        o.hasTarget = beam && len > 0;
        o.tx = x + dx * len;
        o.tz = z + dz * len;
        const m = this.slotMeta(world, Z.skill[i] as number, Z.owner[i] as number, this.meta);
        o.rank = m.rank;
        o.awakened = m.awakened;
        o.caster = m.caster;
        zf = { handle: vfx.spawn(names[Z.preset[i] as number] ?? '', o), stamp };
        this.zones.set(id, zf);
      }
      zf.stamp = stamp;
      if (zf.handle !== 0) vfx.move(zf.handle, x, z, undefined, dx, dz);
    }
    for (const [id, zf] of this.zones) {
      if (zf.stamp === stamp) continue;
      if (zf.handle !== 0) vfx.stop(zf.handle);
      this.zones.delete(id);
    }

    const P = world.projectiles;
    for (let i = 0; i < P.count; i++) {
      let name = names[P.style[i] as number] ?? '';
      if (!name.startsWith('sk.')) continue;
      if (P.kind[i] === ProjKind.Marker && name.endsWith('.loop') && vfx.has?.(name) === false) name = SHELL_RING_FALLBACK;
      const px = P.px[i] as number, pz = P.pz[i] as number;
      const x = px + ((P.x[i] as number) - px) * alpha;
      const z = pz + ((P.z[i] as number) - pz) * alpha;
      const m = P.hostile[i] === 0 ? this.slotMeta(world, P.skill[i] as number, P.owner[i] as number, this.meta) : undefined;
      vfx.track(name, P.id[i] as number, x, z, heightAt(x, z) + (P.h[i] as number), P.vx[i] as number, P.vz[i] as number, P.radius[i] as number, undefined, m);
    }
  }
}
