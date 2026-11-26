// Dense SoA stores: zeroed allocation, swap-remove data alignment, stable generation-tagged handles, capacity limits.

import { describe, expect, it } from 'vitest';
import { CAP, MAX_SKILL_SLOTS } from '../constants';
import { Rng } from '../rng';
import { DenseStore, EnemyStore, PickupStore, PROJ_HIT_MEM, ProjectileStore, TelegraphStore, ZoneStore } from '../stores';

/** a store exercising every typed-array kind and a few strides */
class TestStore extends DenseStore {
  readonly a = this.f32();
  readonly b = this.u8();
  readonly c = this.u16();
  readonly d = this.u32();
  readonly e = this.i32();
  readonly vec = this.f32(3);
  readonly tag = this.u8(2);
  readonly big = this.u32(5);

  constructor(capacity: number) {
    super(capacity);
  }
}

/** write a recognisable payload derived from `n` into every field of `row` */
function fill(s: TestStore, row: number, n: number): void {
  s.a[row] = n + 0.5;
  s.b[row] = n % 251;
  s.c[row] = (n * 7) % 65521;
  s.d[row] = n * 100003;
  s.e[row] = -n * 31;
  for (let k = 0; k < 3; k++) s.vec[row * 3 + k] = n * 10 + k;
  for (let k = 0; k < 2; k++) s.tag[row * 2 + k] = (n + k) % 200;
  for (let k = 0; k < 5; k++) s.big[row * 5 + k] = n * 1000 + k;
}

/** assert that `row` holds the payload of `n` (as written by fill) */
function expectPayload(s: TestStore, row: number, n: number): void {
  expect(s.a[row]).toBe(n + 0.5);
  expect(s.b[row]).toBe(n % 251);
  expect(s.c[row]).toBe((n * 7) % 65521);
  expect(s.d[row]).toBe(n * 100003);
  expect(s.e[row]).toBe(-n * 31);
  for (let k = 0; k < 3; k++) expect(s.vec[row * 3 + k]).toBe(n * 10 + k);
  for (let k = 0; k < 2; k++) expect(s.tag[row * 2 + k]).toBe((n + k) % 200);
  for (let k = 0; k < 5; k++) expect(s.big[row * 5 + k]).toBe(n * 1000 + k);
}

function expectZeroRow(s: TestStore, row: number): void {
  expect(s.a[row]).toBe(0);
  expect(s.b[row]).toBe(0);
  expect(s.c[row]).toBe(0);
  expect(s.d[row]).toBe(0);
  expect(s.e[row]).toBe(0);
  for (let k = 0; k < 3; k++) expect(s.vec[row * 3 + k]).toBe(0);
  for (let k = 0; k < 2; k++) expect(s.tag[row * 2 + k]).toBe(0);
  for (let k = 0; k < 5; k++) expect(s.big[row * 5 + k]).toBe(0);
}

