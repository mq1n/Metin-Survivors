// Chunk-graph gate: the emitted JS chunks of a build must not statically import each other in a cycle.
// Shared by scripts/deploy.ts (checkSite) and the strict-assets plugin of apps/game/vite.config.ts (writeBundle), like
// scripts/distManifest.ts.
//
// Why it exists: ES modules in a static import cycle evaluate in an order the bundler cannot make safe. The `vfx` group once
// split itself into three chunks (rolldown `maxSize`) of which two imported each other; a module that reads another chunk's
// export at top level (vfx/common/kitArt.ts -> SPR.smoke0) then ran before that export existed and the production boot died
// with "Cannot read properties of undefined (reading 'smoke0')" before the menu. The build printed no warning and every
// other gate was green, so the cycle itself is a build failure.
//
//   cycles   groups of chunks that import each other (static `import` / `export ... from`); each is printed as a chain
//   dynamic imports (`import("./x.js")`, the lazy zone / UI chunks) are not part of the cycle check: they run after both
//   chunks have evaluated. They are reported (`dynamicEdges`) for the chunk table only.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export interface ChunkInfo {
  /** build-relative POSIX path ("assets/vfx-AbC123.js") */
  file: string;
  bytes: number;
  /** files this chunk imports statically */
  imports: string[];
  /** files this chunk imports with `import()` */
  dynamicImports: string[];
}

export interface ChunkGraphReport {
  chunks: number;
  staticEdges: number;
  dynamicEdges: number;
  /** each cycle is a chain that starts and ends on the same file: ["a.js", "b.js", "a.js"] */
  cycles: string[][];
  /** the biggest chunks, largest first (raw bytes, before compression) */
  largest: { file: string; bytes: number }[];
}

/** A string-literal specifier that points at a file next to / below the importer, or at the site root (`/assets/x.js`). */
const SPEC = String.raw`(["'\x60])((?:\.{1,2}\/|\/)[^"'\x60\s]+?\.m?js)\1`;
/** `import "./x.js"` (side effect only) */
const BARE_IMPORT = new RegExp(String.raw`(?<![\w$.])import\s*${SPEC}`, 'g');
/** `import {a} from "./x.js"`, `import * as n from "./x.js"`, `export {a} from "./x.js"`, `export * from "./x.js"` */
const FROM_IMPORT = new RegExp(String.raw`(?<![\w$.])from\s*${SPEC}`, 'g');
/** `import("./x.js")` */
const DYNAMIC_IMPORT = new RegExp(String.raw`(?<![\w$.])import\s*\(\s*${SPEC}`, 'g');

/**
 * Module specifiers a chunk's source imports, in source order, without duplicates. Bundler output (minified or not) writes
 * the specifier as a plain string literal, which is all this reads; a bare / absolute-URL specifier is not a chunk.
 */
export function scanImports(code: string): { static: string[]; dynamic: string[] } {
  const grab = (...res: RegExp[]): string[] => {
    const found: { at: number; spec: string }[] = [];
    for (const re of res) for (const m of code.matchAll(re)) found.push({ at: m.index ?? 0, spec: m[2] as string });
    return [...new Set(found.sort((a, b) => a.at - b.at).map((f) => f.spec))];
  };
  return { static: grab(BARE_IMPORT, FROM_IMPORT), dynamic: grab(DYNAMIC_IMPORT) };
}

