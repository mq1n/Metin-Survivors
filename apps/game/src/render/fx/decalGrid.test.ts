// DecalGrid lifetime: the grid is created once with the renderer and fed the terrain sampler of the CURRENT run every
// frame, so it must not keep a finished run alive (prod4 runtime-memory-net).
import { runInNewContext } from 'node:vm';
import { setFlagsFromString } from 'node:v8';
import { describe, expect, it } from 'vitest';
import { DecalGrid, SLOT_LIVE } from './decalGrid';

function makeGrid(): DecalGrid {
  return new DecalGrid({
    cap: 2,
    rect: (_kind, r1, _r2, _r3, out, o) => {
      out[o] = -r1;
      out[o + 1] = r1;
      out[o + 2] = -r1;
      out[o + 3] = r1;
    },
    fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }',
    uniforms: {},
    renderOrder: 0,
    name: 'decal-test',
  });
}

/** one live decal whose heights have never been computed */
function place(grid: DecalGrid): void {
  const s = grid.slots;
  s.state[0] = SLOT_LIVE;
  s.kind[0] = 0;
  s.r1[0] = 2;
  s.dirty[0] = 2;
  s.high = 1;
  s.liveCount = 1;
}

setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc') as () => void;
const nextJob = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
/** a few collections: a WeakRef target created in this job is only released after the job ended */
async function collect(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await nextJob();
    gc();
  }
}

describe('DecalGrid height sampler', () => {
  it('recomputes the heights when the sampler changes, not while it stays the same', () => {
    const grid = makeGrid();
    const flat = (): number => 0;
    place(grid);
    grid.commit(flat);
    expect(grid.heightsComputed).toBe(1);
    grid.commit(flat);
    expect(grid.heightsComputed).toBe(0); // same sampler, nothing moved: heights stay
    const hill = (x: number): number => x;
    grid.commit(hill); // a new run / zone: everything placed is stale
    expect(grid.heightsComputed).toBe(1);
    grid.commit(hill);
    expect(grid.heightsComputed).toBe(0);
    grid.dispose();
  });

  it('keeps nothing of a finished run (its sampler closes over the run session), and a collected sampler reads as "changed"', async () => {
    const grid = makeGrid();
    place(grid);
    let run: { h: number } | null = { h: 3 };
    const watch = new WeakRef(run);
    grid.commit(((r: { h: number }) => (): number => r.h)(run));
    expect(grid.heightsComputed).toBe(1);
    run = null;
    await collect();
    expect(watch.deref()).toBeUndefined(); // the grid kept nothing of the finished run
    const next = (): number => 1;
    grid.commit(next);
    expect(grid.heightsComputed).toBe(1); // fresh sampler after the old one vanished: heights are recomputed
    grid.dispose();
  });
});
