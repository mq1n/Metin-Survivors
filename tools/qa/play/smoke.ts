// smoke mode: the PLAIN production dist (no hook, no window.__ms) played with REAL input only - WASD key holds, card clicks, Esc, the pause
// menu, real time. Fresh profile for the first zone, a pre-seeded save for the others. The in-page runtime of the harness is injected only
// for its passive detectors (errors, rejections, WebGL, CSP, long tasks, frame times); it cannot steer anything.
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Args, cpuLoad, makeRig, outDirFor, pickSnapshot, REAL, seedRecord, seedRecordVet, viewFrom, writeSummary, type Summary } from './common';
import { sleep, type Lane } from './lane';
import { readZones, type ZoneRow } from './runner';

interface SmokeRun {
  zone: string;
  zoneIndex: number;
  classId: string;
  seeded: boolean;
  ok: boolean;
  hookAbsent: boolean;
  bootS: number;
  loadS: number;
  runClockS: number;
  wallPlayS: number;
  cards: number;
  stories: number;
  modalsHeld: number;
  died: boolean;
  pausedOk: boolean;
  abandonedOk: boolean;
  resultsText: string;
  perf: unknown;
  /** --gaps 1: every requestAnimationFrame gap > 250 ms of the page with the screen parts on show (plain build, no hook needed) */
  gaps?: unknown;
  notes: string[];
  shots: string[];
}

const mmss = (t: string): number => {
  const m = /(\d+):(\d{2})/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : -1;
};

async function clock(lane: Lane): Promise<number> {
  return mmss(await lane.page.locator('.ms-tm-time').first().innerText({ timeout: 1500 }).catch(() => ''));
}

/** answers a story / card modal by clicking it (DOM only); returns what it did */
async function answer(lane: Lane, st: { cards: number; stories: number; held: number; modalSince: number; modalKey: string }): Promise<'story' | 'card' | 'boss' | 'wait' | null> {
  if (await lane.visible('.ms-story-plate')) {
    await lane.click('.ms-story-actions button', { last: true, timeout: 2500 });
    st.stories++;
    return 'story';
  }
  if ((await lane.count('.ms-cardmodal')) > 0) {
    const faceUp = lane.page.locator('.ms-cardmodal .ms-card:not(.ms-boss-back)');
    const n = await faceUp.count();
    if (n > 0) {
      await sleep(900);
      const ok = await faceUp.nth((st.cards * 3 + 1) % n).click({ timeout: 4000 }).then(() => true).catch(() => false);
      if (ok) st.cards++;
      else if (await faceUp.first().click({ timeout: 2500, force: true }).then(() => true).catch(() => false)) st.cards++;
      await sleep(900);
      return 'card';
    }
    const back = lane.page.locator('.ms-cardmodal .ms-boss-back');
    if ((await back.count()) > 0) {
      const box = await back.first().boundingBox().catch(() => null);
      if (box) {
        await lane.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await lane.page.mouse.down();
        await sleep(1100);
        await lane.page.mouse.up();
        st.held++;
      }
      return 'boss';
    }
    await sleep(400);
    return 'wait';
  }
  return null;
}

