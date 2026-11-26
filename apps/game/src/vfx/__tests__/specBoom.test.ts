// FxSpec.explode = 'none': the sim's generic awakening explosion (`vfx_explode`) of a skill whose spec owns its blast is dropped
// before the EventAdapter sees it (spec/boom.ts). The guard is pure data and tested here; its wiring in VfxSystem (track / move
// notes, both event entry points, the `.explode` companion exception) needs the real renderer (VfxSystem bakes GPU textures in

import { describe, expect, it } from 'vitest';
import { BoomGuard } from '../spec/boom';
import type { FxSpec } from '../spec/types';

function spec(id: string, explode?: 'generic' | 'none'): FxSpec {
  const base: FxSpec = { id, desc: 'test', behavior: 'meleeArc', ref: {}, size: 'radius', base: 2, dur: 1, elements: [] };
  return explode === undefined ? base : { ...base, explode };
}

const vfx = (preset: string, x: number, z: number, extra: object = {}): object => ({ t: 'vfx', preset, x, z, dirX: 0, dirZ: 1, scale: 1, duration: 0.3, color: -1, tx: 0, tz: 0, hasTarget: false, element: 1, ...extra });

/** preset ids the adapter would receive for a batch at tick `now` */
function seen(g: BoomGuard, batch: object[], now = 1): string[] {
  const out: string[] = [];
  g.dispatch(batch, batch.length, now, (e) => out.push((e as { preset: string }).preset));
  return out;
}