function walkJs(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkJs(p, out);
    else if (/\.m?js$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Resolves a specifier written in `from` (build-relative, POSIX) to a build-relative path; null when it is not one. */
function resolveSpec(from: string, spec: string): string | null {
  const target = spec.startsWith('/') ? path.posix.normalize(spec.slice(1)) : path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  return target.startsWith('..') ? null : target;
}

/** Every JS file of a build with the chunks it imports. Specifiers that name no emitted file are dropped. */
export function readChunkGraph(dist: string): ChunkInfo[] {
  if (!existsSync(dist) || !statSync(dist).isDirectory()) throw new Error(`${dist} is not a directory`);
  const files = walkJs(dist).map((f) => ({ abs: f, rel: path.relative(dist, f).split(path.sep).join('/') }));
  const known = new Set(files.map((f) => f.rel));
  return files
    .map(({ abs, rel }) => {
      const code = readFileSync(abs, 'utf8');
      const found = scanImports(code);
      const edges = (specs: string[]): string[] => {
        const out: string[] = [];
        for (const s of specs) {
          const t = resolveSpec(rel, s);
          if (t && known.has(t) && !out.includes(t)) out.push(t);
        }
        return out;
      };
      return { file: rel, bytes: Buffer.byteLength(code), imports: edges(found.static), dynamicImports: edges(found.dynamic) };
    })
    .sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * Static import cycles of a graph (adjacency lists). One chain per strongly connected component (and per self-import): the
 * shortest way back to the component's alphabetically first file, so the output is stable. Files are returned as given.
 */
export function findCycles(graph: ReadonlyMap<string, readonly string[]>): string[][] {
  // Tarjan's strongly connected components, iterative (a build has a few dozen chunks, but a test may have many more)
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let counter = 0;
  const nodes = [...graph.keys()].sort();
  for (const root of nodes) {
    if (index.has(root)) continue;
    const work: { node: string; next: number }[] = [{ node: root, next: 0 }];
    index.set(root, counter);
    low.set(root, counter++);
    stack.push(root);
    onStack.add(root);
    while (work.length > 0) {
      const frame = work[work.length - 1] as { node: string; next: number };
      const edges = graph.get(frame.node) ?? [];
      if (frame.next < edges.length) {
        const to = edges[frame.next++] as string;
        if (!graph.has(to)) continue;
        if (!index.has(to)) {
          index.set(to, counter);
          low.set(to, counter++);
          stack.push(to);
          onStack.add(to);
          work.push({ node: to, next: 0 });
        } else if (onStack.has(to)) {
          low.set(frame.node, Math.min(low.get(frame.node) as number, index.get(to) as number));
        }
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) low.set(parent.node, Math.min(low.get(parent.node) as number, low.get(frame.node) as number));
      if (low.get(frame.node) === index.get(frame.node)) {
        const comp: string[] = [];
        let n: string;
        do {
          n = stack.pop() as string;
          onStack.delete(n);
          comp.push(n);
        } while (n !== frame.node);
        components.push(comp);
      }
    }
  }
  const cycles: string[][] = [];
  for (const comp of components) {
    const members = new Set(comp);
    const start = [...comp].sort()[0] as string;
    if (comp.length === 1 && !(graph.get(start) ?? []).includes(start)) continue;
    // breadth-first from `start` inside the component until an edge leads back to it
    const from = new Map<string, string>();
    const queue = [start];
    let closing: string | null = null;
    for (let i = 0; i < queue.length && closing === null; i++) {
      const n = queue[i] as string;
      for (const to of [...(graph.get(n) ?? [])].sort()) {
        if (!members.has(to)) continue;
        if (to === start) {
          closing = n;
          break;
        }
        if (!from.has(to)) {
          from.set(to, n);
          queue.push(to);
        }
      }
    }
    if (closing === null) continue;
    const chain = [start];
    const back: string[] = [];
    for (let n: string | undefined = closing; n !== undefined && n !== start; n = from.get(n)) back.push(n);
    chain.push(...back.reverse(), start);
    cycles.push(chain);
  }
  return cycles.sort((a, b) => (a[0] as string).localeCompare(b[0] as string));
}

export function checkChunkGraph(dist: string): ChunkGraphReport {
  const chunks = readChunkGraph(dist);
  const graph = new Map(chunks.map((c) => [c.file, c.imports] as const));
  return {
    chunks: chunks.length,
    staticEdges: chunks.reduce((n, c) => n + c.imports.length, 0),
    dynamicEdges: chunks.reduce((n, c) => n + c.dynamicImports.length, 0),
    cycles: findCycles(graph),
    largest: [...chunks].sort((a, b) => b.bytes - a.bytes).slice(0, 5).map((c) => ({ file: c.file, bytes: c.bytes })),
  };
}

/** One line per cycle: "assets/vfx-A.js -> assets/vfx-B.js -> assets/vfx-A.js" */
export function formatCycles(cycles: readonly (readonly string[])[]): string[] {
  return cycles.map((c) => c.join(' -> '));
}

// CLI (used by the strict-assets plugin of apps/game/vite.config.ts): bun scripts/chunkGraph.ts <dist dir> [--text]
// prints the report as JSON (--text: for people); exit 1 when the chunks import each other in a cycle, 2 when the build cannot be read.
if (import.meta.main) {
  const args = process.argv.slice(2);
  const dist = path.resolve(args.find((a) => !a.startsWith('--')) ?? 'apps/game/dist');
  try {
    const report = checkChunkGraph(dist);
    if (args.includes('--text')) {
      console.log(`${report.chunks} JS files, ${report.staticEdges} static imports, ${report.dynamicEdges} dynamic imports, ${report.cycles.length} cycle(s)`);
      for (const l of formatCycles(report.cycles)) console.log(`  cycle: ${l}`);
      for (const c of report.largest) console.log(`  ${(c.bytes / 1000).toFixed(2)} kB  ${c.file}`);
    } else {
      console.log(JSON.stringify(report));
    }
    process.exit(report.cycles.length > 0 ? 1 : 0);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
}
