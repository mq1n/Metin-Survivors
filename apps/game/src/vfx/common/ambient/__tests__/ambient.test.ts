// ambient target (r1 + r2 look guards): art registry + carrier, charge / leap particle budgets and "no ring / no star" rules, loop pre-fill, foot-dust spec rules, per-zone dust tint.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DataArrayTexture, PerspectiveCamera, Vector3 } from 'three';
import { DebrisBatch, ParticleBatch, RibbonBatch, ShapeBatch, P_STRIDE, S_STRIDE, type SharedUniforms } from '../../../batches';
import { Ctx, Fx } from '../../../emit';
import { VFX_PROFILES } from '../../../quality';
import { PRESETS } from '../../../presets';
import type { Inst } from '../../../system';
import { FootDustFeed } from '../../../skills/common/dustFeed';
import { ART_ROLE_BASE, artRect, packArtRole } from '../../../spec/art';
import { AMBIENT_CARRIER_PREFIX, ambientCarrierId, artKey, runSpecIds } from '../../../spec/artScope';
import type { ParticleSpec } from '../../../spec/types';
import { SPR } from '../../../textures';
import { AMBIENT_ART, AMBIENT_ART_IDS, AMBIENT_ART_SPECS, AMBIENT_CARRIED_IDS, AMBIENT_ELSEWHERE_IDS, AMBIENT_PRESET_ART, AMBIENT_SHEET, sheetSpr } from '../art';
import { KIT_ART_IDS } from '../../kitArt';
import { presets } from '../presets';
import { DUST_AUTHORED, DUST_DEFAULT, dustPair, setDustZone, ZONE_DUST_TINT } from '../dustTint';
import { specs } from '../specs';

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

/** `sheets`: art ids packed as their real 2x2 sheet (4 frames), so the four cells of the sheet are told apart in the batch; every other id is a single-frame role */
function rig(withArt: boolean, asked?: Set<string>, tier: 'low' | 'medium' | 'high' = 'high', sheets: readonly string[] = []) {
  const u = uniforms();
  const pAdd = new ParticleBatch(2048, 'add', u);
  const pAlp = new ParticleBatch(2048, 'alpha', u);
  const sAdd = new ShapeBatch(64, 'add', u);
  const sAlp = new ShapeBatch(64, 'alpha', u);
  const fx = new Fx(VFX_PROFILES[tier], pAdd, pAlp, sAdd, sAlp, new RibbonBatch(16, u), new DebrisBatch(64, u));
  fx.budget = 100_000;
  fx.time = 5;
  if (withArt) {
    const roles = new Map<string, { packed: number; frames: number }>();
    AMBIENT_ART_IDS.forEach((id, i) => {
      const four = sheets.includes(id);
      roles.set(id, { packed: packArtRole({ layer: 1, col: i % 8, row: Math.floor(i / 8) }, { id, cw: 1, ch: 1, frames: four ? 4 : 1, cols: four ? 2 : 1, rows: four ? 2 : 1 }), frames: four ? 4 : 1 });
    });
    // the kit sprites shared with the ambient set (rock / glint) are already in the id list above
    const uArt = { value: new DataArrayTexture(new Uint8Array(4), 1, 1, 1) };
    const uGrid = { value: 8 };
    fx.spec = { art: { role: (k: string) => (asked?.add(k), roles.get(k) ?? null) }, uniforms: { uSpecArt: uArt, uArtGrid: uGrid } } as never;
  }
  return { fx, pAdd, pAlp, sAdd, sAlp };
}

function live(b: ParticleBatch): number {
  let n = 0;
  for (let i = 0; i < b.cap; i++) if ((b.f[i * P_STRIDE + 7] as number) > 0 && (b.f[i * P_STRIDE + 3] as number) > -1e5) n++;
  return n;
}
function cells(b: ParticleBatch): number[] {
  const out: number[] = [];
  for (let i = 0; i < b.cap; i++) if ((b.f[i * P_STRIDE + 7] as number) > 0 && (b.f[i * P_STRIDE + 3] as number) > -1e5) out.push(b.f[i * P_STRIDE + 17] as number);
  return out;
}
function modes(b: ParticleBatch): number[] {
  const out: number[] = [];
  for (let i = 0; i < b.cap; i++) if ((b.f[i * P_STRIDE + 7] as number) > 0 && (b.f[i * P_STRIDE + 3] as number) > -1e5) out.push((b.f[i * P_STRIDE + 18] as number) & 3);
  return out;
}
function shapes(b: ShapeBatch): number {
  let n = 0;
  for (let i = 0; i < b.cap; i++) if ((b.f[i * S_STRIDE + 3] as number) > -1e5) n++;
  return n;
}
const preset = (id: string) => {
  const p = PRESETS.find((d) => d.id === id);
  if (!p) throw new Error(`missing preset ${id}`);
  return p;
};

