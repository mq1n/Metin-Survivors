// Run-end gauge (B10 runend-results): the painted tube of the shipped HUD materials (uk_hud_gtube: gunmetal rim, spiked steel end
// caps, dark glass) with a painted liquid fill (uk_hud_gfill_gold / _red / _blue: grain, specular top band) anchored to the
// channel and only clipped by the value. Used for the talent-XP sweep (threshold flash per point) and the damage-by-skill rows.
// CSS gradients stand in until the manifest lists the art. The rules live in runend.css (`.ms-rg*`).
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { texUrl } from '../assets';

export type RunGaugeKind = 'gold' | 'red' | 'blue';

export interface RunGaugeProps {
  kind?: RunGaugeKind;
  /** 0..1 */
  value: number;
  /** channel height, any CSS length (the tube is 1.31 x this tall, its spikes poke out above and below) */
  ch: string;
  /** a plain colour for an element-tinted fill (the painted fill is hue-shifted to it) */
  hue?: number;
  /** centred label */
  label?: ComponentChildren;
  /** label pinned to the far end of the channel */
  labelEnd?: ComponentChildren;
  /** change this number to play the threshold flash */
  flash?: number;
  /** n equal divisions drawn over the liquid (talent thresholds, damage share) */
  ticks?: number;
  /** grow-in animation delay (ms); omit for a static fill */
  grow?: number;
  class?: string;
  title?: string;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

const TEX: readonly (readonly [id: string, cssVar: string])[] = [
  ['uk_hud_gtube', '--tex-re-gtube'],
  ['uk_hud_gfill_gold', '--tex-re-gfill-gold'],
  ['uk_hud_gfill_red', '--tex-re-gfill-red'],
  ['uk_hud_gfill_blue', '--tex-re-gfill-blue'],
  ['uk_hud_coin', '--tex-re-coin'],
  ['uk_hud_bar', '--tex-re-stone'],
];

/** Painted materials as CSS variables for the run-end root (retries once: the manifest can finish loading after first paint). */
export function useRunTextures(): JSX.CSSProperties | undefined {
  const read = (): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [id, v] of TEX) {
      const url = texUrl(id);
      if (url) out[v] = `url("${url}")`;
    }
    return out;
  };
  const [tex, setTex] = useState(read);
  const missing = TEX.some(([, v]) => !tex[v]);
  useEffect(() => {
    if (!missing) return undefined;
    const id = window.setTimeout(() => setTex(read()), 600);
    return () => window.clearTimeout(id);
  }, [missing]);
  const style: Record<string, string> = { ...tex };
  // the painted tube carries its own dark glass: the channel stays see-through over it
  if (tex['--tex-re-gtube']) style['--rg-ch-bg'] = 'transparent';
  return Object.keys(style).length ? (style as JSX.CSSProperties) : undefined;
}

export function RunGauge({ kind = 'gold', value, ch, hue, label, labelEnd, flash, ticks, grow, class: cls, title }: RunGaugeProps): JSX.Element {
  const v = clamp01(value);
  const style: Record<string, string> = { '--ch': ch, '--v': v.toFixed(4) };
  if (hue !== undefined) style['--rg-hue'] = `${Math.round(hue)}deg`;
  if (grow !== undefined) style['--rg-d'] = `${Math.round(grow)}ms`;
  return (
    <div
      class={`ms-rg ms-rg--${kind} ${hue !== undefined ? 'has-hue' : ''} ${grow !== undefined ? 'is-grow' : ''} ${v <= 0.001 ? 'is-empty' : ''} ${cls ?? ''}`}
      style={style as JSX.CSSProperties}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title || label !== undefined || labelEnd !== undefined ? undefined : 'true'}
    >
      <div class="ms-rg-ch">
        <div class="ms-rg-fill" style={{ width: `${(v * 100).toFixed(2)}%` }} />
        {ticks !== undefined && ticks > 1 && <div class="ms-rg-ticks" style={{ '--seg': ticks } as JSX.CSSProperties} />}
        {flash !== undefined && flash > 0 && <div key={flash} class="ms-rg-flash" />}
        <div class="ms-rg-glass" />
        {label !== undefined && <div class="ms-rg-label">{label}</div>}
        {labelEnd !== undefined && <div class="ms-rg-label ms-rg-label--end">{labelEnd}</div>}
      </div>
    </div>
  );
}
