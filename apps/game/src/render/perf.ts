// F3 performance overlay + best-effort GPU timer (EXT_disjoint_timer_query_webgl2) + the hitch / late-link counters (PERF-01).
import type { RenderCore } from './core';

/** Non-blocking GPU time per frame; returns the last resolved sample (ms) or -1 when unsupported. */
export class GpuTimer {
  lastMs = -1;
  private readonly ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private readonly pending: WebGLQuery[] = [];
  private readonly free: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  }

  get supported(): boolean {
    return this.ext !== null;
  }

  begin(): void {
    const ext = this.ext;
    if (!ext || this.active || this.pending.length > 6) return;
    const q = this.free.pop() ?? this.gl.createQuery();
    this.active = q;
    this.gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
  }

  end(): void {
    const ext = this.ext;
    if (!ext) return;
    if (this.active) {
      this.gl.endQuery(ext.TIME_ELAPSED_EXT);
      this.pending.push(this.active);
      this.active = null;
    }
    const gl = this.gl;
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean;
    while (this.pending.length > 0) {
      const q = this.pending[0] as WebGLQuery;
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      this.pending.shift();
      if (!disjoint) this.lastMs = (gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / 1e6;
      this.free.push(q);
    }
  }
}

/** A frame longer than this (ms) is a hitch: the number the upgrade plan's acceptance counts (PERF-01: 0 in the final arrival). */
export const HITCH_MS = 50;

export interface FrameSummary {
  fps: number;
  p50: number;
  p95: number;
  max: number;
  gpuMs: number;
  calls: number;
  triangles: number;
  /** frames over HITCH_MS among the last samples (the readout's window) */
  hitches: number;
  /** shader programs live in the renderer, and how many of them linked after the load-time warm-up */
  programs: number;
  lateLinks: number;
}

const N = 240;

/** Rolling frame-time statistics (shared by the overlay and benchmarks). */
export class FrameStats {
  readonly samples = new Float32Array(N);
  private idx = 0;
  private filled = 0;
  private readonly sorted = new Float32Array(N);

  push(ms: number): void {
    this.samples[this.idx] = ms;
    this.idx = (this.idx + 1) % N;
    if (this.filled < N) this.filled++;
  }

  reset(): void {
    this.idx = 0;
    this.filled = 0;
  }

  get count(): number {
    return this.filled;
  }

  percentile(p: number): number {
    const n = this.filled;
    if (n === 0) return 0;
    const s = this.sorted.subarray(0, n);
    s.set(this.samples.subarray(0, n));
    s.sort();
    return s[Math.min(n - 1, Math.floor(p * n))] as number;
  }

  mean(): number {
    let sum = 0;
    for (let i = 0; i < this.filled; i++) sum += this.samples[i] as number;
    return this.filled ? sum / this.filled : 0;
  }

  /** samples above `ms` among the last `count` ones */
  countOver(ms: number): number {
    let n = 0;
    for (let i = 0; i < this.filled; i++) if ((this.samples[i] as number) > ms) n++;
    return n;
  }
}

/** The part of three's `renderer.info` the watch reads (`programs` is null before the first render). */
export interface ProgramInfo {
  programs: ReadonlyArray<{ id: number; name?: string; cacheKey?: string }> | null;
}

export interface LateProgram {
  id: number;
  name: string;
  /**
   * The stall the link cost (ms): the longer of the render time of the frame that first showed the program (a link blocks inside that render) and the
   * gap before the NEXT frame (the driver / GPU process that finished after the render returned). Until that next frame came it is the render time alone.
   */
  frameMs: number;
}

/** a frame gap above this is not a stall of the frame before it (a hidden tab stops the loop and the next gap is as long as the pause) */
const GAP_CAP_MS = 1000;

/**
 * Shader programs that appear after the load-time warm-up (the upgrade plan's rule 7: nothing links mid-run). `markLoaded()` takes
 * the programs live at that moment as the baseline; from then on `frame()` notes every program id that was not there. The scan only
 * runs when the program count changed. `onLate` is for DEV logging.
 *
 * Timing: RenderWorld.frame measures the loop's gap BEFORE it renders (`rawDt`) and feeds the watch after `core.frame` returned, so
 * the frame that links a program reports the gap that came before the link. The stall shows in the render time of that frame
 * (`renderMs`, measured around core.frame) and in the gap the next call reports; a program therefore stays pending for one call and
 * is stamped with the larger of the two (measured: the vegetation links of 233-391 ms were stamped 6.9-7.1 ms by the old order).
 */
export class ProgramWatch {
  readonly late: LateProgram[] = [];
  /** called once per late program, when its stall is known (the next frame; the DEV console uses it) */
  onLate: ((p: LateProgram) => void) | null = null;
  private readonly known = new Set<number>();
  /** programs seen by the last call, waiting for the gap that holds their stall */
  private pending: { rec: LateProgram; renderMs: number }[] = [];
  private lastCount = -1;
  private armed = false;