describe('ambient art registry', () => {
  it('lists unique manifest ids that ship as kind vfx textures, each with a procedural fallback cell', () => {
    expect(new Set(AMBIENT_ART_IDS).size).toBe(AMBIENT_ART_IDS.length);
    const manifest = JSON.parse(readFileSync(new URL('../../../../../public/assets/manifest/textures.json', import.meta.url), 'utf8')) as { textures?: Record<string, { kind?: string }> } | Record<string, { kind?: string }>;
    const tex = ((manifest as { textures?: Record<string, { kind?: string }> }).textures ?? manifest) as Record<string, { kind?: string }>;
    expect(AMBIENT_ART_IDS.filter((id) => tex[id]?.kind !== 'vfx')).toEqual([]);
    for (const a of Object.values(AMBIENT_ART)) expect(a.fb).toBeLessThan(ART_ROLE_BASE);
  });

  const keysOf = (s: { elements: readonly { kind: string; tex?: unknown }[] }): string[] => s.elements.map((e) => (e.kind === 'particle' && typeof e.tex === 'object' ? artKey((e.tex as { art: string }).art) : ''));

  it('is carried by one common spec per loop, sk.gen.ambient_art.<name> (<= 16 elements) + the kit carrier + the dust specs: every id is in a gallery scope, nothing else is carried', () => {
    expect(AMBIENT_ART_SPECS.map((s) => s.id)).toEqual(Object.keys(AMBIENT_PRESET_ART).map((n) => AMBIENT_CARRIER_PREFIX + n));
    const carried = new Set<string>();
    for (const sp of AMBIENT_ART_SPECS) {
      expect(sp.elements.length, sp.id).toBeLessThanOrEqual(16);
      expect(sp.elements.length, sp.id).toBeGreaterThan(0);
      for (const k of keysOf(sp)) carried.add(k);
    }
    expect([...carried].sort()).toEqual([...AMBIENT_CARRIED_IDS].sort());
    expect([...AMBIENT_CARRIED_IDS, ...AMBIENT_ELSEWHERE_IDS].sort()).toEqual([...AMBIENT_ART_IDS].sort());
    // what the carriers leave out is either a kit sprite or one of the two dust specs' own art
    const dustArt = new Set(specs.filter((s) => s.id === 'sk.gen.dust' || s.id === 'sk.gen.running_dust').flatMap((s) => keysOf(s)));
    for (const id of AMBIENT_ELSEWHERE_IDS) expect(KIT_ART_IDS.includes(id) || dustArt.has(id), id).toBe(true);
    for (const sp of AMBIENT_ART_SPECS) expect(specs.includes(sp), sp.id).toBe(true);
    expect(specs.some((s) => s.id === 'sk.gen.ambient_art')).toBe(false);
  });

  it('a loop carrier lists exactly the sprites of ITS loop (ids carried elsewhere left out), one carrier per ambient preset', () => {
    expect(Object.keys(AMBIENT_PRESET_ART).sort()).toEqual(presets.filter((p) => p.id.startsWith('ambient.')).map((p) => p.id.slice('ambient.'.length)).sort());
    for (const [name, art] of Object.entries(AMBIENT_PRESET_ART)) {
      const sp = AMBIENT_ART_SPECS.find((s) => s.id === ambientCarrierId(`ambient.${name}`));
      expect(sp, name).toBeDefined();
      expect(keysOf(sp as never).sort(), name).toEqual(art.map((a) => a.id).filter((id) => !AMBIENT_ELSEWHERE_IDS.includes(id)).sort());
    }
  });

  it('a run carries the loop of its zone only: one carrier for a zone with a loop, none for a zone without, all of them without a zone (galleries, tools)', () => {
    const ids = ['sk.gen.dust', ...AMBIENT_ART_SPECS.map((s) => s.id), 'hit.fire'];
    const mine = (z?: { ambient: string } | null): string[] => runSpecIds([], [{ classId: 'warrior', doctrine: 'a' }], ids, z);
    expect(mine()).toEqual(ids);
    expect(mine(null)).toEqual(ids);
    expect(mine({ ambient: 'ambient.embers' })).toEqual(['sk.gen.dust', 'sk.gen.ambient_art.embers', 'hit.fire']);
    expect(mine({ ambient: 'ambient.snow' })).toEqual(['sk.gen.dust', 'sk.gen.ambient_art.snow', 'hit.fire']);
    // the biome names its loop by the alias (zones.json `particles: "embers"`), spawn() resolves it to the preset: both spellings pick the same carrier
    expect(mine({ ambient: 'embers' })).toEqual(mine({ ambient: 'ambient.embers' }));
    expect(ambientCarrierId('leaves')).toBe('sk.gen.ambient_art.leaves');
    expect(ambientCarrierId('')).toBe('');
    expect(mine({ ambient: '' })).toEqual(['sk.gen.dust', 'hit.fire']);
    // a zone loop without a carrier (an unknown preset) carries none either, and no loadout list (the unknown run) is pruned the same way
    expect(mine({ ambient: 'ambient.nothing' })).toEqual(['sk.gen.dust', 'hit.fire']);
    expect(mine({ ambient: 'nothing' })).toEqual(['sk.gen.dust', 'hit.fire']);
    expect(runSpecIds([], [], ids, { ambient: 'ambient.leaves' })).toEqual(['sk.gen.dust', 'sk.gen.ambient_art.leaves', 'hit.fire']);
  });
});

describe('ambient sheets (2x2: leaf, snow, ash, dust body, cinder)', () => {
  it('every sheet id is an AMBIENT_ART sprite and its first declaring element (carrier spec or the dust specs) declares the 2x2 grid the packer cuts it by', () => {
    for (const id of Object.keys(AMBIENT_SHEET)) {
      expect(AMBIENT_ART_IDS).toContain(id);
      const el = specs.flatMap((sp) => sp.elements).find((e) => e.kind === 'particle' && typeof e.tex === 'object' && artKey(e.tex.art) === id);
      expect(el && el.kind === 'particle' && typeof el.tex === 'object' ? el.tex.grid : null).toEqual([2, 2]);
    }
  });

  it('sheetSpr returns the cell of frame k with the frame count cleared (the GLSL artRect decode), and the procedural cell without art', () => {
    const a = AMBIENT_ART.leafSheet;
    // a 4-frame sheet packed at layer 1, column 6, row 2 of an 8 x 8 layer: frames 0..3 run 6, 7, then wrap to column 0, 1 of the next row
    const pk = packArtRole({ layer: 1, col: 6, row: 2 }, { id: a.id, cw: 1, ch: 1, frames: 4, cols: 2, rows: 2 });
    const fx = { artCell: () => pk, spec: { art: { grid: 8 } } } as never;
    for (let k = 0; k < 4; k++) {
      const one = sheetSpr(fx, a, k);
      const want = artRect(pk, k, 8);
      const got = artRect(one, 0, 8);
      expect(got.frames).toBe(1);
      expect([got.u0, got.v0, got.du, got.dv, got.layer]).toEqual([want.u0, want.v0, want.du, want.dv, want.layer]);
    }
    expect(sheetSpr(fx, a, 9)).toBe(sheetSpr(fx, a, 3));
    expect(sheetSpr({ artCell: () => SPR.leaf0, spec: null } as never, a, 2, SPR.petal)).toBe(SPR.petal);
  });
});

describe('enemy.charge / enemy.leap', () => {
  for (const withArt of [true, false]) {
    for (const id of ['enemy.charge', 'enemy.leap']) {
      it(`${id} (${withArt ? 'art packed' : 'procedural fallback'}): <= 36 particles, no ring / glyph shapes, no flat star or chevron cells`, () => {
        const { fx, pAdd, pAlp, sAdd, sAlp } = rig(withArt);
        const c = new Ctx();
        c.x = 3;
        c.z = -2;
        c.y = 0;
        c.dx = 1;
        c.dz = 0;
        c.rot = Math.PI / 2;
        c.scale = 1;
        preset(id).fire(fx, c);
        expect(live(pAdd) + live(pAlp)).toBeGreaterThan(8);
        expect(live(pAdd) + live(pAlp)).toBeLessThanOrEqual(36);
        expect(shapes(sAdd) + shapes(sAlp)).toBe(0);
        const all = [...cells(pAdd), ...cells(pAlp)];
        for (const bad of [SPR.chevron, SPR.ringThin, SPR.ringThick, SPR.ringDash, SPR.glowRing]) expect(all.includes(bad)).toBe(false);
        // r2: ONE filled dust body, no speed lines (streak mode), no flat ground smear / disc, every particle is the dust body sprite (or its procedural fallback), nothing additive
        expect([...modes(pAdd), ...modes(pAlp)].every((m) => m === 0)).toBe(true);
        expect(live(pAdd)).toBe(0);
        if (withArt) expect(cells(pAlp).every((c) => c >= ART_ROLE_BASE)).toBe(true);
        else expect(cells(pAlp).every((c) => c === SPR.smoke2)).toBe(true);
      });
    }
  }

  it('are one filled dust body: a puff of >= 1.4 m (>= 1.2 m visible) is born at the feet (2 for the leap bloom), so the middle is filled from the first frame', () => {
    for (const id of ['enemy.charge', 'enemy.leap']) {
      const { fx, pAlp } = rig(true);
      const c = new Ctx();
      c.x = 0;
      c.z = 0;
      c.y = 0;
      c.dx = 1;
      c.dz = 0;
      c.scale = 1;
      preset(id).fire(fx, c);
      let big = 0;
      let nearFeet = 0;
      for (let i = 0; i < pAlp.cap; i++) {
        if (!((pAlp.f[i * P_STRIDE + 7] as number) > 0)) continue;
        const size = pAlp.f[i * P_STRIDE + 9] as number;
        big = Math.max(big, size);
        if (Math.hypot(pAlp.f[i * P_STRIDE] as number, pAlp.f[i * P_STRIDE + 2] as number) < 0.35 && size >= 1.4) nearFeet++;
      }
      expect(big).toBeGreaterThanOrEqual(1.4);
      expect(nearFeet).toBeGreaterThanOrEqual(id === 'enemy.leap' ? 2 : 1);
    }
  });

  it('are dust presets of the warn family without ring helpers (ids are the contract)', () => {
    // AMB-01 appended ambient.leaves_autumn + ambient.motes, AMB-02 ambient.smoke after the six r3 loops (the old ids and their order stay)
    expect(presets.map((p) => p.id)).toEqual(['enemy.charge', 'enemy.leap', 'ambient.leaves', 'ambient.dust', 'ambient.snow', 'ambient.embers', 'ambient.ash', 'ambient.sparks', 'ambient.leaves_autumn', 'ambient.motes', 'ambient.smoke']);
  });
});

