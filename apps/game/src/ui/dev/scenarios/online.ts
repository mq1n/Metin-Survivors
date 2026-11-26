// Gallery scenarios: leaderboard + co-op lobby (owner: B13 online): preset filters, slow / offline / empty / stale boards
// and scripted co-op lobbies (all ready, guest, full, reconnect, match start, join error). Fakes live in ../mockOnline.ts.
import type { ClassId, LeaderboardEntry, LeaderboardQuery, LeaderboardResponse } from '@ms/shared/api';
import { deps } from '../../env';
import { coopRoom } from '../../screens/Coop';
import { lbFilters, type LeaderboardFilters } from '../../screens/Leaderboard';
import { openView } from '../../view';
import type { GalleryCtx } from '../../gallery';
import { ScriptedCoopLink, type CoopScript } from '../mockOnline';
import { openSub, restoreServices, type Scenario } from '../scenarioKit';

export const order = 70;

// "Co-op · no API" needs deps().api to be absent; every other scenario puts the real (mock) client back first.
let apiSaved = false;
let realApi: ReturnType<typeof deps>['api'];
function withApi(on: boolean): void {
  const d = deps();
  if (!apiSaved) {
    realApi = d.api;
    apiSaved = true;
  }
  d.api = on ? realApi : undefined;
}


// The shared mock board (ui/dev/mockApi.ts, core) draws classes and names at random, so the gallery board shows one name twice, three
// shamans in a row and the player at #9, half cut by the list edge. The online scenarios post-process every answer: unique names, a
// class mix without runs of three, and the player at #5 (inside the first screen of the list). Gallery-only, never shipped.
const DEMO_NAMES = ['Aslan_Yürek', 'Zeynep', 'Bozkurt', 'MetinAvcısı', 'Kahraman2841', 'DragonBane', 'Selin', 'Kılıçhan', 'Mistik', 'Tuğçe', 'Yeonmu_Boy', 'Alev', 'Cengiz', 'Nehir', 'BlackStone', 'Doruk', 'Gökhan', 'Ece', 'Tolga', 'Deniz', 'Barış', 'Pelin', 'Volkan', 'Emre', 'Derya'];
const DEMO_CLASSES: ClassId[] = ['ninja', 'warrior', 'shaman', 'wolfman', 'yacha', 'warrior', 'ninja', 'yacha', 'wolfman', 'shaman', 'ninja', 'warrior', 'wolfman', 'shaman', 'yacha', 'ninja', 'warrior', 'wolfman', 'yacha', 'shaman', 'ninja', 'warrior', 'shaman', 'wolfman', 'yacha'];
// The server's board rows carry no empire yet (request online.txt #7: an optional `empire` per entry); the gallery adds one so the row banners show.
const DEMO_EMPIRES = ['jihae', 'saehwa', 'chowon', 'saehwa', 'saehwa', 'jihae', 'chowon', 'jihae', 'saehwa', 'chowon', 'chowon', 'saehwa', 'jihae', 'saehwa', 'chowon', 'jihae', 'saehwa', 'chowon', 'jihae', 'saehwa', 'chowon', 'jihae', 'saehwa', 'jihae', 'chowon'] as const;
const DEMO_YOU_RANK = 5;
const demoWrapped = new WeakSet<object>();

function demoBoard(r: LeaderboardResponse, q: { class?: string }): LeaderboardResponse {
  if (r.entries.length < DEMO_YOU_RANK) return r;
  const youName = r.you?.name ?? 'Kahraman2841';
  let n = 0;
  const entries: LeaderboardEntry[] = r.entries.map((e, i) => {
    const isYou = r.you !== null && e.rank === DEMO_YOU_RANK;
    let name = isYou ? youName : (DEMO_NAMES[(i * 7 + 3 + n++) % DEMO_NAMES.length] ?? 'Hero');
    if (!isYou && name === youName) name = DEMO_NAMES[(i * 7 + 4 + n++) % DEMO_NAMES.length] ?? 'Hero';
    return { ...e, name, you: isYou, empire: DEMO_EMPIRES[i % DEMO_EMPIRES.length], classId: q.class && q.class !== 'all' ? e.classId : (DEMO_CLASSES[i % DEMO_CLASSES.length] ?? e.classId) } as LeaderboardEntry;
  });
  const seen = new Set<string>();
  for (const e of entries) {
    let k = e.name;
    for (let j = 0; seen.has(k); j++) k = `${e.name}${j + 2}`;
    seen.add(k);
    e.name = k;
  }
  const you = entries.find((e) => e.you) ?? null;
  return { ...r, entries, you };
}

function withDemoBoard(g: GalleryCtx): void {
  if (demoWrapped.has(g.api.leaderboard)) return;
  const orig = g.api.leaderboard.bind(g.api);
  const wrapped: typeof g.api.leaderboard = async (q) => demoBoard(await orig(q), q);
  demoWrapped.add(wrapped);
  g.api.leaderboard = wrapped;
}

