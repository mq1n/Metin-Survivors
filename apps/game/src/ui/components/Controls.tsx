// Custom form controls (no browser widgets): Slider, Toggle, Segmented, TextInput, Field row.
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { NAV_ARROW_EVENT, type NavArrowDetail } from '../nav';
import { t } from '../../i18n/i18n';
import { sfx } from '../audio';
import { useKit } from './Panel';

export interface SliderProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  /** formatted label at the right (default: percent of range) */
  format?: (v: number) => string;
  label?: string;
  /** kit v1 look: engraved groove, bronze knob, ticks, value bubble while dragging (default: on inside a kit scope) */
  kit?: boolean;
  /** kit: number of tick intervals under the groove (default 10; 0 = none) */
  ticks?: number;
}

export function clampSliderValue(raw: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number(raw.toFixed(6))));
}

export function stepSliderValue(value: number, delta: number, min: number, max: number): number {
  return clampSliderValue(value + delta, min, max);
}

export function Slider({ value, min = 0, max = 1, step = 0.05, onChange, format, label, kit: kitProp, ticks = 10 }: SliderProps): JSX.Element {
  const kit = useKit(kitProp);
  const [drag, setDrag] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const latest = useRef({ value, min, max, step, onChange });
  latest.current = { value, min, max, step, onChange };
  const applyDelta = (d: number): void => {
    const cur = latest.current;
    const next = stepSliderValue(cur.value, d, cur.min, cur.max);
    if (next !== cur.value) {
      cur.onChange(next);
      sfx('hover');
    }
  };
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const onArrow = (e: Event): void => {
      const dir = (e as CustomEvent<NavArrowDetail>).detail?.dir;
      if (dir !== 'left' && dir !== 'right') return;
      e.preventDefault();
      e.stopPropagation();
      applyDelta(dir === 'left' ? -latest.current.step : latest.current.step);
    };
    el.addEventListener(NAV_ARROW_EVENT, onArrow);
    return () => el.removeEventListener(NAV_ARROW_EVENT, onArrow);
  }, []);
  const frac = max > min ? (value - min) / (max - min) : 0;
  const setFromX = (clientX: number): void => {
    const el = track.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width <= 0) return;
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const raw = min + f * (max - min);
    const snapped = Math.round(raw / step) * step;
    const v = Math.min(max, Math.max(min, Number(snapped.toFixed(6))));
    if (v !== value) onChange(v);
  };
  const dragging = useRef(false);
  return (
    <div
      ref={rootRef}
      class={kit ? `ms-kslider ${drag ? 'is-drag' : ''}` : 'ms-slider'}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      data-nav=""
      data-arrows="x"
      onPointerDown={(e) => {
        dragging.current = true;
        setDrag(true);
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        setFromX(e.clientX);
      }}
      onPointerMove={(e) => {
        if (dragging.current) setFromX(e.clientX);
      }}
      onPointerUp={(e) => {
        if (!dragging.current) return;
        dragging.current = false;
        setDrag(false);
        const el = e.currentTarget as HTMLElement;
        if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
        sfx('click');
      }}
      onPointerCancel={() => {
        dragging.current = false;
        setDrag(false);
      }}
      onKeyDown={(e) => {
        let d = 0;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') d = -step;
        else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') d = step;
        else if (e.key === 'Home') d = min - value;
        else if (e.key === 'End') d = max - value;
        if (d !== 0) {
          e.preventDefault();
          e.stopPropagation();
          applyDelta(d);
        }
      }}
    >
      {kit ? (
        <>
          <div class="ms-kslider-rail" ref={track} style={ticks > 0 ? ({ '--ticks': ticks } as JSX.CSSProperties) : undefined}>
            <div class="ms-kslider-groove">
              <div class="ms-kslider-fill" style={{ width: `${frac * 100}%` }} />
            </div>
            {ticks > 0 && <div class="ms-kslider-ticks" aria-hidden="true" />}
            <div class="ms-kslider-knob ms-plate" style={{ left: `${frac * 100}%` }}>
              <span class="ms-kslider-bubble">{format ? format(value) : `${Math.round(frac * 100)}%`}</span>
            </div>
          </div>
          <span class="ms-kslider-value ms-num">{format ? format(value) : `${Math.round(frac * 100)}%`}</span>
        </>
      ) : (
        <>
          <div class="ms-slider-track" ref={track}>
            <div class="ms-slider-fill" style={{ width: `${frac * 100}%` }} />
            <div class="ms-slider-knob" style={{ left: `${frac * 100}%` }} />
          </div>
          <span class="ms-slider-value">{format ? format(value) : `${Math.round(frac * 100)}%`}</span>
        </>
      )}
    </div>
  );
}

