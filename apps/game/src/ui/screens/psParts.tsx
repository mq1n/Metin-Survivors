// Shared engraved parts of the pause / settings windows (B8 pause-settings, round 3).
//  - Seal: a glyph set in a small chamfered stone plate (the section marks of the build tray, the stat tray and the settings groups):
//    the same plate recipe as the rank medals, so no flat stencil glyph floats next to painted art.
//  - Gem: a currency object (skull, coins, shard) seated in the same glossy octagon gem tile the StatIcon set uses (Level, Damage, DPS ...),
//    so every row of the statistics tray wears one tile language (REPORT T10).
//  - CountMedal: "5/6" as an engraved octagon medal (T5: counts and ranks are medals, never dark square chips).
import type { ComponentChildren, JSX } from 'preact';
import { Medal } from '../components/Medal';
import { CurrencyIcon, UiGlyph, kitDefs, type CurrencyIconProps, type UiGlyphName, type UiTone } from '../components/StatIcon';

/** An engraved glyph in a chamfered stone plate. `lit` = gold glyph + warm rim (the active / headline mark). */
export function Seal({ name, tone = 'gold', lit, class: cls }: { name: UiGlyphName; tone?: UiTone; lit?: boolean; class?: string }): JSX.Element {
  return (
    <span class={`ms-ps-seal ms-plate ${lit ? 'is-lit' : ''} ${cls ?? ''}`} aria-hidden="true">
      <UiGlyph name={name} tone={tone} />
    </span>
  );
}

/** "5/6": an engraved octagon medal; gold-rimmed when the group is full. */
export function CountMedal({ count, max, class: cls }: { count: number; max: number; class?: string }): JSX.Element {
  return <Medal tag label={`${count}/${max}`} size="md" class={`ms-ps-count ${count >= max ? 'is-full' : ''} ${cls ?? ''}`} />;
}

// ---------------------------------------------------------------------------------------------------- gem tiles for objects

const n2 = (v: number): string => (Math.round(v * 100) / 100).toString();
const tile = (inset: number): string => {
  const a = 3 + inset;
  const b = 45 - inset;
  const c = 8 - inset * 0.6;
  return `M${n2(a + c)} ${n2(a)}H${n2(b - c)}L${n2(b)} ${n2(a + c)}V${n2(b - c)}L${n2(b - c)} ${n2(b)}H${n2(a + c)}L${n2(a)} ${n2(b - c)}V${n2(a + c)}Z`;
};
const T0 = tile(0);
const T_BEZEL = tile(1.2);
const T_SEAT = tile(3.4);
const T_BODY = tile(4.2);
const T_GLOSS = 'M12.68 7.2H35.32L40.8 12.68V20.4C32 16.9 16 16.9 7.2 20.4V12.68Z';

export type GemTone = 'ruby' | 'sapphire' | 'jade' | 'amber' | 'amethyst';

/** body gradient per tone: the three StatIcon families are reused as they are; ruby + amethyst are added to the same shared defs */
const BODY_FILL: Record<GemTone, string> = {
  ruby: 'ms-ps-gem-r',
  sapphire: 'ms-k-gem-u',
  jade: 'ms-k-gem-s',
  amber: 'ms-k-gem-o',
  amethyst: 'ms-ps-gem-a',
};

function ensureGemDefs(): void {
  const lin = (id: string, stops: readonly (readonly [number, string])[]): string =>
    `<linearGradient id="${id}" x1="0.2" y1="0" x2="0.8" y2="1">${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>`;
  kitDefs(
    'ps-gems',
    lin('ms-ps-gem-r', [[0, '#ffb9a2'], [0.35, '#e0503c'], [0.72, '#9a1c1a'], [1, '#4a0808']]) + lin('ms-ps-gem-a', [[0, '#e6cdfc'], [0.35, '#a874e2'], [0.72, '#5d2c9c'], [1, '#26104e']]),
  );
}

/** A multi-colour object (CurrencyIcon) seated in the glossy octagon gem tile of the StatIcon family. */
export function Gem({ tone, kind, size, children }: { tone: GemTone; kind?: CurrencyIconProps['kind']; size?: string; children?: ComponentChildren }): JSX.Element {
  // the object first: it registers the shared gradient defs the tile body below refers to
  const obj = kind ? <CurrencyIcon kind={kind} /> : children;
  ensureGemDefs();
  return (
    <span class={`ms-ps-gem ms-ps-gem--${tone}`} style={size ? { width: size, height: size } : undefined} aria-hidden="true">
      <svg viewBox="0 0 48 48">
        <path d={T0} fill="#000" opacity=".6" transform="translate(.8 1.4)" />
        <path d={T0} fill="#0a0705" />
        <path d={T_BEZEL} fill="url(#ms-k-bezel)" />
        <path d={T_SEAT} fill="#1a0e06" />
        <path d={T_BODY} fill={`url(#${BODY_FILL[tone]})`} />
        <path d={T_BODY} fill="url(#ms-k-gemglow)" />
        <path d={T_GLOSS} fill="url(#ms-k-gloss)" opacity=".7" />
        <path d="M12.5 38.2H35.5" stroke="#fff" stroke-opacity=".22" stroke-width=".9" stroke-linecap="round" />
      </svg>
      <span class="ms-ps-gem-obj">{obj}</span>
    </span>
  );
}
