// campaign + matrix modes: the QA snapshot (window.__ms) played through the real UI at accelerated speed.
import { join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { Args, cpuLoad, leakVerdict, makeRig, outDirFor, pickSnapshot, REAL, repeatLeakVerdict, seedRecord, viewFrom, writeSummary, type LeakVerdict, type Summary } from './common';
import type { Lane, MenuMemory, Violation } from './lane';
import { sleep, withWallTimeout } from './lane';
import { atMenu, playRun, readZones, type RunCfg, type RunReport } from './runner';

interface ContentInfo {
  zones: { id: string; order: number; unlock: { zone: string; difficulty?: string } | null; finalAt: number; finalBoss: string }[];
  classes: string[];
}

export async function readContent(lane: Lane): Promise<ContentInfo | null> {
  return (await lane
    .ev(
      async () => {
        const c = await (window as any).__ms.hooks.loadContent();
        return {
          zones: c.zones.map((z: any) => ({ id: z.id, order: z.order, unlock: z.unlock ?? null, finalAt: z.final.at, finalBoss: z.final.boss })).sort((a: any, b: any) => a.order - b.order),
          classes: c.classes.map((k: any) => k.id),
        };
      },
      undefined,
      'load content',
    )
    .catch(() => null)) as ContentInfo | null;
}

/** the zone chain in unlock order: the first zone has no requirement, each next one is the zone whose `unlock.zone` is the previous one */
export function chainOrder(c: ContentInfo): string[] {
  const out: string[] = [];
  const first = c.zones.find((z) => !z.unlock) ?? c.zones[0];
  if (!first) return out;
  out.push(first.id);
  for (let i = 0; i < 20; i++) {
    const next = c.zones.find((z) => z.unlock?.zone === out[out.length - 1] && !out.includes(z.id));
    if (!next) break;
    out.push(next.id);
  }
  for (const z of c.zones) if (!out.includes(z.id)) out.push(z.id); // anything the chain does not reach, in order
  return out;
}

const finalOf = (c: ContentInfo, zone: string): string | undefined => c.zones.find((z) => z.id === zone)?.finalBoss;

async function bootToMenu(lane: Lane, label: string): Promise<{ bootS: number; ok: boolean }> {
  lane.run = label;
  const t = Date.now();
  await lane.goto('/');
  const ok = await atMenu(lane, 150);
  return { bootS: +((Date.now() - t) / 1000).toFixed(1), ok };
}

async function execRun(lane: Lane, cfg: RunCfg, runs: RunReport[], out: string, series: { label: string; mem: MenuMemory }[]): Promise<RunReport> {
  const cpu0 = cpuLoad();
  const rep = await playRun(lane, cfg);
  const cpu1 = await cpuLoad();
  (rep as RunReport & { cpuLoad?: unknown }).cpuLoad = { start: await cpu0, end: cpu1 };
  runs.push(rep);
  mkdirSync(join(out, 'runs'), { recursive: true });
  writeFileSync(join(out, 'runs', `${cfg.label}.json`), JSON.stringify(rep, null, 2));
  if (rep.menuMemory) series.push({ label: cfg.label, mem: rep.menuMemory });
  const p = rep.perf as { frameMs?: { p50: number; p95: number; p99: number }; simSpeed?: { active: number } } | null;
  console.log(`[run ${cfg.label}] ${rep.end} wall ${rep.wallS}s load ${rep.loadS}s sim ${rep.sim?.time ?? '?'}s lvl ${rep.sim?.level ?? '?'} kills ${rep.sim?.kills ?? '?'} frame p50/p95/p99 ${p?.frameMs?.p50}/${p?.frameMs?.p95}/${p?.frameMs?.p99} ms, sim speed x${p?.simSpeed?.active} (cpu ${cpu1}%), violations ${rep.violations}`);
  return rep;
}

/**
 * The leak probe: `n` IDENTICAL short runs (same zone / class / doctrine, abandoned at `atSimS` before the first level-up, no card taken),
 * each read on the menu, judged by `repeatLeakVerdict` (a texture / geometry / program kept per run is found from +1 per run). The mixed
 * campaign series cannot see small leaks: its menu counts follow the content of the last run. `afterRun(i)` is the selftest's injection point.
 */
export async function leakProbe(
  a: Args,
  lane: Lane,
  runs: RunReport[],
  out: string,
  o: { zone: string; classId: string; n: number; atSimS: number; afterRun?: (i: number) => Promise<void> },
): Promise<LeakVerdict & { injected?: number }> {
  const series: { label: string; mem: MenuMemory }[] = [];
  for (let i = 1; i <= o.n; i++) {
    const cfg = baseCfg(a, `leakprobe-${i}`, o.zone, o.classId, { abandonAtSimS: o.atSimS, skipCards: true, shots: false, maxWallS: 300 });
    const rep = await execRun(lane, cfg, runs, out, []);
    if (rep.end !== 'abandon') {
      lane.v('leakProbe', 'major', `leak probe run ${i} ended "${rep.end}" instead of the planned abandon at ${o.atSimS} s: the probe is incomplete`);
      break;
    }
    if (o.afterRun) await o.afterRun(i);
    const mem = o.afterRun ? await lane.measure() : rep.menuMemory;
    if (mem) series.push({ label: cfg.label, mem });
  }
  const v = repeatLeakVerdict(series);
  console.log(`[leak probe] ${v.verdict}: ${v.reasons.join('; ') || 'flat'} (textures ${series.map((s) => s.mem.textures).join(' / ')}, geometries ${series.map((s) => s.mem.geometries).join(' / ')}, programs ${series.map((s) => s.mem.programs).join(' / ')}, heap ${series.map((s) => s.mem.heapMB).join(' / ')} MB)`);
  return v;
}

const baseCfg = (a: Args, label: string, zone: string, classId: string, extra: Partial<RunCfg> = {}): RunCfg => ({
  label,
  zone,
  classId,
  doctrine: 'a',
  difficulty: 'normal',
  god: a.flag('god', true),
  bot: 'play',
  timeScale: a.num('timescale', 6),
  maxWallS: a.num('maxRunWall', 1500),
  shots: a.flag('shots', true),
  ...(a.has('fastCards') ? { fastCardsAfter: a.num('fastCards', 6) } : {}),
  ...(a.has('sex') ? { sex: a.str('sex', 'm') === 'f' ? ('f' as const) : ('m' as const) } : {}),
  ...extra,
});

export async function campaign(a: Args): Promise<number> {
  const t0 = Date.now();
  const snap = await pickSnapshot(a);
  const out = outDirFor(a, 'campaign');
  const cpuStart = await cpuLoad();
  const rig = await makeRig(a, snap.distQa, out, true);
  const runs: RunReport[] = [];
  const series: { label: string; mem: MenuMemory }[] = [];
  const extra: Record<string, unknown> = { persistence: [] as unknown[], unlockChecks: [] as unknown[] };
  let lane: Lane | null = null;
  const violations: Violation[] = [];
  const campaignHardWallMs = a.num('maxCampaignWall', Math.max(3600, a.num('maxRunWall', 1500) * 6)) * 1000;
  try {
    return await withWallTimeout(campaignHardWallMs, 'campaign', async () => {
    lane = await rig.mk('c1');
    const boot = await bootToMenu(lane, 'boot');
    extra.bootS = boot.bootS;
    console.log(`[campaign] boot -> menu ${boot.ok ? 'ok' : 'FAILED'} in ${boot.bootS}s`);
    if (!boot.ok) throw new Error('the game never reached the main menu');
    await lane.shot('01-menu');
    const content = await readContent(lane);
    if (!content) throw new Error('could not read the content through window.__ms.hooks.loadContent()');
    const chain = chainOrder(content);
    const limit = a.num('legs', chain.length);
    extra.chain = chain;
    extra.classes = content.classes;
    console.log(`[campaign] zone chain (from content): ${chain.join(' -> ')}; classes ${content.classes.join(',')}`);
    const fresh = await lane.readSave();
    extra.freshSave = fresh ? { unlockedZones: fresh.unlocks.zones, hard: fresh.unlocks.hard, runs: fresh.stats.runs } : null;
    if (fresh && (fresh.stats.runs !== 0 || fresh.unlocks.hard.length !== 0)) lane.v('freshProfile', 'major', `the fresh profile is not empty: ${JSON.stringify(extra.freshSave)}`);
    if (fresh && fresh.unlocks.zones.length > 1) lane.v('freshProfile', 'major', `the fresh profile has ${fresh.unlocks.zones.length} zones unlocked (expected only ${chain[0]})`);

    let wins = 0;
    for (let i = 0; i < Math.min(limit, chain.length); i++) {
      const zone = chain[i] as string;
      const classId = content.classes[i % content.classes.length] as string;
      const cfg = baseCfg(a, `z${i + 1}-${zone}-${classId}`, zone, classId, { doctrine: i % 2 === 0 ? 'a' : 'b', pauseTestAtSimS: i === 0 ? 120 : undefined, inputProbe: i === 0, finalBoss: finalOf(content, zone) });
      const rep = await execRun(lane, cfg, runs, out, series);
      if (rep.end !== 'victory') {
        lane.v('campaignBroken', 'blocker', `zone ${zone} (${classId}) ended "${rep.end}" instead of victory: the chain cannot continue`);
        if (a.flag('stopOnFail', true)) break;
      } else wins++;
      // ---- unlock check: the victory must open the next zone, in the save and on the atlas
      const next = chain[i + 1];
      const after = await lane.readSave();
      const chk: Record<string, unknown> = { zone, next: next ?? null, unlockedZones: after?.unlocks.zones, hard: after?.unlocks.hard, clears: after?.stats.zones[zone] };
      if (rep.end === 'victory') {
        if (next && !after?.unlocks.zones.includes(next)) lane.v('unlockMissing', 'blocker', `after beating ${zone} the save does not unlock ${next} (zones: ${after?.unlocks.zones.join(',')})`);
        if (!after?.unlocks.hard.includes(zone)) lane.v('hardUnlockMissing', 'major', `after beating ${zone} on normal its hard mode is not unlocked (${after?.unlocks.hard.join(',')})`);
        if ((after?.stats.zones[zone]?.normal?.clears ?? 0) < 1) lane.v('clearNotRecorded', 'major', `the save records no normal clear of ${zone}: ${JSON.stringify(after?.stats.zones[zone])}`);
      }
      (extra.unlockChecks as unknown[]).push(chk);
      // ---- reload: the save must survive and the next zone must still be open
      lane.run = `reload-${i + 1}`;
      const before = after;
      await lane.reload();
      const back = await atMenu(lane, 150);
      const re = await lane.readSave();
      (extra.persistence as unknown[]).push({ afterZone: zone, menuBack: back, sameProfile: before?.profileId === re?.profileId, zonesBefore: before?.unlocks.zones, zonesAfter: re?.unlocks.zones, runsBefore: before?.stats.runs, runsAfter: re?.stats.runs });
      if (!back) throw new Error('the menu did not come back after the reload');
      if (!re) lane.v('savePersist', 'blocker', 'after a page reload there is no save in IndexedDB');
      else if (before && (re.profileId !== before.profileId || re.unlocks.zones.join() !== before.unlocks.zones.join() || re.stats.runs !== before.stats.runs)) {
        lane.v('savePersist', 'blocker', `the save changed over a reload: ${JSON.stringify({ before: { id: before.profileId, zones: before.unlocks.zones, runs: before.stats.runs }, after: { id: re.profileId, zones: re.unlocks.zones, runs: re.stats.runs } })}`);
      }
      // after the first victory: the deliberate defeat and the abandon path, both in the zone just beaten
      if (i === 0 && rep.end === 'victory') {
        if (a.flag('defeat', true)) {
          const d = await execRun(lane, baseCfg(a, `defeat-${zone}`, zone, content.classes[1] ?? classId, { god: false, handicap: true, bot: 'idle', maxWallS: 420, timeScale: Math.max(4, a.num('timescale', 6)), shots: true }), runs, out, series);
          if (d.end !== 'defeat') lane.v('defeatNotReached', 'major', `the deliberate no-god 1-hp idle run ended "${d.end}" instead of a defeat`);
        }
        if (a.flag('abandon', true)) {
          const ab = await execRun(lane, baseCfg(a, `abandon-${zone}`, zone, content.classes[2] ?? classId, { abandonAtSimS: a.num('abandonAt', 60), shots: true }), runs, out, series);
          if (ab.end !== 'abandon') lane.v('abandonFailed', 'major', `the pause -> abandon path ended "${ab.end}"`);
        }
      }
    }
    // ---- hard mode of the first zone
    const first = chain[0] as string;
    const sv = await lane.readSave();
    if (a.flag('hard', true) && wins > 0 && sv?.unlocks.hard.includes(first)) {
      const rep = await execRun(lane, baseCfg(a, `hard-${first}`, first, content.classes[0] as string, { difficulty: 'hard', doctrine: 'b', finalBoss: finalOf(content, first) }), runs, out, series);
      if (rep.end !== 'victory') lane.v('hardRun', 'major', `the hard run of ${first} ended "${rep.end}" (a god-mode bot should win it)`);
    } else extra.hardSkipped = wins === 0 ? 'no zone beaten' : sv?.unlocks.hard.includes(first) ? 'disabled' : 'hard not unlocked';
    // ---- the leak probe: identical short runs of the first zone (small per-run leaks; the mixed series above only sees gross ones)
    const probeN = a.num('leakRuns', 4);
    if (probeN >= 3) {
      lane.run = 'leakprobe';
      const pv = await leakProbe(a, lane, runs, out, { zone: first, classId: content.classes[0] as string, n: probeN, atSimS: a.num('leakAt', 14) });
      extra.leakProbe = pv;
      if (pv.verdict === 'leak') for (const r of pv.reasons) lane.v('leak', 'major', `leak probe: ${r}`);
    } else extra.leakProbe = 'skipped (--leakRuns < 3)';
    // atlas at the end: every beaten zone and the one after it are open
    extra.finalSave = await lane.readSave();
    violations.push(...lane.list());
    const leak = leakVerdict(series);
    if (leak.verdict === 'leak') for (const r of leak.reasons) lane.v('leak', 'major', r);
    const all = lane.list();
    const summary: Summary = {
      mode: 'campaign',
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
      consoleSummary: lane.consoleSummary(),
      requests: { ...lane.requests, apiHitsServer: rig.server.apiHits },
      fallbacks: lane.fallbacks,
      notes: lane.notes,
      leak,
      extra,
      ok: !all.some(REAL),
      exitCode: all.some(REAL) ? 1 : 0,
    };
    const p = writeSummary(out, summary);
    console.log(`[campaign] ${summary.ok ? 'OK' : 'VIOLATIONS'} ${all.filter(REAL).length} violation(s) -> ${p}`);
    return summary.exitCode;
    });
  } catch (e) {
    const msg = String((e as Error).stack ?? e);
    console.error(`[campaign] aborted: ${msg}`);
    const activeLane = lane as Lane | null;
    const all = activeLane ? activeLane.list() : [];
    writeSummary(out, {
      mode: 'campaign',
      args: process.argv.slice(2),
      snapshot: { stamp: snap.stamp, out: snap.out, manifestSha256: snap.manifestSha256.afterBuilds, gitStatusLines: snap.gitStatusPorcelain.length },
      startedAt: new Date(t0).toISOString(),
      wallS: +((Date.now() - t0) / 1000).toFixed(1),
      cpuLoadStart: cpuStart,
      cpuLoadEnd: null,
      viewport: viewFrom(a),
      api: a.str('api', 'offline (503)'),
      runs,
      violations: all,
      consoleSummary: activeLane?.consoleSummary() ?? [],
      requests: activeLane?.requests ?? {},
      fallbacks: activeLane?.fallbacks ?? [],
      notes: [...(activeLane?.notes ?? []), `ABORTED: ${msg.slice(0, 600)}`],
      extra,
      ok: false,
      exitCode: 1,
    });
    return 1;
  } finally {
    await rig.stop();
  }
}

// ------------------------------------------------------------------------------------------------------------------------ defeat
/** the death path alone: a fresh profile, the first zone, a 1-hp idle hero (no god) -> DEFEAT -> run-end flow -> results -> menu, then the pause -> abandon path */
export async function defeat(a: Args): Promise<number> {
  const t0 = Date.now();
  const snap = await pickSnapshot(a);
  const out = outDirFor(a, 'defeat');
  const rig = await makeRig(a, snap.distQa, out, true);
  const runs: RunReport[] = [];
  const series: { label: string; mem: MenuMemory }[] = [];
  let lane: Lane | null = null;
  try {
    lane = await rig.mk('d1');
    const boot = await bootToMenu(lane, 'boot');
    if (!boot.ok) throw new Error('the game never reached the main menu');
    const content = await readContent(lane);
    if (!content) throw new Error('no content through window.__ms');
    const zone = chainOrder(content)[0] as string;
    const d = await execRun(lane, baseCfg(a, `defeat-${zone}`, zone, content.classes[0] as string, { god: false, handicap: true, bot: 'idle', maxWallS: 420 }), runs, out, series);
    if (d.end !== 'defeat') lane.v('defeatNotReached', 'major', `the 1-hp idle run ended "${d.end}" instead of a defeat`);
    else if (!/DEFEAT/i.test(d.resultsDom?.title ?? '')) lane.v('resultsContent', 'minor', `the results title of a defeat is "${d.resultsDom?.title}"`);
    const ab = await execRun(lane, baseCfg(a, `abandon-${zone}`, zone, content.classes[1] ?? (content.classes[0] as string), { abandonAtSimS: 40 }), runs, out, series);
    if (ab.end !== 'abandon') lane.v('abandonFailed', 'major', `the pause -> abandon path ended "${ab.end}"`);
    const all = lane.list();
    const summary: Summary = {
      mode: 'defeat',
      args: process.argv.slice(2),
      snapshot: { stamp: snap.stamp, out: snap.out, manifestSha256: snap.manifestSha256.afterBuilds, gitStatusLines: snap.gitStatusPorcelain.length },
      startedAt: new Date(t0).toISOString(),
      wallS: +((Date.now() - t0) / 1000).toFixed(1),
      cpuLoadStart: null,
      cpuLoadEnd: await cpuLoad(),
      viewport: viewFrom(a),
      api: a.str('api', 'offline (503)'),
      runs,
      violations: all,
      consoleSummary: lane.consoleSummary(),
      requests: lane.requests,
      fallbacks: lane.fallbacks,
      notes: lane.notes,
      ok: !all.some(REAL),
      exitCode: all.some(REAL) ? 1 : 0,
    };
    const p = writeSummary(out, summary);
    console.log(`[defeat] ${summary.ok ? 'OK' : 'VIOLATIONS'} ${all.filter(REAL).length} violation(s) -> ${p}`);
    return summary.exitCode;
  } catch (e) {
    console.error(`[defeat] aborted: ${String((e as Error).stack ?? e)}`);
    return 1;
  } finally {
    await rig.stop();
  }
}

// -------------------------------------------------------------------------------------------------------------------------- leak
/** the leak probe alone: a fresh profile, `--runs` (default 5) identical short runs of the first zone (or --zone / --class), abandoned at --leakAt */
export async function leak(a: Args): Promise<number> {
  const t0 = Date.now();
  const snap = await pickSnapshot(a);
  const out = outDirFor(a, 'leak');
  const cpuStart = await cpuLoad();
  const rig = await makeRig(a, snap.distQa, out, true);
  const runs: RunReport[] = [];
  let lane: Lane | null = null;
  try {
    lane = await rig.mk('l1');
    const boot = await bootToMenu(lane, 'boot');
    if (!boot.ok) throw new Error('the game never reached the main menu');
    const content = await readContent(lane);
    if (!content) throw new Error('no content through window.__ms');
    const zone = a.str('zone', chainOrder(content)[0] as string);
    const classId = a.str('class', content.classes[0] as string);
    if (zone !== chainOrder(content)[0]) await lane.seed(seedRecord(chainOrder(content), []));
    if (zone !== chainOrder(content)[0]) await bootToMenu(lane, 'boot-seeded');
    lane.run = 'leakprobe';
    const v = await leakProbe(a, lane, runs, out, { zone, classId, n: a.num('runs', 5), atSimS: a.num('leakAt', 14) });
    if (v.verdict === 'leak') for (const r of v.reasons) lane.v('leak', 'major', `leak probe: ${r}`);
    if (v.verdict === 'insufficient') lane.v('leakProbe', 'major', `leak probe incomplete: ${v.reasons.join('; ')}`);
    const all = lane.list();
    const summary: Summary = {
      mode: 'leak',
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
      consoleSummary: lane.consoleSummary(),
      requests: lane.requests,
      fallbacks: lane.fallbacks,
      notes: lane.notes,
      leak: v,
      ok: !all.some(REAL),
      exitCode: all.some(REAL) ? 1 : 0,
    };
    const p = writeSummary(out, summary);
    console.log(`[leak] ${summary.ok ? 'OK' : 'VIOLATIONS'} ${all.filter(REAL).length} violation(s) -> ${p}`);
    return summary.exitCode;
  } catch (e) {
    console.error(`[leak] aborted: ${String((e as Error).stack ?? e)}`);
    return 1;
  } finally {
    await rig.stop();
  }
}

// ------------------------------------------------------------------------------------------------------------------------ matrix
export async function matrix(a: Args): Promise<number> {
  const t0 = Date.now();
  const snap = await pickSnapshot(a);
  const out = outDirFor(a, 'matrix');
  const cpuStart = await cpuLoad();
  const rig = await makeRig(a, snap.distQa, out, true);
  const runs: RunReport[] = [];
  const lanesN = Math.min(2, Math.max(1, a.num('lanes', 1)));
  const lanes: Lane[] = [];
  try {
    // lane 0 boots a throw-away profile only to read the content (zone / class ids); every lane is then seeded with all zones + hard unlocked
    const l0 = await rig.mk('m0');
    lanes.push(l0);
    const boot = await bootToMenu(l0, 'boot');
    if (!boot.ok) throw new Error('the game never reached the main menu');
    const content = await readContent(l0);
    if (!content) throw new Error('no content through window.__ms');
    const chain = chainOrder(content);
    const zones = a.has('zones') ? a.list('zones') : chain;
    const classes = a.has('classes') ? a.list('classes') : content.classes;
    for (const z of zones) if (!chain.includes(z)) throw new Error(`--zones: unknown zone ${z} (have ${chain.join(',')})`);
    for (const c of classes) if (!content.classes.includes(c)) throw new Error(`--classes: unknown class ${c} (have ${content.classes.join(',')})`);
    const rec = seedRecord(chain, chain);
    await l0.seed(rec);
    for (let i = 1; i < lanesN; i++) lanes.push(await rig.mk(`m${i}`));
    for (let i = 1; i < lanesN; i++) {
      await (lanes[i] as Lane).seed(rec);
    }
    const jobs: { zone: string; classId: string; n: number }[] = [];
    for (const z of zones) for (const c of classes) jobs.push({ zone: z, classId: c, n: jobs.length });
    const full = a.flag('full', false);
    const until = a.num('until', 200);
    console.log(`[matrix] ${jobs.length} run(s): zones ${zones.join(',')} x classes ${classes.join(',')}; ${full ? 'full runs' : `short runs (abandon at ${until} sim s)`}; lanes ${lanesN}`);
    const series = new Map<number, { label: string; mem: MenuMemory }[]>();
    const next = { i: 0 };
    await Promise.all(
      lanes.map(async (lane, li) => {
        await bootToMenu(lane, `m${li}-boot`);
        const mine: { label: string; mem: MenuMemory }[] = [];
        series.set(li, mine);
        let laneRuns = 0;
        for (;;) {
          const j = jobs[next.i++];
          if (!j) break;
          const cfg = baseCfg(a, `m${String(j.n + 1).padStart(2, '0')}-${j.zone}-${j.classId}`, j.zone, j.classId, {
            doctrine: j.n % 2 === 0 ? 'a' : 'b',
            // the sex rotates with the doctrine (a/m, b/m, a/f, b/f, ...) unless --sex m|f pins it
            ...(a.has('sex') ? {} : { sex: Math.floor(j.n / 2) % 2 === 0 ? ('m' as const) : ('f' as const) }),
            difficulty: a.str('difficulty', 'normal') === 'hard' ? 'hard' : 'normal',
            ...(full ? {} : { abandonAtSimS: until }),
            pauseTestAtSimS: full ? undefined : Math.min(60, until / 2),
            shots: a.flag('shots', false) || j.n < 2,
            finalBoss: finalOf(content, j.zone),
            inputProbe: laneRuns++ === 0,
          });
          await execRun(lane, cfg, runs, out, mine);
          // back at the menu after every run (results -> menu was clicked by the run); a failed run leaves the lane where it is
          if (lane.lastSnap?.screen !== 'menu') {
            lane.v('matrixLaneLost', 'blocker', `lane ${li} is on "${lane.lastSnap?.screen}" after ${cfg.label}: reloading it`);
            await lane.goto('/');
            await atMenu(lane, 150);
          }
        }
      }),
    );
    const allViol = lanes.flatMap((l) => l.list());
    const leaks = [...series.entries()].map(([li, s]) => ({ lane: li, ...leakVerdict(s) }));
    for (const lk of leaks) if (lk.verdict === 'leak') for (const r of lk.reasons) lanes[lk.lane]?.v('leak', 'major', r);
    const all = lanes.flatMap((l) => l.list());
    void allViol;
    const summary: Summary = {
      mode: 'matrix',
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
      extra: { leaks, jobs: jobs.length, lanes: lanesN },
      ok: !all.some(REAL),
      exitCode: all.some(REAL) ? 1 : 0,
    };
    const p = writeSummary(out, summary);
    console.log(`[matrix] ${summary.ok ? 'OK' : 'VIOLATIONS'} ${all.filter(REAL).length} violation(s) -> ${p}`);
    return summary.exitCode;
  } catch (e) {
    console.error(`[matrix] aborted: ${String((e as Error).stack ?? e)}`);
    return 1;
  } finally {
    await rig.stop();
    void sleep;
  }
}

export { readZones };
