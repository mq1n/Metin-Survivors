// WebAudio core: lazily-created AudioContext (autoplay-policy safe), bus graph, decoded-buffer cache.
//
//   decks ─► musicFilter ─► musicDuck ─┐
//                                      ├─► musicBus(vol) ─┐
//   stingers ──────────────────────────┘                  ├─► master(vol) ─► limiter ─► destination
//   sfx voices ───────────────────────────► sfxBus(vol) ──┘
//   musicDuck is one gain with two sources (AR-02): the event duck of rules.ts (level-up, boss, metin: duckMusic) and the SFX
//   density duck (the adapter: setDensityDuck, at most DUCK_DENSITY_MAX_DB); the deeper of the two wins, never their sum.
//   zone bed ─► bedGain ─► ambienceFilter ─► ambienceBus ─► sfxBus      (the bed rides the SFX slider)
//
// The playback context is created on the first user gesture (no "AudioContext was not allowed to start" console noise);
// files are fetched and decoded right away through an OfflineAudioContext, so the first click already has its sound.

import type { AudioAsset } from '../data/assetManifest';
import { loopRegion } from './music';

export interface BusLevels {
  master: number;
  music: number;
  sfx: number;
}

/** slider 0..1 → linear gain (square law feels linear to the ear) */
export const volumeToGain = (v: number): number => {
  const c = v < 0 ? 0 : v > 1 ? 1 : v;
  return c * c;
};

/** zone ambience bed (AR-01): level while combat heat is on (the music's heat), cut-off while paused, fades */
export const AMB_COMBAT_DB = -6;
export const AMB_MUFFLE_HZ = 1200;
export const AMB_OPEN_HZ = 22000;
export const AMB_FADE_IN_S = 2.5;
export const AMB_FADE_OUT_S = 1.5;

/**
 * Master safety limiter (AR-02). Chrome's DynamicsCompressor adds make-up gain of 0.6 x the compression of a full-scale input,
 * so the numbers come from the measured transfer (build/AR-02/browser/limiter_curve.ts): content below the threshold gets
 * +2.3 dB (the old -9 dB / 8:1 setting gave +3.1 dB and bent everything above -9 dBFS), a 0 dBFS peak leaves at -1.4 dBFS and
 * a +6 dBFS one at -1.0 dBFS. A hard knee, a fast attack and the 6 ms look-ahead keep a loud burst from overshooting.
 */
export const LIMITER = { threshold: -4, knee: 0, ratio: 20, attack: 0.001, release: 0.1 } as const;

/** music duck by SFX density (the adapter): never deeper than this, 50 ms attack, 600 ms release (95 % settle times) */
export const DUCK_DENSITY_MAX_DB = 3;
export const DUCK_ATTACK_S = 0.05;
export const DUCK_RELEASE_S = 0.6;
/** time constant (s) of the attack of the rules.ts event duck (level-up, boss, metin): the density duck never slows it down */
const EVENT_DUCK_ATTACK_S = 0.05;
const dbToGain = (db: number): number => Math.pow(10, -db / 20);

/** transient fetch failure retry backoff (AUDIO-01): exponential cooldown so brief outages recover without per-frame fetch storms */
export const AUDIO_RETRY_BASE_MS = 1000;
export const AUDIO_RETRY_MAX_MS = 30_000;

type FetchResult = { kind: 'ok'; data: ArrayBuffer } | { kind: 'transient' } | { kind: 'permanent' };

const GESTURES = ['pointerdown', 'mousedown', 'keydown', 'touchstart', 'touchend'] as const;

