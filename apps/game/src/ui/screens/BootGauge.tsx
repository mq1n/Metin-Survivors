
// caps and a dark glass tube (uk_boot_loading_gauge, a stretchable 3-slice) with a clean glossy lacquer liquid poured into the tube.
// The liquid, its lit leading edge and the embers all hang off ONE element (.ms-bg-run) whose width is the value, so the spark is
// locked to the end of the fill at every value and every size. The frame's own highlight is screened over the liquid (.ms-bg-lens),
// so the glass is in front of the fill, not behind it. Labels never sit on the tube (Boot.tsx puts caption + percent above it).
// Own component on purpose: the HUD gauge belongs to the HUD target.
import type { JSX } from 'preact';

export interface BootGaugeProps {
  /** 0..1 */
  value: number;
  /** the load failed: red liquid, no spark, one shiver */
  fail?: boolean;
  /** accessible name */
  label: string;
  /** accessible value text ("Raising the land, 63 %") */
  valueText: string;
  class?: string;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

export function BootGauge({ value, fail, label, valueText, class: cls }: BootGaugeProps): JSX.Element {
  const v = clamp01(value);
  const w = `${(v * 100).toFixed(2)}%`;
  return (
    <div
      class={`ms-bg ${fail ? 'is-fail' : ''} ${v >= 0.999 ? 'is-full' : ''} ${v <= 0.001 ? 'is-empty' : ''} ${cls ?? ''}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
      aria-valuetext={valueText}
    >
      <div class="ms-bg-frame" aria-hidden="true" />
      <div class="ms-bg-ch" aria-hidden="true">
        <div class="ms-bg-run" style={{ width: w }}>
          <div class="ms-bg-liquid">
            <i class="ms-bg-sheen" />
            <div class="ms-bg-lens" />
          </div>
          <div class="ms-bg-tip">
            <i class="ms-bg-flare" />
            <i class="ms-bg-ember" />
            <i class="ms-bg-ember" />
            <i class="ms-bg-ember" />
          </div>
        </div>
      </div>
    </div>
  );
}
