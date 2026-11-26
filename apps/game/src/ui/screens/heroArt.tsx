// Hero-select art kit (UI target "hero-select", B3): the character-select stage and the pieces drawn for it.
//  - StageScene  : dusk temple courtyard backdrop (own silhouette geometry: two halls, gate, ridges, lanterns)
//  - Dais        : moved to heroDais.tsx (carved stone plinth, round 2)
//  - BladeArrow  : gold-hilted scimitar prev / next arrow (steel when enabled-lit, grey when disabled), T12
//  - EmpireFlag  : cloth kingdom banner on a brass bar with an ORIGINAL emblem per kingdom (T11)

// attached as references) are used when the manifest lists them; the drawn SVG + CSS below is the automatic fallback.

// dragon-scimitar arrows and the three cloth empire flags on ornate top bars.
import type { JSX } from 'preact';
import type { ClassId } from '../../data/schema';
import { kitDefs } from '../components/StatIcon';
import { glyphPaths } from '../components/glyphs';
import { CLASS_COLOR, CLASS_GLYPH } from '../components/Icon';
import { texUrl } from '../assets';
import './hero-stage.css';

// ---------------------------------------------------------------------------------------------------------------------
// shared gradients / filters (once per document, ids prefixed hsa-)

const DEFS =
  `<linearGradient id="hsa-steel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6f3ec"/><stop offset=".3" stop-color="#c3c6cb"/><stop offset=".62" stop-color="#7c828b"/><stop offset="1" stop-color="#33373e"/></linearGradient>` +
  `<linearGradient id="hsa-gold" x1="0" y1="0" x2="0.8" y2="1"><stop offset="0" stop-color="#fff4cc"/><stop offset=".3" stop-color="#f0c562"/><stop offset=".66" stop-color="#b07b24"/><stop offset="1" stop-color="#5c3a0c"/></linearGradient>` +
  `<linearGradient id="hsa-gold-h" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#6a430f"/><stop offset=".25" stop-color="#f4cd6e"/><stop offset=".55" stop-color="#fff0b8"/><stop offset=".8" stop-color="#c78d2e"/><stop offset="1" stop-color="#5a360b"/></linearGradient>` +
  `<linearGradient id="hsa-fold" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".38"/><stop offset=".18" stop-color="#fff" stop-opacity=".1"/><stop offset=".4" stop-color="#000" stop-opacity=".22"/><stop offset=".62" stop-color="#fff" stop-opacity=".12"/><stop offset=".84" stop-color="#000" stop-opacity=".26"/><stop offset="1" stop-color="#000" stop-opacity=".42"/></linearGradient>` +
  `<linearGradient id="hsa-hang" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".34"/><stop offset=".22" stop-color="#000" stop-opacity="0"/><stop offset=".7" stop-color="#000" stop-opacity=".05"/><stop offset="1" stop-color="#000" stop-opacity=".5"/></linearGradient>` +
  `<pattern id="hsa-weave" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M4 .6L7.4 4L4 7.4L.6 4Z" fill="#f0c562"/><path d="M4 2.4L5.6 4L4 5.6L2.4 4Z" fill="#7a4a10"/></pattern>` +
  `<filter id="hsa-soft" x="-30%" y="-60%" width="160%" height="220%"><feGaussianBlur stdDeviation="3.2"/></filter>` +
  `<filter id="hsa-relief" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceAlpha" stdDeviation=".6" result="b"/><feSpecularLighting in="b" surfaceScale="1.6" specularConstant=".7" specularExponent="18" lighting-color="#fff2cc" result="s"><feDistantLight azimuth="225" elevation="48"/></feSpecularLighting><feComposite in="s" in2="SourceAlpha" operator="in" result="s2"/><feComposite in="SourceGraphic" in2="s2" operator="arithmetic" k1="0" k2="1" k3=".55" k4="0"/></filter>`;

function ensureDefs(): void {
  kitDefs('hero-select-art', DEFS);
}

