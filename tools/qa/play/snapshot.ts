// QA snapshot: a FROZEN build of the game, so a playthrough measures one tree while other workflows keep shipping models into the live one.
//   <out>/dist-qa    VITE_QA_HOOKS=1 build (window.__ms published) - what the campaign / matrix / selftest drive
//   <out>/dist-prod  the plain production build (no hook)         - what the smoke drives with real input only
// Both are strict-asset builds (MS_STRICT_ASSETS=1) taken INSIDE the ship lock of the mob workflows (a half-shipped model must not get in);
// the lock is held for the builds only. snapshot.json records git status --porcelain, the manifest sha256 (before / after the builds) and the
// hook check (grep of both dists), which `selftest` re-runs.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MANIFEST_LOCK, withLock } from '../../pipeline/lock';

export const REPO = resolve(import.meta.dir, '..', '..', '..');
export const GAME = join(REPO, 'apps', 'game');
export const QA_ROOT = join(REPO, '.research', 'qa');

export interface HookCheck {
  /** occurrences of the hook marker in the JS of the dist */
  hookMarkers: number;
  /** files that contain it */
  files: string[];
  /** the string the build must not contain without the flag */
  needle: string;
}

export interface SnapshotInfo {
  stamp: string;
  out: string;
  distQa: string;
  distProd: string;
  manifestSha256: { before: string; afterBuilds: string; distQa: string; distProd: string };
  gitStatusPorcelain: string[];
  builds: { name: string; exit: number; ms: number; log: string }[];
  lockWaitMs: number;
  lockHeldMs: number;
  hookInQa: HookCheck;
  hookInProd: HookCheck;
  ok: boolean;
  problems: string[];
}

const sha = (p: string): string => (existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex') : 'missing');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Counts the hook (`window.__ms` as an exact identifier: `__msSplash`, `__ms_probe__` and `__msAmbientDust` are other things) in every .js / .html of a dist. */
export function hookCheck(dist: string): HookCheck {
  const needle = 'window.__ms (exact identifier)';
  const rx = /(?<![\w$])__ms(?![\w$])/g;
  const files: string[] = [];
  let n = 0;
  for (const f of walk(dist)) {
    if (!/\.(js|mjs|html)$/.test(f)) continue;
    if (statSync(f).size > 40 * 1024 * 1024) continue;
    const c = readFileSync(f, 'utf8').match(rx)?.length ?? 0;
    if (c > 0) {
      n += c;
      files.push(f.slice(dist.length + 1).replace(/\\/g, '/'));
    }
  }
  return { hookMarkers: n, files, needle };
}

async function build(name: string, outDir: string, env: Record<string, string>, log: string): Promise<{ name: string; exit: number; ms: number; log: string }> {
  const t0 = Date.now();
  const proc = Bun.spawn(['bunx', 'vite', 'build', '--sourcemap', 'false', '--outDir', outDir, '--emptyOutDir'], {
    cwd: GAME,
    env: { ...process.env, MS_STRICT_ASSETS: '1', ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [so, se] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exit = await proc.exited;
  writeFileSync(log, so + (se ? `\n--- stderr ---\n${se}` : ''));
  return { name, exit, ms: Date.now() - t0, log };
}

export async function takeSnapshot(opts: { out?: string; label?: string } = {}): Promise<SnapshotInfo> {
  const d = new Date();
  const p2 = (n: number): string => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
  const out = opts.out ? resolve(opts.out) : join(QA_ROOT, 'snap', stamp);
  mkdirSync(out, { recursive: true });
  const distQa = join(out, 'dist-qa');
  const distProd = join(out, 'dist-prod');
  const manifest = join(GAME, 'public', 'assets', 'manifest.json');
  const problems: string[] = [];
  const git = Bun.spawnSync(['git', 'status', '--porcelain'], { cwd: REPO });
  const gitStatusPorcelain = git.stdout.toString().split('\n').filter(Boolean);
  const before = sha(manifest);
  const tWait = Date.now();
  let tHeld = 0;
  let lockWaitMs = 0;
  let builds: SnapshotInfo['builds'] = [];
  await withLock(
    MANIFEST_LOCK,
    async () => {
      tHeld = Date.now();
      lockWaitMs = tHeld - tWait;
      console.log(`[snapshot] ship lock taken after ${tHeld - tWait} ms, building dist-qa + dist-prod in parallel`);
      builds = await Promise.all([
        build('dist-qa', distQa, { VITE_QA_HOOKS: '1' }, join(out, 'build-qa.log')),
        build('dist-prod', distProd, {}, join(out, 'build-prod.log')),
      ]);
      tHeld = Date.now() - tHeld;
    },
    { label: opts.label ?? 'qa-playthrough snapshot', keepAlive: true },
  );
  const afterBuilds = sha(manifest);
  for (const b of builds) if (b.exit !== 0) problems.push(`${b.name}: vite build exit ${b.exit} (see ${b.log})`);
  if (before !== afterBuilds) problems.push('apps/game/public/assets/manifest.json changed while the builds ran (a producer shipped; the dists may disagree with each other)');
  const hookInQa = existsSync(distQa) ? hookCheck(distQa) : { hookMarkers: -1, files: [], needle: 'window.__ms' };
  const hookInProd = existsSync(distProd) ? hookCheck(distProd) : { hookMarkers: -1, files: [], needle: 'window.__ms' };
  if (hookInQa.hookMarkers <= 0) problems.push('the QA build does not contain the hook (window.__ms)');
  if (hookInProd.hookMarkers !== 0) problems.push(`the PLAIN production build contains the hook (window.__ms) ${hookInProd.hookMarkers}x in ${hookInProd.files.join(', ')}`);
  const info: SnapshotInfo = {
    stamp,
    out,
    distQa,
    distProd,
    manifestSha256: { before, afterBuilds, distQa: sha(join(distQa, 'assets', 'manifest.json')), distProd: sha(join(distProd, 'assets', 'manifest.json')) },
    gitStatusPorcelain,
    builds,
    lockWaitMs,
    lockHeldMs: tHeld,
    hookInQa,
    hookInProd,
    ok: problems.length === 0,
    problems,
  };
  writeFileSync(join(out, 'snapshot.json'), JSON.stringify(info, null, 2));
  return info;
}


export function latestSnapshot(): SnapshotInfo | null {
  const root = join(QA_ROOT, 'snap');
  if (!existsSync(root)) return null;
  const names = readdirSync(root).filter((n) => existsSync(join(root, n, 'snapshot.json'))).sort();
  const last = names[names.length - 1];
  return last ? (JSON.parse(readFileSync(join(root, last, 'snapshot.json'), 'utf8')) as SnapshotInfo) : null;
}
