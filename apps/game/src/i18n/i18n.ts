// UI chrome localisation: flat `namespace.key` dictionaries (en.json / tr.json, plus optional per-area parts in
// ./parts/<area>.<lang>.json that are merged on top). Content text (skills, zones, bosses…) is inline `{ tr, en }`
// in the content JSON and read through `tl()`. The active language lives in the engine settings (so it is mirrored
// into the save and shared with the cloud/export paths); everything here is signal-driven, so components re-render
// the moment the language changes.
import { computed, type ReadonlySignal } from '@preact/signals';
import type { L10n, Lang } from '../data/schema';
import { settings } from '../engine/settings';
import en from './en.json';
import tr from './tr.json';

export type { Lang };
export type Dict = Record<string, string>;
export type Params = Record<string, string | number>;

const partModules = import.meta.glob<Dict>('./parts/*.json', { eager: true, import: 'default' });

function mergeParts(lang: Lang, base: Dict): Dict {
  const out: Dict = { ...base };
  for (const [path, mod] of Object.entries(partModules)) {
    if (path.endsWith(`.${lang}.json`)) Object.assign(out, mod);
  }
  return out;
}

/** All dictionaries (exported for the consistency test and the gallery). */
export const dictionaries: Record<Lang, Dict> = {
  en: mergeParts('en', en as Dict),
  tr: mergeParts('tr', tr as Dict),
};

/** Active language (follows `settings.language`). */
export const lang: ReadonlySignal<Lang> = computed(() => settings.signal.value.language);

export function setLang(next: Lang): void {
  settings.update({ language: next });
}

const warned = new Set<string>();

function interpolate(s: string, params?: Params): string {
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => {
    const v = params[k];
    return v === undefined ? m : String(v);
  });
}

/** Looks a key up in the active language, falling back to English and finally to the key itself. */
export function t(key: string, params?: Params): string {
  const l = lang.value;
  const hit = dictionaries[l][key] ?? dictionaries.en[key];
  if (hit === undefined) {
    if (import.meta.env.DEV && !warned.has(key)) {
      warned.add(key);
      console.warn(`[i18n] missing key "${key}"`);
    }
    return key;
  }
  return interpolate(hit, params);
}

/** Count-aware lookup: `key.one` (English singular) / `key.other`; Turkish always uses `key.other`. */
export function tn(key: string, n: number, params?: Params): string {
  const one = lang.value === 'en' && n === 1;
  return t(`${key}.${one ? 'one' : 'other'}`, { n: fmtInt(n), ...params });
}

/** Inline content text. */
export function tl(text: L10n | undefined | null): string {
  if (!text) return '';
  return text[lang.value] || text.en || text.tr || '';
}

// ---------------------------------------------------------------------------
// Number / time formatting

const nfCache = new Map<string, Intl.NumberFormat>();
function nf(l: Lang, opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${l}|${JSON.stringify(opts)}`;
  let f = nfCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(l === 'tr' ? 'tr-TR' : 'en-US', opts);
    nfCache.set(key, f);
  }
  return f;
}

export function fmtInt(n: number): string {
  return nf(lang.value, { maximumFractionDigits: 0 }).format(Math.round(Number.isFinite(n) ? n : 0));
}

/** 1 234 567 → "1,2M" style short form for dense counters. */
export function fmtCompact(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  if (Math.abs(v) < 10_000) return fmtInt(v);
  return nf(lang.value, { notation: 'compact', maximumFractionDigits: 1 }).format(v);
}

export function fmtDec(n: number, digits = 1): string {
  return nf(lang.value, { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(Number.isFinite(n) ? n : 0);
}

/** fraction (0.34) → "34%" */
export function fmtPct(fraction: number, digits = 0): string {
  return nf(lang.value, { style: 'percent', maximumFractionDigits: digits }).format(Number.isFinite(fraction) ? fraction : 0);
}

/** seconds → "m:ss" (or "h:mm:ss" past an hour) */
export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const pad = (v: number): string => String(v).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${pad(m)}:${pad(r)}`;
}

export function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString(lang.value === 'tr' ? 'tr-TR' : 'en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function fmtDateTime(ms: number): string {
  return new Date(ms).toLocaleString(lang.value === 'tr' ? 'tr-TR' : 'en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Relative age ("3 min ago" / "3 dk önce"). */
export function fmtAgo(ms: number, now: number = Date.now()): string {
  const d = Math.max(0, Math.round((now - ms) / 1000));
  if (d < 45) return t('time.justNow');
  const m = Math.round(d / 60);
  if (m < 60) return t('time.minAgo', { n: m });
  const h = Math.round(m / 60);
  if (h < 36) return t('time.hourAgo', { n: h });
  return t('time.dayAgo', { n: Math.round(h / 24) });
}

/** Browser-language default (the engine settings already do this on first run). */
export { detectLanguage } from '../engine/settings';
