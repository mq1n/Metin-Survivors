import { join, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

export const ROOT = resolve(import.meta.dir, '..', '..', '..');
export const TOOL = join(ROOT, 'tools', 'imagegen');
export const RESEARCH = process.env.MS_IMAGEGEN_RESEARCH ? resolve(process.env.MS_IMAGEGEN_RESEARCH) : join(ROOT, '.research', 'imagegen');
export const RAW = join(RESEARCH, 'raw');
export const PROMPTS = join(RESEARCH, 'prompts');
export const BUILD = join(RESEARCH, 'build');
export const CONTACT = join(RESEARCH, 'contact');
export const SCRATCH = join(RESEARCH, 'scratch');
export const LOG = join(RESEARCH, 'log.jsonl');
export const REVIEW = join(RESEARCH, 'review.json');
export const SHIPPED = join(RESEARCH, 'shipped.json');
/** `gen` variants: gen/<id>/v<k>/{job.json,prompt.txt,raw.png,build/,meta.json} */
export const GEN = join(RESEARCH, 'gen');
/** prepared reference PNGs attached to generation sessions */
export const REFS = join(RESEARCH, 'refs');
export const JOBS_DIR = join(TOOL, 'jobs');
/** one job file per id promoted by `pick` (the reproducible source of a shipped gen asset) */
export const JOBS_GEN = join(JOBS_DIR, 'gen');
export const PY = join(TOOL, 'py');
export const PUBLIC = join(ROOT, 'apps', 'game', 'public');
export const ASSETS = join(PUBLIC, 'assets');
export const MANIFEST_DIR = join(ASSETS, 'manifest');
export const CONTENT_DIR = join(ROOT, 'apps', 'game', 'src', 'data', 'content');
export const CODEX_IMAGES = process.env.CODEX_HOME
  ? join(process.env.CODEX_HOME, 'generated_images')
  : join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.codex', 'generated_images');

export function ensureDirs(): void {
  for (const d of [RESEARCH, RAW, PROMPTS, BUILD, CONTACT, SCRATCH, GEN, REFS, JOBS_DIR, MANIFEST_DIR]) {
    mkdirSync(d, { recursive: true });
  }
}
