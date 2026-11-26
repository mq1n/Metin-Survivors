// Boot progress (owner: B1 boot-loading). One channel for the three things a player sees while the page starts:
//   1. the inline splash of index.html (CSS + public/boot-splash.js, window.__msSplash): first paint, before any game code;
//   2. the boot screen (ui/screens/Boot.tsx), which reads store.loading once the store exists;
//   3. boot() in app.ts, which reports the stage it is in and finally waits for the boot art to be decoded, so the screen that
//      takes over (the boot screen, then the menu) never pops its paintings in.
// The gauge only moves forward: the splash creeps by CSS to ~33 % while the game chunk downloads (see index.html), the stages
// below continue from there. The percent is work done so far; the label names the work in progress.
import { fmtPct, t } from '../i18n/i18n';

export type BootStage = 'assets' | 'content' | 'save' | 'ui' | 'ready';

/** How far the gauge is when a stage starts (the label names that stage). `ui` is reported twice: chunk requested, then mounted. */
export const BOOT_FRACTION: Readonly<Record<BootStage, number>> = { assets: 0.36, content: 0.5, save: 0.64, ui: 0.78, ready: 1 };
/** the UI chunk is downloaded and mounted, only the art and the final beat are left */
export const BOOT_UI_MOUNTED = 0.92;

export interface SplashApi {
  set(p: number, text?: string, pct?: string): void;
  done(): void;
}
export interface LoadingSink {
  setLoading(l: { fraction: number; label: string }): void;
}

let last: { fraction: number; label: string } = { fraction: 0, label: 'assets' };
let sink: LoadingSink | null = null;

function splash(): SplashApi | undefined {
  return typeof window === 'undefined' ? undefined : (window as unknown as { __msSplash?: SplashApi }).__msSplash;
}

/** Report where boot() is. Monotonic: a smaller fraction than the last one is ignored (the gauge never walks back). */
export function reportBoot(stage: BootStage, fraction: number = BOOT_FRACTION[stage]): void {
  const f = Math.min(1, Math.max(last.fraction, Number.isFinite(fraction) ? fraction : 0));
  last = { fraction: f, label: stage };
  sink?.setLoading(last);
  splash()?.set(f, `${t(`boot.stage.${stage}`)}…`, fmtPct(f));
}

/** The store exists from here on: the boot screen reads store.loading, which starts at what was reported so far. */
export function attachBootSink(s: LoadingSink): void {
  sink = s;
  s.setLoading(last);
}

/** Last reported state (tests, debugging). */
export function bootState(): Readonly<{ fraction: number; label: string }> {
  return last;
}

/** Test hook: forget everything. */
export function resetBootProgress(): void {
  last = { fraction: 0, label: 'assets' };
  sink = null;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** a frame, or a short timeout when the tab is in the background (no rAF there) */
const frame = (): Promise<void> => Promise.race([new Promise<void>((r) => requestAnimationFrame(() => r())), sleep(120)]);

/** Decode an image into the browser's memory cache; never rejects. */
export async function decodeImage(url: string): Promise<void> {
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
  } catch {
    /* a missing / undecodable image must not stop the game from starting */
  }
}

export interface FinishOptions {
  /** urls of the boot art (key art, logo, gauge): decoded before the splash is dropped */
  art: readonly string[];
  /** the longest the art may hold the start up */
  maxWaitMs?: number;
  /** how long the finished gauge stays on screen: the player sees the load complete before the menu opens */
  holdMs?: number;
}

/** Last step of boot(): art decoded, gauge at 100 %, splash dropped (the boot screen is already above it), a short completion beat. */
export async function finishBoot({ art, maxWaitMs = 1500, holdMs = 350 }: FinishOptions): Promise<void> {
  await Promise.race([Promise.all(art.map(decodeImage)), sleep(maxWaitMs)]);
  reportBoot('ready', 1);
  await frame();
  splash()?.done();
  await sleep(holdMs);
}
