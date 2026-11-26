// Soak runner: plays every run of the game from start to final boss HEADLESSLY (real sim, real content, real terrain) and checks
// stability. One run per case, cases from a matrix of zones x classes x doctrines x difficulty x seeds, in parallel processes.
//
//   bun apps/game/src/dev/soak.ts [flags]           (root script: bun run qa:soak -- [flags])
//
//   --zones a,b          default: every zone of the content           --classes a,b   default: every class of the content
//   --doctrines a,b      default: a,b                                 --difficulty normal,hard   default: both
//   --seeds N            seeds per cell (default 1; 3 with --suite)   --seed0 N       first seed (default 1)   --seedList 5,9
//   --seconds N          sim time limit (default: the zone's final time + 300; + 420 for the god / veteran heroes, whose final fight the pacts and the boss milestones slow down)
//   --stats god|veteran|seasoned|plain   meta stat bonuses (default god: reaches every final; plain tests the defeat path; veteran = god plus the
//                        talent-milestone ultimates of the doctrine, the only way a run owns them)
//   --runOptions max     every Run Option slider at its maximum      --cards rotate|first|last|random   (default rotate: by seed)
//   --env game|full      game = the WorldEnv the game builds (field.env: walkable, arena radius, moveCircle, surfaceAt: SOAK-4); full is the same today
//   --jobs N             parallel worker processes (default min(6, cores - 2)); 1 = one worker (same wall watchdog); --inProcess runs in this process (no watchdog)
//   --determinism K      re-run K cases with the same seed and compare a hash of the final state
//   --suite release      the release matrix: god x doctrines x difficulty x 3 seeds, plain (defeat), runOptions max, determinism 4
//   --caseWall S         wall seconds per case before it counts as hung (default 900); the worker is killed WATCHDOG_MARGIN later
//   --budget M           stop starting new cases after M minutes of wall time (cases not run are a GLOBAL not-run: exit 1)
//   --override <json|@f> QA content override (src/data/override.ts): a JSON patch merged into the content in this process and in every worker
//                        before the first case, e.g. '{"balance":{"chestCost":{"perOpen":200}}}'; listed in the report meta, kept in every repro
//   --json out.json      results (+ out.md table, out.rows.jsonl written while it runs)        --quiet
//   --p99 MS / --maxTick MS   per-run tick p99 (default 12) / slowest-tick (default 250) limits; a hit is re-run, noise is a note
//   --selftest [--noPool]    inject faults into short runs + the pool end to end and assert every detector fires (exit 1 if one is missed)
//
// Exit code 1 when any run has a violation, a planned case was not run, or a worker failed (or the selftest misses a fault).
// See tools/qa/README.md.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, freemem, totalmem } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { content } from '../data/loader';
import { applyContentOverrideDetailed, describeOverride, readOverrideArg, type OverrideResult } from '../data/override';
import type { ClassId, ContentDB, Difficulty, DoctrineKey, EmpireId, Sex } from '../data/schema';
import {
  analyzeMemory,
  bareRow,
  compareDeterminism,
  P99_DEFAULT_MS,
  reproCommand,
  runCase,
  runSelftest,
  type BotMode,
  type CardMode,
  type CaseSpec,
  type EnvMode,
  type MemSample,
  type MemSeries,
  type MemVerdict,
  type RunRow,
  type SelftestLine,
  type StatsPreset,
} from './soakCore';

// ---------------------------------------------------------------------------------------------------------------------
// args

type Args = Record<string, string | true>;

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function list(v: string | true | undefined): string[] | null {
  if (typeof v !== 'string') return null;
  return v.split(',').map((s) => s.trim()).filter((s) => s !== '');
}

