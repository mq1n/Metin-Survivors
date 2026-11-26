import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Element, Rarity } from '../../data/schema';
import { iconForm, iconIdForRank } from '../assets';
import { rankLabel } from '../content';
import { Glyph, type GlyphName } from './glyphs';
import { Gauge, glowOf, type GaugeCaps, type GaugeSkin } from './Gauge';
import { IconArt, type IconKind } from './Icon';
import { Medal } from './Medal';
import { useKit } from './Panel';

export interface IconSlotProps {
  /** content icon id; omit for an empty slot */
  icon?: string;
  kind?: IconKind;
  element?: Element;
  rarity?: Rarity;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl';
  /** skill rank index 0..7 → rank medal AND the rank-band icon tile (`<id>__m|__g|__p` when the manifest ships it); or custom badge text */
  rank?: number;
  badge?: ComponentChildren;
  /** cooldown 0 = ready … 1 = just fired (radial sweep) */
  cooldown?: number;
  /** hotkey hint in the top-left corner */
  hotkey?: string;
  /** ghost glyph shown when empty (gear slot silhouette) */
  ghost?: GlyphName;
  awakened?: boolean;
  selected?: boolean;
  onClick?: () => void;
  class?: string;
  slot?: string;
  glyph?: GlyphName;
  alt?: string;
  style?: JSX.CSSProperties;
  nav?: boolean;
  /** draws the rank-band icon tile for this rank (`<id>__m|__g|__p`) WITHOUT a rank medal: level-up cards, collection tiles,
   *  anywhere the rank is known but the slot must stay clean. `rank` (medal + tile) wins over nothing; iconRank wins over rank. */
  iconRank?: number;
  /** kit v1: talent row tint 1..5 on the rim (rows I-II olive bronze, III-IV ember orange, V crimson) */
  rowTint?: 1 | 2 | 3 | 4 | 5;
  /** kit v1: not owned yet. The icon stays readable at ~40 % brightness (not a black square) with a lock mark in the corner */
  locked?: boolean;
  /** kit v1 octagon slot (default: on inside a kit scope, else the legacy rounded-square slot) */
  kit?: boolean;
  /** extra attributes for tooltip hooks */
  [k: `on${string}`]: unknown;
}

const SIZE_CLASS: Record<NonNullable<IconSlotProps['size']>, string> = {
  xs: 'ms-slot--xs',
  sm: 'ms-slot--sm',
  md: '',
  lg: 'ms-slot--lg',
  xl: 'ms-slot--xl',
  xxl: 'ms-slot--xxl',
};

