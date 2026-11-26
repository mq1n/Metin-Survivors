
import { signal } from '@preact/signals';

const STORAGE_KEY = 'ms.ui.autoCast.v2';

function defaultAutoCast(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === '0') return false;
    if (saved === '1') return true;
  } catch {
    /* private mode / blocked storage */
  }
  // Desktop (including touchscreen laptops with a mouse) defaults to manual combat (Space/LMB + 1-6); touch-only phones default to auto-cast.
  return typeof window.matchMedia === 'function' && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}

/** true = skills & basic attack fire automatically; false = manual Space/LMB basic attack + 1-6 skill hotkeys. */
export const autoCast = signal<boolean>(defaultAutoCast());

export function setAutoCast(on: boolean): void {
  autoCast.value = on;
  try {
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
}
