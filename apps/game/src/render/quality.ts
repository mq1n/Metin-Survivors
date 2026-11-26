// Quality tiers (ARCHITECTURE §7). Every render system reads the active profile from RenderContext.quality
// and must react to `onChange` (resize buffers / toggle features) without a reload.

export type QualityTier = 'low' | 'medium' | 'high' | 'ultra';
export const QUALITY_TIERS: readonly QualityTier[] = ['low', 'medium', 'high', 'ultra'];

export interface QualityProfile {
  tier: QualityTier;
  /** upper bound for renderer pixel ratio */
  dprCap: number;
  /** MSAA samples of the HDR scene target (0 = none) */
  msaa: number;
  /** real-time shadow from the sun for hero + nearby props */
  shadows: boolean;
  shadowMapSize: number;
  /** 0 = off, 1 = single-level bloom, 2 = two-level bloom */
  bloom: number;
  vignette: boolean;
  /** max enemy instances drawn per frame (nearest to the camera focus win) */
  crowdCap: number;
  /** lerp between baked animation frames (smooth) vs nearest (cheap) */
  animLerp: boolean;
  /** multiplier for particle counts in VFX */
  vfxDensity: number;
  /** max simultaneously alive damage-number glyph quads */
  damageGlyphCap: number;
  /** max simultaneously drawn ground decals (telegraphs + rings) */
  decalCap: number;
}

export const QUALITY_PROFILES: Record<QualityTier, QualityProfile> = {
  low: {
    tier: 'low',
    dprCap: 1,
    msaa: 0,
    shadows: false,
    shadowMapSize: 1024,
    bloom: 0,
    vignette: false,
    crowdCap: 300,
    animLerp: false,
    vfxDensity: 0.5,
    damageGlyphCap: 160,
    decalCap: 24,
  },
  medium: {
    tier: 'medium',
    dprCap: 1.25,
    msaa: 0,
    shadows: true,
    shadowMapSize: 1024,
    bloom: 1,
    vignette: true,
    crowdCap: 500,
    animLerp: true,
    vfxDensity: 0.75,
    damageGlyphCap: 320,
    decalCap: 40,
  },
  high: {
    tier: 'high',
    dprCap: 1.5,
    msaa: 4,
    shadows: true,
    shadowMapSize: 2048,
    bloom: 2,
    vignette: true,
    crowdCap: 700,
    animLerp: true,
    vfxDensity: 1,
    damageGlyphCap: 600,
    decalCap: 64,
  },
  ultra: {
    tier: 'ultra',
    dprCap: 2,
    msaa: 4,
    shadows: true,
    shadowMapSize: 4096,
    bloom: 2,
    vignette: true,
    crowdCap: 1000,
    animLerp: true,
    vfxDensity: 1.3,
    damageGlyphCap: 900,
    decalCap: 96,
  },
};

/** Mutable holder shared by all render systems. `profile` is swapped atomically on a tier change. */
export class QualityState {
  profile: QualityProfile;
  private readonly listeners = new Set<(p: QualityProfile) => void>();

  constructor(tier: QualityTier) {
    this.profile = QUALITY_PROFILES[tier];
  }

  get tier(): QualityTier {
    return this.profile.tier;
  }

  setTier(tier: QualityTier): void {
    if (tier === this.profile.tier) return;
    this.profile = QUALITY_PROFILES[tier];
    for (const fn of this.listeners) fn(this.profile);
  }

  /** Fires only on later changes (not immediately). Returns an unsubscribe function. */
  onChange(fn: (p: QualityProfile) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

/** Picks a starting tier from device hints. Real adaptation happens via AutoQuality. */
export function guessTier(gl: WebGL2RenderingContext | null): QualityTier {
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && screen.width < 1100);
  if (mobile) return 'low';
  let renderer = '';
  if (gl) {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    renderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '');
  }
  if (/Intel|UHD|Iris|Mali|Adreno|PowerVR|Apple GPU|Software|SwiftShader|llvmpipe/i.test(renderer)) return 'medium';
  return 'high';
}

