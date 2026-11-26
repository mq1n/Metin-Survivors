// ZoneMap vector art (UI core C14): everything the map frame and pips are drawn from, as SVG markup strings built once.


//
//   ringMarkup()        the minimap ring: braided pewter rope between two rails, four bronze cuffs  (viewBox 0 0 200 200)
//   PIP_DEFS            gradients + one <g id="zm-p-<kind>"> per pip kind (viewBox 0 0 32 32), injected into the shared defs
//   roseMarkup()        the atlas compass rose (viewBox 0 0 100 100)
//   MEDAL_GLYPH         inline 16-unit glyphs of the medallion buttons
//
// Light comes from the upper left everywhere (as the rest of the kit); the cuffs are generated four times with the
// gradient counter-rotated, so a rotated copy keeps its highlight on the upper left.

const f = (n: number): string => (Math.round(n * 100) / 100).toString();

// ------------------------------------------------------------------------------------------------------ ring geometry

/** ring centre line radius, strand half-amplitude, twists around the ring, samples per twist (viewBox 200) */
const C = 100;
const RC = 86;
const AMP = 3.1;
const WAVES = 26;
const STEPS = 14;
const STRAND_W = 5.6;

/** radius of the visible map disc in the 200 box: the rope's inner rail overlaps it by ~1.4 */
export const RING_MAP_R = 78;

const polar = (r: number, th: number): [number, number] => [C + r * Math.sin(th), C - r * Math.cos(th)];

function strandPath(sign: 1 | -1, th0: number, th1: number, steps: number): string {
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const th = th0 + ((th1 - th0) * i) / steps;
    const [x, y] = polar(RC + sign * AMP * Math.sin(WAVES * th), th);
    d += `${i ? 'L' : 'M'}${f(x)} ${f(y)}`;
  }
  return `${d}${th1 - th0 >= Math.PI * 2 - 1e-6 ? 'Z' : ''}`;
}

function cuff(phi: number): string {
  // North cuff in absolute coordinates (ring centre line y = 14), rotated by phi about the ring centre; the paint
  // servers are counter-rotated so the highlight stays on the upper left
  const id = `zm-cf${phi}`;
  const counter = `gradientTransform="rotate(${-phi} 0.5 0.5)"`;
  return (
    `<linearGradient id="${id}" x1="0.1" y1="0" x2="0.9" y2="1" ${counter}><stop offset="0" stop-color="#f3d9a6"/><stop offset=".3" stop-color="#cf9c58"/><stop offset=".64" stop-color="#85552a"/><stop offset="1" stop-color="#36200c"/></linearGradient>` +
    `<radialGradient id="${id}j" cx=".36" cy=".3" r=".75"><stop offset="0" stop-color="#fffbe6"/><stop offset=".3" stop-color="#f1c667"/><stop offset=".72" stop-color="#9a6422"/><stop offset="1" stop-color="#3a1f08"/></radialGradient>` +
    `<g transform="rotate(${phi} ${C} ${C})">` +
    // finial: a short bronze kite pointing outwards
    `<path d="M100 -1.6 L105 7.4 L100 10 L95 7.4Z" fill="#0b0705" stroke="#0b0705" stroke-width="2.6" stroke-linejoin="round"/>` +
    `<path d="M100 -1.6 L105 7.4 L100 10 L95 7.4Z" fill="url(#${id})"/>` +
    // barrel: the band that wraps the rope, pointed side tips
    `<path d="M86.4 14 L88.6 8.6 C94 6.6 106 6.6 111.4 8.6 L113.6 14 L111.4 19.4 C106 21.4 94 21.4 88.6 19.4Z" fill="#0b0705" stroke="#0b0705" stroke-width="2.8" stroke-linejoin="round"/>` +
    `<path d="M86.4 14 L88.6 8.6 C94 6.6 106 6.6 111.4 8.6 L113.6 14 L111.4 19.4 C106 21.4 94 21.4 88.6 19.4Z" fill="url(#${id})"/>` +
    // ribs
    `<path d="M93.4 7.7V20.3M106.6 7.7V20.3" stroke="#1d0d04" stroke-width="1.4" opacity=".95"/><path d="M94.4 7.8V20.2M107.6 7.8V20.2" stroke="#ffe7b0" stroke-width=".5" opacity=".55"/>` +
    // upper-left sheen of the band
    `<path d="M89.8 9.4C95 7.9 105 7.9 110.2 9.4" fill="none" stroke="#fff3d0" stroke-width=".9" opacity=".6"/>` +
    // jewel
    `<circle cx="100" cy="14" r="3.5" fill="#0b0705"/><circle cx="100" cy="14" r="2.7" fill="url(#${id}j)"/>` +
    `<circle cx="99.1" cy="13" r=".8" fill="#fffdf2" opacity=".9"/>` +
    `</g>`
  );
}

