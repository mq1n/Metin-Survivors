// Engraved icon kit (C11): stat gem tiles, grade medallions, currency objects, engraved UI symbols and HUD edge arrows.
// Hand-authored multi-colour inline SVG on our own geometry (48-unit boxes): gradients, bevel, rim, gloss and a lighting
// relief filter for the metal symbols. Gradients and filters live once in a shared hidden <svg> (kitDefs), so every


import type { ComponentChildren, JSX } from 'preact';

// ------------------------------------------------------------------------------------------------------ shared defs

const HAS_DOM = typeof document !== 'undefined';
const DEFS_ID = 'ms-kit-defs';
const registered = new Set<string>();

/** Adds `markup` (gradients / filters / clip paths) to the shared hidden defs <svg> once per key. */
export function kitDefs(key: string, markup: string): void {
  if (!HAS_DOM) return;
  let svg: Element | null = document.getElementById(DEFS_ID);
  if (!svg) {
    registered.clear();
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    el.id = DEFS_ID;
    el.setAttribute('aria-hidden', 'true');
    el.setAttribute('focusable', 'false');
    el.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none');
    el.innerHTML = '<defs></defs>';
    (document.body ?? document.documentElement).appendChild(el);
    svg = el;
  }
  if (registered.has(key)) return;
  svg.querySelector('defs')?.insertAdjacentHTML('beforeend', markup);
  registered.add(key);
}

const lin = (id: string, stops: [number, string, number?][], x2 = 0.55, y2 = 1, x1 = 0, y1 = 0): string =>
  `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a !== undefined ? ` stop-opacity="${a}"` : ''}/>`).join('')}</linearGradient>`;
const rad = (id: string, stops: [number, string, number?][], cx = 0.5, cy = 0.5, r = 0.5): string =>
  `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${stops.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a !== undefined ? ` stop-opacity="${a}"` : ''}/>`).join('')}</radialGradient>`;

function ensureDefs(): void {
  kitDefs(
    'core',
    // metal tones (top-left light)
    lin('ms-k-gold', [[0, '#fff6d2'], [0.3, '#f3cc6c'], [0.66, '#b98128'], [1, '#5e3d10']]) +
      lin('ms-k-pewter', [[0, '#fbf5ea'], [0.32, '#c9bfae'], [0.68, '#857866'], [1, '#453a2f']]) +
      lin('ms-k-bronze', [[0, '#ffe0b0'], [0.3, '#d29a5a'], [0.68, '#8a5426'], [1, '#43240c']]) +
      lin('ms-k-crimson', [[0, '#ffd2c0'], [0.28, '#ec6a4c'], [0.66, '#a8281c'], [1, '#4a0c08']]) +
      lin('ms-k-jade', [[0, '#e8fff2'], [0.3, '#8fdcb4'], [0.68, '#3f9a72'], [1, '#1a4a36']]) +
      lin('ms-k-ivory', [[0, '#ffffff'], [0.35, '#f1e6c8'], [0.72, '#c2ab80'], [1, '#6e5a3c']]) +
      rad('ms-k-sheen', [[0, '#fff', 0.5], [0.45, '#fff', 0.08], [1, '#fff', 0]], 0.3, 0.22, 0.75) +
      // relief: blurred alpha as a height field, diffuse + specular light from the top-left
      `<filter id="ms-k-relief" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">` +
      `<feGaussianBlur in="SourceAlpha" stdDeviation="1.1" result="b"/>` +
      `<feDiffuseLighting in="b" surfaceScale="2.2" diffuseConstant="1.05" lighting-color="#fff" result="d"><feDistantLight azimuth="225" elevation="55"/></feDiffuseLighting>` +
      `<feSpecularLighting in="b" surfaceScale="2.2" specularConstant=".5" specularExponent="22" lighting-color="#fff4d8" result="s"><feDistantLight azimuth="225" elevation="40"/></feSpecularLighting>` +
      `<feComposite in="s" in2="SourceAlpha" operator="in" result="s2"/>` +
      `<feComposite in="SourceGraphic" in2="d" operator="arithmetic" k1="1.15" k2="0" k3="0" k4="0" result="lit"/>` +
      `<feComposite in="lit" in2="s2" operator="arithmetic" k1="0" k2="1" k3=".7" k4="0" result="lit2"/>` +
      `<feComposite in="lit2" in2="SourceAlpha" operator="in"/></filter>` +
      // gem tiles
      lin('ms-k-gem-o', [[0, '#ffd590'], [0.35, '#f29234'], [0.72, '#b8460f'], [1, '#5e1904']], 0.8, 1, 0.2, 0) +
      lin('ms-k-gem-u', [[0, '#c9eeff'], [0.35, '#55aef0'], [0.72, '#1f5cad'], [1, '#0a2252']], 0.8, 1, 0.2, 0) +
      lin('ms-k-gem-s', [[0, '#dcf8ae'], [0.35, '#74c94f'], [0.72, '#2c7d2e'], [1, '#0d3513']], 0.8, 1, 0.2, 0) +
      lin('ms-k-bezel', [[0, '#f6e2b4'], [0.45, '#a07a48'], [1, '#3a2410']], 1, 1) +
      lin('ms-k-gloss', [[0, '#fff', 0.7], [1, '#fff', 0]], 0, 1) +
      rad('ms-k-gemglow', [[0, '#fff', 0.32], [0.6, '#fff', 0.06], [1, '#fff', 0]], 0.5, 0.42, 0.55) +
      lin('ms-k-glyph', [[0, '#ffffff'], [0.55, '#fff2d6'], [1, '#e6c494']], 0, 1) +
      // currency objects
      lin('ms-k-brass', [[0, '#fff2bc'], [0.3, '#f4c454'], [0.7, '#b47a1d'], [1, '#5c380a']], 0.6, 1) +
      lin('ms-k-brass-edge', [[0, '#6e4510'], [0.35, '#e0a63a'], [0.6, '#8a5a14'], [1, '#4a2c06']], 1, 0) +
      lin('ms-k-obs-a', [[0, '#7a5a66'], [1, '#1a0e14']], 1, 1) +
      lin('ms-k-obs-b', [[0, '#3a222c'], [1, '#08040a']], 0, 1, 1, 0) +
      lin('ms-k-obs-c', [[0, '#b08a8e'], [1, '#3a222a']], 0, 1) +
      lin('ms-k-lava', [[0, '#ff4a10'], [0.5, '#ffa63a'], [1, '#fff3b8']], 1, 0, 0, 1) +
      rad('ms-k-lavaglow', [[0, '#ffb347', 0.95], [0.5, '#ff6a1a', 0.35], [1, '#ff5a1a', 0]]) +
      lin('ms-k-bone', [[0, '#fffaf0'], [0.4, '#eadcbc'], [0.78, '#a89068'], [1, '#5a4a30']], 0.5, 1) +
      lin('ms-k-glass', [[0, '#ffffff', 0.5], [0.5, '#d8ecff', 0.18], [1, '#9ec4e8', 0.3]], 1, 0) +
      lin('ms-k-sand', [[0, '#ffe7a0'], [0.5, '#f0a83a'], [1, '#a8601a']], 0, 1) +
      rad('ms-k-pearl', [[0, '#fffbe8'], [0.25, '#ffe08a'], [0.62, '#f0962a'], [0.9, '#9a4a10'], [1, '#5a2606']], 0.38, 0.34, 0.68) +
      // medals
      lin('ms-k-en-n', [[0, '#5c5650'], [1, '#1c1916']], 0.4, 1) +
      lin('ms-k-en-m', [[0, '#3fae80'], [1, '#0c3a26']], 0.4, 1) +
      lin('ms-k-en-g', [[0, '#4a7ee0'], [1, '#0c1e56']], 0.4, 1) +
      lin('ms-k-en-p', [[0, '#e8442c'], [1, '#4a0806']], 0.4, 1) +
      // edge-arrow plates
      lin('ms-k-lacquer', [[0, '#e86a52'], [0.35, '#b42a1c'], [1, '#3c0806']], 0.5, 1) +
      lin('ms-k-obsplate', [[0, '#4a3a40'], [0.4, '#1e1418'], [1, '#08050a']], 0.5, 1),
  );
}

// ------------------------------------------------------------------------------------------------- geometry helpers

const n2 = (v: number): string => (Math.round(v * 100) / 100).toString();
type Pt = readonly [number, number];

