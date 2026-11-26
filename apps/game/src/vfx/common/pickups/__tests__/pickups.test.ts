// pickups target (r1): route wiring, the sprites it draws ship and are carried into every run, the collect presets stay cheap
// (they fire hundreds of times) and no preset draws the plain plus-sign cell or a hairline ring.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../../../../sim/events';
import { DebrisBatch, ParticleBatch, RibbonBatch, ShapeBatch, P_STRIDE, type SharedUniforms } from '../../../batches';
import { Ctx, Fx } from '../../../emit';
import { PALETTES, type PaletteId } from '../../../palette';
import type { Resolved } from '../../../presets';
import { VFX_PROFILES } from '../../../quality';
import { artKey } from '../../../spec/artScope';
import { SPR } from '../../../textures';
import type { SpawnOpts } from '../../../types';
import type { RouteCtx } from '../../route';
import { PICKUP_ART_IDS, PK_ART } from '../art';
import { presets } from '../presets';
import { PICKUP, XP_BUDGET, pickupRoutes } from '../route';
import { PICKUP_ART_SPEC, specs } from '../specs';

interface Fired {
  id: string;
  o: SpawnOpts;
}

function harness() {
  const fired: Fired[] = [];
  const ctx = {
    time: 0,
    density: 1,
    players: new Float32Array(12),
    heightAt: () => 0,
    resolve: (id: string) => ({ def: { id }, palette: null, element: -1, variant: -1 }) as unknown as Resolved,
    o: (x: number, z: number, scale: number, dirX?: number, dirZ?: number) => ({ x, z, scale, dirX, dirZ }),
    fire: (id: string, o: SpawnOpts) => {
      fired.push({ id, o: { ...o } });
      return 0;
    },
    spawnResolved: () => 0,
    stop: () => {},
    alive: () => false,
    once: () => true,
    since: () => Infinity,
    mark: () => {},
    deathPreset: () => undefined,
    metinRune: () => 0,
    bossPos: () => false,
    telegraphEvents: false,
  } as unknown as RouteCtx;
  const routes = pickupRoutes();
  const send = (e: Record<string, unknown>): Fired[] => {
    const n = fired.length;
    for (const r of routes) if (r.events.includes((e as { t: string }).t as never)) r.handle(e as unknown as SimEvent, ctx);
    return fired.slice(n);
  };
  for (const r of routes) r.update?.(1 / 60, ctx);
  return { send };
}

function uniforms(): SharedUniforms {
  return {
    uTime: { value: 0 },
    uAtlas: { value: null },
    uNoise: { value: null },
    uDepth: { value: null },
    uInvRes: { value: { x: 1, y: 1 } },
    uNearFar: { value: { x: 0.1, y: 100 } },
    uSoft: { value: 0 },
  } as unknown as SharedUniforms;
}
function rig() {
  const u = uniforms();
  const pAdd = new ParticleBatch(1024, 'add', u);
  const pAlp = new ParticleBatch(1024, 'alpha', u);
  const fx = new Fx(VFX_PROFILES.high, pAdd, pAlp, new ShapeBatch(64, 'add', u), new ShapeBatch(64, 'alpha', u), new RibbonBatch(16, u), new DebrisBatch(64, u));
  fx.budget = 10_000;
  return { fx, pAdd, pAlp };
}
function live(b: ParticleBatch): { cell: number }[] {
  const out: { cell: number }[] = [];
  for (let i = 0; i < b.cap; i++) if ((b.f[i * P_STRIDE + 7] as number) > 0 && (b.f[i * P_STRIDE + 3] as number) > -1e5) out.push({ cell: b.f[i * P_STRIDE + 17] as number });
  return out;
}
function fire(id: string): { n: number; cells: number[] } {
  const def = presets.find((p) => p.id === id);
  if (!def) throw new Error(`no preset ${id}`);
  const r = rig();
  const c = new Ctx();
  Object.assign(c.pal, PALETTES[(def.palette ?? 'xp') as PaletteId]);
  c.scale = 1;
  c.seed = 3;
  def.fire(r.fx, c);
  const all = [...live(r.pAdd), ...live(r.pAlp)];
  return { n: all.length, cells: all.map((p) => p.cell) };
}

