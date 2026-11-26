// Built-site asset consistency: the merged asset manifest the game loads first (dist/assets/manifest.json) against the files
// of the build. Shared by scripts/deploy.ts (checkSite) and the strict-assets plugin of apps/game/vite.config.ts (writeBundle).
//
// Why it exists: the strict check of a build runs against public/ when the build starts, but public/ is copied into the output
// several seconds later. An asset producer that ships in between (a re-hashed file plus its manifest part) leaves a build whose
// manifest names a file that was deleted from the copy - the game then 404s on it. The only reliable check is on the output.
//
//   missing  the manifest names a file that is not in the build        -> the build is broken (fail)
//   orphans  a hashed file under assets/<dir>/ that nothing references -> dead weight shipped for nothing (warn)
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export interface DistManifestReport {
  /** distinct file URLs ("assets/...") the manifest names */
  referenced: number;
  /** "<manifest path>: <url>" for every named file that is not in the build */
  missing: string[];
  /** build files under assets/<subdir>/ that neither the manifest nor any built script / style / page mentions */
  orphans: string[];
}

const TEXT_EXT = /\.(js|css|html|json)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** every string value of `node` that is a build-relative file URL, with the JSON path it was found at */
function collectUrls(node: unknown, at: string, out: Map<string, string>): void {
  if (typeof node === 'string') {
    if (/^assets\/[^\s?#]+\.[A-Za-z0-9]+$/.test(node) && !out.has(node)) out.set(node, at);
  } else if (Array.isArray(node)) {
    node.forEach((v, i) => collectUrls(v, `${at}[${i}]`, out));
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) collectUrls(v, at ? `${at}.${k}` : k, out);
  }
}

/** Throws when the manifest cannot be read at all; otherwise reports what is missing / orphaned. */
export function checkDistManifest(dist: string): DistManifestReport {
  const manifestFile = path.join(dist, 'assets', 'manifest.json');
  if (!existsSync(manifestFile)) return { referenced: 0, missing: ['assets/manifest.json: the game loads it first and it is not in the build'], orphans: [] };
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  } catch (e) {
    throw new Error(`dist/assets/manifest.json is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const urls = new Map<string, string>();
  collectUrls(manifest, '', urls);
  const missing: string[] = [];
  for (const [url, at] of urls) {
    const f = path.join(dist, url);
    if (!existsSync(f) || !statSync(f).isFile()) missing.push(`${at}: ${url}`);
  }

  // candidates: files inside a subdirectory of assets/ (the built scripts / styles sit directly in assets/), except the manifest
  // itself and its producer parts, which the game never reads in a build
  const assetsDir = path.join(dist, 'assets');
  const candidates = walk(assetsDir)
    .map((f) => path.relative(dist, f).split(path.sep).join('/'))
    .filter((r) => r.split('/').length > 2 && !r.startsWith('assets/manifest/') && !urls.has(r));
  const orphans: string[] = [];
  if (candidates.length > 0) {
    // a file the CSS / scripts / pages name directly (a ui sprite in a stylesheet, a worker's data) is not an orphan
    const corpus = walk(dist)
      .filter((f) => TEXT_EXT.test(f) && !/[\\/]assets[\\/]manifest(\.json|[\\/])/.test(f))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    for (const r of candidates) if (!corpus.includes(r) && !corpus.includes(r.slice(r.lastIndexOf('/') + 1))) orphans.push(r);
  }
  return { referenced: urls.size, missing, orphans: orphans.sort() };
}

// CLI (used by the strict-assets plugin of apps/game/vite.config.ts): bun scripts/distManifest.ts <dist dir>
// prints the report as JSON; exit 1 when the manifest names a file the build does not have, 2 when it cannot be read.
if (import.meta.main) {
  const dist = path.resolve(process.argv[2] ?? 'apps/game/dist');
  try {
    const report = checkDistManifest(dist);
    console.log(JSON.stringify(report));
    process.exit(report.missing.length > 0 ? 1 : 0);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
}