export function poly(pts: readonly Pt[]): string {
  return `M${pts.map(([x, y]) => `${n2(x)} ${n2(y)}`).join('L')}Z`;
}
/** Circle subpath; `ccw` reverses the winding (a hole under the nonzero rule). */
export function circle(cx: number, cy: number, r: number, ccw = false): string {
  const s = ccw ? 0 : 1;
  return `M${n2(cx + r)} ${n2(cy)}A${n2(r)} ${n2(r)} 0 1 ${s} ${n2(cx - r)} ${n2(cy)}A${n2(r)} ${n2(r)} 0 1 ${s} ${n2(cx + r)} ${n2(cy)}Z`;
}
export function ring(cx: number, cy: number, ro: number, ri: number): string {
  return circle(cx, cy, ro) + circle(cx, cy, ri, true);
}
export function rot(pts: readonly Pt[], deg: number, cx = 24, cy = 24): Pt[] {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return pts.map(([x, y]) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c] as const);
}
export function star(cx: number, cy: number, n: number, ro: number | readonly number[], ri: number, start = -Math.PI / 2): string {
  const pts: Pt[] = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? ri : typeof ro === 'number' ? ro : (ro[(i / 2) % ro.length] ?? 10);
    const a = start + (i * Math.PI) / n;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return poly(pts);
}
export function gear(cx: number, cy: number, ro: number, ri: number, n: number, hole: number, rot0 = 0): string {
  let d = '';
  const step = (Math.PI * 2) / n;
  for (let i = 0; i < n; i++) {
    const a = rot0 + i * step;
    const pts: [number, number][] = [
      [a - step * 0.5, ri],
      [a - step * 0.25, ri],
      [a - step * 0.15, ro],
      [a + step * 0.15, ro],
      [a + step * 0.25, ri],
      [a + step * 0.5, ri],
    ];
    pts.forEach(([aa, r], k) => {
      d += `${i === 0 && k === 0 ? 'M' : 'L'}${n2(cx + Math.cos(aa) * r)} ${n2(cy + Math.sin(aa) * r)}`;
    });
  }
  return `${d}Z${hole > 0 ? circle(cx, cy, hole, true) : ''}`;
}
/** Annular band from angle a0 to a1 (radians, clockwise on screen). */
export function arcBand(cx: number, cy: number, ri: number, ro: number, a0: number, a1: number): string {
  const p = (r: number, a: number): string => `${n2(cx + Math.cos(a) * r)} ${n2(cy + Math.sin(a) * r)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${p(ro, a0)}A${n2(ro)} ${n2(ro)} 0 ${large} 1 ${p(ro, a1)}L${p(ri, a1)}A${n2(ri)} ${n2(ri)} 0 ${large} 0 ${p(ri, a0)}Z`;
}
/** X as one outline (no inner seams): arms on the diagonals, half-width h, reach L, pointed tips. */
export function xCross(cx: number, cy: number, L: number, h: number, tip: number): string {
  const s = Math.SQRT1_2;
  const out: Pt[] = [];
  const dirs: Pt[] = [
    [1, -1],
    [1, 1],
    [-1, 1],
    [-1, -1],
  ];
  const inner: Pt[] = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ];
  for (let i = 0; i < 4; i++) {
    const [ix, iy] = inner[i] ?? [0, 0];
    out.push([cx + ix * h * Math.SQRT2, cy + iy * h * Math.SQRT2]);
    const [dx, dy] = dirs[i] ?? [1, 1];
    const ux = dx * s;
    const uy = dy * s;
    const px = -uy;
    const py = ux;
    const ex = cx + ux * L;
    const ey = cy + uy * L;
    out.push([ex + px * h, ey + py * h]);
    out.push([ex + ux * tip, ey + uy * tip]);
    out.push([ex - px * h, ey - py * h]);
  }
  return poly(out);
}

/** Geometry = one path, or several parts (each may be transformed / evenodd). */
export interface GeoPart {
  d: string;
  t?: string;
  evenodd?: boolean;
}
export type Geo = string | readonly GeoPart[];

function paths(geo: Geo, attrs: JSX.SVGAttributes<SVGPathElement>, evenodd = false): ComponentChildren {
  if (typeof geo === 'string') return <path d={geo} fill-rule={evenodd ? 'evenodd' : 'nonzero'} {...attrs} />;
  return geo.map((p, i) => <path key={i} d={p.d} {...(p.t ? { transform: p.t } : {})} fill-rule={p.evenodd ? 'evenodd' : 'nonzero'} {...attrs} />);
}

// -------------------------------------------------------------------------------------------------------- stat tiles

export type StatId =
  | 'damage'
  | 'critChance'
  | 'critDamage'
  | 'attackSpeed'
  | 'area'
  | 'projectiles'
  | 'projSpeed'
  | 'pierce'
  | 'vsBoss'
  | 'dps'
  | 'duration'
  | 'cooldown'
  | 'moveSpeed'
  | 'pickupRadius'
  | 'luck'
  | 'xpGain'
  | 'yeopGain'
  | 'level'
  | 'maxHp'
  | 'regen'
  | 'lifesteal'
  | 'armor'
  | 'evasion'
  | 'thorns'
  | 'revives'
  | 'resist';

/** orange = offence, blue = utility, green = sustain / defence */
export type StatFamily = 'offence' | 'utility' | 'sustain';

export const STAT_FAMILY: Record<StatId, StatFamily> = {
  damage: 'offence',
  critChance: 'offence',
  critDamage: 'offence',
  attackSpeed: 'offence',
  area: 'offence',
  projectiles: 'offence',
  projSpeed: 'offence',
  pierce: 'offence',
  vsBoss: 'offence',
  dps: 'offence',
  duration: 'utility',
  cooldown: 'utility',
  moveSpeed: 'utility',
  pickupRadius: 'utility',
  luck: 'utility',
  xpGain: 'utility',
  yeopGain: 'utility',
  level: 'utility',
  maxHp: 'sustain',
  regen: 'sustain',
  lifesteal: 'sustain',
  armor: 'sustain',
  evasion: 'sustain',
  thorns: 'sustain',
  revives: 'sustain',
  resist: 'sustain',
};

/** StatMods key / UI stat id → StatIcon id (aliases used by the screens). */
export const STAT_ALIAS: Record<string, StatId> = {
  hp: 'maxHp',
  maxHpPct: 'maxHp',
  crit: 'critChance',
  critDmg: 'critDamage',
  speed: 'moveSpeed',
  count: 'projectiles',
  xp: 'xpGain',
  yeop: 'yeopGain',
  range: 'area',
  tick: 'attackSpeed',
  vsRace: 'vsBoss',
  heal: 'regen',
};

const SWORD_V: Pt[] = [
  [22.6, 5.5],
  [25.4, 5.5],
  [26.7, 8.8],
  [26.7, 28.6],
  [32.4, 28.6],
  [32.4, 32],
  [26.3, 32],
  [26.3, 37],
  [27.8, 38.6],
  [24, 42.6],
  [20.2, 38.6],
  [21.7, 37],
  [21.7, 32],
  [15.6, 32],
  [15.6, 28.6],
  [21.3, 28.6],
  [21.3, 8.8],
];
const DAGGER_V: Pt[] = [
  [24, 6.5],
  [27, 11],
  [27, 25.5],
  [31.5, 25.5],
  [31.5, 28.5],
  [26, 28.5],
  [26, 33.5],
  [27.2, 35],
  [24, 38.2],
  [20.8, 35],
  [22, 33.5],
  [22, 28.5],
  [16.5, 28.5],
  [16.5, 25.5],
  [21, 25.5],
  [21, 11],
];
const arrowUp = (len: number, head: number, shaft: number, cx = 24, tipY = 6): Pt[] => [
  [cx, tipY],
  [cx + head / 2, tipY + head * 0.95],
  [cx + shaft / 2, tipY + head * 0.75],
  [cx + shaft / 2, tipY + len],
  [cx - shaft / 2, tipY + len],
  [cx - shaft / 2, tipY + head * 0.75],
  [cx - head / 2, tipY + head * 0.95],
];
const HEART = 'M24 39.5C14.6 32.3 9 26.8 9 19.6A8.4 8.4 0 0 1 17.4 11.2C20.2 11.2 22.5 12.6 24 14.9 25.5 12.6 27.8 11.2 30.6 11.2A8.4 8.4 0 0 1 39 19.6C39 26.8 33.4 32.3 24 39.5Z';
const SHIELD = 'M24 7 37.5 11.6V22.6C37.5 31 31.8 37.4 24 40.8 16.2 37.4 10.5 31 10.5 22.6V11.6Z';
const SHIELD_IN = 'M24 11.2 33.8 14.5V22.6C33.8 28.6 29.9 33.4 24 36.4 18.1 33.4 14.2 28.6 14.2 22.6V14.5Z';
const LEAF = 'M24 24C21.4 21.6 17.4 19.6 15.3 16.6 13.4 13.8 14.6 10.2 17.8 9.6 20.4 9.1 22.6 10.8 23.2 13.2 23.6 15.6 23.8 19.2 24 24Z';

