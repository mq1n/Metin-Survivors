// Music: gapless loop decks with crossfades, per-track resume position, adaptive "intensity" (lowpass), stingers.
// AR-02: when a zone's calm and combat tracks are DIFFERENT files (setLayers), calm <-> combat is a position-synced
// constant-energy crossfade (correlation-aware, see SYNC_RHO) and the lowpass stays open; when they alias one file (today) the
// lowpass path below is unchanged.
import type { AudioAsset } from '../data/assetManifest';
import type { AudioEngine } from './engine';

/** MP3 encoder+decoder delay in samples at 44.1 kHz (what a decoder that ignores the LAME header leaves in front). */
const MP3_DELAY_S = 1105 / 44100;

/** AR-02: calm <-> combat crossfade length (s) when the two are separate files */
export const SYNC_FADE_S = 1.2;
/** AR-02: a layered deck starts this far ahead of the clock, so its position at that moment is exact (no render-quantum guess) */
export const SYNC_LEAD_S = 0.04;
/** AR-02: two loops are one song form (their playheads are shared) when their lengths differ by less than this (s) */
export const SYNC_LEN_TOL_S = 0.05;
/** a synced fade is this many linear ramp segments (energy error < 0.05 dB) */
const SYNC_FADE_STEPS = 16;
/**
 * AR-02: zero-lag correlation assumed between a zone's calm stem and its combat file. The two are renders of one song form,
 * sample-aligned (r 0.82 / 0.79 / 0.86 / 0.49 on the four staged pairs, Chrome decode), so at the middle of a fade their gains
 * add in amplitude, not in power: the plain equal-power (sin / cos) law swells the music +1.7 to +2.0 dB (median) above the louder
 * stem. Constant energy for this correlation keeps the swell within +0.5 dB and the dip within -1 dB (median) on all four pairs.
 */
export const SYNC_RHO = 0.8;

/**
 * Gains (g_in, g_out) of the correlation-aware constant-energy law at fade position x in 0..1, for unit deck gains:
 * s = sin(pi x / 2), c = cos(pi x / 2), k = 1 / sqrt(1 + 2 rho s c), g_in = s k, g_out = c k, so that
 * g_in^2 + g_out^2 + 2 rho g_in g_out = 1 at every moment (the energy of two rho-correlated signals is constant).
 */
export function syncFadeGains(x: number, rho = SYNC_RHO): { gIn: number; gOut: number } {
  const s = Math.sin(x * Math.PI * 0.5);
  const c = Math.cos(x * Math.PI * 0.5);
  const k = 1 / Math.sqrt(1 + 2 * rho * s * c);
  return { gIn: s * k, gOut: c * k };
}

/** Constant-energy fade of `param` between 0 and `amp` over [t0, t0 + dur] (the in deck rises to `amp`, the out deck falls from it). */
function rampSyncFade(param: AudioParam, amp: number, fadeIn: boolean, t0: number, dur: number): void {
  for (let i = 1; i <= SYNC_FADE_STEPS; i++) {
    const x = i / SYNC_FADE_STEPS;
    let v: number;
    if (i === SYNC_FADE_STEPS) v = fadeIn ? amp : 0;
    else {
      const g = syncFadeGains(x);
      v = amp * (fadeIn ? g.gIn : g.gOut);
    }
    param.linearRampToValueAtTime(v, t0 + dur * x);
  }
}

interface Deck {
  src: AudioBufferSourceNode;
  gain: GainNode;
  url: string;
  /** engine time at which `offset` (seconds into the buffer) was playing */
  t0: number;
  offset: number;
  loopStart: number;
  loopEnd: number;
}

interface LoopRegion {
  start: number;
  end: number;
}

/** Loop region in buffer seconds. Handles decoders that did not strip the MP3 delay (buffer longer than the manifest says). */
export function loopRegion(buf: AudioBuffer, asset: AudioAsset): LoopRegion {
  const len = (asset.loopEnd ?? asset.duration) - (asset.loopStart ?? 0);
  let start = asset.loopStart ?? 0;
  const extra = buf.duration - asset.duration;
  if (extra > 0.012 && extra < 0.12) start += MP3_DELAY_S;
  return { start, end: Math.min(buf.duration, start + len) };
}

interface Stinger {
  src: AudioBufferSourceNode;
  gain: GainNode;
}

