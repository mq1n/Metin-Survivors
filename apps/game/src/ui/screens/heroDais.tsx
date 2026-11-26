// Hero-select dais (T12, round 2): a carved stone plinth with worn-bronze inlay, drawn procedurally (own ornament, no raster).
//   base step -> lower drum (cloud-scroll relief band, bronze lip, studs on its upper ring) -> upper drum (lotus petal band)
//   -> flat top the hero stands on (grain lit by a warm key from the upper right, thin bronze inlay circles).
// Two stacked layers so the heavy stone filter is painted once and only the light layer animates:
//   <Dais>  = .ms-hs-dais-svg  static stone (class independent)
//   the class-tinted light (soft glow ring, back rim, pool on the top face) = .ms-hs-dais-fx, opacity-only animation.
// Geometry: viewBox 560 x 206; the top face (where the feet go) is centred at (280, 70), rx 214 ry 50 -> 34 % of the height.

// cloud-scroll motif family comes from its UI patterns; the ornament below is our own drawing.
import type { JSX } from 'preact';

export interface Tier {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export const DAIS_W = 560;
export const DAIS_H = 206;
/** where the hero's feet stand, as a share of the dais height (CSS translates the dais by this) */
export const DAIS_FEET = 70 / DAIS_H;

const CX = 280;
export const TOP: Tier = { cx: CX, cy: 70, rx: 214, ry: 50 };
const UPPER_H = 20;
export const RING: Tier = { cx: CX, cy: 90, rx: 262, ry: 62 };
const LOWER_H = 32;
export const BASE: Tier = { cx: CX, cy: 122, rx: 272, ry: 65 };
const BASE_H = 8;

/** point on the ellipse at angle `th` (0 = right, PI/2 = nearest the viewer, PI = left) */
export const ellipsePoint = (t: Tier, th: number): [number, number] => [t.cx + t.rx * Math.cos(th), t.cy + t.ry * Math.sin(th)];

/** `n` evenly spaced angles over the visible front half (0..PI); an odd n puts one exactly in front (PI / 2) */
export function frontAngles(n: number): number[] {
  return Array.from({ length: n }, (_, i) => (Math.PI * (i + 0.5)) / n);
}

/** horizontal squash of a motif sitting at angle `th` on a tier: the wall turns away from the viewer towards the sides */
export const squash = (th: number): number => Math.sin(th);

/** number of motifs of design width `w` that fit the front half of a tier (odd, so one is centred) */
export function motifCount(t: Tier, w: number): number {
  const n = Math.round((t.rx * Math.PI) / w);
  return n % 2 === 0 ? n + 1 : n;
}

const f = (n: number): string => n.toFixed(1);
/** front half of an ellipse, right to left, as a path continuation (no moveto) */
const frontArc = (t: Tier, dy = 0): string => `M${f(t.cx + t.rx)} ${f(t.cy + dy)}A${t.rx} ${t.ry} 0 0 1 ${f(t.cx - t.rx)} ${f(t.cy + dy)}`;
const fullEllipse = (t: Tier, dy = 0): string => `M${f(t.cx - t.rx)} ${f(t.cy + dy)}A${t.rx} ${t.ry} 0 1 0 ${f(t.cx + t.rx)} ${f(t.cy + dy)}A${t.rx} ${t.ry} 0 1 0 ${f(t.cx - t.rx)} ${f(t.cy + dy)}Z`;
/** a cylinder wall from the top ellipse down by `h` (front only; the sides are straight) */
const wallPath = (t: Tier, h: number): string =>
  `M${f(t.cx + t.rx)} ${f(t.cy)}A${t.rx} ${t.ry} 0 0 1 ${f(t.cx - t.rx)} ${f(t.cy)}L${f(t.cx - t.rx)} ${f(t.cy + h)}A${t.rx} ${t.ry} 0 0 0 ${f(t.cx + t.rx)} ${f(t.cy + h)}Z`;

// design-space motifs (centre x = 0): a double cloud-scroll 44 wide, and a lotus petal 24 wide
const SCROLL_W = 44;
const SCROLL =
  'M-22 6H-18M18 6H22M-18 6C-12 6-11-2-5-2C0-2 1.5 3-2 3.6C-4.5 4-5.4 1-3.4 0.4M18 6C12 6 11-2 5-2C0-2-1.5 3 2 3.6C4.5 4 5.4 1 3.4 0.4M-5-2C-3-7.4 3-7.4 5-2';
const PETAL_W = 26;
const PETAL = 'M0 0C-8.4-2.4-9.2-10.2 0-16.4C9.2-10.2 8.4-2.4 0 0Z';

function Scrolls(): JSX.Element {
  const n = motifCount(RING, SCROLL_W);
  const step = Math.PI / n;
  return (
    <g>
      {frontAngles(n).map((th, i) => {
        const [x, y] = ellipsePoint(RING, th);
        const sx = (RING.rx * step * Math.sin(th)) / SCROLL_W;
        return <use key={i} href="#hsd-scroll" transform={`translate(${f(x)} ${f(y + LOWER_H * 0.52)}) scale(${sx.toFixed(3)} 1)`} />;
      })}
    </g>
  );
}

function Petals(): JSX.Element {
  const n = motifCount(TOP, PETAL_W);
  const step = Math.PI / n;
  const lower: Tier = { ...TOP, cy: TOP.cy + UPPER_H };
  return (
    <g>
      {frontAngles(n).map((th, i) => {
        const [x, y] = ellipsePoint(lower, th);
        const sx = (TOP.rx * step * Math.sin(th)) / PETAL_W;
        return <use key={i} href="#hsd-petal" transform={`translate(${f(x)} ${f(y - 1.6)}) scale(${sx.toFixed(3)} 1)`} />;
      })}
    </g>
  );
}

/** bronze pegs on the lower drum's upper ring, in front of the upper drum and along both sides */
function Studs(): JSX.Element {
  const ring: Tier = { cx: CX, cy: RING.cy, rx: RING.rx - 13, ry: RING.ry - 3.2 };
  const pts: [number, number][] = [];
  const N = 17;
  for (let i = 0; i < N; i++) pts.push(ellipsePoint(ring, -0.1 + ((Math.PI + 0.2) * (i + 0.5)) / N));
  return (
    <g>
      {pts.map(([x, y], i) => (
        <g key={i} transform={`translate(${f(x)} ${f(y)})`}>
          <ellipse cx="0.7" cy="1.6" rx="3.2" ry="1.7" fill="#000" opacity=".5" />
          <circle r="2.7" fill="url(#hsd-peg)" stroke="#1a0f05" stroke-width=".7" />
          <circle cx="-.8" cy="-.9" r=".8" fill="#fff0c2" opacity=".8" />
        </g>
      ))}
    </g>
  );
}

export function Dais(): JSX.Element {
  const upperBottom: Tier = { ...TOP, cy: TOP.cy + UPPER_H };
  const lowerBottom: Tier = { ...RING, cy: RING.cy + LOWER_H };
  const baseBottom: Tier = { ...BASE, cy: BASE.cy + BASE_H };
  return (
    <svg class="ms-hs-dais-svg" viewBox={`0 0 ${DAIS_W} ${DAIS_H}`} aria-hidden="true" focusable="false">
      <defs>
        {/* wall light: warm key from the right, the left falls into shadow, both ends turn away */}
        <linearGradient id="hsd-wall" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#120e0b" />
          <stop offset=".18" stop-color="#2a241e" />
          <stop offset=".46" stop-color="#5b4f40" />
          <stop offset=".66" stop-color="#85735c" />
          <stop offset=".84" stop-color="#3b3228" />
          <stop offset="1" stop-color="#0f0b09" />
        </linearGradient>
        <linearGradient id="hsd-wall-ao" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#000" stop-opacity=".0" />
          <stop offset=".6" stop-color="#000" stop-opacity=".12" />
          <stop offset="1" stop-color="#000" stop-opacity=".62" />
        </linearGradient>
        <radialGradient id="hsd-top" cx=".6" cy=".4" r=".74">
          <stop offset="0" stop-color="#a39279" />
          <stop offset=".34" stop-color="#76685a" />
          <stop offset=".72" stop-color="#40382f" />
          <stop offset="1" stop-color="#1e1915" />
        </radialGradient>
        <radialGradient id="hsd-ring" cx=".62" cy=".3" r=".9">
          <stop offset="0" stop-color="#6d6050" />
          <stop offset=".55" stop-color="#40372e" />
          <stop offset="1" stop-color="#1b1612" />
        </radialGradient>
        <linearGradient id="hsd-bronze" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#3a230a" />
          <stop offset=".22" stop-color="#8a5c1c" />
          <stop offset=".52" stop-color="#e0b25a" />
          <stop offset=".68" stop-color="#fff0b8" />
          <stop offset=".82" stop-color="#a8761f" />
          <stop offset="1" stop-color="#3a230a" />
        </linearGradient>
        <radialGradient id="hsd-peg" cx=".35" cy=".3" r=".8">
          <stop offset="0" stop-color="#ffe9a8" />
          <stop offset=".5" stop-color="#b57a22" />
          <stop offset="1" stop-color="#4a2b08" />
        </radialGradient>
        <linearGradient id="hsd-petal-g" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stop-color="#1c160f" />
          <stop offset=".55" stop-color="#5b4c3a" />
          <stop offset="1" stop-color="#a38d68" />
        </linearGradient>
        {/* grain: bump-lit noise multiplied into the stone (azimuth 315 = light from the upper right, as the sunset key) */}
        <filter id="hsd-stone" filterUnits="userSpaceOnUse" x="0" y="0" width={DAIS_W} height={DAIS_H} color-interpolation-filters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency=".5 .85" numOctaves="3" seed="11" result="n" />
          <feDiffuseLighting in="n" surfaceScale="1.9" diffuseConstant="1.12" lighting-color="#fff2de" result="lit">
            <feDistantLight azimuth="315" elevation="58" />
          </feDiffuseLighting>
          <feComposite in="SourceGraphic" in2="lit" operator="arithmetic" k1="1.12" k2="0" k3="0" k4="0" />
        </filter>
        {/* worn gold: patches of the metal rubbed away */}
        <filter id="hsd-worn" filterUnits="userSpaceOnUse" x="0" y="0" width={DAIS_W} height={DAIS_H} color-interpolation-filters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency=".12 .3" numOctaves="2" seed="4" result="w" />
          <feColorMatrix in="w" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 5 -2.1" result="m" />
          <feComposite in="SourceGraphic" in2="m" operator="in" />
        </filter>
        <filter id="hsd-soft" x="-20%" y="-60%" width="140%" height="220%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
        <clipPath id="hsd-clip-top">
          <path d={fullEllipse(TOP)} />
        </clipPath>
        {/* carved motifs: a dark groove under a pale lit edge (the light comes from above) */}
        <g id="hsd-scroll" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <path d={SCROLL} stroke="#080503" stroke-width="3" opacity=".85" transform="translate(.6 1.1)" />
          <path d={SCROLL} stroke="#7d6a4f" stroke-width="2.2" />
          <path d={SCROLL} stroke="#ecd9ae" stroke-width=".8" opacity=".62" transform="translate(-.2 -.7)" />
        </g>
        <g id="hsd-petal" stroke-linejoin="round">
          <path d={PETAL} fill="url(#hsd-petal-g)" stroke="#07040a" stroke-width="1.2" />
          <path d="M0-2.4V-12.6" fill="none" stroke="#0c0805" stroke-width="1.1" opacity=".7" />
          <path d="M.9-2.4V-12.4" fill="none" stroke="#f0dcb0" stroke-width=".5" opacity=".5" />
          <path d="M3.4-2.6C6.2-5.4 5.6-9.6 1.8-13.4" fill="none" stroke="#e8d3a2" stroke-width=".6" opacity=".4" />
        </g>
      </defs>

      {/* ground shadow of the whole plinth */}
      <ellipse cx={CX} cy="140" rx="296" ry="64" fill="#000" opacity=".5" filter="url(#hsd-soft)" />

      <g filter="url(#hsd-stone)">
        {/* base step */}
        <path d={wallPath(BASE, BASE_H)} fill="url(#hsd-wall)" />
        <path d={fullEllipse(BASE)} fill="url(#hsd-ring)" />
        {/* lower drum */}
        <path d={wallPath(RING, LOWER_H)} fill="url(#hsd-wall)" />
        <path d={wallPath(RING, LOWER_H)} fill="url(#hsd-wall-ao)" />
        <path d={fullEllipse(RING)} fill="url(#hsd-ring)" />
        {/* upper drum */}
        <path d={wallPath(TOP, UPPER_H)} fill="url(#hsd-wall)" />
        <path d={wallPath(TOP, UPPER_H)} fill="url(#hsd-wall-ao)" opacity=".7" />
        <path d={fullEllipse(TOP)} fill="url(#hsd-top)" />
      </g>

      {/* relief: cloud-scroll band on the lower drum, lotus petals on the upper one */}
      <Scrolls />
      <Petals />
      <path d={frontArc(RING, LOWER_H * 0.52 - 11)} fill="none" stroke="#050302" stroke-width="1.6" opacity=".7" />
      <path d={frontArc(RING, LOWER_H * 0.52 + 11)} fill="none" stroke="#050302" stroke-width="1.6" opacity=".7" />
      <path d={frontArc(RING, LOWER_H * 0.52 - 10)} fill="none" stroke="#c8ae82" stroke-width=".7" opacity=".32" />

      {/* seams where the stones meet */}
      <path d={frontArc(BASE, BASE_H)} fill="none" stroke="#050302" stroke-width="1.8" />
      <path d={frontArc(RING, LOWER_H)} fill="none" stroke="#050302" stroke-width="1.8" />
      <path d={frontArc(TOP, UPPER_H)} fill="none" stroke="#050302" stroke-width="1.8" />
      <path d={frontArc(BASE, 0)} fill="none" stroke="#9c8765" stroke-width="1" opacity=".55" />

      {/* worn bronze lips on every edge */}
      <path d={fullEllipse(RING)} fill="none" stroke="#120b04" stroke-width="5.4" />
      <path d={fullEllipse(RING)} fill="none" stroke="url(#hsd-bronze)" stroke-width="3.4" />
      <path d={fullEllipse(RING, -0.6)} fill="none" stroke="#fff3c4" stroke-width=".8" opacity=".55" />
      <path d={fullEllipse(TOP)} fill="none" stroke="#120b04" stroke-width="5.6" />
      <path d={fullEllipse(TOP)} fill="none" stroke="url(#hsd-bronze)" stroke-width="3.6" />
      <path d={fullEllipse(TOP, -0.7)} fill="none" stroke="#fff3c4" stroke-width=".9" opacity=".6" />

      <Studs />

      {/* top face: inlaid circles (a thick worn-gold one near the rim, a fine one inside), faint flagstone seams */}
      <g clip-path="url(#hsd-clip-top)">
        <path d={fullEllipse({ ...TOP, rx: 196, ry: 45.7 })} fill="none" stroke="#0a0604" stroke-width="3.6" />
        <g filter="url(#hsd-worn)">
          <path d={fullEllipse({ ...TOP, rx: 196, ry: 45.7 })} fill="none" stroke="url(#hsd-bronze)" stroke-width="2.2" />
        </g>
        <path d={fullEllipse({ ...TOP, rx: 196, ry: 46.7 })} fill="none" stroke="#e8d3a2" stroke-width=".6" opacity=".26" />
        <path d={fullEllipse({ ...TOP, rx: 118, ry: 27.5 })} fill="none" stroke="#0a0604" stroke-width="2.4" />
        <path d={fullEllipse({ ...TOP, rx: 118, ry: 28.4 })} fill="none" stroke="#d8c394" stroke-width=".7" opacity=".22" />
        <path d="M280 20V120M96 56L464 84M104 90L456 52" stroke="#050302" stroke-width="1" opacity=".38" fill="none" />
      </g>
    </svg>
  );
}

/** class-tinted light on the dais: pool on the top face, soft glowing ring (a lit groove, no dashes), back rim light */
export function DaisLight(): JSX.Element {
  const ring: Tier = { ...TOP, rx: 160, ry: 37.4 };
  const gems: [number, number][] = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ellipsePoint(ring, (Math.PI * 2 * i) / 8));
  return (
    <svg class="ms-hs-dais-fx" viewBox={`0 0 ${DAIS_W} ${DAIS_H}`} aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="hsd-tint" cx=".5" cy=".5" r=".5">
          <stop offset="0" stop-color="var(--cc)" stop-opacity=".0" />
          <stop offset=".62" stop-color="var(--cc)" stop-opacity=".1" />
          <stop offset=".86" stop-color="var(--cc)" stop-opacity=".42" />
          <stop offset="1" stop-color="var(--cc)" stop-opacity=".0" />
        </radialGradient>
        <filter id="hsd-fx-blur" x="-10%" y="-60%" width="120%" height="220%">
          <feGaussianBlur stdDeviation="3.4" />
        </filter>
        <filter id="hsd-fx-blur2" x="-10%" y="-80%" width="120%" height="260%">
          <feGaussianBlur stdDeviation="1.6" />
        </filter>
        <clipPath id="hsd-fx-clip">
          <path d={fullEllipse(TOP)} />
        </clipPath>
      </defs>
      <g clip-path="url(#hsd-fx-clip)">
        <ellipse cx={CX} cy={TOP.cy} rx="196" ry="46" fill="url(#hsd-tint)" />
      </g>
      <g class="ms-hs-dais-glow">
        <path d={fullEllipse(ring)} fill="none" stroke="var(--cc)" stroke-width="9" opacity=".5" filter="url(#hsd-fx-blur)" />
        <path d={fullEllipse(ring)} fill="none" stroke="var(--cc)" stroke-width="2.6" opacity=".95" />
        <path d={fullEllipse({ ...ring, ry: ring.ry - 0.9 })} fill="none" stroke="#fff" stroke-width=".7" opacity=".55" />
        {gems.map(([x, y], i) => (
          <g key={i} transform={`translate(${f(x)} ${f(y)})`}>
            <path d="M0-4.2L3 0 0 4.2-3 0Z" fill="var(--cc)" stroke="#120b04" stroke-width=".9" />
            <path d="M0-2.4L1.4 0 0 2.4-1.4 0Z" fill="#fff" opacity=".6" />
          </g>
        ))}
      </g>
      {/* back rim light: the class colour catching the far lip */}
      <path d={`M${CX - TOP.rx} ${TOP.cy}A${TOP.rx} ${TOP.ry} 0 0 1 ${CX + TOP.rx} ${TOP.cy}`} fill="none" stroke="var(--cc)" stroke-width="3" opacity=".75" filter="url(#hsd-fx-blur2)" />
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Painted dais (round 3): uk_hero_select_dais (1024 x 407, stone drum with cloud-scroll band, bronze lips, lotus petals).
// Its top face is centred at (512, 64) with rx ~ 430 / ry ~ 48 (a LOW camera: the ellipse is ~ 8 : 1, which also matches the
// near-level camera of the 3D hero). The class light below is drawn in the same 1024 x 407 box so the two always line up.

export const TEX_DAIS_W = 1024;
export const TEX_DAIS_H = 407;
/** where the feet stand on the painted dais, as a share of its height */
export const TEX_DAIS_FEET = 66 / TEX_DAIS_H;
/** the lit groove on the painted top face */
const TEX_RING: Tier = { cx: 512, cy: 66, rx: 372, ry: 33 };

export function DaisTex({ url }: { url: string }): JSX.Element {
  return <img class="ms-hs-dais-img" src={url} alt="" draggable={false} decoding="async" />;
}

/** class-tinted light for the painted dais: tint on the top face, a soft lit ring, the far lip catching the class colour */
export function DaisLightTex(): JSX.Element {
  const ring = TEX_RING;
  return (
    <svg class="ms-hs-dais-fx" viewBox={`0 0 ${TEX_DAIS_W} ${TEX_DAIS_H}`} aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="hsd-t-tint" cx=".5" cy=".5" r=".5">
          <stop offset="0" stop-color="var(--cc)" stop-opacity=".0" />
          <stop offset=".6" stop-color="var(--cc)" stop-opacity=".1" />
          <stop offset=".86" stop-color="var(--cc)" stop-opacity=".36" />
          <stop offset="1" stop-color="var(--cc)" stop-opacity=".0" />
        </radialGradient>
        <filter id="hsd-t-blur" x="-10%" y="-120%" width="120%" height="340%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
        <filter id="hsd-t-blur2" x="-10%" y="-200%" width="120%" height="500%">
          <feGaussianBlur stdDeviation="3.4" />
        </filter>
        <clipPath id="hsd-t-clip">
          <ellipse cx={512} cy={64} rx={425} ry={45} />
        </clipPath>
      </defs>
      <g clip-path="url(#hsd-t-clip)">
        <ellipse cx={512} cy={64} rx={410} ry={44} fill="url(#hsd-t-tint)" />
      </g>
      <g class="ms-hs-dais-glow">
        <ellipse cx={ring.cx} cy={ring.cy} rx={ring.rx} ry={ring.ry} fill="none" stroke="var(--cc)" stroke-width="16" opacity=".42" filter="url(#hsd-t-blur)" />
        <ellipse cx={ring.cx} cy={ring.cy} rx={ring.rx} ry={ring.ry} fill="none" stroke="var(--cc)" stroke-width="3.4" opacity=".9" />
        <ellipse cx={ring.cx} cy={ring.cy} rx={ring.rx} ry={ring.ry - 1.2} fill="none" stroke="#fff" stroke-width="1" opacity=".5" />
      </g>
      <path d="M92 58A420 46 0 0 1 932 58" fill="none" stroke="var(--cc)" stroke-width="5" opacity=".55" filter="url(#hsd-t-blur2)" />
    </svg>
  );
}
