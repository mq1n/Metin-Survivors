// PERF-03: first-use UI prewarm (qa PLAY-2). The first time a run paints a DOM surface (the story card, the HUD, the level-up cards, the pause
// board, the essence / chest / boss-reward scenes) Chrome's compositor has to compile the Skia raster shaders of every paint effect the
// surface uses (rounded rects, gradients, masks, blur / drop-shadow kernels), decode the art and the main thread pays its cold first mount
// (style + layout of a big tree, the ray sprites of UiFx: 30 - 960 ms): on a cold shader cache that is hundreds of milliseconds to seconds,
// and since the WebGL context and the compositor's raster share ONE GPU main thread every game frame waits behind it (a rAF gap with an idle
// main thread: build/PERF-01/FIRSTUSE.txt, the A/B `#ui{display:none}` makes the stalls vanish). This module pays that cost once, under the
// loading screen, where nobody waits:
//   1. decode the art the surfaces draw (img.decode() of the painted textures) and load the fonts they use (document.fonts.load);
//   2. mount every surface once with synthetic data inside the UI host, one after the other, painted for real: full viewport, `opacity: .02`,
//      NOT display:none / visibility:hidden / off-screen (those are culled before raster and compile nothing), `inert` so it takes no focus,
//      key or pointer, with the sound muted while it mounts and every CSS animation / transition finished at once (a card that starts at
//      opacity 0 and fades in over a second would otherwise paint nothing); wait four painted frames, unmount.
// App.startRun (app/app.ts) starts it with the loading screen, so it overlaps the content / world / model / terrain / shader work, and joins
// it (bounded, PREWARM_JOIN_MS) before the run screen shows. It never throws, never rejects, paints a surface once per page (one cut short by
// the join, or painted in a hidden tab, is tried again by the next run). `up=noprewarm` (dev server and VITE_QA_HOOKS builds only) switches
// it off for an A/B on one machine.
import { h, render, type ComponentChild, type JSX } from 'preact';
import type { ClassDef, ContentDB, DoctrineKey, Rarity } from '../data/schema';
import { lang, t } from '../i18n/i18n';
import type { Card, HudSnapshot, ModalRequest } from '../sim/types';
import { texUrl } from './assets';
import { Kit } from './components/Panel';
import { UiGlyph } from './components/StatIcon';
import { Motes, shineProps } from './components/UiFx';
import { deps, hasDeps } from './env';
import { BossRow } from './hud/BossPlate';
import { BuildBoard } from './hud/BuildBoard';
import { Minimap } from './hud/Minimap';
import { Taskbar } from './hud/Taskbar';
import { BossReward } from './modals/BossReward';
import { Chest } from './modals/Chest';
import { Essence } from './modals/Essence';
import { LevelUp } from './modals/LevelUp';
import { Pause } from './modals/Pause';
import { StoryModal } from './modals/Story';

// ------------------------------------------------------------------------------------------------------------------ the lists

/**
 * The surfaces, in the order a run meets them: the run-start ones first (if the join times out the late ones are the ones dropped). Each
 * is a group of its own: a cold first mount costs 3 - 50 ms of main thread for most of them but 220 - 960 ms for the essence and the boss
 * reward (style + layout of their SVG / canvas scenes, the ray sprites), and one surface per rAF turn keeps the loading screen's own work
 * from stalling behind a block of them. A group is the unit that is mounted TOGETHER (at most three full-viewport layers at once: about
 * 25 MB of raster); the table can be regrouped without touching anything else.
 */
export const PREWARM_GROUPS = [['story'], ['hud'], ['levelUp'], ['pause'], ['essence'], ['chest'], ['bossReward'], ['levelUp4']] as const;
export type SurfaceId = (typeof PREWARM_GROUPS)[number][number];
export const PREWARM_SURFACES: readonly SurfaceId[] = PREWARM_GROUPS.flat();

/**
 * Manifest texture ids the surfaces draw (as <img> or as a CSS background), decoded before the first mount. An id the manifest does not ship
 * is skipped (the CSS has a fallback for each); prewarm.test.ts checks that every id here is in the shipped manifest.
 */
