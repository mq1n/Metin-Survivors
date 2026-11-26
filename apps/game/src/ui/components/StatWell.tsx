
// gold, stat points), optionally with its caption beside / above it. `dotted` adds the dotted-corner sunken box of the
// refine dialog. Digits use the lining + tabular numerals (.ms-num).
import type { ComponentChildren, JSX } from 'preact';

export type WellSize = 'sm' | 'md' | 'lg' | 'hero';
export type WellTone = 'neutral' | 'gold' | 'good' | 'bad' | 'info';

export interface StatWellProps {
  value: ComponentChildren;
  /** caption: beside the well (`row`), above it (`stack`) */
  label?: ComponentChildren;
  /** small icon inside the well, left of the number */
  icon?: ComponentChildren;
  /** unit / suffix after the number (s, %, /sec) */
  unit?: ComponentChildren;
  /** row: caption left, well right (stretches); stack: caption over the well; inline (default without label): only the well */
  layout?: 'row' | 'stack' | 'inline';
  size?: WellSize;
  tone?: WellTone;
  /** dotted corner marks (refine / socket dialogs) */
  dotted?: boolean;
  /** left-align the number (default: right, like a counter) */
  left?: boolean;
  class?: string;
  title?: string;
}

export function StatWell({ value, label, icon, unit, layout, size = 'md', tone = 'neutral', dotted, left, class: cls, title }: StatWellProps): JSX.Element {
  const lay = layout ?? (label !== undefined ? 'row' : 'inline');
  const well = (
    <span class={`ms-well ms-well--${size} ms-well--${tone} ${dotted ? 'ms-well--dotted' : ''} ${left ? 'ms-well--left' : ''} ${lay === 'inline' ? (cls ?? '') : ''}`} title={lay === 'inline' ? title : undefined}>
      {icon !== undefined && <span class="ms-well-icon">{icon}</span>}
      <b class="ms-well-value ms-num">{value}</b>
      {unit !== undefined && <span class="ms-well-unit">{unit}</span>}
    </span>
  );
  if (lay === 'inline') return well;
  return (
    <span class={`ms-statwell ms-statwell--${lay} ${cls ?? ''}`} title={title}>
      <span class="ms-statwell-label">{label}</span>
      {well}
    </span>
  );
}
