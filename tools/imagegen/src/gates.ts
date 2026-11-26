// Icon machine gates (REPORT C4): runs py/gates.py over one collection and returns its report.
//   bun src/cli.ts gates --collection skills [--source build|gen|shipped] [--ids a,b]

// id, shipped = the files the manifest points at (legacy opaque icons are judged as form "legacy": dup + luma only).

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IconCollection } from './defs/iconStyle';
import { collectionJobs, loadHints } from './iconjobs';
import { BUILD, GEN, MANIFEST_DIR, PUBLIC, PY, RESEARCH, TOOL } from './paths';
import type { JobSpec } from './types';

export type GateSource = 'build' | 'gen' | 'shipped';

export interface GateItem {
  id: string;
  path: string;
  form: 'tile' | 'cutout' | 'legacy';
  glyph: string | null;
  pairOk: string[];
}

export interface GateSummary {
  collection: string;
  n: number;
  missing: string[];
  failed: string[];
  clusters: string[][];
  sheets: string[];
  pairsTop: { a: string; b: string; r: number }[];
  report: string;
}

const fwd = (p: string): string => p.replaceAll('\\', '/');

/** Form of a v2 job from its post chain (octile -> tile, fit -> cutout), legacy otherwise. */
export function jobForm(job: JobSpec | undefined): GateItem['form'] {
  const ops = (job?.post ?? []).map((o) => (o as { op: string }).op);
  return ops.includes('octile') ? 'tile' : ops.includes('fit') ? 'cutout' : 'legacy';
}

function newestVariantBuild(id: string): { path: string; glyph: string | null } | null {
  const dir = join(GEN, id);
  if (!existsSync(dir)) return null;
  const ks = readdirSync(dir)
    .map((f) => /^v(\d+)$/.exec(f)?.[1])
    .filter((x): x is string => !!x)
    .map(Number)
    .sort((a, b) => b - a);
  for (const k of ks) {
    const p = join(dir, `v${k}`, 'build', `${id}.webp`);
    if (existsSync(p)) {
      const g = join(dir, `v${k}`, 'build', `${id}.glyph.png`);
      return { path: p, glyph: existsSync(g) ? g : null };
    }
  }
  return null;
}

export function gateItems(c: IconCollection, source: GateSource, ids?: string[]): GateItem[] {
  const jobs = new Map(collectionJobs(c).map((j) => [j.id, j]));
  const hints = loadHints(c);
  const manifest = existsSync(join(MANIFEST_DIR, 'icons.json'))
    ? (JSON.parse(readFileSync(join(MANIFEST_DIR, 'icons.json'), 'utf8')) as Record<string, { url: string; style?: { form?: string } }>)
    : {};
  const out: GateItem[] = [];
  for (const id of ids?.length ? ids : [...jobs.keys()]) {
    const job = jobs.get(id);
    const pairOk = hints[id]?.pairOk ?? [];
    if (source === 'shipped') {
      const e = manifest[id];
      if (!e) continue;
      const form = e.style?.form === 'tile' || e.style?.form === 'cutout' ? e.style.form : 'legacy';
      out.push({ id, path: fwd(join(PUBLIC, e.url)), form, glyph: null, pairOk });
    } else if (source === 'gen') {
      const v = newestVariantBuild(id);
      if (v) out.push({ id, path: fwd(v.path), form: jobForm(job), glyph: v.glyph ? fwd(v.glyph) : null, pairOk });
    } else {
      const p = join(BUILD, id, `${id}.webp`);
      const g = join(BUILD, id, `${id}.glyph.png`);
      if (existsSync(p)) out.push({ id, path: fwd(p), form: jobForm(job), glyph: existsSync(g) ? fwd(g) : null, pairOk });
    }
  }
  return out;
}

async function runPyGates(c: string, source: string, items: GateItem[], dir: string): Promise<GateSummary> {
  mkdirSync(dir, { recursive: true });
  const itemsFile = join(dir, 'items.json');
  writeFileSync(itemsFile, JSON.stringify({ collection: c, source, items }, null, 1));
  const proc = Bun.spawn(['python', join(PY, 'gates.py'), itemsFile, dir, '--profile', join(TOOL, 'gates.json')], { stdout: 'pipe', stderr: 'pipe', windowsHide: true });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  if ((await proc.exited) !== 0) throw new Error(`gates.py failed: ${err.trim().split('\n').slice(-6).join('\n')}`);
  return JSON.parse(out.trim().split('\n').pop()!) as GateSummary;
}

export async function runGates(c: IconCollection, source: GateSource = 'build', ids?: string[]): Promise<GateSummary> {
  return runPyGates(c, source, gateItems(c, source, ids), join(RESEARCH, 'gates', c));
}

const PREFIX: [string, IconCollection][] = [
  ['icon_skill_', 'skills'],
  ['icon_passive_', 'passives'],
  ['icon_stone_', 'stones'],
  ['icon_trinket_', 'trinkets'],
  ['icon_gear_', 'gear'],
  ['icon_talent_', 'talents'],
];
export function collectionOf(id: string): IconCollection | null {
  return PREFIX.find(([p]) => id.startsWith(p))?.[1] ?? null;
}

/** Single-icon gates (corner, ring, fill, luma, glyph contrast) on gen variant k of an icon v2 job; null when the job is
 *  not an icon v2 job. Failures are listed per gate in the returned report file. */
export async function gateVariant(id: string, k: number): Promise<{ fails: string[]; report: string } | null> {
  const vdir = join(GEN, id, `v${k}`);
  const jobFile = join(vdir, 'job.json');
  if (!existsSync(jobFile)) return null;
  const job = JSON.parse(readFileSync(jobFile, 'utf8')) as JobSpec;
  const form = jobForm(job);
  const c = collectionOf(id);
  if (job.kind !== 'icon' || form === 'legacy' || !c) return null;
  const path = join(vdir, 'build', `${id}.webp`);
  const glyph = join(vdir, 'build', `${id}.glyph.png`);
  const sum = await runPyGates(c, `gen v${k}`, [{ id, path: fwd(path), form, glyph: existsSync(glyph) ? fwd(glyph) : null, pairOk: [] }], join(RESEARCH, 'gates', c, `${id}_v${k}`));
  const rep = JSON.parse(readFileSync(sum.report, 'utf8')) as { results: { fails: string[] }[] };
  return { fails: rep.results[0]?.fails ?? (sum.missing.length ? ['build missing'] : []), report: sum.report };
}
