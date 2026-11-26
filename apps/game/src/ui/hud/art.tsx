// Hand-drawn HUD illustrations (inline SVG, our own geometry): the four taskbar buttons (damage meter, relics, region map, menu)

// (kills / yeop / shards) that sit in the bronze lens sockets. One shared defs block carries the gradients (userSpaceOnUse in the
// 64 x 64 / 32 x 32 boxes, light from the upper left). A painted raster (uk_hud_btn_<kind>, uk_hud_ico_<kind>) replaces any of
// them the moment the manifest lists it (Taskbar.tsx reads texUrl), so these stay the fallback, never a placeholder.
import type { JSX } from 'preact';

export type BtnKind = 'meter' | 'build' | 'map' | 'menu';
export type CoinKind = 'kills' | 'yeop' | 'shard' | 'dps' | 'relic';

/** One shared defs block (rendered once by the taskbar). Ids are prefixed hb- (hud brass). */
export function HudDefs(): JSX.Element {
  return (
    <svg class="ms-hud-defs" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="hb-ground" cx="0.5" cy="0.4" r="0.78">
          <stop offset="0" stop-color="#5a4630" />
          <stop offset="0.5" stop-color="#2b2016" />
          <stop offset="1" stop-color="#0b0805" />
        </radialGradient>
        <linearGradient id="hb-steel" gradientUnits="userSpaceOnUse" x1="8" y1="6" x2="56" y2="58">
          <stop offset="0" stop-color="#fff1d0" />
          <stop offset="0.3" stop-color="#d9c498" />
          <stop offset="0.62" stop-color="#8f7a55" />
          <stop offset="1" stop-color="#3b2e1c" />
        </linearGradient>
        <linearGradient id="hb-brass" gradientUnits="userSpaceOnUse" x1="10" y1="8" x2="54" y2="56">
          <stop offset="0" stop-color="#ffe9a6" />
          <stop offset="0.35" stop-color="#d8a252" />
          <stop offset="0.7" stop-color="#8a5a24" />
          <stop offset="1" stop-color="#3f230b" />
        </linearGradient>
        <linearGradient id="hb-brass-v" gradientUnits="userSpaceOnUse" x1="0" y1="30" x2="0" y2="60">
          <stop offset="0" stop-color="#f6d98e" />
          <stop offset="0.5" stop-color="#b9833f" />
          <stop offset="1" stop-color="#5a3715" />
        </linearGradient>
        <linearGradient id="hb-parch" gradientUnits="userSpaceOnUse" x1="8" y1="10" x2="56" y2="54">
          <stop offset="0" stop-color="#f7e8c3" />
          <stop offset="0.55" stop-color="#d2b987" />
          <stop offset="1" stop-color="#8d7146" />
        </linearGradient>
        <linearGradient id="hb-roll" gradientUnits="objectBoundingBox" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#6a5232" />
          <stop offset="0.28" stop-color="#f1dfb4" />
          <stop offset="0.62" stop-color="#b79c6a" />
          <stop offset="1" stop-color="#4a3820" />
        </linearGradient>
        <linearGradient id="hb-bone" gradientUnits="userSpaceOnUse" x1="6" y1="4" x2="26" y2="30">
          <stop offset="0" stop-color="#fffbe9" />
          <stop offset="0.5" stop-color="#e0cfa4" />
          <stop offset="1" stop-color="#8f7c55" />
        </linearGradient>
        <linearGradient id="hb-gold" gradientUnits="userSpaceOnUse" x1="5" y1="3" x2="27" y2="29">
          <stop offset="0" stop-color="#fff2b0" />
          <stop offset="0.4" stop-color="#f0b73c" />
          <stop offset="0.78" stop-color="#a8691a" />
          <stop offset="1" stop-color="#5c3208" />
        </linearGradient>
        <linearGradient id="hb-sapph" gradientUnits="userSpaceOnUse" x1="8" y1="6" x2="24" y2="26">
          <stop offset="0" stop-color="#e4f6ff" />
          <stop offset="0.35" stop-color="#58b4ea" />
          <stop offset="0.75" stop-color="#1d5aa8" />
          <stop offset="1" stop-color="#0a2250" />
        </linearGradient>
        <radialGradient id="hb-dome" cx="0.5" cy="0.62" r="0.62">
          <stop offset="0" stop-color="#7a5a32" stop-opacity="0.85" />
          <stop offset="0.55" stop-color="#2f2214" stop-opacity="0.55" />
          <stop offset="1" stop-color="#000" stop-opacity="0" />
        </radialGradient>
        <filter id="hb-grain" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" result="n" />
          <feColorMatrix in="n" values="0 0 0 0 0.05  0 0 0 0 0.03  0 0 0 0 0.01  0 0 0 0.55 -0.12" />
        </filter>
      </defs>
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------------- button pictures

/** Cog outline: `n` teeth between the root radius and the tip radius, trapezoid profile. */
function gear(cx: number, cy: number, rOut: number, rIn: number, n: number): string {
  const step = (Math.PI * 2) / n;
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = i * step - Math.PI / 2;
    const ang = [a - step * 0.27, a - step * 0.15, a + step * 0.15, a + step * 0.27];
    const rad = [rIn, rOut, rOut, rIn];
    for (let k = 0; k < 4; k++) pts.push(`${(cx + Math.cos(ang[k] as number) * (rad[k] as number)).toFixed(2)} ${(cy + Math.sin(ang[k] as number) * (rad[k] as number)).toFixed(2)}`);
  }
  return `M${pts.join(' L')} Z`;
}

const GEAR_BIG = gear(38, 26, 18, 14.2, 10);
const GEAR_SMALL = gear(19, 42, 13, 10.2, 8);

const INK = '#150d06';
const HI = '#fff0cf';

/** A curved sabre in local coordinates: hilt at the origin, tip up (about 46 units). */
function Sabre(): JSX.Element {
  return (
    <g>
      <path d="M-2.8 -3 L-2.6 -27 Q-2.4 -38 4.6 -47 Q3.6 -35 3.2 -27 L3.2 -3 Z" fill="url(#hb-steel)" stroke={INK} stroke-width="1.1" stroke-linejoin="round" />
      <path d="M-1.2 -4 L-1 -27 Q-0.9 -35 2.8 -42" fill="none" stroke={HI} stroke-width="0.9" stroke-linecap="round" opacity="0.8" />
      <path d="M-8.2 -1.4 Q0 -6.6 8.2 -1.4 L7 2.4 Q0 -1.6 -7 2.4 Z" fill="url(#hb-brass)" stroke={INK} stroke-width="1" stroke-linejoin="round" />
      <rect x="-2.3" y="2" width="4.6" height="12" rx="1.2" fill="#3a2914" stroke={INK} stroke-width="0.9" />
      <path d="M-2.3 5.2 L2.3 4 M-2.3 8.2 L2.3 7 M-2.3 11.2 L2.3 10" stroke="#bf9a5a" stroke-width="0.9" />
      <circle cx="0" cy="16.4" r="3" fill="url(#hb-brass)" stroke={INK} stroke-width="1" />
      <circle cx="-0.8" cy="15.6" r="0.9" fill={HI} opacity="0.85" />
    </g>
  );
}

function MeterArt(): JSX.Element {
  return (
    <>
      {[0, 1, 2, 3].map((i) => {
        const h = 6 + i * 4.2;
        return (
          <g key={i}>
            <rect x={19 + i * 7.2} y={58 - h} width="5.4" height={h} fill="url(#hb-brass-v)" stroke={INK} stroke-width="0.9" />
            <rect x={19.7 + i * 7.2} y={58.6 - h} width="1.2" height={h - 1.4} fill={HI} opacity="0.55" />
          </g>
        );
      })}
      <g transform="translate(15 41) rotate(35)">
        <Sabre />
      </g>
      <g transform="translate(49 41) rotate(-35) scale(-1 1)">
        <Sabre />
      </g>
    </>
  );
}

/** A round-cut gem: eight facets lit from the upper left round a bright table, outlined like the other pictures. */
function Gem({ cx, cy, r }: { cx: number; cy: number; r: number }): JSX.Element {
  const facets: JSX.Element[] = [];
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2 - Math.PI / 2 - Math.PI / n;
    const a1 = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2 - Math.PI / n;
    const mid = (a0 + a1) / 2;
    // light from the upper left: facets facing (-1, -1) are brightest
    const lit = 0.5 + 0.5 * Math.cos(mid - (-Math.PI * 0.75));
    const lo = [0x6a, 0x34, 0x10];
    const hi = [0xff, 0xdd, 0x98];
    const col = lo.map((c, k) => Math.round(c + ((hi[k] as number) - c) * lit));
    const p = (ang: number, rad: number): string => `${(cx + Math.cos(ang) * rad).toFixed(2)},${(cy + Math.sin(ang) * rad).toFixed(2)}`;
    facets.push(<polygon key={i} points={`${p(a0, r)} ${p(a1, r)} ${p(a1, r * 0.46)} ${p(a0, r * 0.46)}`} fill={`rgb(${col.join(',')})`} stroke={INK} stroke-width="0.45" stroke-linejoin="round" />);
  }
  return (
    <g>
      <circle cx={cx} cy={cy} r={r + 0.9} fill="#120a04" />
      {facets}
      <polygon
        points={Array.from({ length: n }, (_, i) => {
          const ang = (i / n) * Math.PI * 2 - Math.PI / 2 - Math.PI / n;
          return `${(cx + Math.cos(ang) * r * 0.46).toFixed(2)},${(cy + Math.sin(ang) * r * 0.46).toFixed(2)}`;
        }).join(' ')}
        fill="#ffe9b4"
        stroke={INK}
        stroke-width="0.5"
      />
      <path d={`M${cx - r * 0.34} ${cy - r * 0.1} L${cx - r * 0.1} ${cy - r * 0.34}`} stroke="#fff" stroke-width="1.5" stroke-linecap="round" opacity="0.9" />
    </g>
  );
}

