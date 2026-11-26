// Skill report bench (DESIGN section 8 METHOD, ported from the scratch harnesses systems_bench / feel_bench / fantasy_bench and the builders'
// bench_c1 / bench_c2): REAL content, the card-0 kiting bot of bot.ts, one skill + the class basic, per skill the numbers the balance targets name:
// solo dps by window, fires per minute, window uptime, armed share, intake cut (share of the post-armor blows the shells soaked), dodges, saves.
// Library only: bench.run.ts prints the report (`bun run apps/game/src/sim/__tests__/bench.run.ts skills`), benchSkills.test.ts keeps it alive.
// Re-exported from bench.ts. Nothing here touches the sim: it reads world state after each step and wraps PlayerState.pushHurt on the instance.

import { content } from '../../data/loader';
import type { ClassId, ContentDB, SkillDef, StatMods } from '../../data/schema';
import { addSkill, applySkillLine } from '../skills';
import { activeLeft } from '../skills/trigger';
import { spawnEnemy } from '../enemies';
import { EnemyState, ProjKind, type PlayerState, type SkillInstance } from '../stores';
import { createWorld, type World } from '../world';
import { botInput } from './bot';
import { drainModals } from './helpers';

export type BenchPreset = 'plain' | 'mid' | 'strong' | 'design';

/** meta stats of the bench hero. mid = armor 20 regen 1; strong = the autoplayer "seasoned" hero without the damage bonus; design = the scratch harness default (series bench) */
export const BENCH_PRESETS: Record<BenchPreset, StatMods> = {
  plain: {},
  mid: { armor: 20, regen: 1, damage: 0 },
  strong: { maxHpPct: 4, armor: 80, regen: 6, damage: 0 },
  design: { armor: 20, regen: 1, damage: 0.15 },
};

/** one zone per class, as in the scratch harnesses */
export const BENCH_ZONE: Record<string, string> = { warrior: 'yeonmu', ninja: 'suryeon', yacha: 'seori', shaman: 'daeryeol', wolfman: 'yeonmu' };

export const BENCH_SEEDS: readonly number[] = [11, 5, 7];

export interface SkillBenchOpts {
  skill: string;
  classId?: ClassId;
  doctrine?: 'a' | 'b';
  seed?: number;
  preset?: BenchPreset;
  /** sim seconds (default 300) */
  seconds?: number;
  /** seconds before the rate counters start (default 30) */
  warmup?: number;
  rank?: number;
  /** more skills at rank 0 */
  extra?: string[];
  /** the skill is NOT owned (baseline run with the same class / seed) */
  absent?: boolean;
  /** count +n flat lines (flame spirit 3 spirits = 2) */
  countPlus?: number;
  /** content override (the old content baseline); default the shipped content */
  db?: ContentDB;
  /** World.qaForceTriggers (gate ignored: the "ungated" reference) */
  force?: boolean;
}

export interface BenchSnap {
  t: number;
  skill: number;
  basic: number;
  total: number;
}

export interface SkillBenchResult {
  skill: string;
  classId: string;
  doctrine: string;
  preset: BenchPreset;
  seed: number;
  /** sim seconds reached (run end or death) */
  sim: number;
  alive: boolean;
  diedAt: number;
  level: number;
  hpMax: number;
  /** rates over [warmup, end] */
  measured: number;
  fires: number;
  firesPerMin: number;
  uptime: number;
  armedShare: number;
  /** skill / basic / total damage per second over [warmup, end] */
  dps: number;
  basicDps: number;
  totalDps: number;
  /** HP actually lost per minute, and the post-armor blows per minute before ward / shield */
  intakePerMin: number;
  incomingPerMin: number;
  /** share of the post-armor blows the ward / shield soaked: 1 - taken / incoming */
  cut: number;
  breaksPerMin: number;
  absorbPerMin: number;
  wardShare: number;
  dodgesPerMin: number;
  veilsPerMin: number;
  burstsPerMin: number;
  saves: number;
  /** sim time of every fire, for the gap between two fires */
  fireTimes: number[];
  /** highest HP fraction a fire started at */
  fireHpFracMax: number;
  snaps: BenchSnap[];
}