const lbAt = (id: string, label: string, filters: LeaderboardFilters, setup?: (g: GalleryCtx) => void): Scenario => ({
  id,
  label,
  run: (g) => {
    withApi(true);
    restoreServices(g);
    withDemoBoard(g);
    lbFilters.value = filters;
    setup?.(g);
    openSub(g, 'leaderboard');
  },
});

const coopAs = (id: string, label: string, script: CoopScript): Scenario => ({
  id,
  label,
  run: (g) => {
    withApi(true);
    restoreServices(g);
    deps().coopFactory = (room) => new ScriptedCoopLink(room, script);
    coopRoom.value = 'K7M2QX';
    openSub(g, 'coop');
  },
});

const BASE: LeaderboardFilters = { mode: 'solo', zone: 'yeonmu', difficulty: 'normal', cls: 'all', period: 'all' };

function emptyBoard(q: Partial<LeaderboardQuery> & Pick<LeaderboardQuery, 'zone'>): LeaderboardResponse {
  return { mode: q.mode ?? 'solo', zone: q.zone, difficulty: q.difficulty ?? 'normal', class: q.class ?? 'all', period: q.period ?? 'all', weekStart: null, limit: q.limit ?? 25, total: 0, entries: [], you: null };
}

export const scenarios: Scenario[] = [
  {
    id: 'leaderboard',
    label: 'Leaderboard',
    run: (g) => {
      withApi(true);
      withDemoBoard(g);
      g.store.setScreen('menu');
      openView('leaderboard');
    },
  },
  {
    id: 'coop',
    label: 'Co-op lobby',
    run: (g) => {
      withApi(true);
      g.store.setScreen('menu');
      openView('coop');
    },
  },
  lbAt('leaderboard-hard-week', 'Leaderboard · hard / this week', { ...BASE, difficulty: 'hard', period: 'week' }),
  lbAt('leaderboard-class', 'Leaderboard · class filter', { ...BASE, zone: 'suryeon', cls: 'ninja' }),
  lbAt('leaderboard-coop', 'Leaderboard · co-op board (party sizes)', { ...BASE, mode: 'coop' }, (g) => {
    const orig = g.api.leaderboard.bind(g.api);
    g.api.leaderboard = async (q) => {
      const r = await orig(q);
      if (q.mode !== 'coop') return r;
      return { ...r, mode: 'coop', entries: r.entries.map((e) => ({ ...e, party: 2 + (e.rank % 3) })) };
    };
  }),
  lbAt('leaderboard-coop-empty', 'Leaderboard · co-op board empty', { ...BASE, mode: 'coop' }, (g) => {
    g.api.leaderboard = async (q) => emptyBoard(q);
  }),
  lbAt('leaderboard-loading', 'Leaderboard · loading', BASE, (g) => {
    const orig = g.api.leaderboard.bind(g.api);
    g.api.leaderboard = (q) => new Promise((resolve) => window.setTimeout(() => void orig(q).then(resolve), 120_000));
  }),
  lbAt('leaderboard-stale', 'Leaderboard · stale cache (click refresh)', BASE, (g) => {
    void g.meta.leaderboard?.fetch({ mode: 'solo', zone: 'yeonmu', difficulty: 'normal', class: 'all', period: 'all', limit: 50 }).then(() => {
      g.api.offline = true;
    });
  }),
  lbAt('leaderboard-error', 'Leaderboard · error', BASE, (g) => {
    g.api.offline = true;
  }),
  lbAt('leaderboard-empty', 'Leaderboard · empty', BASE, (g) => {
    g.api.leaderboard = async (q) => emptyBoard(q);
  }),
  lbAt('leaderboard-unranked', 'Leaderboard · not ranked', BASE, (g) => {
    const orig = g.api.leaderboard.bind(g.api);
    g.api.leaderboard = async (q) => ({ ...(await orig(q)), you: null, entries: (await orig(q)).entries.map((e) => ({ ...e, you: false })) });
  }),
  {
    id: 'leaderboard-offline',
    label: 'Leaderboard · no client (offline build)',
    run: (g) => {
      withApi(true);
      restoreServices(g);
      g.meta.leaderboard = null;
      openSub(g, 'leaderboard');
    },
  },
  coopAs('coop-lobby', 'Co-op · lobby (host, 3 players)', 'all-ready'),
  coopAs('coop-pair', 'Co-op · lobby (host, 2 players, one not ready)', 'pair'),
  coopAs('coop-guest', 'Co-op · lobby (guest)', 'guest'),
  coopAs('coop-full', 'Co-op · lobby (guest, full room)', 'full'),
  coopAs('coop-reconnect', 'Co-op · reconnecting', 'reconnect'),
  coopAs('coop-starting', 'Co-op · match starting', 'start'),
  coopAs('coop-error', 'Co-op · room not found', 'error'),
  {
    id: 'coop-offline',
    label: 'Co-op · no API',
    run: (g) => {
      withApi(true);
      restoreServices(g);
      withApi(false);
      openSub(g, 'coop');
    },
  },
];
