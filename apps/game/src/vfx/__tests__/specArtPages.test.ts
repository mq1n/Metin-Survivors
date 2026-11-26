// The second cell size of the art array (spec/artPage.ts, art.ts packArt / packDual, shaders.ts roleRect): a scope that does not fit
// the full layers puts its SOFT sprites (artDetail.ts, measured) on dense layers (half-size cells, 4 x the cells per layer).
// Pins: (1) the role encoding is compatible (every role of a full layer decodes to the rect it always did) and the dense page
// round-trips; (2) every scope that fits the old layout gets EXACTLY that layout (hashes taken from the START packer); (3) the
// dual layout places what the single page could not, within every budget; (4) the real worst case (every manifest sprite) fits the
// high tier with crisp cells >= 112 px; (5) the legacy kit never gets a dense role; (6) the bake / staged blit of a dense key.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Color, Scene, Texture, type BufferGeometry, type Mesh, type WebGLRenderer } from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Fx } from '../emit';
import { AMBIENT_ART } from '../common/ambient/art';
import { BOSS_ART, BOSS_RING_ART } from '../common/boss/art';
import { KIT_ART } from '../common/kitArt';
import { MA } from '../common/metin/art';
import { PK_ART } from '../common/pickups/art';
import {
  ART_CELL_PX,
  ART_MAX_CELLS,
  ART_MAX_LAYERS,
  ART_ROLE_BASE,
  ART_RUN_BUDGET_MB,
  SpecArt,
  artBytes,
  artCellFor,
  artFootprint,
  artRect,
  isDenseRole,
  packArt,
  packArtRole,
  type ArtFootprint,
  type ArtLayout,
  type ArtPlan,
  type ArtSource,
} from '../spec/art';
import { ART_SOFT } from '../spec/artDetail';
import { ART_GUTTER, artInnerRect } from '../spec/artGutter';
import { ART_DENSE_RATIO, ART_PAGE1_LAYERS, ART_ROLE_PAGE_UNIT, artSoftness } from '../spec/artPage';
import { SpecHost } from '../spec/host';
import { SPEC_REGISTRY } from '../spec/preset';
import { SPEC_PARTICLE_VERT } from '../spec/shaders';
import { VRng } from '../util';
import { ensureAllSkillVfx } from '../skills/loader';

// the class specs are lazy chunks (vfx/skills/loader.ts): load them all before this file reads the registry
await ensureAllSkillVfx();

vi.mock('../spec/atlas', () => ({ bakeSpecAtlas: () => ({ texture: null, dispose: () => undefined }) }));

const MB = 1048576;

/** the same footprints without their soft flag: what the single page sees */
const crispOnly = (items: readonly ArtFootprint[]): ArtFootprint[] => items.map((f) => ({ id: f.id, cw: f.cw, ch: f.ch, frames: f.frames, cols: f.cols, rows: f.rows, rank: f.rank }));

// ------------------------------------------------------------------------------------------------ role encoding

/** the decode of spec/art.ts artRect BEFORE the second page existed (START copy of the formula) */
function startRect(pk: number, f: number, grid: number): { u0: number; v0: number; du: number; dv: number; layer: number; frames: number } {
  const d0 = pk - ART_ROLE_BASE;
  const layer = d0 % 8;
  let d = Math.floor(d0 / 8);
  const c0 = d % 8;
  d = Math.floor(d / 8);
  const r0 = d % 8;
  d = Math.floor(d / 8);
  const w = (d % 4) + 1;
  d = Math.floor(d / 4);
  const h = (d % 4) + 1;
  const frames = Math.floor(d0 / 8192) + 1;
  const cc = c0 + f * w;
  const row = r0 + Math.floor(cc / grid) * h;
  const col = cc % grid;
  return { u0: col / grid, v0: 1 - (row + h) / grid, du: w / grid, dv: h / grid, layer, frames };
}

const fmod = (x: number, y: number): number => x - y * Math.floor(x / y);

