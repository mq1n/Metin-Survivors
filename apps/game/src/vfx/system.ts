// VfxSystem: owns the GPU batches, the preset registry, looping instances, trails, tracked effects and the event adapter.
import { Vector2, type Camera, type Scene, type Texture, type WebGLRenderer } from 'three';
import {
  DebrisBatch,
  FlashQuad,
  ParticleBatch,
  R_PTS,
  RibbonBatch,
  S_STRIDE,
  ShapeBatch,
  type SharedUniforms,
} from './batches';
import { EventAdapter } from './adapter';
import { ElementalHost, ELEMENTAL_EFFECTS, type Tier } from './elemental';
import type { ArtSource, ArtStats } from './spec/art';
import type { RunArtTiers } from './spec/artTier';
import { BoomGuard } from './spec/boom';
import { SPEC_REGISTRY } from './spec/preset';
import { SpecHost } from './spec/host';
import type { FxSpec, StandInPose, StandInSwing } from './spec/types';
import { Ctx, FO, Fx, PAT } from './emit';
import { ELEMENT_PALETTE, PALETTES, VARIANTS, copyPalette, derivePalette, type PaletteId } from './palette';
import { PRESETS, PRESET_ALIASES, onPresetsAdded, type PresetDef, type Resolved } from './presets';
// EV-03b: the run-event visuals (shrine, champion ring, rain mark) register their specs here, before the dev demo specs below
import { EVENT_PRESETS, RunEventVfx } from './common/events';
// after the presets: the dev demo specs register (and take curve LUT rows) after every real skill spec
import { DEV_SPEC_PRESETS } from './spec/demo';
import { MAX_CAP, VFX_PROFILES, type VfxProfile } from './quality';
import { bakeTextures, type VfxTextures } from './textures';
import {
  ELEMENT_NAMES,
  type ScreenFx,
  type SkillMeta,
  type SkillMetaSource,
  type SpawnOpts,
  type Vfx,
  type VfxColor,
  type VfxOptions,
  type VfxQuality,
  type VfxStats,
} from './types';
import { parseColor, rgba } from './util';

const TIER_OF: Record<VfxQuality, Tier> = { low: 0, medium: 1, high: 2, ultra: 3 };

/**
 * Lifetime of a looping instance (0 = until stopped): the caller's explicit duration, else 0 for `untilStopped`
 * presets (every `sk.*` loop: their feed stops them), else the preset default `dur`.
 */
export function loopTotal(def: PresetDef, o: SpawnOpts | undefined): number {
  const d = o?.duration;
  if (d !== undefined && d > 0) return d;
  return def.untilStopped === true ? 0 : def.dur;
}
const MAX_INST = 192;
const MAX_TRAILS = 96;
const KEY_TAB = 1024;

/** A running looping effect (also the Ctx its preset sees). */
export class Inst extends Ctx {
  active = false;
  def: PresetDef | null = null;
  handle = 0;
  age = 0;
  /** total lifetime; ≤0 = until stopped */
  total = 0;
  key = 0;
  touched = 0;
  ending = false;
  /** per-preset scratch accumulators */
  acc0 = 0;
  acc1 = 0;
  acc2 = 0;
  acc3 = 0;
  /** pool index (stable) */
  idx = 0;
  /** shapes owned by this instance: additive batch handles / alpha batch handles, with their height above the instance y */
  readonly sa = new Int32Array(6).fill(-1);
  readonly sya = new Float32Array(6);
  na = 0;
  readonly sd = new Int32Array(6).fill(-1);
  readonly syd = new Float32Array(6);
  nd = 0;
  /** index into trails or -1 */
  trail = -1;
  /** the position last frame (for velocity) */
  px = 0;
  py = 0;
  pz = 0;
  moved = false;
  followPlayer = false;
  /** owning system (set once at pool creation) */
  host: VfxSystem | null = null;
  /** casting skill rank 0..7, awakened, caster player (SpawnOpts.rank / awakened / caster; `sk.*` specs read them) */
  rank = 0;
  awakened = false;
  caster = -1;

  /** starts a ribbon trail that follows this instance's position (call from `fire`; one per instance). Colours are 0xRRGGBB
   *  (head → tail). style: 0 trail, 2 sword streak, 3 energy rope */
  trailRibbon(width: number, life: number, c0: number, c1: number, intensity = 1, style = 0): void {
    this.host?.trailBegin(this, width, life, rgba(c0, 1), rgba(c1, 1), intensity, style);
  }

  /** registers a pinned additive-batch shape so it follows the instance and is killed when it ends */
  own(handle: number, yOff = 0): void {
    if (handle >= 0 && this.na < 6) {
      this.sya[this.na] = yOff;
      this.sa[this.na++] = handle;
    }
  }

  /** same for the alpha batch (decals) */
  ownDecal(handle: number, yOff = 0): void {
    if (handle >= 0 && this.nd < 6) {
      this.syd[this.nd] = yOff;
      this.sd[this.nd++] = handle;
    }
  }
}

interface Trail {
  active: boolean;
  owner: number;
  chunk: number;
  chunkHandle: number;
  n: number;
  /** newest-first points: x y z birth */
  pts: Float32Array;
  width: number;
  life: number;
  c0: number;
  c1: number;
  intensity: number;
  style: number;
  seed: number;
  lastX: number;
  lastY: number;
  lastZ: number;
  ended: boolean;
  endTime: number;
}

