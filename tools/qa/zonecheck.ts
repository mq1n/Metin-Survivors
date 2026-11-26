#!/usr/bin/env bun
// Zone gate harness (zones core C0, dev only): the standard shot set per zone + palette / surface numbers + pass/fail vs
// the zone look's `targets` (render/terrain/look/<zone>.ts), and an optional pixel regression against a baseline.
//
//   bun tools/qa/zonecheck.ts --zone yeonmu|suryeon|seori|daeryeol|all
//       [--set world|hud|gallery|all]   which captures (default world; hud_* spots = live fights, gallery = top-down g3)
//       [--still]                        deterministic world capture (shot.ts --still) — use it for regression diffs
//       [--only spawn,river]             subset of spot names (still mode: diff only against a baseline shot with the
//                                        same list, render time accumulates over the list)
//       [--shots <dir>]                  no capture: measure an existing set <dir>/<zone>/<name>.png
//       [--baseline <dir> [--tol 0.5]]   diff every world shot with <dir>/<zone>/<name>.png: mean abs pixel diff (%) <= tol
//
// look.targets merged over them field by field (look.targets.roles replaces a role's {spot: box} map).
// Writes <out>/<zone>/zonecheck.json (+ stats.json) and prints a table; exit code 1 when any gate, diff, capture,
// or required shot/baseline is missing/failed, or when zero applicable checks were measured.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import zonesJson from '../../apps/game/src/data/content/zones.json';
import type { BiomePreset } from '../../apps/game/src/data/schema';
import { findLook, resolveBiome, type ZoneTargets } from '../../apps/game/src/render/terrain/look/index';

export type Box = [number, number, number, number];
export type Role = 'field' | 'cliff' | 'water' | 'edge' | 'hero';
export type Spot = [number, number, number?];

export interface Meta {
  gallery: Record<string, Record<string, { url: string; camera: Record<string, unknown> }>>;
  scale: { oursPpmAtZoom22: number; refIsoPpm: number };
  boxes: { hfField: Box; edgeLower60: Box; hero: Box };
  roles: Record<string, Partial<Record<Role, Record<string, Box | null>>>>;
  refs: Record<string, Array<{ file: string; box: Box; what?: string }>>;
}

export type CheckStatus = 'PASS' | 'FAIL' | 'INFO' | 'MISSING' | 'SKIPPED';

export interface Check {
  check: string;
  spot: string;
  value: number | string | null;
  target: string;
  status: CheckStatus;
}

export interface ZoneFilter {
  set: string;
  still: boolean;
  only: Set<string> | null;
}

export interface CaptureResult {
  logs: string[];
  errors: string[];
}

export interface ZoneSummary {
  pass: number;
  fail: number;
  info: number;
  missing: number;
  skipped: number;
  measured: number;
  captureFailed: number;
  ok: boolean;
  reasons: string[];
}

export type RunProcessFn = (cmd: string[], label: string) => Promise<{ code: number; out: string; err: string }>;
export type PyFn = (args: string[]) => Record<string, unknown>;

export interface EvaluateDeps {
  root: string;
  spotsAll: Record<string, Record<string, Spot>>;
  meta: Meta;
  content: Array<{ id: string; biome: BiomePreset }>;
  py: PyFn;
  findLook: (zone: string) => { targets?: ZoneTargets } | undefined;
  resolveBiome: (zone: string, raw: BiomePreset) => { fog: { color: string } };
  baseline: string | null;
  tol: number;
  filter: ZoneFilter;
}

const ROOT = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
export const ZONES = ['yeonmu', 'suryeon', 'seori', 'daeryeol'];

export const STARTING: Record<string, ZoneTargets> = {
  yeonmu: { luma: [88, 106], sat: [0, 95], hf: 1.5, cliffDark: 0.03, void: 0.05 },
  suryeon: { sat: [105, 125], anchors: ['#38401c', '#606c29'], hf: 1.5, cliffDark: 0.03, void: 0.05 },
  seori: { luma: [170, 255], sat: [0, 30], waterLuma: [140, 255], waterSat: 90, hf: 1.5, cliffDark: 0.03 },
  daeryeol: { luma: [48, 56], hf: 1.5, cliffDark: 0.03, void: 0.05 },
};

