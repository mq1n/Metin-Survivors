// The socket medallion of the Metin essence window: a bronze-rimmed stone disc with an engraved relief (the painted
// `uk_essence_chest_relief`: our own twin cloud dragons over scrolls; without it a drawn relief of twin cloud coils, scale
// marks and lozenges lit by an SVG emboss filter), an engraved RING TRACK cut round the relief (a darkened groove with a bronze
// rail, a pocket under each socket, studs where the weapon half meets the armor half) and the stone's painted spirit crystal
// (`uk_essence_chest_crystal`, recoloured to the metin's rune) standing in the hub. The six spirit-stone sockets are small gems
// (14 % of the disc) set into the track (positioned by the caller from the same constants, see rewardGeom `MED`).
import type { JSX } from 'preact';
import { texUrl } from '../assets';
import { MED, STONE_RING_DEG } from './rewardGeom';

/** Corner-cut square (the octagon of the kit plates: 30 % cuts) as an SVG point list, centred on (cx, cy), side `s`. */
function octPoints(cx: number, cy: number, s: number): string {
  const h = s / 2;
  const k = s * 0.3;
  const pts: [number, number][] = [
    [-h + k, -h],
    [h - k, -h],
    [h, -h + k],
    [h, h - k],
    [h - k, h],
    [-h + k, h],
    [-h, h - k],
    [-h, -h + k],
  ];
  return pts.map(([x, y]) => `${(cx + x).toFixed(2)},${(cy + y).toFixed(2)}`).join(' ');
}

