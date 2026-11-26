import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { ModelAsset } from '../../../../../apps/game/src/data/assetManifest.ts';
import { MANIFEST_LOCK, withLockSync, type LockOptions } from '../../../../pipeline/lock.ts';
import { mergeManifestUnlocked, readManifestUrls, writeFileAtomic } from '../../../../pipeline/manifest.ts';
import type { ClipData } from '../anim/clip.ts';
import type { ModelData } from '../model.ts';
import { type Rgb, toHex } from '../paint/painter.ts';

export function repoRoot(): string {
  let dir = import.meta.dir;
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, 'docs', 'ARCHITECTURE.md'))) return dir;
    dir = dirname(dir);
  }
  throw new Error('repo root not found');
}

export const modelsDir = (): string => join(repoRoot(), 'apps', 'game', 'public', 'assets', 'models');
export const manifestPartPath = (): string => join(repoRoot(), 'apps', 'game', 'public', 'assets', 'manifest', 'models.json');

export function stats(m: ModelData, bytes: number): { tris: number; bones: number; bytes: number } {
  return { tris: m.indices.length / 3, bones: m.skin?.skeleton.count ?? 0, bytes };
}

/** k-means (k clusters) over vertex colours, returns sRGB hex sorted by population. */
export function dominantColors(colors: Float32Array, k = 4): string[] {
  const n = colors.length / 3;
  if (n === 0) return [];
  const step = Math.max(1, Math.floor(n / 800));
  const pts: Rgb[] = [];
  for (let i = 0; i < n; i += step) pts.push([colors[i * 3]!, colors[i * 3 + 1]!, colors[i * 3 + 2]!]);
  // farthest-point init
  const cent: Rgb[] = [pts[0]!];
  while (cent.length < Math.min(k, pts.length)) {
    let best = pts[0]!, bd = -1;
    for (const p of pts) {
      let d = Infinity;
      for (const c of cent) d = Math.min(d, (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2);
      if (d > bd) { bd = d; best = p; }
    }
    cent.push([...best] as Rgb);
  }
  const count = new Array<number>(cent.length).fill(0);
  for (let it = 0; it < 8; it++) {
    const sum = cent.map(() => [0, 0, 0]);
    count.fill(0);
    for (const p of pts) {
      let bi = 0, bd = Infinity;
      cent.forEach((c, i) => {
        const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
        if (d < bd) { bd = d; bi = i; }
      });
      sum[bi]![0]! += p[0]; sum[bi]![1]! += p[1]; sum[bi]![2]! += p[2];
      count[bi]!++;
    }
    cent.forEach((c, i) => {
      if (count[i]) { c[0] = sum[i]![0]! / count[i]!; c[1] = sum[i]![1]! / count[i]!; c[2] = sum[i]![2]! / count[i]!; }
    });
  }
  return cent.map((c, i) => ({ c, n: count[i]! })).sort((a, b) => b.n - a.n).filter((x) => x.n > 0).map((x) => toHex(x.c));
}

export interface WrittenModel {
  asset: ModelAsset;
  file: string;
}

export interface WriteModelOpts {
  /** Override public dir (defaults to `<repoRoot>/apps/game/public`). */
  publicDir?: string;
  /** Lock options (e.g. isolated `lockDir` for tests). */
  lock?: LockOptions;
  /** Also merge the aggregate `manifest.json` inside the same lock before pruning stale builds. */
  mergeAggregate?: boolean;
}

/**
 * Write `<kind>/<id>.<hash>.glb`, merge the entry into `public/assets/manifest/models.json`
 * under the shared `MANIFEST_LOCK`, and prune stale builds of the same id ONLY when they are
 * no longer referenced by the live aggregate `public/assets/manifest.json`.
 */
export function writeModelAsset(m: ModelData, glb: Uint8Array, opts: WriteModelOpts = {}): WrittenModel {
  const publicDir = opts.publicDir ?? join(repoRoot(), 'apps', 'game', 'public');
  const dir = join(publicDir, 'assets', 'models', m.kind);
  const part = join(publicDir, 'assets', 'manifest', 'models.json');
  const hash = createHash('sha256').update(glb).digest('hex').slice(0, 8);
  const fileName = `${m.id}.${hash}.glb`;
  const file = join(dir, fileName);

  const clips: ModelAsset['clips'] = {};
  for (const c of m.clips) clips[c.name] = { duration: Math.round(c.duration * 1000) / 1000, loop: c.loop };
  const hit: Record<string, number> = {};
  for (const c of m.clips) if (c.hit !== undefined) hit[c.name] = Math.round(c.hit * 1000) / 1000;
  const st = stats(m, glb.length);
  const asset: ModelAsset = {
    id: m.id,
    url: `assets/models/${m.kind}/${fileName}`,
    kind: m.kind,
    height: Math.round(m.height * 1000) / 1000,
    radius: Math.round(m.radius * 1000) / 1000,
    clips,
    ...(Object.keys(hit).length ? { hit } : {}),
    ...(m.sockets ? { sockets: m.sockets } : {}),
    tris: st.tris,
    bones: st.bones,
    bytes: st.bytes,
    ...(m.palette ? { palette: m.palette } : {}),
  };

  return withLockSync(
    MANIFEST_LOCK,
    () => {
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, glb);

      mkdirSync(dirname(part), { recursive: true });
      let cur: Record<string, ModelAsset> = {};
      if (existsSync(part)) cur = JSON.parse(readFileSync(part, 'utf8')) as Record<string, ModelAsset>;
      cur[m.id] = asset;
      const sorted = Object.fromEntries(Object.entries(cur).sort(([a], [b]) => (a < b ? -1 : 1)));
      writeFileAtomic(part, JSON.stringify(sorted, null, 2) + '\n');

      if (opts.mergeAggregate) {
        mergeManifestUnlocked({ publicDir });
      }

      const liveUrls = readManifestUrls(publicDir);
      for (const f of readdirSync(dir)) {
        if (
          f !== fileName &&
          f.startsWith(`${m.id}.`) &&
          f.endsWith('.glb') &&
          /^[0-9a-f]{6,}$/.test(f.slice(m.id.length + 1, -4)) &&
          !liveUrls.has(`assets/models/${m.kind}/${f}`)
        ) {
          rmSync(join(dir, f), { force: true });
        }
      }
      return { asset, file: resolve(file) };
    },
    { label: `forge:writeModelAsset:${m.id}`, ...opts.lock },
  );
}

export type { ClipData };
