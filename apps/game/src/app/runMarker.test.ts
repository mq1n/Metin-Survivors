// The run-in-progress marker (QA EXPLORER-4): a reload mid-run leaves it behind and the next boot reports it once; a finished run leaves nothing.
import { describe, expect, it } from 'vitest';
import { clearRunMarker, markRunStart, takeInterruptedRun, type MarkerStorage, type RunMarker } from './runMarker';

class MemStorage implements MarkerStorage {
  readonly data = new Map<string, string>();
  getItem(k: string): string | null {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v);
  }
  removeItem(k: string): void {
    this.data.delete(k);
  }
}

const run: RunMarker = { zone: 'yeonmu', classId: 'warrior', difficulty: 'normal', startedAt: 1_700_000_000_000, coop: false };

describe('run marker lifecycle', () => {
  it('a run that never ended (a reload) is reported at the next boot, once', () => {
    const s = new MemStorage();
    markRunStart(run, s);
    expect(takeInterruptedRun(s)).toEqual(run);
    expect(takeInterruptedRun(s)).toBeNull();
  });

  it('a run that ended or was settled leaves no marker', () => {
    const s = new MemStorage();
    markRunStart(run, s);
    clearRunMarker(s);
    expect(takeInterruptedRun(s)).toBeNull();
  });

  it('no run, no marker', () => {
    expect(takeInterruptedRun(new MemStorage())).toBeNull();
  });

  it('a new run replaces the marker of the previous one', () => {
    const s = new MemStorage();
    markRunStart(run, s);
    markRunStart({ ...run, zone: 'seori', coop: true }, s);
    expect(takeInterruptedRun(s)).toMatchObject({ zone: 'seori', coop: true });
  });

  it('damaged markers read as nothing and are cleared', () => {
    for (const bad of ['{', 'null', '"x"', '{"zone":1}', JSON.stringify({ zone: 'yeonmu', classId: 'warrior', difficulty: 'normal' })]) {
      const s = new MemStorage();
      s.setItem('ms.run.live', bad);
      expect(takeInterruptedRun(s), bad).toBeNull();
      expect(s.data.size).toBe(0);
    }
  });

  it('missing or failing storage never throws', () => {
    expect(() => markRunStart(run, null)).not.toThrow();
    expect(() => clearRunMarker(null)).not.toThrow();
    expect(takeInterruptedRun(null)).toBeNull();
    const broken: MarkerStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(() => markRunStart(run, broken)).not.toThrow();
    expect(() => clearRunMarker(broken)).not.toThrow();
    expect(takeInterruptedRun(broken)).toBeNull();
  });
});
