#!/usr/bin/env bun
// Batch runner for the UI probe snippets in this folder (dev only, never shipped). Same Chrome slot pool as shot.ts.
//
//   bun tools/qa/probes/run.ts --probes domfp,fontsize --screens menu,levelUp --vp 1920x1080,390x844@3t,844x390@2t \

//
//   --screens  comma list | @file (comma/newline list) | all (every GALLERY_SCENARIOS id, in registry order)
//   --vp       WxH[@dpr][t]   t = touch + mobile (phone emulation, like shot.ts --touch --mobile)
//   --seed     Math.random is replaced by a seeded PRNG from page start and re-seeded (seed ^ hash(screen id)) before each
//              screen, so EmberField / tips / motes are identical between two runs (default 1; --seed 0 keeps Math.random)
//   --fresh    reload the gallery for every screen (order-independent results; slower). Default: one page per viewport,
//              screens applied in the given order (gallery state carries over exactly like shot.ts ui)
//   --opts     JSON assigned to window.__probeOpts before every probe (each probe documents its options)
//   --before   <dir>: serve the .css files found under <dir> (a fix part's start/ folder, laid out like the repo: <dir>/apps/game/src/...) instead of the live
//              ones, by rewriting the dev server's CSS responses: a BEFORE capture of a CSS fix without touching the shared tree (blind before / after pairs).
//   --insets   simulate device insets on .ms-ui (--safe-t/-r/-b/-l): "auto" (or no value) = portrait t47 b34, landscape r47 b21 l47 (iPhone with Face ID),
//              or "t,r,b,l" in px. The scenario is applied AGAIN after the insets are set (JS-placed widgets such as the HUD edge arrows are laid
//              out on every render), the probes run with the insets ON, and a --shots capture paints the unsafe bands as a red hatch.
//
// Writes { args, results: { "<vp>": { "<screen>": { "<probe>": result | { error } } } }, consoleErrors, pageErrors, ms }.
// Probe files are bodies of an async function (they also work as `shot.ts --eval @tools/qa/probes/<name>.js`).
import { chromium, type Browser, type Page } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { acquireSlot } from '../slots';

const argv = process.argv.slice(2);
const opts = new Map<string, string>();
for (let i = 0; i < argv.length; i++) {
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
const HERE = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const BASE = str('base', process.env.MS_QA_BASE ?? 'http://127.0.0.1:5183').replace(/\/$/, '');
const OUT = str('out', '');
if (!OUT || !opts.has('probes')) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 22).join('\n').replace(/^\/\/ ?/gm, ''));
  process.exit(OUT ? 1 : 0);
}
const LANG = str('lang', 'en');
const SEED = Number(str('seed', '1'));
const FRESH = opts.has('fresh');
const PROBE_OPTS = opts.has('opts') ? (JSON.parse(str('opts', '{}')) as Record<string, unknown>) : {};
const SHOTS = opts.has('shots') ? resolve(str('shots', '')) : '';
// --insets: simulated device insets (CSS px) for the --safe-t/-r/-b/-l tokens of .ms-ui. auto = an iPhone with Face ID: portrait 47 / 0 / 34 / 0, landscape 0 / 47 / 21 / 47
// (the numbers of the 2026-10-22 phone gate); "t,r,b,l" = explicit.
interface Insets {
  t: number;
  r: number;
  b: number;
  l: number;
}
// --before: the CSS files of <dir> that differ from the live tree (rel = path inside the repo)
const BEFORE = opts.has('before') ? resolve(str('before', '')) : '';
const REPO = resolve(HERE, '../../..');
const beforeSwaps: { rel: string; live: string; start: string; hits: number }[] = [];
if (BEFORE) {
  if (!existsSync(BEFORE)) throw new Error(`--before ${BEFORE}: no such folder`);
  for (const f of readdirSync(BEFORE, { recursive: true }) as string[]) {
    if (!/\.css$/i.test(f)) continue;
    const livePath = join(REPO, f);
    if (!existsSync(livePath)) continue;
    const live = readFileSync(livePath, 'utf8');
    const start = readFileSync(join(BEFORE, f), 'utf8');
    if (live !== start) beforeSwaps.push({ rel: f.split('\\').join('/'), live, start, hits: 0 });
  }
}
const INSETS_ARG = (opts.get('insets') ?? '').trim().toLowerCase();
const AUTO_INSETS = INSETS_ARG === '1' || INSETS_ARG === 'auto' || INSETS_ARG === 'true';
const FIXED_INSETS: Insets | null = (() => {
  if (!INSETS_ARG || AUTO_INSETS) return null;
  const n = INSETS_ARG.split(',').map((s) => Number(s.trim()));
  if (n.length !== 4 || n.some((v) => !Number.isFinite(v) || v < 0)) throw new Error(`bad --insets ${INSETS_ARG} (auto | t,r,b,l in px)`);
  return { t: n[0] as number, r: n[1] as number, b: n[2] as number, l: n[3] as number };
})();
const insetsFor = (w: number, h: number): Insets | null => (FIXED_INSETS ? FIXED_INSETS : AUTO_INSETS ? (h > w ? { t: 47, r: 0, b: 34, l: 0 } : { t: 0, r: 47, b: 21, l: 47 }) : null);

