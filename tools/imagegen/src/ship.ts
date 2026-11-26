// Ship approved builds into apps/game/public/assets (content-hashed names) and write the manifest parts.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { IconAsset, TextureAsset, TextureKind } from '../../../apps/game/src/data/assetManifest';
import { MANIFEST_LOCK, withLockSync, type LockOptions } from '../../pipeline/lock';
import { mergeManifestUnlocked, readManifestUrls, writeFileAtomic } from '../../pipeline/manifest';
import { ASSETS, MANIFEST_DIR, PUBLIC, SHIPPED } from './paths';
import { readReport } from './post';
import { loadReview } from './review';
import type { JobSpec } from './types';

type TexturePart = Record<string, TextureAsset>;
type IconPart = Record<string, IconAsset>;

/** id → files (relative to public/) that this tool shipped, so re-ships replace instead of accumulate. */
type ShippedIndex = Record<string, { section: 'textures' | 'icons'; files: string[] }>;

function hash6(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 6);
}

function outDirFor(job: JobSpec): string {
  if (job.outDir) return job.outDir;
  if (job.kind === 'icon') return 'icons';
  if (job.kind === 'vfx') return 'textures/vfx';
  if (job.kind === 'ui' || job.kind === 'portrait' || job.kind === 'illustration') return 'ui';
  return `textures/${job.group}`;
}

function readJson<T>(path: string, fallback: T): T {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : fallback;
}

export interface ShipResult {
  shipped: string[];
  skipped: { id: string; why: string }[];
  manifestLine?: string;
}

export interface ShipOpts {
  ids?: string[];
  all?: boolean;
  /** Also merge aggregate `manifest.json` inside the same `MANIFEST_LOCK` before pruning old files. */
  mergeAggregate?: boolean;
  lock?: LockOptions;
}

export function ship(jobs: JobSpec[], opts: ShipOpts = {}): ShipResult {
  return withLockSync(
    MANIFEST_LOCK,
    () => shipLocked(jobs, opts),
    { label: 'imagegen:ship', ...opts.lock },
  );
}

