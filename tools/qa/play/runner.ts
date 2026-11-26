// The player: drives one lane through the REAL UI (menu -> hero select -> zone select -> ENTER -> run -> run-end -> results -> menu) while the
// in-page bot (pagehook.js) steers the hero at accelerated speed. Every modal is answered by clicking the DOM; a lower-level fallback
// (the element's own click(), then the store command) is allowed so the run can go on, and is itself recorded as a finding.
import type { Lane, MenuMemory, Snap } from './lane';
import { sleep, WallTimeoutError, withWallTimeout } from './lane';

export interface RunCfg {
  label: string;
  zone: string;
  classId: string;
  doctrine: 'a' | 'b';
  difficulty: 'normal' | 'hard';
  god: boolean;
  /** the deliberate defeat: the hero is held at 1 hp (no god mode) so the first landed hit kills it; an idle hero at full hp WINS zone 1 */
  handicap?: boolean;
  /** 'play' = the bot hunts; 'idle' = stands still (the deliberate defeat) */
  bot: 'play' | 'idle';
  timeScale: number;
  /** end the run at this sim second by pausing and abandoning (a short run); absent = play to the end */
  abandonAtSimS?: number;
  /** pause for ~2 s at this sim second and check the clock is frozen, then resume */
  pauseTestAtSimS?: number;
  /** give up (violation) after this many wall seconds */
  maxWallS: number;
  /** independent hard wall-clock ceiling (seconds) that aborts playRun even if an async helper stalls */
  hardWallS?: number;
  /** milestone screenshots */
  shots: boolean;
  /** the zone's final boss (content `zones[].final.boss`): a victory must have killed it */
  finalBoss?: string;
  /** once the sim runs: bot off, hold a movement key (or drag the touch stick) and check the hero moved: the real input path */
  inputProbe?: boolean;
  /** the leak probe: answer level-up / reward cards with the store's skip (no new skill content between identical runs) */
  skipCards?: boolean;
  /** hero sex to select on the hero-select plate (m | f; ignored with a note when the class has only the other one) */
  sex?: 'm' | 'f';
  /** QA speed-up (matrix): the first N level-up / essence modals of a run are answered by real clicks, the rest with store.chooseCard (a UI click costs ~3.5 s wall of 60 level-ups); chest / boss reward cards are always clicked */
  fastCardsAfter?: number;
}

export interface ZoneRow {
  id: string;
  selected: boolean;
  locked: boolean;
}

export interface RunReport {
  cfg: RunCfg;
  startedAt: string;
  end: 'victory' | 'defeat' | 'abandon' | 'timeout' | 'error' | 'pending';
  wallS: number;
  loadS: number;
  phases: Record<string, number>;
  sim: { time: number; level: number; kills: number; finalAt: number; bossesSeen: string[]; maxEnemyRows: number } | null;
  result: Record<string, unknown> | null;
  resultsDom: { title: string; tiles: number; leds: number; actions: number; hasTime: boolean; hasKills: boolean; hasLevel: boolean; text: string } | null;
  perf: unknown;
  menuMemory: MenuMemory | null;
  saveBefore: unknown;
  saveAfter: unknown;
  timeline: { wall: number; sim: number; level: number; kills: number; rows: number; hp: number; hpMax: number; screen: string }[];
  modals: Record<string, number>;
  pauseTest: { ok: boolean; frozenFor: number; note: string } | null;
  inputProbe?: { ok: boolean; moved: Record<string, number>; note: string } | null;
  shots: string[];
  violations: number;
}

/** zone rows of the atlas on the zone-select screen, in DOM order */
export async function readZones(lane: Lane): Promise<ZoneRow[]> {
  return (await lane
    .ev(
      () =>
        Array.from(document.querySelectorAll<HTMLElement>('.ms-zs-hit[data-zone]')).map((el) => ({
          id: el.dataset.zone as string,
          selected: el.getAttribute('aria-checked') === 'true',
          locked: !!el.closest('.ms-zs-region')?.classList.contains('is-locked'),
        })),
      undefined,
      'read zones',
    )
    .catch(() => [])) as ZoneRow[];
}

export async function atMenu(lane: Lane, timeoutS = 60): Promise<boolean> {
  const s = await lane.waitFor('main menu', (x) => x.screen === 'menu', timeoutS);
  if (!s) return false;
  for (let i = 0; i < 100; i++) {
    if (await lane.visible('.ms-menu-nav .ms-menu-play')) return true;
    await sleep(200);
  }
  lane.v('menuNotShown', 'major', 'the store says menu but the PLAY button never became visible');
  return false;
}

/** a click that timed out on a starved page may still have gone through: true when the screen already moved on to `screen` */
async function movedOn(lane: Lane, screen: string): Promise<boolean> {
  const s = await lane.snap();
  return s?.screen === screen;
}

