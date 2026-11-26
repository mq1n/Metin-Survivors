// One `codex exec` session = one batch of image_gen calls (one call per asset), or one solo call with attached
// reference images (`-i`, Image 1..n). We never let codex touch the filesystem: it only prints the generated paths;
// we copy the files.
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CODEX_IMAGES, SCRATCH } from './paths';
import { refRoleSentence } from './prompt';
import { acquireSlot } from '../../qa/slots';
import { CodexPausedError, checkPaused, isLimitMessage, notePause } from './codexPause';
import { geminiUsable, runGeminiSession } from './gemini';

/** codex unless MS_IMAGE_ENGINE=gemini, or codex is paused by a usage limit and a Gemini key exists (automatic fallback). */
function pausedOrGemini(): boolean {
  if (process.env.MS_IMAGE_ENGINE === 'gemini') return true;
  try {
    checkPaused();
    return false;
  } catch (e) {
    if (e instanceof CodexPausedError && process.env.MS_IMAGE_ENGINE !== 'codex' && geminiUsable()) return true;
    throw e;
  }
}

/** A reference image ready to attach: `path` is the prepared PNG (see refs.ts), `role` a role name or sentence. */
export interface AttachedRef {
  path: string;
  role?: string;
}

export interface SessionJob {
  id: string;
  /** the composed image prompt (composePrompt) */
  prompt: string;
  /** attached reference images, in Image 1..n order (solo sessions only) */
  refs?: AttachedRef[];
  /** ask image_gen for a real alpha channel (solo sessions only) */
  transparent?: boolean;
}

export interface SessionOptions {
  effort: string;
  timeoutMs: number;
  model?: string;
  /** use the solo message for a single job even without refs (gen variants); `run` keeps the batch form */
  solo?: boolean;
}

/** argv after `codex` for one session. Every image gets its own `-i` (the flag takes several values, so `-C` must
 *  follow the images to end the list); the prompt comes from stdin (`-`). */
export function codexArgs(o: { effort: string; model?: string; images?: string[]; dir: string }): string[] {
  const args = ['exec', '-s', 'read-only', '--skip-git-repo-check', '--json', '-c', `model_reasoning_effort=${o.effort}`];
  if (o.model) args.push('-m', o.model);
  for (const img of o.images ?? []) args.push('-i', img);
  args.push('-C', o.dir, '-');
  return args;
}

/** The full message for a solo session (one image_gen call, optional attached references). */
export function soloPrompt(job: SessionJob): string {
  const lines = [
    `Use the $imagegen skill (built-in image_gen tool). Call image_gen EXACTLY ONCE${job.transparent ? ' and request a transparent background from the tool (real alpha channel)' : ''}.`,
    'Do not run shell commands, do not read, write, copy or move files, do not ask questions.',
    '',
  ];
  if (job.refs?.length) {
    lines.push('Attached images:');
    job.refs.forEach((r, i) => lines.push(`- Image ${i + 1} = ${refRoleSentence(r.role)}.`));
    lines.push('');
  }
  lines.push(job.prompt.trim(), '');
  lines.push(`After the call reply with ONLY one single-line JSON: {"${job.id}": "<absolute path of the generated image>"}`);
  return lines.join('\n');
}

export interface SessionResult {
  sessionId: string;
  threadId: string;
  /** id → absolute path to the generated PNG in the codex output dir */
  paths: Record<string, string>;
  /** ids whose file was assigned by call order instead of the model's printed map */
  orderMapped: string[];
  ms: number;
  err?: string;
  finalText: string;
}

/** Session message: the solo form for one job with refs/transparency, otherwise the batch form. */
export function sessionPrompt(jobs: SessionJob[]): string {
  const solo = jobs.filter((j) => j.refs?.length || j.transparent);
  if (solo.length) {
    if (jobs.length !== 1) throw new Error(`jobs with refs or transparency run alone in a session: ${solo.map((j) => j.id).join(', ')}`);
    return soloPrompt(jobs[0]!);
  }
  const head = [
    'You are an image batch worker. For each JOB below, call the built-in image_gen tool EXACTLY ONCE, in order,',
    "using the job's prompt text verbatim as the image prompt (do not summarise, shorten, translate or embellish it).",
    'Rules: do not run shell commands, do not read/write/copy/move files, do not ask questions, do not retry a job unless the tool returned an error.',
    'After the last call, reply with ONLY one single-line JSON object mapping each job id to the absolute file path of its generated image as reported by the tool (use null for a job that failed). No other text.',
    '',
  ];
  const body = jobs.map((j) => `JOB ${j.id}:\n${j.prompt}\n`);
  return [...head, ...body].join('\n');
}

function listPngs(dir: string): { path: string; mtime: number }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.png'))
    .map((f) => ({ path: join(dir, f), mtime: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => a.mtime - b.mtime);
}

function jsonUnescapePath(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw.replace(/\\\\/g, '\\');
  }
}

/** Pull `"id": "<path>"` pairs out of the model's final message (tolerates bad escaping). */
export function extractPaths(text: string, ids: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of ids) {
    const m = new RegExp(`"${id}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`).exec(text);
    if (m?.[1]) out[id] = jsonUnescapePath(m[1]);
  }
  return out;
}

