// Kit v1 gauge (C5, T7): black-metal channel with a pewter rim, spiked brass end caps (painted uk_gauge_cap), a
// lacquer-tube fill with a glowing leading edge, optional ember sparks, segments, threshold flash, shield segment and a low
// state (red edge pulse + shake, never a bar-opacity pulse). `Bar` (components/Slot.tsx) renders this inside a kit scope.
import type { ComponentChildren, JSX } from 'preact';

export type GaugeSkin = 'hp' | 'sp' | 'xp' | 'boss' | 'loader';
export type GaugeCaps = 'spike' | 'plain' | 'none';

export interface GaugeProps {
  /** 0..1 */
  value: number;
  /** lagging damage trail 0..1 (defaults to value) */
  trail?: number;
  /** shield, as a fraction of the max (drawn as a blue segment after the fill, clamped to the channel) */
  shield?: number;
  /** palette: hp red lacquer, sp blue, xp amber (also stamina), boss crimson + gold, loader amber -> crimson */
  skin?: GaugeSkin;
  /** end caps: spiked brass (default for height >= 1 rem), plain pewter blocks, none */
  caps?: GaugeCaps;
  /** channel height (any CSS length, default 1.3rem) */
  height?: string;
  /** thin variant: 0.55 rem channel, plain caps, no label */
  thin?: boolean;
  /** centre label */
  label?: ComponentChildren;
  /** labels pinned inside the channel ends */
  labelStart?: ComponentChildren;
  labelEnd?: ComponentChildren;
  /** divider lines every 1/n of the channel */
  segments?: number;
  /** slow sheen sweeping across the fill */
  shine?: boolean;
  /** ember sparks rising from the leading edge */
  spark?: boolean;
  /** change this number to play the threshold flash (talent point reached, level up) */
  flash?: number;
  /** force the low state (default: skin hp and value <= 0.25) */
  low?: boolean;
  /** fill paint: a colour or a gradient (overrides the skin) */
  color?: string;
  /** glow colour of the fill: a plain colour (a gradient inside box-shadow would invalidate the declaration) */
  glow?: string;
  class?: string;
  /** accessible name (the gauge is aria-hidden when absent: it duplicates a printed number) */
  title?: string;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
const pct = (v: number): string => `${(clamp01(v) * 100).toFixed(2)}%`;

/** A plain colour for the fill glow out of a paint (the last colour stop of a gradient). */
export function glowOf(paint: string): string {
  if (!paint.includes('gradient(')) return paint;
  return paint.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|var\(--[\w-]+\)/gi)?.pop() ?? 'transparent';
}

export function Gauge({ value, trail, shield, skin = 'hp', caps, height, thin, label, labelStart, labelEnd, segments, shine, spark, flash, low, color, glow, class: cls, title }: GaugeProps): JSX.Element {
  const v = clamp01(value);
  const style: Record<string, string> = { '--v': v.toFixed(4) };
  if (height) style['--h'] = height;
  if (color) {
    style['--fill'] = color;
    style['--fill-glow'] = glow ?? glowOf(color);
  } else if (glow) style['--fill-glow'] = glow;
  const capKind: GaugeCaps = caps ?? (thin ? 'plain' : 'spike');
  const isLow = low ?? (skin === 'hp' && v > 0 && v <= 0.25);
  const sh = shield !== undefined && shield > 0 ? Math.min(clamp01(shield), 1 - v) : 0;
  return (
    <div
      class={`ms-gauge ms-gauge--${skin} ms-gauge--caps-${capKind} ${thin ? 'ms-gauge--thin' : ''} ${isLow ? 'is-low' : ''} ${v <= 0.001 ? 'is-empty' : ''} ${cls ?? ''}`}
      style={style as JSX.CSSProperties}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title || label !== undefined || labelStart !== undefined || labelEnd !== undefined ? undefined : 'true'}
    >
      {capKind !== 'none' && <span class="ms-gauge-cap is-l" aria-hidden="true" />}
      <div class="ms-gauge-channel">
        <div class="ms-gauge-trail" style={{ width: pct(trail ?? v) }} />
        <div class={`ms-gauge-fill ${shine ? 'ms-gauge-fill--shine' : ''}`} style={{ width: pct(v) }} />
        {sh > 0 && <div class="ms-gauge-shield" style={{ left: pct(v), width: pct(sh) }} />}
        {segments !== undefined && segments > 1 && <div class="ms-gauge-ticks" style={{ '--seg': segments } as JSX.CSSProperties} />}
        {flash !== undefined && flash > 0 && <div key={flash} class="ms-gauge-flash" />}
        {labelStart !== undefined && <div class="ms-gauge-label ms-gauge-label--start">{labelStart}</div>}
        {label !== undefined && <div class="ms-gauge-label">{label}</div>}
        {labelEnd !== undefined && <div class="ms-gauge-label ms-gauge-label--end">{labelEnd}</div>}
      </div>
      {capKind !== 'none' && <span class="ms-gauge-cap is-r" aria-hidden="true" />}
      {spark && v > 0.01 && v < 0.999 && (
        <span class="ms-gauge-sparks" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      )}
    </div>
  );
}
