#!/usr/bin/env bun
// Game-camera VFX stage (dev only, never shipped): the REAL game — zone ground, lighting, post, hero model — at the game
// camera (55° pitch, zoom 22, 1920×1080, DPR 1). The sim never ticks (loop stopped before the run starts, like
// `shot.ts game --still`), so frames are deterministic: effects are spawned through `window.__ms.vfx` (vfx/dev/stage.ts)
// and VFX time is stepped by hand to each sample time.
//

//   bun tools/qa/vfxstage.ts --event '{"t":"pickup","kind":4,"tier":0}' --zone seori --times 0.2 --base --out ...
//
// Options: --class warrior|ninja|yacha|shaman|wolfman  --sex m|f  --quality low|medium|high|ultra  --zoom 22
//          --at "dx,dz"     spawn offset from the hero (default "2.5,0"; +x = screen right, +z = towards the camera)
//          --spacing 4      several --ids side by side along x (centred on --at)
//          --opts '{...}'   extra SpawnOpts for every spawn (scale, element, color, duration, dirX/dirZ, y, a, b, ...)
//          --event '{...}'  feed a synthetic sim event through the EventAdapter route instead of --ids (x/z default to
//                           the hero + --at); repeatable with ';' between JSON objects
//          --base           also shoot the frame right before the spawn (base.png) → coverage numbers:
//                           python tools/qa/vfxmetrics.py coverage --a base.png --b <shot>.png
//          --ambient        keep the zone's ambient particle loop (default: cleared, so coverage measures the effect)
//          --hud            keep the HUD (default hidden)
//          --legacyKit      draw with the pre-C4 kit (A/B of the soft rings / pillars / flash clamp)
//          --name stage     file prefix;  --w/--h/--dpr viewport (default 1920/1080/1)
// Output: <out>/<name>_t<time>.png (+ base.png), JSON summary on stdout (console errors, vfx stats per shot).
import { chromium, type Browser, type Page } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { acquireSlot } from './slots';

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
const num = (k: string, d: number): number => (opts.has(k) ? Number(opts.get(k)) : d);
const flag = (k: string): boolean => opts.has(k) && opts.get(k) !== '0' && opts.get(k) !== 'false';

const OUT = str('out', '');
if (!OUT || (!opts.has('ids') && !opts.has('event'))) {
  console.log(readFileSync(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'utf8').split('\nimport ')[0]);
  process.exit(1);
}
const BASE = str('base-url', process.env.MS_QA_BASE ?? 'http://127.0.0.1:5183').replace(/\/$/, '');
const W = num('w', 1920);
const H = num('h', 1080);
const DPR = num('dpr', 1);
const NAME = str('name', 'stage');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => existsSync(p));
if (!CHROME) throw new Error('no Chrome / Edge found');

const summary = { mode: 'vfxstage', files: [] as string[], consoleErrors: [] as string[], pageErrors: [] as string[], notes: [] as string[], shots: [] as unknown[], ms: 0 };
const t0 = Date.now();
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
mkdirSync(resolve(OUT), { recursive: true });

async function shoot(page: Page, name: string): Promise<void> {
  const p = join(resolve(OUT), `${name}.png`);
  await page.screenshot({ path: p, type: 'png', caret: 'hide', timeout: 120_000 });
  summary.files.push(p);
  const s = await page.evaluate(() => {
    const st = (window as any).__ms.vfx;
    const v = st.stats();
    const live = (st.system.insts as { active: boolean; def: { id: string } | null; age: number }[]).filter((i) => i.active).map((i) => `${i.def?.id}@${i.age.toFixed(2)}`);
    // art = the run's generated-sprite array (layers / layer edge px / cell px / MB / sprites): scope + budget check
    const a = st.system.artStats?.();
    const art = a ? { layers: a.layers, size: a.size, cell: a.cell, mb: Number((a.bytes / 1048576).toFixed(1)), sprites: a.sprites, ms: Number(a.ms.toFixed(1)) } : null;
    return { drawCalls: v.drawCalls, particles: v.particles, shapes: v.shapes, loops: v.loops, liveLoops: live, specActive: v.specActive, cpuMs: Number(v.cpuMs.toFixed(3)), art };
  });
  summary.shots.push({ name, ...s });
}

