// Audio runtime (WebAudio). Public entry point: createAudio(manifest, settings) → AudioSystem.
//
//   const audio = createAudio(assets.manifest.audio, settings, { resolveUrl: (p) => assets.url(p) });
//   runEvents.subscribe((e, world) => audio.handleEvent(e, world));       // or audio.handleEvents(world.events, world)
//   runEvents.subscribeLifecycle(audio.lifecycle);                        // runStart / runEnd / pauseChanged
//   audio.update(world, dt);                                              // once per render frame (optional but recommended)
//   audio.playUi('sfx_ui_click');                                         // UI
//   audio.setZoneMusic('menu', 'calm');                                   // menus; in a run the adapter drives music itself
//
// Payload policy: what is fetched when (ARCHITECTURE §11 budgets: menu < 6 MB, zone < 15 MB).
//   boot           the MENU sounds only (UI hover/click/confirm…): the click that unlocks audio must already be decoded.
//                  No music: nothing is audible before the first gesture, so a track requested earlier waits for it.
//   first gesture  that track (the menu music) + the HOT in-run core (hits, pickups, swings, deaths, cards, level-up…),
//                  decoded long before a run can start (menu → hero select → zone select → Start).
//   run start      this run's class skill sounds at once; the zone music (adapter) is fetched later, when the world has had
//                  its first seconds: production / ?payload=1 count them from the run's first STEADY frames
//                  (MUSIC_AFTER_HUD_MS after STEADY_FRAMES frames in a row at >= 20 fps, so a slow load or a stalled first
//                  frame cannot pull it into the gated window of tools/qa/payload.ts: HUD + 6 s); dev: MUSIC_HOLD_MS after
//                  the run starts. The menu theme keeps playing and crossfades into the zone track once it is ready (it is
//                  not needed earlier); a track that is decoded already starts at once;
//                  the other sounds this run can play trickle in one file at a time (combat feedback → metins), and the
//                  boss track + boss sounds follow once the zone's first boss is BOSS_LEAD_S away (a run that ends
//                  earlier never downloads them).
//                  The zone's ambience bed (amb_<zone>, manifest kind 'ambience'; absent = none) is a background rank too:
//                  it is queued only once the zone music is decoded, so it is never in the gated window, and it starts
//                  after the music (SimAudioAdapter.tickBed). Only this zone's bed is ever fetched.
//                  Anything needed before its turn, or not listed, still loads on first use (SfxPlayer / LoopBank).
import type { AssetManifest, AudioAsset } from '../data/assetManifest';
import type { SimEvent } from '../sim/events';
import { lazyContent } from '../render/payloadPolicy';
import type { World } from '../sim/world';
import { type MusicMode, SimAudioAdapter } from './adapter';
import { AmbienceBed, AudioEngine } from './engine';
import { MusicPlayer } from './music';
import { SfxResolver } from './rules';
import { LoopBank, SfxPlayer } from './sfx';

export type { MusicMode } from './adapter';
export { loopRegion } from './music';
export { ruleFor, SfxResolver } from './rules';

/** The slice of Engine's `settings` singleton the audio runtime reads (masterVolume/musicVolume/sfxVolume, 0..1). */
export interface AudioSettingsSource {
  readonly value: { masterVolume: number; musicVolume: number; sfxVolume: number };
  subscribe(fn: (s: { masterVolume: number; musicVolume: number; sfxVolume: number }) => void): () => void;
}

export interface CreateAudioOptions {
  /** manifest-relative path ("assets/audio/sfx/…mp3") → fetchable URL; default prefixes `import.meta.env.BASE_URL` */
  resolveUrl?: (path: string) => string;
  /** attach first-gesture unlock listeners (default true) */
  autoUnlock?: boolean;
  /**
   * Follow the payload policy (default true): MENU sounds at boot, HOT at the first gesture, the rest per run.
   * false (tests, tools): no automatic preloading; sounds load when first played, through `preload()` or when the
   * adapter warms a track.
   */
  preload?: boolean;
  /**
   * When the zone track of a run is fetched (only with `preload`): true = once the run has shown steady frames, plus
   * MUSIC_AFTER_HUD_MS (production); false = MUSIC_HOLD_MS after the run starts (dev). Default: follows `lazyContent()`
   * (production builds and `?payload=1`).
   */
  musicAfterHud?: boolean;
}