export const PREWARM_TEXTURES: readonly string[] = [
  // the kit materials every board / plate paints with
  'uk_board', 'uk_rust', 'uk_stone', 'uk_lattice', 'uk_corner', 'uk_gauge_cap', 'uk_orb_ring', 'ui_panel_stone', 'ui_panel_wood', 'ui_divider_gold',
  // story card
  'uk_story_sheet', 'uk_story_swirl',
  // HUD (Hud.tsx TEX_VARS) + the gauge strips the pause / run-end gauges borrow
  'uk_hud_coin', 'uk_hud_bar', 'uk_hud_gtube', 'uk_hud_gfill_red', 'uk_hud_gfill_blue', 'uk_hud_gfill_gold', 'uk_hud_tray', 'uk_hud_lvl', 'uk_hud_tag',
  // level-up
  'uk_levelup_ring', 'uk_levelup_plaque',
  // chest + boss reward
  'art_chest_closed', 'art_chest_open', 'art_chest_boss', 'art_chest_boss_closed', 'art_chest_boss_open', 'uk_essence_chest_seal',
  // essence
  'art_metin_essence', 'uk_essence_chest_gem', 'uk_essence_chest_ember', 'uk_essence_chest_relief', 'uk_essence_chest_crystal', 'uk_essence_chest_track',
  // pause
  'uk_pause_settings_cap', 'uk_pause_settings_knob', 'uk_pause_settings_spear',
];

/** The faces the surfaces set text in (fonts.css), with a sample that needs the latin AND the latin-ext subset (Turkish). */
export const PREWARM_FONTS: readonly string[] = [
  "400 16px 'Cinzel'",
  "700 16px 'Cinzel'",
  "400 16px 'Alegreya Sans'",
  "500 16px 'Alegreya Sans'",
  "700 16px 'Alegreya Sans'",
  "italic 400 16px 'Alegreya Sans'",
  "600 16px 'Barlow Condensed'",
  "700 16px 'Barlow Condensed'",
];
const FONT_SAMPLE_EN = 'AaBbCc 0123456789 .:%+-';
const FONT_SAMPLE_TR = 'AaBbCc 0123456789 ĞÜŞİÖÇğüşıöç .:%+-';

/** painted frames each surface stays mounted: the first lets style + layout + paint run, the animations end in the second (see PREWARM_CSS), the last two cover the compositor's raster of the finished surface */
export const FRAMES_PER_SURFACE = 4;
/** one frame wait gives up after this (a hidden tab never fires rAF) */
const FRAME_WAIT_MS = 4000;
/** the whole prewarm gives up after this, whatever is left */
export const PREWARM_BUDGET_MS = 20000;

// ------------------------------------------------------------------------------------------------------------ synthetic data

type Sel = { classId: string; doctrine: DoctrineKey; zone: string };

const blank = (over: Partial<Card>): Card => ({ kind: 'newSkill', id: '', rarity: 'common', rank: 0, maxRank: 7, awakening: false, lines: [], amount: 0, slot: -1, replaces: null, ...over });

function classOf(content: ContentDB, classId: string): ClassDef | undefined {
  return content.classes.find((c) => c.id === classId) ?? content.classes[0];
}

function skillsOf(content: ContentDB, sel: Sel): string[] {
  const cls = classOf(content, sel.classId);
  const d = cls?.doctrines.find((x) => x.id === sel.doctrine) ?? cls?.doctrines[0];
  return d ? d.skills : [];
}

export interface PrewarmCards {
  /** three cards: uncommon / rare / epic, a pact line and an "awakens with" line */
  levelUp: Card[];
  /** four cards: legendary awakening, epic, rare, common heal (the legendary rim + rays) */
  levelUp4: Card[];
  /** stone / stone upgrade / trinket: epic, rare, legendary */
  essence: Card[];
  /** the boss reward: legendary awakening, epic stone, rare passive */
  boss: Card[];
}