const STAT_GEO: Record<StatId, Geo> = {
  damage: poly(rot(SWORD_V, 45)),
  critChance: [{ d: ring(24, 24, 13.2, 10.2) }, { d: poly([[22.7, 6.6], [25.3, 6.6], [25.3, 12.2], [22.7, 12.2]]) + poly([[22.7, 35.8], [25.3, 35.8], [25.3, 41.4], [22.7, 41.4]]) + poly([[6.6, 22.7], [12.2, 22.7], [12.2, 25.3], [6.6, 25.3]]) + poly([[35.8, 22.7], [41.4, 22.7], [41.4, 25.3], [35.8, 25.3]]) }, { d: star(24, 24, 4, 9.4, 2.6) }],
  critDamage: star(24, 24.5, 9, [16, 12.5, 15, 11.8, 16.5, 12.2, 14.6, 13, 15.6], 6.4, -Math.PI / 2 + 0.18),
  attackSpeed: [
    { d: poly(rot(DAGGER_V, 32, 24, 22)) },
    { d: arcBand(29, 27, 13.4, 15.8, Math.PI * 0.62, Math.PI * 1.02) },
    { d: arcBand(29, 27, 17.6, 19.8, Math.PI * 0.66, Math.PI * 0.98) },
  ],
  area: [
    { d: ring(24, 24, 11.6, 9.4) },
    { d: ring(24, 24, 6.6, 4.6) },
    { d: circle(24, 24, 2.6) },
    ...[45, 135, 225, 315].map((deg) => ({ d: poly(rot([[24, 5.6], [28.4, 11.4], [19.6, 11.4]], deg)) })),
  ],
  projectiles: [-24, 0, 24].map((deg) => ({ d: poly(rot(arrowUp(30, 8.4, 2.6, 24, 7), deg, 24, 41)) })),
  projSpeed: [
    { d: poly(rot([[41, 24], [32.6, 17.6], [33.4, 22.4], [15.5, 22.4], [15.5, 25.6], [33.4, 25.6], [32.6, 30.4]], -24)) },
    { d: poly(rot([[7, 15.6], [16, 15.6], [16, 18.4], [7, 18.4]], -24)) },
    { d: poly(rot([[5, 22.6], [12.5, 22.6], [12.5, 25.4], [5, 25.4]], -24)) },
    { d: poly(rot([[9, 29.6], [16, 29.6], [16, 32.4], [9, 32.4]], -24)) },
  ],
  pierce: [
    { d: poly([[20.5, 8.5], [27.5, 8.5], [27.5, 20.4], [20.5, 20.4]]) + poly([[20.5, 27.6], [27.5, 27.6], [27.5, 39.5], [20.5, 39.5]]) },
    { d: poly([[43, 24], [34.6, 17.8], [35.4, 22.6], [6, 22.6], [6, 25.4], [35.4, 25.4], [34.6, 30.2]]) },
    { d: poly([[6, 22.6], [3.5, 19.4], [9.6, 19.4], [11.4, 22.6]]) + poly([[6, 25.4], [11.4, 25.4], [9.6, 28.6], [3.5, 28.6]]) },
  ],
  vsBoss: [
    { d: 'M24 13C17.4 13 13.4 17.4 13.4 23.2c0 3.6 1.8 6.1 4 7.6v4.3c0 1.1.8 1.9 1.9 1.9h1.4v-3.2h2.1V37h2.4v-3.2h2.1V37h1.4c1.1 0 1.9-.8 1.9-1.9v-4.3c2.2-1.5 4-4 4-7.6C34.6 17.4 30.6 13 24 13ZM19.5 21.4a2.9 3.2 0 1 1 0 6.4 2.9 3.2 0 0 1 0-6.4Zm9 0a2.9 3.2 0 1 1 0 6.4 2.9 3.2 0 0 1 0-6.4ZM24 28.3l1.8 3.1h-3.6Z', evenodd: true },
    { d: 'M15.6 16.6C11.6 14.4 9.6 10.6 10 5.5 12.2 9.2 14.8 11 18.6 12.6Z' },
    { d: 'M32.4 16.6C36.4 14.4 38.4 10.6 38 5.5 35.8 9.2 33.2 11 29.4 12.6Z' },
  ],
  dps: 'M27.6 5.5 13 26.4H22.2L19.6 42.5 34.8 20.8H25.4Z',
  duration: 'M13 7.5H35V11H32.6C32.6 16.9 29.6 20.3 26.8 24 29.6 27.7 32.6 31.1 32.6 37H35V40.5H13V37H15.4C15.4 31.1 18.4 27.7 21.2 24 18.4 20.3 15.4 16.9 15.4 11H13ZM19 11C19 15.3 21.2 18.1 24 21.6 26.8 18.1 29 15.3 29 11ZM24 28.6C21.5 31.5 19.6 33.9 19.3 37H28.7C28.4 33.9 26.5 31.5 24 28.6Z',
  cooldown: [
    { d: arcBand(24, 24, 10.8, 13.8, -Math.PI * 0.3, Math.PI * 1.42) },
    { d: poly([[31.2, 8.4], [37.6, 13.4], [29.4, 15.6]]) },
    { d: poly([[22.6, 14.5], [25.4, 14.5], [25.4, 23.4], [30.6, 27], [29, 29.3], [22.6, 25]]) },
  ],
  moveSpeed: [
    { d: 'M20.5 9.5H29.5V25.2C29.5 26.4 30.2 27.2 31.4 27.6L37.6 29.6C39.2 30.1 40 31.4 40 33V37.5H16V32.4C16 30.6 17.2 29.2 18.8 28.8L20.5 28.3Z' },
    { d: 'M19.6 12.5C14.6 12.6 10.2 14.4 7 17.8 10.8 17 14.8 17.2 19.6 18.2Z' },
    { d: 'M19.6 19.4C15.4 19.6 11.8 21 8.8 23.6 12.2 23.2 15.8 23.6 19.6 24.6Z' },
    { d: 'M19.6 25.6C16.2 25.9 13.6 27 11.4 28.8 14 28.8 16.6 29.2 19.6 30.2Z' },
  ],
  pickupRadius: [
    { d: 'M11.5 13.5H19.5V25.5A4.5 4.5 0 0 0 28.5 25.5V13.5H36.5V25.5A12.5 12.5 0 0 1 11.5 25.5Z' },
    { d: poly([[11.5, 6.5], [19.5, 6.5], [19.5, 11.6], [11.5, 11.6]]) + poly([[28.5, 6.5], [36.5, 6.5], [36.5, 11.6], [28.5, 11.6]]) },
  ],
  luck: [
    { d: LEAF },
    { d: LEAF, t: 'rotate(90 24 24)' },
    { d: LEAF, t: 'rotate(180 24 24)' },
    { d: LEAF, t: 'rotate(270 24 24)' },
    { d: 'M24.8 25.6C27.4 30.4 31.4 34.4 36.6 37.4L35.2 39.6C29.6 36.4 25.4 32 22.6 26.8Z' },
  ],
  xpGain: [{ d: star(24, 17.5, 5, 11.2, 4.8) }, { d: poly([[10.5, 39.5], [24, 29.5], [37.5, 39.5], [37.5, 43.6], [24, 33.6], [10.5, 43.6]]) }],
  yeopGain: [
    { d: circle(21, 27, 12.4) + poly([[17.9, 23.9], [17.9, 30.1], [24.1, 30.1], [24.1, 23.9]]) },
    { d: poly([[34.2, 6], [37.8, 6], [37.8, 10.6], [42.4, 10.6], [42.4, 14.2], [37.8, 14.2], [37.8, 18.8], [34.2, 18.8], [34.2, 14.2], [29.6, 14.2], [29.6, 10.6], [34.2, 10.6]]) },
  ],
  level: [
    { d: poly([[10.5, 30], [24, 20], [37.5, 30], [37.5, 35.4], [24, 25.4], [10.5, 35.4]]) },
    { d: poly([[10.5, 39.4], [24, 29.4], [37.5, 39.4], [37.5, 44], [24, 34], [10.5, 44]]) },
    { d: star(24, 11, 4, 7, 2.4) },
  ],
  maxHp: HEART,
  regen: [{ d: HEART + poly([[22.2, 16.4], [22.2, 21.4], [17.2, 21.4], [17.2, 25.2], [22.2, 25.2], [22.2, 30.2], [25.8, 30.2], [25.8, 25.2], [30.8, 25.2], [30.8, 21.4], [25.8, 21.4], [25.8, 16.4]]), evenodd: true }],
  lifesteal: [
    { d: 'M24 17.5C28.6 23.4 33 28.2 33 33.2A9 9 0 0 1 15 33.2C15 28.2 19.4 23.4 24 17.5Z' },
    { d: 'M13.2 6.5H21.4L17.3 16.8Z' },
    { d: 'M26.6 6.5H34.8L30.7 16.8Z' },
  ],
  armor: [{ d: SHIELD + SHIELD_IN + circle(24, 23.6, 3.6), evenodd: true }],
  evasion: [
    { d: 'M37.5 7.5C29 7.8 20.8 13.6 16.6 23.6L13.2 36.6 15.6 37.4 20.4 30.4C30 27.2 36 19 37.5 7.5Z' },
    { d: poly([[10.4, 41.4], [14.8, 33.6], [17, 34.6], [12.6, 42.4]]) },
  ],
  thorns: [
    { d: SHIELD },
    ...(
      [
        [8.8, 10],
        [39.2, 10],
        [6.5, 23],
        [41.5, 23],
        [13, 36],
        [35, 36],
      ] as const
    ).map(([x, y]) => ({ d: poly(rot([[x, y - 4.6], [x + 2.6, y + 1.4], [x - 2.6, y + 1.4]], x < 24 ? -40 : 40, x, y)) })),
  ],
  revives: [
    { d: 'M24 6C25.3 11.6 31 14.6 31 21A7 7 0 0 1 17 21C17 18 18.6 16.2 19.8 14.6 20.2 16.4 21.2 17.4 22.2 17.6 21.6 13.4 22.4 9.4 24 6Z' },
    { d: 'M24 41.5C20 39.6 17.6 35.4 18.2 30.2 21 31.2 23 33 24 35.6 25 33 27 31.2 29.8 30.2 30.4 35.4 28 39.6 24 41.5Z' },
    { d: 'M17.2 41C12.2 40.2 8.6 36.8 7.6 31.6 11.2 31.6 14.4 33.2 16.6 36Z' },
    { d: 'M30.8 41C35.8 40.2 39.4 36.8 40.4 31.6 36.8 31.6 33.6 33.2 31.4 36Z' },
  ],
  resist: [{ d: SHIELD + SHIELD_IN + poly([[24, 15.6], [30, 23], [24, 30.4], [18, 23]]), evenodd: true }],
};