export interface RunLifecycle {
  runStart?(world: World): void;
  runEnd?(world: World): void;
  pauseChanged?(paused: boolean): void;
}

export interface AudioSystem {
  /** AudioContext created and running (after the first user gesture) */
  readonly unlocked: boolean;
  /** Route one sim event (pooled object: not retained). Use with `runEvents.subscribe`. */
  handleEvent(e: SimEvent, world: World): void;
  /** Route a batch (e.g. `world.events` right after `world.step()`). */
  handleEvents(events: readonly SimEvent[], world: World): void;
  /** Per-frame housekeeping: listener position, positional loops, combat-heat → music intensity, boss-clear timer. */
  update(world: World | null, dt: number): void;
  /** Hook for `runEvents.subscribeLifecycle`. */
  readonly lifecycle: Required<RunLifecycle>;
  /** UI sound by manifest id (variant groups expand internally); non-positional. */
  playUi(id: string, opts?: { vol?: number; rate?: number }): void;
  /** Menus / zone select: 'menu' | 'calm' | 'combat' | 'boss' | 'off' for `zone` ('yeonmu', …). During a run the adapter chooses automatically. */
  setZoneMusic(zone: string, mode: MusicMode): void;
  /** Volumes 0..1 (normally driven by `settings`; call directly for previews). */
  setVolumes(v: { master?: number; music?: number; sfx?: number }): void;
  /** Starts decoding: 'menu' = UI sounds, 'hot' = + the in-run core, 'all' = every SFX. Resolves when done. */
  preload(what?: 'menu' | 'hot' | 'all'): Promise<void>;
  /** Explicit unlock (e.g. from a "Play" button handler). */
  unlock(): boolean;
  suspend(): Promise<void>;
  resume(): Promise<void>;
  dispose(): void;
  /** Dev/test tap: an AnalyserNode on the master bus (null until the context exists). */
  analyser(): AnalyserNode | null;
  /** diagnostics for dev tools / tests */
  readonly stats: { voices: number; started: number; dropped: number; loops: number; music: string; ambience: string };
}

/** Menu screens (src/ui/audio.ts): decoded at boot. */
const MENU = [/^sfx_ui_/, /^sfx_forge_/, /^sfx_essence_pick$/];

/** In-run core that every run plays from its first seconds: decoded at the first gesture, before a run can start. */
const HOT = [
  /^sfx_card_/,
  /^sfx_hit_flesh$/,
  /^sfx_xp_pickup/,
  /^sfx_yeop_pickup$/,
  /^sfx_sword_swing/,
  /^sfx_death_(animal|orc|generic)$/,
  /^sfx_player_hurt/,
  /^sfx_level_up$/,
  /^sfx_crit$/,
  /^sfx_dash_whoosh$/,
  /^sfx_run_start$/,
];

/** In-run sounds any run can play, by trickle rank (first match wins); the zone's boss pattern sounds join rank 3. */
const TRICKLE = [
  /^sfx_(hit_|death_|enemy_|telegraph|potion|chest_open|magnet|yeop_|arrow_hit|burn_tick|player_death|revive|awaken)/,
  /^sfx_metin_/,
  /^amb_/,
  /^mus_/,
  /^sfx_boss_|^sfx_(dragon_roar|wolf_howl|explosion|lightning_strike)/,
];
/** the zone ambience bed: opens once the zone music is decoded (it follows the music, outside the gated window) */
const AMB_RANK = 2;
/** ranks from here on (boss tracks, boss sounds) wait until the zone's first boss is BOSS_LEAD_S away */
const BOSS_RANK = 3;
const BOSS_LEAD_S = 90;
/** head start of the zone music and the run's skill sounds before the trickle begins */
const TRICKLE_DELAY_MS = 2000;
/** pause between two background files: keeps the connection free for sounds requested on first use */
const TRICKLE_GAP_MS = 40;
/** dev server / tools: the zone track of a run (2 MB) is fetched this long after the run starts */
const MUSIC_HOLD_MS = 10_000;
/**
 * production / ?payload=1: the zone track is fetched this long after the run's first steady frames, so the first seconds'
 * payload goes to the world. The payload gate (tools/qa/payload.ts) counts until HUD + 6 s; the first frames of a run compile
 * programs and stall for a second or more (seconds on a loaded machine), and the HUD shows later than the run starts
 * (measured: 2-6 s), so a timer from the run start put the 2.16 MB track inside the window on a slow load.
 */
