// bun tools/painter/src/cli.ts <command>   (see tools/painter/README.md)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { codexImageEdit } from './codex.ts';
import { dumpMesh, geometryFingerprint, injectTexture, readGlb } from './glb.ts';
import { CACHE, ensure, RESEARCH, ROOT, WORK } from './paths.ts';
import { forgeBuild, guessMaterial, rosterEntry } from './forge.ts';
import { defaultViews, type PaintOptions, paintModel } from './pipeline.ts';
import { runPy } from './py.ts';
import { STYLES, bgColorName, buildPrompt, VIEW_LABELS } from './styles.ts';
import { validateGlb } from './validate.ts';

const [cmd, ...rest] = process.argv.slice(2);
const kv: Record<string, string> = {};
const args: string[] = [];
for (let i = 0; i < rest.length; i++) {
  const a = rest[i]!;
  if (a.startsWith('--')) {
    const eq = a.indexOf('=');
    if (eq > 0) kv[a.slice(2, eq)] = a.slice(eq + 1);
    else if (rest[i + 1] !== undefined && !rest[i + 1]!.startsWith('--')) kv[a.slice(2)] = rest[++i]!;
    else kv[a.slice(2)] = '1';
  } else args.push(a);
}

const HELP = `painter — AI repaint + projection bake for forge GLBs
  paint <glb> --subject "<short description>" [--style fantasy] [--material fur|scale|cloth|skin|stone|wood]
        [--views left,right,front,back,top,3q] [--out <glb>] [--id <id>] [--tex 1024] [--tries 2] [--candidates 1|2]
        [--extra "<free text>"] [--reuse <painted.png>] [--no-cache] [--tag <name>] [--effort low]
      -> <out> (default <glb dir>/<id>.painted.glb) and, if the GLB carries extras.layoutHash, .research/painter/cache/<id>/ (forge --ship picks it up)
  ship <id> [--subject "..."] [paint options] [--no-build] [--no-ship]   forge build <id> (fresh layoutHash) -> paint -> cache -> forge build <id> --ship (texture ships)
                                                  --subject/--material default to content/model_roster.json (description/archetype)
  batch <jobs.json> [--parallel 2] [--only id,id] [--skip-cached]   paint many models (jobs: {defaults?, jobs:[{id, subject?, material?, extra?, glb?}]}); glb defaults to .research/forge/tmp/<id>.glb
  sheet <glb> [--id] [--views] [--canvas 1536x1024] [--guide clay|albedo]        clay turnaround + UV/normal/depth passes -> .research/painter/work/<id>/sheet
  repaint <id> --subject "..." [--round N] [--style] [--material] [--extra]      one codex image_gen call on the sheet
  bake <id> --painted <png> [--tex 1024] [--out <png>]                           align + project a painted sheet into the UV texture
  inject <glb> <image.webp|png> --out <glb> [--material 0]                       swap the baseColorTexture bytes only
  rebake <id...> [--min-gain 1.5]                                                re-bake from the stored painted sheet (no codex call): after bake/levelling fixes
  validate <glb...>                                                              gltf-validator (exit 1 on errors)
  dump <glb> [--id]                                                              decode geometry for inspection
  styles                                                                         list style presets`;

