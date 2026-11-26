// scripts/chunkGraph.ts: the static-import cycle gate of the build (strict-assets plugin + deploy `site` step).
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkChunkGraph, findCycles, formatCycles, readChunkGraph, scanImports } from '../../../../scripts/chunkGraph';

const graph = (g: Record<string, string[]>): Map<string, string[]> => new Map(Object.entries(g));
const hasBun = spawnSync('bun', ['--version'], { stdio: 'ignore' }).status === 0;

describe('scanImports', () => {
  it('reads static imports and re-exports from minified bundler output', () => {
    const code =
      'import{t as e}from"./rolldown-runtime-A.js";import{a as t,b as n}from"./three-B.js";import*as r from"./ns-C.js";import"./side-D.js";import i from"./default-E.js";' +
      'var x=1;export{x as y};export{z}from"./re-F.js";export*from"./star-G.js";';
    expect(scanImports(code)).toEqual({
      static: ['./rolldown-runtime-A.js', './three-B.js', './ns-C.js', './side-D.js', './default-E.js', './re-F.js', './star-G.js'],
      dynamic: [],
    });
  });

  it('keeps dynamic imports apart, in any quote style and behind the preload helper', () => {
    const code = 'const l=()=>import("./a-1.js"),m=__vitePreload(()=>import(`./b-2.js`),__vite__mapDeps([0,1])),k=import( \'./c-3.js\' );import{q}from"./s-4.js";';
    expect(scanImports(code)).toEqual({ static: ['./s-4.js'], dynamic: ['./a-1.js', './b-2.js', './c-3.js'] });
  });

  it('does not take look-alikes: member calls, computed specifiers, URLs, Array.from', () => {
    const code = 'loader.import("./nope-1.js");import("./pre"+name);var a=Array.from("./nope-2.js");import{u}from"https://cdn.example/x.js";import("./real-3.js");';
    expect(scanImports(code)).toEqual({ static: [], dynamic: ['./real-3.js'] });
  });

  it('counts a repeated specifier once', () => {
    expect(scanImports('import{a}from"./x.js";import{b}from"./x.js";').static).toEqual(['./x.js']);
  });
});

describe('findCycles', () => {
  it('passes a clean graph (diamond, shared leaf, isolated chunk)', () => {
    expect(findCycles(graph({ entry: ['app', 'vfx'], app: ['three', 'vfx'], vfx: ['three'], three: [], lone: [] }))).toEqual([]);
  });

  it('finds two chunks that import each other and prints the chain', () => {
    const cycles = findCycles(graph({ 'vfx-DiSUiPVI.js': ['vfx-C-1m4XhY.js'], 'vfx-C-1m4XhY.js': ['vfx-DiSUiPVI.js', 'three.js'], 'three.js': [] }));
    expect(cycles).toEqual([['vfx-C-1m4XhY.js', 'vfx-DiSUiPVI.js', 'vfx-C-1m4XhY.js']]);
    expect(formatCycles(cycles)).toEqual(['vfx-C-1m4XhY.js -> vfx-DiSUiPVI.js -> vfx-C-1m4XhY.js']);
  });

  it('finds a longer cycle (the shortest way back) and a self import', () => {
    expect(findCycles(graph({ a: ['b'], b: ['c'], c: ['a', 'b'], d: ['d'], e: ['a'] }))).toEqual([
      ['a', 'b', 'c', 'a'],
      ['d', 'd'],
    ]);
  });

  it('reports each cycle group once, however many members it has', () => {
    const cycles = findCycles(graph({ a: ['b'], b: ['a', 'c'], c: ['b'], x: ['y'], y: ['x'] }));
    expect(cycles).toEqual([
      ['a', 'b', 'a'],
      ['x', 'y', 'x'],
    ]);
  });

  it('ignores edges to files that are not in the graph and survives a deep chain', () => {
    expect(findCycles(graph({ a: ['gone.js'] }))).toEqual([]);
    const deep: Record<string, string[]> = {};
    for (let i = 0; i < 5000; i++) deep[`n${i}`] = [`n${i + 1}`];
    deep['n5000'] = [];
    expect(findCycles(graph(deep))).toEqual([]);
    deep['n5000'] = ['n0'];
    expect(findCycles(graph(deep))).toHaveLength(1);
  });
});