const MUSIC_AFTER_HUD_MS = 9_000;
/** frames in a row no longer than STEADY_DT before the MUSIC_AFTER_HUD_MS countdown starts */
const STEADY_FRAMES = 30;
const STEADY_DT = 0.05;
/** a machine that never gets steady frames still gets its music this long after the run's first frame */
const STEADY_MAX_MS = 30_000;

function defaultResolve(path: string): string {
  const base = (import.meta.env.BASE_URL as string | undefined) ?? '/';
  return /^(https?:|blob:|data:)/.test(path) ? path : `${base.endsWith('/') ? base : `${base}/`}${path.replace(/^\//, '')}`;
}

/** MusicPlayer whose `prepare()` (warming a track that is not playing yet: the zone's boss track) can be routed through
 *  the payload policy instead of fetching at once. */
class PolicyMusicPlayer extends MusicPlayer {
  onPrepare: ((id: string) => void) | null = null;
  /** `performance.now()` until which a `play()` of a track that is not decoded yet waits (see `hold`); Infinity = until `frame()` says */
  private holdUntil = 0;
  private waiting: { id: string; fade: number } | null = null;
  private waitTimer: ReturnType<typeof setTimeout> | null = null;
  /** `holdUntilSteady`: armed until the run has shown steady frames (`since` = its first frame, -1 before) */
  private gate: { afterMs: number; since: number; steady: number } | null = null;

  constructor(
    private readonly audioEngine: AudioEngine,
    private readonly tracks: Record<string, AudioAsset>,
  ) {
    super(audioEngine, tracks);
  }

  override prepare(id: string): void {
    if (this.onPrepare) this.onPrepare(id);
    else super.prepare(id);
  }

  /** For `ms`, tracks that would have to be fetched start fetching only when it is over (the one playing keeps playing). */
  hold(ms: number): void {
    this.gate = null;
    this.holdUntil = ms > 0 ? performance.now() + ms : 0;
    if (ms <= 0) this.release();
  }

  /**
   * Like `hold`, but the clock starts with the run: such tracks wait until `frame()` has seen STEADY_FRAMES steady frames in a
   * row (or STEADY_MAX_MS passed since the first frame), then `afterMs` more.
   */
  holdUntilSteady(afterMs: number): void {
    this.release();
    this.holdUntil = Number.POSITIVE_INFINITY;
    this.gate = { afterMs, since: -1, steady: 0 };
  }

  /** One rendered run frame of `dt` seconds (the host calls it while a run is on screen). */
  frame(dt: number): void {
    const g = this.gate;
    if (!g) return;
    const now = performance.now();
    if (g.since < 0) g.since = now;
    g.steady = dt <= STEADY_DT ? g.steady + 1 : 0;
    if (g.steady < STEADY_FRAMES && now - g.since < STEADY_MAX_MS) return;
    this.gate = null;
    this.holdUntil = now + g.afterMs;
    this.arm();
  }

  override play(id: string, fade = 1.4): void {
    const asset = this.tracks[id];
    if (!asset || this.holdUntil - performance.now() <= 0 || this.audioEngine.has(asset.url)) {
      this.release();
      super.play(id, fade);
      return;
    }
    this.waiting = { id, fade };
    this.arm();
  }

