// Shared plumbing of the playthrough modes: argument parsing, snapshot selection, server + lane setup, machine load, the leak verdict,
// seeded saves, and the summary writer.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { checksum } from '../../../apps/game/src/meta/errors';
import { content as gameContent } from '../../../apps/game/src/data/loader';
import { newProfile } from '../../../apps/game/src/meta/save';
import { allocateTalent, xpForPoints } from '../../../apps/game/src/meta/talents';
import { Lane, DEFAULT_THRESHOLDS, type LaneOpts, type MenuMemory, type Thresholds, type Violation } from './lane';
import { serveDist, type DistServer } from './server';
import { latestSnapshot, QA_ROOT, takeSnapshot, type SnapshotInfo } from './snapshot';

export class Args {
  readonly mode: string;
  private readonly m = new Map<string, string>();
  constructor(argv: string[]) {
    this.mode = argv[0] ?? 'help';
    for (let i = 1; i < argv.length; i++) {
      const a = argv[i] ?? '';
      if (!a.startsWith('--')) continue;
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) this.m.set(a.slice(2), '1');
      else {
        this.m.set(a.slice(2), next);
        i++;
      }
    }
  }
  has(k: string): boolean {
    return this.m.has(k);
  }
  str(k: string, d: string): string {
    return this.m.get(k) ?? d;
  }
  num(k: string, d: number): number {
    const v = this.m.get(k);
    return v === undefined ? d : Number(v);
  }
  flag(k: string, d: boolean): boolean {
    const v = this.m.get(k);
    return v === undefined ? d : v !== '0' && v !== 'false';
  }
  list(k: string): string[] {
    return (this.m.get(k) ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  }
}

