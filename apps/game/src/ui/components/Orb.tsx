// Kit v1 orb frame (C5 companion, T8): the round bronze-pewter ring (painted uk_orb_ring, four lotus ornaments at N/E/S/W)
// around a portrait or any content, with an optional level plate on the lower rim. The HUD taskbar (hero orb), the hero
// select class medallion and the co-op roster use it. Without the painted ring a CSS pewter ring is drawn.
import type { ComponentChildren, JSX } from 'preact';
import { Medal } from './Medal';

export interface OrbProps {
  /** portrait / face image url (drawn cover-fit inside the ring) */
  src?: string | null;
  /** or any content (an emblem, a glyph) */
  children?: ComponentChildren;
  /** outer width (any CSS length, default 5rem) */
  size?: string;
  /** level / rank text on a plate at the lower rim */
  level?: ComponentChildren;
  /** soft coloured light behind the ring (class colour, rarity colour) */
  glow?: string;
  alt?: string;
  class?: string;
  title?: string;
}

export function Orb({ src, children, size, level, glow, alt, class: cls, title }: OrbProps): JSX.Element {
  const style: Record<string, string> = {};
  if (size) style['--o'] = size;
  if (glow) style['--o-glow'] = glow;
  return (
    <span class={`ms-orb ${glow ? 'ms-orb--glow' : ''} ${cls ?? ''}`} style={style as JSX.CSSProperties} title={title}>
      <span class="ms-orb-face">{src ? <img src={src} alt={alt ?? ''} draggable={false} decoding="async" /> : children}</span>
      <span class="ms-orb-ring" aria-hidden="true" />
      {level !== undefined && <Medal tag label={level} class="ms-orb-level" />}
    </span>
  );
}