function BuildArt(): JSX.Element {
  return (
    <>
      <path d="M23 6 C22 21 27 22 32 24 C37 22 42 21 41 6" fill="none" stroke={INK} stroke-width="3.4" stroke-linecap="round" />
      <path d="M23 6 C22 21 27 22 32 24 C37 22 42 21 41 6" fill="none" stroke="#a9894f" stroke-width="1.6" stroke-linecap="round" />
      <circle cx="32" cy="38" r="19" fill="url(#hb-brass)" stroke={INK} stroke-width="1.3" />
      <circle cx="32" cy="38" r="15.2" fill="#1d130a" stroke="#6b4a22" stroke-width="1" />
      <circle cx="32" cy="38" r="17.2" fill="none" stroke={HI} stroke-width="0.8" opacity="0.7" />
      {[0, 90, 180, 270].map((a) => (
        <circle key={a} cx={32 + Math.sin((a * Math.PI) / 180) * 17.1} cy={38 - Math.cos((a * Math.PI) / 180) * 17.1} r="2.1" fill="url(#hb-brass)" stroke={INK} stroke-width="0.8" />
      ))}
      <Gem cx={32} cy={38} r={12.4} />
    </>
  );
}

function MapArt(): JSX.Element {
  return (
    <>
      <path d="M12 17 Q32 11.5 52 17 L52 48 Q32 53.5 12 48 Z" fill="url(#hb-parch)" stroke={INK} stroke-width="1.2" stroke-linejoin="round" />
      <path d="M26 14.4 L26 51 M39 13.8 L39 51.4" stroke="#7a5f38" stroke-width="0.7" opacity="0.55" />
      <path d="M17 41 C21 35 25 40 29 33 S38 31 42 25" fill="none" stroke="#4e2f12" stroke-width="1.5" stroke-dasharray="2.6 2" stroke-linecap="round" />
      <path d="M40 22.5 L44.4 27.4 M44.4 22.5 L40 27.4" stroke="#8a2c18" stroke-width="2" stroke-linecap="round" />
      <path d="M15.5 30 L19 24 L22.5 30 M20.5 30 L24 25 L27.5 30" fill="none" stroke="#5a3b1c" stroke-width="1.2" stroke-linejoin="round" />
      <path d="M12 17 Q32 11.5 52 17" fill="none" stroke={HI} stroke-width="0.8" opacity="0.55" />
      <g>
        <rect x="5" y="12" width="9" height="42" rx="4.5" fill="url(#hb-roll)" stroke={INK} stroke-width="1.1" />
        <ellipse cx="9.5" cy="12.6" rx="4.5" ry="2" fill="#e8d5a6" stroke={INK} stroke-width="0.9" />
        <ellipse cx="9.5" cy="12.6" rx="2" ry="0.9" fill="none" stroke="#7a5f38" stroke-width="0.7" />
        <circle cx="9.5" cy="9.4" r="2.2" fill="url(#hb-brass)" stroke={INK} stroke-width="0.8" />
        <circle cx="9.5" cy="57" r="2.2" fill="url(#hb-brass)" stroke={INK} stroke-width="0.8" />
      </g>
      <g>
        <rect x="50" y="12" width="9" height="42" rx="4.5" fill="url(#hb-roll)" stroke={INK} stroke-width="1.1" />
        <ellipse cx="54.5" cy="12.6" rx="4.5" ry="2" fill="#e8d5a6" stroke={INK} stroke-width="0.9" />
        <circle cx="54.5" cy="9.4" r="2.2" fill="url(#hb-brass)" stroke={INK} stroke-width="0.8" />
        <circle cx="54.5" cy="57" r="2.2" fill="url(#hb-brass)" stroke={INK} stroke-width="0.8" />
      </g>
      <g transform="translate(40 42)">
        <circle r="8.6" fill="#241709" stroke="url(#hb-brass)" stroke-width="2.2" />
        <path d="M0 -7 L1.9 -1.9 L7 0 L1.9 1.9 L0 7 L-1.9 1.9 L-7 0 L-1.9 -1.9 Z" fill="url(#hb-steel)" stroke={INK} stroke-width="0.7" stroke-linejoin="round" />
        <path d="M0 -7 L1.9 -1.9 L0 0 L-1.9 -1.9 Z" fill="#c8402a" />
        <circle r="1.1" fill={INK} />
      </g>
    </>
  );
}