/** Framed icon tile: rarity ring, rank badge, cooldown sweep, hotkey, awakened glow. */
export function IconSlot(p: IconSlotProps): JSX.Element {
  const { icon, kind, element, rarity, size = 'md', rank, iconRank, rowTint, badge, cooldown, hotkey, ghost, awakened, selected, onClick, class: cls, slot, glyph, alt, style, locked } = p;
  const kit = useKit(p.kit);
  const empty = !icon;
  // ready flash when a cooldown completes
  const prevCd = useRef(cooldown ?? 0);
  const [flash, setFlash] = useState(0);
  useEffect(() => {
    const cd = cooldown ?? 0;
    if (prevCd.current > 0.02 && cd <= 0.001) setFlash((n) => n + 1);
    prevCd.current = cd;
  }, [cooldown]);

  const handlers: Record<string, unknown> = {};
  for (const k of Object.keys(p)) if (k.startsWith('on') && k !== 'onClick') handlers[k] = p[k as `on${string}`];

  // pipeline form of the icon actually drawn (rank-band tile when one is shipped): tile | cutout | legacy
  const artRank = iconRank ?? rank;
  const form = icon ? (iconForm(iconIdForRank(icon, artRank)) ?? 'legacy') : null;
  const classes = [
    'ms-slot',
    kit ? 'ms-slot--k' : '',
    SIZE_CLASS[size],
    rarity ? `ms-r-${rarity}` : '',
    empty ? 'ms-slot--empty' : '',
    awakened ? 'ms-slot--awakened' : '',
    locked ? 'ms-slot--locked' : '',
    rowTint ? `ms-slot--row${rowTint}` : '',
    form ? `ms-slot--${form}` : '',
    onClick ? 'is-hoverable' : '',
    selected ? 'is-selected' : '',
    cls ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  const art = (
    <span class="ms-slot-art">
      {!empty && <IconArt id={icon} {...(kind ? { kind } : {})} {...(element ? { element } : {})} {...(slot ? { slot } : {})} {...(glyph ? { glyph } : {})} {...(alt ? { alt } : {})} {...(artRank !== undefined ? { rank: artRank } : {})} />}
    </span>
  );
  const ghostEl = empty && ghost && (
    <span class="ms-slot-ghost">
      <Glyph name={ghost} />
    </span>
  );
  const cdEl = cooldown !== undefined && cooldown > 0.001 && <span class="ms-slot-cd" style={{ '--cd-a': `${((1 - cooldown) * 360).toFixed(1)}deg` } as JSX.CSSProperties} />;
  const readyEl = flash > 0 && <span key={flash} class="ms-slot-ready" />;
  const keyEl = hotkey && <span class="ms-slot-key">{hotkey}</span>;
  const inner = kit ? (
    <>
      {/* fx layer: rarity / selection / awakened glow as drop-shadows (they follow the octagon; clip-path would eat a box-shadow) */}
      <span class="ms-slot-fx">
        <span class="ms-slot-frame ms-plate">
          {art}
          {ghostEl}
          {cdEl}
        </span>
        {readyEl}
      </span>
      {keyEl}
      {locked ? (
        <span class="ms-slot-lock" aria-hidden="true">
          <Glyph name="lock" />
        </span>
      ) : rank !== undefined ? (
        <Medal rank={rank} class="ms-slot-rank" />
      ) : badge !== undefined ? (
        <Medal tag label={badge} class="ms-slot-rank" />
      ) : null}
    </>
  ) : (
    <>
      {art}
      {ghostEl}
      {cdEl}
      {readyEl}
      {keyEl}
      {rank !== undefined && <span class={`ms-slot-rank ${rank >= 7 ? 'ms-slot-rank--p' : ''}`}>{rankLabel(rank)}</span>}
      {badge !== undefined && <span class="ms-slot-rank">{badge}</span>}
    </>
  );
  if (onClick) {
    return (
      <button type="button" class={classes} style={style} data-nav="" onClick={onClick} {...handlers}>
        {inner}
      </button>
    );
  }
  return (
    <div class={classes} style={style} {...handlers}>
      {inner}
    </div>
  );
}

export interface BarProps {
  /** 0..1 */
  value: number;
  /** lagging damage trail 0..1 (defaults to value) */
  trail?: number;
  shield?: number;
  variant?: 'hp' | 'xp' | 'boss';
  label?: ComponentChildren;
  height?: string;
  thin?: boolean;
  shine?: boolean;
  ticks?: boolean;
  class?: string;
  /** fill paint: a colour or a gradient */
  color?: string;
  /** glow colour of the fill (default: `color` itself, or its last colour stop when `color` is a gradient) */
  glow?: string;
  /** kit v1: renders a Gauge (black-metal channel, spiked caps, lacquer-tube fill). Default: on inside a kit scope. The
   *  options below only apply to the kit look. */
  kit?: boolean;
  skin?: GaugeSkin;
  caps?: GaugeCaps;
  segments?: number;
  spark?: boolean;
  flash?: number;
  labelStart?: ComponentChildren;
  labelEnd?: ComponentChildren;
  low?: boolean;
}

const pct = (v: number): string => `${(Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0)) * 100).toFixed(2)}%`;

export function Bar({ value, trail, shield, variant = 'hp', label, height, thin, shine, ticks, class: cls, color, glow, kit: kitProp, skin, caps, segments, spark, flash, labelStart, labelEnd, low }: BarProps): JSX.Element {
  const kit = useKit(kitProp);
  if (kit) {
    return (
      <Gauge
        value={value}
        {...(trail !== undefined ? { trail } : {})}
        {...(shield !== undefined ? { shield } : {})}
        skin={skin ?? variant}
        {...(caps ? { caps } : {})}
        {...(height ? { height } : {})}
        {...(thin ? { thin } : {})}
        {...(label !== undefined ? { label } : {})}
        {...(labelStart !== undefined ? { labelStart } : {})}
        {...(labelEnd !== undefined ? { labelEnd } : {})}
        {...(segments !== undefined || ticks ? { segments: segments ?? 10 } : {})}
        {...(shine ? { shine } : {})}
        {...(spark ? { spark } : {})}
        {...(flash !== undefined ? { flash } : {})}
        {...(low !== undefined ? { low } : {})}
        {...(color ? { color } : {})}
        {...(glow ? { glow } : {})}
        {...(cls ? { class: cls } : {})}
      />
    );
  }
  const style: Record<string, string> = {};
  if (height) style['--h'] = height;
  if (color) style['--fill'] = color;
  if (glow ?? color) style['--fill-glow'] = glow ?? glowOf(color ?? '');
  return (
    <div class={`ms-bar ms-bar--${variant} ${thin ? 'ms-bar--thin' : ''} ${cls ?? ''}`} style={style as JSX.CSSProperties}>
      <div class="ms-bar-trail" style={{ width: pct(trail ?? value) }} />
      <div class={`ms-bar-fill ${shine ? 'ms-bar-fill--shine' : ''}`} style={{ width: pct(value) }} />
      {shield !== undefined && shield > 0 && <div class="ms-bar-shield" style={{ width: pct(shield) }} />}
      {ticks && <div class="ms-bar-ticks" />}
      {label !== undefined && <div class="ms-bar-label">{label}</div>}
    </div>
  );
}

export function KeyHint({ k, class: cls, kbd = true, kit: kitProp }: { k: string; class?: string; kbd?: boolean; /** kit v1: chamfered stone key plate */ kit?: boolean }): JSX.Element {
  const kit = useKit(kitProp);
  if (kit) return <kbd class={`ms-kkey ms-plate ${kbd ? 'ms-kkey--kbd' : ''} ${cls ?? ''}`}>{k}</kbd>;
  return <kbd class={`ms-key ${kbd ? 'ms-key--kbd' : ''} ${cls ?? ''}`}>{k}</kbd>;
}

/** Number that eases toward its target (run-end tallies, bank totals). */
export function Counter({ value, format, ms = 900, delay = 0 }: { value: number; format: (n: number) => string; ms?: number; delay?: number }): JSX.Element {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    let raf = 0;
    let start = 0;
    const from = 0;
    const tick = (now: number): void => {
      if (start === 0) start = now + delay;
      const k = Math.min(1, Math.max(0, (now - start) / ms));
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(from + (value - from) * eased);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms, delay]);
  return <>{format(shown)}</>;
}
