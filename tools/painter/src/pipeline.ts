// End-to-end paint: GLB -> clay turnaround sheet -> codex image_gen repaint -> align + projection bake -> re-textured GLB (+ forge cache).
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { codexImageEdit } from './codex.ts';
import { dumpMesh, geometryFingerprint, injectTexture, readGlb } from './glb.ts';
import { CACHE, ensure, RESEARCH, WORK } from './paths.ts';
import { runPy } from './py.ts';
import { bgColorName, buildPrompt, VIEW_LABELS } from './styles.ts';

export interface PaintOptions {
  glb: string;
  id?: string;
  subject: string;
  style?: string;
  material?: string;
  views?: string[];
  canvas?: string;
  guide?: 'clay' | 'albedo';
  bg?: string;
  tex?: number;
  out?: string;
  
  cache?: boolean;
  /** attempts until the alignment gate passes (default 2) */
  tries?: number;
  /** parallel candidates per attempt; best by score wins (default 1, max 2) */
  candidates?: number;
  effort?: string;
  extra?: string;
  /** skip codex and bake this already painted sheet (png) */
  reuse?: string;
  /** subdirectory name for this run's paint rounds */
  tag?: string;
  facingPower?: number;
  webpQuality?: number;
  /** median albedo luminance target (engine multiplies the vertex AO shade on top); 0 disables levelling */
  targetMedian?: number;
  /** cap of the albedo levelling gain (default 1.45) */
  maxGain?: number;
  /** refuse to write the result/cache when the alignment score is below this (rebake regression guard) */
  minScore?: number;
  /** debug override: allow writing output/cache even if the alignment gate fails (default false) */
  allowFailedGate?: boolean;
}

export interface BakeReport {
  views: Record<string, { iou_before: number; iou_after: number; aligned: boolean }>;
  recon: { mean_abs_err_lowfreq: Record<string, number> };
  prims: { prim: number; T: number; covered: number; seen_frac: number }[];
  levels?: Record<string, { gain: number }>;
  files: string[];
}

export interface PaintResult {
  id: string;
  out: string;
  cache?: string;
  texture: string;
  rawSheet: string;
  report: BakeReport;
  score: number;
  gate: boolean;
  cost: { minutes: number; codexCalls: number; codexSeconds: number };
  layoutHash?: string;
}

export const ALIGN_GATE_MIN_MEAN = 0.8;
export const ALIGN_GATE_MIN_VIEW = 0.65;

export const DEFAULT_VIEWS = ['left', 'right', 'front', 'back', 'top', '3q'];
/** upright figures (humanoids, totems): the top view is nearly empty, a rear 3/4 view is more useful */
export const UPRIGHT_VIEWS = ['front', 'back', 'left', 'right', '3q', '3q_back'];

export function defaultViews(b: { min: number[]; max: number[] }): string[] {
  const h = b.max[1]! - b.min[1]!;
  const foot = Math.max(b.max[0]! - b.min[0]!, b.max[2]! - b.min[2]!);
  return h > 1.25 * foot ? UPRIGHT_VIEWS : DEFAULT_VIEWS;
}

export function scoreOf(r: BakeReport): { mean: number; min: number; score: number } {
  const ious = Object.values(r.views).map((v) => v.iou_after);
  const errs = Object.values(r.recon.mean_abs_err_lowfreq);
  const mean = ious.length ? ious.reduce((a, b) => a + b, 0) / ious.length : 0;
  const err = errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : 0;
  return { mean, min: ious.length ? Math.min(...ious) : 0, score: mean - 1.5 * err };
}

export function passesAlignmentGate(r: BakeReport): boolean {
  const views = Object.values(r.views);
  if (views.length === 0) return false;
  const s = scoreOf(r);
  return s.mean >= ALIGN_GATE_MIN_MEAN && s.min >= ALIGN_GATE_MIN_VIEW && views.every((v) => v.aligned !== false);
}

export interface ScoredCandidate {
  score: number;
  gate: boolean;
}