function num(v: string | true | undefined, dflt: number): number {
  if (typeof v !== 'string') return dflt;
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

// ---------------------------------------------------------------------------------------------------------------------
// matrix

interface Settings {
  zones: string[];
  classes: string[];
  doctrines: DoctrineKey[];
  difficulties: Difficulty[];
  seeds: number[];
  seconds: number | null;
  stats: StatsPreset;
  runOptionsMax: boolean;
  cards: CardMode | 'rotate';
  env: EnvMode;
  bot: BotMode;
  caseWallMs: number;
  p99: number;
  maxTick: number;
}

function pick<T extends string>(want: string[] | null, all: readonly T[], what: string): T[] {
  if (!want) return [...all];
  for (const w of want) if (!(all as readonly string[]).includes(w)) throw new Error(`unknown ${what} '${w}' (known: ${all.join(', ')})`);
  return want as T[];
}

function settingsFrom(args: Args, c: ContentDB, suite: boolean): Settings {
  const zones = pick(list(args.zones), c.zones.slice().sort((a, b) => a.order - b.order).map((z) => z.id), 'zone');
  const classes = pick(list(args.classes), c.classes.map((x) => x.id), 'class');
  const doctrines = pick(list(args.doctrines), ['a', 'b'] as const, 'doctrine');
  const difficulties = pick(list(args.difficulty), ['normal', 'hard'] as const, 'difficulty');
  const seedList = list(args.seedList);
  const seed0 = num(args.seed0, 1);
  const seeds = seedList ? seedList.map(Number) : Array.from({ length: Math.max(1, Math.floor(num(args.seeds, suite ? 3 : 1))) }, (_, i) => seed0 + i);
  const stats = (typeof args.stats === 'string' ? args.stats : 'god') as StatsPreset;
  if (!['god', 'veteran', 'seasoned', 'plain'].includes(stats)) throw new Error(`--stats must be god|veteran|seasoned|plain, got '${stats}'`);
  const cards = (typeof args.cards === 'string' ? args.cards : 'rotate') as CardMode | 'rotate';
  if (!['rotate', 'first', 'last', 'random'].includes(cards)) throw new Error(`--cards must be rotate|first|last|random, got '${cards}'`);
  const env = (typeof args.env === 'string' ? args.env : 'game') as EnvMode;
  if (!['game', 'full'].includes(env)) throw new Error(`--env must be game|full, got '${env}'`);
  const bot = (typeof args.bot === 'string' ? args.bot : 'chase') as BotMode;
  if (!['basic', 'chase'].includes(bot)) throw new Error(`--bot must be basic|chase, got '${bot}'`);
  return {
    zones,
    classes,
    doctrines,
    difficulties,
    seeds,
    seconds: typeof args.seconds === 'string' ? num(args.seconds, 0) : null,
    stats,
    runOptionsMax: args.runOptions === 'max',
    cards,
    env,
    bot,
    caseWallMs: num(args.caseWall, 900) * 1000,
    p99: num(args.p99, P99_DEFAULT_MS),
    maxTick: num(args.maxTick, 250),
  };
}

function makeSpec(c: ContentDB, s: Settings, group: string, o: { zone: string; classId: string; doctrine: DoctrineKey; difficulty: Difficulty; seed: number; stats?: StatsPreset; runOptionsMax?: boolean; bossSpawn: Record<string, number>; checkpoints?: boolean }): CaseSpec {
  const zone = c.zones.find((z) => z.id === o.zone);
  const cls = c.classes.find((x) => x.id === o.classId);
  if (!zone || !cls) throw new Error(`bad case ${o.zone}/${o.classId}`);
  const stats = o.stats ?? s.stats;
  const opt = o.runOptionsMax ?? s.runOptionsMax;
  const sex: Sex = cls.sexes[Math.abs(o.seed) % cls.sexes.length] ?? 'm';
  const empire: EmpireId = (c.empires[Math.abs(o.seed) % Math.max(1, c.empires.length)]?.id ?? 'saehwa') as EmpireId;
  const cardsMode: CardMode = s.cards === 'rotate' ? (['last', 'random', 'first'] as const)[Math.abs(o.seed) % 3] as CardMode : s.cards;
  const id = `${o.zone}/${o.classId}/${o.doctrine}/${o.difficulty}/s${o.seed}/${stats}${opt ? '/optmax' : ''}${s.env === 'full' ? '/envfull' : ''}${s.bot === 'basic' ? '/basicbot' : ''}`;
  return {
    id,
    group,
    zone: o.zone,
    classId: o.classId as ClassId,
    doctrine: o.doctrine,
    difficulty: o.difficulty,
    seed: o.seed,
    sex,
    empire,
    stats,
    runOptionsMax: opt,
    seconds: s.seconds ?? zone.final.at + (stats === 'god' || stats === 'veteran' ? 420 : 300),
    cards: cardsMode,
    env: s.env,
    bot: s.bot,
    bossSpawn: o.bossSpawn,
    // every Run Option at its maximum (3x health, damage, speed, density) is a stress setting, not a winnable one
    expectVictory: (stats === 'god' || stats === 'veteran') && !opt,
    checkpoints: o.checkpoints === true,
    wallLimitMs: s.caseWallMs,
    p99LimitMs: s.p99,
    maxTickLimitMs: s.maxTick,
  };
}

/** cells of a matrix, seeds outermost (a time-boxed run that is cut short loses the last seeds, not the last zones) */
function matrix(c: ContentDB, s: Settings, group: string, bossSpawn: Record<string, number>, over: Partial<{ classes: string[]; doctrines: DoctrineKey[]; difficulties: Difficulty[]; seeds: number[]; stats: StatsPreset; runOptionsMax: boolean }> = {}): CaseSpec[] {
  const out: CaseSpec[] = [];
  const seeds = over.seeds ?? s.seeds;
  for (const seed of seeds) {
    for (const zone of s.zones) {
      for (const classId of over.classes ?? s.classes) {
        for (const doctrine of over.doctrines ?? s.doctrines) {
          const cls = c.classes.find((x) => x.id === classId);
          if (!cls || (doctrine === 'b' && cls.doctrines.length < 2)) continue;
          for (const difficulty of over.difficulties ?? s.difficulties) {
            out.push(makeSpec(c, s, group, { zone, classId, doctrine, difficulty, seed, stats: over.stats, runOptionsMax: over.runOptionsMax, bossSpawn }));
          }
        }
      }
    }
  }
  return out;
}

interface Plan {
  specs: CaseSpec[];
  description: string[];
}

function buildPlan(c: ContentDB, args: Args, bossSpawn: Record<string, number>): Plan {
  const suite = args.suite === 'release';
  const s = settingsFrom(args, c, suite);
  const description: string[] = [];
  if (typeof args.from === 'string') {
    // re-run the cases of an earlier results file (.rows.jsonl) that had one of the given violation kinds, with today's flags
    const kinds = list(args.kinds);
    const prev = readFileSync(resolve(args.from), 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as RunRow);
    const chosen = prev.filter((r) => !r.twinOf && (!kinds || r.violations.some((v) => kinds.includes(v.kind)) || kinds.some((k) => (r.violationCounts?.[k] ?? 0) > 0)));
    const specs = chosen.map((r) => makeSpec(c, { ...s, cards: r.cards, seconds: s.seconds }, 'rerun', { zone: r.zone, classId: r.classId, doctrine: r.doctrine as DoctrineKey, difficulty: r.difficulty as Difficulty, seed: r.seed, stats: r.stats, runOptionsMax: r.runOptionsMax, bossSpawn }));
    return { specs, description: [`rerun of ${chosen.length} of ${prev.length} cases from ${args.from}${kinds ? ` with violation kinds ${kinds.join(',')}` : ''}, bot ${s.bot}`] };
  }
  let specs: CaseSpec[] = [];
  const detK = Math.floor(num(args.determinism, suite ? 4 : 0));
  if (!suite) {
    specs = matrix(c, s, 'main', bossSpawn);
    description.push(`main: ${s.zones.length} zones x ${s.classes.length} classes x ${s.doctrines.length} doctrines x ${s.difficulties.length} difficulties x ${s.seeds.length} seeds, stats ${s.stats}${s.runOptionsMax ? ', runOptions max' : ''}`);
  } else {
    // round r = seed r of the god matrix, plus (in round 1) the cheap extras, so a cut-short run keeps every group
    const godSeeds = s.seeds;
    const main = matrix(c, s, 'main', bossSpawn, { stats: 'god', runOptionsMax: false });
    description.push(`main (god): ${s.zones.length} zones x ${s.classes.length} classes x ${s.doctrines.length} doctrines x ${s.difficulties.length} difficulties x ${godSeeds.length} seeds = ${main.length}`);
    // plain stats (defeat path): every zone x 2 classes (rotating through the class list), both difficulties, 2 seeds
    const plain: CaseSpec[] = [];
    s.zones.forEach((zone, zi) => {
      const two = [s.classes[zi % s.classes.length], s.classes[(zi + 2) % s.classes.length]].filter((x): x is string => x !== undefined);
      for (const seed of [s.seeds[0] ?? 1, (s.seeds[0] ?? 1) + 100]) {
        for (const classId of new Set(two)) {
          for (const difficulty of s.difficulties) plain.push(makeSpec(c, s, 'plain', { zone, classId, doctrine: seed > 50 ? 'b' : 'a', difficulty, seed, stats: 'plain', runOptionsMax: false, bossSpawn }));
        }
      }
    });
    description.push(`plain (defeat path): ${s.zones.length} zones x 2 classes x ${s.difficulties.length} difficulties x 2 seeds = ${plain.length}`);
    // every Run Option at its maximum, hard mode, god hero: caps and perf under 3x density / health / damage / speed
    const options: CaseSpec[] = [];
    s.zones.forEach((zone, zi) => {
      const two = [s.classes[(zi + 1) % s.classes.length], s.classes[(zi + 3) % s.classes.length]].filter((x): x is string => x !== undefined);
      for (const classId of new Set(two)) options.push(makeSpec(c, s, 'options', { zone, classId, doctrine: zi % 2 === 0 ? 'a' : 'b', difficulty: 'hard', seed: (s.seeds[0] ?? 1) + 200, stats: 'god', runOptionsMax: true, bossSpawn }));
    });
    description.push(`options (every Run Option at max, hard, god): ${s.zones.length} zones x 2 classes = ${options.length}`);
    // the 30 ultimates come only from the talent tree milestones (no card policy offers them): god stats plus the doctrine's milestone ultimates,
    // every class x doctrine once (zones rotating), so coverage.skillsUnseen is empty on the release suite
    const ultimates: CaseSpec[] = [];
    let ui = 0;
    for (const classId of s.classes) {
      for (const doctrine of s.doctrines) {
        const cls = c.classes.find((x) => x.id === classId);
        if (!cls || (doctrine === 'b' && cls.doctrines.length < 2)) continue;
        const zone = s.zones[ui++ % Math.max(1, s.zones.length)];
        if (zone) ultimates.push(makeSpec(c, s, 'ultimates', { zone, classId, doctrine, difficulty: 'normal', seed: (s.seeds[0] ?? 1) + 300, stats: 'veteran', runOptionsMax: false, bossSpawn }));
      }
    }
    description.push(`ultimates (god + the doctrine's milestone ultimates): ${ultimates.length} (class x doctrine, zones rotating)`);
    const bySeed = (seed: number): CaseSpec[] => main.filter((x) => x.seed === seed);
    const first = godSeeds[0] ?? 1;
    const round1 = [...bySeed(first), ...options, ...plain, ...ultimates];
    const twins: CaseSpec[] = [];
    if (detK > 0) {
      // spread over the first round; the last pick is a heaviest-state case (every Run Option at max)
      const firstRound = bySeed(first);
      const picks: CaseSpec[] = [];
      for (let i = 0; i < detK; i++) {
        const pickSpec = firstRound[Math.min(firstRound.length - 1, Math.floor(((i + 0.5) * firstRound.length) / detK))];
        if (pickSpec) picks.push(pickSpec);
      }
      const heavy = options[0];
      if (heavy && picks.length > 1) picks[picks.length - 1] = heavy;
      for (const orig of picks) {
        const i = round1.findIndex((x) => x.id === orig.id);
        if (i >= 0) round1[i] = { ...orig, checkpoints: true };
        twins.push({ ...orig, id: `${orig.id}#twin`, group: 'determinism', checkpoints: true, twinOf: orig.id });
      }
      description.push(`determinism: ${picks.length} cases re-run with the same seed (compared by state hash, checkpoints every 10 s)`);
    }
    specs = [...round1, ...twins];
    for (const seed of godSeeds.slice(1)) specs.push(...bySeed(seed));
    return { specs, description };
  }
  if (detK > 0 && specs.length > 0) {
    const picks: CaseSpec[] = [];
    for (let i = 0; i < Math.min(detK, specs.length); i++) {
      const orig = specs[Math.min(specs.length - 1, Math.floor(((i + 0.5) * specs.length) / detK))];
      if (orig) picks.push(orig);
    }
    for (const orig of picks) {
      const i = specs.findIndex((x) => x.id === orig.id);
      if (i >= 0) specs[i] = { ...orig, checkpoints: true };
      specs.push({ ...orig, id: `${orig.id}#twin`, group: 'determinism', checkpoints: true, twinOf: orig.id });
    }
    description.push(`determinism: ${picks.length} cases re-run with the same seed`);
  }
  return { specs, description };
}

// ---------------------------------------------------------------------------------------------------------------------
// bossModel stub from the asset manifest (the game: assets.manifest.models[id].clips.spawn.duration)

function readBossSpawn(c: ContentDB): { bossSpawn: Record<string, number>; manifestSha: string; note: string } {
  const file = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/assets/manifest.json');
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const raw = readFileSync(file, 'utf8');
      const manifest = JSON.parse(raw) as { models?: Record<string, { clips?: Record<string, { duration?: number }> }> };
      const bossSpawn: Record<string, number> = {};
      for (const b of c.bosses) bossSpawn[b.model] = manifest.models?.[b.model]?.clips?.spawn?.duration ?? 0;
      return { bossSpawn, manifestSha: createHash('sha1').update(raw).digest('hex').slice(0, 10), note: '' };
    } catch (err) {
      // another workflow may be writing the manifest right now
      const until = Date.now() + 300;
      while (Date.now() < until) {
        /* wait */
      }
      if (attempt === 3) return { bossSpawn: {}, manifestSha: 'unreadable', note: `manifest unreadable (${String(err)}); boss spawn clips assumed 0` };
    }
  }
  return { bossSpawn: {}, manifestSha: 'unreadable', note: 'manifest unreadable' };
}