/** menu -> hero select -> zone select -> ENTER, by clicking. Returns false when the run could not be entered. */
export async function enterRun(lane: Lane, cfg: RunCfg, rep: RunReport): Promise<boolean> {
  const t = Date.now();
  const mark = (k: string): void => {
    rep.phases[k] = +((Date.now() - t) / 1000).toFixed(1);
  };
  if (!(await atMenu(lane))) return false;
  await sleep(300);
  // ---- PLAY
  const play = await lane.clickLadder('.ms-menu-nav .ms-menu-play');
  if (play === 'none' && !(await movedOn(lane, 'heroSelect'))) {
    lane.v('uiClick', 'blocker', `the PLAY button could not be clicked: ${await lane.diagnose('play')}`);
    return false;
  }
  // a button only element.click() reaches (an overlay eats the pointer) is a broken DOM path even though the flow goes on
  if (play === 'dom') lane.fallback('main menu PLAY button', 'element.click()');
  if (!(await lane.waitFor('hero select', (s) => s.screen === 'heroSelect', 30))) return false;
  for (let i = 0; i < 60 && !(await lane.visible('.ms-hs-next')); i++) await sleep(250);
  mark('heroSelect');
  // ---- class + doctrine
  const cls = lane.page.locator(`.ms-hs-class[data-class="${cfg.classId}"]`).first();
  if ((await cls.count()) === 0) {
    lane.v('uiClick', 'major', `hero select has no card for class ${cfg.classId}`);
  } else if ((await cls.getAttribute('aria-checked')) !== 'true') {
    if (!(await lane.click(`.ms-hs-class[data-class="${cfg.classId}"]`, { timeout: 5000 }))) {
      const lvl = await lane.clickLadder(`.ms-hs-class[data-class="${cfg.classId}"]`, { timeout: 1500 });
      if (lvl === 'dom') lane.fallback(`hero card ${cfg.classId}`, 'element.click()'); // 'none' is caught by the read-back below (store.select)
    }
  }
  await sleep(250);
  // the doctrine of the previous run stays selected: set it both ways (the old code only ever clicked B, so a run after a B run played B while
  // the report said A; clicking a doctrine that is already selected PROCEEDS to the next screen, so only an unselected one is clicked)
  {
    const dsel = `.ms-hs [data-doctrine="${cfg.doctrine}"]`;
    const d = lane.page.locator(dsel).first();
    if ((await d.count()) > 0) {
      const on = (await lane.snap())?.sel?.doctrine === cfg.doctrine || (await d.getAttribute('aria-checked').catch(() => null)) === 'true';
      if (!on && (await lane.clickLadder(dsel, { timeout: 6000 })) === 'dom') lane.fallback(`doctrine ${cfg.doctrine.toUpperCase()} button`, 'element.click()');
    } else lane.notes.push(`${cfg.label}: no [data-doctrine="${cfg.doctrine}"] control on hero select`);
  }
  if (cfg.sex) {
    const sexSel = '.ms-hs-plate [role="radio"]';
    const idx = cfg.sex === 'm' ? 0 : 1;
    const btn = lane.page.locator(sexSel).nth(idx);
    if ((await btn.count().catch(() => 0)) === 0) lane.notes.push(`${cfg.label}: no sex control on the hero-select plate`);
    else if ((await btn.getAttribute('aria-disabled').catch(() => null)) === 'true') lane.notes.push(`${cfg.label}: ${cfg.classId} has no ${cfg.sex} sex (single-sex class), left as is`);
    else if ((await btn.getAttribute('aria-checked').catch(() => null)) !== 'true') {
      if (!(await lane.click(sexSel, { timeout: 4000, nth: idx }))) {
        const dom = await lane
          .ev(
            ([q, i]: [string, number]) => {
              const el = document.querySelectorAll<HTMLElement>(q)[i];
              if (!el) return false;
              el.click();
              return true;
            },
            [sexSel, idx] as [string, number],
            'sex click fallback',
          )
          .catch(() => false);
        if (dom) lane.fallback(`sex ${cfg.sex} button`, 'element.click()');
        else lane.v('uiClick', 'major', `the ${cfg.sex} sex button on hero select could not be clicked`);
      }
      await sleep(250);
      const got = (await lane.snap())?.sel?.sex;
      if (got && got !== cfg.sex) lane.v('selectionMismatch', 'major', `sex ${cfg.sex} was clicked on hero select but the selection says ${got}`);
    }
  }
  let s = await lane.snap();
  if (s?.sel && (s.sel.classId !== cfg.classId || s.sel.doctrine !== cfg.doctrine)) {
    lane.fallback(`hero select ${cfg.classId}/${cfg.doctrine}`, `store.select (the UI left ${s.sel.classId}/${s.sel.doctrine})`);
    await lane
      .ev((c: { classId: string; doctrine: string }) => (window as any).__ms.store.select({ classId: c.classId, doctrine: c.doctrine }), { classId: cfg.classId, doctrine: cfg.doctrine }, 'hero store.select')
      .catch(() => undefined);
  }
  await lane.shot(`${cfg.label}-02-hero-select`);
  const next = await lane.clickLadder('.ms-hs-next');
  if (next === 'none' && !(await movedOn(lane, 'zoneSelect'))) {
    lane.v('uiClick', 'blocker', 'the hero-select NEXT button could not be clicked');
    return false;
  }
  if (next === 'dom') lane.fallback('hero-select NEXT button', 'element.click()');
  if (!(await lane.waitFor('zone select', (x) => x.screen === 'zoneSelect', 30))) return false;
  for (let i = 0; i < 80 && (await lane.count('.ms-zs-hit[data-zone]')) === 0; i++) await sleep(250);
  await sleep(600);
  mark('zoneSelect');
  // ---- zone (+ hard)
  const rows = await readZones(lane);
  const row = rows.find((r) => r.id === cfg.zone);
  if (!row) {
    lane.v('uiClick', 'blocker', `zone select has no zone ${cfg.zone} (has ${rows.map((r) => r.id).join(',')})`);
    return false;
  }
  if (row.locked) {
    lane.v('zoneLocked', 'blocker', `zone ${cfg.zone} is still locked on the atlas (unlocked: ${rows.filter((r) => !r.locked).map((r) => r.id).join(',') || 'none'})`);
    return false;
  }
  if (!row.selected) {
    const sel = `.ms-zs-hit[data-zone="${cfg.zone}"]`;
    let ok = await lane.click(sel, { timeout: 2500 });
    if (!ok) {
      // the hit area is a clip-path polygon: the plate / banner of the region picks the same zone
      ok = await lane.click(`.ms-zs-region:has(${sel}) .ms-zs-plate`, { timeout: 2500 });
      if (ok) lane.notes.push(`${cfg.label}: the zone hit-area click was intercepted; the zone plate click worked`);
    }
    if (!ok) {
      const lvl = await lane.clickLadder(sel, { timeout: 800 });
      if (lvl === 'dom') lane.fallback(`zone card ${cfg.zone}`, 'element.click()');
      else if (lvl === 'none') lane.v('uiClick', 'major', `zone card ${cfg.zone} could not be clicked at all`);
    }
    await sleep(300);
  }
  // the difficulty of the previous run stays selected too: set it both ways (the old code only clicked Hard, never back to Normal)
  {
    const dsel = cfg.difficulty === 'hard' ? '.ms-zs-segbtn.is-hard' : '.ms-zs-segbtn:not(.is-hard)';
    const cur = (await lane.snap())?.sel?.difficulty;
    if (cfg.difficulty === 'hard') {
      const hardOff = await lane
        .ev(() => document.querySelector('.ms-zs-segbtn.is-hard')?.getAttribute('aria-disabled') === 'true', undefined, 'hard disabled check')
        .catch(() => false);
      if (hardOff) {
        lane.v('hardLocked', 'major', `hard mode of ${cfg.zone} is locked in the UI after its normal clear`);
        return false;
      }
    }
    if (cur !== cfg.difficulty && (await lane.count(dsel)) > 0) {
      if ((await lane.clickLadder(dsel, { timeout: 6000 })) === 'dom') lane.fallback(`${cfg.difficulty} difficulty button`, 'element.click()');
      await sleep(250);
    }
  }
  s = await lane.snap();
  if (s?.sel && (s.sel.zone !== cfg.zone || s.sel.difficulty !== cfg.difficulty)) {
    lane.fallback(`zone select ${cfg.zone}/${cfg.difficulty}`, `store.select (the UI left ${s.sel.zone}/${s.sel.difficulty})`);
    await lane
      .ev((c: { zone: string; difficulty: string }) => (window as any).__ms.store.select({ zone: c.zone, difficulty: c.difficulty }), { zone: cfg.zone, difficulty: cfg.difficulty }, 'zone store.select')
      .catch(() => undefined);
  }
  await lane.shot(`${cfg.label}-03-zone-select`);
  // ---- ENTER
  const t1 = Date.now();
  const enter = await lane.clickLadder('.ms-zs-enter button', { timeout: 20000 });
  if (enter === 'none' && !['loading', 'run'].includes((await lane.snap())?.screen ?? '')) {
    lane.v('uiClick', 'blocker', 'the zone ENTER button could not be clicked');
    return false;
  }
  if (enter === 'dom') lane.fallback('zone ENTER button', 'element.click()');
  const run = await lane.waitFor('run screen', (x) => x.screen === 'run' || !!x.loading?.error, 240, 200);
  rep.loadS = +((Date.now() - t1) / 1000).toFixed(1);
  if (!run) return false;
  if (run.loading?.error && run.screen !== 'run') {
    lane.v('runLoadFailed', 'blocker', `the run did not load: ${run.loading.error}`);
    return false;
  }
  mark('run');
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------- modals
/** answers whatever modal is open by clicking it; true when it did something (or is waiting on an animation). */
export async function handleModal(lane: Lane, s: Snap, rep: { modals: Record<string, number> }): Promise<boolean> {
  // per lane: one module-global state let the two lanes of `matrix --lanes 2` reset each other's timers (neither ever clicked)
  const handlerState = lane.handler;
  const m = s.modal;
  if (!m) return false;
  const key = `${m.kind}:${m.id}`;
  if (m.kind === 'pause' || m.kind === 'runEnd') return false;
  if (key !== handlerState.lastClickKey) {
    rep.modals[m.kind] = (rep.modals[m.kind] ?? 0) + 1;
    handlerState.lastClickKey = key;
    // the card modals ignore input for ~420 ms after they open and deal their cards in: look again after ~700 ms
    handlerState.lastClickAt = Date.now() - 1000;
    handlerState.tries.set(key, 0);
  }
  const tries = handlerState.tries.get(key) ?? 0;
  const since = Date.now() - handlerState.lastClickAt;
  if (m.kind === 'story') {
    if (since < 700) return true;
    handlerState.lastClickAt = Date.now();
    handlerState.tries.set(key, tries + 1);
    if (await lane.click('.ms-story-actions button', { last: true, timeout: 2500 })) return true;
    if (tries >= 3) {
      // the keyboard works for keyboard players; a story button the pointer cannot reach is still a broken path for mouse / touch
      lane.fallback(`story notice ${m.story ?? ''} button (${key})`, 'keyboard Enter');
      await lane.page.keyboard.press('Enter').catch(() => undefined);
      if (tries >= 5) {
        lane.fallback(`story notice ${m.story ?? ''} (${key})`, 'store.dismissStory');
        await lane.ev(() => (window as any).__ms.store.dismissStory(), undefined, 'dismissStory').catch(() => undefined);
      }
    }
    return true;
  }
  // card modals: levelUp / essence / chest / bossReward
  if (since < 1700) return true;
  const faceUp = lane.page.locator('.ms-cardmodal .ms-card:not(.ms-boss-back)');
  const n = await faceUp.count().catch(() => 0);
  if (n === 0) {
    const back = lane.page.locator('.ms-cardmodal .ms-boss-back');
    if ((await back.count().catch(() => 0)) > 0) {
      // legendary boss cards: hold the pointer on a face-down card until it flips (keyboard Enter would do the same)
      const box = await back.first().boundingBox().catch(() => null);
      if (box) {
        await lane.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await lane.page.mouse.down();
        await sleep(1100);
        await lane.page.mouse.up();
        lane.modalClicks++;
        handlerState.lastClickAt = Date.now() - 900;
      }
    }
    // a chest opens by itself a moment after it shows; cards are dealt in over a second
    if (tries > 18) {
      handlerState.tries.set(key, tries + 1);
      if (tries === 19) lane.v('modalNoCards', 'major', `card modal ${key} shows no clickable card after ${tries} polls`);
      if (tries > 40) {
        lane.fallback(`card modal ${key} (no clickable card)`, 'store.chooseCard(0)');
        await lane.ev(() => (window as any).__ms.store.chooseCard(0), undefined, 'chooseCard(0)').catch(() => undefined);
      }
    } else handlerState.tries.set(key, tries + 1);
    return true;
  }
  const idx = (handlerState.picks * 5 + 1) % n;
  handlerState.lastClickAt = Date.now();
  handlerState.tries.set(key, tries + 1);
  let ok = false;
  try {
    await faceUp.nth(idx).click({ timeout: 3000 });
    lane.modalClicks++;
    ok = true;
  } catch (e) {
    lane.lastClickError = `card ${idx} of ${key}: ${String((e as Error).message ?? e).replace(/\s+/g, ' ').slice(0, 500)}`;
    /* animating or covered: fall down the ladder after a few tries */
  }
  if (!ok && tries >= 1) {
    // the cards deal in / sway (CSS animation): Playwright's stable-box wait can time out on a starved page. The same lane.click() path
    // ends in a hit-tested mouse click at the card centre, which is still a real click and still fails under an overlay / on a disabled card
    ok = await lane.click('.ms-cardmodal .ms-card:not(.ms-boss-back)', { timeout: 800, nth: idx });
  }
  if (ok) {
    handlerState.picks++;
    return true;
  }
  // a force click that "worked" but left the same modal open did nothing (a disabled / covered card): from the 6th try on skip it and go on
  // down the ladder (the old ladder force-clicked forever, the run then sat at that modal until --maxRunWall)
  if (tries >= 3 && tries < 6) {
    try {
      await faceUp.nth(idx).click({ timeout: 1500, force: true });
      lane.modalClicks++;
      lane.fallback(`card ${idx} of ${key}`, 'force click');
      handlerState.picks++;
      return true;
    } catch {
      /* next level */
    }
  }
  if (tries >= 3) {
    if (tries >= 5) {
      const dom = await lane
        .ev(
          (i: number) => {
            const els = Array.from(document.querySelectorAll<HTMLElement>('.ms-cardmodal .ms-card:not(.ms-boss-back)'));
            const el = els[i % Math.max(1, els.length)];
            if (!el) return false;
            el.click();
            return true;
          },
          idx,
          'card click fallback',
        )
        .catch(() => false);
      if (dom) {
        lane.fallback(`card ${idx} of ${key}`, 'element.click()');
        handlerState.picks++;
      }
    }
    if (tries >= 8) {
      lane.fallback(`card ${idx} of ${key}`, 'store.chooseCard');
      await lane.ev((i: number) => (window as any).__ms.store.chooseCard(i), idx, 'chooseCard').catch(() => undefined);
    }
  }
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------- results
export async function readResultsDom(lane: Lane, result: Record<string, unknown> | null): Promise<RunReport['resultsDom']> {
  // the tally counts up (staged animation): on a CPU-saturated machine 4 s after the actions show it can still be mid-count (kills 8,191 read for 8,219,
  // matrix 2026-10-27): re-read until the kill count shows up and the text is stable for 2 reads (<= 14 s)
  let prev = '';
  let stable = 0;
  for (let i = 0; i < 14; i++) {
    if (lane.hung) break;
    const t = await lane
      .ev(() => ((document.querySelector('.ms-re-root') as HTMLElement | null)?.innerText ?? '').replace(/\s+/g, ' '), undefined, 'read results text')
      .catch(() => '');
    const flatNow = t.replace(/[,.  \s]/g, '');
    const want = Number(result?.kills ?? -1);
    stable = t === prev ? stable + 1 : 0;
    prev = t;
    if (t && stable >= 2 && (want < 0 || flatNow.includes(String(want)))) break;
    if (t && stable >= 4) break; // stable but different: a real mismatch, reported below
    await sleep(1000);
  }
  if (lane.hung) return null;
  const dom = (await lane
    .ev(
      () => {
        const root = document.querySelector('.ms-re-root');
        if (!root) return null;
        const title = root.querySelector('.ms-re-title');
        return {
          title: (title?.getAttribute('data-text') || title?.textContent || '').trim(),
          text: ((root as HTMLElement).innerText || '').replace(/\s+/g, ' ').slice(0, 1800),
          tiles: root.querySelectorAll('.ms-re-tile').length,
          leds: root.querySelectorAll('.ms-re-led').length,
          actions: root.querySelectorAll('.ms-re-actions button').length,
        };
      },
      undefined,
      'read results dom',
    )
    .catch(() => null)) as { title: string; text: string; tiles: number; leds: number; actions: number } | null;
  if (!dom) return null;
  const flat = dom.text.replace(/[,. \u202f\s]/g, '');
  const kills = Number(result?.kills ?? -1);
  const level = Number(result?.level ?? -1);
  return { ...dom, hasTime: /\d{1,3}:\d{2}/.test(dom.text), hasKills: kills >= 0 && flat.includes(String(kills)), hasLevel: level >= 0 && dom.text.includes(String(level)) };
}

const nums = (t: string): number[] => (t.match(/\d[\d., \u202f ]*/g) ?? []).map((x) => Number(x.replace(/[^\d]/g, ''))).filter((n) => Number.isFinite(n));

/** yeop + shards read from the main menu's bank plate */
export async function readBank(lane: Lane): Promise<{ yeop: number; shards: number } | null> {
  const t = await lane.page.locator('.ms-menu-bank').first().innerText({ timeout: 3000 }).catch(() => '');
  if (!t) return null;
  const n = nums(t);
  return n.length >= 2 ? { yeop: n[0] as number, shards: n[1] as number } : null;
}

// ------------------------------------------------------------------------------------------------------------------------- run
export async function playRun(lane: Lane, cfg: RunCfg): Promise<RunReport> {
  lane.run = cfg.label;
  lane.handler.lastClickKey = '';
  lane.handler.picks = 0;
  const t0 = Date.now();
  const rep: RunReport = {
    cfg,
    startedAt: new Date().toISOString(),
    end: 'pending',
    wallS: 0,
    loadS: 0,
    phases: {},
    sim: null,
    result: null,
    resultsDom: null,
    perf: null,
    menuMemory: null,
    saveBefore: null,
    saveAfter: null,
    timeline: [],
    modals: {},
    pauseTest: null,
    shots: [],
    violations: 0,
  };
  const vBefore = lane.list().length;
  console.log(`[run ${cfg.label}] zone ${cfg.zone} class ${cfg.classId}/${cfg.doctrine} ${cfg.difficulty} god=${cfg.god} bot=${cfg.bot} x${cfg.timeScale}`);
  const hardWallMs = (cfg.hardWallS ?? cfg.maxWallS + Math.min(300, Math.max(30, cfg.maxWallS * 0.25))) * 1000;
  try {
    return await withWallTimeout(hardWallMs, `run ${cfg.label}`, () => playRunBody(lane, cfg, rep, t0, vBefore));
  } catch (e) {
    if (e instanceof WallTimeoutError) {
      lane.v('runHardTimeout', 'blocker', `run ${cfg.label} hit its independent wall-clock limit (${(hardWallMs / 1000).toFixed(1)} s): ${e.message}`);
      rep.end = 'timeout';
    } else {
      lane.v('harness', 'info', `run ${cfg.label} threw in the harness: ${String((e as Error).stack ?? e).slice(0, 600)}`);
      rep.end = 'error';
    }
    return finish(lane, rep, t0, vBefore);
  }
}

async function playRunBody(lane: Lane, cfg: RunCfg, rep: RunReport, t0: number, vBefore: number): Promise<RunReport> {
  const shotOnce = new Set<string>();
  const shotAt = async (k: string): Promise<void> => {
    if (!cfg.shots || shotOnce.has(k)) return;
    shotOnce.add(k);
    const p = await lane.shot(`${cfg.label}-${k}`);
    if (p) rep.shots.push(p);
  };
  try {
    rep.saveBefore = await lane.readSave();
    if (!(await enterRun(lane, cfg, rep))) {
      rep.end = 'error';
      return finish(lane, rep, t0, vBefore);
    }
    // ---- the selection the UI showed must be the run the sim plays (zone / difficulty / class / doctrine)
    const w0 = (await lane.snap())?.w;
    if (w0 && (w0.zone !== cfg.zone || w0.difficulty !== cfg.difficulty || (w0.classId && w0.classId !== cfg.classId) || (w0.doctrine && w0.doctrine !== cfg.doctrine))) {
      lane.v('selectionMismatch', 'blocker', `the run plays ${w0.zone}/${w0.difficulty}/${w0.classId}/${w0.doctrine} but ${cfg.zone}/${cfg.difficulty}/${cfg.classId}/${cfg.doctrine} was selected`);
    }
    // ---- run started: bot, god, speed
    await lane.ev((c: { timeScale: number; bot: string; god: boolean; handicap?: boolean; stuckSimS: number }) => {
      const w = window as any;
      w.__ms.loop.timeScale = c.timeScale;
      Object.assign(w.__qa.cfg, { bot: c.bot, god: c.god, handicap: !!c.handicap, stuckSimS: c.stuckSimS });
      w.__qa.begin();
    }, { timeScale: cfg.timeScale, bot: cfg.bot, god: cfg.god, handicap: cfg.handicap, stuckSimS: lane.opts.thresholds.stuckSimS }, 'run setup');
    rep.sim = { time: 0, level: 1, kills: 0, finalAt: 900, bossesSeen: [], maxEnemyRows: 0 };
    let lastTl = 0;
    let pauseDone = false;
    let probeDone = !cfg.inputProbe;
    let fastKey = '';
    let fastTries = 0;
    let fastPicks = 0;
    let ended = false;
    const tPlay = Date.now();
    while (!ended) {
      const s = await lane.snap();
      if (!s) {
        rep.end = 'error';
        break;
      }
      const w = s.w;
      if (w) {
        rep.sim = {
          time: w.time,
          level: w.level,
          kills: w.kills,
          finalAt: w.finalAt,
          bossesSeen: w.bossId && !rep.sim!.bossesSeen.includes(w.bossId) ? [...rep.sim!.bossesSeen, w.bossId] : rep.sim!.bossesSeen,
          maxEnemyRows: Math.max(rep.sim!.maxEnemyRows, w.enemyRows),
        };
      }
      if (Date.now() - tPlay - lastTl * 1000 >= 10_000) {
        lastTl = Math.floor((Date.now() - tPlay) / 1000);
        if (w) rep.timeline.push({ wall: lastTl, sim: w.time, level: w.level, kills: w.kills, rows: w.enemyRows, hp: w.hp, hpMax: w.hpMax, screen: s.screen ?? '' });
      }
      // ---- the run ended
      if (s.screen === 'results' || s.modal?.kind === 'runEnd') {
        ended = true;
        break;
      }
      if (s.screen === 'menu' || s.screen === 'zoneSelect' || s.screen === 'heroSelect') {
        lane.v('unexpectedScreen', 'blocker', `the game left the run for "${s.screen}" without a run-end flow`);
        rep.end = 'error';
        break;
      }
      if (s.screen === 'loading') {
        await sleep(200);
        continue;
      }
      if (Date.now() - tPlay > cfg.maxWallS * 1000) {
        lane.v('runTimeout', 'major', `the run did not finish within ${cfg.maxWallS} s wall (sim ${w?.time ?? '?'} s, level ${w?.level ?? '?'}, ${rep.sim?.bossesSeen.length ?? 0} bosses seen)`);
        rep.end = 'timeout';
        break;
      }
      if (s.modal) {
        if (s.modal.kind === 'pause') {
          await sleep(150);
          continue;
        }
        if (cfg.skipCards && s.modal.kind !== 'story') {
          // leak probe only: no card is taken, so identical runs load identical content (never counted as a UI finding: not a UI test)
          await lane.ev(() => (window as any).__ms.store.skip(), undefined, 'skip card').catch(() => undefined);
          await sleep(300);
          const again = await lane.snap();
          if (again?.modal && again.modal.kind !== 'story' && again.modal.id === s.modal.id) await lane.ev((i: number) => (window as any).__ms.store.chooseCard(i), 0, 'choose card').catch(() => undefined);
          continue;
        }
        if (cfg.fastCardsAfter !== undefined && (s.modal.kind === 'levelUp' || s.modal.kind === 'essence') && s.modal.cards > 0 && (rep.modals[s.modal.kind] ?? 0) >= cfg.fastCardsAfter) {
          // QA speed-up: after the first N real clicks of this kind the cards are taken through the store (same world.chooseCard the click ends in)
          const fk = `${s.modal.kind}:${s.modal.id}`;
          if (fk !== fastKey) {
            fastKey = fk;
            fastTries = 0;
            rep.modals[`${s.modal.kind}(store)`] = (rep.modals[`${s.modal.kind}(store)`] ?? 0) + 1;
          }
          if (fastTries < 6) {
            fastTries++;
            await sleep(fastTries === 1 ? 60 : 250);
            await lane.ev((i: number) => (window as any).__ms.store.chooseCard(i), (fastPicks++ * 5 + 1) % s.modal.cards, 'fast card').catch(() => undefined);
            continue;
          }
          // the store pick did not close it: the real UI path takes over for this modal
        }
        await handleModal(lane, s, rep);
        await sleep(120);
        continue;
      }
      if (w && !w.over && !probeDone && w.time >= 2) {
        // ---- real input reaches the hero: the bot writes input.touch directly, so without this probe a broken keyboard / touch path would
        // pass every hooked run (and the plain-dist smoke cannot read the hero position)
        probeDone = true;
        rep.inputProbe = await inputProbe(lane, cfg);
        continue;
      }
      if (w && !w.over) {
        if (w.time > 1.5) await shotAt('04-run-start');
        if (w.time >= 0.25 * w.finalAt) await shotAt('05-run-25pct');
        if (w.bosses > 0 && (w.bossId || w.bossFinal)) await shotAt(`06-boss-${w.bossId || 'x'}`.slice(0, 40));
        if (cfg.pauseTestAtSimS !== undefined && !pauseDone && w.time >= cfg.pauseTestAtSimS) {
          pauseDone = true;
          rep.pauseTest = await pauseTest(lane, cfg.label, cfg.shots);
          continue;
        }
        if (cfg.abandonAtSimS !== undefined && w.time >= cfg.abandonAtSimS) {
          const ok = await abandon(lane);
          if (!ok) {
            rep.end = 'error';
            break;
          }
          ended = true;
          rep.end = 'abandon';
          break;
        }
      }
      await sleep(150);
    }
    if (!ended && rep.end === 'pending') rep.end = 'error';
    if (rep.end === 'timeout' || rep.end === 'error') return finish(lane, rep, t0, vBefore);
    // ---- run-end flow -> results DOM -> main menu
    rep.perf = await lane.ev(() => (window as any).__qa.end(), undefined, 'run perf').catch(() => null);
    await lane.ev(() => Object.assign((window as any).__qa.cfg, { bot: 'off', god: true, handicap: false }), undefined, 'bot off').catch(() => undefined);
    const endSnap = await lane.snap();
    rep.phases.endFlow = +((Date.now() - t0) / 1000).toFixed(1);
    if (rep.end !== 'abandon') rep.end = endSnap?.w?.victory ? 'victory' : 'defeat';
    const result = (await lane
      .ev(() => {
        const ms = (window as any).__ms;
        const w = ms.session?.world;
        const r = (w?.result ?? ms.store.result.value ?? null) as Record<string, unknown> | null;
        return r ? JSON.parse(JSON.stringify(r, (k, v) => (k === 'damageBySkill' || k === 'players' ? undefined : v))) : null;
      }, undefined, 'run result')
      .catch(() => null)) as Record<string, unknown> | null;
    rep.result = result ? (JSON.parse(JSON.stringify(result, (k, v) => (k === 'damageBySkill' || k === 'players' ? undefined : v))) as Record<string, unknown>) : null;
    // the report panel plays staged animations (count-up, stamps): give them time, then read it
    for (let i = 0; i < 100 && !(await lane.visible('.ms-re-actions')); i++) await sleep(200);
    await sleep(4200);
    await shotAt('07-results');
    rep.resultsDom = await readResultsDom(lane, result);
    if (!rep.resultsDom) lane.v('resultsMissing', 'blocker', 'the run is over but there is no results report (.ms-re-root)');
    else {
      const d = rep.resultsDom;
      if (!d.hasTime) lane.v('resultsContent', 'major', `results report shows no time (title "${d.title}")`);
      if (!d.hasKills && result) lane.v('resultsContent', 'minor', `results report does not show the kill count ${String(result.kills)}`);
      if (!d.hasLevel && result) lane.v('resultsContent', 'minor', `results report does not show the level ${String(result.level)}`);
      if (d.tiles + d.leds === 0) lane.v('resultsContent', 'major', 'results report has no stat tiles (no rewards / numbers present)');
      // the report must tell the run's real end (a "DEFEAT" headline over a won run passed the old checks); en + tr titles
      const want = rep.end === 'victory' ? /VICTORY|ZAFER/i : rep.end === 'defeat' ? /DEFEAT|YENİLGİ|YENILGI/i : /ABANDONED|RUN ENDED|BIRAKILDI|BİTTİ/i;
      if (!want.test(d.title)) lane.v('resultsTitle', 'major', `the report headline is "${d.title}" but the run ended "${rep.end}"`);
    }
    // ---- the result record must agree with the sim and with the selection
    if (result) {
      if (rep.end !== 'abandon' && Boolean(result.victory) !== (rep.end === 'victory')) lane.v('resultMismatch', 'blocker', `result.victory=${String(result.victory)} but the sim ended "${rep.end}"`);
      if (rep.end === 'abandon' && result.victory === true) lane.v('resultMismatch', 'blocker', 'an abandoned run produced result.victory = true');
      for (const [k, want] of [['zone', cfg.zone], ['difficulty', cfg.difficulty], ['classId', cfg.classId], ['doctrine', cfg.doctrine]] as const) {
        if (result[k] !== undefined && result[k] !== want) lane.v('resultMismatch', 'blocker', `result.${k} = ${String(result[k])}, the run was started with ${want}`);
      }
      const killed = Array.isArray(result.bossesKilled) ? (result.bossesKilled as string[]) : [];
      if (rep.end === 'victory' && cfg.finalBoss && !killed.includes(cfg.finalBoss)) lane.v('victoryWithoutFinalBoss', 'blocker', `victory without killing the final boss ${cfg.finalBoss} (killed: ${killed.join(',') || 'none'})`);
    } else lane.v('resultMissing', 'major', 'no RunResult (world.result / store.result) after the run ended');
    const bankBefore = (rep.saveBefore as { bank?: { yeop: number; shards: number } } | null)?.bank ?? null;
    const gone = await clickMenuFromResults(lane);
    if (!gone) {
      rep.end = 'error';
      return finish(lane, rep, t0, vBefore);
    }
    await sleep(1800);
    rep.saveAfter = await lane.readSave();
    rep.menuMemory = await lane.measure();
    // settlement: the run must have reached the save
    const sb = rep.saveBefore as { stats?: { runs: number } } | null;
    const sa = rep.saveAfter as { stats?: { runs: number }; bank?: { yeop: number; shards: number } } | null;
    if (sa?.stats && sb?.stats && sa.stats.runs !== sb.stats.runs + 1) lane.v('saveNotSettled', 'major', `stats.runs went ${sb.stats.runs} -> ${sa.stats.runs} after a finished run (expected +1)`);
    if (!sa) lane.v('saveMissing', 'major', 'no save record in IndexedDB after the run');
    if (bankBefore && sa?.bank && result && (Number(result.yeop) > 0 || Number(result.shards) > 0) && sa.bank.yeop === bankBefore.yeop && sa.bank.shards === bankBefore.shards) {
      lane.v('rewardsNotBanked', 'major', `the run earned yeop ${String(result.yeop)} / shards ${String(result.shards)} but the saved bank did not change (${JSON.stringify(sa.bank)})`);
    }
  } catch (e) {
    lane.v('harness', 'info', `run ${cfg.label} threw in the harness: ${String((e as Error).stack ?? e).slice(0, 600)}`);
    rep.end = 'error';
  }
  return finish(lane, rep, t0, vBefore);
}

function finish(lane: Lane, rep: RunReport, t0: number, vBefore: number): RunReport {
  rep.wallS = +((Date.now() - t0) / 1000).toFixed(1);
  rep.violations = lane.list().length - vBefore;
  return rep;
}

/**
 * Real input reaches the hero (hook build): the bot is switched off and the joystick zeroed, the loop runs at x1, a movement key is held
 * (keyboard lanes) or the floating stick is dragged with CDP touch events (touch lanes) until >= 1 s of sim passed, and the hero must have
 * moved >= 1.5 m. A second direction is tried when the first was blocked (an obstacle / a crowd). Both blocked = `inputBroken` (blocker).
 */
export async function inputProbe(lane: Lane, cfg: RunCfg): Promise<{ ok: boolean; moved: Record<string, number>; note: string }> {
  lane.muted.add('clock');
  const pos = async (): Promise<{ x: number; z: number; t: number } | null> =>
    (await lane
      .ev(() => {
        const w = (window as any).__ms.session?.world;
        const p = w?.players?.[0];
        return p ? { x: p.x as number, z: p.z as number, t: w.time as number } : null;
      }, undefined, 'input probe')
      .catch(() => null)) as { x: number; z: number; t: number } | null;
  const moved: Record<string, number> = {};
  try {
    await lane.ev(() => {
      const w = window as any;
      w.__qa.cfg.bot = 'off';
      w.__ms.input.touch.x = 0;
      w.__ms.input.touch.y = 0;
      w.__qa.probeScale = w.__ms.loop.timeScale;
      w.__ms.loop.timeScale = 1;
    }, undefined, 'input probe setup');
    const dirs = lane.opts.touch ? ['touch-up', 'touch-right'] : ['KeyW', 'KeyD'];
    for (const d of dirs) {
      const a = await pos();
      if (!a) break;
      const hold = async (): Promise<void> => {
        const end = Date.now() + 8000;
        while (Date.now() < end) {
          await sleep(150);
          const b = await pos();
          if (b && b.t - a.t >= 1.0) break;
        }
      };
      if (lane.opts.touch) await touchDrag(lane, d === 'touch-up' ? [0, -60] : [60, 0], hold);
      else {
        await lane.page.keyboard.down(d);
        try {
          await hold();
        } finally {
          await lane.page.keyboard.up(d);
        }
      }
      const b = await pos();
      moved[d] = a && b ? +Math.hypot(b.x - a.x, b.z - a.z).toFixed(2) : -1;
      if ((moved[d] ?? 0) >= 1.5) break;
    }
  } finally {
    await lane
      .ev((bot: string) => {
        const w = window as any;
        w.__ms.input.touch.x = 0;
        w.__ms.input.touch.y = 0;
        w.__ms.loop.timeScale = w.__qa.probeScale || 1;
        w.__qa.cfg.bot = bot;
      }, cfg.bot, 'input probe restore')
      .catch(() => undefined);
    lane.muted.delete('clock');
  }
  const best = Math.max(-1, ...Object.values(moved));
  const ok = best >= 1.5;
  if (!ok) lane.v('inputBroken', 'blocker', `real ${lane.opts.touch ? 'touch stick drags' : 'WASD key holds'} did not move the hero (moved ${JSON.stringify(moved)} m over >= 1 s of sim each)`);
  return { ok, moved, note: lane.opts.touch ? 'CDP touch drag on the canvas' : 'keyboard.down / up' };
}

/** one finger on the canvas (lower-left quarter: the floating stick), moved by `d` px and held while `hold` runs */
async function touchDrag(lane: Lane, d: [number, number], hold: () => Promise<void>): Promise<void> {
  const cdp = await lane.page.context().newCDPSession(lane.page);
  const vp = lane.page.viewportSize() ?? { width: 390, height: 844 };
  const bx = Math.round(vp.width * 0.3);
  const by = Math.round(vp.height * 0.7);
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bx, y: by, id: 1 }] });
    await sleep(60);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: bx + d[0], y: by + d[1], id: 1 }] });
    await hold();
  } finally {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }).catch(() => undefined);
    await cdp.detach().catch(() => undefined);
  }
}