function dbClone(db: ContentDB): ContentDB {
  return JSON.parse(JSON.stringify(db)) as ContentDB;
}

export function benchWorld(classId: ClassId, doctrine: 'a' | 'b', seed: number, preset: BenchPreset, db: ContentDB = content): World {
  const cls = db.classes.find((c) => c.id === classId);
  if (!cls) throw new Error(`no class ${classId}`);
  return createWorld({ zone: BENCH_ZONE[classId] ?? 'yeonmu', difficulty: 'normal', classId, doctrine, sex: cls.sexes[0] ?? 'm', empire: 'saehwa', seed, meta: { stats: BENCH_PRESETS[preset] } }, db);
}

function companionRows(w: World, slot: number): boolean {
  const P = w.projectiles;
  for (let i = 0; i < P.count; i++) if (P.kind[i] === ProjKind.Familiar && P.skill[i] === slot) return true;
  return false;
}

/** one run of one skill. Deterministic for a given option set (the world is seeded and the bot is a pure function of the world). */
export function runSkillBench(o: SkillBenchOpts): SkillBenchResult {
  const db = o.db ?? content;
  const def = db.skills.find((s) => s.id === o.skill);
  if (!def) throw new Error(`no skill ${o.skill}`);
  const classId = (o.classId ?? def.classId) as ClassId;
  const doctrine = (o.doctrine ?? def.doctrine ?? 'a') as 'a' | 'b';
  const seed = o.seed ?? 11;
  const preset = o.preset ?? 'mid';
  const seconds = o.seconds ?? 300;
  const warm = o.warmup ?? 30;
  const w = benchWorld(classId, doctrine, seed, preset, db);
  const p: PlayerState = w.players[0] as PlayerState;
  const basic = p.skills[0] as SkillInstance;
  p.skills.length = 0;
  p.skills.push(basic);
  let inst: SkillInstance | null = null;
  if (!o.absent) inst = addSkill(w, p, def, o.rank ?? 0);
  for (const id of o.extra ?? []) {
    const d = db.skills.find((s) => s.id === id);
    if (!d) throw new Error(`no skill ${id}`);
    addSkill(w, p, d, 0);
  }
  if (inst && (o.countPlus ?? 0) > 0) applySkillLine(inst, { stat: 'count', mode: 'flat', value: o.countPlus as number });
  if (o.force) w.qaForceTriggers = true;

  // the post-armor blow before any ward / shield (the hurt ring input); the sum is the "incoming" of the intake cut
  let counting = false;
  let incoming = 0;
  const origPush = p.pushHurt.bind(p);
  p.pushHurt = (t: number, a: number): void => {
    if (counting) incoming += a;
    origPush(t, a);
  };

  const total = Math.round(seconds * 60);
  const warmTicks = Math.round(warm * 60);
  const snaps: BenchSnap[] = [];
  const fireTimes: number[] = [];
  let fires = 0;
  let up = 0;
  let armed = 0;
  let ticks = 0;
  let prevCd = inst ? inst.cd : 0;
  let prevHpFrac = 1;
  let fireHpFracMax = 0;
  let diedAt = -1;
  let dodges = 0;
  let breaks = 0;
  let bursts = 0;
  let saves = 0;
  let wardTicks = 0;
  let veils = 0;
  let prevVeil = 0;
  let absorbed = 0;
  let lastAbs = 0;
  let dmg0 = 0;
  let basic0 = 0;
  let total0 = 0;
  let taken0 = 0;
  for (let t = 0; t < total && !w.over; t++) {
    drainModals(w);
    prevHpFrac = p.hp / Math.max(1, p.hpMax);
    w.step([botInput(w, t)]);
    if (t % 1800 === 0) snaps.push({ t: w.time, skill: inst ? inst.damage : 0, basic: basic.damage, total: w.tally.damageDealt });
    if (t === warmTicks) {
      counting = true;
      dmg0 = inst ? inst.damage : 0;
      basic0 = basic.damage;
      total0 = w.tally.damageDealt;
      taken0 = w.tally.damageTaken;
      incoming = 0;
      lastAbs = p.wardAbsorbed;
    }
    if (inst && inst.cd > prevCd + 1e-6 && t >= warmTicks) {
      fires++;
      fireTimes.push(w.time);
      if (prevHpFrac > fireHpFracMax) fireHpFracMax = prevHpFrac;
    }
    if (inst) prevCd = inst.cd;
    if (t >= warmTicks) {
      ticks++;
      if (inst) {
        let on = activeLeft(w, p, inst) > 0.001;
        if (!on && inst.def.behavior === 'summon') on = companionRows(w, inst.slot);
        if (on) up++;
        else if (inst.cd <= 0 && inst.def.trigger) armed++;
      }
      for (const e of w.events) {
        if (e.t !== 'vfx') continue;
        const id = e.preset;
        if (id === 'sk.gen.ward_break') breaks++;
        else if (id === 'sk.gen.dodge_hop') dodges++;
        else if (inst && id.startsWith('sk.' + inst.def.id + '.')) {
          const part = id.slice(4 + inst.def.id.length);
          if (part === 'burst' || part === 'shatter' || part === 'pulse') bursts++;
          else if (part === 'save') saves++;
        }
      }
      if (p.ward > 0) wardTicks++;
      if (p.wardAbsorbed > lastAbs) absorbed += p.wardAbsorbed - lastAbs;
      lastAbs = p.wardAbsorbed;
      if (p.veilT > 0 && prevVeil <= 0) veils++;
      prevVeil = p.veilT;
    }
    if (!p.alive && diedAt < 0) diedAt = w.time;
  }
  p.pushHurt = origPush;
  snaps.push({ t: w.time, skill: inst ? inst.damage : 0, basic: basic.damage, total: w.tally.damageDealt });
  const dur = Math.max(1, w.time - warm);
  const taken = w.tally.damageTaken - taken0;
  const per = (n: number): number => (n / dur) * 60;
  return {
    skill: o.skill,
    classId,
    doctrine,
    preset,
    seed,
    sim: w.time,
    alive: p.alive,
    diedAt,
    level: p.level,
    hpMax: p.hpMax,
    measured: dur,
    fires,
    firesPerMin: per(fires),
    uptime: up / Math.max(1, ticks),
    armedShare: armed / Math.max(1, ticks),
    dps: inst ? (inst.damage - dmg0) / dur : 0,
    basicDps: (basic.damage - basic0) / dur,
    totalDps: (w.tally.damageDealt - total0) / dur,
    intakePerMin: per(taken),
    incomingPerMin: per(incoming),
    cut: incoming > 1 ? Math.max(0, 1 - taken / incoming) : 0,
    breaksPerMin: per(breaks),
    absorbPerMin: per(absorbed),
    wardShare: wardTicks / Math.max(1, ticks),
    dodgesPerMin: per(dodges),
    veilsPerMin: per(veils),
    burstsPerMin: per(bursts),
    saves,
    fireTimes,
    fireHpFracMax,
    snaps,
  };
}

