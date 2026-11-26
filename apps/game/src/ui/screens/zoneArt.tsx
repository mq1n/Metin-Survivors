// Zone select art kit (B4 zone-select): the drawn pieces of the campaign atlas, all our own geometry in inline SVG.
//   <Banner/>             the cloth banner pin planted on a region: painted cloth with its own emblem (uk_zone_select_flags sheet), numeral + state mark
//   <PinMark/>            small raster map markers (uk_zone_select_pins sheet): boss arena, final battle, camp, metin crystal
//   <ChainRun/>           iron chain laid along a curve (locked link between two regions)
//   <LinkSeal/>           bronze seal medallion with a padlock (closed iron when locked, open gold when the way is free)
//   <HardSeal/>           the cracked ember seal that marks Hard mode
//   <DangerSkulls/>       n of max skulls, lit / unlit
// Light comes from the upper left, as everywhere in the kit.
import type { JSX } from 'preact';
import type { ZoneDef } from '../../data/schema';
import { texUrl } from '../assets';
import { UiGlyph } from '../components/StatIcon';
import type { Pt } from './zoneContinent';

export type { Pt };

const f2 = (n: number): string => (Math.round(n * 1000) / 1000).toString();

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const ROMAN: readonly string[] = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
export const roman = (n: number): string => ROMAN[Math.max(0, n - 1)] ?? String(n);

/** Campaign danger: one skull per chapter, four at most. */
export const dangerOf = (z: ZoneDef): number => Math.max(1, Math.min(4, z.order));

// ---------------------------------------------------------------------------------------------------------------------
// Banner pin (uk_zone_select_flags: four painted cloth banners on one sheet, each with its own emblem)

export type BannerState = 'open' | 'cleared' | 'hard' | 'locked';

/** crop of each banner on the 1536 x 865 sheet: green tiger (plains), amber dragon (valley), blue snow peak (mountain), ash horned skull (ember waste) */
const FLAG_X: readonly number[] = [2, 390, 770, 1156];
const FLAG_W = 384;
const FLAG_H = 865;
export const BANNER_ASPECT = FLAG_W / FLAG_H;
const FLAG_BY_ZONE: Record<string, number> = { yeonmu: 0, suryeon: 1, seori: 2, daeryeol: 3 };
export const bannerVariantOf = (zoneId: string, order: number): number => FLAG_BY_ZONE[zoneId] ?? Math.max(0, order - 1) % FLAG_X.length;

/** The state mark hung under the numeral (drawn in a 56 x 108 box, centred on x = 28, y = 52..68). */
function BannerEmblem({ state, trim, gold }: { state: BannerState; trim: string; gold: string }): JSX.Element {
  return (
    <>
      {state === 'cleared' && <path d="M28 52.4l2.6 5.2 5.8.8-4.2 4.1 1 5.7L28 65.4l-5.2 2.8 1-5.7-4.2-4.1 5.8-.8z" fill={gold} stroke="#0b0a09" stroke-width="1" stroke-linejoin="round" />}
      {state === 'hard' && (
        <g>
          <path d="M28 52.4l2.6 5.2 5.8.8-4.2 4.1 1 5.7L28 65.4l-5.2 2.8 1-5.7-4.2-4.1 5.8-.8z" fill={gold} stroke="#0b0a09" stroke-width="1" stroke-linejoin="round" />
          <circle cx="28" cy="60.4" r="3.6" fill="#7a1a12" stroke="#0b0a09" stroke-width="0.9" />
          <path d="M26.3 59.6h1v1.3h-1zm2.4 0h1v1.3h-1zM27.5 62.2h1" stroke="#f1d9a4" stroke-width="0.7" fill="#f1d9a4" />
        </g>
      )}
      {state === 'open' && <path d="M28 55.2l3.4 4.4-3.4 4.4-3.4-4.4z" fill={trim} stroke="#0b0a09" stroke-width="0.9" stroke-linejoin="round" opacity="0.9" />}
      {state === 'locked' && (
        <g>
          <path d="M23.8 58.6v-2.5a4.2 4.2 0 0 1 8.4 0v2.5" fill="none" stroke="#0b0a09" stroke-width="3.2" stroke-linecap="round" />
          <path d="M23.8 58.6v-2.5a4.2 4.2 0 0 1 8.4 0v2.5" fill="none" stroke="#a7a294" stroke-width="1.7" stroke-linecap="round" />
          <rect x="21.6" y="58.4" width="12.8" height="9.4" rx="1.8" fill="#6c6a62" stroke="#0b0a09" stroke-width="1.2" />
          <rect x="22.8" y="59.4" width="10.4" height="2.4" fill="#fff" opacity="0.18" />
          <circle cx="28" cy="62.8" r="1.5" fill="#0b0a09" />
        </g>
      )}
    </>
  );
}