// ---------------------------------------------------------------------------------------------------------------------
// memory

function gcNow(): void {
  const g = globalThis as { Bun?: { gc?: (sync: boolean) => void }; gc?: () => void };
  if (g.Bun?.gc) {
    g.Bun.gc(true);
    g.Bun.gc(true);
  } else g.gc?.();
}

function memNow(): MemSample {
  gcNow();
  const m = process.memoryUsage();
  return { rssMB: Math.round(m.rss / 104857.6) / 10, heapMB: Math.round(m.heapUsed / 104857.6) / 10 };
}

// ---------------------------------------------------------------------------------------------------------------------
// machine load (cpu busy % between samples, from os.cpus() times)

interface CpuSnap {
  idle: number;
  total: number;
}

function cpuSnap(): CpuSnap {
  let idle = 0;
  let total = 0;
  for (const c of cpus()) {
    idle += c.times.idle;
    total += c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq;
  }
  return { idle, total };
}

function busyPct(a: CpuSnap, b: CpuSnap): number {
  const dt = b.total - a.total;
  return dt <= 0 ? 0 : Math.round((1000 * (dt - (b.idle - a.idle))) / dt) / 10;
}

// ---------------------------------------------------------------------------------------------------------------------
// worker side

/**
 * pool-level selftest faults (env MS_SOAK_SELFTEST_FAULT, set only by `--selftest` for its child runs): `worker-start` = every worker
 * exits before @@READY; `leak:<MB>` = each run keeps <MB> MB alive in the worker (a real leak, seen by the after-GC memory series)
 */
const POOL_FAULT = process.env.MS_SOAK_SELFTEST_FAULT ?? '';
const leaked: Float64Array[] = [];
/** a case that runs longer than its wall limit plus this margin (60 s; a quarter of a short limit, at least 3 s) is hung and its worker is killed */
export function watchdogMs(wallLimitMs: number): number {
  return wallLimitMs + Math.min(60000, Math.max(3000, wallLimitMs * 0.25));
}

function selftestLeak(): void {
  // pool fault `hang`: the worker never returns from a case (an endless loop in the sim): the watchdog must kill it
  if (POOL_FAULT === 'hang') for (;;) { /* hung */ }
  if (!POOL_FAULT.startsWith('leak:')) return;
  const mb = Number(POOL_FAULT.slice(5));
  if (Number.isFinite(mb) && mb > 0) leaked.push(new Float64Array((mb * 1048576) / 8).fill(1));
}

/** --override of this process: the text as typed (for repro commands) and the JSON text the workers get */
let overrideArg: string | null = null;
let overrideJson: string | null = null;

/** Parses and applies a --override argument to the shared content; remembers it for the workers and the repro commands. */
function applyOverrideArg(arg: unknown): OverrideResult | null {
  if (arg === undefined) return null;
  if (typeof arg !== 'string' || arg.trim() === '') throw new Error('--override needs a value: --override <json|@file>');
  const patch = readOverrideArg(arg);
  const result = applyContentOverrideDetailed(content, patch);
  overrideArg = arg;
  overrideJson = JSON.stringify(patch);
  return result;
}