/** skill damage per second between two sim times, read from the 30 s snapshots (NaN when the run ended before `to`) */
export function windowDps(r: SkillBenchResult, from: number, to: number, key: 'skill' | 'total' = 'skill'): number {
  const a = r.snaps.find((s) => Math.abs(s.t - from) < 1);
  const b = r.snaps.find((s) => Math.abs(s.t - to) < 1);
  if (!a || !b) return Number.NaN;
  return (b[key] - a[key]) / (b.t - a.t);
}

export function median(xs: number[]): number {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return Number.NaN;
  const m = v.length >> 1;
  return v.length % 2 ? (v[m] as number) : ((v[m - 1] as number) + (v[m] as number)) / 2;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// targets (DESIGN section 8 TARGETS + the per-skill balance targets of section 5)

export interface BenchRow {
  skill: string;
  metric: string;
  value: string;
  target: string;
  ok: boolean;
  note?: string;
}

interface Agg {
  runs: SkillBenchResult[];
  /** median over the seeds of a result field */
  m: (f: (r: SkillBenchResult) => number) => number;
  presetUsed: BenchPreset;
}

interface Metric {
  name: string;
  get: (a: Agg) => number;
  lo: number;
  hi: number;
  unit?: string;
  note?: string;
}

interface Spec {
  /** which preset judges the rates: auto = mid unless the build dies before 150 s there */
  preset: BenchPreset | 'auto';
  metrics: Metric[];
  /** run options (extra skills, count lines) */
  run?: Partial<SkillBenchOpts>;
}

const pct = (x: number): number => x * 100;
const lateDps = (a: Agg): number => a.m((r) => windowDps(r, 120, Math.min(300, Math.floor(r.sim / 30) * 30)));
const dpsFrom = (from: number, to: number) => (a: Agg): number => a.m((r) => windowDps(r, from, to));
const uptimePct = (a: Agg): number => pct(a.m((r) => r.uptime));
const firesMin = (a: Agg): number => a.m((r) => r.firesPerMin);
const cutPct = (a: Agg): number => pct(a.m((r) => r.cut));
const wholeDps = (a: Agg): number => a.m((r) => r.dps);

/** the targets of DESIGN section 8 (TARGETS) plus the section 5 "Balance target" lines, as numeric bands. dps bands are judged on the strong preset (a seasoned hero lives to 300 s). */
export const SKILL_SPECS: Record<string, Spec> = {
  warfever: { preset: 'auto', metrics: [{ name: 'uptime %', get: uptimePct, lo: 35, hi: 42 }] },
  second_wind: {
    preset: 'auto',
    metrics: [{ name: 'fires/min', get: firesMin, lo: 1.5, hi: 3 }],
  },
  war_oath: { preset: 'mid', metrics: [{ name: 'saves per 80 s (natural run; the forced-lethal run is in shells.test)', get: (a) => a.m((r) => (r.saves / Math.max(1, r.measured)) * 80), lo: 0, hi: 1 }] },
  swordlight_ring: { preset: 'strong', metrics: [{ name: 'dps (unchanged)', get: wholeDps, lo: 34, hi: 50 }] },
  graniteform: {
    preset: 'auto',
    metrics: [
      { name: 'fires/min', get: firesMin, lo: 1.2, hi: 1.8 },
      { name: 'intake cut %', get: cutPct, lo: 25, hi: 40 },
    ],
  },
  nightshroud: { preset: 'auto', metrics: [{ name: 'veils/min', get: (a) => a.m((r) => r.veilsPerMin), lo: 1.4, hi: 2.2 }] },
  swallows_gait: {
    preset: 'auto',
    metrics: [
      { name: 'fires/min', get: firesMin, lo: 2.5, hi: 3.3 },
      { name: 'dodges per fire', get: (a) => a.m((r) => (r.firesPerMin > 0 ? r.dodgesPerMin / r.firesPerMin : 0)), lo: 1, hi: 2 },
    ],
  },
  smoke_bomb: { preset: 'strong', metrics: [{ name: 'dps', get: wholeDps, lo: 18, hi: 25 }] },
  eagle_eye: { preset: 'auto', metrics: [{ name: 'uptime %', get: uptimePct, lo: 28, hi: 38 }] },
  chilling_dread: {
    preset: 'strong',
    metrics: [
      { name: 'fires/min', get: firesMin, lo: 3, hi: 5 },
      { name: 'dps', get: wholeDps, lo: 25, hi: 35 },
    ],
  },
  umbral_plate: {
    preset: 'auto',
    metrics: [
      { name: 'fires/min', get: firesMin, lo: 1.8, hi: 2.2 },
      { name: 'intake cut %', get: cutPct, lo: 15, hi: 22 },
    ],
  },
  haunted_steel: { preset: 'strong', metrics: [{ name: 'dps', get: wholeDps, lo: 25, hi: 40 }] },
  unbinding_sigil: { preset: 'strong', metrics: [{ name: 'dps at 120 s+', get: lateDps, lo: 60, hi: 95 }] },
  cursed_legion: { preset: 'strong', metrics: [{ name: 'dps average', get: wholeDps, lo: 150, hi: 260 }] },
  blaze_familiars: {
    preset: 'strong',
    metrics: [
      { name: 'dps 60-120 s (1 spirit)', get: dpsFrom(60, 120), lo: 25, hi: 45 },
      { name: 'dps 120-210 s (1 spirit)', get: dpsFrom(120, 210), lo: 40, hi: 60 },
    ],
  },
  obsidian_bulwark: { preset: 'auto', metrics: [{ name: 'intake cut %', get: cutPct, lo: 15, hi: 22 }] },
  dark_covenant: { preset: 'auto', metrics: [{ name: 'uptime %', get: uptimePct, lo: 30, hi: 38 }] },
  radiant_favor: {
    preset: 'auto',
    metrics: [
      { name: 'fires/min', get: firesMin, lo: 2, hi: 2.5 },
      { name: 'intake cut %', get: cutPct, lo: 14, hi: 22, note: 'target 18 %' },
    ],
  },
  mirror_shell: { preset: 'auto', metrics: [{ name: 'intake cut %', get: cutPct, lo: 10, hi: 14 }] },
  wyrm_retinue: { preset: 'strong', metrics: [{ name: 'dps average (own breath + knock)', get: wholeDps, lo: 20, hi: 35 }] },
  sovereigns_ire: {
    preset: 'strong',
    metrics: [{ name: 'dps equivalent (wave + 1 buffed hero)', get: (a) => a.m((r) => r.dps + r.uptime * 0.2 * (r.totalDps - r.dps)), lo: 110, hi: 200, note: 'equivalent: own wave dps + the party damage window on one hero (+20 %)' }],
  },
  mending_light: {
    preset: 'strong',
    metrics: [{ name: 'highest HP % at a fire (solo: only under 55 %)', get: (a) => a.m((r) => (r.fires > 0 ? pct(r.fireHpFracMax) : 0)), lo: 0, hi: 56 }],
  },
  thunder_guardians: { preset: 'strong', metrics: [{ name: 'dps average', get: wholeDps, lo: 120, hi: 160 }] },
  stormglass_shell: {
    preset: 'strong',
    metrics: [{ name: 'median seconds between two raises (back within 12 s)', get: (a) => a.m((r) => medianGap(r.fireTimes)), lo: 0, hi: 12.5 }],
  },
  redmane_spirit: { preset: 'auto', metrics: [{ name: 'uptime %', get: uptimePct, lo: 35, hi: 42 }] },
  blood_frenzy: { preset: 'auto', metrics: [{ name: 'uptime % (stack cap time is in payloads.test)', get: uptimePct, lo: 38, hi: 55 }] },
  spirit_wolves: { preset: 'strong', metrics: [{ name: 'dps average', get: wholeDps, lo: 30, hi: 45 }] },
  moonmane_spirit: { preset: 'auto', metrics: [{ name: 'uptime %', get: uptimePct, lo: 35, hi: 45 }] },
  surging_arms: { preset: 'auto', metrics: [{ name: 'uptime %', get: uptimePct, lo: 32, hi: 42, note: 'target ~37 %' }] },
  tailwind: { preset: 'auto', metrics: [{ name: 'uptime %', get: uptimePct, lo: 25, hi: 35, note: 'target ~30 %' }] },
  // shadow_clone: see mimicUplift (a delta between two runs); shown as its own report row
};

function medianGap(times: number[]): number {
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) gaps.push((times[i] as number) - (times[i - 1] as number));
  return median(gaps);
}

