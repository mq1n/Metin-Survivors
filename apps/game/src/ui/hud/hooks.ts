// Small HUD state shared by the taskbar, boss plate and the top-right column.
import { signal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import { layout } from '../layout';

/** "damage trail" that lags behind a falling value (HP, boss HP) and snaps up when it rises. */
export function useTrail(value: number): number {
  const [trail, setTrail] = useState(value);
  const last = useRef(value);
  useEffect(() => {
    if (value >= last.current) setTrail(value);
    else {
      const id = window.setTimeout(() => setTrail(value), 320);
      last.current = value;
      return () => window.clearTimeout(id);
    }
    last.current = value;
    return undefined;
  }, [value]);
  return trail;
}

function loadFlag(key: string, dflt: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === '0') return false;
    if (v === '1') return true;
  } catch {
    /* private mode / blocked storage */
  }
  return dflt;
}

function saveFlag(key: string, v: boolean): void {
  try {
    localStorage.setItem(key, v ? '1' : '0');
  } catch {
    /* ignore */
  }
}

const METER_KEY = 'ms.ui.damageMeter';
const MAP_KEY = 'ms.ui.minimapHidden';

/** Damage-meter table open (collapsed by default: the per-skill table is opt-in, the button still shows the live DPS). */
export const meterOpen = signal(loadFlag(METER_KEY, false));
export function setMeterOpen(v: boolean): void {
  meterOpen.value = v;
  saveFlag(METER_KEY, v);
}

/** Minimap folded away (the round map collapses to a small medallion). */
export const minimapHidden = signal(loadFlag(MAP_KEY, false));
export function setMinimapHidden(v: boolean): void {
  minimapHidden.value = v;
  saveFlag(MAP_KEY, v);
}

/** Region-map overlay (the big atlas of the zone) open. Session only. */
export const atlasOpen = signal(false);

/** Phones: spirit stones + trinkets sit behind a "gem +N" chip so the build strip stays one row. */
export const miscOpen = signal(false);

/** Build board (passives, spirit stones, trinkets by name) open: the taskbar's relic button. Session only. */
export const buildOpen = signal(false);

/** Width of the screen in rem (1920 x 1080 is 120, 1600 x 900 about 105, 1366 x 768 about 93, 1024 x 768 about 70). */
export function remWidth(): number {
  const l = layout.value;
  return l.w / l.rem;
}

/** Taskbar right half by width, from the measured parts of the strip (vitals 27 rem, coins 23, quick slots 24, sockets 26, one
 *  button 4 rem + 4.4 for every further one, ~1.5 rem of padding): the spirit-stone + trinket sockets from 118.5 rem (narrower
 *  screens keep them as a row under the buff icons, phones fold them behind a chip), the region-map button from 91 rem, the
 *  build button from 86 rem. The strip must never run off the screen. */
export const EQUIP_IN_BAR_REM = 118.5;
export const MAP_BTN_REM = 91;
export const BUILD_BTN_REM = 86;
export function equipInBar(): boolean {
  return !layout.value.compact && remWidth() >= EQUIP_IN_BAR_REM;
}
export function mapInBar(): boolean {
  return !layout.value.compact && remWidth() >= MAP_BTN_REM;
}
export function buildInBar(): boolean {
  return !layout.value.compact && remWidth() >= BUILD_BTN_REM;
}

/** "12" from 10 s up, "4.2" below. */
export function fmtCd(sec: number): string {
  return sec >= 10 ? String(Math.ceil(sec)) : sec.toFixed(1);
}
