import { RUN_DURATION_SLACK_SEC, RUN_LENGTH_SEC, type RunSubmission } from '@ms/shared';
import { describe, expect, it } from 'vitest';
import { assessRun, envelope, PLAUSIBILITY, versionAllowed } from '../src/plausibility';
import { runBody } from './helpers';

const NOW = 1_800_000_000_000;
const run = (over: Partial<RunSubmission> = {}, stats: Partial<RunSubmission['stats']> = {}): RunSubmission => {
  const base = runBody({ endedAt: NOW - 1000, ...over });
  return { ...base, stats: { ...base.stats, ...stats } };
};

describe('assessRun', () => {
  it('passes an honest mid-game run', () => {
    expect(assessRun(run(), NOW)).toEqual({ reject: [], flag: [] });
  });

  it('passes an honest full victory', () => {
    const r = run({ victory: true, duration: 905, zone: 'daeryeol', difficulty: 'hard' }, { kills: 6000, elites: 120, bosses: 5, metins: 14, level: 55, yeop: 400_000 });
    expect(assessRun(r, NOW)).toEqual({ reject: [], flag: [] });
  });

  // End-of-run stats of honest headless-sim runs (calibration, see plausibility.ts): Run Options up to ×3, GOD hero,
  // +100 % xp/yeop gain. Under the previous envelope most of these were rejected as implausible.
  it.each([
    ['yeonmu hard, every slider ×3', { zone: 'yeonmu', difficulty: 'hard', duration: 1340.97 }, { kills: 43_239, elites: 1698, bosses: 5, metins: 11, level: 178, yeop: 592_974 }],
    ['seori hard, max reward', { zone: 'seori', difficulty: 'hard', duration: 1052.78 }, { kills: 26_805, elites: 776, bosses: 5, metins: 12, level: 194, yeop: 1_526_914 }],
    ['suryeon normal, every slider ×3', { zone: 'suryeon', difficulty: 'normal', duration: 1098.47 }, { kills: 27_650, elites: 882, bosses: 5, metins: 10, level: 136, yeop: 776_459 }],
    ['daeryeol hard, density+speed ×3', { zone: 'daeryeol', difficulty: 'hard', duration: 1008.42 }, { kills: 28_386, elites: 1215, bosses: 5, metins: 8, level: 154, yeop: 2_637_584 }],
    ['seori hard co-op ×4 (one player)', { zone: 'seori', difficulty: 'hard', duration: 934.93, coop: 4 }, { kills: 3240, elites: 525, bosses: 5, metins: 10, level: 123, yeop: 171_048 }],
    ['yeonmu normal, plain hero', { zone: 'yeonmu', difficulty: 'normal', duration: 1001.78 }, { kills: 8491, elites: 315, bosses: 5, metins: 14, level: 51, yeop: 22_160 }],
  ] as const)('accepts an honest calibrated victory: %s', (_label, over, stats) => {
    expect(assessRun(run({ victory: true, ...over }, stats), NOW)).toEqual({ reject: [], flag: [] });
  });

  it('flags (never rejects) runs that stall past run length + slack', () => {
    const boundary = assessRun(run({ duration: RUN_LENGTH_SEC + RUN_DURATION_SLACK_SEC }, { kills: 100, elites: 1, bosses: 1, metins: 4, level: 20, yeop: 1000 }), NOW);
    expect(boundary).toEqual({ reject: [], flag: [] });
    const long = assessRun(run({ duration: RUN_LENGTH_SEC + RUN_DURATION_SLACK_SEC + 1 }), NOW);
    expect(long.reject).toEqual([]);
    expect(long.flag).toContain('duration_long');
  });

  it('rejects impossible kill rates per difficulty (zone-independent), flags outliers', () => {
    // normal: 2,900/min × 10 min + 40 = 29,040 (soft 20,328)
    const env = envelope(run(), run().stats);
    expect(env.killsHard).toBe(29_040);
    expect(env.killsSoft).toBe(20_328);
    expect(assessRun(run({}, { kills: 29_041 }), NOW).reject).toContain('kills_rate');
    expect(assessRun(run({}, { kills: 29_040 }), NOW).reject).not.toContain('kills_rate');
    expect(assessRun(run({}, { kills: 21_000 }), NOW).flag).toContain('kills_rate_high');
    expect(assessRun(run({}, { kills: 20_000 }), NOW).flag).not.toContain('kills_rate_high');
    // hard mode raises the cap (×4,000/min); the zone does not matter
    expect(assessRun(run({ difficulty: 'hard' }, { kills: 35_000 }), NOW).reject).not.toContain('kills_rate');
    expect(assessRun(run({ zone: 'daeryeol' }, { kills: 35_000 }), NOW).reject).toContain('kills_rate');
    expect(assessRun(run({ duration: 10 }, { kills: 5000 }), NOW).reject).toContain('kills_rate');
  });

  it('rejects hero level that outpaces time', () => {
    // hard: 40 + 18/min, soft: 25 + 13/min
    expect(assessRun(run({ duration: 60 }, { level: 59, kills: 100, elites: 0, bosses: 0, metins: 1 }), NOW).reject).toContain('level_rate');
    expect(assessRun(run({ duration: 60 }, { level: 30, kills: 100, elites: 0, bosses: 0, metins: 1, yeop: 500 }), NOW)).toEqual({ reject: [], flag: [] });
    expect(assessRun(run({}, { level: 220 }), NOW).reject).not.toContain('level_rate');
    expect(assessRun(run({}, { level: 221 }), NOW).reject).toContain('level_rate');
    expect(assessRun(run({}, { level: 156 }), NOW).flag).toContain('level_rate_high');
    expect(assessRun(run({}, { level: 155 }), NOW).flag).not.toContain('level_rate_high');
  });

  it('rejects yeop that kills/metins/bosses cannot explain', () => {
    expect(assessRun(run({}, { kills: 10, elites: 0, bosses: 0, metins: 0, yeop: 1_000_000 }), NOW).reject).toContain('yeop_rate');
    expect(assessRun(run({}, { kills: 2500, yeop: 100_000 }), NOW).reject).not.toContain('yeop_rate');
    expect(assessRun(run({}, { kills: 1000, elites: 0, bosses: 0, metins: 0, yeop: 50_000 }), NOW).flag).toContain('yeop_rate_high');
    // hard reward multiplier ×1.5
    expect(assessRun(run({ difficulty: 'hard' }, { kills: 1000, elites: 0, bosses: 0, metins: 0, yeop: 90_000 }), NOW).reject).not.toContain('yeop_rate');
  });

  it('checks bosses, metins and elite counts', () => {
    expect(assessRun(run({ duration: 100 }, { bosses: 3 }), NOW).reject).toContain('bosses_count');
    expect(assessRun(run({}, { metins: 40 }), NOW).reject).toContain('metins_count');
    expect(assessRun(run({}, { metins: 15 }), NOW).flag).toContain('metins_high');
    expect(assessRun(run({}, { kills: 20, elites: 15, bosses: 10 }), NOW).reject).toContain('elites_exceed_kills');
  });

  it('does not compare a co-op player own kills with the party-shared elites and bosses, but still caps elite rate', () => {
    // a co-op player who went down early: few own kills, the party's elites/bosses kept counting
    const r = run({ coop: 3, victory: true, duration: 930 }, { kills: 60, elites: 420, bosses: 5, metins: 10, level: 30, yeop: 4000 });
    expect(assessRun(r, NOW)).toEqual({ reject: [], flag: [] });
    // fabricated co-op run attempting a 100,000,000 score via 1,000,000 elites must be rejected
    const fabricated = run({ coop: 2, duration: 600 }, { kills: 0, elites: 1_000_000, bosses: 0, metins: 0, level: 1, yeop: 0 });
    expect(assessRun(fabricated, NOW).reject).toContain('elites_rate');
    // soft outlier above elitesSoft (1,274 for 10 min normal) but <= elitesHard (1,820) is flagged
    const outlier = run({ coop: 2, duration: 600 }, { kills: 200, elites: 1_500, bosses: 1, metins: 2, level: 20, yeop: 5000 });
    expect(assessRun(outlier, NOW).reject).toEqual([]);
    expect(assessRun(outlier, NOW).flag).toContain('elites_rate_high');
  });

  it('victory must reach the final boss', () => {
    expect(assessRun(run({ victory: true, duration: 300 }), NOW).reject).toContain('victory_too_short');
    expect(assessRun(run({ victory: true, duration: 900 }, { bosses: 0 }), NOW).reject).toContain('victory_without_boss');
  });

  it('validates the client clock', () => {
    expect(assessRun(run({ endedAt: NOW + 6 * 60_000 }), NOW).reject).toContain('future_timestamp');
    expect(assessRun(run({ endedAt: NOW + 4 * 60_000 }), NOW).reject).not.toContain('future_timestamp');
    expect(assessRun(run({ endedAt: NOW - 15 * 86_400_000 }), NOW).reject).toContain('stale_run');
    expect(assessRun(run({ endedAt: NOW - 13 * 86_400_000 }), NOW).reject).not.toContain('stale_run');
  });

  it('keeps soft limits below hard limits', () => {
    for (const minutes of [0.5, 1, 5, 15, 25]) {
      const env = envelope(run({ duration: minutes * 60 }), run().stats);
      expect(env.killsSoft).toBeLessThan(env.killsHard);
      expect(env.elitesSoft).toBeLessThan(env.elitesHard);
      expect(env.levelSoft).toBeLessThan(env.levelHard);
      expect(env.yeopSoft).toBeLessThan(env.yeopHard);
    }
    expect(PLAUSIBILITY.longRunSec).toBe(RUN_LENGTH_SEC + RUN_DURATION_SLACK_SEC);
  });
});

describe('versionAllowed', () => {
  it('supports exact versions and wildcards', () => {
    expect(versionAllowed('1.*', '1.0.3')).toBe(true);
    expect(versionAllowed('1.*', '2.0.0')).toBe(false);
    expect(versionAllowed('1.0.0, 1.1.0', '1.1.0')).toBe(true);
    expect(versionAllowed('1.0.0', '1.0.1')).toBe(false);
    expect(versionAllowed('1.2.*', '1.2.9')).toBe(true);
    expect(versionAllowed('*', '9.9.9')).toBe(true);
    expect(versionAllowed(undefined, '1.4.0')).toBe(true);
  });
});
