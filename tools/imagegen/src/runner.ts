// Batch runner: jobs → codex sessions (several image_gen calls each), N sessions in parallel, retries, resumable.
// Jobs with reference images (or a real-alpha background) run alone in their session with the refs attached.
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { runSession, sessionPrompt, type SessionJob } from './codex';
import { JOBS_DIR, JOBS_GEN, LOG, PROMPTS, RAW, RESEARCH, ensureDirs } from './paths';
import { composePrompt, needsSoloSession } from './prompt';
import { normalizeRefs, prepareRefs } from './refs';
import { clearStatus } from './review';
import type { JobSpec, LogEntry } from './types';

export interface RunOptions {
  concurrency: number;
  batchSize: number;
  maxAttempts: number;
  effort: string;
  /** per-image time budget; a session is killed after jobTimeoutSec × jobs + 150 s and its finished images are salvaged */
  jobTimeoutSec: number;
  /** regenerate even when a raw already exists (old raw is moved to raw/_old) */
  force: boolean;
  limit?: number;
  dryRun: boolean;
}

export const defaultRunOptions: RunOptions = {
  concurrency: 3,
  batchSize: 4,
  maxAttempts: 3,
  effort: 'low',
  jobTimeoutSec: 100,
  force: false,
  dryRun: false,
};

const ID_RE = /^[a-z0-9_]+$/;

export function loadJobFile(path: string): JobSpec[] {
  const text = readFileSync(path, 'utf8');
  const parsed: unknown = path.endsWith('.jsonl')
    ? text
        .split(/\r?\n/)
        .filter((l) => l.trim() && !l.trim().startsWith('//'))
        .map((l) => JSON.parse(l) as unknown)
    : JSON.parse(text);
  const jobs = (Array.isArray(parsed) ? parsed : [parsed]) as JobSpec[];
  for (const j of jobs) validateJob(j, path);
  return jobs;
}

const KINDS = new Set(['terrain', 'foliage', 'bark', 'rock', 'vfx', 'rune', 'ui', 'portrait', 'illustration', 'icon']);
const BACKGROUNDS = new Set(['black', 'transparent', 'opaque']);

export function validateJob(j: JobSpec, where: string): void {
  if (!j.id || !ID_RE.test(j.id)) throw new Error(`${where}: bad job id "${j.id}" (lowercase snake_case)`);
  if (!j.group || !j.kind || !(j.prompt || j.goal) || !j.size || !Array.isArray(j.post)) {
    throw new Error(`${where}: job ${j.id} missing group/kind/prompt|goal/size/post`);
  }
  if (!KINDS.has(j.kind)) throw new Error(`${where}: job ${j.id} has unknown kind "${j.kind}"`);
  if (j.background !== undefined && !BACKGROUNDS.has(j.background)) throw new Error(`${where}: job ${j.id} background must be black|transparent|opaque`);
  if (j.background && j.transparent) throw new Error(`${where}: job ${j.id} sets both background and transparent (pick one)`);
  if (j.refs !== undefined) {
    if (!Array.isArray(j.refs)) throw new Error(`${where}: job ${j.id} refs must be an array`);
    for (const r of j.refs) {
      const p = typeof r === 'string' ? r : r?.path;
      if (typeof p !== 'string' || !p.trim()) throw new Error(`${where}: job ${j.id} has a reference without a path`);
    }
    if (j.refs.length && j.compose) throw new Error(`${where}: job ${j.id} cannot combine refs with compose`);
  }
}

/** Every job file: tools/imagegen/jobs/*.jsonl|json (sorted), then the per-id files `pick` promotes to jobs/gen/. */
export function jobFiles(): string[] {
  const top = readdirSync(JOBS_DIR)
    .filter((f) => f.endsWith('.jsonl') || f.endsWith('.json'))
    .sort()
    .map((f) => join(JOBS_DIR, f));
  const gen = existsSync(JOBS_GEN)
    ? readdirSync(JOBS_GEN)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .map((f) => join(JOBS_GEN, f))
    : [];
  return [...top, ...gen];
}