const FAMILY_FILL: Record<StatFamily, string> = { offence: 'ms-k-gem-o', utility: 'ms-k-gem-u', sustain: 'ms-k-gem-s' };

const tile = (inset: number): string => {
  const a = 3 + inset;
  const b = 45 - inset;
  const c = 8 - inset * 0.6;
  return `M${n2(a + c)} ${n2(a)}H${n2(b - c)}L${n2(b)} ${n2(a + c)}V${n2(b - c)}L${n2(b - c)} ${n2(b)}H${n2(a + c)}L${n2(a)} ${n2(b - c)}V${n2(a + c)}Z`;
};
const TILE0 = tile(0);
const TILE_BEZEL = tile(1.2);
const TILE_SEAT = tile(3.4);
const TILE_BODY = tile(4.2);
const TILE_GLOSS = 'M12.68 7.2H35.32L40.8 12.68V20.4C32 16.9 16 16.9 7.2 20.4V12.68Z';

export interface StatIconProps {
  /** stat id (StatMods key or alias, see STAT_ALIAS) */
  stat: StatId | string;
  /** CSS size (default 1.6em) */
  size?: string;
  /** colour family override */
  family?: StatFamily;
  title?: string;
  class?: string;
  /** greyed (locked / zero) */
  dim?: boolean;
}

function resolveStat(stat: string): StatId {
  return (stat in STAT_GEO ? stat : (STAT_ALIAS[stat] ?? 'damage')) as StatId;
}

/** Glossy gem tile with an engraved cream pictogram (orange offence / blue utility / green sustain). */
export function StatIcon({ stat, size, family, title, class: cls = '', dim }: StatIconProps): JSX.Element {
  ensureDefs();
  const id = resolveStat(stat);
  const fam = family ?? STAT_FAMILY[id];
  const geo = STAT_GEO[id];
  return (
    <span class={`ms-kicon ms-kicon--stat ms-kicon--${fam}${dim ? ' is-dim' : ''} ${cls}`} style={size ? { width: size, height: size } : undefined} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : 'true'}>
      <svg viewBox="0 0 48 48">
        <path d={TILE0} fill="#000" opacity=".6" transform="translate(.8 1.4)" />
        <path d={TILE0} fill="#0a0705" />
        <path d={TILE_BEZEL} fill="url(#ms-k-bezel)" />
        <path d={TILE_SEAT} fill="#1a0e06" />
        <path d={TILE_BODY} fill={`url(#${FAMILY_FILL[fam]})`} />
        <path d={TILE_BODY} fill="url(#ms-k-gemglow)" />
        <path d={TILE_GLOSS} fill="url(#ms-k-gloss)" opacity=".7" />
        <path d="M12.5 38.2H35.5" stroke="#fff" stroke-opacity=".22" stroke-width=".9" stroke-linecap="round" />
        <g fill="#2a1406" opacity=".7" transform="translate(.7 1)">
          {paths(geo, {})}
        </g>
        <g fill="none" stroke="#2a1406" stroke-width="2.1" stroke-linejoin="round">
          {paths(geo, {})}
        </g>
        <g fill="url(#ms-k-glyph)">{paths(geo, {})}</g>
      </svg>
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------- grade medals

/** Skill rank band: n = ranks 1-3, m = M1-M2, g = G1-G2, p = P */
export type Grade = 'n' | 'm' | 'g' | 'p';

/** Rank index 0..7 (1, 2, 3, M1, M2, G1, G2, P) → band + level within the band. */
export function rankToGrade(rank: number): { grade: Grade; level: number } {
  const r = Math.max(0, Math.min(7, Math.round(rank)));
  if (r <= 2) return { grade: 'n', level: r + 1 };
  if (r <= 4) return { grade: 'm', level: r - 2 };
  if (r <= 6) return { grade: 'g', level: r - 4 };
  return { grade: 'p', level: 1 };
}

const GRADE_RIM: Record<Grade, string> = { n: 'ms-k-pewter', m: 'ms-k-bronze', g: 'ms-k-gold', p: 'ms-k-gold' };
const GRADE_LETTER: Record<Grade, string> = { n: '', m: 'M', g: 'G', p: 'P' };

export interface GradeIconProps {
  grade?: Grade;
  /** level inside the band (n: 1-3 numeral; m / g: 1-2 pips) */
  level?: number;
  /** or a rank index 0..7 (wins over grade / level) */
  rank?: number;
  size?: string;
  title?: string;
  class?: string;
}

/** Engraved grade medallion: pewter numeral (1-3), bronze-jade M, gold-blue G, radiant gold-crimson P. */
export function GradeIcon({ grade = 'n', level = 1, rank, size, title, class: cls = '' }: GradeIconProps): JSX.Element {
  ensureDefs();
  const g = rank !== undefined ? rankToGrade(rank) : { grade, level };
  const letter = g.grade === 'n' ? String(Math.max(1, Math.min(3, g.level))) : GRADE_LETTER[g.grade];
  const pips = g.grade === 'm' || g.grade === 'g' ? Math.max(1, Math.min(2, g.level)) : 0;
  return (
    <span class={`ms-kicon ms-kicon--grade ms-kicon--g-${g.grade} ${cls}`} style={size ? { width: size, height: size } : undefined} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : 'true'}>
      <svg viewBox="0 0 48 48">
        {g.grade === 'p' && (
          <g>
            <path d={star(24, 24, 12, 23.4, 18.6, -Math.PI / 2)} fill="#1a0d04" transform="translate(.6 1)" />
            <path d={star(24, 24, 12, 23.4, 18.6, -Math.PI / 2)} fill="url(#ms-k-gold)" stroke="#2a1606" stroke-width=".9" stroke-linejoin="round" />
          </g>
        )}
        <circle cx="24.6" cy="25.2" r="19.6" fill="#000" opacity=".55" />
        <circle cx="24" cy="24" r="19.6" fill="#0d0805" />
        <circle cx="24" cy="24" r="18.6" fill={`url(#${GRADE_RIM[g.grade]})`} />
        <circle cx="24" cy="24" r="14.6" fill="#140a05" />
        <circle cx="24" cy="24" r="13.8" fill={`url(#ms-k-en-${g.grade})`} />
        <path d="M11.4 21.6A12.8 12.8 0 0 1 36.6 21.6C30 18.4 18 18.4 11.4 21.6Z" fill="#fff" opacity=".22" />
        {g.grade === 'g' && [0, 1, 2, 3, 4, 5, 6, 7].map((i) => <circle key={i} cx={n2(24 + Math.cos((i * Math.PI) / 4 + Math.PI / 8) * 16.6)} cy={n2(24 + Math.sin((i * Math.PI) / 4 + Math.PI / 8) * 16.6)} r="1.15" fill="#fff3c8" stroke="#6a4410" stroke-width=".5" />)}
        {g.grade === 'm' && [0, 1, 2, 3].map((i) => <circle key={i} cx={n2(24 + Math.cos((i * Math.PI) / 2 + Math.PI / 4) * 16.6)} cy={n2(24 + Math.sin((i * Math.PI) / 2 + Math.PI / 4) * 16.6)} r="1.2" fill="#ffe2b8" stroke="#4a2a0c" stroke-width=".5" />)}
        <text x="24" y={pips ? '29.4' : '31.2'} text-anchor="middle" font-family="Cinzel, 'Palatino Linotype', Georgia, serif" font-weight="900" font-size={g.grade === 'n' ? '19' : '18'} fill="#170c05" opacity=".8" transform="translate(.6 .9)">
          {letter}
        </text>
        <text x="24" y={pips ? '29.4' : '31.2'} text-anchor="middle" font-family="Cinzel, 'Palatino Linotype', Georgia, serif" font-weight="900" font-size={g.grade === 'n' ? '19' : '18'} fill="url(#ms-k-ivory)" stroke="#1a0d05" stroke-width="1.1" paint-order="stroke" stroke-linejoin="round">
          {letter}
        </text>
        {pips > 0 && (pips === 1 ? [24] : [21.2, 26.8]).map((cx) => <circle key={cx} cx={cx} cy="34.2" r="1.7" fill="url(#ms-k-gold)" stroke="#2a1606" stroke-width=".6" />)}
      </svg>
    </span>
  );
}

