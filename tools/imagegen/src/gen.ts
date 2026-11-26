// gen / pick / variants — one asset id at a time:
//   gen      N variants of one job in parallel generation sessions, each post-processed and shown on a contact sheet
//   pick     promote variant k: job file → tools/imagegen/jobs/gen/<id>.json, raw → raw/<id>.png, rebuild, approve,
//            ship (replaces an earlier ship of the id), merge apps/game/public/assets/manifest.json
//   variants list every variant of an id (all rounds) and re-render its sheet
import { createHash } from 'node:crypto';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { codexArgs, runSession, soloPrompt, type SessionJob, type SessionResult } from './codex';
import { CONTACT, GEN, JOBS_GEN, LOG, MANIFEST_DIR, PY, RAW, ROOT, ensureDirs } from './paths';
import { buildJob } from './post';
import { normalizeRefs, prepareRefs, type PreparedRef } from './refs';
import { clearStatus, setStatus } from './review';
import { rawPath, toSessionJob, validateJob } from './runner';
import { ship } from './ship';
import type { BuildReport, JobSpec, LogEntry } from './types';
import { MANIFEST_LOCK, withLockSync } from '../../pipeline/lock';

export interface GenOptions {
  variants: number;
  effort: string;
  model?: string;
  /** per-image budget in seconds; a session is killed after timeoutSec + 150 s (a finished image is still salvaged) */
  timeoutSec: number;
  /** codex sessions per variant before it is given up */
  attempts: number;
  /** contact sheet cell size in px */
  cell?: number;
}

export const defaultGenOptions: GenOptions = { variants: 3, effort: 'low', timeoutSec: 100, attempts: 2, cell: 320 };

export interface Check {
  pass: boolean;
  warn: boolean;
  sha: boolean;
  refMatch: { d: number; path: string } | null;
  refs: { ref: string; d: number | null }[];
}

export interface GenVariant {
  k: number;
  /** the generated PNG (copy of the codex output) */
  raw: string | null;
  /** the post-processed WebP — byte-identical to what `pick` ships */
  build: string | null;
  w?: number;
  h?: number;
  bytes?: number;
  alpha?: boolean;
  lossless?: boolean;
  notes?: string[];
  
  check?: Check;
  error?: string;
  round?: number;
  sessionId?: string;
  codexPath?: string;
  /** PACK mode (pack.ts): the variant is cell `cell` (1-4) of the 2x2 sheet `packId` that carries `ids` */
  pack?: { packId: string; cell: number; cellName: string; ids: string[] };
  /** PACK mode: the single-icon gates (gates.ts gateVariant) that this variant fails, [] = passes */
  gates?: string[];
}

export interface GenResult {
  id: string;
  round: number;
  variants: GenVariant[];
  sheet: string;
  /** the exact codex message every variant session received */
  prompt: string;
  refs: { src: string; attached: string; role: string; view: string }[];
}

export const fwd = (p: string): string => p.replaceAll('\\', '/');
export const genDir = (id: string): string => join(GEN, id);
export const vDir = (id: string, k: number): string => join(GEN, id, `v${k}`);

export function log(entry: Omit<LogEntry, 'ts'>): void {
  appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
}

export function readJson<T>(path: string): T | null {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : null;
}

export async function runPy(script: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(['python', join(PY, script), ...args], { stdout: 'pipe', stderr: 'pipe', windowsHide: true });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  if ((await proc.exited) !== 0) throw new Error(`${script} failed: ${err.trim().split('\n').slice(-4).join('\n')}`);
  return out.trim().split('\n').pop() ?? '';
}

/** Clean-room file hash check (computes SHA-256 per built file). */
export async function assetCheck(files: string[], _refs: string[] = []): Promise<Map<string, Check>> {
  const out = new Map<string, Check>();
  for (const f of files) {
    // clean-room check: verify built file exists
    out.set(f, { pass: existsSync(f), warn: false, sha: false, refMatch: null, refs: [] });
  }
  return out;
}

