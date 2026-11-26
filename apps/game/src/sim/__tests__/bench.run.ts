// bun run apps/game/src/sim/__tests__/bench.run.ts            sim cost per tick at 200/400/600 enemies (the perf bench)
// bun run apps/game/src/sim/__tests__/bench.run.ts skills      per-skill balance report of DESIGN section 8 for the 31 designed skills (all of them, or: skills berserk fear ...)
// bun run apps/game/src/sim/__tests__/bench.run.ts survival    survival gate: 10 builds x seeds x {old content card-0, new content card-0, new content defensive picks, old content defensive picks}
// env: SEEDS=11,5,7  SECONDS=300 (skills) / 480 (survival)  JSON=path (also write the rows as JSON)  BUILDS=yacha_a,ninja_a (survival: only these builds)
import { readFileSync, writeFileSync } from 'node:fs';
import { content } from '../../data/loader';
import type { SkillDef, ContentDB } from '../../data/schema';
import {
  BENCH_SEEDS, BENCH_SKILLS, BUILDS, DEFENSIVE_CARDS, blazeFamiliarsThree, median, mimicRow, runBench, runSurvival, skillReport, withBaselineSkills,
  type BenchRow, type PickPolicy, type SurvivalResult,
} from './bench';

const mode = process.argv[2] ?? 'perf';
const seeds = process.env.SEEDS ? process.env.SEEDS.split(',').map(Number) : [...BENCH_SEEDS];

function baselineDb(): ContentDB {
  const dir = new URL('../../../../../.research/rebuild/skill_logic/build/tests/baseline/', import.meta.url);
  const skills = JSON.parse(readFileSync(new URL('skills.json', dir), 'utf8')) as SkillDef[];
  const talents = JSON.parse(readFileSync(new URL('talents.json', dir), 'utf8')) as ContentDB['talents'];
  return withBaselineSkills(skills, talents);
}

if (mode === 'perf') {
  for (const [enemies, pile] of [[200, false], [400, false], [600, false], [600, true]] as const) {
    const r = runBench({ enemies, seconds: 30, pile });
    console.log(
      `${pile ? 'pile ' : 'kill '}enemies=${r.enemies} avg=${r.avgMs.toFixed(3)}ms p50=${r.p50Ms.toFixed(3)} p95=${r.p95Ms.toFixed(3)} p99=${r.p99Ms.toFixed(3)} max=${r.maxMs.toFixed(2)}`,
    );
    console.log('  ' + Object.entries(r.systems).map(([k, v]) => `${k}=${v.toFixed(3)}`).join(' '));
  }
} else if (mode === 'skills') {
  const secs = Number(process.env.SECONDS ?? 300);
  const want = process.argv.slice(3);
  const ids = want.length > 0 ? want : [...BENCH_SKILLS];
  const rows: BenchRow[] = [];
  for (const id of ids) {
    if (id === 'shadow_clone') rows.push(mimicRow(process.env.SEEDS ? seeds : undefined));
    else rows.push(...skillReport(id, seeds, undefined, secs).rows);
    if (id === 'blaze_familiars') rows.push(blazeFamiliarsThree(seeds));
    for (const r of rows.filter((x) => x.skill === id)) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.skill.padEnd(18)} ${r.metric.padEnd(48)} ${r.value}  target ${r.target}${r.note ? '  [' + r.note + ']' : ''}`);
  }
  console.log(`\n${rows.filter((r) => r.ok).length}/${rows.length} metrics inside their band`);
  if (process.env.JSON) writeFileSync(process.env.JSON, JSON.stringify(rows, null, 1));
} else if (mode === 'survival') {
  const secs = Number(process.env.SECONDS ?? 480);
  const oldDb = baselineDb();
  const out: SurvivalResult[] = [];
  const cells: { label: string; db: ContentDB; pick: PickPolicy }[] = [
    { label: 'old/card0', db: oldDb, pick: 'first' },
    { label: 'new/card0', db: content, pick: 'first' },
    { label: 'old/defensive', db: oldDb, pick: 'defensive' },
    { label: 'new/defensive', db: content, pick: 'defensive' },
  ];
  console.log('build      ' + cells.map((c) => c.label.padEnd(15)).join(''));
  const table: Record<string, Record<string, number>> = {};
  for (const [classId, doctrine] of BUILDS) {
    const build = `${classId}_${doctrine}`;
    if (process.env.BUILDS && !process.env.BUILDS.split(',').includes(build)) continue;
    const line: string[] = [];
    table[build] = {};
    for (const c of cells) {
      const rs = seeds.map((seed) => runSurvival(classId, doctrine, seed, c.pick, c.db, secs));
      out.push(...rs);
      const med = median(rs.map((r) => r.seconds));
      table[build][c.label] = med;
      line.push(`${med.toFixed(0).padStart(4)}s ${rs.map((r) => (r.alive ? '+' : '-')).join('')}`.padEnd(15));
    }
    console.log(build.padEnd(11) + line.join('') + '  defensive: ' + (DEFENSIVE_CARDS[build] ?? []).join(','));
  }
  if (process.env.JSON) writeFileSync(process.env.JSON, JSON.stringify({ table, runs: out }, null, 1));
} else {
  console.log('modes: perf | skills [ids] | survival');
}
