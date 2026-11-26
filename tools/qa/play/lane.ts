// One browser lane of the playthrough harness: a Chrome (one slot), a fresh context + page with the in-page runtime (pagehook.js) and every
// detector wired: page errors, console errors / warnings (by message), unhandled rejections, failed requests (offline API separate), WebGL
// context loss, shader errors, CSP violations, screen / modal / sim-clock stuck watchers. All findings land in `violations` (deduplicated).
import type { BrowserContext, Page } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchChrome, type ChromeHandle } from './chrome';

export type Sev = 'blocker' | 'major' | 'minor' | 'info';

export interface Violation {
  detector: string;
  severity: Sev;
  message: string;
  run: string;
  /** wall seconds since the lane opened (first hit) */
  wallS: number;
  simT: number | null;
  count: number;
  evidence: string[];
}

export interface Thresholds {
  loadingStuckS: number;
  screenStuckS: number;
  modalStuckS: number;
  clockStallS: number;
  runEndFlowS: number;
  stuckSimS: number;
  /** a page.evaluate without an answer for this long = the main thread is blocked (pageUnresponsive) */
  unresponsiveS: number;
}
export const DEFAULT_THRESHOLDS: Thresholds = { loadingStuckS: 90, screenStuckS: 60, modalStuckS: 20, clockStallS: 8, runEndFlowS: 20, stuckSimS: 30, unresponsiveS: 30 };

export interface LaneOpts {
  name: string;
  /** output folder of this lane (shots, logs) */
  out: string;
  origin: string;
  /** true when the origin answers /api/* with the offline 503 (those are classified "offline", never errors) */
  apiOffline: boolean;
  width: number;
  height: number;
  dpr: number;
  touch: boolean;
  quality: string;
  lang: string;
  thresholds: Thresholds;
  headful?: boolean;
  /** pre-seeded IndexedDB save record (the `save.main` record string) written before the game boots; absent = a fresh profile */
  seedRecord?: string;
  /** keep the in-page runtime (window.__qa); the smoke of a plain dist turns it off */
  hook: boolean;
}

export interface Snap {
  hook: boolean;
  wall: number;
  url: string;
  /** rAF callbacks the page ran so far (pagehook frame counter) */
  raf?: number;
  screen?: string;
  paused?: boolean;
  loopPaused?: boolean;
  loopRunning?: boolean;
  timeScale?: number;
  loading?: { fraction: number; label: string; error: string | null };
  modal?: { kind: string; id: number | string; cards: number; story?: string } | null;
  sel?: { classId: string; doctrine: string; sex: string; empire: string; zone: string; difficulty: string; armorTier: number };
  hasResult?: boolean;
  w?: {
    time: number;
    tick: number;
    over: boolean;
    victory: boolean;
    endTimer: number;
    zone: string;
    finalAt: number;
    difficulty: string;
    classId?: string;
    doctrine?: string;
    level: number;
    hp: number;
    hpMax: number;
    alive: boolean;
    kills: number;
    x: number;
    z: number;
    enemyRows: number;
    aliveEnemies: number;
    bosses: number;
    bossId: string;
    bossFinal: boolean;
    bossHp: number;
    metins: number;
    pickups: number;
    worldModal: string | null;
    modals: number;
  } | null;
  info?: { calls: number; tris: number };
}

export interface MenuMemory {
  gc: boolean;
  heapMB: number;
  heapTotalMB: number;
  geometries: number;
  textures: number;
  programs: number;
  dom: number;
  canvases: number;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
export { sleep };

export class WallTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`wall-clock timeout after ${(ms / 1000).toFixed(1)} s (${label})`);
    this.name = 'WallTimeoutError';
  }
}

/**
 * Races an async operation against an independent wall-clock deadline so a stalled helper
 * cannot prevent writing a failing summary or releasing Chrome/slot resources.
 */
export async function withWallTimeout<T>(ms: number, label: string, fn: () => Promise<T>): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return fn();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const work = fn();
  work.catch(() => undefined); // avoid unhandled rejection if work rejects after timeout
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new WallTimeoutError(label, ms)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** console messages that are the machine, not the game (headless Chrome without an audio device, GPU driver stalls) */
const ENV_NOISE = /AudioContext encountered an error from the audio device|GPU stall due to ReadPixels|GroupMarkerNotSet|Automatic fallback to software WebGL|Deprecation.*Passive|Permissions policy violation: (?:autoplay|fullscreen)/i;
/**
 * The offline API (no --api): ONLY a message whose source is an /api/* URL (the browser's "Failed to load resource ... 503" line carries the
 * resource URL) or Chrome's "GET <origin>/api/... 503" line. The old free-text filter (Failed to fetch | sync | cloud | offline | leaderboard)
 * also swallowed real game errors: "[ui] settle failed Error: ... sync ...", "[zoneScene] x: system failed to load TypeError: Failed to fetch
 * dynamically imported module ..." (play-review 2026-10-27).
 */