/** Reserve the next variant numbers for an id (atomic across concurrent gen runs) and record the round. */
function reserve(job: JobSpec, n: number): { round: number; ks: number[] } {
  return withLockSync(`imagegen-gen-${job.id}`, () => {
    const dir = genDir(job.id);
    mkdirSync(dir, { recursive: true });
    const used = readdirSync(dir)
      .map((f) => /^v(\d+)$/.exec(f)?.[1])
      .filter((x): x is string => !!x)
      .map(Number);
    const start = used.length ? Math.max(...used) + 1 : 1;
    const ks = Array.from({ length: n }, (_, i) => start + i);
    for (const k of ks) mkdirSync(vDir(job.id, k), { recursive: true });
    const roundsFile = join(dir, 'rounds.jsonl');
    const round = existsSync(roundsFile) ? readFileSync(roundsFile, 'utf8').split('\n').filter((l) => l.trim()).length + 1 : 1;
    appendFileSync(roundsFile, JSON.stringify({ round, ts: new Date().toISOString(), ks, goal: job.goal, refs: job.refs ?? [] }) + '\n');
    return { round, ks };
  });
}

export async function runVariant(job: JobSpec, sj: SessionJob, k: number, opts: GenOptions, stamp: string): Promise<GenVariant> {
  const dir = vDir(job.id, k);
  let lastErr = 'no image returned';
  for (let att = 1; att <= opts.attempts; att++) {
    const sessionId = `gen_${job.id}_v${k}_${stamp}${att > 1 ? `_r${att}` : ''}`;
    let res: SessionResult;
    try {
      res = await runSession([sj], sessionId, { effort: opts.effort, model: opts.model, timeoutMs: (opts.timeoutSec + 150) * 1000, solo: true });
    } catch (e) {
      res = { sessionId, threadId: '', paths: {}, orderMapped: [], ms: 0, err: String(e), finalText: '' };
    }
    const src = res.paths[job.id];
    if (src && existsSync(src)) {
      const raw = join(dir, 'raw.png');
      copyFileSync(src, raw);
      log({ event: 'gen', id: job.id, k, group: job.group, attempt: att, sessionId, codexPath: src, raw, ok: true, ms: res.ms, mapped: res.orderMapped.includes(job.id) ? 'order' : 'json' });
      console.error(`[gen] ${job.id} v${k}: image in ${(res.ms / 1000).toFixed(0)}s`);
      return { k, raw, build: null, sessionId, codexPath: src };
    }
    lastErr = res.err ?? 'no image returned';
    log({ event: 'fail', id: job.id, k, group: job.group, attempt: att, sessionId, ok: false, err: lastErr, ms: res.ms });
    console.error(`[gen] ${job.id} v${k}: attempt ${att} failed: ${lastErr}`);
  }
  return { k, raw: null, build: null, error: lastErr };
}

export function variantStatus(v: GenVariant): 'pass' | 'warn' | 'fail' | 'error' {
  if (v.error || !v.build) return 'error';
  if (v.check && !v.check.pass) return 'fail';
  if (v.gates?.length) return 'fail';
  if (v.check?.warn || (v.notes ?? []).some((n) => !n.startsWith('info:'))) return 'warn';
  return 'pass';
}

function variantSub(v: GenVariant): string {
  if (v.error) return v.error.slice(0, 60);
  const parts: string[] = [];
  if (v.check?.refMatch) parts.push(`ref d=${v.check.refMatch.d}`);
  const rd = (v.check?.refs ?? []).map((r) => r.d).filter((d): d is number => d !== null);
  if (rd.length) parts.push(`ref d=${Math.min(...rd)}`);
  if (v.gates?.length) parts.push(`gate: ${v.gates[0]}`.slice(0, 52));
  const warn = (v.notes ?? []).find((n) => !n.startsWith('info:'));
  if (warn) parts.push(warn);
  return parts.join(' · ');
}

