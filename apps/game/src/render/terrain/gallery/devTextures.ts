// DEV only: until Imagegen ships textures into public/assets, point missing manifest entries at the raw build outputs

import type { TextureAsset, TextureKind } from '../../../data/assetManifest';
import type { Assets } from '../../../engine/assets';

interface BuildReport {
  id: string;
  w: number;
  h: number;
  alpha?: boolean;
  main: string;
  bytes: number;
  normal?: string;
}

const reports = import.meta.glob<BuildReport>('../../../../../../.research/imagegen/build/*/*.json', {
  eager: true,
  import: 'default',
});

function fsUrl(abs: string): string {
  return `/@fs/${abs.replaceAll('\\', '/')}`;
}

function kindOf(id: string): TextureKind {
  if (id.startsWith('tex_fol_')) return 'foliage';
  if (id.startsWith('tex_bark_')) return 'bark';
  if (id.startsWith('tex_rock_') || id === 'tex_basalt') return 'rock';
  if (id.startsWith('tex_rune_') || id.startsWith('tex_metin_')) return 'rune';
  return 'terrain';
}

/** Adds manifest entries for every built texture the real manifest does not have. Returns the number added. */
export function applyDevTextureFallback(assets: Assets): number {
  let added = 0;
  for (const rep of Object.values(reports)) {
    if (!rep || typeof rep !== 'object' || !rep.id || !rep.main || !rep.id.startsWith('tex_')) continue;
    if (assets.manifest.textures[rep.id]) continue;
    const kind = kindOf(rep.id);
    const asset: TextureAsset = {
      id: rep.id,
      url: fsUrl(rep.main),
      kind,
      w: rep.w,
      h: rep.h,
      srgb: true,
      tiling: kind === 'terrain' || kind === 'rock' || kind === 'bark',
      alpha: rep.alpha ?? kind === 'foliage',
      bytes: rep.bytes,
    };
    if (rep.normal) asset.normalUrl = fsUrl(rep.normal);
    assets.manifest.textures[rep.id] = asset;
    added++;
  }
  return added;
}
