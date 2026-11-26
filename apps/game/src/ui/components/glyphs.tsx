// Glyph library: small engraved silhouettes (24×24, fill = currentColor) used for (a) permanent UI symbols — Yeop coin,
// Metin shard, skull, clock, heart … — and (b) the procedural fallback art of item icons that have no painted icon yet.
import type { ComponentChildren, JSX } from 'preact';
import { CurrencyIcon, StatIcon, UiGlyph, type CurrencyKind, type StatId, type UiGlyphName, type UiTone } from './StatIcon';

export type GlyphName =
  | 'sword'
  | 'daggers'
  | 'bow'
  | 'flame'
  | 'frost'
  | 'bolt'
  | 'skull'
  | 'shield'
  | 'star'
  | 'drop'
  | 'wind'
  | 'ring'
  | 'gem'
  | 'amulet'
  | 'helmet'
  | 'boot'
  | 'bracelet'
  | 'earring'
  | 'claw'
  | 'dragon'
  | 'talisman'
  | 'heart'
  | 'coin'
  | 'shard'
  | 'clock'
  | 'stone'
  | 'chest'
  | 'crown'
  | 'orb'
  | 'fist'
  | 'eye'
  | 'wolf'
  | 'plus'
  | 'lock'
  | 'gear'
  | 'sound'
  | 'cloud'
  | 'link'
  | 'person'
  | 'trophy'
  | 'book'
  | 'swords'
  | 'close'
  | 'pause'
  | 'arrow';

const SWORD = (
  <g transform="rotate(45 12 12)">
    <path d="M12 1.2 14.3 4.6V15.4H9.7V4.6Z" />
    <rect x="6.2" y="15.4" width="11.6" height="2.1" rx="1" />
    <rect x="10.9" y="17.5" width="2.2" height="3.6" />
    <circle cx="12" cy="22" r="1.3" />
  </g>
);