export class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  musicBus!: GainNode;
  musicFilter!: BiquadFilterNode;
  musicDuck!: GainNode;
  /** master safety limiter (LIMITER); after it comes the destination */
  limiter!: DynamicsCompressorNode;
  sfxBus!: GainNode;
  /** zone bed path: bed gains ─► ambienceFilter (pause lowpass) ─► ambienceBus (combat level) ─► sfxBus */
  ambienceFilter!: BiquadFilterNode;
  ambienceBus!: GainNode;

  readonly levels: BusLevels = { master: 1, music: 0.6, sfx: 0.8 };

  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly loads = new Map<string, Promise<AudioBuffer | null>>();
  private readonly bytes = new Map<string, Promise<FetchResult>>();
  private readonly failed = new Set<string>();
  private readonly retryAfter = new Map<string, { attempts: number; nextAt: number }>();
  private decoder: OfflineAudioContext | null = null;
  private resumingUntil = 0;
  private ambCombat = false;
  private ambMuffled = false;
  /** event duck (rules.ts): depth in dB, engine time at which its hold ends, release seconds */
  private duckEventDb = 0;
  private duckEventUntil = -1;
  private duckEventRelease = 0.6;
  /** SFX density duck in dB (0 .. DUCK_DENSITY_MAX_DB) */
  private duckDensityDb = 0;
  private disposed = false;
  private inflight = 0;
  private readonly queue: (() => void)[] = [];
  private readonly onGesture = (): void => {
    this.unlock();
  };
  private readonly onVisibility = (): void => {
    const c = this.ctx;
    if (!c) return;
    if (document.visibilityState === 'hidden') void c.suspend().catch(() => undefined);
    else void c.resume().catch(() => undefined);
  };
  /** called whenever the context transitions to running (first unlock, resume after interruption) */
  onRunning: (() => void) | null = null;

  constructor(
    private readonly resolveUrl: (path: string) => string,
    opts: { autoUnlock?: boolean } = {},
  ) {
    if (opts.autoUnlock !== false && typeof window !== 'undefined') {
      for (const g of GESTURES) window.addEventListener(g, this.onGesture, { capture: true, passive: true });
      document.addEventListener('visibilitychange', this.onVisibility);
    }
  }

  get running(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  get now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /** Creates the context + buses (idempotent). Safe to call from a gesture handler or at any later time. */
  ensureContext(): AudioContext | null {
    if (this.ctx || this.disposed) return this.ctx;
    const Ctor: typeof AudioContext | undefined =
      typeof AudioContext !== 'undefined' ? AudioContext : (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    let ctx: AudioContext;
    try {
      ctx = new Ctor({ latencyHint: 'interactive', sampleRate: 44100 });
    } catch {
      ctx = new Ctor({ latencyHint: 'interactive' });
    }
    this.ctx = ctx;

    this.master = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = LIMITER.threshold;
    limiter.knee.value = LIMITER.knee;
    limiter.ratio.value = LIMITER.ratio;
    limiter.attack.value = LIMITER.attack;
    limiter.release.value = LIMITER.release;
    this.limiter = limiter;
    this.master.connect(limiter);
    limiter.connect(ctx.destination);

    this.musicBus = ctx.createGain();
    this.musicBus.connect(this.master);
    this.musicDuck = ctx.createGain();
    this.musicDuck.connect(this.musicBus);
    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 22000;
    this.musicFilter.Q.value = 0.5;
    this.musicFilter.connect(this.musicDuck);

    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.master);

    this.ambienceBus = ctx.createGain();
    this.ambienceBus.connect(this.sfxBus);
    this.ambienceFilter = ctx.createBiquadFilter();
    this.ambienceFilter.type = 'lowpass';
    this.ambienceFilter.Q.value = 0.5;
    this.ambienceFilter.frequency.value = this.ambMuffled ? AMB_MUFFLE_HZ : AMB_OPEN_HZ;
    this.ambienceBus.gain.value = this.ambCombat ? Math.pow(10, AMB_COMBAT_DB / 20) : 1;
    this.ambienceFilter.connect(this.ambienceBus);

    this.applyLevels();
    ctx.addEventListener('statechange', () => {
      if (ctx.state === 'running') this.onRunning?.();
    });
    return ctx;
  }

  /** Gesture-time unlock: create + resume. Returns true if the context is (about to be) running. */
  unlock(): boolean {
    const c = this.ensureContext();
    if (!c) return false;
    if (c.state !== 'running') {
      this.resumingUntil = performance.now() + 1500;
      void c
        .resume()
        .then(() => {
          if (c.state === 'running') this.removeGestureListeners();
        })
        .catch(() => undefined);
    } else {
      this.removeGestureListeners();
    }
    return true;
  }

  private removeGestureListeners(): void {
    if (typeof window === 'undefined') return;
    for (const g of GESTURES) window.removeEventListener(g, this.onGesture, { capture: true });
  }

  suspend(): Promise<void> {
    return this.ctx && this.ctx.state === 'running' ? this.ctx.suspend() : Promise.resolve();
  }

  resume(): Promise<void> {
    return this.ctx && this.ctx.state !== 'running' ? this.ctx.resume() : Promise.resolve();
  }

  setLevels(l: Partial<BusLevels>): void {
    Object.assign(this.levels, l);
    this.applyLevels();
  }

  private applyLevels(): void {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    this.master.gain.setTargetAtTime(volumeToGain(this.levels.master), t, 0.03);
    this.musicBus.gain.setTargetAtTime(volumeToGain(this.levels.music), t, 0.05);
    this.sfxBus.gain.setTargetAtTime(volumeToGain(this.levels.sfx), t, 0.03);
  }

  /** Zone bed: -6 dB while combat heat is on (the music's heat). Kept here so a bed that starts later inherits it. */
  setAmbienceCombat(on: boolean): void {
    if (this.ambCombat === on) return;
    this.ambCombat = on;
    this.applyAmbience(0.5);
  }

  /** Zone bed: lowpass at AMB_MUFFLE_HZ while the run is paused. */
  setAmbienceMuffled(on: boolean): void {
    if (this.ambMuffled === on) return;
    this.ambMuffled = on;
    this.applyAmbience(0.12);
  }

  private applyAmbience(tc: number): void {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    this.ambienceBus.gain.setTargetAtTime(this.ambCombat ? Math.pow(10, AMB_COMBAT_DB / 20) : 1, t, tc);
    this.ambienceFilter.frequency.setTargetAtTime(this.ambMuffled ? AMB_MUFFLE_HZ : AMB_OPEN_HZ, t, tc);
  }

  /** Dips the music for `hold` seconds (level-up, boss roar, …). The SFX density duck stays under it (the deeper wins). */
  duckMusic(db: number, hold: number, release = 0.6): void {
    const c = this.ctx;
    if (!c) return;
    this.duckEventDb = db;
    this.duckEventUntil = c.currentTime + hold;
    this.duckEventRelease = release;
    this.applyDuck(EVENT_DUCK_ATTACK_S);
  }

  /**
   * SFX density duck (AR-02): the music sits `db` below its level (clamped to 0 .. DUCK_DENSITY_MAX_DB) while many sounds
   * play; 50 ms attack, 600 ms release. An event duck that is held keeps its depth and its own 0.05 s attack when it is deeper.
   */
  setDensityDuck(db: number): void {
    const d = db > DUCK_DENSITY_MAX_DB ? DUCK_DENSITY_MAX_DB : db > 0 ? db : 0;
    if (d === this.duckDensityDb) return;
    const deeper = d > this.duckDensityDb;
    this.duckDensityDb = d;
    this.applyDuck(deeper ? DUCK_ATTACK_S / 3 : DUCK_RELEASE_S / 3);
  }

  /** current density duck in dB (diagnostics, tests) */
  get densityDuckDb(): number {
    return this.duckDensityDb;
  }

  /** One timeline for musicDuck: the deeper of the held event duck and the density duck now, then the density duck after the hold. */
  private applyDuck(tc: number): void {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    const g = this.musicDuck.gain;
    const held = t < this.duckEventUntil;
    // the event duck is letting go: its hold is over and its release has not run out
    const releasing = !held && t < this.duckEventUntil + this.duckEventRelease;
    g.cancelScheduledValues(t);
    // a held event duck that is the deeper source keeps its own 0.05 s attack, whatever time constant the density duck asks for
    // (a 0.25 dB release step 30 ms into a level-up duck would otherwise stretch the -7 dB attack from ~150 ms to ~520 ms); during
    // the release a density step moves at the pace of the release, not at its own (a 0.25 dB attack step 50 ms into the release
    // would snap the music back +3 dB in 50 ms instead of the 0.6 s the event promises)
    const eventDeeper = held && this.duckEventDb > this.duckDensityDb;
    const tcNow = eventDeeper ? EVENT_DUCK_ATTACK_S : releasing ? Math.max(tc, this.duckEventRelease / 3) : tc;
    g.setTargetAtTime(dbToGain(eventDeeper ? this.duckEventDb : this.duckDensityDb), t, tcNow);
    if (held) g.setTargetAtTime(dbToGain(this.duckDensityDb), this.duckEventUntil, this.duckEventRelease / 3);
  }

  // ---- buffers ---------------------------------------------------------------------------------------------------

  buffer(url: string): AudioBuffer | undefined {
    return this.buffers.get(url);
  }

  has(url: string): boolean {
    return this.buffers.has(url);
  }

  /** True when `url` failed permanently (404 / decode error) or is currently in transient retry backoff. */
  hasFailed(url: string): boolean {
    if (this.failed.has(url)) return true;
    const retry = this.retryAfter.get(url);
    return retry !== undefined && performance.now() < retry.nextAt;
  }

  /** Seam for tests and tools: registers an already-decoded buffer under its url. */
  inject(url: string, buf: AudioBuffer): void {
    this.failed.delete(url);
    this.retryAfter.delete(url);
    this.buffers.set(url, buf);
  }

  evict(url: string): void {
    this.buffers.delete(url);
    this.loads.delete(url);
    this.bytes.delete(url);
    this.failed.delete(url);
    this.retryAfter.delete(url);
  }

  private fetchBytes(url: string): Promise<FetchResult> {
    let p = this.bytes.get(url);
    if (!p) {
      p = (async (): Promise<FetchResult> => {
        let res: FetchResult;
        try {
          const r = await fetch(this.resolveUrl(url));
          if (r.ok) {
            res = { kind: 'ok', data: await r.arrayBuffer() };
          } else {
            // 4xx (except 408 timeout and 429 rate limit) are permanent; 5xx, 408, 429, 0/network errors are transient.
            const st = r.status;
            const permanent = typeof st === 'number' && st >= 400 && st < 500 && st !== 408 && st !== 429;
            res = { kind: permanent ? 'permanent' : 'transient' };
          }
        } catch {
          res = { kind: 'transient' };
        }
        if (res.kind !== 'ok' && this.bytes.get(url) === p) this.bytes.delete(url);
        return res;
      })();
      this.bytes.set(url, p);
    }
    return p;
  }

  /** Decoding does not need a (gesture-gated) AudioContext: an offline context decodes buffers usable by any context. */
  private decodeContext(): BaseAudioContext | null {
    if (this.ctx) return this.ctx;
    if (!this.decoder && typeof OfflineAudioContext !== 'undefined') this.decoder = new OfflineAudioContext(2, 1, 44100);
    return this.decoder;
  }

  /** True while sounds may be scheduled: running, or a gesture-triggered resume is in flight. */
  get playable(): boolean {
    const c = this.ctx;
    return c !== null && (c.state === 'running' || (c.state === 'suspended' && performance.now() < this.resumingUntil));
  }

  /** Fetch (immediately) and decode (once the context exists). Concurrency-limited; deduplicated; transient errors retry with bounded backoff. */
  load(url: string): Promise<AudioBuffer | null> {
    const done = this.buffers.get(url);
    if (done) return Promise.resolve(done);
    if (this.failed.has(url)) return Promise.resolve(null);
    const retry = this.retryAfter.get(url);
    if (retry !== undefined && performance.now() < retry.nextAt) return Promise.resolve(null);
    let p = this.loads.get(url);
    if (!p) {
      const job: Promise<AudioBuffer | null> = this.schedule(async () => {
        const res = await this.fetchBytes(url);
        if (res.kind === 'permanent') {
          this.failed.add(url);
          this.retryAfter.delete(url);
          return null;
        }
        if (res.kind === 'transient') {
          const attempts = (this.retryAfter.get(url)?.attempts ?? 0) + 1;
          const delay = Math.min(AUDIO_RETRY_MAX_MS, AUDIO_RETRY_BASE_MS * Math.pow(2, attempts - 1));
          this.retryAfter.set(url, { attempts, nextAt: performance.now() + delay });
          return null;
        }
        const ctx = this.decodeContext();
        if (!ctx) return null;
        try {
          // decodeAudioData detaches its input: hand it a copy so a retry after eviction still works
          const buf = await ctx.decodeAudioData(res.data.slice(0));
          this.retryAfter.delete(url);
          this.failed.delete(url);
          this.buffers.set(url, buf);
          return buf;
        } catch {
          this.failed.add(url);
          this.retryAfter.delete(url);
          return null;
        }
      });
      p = job.then((buf) => {
        if (!buf && this.loads.get(url) === p) this.loads.delete(url);
        return buf;
      });
      this.loads.set(url, p);
    }
    return p;
  }

  private schedule<T>(job: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = (): void => {
        this.inflight++;
        job()
          .then(resolve, reject)
          .finally(() => {
            this.inflight--;
            const next = this.queue.shift();
            if (next) next();
          });
      };
      if (this.inflight < 4) run();
      else this.queue.push(run);
    });
  }

  dispose(): void {
    this.disposed = true;
    this.removeGestureListeners();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
    const c = this.ctx;
    this.ctx = null;
    this.buffers.clear();
    this.loads.clear();
    this.bytes.clear();
    this.failed.clear();
    this.retryAfter.clear();
    this.decoder = null;
    if (c && c.state !== 'closed') void c.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// zone ambience bed (AR-01)

interface BedDeck {
  src: AudioBufferSourceNode;
  gain: GainNode;
  url: string;
}

/**
 * One looping, non-positional bed per run (`amb_<zone>`, manifest kind 'ambience'): a source over a gain that fades, into
 * the engine's ambience path (pause lowpass, combat level, SFX slider). An id the manifest does not list, or lists as
 * something else, is ignored: no bed, no error. Only one bed buffer stays decoded (a decoded 48 s bed is ~8 MB).
 */
export class AmbienceBed {
  private deck: BedDeck | null = null;
  private readonly fading: BedDeck[] = [];
  private req = 0;
  private wantUrl = '';
  private heldUrl = '';

  constructor(
    private readonly engine: AudioEngine,
    private readonly manifest: Record<string, AudioAsset>,
  ) {}

  /** the manifest lists `id` as an ambience loop */
  has(id: string): boolean {
    return this.manifest[id]?.kind === 'ambience';
  }

  /** url of the bed that is playing (or wanted and still decoding); '' = none */
  get currentUrl(): string {
    return this.deck?.url ?? this.wantUrl;
  }

  /** a bed source is running (decoded and started) */
  get playing(): boolean {
    return this.deck !== null;
  }

  /** Loops `id` in over `fade` seconds (fetching it first when it is not decoded). false = nothing to play. */
  play(id: string, fade = AMB_FADE_IN_S): boolean {
    const asset = this.manifest[id];
    if (!asset || asset.kind !== 'ambience') return false;
    if (asset.url === this.wantUrl) return true;
    this.wantUrl = asset.url;
    const req = ++this.req;
    void this.engine.load(asset.url).then((buf) => {
      if (req !== this.req) return;
      if (!buf || !this.start(buf, asset, fade)) this.wantUrl = '';
    });
    return true;
  }

  /** Fades the bed out over `fade` seconds (run end, quit); a bed still decoding is dropped. */
  stop(fade = AMB_FADE_OUT_S): void {
    this.req++;
    this.wantUrl = '';
    this.fadeOut(fade);
  }

  private start(buf: AudioBuffer, asset: AudioAsset, fade: number): boolean {
    const c = this.engine.ctx;
    if (!c) return false;
    const region = loopRegion(buf, asset);
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = region.start;
    src.loopEnd = region.end;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(asset.gain ?? 1, t + Math.max(fade, 0.02));
    src.connect(gain);
    gain.connect(this.engine.ambienceFilter);
    // every run enters the loop at a different point
    src.start(t, region.start + Math.random() * (region.end - region.start));
    this.fadeOut(Math.max(fade, 0.02)); // a bed of another zone still up leaves while this one comes in
    this.deck = { src, gain, url: asset.url };
    if (this.heldUrl && this.heldUrl !== asset.url) this.engine.evict(this.heldUrl);
    this.heldUrl = asset.url;
    return true;
  }

  private fadeOut(fade: number): void {
    const d = this.deck;
    const c = this.engine.ctx;
    if (!d || !c) return;
    this.deck = null;
    const t = c.currentTime;
    const f = Math.max(fade, 0.02);
    d.gain.gain.cancelScheduledValues(t);
    d.gain.gain.setValueAtTime(d.gain.gain.value, t);
    d.gain.gain.linearRampToValueAtTime(0, t + f);
    d.src.stop(t + f + 0.05);
    d.src.onended = () => {
      d.src.disconnect();
      d.gain.disconnect();
      const k = this.fading.indexOf(d);
      if (k >= 0) this.fading.splice(k, 1);
    };
    this.fading.push(d);
  }

  dispose(): void {
    this.req++;
    this.wantUrl = '';
    for (const d of [this.deck, ...this.fading]) {
      if (!d) continue;
      try {
        d.src.stop();
      } catch {
        /* already stopped */
      }
      d.src.disconnect();
      d.gain.disconnect();
    }
    this.deck = null;
    this.fading.length = 0;
  }
}
