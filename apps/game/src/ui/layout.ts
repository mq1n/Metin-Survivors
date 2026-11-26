// Responsive scale: the whole skin is written in `rem`; this module sets the document font size so that
//   · 1920×1080 → 16 px/rem (120 × 67.5 rem)      · 4K → 32 px/rem
//   · 1280×720  → 14 px/rem                       · phone landscape 844×390 → 13 px/rem (65 × 30 rem)
//   · phone portrait 390×844 → 15 px/rem (26 × 56 rem)
// and toggles layout classes on the UI root: `ms-landscape|ms-portrait`, `ms-compact` (= the two phone tiers),
// `ms-touch` (primary pointer is coarse), `ms-hover` (primary pointer can hover), `ms-tier-<tier>` + `data-tier`.
//
// Tiers (C8, 2026-10-13) are coarse COMPOSITION buckets of the CSS-px viewport; the input device is a separate flag
// (a touch laptop is `laptop` + `ms-touch`, a phone is a phone tier + `ms-touch`):
//   phone-p   portrait, width < 600                          390×844, 430×932, 360×800          (ms-compact)
//   phone-l   landscape, height < 560                        844×390, 932×430, 667×375          (ms-compact)
//   tablet    portrait ≥ 600 wide, or landscape aspect < 1.5 768×1024, 1024×768, 1180×820, 1366×1024
//   laptop    landscape, aspect 1.5–2.1, height < 900        1280×720, 1366×768, 1536×864, 1440×900 browser
//   desktop   landscape, aspect 1.5–2.1, height ≥ 900        1920×1080 (and its ~1920×970 browser), 2560×1440, 4K
//   ultra     landscape, aspect ≥ 2.1 (21:9 and wider)       2560×1080, 3440×1440, 5120×1440
// Touch target edge: CSS token `--tap` = max(2.75rem, 44px) (style/base.css, C8 block); TAP_PX / layout.value.tap in script.
// computeRem is deliberately unchanged in C8: a phone-landscape rem bump re-lays out every screen at once (C15 decision).
import { signal } from '@preact/signals';

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function computeRem(w: number, h: number): number {
  if (w < h) return clamp(w / 26, 9, 22);
  if (h >= 1080) return h / 67.5;
  const k = clamp((h - 390) / (1080 - 390), 0, 1);
  return Math.min(13 + 3 * k, w / 55);
}

export type LayoutTier = 'phone-p' | 'phone-l' | 'tablet' | 'laptop' | 'desktop' | 'ultra';
export const LAYOUT_TIERS: readonly LayoutTier[] = ['phone-p', 'phone-l', 'tablet', 'laptop', 'desktop', 'ultra'];

/** Composition tier of a CSS-px viewport (table above). The phone tiers are exactly the `compact` layouts. */
export function computeTier(w: number, h: number): LayoutTier {
  if (w < h) return w < 600 ? 'phone-p' : 'tablet';
  if (h < 560) return 'phone-l';
  const aspect = w / Math.max(1, h);
  if (aspect >= 2.1) return 'ultra';
  if (aspect < 1.5) return 'tablet';
  return h < 900 ? 'laptop' : 'desktop';
}

/** Minimum touch target edge in CSS px (WCAG 2.5.5, platform guidelines). */
export const TAP_PX = 44;
/** Touch target edge at a document font size: max(2.75rem, 44px), the same value as the CSS token `--tap`. */
export const tapPx = (rem: number): number => Math.max(2.75 * rem, TAP_PX);

export interface LayoutInfo {
  w: number;
  h: number;
  portrait: boolean;
  /** a phone tier (phone-p | phone-l) */
  compact: boolean;
  /** the primary pointer is coarse (a finger) */
  touch: boolean;
  /** the primary pointer can hover (mouse, trackpad) */
  hover: boolean;
  rem: number;
  tier: LayoutTier;
  /** window.devicePixelRatio */
  dpr: number;
  /** touch target edge in CSS px (= --tap) */
  tap: number;
}

export const layout = signal<LayoutInfo>({ w: 1920, h: 1080, portrait: false, compact: false, touch: false, hover: true, rem: 16, tier: 'desktop', dpr: 1, tap: TAP_PX });

const media = (q: string): MediaQueryList | null => (typeof matchMedia === 'function' ? matchMedia(q) : null);

/** Starts tracking the viewport; returns a dispose function that restores the document font size. */
export function startLayout(root: HTMLElement): () => void {
  const html = document.documentElement;
  const prevSize = html.style.fontSize;
  const coarse = media('(pointer: coarse)');
  const canHover = media('(hover: hover)');
  let tierClass = '';
  const update = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const portrait = w < h;
    const rem = computeRem(w, h);
    const tier = computeTier(w, h);
    const compact = tier === 'phone-p' || tier === 'phone-l';
    const touch = coarse?.matches ?? false;
    const hover = canHover?.matches ?? !touch;
    html.style.fontSize = `${rem.toFixed(3)}px`;
    root.classList.toggle('ms-portrait', portrait);
    root.classList.toggle('ms-landscape', !portrait);
    root.classList.toggle('ms-compact', compact);
    root.classList.toggle('ms-touch', touch);
    root.classList.toggle('ms-hover', hover);
    if (tierClass !== `ms-tier-${tier}`) {
      if (tierClass) root.classList.remove(tierClass);
      tierClass = `ms-tier-${tier}`;
      root.classList.add(tierClass);
    }
    root.dataset.tier = tier;
    layout.value = { w, h, portrait, compact, touch, hover, rem, tier, dpr: window.devicePixelRatio || 1, tap: tapPx(rem) };
  };
  // iOS Safari applies :active (the shared pressed states) only when a touch listener exists up the tree
  const noop = (): void => undefined;
  root.addEventListener('touchstart', noop, { passive: true });
  update();
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', update);
  coarse?.addEventListener('change', update);
  canHover?.addEventListener('change', update);
  return () => {
    window.removeEventListener('resize', update);
    window.removeEventListener('orientationchange', update);
    coarse?.removeEventListener('change', update);
    canHover?.removeEventListener('change', update);
    root.removeEventListener('touchstart', noop);
    if (tierClass) root.classList.remove(tierClass);
    delete root.dataset.tier;
    html.style.fontSize = prevSize;
  };
}
