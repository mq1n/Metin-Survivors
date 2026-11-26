// Kit v1 rank medal (C4): the engraved badge on a slot corner. Skill ranks 1 2 3 M1 M2 G1 G2 P wear a band medal (pewter /
// teal-jade / maroon-gilt / violet-gilt, separable by hue alone at 40 px, P unique and lit); any other badge text (passive
// rank, stone "+2", trinket rank) wears the plain tag. Drawn in CSS (chamfered plate recipe) so it is exact at every size
// and DPR; the glyph-level medallions of the engraved icon kit (GradeIcon, C11) are the large decorative cousins.
import type { ComponentChildren, JSX } from 'preact';
import { rankBand, type RankBand } from '../assets';
import { rankLabel } from '../content';

export type MedalSize = 'xs' | 'sm' | 'md' | 'lg';

export interface MedalProps {
  /** skill rank index 0..7 -> band + label */
  rank?: number;
  /** explicit band (with `label`) */
  band?: RankBand;
  /** text (default for `rank`: 1 2 3 M1 M2 G1 G2 P) */
  label?: ComponentChildren;
  /** plain tag (no band colour): passive rank, stone level, counts */
  tag?: boolean;
  /** size follows the slot it sits in by default (CSS); force one here */
  size?: MedalSize;
  /** extra classes (a slot passes `ms-slot-rank` so screen sheets that style it keep working) */
  class?: string;
  title?: string;
}

export function Medal({ rank, band, label, tag, size, class: cls, title }: MedalProps): JSX.Element {
  const b: RankBand | 'tag' = tag ? 'tag' : (band ?? (rank !== undefined ? rankBand(rank) : 'tag'));
  const text = label ?? (rank !== undefined ? rankLabel(rank) : '');
  const long = typeof text === 'string' && text.length >= 3;
  return (
    <span class={`ms-medal ms-plate ms-medal--${b} ${long ? 'ms-medal--long' : ''} ${size ? `ms-medal--${size}` : ''} ${cls ?? ''}`} title={title}>
      {text}
    </span>
  );
}
