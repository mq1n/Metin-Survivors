// PACK mode runner (docs/ART.md s9): one 2x2 sheet per pack variant -> py/pack.py cuts it into one raw per id -> the EXISTING per-id
// post chain (tile or cut-out), near-duplicate check and contact sheet -> gen/<id>/v<k>/ exactly like `icons --gen`, so
// `gates --source gen` and `pick --id <id> --k <k>` work per id. k = the pack variant index (common to the ids of the pack).
//   gen/<packId>/v<k>/{job.json,prompt.txt,raw.png,slice/{cell_<i>.png,slice.json,slice.png},pack.json}
//   gen/<id>/v<k>/{job.json,prompt.txt (the pack message),raw.png (the cell),build/,meta.json,pack.json (which pack + cell + images)}
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withFileLockSync } from '../../qa/slots';
import { codexArgs, soloPrompt } from './codex';
import { gateVariant } from './gates';
import { collectionJobs } from './iconjobs';
import type { IconCollection } from './defs/iconStyle';
import {
  defaultGenOptions,
  fwd,
  genDir,
  genVariants,
  log,
  assetCheck,
  readJson,
  refItems,
  renderSheet,
  runPy,
  runVariant,
  variantStatus,
  vDir,
  type GenOptions,
  type GenVariant,
  genPreview,
} from './gen';
import { describePack, groupPacks, planPack, type PackPlan, type Remainder } from './iconpack';
import { CONTACT, ensureDirs } from './paths';
import { buildJob } from './post';
import { normalizeRefs, prepareRefs } from './refs';
import { toSessionJob, validateJob } from './runner';
import type { BuildReport } from './types';

// ------------------------------------------------------------------ slicing (py/pack.py)

export interface SliceCell {
  index: number;
  cell: string;
  ok: boolean;
  reason: string | null;
  warnings: string[];
  area: number;
  objects: number;
  bbox: number[] | null;
  file: string | null;
}
export interface SliceReport {
  sheet: string;
  w: number;
  h: number;
  mode: 'alpha' | 'colour';
  kind: string;
  n: number;
  bg: number[] | null;
  cuts: { x: number; y: number; cleanX: boolean; cleanY: boolean };
  cell_size: number;
  cells: SliceCell[];
  overlay: string;
  failed: number[];
}

/** Cut a pack sheet into `n` per-cell raws (py/pack.py slice). */
export async function sliceSheet(sheet: string, outDir: string, n: number, kind: 'tile' | 'cutout', names: string[]): Promise<SliceReport> {
  mkdirSync(outDir, { recursive: true });
  const last = await runPy('pack.py', ['slice', sheet, outDir, '--n', String(n), '--mode', kind, '--names', names.join(',')]);
  return JSON.parse(last) as SliceReport;
}

// ------------------------------------------------------------------ metadata

/** gen/<id>/v<k>/pack.json: which pack + cell this id's raw came from (`pick` reads it). */
export interface PackCellMeta {
  packId: string;
  collection: string;
  form: string;
  ids: string[];
  n: number;
  /** 1-based, reading order */
  cell: number;
  cellName: string;
  id: string;
  k: number;
  round: number;
  /** the whole pack sheet this raw was cut from */
  sheet: string;
  prompt: string;
  /** the reference images that belong to this cell, as numbered in the sheet message */
  images: { n: number; src: string; role: string }[];
  slice: { ok: boolean; reason: string | null; warnings: string[]; area: number; bbox: number[] | null; cuts: SliceReport['cuts']; cell_size: number; mode: string; overlay: string };
}

export interface PackVariantResult {
  k: number;
  ok: boolean;
  build: string | null;
  notes?: string[];
  /** deploy-gate near-duplicate check passed */
  check?: boolean;
  /** single-icon gates failed (empty = passes; `pick` refuses an id with fails unless --waive) */
  gates?: string[];
  error?: string;
}
export interface PackResult {
  packId: string;
  collection: string;
  form: string;
  round: number;
  ks: number[];
  ids: string[];
  /** contact sheet: per pack variant the slice overlay + the built icons */
  sheet: string;
  prompt: string;
  sheets: { k: number; raw: string | null; slice?: { mode: string; failed: number[]; cell_size: number; overlay: string }; error?: string }[];
  cells: { index: number; cell: string; id: string; variants: PackVariantResult[]; usable: number[] }[];
  /** ids without a usable variant: regenerate them (single or in a new pack) */
  reroll: string[];
}