/** line-by-line port of the art branch of spec/shaders.ts roleRect / roleFrames (GLSL float math on exact integers); the rect is the INNER one: the run less the gutter */
function glslRect(pk: number, f: number, uArtGrid: number): { rect: [number, number, number, number]; frames: number } {
  let d = Math.floor((pk - 65536) / 8);
  let c0 = fmod(d, 8);
  d = Math.floor(d / 8);
  let r0 = fmod(d, 8);
  d = Math.floor(d / 8);
  const aw = fmod(d, 4) + 1;
  d = Math.floor(d / 4);
  const ah = fmod(d, 4) + 1;
  d = Math.floor(d / 4);
  let G = Math.max(uArtGrid, 1);
  const page = Math.floor(d / 32);
  if (page > 0.5) {
    G *= ART_DENSE_RATIO;
    c0 += 8 * fmod(page - 1, 2);
    r0 += 8 * Math.floor((page - 1) * 0.5);
  }
  const cc = c0 + f * aw;
  const arow = r0 + Math.floor(cc / G) * ah;
  const gut = ART_GUTTER / G;
  return { rect: [fmod(cc, G) / G + gut, 1 - (arow + ah) / G + gut, aw / G - 2 * gut, ah / G - 2 * gut], frames: fmod(Math.floor((pk - 65536) / 8192), 32) + 1 };
}

describe('role encoding of the second page', () => {
  it('every role of a full layer is what it always was and decodes to the same rect (layer x col x row x w x h x frames)', () => {
    let n = 0;
    for (let layer = 0; layer < 8; layer++) {
      for (let col = 0; col < 8; col++) {
        for (let row = 0; row < 8; row++) {
          for (const [cw, ch] of [[1, 1], [2, 1], [1, 2], [4, 1], [1, 4]] as const) {
            for (const frames of [1, 2, 5, 31, 32]) {
              const fp: ArtFootprint = { id: 'k', cw, ch, frames, cols: 1, rows: 1 };
              const pk = packArtRole({ layer, col, row }, fp);
              expect(pk).toBe(65536 + layer + 8 * col + 64 * row + 512 * (cw - 1) + 2048 * (ch - 1) + 8192 * (frames - 1));
              expect(isDenseRole(pk)).toBe(false);
              for (const f of [0, frames - 1]) {
                const a = artRect(pk, f, 8);
                const b = startRect(pk, f, 8);
                expect({ u0: a.u0, v0: a.v0, du: a.du, dv: a.dv, layer: a.layer, frames: a.frames }).toEqual(b);
                expect(a.dense).toBe(false);
                expect(a.cells).toBe(8);
                const g = glslRect(pk, f, 8);
                const bi = artInnerRect(b, 8);
                expect(g.rect).toEqual([bi.u0, bi.v0, bi.du, bi.dv]);
                expect(g.frames).toBe(b.frames);
              }
              n++;
            }
          }
        }
      }
    }
    expect(n).toBe(8 * 8 * 8 * 5 * 5);
  });

  it('a dense role round-trips (col / row 0..15 on a grid of 16 cells), in JS and in the shader port', () => {
    const G = 8 * ART_DENSE_RATIO;
    expect(G).toBe(16);
    let n = 0;
    for (const layer of [0, 3, 4, 7]) {
      for (let col = 0; col < G; col++) {
        for (let row = 0; row < G; row++) {
          for (const [cw, ch, frames] of [[1, 1, 1], [2, 1, 3], [1, 4, 2], [4, 1, 4], [1, 1, 32]] as const) {
            const fp: ArtFootprint = { id: 'k', cw, ch, frames, cols: 1, rows: 1 };
            const pk = packArtRole({ layer, col, row, dense: true }, fp);
            expect(isDenseRole(pk)).toBe(true);
            expect(Math.fround(pk)).toBe(pk); // exact in a float32 attribute
            expect(pk).toBeLessThan(2 ** 21);
            for (const f of [0, frames - 1]) {
              const a = artRect(pk, f, 8);
              const cc = col + f * cw;
              const wantCol = cc % G;
              const wantRow = row + Math.floor(cc / G) * ch;
              expect(a.dense).toBe(true);
              expect(a.cells).toBe(G);
              expect(a.layer).toBe(layer);
              expect(a.frames).toBe(frames);
              expect(Math.round(a.u0 * G)).toBe(wantCol);
              expect(Math.round((1 - a.v0 - a.dv) * G)).toBe(wantRow);
              expect([Math.round(a.du * G), Math.round(a.dv * G)]).toEqual([cw, ch]);
              const g = glslRect(pk, f, 8);
              const ai = artInnerRect(a, a.cells);
              expect(g.rect).toEqual([ai.u0, ai.v0, ai.du, ai.dv]);
              expect(g.frames).toBe(frames);
            }
            n++;
          }
        }
      }
    }
    expect(n).toBe(4 * 16 * 16 * 5);
  });

  it('the shader source carries the decode the port above mirrors', () => {
    expect(SPEC_PARTICLE_VERT).toContain('float page = floor(d / 32.0);');
    expect(SPEC_PARTICLE_VERT).toContain(`G *= ${ART_DENSE_RATIO}.0;`);
    expect(SPEC_PARTICLE_VERT).toContain('c0 += 8.0 * mod(page - 1.0, 2.0);');
    expect(SPEC_PARTICLE_VERT).toContain('r0 += 8.0 * floor((page - 1.0) * 0.5);');
    expect(SPEC_PARTICLE_VERT).toContain('mod(floor((pk - 65536.0) / 8192.0), 32.0) + 1.0');
    expect(SPEC_PARTICLE_VERT).toContain(`float gut = ${ART_GUTTER} / G;`);
    // single exit since 2026-10-27 (s4-flip): `r = ...; return r;` instead of two returns, which FXC flagged as X4000 "(f_roleRect)" x6 per session
    expect(SPEC_PARTICLE_VERT).toContain('r = vec4(mod(cc, G) / G + gut, 1.0 - (arow + ah) / G + gut, aw / G - 2.0 * gut, ah / G - 2.0 * gut);');
    expect(SPEC_PARTICLE_VERT).toContain('  return r;\n}');
    expect(ART_ROLE_PAGE_UNIT).toBe(8192 * 32);
  });
});