describe('DenseStore.alloc', () => {
  it('hands out dense rows 0..n-1 and counts them', () => {
    const s = new TestStore(8);
    expect(s.count).toBe(0);
    expect(s.capacity).toBe(8);
    for (let i = 0; i < 5; i++) {
      expect(s.alloc()).toBe(i);
      expect(s.count).toBe(i + 1);
    }
  });

  it('gives every row a unique non-zero handle (generation << 16 | slot)', () => {
    const s = new TestStore(16);
    const handles = new Set<number>();
    const slots = new Set<number>();
    for (let i = 0; i < 16; i++) {
      const row = s.alloc();
      const h = s.id[row] as number;
      expect(h).not.toBe(0);
      expect(h >>> 16).toBe(1); // first generation
      expect(h & 0xffff).toBeLessThan(16);
      handles.add(h);
      slots.add(h & 0xffff);
    }
    expect(handles.size).toBe(16);
    expect(slots.size).toBe(16);
  });

  it('zeroes every field of a fresh row (all kinds and strides)', () => {
    const s = new TestStore(6);
    for (let i = 0; i < 6; i++) {
      const row = s.alloc();
      fill(s, row, i + 3);
    }
    s.clear();
    expect(s.count).toBe(0);
    for (let i = 0; i < 6; i++) {
      const row = s.alloc();
      expect(row).toBe(i);
      expectZeroRow(s, row);
    }
  });

  it('zeroes a reused row even when only part of the store was freed', () => {
    const s = new TestStore(4);
    for (let i = 0; i < 4; i++) fill(s, s.alloc(), i + 1);
    s.free(3); // last row: no swap
    const row = s.alloc();
    expect(row).toBe(3);
    expectZeroRow(s, row);
    // the other rows are untouched by the allocation
    for (let i = 0; i < 3; i++) expectPayload(s, i, i + 1);
  });

  it('a row vacated by swap-remove is zero again when re-allocated', () => {
    const s = new TestStore(4);
    for (let i = 0; i < 4; i++) fill(s, s.alloc(), i + 1);
    s.free(0); // row 3 moves into row 0; row 3 keeps stale bytes until re-allocated
    expect(s.count).toBe(3);
    const row = s.alloc();
    expect(row).toBe(3);
    expectZeroRow(s, row);
  });
});

describe('DenseStore.free (swap-remove)', () => {
  it('moves the last row into the hole with every field (including strides) intact', () => {
    const s = new TestStore(8);
    for (let i = 0; i < 5; i++) fill(s, s.alloc(), i + 1);
    s.free(1);
    expect(s.count).toBe(4);
    expectPayload(s, 0, 1);
    expectPayload(s, 1, 5); // old last row
    expectPayload(s, 2, 3);
    expectPayload(s, 3, 4);
  });

  it('freeing the last row just shrinks the store', () => {
    const s = new TestStore(8);
    for (let i = 0; i < 3; i++) fill(s, s.alloc(), i + 1);
    const h = s.id[2] as number;
    s.free(2);
    expect(s.count).toBe(2);
    expectPayload(s, 0, 1);
    expectPayload(s, 1, 2);
    expect(s.find(h)).toBe(-1);
  });

  it('freeing the only row empties the store', () => {
    const s = new TestStore(4);
    const row = s.alloc();
    const h = s.id[row] as number;
    s.free(row);
    expect(s.count).toBe(0);
    expect(s.find(h)).toBe(-1);
  });

  it('keeps handles pointing at their own data after the swap', () => {
    const s = new TestStore(8);
    const handles: number[] = [];
    for (let i = 0; i < 6; i++) {
      const row = s.alloc();
      fill(s, row, i + 10);
      handles.push(s.id[row] as number);
    }
    s.free(s.find(handles[1] as number));
    s.free(s.find(handles[4] as number));
    expect(s.count).toBe(4);
    expect(s.find(handles[1] as number)).toBe(-1);
    expect(s.find(handles[4] as number)).toBe(-1);
    for (const i of [0, 2, 3, 5]) {
      const row = s.find(handles[i] as number);
      expect(row).toBeGreaterThanOrEqual(0);
      expect(row).toBeLessThan(s.count);
      expectPayload(s, row, i + 10);
    }
  });

  it('clears the id of the vacated tail row', () => {
    const s = new TestStore(4);
    for (let i = 0; i < 3; i++) s.alloc();
    s.free(0);
    expect(s.id[2]).toBe(0);
    s.free(0);
    expect(s.id[1]).toBe(0);
  });

  it('randomised alloc/free sequences stay consistent with a reference model', () => {
    const rng = new Rng(2024);
    const s = new TestStore(64);
    const model = new Map<number, number>(); // handle -> payload number
    let next = 1;
    for (let step = 0; step < 4000; step++) {
      const doAlloc = model.size === 0 || (model.size < 64 && rng.chance(0.55));
      if (doAlloc) {
        const row = s.alloc();
        expect(row).toBe(s.count - 1);
        fill(s, row, next);
        model.set(s.id[row] as number, next);
        next++;
      } else {
        const handles = [...model.keys()];
        const h = rng.pick(handles);
        const row = s.find(h);
        expect(row).toBeGreaterThanOrEqual(0);
        s.free(row);
        model.delete(h);
        expect(s.find(h)).toBe(-1);
      }
      expect(s.count).toBe(model.size);
      if (step % 97 === 0) {
        const seenRows = new Set<number>();
        for (const [h, payload] of model) {
          const row = s.find(h);
          expect(row).toBeGreaterThanOrEqual(0);
          expect(row).toBeLessThan(s.count);
          expect(s.id[row]).toBe(h);
          expectPayload(s, row, payload);
          seenRows.add(row);
        }
        expect(seenRows.size).toBe(s.count);
        for (let r = s.count; r < s.capacity; r++) expect(s.id[r]).toBe(0);
      }
    }
  });
});

