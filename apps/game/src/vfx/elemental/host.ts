// Host for the "elemental" signature effects (big, infrequent, readable). Each effect is a pooled Object3D tree that is only
// visible (and therefore only drawn) while active; the host enforces a draw-call budget, scales effects by quality tier and
// pre-compiles every material at load. Frequent effects stay in the batched system (../system.ts).
import { Group, type Camera, type Scene, type WebGLRenderer } from 'three';
import type { Ctx, Fx } from '../emit';
import { frame } from './frame';

/** 0 low … 3 ultra (index of VfxQuality) */
export type Tier = 0 | 1 | 2 | 3;

/** Draw calls the elemental layer may add while effects are active, per tier. Total VFX ≤ 20 at peak = 6 batches + flash quad + ≤4 spec-runtime calls + this. */
export const ELEMENTAL_CALL_BUDGET: Readonly<[number, number, number, number]> = [0, 6, 8, 9];

/**
 * A pooled signature effect. Subclasses build their meshes once (`build`), are re-armed per cast (`start`), advance in `step`
 * and are hidden by `reset`. No allocation in `start`/`step`: module-scope scratch vectors only.
 */
export abstract class ElementalEffect {
  active = false;
  /** seconds since `start` */
  age = 0;
  /** draw calls this effect adds while active (declared; used for the budget) */
  abstract readonly cost: number;
  readonly root = new Group();
  host!: ElementalHost;

  /** Creates meshes/materials/geometry and adds them under `root` (called once per pooled instance). */
  abstract build(): void;
  /** Arms a cast from the spawn context. Return false to refuse (the preset then falls back to its batched look). */
  abstract start(c: Ctx): boolean;
  /** Advances by `dt` seconds; return false when finished (the host then calls `reset`). */
  abstract step(dt: number): boolean;
  /** Hides everything and releases per-cast state. */
  reset(): void {
    this.root.visible = false;
  }
  abstract dispose(): void;
}

export interface EffectDef {
  /** stable kind id, e.g. `storm.bolt` */
  kind: string;
  create: () => ElementalEffect;
  /** max pooled instances (= max simultaneous casts of this kind) */
  pool: number;
  /** lowest tier that runs it (lower tiers fall back to the batched recipe) */
  minTier: Tier;
}

interface Entry {
  def: EffectDef;
  items: ElementalEffect[];
}

export class ElementalHost {
  readonly group = new Group();
  readonly fx: Fx;
  tier: Tier;
  time = 0;
  private readonly entries = new Map<string, Entry>();
  private readonly list: Entry[] = [];
  private activeN = 0;
  private activeCost = 0;

  constructor(
    private readonly scene: Scene,
    private readonly camera: Camera,
    private readonly renderer: WebGLRenderer,
    fx: Fx,
    tier: Tier,
    defs: ReadonlyArray<EffectDef>,
  ) {
    this.fx = fx;
    this.tier = tier;
    this.group.name = 'vfx-elemental';
    this.group.renderOrder = 30;
    scene.add(this.group);
    for (const def of defs) {
      const e: Entry = { def, items: [] };
      this.entries.set(def.kind, e);
      this.list.push(e);
    }
  }

  has(kind: string): boolean {
    return this.entries.has(kind);
  }

  /** true when `kind` exists and the current tier runs it */
  enabled(kind: string): boolean {
    const e = this.entries.get(kind);
    return e !== undefined && this.tier >= e.def.minTier;
  }

  /**
   * Starts a signature effect. Returns false (nothing drawn) when the tier does not run it, the draw-call budget or the pool is
   * exhausted, or the effect refuses; presets then play their batched version instead.
   */
  cast(kind: string, c: Ctx): boolean {
    const e = this.entries.get(kind);
    if (e === undefined || this.tier < e.def.minTier) return false;
    let free: ElementalEffect | null = null;
    const items = e.items;
    for (let i = 0; i < items.length; i++) {
      const it = items[i] as ElementalEffect;
      if (!it.active) {
        free = it;
        break;
      }
    }
    if (free === null) {
      if (items.length >= e.def.pool) return false;
      free = this.grow(e);
    }
    if (this.activeCost + free.cost > ELEMENTAL_CALL_BUDGET[this.tier]) return false;
    free.age = 0;
    if (!free.start(c)) {
      free.reset();
      return false;
    }
    free.active = true;
    free.root.visible = true;
    this.activeN++;
    this.activeCost += free.cost;
    return true;
  }

  private grow(e: Entry): ElementalEffect {
    const it = e.def.create();
    it.host = this;
    it.build();
    it.root.visible = false;
    this.group.add(it.root);
    e.items.push(it);
    return it;
  }

  update(dt: number): void {
    this.time += dt;
    frame.uTime.value = this.time;
    frame.uDelta.value = dt;
    for (let k = 0; k < this.list.length; k++) {
      const items = (this.list[k] as Entry).items;
      for (let i = 0; i < items.length; i++) {
        const it = items[i] as ElementalEffect;
        if (!it.active) continue;
        it.age += dt;
        if (!it.step(dt)) {
          it.active = false;
          it.reset();
          this.activeN--;
          this.activeCost -= it.cost;
        }
      }
    }
  }

  setTier(t: Tier): void {
    this.tier = t;
  }

  /** active effects and the draw calls they add right now */
  stats(): { active: number; drawCalls: number } {
    return { active: this.activeN, drawCalls: this.activeCost };
  }

  clear(): void {
    for (let k = 0; k < this.list.length; k++) {
      const items = (this.list[k] as Entry).items;
      for (let i = 0; i < items.length; i++) {
        const it = items[i] as ElementalEffect;
        if (it.active) {
          it.active = false;
          it.reset();
        }
      }
    }
    this.activeN = 0;
    this.activeCost = 0;
  }

  /** Builds one instance of every enabled effect and compiles all their programs while hidden (call at load). */
  async precompile(): Promise<void> {
    for (const e of this.list) {
      if (this.tier < e.def.minTier || e.items.length > 0) continue;
      this.grow(e);
    }
    for (const e of this.list) for (const it of e.items) it.root.visible = true;
    try {
      await this.renderer.compileAsync(this.group, this.camera, this.scene);
    } finally {
      for (const e of this.list) for (const it of e.items) it.root.visible = it.active;
    }
  }

  dispose(): void {
    for (const e of this.list) for (const it of e.items) it.dispose();
    this.scene.remove(this.group);
    this.entries.clear();
    this.list.length = 0;
  }
}