export const stampNow = (): string => {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

export function outDirFor(a: Args, mode: string): string {
  const out = a.has('out') ? resolve(a.str('out', '')) : join(QA_ROOT, 'play', `${mode}-${stampNow()}`);
  mkdirSync(out, { recursive: true });
  return out;
}

/** --snap <folder with snapshot.json> | the newest one | a fresh one when none exists (or --newSnap) */
export async function pickSnapshot(a: Args): Promise<SnapshotInfo> {
  if (a.has('snap')) {
    const dir = resolve(a.str('snap', ''));
    const f = join(dir, 'snapshot.json');
    if (!existsSync(f)) throw new Error(`--snap ${dir}: no snapshot.json`);
    return JSON.parse(await Bun.file(f).text()) as SnapshotInfo;
  }
  const last = a.flag('newSnap', false) ? null : latestSnapshot();
  if (last && existsSync(join(last.distQa, 'index.html')) && existsSync(join(last.distProd, 'index.html'))) return last;
  console.log('[snapshot] taking a new snapshot (no usable one)');
  const info = await takeSnapshot();
  if (!info.ok) throw new Error(`snapshot problems: ${info.problems.join('; ')}`);
  return info;
}

export function thresholdsFrom(a: Args): Thresholds {
  return {
    loadingStuckS: a.num('loadingStuckS', DEFAULT_THRESHOLDS.loadingStuckS),
    screenStuckS: a.num('screenStuckS', DEFAULT_THRESHOLDS.screenStuckS),
    modalStuckS: a.num('modalStuckS', DEFAULT_THRESHOLDS.modalStuckS),
    clockStallS: a.num('clockStallS', DEFAULT_THRESHOLDS.clockStallS),
    runEndFlowS: a.num('runEndFlowS', DEFAULT_THRESHOLDS.runEndFlowS),
    stuckSimS: a.num('stuckSimS', DEFAULT_THRESHOLDS.stuckSimS),
    unresponsiveS: a.num('unresponsiveS', DEFAULT_THRESHOLDS.unresponsiveS),
  };
}

export interface View {
  w: number;
  h: number;
  dpr: number;
  touch: boolean;
}
export function viewFrom(a: Args): View {
  if (a.str('viewport', '') === 'phone') return { w: a.num('w', 390), h: a.num('h', 844), dpr: a.num('dpr', 2), touch: true };
  return { w: a.num('w', 1280), h: a.num('h', 720), dpr: a.num('dpr', 1), touch: a.flag('touch', false) };
}

export interface Rig {
  server: DistServer;
  mk(name: string, extra?: Partial<LaneOpts>): Promise<Lane>;
  stop(): Promise<void>;
}

/** serves one dist and opens lanes on it; stop() frees the port */
export async function makeRig(a: Args, dist: string, out: string, hook: boolean): Promise<Rig> {
  const api = a.has('api') ? a.str('api', '') : undefined;
  const server = await serveDist(dist, api ? { api } : {});
  console.log(`[serve] ${dist} on ${server.origin} (API ${api ?? 'offline 503'})`);
  const v = viewFrom(a);
  const lanes: Lane[] = [];
  return {
    server,
    async mk(name, extra = {}) {
      const lane = await Lane.open({
        name,
        out: join(out, name),
        origin: server.origin,
        apiOffline: !api,
        width: v.w,
        height: v.h,
        dpr: v.dpr,
        touch: v.touch,
        quality: a.str('quality', 'high'),
        lang: a.str('lang', 'en'),
        thresholds: thresholdsFrom(a),
        headful: a.flag('headful', false),
        hook,
        ...extra,
      });
      lanes.push(lane);
      return lane;
    },
    async stop() {
      for (const l of lanes) await l.close().catch(() => undefined);
      await server.stop().catch(() => undefined);
    },
  };
}

// ------------------------------------------------------------------------------------------------------------------ machine load
/** CPU % over a 1 s sample (Get-Counter); null when it cannot be read */
export async function cpuLoad(): Promise<number | null> {
  try {
    const p = Bun.spawn(
      ['powershell', '-NoProfile', '-Command', "(Get-Counter '\\Processor(_Total)\\% Processor Time' -SampleInterval 1 -MaxSamples 2).CounterSamples | Select-Object -ExpandProperty CookedValue | Measure-Object -Average | Select-Object -ExpandProperty Average"],
      { stdout: 'pipe', stderr: 'ignore' },
    );
    const t = (await new Response(p.stdout).text()).trim().replace(',', '.');
    const n = Number(t);
    return Number.isFinite(n) ? +n.toFixed(1) : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------------------------------------------------------------- leaks
export interface LeakVerdict {
  verdict: 'ok' | 'leak' | 'insufficient';
  reasons: string[];
  series: { label: string; mem: MenuMemory }[];
  rule: string;
}

/**
 * Growth across runs of DIFFERENT content (campaign / matrix: every run another zone, class or doctrine), read on the menu after each run.
 * The menu's renderer counts follow the content of the run before (2026-10-27 campaign: textures 111 -> 68 -> 97 -> 123 after warrior /
 * ninja 9 s / yacha 60 s / warrior-b: content, not a leak), so only growth that never goes down counts, and only big growth: this rule finds a
 * gross leak; small per-run leaks are the job of `repeatLeakVerdict` on identical runs (the leak probe). Series [run1, run2, ..., runN],
 * run 1 only warms the caches; with N >= 4 (3 samples after it) it flags
 *   heap (after gc)  last - run2 > max(30 MB, 40 %)  growing on >= 2 steps
 *   textures / geometries  last > run2 + max(40, 35 %), never shrinking over the WHOLE series (run 1 included: a drop anywhere says the
 *                          counts follow content), growing on >= 2 steps
 *   programs  last > run2 + 8, never shrinking over the whole series      DOM nodes  last > run2 + 400, growing on >= 2 steps
 */
export function leakVerdict(series: { label: string; mem: MenuMemory }[]): LeakVerdict {
  const rule = 'mixed content, samples after run 1: heap +30 MB & +40 %; textures / geometries +40 & +35 %, never shrinking over the whole series; programs +8, never shrinking; DOM +400 (growth on >= 2 steps)';
  const post = series.slice(1);
  if (post.length < 3) return { verdict: 'insufficient', reasons: [`only ${post.length} menu sample(s) after run 1 (need 3)`], series, rule };
  const first = post[0]!.mem;
  const last = post[post.length - 1]!.mem;
  const reasons: string[] = [];
  const steps = (k: keyof MenuMemory): number => {
    let up = 0;
    for (let i = 1; i < post.length; i++) if ((post[i]!.mem[k] as number) > (post[i - 1]!.mem[k] as number)) up++;
    return up;
  };
  const shrinks = (k: keyof MenuMemory): boolean => series.some((s, i) => i > 0 && (s.mem[k] as number) < (series[i - 1]!.mem[k] as number));
  if (first.gc && last.gc && first.heapMB > 0 && last.heapMB - first.heapMB > Math.max(30, 0.4 * first.heapMB) && steps('heapMB') >= 2) reasons.push(`JS heap after gc ${first.heapMB} -> ${last.heapMB} MB over ${post.length} runs`);
  for (const k of ['textures', 'geometries'] as const) {
    if (first[k] >= 0 && last[k] > first[k] + Math.max(40, 0.35 * first[k]) && !shrinks(k) && steps(k) >= 2) reasons.push(`renderer.info.memory.${k} ${first[k]} -> ${last[k]}`);
  }
  if (first.programs >= 0 && last.programs > first.programs + 8 && !shrinks('programs')) reasons.push(`programs ${first.programs} -> ${last.programs}`);
  if (last.dom > first.dom + 400 && steps('dom') >= 2) reasons.push(`DOM nodes ${first.dom} -> ${last.dom}`);
  return { verdict: reasons.length ? 'leak' : 'ok', reasons, series, rule };
}

/**
 * Growth across IDENTICAL runs (the leak probe: same zone / class / doctrine, a short run abandoned at the same sim second before the first
 * level-up, no card taken): the content is the same every time, so the menu's counts must not move. Series [warm, r1, r2, ...] (the first
 * sample is the reference), at least 3 samples (2 steps). Flags
 *   textures / geometries / programs: never shrinking and (+2 or more overall, or +1 on every step)  ->  one texture per run is found
 *   heap after gc: growing on every step and + max(8 MB, 8 %) overall        DOM nodes: growing on every step and +50 overall
 */
export function repeatLeakVerdict(series: { label: string; mem: MenuMemory }[]): LeakVerdict {
  const rule = 'identical runs: textures / geometries / programs never shrinking and (+2 overall or +1 every step); heap growing every step and +8 MB & +8 %; DOM growing every step and +50';
  if (series.length < 3) return { verdict: 'insufficient', reasons: [`only ${series.length} sample(s) of identical runs (need 3)`], series, rule };
  const first = series[0]!.mem;
  const last = series[series.length - 1]!.mem;
  const diffs = (k: keyof MenuMemory): number[] => series.slice(1).map((s, i) => (s.mem[k] as number) - (series[i]!.mem[k] as number));
  const reasons: string[] = [];
  for (const k of ['textures', 'geometries', 'programs'] as const) {
    const d = diffs(k);
    if (first[k] < 0) continue;
    const never = d.every((x) => x >= 0);
    if (never && (last[k] - first[k] >= 2 || d.every((x) => x >= 1))) reasons.push(`${k} ${series.map((s) => s.mem[k]).join(' -> ')} over ${series.length} identical runs`);
  }
  const dh = diffs('heapMB');
  if (first.gc && last.gc && dh.every((x) => x > 0) && last.heapMB - first.heapMB > Math.max(8, 0.08 * first.heapMB)) reasons.push(`JS heap after gc ${series.map((s) => s.mem.heapMB).join(' -> ')} MB over ${series.length} identical runs`);
  const dd = diffs('dom');
  if (dd.every((x) => x > 0) && last.dom - first.dom > 50) reasons.push(`DOM nodes ${series.map((s) => s.mem.dom).join(' -> ')}`);
  return { verdict: reasons.length ? 'leak' : 'ok', reasons, series, rule };
}

// --------------------------------------------------------------------------------------------------------------------- seeded save
/** the IndexedDB `save.main` record (meta/storage.ts envelope) of a profile with these zones (and their hard modes) unlocked */
export function seedRecord(zones: readonly string[], hard: readonly string[], now = Date.now()): string {
  const save = {
    version: 1,
    profile: { id: 'qa-play-seed-0001', name: 'PlayQA', created: now, updated: now },
    unlocks: { zones: [...zones], hard: [...hard], codex: [] },
  };
  const d = JSON.stringify(save);
  return JSON.stringify({ f: 1, t: now, c: checksum(d), d });
}

/**
 * A VETERAN profile (smoke --vet): the zones (+ hard) given, every class with 40 talent points earned and spent through the game's own `allocateTalent`
 * (both doctrine trees, row gates respected), so a real-input hero with no god mode can live through a 180 s smoke in the later zones.
 * Built with the real `newProfile`, so every field is the game's own shape; the record format is the same as `seedRecord`.
 */
export function seedRecordVet(zones: readonly string[], hard: readonly string[], now = Date.now()): string {
  let save = newProfile(gameContent, { now, name: 'PlayQA' });
  save.profile.id = 'qa-play-seed-vet';
  save.unlocks.zones = [...zones];
  save.unlocks.hard = [...hard];
  for (const classId of Object.keys(save.classes) as (keyof typeof save.classes)[]) {
    save.classes[classId].xp = xpForPoints(40);
    for (let guard = 0; guard < 200; guard++) {
      let progressed = false;
      for (const key of ['a', 'b'] as const) {
        const tree = gameContent.talents.find((t) => t.classId === classId && t.id.endsWith(`_${key}`));
        if (!tree) continue;
        for (const node of [...tree.nodes].sort((x, y) => x.row - y.row || x.col - y.col)) {
          const r = allocateTalent(save, gameContent, classId, key, node.id);
          if (r.ok) {
            save = r.save;
            progressed = true;
            break;
          }
        }
      }
      if (!progressed) break;
    }
  }
  const d = JSON.stringify(save);
  return JSON.stringify({ f: 1, t: now, c: checksum(d), d });
}

// ----------------------------------------------------------------------------------------------------------------------- summary
export interface Summary {
  mode: string;
  args: string[];
  snapshot: { stamp: string; out: string; manifestSha256: string; gitStatusLines: number } | null;
  startedAt: string;
  wallS: number;
  cpuLoadStart: number | null;
  cpuLoadEnd: number | null;
  viewport: View;
  api: string;
  runs: unknown[];
  violations: Violation[];
  consoleSummary: unknown[];
  requests: unknown;
  fallbacks: string[];
  notes: string[];
  leak?: LeakVerdict;
  extra?: Record<string, unknown>;
  ok: boolean;
  exitCode: number;
}

export function writeSummary(out: string, s: Summary, name = 'summary.json'): string {
  const p = join(out, name);
  writeFileSync(p, JSON.stringify(s, null, 2));
  return p;
}

export const REAL = (v: Violation): boolean => v.severity !== 'info';
