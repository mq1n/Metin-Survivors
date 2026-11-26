// Gallery scenarios: the death recap of the defeat report (RP-01, upgrade group B.report). One state per way a run can end: killed
// by a creature, by a boss, by a metin, by the ground, with no killer on record, an old result without the DT-01 record, the final
// boss already in the arena, a co-op defeat and the report screen. The next-step chips (talent points, an affordable refine, the Dragon
// God's favour) read the profile, so each state rebuilds the warrior of the lived-in gallery profile from a pristine copy (a state never
// stacks on the previous one) and loads it through the real `.msav` import path; `up-report-reset` puts the original profile back.
import type { ContentDB } from '../../../data/schema';
import { exportMsav, type MetaService, type SaveData } from '../../../meta';
import { collectablePieces } from '../../../meta/gear';
import { emptyZoneStats } from '../../../meta/save';
import type { RunResult } from '../../../sim/run';
import type { GalleryCtx } from '../../gallery';
import { clearSettlements } from '../../settlement';
import { mockRequest } from '../mock';
import { defeatRunResult, installMockSettle, SEED_DEFEAT } from './runend';
import { inRun, type Scenario } from '../scenarioKit';

export const order = 121;

/** what the profile holds behind a state: the chips that show */
interface Spec {
  /** talent points to spend, as the settlement reports them */
  points: number;
  /** failed attempts at the run's zone without a clear (Sky Sovereign's favour 3 % each); 0 = the zone is cleared, no favour */
  fails: number;
  /** a bank that covers a refine of the owned pieces (false = an empty purse) */
  rich: boolean;
}

const ALL: Spec = { points: 6, fails: 3, rich: true };
const NONE: Spec = { points: 0, fails: 0, rich: false };

const pristine = new WeakMap<MetaService, SaveData>();

function original(meta: MetaService): SaveData {
  let s = pristine.get(meta);
  if (!s) {
    s = structuredClone(meta.save);
    pristine.set(meta, s);
  }
  return s;
}

/** the warrior's profile for `spec` at the run's zone and difficulty */
export function reportProfile(base: SaveData, content: ContentDB, run: RunResult, spec: Spec): SaveData {
  const save = structuredClone(base);
  const entry = (save.stats.zones[run.zone] ??= {});
  entry[run.difficulty] = spec.fails > 0 ? { ...emptyZoneStats(), runs: spec.fails } : { ...emptyZoneStats(), runs: 4, clears: 2, bestScore: 410_000, bestTime: 880, bestLevel: 36 };
  save.bank = spec.rich ? { yeop: 480_000, shards: 320 } : { yeop: 0, shards: 0 };
  const cs = save.classes[run.classId];
  if (spec.rich) {
    // two pieces to refine: the gallery profile may not have won any
    for (const def of collectablePieces(content, run.classId).slice(0, 2)) if (!cs.collection.includes(def.id)) cs.collection.push(def.id);
    const weapon = collectablePieces(content, run.classId).find((d) => d.slot === 'weapon');
    if (weapon && cs.gear.weapon === undefined) cs.gear.weapon = weapon.id;
  }
  return save;
}

function load(g: GalleryCtx, save: SaveData): Promise<unknown> {
  // the device settings stay as they are (the import would apply the file's)
  return g.meta.importMsav(exportMsav({ ...save, settings: structuredClone(g.meta.save.settings) }));
}

/** Seeds of the states: a state's settlement is the fabricated 'defeat' summary of runend.ts with the talent points of its spec. */
const POINTS = new Map<number, number>();
const patched = new WeakSet<MetaService>();

function installReportSettle(meta: MetaService): void {
  installMockSettle(meta);
  if (patched.has(meta)) return;
  patched.add(meta);
  const base = meta.settle.bind(meta);
  meta.settle = (run, opts) => {
    const points = POINTS.get(run.seed);
    if (points === undefined) return base(run, opts);
    const out = base({ ...run, seed: SEED_DEFEAT }, opts);
    return { ...out, summary: { ...out.summary, talentXp: { ...out.summary.talentXp, available: points } } };
  };
}

interface State {
  id: string;
  label: string;
  seed: number;
  spec: Spec;
  /** the defeat of the gallery (Yeonmu, warrior, 06:42) with the record of this state */
  over: (content: ContentDB) => Partial<RunResult>;
  /** the whole party is down (co-op) */
  coop?: boolean;
  screen?: boolean;
}

