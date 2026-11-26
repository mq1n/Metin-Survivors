// Art pieces shared by the Leaderboard and the Co-op lobby (owner: B13 online). Everything here is drawn from our own
// geometry (inline SVG + CSS in online.css): octagon class seals with a portrait face crop, laurel rank plates for the top
// three, cloth empire flags, seal-and-scene emblems for the empty / error / offline / waiting states, the zone art plate
// (a kit plate whose face is the painted zone card) and a few small glyphs the kit does not carry (copy, share, refresh,

// banners, number wells); no pixel, glyph or emblem shape is reused.
import type { ClassId, EmpireId, ZoneDef } from '../../data/schema';
import type { ComponentChildren, JSX } from 'preact';
import { portraitFaceCropUrl, portraitUrl, texUrl, zoneArtUrl } from '../assets';
import { glyphPaths } from '../components/glyphs';
import { CLASS_COLOR, CLASS_GLYPH, EMPIRE_COLOR, ClassEmblem as CrestClassEmblem, EmpireEmblem as CrestEmpireEmblem } from '../components/Icon';
import { zoneName } from '../content';
import { tipProps } from '../components/Tooltip';
import { UiGlyph } from '../components/StatIcon';
import { sfx } from '../audio';

// ---------------------------------------------------------------------------------------------------------------
// Class seal: an octagon cell with the class portrait's face (or the class glyph when no portrait ships) inside a pewter /
// bronze ring (the painted uk_online_octring when shipped, CSS bevel otherwise). `size` is the edge of the octagon. The
// round colour gem and the level chip of round 1 are gone: the class is named in text and the level is a text label.

export function ClassSeal({ classId, size = '2.8rem', sex = 'm', class: cls }: { classId: ClassId; size?: string; sex?: 'm' | 'f'; class?: string }): JSX.Element {
  // the 256 px face crop (framed by the file, 16 KB) when it ships; the bust with a scaled crop (see online.css) otherwise
  const face = portraitFaceCropUrl(classId, sex);
  const art = face ?? portraitUrl(classId, sex);
  const ring = texUrl(OL_TEX_OPT.ring);
  return (
    <span class={`ms-ol-seal ${ring ? 'has-ring' : ''} ${cls ?? ''}`} style={`--sz:${size};--cc:${CLASS_COLOR[classId]}${ring ? `;--ring-art:url("${ring}")` : ''}`}>
      <span class={`ms-ol-seal-face ${face ? 'is-face' : ''}`} style={art ? `background-image:url("${art}")` : ''}>
        {!art && (
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            {glyphPaths(CLASS_GLYPH[classId])}
          </svg>
        )}
      </span>
    </span>
  );
}

/** Class emblem: the shared gold-relief crest (`uk_crest_class_<id>`, components/Icon.tsx) when shipped; else the engraved brass glyph of a class on a
 *  recessed octagon disc (painted sprite when shipped, CSS drawing otherwise). The span keeps the screen sizing hooks (--sz, class). */
const EMBLEM_CELL: Record<ClassId, number> = {
  warrior: 0,
  ninja: 25,
  yacha: 50,
  shaman: 75,
  wolfman: 100,
};