describe('DenseStore handles and generations', () => {
  it('find() resolves live handles to their row', () => {
    const s = new TestStore(8);
    const rows = [s.alloc(), s.alloc(), s.alloc()];
    for (const r of rows) expect(s.find(s.id[r] as number)).toBe(r);
  });

  it('find() returns -1 for 0, unknown slots and never-issued handles', () => {
    const s = new TestStore(8);
    expect(s.find(0)).toBe(-1);
    const row = s.alloc();
    const h = s.id[row] as number;
    expect(s.find(((1 << 16) | 7) >>> 0)).toBe(-1); // slot 7 never allocated
    expect(s.find(((1 << 16) | 9999) >>> 0)).toBe(-1); // slot beyond capacity
    expect(s.find(0xffffffff)).toBe(-1);
    expect(s.find(h)).toBe(row);
  });

  it('a freed handle stays invalid and the reused slot gets a new generation', () => {
    const s = new TestStore(2);
    const a = s.alloc();
    s.alloc();
    const hA = s.id[a] as number;
    s.free(a);
    expect(s.find(hA)).toBe(-1);
    const re = s.alloc(); // store was full of slots: this must reuse A's slot
    const hB = s.id[re] as number;
    expect(hB & 0xffff).toBe(hA & 0xffff);
    expect(hB >>> 16).toBe((hA >>> 16) + 1);
    expect(hB).not.toBe(hA);
    expect(s.find(hA)).toBe(-1);
    expect(s.find(hB)).toBe(re);
  });

  it('a stale handle never aliases a different live entity in the same slot', () => {
    const s = new TestStore(1);
    const stale: number[] = [];
    for (let i = 0; i < 50; i++) {
      const row = s.alloc();
      expect(row).toBe(0);
      const h = s.id[0] as number;
      for (const old of stale) expect(s.find(old)).toBe(-1);
      expect(s.find(h)).toBe(0);
      stale.push(h);
      s.free(0);
    }
    expect(new Set(stale).size).toBe(50);
  });

  it('handles are never 0 and generations skip 0 when they wrap', () => {
    const s = new TestStore(1);
    const seen = new Set<number>();
    for (let n = 1; n <= 70000; n++) {
      s.alloc();
      const h = s.id[0] as number;
      const gen = h >>> 16;
      if ((h & 0xffff) !== 0) throw new Error(`slot changed at allocation ${n}`);
      // generations count 1 … 0xffff and then wrap back to 1 (never 0)
      const want = ((n - 1) % 65535) + 1;
      if (h === 0 || gen !== want) throw new Error(`allocation ${n} has generation ${gen}, want ${want}`);
      if (n <= 65535) seen.add(h);
      s.free(0);
    }
    expect(seen.size).toBe(65535);
  });

  it('find() works for high generations (handles above 2^31)', () => {
    const s = new TestStore(3);
    const keep = s.alloc();
    const hKeep = s.id[keep] as number;
    for (let i = 0; i < 40000; i++) {
      const r = s.alloc();
      s.free(r);
    }
    const row = s.alloc();
    const h = s.id[row] as number;
    expect(h).toBeGreaterThan(0x80000000); // generation >= 0x8000
    expect(h).toBe(h >>> 0);
    expect(s.find(h)).toBe(row);
    expect(s.find(hKeep)).toBe(keep);
    s.free(row);
    expect(s.find(h)).toBe(-1);
  });

  it('handles of different slots never collide even at equal generation', () => {
    const s = new TestStore(32);
    const hs = new Set<number>();
    for (let i = 0; i < 32; i++) hs.add(s.id[s.alloc()] as number);
    expect(hs.size).toBe(32);
  });
});