const probes = str('probes', '')
  .split(',')
  .map((p) => p.trim())
  .filter(Boolean)
  .map((p) => {
    const file = p.endsWith('.js') ? resolve(p) : join(HERE, `${p}.js`);
    return { name: p.replace(/^.*[\\/]/, '').replace(/\.js$/, ''), src: readFileSync(file, 'utf8') };
  });

interface Vp {
  key: string;
  w: number;
  h: number;
  dpr: number;
  touch: boolean;
}
const vps: Vp[] = str('vp', '1920x1080')
  .split(',')
  .map((s) => {
    const m = /^(\d+)x(\d+)(?:@([\d.]+))?(t)?$/.exec(s.trim());
    if (!m) throw new Error(`bad --vp ${s} (WxH[@dpr][t])`);
    return { key: s.trim(), w: Number(m[1]), h: Number(m[2]), dpr: Number(m[3] ?? 1), touch: m[4] === 't' };
  });

let screensArg = str('screens', 'menu');
if (screensArg.startsWith('@')) screensArg = readFileSync(screensArg.slice(1), 'utf8');
let screens = screensArg
  .split(/[\s,]+/)
  .map((s) => s.trim())
  .filter(Boolean);

const fnv = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

// seeded Math.random from page start; window.__qaSeed(s) re-seeds (mulberry32)
const SEED_SCRIPT = `(() => {
  let st = ${SEED >>> 0};
  Math.random = () => { st = (st + 0x6d2b79f5) >>> 0; let t = st; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  window.__qaSeed = (s) => { st = s >>> 0; };
})();`;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => existsSync(p));
if (!CHROME) throw new Error('no Chrome / Edge found');

const report = {
  args: {
    probes: probes.map((p) => p.name),
    screens,
    vps: vps.map((v) => v.key),
    lang: LANG,
    seed: SEED,
    fresh: FRESH,
    opts: PROBE_OPTS,
    insets: Object.fromEntries(vps.map((v) => [v.key, insetsFor(v.w, v.h)])),
    before: beforeSwaps.map((s) => s.rel),
  },
  results: {} as Record<string, Record<string, Record<string, unknown>>>,
  consoleErrors: [] as string[],
  pageErrors: [] as string[],
  ms: 0,
};
const t0 = Date.now();

async function launch(): Promise<{ browser: Browser; proc: ReturnType<typeof Bun.spawn>; profile: string }> {
  const profile = join(tmpdir(), `ms-probe-${process.pid}-${Date.now()}`);
  mkdirSync(profile, { recursive: true });
  const proc = Bun.spawn(
    [CHROME as string, '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=d3d11', '--hide-scrollbars', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--mute-audio', 'about:blank'],
    { stdout: 'ignore', stderr: 'ignore' },
  );
  let port = 0;
  for (let i = 0; i < 300 && port === 0; i++) {
    const f = join(profile, 'DevToolsActivePort');
    if (existsSync(f)) port = Number(readFileSync(f, 'utf8').split('\n')[0]) || 0;
    if (port === 0) await sleep(100);
  }
  if (port === 0) throw new Error('chrome did not open a DevTools port');
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 60_000 });
  return { browser, proc, profile };
}

async function openGallery(browser: Browser, vp: Vp, first: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: vp.dpr, hasTouch: vp.touch, isMobile: vp.touch });
  if (SEED !== 0) await ctx.addInitScript(SEED_SCRIPT);
  if (BEFORE) {
    // (installed even when no file differs: a route turns the browser cache off, so a pass-through run is the fair AFTER side of a before / after pair)
    // the dev server answers a CSS import with a JS module holding the sheet as a JSON string (a sheet that is @imported by another one is inlined there):
    // swap each changed file's live text for its start text inside that string (JSON-escaped on both sides)
    await ctx.route(/\/src\/.*\.css(\?.*)?$/, async (route) => {
      const resp = await route.fetch();
      let body = await resp.text();
      for (const s of beforeSwaps) {
        const a = JSON.stringify(s.live).slice(1, -1);
        if (!body.includes(a)) continue;
        body = body.replace(a, () => JSON.stringify(s.start).slice(1, -1));
        s.hits++;
      }
      await route.fulfill({ response: resp, body });
    });
  }
  const page = await ctx.newPage();
  page.setDefaultTimeout(240_000);
  page.on('console', (m) => {
    if (m.type() === 'error') report.consoleErrors.push(`[${vp.key}] ${m.text().slice(0, 400)}`);
  });
  page.on('pageerror', (e) => report.pageErrors.push(`[${vp.key}] ${String(e.stack ?? e).slice(0, 800)}`));
  await page.goto(`${BASE}/?ui=gallery&screen=${encodeURIComponent(first)}&bare=1&lang=${LANG}`, { waitUntil: 'load' });
  await page.waitForFunction(() => (window as any).__ui, null, { polling: 250 });
  return page;
}

