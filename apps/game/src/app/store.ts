// GameStore: the bridge between the game (app + sim) and the Preact UI (ARCHITECTURE §8).
// UI reads signals (`store.screen.value`, …) and calls commands. The App wires command handlers via `bind()`.
//
//   screen      boot | menu | heroSelect | zoneSelect | loading | run | results
//   hud         HudSnapshot @ 10 Hz while a run is active (null otherwise)
//   modal       what the UI must show on top of the HUD right now: pause overlay > sim request (levelUp / essence /
//               chest / bossReward / runEnd) > story popup; null when nothing is pending
//   commands    chooseCard(i) · reroll() · banish(i) · skip() · pause() · resume() · quit() · go(screen) · startRun()
import { computed, signal, type ReadonlySignal } from '@preact/signals';
import type { ClassId, Difficulty, DoctrineKey, EmpireId, Sex } from '../data/schema';
import type { RunResult } from '../sim/run';
import type { HudSnapshot, ModalRequest } from '../sim/types';
import type { CoopStatus } from '../net/coop';

export type Screen = 'boot' | 'menu' | 'heroSelect' | 'zoneSelect' | 'loading' | 'run' | 'results';

/** Run options sliders (balance.json runOptions). 1 = unmodified. */
export interface RunOptions {
  density: number;
  health: number;
  damage: number;
  speed: number;
}

export interface RunSelection {
  classId: ClassId;
  doctrine: DoctrineKey;
  sex: Sex;
  empire: EmpireId;
  zone: string;
  difficulty: Difficulty;
  /** 0..3 armor tier shown on the hero (meta gear) */
  armorTier: number;
  /** pre-run difficulty sliders (1..3, step 0.25); passed to the sim as RunConfig.runOptions */
  runOptions: RunOptions;
}

export interface LoadingState {
  /** 0..1 */
  fraction: number;
  /** localisation key or plain id of what is loading (UI may show it) */
  label: string;
  error: string | null;
}

/** A story beat to display (intro, boss intro, victory, defeat, metin lore). */
export interface StoryNotice {
  kind: 'zoneIntro' | 'bossIntro' | 'victory' | 'defeat' | 'metin' | string;
  /** zone id / boss id / metin id */
  ref: string;
}

export type ModalView =
  | { kind: 'pause' }
  | { kind: 'levelUp' | 'essence' | 'chest' | 'bossReward' | 'runEnd'; request: ModalRequest }
  | { kind: 'story'; story: StoryNotice };

/** Small transient messages for the HUD (chest locked, level up, boss warning …). */
export interface Toast {
  id: number;
  kind: string;
  /** free-form payload (numbers/ids); UI localises */
  data: Record<string, number | string | boolean>;
}

export interface GoOptions {
  /** Keep the live co-op room socket open so the lobby can reclaim it for a rematch. */
  keepCoopLobby?: boolean;
}

export interface StoreHandlers {
  chooseCard(index: number): void;
  reroll(): void;
  banish(index: number): void;
  skip(): void;
  pause(): void;
  resume(): void;
  quit(): void;
  go(screen: Screen, opts?: GoOptions): void;
  startRun(): void;
  dismissStory(): void;
}

const noop = (): void => {};
const NO_HANDLERS: StoreHandlers = {
  chooseCard: noop,
  reroll: noop,
  banish: noop,
  skip: noop,
  pause: noop,
  resume: noop,
  quit: noop,
  go: noop,
  startRun: noop,
  dismissStory: noop,
};

export function defaultSelection(): RunSelection {
  return {
    classId: 'warrior',
    doctrine: 'a',
    sex: 'm',
    empire: 'saehwa',
    zone: 'yeonmu',
    difficulty: 'normal',
    armorTier: 0,
    runOptions: { density: 1, health: 1, damage: 1, speed: 1 },
  };
}

export class GameStore {
  private readonly _screen = signal<Screen>('boot');
  private readonly _hud = signal<HudSnapshot | null>(null);
  private readonly _simModal = signal<ModalRequest | null>(null);
  private readonly _paused = signal(false);
  private readonly _story = signal<StoryNotice | null>(null);
  private readonly _loading = signal<LoadingState>({ fraction: 0, label: '', error: null });
  private readonly _selection = signal<RunSelection>(defaultSelection());
  private readonly _activeRun = signal<RunSelection | null>(null);
  private readonly _result = signal<RunResult | null>(null);
  private readonly _toasts = signal<Toast[]>([]);
  private readonly _fps = signal(0);
  private readonly _coop = signal<CoopStatus | null>(null);
  private readonly _contextLost = signal(false);
  private toastId = 1;
  private handlers: StoreHandlers = NO_HANDLERS;

