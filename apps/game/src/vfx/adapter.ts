// Sim events → VFX presets. Reads each event synchronously (event objects are pooled by the sim and must not be retained).
// Since the C0 ownership split this is a dispatcher: every typed sim event goes to the routes of the vfx/common/<target>
// that owns it (vfx/common/<target>/route.ts, guide: vfx/common/README.md). The generic paths stay here: `w.bus.vfx`
// presets and aliases (`onVfx`, boss breath re-anchoring, alias de-dupe), skill-cast presets and `enemy.explode`.
import type { SimEvent, SkillCastEvent, VfxEvent } from '../sim/events';
import { COMMON_TARGETS } from './common';
import { route, type EventRoute, type RouteCtx } from './common/route';
import type { Resolved } from './presets';
import type { VfxSystem } from './system';
import type { SkillMeta, SkillMetaSource, SpawnOpts } from './types';

/** `cone.breath` starts its jet this far along `dir` and this high above the spawn point (vfx/presets/zones.ts breathZone) */
const BREATH_MOUTH_FWD = 0.5;
const BREATH_MOUTH_UP = 0.9;
/** shortest breath cone (m) when the mouth already reaches past most of the gameplay length */
const BREATH_MIN_LEN = 2.5;

/** well-known metin rune colours by id fragment, used until the content catalogue is supplied via setMetinRunes() */
const METIN_RUNE_HINTS: ReadonlyArray<readonly [string, number]> = [
  ['sorrow', 0x6aa8ff],
  ['uzunt', 0x6aa8ff],
  ['combat', 0xff8a3a],
  ['fight', 0xff8a3a],
  ['dovus', 0xff8a3a],
  ['battle', 0xff4a3a],
  ['war', 0xff4a3a],
  ['savas', 0xff4a3a],
  ['greed', 0xffd23a],
  ['avarice', 0xffd23a],
  ['hirs', 0xffd23a],
  ['black', 0xb060ff],
  ['siyah', 0xb060ff],
  ['shadow', 0x8a60ff],
  ['golge', 0x8a60ff],
  ['devil', 0xff5a2a],
  ['demon', 0xff5a2a],
  ['seytan', 0xff5a2a],
  ['death', 0x6fe05a],
  ['olum', 0x6fe05a],
  ['killer', 0xff2a4a],
  ['katil', 0xff2a4a],
  ['great', 0xffe08a],
];

/** C1: `w.bus.vfx` aliases that duplicate a typed sim event — one effect per window (whichever arrives first) and a
 *  size ceiling (the sim's revive alias carried a 7× scale: a 25 m white-out) */
const DEDUPE_ALIASES: Readonly<Record<string, { key: string; window: number; maxScale: number }>> = {
  vfx_revive: { key: 'player.revive', window: 0.25, maxScale: 1.4 },
  vfx_boss_enrage: { key: 'boss.enrage.burst', window: 0.25, maxScale: Infinity },
};

/** projectile correlation matching horizon (seconds) and maximum retained records (RENDER-08) */
const TRACK_HORIZON = 1;
const MAX_TRACKED = 512;

export class EventAdapter implements RouteCtx {
  /** reusable options object for spawn calls (no per-event allocation) */
  readonly opts: SpawnOpts = {};

  private readonly sys: VfxSystem;
  private deathPresets: string[] = [];
  private metinRuneMap = new Map<string, number>();
  /** telegraph events spawn `telegraph.*` presets only when enabled (the render layer draws feed-driven telegraph decals) */
  telegraphEvents = false;
  private clock = 0;
  private castPresets = new Map<string, string>();
  /** `sk.<id>` → `sk.<id>.explode`: the awakened explosion of that skill (see `onVfx`) */
  private explodePresets = new Map<string, string>();
  /** the last `sk.*` event of this frame (position + preset): an explosion fired at the very same point right after it belongs to that skill */
  private lastSk = { preset: '', x: 0, z: 0, clock: -1 };
  /** tracked `sk.*` projectile bodies (key → last reported point), only for presets that own an `.explode` (see `explodeOfTrack`) */
  private readonly tracked = new Map<number, { preset: string; x: number; z: number; clock: number }>();
  private oldestTracked = Infinity;
  /**
   * Optional (set by the render world): writes the world position of the breath socket (`muzzle`) of the boss standing at
   * the sim point (x, z) into `out`; false when no such boss / socket. Breath cones from a boss then leave its mouth.
   */
  breathOrigin: ((x: number, z: number, out: { x: number; y: number; z: number }) => boolean) | null = null;
  /** Optional (set by the render world): live position of the boss nearest to (x, z); false = none (routes fall back) */
  bossOrigin: ((x: number, z: number, out: { x: number; y: number; z: number }) => boolean) | null = null;
  private readonly mouth = { x: 0, y: 0, z: 0 };
  /**
   * Optional (set by app/skillVfxFeed through VfxSystem.setSkillMeta): rank / awakened / caster of the skill whose
   * preset (or skill id) fired, cast by the player nearest the event. `sk.*` specs escalate per grade with it.
   */
  skillMeta: SkillMetaSource | null = null;
  private readonly meta: SkillMeta = { rank: 0, awakened: false, caster: -1 };
  private readonly routes: EventRoute[];
  private readonly table = new Map<string, EventRoute[]>();
  private readonly marks = new Map<string, number>();