export function ClassEmblem({ classId, size = '1.8rem', class: cls }: { classId: ClassId; size?: string; class?: string }): JSX.Element {
  if (texUrl(`uk_crest_class_${classId}`)) {
    // the span sizes the box (--sz), the crest fills it; `nominal` picks the simplified small twin for a box this small
    return (
      <span class={`ms-ol-emb is-crest ${cls ?? ''}`} style={`--sz:${size}`} aria-hidden="true">
        <CrestClassEmblem classId={classId} size="100%" nominal={size} />
      </span>
    );
  }
  const sheet = texUrl(OL_TEX_OPT.emblems);
  if (sheet) {
    return <span class={`ms-ol-emb is-art ${cls ?? ''}`} style={`--sz:${size};--emb-art:url("${sheet}");--emb-x:${EMBLEM_CELL[classId]}%`} aria-hidden="true" />;
  }
  return (
    <span class={`ms-ol-emb ${cls ?? ''}`} style={`--sz:${size}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="currentColor">
        {glyphPaths(CLASS_GLYPH[classId])}
      </svg>
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Tag plate: a stone plate (kit plate recipe: chamfer + 4-edge bevel + textured face) with a small rivet at each end. It
// replaces the flat kit chips next to raster art (YOU, HOST, VICTORY / DEFEAT, doctrine, tier, filter summaries).

export type TagTone = 'stone' | 'gold' | 'wine';

export function OlTag({ tone = 'stone', icon, children, class: cls, title }: { tone?: TagTone; icon?: JSX.Element; children?: ComponentChildren; class?: string; title?: string }): JSX.Element {
  return (
    <span class={`ms-ol-tag ms-plate ms-ol-tag--${tone} ${cls ?? ''}`} title={title}>
      <i class="ms-ol-tag-rv" aria-hidden="true" />
      {icon !== undefined && (
        <span class="ms-ol-tag-ico" aria-hidden="true">
          {icon}
        </span>
      )}
      <span class="ms-ol-tag-t">{children}</span>
      <i class="ms-ol-tag-rv" aria-hidden="true" />
    </span>
  );
}

/** Octagon seal with a glyph / bust engraved on its dark face (card icons, empty party seats); same ring as the class seals. */
export function GlyphSeal({ size = '3rem', dim, children }: { size?: string; dim?: boolean; children?: ComponentChildren }): JSX.Element {
  const ring = texUrl(OL_TEX_OPT.ring);
  return (
    <span class={`ms-ol-seal ms-ol-seal--glyph ${ring ? 'has-ring' : ''} ${dim ? 'is-dim' : ''}`} style={`--sz:${size}${ring ? `;--ring-art:url("${ring}")` : ''}`}>
      <span class="ms-ol-seal-face">{children}</span>
    </span>
  );
}

/** Empty party seat: the painted octagon socket medallion (uk_online_empty_seat: bronze rim, carved bust) when shipped, the drawn ring + bust otherwise. */
export function EmptySeat({ size = '4rem' }: { size?: string }): JSX.Element {
  const art = texUrl(OL_TEX_OPT.seat);
  if (!art) {
    return (
      <GlyphSeal size={size} dim>
        <Silhouette />
      </GlyphSeal>
    );
  }
  return <span class="ms-ol-seat" style={`--sz:${size};--seat-art:url("${art}")`} aria-hidden="true" />;
}

/** Carved bust (head and shoulders) for the empty seats of the party. */
export function Silhouette(): JSX.Element {
  return (
    <svg class="ms-ol-sil" viewBox="0 0 64 64" aria-hidden="true">
      <path d="M32 11c-6.8 0-11.4 5.2-11.4 11.6 0 5.3 2.8 9.9 7.1 11.9C19.4 37.4 12 43.6 12 52.7V57h40v-4.3c0-9.1-7.4-15.3-15.7-18.2 4.3-2 7.1-6.6 7.1-11.9C43.4 16.2 38.8 11 32 11z" fill="currentColor" />
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Rank plate for places 1-3: an octagon plate of gold / silver / bronze between two laurel sprays, the numeral engraved.

const METAL: Record<number, [string, string, string, string]> = {
  1: ['#fff3c2', '#e6bd54', '#94661a', '#4a2f06'],
  2: ['#ffffff', '#cfd4dc', '#80878f', '#3f444d'],
  3: ['#ffdcb8', '#d58f52', '#86481b', '#3d1e08'],
};

function laurel(side: 1 | -1): JSX.Element[] {
  const leaves: JSX.Element[] = [];
  for (let i = 0; i < 6; i++) {
    const a = ((98 + i * 15) * Math.PI) / 180;
    const r = 21.4 - i * 0.4;
    let x = 24 + Math.cos(a) * r;
    const y = 24 + Math.sin(a) * r;
    let rot = (a * 180) / Math.PI + 90;
    if (side === -1) {
      x = 48 - x;
      rot = 180 - rot;
    }
    leaves.push(<ellipse key={`${side}${i}`} cx={x.toFixed(2)} cy={y.toFixed(2)} rx="3.1" ry="1.45" transform={`rotate(${rot.toFixed(1)} ${x.toFixed(2)} ${y.toFixed(2)})`} />);
  }
  return leaves;
}

/** Painted textures of this target (uk_online_*, shipped through the imagegen CLI). Every use has a drawn fallback. */
export const OL_TEX = {
  leather: 'uk_online_leather',
  plates: 'uk_online_rank_plates',
  seals: 'uk_online_state_seals',
} as const;
/** Round 2 textures: used when shipped (the octagon seal ring, the class emblem sprite: 5 equal cells), a CSS drawing otherwise. */
export const OL_TEX_OPT = {
  ring: 'uk_online_octring',
  emblems: 'uk_online_class_emblems',
  seat: 'uk_online_empty_seat',
  flags: 'uk_online_empire_flags',
  hilite: 'uk_online_hilite',
} as const;

/** Inline custom properties of the two painted materials of this target: the stitched-leather strap (zone captions, column
 *  header, "your rank" bar) and the tan lit-leather plate (your row, READY straps, the active tab); empty when not shipped. */
export function leatherStyle(): string {
  const parts: string[] = [];
  const u = texUrl(OL_TEX.leather);
  if (u) parts.push(`--ol-leather:url("${u}")`);
  const h = texUrl(OL_TEX_OPT.hilite);
  if (h) parts.push(`--ol-hilite:url("${h}")`);
  return parts.join(';');
}

/** Sprite cell (background-position-x, %) of each painted cell: 3 equal cells per sheet. */
const PLATE_CELL: Record<1 | 2 | 3, number> = { 1: 0, 2: 50, 3: 100 };

export function RankPlate({ rank }: { rank: 1 | 2 | 3 }): JSX.Element {
  const sheet = texUrl(OL_TEX.plates);
  if (sheet) {
    // painted octagon plate (gold / silver / bronze) between two laurel sprays; the numeral is engraved text on top
    return (
      <span class={`ms-ol-rank ms-ol-rank--${rank} is-art`} style={`--plate-art:url("${sheet}");--plate-x:${PLATE_CELL[rank]}%`} role="img" aria-label={`#${rank}`}>
        <b class="ms-ol-rank-n ms-num" aria-hidden="true">
          {rank}
        </b>
      </span>
    );
  }
  const m = METAL[rank] ?? METAL[1]!;
  const gid = `olr${rank}`;
  return (
    <svg class={`ms-ol-rank ms-ol-rank--${rank}`} viewBox="0 0 48 48" role="img" aria-label={`#${rank}`}>
      <defs>
        <linearGradient id={gid} x1=".15" y1="0" x2=".85" y2="1">
          <stop offset="0" stop-color={m[0]} />
          <stop offset=".42" stop-color={m[1]} />
          <stop offset=".78" stop-color={m[2]} />
          <stop offset="1" stop-color={m[3]} />
        </linearGradient>
        <linearGradient id={`${gid}b`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#0d0b09" stop-opacity=".1" />
          <stop offset="1" stop-color="#0d0b09" stop-opacity=".55" />
        </linearGradient>
      </defs>
      <g fill={`url(#${gid})`} stroke="#0b0a09" stroke-width=".55">
        {laurel(1)}
        {laurel(-1)}
      </g>
      <path d="M17.6 6.2h12.8l10.4 10.4v14.8L30.4 41.8H17.6L7.2 31.4V16.6z" fill="#0b0a09" />
      <path d="M18.2 7.5h11.6l9.7 9.7v13.6l-9.7 9.7H18.2l-9.7-9.7V17.2z" fill={`url(#${gid})`} />
      <path d="M18.2 7.5h11.6l9.7 9.7v13.6l-9.7 9.7H18.2l-9.7-9.7V17.2z" fill={`url(#${gid}b)`} />
      <path d="M19 10h10l8.2 8.2v11.6L29 38H19l-8.2-8.2V18.2z" fill="none" stroke={m[3]} stroke-opacity=".6" stroke-width=".9" />
      <path d="M18.8 8.7h10.4l9 9" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width=".9" />
      <text x="24" y="31.2" text-anchor="middle" class="ms-ol-rank-n" fill={m[3]}>
        {rank}
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Empire flag: a small cloth banner on a top bar, the empire colour, an original crest per empire.

const CREST: Record<EmpireId, JSX.Element> = {
  // flame crest: three tongues over a base bar
  saehwa: (
    <path d="M12 6.5c1.6 2.3 3.6 3.2 3.6 5.8 0 1.2-.6 2.1-1.4 2.6.1-1.2-.4-2-1.2-2.8.1 1.5-.8 2.1-1.4 3.1-.8-1-1.6-1.7-1.5-3.2-.9.8-1.4 1.6-1.3 2.8-.9-.6-1.5-1.6-1.5-2.9 0-2.7 2.2-3.3 3.7-5.4zM8.6 18.2h6.8v1.5H8.6z" />
  ),
  // sun crest: disc with eight rays
  chowon: (
    <g>
      <circle cx="12" cy="13" r="3.1" />
      <path d="M12 6.4v2.2M12 17.4v2.2M5.4 13h2.2M16.4 13h2.2M7.4 8.4l1.6 1.6M15 16l1.6 1.6M16.6 8.4 15 10M9 16l-1.6 1.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" fill="none" />
    </g>
  ),
  // wave crest: crescent over two swells
  jihae: <path d="M14.8 6.8a5.2 5.2 0 1 0 2.4 8.9 4.2 4.2 0 0 1-2.4-8.9zM6.6 17.6c1.1-1.2 2.2-1.2 3.3 0s2.2 1.2 3.3 0 2.2-1.2 3.3 0v1.5c-1.1-1.2-2.2-1.2-3.3 0s-2.2 1.2-3.3 0-2.2-1.2-3.3 0z" />,
};

export function EmpireFlag({ empire, size = '2rem', class: cls, title }: { empire: EmpireId; size?: string; class?: string; title?: string }): JSX.Element {
  const c = EMPIRE_COLOR[empire];
  return (
    <svg class={`ms-ol-flag ${cls ?? ''}`} viewBox="0 0 24 32" style={`height:${size};width:calc(${size} * .75)`} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : 'true'}>
      <defs>
        <linearGradient id={`olf-${empire}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#fff" stop-opacity=".28" />
          <stop offset=".35" stop-color="#fff" stop-opacity="0" />
          <stop offset="1" stop-color="#000" stop-opacity=".5" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="22" height="3.4" rx="1" fill="#6b645b" stroke="#0b0a09" stroke-width=".8" />
      <rect x="1.6" y="1.6" width="20.8" height="1" fill="#cfc7b8" opacity=".55" />
      <circle cx="3" cy="2.7" r="1" fill="#e8dfcf" />
      <circle cx="21" cy="2.7" r="1" fill="#e8dfcf" />
      <path d="M3 4.4h18v21.6l-9 4.4-9-4.4z" fill={c} stroke="#0b0a09" stroke-width=".9" stroke-linejoin="round" />
      <path d="M3 4.4h18v21.6l-9 4.4-9-4.4z" fill={`url(#olf-${empire})`} />
      <path d="M4.6 6h14.8v19l-7.4 3.6-7.4-3.6z" fill="none" stroke="#f6e2a2" stroke-opacity=".6" stroke-width=".7" />
      <g fill="#f6e2a2" style="color:#f6e2a2" transform="translate(0 1.4)">
        {CREST[empire]}
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Empire banner: the painted horizontal cloth banner (uk_online_empire_flags: red / golden-yellow / blue, a gold pattern band


/** Top-left of each banner in the 1024 px sheet, as a multiple of the banner width (x is shared: 184 px of a 655 px banner). */
const BANNER_Y: Record<EmpireId, number> = {
  saehwa: -0.087,
  chowon: -0.5771,
  jihae: -1.0656,
};

/** `uk_crest_empire_<id>` shield of the shared crest family: drawn this much of the old banner width tall (the shield is 0.91 wide : tall). */
const CREST_OF_BANNER = 0.7;

export function EmpireBanner({ empire, width = '2.8rem', class: cls, title }: { empire: EmpireId; width?: string; class?: string; title?: string }): JSX.Element {
  if (texUrl(`uk_crest_empire_${empire}`)) {
    // the shared empire crest (gold-relief shield) in the banner's box: --fw stays the layout hook (the phone rules shrink it), the shield is a fraction of it
    const w = /^(\d*\.?\d+)rem$/.exec(width.trim());
    return (
      <span class={`ms-ol-eflag is-crest ${cls ?? ''}`} style={`--fw:${width}`} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : 'true'}>
        <CrestEmpireEmblem empire={empire} size="100%" {...(w ? { nominal: `${(Number(w[1]) * CREST_OF_BANNER).toFixed(2)}rem` } : {})} />
      </span>
    );
  }
  const sheet = texUrl(OL_TEX_OPT.flags);
  if (!sheet) return <EmpireFlag empire={empire} size={`calc(${width} * 0.6)`} class={cls} title={title} />;
  return (
    <span class={`ms-ol-eflag ${cls ?? ''}`} style={`--fw:${width};--flag-art:url("${sheet}");--fy:${BANNER_Y[empire]}`} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : 'true'} />
  );
}

// ---------------------------------------------------------------------------------------------------------------
// State seals: a bronze octagon medallion with a small engraved scene — replaces the icon-in-a-circle messages.

export type SealKind = 'empty' | 'error' | 'offline' | 'wait';

/** Painted cell of each kind in uk_online_state_seals (scroll, cracked tablet, lantern with cut signal); 'wait' stays drawn. */
const SEAL_CELL: Partial<Record<SealKind, number>> = {
  empty: 0,
  error: 50,
  offline: 100,
};

export function StateSeal({ kind, size = '7.5rem' }: { kind: SealKind; size?: string }): JSX.Element {
  const sheet = texUrl(OL_TEX.seals);
  const cell = SEAL_CELL[kind];
  if (sheet && cell !== undefined) {
    return <span class={`ms-ol-stateseal ms-ol-stateseal--${kind} is-art`} style={`width:${size};height:${size};--seal-art:url("${sheet}");--seal-x:${cell}%`} aria-hidden="true" />;
  }
  return (
    <svg class={`ms-ol-stateseal ms-ol-stateseal--${kind}`} viewBox="0 0 120 120" style={`width:${size};height:${size}`} aria-hidden="true">
      <defs>
        <linearGradient id="olsb" x1=".1" y1="0" x2=".9" y2="1">
          <stop offset="0" stop-color="#e2c78a" />
          <stop offset=".35" stop-color="#9a7335" />
          <stop offset=".7" stop-color="#5a3f1c" />
          <stop offset="1" stop-color="#2b1c0b" />
        </linearGradient>
        <radialGradient id="olsd" cx=".5" cy=".38" r=".75">
          <stop offset="0" stop-color="#3a3029" />
          <stop offset=".6" stop-color="#17130f" />
          <stop offset="1" stop-color="#0b0907" />
        </radialGradient>
        <linearGradient id="olsp" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#e9dcb4" />
          <stop offset="1" stop-color="#a89460" />
        </linearGradient>
        <linearGradient id="olss" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#bdb5a6" />
          <stop offset="1" stop-color="#4e4a43" />
        </linearGradient>
      </defs>
      {/* cloud-scroll wings either side of the seal */}
      <g fill="none" stroke="#7d6a47" stroke-width="2.4" stroke-linecap="round" opacity=".85">
        <path d="M6 60c6-9 14-9 17-3s-4 9-7 4" />
        <path d="M114 60c-6-9-14-9-17-3s4 9 7 4" />
      </g>
      <path d="M40 8h40l32 32v40l-32 32H40L8 80V40z" fill="#0b0a09" />
      <path d="M41.5 11h37l29.5 29.5v39L78.5 109h-37L12 79.5v-39z" fill="url(#olsb)" />
      <path d="M45 17h30l28 28v30L75 103H45L17 75V45z" fill="#0b0a09" />
      <path d="M46.2 19.4h27.6l26.8 26.8v27.6l-26.8 26.8H46.2L19.4 73.8V46.2z" fill="url(#olsd)" />
      <path d="M46.2 19.4h27.6l26.8 26.8" fill="none" stroke="#fff" stroke-opacity=".2" stroke-width="1" />
      {kind === 'empty' && (
        <g>
          <rect x="34" y="34" width="52" height="40" rx="2" fill="url(#olsp)" stroke="#0b0a09" stroke-width="1.6" />
          <rect x="30" y="31" width="60" height="7" rx="3.5" fill="url(#olss)" stroke="#0b0a09" stroke-width="1.4" />
          <rect x="30" y="70" width="60" height="7" rx="3.5" fill="url(#olss)" stroke="#0b0a09" stroke-width="1.4" />
          <path d="M41 47h38M41 55h38M41 63h24" stroke="#7a6a3c" stroke-width="1.7" stroke-linecap="round" opacity=".55" />
          <path d="M60 77v8M56 85h8l-1 6h-6z" fill="#b8312a" stroke="#0b0a09" stroke-width="1.2" stroke-linejoin="round" />
          <g fill="#c9a24a" stroke="#0b0a09" stroke-width=".7">
            <ellipse cx="36" cy="88" rx="5.4" ry="2.3" transform="rotate(-36 36 88)" />
            <ellipse cx="42" cy="93" rx="5.4" ry="2.3" transform="rotate(-12 42 93)" />
            <ellipse cx="84" cy="88" rx="5.4" ry="2.3" transform="rotate(36 84 88)" />
            <ellipse cx="78" cy="93" rx="5.4" ry="2.3" transform="rotate(12 78 93)" />
          </g>
        </g>
      )}
      {kind === 'error' && (
        <g>
          <path d="M45 34h30l8 8v36l-8 8H45l-8-8V42z" fill="url(#olss)" stroke="#0b0a09" stroke-width="1.8" stroke-linejoin="round" />
          <path d="M45 34h30l8 8" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="1.2" />
          <path d="M62 34l-6 14 9 6-8 12 6 8" fill="none" stroke="#0b0a09" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round" />
          <path d="M62 34l-6 14 9 6-8 12 6 8" fill="none" stroke="#e8803a" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round" />
          <g fill="#ffb060">
            <circle cx="52" cy="80" r="1.6" />
            <circle cx="73" cy="38" r="1.3" />
            <circle cx="46" cy="60" r="1.2" />
          </g>
        </g>
      )}
      {kind === 'offline' && (
        <g fill="none" stroke-linecap="round">
          <path d="M33 56a39 39 0 0 1 54 0" stroke="#0b0a09" stroke-width="7" />
          <path d="M41 65a27 27 0 0 1 38 0" stroke="#0b0a09" stroke-width="7" />
          <path d="M49 73a15 15 0 0 1 22 0" stroke="#0b0a09" stroke-width="7" />
          <path d="M33 56a39 39 0 0 1 54 0" stroke="#7a6a52" stroke-width="3.6" />
          <path d="M41 65a27 27 0 0 1 38 0" stroke="#7a6a52" stroke-width="3.6" />
          <path d="M49 73a15 15 0 0 1 22 0" stroke="#7a6a52" stroke-width="3.6" />
          <circle cx="60" cy="82" r="4.2" fill="#7a6a52" stroke="#0b0a09" stroke-width="1.5" />
          <path d="M38 36l44 52" stroke="#0b0a09" stroke-width="8" />
          <path d="M38 36l44 52" stroke="#d6483a" stroke-width="4" />
        </g>
      )}
      {kind === 'wait' && (
        <g stroke="#0b0a09" stroke-width="1.6" stroke-linejoin="round">
          <rect x="39" y="30" width="42" height="6" rx="2" fill="url(#olss)" />
          <rect x="39" y="84" width="42" height="6" rx="2" fill="url(#olss)" />
          <path d="M43 36h34c0 12-8 15-12 24 4 9 12 12 12 24H43c0-12 8-15 12-24-4-9-12-12-12-24z" fill="#cbb98a" fill-opacity=".22" />
          <path d="M47 38h26c-1 7-6 11-13 16-7-5-12-9-13-16z" fill="#e0a43a" stroke="none" />
          <path d="M52 84h16c-2-7-5-10-8-14-3 4-6 7-8 14z" fill="#e0a43a" stroke="none" />
          <path d="M60 54v16" stroke="#e0a43a" stroke-width="1.6" fill="none" />
        </g>
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Zone art plate: a kit plate (chamfered, pewter bevel) whose face is the painted zone card; caption on a rust strip.

/** `short` = a one-word caption that replaces the full name where the plate is narrow (phone landscape); the full name stays the accessible name. */
export function ZoneTab({ zone, active, locked, name, short, tip, onPick }: { zone: Pick<ZoneDef, 'id' | 'art'>; active: boolean; locked?: boolean; name?: string; short?: string; tip?: () => JSX.Element; onPick: () => void }): JSX.Element {
  const art = zoneArtUrl(zone);
  const label = name ?? zoneName(zone.id);
  const handlers = tip ? tipProps(tip) : {};
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      aria-label={short ? label : undefined}
      aria-disabled={locked ? 'true' : undefined}
      data-nav=""
      class={`ms-ol-zone ms-plate ${active ? 'is-active' : ''} ${locked ? 'is-locked' : ''}`}
      style={`${art ? `--zone-art:url("${art}");` : ''}${leatherStyle()}`}
      {...handlers}
      onClick={() => {
        if (locked) {
          sfx('error');
          return;
        }
        if (!active) {
          sfx('tab');
          onPick();
        }
      }}
    >
      <span class="ms-ol-zone-cap">
        {locked && <UiGlyph name="lock" tone="pewter" flat />}
        <span class="ms-ol-zone-name">{label}</span>
        {short && (
          <span class="ms-ol-zone-name ms-ol-zone-short" aria-hidden="true">
            {short}
          </span>
        )}
      </span>
      {active && <i class="ms-ol-zone-lit" aria-hidden="true" />}
    </button>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Small glyphs

export function CopyGlyph(): JSX.Element {
  return (
    <svg class="ms-ol-ico" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 3.5h7.2L19 7.3V17H8z" fill="currentColor" opacity=".9" />
      <path d="M5 7v13.5h10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
      <path d="M15 3.5V8h4" fill="none" stroke="#17130f" stroke-width="1.3" />
    </svg>
  );
}

export function ShareGlyph(): JSX.Element {
  return (
    <svg class="ms-ol-ico" viewBox="0 0 24 24" aria-hidden="true">
      <g fill="currentColor">
        <circle cx="17.5" cy="5.8" r="2.7" />
        <circle cx="6.2" cy="12" r="2.7" />
        <circle cx="17.5" cy="18.2" r="2.7" />
      </g>
      <path d="M8.4 10.8l6.9-3.9M8.4 13.2l6.9 3.9" fill="none" stroke="currentColor" stroke-width="1.7" />
    </svg>
  );
}

export function RefreshGlyph(): JSX.Element {
  return (
    <svg class="ms-ol-ico" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35Z" fill="currentColor" />
    </svg>
  );
}

/** Host marker: a gold tag plate with a small crown. */
export function CrownMedal({ label }: { label: string }): JSX.Element {
  return (
    <OlTag
      tone="gold"
      class="ms-ol-crown"
      icon={
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3.5 9l4.4 3.2L12 5l4.1 7.2L20.5 9l-1.7 9.2H5.2z" fill="currentColor" />
          <rect x="5.4" y="19" width="13.2" height="2" rx=".8" fill="currentColor" />
        </svg>
      }
    >
      {label}
    </OlTag>
  );
}
