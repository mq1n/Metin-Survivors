// Alternative image engine: Google Gemini image models ("Nano Banana"), REST generateContent with the reference images
// inline. Used automatically when codex is paused by a ChatGPT usage limit (codexPause.ts) and a GEMINI_API_KEY exists,
// or always with MS_IMAGE_ENGINE=gemini. Same contract as a codex session: one generated file per job id.
//   model: MS_GEMINI_MODEL (default gemini-nano-banana-2.1 = "Nano Banana 2.1"; also gemini-3-pro-image = "Nano Banana Pro")
//   key:   GEMINI_API_KEY from the environment or the repo's git-ignored .env (never printed or logged)
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireSlot } from '../../qa/slots';
import type { SessionJob, SessionOptions, SessionResult } from './codex';
import { CodexPausedError, checkPaused } from './codexPause';
import { SCRATCH } from './paths';
import { refRoleSentence } from './prompt';

const ROOT = join(import.meta.dir, '..', '..', '..');
export const GEMINI_MODEL = process.env.MS_GEMINI_MODEL ?? 'gemini-nano-banana-2.1';

export function geminiKey(): string | null {
  const env = process.env.GEMINI_API_KEY?.trim();
  if (env) return env;
  const file = join(ROOT, '.env');
  if (!existsSync(file)) return null;
  const m = /^GEMINI_API_KEY=(.+)$/m.exec(readFileSync(file, 'utf8'));
  return m?.[1]?.trim() || null;
}

// Key / billing / permission answers (401 invalid key, 402 prepayment credits depleted, 403) do not heal by retrying: the first session that sees
// one writes this file and every fallback skips Gemini for an hour instead of failing each job again (delete it to re-probe).
export const GEMINI_BLOCK_FILE = join(tmpdir(), 'ms-qa-locks', 'gemini_unavailable.json');
const BLOCK_TTL_MS = 60 * 60_000;

function noteBlocked(msg: string): void {
  mkdirSync(join(tmpdir(), 'ms-qa-locks'), { recursive: true });
  writeFileSync(GEMINI_BLOCK_FILE, JSON.stringify({ at: new Date().toISOString(), msg: msg.slice(0, 300) }));
}

/** Blocked-by-billing message while the block file is fresh; clears an expired one. */
export function geminiBlocked(): string | null {
  if (!existsSync(GEMINI_BLOCK_FILE)) return null;
  try {
    if (Date.now() - statSync(GEMINI_BLOCK_FILE).mtimeMs > BLOCK_TTL_MS) {
      rmSync(GEMINI_BLOCK_FILE, { force: true });
      return null;
    }
    return (JSON.parse(readFileSync(GEMINI_BLOCK_FILE, 'utf8')) as { msg: string }).msg;
  } catch {
    return null;
  }
}

/** A key exists and Gemini is not blocked by billing: the codex fallback may use it. */
export function geminiUsable(): boolean {
  return !!geminiKey() && !geminiBlocked();
}

const ASPECTS: [RegExp, string][] = [
  [/Wide cinematic 16:9 canvas/i, '16:9'],
  [/Landscape 3:2 canvas/i, '3:2'],
  [/Portrait 2:3 canvas/i, '2:3'],
  [/Square 1:1 canvas/i, '1:1'],
];

/** The engine-neutral message: reference roles + the composed prompt (+ a keyable background for transparent jobs). */
export function geminiPrompt(job: SessionJob): string {
  const lines: string[] = [];
  if (job.refs?.length) {
    lines.push('Attached images:');
    job.refs.forEach((r, i) => lines.push(`- Image ${i + 1} = ${refRoleSentence(r.role)}.`));
    lines.push('');
  }
  lines.push(job.prompt.trim());
  if (job.transparent) {
    lines.push(
      '',
      'Background (overrides any other background instruction): one perfectly flat, solid, uniform pure magenta #FF00FF fill behind the subject, edge to edge — no gradient, texture, shadow or glow on it; the subject itself contains no magenta or pink. The magenta is keyed out to transparency afterwards.',
    );
  }
  return lines.join('\n');
}

function mimeOf(path: string): string {
  const p = path.toLowerCase();
  if (p.endsWith('.jpg') || p.endsWith('.jpeg')) return 'image/jpeg';
  if (p.endsWith('.webp')) return 'image/webp';
  return 'image/png';
}

