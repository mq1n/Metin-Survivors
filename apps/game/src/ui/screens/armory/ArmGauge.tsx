// Armory gauge (B12 armory-b): the painted tube of the shipped HUD materials (uk_hud_gtube: gunmetal rim, spiked steel end caps,
// dark glass) with a painted liquid fill (uk_hud_gfill_gold / _red / _blue: grain, specular top band) anchored to the channel and

// flat CSS bars). Used for the talent XP, the refine success chance and (thin) the row / milestone progress. Rules: armgauge.css
// (`.arm-g*`). While the art is missing, CSS gradients stand in.
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { texUrl } from '../../assets';
import './armgauge.css';

export type ArmGaugeKind = 'gold' | 'red' | 'blue';

/** material id -> custom property of the gauge root */
const MATERIALS: readonly (readonly [id: string, cssVar: string])[] = [
  ['uk_hud_gtube', '--tex-ag-tube'],
  ['uk_hud_gfill_gold', '--tex-ag-gold'],
  ['uk_hud_gfill_red', '--tex-ag-red'],
  ['uk_hud_gfill_blue', '--tex-ag-blue'],
  
  ['uk_runend_results_granite', '--tex-ag-granite'],
];

function read(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const [id, v] of MATERIALS) {
      const u = texUrl(id);
      if (u) out[v] = `url("${u}")`;
    }
  } catch {
    /* manifest not ready */
  }
  return out;
}

/** The material properties, re-read once after 0.6 s when the HUD materials were not in the manifest yet. */
export function useArmTex(): JSX.CSSProperties {
  const [tex, setTex] = useState(read);
  const missing = MATERIALS.some(([, v]) => !tex[v]);
  useEffect(() => {
    if (!missing) return undefined;
    const id = window.setTimeout(() => setTex(read()), 600);
    return () => window.clearTimeout(id);
  }, [missing]);
  return tex as JSX.CSSProperties;
}

export interface ArmGaugeProps {
  kind?: ArmGaugeKind;
  /** 0..1 */
  value: number;
  /** channel height, any CSS length (the tube image is 1.31 x this tall, its spikes poke out above and below) */
  ch?: string;
  /** label pinned inside the channel start / end, centre */
  labelStart?: ComponentChildren;
  labelEnd?: ComponentChildren;
  label?: ComponentChildren;
  /** n equal divisions drawn over the liquid */
  ticks?: number;
  /** reduced tube: a plain pewter channel without the spiked caps (row / milestone progress) */
  thin?: boolean;
  /** accessible name; the gauge is aria-hidden when absent (a printed number says the same) */
  title?: string;
  class?: string;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

export function ArmGauge({ kind = 'gold', value, ch, labelStart, labelEnd, label, ticks, thin, title, class: cls }: ArmGaugeProps): JSX.Element {
  const v = clamp01(value);
  const tex = useArmTex();
  const style: Record<string, string> = { ...(tex as Record<string, string>), '--v': v.toFixed(4) };
  if (ch) style['--ch'] = ch;
  const hasLabel = label !== undefined || labelStart !== undefined || labelEnd !== undefined;
  return (
    <div
      class={`arm-g arm-g--${kind} ${thin ? 'arm-g--thin' : ''} ${v <= 0.001 ? 'is-empty' : ''} ${v >= 0.999 ? 'is-full' : ''} ${cls ?? ''}`}
      style={style as JSX.CSSProperties}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title || hasLabel ? undefined : 'true'}
    >
      <div class="arm-g-ch">
        <div class="arm-g-fill" style={{ width: `${(v * 100).toFixed(2)}%` }} />
        {ticks !== undefined && ticks > 1 && <div class="arm-g-ticks" style={{ '--seg': ticks } as JSX.CSSProperties} />}
        <div class="arm-g-glass" />
        {hasLabel && (
          <div class="arm-g-labels">
            {labelStart !== undefined && <span class="arm-g-l is-start">{labelStart}</span>}
            {label !== undefined && <span class="arm-g-l is-mid">{label}</span>}
            {labelEnd !== undefined && <span class="arm-g-l is-end">{labelEnd}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