/** Esc -> pause overlay; the sim clock must stand still; Esc again resumes. */
export async function pauseTest(lane: Lane, label: string, shots: boolean): Promise<{ ok: boolean; frozenFor: number; note: string }> {
  lane.muted.add('clock');
  try {
    await lane.page.keyboard.press('Escape');
    const p = await lane.waitFor('pause overlay', (s) => s.modal?.kind === 'pause', 8, 100);
    if (!p) return { ok: false, frozenFor: 0, note: 'Esc did not open the pause overlay' };
    const t1 = p.w?.time ?? -1;
    await sleep(1800);
    const q = await lane.snap();
    const t2 = q?.w?.time ?? -2;
    const frozen = Math.abs(t2 - t1) < 0.05;
    const actions = await lane.visible('.ms-pause-actions');
    if (shots) await lane.shot(`${label}-pause`);
    if (!frozen) lane.v('pauseNotFrozen', 'major', `the sim clock moved ${t1} -> ${t2} while the pause overlay was open`);
    if (!actions) lane.v('pauseUi', 'major', 'the pause overlay has no action bar (.ms-pause-actions)');
    await lane.page.keyboard.press('Escape');
    const r = await lane.waitFor('resume', (s) => !s.modal && !s.paused, 8, 100);
    if (!r) return { ok: false, frozenFor: 1.8, note: 'Esc did not close the pause overlay' };
    const t3 = r.w?.time ?? -1;
    await sleep(1200);
    const u = await lane.snap();
    const moving = (u?.w?.time ?? -1) > t3 + 0.2;
    if (!moving) lane.v('pauseResume', 'blocker', `the sim clock did not advance after resuming (${t3} -> ${u?.w?.time})`);
    return { ok: frozen && actions && moving, frozenFor: 1.8, note: `frozen=${frozen} actions=${actions} resumed=${moving}` };
  } finally {
    lane.muted.delete('clock');
  }
}