export interface SkillReport {
  skill: string;
  preset: BenchPreset;
  /** per seed results of the judged preset (and the mid runs when the judged one is strong) */
  runs: SkillBenchResult[];
  rows: BenchRow[];
}

function agg(runs: SkillBenchResult[], presetUsed: BenchPreset): Agg {
  return { runs, presetUsed, m: (f) => median(runs.map(f)) };
}

const fmt = (x: number, unit = ''): string => (Number.isFinite(x) ? `${Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(1)}${unit}` : 'n/a');

/** runs one skill on every seed and judges the metrics of SKILL_SPECS against their bands */
export function skillReport(skill: string, seeds: readonly number[] = BENCH_SEEDS, db?: ContentDB, seconds = 300): SkillReport {
  const spec = SKILL_SPECS[skill];
  if (!spec) throw new Error(`no bench spec for ${skill}`);
  const base: Partial<SkillBenchOpts> = { skill, seconds, db, ...spec.run };
  let preset: BenchPreset = spec.preset === 'auto' ? 'mid' : spec.preset;
  let runs = seeds.map((seed) => runSkillBench({ ...base, skill, seed, preset }));
  let note = '';
  if (spec.preset === 'auto') {
    const alive = median(runs.map((r) => (r.diedAt >= 0 ? r.diedAt : r.sim)));
    if (alive < 150) {
      note = `mid hero dies at ${alive.toFixed(0)} s (median): judged on the strong hero`;
      preset = 'strong';
      runs = seeds.map((seed) => runSkillBench({ ...base, skill, seed, preset: 'strong' }));
    }
  }
  const a = agg(runs, preset);
  const rows: BenchRow[] = spec.metrics.map((m) => {
    const v = m.get(a);
    const ok = Number.isFinite(v) && v >= m.lo - 1e-9 && v <= m.hi + 1e-9;
    const alive = median(runs.map((r) => (r.diedAt >= 0 ? r.diedAt : r.sim)));
    return {
      skill,
      metric: m.name,
      value: `${fmt(v, m.unit)} (${preset}, median of ${seeds.length}; alive ${alive.toFixed(0)} s)`,
      target: `${m.lo}-${m.hi}`,
      ok,
      note: [m.note, note].filter(Boolean).join('; ') || undefined,
    };
  });
  return { skill, preset, runs, rows };
}

