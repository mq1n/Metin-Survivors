// Enemy projectiles (common VFX target `enemy-projectiles`): the making / release / blow specs, the look mapping, the route.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { styleFromName } from '../../../../app/simFeed';
import bosses from '../../../../data/content/bosses.json';
import enemies from '../../../../data/content/enemies.json';
import { LOOK, ProjEventKind, clearProjEvents, pushProjEvent } from '../../../../render/fx/projectileEvents';
import { lookOfColor } from '../../../../render/fx/projectileLooks';
import type { Resolved } from '../../../presets';
import { elementRows } from '../../../spec/curves';
import type { SpawnOpts } from '../../../types';
import type { RouteCtx } from '../../route';
import { ENEMY_PROJECTILE_ART_IDS } from '../art';
import { EP_LOOKS, epLookOf, epLookOfName } from '../looks';
import { buildRangedTable, enemyProjectileRoutes } from '../route';
import { BLOW_ID, MAKING_ID, RELEASE_ID, specs } from '../specs';

type TexEntry = { kind: string; url?: string };
const manifestTextures = (): Record<string, TexEntry> => {
  const p = resolve(__dirname, '../../../../../public/assets/manifest/textures.json');
  const j = JSON.parse(readFileSync(p, 'utf8')) as { textures?: Record<string, TexEntry> } & Record<string, TexEntry>;
  return j.textures ?? j;
};

describe('specs', () => {
  it('has one making / release / blow spec per look (ids are sk.gen.ep_*)', () => {
    const ids = new Set(specs.map((s) => s.id));
    for (const l of EP_LOOKS) {
      expect(ids.has(MAKING_ID(l))).toBe(true);
      expect(ids.has(RELEASE_ID(l))).toBe(true);
      expect(ids.has(BLOW_ID(l))).toBe(true);
    }
    expect(specs.length).toBe(EP_LOOKS.length * 3);
    for (const s of specs) expect(s.id.startsWith('sk.gen.ep_')).toBe(true);
  });

  it('stays inside the curve-LUT budget (spec/README: 8192 rows shared by every effect)', () => {
    let rows = 0;
    for (const s of specs) for (const el of s.elements) rows += elementRows(el);
    expect(rows).toBeLessThanOrEqual(360); // round 3: the charge sphere has 8 layers per look
  });

  it('draws only shipped sprites, and every id of art.ts ships', () => {
    const tex = manifestTextures();
    const used = new Set<string>();
    for (const s of specs) {
      for (const el of s.elements) {
        if (typeof el.tex === 'object') for (const id of Array.isArray(el.tex.art) ? el.tex.art : [el.tex.art]) used.add(id as string);
      }
    }
    for (const id of used) expect(ENEMY_PROJECTILE_ART_IDS).toContain(id);
    for (const id of ENEMY_PROJECTILE_ART_IDS) expect(tex[id]?.kind, id).toBe('vfx');
  });

  it('each look signs its blow with a different sprite or palette (not one blob recoloured)', () => {
    const blow = (l: (typeof EP_LOOKS)[number]): string =>
      (specs.find((s) => s.id === BLOW_ID(l))?.elements ?? []).map((e) => JSON.stringify((e as { tex: unknown }).tex)).join('|');
    const sigs = new Set(EP_LOOKS.map(blow));
    expect(sigs.size).toBeGreaterThanOrEqual(5);
  });

  it('keeps every additive element under an HDR ceiling (no white-out stacking)', () => {
    for (const s of specs) {
      for (const el of s.elements) if (el.blend === 'add') expect(el.clamp ?? 99, s.id).toBeLessThanOrEqual(1.2);
    }
  });
});

