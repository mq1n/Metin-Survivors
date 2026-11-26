// Metin Survivors release pipeline: Cloudflare Pages (client + /api proxy Function) + Worker API + D1 + R2 + Durable
// Objects. README.md → "Deploy" has the one-time setup.
//
//   bun run deploy                  local gates, then D1 migrations → Worker → Pages → read-only smoke test
//   bun run deploy -- --dry-run     prints every step, runs the local ones, never touches remote Cloudflare state
//   bun run deploy:check            the local gates only (everything except the remote steps)
//
// Options
//   --out-dir <dir>    build output (default apps/game/dist)
//   --branch <name>    Pages branch to deploy as (default $PAGES_BRANCH or "main"); if Cloudflare reports a preview
//                      because the project's production branch differs, the deploy is repeated on that branch
//   --preview          deploy Pages as a preview of --branch on purpose (no production promotion)
//   --allow-dirty      allow a remote deploy from an uncommitted work tree (check / dry-run only warn)
//   --no-backup        skip the D1 export taken before pending migrations are applied
//   --allow-over-budget  ship although the payload gate (menu < 6 MB, zone < 20 MB) failed: it is then a warning
//   --skip=<a,b>       check / dry-run only: skip local steps (the run then ends INCOMPLETE, exit code 2)
//
// Order and why: the clean-room audit fails fast on the source assets; manifest → typecheck → tests → strict build;
// the built site is checked against the Pages contract (_headers / _routes.json / hashed names / no source maps / size
// limits), against its own asset manifest (every file it names must be in the build) and for JS chunks that import each
// other in a cycle (they boot into a crash before the menu; scripts/chunkGraph.ts); the payload budgets are a
// blocking gate; the built site is audited again; the Worker and the Pages Function are bundled locally. Remote: D1 migrations first
// (the new Worker may need the new schema), then the Worker (the Pages Function binds to it), then Pages, then a
// read-only smoke test. Nothing here registers players or writes game data.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { checkMigrations, migrationFile, parseLock, recordApplied, type MigrationFile } from '../workers/api/scripts/migrationsLock';
import { checkChunkGraph, formatCycles } from './chunkGraph';
import { checkDistManifest } from './distManifest';

// ------------------------------------------------------------------------------------------------ configuration

const ROOT = path.resolve(import.meta.dirname, '..');
const GAME = path.join(ROOT, 'apps', 'game');
const API = path.join(ROOT, 'workers', 'api');
export const NAMES = {
  pagesProject: 'metin-survivors',
  pagesOrigin: 'https://metin-survivors.pages.dev',
  customOrigin: 'https://metin-survivors.com',
  worker: 'metin-survivors-api',
  d1: 'metin-survivors-db',
  r2: 'metin-survivors-blobs',
  durableObject: 'CoopRoom',
} as const;
const PRODUCTION_BRANCHES = new Set(['main', 'master']);
/** Cloudflare Pages per-deployment limits. */
const PAGES_MAX_FILES = 20_000;
const PAGES_MAX_FILE_BYTES = 25 * 1024 * 1024;
/** apps/game/vite.config.ts `chunkSizeWarningLimit` (kB, as Vite counts them): a JS chunk past it is repeated in the summary */
const CHUNK_WARN_BYTES = 1500 * 1000;

type Mode = 'deploy' | 'dry-run' | 'check';

export interface Options {
  mode: Mode;
  outDir: string;
  branch: string;
  preview: boolean;
  allowDirty: boolean;
  backup: boolean;
  /** a missed payload budget is a warning instead of a failed step */
  allowOverBudget: boolean;
  skip: Set<string>;
}

export interface ParseArgsDeps {
  env?: Record<string, string | undefined>;
  currentGitBranch?: () => string;
}

