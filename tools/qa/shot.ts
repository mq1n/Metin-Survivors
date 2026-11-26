#!/usr/bin/env bun
// Headless capture tool for agents (dev only, never shipped). Drives the shared Vite dev server (see tools/qa/README.md)
// with the system Chrome through playwright-core and writes PNGs + a JSON summary (console errors included) to stdout.
//




//
// QA only, every mode: --query "up=noarc,nocorr" appends k=v pairs to the page URL (they win over the same key the mode sets);
// --content '<json>' | @file.json sets window.__MS_CONTENT_OVERRIDE__ before the page loads, so a system that ships switched off in
// content can be played (src/data/override.ts merges it into the content; dev server / VITE_QA_HOOKS builds only). See tools/qa/README.md.
//
// Chrome instances are capped machine-wide (MS_QA_SLOTS, default 6; tools/qa/slots.ts) with lock files, so many agents can
// call this at once.
// Reliability (zones core B3): Chrome that opens no DevTools port is restarted (up to 3 tries per attempt), and a capture that
// hits a dev-server module error (HTTP 5xx on a /src module, the Vite error overlay, a run-load error such as "x is not
// defined" from another lane's half-written file) is dropped, waits (--retryWait, default 20 s, growing) and runs again
// (--retries, default 4 more attempts) before it fails with a message that names the error. See tools/qa/README.md.
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { acquireSlot } from './slots';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';

// ------------------------------------------------------------------------------------------------------------ args
const argv = process.argv.slice(2);
const mode = argv[0] ?? 'help';
const opts = new Map<string, string>();
for (let i = 1; i < argv.length; i++) {
  const a = argv[i] ?? '';
  if (!a.startsWith('--')) continue;
  const next = argv[i + 1];
  if (next === undefined || next.startsWith('--')) opts.set(a.slice(2), '1');
  else {
    opts.set(a.slice(2), next);
    i++;
  }
}
const str = (k: string, d: string): string => opts.get(k) ?? d;
const num = (k: string, d: number): number => (opts.has(k) ? Number(opts.get(k)) : d);
const flag = (k: string, d: boolean): boolean => (opts.has(k) ? opts.get(k) !== '0' && opts.get(k) !== 'false' : d);

const BASE = str('base', process.env.MS_QA_BASE ?? 'http://127.0.0.1:5183').replace(/\/$/, '');




const SWAPS: [string, string][] = str('swap', '')
  .split(';')
  .filter(Boolean)
  .map((kv) => {
    const i = kv.indexOf('=');
    return [kv.slice(0, i), resolve(kv.slice(i + 1))] as [string, string];
  });
const W = num('w', 1920);
const H = num('h', 1080);
const DPR = num('dpr', 1);
const TIMEOUT = num('timeout', 240) * 1000;
const OUT = str('out', '');
/** --query "k=v&k2=v2": appended to the page URL in every mode (QA switches such as up=noarc,nocorr) */
const QUERY = str('query', '').trim().replace(/^[?&]+/, '');
/** --content '<json>' | @file: a content patch for src/data/override.ts, parsed here so a typo fails before Chrome starts */
function readContentArg(arg: string): string {
  const text = arg.trim();
  let src = text;
  if (text.startsWith('@')) {
    if (!existsSync(text.slice(1))) throw new Error(`--content: no such file ${text.slice(1)}`);
    src = readFileSync(text.slice(1), 'utf8');
  }
  let v: unknown;
  try {
    v = JSON.parse(src.replace(/^\uFEFF/, ''));
  } catch (e) {
    throw new Error(`--content: not valid JSON (${String((e as Error).message).split('\n')[0]}); in PowerShell put the patch in a file and pass @file.json`);
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('--content: the patch must be a JSON object, e.g. {"zones":[{"id":"yeonmu","metins":{"firstAt":20}}]}');
  return JSON.stringify(v);
}
const CONTENT_PATCH = opts.has('content') ? readContentArg(str('content', '')) : '';
/** extra attempts after a dev-server module error (0 = fail at once); also MS_QA_RETRIES */
const RETRIES = Math.max(0, Math.round(num('retries', Number(process.env.MS_QA_RETRIES ?? 4))));
/** seconds to wait before the first retry (grows x1.6 per attempt, capped at 90 s); also MS_QA_RETRY_WAIT */
const RETRY_WAIT = Math.max(0, num('retryWait', Number(process.env.MS_QA_RETRY_WAIT ?? 20)));
/** seconds to wait for Chrome's DevTools port per start try; also MS_QA_CHROME_WAIT */
const CHROME_WAIT = Math.max(1, num('chromeWait', Number(process.env.MS_QA_CHROME_WAIT ?? 45)));
/** Chrome start tries per attempt when no DevTools port shows up; also MS_QA_CHROME_TRIES */
const CHROME_TRIES = Math.max(1, Math.round(num('chromeTries', Number(process.env.MS_QA_CHROME_TRIES ?? 3))));

if (mode === 'help' || mode === '--help' || !OUT) {
  console.log(readFileSync(join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'README.md'), 'utf8'));
  process.exit(mode === 'help' ? 0 : 1);
}