// ------------------------------------------------------------------------------------------------ packer identity


function mixed(n: number, seed: number): ArtFootprint[] {
  let s = seed >>> 0;
  const rnd = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const out: ArtFootprint[] = [];
  for (let i = 0; i < n; i++) {
    const r = rnd();
    const id = `m${String(i).padStart(4, '0')}`;
    if (r < 0.7) out.push(artFootprint(id, 256, 256));
    else if (r < 0.78) out.push(artFootprint(id, 512, 256));
    else if (r < 0.86) out.push(artFootprint(id, 256, 512));
    else if (r < 0.9) out.push(artFootprint(id, 128, 512));
    else if (r < 0.93) out.push(artFootprint(id, 512, 128));
    else if (r < 0.97) out.push(artFootprint(id, 1024, 256, [4, 1], 4));
    else out.push(artFootprint(id, 1024, 1024, [4, 4], 3 + Math.floor(rnd() * 6)));
  }
  return out;
}

function layoutHash(l: ArtLayout): string {
  const canon = [...l.place.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, p]) => `${k}@${p.layer},${p.col},${p.row}`).join('|');
  return `${createHash('sha1').update(`${l.grid}/${l.layers}/${canon}`).digest('hex').slice(0, 12)} layers ${l.layers} placed ${l.place.size}`;
}

/** every place of a layout decodes inside its layer and no cell is used twice (dense places on the dense grid) */
function validate(l: ArtLayout, fps: readonly ArtFootprint[]): void {
  const used = new Set<string>();
  for (const f of fps) {
    const pl = l.place.get(f.id);
    if (!pl) continue;
    const G = pl.dense ? l.grid * ART_DENSE_RATIO : l.grid;
    expect(pl.layer, f.id).toBeLessThan(l.layers);
    for (let fr = 0; fr < f.frames; fr++) {
      const cc = pl.col + fr * f.cw;
      const c = cc % G;
      const r = pl.row + Math.floor(cc / G) * f.ch;
      expect(c + f.cw <= G && r + f.ch <= G, `${f.id} frame ${fr} inside its layer`).toBe(true);
      for (let dy = 0; dy < f.ch; dy++) {
        for (let dx = 0; dx < f.cw; dx++) {
          const k = `${pl.layer}:${r + dy}:${c + dx}`;
          expect(used.has(k), `${f.id}: cell ${k} used twice`).toBe(false);
          used.add(k);
        }
      }
    }
    // a dense place is on a dense layer, a full one never is
    expect(pl.dense === true, f.id).toBe(pl.layer >= l.layers - (l.denseLayers ?? 0));
  }
}