function sanitizePreviewBranch(raw: string): string | null {
  const cleaned = raw.trim().replace(/[^A-Za-z0-9._/-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);
  if (!cleaned || cleaned === 'HEAD' || PRODUCTION_BRANCHES.has(cleaned.toLowerCase())) return null;
  return /^[A-Za-z0-9._/-]{1,100}$/.test(cleaned) ? cleaned : null;
}

export function parseArgs(argv: string[], deps: ParseArgsDeps = {}): Options {
  const env = deps.env ?? process.env;
  const opts: Options = {
    mode: 'deploy',
    outDir: path.join(GAME, 'dist'),
    branch: env.PAGES_BRANCH || 'main',
    preview: false,
    allowDirty: false,
    backup: true,
    allowOverBudget: false,
    skip: new Set(),
  };
  let explicitBranch = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    const value = (): string => {
      const eq = a.indexOf('=');
      if (eq > 0) return a.slice(eq + 1);
      const next = argv[++i];
      if (next === undefined) fail(`${a} needs a value`);
      return next;
    };
    if (a === '--dry-run') opts.mode = 'dry-run';
    else if (a === '--check') opts.mode = 'check';
    else if (a === '--preview') opts.preview = true;
    else if (a === '--allow-dirty') opts.allowDirty = true;
    else if (a === '--no-backup') opts.backup = false;
    else if (a === '--allow-over-budget') opts.allowOverBudget = true;
    else if (a.startsWith('--out-dir')) opts.outDir = path.resolve(ROOT, value());
    else if (a.startsWith('--branch')) {
      opts.branch = value();
      explicitBranch = true;
    } else if (a.startsWith('--skip')) for (const s of value().split(',')) opts.skip.add(s.trim());
    else if (a === '-h' || a === '--help') {
      console.log(readFileSync(import.meta.filename, 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
      process.exit(0);
    } else fail(`unknown option ${a}`);
  }
  if (opts.skip.size > 0 && opts.mode === 'deploy') fail('--skip is only allowed with --check or --dry-run: a real deploy runs every gate');
  if (opts.preview) {
    if (explicitBranch) {
      if (PRODUCTION_BRANCHES.has(opts.branch.trim().toLowerCase())) {
        fail(`--preview cannot target production branch "${opts.branch}"; pass a non-production --branch <name>`);
      }
    } else {
      const gitBranch = (deps.currentGitBranch ?? (() => git(['rev-parse', '--abbrev-ref', 'HEAD'])))();
      opts.branch = sanitizePreviewBranch(gitBranch) ?? 'preview';
    }
  }
  if (!/^[A-Za-z0-9._/-]{1,100}$/.test(opts.branch)) fail(`invalid branch name "${opts.branch}"`);
  return opts;
}

export interface PagesDeployResult {
  environment?: string;
  productionBranch?: string;
  url?: string;
  alias?: string;
}

/**
 * Verifies that a Cloudflare Pages deployment triggered under `--preview` actually produced
 * a preview alias/URL rather than promoting or targeting the production environment/domain.
 */
export function assertPreviewPagesResult(
  result: PagesDeployResult,
  branch: string,
  productionOrigin: string = NAMES.pagesOrigin,
): string {
  if (result.environment && result.environment !== 'preview') {
    fail(`--preview deployed as Cloudflare Pages "${result.environment}" environment, not "preview"`);
  }
  if (result.productionBranch && result.productionBranch.toLowerCase() === branch.toLowerCase()) {
    fail(`--preview branch "${branch}" matches the Pages project's production branch "${result.productionBranch}"`);
  }
  const previewOrigin = result.alias ?? result.url;
  if (!previewOrigin) {
    fail('--preview deploy did not return a preview deployment URL or alias');
  }
  let targetUrl: URL;
  let prodUrl: URL;
  try {
    targetUrl = new URL(previewOrigin);
    prodUrl = new URL(productionOrigin);
  } catch {
    fail(`--preview deploy returned an invalid URL: "${previewOrigin}"`);
  }
  const targetHost = targetUrl.hostname.toLowerCase();
  const prodHost = prodUrl.hostname.toLowerCase();
  if (targetUrl.origin.toLowerCase() === prodUrl.origin.toLowerCase() || targetHost === prodHost) {
    fail(`--preview returned the production domain "${previewOrigin}" instead of a preview alias`);
  }
  if (targetUrl.protocol !== 'https:' || !targetHost.endsWith(`.${prodHost}`)) {
    fail(`--preview returned unexpected URL "${previewOrigin}" (expected an https://<preview>.${prodHost} alias)`);
  }
  return targetUrl.origin;
}

// ------------------------------------------------------------------------------------------------ process helpers

class StepFailure extends Error {}

function fail(message: string): never {
  throw new StepFailure(message);
}

function which(cmd: string, args = ['--version']): boolean {
  const r = spawnSync(cmd, args, { stdio: 'ignore', shell: false });
  return r.status === 0;
}

const NODE = which('node') ? 'node' : process.execPath;
const WRANGLER_JS = path.join(API, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const VITE_JS = path.join(GAME, 'node_modules', 'vite', 'bin', 'vite.js');

interface RunOptions {
  cwd?: string;
  env?: Record<string, string>;
  /** capture stdout (still echoed) instead of inheriting it */
  capture?: boolean;
  /** do not throw on a non-zero exit */
  allowFail?: boolean;
}

function show(cmd: string, args: string[], cwd: string): string {
  const tool = args[0] === WRANGLER_JS ? 'wrangler' : args[0] === VITE_JS ? 'vite' : null;
  const pretty = (tool ? [tool, ...args.slice(1)] : [cmd === NODE ? 'node' : cmd === process.execPath ? 'bun' : cmd, ...args])
    .map((s) => (/[\s"*]/.test(s) ? JSON.stringify(s) : s))
    .join(' ')
    .replaceAll(WRANGLER_JS, 'wrangler')
    .replaceAll(VITE_JS, 'vite')
    .replaceAll(ROOT + path.sep, '');
  return `${path.relative(ROOT, cwd) || '.'}$ ${pretty}`;
}

function run(cmd: string, args: string[], opts: RunOptions = {}): { status: number; stdout: string } {
  const cwd = opts.cwd ?? ROOT;
  console.log(`  ${dim(show(cmd, args, cwd))}`);
  const r = spawnSync(cmd, args, {
    cwd,
    env: { ...process.env, ...(opts.env ?? {}) },
    stdio: opts.capture ? ['inherit', 'pipe', 'inherit'] : 'inherit',
    encoding: 'utf8',
    shell: false,
    maxBuffer: 64 * 1024 * 1024,
  });
  const stdout = typeof r.stdout === 'string' ? r.stdout : '';
  if (opts.capture && stdout) process.stdout.write(stdout);
  const status = r.status ?? 1;
  if (r.error) fail(`${cmd}: ${r.error.message}`);
  if (status !== 0 && !opts.allowFail) fail(`exit code ${status}`);
  return { status, stdout };
}

const wrangler = (args: string[], opts: RunOptions = {}): { status: number; stdout: string } => run(NODE, [WRANGLER_JS, ...args], opts);
const bun = (args: string[], opts: RunOptions = {}): { status: number; stdout: string } => run(process.execPath, args, opts);

function git(args: string[]): string {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '';
}

const tty = process.stdout.isTTY;
const dim = (s: string): string => (tty ? `\x1b[2m${s}\x1b[0m` : s);
const bold = (s: string): string => (tty ? `\x1b[1m${s}\x1b[0m` : s);
const red = (s: string): string => (tty ? `\x1b[31m${s}\x1b[0m` : s);
const green = (s: string): string => (tty ? `\x1b[32m${s}\x1b[0m` : s);
const yellow = (s: string): string => (tty ? `\x1b[33m${s}\x1b[0m` : s);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const toPosix = (p: string): string => p.split(path.sep).join('/');

function readWranglerOutput(file: string): Record<string, unknown>[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as Record<string, unknown>];
      } catch {
        return [];
      }
    });
}

// ------------------------------------------------------------------------------------------------ steps

interface Step {
  id: string;
  title: string;
  remote: boolean;
  /** advisory: a failure is reported as a warning and the pipeline continues */
  soft?: boolean;
  /** remote steps: the commands a dry run prints instead of running them */
  plan?: (ctx: Context) => string[];
  run: (ctx: Context) => Promise<string | void> | string | void;
}

interface Context {
  opts: Options;
  tmp: string;
  warnings: string[];
  workerUrl?: string;
  pagesUrl?: string;
  pagesAlias?: string;
  migrationFiles?: MigrationFile[];
}

const lockPath = path.join(API, 'migrations.lock.json');
const migrationsDir = path.join(API, 'migrations');

async function loadMigrations(): Promise<MigrationFile[]> {
  return Promise.all(
    readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => migrationFile(f, readFileSync(path.join(migrationsDir, f), 'utf8'))),
  );
}

const STEPS: Step[] = [
  {
    id: 'preflight',
    title: 'Preflight: tools, configuration, git state',
    remote: false,
    run(ctx) {
      const required = [
        path.join(GAME, 'wrangler.toml'),
        path.join(GAME, 'functions', 'api', '[[path]].ts'),
        path.join(GAME, 'public', '_headers'),
        path.join(GAME, 'public', '_routes.json'),
        path.join(API, 'wrangler.toml'),
        lockPath,
        WRANGLER_JS,
        VITE_JS,
      ];
      for (const f of required) if (!existsSync(f)) fail(`missing ${path.relative(ROOT, f)} (run \`bun install\`?)`);
      const versions = [`bun ${Bun.version}`, `node ${NODE === 'node' ? spawnSync('node', ['--version'], { encoding: 'utf8' }).stdout.trim() : '(bun)'}`];
      versions.push(`wrangler ${JSON.parse(readFileSync(path.join(API, 'node_modules', 'wrangler', 'package.json'), 'utf8')).version as string}`);
      const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
      const commit = git(['rev-parse', '--short', 'HEAD']);
      const dirty = git(['status', '--porcelain']).split('\n').filter(Boolean).length;
      console.log(`  ${versions.join(' · ')}`);
      console.log(`  git ${branch}@${commit}${dirty ? `, ${dirty} uncommitted change(s)` : ', clean'} → Pages branch "${ctx.opts.branch}"${ctx.opts.preview ? ' (preview)' : ''}`);
      console.log(`  build output ${path.relative(ROOT, ctx.opts.outDir)}${process.env.VITE_API_BASE ? ` · VITE_API_BASE=${process.env.VITE_API_BASE}` : ' · API same-origin via the Pages Function'}`);
      if (dirty) {
        const msg = `the work tree has ${dirty} uncommitted change(s): release from a commit (or pass --allow-dirty)`;
        if (ctx.opts.mode === 'deploy' && !ctx.opts.allowDirty) fail(msg);
        ctx.warnings.push(msg);
      }
    },
  },
  {
    id: 'audit',
    title: 'Clean-room asset audit (source assets): no forbidden extensions or provenance markers',
    remote: false,
    run() {
      bun([path.join('scripts', 'cleanRoomAudit.ts'), '--scan', path.join('apps', 'game', 'public', 'assets')]);
    },
  },
  {
    id: 'manifest',
    title: 'Asset manifest (tools/pipeline/manifest.ts)',
    remote: false,
    run() {
      bun([path.join('tools', 'pipeline', 'manifest.ts')]);
    },
  },
  {
    id: 'typecheck',
    title: 'Typecheck (all workspaces)',
    remote: false,
    run() {
      bun(['run', 'typecheck']);
    },
  },
  {
    id: 'test',
    title: 'Tests (all workspaces)',
    remote: false,
    run() {
      bun(['run', 'test']);
    },
  },
  {
    id: 'migrations',
    title: 'D1 migrations: names, order, lock (no applied migration edited)',
    remote: false,
    async run(ctx) {
      const files = await loadMigrations();
      const problems = checkMigrations(files, parseLock(readFileSync(lockPath, 'utf8')));
      if (problems.length > 0) fail(`migrations.lock.json:\n    ${problems.join('\n    ')}`);
      ctx.migrationFiles = files;
      const lock = parseLock(readFileSync(lockPath, 'utf8'));
      const pending = files.filter((f) => !(f.name in lock.applied)).map((f) => f.name);
      return `${files.length} migration(s), ${pending.length ? `not yet applied remotely: ${pending.join(', ')}` : 'all applied remotely'}`;
    },
  },
  {
    id: 'build',
    title: 'Strict production build (MS_STRICT_ASSETS=1, no source maps)',
    remote: false,
    run(ctx) {
      run(NODE, [VITE_JS, 'build', '--outDir', ctx.opts.outDir, '--emptyOutDir', '--sourcemap', 'false'], { cwd: GAME, env: { MS_STRICT_ASSETS: '1' } });
    },
  },
  {
    id: 'site',
    title: 'Built site vs the Pages contract (headers, routes, hashed names, maps, limits)',
    remote: false,
    run(ctx) {
      return checkSite(ctx);
    },
  },
  {
    id: 'payload',
    title: 'Payload budgets on the built site (tools/qa/payload.ts: menu < 6 MB, zone < 20 MB), blocking',
    remote: false,
    run(ctx) {
      // PLAN.md / ARCHITECTURE §11. The tool exits 1 when a budget is missed or the session did not complete (page error,
      // failed request) and 2 when there is no build; a release must not ship on a number nobody measured.
      const tool = path.join(ROOT, 'tools', 'qa', 'payload.ts');
      if (!existsSync(tool)) fail('tools/qa/payload.ts is missing: the payload budgets cannot be measured');
      // --tail 20: the session runs 20 s past the gated window so the report also shows the background streaming and the zone
      // music starting (it is due HUD + 9 s); only the menu and zone windows are gated
      const r = bun([tool, '--dist', ctx.opts.outDir, '--out', path.join(ctx.tmp, 'payload'), '--tail', '20'], { capture: true, allowFail: true });
      const line = r.stdout.split(/\r?\n/).find((l) => /^menu (PASS|FAIL)/.test(l))?.trim();
      if (r.status === 0) return line;
      // a build that does not come up says why (first page / console error) before the (meaningless) budget line
      const boot = r.stdout.split(/\r?\n/).find((l) => l.startsWith('BOOT FAILED'))?.trim();
      const why = `payload gate failed (exit ${r.status})${boot ? `: ${boot}` : line ? `: ${line}` : ''}; details in ${path.relative(ROOT, path.join(ctx.tmp, 'payload'))}`;
      if (ctx.opts.allowOverBudget) {
        ctx.warnings.push(`${why} - shipping anyway (--allow-over-budget)`);
        return `OVER BUDGET, allowed by --allow-over-budget${line ? `: ${line}` : ''}`;
      }
      fail(`${why}\n    cut the payload (docs/ARCHITECTURE.md §11) or, knowingly, pass --allow-over-budget`);
    },
  },
  {
    id: 'audit-dist',
    title: 'Clean-room asset audit (built site)',
    remote: false,
    run(ctx) {
      bun([path.join('scripts', 'cleanRoomAudit.ts'), '--scan', ctx.opts.outDir]);
    },
  },
  {
    id: 'bundle',
    title: 'Bundle the Worker and the Pages Function locally (wrangler --dry-run)',
    remote: false,
    run(ctx) {
      wrangler(['deploy', '--dry-run', '--outdir', path.join(ctx.tmp, 'worker')], { cwd: API });
      wrangler(['pages', 'functions', 'build', '--outdir', path.join(ctx.tmp, 'functions'), '--output-routes-path', path.join(ctx.tmp, 'functions-routes.json')], { cwd: GAME });
      const generated = JSON.parse(readFileSync(path.join(ctx.tmp, 'functions-routes.json'), 'utf8')) as { include: string[] };
      if (!generated.include.includes('/api/*')) fail(`the Pages Functions no longer cover /api/* (routes: ${generated.include.join(', ')})`);
    },
  },
  {
    id: 'd1',
    title: `D1: apply pending migrations to ${NAMES.d1} (export first), record them in migrations.lock.json`,
    remote: true,
    plan: (ctx) =>
      ctx.opts.preview
        ? ['(skipped in --preview mode: preview deployments never touch production D1)']
        : [
            `workers/api$ wrangler d1 migrations list ${NAMES.d1} --remote`,
            `workers/api$ wrangler d1 export ${NAMES.d1} --remote --output workers/api/.wrangler/backups/${NAMES.d1}-<time>.sql   (only when the database already has migrations)`,
            `workers/api$ wrangler d1 migrations apply ${NAMES.d1} --remote`,
            'write workers/api/migrations.lock.json (applied migrations + sha256)',
          ],
    async run(ctx) {
      if (ctx.opts.preview) return 'skipped in --preview mode (production D1 untouched)';
      const list = wrangler(['d1', 'migrations', 'list', NAMES.d1, '--remote'], { cwd: API, capture: true });
      const pending = [...new Set(list.stdout.match(/\d{4}_[a-z0-9_]+\.sql/g) ?? [])];
      if (pending.length === 0) return 'no pending migrations';
      const files = ctx.migrationFiles ?? (await loadMigrations());
      const fresh = pending.length === files.length;
      if (ctx.opts.backup && !fresh) {
        const dir = path.join(API, '.wrangler', 'backups');
        mkdirSync(dir, { recursive: true });
        const out = path.join(dir, `${NAMES.d1}-${new Date().toISOString().replace(/[:.]/g, '-')}.sql`);
        wrangler(['d1', 'export', NAMES.d1, '--remote', '--output', out], { cwd: API });
        console.log(`  backup: ${path.relative(ROOT, out)}`);
      }
      wrangler(['d1', 'migrations', 'apply', NAMES.d1, '--remote'], { cwd: API });
      const lock = recordApplied(parseLock(readFileSync(lockPath, 'utf8')), files, new Date());
      writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
      ctx.warnings.push(`commit workers/api/migrations.lock.json (now records ${Object.keys(lock.applied).length} applied migration(s))`);
      return `applied ${pending.join(', ')}`;
    },
  },
  {
    id: 'worker',
    title: `Worker: deploy ${NAMES.worker}`,
    remote: true,
    plan: (ctx) =>
      ctx.opts.preview
        ? ['(skipped in --preview mode: preview deployments never deploy the production Worker)']
        : ['workers/api$ wrangler deploy', 'workers/api$ wrangler secret list   (warns when IP_HASH_SECRET is not set)'],
    run(ctx) {
      if (ctx.opts.preview) return 'skipped in --preview mode (production Worker untouched)';
      const out = path.join(ctx.tmp, 'wrangler-worker.ndjson');
      wrangler(['deploy'], { cwd: API, env: { WRANGLER_OUTPUT_FILE_PATH: out } });
      const deploy = readWranglerOutput(out).find((e) => e.type === 'deploy');
      const targets = (deploy?.targets as string[] | undefined) ?? [];
      ctx.workerUrl = targets.find((t) => t.includes('workers.dev'));
      // names only (wrangler never prints secret values)
      const secrets = wrangler(['secret', 'list', '--format', 'json'], { cwd: API, capture: true, allowFail: true });
      if (!secrets.stdout.includes('"IP_HASH_SECRET"')) {
        ctx.warnings.push('IP_HASH_SECRET is not set: rate-counter IP hashes are unkeyed (cd workers/api && bunx wrangler secret put IP_HASH_SECRET)');
      }
      return targets.length ? `live at ${targets.join(', ')}` : undefined;
    },
  },
  {
    id: 'pages',
    title: `Pages: deploy ${NAMES.pagesProject} (static site + /api proxy Function)`,
    remote: true,
    plan: (ctx) => [
      `apps/game$ wrangler pages deploy ${toPosix(path.relative(GAME, ctx.opts.outDir)) || '.'} --project-name ${NAMES.pagesProject} --branch ${ctx.opts.branch} --commit-dirty=true`,
      ...(ctx.opts.preview ? [] : ['(again on the production branch if Cloudflare reports a preview deployment)']),
    ],
    run(ctx) {
      const deployPages = (branch: string): { environment?: string; productionBranch?: string; url?: string; alias?: string } => {
        const out = path.join(ctx.tmp, `wrangler-pages-${branch.replace(/[^A-Za-z0-9]/g, '_')}.ndjson`);
        wrangler(['pages', 'deploy', ctx.opts.outDir, '--project-name', NAMES.pagesProject, '--branch', branch, '--commit-dirty=true'], {
          cwd: GAME,
          env: { WRANGLER_OUTPUT_FILE_PATH: out },
        });
        const d = readWranglerOutput(out).find((e) => e.type === 'pages-deploy-detailed') ?? {};
        return {
          environment: d.environment as string | undefined,
          productionBranch: d.production_branch as string | undefined,
          url: d.url as string | undefined,
          alias: d.alias as string | undefined,
        };
      };
      let result = deployPages(ctx.opts.branch);
      if (ctx.opts.preview) {
        assertPreviewPagesResult(result, ctx.opts.branch);
      } else {
        if (result.environment === 'preview' && result.productionBranch && result.productionBranch !== ctx.opts.branch) {
          console.log(yellow(`  the project's production branch is "${result.productionBranch}", not "${ctx.opts.branch}": deploying again as production`));
          ctx.warnings.push(`set PAGES_BRANCH=${result.productionBranch} (the Pages project's production branch) to skip the extra preview upload`);
          result = deployPages(result.productionBranch);
        }
        if (result.environment && result.environment !== 'production') fail(`Pages deployed as ${result.environment}, not production`);
      }
      ctx.pagesUrl = result.url;
      ctx.pagesAlias = result.alias;
      return `${result.environment ?? 'deployed'}: ${[result.url, result.alias].filter(Boolean).join(' · ')}`;
    },
  },
  {
    id: 'smoke',
    title: 'Smoke test (read-only): site + headers + /api/v1/health through the proxy',
    remote: true,
    plan: (ctx) => {
      const origin = ctx.opts.preview ? '<preview alias>' : NAMES.customOrigin;
      return ctx.opts.preview
        ? [`GET ${origin}/ (new index.html + Content-Security-Policy)`, `GET ${origin}/api/v1/health (503 unavailable: preview isolated from production backend)`]
        : [`GET ${origin}/ (new index.html + Content-Security-Policy)`, `GET ${origin}/api/v1/health (200, ok: true)`];
    },
    async run(ctx) {
      const origin = ctx.opts.preview ? (ctx.pagesAlias ?? ctx.pagesUrl) : NAMES.customOrigin;
      if (!origin) fail('no deployment URL to test');
      const built = readFileSync(path.join(ctx.opts.outDir, 'index.html'), 'utf8').match(/assets\/index-[\w-]+\.js/)?.[0];
      let lastError = '';
      // the new deployment can take a few seconds to reach every edge
      for (let attempt = 0; attempt < 10; attempt++) {
        try {
          const page = await fetch(`${origin}/`, { headers: { 'cache-control': 'no-cache' } });
          const html = await page.text();
          if (page.status !== 200) throw new Error(`GET / → ${page.status}`);
          if (built && !html.includes(built)) throw new Error(`GET / serves an older build (expected ${built})`);
          if (!page.headers.get('content-security-policy')) throw new Error('GET / has no Content-Security-Policy (_headers not applied?)');
          const health = await fetch(`${origin}/api/v1/health`);
          if (ctx.opts.preview) {
            if (health.status !== 503) throw new Error(`preview GET /api/v1/health → ${health.status} (expected 503: preview must not bind production API)`);
            return `${origin} serves ${built ?? 'the new build'}; preview isolated from production API (503)`;
          }
          const body = (await health.json().catch(() => null)) as { ok?: boolean; clientIp?: boolean } | null;
          if (health.status !== 200 || body?.ok !== true) throw new Error(`GET /api/v1/health → ${health.status} ${JSON.stringify(body)}`);
          if (body.clientIp === false) {
            // per-IP rate limits would collapse into one shared bucket: stop here (workaround: VITE_API_BASE=<workers.dev URL>)
            fail('the Worker does not receive the client address through the Pages proxy (health.clientIp=false)');
          }
          return `${origin} serves ${built ?? 'the new build'}; API healthy through the proxy, client address preserved`;
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
          await Bun.sleep(3000);
        }
      }
      fail(`${origin}: ${lastError}`);
    },
  },
];

// ------------------------------------------------------------------------------------------------ site contract

function checkSite(ctx: Context): string {
  const dir = ctx.opts.outDir;
  if (!existsSync(path.join(dir, 'index.html'))) fail(`${dir} has no index.html`);
  const files = walk(dir);
  const rel = files.map((f) => toPosix(path.relative(dir, f)));

  // Pages limits
  if (files.length > PAGES_MAX_FILES) fail(`${files.length} files, Pages allows ${PAGES_MAX_FILES}`);
  let bytes = 0;
  for (const f of files) {
    const size = statSync(f).size;
    bytes += size;
    if (size > PAGES_MAX_FILE_BYTES) fail(`${toPosix(path.relative(dir, f))} is ${(size / 1048576).toFixed(1)} MiB, Pages allows 25 MiB per file`);
  }

  // special files
  for (const f of ['_headers', '_routes.json']) if (!rel.includes(f)) fail(`${f} missing from the build output (apps/game/public/${f})`);
  const routes = JSON.parse(readFileSync(path.join(dir, '_routes.json'), 'utf8')) as { version: number; include: string[]; exclude: string[] };
  if (routes.version !== 1 || JSON.stringify(routes.include) !== JSON.stringify(['/api/*'])) fail('_routes.json must route exactly /api/* to the Function');

  // the asset manifest the game loads first must agree with the files of this build. The strict build checks public/ when it
  // starts, but public/ is copied seconds later: a producer that ships in between leaves a manifest naming a deleted file.
  const consistency = checkDistManifest(dir);
  if (consistency.missing.length > 0) {
    fail(`dist/assets/manifest.json names ${consistency.missing.length} file(s) that are not in the build (an asset producer shipped while the build ran? build again):\n    ${consistency.missing.slice(0, 20).join('\n    ')}`);
  }
  if (consistency.orphans.length > 0) {
    ctx.warnings.push(`${consistency.orphans.length} file(s) under assets/ are referenced by nothing (stale producer output): ${consistency.orphans.slice(0, 3).join(', ')}${consistency.orphans.length > 3 ? ', ...' : ''}`);
  }

  // the emitted JS chunks must not import each other in a cycle: the vfx group once split itself into chunks that did, the
  // build printed nothing and the production boot died before the menu ('reading smoke0'). scripts/chunkGraph.ts is the same
  // check the strict build runs.
  const chunkGraph = checkChunkGraph(dir);
  if (chunkGraph.cycles.length > 0) {
    fail(`the emitted JS chunks import each other in a cycle (the boot dies before the menu):\n    ${formatCycles(chunkGraph.cycles).join('\n    ')}\n    split the chunk group along a module boundary with no back edge (docs/ARCHITECTURE.md §11)`);
  }
  const biggest = chunkGraph.largest[0];
  if (biggest && biggest.bytes > CHUNK_WARN_BYTES) {
    ctx.warnings.push(`${biggest.file} is ${(biggest.bytes / 1000).toFixed(0)} kB, over the ${CHUNK_WARN_BYTES / 1000} kB chunk-size limit (lazy per-class vfx chunks: docs/ARCHITECTURE.md §11)`);
  }

  // immutable caching is only safe for content-hashed names
  const MANIFESTS = /^assets\/manifest(\.json|\/[^/]+\.json)$/;
  const HASHED = /(\.[0-9a-f]{6,}\.[a-z0-9]+|-[A-Za-z0-9_-]{8}\.[a-z0-9]+)$/;
  const unhashed = rel.filter((r) => r.startsWith('assets/') && !MANIFESTS.test(r) && !HASHED.test(r));
  if (unhashed.length > 0) fail(`files under /assets are served immutable but have no content hash:\n    ${unhashed.slice(0, 20).join('\n    ')}`);

  // no source maps (they would publish the full TypeScript sources)
  const maps = rel.filter((r) => r.endsWith('.map'));
  if (maps.length > 0) fail(`source maps in the build output: ${maps.slice(0, 5).join(', ')}`);
  for (const f of files.filter((p) => /\.(js|css)$/.test(p))) {
    if (/sourceMappingURL=/.test(readFileSync(f, 'utf8').slice(-400))) fail(`${toPosix(path.relative(dir, f))} references a source map`);
  }

  // index.html: no inline scripts (the CSP has no 'unsafe-inline' for scripts), entry chunk is hashed
  const html = readFileSync(path.join(dir, 'index.html'), 'utf8');
  if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html)) fail('index.html has an inline <script>: the CSP blocks it');
  if (!/<script[^>]+src="\/assets\/index-[\w-]+\.js"/.test(html)) fail('index.html does not load a hashed /assets/index-*.js entry');

  // CSP: an absolute VITE_API_BASE (e.g. the workers.dev URL) must be allowed by connect-src
  const apiBase = process.env.VITE_API_BASE?.trim();
  let cspNote = 'API same-origin';
  if (apiBase && /^https?:\/\//i.test(apiBase)) {
    const api = new URL(apiBase);
    const ws = `${api.protocol === 'https:' ? 'wss' : 'ws'}://${api.host}`;
    const headersPath = path.join(dir, '_headers');
    const text = readFileSync(headersPath, 'utf8');
    // only the Content-Security-Policy header line (comments mention connect-src too)
    const patched = text
      .split('\n')
      .map((line) => (/^\s+Content-Security-Policy\s*:/i.test(line) ? line.replace(/(connect-src [^;]*)/, `$1 ${api.origin} ${ws}`) : line))
      .join('\n');
    if (patched === text) fail('_headers: no connect-src directive to extend with VITE_API_BASE');
    writeFileSync(headersPath, patched);
    cspNote = `connect-src += ${api.origin} ${ws}`;
  }
  return `${files.length} files, ${(bytes / 1048576).toFixed(1)} MiB, largest ≤ 25 MiB, ${rel.filter((r) => r.startsWith('assets/')).length} hashed /assets files, no maps, manifest ↔ build consistent (${consistency.referenced} files named, ${consistency.orphans.length} orphans), ${chunkGraph.chunks} JS files without an import cycle (largest ${biggest ? `${(biggest.bytes / 1000).toFixed(0)} kB` : 'n/a'}) · ${cspNote}`;
}