describe('ambient.* loops', () => {
  const inst = (): Inst => {
    const c = new Ctx() as unknown as Inst;
    c.radius = 26;
    c.intensity = 1;
    c.acc0 = 0;
    c.acc1 = 0;
    c.acc2 = 0;
    c.acc3 = 0;
    c.host = null as never;
    return c;
  };
  const expected: Record<string, [number, number]> = {
    // AMB-01: leaves / petals / motes sized for the gameplay camera: the r3 loop held 110 (73 leaves of 0.9-1.4 m + 37 motes); the leaves are now ~104 quads of 0.25-0.5 m (about a third of the old edge length, 1/9 of the area)
    // and the motes their own ~68 pips. Measured at the game camera (vfxmetrics coverage, plaza, high): the old loop changed 1.7 % of the frame, leaves + motes now 0.3 %
    'ambient.leaves': [75, 125],
    'ambient.leaves_autumn': [75, 125],
    'ambient.motes': [45, 90],
    'ambient.dust': [80, 200],
    // AMB-02: the snow is ~400-650 small flakes in three depth layers, no halos (x0.75 / x0.5 on medium / low, the low tier thins itself further), the smoke ~65 big wisps
    'ambient.snow': [400, 700],
    'ambient.embers': [120, 320],
    'ambient.ash': [150, 420],
    'ambient.sparks': [14, 130],
    'ambient.smoke': [40, 100],
  };
  for (const [id, [lo, hi]] of Object.entries(expected)) {
    it(`${id} pre-fills ${lo}..${hi} particles, none of them star / snowflake-icon / plus-blob cells`, () => {
      const { fx, pAdd, pAlp } = rig(true);
      preset(id).fire(fx, inst());
      const n = live(pAdd) + live(pAlp);
      expect(n).toBeGreaterThanOrEqual(lo);
      expect(n).toBeLessThanOrEqual(hi);
      const all = [...cells(pAdd), ...cells(pAlp)];
      for (const bad of [SPR.snow0, SPR.snow1, SPR.ember0, SPR.ember1, SPR.disc, SPR.dust0, SPR.dust1]) expect(all.includes(bad)).toBe(false);
    });
  }

  for (const id of ['ambient.dust', 'ambient.snow']) {
    it(`${id}: no streak bundles and no flat ground sprites (r2: straight lines, stains on the floor)`, () => {
      const { fx, pAdd, pAlp } = rig(true);
      preset(id).fire(fx, inst());
      expect([...modes(pAdd), ...modes(pAlp)].filter((m) => m === 1 || m === 2)).toEqual([]);
    });
  }

  for (const [name, art] of Object.entries(AMBIENT_PRESET_ART)) {
    it(`ambient.${name} asks the art array for exactly the sprites its carrier lists (a run in its zone finds them packed, no other loop's art is needed)`, () => {
      const asked = new Set<string>();
      const { fx } = rig(true, asked);
      const c = inst();
      const p = preset(`ambient.${name}`);
      p.fire(fx, c);
      for (let i = 0; i < 900; i++) {
        fx.time += 1 / 30;
        p.tick?.(fx, c, 1 / 30);
      }
      expect([...asked].sort(), name).toEqual(art.map((a) => a.id).sort());
    });
  }

  it('the emitter box is capped so the visible ground holds the particles (+-20 m)', () => {
    const { fx, pAlp } = rig(true);
    const c = inst();
    c.x = 0;
    c.z = 0;
    preset('ambient.snow').fire(fx, c);
    let max = 0;
    for (let i = 0; i < pAlp.cap; i++) if ((pAlp.f[i * P_STRIDE + 7] as number) > 0 && (pAlp.f[i * P_STRIDE + 3] as number) > -1e5) max = Math.max(max, Math.abs(pAlp.f[i * P_STRIDE + 2] as number));
    // start z = spawn z - vz * age: wind drift stays within a few metres of the 20 m box
    expect(max).toBeLessThan(40);
  });
});

