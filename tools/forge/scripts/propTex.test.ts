// bun test tools/forge/scripts/propTex.test.ts
// The prop texture budget (texCap.ts) and the container-level re-encoder (propTex.ts): policy table sanity, WebP size reader,
// the "geometry bit-identical" check and the byte-ceiling fit on a real shipped prop (needs ffmpeg with libwebp, like the bake).
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ModelAsset } from '../../../apps/game/src/data/assetManifest.ts';
import { LANDMARK_TEX_MAX, LANDMARKS, PROP_TEX_MAX, propTexMax } from '../src/archetypes/prop/texCap.ts';
import { manifestPartPath, repoRoot } from '../src/core/export/manifest.ts';
import { encodeWebpAt, fitGlb, parseGlb, reencode, sameGeometry, webpSize } from './propTex.ts';

const models = JSON.parse(readFileSync(manifestPartPath(), 'utf8')) as Record<string, ModelAsset>;
const glbOf = (id: string): Uint8Array => new Uint8Array(readFileSync(join(repoRoot(), 'apps', 'game', 'public', models[id]!.url)));
const haveFfmpeg = Bun.which('ffmpeg') !== null;

describe('texCap policy', () => {
  test('a normal prop is capped at 1024, a landmark at 2048', () => {
    expect(propTexMax('prop_crate')).toBe(PROP_TEX_MAX);
    expect(propTexMax('prop_giant_pagoda')).toBe(LANDMARK_TEX_MAX);
    expect(PROP_TEX_MAX).toBe(1024);
    expect(LANDMARK_TEX_MAX).toBe(2048);
  });
  test('every landmark is a shipped prop with a sane edge and byte ceiling', () => {
    for (const [id, lm] of Object.entries(LANDMARKS)) {
      expect(models[id]?.kind, id).toBe('prop');
      expect(lm.edge, id).toBeGreaterThan(PROP_TEX_MAX);
      expect(lm.edge, id).toBeLessThanOrEqual(LANDMARK_TEX_MAX);
      expect(lm.bytes, id).toBeGreaterThan(0);
    }
  });
  test('the shipped landmark files respect their ceiling and edge', () => {
    for (const [id, lm] of Object.entries(LANDMARKS)) {
      expect(models[id]!.bytes, id).toBeLessThanOrEqual(lm.bytes);
      const { json, bin } = parseGlb(glbOf(id));
      for (const img of json.images ?? []) {
        const v = json.bufferViews[img.bufferView];
        const [w, h] = webpSize(bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength));
        expect(Math.max(w, h), id).toBeLessThanOrEqual(lm.edge);
      }
    }
  });
  test('every other shipped prop is at most 1024 px', () => {
    for (const id of Object.keys(models)) {
      if (models[id]!.kind !== 'prop' || LANDMARKS[id]) continue;
      const { json, bin } = parseGlb(glbOf(id));
      for (const img of json.images ?? []) {
        const v = json.bufferViews[img.bufferView];
        const [w, h] = webpSize(bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength));
        expect(Math.max(w, h), id).toBeLessThanOrEqual(PROP_TEX_MAX);
      }
    }
  });
});

describe.skipIf(!haveFfmpeg)('re-encoder (ffmpeg)', () => {
  const id = 'prop_house_small'; // a forge prop with ONE texture above 512 px (prop_urn and prop_boulder became Tripo props in the forge-audit / r4 ships)
  test('a lower cap changes only the image: geometry stays bit-identical', () => {
    const src = glbOf(id);
    const r = reencode(src, { max: 512 });
    expect(r.changed).toBe(true);
    expect(r.images.every((i) => i.after && Math.max(i.after.w, i.after.h) <= 512)).toBe(true);
    expect(sameGeometry(src, r.glb)).toBeNull();
    expect(r.glb.length).toBeLessThan(src.length);
  });
  test('sameGeometry notices a changed geometry byte', () => {
    const src = glbOf(id);
    const bad = new Uint8Array(reencode(src, { max: 512 }).glb);
    const binStart = 20 + new DataView(bad.buffer).getUint32(12, true) + 8; // 12 header + 8 JSON chunk header + JSON, then the BIN chunk header
    const { json } = parseGlb(bad);
    const imageViews = new Set((json.images ?? []).map((im: { bufferView: number }) => im.bufferView));
    const view = json.bufferViews.find((_: unknown, i: number) => !imageViews.has(i));
    const rel = view.extensions?.EXT_meshopt_compression?.byteOffset ?? view.byteOffset ?? 0;
    bad[binStart + rel + 1] = bad[binStart + rel + 1]! ^ 0xff;
    expect(sameGeometry(src, bad)).not.toBeNull();
  });
  test('fitGlb stays under its ceiling and never up-samples', () => {
    const src = glbOf(id);
    const limit = Math.floor(src.length * 0.8);
    const f = fitGlb(src, limit, 4096);
    expect(f).not.toBeNull();
    expect(f!.glb.length).toBeLessThanOrEqual(limit);
    expect(f!.images.every((i) => !i.after || Math.max(i.after.w, i.after.h) <= Math.max(i.before.w, i.before.h))).toBe(true);
    expect(sameGeometry(src, f!.glb)).toBeNull();
  });
  test('fitGlb returns the source untouched when it already fits', () => {
    const src = glbOf(id);
    const f = fitGlb(src, src.length, 4096);
    expect(f).not.toBeNull();
    expect(f!.changed).toBe(false);
    expect(f!.glb).toBe(src);
  });
  test('encodeWebpAt writes a WebP of the asked size', () => {
    const { json, bin } = parseGlb(glbOf(id));
    const v = json.bufferViews[json.images[0].bufferView];
    const webp = bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
    expect(webpSize(encodeWebpAt(webp, 64, 48, 80))).toEqual([64, 48]);
  });
});