// ------------------------------------------------------------------ reservation

const lockAll = <T>(names: string[], fn: () => T): T => (names.length ? withFileLockSync(`imagegen-gen-${names[0]}`, () => lockAll(names.slice(1), fn)) : fn());
const usedKs = (dir: string): number[] =>
  existsSync(dir)
    ? readdirSync(dir)
        .map((f) => /^v(\d+)$/.exec(f)?.[1])
        .filter((x): x is string => !!x)
        .map(Number)
    : [];
const nextRound = (dir: string): number => {
  const f = join(dir, 'rounds.jsonl');
  return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).length + 1 : 1;
};

/** Reserve ONE common variant range for the pack and every id in it (atomic across concurrent gen runs): the first k above every
 *  existing variant of the pack and of its ids, so cell k of the sheet is variant k of each id. */
export function reservePack(plan: PackPlan, n: number): { round: number; ks: number[]; idRound: Record<string, number> } {
  const names = [plan.packId, ...plan.ids].sort();
  return lockAll(names, () => {
    const all = [plan.packId, ...plan.ids];
    const start = Math.max(0, ...all.flatMap((id) => usedKs(genDir(id)))) + 1;
    const ks = Array.from({ length: n }, (_, i) => start + i);
    const idRound: Record<string, number> = {};
    const ts = new Date().toISOString();
    for (const id of all) {
      mkdirSync(genDir(id), { recursive: true });
      for (const k of ks) mkdirSync(vDir(id, k), { recursive: true });
      const round = nextRound(genDir(id));
      idRound[id] = round;
      const cell = plan.cells.find((c) => c.id === id);
      appendFileSync(
        join(genDir(id), 'rounds.jsonl'),
        JSON.stringify({ round, ts, ks, goal: cell ? cell.job.goal : plan.job.goal, refs: (cell ? cell.job.refs : plan.job.refs) ?? [], pack: { packId: plan.packId, ids: plan.ids, cell: cell ? cell.index + 1 : undefined } }) + '\n',
      );
    }
    return { round: idRound[plan.packId]!, ks, idRound };
  });
}

// ------------------------------------------------------------------ dry run

/** Everything a dry run shows for a pack: the cell -> id map, the attached images and the exact message. */
export async function packPreview(plan: PackPlan): Promise<{ text: string; json: Record<string, unknown> }> {
  validateJob(plan.job, 'gen');
  const prepared = await prepareRefs(normalizeRefs(plan.job.refs));
  const sj = toSessionJob(plan.job, prepared.map((p) => ({ path: p.path, role: p.role })));
  const message = soloPrompt(sj);
  const refs = prepared.map((p) => ({ src: fwd(p.src), attached: fwd(p.path), role: p.role, view: p.view }));
  const argv = ['codex', ...codexArgs({ effort: defaultGenOptions.effort, images: prepared.map((p) => fwd(p.path)), dir: '<session dir>' })];
  return {
    text: describePack(plan, message, refs),
    json: {
      pack: plan.packId,
      collection: plan.collection,
      form: plan.form,
      cells: plan.cells.map((c) => ({ cell: c.index + 1, position: c.cell, id: c.id, name: c.name, images: c.images })),
      refs,
      prompt: message,
      argv,
      sheetJob: plan.job,
    },
  };
}

// ------------------------------------------------------------------ generation

const rel = (p: string | null | undefined): string | null => (p ? fwd(p) : null);

