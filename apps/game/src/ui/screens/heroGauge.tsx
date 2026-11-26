// Hero-select tube gauge (round 2): the collection progress on the hero board as a painted glass tube with a painted liquid fill,
// the same shipped HUD materials as the HUD, pause and run-end gauges (uk_hud_gtube: gunmetal rim + spiked steel caps + dark
// glass; uk_hud_gfill_gold: grain + specular top band). Replaces the flat CSS strip in a black channel. Rules: hero.css `.ms-hsg*`.
// While the art is missing, CSS gradients stand in (the tube then is a dark channel with pewter ends).
import type { JSX } from 'preact';
import { texUrl } from '../assets';

export interface HeroGaugeProps {
  /** 0..1 */
  value: number;
  /** channel height, any CSS length (the tube image is 1.31 x this tall, its spikes poke out above and below) */
  ch?: string;
  /** n equal divisions drawn over the liquid */
  ticks?: number;
  /** accessible name; the gauge is aria-hidden when absent (a printed number says the same) */
  title?: string;
  class?: string;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

/** inline custom properties for the painted materials that are shipped */
function mats(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const tube = texUrl('uk_hud_gtube');
    const fill = texUrl('uk_hud_gfill_gold');
    if (tube) out['--hsg-tube'] = `url("${tube}")`;
    if (fill) out['--hsg-fill'] = `url("${fill}")`;
  } catch {
    /* manifest not ready: the CSS fallbacks are the look */
  }
  return out;
}

export function HeroGauge({ value, ch, ticks, title, class: cls }: HeroGaugeProps): JSX.Element {
  const v = clamp01(value);
  const style: Record<string, string> = { ...mats(), '--v': v.toFixed(4) };
  if (ch) style['--ch'] = ch;
  return (
    <div class={`ms-hsg ${v <= 0.001 ? 'is-empty' : ''} ${cls ?? ''}`} style={style as JSX.CSSProperties} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : 'true'}>
      <div class="ms-hsg-ch">
        <div class="ms-hsg-fill" style={{ width: `${(v * 100).toFixed(2)}%` }} />
        {ticks !== undefined && ticks > 1 && <div class="ms-hsg-ticks" style={{ '--seg': ticks } as JSX.CSSProperties} />}
        <div class="ms-hsg-glass" />
      </div>
    </div>
  );
}