const G: Record<GlyphName, ComponentChildren> = {
  sword: SWORD,
  swords: (
    <g>
      <g transform="rotate(45 12 12) scale(.92) translate(1 .8)">
        <path d="M12 1.2 14.3 4.6V15.4H9.7V4.6Z" />
        <rect x="6.2" y="15.4" width="11.6" height="2.1" rx="1" />
        <rect x="10.9" y="17.5" width="2.2" height="3.6" />
      </g>
      <g transform="rotate(-45 12 12) scale(.92) translate(-1 .8)">
        <path d="M12 1.2 14.3 4.6V15.4H9.7V4.6Z" />
        <rect x="6.2" y="15.4" width="11.6" height="2.1" rx="1" />
        <rect x="10.9" y="17.5" width="2.2" height="3.6" />
      </g>
    </g>
  ),
  daggers: (
    <g>
      <g transform="rotate(32 12 12)">
        <path d="M12 2 13.8 5V12H10.2V5Z" />
        <rect x="8.4" y="12" width="7.2" height="1.6" rx=".8" />
        <rect x="11.1" y="13.6" width="1.8" height="3.4" />
      </g>
      <g transform="rotate(-32 12 12)">
        <path d="M12 2 13.8 5V12H10.2V5Z" />
        <rect x="8.4" y="12" width="7.2" height="1.6" rx=".8" />
        <rect x="11.1" y="13.6" width="1.8" height="3.4" />
      </g>
      <path d="M12 17.5 15 22H9Z" />
    </g>
  ),
  bow: (
    <g>
      <path d="M5.5 2.5C14.5 4 18 9 18 12S14.5 20 5.5 21.5C9 17.5 9.8 14.6 9.8 12S9 6.5 5.5 2.5Z" />
      <path d="M2.5 12 21.5 12 18.6 9.4 18.9 11.2H2.5Z" />
      <path d="M2.5 12.8 18.9 12.8 18.6 14.6 21.5 12Z" opacity=".9" />
    </g>
  ),
  flame: (
    <path d="M12.6 1.5C13.4 5 17.5 7.6 17.5 13.2A5.5 5.5 0 0 1 12 18.7 5.5 5.5 0 0 1 6.5 13.2C6.5 10.5 8 9 9 7.6 9.4 9 10.2 9.8 11 10 10.3 6.8 11.2 3.7 12.6 1.5ZM12 21.9A3.3 3.3 0 0 1 8.7 18.7C8.7 16.6 10.2 15.4 12 13.2 13.8 15.4 15.3 16.6 15.3 18.7A3.3 3.3 0 0 1 12 21.9Z" fillRule="evenodd" />
  ),
  frost: (
    <g>
      <path d="M11 1.5H13V22.5H11Z" />
      <path d="M11 1.5H13V22.5H11Z" transform="rotate(60 12 12)" />
      <path d="M11 1.5H13V22.5H11Z" transform="rotate(120 12 12)" />
      <path d="M12 3.2 9.3 5.9 10.2 6.8 12 5 13.8 6.8 14.7 5.9Z" />
      <path d="M12 20.8 9.3 18.1 10.2 17.2 12 19 13.8 17.2 14.7 18.1Z" />
      <circle cx="12" cy="12" r="2.1" />
    </g>
  ),
  bolt: <path d="M13.8 1.5 5.2 13.4H11L9.6 22.5 18.8 10H12.9Z" />,
  skull: (
    <path d="M12 2C7 2 4 5.4 4 9.7c0 2.6 1.3 4.4 3 5.6V19c0 .8.6 1.4 1.4 1.4H9.5V18h1.4v2.4h2.2V18h1.4v2.4h1.1c.8 0 1.4-.6 1.4-1.4v-3.7c1.7-1.2 3-3 3-5.6C20 5.4 17 2 12 2ZM8.6 8.2a2.1 2.1 0 1 1 0 4.2 2.1 2.1 0 0 1 0-4.2Zm6.8 0a2.1 2.1 0 1 1 0 4.2 2.1 2.1 0 0 1 0-4.2ZM12 12.8l1.3 2.6h-2.6Z" fillRule="evenodd" />
  ),
  shield: <path d="M12 1.6 20.2 4.4V11.4C20.2 16.4 16.7 20.3 12 22.4 7.3 20.3 3.8 16.4 3.8 11.4V4.4ZM12 4.5 6.2 6.4V11.4C6.2 14.9 8.5 17.8 12 19.5 15.5 17.8 17.8 14.9 17.8 11.4V6.4Z" fillRule="evenodd" />,
  star: <path d="M12 1.5 14.1 8.2 20.5 5.4 17.6 11.8 22.5 12 17.6 12.2 20.5 18.6 14.1 15.8 12 22.5 9.9 15.8 3.5 18.6 6.4 12.2 1.5 12 6.4 11.8 3.5 5.4 9.9 8.2Z" />,
  drop: <path d="M12 1.5C15.5 6.4 19 10.2 19 14.3A7 7 0 0 1 12 21.5 7 7 0 0 1 5 14.3C5 10.2 8.5 6.4 12 1.5ZM8.4 14.4A3.7 3.7 0 0 0 12 18.2V16.3A1.8 1.8 0 0 1 10.3 14.4Z" fillRule="evenodd" />,
  wind: <path d="M3 8.2H14.2A2.6 2.6 0 1 0 11.8 4.6L13.4 5.6A.9.9 0 1 1 14.2 6.4H3Zm0 7.6H17.6A3 3 0 1 1 15 20.2L16.5 18.9A1 1 0 1 0 17.6 17.6H3ZM3 12H19.4A2.6 2.6 0 1 0 17 8.6L18.5 9.8A.8.8 0 1 1 19.4 10.4H3Z" />,
  ring: <path d="M12 7.5A8 8 0 1 0 12 23.5 8 8 0 0 0 12 7.5ZM12 10.2A5.3 5.3 0 1 1 12 20.8 5.3 5.3 0 0 1 12 10.2ZM9.2 1.2H14.8L16.6 4.2 12 8.6 7.4 4.2Z" fillRule="evenodd" />,
  gem: <path d="M6.6 2.5H17.4L22 8.6 12 22 2 8.6ZM7.9 4.4 5 8.4H8.9L10.4 4.4ZM13.6 4.4 15.1 8.4H19L16.1 4.4ZM11.9 4.4 10.6 8.4H13.4ZM5.2 10.2 10 18.2 8.7 10.2ZM15.3 10.2 14 18.2 18.8 10.2ZM10.7 10.2 12 19.2 13.3 10.2Z" fillRule="evenodd" />,
  amulet: <path d="M5.2 1.8 12 11.2 18.8 1.8H21L12.9 13.2A5.6 5.6 0 1 1 11.1 13.2L3 1.8ZM12 15.2A3.2 3.2 0 1 0 12 21.6 3.2 3.2 0 0 0 12 15.2Z" fillRule="evenodd" />,
  helmet: <path d="M12 2.2C7 2.2 3.6 6 3.6 11V15.8H7.2V13.8H10.8V19H13.2V13.8H16.8V15.8H20.4V11C20.4 6 17 2.2 12 2.2ZM7.4 10.4H16.6V12H7.4Z" fillRule="evenodd" />,
  boot: <path d="M8 2.5H14V11.6C14 12.4 14.5 12.8 15.2 13L20.4 14.6A2.1 2.1 0 0 1 22 16.7V19.5H3.5V16.5C3.5 15.4 4.2 14.5 5.3 14.2L8 13.6Z" />,
  bracelet: <path d="M12 4.2C6.9 4.2 3 7.6 3 12.2S6.9 20.2 12 20.2 21 16.8 21 12.2 17.1 4.2 12 4.2ZM12 7.1C15.3 7.1 18 9.3 18 12.2S15.3 17.3 12 17.3 6 15.1 6 12.2 8.7 7.1 12 7.1ZM12 1.8 14.4 4.4 12 6.2 9.6 4.4Z" fillRule="evenodd" />,
  earring: <path d="M12 1.6A4.2 4.2 0 0 1 16.2 5.8C16.2 8 14.8 9.3 13.6 10.6A4.4 4.4 0 1 1 10.4 10.6C9.2 9.3 7.8 8 7.8 5.8A4.2 4.2 0 0 1 12 1.6ZM12 4A1.8 1.8 0 0 0 10.2 5.8C10.2 6.8 11 7.5 12 8.6 13 7.5 13.8 6.8 13.8 5.8A1.8 1.8 0 0 0 12 4ZM12 13.4 14.6 17.4 12 22.4 9.4 17.4Z" fillRule="evenodd" />,
  claw: <path d="M4.2 3 7.6 10.2C8 11.1 8.2 12 8.2 13V21H5.4V13.6C5.4 12.9 5.3 12.3 5 11.7ZM10.5 1.6 13.9 9.4C14.2 10.2 14.4 11 14.4 11.8V21H11.6V12.4C11.6 11.8 11.5 11.3 11.2 10.7ZM16.8 3.2 20 10.6C20.3 11.2 20.4 11.8 20.4 12.4V21H17.6V12.8C17.6 12.3 17.5 11.8 17.2 11.3Z" />,
  wolf: <path d="M3.5 3.2 8 6.6C9.2 6.2 10.6 6 12 6S14.8 6.2 16 6.6L20.5 3.2 20 10.2C20.6 11.2 21 12.2 21 13.2 21 17.8 17.2 21.4 12 21.4S3 17.8 3 13.2C3 12.2 3.4 11.2 4 10.2ZM8.4 11.6A1.4 1.4 0 1 0 8.4 14.4 1.4 1.4 0 0 0 8.4 11.6Zm7.2 0A1.4 1.4 0 1 0 15.6 14.4 1.4 1.4 0 0 0 15.6 11.6ZM10.6 16.2 12 18 13.4 16.2Z" fillRule="evenodd" />,
  dragon: <path d="M2.5 15.6C2.5 10.2 6.6 6.2 12.2 6.2H14.6L17.5 3.2 17 7.4C19.2 8.4 20.8 10.4 21.6 13L19 12.6 21.5 15.4 18.2 15C17.2 18.6 14 21.2 10.2 21.2 6 21.2 2.5 19.2 2.5 15.6ZM14.7 9.4A1.2 1.2 0 1 0 14.7 11.8 1.2 1.2 0 0 0 14.7 9.4Z" fillRule="evenodd" />,
  talisman: <path d="M6.2 1.8H17.8V22.2H6.2ZM8.4 4.2V19.8H15.6V4.2ZM12 6.2 13.4 9.4 16 9.9 14 12 14.4 15.4 12 13.9 9.6 15.4 10 12 8 9.9 10.6 9.4Z" fillRule="evenodd" />,
  heart: <path d="M12 21.2C6.4 16.6 2.6 13.2 2.6 8.8A5.1 5.1 0 0 1 7.7 3.7C9.5 3.7 11 4.6 12 6 13 4.6 14.5 3.7 16.3 3.7A5.1 5.1 0 0 1 21.4 8.8C21.4 13.2 17.6 16.6 12 21.2Z" />,
  coin: (
    <g fillRule="evenodd">
      <path d="M12 1.8A10.2 10.2 0 1 1 12 22.2 10.2 10.2 0 0 1 12 1.8ZM12 4.2A7.8 7.8 0 1 0 12 19.8 7.8 7.8 0 0 0 12 4.2ZM10.4 8.6H13.6V10.2H10.4ZM10.4 13.8H13.6V15.4H10.4Z" />
      <path d="M11.2 8H12.8V16H11.2Z" />
    </g>
  ),
  shard: <path d="M12 1.2 17.4 7.4 15.6 20.6 12 22.8 8.4 20.6 6.6 7.4ZM12 4.4 9.1 8 10.2 19.2 12 20.4 13.8 19.2 14.9 8Z" fillRule="evenodd" />,
  clock: <path d="M12 2.2A9.8 9.8 0 1 1 12 21.8 9.8 9.8 0 0 1 12 2.2ZM12 4.4A7.6 7.6 0 1 0 12 19.6 7.6 7.6 0 0 0 12 4.4ZM11 7H13V11.6L16.2 13.5 15.2 15.2 11 12.7Z" fillRule="evenodd" />,
  stone: <path d="M9.4 1.6 15 3.2 17 9.4 15.2 22.4H8.2L6.6 9.2 7.4 4.8ZM10.2 4.4 9.4 9.4 10.4 19.6H13.2L14.4 9.6 13.2 5.2Z" fillRule="evenodd" />,
  chest: <path d="M3.2 8.4C3.2 5.8 5.2 3.8 7.8 3.8H16.2C18.8 3.8 20.8 5.8 20.8 8.4V9.6H3.2ZM3.2 11.4H10.8V13.2H13.2V11.4H20.8V19.4C20.8 20.2 20.2 20.8 19.4 20.8H4.6C3.8 20.8 3.2 20.2 3.2 19.4ZM11.2 12.8H12.8V16.4H11.2Z" />,
  crown: <path d="M2.6 7.2 7.6 11.4 12 4 16.4 11.4 21.4 7.2 19.6 18.4H4.4ZM5 20H19V22H5Z" />,
  orb: <path d="M12 2.2A9.8 9.8 0 1 1 12 21.8 9.8 9.8 0 0 1 12 2.2ZM8 7.4A5.6 5.6 0 0 0 7 11.8L9.8 9.4Z" fillRule="evenodd" />,
  fist: <path d="M5 8.4C5 7.4 5.8 6.6 6.8 6.6H7.6C7.6 5.6 8.4 4.8 9.4 4.8H10.2C10.2 3.8 11 3 12 3S13.8 3.8 13.8 4.8C14.6 4.4 15.8 4.8 16.2 5.8L17 6.6C18.6 6.6 20 7.9 20 9.6V14.4A6 6 0 0 1 14 20.4H11A6 6 0 0 1 5 14.4Z" />,
  eye: <path d="M12 5.2C7 5.2 3.2 8.6 1.5 12 3.2 15.4 7 18.8 12 18.8S20.8 15.4 22.5 12C20.8 8.6 17 5.2 12 5.2ZM12 8.4A3.6 3.6 0 1 1 12 15.6 3.6 3.6 0 0 1 12 8.4Z" fillRule="evenodd" />,
  plus: <path d="M10.2 3H13.8V10.2H21V13.8H13.8V21H10.2V13.8H3V10.2H10.2Z" />,
  lock: <path d="M7.4 10V7.6A4.6 4.6 0 0 1 12 3 4.6 4.6 0 0 1 16.6 7.6V10H18.4C19.2 10 19.8 10.6 19.8 11.4V20.2C19.8 21 19.2 21.6 18.4 21.6H5.6C4.8 21.6 4.2 21 4.2 20.2V11.4C4.2 10.6 4.8 10 5.6 10ZM9.4 10H14.6V7.6A2.6 2.6 0 0 0 12 5 2.6 2.6 0 0 0 9.4 7.6ZM11 14.2V17.4H13V14.2Z" fillRule="evenodd" />,
  gear: <path d="M10.4 2H13.6L14.2 4.6C14.8 4.8 15.4 5.1 16 5.5L18.4 4.4 20.6 6.6 19.5 9C19.9 9.6 20.2 10.2 20.4 10.8L22 11.4V14.6L20.4 15.2C20.2 15.8 19.9 16.4 19.5 17L20.6 19.4 18.4 21.6 16 20.5C15.4 20.9 14.8 21.2 14.2 21.4L13.6 23H10.4L9.8 21.4C9.2 21.2 8.6 20.9 8 20.5L5.6 21.6 3.4 19.4 4.5 17C4.1 16.4 3.8 15.8 3.6 15.2L2 14.6V11.4L3.6 10.8C3.8 10.2 4.1 9.6 4.5 9L3.4 6.6 5.6 4.4 8 5.5C8.6 5.1 9.2 4.8 9.8 4.6ZM12 8.4A3.6 3.6 0 1 0 12 15.6 3.6 3.6 0 0 0 12 8.4Z" fillRule="evenodd" />,
  sound: <path d="M3 9.4H7L12.4 4.6V19.4L7 14.6H3ZM15.2 8.2A5.4 5.4 0 0 1 15.2 15.8L14 14.5A3.6 3.6 0 0 0 14 9.5ZM17.8 5.4A9.2 9.2 0 0 1 17.8 18.6L16.6 17.3A7.4 7.4 0 0 0 16.6 6.7Z" />,
  cloud: <path d="M7 19C4.2 19 2 16.9 2 14.2 2 11.9 3.7 10 6 9.5 6.5 6.7 8.9 4.6 11.8 4.6 14.4 4.6 16.6 6.2 17.4 8.5 20 8.8 22 10.9 22 13.6 22 16.5 19.6 19 16.6 19Z" />,
  link: <path d="M10.6 13.4A4 4 0 0 1 10.6 7.8L13.4 5A4 4 0 1 1 19 10.6L17.5 12.1A5.8 5.8 0 0 0 17 9.9 2 2 0 0 0 14.8 6.4L12 9.2A2 2 0 0 0 12 12ZM13.4 10.6A4 4 0 0 1 13.4 16.2L10.6 19A4 4 0 1 1 5 13.4L6.5 11.9A5.8 5.8 0 0 0 7 14.1 2 2 0 0 0 9.2 17.6L12 14.8A2 2 0 0 0 12 12Z" />,
  person: <path d="M12 2.6A4.4 4.4 0 1 1 12 11.4 4.4 4.4 0 0 1 12 2.6ZM4 21.4C4 16.8 7.6 13.4 12 13.4S20 16.8 20 21.4Z" />,
  trophy: <path d="M6 2.6H18V6.2H21.4C21.4 10.2 19.4 12.2 16.8 12.6A5.6 5.6 0 0 1 13.2 15.4V18.2H16.2V21.4H7.8V18.2H10.8V15.4A5.6 5.6 0 0 1 7.2 12.6C4.6 12.2 2.6 10.2 2.6 6.2H6ZM4.8 8C4.9 9.6 5.7 10.4 6.6 10.7L6.2 8ZM19.2 8H17.8L17.4 10.7C18.3 10.4 19.1 9.6 19.2 8Z" fillRule="evenodd" />,
  book: <path d="M4 3.6C6.6 3.4 9.6 3.8 12 5.4 14.4 3.8 17.4 3.4 20 3.6V18.2C17.4 18 14.4 18.4 12 20 9.6 18.4 6.6 18 4 18.2Z M12.9 7.4V17.6C14.6 16.9 16.3 16.6 18.2 16.5V5.6C16.3 5.7 14.6 6.4 12.9 7.4Z" fillRule="evenodd" />,
  close: <path d="M5.2 3.4 12 10.2 18.8 3.4 20.6 5.2 13.8 12 20.6 18.8 18.8 20.6 12 13.8 5.2 20.6 3.4 18.8 10.2 12 3.4 5.2Z" />,
  pause: <path d="M6 3.6H10V20.4H6ZM14 3.6H18V20.4H14Z" />,
  arrow: <path d="M12 2 21 20.5 12 16 3 20.5Z" />,
};