  constructor(sys: VfxSystem) {
    this.sys = sys;
    const core = route(['enemyAttack'], (e, ctx) => {
      // 4 = explode (legacy `enemy.explode`, skill/legacy domain); 1 muzzle → enemy-projectiles, 2/3 → ambient
      if (e.kind === 4) ctx.fire('enemy.explode', ctx.o(e.x, e.z, 1));
    });
    this.routes = [core, ...COMMON_TARGETS.flatMap((t) => t.routes?.() ?? [])];
    for (const r of this.routes) {
      for (const t of r.events) {
        let list = this.table.get(t);
        if (list === undefined) {
          list = [];
          this.table.set(t, list);
        }
        list.push(r);
      }
    }
  }

  /** index = enemy `type` (CrowdTypeDef order) → death preset id (e.g. 'death.undead'); missing → 'sk.gen.monster_die' */
  setDeathPresets(ids: ReadonlyArray<string>): void {
    this.deathPresets = ids.slice();
  }

  /** metin def id → rune colour (0xRRGGBB or '#rrggbb') */
  setMetinRunes(runes: Readonly<Record<string, number | string>>): void {
    this.metinRuneMap.clear();
    for (const k of Object.keys(runes)) {
      const v = runes[k] as number | string;
      this.metinRuneMap.set(k, typeof v === 'number' ? v : parseInt(v.replace('#', ''), 16));
    }
  }

  /** skill id → preset id fired on `skillCast` events (only needed when the sim does not emit its own vfx events) */
  setCastPresets(map: Readonly<Record<string, string>>): void {
    this.castPresets.clear();
    for (const k of Object.keys(map)) this.castPresets.set(k, map[k] as string);
  }

  /**
   * `sk.<id>` → `sk.<id>.explode`: a skill's own look for the sim's awakening explosion (`vfx_explode` fired right after the
   * skill's `sk.<id>` event at the same point); without an entry the generic `enemy.explode` plays as before
   */
  setExplodePresets(map: Readonly<Record<string, string>>): void {
    this.explodePresets.clear();
    for (const k of Object.keys(map)) this.explodePresets.set(k, map[k] as string);
  }

  /**
   * VfxSystem.track() reports every tracked `sk.*` projectile body here. Projectile skills fire no `sk.<id>` vfx event, so
   * the sim's awakening `vfx_explode` at the end of the flight finds its skill through the last point of the body that
   * stopped there (`explodeOfTrack`). Only presets that own an `.explode` spec are remembered.
   */
  noteTrack(key: number, preset: string, x: number, z: number): void {
    if (!this.explodePresets.has(preset)) return;
    const t = this.tracked.get(key);
    if (t === undefined) {
      if (this.tracked.size >= MAX_TRACKED) {
        this.pruneTracked();
        if (this.tracked.size >= MAX_TRACKED) {
          const oldestKey = this.tracked.keys().next();
          if (!oldestKey.done) this.tracked.delete(oldestKey.value);
        }
      }
      this.tracked.set(key, { preset, x, z, clock: this.clock });
    } else {
      t.preset = preset;
      t.x = x;
      t.z = z;
      t.clock = this.clock;
      // refresh recency order so bounded eviction drops the oldest entry
      this.tracked.delete(key);
      this.tracked.set(key, t);
    }
    if (this.clock < this.oldestTracked) this.oldestTracked = this.clock;
  }

  private pruneTracked(): void {
    let oldest = Infinity;
    for (const [k, t] of this.tracked) {
      if (this.clock - t.clock > TRACK_HORIZON) {
        this.tracked.delete(k);
      } else if (t.clock < oldest) {
        oldest = t.clock;
      }
    }
    this.oldestTracked = oldest;
  }

