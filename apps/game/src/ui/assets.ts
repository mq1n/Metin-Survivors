// Resolves painted UI art (panel textures, logo, key art, zone cards, portraits, icons) through the asset manifest
// and exposes the textures to the CSS skin as custom properties. Every lookup is optional: when an id is not in the
// manifest (not generated yet / DEV) the stylesheet falls back to CSS gradients and the Icon component to its
// procedural SVG tile — the UI never shows a broken image.
import type { IconAsset } from '../data/assetManifest';
import type { ClassId, Sex, ZoneDef } from '../data/schema';
import { deps } from './env';

/** CSS variable → manifest texture id. */
const TEXTURE_VARS: Record<string, string> = {
  '--tex-wood': 'ui_panel_wood',
  '--tex-stone': 'ui_panel_stone',
  '--tex-lacquer': 'ui_lacquer_red',
  '--tex-parchment': 'ui_parchment',
  '--tex-border': 'ui_border_gold',
  '--tex-btn': 'ui_btn_red',
  '--tex-logo': 'ui_logo',
  '--tex-keyart': 'ui_keyart_menu',
  '--tex-keyart-portrait': 'ui_keyart_menu_portrait',
  '--tex-chest-closed': 'art_chest_closed',
  '--tex-chest-open': 'art_chest_open',
  '--tex-chest-boss': 'art_chest_boss',
  '--tex-chest-boss-open': 'art_chest_boss_open',
  '--tex-metin': 'art_metin_essence',
  '--tex-divider': 'ui_divider_gold',
  
  // style/kit.css falls back to CSS when one is missing)
  '--tex-uk-board': 'uk_board',
  '--tex-uk-rust': 'uk_rust',
  '--tex-uk-stone': 'uk_stone',
  '--tex-uk-lattice': 'uk_lattice',
  '--tex-uk-corner': 'uk_corner',
  '--tex-uk-cap': 'uk_gauge_cap',
  '--tex-uk-orb': 'uk_orb_ring',
};

export function texUrl(id: string): string | null {
  const { assets } = deps();
  const a = assets.manifest.textures[id];
  return a ? assets.url(a.url) : null;
}

export function iconUrl(id: string): string | null {
  const { assets } = deps();
  const a = assets.manifest.icons[id];
  return a ? assets.url(a.url) : null;
}

/** Manifest entry of an icon (null when not shipped). `style` tells the icon pipeline v2 form (docs/ART.md s5). */
export function iconMeta(id: string): IconAsset | null {
  return deps().assets.manifest.icons[id] ?? null;
}

/** How an icon is drawn: v2 `tile` (octagon tile that carries its own frame), v2 `cutout` (transparent object, the UI
 *  draws the plate) or `legacy` (opaque square painting, masked to the plate shape by the slot). null = not shipped. */
export type IconForm = 'tile' | 'cutout' | 'legacy';

export function iconForm(id: string): IconForm | null {
  const m = iconMeta(id);
  if (!m) return null;
  return m.style?.form ?? (isBossCard(id) ? 'tile' : 'legacy');
}

/** The 20 boss monster cards (`icon_enemy_boss_*`) carry their own embossed octagon rim (the slot's inner octagon), so
 *  their slot is drawn in the `tile` form: ONE rim, not the card's rim inside the slot's rarity ring. A manifest
 *  `style.form` wins when the pipeline sets one; a later re-bake from the 3D models keeps the id scheme. */
function isBossCard(id: string): boolean {
  return id.startsWith('icon_enemy_boss_');
}

/** Skill rank index 0..7 (1, 2, 3, M1, M2, G1, G2, P) → icon rank band (ART.md s5: n = base id). */
export const RANK_TO_BAND = ['n', 'n', 'n', 'm', 'm', 'g', 'g', 'p'] as const;
export type RankBand = (typeof RANK_TO_BAND)[number];

export function rankBand(rank: number): RankBand {
  return RANK_TO_BAND[Math.max(0, Math.min(7, Math.round(Number.isFinite(rank) ? rank : 0)))] ?? 'n';
}

/** The icon id to draw for a rank: the re-tinted v2 rank-band tile when the manifest lists one, else the base id. */
export function iconIdForRank(id: string, rank?: number): string {
  if (rank === undefined) return id;
  const band = rankBand(rank);
  if (band === 'n') return id;
  const v = iconMeta(id)?.style?.variants?.[band];
  return v && iconMeta(v) ? v : id;
}

export function iconUrlForRank(id: string, rank?: number): string | null {
  return iconUrl(iconIdForRank(id, rank));
}

export function portraitUrl(classId: ClassId, sex: Sex): string | null {
  return texUrl(`portrait_${classId}_${sex}`) ?? texUrl(`portrait_${classId}_m`);
}

/** 256 px face crop of a class portrait (HUD / class rows / co-op avatars); falls back to the full portrait. */
export function portraitFaceUrl(classId: ClassId, sex: Sex): string | null {
  return portraitFaceCropUrl(classId, sex) ?? texUrl(`portrait_${classId}_${sex}_face`) ?? portraitUrl(classId, sex);
}

/** The 256 px face crop ONLY (null when none ships): the other sex's crop stands in for a single-sex class (Wolfman has one portrait). */
export function portraitFaceCropUrl(classId: ClassId, sex: Sex): string | null {
  return texUrl(`portrait_face_${classId}_${sex}`) ?? texUrl(`portrait_face_${classId}_m`);
}

/** Painted Metin stone of a metin type: its own `art_metin_<id minus metin_>` (the four great ones ship one) else the shared essence stone. */
export function metinArtUrl(metinId: string | null | undefined): string | null {
  const own = metinId ? texUrl(`art_metin_${metinId.replace(/^metin_/, '')}`) : null;
  return own ?? texUrl('art_metin_essence');
}

export function zoneArtUrl(zone: Pick<ZoneDef, 'art' | 'id'>): string | null {
  return texUrl(zone.art) ?? texUrl(`art_zone_${zone.id}`);
}

/** Publishes the available textures as CSS custom properties on `el` (call after the manifest is loaded). */
export function applyTextureVars(el: HTMLElement): void {
  for (const [cssVar, id] of Object.entries(TEXTURE_VARS)) {
    const url = texUrl(id);
    if (url) el.style.setProperty(cssVar, `url("${url}")`);
    else el.style.removeProperty(cssVar);
  }
  el.classList.toggle('ms-has-art', texUrl('ui_panel_wood') !== null);
}
