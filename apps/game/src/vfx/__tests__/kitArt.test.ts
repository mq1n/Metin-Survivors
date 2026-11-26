// C3 bridge + C4 remainder: generated sprites in the legacy kit (one art system), the new kit helpers, the plane / pattern ids.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DataArrayTexture } from 'three';
import { DebrisBatch, ParticleBatch, RibbonBatch, ShapeBatch, P_STRIDE, S_STRIDE, type SharedUniforms } from '../batches';
import { COMMON_TARGET_SPECS } from '../common';
import { KIT_ART, KIT_ART_IDS, KIT_ART_SPEC } from '../common/kitArt';
import { Fx, PAT, type KitArt } from '../emit';
import { PALETTES } from '../palette';
import { VFX_PROFILES } from '../quality';
import { cinders, crackHeat, crater, dustRing, glints, groundFlare, lightShaft, pillarCross, ringArc, rocks, smoke, stain } from '../presets/kit';
import { COMMON_SPECS } from '../skills/common';
import { ART_ROLE_BASE, artRect, packArtRole } from '../spec/art';
import { artKey } from '../spec/artScope';
import { SPR } from '../textures';

function uniforms(): SharedUniforms {
  return {
    uTime: { value: 0 },
    uAtlas: { value: null },
    uNoise: { value: null },
    uDepth: { value: null },
    uInvRes: { value: { x: 1, y: 1 } },
    uNearFar: { value: { x: 0.1, y: 100 } },
    uSoft: { value: 0 },
  };
}

function rig(withArt: boolean) {
  const u = uniforms();
  const pAdd = new ParticleBatch(512, 'add', u);
  const pAlp = new ParticleBatch(512, 'alpha', u);
  const sAdd = new ShapeBatch(64, 'add', u);
  const sAlp = new ShapeBatch(64, 'alpha', u);
  const fx = new Fx(VFX_PROFILES.high, pAdd, pAlp, sAdd, sAlp, new RibbonBatch(16, u), new DebrisBatch(64, u));
  fx.budget = 10_000;
  if (withArt) {
    // a stand-in spec host: every kit sprite is "packed" at layer 1, cell (id index, 0)
    const roles = new Map<string, { packed: number; frames: number }>();
    KIT_ART_IDS.forEach((id, i) => roles.set(id, { packed: packArtRole({ layer: 1, col: i % 8, row: Math.floor(i / 8) }, { id, cw: 1, ch: 1, frames: 1, cols: 1, rows: 1 }), frames: 1 }));
    const uArt = { value: new DataArrayTexture(new Uint8Array(4), 1, 1, 1) };
    const uGrid = { value: 8 };
    fx.spec = { art: { role: (k: string) => roles.get(k) ?? null }, uniforms: { uSpecArt: uArt, uArtGrid: uGrid } } as never;
    return { fx, pAdd, pAlp, sAdd, sAlp, uArt, uGrid, roles };
  }
  return { fx, pAdd, pAlp, sAdd, sAlp, uArt: null, uGrid: null, roles: null };
}

/** cell (aE.y) of every live particle record of a batch */
function cells(b: ParticleBatch): number[] {
  const out: number[] = [];
  for (let i = 0; i < b.cap; i++) if ((b.f[i * P_STRIDE + 7] as number) > 0 && (b.f[i * P_STRIDE + 3] as number) > -1e5) out.push(b.f[i * P_STRIDE + 17] as number);
  return out;
}
function used(b: ParticleBatch): number {
  return cells(b).length;
}
function shapes(b: ShapeBatch): { mode: number; pat: number }[] {
  const out: { mode: number; pat: number }[] = [];
  for (let i = 0; i < b.cap; i++) if ((b.f[i * S_STRIDE + 3] as number) > -1e5) out.push({ mode: b.f[i * S_STRIDE + 8] as number, pat: b.f[i * S_STRIDE + 9] as number });
  return out;
}

