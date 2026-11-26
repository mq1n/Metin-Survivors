// selftest mode: injects faults into a live page of the QA snapshot and asserts that every detector fires (and that a clean page and the
// offline API stay quiet). Also re-runs the plain-dist hook check (grep of the dist + a real page of the plain build).
//   page errors: a throw in a frame callback · an unhandled rejection · console error / warning · a shader error line · a 404 asset
//   state:       a NaN hero position · a stuck modal · a stuck hero · a stalled sim clock · a stuck loading screen · a screen without progress
//   machine:     a WebGL context loss (WEBGL_lose_context) · a heap + texture leak (allocated and kept) read through the leak verdict
//   build:       the plain production dist carries no window.__ms (grep + page)
// play-review 2026-10-27 (false negatives found by injecting them; each one is a check now):
//   boot-console-error   a console.error ONCE at boot with game text the old "offline" filter swallowed ("sync", "Failed to fetch ...")
//   game-warning         "[structures] GLB prop_x failed, using procedural" (warnings outside a short pattern list were never findings)
//   worker-throw         an uncaught error inside a Web Worker (regression check: Chrome forwards it to the page, so it was already caught;
//                        the Worker wrapper adds the worker's name and 'messageerror')
//   chunk-abort          a lazily imported class chunk aborted (ERR_ABORTED) when a run loads (aborted requests were "not a defect")
//   enter-overlay        an invisible overlay over the zone ENTER button: only element.click() gets through (was not recorded)
//   input-probe / input-broken   real WASD holds move the hero / a keyboard path that never reaches the game (the bot bypasses input)
//   modal-disabled       a level-up modal whose card buttons are disabled (the ladder force-clicked forever, the run sat there)
//   loop-paused          the game loop paused with no pause overlay / modal on screen (skipped by the clock watcher)
//   hero-in-wall         the hero put deep inside blocked ground with no enemy near (heroStuck required an enemy within 15 m)
//   page-freeze          the main thread blocked for 40 s (page.evaluate had no deadline: the harness waited forever)
//   texture-leak-small   one texture kept per run over identical runs (the mixed-run verdict needed +10)
// Thresholds are tightened for the run (a few seconds instead of 20 - 90 s); the detector code is the same.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Args, cpuLoad, leakVerdict, makeRig, outDirFor, pickSnapshot, repeatLeakVerdict, thresholdsFrom, viewFrom, writeSummary, type Summary } from './common';
import { sleep, type Lane, type MenuMemory } from './lane';
import { hookCheck } from './snapshot';
import { atMenu, enterRun, handleModal, inputProbe, type RunCfg, type RunReport } from './runner';
import { leakProbe } from './campaign';

interface Check {
  id: string;
  fault: string;
  expect: string;
  fired: boolean;
  detail: string;
  ms: number;
}

