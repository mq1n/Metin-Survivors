// Boss target guards (round 1 rebuild): the look table pinned to the content, the ids / sprites the presets draw, the tracked aura and
// charge-trail routes, and the rules of the rebuild (no marbled crack stamp, no full-screen tint, no hard cylinder).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { DataArrayTexture } from 'three';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import bosses from '../../../../data/content/bosses.json';
import { elementOfRaces } from '../../../../sim/combat';
import type { SimEvent } from '../../../../sim/events';
import { PRESETS } from '../../../presets';
import type { Resolved } from '../../../presets';
import type { SpawnOpts } from '../../../types';
import type { RouteCtx } from '../../route';
import { BOSS_ART, BOSS_RING_ART, BOSS_ART_IDS } from '../art';
import { BOSS_LOOK, EL, bossPal, elementPalette } from '../look';
import { presets } from '../presets';
import { AURA_EVERY, CHARGE_SPEED, TRAIL_EVERY, bossRoutes } from '../route';
import { specs } from '../specs';
import { Ctx, Fx } from '../../../emit';
import { Inst } from '../../../system';
import { DebrisBatch, ParticleBatch, RibbonBatch, ShapeBatch, P_STRIDE, S_STRIDE, type SharedUniforms } from '../../../batches';
import { VFX_PROFILES } from '../../../quality';
import { packArtRole } from '../../../spec/art';

const ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));

const IDS = [
  'boss.spawn',
  'boss.spawn.final',
  'boss.phase',
  'boss.enrage',
  'boss.enrage.burst',
  'boss.death',
  'boss.death.final',
  'boss.slam',
  'boss.nova',
  'boss.volley',
  'boss.teleport.out',
  'boss.teleport.in',
  'boss.summon',
  'boss.charge.trail',
];

interface BossRow {
  id: string;
  race: string[];
  radius: number;
}

describe('boss look table', () => {
  const defs = bosses as unknown as BossRow[];
  it('covers every boss of the content with the sim element and radius', () => {
    const bad: string[] = [];
    for (const b of defs) {
      const l = BOSS_LOOK[b.id];
      if (l === undefined) bad.push(`${b.id}: missing`);
      else if (l.el !== elementOfRaces(b.race as never)) bad.push(`${b.id}: element ${l.el} != ${elementOfRaces(b.race as never)}`);
      else if (Math.abs(l.r - b.radius) > 1e-6) bad.push(`${b.id}: radius ${l.r} != ${b.radius}`);
    }
    expect(bad).toEqual([]);
    expect(Object.keys(BOSS_LOOK).length).toBe(defs.length);
  });

  it('gives every element its own hue and a dark smoke tone under the glow', () => {
    const mains = new Set<number>();
    for (const el of [EL.physical, EL.fire, EL.ice, EL.dark, EL.poison]) {
      const p = elementPalette(el);
      mains.add(p.main);
      expect(((p.smoke >> 16) & 255) + ((p.smoke >> 8) & 255) + (p.smoke & 255)).toBeLessThan(180);
    }
    expect(mains.size).toBe(5);
  });

  it('bossPal writes the element palette into the spawn (physical / none = the default element)', () => {
    const c = new Ctx();
    c.element = EL.ice;
    expect(bossPal(c).main).toBe(elementPalette(EL.ice).main);
    c.element = -1;
    expect(bossPal(c, EL.dark).main).toBe(elementPalette(EL.dark).main);
    c.element = 0;
    expect(bossPal(c).main).toBe(elementPalette(EL.physical).main);
  });
});