/** What the system exposes to presets beyond Fx (follow ownership, trail begin, …). */
export class VfxSystem implements Vfx {
  readonly name = 'vfx' as const;
  readonly screen: ScreenFx = { flashR: 0, flashG: 0, flashB: 0, flashA: 0, shake: 0 };
  readonly fx: Fx;
  /** signature effects host (null when disabled) */
  readonly elemental: ElementalHost | null = null;
  /** skill effect spec runtime (`sk.*` presets) */
  readonly spec: SpecHost;
  readonly uniforms: SharedUniforms;

  private readonly scene: Scene;
  private readonly renderer: WebGLRenderer;
  readonly textures: VfxTextures;
  private readonly pAdd: ParticleBatch;
  private readonly pAlpha: ParticleBatch;
  private readonly sAdd: ShapeBatch;
  private readonly sAlpha: ShapeBatch;
  private readonly ribbons: RibbonBatch;
  private readonly debris: DebrisBatch;
  private readonly flashQuad: FlashQuad | null;
  private readonly meshes: Array<{ visible: boolean }>;

  private profile: VfxProfile;
  private quality: VfxQuality;
  private time = 0;
  private frame = 0;
  private opts: VfxOptions;
  private readonly defs = new Map<string, Resolved>();
  private readonly missing = new Set<string>();
  private readonly insts: Inst[] = [];
  private readonly free: number[] = [];
  private freeN = 0;
  private gen = 1;
  private readonly keyTab = new Int32Array(KEY_TAB);
  private readonly trails: Trail[] = [];
  private readonly scratch = new Inst();
  private readonly tmpV = new Vector2();
  private readonly adapter: EventAdapter;
  /** specs that own their awakening blast (FxSpec.explode = 'none'): their generic explosion is dropped (spec/boom.ts) */
  private boom: BoomGuard;
  /** SPEC_REGISTRY length the guard was built for (specs registered later, e.g. drafts loaded at runtime, rebuild it) */
  private boomN = -1;
  /** skill presets that own an `sk.<id>.explode` companion (the guard leaves those to the adapter); refilled by skillTables() */
  private readonly boomCompanions = new Set<string>();
  /** leaves the presets/addPresets hub (lazy skill packs, see addPresets) */
  private readonly offPresets: () => void;
  /** EV-03b: the shrine / champion ring / rain marks of the run's event (vfx/common/events/route.ts); it sees every sim event next to the adapter */
  private readonly runEvents: RunEventVfx;
  private readonly feed = (e: unknown): void => {
    this.adapter.handle1(e);
    const t = (e as { t?: string } | null | undefined)?.t;
    if (t === 'runEvent' || t === 'metinWarn') this.runEvents.handle(e as Parameters<RunEventVfx['handle']>[0]);
  };
  readonly players = new Float32Array(12);
  /** players fed by setPlayer (0 in galleries / menus: FxSpec.follow then keeps the spawn point) */
  playerCount = 0;
  focusX = 0;
  focusY = 0;
  focusZ = 0;
  private flashT = 0;
  private flashDur = 0;
  private cpuMs = 0;
  private cpuAcc = 0;
  private lastSpawned = 0;
  private lastDropped = 0;
  private trailsLive = 0;