async function playZone(a: Args, lane: Lane, zoneId: string | null, zoneIndex: number, classId: string, seeded: boolean, out: string): Promise<{ run: SmokeRun; zones: ZoneRow[] }> {
  const seconds = a.num('seconds', 180);
  const run: SmokeRun = { zone: zoneId ?? '(first)', zoneIndex, classId, seeded, ok: false, hookAbsent: false, bootS: 0, loadS: 0, runClockS: 0, wallPlayS: 0, cards: 0, stories: 0, modalsHeld: 0, died: false, pausedOk: false, abandonedOk: false, resultsText: '', perf: null, notes: [], shots: [] };
  const label = `smoke-${zoneIndex + 1}-${zoneId ?? 'first'}`;
  lane.run = label;
  const shot = async (n: string): Promise<void> => {
    const p = await lane.shot(`${label}-${n}`);
    if (p) run.shots.push(p);
  };
  const waitSel = async (sel: string, ms: number): Promise<boolean> => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await lane.visible(sel)) return true;
      await lane.drain();
      await sleep(250);
    }
    return false;
  };
  if (a.flag('gaps', false)) {
    await lane.page.addInitScript(() => {
      const g: unknown[] = [];
      let last = performance.now();
      const f = (t: number): void => {
        const dt = t - last;
        last = t;
        if (dt > 250) {
          const q = (sel: string): boolean => !!document.querySelector(sel);
          g.push({ at: +(t / 1000).toFixed(2), ms: Math.round(dt), boot: q('.ms-boot'), menu: q('.ms-menu-nav'), heroSel: q('.ms-hs-next'), zoneSel: q('.ms-zs-enter'), story: q('.ms-story-actions'), cards: q('.ms-cardmodal'), hud: q('.ms-hud'), pause: q('.ms-pause-actions'), results: q('.ms-re-actions') });
        }
        requestAnimationFrame(f);
      };
      requestAnimationFrame(f);
      (window as unknown as { __gaps: unknown[] }).__gaps = g;
    });
  }
  const tBoot = Date.now();
  if (seeded) await lane.seed((a.flag('vet', false) ? seedRecordVet : seedRecord)(zonesSeed.get(zoneIndex) ?? [], []));
  await lane.goto('/');
  if (!(await waitSel('.ms-menu-nav .ms-menu-play', 150_000))) {
    lane.v('bootFailed', 'blocker', `the production bundle never showed the main menu (#ui: ${(await lane.page.locator('#ui').innerText().catch(() => '')).slice(0, 200)})`);
    return { run, zones: [] };
  }
  run.bootS = +((Date.now() - tBoot) / 1000).toFixed(1);
  // the plain build must not publish the app
  run.hookAbsent = (await lane.page.evaluate(() => typeof (window as any).__ms === 'undefined')) as boolean;
  if (!run.hookAbsent) lane.v('hookInProd', 'blocker', 'window.__ms exists in the plain production build');
  await sleep(1200);
  await shot('01-menu');
  await lane.click('.ms-menu-nav .ms-menu-play', { timeout: 8000 });
  if (!(await waitSel('.ms-hs-next', 60_000))) {
    lane.v('uiClick', 'blocker', 'PLAY did not lead to the hero select');
    return { run, zones: [] };
  }
  await sleep(800);
  if (!(await lane.click(`.ms-hs-class[data-class="${classId}"]`, { timeout: 5000 }))) run.notes.push(`hero card ${classId} could not be clicked (kept the default)`);
  await sleep(300);
  await lane.click('.ms-hs-next', { timeout: 8000 });
  if (!(await waitSel('.ms-zs-enter button', 60_000))) {
    lane.v('uiClick', 'blocker', 'hero NEXT did not lead to the zone select');
    return { run, zones: [] };
  }
  await sleep(1200);
  const zones = await readZones(lane);
  const target = zoneId ?? zones.find((z) => !z.locked)?.id ?? null;
  run.zone = target ?? '(none)';
  if (!target) {
    lane.v('uiClick', 'blocker', 'no unlocked zone on the atlas');
    return { run, zones };
  }
  const row = zones.find((z) => z.id === target);
  if (row?.locked) {
    lane.v('zoneLocked', 'blocker', `zone ${target} is locked on the atlas of a profile seeded with it unlocked`);
    return { run, zones };
  }
  if (row && !row.selected) {
    const ok = (await lane.click(`.ms-zs-hit[data-zone="${target}"]`, { timeout: 2500 })) || (await lane.click(`.ms-zs-region:has(.ms-zs-hit[data-zone="${target}"]) .ms-zs-plate`, { timeout: 2500 }));
    if (!ok) lane.v('uiClick', 'major', `zone card ${target} could not be clicked (real click); the smoke will play whatever is selected`);
    await sleep(300);
  }
  await shot('02-zone-select');
  const tStart = Date.now();
  await lane.click('.ms-zs-enter button', { timeout: 8000 });
  const hud = await waitSel('.ms-hud', 240_000);
  run.loadS = +((Date.now() - tStart) / 1000).toFixed(1);
  if (!hud) {
    lane.v('runLoadFailed', 'blocker', `no HUD within 240 s of ENTER (${(await lane.page.locator('.ms-boot.is-failed, #boot-retry').first().innerText().catch(() => '')).slice(0, 200)})`);
    return { run, zones };
  }
  await lane.page.evaluate(() => (window as any).__qa.beginRaw());
  // ---- play: WASD pattern + modals, real time
  const st = { cards: 0, stories: 0, held: 0, modalSince: 0, modalKey: '' };
  const keys = ['KeyW', 'KeyD', 'KeyS', 'KeyA'];
  let k = 0;
  let lastClock = -1;
  let clockSince = Date.now();
  const rafNow = async (): Promise<number> => (await lane.ev(() => (window as any).__qa?.raf ?? -1, undefined, 'frame count').catch(() => -1)) as number;
  let rafAtClock = -1;
  let shotMid = false;
  let modalOpenSince = 0;
  const tPlay = Date.now();
  while (Date.now() - tPlay < a.num('maxWall', seconds * 3 + 120) * 1000) {
    if (await lane.visible('.ms-re-actions')) {
      run.died = true;
      break;
    }
    const did = await answer(lane, st);
    if (did) {
      if (!modalOpenSince) modalOpenSince = Date.now();
      else if (Date.now() - modalOpenSince > 20_000) {
        lane.v('modalStuck', 'blocker', `a modal has stayed open for ${Math.round((Date.now() - modalOpenSince) / 1000)} s while the smoke clicked it (${st.cards} cards, ${st.stories} stories)`);
        modalOpenSince = Date.now();
      }
      lane.markProgress();
      continue;
    }
    modalOpenSince = 0;
    await lane.drain();
    const c = await clock(lane);
    run.runClockS = Math.max(run.runClockS, c);
    if (c !== lastClock) {
      lastClock = c;
      clockSince = Date.now();
      rafAtClock = await rafNow();
    } else if (Date.now() - clockSince > 8000 && !(await lane.visible('.ms-pause-actions'))) {
      // the page's own frame counter (pagehook, passive in the plain build) tells a frozen game (frames go on) from a page that drew nothing
      const frames = rafAtClock >= 0 ? (await rafNow()) - rafAtClock : 99;
      if (frames >= 10) lane.v('simClockStalled', 'blocker', `the run clock stayed at ${c} s for 8 s of real time with no modal open while the page drew ${frames} frames`);
      else lane.v('frameStall', 'major', `the page drew ${frames} frame(s) in 8 s of real time on the run screen (clock ${c} s): a GPU / compositor stall`);
      clockSince = Date.now();
      rafAtClock = await rafNow();
    }
    if (c >= seconds) break;
    if (!shotMid && c >= seconds / 2) {
      shotMid = true;
      await shot('03-run-mid');
    }
    const key = keys[k++ % keys.length] as string;
    if (lane.opts.touch) await touchHold(lane, key, 1300);
    else {
      await lane.page.keyboard.down(key);
      await sleep(1300);
      await lane.page.keyboard.up(key);
    }
  }
  run.wallPlayS = +((Date.now() - tPlay) / 1000).toFixed(1);
  run.perf = await lane.page.evaluate(() => (window as any).__qa.endRaw());
  if (a.flag('gaps', false)) run.gaps = await lane.page.evaluate(() => (window as any).__gaps ?? null).catch(() => null);
  run.cards = st.cards;
  run.stories = st.stories;
  run.modalsHeld = st.held;
  await shot('04-run-end-of-play');
  if (run.died) {
    run.notes.push('the hero died before the time was up (real input, no god mode)');
  } else {
    // ---- pause (Esc) and abandon, through the real menu; a card modal swallows Esc, so answer those first
    let paused = false;
    for (let attempt = 0; attempt < 6 && !paused; attempt++) {
      for (let i = 0; i < 10 && (await answer(lane, st)); i++) await sleep(300);
      await lane.page.keyboard.press('Escape');
      paused = await waitSel('.ms-pause-actions', 5000);
    }
    run.pausedOk = paused;
    if (!paused) lane.v('pauseUi', 'major', 'Esc never opened the pause overlay');
    else {
      const c1 = await clock(lane);
      await sleep(1800);
      const c2 = await clock(lane);
      if (c1 !== c2) lane.v('pauseNotFrozen', 'major', `the run clock moved ${c1} -> ${c2} s while paused`);
      await shot('05-pause');
      await lane.click('.ms-pause-act-l button', { timeout: 5000 });
      await sleep(900);
      const okc = await lane.click('[role="dialog"] button, .ms-modal-card button, .ms-kdlg button', { last: true, text: /^\s*(Abandon|Bırak)\s*$/i, timeout: 5000 });
      run.abandonedOk = okc && (await waitSel('.ms-re-actions', 30_000));
      if (!run.abandonedOk) lane.v('abandonFailed', 'major', 'pause -> Abandon -> confirm did not lead to the results screen');
    }
  }
  if (await lane.visible('.ms-re-actions')) {
    await sleep(4500);
    await shot('06-results');
    run.resultsText = ((await lane.page.locator('.ms-re-root').first().innerText().catch(() => '')) as string).replace(/\s+/g, ' ').slice(0, 700);
    if (!/\d{1,3}:\d{2}/.test(run.resultsText)) lane.v('resultsContent', 'major', 'the results report shows no time');
    const back = await lane.click('.ms-re-actions button', { last: true, text: /Main menu|Ana menü/i, timeout: 5000 });
    if (!back || !(await waitSel('.ms-menu-nav .ms-menu-play', 30_000))) lane.v('uiClick', 'blocker', 'results "Main menu" did not lead back to the menu');
  } else lane.v('resultsMissing', 'blocker', 'no results report after the run');
  run.ok = run.hookAbsent && run.runClockS >= Math.min(seconds, 30) && !!run.resultsText;
  return { run, zones };
}