describe('boss presets', () => {
  it('keeps every id of the contract, once, registered', () => {
    expect(presets.map((p) => p.id)).toEqual(IDS.slice().sort((a, b) => IDS.indexOf(a) - IDS.indexOf(b)));
    for (const id of IDS) expect(PRESETS.filter((p) => p.id === id).length).toBe(1);
  });

  it('is rebuilt without the marbled crack stamp, the hard cylinder or a full-screen tint', () => {
    const src = readFileSync(join(ROOT, 'src/vfx/common/boss/presets.ts'), 'utf8') + readFileSync(join(ROOT, 'src/vfx/common/boss/blocks.ts'), 'utf8');
    expect(src).not.toMatch(/PAT\.cracks/);
    expect(src).not.toMatch(/\.cyl\(/);
    expect(src).not.toMatch(/fx\.flash\(/);
    expect(src).not.toMatch(/\btint\(/);
  });

  it('loops are the two tracked ones (aura, charge trail)', () => {
    expect(presets.filter((p) => p.loop).map((p) => p.id)).toEqual(['boss.enrage', 'boss.charge.trail']);
  });
});

describe('boss art', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'public/assets/manifest/textures.json'), 'utf8')) as { textures?: Record<string, { kind?: string }> } & Record<string, { kind?: string }>;
  const tex = manifest.textures ?? manifest;

  it('every sprite id is in the manifest as a vfx sprite and its file ships', () => {
    const files = readdirSync(join(ROOT, 'public/assets/textures/vfx'));
    for (const id of BOSS_ART_IDS) {
      expect(tex[id]?.kind, id).toBe('vfx');
      expect(files.some((f) => f.startsWith(`${id}.`)), id).toBe(true);
    }
  });

  it('the carrier specs reference every sprite and hold at most 16 elements each', () => {
    const seen = new Set<string>();
    for (const s of specs) {
      expect(s.elements.length).toBeLessThanOrEqual(16);
      for (const e of s.elements) if (e.kind === 'particle' && typeof e.tex === 'object' && typeof e.tex.art === 'string') seen.add(e.tex.art);
    }
    expect([...seen].sort()).toEqual([...BOSS_ART_IDS].sort());
  });

  it('ring sprites carry a sane peak radius', () => {
    for (const r of Object.values(BOSS_RING_ART)) expect(r.pk).toBeGreaterThan(0.15);
    expect(BOSS_ART.puffMottled.id).toMatch(/^vfx_/);
    expect(existsSync(join(ROOT, 'public/assets/manifest/textures.json'))).toBe(true);
  });
});

interface Fired {
  id: string;
  o: SpawnOpts;
}

function harness(bossAt: { x: number; z: number; vx: number; vz: number } | null) {
  const fired: Fired[] = [];
  let time = 0;
  let next = 1;
  const ctx: RouteCtx = {
    get time() {
      return time;
    },
    density: 1,
    players: new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    heightAt: () => 0,
    resolve: (id) => ({ def: { id }, palette: null, element: -1, variant: -1 }) as unknown as Resolved,
    o: (x, z, scale, dirX, dirZ) => ({ x, z, scale, dirX, dirZ }),
    fire: (id, o) => {
      fired.push({ id, o: { ...o } });
      return next++;
    },
    spawnResolved: () => 0,
    stop: () => undefined,
    alive: () => true,
    once: () => true,
    since: () => Infinity,
    mark: () => undefined,
    deathPreset: () => undefined,
    metinRune: () => 0,
    bossPos: (_x, _z, out) => {
      if (bossAt === null) return false;
      out.x = bossAt.x;
      out.z = bossAt.z;
      out.y = 0;
      return true;
    },
    telegraphEvents: false,
  };
  const routes = bossRoutes();
  const send = (e: Partial<SimEvent> & { t: SimEvent['t'] }): void => {
    for (const r of routes) if (r.events.includes(e.t)) r.handle(e as SimEvent, ctx);
  };
  const tick = (dt: number): void => {
    time += dt;
    if (bossAt !== null) {
      bossAt.x += bossAt.vx * dt;
      bossAt.z += bossAt.vz * dt;
    }
    for (const r of routes) r.update?.(dt, ctx);
  };
  return { fired, send, tick };
}