  constructor(scene: Scene, _camera: Camera, renderer: WebGLRenderer, quality: VfxQuality, opts: VfxOptions = {}) {
    this.scene = scene;
    this.renderer = renderer;
    this.opts = opts;
    this.quality = quality;
    this.profile = VFX_PROFILES[quality];
    this.textures = bakeTextures(renderer);
    this.uniforms = {
      uTime: { value: 0 },
      uAtlas: { value: this.textures.atlas },
      uNoise: { value: this.textures.noise },
      uDepth: { value: null },
      uInvRes: { value: { x: 1, y: 1 } },
      uNearFar: { value: { x: 0.5, y: 220 } },
      uSoft: { value: 0 },
    };
    const u = this.uniforms;
    this.pAlpha = new ParticleBatch(MAX_CAP.alpha, 'alpha', u);
    this.pAdd = new ParticleBatch(MAX_CAP.add, 'add', u);
    this.sAlpha = new ShapeBatch(MAX_CAP.shapes, 'alpha', u);
    this.sAdd = new ShapeBatch(MAX_CAP.shapes, 'add', u);
    this.ribbons = new RibbonBatch(MAX_CAP.ribbonChunks, u);
    this.debris = new DebrisBatch(MAX_CAP.debris, u);
    this.fx = new Fx(this.profile, this.pAdd, this.pAlpha, this.sAdd, this.sAlpha, this.ribbons, this.debris);
    this.fx.onShake = (a) => {
      this.screen.shake += a;
      this.opts.onShake?.(a);
    };
    this.fx.onFlash = (r, g, b, a, dur) => this.flash(r, g, b, a, dur);
    if (opts.elemental !== false) {
      this.elemental = new ElementalHost(scene, _camera, renderer, this.fx, TIER_OF[quality], ELEMENTAL_EFFECTS);
      this.fx.el = this.elemental;
      void this.elemental.precompile();
    }
    this.spec = new SpecHost(scene, renderer, this.uniforms.uTime, this.fx, TIER_OF[quality], (opts.renderOrder ?? 40) + 8, SPEC_REGISTRY);
    this.fx.spec = this.spec;
    this.spec.followSrc = this;
    if (opts.heightAt) this.setHeightAt(opts.heightAt);
    this.flashQuad = opts.drawFlash === false ? null : new FlashQuad();

    const ro = opts.renderOrder ?? 40;
    this.debris.mesh.renderOrder = ro - 5;
    this.sAlpha.mesh.renderOrder = ro;
    this.sAdd.mesh.renderOrder = ro + 1;
    this.pAlpha.mesh.renderOrder = ro + 2;
    this.pAdd.mesh.renderOrder = ro + 3;
    this.ribbons.mesh.renderOrder = ro + 4;
    this.meshes = [this.debris.mesh, this.sAlpha.mesh, this.sAdd.mesh, this.pAlpha.mesh, this.pAdd.mesh, this.ribbons.mesh];
    for (const m of [this.debris.mesh, this.sAlpha.mesh, this.sAdd.mesh, this.pAlpha.mesh, this.pAdd.mesh, this.ribbons.mesh]) {
      m.visible = false;
      scene.add(m);
    }
    if (this.flashQuad) {
      this.flashQuad.mesh.renderOrder = 1000;
      scene.add(this.flashQuad.mesh);
    }

    for (const d of PRESETS) this.defs.set(d.id, { def: d, palette: null, element: -1, variant: -1 });
    // dev-only demo specs (`sk.__art_demo`): galleries and QA casts, never in skills.json / production
    for (const d of DEV_SPEC_PRESETS) this.defs.set(d.id, { def: d, palette: null, element: -1, variant: -1 });
    // run-event visuals (EV-03b): `ev.*` ids live in this table only, not in the global PRESETS (they are not content ids)
    for (const d of EVENT_PRESETS) this.defs.set(d.id, { def: d, palette: null, element: -1, variant: -1 });
    for (const k of Object.keys(PRESET_ALIASES)) {
      const t = this.defs.get(PRESET_ALIASES[k] as string);
      if (t) this.defs.set(k, t);
    }
    for (let i = 0; i < MAX_INST; i++) {
      const inst = new Inst();
      inst.idx = i;
      inst.host = this;
      this.insts.push(inst);
      this.free[i] = MAX_INST - 1 - i;
    }
    this.freeN = MAX_INST;
    for (let i = 0; i < MAX_TRAILS; i++) {
      this.trails.push({
        active: false, owner: -1, chunk: -1, chunkHandle: -1, n: 0, pts: new Float32Array(R_PTS * 4), width: 0.2, life: 0.4, c0: 0, c1: 0,
        intensity: 1, style: 0, seed: 0, lastX: 0, lastY: 0, lastZ: 0, ended: false, endTime: 0,
      });
    }
    this.adapter = new EventAdapter(this);
    this.runEvents = new RunEventVfx(this);
    this.boom = new BoomGuard([], this.boomCompanions);
    this.skillTables();
    // skill packs that arrive after this system (skills/loader.ts ensureSkillVfx): addPresets takes them in
    this.offPresets = onPresetsAdded((defs) => this.addPresets(defs));
    this.applyProfile();
  }

  /** the per-skill tables of the event adapter, from PRESETS as they are now (constructor, addPresets) */
  private skillTables(): void {
    // `sk.<skillId>.cast` specs (hand charge / cast accents) fire on that skill's skillCast event at the caster
    const cast: Record<string, string> = {};
    for (const d of PRESETS) if (d.id.startsWith('sk.') && d.id.endsWith('.cast')) cast[d.id.slice(3, -5)] = d.id;
    this.adapter.setCastPresets(cast);
    // `sk.<skillId>.explode` specs replace the generic awakening explosion that follows the skill's own `sk.<skillId>` event
    const boom: Record<string, string> = {};
    for (const d of PRESETS) if (d.id.startsWith('sk.') && d.id.endsWith('.explode')) boom[d.id.slice(0, -8)] = d.id;
    this.adapter.setExplodePresets(boom);
    this.boomCompanions.clear();
    for (const k of Object.keys(boom)) this.boomCompanions.add(k);
  }

  /**
   * Presets registered after construction: the lazy skill packs (presets/index.ts addPresets, called by skills/loader.ts while a run loads).
   * Takes the new defs in (an id that was known is replaced, cached palette variants of it are dropped), forgets the cached "unknown id"
   * answers (`missing`), rebuilds the cast / explode tables, forces a new awakening-explosion guard, and COMPILES the new specs now: the
   * curve rows and the one LUT upload happen during the load, not in the first cast of a skill.
   */
  addPresets(defs: readonly PresetDef[]): void {
    if (defs.length === 0) return;
    const replaced = new Set<PresetDef>();
    for (const d of defs) {
      const old = this.defs.get(d.id);
      if (old !== undefined && old.def !== d) replaced.add(old.def);
      this.defs.set(d.id, { def: d, palette: null, element: -1, variant: -1 });
    }
    if (replaced.size > 0) for (const [id, r] of this.defs) if (r.variant >= 0 && replaced.has(r.def)) this.defs.delete(id);
    this.missing.clear();
    this.skillTables();
    this.boomN = -1;
    // SpecHost.compile is private but stable: vfx/gallery/main.ts registerDrafts calls it the same way
    const host = this.spec as unknown as { compile(spec: FxSpec): unknown };
    const specs = new Map(SPEC_REGISTRY.map((sp) => [sp.id, sp] as const));
    for (const d of defs) {
      const sp = specs.get(d.id);
      if (sp !== undefined) host.compile(sp);
    }
  }

  // ------------------------------------------------------------------ public API

  has(id: string): boolean {
    return this.resolve(id) !== null;
  }

  presetIds(): readonly string[] {
    return PRESETS.map((p) => p.id);
  }

  getDef(id: string): PresetDef | undefined {
    return this.resolve(id)?.def;
  }

