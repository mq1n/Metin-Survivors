// One `codex exec` session = one image_gen call with the clay turnaround sheet attached.
// Codex' own shell is sandboxed/broken, so it only calls image_gen and prints the path; we copy the file ourselves.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CODEX_IMAGES, RESEARCH } from './paths.ts';

export interface CodexResult {
  ok: boolean;
  /** absolute path of the generated PNG (inside ~/.codex/generated_images) */
  generated?: string;
  /** copy placed at `outPath` */
  outPath?: string;
  threadId: string;
  ms: number;
  err?: string;
  finalText: string;
}

export interface CodexOptions {
  effort?: string;
  timeoutMs?: number;
  model?: string;
}

function listPngs(dir: string): { path: string; mtime: number }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.png'))
    .map((f) => ({ path: join(dir, f), mtime: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => a.mtime - b.mtime);
}

// At most MAX_SESSIONS concurrent codex sessions MACHINE-WIDE (several painter processes may run: batch jobs, forge agents' `ship`).

const MAX_SESSIONS = Number(process.env.PAINTER_CODEX_MAX ?? 2);
const LOCK_DIR = join(RESEARCH, 'locks');
const LOCK_MAX_AGE_MS = 25 * 60_000;

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function tryLock(slot: number): string | null {
  const file = join(LOCK_DIR, `codex-${slot}.lock`);
  try {
    writeFileSync(file, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: 'wx' });
    return file;
  } catch {
    try {
      const cur = JSON.parse(readFileSync(file, 'utf8')) as { pid?: number; at?: number };
      const stale = !cur.pid || !pidAlive(cur.pid) || Date.now() - (cur.at ?? 0) > LOCK_MAX_AGE_MS;
      if (stale) rmSync(file, { force: true });
    } catch {
      /* unreadable lock: the owner is writing it right now; retry on the next poll */
    }
    return null;
  }
}

async function acquire(): Promise<string> {
  mkdirSync(LOCK_DIR, { recursive: true });
  for (;;) {
    for (let slot = 0; slot < MAX_SESSIONS; slot++) {
      const f = tryLock(slot);
      if (f) return f;
    }
    await new Promise((r) => setTimeout(r, 2000 + Math.random() * 1000));
  }
}

function release(lock: string): void {
  rmSync(lock, { force: true });
}

/**
 * Edit `imagePath` with the built-in image_gen tool according to `prompt` and copy the result to `outPath`.
 * `refs` are extra attached images (e.g. an already painted sheet used as colour reference).
 */
export async function codexImageEdit(prompt: string, images: string[], outPath: string, scratch: string, opts: CodexOptions = {}): Promise<CodexResult> {
  mkdirSync(scratch, { recursive: true });
  const wrapper = [
    'You are an image-edit worker. Call the built-in image_gen tool EXACTLY ONCE, using the attached image(s) as the source/reference image(s) to edit, ',
    'and the text between <PROMPT> and </PROMPT> verbatim as the instruction (do not summarise, shorten, translate or embellish it). ',
    'Do not run shell commands, do not read/write/copy/move files, do not ask questions, do not retry unless the tool returned an error. ',
    'After the call, reply with ONLY one single-line JSON object {"path": "<absolute path of the generated image as reported by the tool>"}. No other text.',
    '<PROMPT>',
    prompt,
    '</PROMPT>',
  ].join('\n');
  const promptFile = join(scratch, `prompt_${Date.now()}.txt`);
  writeFileSync(promptFile, wrapper);

  const args = ['/c', 'codex', 'exec', '-s', 'read-only', '--skip-git-repo-check', '--json', '-c', `model_reasoning_effort=${opts.effort ?? 'low'}`];
  if (opts.model) args.push('-m', opts.model);
  for (const img of images) args.push('-i', img);
  args.push('-C', scratch, '-');

  const lock = await acquire();
  const t0 = Date.now();
  try {
    const proc = Bun.spawn(['cmd', ...args], { stdin: Bun.file(promptFile), stdout: 'pipe', stderr: 'pipe', windowsHide: true });
    let timedOut = false;
    const timeoutMs = opts.timeoutMs ?? 10 * 60_000;
    const timer = setTimeout(() => {
      timedOut = true;
      Bun.spawnSync(['taskkill', '/PID', String(proc.pid), '/T', '/F']);
    }, timeoutMs);
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    await proc.exited;
    clearTimeout(timer);
    writeFileSync(join(scratch, 'events.jsonl'), stdout);
    if (stderr.trim()) writeFileSync(join(scratch, 'stderr.txt'), stderr);

    let threadId = '';
    let finalText = '';
    let err: string | undefined;
    for (const line of stdout.split(/\r?\n/)) {
      if (!line.startsWith('{')) continue;
      try {
        const ev = JSON.parse(line) as { type?: string; thread_id?: string; item?: { type?: string; text?: string }; error?: { message?: string }; message?: string };
        if (ev.type === 'thread.started' && ev.thread_id) threadId = ev.thread_id;
        else if (ev.type === 'item.completed' && ev.item?.type === 'agent_message' && ev.item.text) finalText = ev.item.text;
        else if (ev.type === 'turn.failed' || ev.type === 'error') err = ev.error?.message ?? ev.message ?? line.slice(0, 300);
      } catch {
        /* non-JSON noise */
      }
    }
    if (timedOut) err = `timeout after ${Math.round(timeoutMs / 1000)}s`;
    let generated: string | undefined;
    const m = /"path"\s*:\s*"((?:\\.|[^"\\])*)"/.exec(finalText);
    if (m?.[1]) {
      try {
        generated = JSON.parse(`"${m[1]}"`) as string;
      } catch {
        generated = m[1].replace(/\\\\/g, '\\');
      }
      if (!existsSync(generated)) generated = undefined;
    }
    if (!generated && threadId) {
      const files = listPngs(join(CODEX_IMAGES, threadId));
      if (files.length) generated = files[files.length - 1]!.path; // latest of the session
    }
    if (!threadId && !err) err = 'no thread.started event (codex failed to start)';
    if (generated) {
      copyFileSync(generated, outPath);
      return { ok: true, generated, outPath, threadId, ms: Date.now() - t0, err, finalText };
    }
    return { ok: false, threadId, ms: Date.now() - t0, err: err ?? 'no image generated', finalText };
  } finally {
    release(lock);
  }
}