/** The cards of the synthetic offers, from the real content (every rarity, every card family the first level-ups show). */
export function buildPrewarmCards(content: ContentDB, sel: Sel): PrewarmCards {
  const skills = skillsOf(content, sel);
  const s0 = skills[0] ?? '';
  const s1 = skills[1] ?? s0;
  const s2 = skills[2] ?? s0;
  const p0 = content.passives[0]?.id ?? '';
  const p1 = content.passives[1]?.id ?? p0;
  const stone0 = content.stones[0]?.id ?? '';
  const stone1 = content.stones[1]?.id ?? stone0;
  const trinket = content.trinkets[0]?.id ?? '';
  return {
    levelUp: [
      blank({ kind: 'newSkill', id: s1, rarity: 'uncommon', rank: 0 }),
      blank({ kind: 'skillUp', id: s0, rarity: 'rare', rank: 3, lines: [{ stat: 'damage', mode: 'pct', value: 0.34 }, { stat: 'cooldown', mode: 'pct', value: 0.1 }], ...(p0 ? { needs: p0 } : {}) }),
      blank({ kind: 'newPassive', id: p1, rarity: 'epic', rank: 1, maxRank: 5, lines: [{ stat: 'maxHpPct', mode: 'pct', value: 0.1 }], ...(s0 ? { pact: { awakens: [s0] } } : {}) }),
    ],
    levelUp4: [
      blank({ kind: 'skillUp', id: s2, rarity: 'legendary', rank: 7, awakening: true, lines: [{ stat: 'damage', mode: 'pct', value: 0.78 }, { stat: 'area', mode: 'pct', value: 0.26 }] }),
      blank({ kind: 'newSkill', id: s1, rarity: 'epic', rank: 0 }),
      blank({ kind: 'passiveUp', id: p0, rarity: 'rare', rank: 3, maxRank: 5, lines: [{ stat: 'maxHpPct', mode: 'pct', value: 0.136 }] }),
      blank({ kind: 'heal', rarity: 'common', amount: 0.3 }),
    ],
    essence: [
      blank({ kind: 'stone', id: stone0, rarity: 'epic', rank: 2, maxRank: 4, slot: 0, lines: [{ stat: 'pierce', mode: 'flat', value: 0.8 }, { stat: 'projSpeed', mode: 'pct', value: 0.06 }] }),
      blank({ kind: 'stoneUp', id: stone1, rarity: 'rare', rank: 3, maxRank: 4, slot: 1, lines: [{ stat: 'damage', mode: 'pct', value: 0.09 }] }),
      blank({ kind: 'trinket', id: trinket, rarity: 'legendary', rank: 4, maxRank: 5, slot: 0, lines: [{ stat: 'pct', mode: 'pct', value: 0.024 }] }),
    ],
    boss: [
      blank({ kind: 'skillUp', id: s0, rarity: 'legendary', rank: 7, awakening: true, lines: [{ stat: 'damage', mode: 'pct', value: 0.5 }] }),
      blank({ kind: 'stone', id: stone0, rarity: 'epic', rank: 2, maxRank: 4, slot: 0, lines: [{ stat: 'pierce', mode: 'flat', value: 0.8 }] }),
      blank({ kind: 'passiveUp', id: p0, rarity: 'rare', rank: 3, maxRank: 5, lines: [{ stat: 'maxHpPct', mode: 'pct', value: 0.136 }] }),
    ],
  };
}

/** The rarities a set of cards shows (the test checks the whole prewarm covers all five). */
export function raritiesOf(cards: readonly Card[]): Set<Rarity> {
  return new Set(cards.map((c) => c.rarity));
}

function request(kind: ModalRequest['kind'], cards: Card[], over: Partial<ModalRequest> = {}): ModalRequest {
  return { id: 1, kind, player: 0, cards, canReroll: true, canBanish: true, canSkip: true, rerolls: 3, banishes: 1, skips: 2, level: 12, source: '', free: false, awakened: false, waited: 0, result: null, ...over };
}

/** The build a mid-run hero wears, so the pause board, the level-up build bar and the essence sockets paint their rank medals, the awakened
 *  glow, passives, spirit stones and trinkets (the t = 0 hero has one skill): the doctrine's skills at ranks 3 / M1 / G1 / P, passives, stones. */
function midRunBuild(content: ContentDB, sel: Sel, base: HudSnapshot): Pick<HudSnapshot, 'skills' | 'passives' | 'stones' | 'trinkets'> {
  const ids = skillsOf(content, sel);
  const ranks = [2, 3, 5, 7, 4, 6];
  const skills = ids.slice(0, 6).flatMap((id, i) => {
    const def = content.skills.find((x) => x.id === id);
    if (!def) return [];
    const rank = ranks[i] ?? 3;
    return [{ id, icon: def.icon, rank, cooldown: 0, cdLeft: 0, basic: false, awakened: rank >= 7 } satisfies HudSnapshot['skills'][number]];
  });
  const own = base.skills.filter((x) => x.basic);
  const passives = content.passives.slice(0, 4).map((p, i) => ({ id: p.id, icon: p.icon, rank: Math.min(p.maxRank ?? 5, i + 1), maxRank: p.maxRank ?? 5 }));
  const stones = Array.from({ length: 6 }, (_, i) => {
    const st = content.stones[i];
    return st && i < 4 ? { id: st.id, icon: st.icon, level: (i % 3) + 1 } : null;
  });
  const trinkets = Array.from({ length: 3 }, (_, i) => {
    const tr = content.trinkets[i];
    return tr && i < 2 ? { id: tr.id, icon: tr.icon, rank: i + 2 } : null;
  });
  return { skills: skills.length > 0 ? [...own, ...skills] : base.skills, passives, stones, trinkets };
}