/** the 06:37 fall of the brief: two bosses had arrived, one of them defeated; Ung-Jae comes in 2:23 */
const FELL = (content: ContentDB): Partial<RunResult> => ({
  time: 401.4,
  killedAt: 397,
  nextBoss: { id: content.zones[0]?.bosses[2]?.boss ?? 'boss_ung_jae', inSec: 143 },
  bossesKilled: [content.zones[0]?.bosses[0]?.boss ?? 'boss_chan_dae'],
});

const STATES: State[] = [
  { id: 'up-report-enemy', label: 'Defeat · killed by a creature (talents, refine, favour)', seed: 9111, spec: ALL, over: (c) => ({ ...FELL(c), killedBy: 'grizzly_bear' }) },
  {
    id: 'up-report-boss',
    label: 'Defeat · killed by a boss',
    seed: 9112,
    spec: { points: 2, fails: 5, rich: true },
    over: (c) => {
      const b = c.zones[0]?.bosses ?? [];
      return { time: 586.9, killedAt: 582, killedBy: `boss:${b[2]?.boss ?? 'boss_ung_jae'}`, nextBoss: { id: b[3]?.boss ?? 'boss_ji_yul', inSec: 138 }, bossesKilled: [b[0]?.boss ?? '', b[1]?.boss ?? ''] };
    },
  },
  {
    id: 'up-report-metin',
    label: 'Defeat · killed by a metin aura',
    seed: 9113,
    spec: { points: 1, fails: 2, rich: false },
    over: (c) => ({ ...FELL(c), time: 664.2, killedAt: 660, killedBy: `metin:${c.metins[5]?.id ?? 'metin_murk'}`, nextBoss: { id: c.zones[0]?.bosses[3]?.boss ?? 'boss_ji_yul', inSec: 60 }, bossesKilled: (c.zones[0]?.bosses ?? []).slice(0, 2).map((b) => b.boss) }),
  },
  { id: 'up-report-lava', label: 'Defeat · killed by the lava (refine only)', seed: 9114, spec: { points: 0, fails: 0, rich: true }, over: (c) => ({ ...FELL(c), killedBy: 'hazard:lava' }) },
  { id: 'up-report-nokiller', label: 'Defeat · no killer on record (fall time and strip only)', seed: 9115, spec: NONE, over: (c) => FELL(c) },
  {
    id: 'up-report-old',
    label: 'Defeat · result from before the record (no killer, no time, strip by the run time)',
    seed: 9116,
    spec: NONE,
    over: (c) => ({ time: 401.4, bossesKilled: [c.zones[0]?.bosses[0]?.boss ?? 'boss_chan_dae'] }),
  },
  {
    id: 'up-report-final',
    label: 'Defeat · the final boss was already here',
    seed: 9117,
    spec: { points: 3, fails: 1, rich: false },
    over: (c) => {
      const z = c.zones[0];
      return { time: 936.4, killedAt: 932, killedBy: `boss:${z?.final.boss ?? 'boss_horyeong'}`, bossesKilled: (z?.bosses ?? []).map((b) => b.boss) };
    },
  },
  {
    id: 'up-report-coop',
    label: 'Defeat · co-op party, own record',
    seed: 9118,
    spec: ALL,
    coop: true,
    over: (c) => ({ ...FELL(c), killedBy: 'bear' }),
  },
  { id: 'up-report-results', label: 'Results screen · defeat with the recap', seed: 9119, spec: ALL, screen: true, over: (c) => ({ ...FELL(c), killedBy: 'grizzly_bear' }) },
];

function resultFor(content: ContentDB, s: State): RunResult {
  const base = defeatRunResult(content);
  const r: RunResult = { ...base, ...s.over(content), seed: s.seed };
  if (s.coop) {
    r.players = [
      { index: 0, level: 22, kills: 900, yeop: 4_600, alive: false },
      { index: 1, level: 20, kills: 580, yeop: 4_500, alive: false },
    ];
  }
  return r;
}

const scenarioFor = (s: State): Scenario => ({
  id: s.id,
  label: s.label,
  run: (g) => {
    installReportSettle(g.meta);
    POINTS.set(s.seed, s.spec.points);
    const result = resultFor(g.content, s);
    void load(g, reportProfile(original(g.meta), g.content, result, s.spec)).then(() => {
      clearSettlements();
      if (s.screen) {
        g.store.setResult(result);
        g.store.setScreen('results');
        return;
      }
      inRun(g, { t: result.time });
      g.store.setSimModal(mockRequest('runEnd', g.content, { result }));
    });
  },
});

export const scenarios: Scenario[] = [
  ...STATES.map(scenarioFor),
  {
    id: 'up-report-reset',
    label: 'Defeat recap · back to the gallery profile',
    run: (g) => {
      g.store.setScreen('menu');
      void load(g, original(g.meta));
    },
  },
];
