// Fixed-timestep loop: sim at 60 Hz, render once per animation frame with interpolation alpha.
export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;
/** Longest wall-clock frame we simulate (tab switches, debugger pauses). */
const MAX_FRAME = 0.25;
/** accumulator slack so 3 × (1/180 s) frames still produce exactly one 1/60 s tick */
const EPS = 1e-7;

/** consecutive frames that threw before a frame error counts as fatal (one bad frame is survived: the loop carries on) */
export const FATAL_BAD_FRAMES = 3;

export interface LoopCallbacks {
  /** one fixed simulation tick; `dt` is always SIM_DT */
  step(dt: number): void;
  /** `alpha` ∈ [0,1): position between the previous and current tick; `frameDt` is the real frame delta (s) */
  render(alpha: number, frameDt: number): void;
  /**
   * A frame threw (sim tick, VFX, audio or render). Called on every such frame; `consecutive` counts the frames in a row that
   * threw (1 = a single bad frame that the loop simply carries on from; FATAL_BAD_FRAMES or more = the failure is persistent).
   */
  error?(err: unknown, consecutive: number): void;
}

export interface LoopStats {
  stepsLastFrame: number;
  /** ms spent in step() callbacks last frame */
  stepMs: number;
  /** ms spent in render() last frame */
  renderMs: number;
  /** ticks dropped because the frame needed more than maxSteps */
  droppedSteps: number;
  /** frames that threw (and were survived) since start */
  frameErrors: number;
}

export class FixedLoop {
  /** while true no ticks run (rendering continues so overlays/menus animate) */
  paused = false;
  /** dev time-scale: 0.25…8; scales ticks per real second */
  timeScale = 1;
  /** max simulation catch-up ticks per rendered frame (lower on mobile to prevent catch-up spirals) */
  maxCatchupSteps = 5;
  readonly stats: LoopStats = { stepsLastFrame: 0, stepMs: 0, renderMs: 0, droppedSteps: 0, frameErrors: 0 };

  private acc = 0;
  private last = 0;
  private raf = 0;
  private running = false;
  private badFrames = 0;

  constructor(private readonly cb: LoopCallbacks) {}

  get isRunning(): boolean {
    return this.running;
  }

  /** Interpolation alpha for the current accumulator state. */
  get alpha(): number {
    return Math.max(0, this.acc) / SIM_DT;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.badFrames = 0;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Runs exactly one tick (dev single-step while paused). */
  stepOnce(): void {
    this.cb.step(SIM_DT);
  }

  /** Advances by `frameDt` seconds of wall time. Exposed so tests/headless drivers can run without rAF. */
  advance(frameDt: number): void {
    const dt = Math.min(Math.max(frameDt, 0), MAX_FRAME);
    const stats = this.stats;
    let steps = 0;
    const t0 = performance.now();
    if (!this.paused) {
      this.acc += dt * this.timeScale;
      const baseMax = Math.max(1, Math.floor(this.maxCatchupSteps));
      const maxSteps = Math.max(baseMax, Math.ceil(baseMax * this.timeScale));
      while (!this.paused && this.acc >= SIM_DT - EPS && steps < maxSteps) {
        this.cb.step(SIM_DT);
        this.acc = Math.max(0, this.acc - SIM_DT);
        steps++;
      }
      if (!this.paused && this.acc >= SIM_DT - EPS) {
        // Spiral of death guard: forget the backlog instead of stalling the render.
        stats.droppedSteps += Math.floor(this.acc / SIM_DT);
        this.acc %= SIM_DT;
      }
    }
    const t1 = performance.now();
    this.cb.render(Math.max(0, this.acc) / SIM_DT, dt);
    stats.stepsLastFrame = steps;
    stats.stepMs = t1 - t0;
    stats.renderMs = performance.now() - t1;
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    // the next frame is booked FIRST: whatever throws below can never end the rAF chain (a page that froze for good with `running`
    // still true, so start() was a no-op as well)
    this.raf = requestAnimationFrame(this.frame);
    const dt = (now - this.last) / 1000;
    this.last = now;
    try {
      this.advance(dt);
      this.badFrames = 0;
    } catch (err) {
      this.badFrames++;
      this.stats.frameErrors++;
      try {
        this.cb.error?.(err, this.badFrames);
      } catch (inner) {
        console.error('loop error handler threw', inner);
      }
    }
  };
}