/** A HUD snapshot for the surfaces that wear one: the run's own (t = 0) when the store has it, else a bare one, with a mid-run build, the
 *  boss plate, a metin on the map, corruption and a hurt hero switched on so every gauge and slot state paints. */
export function buildPrewarmHud(base: HudSnapshot | null, content: ContentDB, sel: Sel): HudSnapshot {
  const zone = content.zones.find((z) => z.id === sel.zone) ?? content.zones[0];
  const bossId = zone?.bosses[0]?.boss ?? content.bosses[0]?.id ?? '';
  const metin = content.metins[0];
  const snap: HudSnapshot = base ?? {
    time: 0, player: 0, hp: 100, hpMax: 100, shield: 0, level: 1, xp: 0, xpNext: 10, yeop: 0, shards: 0, kills: 0, corruption: 0, alive: true,
    skills: [], passives: [], stones: [null, null, null, null, null, null], trinkets: [null, null, null], rerolls: 3, banishes: 1, skips: 2,
    nextBoss: null, boss: null, metins: [], darkness: 0, px: 0, pz: 0, dmg: [], dps: 0,
  };
  return {
    ...snap,
    ...midRunBuild(content, sel, snap),
    time: Math.max(snap.time, 61),
    corruption: 0.4,
    hp: snap.hpMax * 0.62,
    shield: Math.max(snap.shield, snap.hpMax * 0.1),
    nextBoss: snap.nextBoss ?? (bossId ? { at: 180, in: 29, id: bossId } : null),
    boss: bossId ? { id: bossId, hp: 800, hpMax: 1000, phase: 0, enraged: false, final: false, x: snap.px + 12, z: snap.pz + 8 } : null,
    metins: metin ? [{ id: 1, x: snap.px + 18, z: snap.pz - 6, awakened: false, hpFrac: 0.7, rune: metin.rune }] : [],
  };
}

// ----------------------------------------------------------------------------------------------------------------- surfaces

/** the HUD's painted materials, as Hud.tsx publishes them on its root (`TEX_VARS`) */
const HUD_TEX_VARS: readonly (readonly [id: string, cssVar: string])[] = [
  ['uk_hud_coin', '--tex-hud-coin'],
  ['uk_hud_bar', '--tex-hud-bar'],
  ['uk_hud_gtube', '--tex-hud-gtube'],
  ['uk_hud_gfill_red', '--tex-hud-gfill-red'],
  ['uk_hud_gfill_blue', '--tex-hud-gfill-blue'],
  ['uk_hud_gfill_gold', '--tex-hud-gfill-gold'],
  ['uk_hud_tray', '--tex-hud-tray'],
  ['uk_hud_lvl', '--tex-hud-lvl'],
  ['uk_hud_tag', '--tex-hud-tag'],
];

function hudRootStyle(): JSX.CSSProperties | undefined {
  const style: Record<string, string> = {};
  for (const [id, v] of HUD_TEX_VARS) {
    const url = texUrl(id);
    if (url) style[v] = `url("${url}")`;
  }
  if (style['--tex-hud-gtube']) style['--hg-ch-bg'] = 'transparent';
  return Object.keys(style).length ? (style as JSX.CSSProperties) : undefined;
}

/**
 * The HUD frame with everything on: the top-centre tablet (timer, boss row, the BIG "Great Metin falling" banner with its sparks), the
 * minimap with a metin on it, the taskbar and the build board. The pieces are the HUD's own exported components; the banner row mirrors
 * Hud.tsx AnnounceRow (private there) with the same class names. The real <Hud/> is NOT mounted: it would attach the first-time hints.
 */