describe('AMB-01 / AMB-02 ambient loops sized for the gameplay camera (55 deg, zoom 22: 1 m ~ 67 px)', () => {
  const inst = (): Inst => {
    const c = new Ctx() as unknown as Inst;
    c.radius = 26;
    c.intensity = 1;
    c.acc0 = 0;
    c.acc1 = 0;
    c.acc2 = 0;
    c.acc3 = 0;
    c.host = null as never;
    return c;
  };
  interface Pt {
    x: number;
    y: number;
    z: number;
    size0: number;
    size1: number;
    spin: number;
    wob: number;
    alpha: number;
    rgb: [number, number, number];
    /** linear colour gain */
    int: number;
    /** velocity (m/s) */
    vx: number;
    vy: number;
    vz: number;
    /** orientation mode (0 screen-facing, 1 streak, 2 ground, 3 upright) */
    mode: number;
  }
  /** the live particles of a batch with their position at `time` (p0 + v t, floored like the vertex shader) */
  function pts(b: ParticleBatch, time: number): Pt[] {
    const out: Pt[] = [];
    for (let i = 0; i < b.cap; i++) {
      const o = i * P_STRIDE;
      if (!((b.f[o + 7] as number) > 0 && (b.f[o + 3] as number) > -1e5 && (b.endT[i] as number) > time)) continue;
      const t = time - (b.f[o + 3] as number);
      const c = b.c[i * 2] as number;
      const floorY = b.f[o + 16] as number;
      out.push({
        x: (b.f[o] as number) + (b.f[o + 4] as number) * t,
        y: Math.max((b.f[o + 1] as number) + (b.f[o + 5] as number) * t, floorY > -999 ? floorY : -1e9),
        z: (b.f[o + 2] as number) + (b.f[o + 6] as number) * t,
        size0: b.f[o + 8] as number,
        size1: b.f[o + 9] as number,
        spin: b.f[o + 11] as number,
        wob: b.f[o + 19] as number,
        alpha: (c >>> 24) / 255,
        rgb: [c & 255, (c >> 8) & 255, (c >> 16) & 255],
        int: b.f[o + 15] as number,
        vx: b.f[o + 4] as number,
        vy: b.f[o + 5] as number,
        vz: b.f[o + 6] as number,
        mode: (b.f[o + 18] as number) & 3,
      });
    }
    return out;
  }
  /** the game camera: FOV 40, pitch 55, 22 m from the focus (0, 0, 0), 16:9 */
  const cam = new PerspectiveCamera(40, 16 / 9, 0.5, 320);
  cam.position.set(0, Math.sin((55 * Math.PI) / 180) * 22, Math.cos((55 * Math.PI) / 180) * 22);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  const v = new Vector3();
  const onScreen = (p: Pt): boolean => {
    v.set(p.x, p.y, p.z).project(cam);
    return Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && v.z < 1;
  };
  function loop(id: string, tier: 'low' | 'medium' | 'high', seed = 0) {
    const { fx, pAdd, pAlp } = rig(true, undefined, tier);
    if (seed > 0) fx.rng.seed(seed);
    preset(id).fire(fx, inst());
    return { add: pts(pAdd, fx.time), alp: pts(pAlp, fx.time), nAdd: live(pAdd), nAlp: live(pAlp), cellsAlp: cells(pAlp), cellsAdd: cells(pAdd), modesAlp: modes(pAlp) };
  }

  /** on-screen counts of one batch over six seeds: [mean, max] (a single fill varies by +-30 % around the mean) */
  function visible(id: string, tier: 'low' | 'medium' | 'high', kind: 'add' | 'alp'): [number, number] {
    const n = [1, 2, 3, 4, 5, 6].map((seed) => loop(id, tier, seed)[kind].filter(onScreen).length);
    return [n.reduce((a, b) => a + b, 0) / n.length, Math.max(...n)];
  }

  for (const id of ['ambient.leaves', 'ambient.leaves_autumn']) {
    it(`${id}: every quad is 0.2-0.5 m (the r3 leaves were 0.9-1.8 m paper cut-outs), alpha-blended painted leaves only, a lazy tumble (<= 0.7 rad/s) and a small flutter`, () => {
      for (const tier of ['high', 'medium', 'low'] as const) {
        const l = loop(id, tier);
        expect(l.nAdd, `${id} ${tier} additive`).toBe(0);
        expect(l.alp.length, `${id} ${tier}`).toBeGreaterThan(20);
        for (const p of l.alp) {
          expect(Math.max(p.size0, p.size1), id).toBeLessThanOrEqual(0.5);
          expect(Math.min(p.size0, p.size1), id).toBeGreaterThanOrEqual(0.2);
          expect(Math.abs(p.spin), id).toBeLessThanOrEqual(0.7);
          expect(p.wob, id).toBeLessThanOrEqual(0.4 + 1e-6);
        }
        // the painted sheet only (cells packed in the art array), no procedural fallback while the sheet is packed
        expect(l.cellsAlp.every((c) => c >= ART_ROLE_BASE)).toBe(true);
      }
    });

    it(`${id}: a leaf fall is thin on screen: <= 60 visible at medium (x0.75), <= 30 at the low proxy (x0.5); the near layer (the fainter ones) only above low`, () => {
      const [medMean, medMax] = visible(id, 'medium', 'alp');
      const [lowMean, lowMax] = visible(id, 'low', 'alp');
      const [highMean] = visible(id, 'high', 'alp');
      expect(medMean).toBeGreaterThan(20);
      expect(medMax).toBeLessThanOrEqual(60);
      expect(lowMean).toBeGreaterThan(8);
      expect(lowMax).toBeLessThanOrEqual(30);
      expect(highMean).toBeGreaterThan(medMean);
      // the odd near leaf passes at about half the alpha; the low tier has none (and every leaf of it is solid)
      expect(loop(id, 'high').alp.some((p) => p.alpha < 0.6)).toBe(true);
      expect(loop(id, 'low').alp.every((p) => p.alpha >= 0.8)).toBe(true);
    });
  }

  it('ambient.leaves is spring: yellow-green / green leaves and a good share of cream / pink / white petals (red and blue channels high), no russet', () => {
    const a = loop('ambient.leaves', 'high').alp;
    const petals = a.filter((p) => p.rgb[0] > 0xe8 && p.rgb[2] > 0xa0);
    const leaves = a.filter((p) => !petals.includes(p));
    expect(petals.length / a.length).toBeGreaterThan(0.25);
    expect(petals.length / a.length).toBeLessThan(0.55);
    for (const p of leaves) {
      expect(p.rgb[1], 'green >= red').toBeGreaterThanOrEqual(p.rgb[0]);
      expect(p.rgb[1], 'green > blue').toBeGreaterThan(p.rgb[2]);
    }
    // petals are the smaller quads
    expect(Math.max(...petals.map((p) => p.size0))).toBeLessThanOrEqual(0.42 + 1e-6);
  });

  it("ambient.leaves_autumn is Suryeon's fall: russet #a8461e, amber #e08a2a, ochre and deep brown only (red >= green > blue, no green, no petals)", () => {
    const a = loop('ambient.leaves_autumn', 'high').alp;
    const seen = new Set<number>();
    for (const p of a) {
      expect(p.rgb[0], 'red >= green').toBeGreaterThanOrEqual(p.rgb[1]);
      expect(p.rgb[1], 'green > blue').toBeGreaterThan(p.rgb[2]);
      seen.add(((p.rgb[0] << 16) | (p.rgb[1] << 8) | p.rgb[2]) >>> 0);
    }
    expect([...seen].sort()).toEqual([0xa8461e, 0xe08a2a, 0xc99a2e, 0x7a4a2a].sort());
  });

  it('ambient.motes: 0.06-0.12 m warm additive soft pips (#ffe6b0), the pip sprite only, <= 40 on screen at full density, none alpha-blended', () => {
    for (const tier of ['high', 'medium', 'low'] as const) {
      const m = loop('ambient.motes', tier);
      expect(m.nAlp, `${tier} alpha`).toBe(0);
      expect(m.add.length).toBeGreaterThan(20);
      for (const p of m.add) {
        expect(Math.max(p.size0, p.size1)).toBeLessThanOrEqual(0.12 + 1e-6);
        expect(Math.min(p.size0, p.size1)).toBeGreaterThanOrEqual(0.03);
        expect(p.rgb).toEqual([0xff, 0xe6, 0xb0]);
      }
      expect(m.cellsAdd.every((c) => c >= ART_ROLE_BASE)).toBe(true);
    }
    expect(visible('ambient.motes', 'high', 'add')[1]).toBeLessThanOrEqual(40);
    expect(visible('ambient.motes', 'high', 'add')[0]).toBeGreaterThan(18);
    expect(visible('ambient.motes', 'low', 'add')[1]).toBeLessThanOrEqual(30);
  });

  it('density scales every loop (stochastic rounding): the low proxy (x0.5) holds about half of the full-density fill', () => {
    for (const id of ['ambient.leaves', 'ambient.leaves_autumn', 'ambient.motes']) {
      const n = (t: 'low' | 'high'): number => {
        const l = loop(id, t);
        return l.nAdd + l.nAlp;
      };
      // the leaves also lose their near layer on low (12 %), so the ratio sits a little under 0.5
      expect(n('low') / n('high'), id).toBeGreaterThan(0.35);
      expect(n('low') / n('high'), id).toBeLessThan(0.58);
    }
  });

  it('a live tick keeps the loops populated (no drain, no leak past the pre-fill) and never emits a streak / flat mode', () => {
    for (const id of ['ambient.leaves', 'ambient.leaves_autumn', 'ambient.motes']) {
      const { fx, pAdd, pAlp } = rig(true);
      const c = inst();
      const p = preset(id);
      p.fire(fx, c);
      const alive = (): number => pts(pAdd, fx.time).length + pts(pAlp, fx.time).length;
      const before = alive();
      for (let i = 0; i < 300; i++) {
        fx.time += 1 / 30;
        p.tick?.(fx, c, 1 / 30);
      }
      const after = alive();
      expect(after, id).toBeGreaterThan(before * 0.7);
      expect(after, id).toBeLessThan(before * 1.3);
      expect([...modes(pAdd), ...modes(pAlp)].filter((m) => m === 1 || m === 2)).toEqual([]);
    }
  });
  // ------------------------------------------------------------------------------------------------ AMB-02
  describe('AMB-02 snow flakes, warm-grey ash and smoke wisps (snow flakes 0.12-0.55 m visible, no halo, ash tint #5a504a at half size, smoke 2-4 m wisps)', () => {
    const SNOW = 'ambient.snow';
    const ASH = 'ambient.ash';
    const SMOKE = 'ambient.smoke';
    const luma = (p: Pt): number => 0.2126 * p.rgb[0] + 0.7152 * p.rgb[1] + 0.0722 * p.rgb[2];
    /** the blue-grey of the r5 halo that read as a grey ring around each flake: it must never come back */
    const isHalo = (p: Pt): boolean => p.rgb[0] === 0x7f && p.rgb[1] === 0x93 && p.rgb[2] === 0xbd;

    it('ambient.snow: every flake is 0.12-0.55 m VISIBLE (quad 0.27-0.9 m = flake / the sheet cell fill 0.45-0.7; the r3 quads were 0.4-2.3 m cotton balls), alpha-blended painted soft flakes only, NO halo under them (it read as a grey ring), no veil', () => {
      for (const tier of ['high', 'medium', 'low'] as const) {
        const l = loop(SNOW, tier);
        expect(l.nAdd, `${tier} additive`).toBe(0);
        expect(l.alp.length, tier).toBeGreaterThan(20);
        expect(l.alp.filter(isHalo).length, `${tier} halo`).toBe(0);
        for (const p of l.alp) {
          expect(Math.max(p.size0, p.size1) * 0.45, 'visible flake <= 0.55 m').toBeLessThanOrEqual(0.55 + 1e-6);
          expect(Math.min(p.size0, p.size1) * 0.7, 'visible flake >= 0.12 m').toBeGreaterThanOrEqual(0.12 - 1e-6);
          expect(Math.max(p.size0, p.size1), 'under half of the r3 quads').toBeLessThanOrEqual(0.4 / 0.45 + 1e-6);
          expect(p.size0).toBe(p.size1);
          // cool (blue >= green >= red), never darker than a pale cool white (the far specks #dbe5f8); most are white
          expect(Math.min(...p.rgb), tier).toBeGreaterThanOrEqual(0xdb);
          expect(p.rgb[2]).toBeGreaterThanOrEqual(p.rgb[1]);
          expect(p.rgb[1]).toBeGreaterThanOrEqual(p.rgb[0]);
        }
        // the painted sheet on medium and high; the low tier draws the plain procedural soft dot (the 96 px art drew the sheet's flakes as rimmed bubbles)
        if (tier === 'low') expect(l.cellsAlp.every((c) => c === SPR.glow), 'low plain soft dot').toBe(true);
        else expect(l.cellsAlp.every((c) => c >= ART_ROLE_BASE), `${tier} painted sheet`).toBe(true);
      }
    });

    it('ambient.snow depth layers: far specks (0.12-0.18 m visible, fainter), a bulk of soft white flakes (0.20-0.40 m), a FEW faint 0.40-0.55 m out-of-focus flakes high above the floor (<= 14 %, alpha <= 0.45) so a telegraph under them stays readable; the low tier has neither far specks nor near flakes', () => {
      const h = loop(SNOW, 'high').alp;
      const near = h.filter((p) => p.alpha <= 0.46);
      const far = h.filter((p) => p.alpha > 0.46 && p.alpha < 0.86);
      const mid = h.filter((p) => p.alpha >= 0.86);
      expect(far.length / h.length).toBeGreaterThan(0.14);
      expect(far.length / h.length, 'the far specks are a depth layer, not the weather (r9: 22 %, the mid flakes carry the fall)').toBeLessThan(0.3);
      expect(mid.length / h.length).toBeGreaterThan(0.5);
      // medium: no far specks (invisible on the bright floor), the mid flakes carry the fall
      const m = loop(SNOW, 'medium').alp;
      expect(m.filter((p) => p.alpha > 0.46 && p.alpha < 0.86).length, 'no far specks on medium').toBe(0);
      expect(m.filter((p) => p.alpha >= 0.86).length / m.length).toBeGreaterThan(0.8);
      expect(near.length / h.length).toBeGreaterThan(0.01);
      expect(near.length / h.length).toBeLessThanOrEqual(0.14);
      for (const p of far) expect(p.size0 * 0.45).toBeLessThanOrEqual(0.18 + 1e-6);
      for (const p of mid) expect(p.size0 * 0.7).toBeGreaterThanOrEqual(0.2 - 1e-6);
      for (const p of mid) expect(p.size0 * 0.45).toBeLessThanOrEqual(0.4 + 1e-6);
      for (const p of near) {
        expect(p.size0 * 0.7).toBeGreaterThanOrEqual(0.4 - 1e-6);
        expect(p.size0 * 0.7).toBeLessThanOrEqual(0.55 + 1e-6);
        expect(p.y, 'near flakes pass high above the floor, between the camera and the hero').toBeGreaterThan(2.5);
      }
      const lw = loop(SNOW, 'low').alp;
      // (the low tier draws a plain dot: quad = flake / 0.75)
      expect(lw.every((p) => p.size0 * 0.75 >= 0.2 - 1e-6 && p.alpha >= 0.88 - 1 / 255)).toBe(true);
    });

    it('ambient.snow flakes are brighter than the blue-grey snow floor (~#c8d0dc, lit patches up to luma ~215): the bulk (mid layer) is white #f8fbff with a sixth a touch cooler #e6edf9 (the r7 #c9d6ee was as bright as the lit floor and showed as blue-grey discs on dark roofs), the far layer cool white', () => {
      const a = loop(SNOW, 'high').alp;
      const bright = a.filter((p) => luma(p) >= 0xdc);
      expect(bright.length, 'every flake is clearly brighter than the lit floor').toBe(a.length);
      const mid = a.filter((p) => p.alpha >= 0.86);
      expect(mid.filter((p) => p.rgb[0] === 0xf8 && p.rgb[1] === 0xfb && p.rgb[2] === 0xff).length / mid.length).toBeGreaterThan(0.7);
      expect(mid.some((p) => p.rgb[0] === 0xe6 && p.rgb[1] === 0xed && p.rgb[2] === 0xf9)).toBe(true);
      expect(mid.some((p) => p.rgb[0] === 0xc9), 'the r7 shaded tint is gone').toBe(false);
    });

    it('ambient.snow on the low tier (phones) draws a plain procedural soft dot, never a sheet cell: the 96 px art drew the sheet flakes as a white-rimmed grey disc and the 0.3-0.4 m loose-fluff cell 3 as a ringed bubble with satellite dots (r2 critic); medium and high mix the sheet cells (0 crisp, 3 loose fluff, 1 the faint near flakes)', () => {
      const run = (tier: 'low' | 'medium' | 'high', seed: number) => {
        const { fx, pAlp } = rig(true, undefined, tier, [AMBIENT_ART.snowSoft.id]);
        fx.rng.seed(seed);
        preset(SNOW).fire(fx, inst());
        return new Set(cells(pAlp));
      };
      for (const seed of [1, 2, 3, 4, 5, 6]) expect([...run('low', seed)], `low seed ${seed}`).toEqual([SPR.glow]);
      expect(run('medium', 1).size).toBe(3);
      expect(run('high', 1).size).toBe(3);
      for (const t of ['medium', 'high'] as const) expect(run(t, 1).has(SPR.glow), `${t} sheet cells only`).toBe(false);
    });

    it('ambient.snow is a light fall: <= 30 visible at the low proxy (x0.5 density, six seeds), clearly more at medium, more again at high', () => {
      const [hMean] = visible(SNOW, 'high', 'alp');
      const [mMean] = visible(SNOW, 'medium', 'alp');
      const [lMean, lMax] = visible(SNOW, 'low', 'alp');
      expect(lMax).toBeLessThanOrEqual(30);
      expect(lMean).toBeGreaterThan(14);
      expect(mMean).toBeGreaterThan(lMean * 1.8);
      expect(hMean).toBeGreaterThan(mMean * 1.15);
    });

    it('ambient.snow falls slowly (0.45-1.3 m/s), leans with the gust (the wind speed varies from place to place) and sways on a small flutter (<= 0.2 m, no tumble)', () => {
      const a = loop(SNOW, 'high').alp;
      for (const p of a) {
        expect(p.vy).toBeLessThan(-0.44);
        expect(p.vy).toBeGreaterThan(-1.31);
        expect(p.wob).toBeGreaterThan(0);
        expect(p.wob).toBeLessThanOrEqual(0.2 + 1e-6);
        expect(p.spin).toBe(0);
      }
      const vx = a.map((p) => p.vx);
      expect(Math.max(...vx) / Math.min(...vx)).toBeGreaterThan(2.5);
    });

    it('ambient.ash: half size and warm-grey TINTS - flakes 0.3-0.48 m, grit 0.17-0.31 m, glowing cinders 0.08-0.15 m; tints #5a504a / #4a423c / #6e635b only (r >= g >= b, no pale paper in the data; the gain lifts them to a mid warm grey on screen)', () => {
      for (const tier of ['high', 'medium', 'low'] as const) {
        const l = loop(ASH, tier);
        expect(l.alp.length, tier).toBeGreaterThan(30);
        for (const p of l.alp) {
          const s = Math.max(p.size0, p.size1);
          expect(s, `ash quad ${s}`).toBeLessThanOrEqual(0.48 + 1e-6);
          expect(s).toBeGreaterThanOrEqual(0.17 - 1e-6);
          expect(p.rgb[0]).toBeGreaterThanOrEqual(p.rgb[1]);
          expect(p.rgb[1]).toBeGreaterThanOrEqual(p.rgb[2]);
          expect(Math.max(...p.rgb), 'no pale flakes').toBeLessThanOrEqual(0x6e);
          expect(luma(p)).toBeLessThanOrEqual(0x68);
        }
        const tints = new Set(l.alp.map((p) => ((p.rgb[0] << 16) | (p.rgb[1] << 8) | p.rgb[2]) >>> 0));
        for (const t of tints) expect([0x5a504a, 0x4a423c, 0x6e635b]).toContain(t);
        for (const p of l.add) expect(Math.max(p.size0, p.size1), 'cinders').toBeLessThanOrEqual(0.15 + 1e-6);
      }
    });

    it('ambient.ash is a MID warm grey on screen, not the tint own dark: tint #5a504a x gain 7 on the flakes and 5.04 on the grit (5 / 3.6 made the half-size flakes invisible on the charcoal floor, 6 / 4.3 was marginal in the blind pairs; measured top-10 % pixels ~(122-149, 96-120, 85-108)), and the loop is a few flakes (<= 340 pre-filled at high, r5 had ~330)', () => {
      const l = loop(ASH, 'high');
      expect(l.alp.length).toBeLessThanOrEqual(340);
      const flakes = l.alp.filter((p) => Math.abs(p.int - 7) < 1e-4);
      const grit = l.alp.filter((p) => Math.abs(p.int - 5.04) < 1e-4);
      expect(flakes.length + grit.length, 'every ash quad carries one of the two gains').toBe(l.alp.length);
      expect(flakes.length).toBeGreaterThan(20);
      expect(grit.length).toBeGreaterThan(20);
      for (const p of flakes) expect(Math.max(p.size0, p.size1)).toBeGreaterThanOrEqual(0.3 - 1e-6);
      for (const p of grit) expect(Math.max(p.size0, p.size1)).toBeLessThanOrEqual(0.31 + 1e-6);
    });

    it('ambient.ash: <= 30 visible at the low proxy (flakes + cinders) and clearly more at high', () => {
      const [lMean, lMax] = visible(ASH, 'low', 'alp');
      const [, lAddMax] = visible(ASH, 'low', 'add');
      expect(lMax + lAddMax).toBeLessThanOrEqual(30);
      expect(lMean).toBeGreaterThan(6);
      expect(visible(ASH, 'high', 'alp')[0]).toBeGreaterThan(lMean * 1.5);
    });

    it('ambient.smoke: 2-4 m soft wisps at alpha 0.06-0.12, alpha-blended granular veils / mottled billows only (never a streak, a flat ground sprite or an additive glow), a slow turn', () => {
      for (const tier of ['high', 'medium', 'low'] as const) {
        const l = loop(SMOKE, tier);
        expect(l.nAdd, `${tier} additive`).toBe(0);
        expect(l.alp.length, tier).toBeGreaterThan(8);
        for (const p of l.alp) {
          expect(Math.min(p.size0, p.size1)).toBeGreaterThanOrEqual(2 - 1e-6);
          expect(Math.max(p.size0, p.size1)).toBeLessThanOrEqual(4 + 1e-6);
          expect(p.size1, 'swells as it thins').toBeGreaterThanOrEqual(p.size0);
          expect(p.alpha).toBeGreaterThanOrEqual(0.06 - 1 / 255);
          expect(p.alpha).toBeLessThanOrEqual(0.12 + 1 / 255);
          expect(Math.abs(p.spin)).toBeLessThanOrEqual(0.1 + 1e-6);
          expect(p.wob).toBeLessThanOrEqual(0.15);
        }
        expect(l.cellsAlp.every((c) => c >= ART_ROLE_BASE), `${tier} painted sheets`).toBe(true);
        expect(l.modesAlp.filter((m) => m === 1 || m === 2)).toEqual([]);
      }
    });

    it('ambient.smoke: about half of the grey wisps stand as banks (upright cards, wide and low at the 55 deg camera: the round discs kept a ring outline), the rust-coloured lava-lit ones and the rest are screen-facing discs', () => {
      for (const seed of [1, 2, 3]) {
        const a = loop(SMOKE, 'high', seed).alp;
        const rust = (p: Pt): boolean => p.rgb[0] > 0x90 && p.rgb[2] < 0x60;
        const grey = a.filter((p) => !rust(p));
        const banks = grey.filter((p) => p.mode === 3);
        expect(banks.length / grey.length, `seed ${seed} bank share`).toBeGreaterThan(0.35);
        expect(banks.length / grey.length, `seed ${seed} bank share`).toBeLessThan(0.65);
        expect(a.filter(rust).length, 'there are lava-lit wisps').toBeGreaterThan(0);
        expect(a.filter((p) => rust(p) && p.mode !== 0).length, 'the lava-lit wisps are screen-facing discs').toBe(0);
        expect(a.filter((p) => p.mode === 1 || p.mode === 2).length, 'never a streak or a ground sprite').toBe(0);
      }
    });

    it('ambient.smoke rises ~0.3 m/s, is driven along the wind by the gust (the speed varies with the gust wave) and clears the floor: no disc dips under the ground (centre >= 0.57 x half its size), a bank stands on its base above it', () => {
      const a = loop(SMOKE, 'high').alp;
      const vy = a.map((p) => p.vy);
      expect(Math.min(...vy)).toBeGreaterThanOrEqual(0.17);
      expect(Math.max(...vy)).toBeLessThanOrEqual(0.4);
      const mean = vy.reduce((s, v) => s + v, 0) / vy.length;
      expect(mean).toBeGreaterThan(0.22);
      expect(mean).toBeLessThan(0.36);
      const vx = a.map((p) => p.vx);
      expect(Math.max(...vx) / Math.min(...vx)).toBeGreaterThan(2);
      for (const p of a) {
        if (p.mode === 3) expect(p.y, 'a bank stands on its base').toBeGreaterThanOrEqual(0.05 - 1e-6);
        else expect(p.y - 0.574 * 0.5 * Math.max(p.size0, p.size1), 'clears the floor').toBeGreaterThanOrEqual(-1e-6);
      }
    });

    it('ambient.smoke is a thin loop: <= 30 visible at the low proxy, 14-60 at high; the low tier thins it to about a quarter', () => {
      const [hMean, hMax] = visible(SMOKE, 'high', 'alp');
      const [lMean, lMax] = visible(SMOKE, 'low', 'alp');
      expect(lMax).toBeLessThanOrEqual(30);
      expect(hMean).toBeGreaterThan(14);
      expect(hMax).toBeLessThanOrEqual(60);
      expect(lMean / hMean).toBeGreaterThan(0.18);
      expect(lMean / hMean).toBeLessThan(0.5);
    });

    it('the three loops keep their population on a live tick (no drain, no leak) and never emit a streak / flat mode', () => {
      for (const id of [SNOW, ASH, SMOKE]) {
        const { fx, pAdd, pAlp } = rig(true);
        const c = inst();
        const p = preset(id);
        p.fire(fx, c);
        const alive = (): number => pts(pAdd, fx.time).length + pts(pAlp, fx.time).length;
        const before = alive();
        for (let i = 0; i < 400; i++) {
          fx.time += 1 / 30;
          p.tick?.(fx, c, 1 / 30);
        }
        const after = alive();
        expect(after, id).toBeGreaterThan(before * 0.7);
        expect(after, id).toBeLessThan(before * 1.35);
        expect([...modes(pAdd), ...modes(pAlp)].filter((m) => m === 1 || m === 2)).toEqual([]);
      }
    });

    it('density scales the three loops (stochastic rounding): the low proxy holds well under half of the full fill of snow and ash (they also thin themselves), about a quarter of the smoke', () => {
      for (const [id, lo, hi] of [[SNOW, 0.04, 0.3], [ASH, 0.1, 0.4], [SMOKE, 0.18, 0.4]] as const) {
        const n = (t: 'low' | 'high'): number => {
          const l = loop(id, t);
          return l.nAdd + l.nAlp;
        };
        expect(n('low') / n('high'), id).toBeGreaterThan(lo);
        expect(n('low') / n('high'), id).toBeLessThan(hi);
      }
    });
  });
});

