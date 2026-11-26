// Per-type glyph variants of the metin stone: `bun tools/forge/src/archetypes/metin/variants.ts`
// Re-bakes the stone with a different sigil from Imagegen's `tex_rune_sigils` sheet (4x4 medallions) and keeps ONLY the emissive mask:
// the albedo (carved medallion plate) and the UV layout are identical for every variant, so the renderer can swap
// `material.emissiveMap` per metin type (textures `tex_metin_rune_<type>` in public/assets/textures/metin, registered in manifest/textures.json).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { MANIFEST_LOCK, withLockSync, type LockOptions } from '../../../../pipeline/lock.ts';
import { mergeManifestUnlocked, readManifestUrls, writeFileAtomic } from '../../../../pipeline/manifest.ts';
import { repoRoot } from '../../core/export/manifest.ts';
import { loadTexture } from '../../core/ext/metins/img.ts';
import { buildMetin } from './build.ts';
import { stoneSpec } from './stone.ts';

/** MetinDef id suffix -> cell (row-major) of the 4x4 sigil sheet */
export const TYPE_SIGILS: Record<string, number> = {
  lament: 0, // sorrow
  strife: 1, // battle
  onslaught: 2, // war
  avarice: 3,
  ebon: 4, // eclipse
  murk: 5, // shadow
  envy: 13, // serpent
  echoes: 11, // frost
  dusk: 10, // storm
  grit: 14, // tiger
  fiend: 6,
  demise: 7,
  slaughter: 8, // killer
};

export interface BuiltRuneVariant {
  id: string;
  webp: Uint8Array;
  width: number;
  height: number;
}

export interface PublishRuneVariantsOpts {
  publicDir?: string;
  noManifest?: boolean;
  lock?: LockOptions;
}

export interface PublishRuneVariantsResult {
  entries: Record<string, { id: string; url: string; kind: 'rune'; w: number; h: number; srgb: true; bytes: number }>;
  pruned: string[];
  retained: string[];
  manifestLine?: string;
}

/**
 * Atomically publish rune emissive variants under the shared `MANIFEST_LOCK`:
 * 1. write new content-hashed WebP files first,
 * 2. merge entries into `manifest/textures.json`,
 * 3. rebuild aggregate `manifest.json` inside the same lock (unless `noManifest` is set),
 * 4. prune older hashed files ONLY when they are no longer referenced by the live `manifest.json`.
 */
export function publishRuneVariants(
  variants: BuiltRuneVariant[],
  opts: PublishRuneVariantsOpts = {},
): PublishRuneVariantsResult {
  const publicDir = opts.publicDir ?? join(repoRoot(), 'apps', 'game', 'public');
  const texDir = join(publicDir, 'assets', 'textures', 'metin');
  const partPath = join(publicDir, 'assets', 'manifest', 'textures.json');

  return withLockSync(
    MANIFEST_LOCK,
    () => {
      mkdirSync(texDir, { recursive: true });
      const entries: PublishRuneVariantsResult['entries'] = {};
      const keptFiles = new Map<string, string>();
      for (const v of variants) {
        const hash = createHash('sha256').update(v.webp).digest('hex').slice(0, 6);
        const file = `${v.id}.${hash}.webp`;
        writeFileSync(join(texDir, file), v.webp);
        keptFiles.set(v.id, file);
        entries[v.id] = {
          id: v.id,
          url: `assets/textures/metin/${file}`,
          kind: 'rune',
          w: v.width,
          h: v.height,
          srgb: true,
          bytes: v.webp.length,
        };
      }

      const cur = existsSync(partPath) ? (JSON.parse(readFileSync(partPath, 'utf8')) as Record<string, unknown>) : {};
      Object.assign(cur, entries);
      const sorted = Object.fromEntries(Object.entries(cur).sort(([a], [b]) => (a < b ? -1 : 1)));
      mkdirSync(dirname(partPath), { recursive: true });
      writeFileAtomic(partPath, JSON.stringify(sorted, null, 2) + '\n');

      let manifestLine: string | undefined;
      if (!opts.noManifest) {
        manifestLine = mergeManifestUnlocked({ publicDir }).line;
      }

      const liveUrls = readManifestUrls(publicDir);
      const pruned: string[] = [];
      const retained: string[] = [];
      for (const [id, file] of keptFiles) {
        for (const f of readdirSync(texDir)) {
          if (!f.startsWith(`${id}.`) || f === file) continue;
          const rel = `assets/textures/metin/${f}`;
          const abs = join(texDir, f);
          if (liveUrls.has(rel)) {
            retained.push(abs);
          } else {
            rmSync(abs, { force: true });
            pruned.push(abs);
          }
        }
      }

      return { entries, pruned, retained, manifestLine };
    },
    { label: 'forge:metin-variants', ...opts.lock },
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const noManifest = argv.includes('--no-manifest');
  const only = argv.filter((a) => !a.startsWith('--'));
  const sheet = loadTexture('tex_rune_sigils');
  const built: BuiltRuneVariant[] = [];
  for (const [type, cell] of Object.entries(TYPE_SIGILS)) {
    if (only.length && !only.includes(type)) continue;
    const cx = cell % 4, cy = Math.floor(cell / 4);
    const crop: [number, number, number, number] = [cx / 4, cy / 4, (cx + 1) / 4, (cy + 1) / 4];
    const model = await buildMetin(stoneSpec({ img: sheet, crop }), () => {});
    const emissive = model.emissive;
    if (!emissive) throw new Error('stone build produced no emissive map');
    const id = `tex_metin_rune_${type}`;
    built.push({ id, webp: emissive.webp, width: emissive.width, height: emissive.height });
    console.log(`${id}: sigil cell ${cell}, ${(emissive.webp.length / 1024).toFixed(0)} KB`);
  }
  if (built.length > 0) {
    const res = publishRuneVariants(built, { noManifest });
    if (res.manifestLine) console.log(res.manifestLine);
  }
}

if (import.meta.main) await main();