describe('packArt keeps every scope that fits the full layers exactly as it was', () => {
  // START = the packer before the second page (art.start.ts of 2026-10-27), same fixtures
  const START: Record<string, string> = {
    'mixed(120, 11)': 'ec19aa002003 layers 3 placed 120',
    'mixed(200, 5)': '7259660efbf5 layers 5 placed 200',
    'mixed(240, 7)': '4d80133c21cf layers 7 placed 240',
    'mixed(330, 3)': '437568f02706 layers 8 placed 323',
    'mixed(700, 9) ranked': '2b51cb45fdc4 layers 8 placed 288',
    fits150: '1b9f68025ba1 layers 3 placed 150',
  };
  const fits150 = Array.from({ length: 150 }, (_, i) => artFootprint(`k${String(i).padStart(3, '0')}`, i % 7 === 0 ? 512 : 256, i % 11 === 0 ? 512 : 256));

  it('without soft keys the layout is the START packer\'s, including the overflow and the rank order (6 pinned fixtures)', () => {
    expect(layoutHash(packArt(mixed(120, 11)))).toBe(START['mixed(120, 11)']);
    expect(layoutHash(packArt(mixed(200, 5)))).toBe(START['mixed(200, 5)']);
    expect(layoutHash(packArt(mixed(240, 7)))).toBe(START['mixed(240, 7)']);
    expect(layoutHash(packArt(mixed(330, 3)))).toBe(START['mixed(330, 3)']);
    expect(layoutHash(packArt(mixed(700, 9).map((f, i) => ({ ...f, rank: (i * 7) % 13 }))))).toBe(START['mixed(700, 9) ranked']);
    expect(layoutHash(packArt(fits150))).toBe(START.fits150);
  });

  it('soft flags change nothing while the full-layer layout fits ART_PAGE1_LAYERS layers', () => {
    expect(ART_PAGE1_LAYERS).toBe(4);
    for (const [name, items] of [['mixed(120, 11)', mixed(120, 11)], ['fits150', fits150]] as const) {
      const single = packArt(items);
      expect(single.layers, name).toBeLessThanOrEqual(ART_PAGE1_LAYERS);
      const flagged = items.map((f, i) => (i % 2 === 0 ? { ...f, soft: 0.01 * (i % 9) } : f));
      const l = packArt(flagged);
      expect(layoutHash(l), name).toBe(START[name]);
      expect(l.denseLayers, name).toBeUndefined();
      expect([...l.place.values()].some((p) => p.dense), name).toBe(false);
    }
  });

  it('a scope past the page that cannot gain from its soft keys keeps the single layout too (the dual layout must beat it)', () => {
    // 330 crisp 1-cell keys = 6 full layers; one soft key goes into a hole of those layers: no dense layer, same layers
    const crisp = Array.from({ length: 330 }, (_, i) => artFootprint(`c${String(i).padStart(3, '0')}`, 256, 256));
    const soft = { ...artFootprint('z_soft', 256, 256), soft: 0.02 };
    const single = packArt(crisp);
    expect(single.layers).toBe(6);
    const l = packArt([...crisp, soft]);
    expect(l.layers).toBe(6);
    expect(l.denseLayers).toBeUndefined();
  });
});

// ------------------------------------------------------------------------------------------------ dual layout

