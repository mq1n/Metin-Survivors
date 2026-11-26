#!/usr/bin/env bun
// imagegen CLI — see docs/ART.md and tools/imagegen/README section in this file's usage().
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { makeContacts } from './contact';
import { ICON_COLLECTIONS } from './defs/iconStyle';
import { collectionOf, gateVariant, runGates, type GateSource } from './gates';
import { assetCheck, defaultGenOptions, genPreview, genVariants, listVariants, pick } from './gen';
import { genJobFromArgs } from './genspec';
import { checkHints, collectionJobs, isCollection, writeCollectionJobs } from './iconjobs';
import { emitIconJobs, legacyIconJobsText } from './icons';
import { runPackCommand } from './pack';
import { ensureDirs, JOBS_DIR, RESEARCH } from './paths';
import { buildMany, rawReady, readReport } from './post';
import { loadReview, setStatus } from './review';
import { defaultRunOptions, loadAllJobs, rawPath, runJobs } from './runner';
import { ship, unship } from './ship';
import type { JobSpec } from './types';

const USAGE = `usage: bun src/cli.ts <command> [options]
 one asset from a reference (prints JSON on stdout; progress on stderr):
  gen      --id <id> --kind <vfx|ui|terrain|…> --ref <png|dds|tga> [--ref …] --goal "<goal + expectation>"
           [--bg black|transparent|opaque] [--size 512] [--aspect square|landscape|portrait|wide] [--variants 3]
           [--keepColor] [--trim] [--ref-context <png>] [--ref-style <png>] [--prompt "<extra detail>"]
           [--group g] [--post '<json ops>'] [--effort low] [--model m] [--attempts 2] [--timeout 100] [--cell 320] [--dry]
           → N variants in parallel codex sessions, built + near-duplicate-checked, sheet .research/imagegen/contact/gen_<id>.png
  pick     --id <id> --k <k>      approve + ship variant k (replaces an earlier ship of the id) + merge manifest.json
  variants --id <id>              every variant of the id (all gen rounds) + a fresh sheet
 batch pipeline (job files under tools/imagegen/jobs/):
  run      generate raws         [--group g] [--ids a,b] [--file f.jsonl] [-c 3] [-b 4] [--force] [--limit n] [--effort low] [--dry]
  build    post-process raws     [--group g] [--ids a,b] [--parallel 4]
  contact  contact sheets        [--group g] [--ids a,b] [--raw] [--name n] [--cols 5] [--cell 256] [--per 20]
  approve  mark approved         <ids...> | --group g | --built-clean
  reject   mark rejected (moves raw aside so 'run' regenerates)  <ids...> [--note "why"]
  ship     copy approved builds into apps/game/public + manifest parts   [--ids a,b] [--all]
  unship   remove shipped assets <ids...>
  status   counts per group
  stats    throughput from the run log
 icons v2 (docs/ART.md s5; one collection at a time: skills|passives|stones|trinkets|gear|talents):
  icons    --collection <c> [--dry]          v2 jobs from hints/<c>.json -> jobs/icons_<c>.jsonl (only this file)
           --collection <c> --check          hint lint: missing / duplicate / banned words / refs (exit 1 on problems)
           --collection <c> --gen --ids a,b [--variants 2] [--effort low]   gen machinery per id (refs attached)
           --collection <c> --gen --ids a,b,c,d,... --pack [--variants 2] [--dry]   PACK mode: ONE image = a 2x2 sheet of FOUR DIFFERENT ids
                                             (talents, passives, stones, trinkets, gear; skills keep their grade sheets); sliced per id, then
                                             post/gates/pick per id as usual. [--refs-per-cell 2] [--max-refs 8] [--remainder pad|single]
                                             [--sheet a.png[,b.png]] adopt an already generated sheet [--json] [--force-pack]
           --legacy [--dry]                  the old 128 px opaque jobs for all collections (jobs/icons.jsonl)
  gates    --collection <c> [--source build|gen|shipped] [--ids a,b]    machine gates + 48/64 px sheets
  pick     on an icon v2 job runs the single-icon gates first; [--waive "why"] ships anyway and records why`;