// --------------------------------------------------------------------------------------------------------- currency

export type CurrencyKind = 'yeop' | 'shard' | 'kills' | 'time' | 'xp';

function coinEdge(cx: number, cy: number, rx: number, ry: number, th: number): JSX.Element {
  return (
    <g>
      <path d={`M${cx - rx} ${cy}v${th}a${rx} ${ry} 0 0 0 ${2 * rx} 0v${-th}Z`} fill="url(#ms-k-brass-edge)" stroke="#3a2205" stroke-width=".7" />
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="url(#ms-k-brass)" stroke="#4a2c06" stroke-width=".8" />
      <ellipse cx={cx} cy={cy} rx={rx * 0.7} ry={ry * 0.7} fill="none" stroke="#8a5a14" stroke-width=".9" />
      <path d={`M${cx - 2.7} ${cy - 1.15}h5.4v2.3h-5.4Z`} fill="#2a1604" />
    </g>
  );
}

const CURRENCY: Record<CurrencyKind, () => JSX.Element> = {
  // a stack of brass cash coins (square holes) with one coin standing in front
  yeop: () => (
    <g>
      <ellipse cx="26" cy="41.6" rx="17" ry="3.8" fill="#000" opacity=".5" />
      {coinEdge(30, 35, 13, 5, 3.4)}
      {coinEdge(29, 30.4, 13, 5, 3.4)}
      {coinEdge(30.6, 25.8, 13, 5, 3.4)}
      <g transform="rotate(-14 17 24)">
        <circle cx="17.2" cy="24.4" r="12.4" fill="#2e1a04" />
        <circle cx="16.4" cy="23.4" r="11.8" fill="url(#ms-k-brass)" />
        <circle cx="16.4" cy="23.4" r="11.8" fill="none" stroke="#4a2c06" stroke-width=".9" />
        <circle cx="16.4" cy="23.4" r="8.6" fill="none" stroke="#8a5a14" stroke-width="1.5" />
        <circle cx="15.9" cy="22.9" r="8.6" fill="none" stroke="#fff0c0" stroke-width=".6" opacity=".6" />
        <path d="M13.1 20.1h6.6v6.6h-6.6Z" fill="#1c0f03" />
        <path d="M13.1 26.7h6.6V20.1" fill="none" stroke="#ffe7a0" stroke-width=".9" />
        <path d="M16.4 15.6v2.2M16.4 29v2.2M8.6 23.4h2.2M22 23.4h2.2" stroke="#7a4c10" stroke-width="1.5" stroke-linecap="round" />
        <path d="M7.4 18.2A10.4 10.4 0 0 1 13.6 12.2" fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round" opacity=".7" />
      </g>
    </g>
  ),
  // obsidian shard with molten veins and a heat glow
  shard: () => (
    <g>
      <ellipse cx="25" cy="42.4" rx="11" ry="2.8" fill="#000" opacity=".45" />
      <circle cx="26" cy="23" r="19" fill="url(#ms-k-lavaglow)" opacity=".7" />
      <path d="M31 3.5 41 15.4 35 37.8 22.2 44.4 12 35.8 14.6 18.8Z" fill="#0a0507" />
      <path d="M30.8 5.4 39.2 15.6 26.8 21.6 15.8 19.4Z" fill="url(#ms-k-obs-c)" />
      <path d="M15.8 19.4 26.8 21.6 22.8 42.6 13.4 35.2Z" fill="url(#ms-k-obs-a)" />
      <path d="M26.8 21.6 39.2 15.6 33.8 36.8 22.8 42.6Z" fill="url(#ms-k-obs-b)" />
      <path d="M30.6 7 28.6 13.8 26.8 21.6 24.9 30.4 22.8 42.6" fill="none" stroke="#ff7a24" stroke-width="3.4" opacity=".4" stroke-linecap="round" />
      <path d="M30.6 7 28.6 13.8 26.8 21.6 24.9 30.4 22.8 42.6" fill="none" stroke="url(#ms-k-lava)" stroke-width="1.5" stroke-linecap="round" />
      <path d="M16.4 20.4 21.2 25.4 19.4 31.6M37.2 18 32.2 25 34 30.8M26.8 21.6 32.6 19.2" fill="none" stroke="url(#ms-k-lava)" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M30.8 5.4 39.2 15.6M30.8 5.4 15.8 19.4" stroke="#fff" stroke-opacity=".6" stroke-width=".9" />
      <path d="M17.2 23.5 15.2 33.4" stroke="#fff" stroke-opacity=".25" stroke-width="1.4" stroke-linecap="round" />
    </g>
  ),
  // ivory skull with cracks
  kills: () => (
    <g>
      <path d="M24 5C14.5 5 8.5 11.5 8.5 20c0 5.2 2.6 8.8 5.8 11v6.2c0 1.6 1.2 2.8 2.8 2.8H19v-4.6h3V40h4v-4.6h3V40h1.9c1.6 0 2.8-1.2 2.8-2.8V31c3.2-2.2 5.8-5.8 5.8-11C39.5 11.5 33.5 5 24 5Z" fill="#0b0705" transform="translate(.8 1.2)" />
      <path d="M24 5C14.5 5 8.5 11.5 8.5 20c0 5.2 2.6 8.8 5.8 11v6.2c0 1.6 1.2 2.8 2.8 2.8H19v-4.6h3V40h4v-4.6h3V40h1.9c1.6 0 2.8-1.2 2.8-2.8V31c3.2-2.2 5.8-5.8 5.8-11C39.5 11.5 33.5 5 24 5Z" fill="url(#ms-k-bone)" stroke="#1c120a" stroke-width="1.6" stroke-linejoin="round" />
      <path d="M17.3 17.6a4.3 4.7 0 1 1 0 9.4 4.3 4.7 0 0 1 0-9.4Zm13.4 0a4.3 4.7 0 1 1 0 9.4 4.3 4.7 0 0 1 0-9.4ZM24 28.2l2.6 4.6h-5.2Z" fill="#1a0f08" />
      <circle cx="17.6" cy="22.6" r="1.4" fill="#ff8a3a" opacity=".85" />
      <circle cx="30.4" cy="22.6" r="1.4" fill="#ff8a3a" opacity=".85" />
      <path d="M24 5.4 25.2 9.6 23 12.6M33.6 10 30.8 12.2" fill="none" stroke="#5a4428" stroke-width=".9" stroke-linecap="round" />
      <path d="M12.6 14.4C14.6 10.2 18.4 7.6 23 7.2" fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round" opacity=".7" />
    </g>
  ),
  // bronze hourglass with amber sand
  time: () => (
    <g>
      <path d="M12.6 5.5H35.4V9.6H12.6ZM12.6 38.4H35.4V42.5H12.6Z" fill="#0b0705" transform="translate(.8 1.1)" />
      <path d="M15.8 9.6C15.8 17 19.8 20.4 22.6 24 19.8 27.6 15.8 31 15.8 38.4H32.2C32.2 31 28.2 27.6 25.4 24 28.2 20.4 32.2 17 32.2 9.6Z" fill="url(#ms-k-glass)" stroke="#2a1a0c" stroke-width="1.2" />
      <path d="M18.6 13.4H29.4C28.8 16.6 26.6 18.8 24 21.4 21.4 18.8 19.2 16.6 18.6 13.4Z" fill="url(#ms-k-sand)" />
      <path d="M23.4 21.4h1.2v10h-1.2Z" fill="#f4b04a" />
      <path d="M17.6 37.6C18.4 33.6 20.8 31 24 30.6 27.2 31 29.6 33.6 30.4 37.6Z" fill="url(#ms-k-sand)" />
      <path d="M17.6 11.4C17.8 15.6 19.6 18.4 21.8 20.8" fill="none" stroke="#fff" stroke-width="1" stroke-linecap="round" opacity=".55" />
      <path d="M11.8 5H36.2V9.8H11.8ZM11.8 38.2H36.2V43H11.8Z" fill="url(#ms-k-bronze)" stroke="#2a1606" stroke-width="1" />
      <path d="M13.4 9.8h2.6v28.4h-2.6ZM32 9.8h2.6v28.4H32Z" fill="url(#ms-k-bronze)" stroke="#2a1606" stroke-width=".8" />
      <path d="M12.6 6.4H35.4" stroke="#fff3d0" stroke-width=".8" opacity=".7" />
    </g>
  ),
  // amber dragon pearl in a gold prong cradle, an engraved cloud-scroll inside, one sparkle
  xp: () => (
    <g>
      <ellipse cx="24.5" cy="43.4" rx="12" ry="2.5" fill="#000" opacity=".45" />
      <circle cx="24" cy="21.5" r="20" fill="url(#ms-k-lavaglow)" opacity=".42" />
      <circle cx="24.4" cy="22.4" r="14.8" fill="#1a0a02" />
      <circle cx="24" cy="21.6" r="14.2" fill="url(#ms-k-pearl)" />
      <path d="M24 21.6c0-3.6 4.6-4.4 5.8-1.4 1.5 3.4-1.9 6.8-6.1 6.3-5.7-.7-7.8-6.9-4.6-11 2.6-3.4 7.6-3.6 10.4-.8" fill="none" stroke="#9a4208" stroke-width="1.7" stroke-linecap="round" opacity=".62" />
      <path d="M24 21.6c0-3.6 4.6-4.4 5.8-1.4 1.5 3.4-1.9 6.8-6.1 6.3-5.7-.7-7.8-6.9-4.6-11 2.6-3.4 7.6-3.6 10.4-.8" fill="none" stroke="#ffe9a8" stroke-width=".7" stroke-linecap="round" opacity=".55" transform="translate(-.5 -.6)" />
      <ellipse cx="18.8" cy="15.6" rx="4.8" ry="3" fill="#fff" opacity=".62" transform="rotate(-32 18.8 15.6)" />
      <path d="M13.4 28.2C15.6 33 20.4 35.4 26.2 34.6 21.6 33.2 18.2 30.6 16.8 26.6Z" fill="#fff" opacity=".14" />
      <path d="M13.2 35.8C14 31.6 18.2 30.2 24 30.2S34 31.6 34.8 35.8L32.2 41.6H15.8Z" fill="url(#ms-k-gold)" stroke="#2a1606" stroke-width="1" stroke-linejoin="round" />
      <path d="M16.6 41.6H31.4" stroke="#2a1606" stroke-width="1.2" />
      <path d="M15.2 36.4H32.8" stroke="#fff3c8" stroke-width=".8" opacity=".6" />
      <path d="M11 30.4C8.8 26.2 9.2 21.6 11.6 18.4 11.6 22.4 13.4 26.4 17.2 29.6Z" fill="url(#ms-k-gold)" stroke="#2a1606" stroke-width=".9" stroke-linejoin="round" />
      <path d="M37 30.4C39.2 26.2 38.8 21.6 36.4 18.4 36.4 22.4 34.6 26.4 30.8 29.6Z" fill="url(#ms-k-gold)" stroke="#2a1606" stroke-width=".9" stroke-linejoin="round" />
      <path d={star(36.4, 9.6, 4, 6.2, 1.3)} fill="#fffbe6" />
    </g>
  ),
};

