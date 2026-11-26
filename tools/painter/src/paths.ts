import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const ROOT = resolve(import.meta.dir, '..', '..', '..');
export const TOOL = join(ROOT, 'tools', 'painter');
export const PY = join(TOOL, 'py');
export const RESEARCH = join(ROOT, '.research', 'painter');
/** per-model scratch: <RESEARCH>/work/<id>/ */
export const WORK = join(RESEARCH, 'work');
/** accepted paint results consumed by forge builds: <CACHE>/<id>/{texture.png,meta.json} */
export const CACHE = join(RESEARCH, 'cache');
export const CODEX_IMAGES = process.env.CODEX_HOME
  ? join(process.env.CODEX_HOME, 'generated_images')
  : join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.codex', 'generated_images');

export function ensure(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}
