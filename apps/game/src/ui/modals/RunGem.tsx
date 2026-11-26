
// utility, green sustain), drawn in our own geometry with the kit's gem recipe (components/StatIcon.tsx). Stats the kit has
// a tile for (time, level, damage, damage taken, yeop, bosses) delegate to <StatIcon>; the run-only counts (kills, elites,
// metins, chests, victory bonus) are pictograms of our own on the same tile, so the whole grid reads as one set.
import type { JSX } from 'preact';
import { StatIcon, kitDefs, poly, circle, type StatFamily } from '../components/StatIcon';

export type RunStat = 'time' | 'level' | 'kills' | 'elites' | 'bosses' | 'metins' | 'damage' | 'taken' | 'yeop' | 'chests' | 'victory';

/** Kit tile for the stats it has; the rest are drawn here. */
const KIT_STAT: Partial<Record<RunStat, string>> = { time: 'duration', level: 'level', damage: 'damage', taken: 'armor', yeop: 'yeopGain', bosses: 'vsBoss' };

type Geo = readonly { d: string; evenodd?: boolean }[];

const SKULL: Geo = [
  {
    d:
      'M24 8.2C16 8.2 10.4 13.9 10.4 21.4c0 4.4 2 7.5 4.9 9.4v4.6c0 1.4 1.1 2.5 2.5 2.5H20v-3.4h2.6v3.4h2.8v-3.4H28v3.4h2.2c1.4 0 2.5-1.1 2.5-2.5v-4.6c2.9-1.9 4.9-5 4.9-9.4C37.6 13.9 32 8.2 24 8.2Z' +
      'M16.2 21.4a3.5 4 0 1 0 7 0a3.5 4 0 1 0-7 0Z' +
      'M24.8 21.4a3.5 4 0 1 0 7 0a3.5 4 0 1 0-7 0Z' +
      'M24 25l-2.2 4.2h4.4Z',
    evenodd: true,
  },
];
const CROWN: Geo = [{ d: 'M8.4 34.6 6.8 15.2l8.7 8.2L24 11l8.5 12.4 8.7-8.2-1.6 19.4Z' }, { d: 'M8.6 37.4h30.8v3H8.6Z' }, { d: circle(24, 11, 2.3) }, { d: circle(6.8, 14.2, 2) }, { d: circle(41.2, 14.2, 2) }];
const SHARD: Geo = [
  {
    d: poly([[24, 6.4], [34.2, 17.8], [30.2, 41.6], [17.8, 41.6], [13.8, 17.8]]) + poly([[24, 13.4], [20.9, 20.2], [24, 35.6], [27.1, 20.2]]),
    evenodd: true,
  },
  { d: poly([[24, 6.4], [28.6, 11.6], [24 + 0, 12.8], [19.4, 11.6]]) },
];
const CHEST: Geo = [
  { d: 'M9 21.4v-4.2a7 7 0 0 1 7-7h16a7 7 0 0 1 7 7v4.2Z' },
  { d: 'M9 23.8h30v13.8c0 1.5-1.1 2.6-2.6 2.6H11.6C10.1 40.2 9 39.1 9 37.6Z' },
  { d: 'M21 19.6h6v7h-6Z', evenodd: false },
];
const CUP: Geo = [
  {
    d: 'M14 9.4h20v9.4c0 5.6-4.4 9.8-10 9.8s-10-4.2-10-9.8Z' + 'M14 12.4H8.6c0 5 2.4 8.4 6.2 9.6l.6-2.6c-2-1-3.2-3-3.2-5.4H14Z' + 'M34 12.4h5.4c0 5-2.4 8.4-6.2 9.6l-.6-2.6c2-1 3.2-3 3.2-5.4H34Z',
  },
  { d: 'M21.4 28h5.2l.8 6.4h-6.8Z' },
  { d: 'M16 35h16v4.6H16Z' },
];
const TILE: Partial<Record<RunStat, { geo: Geo; fam: StatFamily }>> = {
  kills: { geo: SKULL, fam: 'offence' },
  elites: { geo: CROWN, fam: 'offence' },
  metins: { geo: SHARD, fam: 'utility' },
  chests: { geo: CHEST, fam: 'utility' },
  victory: { geo: CUP, fam: 'offence' },
};