export interface GlyphProps {
  name: GlyphName;
  class?: string;
  title?: string;
  style?: JSX.CSSProperties;
}

/** Inline glyph; colour with CSS `color`. */
export function Glyph({ name, class: cls, title, style }: GlyphProps): JSX.Element {
  return (
    <span class={`ms-icon-inline ${cls ?? ''}`} style={style} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : 'true'}>
      <svg viewBox="0 0 24 24" fill="currentColor" stroke="rgba(0,0,0,.55)" stroke-width=".5" stroke-linejoin="round">
        {G[name]}
      </svg>
    </span>
  );
}

/** Raw path group for composing larger SVGs (icon tiles). */
export function glyphPaths(name: GlyphName): ComponentChildren {
  return G[name];
}

// ---------------------------------------------------------------------------------------------------------- engraved kit
// C11: the permanent-UI members of this library (coin, shard, fist, orb, pause, arrow, skull, crown, clock, heart ...) have
// engraved multi-colour replacements in StatIcon.tsx. <KitGlyph name="..."> is the drop-in: it takes the same names as
// <Glyph> and draws the kit member when there is one (coin/shard/stone/orb -> currency objects, sword/bolt/fist -> stat
// gem tiles, the rest -> relief symbols), otherwise falls back to the legacy flat glyph (item-icon fallback tiles keep
// using <Glyph> and glyphPaths()).

