// SFX playback: fixed voice pool with per-id concurrency caps, spacing, priority stealing, distance attenuation + pan
// relative to the listener (the hero), variant/pitch/level randomisation. Records are preallocated and reused; the only
// per-play allocations are the WebAudio nodes themselves (AudioBufferSourceNode is single-use by spec).
import type { AudioAsset } from '../data/assetManifest';
import type { AudioEngine } from './engine';
import { ruleFor, type SfxRule } from './rules';

const MAX_VOICES = 40;
/** metres of horizontal offset that map to a full pan (≈ half the visible width at the default camera) */
const PAN_SPAN = 18;

interface IdState {
  count: number;
  lastT: number;
  lastVariant: number;
}

interface Voice {
  active: boolean;
  src: AudioBufferSourceNode | null;
  gain: GainNode | null;
  pan: StereoPannerNode | null;
  st: IdState | null;
  prio: number;
  t0: number;
  /** assigned to `src.onended` — bound once per record, never re-created */
  readonly onended: () => void;
}

export interface PlayOpts {
  /** extra linear level (event volume) */
  vol?: number;
  /** playback-rate multiplier (pitch ladder etc.) */
  rate?: number;
  /** ignore distance/pan (UI, hero-attached sounds) */
  flat?: boolean;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export class SfxPlayer {
  private readonly voices: Voice[] = [];
  private readonly states = new Map<string, IdState>();
  private lx = 0;
  private lz = 0;
  /** voices started / dropped since creation (diagnostics + tests) */
  started = 0;
  dropped = 0;

  constructor(
    private readonly engine: AudioEngine,
    private readonly manifest: Record<string, AudioAsset>,
  ) {
    for (let i = 0; i < MAX_VOICES; i++) {
      const v: Voice = {
        active: false,
        src: null,
        gain: null,
        pan: null,
        st: null,
        prio: 0,
        t0: 0,
        onended: () => this.release(v),
      };
      this.voices.push(v);
    }
  }

  setListener(x: number, z: number): void {
    this.lx = x;
    this.lz = z;
  }

  has(id: string): boolean {
    return id in this.manifest;
  }

  get activeVoices(): number {
    let n = 0;
    for (const v of this.voices) if (v.active) n++;
    return n;
  }

  private state(id: string): IdState {
    let s = this.states.get(id);
    if (!s) {
      s = { count: 0, lastT: -1e9, lastVariant: -1 };
      this.states.set(id, s);
    }
    return s;
  }

  private release(v: Voice): void {
    if (!v.active) return;
    v.active = false;
    if (v.st) v.st.count--;
    v.st = null;
    v.src?.disconnect();
    v.gain?.disconnect();
    v.pan?.disconnect();
    v.src = v.gain = null;
    v.pan = null;
  }

  /** Stops a voice immediately-ish (5 ms fade) and detaches its end callback so it can be reused. */
  private steal(v: Voice, now: number): void {
    if (v.src) {
      v.src.onended = null;
      if (v.gain) v.gain.gain.setTargetAtTime(0, now, 0.004);
      try {
        v.src.stop(now + 0.03);
      } catch {
        /* not started / already stopped */
      }
    }
    if (v.st) v.st.count--;
    v.st = null;
    v.active = false;
    v.src = v.gain = null;
    v.pan = null;
  }

  private alloc(prio: number, now: number): Voice | null {
    let free: Voice | null = null;
    let victim: Voice | null = null;
    for (const v of this.voices) {
      if (!v.active) {
        free = v;
        break;
      }
      if (v.prio < prio && (!victim || v.prio < victim.prio || (v.prio === victim.prio && v.t0 < victim.t0))) victim = v;
    }
    if (free) return free;
    if (victim) {
      this.steal(victim, now);
      return victim;
    }
    return null;
  }

  /**
   * Plays manifest sound `id` at world position (x, z). Returns true if a voice was started.
   * Variant groups (`variants[]`) pick a random member (never the same twice in a row).
   */
  play(id: string, x: number, z: number, opts?: PlayOpts): boolean {
    const eng = this.engine;
    const c = eng.ctx;
    if (!c || !eng.playable) return false;
    const asset = this.manifest[id];
    if (!asset) return false;
    const rule: SfxRule = ruleFor(id);
    const st = this.state(id);
    const now = c.currentTime;
    if (now - st.lastT < rule.gap) return (this.dropped++, false);

    // distance attenuation + pan
    let g = 1;
    let pan = 0;
    if (!opts?.flat && rule.falloff > 0) {
      const dx = x - this.lx;
      const dz = z - this.lz;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d >= rule.falloff) return (this.dropped++, false);
      if (d > rule.range) {
        const u = (d - rule.range) / (rule.falloff - rule.range);
        g = (1 - u) * (1 - u);
        if (g < 0.03) return (this.dropped++, false);
      }
      pan = clamp(dx / PAN_SPAN, -1, 1) * 0.85;
    }

    // concurrency cap per id: important sounds replace the oldest instance, others are dropped
    if (st.count >= rule.max) {
      if (rule.prio < 6) return (this.dropped++, false);
      let oldest: Voice | null = null;
      for (const v of this.voices) if (v.active && v.st === st && (!oldest || v.t0 < oldest.t0)) oldest = v;
      if (oldest) this.steal(oldest, now);
    }

    // variant
    let url = asset.url;
    const vs = asset.variants;
    if (vs && vs.length > 1) {
      let i = (Math.random() * vs.length) | 0;
      if (i === st.lastVariant) i = (i + 1) % vs.length;
      st.lastVariant = i;
      url = vs[i] ?? url;
    }
    const buf = eng.buffer(url);
    if (!buf) {
      void eng.load(url);
      return (this.dropped++, false);
    }

    const v = this.alloc(rule.prio, now);
    if (!v) return (this.dropped++, false);

    const src = c.createBufferSource();
    src.buffer = buf;
    let rate = opts?.rate ?? 1;
    if (rule.pitch > 0) rate *= Math.pow(2, ((Math.random() * 2 - 1) * rule.pitch) / 1200);
    src.playbackRate.value = rate;
    const gn = c.createGain();
    let level = (asset.gain ?? 1) * (opts?.vol ?? 1) * g * rule.trim;
    if (rule.vol > 0) level *= Math.pow(10, ((Math.random() * 2 - 1) * rule.vol) / 20);
    gn.gain.value = level;
    src.connect(gn);
    if (pan !== 0 && typeof c.createStereoPanner === 'function') {
      const p = c.createStereoPanner();
      p.pan.value = pan;
      gn.connect(p);
      p.connect(eng.sfxBus);
      v.pan = p;
    } else {
      gn.connect(eng.sfxBus);
      v.pan = null;
    }
    src.onended = v.onended;
    src.start(now);
    v.src = src;
    v.gain = gn;
    v.st = st;
    v.prio = rule.prio;
    v.t0 = now;
    v.active = true;
    st.count++;
    st.lastT = now;
    this.started++;
    if (rule.duck) eng.duckMusic(rule.duck[0], rule.duck[1]);
    return true;
  }