describe('boss routes', () => {
  it('plays spawn / death with the element and size of the boss id', () => {
    const h = harness(null);
    h.send({ t: 'bossSpawn', boss: 1, enemy: 1, bossId: 'boss_ice_golem', x: 4, z: 5, final: false });
    expect(h.fired.at(-1)?.id).toBe('boss.spawn');
    expect(h.fired.at(-1)?.o).toMatchObject({ x: 4, z: 5, element: EL.ice });
    h.send({ t: 'bossDeath', boss: 1, bossId: 'boss_ice_golem', x: 6, z: 7, final: true });
    expect(h.fired.at(-1)?.id).toBe('boss.death.final');
    expect(h.fired.at(-1)?.o).toMatchObject({ x: 6, z: 7, element: EL.ice });
  });

  it('an enraged boss carries the aura: a short loop at the live position every AURA_EVERY s, until it dies', () => {
    const boss = { x: 10, z: 0, vx: 2, vz: 0 };
    const h = harness(boss);
    h.send({ t: 'bossSpawn', boss: 1, enemy: 1, bossId: 'boss_pyre_king', x: 10, z: 0, final: false });
    for (let i = 0; i < 30; i++) h.tick(1 / 60);
    expect(h.fired.filter((f) => f.id === 'boss.enrage').length).toBe(0);
    h.send({ t: 'bossPhase', boss: 1, bossId: 'boss_pyre_king', phase: 1, hpFrac: 0.4, enrage: true });
    expect(h.fired.at(-1)?.id).toBe('boss.enrage.burst');
    const n0 = h.fired.length;
    for (let i = 0; i < 180; i++) h.tick(1 / 60);
    const auras = h.fired.slice(n0).filter((f) => f.id === 'boss.enrage');
    expect(auras.length).toBeGreaterThanOrEqual(Math.floor(3 / AURA_EVERY) - 1);
    expect(auras.length).toBeLessThanOrEqual(Math.ceil(3 / AURA_EVERY) + 1);
    // the aura follows the boss (2 m/s for 3 s)
    expect((auras.at(-1)?.o.x as number) - (auras[0]?.o.x as number)).toBeGreaterThan(3);
    expect(auras[0]?.o.duration).toBeGreaterThan(AURA_EVERY);
    h.send({ t: 'bossDeath', boss: 1, bossId: 'boss_pyre_king', x: 16, z: 0, final: false });
    const n1 = h.fired.length;
    for (let i = 0; i < 120; i++) h.tick(1 / 60);
    expect(h.fired.slice(n1).filter((f) => f.id === 'boss.enrage').length).toBe(0);
  });

  it('a charging boss leaves a trail along its heading, a walking one does not', () => {
    const walk = harness({ x: 0, z: 0, vx: 4, vz: 0 });
    walk.send({ t: 'bossSpawn', boss: 1, enemy: 1, bossId: 'boss_ung_jae', x: 0, z: 0, final: false });
    for (let i = 0; i < 120; i++) walk.tick(1 / 60);
    expect(walk.fired.filter((f) => f.id === 'boss.charge.trail').length).toBe(0);
    const run = harness({ x: 0, z: 0, vx: CHARGE_SPEED + 8, vz: 0 });
    run.send({ t: 'bossSpawn', boss: 1, enemy: 1, bossId: 'boss_ung_jae', x: 0, z: 0, final: false });
    for (let i = 0; i < 60; i++) run.tick(1 / 60);
    const trail = run.fired.filter((f) => f.id === 'boss.charge.trail');
    expect(trail.length).toBeGreaterThanOrEqual(Math.floor(1 / TRAIL_EVERY) - 2);
    expect(trail[0]?.o.dirX).toBeGreaterThan(0.9);
    expect(trail[0]?.o.a).toBeGreaterThan(CHARGE_SPEED);
  });

  it('finds a boss by itself when no event registered one (a VFX reset dropped the trackers)', () => {
    const run = harness({ x: 0, z: 0, vx: 18, vz: 0 });
    for (let i = 0; i < 90; i++) run.tick(1 / 60);
    expect(run.fired.some((f) => f.id === 'boss.charge.trail')).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------------------------------ render budget

function uniforms(): SharedUniforms {
  return { uTime: { value: 0 }, uAtlas: { value: null }, uNoise: { value: null }, uDepth: { value: null }, uInvRes: { value: { x: 1, y: 1 } }, uNearFar: { value: { x: 0.1, y: 100 } }, uSoft: { value: 0 } } as unknown as SharedUniforms;
}

/** an Fx over real batches with every boss sprite "packed" (so the presets draw their generated art, not the procedural fallbacks) */
function rig() {
  const u = uniforms();
  const pAdd = new ParticleBatch(4096, 'add', u);
  const pAlp = new ParticleBatch(4096, 'alpha', u);
  const sAdd = new ShapeBatch(64, 'add', u);
  const sAlp = new ShapeBatch(64, 'alpha', u);
  const fx = new Fx(VFX_PROFILES.high, pAdd, pAlp, sAdd, sAlp, new RibbonBatch(16, u), new DebrisBatch(64, u));
  fx.budget = 100_000;
  fx.time = 5;
  const roles = new Map<string, { packed: number; frames: number }>();
  const ids = [...BOSS_ART_IDS, 'vfx_smoke_lumpball_a', 'vfx_smoke_dustclump_a', 'vfx_smoke_dustpuff_a', 'vfx_rock_chunk_facet_a', 'vfx_ring_arcs_select_a', 'vfx_rayring_ground_burst_a', 'vfx_curtain_shafts_a', 'vfx_glint_halo_pin_a'];
  ids.forEach((id, i) => roles.set(id, { packed: packArtRole({ layer: 0, col: i % 8, row: Math.floor(i / 8) }, { id, cw: 1, ch: id === BOSS_ART.column.id ? 2 : 1, frames: 1, cols: 1, rows: 1 }), frames: 1 }));
  fx.spec = { art: { role: (k: string) => roles.get(k) ?? null }, uniforms: { uSpecArt: { value: new DataArrayTexture(new Uint8Array(4), 1, 1, 1) }, uArtGrid: { value: 8 } } } as never;
  return { fx, pAdd, pAlp, sAdd, sAlp, roles };
}
/** live particles of a batch: [cell, birth, life] */
function parts(b: ParticleBatch): { cell: number; birth: number; life: number; mode: number; x: number; y: number; z: number; size: number }[] {
  const out: { cell: number; birth: number; life: number; mode: number; x: number; y: number; z: number; size: number }[] = [];
  for (let i = 0; i < b.cap; i++) {
    const o = i * P_STRIDE;
    const life = b.f[o + 7] as number;
    if (life > 0 && (b.f[o + 3] as number) > -1e5) out.push({ cell: b.f[o + 17] as number, birth: b.f[o + 3] as number, life, mode: (b.f[o + 18] as number) & 3, x: b.f[o] as number, y: b.f[o + 1] as number, z: b.f[o + 2] as number, size: b.f[o + 8] as number });
  }
  return out;
}
function shapeCount(b: ShapeBatch): number {
  let n = 0;
  for (let i = 0; i < b.cap; i++) if ((b.f[i * S_STRIDE + 3] as number) > -1e5) n++;
  return n;
}
const byId = (id: string) => {
  const p = presets.find((d) => d.id === id);
  if (!p) throw new Error(`missing preset ${id}`);
  return p;
};
function fire(id: string, scale: number, radius: number, element = 0, duration = 0.5) {
  const r = rig();
  const c = new Ctx();
  c.x = 3;
  c.z = -2;
  c.scale = scale;
  c.radius = radius;
  c.element = element;
  c.duration = duration;
  byId(id).fire(r.fx, c);
  return r;
}

describe('boss set pieces (render budget)', () => {
  const role = (r: ReturnType<typeof rig>, id: string) => r.roles.get(id)?.packed as number;
  const all = (r: ReturnType<typeof rig>) => [...parts(r.pAlp), ...parts(r.pAdd)];

  it('spawn / death throw UPRIGHT smoke volumes in the element hue: puffs rise well above the body, nothing but a faint floor memory lies flat', () => {
    for (const [id, final] of [['boss.spawn', false], ['boss.spawn.final', true], ['boss.death', false], ['boss.death.final', true]] as const) {
      const r = fire(id, 1.2, final ? 9 : 6, 0);
      const ps = all(r);
      // the smoke bodies: screen-facing puffs (mode 0) in the alpha batch, at least 40
      const body = parts(r.pAlp).filter((p) => p.mode === 0);
      expect(body.length, id).toBeGreaterThanOrEqual(40);
      // the streamers (the generated column sprite) are upright
      const cols = ps.filter((p) => p.cell === role(r, BOSS_ART.column.id));
      if (id.startsWith('boss.spawn')) {
        expect(cols.length, id).toBeGreaterThanOrEqual(6);
        for (const c of cols) expect(c.mode, id).toBe(3);
      }
    }
  });

  it('no flat ground event stamp is shared: no ground flare sprite outside the enrage burst', () => {
    const flareRole = (r: ReturnType<typeof rig>) => r.roles.get('vfx_rayring_ground_burst_a')?.packed as number;
    for (const id of ['boss.spawn', 'boss.spawn.final', 'boss.phase', 'boss.slam', 'boss.nova', 'boss.death', 'boss.death.final', 'boss.summon', 'boss.teleport.in']) {
      const r = fire(id, 1.2, 5.5, 0);
      expect(all(r).filter((p) => p.cell === flareRole(r)).length, id).toBe(0);
    }
  });

  it('the nova is a haze wall: upright cards all round the ring, sweeping out', () => {
    const r = fire('boss.nova', 1, 8, 2, 0.5);
    const cards = all(r).filter((p) => p.mode === 3);
    expect(cards.length).toBeGreaterThanOrEqual(24);
  });

  it('the ground memory is the generated scar (ground mode), thin and short, never the procedural crack network', () => {
    for (const id of ['boss.spawn', 'boss.death', 'boss.slam', 'boss.enrage.burst']) {
      const r = fire(id, 1.2, 5.5, 0);
      const cr = all(r).filter((p) => p.cell === role(r, BOSS_ART.crack.id));
      expect(cr.length, id).toBeGreaterThanOrEqual(2);
      for (const c of cr) expect(c.mode, id).toBe(2);
      for (const c of cr) expect(c.life, id).toBeLessThanOrEqual(2.5);
    }
  });

  it('ice chips are three kinds of shard at several sizes, each with an additive twin, thrown over the whole disc (not one ring of identical gems)', () => {
    const r = fire('boss.death.final', 1.2, 9, 2);
    const gem = r.roles.get(BOSS_ART.iceGem.id)?.packed as number;
    const crown = r.roles.get(BOSS_ART.iceCrown.id)?.packed as number;
    const facet = r.roles.get('vfx_rock_chunk_facet_a')?.packed as number;
    const alp = parts(r.pAlp);
    const add = parts(r.pAdd);
    for (const cell of [gem, crown, facet]) {
      const a = alp.filter((p) => p.cell === cell).length;
      expect(a, `kind ${cell}`).toBeGreaterThanOrEqual(2);
      // every chip is drawn twice: an alpha body and its additive twin (the crown is also drawn by the ice accents, which have twins too)
      expect(add.filter((p) => p.cell === cell).length, `twin ${cell}`).toBeGreaterThanOrEqual(a);
    }
    // sizes and lifetimes differ: not one gem repeated
    const sizes = new Set(alp.filter((p) => p.cell === gem).map((p) => Math.round(p.size * 20)));
    expect(sizes.size).toBeGreaterThanOrEqual(3);
  });

  it('slam, nova, enrage burst, phase: a star-burst (a ground ray ring + a screen-facing flare core), both over in <= 0.4 s', () => {
    const cases = [
      ['boss.slam', BOSS_RING_ART.rayHazy, BOSS_ART.flareDense],
      ['boss.nova', BOSS_RING_ART.rayHazy, BOSS_ART.flareSpokes],
      ['boss.enrage.burst', BOSS_RING_ART.rayStreak, BOSS_ART.flareDense],
      ['boss.phase', BOSS_RING_ART.rayStreak, BOSS_ART.flareDense],
    ] as const;
    for (const [id, ring, flare] of cases) {
      for (const el of [0, 2, 4]) {
        const r = fire(id, 1.2, 6, el, 0.5);
        const rings = parts(r.pAdd).filter((p) => p.cell === role(r, ring.id));
        expect(rings.length, `${id} ${el} ring`).toBeGreaterThanOrEqual(1);
        for (const q of rings) {
          expect(q.mode, id).toBe(2);
          expect(q.life, id).toBeLessThanOrEqual(0.4);
        }
        const fl = parts(r.pAdd).filter((p) => p.cell === role(r, flare.id));
        expect(fl.length, `${id} ${el} flare`).toBeGreaterThanOrEqual(1);
        for (const q of fl) {
          expect(q.mode, id).toBe(0);
          expect(q.life, id).toBeLessThanOrEqual(0.4);
        }
      }
    }
  });

  it('the enrage burst is no flame field: no flame sprite on an ice / dark / plain boss, at most four tongues (alpha + twin) on a fire boss', () => {
    for (const el of [0, 2, 4, 5]) {
      const r = fire('boss.enrage.burst', 1.2, 6.5, el);
      expect(all(r).filter((p) => p.cell === role(r, BOSS_ART.flameAura.id)).length, `el ${el}`).toBe(0);
    }
    const f = fire('boss.enrage.burst', 1.2, 6.5, 1);
    expect(all(f).filter((p) => p.cell === role(f, BOSS_ART.flameAura.id)).length).toBeLessThanOrEqual(8);
  });

  it('the enrage aura is swirl smoke hugging the body, in the element hue: no flames on ice, upright twisting columns, born within a body radius of the body and carried with it', () => {
    const run = (el: number, speed: number, seconds: number) => {
      const r = rig();
      const c = new Inst();
      c.x = 3;
      c.z = -2;
      c.scale = 1.2;
      c.radius = 3.6;
      c.element = el;
      c.duration = 0;
      c.a = speed;
      c.dx = 1;
      c.dz = 0;
      const d = byId('boss.enrage');
      d.fire(r.fx, c);
      for (let t = 0; t < seconds; t += 1 / 60) {
        c.age += 1 / 60;
        d.tick?.(r.fx, c, 1 / 60);
      }
      return { r, c };
    };
    const ice = run(2, 0, 2);
    expect(all(ice.r).filter((p) => p.cell === role(ice.r, BOSS_ART.flameAura.id)).length).toBe(0);
    const cols = all(ice.r).filter((p) => p.cell === role(ice.r, BOSS_ART.tpColumn.id));
    expect(cols.length).toBeGreaterThanOrEqual(6);
    for (const q of cols) expect(q.mode).toBe(3);
    // the body radius of scale 1.2 is 2.16 m: every column is born round it, none a boss-width away
    const bR = 1.8 * 1.2;
    for (const q of cols) expect(Math.hypot(q.x - 3, q.z + 2)).toBeLessThanOrEqual(bR * 1.15 + 0.01);
    // a walking body: the births move with it (2.2 m/s for 3 s of loop age = 6.6 m)
    const walk = run(2, 2.2, 3);
    const xs = all(walk.r).filter((p) => p.cell === role(walk.r, BOSS_ART.tpColumn.id)).map((p) => p.x);
    expect(Math.max(...xs)).toBeGreaterThan(3 + 2.2 * 2);
    // the fire boss alone also burns a little
    const fire1 = run(1, 0, 2);
    expect(all(fire1.r).filter((p) => p.cell === role(fire1.r, BOSS_ART.flameAura.id)).length).toBeGreaterThan(0);
  });

  it('no hard + / x glints anywhere (the kit glints draw crosses): motes and soft frost stars instead', () => {
    const src = readFileSync(join(ROOT, 'src/vfx/common/boss/presets.ts'), 'utf8') + readFileSync(join(ROOT, 'src/vfx/common/boss/blocks.ts'), 'utf8');
    expect(src).not.toMatch(/glints\(/);
    expect(src).not.toMatch(/SPR\.cross/);
  });

  it('the ice floor memory is the pale frost fissure, not the charred crack', () => {
    const r = fire('boss.slam', 1, 5, 2);
    const frost = r.roles.get(BOSS_ART.frostCrack.id)?.packed as number;
    const char = r.roles.get(BOSS_ART.crack.id)?.packed as number;
    expect(all(r).filter((p) => p.cell === frost).length).toBeGreaterThanOrEqual(3);
    expect(all(r).filter((p) => p.cell === char).length).toBe(0);
  });

  it('the slam pit lives: it is drawn as particles (a soft pit + dust puffs thrown off its lip), not the frozen crater decal', () => {
    const src = readFileSync(join(ROOT, 'src/vfx/common/boss/presets.ts'), 'utf8');
    expect(src).not.toMatch(/crater\(/);
    const r = fire('boss.slam', 1, 5, 0);
    expect(parts(r.pAlp).filter((p) => p.mode === 0 && p.life > 0.5 && p.life < 1).length).toBeGreaterThanOrEqual(8);
  });

  it('summon draws no emblem sprites (no circled-glyph medallions): smoke plumes and broken arcs', () => {
    const r = fire('boss.summon', 1, 5, 4, 0.8);
    const src = readFileSync(join(ROOT, 'src/vfx/common/boss/presets.ts'), 'utf8');
    expect(src).not.toMatch(/runeMotes|sealLine|sealScroll|BOSS_RING_ART\.seal/);
    expect(all(r).length).toBeGreaterThan(60);
  });

  it('every set piece stays within a particle budget and draws no ring shapes (soft sprites only)', () => {
    const cap: Record<string, number> = { 'boss.spawn': 420, 'boss.spawn.final': 560, 'boss.phase': 300, 'boss.enrage.burst': 420, 'boss.death': 460, 'boss.death.final': 620, 'boss.slam': 300, 'boss.nova': 420, 'boss.teleport.in': 320, 'boss.teleport.out': 200, 'boss.summon': 420 };
    for (const [id, max] of Object.entries(cap)) {
      const r = fire(id, 1.2, byId(id).size === 'radius' ? 6 : 6.5, 0);
      const n = parts(r.pAlp).length + parts(r.pAdd).length;
      expect(n, id).toBeGreaterThan(30);
      expect(n, id).toBeLessThanOrEqual(max);
      expect(shapeCount(r.sAdd) + shapeCount(r.sAlp) <= 8, `${id} shapes`).toBe(true);
    }
  });
});
