import { describe, expect, it } from 'vitest';
import { scrubReason } from './loadFailure';

describe('scrubReason', () => {
  it('takes file paths, hashes and urls out of the cause but keeps the status code', () => {
    expect(scrubReason('Failed to fetch assets/models/enemy/orc_scout.4f1c2a9e.glb (HTTP 503)')).toBe('Failed to fetch a game file, HTTP 503');
    expect(scrubReason('GET https://cdn.example.com/a/b/c.webp failed (404)')).toBe('GET a game file failed, 404');
    expect(scrubReason('orc_scout.4f1c2a9e.glb')).toBe('a game file');
  });

  it('leaves a plain browser error alone, flattens lines and caps the length', () => {
    expect(scrubReason('Failed to fetch')).toBe('Failed to fetch');
    expect(scrubReason('line one\nline two')).toBe('line one line two');
    expect(scrubReason('x'.repeat(400)).length).toBeLessThanOrEqual(120);
    expect(scrubReason('')).toBe('unknown error');
  });
});

describe('localizeReason', () => {
  it('words the browser network failure in the UI language and keeps the status code', async () => {
    const { localizeReason } = await import('./loadFailure');
    const out = localizeReason('Failed to fetch a game file, HTTP 503');
    expect(out).toContain('HTTP 503');
    expect(out).not.toContain('boot.reason.fetch');
    expect(localizeReason('Failed to fetch')).toContain('Failed to fetch');
    expect(localizeReason('something odd')).toBe('something odd');
  }, 60_000);
});

describe('loadFailureMessage wording', () => {
  it('reads next to a RETRY + BACK dialog: it never tells the player to go back AND try again as the only way out', async () => {
    const { loadFailureMessage } = await import('./loadFailure');
    const { dictionaries } = await import('../i18n/i18n');
    for (const l of ['en', 'tr'] as const) {
      const s = dictionaries[l]['boot.loadFailedMsg'];
      expect(s, l).toContain('{reason}');
      expect(s, l).not.toMatch(/go back and try again|geri dönüp tekrar dene/i);
    }
    expect(loadFailureMessage(new Error('Failed to fetch assets/x.1234abcd.glb (HTTP 503)'))).toContain('HTTP 503');
  }, 60_000);

  it('the loading screen has a stopped caption in both languages (the gauge stops claiming a stage)', async () => {
    const { dictionaries } = await import('../i18n/i18n');
    expect(dictionaries.en['boot.stage.failed']).toBeTruthy();
    expect(dictionaries.tr['boot.stage.failed']).toBeTruthy();
  }, 60_000);
});

describe('a lazy code chunk that did not load (the skill effects of a hero class, vfx/skills/loader.ts)', () => {
  const CHROME = 'Failed to fetch dynamically imported module: https://metin-survivors.pages.dev/assets/warrior-T2oLBBs1.js';
  it('is recognised in the wording of every browser', async () => {
    const { isChunkLoadError } = await import('./loadFailure');
    expect(isChunkLoadError(new TypeError(CHROME))).toBe(true);
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module: https://x/assets/ninja-abc.js'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of "text/html".'))).toBe(true);
    expect(isChunkLoadError(new Error('Failed to fetch assets/models/enemy/orc_scout.4f1c2a9e.glb (HTTP 503)'))).toBe(false);
    expect(isChunkLoadError('something odd')).toBe(false);
  }, 60_000);

  it('reads as a sentence in both languages: no file name, no hash, no "dynamically imported module"', async () => {
    const { loadFailureMessage } = await import('./loadFailure');
    const { dictionaries } = await import('../i18n/i18n');
    for (const l of ['en', 'tr'] as const) expect(dictionaries[l]['boot.reason.chunk'], l).toBeTruthy();
    const msg = loadFailureMessage(new TypeError(CHROME));
    expect(msg).not.toMatch(/warrior-|\.js|dynamically|https?:/i);
    expect(msg).toMatch(/\(.{10,}\)/); // the reason in brackets, like every other load failure
  }, 60_000);
});
