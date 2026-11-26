// Marker rows in the SkillVfxFeed (skill-logic): a hero-attached `sk.<skill>.loop` marker whose skill has no spec of that id draws the shared
// shell ring (`sk.gen.shell_ring`, vfx/skills/common/moments.ts); a real spec always wins; nothing else is redirected.
import { describe, expect, it } from 'vitest';
import { realWorld } from '../../sim/__tests__/skillLab';
import { spawnMarker } from '../../sim/skills/companions';
import type { PlayerState } from '../../sim/stores';
import type { Vfx } from '../../vfx/types';
import { SHELL_RING_FALLBACK, SkillVfxFeed } from '../skillVfxFeed';

class FeedVfx {
  tracked: string[] = [];
  constructor(private readonly known: ReadonlySet<string> | null) {}
  spawn(): number {
    return 0;
  }
  move(): void {}
  stop(): void {}
  track(id: string): void {
    this.tracked.push(id);
  }
  has?(id: string): boolean;
}

function run(styles: string[], known: ReadonlySet<string> | null): string[] {
  const w = realWorld({ classId: 'warrior', doctrine: 'b' });
  const p = w.players[0] as PlayerState;
  for (const s of styles) spawnMarker(w, p, 0, s, 1.5, 5, true);
  const vfx = new FeedVfx(known);
  if (known !== null) vfx.has = (id: string): boolean => known.has(id);
  new SkillVfxFeed().update(w, vfx as unknown as Vfx, 0.5, () => 0);
  return vfx.tracked.sort();
}

describe('marker rows: the shell ring fallback', () => {
  it('a .loop marker with no spec of its own draws sk.gen.shell_ring', () => {
    expect(run(['sk.graniteform.loop'], new Set(['sk.gen.shell_ring']))).toEqual([SHELL_RING_FALLBACK]);
  });

  it('a real sk.<skill>.loop spec wins', () => {
    expect(run(['sk.graniteform.loop'], new Set(['sk.graniteform.loop', 'sk.gen.shell_ring']))).toEqual(['sk.graniteform.loop']);
  });

  it('other markers (veil ring, decoy, guard, bait ring) are never redirected', () => {
    const styles = ['sk.gen.veil_ring', 'sk.nightshroud.decoy', 'sk.war_oath.guard', 'sk.gen.bait_ring'];
    expect(run(styles, new Set())).toEqual([...styles].sort());
  });

  it('a Vfx that cannot answer has() (stubs, old builds) keeps the row\'s own id', () => {
    expect(run(['sk.graniteform.loop'], null)).toEqual(['sk.graniteform.loop']);
  });
});
