// Chrome for the playthrough harness: one slot of the machine-wide pool (tools/qa/slots.ts), started by hand on a free DevTools port
// (Bun on Windows cannot hand Chrome playwright's extra pipe fds) and driven over CDP. Differences from tools/qa/shot.ts: the V8 flags
// --expose-gc and --enable-precise-memory-info (the JS heap after a forced gc is a detector input), a fresh --user-data-dir per start.
import { chromium, type Browser } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireSlot } from '../slots';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** every Chrome this process started: killed when the harness exits or is interrupted (the machine is shared, nothing may outlive a step) */
const live = new Set<ReturnType<typeof Bun.spawn>>();
let hooked = false;
function hookExit(): void {
  if (hooked) return;
  hooked = true;
  const killAll = (): void => {
    for (const p of live) {
      try {
        p.kill();
      } catch {
        /* gone */
      }
    }
  };
  process.once('exit', killAll);
  for (const sig of ['SIGINT', 'SIGTERM'] as const)
    process.once(sig, () => {
      killAll();
      process.exit(130);
    });
}

export const CHROME_EXE = [process.env.MS_QA_CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => p && existsSync(p));

export interface ChromeHandle {
  browser: Browser;
  /** machine load note taken at start */
  startMs: number;
  slotWaitMs: number;
  close(): Promise<void>;
}

export interface ChromeOpts {
  tag: string;
  width: number;
  height: number;
  headful?: boolean;
  /** extra chrome args */
  args?: string[];
  tries?: number;
  waitS?: number;
}

export async function launchChrome(o: ChromeOpts): Promise<ChromeHandle> {
  if (!CHROME_EXE) throw new Error('no Chrome / Edge found (set MS_QA_CHROME)');
  const tSlot = Date.now();
  const release = await acquireSlot(`play-${o.tag}`, 'chrome', { keepAlive: true });
  const slotWaitMs = Date.now() - tSlot;
  const tries = o.tries ?? 3;
  const waitS = o.waitS ?? 60;
  let last = '';
  let proc: ReturnType<typeof Bun.spawn> | null = null;
  let profile = '';
  let browser: Browser | null = null;
  const kill = async (): Promise<void> => {
    try {
      await browser?.close();
    } catch {
      /* already closed */
    }
    browser = null;
    try {
      proc?.kill();
      await proc?.exited;
      if (proc) live.delete(proc);
    } catch {
      /* gone */
    }
    proc = null;
    for (let i = 0; i < 12 && profile; i++) {
      try {
        rmSync(profile, { recursive: true, force: true });
        break;
      } catch {
        await sleep(300);
      }
    }
    profile = '';
  };
  const t0 = Date.now();
  try {
    for (let n = 1; n <= tries; n++) {
      profile = join(tmpdir(), `ms-play-${process.pid}-${Date.now()}`);
      mkdirSync(profile, { recursive: true });
      proc = Bun.spawn(
        [
          CHROME_EXE,
          ...(o.headful ? [] : ['--headless=new']),
          '--remote-debugging-port=0',
          `--user-data-dir=${profile}`,
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
          '--js-flags=--expose-gc',
          '--enable-precise-memory-info',
          `--window-size=${o.width},${o.height}`,
          ...(o.args ?? []),
          'about:blank',
        ],
        { stdout: 'ignore', stderr: 'ignore' },
      );
      hookExit();
      live.add(proc);
      let port = 0;
      for (let i = 0; i < waitS * 10 && port === 0; i++) {
        const f = join(profile, 'DevToolsActivePort');
        if (existsSync(f)) port = Number(readFileSync(f, 'utf8').split('\n')[0]) || 0;
        if (port === 0) await sleep(100);
      }
      if (port === 0) last = `chrome opened no DevTools port within ${waitS} s`;
      else {
        try {
          browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 60_000 });
          break;
        } catch (e) {
          last = `CDP connect on ${port} failed: ${String((e as Error).message ?? e).split('\n')[0]}`;
        }
      }
      console.error(`[chrome ${o.tag}] start ${n}/${tries} failed (${last})`);
      await kill();
      await sleep(2000 * n);
    }
    if (!browser) throw new Error(`${last} (${tries} tries)`);
  } catch (e) {
    await kill();
    release();
    throw e;
  }
  const b = browser as Browser;
  return {
    browser: b,
    startMs: Date.now() - t0,
    slotWaitMs,
    close: async () => {
      await kill();
      release();
    },
  };
}