describe('BoomGuard (FxSpec.explode)', () => {
  it('is inactive unless a spec opts in; the default and "generic" keep the explosion', () => {
    expect(new BoomGuard([spec('sk.a'), spec('sk.b', 'generic')]).active).toBe(false);
    const g = new BoomGuard([spec('sk.a'), spec('sk.b', 'generic')]);
    expect(seen(g, [vfx('sk.a', 3, 0), vfx('vfx_explode', 3, 0)])).toEqual(['sk.a', 'vfx_explode']);
  });

  it('a spec with an sk.<id>.explode companion keeps the companion path (the adapter plays it)', () => {
    const g = new BoomGuard([spec('sk.a', 'none'), spec('sk.b', 'none')], new Set(['sk.a']));
    expect(g.owns('sk.a')).toBe(false);
    expect(g.owns('sk.b')).toBe(true);
    expect(seen(g, [vfx('sk.a', 3, 0), vfx('vfx_explode', 3, 0)])).toEqual(['sk.a', 'vfx_explode']);
  });

  it('drops the explosion that follows the skill event at the same point (sky strike), in either order (leap)', () => {
    const g = new BoomGuard([spec('sk.strike', 'none')]);
    expect(seen(g, [vfx('sk.strike', 3, 1), vfx('vfx_explode', 3, 1)])).toEqual(['sk.strike']);
    // giant_leap: explodeAt runs BEFORE the skill's own event
    expect(seen(g, [vfx('vfx_explode', 5, 2), vfx('sk.strike', 5, 2)], 2)).toEqual(['sk.strike']);
  });

  it('drops the explosion on the far end of a line event (chain: the explosion sits on the last hop target)', () => {
    const g = new BoomGuard([spec('sk.chain', 'none')]);
    const hop1 = vfx('sk.chain', 0, 0, { tx: 4, tz: 0, hasTarget: true });
    const hop2 = vfx('sk.chain', 4, 0, { tx: 7, tz: 1, hasTarget: true });
    expect(seen(g, [hop1, hop2, vfx('vfx_explode', 7, 1)])).toEqual(['sk.chain', 'sk.chain']);
    // an explosion elsewhere in the same batch is not the skill's
    expect(seen(g, [hop1, hop2, vfx('vfx_explode', 12, 9)], 2)).toEqual(['sk.chain', 'sk.chain', 'vfx_explode']);
  });

  it('keeps every other explosion: other skills, enemy explosions, other points, other ticks', () => {
    const g = new BoomGuard([spec('sk.strike', 'none')]);
    expect(seen(g, [vfx('sk.other', 3, 1), vfx('vfx_explode', 3, 1)])).toEqual(['sk.other', 'vfx_explode']);
    expect(seen(g, [vfx('vfx_explode', 3, 1)], 2)).toEqual(['vfx_explode']);
    expect(seen(g, [vfx('sk.strike', 3, 1), vfx('vfx_explode', 8, 1)], 3)).toEqual(['sk.strike', 'vfx_explode']);
    // the skill event of an EARLIER tick does not own a later explosion at the same point
    seen(g, [vfx('sk.strike', 4, 4)], 4);
    expect(seen(g, [vfx('vfx_explode', 4, 4)], 5)).toEqual(['vfx_explode']);
  });

  it('drops the explosion where a tracked projectile body or a zone row stopped, and nowhere else', () => {
    const g = new BoomGuard([spec('sk.bolt', 'none')]);
    g.note('sk.bolt', 5, 3.2, 0, 1);
    g.note('sk.zone', 9, 20, 20, 1); // not an owner: ignored
    g.note('sk.bolt', -131, -6, 4, 1); // a zone row (key = -handle)
    expect(seen(g, [vfx('vfx_explode', 3.4, 0)], 1.1)).toEqual([]);
    expect(seen(g, [vfx('vfx_explode', -6, 4.2)], 1.1)).toEqual([]);
    expect(seen(g, [vfx('vfx_explode', 20, 20)], 1.1)).toEqual(['vfx_explode']);
    expect(seen(g, [vfx('vfx_explode', 30, 0)], 1.1)).toEqual(['vfx_explode']);
  });

  it('a body that stopped reporting more than 0.25 s ago owns nothing; old notes are dropped', () => {
    const g = new BoomGuard([spec('sk.bolt', 'none')]);
    g.note('sk.bolt', 5, 3.2, 0, 1);
    expect(seen(g, [vfx('vfx_explode', 3.2, 0)], 1.3)).toEqual(['vfx_explode']);
    expect(seen(g, [vfx('vfx_explode', 3.2, 0)], 2.5)).toEqual(['vfx_explode']);
    g.note('sk.bolt', 5, 3.2, 0, 3); // reporting again
    expect(seen(g, [vfx('vfx_explode', 3.2, 0)], 3.1)).toEqual([]);
    g.clear();
    expect(seen(g, [vfx('vfx_explode', 3.2, 0)], 3.1)).toEqual(['vfx_explode']);
  });

  it('prunes finished bodies, so a long run of casts never piles up notes', () => {
    const g = new BoomGuard([spec('sk.bolt', 'none')]);
    for (let k = 1; k <= 400; k++) g.note('sk.bolt', k, 0, 0, k * 0.1);
    const bodies = (g as unknown as { bodies: Map<number, unknown> }).bodies;
    expect(bodies.size).toBeLessThanOrEqual(48 + 10);
  });

  it('a single event (VfxSystem.handleEvent) is matched with the explosions that follow it', () => {
    const g = new BoomGuard([spec('sk.strike', 'none')]);
    const out: string[] = [];
    const push = (e: unknown): void => void out.push((e as { preset: string }).preset);
    g.dispatchOne(vfx('sk.strike', 3, 1), 1, push);
    g.dispatchOne(vfx('vfx_explode', 3, 1), 1, push);
    g.dispatchOne(vfx('vfx_explode', 9, 9), 1, push);
    expect(out).toEqual(['sk.strike', 'vfx_explode']);
  });

  it('ignores malformed entries and passes every non-explosion event through untouched', () => {
    const g = new BoomGuard([spec('sk.a', 'none')]);
    const out: unknown[] = [];
    const batch = [null, undefined, { t: 'hit' }, vfx('sk.a', 1, 1), 7];
    g.dispatch(batch, batch.length, 1, (e) => out.push(e));
    expect(out).toEqual(batch);
  });
});