/** Esc -> pause -> "Abandon run" -> confirm "Abandon" -> results screen */
export async function abandon(lane: Lane): Promise<boolean> {
  lane.muted.add('clock');
  try {
    await lane.page.keyboard.press('Escape');
    if (!(await lane.waitFor('pause overlay', (s) => s.modal?.kind === 'pause', 8, 100))) return false;
    await sleep(700);
    let ok = await lane.click('.ms-pause-act-l button', { timeout: 4000 });
    if (!ok) {
      const lvl = await lane.clickLadder('.ms-pause-act-l button', { timeout: 800 });
      if (lvl === 'none') {
        lane.v('uiClick', 'blocker', 'the pause "Abandon run" button could not be clicked');
        return false;
      }
      lane.fallback('pause Abandon button', 'element.click()');
    }
    await sleep(900);
    const dlg = '[role="dialog"] button, .ms-modal-card button, .ms-kdlg button';
    ok = await lane.click(dlg, { last: true, text: /^\s*(Abandon|Bırak)\s*$/i, timeout: 4000 });
    if (!ok) {
      const lvl = await lane.clickLadder(dlg, { last: true, text: /^\s*(Abandon|Bırak)\s*$/i, timeout: 800 });
      if (lvl === 'none') {
        lane.v('uiClick', 'blocker', 'the abandon confirmation button could not be clicked');
        return false;
      }
      lane.fallback('abandon confirmation', 'element.click()');
    }
    return !!(await lane.waitFor('results screen after abandon', (s) => s.screen === 'results', 20, 150));
  } finally {
    lane.muted.delete('clock');
  }
}

/** results / run-end report -> "Main menu" */
export async function clickMenuFromResults(lane: Lane): Promise<boolean> {
  const rx = /Main menu|Ana menü/i;
  let ok = await lane.click('.ms-re-actions button', { text: rx, last: true, timeout: 5000 });
  if (!ok) {
    const lvl = await lane.clickLadder('.ms-re-actions button', { text: rx, last: true, timeout: 800 });
    if (lvl === 'none') {
      lane.v('uiClick', 'blocker', 'the results "Main menu" button could not be clicked');
      return false;
    }
    lane.fallback('results Main menu button', 'element.click()');
    ok = true;
  }
  return !!(await lane.waitFor('menu after results', (s) => s.screen === 'menu', 30, 150));
}