export async function runSession(jobs: SessionJob[], sessionId: string, opts: SessionOptions): Promise<SessionResult> {
  if (pausedOrGemini()) return runGeminiSession(jobs, sessionId, opts);
  const dir = join(SCRATCH, sessionId);
  mkdirSync(dir, { recursive: true });
  const promptFile = join(dir, 'prompt.txt');
  writeFileSync(promptFile, opts.solo && jobs.length === 1 ? soloPrompt(jobs[0]!) : sessionPrompt(jobs));
  const images = jobs.length === 1 ? (jobs[0]!.refs ?? []).map((r) => r.path) : [];
  for (const img of images) if (!existsSync(img)) throw new Error(`reference image missing: ${img}`);
  const args = ['/c', 'codex', ...codexArgs({ effort: opts.effort, model: opts.model, images, dir })];
  writeFileSync(join(dir, 'argv.json'), JSON.stringify(args));

  // machine-wide cap on concurrent codex sessions (several agents may run imagegen at once)
  const releaseSlot = await acquireSlot(`imagegen:${sessionId}`, 'codex');
  // re-check: a usage-limit pause may have been recorded while this call waited for a slot (→ Gemini or CODEX_PAUSED)
  let viaGemini = false;
  try {
    viaGemini = pausedOrGemini();
  } catch (e) {
    releaseSlot();
    throw e;
  }
  if (viaGemini) {
    releaseSlot();
    return runGeminiSession(jobs, sessionId, opts);
  }
  const t0 = Date.now();
  const proc = Bun.spawn(['cmd', ...args], {
    stdin: Bun.file(promptFile),
    stdout: 'pipe',
    stderr: 'pipe',
    windowsHide: true,
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    Bun.spawnSync(['taskkill', '/PID', String(proc.pid), '/T', '/F']);
  }, opts.timeoutMs);

  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  await proc.exited;
  clearTimeout(timer);
  releaseSlot();
  writeFileSync(join(dir, 'events.jsonl'), stdout);
  if (stderr.trim()) writeFileSync(join(dir, 'stderr.txt'), stderr);

  let threadId = '';
  let finalText = '';
  let err: string | undefined;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith('{')) continue;
    try {
      const ev = JSON.parse(line) as { type?: string; thread_id?: string; item?: { type?: string; text?: string; message?: string }; error?: { message?: string } };
      if (ev.type === 'thread.started' && ev.thread_id) threadId = ev.thread_id;
      else if (ev.type === 'item.completed' && ev.item?.type === 'agent_message' && ev.item.text) finalText = ev.item.text;
      else if (ev.type === 'turn.failed' || ev.type === 'error') err = ev.error?.message ?? line.slice(0, 300);
    } catch {
      /* ignore non-JSON noise */
    }
  }
  if (timedOut) err = `timeout after ${Math.round(opts.timeoutMs / 1000)}s`;
  // transient auth failure (401 / missing bearer): retry this job once on Gemini without pausing codex
  const authMsg = [err, stderr].find((m) => !!m && /401|unauthori[sz]ed|missing bearer/i.test(m));
  if (authMsg && !isLimitMessage(authMsg) && process.env.MS_IMAGE_ENGINE !== 'codex' && geminiUsable()) return runGeminiSession(jobs, `${sessionId}_gemini`, opts);
  const limitMsg = [err, stderr].find((m) => isLimitMessage(m));
  if (limitMsg) {
    const until = notePause(limitMsg);
    if (process.env.MS_IMAGE_ENGINE !== 'codex' && geminiUsable()) return runGeminiSession(jobs, `${sessionId}_gemini`, opts);
    throw new CodexPausedError(until, limitMsg.slice(0, 200));
  }

  const ids = jobs.map((j) => j.id);
  const paths = extractPaths(finalText, ids);
  for (const id of Object.keys(paths)) if (!existsSync(paths[id]!)) delete paths[id];

  // Fallback: the codex output dir is keyed by the thread id; map files in call order when the
  // model's printed map is missing or incomplete (also salvages images from a timed-out session).
  const orderMapped: string[] = [];
  if (threadId && Object.keys(paths).length < ids.length) {
    const files = listPngs(join(CODEX_IMAGES, threadId)).map((f) => f.path);
    const used = new Set(Object.values(paths));
    const free = files.filter((f) => !used.has(f));
    const missing = ids.filter((id) => !paths[id]);
    // calls are sequential, so unclaimed files map onto the unmapped ids in order; surplus files
    // (an internal retry) are resolved in favour of the latest ones
    const n = Math.min(free.length, missing.length);
    if (n > 0) {
      const picked = free.slice(free.length - n);
      missing.slice(0, n).forEach((id, i) => (paths[id] = picked[i]!));
      orderMapped.push(...missing.slice(0, n));
    }
  }
  if (!threadId && !err) err = 'no thread.started event (codex failed to start)';
  return { sessionId, threadId, paths, orderMapped, ms: Date.now() - t0, err, finalText };
}