/** Load every job file (or the given paths), de-duplicated by id (later files win, so a picked gen job replaces
 *  an older definition of the same id). */
export function loadAllJobs(paths?: string[]): JobSpec[] {
  const files = paths?.length ? paths : jobFiles();
  const byId = new Map<string, JobSpec>();
  for (const f of files) for (const j of loadJobFile(f)) byId.set(j.id, j);
  return [...byId.values()];
}

export function rawPath(id: string): string {
  return join(RAW, `${id}.png`);
}

function log(entry: Omit<LogEntry, 'ts'>): void {
  appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
}

function chunk<T>(items: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

/** Session plan: jobs that attach references or need a real alpha channel get one session each, the rest share
 *  sessions of `batchSize`. */
export function planBatches(jobs: JobSpec[], batchSize: number): JobSpec[][] {
  const solo = jobs.filter((j) => needsSoloSession(j));
  const rest = jobs.filter((j) => !needsSoloSession(j));
  return [...solo.map((j) => [j]), ...chunk(rest, Math.max(1, batchSize))];
}

/** Session job for a spec: its composed prompt plus the prepared reference images (Image 1..n order). */
export function toSessionJob(job: JobSpec, refs: SessionJob['refs'] = []): SessionJob {
  const sj: SessionJob = { id: job.id, prompt: composePrompt(job) };
  if (refs?.length) sj.refs = refs;
  if (job.background === 'transparent') sj.transparent = true;
  return sj;
}

/** Prepare the references of many jobs with one refs.py call; returns id → attachable refs. */
export async function prepareJobRefs(jobs: JobSpec[]): Promise<Map<string, SessionJob['refs']>> {
  const owners: string[] = [];
  const all = jobs.flatMap((j) => normalizeRefs(j.refs).map((r) => (owners.push(j.id), r)));
  const prepared = await prepareRefs(all);
  const out = new Map<string, SessionJob['refs']>();
  prepared.forEach((p, i) => out.set(owners[i]!, [...(out.get(owners[i]!) ?? []), { path: p.path, role: p.role }]));
  return out;
}

export interface RunSummary {
  requested: number;
  ok: number;
  failed: string[];
  wallMs: number;
  imagesPerHour: number;
  sessions: number;
  concurrency: number;
}

export async function runJobs(jobs: JobSpec[], opts: RunOptions): Promise<RunSummary> {
  for (const [k, v] of [
    ['concurrency', opts.concurrency],
    ['batchSize', opts.batchSize],
    ['maxAttempts', opts.maxAttempts],
    ['jobTimeoutSec', opts.jobTimeoutSec],
  ] as const) {
    if (!Number.isFinite(v) || !Number.isInteger(v) || v <= 0) {
      throw new Error(`${k} must be a positive integer, got ${v}`);
    }
  }
  if (opts.limit !== undefined && (!Number.isFinite(opts.limit) || !Number.isInteger(opts.limit) || opts.limit <= 0)) {
    throw new Error(`limit must be a positive integer, got ${opts.limit}`);
  }
  ensureDirs();
  let todo = jobs.filter((j) => !j.compose && (opts.force || !existsSync(rawPath(j.id))));
  if (opts.limit) todo = todo.slice(0, opts.limit);
  const t0 = Date.now();
  const summary: RunSummary = { requested: todo.length, ok: 0, failed: [], wallMs: 0, imagesPerHour: 0, sessions: 0, concurrency: opts.concurrency };
  if (todo.length === 0 || opts.dryRun) {
    console.log(`[run] ${todo.length} job(s) to generate${opts.dryRun ? ' (dry run)' : ''}: ${todo.map((j) => j.id).join(', ')}`);
    return summary;
  }

  const attempts = new Map<string, number>();
  const prompts = new Map<string, string>();
  const sessionJobsById = new Map<string, SessionJob>();
  const refsById = await prepareJobRefs(todo.filter((j) => j.refs?.length));
  for (const j of todo) {
    const sj = toSessionJob(j, refsById.get(j.id));
    sessionJobsById.set(j.id, sj);
    // solo jobs log the whole session message (attached-image roles included); batch jobs their image prompt
    const text = needsSoloSession(j) ? sessionPrompt([sj]) : sj.prompt;
    prompts.set(j.id, text);
    writeFileSync(join(PROMPTS, `${j.id}.txt`), text);
  }
  const queue: JobSpec[][] = planBatches(todo, opts.batchSize);
  let sessionCounter = 0;
  const runStamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);

  const worker = async (wid: number): Promise<void> => {
    for (;;) {
      const batch = queue.shift();
      if (!batch) return;
      const sessionId = `${runStamp}_w${wid}_s${++sessionCounter}`;
      const sessionJobs: SessionJob[] = batch.map((j) => sessionJobsById.get(j.id)!);
      const timeoutMs = (opts.jobTimeoutSec * batch.length + 150) * 1000;
      console.log(`[w${wid}] ${sessionId}: ${batch.map((j) => j.id).join(', ')}`);
      let res;
      try {
        res = await runSession(sessionJobs, sessionId, { effort: opts.effort, timeoutMs });
      } catch (e) {
        res = { sessionId, threadId: '', paths: {} as Record<string, string>, orderMapped: [] as string[], ms: 0, err: String(e), finalText: '' };
      }
      summary.sessions++;
      const got: string[] = [];
      const retry: JobSpec[] = [];
      for (const j of batch) {
        const att = (attempts.get(j.id) ?? 0) + 1;
        attempts.set(j.id, att);
        const src = res.paths[j.id];
        if (src && existsSync(src)) {
          mkdirSync(RAW, { recursive: true });
          const dst = rawPath(j.id);
          if (existsSync(dst)) {
            const old = join(RAW, '_old');
            mkdirSync(old, { recursive: true });
            renameSync(dst, join(old, `${j.id}.${Date.now()}.png`));
          }
          copyFileSync(src, dst);
          clearStatus(j.id);
          got.push(j.id);
          summary.ok++;
          log({ event: 'job', id: j.id, group: j.group, attempt: att, sessionId, prompt: prompts.get(j.id), codexPath: src, raw: dst, ok: true, ms: res.ms, mapped: res.orderMapped.includes(j.id) ? 'order' : 'json' });
          console.log(`[w${wid}]   ok  ${j.id} <- ${basename(src)}`);
        } else if (att < opts.maxAttempts) {
          retry.push(j);
          log({ event: 'fail', id: j.id, group: j.group, attempt: att, sessionId, ok: false, err: res.err ?? 'no image returned', ms: res.ms });
          console.log(`[w${wid}]   FAIL ${j.id} (attempt ${att}) ${res.err ?? 'no image returned'} -> retry`);
        } else {
          summary.failed.push(j.id);
          log({ event: 'fail', id: j.id, group: j.group, attempt: att, sessionId, ok: false, err: res.err ?? 'no image returned', ms: res.ms });
          console.log(`[w${wid}]   GAVE UP ${j.id}`);
        }
      }
      log({ event: 'session', sessionId, ok: got.length === batch.length, ms: res.ms, jobs: batch.map((j) => j.id), got, concurrency: opts.concurrency, err: res.err });
      if (retry.length) queue.push(retry); // smaller batch back on the queue
    }
  };

  await Promise.all(Array.from({ length: opts.concurrency }, (_, i) => worker(i + 1)));
  summary.wallMs = Date.now() - t0;
  summary.imagesPerHour = Math.round((summary.ok / (summary.wallMs / 3_600_000)) * 10) / 10;
  appendFileSync(join(RESEARCH, 'runs.jsonl'), JSON.stringify({ ts: new Date().toISOString(), ...summary, batchSize: opts.batchSize, effort: opts.effort }) + '\n');
  console.log(`[run] ${summary.ok}/${summary.requested} ok in ${(summary.wallMs / 1000).toFixed(0)}s => ${summary.imagesPerHour} images/hour @ concurrency ${opts.concurrency}, batch ${opts.batchSize}`);
  if (summary.failed.length) console.log(`[run] failed: ${summary.failed.join(', ')}`);
  return summary;
}