export interface CurrencyIconProps {
  kind: CurrencyKind;
  /** CSS size (default 1.15em, inline with text) */
  size?: string;
  title?: string;
  class?: string;
}

/** Multi-colour currency / resource object (yeop coin stack, metin shard, kills skull, time hourglass, xp pearl). */
export function CurrencyIcon({ kind, size, title, class: cls = '' }: CurrencyIconProps): JSX.Element {
  ensureDefs();
  const draw = CURRENCY[kind] ?? CURRENCY.yeop;
  return (
    <span class={`ms-kicon ms-kicon--cur ms-kicon--${kind} ${cls}`} style={size ? { width: size, height: size } : undefined} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : 'true'}>
      <svg viewBox="0 0 48 48">{draw()}</svg>
    </span>
  );
}

// ------------------------------------------------------------------------------------------------ engraved UI symbols

export type UiGlyphName =
  | 'close'
  | 'back'
  | 'prev'
  | 'next'
  | 'up'
  | 'down'
  | 'plus'
  | 'minus'
  | 'check'
  | 'pause'
  | 'play'
  | 'gear'
  | 'sound'
  | 'monitor'
  | 'gamepad'
  | 'cloud'
  | 'chest'
  | 'trophy'
  | 'book'
  | 'person'
  | 'swords'
  | 'link'
  | 'heart'
  | 'crown'
  | 'clock'
  | 'skull'
  | 'lock'
  | 'star'
  | 'info'
  | 'warn'
  | 'flame'
  | 'shield';

export type UiTone = 'gold' | 'pewter' | 'bronze' | 'crimson' | 'jade' | 'ivory';

const ARROW_R = 'M44 24C36.5 17.2 28.5 11.6 17.5 9C20.2 13.4 22 17.4 23 21H8.6C7 21 5.6 22.3 5.6 24S7 27 8.6 27H23C22 30.6 20.2 34.6 17.5 39C28.5 36.4 36.5 30.8 44 24Z';
const SWORD_UI: Pt[] = [
  [22.4, 4.5],
  [25.6, 4.5],
  [25.6, 30],
  [31.5, 30],
  [31.5, 33.4],
  [25.8, 33.4],
  [25.8, 38.6],
  [27.2, 40.4],
  [24, 43.6],
  [20.8, 40.4],
  [22.2, 38.6],
  [22.2, 33.4],
  [16.5, 33.4],
  [16.5, 30],
  [22.4, 30],
];

