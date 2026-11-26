// Reference images for codex `-i`: normalise JobSpec.refs, resolve paths, prepare attachable PNG views (py/refs.py).
import { existsSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { PY, REFS, ROOT } from './paths';
import type { AttachedRef } from './codex';
import type { JobSpec, RefSpec } from './types';

export interface PreparedRef extends AttachedRef {
  /** the source as given (resolved, absolute) */
  src: string;
  /** prepared PNG that is attached */
  path: string;
  role: string;
  w: number;
  h: number;
  /** rgb | over-black | over-grey — how alpha was flattened for viewing */
  view: string;
  stretch: number;
}

/** refs entries → { path, role } (a plain string is a 'texture' reference). */
export function normalizeRefs(refs: JobSpec['refs']): RefSpec[] {
  return (refs ?? []).map((r) => (typeof r === 'string' ? { path: r, role: 'texture' } : { path: r.path, role: r.role ?? 'texture' }));
}

/** Absolute path of a reference: absolute as is; relative → the current directory if it exists there, else the repo root. */
export function resolveRefPath(p: string, cwd = process.cwd()): string {
  if (isAbsolute(p)) return resolve(p);
  const here = resolve(cwd, p);
  return existsSync(here) ? here : resolve(ROOT, p);
}

/** How a reference is stored in a job file: repo-relative with forward slashes inside the repo, absolute outside. */
export function storedRefPath(abs: string): string {
  const rel = relative(ROOT, abs);
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel.replaceAll('\\', '/') : abs.replaceAll('\\', '/');
}


export async function prepareRefs(refs: RefSpec[]): Promise<PreparedRef[]> {
  if (!refs.length) return [];
  const srcs = refs.map((r) => resolveRefPath(r.path));
  const missing = srcs.filter((s) => !existsSync(s));
  if (missing.length) throw new Error(`reference image(s) not found: ${missing.join(', ')}`);
  const proc = Bun.spawn(['python', join(PY, 'refs.py'), REFS, ...srcs], { stdout: 'pipe', stderr: 'pipe', windowsHide: true });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  if ((await proc.exited) !== 0) throw new Error(`refs.py failed: ${err.trim().split('\n').slice(-4).join('\n')}`);
  const metas = JSON.parse(out.trim().split('\n').pop()!) as { out: string; w: number; h: number; view: string; stretch: number }[];
  return metas.map((m, i) => ({ src: srcs[i]!, path: resolve(m.out), role: refs[i]!.role ?? 'texture', w: m.w, h: m.h, view: m.view, stretch: m.stretch }));
}