// ------------------------------------------------------------------------------------------------ main

async function main(): Promise<number> {
  const opts = parseArgs(process.argv.slice(2));
  const tmp = path.join(API, '.wrangler', 'deploy-tmp');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const ctx: Context = { opts, tmp, warnings: [] };
  const label = { deploy: 'DEPLOY', 'dry-run': 'DRY RUN (nothing remote is touched)', check: 'CHECK (local gates only)' }[opts.mode];
  console.log(bold(`\nMetin Survivors release — ${label}`));
  console.log(dim(`Pages ${NAMES.pagesProject} · Worker ${NAMES.worker} · D1 ${NAMES.d1} · R2 ${NAMES.r2} · DO ${NAMES.durableObject}\n`));

  const results: { step: Step; status: 'ok' | 'warn' | 'skipped' | 'dry' | 'failed' | 'not run'; note?: string; ms: number }[] = [];
  let failed = false;
  for (const [i, step] of STEPS.entries()) {
    const n = `${String(i + 1).padStart(2)}/${STEPS.length}`;
    if (failed) {
      results.push({ step, status: 'not run', ms: 0 });
      continue;
    }
    console.log(bold(`${n} ${step.title}`) + (step.remote ? yellow('  [remote]') : ''));
    if (opts.skip.has(step.id)) {
      console.log(yellow(`  skipped (--skip=${step.id})\n`));
      results.push({ step, status: 'skipped', ms: 0 });
      continue;
    }
    if (step.remote && opts.mode !== 'deploy') {
      if (opts.mode === 'dry-run') for (const line of step.plan?.(ctx) ?? []) console.log(`  ${dim('would run:')} ${line}`);
      console.log(dim(`  ${opts.mode === 'dry-run' ? 'dry run: nothing was sent to Cloudflare' : 'check: remote step skipped'}\n`));
      results.push({ step, status: 'dry', ms: 0 });
      continue;
    }
    const t0 = performance.now();
    try {
      const note = await step.run(ctx);
      const ms = performance.now() - t0;
      console.log(green(`  ✓ ${note ? note : 'ok'}`) + dim(`  (${(ms / 1000).toFixed(1)} s)\n`));
      results.push({ step, status: 'ok', ms, ...(note ? { note } : {}) });
    } catch (e) {
      const ms = performance.now() - t0;
      const message = e instanceof Error ? e.message : String(e);
      if (step.soft) {
        console.log(yellow(`  ! ${message} (advisory step: continuing)\n`));
        results.push({ step, status: 'warn', note: message, ms });
        ctx.warnings.push(`${step.id}: ${message.split('\n')[0]}`);
        continue;
      }
      console.log(red(`  ✗ ${message}\n`));
      results.push({ step, status: 'failed', note: message, ms });
      failed = true;
    }
  }

  console.log(bold('Summary'));
  for (const r of results) {
    const mark = { ok: green('ok     '), warn: yellow('WARN   '), skipped: yellow('SKIPPED'), dry: dim('remote '), failed: red('FAILED '), 'not run': dim('not run') }[r.status];
    console.log(`  ${mark} ${r.step.id.padEnd(10)} ${r.status === 'dry' ? dim(opts.mode === 'dry-run' ? 'would run (dry run)' : 'skipped (check)') : (r.note ?? '').split('\n')[0]}`);
  }
  for (const w of ctx.warnings) console.log(yellow(`  ! ${w}`));
  if (failed) {
    console.log(red(bold('\nFAILED — nothing after the failed step ran.')));
    return 1;
  }
  if (opts.skip.size > 0) {
    console.log(yellow(bold(`\nINCOMPLETE — skipped: ${[...opts.skip].join(', ')}. This is not a green release check.`)));
    return 2;
  }
  const deployedTarget = opts.preview ? (ctx.pagesAlias ?? ctx.pagesUrl ?? '<preview>') : NAMES.customOrigin;
  console.log(green(bold(opts.mode === 'deploy' ? `\nDeployed: ${deployedTarget}` : '\nAll local gates passed.')));
  return 0;
}

if (import.meta.main) {
  try {
    process.exit(await main());
  } catch (e) {
    console.error(red(e instanceof Error ? e.message : String(e)));
    process.exit(1);
  }
}
