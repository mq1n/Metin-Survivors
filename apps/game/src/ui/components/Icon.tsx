// IconArt: the painted item icon from the manifest, or — until Imagegen has produced it — a procedurally composed SVG
// tile (element-tinted vignette + engraved glyph + gold ring) so the UI never shows a hole or a broken image.
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { ClassId, Element, EmpireId } from '../../data/schema';
import { iconForm, iconIdForRank, iconUrl, texUrl } from '../assets';
import { Glyph, glyphPaths, type GlyphName } from './glyphs';
import { CurrencyIcon } from './StatIcon';

export type IconKind = 'skill' | 'passive' | 'stone' | 'trinket' | 'gear' | 'talent' | 'misc';

export const ELEMENT_COLOR: Record<Element, string> = {
  physical: '#e8dcb0',
  fire: '#ff6a2a',
  ice: '#6fd6ff',
  lightning: '#7ab4ff',
  dark: '#9a5cff',
  poison: '#8be03c',
  holy: '#ffd36a',
  wind: '#8fe3c0',
};

export const CLASS_COLOR: Record<ClassId, string> = {
  warrior: '#e8c36a',
  ninja: '#59c79a',
  yacha: '#a46bff',
  shaman: '#5aa0ff',
  wolfman: '#e0483a',
};

export const CLASS_GLYPH: Record<ClassId, GlyphName> = {
  warrior: 'sword',
  ninja: 'daggers',
  yacha: 'flame',
  shaman: 'bolt',
  wolfman: 'wolf',
};

export const EMPIRE_COLOR: Record<EmpireId, string> = {
  saehwa: '#c8281e',
  chowon: '#d8b020',
  jihae: '#2a62c8',
};

export const EMPIRE_GLYPH: Record<EmpireId, GlyphName> = {
  saehwa: 'dragon',
  chowon: 'crown',
  jihae: 'shield',
};

const KEYWORDS: [RegExp, GlyphName, Element?][] = [
  [/arrow|bow|shot|volley|quiver/, 'bow'],
  [/dagger|blade_?spin|stab|ambush|assassin|rolling/, 'daggers'],
  [/sword|blade|slash|cut|strike|cleave|aura_sword|saber/, 'sword'],
  [/fire|flame|burn|ember|inferno|hell|blaze|meteor/, 'flame', 'fire'],
  [/ice|frost|snow|freez|cold|blizzard/, 'frost', 'ice'],
  [/lightning|thunder|bolt|storm|spark|shock/, 'bolt', 'lightning'],
  [/poison|venom|toxic|cloud|plague/, 'drop', 'poison'],
  [/wind|gale|swirl|tornado|breath|dash|lunge|haste|swift/, 'wind', 'wind'],
  [/dark|shadow|ghost|phantom|death|fear|curse|soul|wraith/, 'skull', 'dark'],
  [/wolf|claw|fang|rend|shred|pounce|howl/, 'wolf'],
  [/dragon/, 'dragon'],
  [/heal|life|cure|vital|blood|regen|heart/, 'heart', 'holy'],
  [/shield|armor|guard|ward|protect|fortif|resist/, 'shield'],
  [/talisman|charm|seal|sigil/, 'talisman'],
  [/crit|fury|rage|berserk|wrath/, 'fist'],
  [/gold|yeop|coin|thief|greed|wealth/, 'coin', 'holy'],
  [/luck|fortune|charisma|eye|vision|sight/, 'eye', 'holy'],
  [/leader|crown|king|command/, 'crown', 'holy'],
  [/orb|circle|sphere/, 'orb'],
];

const SLOT_GLYPH: Record<string, GlyphName> = {
  weapon: 'sword',
  armor: 'shield',
  helmet: 'helmet',
  shield: 'shield',
  shoes: 'boot',
  bracelet: 'bracelet',
  necklace: 'amulet',
  earrings: 'earring',
  earring: 'earring',
};

const HASH_GLYPHS: GlyphName[] = ['star', 'orb', 'talisman', 'gem', 'shard', 'dragon', 'eye', 'fist', 'wind', 'crown'];
const HASH_ELEMENTS: Element[] = ['physical', 'fire', 'ice', 'lightning', 'dark', 'poison', 'holy', 'wind'];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function pickGlyph(id: string, kind: IconKind, hint?: GlyphName): { glyph: GlyphName; element: Element } {
  const lower = id.toLowerCase();
  let glyph: GlyphName | undefined = hint;
  let element: Element | undefined;
  for (const [re, g, el] of KEYWORDS) {
    if (re.test(lower)) {
      if (!glyph) glyph = g;
      if (el && !element) element = el;
      if (glyph && element) break;
    }
  }
  const h = hash(id);
  if (!glyph) {
    if (kind === 'stone') glyph = 'gem';
    else if (kind === 'trinket') glyph = 'amulet';
    else if (kind === 'passive') glyph = 'talisman';
    else glyph = HASH_GLYPHS[h % HASH_GLYPHS.length] ?? 'star';
  }
  return { glyph, element: element ?? HASH_ELEMENTS[(h >>> 8) % HASH_ELEMENTS.length] ?? 'physical' };
}