/** flame spirit with three spirits (count +2): 90-130 dps */
export function blazeFamiliarsThree(seeds: readonly number[] = BENCH_SEEDS, db?: ContentDB): BenchRow {
  const runs = seeds.map((seed) => runSkillBench({ skill: 'blaze_familiars', seed, preset: 'strong', countPlus: 2, db }));
  const v = median(runs.map((r) => windowDps(r, 120, 210)));
  return { skill: 'blaze_familiars', metric: 'dps 120-210 s (3 spirits)', value: `${fmt(v)} (strong, median of ${seeds.length})`, target: '90-130', ok: v >= 90 && v <= 130 };
}

/** seeds of the mimic uplift: the effect is of the size of the bot noise, so it is averaged over eight same-seed pairs */
export const MIMIC_SEEDS: readonly number[] = [11, 5, 7, 3, 9, 13, 2, 4];

/** shadow clone on the 3-attack-skill ninja-a build: total dps with the clone minus without it (copy damage is booked on the copied skills); mean of same-seed pairs */
export function mimicUplift(seeds: readonly number[] = MIMIC_SEEDS, db?: ContentDB): BenchRow {
  const extra = ['spiral_of_knives', 'noxious_pall', 'creeping_venom'];
  const deltas: number[] = [];
  for (const seed of seeds) {
    const withClone = runSkillBench({ skill: 'shadow_clone', seed, preset: 'strong', extra, db, seconds: 300, warmup: 60 });
    const without = runSkillBench({ skill: 'shadow_clone', seed, preset: 'strong', extra, db, seconds: 300, warmup: 60, absent: true });
    deltas.push(withClone.totalDps - without.totalDps);
  }
  const v = deltas.reduce((a, b) => a + b, 0) / Math.max(1, deltas.length);
  const sd = Math.sqrt(deltas.reduce((a, b) => a + (b - v) * (b - v), 0) / Math.max(1, deltas.length - 1));
  const se = sd / Math.sqrt(Math.max(1, deltas.length));
  return {
    skill: 'shadow_clone',
    metric: 'total dps uplift on a 3-active ninja-a build (mean of same-seed pairs)',
    value: `${fmt(v)} +-${se.toFixed(0)} (strong, ${deltas.length} pairs: ${deltas.map((d) => d.toFixed(0)).join('/')})`,
    target: '25-45',
    ok: v >= 25 && v <= 45,
    note: 'same-seed runs diverge after the first card pick; the standard error is the honest resolution',
  };
}

