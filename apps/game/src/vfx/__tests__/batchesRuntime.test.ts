import { describe, expect, it } from 'vitest';
import {
  DebrisBatch,
  ParticleBatch,
  R_PTS,
  RibbonBatch,
  S_STRIDE,
  ShapeBatch,
  type SharedUniforms,
} from '../batches';
import { Fx } from '../emit';
import { VFX_PROFILES } from '../quality';
import { SPEC_PARTICLE_VERT } from '../spec/shaders';

function fakeUniforms(): SharedUniforms {
  return {
    uTime: { value: 0 },
    uAtlas: { value: null },
    uNoise: { value: null },
    uDepth: { value: null },
    uInvRes: { value: { x: 1, y: 1 } },
    uNearFar: { value: { x: 0.5, y: 220 } },
    uSoft: { value: 0 },
  };
}

describe('VFX legacy batch idle/clear/downgrade reclamation (RENDER-03)', () => {
  it('resets used, cursors, GPU instanceCount/drawRange and visibility on clear and after expiry', () => {
    const u = fakeUniforms();
    const p = new ParticleBatch(16, 'add', u);
    const s = new ShapeBatch(16, 'add', u);
    const r = new RibbonBatch(16, u);
    const d = new DebrisBatch(16, u);

    // Populate all 4 batches with 10 entries expiring at t = 1.
    for (let i = 0; i < 10; i++) {
      const pi = p.alloc();
      p.endT[pi] = 1;
      const si = s.alloc(0);
      s.endT[si] = 1;
      const ri = r.alloc(0);
      r.endT[ri] = 1;
      const di = d.alloc();
      d.endT[di] = 1;
    }
    p.flush(0.5);
    s.flush(0.5);
    r.flush(0.5);
    d.flush(0.5);

    expect(p.used).toBe(10);
    expect(p.geo.instanceCount).toBe(10);
    expect(p.mesh.visible).toBe(true);
    expect(s.used).toBe(10);
    expect(s.geo.instanceCount).toBe(10);
    expect(s.mesh.visible).toBe(true);
    expect(r.used).toBe(10);
    expect(r.geo.drawRange.count).toBe(10 * (R_PTS - 1) * 6);
    expect(r.mesh.visible).toBe(true);
    expect(d.used).toBe(10);
    expect(d.geo.instanceCount).toBe(10);
    expect(d.mesh.visible).toBe(true);

    // Once all entries expire, flush(now) reclaims trailing slots down to 0 and hides idle meshes.
    p.flush(1.5);
    s.flush(1.5);
    r.flush(1.5);
    d.flush(1.5);

    expect(p.used).toBe(0);
    expect(p.geo.instanceCount).toBe(0);
    expect(p.mesh.visible).toBe(false);
    expect(s.used).toBe(0);
    expect(s.geo.instanceCount).toBe(0);
    expect(s.mesh.visible).toBe(false);
    expect(r.used).toBe(0);
    expect(r.geo.drawRange.count).toBe(0);
    expect(r.mesh.visible).toBe(false);
    expect(d.used).toBe(0);
    expect(d.geo.instanceCount).toBe(0);
    expect(d.mesh.visible).toBe(false);

    // Re-populate, then clear() + flush() must also yield 0 used and 0 GPU instances/drawRange immediately.
    for (let i = 0; i < 6; i++) {
      const pi = p.alloc();
      p.endT[pi] = 10;
      const si = s.alloc(0);
      s.endT[si] = 10;
      s.pinned[si] = 1;
      const ri = r.alloc(0);
      r.endT[ri] = 10;
      r.pinned[ri] = 1;
      const di = d.alloc();
      d.endT[di] = 10;
    }
    p.clear();
    s.clear();
    r.clear();
    d.clear();
    p.flush();
    s.flush();
    r.flush();
    d.flush();

    expect(p.used).toBe(0);
    expect(p.head).toBe(0);
    expect(p.geo.instanceCount).toBe(0);
    expect(p.mesh.visible).toBe(false);
    expect(s.used).toBe(0);
    expect(s.geo.instanceCount).toBe(0);
    expect(s.mesh.visible).toBe(false);
    expect(r.used).toBe(0);
    expect(r.geo.drawRange.count).toBe(0);
    expect(r.mesh.visible).toBe(false);
    expect(d.used).toBe(0);
    expect(d.head).toBe(0);
    expect(d.geo.instanceCount).toBe(0);
    expect(d.mesh.visible).toBe(false);

    p.dispose();
    s.dispose();
    r.dispose();
    d.dispose();
  });

  it('converges historical high-water mark to the lower tier budget after ultra -> low cap reduction', () => {
    const u = fakeUniforms();
    const p = new ParticleBatch(16, 'add', u);
    const s = new ShapeBatch(16, 'add', u);

    // Ultra-tier burst fills 10 slots expiring at t = 1.
    for (let i = 0; i < 10; i++) {
      const pi = p.alloc();
      p.endT[pi] = 1;
      const si = s.alloc(0);
      s.endT[si] = 1;
    }
    p.flush(0.5);
    s.flush(0.5);
    expect(p.geo.instanceCount).toBe(10);
    expect(s.geo.instanceCount).toBe(10);

    // Downgrade cap to 2 and emit 2 newer entries expiring at t = 5.
    p.setCap(2);
    s.setCap(2);
    for (let i = 0; i < 2; i++) {
      const pi = p.alloc();
      p.endT[pi] = 5;
      const si = s.alloc(0);
      s.endT[si] = 5;
    }

    // Once the older slots (2..9) expire at t = 2, used and instanceCount converge to the low cap (2).
    p.flush(2);
    s.flush(2);
    expect(p.used).toBe(2);
    expect(p.geo.instanceCount).toBe(2);
    expect(s.used).toBe(2);
    expect(s.geo.instanceCount).toBe(2);

    // After clear + flush, both drop to 0.
    p.clear();
    s.clear();
    p.flush();
    s.flush();
    expect(p.used).toBe(0);
    expect(p.geo.instanceCount).toBe(0);
    expect(s.used).toBe(0);
    expect(s.geo.instanceCount).toBe(0);

    p.dispose();
    s.dispose();
  });
});