  heightAt(x: number, z: number): number {
    return this.fx.heightAt(x, z);
  }

  setHeightAt(fn: ((x: number, z: number) => number) | null): void {
    this.fx.hasHeight = fn !== null;
    this.fx.heightAt = fn ?? (() => 0);
  }

  setDepthTexture(tex: Texture | null, near = 0.5, far = 220): void {
    this.uniforms.uDepth.value = tex;
    this.uniforms.uNearFar.value.x = near;
    this.uniforms.uNearFar.value.y = far;
    this.uniforms.uSoft.value = tex && this.profile.soft ? 1 : 0;
  }

  setQuality(q: VfxQuality): void {
    this.quality = q;
    this.profile = VFX_PROFILES[q];
    this.elemental?.setTier(TIER_OF[q]);
    this.spec.setTier(TIER_OF[q]);
    this.applyProfile();
  }

  private applyProfile(): void {
    const p = this.profile;
    this.fx.setProfile(p);
    this.pAdd.setCap(p.maxAdd);
    this.pAlpha.setCap(p.maxAlpha);
    this.sAdd.setCap(p.maxShapes);
    this.sAlpha.setCap(p.maxShapes);
    this.ribbons.setCap(p.maxRibbonChunks);
    this.debris.setCap(p.maxDebris);
    if (this.uniforms.uDepth.value) this.uniforms.uSoft.value = p.soft ? 1 : 0;
  }

  setPlayer(index: number, x: number, z: number, y?: number): void {
    const i = index < 0 ? 0 : index > 3 ? 3 : index;
    this.players[i * 3] = x;
    this.players[i * 3 + 1] = y ?? this.fx.heightAt(x, z);
    this.players[i * 3 + 2] = z;
    if (i + 1 > this.playerCount) this.playerCount = i + 1;
  }

  setFocus(x: number, z: number, y?: number): void {
    this.focusX = x;
    this.focusZ = z;
    this.focusY = y ?? this.fx.heightAt(x, z);
  }

  spawn(id: string, o?: SpawnOpts): number {
    const r = this.resolve(id);
    if (r === null) return 0;
    return this.spawnResolved(r, o);
  }

  /** id (+ optional palette/element variant suffix) → recipe; null when unknown */
  resolve(id: string): Resolved | null {
    const hit = this.defs.get(id);
    if (hit !== undefined) return hit;
    if (this.missing.has(id)) return null;
    const dot = id.lastIndexOf('.');
    if (dot > 0) {
      const base = this.defs.get(id.slice(0, dot));
      const v = VARIANTS[id.slice(dot + 1)];
      if (base !== undefined && base.def.variants === true && base.variant < 0 && v !== undefined) {
        const r: Resolved = { def: base.def, palette: v.palette, element: v.element, variant: v.index };
        this.defs.set(id, r);
        return r;
      }
    }
    if (this.missing.size < 512) this.missing.add(id);
    return null;
  }

  spawnResolved(r: Resolved, o?: SpawnOpts): number {
    const t0 = performance.now();
    const def = r.def;
    let inst: Inst;
    if (def.loop) {
      if (def.follow === true) {
        // auras that follow the player are exclusive per preset: a new cast replaces the old one
        for (const other of this.insts) if (other.active && other.def === def && other.followPlayer) this.endInst(other);
      }
      if (this.freeN === 0) return 0;
      inst = this.insts[this.free[--this.freeN] as number] as Inst;
      inst.active = true;
      inst.def = def;
      inst.age = 0;
      inst.key = 0;
      inst.touched = this.frame;
      inst.ending = false;
      inst.acc0 = inst.acc1 = inst.acc2 = inst.acc3 = 0;
      inst.na = 0;
      inst.nd = 0;
      inst.sa.fill(-1);
      inst.sd.fill(-1);
      inst.trail = -1;
      inst.moved = false;
      inst.followPlayer = def.follow === true;
      inst.handle = ((this.gen++ & 0x7fffff) << 8) | inst.idx;
    } else {
      inst = this.scratch;
    }
    this.fillCtx(inst, r, o);
    // C2: loops spawned without an explicit duration by owners that stop them (feeds) live until stop()
    inst.total = def.loop ? loopTotal(def, o) : 0;
    inst.px = inst.x;
    inst.py = inst.y;
    inst.pz = inst.z;
    if (inst.followPlayer) {
      inst.x = this.players[0] as number;
      inst.y = this.players[1] as number;
      inst.z = this.players[2] as number;
    }
    def.fire(this.fx, inst);
    this.cpuAcc += performance.now() - t0;
    return def.loop ? inst.handle : 0;
  }