const UI_GEO: Record<UiGlyphName, Geo> = {
  close: xCross(24, 24, 15.2, 3.6, 3.2),
  back: 'M4.5 18.5 17 7V14H29C36.7 14 43 20.3 43 28S36.7 42 29 42H22V35H29C32.9 35 36 31.9 36 28S32.9 21 29 21H17V30Z',
  next: ARROW_R,
  prev: [{ d: ARROW_R, t: 'matrix(-1 0 0 1 48 0)' }],
  up: [{ d: ARROW_R, t: 'rotate(-90 24 24)' }],
  down: [{ d: ARROW_R, t: 'rotate(90 24 24)' }],
  plus: poly([[20.4, 6.5], [27.6, 6.5], [27.6, 20.4], [41.5, 20.4], [41.5, 27.6], [27.6, 27.6], [27.6, 41.5], [20.4, 41.5], [20.4, 27.6], [6.5, 27.6], [6.5, 20.4], [20.4, 20.4]]),
  minus: poly([[6.5, 20.4], [41.5, 20.4], [41.5, 27.6], [6.5, 27.6]]),
  check: poly([[5.5, 25.5], [11, 20], [19.5, 28.5], [37.5, 10.5], [43, 16], [19.5, 39.5]]),
  pause: poly([[10, 7], [19, 7], [20, 8], [20, 40], [19, 41], [10, 41], [9, 40], [9, 8]]) + poly([[29, 7], [38, 7], [39, 8], [39, 40], [38, 41], [29, 41], [28, 40], [28, 8]]),
  play: 'M13 7.5C13 6 14.6 5.1 15.9 5.9L40.6 22.3C41.8 23.1 41.8 24.9 40.6 25.7L15.9 42.1C14.6 42.9 13 42 13 40.5Z',
  gear: [{ d: gear(19.6, 19.6, 15.4, 11.9, 10, 5.1, 0.12) }, { d: gear(35.8, 35.8, 9.2, 6.9, 8, 2.9, 0.25) }],
  sound: [
    { d: 'M17 4.5A2.6 2.6 0 0 1 22.2 4.5V6.2C27 7.2 29.6 11.3 29.6 16.5V27.5C29.6 30 31.2 31.6 33 32.4V35.2H6.2V32.4C8 31.6 9.6 30 9.6 27.5V16.5C9.6 11.3 12.2 7.2 17 6.2Z' },
    { d: circle(19.6, 39.4, 3.2) },
    { d: 'M35.6 14.4C38.4 16.9 39.9 20.1 39.9 23.6S38.4 30.3 35.6 32.8L33.4 30.5C35.4 28.6 36.6 26.2 36.6 23.6S35.4 18.6 33.4 16.7Z' },
    { d: 'M40 9.6C44.1 13.3 46.3 18.3 46.3 23.6S44.1 33.9 40 37.6L37.8 35.3C41.2 32.2 43 28.1 43 23.6S41.2 15 37.8 11.9Z' },
  ],
  monitor: [{ d: 'M6.5 7.5H41.5C43.2 7.5 44.5 8.8 44.5 10.5V31.5C44.5 33.2 43.2 34.5 41.5 34.5H28V38.5H34.5V42H13.5V38.5H20V34.5H6.5C4.8 34.5 3.5 33.2 3.5 31.5V10.5C3.5 8.8 4.8 7.5 6.5 7.5ZM8 12V30H40V12Z', evenodd: true }, { d: `M10.5 28 17.5 18.6 22.4 24.4 28 16.4 37.5 28Z${circle(33.4, 16.4, 2.4)}` }],
  gamepad: [
    {
      d: `M14.5 12.5H33.5C39.5 12.5 43.8 17.2 44.8 23.5L46.2 32.8C46.8 37 43.9 40.3 40.3 40.3C37.9 40.3 36.4 39 35.2 37L33.2 33.5H14.8L12.8 37C11.6 39 10.1 40.3 7.7 40.3C4.1 40.3 1.2 37 1.8 32.8L3.2 23.5C4.2 17.2 8.5 12.5 14.5 12.5ZM11.2 19.6V23.2H7.6V26.8H11.2V30.4H14.8V26.8H18.4V23.2H14.8V19.6Z${circle(34, 21.6, 2.3)}${circle(38.6, 26.4, 2.3)}${circle(29.4, 26.4, 2.3)}${circle(34, 31.2, 2.3)}`,
      evenodd: true,
    },
  ],
  cloud: [
    { d: 'M13 38.5C7.2 38.5 3 34.5 3 29.2C3 24.4 6.6 20.6 11.3 20C12.4 13.4 18 8.6 24.8 8.6C31 8.6 36.2 12.6 37.8 18.4C42 19.4 45 23.1 45 27.6C45 33.6 40.2 38.5 34 38.5Z' },
  ],
  chest: [{ d: 'M6 20C6 13.8 10.4 9.5 16.4 9.5H31.6C37.6 9.5 42 13.8 42 20V22H6ZM6 25H20.5V29.4H27.5V25H42V38.4C42 40 40.8 41.2 39.2 41.2H8.8C7.2 41.2 6 40 6 38.4Z' }, { d: 'M21.8 24.2H26.2V31.6H21.8Z' }],
  trophy: [{ d: 'M12 5.5H36V9.5H43.5V13C43.5 19.6 39.5 24 33.6 25C31.8 28.6 28.7 31 25.6 31.6V36H31.5V39.6H34.5V43H13.5V39.6H16.5V36H22.4V31.6C19.3 31 16.2 28.6 14.4 25C8.5 24 4.5 19.6 4.5 13V9.5H12ZM8.4 13.4C8.6 17 10.4 19.6 13.2 20.8C12.6 18.6 12.2 16 12 13.4ZM39.6 13.4H36C35.8 16 35.4 18.6 34.8 20.8C37.6 19.6 39.4 17 39.6 13.4Z', evenodd: true }],
  book: [{ d: 'M24 12.4C19.4 9 13.2 7.6 5 8V37.5C13.2 37.1 19.4 38.5 24 41.6C28.6 38.5 34.8 37.1 43 37.5V8C34.8 7.6 28.6 9 24 12.4ZM26.4 15C30.4 12.5 34.8 11.4 40 11.3V34.2C34.8 34.2 30.4 35.3 26.4 37.4Z', evenodd: true }],
  person: 'M24 4.2C26.4 4.2 28 5.6 28.3 7.6C31.2 9 33 12 33 15.6C33 20.6 29 24.6 24 24.6S15 20.6 15 15.6C15 12 16.8 9 19.7 7.6C20 5.6 21.6 4.2 24 4.2ZM6 43C6 33.6 13.4 27.2 24 27.2S42 33.6 42 43Z',
  swords: [{ d: poly(rot(SWORD_UI, 42)) }, { d: poly(rot(SWORD_UI, -42)) }],
  link: [
    { d: 'M7.4 31.8A8.6 8.6 0 0 1 7.4 19.6L13.6 13.4A8.6 8.6 0 0 1 25.8 13.4L27.6 15.2 24.4 18.4 22.6 16.6A4.1 4.1 0 0 0 16.8 16.6L10.6 22.8A4.1 4.1 0 0 0 10.6 28.6L12.4 30.4 9.2 33.6Z' },
    { d: 'M40.6 16.2A8.6 8.6 0 0 1 40.6 28.4L34.4 34.6A8.6 8.6 0 0 1 22.2 34.6L20.4 32.8 23.6 29.6 25.4 31.4A4.1 4.1 0 0 0 31.2 31.4L37.4 25.2A4.1 4.1 0 0 0 37.4 19.4L35.6 17.6 38.8 14.4Z' },
    { d: 'M17.2 28.4 28.4 17.2 30.8 19.6 19.6 30.8Z' },
  ],
  heart: 'M24 42C13.5 34 5.5 27.4 5.5 18.4A10.4 10.4 0 0 1 15.9 8C19.4 8 22.2 9.8 24 12.6 25.8 9.8 28.6 8 32.1 8A10.4 10.4 0 0 1 42.5 18.4C42.5 27.4 34.5 34 24 42Z',
  crown: 'M4.5 14.5 14 23 24 7.5 34 23 43.5 14.5 40.2 37H7.8ZM8 39.6H40V43.5H8Z',
  clock: [{ d: ring(24, 24, 19.5, 15.6) }, { d: 'M22.2 10.5H25.8V23.2L33.6 28.1 31.8 31.2 22.2 25.2Z' }, { d: circle(24, 24, 2.6) }],
  skull: [{ d: 'M24 4C14.5 4 8.5 10.5 8.5 19c0 5.2 2.6 8.8 5.8 11v6.2c0 1.6 1.2 2.8 2.8 2.8H19v-4.6h3V39h4v-4.6h3V39h1.9c1.6 0 2.8-1.2 2.8-2.8V30c3.2-2.2 5.8-5.8 5.8-11C39.5 10.5 33.5 4 24 4ZM17.3 16.2a4.2 4.6 0 1 1 0 9.2 4.2 4.6 0 0 1 0-9.2Zm13.4 0a4.2 4.6 0 1 1 0 9.2 4.2 4.6 0 0 1 0-9.2ZM24 26.4l2.6 4.6h-5.2Z', evenodd: true }],
  lock: [{ d: 'M14 20V15.2C14 9.6 18.5 5 24 5S34 9.6 34 15.2V20H36.8C38.4 20 39.6 21.2 39.6 22.8V40.2C39.6 41.8 38.4 43 36.8 43H11.2C9.6 43 8.4 41.8 8.4 40.2V22.8C8.4 21.2 9.6 20 11.2 20ZM18.6 20H29.4V15.2C29.4 12.1 27 9.6 24 9.6S18.6 12.1 18.6 15.2ZM22 27.6V35.4H26V27.6Z', evenodd: true }],
  star: star(24, 25, 5, 20, 8.6),
  info: [{ d: ring(24, 24, 19.5, 15.8) }, { d: circle(24, 14.8, 2.8) }, { d: poly([[21.4, 20], [26.6, 20], [26.6, 35], [21.4, 35]]) }],
  warn: [{ d: 'M24 4.5 45 41.5H3ZM21.6 16.5 22.4 30H25.6L26.4 16.5ZM24 32.5A2.6 2.6 0 1 0 24 37.7 2.6 2.6 0 0 0 24 32.5Z', evenodd: true }],
  flame: 'M25.2 3C26.8 10 35 15.2 35 26.4A11 11 0 0 1 24 37.4 11 11 0 0 1 13 26.4C13 21 16 18 18 15.2 18.8 18 20.4 19.6 22 20 20.6 13.6 22.4 7.4 25.2 3Z',
  shield: 'M24 3.5 40.5 9V22.8C40.5 32.8 33.4 40.6 24 44.6 14.6 40.6 7.5 32.8 7.5 22.8V9Z',
};

