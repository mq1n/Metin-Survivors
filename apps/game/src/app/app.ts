// App: boots the engine and runs the screen state machine boot → menu → heroSelect → zoneSelect → loading → run → results.
import { Vector3 } from 'three';
import type { ClassDef, ContentDB, Sex } from '../data/schema';
import { Assets } from '../engine/assets';
import { FATAL_BAD_FRAMES, FixedLoop } from '../engine/loop';
import { Input, type UiAction } from '../engine/input';
import { settings } from '../engine/settings';
import { RenderCore } from '../render/core';
import type { HeroSpec } from '../render/world';
import { RenderWorld } from '../render/world';
import type { MetaBonuses, RunConfig, RunResult } from '../sim/run';
import { EMPTY_META } from '../sim/run';
import { loadContent } from './content';
import { RenderEventRouter } from './renderEvents';
import { runEvents } from './runEvents';
import { RunSession } from './run';
import { clearRunMarker, markRunStart } from './runMarker';
import { settleRunOnce } from './settlement';
import { defaultSelection, GameStore, type GoOptions, type RunSelection, type Screen } from './store';
import { bonusContextFor } from '../meta/bonuses';
import { equippedLook } from '../meta/gear';
import { MetaService } from '../meta/service';
import { api } from '../net/api';
import { createAudio, type AudioSystem } from '../audio';
import { createCoopFactory, type CoopRunStart, type CoopSession } from '../net/coop';
import { effect } from '@preact/signals';
import { createHeroPreview, type HeroPreviewFactory } from './heroPreview';
import { loadFailureMessage, runCrashMessage } from './loadFailure';
import { attachBootSink, BOOT_UI_MOUNTED, finishBoot, reportBoot } from './bootProgress';

/**
 * PERF-03: the UI package's first-use prewarm (ui/prewarm.ts). Loaded lazily like the UI itself (app/ never imports ui/ statically); the
 * chunk is tiny, the modals it mounts are in the UI chunk that is already loaded by the time a run starts.
 */
interface UiPrewarm {
  prewarmRunUi(opts?: { signal?: AbortSignal }): Promise<unknown>;
}
const uiPrewarmLoaders = import.meta.glob<UiPrewarm>('../ui/prewarm.ts');
/** how long the run screen waits for the prewarm to finish once the run is loaded (it normally has: it overlaps the load); what is left is dropped and the next run paints it */
export const PREWARM_JOIN_MS = 2500;
/** bounded grace window after aborting an overdue prewarm so cleanup settles without blocking run startup indefinitely */
export const PREWARM_CLEANUP_MS = 100;

/** The prewarm of the run UI, running beside the load: `finish()` joins it (bounded) and stops it, `abort()` stops it at once. Never throws. */
export interface UiPrewarmJob {
  finish(): Promise<void>;
  abort(): void;
}

export interface UiPrewarmOptions {
  /** the chunk loader (tests); default: the lazy `ui/prewarm.ts` */
  load?: (() => Promise<UiPrewarm>) | null;
  joinMs?: number;
  cleanupMs?: number;
}