let chromeProc: ReturnType<typeof Bun.spawn> | null = null;
let profileDir = '';
let browser: Browser | null = null;
const release = await acquireSlot('vfxstage');
try {
  profileDir = join(tmpdir(), `ms-qa-stage-${process.pid}-${Date.now()}`);
  mkdirSync(profileDir, { recursive: true });
  chromeProc = Bun.spawn(
    [CHROME, ...(flag('headful') ? [] : ['--headless=new']), '--remote-debugging-port=0', `--user-data-dir=${profileDir}`, '--no-first-run',
      '--no-default-browser-check', '--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=d3d11', '--enable-gpu-rasterization', '--hide-scrollbars',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--mute-audio',
      `--window-size=${W},${H}`, 'about:blank'],
    { stdout: 'ignore', stderr: 'ignore' },
  );
  let port = 0;
  for (let i = 0; i < 300 && port === 0; i++) {
    const f = join(profileDir, 'DevToolsActivePort');
    if (existsSync(f)) port = Number(readFileSync(f, 'utf8').split('\n')[0]) || 0;
    if (port === 0) await sleep(100);
  }
  if (port === 0) throw new Error('chrome did not open a DevTools port');
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 60_000 });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
  const page = await ctx.newPage();
  page.setDefaultTimeout(num('timeout', 240) * 1000);
  page.on('console', (m) => {
    if (m.type() === 'error') summary.consoleErrors.push(m.text().slice(0, 600));
  });
  page.on('pageerror', (e) => summary.pageErrors.push(String(e.stack ?? e).slice(0, 1200)));

  await page.goto(`${BASE}/?quality=${str('quality', 'high')}`, { waitUntil: 'load' });
  // wait until boot() has started the app loop (window.__ms is published before app.start(): stopping earlier races)
  await page.waitForFunction(() => (window as any).__ms?.store && (window as any).__ms.loop.isRunning, null, { polling: 250 });
  const sel ={ zone: str('zone', 'yeonmu'), classId: str('class', 'warrior'), doctrine: str('doctrine', 'a'), sex: str('sex', 'm') };
  // loop stopped BEFORE the run starts: the sim never ticks (no enemies, world time 0); seeded Math.random while loading
  await page.evaluate((s) => {
    const w = window as any;
    const ms = w.__ms;
    ms.loop.stop();
    let st = 1234 >>> 0;
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
  }, sel);
  await page.waitForFunction(() => {
    const ms = (window as any).__ms;
    return ms.store.screen.value === 'run' || ms.store.loading.value.error;
  }, null, { polling: 500 });
  const err = await page.evaluate(() => {
    const w = window as any;
    if (w.__qaRand) Math.random = w.__qaRand;
    w.__ms.store.dismissStory?.();
    w.__ms.loop.paused = true;
    return w.__ms.store.loading.value.error;
  });
  if (err) throw new Error(`run load error: ${err}`);
  if (!flag('hud')) await page.addStyleTag({ content: '#ui{display:none!important}' });
  await page.waitForFunction(() => (window as any).__ms?.vfx?.spawnNow, null, { polling: 100, timeout: 30_000 });
  // --legacyKit: A/B against the pre-C4 kit (thin rings, capped pillars, unclamped flashes)
  if (flag('legacyKit')) await page.evaluate(() => ((window as any).__ms.vfx.system.fx.legacyKit = true));
  // settle: fixed-dt frames at the game camera (terrain streaming, hero pose, rig)
  await page.evaluate(async ([zoom, frames, keepAmbient]) => {
    const ms = (window as any).__ms;
    ms.core.rig.setZoom(zoom);
    ms.core.rig.snap();
    for (let i = 0; i < frames; i++) {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      ms.loop.advance(1 / 60);
    }
    if (!keepAmbient) ms.vfx.clear();
    ms.vfx.step(0);
  }, [num('zoom', 22), Math.max(2, num('settleFrames', 30)), flag('ambient')] as const);
  if (flag('base')) await shoot(page, 'base');

  const at = str('at', '2.5,0').split(',').map(Number) as [number, number];
  const extra = JSON.parse(str('opts', '{}')) as Record<string, unknown>;
  if (opts.has('event')) {
    const events = str('event', '').split(';').filter(Boolean).map((j) => JSON.parse(j) as Record<string, unknown>);
    await page.evaluate(([evs, dx, dz]) => {
      for (const e of evs) (window as any).__ms.vfx.event({ dx, dz, ...e });
    }, [events, at[0], at[1]] as const);
    summary.notes.push(`events ${JSON.stringify(events)}`);
  } else {
    const ids = str('ids', '').split(',').filter(Boolean);
    const spacing = num('spacing', 4);
    const handles = await page.evaluate(([list, dx, dz, sp, o]) => {
      const st = (window as any).__ms.vfx;
      return list.map((id: string, i: number) => {
        const known = st.system.has(id);
        const h = st.spawnNow(id, { ...o, dx: dx + (i - (list.length - 1) / 2) * sp, dz });
        return { id, known, handle: h };
      });
    }, [ids, at[0], at[1], spacing, extra] as const);
    for (const h of handles) if (!h.known) summary.notes.push(`UNKNOWN preset id: ${h.id}`);
    summary.notes.push(`spawned ${JSON.stringify(handles)}`);
  }
  const times = str('times', '0.3').split(',').map(Number).sort((a, b) => a - b);
  let now = 0;
  for (const t of times) {
    await page.evaluate((d) => (window as any).__ms.vfx.step(d), Math.max(0, t - now));
    now = t;
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    await shoot(page, `${NAME}_t${t.toFixed(2)}`);
  }
} catch (e) {
  summary.notes.push(`FAILED: ${String((e as Error).stack ?? e).slice(0, 2000)}`);
  process.exitCode = 2;
} finally {
  try {
    await browser?.close();
  } catch {
    /* closed */
  }
  try {
    chromeProc?.kill();
    await chromeProc?.exited;
  } catch {
    /* gone */
  }
  for (let i = 0; i < 10; i++) {
    try {
      rmSync(profileDir, { recursive: true, force: true });
      break;
    } catch {
      await sleep(300);
    }
  }
  release();
  summary.ms = Date.now() - t0;
  console.log(JSON.stringify(summary, null, 1));
}