describe('packArt: the second page', () => {
  /** n one-cell keys, the first `soft` of them soft (softness rising with the index) */
  const scope = (n: number, soft: number, shape: [number, number] = [256, 256]): ArtFootprint[] =>
    Array.from({ length: n }, (_, i) => {
      const f = artFootprint(`${i < soft ? 's' : 'c'}${String(i).padStart(4, '0')}`, shape[0], shape[1]);
      return i < soft ? { ...f, soft: 0.001 * (i + 1) } : f;
    });

  it('moves the softest keys to a dense layer and needs fewer layers than the single page', () => {
    const items = scope(400, 150);
    const single = packArt(crispOnly(items));
    expect(single.layers).toBe(7); // 400 cells on 64-cell layers
    const l = packArt(items);
    validate(l, items);
    expect(l.place.size).toBe(400);
    expect(l.denseLayers).toBe(1);
    expect(l.layers).toBeLessThan(single.layers);
    expect(l.layers).toBe(5); // 250 crisp = 4 full layers (6 holes), 150 soft: 144 of them on one dense layer
    const dense = [...l.place.entries()].filter(([, p]) => p.dense);
    expect(dense.length).toBe(144);
    // only soft keys, and the softest first: the ones left on a full layer are the least soft of them
    for (const [id] of dense) expect(id.startsWith('s')).toBe(true);
    const lastDense = Math.max(...dense.map(([id]) => Number(id.slice(1))));
    expect(lastDense).toBeLessThan(150);
    // 144 soft cells are exactly what moves 400 cells onto 4 full layers + 1 dense one: the 6 least soft keys stay on a full layer
    expect(dense.map(([id]) => id).sort()).toEqual(Array.from({ length: 144 }, (_, i) => `s${String(i).padStart(4, '0')}`));
  });

  it('demotes the FEWEST softest keys that reach the layer count, and nothing when it would not save a layer', () => {
    // 330 cells = 6 full layers; 80 soft ones: 74 of them take the layout to 4 full layers (256 cells) + 1 dense = 5
    const need = scope(330, 80);
    const lean = packArt(need);
    validate(lean, need);
    expect(packArt(crispOnly(need)).layers).toBe(6);
    expect(lean.layers).toBe(5);
    const dense = [...lean.place.entries()].filter(([, p]) => p.dense).map(([id]) => id).sort();
    expect(dense).toEqual(Array.from({ length: 74 }, (_, i) => `s${String(i).padStart(4, '0')}`));
    // 330 cells with only 20 soft ones: 5 full layers + 1 dense is no better than 6 full layers: the single layout stays
    const few = scope(330, 20);
    const l = packArt(few);
    expect(l.layers).toBe(6);
    expect(l.denseLayers).toBeUndefined();
  });

  it('places what the single page cannot hold, in rank order, within the 8 layers', () => {
    // 700 one-cell keys: the single page loses 188 of them; with 350 soft keys the dual layout places all
    const items = scope(700, 350);
    const single = packArt(crispOnly(items));
    expect(single.place.size).toBe(ART_MAX_CELLS);
    const l = packArt(items);
    validate(l, items);
    expect(l.place.size).toBe(700);
    expect(l.layers).toBeLessThanOrEqual(ART_MAX_LAYERS);
    // crisp keys never sit on a dense layer
    for (const [id, p] of l.place) if (id.startsWith('c')) expect(p.dense).toBeUndefined();
  });

  it('tall / wide / flipbook runs of soft keys fit the dense grid (4-cell bands, 16-column bands, frame lists)', () => {
    const crisp = scope(190, 0);
    const soft: ArtFootprint[] = [
      { ...artFootprint('s_tall', 128, 512), soft: 0.01 },
      { ...artFootprint('s_wide', 512, 128), soft: 0.01 },
      { ...artFootprint('s_sheet', 1024, 1024, [4, 4], 16), soft: 0.02 },
      { ...artFootprint('s_strip', 4096, 256, [16, 1], 16), soft: 0.02 },
      { ...artFootprint('s_long', 8192, 256, [32, 1], 32), soft: 0.02 },
      ...Array.from({ length: 80 }, (_, i) => ({ ...artFootprint(`s_${String(i).padStart(3, '0')}`, 256, 256), soft: 0.03 })),
    ];
    const items = [...crisp, ...soft];
    const l = packArt(items);
    validate(l, items);
    expect(l.place.size).toBe(items.length);
    expect(l.denseLayers).toBe(1);
  });

  it('every real tier budget holds: the cell shrinks over the TOTAL layers, dense cells are half of it', () => {
    const items = scope(520, 260);
    const l = packArt(items);
    expect(l.place.size).toBe(520);
    for (const tier of [0, 1, 2, 3] as const) {
      const budget = (ART_RUN_BUDGET_MB[tier] as number) * MB;
      const cell = artCellFor(l, ART_CELL_PX[tier], budget);
      expect(artBytes(l.grid, l.layers, cell), `tier ${tier}`).toBeLessThanOrEqual(budget);
    }
  });
});

// ------------------------------------------------------------------------------------------------ the real worst case

/** a renderer that records the passes it is asked to render (no GL) */
interface Pass {
  layer: number;
  cleared: boolean;
  /** x extent (clip space) and layer of every quad this pass draws */
  quads: { w: number; x0: number; y0: number }[];
}
function fakeRenderer(): { r: WebGLRenderer; passes: Pass[] } {
  const passes: Pass[] = [];
  let layer = 0;
  let cleared = false;
  const r = {
    autoClear: true,
    info: { render: { calls: 0, triangles: 0, points: 0, lines: 0 } },
    getRenderTarget: () => null,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    getClearColor: (c: Color) => c,
    getClearAlpha: () => 1,
    setClearColor: () => undefined,
    setRenderTarget: (_rt: unknown, l?: number) => {
      layer = l ?? 0;
      cleared = false;
    },
    clear: () => {
      cleared = true;
    },
    render: (scene: Scene) => {
      const quads: Pass['quads'] = [];
      for (const o of scene.children) {
        const g = (o as Mesh).geometry as BufferGeometry;
        const pos = Array.from(g.getAttribute('position').array as Float32Array);
        for (let q = 0; q < pos.length / 12; q++) quads.push({ w: (pos[q * 12 + 3] as number) - (pos[q * 12] as number), x0: pos[q * 12] as number, y0: pos[q * 12 + 1] as number });
      }
      passes.push({ layer, cleared, quads });
    },
  };
  return { r: r as unknown as WebGLRenderer, passes };
}