export function Toggle({ value, onChange, label, kit: kitProp }: { value: boolean; onChange: (v: boolean) => void; label?: string; /** kit v1: stone track, plate knob, ON / OFF word */ kit?: boolean }): JSX.Element {
  const kit = useKit(kitProp);
  return (
    <button
      type="button"
      class={kit ? 'ms-ktoggle' : 'ms-toggle'}
      role="switch"
      aria-checked={value}
      aria-label={label}
      data-nav=""
      onClick={() => {
        sfx(value ? 'toggleOff' : 'toggleOn');
        onChange(!value);
      }}
    >
      {kit && (
        <>
          <span class="ms-ktoggle-track" aria-hidden="true" />
          {/* both words are laid out (the wider one sizes the control, so any language fits); one is shown */}
          <span class="ms-ktoggle-words" aria-hidden="true">
            <span class={`ms-ktoggle-word ${value ? 'is-shown' : ''}`}>{t('common.on')}</span>
            <span class={`ms-ktoggle-word ${value ? '' : 'is-shown'}`}>{t('common.off')}</span>
          </span>
          <span class="ms-ktoggle-knob ms-plate" aria-hidden="true" />
          <span class="ms-hit" aria-hidden="true" />
        </>
      )}
    </button>
  );
}

export interface SegmentedProps<K extends string> {
  options: readonly { key: K; label: ComponentChildren; disabled?: boolean }[];
  value: K;
  onChange: (k: K) => void;
  /** kit v1: bevelled plates in a recessed trough */
  kit?: boolean;
}

export function Segmented<K extends string>({ options, value, onChange, kit: kitProp }: SegmentedProps<K>): JSX.Element {
  const kit = useKit(kitProp);
  return (
    <div class={kit ? 'ms-kseg' : 'ms-seg'} role="radiogroup">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={o.key === value}
          class={kit ? `ms-kseg-btn ms-plate ${o.key === value ? 'is-active' : ''}` : 'ms-seg-btn'}
          data-nav=""
          disabled={o.disabled}
          onClick={() => {
            if (o.key !== value) {
              sfx('tab');
              onChange(o.key);
            }
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export interface TextInputProps {
  value: string;
  onInput: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  code?: boolean;
  onEnter?: () => void;
  label?: string;
  /** kit v1: recessed well with pewter rim */
  kit?: boolean;
}

export function TextInput({ value, onInput, placeholder, maxLength, code, onEnter, label, kit: kitProp }: TextInputProps): JSX.Element {
  const kit = useKit(kitProp);
  return (
    <input
      class={`${kit ? 'ms-kinput' : 'ms-input'} ${code ? (kit ? 'ms-kinput--code' : 'ms-input--code') : ''}`}
      type="text"
      value={value}
      placeholder={placeholder}
      maxLength={maxLength}
      aria-label={label}
      autocomplete="off"
      autocapitalize={code ? 'characters' : 'off'}
      spellcheck={false}
      data-nav=""
      data-arrows="xy"
      onInput={(e) => onInput((e.currentTarget as HTMLInputElement).value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') onEnter?.();
        if (e.key === 'Escape') (e.currentTarget as HTMLInputElement).blur();
      }}
    />
  );
}

/** Settings-style row: label (+hint) on the left, control on the right. */
export function Field({ label, hint, children, kit: kitProp }: { label: ComponentChildren; hint?: ComponentChildren; children?: ComponentChildren; kit?: boolean }): JSX.Element {
  const kit = useKit(kitProp);
  const p = kit ? 'ms-kfield' : 'ms-field';
  return (
    <div class={p}>
      <div class={`${p}-label`}>
        {label}
        {hint !== undefined && <span class={`${p}-hint`}>{hint}</span>}
      </div>
      <div>{children}</div>
    </div>
  );
}
