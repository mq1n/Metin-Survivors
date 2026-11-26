// scripts/distManifest.ts: the built asset manifest against the build output (deploy `site` step + strict-assets plugin).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkDistManifest } from '../../../../scripts/distManifest';

describe('checkDistManifest', () => {
  let dist: string;
  const put = (rel: string, body = 'x'): void => {
    mkdirSync(dirname(join(dist, rel)), { recursive: true });
    writeFileSync(join(dist, rel), body);
  };
  const manifest = (m: unknown): void => put('assets/manifest.json', JSON.stringify(m));

  beforeEach(() => {
    dist = mkdtempSync(join(tmpdir(), 'ms-dist-'));
    put('index.html', '<html></html>');
  });
  afterEach(() => rmSync(dist, { recursive: true, force: true }));

  it('passes when every file the manifest names is in the build', () => {
    put('assets/models/a.1234abcd.glb');
    put('assets/textures/t.aaaaaa.webp');
    put('assets/textures/t_n.bbbbbb.webp');
    put('assets/audio/s.cccccccc.mp3');
    manifest({
      version: 'v',
      models: { a: { url: 'assets/models/a.1234abcd.glb' } },
      textures: { t: { url: 'assets/textures/t.aaaaaa.webp', normalUrl: 'assets/textures/t_n.bbbbbb.webp' } },
      audio: { s: { url: 'assets/audio/s.cccccccc.mp3', variants: [] } },
    });
    expect(checkDistManifest(dist)).toEqual({ referenced: 4, missing: [], orphans: [] });
  });

  it('reports a named file that is not in the build (a producer shipped while the build ran)', () => {
    put('assets/textures/new.50c751.webp');
    manifest({ textures: { hit: { url: 'assets/textures/old.e022fc.webp' }, ok: { url: 'assets/textures/new.50c751.webp' } }, icons: { i: { url: 'assets/icons/i.111111.webp' } } });
    const r = checkDistManifest(dist);
    expect(r.referenced).toBe(3);
    expect(r.missing).toEqual(['textures.hit.url: assets/textures/old.e022fc.webp', 'icons.i.url: assets/icons/i.111111.webp']);
  });

  it('finds urls in any field, nested lists included', () => {
    manifest({ audio: { s: { url: 'assets/audio/s.mp3', variants: ['assets/audio/s.ogg'] } }, extra: { atlas: [{ img: 'assets/vfx/atlas.png' }] } });
    put('assets/audio/s.mp3');
    expect(checkDistManifest(dist).missing).toEqual(['audio.s.variants[0]: assets/audio/s.ogg', 'extra.atlas[0].img: assets/vfx/atlas.png']);
  });

  it('lists unreferenced files under assets/<dir>/ as orphans, but not what scripts / styles / pages name', () => {
    put('assets/textures/used.aaaaaa.webp');
    put('assets/textures/stale.bbbbbb.webp');
    put('assets/ui/sprite.cccccc.webp');
    put('assets/ui/other.dddddd.webp');
    put('assets/index-AbCdEfGh.js', 'load("/assets/ui/other.dddddd.webp")'); // built chunk: sits directly in assets/, never an orphan
    put('assets/manifest/textures.json', '{"stale":"assets/textures/stale.bbbbbb.webp"}'); // producer part: ignored
    put('assets/style-12345678.css', '.a{background:url(/assets/ui/sprite.cccccc.webp)}');
    manifest({ textures: { u: { url: 'assets/textures/used.aaaaaa.webp' } } });
    expect(checkDistManifest(dist)).toEqual({ referenced: 1, missing: [], orphans: ['assets/textures/stale.bbbbbb.webp'] });
  });

  it('fails a build without a manifest and rejects a broken one', () => {
    expect(checkDistManifest(dist).missing.length).toBe(1);
    put('assets/manifest.json', '{ nope');
    expect(() => checkDistManifest(dist)).toThrow(/not valid JSON/);
  });
});
