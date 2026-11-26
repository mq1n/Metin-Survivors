#!/usr/bin/env bun
// Payload gate (ARCHITECTURE §11: menu < 6 MB, zone < 20 MB since 2026-11-07, 13 MB soft target) on a PRODUCTION build. Serves the dist folder on a random
// localhost port (no cache), drives system Chrome through playwright-core (machine-wide Chrome slot, tools/qa/slots.ts)
// and walks one session: cold load → main menu → idle → Play (first gesture) → hero select → zone select → Start → HUD.
//
//   cd apps/game && MS_STRICT_ASSETS=1 bunx vite build --outDir <dir> --emptyOutDir

//                           [--class warrior|ninja|yacha|shaman|wolfman] [--zone yeonmu|suryeon|seori|daeryeol]
//
// --url <base>  walk a server that is already running (wrangler pages dev, a preview) instead of serving --dist; --dist is then
//               only read for file sizes and must be the folder that server serves.
// --class / --zone  the hero card and the zone card the walk picks (default: warrior, yeonmu = the game's own defaults: nothing is
//               seeded and no card is clicked, the walk is the one it always was). A zone other than the first is not selectable on a
//               fresh profile, so the walk first seeds a saved profile that has the zones up to it unlocked (IndexedDB record of
//               meta/storage.ts, see payloadReport.ts `seedRecord`); the report starts with `walk: class X, zone Y = zone N of 4`.
//
// Windows (printed with every report):
//   menu  = every response finished before `.ms-menu` is shown (nothing audible/visible needs more)
//   zone  = every request issued after the Start click, finished by HUD + 6 s (the blocking load and the first seconds of
//           play; `--tail` seconds more are reported as background streaming, not gated)
// Sizes: binaries as served; js/css/json/html as brotli q5 (what Cloudflare Pages sends). Exit 1 when a budget is missed.
// A URL counts ONCE per page session, at its first fetch: this tool disables the HTTP cache, a real browser serves a repeat
// fetch of the same URL from its cache (hashed /assets files are served immutable). The totals WITH repeats and the repeated
// files are printed too, so a file the game really downloads twice stays visible.
// Boot failures: when the menu or the HUD never shows the tool says `BOOT FAILED: <first page error / console error>`.
import { chromium, type Page } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { brotliCompressSync, constants } from 'node:zlib';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { SEED_DB, type FileSize, type Req, parseWalk, seedRecord, seedZones, splitRepeats, walkHeader, windowsOf } from './payloadReport';
import { acquireSlot } from './slots';

const argv = process.argv.slice(2);
const arg = (k: string, d: string): string => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] !== undefined ? (argv[i + 1] as string) : d;
};
const DIST = resolve(arg('dist', 'apps/game/dist'));
const OUT = arg('out', '');
const TAIL = Number(arg('tail', '0')) * 1000;
const QUALITY = arg('quality', 'high');
const TOP = Math.max(0, Number(arg('top', '3')));
const EXTERNAL = arg('url', '').replace(/\/+$/, '');
const parsedWalk = parseWalk(argv.includes('--class') ? arg('class', '') : undefined, argv.includes('--zone') ? arg('zone', '') : undefined);
if (!parsedWalk.ok) {
  console.error(parsedWalk.error);
  process.exit(2);
}
const WALK = parsedWalk.walk;
/** the hero / zone that were selected on screen at the Start click (read back from the cards, not assumed) */
let picked: { classId: string; zone: string } | undefined;
const MENU_BUDGET = 6e6;
// 2026-11-07 (lead, user 2026-11-07: 'tekrar gecmezse altyapi tarafli problem yaratmayacaksa boyutu 20mb'a esnet, bitirmeye odaklan'): 15 MB -> 20 MB; Cloudflare Pages has no window limit (25 MiB per file, checked by scripts/deploy.ts)
const ZONE_BUDGET = 20e6;
/** Chrome start, DevTools connect, page load and every screen wait: a machine shared with other agents / builds is slow */
const WAIT_MS = 120_000;
/** a run (Start → HUD) builds the whole zone; 180 s was enough on a loaded machine, the HUD wait keeps it */
const HUD_WAIT_MS = 180_000;
if (!existsSync(join(DIST, 'index.html'))) {
  console.error(`no production build at ${DIST} (index.html missing)`);
  process.exit(2);
}