describe('DenseStore capacity', () => {
  it('returns -1 when full and leaves the store untouched', () => {
    const s = new TestStore(5);
    for (let i = 0; i < 5; i++) fill(s, s.alloc(), i + 1);
    expect(s.count).toBe(5);
    expect(s.alloc()).toBe(-1);
    expect(s.alloc()).toBe(-1);
    expect(s.count).toBe(5);
    for (let i = 0; i < 5; i++) expectPayload(s, i, i + 1);
  });

  it('uses every slot exactly once while filling', () => {
    const s = new TestStore(40);
    const slots = new Set<number>();
    for (let i = 0; i < 40; i++) slots.add((s.id[s.alloc()] as number) & 0xffff);
    expect(slots.size).toBe(40);
    for (let i = 0; i < 40; i++) expect(slots.has(i)).toBe(true);
  });

  it('allocation works again after a free', () => {
    const s = new TestStore(3);
    for (let i = 0; i < 3; i++) s.alloc();
    expect(s.alloc()).toBe(-1);
    s.free(1);
    const row = s.alloc();
    expect(row).toBe(2);
    expect(s.count).toBe(3);
    expect(s.alloc()).toBe(-1);
  });

  it('a capacity-0 store always reports full', () => {
    const s = new TestStore(0);
    expect(s.alloc()).toBe(-1);
    expect(s.count).toBe(0);
    expect(s.find(1)).toBe(-1);
  });

  it('real stores honour their configured capacity', () => {
    expect(new EnemyStore().capacity).toBe(CAP.enemies);
    expect(new ProjectileStore().capacity).toBe(CAP.projectiles);
    expect(new PickupStore().capacity).toBe(CAP.pickups);
    expect(new ZoneStore().capacity).toBe(CAP.zones);
    expect(new TelegraphStore().capacity).toBe(CAP.telegraphs);
    const e = new EnemyStore(7);
    for (let i = 0; i < 7; i++) expect(e.alloc()).toBe(i);
    expect(e.alloc()).toBe(-1);
  });
});

describe('DenseStore.clear', () => {
  it('frees every row, invalidates every handle and zeroes the id column', () => {
    const s = new TestStore(10);
    const handles: number[] = [];
    for (let i = 0; i < 10; i++) {
      const row = s.alloc();
      fill(s, row, i + 1);
      handles.push(s.id[row] as number);
    }
    s.clear();
    expect(s.count).toBe(0);
    for (const h of handles) expect(s.find(h)).toBe(-1);
    for (let i = 0; i < 10; i++) expect(s.id[i]).toBe(0);
  });

  it('the store is fully reusable after a clear and old handles stay dead', () => {
    const s = new TestStore(6);
    const old: number[] = [];
    for (let i = 0; i < 6; i++) old.push(s.id[s.alloc()] as number);
    s.clear();
    const fresh: number[] = [];
    for (let i = 0; i < 6; i++) {
      const row = s.alloc();
      expect(row).toBe(i);
      fresh.push(s.id[row] as number);
    }
    expect(s.alloc()).toBe(-1);
    for (const h of old) expect(s.find(h)).toBe(-1);
    for (const h of fresh) expect(s.find(h)).toBeGreaterThanOrEqual(0);
    expect(new Set([...old, ...fresh]).size).toBe(12);
  });

  it('clearing an empty store is a no-op', () => {
    const s = new TestStore(4);
    s.clear();
    expect(s.count).toBe(0);
    expect(s.alloc()).toBe(0);
  });
});

