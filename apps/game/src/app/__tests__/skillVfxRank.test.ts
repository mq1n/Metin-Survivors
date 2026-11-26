// Skill VFX rank plumbing: zone rows, `sk.*` projectile rows and sim `vfx` events carry the casting skill's rank /
// awakened / caster into the VFX layer (SpawnOpts.rank …, track meta, EventAdapter.skillMeta), so `sk.*` specs escalate

import { describe, expect, it } from 'vitest';
import { NO_INPUT, freezeSchedules, giveSkill, makeWorld, spawn } from '../../sim/__tests__/helpers';
import { EventAdapter } from '../../vfx/adapter';
import type { VfxSystem } from '../../vfx/system';
import type { SkillMeta, SkillMetaSource, SpawnOpts, Vfx } from '../../vfx/types';
import { SkillVfxFeed } from '../skillVfxFeed';

class RankVfx {
  spawned: Array<{ id: string; opts: SpawnOpts }> = [];
  tracked: Array<{ id: string; meta: SkillMeta | undefined }> = [];
  source: SkillMetaSource | null = null;
  private next = 1;
  spawn(id: string, o: SpawnOpts): number {
    this.spawned.push({ id, opts: { ...o } });
    return this.next++;
  }
  move(): void {}
  stop(): void {}
  track(id: string, _key: number, _x: number, _z: number, _y?: number, _dx?: number, _dz?: number, _s?: number, _c?: unknown, meta?: SkillMeta): void {
    this.tracked.push({ id, meta: meta ? { ...meta } : undefined });
  }
  setSkillMeta(fn: SkillMetaSource | null): void {
    this.source = fn;
  }
}

function run(id: string, rank: number, vfx: string, ticks = 300): RankVfx {
  const w = makeWorld({
    config: { seed: 3 },
    content: (c) => {
      const s = c.skills.find((k) => k.id === id);
      if (s) s.vfx = vfx;
    },
  });
  freezeSchedules(w);
  w.players[0]!.skills.length = 0;
  giveSkill(w, id, rank);
  spawn(w, 'wolf', 0, 4);
  spawn(w, 'wolf', 1.5, 5);
  const feed = new SkillVfxFeed();
  const fake = new RankVfx();
  for (let t = 0; t < ticks; t++) {
    w.step([NO_INPUT]);
    feed.update(w, fake as unknown as Vfx, 1, () => 0);
  }
  return fake;
}

describe('skill VFX rank plumbing', () => {
  it('zone rows spawn with the skill rank, awakened flag and caster', () => {
    const fake = run('venom_pool', 4, 'sk.noxious_pall');
    expect(fake.spawned.length).toBeGreaterThan(0);
    for (const s of fake.spawned) {
      expect(s.opts.rank).toBe(4);
      expect(s.opts.awakened).toBe(false);
      expect(s.opts.caster).toBe(0);
    }
    const p = run('venom_pool', 7, 'sk.noxious_pall');
    expect(p.spawned[0]?.opts.awakened).toBe(true);
  });

  it('`sk.*` projectile rows are tracked with the skill meta', () => {
    const fake = run('spirit_bolt', 6, 'sk.drifting_charms');
    expect(fake.tracked.length).toBeGreaterThan(0);
    for (const t of fake.tracked) expect(t.meta).toEqual({ rank: 6, awakened: false, caster: 0 });
  });

  it('installs a lookup that resolves sim events by preset or skill id to the nearest owner', () => {
    const fake = run('venom_pool', 5, 'sk.noxious_pall', 2);
    expect(fake.source).not.toBeNull();
    const out: SkillMeta = { rank: 0, awakened: false, caster: -1 };
    expect(fake.source!('sk.noxious_pall', 0, 0, out)).toBe(true);
    expect(out).toEqual({ rank: 5, awakened: false, caster: 0 });
    expect(fake.source!('venom_pool', 0, 0, out)).toBe(true);
    expect(fake.source!('sk.not_owned', 0, 0, out)).toBe(false);
  });

  it('the event adapter stamps `sk.*` events (and only those) with the looked-up meta', () => {
    const spawned: Array<{ id: string; o: SpawnOpts }> = [];
    const sys = { resolve: () => null, spawn: (id: string, o: SpawnOpts) => (spawned.push({ id, o: { ...o } }), 1), heightAt: () => 0, fx: { density: 1 } } as unknown as VfxSystem;
    const adapter = new EventAdapter(sys);
    adapter.skillMeta = (key, _x, _z, out) => {
      if (key !== 'sk.crushing_blow') return false;
      out.rank = 3;
      out.awakened = false;
      out.caster = 1;
      return true;
    };
    const ev = (preset: string): unknown => ({ t: 'vfx', preset, x: 1, z: 2, dirX: 0, dirZ: 1, scale: 3, duration: 0.3, color: -1, tx: 0, tz: 0, hasTarget: false, element: 0 });
    adapter.handle1(ev('sk.crushing_blow'));
    adapter.handle1(ev('boss.slam'));
    expect(spawned[0]?.o).toMatchObject({ rank: 3, awakened: false, caster: 1 });
    expect(spawned[1]?.o.rank).toBeUndefined();
    expect(spawned[1]?.o.caster).toBeUndefined();
  });
});