describe('VFX pinned slot protection & generation-stamped handles (RENDER-04)', () => {
  it('returns -1 when all ShapeBatch or RibbonBatch slots are pinned without overwriting active owners', () => {
    const u = fakeUniforms();
    const sAdd = new ShapeBatch(2, 'add', u);
    const sAlpha = new ShapeBatch(2, 'alpha', u);
    const ribbons = new RibbonBatch(2, u);
    const pAdd = new ParticleBatch(4, 'add', u);
    const pAlpha = new ParticleBatch(4, 'alpha', u);
    const debris = new DebrisBatch(4, u);
    const fx = new Fx(VFX_PROFILES.low, pAdd, pAlpha, sAdd, sAlpha, ribbons, debris);

    // Pin both slots of ShapeBatch via SBuilder.
    const h0 = fx.shp.at(10, 1, 20).disk(2).life(5).pinned().emit();
    const h1 = fx.shp.at(30, 2, 40).disk(3).life(5).pinned().emit();
    expect(h0).toBeGreaterThan(0);
    expect(h1).toBeGreaterThan(0);

    // Third allocation must fail cleanly (-1) and leave pinned slots untouched.
    expect(sAdd.alloc(0)).toBe(-1);
    const h2 = fx.shp.at(99, 9, 99).disk(9).life(5).pinned().emit();
    expect(h2).toBe(-1);
    expect(sAdd.f[0]).toBe(10);
    expect(sAdd.f[2]).toBe(20);
    expect(sAdd.f[S_STRIDE]).toBe(30);
    expect(sAdd.f[S_STRIDE + 2]).toBe(40);
    expect(sAdd.pinned[0]).toBe(1);
    expect(sAdd.pinned[1]).toBe(1);

    // Pin both chunks of RibbonBatch.
    const c0 = ribbons.alloc(0);
    ribbons.pinned[c0] = 1;
    ribbons.endT[c0] = 1e9;
    const c1 = ribbons.alloc(0);
    ribbons.pinned[c1] = 1;
    ribbons.endT[c1] = 1e9;

    // Next RibbonBatch alloc must fail cleanly (-1), and RBuilder streak/bolt must degrade safely without throwing.
    expect(ribbons.alloc(0)).toBe(-1);
    const droppedBefore = fx.dropped;
    fx.rb.width(0.3).life(0.4).streak(0, 0, 0, 5, 0, 5);
    fx.rb.width(0.3).life(0.4).bolt(0, 0, 0, 5, 0, 5);
    expect(fx.dropped).toBeGreaterThanOrEqual(droppedBefore + 2);
    expect(ribbons.pinned[0]).toBe(1);
    expect(ribbons.pinned[1]).toBe(1);

    pAdd.dispose();
    pAlpha.dispose();
    sAdd.dispose();
    sAlpha.dispose();
    ribbons.dispose();
    debris.dispose();
  });

  it('invalidates stale shape handles when a slot is freed and reused so old owners cannot move or kill newer effects', () => {
    const u = fakeUniforms();
    const sAdd = new ShapeBatch(1, 'add', u);
    const sAlpha = new ShapeBatch(1, 'alpha', u);
    const ribbons = new RibbonBatch(1, u);
    const pAdd = new ParticleBatch(4, 'add', u);
    const pAlpha = new ParticleBatch(4, 'alpha', u);
    const debris = new DebrisBatch(4, u);
    const fx = new Fx(VFX_PROFILES.low, pAdd, pAlpha, sAdd, sAlpha, ribbons, debris);

    const oldHandle = fx.shp.at(1, 0, 2).yaw_(0.5).disk(2).life(5).pinned().emit();
    expect(oldHandle).toBeGreaterThan(0);

    // Owner A kills its shape and lets the 0.35s fade finish.
    fx.shp.kill(oldHandle);
    fx.time = 1;

    // Owner B reuses the freed slot 0 with a new generation handle.
    const newHandle = fx.shp.at(50, 3, 60).yaw_(1.25).disk(4).life(5).pinned().emit();
    expect(newHandle).toBeGreaterThan(0);
    expect(newHandle).not.toBe(oldHandle);

    // Stale owner A tries to move, rotate, and kill via oldHandle: all must be ignored!
    fx.shp.move(oldHandle, -99, -99, -99);
    fx.shp.setYaw(oldHandle, -2.5);
    fx.shp.kill(oldHandle);

    expect(sAdd.f[0]).toBe(50);
    expect(sAdd.f[1]).toBe(3);
    expect(sAdd.f[2]).toBe(60);
    expect(sAdd.f[4]).toBeCloseTo(1.25, 5);
    expect(sAdd.pinned[0]).toBe(1);

    // Valid newHandle still mutates slot 0 normally.
    fx.shp.move(newHandle, 70, 4, 80);
    expect(sAdd.f[0]).toBe(70);
    expect(sAdd.f[1]).toBe(4);
    expect(sAdd.f[2]).toBe(80);

    pAdd.dispose();
    pAlpha.dispose();
    sAdd.dispose();
    sAlpha.dispose();
    ribbons.dispose();
    debris.dispose();
  });
});

describe('SPEC_PARTICLE_VERT trail varying initialization (RENDER-10)', () => {
  it('assigns vSoft = 0.0 on the live trail path before its early return', () => {
    const mainIdx = SPEC_PARTICLE_VERT.indexOf('void main()');
    const trailBranchIdx = SPEC_PARTICLE_VERT.indexOf('if (((fl >> 4) & 1) == 1)', mainIdx);
    expect(mainIdx).toBeGreaterThan(-1);
    expect(trailBranchIdx).toBeGreaterThan(mainIdx);

    // Locate the early `return;` at the end of the live trail branch (after the hidden guard return).
    const trailBody = SPEC_PARTICLE_VERT.slice(trailBranchIdx);
    const liveReturnIdx = trailBody.indexOf('\n    return;');
    expect(liveReturnIdx).toBeGreaterThan(0);

    const beforeTrailReturn = SPEC_PARTICLE_VERT.slice(mainIdx, trailBranchIdx + liveReturnIdx);
    expect(beforeTrailReturn).toMatch(/\bvSoft\s*=\s*0\.0\s*;/);
  });
});