export interface UiGlyphProps {
  name: UiGlyphName;
  /** metal tone (default gold; pewter = idle / inactive, the sepia-silver relief) */
  tone?: UiTone;
  /** CSS size (default 1.25em) */
  size?: string;
  /** flat sheen instead of the lighting relief (cheaper; tiny inline sizes) */
  flat?: boolean;
  title?: string;
  class?: string;
}

/** Engraved metal relief symbol (navigation, tabs, status) — replaces the flat permanent-UI glyphs. */
export function UiGlyph({ name, tone = 'gold', size, flat, title, class: cls = '' }: UiGlyphProps): JSX.Element {
  ensureDefs();
  const geo = UI_GEO[name];
  return (
    <span class={`ms-kicon ms-kicon--ui ms-kicon--${tone} ${cls}`} style={size ? { width: size, height: size } : undefined} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : 'true'}>
      <svg viewBox="0 0 48 48">
        <g fill="#0b0705" opacity=".85" transform="translate(.8 1.2)">
          {paths(geo, {})}
        </g>
        <g fill="none" stroke="#0b0705" stroke-width="2.2" stroke-linejoin="round">
          {paths(geo, {})}
        </g>
        <g fill={`url(#ms-k-${tone})`} {...(flat ? {} : { filter: 'url(#ms-k-relief)' })}>
          {paths(geo, {})}
        </g>
        {flat && <g fill="url(#ms-k-sheen)">{paths(geo, {})}</g>}
      </svg>
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------- HUD edge arrows

export interface EdgeArrowProps {
  /** boss = crimson lacquer plate + skull, metin = obsidian plate + glowing shard */
  kind: 'boss' | 'metin';
  /** pointing direction in degrees (0 = right, 90 = down); the emblem stays upright */
  angle?: number;
  /** CSS size (default 2.6rem) */
  size?: string;
  title?: string;
  class?: string;
}

const EDGE_PLATE = 'M46 24 30.5 9.5H8.6C6.6 9.5 5 11.1 5 13.1V34.9C5 36.9 6.6 38.5 8.6 38.5H30.5Z';
const EDGE_INNER = 'M41.6 24 29 12.4H9.8C8.8 12.4 8 13.2 8 14.2V33.8C8 34.8 8.8 35.6 9.8 35.6H29Z';

/** Off-screen pointer for the HUD: an arrow plate (rotated by `angle`) carrying an upright emblem. */
export function EdgeArrow({ kind, angle = 0, size, title, class: cls = '' }: EdgeArrowProps): JSX.Element {
  ensureDefs();
  const boss = kind === 'boss';
  return (
    <span class={`ms-kicon ms-kicon--edge ms-kicon--edge-${kind} ${cls}`} style={size ? { width: size, height: size } : undefined} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : 'true'}>
      <svg viewBox="0 0 48 48">
        <g transform={`rotate(${n2(angle)} 24 24)`}>
          <path d={EDGE_PLATE} fill="#000" opacity=".55" transform="translate(.8 1.4)" />
          <path d={EDGE_PLATE} fill="#0d0805" stroke="#0d0805" stroke-width="2" stroke-linejoin="round" />
          <path d={EDGE_PLATE} fill="url(#ms-k-gold)" />
          <path d={EDGE_INNER} fill={boss ? 'url(#ms-k-lacquer)' : 'url(#ms-k-obsplate)'} stroke="#2a1606" stroke-width=".8" />
          <path d="M9.8 13.6H28.4L33.4 18.2C25 16.4 16.2 16.8 8.6 19.8V14.8C8.6 14.1 9.1 13.6 9.8 13.6Z" fill="#fff" opacity=".2" />
        </g>
        <g transform={`rotate(${n2(angle)} 24 24) translate(-2.6 0) rotate(${n2(-angle)} 24 24)`}>
          {boss ? (
            <g transform="translate(12 12.6) scale(.5)">
              <path d="M24 5C14.5 5 8.5 11.5 8.5 20c0 5.2 2.6 8.8 5.8 11v6.2c0 1.6 1.2 2.8 2.8 2.8H19v-4.6h3V40h4v-4.6h3V40h1.9c1.6 0 2.8-1.2 2.8-2.8V31c3.2-2.2 5.8-5.8 5.8-11C39.5 11.5 33.5 5 24 5ZM17.3 17.6a4.3 4.7 0 1 1 0 9.4 4.3 4.7 0 0 1 0-9.4Zm13.4 0a4.3 4.7 0 1 1 0 9.4 4.3 4.7 0 0 1 0-9.4ZM24 28.2l2.6 4.6h-5.2Z" fill-rule="evenodd" fill="url(#ms-k-bone)" stroke="#1c0a06" stroke-width="2" />
            </g>
          ) : (
            <g transform="translate(11 12) scale(.5)">
              <circle cx="26" cy="23" r="19" fill="url(#ms-k-lavaglow)" />
              <path d="M31 3.5 41 15.4 35 37.8 22.2 44.4 12 35.8 14.6 18.8Z" fill="#0a0507" />
              <path d="M30.8 5.4 39.2 15.6 26.8 21.6 15.8 19.4Z" fill="url(#ms-k-obs-c)" />
              <path d="M15.8 19.4 26.8 21.6 22.8 42.6 13.4 35.2Z" fill="url(#ms-k-obs-a)" />
              <path d="M26.8 21.6 39.2 15.6 33.8 36.8 22.8 42.6Z" fill="url(#ms-k-obs-b)" />
              <path d="M30.6 7 28.6 13.8 26.8 21.6 24.9 30.4 22.8 42.6" fill="none" stroke="url(#ms-k-lava)" stroke-width="2.6" stroke-linecap="round" />
            </g>
          )}
        </g>
      </svg>
    </span>
  );
}

// ----------------------------------------------------------------------------------------------------- caps (key / glyph)

export interface KeyCapProps {
  /** the key name, e.g. "ESC", "E", "1" */
  children: ComponentChildren;
  class?: string;
}

/** Engraved pewter key plate for hotkey hints (ESC, number keys). Text stays HTML (i18n / font friendly); add `ms-kbd-only` to hide it on touch. */
export function KeyCap({ children, class: cls = '' }: KeyCapProps): JSX.Element {
  return <kbd class={`ms-keycap ${cls}`}>{children}</kbd>;
}

export interface GlyphCapProps {
  name: UiGlyphName;
  /** disc diameter (default 2.2rem) */
  size?: string;
  /** metal tone of the symbol (default gold) */
  tone?: UiTone;
  title?: string;
  class?: string;
}

/** Close / back / next cap: an engraved UiGlyph set into a pewter-rimmed black disc (use it as the content of a Button). */
export function GlyphCap({ name, size, tone = 'gold', title, class: cls = '' }: GlyphCapProps): JSX.Element {
  return (
    <span class={`ms-glyphcap ${cls}`} style={size ? { '--cap': size } as JSX.CSSProperties : undefined}>
      <UiGlyph name={name} tone={tone} {...(title ? { title } : {})} />
    </span>
  );
}