const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.map': 'application/json',
  '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.png': 'image/png', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.txt': 'text/plain',
};
const TEXTY = new Set(['.html', '.js', '.css', '.json', '.txt']);
const server = EXTERNAL
  ? null
  : Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(req) {
        let p = decodeURIComponent(new URL(req.url).pathname);
        if (p === '/') p = '/index.html';
        const f = resolve(DIST, `.${p}`);
        if (!f.startsWith(DIST + sep) || !existsSync(f) || !statSync(f).isFile()) return new Response('not found', { status: 404 });
        return new Response(Bun.file(f), { headers: { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' } });
      },
    });
const BASE = EXTERNAL || `http://127.0.0.1:${(server as NonNullable<typeof server>).port}`;
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome'].find((p) => existsSync(p));
if (!CHROME) throw new Error('no Chrome / Edge found');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const reqs: Req[] = [];
const marks: Record<string, number> = {};
/** uncaught page exceptions, in order */
const errors: string[] = [];
/** console.error messages (a failed fetch, a caught boot error), in order */
const consoleErrors: string[] = [];
const timing: Record<string, number> = {};
/** looping AudioBufferSource starts seen in the page (epoch ms): the music tracks are the ones longer than 30 s */
let audioStarts: { at: number; dur: number }[] = [];
let tEpoch = 0;

const release = await acquireSlot('payload-gate');
const profile = join(tmpdir(), `ms-payload-${process.pid}-${Date.now()}`);
mkdirSync(profile, { recursive: true });
const tChrome = Date.now();
const proc = Bun.spawn([CHROME, '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=d3d11', '--hide-scrollbars', '--mute-audio', '--window-size=1920,1080', 'about:blank'], { stdout: 'ignore', stderr: 'ignore' });
let port = 0;
for (const deadline = Date.now() + WAIT_MS; Date.now() < deadline && !port && proc.exitCode === null; ) {
  const f = join(profile, 'DevToolsActivePort');
  if (existsSync(f)) port = Number(readFileSync(f, 'utf8').split('\n')[0]) || 0;
  if (!port) await sleep(100);
}
let ok = true;
/** set when the menu / HUD never showed: the report leads with it */
let bootFailed = '';

/** The first thing that explains a page that does not come up: an uncaught exception, else a console error, else the page's own error text. */
async function whyNot(page: Page): Promise<string> {
  const text = await page
    .evaluate(() => {
      const fail = document.querySelector('.ms-bt-failmsg');
      return ((fail ?? document.getElementById('ui'))?.textContent ?? '').trim().slice(0, 300);
    })
    .catch(() => '');
  return errors[0] ?? consoleErrors[0] ?? (text ? `page says: ${text}` : 'no page error, no console error');
}

try {
  if (!port) throw new Error(proc.exitCode !== null ? `Chrome exited (code ${String(proc.exitCode)}) before it opened a DevTools port` : `Chrome did not open a DevTools port within ${WAIT_MS / 1000} s`);
  timing.chromeStartMs = Date.now() - tChrome;
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: WAIT_MS });
  timing.cdpConnectedMs = Date.now() - tChrome;
  try {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(WAIT_MS);
    page.setDefaultNavigationTimeout(WAIT_MS);
    // music check: record every looping buffer source that starts (the menu theme and the zone track are the long ones)
    await page.addInitScript(() => {
      const w = window as unknown as { __payloadAudio: { at: number; dur: number }[] };
      w.__payloadAudio = [];
      const proto = AudioBufferSourceNode.prototype as unknown as { start: (...a: unknown[]) => void };
      const start = proto.start;
      proto.start = function (this: AudioBufferSourceNode, ...a: unknown[]): void {
        if (this.loop) w.__payloadAudio.push({ at: Date.now(), dur: this.buffer?.duration ?? 0 });
        start.apply(this, a);
      };
    });
    let t0 = Date.now();
    tEpoch = t0;
    const now = (): number => Date.now() - t0;
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    const sent = new Map<string, number>();
    const meta = new Map<string, { url: string; status: number }>();
    cdp.on('Network.requestWillBeSent', (e: { requestId: string }) => void (sent.has(e.requestId) || sent.set(e.requestId, now())));
    cdp.on('Network.responseReceived', (e: { requestId: string; response: { url: string; status: number } }) => meta.set(e.requestId, e.response));
    cdp.on('Network.loadingFinished', (e: { requestId: string }) => {
      const m = meta.get(e.requestId);
      if (m?.url.startsWith(BASE)) reqs.push({ path: m.url.slice(BASE.length).split('?')[0] as string, status: m.status, sent: sent.get(e.requestId) ?? -1, done: now() });
    });
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300));
    });

    // --zone past the first: seed a saved profile with the zones up to it unlocked. A page the tool answers itself gives the origin
    // (same IndexedDB as the game) without booting the game; nothing of it counts in the report (its requests are dropped below).
    if (WALK.seeded) {
      const seedPath = '/__payload_seed__';
      await page.route(`${BASE}${seedPath}`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>payload seed</title>' }));
      await page.goto(`${BASE}${seedPath}`, { waitUntil: 'load' });
      await page.evaluate(
        ([db, record]) =>
          new Promise<void>((resolve, reject) => {
            const open = indexedDB.open(db.name, 1);
            open.onupgradeneeded = () => {
              if (!open.result.objectStoreNames.contains(db.store)) open.result.createObjectStore(db.store);
            };
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
              const tx = open.result.transaction(db.store, 'readwrite');
              tx.objectStore(db.store).put(record, db.key);
              tx.oncomplete = () => {
                open.result.close();
                resolve();
              };
              tx.onerror = () => reject(tx.error);
            };
          }),
        [SEED_DB, seedRecord(seedZones(WALK), Date.now())] as const,
      );
      reqs.length = 0; // only the seeding page was fetched so far
      sent.clear();
      meta.clear();
      t0 = Date.now();
      tEpoch = t0;
    }

    /**
     * Picks the hero / zone card of an explicit walk: a card that is not the selected one is clicked (a programmatic click: the
     * zone cards are clip-path polygons whose centre can lie outside their shape), the choice is read back from `aria-checked`.
     * The selected card is left alone: a click on it from the keyboard path would continue to the next screen.
     */
    const pickCard = async (selector: string, attr: string, want: string, what: string): Promise<void> => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const state = await page.evaluate(
          ([sel, a, w]) => {
            const card = document.querySelector<HTMLElement>(`${sel}[${a}="${w}"]`);
            if (!card) return 'missing';
            if (card.getAttribute('aria-checked') === 'true') return 'selected';
            card.click();
            return 'clicked';
          },
          [selector, attr, want] as const,
        );
        if (state === 'missing') throw new Error(`${what} "${want}": no such card on the screen`);
        if (state === 'selected') return;
        await sleep(700);
      }
      throw new Error(`${what} "${want}": the card did not become the selected one`);
    };

    /**
     * Waits until `selector` exists (frame-accurate: requestAnimationFrame polling). The boot's own failure screens end the wait
     * at once: the fatal text of main.ts (`#boot-retry`) and the load-failure panel of the loading screen (`.ms-boot.is-failed`).
     * Menu / HUD: BOOT FAILED with the first page / console error; other screens: a plain failure.
     */
    const shown = async (selector: string, label: string, timeout: number, boot: boolean): Promise<void> => {
      let state = '';
      try {
        const h = await page.waitForFunction(
          ([ok, bad]) => (document.querySelector(ok as string) ? 'ok' : document.querySelector(bad as string) ? 'bad' : false),
          [selector, '#boot-retry, .ms-boot.is-failed'],
          { timeout, polling: 'raf' },
        );
        state = String(await h.jsonValue());
      } catch {
        state = 'timeout';
      }
      if (state === 'ok') return;
      const why = await whyNot(page);
      const how = state === 'bad' ? 'the game ended on its failure screen' : `not shown within ${timeout / 1000} s`;
      if (boot) {
        bootFailed = `${why} (${label}: ${how})`;
        throw new Error(`BOOT FAILED: ${bootFailed}`);
      }
      throw new Error(`${label}: ${how}: ${why}`);
    };

    // the kit Button renders ms-kbtn--big, the legacy one ms-btn--big (ui/components/Button.tsx): accept both
    const BIG = (scope: string): string => `${scope} button.ms-kbtn--big, ${scope} button.ms-btn--big`;
    await page.goto(`${BASE}/?quality=${QUALITY}`, { waitUntil: 'load' });
    await shown('.ms-menu', 'the main menu', WAIT_MS, true);
    marks.menu = now();
    await sleep(8000); // idle on the menu: nothing more may be fetched before a gesture
    marks.menuIdle = now();
    await page.click(BIG('.ms-menu-nav >')); // Play = first gesture
    await shown('.ms-hs', 'hero select', WAIT_MS, false);
    await sleep(2500);
    let heroOn = '';
    if (WALK.explicit) {
      await pickCard('.ms-hs button.ms-hs-class', 'data-class', WALK.classId, 'hero');
      heroOn = await page.evaluate(() => document.querySelector('.ms-hs button.ms-hs-class[aria-checked="true"]')?.getAttribute('data-class') ?? '?');
    }
    await page.click(BIG('.ms-hs'));
    await shown('.ms-zs', 'zone select', WAIT_MS, false);
    await sleep(2500);
    if (WALK.explicit) {
      await pickCard('.ms-zs .ms-zs-hit', 'data-zone', WALK.zone, 'zone');
      const zoneOn = await page.evaluate(() => document.querySelector('.ms-zs .ms-zs-hit[aria-checked="true"]')?.getAttribute('data-zone') ?? '?');
      picked = { classId: heroOn, zone: zoneOn };
    }
    marks.start = now();
    await page.click(BIG('.ms-zs')); // default selection (first zone), or the one picked above
    await shown('.ms-hud-plate, .ms-hud', 'the HUD', HUD_WAIT_MS, true);
    marks.hud = now();
    await sleep(6000);
    marks.hud6 = now();
    if (TAIL > 0) await sleep(TAIL);
    marks.end = now();
    audioStarts = await page.evaluate(() => (window as unknown as { __payloadAudio?: { at: number; dur: number }[] }).__payloadAudio ?? []).catch(() => []);
  } finally {
    await browser.close().catch(() => undefined);
  }
} catch (err) {
  ok = false;
  errors.push(`FAILED: ${String(err).slice(0, 400)}`);
} finally {
  proc.kill();
  await proc.exited.catch(() => undefined);
  for (let i = 0; i < 10; i++) {
    try {
      rmSync(profile, { recursive: true, force: true });
      break;
    } catch {
      await sleep(300);
    }
  }
  release();
  server?.stop(true);
}