/** Generate (or, with `sheets`, adopt already-generated sheets of) a pack: slice, per-id post, near-duplicate check, contact sheets. */
export async function genPack(plan: PackPlan, opts: GenOptions, sheets?: string[]): Promise<PackResult> {
  ensureDirs();
  validateJob(plan.job, 'gen');
  const prepared = await prepareRefs(normalizeRefs(plan.job.refs));
  const sj = toSessionJob(plan.job, prepared.map((p) => ({ path: p.path, role: p.role })));
  const prompt = soloPrompt(sj);
  const count = sheets?.length ?? opts.variants;
  const { round, ks, idRound } = reservePack(plan, count);
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  for (const k of ks) {
    writeFileSync(join(vDir(plan.packId, k), 'job.json'), JSON.stringify(plan.job, null, 1) + '\n');
    writeFileSync(join(vDir(plan.packId, k), 'prompt.txt'), prompt);
  }
  console.error(`[pack] ${plan.packId} round ${round}: ${ks.length} sheet(s) v${ks[0]}..v${ks[ks.length - 1]} for ${plan.ids.join(', ')}; ${prepared.length} reference image(s) attached${sheets ? ' (adopting given sheets, no engine call)' : ''}`);

  let gens: GenVariant[];
  if (sheets) {
    gens = ks.map((k, i) => {
      if (!existsSync(sheets[i]!)) return { k, raw: null, build: null, error: `sheet not found: ${sheets[i]}` };
      const raw = join(vDir(plan.packId, k), 'raw.png');
      copyFileSync(sheets[i]!, raw);
      return { k, raw, build: null };
    });
  } else {
    gens = await Promise.all(ks.map((k) => runVariant(plan.job, sj, k, opts, stamp)));
  }

  // per-id references (the single job's own refs) for the near-duplicate check and the per-id sheet
  const cellRefs = await Promise.all(plan.cells.map((c) => prepareRefs(normalizeRefs(c.job.refs))));
  const kind = plan.form;
  const perCell: GenVariant[][] = plan.cells.map(() => []);
  const sheetsOut: PackResult['sheets'] = [];
  const rows: { label: string; overlay: string | null; cells: { path: string | null; label: string; status: string }[] }[] = [];

  for (const g of gens) {
    const k = g.k;
    const pdir = vDir(plan.packId, k);
    let rep: SliceReport | null = null;
    let sliceErr: string | undefined = g.raw ? undefined : (g.error ?? 'no image returned');
    if (g.raw) {
      try {
        rep = await sliceSheet(g.raw, join(pdir, 'slice'), plan.n, kind, plan.ids);
      } catch (e) {
        sliceErr = `slicing failed: ${String(e).split('\n').slice(-2).join(' ')}`;
      }
    }
    sheetsOut.push({ k, raw: rel(g.raw), ...(rep ? { slice: { mode: rep.mode, failed: rep.failed, cell_size: rep.cell_size, overlay: fwd(rep.overlay) } } : {}), ...(sliceErr ? { error: sliceErr } : {}) });
    await Promise.all(
      plan.cells.map(async (cell, ci) => {
        const dir = vDir(cell.id, k);
        const sc = rep?.cells[ci];
        const pack = { packId: plan.packId, cell: ci + 1, cellName: cell.cell, ids: plan.ids };
        writeFileSync(join(dir, 'job.json'), JSON.stringify(cell.job, null, 1) + '\n');
        writeFileSync(join(dir, 'prompt.txt'), prompt);
        const meta: PackCellMeta = {
          packId: plan.packId,
          collection: plan.collection,
          form: plan.form,
          ids: plan.ids,
          n: plan.n,
          cell: ci + 1,
          cellName: cell.cell,
          id: cell.id,
          k,
          round: idRound[cell.id]!,
          sheet: fwd(g.raw ?? ''),
          prompt: fwd(join(pdir, 'prompt.txt')),
          images: plan.refs.filter((r) => r.cells.includes(ci)).map((r) => ({ n: r.n, src: fwd(r.src), role: r.role })),
          slice: { ok: !!sc?.ok, reason: sc ? sc.reason : sliceErr ?? 'no sheet', warnings: sc?.warnings ?? [], area: sc?.area ?? 0, bbox: sc?.bbox ?? null, cuts: rep?.cuts ?? { x: 0, y: 0, cleanX: false, cleanY: false }, cell_size: rep?.cell_size ?? 0, mode: rep?.mode ?? '', overlay: fwd(rep?.overlay ?? '') },
        };
        writeFileSync(join(dir, 'pack.json'), JSON.stringify(meta, null, 1) + '\n');
        const v: GenVariant = { k, raw: null, build: null, pack, round: idRound[cell.id], sessionId: g.sessionId, codexPath: g.codexPath };
        if (!sc?.ok || !sc.file) {
          v.error = `pack ${plan.packId} cell ${ci + 1} (${cell.cell}): ${sc ? (sc.reason ?? 'not usable') : (sliceErr ?? 'no sheet')}`;
        } else {
          const raw = join(dir, 'raw.png');
          copyFileSync(sc.file, raw);
          v.raw = raw;
          try {
            const r: BuildReport = await buildJob(cell.job, raw, join(dir, 'build'));
            Object.assign(v, { build: r.main, w: r.w, h: r.h, bytes: r.bytes, alpha: r.alpha, lossless: !!r.lossless, notes: [...(r.notes ?? []), ...(sc.warnings.length ? sc.warnings.map((w) => `pack: ${w}`) : [])] });
            const refPaths = cellRefs[ci]!.flatMap((p) => [p.src, p.path]);
            v.check = (await assetCheck([r.main], refPaths)).get(r.main);
            // the same single-icon gates `pick` runs (corner / ring / fill / luma / glyph contrast): a failing cell is reported like a failed slice
            v.gates = (await gateVariant(cell.id, k).catch(() => null))?.fails ?? [];
          } catch (e) {
            v.error = String(e);
          }
        }
        for (const key of ['raw', 'build', 'codexPath'] as const) if (v[key]) v[key] = fwd(v[key]!);
        writeFileSync(join(dir, 'meta.json'), JSON.stringify(v, null, 1));
        perCell[ci]!.push(v);
        log({ event: 'gen', id: cell.id, k, group: plan.job.group, attempt: 1, sessionId: g.sessionId, raw: v.raw ?? undefined, ok: !!v.build, err: v.error });
      }),
    );
    const sorted = plan.cells.map((_, ci) => perCell[ci]!.find((v) => v.k === k)!);
    rows.push({
      label: `v${k}  sheet ${rep ? `${rep.w}x${rep.h} ${rep.mode}, cuts ${rep.cuts.x},${rep.cuts.y}${rep.failed.length ? `, FAILED cells ${rep.failed.join(',')}` : ''}` : (sliceErr ?? '')}`,
      overlay: rep ? rep.overlay : null,
      cells: sorted.map((v, ci) => ({ path: v.build ?? v.raw, label: `${ci + 1} ${plan.cells[ci]!.id.replace(/^icon_/, '')}`, status: variantStatus(v) })),
    });
  }

  // per-id contact sheets (this round's pack variants, the id's references) + the pack sheet
  await Promise.all(
    plan.cells.map((cell, ci) => {
      const vs = perCell[ci]!.slice().sort((a, b) => a.k - b.k);
      return renderSheet(cell.id, `${cell.id} - pack ${plan.packId} round ${idRound[cell.id]} (cell ${ci + 1} ${cell.cell}; ${cell.job.kind}, ${cell.job.background ?? 'legacy'} bg)`, refItems(cellRefs[ci]!), vs, cell.job, opts.cell ?? 320);
    }),
  );
  mkdirSync(CONTACT, { recursive: true });
  const itemsFile = join(CONTACT, `.gen_${plan.packId}.json`);
  const sheetPng = join(CONTACT, `gen_${plan.packId}.png`);
  writeFileSync(itemsFile, JSON.stringify({ title: `${plan.packId} - ${plan.collection} ${plan.form} pack, round ${round}`, rows }));
  await runPy('pack.py', ['contact', sheetPng, itemsFile]);

  const cells: PackResult['cells'] = plan.cells.map((cell, ci) => {
    const variants = perCell[ci]!.slice().sort((a, b) => a.k - b.k).map((v) => ({ k: v.k, ok: !!v.build && v.check?.pass !== false && !(v.gates ?? []).length, build: v.build, notes: v.notes, check: v.check?.pass, gates: v.gates, error: v.error }));
    return { index: ci + 1, cell: cell.cell, id: cell.id, variants, usable: variants.filter((v) => v.ok).map((v) => v.k) };
  });
  for (const g of gens) {
    writeFileSync(
      join(vDir(plan.packId, g.k), 'pack.json'),
      JSON.stringify({ packId: plan.packId, k: g.k, round, ids: plan.ids, refs: plan.refs, slice: sheetsOut.find((s) => s.k === g.k), cells: cells.map((c) => ({ cell: c.index, id: c.id, ok: c.variants.find((v) => v.k === g.k)?.ok ?? false, error: c.variants.find((v) => v.k === g.k)?.error })) }, null, 1) + '\n',
    );
  }
  return {
    packId: plan.packId,
    collection: plan.collection,
    form: plan.form,
    round,
    ks,
    ids: plan.ids,
    sheet: fwd(sheetPng),
    prompt: fwd(join(vDir(plan.packId, ks[0]!), 'prompt.txt')),
    sheets: sheetsOut,
    cells,
    reroll: cells.filter((c) => !c.usable.length).map((c) => c.id),
  };
}