export async function selftest(a: Args): Promise<number> {
  const t0 = Date.now();
  const snap = await pickSnapshot(a);
  const out = outDirFor(a, 'selftest');
  const cpuStart = await cpuLoad();
  const checks: Check[] = [];
  const probes: Record<string, unknown>[] = [];
  // the Args object is read by makeRig for thresholds: build a shadow with the tight values
  const args = new Args(['selftest', '--loadingStuckS', '4', '--screenStuckS', '7', '--modalStuckS', '4', '--clockStallS', '3', '--runEndFlowS', '3', '--stuckSimS', '30', '--unresponsiveS', '15', ...process.argv.slice(3).filter((x) => x !== 'selftest')]);
  const only = a.list('only');
  const want = (id: string): boolean => only.length === 0 || only.includes(id);
  const rig = await makeRig(args, snap.distQa, out, true);
  let lane: Lane | null = null;
  const has = (l: Lane, detector: string | RegExp, rx?: RegExp): { hit: boolean; detail: string } => {
    for (const v of l.list().filter((x) => x.run === l.run)) {
      const okD = typeof detector === 'string' ? v.detector === detector : detector.test(v.detector);
      if (okD && (!rx || rx.test(v.message))) return { hit: true, detail: `${v.detector}: ${v.message.slice(0, 200)}` };
    }
    return { hit: false, detail: `not raised (have in ${l.run}: ${l.list().filter((x) => x.run === l.run).map((v) => v.detector).join(',') || 'nothing'})` };
  };
  const rec = async (id: string, fault: string, expect: string, run: () => Promise<{ hit: boolean; detail: string }>): Promise<void> => {
    if (!want(id)) return;
    const t = Date.now();
    let r: { hit: boolean; detail: string };
    if (lane && id !== 'clean-boot') lane.run = id;
    try {
      r = await run();
    } catch (e) {
      r = { hit: false, detail: `harness threw: ${String((e as Error).message ?? e).slice(0, 300)}` };
    }
    checks.push({ id, fault, expect, fired: r.hit, detail: r.detail, ms: Date.now() - t });
    console.log(`  [selftest] ${r.hit ? 'FIRED  ' : 'MISSED '} ${id}: ${r.detail}`);
  };
  const settle = async (l: Lane, ms = 700): Promise<void> => {
    await sleep(ms);
    await l.snap();
  };
  const assetsOf = (re: RegExp): string[] => readdirSync(join(snap.distQa, 'assets')).filter((f) => re.test(f));
  try {
    // ------------------------------------------------------------------------------------------------ build: the hook is not in the plain dist
    await rec('hook-grep', 'grep the plain dist for window.__ms', 'dist-prod has 0 hits, dist-qa has >= 1', async () => {
      const prod = hookCheck(snap.distProd);
      const qa = hookCheck(snap.distQa);
      return { hit: prod.hookMarkers === 0 && qa.hookMarkers >= 1, detail: `dist-prod ${prod.hookMarkers} hit(s), dist-qa ${qa.hookMarkers} hit(s) in ${qa.files.join(',')}` };
    });
    lane = await rig.mk('t1');
    // a boot-time fault script, armed only by ?qaBootFault=1 (the init script runs before the game's own scripts on every navigation)
    await lane.ctx.addInitScript(() => {
      if (!location.search.includes('qaBootFault=1')) return;
      document.addEventListener('DOMContentLoaded', () => {
        console.error('[ui] settle failed', new Error('QA boot fault: profile sync conflict'));
        console.error('[zoneScene] yeonmu: system "structures" failed to load', new TypeError('QA boot fault: Failed to fetch dynamically imported module: /assets/zoneScene-qa.js'));
      });
    });
    // ------------------------------------------------------------------------------------------- a console.error once, during the boot
    if (want('boot-console-error')) {
      lane.run = 'boot-console-error';
      await lane.goto('/?qaBootFault=1');
      await atMenu(lane, 150);
      await settle(lane, 800);
      await rec('boot-console-error', 'console.error twice at DOMContentLoaded (before the menu), texts with "sync" / "Failed to fetch dynamically imported module"', 'consoleError for both (the old offline filter bucketed both as offline)', async () => {
        const x = has(lane!, 'consoleError', /QA boot fault: profile sync/);
        const y = has(lane!, 'consoleError', /QA boot fault: Failed to fetch dynamically/);
        return { hit: x.hit && y.hit, detail: `${x.detail} || ${y.detail}` };
      });
    }
    lane.run = 'clean-boot';
    await lane.goto('/');
    const menu = await atMenu(lane, 150);
    await settle(lane, 1500);
    // ---------------------------------------------------------------------------------------------------- control: a clean boot is quiet
    await rec('clean-boot', 'none (control)', 'no violation on a clean boot with the API offline; /api/* answers 503 and is counted as offline', async () => {
      const bad = lane!.list().filter((v) => v.severity !== 'info' && v.run === 'clean-boot');
      return { hit: menu && bad.length === 0, detail: `menu ${menu}; violations ${bad.length}${bad.length ? ` (${bad.map((v) => `${v.detector}: ${v.message.slice(0, 80)}`).join(' | ')})` : ''}; offline api responses ${lane!.requests.apiOffline}` };
    });
    await rec('offline-api', 'fetch /api/v1/health (503 from the offline server)', 'counted as offline, NOT a violation', async () => {
      const before = lane!.list().length;
      const off0 = lane!.requests.apiOffline;
      await lane!.page.evaluate(() => fetch('/api/v1/health').then((r) => r.status).catch(() => 0));
      await settle(lane!, 500);
      return { hit: lane!.requests.apiOffline > off0 && lane!.list().length === before, detail: `apiOffline ${off0} -> ${lane!.requests.apiOffline}; violations ${before} -> ${lane!.list().length}` };
    });
    // ----------------------------------------------------------------------------------------------------------------------- page errors
    await rec('frame-throw', 'a throw inside a requestAnimationFrame callback', 'windowError / pageError', async () => {
      await lane!.page.evaluate(() => requestAnimationFrame(() => { throw new Error('QA fault: throw in a frame callback'); }));
      for (let i = 0; i < 60 && !(has(lane!, 'windowError', /QA fault: throw/).hit && has(lane!, 'pageError', /QA fault: throw/).hit); i++) {
        await lane!.snap();
        await sleep(250);
      }
      const a1 = has(lane!, 'windowError', /QA fault: throw/);
      const a2 = has(lane!, 'pageError', /QA fault: throw/);
      return { hit: a1.hit && a2.hit, detail: `${a1.detail} || ${a2.detail}` };
    });
    await rec('unhandled-rejection', 'Promise.reject with no handler', 'unhandledRejection', async () => {
      await lane!.page.evaluate(() => { setTimeout(() => { void Promise.reject(new Error('QA fault: unhandled rejection')); }, 0); });
      await settle(lane!);
      return has(lane!, 'unhandledRejection', /QA fault: unhandled rejection/);
    });
    await rec('console-error', 'console.error(...)', 'consoleError', async () => {
      await lane!.page.evaluate(() => console.error('QA fault: console error'));
      await settle(lane!, 400);
      return has(lane!, 'consoleError', /QA fault: console error/);
    });
    await rec('console-warning', 'console.warn("[i18n] missing key ...")', 'consoleWarning', async () => {
      await lane!.page.evaluate(() => console.warn('[i18n] missing key qa.fault.key'));
      await settle(lane!, 400);
      return has(lane!, 'consoleWarning', /missing key/);
    });
    await rec('game-warning', 'console.warn("[structures] GLB prop_qa failed, using procedural", err) - the game\'s own fallback warning', 'consoleWarning (major)', async () => {
      await lane!.page.evaluate(() => console.warn('[structures] GLB prop_qa failed, using procedural', new Error('QA fault: bad GLB')));
      await settle(lane!, 400);
      for (const v of lane!.list()) if (v.run === lane!.run && v.detector === 'consoleWarning' && /prop_qa/.test(v.message)) return { hit: v.severity === 'major', detail: `${v.detector} ${v.severity}: ${v.message.slice(0, 120)}` };
      return has(lane!, 'consoleWarning', /prop_qa/);
    });
    await rec('shader-error', 'console.error("THREE.WebGLProgram: Shader Error ...")', 'shaderError', async () => {
      await lane!.page.evaluate(() => console.error('THREE.WebGLProgram: Shader Error 0 - VALIDATE_STATUS false\n\nProgram Info Log: qa fault'));
      await settle(lane!, 400);
      return has(lane!, 'shaderError');
    });
    await rec('worker-throw', 'a blob Web Worker that throws at start', 'windowError [worker ...] (or workerError)', async () => {
      await lane!.page.evaluate(() => {
        const u = URL.createObjectURL(new Blob(['throw new Error("QA fault: worker throw")'], { type: 'text/javascript' }));
        (window as any).__qaWorker = new Worker(u);
      });
      for (let i = 0; i < 16 && !has(lane!, /windowError|workerError/, /worker/i).hit; i++) await settle(lane!, 250);
      return has(lane!, /windowError|workerError/, /worker/i);
    });
    await rec('asset-404', 'fetch a missing /assets file', 'failedRequest HTTP 404', async () => {
      await lane!.page.evaluate(() => fetch('/assets/models/__qa_missing_asset.glb').then((r) => r.status).catch(() => 0));
      await settle(lane!, 600);
      return has(lane!, 'failedRequest', /404.*__qa_missing_asset/);
    });
    await rec('csp', 'inline script injected into the page (production CSP)', 'cspViolation', async () => {
      await lane!.page.evaluate(() => { const s = document.createElement('script'); s.textContent = 'window.__qa_csp = 1'; document.head.appendChild(s); });
      await settle(lane!, 600);
      return has(lane!, 'cspViolation');
    });
    // ----------------------------------------------------------------------------------------- a lazily imported chunk is aborted (ERR_ABORTED)
    await rec('chunk-abort', 'the lazy skill chunk of the selected class answers net::ERR_ABORTED when the run loads it', 'failedRequest (script aborted) + consoleError (the load error the old filter called "offline")', async () => {
      const cls = ['ninja', 'yacha', 'shaman', 'wolfman'].find((c) => assetsOf(new RegExp(`^${c}-[\\w-]+\\.js$`)).length > 0);
      if (!cls) return { hit: false, detail: 'no class chunk in the dist' };
      const pattern = `**/assets/${cls}-*.js`;
      await lane!.page.route(pattern, (r) => r.abort('aborted'));
      try {
        lane!.muted.add('loading');
        await lane!.page.evaluate((c) => {
          const ms = (window as any).__ms;
          ms.store.select({ classId: c });
          void ms.startRun();
        }, cls);
        const s = await lane!.waitFor('run load error', (x) => !!x.loading?.error || x.screen === 'run', 120, 250);
        await settle(lane!, 800);
        const fr = has(lane!, 'failedRequest', new RegExp(`aborted.*${cls}-`));
        const ce = has(lane!, 'consoleError', /dynamically imported module|Failed to fetch/i);
        return { hit: fr.hit && ce.hit, detail: `run ${s?.loading?.error ? `failed to load: ${s.loading.error.slice(0, 80)}` : `screen ${s?.screen}`}; ${fr.detail} || ${ce.detail}` };
      } finally {
        await lane!.page.unroute(pattern).catch(() => undefined);
      }
    });
    // ------------------------------------------------------------------------------------------------------------ loading / screen stuck
    lane.run = 'reload';
    await lane.goto('/');
    await atMenu(lane, 150);
    await rec('loading-stuck', 'store.setScreen("loading") and leave it (threshold 4 s)', 'loadingStuck', async () => {
      lane!.muted.delete('loading');
      await lane!.page.evaluate(() => (window as any).__ms.store.setScreen('loading'));
      for (let i = 0; i < 40; i++) {
        await lane!.snap();
        await sleep(200);
      }
      const r = has(lane!, 'loadingStuck');
      await lane!.page.evaluate(() => (window as any).__ms.store.setScreen('menu'));
      await settle(lane!, 400);
      return r;
    });
    await rec('screen-stuck', 'a screen with no progress (threshold 7 s)', 'screenStuck', async () => {
      lane!.markProgress();
      for (let i = 0; i < 48; i++) {
        await lane!.snap();
        await sleep(200);
      }
      return has(lane!, 'screenStuck');
    });
    // ------------------------------------------------------------------------------------------------------------------- inside a run
    // the loading-screen fault left the boot overlay up: a clean page for the run
    lane.run = 'enter-run';
    await lane.goto('/');
    await atMenu(lane, 150);
    const content = await lane.page.evaluate(async () => {
      const c = await (window as any).__ms.hooks.loadContent();
      return { zone: c.zones.slice().sort((x: any, y: any) => x.order - y.order)[0].id as string, cls: c.classes[0].id as string };
    });
    const cfg: RunCfg = { label: 'selftest-run', zone: content.zone, classId: content.cls, doctrine: 'a', difficulty: 'normal', god: true, bot: 'idle', timeScale: 1, maxWallS: 120, shots: false };
    lane.muted.add('loading').add('screen').add('modal');
    // the run is entered through the REAL UI with an invisible overlay over the ENTER button: the ladder's element.click() gets the run
    // started, and that fallback must be a finding (the old enterRun ignored a 'dom' result for PLAY / NEXT / ENTER)
    let entered = false;
    await rec('enter-overlay', 'a transparent full-z-index div over the zone ENTER button (the pointer never reaches it)', 'uiFallback "zone ENTER button" (element.click())', async () => {
      await lane!.page.evaluate(() => {
        const cover = (): void => {
          const b = document.querySelector('.ms-zs-enter button');
          let ov = document.getElementById('qa-enter-overlay');
          if (!b) {
            ov?.remove();
            return;
          }
          const r = b.getBoundingClientRect();
          if (!ov) {
            ov = document.createElement('div');
            ov.id = 'qa-enter-overlay';
            Object.assign(ov.style, { position: 'fixed', zIndex: '2147483647', background: 'transparent', pointerEvents: 'auto' });
            document.body.appendChild(ov);
          }
          Object.assign(ov.style, { left: `${r.left - 4}px`, top: `${r.top - 4}px`, width: `${r.width + 8}px`, height: `${r.height + 8}px` });
        };
        (window as any).__qaCover = setInterval(cover, 100);
      });
      const rep = { phases: {} as Record<string, number>, loadS: 0 } as unknown as RunReport;
      entered = await enterRun(lane!, { ...cfg, label: 'enter-overlay' }, rep);
      await lane!.page.evaluate(() => { clearInterval((window as any).__qaCover); document.getElementById('qa-enter-overlay')?.remove(); }).catch(() => undefined);
      const r = has(lane!, 'uiFallback', /zone ENTER button/);
      return { hit: r.hit, detail: `run entered ${entered}; ${r.detail}` };
    });
    if (!entered) {
      // the store path, so the in-run checks still run when the overlay check is filtered out or failed
      await lane.page.evaluate((c) => {
        const ms = (window as any).__ms;
        ms.store.select({ zone: c.zone, classId: c.classId, doctrine: 'a', difficulty: 'normal' });
        void ms.startRun();
      }, { zone: cfg.zone, classId: cfg.classId });
    }
    const inRun = await lane.waitFor('run screen', (x) => x.screen === 'run' || !!x.loading?.error, 240, 250);
    if (!inRun || inRun.screen !== 'run') throw new Error('selftest: could not enter a run');
    await lane.page.evaluate(() => {
      const ms = (window as any).__ms;
      ms.loop.timeScale = 8;
      Object.assign((window as any).__qa.cfg, { bot: 'idle', god: true, stuckSimS: 30, stuckAlways: true });
    });
    // answer whatever modal is open (story / level-up cards) through the real UI so the sim runs; every in-run fault starts from a clean state
    const modals = { modals: {} as Record<string, number> };
    const clearModals = async (l: Lane, maxS = 40): Promise<void> => {
      const end = Date.now() + maxS * 1000;
      while (Date.now() < end) {
        const s = await l.snap();
        if (!s || !s.modal) return;
        await handleModal(l, s, modals);
        await sleep(200);
      }
    };
    // no clean-up pass here: the 30 s of sim the detector needs start counting at run start, the loop below answers the story / level-up modals itself
    await rec('hero-stuck', 'the hero stands still (idle, god) for 30 s of sim', 'heroStuck', async () => {
      for (let i = 0; i < 600; i++) {
        const s = await lane!.snap();
        if (has(lane!, 'heroStuck').hit) break;
        if (!s || s.screen !== 'run') break;
        if (s.modal) await handleModal(lane!, s, modals);
        await sleep(250);
      }
      return has(lane!, 'heroStuck');
    });
    // ---- real input: control (keys move the hero) and the fault (WASD swallowed before the game sees it)
    await rec('input-probe', 'none (control): real WASD key holds with the bot off', 'the hero moves >= 1.5 m, no inputBroken', async () => {
      await clearModals(lane!);
      const r = await inputProbe(lane!, cfg);
      const bad = has(lane!, 'inputBroken');
      return { hit: r.ok && !bad.hit, detail: `moved ${JSON.stringify(r.moved)} m; ${bad.hit ? bad.detail : 'no inputBroken'}` };
    });
    await rec('input-broken', 'a capture-phase keydown listener swallows W/A/S/D before the game', 'inputBroken', async () => {
      await clearModals(lane!);
      await lane!.page.evaluate(() => {
        (window as any).__qaKeyEater = (e: KeyboardEvent): void => {
          if (/^Key[WASD]$/.test(e.code)) e.stopImmediatePropagation();
        };
        window.addEventListener('keydown', (window as any).__qaKeyEater, true);
      });
      try {
        const r = await inputProbe(lane!, cfg);
        const b = has(lane!, 'inputBroken');
        return { hit: b.hit && !r.ok, detail: `moved ${JSON.stringify(r.moved)} m; ${b.detail}` };
      } finally {
        await lane!.page.evaluate(() => window.removeEventListener('keydown', (window as any).__qaKeyEater, true)).catch(() => undefined);
      }
    });
    await rec('modal-stuck', 'a level-up card modal the harness cannot answer (threshold 4 s)', 'modalStuck', async () => {
      await clearModals(lane!);
      lane!.muted.delete('modal');
      await lane!.page.evaluate(() => { const w = (window as any).__ms.session.world; w.players[0].pendingLevels += 1; /* updateProgress opens the level-up modal on the next tick */ });
      let seen = false;
      for (let i = 0; i < 60 && !has(lane!, 'modalStuck').hit; i++) {
        const s = await lane!.snap();
        if (s?.modal && s.modal.kind === 'levelUp') {
          seen = true;
          // clicks happen but land on nothing (the modal is covered): they cannot answer it
          await lane!.page.mouse.click(2, 2).catch(() => undefined);
          lane!.modalClicks++;
        }
        await sleep(250);
      }
      const r = has(lane!, 'modalStuck');
      return { hit: r.hit, detail: `${seen ? 'level-up modal opened' : 'NO level-up modal appeared'}; ${r.detail}` };
    });
    // answer the modal for real now
    for (let i = 0; i < 40; i++) {
      const s2 = await lane.snap();
      if (!s2?.modal) break;
      if (s2.modal.kind === 'levelUp') await lane.page.evaluate(() => (window as any).__ms.store.chooseCard(0)).catch(() => undefined);
      await sleep(300);
    }
    await rec('modal-disabled', 'every card button of a level-up modal is disabled; the harness answers it with its real ladder', 'uiFallback for the card + modalStuck, and the ladder ends the modal (the run goes on)', async () => {
      await clearModals(lane!);
      lane!.muted.delete('modal');
      await lane!.page.evaluate(() => {
        const mo = new MutationObserver(() => document.querySelectorAll<HTMLButtonElement>('.ms-cardmodal .ms-card').forEach((b) => { if (!b.disabled) b.disabled = true; }));
        mo.observe(document.body, { subtree: true, childList: true });
        (window as any).__qaDisable = mo;
        (window as any).__ms.session.world.players[0].pendingLevels += 1;
      });
      let opened = '';
      let closed = false;
      const end = Date.now() + 120_000;
      while (Date.now() < end) {
        const s = await lane!.snap();
        if (s?.modal?.kind === 'levelUp') {
          opened = opened || `${s.modal.kind}:${s.modal.id}`;
          await handleModal(lane!, s, modals);
        } else if (opened && (!s?.modal || `${s.modal.kind}:${s.modal.id}` !== opened)) {
          closed = true;
          break;
        }
        await sleep(200);
      }
      await lane!.page.evaluate(() => (window as any).__qaDisable?.disconnect()).catch(() => undefined);
      const fb = has(lane!, 'uiFallback', /card \d+ of levelUp/);
      const st = has(lane!, 'modalStuck');
      return { hit: fb.hit && st.hit && closed, detail: `modal ${opened || 'never opened'} closed by the ladder: ${closed}; ${fb.detail} || ${st.detail}` };
    });
    await rec('sim-clock-stalled', 'the loop is stopped with no modal open (threshold 3 s)', 'simClockStalled', async () => {
      await clearModals(lane!);
      lane!.muted.delete('clock');
      await lane!.page.evaluate(() => { (window as any).__ms.loop.stop(); });
      for (let i = 0; i < 40 && !has(lane!, 'simClockStalled').hit; i++) {
        await lane!.snap();
        await sleep(250);
      }
      const r = has(lane!, 'simClockStalled');
      await lane!.page.evaluate(() => { (window as any).__ms.loop.start(); });
      await settle(lane!, 500);
      return r;
    });
    await rec('loop-paused', 'loop.paused = true with no pause overlay and no modal (threshold 3 s)', 'loopPausedNoModal', async () => {
      await clearModals(lane!);
      await lane!.page.evaluate(() => { (window as any).__ms.loop.paused = true; });
      for (let i = 0; i < 40 && !has(lane!, 'loopPausedNoModal').hit; i++) {
        await lane!.snap();
        await sleep(250);
      }
      const r = has(lane!, 'loopPausedNoModal');
      await lane!.page.evaluate(() => { (window as any).__ms.loop.paused = false; });
      await settle(lane!, 500);
      return r;
    });
    await rec('hero-in-wall', 'the hero is put at the deepest blocked point of the zone (no enemy can reach it), the bot plays', 'heroOffWalkable and heroStuck', async () => {
      await clearModals(lane!);
      const spot = (await lane!.page.evaluate(() => {
        const w = (window as any).__ms.session.world;
        const wk = w.env.walkable as ((x: number, z: number) => boolean) | undefined;
        if (!wk) return null;
        const R = w.arenaRadius as number;
        let best: { x: number; z: number; depth: number } | null = null;
        for (let x = -R; x <= R; x += 3) {
          for (let z = -R; z <= R; z += 3) {
            if (Math.hypot(x, z) > R - 6 || wk(x, z)) continue;
            let depth = 0;
            for (const rr of [2, 4, 6, 9, 12, 16, 20, 25]) {
              let any = false;
              for (let k = 0; k < 16 && !any; k++) if (wk(x + Math.cos((k * Math.PI) / 8) * rr, z + Math.sin((k * Math.PI) / 8) * rr)) any = true;
              if (any) break;
              depth = rr;
            }
            if (!best || depth > best.depth) best = { x, z, depth };
          }
        }
        if (!best) return null;
        const p = w.players[0];
        p.x = best.x;
        p.z = best.z;
        Object.assign((window as any).__qa.cfg, { bot: 'play' });
        return best;
      })) as { x: number; z: number; depth: number } | null;
      if (!spot) return { hit: false, detail: 'no blocked ground found in the arena (cannot place the fault)' };
      for (let i = 0; i < 240 && !(has(lane!, 'heroOffWalkable').hit && has(lane!, 'heroStuck').hit); i++) {
        const s = await lane!.snap();
        if (s?.modal) await handleModal(lane!, s, modals);
        await sleep(250);
      }
      const where = (await lane!.page.evaluate(() => {
        const w = (window as any).__ms.session.world;
        const p = w.players[0];
        let near = 0;
        for (let i = 0; i < w.enemies.count; i++) if (Math.hypot(w.enemies.x[i] - p.x, w.enemies.z[i] - p.z) < 15) near++;
        const out = { x: +p.x.toFixed(1), z: +p.z.toFixed(1), near };
        p.x = 0;
        p.z = 0;
        Object.assign((window as any).__qa.cfg, { bot: 'idle' });
        return out;
      })) as { x: number; z: number; near: number };
      const off = has(lane!, 'heroOffWalkable');
      const st = has(lane!, 'heroStuck');
      return { hit: off.hit && st.hit, detail: `placed at (${spot.x},${spot.z}) ${spot.depth} m deep; at the end (${where.x},${where.z}) with ${where.near} enemies within 15 m; ${off.detail} || ${st.detail}` };
    });
    await rec('nan-position', 'hero x = NaN', 'nonFinite', async () => {
      await clearModals(lane!);
      await lane!.page.evaluate(() => { (window as any).__ms.session.world.players[0].x = NaN; });
      for (let i = 0; i < 20 && !has(lane!, 'nonFinite').hit; i++) {
        await lane!.snap();
        await sleep(250);
      }
      const r = has(lane!, 'nonFinite', /player 0/);
      await lane!.page.evaluate(() => { const p = (window as any).__ms.session.world.players[0]; p.x = 0; p.z = 0; });
      return r;
    });
    await rec('page-freeze', 'the main thread is blocked for 50 s (a busy loop in a timer) during the run', 'pageUnresponsive (deadline 15 s) and the harness goes on when the page answers again', async () => {
      await clearModals(lane!);
      const t1 = Date.now();
      await lane!.page.evaluate(() => { setTimeout(() => { const t = performance.now(); while (performance.now() - t < 50_000) { /* frozen */ } }, 100); });
      let flagged = 0;
      for (let i = 0; i < 40 && !flagged; i++) {
        await lane!.snap();
        if (has(lane!, 'pageUnresponsive').hit) flagged = Date.now() - t1;
        await sleep(300);
      }
      let back = false;
      for (let i = 0; i < 45 && !back; i++) {
        back = await lane!.probeAlive();
        if (!back) await sleep(1500);
      }
      const r = has(lane!, 'pageUnresponsive');
      return { hit: r.hit && back, detail: `flagged after ${(flagged / 1000).toFixed(1)} s wall; page answered again: ${back} (after ${((Date.now() - t1) / 1000).toFixed(1)} s); ${r.detail}` };
    });
    await rec('webgl-lost', 'WEBGL_lose_context.loseContext()', 'webglLost', async () => {
      const ok = await lane!.page.evaluate(() => {
        const gl = (window as any).__ms.core.renderer.getContext() as WebGL2RenderingContext;
        const ext = gl.getExtension('WEBGL_lose_context');
        if (!ext) return false;
        (window as any).__qaLoseExt = ext; // kept for the restore probe: getExtension() on a LOST context answers null
        ext.loseContext();
        return true;
      });
      for (let i = 0; i < 20 && !has(lane!, 'webglLost').hit; i++) {
        await lane!.snap();
        await sleep(250);
      }
      const r = has(lane!, 'webglLost');
      return { hit: ok && r.hit, detail: `extension ${ok ? 'present' : 'MISSING'}; ${r.detail}` };
    });
    // probe (not a detector check): does the game canvas come back when the browser restores a context lost DURING A RUN? Recorded in extra.probes.
    if (want('webgl-lost')) {
      lane.run = 'probe-webgl-restore-in-run';
      const r = await lane.page.evaluate(async () => {
        // (the builder's probe asked getExtension() AFTER the loss: null on a lost context, so restoreContext() was never called and
        // "the canvas never comes back" (PLAY-3) was the probe's own bug; with the extension object of the loss the canvas comes back)
        const gl = (window as any).__ms.core.renderer.getContext() as WebGL2RenderingContext;
        const ext = (window as any).__qaLoseExt as WEBGL_lose_context | undefined;
        if (!gl.isContextLost()) return { lostBefore: false, lostAfter: false };
        ext?.restoreContext();
        const t = performance.now();
        for (let i = 0; i < 80 && gl.isContextLost(); i++) await new Promise((res) => setTimeout(res, 250));
        return { lostBefore: true, lostAfter: gl.isContextLost(), restoreMs: Math.round(performance.now() - t), extKept: !!ext };
      }).catch((e: Error) => ({ lostBefore: false, lostAfter: true, error: String(e.message).split('\n')[0] }));
      probes.push({ id: 'webgl-restore-in-run', note: 'loseContext() during a run, restoreContext() with the same extension object, 20 s to come back', ...r });
      console.log(`  [selftest] PROBE   webgl-restore-in-run: ${JSON.stringify(r)}`);
    }
    // ------------------------------------------------------------------------------------------------------------------------------ leaks
    // a fresh page for the memory series: the lost context above ends the first one
    await lane.close();
    // real (default) thresholds here: the leak probe plays ordinary runs, the tight selftest values would flag its normal loading screens
    const lane2 = await rig.mk('t2', { thresholds: thresholdsFrom(a) });
    lane = lane2;
    // ---- a small leak: one texture uploaded and kept per run, over IDENTICAL short runs through the real UI (the leak probe of campaign)
    if (want('texture-leak-small')) {
      lane2.run = 'boot2';
      await lane2.goto('/');
      await atMenu(lane2, 150);
      // the bundle's Texture class, taken once before the series (a texture of the manifest; it stays cached, every sample counts it alike)
      await lane2.page.evaluate(async () => {
        const w = window as any;
        const ids = Object.keys(w.__ms.assets.manifest.textures);
        const t = await w.__ms.assets.loadTexture(ids.find((x: string) => /logo|keyart|ui_/.test(x)) ?? ids[0]);
        w.__qaTexCtor = t.constructor;
      });
      let injected = 0;
      const runs: RunReport[] = [];
      const probeArgs = new Args(['campaign', '--timescale', '6', '--shots', '0', '--maxRunWall', '300']);
      lane2.run = 'texture-leak-small';
      const v = await leakProbe(probeArgs, lane2, runs, out, {
        zone: content.zone,
        classId: content.cls,
        n: 4,
        atSimS: 14,
        afterRun: async () => {
          injected++;
          await lane2.page.evaluate(() => {
            const w = window as any;
            // the texture class of the bundle, from a texture the renderer already holds; one fresh 4x4 canvas texture, uploaded and kept
            const ms = w.__ms;
            const cv = document.createElement('canvas');
            cv.width = cv.height = 4;
            cv.getContext('2d')!.fillRect(0, 0, 4, 4);
            const tex = new w.__qaTexCtor(cv);
            tex.needsUpdate = true;
            ms.core.renderer.initTexture(tex);
            (w.__qaSmallLeak = w.__qaSmallLeak || []).push(tex);
          });
        },
      });
      await rec('texture-leak-small', 'one texture uploaded and kept after each of 4 identical short runs (abandoned at 14 s sim)', 'leak probe verdict "leak" on textures; the same series minus the injected textures reads "ok"', async () => {
        const control = repeatLeakVerdict(v.series.map((s, i) => ({ label: s.label, mem: { ...s.mem, textures: s.mem.textures - (i + 1) } as MenuMemory })));
        const texHit = v.verdict === 'leak' && v.reasons.some((r) => /^textures/.test(r));
        return {
          hit: texHit && control.verdict === 'ok' && injected === 4 && v.series.length === 4,
          detail: `injected ${injected}; textures ${v.series.map((s) => s.mem.textures).join(' / ')}, geometries ${v.series.map((s) => s.mem.geometries).join(' / ')}, programs ${v.series.map((s) => s.mem.programs).join(' / ')}, heap ${v.series.map((s) => s.mem.heapMB).join(' / ')} MB -> ${v.verdict} (${v.reasons.join('; ') || '-'}); control without the injected ones -> ${control.verdict} (${control.reasons.join('; ') || '-'}); runs ${runs.map((r) => r.end).join(',')}`,
        };
      });
    }
    lane2.run = 'leak';
    await lane2.goto('/');
    await atMenu(lane2, 150);
    await sleep(1500);
    const series: { label: string; mem: MenuMemory }[] = [];
    const take = async (label: string): Promise<void> => {
      const mem = await lane2.measure();
      if (mem) series.push({ label, mem });
    };
    await take('baseline');
    // control: three samples with nothing allocated -> must read "ok"
    await take('control-1');
    await take('control-2');
    await take('control-3');
    await rec('leak-control', 'no allocation between samples', 'leakVerdict ok', async () => {
      const v = leakVerdict(series);
      return { hit: v.verdict === 'ok', detail: `${v.verdict}${v.reasons.length ? ' ' + v.reasons.join('; ') : ''} (heap ${series.map((s) => s.mem.heapMB).join(' / ')} MB)` };
    });
    if (want('leak-injected')) {
      const leakSeries: { label: string; mem: MenuMemory }[] = [series[0] as { label: string; mem: MenuMemory }];
      for (let i = 1; i <= 4; i++) {
        await lane2.page.evaluate(async (n) => {
          const w = window as any;
          w.__leak = w.__leak || [];
          // objects kept alive: ~50-60 MB of JS heap per batch
          const batch: unknown[] = [];
          for (let k = 0; k < 700_000; k++) batch.push({ a: k, b: 'qa-leak-' + k, c: [k, k + 1] });
          w.__leak.push(batch);
          // textures kept alive: clones of a loaded texture, uploaded (renderer.info.memory.textures grows)
          const ms = w.__ms;
          const ids = Object.keys(ms.assets.manifest.textures);
          const tex = await ms.assets.loadTexture(ids.find((x: string) => /logo|keyart|ui_/.test(x)) ?? ids[0]);
          w.__leakTex = w.__leakTex || [];
          for (let k = 0; k < 25 * n; k++) {
            // a new canvas = a new Source = a new GPU texture (clones would share the Source and the upload)
            const cv = document.createElement('canvas');
            cv.width = cv.height = 32;
            cv.getContext('2d')!.fillRect(0, 0, 32, 32);
            const c = new tex.constructor(cv);
            c.needsUpdate = true;
            ms.core.renderer.initTexture(c);
            w.__leakTex.push(c);
          }
        }, i);
        const mem = await lane2.measure();
        if (mem) leakSeries.push({ label: `leak-${i}`, mem });
      }
      await rec('leak-injected', 'allocate and keep ~55 MB of objects + 25..100 uploaded textures per sample', 'leakVerdict leak (heap and textures)', async () => {
        const v = leakVerdict(leakSeries);
        const heap = v.reasons.some((r) => /heap/.test(r));
        const tex = v.reasons.some((r) => /textures/.test(r));
        return { hit: v.verdict === 'leak' && heap && tex, detail: `${v.verdict}: ${v.reasons.join('; ') || 'none'} (heap ${leakSeries.map((s) => s.mem.heapMB).join(' / ')} MB, textures ${leakSeries.map((s) => s.mem.textures).join(' / ')})` };
      });
    }
    await rec('webgl-restore', 'loseContext() then restoreContext() on the menu canvas', 'webglcontextrestored is seen, the context is usable again, nothing throws', async () => {
      lane2.run = 'webgl-restore';
      await lane2.drain();
      const r = await lane2.page.evaluate(async () => {
        const gl = (window as any).__ms.core.renderer.getContext() as WebGL2RenderingContext;
        const ext = gl.getExtension('WEBGL_lose_context')!;
        ext.loseContext();
        await new Promise((res) => setTimeout(res, 400));
        const lost = gl.isContextLost();
        ext.restoreContext();
        for (let i = 0; i < 40 && gl.isContextLost(); i++) await new Promise((res) => setTimeout(res, 250));
        return { lost, lostAfter: gl.isContextLost(), restored: (window as any).__qa.gl.restored as number };
      });
      await lane2.snap();
      const errs = lane2.list().filter((v) => v.run === 'webgl-restore' && (v.detector === 'pageError' || v.detector === 'windowError')).length;
      return { hit: r.lost && !r.lostAfter && r.restored >= 1 && errs === 0, detail: `lost ${r.lost}; lost after restore ${r.lostAfter}; restored events ${r.restored}; page errors ${errs}` };
    });
    await lane2.close();
    // ----------------------------------------------------------------------------------------- a real page of the PLAIN dist has no hook
    if (want('hook-page')) {
      const prodRig = await makeRig(args, snap.distProd, out, true);
      try {
        const lp = await prodRig.mk('t3');
        lp.run = 'plain-dist';
        await lp.goto('/');
        const up = await atMenuDom(lp);
        const absent = (await lp.page.evaluate(() => typeof (window as any).__ms === 'undefined')) as boolean;
        await rec('hook-page', 'load the plain production dist in the browser', 'menu shows and window.__ms is undefined', async () => ({ hit: up && absent, detail: `menu ${up}; window.__ms ${absent ? 'undefined' : 'PRESENT'}` }));
        await lp.close();
      } finally {
        await prodRig.stop();
      }
    }
    const missed = checks.filter((c) => !c.fired);
    const summary: Summary = {
      mode: 'selftest',
      args: process.argv.slice(2),
      snapshot: { stamp: snap.stamp, out: snap.out, manifestSha256: snap.manifestSha256.afterBuilds, gitStatusLines: snap.gitStatusPorcelain.length },
      startedAt: new Date(t0).toISOString(),
      wallS: +((Date.now() - t0) / 1000).toFixed(1),
      cpuLoadStart: cpuStart,
      cpuLoadEnd: await cpuLoad(),
      viewport: viewFrom(a),
      api: 'offline (503)',
      runs: [],
      violations: [],
      consoleSummary: [],
      requests: {},
      fallbacks: [],
      notes: [`${checks.length - missed.length}/${checks.length} detectors fired`],
      extra: { checks, probes },
      ok: missed.length === 0,
      exitCode: missed.length === 0 ? 0 : 1,
    };
    const p = writeSummary(out, summary);
    console.log(`[selftest] ${checks.length - missed.length}/${checks.length} checks passed${missed.length ? `; MISSED: ${missed.map((m) => m.id).join(', ')}` : ''} -> ${p}`);
    return summary.exitCode;
  } catch (e) {
    console.error(`[selftest] aborted: ${String((e as Error).stack ?? e)}`);
    writeSummary(out, { mode: 'selftest', args: process.argv.slice(2), snapshot: null, startedAt: new Date(t0).toISOString(), wallS: +((Date.now() - t0) / 1000).toFixed(1), cpuLoadStart: cpuStart, cpuLoadEnd: null, viewport: viewFrom(a), api: 'offline', runs: [], violations: [], consoleSummary: [], requests: {}, fallbacks: [], notes: [`ABORTED ${String(e).slice(0, 400)}`], extra: { checks }, ok: false, exitCode: 1 });
    return 1;
  } finally {
    await rig.stop();
  }
}

async function atMenuDom(lane: Lane): Promise<boolean> {
  for (let i = 0; i < 600; i++) {
    if (await lane.visible('.ms-menu-nav .ms-menu-play')) return true;
    await sleep(250);
  }
  return false;
}
