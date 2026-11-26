// Content access for the app. Production: the CONTENT agent's loader (src/data/loader.ts → `loadContent`).
// DEV fallback while content is being authored: the sim's fixture ContentDB.
import type { ContentDB } from '../data/schema';

interface LoaderModule {
  loadContent: () => Promise<ContentDB> | ContentDB;
}

function isLoader(m: unknown): m is LoaderModule {
  return typeof m === 'object' && m !== null && 'loadContent' in m && typeof m.loadContent === 'function';
}

let cached: Promise<ContentDB> | null = null;

export function loadContent(): Promise<ContentDB> {
  if (!cached) {
    const p = resolve();
    cached = p;
    p.catch(() => {
      if (cached === p) cached = null;
    });
  }
  return cached;
}

/**
 * QA content override (tools/qa/shot.ts --content, src/data/override.ts): systems that ship switched off in content stay playable
 * for captures and browser runs. `globalThis.__MS_CONTENT_OVERRIDE__` (a JSON object or its text) must be set before boot
 * (page.addInitScript). Called only behind the DEV / VITE_QA_HOOKS condition in resolve(), so a plain production build drops this
 * function, the override module and the string (the minified production code is the same as without this hook).
 */
async function withQaOverride(loading: Promise<ContentDB> | ContentDB): Promise<ContentDB> {
  const db = await loading;
  const arg = (globalThis as { __MS_CONTENT_OVERRIDE__?: unknown }).__MS_CONTENT_OVERRIDE__;
  if (arg !== undefined && arg !== null && arg !== '') {
    const { applyContentOverrideDetailed, describeOverride } = await import('../data/override');
    const patch: unknown = typeof arg === 'string' ? JSON.parse(arg) : arg;
    console.info(`[content] QA override applied, ${describeOverride(applyContentOverrideDetailed(db, patch))}`);
  }
  return db;
}

async function resolve(): Promise<ContentDB> {
  // Optional module: glob resolves at build time, so a missing loader is simply an empty map.
  const loaders = import.meta.glob('../data/loader.ts');
  const load = loaders['../data/loader.ts'];
  if (load) {
    const mod: unknown = await load();
    if (isLoader(mod)) {
      // only the dev server and the frozen QA snapshot build (VITE_QA_HOOKS=1, like window.__ms in app.ts) read the override
      if (import.meta.env.DEV || import.meta.env.VITE_QA_HOOKS === '1') return withQaOverride(mod.loadContent());
      return mod.loadContent();
    }
    throw new Error('src/data/loader.ts must export loadContent(): Promise<ContentDB>');
  }
  if (import.meta.env.DEV) {
    // DEV only, selected at runtime on purpose: the fixtures must never reach a production bundle.
    const fx = await import('../sim/__fixtures__/content');
    return fx.fixtureContent;
  }
  throw new Error('content loader missing (src/data/loader.ts)');
}