type KitTarget = { ui: UiGlyphName } | { cur: CurrencyKind } | { stat: StatId };

export const KIT_GLYPH: Partial<Record<GlyphName, KitTarget>> = {
  coin: { cur: 'yeop' },
  shard: { cur: 'shard' },
  stone: { cur: 'shard' },
  orb: { cur: 'xp' },
  sword: { stat: 'damage' },
  bolt: { stat: 'dps' },
  fist: { stat: 'critDamage' },
  pause: { ui: 'pause' },
  arrow: { ui: 'up' },
  skull: { ui: 'skull' },
  crown: { ui: 'crown' },
  clock: { ui: 'clock' },
  heart: { ui: 'heart' },
  star: { ui: 'star' },
  lock: { ui: 'lock' },
  cloud: { ui: 'cloud' },
  close: { ui: 'close' },
  chest: { ui: 'chest' },
  trophy: { ui: 'trophy' },
  book: { ui: 'book' },
  person: { ui: 'person' },
  link: { ui: 'link' },
  gear: { ui: 'gear' },
  sound: { ui: 'sound' },
  plus: { ui: 'plus' },
  flame: { ui: 'flame' },
  shield: { ui: 'shield' },
  swords: { ui: 'swords' },
};

export interface KitGlyphProps extends GlyphProps {
  /** relief metal tone for the symbol members (default gold) */
  tone?: UiTone;
  size?: string;
}

/** <Glyph> with the engraved kit member when one exists (see KIT_GLYPH). */
export function KitGlyph({ name, class: cls, title, style, tone, size }: KitGlyphProps): JSX.Element {
  const k = KIT_GLYPH[name];
  const common = { class: `ms-icon-inline ${cls ?? ''}`, ...(title ? { title } : {}), ...(size ? { size } : {}) };
  if (k && 'cur' in k) return <CurrencyIcon kind={k.cur} {...common} />;
  if (k && 'stat' in k) return <StatIcon stat={k.stat} {...common} />;
  if (k) return <UiGlyph name={k.ui} {...(tone ? { tone } : {})} {...common} />;
  return <Glyph name={name} {...(cls ? { class: cls } : {})} {...(title ? { title } : {})} {...(style ? { style } : {})} />;
}