  private fillCtx(c: Inst, r: Resolved, o?: SpawnOpts): void {
    const fx = this.fx;
    const def = r.def;
    const x = o?.x ?? 0;
    const z = o?.z ?? 0;
    c.x = x;
    c.z = z;
    c.y = o?.y ?? fx.heightAt(x, z);
    let dx = o?.dirX ?? 0;
    let dz = o?.dirZ ?? 0;
    c.hasDir = true;
    if (o !== undefined && (o.dirX !== undefined || o.dirZ !== undefined) && dx * dx + dz * dz > 1e-8) {
      const l = Math.hypot(dx, dz);
      dx /= l;
      dz /= l;
      c.rot = Math.atan2(dx, dz);
    } else if (o?.rot !== undefined) {
      c.rot = o.rot;
      dx = Math.sin(o.rot);
      dz = Math.cos(o.rot);
    } else {
      dx = 0;
      dz = 1;
      c.rot = 0;
      c.hasDir = false;
    }
    c.dx = dx;
    c.dz = dz;
    const sc = o?.scale;
    if (def.size === 'radius') {
      c.radius = sc !== undefined && sc > 0 ? sc : def.base;
      c.scale = c.radius / def.base;
    } else {
      c.scale = sc !== undefined && sc > 0 ? sc : 1;
      c.radius = def.base * c.scale;
    }
    c.duration = o?.duration !== undefined && o.duration > 0 ? o.duration : def.dur;
    c.intensity = o?.intensity ?? 1;
    c.seed = o?.seed !== undefined ? (((o.seed * 0.6180339887) % 1) + 1) % 1 : fx.rng.f();
    c.hasTarget = o?.hasTarget === true;
    c.tx = o?.tx ?? 0;
    c.tz = o?.tz ?? 0;
    c.ty = o?.ty ?? (c.hasTarget ? fx.heightAt(c.tx, c.tz) : 0);
    c.a = o?.a ?? 0;
    c.b = o?.b ?? 0;
    c.rank = o?.rank !== undefined && Number.isFinite(o.rank) ? Math.max(0, Math.min(7, Math.round(o.rank))) : 0;
    c.awakened = o?.awakened === true || c.rank >= 7;
    const playerOpt = (o as (SpawnOpts & { player?: number }) | undefined)?.player;
    c.caster =
      playerOpt !== undefined && playerOpt >= 0
        ? playerOpt
        : o?.caster !== undefined && o.caster >= 0
          ? o.caster
          : -1;
    // palette precedence: variant suffix > explicit colour > element hint > preset default
    const col = parseColor(o?.color as VfxColor | undefined);
    c.tinted = col >= 0 && r.palette === null;
    c.variant = r.variant;
    let el = -1;
    const eo = o?.element;
    if (typeof eo === 'number') el = eo;
    else if (typeof eo === 'string') el = ELEMENT_NAMES.indexOf(eo);
    if (r.palette !== null) {
      copyPalette(PALETTES[r.palette], c.pal);
      el = r.element;
    } else if (col >= 0) {
      derivePalette(col, c.pal);
    } else if (el >= 0 && el < 8 && def.variants === true) {
      copyPalette(PALETTES[ELEMENT_PALETTE[el] as PaletteId], c.pal);
    } else {
      copyPalette(PALETTES[def.palette], c.pal);
    }
    c.element = el;
  }

  stop(handle: number): void {
    const i = handle & 255;
    const inst = this.insts[i];
    if (inst && inst.active && inst.handle === handle && !inst.ending) this.endInst(inst);
  }

  move(handle: number, x: number, z: number, y?: number, dirX?: number, dirZ?: number): void {
    const inst = this.insts[handle & 255];
    if (!inst || !inst.active || inst.handle !== handle) return;
    // zone rows report here every frame: the awakening explosion at their end belongs to the spec that owns its blast
    const g = this.guard();
    if (g.active && inst.def !== null) g.note(inst.def.id, -handle, x, z, this.time);
    this.moveInst(inst, x, z, y, dirX, dirZ);
  }

  private moveInst(inst: Inst, x: number, z: number, y: number | undefined, dirX: number | undefined, dirZ: number | undefined): void {
    inst.x = x;
    inst.z = z;
    inst.y = y ?? this.fx.heightAt(x, z);
    if (dirX !== undefined && dirZ !== undefined) {
      const l = Math.hypot(dirX, dirZ);
      if (l > 1e-6) {
        inst.dx = dirX / l;
        inst.dz = dirZ / l;
        inst.rot = Math.atan2(inst.dx, inst.dz);
      }
    }
    inst.moved = true;
  }

  track(id: string, key: number, x: number, z: number, y?: number, dirX?: number, dirZ?: number, scale?: number, color?: VfxColor, meta?: SkillMeta): void {
    const r = this.resolve(id);
    if (r === null || !r.def.loop) return;
    this.adapter.noteTrack(key, id, x, z); // a skill's `.explode` follows the body that stopped there (adapter.explodeOfTrack)
    const g = this.guard();
    if (g.active) g.note(r.def.id, key, x, z, this.time);
    let inst = this.findKey(key, r.def);
    if (inst === null) {
      const o = this.adapter.opts;
      o.x = x;
      o.z = z;
      o.y = y;
      o.dirX = dirX;
      o.dirZ = dirZ;
      o.scale = scale;
      o.color = color;
      o.duration = 0;
      o.element = undefined;
      o.hasTarget = false;
      o.rot = undefined;
      o.seed = undefined;
      o.intensity = undefined;
      o.a = undefined;
      o.b = undefined;
      o.rank = meta?.rank;
      o.awakened = meta?.awakened;
      o.caster = meta?.caster;
      const h = this.spawnResolved(r, o);
      if (h === 0) return;
      inst = this.insts[h & 255] as Inst;
      inst.key = key;
      inst.total = 0; // tracked effects live until the owner stops reporting
      this.addKey(key, inst);
    }
    inst.touched = this.frame;
    this.moveInst(inst, x, z, y, dirX, dirZ);
  }

  private findKey(key: number, def: PresetDef): Inst | null {
    if (key === 0) return null;
    const h = (Math.imul(key, 2654435761) >>> 0) & (KEY_TAB - 1);
    for (let n = 0; n < 8; n++) {
      const v = this.keyTab[(h + n) & (KEY_TAB - 1)] as number;
      if (v === 0) continue;
      const inst = this.insts[v - 1] as Inst;
      if (inst.active && inst.key === key && inst.def === def) return inst;
    }
    return null;
  }

