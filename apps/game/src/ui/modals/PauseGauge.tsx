// Pause gauge (B8 pause-settings): the painted tube of the shipped HUD materials (uk_hud_gtube: gunmetal rim, spiked steel end caps, dark
// glass) with a painted liquid fill (uk_hud_gfill_red / _gold: grain, specular top band) anchored to the channel and only clipped by the
// value. Used for the HP and XP lines of the run statistics and (thin) for the top-damage rows. The CSS variables come from
// screens/psTex.ts (`usePsTex`); while the art is missing CSS gradients stand in. Rules live in pause.css (`.ms-pg*`).
import type { ComponentChildren, JSX } from 'preact';

export type PauseGaugeKind = 'red' | 'gold' | 'blue';

export interface PauseGaugeProps {
  kind?: PauseGaugeKind;
  /** 0..1 */
  value: number;
  /** channel height, any CSS length (the tube image is 1.31 x this tall, its spikes poke out above and below) */
  ch?: string;
  /** centred label (a number, "Level 17") */
  label?: ComponentChildren;
  /** n equal divisions drawn over the liquid */
  ticks?: number;
  /** reduced tube: no spiked caps, plain pewter ends (thin rows) */
  thin?: boolean;
  /** accessible name; the gauge is aria-hidden when absent (a printed number says the same) */
  title?: string;
  class?: string;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

export function PauseGauge({ kind = 'gold', value, ch, label, ticks, thin, title, class: cls }: PauseGaugeProps): JSX.Element {
  const v = clamp01(value);
  const style: Record<string, string> = { '--v': v.toFixed(4) };
  if (ch) style['--ch'] = ch;
  return (
    <div
      class={`ms-pg ms-pg--${kind} ${thin ? 'ms-pg--thin' : ''} ${v <= 0.001 ? 'is-empty' : ''} ${v > 0 && v <= 0.25 && kind === 'red' ? 'is-low' : ''} ${cls ?? ''}`}
      style={style as JSX.CSSProperties}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title || label !== undefined ? undefined : 'true'}
    >
      <div class="ms-pg-ch">
        <div class="ms-pg-fill" style={{ width: `${(v * 100).toFixed(2)}%` }} />
        {ticks !== undefined && ticks > 1 && <div class="ms-pg-ticks" style={{ '--seg': ticks } as JSX.CSSProperties} />}
        <div class="ms-pg-glass" />
        {label !== undefined && <div class="ms-pg-label">{label}</div>}
      </div>
    </div>
  );
}