describe('kit art registry (C3 bridge)', () => {
  it('lists unique manifest ids that ship as kind vfx textures', () => {
    expect(new Set(KIT_ART_IDS).size).toBe(KIT_ART_IDS.length);
    const manifest = JSON.parse(readFileSync(new URL('../../../public/assets/manifest/textures.json', import.meta.url), 'utf8')) as { textures?: Record<string, unknown> } | Record<string, unknown>;
    const tex = ((manifest as { textures?: Record<string, unknown> }).textures ?? manifest) as Record<string, unknown>;
    expect(KIT_ART_IDS.filter((id) => tex[id] === undefined)).toEqual([]);
  });

  it('is carried by the common spec sk.gen.kit_art so every run packs it (and nothing else)', () => {
    const keys = KIT_ART_SPEC.elements.map((e) => (e.kind === 'particle' && typeof e.tex === 'object' ? artKey(e.tex.art) : ''));
    expect(keys.sort()).toEqual([...KIT_ART_IDS].sort());
    expect(COMMON_TARGET_SPECS.some((s) => s.id === 'sk.gen.kit_art')).toBe(true);
    expect(COMMON_SPECS.some((s) => s.id === 'sk.gen.kit_art')).toBe(true);
  });

  it('keeps a procedural fallback cell below the art range for every sprite', () => {
    for (const a of Object.values(KIT_ART) as KitArt[]) expect(a.fb).toBeLessThan(ART_ROLE_BASE);
  });
});

describe('Fx art bridge', () => {
  it('draws the procedural fallback until a spec host with the sprite is installed, then the packed role', () => {
    const r = rig(false);
    expect(r.fx.artCell(KIT_ART.glintPin)).toBe(SPR.glint);
    expect(r.fx.hasArt(KIT_ART.glintPin)).toBe(false);
    const r2 = rig(true);
    const packed = r2.fx.artCell(KIT_ART.glintPin);
    expect(packed).toBeGreaterThanOrEqual(ART_ROLE_BASE);
    expect(r2.fx.hasArt(KIT_ART.glintPin)).toBe(true);
    // the packed float decodes to the cell the stand-in host assigned (layer 1)
    expect(artRect(packed, 0, 8).layer).toBe(1);
  });

  it('hands the spec host art uniforms to both legacy particle batches (one art array, shared objects)', () => {
    const r = rig(true);
    expect(r.pAdd.mat.uniforms.uSpecArt).toBe(r.uArt);
    expect(r.pAlp.mat.uniforms.uSpecArt).toBe(r.uArt);
    expect(r.pAdd.mat.uniforms.uArtGrid).toBe(r.uGrid);
  });

  it('fx.legacyKit forces the procedural cell even when the sprite is packed', () => {
    const r = rig(true);
    r.fx.legacyKit = true;
    expect(r.fx.artCell(KIT_ART.smokeClump)).toBe(SPR.smoke1);
    expect(r.fx.hasArt(KIT_ART.smokeClump)).toBe(false);
  });

  it('writes the packed role into the particle record; a flipbook fallback keeps its frame count', () => {
    const r = rig(true);
    r.fx.add.at(0, 0, 0).art(KIT_ART.glintPin).emit();
    expect(cells(r.pAdd)[0]).toBe(r.fx.artCell(KIT_ART.glintPin));
    const q = rig(false);
    q.fx.add.at(0, 0, 0).art({ id: 'x', fb: 64, fbFrames: 16 }).emit();
    expect(cells(q.pAdd)[0]).toBe(64);
    expect((q.pAdd.f[18] as number) >> 2 & 63).toBe(16);
  });
});

describe('smoke / dust ring (art with the old atlas as fallback)', () => {
  it('uses the generated smoke puffs when packed, the atlas cells when not, forced cells always', () => {
    const art = rig(true);
    smoke(art.fx, 0, 0, 0, 12, 1, 1, 1, 2, 1, 2, 0x808080);
    for (const c of cells(art.pAlp)) expect(c).toBeGreaterThanOrEqual(ART_ROLE_BASE);
    const plain = rig(false);
    smoke(plain.fx, 0, 0, 0, 12, 1, 1, 1, 2, 1, 2, 0x808080);
    for (const c of cells(plain.pAlp)) {
      expect(c).toBeGreaterThanOrEqual(SPR.smoke0);
      expect(c).toBeLessThanOrEqual(SPR.smoke3);
    }
    const forced = rig(true);
    smoke(forced.fx, 0, 0, 0, 6, 1, 1, 1, 2, 1, 2, 0x808080, 0.5, 0, SPR.dust0);
    for (const c of cells(forced.pAlp)) expect(c).toBeLessThan(ART_ROLE_BASE);
    const ring = rig(true);
    dustRing(ring.fx, 0, 0, 0, 10, 2, 0.6, 0xcdbd9a);
    expect(used(ring.pAlp)).toBe(10);
    for (const c of cells(ring.pAlp)) expect(c).toBeGreaterThanOrEqual(ART_ROLE_BASE);
  });
});