/** Point on a circle of radius r round (100,100), `deg` clockwise from 12 o'clock. */
function at(r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [100 + Math.sin(a) * r, 100 - Math.cos(a) * r];
}
function arc(r: number, from: number, to: number): string {
  const [x1, y1] = at(r, from);
  const [x2, y2] = at(r, to);
  return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

const RING = MED.ring * 200;
const SOCK = MED.socket * 200;
const TRACK_IN = RING - (MED.track * 200) / 2;
const TRACK_OUT = RING + (MED.track * 200) / 2;
/** lozenges in the gaps between neighbouring sockets of one half; the studs at 90 / 270 degrees part the halves */
const LOZENGES = [30, 150, 210, 330];
const STUDS = [90, 270];

/**
 * The engraved ring track (decorative, drawn over the painted relief): a recessed groove from `TRACK_IN` to `TRACK_OUT` that lets the
 * relief's own bronze rail show through between the gems, light on its lower-right lip and dark on its upper-left one, an octagon
 * pocket under each socket (the gems sit IN the track), engraved lozenges between neighbours, two domed studs parting weapon / armor.
 */
export function MedallionTrack({ painted = false }: { painted?: boolean }): JSX.Element {
  return (
    <svg class="ms-ess-track" viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="ms-trk-groove" cx="100" cy="100" r={TRACK_OUT + 1} gradientUnits="userSpaceOnUse">
          <stop offset={(TRACK_IN - 2.5) / (TRACK_OUT + 1)} stop-color="#040302" stop-opacity="0" />
          <stop offset={(TRACK_IN + 0.4) / (TRACK_OUT + 1)} stop-color="#040302" stop-opacity="0.84" />
          <stop offset={(RING - 9) / (TRACK_OUT + 1)} stop-color="#080504" stop-opacity="0.62" />
          <stop offset={(RING + 9) / (TRACK_OUT + 1)} stop-color="#080504" stop-opacity="0.62" />
          <stop offset={(TRACK_OUT - 0.4) / (TRACK_OUT + 1)} stop-color="#040302" stop-opacity="0.84" />
          <stop offset={(TRACK_OUT + 1) / (TRACK_OUT + 1)} stop-color="#040302" stop-opacity="0" />
        </radialGradient>
        <radialGradient id="ms-trk-stud" cx="38%" cy="32%" r="70%">
          <stop offset="0" stop-color="#fff2cc" />
          <stop offset="0.3" stop-color="#d6a44e" />
          <stop offset="0.75" stop-color="#6a4519" />
          <stop offset="1" stop-color="#241405" />
        </radialGradient>
      </defs>
      {!painted && (
        <>
          <circle cx="100" cy="100" r={TRACK_OUT + 1} fill="url(#ms-trk-groove)" />
          {/* groove walls: dark on the upper-left, a lit lip on the lower-right (light comes from the upper left) */}
          <circle cx="100" cy="100" r={TRACK_OUT} fill="none" stroke="#000" stroke-opacity="0.8" stroke-width="1.5" />
          <circle cx="100" cy="100" r={TRACK_IN} fill="none" stroke="#000" stroke-opacity="0.8" stroke-width="1.5" />
          <path d={arc(TRACK_OUT + 1, 55, 170)} fill="none" stroke="#f3d9a4" stroke-opacity="0.42" stroke-width="1" stroke-linecap="round" />
          <path d={arc(TRACK_IN - 1, 235, 350)} fill="none" stroke="#f3d9a4" stroke-opacity="0.34" stroke-width="1" stroke-linecap="round" />
        </>
      )}
      {/* a pocket under every gem */}
      {STONE_RING_DEG.map((d) => {
        const [x, y] = at(RING, d);
        return (
          <g key={d}>
            <polygon points={octPoints(x + 0.7, y + 1.1, SOCK + 8)} fill="#f3d9a4" fill-opacity="0.3" />
            <polygon points={octPoints(x, y, SOCK + 8)} fill="#050302" fill-opacity="0.9" stroke="#000" stroke-width="1.2" stroke-linejoin="round" />
          </g>
        );
      })}
      {/* engraved lozenges between neighbours (the painted track carries its own ornaments) */}
      {!painted && LOZENGES.map((d) => {
        const [x, y] = at(RING, d);
        return (
          <g key={d} transform={`rotate(${d} ${x.toFixed(2)} ${y.toFixed(2)})`}>
            <path d={`M${x} ${y - 5.6} L${x + 3.4} ${y} L${x} ${y + 5.6} L${x - 3.4} ${y} Z`} fill="#5b3f1c" stroke="#0a0604" stroke-width="1" stroke-linejoin="round" />
            <path d={`M${x} ${y - 4} L${x + 2} ${y} L${x} ${y + 4} L${x - 2} ${y} Z`} fill="#d9aa58" fill-opacity="0.8" />
          </g>
        );
      })}
      {/* the two studs that part the weapon half from the armor half */}
      {!painted && STUDS.map((d) => {
        const [x, y] = at(RING, d);
        return (
          <g key={d}>
            <circle cx={x} cy={y} r="7.4" fill="#050302" fill-opacity="0.7" stroke="#000" stroke-width="1" />
            <circle cx={x} cy={y} r="5" fill="url(#ms-trk-stud)" stroke="#120a03" stroke-width="1" />
            <circle cx={x - 1.6} cy={y - 1.8} r="1.1" fill="#fff8e4" fill-opacity="0.85" />
          </g>
        );
      })}
    </svg>
  );
}

/** Engraved relief (decorative, fallback while the painted disc is not in the manifest). The filter id is unique per page: only one medallion is on screen. */
export function MedallionRelief(): JSX.Element {
  return (
    <svg class="ms-ess-relief" viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <defs>
        <filter id="ms-ess-emboss" x="-4%" y="-4%" width="108%" height="108%" color-interpolation-filters="sRGB">
          <feGaussianBlur in="SourceAlpha" stdDeviation="1.25" result="blur" />
          <feSpecularLighting in="blur" surfaceScale="5" specularConstant="1.15" specularExponent="26" lighting-color="#ffe9c8" result="spec">
            <feDistantLight azimuth="235" elevation="44" />
          </feSpecularLighting>
          <feComposite in="spec" in2="SourceAlpha" operator="in" result="specIn" />
          <feDiffuseLighting in="blur" surfaceScale="5" diffuseConstant="1.05" lighting-color="#8a6f4e" result="diff">
            <feDistantLight azimuth="235" elevation="44" />
          </feDiffuseLighting>
          <feComposite in="diff" in2="SourceAlpha" operator="in" result="diffIn" />
          <feOffset in="blur" dx="1.3" dy="1.7" result="off" />
          <feFlood flood-color="#000" flood-opacity="0.8" result="fl" />
          <feComposite in="fl" in2="off" operator="in" result="shade" />
          <feMerge>
            <feMergeNode in="shade" />
            <feMergeNode in="diffIn" />
            <feMergeNode in="specIn" />
          </feMerge>
        </filter>
      </defs>
      <g filter="url(#ms-ess-emboss)" fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round">
        {/* rim, rail and scale marks */}
        <circle cx="100" cy="100" r="92" stroke-width="2.2" />
        <circle cx="100" cy="100" r="76.5" stroke-width="2" />
        <circle cx="100" cy="100" r="50" stroke-width="2.4" />
        <circle cx="100" cy="100" r="84.5" stroke-width="4.2" stroke-dasharray="1.5 5.05" />
        <circle cx="100" cy="100" r="55" stroke-width="3.6" stroke-dasharray="1.2 4.4" />
        {/* twin cloud coils at the heart */}
        <g stroke-width="8.5" transform="translate(0 -4) scale(1)">
          <path d="M100 58 C131 58 148 84 134 105 C122 123 97 115 99.5 98 C101 87 113 87 115.5 96" />
          <path d="M100 58 C131 58 148 84 134 105 C122 123 97 115 99.5 98 C101 87 113 87 115.5 96" transform="rotate(180 100 100)" />
        </g>
        <g stroke-width="2.6">
          <path d="M72 90 C70 78 80 70 90 71" />
          <path d="M128 110 C130 122 120 130 110 129" />
        </g>
      </g>
    </svg>
  );
}

/**
 * The bronze rim, the stone disc, the ring track and the spirit crystal (rune-coloured) of the medallion. The disc is the painted relief
 * `uk_essence_chest_relief` (our own twin dragons over cloud scrolls, an empty boss at its heart); without it the drawn
 * disc + SVG emboss relief + conic rim stand in.
 */
export function MedallionBody({ awakened }: { awakened?: boolean }): JSX.Element {
  const painted = texUrl('uk_essence_chest_relief');
  const crystal = texUrl('uk_essence_chest_crystal');
  const track = texUrl('uk_essence_chest_track');
  return (
    <>
      {painted ? (
        <img class="ms-ess-plate" src={painted} alt="" aria-hidden="true" draggable={false} />
      ) : (
        <>
          <i class="ms-ess-disc" aria-hidden="true" />
          <MedallionRelief />
          <i class="ms-ess-rim" aria-hidden="true" />
        </>
      )}
      {track && <img class="ms-ess-ringimg" src={track} alt="" aria-hidden="true" draggable={false} />}
      <MedallionTrack painted={!!track} />
      <span class={`ms-ess-core ${awakened ? 'is-awake' : ''}`} aria-hidden="true">
        <i class="ms-ess-core-glow" />
        {crystal ? <img class="ms-ess-crystal" src={crystal} alt="" draggable={false} /> : <CoreCrystalSvg />}
      </span>
    </>
  );
}

/** Drawn stand-in for the painted spirit crystal (uk_essence_chest_crystal) while it is not in the manifest. */
function CoreCrystalSvg(): JSX.Element {
  return (
    <svg viewBox="0 0 40 52" focusable="false">
      <defs>
        <linearGradient id="ms-ess-cl" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#fff" stop-opacity="0.95" />
          <stop offset="0.45" style="stop-color:var(--rune,#ff9a2e)" />
          <stop offset="1" stop-color="#1a0903" />
        </linearGradient>
        <linearGradient id="ms-ess-cr" x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" style="stop-color:var(--rune,#ff9a2e)" />
          <stop offset="1" stop-color="#0d0503" />
        </linearGradient>
      </defs>
      <path d="M20 1 L36 14 L31 44 L20 51 L9 44 L4 14 Z" fill="url(#ms-ess-cr)" stroke="#0a0504" stroke-width="1.4" stroke-linejoin="round" />
      <path d="M20 1 L36 14 L20 24 Z" fill="url(#ms-ess-cl)" opacity="0.95" />
      <path d="M20 1 L4 14 L20 24 Z" fill="#fff" opacity="0.4" />
      <path d="M20 24 L36 14 L31 44 L20 51 Z" fill="#000" opacity="0.28" />
      <path d="M20 24 L4 14 L9 44 L20 51 Z" style="fill:var(--rune,#ff9a2e)" opacity="0.5" />
      <path d="M20 4 L20 48" stroke="#fff" stroke-opacity="0.35" stroke-width="0.9" />
    </svg>
  );
}