/**
 * The clean version of the mimic measurement: a quiet field with 40 immobile, harmless 1e5-HP dummies around a standing hero (no kills, no level-ups, no
 * card picks), the same ninja-a kit (basic + 3 attack skills) with and without the clone. The difference of the damage meters is the damage of the copies
 * alone, free of the bot noise that hides it in a live run. `power` patches the clone (null = the shipped number).
 */
export function mimicUpliftStatic(power: number | null = null, seconds = 120, db: ContentDB = content): { uplift: number; without: number; withClone: number } {
  const run = (clone: boolean): number => {
    const d = dbClone(db);
    if (power !== null) (d.skills.find((s) => s.id === 'shadow_clone') as SkillDef).params.power = power;
    const w = benchWorld('ninja', 'a', 11, 'strong', d);
    w.spawner.acc = -1e9;
    w.spawner.eliteT = 1e9;
    w.spawner.nextBoss = w.spawner.bosses.length;
    w.metinSys.nextFallAt = 1e9;
    w.metinSys.finalStarted = true;
    w.enemies.clear();
    w.spawner.alive = 0;
    const p = w.players[0] as PlayerState;
    const basic = p.skills[0] as SkillInstance;
    p.skills.length = 0;
    p.skills.push(basic);
    for (const id of ['spiral_of_knives', 'noxious_pall', 'creeping_venom', ...(clone ? ['shadow_clone'] : [])]) addSkill(w, p, d.skills.find((s) => s.id === id) as SkillDef, 0);
    const t = w.ix.typeIndex.get('bear') as number;
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const r = spawnEnemy(w, t, p.x + Math.sin(a) * (2.5 + (i % 4) * 1.2), p.z + Math.cos(a) * (2.5 + (i % 4) * 1.2), { spawnTime: 0 });
      w.enemies.hp[r] = 1e5;
      w.enemies.hpMax[r] = 1e5;
      w.enemies.state[r] = EnemyState.Recover;
      w.enemies.aiT[r] = 1e9;
    }
    p.iframes = 1e9;
    for (let t2 = 0; t2 < seconds * 60; t2++) {
      p.iframes = 1e9;
      w.step([{ moveX: 0, moveZ: 0 }]);
    }
    let sum = 0;
    for (const s of p.skills) sum += s.damage;
    return sum / seconds;
  };
  const without = run(false);
  const withClone = run(true);
  return { uplift: withClone - without, without, withClone };
}