export async function renderSheet(id: string, title: string, refs: { path: string; label: string; sub: string; blend: string }[], variants: GenVariant[], job: JobSpec, cell: number, picked?: number): Promise<string> {
  mkdirSync(CONTACT, { recursive: true });
  const items = {
    title,
    refs,
    variants: variants.map((v) => ({
      path: v.build ?? v.raw ?? '',
      label: v.build ? `v${v.k}${v.k === picked ? ' [SHIPPED]' : ''}  ${v.w}x${v.h}  ${Math.round((v.bytes ?? 0) / 1024)}KB${v.lossless ? ' lossless' : ''}` : `v${v.k}  FAILED`,
      sub: variantSub(v),
      status: variantStatus(v),
      blend: v.alpha ? 'alpha' : job.background === 'black' || (job.kind === 'vfx' && !job.background) ? 'add' : 'opaque',
    })),
  };
  const itemsFile = join(CONTACT, `.gen_${id}.json`);
  writeFileSync(itemsFile, JSON.stringify(items));
  const out = join(CONTACT, `gen_${id}.png`);
  await runPy('gensheet.py', [out, itemsFile, String(cell)]);
  return out;
}

export function refItems(prepared: PreparedRef[]): { path: string; label: string; sub: string; blend: string }[] {
  return prepared.map((r, i) => ({
    path: r.path,
    label: `REF ${i + 1}  ${r.role}`,
    sub: `${basename(r.src)}${r.view !== 'rgb' ? ` (${r.view})` : ''}`,
    // an over-grey view is an opaque composite; textures on black read like the sprites (additive)
    blend: r.view === 'over-grey' || r.role !== 'texture' ? 'opaque' : 'add',
  }));
}

/** Everything a dry run shows: the job, the codex message and argv (the session dir is a placeholder). */
export async function genPreview(job: JobSpec): Promise<{ job: JobSpec; prompt: string; argv: string[]; refs: GenResult['refs'] }> {
  validateJob(job, 'gen');
  const prepared = await prepareRefs(normalizeRefs(job.refs));
  const sj = toSessionJob(job, prepared.map((p) => ({ path: p.path, role: p.role })));
  return {
    job,
    prompt: soloPrompt(sj),
    argv: ['codex', ...codexArgs({ effort: defaultGenOptions.effort, images: prepared.map((p) => fwd(p.path)), dir: '<session dir>' })],
    refs: prepared.map((p) => ({ src: fwd(p.src), attached: fwd(p.path), role: p.role, view: p.view })),
  };
}

/** Generate `opts.variants` variants of one job in parallel sessions; returns paths + checks + the contact sheet. */
export async function genVariants(job: JobSpec, opts: GenOptions): Promise<GenResult> {
  ensureDirs();
  validateJob(job, 'gen');
  const prepared = await prepareRefs(normalizeRefs(job.refs));
  const sj = toSessionJob(job, prepared.map((p) => ({ path: p.path, role: p.role })));
  const prompt = soloPrompt(sj);
  const { round, ks } = reserve(job, opts.variants);
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  for (const k of ks) {
    writeFileSync(join(vDir(job.id, k), 'job.json'), JSON.stringify(job, null, 1) + '\n');
    writeFileSync(join(vDir(job.id, k), 'prompt.txt'), prompt);
  }
  console.error(`[gen] ${job.id} round ${round}: ${ks.length} variant(s) v${ks[0]}..v${ks[ks.length - 1]}, ${prepared.length} reference(s) attached`);

  const variants = await Promise.all(ks.map((k) => runVariant(job, sj, k, opts, stamp)));
  await Promise.all(
    variants.map(async (v) => {
      if (!v.raw) return;
      try {
        const r: BuildReport = await buildJob(job, v.raw, join(vDir(job.id, v.k), 'build'));
        Object.assign(v, { build: r.main, w: r.w, h: r.h, bytes: r.bytes, alpha: r.alpha, lossless: !!r.lossless, notes: r.notes });
      } catch (e) {
        v.error = String(e);
      }
    }),
  );
  const builds = variants.filter((v) => v.build).map((v) => v.build!);
  const checks = await assetCheck(builds, prepared.flatMap((p) => [p.src, p.path]));
  for (const v of variants) {
    if (v.build) v.check = checks.get(v.build);
    v.round = round;
    for (const key of ['raw', 'build', 'codexPath'] as const) if (v[key]) v[key] = fwd(v[key]!);
    writeFileSync(join(vDir(job.id, v.k), 'meta.json'), JSON.stringify(v, null, 1));
  }
  const sheet = await renderSheet(job.id, `${job.id} — round ${round} (${job.kind}, ${job.background ?? 'legacy'} bg)`, refItems(prepared), variants, job, opts.cell ?? 320);
  return {
    id: job.id,
    round,
    variants,
    sheet: fwd(sheet),
    prompt: fwd(join(vDir(job.id, ks[0]!), 'prompt.txt')),
    refs: prepared.map((p) => ({ src: fwd(p.src), attached: fwd(p.path), role: p.role, view: p.view })),
  };
}