// ------------------------------------------------------------------------------------------------- chrome slots
// MS_QA_CHROME overrides the browser (also how the no-DevTools-port retry is tested: point it at any exe that opens none)
const CHROME = [process.env.MS_QA_CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => p && existsSync(p));
if (!CHROME) throw new Error('no Chrome / Edge found');
// ----------------------------------------------------------------------------------------------------- helpers
interface Summary {
  mode: string;
  files: string[];
  consoleErrors: string[];
  /** console warnings (shader program info logs, deprecations), only collected with --warnings */
  consoleWarnings?: string[];
  pageErrors: string[];
  notes: string[];
  ms: number;
}
const summary: Summary = { mode, files: [], consoleErrors: [], pageErrors: [], notes: [], ms: 0 };
const t0 = Date.now();

function outPath(name?: string): string {
  // --out is a .png file (single shot) or a directory (several shots: <dir>/<prefix><name>.png)
  if (extname(OUT).toLowerCase() === '.png' && !name) {
    mkdirSync(dirname(resolve(OUT)), { recursive: true });
    return resolve(OUT);
  }
  const dir = extname(OUT).toLowerCase() === '.png' ? dirname(resolve(OUT)) : resolve(OUT);
  mkdirSync(dir, { recursive: true });
  return join(dir, `${str('prefix', '')}${name ?? 'shot'}.png`);
}

