// ZoneMap (UI core C14): the top-down map of a zone, painted at runtime from the LIVE terrain field (relief shading, paint
// map colours, roads, liquids, trees, rocks, roofs; see zoneMapRender.ts), so it follows every zones-domain rebuild with no
// re-bake of a texture. Two skins of one component:
//
//   <ZoneMap zone="yeonmu" variant="minimap" hero={{ x: hud.px, z: hud.pz }} pips={hudPips(hud)} onAtlas={…} onClose={…} />
//       the round HUD minimap: a braided pewter ring with four bronze cuffs, copper medallion buttons (region map, hide,
//       zoom -/+), a coordinate plate; the map scrolls under a fixed hero arrow; out-of-view metins / bosses ride the ring
//   <ZoneMap zone="suryeon" variant="atlas" caption="…" />
//       the bordered atlas of zone select: pewter frame with cloud-scroll corner caps, ruler ticks, compass rose, scale
//       bar, banner / skull / chest pins with hover tips, the final-battle ring and the starting banner
//
// The map itself is cached per (zone, seed, style, res) and baked in a worker; until it is ready the disc / plate shows a
// dim placeholder and the frame, buttons and pips already work. Markup is plain DOM (no canvas redraw per frame): the map
// layer is one element moved with a CSS transform, pips are absolutely positioned in map percent. A HUD update (10 Hz)
// only rewrites a transform and a few left / top values: no transitions (a 10 Hz hero step is <= 1.5 px at minimap scale).
//
// World frame: screen up = world -z ("north"), screen right = world +x (the game camera). Headings are radians clockwise
// from north.
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { t, tl } from '../../i18n/i18n';
import type { BiomePreset, L10n, ZoneDef } from '../../data/schema';
import type { HudSnapshot } from '../../sim/types';
import { texUrl } from '../assets';
import { sfx } from '../audio';
import { indexOf } from '../content';
import { PIP_DEFS, MEDAL_GLYPH, ringMarkup, roseMarkup } from './zoneMapArt';
import { kitDefs } from './StatIcon';
import { TitleBar } from './TitleBar';
import { tipProps } from './Tooltip';
import { loadZoneMap, peekZoneMap, type ZoneMapAsset, type ZoneMapRequest } from './zoneMapLoader';

export { preloadZoneMap, clearZoneMapCache, zoneMapStats } from './zoneMapLoader';
export type { ZoneMapAsset } from './zoneMapLoader';

export type ZoneMapVariant = 'minimap' | 'atlas';
export type MapPipKind = 'hero' | 'ally' | 'metin' | 'boss' | 'chest' | 'start' | 'heart' | 'arena' | 'poi';

/** One marker on the map, in world metres. */
export interface MapPip {
  kind: MapPipKind;
  x: number;
  z: number;
  /** stable key (metin id, boss id …): keeps the DOM node, so the glide transition runs */
  id?: string | number;
  /** metin: the awakened ring pulses */
  awakened?: boolean;
  /** metin: aura colour (#rrggbb, the HUD snapshot's `rune`): tints the glow and the awakened ring */
  tint?: string;
  /** tooltip / aria text (atlas pins; minimap pips are not interactive) */
  label?: string;
  dim?: boolean;
  /** minimap: ride the ring when out of view (default: metin and boss) */
  edge?: boolean;
}

export interface MapHero {
  x: number;
  z: number;
  /** radians clockwise from north; default: derived from the movement between updates */
  yaw?: number;
}