describe('foot dust / horse dust specs', () => {
  const dust = specs.find((s) => s.id === 'sk.gen.dust');
  const horse = specs.find((s) => s.id === 'sk.gen.running_dust');
  const parts = (s: typeof dust) => (s?.elements.filter((e) => e.kind === 'particle') ?? []) as ParticleSpec[];

  it('exist, are tint templates and keep their ids', () => {
    expect(dust?.tint).toBe(true);
    expect(horse?.tint).toBe(true);
    expect(dust?.behavior).toBe('selfBuff');
  });

  it('screen-facing puffs sit high enough that the lower quad edge never dips under the floor (centre y >= 0.57 x half x peak scale)', () => {
    for (const s of [dust, horse]) {
      for (const e of parts(s)) {
        if (e.billboard !== 'screen' || e.blend !== 'alpha') continue;
        const half = Math.max(...(Array.isArray(e.half) && typeof e.half[0] === 'number' ? (e.half as number[]).filter((_, i) => i % 2 === 1) : [0.1]));
        const sc = Array.isArray(e.scale) && typeof e.scale[0] === 'number' ? Math.max(...(e.scale as number[]).filter((_, i) => i % 2 === 1)) : 1;
        if (half * sc < 0.3) continue; // small specks / clods: negligible
        expect((e.at?.[1] ?? 0) + 0.02).toBeGreaterThanOrEqual(0.57 * half * Math.min(sc, 1.12) * 0.9);
      }
    }
  });

  it('the foot dust swells 0.5 -> 1.2 m (visible ~0.85 of the quad width: the sprite fills its cell) and fades out (final alpha 0)', () => {
    // element 0 is the cool shadow underlay (larger by design); the lit body is element 1
    const body = parts(dust)[1] as ParticleSpec;
    const half = (body.half as number[])[1] as number;
    const sc = body.scale as number[];
    const w0 = 2 * half * (sc[1] as number) * 0.85;
    const w1 = 2 * half * (sc[sc.length - 1] as number) * 0.85;
    expect(w0).toBeGreaterThan(0.4);
    expect(w0).toBeLessThan(0.7);
    expect(w1).toBeGreaterThan(0.95);
    expect(w1).toBeLessThan(1.4);
    expect(body.color[body.color.length - 1]).toBe(0);
  });

  it('r3: the body is a VERY TRANSLUCENT granular veil (alpha-blended grain sprite, peak colour alpha 0.5-0.97, gone by 0.5 s: the r2 cotton body of alpha 0.9+ read as cauliflower billows still dense at 0.45 s)', () => {
    const peak = (e: ParticleSpec): number => Math.max(...(e.color as number[]).filter((_, i) => i % 3 === 2));
    const lifeMax = (e: ParticleSpec): number => Math.max(...(e.life as number[]).filter((_, i) => i % 2 === 1));
    for (const s of [dust, horse]) {
      const ps = parts(s);
      for (const e of ps) {
        expect(e.blend).toBe('alpha');
        expect(typeof e.tex === 'object' && 'art' in e.tex ? e.tex.art : '').toBe(AMBIENT_ART.dustGrain.id);
        expect(peak(e)).toBeLessThanOrEqual(0.97);
        expect(e.color[e.color.length - 1]).toBe(0);
      }
      // the visible body (the element with the largest peak alpha) is translucent but real
      const body = ps.reduce((a, b) => (peak(b) > peak(a) ? b : a));
      expect(peak(body)).toBeGreaterThanOrEqual(0.5);
      
      if (s === dust) for (const e of ps) expect(lifeMax(e)).toBeLessThanOrEqual(0.5);
    }
  });

  it('r3: the foot dust draws a faint cool shadow underlay (blue-grey, darker than the lit powder) under the body, so a pale puff keeps an edge on snow', () => {
    const ps = parts(dust);
    const under = ps[0] as ParticleSpec;
    const body = ps[1] as ParticleSpec;
    const key = (e: ParticleSpec): number => e.color[1] as number;
    const luma = (h: number): number => (0.2126 * ((h >> 16) & 255) + 0.7152 * ((h >> 8) & 255) + 0.0722 * (h & 255)) / 255;
    expect(luma(key(under))).toBeLessThan(luma(key(body)) - 0.25);
    expect(key(under) & 255).toBeGreaterThan((key(under) >> 16) & 255);
    // larger than the body
    expect(Math.max(...(under.half as number[]).filter((_, i) => i % 2 === 1))).toBeGreaterThan(Math.max(...(body.half as number[]).filter((_, i) => i % 2 === 1)));
  });

  it('zone tint x authored colour: a LIT white-blue powder on snow (b > g >= r, never olive), a pale yellow-green-grey on stone', () => {
    const mul = (a: number, t: number): number[] => [16, 8, 0].map((sh) => Math.round((((a >> sh) & 255) * ((t >> sh) & 255)) / 255));
    const snow = mul(DUST_AUTHORED, ZONE_DUST_TINT.seori as number);
    expect(snow[2]).toBeGreaterThan(snow[1] as number);
    expect(snow[1]).toBeGreaterThanOrEqual(snow[0] as number);
    // r3: the powder is the brightest thing on the floor (the shadow underlay gives it the edge): lit, not a grey body darker than the 0.78 floor (r2: "dark-grey soot")
    expect(0.2126 * (snow[0] as number) + 0.7152 * (snow[1] as number) + 0.0722 * (snow[2] as number)).toBeGreaterThan(0.85 * 255);
    const stone = mul(DUST_AUTHORED, ZONE_DUST_TINT.yeonmu as number);
    // pale, yellow-green-grey: green and red within a few levels, blue lower than green
    expect(Math.abs((stone[0] as number) - (stone[1] as number))).toBeLessThan(14);
    expect(stone[2]).toBeLessThan(stone[1] as number);
    expect(stone[1]).toBeGreaterThan(190);
  });
});