describe('C4 kit helpers', () => {
  const pal = PALETTES.holy;

  it('ringArc / groundFlare lie on the ground (mode ground) and use the arc / spike sprites', () => {
    const r = rig(true);
    ringArc(r.fx, 1, 2, 0.5, 2, 1, 0xffe08a);
    groundFlare(r.fx, 1, 2, 2, 1, 0xffe08a);
    expect(used(r.pAdd)).toBe(3);
    const mode = (i: number): number => (r.pAdd.f[i * P_STRIDE + 18] as number) & 3;
    for (let i = 0; i < 3; i++) expect(mode(i)).toBe(2);
    expect(cells(r.pAdd).filter((c) => c >= ART_ROLE_BASE)).toHaveLength(2);
  });

  it('glints and cinders emit the requested counts; cinders keep procedural embers in the add batch', () => {
    const r = rig(true);
    glints(r.fx, 0, 0, 0, 9, 2, 2, 0.5, 1, 0.6, 0xffffff);
    expect(used(r.pAdd)).toBe(9);
    expect(cells(r.pAdd).some((v) => v >= ART_ROLE_BASE)).toBe(true);
    const c = rig(true);
    cinders(c.fx, 0, 0, 0, 8, 1, 1, 1, 2, 0.2, 0xffb040, 0x7a3a18);
    expect(used(c.pAdd)).toBe(8);
    expect(cells(c.pAdd).filter((v) => v === SPR.ember0 || v === SPR.ember1)).toHaveLength(8);
  });

  it('crackHeat = one crackHeat decal + generated scars when packed; stain / crater are single decals', () => {
    const r = rig(true);
    crackHeat(r.fx, 0, 0, 2, 4, 0x1a1210, 0xff8a2a);
    stain(r.fx, 0, 0, 1.5, 4, 0x4a0c10, 0xff7a6a);
    crater(r.fx, 0, 0, 1.5, 4, 0x1c1814, 0xb8a888);
    expect(shapes(r.sAlp).map((s) => s.pat).sort((a, b) => a - b)).toEqual([PAT.crackHeat, PAT.stain, PAT.crater]);
    expect(used(r.pAlp)).toBe(2);
    const p = rig(false);
    crackHeat(p.fx, 0, 0, 2, 4, 0x1a1210, 0xff8a2a);
    expect(used(p.pAlp)).toBe(0);
  });

  it('lightShaft stands two upright curtains; pillarCross stands crossed vertical planes (mode 4)', () => {
    const r = rig(true);
    lightShaft(r.fx, 0, 0, 0, 2, 5, 1.5, 0xffe08a);
    expect(used(r.pAdd)).toBe(2);
    for (let i = 0; i < 2; i++) expect((r.pAdd.f[i * P_STRIDE + 18] as number) & 3).toBe(3);
    const slot = pillarCross(r.fx, 0, 0, 1, 4, 1.5, pal, 1.6, 0, 3);
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(shapes(r.sAdd).filter((s) => s.mode === 4 && s.pat === PAT.pillarPlane)).toHaveLength(3);
    // the planes are spread over 180 degrees
    const yaws = [0, 1, 2].map((i) => r.sAdd.f[i * S_STRIDE + 4] as number);
    expect(yaws[1]! - yaws[0]!).toBeCloseTo(Math.PI / 3, 5);
    expect(yaws[2]! - yaws[1]!).toBeCloseTo(Math.PI / 3, 5);
  });

  it('rocks throw art sprites (alpha batch) when packed and fall back to debris cubes otherwise', () => {
    const r = rig(true);
    rocks(r.fx, 0, 1, 0, 7, 5, 0.7);
    expect(used(r.pAlp)).toBe(7);
    const d = rig(false);
    rocks(d.fx, 0, 1, 0, 7, 5, 0.7);
    expect(used(d.pAlp)).toBe(0);
    expect(d.fx.spawned).toBe(7);
  });

  it('keeps the new patterns distinct from the existing ones', () => {
    const ids = Object.values(PAT);
    expect(new Set(ids).size).toBe(ids.length);
    expect(PAT.crackHeat).toBeGreaterThan(PAT.pillarSoft);
  });
});