/** The cloth banner pin: the painted banner of the zone, the chapter numeral stitched in gold on the plain upper cloth, the state mark under it. */
export function Banner({ id, variant, numeral, state, class: cls }: { id: string; variant: number; numeral: string; state: BannerState; class?: string }): JSX.Element | null {
  const src = texUrl('uk_zone_select_flags');
  if (!src) return null;
  const locked = state === 'locked';
  const x0 = FLAG_X[Math.max(0, Math.min(FLAG_X.length - 1, variant))] ?? 0;
  const g = (n: string): string => `zsb-${id}-${n}`;
  const s = 3.3;
  const fs = numeral.length > 2 ? 74 : numeral.length > 1 ? 86 : 100;
  return (
    <svg class={`ms-zs-banner ${cls ?? ''}`} viewBox={`${x0} 0 ${FLAG_W} ${FLAG_H}`} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={g('gd')} x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0" stop-color="#fff2c6" />
          <stop offset="0.4" stop-color="#e2b65c" />
          <stop offset="1" stop-color="#7a4d16" />
        </linearGradient>
      </defs>
      <image href={src} x="0" y="0" width="1536" height="865" class={locked ? 'ms-zs-banner-img is-locked' : 'ms-zs-banner-img'} />
      <text x={x0 + FLAG_W / 2} y={275 + fs * 0.12} text-anchor="middle" class="ms-zs-banner-num" font-size={fs} fill={locked ? '#9d9684' : `url(#${g('gd')})`}>
        {numeral}
      </text>
      <g transform={`translate(${x0 + FLAG_W / 2 - 28 * s} ${372 - 60 * s}) scale(${s})`}>
        <BannerEmblem state={state} trim={locked ? '#8d8576' : '#e8d9a0'} gold={`url(#${g('gd')})`} />
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Map markers (uk_zone_select_pins: boss arena skull, final battle crown + swords, camp tent, metin crystal)

export type PinKind = 'boss' | 'final' | 'camp' | 'crystal';
const PIN_BOX: Record<PinKind, [number, number, number, number]> = {
  boss: [12, 56, 384, 388],
  final: [510, 2, 512, 502],
  camp: [2, 580, 400, 390],
  crystal: [570, 580, 400, 390],
};

export function PinMark({ kind, class: cls }: { kind: PinKind; class?: string }): JSX.Element {
  const src = texUrl('uk_zone_select_pins');
  const [x, y, w, h] = PIN_BOX[kind];
  if (!src) return <span class={`ms-zs-pin ms-zs-pin--${kind} is-plain ${cls ?? ''}`} aria-hidden="true" />;
  return (
    <svg class={`ms-zs-pin ms-zs-pin--${kind} ${cls ?? ''}`} viewBox={`${x} ${y} ${w} ${h}`} aria-hidden="true" focusable="false">
      <image href={src} x="0" y="0" width="1024" height="972" />
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Chain + seals (connectors between regions)

/** Quadratic curve between two regions with a gentle bend (perpendicular offset), sampled to n+1 points with tangents. */
export function bendCurve(a: Pt, b: Pt, bend: number): { c: Pt; at: (t: number) => { x: number; y: number; ang: number } } {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const c: Pt = { x: mx - (dy / len) * len * bend, y: my + (dx / len) * len * bend };
  const at = (t: number): { x: number; y: number; ang: number } => {
    const u = 1 - t;
    const x = u * u * a.x + 2 * u * t * c.x + t * t * b.x;
    const y = u * u * a.y + 2 * u * t * c.y + t * t * b.y;
    const tx = 2 * u * (c.x - a.x) + 2 * t * (b.x - c.x);
    const ty = 2 * u * (c.y - a.y) + 2 * t * (b.y - c.y);
    return { x, y, ang: (Math.atan2(ty, tx) * 180) / Math.PI };
  };
  return { c, at };
}

/** Links of an iron chain along a curve: alternating flat and edge-on links, outline + body + glint. */
export function ChainRun({ a, b, bend, link, from = 0.14, to = 0.86 }: { a: Pt; b: Pt; bend: number; link: number; from?: number; to?: number }): JSX.Element {
  const { at } = bendCurve(a, b, bend);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const span = len * (to - from);
  const n = Math.max(2, Math.floor(span / (link * 0.86)));
  const items: JSX.Element[] = [];
  for (let i = 0; i <= n; i++) {
    const t = from + ((to - from) * i) / n;
    const p = at(t);
    const flat = i % 2 === 0;
    const rx = flat ? link * 0.62 : link * 0.5;
    const ry = flat ? link * 0.34 : link * 0.15;
    items.push(
      <g key={i} transform={`translate(${f2(p.x)} ${f2(p.y)}) rotate(${f2(p.ang)})`}>
        <ellipse rx={rx} ry={ry} fill="none" stroke="#050403" stroke-width={link * 0.3} />
        <ellipse rx={rx} ry={ry} fill="none" stroke="#6a6860" stroke-width={link * 0.17} />
        <ellipse rx={rx} ry={ry} fill="none" stroke="#b3ad9f" stroke-width={link * 0.05} stroke-dasharray={`${f2(rx * 1.4)} ${f2(rx * 6)}`} transform="translate(-0.4 -0.5)" />
      </g>,
    );
  }
  return <g class="ms-zs-chain">{items}</g>;
}

/** Bronze seal medallion centred on (x, y): closed iron padlock when locked, open gold padlock when the way is free. */
export function LinkSeal({ x, y, r, locked, uid }: { x: number; y: number; r: number; locked: boolean; uid: string }): JSX.Element {
  const k = r / 20;
  const g = (n: string): string => `zsl-${uid}-${n}`;
  const seal = texUrl('uk_zone_select_seal');
  return (
    <g transform={`translate(${f2(x)} ${f2(y)}) scale(${f2(k)})`} class={`ms-zs-seal ${locked ? 'is-locked' : 'is-open'}`}>
      <defs>
        <linearGradient id={g('rim')} x1="0" y1="0" x2="0.7" y2="1">
          <stop offset="0" stop-color="#f3d9a6" />
          <stop offset="0.35" stop-color="#cf9c58" />
          <stop offset="0.7" stop-color="#85552a" />
          <stop offset="1" stop-color="#36200c" />
        </linearGradient>
        <radialGradient id={g('face')} cx="0.38" cy="0.3" r="0.85">
          <stop offset="0" stop-color={locked ? '#3b3832' : '#4a3a1e'} />
          <stop offset="1" stop-color="#0e0b08" />
        </radialGradient>
        <linearGradient id={g('lk')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color={locked ? '#c9c4b5' : '#fff2c6'} />
          <stop offset="0.5" stop-color={locked ? '#807c71' : '#e2b65c'} />
          <stop offset="1" stop-color={locked ? '#34322c' : '#7a4d16'} />
        </linearGradient>
      </defs>
      <circle r="20" fill="#050403" opacity="0.55" transform="translate(1.2 2)" />
      {seal ? (
        <>
          {/* the painted bronze medallion (braided rim, four rivets); the recess is darkened so the padlock reads */}
          <image href={seal} x="-20" y="-19.6" width="40" height="38.4" class={locked ? 'ms-zs-seal-img is-locked' : 'ms-zs-seal-img'} />
          <circle r="13.6" fill={`url(#${g('face')})`} opacity={locked ? 0.84 : 0.78} />
          <circle r="13.6" fill="none" stroke="#0b0705" stroke-width="0.9" opacity="0.8" />
        </>
      ) : (
        <>
          <circle r="19.5" fill="#0b0705" />
          <circle r="18" fill={`url(#${g('rim')})`} />
          <circle r="14.6" fill={`url(#${g('face')})`} stroke="#0b0705" stroke-width="1.2" />
        </>
      )}
      {/* shackle */}
      {locked ? (
        <>
          <path d="M-6 -1.5v-4.2a6 6 0 0 1 12 0v4.2" fill="none" stroke="#050403" stroke-width="5" stroke-linecap="round" />
          <path d="M-6 -1.5v-4.2a6 6 0 0 1 12 0v4.2" fill="none" stroke={`url(#${g('lk')})`} stroke-width="2.7" stroke-linecap="round" />
        </>
      ) : (
        <>
          <path d="M-6 -2.6v-4.6a6 6 0 0 1 12 0" fill="none" stroke="#050403" stroke-width="5" stroke-linecap="round" transform="translate(5 -2.4) rotate(18)" />
          <path d="M-6 -2.6v-4.6a6 6 0 0 1 12 0" fill="none" stroke={`url(#${g('lk')})`} stroke-width="2.7" stroke-linecap="round" transform="translate(5 -2.4) rotate(18)" />
        </>
      )}
      {/* body */}
      <rect x="-9" y="-2" width="18" height="13.4" rx="2.4" fill="#050403" />
      <rect x="-8" y="-1" width="16" height="11.4" rx="2" fill={`url(#${g('lk')})`} />
      <rect x="-7" y="-0.2" width="14" height="3" rx="1" fill="#fff" opacity="0.2" />
      <circle cx="0" cy="4.2" r="1.9" fill="#0b0705" />
      <path d="M-0.8 4.6h1.6l.6 3.6h-2.8z" fill="#0b0705" />
    </g>
  );
}

/** The cracked ember seal of Hard mode (round, with a skull cut into it). */
export function HardSeal({ class: cls }: { class?: string }): JSX.Element {
  return (
    <span class={`ms-zs-hardseal ${cls ?? ''}`} aria-hidden="true">
      <svg viewBox="0 0 64 64" focusable="false">
        <defs>
          <radialGradient id="zshs-face" cx="0.38" cy="0.3" r="0.9">
            <stop offset="0" stop-color="#b8321f" />
            <stop offset="0.55" stop-color="#6f160e" />
            <stop offset="1" stop-color="#2a0705" />
          </radialGradient>
          <linearGradient id="zshs-rim" x1="0" y1="0" x2="0.7" y2="1">
            <stop offset="0" stop-color="#ffe3a0" />
            <stop offset="0.4" stop-color="#d0923a" />
            <stop offset="1" stop-color="#5a3510" />
          </linearGradient>
        </defs>
        <circle cx="32" cy="32" r="30.5" fill="#050403" />
        <circle cx="32" cy="32" r="29" fill="url(#zshs-rim)" />
        <circle cx="32" cy="32" r="24.6" fill="url(#zshs-face)" stroke="#0b0705" stroke-width="1.4" />
        {/* cracks: ember light seeping out */}
        <path d="M32 7.4 29.4 16.6 35 22.4 30.2 30.4 36.4 38.6 31 46 33.6 56.6" fill="none" stroke="#1a0402" stroke-width="2.6" stroke-linejoin="round" />
        <path d="M32 7.4 29.4 16.6 35 22.4 30.2 30.4 36.4 38.6 31 46 33.6 56.6" fill="none" stroke="#ff8a3a" stroke-width="1" stroke-linejoin="round" opacity="0.9" />
        <path d="M35 22.4 44 20.6M30.2 30.4 20.6 27.4M36.4 38.6 45 42" fill="none" stroke="#ff8a3a" stroke-width="0.8" opacity="0.7" />
        {/* skull */}
        <path d="M32 21.6c-6 0-9.4 4.2-9.4 9 0 3.2 1.5 5.4 3.4 6.7v3.4h12v-3.4c1.9-1.3 3.4-3.5 3.4-6.7 0-4.8-3.4-9-9.4-9z" fill="#f1d9a4" stroke="#0b0705" stroke-width="1.2" stroke-linejoin="round" />
        <path d="M25.4 29.4a3.2 3.4 0 1 0 6.2 0 3.2 3.4 0 1 0-6.2 0zM32.4 29.4a3.2 3.4 0 1 0 6.2 0 3.2 3.4 0 1 0-6.2 0z" fill="#2a0705" />
        <path d="M32 33.4l-1.4 3h2.8zM28.8 40.6v-2.4M32 40.6v-2.4M35.2 40.6v-2.4" stroke="#0b0705" stroke-width="1" fill="#0b0705" />
      </svg>
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------------------

export function DangerSkulls({ n, max = 4, class: cls, short }: { n: number; max?: number; class?: string; short?: boolean }): JSX.Element {
  const items: JSX.Element[] = [];
  for (let i = 0; i < max; i++) items.push(<UiGlyph key={i} name="skull" tone={i < n ? 'crimson' : 'pewter'} flat class={`ms-zs-skull ${i < n ? 'is-lit' : 'is-dim'}`} />);
  return (
    <>
      <span class={`ms-zs-skulls ${cls ?? ''}`} aria-hidden="true">
        {items}
      </span>
      {/* narrow name plates swap the row of skulls for one skull and the number (a container query in zone.css; never wraps, never spills) */}
      {short && (
        <span class="ms-zs-skulls-n ms-num" aria-hidden="true">
          <UiGlyph name="skull" tone="crimson" flat class="ms-zs-skull is-lit" />
          {n}
        </span>
      )}
    </>
  );
}