  private addKey(key: number, inst: Inst): void {
    const h = (Math.imul(key, 2654435761) >>> 0) & (KEY_TAB - 1);
    for (let n = 0; n < 8; n++) {
      const s = (h + n) & (KEY_TAB - 1);
      const v = this.keyTab[s] as number;
      if (v === 0 || !(this.insts[v - 1] as Inst).active) {
        this.keyTab[s] = inst.idx + 1;
        return;
      }
    }
  }

  /** the awakening-explosion guard of the registry as it is now (an integer compare per call when nothing changed) */
  private guard(): BoomGuard {
    if (SPEC_REGISTRY.length !== this.boomN) {
      this.boomN = SPEC_REGISTRY.length;
      this.boom = new BoomGuard(SPEC_REGISTRY, this.boomCompanions);
    }
    return this.boom;
  }

  handleEvents(events: ArrayLike<unknown>, count?: number): void {
    const t0 = performance.now();
    const n = count ?? events.length;
    const g = this.guard();
    if (!g.active) for (let i = 0; i < n; i++) this.feed(events[i]);
    else g.dispatch(events, n, this.time, this.feed);
    this.cpuAcc += performance.now() - t0;
  }

  /** single sim event (for the app's per-event listener hub) */
  handleEvent(e: unknown): void {
    const t0 = performance.now();
    const g = this.guard();
    if (!g.active) this.feed(e);
    else g.dispatchOne(e, this.time, this.feed);
    this.cpuAcc += performance.now() - t0;
  }

  /** the event adapter (death/cast preset tables, telegraph toggle) */
  get events(): EventAdapter {
    return this.adapter;
  }

  /** true while the looping effect behind `handle` runs (feeds respawn a loop that died) */
  alive(handle: number): boolean {
    const inst = this.insts[handle & 255];
    return inst !== undefined && inst.active && inst.handle === handle && handle !== 0;
  }

  /** rank / caster lookup for skill effects fired by sim events (app/skillVfxFeed installs it each run) */
  setSkillMeta(fn: SkillMetaSource | null): void {
    this.adapter.skillMeta = fn;
  }

  /**
   * Body sockets of player `player`'s hero for socket-anchored skill elements (`attach: 'hand_r'` …): 6 sockets in
   * spec/sockets.ts SOCKET_ID order, 8 floats each [x, y, z, bladeLen, qx, qy, qz, qw], world space. Call every frame
   * after the hero animation updated (RenderWorld does).
   */
  setSockets(player: number, data: ArrayLike<number>): void {
    this.spec.setSockets(player, data);
  }

  

  standIn(player: number, x: number, y: number, z: number, yaw: number, t: number, mirror = 1, swing?: StandInSwing, pose?: StandInPose): void {
    this.spec.standInFor(player, x, y, z, yaw, t, mirror, swing, pose);
  }

  /**
   * Loads + packs the generated sprites (`tex: { art }`); await during loading (no pop-in). Without `specs` every
   * registered spec's sprites at the full cell size (galleries, compare strips); with `specs` (preset ids, e.g. the
   * run's `RenderCatalog.vfxSpecs`) only those specs' sprites, within the tier's VRAM budget (spec/README "Art roles").
   */
  preloadArt(source: ArtSource, specs?: Iterable<string>, tiers?: RunArtTiers): Promise<void> {
    return this.spec.preloadArt(source, specs, tiers);
  }

  /** the last art bake (sprites, layers, layer / cell edge px, VRAM bytes, ms): QA evals, perf notes */
  artStats(): ArtStats {
    return this.spec.artStats();
  }

  clear(): void {
    for (const inst of this.insts) {
      if (inst.active) this.releaseInst(inst);
    }
    for (const t of this.trails) {
      t.active = false;
      t.chunk = -1;
      t.chunkHandle = -1;
    }
    this.keyTab.fill(0);
    this.elemental?.clear();
    this.spec.clear();
    this.pAdd.clear();
    this.pAlpha.clear();
    this.sAdd.clear();
    this.sAlpha.clear();
    this.ribbons.clear();
    this.debris.clear();
    this.adapter.reset();
    this.runEvents.reset();
    this.boom.clear();
    this.flashT = 0;
    this.flashQuad?.set(0, 0, 0, 0);
  }

  // ------------------------------------------------------------------ loops

  private endInst(inst: Inst): void {
    inst.ending = true;
    const def = inst.def;
    if (def?.end) def.end(this.fx, inst);
    else this.killShapes(inst);
    if (inst.trail >= 0) {
      const t = this.trails[inst.trail] as Trail;
      t.ended = true;
      t.endTime = this.time;
      inst.trail = -1;
    }
    this.releaseInst(inst);
  }

  /** frees the slot; owned shapes get their kill fade first (done by end()/killShapes) */
  private releaseInst(inst: Inst): void {
    inst.active = false;
    inst.def = null;
    inst.key = 0;
    inst.handle = 0;
    this.free[this.freeN++] = inst.idx;
  }

  killShapes(inst: Inst): void {
    for (let i = 0; i < inst.na; i++) this.fx.shp.kill(inst.sa[i] as number);
    for (let i = 0; i < inst.nd; i++) this.fx.dec.kill(inst.sd[i] as number);
    inst.na = 0;
    inst.nd = 0;
    inst.sa.fill(-1);
    inst.sd.fill(-1);
  }