// ------------------------------------------------------------------ CLI entry

export interface PackCommandOptions {
  dry: boolean;
  json?: boolean;
  gen: GenOptions;
  refsPerCell?: number;
  maxRefs?: number;
  remainder: Remainder;
  forcePack?: boolean;
  /** adopt these already-generated sheets (one per pack variant) instead of calling an engine; needs exactly one pack */
  sheets?: string[];
}

/** `icons --collection <c> --gen --ids a,b,c,d,... --pack`: packs of 4 in order (+ a padded pack / singles for the remainder). */
export async function runPackCommand(c: IconCollection, ids: string[], o: PackCommandOptions): Promise<unknown> {
  const groups = groupPacks(ids, o.remainder);
  const plans = groups.packs.map((g) => planPack(c, g, { refsPerCell: o.refsPerCell, maxRefs: o.maxRefs, forcePack: o.forcePack }));
  const singles = collectionJobs(c).filter((j) => groups.singles.includes(j.id));
  const unknown = groups.singles.filter((id) => !singles.some((j) => j.id === id));
  if (unknown.length) throw new Error(`not in ${c}: ${unknown.join(', ')}`);
  if (o.sheets && plans.length !== 1) throw new Error(`--sheet adopts generated sheets for exactly ONE pack (got ${plans.length} pack(s)); pass the 2-4 ids of that pack`);
  const summary = `${ids.length} id(s) -> ${plans.length} pack(s)${plans.length ? ` (${plans.map((p) => p.n).join('+')} cells)` : ''}${singles.length ? ` + ${singles.length} single job(s) (${singles.map((j) => j.id).join(', ')})` : ''}`;
  if (o.dry) {
    const jsons: unknown[] = [];
    for (const p of plans) {
      const pv = await packPreview(p);
      if (o.json) jsons.push(pv.json);
      else console.log(pv.text + '\n');
    }
    for (const j of singles) {
      const sp = await genPreview(j);
      if (o.json) jsons.push(sp);
      else console.log(`=== SINGLE ${j.id} (a lone remainder is generated as an ordinary single job) ===\nrefs: ${sp.refs.map((r) => r.src).join(', ') || '(none)'}\n${sp.prompt}\n`);
    }
    if (o.json) return jsons;
    console.log(`[dry] ${summary}; ${plans.reduce((s, p) => s + p.refs.length, 0)} reference image(s) over the packs; ${o.gen.variants} variant(s) each => ${(plans.length + singles.length) * o.gen.variants} image(s) (instead of ${ids.length * o.gen.variants})`);
    return undefined;
  }
  console.error(`[pack] ${summary}; ${o.gen.variants} variant(s) each => ${(plans.length + singles.length) * (o.sheets?.length ?? o.gen.variants)} image(s)`);
  const results = await Promise.all([
    ...plans.map((p) => genPack(p, o.gen, o.sheets)),
    ...singles.map(async (j) => {
      const r = await genVariants(j, o.gen);
      return { id: r.id, round: r.round, sheet: r.sheet, variants: r.variants.map((v) => ({ k: v.k, build: v.build, notes: v.notes, check: v.check?.pass, error: v.error })) };
    }),
  ]);
  const reroll = results.flatMap((r) => ('reroll' in r ? r.reroll : (r as { variants: { build: string | null }[]; id: string }).variants.some((v) => v.build) ? [] : [(r as { id: string }).id]));
  if (reroll.length) {
    console.error(`[pack] ${reroll.length} id(s) have no usable variant: ${reroll.join(', ')}`);
    console.error(`[pack] reroll: bun tools/imagegen/src/cli.ts icons --collection ${c} --gen --ids ${reroll.join(',')} ${reroll.length >= 2 ? '--pack ' : ''}--variants ${o.gen.variants}`);
  }
  return { collection: c, summary, results, reroll };
}

/** Which pack + cell a gen variant came from (null for an ordinary variant). */
export function readPackMeta(id: string, k: number): PackCellMeta | null {
  return readJson<PackCellMeta>(join(vDir(id, k), 'pack.json'));
}