function shipLocked(jobs: JobSpec[], opts: ShipOpts): ShipResult {
  mkdirSync(MANIFEST_DIR, { recursive: true });
  const review = loadReview();
  const index = readJson<ShippedIndex>(SHIPPED, {});
  const textures = readJson<TexturePart>(join(MANIFEST_DIR, 'textures.json'), {});
  const icons = readJson<IconPart>(join(MANIFEST_DIR, 'icons.json'), {});
  const result: ShipResult = { shipped: [], skipped: [] };
  const pendingCleanup: string[] = [];

  for (const job of jobs) {
    if (opts.ids && !opts.ids.includes(job.id)) continue;
    if (!opts.all && review[job.id]?.status !== 'approved') continue;
    const report = readReport(job.id);
    if (!report) {
      result.skipped.push({ id: job.id, why: 'not built' });
      continue;
    }
    const dirRel = outDirFor(job);
    const dirAbs = join(ASSETS, dirRel);
    mkdirSync(dirAbs, { recursive: true });

    const files: string[] = [];
    const place = (src: string, name: string): string => {
      const file = `${name}.${hash6(src)}.webp`;
      const dst = join(dirAbs, file);
      if (!existsSync(dst)) copyFileSync(src, dst);
      const rel = relative(PUBLIC, dst).replaceAll('\\', '/');
      files.push(rel);
      return rel;
    };
    const url = place(report.main, job.id);
    const normalUrl = report.normal ? place(report.normal, `${job.id}_n`) : undefined;
    // icon v2 tiles: rank-band variants ship as their own icon ids (<id>__m|g|p), listed on the base entry
    const variants: Partial<Record<'m' | 'g' | 'p', string>> = {};
    const variantEntries: IconAsset[] = [];
    if (job.kind === 'icon') {
      for (const [band, v] of Object.entries(report.variants ?? {})) {
        if (band !== 'm' && band !== 'g' && band !== 'p') continue;
        const vid = `${job.id}__${band}`;
        variants[band] = vid;
        variantEntries.push({ id: vid, url: place(v.path, vid), size: report.w, bytes: v.bytes, ...(report.form ? { style: { form: report.form } } : {}) });
      }
    }
    for (const old of index[job.id]?.files ?? []) {
      if (!files.includes(old)) pendingCleanup.push(old);
    }

    if (job.kind === 'icon') {
      const style = report.form ? { form: report.form, ...(variantEntries.length ? { variants } : {}) } : undefined;
      icons[job.id] = { id: job.id, url, size: report.w, bytes: report.bytes, ...(style ? { style } : {}) };
      for (const band of ['m', 'g', 'p'] as const) if (!variants[band]) delete icons[`${job.id}__${band}`];
      for (const v of variantEntries) icons[v.id] = v;
      delete textures[job.id];
      index[job.id] = { section: 'icons', files };
    } else {
      const asset: TextureAsset = {
        id: job.id,
        url,
        kind: job.kind as TextureKind,
        w: report.w,
        h: report.h,
        srgb: job.srgb ?? true,
        bytes: report.bytes,
      };
      if (job.tiling) asset.tiling = true;
      if (normalUrl) asset.normalUrl = normalUrl;
      // vfx always states it: alpha false = additive sprite on black, true = alpha-blended sprite
      if (report.alpha || job.kind === 'vfx') asset.alpha = report.alpha;
      textures[job.id] = asset;
      delete icons[job.id];
      index[job.id] = { section: 'textures', files };
    }
    result.shipped.push(job.id);
  }

  writeFileAtomic(join(MANIFEST_DIR, 'textures.json'), JSON.stringify(sortKeys(textures), null, 1));
  writeFileAtomic(join(MANIFEST_DIR, 'icons.json'), JSON.stringify(sortKeys(icons), null, 1));
  writeFileAtomic(SHIPPED, JSON.stringify(index, null, 1));

  if (opts.mergeAggregate && result.shipped.length > 0) {
    result.manifestLine = mergeManifestUnlocked({ publicDir: PUBLIC }).line;
  }

  // Only prune replaced files that are no longer referenced by live aggregate manifest.json or current part manifests
  const liveUrls = readManifestUrls(PUBLIC);
  for (const old of pendingCleanup) {
    if (!liveUrls.has(old)) rmSync(join(PUBLIC, old), { force: true });
  }
  return result;
}

function sortKeys<T>(o: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
}

/** Remove shipped files + manifest entries for ids (e.g. after a style change). */
export function unship(ids: string[], opts: { mergeAggregate?: boolean; lock?: LockOptions } = {}): { manifestLine?: string } {
  return withLockSync(
    MANIFEST_LOCK,
    () => unshipLocked(ids, opts),
    { label: 'imagegen:unship', ...opts.lock },
  );
}

function unshipLocked(ids: string[], opts: { mergeAggregate?: boolean }): { manifestLine?: string } {
  const index = readJson<ShippedIndex>(SHIPPED, {});
  const textures = readJson<TexturePart>(join(MANIFEST_DIR, 'textures.json'), {});
  const icons = readJson<IconPart>(join(MANIFEST_DIR, 'icons.json'), {});
  const pendingCleanup: string[] = [];
  for (const id of ids) {
    for (const f of index[id]?.files ?? []) pendingCleanup.push(f);
    delete index[id];
    delete textures[id];
    delete icons[id];
    for (const band of ['m', 'g', 'p']) delete icons[`${id}__${band}`];
  }
  writeFileAtomic(join(MANIFEST_DIR, 'textures.json'), JSON.stringify(sortKeys(textures), null, 1));
  writeFileAtomic(join(MANIFEST_DIR, 'icons.json'), JSON.stringify(sortKeys(icons), null, 1));
  writeFileAtomic(SHIPPED, JSON.stringify(index, null, 1));

  let manifestLine: string | undefined;
  if (opts.mergeAggregate) {
    manifestLine = mergeManifestUnlocked({ publicDir: PUBLIC }).line;
  }

  const liveUrls = readManifestUrls(PUBLIC);
  for (const old of pendingCleanup) {
    if (!liveUrls.has(old)) rmSync(join(PUBLIC, old), { force: true });
  }
  return { manifestLine };
}