/** the row for the report: the static-crowd uplift (the effect alone) next to the live-run mean (the effect inside the bot noise) */
export function mimicRow(seeds: readonly number[] = MIMIC_SEEDS, db?: ContentDB): BenchRow {
  const st = mimicUpliftStatic(null, 120, db);
  const live = mimicUplift(seeds, db);
  return {
    skill: 'shadow_clone',
    metric: 'total dps uplift on a 3-active ninja-a build (static crowd, the copies alone)',
    value: `${fmt(st.uplift)} (strong; ${fmt(st.without)} -> ${fmt(st.withClone)} dps; live bot run: ${live.value})`,
    target: '25-45',
    ok: st.uplift >= 25 && st.uplift <= 45,
    note: 'static crowd = every copy finds a target (upper bound of a live run); the live number sits inside the bot noise',
  };
}

export const BENCH_SKILLS: readonly string[] = [...Object.keys(SKILL_SPECS), 'shadow_clone'];

// ---------------------------------------------------------------------------------------------------------------------------------
// survival gate (DESIGN section 8: the weak doctrine bots with the defensive cards picked live >= 30 % longer than today)

export type PickPolicy = 'first' | 'defensive';

/** the defensive cards of each build (new skills first, then their upgrades); the wolfmans and the warrior-a offence keep card 0 */
export const DEFENSIVE_CARDS: Record<string, readonly string[]> = {
  warrior_a: ['war_oath', 'second_wind'],
  warrior_b: ['graniteform'],
  ninja_a: ['nightshroud'],
  ninja_b: ['swallows_gait', 'smoke_bomb'],
  yacha_a: ['umbral_plate', 'chilling_dread'],
  yacha_b: ['obsidian_bulwark'],
  shaman_a: ['radiant_favor', 'mirror_shell'],
  shaman_b: ['mending_light', 'stormglass_shell', 'tailwind'],
  wolfman_a: [],
  wolfman_b: ['moonmane_spirit'],
};