describe('checkChunkGraph (files on disk)', () => {
  let dist: string;
  const put = (rel: string, body: string): void => {
    mkdirSync(dirname(join(dist, rel)), { recursive: true });
    writeFileSync(join(dist, rel), body);
  };
  beforeEach(() => {
    dist = mkdtempSync(join(tmpdir(), 'ms-chunks-'));
    put('index.html', '<html></html>');
  });
  afterEach(() => rmSync(dist, { recursive: true, force: true }));

  it('passes the shape of the real build: entry -> app (dynamic), app -> entry/vfx/three, loader -> app/vfx', () => {
    put('assets/index-A.js', 'const d=()=>import("./app-B.js");export{d as t};');
    put('assets/app-B.js', 'import{t as e}from"./index-A.js";import{v}from"./vfx-C.js";export{v as w};');
    put('assets/vfx-C.js', 'import{r}from"./three-D.js";export{r as v};');
    put('assets/three-D.js', 'export var r=1;');
    put('assets/loader-E.js', 'import{w}from"./app-B.js";import{v}from"./vfx-C.js";export{w as l};');
    const report = checkChunkGraph(dist);
    expect(report.cycles).toEqual([]);
    expect(report.chunks).toBe(5);
    expect(report.staticEdges).toBe(5);
    expect(report.dynamicEdges).toBe(1);
    expect(report.largest[0]?.file).toBe('assets/app-B.js');
  });

  it('fails the vfx self-split of prod3: two chunks that import each other', () => {
    put('assets/vfx-C-1m4XhY.js', 'import{S as e}from"./vfx-DiSUiPVI.js";import{r}from"./three-D.js";const K={fb:e.smoke0};export{K as a};');
    put('assets/vfx-DiSUiPVI.js', 'import{a as k}from"./vfx-C-1m4XhY.js";var S={smoke0:1};export{S};');
    put('assets/three-D.js', 'export var r=1;');
    put('assets/index-A.js', 'import{a}from"./vfx-C-1m4XhY.js";');
    const report = checkChunkGraph(dist);
    expect(formatCycles(report.cycles)).toEqual(['assets/vfx-C-1m4XhY.js -> assets/vfx-DiSUiPVI.js -> assets/vfx-C-1m4XhY.js']);
  });

  it('a dynamic import back to the importer is not a cycle (it runs after both evaluated)', () => {
    put('assets/a-1.js', 'import{b}from"./b-2.js";');
    put('assets/b-2.js', 'export const b=()=>import("./a-1.js");');
    expect(checkChunkGraph(dist).cycles).toEqual([]);
  });

  it('resolves ../ and root-absolute specifiers and ignores specifiers that name no emitted file', () => {
    put('assets/sub/x-1.js', 'import{a}from"../y-2.js";import"/assets/z-3.js";import"./missing-4.js";');
    put('assets/y-2.js', 'import{b}from"./sub/x-1.js";');
    put('assets/z-3.js', 'export{};');
    const chunks = readChunkGraph(dist);
    expect(chunks.find((c) => c.file === 'assets/sub/x-1.js')?.imports).toEqual(['assets/y-2.js', 'assets/z-3.js']);
    expect(formatCycles(checkChunkGraph(dist).cycles)).toEqual(['assets/sub/x-1.js -> assets/y-2.js -> assets/sub/x-1.js']);
  });

  it.skipIf(!hasBun)('CLI: JSON report, exit 1 on a cycle and 0 on a clean build', () => {
    put('assets/a-1.js', 'import"./b-2.js";');
    put('assets/b-2.js', 'import"./a-1.js";');
    const script = fileURLToPath(new URL('../../../../scripts/chunkGraph.ts', import.meta.url));
    const bad = spawnSync('bun', [script, dist], { encoding: 'utf8' });
    expect(bad.status).toBe(1);
    expect((JSON.parse(bad.stdout) as { cycles: string[][] }).cycles).toEqual([['assets/a-1.js', 'assets/b-2.js', 'assets/a-1.js']]);
    put('assets/b-2.js', 'export{};');
    const good = spawnSync('bun', [script, dist], { encoding: 'utf8' });
    expect(good.status).toBe(0);
    expect((JSON.parse(good.stdout) as { cycles: string[][] }).cycles).toEqual([]);
    expect(spawnSync('bun', [script, join(dist, 'nope')], { encoding: 'utf8' }).status).toBe(2);
  });
});