const OFFLINE_LINE = /^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) \S*\/api\/\S* 50[234]\b/;
/** every warning of the game is a finding; one that reports a failure / fallback is major, the rest (i18n keys, deprecations) minor */
const WARN_MAJOR = /fail|error|missing (?!key)|not found|unknown|dropped|could not|cannot|unable|fallback|invalid|NaN|is not a function|undefined/i;
const SHADER_RX = /THREE\.WebGLProgram|Shader Error|VALIDATE_STATUS|shader compile|link(?:ing)? (?:failed|error)|GLSL|program (?:link|compile)/i;
class EvalTimeout extends Error {}

export class Lane {
  readonly opts: LaneOpts;
  chrome!: ChromeHandle;
  ctx!: BrowserContext;
  page!: Page;
  readonly violations = new Map<string, Violation>();
  readonly consoleCounts = new Map<string, { type: string; bucket: string; count: number; sample: string; url: string }>();
  readonly requests = { total: 0, failed: 0, aborted: 0, apiOffline: 0, apiOk: 0, apiError: 0, slow: [] as { url: string; ms: number }[] };
  /** WebGL contexts of secondary canvases lost (hero preview / map canvases are disposed with forceContextLoss on purpose): counted, not a violation */
  auxGlLost = 0;
  readonly fallbacks: string[] = [];
  readonly notes: string[] = [];
  run = 'boot';
  t0 = Date.now();
  closed = false;
  crashed = false;
  lastSnap: Snap | null = null;
  // watcher state
  private screenKey = '';
  private screenSince = Date.now();
  private progressAt = Date.now();
  private lastSim = -1;
  private simSince = Date.now();
  private overSince = 0;
  private modalKey = '';
  private modalSince = 0;
  /** why the last real click failed (Playwright's actionability log: which element intercepts the pointer, not visible, ...) */
  lastClickError = '';
  /** clicks the harness made at the current modal (stuck evidence) */
  modalClicks = 0;
  /** the harness is deliberately holding this screen (pause test, selftest fault): stuck watchers for these kinds are muted */
  muted = new Set<string>();
  /** fault-injection switch: the watchers still run, the harness's modal handler is the thing being starved */
  private pending: Promise<unknown>[] = [];
  /** a page.evaluate timed out (main thread blocked): every later call fails fast until the page answers again */
  hung = false;
  /** game-canvas context losses already reported for the current page (the in-page counter is per page, reset by a navigation) */
  private glLostSeen = 0;
  /** wall time of the last main-frame navigation (goto / reload / SPA fallback): requests it aborts are not defects */
  navAt = 0;
  private loopPausedSince = 0;
  /** pagehook rAF count when the sim clock last moved */
  private rafAtSim = -1;
  /** per-lane state of the modal handler (runner.handleModal); module-global state was shared by the two lanes of `matrix --lanes 2` */
  readonly handler = { picks: 0, lastClickKey: '', lastClickAt: 0, tries: new Map<string, number>() };

  private constructor(opts: LaneOpts) {
    this.opts = opts;
  }

  static async open(opts: LaneOpts): Promise<Lane> {
    const lane = new Lane(opts);
    mkdirSync(opts.out, { recursive: true });
    lane.chrome = await launchChrome({ tag: opts.name, width: opts.width, height: opts.height, headful: opts.headful });
    lane.ctx = await lane.chrome.browser.newContext({ viewport: { width: opts.width, height: opts.height }, deviceScaleFactor: opts.dpr, hasTouch: opts.touch, isMobile: opts.touch });
    lane.page = await lane.ctx.newPage();
    lane.page.setDefaultTimeout(60_000);
    lane.wire();
    if (opts.hook) await lane.ctx.addInitScript({ path: join(import.meta.dir, 'pagehook.js') });
    // settings: language is a device preference (localStorage); quality comes through ?quality=
    await lane.ctx.addInitScript((lang: string) => {
      try {
        if (!localStorage.getItem('ms.settings.v1')) localStorage.setItem('ms.settings.v1', JSON.stringify({ language: lang }));
      } catch {
        /* storage blocked */
      }
    }, opts.lang);
    lane.t0 = Date.now();
    return lane;
  }