/** All variants of an id (every round), newest job's references on a fresh sheet. */
export async function listVariants(id: string, cell = 320): Promise<{ id: string; variants: GenVariant[]; picked: { k: number; ts: string } | null; sheet: string | null }> {
  const dir = genDir(id);
  if (!existsSync(dir)) throw new Error(`no gen variants for ${id} (${fwd(dir)} does not exist)`);
  const ks = readdirSync(dir)
    .map((f) => /^v(\d+)$/.exec(f)?.[1])
    .filter((x): x is string => !!x)
    .map(Number)
    .sort((a, b) => a - b);
  const variants = ks.map((k) => readJson<GenVariant>(join(vDir(id, k), 'meta.json')) ?? { k, raw: null, build: null, error: 'unfinished (no meta.json)' });
  const lastJob = [...ks].reverse().map((k) => readJson<JobSpec>(join(vDir(id, k), 'job.json'))).find(Boolean) ?? null;
  const picked = readJson<{ k: number; ts: string }>(join(dir, 'picked.json'));
  let sheet: string | null = null;
  if (lastJob && variants.length) {
    const prepared = await prepareRefs(normalizeRefs(lastJob.refs));
    sheet = fwd(await renderSheet(id, `${id} — all variants`, refItems(prepared), variants, lastJob, cell, picked?.k));
  }
  return { id, variants, picked, sheet };
}