export class MusicPlayer {
  private deck: Deck | null = null;
  private readonly fading: Deck[] = [];
  private readonly stingers: Stinger[] = [];
  private req = 0;
  private wantUrl = '';
  private disposed = false;
  private readonly resume = new Map<string, number>();
  private intensity = 1;
  private muffled = false;
  /** AR-02: urls of the zone's calm / combat tracks when they are different files; null = one file (lowpass) or no zone tracks */
  private pair: { calm: string; combat: string } | null = null;
  /** URLs of decoded music buffers we hold (evicted when no longer current/previous). */
  private readonly held: string[] = [];

  constructor(
    private readonly engine: AudioEngine,
    private readonly manifest: Record<string, AudioAsset>,
  ) {}

  get currentUrl(): string {
    return this.deck?.url ?? this.wantUrl;
  }

  has(id: string): boolean {
    return id in this.manifest;
  }

  /** Warms the decode cache for a music id (zone entry) without playing it. */
  prepare(id: string): void {
    const a = this.manifest[id];
    if (a) void this.engine.load(a.url);
  }

  /** Crossfades to the track with manifest id `id`; a no-op when it is already playing (aliases share one URL). */
  play(id: string, fade = 1.4): void {
    if (this.disposed) return;
    const asset = this.manifest[id];
    if (!asset) return;
    if (asset.url === this.wantUrl) return;
    this.wantUrl = asset.url;
    const req = ++this.req;
    this.stopStingers();
    void this.engine.load(asset.url).then((buf) => {
      if (this.disposed || req !== this.req) return;
      if (!buf) {
        if (this.wantUrl === asset.url) this.wantUrl = '';
        return;
      }
      this.start(buf, asset, fade);
    });
  }

  stop(fade = 1.2): void {
    this.req++;
    this.wantUrl = '';
    this.fadeOut(fade);
    this.stopStingers();
  }

  /**
   * AR-02: declares the zone's calm / combat tracks (manifest ids). Different files = layered: calm <-> combat crossfades in
   * position and the lowpass stays open for them. One file (the aliases of today), a missing id or null = the lowpass path.
   */
  setLayers(calmId: string | null, combatId: string | null): void {
    const a = calmId ? this.manifest[calmId] : undefined;
    const b = combatId ? this.manifest[combatId] : undefined;
    this.pair = a && b && a.url !== b.url ? { calm: a.url, combat: b.url } : null;
  }

  /** the zone's calm and combat tracks are separate files (see setLayers) */
  get layered(): boolean {
    return this.pair !== null;
  }

  private inPair(url: string): boolean {
    const p = this.pair;
    return p !== null && (url === p.calm || url === p.combat);
  }

  /** 0 = calm (veiled lowpass) … 1 = combat (open). Smoothly retargets the music filter. */
  setIntensity(x: number): void {
    this.intensity = x < 0 ? 0 : x > 1 ? 1 : x;
    this.applyFilter(0.9);
  }

  /** Pause / modal state: muffle the music. */
  setMuffled(on: boolean): void {
    this.muffled = on;
    this.applyFilter(0.12);
  }

  private applyFilter(tc: number): void {
    const c = this.engine.ctx;
    if (!c) return;
    const x = this.deck !== null && this.inPair(this.deck.url) ? 1 : this.intensity; // layered tracks carry their own character
    const open = 4200 * Math.pow(22000 / 4200, x);
    const f = this.muffled ? Math.min(open, 700) : open;
    this.engine.musicFilter.frequency.setTargetAtTime(f, c.currentTime, tc);
  }

  /** One-shot stinger over the music bus (victory / defeat). The running loop fades out first. */
  playStinger(id: string, fadeMusic = 0.5): void {
    if (this.disposed) return;
    const asset = this.manifest[id];
    if (!asset) return;
    const req = ++this.req;
    this.wantUrl = '';
    this.fadeOut(fadeMusic);
    this.stopStingers();
    void this.engine.load(asset.url).then((buf) => {
      if (this.disposed || req !== this.req) return;
      const c = this.engine.ctx;
      if (!buf || !c) return;
      const src = c.createBufferSource();
      src.buffer = buf;
      const g = c.createGain();
      g.gain.value = asset.gain ?? 1;
      src.connect(g);
      g.connect(this.engine.musicBus);
      const st: Stinger = { src, gain: g };
      this.stingers.push(st);
      src.onended = () => {
        src.disconnect();
        g.disconnect();
        const k = this.stingers.indexOf(st);
        if (k >= 0) this.stingers.splice(k, 1);
      };
      src.start(c.currentTime + 0.05);
    });
  }

  private stopStingers(): void {
    for (const st of this.stingers) {
      st.src.onended = null;
      try {
        st.src.stop();
      } catch {
        /* already stopped */
      }
      st.src.disconnect();
      st.gain.disconnect();
    }
    this.stingers.length = 0;
  }