  /** Construct a Lane backed by a custom Page transport (for unit/regression tests without Chrome). */
  static fromPage(opts: LaneOpts, page: Page, chrome?: ChromeHandle): Lane {
    const lane = new Lane(opts);
    lane.page = page;
    if (chrome) lane.chrome = chrome;
    lane.t0 = Date.now();
    return lane;
  }

  // ---------------------------------------------------------------------------------------------------------------- violations
  v(detector: string, severity: Sev, message: string, evidence: string[] = [], simT: number | null = null): void {
    const key = `${this.run}|${detector}|${message.slice(0, 200)}`;
    const cur = this.violations.get(key);
    if (cur) {
      cur.count++;
      return;
    }
    const sim = simT ?? this.lastSnap?.w?.time ?? null;
    this.violations.set(key, { detector, severity, message: message.slice(0, 1200), run: this.run, wallS: +((Date.now() - this.t0) / 1000).toFixed(1), simT: sim, count: 1, evidence: evidence.slice(0, 6) });
    console.log(`  [violation ${severity}] ${detector}: ${message.slice(0, 220)}`);
  }

  list(): Violation[] {
    return [...this.violations.values()];
  }

  /** a UI path that failed and needed a lower-level fallback is itself a finding */
  fallback(what: string, how: string): void {
    const line = `${this.run}: ${what} -> ${how}`;
    if (!this.fallbacks.includes(line)) this.fallbacks.push(line);
    this.v('uiFallback', 'major', `the DOM path failed and needed a fallback: ${what} (used ${how})`, [this.lastClickError]);
  }

  // ------------------------------------------------------------------------------------------------------------------- wiring
  private wire(): void {
    const { page } = this;
    page.on('console', (m) => {
      const ty = m.type();
      if (ty !== 'error' && ty !== 'warning') return;
      const text = m.text();
      const url = m.location().url ?? '';
      let bucket = 'game';
      if (ENV_NOISE.test(text)) bucket = 'environment';
      else if (this.opts.apiOffline && (/\/api\//.test(url) || OFFLINE_LINE.test(text))) bucket = 'offline';
      const key = `${ty}|${text.replace(/\d+(\.\d+)?/g, 'N').slice(0, 180)}`;
      const c = this.consoleCounts.get(key);
      if (c) c.count++;
      else if (this.consoleCounts.size < 600) this.consoleCounts.set(key, { type: ty, bucket, count: 1, sample: text.slice(0, 600), url: url.slice(0, 200) });
      if (SHADER_RX.test(text) && ty === 'error') this.v('shaderError', 'major', text.slice(0, 500));
      else if (ty === 'error' && bucket === 'game') {
        // the browser's own line for a failed resource: the request detector reports it with the URL
        if (/^Failed to load resource/.test(text)) return;
        this.v('consoleError', 'major', text.slice(0, 500), [url]);
      } else if (ty === 'warning' && bucket === 'game') {
        // every game warning counts (the old allow-list of patterns let "[structures] GLB prop_x failed, using procedural", "[metins] model x
        // failed to load", "[zone-atlas] ..." pass silently)
        this.v('consoleWarning', /\[i18n\]/.test(text) || !WARN_MAJOR.test(text) ? 'minor' : 'major', text.slice(0, 400), [url]);
      }
    });
    page.on('framenavigated', (f) => {
      if (f !== page.mainFrame()) return;
      this.navAt = Date.now();
      this.glLostSeen = 0; // a new document: the in-page counters start at 0 again
    });
    // errors and console lines of Web Workers (minimap paint, terrain normals, zone map) never reach page 'pageerror' / 'console'
    page.on('worker', (wk) => {
      wk.on('console', (m) => {
        const ty = m.type();
        if (ty !== 'error' && ty !== 'warning') return;
        this.v(ty === 'error' ? 'workerError' : 'consoleWarning', ty === 'error' ? 'major' : 'minor', `[worker ${wk.url().split('/').pop()}] ${m.text().slice(0, 400)}`);
      });
    });
    page.on('pageerror', (e) => this.v('pageError', 'major', String((e as Error).stack ?? e).slice(0, 1200)));
    page.on('crash', () => {
      this.crashed = true;
      this.v('pageCrash', 'blocker', 'the renderer process crashed');
    });
    page.on('close', () => {
      if (!this.closed) this.v('pageClosed', 'blocker', 'the page closed under the harness');
    });
    const started = new Map<string, number>();
    page.on('request', (r) => {
      this.requests.total++;
      started.set(r.url(), Date.now());
    });
    page.on('requestfinished', (r) => {
      const t = started.get(r.url());
      started.delete(r.url());
      if (t && Date.now() - t > 8000) this.requests.slow.push({ url: r.url().slice(0, 160), ms: Date.now() - t });
    });
    page.on('response', (r) => {
      const st = r.status();
      let path = '';
      try {
        path = new URL(r.url()).pathname;
      } catch {
        return;
      }
      if (path.startsWith('/api/')) {
        if (this.opts.apiOffline) this.requests.apiOffline++;
        else if (st >= 400) {
          this.requests.apiError++;
          this.v('apiError', 'major', `HTTP ${st} ${r.request().method()} ${path}`);
        } else this.requests.apiOk++;
        return;
      }
      if (st >= 400) {
        this.requests.failed++;
        this.v('failedRequest', st >= 500 ? 'blocker' : 'major', `HTTP ${st} ${r.request().method()} ${path}`, [r.url()]);
      }
    });
    page.on('requestfailed', (r) => {
      let path = '';
      try {
        path = new URL(r.url()).pathname;
      } catch {
        return;
      }
      const err = r.failure()?.errorText ?? 'failed';
      if (path.startsWith('/api/') && this.opts.apiOffline) {
        this.requests.apiOffline++;
        return;
      }
      if (/ERR_ABORTED/.test(err)) {
        // navigation / reload / a cancelled range read: counted, not a defect on its own. A module chunk or a stylesheet aborted while
        // no navigation is going on is a failed import (the game then only logs it, or silently draws without that part)
        const rt = r.resourceType();
        if ((rt === 'script' || rt === 'stylesheet') && Date.now() - this.navAt > 3000 && !this.closed) {
          this.requests.failed++;
          this.v('failedRequest', 'major', `${rt} request aborted (${err}) ${r.method()} ${path}`, [r.url()]);
          return;
        }
        this.requests.aborted++;
        return;
      }
      this.requests.failed++;
      this.v('failedRequest', 'major', `request failed (${err}) ${r.method()} ${path}`, [r.url()]);
    });
  }

  async goto(path = '/'): Promise<void> {
    const q = path.includes('?') ? '&' : '?';
    this.navAt = Date.now();
    this.hung = false;
    await this.page.goto(`${this.opts.origin}${path}${this.opts.quality && this.opts.quality !== 'auto' ? `${q}quality=${this.opts.quality}` : ''}`, { waitUntil: 'load', timeout: 120_000 });
  }

  /** writes the pre-seeded save record into IndexedDB (origin page of the harness server), then returns; call before goto('/') */
  async seed(record: string): Promise<void> {
    await this.page.goto(`${this.opts.origin}/__qa_seed.html`, { waitUntil: 'load', timeout: 30_000 }).catch(() => undefined);
    const ok = await this.ev(
      async (rec: string) => {
        return await new Promise<string>((resolve) => {
          const req = indexedDB.open('metin-survivors', 1);
          req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv');
          };
          req.onerror = () => resolve('open failed');
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction('kv', 'readwrite');
            tx.objectStore('kv').put(rec, 'save.main');
            tx.oncomplete = () => {
              db.close();
              resolve('ok');
            };
            tx.onerror = () => resolve('tx failed');
          };
        });
      },
      record,
      'save seed',
      30_000,
    );
    if (ok !== 'ok') throw new Error(`seeding the save failed: ${ok}`);
  }