describe('real stores (strided fields)', () => {
  it('EnemyStore zeroes atkReady / hitStamp / statT / statP / statSkill on alloc', () => {
    const e = new EnemyStore(6);
    for (let i = 0; i < 6; i++) e.alloc();
    e.atkReady.fill(3);
    e.hitStamp.fill(4);
    e.statT.fill(5);
    e.statP.fill(6);
    e.statSkill.fill(7);
    e.hp.fill(99);
    e.status.fill(0xff);
    e.clear();
    const row = e.alloc();
    for (let k = 0; k < 3; k++) expect(e.atkReady[row * 3 + k]).toBe(0);
    for (let k = 0; k < MAX_SKILL_SLOTS; k++) expect(e.hitStamp[row * MAX_SKILL_SLOTS + k]).toBe(0);
    for (let k = 0; k < 8; k++) {
      expect(e.statT[row * 8 + k]).toBe(0);
      expect(e.statP[row * 8 + k]).toBe(0);
      expect(e.statSkill[row * 8 + k]).toBe(0);
    }
    expect(e.hp[row]).toBe(0);
    expect(e.status[row]).toBe(0);
  });

  it('EnemyStore swap-remove carries the strided per-enemy arrays along', () => {
    const e = new EnemyStore(5);
    const handles: number[] = [];
    for (let i = 0; i < 4; i++) {
      const row = e.alloc();
      handles.push(e.id[row] as number);
      e.hp[row] = 10 + i;
      e.x[row] = i * 2;
      for (let k = 0; k < 8; k++) e.statT[row * 8 + k] = i * 100 + k;
      for (let k = 0; k < 3; k++) e.atkReady[row * 3 + k] = i + k * 0.5;
      for (let k = 0; k < MAX_SKILL_SLOTS; k++) e.hitStamp[row * MAX_SKILL_SLOTS + k] = i * 1000 + k;
    }
    e.free(e.find(handles[0] as number));
    for (const i of [1, 2, 3]) {
      const row = e.find(handles[i] as number);
      expect(row).toBeGreaterThanOrEqual(0);
      expect(e.hp[row]).toBe(10 + i);
      expect(e.x[row]).toBe(i * 2);
      for (let k = 0; k < 8; k++) expect(e.statT[row * 8 + k]).toBe(i * 100 + k);
      for (let k = 0; k < 3; k++) expect(e.atkReady[row * 3 + k]).toBeCloseTo(i + k * 0.5, 5);
      for (let k = 0; k < MAX_SKILL_SLOTS; k++) expect(e.hitStamp[row * MAX_SKILL_SLOTS + k]).toBe(i * 1000 + k);
    }
  });

  it('ProjectileStore zeroes the PROJ_HIT_MEM-wide hitMem and swap-remove keeps it aligned', () => {
    const p = new ProjectileStore(4);
    const hs: number[] = [];
    for (let i = 0; i < 3; i++) {
      const row = p.alloc();
      hs.push(p.id[row] as number);
      for (let k = 0; k < PROJ_HIT_MEM; k++) p.hitMem[row * PROJ_HIT_MEM + k] = (i + 1) * 100 + k;
      p.damage[row] = i + 1;
      p.mul[row] = 0.45;
      p.credit[row] = i + 2;
    }
    p.free(p.find(hs[0] as number));
    for (const i of [1, 2]) {
      const row = p.find(hs[i] as number);
      expect(p.damage[row]).toBe(i + 1);
      expect(p.mul[row]).toBeCloseTo(0.45, 5);
      expect(p.credit[row]).toBe(i + 2);
      for (let k = 0; k < PROJ_HIT_MEM; k++) expect(p.hitMem[row * PROJ_HIT_MEM + k]).toBe((i + 1) * 100 + k);
    }
    p.clear();
    const row = p.alloc();
    for (let k = 0; k < PROJ_HIT_MEM; k++) expect(p.hitMem[row * PROJ_HIT_MEM + k]).toBe(0);
    expect(p.mul[row]).toBe(0);
    expect(p.credit[row]).toBe(0);
  });
});