describe('pickups route', () => {
  it('maps every PickupKind to its preset; a chest collect draws nothing (chestOpen plays the burst)', () => {
    const h = harness();
    expect(h.send({ t: 'pickup', kind: PICKUP.xp, tier: 2, x: 1, z: 1 }).map((f) => f.id)).toEqual(['pickup.xp']);
    expect(h.send({ t: 'pickup', kind: PICKUP.yeop, tier: 0, x: 1, z: 1 }).map((f) => f.id)).toEqual(['pickup.yeop']);
    expect(h.send({ t: 'pickup', kind: PICKUP.heal, tier: 0, x: 1, z: 1 }).map((f) => f.id)).toEqual(['sk.gen.potion_red']);
    expect(h.send({ t: 'pickup', kind: PICKUP.magnet, tier: 0, x: 1, z: 1 }).map((f) => f.id)).toEqual(['pickup.magnet']);
    expect(h.send({ t: 'pickup', kind: PICKUP.chest, tier: 0, x: 1, z: 1 })).toEqual([]);
    expect(h.send({ t: 'chestOpen', boss: false, x: 0, z: 0 }).map((f) => f.id)).toEqual(['chest.open']);
    expect(h.send({ t: 'chestOpen', boss: true, x: 0, z: 0 }).map((f) => f.id)).toEqual(['chest.open.boss']);
  });
  it('rations xp / yeop collect flashes per frame', () => {
    const h = harness();
    let n = 0;
    for (let i = 0; i < XP_BUDGET + 40; i++) n += h.send({ t: 'pickup', kind: PICKUP.xp, tier: 0, x: 0, z: 0 }).length;
    expect(n).toBe(XP_BUDGET);
  });
});

describe('pickups art', () => {
  it('every sprite the presets draw ships in the vfx manifest', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../../../../public/assets/manifest/textures.json', import.meta.url), 'utf8')) as { textures?: Record<string, unknown> } | Record<string, unknown>;
    const tex = ((manifest as { textures?: Record<string, unknown> }).textures ?? manifest) as Record<string, unknown>;
    expect(PICKUP_ART_IDS.filter((id) => tex[id] === undefined)).toEqual([]);
    expect(new Set(PICKUP_ART_IDS).size).toBe(PICKUP_ART_IDS.length);
  });
  it('the carrier spec keeps exactly those sprites in every run (sk.gen.* = common scope)', () => {
    expect(specs).toEqual([PICKUP_ART_SPEC]);
    expect(PICKUP_ART_SPEC.id.startsWith('sk.gen.')).toBe(true);
    const keys = PICKUP_ART_SPEC.elements.map((e) => (e.kind === 'particle' && typeof e.tex === 'object' ? artKey(e.tex.art) : ''));
    expect(keys.sort()).toEqual([...PICKUP_ART_IDS].sort());
  });
  it('the coin sheet reaches the packer as a 2 x 2 flipbook (the manifest carries no grid)', () => {
    const el = PICKUP_ART_SPEC.elements.find((e) => e.kind === 'particle' && typeof e.tex === 'object' && artKey(e.tex.art) === PK_ART.coin.id);
    expect(el && el.kind === 'particle' && typeof el.tex === 'object' ? el.tex.grid : null).toEqual([2, 2]);
    expect(PK_ART.chestBurst.id).toBe('vfx_pickups_chest_burst');
    expect(PK_ART.moneyRing.id).toBe('vfx_pickups_money_ring');
  });
});

describe('pickups presets', () => {
  it('owns the ids of the contract (pickup.heal stays until the core deletes it)', () => {
    expect(presets.map((p) => p.id).sort()).toEqual(['chest.open', 'chest.open.boss', 'pickup.heal', 'pickup.magnet', 'pickup.shard', 'pickup.xp', 'pickup.yeop']);
  });
  it('the collect flashes stay cheap (they fire hundreds of times per run)', () => {
    expect(fire('pickup.xp').n).toBeLessThanOrEqual(9);
    expect(fire('pickup.yeop').n).toBeLessThanOrEqual(10);
  });
  it('the magnet and chest bursts stay inside the particle budget', () => {
    expect(fire('pickup.magnet').n).toBeLessThanOrEqual(60);
    expect(fire('chest.open').n).toBeLessThanOrEqual(110);
    expect(fire('chest.open.boss').n).toBeLessThanOrEqual(190);
  });
  it('never draws the plain plus-sign cell (clip-art) or a thin vector ring', () => {
    for (const p of presets) {
      const cells = fire(p.id).cells;
      expect(cells.includes(SPR.cross), `${p.id} draws the plus-sign cell`).toBe(false);
      expect(cells.includes(SPR.ringThin), `${p.id} draws the hairline ring cell`).toBe(false);
      expect(cells.includes(SPR.ringThick), `${p.id} draws the vector ring cell`).toBe(false);
    }
  });
  it('every art entry has a procedural fallback cell', () => {
    for (const a of Object.values(PK_ART)) expect(typeof a.fb).toBe('number');
  });
});