describe('look mapping', () => {
  it('maps projectile style colours of simFeed to the element look', () => {
    expect(lookOfColor('#ff7a1a')).toBe(LOOK.fire);
    expect(lookOfColor('#7fdcff')).toBe(LOOK.ice);
    expect(lookOfColor('#a24bff')).toBe(LOOK.dark);
    expect(lookOfColor('#7bff52')).toBe(LOOK.poison);
    expect(lookOfColor('#bff6e0')).toBe(LOOK.wind);
    expect(lookOfColor('#fff2c4')).toBe(LOOK.physical);
  });

  it('every hostile projectile name of the content resolves to the right shape + look through simFeed.styleFromName', () => {
    const names = new Set<string>();
    for (const d of [...enemies, ...bosses] as Array<{ attacks?: Array<{ projectile?: { vfx: string } }>; patterns?: Array<{ kind: string; vfx?: string }> }>) {
      for (const a of d.attacks ?? []) if (a.projectile) names.add(a.projectile.vfx);
      for (const p of d.patterns ?? []) if ((p.kind === 'volley' || p.kind === 'ring') && p.vfx) names.add(p.vfx);
    }
    expect(names.size).toBeGreaterThan(8);
    for (const n of names) {
      const st = styleFromName(n, false);
      expect(epLookOf(lookOfColor(st.color)), n).toBe(epLookOfName(n));
      // arrows are arrows, crescents are crescents, mob magic is an orb
      if (n.startsWith('proj.arrow.')) expect(st.shape, n).toBe('arrow');
      else if (n.startsWith('proj.blade.')) expect(st.shape, n).toBe('blade');
      else expect(st.shape, n).toBe('orb');
    }
  });

  it('no content projectile is the old recoloured crescent / yellow shock wave', () => {
    const all = JSON.stringify([enemies, bosses]);
    expect(all).not.toContain('"vfx":"shock.wave.');
    expect(all).not.toContain('"vfx":"boss.volley"');
  });
});