function realWorld(): { h: SpecHost; src: ArtSource; textures: Record<string, { kind?: string; w: number; h: number; alpha?: boolean }> } {
  const { r } = fakeRenderer();
  const fx = { time: 0, rng: new VRng(7), density: 1, budget: 1e9, spawned: 0, dropped: 0, heightAt: () => 0 } as unknown as Fx;
  const h = new SpecHost(new Scene(), r, { value: 0 }, fx, 2, 10, SPEC_REGISTRY);
  const man = JSON.parse(readFileSync(new URL('../../../public/assets/manifest/textures.json', import.meta.url), 'utf8')) as Record<string, { kind?: string; w: number; h: number; alpha?: boolean }>;
  const textures = Object.fromEntries(Object.entries(man).filter(([, e]) => e.kind === 'vfx'));
  return { h, src: { hasTexture: (id) => id in textures, loadTexture: () => Promise.resolve(new Texture()), manifest: { textures } }, textures };
}

describe('the real worst case: every shipped sprite is wired, a party of four classes', () => {
  it('places every manifest sprite, inside every tier budget, with crisp cells >= 112 px at high (the single page loses keys at 96 px)', async () => {
    const { h, src, textures } = realWorld();
    await h.preloadArt(src); // gallery scope: gives every registry key its footprint (sheet hints applied) through its packed role
    const foot = new Map<string, ArtFootprint>();
    for (const key of h.artIds) {
      const role = h.art.peek(key);
      if (!role) continue;
      const d = artRect(role.packed, 0, h.art.grid);
      foot.set(key, { id: key, cw: Math.round(d.du * d.cells), ch: Math.round(d.dv * d.cells), frames: role.frames, cols: 1, rows: 1 });
    }
    // every manifest sprite once: its registry footprint when a spec draws it alone, else a plain one from the manifest size
    const ids = Object.keys(textures);
    expect(ids.length).toBeGreaterThan(300);
    const fps = ids.map((id) => {
      const f = { ...(foot.get(id) ?? artFootprint(id, (textures[id] as { w: number }).w, (textures[id] as { h: number }).h)), id } as ArtFootprint;
      const soft = artSoftness(id);
      if (soft !== undefined) f.soft = soft;
      return f;
    });
    const cells = fps.reduce((n, f) => n + f.cw * f.ch * f.frames, 0);
    expect(cells, 'a scope this size is what the second page is for').toBeGreaterThan(ART_MAX_CELLS);
    const l = packArt(fps);
    validate(l, fps);
    expect(l.place.size, 'keys without a cell').toBe(fps.length);
    expect(l.layers).toBeLessThanOrEqual(ART_MAX_LAYERS - 1);
    expect(l.denseLayers, 'the soft keys are what makes it fit').toBeGreaterThanOrEqual(1);
    for (const tier of [0, 1, 2, 3] as const) {
      const budget = (ART_RUN_BUDGET_MB[tier] as number) * MB;
      const cell = artCellFor(l, ART_CELL_PX[tier], budget);
      expect(artBytes(l.grid, l.layers, cell), `tier ${tier}`).toBeLessThanOrEqual(budget);
    }
    const high = artCellFor(l, ART_CELL_PX[2], ART_RUN_BUDGET_MB[2] * MB);
    expect(high, 'crisp cell at high (refresh artDetail.ts after a sprite batch)').toBeGreaterThanOrEqual(112);
    // crisp keys are on full layers only
    for (const f of fps) if (f.soft === undefined) expect(l.place.get(f.id)?.dense, f.id).toBeUndefined();
  });

  it('the registered specs\' own scopes (gallery) fit six full layers: no dense layer is used even with the live S4 families', async () => {
    const { h, src } = realWorld();
    await h.preloadArt(src);
    expect(h.art.stats.dropped).toBe(0);
    expect(h.art.stats.denseLayers).toBe(0);
    expect(h.art.stats.dense).toBe(0);
    // RE-PINNED 2026-10-27 (s4-flip, lead decision: the S4 winners go live): 46 generated skill families are live, the gallery (every key of every registered
    // spec) holds 307 keys = 6 full layers (was 197 keys = 4 layers = ART_PAGE1_LAYERS). Its soft keys are too few for packDual to save a layer, so the layout stays the
    
    expect(h.art.stats.layers).toBeLessThanOrEqual(6);
    expect(h.art.stats.layers).toBeGreaterThan(ART_PAGE1_LAYERS);
  });
});

