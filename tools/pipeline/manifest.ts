// Merge producer manifest parts (public/assets/manifest/{models,textures,icons,audio}.json,
// each a JSON object keyed by asset id) into public/assets/manifest.json.
// Fails when a referenced file is missing or an id is malformed.
// Usage: bun tools/pipeline/manifest.ts
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AssetManifest } from '../../apps/game/src/data/assetManifest';
import { MANIFEST_LOCK, withLockSync, type LockOptions } from './lock';

export const PUBLIC_DIR = join(import.meta.dir, '..', '..', 'apps', 'game', 'public');
export const SECTIONS = ['models', 'textures', 'icons', 'audio'] as const;
export type ManifestSection = (typeof SECTIONS)[number];
const ID = /^[a-z0-9_]+$/;

/** Atomically replace `filePath` via a sibling temp file, with Windows share-lock fallback. */
export function writeFileAtomic(filePath: string, text: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, text);
  try {
    renameSync(tmp, filePath);
  } catch (err) {
    // Windows: a dev server watching public/ can hold the file open without share-delete, making
    // rename fail with EPERM/EBUSY/EACCES while in-place writes still succeed.
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') {
      rmSync(tmp, { force: true });
      throw err;
    }
    writeFileSync(filePath, text);
    rmSync(tmp, { force: true });
  }
}

/** Collect all asset URLs currently referenced by the aggregate `public/assets/manifest.json`. */
export function readManifestUrls(publicDir = PUBLIC_DIR): Set<string> {
  const urls = new Set<string>();
  const manifestPath = join(publicDir, 'assets', 'manifest.json');
  if (!existsSync(manifestPath)) return urls;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Partial<AssetManifest>;
  for (const section of SECTIONS) {
    const entries = manifest[section] as Record<string, { url?: string; normalUrl?: string; variants?: string[] }> | undefined;
    if (!entries) continue;
    for (const asset of Object.values(entries)) {
      if (asset.url) urls.add(asset.url);
      if (asset.normalUrl) urls.add(asset.normalUrl);
      for (const v of asset.variants ?? []) if (v) urls.add(v);
    }
  }
  return urls;
}

export interface MergeManifestResult {
  manifest: AssetManifest;
  line: string;
}

/**
 * Merge manifest parts into `public/assets/manifest.json`.
 * Caller MUST hold `MANIFEST_LOCK`.
 */
export function mergeManifestUnlocked(opts: { publicDir?: string } = {}): MergeManifestResult {
  const publicDir = opts.publicDir ?? PUBLIC_DIR;
  const partsDir = join(publicDir, 'assets', 'manifest');
  const manifest: AssetManifest = { version: '', models: {}, textures: {}, icons: {}, audio: {} };
  const errors: string[] = [];

  for (const section of SECTIONS) {
    const partPath = join(partsDir, `${section}.json`);
    if (!existsSync(partPath)) continue;
    const part = JSON.parse(readFileSync(partPath, 'utf8')) as Record<
      string,
      { id: string; url: string; variants?: string[]; normalUrl?: string }
    >;
    for (const [id, asset] of Object.entries(part)) {
      if (!ID.test(id) || asset.id !== id) {
        errors.push(`${section}/${id}: id must be snake_case and match its key`);
      }
      for (const url of [asset.url, asset.normalUrl, ...(asset.variants ?? [])]) {
        if (url && !existsSync(join(publicDir, url))) {
          errors.push(`${section}/${id}: missing file ${url}`);
        }
      }
    }
    Object.assign(manifest[section], part);
  }

  if (errors.length) {
    throw new Error(`${errors.join('\n')}\nmanifest: ${errors.length} error(s)`);
  }

  const body = JSON.stringify({ ...manifest, version: '' });
  manifest.version = createHash('sha256').update(body).digest('hex').slice(0, 12);
  writeFileAtomic(join(publicDir, 'assets', 'manifest.json'), JSON.stringify(manifest));
  const line = `manifest ${manifest.version}: ${SECTIONS.map((s) => `${Object.keys(manifest[s]).length} ${s}`).join(', ')}`;
  return { manifest, line };
}

/** Merge manifest parts into `public/assets/manifest.json` under the shared `MANIFEST_LOCK`. */
export function mergeManifest(opts: { publicDir?: string; lock?: LockOptions } = {}): MergeManifestResult {
  return withLockSync(
    MANIFEST_LOCK,
    () => mergeManifestUnlocked({ publicDir: opts.publicDir }),
    { label: 'pipeline:manifest', ...opts.lock },
  );
}

if (import.meta.main) {
  try {
    const { line } = mergeManifest();
    console.log(line);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