function hudSurface(hud: HudSnapshot): ComponentChild {
  const title = t('announce.greatMetinFalling');
  const shine = shineProps(title, { delay: 0.15 });
  const fx = '#ffb050';
  const banner = h(
    'div',
    { role: 'status', class: 'ms-tc-an ms-an--metin is-big' },
    h('span', { class: 'ms-an-fx', 'aria-hidden': 'true' }, h(Motes, { preset: 'burst', count: 64, color: fx, x: 0.5, y: 0.55, spread: 1.7, intensity: 1.6, seed: 7 })),
    h(
      'div',
      { class: 'ms-tc-an-in' },
      h('div', { class: 'ms-tc-an-head' }, h('span', { class: 'ms-an-eyebrow' }, t('hud.ann.metin')), h('span', { ...shine, class: `ms-an-title ${shine.class}` }, title)),
      h('span', { class: 'ms-an-sub' }, t('announce.metinFalling')),
    ),
  );
  const time = h(
    'div',
    { class: 'ms-tc-time is-soon', role: 'timer' },
    h('div', { class: 'ms-tm-time ms-num' }, '01:01'),
    h('div', { class: 'ms-tm-next' }, h(UiGlyph, { name: 'skull', tone: 'crimson', flat: true }), h('span', null, t('hud.bossFight'))),
  );
  return h(
    'div',
    { class: 'ms-layer ms-hud', style: hudRootStyle() },
    h(
      Kit,
      { contents: true },
      h('div', { class: 'ms-hud-lowhp is-on' }),
      h('div', { class: 'ms-hud-tc' }, h('div', { class: 'ms-tc ms-plate has-boss has-an an-metin' }, time, hud.boss ? h(BossRow, { boss: hud.boss }) : null, banner)),
      h('div', { class: 'ms-hud-tr' }, h(Minimap, { hud })),
      h(Taskbar, { hud, low: true }),
      h(BuildBoard, { hud }),
    ),
  );
}

interface Ctx {
  content: ContentDB;
  sel: Sel;
  hud: HudSnapshot;
  cards: PrewarmCards;
}

function bossSource(c: Ctx): string {
  return c.content.zones.find((z) => z.id === c.sel.zone)?.bosses[0]?.boss ?? c.content.bosses[0]?.id ?? '';
}

/** What each surface mounts. */
export const SURFACE_BUILDERS: Record<SurfaceId, (c: Ctx) => ComponentChild> = {
  story: (c) => h(StoryModal, { story: { kind: 'zoneIntro', ref: c.sel.zone } }),
  hud: (c) => hudSurface(c.hud),
  levelUp: (c) => h(LevelUp, { request: request('levelUp', c.cards.levelUp, { level: 3 }) }),
  pause: () => h(Pause, null),
  essence: (c) => h(Essence, { request: request('essence', c.cards.essence, { source: c.content.metins[0]?.id ?? '' }) }),
  chest: (c) => h(Chest, { request: request('chest', c.cards.levelUp, { free: false }) }),
  bossReward: (c) => h(BossReward, { request: request('bossReward', c.cards.boss, { free: true, source: bossSource(c) }) }),
  levelUp4: (c) => h(LevelUp, { request: request('levelUp', c.cards.levelUp4, { level: 19 }) }),
};

// ----------------------------------------------------------------------------------------------------- the orchestration

export interface SurfaceResult {
  id: string;
  ok: boolean;
  ms: number;
  error?: string;
}

export interface PrewarmReport {
  /** every planned surface was mounted and painted */
  complete: boolean;
  aborted: boolean;
  /** why nothing ran (`disabled`, `no-ui`), else undefined */
  skipped?: string;
  surfaces: SurfaceResult[];
  textures: { requested: number; decoded: number };
  fonts: { requested: number; loaded: number };
  ms: number;
  /** main-thread milliseconds spent in the synchronous mount / unmount calls (style, layout and paint of the frames come on top) */
  jsMs?: number;
  /** the same per surface (mount only) */
  jsBy?: Record<string, number>;
}

/** The side effects of the prewarm, injectable so prewarm.test.ts drives the sequence without a browser. */
export interface PrewarmIo {
  now(): number;
  /** the URL of a manifest texture id (null = not shipped) */
  textureUrl(id: string): string | null;
  decode(url: string, signal?: AbortSignal): Promise<boolean>;
  loadFont(spec: string, signal?: AbortSignal): Promise<boolean>;
  /**
   * mounts the surfaces together, paints them for FRAMES_PER_SURFACE frames, unmounts them (at once when `signal` aborts); resolves with the
   * surfaces that could not be built (never rejects for a single surface)
   */
  paint(ids: readonly SurfaceId[], signal?: AbortSignal): Promise<PaintFailure[]>;
  mark?(name: string): void;
}

export interface PaintFailure {
  id: SurfaceId;
  error: string;
}