let ringCache: string | null = null;

/** Inner markup of the minimap ring SVG (viewBox 0 0 200 200); built once, ~35 KB. */
export function ringMarkup(): string {
  if (ringCache) return ringCache;
  const TAU = Math.PI * 2;
  const full = (sign: 1 | -1): string => strandPath(sign, 0, TAU, WAVES * STEPS);
  const A = full(1);
  const B = full(-1);
  const halfWave = Math.PI / WAVES;
  // crossings j = 0..2*WAVES-1 at theta = j * halfWave (sin(WAVES * theta) = 0): the strand in front alternates
  const frontPieces = (sign: 1 | -1): { outline: string; body: string; shine: string } => {
    let outline = '';
    let body = '';
    let shine = '';
    for (let j = 0; j < 2 * WAVES; j++) {
      if ((j % 2 === 0) !== (sign === 1)) continue;
      const th = j * halfWave;
      const d = strandPath(sign, th - halfWave * 0.3, th + halfWave * 0.3, 5);
      outline += `<path d="${d}"/>`;
      body += `<path d="${d}"/>`;
      shine += `<path d="${d}"/>`;
    }
    return { outline, body, shine };
  };
  const fb = frontPieces(-1);
  const rail = (r: number): string => `<circle cx="${C}" cy="${C}" r="${r}"/>`;
  ringCache =
    `<defs>` +
    `<linearGradient id="zm-pew" gradientUnits="userSpaceOnUse" x1="28" y1="22" x2="176" y2="180"><stop offset="0" stop-color="#d9d1c0"/><stop offset=".22" stop-color="#a39b8a"/><stop offset=".5" stop-color="#625b4f"/><stop offset=".78" stop-color="#34302a"/><stop offset="1" stop-color="#1b1815"/></linearGradient>` +
    `<linearGradient id="zm-pew2" gradientUnits="userSpaceOnUse" x1="26" y1="24" x2="178" y2="178"><stop offset="0" stop-color="#b8ad97"/><stop offset=".4" stop-color="#6c6253"/><stop offset=".75" stop-color="#352f26"/><stop offset="1" stop-color="#1c1813"/></linearGradient>` +
    `<linearGradient id="zm-bz" gradientUnits="userSpaceOnUse" x1="30" y1="24" x2="174" y2="178"><stop offset="0" stop-color="#ffe0a4"/><stop offset=".3" stop-color="#d79b50"/><stop offset=".62" stop-color="#8b5726"/><stop offset="1" stop-color="#38200a"/></linearGradient>` +
    `<linearGradient id="zm-rail" gradientUnits="userSpaceOnUse" x1="28" y1="22" x2="176" y2="180"><stop offset="0" stop-color="#b09b78"/><stop offset=".45" stop-color="#5e5242"/><stop offset="1" stop-color="#1c1712"/></linearGradient>` +
    `</defs>` +
    // everything sits on a soft contact shadow so the ring lifts off the map
    `<circle cx="${C}" cy="${C}" r="${RC}" fill="none" stroke="#000" stroke-opacity=".5" stroke-width="22"/>` +
    // rails (bevelled thin rings) on both sides of the rope
    `<g fill="none"><g stroke="#0b0806" stroke-width="3.6">${rail(RC - 8.7)}${rail(RC + 8.7)}</g><g stroke="url(#zm-rail)" stroke-width="2">${rail(RC - 8.7)}${rail(RC + 8.7)}</g><g stroke="#ffe9bd" stroke-opacity=".3" stroke-width=".5" transform="translate(-.45 -.55)">${rail(RC - 8.7)}${rail(RC + 8.7)}</g></g>` +
    // rope: outlines, bodies and sheen of both strands, then the pieces where the second strand crosses over
    `<g fill="none" stroke-linejoin="round" stroke-linecap="round">` +
    `<g stroke="#0b0806" stroke-width="${f(STRAND_W + 1.9)}"><path d="${B}"/><path d="${A}"/></g>` +
    `<g stroke="url(#zm-pew2)" stroke-width="${STRAND_W}"><path d="${B}"/></g>` +
    `<g stroke="url(#zm-pew)" stroke-width="${STRAND_W}"><path d="${A}"/></g>` +
    `<g stroke="#fff6e2" stroke-opacity=".34" stroke-width="1.05" transform="translate(-.85 -.95)"><path d="${B}"/><path d="${A}"/></g>` +
    `<g stroke="#0b0806" stroke-width="${f(STRAND_W + 1.9)}">${fb.outline}</g>` +
    `<g stroke="url(#zm-pew2)" stroke-width="${STRAND_W}">${fb.body}</g>` +
    `<g stroke="#fff6e2" stroke-opacity=".34" stroke-width="1.05" transform="translate(-.85 -.95)">${fb.shine}</g>` +
    `</g>` +
    // outer rim hairline
    `<circle cx="${C}" cy="${C}" r="${RC + 10.4}" fill="none" stroke="#0b0806" stroke-opacity=".85" stroke-width=".9"/>` +
    cuff(0) +
    cuff(90) +
    cuff(180) +
    cuff(270);
  return ringCache;
}