// red hatch over the unsafe bands of the simulated insets (screenshots only)
const paintBands = (v: Insets): void => {
  const ov = document.createElement('div');
  ov.id = '__qa_bands';
  ov.setAttribute('aria-hidden', 'true');
  ov.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
  const band = (css: string): void => {
    const d = document.createElement('div');
    d.style.cssText = `position:absolute;background:repeating-linear-gradient(45deg,rgba(255,40,40,.28) 0 6px,rgba(255,40,40,.12) 6px 12px);${css}`;
    ov.appendChild(d);
  };
  if (v.t) band(`left:0;right:0;top:0;height:${v.t}px`);
  if (v.b) band(`left:0;right:0;bottom:0;height:${v.b}px`);
  if (v.l) band(`left:0;top:0;bottom:0;width:${v.l}px`);
  if (v.r) band(`right:0;top:0;bottom:0;width:${v.r}px`);
  document.body.appendChild(ov);
};

const release = await acquireSlot('probes');
let chrome: Awaited<ReturnType<typeof launch>> | null = null;
try {
  chrome = await launch();
  for (const vp of vps) {
    const res: Record<string, Record<string, unknown>> = {};
    report.results[vp.key] = res;
    const ins = insetsFor(vp.w, vp.h);
    let page: Page | null = null;
    if (screens.length === 1 && screens[0] === 'all') {
      page = await openGallery(chrome.browser, vp, 'menu');
      screens = (await page.evaluate(async () => (await import('/src/ui/gallery.ts' as string)).GALLERY_SCENARIOS.map((s: { id: string }) => s.id))) as string[];
      report.args.screens = screens;
    }
    for (const id of screens) {
      if (FRESH || !page) {
        if (page && FRESH) await page.context().close();
        page = await openGallery(chrome.browser, vp, id);
      }
      const out: Record<string, unknown> = {};
      try {
        const applyArgs = [id, SEED !== 0 ? (SEED ^ fnv(id)) >>> 0 : 0] as const;
        const applyScreen = ([sid, seed]: readonly [string, number]): void => {
          const w = window as any;
          if (typeof w.__qaSeed === 'function' && seed) w.__qaSeed(seed);
          w.__ui.apply(sid);
        };
        await page.evaluate(applyScreen, applyArgs);
        if (ins) {
          // insets on, then the scenario AGAIN: JS-placed widgets (the HUD edge arrows are placed on every render from the [data-block] rects) are
          // laid out with the insets present, as on a device; a static scenario would keep the placement of the inset-free first render
          const set = await page.evaluate(async (v) => {
            const ui = document.querySelector('.ms-ui') as HTMLElement | null;
            if (!ui) return false;
            for (const k of ['t', 'r', 'b', 'l'] as const) ui.style.setProperty(`--safe-${k}`, `${v[k]}px`);
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
            return true;
          }, ins);
          if (!set) throw new Error('--insets: no .ms-ui on the page');
          await page.evaluate(applyScreen, applyArgs);
          await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        }
        for (const p of probes) {
          try {
            await page.evaluate((o) => ((window as any).__probeOpts = o), PROBE_OPTS);
            out[p.name] = await page.evaluate(`(async () => { ${p.src}\n })()`);
          } catch (e) {
            out[p.name] = { error: String((e as Error).message ?? e).slice(0, 600) };
          }
        }
        if (SHOTS) {
          mkdirSync(SHOTS, { recursive: true });
          // with insets: the unsafe bands (notch / home indicator / side cut-outs) as a red hatch, added after the probes ran and removed again
          if (ins) await page.evaluate(paintBands, ins);
          try {
            await page.screenshot({ path: join(SHOTS, `${id}_${LANG}_${vp.w}x${vp.h}.png`), type: 'png', animations: 'allow', caret: 'hide' });
          } finally {
            if (ins) await page.evaluate(() => document.getElementById('__qa_bands')?.remove());
          }
        }
      } catch (e) {
        out.error = String((e as Error).message ?? e).slice(0, 600);
      }
      res[id] = out;
      process.stderr.write(`[probes] ${vp.key} ${id}\n`);
    }
    if (page) await page.context().close();
  }
} finally {
  try {
    await chrome?.browser.close();
  } catch {
    /* closed */
  }
  try {
    chrome?.proc.kill();
    await chrome?.proc.exited;
  } catch {
    /* gone */
  }
  for (let i = 0; i < 10 && chrome; i++) {
    try {
      rmSync(chrome.profile, { recursive: true, force: true });
      break;
    } catch {
      await sleep(300);
    }
  }
  release();
  report.ms = Date.now() - t0;
  for (const s of beforeSwaps) if (s.hits === 0) process.stderr.write(`[probes] --before: ${s.rel} was never found in a CSS response (the capture shows the LIVE file)
`);
  mkdirSync(dirname(resolve(OUT)), { recursive: true });
  writeFileSync(resolve(OUT), JSON.stringify(report, null, 1));
  console.log(`[probes] wrote ${resolve(OUT)} (${Math.round(report.ms / 1000)}s, ${report.consoleErrors.length} console errors, ${report.pageErrors.length} page errors)`);
}
