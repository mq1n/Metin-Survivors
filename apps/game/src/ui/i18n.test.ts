// i18n consistency: EN and TR have the same keys and placeholders, no empty strings, and every literal `t('…')` /
// `tn('…')` key used by the UI sources exists in both dictionaries.
import { describe, expect, it } from 'vitest';
import { dictionaries } from '../i18n/i18n';

const sources = import.meta.glob<string>('./**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true });

const en = dictionaries.en;
const tr = dictionaries.tr;

function placeholders(s: string): string[] {
  return [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort();
}

describe('i18n dictionaries', () => {
  it('EN and TR define the same keys', () => {
    const missingInTr = Object.keys(en).filter((k) => !(k in tr));
    const missingInEn = Object.keys(tr).filter((k) => !(k in en));
    expect({ missingInTr, missingInEn }).toEqual({ missingInTr: [], missingInEn: [] });
  });

  it('placeholders match between EN and TR', () => {
    const bad: string[] = [];
    for (const [k, v] of Object.entries(en)) {
      const other = tr[k];
      if (other !== undefined && placeholders(v).join(',') !== placeholders(other).join(',')) bad.push(k);
    }
    expect(bad).toEqual([]);
  });

  it('has no empty strings', () => {
    const empty = [...Object.entries(en), ...Object.entries(tr)].filter(([, v]) => v.trim() === '').map(([k]) => k);
    expect(empty).toEqual([]);
  });

  it('every literal t()/tn() key used in src/ui exists', () => {
    const used = new Map<string, string>();
    for (const [file, text] of Object.entries(sources)) {
      if (file.endsWith('.test.ts')) continue;
      for (const m of text.matchAll(/\bt\(\s*'([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+)'/g)) used.set(m[1] ?? '', file);
      for (const m of text.matchAll(/\btn\(\s*'([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+)'/g)) {
        used.set(`${m[1] ?? ''}.one`, file);
        used.set(`${m[1] ?? ''}.other`, file);
      }
    }
    const missing = [...used].filter(([k]) => !(k in en) || !(k in tr)).map(([k, f]) => `${k} (${f})`);
    expect(missing).toEqual([]);
  });
});