  private start(buf: AudioBuffer, asset: AudioAsset, fade: number): void {
    const c = this.engine.ctx;
    if (!c) return;
    const region = loopRegion(buf, asset);
    const cur = this.deck;
    const layered = this.inPair(asset.url);
    if (layered && cur && cur.url === asset.url) return; // a request that was overtaken while its file loaded: it is playing already
    const len = region.end - region.start;
    const curLen = cur ? cur.loopEnd - cur.loopStart : 0;
    // calm <-> combat of separate files that share one form: the new deck joins at the playhead of the one that plays
    const sync = layered && cur !== null && this.inPair(cur.url) && Math.abs(curLen - len) <= SYNC_LEN_TOL_S;
    const t = c.currentTime;
    const when = layered ? t + SYNC_LEAD_S : t;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = region.start;
    src.loopEnd = region.end;
    const gain = c.createGain();
    // A GainNode passes at gain 1 until its first event takes effect. A deck that starts ahead of the clock (SYNC_LEAD_S) can have
    // when * sampleRate land a hair above a frame: the source then plays that frame before setValueAtTime(0, when) applies, and the
    // deck's first sample leaks at full gain (one-sample click). Zeroing the node first makes the leak silent.
    gain.gain.value = 0;
    const target = asset.gain ?? 1;
    const saved = this.resume.get(asset.url) ?? 0;
    let offset = region.start + (saved % len);
    if (sync && cur) {
      const into = (cur.offset - cur.loopStart + (when - cur.t0)) % curLen;
      offset = region.start + ((into < 0 ? into + curLen : into) % len);
    }
    const fadeS = sync ? SYNC_FADE_S : fade;
    gain.gain.setValueAtTime(0, when);
    if (sync) rampSyncFade(gain.gain, target, true, when, fadeS);
    else gain.gain.linearRampToValueAtTime(target, when + Math.max(fade, 0.02));
    src.connect(gain);
    gain.connect(this.engine.musicFilter);
    src.start(when, offset);
    this.fadeOut(fadeS, when, sync);
    this.deck = { src, gain, url: asset.url, t0: when, offset, loopStart: region.start, loopEnd: region.end };
    // A pair deck that replaces a non-pair one (the veiled menu theme at run start) opens the shared filter over the fade, not in
    // ~150 ms, so the leaving theme does not brighten while it fades out.
    this.applyFilter(layered && cur !== null && !this.inPair(cur.url) ? Math.max(fade, 0.02) / 3 : 0.05);
    // keep at most the current + previous music buffer decoded
    const i = this.held.indexOf(asset.url);
    if (i >= 0) this.held.splice(i, 1);
    this.held.push(asset.url);
    if (layered && this.pair) {
      // the other layer is fetched and decoded now (the zone music starts after the HUD, outside the payload window), so the
      // first combat heat switches at once instead of waiting for a download; it counts as held, newer than the menu track
      const other = asset.url === this.pair.calm ? this.pair.combat : this.pair.calm;
      void this.engine.load(other);
      if (!this.held.includes(other)) this.held.push(other);
    }
    while (this.held.length > 3) {
      const old = this.held.shift();
      if (old && old !== this.wantUrl) this.engine.evict(old);
    }
  }

  /** Fades the playing deck out over `fade` s from `at` (default now); `synced` = the cos half of a position-synced crossfade. */
  private fadeOut(fade: number, at = 0, synced = false): void {
    const d = this.deck;
    const c = this.engine.ctx;
    if (!d || !c) return;
    this.deck = null;
    const t = c.currentTime;
    const from = at > t ? at : t;
    const f = Math.max(fade, 0.02);
    const len = d.loopEnd - d.loopStart;
    if (len > 0) {
      const into = (d.offset - d.loopStart + (from - d.t0)) % len;
      this.resume.set(d.url, into < 0 ? into + len : into);
    }
    const g = d.gain.gain;
    g.cancelScheduledValues(t);
    const g0 = g.value;
    g.setValueAtTime(g0, t);
    if (from > t) g.setValueAtTime(g0, from);
    if (synced) rampSyncFade(g, g0, false, from, f);
    else g.linearRampToValueAtTime(0, from + f);
    d.src.stop(from + f + 0.05);
    d.src.onended = () => {
      d.src.disconnect();
      d.gain.disconnect();
      const k = this.fading.indexOf(d);
      if (k >= 0) this.fading.splice(k, 1);
    };
    this.fading.push(d);
  }

  dispose(): void {
    this.disposed = true;
    this.req++;
    this.wantUrl = '';
    this.stopStingers();
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