export interface ZoneMapProps {
  /** zone id (resolved through the content db) or a def / `{ id, biome }` */
  zone: string | { id: string; biome: BiomePreset; name?: L10n };
  variant?: ZoneMapVariant;
  /** CSS length of the square box (minimap default 11rem, atlas 100% of its container) */
  size?: string;
  /** scatter seed (the run seed matches the live trees / rocks); default the zone's own seed */
  seed?: number;
  /** raster side in px (default 1024; atlas thumbnails may use 512) */
  res?: number;
  hero?: MapHero | null;
  pips?: readonly MapPip[];
  /** atlas: pins for the field's landmarks (start, final-battle ring, boss arenas); default true for the atlas */
  landmarks?: boolean;
  /** atlas: print a label under start / final-battle pins (default true) */
  labels?: boolean;
  /** minimap: visible diameter in metres; 0 = the whole arena. Controlled when given, else the zoom buttons drive it */
  view?: number;
  /** minimap zoom steps for the - / + medallions, in metres (0 = whole arena); default [64, 110, 190, 0] */
  views?: readonly number[];
  /** minimap: draw the medallion buttons (default true) */
  controls?: boolean;
  /** minimap: coordinate plate under the ring (default true) */
  coords?: boolean;
  /** minimap: thin outline of the screen's world footprint around the hero, in metres */
  camera?: { w: number; h: number };
  /** atlas: ruler ticks and scale bar (default true) */
  grid?: boolean;
  /** atlas: pewter frame with corner caps (default true); false = the bare plate, for use inside a board or on a card */
  frame?: boolean;
  /** atlas: rust-copper title bar on top of the frame (kit TitleBar); `onClose` adds its boxed close button */
  title?: ComponentChildren;
  /** atlas: plaque under the plate */
  caption?: ComponentChildren;
  /** minimap: the "region map" medallion (shown only when given) */
  onAtlas?: () => void;
  /** minimap: the "hide" medallion; atlas: the title bar's close box (shown only when given) */
  onClose?: () => void;
  onViewChange?: (view: number) => void;
  /** atlas: id of the highlighted pin */
  selected?: string | number;
  /** atlas: a pin was clicked / activated */
  onPip?: (pip: MapPip) => void;
  /** called when the raster is ready (timing + hash, for QA) */
  onReady?: (info: ZoneMapInfo) => void;
  class?: string;
  label?: string;
}

export interface ZoneMapInfo {
  zone: string;
  hash: string;
  via: 'worker' | 'main';
  res: number;
  timing: ZoneMapAsset['timing'];
}

/** The raster request a `<ZoneMap variant seed res>` makes: pass it to `preloadZoneMap(zone.biome, …)` from a loading screen to hit the same cache entry. */
export function defaultMapRequest(variant: ZoneMapVariant, opts: { seed?: number; res?: number } = {}): ZoneMapRequest {
  return { style: variant, res: opts.res ?? (variant === 'minimap' ? 1536 : 1024), ...(opts.seed !== undefined ? { seed: opts.seed } : {}) };
}

const VIEWS_DEFAULT: readonly number[] = [64, 110, 190, 0];
const VIEW_KEY = 'ms.ui.minimapView';
const RIM_KINDS: ReadonlySet<MapPipKind> = new Set(['metin', 'boss']);
const PIP_LABEL: Record<MapPipKind, string> = {
  hero: 'zonemap.you',
  ally: 'zonemap.ally',
  metin: 'zonemap.metin',
  boss: 'zonemap.boss',
  chest: 'zonemap.chest',
  start: 'zonemap.start',
  heart: 'zonemap.heart',
  arena: 'zonemap.bossArena',
  poi: 'zonemap.poi',
};
const RIM_TINT: Partial<Record<MapPipKind, string>> = { boss: '#b3281c', metin: '#6a3f8a' };

let defsDone = false;
/** Registers the pip gradients and `#zm-p-<kind>` symbols once (ZoneMap does it itself; call it before drawing a pip outside a map, e.g. a legend). */
export function ensureZoneMapDefs(): void {
  if (defsDone) return;
  defsDone = true;
  kitDefs('zm', PIP_DEFS);
}

// ------------------------------------------------------------------------------------------------------------ helpers

/** A HUD snapshot's live markers (metins, boss) as map pips; pair it with `hero={{ x: hud.px, z: hud.pz }}`. */
export function hudPips(hud: Pick<HudSnapshot, 'metins' | 'boss'>): MapPip[] {
  const out: MapPip[] = [];
  for (const m of hud.metins) out.push({ kind: 'metin', id: `m${m.id}`, x: m.x, z: m.z, awakened: m.awakened, tint: m.rune });
  if (hud.boss && hud.boss.hp > 0) out.push({ kind: 'boss', id: `b${hud.boss.id}`, x: hud.boss.x, z: hud.boss.z });
  return out;
}