// ------------------------------------------------------------------------------------------------ the soft table

describe('the soft table (artDetail.ts)', () => {
  const man = JSON.parse(readFileSync(new URL('../../../public/assets/manifest/textures.json', import.meta.url), 'utf8')) as Record<string, { kind?: string }>;

  it('lists shipped vfx sprites only, with a measured loss in [0, 0.09]', () => {
    const ids = Object.keys(ART_SOFT);
    expect(ids.length).toBeGreaterThan(100);
    for (const id of ids) {
      expect(man[id]?.kind, id).toBe('vfx');
      expect(ART_SOFT[id], id).toBeGreaterThanOrEqual(0);
      expect(ART_SOFT[id], id).toBeLessThanOrEqual(0.09);
    }
  });

  it('never lists a sprite the legacy kit can draw (its shader has no dense page): every KitArt record is crisp', () => {
    const kit = new Set<string>();
    for (const rec of [KIT_ART, AMBIENT_ART, BOSS_ART, BOSS_RING_ART, PK_ART, MA] as Record<string, { id: string }>[]) for (const a of Object.values(rec)) kit.add(a.id);
    expect(kit.size).toBeGreaterThan(60);
    expect([...kit].filter((id) => ART_SOFT[id] !== undefined)).toEqual([]);
  });

  it('thin hard structure (bolts, runes, emblems ...) is crisp, and an unknown id is crisp', () => {
    for (const id of Object.keys(ART_SOFT)) expect(/bolt|rune|glyph|sigil|emblem|skull|fang|spike|crown|claw|crack|shard|crystal|chain|needle|pinwheel|thorn|web|zig|lattice|hex|lightning|feather/.test(id), id).toBe(false);
    expect(artSoftness('vfx_no_such_sprite')).toBeUndefined();
  });

  it('a frame list is as soft as its crispest frame, and crisp as soon as one frame is crisp', () => {
    const [a, b] = Object.keys(ART_SOFT) as [string, string];
    expect(artSoftness(a)).toBe(ART_SOFT[a]);
    expect(artSoftness(`${a}+${b}`)).toBe(Math.max(ART_SOFT[a] as number, ART_SOFT[b] as number));
    expect(artSoftness(`${a}+vfx_no_such_sprite`)).toBeUndefined();
  });
});

// ------------------------------------------------------------------------------------------------ bake + staged blit (faked GPU)

/** `total` one-cell 256 px sprites: up to 150 real soft ids of the table and crisp ones (c0..) for the rest */
function softSource(total: number): { src: ArtSource; crisp: string[]; soft: string[] } {
  const soft = Object.keys(ART_SOFT).slice(0, 150);
  const crisp = Array.from({ length: total - soft.length }, (_, i) => `c${i}`);
  const textures: Record<string, { w: number; h: number; alpha: boolean }> = {};
  for (const id of [...soft, ...crisp]) textures[id] = { w: 256, h: 256, alpha: false };
  return { src: { hasTexture: (id) => id in textures, loadTexture: () => Promise.resolve(new Texture()), manifest: { textures } }, crisp, soft };
}
const tick = (): Promise<void> => new Promise((res) => setTimeout(res, 0));

