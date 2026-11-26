// UI-local state: which sub-view the menu screen shows, the Armory tab, in-UI toasts, a reactive mirror of the
// MetaService save, and the screen-change curtain.
import { signal, type ReadonlySignal, type Signal } from '@preact/signals';
import type { SaveData } from '../meta';
import { sfx } from './audio';
import { deps } from './env';

export type SubView = 'main' | 'armory' | 'settings' | 'leaderboard' | 'coop' | 'credits';
export const subView = signal<SubView>('main');

export type ArmoryTab = 'character' | 'collection' | 'drops' | 'codex' | 'talents' | 'blacksmith';
export const ARMORY_TABS: readonly ArmoryTab[] = ['character', 'collection', 'drops', 'codex', 'talents', 'blacksmith'];
export const armoryTab = signal<ArmoryTab>('character');

/** Bumps on every navigation so screens can replay their enter animation. */
export const navTick = signal(0);

export function openView(v: SubView, tab?: ArmoryTab): void {
  if (tab) armoryTab.value = tab;
  if (subView.value === v) return;
  subView.value = v;
  navTick.value++;
}

export function closeView(): void {
  openView('main');
}

/**
 * The co-op lobby (screens/Coop.tsx) registers how it forgets its room here. A co-op result's "Main menu" calls `leaveCoopForMenu`:
 * the sub-view and the room signal both outlive the run, so the menu used to open on the lobby of a room that no longer exists
 * (party 0 of 4, "Connection lost - reconnecting", a dead reconnect loop). "Retry" keeps them on purpose (rematch in the lobby).
 */
let coopLobbyReset: (() => void) | null = null;

export function registerCoopLobbyReset(fn: (() => void) | null): void {
  coopLobbyReset = fn;
}

/** forget the finished co-op room and show the main menu view (call before `store.go('menu')`) */
export function leaveCoopForMenu(): void {
  coopLobbyReset?.();
  closeView();
}

/** "Main menu" from a run report: a co-op report (more than one hero) also leaves the lobby view of its room */
export function resultToMenu(playerCount: number | undefined, go: () => void): void {
  if ((playerCount ?? 1) > 1) leaveCoopForMenu();
  go();
}

// ---------------------------------------------------------------------------
// In-UI toasts (settings feedback, copy confirmations, errors) — HUD announcements are separate (hud/announce.ts)

export interface UiToast {
  id: number;
  text: string;
  tone: 'info' | 'good' | 'bad';
}
const toastsSig = signal<UiToast[]>([]);
export const uiToasts: ReadonlySignal<UiToast[]> = toastsSig;
let toastSeq = 1;

const toastTimers = new Map<number, ReturnType<typeof setTimeout>>();

export function pushToast(text: string, tone: UiToast['tone'] = 'info', ms = 2600): void {
  if (tone === 'bad') sfx('error');
  // an identical toast is already showing (a locked row clicked again and again): restart its timer instead of stacking a copy
  const dup = toastsSig.value.find((x) => x.text === text && x.tone === tone);
  const id = dup ? dup.id : toastSeq++;
  if (!dup) toastsSig.value = [...toastsSig.value.slice(-3), { id, text, tone }];
  clearTimeout(toastTimers.get(id));
  toastTimers.set(
    id,
    setTimeout(() => {
      toastTimers.delete(id);
      toastsSig.value = toastsSig.value.filter((x) => x.id !== id);
    }, ms),
  );
}

// ---------------------------------------------------------------------------
// Reactive mirror of the meta save

let saveSig: Signal<SaveData> | null = null;
let saveOff: (() => void) | null = null;

/** The live save as a signal (subscribes to MetaService on first use). */
export function metaSave(): ReadonlySignal<SaveData> {
  if (!saveSig) {
    const { meta } = deps();
    saveSig = signal(meta.save);
    saveOff = meta.subscribe((s) => {
      if (saveSig && saveSig.peek() !== s) saveSig.value = s;
    });
  }
  return saveSig;
}

export function resetUiState(): void {
  saveOff?.();
  saveOff = null;
  saveSig = null;
  subView.value = 'main';
  armoryTab.value = 'character';
  toastsSig.value = [];
  for (const h of toastTimers.values()) clearTimeout(h);
  toastTimers.clear();
}