  /** begins a trail owned by `inst`; the system pushes its position every frame */
  trailBegin(inst: Inst, width: number, life: number, c0: number, c1: number, intensity = 1, style = 0): void {
    let ti = -1;
    for (let i = 0; i < MAX_TRAILS; i++) {
      if (!(this.trails[i] as Trail).active) {
        ti = i;
        break;
      }
    }
    if (ti < 0) return;
    const chunk = this.ribbons.alloc(this.time);
    if (chunk < 0) {
      this.fx.dropped++;
      return;
    }
    this.ribbons.pinned[chunk] = 1;
    this.ribbons.endT[chunk] = 1e9;
    const t = this.trails[ti] as Trail;
    t.active = true;
    t.owner = inst.idx;
    t.chunk = chunk;
    t.chunkHandle = this.ribbons.handleOf(chunk);
    t.n = 0;
    t.width = width;
    t.life = life;
    t.c0 = c0;
    t.c1 = c1;
    t.intensity = intensity;
    t.style = style;
    t.seed = this.fx.rng.f() * 10;
    t.lastX = inst.x;
    t.lastY = inst.y;
    t.lastZ = inst.z;
    t.ended = false;
    inst.trail = ti;
    this.trailsLive++;
  }

  private updateTrails(): void {
    const time = this.time;
    const rb = this.ribbons;
    const pts = this.fx.rb.pts;
    for (let ti = 0; ti < MAX_TRAILS; ti++) {
      const t = this.trails[ti] as Trail;
      if (!t.active) continue;
      const chunk = rb.resolveHandle(t.chunkHandle);
      if (chunk < 0) {
        t.active = false;
        t.chunk = -1;
        t.chunkHandle = -1;
        continue;
      }
      if (!t.ended) {
        const o = this.insts[t.owner] as Inst;
        const dx = o.x - t.lastX, dy = o.y - t.lastY, dz = o.z - t.lastZ;
        if (dx * dx + dy * dy + dz * dz > 0.0016 || t.n === 0) {
          const max = R_PTS - 1;
          const keep = t.n < max ? t.n : max;
          t.pts.copyWithin(4, 0, keep * 4);
          t.pts[0] = o.x;
          t.pts[1] = o.y;
          t.pts[2] = o.z;
          t.pts[3] = time;
          t.n = keep + 1;
          t.lastX = o.x;
          t.lastY = o.y;
          t.lastZ = o.z;
        }
      }
      // drop aged points
      while (t.n > 0 && time - (t.pts[(t.n - 1) * 4 + 3] as number) > t.life) t.n--;
      if (t.n === 0 && t.ended) {
        t.active = false;
        t.chunk = -1;
        t.chunkHandle = -1;
        rb.pinned[chunk] = 0;
        rb.endT[chunk] = 0;
        // blank the chunk so nothing lingers
        pts[3] = 0;
        pts[5] = -1e6;
        pts[6] = 1;
        for (let k = 0; k < 7; k++) pts[7 + k] = pts[k] as number;
        rb.writeStrip(chunk, 2, pts, 0, 0, 0, 0, 0, 0);
        continue;
      }
      if (t.n < 2) continue;
      const n = t.n;
      for (let i = 0; i < n; i++) {
        const o = i * 7;
        const s = i * 4;
        const age = (time - (t.pts[s + 3] as number)) / t.life;
        pts[o] = t.pts[s] as number;
        pts[o + 1] = t.pts[s + 1] as number;
        pts[o + 2] = t.pts[s + 2] as number;
        pts[o + 3] = t.width * 0.5;
        pts[o + 4] = age < 0 ? 0 : age > 1 ? 1 : age;
        pts[o + 5] = t.pts[s + 3] as number;
        pts[o + 6] = t.life;
      }
      rb.writeStrip(chunk, n, pts, t.style, t.intensity, 0, t.seed, t.c0, t.c1);
    }
  }

  // ------------------------------------------------------------------ frame