export function parsePositiveInt(raw: string | undefined, fallback: number, flag: string): number {
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (!trimmed) throw new Error(`${flag} must be a positive integer, got ${JSON.stringify(raw)}`);
  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new Error(`${flag} must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return n;
}

const json = (o: unknown): void => console.log(JSON.stringify(o, null, 1));

async function main(argv = Bun.argv.slice(2)): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      id: { type: 'string' },
      kind: { type: 'string' },
      ref: { type: 'string', multiple: true },
      'ref-context': { type: 'string', multiple: true },
      'ref-style': { type: 'string', multiple: true },
      goal: { type: 'string' },
      prompt: { type: 'string' },
      bg: { type: 'string' },
      size: { type: 'string' },
      aspect: { type: 'string' },
      variants: { type: 'string' },
      keepColor: { type: 'boolean' },
      trim: { type: 'boolean' },
      post: { type: 'string' },
      model: { type: 'string' },
      k: { type: 'string' },
      group: { type: 'string', short: 'g' },
      ids: { type: 'string' },
      file: { type: 'string', short: 'f' },
      concurrency: { type: 'string', short: 'c' },
      batch: { type: 'string', short: 'b' },
      force: { type: 'boolean' },
      limit: { type: 'string' },
      effort: { type: 'string' },
      dry: { type: 'boolean' },
      parallel: { type: 'string' },
      raw: { type: 'boolean' },
      name: { type: 'string' },
      cols: { type: 'string' },
      cell: { type: 'string' },
      per: { type: 'string' },
      note: { type: 'string' },
      all: { type: 'boolean' },
      'built-clean': { type: 'boolean' },
      attempts: { type: 'string' },
      timeout: { type: 'string' },
      collection: { type: 'string' },
      check: { type: 'boolean' },
      legacy: { type: 'boolean' },
      gen: { type: 'boolean' },
      source: { type: 'string' },
      waive: { type: 'string' },
      pack: { type: 'boolean' },
      'refs-per-cell': { type: 'string' },
      'max-refs': { type: 'string' },
      remainder: { type: 'string' },
      sheet: { type: 'string' },
      json: { type: 'boolean' },
      'force-pack': { type: 'boolean' },
    },
  });

  const cmd = positionals[0];
  ensureDirs();

  function selectJobs(positional: string[] = []): JobSpec[] {
    let jobs = loadAllJobs(values.file ? [values.file] : undefined);
    const ids = [...(values.ids?.split(',') ?? []), ...positional].filter(Boolean);
    if (ids.length) jobs = jobs.filter((j) => ids.includes(j.id));
    if (values.group) jobs = jobs.filter((j) => j.group === values.group);
    return jobs;
  }
  switch (cmd) {
    case 'gen': {
      const { job, variants } = genJobFromArgs({
        id: values.id,
        kind: values.kind,
        ref: values.ref,
        refContext: values['ref-context'],
        refStyle: values['ref-style'],
        goal: values.goal,
        prompt: values.prompt,
        bg: values.bg,
        size: values.size,
        aspect: values.aspect,
        variants: values.variants,
        keepColor: values.keepColor,
        trim: values.trim,
        group: values.group,
        post: values.post,
      });
      if (values.dry) return json(await genPreview(job));
      const attempts = parsePositiveInt(values.attempts, defaultGenOptions.attempts, '--attempts');
      const timeoutSec = parsePositiveInt(values.timeout, defaultGenOptions.timeoutSec, '--timeout');
      const cell = parsePositiveInt(values.cell, defaultGenOptions.cell ?? 320, '--cell');
      const res = await genVariants(job, {
        ...defaultGenOptions,
        variants,
        effort: values.effort ?? defaultGenOptions.effort,
        model: values.model,
        attempts,
        timeoutSec,
        cell,
      });
      json(res);
      if (!res.variants.some((v) => v.build)) {
        console.error(`imagegen gen: no variant of ${res.id} was generated and built`);
        process.exit(1);
      }
      return;
    }
    case 'pick': {
      const k = Number(values.k);
      if (!values.id || !Number.isInteger(k) || k < 1) throw new Error('usage: pick --id <id> --k <variant number>');
      const gate = await gateVariant(values.id, k);
      if (gate?.fails.length && !values.waive) {
        throw new Error(`${values.id} v${k} fails the icon gates: ${gate.fails.join('; ')} (report ${gate.report}); fix/regenerate or pick with --waive "why"`);
      }
      const picked = await pick(values.id, k);
      if (gate?.fails.length && values.waive) setStatus([values.id], 'approved', `picked gen v${k}; gates waived (${gate.fails.join('; ')}): ${values.waive}`);
      json(gate ? { ...picked, gates: gate } : picked);
      if (!picked.manifest.ok) {
        console.error(`imagegen pick: manifest merge failed: ${picked.manifest.line}`);
        process.exitCode = 1;
      }
      return;
    }
    case 'variants': {
      if (!values.id) throw new Error('usage: variants --id <id>');
      const cell = parsePositiveInt(values.cell, defaultGenOptions.cell ?? 320, '--cell');
      return json(await listVariants(values.id, cell));
    }
    case 'run': {
      const concurrency = parsePositiveInt(values.concurrency, defaultRunOptions.concurrency, '--concurrency');
      const batchSize = parsePositiveInt(values.batch, defaultRunOptions.batchSize, '--batch');
      const maxAttempts = parsePositiveInt(values.attempts, defaultRunOptions.maxAttempts, '--attempts');
      const jobTimeoutSec = parsePositiveInt(values.timeout, defaultRunOptions.jobTimeoutSec, '--timeout');
      const limit = values.limit !== undefined ? parsePositiveInt(values.limit, 1, '--limit') : undefined;
      const jobs = selectJobs();
      const summary = await runJobs(jobs, {
        ...defaultRunOptions,
        concurrency,
        batchSize,
        maxAttempts,
        effort: values.effort ?? defaultRunOptions.effort,
        jobTimeoutSec,
        force: !!values.force,
        limit,
        dryRun: !!values.dry,
      });
      if (summary.failed.length > 0) {
        process.exitCode = 1;
      }
      break;
    }
    case 'build': {
      const parallel = parsePositiveInt(values.parallel, 4, '--parallel');
      const jobs = selectJobs().filter(rawReady);
      const res = await buildMany(jobs, parallel);
      const bad = [...res].filter(([, r]) => !r).map(([id]) => id);
      console.log(`[build] ${jobs.length - bad.length}/${jobs.length} built${bad.length ? `, failed: ${bad.join(', ')}` : ''}`);
      if (bad.length > 0) {
        process.exitCode = 1;
      }
      break;
    }
    case 'contact': {
      const jobs = selectJobs();
      const cols = parsePositiveInt(values.cols, 5, '--cols');
      const cell = parsePositiveInt(values.cell, 256, '--cell');
      const perSheet = parsePositiveInt(values.per, 20, '--per');
      const outs = await makeContacts(jobs, { name: values.name ?? values.group ?? 'all', cols, cell, perSheet, raw: !!values.raw });
      console.log(outs.join('\n'));
      break;
    }
    case 'approve': {
      let ids = positionals.slice(1);
      if (values.group || values['built-clean']) {
        ids = selectJobs()
          .filter((j) => {
            const r = readReport(j.id);
            return r && (!values['built-clean'] || r.notes.every((n) => n.startsWith('info:')));
          })
          .map((j) => j.id);
      }
      setStatus(ids, 'approved', values.note);
      console.log(`approved ${ids.length}: ${ids.join(', ')}`);
      break;
    }
    case 'reject': {
      const ids = positionals.slice(1);
      setStatus(ids, 'rejected', values.note);
      console.log(`rejected ${ids.length}: ${ids.join(', ')}`);
      break;
    }
    case 'ship': {
      let jobs = selectJobs();
      const review = loadReview();
      const gated = jobs.filter((j) => j.refs?.length && readReport(j.id) && (values.all || review[j.id]?.status === 'approved'));
      let blockedCount = 0;
      if (gated.length) {
        const checks = await assetCheck(gated.map((j) => readReport(j.id)!.main));
        const blocked = gated.filter((j) => checks.get(readReport(j.id)!.main)?.pass === false);
        blockedCount = blocked.length;
        for (const j of blocked) console.log(`blocked ${j.id}: perceptual near-duplicate of ${JSON.stringify(checks.get(readReport(j.id)!.main)?.refMatch)}`);
        jobs = jobs.filter((j) => !blocked.includes(j));
      }
      const res = ship(jobs, { all: !!values.all, mergeAggregate: true });
      console.log(`shipped ${res.shipped.length}: ${res.shipped.join(', ')}`);
      if (res.skipped.length) console.log('skipped:', JSON.stringify(res.skipped));
      if (res.manifestLine) console.log(res.manifestLine);
      if (blockedCount > 0 || (values.ids && res.skipped.length > 0)) {
        process.exitCode = 1;
      }
      break;
    }
    case 'unship': {
      const res = unship(positionals.slice(1), { mergeAggregate: true });
      if (res.manifestLine) console.log(res.manifestLine);
      break;
    }
    case 'status': {
      const jobs = loadAllJobs();
      const review = loadReview();
      const groups = new Map<string, { total: number; raw: number; built: number; approved: number; rejected: number }>();
      for (const j of jobs) {
        const g = groups.get(j.group) ?? { total: 0, raw: 0, built: 0, approved: 0, rejected: 0 };
        g.total++;
        if (existsSync(rawPath(j.id)) || rawReady(j)) g.raw++;
        if (readReport(j.id)) g.built++;
        if (review[j.id]?.status === 'approved') g.approved++;
        if (review[j.id]?.status === 'rejected') g.rejected++;
        groups.set(j.group, g);
      }
      console.table(Object.fromEntries(groups));
      break;
    }
    case 'icons': {
      if (values.legacy || process.env.ICON_PIPELINE === 'legacy') {
        if (values.dry) {
          const text = legacyIconJobsText();
          const file = join(JOBS_DIR, 'icons.jsonl');
          const same = existsSync(file) && readFileSync(file, 'utf8') === text;
          console.log(`${text.split('\n').filter(Boolean).length} legacy icon job(s) (dry run); identical to tools/imagegen/jobs/icons.jsonl: ${same}`);
        } else {
          console.log(`${emitIconJobs(false)} legacy icon job(s) written to tools/imagegen/jobs/icons.jsonl`);
        }
        break;
      }
      const c = values.collection;
      if (!isCollection(c)) throw new Error(`icons needs --collection <${ICON_COLLECTIONS.join('|')}> (or --legacy for the old 128 px jobs)`);
      if (values.check) {
        const problems = checkHints(c);
        for (const p of problems) console.log(`${p.id}: ${p.problem}`);
        console.log(`${c}: ${problems.length} problem(s) in tools/imagegen/hints/${c}.json`);
        if (problems.length) process.exitCode = 1;
        break;
      }
      if (values.gen) {
        const ids = values.ids?.split(',').filter(Boolean) ?? [];
        if (!ids.length) throw new Error('icons --gen needs --ids a,b (generate a pilot, never a whole collection blind)');
        const variants = parsePositiveInt(values.variants, 2, '--variants');
        const attempts = parsePositiveInt(values.attempts, defaultGenOptions.attempts, '--attempts');
        const timeoutSec = parsePositiveInt(values.timeout, defaultGenOptions.timeoutSec, '--timeout');
        const cell = parsePositiveInt(values.cell, defaultGenOptions.cell ?? 320, '--cell');
        if (values.pack) {
          if (values.remainder && !['pad', 'single'].includes(values.remainder)) throw new Error('--remainder must be pad|single');
          const refsPerCell = values['refs-per-cell'] !== undefined ? parsePositiveInt(values['refs-per-cell'], 2, '--refs-per-cell') : undefined;
          const maxRefs = values['max-refs'] !== undefined ? parsePositiveInt(values['max-refs'], 8, '--max-refs') : undefined;
          const out = await runPackCommand(c, ids, {
            dry: !!values.dry,
            json: !!values.json,
            gen: {
              ...defaultGenOptions,
              variants,
              effort: values.effort ?? defaultGenOptions.effort,
              attempts,
              timeoutSec,
              cell,
            },
            refsPerCell,
            maxRefs,
            remainder: (values.remainder ?? 'pad') as 'pad' | 'single',
            forcePack: !!values['force-pack'],
            sheets: values.sheet?.split(',').filter(Boolean),
          });
          return out === undefined ? undefined : json(out);
        }
        const jobs = collectionJobs(c).filter((j) => ids.includes(j.id));
        const unknown = ids.filter((id) => !jobs.some((j) => j.id === id));
        if (unknown.length) throw new Error(`not in ${c}: ${unknown.join(', ')}`);
        if (values.dry) return json(await Promise.all(jobs.map((j) => genPreview(j))));
        const opts = {
          ...defaultGenOptions,
          variants,
          effort: values.effort ?? defaultGenOptions.effort,
          attempts,
          timeoutSec,
          cell,
        };
        const res = await Promise.all(jobs.map((j) => genVariants(j, opts)));
        json(res.map((r) => ({ id: r.id, round: r.round, sheet: r.sheet, variants: r.variants.map((v) => ({ k: v.k, build: v.build, notes: v.notes, check: v.check?.pass, error: v.error })) })));
        if (res.some((r) => !r.variants.some((v) => v.build))) {
          process.exitCode = 1;
        }
        return;
      }
      const { file, jobs } = writeCollectionJobs(c, !!values.dry);
      const forms = jobs.reduce<Record<string, number>>((m, j) => ((m[j.note ?? '?'] = (m[j.note ?? '?'] ?? 0) + 1), m), {});
      console.log(`${jobs.length} ${c} icon job(s)${values.dry ? ' (dry run)' : ` written to ${file}`}: ${JSON.stringify(forms)}`);
      break;
    }
    case 'gates': {
      const c = values.collection ?? (values.ids ? collectionOf(values.ids.split(',')[0]!) : null);
      if (!isCollection(c ?? undefined)) throw new Error(`gates needs --collection <${ICON_COLLECTIONS.join('|')}>`);
      const source = (values.source ?? 'build') as GateSource;
      if (!['build', 'gen', 'shipped'].includes(source)) throw new Error('--source must be build|gen|shipped');
      return json(await runGates(c as (typeof ICON_COLLECTIONS)[number], source, values.ids?.split(',').filter(Boolean)));
    }
    case 'stats': {
      const p = join(RESEARCH, 'runs.jsonl');
      if (!existsSync(p)) return console.log('no runs yet');
      console.log(readFileSync(p, 'utf8'));
      break;
    }
    default:
      console.log(USAGE);
  }
}

if (import.meta.main) {
  const cmdName = Bun.argv[2] ?? '';
  try {
    await main();
  } catch (e) {
    console.error(`imagegen ${cmdName}: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
