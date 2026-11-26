// Painted parts of the pause / settings windows (B8). Every id is looked up in the manifest; while it is not shipped the CSS / SVG
// fallbacks of pause.css / settings.css are the look.
//  - painted tube + liquid fills of the shipped HUD materials (uk_hud_gtube, uk_hud_gfill_red / gold / blue): the pause gauges and the
//    gold slider fills of the settings window use them as read-only materials (the same strips the HUD, loading bar and run-end use)

//    (cloud-scroll title ornament, transparent); the inline-SVG curl of settings.css stands in
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { texUrl } from '../assets';

/** material id -> custom property of the window root */
const MATERIALS: readonly (readonly [id: string, cssVar: string])[] = [
  ['uk_hud_gtube', '--tex-ps-gtube'],
  ['uk_hud_gfill_red', '--tex-ps-gfill-red'],
  ['uk_hud_gfill_gold', '--tex-ps-gfill-gold'],
  ['uk_hud_gfill_blue', '--tex-ps-gfill-blue'],
];
/** optional own ornaments (not required: no retry while they are missing) */
const OPTIONAL: readonly (readonly [id: string, cssVar: string])[] = [
  ['uk_pause_settings_cap', '--ps-cap'],
  /** painted slider knob (steel block, rivets, amber lens) and the steel spear head at each end of the slider rail */
  ['uk_pause_settings_knob', '--ps-knob'],
  ['uk_pause_settings_spear', '--ps-spear'],
];

function read(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const [id, v] of [...MATERIALS, ...OPTIONAL]) {
      const u = texUrl(id);
      if (u) out[v] = `url("${u}")`;
    }
  } catch {
    /* manifest not ready */
  }
  return out;
}

/** Inline custom properties for a window root (one-shot read; prefer `usePsTex` in components that render before the manifest). */
export function psTexStyle(): JSX.CSSProperties {
  return read() as JSX.CSSProperties;
}

/** Same properties, re-read once after 0.6 s when the HUD materials were not in the manifest yet (it can finish after the first paint). */
export function usePsTex(): JSX.CSSProperties {
  const [tex, setTex] = useState(read);
  const missing = MATERIALS.some(([, v]) => !tex[v]);
  useEffect(() => {
    if (!missing) return undefined;
    const id = window.setTimeout(() => setTex(read()), 600);
    return () => window.clearTimeout(id);
  }, [missing]);
  return tex as JSX.CSSProperties;
}