  async reload(): Promise<void> {
    this.navAt = Date.now();
    this.hung = false;
    await this.page.reload({ waitUntil: 'load', timeout: 120_000 });
  }

  /**
   * page.evaluate with a deadline. A page whose main thread is blocked (an endless loop, a multi-second freeze) never answers an evaluate,
   * and the old harness then waited forever: no verdict, no summary, the Chrome slot held. On a timeout this raises `pageUnresponsive`
   * (blocker) once per hang and marks the lane hung; later calls fail fast with null until one answers again (`probeAlive`).
   */
  async ev<T>(fn: (arg: any) => T | Promise<T>, arg?: unknown, what = 'evaluate', deadlineMs?: number): Promise<T> {
    if (this.closed || this.crashed) throw new Error('lane closed');
    // a booting page or a run being built (zone scene, terrain, model decode) runs long tasks on a loaded machine: 3x the deadline there
    const busy = !this.lastSnap?.screen || this.lastSnap.screen === 'boot' || this.lastSnap.screen === 'loading';
    const timeoutMs = deadlineMs ?? this.opts.thresholds.unresponsiveS * 1000 * (busy ? 3 : 1);
    if (this.hung && !(await this.probeAlive())) throw new EvalTimeout(`page still unresponsive (${what})`);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const p = this.page.evaluate(fn as never, arg as never) as Promise<T>;
    p.catch(() => undefined); // an abandoned evaluate may reject later (page closed)
    try {
      return await Promise.race([
        p,
        new Promise<never>((_, rej) => {
          timer = setTimeout(() => rej(new EvalTimeout(`no answer from the page within ${timeoutMs / 1000} s (${what})`)), timeoutMs);
        }),
      ]);
    } catch (e) {
      if (e instanceof EvalTimeout) {
        if (!this.hung) this.v('pageUnresponsive', 'blocker', `the page's main thread did not answer a ${what} for ${timeoutMs / 1000} s (screen ${this.lastSnap?.screen ?? '?'}, sim ${this.lastSnap?.w?.time ?? '?'} s): a hang or an endless loop`);
        this.hung = true;
      }
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** true when a trivial evaluate answers within at most 2 s (a frozen page that recovered clears `hung`) */
  async probeAlive(): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const probeMs = Math.min(2000, Math.max(20, this.opts.thresholds.unresponsiveS * 1000));
    const p = this.page.evaluate(() => 1);
    p.catch(() => undefined);
    const ok = await Promise.race([p.then(() => true).catch(() => false), new Promise<boolean>((r) => (timer = setTimeout(() => r(false), probeMs)))]);
    if (timer) clearTimeout(timer);
    if (ok && this.hung) {
      this.hung = false;
      this.notes.push(`${this.run}: the page answered again after a hang`);
    }
    return ok;
  }

  // -------------------------------------------------------------------------------------------------------------- state / watch
  /** one snapshot (null when the page is gone or hung), with the in-page hits drained and the watchers run */
  async snap(): Promise<Snap | null> {
    if (this.closed || this.crashed) return null;
    try {
      const s = await this.ev(() => (window as any).__qa?.snap?.() ?? { hook: false, wall: 0, url: location.pathname }, undefined, 'state snapshot');
      this.lastSnap = s as Snap;
      await this.drain();
      this.watch(s as Snap);
      return s as Snap;
    } catch (e) {
      const msg = String((e as Error).message ?? e).split('\n')[0] ?? '';
      if (e instanceof EvalTimeout) return null;
      if (/Execution context was destroyed|navigat/i.test(msg)) return this.lastSnap; // a reload in flight
      this.v('harness', 'info', `snapshot failed: ${msg.slice(0, 200)}`);
      return null;
    }
  }

  async drain(): Promise<void> {
    const d = (await this.ev(() => (window as any).__qa?.drain?.() ?? null, undefined, 'detector drain').catch(() => null)) as {
      hits: { kind: string; detail: string; wall: number; sim: number | null }[];
      errors: { message: string; src: string; line: number; stack: string }[];
      resourceErrors: { tag: string; url: string }[];
      rejections: { reason: string }[];
      csp: { directive: string; blocked: string; source: string; line: number }[];
      gl: { created: number; lost: number; restored: number; auxLost: number; creationErrors: string[] };
    } | null;
    if (!d) return;
    for (const h of d.hits) {
      if (h.kind === 'nonFinite') this.v('nonFinite', 'blocker', h.detail, [], h.sim);
      else if (h.kind === 'heroStuck') this.v('heroStuck', 'major', h.detail, [], h.sim);
      else if (h.kind === 'heroConfined') this.v('heroConfined', 'major', h.detail, [], h.sim);
      else if (h.kind === 'heroOffWalkable') this.v('heroOffWalkable', 'major', h.detail, [], h.sim);
      else if (h.kind === 'simException') this.v('simException', 'blocker', h.detail, [], h.sim);
      else this.v('harness', 'info', `${h.kind}: ${h.detail}`);
    }
    for (const e of d.errors) this.v('windowError', 'major', `${e.message} @ ${e.src.split('/').pop()}:${e.line}`, [e.stack.slice(0, 400)]);
    for (const e of d.resourceErrors) this.v('resourceError', 'major', `${e.tag} failed to load ${e.url}`);
    for (const r of d.rejections) this.v('unhandledRejection', 'major', r.reason.slice(0, 700));
    for (const c of d.csp) this.v('cspViolation', 'major', `${c.directive} blocked ${c.blocked} (${c.source}:${c.line})`);
    // the in-page counters are cumulative for the page: report a loss once (new losses only), not again under every later run label
    if (d.gl.lost > this.glLostSeen) {
      this.v('webglLost', 'blocker', `the game canvas lost its WebGL context ${d.gl.lost - this.glLostSeen}x (restored ${d.gl.restored}x in this page so far)`);
      this.glLostSeen = d.gl.lost;
    }
    if (d.gl.auxLost > 0) this.auxGlLost = d.gl.auxLost;
    for (const m of d.gl.creationErrors) this.v('webglLost', 'blocker', `WebGL context creation error: ${m}`);
  }

  /** stuck watchers: loading, screen without progress, modal open too long, sim clock stalled, run over without the end flow */
  private watch(s: Snap): void {
    const th = this.opts.thresholds;
    const now = Date.now();
    if (!s.hook || !s.screen) return;
    const mod = s.modal ? `${s.modal.kind}:${s.modal.id}` : '';
    const key = `${s.screen}|${mod}`;
    if (key !== this.screenKey) {
      this.screenKey = key;
      this.screenSince = now;
      this.progressAt = now;
    }
    const simT = s.w?.time ?? -1;
    if (simT !== this.lastSim) {
      this.lastSim = simT;
      this.simSince = now;
      this.progressAt = now;
      this.rafAtSim = s.raf ?? -1;
    }
    // loading
    if ((s.screen === 'loading' || s.screen === 'boot') && !this.muted.has('loading') && (now - this.screenSince) / 1000 > th.loadingStuckS) {
      this.v('loadingStuck', 'blocker', `the ${s.screen} screen has been showing for more than ${th.loadingStuckS} s (${JSON.stringify(s.loading)})`);
    }
    // any screen without progress
    if (!this.muted.has('screen') && (now - this.progressAt) / 1000 > th.screenStuckS) {
      this.v('screenStuck', 'blocker', `screen "${s.screen}"${mod ? ` modal ${mod}` : ''} showed no progress (no screen / modal / sim-clock change) for more than ${th.screenStuckS} s`);
      this.progressAt = now; // report again only after another window
    }
    // modal open too long
    if (mod && s.modal && s.modal.kind !== 'pause') {
      if (this.modalKey !== mod) {
        this.modalKey = mod;
        this.modalSince = now;
        this.modalClicks = 0;
      } else if (!this.muted.has('modal') && (now - this.modalSince) / 1000 > th.modalStuckS && s.modal.kind !== 'runEnd') {
        this.v('modalStuck', 'blocker', `modal ${mod} has been open for more than ${th.modalStuckS} s (${this.modalClicks} harness clicks at it)`);
      }
    } else if (!mod) this.modalKey = '';
    // sim clock
    const w = s.w;
    if (s.screen === 'run' && w && !s.modal && !s.paused && !s.loopPaused && !w.over && !this.muted.has('clock')) {
      if ((now - this.simSince) / 1000 > th.clockStallS) {
        // frames drawn meanwhile: >= 10 = the page renders and the sim stands still (a frozen game loop: blocker); fewer = the page drew
        // (almost) nothing for that long (GPU / compositor stall, the first-use shader compiles of PLAY-2): a frame stall, not a softlock -
        // if it never ends, screenStuck (60 s) and pageUnresponsive still report it
        const frames = s.raf !== undefined && this.rafAtSim >= 0 ? s.raf - this.rafAtSim : 99;
        if (frames >= 10) this.v('simClockStalled', 'blocker', `the run screen is showing, no modal is open and the sim clock stayed at ${w.time} s for more than ${th.clockStallS} s wall while the page drew ${frames} frames (loop running: ${s.loopRunning})`);
        else this.v('frameStall', 'major', `the page drew ${frames} frame(s) in more than ${th.clockStallS} s on the run screen (sim ${w.time} s, no modal): a GPU / compositor stall, the sim waits for frames`);
      }
    }
    // the loop is paused although nothing is shown that could un-pause it (no pause overlay, no story, no card): a softlock the clock
    // watcher above skipped on purpose (it treats loopPaused as "a modal holds the sim")
    if (s.screen === 'run' && w && !w.over && s.loopPaused && !s.modal && !s.paused && !this.muted.has('clock')) {
      if (!this.loopPausedSince) this.loopPausedSince = now;
      else if ((now - this.loopPausedSince) / 1000 > th.clockStallS) this.v('loopPausedNoModal', 'blocker', `the game loop has been paused for more than ${th.clockStallS} s with no pause overlay or modal on screen (sim ${w.time} s): nothing the player can do un-pauses it`);
    } else this.loopPausedSince = 0;
    // run over without the end flow
    if (s.screen === 'run' && w?.over && s.modal?.kind !== 'runEnd' && !this.muted.has('runEnd')) {
      if (!this.overSince) this.overSince = now;
      else if ((now - this.overSince) / 1000 > th.runEndFlowS && !s.modal) this.v('runEndMissing', 'blocker', `the run is over (victory=${w.victory}, sim ${w.time} s) and the run-end flow did not appear within ${th.runEndFlowS} s`);
    } else this.overSince = 0;
  }

  markProgress(): void {
    this.progressAt = Date.now();
  }

  // ----------------------------------------------------------------------------------------------------------- waits and clicks
  /** polls until `cond(snap)` (true) or the timeout; every poll runs the watchers. Returns the last snapshot (null on timeout). */
  async waitFor(label: string, cond: (s: Snap) => boolean, timeoutS: number, pollMs = 150, onTick?: (s: Snap) => Promise<void>): Promise<Snap | null> {
    const end = Date.now() + timeoutS * 1000;
    while (Date.now() < end) {
      const s = await this.snap();
      if (!s) return null;
      if (cond(s)) return s;
      if (onTick) await onTick(s);
      await sleep(pollMs);
    }
    this.v('waitTimeout', 'major', `timed out after ${timeoutS} s waiting for: ${label} (screen ${this.lastSnap?.screen}, modal ${this.lastSnap?.modal?.kind ?? '-'})`);
    return null;
  }

  async count(sel: string): Promise<number> {
    return this.page.locator(sel).count().catch(() => 0);
  }

  async visible(sel: string): Promise<boolean> {
    return this.page
      .locator(sel)
      .first()
      .isVisible()
      .catch(() => false);
  }

  /** real click on the first match; false when it could not be clicked in time */
  async click(sel: string, opts: { timeout?: number; last?: boolean; text?: RegExp; force?: boolean; nth?: number } = {}): Promise<boolean> {
    let loc = this.page.locator(sel);
    if (opts.text) loc = loc.filter({ hasText: opts.text });
    loc = opts.nth !== undefined ? loc.nth(opts.nth) : opts.last ? loc.last() : loc.first();
    try {
      await loc.click({ timeout: opts.timeout ?? 20000, force: opts.force });
      this.modalClicks++;
      return true;
    } catch (e) {
      this.lastClickError = `${sel}: ${String((e as Error).message ?? e).replace(/\s+/g, ' ').slice(0, 700)}`;
      // Playwright waits for a STABLE box (two equal frames): an element with a running CSS animation on a 1-3 fps page can time out
      // although a player clicks it fine. Last real try: the mouse at the centre of the box, only when a hit test says the element
      // itself (or a child) is the topmost thing there - an overlay that eats the pointer still fails (that is the defect to report).
      if (opts.force) return false;
      const hit = await this.hitTestedClick(loc).catch(() => 'error');
      if (hit === 'ok') {
        this.modalClicks++;
        this.notes.push(`${this.run}: ${sel} needed a hit-tested mouse click (Playwright's stable-box wait timed out)`);
        return true;
      }
      this.lastClickError += ` | hit test: ${hit}`;
      return false;
    }
  }

  /** mouse click at the centre of the element's box when elementFromPoint there is the element or inside it; else why not */
  private async hitTestedClick(loc: ReturnType<Page['locator']>): Promise<string> {
    const box = await loc.boundingBox({ timeout: 3000 }).catch(() => null);
    if (!box || box.width < 2 || box.height < 2) return 'no box';
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const top = await loc.evaluate(
      (el, p) => {
        const t = document.elementFromPoint(p.x, p.y);
        if (!t) return 'nothing at the point';
        if (el === t || el.contains(t)) return (el as HTMLButtonElement).disabled ? 'disabled' : 'ok';
        return `covered by <${t.tagName.toLowerCase()}${t.id ? '#' + t.id : ''}${typeof t.className === 'string' && t.className ? '.' + t.className.trim().split(/\s+/).join('.') : ''}>`;
      },
      { x, y },
      { timeout: 3000 },
    );
    if (top !== 'ok') return top;
    await this.page.mouse.click(x, y);
    return 'ok';
  }

  /** click that falls back to the element's own click() (still the real handler), and reports which level was used: 'real' | 'dom' | 'none' */
  async clickLadder(sel: string, opts: { timeout?: number; last?: boolean; text?: RegExp } = {}): Promise<'real' | 'dom' | 'none'> {
    if (this.closed || this.crashed || this.hung) return 'none';
    if (await this.click(sel, opts)) return 'real';
    if (this.hung) return 'none';
    if (await this.click(sel, opts)) return 'real'; // a starved page (1 fps) can need a second window
    if (this.hung) return 'none';
    const ok = await this.ev(
      ([s, last, rx]: [string, boolean, string | null]) => {
        let els = Array.from(document.querySelectorAll<HTMLElement>(s));
        if (rx) els = els.filter((e) => new RegExp(rx, 'i').test(e.textContent ?? ''));
        const el = last ? els[els.length - 1] : els[0];
        if (!el) return false;
        el.click();
        return true;
      },
      [sel, !!opts.last, opts.text ? opts.text.source : null] as [string, boolean, string | null],
      `click fallback (${sel})`,
    ).catch(() => false);
    return ok ? 'dom' : 'none';
  }

  /** what the page looks like right now (for the message of a failed click): url, ready state, screen, a bit of text, and a screenshot */
  async diagnose(tag: string): Promise<string> {
    if (this.closed || this.crashed || this.hung) {
      return JSON.stringify({
        skipped: true,
        hung: this.hung,
        closed: this.closed,
        crashed: this.crashed,
        screen: this.lastSnap?.screen ?? null,
        modal: this.lastSnap?.modal?.kind ?? null,
      });
    }
    const deadlineMs = Math.min(this.opts.thresholds.unresponsiveS * 1000, 10_000);
    const d = await this.ev(
      () => {
        const ms = (window as any).__ms;
        return JSON.stringify({ url: location.href, ready: document.readyState, screen: ms?.store?.screen?.value ?? null, modal: ms?.store?.modal?.value?.kind ?? null, menu: document.querySelectorAll('.ms-menu').length, play: document.querySelectorAll('.ms-menu-play').length, ui: (document.getElementById('ui')?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 160) });
      },
      undefined,
      `diagnose (${tag})`,
      deadlineMs,
    ).catch((e: Error) => `evaluate failed: ${String(e.message).split('\n')[0]}`);
    if (!this.hung && !this.closed && !this.crashed) {
      await this.shot(`diag-${tag}`);
    }
    return d;
  }

  async shot(name: string): Promise<string | null> {
    if (this.closed || this.crashed) return null;
    if (this.hung && !(await this.probeAlive())) return null;
    const p = join(this.opts.out, `${name}.png`);
    try {
      await this.ev(() => { const q = (window as any).__qa; if (q) q.noRec = true; }, undefined, 'screenshot prep').catch(() => undefined);
      await this.page.screenshot({ path: p, type: 'png', animations: 'allow', caret: 'hide', timeout: 60_000 });
      return p;
    } catch (e) {
      this.v('harness', 'info', `screenshot ${name} failed: ${String((e as Error).message).split('\n')[0]}`);
      return null;
    } finally {
      // always re-arm the recorder: a screenshot that threw used to leave noRec = true, and frame() then skipped patch() for every later
      // session (no god mode, no bot, no nonFinite / stuck checks) for the rest of the lane
      await this.ev(() => { const q = (window as any).__qa; if (q) q.noRec = false; }, undefined, 'screenshot done').catch(() => undefined);
    }
  }

  async measure(): Promise<MenuMemory | null> {
    return (await this.ev(() => (window as any).__qa?.measure?.() ?? null, undefined, 'memory measure', Math.max(this.opts.thresholds.unresponsiveS * 1000, 45_000)).catch(() => null)) as MenuMemory | null;
  }

  /** the persisted save (IndexedDB metin-survivors / kv / save.main), decoded; null when absent */
  async readSave(): Promise<{ profileId: string; unlocks: { zones: string[]; hard: string[] }; stats: { runs: number; wins: number; deaths: number; zones: Record<string, Record<string, { runs: number; clears: number }>> }; bank: { yeop: number; shards: number }; classesXp: Record<string, number> } | null> {
    return (await this.ev(async () => {
        return await new Promise<any>((resolve) => {
          const req = indexedDB.open('metin-survivors');
          req.onerror = () => resolve(null);
          req.onsuccess = () => {
            try {
              const db = req.result;
              if (!db.objectStoreNames.contains('kv')) return resolve(null);
              const g = db.transaction('kv', 'readonly').objectStore('kv').get('save.main');
              g.onsuccess = () => {
                db.close();
                if (typeof g.result !== 'string') return resolve(null);
                try {
                  const save = JSON.parse(JSON.parse(g.result).d);
                  const xp: Record<string, number> = {};
                  for (const [k, v] of Object.entries<any>(save.classes ?? {})) xp[k] = v.xp;
                  resolve({ profileId: save.profile?.id, unlocks: save.unlocks, stats: save.stats, bank: save.bank, classesXp: xp });
                } catch {
                  resolve(null);
                }
              };
              g.onerror = () => resolve(null);
            } catch {
              resolve(null);
            }
          };
        });
      }, undefined, 'save read')
      .catch(() => null)) as never;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await Promise.allSettled(this.pending);
    try {
      await this.chrome.close();
    } catch {
      /* gone */
    }
  }

  writeJson(name: string, data: unknown): string {
    const p = join(this.opts.out, name);
    writeFileSync(p, JSON.stringify(data, null, 2));
    return p;
  }

  consoleSummary(): { type: string; bucket: string; count: number; sample: string; url: string }[] {
    return [...this.consoleCounts.values()].sort((a, b) => b.count - a.count);
  }
}