function MenuArt(): JSX.Element {
  return (
    <>
      <path d={GEAR_BIG} fill="url(#hb-steel)" stroke={INK} stroke-width="1.3" stroke-linejoin="round" />
      <circle cx="38" cy="26" r="10.8" fill="none" stroke={HI} stroke-width="0.9" opacity="0.6" />
      <circle cx="38" cy="26" r="7.6" fill="url(#hb-brass)" stroke={INK} stroke-width="1" />
      <circle cx="38" cy="26" r="3.9" fill="#120a04" stroke="#6b4a22" stroke-width="0.9" />
      <path d={GEAR_SMALL} fill="url(#hb-steel)" stroke={INK} stroke-width="1.3" stroke-linejoin="round" />
      <circle cx="19" cy="42" r="7.6" fill="none" stroke={HI} stroke-width="0.8" opacity="0.55" />
      <circle cx="19" cy="42" r="3.2" fill="#120a04" stroke="#6b4a22" stroke-width="0.9" />
      <g transform="translate(44 49)">
        <rect x="-6.4" y="-6.4" width="12.8" height="12.8" rx="2.4" fill="#22160a" stroke="url(#hb-brass)" stroke-width="1.6" />
        <rect x="-3.2" y="-3.6" width="2.3" height="7.2" rx="0.6" fill="#f0d79a" />
        <rect x="0.9" y="-3.6" width="2.3" height="7.2" rx="0.6" fill="#f0d79a" />
      </g>
    </>
  );
}