  /** starts the timer of a waiting `play()` once the end of its hold is known */
  private arm(): void {
    const wait = this.holdUntil - performance.now();
    if (!this.waiting || this.waitTimer !== null || !Number.isFinite(wait)) return;
    this.waitTimer = setTimeout(
      () => {
        this.waitTimer = null;
        const h = this.waiting;
        this.waiting = null;
        if (h) super.play(h.id, h.fade);
      },
      Math.max(0, wait),
    );
  }

  override stop(fade = 1.2): void {
    this.release();
    super.stop(fade);
  }

  override playStinger(id: string, fadeMusic = 0.5): void {
    this.release();
    super.playStinger(id, fadeMusic);
  }

  override dispose(): void {
    this.release();
    super.dispose();
  }

  /** drops a waiting `play()` (a newer request, a stop or a stinger replaces it) */
  private release(): void {
    this.waiting = null;
    if (this.waitTimer !== null) clearTimeout(this.waitTimer);
    this.waitTimer = null;
  }
}

/** One run's background queue (URLs by TRICKLE rank, fetched one at a time). */
interface Trickle {
  alive: boolean;
  busy: boolean;
  queues: string[][];
  queued: Set<string>;
  timer: ReturnType<typeof setTimeout> | null;
  /** run clock (s, from `update`) and the time from which BOSS_RANK and later ranks may load */
  clock: number;
  bossGate: number;
  /** the zone music is decoded: AMB_RANK may load */
  ambOpen: boolean;
}