describe('FootDustFeed zone tint', () => {
  function run(zone: string): { color?: unknown }[] {
    const calls: { color?: unknown }[] = [];
    const world = { zone: { id: zone }, players: [{ alive: true, px: 0, pz: 0, x: 0, z: 0, dashT: 0 }] } as never;
    const vfx = { spawn: (_id: string, o: { color?: unknown }) => void calls.push({ color: o.color }) } as never;
    const feed = new FootDustFeed();
    feed.update(world, vfx, 1, () => 0);
    const p = (world as { players: { x: number; px: number }[] }).players[0] as { x: number; px: number };
    for (let i = 1; i <= 4; i++) {
      p.px = p.x;
      p.x += 1.4;
      feed.update(world, vfx, 1, () => 0);
    }
    return calls;
  }
  it('passes the floor colour per zone and nothing for an unknown zone', () => {
    const seori = run('seori');
    const yeonmu = run('yeonmu');
    const unknown = run('nowhere');
    expect(seori.length).toBeGreaterThan(0);
    expect(seori[0]?.color).not.toEqual(yeonmu[0]?.color);
    expect(unknown[0]?.color).toBeUndefined();
  });
});

describe('zone dust pair (charge / leap colours)', () => {
  const luma = (h: number): number => (0.2126 * ((h >> 16) & 255) + 0.7152 * ((h >> 8) & 255) + 0.0722 * (h & 255)) / 255;
  it('is published by FootDustFeed every frame and falls back to the stone pair for unknown zones', () => {
    const world = { zone: { id: 'seori' }, players: [] } as never;
    const vfx = { spawn: () => 0 } as never;
    new FootDustFeed().update(world, vfx, 1, () => 0);
    const snow = dustPair();
    expect(snow).not.toEqual(DUST_DEFAULT);
    // the pair lives on globalThis so two module instances of dustTint.ts (dev-server HMR stamps) still see what the feed published
    expect((globalThis as unknown as { __msAmbientDust: { pair: unknown } }).__msAmbientDust.pair).toBe(snow);
    setDustZone('nowhere');
    expect(dustPair()).toEqual(DUST_DEFAULT);
    setDustZone('yeonmu');
    expect(dustPair()).toEqual(DUST_DEFAULT);
  });
  it('on snow the dust is LIT cool white-blue powder over a clearly darker cool shadow underlay (b > g >= r: never olive, never a grey body below the floor); on cobble it is lighter than the floor', () => {
    setDustZone('seori');
    const s = dustPair();
    // the Seori floor measures luma ~0.78 at the game camera: the lit tones are brighter than the floor, the shadow underlay is clearly darker and strong enough to read (shadeA >= 0.5)
    for (const h of [s.hi, s.lo]) {
      expect(luma(h)).toBeGreaterThan(0.8);
      expect(h & 255).toBeGreaterThan((h >> 8) & 255);
      expect((h >> 8) & 255).toBeGreaterThanOrEqual((h >> 16) & 255);
    }
    expect(luma(s.hi)).toBeGreaterThan(luma(s.lo));
    expect(luma(s.shade)).toBeLessThan(0.6);
    expect(s.shade & 255).toBeGreaterThan((s.shade >> 16) & 255);
    expect(s.shadeA).toBeGreaterThanOrEqual(0.5);
    setDustZone('daeryeol');
    expect(luma(dustPair().hi)).toBeGreaterThan(0.6);
    setDustZone('yeonmu');
  });
});