/** a repro command that also carries the override (a file stays @file, inline JSON is single-quoted) */
function withOverrideRepro(cmd: string): string {
  if (overrideArg === null || cmd === '' || cmd.includes(' --override ')) return cmd;
  const a = overrideArg.trim();
  return `${cmd} --override ${a.startsWith('@') ? a : `'${a.replace(/'/g, "'\\''")}'`}`;
}

function workerMain(args: Args): void {
  if (POOL_FAULT === 'worker-start') process.exit(3);
  try {
    // the same patch the main process applied, before the first case (the main process passes it as inline JSON)
    applyOverrideArg(args.override);
  } catch (err) {
    console.error(`worker: --override failed: ${String(err)}`);
    process.exit(3);
  }
  let buf = '';
  const queue: string[] = [];
  let busy = false;
  let ended = false;
  const send = (s: string): void => {
    process.stdout.write(s + '\n');
  };
  const pump = (): void => {
    if (busy) return;
    busy = true;
    const step = (): void => {
      const line = queue.shift();
      if (line === undefined) {
        busy = false;
        if (ended) process.exit(0);
        return;
      }
      try {
        const msg = JSON.parse(line) as { spec?: CaseSpec; quit?: boolean };
        if (msg.quit) process.exit(0);
        if (msg.spec) {
          const before = memNow();
          const row = runCase(content, msg.spec);
          selftestLeak();
          const after = memNow();
          row.mem = { before, after };
          send('@@ROW ' + JSON.stringify(row));
        }
      } catch (err) {
        send('@@ERR ' + JSON.stringify(String(err)));
      }
      setImmediate(step);
    };
    step();
  };
  send('@@READY');
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    buf += chunk;
    let nl = buf.indexOf('\n');
    while (nl >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line !== '') queue.push(line);
      nl = buf.indexOf('\n');
    }
    pump();
  });
  process.stdin.on('end', () => {
    ended = true;
    pump();
    if (!busy) process.exit(0);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// pool

interface Slot {
  idx: number;
  proc: ChildProcess | null;
  cur: CaseSpec | null;
  startedAt: number;
  buf: string;
  err: string;
  respawns: number;
  done: number;
  series: MemSeries;
  closed: boolean;
  /** the worker said @@READY (a worker that dies before it is a pool error, not a silent loss of the slot) */
  ready: boolean;
}

function killTree(proc: ChildProcess | null): void {
  if (!proc || proc.pid === undefined || proc.exitCode !== null) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else proc.kill('SIGKILL');
  } catch {
    /* already gone */
  }
}

interface PoolOpts {
  /** the --override JSON text for the workers (null = none) */
  overrideJson: string | null;
  jobs: number;
  /** run the cases in this process (no watchdog); default: a pool of `jobs` worker processes, also for 1 */
  inProcess?: boolean;
  budgetMs: number;
  quiet: boolean;
  jsonl: string | null;
}

interface PoolResult {
  rows: RunRow[];
  notRun: CaseSpec[];
  series: MemSeries[];
  cpuSamples: { tSec: number; busyPct: number }[];
  wallMs: number;
  stoppedByBudget: boolean;
  /** workers that died before they were ready, error lines without a case, rows that could not be read */
  poolErrors: string[];
}

async function runPool(specs: CaseSpec[], opts: PoolOpts): Promise<PoolResult> {
  const t0 = Date.now();
  const rows: RunRow[] = [];
  const queue = specs.slice();
  const total = specs.length;
  const slots: Slot[] = [];
  const cpuSamples: { tSec: number; busyPct: number }[] = [];
  let stoppedByBudget = false;
  const allSeries: MemSeries[] = [];
  const poolErrors: string[] = [];
  let lastCpu = cpuSnap();
  const script = fileURLToPath(import.meta.url);

  const record = (row: RunRow, slot: Slot | null): void => {
    row.repro = withOverrideRepro(row.repro);
    rows.push(row);
    if (slot) {
      slot.done++;
      if (row.mem) {
        slot.series.heapMB.push(row.mem.after.heapMB);
        slot.series.rssMB.push(row.mem.after.rssMB);
      }
    }
    if (opts.jsonl) appendFileSync(opts.jsonl, JSON.stringify(row) + '\n');
    if (!opts.quiet) {
      const v = row.violations.length;
      console.log(`[${rows.length}/${total}] ${row.id} ${row.outcome} sim=${row.simSeconds}s wall=${(row.wallMs / 1000).toFixed(1)}s p99=${row.tickMs.p99}ms alive<=${row.max.alive}${v > 0 ? ` VIOLATIONS=${[...new Set(row.violations.map((x) => x.kind))].join(',')}` : ''}`);
    }
  };

  // in-process mode (--inProcess / --noPool only): no watchdog, an endless loop inside World.step hangs the process. `--jobs 1` runs ONE
  // worker of the pool instead, so every repro command has the same wall watchdog as a matrix run (SOAKREV-9 a)
  if (opts.jobs <= 1 && opts.inProcess) {
    const series: MemSeries = { worker: 0, heapMB: [], rssMB: [] };
    const slot: Slot = { idx: 0, proc: null, cur: null, startedAt: 0, buf: '', err: '', respawns: 0, done: 0, series, closed: false, ready: true };
    while (queue.length > 0) {
      if (opts.budgetMs > 0 && Date.now() - t0 > opts.budgetMs) {
        stoppedByBudget = true;
        break;
      }
      const spec = queue.shift() as CaseSpec;
      const before = memNow();
      const row = runCase(content, spec);
      selftestLeak();
      row.mem = { before, after: memNow() };
      row.worker = 0;
      record(row, slot);
    }
    return { rows, notRun: queue, series: [series], cpuSamples, wallMs: Date.now() - t0, stoppedByBudget, poolErrors };
  }

  const cpuTimer = setInterval(() => {
    const now = cpuSnap();
    cpuSamples.push({ tSec: Math.round((Date.now() - t0) / 1000), busyPct: busyPct(lastCpu, now) });
    lastCpu = now;
  }, 15000);

  await new Promise<void>((done) => {
    let live = 0;
    const finishIfDone = (): void => {
      if (live === 0 && slots.every((s) => s.cur === null)) done();
    };
    const dispatch = (slot: Slot): void => {
      if (slot.closed || slot.cur) return;
      if (opts.budgetMs > 0 && Date.now() - t0 > opts.budgetMs && queue.length > 0) stoppedByBudget = true;
      const next = stoppedByBudget ? undefined : queue.shift();
      if (!next) {
        slot.closed = true;
        try {
          slot.proc?.stdin?.write(JSON.stringify({ quit: true }) + '\n');
          slot.proc?.stdin?.end();
        } catch {
          /* gone */
        }
        return;
      }
      slot.cur = next;
      slot.startedAt = Date.now();
      slot.proc?.stdin?.write(JSON.stringify({ spec: next }) + '\n');
    };
    const crashRow = (spec: CaseSpec, slot: Slot, why: string, kind: string): RunRow => {
      const r = bareRow(spec);
      r.outcome = 'crash';
      r.wallMs = Date.now() - slot.startedAt;
      r.worker = slot.idx;
      r.violations.push({ kind, detail: why });
      return r;
    };
    const start = (slot: Slot): void => {
      const proc = spawn(process.execPath, [script, '--worker', '--workerIdx', String(slot.idx), ...(opts.overrideJson !== null ? ['--override', opts.overrideJson] : [])], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      slot.proc = proc;
      slot.buf = '';
      slot.err = '';
      live++;
      proc.stdout?.setEncoding('utf8');
      proc.stderr?.setEncoding('utf8');
      proc.stderr?.on('data', (d: string) => {
        slot.err = (slot.err + d).slice(-2000);
      });
      proc.stdout?.on('data', (d: string) => {
        slot.buf += d;
        let nl = slot.buf.indexOf('\n');
        while (nl >= 0) {
          const line = slot.buf.slice(0, nl).trim();
          slot.buf = slot.buf.slice(nl + 1);
          nl = slot.buf.indexOf('\n');
          if (line === '@@READY') {
            slot.ready = true;
            dispatch(slot);
          } else if (line.startsWith('@@ROW ')) {
            const spec = slot.cur;
            slot.cur = null;
            let row: RunRow;
            try {
              row = JSON.parse(line.slice(6)) as RunRow;
            } catch (err) {
              // a row that cannot be read is a failed case, never a dropped one
              if (!spec) {
                poolErrors.push(`worker ${slot.idx}: unreadable row without a case (${String(err)})`);
                dispatch(slot);
                continue;
              }
              row = crashRow(spec, slot, `the worker's result line could not be parsed: ${String(err)}`, 'worker-row-unreadable');
            }
            row.worker = slot.idx;
            record(row, slot);
            dispatch(slot);
          } else if (line.startsWith('@@ERR ')) {
            const spec = slot.cur;
            slot.cur = null;
            if (spec) record(crashRow(spec, slot, `worker error: ${line.slice(6)}`, 'worker-error'), slot);
            else poolErrors.push(`worker ${slot.idx}: error line without a case: ${line.slice(6, 400)}`);
            dispatch(slot);
          }
        }
      });
      proc.on('exit', (code, sig) => {
        live--;
        const spec = slot.cur;
        slot.cur = null;
        const wasReady = slot.ready;
        slot.ready = false;
        if (spec) record(crashRow(spec, slot, `worker process died (exit ${code}, signal ${sig}) while running the case; stderr tail: ${slot.err.slice(-600)}`, 'worker-crash'), slot);
        // a worker that dies before @@READY (module error, OOM, a refused process) used to vanish with its slot: with every worker
        // gone the pool ended with 0 rows and the report said "clean"
        else if (!wasReady && !slot.closed) poolErrors.push(`worker ${slot.idx} exited (exit ${code}, signal ${sig}) before it was ready; stderr tail: ${slot.err.slice(-400).trim()}`);
        if ((spec || (!wasReady && !slot.closed)) && slot.respawns < 8 && queue.length > 0 && !stoppedByBudget) {
          slot.respawns++;
          slot.series = { worker: slot.idx, heapMB: [], rssMB: [] };
          allSeries.push(slot.series);
          start(slot);
          return;
        }
        finishIfDone();
      });
    };
    for (let i = 0; i < opts.jobs; i++) {
      const series: MemSeries = { worker: i, heapMB: [], rssMB: [] };
      allSeries.push(series);
      const slot: Slot = { idx: i, proc: null, cur: null, startedAt: 0, buf: '', err: '', respawns: 0, done: 0, series, closed: false, ready: false };
      slots.push(slot);
      start(slot);
    }
    // watchdog: a case that hangs (an infinite loop in the sim) is killed
    const watch = setInterval(() => {
      for (const slot of slots) {
        if (slot.cur && Date.now() - slot.startedAt > watchdogMs(slot.cur.wallLimitMs || 900000)) {
          killTree(slot.proc); // the 'exit' handler records the crash row and respawns
        }
      }
    }, 5000);
    const poll = setInterval(() => {
      if (live === 0 && slots.every((s) => s.cur === null)) {
        clearInterval(watch);
        clearInterval(poll);
        done();
      }
    }, 500);
  });
  clearInterval(cpuTimer);
  for (const s of slots) killTree(s.proc);
  return { rows, notRun: queue, series: allSeries, cpuSamples, wallMs: Date.now() - t0, stoppedByBudget, poolErrors };
}

// ---------------------------------------------------------------------------------------------------------------------
// aggregate + report

interface Aggregate {
  requested: number;
  run: number;
  notRun: number;
  stoppedByBudget: boolean;
  outcomes: Record<string, number>;
  violationRuns: number;
  violationsByKind: Record<string, { runs: number; example: string; exampleId: string }>;
  byGroup: Record<string, { runs: number; victory: number; defeat: number; timeout: number; crash: number; withViolations: number }>;
  byZone: Record<string, { runs: number; victory: number; defeat: number; timeout: number; withViolations: number; meanSimS: number; meanWallS: number }>;
  byClass: Record<string, { runs: number; victory: number; defeat: number; timeout: number; withViolations: number }>;
  tick: { meanOfMeansMs: number; worstP99Ms: number; worstP99Id: string; worstMaxMs: number; worstMaxId: string; slowestAtSimS: number };
  max: { alive: number; aliveId: string; enemyRows: number; projectiles: number; pickups: number; zones: number; telegraphs: number; eventsPerTick: number };
  wall: { totalRunS: number; meanS: number; maxS: number; maxId: string };
  blocked: { runsWithBlockedSpawns: number; totalBlockedSpawns: number; spawnsTotalSample: number; worstId: string; enemiesInBlockedMax: number };
  stuck: { runsWithWiggles: number; totalWiggles: number; maxStillSec: number; maxStillId: string };
  coverage: { skillsSeen: number; skillsTotal: number; skillsUnseen: string[]; passivesSeen: number; passivesTotal: number; passivesUnseen: string[]; metinTypesPerZone: Record<string, { seen: string[]; missing: string[] }>; bossesPerZone: Record<string, { spawned: string[]; missing: string[] }> };
}

function aggregate(c: ContentDB, rows: RunRow[], requested: number, notRun: number, stoppedByBudget: boolean): Aggregate {
  const outcomes: Record<string, number> = {};
  const byKind: Aggregate['violationsByKind'] = {};
  const byGroup: Aggregate['byGroup'] = {};
  const byZone: Aggregate['byZone'] = {};
  const byClass: Aggregate['byClass'] = {};
  let violationRuns = 0;
  let sumMean = 0;
  let worstP99 = 0;
  let worstP99Id = '';
  let worstMax = 0;
  let worstMaxId = '';
  let slowAt = 0;
  const max = { alive: 0, aliveId: '', enemyRows: 0, projectiles: 0, pickups: 0, zones: 0, telegraphs: 0, eventsPerTick: 0 };
  let wallTotal = 0;
  let wallMax = 0;
  let wallMaxId = '';
  let blockedRuns = 0;
  let blockedTotal = 0;
  let blockedWorst = 0;
  let blockedWorstId = '';
  let inBlockedMax = 0;
  let wiggleRuns = 0;
  let wiggles = 0;
  let stillMax = 0;
  let stillId = '';
  const skillsSeen = new Set<string>();
  const passivesSeen = new Set<string>();
  const metinSeen = new Map<string, Set<string>>();
  const bossSeen = new Map<string, Set<string>>();
  for (const r of rows) {
    outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1;
    if (r.violations.length > 0) violationRuns++;
    // kinds from the counts too: violations[] keeps only the first few entries of a run
    for (const k of new Set([...r.violations.map((v) => v.kind), ...Object.keys(r.violationCounts ?? {})])) {
      const e = byKind[k] ?? { runs: 0, example: '', exampleId: '' };
      e.runs++;
      if (e.example === '') {
        e.example = r.violations.find((v) => v.kind === k)?.detail.split('\n')[0] ?? '';
        e.exampleId = r.id;
      }
      byKind[k] = e;
    }
    const g = (byGroup[r.group] ??= { runs: 0, victory: 0, defeat: 0, timeout: 0, crash: 0, withViolations: 0 });
    g.runs++;
    if (r.outcome === 'victory') g.victory++;
    else if (r.outcome === 'defeat') g.defeat++;
    else if (r.outcome === 'timeout') g.timeout++;
    else g.crash++;
    if (r.violations.length > 0) g.withViolations++;
    const z = (byZone[r.zone] ??= { runs: 0, victory: 0, defeat: 0, timeout: 0, withViolations: 0, meanSimS: 0, meanWallS: 0 });
    z.runs++;
    z.meanSimS += r.simSeconds;
    z.meanWallS += r.wallMs / 1000;
    if (r.outcome === 'victory') z.victory++;
    else if (r.outcome === 'defeat') z.defeat++;
    else if (r.outcome === 'timeout') z.timeout++;
    if (r.violations.length > 0) z.withViolations++;
    const k = (byClass[r.classId] ??= { runs: 0, victory: 0, defeat: 0, timeout: 0, withViolations: 0 });
    k.runs++;
    if (r.outcome === 'victory') k.victory++;
    else if (r.outcome === 'defeat') k.defeat++;
    else if (r.outcome === 'timeout') k.timeout++;
    if (r.violations.length > 0) k.withViolations++;
    sumMean += r.tickMs.mean;
    if (r.tickMs.p99 > worstP99) {
      worstP99 = r.tickMs.p99;
      worstP99Id = r.id;
    }
    if (r.tickMs.max > worstMax) {
      worstMax = r.tickMs.max;
      worstMaxId = r.id;
      slowAt = r.tickMs.slowestSimTime;
    }
    if (r.max.alive > max.alive) {
      max.alive = r.max.alive;
      max.aliveId = r.id;
    }
    max.enemyRows = Math.max(max.enemyRows, r.max.enemyRows);
    max.projectiles = Math.max(max.projectiles, r.max.projectiles);
    max.pickups = Math.max(max.pickups, r.max.pickups);
    max.zones = Math.max(max.zones, r.max.zones);
    max.telegraphs = Math.max(max.telegraphs, r.max.telegraphs);
    max.eventsPerTick = Math.max(max.eventsPerTick, r.max.eventsPerTick);
    wallTotal += r.wallMs / 1000;
    if (r.wallMs / 1000 > wallMax) {
      wallMax = r.wallMs / 1000;
      wallMaxId = r.id;
    }
    if (r.blockedSpawns > 0) {
      blockedRuns++;
      blockedTotal += r.blockedSpawns;
      if (r.blockedSpawns > blockedWorst) {
        blockedWorst = r.blockedSpawns;
        blockedWorstId = r.id;
      }
    }
    inBlockedMax = Math.max(inBlockedMax, r.enemiesBlockedMax);
    if (r.stuck.wiggles > 0) wiggleRuns++;
    wiggles += r.stuck.wiggles;
    if (r.stuck.maxStillSec > stillMax) {
      stillMax = r.stuck.maxStillSec;
      stillId = r.id;
    }
    for (const s of r.seen.skills) skillsSeen.add(s);
    for (const s of r.seen.passives) passivesSeen.add(s);
    const ms = metinSeen.get(r.zone) ?? new Set<string>();
    for (const m of Object.keys(r.seen.metinWarns)) ms.add(m);
    metinSeen.set(r.zone, ms);
    const bs = bossSeen.get(r.zone) ?? new Set<string>();
    for (const b of Object.keys(r.seen.bossSpawns)) bs.add(b);
    bossSeen.set(r.zone, bs);
  }
  for (const z of Object.values(byZone)) {
    z.meanSimS = Math.round(z.meanSimS / Math.max(1, z.runs));
    z.meanWallS = Math.round((10 * z.meanWallS) / Math.max(1, z.runs)) / 10;
  }
  const activeSkills = c.skills.filter((s) => s.kind === 'active' || s.kind === 'basic' || s.kind === 'ultimate').map((s) => s.id);
  const passiveIds = c.passives.map((p) => p.id);
  const metinTypesPerZone: Aggregate['coverage']['metinTypesPerZone'] = {};
  const bossesPerZone: Aggregate['coverage']['bossesPerZone'] = {};
  for (const z of c.zones) {
    if (!metinSeen.has(z.id)) continue;
    const seen = metinSeen.get(z.id) ?? new Set<string>();
    const want = [...z.metins.types, z.final.greatMetin];
    metinTypesPerZone[z.id] = { seen: want.filter((x) => seen.has(x)), missing: want.filter((x) => !seen.has(x)) };
    const bs = bossSeen.get(z.id) ?? new Set<string>();
    const wantB = [...new Set([...z.bosses.map((b) => b.boss), z.final.boss])];
    bossesPerZone[z.id] = { spawned: wantB.filter((x) => bs.has(x)), missing: wantB.filter((x) => !bs.has(x)) };
  }
  return {
    requested,
    run: rows.length,
    notRun,
    stoppedByBudget,
    outcomes,
    violationRuns,
    violationsByKind: byKind,
    byGroup,
    byZone,
    byClass,
    tick: { meanOfMeansMs: Math.round((100 * sumMean) / Math.max(1, rows.length)) / 100, worstP99Ms: worstP99, worstP99Id, worstMaxMs: worstMax, worstMaxId, slowestAtSimS: slowAt },
    max,
    wall: { totalRunS: Math.round(wallTotal), meanS: Math.round((10 * wallTotal) / Math.max(1, rows.length)) / 10, maxS: Math.round(wallMax * 10) / 10, maxId: wallMaxId },
    blocked: { runsWithBlockedSpawns: blockedRuns, totalBlockedSpawns: blockedTotal, spawnsTotalSample: 0, worstId: blockedWorstId, enemiesInBlockedMax: inBlockedMax },
    stuck: { runsWithWiggles: wiggleRuns, totalWiggles: wiggles, maxStillSec: stillMax, maxStillId: stillId },
    coverage: {
      skillsSeen: activeSkills.filter((s) => skillsSeen.has(s)).length,
      skillsTotal: activeSkills.length,
      skillsUnseen: activeSkills.filter((s) => !skillsSeen.has(s)),
      passivesSeen: passiveIds.filter((s) => passivesSeen.has(s)).length,
      passivesTotal: passiveIds.length,
      passivesUnseen: passiveIds.filter((s) => !passivesSeen.has(s)),
      metinTypesPerZone,
      bossesPerZone,
    },
  };
}

function markdown(meta: Record<string, unknown>, agg: Aggregate, rows: RunRow[], mem: MemVerdict[], det: ReturnType<typeof compareDeterminism>): string {
  const L: string[] = [];
  L.push('# Soak report', '');
  L.push('```json', JSON.stringify(meta, null, 2), '```', '');
  L.push(`Runs: ${agg.run} of ${agg.requested} requested (${agg.notRun} not run${agg.stoppedByBudget ? ', stopped by the time budget' : ''}). Outcomes: ${JSON.stringify(agg.outcomes)}. Runs with violations: ${agg.violationRuns}.`, '');
  L.push('## Groups', '', '| group | runs | victory | defeat | timeout | other | with violations |', '|---|---|---|---|---|---|---|');
  for (const [k, g] of Object.entries(agg.byGroup)) L.push(`| ${k} | ${g.runs} | ${g.victory} | ${g.defeat} | ${g.timeout} | ${g.crash} | ${g.withViolations} |`);
  L.push('', '## Zones', '', '| zone | runs | victory | defeat | timeout | violations | mean sim s | mean wall s |', '|---|---|---|---|---|---|---|---|');
  for (const [k, g] of Object.entries(agg.byZone)) L.push(`| ${k} | ${g.runs} | ${g.victory} | ${g.defeat} | ${g.timeout} | ${g.withViolations} | ${g.meanSimS} | ${g.meanWallS} |`);
  L.push('', '## Classes', '', '| class | runs | victory | defeat | timeout | violations |', '|---|---|---|---|---|---|');
  for (const [k, g] of Object.entries(agg.byClass)) L.push(`| ${k} | ${g.runs} | ${g.victory} | ${g.defeat} | ${g.timeout} | ${g.withViolations} |`);
  L.push('', '## Violations by kind', '');
  if (Object.keys(agg.violationsByKind).length === 0) L.push('none');
  else {
    L.push('| kind | runs | first example |', '|---|---|---|');
    for (const [k, v] of Object.entries(agg.violationsByKind)) L.push(`| ${k} | ${v.runs} | ${v.exampleId}: ${v.example.replace(/\|/g, '/')} |`);
  }
  L.push('', '## Performance and limits', '', '```json', JSON.stringify({ tick: agg.tick, max: agg.max, wall: agg.wall, blocked: agg.blocked, stuck: agg.stuck }, null, 2), '```');
  L.push('', '## Coverage', '', '```json', JSON.stringify(agg.coverage, null, 2), '```');
  L.push('', '## Memory (per worker process, after forced GC)', '', '| worker | runs | heap start MB | heap end MB | heap slope MB/run | rss start | rss end | rss slope | leak |', '|---|---|---|---|---|---|---|---|---|');
  for (const m of mem) L.push(`| ${m.worker} | ${m.runs} | ${m.heapStartMB} | ${m.heapEndMB} | ${m.heapSlopeMBPerRun} | ${m.rssStartMB} | ${m.rssEndMB} | ${m.rssSlopeMBPerRun} | ${m.leak ? 'YES ' + m.note : 'no'} |`);
  L.push('', '## Determinism', '');
  if (det.length === 0) L.push('no pairs');
  else {
    L.push('| case | twin | equal | hash A | hash B | first divergence s |', '|---|---|---|---|---|---|');
    for (const d of det) L.push(`| ${d.id} | ${d.twin} | ${d.equal ? 'yes' : 'NO'} | ${d.hashA} | ${d.hashB} | ${d.firstDivergenceS ?? ''} |`);
  }
  L.push('', '## Runs', '', '| id | group | outcome | sim s | wall s | ticks | tick mean/p99/max ms | max alive | lvl | kills | violations |', '|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    L.push(`| ${r.id} | ${r.group} | ${r.outcome} | ${r.simSeconds} | ${(r.wallMs / 1000).toFixed(1)} | ${r.ticks} | ${r.tickMs.mean}/${r.tickMs.p99}/${r.tickMs.max} | ${r.max.alive} | ${r.level} | ${r.kills} | ${[...new Set(r.violations.map((v) => v.kind))].join(', ')} |`);
  }
  L.push('');
  return L.join('\n');
}

// ---------------------------------------------------------------------------------------------------------------------
// pool selftest: the CLI run end to end in child processes (exit code + GLOBAL lines), with the env faults of workerMain

function poolSelftest(): SelftestLine[] {
  const script = fileURLToPath(import.meta.url);
  const zone = content.zones.slice().sort((a, b) => a.order - b.order)[0]?.id ?? '';
  const cls = content.classes[0]?.id ?? '';
  const one = ['--zones', zone, '--classes', cls, '--doctrines', 'a', '--difficulty', 'normal', '--quiet'];
  const run = (args: string[], fault: string): { code: number | null; out: string } => {
    const r = spawnSync(process.execPath, [script, ...one, ...args], { env: { ...process.env, MS_SOAK_SELFTEST_FAULT: fault }, encoding: 'utf8', timeout: 180000, windowsHide: true });
    return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  };
  const out: SelftestLine[] = [];
  const check = (fault: string, note: string, res: { code: number | null; out: string }, must: string[], mustNot: string[] = []): void => {
    const got = [`exit ${res.code}`, ...[...must, ...mustNot].filter((m) => res.out.includes(m))];
    const detected = res.code === 1 && must.every((m) => res.out.includes(m)) && mustNot.every((m) => !res.out.includes(m));
    out.push({ fault, note, expected: ['exit 1', ...must, ...mustNot.map((m) => `!${m}`)], got, detected });
  };
  check('poolBudget', 'every case cut by --budget (the first pool printed "RESULT: clean", exit 0, for 0 of 2 runs)', run(['--seedList', '1,2', '--seconds', '5', '--budget', '0.0001', '--jobs', '2'], ''), ['GLOBAL not-run']);
  check('poolDeadWorkers', 'every worker exits before @@READY (the first pool lost the slots silently: 0 rows, "clean")', run(['--seedList', '1,2', '--seconds', '5', '--jobs', '2'], 'worker-start'), ['GLOBAL pool-error', 'GLOBAL not-run']);
  // 12 short runs in one process, 2 MB kept per run: robust growth ~14 MB, slope 2 MB/run (the first thresholds wanted +25 MB)
  check('poolLeak', 'a worker keeps 2 MB per run over 12 runs (end to end: worker memory series -> GLOBAL memory-leak)', run(['--seeds', '12', '--seconds', '3', '--jobs', '1'], 'leak:2'), ['GLOBAL memory-leak']);
  // --jobs 1 used to run in this process, where a hang has no watchdog: now one worker, killed at the case wall limit (--caseWall 4 s) + 3 s
  check('poolHang', '--jobs 1 case that never returns (endless loop in the sim): the worker is killed at the wall limit (the in-process mode hung for ever)', run(['--seedList', '1', '--seconds', '3', '--caseWall', '4', '--jobs', '1'], 'hang'), ['worker-crash']);
  check('poolNoLeak', 'the same 12 runs without the leak: no memory-leak line (a quiet control)', run(['--seeds', '12', '--seconds', '3', '--jobs', '1'], ''), [], ['GLOBAL memory-leak']);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// main

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.worker) {
    workerMain(args);
    return;
  }
  if (args.help || args.h) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).slice(0, 26).map((l) => l.slice(3)).join('\n'));
    return;
  }
  // QA override before anything reads the content (boss spawn table, the plan, the specs); the workers apply the same patch
  const override = applyOverrideArg(args.override);
  const { bossSpawn, manifestSha, note } = readBossSpawn(content);
  if (args.selftest) {
    const z = content.zones[0];
    const cl = content.classes[0];
    if (!z || !cl) throw new Error('content has no zone / class');
    const base = makeSpec(content, settingsFrom({}, content, false), 'selftest', { zone: z.id, classId: cl.id, doctrine: 'a', difficulty: 'normal', seed: 1, bossSpawn });
    const lines = [...runSelftest(content, base), ...(args.noPool ? [] : poolSelftest())];
    let missed = 0;
    for (const l of lines) {
      console.log(`selftest ${l.fault.padEnd(13)} detected: ${l.detected ? 'yes' : 'NO '}  (expected ${l.expected.join('+')}; got ${l.got.join('+') || 'nothing'})  ${l.note}`);
      if (!l.detected) missed++;
    }
    console.log(`selftest: ${lines.length - missed}/${lines.length} faults detected`);
    process.exit(missed > 0 ? 1 : 0);
  }

  const cores = cpus().length;
  const plan = buildPlan(content, args, bossSpawn);
  const jobs = Math.max(1, Math.floor(num(args.jobs, Math.min(6, Math.max(1, cores - 2)))));
  const budgetMs = num(args.budget, 0) * 60000;
  const out = typeof args.json === 'string' ? resolve(args.json) : null;
  const quiet = args.quiet === true;
  if (out) mkdirSync(dirname(out), { recursive: true });
  const jsonl = out ? out.replace(/\.json$/, '') + '.rows.jsonl' : null;
  if (jsonl) writeFileSync(jsonl, '');

  const base0 = cpuSnap();
  const baseLoadStart = Date.now();
  while (Date.now() - baseLoadStart < 1500) {
    /* measure the load the other agents put on the machine before we start */
  }
  const baselineBusy = busyPct(base0, cpuSnap());
  console.log(`soak: ${plan.specs.length} cases, ${jobs} job(s), ${cores} logical cores, baseline cpu busy ${baselineBusy}% (other processes), free mem ${Math.round(freemem() / 1048576)} / ${Math.round(totalmem() / 1048576)} MB`);
  for (const d of plan.description) console.log('  ' + d);
  if (note) console.log('  note: ' + note);
  if (override) console.log(`  content override: ${describeOverride(override)}`);
  const cpuStart = cpuSnap();
  const res = await runPool(plan.specs, { jobs, budgetMs, quiet, jsonl, overrideJson, inProcess: args.inProcess === true || args.noPool === true });
  const cpuEnd = cpuSnap();

  const rows = res.rows.slice().sort((a, b) => plan.specs.findIndex((s) => s.id === a.id) - plan.specs.findIndex((s) => s.id === b.id));
  const mem: MemVerdict[] = res.series.filter((s) => s.heapMB.length > 0).map(analyzeMemory);
  const det = compareDeterminism(rows);
  const agg = aggregate(content, rows, plan.specs.length, res.notRun.length, res.stoppedByBudget);
  // global findings that are not tied to one run
  const global: { kind: string; detail: string }[] = [];
  for (const m of mem) if (m.leak) global.push({ kind: 'memory-leak', detail: `worker ${m.worker}: ${m.note} over ${m.runs} runs` });
  for (const d of det) if (!d.equal) global.push({ kind: 'nondeterministic', detail: `${d.id} vs ${d.twin}: ${d.hashA} != ${d.hashB}${d.firstDivergenceS !== null ? `, first checkpoint divergence at sim ${d.firstDivergenceS} s` : ''}` });
  const missingTwin = rows.filter((r) => r.twinOf && !rows.some((x) => x.id === r.twinOf));
  for (const r of missingTwin) global.push({ kind: 'determinism-unpaired', detail: `${r.id}: its original was not run` });
  // a case that was planned but not run is not a pass: the time budget, or a pool whose workers died, used to report "clean" for it
  if (res.notRun.length > 0) {
    global.push({ kind: 'not-run', detail: `${res.notRun.length} of ${plan.specs.length} planned case(s) were not run (${res.stoppedByBudget ? 'time budget' : 'no live worker left'}); first: ${res.notRun.slice(0, 3).map((s) => s.id).join(', ')}` });
  }
  for (const e of res.poolErrors) global.push({ kind: 'pool-error', detail: e });
  const meta = {
    tool: 'apps/game/src/dev/soak.ts',
    startedAt: new Date(Date.now() - res.wallMs).toISOString(),
    wallSeconds: Math.round(res.wallMs / 1000),
    command: process.argv.slice(2).join(' '),
    jobs,
    cores,
    manifestSha,
    bossSpawn,
    baselineCpuBusyPct: baselineBusy,
    runCpuBusyPct: busyPct(cpuStart, cpuEnd),
    cpuSamples: res.cpuSamples,
    plan: plan.description,
    override: override ? { arg: overrideArg, patch: JSON.parse(overrideJson ?? '{}') as unknown, paths: override.paths, added: override.added, deleted: override.deleted } : null,
    runtime: typeof (globalThis as { Bun?: { version?: string } }).Bun?.version === 'string' ? `bun ${(globalThis as { Bun?: { version?: string } }).Bun?.version}` : `node ${process.version}`,
    note,
  };
  const report = { meta, aggregate: agg, global, memory: mem, determinism: det, rows };
  if (out) {
    writeFileSync(out, JSON.stringify(report, null, 1));
    writeFileSync(out.replace(/\.json$/, '') + '.md', markdown(meta, agg, rows, mem, det));
    console.log(`wrote ${out}`);
  }
  console.log('---- aggregate ----');
  console.log(`runs ${agg.run}/${agg.requested} (not run ${agg.notRun}${agg.stoppedByBudget ? ', time budget hit' : ''}); outcomes ${JSON.stringify(agg.outcomes)}; runs with violations ${agg.violationRuns}`);
  console.log(`tick ms: mean-of-means ${agg.tick.meanOfMeansMs}, worst p99 ${agg.tick.worstP99Ms} (${agg.tick.worstP99Id}), worst max ${agg.tick.worstMaxMs} (${agg.tick.worstMaxId}); max alive ${agg.max.alive}; wall total ${agg.wall.totalRunS} s; cpu busy ${meta.runCpuBusyPct}% (baseline ${baselineBusy}%)`);
  for (const [k, v] of Object.entries(agg.violationsByKind)) console.log(`  ${k}: ${v.runs} run(s), e.g. ${v.exampleId}: ${v.example}`);
  for (const g of global) console.log(`  GLOBAL ${g.kind}: ${g.detail}`);
  const bad = agg.violationRuns > 0 || global.length > 0 || rows.length === 0;
  console.log(bad ? (res.notRun.length > 0 || rows.length === 0 ? 'RESULT: INCOMPLETE or violations found (exit 1)' : 'RESULT: violations found (exit 1)') : 'RESULT: clean');
  process.exit(bad ? 1 : 0);
}

void reproCommand;
main().catch((err) => {
  console.error(err);
  process.exit(2);
});