async function shoot(page: Page, name?: string): Promise<string> {
  const p = outPath(name);
  await page.screenshot({ path: p, type: 'png', animations: 'allow', caret: 'hide', timeout: 120_000 });
  summary.files.push(p);
  return p;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function frames(page: Page, n: number): Promise<void> {
  await page.evaluate(async (k) => {
    for (let i = 0; i < k; i++) await new Promise((r) => requestAnimationFrame(() => r(null)));
  }, n);
}

function url(path: string): string {
  return /^https?:/.test(path) ? path : `${BASE}${path.startsWith('/') ? '' : '/'}${path}`;
}

// ------------------------------------------------------------------------------------- dev-server watch (zones core B3)
// Another lane's half-written file breaks the shared dev server for every capture: a module answers HTTP 500 (Vite
// transform / import error), the Vite error overlay shows, or the run fails to load with "x is not defined". The first
// sign of one is flagged here; every long wait is raced against it (guard) so a broken page fails in seconds instead of
// after the 240 s timeout, and the attempt is retried after a pause (main, below).
class DevServerError extends Error {
  readonly devServer = true;
}
class ChromeStartError extends Error {}
/** the content override was refused by the game (named errors in the message): retrying cannot help */
class ContentOverrideRejected extends Error {}

/** page.goto target: the mode's URL with --query appended (a key the mode already sets is replaced, the text of --query stays as typed) */
function withQuery(full: string): string {
  if (!QUERY) return full;
  const hashAt = full.indexOf('#');
  const hash = hashAt >= 0 ? full.slice(hashAt) : '';
  const bare = hashAt >= 0 ? full.slice(0, hashAt) : full;
  const qAt = bare.indexOf('?');
  const mine = new Set(QUERY.split('&').filter(Boolean).map((kv) => kv.split('=')[0]));
  const keep = (qAt >= 0 ? bare.slice(qAt + 1) : '').split('&').filter((kv) => kv !== '' && !mine.has(kv.split('=')[0]));
  return `${qAt >= 0 ? bare.slice(0, qAt) : bare}?${[...keep, QUERY].join('&')}${hash}`;
}
/** the "[content] QA override applied, ..." line the page logs once the override was merged (this attempt) */
let overrideNote = '';
let overrideReject: ((e: ContentOverrideRejected) => void) | null = null;
let overrideP: Promise<never> = new Promise<never>(() => {});
function resetOverrideWatch(): void {
  overrideNote = '';
  overrideP = new Promise<never>((_, rej) => {
    overrideReject = rej;
  });
  overrideP.catch(() => {});
}

/** text of a page / run-load error that comes from a module another lane has not finished writing */
const MODULE_ERR =
  /is not defined|is not a function|does not provide an export|dynamically imported module|Failed to resolve import|Failed to load url|Importing a module script failed|Pre-transform error|Transform failed|Internal server error|Unexpected (token|end of input)|SyntaxError|Cannot find module|\bHTTP 50\d\b/i;

let devErr: DevServerError | null = null;
let devReject: ((e: DevServerError) => void) | null = null;
let devP: Promise<never> = new Promise<never>(() => {});

function resetDevWatch(): void {
  devErr = null;
  devP = new Promise<never>((_, rej) => {
    devReject = rej;
  });
  devP.catch(() => {}); // never an unhandled rejection when nothing is racing it
}

function flagDevError(msg: string): void {
  if (devErr) return;
  devErr = new DevServerError(msg.slice(0, 700));
  devReject?.(devErr);
}

/** `p`, unless a dev-server module error is flagged first */
function guard<T>(p: Promise<T>): Promise<T> {
  p.catch(() => {}); // the page may close under it once the attempt is abandoned
  return Promise.race([p, devP, overrideP]);
}

// Bun on Windows cannot hand Chrome the extra pipe fds playwright's launch() uses → start Chrome ourselves on a free
// DevTools port (port 0 + DevToolsActivePort; Windows reserves many fixed port ranges) and connect over CDP.
let chromeProc: ReturnType<typeof Bun.spawn> | null = null;
let profileDir = '';
let browser: Browser | null = null;

async function closeChrome(): Promise<void> {
  try {
    await browser?.close();
  } catch {
    /* already closed */
  }
  browser = null;
  try {
    // chromeProc is assigned inside open(); at module level TS narrows it to `null`, so name its declared type again
    const proc = chromeProc as ReturnType<typeof Bun.spawn> | null;
    proc?.kill();
    await proc?.exited;
  } catch {
    /* gone */
  }
  chromeProc = null;
  for (let i = 0; i < 10 && profileDir; i++) {
    try {
      rmSync(profileDir, { recursive: true, force: true });
      break;
    } catch {
      await sleep(300); // Chrome still holds profile files for a moment on Windows
    }
  }
  profileDir = '';
}

/** Starts Chrome and connects; when it opens no DevTools port (seen on a loaded machine) or the connection fails, it is
 * killed and started again, CHROME_TRIES times in all. */
async function startChrome(): Promise<Browser> {
  let last = '';
  for (let tryNo = 1; tryNo <= CHROME_TRIES; tryNo++) {
    profileDir = join(tmpdir(), `ms-qa-${process.pid}-${Date.now()}`);
    mkdirSync(profileDir, { recursive: true });
    chromeProc = Bun.spawn(
      [
        CHROME as string,
        ...(flag('headful', false) ? [] : ['--headless=new']),
        '--remote-debugging-port=0',
        `--user-data-dir=${profileDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--ignore-gpu-blocklist',
        '--enable-webgl',
        '--use-angle=d3d11',
        '--enable-gpu-rasterization',
        '--hide-scrollbars',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        '--autoplay-policy=no-user-gesture-required',
        '--mute-audio',
        `--window-size=${W},${H}`,
        'about:blank',
      ],
      { stdout: 'ignore', stderr: 'ignore' },
    );
    let port = 0;
    for (let i = 0; i < CHROME_WAIT * 10 && port === 0; i++) {
      const f = join(profileDir, 'DevToolsActivePort');
      if (existsSync(f)) port = Number(readFileSync(f, 'utf8').split('\n')[0]) || 0;
      if (port === 0) await sleep(100);
    }
    if (port === 0) {
      last = `chrome did not open a DevTools port within ${CHROME_WAIT} s`;
    } else {
      try {
        return await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 60_000 });
      } catch (e) {
        last = `could not connect to Chrome on DevTools port ${port}: ${String((e as Error).message ?? e).split('\n')[0]}`;
      }
    }
    summary.notes.push(`chrome start ${tryNo}/${CHROME_TRIES} failed (${last})${tryNo < CHROME_TRIES ? ', starting it again' : ''}`);
    await closeChrome();
    if (tryNo < CHROME_TRIES) await sleep(2000 * tryNo);
  }
  throw new ChromeStartError(`${last} (${CHROME_TRIES} tries)`);
}

async function open(): Promise<{ browser: Browser; ctx: BrowserContext; page: Page }> {
  browser = await startChrome();
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, hasTouch: flag('touch', false), isMobile: flag('mobile', false) });
  for (const [needle, file] of SWAPS) {
    if (!existsSync(file)) throw new Error(`--swap: no such file ${file}`);
    await ctx.route((u) => u.href.includes(needle), (route) => route.fulfill({ path: file, headers: { 'content-type': file.endsWith('.glb') ? 'model/gltf-binary' : 'application/octet-stream', 'cache-control': 'no-store' } }));
  }
  // --content: the patch is on window before any page script runs (app/content.ts reads it at boot; DEV / VITE_QA_HOOKS builds only)
  if (CONTENT_PATCH) await ctx.addInitScript(`window.__MS_CONTENT_OVERRIDE__ = ${CONTENT_PATCH};`);
  const page = await ctx.newPage();
  page.setDefaultTimeout(TIMEOUT);
  page.on('console', (m) => {
    if (m.type() === 'warning' && flag('warnings', false)) (summary.consoleWarnings ??= []).push(m.text().slice(0, 600));
    if (CONTENT_PATCH && m.type() === 'info' && m.text().startsWith('[content] QA override applied')) overrideNote = m.text().slice(0, 1500);
    if (CONTENT_PATCH && m.type() === 'error' && /content override rejected/.test(m.text())) overrideReject?.(new ContentOverrideRejected(m.text().replace(/\s+at .*$/s, '').slice(0, 1500)));
    if (m.type() !== 'error') return;
    const t = m.text().slice(0, 600);
    summary.consoleErrors.push(t);
    // the zone scene survives a system that fails to build (terrain / liquid / trees missing): a module error there must
    // not produce a silently broken shot
    if (/\[zoneScene\]/.test(t) && MODULE_ERR.test(t)) flagDevError(t);
  });
  page.on('pageerror', (e) => {
    const t = String(e.stack ?? e).slice(0, 1200);
    summary.pageErrors.push(t);
    if (MODULE_ERR.test(t)) flagDevError(t);
  });
  page.on('response', (r) => {
    const st = r.status();
    if (st < 400) return;
    summary.consoleErrors.push(`HTTP ${st} ${r.url()}`);
    // a 5xx from the dev server itself (a module that does not transform or resolve): another lane is mid-edit
    if (st >= 500 && r.url().startsWith(BASE) && !r.url().startsWith(`${BASE}/api/`)) {
      void r
        .text()
        .catch(() => '')
        .then((body) => flagDevError(`HTTP ${st} ${r.url()} ${body.replace(/\s+/g, ' ').slice(0, 300)}`.trim()));
    }
  });
  return { browser, ctx, page };
}

/** the Vite error overlay (when HMR is on), checked at the points a capture waits */
async function checkOverlay(page: Page): Promise<void> {
  const txt = await page
    .evaluate(() => {
      const el = document.querySelector('vite-error-overlay') as (HTMLElement & { shadowRoot: ShadowRoot | null }) | null;
      if (!el) return '';
      const m = el.shadowRoot?.querySelector('.message')?.textContent ?? '';
      const f = el.shadowRoot?.querySelector('.file')?.textContent ?? '';
      return `Vite error overlay: ${m} ${f}`.trim();
    })
    .catch(() => '');
  if (txt) flagDevError(txt);
}

async function runEval(page: Page, code: string | undefined): Promise<void> {
  if (!code) return;
  const src = code.startsWith('@') ? readFileSync(code.slice(1), 'utf8') : code;
  // async IIFE so the snippet may use await + dynamic import('/src/...') (dev server modules)
  const r = await page.evaluate(`(async () => { ${src} })()`);
  if (r !== undefined) summary.notes.push(`eval: ${JSON.stringify(r).slice(0, 2000)}`);
}

// ---------------------------------------------------------------------------------------------------- modes
async function modeGame(page: Page): Promise<void> {
  const ui = str('ui', 'real'); // real (game HUD) | none (HUD hidden: clean world shot) | dev (dev panel)
  const q = str('quality', 'high');
  await guard(page.goto(withQuery(url(`/?quality=${q}${ui === 'dev' ? '&noui=1' : ''}`)), { waitUntil: 'load' }));
  await checkOverlay(page);
  await guard(page.waitForFunction(() => (window as any).__ms?.store, null, { polling: 250 }));
  if (opts.has('lang')) {
    await page.evaluate(async (lang) => {
      const m = await import('/src/engine/settings.ts' as string);
      m.settings.update({ language: lang });
    }, str('lang', 'en'));
  }
  const sel: Record<string, unknown> = { zone: str('zone', 'yeonmu'), classId: str('class', 'warrior'), doctrine: str('doctrine', 'a'), sex: str('sex', 'm') };
  if (opts.has('empire')) sel.empire = str('empire', '');
  if (opts.has('difficulty')) sel.difficulty = str('difficulty', 'normal');
  if (opts.has('tier')) sel.armorTier = num('tier', 0);
  const seed = opts.has('seed') ? num('seed', 1234) : 1234;
  // --still: deterministic world shots (regression baselines, tools/qa/zonecheck.ts). The frame loop is stopped BEFORE
  // the run starts and never restarted: the sim never ticks (world time 0, no enemies / pickups / casts), ambient VFX are
  // cleared, and every spot renders exactly --stillFrames frames of a fixed 1/60 s before its shot. The same spot list on
  // the same tree gives the same pixels (render time accumulates over the list, so keep the list identical).
  const still = flag('still', false);
  // window.__ms is published before boot() finishes; App.start() (menu screen + frame loop) comes last → wait for it, so
  // startRun / loop.stop() below never race the end of boot (a stop before start would leave the loop free-running)
  await guard(page.waitForFunction(() => (window as any).__ms?.loop?.isRunning === true, null, { polling: 100, timeout: 20_000 })).catch((e) => {
    if (e instanceof DevServerError) throw e;
    summary.notes.push('warning: the frame loop was not running 20 s after boot');
  });
  const tl = Date.now();
  await page.evaluate(
    ([s, sd, stl]) => {
      const w = window as any;
      const ms = w.__ms;
      if (stl) ms.loop.stop();
      // fixed PRNG while the run loads → the run seed and with it the scatter are identical between shots
      let st = (sd as number) >>> 0;
      w.__qaRand = Math.random;
      Math.random = () => {
        st = (st + 0x6d2b79f5) >>> 0;
        let t = st;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      ms.store.select(s);
      w.__qaStart = ms.startRun();
    },
    [sel, seed, still] as const,
  );
  await guard(
    page.waitForFunction(() => {
      const ms = (window as any).__ms;
      return ms.store.screen.value === 'run' || ms.store.loading.value.error;
    }, null, { polling: 500 }),
  );
  await page.evaluate(() => {
    const w = window as any;
    if (w.__qaRand) {
      Math.random = w.__qaRand;
      w.__qaRand = null;
    }
  });
  const err = await page.evaluate(() => (window as any).__ms.store.loading.value.error);
  if (err) {
    // "x is not defined" / a failed dynamic import while the run loads = a module another lane has not finished writing
    const msg = `run load error: ${err}`;
    throw MODULE_ERR.test(String(err)) ? new DevServerError(msg) : new Error(msg);
  }
  summary.notes.push(`run loaded in ${((Date.now() - tl) / 1000).toFixed(1)}s`);
  // keep the run going: dismiss the intro story, god mode (heal), auto-pick cards unless --autopick 0
  await page.evaluate(
    ([autopick, god]) => {
      const ms = (window as any).__ms;
      ms.store.dismissStory();
      (window as any).__qaTick = setInterval(() => {
        const p = ms.session?.world.players[0];
        if (god && p) p.hp = p.hpMax;
        const m = ms.store.modal.value;
        if (!m) return;
        if (m.kind === 'story') ms.store.dismissStory();
        else if (autopick && m.kind !== 'pause' && m.kind !== 'runEnd') ms.store.chooseCard(0);
      }, 150);
    },
    [flag('autopick', true), flag('god', true)] as const,
  );
  if (opts.has('time')) await page.evaluate((t) => ((window as any).__ms.session.world.time = t), num('time', 0));
  if (opts.has('grant')) {
    // "id:rank,id:rank" (rank 0..7 = 1,2,3,M1,M2,G1,G2,P)
    const grants = str('grant', '').split(',').filter(Boolean).map((g) => g.split(':')) as [string, string | undefined][];
    const r = await page.evaluate(async (gs) => {
      const ms = (window as any).__ms;
      const { addSkill } = await import('/src/sim/skills/index.ts' as string);
      const { ensureSkillVfx } = await import('/src/vfx/skills/loader.ts' as string);
      const w = ms.session.world;
      const p = w.players[0];
      const done: string[] = [];
      for (const [id, rank] of gs) {
        const def = w.content.skills.find((s: { id: string }) => s.id === id);
        if (!def) {
          done.push(`missing:${id}`);
          continue;
        }
        // the skill effects of another class are lazy chunks (vfx/skills/loader.ts): a run only loads its party's classes
        await ensureSkillVfx([def.classId]);
        const have = p.skills.find((s: { def: { id: string } }) => s.def.id === id);
        if (have) have.rank = Number(rank ?? have.rank);
        else addSkill(w, p, def, Number(rank ?? 0));
        done.push(id);
      }
      return done;
    }, grants);
    summary.notes.push(`granted ${r.join(',')}`);
  }
  if (opts.has('boss')) {
    await page.evaluate(async (id) => {
      const ms = (window as any).__ms;
      const { spawnBoss } = await import('/src/sim/bosses.ts' as string);
      const w = ms.session.world;
      const p = w.players[0];
      spawnBoss(w, id, false, p.x + 7, p.z + 5);
    }, str('boss', ''));
  }
  if (ui === 'none') await page.addStyleTag({ content: '#ui{display:none!important}' });
  if (still) {
    // the sim stays paused for good; the zone's ambient particle loop is random → cleared (VFX are not part of the zone look)
    await page.evaluate(() => {
      const ms = (window as any).__ms;
      ms.loop.paused = true;
      ms.renderWorld.vfx?.clear();
    });
  }
  await runEval(page, opts.get('eval'));
  if (opts.has('timescale')) await page.evaluate((s) => ((window as any).__ms.loop.timeScale = s), num('timescale', 1));
  const advance = still ? 0 : num('advance', 2.5);
  if (advance > 0) await sleep(advance * 1000);

  // --dummies N: N immortal, motionless enemies of the zone's first type in a ring around the hero (skills only cast when
  // an enemy is in range, and hits need something to land on). --dummyRadius m (default 3.5).
  if (opts.has('dummies')) {
    const n = num('dummies', 5);
    const rad = num('dummyRadius', 3.5);
    await page.evaluate(async ([count, r]) => {
      const ms = (window as any).__ms;
      const { spawnEnemy } = await import('/src/sim/enemies.ts' as string);
      const w = ms.session.world;
      const p = w.players[0];
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + 0.4;
        const row = spawnEnemy(w, 0, p.x + Math.sin(a) * r, p.z + Math.cos(a) * r, { speedMul: 0 });
        if (row >= 0) {
          w.enemies.hp[row] = w.enemies.hpMax[row] = 1e9;
          w.enemies.speed[row] = 0;
        }
      }
      // keep them immortal + parked: re-pin every 100 ms
      (window as any).__qaDummyTick = setInterval(() => {
        const e = w.enemies;
        for (let k = 0; k < e.count; k++) if (e.hpMax[k] >= 1e9) e.hp[k] = 1e9;
      }, 100);
    }, [n, rad] as const);
  }

  // --cast <skillId> --castTimes 0.3,0.7,1.2: for every time, fire a fresh cast (cooldown → 0, every other skill held on
  // cooldown so only this one shows), wait that many SIM seconds (timescale-aware), freeze, shoot, unfreeze.
  // Skills only fire with an enemy in range — add --dummies 5.
  if (opts.has('cast')) {
    const id = str('cast', '');
    const times = str('castTimes', '0.4,0.8,1.2').split(',').map(Number);
    if (opts.has('zoom')) await page.evaluate((z) => (window as any).__ms.core.rig.setZoom(z), num('zoom', 22));
    // --castStep: deterministic frame-stepped casts (loop stopped, advance(1/60) per frame so the sim AND the VFX clock both
    // advance exactly t seconds from the cast; the default wall-clock path above lets the VFX clock run ahead of the sim
    // while the page is paused / the screenshot is taken). Between casts the world is stepped 1.8 s with every skill held.
    const castStep = flag('castStep', false);
    if (castStep) await page.evaluate(() => (window as any).__ms.loop.stop());
    for (let ti = 0; ti < times.length; ti++) {
      const t = times[ti] as number;
      if (castStep) {
        const ok = await page.evaluate(([sid, tt, settle]) => {
          const ms = (window as any).__ms;
          const w = ms.session.world;
          w.qaForceTriggers = true; // context-gated skills (skill logic) still cast on their plain cooldown here
          const p = w.players[0];
          for (let i = 0; i < settle; i++) ms.loop.advance(1 / 60);
          let found = false;
          for (const s of p.skills) {
            if (s.def.id === sid) {
              s.cd = 0;
              found = true;
            } else s.cd = Math.max(s.cd, 30);
          }
          const t0 = w.time;
          for (let n = 0; n < 4000 && w.time - t0 < (tt as number) - 1e-6; n++) ms.loop.advance(1 / 60);
          return found;
        }, [id, t, ti === 0 ? 30 : 110] as const);
        if (!ok) throw new Error(`--cast ${id}: the hero does not have this skill (use --grant ${id}:<rank>)`);
        await frames(page, 2);
        await shoot(page, `${str('name', `cast_${id}`)}_t${t.toFixed(2)}`);
        continue;
      }
      const ok = await page.evaluate((sid) => {
        const ms = (window as any).__ms;
        ms.loop.paused = false;
        ms.session.world.qaForceTriggers = true; // context-gated skills (skill logic) still cast on their plain cooldown here
        const p = ms.session.world.players[0];
        let found = false;
        for (const s of p.skills) {
          if (s.def.id === sid) {
            s.cd = 0;
            found = true;
          } else s.cd = Math.max(s.cd, 30);
        }
        (window as any).__qaCastT0 = ms.session.world.time;
        return found;
      }, id);
      if (!ok) throw new Error(`--cast ${id}: the hero does not have this skill (use --grant ${id}:<rank>)`);
      await guard(
        page.waitForFunction((tt) => {
          const ms = (window as any).__ms;
          return ms.session.world.time - (window as any).__qaCastT0 >= tt;
        }, t, { polling: 'raf' }),
      );
      await page.evaluate(() => ((window as any).__ms.loop.paused = true));
      await frames(page, 2);
      await shoot(page, `${str('name', `cast_${id}`)}_t${t.toFixed(2)}`);
    }
    await page.evaluate(() => ((window as any).__ms.loop.paused = false));
    return;
  }

  // spots: "name:x,z[,zoom]" separated by ';' — teleport the hero, settle, shoot. No spots → one shot where we are.
  const spots = str('spots', '').split(';').map((s) => s.trim()).filter(Boolean);
  const settle = num('settle', 1.6) * 1000;
  const freeze = flag('freeze', false);
  if (still) {
    // fixed-dt hand-stepped frames (sim paused, loop stopped): teleport, zoom (spot zoom or --zoom, default 22), snap
    const stillFrames = Math.max(2, Math.round(num('stillFrames', 24)));
    const list = spots.length ? spots : [`${str('name', 'game')}:NaN,NaN`];
    const times: string[] = [];
    for (const spot of list) {
      const [name, coords] = spot.includes(':') ? (spot.split(':') as [string, string]) : [`at_${spot.replace(/[^0-9-]+/g, '_')}`, spot];
      const [x, z, zoom] = coords.split(',').map(Number) as [number, number, number | undefined];
      const st = await page.evaluate(
        async ([xx, zz, zm, n]) => {
          const ms = (window as any).__ms;
          if (ms.loop.isRunning) ms.loop.stop();
          const p = ms.session.world.players[0];
          if (Number.isFinite(xx) && Number.isFinite(zz)) {
            p.x = p.px = xx;
            p.z = p.pz = zz;
          }
          ms.core.rig.setZoom(zm);
          ms.core.rig.snap();
          for (let i = 0; i < n; i++) {
            await new Promise((r) => requestAnimationFrame(() => r(null)));
            ms.loop.advance(1 / 60);
          }
          const { worldUniforms } = await import('/src/render/terrain/zoneContext.ts' as string);
          return { running: ms.loop.isRunning as boolean, t: worldUniforms.uTime.value as number, wt: ms.session.world.time as number };
        },
        [x, z, zoom || num('zoom', 22), stillFrames] as const,
      );
      if (st.running || st.wt !== 0) throw new Error(`--still broke: loop running ${st.running}, sim time ${st.wt} at ${name}`);
      times.push(`${name}@${st.t.toFixed(4)}`);
      await shoot(page, name);
    }
    summary.notes.push(`still render times ${times.join(' ')}`);
  } else if (spots.length === 0) {
    if (opts.has('zoom')) await page.evaluate((z) => (window as any).__ms.core.rig.setZoom(z), num('zoom', 22));
    if (freeze) await page.evaluate(() => ((window as any).__ms.loop.paused = true));
    await frames(page, 3);
    await shoot(page, str('name', 'game'));
  }
  for (const spot of still ? [] : spots) {
    const [name, coords] = spot.includes(':') ? (spot.split(':') as [string, string]) : [`at_${spot.replace(/[^0-9-]+/g, '_')}`, spot];
    const [x, z, zoom] = coords.split(',').map(Number) as [number, number, number | undefined];
    await page.evaluate(
      ([xx, zz, zm]) => {
        const ms = (window as any).__ms;
        ms.loop.paused = false;
        const p = ms.session.world.players[0];
        p.x = p.px = xx;
        p.z = p.pz = zz;
        if (zm) ms.core.rig.setZoom(zm);
        ms.core.rig.snap();
      },
      [x, z, zoom ?? 0] as const,
    );
    await sleep(settle);
    if (freeze) await page.evaluate(() => ((window as any).__ms.loop.paused = true));
    await frames(page, 3);
    await shoot(page, name);
    if (zoom) await page.evaluate((z) => (window as any).__ms.core.rig.setZoom(z), num('zoom', 22));
  }
  const stats = await page.evaluate(() => {
    const ms = (window as any).__ms;
    const w = ms.session?.world;
    const info = ms.core.renderer.info;
    return { fps: ms.store.fps?.value, enemies: w?.enemies.count, calls: info.render.calls, tris: info.render.triangles, time: w?.time };
  });
  summary.notes.push(`stats ${JSON.stringify(stats)}`);
}

async function modeUi(page: Page): Promise<void> {
  const screens = str('screens', str('screen', 'menu')).split(',').filter(Boolean);
  const lang = str('lang', 'en');
  const extra = `${opts.has('class') ? `&class=${str('class', 'warrior')}` : ''}${opts.has('doctrine') ? `&doctrine=${str('doctrine', 'a')}` : ''}`;
  await guard(page.goto(withQuery(url(`/?ui=gallery&screen=${screens[0]}&bare=1&lang=${lang}${extra}`)), { waitUntil: 'load' }));
  await checkOverlay(page);
  await guard(page.waitForFunction(() => (window as any).__ui, null, { polling: 250 }));
  const delay = num('delay', 1.2) * 1000;
  for (const s of screens) {
    await page.evaluate((id) => (window as any).__ui.apply(id), s);
    await runEval(page, opts.get('eval'));
    await page.evaluate(() => document.fonts.ready);
    await sleep(delay);
    await shoot(page, `${s}_${lang}_${W}x${H}`);
  }
}

async function modeVfx(page: Page): Promise<void> {
  const ids = str('ids', '');
  const t = num('t', 0.5);
  const q = `ids=${encodeURIComponent(ids)}&cols=${num('cols', Math.min(4, ids.split(',').length))}&rows=${num('rows', Math.ceil(ids.split(',').length / 4))}&q=${str('q', 'high')}&dpr=${DPR}&bloom=${str('bloom', '0.55')}${opts.has('zoom') ? `&zoom=${num('zoom', 20)}` : ''}${opts.has('cat') ? `&cat=${str('cat', 'hit')}` : ''}`;
  await guard(page.goto(withQuery(url(`/vfx.html?${q}`)), { waitUntil: 'load' }));
  await checkOverlay(page);
  await guard(page.waitForFunction(() => (window as any).__vfxReady === true, null, { polling: 250 }));
  await runEval(page, opts.get('eval'));
  const times = str('times', String(t)).split(',').map(Number);
  await page.evaluate(() => {
    const g = (window as any).__gallery;
    g.setPaused(true);
    g.vfx?.clear?.(); // drop the instance the gallery spawned live before the pause, so a capture holds exactly one
    g.respawn();
  });
  let at = 0;
  for (const tt of times) {
    await page.evaluate((d) => (window as any).__gallery.advance(d), Math.max(0, tt - at));
    at = tt;
    await frames(page, 2);
    await shoot(page, times.length > 1 ? `${str('name', 'vfx')}_t${tt.toFixed(2)}` : opts.get('name'));
  }
  const errs = await page.evaluate(() => (window as any).__gallery.errors);
  if (Array.isArray(errs) && errs.length) summary.notes.push(`gallery errors: ${JSON.stringify(errs).slice(0, 1500)}`);
}

async function modeUrl(page: Page): Promise<void> {
  await guard(page.goto(withQuery(url(str('url', '/'))), { waitUntil: 'load' }));
  await checkOverlay(page);
  if (opts.has('wait')) await guard(page.waitForFunction(str('wait', 'true'), null, { polling: 250 }));
  await runEval(page, opts.get('eval'));
  await sleep(num('delay', 1) * 1000);
  await frames(page, 3);
  await shoot(page, opts.get('name'));
}

// ------------------------------------------------------------------------------------------------------- main
// One attempt = Chrome + one run of the mode. A dev-server module error (flagged by the watch above, or thrown by the
// game's run loader) drops the attempt, releases the Chrome slot, waits and tries again (RETRIES more times); anything
// else fails at once. Files written by an abandoned attempt are rewritten by the next one.
async function runMode(): Promise<void> {
  const o = await open();
  if (mode === 'game') await modeGame(o.page);
  else if (mode === 'ui') await modeUi(o.page);
  else if (mode === 'vfx') await modeVfx(o.page);
  else if (mode === 'url') await modeUrl(o.page);
  else throw new Error(`unknown mode ${mode} (game | ui | vfx | url)`);
}

let release = await acquireSlot(`shot:${mode}`);
const attempts = RETRIES + 1;
try {
  for (let a = 1; a <= attempts; a++) {
    resetDevWatch();
    resetOverrideWatch();
    summary.files.length = 0;
    summary.consoleErrors.length = 0;
    summary.pageErrors.length = 0;
    if (summary.consoleWarnings) summary.consoleWarnings.length = 0;
    try {
      await runMode();
      const late = devErr as DevServerError | null; // flagged while the last shot was taken
      if (late) throw late;
      if (CONTENT_PATCH) {
        summary.notes.push(
          overrideNote ||
            'WARNING: --content was given but the page never logged "[content] QA override applied": the build ignores it (only the dev server and VITE_QA_HOOKS=1 builds read window.__MS_CONTENT_OVERRIDE__), or this mode does not load the game content',
        );
      }
      break;
    } catch (e) {
      const dev = (devErr as DevServerError | null) ?? (e instanceof DevServerError ? e : null);
      if (dev && a < attempts) {
        const wait = Math.min(90, RETRY_WAIT * Math.pow(1.6, a - 1));
        summary.notes.push(`attempt ${a}/${attempts}: dev-server module error, waiting ${wait.toFixed(0)} s for the other lane to finish: ${dev.message.slice(0, 300)}`);
        await closeChrome();
        release();
        await sleep(wait * 1000);
        release = await acquireSlot(`shot:${mode}`);
        continue;
      }
      if (dev) {
        summary.notes.push(
          `FAILED: dev-server module error that did not clear in ${attempts} attempt(s): ${dev.message}\n` +
            'The page broke on a module that another agent is still editing (HTTP 5xx / Vite overlay / "x is not defined"), or on a bug in your own edit: open the dev server in a browser, fix or wait, and run again (--retries N, --retryWait s).',
        );
        (summary as unknown as Record<string, unknown>).devServerError = true;
      } else if (e instanceof ContentOverrideRejected) {
        summary.notes.push(`FAILED: the game refused the --content override (nothing was captured with it): ${e.message}`);
      } else if (e instanceof ChromeStartError) {
        summary.notes.push(`FAILED: ${e.message}. The machine is overloaded or Chrome is broken: try again later (--chromeTries N, --chromeWait s).`);
      } else {
        summary.notes.push(`FAILED: ${String((e as Error).stack ?? e).slice(0, 2000)}`);
      }
      process.exitCode = 2;
      break;
    }
  }
} finally {
  await closeChrome();
  release();
  summary.ms = Date.now() - t0;
  console.log(JSON.stringify(summary, null, 1));
}
