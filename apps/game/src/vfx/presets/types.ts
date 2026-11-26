import type { Ctx, Fx } from '../emit';
import type { PaletteId } from '../palette';
import type { Inst } from '../system';

export type PresetCategory =
  | 'hit'
  | 'melee'
  | 'ranged'
  | 'area'
  | 'buff'
  | 'summon'
  | 'beam'
  | 'sky'
  | 'trail'
  | 'death'
  | 'spawn'
  | 'pickup'
  | 'metin'
  | 'boss'
  | 'telegraph'
  | 'ambient'
  | 'ui';

export interface PresetDef {
  /** stable id, `<group>.<name>[.<variant>]` */
  id: string;
  cat: PresetCategory;
  /** one line for the README / gallery label */
  desc: string;
  /** how `SpawnOpts.scale` is read: `mult` = multiplier of the authored size, `radius` = metres of area radius */
  size: 'mult' | 'radius';
  /** authored radius in metres (radius presets: the size at scale == base; mult presets: nominal footprint) */
  base: number;
  /** default palette (suffix / `color` / `element` hints override it) */
  palette: PaletteId;
  /** accepts a palette/element suffix (`id.gold`) and the `element` hint */
  variants?: boolean;
  /** seconds; > 0 for loops (zones, auras, trails, ambient) */
  dur: number;
  /** true → returns a handle, ticks every frame, can be stopped / moved */
  loop: boolean;
  /** loops only: lives until stop() when the caller passes no explicit duration (C2; persistentAura specs get this
   *  behaviour from VfxSystem automatically) — `dur` is then just the gallery / default demo length */
  untilStopped?: boolean;
  /** follows player 0 (auras, buffs) */
  follow?: boolean;
  /** needs `tx,tz` (beams, chains, lanes) */
  needsTarget?: boolean;
  fire(fx: Fx, c: Ctx): void;
  tick?(fx: Fx, c: Inst, dt: number): void;
  end?(fx: Fx, c: Inst): void;
  /** gallery hints */
  demo?: { target?: number; dir?: number; ground?: boolean; loopFor?: number };
}