  update(dt: number): void {
    const t0 = performance.now();
    const d = dt > 0.1 ? 0.1 : dt < 0 ? 0 : dt;
    this.frame++;
    this.elemental?.update(dt > 0.1 ? 0.1 : dt < 0 ? 0 : dt);
    this.time += d;
    const fx = this.fx;
    fx.time = this.time;
    this.uniforms.uTime.value = this.time;
    this.lastSpawned = fx.spawned;
    this.lastDropped = fx.dropped;
    fx.spawned = 0;
    fx.dropped = 0;
    fx.budget = this.profile.spawnPerFrame;
    this.screen.shake = 0;

    if (d > 0) {
      // the run event's rings ride their anchors (the champion) before the instances below read `moved`
      this.runEvents.update(d);
      const insts = this.insts;
      for (let i = 0; i < MAX_INST; i++) {
        const inst = insts[i] as Inst;
        if (!inst.active) continue;
        inst.age += d;
        if (inst.followPlayer) {
          const x = this.players[0] as number;
          const z = this.players[2] as number;
          if (x !== inst.x || z !== inst.z) {
            inst.x = x;
            inst.z = z;
            inst.y = this.players[1] as number;
            inst.moved = true;
          }
        }
        if (inst.key !== 0 && this.frame - inst.touched > 1) {
          this.endInst(inst);
          continue;
        }
        const def = inst.def as PresetDef;
        if (inst.moved && inst.na + inst.nd > 0) {
          for (let k = 0; k < inst.na; k++) fx.shp.move(inst.sa[k] as number, inst.x, inst.y + (inst.sya[k] as number), inst.z);
          for (let k = 0; k < inst.nd; k++) fx.dec.move(inst.sd[k] as number, inst.x, inst.y + (inst.syd[k] as number), inst.z);
        }
        def.tick?.(fx, inst, d);
        inst.px = inst.x;
        inst.py = inst.y;
        inst.pz = inst.z;
        inst.moved = false;
        if (inst.total > 0 && inst.age >= inst.total) this.endInst(inst);
      }
      this.adapter.update(d);
      this.updateTrails();
    }

    // flash
    if (this.flashT > 0) {
      this.flashT -= d;
      const k = this.flashDur > 0 ? Math.max(0, this.flashT / this.flashDur) : 0;
      const s = this.screen;
      s.flashA = this.flashPeak * k * k;
      if (this.flashT <= 0) s.flashA = 0;
      this.flashQuad?.set(s.flashR, s.flashG, s.flashB, s.flashA);
    }

    this.spec.update(d);
    this.pAlpha.flush(this.time);
    this.pAdd.flush(this.time);
    this.sAlpha.flush(this.time);
    this.sAdd.flush(this.time);
    this.ribbons.flush(this.time);
    this.debris.flush(this.time);
    this.debris.mesh.visible = this.debris.used > 0;
    this.sAlpha.mesh.visible = this.sAlpha.used > 0;
    this.sAdd.mesh.visible = this.sAdd.used > 0;
    this.pAlpha.mesh.visible = this.pAlpha.used > 0;
    this.pAdd.mesh.visible = this.pAdd.used > 0;
    this.ribbons.mesh.visible = this.ribbons.used > 0;

    if (this.uniforms.uSoft.value > 0.5) {
      this.renderer.getDrawingBufferSize(this.tmpV);
      this.uniforms.uInvRes.value.x = 1 / this.tmpV.x;
      this.uniforms.uInvRes.value.y = 1 / this.tmpV.y;
    }
    this.cpuMs = this.cpuAcc + (performance.now() - t0);
    this.cpuAcc = 0;
  }

  private flashPeak = 0;

  private flash(r: number, g: number, b: number, a: number, dur: number): void {
    const s = this.screen;
    s.flashR = r;
    s.flashG = g;
    s.flashB = b;
    this.flashPeak = a;
    this.flashDur = dur;
    this.flashT = dur;
    s.flashA = a;
    this.opts.onFlash?.(r, g, b, a, dur);
    this.flashQuad?.set(r, g, b, a);
  }

  stats(): VfxStats {
    const now = this.time;
    const pa = this.pAdd.live(now);
    const pl = this.pAlpha.live(now);
    let drawCalls = 0;
    let tris = 0;
    for (const m of this.meshes) if (m.visible) drawCalls++;
    if (this.flashQuad?.mesh.visible) drawCalls++;
    const el = this.elemental !== null ? this.elemental.stats() : { active: 0, drawCalls: 0 };
    drawCalls += el.drawCalls;
    const sp = this.spec.stats();
    drawCalls += sp.drawCalls;
    tris += sp.triangles;
    tris += this.pAdd.used * 2 + this.pAlpha.used * 2;
    tris += this.sAdd.used * 384 + this.sAlpha.used * 384;
    tris += this.ribbons.used * 62;
    tris += this.debris.used * 10;
    let loops = 0;
    for (const i of this.insts) if (i.active) loops++;
    return {
      drawCalls,
      particles: pa + pl + sp.particles,
      particlesAdd: pa,
      particlesAlpha: pl,
      shapes: this.sAdd.live(now) + this.sAlpha.live(now),
      ribbons: this.ribbons.live(now),
      debris: this.debris.live(now),
      loops,
      spawnedThisFrame: this.lastSpawned,
      droppedThisFrame: this.lastDropped,
      cpuMs: this.cpuMs,
      quality: this.quality,
      triangles: tris,
      elementalActive: el.active,
      elementalCalls: el.drawCalls,
      specActive: sp.active,
      specCalls: sp.drawCalls,
      specParticles: sp.particles,
      specSurfaces: sp.surfaces,
    };
  }

  /** Re-bakes GPU render targets (legacy atlas/noise, spec fallback atlas, spec art array) after WebGL context restoration. */
  onContextRestored(): void {
    this.textures.onContextRestored();
    this.uniforms.uAtlas.value = this.textures.atlas;
    this.uniforms.uNoise.value = this.textures.noise;
    const spec = this.spec as unknown as {
      atlas?: { onContextRestored?: () => void };
      lutTex?: Texture;
      anchorTex?: Texture;
      syncArt?: () => void;
    };
    spec.atlas?.onContextRestored?.();
    if (spec.lutTex) spec.lutTex.needsUpdate = true;
    if (spec.anchorTex) spec.anchorTex.needsUpdate = true;
    this.spec.art.onContextRestored();
    this.spec.uniforms.uSpecArt.value = this.spec.art.texture;
    this.spec.uniforms.uArtGrid.value = this.spec.art.grid;
    spec.syncArt?.();
  }

  dispose(): void {
    this.offPresets();
    this.elemental?.dispose();
    this.spec.dispose();
    for (const m of this.meshes) this.scene.remove(m as never);
    if (this.flashQuad) {
      this.scene.remove(this.flashQuad.mesh);
      this.flashQuad.dispose();
    }
    this.pAdd.dispose();
    this.pAlpha.dispose();
    this.sAdd.dispose();
    this.sAlpha.dispose();
    this.ribbons.dispose();
    this.debris.dispose();
    this.textures.dispose();
  }
}