export interface PrewarmPlan {
  textures: readonly string[];
  fonts: readonly string[];
  /** the surfaces to paint, group by group */
  groups: readonly (readonly SurfaceId[])[];
}

export const DEFAULT_PLAN: PrewarmPlan = { textures: PREWARM_TEXTURES, fonts: PREWARM_FONTS, groups: PREWARM_GROUPS };

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined, onAbort: T): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.resolve(onAbort);
  return new Promise<T>((resolve) => {
    let settled = false;
    const done = (v: T): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onStop);
      resolve(v);
    };
    const onStop = (): void => done(onAbort);
    signal.addEventListener('abort', onStop, { once: true });
    promise.then(done, () => done(onAbort));
  });
}

/**
 * The sequence: art + fonts first (in parallel), then the surface groups one after the other in plan order. Never rejects; a surface that
 * throws is recorded and the others still run; `signal` aborting stops both the decode / font phase and before the next group (the one on
 * screen is unmounted by `io.paint`).
 */
export async function runPrewarm(io: PrewarmIo, plan: PrewarmPlan = DEFAULT_PLAN, signal?: AbortSignal): Promise<PrewarmReport> {
  const t0 = io.now();
  io.mark?.('ms:prewarm:start');
  const report: PrewarmReport = { complete: false, aborted: false, surfaces: [], textures: { requested: plan.textures.length, decoded: 0 }, fonts: { requested: plan.fonts.length, loaded: 0 }, ms: 0 };
  const urls = plan.textures.map((id) => io.textureUrl(id)).filter((u): u is string => u !== null);
  if (!signal?.aborted) {
    const [dec, fnt] = await raceAbort(
      Promise.all([
        Promise.all(urls.map((u) => io.decode(u, signal).catch(() => false))),
        Promise.all(plan.fonts.map((f) => io.loadFont(f, signal).catch(() => false))),
      ]),
      signal,
      [[] as boolean[], [] as boolean[]] as [boolean[], boolean[]],
    );
    report.textures.decoded = dec.filter(Boolean).length;
    report.fonts.loaded = fnt.filter(Boolean).length;
  }
  if (signal?.aborted) report.aborted = true;
  for (const group of plan.groups) {
    if (group.length === 0) continue;
    if (signal?.aborted) {
      report.aborted = true;
      break;
    }
    const g0 = io.now();
    let failed: PaintFailure[] = [];
    try {
      failed = await io.paint(group, signal);
    } catch (err) {
      failed = group.map((id) => ({ id, error: err instanceof Error ? err.message : String(err) }));
    }
    const ms = Math.round(io.now() - g0);
    for (const id of group) {
      const f = failed.find((x) => x.id === id);
      report.surfaces.push(f ? { id, ok: false, ms, error: f.error } : { id, ok: true, ms });
      if (!f) io.mark?.(`ms:prewarm:${id}`);
    }
  }
  report.complete = !report.aborted && report.surfaces.length === plan.groups.flat().length && report.surfaces.every((s) => s.ok);
  report.ms = Math.round(io.now() - t0);
  io.mark?.('ms:prewarm:end');
  return report;
}

// --------------------------------------------------------------------------------------------------------------- the browser

/** every animation / transition ends at once (their end state is the visible one), so a card that fades in from opacity 0 paints now */
const PREWARM_CSS = `
.ms-prewarm, .ms-prewarm *, .ms-prewarm *::before, .ms-prewarm *::after {
  animation-delay: 0s !important;
  animation-duration: 1ms !important;
  animation-iteration-count: 1 !important;
  transition: none !important;
}`;
let sheet: CSSStyleSheet | null = null;

function installSheet(): void {
  if (sheet || typeof CSSStyleSheet === 'undefined') return;
  try {
    const s = new CSSStyleSheet();
    s.replaceSync(PREWARM_CSS);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, s];
    sheet = s;
  } catch {
    /* constructable sheets unsupported: the surfaces still mount, the fade-in ones paint late */
  }
}

/** Resolves on the next painted frame; on a hidden tab (no rAF), after FRAME_WAIT_MS or when `signal` aborts it resolves anyway. */
function nextFrame(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (document.hidden) {
      window.setTimeout(resolve, 30);
      return;
    }
    let done = false;
    const fin = (): void => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', fin);
      resolve();
    };
    const timer = window.setTimeout(fin, FRAME_WAIT_MS);
    signal?.addEventListener('abort', fin, { once: true });
    requestAnimationFrame(fin);
  });
}

