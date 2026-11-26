// The HUD's own gauge (round 4): a painted tube (steel spiked end caps, gunmetal rim, dark glass: uk_hud_gtube) with a painted
// liquid fill (uk_hud_gfill_red / _blue / _gold: grain, specular top band, reflected lower line). The fill texture is anchored to
// the channel and only clipped by the value, so it never squashes; CSS gradients stand in until the manifest lists the art.
// Labels sit inside the channel but never on the start of the fill (centre for health, the far end for shield / experience).
import type { ComponentChildren, JSX } from 'preact';

export type HudGaugeKind = 'hp' | 'sp' | 'xp' | 'boss' | 'corr';

export interface HudGaugeProps {
  kind: HudGaugeKind;
  /** 0..1 */
  value: number;
  /** lagging damage trail 0..1 */
  trail?: number;
  /** channel height: any CSS length (the tube is 1.31 x this tall, its spikes poke out above and below) */
  ch: string;
  /** centred label */
  label?: ComponentChildren;
  /** label pinned to the far end of the channel (never over the fill's start) */
  labelEnd?: ComponentChildren;
  /** change this number to play the threshold flash */
  flash?: number;
  /** red edge pulse + shiver */
  low?: boolean;
  /** nothing to show (no shield): the tube stays lit but dull, so it reads as switched off instead of as a broken, empty channel */
  dormant?: boolean;
  class?: string;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
const pct = (v: number): string => `${(clamp01(v) * 100).toFixed(2)}%`;

export function HudGauge({ kind, value, trail, ch, label, labelEnd, flash, low, dormant, class: cls }: HudGaugeProps): JSX.Element {
  const v = clamp01(value);
  return (
    <div class={`ms-hg ms-hg--${kind} ${low ? 'is-low' : ''} ${v <= 0.001 ? 'is-empty' : ''} ${dormant ? 'is-dormant' : ''} ${cls ?? ''}`} style={{ '--ch': ch, '--v': v.toFixed(4) } as JSX.CSSProperties}>
      <div class="ms-hg-ch">
        {trail !== undefined && <div class="ms-hg-trail" style={{ width: pct(trail) }} />}
        <div class="ms-hg-fill" style={{ width: pct(v) }} />
        {flash !== undefined && flash > 0 && <div key={flash} class="ms-hg-flash" />}
        <div class="ms-hg-glass" />
        {label !== undefined && <div class="ms-hg-label">{label}</div>}
        {labelEnd !== undefined && <div class="ms-hg-label ms-hg-label--end">{labelEnd}</div>}
      </div>
    </div>
  );
}