export function startUiPrewarm(opts: UiPrewarmOptions = {}): UiPrewarmJob {
  const load = opts.load === undefined ? (uiPrewarmLoaders['../ui/prewarm.ts'] ?? null) : opts.load;
  const joinMs = opts.joinMs ?? PREWARM_JOIN_MS;
  const cleanupMs = opts.cleanupMs ?? PREWARM_CLEANUP_MS;
  const ctl = new AbortController();
  const done: Promise<unknown> = (async () => {
    if (load) await (await load()).prewarmRunUi({ signal: ctl.signal });
  })().catch(() => undefined);
  return {
    abort: () => ctl.abort(),
    finish: async () => {
      let finished = false;
      const marked = done.then(() => {
        finished = true;
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([marked, new Promise<void>((r) => (timer = setTimeout(r, joinMs)))]);
      clearTimeout(timer);
      ctl.abort();
      if (!finished) {
        let cleanTimer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([marked, new Promise<void>((r) => (cleanTimer = setTimeout(r, cleanupMs)))]);
        clearTimeout(cleanTimer);
      }
    },
  };
}

/** Integration points other packages provide (META: bonuses/settlement, UI: nothing). All optional. */
export interface AppHooks {
  loadContent(): Promise<ContentDB>;
  /** pre-summed persistent bonuses for the chosen hero (gear/talents/blacksmith/collection) */
  metaBonuses(sel: RunSelection, content: ContentDB): MetaBonuses;
  /** hero model + weapon ids for the selection (armor tier look); default derives from ClassDef */
  heroSpec(sel: RunSelection, content: ContentDB): HeroSpec;
  /** called once when a run ends (victory, defeat, abandon or crash); return false if durable settlement failed */
  onRunEnd(result: RunResult, reason?: 'quit' | 'crash'): boolean | void;
}

export function defaultHeroSpec(sel: RunSelection, content: ContentDB): HeroSpec {
  const cls: ClassDef | undefined = content.classes.find((c) => c.id === sel.classId) ?? content.classes[0];
  if (!cls) throw new Error('content has no classes');
  const sex: Sex = cls.models[sel.sex] ? sel.sex : (cls.sexes[0] ?? 'm');
  const models = cls.models[sex] ?? [];
  const tier = Math.min(sel.armorTier, Math.max(0, models.length - 1));
  const modelId = models[tier] ?? models[0];
  if (!modelId) throw new Error(`class ${cls.id} has no hero model for sex ${sex}`);
  const weapons = sel.doctrine === 'b' && cls.weaponsB ? cls.weaponsB : cls.weapons;
  return { modelId, weaponId: weapons[Math.min(tier, weapons.length - 1)], styleB: sel.doctrine === 'b' };
}

const DEFAULT_HOOKS: AppHooks = {
  loadContent,
  metaBonuses: () => EMPTY_META,
  heroSpec: defaultHeroSpec,
  onRunEnd: () => {},
};

export class App {
  readonly store = new GameStore();
  readonly assets: Assets;
  readonly core: RenderCore;
  readonly renderWorld: RenderWorld;
  readonly input = new Input();
  readonly loop: FixedLoop;
  readonly hooks: AppHooks;
  session: RunSession | null = null;
  /** audio runtime, attached by boot() */
  audio: AudioSystem | null = null;

  private readonly router: RenderEventRouter;
  private starting = false;
  private offCoop: (() => void) | null = null;
  private retainedCoop: CoopRunStart | null = null;
  private fpsAcc = 0;
  private fpsFrames = 0;

  constructor(canvas: HTMLCanvasElement, assets: Assets, hooks: Partial<AppHooks> = {}) {
    this.hooks = { ...DEFAULT_HOOKS, ...hooks };
    this.assets = assets;
    const q = new URLSearchParams(location.search).get('quality');
    const forced = q === 'low' || q === 'medium' || q === 'high' || q === 'ultra' ? q : undefined;
    this.core = new RenderCore(canvas, assets, forced ? { quality: forced, fixedQuality: true } : {});
    this.renderWorld = new RenderWorld(this.core);
    this.router = new RenderEventRouter(this.renderWorld);
    this.router.attach();
    this.loop = new FixedLoop({
      step: (dt) => this.session?.tick(dt),
      render: (alpha, dt) => this.renderFrame(alpha, dt),
      error: (err, n) => this.onFrameError(err, n),
    });
    if (this.core.isMobile) this.loop.maxCatchupSteps = 2;

    this.input.attach();
    this.input.touch.attach(canvas);
    this.input.onAction((a) => this.onAction(a));
    settings.subscribe((s) => this.renderWorld.perf.setVisible(s.showFps));
    let lastQuality = settings.value.quality;
    settings.subscribe((s) => {
      if (s.quality === lastQuality) return;
      lastQuality = s.quality;
      if (!forced) this.core.setQualitySetting(s.quality);
    });

    this.store.bind({
      chooseCard: (i) => this.session?.world.chooseCard(i, 0),
      reroll: () => this.session?.world.reroll(0),
      banish: (i) => this.session?.world.banish(i, 0),
      skip: () => this.session?.world.skip(0),
      pause: () => this.setPaused(true),
      resume: () => this.setPaused(false),
      quit: () => this.quit(),
      go: (s, opts) => this.go(s, opts),
      startRun: () => void this.startRun(),
      dismissStory: () => this.dismissStory(),
    });
    const syncMovement = (): void => {
      this.input.movementEnabled =
        this.store.screen.value === 'run' && this.store.modal.value === null && !this.store.contextLost.value;
    };
    this.store.screen.subscribe(syncMovement);
    this.store.modal.subscribe(syncMovement);
    this.store.contextLost.subscribe(syncMovement);
    this.core.onContextLost(() => this.onContextLost());
    this.core.onContextRestored(() => this.onContextRestored());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.store.screen.value === 'run') this.setPaused(true);
    });
  }

  start(): void {
    this.store.setScreen('menu');
    this.loop.start();
  }

  // ---- navigation --------------------------------------------------------------------------------------------------

  go(screen: Screen, opts?: GoOptions): void {
    const cur = this.store.screen.value;
    if (screen === 'run' || screen === 'loading') return; // only startRun() enters those
    if (cur === 'run') {
      if (opts?.keepCoopLobby && this.session?.coop) {
        this.session.coop.retainForLobby?.();
        this.retainedCoop = this.session.coop;
      }
      this.endSession();
    }
    if (!opts?.keepCoopLobby && this.retainedCoop) {
      this.retainedCoop.discardLobby?.();
      this.retainedCoop = null;
    } else if (opts?.keepCoopLobby) {
      this.retainedCoop = null;
    }
    if (screen === 'menu') this.store.setResult(null);
    this.store.setScreen(screen);
    this.clearCanvas();
  }

  /** Starts a run; `coop` is set when the co-op room announced one (this client is its host or a guest). */
  async startRun(coop: CoopRunStart | null = null): Promise<void> {
    if (this.starting || this.store.screen.value === 'loading') return;
    this.starting = true;
    if (this.retainedCoop) {
      this.retainedCoop.discardLobby?.();
      this.retainedCoop = null;
    }
    const store = this.store;
    /** the session being assembled (disposed again when its load fails) */
    let pending: RunSession | null = null;
    /** PERF-03: paints the run's UI surfaces once under the loading screen (ui/prewarm.ts) */
    let prewarm: UiPrewarmJob | null = null;
    try {
      this.endSession();
      store.setScreen('loading');
      store.setLoading({ fraction: 0, label: 'content', error: null });
      // PERF-03: the UI prewarm starts with the loading screen, so its Skia shader compiles overlap the content / world / model / terrain
      // work instead of the WebGL warm-up at the end (they share one GPU main thread); it reads the run's HUD snapshot once that is in the store
      prewarm = startUiPrewarm();
      const content = await this.hooks.loadContent();
      const sel = resolveSelection(store.selection.value, content);
      store.select(sel);
      // Sky Sovereign's Favour (MT-01) is per zone: in a co-op room the room's zone / difficulty count, not the menu's selection
      const meta = this.hooks.metaBonuses(coop ? { ...sel, zone: coop.zone, difficulty: coop.difficulty } : sel, content);
      // co-op: the room decides zone / difficulty / seed and lists the other heroes; guests hand their bonuses to the host here
      const config: RunConfig = coop
        ? await coop.config({ meta, runOptions: sel.runOptions })
        : {
            zone: sel.zone,
            difficulty: sel.difficulty,
            classId: sel.classId,
            doctrine: sel.doctrine,
            sex: sel.sex,
            empire: sel.empire,
            seed: (Math.random() * 0x7fffffff) | 0,
            meta,
            runOptions: sel.runOptions,
          };
      // UI-01: publish the authoritative active-run context separately from solo menu selection so co-op minimap/pause match the room
      store.setActiveRun({
        classId: config.classId,
        doctrine: config.doctrine,
        sex: config.sex,
        empire: config.empire,
        zone: config.zone,
        difficulty: config.difficulty,
        armorTier: sel.armorTier,
        runOptions: {
          density: config.runOptions?.density ?? sel.runOptions.density,
          health: config.runOptions?.health ?? sel.runOptions.health,
          damage: config.runOptions?.damage ?? sel.runOptions.damage,
          speed: config.runOptions?.speed ?? sel.runOptions.speed,
        },
      });
      const session = new RunSession({ renderWorld: this.renderWorld, input: this.input, store }, config, content, coop);
      pending = session;
      // the run's own HUD snapshot (t = 0) is what the prewarmed HUD / modals wear; the load pushes the same again when it is done
      try {
        store.setHud(session.world.hud(0));
      } catch {
        /* a co-op mirror without a first snapshot: the prewarm falls back to a bare one */
      }
      performance.mark('ms:run:built');
      if (coop) this.offCoop = coop.onStatus((s) => store.setCoop(s));
      // hero models in WORLD order (local hero first); teammates use their lobby loadout, not this player's gear
      const heroes = coop
        ? coop.players.map((p) =>
            p.local ? this.hooks.heroSpec(sel, content) : defaultHeroSpec({ ...sel, classId: p.loadout.classId, doctrine: p.loadout.doctrine, sex: p.loadout.sex, empire: p.loadout.empire, armorTier: p.loadout.tier }, content),
          )
        : [this.hooks.heroSpec(sel, content)];
      await session.load(heroes, (fraction, label) => store.setLoading({ fraction, label }));
      await prewarm.finish();
      performance.mark('ms:run:joined');
      this.session = session;
      // a reload from here on drops the run: the next boot says so once (QA EXPLORER-4); endSession() / settlement clear the marker
      markRunStart({ zone: config.zone, classId: config.classId, difficulty: config.difficulty, startedAt: Date.now(), coop: coop !== null });
      this.loop.paused = false;
      store.setPaused(false);
      store.setStory(null);
      store.setResult(null);
      store.setScreen('run');
      // The opening story beat blocks the sim until dismissed (never in co-op: it would freeze the shared sim for everybody).
      const intro = !coop && session.world.zone.story.intro.length > 0;
      if (intro) {
        store.setStory({ kind: 'zoneIntro', ref: session.world.zone.id });
        this.loop.paused = true;
      }
    } catch (err) {
      console.error(err);
      prewarm?.abort();
      // tear down what the failed load already built (zone scene + its render system, swapped terrain height, run content)
      if (pending) {
        if (this.session === pending) this.session = null;
        try {
          pending.dispose();
        } catch (disposeErr) {
          console.error(disposeErr);
        }
      }
      coop?.abort();
      this.offCoop?.();
      this.offCoop = null;
      store.setCoop(null);
      store.setActiveRun(null);
      // stay on the loading screen: it shows the error with a Back button (bouncing to the menu silently hid it)
      store.failLoading(loadFailureMessage(err));
    } finally {
      this.starting = false;
    }
  }

  private setPaused(p: boolean): void {
    if (!this.session || this.store.screen.value !== 'run') return;
    if (!p && this.store.contextLost.value) return;
    if (this.store.paused.value === p) return;
    this.store.setPaused(p);
    const coop = this.session.coop;
    // host: pausing stops the shared sim for everybody; a guest cannot pause it, its pause menu is an overlay only
    coop?.setPaused(p);
    this.loop.paused = coop?.role === 'guest' ? false : p || this.store.modal.value?.kind === 'story' || this.store.contextLost.value;
    runEvents.pauseChanged(p);
  }

  private dismissStory(): void {
    if (this.store.modal.value?.kind !== 'story') return;
    this.store.setStory(null);
    if (!this.store.paused.value && !this.store.contextLost.value) this.loop.paused = false;
  }

  /** Abandon (from pause) or finish (from the run-end modal) → results screen. */
  private quit(): void {
    const session = this.session;
    if (!session) return;
    const result = session.world.over ? session.result(session.world.victory) : session.world.buildResult(false);
    this.hooks.onRunEnd(result, 'quit');
    this.store.setResult(result);
    if (session.coop && (session.world.over || session.coop.role === 'host')) {
      session.coop.retainForLobby?.();
      this.retainedCoop = session.coop;
    }
    this.endSession();
    this.store.setPaused(false);
    this.store.setStory(null);
    this.loop.paused = false;
    this.store.setScreen('results');
    this.clearCanvas();
  }

  private endSession(opts: { preserveMarker?: boolean } = {}): void {
    if (!opts.preserveMarker) clearRunMarker();
    this.offCoop?.();
    this.offCoop = null;
    this.store.setCoop(null);
    this.store.setActiveRun(null);
    this.store.setPaused(false);
    this.store.setStory(null);
    this.loop.paused = false;
    this.session?.dispose();
    this.session = null;
  }

  private clearCanvas(): void {
    if (this.core.contextLost) return;
    const r = this.core.renderer;
    r.setRenderTarget(null);
    r.clear();
  }

  // ---- WebGL context lifecycle (RENDER-05) -------------------------------------------------------------------------

  private onContextLost(): void {
    this.store.setContextLost(true);
    this.input.movementEnabled = false;
    if (this.session && this.store.screen.value === 'run') {
      this.setPaused(true);
      if (this.session.coop?.role !== 'guest') this.loop.paused = true;
    }
  }

  private onContextRestored(): void {
    this.store.setContextLost(false);
    if (this.session && this.store.screen.value === 'run') {
      const coop = this.session.coop;
      // Keep the pause menu open on restore so the player resumes deliberately after GPU recovery.
      this.loop.paused = coop?.role === 'guest' ? false : this.store.paused.value || this.store.modal.value?.kind === 'story';
    }
  }

  // ---- frame -------------------------------------------------------------------------------------------------------

  /** error messages already logged (a throwing frame repeats every 16 ms: each distinct error is logged once) */
  private readonly loggedFrameErrors = new Set<string>();

  /**
   * A frame threw (FixedLoop survives it and keeps scheduling). One bad frame is just logged; FATAL_BAD_FRAMES in a row means the
   * run is broken for good: it is ended and the player gets the error panel (RETRY / BACK) instead of a frozen page.
   */
  private onFrameError(err: unknown, consecutive: number): void {
    const key = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    if (!this.loggedFrameErrors.has(key) && this.loggedFrameErrors.size < 20) {
      this.loggedFrameErrors.add(key);
      console.error('frame error', err);
    }
    if (consecutive >= FATAL_BAD_FRAMES) this.crashRun(err);
  }

  private crashRun(err: unknown): void {
    const store = this.store;
    const session = this.session;
    if (!session || store.screen.value !== 'run') return; // a menu frame: nothing to end, the loop just keeps going
    // SIM-02: recover and durably settle what the hero earned before disposing; preserve the run marker if settlement fails
    let settledOk = false;
    let recovered: RunResult | null = null;
    try {
      recovered = session.world.over ? session.result(session.world.victory) : session.world.buildResult(false);
      store.setResult(recovered);
      const outcome = this.hooks.onRunEnd(recovered, 'crash');
      settledOk = outcome !== false;
    } catch (inner) {
      console.error('run result after a crash failed', inner);
      settledOk = false;
    }
    try {
      this.endSession({ preserveMarker: !settledOk });
    } catch (inner) {
      console.error('endSession after a crash failed', inner);
      this.session = null;
    }
    store.setPaused(false);
    store.setStory(null);
    this.loop.paused = false;
    try {
      this.clearCanvas();
    } catch (inner) {
      console.error(inner);
    }
    store.setLoading({ fraction: 0, label: 'content' });
    store.failLoading(runCrashMessage(err));
  }

  private renderFrame(alpha: number, dt: number): void {
    this.input.pollGamepad();
    // audio is optional: a throwing audio update must not take the frame (and the run) down with it
    try {
      this.audio?.update(this.session?.world ?? null, dt);
    } catch (err) {
      this.onFrameError(err, 1);
    }
    const s = this.session;
    if (s && this.store.screen.value === 'run' && !this.core.contextLost) s.frame(alpha, dt);
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.store.setFps(Math.round(this.fpsFrames / this.fpsAcc));
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
  }

  // ---- input shortcuts ---------------------------------------------------------------------------------------------

  private onAction(a: UiAction): void {
    if (a.kind === 'perf') {
      settings.update({ showFps: !settings.value.showFps });
      return;
    }
    const store = this.store;
    const session = this.session;
    if (store.screen.value !== 'run' || !session) return;
    const modal = store.modal.value;
    if (a.repeat) return;
    if (modal?.kind === 'pause') {
      if (a.kind === 'cancel' || a.kind === 'pause') this.setPaused(false);
      return;
    }
    // Modal hotkeys (cards, reroll, banish, skip, story confirm) belong to the UI via input.onAction.
    if (modal) return;
    if (a.kind === 'cancel' || a.kind === 'pause') this.setPaused(true);
  }
}