const keepAlive: HTMLImageElement[] = [];
const DECODE_TIMEOUT_MS = 2500;

function decodeUrl(url: string, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const img = new Image();
    img.decoding = 'async';
    const done = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      img.onload = null;
      img.onerror = null;
      resolve(ok);
    };
    const onAbort = (): void => done(false);
    const timer = window.setTimeout(() => done(false), DECODE_TIMEOUT_MS);
    signal?.addEventListener('abort', onAbort, { once: true });
    img.src = url;
    keepAlive.push(img);
    if (typeof img.decode !== 'function') {
      img.onload = () => done(true);
      img.onerror = () => done(false);
      return;
    }
    img.decode().then(
      () => done(true),
      () => done(false),
    );
  });
}

function loadFontSpec(spec: string, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted || typeof document === 'undefined' || !document.fonts) return Promise.resolve(false);
  const sample = lang.value === 'tr' ? FONT_SAMPLE_TR : FONT_SAMPLE_EN;
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(ok);
    };
    const onAbort = (): void => done(false);
    const timer = window.setTimeout(() => done(false), DECODE_TIMEOUT_MS);
    signal?.addEventListener('abort', onAbort, { once: true });
    document.fonts.load(spec, sample).then(
      (faces) => done(faces.length > 0),
      () => done(false),
    );
  });
}

/** the <img> elements of a mounted surface decoded before its frames are counted */
async function decodeImages(root: HTMLElement, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  const imgs = Array.from(root.querySelectorAll('img')).filter((i) => i.src && !i.complete);
  if (imgs.length === 0) return;
  await raceAbort(
    Promise.race([Promise.allSettled(imgs.map((i) => i.decode().catch(() => undefined))), new Promise<void>((r) => window.setTimeout(r, 2000))]),
    signal,
    undefined,
  );
}

/** The surfaces mount mute: no UI sound of a modal that is not really opening. */
async function muted<T>(fn: () => Promise<T>): Promise<T> {
  const d = deps();
  const audio = d.audio;
  d.audio = undefined;
  try {
    return await fn();
  } finally {
    d.audio = audio;
  }
}

function selectionOf(): Sel {
  const s = deps().store.runSelection.value;
  return { classId: s.classId, doctrine: s.doctrine, zone: s.zone };
}

function browserIo(): PrewarmIo {
  const ctx = (): Ctx => {
    const d = deps();
    const sel = selectionOf();
    return { content: d.content, sel, hud: buildPrewarmHud(d.store.hud.value, d.content, sel), cards: buildPrewarmCards(d.content, sel) };
  };
  return {
    now: () => performance.now(),
    textureUrl: (id) => {
      try {
        return texUrl(id);
      } catch {
        return null;
      }
    },
    decode: decodeUrl,
    loadFont: loadFontSpec,
    mark: (name) => {
      try {
        performance.mark(name);
      } catch {
        /* no performance timeline */
      }
    },
    paint: (ids, signal) =>
      muted(async () => {
        if (signal?.aborted) return [];
        // a hidden tab rasters nothing: that paint warms nothing and does not count (the next run tries these surfaces again)
        let real = !document.hidden;
        const host = document.querySelector<HTMLElement>('.ms-ui') ?? document.body;
        const failed: PaintFailure[] = [];
        const mounted: { id: SurfaceId; slot: HTMLElement }[] = [];
        // the modals read the build bar / sockets from the store's HUD snapshot: it wears the mid-run build while they are mounted (nothing
        // shows the HUD during the load; the load's own push at its end wins when it comes first)
        const store = deps().store;
        const prior = store.hud.value;
        const c = ctx();
        store.setHud(c.hud);
        try {
          for (const id of ids) {
            const slot = document.createElement('div');
            slot.className = 'ms-prewarm';
            slot.setAttribute('inert', '');
            slot.setAttribute('aria-hidden', 'true');
            Object.assign(slot.style, { position: 'fixed', inset: '0', opacity: '0.02', pointerEvents: 'none', zIndex: '9000' });
            host.appendChild(slot);
            mounted.push({ id, slot });
            const j0 = performance.now();
            try {
              render(SURFACE_BUILDERS[id](c), slot);
              jsMs += performance.now() - j0;
              jsBy[id] = Math.round(performance.now() - j0);
            } catch (err) {
              failed.push({ id, error: err instanceof Error ? err.message : String(err) });
            }
          }
          await Promise.all(mounted.map((m) => decodeImages(m.slot, signal)));
          for (let i = 0; i < FRAMES_PER_SURFACE && !signal?.aborted; i++) {
            await nextFrame(signal);
            if (document.hidden) real = false;
          }
          if (real && !signal?.aborted) for (const m of mounted) if (!failed.some((f) => f.id === m.id)) painted.add(m.id);
        } finally {
          if (store.hud.value === c.hud) store.setHud(prior);
          for (const m of mounted) {
            const j1 = performance.now();
            try {
              render(null, m.slot);
            } finally {
              m.slot.remove();
              jsMs += performance.now() - j1;
            }
          }
        }
        return failed;
      }),
  };
}