export interface IconArtProps {
  /** content icon id (icon_skill_…) — also seeds the fallback glyph */
  id: string;
  kind?: IconKind;
  element?: Element;
  /** force a glyph for the fallback tile (e.g. gear slot) */
  glyph?: GlyphName;
  /** gear slot / stone slot hint */
  slot?: string;
  class?: string;
  alt?: string;
  /** skill rank index 0..7 (1, 2, 3, M1, M2, G1, G2, P): draws the re-tinted rank-band tile (`<id>__m|__g|__p`) when the
   *  manifest ships one, else the base id. Pass it wherever the rank is known (HUD slots, level-up cards, pause, armory). */
  rank?: number;
}

export function slotGlyph(slot: string): GlyphName {
  return SLOT_GLYPH[slot] ?? 'gem';
}

/** Painted icon with a procedural fallback tile. Fills its container. The <img> carries its pipeline form as
 *  `ms-icon--tile | --cutout | --legacy` (ART.md s5: tile = octagon tile with its own frame, cutout = transparent object,
 *  legacy = opaque square) so slots can fit it: tiles / cut-outs `contain`, legacy squares are masked to the slot shape. */
interface IconFailState {
  key: string;
  failed: readonly string[];
}

/** Selects the next non-failed icon candidate (`rid` then `id`) with an available URL, or null once all fail. */
export function selectIconCandidate(id: string, rid: string, failed: readonly string[], urlOf: (iconId: string) => string | null = iconUrl): { useId: string; url: string } | null {
  const candidates = rid !== id ? [rid, id] : [id];
  for (const cand of candidates) {
    if (failed.includes(cand)) continue;
    const url = urlOf(cand);
    if (url) return { useId: cand, url };
  }
  return null;
}