  readonly screen: ReadonlySignal<Screen> = this._screen;
  readonly hud: ReadonlySignal<HudSnapshot | null> = this._hud;
  readonly paused: ReadonlySignal<boolean> = this._paused;
  readonly loading: ReadonlySignal<LoadingState> = this._loading;
  readonly selection: ReadonlySignal<RunSelection> = this._selection;
  /** immutable active-run selection resolved from RunConfig (null outside an active run) */
  readonly activeRun: ReadonlySignal<RunSelection | null> = this._activeRun;
  /** runtime selection view: active run config while in-run, otherwise menu selection */
  readonly runSelection: ReadonlySignal<RunSelection> = computed(() => this._activeRun.value ?? this._selection.value);
  readonly result: ReadonlySignal<RunResult | null> = this._result;
  readonly toasts: ReadonlySignal<Toast[]> = this._toasts;
  /** measured frames per second (smoothed, for the settings screen / HUD counter) */
  readonly fps: ReadonlySignal<number> = this._fps;
  /** co-op sync status (pending picks, phase, players, host pause, ping); null in solo runs */
  readonly coop: ReadonlySignal<CoopStatus | null> = this._coop;
  /** true while the WebGL2 context is lost and awaiting restoration */
  readonly contextLost: ReadonlySignal<boolean> = this._contextLost;

  /** What to draw as a modal right now (pause beats sim requests beats story). */
  readonly modal: ReadonlySignal<ModalView | null> = computed(() => {
    if (this._paused.value && this._screen.value === 'run') return { kind: 'pause' } satisfies ModalView;
    const req = this._simModal.value;
    if (req) return { kind: req.kind, request: req } satisfies ModalView;
    const story = this._story.value;
    return story ? ({ kind: 'story', story } satisfies ModalView) : null;
  });

  // --- commands (called by UI) ---------------------------------------------------------------------------------

  chooseCard(index: number): void {
    this.handlers.chooseCard(index);
  }
  reroll(): void {
    this.handlers.reroll();
  }
  banish(index: number): void {
    this.handlers.banish(index);
  }
  skip(): void {
    this.handlers.skip();
  }
  pause(): void {
    this.handlers.pause();
  }
  resume(): void {
    this.handlers.resume();
  }
  /** Abandon the current run (from pause) or leave the run-end modal → results. */
  quit(): void {
    this.handlers.quit();
  }
  go(screen: Screen, opts?: GoOptions): void {
    this.handlers.go(screen, opts);
  }
  startRun(): void {
    this.handlers.startRun();
  }
  dismissStory(): void {
    this.handlers.dismissStory();
  }
  /** Merge a partial selection (hero/zone screens). */
  select(patch: Partial<RunSelection>): void {
    this._selection.value = { ...this._selection.value, ...patch };
  }

  // --- App-side setters (not for UI) ---------------------------------------------------------------------------

  /** App wires the real command implementations. */
  bind(h: StoreHandlers): void {
    this.handlers = h;
  }
  setScreen(s: Screen): void {
    this._screen.value = s;
  }
  setHud(h: HudSnapshot | null): void {
    this._hud.value = h;
  }
  private simModalSig = '';

  setSimModal(m: ModalRequest | null): void {
    // identity matters for signals: clone when id, budgets or cards change so in-place reroll/banish mutations trigger UI updates
    const sig = m
      ? `${m.id}|${m.rerolls}|${m.banishes}|${m.skips}|${m.canReroll ? 1 : 0}${m.canBanish ? 1 : 0}${m.canSkip ? 1 : 0}|${(m.cards ?? []).map((c) => `${c.kind}:${c.id}:${c.rank}:${c.rarity}`).join(',')}`
      : '';
    if (sig === this.simModalSig) return;
    this.simModalSig = sig;
    this._simModal.value = m ? (Array.isArray(m.cards) ? { ...m, cards: m.cards.slice() } : { ...m }) : null;
  }
  setPaused(p: boolean): void {
    this._paused.value = p;
  }
  setStory(s: StoryNotice | null): void {
    this._story.value = s;
  }
  setLoading(l: Partial<LoadingState>): void {
    this._loading.value = { ...this._loading.value, ...l };
  }
  /**
   * A run failed to load: stay on (or return to) the loading screen, which renders `message` with a Back button
   * (`go('menu')`). Bouncing straight to the menu hid the error (e2e audit P1-2).
   */
  failLoading(message: string): void {
    this._loading.value = { ...this._loading.value, error: message };
    this._screen.value = 'loading';
  }
  setResult(r: RunResult | null): void {
    this._result.value = r;
  }
  setFps(v: number): void {
    this._fps.value = v;
  }
  /** co-op sync status of the current run (null in a solo run) */
  setCoop(s: CoopStatus | null): void {
    this._coop.value = s;
  }
  /** active-run context published from the resolved RunConfig (null outside a run) */
  setActiveRun(sel: RunSelection | null): void {
    this._activeRun.value = sel ? { ...sel, runOptions: { ...sel.runOptions } } : null;
  }
  setContextLost(lost: boolean): void {
    this._contextLost.value = lost;
  }
  toast(kind: string, data: Toast['data'] = {}): void {
    const t: Toast = { id: this.toastId++, kind, data };
    this._toasts.value = [...this._toasts.value.slice(-3), t];
    setTimeout(() => {
      this._toasts.value = this._toasts.value.filter((x) => x.id !== t.id);
    }, 3200);
  }
}