// ---- sizes and report ----------------------------------------------------------------------------------------------
const sizeCache = new Map<string, FileSize>();
function size(path: string): FileSize {
  let s = sizeCache.get(path);
  if (!s) {
    let rel = path;
    try {
      rel = decodeURIComponent(path);
    } catch {
      /* keep the raw path */
    }
    const f = join(DIST, rel);
    const raw = existsSync(f) && statSync(f).isFile() ? statSync(f).size : 0;
    const wire = raw && TEXTY.has(extname(f)) ? brotliCompressSync(readFileSync(f), { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }).length : raw;
    s = { raw, wire };
    sizeCache.set(path, s);
  }
  return s;
}

// a URL counts once per page session, at its first fetch (see the header); `all` keeps every fetch for the totals with repeats
const { all, counted, repeats } = splitRepeats(reqs, size);
const windows = windowsOf(counted, marks, size, TOP);
const windowsWithRepeats = windowsOf(all, marks, size, TOP);

const definition: Record<string, string> = {
  menu: 'responses finished before .ms-menu is shown (budget 6 MB)',
  menuIdle: 'finished during the 8 s idle on the menu (nothing may load before a gesture)',
  gestureToStart: 'sent after the idle, before the Start click (Play, hero select, zone select)',
  zone: 'sent after the Start click, finished by HUD + 6 s: blocking load + first seconds of play (budget 20 MB; soft target 13 MB)',
  zoneBlocking: 'sent after the Start click, finished by the HUD (.ms-hud-plate / .ms-hud)',
  background: `sent after the Start click, finished after HUD + 6 s (--tail ${TAIL / 1000} s)`,
};
const mb = (n: number): string => `${(n / 1e6).toFixed(2)} MB`;
const kb = (n: number): string => `${(n / 1e3).toFixed(0)} kB`;
const lines: string[] = [];
if (bootFailed) lines.push(`BOOT FAILED: ${bootFailed}`);
if (WALK.explicit) lines.push(walkHeader(WALK, picked));
lines.push('windows (wire = brotli q5 for js/css/json/html, as served for binaries; each URL counted once per session, repeats listed below):');
for (const [k, d] of Object.entries(definition)) lines.push(`  ${k.padEnd(15)} ${d}`);
lines.push('');
for (const [k, w] of Object.entries(windows)) {
  const withRepeats = windowsWithRepeats[k as keyof typeof windowsWithRepeats];
  lines.push(`${k.padEnd(15)} ${String(w.n).padStart(4)} req  wire ${mb(w.wire).padStart(9)}  raw ${mb(w.raw).padStart(9)}${withRepeats.n !== w.n ? `   (with repeat fetches: ${withRepeats.n} req, wire ${mb(withRepeats.wire)})` : ''}`);
  for (const [g, v] of Object.entries(w.groups).sort((a, b) => b[1].wire - a[1].wire)) {
    lines.push(`    ${g.padEnd(24)} ${String(v.n).padStart(4)}  ${mb(v.wire).padStart(9)}`);
    for (const f of v.top) lines.push(`        ${kb(f.wire).padStart(7)}  ${f.path}`);
  }
}
const longLoops = audioStarts.filter((a) => a.dur > 30).map((a) => ({ atMs: a.at - tEpoch, durS: Math.round(a.dur) }));
const rel = (ms: number): string => (marks.hud === undefined ? `+${(ms / 1000).toFixed(1)} s` : `HUD${ms - marks.hud >= 0 ? '+' : ''}${((ms - marks.hud) / 1000).toFixed(1)} s`);
lines.push(`music (looping tracks > 30 s that started): ${longLoops.length === 0 ? 'none' : longLoops.map((a) => `${rel(a.atMs)} (${a.durS} s)`).join(', ')}${TAIL > 0 ? '' : '   (--tail 0: the zone track is due after HUD + 9 s, use --tail 20 to see it start)'}`);
lines.push(`repeat fetches (not counted above; this tool disables the cache): ${repeats.reduce((n, r) => n + r.fetches, 0)} fetches of ${repeats.length} URLs, ${mb(repeats.reduce((n, r) => n + r.wire, 0))}`);
for (const r of repeats.slice(0, Math.max(TOP, 5))) lines.push(`    ${String(r.fetches + 1).padStart(2)}x  ${kb(r.wire / r.fetches).padStart(7)} each  ${r.path}`);
// a failed session (page exception, own-origin 4xx/5xx other than the API a static server cannot have) is not a green gate
const badResponses = counted.filter((r) => r.status >= 400 && !r.path.startsWith('/api/')).map((r) => `${r.status} ${r.path}`);
const sessionErrors = errors.filter((e) => !e.startsWith('FAILED:')).length + badResponses.length;
if (ok && sessionErrors > 0) ok = false;
const menuOk = ok && windows.menu.wire < MENU_BUDGET;
const zoneOk = ok && windows.zone.wire < ZONE_BUDGET;
lines.push(`menu ${menuOk ? 'PASS' : 'FAIL'} ${mb(windows.menu.wire)} < ${mb(MENU_BUDGET)}   zone ${zoneOk ? 'PASS' : 'FAIL'} ${mb(windows.zone.wire)} < ${mb(ZONE_BUDGET)}`);
lines.push(`marks ${JSON.stringify(marks)}${timing.chromeStartMs !== undefined ? `   chrome ready ${(timing.chromeStartMs / 1000).toFixed(1)} s, connected ${((timing.cdpConnectedMs ?? 0) / 1000).toFixed(1)} s` : ''}`);
lines.push(`session: ${errors.filter((e) => !e.startsWith('FAILED:')).length} page error(s), ${consoleErrors.length} console error(s), ${badResponses.length} bad response(s)${EXTERNAL ? `, server ${EXTERNAL}` : ''}`);
if (errors.length) lines.push(`errors: ${errors.join(' | ')}`);
if (consoleErrors.length) lines.push(`console errors: ${consoleErrors.slice(0, 5).join(' | ')}`);
if (badResponses.length) lines.push(`bad responses: ${badResponses.slice(0, 5).join(' | ')}`);
console.log(lines.join('\n'));
if (OUT) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'payload.txt'), lines.join('\n'));
  // `windows` / `marks` / `requests` / `errors` keep their old meaning (windows now count a URL once); the rest is new
  writeFileSync(join(OUT, 'payload.json'), JSON.stringify({ dist: DIST, base: BASE, walk: { classId: WALK.classId, zone: WALK.zone, zoneNumber: WALK.zoneNumber, zoneCount: WALK.zoneCount, seeded: WALK.seeded, explicit: WALK.explicit, picked: picked ?? null }, marks, windows, windowsWithRepeats, definition, repeats, music: longLoops, requests: reqs, errors, consoleErrors, badResponses, bootFailed, timing }, null, 1));
}
process.exit(menuOk && zoneOk ? 0 : 1);