/** `manifest` = `AssetManifest.audio` (id → asset). */
export function createAudio(manifest: AssetManifest['audio'], settings?: AudioSettingsSource | null, options: CreateAudioOptions = {}): AudioSystem {
  const engine = new AudioEngine(options.resolveUrl ?? defaultResolve, { autoUnlock: options.autoUnlock });
  const music = new PolicyMusicPlayer(engine, manifest);
  const sfx = new SfxPlayer(engine, manifest);
  const loops = new LoopBank(engine, manifest);
  const resolver = new SfxResolver(
    (id) => id in manifest,
    (id) => {
      if (import.meta.env.DEV) console.warn(`[audio] no sound for sim id "${id}" (ignored)`);
    },
  );
  const ambience = new AmbienceBed(engine, manifest);
  const policy = options.preload !== false;
  const adapter = new SimAudioAdapter({ engine, sfx, loops, music, resolver, manifest, ambience, backgroundBeds: policy });

  const urlsOf = (a: AudioAsset): string[] => (a.variants && a.variants.length > 0 ? [...new Set([a.url, ...a.variants])] : [a.url]);
  const musicAfterHud = options.musicAfterHud ?? lazyContent();

  /** 0 = MENU, 1 = HOT, 2 = everything else */
  const tierOf = (id: string): number => (MENU.some((re) => re.test(id)) ? 0 : HOT.some((re) => re.test(id)) ? 1 : 2);
  const rankOf = (id: string): number => {
    const i = TRICKLE.findIndex((re) => re.test(id));
    return i < 0 ? TRICKLE.length : i;
  };

  const preload = async (what: 'menu' | 'hot' | 'all' = 'all'): Promise<void> => {
    const last = what === 'menu' ? 0 : what === 'hot' ? 1 : 2;
    const tiers: string[][] = [[], [], []];
    for (const [id, a] of Object.entries(manifest)) {
      if (a.kind !== 'sfx' && a.kind !== 'ambience') continue;
      if (id.startsWith('amb_')) continue; // zone beds belong to their run (the background stream), not to a sound tier
      const t = tierOf(id);
      if (t <= last) tiers[t]?.push(...urlsOf(a));
    }
    for (const urls of tiers) if (urls.length > 0) await Promise.all(urls.map((u) => engine.load(u)));
  };

  // ---- before the first gesture nothing is audible: a music request waits for it instead of downloading at boot ----
  let pendingMusic: { zone: string; mode: MusicMode } | null = null;
  let contextSeen = false;
  /** first time the AudioContext exists (gesture listener, explicit unlock): start what was waiting for it */
  const onContext = (): void => {
    if (contextSeen || !engine.ctx) return;
    contextSeen = true;
    const p = pendingMusic;
    pendingMusic = null;
    if (p) adapter.setZoneMusic(p.zone, p.mode);
    if (policy) void preload('hot');
  };
  engine.onRunning = onContext;

  // ---- in a run: the sounds it can play trickle in, one file at a time --------------------------------------------------
  let trickle: Trickle | null = null;
  /** starts the next eligible file (nothing while one is in flight or a gap/head-start timer is pending) */
  const pump = (t: Trickle): void => {
    if (!t.alive || t.busy || t.timer !== null) return;
    const open = t.clock >= t.bossGate;
    for (;;) {
      const url = t.queues.find((q, rank) => q.length > 0 && (rank === AMB_RANK ? t.ambOpen : open || rank < BOSS_RANK))?.shift();
      if (url === undefined) return;
      if (engine.has(url)) continue;
      t.busy = true;
      void engine.load(url).finally(() => {
        t.busy = false;
        if (t.alive) t.timer = setTimeout(() => ((t.timer = null), pump(t)), TRICKLE_GAP_MS);
      });
      return;
    }
  };
  /** `rank` = TRICKLE index; sounds no rank lists are left to first use */
  const enqueue = (t: Trickle, url: string, rank: number): void => {
    if (rank >= TRICKLE.length || engine.has(url) || t.queued.has(url)) return;
    t.queued.add(url);
    t.queues[rank]?.push(url);
  };
  const stopTrickle = (): void => {
    if (!trickle) return;
    trickle.alive = false;
    if (trickle.timer !== null) clearTimeout(trickle.timer);
    trickle = null;
  };
  // the adapter warms the zone's boss track when a run settles into calm/combat: queue it (never fetched from a menu)
  if (policy) {
    music.onPrepare = (id) => {
      const a = manifest[id];
      if (a && trickle) enqueue(trickle, a.url, BOSS_RANK);
    };
  }
  /** sound files of the skills this run's heroes can roll (their classes + the shared pool) */
  const skillUrls = (w: World): string[] => {
    const classes = new Set<string>(w.players.map((p) => p.classId));
    const out = new Set<string>();
    for (const s of w.content?.skills ?? []) {
      if (s.classId !== 'common' && !classes.has(s.classId)) continue;
      const id = s.sfx ? resolver.resolve(s.sfx) : null;
      const a = id ? manifest[id] : undefined;
      if (a) for (const u of urlsOf(a)) out.add(u);
    }
    return [...out];
  };
  const runStart = (w: World): void => {
    stopTrickle();
    pendingMusic = null; // the run's music replaces a menu request still waiting for a gesture
    const bosses = [...(w.zone.bosses ?? []).map((x) => ({ at: x.at, boss: x.boss })), { at: w.zone.final.at, boss: w.zone.final.boss }];
    const t: Trickle | null = policy
      ? {
          alive: true,
          busy: false,
          queues: Array.from({ length: TRICKLE.length }, (): string[] => []),
          queued: new Set(),
          timer: null,
          clock: 0,
          bossGate: Math.min(...bosses.map((b) => b.at)) - BOSS_LEAD_S,
          ambOpen: false,
        }
      : null;
    trickle = t;
    if (policy) {
      if (musicAfterHud) music.holdUntilSteady(MUSIC_AFTER_HUD_MS);
      else music.hold(MUSIC_HOLD_MS);
    }
    adapter.runStart(w); // zone music after the hold (see MUSIC_AFTER_HUD_MS); its boss track lands in the trickle through onPrepare
    if (!t) return;
    void preload('hot'); // normally done at the first gesture; a run started without one (tools) gets it here
    for (const url of skillUrls(w)) void engine.load(url);
    for (const [id, a] of Object.entries(manifest)) {
      if (id.startsWith('amb_')) continue; // …except this zone's bed, below
      if (a.kind === 'sfx' || a.kind === 'ambience') for (const u of urlsOf(a)) enqueue(t, u, rankOf(id));
    }
    const bed = adapter.bedUrl; // null: the manifest has no amb_<zone> (nothing is fetched, nothing plays)
    if (bed !== null) enqueue(t, bed, AMB_RANK);
    // this zone's bosses: their tracks and pattern sounds (with the boss sounds, behind the gate)
    for (const { boss } of bosses) {
      const def = w.ix.bosses.get(boss);
      const track = def?.music ? manifest[def.music] : undefined;
      if (track) enqueue(t, track.url, BOSS_RANK);
      for (const p of def?.patterns ?? []) {
        const id = p.sfx ? resolver.resolve(p.sfx) : null;
        const a = id ? manifest[id] : undefined;
        if (a) for (const u of urlsOf(a)) enqueue(t, u, TRICKLE.length - 1);
      }
    }
    t.timer = setTimeout(() => ((t.timer = null), pump(t)), TRICKLE_DELAY_MS);
  };

  const applyVolumes = (s: { masterVolume: number; musicVolume: number; sfxVolume: number }): void =>
    engine.setLevels({ master: s.masterVolume, music: s.musicVolume, sfx: s.sfxVolume });
  const unsub = settings ? settings.subscribe(applyVolumes) : null;

  const lifecycle: Required<RunLifecycle> = {
    runStart,
    runEnd: (w) => {
      stopTrickle();
      music.hold(0);
      adapter.runEnd(w);
    },
    pauseChanged: (p) => adapter.pauseChanged(p),
  };

  let tap: AnalyserNode | null = null;

  if (policy) void preload('menu');

  return {
    get unlocked() {
      return engine.running;
    },
    handleEvent: (e, w) => adapter.handleEvent(e, w),
    handleEvents: (events, w) => adapter.handleEvents(events, w),
    update: (w, dt) => {
      if (!contextSeen) onContext();
      const t = trickle;
      if (t && w) {
        t.clock = w.time;
        if (!t.ambOpen && adapter.bedUrl !== null && adapter.zoneMusicReady()) t.ambOpen = true; // the zone music is up: its bed may follow
        pump(t); // no-op while a file or a gap is pending; picks the boss ranks up once their gate opens
      }
      if (w) music.frame(dt); // a world is only passed while a run is on screen: its frames start the zone music's countdown
      adapter.update(w, dt);
    },
    lifecycle,
    playUi(id, opts) {
      const rid = resolver.resolve(id);
      if (rid === null) return;
      sfx.play(rid, 0, 0, { flat: true, vol: opts?.vol ?? 1, rate: opts?.rate });
    },
    setZoneMusic(zone, mode) {
      if (!engine.ctx) {
        pendingMusic = { zone, mode };
        return;
      }
      onContext();
      adapter.setZoneMusic(zone, mode);
    },
    setVolumes: (v) => engine.setLevels({ ...(v.master !== undefined && { master: v.master }), ...(v.music !== undefined && { music: v.music }), ...(v.sfx !== undefined && { sfx: v.sfx }) }),
    preload,
    analyser() {
      const c = engine.ctx;
      if (!c) return null;
      if (!tap) {
        tap = c.createAnalyser();
        tap.fftSize = 2048;
        engine.master.connect(tap);
      }
      return tap;
    },
    unlock() {
      const ok = engine.unlock();
      onContext();
      return ok;
    },
    suspend: () => engine.suspend(),
    resume: () => engine.resume(),
    dispose() {
      stopTrickle();
      engine.onRunning = null;
      pendingMusic = null;
      unsub?.();
      loops.stopAll();
      sfx.dispose();
      ambience.dispose();
      music.dispose();
      engine.dispose();
    },
    get stats() {
      return { voices: sfx.activeVoices, started: sfx.started, dropped: sfx.dropped, loops: loops.count, music: music.currentUrl, ambience: ambience.currentUrl };
    },
  };
}