  dispose(): void {
    const t = this.engine.now;
    for (const v of this.voices) if (v.active) this.steal(v, t);
    this.states.clear();
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// positional loops (metin pulse, auras)

interface LoopVoice {
  key: number;
  id: string;
  x: number;
  z: number;
  src: AudioBufferSourceNode;
  gain: GainNode;
  pan: StereoPannerNode | null;
  base: number;
}

export class LoopBank {
  private readonly loops: LoopVoice[] = [];
  private lastUpdate = -1;

  constructor(
    private readonly engine: AudioEngine,
    private readonly manifest: Record<string, AudioAsset>,
    private readonly max = 4,
  ) {}

  get count(): number {
    return this.loops.length;
  }

  start(key: number, id: string, x: number, z: number): void {
    const eng = this.engine;
    const c = eng.ctx;
    const asset = this.manifest[id];
    if (!c || !asset || !eng.playable || this.loops.length >= this.max) return;
    if (this.loops.some((l) => l.key === key)) return;
    const buf = eng.buffer(asset.url);
    if (!buf) {
      void eng.load(asset.url);
      return;
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = asset.loopStart ?? 0;
    src.loopEnd = asset.loopEnd ?? buf.duration;
    const gain = c.createGain();
    gain.gain.value = 0;
    src.connect(gain);
    let pan: StereoPannerNode | null = null;
    if (typeof c.createStereoPanner === 'function') {
      pan = c.createStereoPanner();
      gain.connect(pan);
      pan.connect(eng.sfxBus);
    } else gain.connect(eng.sfxBus);
    src.start(c.currentTime, Math.random() * (src.loopEnd - src.loopStart));
    this.loops.push({ key, id, x, z, src, gain, pan, base: asset.gain ?? 1 });
  }

  stop(key: number, fade = 0.4): void {
    const i = this.loops.findIndex((l) => l.key === key);
    if (i < 0) return;
    const l = this.loops[i];
    this.loops.splice(i, 1);
    if (!l) return;
    const c = this.engine.ctx;
    if (!c) return;
    const t = c.currentTime;
    l.gain.gain.cancelScheduledValues(t);
    l.gain.gain.setTargetAtTime(0, t, fade / 3);
    l.src.stop(t + fade + 0.1);
    l.src.onended = () => {
      l.src.disconnect();
      l.gain.disconnect();
      l.pan?.disconnect();
    };
  }

  stopAll(): void {
    while (this.loops.length > 0) {
      const l = this.loops[this.loops.length - 1];
      if (!l) break;
      this.stop(l.key, 0.3);
    }
  }

  /** Called per frame; retargets level/pan from the listener position at most every 100 ms (keeps the param timelines short). */
  update(lx: number, lz: number): void {
    const c = this.engine.ctx;
    if (!c || this.loops.length === 0) return;
    const t = c.currentTime;
    if (t - this.lastUpdate < 0.1) return;
    this.lastUpdate = t;
    for (const l of this.loops) {
      const rule = ruleFor(l.id);
      const dx = l.x - lx;
      const dz = l.z - lz;
      const d = Math.sqrt(dx * dx + dz * dz);
      const range = rule.range > 0 ? rule.range : 10;
      const falloff = rule.falloff > range ? rule.falloff : 60;
      let g = 0;
      if (d < falloff) {
        const u = d <= range ? 0 : (d - range) / (falloff - range);
        g = (1 - u) * (1 - u);
      }
      l.gain.gain.setTargetAtTime(l.base * g * rule.trim, t, 0.15);
      if (l.pan) l.pan.pan.setTargetAtTime(clamp(dx / PAN_SPAN, -1, 1) * 0.85, t, 0.1);
    }
  }
}
