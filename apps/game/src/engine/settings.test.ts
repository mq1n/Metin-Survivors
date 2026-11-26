// Player settings (HD-01): the first-time-hint fields `showHints` / `hintsSeen`, their sanitising, persistence and that a settings blob
// from before the fields existed (saves, localStorage, cloud copies) is still valid and gets the defaults.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureContent } from '../meta/__fixtures__/content';
import { freshSave } from '../meta/__fixtures__/testkit';
import { exportMsav, importMsav } from '../meta/msav';
import { normalizeSave } from '../meta/save';
import { SAVE_VERSION } from '../meta/types';
import { defaultSettings, sanitizeSettings, settings } from './settings';

const KEY = 'ms.settings.v1';

/** The pre-HD-01 shape: every field the settings had before `showHints` / `hintsSeen`. */
function oldBlob(): Record<string, unknown> {
  return {
    language: 'tr',
    masterVolume: 0.5,
    musicVolume: 0.25,
    sfxVolume: 0.75,
    quality: 'high',
    dprCap: 2,
    screenShake: 0.5,
    damageNumbers: 'crit',
    showFps: true,
    touchControls: true,
  };
}

class MemStorage {
  private readonly m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v);
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
}

describe('settings: hint fields', () => {
  it('defaults: hints on, nothing seen', () => {
    const d = defaultSettings();
    expect(d.showHints).toBe(true);
    expect(d.hintsSeen).toEqual([]);
  });

  it('an old settings blob (no hint fields) stays valid: every old value kept, the new ones default', () => {
    const s = sanitizeSettings(oldBlob());
    expect(s).toEqual({ ...oldBlob(), showHints: true, hintsSeen: [] });
  });

  it('garbage input falls back to the defaults', () => {
    for (const raw of [null, undefined, 7, 'x', [], true]) {
      const s = sanitizeSettings(raw);
      expect(s.showHints).toBe(true);
      expect(s.hintsSeen).toEqual([]);
    }
  });

  it('showHints keeps a real boolean and defaults on anything else', () => {
    expect(sanitizeSettings({ showHints: false }).showHints).toBe(false);
    expect(sanitizeSettings({ showHints: true }).showHints).toBe(true);
    for (const bad of ['no', 0, null, [], {}]) expect(sanitizeSettings({ showHints: bad }).showHints).toBe(true);
  });

  it('hintsSeen keeps valid ids in order and drops everything else', () => {
    expect(sanitizeSettings({ hintsSeen: ['levelUp', 'boss'] }).hintsSeen).toEqual(['levelUp', 'boss']);
    expect(sanitizeSettings({ hintsSeen: 'levelUp' }).hintsSeen).toEqual([]);
    expect(sanitizeSettings({ hintsSeen: { 0: 'a' } }).hintsSeen).toEqual([]);
    expect(sanitizeSettings({ hintsSeen: ['a', 3, null, '', 'b c', 'x'.repeat(41), 'ok.id-1:2_3', { id: 'z' }] }).hintsSeen).toEqual(['a', 'ok.id-1:2_3']);
  });

  it('hintsSeen drops duplicates and is capped at 64 entries', () => {
    expect(sanitizeSettings({ hintsSeen: ['a', 'b', 'a', 'b', 'c'] }).hintsSeen).toEqual(['a', 'b', 'c']);
    const many = Array.from({ length: 200 }, (_, i) => `h${i}`);
    const out = sanitizeSettings({ hintsSeen: many }).hintsSeen;
    expect(out).toHaveLength(64);
    expect(out[0]).toBe('h0');
    expect(out[63]).toBe('h63');
  });

  it('sanitising is idempotent', () => {
    const once = sanitizeSettings({ ...oldBlob(), showHints: false, hintsSeen: ['levelUp', 'levelUp', 'boss', 5] });
    expect(sanitizeSettings(once)).toEqual(once);
  });
});