const ART: Record<BtnKind, () => JSX.Element> = { meter: MeterArt, build: BuildArt, map: MapArt, menu: MenuArt };

/** The engraved picture of a taskbar button: a 64 x 64 stone ground with the drawing, a warm vignette and a fine grain. */
export function BtnArt({ kind }: { kind: BtnKind }): JSX.Element {
  const Art = ART[kind];
  return (
    <svg class={`ms-tb-svg ms-tb-svg--${kind}`} viewBox="0 0 64 64" aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid slice">
      <rect width="64" height="64" fill="url(#hb-ground)" />
      <Art />
      <rect width="64" height="64" filter="url(#hb-grain)" opacity="0.55" style="mix-blend-mode:multiply" />
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------------- coin pictures

/** Skull (kills), yeop coin, soul shard (crystal): lit pictures for the dark bronze lens sockets (32 x 32 box). */
export function CoinArt({ kind }: { kind: CoinKind }): JSX.Element {
  return (
    <svg class={`ms-tb-ico ms-tb-ico--${kind}`} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <circle cx="16" cy="18" r="13" fill="url(#hb-dome)" />
      {kind === 'kills' && (
        <>
          <path d="M16 3.6 C8.6 3.6 5.4 9 5.4 14.2 C5.4 18.2 7.4 20.4 9.6 21.8 L9.6 25.6 Q9.6 27 11 27 L21 27 Q22.4 27 22.4 25.6 L22.4 21.8 C24.6 20.4 26.6 18.2 26.6 14.2 C26.6 9 23.4 3.6 16 3.6 Z" fill="url(#hb-bone)" stroke="#1a1006" stroke-width="1.2" stroke-linejoin="round" />
          <ellipse cx="11.6" cy="14.4" rx="3.3" ry="3.8" fill="#140b04" />
          <ellipse cx="20.4" cy="14.4" rx="3.3" ry="3.8" fill="#140b04" />
          <path d="M16 17.4 L13.9 21.2 L18.1 21.2 Z" fill="#1c1006" />
          <path d="M12.6 24.2 L12.6 27 M16 24.2 L16 27 M19.4 24.2 L19.4 27" stroke="#2a1b0a" stroke-width="1.1" />
          <path d="M8.4 9 Q10 5.6 14 5" fill="none" stroke="#fff" stroke-width="1.2" stroke-linecap="round" opacity="0.7" />
        </>
      )}
      {kind === 'yeop' && (
        <>
          <circle cx="16" cy="16" r="12.6" fill="url(#hb-gold)" stroke="#2a1704" stroke-width="1.3" />
          <circle cx="16" cy="16" r="9.8" fill="none" stroke="#fff0b0" stroke-width="0.9" opacity="0.75" />
          <circle cx="16" cy="16" r="10.6" fill="none" stroke="#8a5412" stroke-width="0.8" opacity="0.8" />
          <rect x="11.6" y="11.6" width="8.8" height="8.8" rx="0.8" fill="#1d1004" stroke="#fff0b0" stroke-width="0.8" />
          <path d="M16 3.8 L16 6.2 M16 25.8 L16 28.2 M3.8 16 L6.2 16 M25.8 16 L28.2 16" stroke="#7a4a10" stroke-width="1.2" stroke-linecap="round" />
          <path d="M8.6 9.6 Q10.4 6.6 14 5.8" fill="none" stroke="#fff" stroke-width="1.2" stroke-linecap="round" opacity="0.8" />
        </>
      )}
      {kind === 'dps' && (
        <>
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <rect x={7.4 + i * 6.2} y={27.6 - (4.2 + i * 3.6)} width="4.6" height={4.2 + i * 3.6} fill="url(#hb-brass-v)" stroke="#1a1006" stroke-width="0.9" />
              <rect x={8 + i * 6.2} y={28 - (4.2 + i * 3.6)} width="1" height={3 + i * 3.6} fill="#fff0cf" opacity="0.55" />
            </g>
          ))}
          <g transform="translate(9.2 26.6) rotate(38) scale(0.36)">
            <Sabre />
          </g>
          <g transform="translate(22.8 26.6) rotate(-38) scale(-0.36 0.36)">
            <Sabre />
          </g>
        </>
      )}
      {kind === 'relic' && (
        <>
          <path d="M11.6 3.4 C11 11 13.6 11.6 16 12.8 C18.4 11.6 21 11 20.4 3.4" fill="none" stroke="#1a1006" stroke-width="2.4" stroke-linecap="round" />
          <path d="M11.6 3.4 C11 11 13.6 11.6 16 12.8 C18.4 11.6 21 11 20.4 3.4" fill="none" stroke="#b69456" stroke-width="1.1" stroke-linecap="round" />
          <circle cx="16" cy="19.6" r="10.4" fill="url(#hb-brass)" stroke="#1a1006" stroke-width="1.2" />
          <circle cx="16" cy="19.6" r="7.9" fill="#0b1a30" stroke="#5a3b17" stroke-width="0.8" />
          <polygon points="16,12.6 22.2,17 22.2,22.6 16,27 9.8,22.6 9.8,17" fill="url(#hb-sapph)" stroke="#06101f" stroke-width="0.9" stroke-linejoin="round" />
          <polygon points="16,12.6 22.2,17 16,19.6 9.8,17" fill="#bfe8ff" opacity="0.85" />
          <path d="M12 16 L14.4 14.2" stroke="#fff" stroke-width="1.2" stroke-linecap="round" opacity="0.9" />
        </>
      )}
      {kind === 'shard' && (
        <>
          <polygon points="16,2.6 24.6,10.6 21.6,28.6 10.4,28.6 7.4,10.6" fill="#8a2210" stroke="#1a0804" stroke-width="1.2" stroke-linejoin="round" />
          <polygon points="16,2.6 24.6,10.6 16,13.4 7.4,10.6" fill="#ffb38a" />
          <polygon points="7.4,10.6 16,13.4 10.4,28.6" fill="#e0543a" />
          <polygon points="24.6,10.6 21.6,28.6 16,13.4" fill="#a62a14" />
          <polygon points="16,13.4 21.6,28.6 10.4,28.6" fill="#c63c24" />
          <path d="M11 9.2 L15 5.8 M12.4 17 L11.6 23" stroke="#fff" stroke-width="1.3" stroke-linecap="round" opacity="0.85" />
        </>
      )}
    </svg>
  );
}