/** `up=noprewarm` (dev server / VITE_QA_HOOKS builds only, like up=noprime): skip the prewarm to A/B it on one machine. */
function disabledByQuery(): boolean {
  const qa = import.meta.env.DEV || import.meta.env.VITE_QA_HOOKS === '1';
  return qa && typeof location !== 'undefined' && /[?&]up=(?:[^&]*,)?noprewarm(?:,|&|$)/.test(location.search);
}

/** a run of the prewarm in flight (a second caller joins it) */
let inflight: Promise<PrewarmReport> | null = null;
let last: PrewarmReport | null = null;
/** the surfaces that were painted for real (visible tab, not aborted): a later run paints only the ones missing, e.g. after the join timed out */
const painted = new Set<SurfaceId>();
let jsMs = 0;
const jsBy: Record<string, number> = {};
let texturesDone = false;

/** The report of the prewarm that ran (null before it did); QA reads it through `window.__ms`-style evals. */
export function prewarmReport(): PrewarmReport | null {
  return last;
}

/**
 * Prewarms the run UI once per page: a surface painted for real is never painted again, one that was cut short (the join timed out, a hidden
 * tab) is tried again by the next run. A second call while one is in flight joins it. Never rejects. `signal` aborting unmounts the surface
 * on screen and skips the rest: App.startRun aborts it before the run screen shows.
 */
export function prewarmRunUi(opts: { signal?: AbortSignal } = {}): Promise<PrewarmReport> {
  const empty = (extra: Partial<PrewarmReport>): PrewarmReport => ({ complete: false, aborted: false, surfaces: [], textures: { requested: 0, decoded: 0 }, fonts: { requested: 0, loaded: 0 }, ms: 0, ...extra });
  if (inflight) return raceAbort(inflight, opts.signal, empty({ aborted: true }));
  if (typeof document === 'undefined' || !hasDeps()) return Promise.resolve(empty({ skipped: 'no-ui' }));
  if (disabledByQuery()) return Promise.resolve((last = empty({ skipped: 'disabled' })));
  const groups = PREWARM_GROUPS.map((g) => g.filter((id) => !painted.has(id))).filter((g) => g.length > 0);
  if (groups.length === 0 && last) return Promise.resolve(last);
  installSheet();
  // the budget: abort after PREWARM_BUDGET_MS even if the caller never does
  const ctl = new AbortController();
  const stop = (): void => ctl.abort();
  opts.signal?.addEventListener('abort', stop, { once: true });
  if (opts.signal?.aborted) stop();
  const budget = window.setTimeout(stop, PREWARM_BUDGET_MS);
  const plan: PrewarmPlan = { textures: texturesDone ? [] : PREWARM_TEXTURES, fonts: texturesDone ? [] : PREWARM_FONTS, groups };
  texturesDone = true;
  inflight = runPrewarm(browserIo(), plan, ctl.signal)
    .catch((err) => empty({ skipped: `error: ${err instanceof Error ? err.message : String(err)}` }))
    .then((r) => {
      window.clearTimeout(budget);
      opts.signal?.removeEventListener('abort', stop);
      keepAlive.length = 0;
      // complete = every surface of the page has now been painted for real
      last = { ...r, complete: PREWARM_SURFACES.every((id) => painted.has(id)), jsMs: Math.round(jsMs), jsBy: { ...jsBy } };
      // QA builds: the report where the harness evals can read it (like window.__ms)
      if (import.meta.env.DEV || import.meta.env.VITE_QA_HOOKS === '1') (window as unknown as { __msPrewarm?: PrewarmReport }).__msPrewarm = last;
      inflight = null;
      return last;
    });
  return inflight;
}

/** tests only: forget that the prewarm ran */
export function resetPrewarmForTests(): void {
  inflight = null;
  last = null;
  painted.clear();
  texturesDone = false;
}
