import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AssetManifest, ModelAsset } from '../../../apps/game/src/data/assetManifest.ts';
import { mergeManifest } from '../../pipeline/manifest.ts';
import { publishRuneVariants } from '../src/archetypes/metin/variants.ts';
import { publishPropUpdates } from './propTex.ts';

const temps: string[] = [];
function makeTemp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  while (temps.length) {
    rmSync(temps.pop()!, { recursive: true, force: true });
  }
});

describe('TOOL-RENDER-08 publication & manifest retention', () => {
  test('propTex --no-manifest retains old hashed GLB still referenced by live manifest.json', () => {
    const root = makeTemp('ms-proptex-nomanifest-');
    const publicDir = join(root, 'public');
    const lockDir = join(root, 'locks');
    const propDir = join(publicDir, 'assets', 'models', 'prop');
    const manifestDir = join(publicDir, 'assets', 'manifest');
    mkdirSync(propDir, { recursive: true });
    mkdirSync(manifestDir, { recursive: true });

    const oldBytes = new TextEncoder().encode('old-prop-glb-bytes');
    const oldFile = join(propDir, 'prop_crate.11111111.glb');
    writeFileSync(oldFile, oldBytes);

    const oldEntry: ModelAsset = {
      id: 'prop_crate',
      url: 'assets/models/prop/prop_crate.11111111.glb',
      kind: 'prop',
      height: 1,
      radius: 0.5,
      clips: {},
      tris: 12,
      bones: 0,
      bytes: oldBytes.length,
    };
    writeFileSync(join(manifestDir, 'models.json'), JSON.stringify({ prop_crate: oldEntry }, null, 2));
    mergeManifest({ publicDir, lock: { lockDir } });

    const manifestBefore = readFileSync(join(publicDir, 'assets', 'manifest.json'), 'utf8');
    const newBytes = new TextEncoder().encode('reencoded-smaller-prop-glb');

    // Step 1: --no-manifest updates models.json and writes new GLB, but MUST NOT delete oldFile
    // because live manifest.json still points to oldFile!
    const resNoManifest = publishPropUpdates([{ id: 'prop_crate', oldFile, glb: newBytes }], {
      publicDir,
      noManifest: true,
      lock: { lockDir },
    });
    expect(resNoManifest.written).toHaveLength(1);
    const newFile = resNoManifest.written[0]!.newFile;
    expect(existsSync(newFile)).toBe(true);
    expect(existsSync(oldFile)).toBe(true);
    expect(resNoManifest.retained).toEqual([oldFile]);
    expect(resNoManifest.pruned).toEqual([]);
    expect(readFileSync(join(publicDir, 'assets', 'manifest.json'), 'utf8')).toBe(manifestBefore);

    // Every URL in live manifest.json still resolves on disk
    const live = JSON.parse(readFileSync(join(publicDir, 'assets', 'manifest.json'), 'utf8')) as AssetManifest;
    expect(live.models.prop_crate!.url).toBe('assets/models/prop/prop_crate.11111111.glb');
    expect(existsSync(join(publicDir, live.models.prop_crate!.url))).toBe(true);

    // Step 2: publishing WITHOUT --no-manifest merges manifest.json atomically and prunes the unreferenced old file
    const thirdBytes = new TextEncoder().encode('third-prop-glb-bytes');
    const resWithManifest = publishPropUpdates([{ id: 'prop_crate', oldFile: newFile, glb: thirdBytes }], {
      publicDir,
      noManifest: false,
      lock: { lockDir },
    });
    expect(resWithManifest.manifestLine).toBeDefined();
    expect(existsSync(resWithManifest.written[0]!.newFile)).toBe(true);
    expect(existsSync(newFile)).toBe(false);
    const liveAfter = JSON.parse(readFileSync(join(publicDir, 'assets', 'manifest.json'), 'utf8')) as AssetManifest;
    expect(liveAfter.models.prop_crate!.url).toBe(resWithManifest.written[0]!.url);
    expect(existsSync(join(publicDir, liveAfter.models.prop_crate!.url))).toBe(true);
  });

  test('metin variants updates textures.json + aggregate manifest.json atomically and prunes old rune files only after merge', () => {
    const root = makeTemp('ms-metin-variants-');
    const publicDir = join(root, 'public');
    const lockDir = join(root, 'locks');
    const texDir = join(publicDir, 'assets', 'textures', 'metin');
    const manifestDir = join(publicDir, 'assets', 'manifest');
    mkdirSync(texDir, { recursive: true });
    mkdirSync(manifestDir, { recursive: true });

    const oldFile = join(texDir, 'tex_metin_rune_lament.aaaaaa.webp');
    writeFileSync(oldFile, new TextEncoder().encode('old-rune-webp'));
    writeFileSync(
      join(manifestDir, 'textures.json'),
      JSON.stringify(
        {
          tex_metin_rune_lament: {
            id: 'tex_metin_rune_lament',
            url: 'assets/textures/metin/tex_metin_rune_lament.aaaaaa.webp',
            kind: 'rune',
            w: 64,
            h: 64,
            srgb: true,
            bytes: 13,
          },
        },
        null,
        2,
      ),
    );
    mergeManifest({ publicDir, lock: { lockDir } });

    // With noManifest: true, old file referenced by manifest.json must be retained
    const resNoMerge = publishRuneVariants(
      [{ id: 'tex_metin_rune_lament', webp: new TextEncoder().encode('v2-rune-webp'), width: 64, height: 64 }],
      { publicDir, noManifest: true, lock: { lockDir } },
    );
    expect(existsSync(oldFile)).toBe(true);
    expect(resNoMerge.retained).toContain(oldFile);

    // Default (merge aggregate manifest): updates both textures.json and manifest.json and prunes stale files
    const resMerged = publishRuneVariants(
      [{ id: 'tex_metin_rune_lament', webp: new TextEncoder().encode('v3-rune-webp'), width: 64, height: 64 }],
      { publicDir, lock: { lockDir } },
    );
    expect(resMerged.manifestLine).toBeDefined();
    expect(existsSync(oldFile)).toBe(false);
    const live = JSON.parse(readFileSync(join(publicDir, 'assets', 'manifest.json'), 'utf8')) as AssetManifest;
    expect(live.textures.tex_metin_rune_lament!.url).toBe(resMerged.entries.tex_metin_rune_lament!.url);
    expect(existsSync(join(publicDir, live.textures.tex_metin_rune_lament!.url))).toBe(true);
  });
});
