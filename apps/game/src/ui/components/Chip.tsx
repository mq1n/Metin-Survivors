// Kit v1 chip (C4): a small chamfered tag (2-6 px cuts, never a pill) for states and categories: NEW, rarity words,
// element names, "Boss", "Owned". Same plate recipe as the buttons, so bevel and outline are exact at every DPR.
import type { ComponentChildren, JSX } from 'preact';

export type ChipTone = 'neutral' | 'gold' | 'red' | 'jade' | 'info' | 'new' | 'violet';

export interface ChipProps {
  children?: ComponentChildren;
  tone?: ChipTone;
  /** small icon / glyph before the text */
  icon?: ComponentChildren;
  size?: 'sm' | 'md';
  class?: string;
  title?: string;
}

export function Chip({ children, tone = 'neutral', icon, size = 'md', class: cls, title }: ChipProps): JSX.Element {
  return (
    <span class={`ms-kchip ms-plate ms-kchip--${tone} ${size === 'sm' ? 'ms-kchip--sm' : ''} ${cls ?? ''}`} title={title}>
      {icon !== undefined && <span class="ms-kchip-icon">{icon}</span>}
      {children}
    </span>
  );
}
