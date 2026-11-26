// Armory art kit (armory-a, r2): the painted bits every armory tab shares.
//  - artVars(): the shipped uk_* materials as CSS custom properties on the armory root (tag plate, octagon ring, tray frame,
//    swirl, cap rule). Every use has a CSS fallback, so a missing material never breaks a screen.
//  - <Tag>: a small painted bronze plate (uk_hud_tag) for counts, times and states. Replaces the flat dark chips.
//  - <BeastFace>: the octagon bay with the painted ring and a glyph in it: what the Codex / Drop Tables show when an `icon_enemy_<id>`
//    card is missing (every shipped enemy and boss has one) and the zone-loot chest of Drop Tables.
import type { ComponentChildren, JSX } from 'preact';
import { texUrl } from '../../assets';
import type { TipHandlers } from '../../components/Tooltip';
import './armory-art.css';

const MATS: readonly (readonly [id: string, cssVar: string])[] = [
  ['uk_hud_tag', '--tex-tag'],
  ['uk_online_octring', '--tex-octring'],
  ['uk_hud_tray', '--tex-tray'],
  ['uk_story_swirl', '--tex-swirl'],
  ['uk_pause_settings_cap', '--tex-rule'],
  ['uk_runend_results_granite', '--tex-granite'],
];

/** The painted materials as custom properties (set on the armory root). */
export function artVars(): JSX.CSSProperties {
  const out: Record<string, string> = {};
  for (const [id, v] of MATS) {
    const u = texUrl(id);
    if (u) out[v] = `url("${u}")`;
  }
  return out as JSX.CSSProperties;
}

export type TagTone = 'neutral' | 'gold' | 'red' | 'blue' | 'dim';

export function Tag({ tone = 'neutral', icon, class: cls, children, title }: { tone?: TagTone; icon?: ComponentChildren; class?: string; children?: ComponentChildren; title?: string }): JSX.Element {
  return (
    <span class={`ms-tag ms-tag--${tone} ${cls ?? ''}`} title={title}>
      {icon !== undefined && <span class="ms-tag-ico">{icon}</span>}
      <span class="ms-tag-text">{children}</span>
    </span>
  );
}

export type FaceSize = 'sm' | 'md' | 'lg' | 'xl';

export interface BeastFaceProps {
  size?: FaceSize;
  /** rarity class (ms-r-<tier>) tinting the bay glow */
  rarity?: string;
  /** not met yet: a dark silhouette, no colour */
  locked?: boolean;
  /** the glyph drawn in the bay */
  fallback?: ComponentChildren;
  class?: string;
}

/** Octagon bay with the painted ring and a glyph: the stand-in of a creature card that is not shipped, and the zone-loot chest. */
export function BeastFace({ size = 'md', rarity, locked, fallback, class: cls }: BeastFaceProps): JSX.Element {
  return (
    <span class={`ms-bf ms-bf--${size} ${rarity ? `ms-r-${rarity}` : ''} ${locked ? 'is-locked' : ''} ${cls ?? ''}`} aria-hidden="true">
      <span class="ms-bf-bay">
        <span class="ms-bf-fb">{fallback}</span>
      </span>
      <i class="ms-bf-ring" />
    </span>
  );
}

/** One grey stone plate of a radio row (the kit's bevelled button; the chosen plate is lit gold). Spread `tipProps(...)` on it for a tooltip. */
export function Plate({ on, onClick, children, class: cls, style, ...handlers }: { on: boolean; onClick: () => void; children: ComponentChildren; class?: string; style?: JSX.CSSProperties } & Partial<TipHandlers>): JSX.Element {
  return (
    <button type="button" role="radio" aria-checked={on} class={`ms-kbtn ms-plate ms-kbtn--stone ms-kbtn--small ms-chr-tog ${on ? 'is-active' : ''} ${cls ?? ''}`} style={style} data-nav="" onClick={onClick} {...handlers}>
      {children}
    </button>
  );
}

export interface StripItem {
  key: string;
  text: ComponentChildren;
  icon?: ComponentChildren;
  tone?: 'neutral' | 'gold' | 'red' | 'dim';
  /** lining tabular numerals (times, counts) */
  num?: boolean;
  title?: string;
  /** extra classes of the item (e.g. `ms-r-epic ms-rc` for a rarity colour) */
  cls?: string;
}





export function DataStrip({ items, class: cls }: { items: readonly StripItem[]; class?: string }): JSX.Element {
  return (
    <ul class={`ms-ds ${cls ?? ''}`}>
      {items.map((i) => (
        <li key={i.key} class={`ms-ds-i ms-ds-i--${i.tone ?? 'neutral'} ${i.cls ?? ''}`} title={i.title}>
          {i.icon !== undefined && <span class="ms-ds-ico">{i.icon}</span>}
          <span class={`ms-ds-t ${i.num ? 'ms-num' : ''}`}>{i.text}</span>
        </li>
      ))}
    </ul>
  );
}