// --------------------------------------------------------------------------------------------------------- pip symbols

/** 5-point style star as a path (pointed lotus spokes); `n` points, outer / inner radius */
function starPath(cx: number, cy: number, n: number, ro: number, ri: number, a0 = -Math.PI / 2): string {
  let d = '';
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? ro : ri;
    const a = a0 + (i * Math.PI) / n;
    d += `${i ? 'L' : 'M'}${f(cx + r * Math.cos(a))} ${f(cy + r * Math.sin(a))}`;
  }
  return `${d}Z`;
}

const SKULL = 'M16 6.6c-4.4 0-7.4 3-7.4 7 0 2.4 1.1 4.2 2.7 5.3v2.3c0 .9.7 1.6 1.6 1.6h6.2c.9 0 1.6-.7 1.6-1.6v-2.3c1.6-1.1 2.7-2.9 2.7-5.3 0-4-3-7-7.4-7ZM12.7 11.6a2 2.3 0 1 0 0 4.6 2 2.3 0 0 0 0-4.6Zm6.6 0a2 2.3 0 1 0 0 4.6 2 2.3 0 0 0 0-4.6ZM16 16.6l1.3 2.3h-2.6Z';

/** Shared defs of every pip + the cap-button glyph gradients (injected once through kitDefs('zm', ...)). */
export const PIP_DEFS =
  // paints
  `<linearGradient id="zm-g-gold" x1="0" y1="0" x2=".6" y2="1"><stop offset="0" stop-color="#fff6d2"/><stop offset=".3" stop-color="#f3cc6c"/><stop offset=".68" stop-color="#b57d26"/><stop offset="1" stop-color="#5a380d"/></linearGradient>` +
  `<linearGradient id="zm-g-crim" x1="0" y1="0" x2=".5" y2="1"><stop offset="0" stop-color="#ff9a80"/><stop offset=".3" stop-color="#d63a2a"/><stop offset=".7" stop-color="#8a1812"/><stop offset="1" stop-color="#3c0807"/></linearGradient>` +
  `<linearGradient id="zm-g-jade" x1="0" y1="0" x2=".5" y2="1"><stop offset="0" stop-color="#eafff3"/><stop offset=".3" stop-color="#8fe0b2"/><stop offset=".7" stop-color="#3a9a6c"/><stop offset="1" stop-color="#143e2c"/></linearGradient>` +
  `<linearGradient id="zm-g-bone" x1="0" y1="0" x2=".4" y2="1"><stop offset="0" stop-color="#fffaf0"/><stop offset=".5" stop-color="#e6d8b8"/><stop offset="1" stop-color="#9a8560"/></linearGradient>` +
  `<linearGradient id="zm-g-obsA" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8c6a78"/><stop offset="1" stop-color="#241320"/></linearGradient>` +
  `<linearGradient id="zm-g-obsB" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3e2430"/><stop offset="1" stop-color="#0a050b"/></linearGradient>` +
  `<linearGradient id="zm-g-obsC" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c4a0a4"/><stop offset="1" stop-color="#47303a"/></linearGradient>` +
  `<linearGradient id="zm-g-lava" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#ff4a10"/><stop offset=".5" stop-color="#ffa63a"/><stop offset="1" stop-color="#fff3b8"/></linearGradient>` +
  `<radialGradient id="zm-g-glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffb347" stop-opacity=".85"/><stop offset=".55" stop-color="#ff6a1a" stop-opacity=".3"/><stop offset="1" stop-color="#ff5a1a" stop-opacity="0"/></radialGradient>` +
  `<radialGradient id="zm-g-dome" cx=".36" cy=".3" r=".75"><stop offset="0" stop-color="#fffbe6"/><stop offset=".3" stop-color="#f1c667"/><stop offset=".72" stop-color="#9a6422"/><stop offset="1" stop-color="#3a1f08"/></radialGradient>` +
  `<linearGradient id="zm-g-wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b98650"/><stop offset=".55" stop-color="#7a4d26"/><stop offset="1" stop-color="#432610"/></linearGradient>` +
  // hero: faceted gold arrowhead pointing north
  `<g id="zm-p-hero"><path d="M16 2.2 27.2 28.4 16 22.6 4.8 28.4Z" fill="#0b0705" stroke="#0b0705" stroke-width="3" stroke-linejoin="round"/><path d="M16 2.2 27.2 28.4 16 22.6 4.8 28.4Z" fill="url(#zm-g-gold)"/><path d="M16 2.2 16 22.6 4.8 28.4Z" fill="#fff" opacity=".3"/><path d="M16 22.6 27.2 28.4 16 2.2Z" fill="#000" opacity=".16"/></g>` +
  // ally: smaller jade chevron
  `<g id="zm-p-ally"><path d="M16 5 24.8 26.4 16 21.8 7.2 26.4Z" fill="#06120c" stroke="#06120c" stroke-width="3" stroke-linejoin="round"/><path d="M16 5 24.8 26.4 16 21.8 7.2 26.4Z" fill="url(#zm-g-jade)"/><path d="M16 5 16 21.8 7.2 26.4Z" fill="#fff" opacity=".3"/></g>` +
  // metin: faceted obsidian crystal with a lava seam
  `<g id="zm-p-metin"><circle cx="16" cy="16" r="15" fill="url(#zm-g-glow)"/><path d="M16 1.8 25.4 9.6 23.2 26.2 16 30.6 8.8 26.2 6.6 9.6Z" fill="#0a0507" stroke="#0a0507" stroke-width="2.4" stroke-linejoin="round"/><path d="M16 3 24.4 9.8 16 14.6 7.6 9.8Z" fill="url(#zm-g-obsC)"/><path d="M7.6 9.8 16 14.6 14.6 29.4 9.4 25.8Z" fill="url(#zm-g-obsA)"/><path d="M16 14.6 24.4 9.8 22.6 25.8 14.6 29.4Z" fill="url(#zm-g-obsB)"/><path d="M16 3.4 17.6 9.4 16 14.6 14.2 21 14.8 29" fill="none" stroke="url(#zm-g-lava)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></g>` +
  // boss: crimson hex badge, gold rim, bone skull
  `<g id="zm-p-boss"><path d="M16 1.8 27.6 8.5V23.5L16 30.2 4.4 23.5V8.5Z" fill="#0b0504" stroke="#0b0504" stroke-width="2.6" stroke-linejoin="round"/><path d="M16 1.8 27.6 8.5V23.5L16 30.2 4.4 23.5V8.5Z" fill="url(#zm-g-gold)"/><path d="M16 4.6 25.2 9.9V22.1L16 27.4 6.8 22.1V9.9Z" fill="url(#zm-g-crim)" stroke="#2a0805" stroke-width=".8"/><path d="${SKULL}" fill="url(#zm-g-bone)" fill-rule="evenodd" stroke="#2a0805" stroke-width="1.1" stroke-linejoin="round" paint-order="stroke"/></g>` +
  // chest: iron-banded wooden chest with a brass lock
  `<g id="zm-p-chest"><path d="M4.4 12.6C4.4 8.6 9.2 5.6 16 5.6s11.6 3 11.6 7V25a1.4 1.4 0 0 1-1.4 1.4H5.8A1.4 1.4 0 0 1 4.4 25Z" fill="#0b0705" stroke="#0b0705" stroke-width="2.6" stroke-linejoin="round"/><path d="M4.4 12.6C4.4 8.6 9.2 5.6 16 5.6s11.6 3 11.6 7V25a1.4 1.4 0 0 1-1.4 1.4H5.8A1.4 1.4 0 0 1 4.4 25Z" fill="url(#zm-g-wood)"/><path d="M4.4 14.6H27.6" stroke="#1a0e06" stroke-width="1.3"/><path d="M9.6 7.2V26.4M22.4 7.2V26.4" stroke="#6a655c" stroke-width="2.2"/><path d="M9.6 7.2V26.4M22.4 7.2V26.4" stroke="#d6cfc0" stroke-width=".6" opacity=".6" transform="translate(-.5 0)"/><rect x="13.4" y="12.6" width="5.2" height="6.4" rx="1" fill="url(#zm-g-gold)" stroke="#1a0e06" stroke-width=".9"/><circle cx="16" cy="15.2" r="1" fill="#1a0e06"/></g>` +
  // start: a planted banner (anchor = foot of the pole, bottom centre)
  `<g id="zm-p-start"><ellipse cx="16" cy="28.6" rx="6" ry="2" fill="#000" opacity=".5"/><path d="M15.2 3.4V28.6" stroke="#0b0705" stroke-width="3.4" stroke-linecap="round"/><path d="M15.2 3.4V28.6" stroke="url(#zm-g-gold)" stroke-width="1.8" stroke-linecap="round"/><path d="M16.2 4.2C20.6 2.8 24 6.4 28.6 5 27.6 8.6 27.6 11.4 28.6 15 24 16.4 20.6 12.8 16.2 14.2Z" fill="#0b0504" stroke="#0b0504" stroke-width="2.2" stroke-linejoin="round"/><path d="M16.2 4.2C20.6 2.8 24 6.4 28.6 5 27.6 8.6 27.6 11.4 28.6 15 24 16.4 20.6 12.8 16.2 14.2Z" fill="url(#zm-g-crim)"/><circle cx="15.2" cy="3.2" r="2.1" fill="url(#zm-g-dome)" stroke="#1a0e06" stroke-width=".7"/></g>` +
  // heart: the site of the final battle: a gold ring with eight stone spokes, flat on the ground
  `<g id="zm-p-heart"><circle cx="16" cy="16" r="14" fill="#000" opacity=".28"/><path d="${starPath(16, 16, 8, 14.6, 8.6)}" fill="#0b0705" stroke="#0b0705" stroke-width="2.2" stroke-linejoin="round"/><path d="${starPath(16, 16, 8, 14.6, 8.6)}" fill="url(#zm-g-gold)"/><circle cx="16" cy="16" r="7.4" fill="#120a06" stroke="#0b0705" stroke-width="1.2"/><circle cx="16" cy="16" r="5.4" fill="url(#zm-g-crim)" stroke="#f3cc6c" stroke-width="1"/><circle cx="14.4" cy="14.2" r="1.5" fill="#fff" opacity=".45"/></g>` +
  // arena: a crimson ring with four notches
  `<g id="zm-p-arena"><circle cx="16" cy="16" r="11.6" fill="#000" fill-opacity=".25" stroke="#0b0504" stroke-width="5"/><circle cx="16" cy="16" r="11.6" fill="none" stroke="url(#zm-g-crim)" stroke-width="3"/><path d="M16 2.2V8M16 24V29.8M2.2 16H8M24 16H29.8" stroke="#0b0504" stroke-width="3.6" stroke-linecap="round"/><path d="M16 2.2V8M16 24V29.8M2.2 16H8M24 16H29.8" stroke="url(#zm-g-gold)" stroke-width="1.7" stroke-linecap="round"/></g>` +
  // poi: a small pewter diamond
  `<g id="zm-p-poi"><path d="M16 6.4 24.6 16 16 25.6 7.4 16Z" fill="#0b0705" stroke="#0b0705" stroke-width="2.6" stroke-linejoin="round"/><path d="M16 6.4 24.6 16 16 25.6 7.4 16Z" fill="#a89f8e"/><path d="M16 6.4 16 25.6 7.4 16Z" fill="#fff" opacity=".4"/><path d="M16 6.4 24.6 16 16 25.6Z" fill="#000" opacity=".22"/></g>` +
  // rim marker: a gem badge (kind colour in --zm-rim) with a pointer on its right (the component rotates it outwards)
  `<g id="zm-p-rim"><path d="M30.6 16 22.2 9.4V22.6Z" fill="#0b0504" stroke="#0b0504" stroke-width="2.4" stroke-linejoin="round"/><path d="M30.6 16 22.2 9.4V22.6Z" fill="url(#zm-g-gold)"/><circle cx="14.6" cy="16" r="11.6" fill="#0b0504"/><circle cx="14.6" cy="16" r="10.2" fill="url(#zm-g-gold)"/><circle cx="14.6" cy="16" r="7.6" fill="var(--zm-rim, #7a1a12)" stroke="#1a0a06" stroke-width=".9"/><ellipse cx="12.4" cy="12.6" rx="4.4" ry="2.5" fill="#fff" opacity=".34" transform="rotate(-24 12.4 12.6)"/><circle cx="14.6" cy="16" r="7.6" fill="none" stroke="#000" stroke-opacity=".35" stroke-width="1.2" stroke-dasharray="0 0"/></g>`;