export const BUILDS: readonly (readonly [ClassId, 'a' | 'b'])[] = [
  ['warrior', 'a'], ['warrior', 'b'], ['ninja', 'a'], ['ninja', 'b'], ['yacha', 'a'], ['yacha', 'b'], ['shaman', 'a'], ['shaman', 'b'], ['wolfman', 'a'], ['wolfman', 'b'],
];

export interface SurvivalResult {
  build: string;
  seed: number;
  pick: PickPolicy;
  alive: boolean;
  /** sim seconds survived (the cap when alive) */
  seconds: number;
  level: number;
  /** defensive skills owned at the end */
  owned: string[];
}

/** pick the first defensive new-skill card, else the first defensive upgrade, else card 0 */
export function pickDefensive(w: World, ids: readonly string[]): number {
  const m = w.modal;
  if (!m) return 0;
  for (const want of ['newSkill', 'skillUp'] as const) {
    for (let i = 0; i < m.cards.length; i++) {
      const c = m.cards[i];
      if (c && c.kind === want && ids.includes(c.id)) return i;
    }
  }
  return 0;
}

export function runSurvival(classId: ClassId, doctrine: 'a' | 'b', seed: number, pick: PickPolicy, db: ContentDB = content, seconds = 480, preset: BenchPreset = 'design'): SurvivalResult {
  const w = benchWorld(classId, doctrine, seed, preset, db);
  const p = w.players[0] as PlayerState;
  const build = `${classId}_${doctrine}`;
  const ids = DEFENSIVE_CARDS[build] ?? [];
  const total = Math.round(seconds * 60);
  for (let t = 0; t < total && !w.over; t++) {
    let n = 0;
    while (w.modal && w.modal.kind !== 'runEnd' && n++ < 1000) w.chooseCard(pick === 'defensive' ? pickDefensive(w, ids) : 0, w.modal.player);
    w.step([botInput(w, t)]);
  }
  return { build, seed, pick, alive: p.alive, seconds: p.alive ? Math.min(seconds, w.time) : w.time, level: p.level, owned: p.skills.map((s) => s.def.id).filter((id) => ids.includes(id)) };
}

/** content with the pre-redesign skills and talents swapped in (the baseline "today"): pass the parsed baseline JSON */
export function withBaselineSkills(skills: SkillDef[], talents?: ContentDB['talents']): ContentDB {
  const db = dbClone(content);
  db.skills = skills;
  if (talents !== undefined) db.talents = talents;
  return db;
}