describe('route', () => {
  function harness() {
    const fired: Array<{ id: string; o: SpawnOpts }> = [];
    const ctx = {
      time: 0,
      density: 1,
      players: new Float32Array(12),
      heightAt: () => 0,
      resolve: (id: string) => ({ def: { id } }) as unknown as Resolved,
      o: (x: number, z: number, scale: number, dirX?: number, dirZ?: number): SpawnOpts => ({ x, z, scale, dirX, dirZ }),
      fire: (id: string, o: SpawnOpts) => {
        fired.push({ id, o: { ...o } });
        return 1;
      },
    } as unknown as RouteCtx;
    const [r] = enemyProjectileRoutes();
    clearProjEvents();
    return { fired, ctx, r: r as NonNullable<typeof r> };
  }
  const typeOf = (id: string): number => (enemies as Array<{ id: string }>).findIndex((e) => e.id === id);

  it('the ranged table follows world.typeDefs = [...enemies, ...bosses]', () => {
    const t = buildRangedTable(enemies as never, bosses as never);
    expect(t.length).toBe(enemies.length + bosses.length);
    expect(t[typeOf('orc_sorcerer')]?.look).toBe('fire');
    expect(t[typeOf('silver_vow_archer')]?.look).toBe('physical');
    expect(t[typeOf('blighted_archer')]?.look).toBe('poison');
    expect(t[typeOf('wild_dog')]).toBeUndefined();
  });

  it('a ranged attack starts the MAKING charge of its element at the enemy, not a muzzle', () => {
    const h = harness();
    h.r.handle({ t: 'enemyAttack', enemy: 1, type: typeOf('frost_wisp'), kind: 1, x: 4, z: 5, dirX: 1, dirZ: 0 } as never, h.ctx);
    expect(h.fired.map((f) => f.id)).toEqual([MAKING_ID('ice')]);
    expect(h.fired[0]?.o.x).toBe(4);
  });

  it('other attack kinds are untouched; an unknown ranged type keeps the legacy muzzle', () => {
    const h = harness();
    h.r.handle({ t: 'enemyAttack', enemy: 1, type: 0, kind: 0, x: 0, z: 0, dirX: 1, dirZ: 0 } as never, h.ctx);
    h.r.handle({ t: 'enemyAttack', enemy: 1, type: 9999, kind: 1, x: 0, z: 0, dirX: 1, dirZ: 0 } as never, h.ctx);
    expect(h.fired.map((f) => f.id)).toEqual(['enemy.muzzle']);
  });

  it('queued launches / blows from the renderer become RELEASE / BLOW effects, budgeted per frame', () => {
    const h = harness();
    for (let i = 0; i < 8; i++) pushProjEvent(ProjEventKind.Launch, LOOK.fire, 0, 2, 1, 2, 1, 0, 0.35, 9, false);
    pushProjEvent(ProjEventKind.Blow, LOOK.ice, 0, 1, 1, 1, 1, 0, 0.35, 9, true);
    pushProjEvent(ProjEventKind.Blow, LOOK.dark, 0, 100, 1, 100, 1, 0, 0.35, 9, false); // far from every player: dropped
    h.r.update?.(1 / 60, h.ctx);
    const ids = h.fired.map((f) => f.id);
    expect(ids.filter((i) => i === RELEASE_ID('fire')).length).toBe(3);
    expect(ids).toContain(BLOW_ID('ice'));
    expect(ids).not.toContain(BLOW_ID('dark'));
    const rel = h.fired.find((f) => f.id === RELEASE_ID('fire'));
    expect(rel?.o.y).toBe(1);
    expect(rel?.o.dirX).toBe(1);
    h.r.update?.(1 / 60, h.ctx);
    expect(h.fired.length).toBe(ids.length); // drained
  });

  it('a fizzle is smaller than a hit', () => {
    const h = harness();
    pushProjEvent(ProjEventKind.Blow, LOOK.fire, 0, 1, 1, 1, 1, 0, 0.35, 9, true);
    pushProjEvent(ProjEventKind.Blow, LOOK.fire, 0, 1, 1, 1, 1, 0, 0.35, 9, false);
    h.r.update?.(1 / 60, h.ctx);
    const [hit, fizzle] = h.fired;
    expect((fizzle?.o.scale as number) < (hit?.o.scale as number)).toBe(true);
  });

  it('a volley of simultaneous hits is thinned by the token bucket (no stack of 20 additive blows), and recovers', () => {
    const h = harness();
    for (let f = 0; f < 6; f++) {
      for (let i = 0; i < 4; i++) pushProjEvent(ProjEventKind.Blow, LOOK.fire, 0, 1, 1, 1, 1, 0, 0.35, 9, true);
      h.r.update?.(1 / 60, h.ctx);
    }
    const blows = h.fired.filter((f) => f.id === BLOW_ID('fire'));
    expect(blows.length).toBeGreaterThanOrEqual(4);
    expect(blows.length).toBeLessThanOrEqual(6); // bucket of 5 + under one token of refill over 0.1 s
    expect(blows.some((b) => (b.o.scale as number) < 1)).toBe(true); // the tail of the burst plays smaller
    const before = h.fired.length;
    h.r.update?.(2, h.ctx); // 2 s later the bucket is full again
    pushProjEvent(ProjEventKind.Blow, LOOK.fire, 0, 1, 1, 1, 1, 0, 0.35, 9, true);
    h.r.update?.(1 / 60, h.ctx);
    expect(h.fired.length).toBe(before + 1);
    expect(h.fired[before]?.o.scale).toBeGreaterThanOrEqual(1);
  });
});

describe('files', () => {
  it('the shipped sprites of art.ts exist on disk (manifest -> webp)', () => {
    const tex = manifestTextures();
    for (const id of ENEMY_PROJECTILE_ART_IDS) {
      const url = tex[id]?.url;
      if (url) expect(existsSync(resolve(__dirname, '../../../../../public', url.replace(/^\//, ''))), id).toBe(true);
    }
  });
});