describe('SpecArt with a dense page (faked GPU)', () => {
  it('bakes a scope past the page into full + dense layers: roles, blit quads, stats', async () => {
    const { r, passes } = fakeRenderer();
    const { src, crisp, soft } = softSource(400);
    const art = new SpecArt(r, 2);
    art.setBudget(ART_RUN_BUDGET_MB);
    await art.preload(src, [...crisp, ...soft], true);
    const st = art.stats;
    expect(st.dropped).toBe(0);
    expect(st.layers).toBe(5);
    expect(st.denseLayers).toBe(1);
    expect(st.dense).toBe(144);
    expect(st.cell % 16).toBe(0);
    expect(st.denseCell).toBe(Math.round(st.cell / ART_DENSE_RATIO));
    expect(st.bytes).toBeLessThanOrEqual(ART_RUN_BUDGET_MB[2] * MB);
    expect(art.grid).toBe(8); // uArtGrid stays the full layers' grid
    // a crisp key: full cell; a dense one: dense role whose rect is half a full cell wide
    expect(isDenseRole((art.peek(crisp[0] as string) as { packed: number }).packed)).toBe(false);
    const dense = soft.filter((id) => isDenseRole((art.peek(id) as { packed: number }).packed));
    expect(dense.length).toBe(144);
    const d = artRect((art.peek(dense[0] as string) as { packed: number }).packed, 0, art.grid);
    expect(d.du).toBe(1 / 16);
    expect(d.layer).toBeGreaterThanOrEqual(4);
    // the blit: dense layers draw quads of 1/16 of the layer (clip space 2/16), full layers 1/8
    const widths = (p: Pass): number[] => [...new Set(p.quads.map((q) => Number(q.w.toFixed(4))))];
    for (const p of passes) expect(widths(p), `layer ${p.layer}`).toEqual(p.layer >= st.layers - st.denseLayers ? [0.125] : [0.25]);
    expect(passes.length).toBe(st.layers);
  });

  it('the legacy kit entry (role with demand) never gets a dense role: it draws its procedural cell and warns once', async () => {
    const { r } = fakeRenderer();
    const { src, crisp, soft } = softSource(400);
    const art = new SpecArt(r, 2);
    art.setBudget(ART_RUN_BUDGET_MB);
    await art.preload(src, [...crisp, ...soft], true);
    const dense = soft.find((id) => isDenseRole((art.peek(id) as { packed: number }).packed)) as string;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(art.role(dense)).toBeNull();
    expect(art.role(dense)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain(dense);
    warn.mockRestore();
    expect(art.peek(dense)).not.toBeNull(); // the spec host reads through peek
    expect(art.role(crisp[0] as string)).not.toBeNull();
  });

  it('a staged scope lays the dense page out up front and blits late keys into their dense cells without moving anything', async () => {
    const { r, passes } = fakeRenderer();
    const { src, crisp, soft } = softSource(400);
    const keys = [...crisp, ...soft];
    const art = new SpecArt(r, 2);
    art.setBudget(ART_RUN_BUDGET_MB);
    const plan: ArtPlan = { now: new Set(crisp.slice(0, 20)), later: [...crisp.slice(20), ...soft], after: 0 };
    await art.preload(src, keys, true, plan);
    const st0 = { ...art.stats };
    expect(st0.layers).toBe(5);
    expect(st0.denseLayers).toBe(1);
    expect(st0.dense).toBe(144); // reserved cells: placed up front
    expect(soft.filter((id) => art.peek(id) !== null).length).toBeLessThan(soft.length); // ...but no pixels of the late keys yet
    expect(st0.pending).toBeGreaterThan(0);
    const nowRole = art.peek(crisp[0] as string);
    expect(nowRole).not.toBeNull();
    const baked = passes.length;
    for (let i = 0; i < 600 && (art.streamStats().queued > 0 || art.streamStats().flying > 0 || art.streamStats().ready > 0); i++) {
      art.pump(1 / 60);
      await tick();
    }
    expect(art.stats.pending).toBe(0);
    expect(art.stats.dropped).toBe(0);
    expect(art.peek(crisp[0] as string)).toEqual(nowRole); // nothing moved
    const dense = soft.filter((id) => isDenseRole((art.peek(id) as { packed: number }).packed));
    expect(dense.length).toBe(144);
    // the slices that blitted dense keys drew 1/16-wide quads into the dense layer, never cleared it (a blit keeps what is there)
    const late = passes.slice(baked);
    const lateDense = late.filter((p) => p.layer >= 4);
    expect(lateDense.length).toBeGreaterThan(0);
    for (const p of lateDense) {
      expect(p.cleared).toBe(false);
      expect([...new Set(p.quads.map((q) => Number(q.w.toFixed(4))))]).toEqual([0.125]);
    }
  });

  it('setTier re-bakes the dual layout at the new cell and keeps the dense page', async () => {
    const { r } = fakeRenderer();
    const { src, crisp, soft } = softSource(400);
    const art = new SpecArt(r, 2);
    art.setBudget(ART_RUN_BUDGET_MB);
    await art.preload(src, [...crisp, ...soft], true);
    const hi = art.stats.cell;
    art.setTier(0);
    expect(art.stats.cell).toBeLessThan(hi);
    expect(art.stats.denseLayers).toBe(1);
    expect(art.stats.denseCell).toBe(Math.round(art.stats.cell / ART_DENSE_RATIO));
    expect(art.stats.bytes).toBeLessThanOrEqual(ART_RUN_BUDGET_MB[0] * MB);
    expect(art.stats.dropped).toBe(0);
  });
});

