// Micro-benchmark: sim cost per tick with ~600 live enemies. Library; run it with  bun run apps/game/src/sim/__tests__/bench.run.ts

import { updateEnemies } from '../ai';
import { updateStatuses } from '../combat';
import { updateBosses } from '../bosses';
import { updateMetins } from '../metins';
import { updatePickups } from '../pickups';
import { updatePlayers } from '../player';
import { runScheduled } from '../scheduler';
import { sweepDead } from '../enemies';
import { updateSkills } from '../skills';
import { updateProjectiles } from '../skills/projectiles';
import { updateZones } from '../skills/zones';
import { updateSpawner } from '../spawner';
import { updateTelegraphs } from '../telegraph';
import { updateProgress } from '../progress';
import type { PlayerInput } from '../stores';
import type { World } from '../world';
import { botInput } from './bot';
import { drainModals, giveSkill, makeWorld } from './helpers';

export interface BenchOpts {
  /** target live enemies */
  enemies: number;
  /** hero deals ~no damage so the whole horde piles up around it (worst case for separation) */
  pile?: boolean;
  /** sim seconds to measure after warm-up */
  seconds: number;
  warmup?: number;
}

export interface BenchResult {
  enemies: number;
  ticks: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  /** average ms per tick spent in each system */
  systems: Record<string, number>;
}

/** a world pinned at `enemies` live enemies with a full skill loadout (all 16 behaviors at rank 3) */
export function makeBenchWorld(enemies: number, pile = false): World {
  const w = makeWorld({
    config: { meta: { stats: { maxHpPct: 50, armor: 500, regen: 50, damage: pile ? -0.99 : 0 } } },
    content: (c) => {
      const z = c.zones[0];
      if (!z) return;
      z.bands = [{ from: 0, to: 900, rate: 60, maxAlive: enemies, spawns: [{ enemy: 'wolf', weight: 5 }, { enemy: 'jackal', weight: 3 }, { enemy: 'spitter', weight: 1 }, { enemy: 'bear', weight: 1 }, { enemy: 'fox', weight: 2 }] }];
      z.bosses = [];
      z.metins = { types: ['metin_lament'], firstAt: 30, interval: [40, 50] };
    },
  });
  for (const id of ['lightning_trio', 'bladewheel', 'fury_aura', 'lunge', 'aura_sword', 'war_leap', 'soul_crash', 'sky_blades', 'chain_lightning', 'sword_circle', 'frost_cleave', 'phantom_blades', 'soul_beam', 'arc_of_might', 'venom_pool']) {
    if (w.players[0] && !w.players[0].skills.some((s) => s.def.id === id)) giveSkill(w, id, 3);
  }
  return w;
}

const STEP_INPUT: PlayerInput = { moveX: 0, moveZ: 0 };

/** step with per-system timing (mirrors World.step) */
function timedStep(w: World, sys: Record<string, number>): void {
  const now = (): number => performance.now();
  const t = (name: string, fn: () => void): void => {
    const s = now();
    fn();
    sys[name] = (sys[name] ?? 0) + (now() - s);
  };
  w.bus.clear();
  w.time += 1 / 60;
  w.tick++;
  t('players', () => updatePlayers(w, [STEP_INPUT]));
  t('hash', () => w.hash.rebuild(w.enemies));
  t('skills', () => updateSkills(w));
  t('sched', () => runScheduled(w));
  t('projectiles', () => updateProjectiles(w));
  t('zones', () => updateZones(w));
  t('ai', () => updateEnemies(w));
  t('status', () => updateStatuses(w));
  t('telegraph', () => updateTelegraphs(w));
  t('bosses', () => updateBosses(w));
  t('metins', () => updateMetins(w));
  t('spawner', () => updateSpawner(w));
  t('pickups', () => updatePickups(w));
  t('sweep', () => sweepDead(w));
  t('progress', () => updateProgress(w));
}

export function runBench(opts: BenchOpts): BenchResult {
  const w = makeBenchWorld(opts.enemies, opts.pile === true);
  const warm = Math.round((opts.warmup ?? 20) * 60);
  const n = Math.round(opts.seconds * 60);
  const samples: number[] = [];
  const sys: Record<string, number> = {};
  const scratch: Record<string, number> = {};
  // warm-up fills the field to the target and levels the hero
  for (let i = 0; i < warm; i++) {
    drainModals(w);
    w.step([botInput(w, i)]);
  }
  for (let i = 0; i < n; i++) {
    drainModals(w);
    const start = performance.now();
    w.step([botInput(w, warm + i)]);
    samples.push(performance.now() - start);
  }
  // per-system breakdown on a second pass (same world, continues the run)
  for (let i = 0; i < Math.min(n, 600); i++) {
    drainModals(w);
    timedStep(w, scratch);
    Object.assign(sys, scratch);
  }
  const breakdown: Record<string, number> = {};
  const bn = Math.min(n, 600);
  for (const [k, v] of Object.entries(sys)) breakdown[k] = v / bn;
  samples.sort((a, b) => a - b);
  const pick = (q: number): number => samples[Math.min(samples.length - 1, Math.floor(q * samples.length))] as number;
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  return {
    enemies: w.spawner.alive,
    ticks: n,
    avgMs: avg,
    p50Ms: pick(0.5),
    p95Ms: pick(0.95),
    p99Ms: pick(0.99),
    maxMs: samples[samples.length - 1] as number,
    systems: breakdown,
  };
}

// the per-skill balance report (DESIGN section 8) lives in benchSkills.ts
export * from './benchSkills';