const tile = (inset: number): string => {
  const a = 3 + inset;
  const b = 45 - inset;
  const c = 8 - inset * 0.6;
  const n = (v: number): string => (Math.round(v * 100) / 100).toString();
  return `M${n(a + c)} ${n(a)}H${n(b - c)}L${n(b)} ${n(a + c)}V${n(b - c)}L${n(b - c)} ${n(b)}H${n(a + c)}L${n(a)} ${n(b - c)}V${n(a + c)}Z`;
};
const TILE0 = tile(0);
const TILE_BEZEL = tile(1.2);
const TILE_SEAT = tile(3.4);
const TILE_BODY = tile(4.2);
const TILE_GLOSS = 'M12.68 7.2H35.32L40.8 12.68V20.4C32 16.9 16 16.9 7.2 20.4V12.68Z';
const FILL: Record<StatFamily, string> = { offence: 'ms-re-gem-o', utility: 'ms-re-gem-u', sustain: 'ms-re-gem-s' };

let defsDone = false;
function ensureGemDefs(): void {
  if (defsDone) return;
  defsDone = true;
  const lin = (id: string, stops: [number, string, number?][], x1 = 0.2, y1 = 0, x2 = 0.8, y2 = 1): string =>
    `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a !== undefined ? ` stop-opacity="${a}"` : ''}/>`).join('')}</linearGradient>`;
  kitDefs(
    'runend-gems',
    lin('ms-re-gem-o', [[0, '#ffd590'], [0.35, '#f29234'], [0.72, '#b8460f'], [1, '#5e1904']]) +
      lin('ms-re-gem-u', [[0, '#c9eeff'], [0.35, '#55aef0'], [0.72, '#1f5cad'], [1, '#0a2252']]) +
      lin('ms-re-gem-s', [[0, '#dcf8ae'], [0.35, '#74c94f'], [0.72, '#2c7d2e'], [1, '#0d3513']]) +
      lin('ms-re-bezel', [[0, '#f6e2b4'], [0.45, '#a07a48'], [1, '#3a2410']], 0, 0, 1, 1) +
      lin('ms-re-gloss', [[0, '#fff', 0.7], [1, '#fff', 0]], 0, 0, 0, 1) +
      `<radialGradient id="ms-re-glow" cx=".5" cy=".42" r=".55"><stop offset="0" stop-color="#fff" stop-opacity=".32"/><stop offset=".6" stop-color="#fff" stop-opacity=".06"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>` +
      lin('ms-re-glyph', [[0, '#ffffff'], [0.55, '#fff2d6'], [1, '#e6c494']], 0, 0, 0, 1),
  );
}

export function RunGem({ stat, size, class: cls = '' }: { stat: RunStat; size?: string; class?: string }): JSX.Element {
  const kit = KIT_STAT[stat];
  const style = size ? ({ '--gem': size } as JSX.CSSProperties) : undefined;
  if (kit) {
    return (
      <span class={`ms-re-gem ms-re-gem--kit ${cls}`} style={style} aria-hidden="true">
        <StatIcon stat={kit} />
      </span>
    );
  }
  ensureGemDefs();
  const def = TILE[stat] ?? { geo: SKULL, fam: 'offence' as StatFamily };
  return (
    <span class={`ms-re-gem ${cls}`} style={style} aria-hidden="true">
      <svg viewBox="0 0 48 48">
        <path d={TILE0} fill="#000" opacity=".6" transform="translate(.8 1.4)" />
        <path d={TILE0} fill="#0a0705" />
        <path d={TILE_BEZEL} fill="url(#ms-re-bezel)" />
        <path d={TILE_SEAT} fill="#1a0e06" />
        <path d={TILE_BODY} fill={`url(#${FILL[def.fam]})`} />
        <path d={TILE_BODY} fill="url(#ms-re-glow)" />
        <path d={TILE_GLOSS} fill="url(#ms-re-gloss)" opacity=".7" />
        <path d="M12.5 38.2H35.5" stroke="#fff" stroke-opacity=".22" stroke-width=".9" stroke-linecap="round" />
        <g fill="#2a1406" opacity=".7" transform="translate(.7 1)">
          {def.geo.map((p, i) => (
            <path key={i} d={p.d} fill-rule={p.evenodd ? 'evenodd' : 'nonzero'} />
          ))}
        </g>
        <g fill="none" stroke="#2a1406" stroke-width="2.1" stroke-linejoin="round">
          {def.geo.map((p, i) => (
            <path key={i} d={p.d} fill-rule={p.evenodd ? 'evenodd' : 'nonzero'} />
          ))}
        </g>
        <g fill="url(#ms-re-glyph)">
          {def.geo.map((p, i) => (
            <path key={i} d={p.d} fill-rule={p.evenodd ? 'evenodd' : 'nonzero'} />
          ))}
        </g>
      </svg>
    </span>
  );
}