/** After a reset (run start) the governor only watches: shader compiles, texture uploads and zone loading are not load. */
const GRACE_S = 8;
/**
 * A frame of at least this long is a stall (compile, tab freeze, run-start work), not sustained load. The fixed loop clamps
 * every frame delta it hands to render at 0.25 s (engine/loop.ts MAX_FRAME), so a real freeze of any length arrives as
 * exactly 0.25: the test is `>=`, a `>` would never see one.
 */
const STALL_S = 0.25;
/** Back-to-back stall windows beyond this many seconds are a machine that cannot keep up: the windows count again. */
const STALL_MAX_S = 12;
/**
 * The governor saw no frame for longer than this beyond the frame's own dt (menu, loading screen, results; a freeze that long
 * too): a new grace. Loading a run takes longer than this, a playable machine does not freeze this long again and again.
 */
const FEED_GAP_MS = 3000;
/** A window (about 1 s) is slow when its median frame time is above this. */
const SLOW_S = 0.02;
/** Consecutive slow windows that drop one tier. */
const SLOW_WINDOWS = 3;

/**
 * Sustained-frame-time governor: drops one tier when the 1-second median frame time stays above 20 ms
 * for 3 consecutive seconds. Never upgrades (avoids oscillation); the settings screen can raise manually.
 *
 * What is not sustained load is ignored, so a stall at the start of a run cannot take the tier for the whole session:
 * - the first 8 s after a reset are only watched. A reset is the construction, `reset()`, or the first frame after more than
 *   3 s without one (the app feeds frames only while the run screen shows, so such a gap is the next run starting; a
 *   freeze that long is followed by catch-up frames the same way);
 * - a 1-second window that contains a frame of 250 ms or more (the loop clamps longer ones to 250) is a stall: it counts
 *   neither as good nor as bad (the counter keeps its value); more than 12 s of such windows in a row is a slow machine,
 *   not a hitch, and they count by their median again.
 */
export class AutoQuality {
  enabled = true;
  private acc: number[] = [];
  private t = 0;
  private bad = 0;
  private stalled = false;
  private stallS = 0;
  private grace = GRACE_S;
  private lastWall = -1;

  constructor(
    private readonly state: QualityState,
    private readonly now: () => number = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  ) {}

  /** Restarts the observation: the next 8 s of frames are only watched. Call when a run starts. */
  reset(): void {
    this.acc.length = 0;
    this.t = 0;
    this.bad = 0;
    this.stalled = false;
    this.stallS = 0;
    this.grace = GRACE_S;
    this.lastWall = -1;
  }

  /** Call once per rendered frame with the raw frame time in seconds. */
  frame(dt: number): void {
    if (!this.enabled) return;
    const wall = this.now();
    if (this.lastWall >= 0 && wall - this.lastWall - dt * 1000 > FEED_GAP_MS) this.reset();
    this.lastWall = wall;
    if (this.grace > 0) {
      // one freeze is not play time: it burns at most a second of the grace
      this.grace -= Math.min(dt, 1);
      return;
    }
    this.acc.push(dt);
    this.t += dt;
    if (dt >= STALL_S) this.stalled = true;
    if (this.t < 1) return;
    const span = this.t;
    const stalled = this.stalled;
    const sorted = this.acc.slice().sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1] ?? 0;
    this.acc.length = 0;
    this.t = 0;
    this.stalled = false;
    if (stalled) {
      this.stallS += span;
      if (this.stallS <= STALL_MAX_S) return; // a stall: neither good nor bad
    } else {
      this.stallS = 0;
    }
    this.bad = median > SLOW_S ? this.bad + 1 : 0;
    if (this.bad >= SLOW_WINDOWS) {
      this.bad = 0;
      const i = QUALITY_TIERS.indexOf(this.state.tier);
      const lower = QUALITY_TIERS[i - 1];
      if (lower) this.state.setTier(lower);
    }
  }
}