describe('settings: the save boundary (no SAVE_VERSION change, no migration needed)', () => {
  const C = fixtureContent;

  it('a save written before the hint fields loads at the same SAVE_VERSION with the defaults for them', () => {
    const raw = JSON.parse(JSON.stringify(freshSave())) as { settings: Record<string, unknown>; version: number };
    raw.settings = oldBlob();
    expect(SAVE_VERSION).toBe(1);
    const s = normalizeSave(raw, C);
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.settings).toEqual({ ...oldBlob(), showHints: true, hintsSeen: [] });
  });

  it('hintsSeen / showHints survive a .msav export and import, and a hand-edited list is cleaned on the way in', () => {
    const save = freshSave();
    save.settings = { ...defaultSettings(), showHints: false, hintsSeen: ['boss', 'levelUp'] };
    const back = importMsav(exportMsav(save), C).save;
    expect(back.settings.showHints).toBe(false);
    expect(back.settings.hintsSeen).toEqual(['boss', 'levelUp']);
    const edited = JSON.parse(JSON.stringify(save)) as { settings: Record<string, unknown> };
    edited.settings.hintsSeen = ['boss', 'boss', 42, 'x'.repeat(99), ...Array.from({ length: 100 }, (_, i) => `h${i}`)];
    const s = normalizeSave(edited, C);
    expect(s.settings.hintsSeen).toHaveLength(64);
    expect(s.settings.hintsSeen[0]).toBe('boss');
    expect(new Set(s.settings.hintsSeen).size).toBe(64);
  });
});

describe('settings: hintsSeen on the live store', () => {
  let store: MemStorage;
  beforeEach(() => {
    store = new MemStorage();
    vi.stubGlobal('localStorage', store);
    settings.update({ showHints: true, hintsSeen: [] });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    settings.update({ showHints: true, hintsSeen: [] });
  });

  it('markHintSeen records an id once and persists it', () => {
    settings.markHintSeen('levelUp');
    settings.markHintSeen('levelUp');
    settings.markHintSeen('boss');
    expect(settings.value.hintsSeen).toEqual(['levelUp', 'boss']);
    const stored = JSON.parse(store.getItem(KEY) as string) as Record<string, unknown>;
    expect(stored.hintsSeen).toEqual(['levelUp', 'boss']);
    expect(sanitizeSettings(stored)).toEqual(settings.value);
  });

  it('markHintSeen ignores an invalid id', () => {
    settings.markHintSeen('');
    settings.markHintSeen('has space');
    expect(settings.value.hintsSeen).toEqual([]);
  });

  it('a full list stays at 64: the oldest id makes room, the newest is always recorded', () => {
    for (let i = 0; i < 70; i++) settings.markHintSeen(`h${i}`);
    const seen = settings.value.hintsSeen;
    expect(seen).toHaveLength(64);
    expect(seen).toContain('h69');
    expect(seen).not.toContain('h0');
    expect(seen[0]).toBe('h6');
  });

  it('resetHints clears the list (and persists it) but keeps the other settings', () => {
    settings.update({ showHints: false, quality: 'low', hintsSeen: ['a', 'b'] });
    settings.resetHints();
    expect(settings.value.hintsSeen).toEqual([]);
    expect(settings.value.showHints).toBe(false);
    expect(settings.value.quality).toBe('low');
    expect((JSON.parse(store.getItem(KEY) as string) as { hintsSeen: string[] }).hintsSeen).toEqual([]);
  });

  it('an unrelated update keeps hintsSeen', () => {
    settings.markHintSeen('boss');
    settings.update({ masterVolume: 0.3 });
    expect(settings.value.hintsSeen).toEqual(['boss']);
  });

  it('resetPreferences restores the defaults but keeps the language and what the player has already been told', () => {
    settings.update({ language: 'tr', quality: 'low', showHints: false, hintsSeen: ['a', 'b'] });
    settings.resetPreferences();
    const s = settings.value;
    expect(s.language).toBe('tr');
    expect(s.hintsSeen).toEqual(['a', 'b']);
    expect(s.quality).toBe('auto');
    expect(s.showHints).toBe(true);
  });

  it('works when storage is blocked (private mode): settings stay in memory', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(() => settings.markHintSeen('boss')).not.toThrow();
    expect(settings.value.hintsSeen).toEqual(['boss']);
  });
});