const zonesSeed = new Map<number, string[]>();

/** phone viewport: the WASD pattern becomes a real touch drag on the floating joystick (CDP touch events: pointerType touch on the canvas) */
async function touchHold(lane: Lane, key: string, ms: number): Promise<void> {
  const cdp = await lane.page.context().newCDPSession(lane.page);
  const vp = lane.page.viewportSize() ?? { width: 390, height: 844 };
  const bx = Math.round(vp.width * 0.25);
  const by = Math.round(vp.height * 0.65);
  const d = key === 'KeyW' ? [0, -48] : key === 'KeyS' ? [0, 48] : key === 'KeyA' ? [-48, 0] : [48, 0];
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bx, y: by, id: 1 }] });
    await sleep(60);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: bx + (d[0] as number), y: by + (d[1] as number), id: 1 }] });
    await sleep(ms);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await cdp.detach().catch(() => undefined);
  }
}

export async function smoke(a: Args): Promise<number> {
  const t0 = Date.now();
  const snap = await pickSnapshot(a);
  const out = outDirFor(a, 'smoke');
  const cpuStart = await cpuLoad();
  const rig = await makeRig(a, snap.distProd, out, true);
  const runs: SmokeRun[] = [];
  const lanes: Lane[] = [];
  const classes = a.has('classes') ? a.list('classes') : ['warrior', 'ninja', 'yacha', 'shaman', 'wolfman'];
  try {
    // ---- zone 1 on a fresh profile (also tells the zone order from the atlas)
    const lane1 = await rig.mk('s1');
    lanes.push(lane1);
    const first = await playZone(a, lane1, null, 0, classes[0] as string, false, out);
    runs.push(first.run);
    const order = first.zones.map((z) => z.id);
    console.log(`[smoke] zone order from the atlas: ${order.join(' -> ') || '(unknown)'}`);
    const want = a.has('zones') ? a.list('zones') : order;
    const rest = want.filter((z) => z !== first.run.zone);
    for (const z of rest) {
      const idx = order.indexOf(z);
      zonesSeed.set(idx, order.slice(0, idx + 1));
    }
    // the first-zone lane is done: close it (and free its Chrome slot) before the pool starts, so `--lanes 2` is 2 Chromes at once, not 3
    await lane1.close();
    const pool = Math.min(2, Math.max(1, a.num('lanes', 1)));
    const queue = [...rest];
    await Promise.all(
      Array.from({ length: pool }, async (_, w) => {
        for (;;) {
          const z = queue.shift();
          if (!z) return;
          const idx = order.indexOf(z);
          const lane = await rig.mk(`s${idx + 1}-${w}`);
          lanes.push(lane);
          try {
            const r = await playZone(a, lane, z, idx, classes[idx % classes.length] as string, true, out);
            runs.push(r.run);
          } finally {
            await lane.close();
          }
        }
      }),
    );
    const all = lanes.flatMap((l) => l.list());
    const summary: Summary = {
      mode: 'smoke',
      args: process.argv.slice(2),
      snapshot: { stamp: snap.stamp, out: snap.out, manifestSha256: snap.manifestSha256.afterBuilds, gitStatusLines: snap.gitStatusPorcelain.length },
      startedAt: new Date(t0).toISOString(),
      wallS: +((Date.now() - t0) / 1000).toFixed(1),
      cpuLoadStart: cpuStart,
      cpuLoadEnd: await cpuLoad(),
      viewport: viewFrom(a),
      api: a.str('api', 'offline (503)'),
      runs,
      violations: all,
      consoleSummary: lanes.flatMap((l) => l.consoleSummary()),
      requests: lanes.map((l) => l.requests),
      fallbacks: lanes.flatMap((l) => l.fallbacks),
      notes: lanes.flatMap((l) => l.notes),
      extra: { dist: snap.distProd, hookCheckProd: snap.hookInProd },
      ok: !all.some(REAL) && runs.every((r) => r.ok),
      exitCode: !all.some(REAL) && runs.every((r) => r.ok) ? 0 : 1,
    };
    mkdirSync(out, { recursive: true });
    const p = writeSummary(out, summary);
    for (const r of runs) writeFileSync(join(out, `run-${r.zoneIndex + 1}-${r.zone}.json`), JSON.stringify(r, null, 2));
    console.log(`[smoke] ${summary.ok ? 'OK' : 'FAILED'} ${all.filter(REAL).length} violation(s) -> ${p}`);
    return summary.exitCode;
  } catch (e) {
    console.error(`[smoke] aborted: ${String((e as Error).stack ?? e)}`);
    return 1;
  } finally {
    await rig.stop();
  }
}
