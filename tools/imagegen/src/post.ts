// Drives py/post.py for each job: raw/<id>.png → build/<id>/ (webp, normal, tilecheck, report).
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUILD, PY } from './paths';
import { rawPath } from './runner';
import type { BuildReport, JobSpec } from './types';

export function buildDir(id: string): string {
  return join(BUILD, id);
}

export function readReport(id: string): BuildReport | null {
  const p = join(buildDir(id), `${id}.json`);
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as BuildReport) : null;
}

/** A job can be built when its raw (or, for compose jobs, every part raw) exists; partOnly jobs are never built. */
export function rawReady(job: JobSpec): boolean {
  if (job.partOnly) return false;
  return job.compose ? job.compose.parts.every((p) => existsSync(rawPath(p))) : existsSync(rawPath(job.id));
}

async function composeRaw(job: JobSpec, out: string): Promise<void> {
  const c = job.compose!;
  const proc = Bun.spawn(['python', join(PY, 'compose.py'), out, String(c.cols), String(c.rows), String(c.cell), ...c.parts.map(rawPath)], { stdout: 'pipe', stderr: 'pipe', windowsHide: true });
  const err = await new Response(proc.stderr).text();
  if ((await proc.exited) !== 0) throw new Error(`compose.py failed for ${job.id}: ${err.trim()}`);
}

/** Post-process one job: raw (default raw/<id>.png) → outDir (default build/<id>/, wiped first). */
export async function buildJob(job: JobSpec, rawOverride?: string, outDir?: string): Promise<BuildReport> {
  if (!rawOverride && !rawReady(job)) throw new Error(`no raw for ${job.id}`);
  const dir = outDir ?? buildDir(job.id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  let raw = rawOverride ?? rawPath(job.id);
  if (job.compose) {
    raw = join(dir, 'composed.png');
    await composeRaw(job, raw);
  }
  const jobFile = join(dir, 'job.json');
  writeFileSync(jobFile, JSON.stringify(job, null, 1));
  const proc = Bun.spawn(['python', join(PY, 'post.py'), jobFile, raw, dir], { stdout: 'pipe', stderr: 'pipe', windowsHide: true });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  if (code !== 0) throw new Error(`post.py failed for ${job.id}: ${err.trim().split('\n').slice(-6).join('\n')}`);
  return JSON.parse(out.trim().split('\n').pop()!) as BuildReport;
}

/** Build many jobs with bounded parallelism; returns reports (null on failure, error printed). */
export async function buildMany(jobs: JobSpec[], parallel = 4): Promise<Map<string, BuildReport | null>> {
  if (!Number.isFinite(parallel) || !Number.isInteger(parallel) || parallel <= 0) {
    throw new Error(`parallel must be a positive integer, got ${parallel}`);
  }
  const results = new Map<string, BuildReport | null>();
  const queue = [...jobs];
  const worker = async (): Promise<void> => {
    for (let j = queue.shift(); j; j = queue.shift()) {
      try {
        const r = await buildJob(j);
        results.set(j.id, r);
        const t = r.tile ? ` seam ${r.tile.before.h}/${r.tile.before.v} → ${r.tile.final?.h}/${r.tile.final?.v}` : '';
        console.log(`[build] ${j.id}: ${r.w}x${r.h}${r.alpha ? ' RGBA' : ''} ${(r.bytes / 1024).toFixed(0)}KB${t}${r.notes.some((n) => !n.startsWith('info:')) ? ' !! ' + r.notes.filter((n) => !n.startsWith('info:')).join('; ') : ''}`);
      } catch (e) {
        results.set(j.id, null);
        console.error(`[build] ${j.id} FAILED: ${String(e)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: parallel }, worker));
  return results;
}