export function IconArt({ id, kind = 'misc', element, glyph, slot, class: cls, alt, rank }: IconArtProps): JSX.Element {
  const rid = iconIdForRank(id, rank);
  const key = `${id}\0${rank ?? ''}\0${rid}`;
  // Monotonic per-(id, rank) failure list: rank-band fails -> tries base -> base fails -> procedural SVG (never oscillates).
  const [failState, setFailState] = useState<IconFailState>({ key, failed: [] });
  const failed = failState.key === key ? failState.failed : [];
  const chosen = selectIconCandidate(id, rid, failed);
  if (chosen) {
    const form = iconForm(chosen.useId) ?? 'legacy';
    return (
      <img
        class={`${cls ?? ''} ms-icon--${form}`.trim()}
        src={chosen.url}
        alt={alt ?? ''}
        draggable={false}
        decoding="async"
        onError={() =>
          setFailState((prev) => {
            const list = prev.key === key ? prev.failed : [];
            return list.includes(chosen.useId) ? prev : { key, failed: [...list, chosen.useId] };
          })
        }
      />
    );
  }
  const hint = glyph ?? (slot ? slotGlyph(slot) : undefined);
  const picked = pickGlyph(id, kind, hint);
  const el = element ?? picked.element;
  const color = ELEMENT_COLOR[el];
  const g = picked.glyph;
  const gid = `ms-ig-${el}`;
  return (
    <svg class={cls} viewBox="0 0 64 64" role="img" aria-label={alt ?? ''} preserveAspectRatio="xMidYMid slice">
      <defs>
        <radialGradient id={`${gid}-bg`} cx="50%" cy="42%" r="75%">
          <stop offset="0" stop-color={color} stop-opacity=".5" />
          <stop offset=".55" stop-color={color} stop-opacity=".12" />
          <stop offset="1" stop-color="#0d0a08" stop-opacity="1" />
        </radialGradient>
        <linearGradient id={`${gid}-fg`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#fffbe8" />
          <stop offset=".45" stop-color={color} />
          <stop offset="1" stop-color={color} stop-opacity=".55" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" fill="#0d0a08" />
      <rect width="64" height="64" fill={`url(#${gid}-bg)`} />
      <circle cx="32" cy="32" r="25" fill="none" stroke="#e8c36a" stroke-opacity=".28" stroke-width="1" />
      <circle cx="32" cy="32" r="21" fill="none" stroke={color} stroke-opacity=".3" stroke-width="1.2" stroke-dasharray="2 3" />
      <g transform="translate(13 13) scale(1.58)" fill={`url(#${gid}-fg)`} stroke="#0d0a08" stroke-width=".7" stroke-linejoin="round" style={{ filter: `drop-shadow(0 0 2px ${color})` }}>
        {glyphPaths(g)}
      </g>
      <rect width="64" height="64" fill="none" stroke={color} stroke-opacity=".35" stroke-width="3" />
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Emblems (class / empire / doctrine marks)

export interface EmblemProps {
  glyph: GlyphName;
  color: string;
  size?: string;
  class?: string;
}

/** Round heraldic medallion: dark disc, coloured ring, glyph. */
export function Emblem({ glyph, color, size = '1.8rem', class: cls }: EmblemProps): JSX.Element {
  return (
    <span class={`ms-emblem ${cls ?? ''}`} style={{ width: size, height: size }}>
      <svg viewBox="0 0 48 48">
        <circle cx="24" cy="24" r="22" fill="#120b08" stroke={color} stroke-width="2.2" />
        <circle cx="24" cy="24" r="18.5" fill={color} fill-opacity=".16" stroke="#e8c36a" stroke-opacity=".55" stroke-width=".8" />
        <g transform="translate(10 10) scale(1.17)" fill={color} stroke="#0d0a08" stroke-width=".5" stroke-linejoin="round">
          {glyphPaths(glyph)}
        </g>
      </svg>
    </span>
  );
}

/** The painted gold-relief crest (`uk_crest_class_<id>` round medallion / `uk_crest_empire_<id>` hanging banner, 256 px, transparent, plus the
 *  simplified small-size twin `<id>_sm` for boxes up to SMALL_CREST_REM) when the
 *  manifest ships it, else (or when the file fails to load) the drawn glyph medallion. One crest family, reused by every screen that
 *  draws a class or an empire mark through ClassEmblem / EmpireEmblem. */
function CrestEmblem({ id, size = '1.8rem', nominal, fallback }: { id: string; size?: string; nominal?: string; fallback: JSX.Element }): JSX.Element {
  const [failed, setFailed] = useState<readonly string[]>([]);
  // Up to SMALL_CREST_REM the simplified twin (`<id>_sm`: same painted gold relief, a bolder rope rim with fewer twists, 2-3 chunky motif
  // shapes, heavy outline) is drawn: the full relief turns into filigree mush below ~64 px (the twin stays readable at 24-64 px).
  // Relative sizes (100 %, em) and bigger boxes keep the full crest, unless `nominal` (the real box in rem / px, for a box that a parent
  // sizes: online screens pass size 100 %) says it is small.
  const smallId = `${id}_sm`;
  const rem = crestRem(nominal ?? size);
  const smallUrl = rem !== null && rem <= SMALL_CREST_REM && !failed.includes(smallId) ? texUrl(smallId) : null;
  const url = smallUrl ?? (failed.includes(id) ? null : texUrl(id));
  if (!url) return fallback;
  const shown = smallUrl ? smallId : id;
  return (
    <span class="ms-emblem ms-emblem--crest" style={{ width: size, height: size }}>
      <img src={url} alt="" draggable={false} decoding="async" onError={() => setFailed((f) => [...f, shown])} />
    </span>
  );
}

/** Crest boxes up to this size (rem, 1 rem = 16 px at 1080p) use the simplified `_sm` twin. */
const SMALL_CREST_REM = 4;

/** CSS size in rem (px counts as 1/16 rem); null for relative sizes. */
function crestRem(size: string): number | null {
  const m = /^(\d*\.?\d+)(rem|px)$/.exec(size.trim());
  if (!m) return null;
  return m[2] === 'px' ? Number(m[1]) / 16 : Number(m[1]);
}

export function ClassEmblem({ classId, size, nominal }: { classId: ClassId; size?: string; nominal?: string }): JSX.Element {
  const fallback = <Emblem glyph={CLASS_GLYPH[classId]} color={CLASS_COLOR[classId]} {...(size ? { size } : {})} />;
  return <CrestEmblem id={`uk_crest_class_${classId}`} {...(size ? { size } : {})} {...(nominal ? { nominal } : {})} fallback={fallback} />;
}

export function EmpireEmblem({ empire, size, nominal }: { empire: EmpireId; size?: string; nominal?: string }): JSX.Element {
  const fallback = <Emblem glyph={EMPIRE_GLYPH[empire]} color={EMPIRE_COLOR[empire]} {...(size ? { size } : {})} />;
  return <CrestEmblem id={`uk_crest_empire_${empire}`} {...(size ? { size } : {})} {...(nominal ? { nominal } : {})} fallback={fallback} />;
}

/**
 * Currency / resource icon (C11): the multi-colour engraved objects of StatIcon.tsx (brass cash-coin stack, lava obsidian
 * shard, bone skull, bronze hourglass, amber pearl). `legacy` keeps the old single-colour glyph. It carries `.ms-icon-inline`
 * too, so screen rules that size or position the old glyph keep working.
 */
export function Currency({ kind, size, legacy }: { kind: 'yeop' | 'shard' | 'kills' | 'time' | 'xp'; size?: string; legacy?: boolean }): JSX.Element {
  if (!legacy) return <CurrencyIcon kind={kind} class="ms-icon-inline" {...(size ? { size } : {})} />;
  const map = {
    yeop: { g: 'coin', c: '#f2c64c' },
    shard: { g: 'shard', c: '#ff7a4a' },
    kills: { g: 'skull', c: '#e8dcb0' },
    time: { g: 'clock', c: '#e8c36a' },
    xp: { g: 'star', c: '#e8a33a' },
  } as const satisfies Record<string, { g: GlyphName; c: string }>;
  const m = map[kind];
  return <Glyph name={m.g} style={{ color: m.c, ...(size ? { width: size, height: size } : {}) }} />;
}