async function callOnce(key: string, job: SessionJob, timeoutMs: number): Promise<{ data?: Buffer; mime?: string; err?: string; retry?: boolean; blocked?: boolean }> {
  const parts: unknown[] = [];
  for (const r of job.refs ?? []) parts.push({ inline_data: { mime_type: mimeOf(r.path), data: readFileSync(r.path).toString('base64') } });
  parts.push({ text: geminiPrompt(job) });
  const aspect = ASPECTS.find(([re]) => re.test(job.prompt))?.[1];
  const body = { contents: [{ parts }], generationConfig: { responseModalities: ['IMAGE'], ...(aspect ? { imageConfig: { aspectRatio: aspect } } : {}) } };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const text = await res.text();
    if (!res.ok) return { err: `gemini HTTP ${res.status}: ${text.slice(0, 300)}`, retry: res.status === 429 || res.status >= 500, blocked: res.status === 401 || res.status === 402 || res.status === 403 };
    const d = JSON.parse(text) as { candidates?: { content?: { parts?: { inlineData?: { mimeType: string; data: string }; text?: string }[] }; finishReason?: string }[]; promptFeedback?: unknown };
    const ps = d.candidates?.[0]?.content?.parts ?? [];
    const img = ps.find((p) => p.inlineData?.data);
    if (!img?.inlineData) return { err: `gemini returned no image (finish ${d.candidates?.[0]?.finishReason ?? '?'}; ${ps.map((p) => p.text ?? '').join(' ').slice(0, 200)}; feedback ${JSON.stringify(d.promptFeedback ?? null).slice(0, 200)})`, retry: true };
    return { data: Buffer.from(img.inlineData.data, 'base64'), mime: img.inlineData.mimeType };
  } catch (e) {
    return { err: `gemini request failed: ${String(e).slice(0, 200)}`, retry: true };
  } finally {
    clearTimeout(timer);
  }
}

/** One "session": every job generated with Gemini (sequentially inside the session; parallelism comes from callers). */
export async function runGeminiSession(jobs: SessionJob[], sessionId: string, opts: SessionOptions): Promise<SessionResult> {
  const key = geminiKey();
  if (!key) throw new Error('GEMINI_API_KEY missing (env or repo .env)');
  const blockedMsg = geminiBlocked();
  if (blockedMsg) failBlocked(blockedMsg);
  const dir = join(SCRATCH, sessionId);
  mkdirSync(dir, { recursive: true });
  for (const j of jobs) for (const r of j.refs ?? []) if (!existsSync(r.path)) throw new Error(`reference image missing: ${r.path}`);
  writeFileSync(join(dir, 'prompt.txt'), jobs.map((j) => `JOB ${j.id}:\n${geminiPrompt(j)}\n`).join('\n'));
  const release = await acquireSlot(`gemini:${sessionId}`, 'gemini');
  const t0 = Date.now();
  const paths: Record<string, string> = {};
  const errs: string[] = [];
  let blocked: string | undefined;
  try {
    for (const job of jobs) {
      if (blocked) {
        errs.push(`${job.id}: skipped, gemini blocked (${blocked.slice(0, 120)})`);
        continue;
      }
      let got: { data?: Buffer; mime?: string; err?: string; retry?: boolean; blocked?: boolean } = {};
      for (let att = 0; att < 4; att++) {
        got = await callOnce(key, job, Math.min(opts.timeoutMs, 300_000));
        if (got.data || !got.retry) break;
        await new Promise((r) => setTimeout(r, [8_000, 25_000, 60_000][att] ?? 60_000));
      }
      if (!got.data) {
        errs.push(`${job.id}: ${got.err}`);
        if (got.blocked) {
          blocked = got.err ?? 'gemini billing/permission error';
          noteBlocked(blocked);
        }
        continue;
      }
      const ext = got.mime === 'image/jpeg' ? 'jpg' : got.mime === 'image/webp' ? 'webp' : 'png';
      const raw = join(dir, `${job.id}.gemini.${ext}`);
      writeFileSync(raw, got.data);
      if (job.transparent) {
        const keyed = join(dir, `${job.id}.png`);
        const p = Bun.spawnSync(['python', join(ROOT, 'tools', 'imagegen', 'py', 'keymagenta.py'), raw, keyed], { stdout: 'pipe', stderr: 'pipe' });
        if (p.exitCode !== 0) {
          errs.push(`${job.id}: magenta key failed: ${p.stderr.toString().slice(0, 200)}`);
          continue;
        }
        paths[job.id] = keyed;
      } else {
        // normalise to PNG so every downstream step sees the same container (PIL reads the original fine as well)
        const png = join(dir, `${job.id}.png`);
        const p = Bun.spawnSync(['python', '-c', 'import sys;from PIL import Image;Image.open(sys.argv[1]).convert("RGB").save(sys.argv[2])', raw, png], { stdout: 'pipe', stderr: 'pipe' });
        paths[job.id] = p.exitCode === 0 ? png : raw;
      }
    }
  } finally {
    release();
  }
  writeFileSync(join(dir, 'engine.json'), JSON.stringify({ engine: 'gemini', model: GEMINI_MODEL, jobs: jobs.map((j) => j.id), errs, ms: Date.now() - t0 }, null, 1));
  if (blocked && !Object.keys(paths).length) failBlocked(blocked);
  return { sessionId, threadId: `gemini:${GEMINI_MODEL}`, paths, orderMapped: [], ms: Date.now() - t0, err: errs.length ? errs.join(' | ') : undefined, finalText: '' };
}

/** Gemini is blocked by billing: while codex is paused too this is the same DEFERRED_GEN situation (CodexPausedError);
 *  otherwise a plain error so the caller sees the reason. */
function failBlocked(msg: string): never {
  checkPaused(); // throws CodexPausedError (with the DEFERRED_GEN instructions) while codex is paused
  throw new Error(`GEMINI_UNAVAILABLE (billing/permission; ${msg.slice(0, 200)}). Set MS_IMAGE_ENGINE=codex or delete ${GEMINI_BLOCK_FILE} after topping up.`);
}