const boxArg = (b: Box | null | undefined): string[] => (b ? ['--box', b.join(',')] : []);
export const isHud = (name: string): boolean => /^hud/i.test(name);
const fmt = (v: number): string => (Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(3));

/** Returns true when a spot is required under the active `--set`, `--still`, and `--only` filters. */
export function isSpotSelected(name: string, filter: ZoneFilter, galleryNames: ReadonlySet<string>): boolean {
  if (filter.only && !filter.only.has(name)) return false;
  if (galleryNames.has(name)) return filter.set === 'gallery' || filter.set === 'all';
  if (isHud(name)) return (filter.set === 'hud' || filter.set === 'all') && !filter.still;
  return filter.set === 'world' || filter.set === 'all';
}

function lab(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const c = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const x = (c[0] * 0.4124 + c[1] * 0.3576 + c[2] * 0.1805) / 0.95047;
  const y = c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
  const z = (c[0] * 0.0193 + c[1] * 0.1192 + c[2] * 0.9505) / 1.08883;
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

const dE = (a: string, b: string): number => {
  const p = lab(a);
  const q = lab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};

async function runDefault(cmd: string[], label: string): Promise<{ code: number; out: string; err: string }> {
  const p = Bun.spawn(cmd, { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  const code = await p.exited;
  if (code !== 0) console.error(`[zonecheck] ${label} exited ${code}\n${err.slice(-1500)}\n${out.slice(-1500)}`);
  return { code, out, err };
}

function pyDefault(args: string[]): Record<string, unknown> {
  const p = Bun.spawnSync(['python', 'tools/qa/compose.py', ...args], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' });
  const txt = p.stdout.toString().trim().split('\n').pop() ?? '';
  try {
    return JSON.parse(txt) as Record<string, unknown>;
  } catch {
    throw new Error(`compose.py ${args[0]} failed: ${p.stderr.toString().slice(-800)}`);
  }
}

// ------------------------------------------------------------------------------------------------------- capture
export async function captureZone(
  zone: string,
  dir: string,
  opts: {
    spotsAll: Record<string, Record<string, Spot>>;
    meta: Meta;
    filter: ZoneFilter;
    run?: RunProcessFn;
  },
): Promise<CaptureResult> {
  const runFn = opts.run ?? runDefault;
  const { set, still, only } = opts.filter;
  const spots = Object.entries(opts.spotsAll[zone] ?? {}).filter(([n]) => !only || only.has(n));
  const spec = (list: Array<[string, Spot]>): string => list.map(([n, v]) => `${n}:${v.filter((x) => x !== undefined).join(',')}`).join(';');
  const world = spots.filter(([n]) => !isHud(n));
  const hud = spots.filter(([n]) => isHud(n));
  const jobs: Array<{ label: string; promise: Promise<{ code: number; out: string; err: string }> }> = [];
  const base = ['bun', 'tools/qa/shot.ts', 'game', '--zone', zone, '--class', 'warrior', '--quality', 'high'];
  if ((set === 'world' || set === 'all') && world.length) {
    const label = `${zone} world`;
    jobs.push({ label, promise: runFn([...base, '--ui', 'none', ...(still ? ['--still'] : []), '--spots', spec(world), '--out', dir], label) });
  }
  if ((set === 'hud' || set === 'all') && hud.length && !still) {
    const label = `${zone} hud`;
    jobs.push({ label, promise: runFn([...base, '--ui', 'real', '--advance', '20', '--time', '200', '--settle', '6', '--spots', spec(hud), '--out', dir], label) });
  }
  if (set === 'gallery' || set === 'all') {
    for (const [name, g] of Object.entries(opts.meta.gallery[zone] ?? {})) {
      if (only && !only.has(name)) continue;
      const ev = `await new Promise(r=>setTimeout(r,4000)); window.__gallery.setCamera('wide',${JSON.stringify(g.camera)}); await new Promise(r=>setTimeout(r,2500));`;
      const label = `${zone} gallery ${name}`;
      jobs.push({
        label,
        promise: runFn(['bun', 'tools/qa/shot.ts', 'url', '--url', g.url, '--wait', 'window.__gallery!==undefined', '--eval', ev, '--out', join(dir, `${name}.png`)], label),
      });
    }
  }
  const settled = await Promise.all(jobs.map(async (j) => ({ label: j.label, res: await j.promise })));
  const logs: string[] = [];
  const errors: string[] = [];
  for (const { label, res } of settled) {
    logs.push(res.out);
    if (res.code !== 0) {
      errors.push(`${label}: exit ${res.code}${res.err.trim() ? ` (${res.err.trim().split('\n').pop()})` : ''}`);
    }
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '_capture_log.txt'), logs.join('\n'));
  return { logs, errors };
}

// ---------------------------------------------------------------------------------------------------------- gates
export function evaluateZone(
  zone: string,
  dir: string,
  deps: EvaluateDeps,
  captureErrors: readonly string[] = [],
): { checks: Check[]; stats: Record<string, unknown> } {
  const { root, spotsAll, meta, content, py, baseline, tol, filter } = deps;
  const look = deps.findLook(zone);
  const lt = look?.targets ?? {};
  const t: ZoneTargets = { ...STARTING[zone], ...Object.fromEntries(Object.entries(lt).filter(([, v]) => v !== undefined)) };
  const roles: Partial<Record<Role, Record<string, Box | null>>> = { ...(meta.roles[zone] ?? {}), ...(lt.roles ?? {}) };
  const spots = spotsAll[zone] ?? {};
  const galleryNames = new Set(Object.keys(meta.gallery[zone] ?? {}));
  const has = (name: string): string | null => {
    const f = join(dir, `${name}.png`);
    return existsSync(f) ? f : null;
  };
  const checks: Check[] = [];
  const add = (check: string, spot: string, value: number | string | null, target: string, ok: boolean | null): void => {
    checks.push({ check, spot, value, target, status: value === null ? 'MISSING' : ok === null ? 'INFO' : ok ? 'PASS' : 'FAIL' });
  };
  const skip = (check: string, spot: string): void => {
    checks.push({ check, spot, value: null, target: 'excluded by filter', status: 'SKIPPED' });
  };

  for (const err of captureErrors) {
    checks.push({ check: 'capture', spot: zone, value: err, target: 'exit 0', status: 'FAIL' });
  }

  // stats of every shot (whole frame, compose.py stats = the numbers the audits quote)
  const stats: Record<string, unknown> = {};
  const pngFiles = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.png')) : [];
  for (const f of pngFiles) {
    const name = f.replace(/\.png$/, '');
    if (!isSpotSelected(name, filter, galleryNames)) continue;
    stats[name] = py(['stats', '--in', join(dir, f)]);
  }

  const selectedFieldNames = Object.keys(roles.field ?? {}).filter((name) => isSpotSelected(name, filter, galleryNames));
  const refs = meta.refs[zone] ?? [];
  let refMean = NaN;
  if (selectedFieldNames.length > 0 && refs.length > 0) {
    const refVals: number[] = [];
    let allRefsExist = true;
    for (const r of refs) {
      const refPath = join(root, r.file);
      if (!existsSync(refPath)) {
        allRefsExist = false;
        break;
      }
      refVals.push(Number(py(['measure', '--in', refPath, ...boxArg(r.box), '--ppm', String(meta.scale.refIsoPpm), '--norm', String(meta.scale.refIsoPpm)]).hf));
    }
    if (allRefsExist && refVals.length > 0 && refVals.every(Number.isFinite)) {
      refMean = refVals.reduce((a, b) => a + b, 0) / refVals.length;
    }
  }

  const dominants: string[] = [];
  for (const [name, box] of Object.entries(roles.field ?? {})) {
    if (!isSpotSelected(name, filter, galleryNames)) {
      skip('field', name);
      continue;
    }
    const f = has(name);
    if (!f) {
      add('field', name, null, 'shot', null);
      continue;
    }
    const m = py(['measure', '--in', f, ...boxArg(box)]) as { mean_luma: number; mean_saturation: number };
    add('field.luma', name, m.mean_luma, t.luma ? `${t.luma[0]}..${t.luma[1]}` : '-', t.luma ? m.mean_luma >= t.luma[0] && m.mean_luma <= t.luma[1] : null);
    add('field.sat', name, m.mean_saturation, t.sat ? `${t.sat[0]}..${t.sat[1]}` : '-', t.sat ? m.mean_saturation >= t.sat[0] && m.mean_saturation <= t.sat[1] : null);
    // anchors are matched against the whole-frame dominant colours (compose.py stats)
    const st = stats[name] as { dominant?: Array<[string, number]> } | undefined;
    for (const [hex] of st?.dominant ?? []) dominants.push(hex);
    const zoom = (spots[name]?.[2] as number | undefined) || 22;
    const ppm = (meta.scale.oursPpmAtZoom22 * 22) / zoom;
    const h = py(['measure', '--in', f, ...boxArg(box ?? meta.boxes.hfField), '--ppm', String(ppm), '--norm', String(meta.scale.refIsoPpm)]) as { hf: number };
    const ratio = refMean > 0 ? h.hf / refMean : NaN;
    add('field.hfRatio', name, Number.isFinite(ratio) ? Number(ratio.toFixed(2)) : null, t.hf !== undefined ? `<= ${t.hf} (ref hf ${fmt(refMean)})` : '-', t.hf !== undefined && Number.isFinite(ratio) ? ratio <= t.hf : null);
  }
  for (const a of t.anchors ?? []) {
    if (selectedFieldNames.length === 0) {
      skip('field.anchor', a);
      continue;
    }
    const best = dominants.length ? Math.min(...dominants.map((d) => dE(a, d))) : NaN;
    const lim = t.anchorDE ?? 14;
    add('field.anchor', a, Number.isFinite(best) ? Number(best.toFixed(1)) : null, `dE <= ${lim}`, Number.isFinite(best) ? best <= lim : null);
  }

  // cliff: dark share and mean luma of the crop
  for (const [name, box] of Object.entries(roles.cliff ?? {})) {
    if (!isSpotSelected(name, filter, galleryNames)) {
      skip('cliff', name);
      continue;
    }
    const f = has(name);
    if (!f) {
      add('cliff', name, null, 'shot', null);
      continue;
    }
    const m = py(['measure', '--in', f, ...boxArg(box)]) as { mean_luma: number; dark_frac: number };
    add('cliff.dark', name, m.dark_frac, `<= ${t.cliffDark ?? 0.03}`, m.dark_frac <= (t.cliffDark ?? 0.03));
    add('cliff.luma', name, m.mean_luma, t.cliffLuma !== undefined ? `>= ${t.cliffLuma}` : '-', t.cliffLuma !== undefined ? m.mean_luma >= t.cliffLuma : null);
  }

  // water / lava / ice
  for (const [name, box] of Object.entries(roles.water ?? {})) {
    if (!isSpotSelected(name, filter, galleryNames)) {
      skip('water', name);
      continue;
    }
    const f = has(name);
    if (!f) {
      add('water', name, null, 'shot', null);
      continue;
    }
    const m = py(['measure', '--in', f, ...boxArg(box)]) as { mean_luma: number; mean_saturation: number };
    add('water.luma', name, m.mean_luma, t.waterLuma ? `${t.waterLuma[0]}..${t.waterLuma[1]}` : '-', t.waterLuma ? m.mean_luma >= t.waterLuma[0] && m.mean_luma <= t.waterLuma[1] : null);
    add('water.sat', name, m.mean_saturation, t.waterSat !== undefined ? `<= ${t.waterSat}` : '-', t.waterSat !== undefined ? m.mean_saturation <= t.waterSat : null);
  }

  // edge: featureless fog-coloured share of the lower 60 % (void / fog wall)
  const raw = content.find((z) => z.id === zone)?.biome;
  const fog = raw ? deps.resolveBiome(zone, raw).fog.color : '#808080';
  for (const [name, box] of Object.entries(roles.edge ?? {})) {
    if (!isSpotSelected(name, filter, galleryNames)) {
      skip('edge', name);
      continue;
    }
    const f = has(name);
    if (!f) {
      add('edge', name, null, 'shot', null);
      continue;
    }
    const m = py(['measure', '--in', f, ...boxArg(box ?? meta.boxes.edgeLower60), '--near', fog, '--de', '4']) as { flat_near_frac: number; near_frac: number };
    add('edge.void', name, m.flat_near_frac, t.void !== undefined ? `<= ${t.void} (fog ${fog})` : '-', t.void !== undefined ? m.flat_near_frac <= t.void : null);
  }

  // hero: screen-door energy round the hero
  for (const [name, box] of Object.entries(roles.hero ?? {})) {
    if (!isSpotSelected(name, filter, galleryNames)) {
      skip('hero', name);
      continue;
    }
    const f = has(name);
    if (!f) {
      add('hero', name, null, 'shot', null);
      continue;
    }
    const m = py(['measure', '--in', f, ...boxArg(box ?? meta.boxes.hero)]) as { fine: number };
    add('hero.fine', name, m.fine, t.fine !== undefined ? `<= ${t.fine}` : 'report', t.fine !== undefined ? m.fine <= t.fine : null);
  }

  // regression vs a baseline set (selected non-HUD shots; missing baseline PNG is a blocking MISSING check)
  if (baseline) {
    const diffTargets = new Set<string>();
    for (const f of pngFiles) {
      const name = f.replace(/\.png$/, '');
      if (isHud(name) || !isSpotSelected(name, filter, galleryNames)) continue;
      diffTargets.add(name);
    }
    for (const role of ['field', 'cliff', 'water', 'edge', 'hero'] as const) {
      for (const name of Object.keys(roles[role] ?? {})) {
        if (isHud(name) || !isSpotSelected(name, filter, galleryNames)) continue;
        diffTargets.add(name);
      }
    }
    for (const name of [...diffTargets].sort()) {
      const shotPath = has(name);
      const b = join(baseline, zone, `${name}.png`);
      if (!existsSync(b)) {
        add('diff', name, null, `baseline ${b}`, null);
        continue;
      }
      if (!shotPath) {
        add('diff', name, null, `shot ${join(dir, `${name}.png`)}`, null);
        continue;
      }
      const d = py(['diff', '--a', b, '--b', shotPath]) as { mad_pct?: number; error?: string };
      add('diff.madPct', name, d.mad_pct ?? d.error ?? null, `<= ${tol}`, d.mad_pct !== undefined ? d.mad_pct <= tol : false);
    }
  }

  return { checks, stats };
}

/** Summarizes check results and determines whether the zone passed all gating requirements. */
export function summarizeChecks(checks: readonly Check[], captureErrors: readonly string[] = []): ZoneSummary {
  let pass = 0;
  let fail = 0;
  let info = 0;
  let missing = 0;
  let skipped = 0;
  let measured = 0;

  for (const c of checks) {
    if (c.status === 'PASS') {
      pass++;
      if (c.check !== 'capture') measured++;
    } else if (c.status === 'FAIL') {
      fail++;
      if (c.check !== 'capture') measured++;
    } else if (c.status === 'INFO') {
      info++;
      measured++;
    } else if (c.status === 'MISSING') {
      missing++;
    } else {
      skipped++;
    }
  }

  const captureFailed = Math.max(captureErrors.length, checks.filter((c) => c.check === 'capture' && c.status === 'FAIL').length);
  const reasons: string[] = [];
  if (captureFailed > 0) reasons.push(`${captureFailed} capture subprocess(es) failed`);
  if (fail > 0) reasons.push(`${fail} check(s) failed`);
  if (missing > 0) reasons.push(`${missing} required capture/baseline/reference missing`);
  if (measured === 0) reasons.push('zero applicable checks were measured');

  return {
    pass,
    fail,
    info,
    missing,
    skipped,
    measured,
    captureFailed,
    ok: reasons.length === 0,
    reasons,
  };
}

/** Returns 0 only when at least one zone was checked and every zone passed with measured checks and zero missing/failed prerequisites. */
export function gateExitCode(summaries: Record<string, ZoneSummary>): number {
  const vals = Object.values(summaries);
  if (vals.length === 0) return 1;
  return vals.every((s) => s.ok) ? 0 : 1;
}

// ------------------------------------------------------------------------------------------------------------ main
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const opts = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? '';
    if (!a.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) opts.set(a.slice(2), '1');
    else {
      opts.set(a.slice(2), next);
      i++;
    }
  }
  if (!opts.has('zone')) {
    console.log(readFileSync(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'utf8').split('\nimport ')[0]);
    process.exit(1);
  }
  const zoneArg = opts.get('zone') as string;
  const zones = zoneArg === 'all' ? ZONES : zoneArg.split(',');
  for (const z of zones) if (!ZONES.includes(z)) throw new Error(`unknown zone ${z}`);
  const set = opts.get('set') ?? 'world';
  const still = opts.has('still') && opts.get('still') !== '0';
  const only = opts.has('only') ? new Set((opts.get('only') as string).split(',').filter(Boolean)) : null;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const OUT = resolve(ROOT, opts.get('out') ?? `.research/zones_core/check/${stamp}`);
  const SHOTS = opts.has('shots') ? resolve(ROOT, opts.get('shots') as string) : null;
  const BASE = opts.has('baseline') ? resolve(ROOT, opts.get('baseline') as string) : null;
  const TOL = Number(opts.get('tol') ?? 0.5);

  const spotsAll = JSON.parse(readFileSync(join(ROOT, '.research/zones_core/spots.json'), 'utf8')) as Record<string, Record<string, Spot>>;
  const meta = JSON.parse(readFileSync(join(ROOT, '.research/zones_core/spots_meta.json'), 'utf8')) as Meta;
  const content = zonesJson as unknown as Array<{ id: string; biome: BiomePreset }>;
  const filter: ZoneFilter = { set, still, only };

  mkdirSync(OUT, { recursive: true });
  const dirs = new Map<string, string>();
  for (const z of zones) {
    const d = SHOTS ? join(SHOTS, z) : join(OUT, z);
    mkdirSync(join(OUT, z), { recursive: true });
    dirs.set(z, d);
  }

  const captureErrsByZone = new Map<string, string[]>();
  if (!SHOTS) {
    await Promise.all(
      zones.map(async (z) => {
        const res = await captureZone(z, dirs.get(z) as string, { spotsAll, meta, filter });
        captureErrsByZone.set(z, res.errors);
      }),
    );
  }

  const summary: Record<string, ZoneSummary> = {};
  for (const z of zones) {
    const capErrs = captureErrsByZone.get(z) ?? [];
    const { checks, stats } = evaluateZone(
      z,
      dirs.get(z) as string,
      { root: ROOT, spotsAll, meta, content, py: pyDefault, findLook, resolveBiome, baseline: BASE, tol: TOL, filter },
      capErrs,
    );
    writeFileSync(join(OUT, z, 'stats.json'), JSON.stringify(stats, null, 1));
    writeFileSync(join(OUT, z, 'zonecheck.json'), JSON.stringify({ zone: z, shots: dirs.get(z), still, baseline: BASE, tol: TOL, checks }, null, 1));
    const s = summarizeChecks(checks, capErrs);
    console.log(`\n== ${z}  (${dirs.get(z)})`);
    for (const c of checks) {
      const v = typeof c.value === 'number' ? fmt(c.value) : String(c.value);
      console.log(`  ${c.status.padEnd(7)} ${c.check.padEnd(14)} ${c.spot.padEnd(14)} ${v.padStart(9)}   ${c.target}`);
    }
    if (!s.ok) console.error(`  GATE FAIL (${z}): ${s.reasons.join('; ')}`);
    summary[z] = s;
  }
  writeFileSync(join(OUT, 'summary.json'), JSON.stringify({ out: OUT, still, baseline: BASE, summary }, null, 1));
  console.log(`\n${JSON.stringify({ out: OUT, summary })}`);
  process.exit(gateExitCode(summary));
}

if (import.meta.main) {
  await main();
}