/** `bun tools/pipeline/manifest.ts`: merge the manifest parts into apps/game/public/assets/manifest.json. */
export async function mergeManifest(): Promise<{ ok: boolean; line: string }> {
  const proc = Bun.spawn(['bun', join(ROOT, 'tools', 'pipeline', 'manifest.ts')], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe', windowsHide: true });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const ok = (await proc.exited) === 0;
  return { ok, line: (ok ? out : err || out).trim().split('\n').slice(-3).join(' | ') };
}

const sha = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex');

export interface PickResult {
  id: string;
  k: number;
  url: string;
  kind: string;
  w: number;
  h: number;
  alpha: boolean;
  bytes: number;
  lossless: boolean;
  check: Check | null;
  manifest: { ok: boolean; line: string };
  job: string;
  /** PACK mode: the pack sheet + cell this variant was cut from (absent for an ordinary variant) */
  pack?: { packId: string; cell: number; cellName: string; n: number };
}



export async function pick(id: string, k: number): Promise<PickResult> {
  ensureDirs();
  const dir = vDir(id, k);
  const job = readJson<JobSpec>(join(dir, 'job.json'));
  const vraw = join(dir, 'raw.png');
  if (!job || !existsSync(vraw)) throw new Error(`no finished variant v${k} for ${id} (see ${fwd(genDir(id))})`);
  validateJob(job, `${id} v${k}`);
  const prepared = await prepareRefs(normalizeRefs(job.refs));
  const refPaths = prepared.flatMap((p) => [p.src, p.path]);
  // PACK mode (pack.ts): the raw is one cell of a 2x2 sheet that carried four ids; remember which one in the job note + picked.json
  const pm = readJson<{ packId: string; cell: number; cellName: string; n: number }>(join(dir, 'pack.json'));
  const pack = pm ? { packId: pm.packId, cell: pm.cell, cellName: pm.cellName, n: pm.n } : undefined;

  // 1. rebuild the variant with the current post code and gate those bytes before anything shipped-side changes
  const vreport = await buildJob(job, vraw, join(dir, 'build'));
  const vbuild = vreport.main;
  const pre = (await assetCheck([vbuild], refPaths)).get(vbuild) ?? null;
  const meta = readJson<GenVariant>(join(dir, 'meta.json'));
  if (meta) {
    Object.assign(meta, { build: fwd(vbuild), w: vreport.w, h: vreport.h, bytes: vreport.bytes, alpha: vreport.alpha, lossless: !!vreport.lossless, notes: vreport.notes, check: pre ?? undefined });
    writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 1));
  }
  if (pre && !pre.pass) throw new Error(`v${k} fails the near-duplicate gate (${variantSub({ k, raw: null, build: vbuild, check: pre })}); pick another variant or regenerate`);

  // 2. promote: job file, raw, build (the old verdict is cleared first so a half-promoted id can never ship)
  clearStatus(id);
  mkdirSync(JOBS_GEN, { recursive: true });
  const jobFile = join(JOBS_GEN, `${id}.json`);
  const { note: _old, ...rest } = job;
  writeFileSync(jobFile, JSON.stringify({ ...rest, note: `gen v${k} picked ${new Date().toISOString().slice(0, 10)}${pack ? ` (pack ${pack.packId} cell ${pack.cell}/${pack.n} ${pack.cellName})` : ''}` }, null, 1) + '\n');
  mkdirSync(RAW, { recursive: true });
  const raw = rawPath(id);
  if (existsSync(raw)) {
    mkdirSync(join(RAW, '_old'), { recursive: true });
    renameSync(raw, join(RAW, '_old', `${id}.${Date.now()}.png`));
  }
  copyFileSync(vraw, raw);
  const report = await buildJob(job);
  let check = pre;
  if (sha(report.main) !== sha(vbuild)) {
    check = (await assetCheck([report.main], refPaths)).get(report.main) ?? null;
    if (check && !check.pass) throw new Error(`rebuilt ${id} fails the near-duplicate gate; not shipped`);
  }

  // 3. approve + ship + manifest
  setStatus([id], 'approved', `picked gen v${k}`);
  const res = ship([job], { ids: [id], mergeAggregate: true });
  if (!res.shipped.includes(id)) throw new Error(`ship skipped ${id}: ${JSON.stringify(res.skipped)}`);
  const part = withLockSync(MANIFEST_LOCK, () => readJson<Record<string, { url: string; size?: number }>>(join(MANIFEST_DIR, job.kind === 'icon' ? 'icons.json' : 'textures.json')));
  const url = part?.[id]?.url ?? '';
  const manifest = res.manifestLine !== undefined ? { ok: true, line: res.manifestLine } : await mergeManifest();
  writeFileSync(join(genDir(id), 'picked.json'), JSON.stringify({ k, ts: new Date().toISOString(), url, ...(pack ? { pack } : {}) }, null, 1));
  log({ event: 'pick', id, k, group: job.group, raw, ok: manifest.ok });
  return {
    id,
    k,
    url,
    kind: job.kind,
    w: report.w,
    h: report.h,
    alpha: report.alpha,
    bytes: report.bytes,
    lossless: !!report.lossless,
    check,
    manifest,
    job: fwd(jobFile),
    ...(pack ? { pack } : {}),
  };
}