function parsePositiveInt(raw: string | undefined, fallback: number, flag: string): number {
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (!trimmed) throw new Error(`${flag} must be a positive integer, got ${JSON.stringify(raw)}`);
  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new Error(`${flag} must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return n;
}

async function main(): Promise<void> {
  if (!cmd || cmd === 'help' || cmd === '--help') {
    console.log(HELP);
    return;
  }
  if (cmd === 'rebake') {
    // re-run alignment + bake + levelling + inject + cache from an already painted sheet (no codex call): rebake <id...> [--min-gain 1.5] [--tex 1024]
    for (const id of args) {
      const rj = join(WORK, id, 'result.json');
      if (!existsSync(rj)) {
        console.log(`[${id}] no result.json, skipped`);
        continue;
      }
      const prev = JSON.parse(readFileSync(rj, 'utf8')) as { score?: number; rawSheet: string; layoutHash?: string; report?: { levels?: Record<string, { gain: number }> }; opts?: { subject: string; style: string; material: string; views: string[]; tex: number; extra?: string; glb?: string; out?: string } };
      const gain = prev.report?.levels?.['0']?.gain ?? 1;
      if (kv['min-gain'] && gain < Number(kv['min-gain'])) {
        console.log(`[${id}] gain ${gain} < ${kv['min-gain']}, skipped`);
        continue;
      }
      const meta = existsSync(join(CACHE, id, 'meta.json')) ? (JSON.parse(readFileSync(join(CACHE, id, 'meta.json'), 'utf8')) as { painter?: { style?: string; subject?: string } }) : undefined;
      const glb = kv.glb ?? prev.opts?.glb ?? join(ROOT, '.research', 'forge', 'tmp', `${id}.glb`);
      const cur = await readGlb(new Uint8Array(readFileSync(glb)));
      if (prev.layoutHash && cur.extras.layoutHash !== prev.layoutHash) {
        console.log(`[${id}] SKIPPED: GLB layoutHash ${String(cur.extras.layoutHash)} != painted ${prev.layoutHash} (geometry changed: needs a new paint)`);
        continue;
      }
      const subject = prev.opts?.subject ?? meta?.painter?.subject ?? id;
      const res = await paintModel({ glb, id, subject, style: prev.opts?.style ?? meta?.painter?.style, material: prev.opts?.material, views: prev.opts?.views, tex: kv.tex ? Number(kv.tex) : prev.opts?.tex, extra: prev.opts?.extra, reuse: prev.rawSheet, out: prev.opts?.out ?? join(ROOT, '.research', 'painter', 'painted', `${id}.painted.glb`), tag: 'rb', maxGain: kv['max-gain'] ? Number(kv['max-gain']) : undefined, targetMedian: kv['target-median'] ? Number(kv['target-median']) : undefined, minScore: kv.score !== undefined ? Number(kv.score) : prev.score !== undefined ? prev.score - 0.06 : undefined }, (s) => console.log(s));
      console.log(`[${id}] REBAKED gain ${gain} -> ${res.report.levels?.['0']?.gain ?? '?'} score ${res.score.toFixed(3)}`);
    }
    return;
  }
  if (cmd === 'validate') {
    let bad = 0;
    for (const f of args) {
      const r = await validateGlb(resolve(f));
      console.log(`${r.errors === 0 ? 'OK ' : 'BAD'} ${f}: ${r.errors} errors, ${r.warnings} warnings, ${r.infos} infos${r.messages.length ? `\n  ${r.messages.join('\n  ')}` : ''}`);
      if (r.errors > 0) bad++;
    }
    if (bad) process.exit(1);
    return;
  }
  if (cmd === 'styles') {
    for (const [k, v] of Object.entries(STYLES)) console.log(`${k}: materials ${Object.keys(v.materials).join(', ')}`);
    return;
  }
  if (cmd === 'paint' || cmd === 'ship') {
    const target = args[0];
    if (!target) throw new Error('usage: paint <glb> --subject "..." | ship <id> [options]  (see help)');
    let glb = target;
    let id = kv.id;
    const log = (s: string): void => console.log(s);
    if (cmd === 'ship') {
      id = target;
      if (kv['no-build']) glb = join(ROOT, '.research', 'forge', 'tmp', `${id}.glb`);
      else {
        const b = await forgeBuild(id, { tex: kv['forge-tex'] ? Number(kv['forge-tex']) : undefined }, log);
        if (!b.ok) throw new Error(`forge build ${id} failed:\n${b.log.slice(-2000)}`);
        glb = b.glb;
      }
    }
    const entry = rosterEntry(id ?? basename(glb).replace(/\.glb$/, ''));
    const subject = kv.subject ?? entry?.description;
    if (!subject) throw new Error('--subject "<short description>" is required (no roster entry to take it from)');
    const opts: PaintOptions = {
      glb,
      id,
      subject,
      style: kv.style,
      material: kv.material ?? guessMaterial(entry),
      views: kv.views?.split(','),
      canvas: kv.canvas,
      guide: kv.guide as 'clay' | 'albedo' | undefined,
      bg: kv.bg,
      tex: kv.tex !== undefined ? parsePositiveInt(kv.tex, 1024, '--tex') : undefined,
      out: kv.out,
      cache: kv['no-cache'] === undefined,
      tries: kv.tries !== undefined ? parsePositiveInt(kv.tries, 2, '--tries') : undefined,
      candidates: kv.candidates !== undefined ? parsePositiveInt(kv.candidates, 1, '--candidates') : undefined,
      effort: kv.effort,
      extra: kv.extra,
      reuse: kv.reuse,
      tag: kv.tag,
      facingPower: kv['facing-power'] ? Number(kv['facing-power']) : undefined,
      targetMedian: kv['target-median'] ? Number(kv['target-median']) : undefined,
      maxGain: kv['max-gain'] ? Number(kv['max-gain']) : undefined,
    };
    const res = await paintModel(opts, log);
    let shipped: string | undefined;
    if (cmd === 'ship' && !kv['no-ship']) {
      const b = await forgeBuild(id!, { ship: true, tex: kv['forge-tex'] ? Number(kv['forge-tex']) : undefined }, log);
      if (!b.ok) throw new Error(`forge --ship failed:\n${b.log.slice(-2000)}`);
      if (b.stale) throw new Error(`forge reported a STALE painted texture after the paint run (geometry changed between builds?):\n${b.log.slice(-1200)}`);
      shipped = (/-> (\S+)/.exec(b.log) ?? [])[1];
      log(b.log.trim().split(/\r?\n/).slice(-3).join('\n'));
    }
    console.log(JSON.stringify({ id: res.id, out: res.out, cache: res.cache, shipped, score: Number(res.score.toFixed(3)), cost: res.cost, iou: Object.fromEntries(Object.entries(res.report.views).map(([k, v]) => [k, v.iou_after])) }));
    return;
  }
  if (cmd === 'batch') {
    const spec = JSON.parse(readFileSync(resolve(args[0]!), 'utf8')) as { defaults?: Partial<PaintOptions>; jobs: (Partial<PaintOptions> & { id: string })[] };
    const only = kv.only?.split(',');
    const par = Math.min(parsePositiveInt(kv.parallel, 2, '--parallel'), 2);
    const queue = spec.jobs.filter((j) => !only || only.includes(j.id));
    const results: Record<string, unknown> = {};
    let failed = 0;
    const worker = async (): Promise<void> => {
      for (let j = queue.shift(); j; j = queue.shift()) {
        const entry = rosterEntry(j.id);
        const glb = j.glb ?? join(ROOT, '.research', 'forge', 'tmp', `${j.id}.glb`);
        try {
          if (kv['skip-cached'] && existsSync(join(CACHE, j.id, 'meta.json'))) {
            const mesh = await readGlb(new Uint8Array(readFileSync(glb)));
            const meta = JSON.parse(readFileSync(join(CACHE, j.id, 'meta.json'), 'utf8')) as { layoutHash?: string };
            if (meta.layoutHash && meta.layoutHash === mesh.extras.layoutHash) {
              console.log(`[${j.id}] cache is current (${meta.layoutHash}), skipped`);
              results[j.id] = { skipped: true };
              continue;
            }
          }
          const subject = j.subject ?? spec.defaults?.subject ?? entry?.description;
          if (!subject) throw new Error('no subject');
          const res = await paintModel({ ...spec.defaults, ...j, glb, id: j.id, subject, material: j.material ?? spec.defaults?.material ?? guessMaterial(entry), out: j.out ?? join(RESEARCH, 'painted', `${j.id}.painted.glb`) }, (s) => console.log(`[${j.id}] ${s.replace(/^\[[^\]]+\] /, '')}`));
          results[j.id] = { out: res.out, cache: res.cache, score: Number(res.score.toFixed(3)), cost: res.cost, iou: Object.fromEntries(Object.entries(res.report.views).map(([k, v]) => [k, v.iou_after])) };
          console.log(`[${j.id}] DONE ${JSON.stringify(results[j.id])}`);
        } catch (e) {
          failed++;
          results[j.id] = { error: (e as Error).message };
          console.log(`[${j.id}] FAILED ${(e as Error).message}`);
        }
      }
    };
    await Promise.all(Array.from({ length: par }, worker));
    ensure(RESEARCH);
    writeFileSync(join(RESEARCH, `batch_${basename(args[0]!).replace(/\.json$/, '')}.json`), JSON.stringify(results, null, 1));
    console.log(JSON.stringify(results));
    if (failed > 0) process.exit(1);
    return;
  }
  if (cmd === 'dump') {
    const glbPath = resolve(args[0]!);
    const id = kv.id ?? basename(glbPath).replace(/\.glb$/, '');
    const mesh = await readGlb(new Uint8Array(readFileSync(glbPath)));
    const dir = ensure(join(WORK, id, 'mesh'));
    dumpMesh(mesh, dir);
    console.log(`dumped ${mesh.prims.length} prims to ${dir} fingerprint=${geometryFingerprint(mesh)} layoutHash=${String(mesh.extras.layoutHash ?? '-')}`);
    return;
  }
  if (cmd === 'sheet') {
    const glbPath = resolve(args[0]!);
    const id = kv.id ?? basename(glbPath).replace(/\.glb$/, '');
    const mesh = await readGlb(new Uint8Array(readFileSync(glbPath)));
    const dir = ensure(join(WORK, id, 'mesh'));
    dumpMesh(mesh, dir);
    const out = ensure(join(WORK, id, kv.dir ?? 'sheet'));
    const py = ['sheet', '--mesh', dir, '--out', out, '--views', kv.views ?? defaultViews(mesh.bounds).join(',')];
    for (const k of ['canvas', 'guide', 'bg', 'ss']) if (kv[k]) py.push(`--${k}`, kv[k]!);
    console.log(JSON.stringify(await runPy(py)));
    return;
  }
  if (cmd === 'repaint') {
    const id = args[0]!;
    const sheetDir = join(WORK, id, kv.sheet ?? 'sheet');
    const layout = JSON.parse(readFileSync(join(sheetDir, 'layout.json'), 'utf8')) as { bg: [number, number, number]; views: Record<string, unknown> };
    const prompt = buildPrompt({
      subject: kv.subject ?? id,
      style: kv.style ?? 'fantasy',
      viewLabels: Object.keys(layout.views).map((v) => VIEW_LABELS[v] ?? v),
      bgName: bgColorName(layout.bg),
      material: kv.material ?? 'fur',
      extra: kv.extra,
    });
    const dir = ensure(join(WORK, id, 'paint', `r${kv.round ?? '1'}`));
    writeFileSync(join(dir, 'prompt.txt'), prompt);
    const r = await codexImageEdit(prompt, [join(sheetDir, 'sheet.png')], join(dir, 'raw.png'), join(dir, 'codex'), { effort: kv.effort ?? 'low' });
    console.log(JSON.stringify(r));
    return;
  }
  if (cmd === 'bake') {
    const id = args[0]!;
    const dir = join(WORK, id);
    const py = ['bake', '--mesh', join(dir, 'mesh'), '--work', join(dir, kv.sheet ?? 'sheet'), '--painted', resolve(kv.painted!), '--out', resolve(kv.out ?? join(dir, 'paint', 'tex.png')), '--tex', kv.tex ?? '0'];
    for (const k of ['facing-power', 'webp-quality', 'target-median']) if (kv[k]) py.push(`--${k}`, kv[k]!);
    console.log(JSON.stringify(await runPy(py)));
    return;
  }
  if (cmd === 'inject') {
    const glb = new Uint8Array(readFileSync(resolve(args[0]!)));
    const img = new Uint8Array(readFileSync(resolve(args[1]!)));
    const mime = args[1]!.toLowerCase().endsWith('.png') ? 'image/png' : 'image/webp';
    writeFileSync(resolve(kv.out!), injectTexture(glb, Number(kv.material ?? 0), img, mime));
    console.log(`wrote ${kv.out}`);
    return;
  }
  throw new Error(`unknown command ${cmd}\n${HELP}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