/** Heading (radians clockwise from north) of a world-space movement; screen up is -z. */
export function headingOf(dx: number, dz: number): number {
  return Math.atan2(dx, -dz);
}

const MINUS = '−';
function fmtCoord(n: number): string {
  const r = Math.round(n);
  return r < 0 ? `${MINUS}${-r}` : `${r}`;
}

function pct(n: number): string {
  return `${(Math.round(n * 1000) / 1000).toString()}%`;
}

function resolveZone(zone: ZoneMapProps['zone']): { id: string; biome: BiomePreset; name?: L10n } | null {
  if (typeof zone !== 'string') return zone;
  try {
    const z = indexOf().zones.get(zone) as ZoneDef | undefined;
    return z ? { id: z.id, biome: z.biome, name: z.name } : null;
  } catch {
    return null;
  }
}

function readView(): number | null {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

function writeView(v: number): void {
  try {
    localStorage.setItem(VIEW_KEY, String(v));
  } catch {
    /* private mode */
  }
}

/** Continuous heading in degrees (unwrapped, so the CSS rotation never spins the long way round). */
function useHeading(hero: MapHero | null | undefined): number {
  const s = useRef({ x: Number.NaN, z: Number.NaN, deg: 0 });
  if (!hero) return s.current.deg;
  const st = s.current;
  if (hero.yaw !== undefined) {
    const target = (hero.yaw * 180) / Math.PI;
    let d = (target - st.deg) % 360;
    if (d > 180) d -= 360;
    else if (d < -180) d += 360;
    st.deg += d;
  } else if (Number.isFinite(st.x)) {
    const dx = hero.x - st.x;
    const dz = hero.z - st.z;
    if (dx * dx + dz * dz > 0.04) {
      const target = (headingOf(dx, dz) * 180) / Math.PI;
      let d = (target - st.deg) % 360;
      if (d > 180) d -= 360;
      else if (d < -180) d += 360;
      st.deg += d * 0.65;
    }
  }
  st.x = hero.x;
  st.z = hero.z;
  return st.deg;
}

// ------------------------------------------------------------------------------------------------------------- pieces

function Pip({ p, interactive, tooltip, selected, onPip, style }: { p: MapPip; interactive: boolean; tooltip?: string | undefined; selected?: boolean; onPip?: ((pip: MapPip) => void) | undefined; style: JSX.CSSProperties }): JSX.Element {
  const label = tooltip ?? p.label;
  const tip = label ? tipProps(() => <div class="ms-tip-title">{label}</div>) : {};
  const cls = `ms-zm-pip ms-zm-pip--${p.kind}${p.awakened ? ' is-awake' : ''}${p.dim ? ' is-dim' : ''}${selected ? ' is-selected' : ''}${interactive ? ' is-live' : ''}`;
  const tinted: JSX.CSSProperties = p.tint && /^#[0-9a-f]{3,8}$/i.test(p.tint) ? { ...style, '--zm-tint': p.tint } : style;
  const body = (
    <>
      <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
        <use href={`#zm-p-${p.kind}`} />
      </svg>
      {interactive && p.label && (p.kind === 'heart' || p.kind === 'start') && <span aria-hidden="true">{p.label}</span>}
    </>
  );
  if (interactive && onPip) {
    return (
      <button type="button" class={cls} style={tinted} aria-label={label} data-nav="" onClick={() => onPip(p)} {...tip}>
        {body}
      </button>
    );
  }
  return (
    <span class={cls} style={tinted} role={label ? 'img' : undefined} aria-label={label} {...tip}>
      {body}
    </span>
  );
}

function Medal({ kind, label, onClick, disabled, pos }: { kind: keyof typeof MEDAL_GLYPH; label: string; onClick: () => void; disabled?: boolean; pos: string }): JSX.Element {
  const tip = tipProps(() => <div class="ms-tip-title">{label}</div>);
  return (
    <button
      type="button"
      class={`ms-zm-btn ms-zm-btn--${kind}`}
      style={{ left: pos.split(',')[0] ?? '50%', top: pos.split(',')[1] ?? '50%' }}
      aria-label={label}
      disabled={disabled}
      data-nav=""
      {...tip}
      onPointerEnter={(e) => {
        tip.onPointerEnter(e);
        if (e.pointerType === 'mouse' && !disabled) sfx('hover');
      }}
      onClick={(e) => {
        e.stopPropagation();
        sfx(kind === 'close' ? 'back' : 'click');
        onClick();
      }}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" dangerouslySetInnerHTML={{ __html: MEDAL_GLYPH[kind] }} />
      <span class="ms-hit" aria-hidden="true" />
    </button>
  );
}

/** box position (percent of the ring box) of a medallion centred at `deg` degrees (0 = east, clockwise) on the ring */
const medalPos = (deg: number, radiusPct = 46): string => {
  const a = (deg * Math.PI) / 180;
  return `${pct(50 + radiusPct * Math.cos(a))},${pct(50 + radiusPct * Math.sin(a))}`;
};

// ---------------------------------------------------------------------------------------------------------- component

export function ZoneMap(props: ZoneMapProps): JSX.Element {
  ensureZoneMapDefs();
  const { variant = 'minimap', hero = null, pips = [], controls = true, onAtlas, onClose, onViewChange, onPip, onReady, class: cls = '', camera } = props;
  const zone = resolveZone(props.zone);
  const isMini = variant === 'minimap';
  const req: ZoneMapRequest = useMemo(() => defaultMapRequest(variant, { seed: props.seed, res: props.res }), [variant, props.res, props.seed]);
  const zoneKey = zone ? `${zone.id}|${zone.biome.seed}` : '';

  // ---- raster ------------------------------------------------------------------------------------------------------
  const [asset, setAsset] = useState<ZoneMapAsset | null>(() => (zone ? peekZoneMap(zone.biome, req) : null));
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!zone) {
      setAsset(null);
      setFailed(true);
      return undefined;
    }
    const cached = peekZoneMap(zone.biome, req);
    if (cached) {
      setAsset(cached);
      setFailed(false);
      onReady?.({ zone: cached.zone, hash: cached.hash, via: cached.via, res: cached.res, timing: cached.timing });
      return undefined;
    }
    let alive = true;
    setAsset(null);
    setFailed(false);
    loadZoneMap(zone.biome, req).then(
      (a) => {
        if (!alive) return;
        setAsset(a);
        onReady?.({ zone: a.zone, hash: a.hash, via: a.via, res: a.res, timing: a.timing });
      },
      (err) => {
        if (!alive) return;
        console.warn('[zonemap]', err);
        setFailed(true);
      },
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneKey, req]);

  // ---- view --------------------------------------------------------------------------------------------------------
  const views = props.views ?? VIEWS_DEFAULT;
  const [localView, setLocalView] = useState<number>(() => {
    const saved = readView();
    return saved !== null && views.includes(saved) ? saved : (views[1] ?? 110);
  });
  const viewM = isMini ? (props.view ?? localView) : 0;
  // the ref keeps rapid clicks (several before the next render) stepping from the latest value, not a stale closure
  const viewRef = useRef(viewM);
  viewRef.current = viewM;
  const step = (dir: -1 | 1): void => {
    // zoom in = smaller view; 0 (whole arena) is the widest
    const order = [...views].sort((a, b) => (a || 1e9) - (b || 1e9));
    const i = Math.max(0, order.indexOf(viewRef.current));
    const next = order[Math.min(order.length - 1, Math.max(0, i + dir))];
    if (next === undefined || next === viewRef.current) return;
    viewRef.current = next;
    if (props.view === undefined) {
      setLocalView(next);
      writeView(next);
    }
    onViewChange?.(next);
  };
  const orderedViews = [...views].sort((a, b) => (a || 1e9) - (b || 1e9));
  const viewIdx = Math.max(0, orderedViews.indexOf(viewM));

  // ---- geometry ----------------------------------------------------------------------------------------------------
  const span = asset?.span ?? 436;
  const x0 = asset?.x0 ?? -218;
  const z0 = asset?.z0 ?? -218;
  const arenaR = asset?.arenaRadius ?? 188;
  const fit = viewM <= 0;
  const diameterM = isMini ? (fit ? (arenaR + 8) * 2 : viewM) : span;
  const follow = isMini && !fit && !!hero;
  const cx = follow && hero ? hero.x : x0 + span / 2;
  const cz = follow && hero ? hero.z : z0 + span / 2;
  const k = span / diameterM;
  const u = (cx - x0) / span;
  const v = (cz - z0) / span;
  const worldStyle: JSX.CSSProperties = {
    width: pct(k * 100),
    height: pct(k * 100),
    transform: `translate(${pct((0.5 / k - u) * 100)}, ${pct((0.5 / k - v) * 100)})`,
  };
  // a zoom change must not glide (the layer would swim while its size jumps)
  const lastView = useRef(viewM);
  const snap = lastView.current !== viewM;
  lastView.current = viewM;
  if (snap) worldStyle.transition = 'none';

  const heading = useHeading(isMini ? hero : null);

  // ---- canvas ------------------------------------------------------------------------------------------------------
  const boxRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState(0);
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    setBox(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setBox(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  // texel budget: the layer is k x the visible diameter (the minimap disc is 78% of the ring box, the atlas plate is the box)
  const src = asset ? asset.pick(box > 0 ? box * (isMini ? 0.78 : 1) * dpr * k : Number.POSITIVE_INFINITY) : null;
  useLayoutEffect(() => {
    const cv = cvRef.current;
    if (!cv || !src) return;
    if (cv.width !== src.width || cv.height !== src.height) {
      cv.width = src.width;
      cv.height = src.height;
    }
    const ctx = cv.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, 0, 0);
    }
  }, [src, asset]);

  // ---- pips --------------------------------------------------------------------------------------------------------
  const interactive = !isMini;
  const radiusM = diameterM / 2;
  const inWorld: JSX.Element[] = [];
  const rim: JSX.Element[] = [];
  const all: MapPip[] = [...pips];
  if (!isMini && props.landmarks !== false && asset) {
    for (const l of asset.landmarks) {
      if (l.kind === 'centre') all.push({ kind: 'heart', id: `lm-${l.id}`, x: l.x, z: l.z, label: t('zonemap.heart') });
      else if (l.kind === 'spawn') all.push({ kind: 'start', id: `lm-${l.id}`, x: l.x, z: l.z, label: t('zonemap.start') });
      else if (l.kind === 'boss') all.push({ kind: 'arena', id: `lm-${l.id}`, x: l.x, z: l.z, label: t('zonemap.bossArena') });
    }
  }
  if (!isMini && hero) all.push({ kind: 'hero', id: 'hero', x: hero.x, z: hero.z, label: t('zonemap.you') });
  all.forEach((p, i) => {
    const key = p.id ?? `${p.kind}-${i}`;
    const baseName = p.label ?? (p.kind === 'metin' && p.awakened ? t('hud.map.awakened') : t(PIP_LABEL[p.kind]));
    if (isMini) {
      const dx = p.x - cx;
      const dz = p.z - cz;
      const dist = Math.hypot(dx, dz);
      const heroDist = hero ? Math.round(Math.hypot(p.x - hero.x, p.z - hero.z)) : Math.round(dist);
      const miniTip = `${baseName} · ${t('hud.dist', { n: String(heroDist) })}`;
      if (follow || fit) {
        if (dist > radiusM * 0.93 && (p.edge ?? RIM_KINDS.has(p.kind))) {
          const ang = Math.atan2(dz, dx);
          const tint = RIM_TINT[p.kind];
          rim.push(
            <span key={key} class={`ms-zm-rim ms-zm-rim--${p.kind}`} style={{ left: pct(50 + 41.5 * Math.cos(ang)), top: pct(50 + 41.5 * Math.sin(ang)), ...(tint ? { '--zm-rim': tint } : {}) }} role="img" aria-label={miniTip} {...tipProps(() => <div class="ms-tip-title">{miniTip}</div>)}>
              <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false" style={{ transform: `rotate(${(ang * 180) / Math.PI}deg)` }}>
                <use href="#zm-p-rim" />
              </svg>
            </span>,
          );
          return;
        }
        if (dist > radiusM * 1.08) return;
      }
      inWorld.push(<Pip key={key} p={p} interactive={false} tooltip={miniTip} selected={false} style={{ left: pct(((p.x - x0) / span) * 100), top: pct(((p.z - z0) / span) * 100) }} />);
      return;
    }
    const shown = interactive && p.label === undefined ? { ...p, label: baseName } : p;
    inWorld.push(<Pip key={key} p={shown} interactive={interactive} selected={p.id !== undefined && p.id === props.selected} onPip={onPip} style={{ left: pct(((p.x - x0) / span) * 100), top: pct(((p.z - z0) / span) * 100) }} />);
  });

  if (isMini && !follow && hero) {
    inWorld.push(
      <span
        key="hero"
        class="ms-zm-hero ms-zm-hero--world"
        style={{
          left: pct(((hero.x - x0) / span) * 100),
          top: pct(((hero.z - z0) / span) * 100),
          '--zm-yaw': `${Math.round(heading * 10) / 10}deg`,
        }}
        role="img"
        aria-label={t('zonemap.you')}
        {...tipProps(() => (
          <div class="ms-tip-title">{t('zonemap.you')}</div>
        ))}
      >
        <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
          <use href="#zm-p-hero" />
        </svg>
      </span>,
    );
  }

  // ---- chrome ------------------------------------------------------------------------------------------------------
  const name = zone?.name ? tl(zone.name) : (zone?.id ?? '');
  const aria = props.label ?? t('zonemap.mapOf', { zone: name });
  const state = failed ? 'is-failed' : asset ? 'is-ready' : 'is-loading';
  const style: JSX.CSSProperties = props.size ? { '--zm-size': props.size } : {};

  if (isMini) {
    return (
      <div class={`ms-zm ms-zm--minimap ${state} ${follow ? 'is-follow' : ''} ${cls}`} style={style} role="group" aria-label={aria} data-zone={zone?.id}>
        <div class="ms-zm-box" ref={boxRef}>
          <div class="ms-zm-disc" role="img" aria-label={aria} aria-busy={!asset && !failed} onClick={onAtlas}>
            <div class="ms-zm-world" style={worldStyle}>
              <canvas ref={cvRef} class="ms-zm-canvas" width="1" height="1" aria-hidden="true" />
              {inWorld}
            </div>
            {camera && follow && <i class="ms-zm-cam" style={{ width: pct((camera.w / diameterM) * 100), height: pct((camera.h / diameterM) * 100) }} />}
            {follow && hero && (
              <span class="ms-zm-hero" style={{ '--zm-yaw': `${Math.round(heading * 10) / 10}deg` }} role="img" aria-label={t('zonemap.you')} {...tipProps(() => <div class="ms-tip-title">{t('zonemap.you')}</div>)}>
                <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
                  <use href="#zm-p-hero" />
                </svg>
              </span>
            )}
            <i class="ms-zm-shade" />
            <i class="ms-zm-wait" />
            {failed && <span class="ms-zm-msg">{t('zonemap.failed')}</span>}
          </div>
          <svg class="ms-zm-ring" viewBox="0 0 200 200" aria-hidden="true" focusable="false" dangerouslySetInnerHTML={{ __html: ringMarkup() }} />
          {rim}
          {controls && (
            <>
              {onClose && <Medal kind="close" label={t('zonemap.hide')} onClick={onClose} pos={medalPos(-42)} />}
              {onAtlas && <Medal kind="atlas" label={t('zonemap.openAtlas')} onClick={onAtlas} pos={medalPos(-138)} />}
              <Medal kind="minus" label={t('zonemap.zoomOut')} onClick={() => step(1)} disabled={viewIdx >= orderedViews.length - 1} pos={medalPos(24)} />
              <Medal kind="plus" label={t('zonemap.zoomIn')} onClick={() => step(-1)} disabled={viewIdx <= 0} pos={medalPos(56)} />
            </>
          )}
        </div>
        {props.coords !== false && hero && (
          <div class="ms-zm-coords ms-num" title={t('zonemap.coords', { x: fmtCoord(hero.x), z: fmtCoord(hero.z) })}>
            <span>{fmtCoord(hero.x)}</span>
            <i aria-hidden="true" />
            <span>{fmtCoord(hero.z)}</span>
          </div>
        )}
      </div>
    );
  }

  // ---- atlas -------------------------------------------------------------------------------------------------------
  const corner = texUrl('uk_corner');
  const gridOn = props.grid !== false;
  const scaleM = span > 300 ? 100 : 50;
  const ticks = gridOn ? atlasTicks(x0, z0, span) : '';
  const cornerStyle = corner ? { '--zm-orn': `url("${corner}")` } : {};
  return (
    <figure class={`ms-zm ms-zm--atlas ${state} ${corner ? 'has-orn' : ''} ${props.labels === false ? 'no-labels' : ''} ${props.frame === false ? 'is-bare' : ''} ${props.title !== undefined ? 'has-title' : ''} ${cls}`} style={{ ...style, ...cornerStyle }} role="group" aria-label={aria} data-zone={zone?.id}>
      {props.title !== undefined && (
        <TitleBar class="ms-zm-title" {...(onClose ? { onClose } : {})}>
          {props.title}
        </TitleBar>
      )}
      <div class="ms-zm-frame">
        <div class="ms-zm-plate" ref={boxRef}>
          <div class="ms-zm-world" style={{ width: '100%', height: '100%', transform: 'none' }}>
            <canvas ref={cvRef} class="ms-zm-canvas" width="1" height="1" aria-hidden="true" />
            {inWorld}
          </div>
          {gridOn && <svg class="ms-zm-grid" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true" focusable="false" dangerouslySetInnerHTML={{ __html: ticks }} />}
          <i class="ms-zm-shade" />
          <i class="ms-zm-wait" />
          {failed && <span class="ms-zm-msg">{t('zonemap.failed')}</span>}
          <svg class="ms-zm-rose" viewBox="0 0 100 100" aria-hidden="true" focusable="false" dangerouslySetInnerHTML={{ __html: roseMarkup() }} />
          <span class="ms-zm-rose-n" aria-hidden="true">
            {t('zonemap.north')}
          </span>
          {gridOn && (
            <span class="ms-zm-scale" style={{ width: pct((scaleM / span) * 100) }} aria-hidden="true">
              <b class="ms-num">{scaleM} m</b>
            </span>
          )}
        </div>
        <i class="ms-zm-orn is-tl" aria-hidden="true" />
        <i class="ms-zm-orn is-tr" aria-hidden="true" />
        <i class="ms-zm-orn is-bl" aria-hidden="true" />
        <i class="ms-zm-orn is-br" aria-hidden="true" />
      </div>
      {props.caption !== undefined && <figcaption class="ms-zm-caption">{props.caption}</figcaption>}
    </figure>
  );
}

