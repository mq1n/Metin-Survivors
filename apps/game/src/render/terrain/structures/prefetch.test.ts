// The zone's prop GLBs download in parallel (bounded) instead of one after another; the structures init still consumes them
// in layout order, so the entries (and which prop falls back to its procedural builder) come out as before.
import { describe, expect, it } from 'vitest';
import { PROP_PREFETCH, prefetch } from './index';

/** a load the test settles by hand; `inFlight` is the number of loads started and not yet settled */
function manualLoads(): { load: (id: string) => Promise<string>; started: string[]; finish: (id: string, fail?: boolean) => void; peak: () => number } {
  const started: string[] = [];
  const waiting = new Map<string, { ok: (v: string) => void; fail: (e: Error) => void }>();
  let inFlight = 0;
  let peak = 0;
  return {
    started,
    peak: () => peak,
    load: (id) =>
      new Promise<string>((ok, fail) => {
        started.push(id);
        inFlight++;
        peak = Math.max(peak, inFlight);
        waiting.set(id, { ok, fail });
      }),
    finish: (id, failIt) => {
      const w = waiting.get(id);
      inFlight--;
      if (failIt) w?.fail(new Error(`${id} failed`));
      else w?.ok(id);
    },
  };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('structures prefetch', () => {
  it('starts the first `limit` loads at once and never more than `limit` in flight, in list order', async () => {
    const m = manualLoads();
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const loads = prefetch(ids, 2, m.load);
    expect(m.started).toEqual(['a', 'b']);
    m.finish('a');
    await tick();
    expect(m.started).toEqual(['a', 'b', 'c']);
    m.finish('c');
    m.finish('b');
    await tick();
    expect(m.started).toEqual(['a', 'b', 'c', 'd', 'e']);
    m.finish('d');
    m.finish('e');
    expect(await Promise.all(ids.map((id) => loads.get(id)))).toEqual(ids); // the caller reads them in its own order
    expect(m.peak()).toBe(2);
  });

  it('a failed load stays rejected for the caller and does not stop the others or throw here', async () => {
    const m = manualLoads();
    const loads = prefetch(['a', 'b', 'c'], 1, m.load);
    m.finish('a', true);
    await tick();
    m.finish('b');
    await tick();
    m.finish('c');
    await expect(loads.get('a')).rejects.toThrow('a failed');
    expect(await loads.get('b')).toBe('b');
    expect(await loads.get('c')).toBe('c');
  });

  it('is a no-op for an empty list, and the default bound is a handful of connections', () => {
    expect(prefetch([], 6, () => Promise.resolve(1)).size).toBe(0);
    expect(PROP_PREFETCH).toBeGreaterThan(1);
    expect(PROP_PREFETCH).toBeLessThanOrEqual(8);
  });
});