/** Falls back to the first available class/zone when the stored selection does not exist in the content. */
export function resolveSelection(sel: RunSelection, content: ContentDB): RunSelection {
  const cls = content.classes.find((c) => c.id === sel.classId) ?? content.classes[0];
  const zone = content.zones.find((z) => z.id === sel.zone) ?? content.zones[0];
  if (!cls || !zone) throw new Error('content has no classes/zones');
  const sex: Sex = cls.sexes.includes(sel.sex) ? sel.sex : (cls.sexes[0] ?? 'm');
  return { ...sel, classId: cls.id, zone: zone.id, sex };
}

declare global {
  interface Window {
    __ms?: App;
  }
}

/** Page entry: creates the engine, opens the meta profile, mounts the UI (src/ui/index.ts) and starts. */
export async function boot(hooks: Partial<AppHooks> = {}): Promise<App> {
  const canvas = document.getElementById('game');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('missing #game canvas');
  const uiRoot = document.getElementById('ui');
  if (!uiRoot) throw new Error('missing #ui container');
  // Boot progress: the inline splash of index.html already shows a gauge; every stage below moves it on (app/bootProgress.ts)
  reportBoot('assets');
  const assets = new Assets();
  await assets.init();
  reportBoot('content');
  const content = await (hooks.loadContent ?? loadContent)();

  reportBoot('save');
  let meta: MetaService | null = null;
  try {
    meta = await MetaService.open({ content, api });
    meta.bindSettings(settings);
    meta.startAutoSync();
  } catch (err) {
    console.error('meta service unavailable, running without persistence', err);
  }
  const heroSpec = (sel: RunSelection, c: ContentDB): HeroSpec => {
    const base = defaultHeroSpec(sel, c);
    const look = meta ? equippedLook(meta.save, c, sel.classId) : {};
    return { modelId: look.armor ?? base.modelId, weaponId: look.weapon ?? base.weaponId, ...(base.styleB ? { styleB: true } : {}) };
  };
  let appRef: App | null = null;
  const userOnRunEnd = hooks.onRunEnd;
  const merged: Partial<AppHooks> = {
    loadContent: () => Promise.resolve(content),
    heroSpec,
    ...(meta ? { metaBonuses: (sel: RunSelection) => (meta as MetaService).bonusesFor(bonusContextFor(sel)) } : {}),
    ...hooks,
    onRunEnd: (result, reason) => {
      const sel = appRef?.store.runSelection.value ?? defaultSelection();
      const settled = settleRunOnce(meta, result, {
        empire: sel.empire,
        sex: sel.sex,
        ...(reason === 'crash' ? { submit: false } : {}),
        flush: true,
      });
      const hookRes = userOnRunEnd?.(result, reason);
      if (hookRes === false) return false;
      return settled !== null;
    },
  };
  const app = new App(canvas, assets, merged);
  appRef = app;
  attachBootSink(app.store); // the boot screen reads store.loading from here on
  reportBoot('ui');
  // Co-op: the lobby talks to a CoopSession (≙ CoopLink); when the room starts, every client (host included) enters startRun(run).
  const coopFactory = createCoopFactory(api, {
    getLoadout: () => {
      const sel = app.store.selection.value;
      return { classId: sel.classId, doctrine: sel.doctrine, sex: sel.sex, empire: sel.empire, tier: Math.min(3, Math.max(0, Math.round(sel.armorTier))) };
    },
    onRunStart: (run) => void app.startRun(run),
  });
  const audio = createAudio(assets.manifest.audio, settings, { resolveUrl: (p) => assets.url(p) });
  app.audio = audio;
  runEvents.subscribe((e, w) => audio.handleEvent(e, w));
  runEvents.subscribeLifecycle(audio.lifecycle);
  effect(() => {
    const s = app.store.screen.value;
    if (s !== 'run' && s !== 'loading') audio.setZoneMusic('menu', 'calm');
  });
  // QA hook: the dev server, or the frozen QA snapshot build (VITE_QA_HOOKS=1, tools/qa/playthrough.ts). A plain production build folds this to false and ships no hook.
  if (import.meta.env.DEV || import.meta.env.VITE_QA_HOOKS === '1') window.__ms = app;

  // World → CSS pixel projection for off-screen metin/boss arrows.
  const project = (x: number, z: number): { x: number; y: number; behind: boolean } | null => {
    const cam = app.core.camera;
    const v = new Vector3(x, app.core.heightAt(x, z), z).applyMatrix4(cam.matrixWorldInverse);
    const behind = v.z > 0;
    v.applyMatrix4(cam.projectionMatrix);
    const r = canvas.getBoundingClientRect();
    return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height, behind };
  };
  const heroPreview = createHeroPreview(assets, (sel) => heroSpec({ ...app.store.selection.value, ...sel }, content));

  // Optional module: the UI package (src/ui/index.ts → mountUi). Absent → DEV panel.
  const uis = import.meta.glob<{ mountUi: (root: HTMLElement, deps: UiDeps) => unknown }>('../ui/index.ts');
  const loadUi = uis['../ui/index.ts'];
  const params = new URLSearchParams(location.search);
  let uiMounted = false;
  if (loadUi && !(import.meta.env.DEV && params.has('noui'))) {
    try {
      const { mountUi } = await loadUi();
      mountUi(uiRoot, { store: app.store, meta, content, assets, api, audio, input: app.input, events: runEvents, heroPreview, coopFactory, project });
      uiMounted = true;
      reportBoot('ui', BOOT_UI_MOUNTED);
    } catch (err) {
      // The UI package is developed in parallel; in DEV a broken UI module must not block engine work.
      if (!import.meta.env.DEV) throw err;
      console.error('[boot] UI failed to load, falling back to the dev panel', err);
    }
  }
  if (import.meta.env.DEV && (params.has('dev') || !uiMounted)) {
    const { mountDevUi } = await import('../dev/devUi');
    mountDevUi(uiRoot, app);
  }
  // hold the boot screen until its paintings are decoded (no pop-in), show the gauge complete for a beat, then open the menu
  // a phone held upright (the UI's phone-p tier: narrower than 600 px and taller than wide) paints the 9:16 key art (menu.css), so that is the one to wait for:
  // the 16:9 file (434 KB) is never shown there and used to be downloaded and decoded for nothing
  const phonePortrait = window.innerWidth < window.innerHeight && window.innerWidth < 600;
  const bootArt = [phonePortrait && assets.manifest.textures['ui_keyart_menu_portrait'] ? 'ui_keyart_menu_portrait' : 'ui_keyart_menu', 'ui_logo', 'uk_hud_gtube', 'uk_hud_gfill_gold', 'uk_hud_bar']
    .map((id) => assets.manifest.textures[id]?.url)
    .filter((u): u is string => typeof u === 'string')
    .map((u) => assets.url(u));
  await finishBoot({ art: bootArt });
  app.start();
  return app;
}

interface UiDeps {
  store: GameStore;
  meta: MetaService | null;
  content: ContentDB;
  assets: Assets;
  api: typeof api;
  input: Input;
  events: typeof runEvents;
  heroPreview: HeroPreviewFactory;
  audio: AudioSystem;
  /** builds the lobby link (a `CoopSession`) for a room code; a started room calls `app.startRun(run)` on every client */
  coopFactory: (room: string) => CoopSession;
  project: (x: number, z: number) => { x: number; y: number; behind: boolean } | null;
}