/** Ruler ticks along the four plate edges (viewBox 0..1000 = the raster span): short every 25 m, long every 100 m. */
function atlasTicks(x0: number, z0: number, span: number): string {
  const edge = (lo: number, step: number, long: number): number[] => {
    const out: number[] = [];
    for (let m = Math.ceil(lo / step) * step; m <= lo + span; m += step) out.push(((m - lo) / span) * 1000);
    void long;
    return out;
  };
  let d = '';
  for (const pos of edge(x0, 25, 100)) {
    const metres = Math.round(x0 + (pos / 1000) * span);
    const len = metres % 100 === 0 ? 22 : metres % 50 === 0 ? 14 : 8;
    d += `M${pos.toFixed(1)} 0v${len}M${pos.toFixed(1)} 1000v${-len}`;
  }
  for (const pos of edge(z0, 25, 100)) {
    const metres = Math.round(z0 + (pos / 1000) * span);
    const len = metres % 100 === 0 ? 22 : metres % 50 === 0 ? 14 : 8;
    d += `M0 ${pos.toFixed(1)}h${len}M1000 ${pos.toFixed(1)}h${-len}`;
  }
  return `<path d="${d}" fill="none" stroke="#0b0806" stroke-opacity=".7" stroke-width="3.4" vector-effect="non-scaling-stroke"/><path d="${d}" fill="none" stroke="#e8d6a6" stroke-opacity=".78" stroke-width="1.1" vector-effect="non-scaling-stroke"/>`;
}