/** mix a #rrggbb colour toward `to` by k (0 = colour, 1 = to) */
export function mixHex(hex: string, to: string, k: number): string {
  const p = (h: string): [number, number, number] => {
    const v = h.replace('#', '');
    const n = v.length === 3 ? v.split('').map((c) => c + c).join('') : v;
    return [parseInt(n.slice(0, 2), 16) || 0, parseInt(n.slice(2, 4), 16) || 0, parseInt(n.slice(4, 6), 16) || 0];
  };
  const a = p(hex);
  const b = p(to);
  const m = (i: 0 | 1 | 2): string => Math.round(a[i] + (b[i] - a[i]) * k).toString(16).padStart(2, '0');
  return `#${m(0)}${m(1)}${m(2)}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Stage backdrop: courtyard at dusk (viewBox 800 x 500, horizon y = 250)

const roof = (x0: number, x1: number, yE: number, h: number): string =>
  `M${x0 - 16} ${yE - 9}Q${x0 - 2} ${yE + 1} ${x0 + 10} ${yE}L${x1 - 10} ${yE}Q${x1 + 2} ${yE + 1} ${x1 + 16} ${yE - 9}Q${x1 - 6} ${yE - h * 0.25} ${x1 - 26} ${yE - h}L${x0 + 26} ${yE - h}Q${x0 + 6} ${yE - h * 0.25} ${x0 - 16} ${yE - 9}Z`;

function Hall({ x0, x1, side }: { x0: number; x1: number; side: 'l' | 'r' }): JSX.Element {
  const lamps = [x0 + 18, (x0 + x1) / 2, x1 - 18];
  const wins: number[] = [];
  for (let x = x0 + 26; x < x1 - 30; x += 26) wins.push(x);
  return (
    <g class={`hsa-hall hsa-hall--${side}`}>
      <path d={roof(x0 + 34, x1 - 34, 168, 30)} fill="#0e0807" stroke="rgba(255,160,90,.32)" stroke-width="1.2" />
      <rect x={x0 + 52} y="168" width={x1 - x0 - 104} height="14" fill="#0b0605" />
      <path d={roof(x0, x1, 208, 36)} fill="#120a08" stroke="rgba(255,160,90,.4)" stroke-width="1.3" />
      <rect x={x0 + 6} y="208" width={x1 - x0 - 12} height="42" fill="#0d0706" />
      {wins.map((x) => (
        <rect key={x} x={x} y="219" width="12" height="22" fill="#ffae58" opacity=".34" />
      ))}
      {wins.map((x) => (
        <rect key={`p${x}`} x={x - 7} y="212" width="3" height="38" fill="#050303" />
      ))}
      {lamps.map((x) => (
        <g key={x}>
          <circle cx={x} cy="214" r="9" fill="#ff7a38" opacity=".28" filter="url(#hsa-soft)" />
          <circle cx={x} cy="214" r="2.6" fill="#ff9a58" />
        </g>
      ))}
    </g>
  );
}

export function StageScene(): JSX.Element {
  return (
    <svg class="ms-hs-scene-svg" viewBox="0 100 800 150" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="hsa-sun" cx="50%" cy="100%" r="70%">
          <stop offset="0" stop-color="#ffd27a" stop-opacity=".85" />
          <stop offset=".4" stop-color="#e8782a" stop-opacity=".42" />
          <stop offset="1" stop-color="#7a2410" stop-opacity="0" />
        </radialGradient>
        <linearGradient id="hsa-ridge" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#3a2018" />
          <stop offset="1" stop-color="#1a0e0b" />
        </linearGradient>
      </defs>
      <ellipse cx="400" cy="250" rx="300" ry="170" fill="url(#hsa-sun)" />
      <path d="M0 250V204L60 186L120 206L190 176L260 214L330 196L400 220L470 192L540 212L610 178L680 204L740 184L800 200V250Z" fill="url(#hsa-ridge)" opacity=".78" />
      <path d="M0 250V226L80 212L150 232L240 214L330 236L400 228L470 238L560 216L650 234L730 214L800 226V250Z" fill="#150c09" opacity=".92" />
      <g opacity=".95">
        <path d={roof(330, 470, 236, 14)} fill="#1b0f0b" stroke="rgba(255,170,100,.3)" stroke-width="1" />
        <rect x="338" y="236" width="124" height="14" fill="#130a08" />
        <rect x="392" y="238" width="16" height="12" fill="#ffb764" opacity=".62" />
        <path d={roof(372, 428, 222, 10)} fill="#1b0f0b" stroke="rgba(255,170,100,.28)" stroke-width=".9" />
      </g>
      <Hall x0={-36} x1={252} side="l" />
      <Hall x0={548} x1={836} side="r" />
      <g fill="#0a0605">
        <path d="M296 250V228l6-8l6 8V250Z" />
        <path d="M492 250V228l6-8l6 8V250Z" />
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Class gem: the class glyph cut into a faceted gem set in a worn-bronze octagon (replaces the thin line glyph in a CSS ring)

/** octagon points in a 48 box, inset by `i` (the same cut as the kit's --oct: 22 % chamfers) */
export function octPoints(i: number): string {
  const w = 48 - 2 * i;
  const c = w * 0.22;
  const x0 = i;
  const x1 = 48 - i;
  const pts: [number, number][] = [
    [x0 + c, x0], [x1 - c, x0], [x1, x0 + c], [x1, x1 - c], [x1 - c, x1], [x0 + c, x1], [x0, x1 - c], [x0, x0 + c],
  ];
  return pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
}

export function ClassGem({ classId, size = '2.4rem' }: { classId: ClassId; size?: string }): JSX.Element {
  ensureDefs();
  const c = CLASS_COLOR[classId];
  const id = `hscg-${classId}`;
  return (
    <span class="ms-hs-gem" style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 48 48" focusable="false">
        <defs>
          <radialGradient id={id} cx=".34" cy=".26" r=".92">
            <stop offset="0" stop-color={mixHex(c, '#ffffff', 0.62)} />
            <stop offset=".4" stop-color={c} />
            <stop offset="1" stop-color={mixHex(c, '#000000', 0.7)} />
          </radialGradient>
        </defs>
        <polygon points={octPoints(0.6)} fill="#0a0604" />
        <polygon points={octPoints(1.4)} fill="url(#hsa-gold)" />
        <polygon points={octPoints(4)} fill="#120a05" />
        <polygon points={octPoints(5)} fill={`url(#${id})`} />
        <path d="M24 5L24 43M5 24L43 24M9.4 9.4L38.6 38.6M38.6 9.4L9.4 38.6" stroke="#fff" stroke-width=".7" opacity=".17" fill="none" />
        <polygon points={octPoints(10)} fill="none" stroke="#fff" stroke-width=".8" opacity=".22" />
        <g transform="translate(10 10) scale(1.17)" fill="#fff8e8" stroke="#1a0c06" stroke-width="1" stroke-linejoin="round" paint-order="stroke">
          {glyphPaths(CLASS_GLYPH[classId])}
        </g>
        <path d="M9 12C13 7.6 22 6.4 30 7.4C22 9.4 14 12.6 9 12Z" fill="#fff" opacity=".34" />
        <polygon points={octPoints(1.4)} fill="none" stroke="#fff3c4" stroke-width=".6" opacity=".5" />
      </svg>
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Blade arrows (viewBox 168 x 60, pointing right; `prev` is mirrored by CSS)

export function BladeSvg(): JSX.Element {
  ensureDefs();
  return (
    <svg class="ms-hs-blade-svg" viewBox="0 0 168 60" aria-hidden="true" focusable="false">
      {/* blade: spine curves up to the tip, cutting edge below */}
      <path d="M50 24C92 22 134 14 164 3C146 22 106 37 50 37Z" fill="#05050a" opacity=".55" transform="translate(1.2 2.4)" />
      <path d="M50 24C92 22 134 14 164 3C146 22 106 37 50 37Z" fill="url(#hsa-steel)" stroke="#12141a" stroke-width="1.3" stroke-linejoin="round" />
      <path d="M52 30C94 29 132 21 154 9" fill="none" stroke="#2a2d34" stroke-width="1.5" stroke-linecap="round" opacity=".7" />
      <path d="M52 27.4C92 26 130 18.6 152 7.6" fill="none" stroke="#fff" stroke-width=".9" stroke-linecap="round" opacity=".7" />
      <path d="M54 36C94 36 128 28 150 15" fill="none" stroke="#e7ebf0" stroke-width=".8" stroke-linecap="round" opacity=".5" />
      {/* gilded ricasso with scalloped edge */}
      <path d="M50 23.4C64 23 76 22.6 90 21.6L90 31.6C84 34 80 33 76 35.6C72 33.4 68 35.6 64 36.4C60 35 56 37 50 37Z" fill="url(#hsa-gold-h)" stroke="#2a1706" stroke-width="1.1" stroke-linejoin="round" />
      <path d="M56 28.4q4-5 8 0q4 5 8 0q4-5 8 0" fill="none" stroke="#5a3608" stroke-width="1.3" stroke-linecap="round" />
      {/* cloud-scroll guard */}
      <path d="M43 7C54 11 58 20 54 30C58 40 54 49 43 53C46 45 43 38 38 30C43 22 46 15 43 7Z" fill="url(#hsa-gold)" stroke="#2a1706" stroke-width="1.3" stroke-linejoin="round" />
      <path d="M45 13Q50 20 47 26M45 47Q50 40 47 34" fill="none" stroke="#6a430f" stroke-width="1.2" stroke-linecap="round" />
      <circle cx="49" cy="30" r="3" fill="#e84a2e" stroke="#2a1706" stroke-width="1" />
      <circle cx="48.2" cy="29.2" r="1" fill="#ffd7c4" />
      {/* grip with cord wrap, pommel */}
      <rect x="16" y="26" width="23" height="8" rx="2.6" fill="url(#hsa-gold-h)" stroke="#2a1706" stroke-width="1.1" />
      <path d="M21 26l3 8M27 26l3 8M33 26l3 8" stroke="#4a2c06" stroke-width="1.4" />
      <path d="M12 21C5 24 3 36 12 39C9 34 9 26 12 21Z" fill="url(#hsa-gold)" stroke="#2a1706" stroke-width="1.2" stroke-linejoin="round" />
      <circle cx="9.5" cy="30" r="2.2" fill="#f4cd6e" stroke="#2a1706" stroke-width=".9" />
    </svg>
  );
}

export function BladeArrow({ dir, disabled, onClick, label }: { dir: 'prev' | 'next'; disabled?: boolean; onClick: () => void; label: string }): JSX.Element {
  const tex = texUrl('uk_hero_select_blade');
  return (
    <button type="button" class={`ms-hs-blade ms-hs-blade--${dir} ${tex ? 'ms-hs-blade--tex' : ''} ${disabled ? 'is-off' : ''}`} aria-label={label} aria-disabled={disabled ? 'true' : undefined} data-nav="" title={label} onClick={onClick}>
      {tex ? <img class="ms-hs-blade-img" src={tex} alt="" draggable={false} /> : <BladeSvg />}
      <span class="ms-hit" aria-hidden="true" />
    </button>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Empire flag: brass bar with finials, cloth with woven trim and swallowtail, roundel with an original emblem

const EMBLEM_STROKE = { stroke: '#2a1204', 'stroke-width': 1.1, 'stroke-linejoin': 'round' } as const;

/** Original kingdom emblems, 64 x 64, drawn on the roundel. */
function Emblem({ empire }: { empire: string }): JSX.Element {
  const wing = (
    <path d="M23 36C15 31 7 31 2 37C8 37 12 39 14 42C10 42 6 44 4 48C10 47 14 48 18 50C15 51 12 53 11 57C18 55 24 51 27 45Z" />
  );
  if (empire === 'chowon') {
    // crowned sun between two spread wings
    return (
      <g fill="url(#hsa-gold)" {...EMBLEM_STROKE}>
        {wing}
        <g transform="matrix(-1 0 0 1 64 0)">{wing}</g>
        <circle cx="32" cy="38" r="9" />
        <circle cx="32" cy="38" r="4.2" fill="#c4361c" />
        <path d="M21 25L25 13L29 21L32 8L35 21L39 13L43 25Z" />
        <circle cx="32" cy="9" r="1.8" fill="#e84a2e" />
      </g>
    );
  }
  if (empire === 'jihae') {
    // pearl over a double cloud-scroll, crescent above, wave line below
    return (
      <g fill="none" stroke="url(#hsa-gold)" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M32 55C19 55 10 46 10 35C10 27 16 21 24 21C30 21 34 25 34 30C34 34 31 37 27 37C24 37 22 35 22 32" />
        <path d="M32 55C45 55 54 46 54 35C54 27 48 21 40 21C34 21 30 25 30 30C30 34 33 37 37 37C40 37 42 35 42 32" />
        <path d="M5 58C13 52 21 61 32 55C43 61 51 52 59 58" stroke-width="3" />
        <path d="M24 12A9 9 0 1 0 40 12A6.6 6.6 0 1 1 24 12Z" fill="url(#hsa-gold)" stroke="#2a1204" stroke-width="1" />
        <circle cx="32" cy="30" r="3.4" fill="#78d4ff" stroke="#0d2a4a" stroke-width="1" />
      </g>
    );
  }
  // saehwa: horned dragon-head crest (front view) with whisker curls, brow, slit eyes, nostrils and fangs
  return (
    <g fill="url(#hsa-gold)" {...EMBLEM_STROKE}>
      <path d="M24 30C14 28 9 18 12 5C18 11 23 15 29 19Z" />
      <path d="M40 30C50 28 55 18 52 5C46 11 41 15 35 19Z" />
      <path d="M24 42C15 44 9 51 8 60C14 55 20 53 27 52Z" />
      <path d="M40 42C49 44 55 51 56 60C50 55 44 53 37 52Z" />
      <path d="M32 11L45 24L43 43L32 57L21 43L19 24Z" />
      <path d="M22 28L32 31L42 28" fill="none" stroke="#2a1204" stroke-width="1.6" stroke-linecap="round" />
      <path d="M23.5 32.5L30.5 35L24.5 37.4Z M40.5 32.5L33.5 35L39.5 37.4Z" fill="#e84a2e" stroke="#2a1204" stroke-width=".8" />
      <circle cx="32" cy="19" r="2.4" fill="#e84a2e" stroke="#2a1204" stroke-width=".8" />
      <path d="M28.6 45.4h1.6v2.4h-1.6Z M33.8 45.4h1.6v2.4h-1.6Z" fill="#2a1204" stroke="none" />
      <path d="M26 50L32 54L38 50" fill="none" stroke="#2a1204" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M29.4 51.6L30.6 55L32 52.4M34.6 51.6L33.4 55L32 52.4" fill="#fff4cc" stroke="#2a1204" stroke-width=".7" />
    </g>
  );
}

/** Cells of the painted banner sheet (uk_hero_select_flag, 1536 x 854): three identical banners, empty dark roundel. */
const FLAG_SHEET = { w: 1536, h: 854 } as const;
const FLAG_CELLS: Record<string, { x: number; y: number; w: number; h: number }> = {
  saehwa: { x: 6, y: 7, w: 484, h: 840 },
  chowon: { x: 530, y: 7, w: 477, h: 840 },
  jihae: { x: 1047, y: 7, w: 483, h: 840 },
};
/** aspect (w / h) of one painted banner; the roundel centre sits at (50 %, 42.5 %) with a diameter of 55 % of the width */
export const FLAG_TEX_ASPECT = 484 / 840;

/** CSS of one banner cell: the sheet scaled so the cell fills the box, offset so the cell's top-left is the box's top-left */
export function flagCellStyle(empire: string, url: string): { aspectRatio: string; backgroundImage: string; backgroundSize: string; backgroundPosition: string } {
  const c = FLAG_CELLS[empire] ?? FLAG_CELLS.saehwa!;
  return {
    aspectRatio: `${c.w} / ${c.h}`,
    backgroundImage: `url("${url}")`,
    backgroundSize: `${((FLAG_SHEET.w / c.w) * 100).toFixed(2)}% auto`,
    backgroundPosition: `${((c.x / (FLAG_SHEET.w - c.w)) * 100).toFixed(3)}% ${((c.y / (FLAG_SHEET.h - c.h)) * 100).toFixed(3)}%`,
  };
}

function TexFlag({ empire, url, selected }: { empire: string; url: string; selected?: boolean }): JSX.Element {
  ensureDefs();
  const { aspectRatio, ...cell } = flagCellStyle(empire, url);
  // the shared painted empire crest (uk_crest_empire_<id>, components/Icon.tsx family) on the roundel; the drawn emblem when it is not shipped
  const crest = texUrl(`uk_crest_empire_${empire}`);
  return (
    <span class={`ms-hs-flag-tex ms-hs-flag-tex--${empire} ${selected ? 'is-sel' : ''}`} aria-hidden="true" style={{ aspectRatio }}>
      <span class="ms-hs-flag-cell" style={cell} />
      {crest ? (
        <img class="ms-hs-flag-crest" src={crest} alt="" draggable={false} decoding="async" />
      ) : (
        <svg class="ms-hs-flag-emb" viewBox="0 0 64 64" focusable="false">
          <g filter="url(#hsa-relief)">
            <Emblem empire={empire} />
          </g>
        </svg>
      )}
    </span>
  );
}

export function EmpireFlag({ empire, color, selected }: { empire: string; color: string; selected?: boolean }): JSX.Element {
  const tex = texUrl('uk_hero_select_flag');
  if (tex) return <TexFlag empire={empire} url={tex} selected={selected} />;
  ensureDefs();
  const hi = mixHex(color, '#ffffff', 0.18);
  const lo = mixHex(color, '#000000', 0.5);
  const gid = `hsf-${empire}`;
  return (
    <svg class={`ms-hs-flag-svg ${selected ? 'is-sel' : ''}`} viewBox="0 0 120 176" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color={hi} />
          <stop offset=".55" stop-color={color} />
          <stop offset="1" stop-color={lo} />
        </linearGradient>
        <radialGradient id={`${gid}-r`} cx="50%" cy="42%" r="62%">
          <stop offset="0" stop-color={mixHex(color, '#000000', 0.2)} />
          <stop offset="1" stop-color={mixHex(color, '#000000', 0.64)} />
        </radialGradient>
      </defs>
      {/* cloth */}
      <g class="ms-hs-flag-cloth">
        <path d="M14 17H106V152L60 130L14 152Z" fill="#000" opacity=".5" transform="translate(1.6 3)" />
        <path d="M14 17H106V152L60 130L14 152Z" fill={`url(#${gid})`} stroke="#1a0c06" stroke-width="1.2" stroke-linejoin="round" />
        <path d="M14 17H106V152L60 130L14 152Z" fill="url(#hsa-fold)" />
        <path d="M14 17H106V152L60 130L14 152Z" fill="url(#hsa-hang)" />
        {/* woven trim bands */}
        <rect x="17" y="21" width="8" height="122" fill="url(#hsa-weave)" opacity=".9" />
        <rect x="95" y="21" width="8" height="122" fill="url(#hsa-weave)" opacity=".9" />
        <path d="M17 21H103M17 143L60 123L103 143" fill="none" stroke="#e8b84c" stroke-width="1.3" opacity=".85" />
        {/* roundel + emblem */}
        <circle cx="60" cy="70" r="34" fill={`url(#${gid}-r)`} stroke="#1a0c06" stroke-width="2.6" />
        <circle cx="60" cy="70" r="34" fill="none" stroke="url(#hsa-gold)" stroke-width="1.8" />
        <circle cx="60" cy="70" r="29.6" fill="none" stroke="#f0c562" stroke-width=".7" opacity=".6" />
        <g transform="translate(34.4 44.4) scale(.8)" filter="url(#hsa-relief)">
          <Emblem empire={empire} />
        </g>
        {/* tassels */}
        <path d="M14 152L9 166M106 152L111 166" stroke="url(#hsa-gold)" stroke-width="2.2" stroke-linecap="round" />
        <circle cx="9" cy="168" r="3" fill="url(#hsa-gold)" stroke="#2a1204" stroke-width=".8" />
        <circle cx="111" cy="168" r="3" fill="url(#hsa-gold)" stroke="#2a1204" stroke-width=".8" />
        <path d="M60 130V148" stroke="url(#hsa-gold)" stroke-width="1.6" />
        <circle cx="60" cy="151" r="2.4" fill="url(#hsa-gold)" stroke="#2a1204" stroke-width=".7" />
      </g>
      {/* hanging loops + brass bar with finials and a lotus crest */}
      <g fill="none" stroke="#e0b24e" stroke-width="2.2">
        <path d="M22 17V11M44 17V11M76 17V11M98 17V11" />
      </g>
      <rect x="6" y="8" width="108" height="7" rx="3.2" fill="url(#hsa-gold-h)" stroke="#2a1706" stroke-width="1.3" />
      <circle cx="6" cy="11.5" r="6.2" fill="url(#hsa-gold)" stroke="#2a1706" stroke-width="1.3" />
      <circle cx="114" cy="11.5" r="6.2" fill="url(#hsa-gold)" stroke="#2a1706" stroke-width="1.3" />
      <circle cx="4.6" cy="9.8" r="1.7" fill="#fff6d2" opacity=".75" />
      <circle cx="112.6" cy="9.8" r="1.7" fill="#fff6d2" opacity=".75" />
      <path d="M60 1.4C66 4 68 8 66 12H54C52 8 54 4 60 1.4Z" fill="url(#hsa-gold)" stroke="#2a1706" stroke-width="1.2" stroke-linejoin="round" />
      <path d="M60 4.6V12" stroke="#6a430f" stroke-width="1" />
    </svg>
  );
}
