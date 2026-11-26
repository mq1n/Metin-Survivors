// Texture access for the vegetation: manifest textures with graceful procedural stand-ins when Imagegen has not
// shipped an id yet (foliage cards, bark, rock), so the system never fails to build.
import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import type { Assets } from '../../engine/assets';
import { tryNormal, tryTexture } from '../terrain/zoneContext';

function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, repeat: boolean, anisotropy: number): Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  draw(g, size);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = anisotropy;
  return t;
}

/** leaf-cluster card stand-in: a ragged green blob with transparent surroundings */
function fallbackLeaves(color: string, anisotropy: number): Texture {
  return canvasTexture(
    128,
    (g, s) => {
      let seed = 7;
      const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      g.fillStyle = color;
      for (let i = 0; i < 90; i++) {
        const a = rnd() * 6.283;
        const r = Math.sqrt(rnd()) * s * 0.4;
        g.globalAlpha = 0.85;
        g.beginPath();
        g.ellipse(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r, s * 0.09, s * 0.05, rnd() * 3, 0, 6.283);
        g.fill();
      }
    },
    false,
    anisotropy,
  );
}

function fallbackFlat(color: string, anisotropy: number): Texture {
  return canvasTexture(
    8,
    (g, s) => {
      g.fillStyle = color;
      g.fillRect(0, 0, s, s);
    },
    true,
    anisotropy,
  );
}

const FALLBACK_COLOR: Record<string, string> = {
  tex_fol_pine_branch: '#2f5a3c',
  tex_fol_pine_snow: '#dfe8f0',
  tex_fol_broadleaf: '#5a8a35',
  tex_fol_autumn: '#c8561c',
  tex_fol_dead_branch: '#4a3a30',
  tex_fol_grass_1: '#5f8f35',
  tex_fol_grass_2: '#8a8a45',
  tex_fol_grass_3: '#a89a4a',
  tex_fol_flowers_1: '#d8c45a',
  tex_fol_flowers_2: '#c8452a',
  tex_fol_bush: '#3f7430',
  tex_bark_pine: '#6a3a22',
  tex_bark_oak: '#58503a',
  tex_bark_birch: '#cfc8b8',
  tex_bark_charred: '#2a2220',
};

/**
 * Stand-in colour for an id that is neither shipped nor in FALLBACK_COLOR, by keyword (C4): zone-prefixed cards such as
 * `tex_fol_yeonmu_dry_grass` can be referenced by a recipe / look before Imagegen ships them without turning grey.
 */
const FALLBACK_KEYWORDS: Array<[RegExp, string]> = [
  [/autumn|maple|rust/, '#b5602a'],
  [/snow|frost|ice/, '#dfe8f0'],
  [/dead|branch|twig|charred/, '#4a3a30'],
  [/pine|spruce|fir|cypress/, '#2f5a3c'],
  [/flower|bloom|petal/, '#d8c45a'],
  [/dry|straw|hay|reed/, '#a89a4a'],
  [/bush|shrub|fern|broad|leaf/, '#4f7a32'],
  [/grass|tuft|clover|moss/, '#5f8f35'],
  [/bark/, '#5a4a38'],
];

/** fallback colour of a vegetation texture id (exact table first, then keywords, then neutral grey) */
export function fallbackColor(id: string): string {
  const exact = FALLBACK_COLOR[id];
  if (exact) return exact;
  for (const [re, c] of FALLBACK_KEYWORDS) if (re.test(id)) return c;
  return '#7a7a70';
}

export interface OwnedVegTexture {
  readonly texture: Texture;
  /** true when `texture` is a locally created procedural fallback CanvasTexture (not cached in Assets) */
  readonly owned: boolean;
  /** disposes the texture only when `owned` is true (shared manifest textures are never disposed here) */
  dispose(): void;
}

/** manifest texture or a locally owned procedural stand-in of a plausible colour (never null) */
export async function loadOwnedVegTexture(assets: Assets, id: string): Promise<OwnedVegTexture> {
  const t = await tryTexture(assets, id);
  if (t) {
    return { texture: t, owned: false, dispose: () => undefined };
  }
  const color = fallbackColor(id);
  const fb = id.startsWith('tex_fol_') ? fallbackLeaves(color, assets.anisotropy) : fallbackFlat(color, assets.anisotropy);
  let disposed = false;
  return {
    texture: fb,
    owned: true,
    dispose() {
      if (disposed) return;
      disposed = true;
      fb.dispose();
    },
  };
}

/** manifest texture or a flat/blob stand-in of a plausible colour (never null) */
export async function loadVegTexture(assets: Assets, id: string): Promise<Texture> {
  const res = await loadOwnedVegTexture(assets, id);
  return res.texture;
}

/** normal map or null (no stand-in: lighting just goes flat) */
export function loadVegNormal(assets: Assets, id: string): Promise<Texture | null> {
  return tryNormal(assets, id);
}