/**
 * Strictly prefers a candidate that passes `passesAlignmentGate(...)` over an unaccepted candidate,
 * even if the unaccepted candidate has a higher raw composite score.
 */
export function isBetterCandidate(candidate: ScoredCandidate, currentBest: ScoredCandidate | null): boolean {
  if (!currentBest) return true;
  if (candidate.gate !== currentBest.gate) return candidate.gate;
  return candidate.score > currentBest.score;
}

export function selectBestCandidate<T extends ScoredCandidate>(candidates: readonly T[]): T | null {
  let best: T | null = null;
  for (const c of candidates) {
    if (isBetterCandidate(c, best)) best = c;
  }
  return best;
}

/** Validates that a baked texture passes the alignment gate (and optional minScore) before publishing or caching it. */
export function assertPublishableBake(
  id: string,
  report: BakeReport,
  opts: { minScore?: number; allowFailedGate?: boolean } = {},
): { score: number; gate: boolean } {
  const s = scoreOf(report);
  const gate = passesAlignmentGate(report);
  if (!gate && !opts.allowFailedGate) {
    throw new Error(
      `[${id}] alignment gate failed (IoU mean ${s.mean.toFixed(3)}, min ${s.min.toFixed(3)}; required mean >= ${ALIGN_GATE_MIN_MEAN.toFixed(2)}, min >= ${ALIGN_GATE_MIN_VIEW.toFixed(2)} and all views aligned): refusing to publish or cache texture`,
    );
  }
  if (opts.minScore !== undefined && s.score < opts.minScore) {
    throw new Error(`[${id}] bake score ${s.score.toFixed(3)} < required ${opts.minScore.toFixed(3)}: refusing to overwrite the cache`);
  }
  return { score: s.score, gate };
}