  /** the generic awakening explosion at the end of a tracked projectile → that skill's own `.explode` preset (true = handled) */
  private explodeOfTrack(e: VfxEvent): boolean {
    if (this.tracked.size === 0) return false;
    let best: { preset: string; x: number; z: number; clock: number } | null = null;
    let bd = 1.5 * 1.5;
    let oldest = Infinity;
    for (const [k, t] of this.tracked) {
      if (this.clock - t.clock > TRACK_HORIZON) {
        this.tracked.delete(k);
        continue;
      }
      if (t.clock < oldest) oldest = t.clock;
      if (this.clock - t.clock > 0.25) continue;
      const d = (t.x - e.x) ** 2 + (t.z - e.z) ** 2;
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    this.oldestTracked = oldest;
    const own = best === null ? undefined : this.explodePresets.get(best.preset);
    if (best === null || own === undefined) return false;
    const q = this.o(e.x, e.z, e.scale !== 0 ? Math.abs(e.scale) : 1, e.dirX, e.dirZ);
    q.duration = e.duration;
    q.element = e.element;
    this.withSkill(q, best.preset, e.x, e.z);
    if (e.player !== undefined && e.player >= 0) q.caster = e.player;
    this.fire(own, q);
    return true;
  }

  reset(): void {
    this.tracked.clear();
    this.oldestTracked = Infinity;
    for (const r of this.routes) r.reset?.();
    this.marks.clear();
  }

  update(dt: number): void {
    this.clock += dt;
    if (this.tracked.size > 0 && this.clock - this.oldestTracked > TRACK_HORIZON) {
      this.pruneTracked();
    }
    for (const r of this.routes) r.update?.(dt, this);
  }

  // -------------------------------------------------------------------------------------------------- RouteCtx

  get time(): number {
    return this.clock;
  }

  get density(): number {
    return this.sys.fx.density;
  }

  get players(): Float32Array {
    return this.sys.players;
  }

  heightAt(x: number, z: number): number {
    return this.sys.heightAt(x, z);
  }

  resolve(id: string): Resolved | null {
    return this.sys.resolve(id);
  }

  o(x: number, z: number, scale: number, dirX?: number, dirZ?: number): SpawnOpts {
    const o = this.opts;
    o.x = x;
    o.z = z;
    o.y = undefined;
    o.dirX = dirX;
    o.dirZ = dirZ;
    o.rot = undefined;
    o.scale = scale;
    o.duration = 0;
    o.color = undefined;
    o.element = undefined;
    o.hasTarget = false;
    o.tx = 0;
    o.tz = 0;
    o.ty = undefined;
    o.intensity = undefined;
    o.seed = undefined;
    o.a = undefined;
    o.b = undefined;
    o.rank = undefined;
    o.awakened = undefined;
    o.caster = undefined;
    return o;
  }

  /** copies the casting skill's rank / caster into `o` when the skill lookup knows `key` (preset id or skill id) */
  private withSkill(o: SpawnOpts, key: string, x: number, z: number): void {
    const src = this.skillMeta;
    if (src === null || !src(key, x, z, this.meta)) return;
    o.rank = this.meta.rank;
    o.awakened = this.meta.awakened;
    o.caster = this.meta.caster;
  }

  fire(id: string, o: SpawnOpts): number {
    return this.sys.spawn(id, o);
  }

  spawnResolved(r: Resolved, o: SpawnOpts): number {
    return this.sys.spawnResolved(r, o);
  }

  stop(handle: number): void {
    this.sys.stop(handle);
  }

  alive(handle: number): boolean {
    const s = this.sys as unknown as { alive?: (h: number) => boolean };
    return s.alive === undefined ? true : s.alive(handle);
  }

  once(key: string, window: number): boolean {
    const t = this.marks.get(key);
    if (t !== undefined && this.clock - t < window) return false;
    this.marks.set(key, this.clock);
    return true;
  }

  since(key: string): number {
    const t = this.marks.get(key);
    return t === undefined ? Infinity : this.clock - t;
  }

  mark(key: string): void {
    this.marks.set(key, this.clock);
  }

  deathPreset(type: number): string | undefined {
    return this.deathPresets[type];
  }

  metinRune(def: string, great: boolean): number {
    const m = this.metinRuneMap.get(def);
    if (m !== undefined) return m;
    const low = def.toLowerCase();
    for (const [k, v] of METIN_RUNE_HINTS) if (low.includes(k)) return v;
    return great ? 0xffe08a : 0x9ad0ff;
  }

  bossPos(x: number, z: number, out: { x: number; y: number; z: number }): boolean {
    return this.bossOrigin !== null && this.bossOrigin(x, z, out);
  }

  // -------------------------------------------------------------------------------------------------- dispatch

  handle(events: ArrayLike<unknown>, count: number): void {
    for (let i = 0; i < count; i++) this.handle1(events[i]);
  }

  /** one sim event (anything that is not a known event object is ignored) */
  handle1(ev: unknown): void {
    const e = ev as SimEvent | undefined;
    if (e === undefined || e === null) return;
    if (e.t === 'vfx') {
      this.onVfx(e);
      return;
    }
    if (e.t === 'skillCast') {
      this.onSkillCast(e);
      return;
    }
    const list = this.table.get(e.t);
    if (list === undefined) return;
    for (let i = 0; i < list.length; i++) (list[i] as EventRoute).handle(e, this);
  }

  // -------------------------------------------------------------------------------------------------- generic paths

  private onVfx(e: VfxEvent): void {
    // routes ask since('<preset id>') (e.g. a skill heal skips holy.heal right after its own `sk.mending_light`)
    this.marks.set(e.preset, this.clock);
    if (e.preset.startsWith('sk.')) {
      const l = this.lastSk;
      l.preset = e.preset;
      l.x = e.x;
      l.z = e.z;
      l.clock = this.clock;
    } else if (e.preset === 'vfx_explode' && this.lastSk.clock === this.clock) {
      const own = this.explodePresets.get(this.lastSk.preset);
      if (own !== undefined && Math.abs(e.x - this.lastSk.x) < 1e-3 && Math.abs(e.z - this.lastSk.z) < 1e-3) {
        const q = this.o(e.x, e.z, e.scale !== 0 ? Math.abs(e.scale) : 1, e.dirX, e.dirZ);
        q.duration = e.duration;
        q.element = e.element;
        this.withSkill(q, this.lastSk.preset, e.x, e.z);
        if (e.player !== undefined && e.player >= 0) q.caster = e.player;
        this.fire(own, q);
        return;
      }
    }
    if (e.preset === 'vfx_explode' && this.explodeOfTrack(e)) return;
    const dd = DEDUPE_ALIASES[e.preset];
    if (dd !== undefined && !this.once(dd.key, dd.window)) return;
    // meleeArc mirrors alternate swings with a negative scale: size = |scale|, handedness → b = -1 (preset swing direction)
    const o = this.o(e.x, e.z, e.scale !== 0 ? Math.abs(e.scale) : 1, e.dirX, e.dirZ);
    if (dd !== undefined && (o.scale as number) > dd.maxScale) o.scale = dd.maxScale;
    if (e.scale < 0) o.b = -1;
    o.duration = e.duration;
    if (e.color >= 0) o.color = e.color;
    o.element = e.element;
    if (e.hasTarget) {
      o.hasTarget = true;
      o.tx = e.tx;
      o.tz = e.tz;
    }
    if (e.preset.startsWith('sk.')) this.withSkill(o, e.preset, e.x, e.z);
    if (e.player !== undefined && e.player >= 0) o.caster = e.player;
    const origin = this.breathOrigin;
    const isBreath = e.preset.startsWith('cone.breath') || e.preset === 'vfx_boss_breath';
    if (origin !== null && isBreath && origin(e.x, e.z, this.mouth)) this.fromMouth(o, e, this.mouth);
    this.fire(e.preset, o);
  }

  /**
   * Re-anchors a boss breath cone on the boss's mouth `m`: the jet starts at the `muzzle` socket instead of hip height at
   * the boss's feet, and the cone is shortened by how far the mouth already reaches, so it still ends where the sim's
   * damage cone ends (event point + dir × length).
   */
  private fromMouth(o: SpawnOpts, e: VfxEvent, m: { x: number; y: number; z: number }): void {
    const l = Math.hypot(e.dirX, e.dirZ);
    if (l < 1e-6) return;
    const dx = e.dirX / l;
    const dz = e.dirZ / l;
    const reach = (m.x - e.x) * dx + (m.z - e.z) * dz;
    o.x = m.x - dx * BREATH_MOUTH_FWD;
    o.z = m.z - dz * BREATH_MOUTH_FWD;
    o.y = m.y - BREATH_MOUTH_UP;
    o.scale = Math.max(BREATH_MIN_LEN, (o.scale as number) - reach + BREATH_MOUTH_FWD);
  }

  private onSkillCast(e: SkillCastEvent): void {
    const id = this.castPresets.get(e.skillId);
    if (id === undefined) return;
    const o = this.o(e.x, e.z, e.area > 0 ? e.area : 1, e.dirX, e.dirZ);
    this.withSkill(o, e.skillId, e.x, e.z);
    if (e.awakened) o.awakened = true;
    if (o.caster === undefined) o.caster = e.player;
    this.fire(id, o);
  }
}
