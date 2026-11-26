// Gallery scenario kit (core-owned, dev only). The UI gallery (ui/gallery.ts) loads every module in ui/dev/scenarios/*.ts
// through import.meta.glob, so a builder adds or changes the states of its target by editing only its own scenario file
// (never gallery.ts). A scenario module exports:
//
//   export const order = 30;                       // sort key of the group in the gallery picker (ties: file name)
//   export const scenarios: Scenario[] = [         // ids must be unique across all modules (duplicates are skipped)
//     { id: 'heroSelect', label: 'Hero select', run: (g) => g.store.setScreen('heroSelect') },
//   ];
//
// Ownership (one writer per file): boot.ts B1 · menu.ts B2 · hero.ts B3 · zone.ts B4 · hud.ts B5 · levelup.ts B6 ·
// essence.ts B7 · pause-settings.ts B8 · story.ts B9 · runend.ts B10 · armory-a.ts B11 · armory-b.ts B12 · online.ts B13 ·
// mobile-*.ts B14 · kit.ts / stage.ts core. Shared fixtures stay in ui/dev/mock.ts (core). Gallery state persists between
// scenarios of one page session (shot.ts applies screens in order), exactly as before the registry split.
import type { GalleryCtx } from '../gallery';
import { coopRoom } from '../screens/Coop';
import { lbFilters } from '../screens/Leaderboard';
import { settingsTab } from '../screens/Settings';
import { deps, type UiDeps } from '../env';
import { armoryTab, openView, type ArmoryTab } from '../view';

export interface Scenario {
  id: string;
  label: string;
  run(g: GalleryCtx): void;
}

export interface ScenarioModule {
  order?: number;
  scenarios?: readonly Scenario[];
}

/** In-run state: the run screen plus the mock HUD ticker started at run time `t`. */
export function inRun(g: GalleryCtx, opts: Parameters<GalleryCtx['hud']>[0] = {}): void {
  g.store.setScreen('run');
  g.hud(opts);
}

/** One Armory tab over the main menu. */
export const armoryAt = (tab: ArmoryTab): Scenario => ({
  id: `armory-${tab}`,
  label: `Armory · ${tab}`,
  run: (g) => {
    g.store.setScreen('menu');
    openView('armory', tab);
    armoryTab.value = tab;
  },
});

/** A menu sub-view (settings / leaderboard / co-op …) over the main menu. */
export function openSub(g: GalleryCtx, view: 'settings' | 'leaderboard' | 'coop'): void {
  g.store.setScreen('menu');
  openView(view);
}

interface Originals {
  cloud: GalleryCtx['meta']['cloud'];
  leaderboard: GalleryCtx['meta']['leaderboard'];
  coopFactory: UiDeps['coopFactory'];
  apiLeaderboard: GalleryCtx['api']['leaderboard'];
}
let originals: Originals | null = null;

/**
 * Puts the mock online services back to their gallery defaults (cloud, leaderboard client + API, co-op link factory) and
 * clears the Settings / Leaderboard / Co-op view state. Every settings-tab, leaderboard and co-op scenario starts here.
 */
export function restoreServices(g: GalleryCtx): void {
  if (!originals) {
    originals = { cloud: g.meta.cloud, leaderboard: g.meta.leaderboard, coopFactory: deps().coopFactory, apiLeaderboard: g.api.leaderboard.bind(g.api) };
  }
  g.meta.cloud = originals.cloud;
  g.meta.leaderboard = originals.leaderboard;
  g.meta.leaderboard?.clear();
  g.api.leaderboard = originals.apiLeaderboard;
  g.api.offline = false;
  deps().coopFactory = originals.coopFactory;
  coopRoom.value = null;
  lbFilters.value = null;
  settingsTab.value = 'general';
}
