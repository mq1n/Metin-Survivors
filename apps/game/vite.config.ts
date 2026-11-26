import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import preact from '@preact/preset-vite';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

interface ManifestPart {
  url?: string;
  normalUrl?: string;
  variants?: string[];
}

/**
 * Production gate (MS_STRICT_ASSETS=1, set by `bun run deploy`): the merged manifest must exist, contain models, and every
 * file it references must exist under public/ (buildStart) and, once public/ was copied, in the build output (writeBundle).
 * DEV placeholders are never an acceptable fallback in a shipped build.
 */
function strictAssets(): Plugin {
  let outDir = '';
  return {
    name: 'ms-strict-assets',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    buildStart() {
      if (process.env.MS_STRICT_ASSETS !== '1') return;
      const manifestPath = resolve(root, 'public/assets/manifest.json');
      if (!existsSync(manifestPath)) {
        this.error('MS_STRICT_ASSETS: public/assets/manifest.json is missing — run `bun tools/pipeline/manifest.ts` first');
      }
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, Record<string, ManifestPart> | string>;
      const models = manifest.models;
      if (typeof models === 'string' || !models || Object.keys(models).length === 0) {
        this.error('MS_STRICT_ASSETS: manifest has no models');
      }
      const missing: string[] = [];
      for (const group of ['models', 'textures', 'icons', 'audio'] as const) {
        const entries = manifest[group];
        if (typeof entries === 'string' || !entries) continue;
        for (const [id, e] of Object.entries(entries)) {
          for (const u of [e.url, e.normalUrl, ...(e.variants ?? [])]) {
            if (u && !existsSync(resolve(root, 'public', u))) missing.push(`${group}/${id}: ${u}`);
          }
        }
      }
      if (missing.length > 0) {
        this.error(`MS_STRICT_ASSETS: ${missing.length} manifest file(s) missing:\n  ${missing.slice(0, 20).join('\n  ')}`);
      }
      // every asset id the content references must exist in the manifest (lists them all, grouped by kind)
      const gate = spawnSync('bun', [resolve(root, 'src/dev/checkAssets.ts')], { encoding: 'utf8' });
      if (gate.status !== 0) this.error(`MS_STRICT_ASSETS: content references assets missing from the manifest:\n${gate.stdout}${gate.stderr}`);
    },
    // public/ is copied into the output seconds after buildStart. An asset producer that ships in between (a re-hashed file
    // plus its manifest part) would leave a build whose manifest names a deleted file (seen: vfx_hit_flame, a 404 in the
    // zone load). The output is what ships, so it is checked again here.
    writeBundle() {
      const strict = process.env.MS_STRICT_ASSETS === '1';
      // Emitted chunks must not statically import each other in a cycle (one implementation shared with scripts/deploy.ts:
      // scripts/chunkGraph.ts, prints a JSON report). A cycle boots as 'Cannot read properties of undefined' before the menu
      // (prod3: the vfx maxSize split), so any build reports it; the strict build fails on it.
      const graph = spawnSync('bun', [resolve(root, '../../scripts/chunkGraph.ts'), outDir], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
      let chunks: { cycles: string[][] } | null = null;
      try {
        chunks = JSON.parse(graph.stdout) as { cycles: string[][] };
      } catch {
        /* reported below */
      }
      if (!chunks) {
        if (strict) this.error(`MS_STRICT_ASSETS: the chunk-cycle check did not run (exit ${String(graph.status)}):\n${graph.stdout}${graph.stderr}`);
      } else if (chunks.cycles.length > 0) {
        const message = `${chunks.cycles.length} static import cycle(s) between the emitted JS chunks (the production boot dies before the menu when a module reads an export of the other chunk at load time):\n  ${chunks.cycles.map((c) => c.join(' -> ')).join('\n  ')}\n  a chunk group with maxSize splits itself like this: split along a module boundary with no back edge instead (docs/ARCHITECTURE.md §11)`;
        if (strict) this.error(`MS_STRICT_ASSETS: ${message}`);
        else this.warn(message);
      }
      if (!strict) return;
      // the same check scripts/deploy.ts runs on the site (one implementation: scripts/distManifest.ts, prints a JSON report)
      const run = spawnSync('bun', [resolve(root, '../../scripts/distManifest.ts'), outDir], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
      let report: { missing: string[]; orphans: string[] } | null = null;
      try {
        report = JSON.parse(run.stdout) as { missing: string[]; orphans: string[] };
      } catch {
        /* reported below */
      }
      if (!report) this.error(`MS_STRICT_ASSETS: the built-manifest check did not run (exit ${String(run.status)}):\n${run.stdout}${run.stderr}`);
      if (report.missing.length > 0) {
        this.error(`MS_STRICT_ASSETS: the built manifest names ${report.missing.length} file(s) that are not in the build (an asset producer shipped while the build ran? build again):\n  ${report.missing.slice(0, 20).join('\n  ')}`);
      }
      if (report.orphans.length > 0) {
        this.warn(`MS_STRICT_ASSETS: ${report.orphans.length} file(s) under assets/ are referenced by nothing (stale producer output): ${report.orphans.slice(0, 5).join(', ')}${report.orphans.length > 5 ? ', ...' : ''}`);
      }
    },
  };
}

export default defineConfig({
  plugins: [preact(), strictAssets()],
  build: {
    target: 'es2022',
    // No maps by default: `bun run build` output is what gets deployed (scripts/deploy.ts also passes --sourcemap false and
    // its Pages contract refuses any .map). MS_SOURCEMAP=1 emits 'hidden' maps (no sourceMappingURL comment) for debugging a build.
    sourcemap: process.env.MS_SOURCEMAP === '1' ? 'hidden' : false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      // rolldown's "[PLUGIN_TIMINGS] JavaScript callbacks ran for N s of this build (9x %)" advisory fires whenever plugin
      // callbacks dominate the build time. Ours do on purpose: the writeBundle gates below read the 1.7k-file output (and
      // start two bun processes), seconds on a loaded machine. Real warnings (chunk size, circular imports, ...) are untouched.
      checks: { pluginTimings: false },
      output: {
        // Vendor chunks, and the VFX system (skill specs, presets, shaders) as a chunk of its own: it is ~60 % of the app code
        // and kept the app chunk at 1.5-1.9 MB (> the 1500 kB warning). All of it is still needed by the first run, so
        // nothing loads earlier or later than before. No `maxSize` on the vfx group: past 2 MB it split the VFX code into
        // chunks that import each other, and a module reading another chunk's export at top level (vfx/common/kitArt.ts
        // -> SPR) crashed the production boot before the menu (prod3 verify R1); scripts/chunkGraph.ts (writeBundle below, deploy
        // `site`) now fails any such cycle. One vfx chunk is 1.44 MB today (limit 1500 kB, which stays: a warning must mean
        // something). LAZY SKILL CHUNKS (prod4 I5): the five hero classes' skill specs and the ~110 generated families to come are not in
        // this chunk: the group test below leaves `skills/<class>/`, `skills/shared/` (families of the common skills) and `skills/_gen/`
        // (generated files) out, so each entry that vfx/skills/loader.ts imports with import() is its own chunk (warrior-<hash>.js, ...,
        // shared-<hash>.js) that a run fetches before it starts (RunSession.load → ensureSkillVfx, prefetched at hero select). WITHOUT
        // the lookahead rolldown folds those modules back into `vfx` (measured: one chunk, lazy loading silently defeated). A new lazy
        // directory under skills/ belongs in the lookahead; eager code must never import a file of those directories statically (the
        // default algorithm would place it in `app`, and vfx -> app -> vfx is the prod3 cycle; scripts/chunkGraph.ts fails the build).
        
        // A higher priority wins a module.
        codeSplitting: {
          groups: [
            { name: 'three', test: /node_modules[\\/]three[\\/]/, priority: 40 },
            { name: 'preact', test: /node_modules[\\/]@?preact/, priority: 30 },
            { name: 'vfx', test: /[\\/]src[\\/]vfx[\\/](?!skills[\\/](?:warrior|ninja|yacha|shaman|wolfman|shared|_gen)[\\/])/, priority: 10 },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    // MS_NO_HMR=1: shared capture server for headless screenshot tools (tools/qa) — no reload pushed mid-capture,
    // every fresh page load still gets the current files
    hmr: process.env.MS_NO_HMR === '1' ? false : undefined,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // a loaded machine (parallel agents, CI) can stretch the heavier sim / render tests far past vitest's 5 s default
    testTimeout: 30_000,
  },
});