export async function paintModel(o: PaintOptions, log: (s: string) => void = console.log): Promise<PaintResult> {
  const t0 = Date.now();
  const glbPath = resolve(o.glb);
  const glbBytes = new Uint8Array(readFileSync(glbPath));
  const mesh = await readGlb(glbBytes);
  if (!mesh.prims.some((p) => p.uvs && p.texture)) throw new Error(`${glbPath}: no textured primitive (needs TEXCOORD_0 + baseColorTexture; build with a texture, e.g. forge --tex=1024)`);
  const id = o.id ?? (typeof mesh.extras.id === 'string' ? mesh.extras.id : basename(glbPath).replace(/\.glb$/, ''));
  const layoutHash = typeof mesh.extras.layoutHash === 'string' ? mesh.extras.layoutHash : undefined;
  const work = ensure(join(WORK, id));
  const meshDir = ensure(join(work, 'mesh'));
  dumpMesh(mesh, meshDir);
  log(`[${id}] ${mesh.prims.length} prim(s), geometry ${geometryFingerprint(mesh)}${layoutHash ? `, layoutHash ${layoutHash}` : ' (no layoutHash: cache disabled)'}`);

  // 1. sheet
  const views = o.views ?? defaultViews(mesh.bounds);
  const sheetDir = ensure(join(work, o.tag ? `sheet_${o.tag}` : 'sheet'));
  const py = ['sheet', '--mesh', meshDir, '--out', sheetDir, '--views', views.join(','), '--canvas', o.canvas ?? '1536x1024', '--guide', o.guide ?? 'clay'];
  // a reused painting is only valid on the exact sheet it was painted on: take the chroma background from the painting's own border
  // (auto-pick reads the GLB's CURRENT texture, which after a first paint is the painted one => a different colour)
  let bgForce = o.bg;
  if (o.reuse && !bgForce) bgForce = ((await runPy(['probe-bg', '--image', resolve(o.reuse)], log)) as { bg: string }).bg;
  if (bgForce) py.push('--bg', bgForce);
  // the sheet is a pure function of (geometry, views, canvas, guide, bg): a --reuse/rebake run keeps an existing one
  const sheetKey = JSON.stringify({ fp: geometryFingerprint(mesh), views, canvas: o.canvas ?? '1536x1024', guide: o.guide ?? 'clay', bg: bgForce ?? '' });
  const keyFile = join(sheetDir, 'key.json');
  let sheetInfo: { bg: [number, number, number] };
  if (o.reuse && existsSync(keyFile) && readFileSync(keyFile, 'utf8') === sheetKey && existsSync(join(sheetDir, 'layout.json'))) {
    sheetInfo = { bg: (JSON.parse(readFileSync(join(sheetDir, 'layout.json'), 'utf8')) as { bg: [number, number, number] }).bg };
    log(`[${id}] sheet reused`);
  } else {
    sheetInfo = (await runPy(py, log)) as { bg: [number, number, number] };
    writeFileSync(keyFile, sheetKey);
  }
  const layout = JSON.parse(readFileSync(join(sheetDir, 'layout.json'), 'utf8')) as { bg: [number, number, number]; views: Record<string, unknown> };
  log(`[${id}] sheet ready (${Object.keys(layout.views).join(', ')})`);

  // 2. prompt
  const palette = Array.isArray(mesh.extras.palette) ? (mesh.extras.palette as string[]) : [];
  const extra = [o.extra, palette.length ? `Dominant model palette (keep these hues as the base colours): ${palette.join(', ')}.` : ''].filter(Boolean).join(' ');
  const prompt = buildPrompt({
    subject: o.subject,
    style: o.style ?? 'fantasy',
    viewLabels: Object.keys(layout.views).map((v) => VIEW_LABELS[v] ?? v),
    bgName: bgColorName(sheetInfo.bg ?? layout.bg),
    material: o.material ?? 'fur',
    extra: extra || undefined,
  });

  // 3. repaint (+ bake each candidate, keep the best)
  const tries = o.tries ?? 2;
  const rawCand = o.candidates ?? 1;
  if (!Number.isFinite(tries) || !Number.isInteger(tries) || tries <= 0) {
    throw new Error(`tries must be a positive integer, got ${tries}`);
  }
  if (!Number.isFinite(rawCand) || !Number.isInteger(rawCand) || rawCand <= 0) {
    throw new Error(`candidates must be a positive integer, got ${rawCand}`);
  }
  const ncand = Math.min(rawCand, 2);
  const paintDir = ensure(join(work, 'paint'));
  let codexCalls = 0;
  let codexMs = 0;
  let best: { dir: string; raw: string; report: BakeReport; score: number; gate: boolean } | null = null;
  let attempt = 0;
  const existing = (): number => {
    let n = 1;
    while (existsSync(join(paintDir, `${o.tag ?? 'r'}${n}`))) n++;
    return n;
  };
  const bake = async (dir: string, raw: string): Promise<{ report: BakeReport; score: number; gate: boolean }> => {
    const res = (await runPy(
      ['bake', '--mesh', meshDir, '--work', sheetDir, '--painted', raw, '--out', join(dir, 'tex.png'), '--tex', String(o.tex ?? 1024), '--facing-power', String(o.facingPower ?? 4), '--webp-quality', String(o.webpQuality ?? 92), '--target-median', String(o.targetMedian ?? 0.46), '--max-gain', String(o.maxGain ?? 1.45)],
      log,
    )) as unknown as BakeReport;
    const s = scoreOf(res);
    const gate = passesAlignmentGate(res);
    log(`    IoU mean ${s.mean.toFixed(3)} min ${s.min.toFixed(3)}  score ${s.score.toFixed(3)}  gate ${gate ? 'PASS' : 'FAIL'}`);
    return { report: res, score: s.score, gate };
  };
  if (o.reuse) {
    const dir = ensure(join(paintDir, `${o.tag ?? 'r'}${existing()}`));
    const raw = join(dir, 'raw.png');
    copyFileSync(resolve(o.reuse), raw);
    const b = await bake(dir, raw);
    best = { dir, raw, report: b.report, score: b.score, gate: b.gate };
  } else {
    let gated = false;
    while (attempt < tries && !gated) {
      attempt++;
      const slots = Array.from({ length: ncand }, (_, k) => {
        const dir = ensure(join(paintDir, `${o.tag ?? 'r'}${existing() + k}`));
        mkdirSync(dir, { recursive: true });
        return dir;
      });
      log(`[${id}] attempt ${attempt}/${tries}: ${ncand} codex call(s)`);
      const results = await Promise.all(
        slots.map(async (dir) => {
          writeFileSync(join(dir, 'prompt.txt'), prompt);
          const r = await codexImageEdit(prompt, [join(sheetDir, 'sheet.png')], join(dir, 'raw.png'), join(dir, 'codex'), { effort: o.effort ?? 'low' });
          codexCalls++;
          codexMs += r.ms;
          return { dir, r };
        }),
      );
      for (const { dir, r } of results) {
        if (!r.ok) {
          log(`    codex failed in ${dir}: ${r.err}`);
          continue;
        }
        log(`    painted in ${(r.ms / 1000).toFixed(0)} s -> ${dir}`);
        try {
          const b = await bake(dir, join(dir, 'raw.png'));
          if (isBetterCandidate(b, best)) best = { dir, raw: join(dir, 'raw.png'), report: b.report, score: b.score, gate: b.gate };
          if (b.gate) gated = true;
        } catch (e) {
          log(`    bake failed: ${(e as Error).message.split('\n').slice(-3).join(' | ')}`);
        }
      }
    }
  }
  if (!best) throw new Error(`[${id}] no usable painting after ${attempt} attempt(s)`);
  assertPublishableBake(id, best.report, { minScore: o.minScore, allowFailedGate: o.allowFailedGate });

  // 4. inject into the GLB
  const texPng = join(best.dir, 'tex.png');
  const texWebp = join(best.dir, 'tex.webp');
  const out = resolve(o.out ?? join(dirname(glbPath), `${id}.painted.glb`));
  mkdirSync(dirname(out), { recursive: true });
  let glbOut: Uint8Array = glbBytes;
  const injected: string[] = [];
  for (const p of mesh.prims) {
    if (!p.uvs || !p.texture) continue;
    const f = p.index === 0 || mesh.prims.length === 1 ? texWebp : texWebp.replace('.webp', `_p${p.index}.webp`);
    glbOut = injectTexture(glbOut, p.materialIndex, new Uint8Array(readFileSync(f)), 'image/webp', { painter: { v: 1, style: o.style ?? 'fantasy', subject: o.subject, views, layoutHash } });
    injected.push(f);
  }
  writeFileSync(out, glbOut);
  log(`[${id}] wrote ${out} (${(glbOut.length / 1024).toFixed(1)} KB)`);

  // 5. forge cache: forge --ship uses this texture while layoutHash still matches the build
  let cacheDir: string | undefined;
  if ((o.cache ?? true) && layoutHash) {
    cacheDir = ensure(join(CACHE, id));
    copyFileSync(texWebp, join(cacheDir, 'albedo.webp'));
    const T = best.report.prims[0]?.T ?? 0;
    writeFileSync(join(cacheDir, 'meta.json'), JSON.stringify({ layoutHash, width: T, height: T, painter: { style: o.style ?? 'fantasy', subject: o.subject, round: basename(best.dir), score: Number(best.score.toFixed(4)) } }, null, 1));
    log(`[${id}] cache updated: ${cacheDir}`);
  }
  const cost = { minutes: Number(((Date.now() - t0) / 60000).toFixed(2)), codexCalls, codexSeconds: Math.round(codexMs / 1000) };
  const result: PaintResult = { id, out, cache: cacheDir, texture: texPng, rawSheet: best.raw, report: best.report, score: best.score, gate: best.gate, cost, layoutHash };
  writeFileSync(join(work, 'result.json'), JSON.stringify({ ...result, opts: { subject: o.subject, style: o.style ?? 'fantasy', material: o.material ?? 'fur', views, tex: o.tex ?? 1024, extra: o.extra, glb: glbPath, out } }, null, 1));
  const runs = join(RESEARCH, 'runs.jsonl');
  writeFileSync(runs, `${JSON.stringify({ at: new Date().toISOString(), id, cost, score: best.score, tag: o.tag })}\n`, { flag: 'a' });
  return result;
}
