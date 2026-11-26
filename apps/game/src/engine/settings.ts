// Player settings: persisted to localStorage, exposed as a Preact signal so UI and engine react.
// The META agent mirrors `settings.value` into SaveData.settings; it must call `settings.update()` to write.
import { signal, type ReadonlySignal } from '@preact/signals';
import type { Lang } from '../data/schema';

export type QualitySetting = 'auto' | 'low' | 'medium' | 'high' | 'ultra';
export type DamageNumberMode = 'off' | 'crit' | 'all';

export interface SettingsData {
  language: Lang;
  /** 0..1 */
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  quality: QualitySetting;
  /** 0 = use the quality tier default */
  dprCap: number;
  /** 0..1 camera shake multiplier */
  screenShake: number;
  damageNumbers: DamageNumberMode;
  showFps: boolean;
  /** show the on-screen touch joystick even on non-touch devices */
  touchControls: boolean;
  /** HD-01: first-time hint plates in the HUD (a one-line tip the first time corruption, an awakening, a locked chest ... shows up) */
  showHints: boolean;
  /** HD-01: ids of the hints this profile has already been shown (ui/hud/hints.ts); at most `MAX_HINTS_SEEN`, never repeated */
  hintsSeen: string[];
}

/** most hint ids the list keeps (the game has about a dozen hints; the cap only bounds what a hand-edited save can carry) */
export const MAX_HINTS_SEEN = 64;
/** a hint id is a short token: letters, digits and `_ . : -` */
const HINT_ID = /^[A-Za-z0-9_.:-]{1,40}$/;

const STORAGE_KEY = 'ms.settings.v1';

export function detectLanguage(): Lang {
  const nav = typeof navigator === 'undefined' ? '' : (navigator.language || '').toLowerCase();
  return nav.startsWith('tr') ? 'tr' : 'en';
}

export function defaultSettings(): SettingsData {
  return {
    language: detectLanguage(),
    masterVolume: 0.8,
    musicVolume: 0.6,
    sfxVolume: 0.8,
    quality: 'auto',
    dprCap: 0,
    screenShake: 1,
    damageNumbers: 'all',
    showFps: false,
    touchControls: false,
    showHints: true,
    hintsSeen: [],
  };
}

/** Valid hint ids in order, without repeats, at most `MAX_HINTS_SEEN`; anything that is not a list of such strings is an empty list. */
function sanitizeHintIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string' || !HINT_ID.test(v) || out.includes(v)) continue;
    out.push(v);
    if (out.length >= MAX_HINTS_SEEN) break;
  }
  return out;
}

const clamp01 = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);

/** Validates untrusted data (localStorage, cloud save) against the defaults. */
export function sanitizeSettings(raw: unknown): SettingsData {
  const d = defaultSettings();
  if (typeof raw !== 'object' || raw === null) return d;
  const r = raw as Record<string, unknown>;
  const quality = r.quality;
  const dmg = r.damageNumbers;
  return {
    language: r.language === 'tr' || r.language === 'en' ? r.language : d.language,
    masterVolume: clamp01(r.masterVolume, d.masterVolume),
    musicVolume: clamp01(r.musicVolume, d.musicVolume),
    sfxVolume: clamp01(r.sfxVolume, d.sfxVolume),
    quality:
      quality === 'auto' || quality === 'low' || quality === 'medium' || quality === 'high' || quality === 'ultra'
        ? quality
        : d.quality,
    dprCap: typeof r.dprCap === 'number' && Number.isFinite(r.dprCap) ? Math.min(3, Math.max(0, r.dprCap)) : d.dprCap,
    screenShake: clamp01(r.screenShake, d.screenShake),
    damageNumbers: dmg === 'off' || dmg === 'crit' || dmg === 'all' ? dmg : d.damageNumbers,
    showFps: typeof r.showFps === 'boolean' ? r.showFps : d.showFps,
    touchControls: typeof r.touchControls === 'boolean' ? r.touchControls : d.touchControls,
    showHints: typeof r.showHints === 'boolean' ? r.showHints : d.showHints,
    hintsSeen: sanitizeHintIds(r.hintsSeen),
  };
}

function load(): SettingsData {
  try {
    const txt = localStorage.getItem(STORAGE_KEY);
    return sanitizeSettings(txt ? JSON.parse(txt) : null);
  } catch {
    return defaultSettings();
  }
}

class Settings {
  private readonly sig = signal<SettingsData>(load());
  /** Reactive snapshot; never mutate the object, call `update`. */
  readonly signal: ReadonlySignal<SettingsData> = this.sig;

  get value(): SettingsData {
    return this.sig.value;
  }

  update(patch: Partial<SettingsData>): void {
    this.sig.value = sanitizeSettings({ ...this.sig.value, ...patch });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.sig.value));
    } catch {
      /* private mode / quota: settings stay in memory */
    }
  }

  reset(): void {
    this.update(defaultSettings());
  }

  /** "Reset to defaults" of the settings screen: every preference back to its default, but the language and the hints the player has
   *  already been told stay (resetting the volume must not replay the tutorial). */
  resetPreferences(): void {
    const { language, hintsSeen } = this.sig.value;
    this.update({ ...defaultSettings(), language, hintsSeen });
  }

  /** Records that a first-time hint was shown (once per profile). A full list drops its oldest id to make room. */
  markHintSeen(id: string): void {
    const seen = this.sig.value.hintsSeen;
    if (!HINT_ID.test(id) || seen.includes(id)) return;
    this.update({ hintsSeen: [...seen.slice(Math.max(0, seen.length - (MAX_HINTS_SEEN - 1))), id] });
  }

  /** "Reset hints": every first-time hint shows again. */
  resetHints(): void {
    if (this.sig.value.hintsSeen.length > 0) this.update({ hintsSeen: [] });
  }

  /** Subscribes to changes; returns an unsubscribe function. Fires immediately. */
  subscribe(fn: (s: SettingsData) => void): () => void {
    return this.sig.subscribe(fn);
  }
}

export const settings = new Settings();
