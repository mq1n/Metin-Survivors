// A buff / socket slot with its count as a corner tag (round 6): the stack numeral never sits on the icon art. The tag is a small
// bronze plaque (the painted uk_hud_tag once it is a CSS variable, a drawn bevel before) that overhangs the lower-right corner of the
// octagon, so the icon keeps its whole face and a cream '4' can not vanish on a white drop.
import type { ComponentChildren, JSX } from 'preact';

export function Tagged({ tag, children }: { tag?: ComponentChildren; children: ComponentChildren }): JSX.Element {
  const has = tag !== undefined && tag !== null && tag !== '';
  return (
    <span class={`ms-hbf ${has ? 'has-tag' : ''}`}>
      {children}
      {has && (
        <i class="ms-hbf-tag ms-num" aria-hidden="true">
          {tag}
        </i>
      )}
    </span>
  );
}