  constructor(private readonly info: ProgramInfo) {}

  /** the programs live now are expected: the watch starts (again) from here */
  markLoaded(): void {
    this.known.clear();
    for (const p of this.info.programs ?? []) this.known.add(p.id);
    this.lastCount = this.info.programs?.length ?? 0;
    this.pending = [];
    this.armed = true;
  }

  /** forgets the late list (a new run); the baseline stays */
  clearLate(): void {
    this.late.length = 0;
    this.pending = [];
  }

  get live(): number {
    return this.info.programs?.length ?? 0;
  }

  /**
   * `gapMs` = the loop's delta that preceded this frame (what PerfOverlay.frame gets), `renderMs` = how long this frame's render took
   * (0 when the caller does not measure it).
   */
  frame(gapMs: number, renderMs = 0): void {
    if (!this.armed) return;
    if (this.pending.length > 0) {
      const gap = gapMs < GAP_CAP_MS ? gapMs : GAP_CAP_MS;
      for (const q of this.pending) {
        q.rec.frameMs = Math.round(Math.max(q.renderMs, gap) * 10) / 10;
        this.onLate?.(q.rec);
      }
      this.pending = [];
    }
    const list = this.info.programs;
    const n = list?.length ?? 0;
    if (n === this.lastCount || !list) return;
    this.lastCount = n;
    for (const p of list) {
      if (this.known.has(p.id)) continue;
      this.known.add(p.id);
      const rec: LateProgram = { id: p.id, name: p.name || p.cacheKey?.slice(0, 24) || '(unnamed)', frameMs: Math.round(renderMs * 10) / 10 };
      if (this.late.length < 64) this.late.push(rec);
      this.pending.push({ rec, renderMs });
    }
  }
}

export class PerfOverlay {
  readonly el: HTMLPreElement;
  readonly stats = new FrameStats();
  /** programs that linked after the load-time warm-up (RenderWorld marks the baseline when its warm-up ends) */
  readonly programs: ProgramWatch;
  /** extra lines appended by the app (enemies, projectiles, sim ms…) */
  extra: () => string = () => '';
  private visible = false;
  private acc = 0;

  constructor(private readonly core: RenderCore) {
    this.programs = new ProgramWatch(core.renderer.info as ProgramInfo);
    const el = document.createElement('pre');
    el.style.cssText =
      'position:fixed;left:8px;top:8px;margin:0;padding:6px 8px;font:12px/1.35 ui-monospace,Consolas,monospace;color:#d7ffd0;background:rgba(0,0,0,.62);border:1px solid #2c4a2a;border-radius:4px;pointer-events:none;z-index:9999;white-space:pre;max-width:calc(100vw - 24px);overflow:hidden;display:none';
    document.body.appendChild(el);
    this.el = el;
  }

  get isVisible(): boolean {
    return this.visible;
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.el.style.display = v ? 'block' : 'none';
  }

  toggle(): void {
    this.setVisible(!this.visible);
  }

  summary(): FrameSummary {
    const info = this.core.renderer.info;
    const p50 = this.stats.percentile(0.5);
    return {
      fps: p50 > 0 ? 1000 / p50 : 0,
      p50,
      p95: this.stats.percentile(0.95),
      max: this.stats.percentile(1),
      gpuMs: this.core.gpuTimer?.lastMs ?? -1,
      calls: info.render.calls,
      triangles: info.render.triangles,
      hitches: this.stats.countOver(HITCH_MS),
      programs: this.programs.live,
      lateLinks: this.programs.late.length,
    };
  }

  /** Call once per rendered frame with the raw frame delta in milliseconds and (optional) the time the frame's render took. */
  frame(ms: number, renderMs = 0): void {
    this.stats.push(ms);
    this.programs.frame(ms, renderMs);
    if (!this.visible) return;
    this.acc += ms;
    if (this.acc < 250) return;
    this.acc = 0;
    const s = this.summary();
    const q = this.core.quality.tier;
    const gpu = s.gpuMs >= 0 ? `${s.gpuMs.toFixed(2)} ms` : 'n/a';
    this.el.textContent =
      `${s.fps.toFixed(0)} fps  p50 ${s.p50.toFixed(1)}  p95 ${s.p95.toFixed(1)}  max ${s.max.toFixed(0)} ms  >${HITCH_MS}: ${s.hitches}\n` +
      `gpu ${gpu}   calls ${s.calls}   tris ${(s.triangles / 1000).toFixed(0)}k   programs ${s.programs}${s.lateLinks > 0 ? ` (+${s.lateLinks} after load)` : ''}\n` +
      `quality ${q}   dpr ${this.core.pixelRatioApplied.value.toFixed(2)}   ` +
      `geo ${this.core.renderer.info.memory.geometries} tex ${this.core.renderer.info.memory.textures}` +
      (this.extra() ? `\n${this.extra()}` : '');
  }

  dispose(): void {
    this.el.remove();
  }
}