// ----------------------------------------------------------------------------------------------------- compass rose

let roseCache: string | null = null;

/** Atlas compass rose (viewBox 0 0 100 100): pewter ring, eight pointed spokes (cardinal ones long), north in crimson. */
export function roseMarkup(): string {
  if (roseCache) return roseCache;
  const spokes = (rLong: number, rShort: number, w: number): string => {
    let d = '';
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4 - Math.PI / 2;
      const r = i % 2 === 0 ? rLong : rShort;
      const p = (rr: number, aa: number): string => `${f(50 + rr * Math.cos(aa))} ${f(50 + rr * Math.sin(aa))}`;
      d += `M${p(r, a)}L${p(w, a + 0.5)}L${p(5, a)}L${p(w, a - 0.5)}Z`;
    }
    return d;
  };
  roseCache =
    `<defs><linearGradient id="zm-rose-pew" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e9e1d1"/><stop offset=".45" stop-color="#8f8676"/><stop offset="1" stop-color="#2f2a24"/></linearGradient>` +
    `<linearGradient id="zm-rose-gold" x1="0" y1="0" x2=".6" y2="1"><stop offset="0" stop-color="#fff0c0"/><stop offset=".4" stop-color="#e2b65c"/><stop offset="1" stop-color="#7a4d16"/></linearGradient></defs>` +
    `<circle cx="50" cy="50" r="47" fill="#14110e" fill-opacity=".86" stroke="#0b0806" stroke-width="2.4"/>` +
    `<circle cx="50" cy="50" r="45" fill="none" stroke="url(#zm-rose-pew)" stroke-width="3.2"/>` +
    `<circle cx="50" cy="50" r="37.5" fill="none" stroke="#0b0806" stroke-opacity=".8" stroke-width="1"/>` +
    `<circle cx="50" cy="50" r="37" fill="none" stroke="#c9a45a" stroke-opacity=".5" stroke-width=".7" stroke-dasharray="1.2 3.1"/>` +
    `<path d="${spokes(33, 22, 9)}" fill="#0b0806" stroke="#0b0806" stroke-width="3" stroke-linejoin="round"/>` +
    `<path d="${spokes(33, 22, 9)}" fill="url(#zm-rose-gold)"/>` +
    `<path d="M50 17 56 44 50 50 44 44Z" fill="#c42a1e"/><path d="M50 17 50 50 44 44Z" fill="#ff8a70" opacity=".6"/>` +
    `<circle cx="50" cy="50" r="4.2" fill="#0b0806"/><circle cx="50" cy="50" r="3" fill="url(#zm-rose-gold)"/>`;
  return roseCache;
}

// ------------------------------------------------------------------------------------------------- medallion glyphs

/** 16-unit glyphs drawn in currentColor (the medallion paints them cream with a dark drop): atlas, close, plus, minus */
export const MEDAL_GLYPH = {
  atlas: '<path d="M2.2 4.2 5.8 3.2 10.2 4.8 13.8 3.6V12.2L10.2 13.4 5.8 11.8 2.2 12.8Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M5.8 3.4V11.6M10.2 4.9V13.2" stroke="currentColor" stroke-width="1.2"/>',
  close: '<path d="M3.6 3.6 12.4 12.4M12.4 3.6 3.6 12.4" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/>',
  plus: '<path d="M8 3.2V12.8M3.2 8H12.8" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/>',
  minus: '<path d="M3.2 8H12.8" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/>',
} as const;
