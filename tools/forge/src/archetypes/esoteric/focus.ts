// Triangle-density focus for the esoteric crowd models. The default humanoid focus (head gain 2.6) leaves a 4.7k-tri head as a faceted
// blob; the head carries the identity at portrait distance, so it gets most of the extra density. Regions with gain < 1 are decimated harder.
import type { FocusRegion } from '../../core/mesh/simplify.ts';
import { type HumanoidParams, computeAnatomy } from '../humanoid/index.ts';

export interface CrowdFocus {
  /** head gain (default 9) and radius in body-scale metres (default 0.26) */
  head?: number;
  headR?: number;
  /** palm gain (default 2) */
  hands?: number;
  /** chest gain (0 = none) */
  chest?: number;
  /** knee / shin gain (< 1 = coarser legs; 0 = none) */
  legs?: number;
  extra?: FocusRegion[];
}

export function crowdFocus(hp: HumanoidParams, o: CrowdFocus = {}): FocusRegion[] {
  const a = computeAnatomy(hp);
  const s = a.s;
  const f: FocusRegion[] = [
    { c: a.skull, r: (o.headR ?? 0.26) * s, gain: o.head ?? 9 },
    { c: a.side(1).palm, r: 0.14 * s, gain: o.hands ?? 2 },
    { c: a.side(-1).palm, r: 0.14 * s, gain: o.hands ?? 2 },
  ];
  if (o.chest) f.push({ c: a.chest, r: 0.32 * s, gain: o.chest });
  if (o.legs) {
    for (const sx of [1, -1] as const) f.push({ c: [a.side(sx).knee[0], (a.side(sx).knee[1] + a.side(sx).ankle[1]) / 2, a.side(sx).knee[2]], r: 0.4 * s, gain: o.legs });
  }
  if (o.extra) f.push(...o.extra);
  return f;
}
