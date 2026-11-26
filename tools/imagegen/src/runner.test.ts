import { describe, expect, test } from 'bun:test';
import { jobFiles, loadAllJobs, planBatches, toSessionJob, validateJob } from './runner';
import type { JobSpec } from './types';

const job = (id: string, extra: Partial<JobSpec> = {}): JobSpec => ({ id, group: 'g', kind: 'vfx', size: 512, post: [], prompt: 'p', ...extra });

describe('planBatches', () => {
  test('ref and real-alpha jobs run alone; the rest are chunked by batch size, order kept', () => {
    const jobs = [job('p1'), job('r1', { refs: ['a.png'] }), job('p2'), job('t1', { background: 'transparent' }), job('p3'), job('p4'), job('p5')];
    expect(planBatches(jobs, 2).map((b) => b.map((j) => j.id))).toEqual([['r1'], ['t1'], ['p1', 'p2'], ['p3', 'p4'], ['p5']]);
  });
});

describe('toSessionJob', () => {
  test('carries prepared refs and the transparency request', () => {
    const sj = toSessionJob(job('t', { goal: 'g', prompt: undefined, background: 'transparent' }), [{ path: 'C:/r.png', role: 'texture' }]);
    expect(sj.refs).toEqual([{ path: 'C:/r.png', role: 'texture' }]);
    expect(sj.transparent).toBe(true);
    expect(sj.prompt.startsWith('Goal: g\n')).toBe(true);
    expect(toSessionJob(job('p')).refs).toBeUndefined();
  });
});

describe('validateJob', () => {
  test('accepts goal-only jobs and string/object refs', () => {
    expect(() => validateJob(job('a', { prompt: undefined, goal: 'g', refs: ['x.png', { path: 'y.png', role: 'context' }] }), 't')).not.toThrow();
  });
  test('rejects bad specs', () => {
    expect(() => validateJob(job('a', { prompt: undefined }), 't')).toThrow(/prompt\|goal/);
    expect(() => validateJob(job('a', { background: 'black', transparent: true }), 't')).toThrow(/both/);
    expect(() => validateJob(job('a', { background: 'grey' as never }), 't')).toThrow(/background/);
    expect(() => validateJob(job('a', { refs: [{ path: '' }] }), 't')).toThrow(/without a path/);
    expect(() => validateJob(job('a', { kind: 'sprite' as never }), 't')).toThrow(/unknown kind/);
    expect(() => validateJob(job('A'), 't')).toThrow(/bad job id/);
  });
});

describe('job files', () => {
  test('promoted gen jobs (jobs/gen/*.json) load after the numbered files and validate', () => {
    const files = jobFiles();
    const firstGen = files.findIndex((f) => /[\\/]gen[\\/]/.test(f));
    if (firstGen >= 0) expect(files.slice(firstGen).every((f) => /[\\/]gen[\\/]/.test(f))).toBe(true);
    expect(() => loadAllJobs()).not.toThrow();
  }, 60_000); // loadAllJobs reads and validates every job file: 6-7 s under the parallel root `bun run test` (bun's per-test default is 5 s)
});
