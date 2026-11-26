// Generated-art loading: art keys and flipbook frame lists, the per-run scope (which specs a run can spawn), the VRAM
// budget (cell shrink) and the pack / blit layout of a frame list. The GPU is faked (a renderer that records the
// meshes it is asked to render), so the whole bake loop runs on the CPU.
import { readFileSync } from 'node:fs';
import { Color, Mesh, Scene, ShaderMaterial, Texture, type BufferGeometry, type WebGLRenderer } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { Ctx, type Fx } from '../emit';
import { PRESETS } from '../presets';
import { MAX_PLAYERS } from '../../sim/constants';
import { ART_CELL_PX, ART_MAX_CELLS, ART_MAX_LAYERS, ART_MIN_CELL_PX, ART_RUN_BUDGET_MB, SpecArt, artBytes, artCellFor, artFootprint, artRect, packArt, type ArtFootprint, type ArtPlan, type ArtSource } from '../spec/art';
import { ART_GUTTER } from '../spec/artGutter';
import { ART_SHEETS, ART_SHEET_PLAY, ART_SHEET_POOLS, type ArtSheetName } from '../spec/artSheets';
import { ART_SHEET_SEP, artKey, artOk, artParts, isDevSpec, runSpecIds, type ScopeSkill } from '../spec/artScope';
import { texOk } from '../spec/curves';
import { ART_DEMO, ART_DEMO_RAW, ART_SHEETS_DEMO } from '../spec/demo';
import { flipFrame, frameModeBits } from '../spec/flip';
import { SpecHost } from '../spec/host';
import { SPEC_REGISTRY } from '../spec/preset';
import type { ElementSpec, FxSpec, ParticleSpec, TierIdx } from '../spec/types';
import { VRng } from '../util';
import { ensureAllSkillVfx } from '../skills/loader';

// the class specs are lazy chunks (vfx/skills/loader.ts): load them all before this file reads the registry
await ensureAllSkillVfx();

vi.mock('../spec/atlas', () => ({ bakeSpecAtlas: () => ({ texture: null, dispose: () => undefined }) }));

const MB = 1048576;

// ------------------------------------------------------------------------------------------------ fakes

interface Drawn {
  layer: number;
  meshes: { pos: number[]; uv: number[]; box: number[]; map: Texture }[];
}

/**
 * The source uv the FIRST quad of a blit mesh shows at the corners of the image's place: the quad covers the whole run (gutter included), the
 * image sits inside it ART_GUTTER cells from every side (`grid` = cells per side of the layer the quad is drawn on). artGutter.ts
 */
function innerUv(m: { pos: number[]; uv: number[] }, grid: number): number[] {
  const g = (ART_GUTTER * 2) / grid; // the gutter in NDC
  const [x0, y0, x1, y1] = [m.pos[0] as number, m.pos[1] as number, m.pos[3] as number, m.pos[7] as number];
  const at = (x: number, y: number): [number, number] => [
    (m.uv[0] as number) + ((x - x0) / (x1 - x0)) * ((m.uv[2] as number) - (m.uv[0] as number)),
    (m.uv[1] as number) + ((y - y0) / (y1 - y0)) * ((m.uv[5] as number) - (m.uv[1] as number)),
  ];
  return [...at(x0 + g, y0 + g), ...at(x1 - g, y0 + g), ...at(x0 + g, y1 - g), ...at(x1 - g, y1 - g)];
}

/** a renderer that records what each layer pass draws (no GL) */
function fakeRenderer(): { r: WebGLRenderer; drawn: Drawn[] } {
  const drawn: Drawn[] = [];
  let layer = 0;
  const r = {
    autoClear: true,
    getRenderTarget: () => null,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    getClearColor: (c: Color) => c,
    getClearAlpha: () => 1,
    setClearColor: () => undefined,
    setRenderTarget: (_rt: unknown, l?: number) => {
      layer = l ?? 0;
    },
    clear: () => undefined,
    render: (scene: Scene) => {
      const meshes: Drawn['meshes'] = [];
      for (const o of scene.children) {
        const m = o as Mesh;
        const g = m.geometry as BufferGeometry;
        meshes.push({
          pos: Array.from(g.getAttribute('position').array as Float32Array),
          uv: Array.from(g.getAttribute('uv').array as Float32Array),
          box: Array.from(g.getAttribute('aBox').array as Float32Array),
          map: ((m.material as ShaderMaterial).uniforms.map as { value: Texture }).value,
        });
      }
      drawn.push({ layer, meshes });
    },
  };
  return { r: r as unknown as WebGLRenderer, drawn };
}

/** a manifest of `n` 256 × 256 additive sprites `s0..s{n-1}` (+ named extras); loads record which ids were fetched */
function fakeSource(extra: Record<string, { w: number; h: number }> = {}, n = 0): { src: ArtSource; loaded: string[]; tex: Map<string, Texture> } {
  const textures: Record<string, { w: number; h: number; alpha: boolean }> = {};
  for (let i = 0; i < n; i++) textures[`s${i}`] = { w: 256, h: 256, alpha: false };
  for (const [id, d] of Object.entries(extra)) textures[id] = { ...d, alpha: false };
  const loaded: string[] = [];
  const tex = new Map<string, Texture>();
  const src: ArtSource = {
    hasTexture: (id) => id in textures,
    loadTexture: (id) => {
      loaded.push(id);
      const t = new Texture();
      tex.set(id, t);
      return Promise.resolve(t);
    },
    manifest: { textures },
  };
  return { src, loaded, tex };
}

// ------------------------------------------------------------------------------------------------ keys

describe('art keys', () => {
  it('a plain id is its own key, a frame list joins its ids in order', () => {
    expect(artKey('vfx_a')).toBe('vfx_a');
    expect(artKey(['vfx_a'])).toBe('vfx_a');
    expect(artKey(['vfx_a', 'vfx_b', 'vfx_c'])).toBe(['vfx_a', 'vfx_b', 'vfx_c'].join(ART_SHEET_SEP));
    expect(artParts('vfx_a')).toEqual(['vfx_a']);
    expect(artParts(artKey(['vfx_a', 'vfx_b']))).toEqual(['vfx_a', 'vfx_b']);
  });

  it('rejects empty ids and empty lists', () => {
    expect(artOk('')).toBe(false);
    expect(artOk([])).toBe(false);
    expect(artOk(['vfx_a', ''])).toBe(false);
    expect(artOk(['vfx_a', 'vfx_b'])).toBe(true);
    expect(texOk({ art: ['vfx_a', 'vfx_b'] })).toBe(true);
    expect(texOk({ art: [] })).toBe(false);
  });

  it('manifest ids never contain the separator', () => {
    const man = JSON.parse(readFileSync(new URL('../../../public/assets/manifest/textures.json', import.meta.url), 'utf8')) as Record<string, unknown>;
    expect(Object.keys(man).filter((id) => id.includes(ART_SHEET_SEP))).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------ run scope

describe('run scope (runSpecIds)', () => {
  const skills: ScopeSkill[] = [
    { id: 'sword_arc', classId: 'warrior', doctrine: 'a', vfx: 'sk.sword_arc' },
    { id: 'bash', classId: 'warrior', doctrine: 'a', vfx: 'sk.crushing_blow' },
    { id: 'spirit_edge', classId: 'warrior', doctrine: 'b', vfx: 'sk.spirit_edge' },
    { id: 'nightfall', classId: 'yacha', doctrine: 'b', vfx: 'sk.nightfall' },
    { id: 'fan', classId: 'shaman', doctrine: 'a', vfx: 'sk.fan' },
    { id: 'heal_all', classId: 'common', doctrine: null, vfx: 'sk.heal_all' },
  ];
  const registry = ['sk.sword_arc', 'sk.crushing_blow', 'sk.spirit_edge', 'sk.nightfall', 'sk.nightfall.cast', 'sk.fan', 'sk.heal_all', 'sk.gen.hit', 'sk.gen.metin_loop1.aqua'];

  it('keeps the chosen doctrine of the class, the common pool and the unclaimed common effects', () => {
    const got = runSpecIds(skills, [{ classId: 'warrior', doctrine: 'a' }], registry);
    expect(got).toEqual(['sk.sword_arc', 'sk.crushing_blow', 'sk.heal_all', 'sk.gen.hit', 'sk.gen.metin_loop1.aqua']);
    expect(runSpecIds(skills, [{ classId: 'warrior', doctrine: 'b' }], registry)).toEqual(['sk.spirit_edge', 'sk.heal_all', 'sk.gen.hit', 'sk.gen.metin_loop1.aqua']);
  });

  it('a spec belongs to the skill whose vfx is its id minus trailing parts (sk.nightfall.cast)', () => {
    expect(runSpecIds(skills, [{ classId: 'yacha', doctrine: 'b' }], registry)).toContain('sk.nightfall.cast');
    expect(runSpecIds(skills, [{ classId: 'warrior', doctrine: 'a' }], registry)).not.toContain('sk.nightfall.cast');
  });

  it('co-op: the union of every hero; talent extra skills pull in their spec', () => {
    const got = runSpecIds(skills, [{ classId: 'warrior', doctrine: 'a' }, { classId: 'shaman', doctrine: 'a', extraSkills: ['nightfall'] }], registry);
    expect(got).toEqual(expect.arrayContaining(['sk.sword_arc', 'sk.fan', 'sk.nightfall', 'sk.nightfall.cast']));
    expect(got).not.toContain('sk.spirit_edge');
  });

  it('no loadouts = unknown run: every spec', () => {
    expect(runSpecIds(skills, [], registry)).toEqual(registry);
  });

  it('the dev demo specs (sk.__*) never enter a run, with or without a known loadout', () => {
    const dev = ['sk.__art_demo', 'sk.__art_demo_raw', 'sk.__art_sheets'];
    expect(dev.every(isDevSpec)).toBe(true);
    expect(isDevSpec('sk.gen.hit')).toBe(false);
    expect(isDevSpec('sk.nightfall')).toBe(false);
    const withDev = [...registry, ...dev];
    expect(runSpecIds(skills, [{ classId: 'warrior', doctrine: 'a' }], withDev)).toEqual(runSpecIds(skills, [{ classId: 'warrior', doctrine: 'a' }], registry));
    expect(runSpecIds(skills, [], withDev)).toEqual(registry);
  });

  it('sk.<skillId>[.part] belongs to that skill even before its vfx is switched (no cross-class leak)', () => {
    // `new_slash` / `new_bolt` are authored as sk.new_slash / sk.new_bolt but skills.json still points to old presets
    const content: ScopeSkill[] = [
      ...skills,
      { id: 'new_slash', classId: 'warrior', doctrine: 'a', vfx: 'melee.slash' },
      { id: 'new_bolt', classId: 'shaman', doctrine: 'a', vfx: null },
      { id: 'new_aura', classId: 'common', doctrine: null },
    ];
    const reg = [...registry, 'sk.new_slash', 'sk.new_slash.trail', 'sk.new_bolt', 'sk.new_bolt.hit', 'sk.new_aura', 'sk.unowned_thing'];
    const warrior = runSpecIds(content, [{ classId: 'warrior', doctrine: 'a' }], reg);
    expect(warrior).toEqual(expect.arrayContaining(['sk.new_slash', 'sk.new_slash.trail', 'sk.new_aura']));
    expect(warrior).not.toContain('sk.new_bolt');
    expect(warrior).not.toContain('sk.new_bolt.hit');
    const shaman = runSpecIds(content, [{ classId: 'shaman', doctrine: 'a' }], reg);
    expect(shaman).toEqual(expect.arrayContaining(['sk.new_bolt', 'sk.new_bolt.hit', 'sk.new_aura']));
    expect(shaman).not.toContain('sk.new_slash');
    // a spec no skill of the content owns stays common (always packed)
    expect(warrior).toContain('sk.unowned_thing');
    expect(shaman).toContain('sk.unowned_thing');
    // talent extra skills reach the implicit owner too
    expect(runSpecIds(content, [{ classId: 'warrior', doctrine: 'a', extraSkills: ['new_bolt'] }], reg)).toContain('sk.new_bolt.hit');
    // an explicit vfx claim wins over the id guess
    const claimed: ScopeSkill[] = [...content, { id: 'other', classId: 'ninja', doctrine: 'a', vfx: 'sk.new_slash' }];
    const w2 = runSpecIds(claimed, [{ classId: 'warrior', doctrine: 'a' }], reg);
    expect(w2).not.toContain('sk.new_slash');
    expect(runSpecIds(claimed, [{ classId: 'ninja', doctrine: 'a' }], reg)).toContain('sk.new_slash.trail');
  });

  it('real content: every class × doctrine scope is the same-class specs + common ones, never another class', () => {
    const rows = JSON.parse(readFileSync(new URL('../../data/content/skills.json', import.meta.url), 'utf8')) as (ScopeSkill & { classId: string })[];
    expect(PRESETS.length).toBeGreaterThan(0);
    const ids = SPEC_REGISTRY.map((s) => s.id).filter((id) => !isDevSpec(id));
    // owned = claimed by a skill's vfx (or id minus parts), or `sk.<skillId>[.part]` of a skill of the content
    const claimed = new Set(rows.flatMap((s) => [s.vfx, `sk.${s.id}`]));
    const owned = (id: string): boolean => [...claimed].some((c) => c && (id === c || id.startsWith(`${c}.`)));
    const common = ids.filter((id) => !owned(id));
    expect(common.length).toBeGreaterThan(20);
    for (const cls of ['warrior', 'ninja', 'yacha', 'shaman', 'wolfman']) {
      for (const doctrine of ['a', 'b']) {
        const got = new Set(runSpecIds(rows, [{ classId: cls, doctrine }], ids));
        for (const id of common) expect(got.has(id), `${cls}/${doctrine} keeps ${id}`).toBe(true);
        for (const s of rows) {
          const own = s.classId === 'common' || (s.classId === cls && s.doctrine === doctrine);
          // the spec of a skill is its vfx, else sk.<id> (authored before skills.json points to it)
          for (const spec of new Set([s.vfx, `sk.${s.id}`])) {
            if (!spec || !ids.includes(spec) || rows.some((o) => o !== s && o.vfx === spec)) continue;
            expect(got.has(spec), `${cls}/${doctrine} ${spec}`).toBe(own);
          }
        }
        expect(got.size).toBeLessThan(ids.length);
      }
    }
  });
});

// ------------------------------------------------------------------------------------------------ budget

describe('art VRAM budget', () => {
  it('counts a layer of 8 × 8 cells of 256 px as 21.3 MB with mips, like the README', () => {
    expect(artBytes(8, 1, 256) / MB).toBeCloseTo(21.33, 1);
    expect(artBytes(8, 5, 256) / MB).toBeCloseTo(106.67, 1);
    expect(artBytes(8, 5, 128) / MB).toBeCloseTo(26.67, 1);
  });

  it('keeps the tier cell when it fits and shrinks it in 16 px steps when it does not', () => {
    const high = ART_RUN_BUDGET_MB[2] * MB;
    expect(artCellFor({ grid: 8, layers: 1 }, 256, high)).toBe(256);
    const c2 = artCellFor({ grid: 8, layers: 2 }, 256, high);
    expect(c2).toBeLessThan(256);
    expect(c2 % 16).toBe(0);
    expect(artBytes(8, 2, c2)).toBeLessThanOrEqual(high);
    expect(artBytes(8, 2, c2 + 16)).toBeGreaterThan(high);
    expect(artCellFor({ grid: 8, layers: 3 }, 256, null)).toBe(256);
    // never below the floor, even for an absurd budget
    expect(artCellFor({ grid: 8, layers: 8 }, 256, 1)).toBe(ART_MIN_CELL_PX);
  });

  // WHY THIS IS NOT "every sprite of the manifest at once": that sum (one key per manifest sprite, the old "worst case: all 261")
  // is no scene the game or a tool ever bakes. A run packs the art keys of the specs its heroes can spawn (artScope.ts
  // runSpecIds), the galleries the keys of every registered spec; the manifest also holds every sprite ever shipped for specs
  // that do not exist yet (the skill scale-out wires them class by class), so its size grows with each sprite batch (261 ->
  // 465 in a week) while no run changes. On 2026-10-22 that sum needed 515-542 cells for the 512 of a full array while no run lost a sprite.
  // What can really overflow, and what the assertions below pin, is the largest scope a run can have (every class x doctrine, every
  // party of up to MAX_PLAYERS heroes, the unknown-run fallback) and the gallery scope (every key of every spec). The budget
  // numbers are untouched: the cell shrinks to them, it never exceeds them.

  /** the real registry on a real SpecHost (so key sets and sheet hints are the loader's own), plus the manifest as an art source */
  function realWorld(): { h: SpecHost; src: ArtSource } {
    const { r } = fakeRenderer();
    const fx = { time: 0, rng: new VRng(7), density: 1, budget: 1e9, spawned: 0, dropped: 0, heightAt: () => 0 } as unknown as Fx;
    const h = new SpecHost(new Scene(), r, { value: 0 }, fx, 2, 10, SPEC_REGISTRY);
    const man = JSON.parse(readFileSync(new URL('../../../public/assets/manifest/textures.json', import.meta.url), 'utf8')) as Record<string, { kind?: string; w: number; h: number; alpha?: boolean }>;
    const textures = Object.fromEntries(Object.entries(man).filter(([, e]) => e.kind === 'vfx'));
    return { h, src: { hasTexture: (id) => id in textures, loadTexture: () => Promise.resolve(new Texture()), manifest: { textures } } };
  }

  /** every combination of 1..n items (in order, no repeats) */
  function combos<T>(items: readonly T[], n: number): T[][] {
    if (n === 0) return [[]];
    return items.flatMap((x, i) => combos(items.slice(i + 1), n - 1).map((rest) => [x, ...rest]));
  }

  it('the gallery scope (every key of every registered spec, full cells) places everything', async () => {
    const { h, src } = realWorld();
    await h.preloadArt(src);
    const st = h.art.stats;
    expect(h.artIds.size).toBeGreaterThan(100);
    // a spec that names a sprite the manifest does not ship is a bug of its own (the element keeps its fallback): say which
    expect([...h.artIds].flatMap(artParts).filter((id) => !src.hasTexture(id)), 'art ids of registered specs missing from the manifest').toEqual([]);
    expect(st.dropped, 'keys without a cell').toBe(0);
    expect(st.sprites).toBe(h.artIds.size);
    expect(st.layers).toBeLessThanOrEqual(ART_MAX_LAYERS);
    expect(st.cell).toBe(256);
  });

  it('the largest scope of a real run fits every tier budget: all class x doctrine scopes, every party of up to MAX_PLAYERS heroes', async () => {
    const { h, src } = realWorld();
    await h.preloadArt(src); // gallery scope first: it gives every key its footprint (hints and sheet frames applied) through its packed role
    const grid = h.art.grid;
    const foot = new Map<string, ArtFootprint>();
    for (const key of h.artIds) {
      const role = h.art.peek(key);
      if (!role) continue;
      const d = artRect(role.packed, 0, grid);
      foot.set(key, { id: key, cw: Math.round(d.du * d.cells), ch: Math.round(d.dv * d.cells), frames: role.frames, cols: 1, rows: 1 });
    }
    expect(foot.size).toBe(h.artIds.size);
    const rows = JSON.parse(readFileSync(new URL('../../data/content/skills.json', import.meta.url), 'utf8')) as (ScopeSkill & { classId: string })[];
    const classIds = [...new Set(rows.map((s) => s.classId))].filter((c) => c !== 'common');
    expect(classIds.length).toBeGreaterThanOrEqual(5);
    const heroes = classIds.flatMap((classId) => ['a', 'b'].map((doctrine) => ({ classId, doctrine })));
    const specIds = SPEC_REGISTRY.map((s) => s.id);
    const scopes: { label: string; loadouts: { classId: string; doctrine: string }[] }[] = [{ label: 'unknown run (no loadouts)', loadouts: [] }];
    // two heroes of one class with both doctrines count: the union is what a party can bring, whatever its classes
    for (let n = 1; n <= MAX_PLAYERS; n++) for (const c of combos(heroes, n)) scopes.push({ label: c.map((x) => `${x.classId}/${x.doctrine}`).join(' + '), loadouts: c });
    expect(scopes.length).toBeGreaterThanOrEqual(1 + 10 + 45 + 120 + 210); // 5 classes x 2 doctrines: every party of 1-4 pairs
    let worst = { label: '', cells: 0, layers: 0, scope: [] as string[] };
    for (const sc of scopes) {
      const scope = runSpecIds(rows, sc.loadouts, specIds);
      const keys = new Set<string>();
      for (const id of scope) for (const k of h.artOf(id)) keys.add(k);
      const fps = [...keys].map((k) => foot.get(k) as ArtFootprint);
      const layout = packArt(fps);
      expect(layout.place.size, `${sc.label}: keys without a cell`).toBe(fps.length);
      expect(layout.layers, sc.label).toBeLessThanOrEqual(ART_MAX_LAYERS);
      const cells = fps.reduce((n, f) => n + f.cw * f.ch * f.frames, 0);
      expect(cells, sc.label).toBeLessThanOrEqual(ART_MAX_CELLS);
      for (const tier of [0, 1, 2, 3] as TierIdx[]) {
        const budget = (ART_RUN_BUDGET_MB[tier] as number) * MB;
        const cell = artCellFor(layout, ART_CELL_PX[tier], budget);
        expect(artBytes(layout.grid, layout.layers, cell), `${sc.label} tier ${tier} cell ${cell}`).toBeLessThanOrEqual(budget);
        expect(cell, `${sc.label} tier ${tier}`).toBeGreaterThanOrEqual(ART_MIN_CELL_PX);
      }
      if (cells > worst.cells) worst = { label: sc.label, cells, layers: layout.layers, scope };
    }
    expect(worst.cells).toBeGreaterThan(100);
    // the real loader agrees with the pure numbers on the worst scope: one baked array, nothing dropped, the budget respected
    await h.preloadArt(src, worst.scope);
    const st = h.art.stats;
    expect(st.layers, worst.label).toBe(worst.layers);
    expect(st.dropped, worst.label).toBe(0);
    expect(st.pending, worst.label).toBe(0);
    expect(st.bytes, worst.label).toBeLessThanOrEqual(ART_RUN_BUDGET_MB[2] * MB);
    expect(st.cell, worst.label).toBeGreaterThanOrEqual(ART_MIN_CELL_PX);
    // and the array is valid: every frame of every key sits in cells of its own (decoded back from the packed role like the shaders do)
    const keys = new Set([...worst.scope].flatMap((id) => [...h.artOf(id)]));
    const used = new Set<string>();
    let needed = 0;
    for (const key of keys) {
      const role = h.art.peek(key);
      expect(role, key).not.toBeNull();
      const f = foot.get(key) as ArtFootprint;
      expect(role?.frames, key).toBe(f.frames);
      needed += f.cw * f.ch * f.frames;
      for (let fr = 0; fr < f.frames; fr++) {
        const d = artRect(role?.packed as number, fr, h.art.grid);
        const col = Math.round(d.u0 * d.cells);
        const row = Math.round((1 - d.v0 - d.dv) * d.cells);
        expect([Math.round(d.du * d.cells), Math.round(d.dv * d.cells)], key).toEqual([f.cw, f.ch]);
        expect(col >= 0 && row >= 0 && col + f.cw <= d.cells && row + f.ch <= d.cells && d.layer < st.layers, `${key} frame ${fr} inside the array`).toBe(true);
        for (let dy = 0; dy < f.ch; dy++) for (let dx = 0; dx < f.cw; dx++) used.add(`${d.layer}:${row + dy}:${col + dx}`);
      }
    }
    expect(used.size, 'no two keys (or frames) share a cell').toBe(needed);
  });

  it('a run packs the ambient art of its zone only: the real worst solo run and the worst party of four, per zone loop (budget re-pinned for the live S4 families)', async () => {
    const { h, src } = realWorld();
    await h.preloadArt(src);
    const grid = h.art.grid;
    const foot = new Map<string, ArtFootprint>();
    for (const key of h.artIds) {
      const role = h.art.peek(key);
      if (!role) continue;
      const d = artRect(role.packed, 0, grid);
      foot.set(key, { id: key, cw: Math.round(d.du * d.cells), ch: Math.round(d.dv * d.cells), frames: role.frames, cols: 1, rows: 1 });
    }
    const rows = JSON.parse(readFileSync(new URL('../../data/content/skills.json', import.meta.url), 'utf8')) as (ScopeSkill & { classId: string })[];
    const heroes = [...new Set(rows.map((s) => s.classId))].filter((c) => c !== 'common').flatMap((classId) => ['a', 'b'].map((doctrine) => ({ classId, doctrine })));
    const specIds = SPEC_REGISTRY.map((s) => s.id);
    const measure = (loadouts: { classId: string; doctrine: string }[], zone?: { ambient: string }): { cells: number; layers: number; cell: number; keys: Set<string> } => {
      const keys = new Set<string>();
      for (const id of runSpecIds(rows, loadouts, specIds, zone)) for (const k of h.artOf(id)) keys.add(k);
      const fps = [...keys].map((k) => foot.get(k) as ArtFootprint);
      const layout = packArt(fps);
      expect(layout.place.size, `${loadouts.map((x) => x.classId + '/' + x.doctrine).join('+')} ${zone?.ambient}: keys without a cell`).toBe(fps.length);
      return { cells: fps.reduce((n, f) => n + f.cw * f.ch * f.frames, 0), layers: layout.layers, cell: artCellFor(layout, ART_CELL_PX[2], ART_RUN_BUDGET_MB[2] * MB), keys };
    };
    // the zones of the game: three looks switched the ambient loop off (zone looks, render/terrain/look/*.ts), daeryeol keeps its embers
    const looks: Record<string, { ambient: string }> = { none: { ambient: '' }, embers: { ambient: 'embers' } };
    const worstOf = (n: number, zone?: { ambient: string }): { cells: number; layers: number; cell: number } => {
      let worst = { cells: 0, layers: 0, cell: 0 };
      for (const c of combos(heroes, n)) {
        const m = measure(c, zone);
        if (m.cells > worst.cells) worst = { cells: m.cells, layers: m.layers, cell: m.cell };
      }
      return worst;
    };
    const plain1 = worstOf(1);
    const plain4 = worstOf(4);
    for (const [name, zone] of Object.entries(looks)) {
      for (const hero of heroes) {
        const was = measure([hero]);
        const now = measure([hero], zone);
        // every key of the pruned scope is in the old one, the run lost the other loops' sprites (>= 14 cells with embers kept, 18+ with no loop)
        for (const k of now.keys) expect(was.keys.has(k), `${name} ${hero.classId}/${hero.doctrine} ${k}`).toBe(true);
        
        expect(was.cells - now.cells, `${name} ${hero.classId}/${hero.doctrine} cells saved`).toBeGreaterThanOrEqual(name === 'none' ? 17 : 13);
        expect(now.layers).toBeLessThanOrEqual(was.layers);
      }
      // the real worst cases of today, pinned with a little headroom for sprite batches, and the zone-pruned scopes are never bigger than the unpruned ones.
      // RE-PINNED 2026-10-27 (s4-flip, lead decision: the S4 skill families that won the blind critic and passed the in-game gate go live; the second atlas page
      // exists for this growth): 46 generated families are live now (was 5), so a hero's scope holds their sprites instead of the hand specs'. Measured on the final
      
      // of four 316 / 320 cells (warrior/b+yacha/a+shaman/a+shaman/b), both 5 layers = 128 px cells at high (low 80, medium 112); before: solo 210 / 214, party 227 / 231,
      // 4 layers, 144 px. The budgets hold: 26.7 MB at high (tier budget 32), every tier keeps >= ART_MIN_CELL_PX (the 'largest scope' test above), every scope places all its keys.
      const solo = worstOf(1, zone);
      const party = worstOf(4, zone);
      expect(solo.cells, `${name} worst solo`).toBeLessThan(plain1.cells);
      expect(party.cells, `${name} worst party of four`).toBeLessThan(plain4.cells);
      expect(solo.cells, `${name} worst solo`).toBeLessThanOrEqual(name === 'none' ? 263 : 267);
      expect(party.cells, `${name} worst party of four`).toBeLessThanOrEqual(name === 'none' ? 318 : 322);
      expect(solo.layers).toBeLessThanOrEqual(5);
      expect(party.layers).toBeLessThanOrEqual(5);
      expect(solo.cell).toBeGreaterThanOrEqual(128);
      expect(party.cell).toBeGreaterThanOrEqual(128);
    }
  });

  it('packArt: ranks only matter once the scope exceeds the array, and then the highest ranks lose their cell', () => {
    // fits: the layout is the size order's whatever the ranks say
    const fits = Array.from({ length: 150 }, (_, i) => artFootprint(`k${String(i).padStart(3, '0')}`, i % 7 === 0 ? 512 : 256, i % 11 === 0 ? 512 : 256));
    const plain = packArt(fits);
    const ranked = packArt(fits.map((f, i) => ({ ...f, rank: (i * 5) % 3 })));
    expect(ranked.layers).toBe(plain.layers);
    expect([...ranked.place.entries()]).toEqual([...plain.place.entries()]);
    // exceeds: 40 one-cell keys too many; the ids are not the order, the ranks are (rank 0 = needed first)
    const n = ART_MAX_CELLS + 40;
    const many = Array.from({ length: n }, (_, i) => ({ ...artFootprint(`k${String((i * 37) % n).padStart(4, '0')}`, 256, 256), rank: i }));
    const lay = packArt(many);
    expect(lay.place.size).toBe(ART_MAX_CELLS);
    expect(lay.layers).toBe(ART_MAX_LAYERS);
    for (const f of many) expect(lay.place.has(f.id), `rank ${f.rank}`).toBe((f.rank as number) < ART_MAX_CELLS);
    // equal ranks keep the deterministic size order of the old packer (the ids decide), so unranked scopes behave as before
    const flat = packArt(many.map((f) => ({ ...f, rank: undefined })));
    const keep = [...flat.place.keys()].sort();
    expect(keep).toEqual(many.map((f) => f.id).sort().slice(0, ART_MAX_CELLS));
    // a tall run of rank 0 keeps its cells and the lower-ranked one-cell keys fill every hole around it (a shelf packer lost 20 cells behind it)
    const tall = { ...artFootprint('tall', 128, 512), rank: 0 };
    const one = Array.from({ length: ART_MAX_CELLS - 3 }, (_, i) => ({ ...artFootprint(`o${String(i).padStart(3, '0')}`, 256, 256), rank: 1 }));
    const mixed = packArt([tall, ...one]);
    expect(mixed.place.has('tall')).toBe(true);
    expect(mixed.place.size).toBeGreaterThanOrEqual(ART_MAX_CELLS - 4);
  });
});

// ------------------------------------------------------------------------------------------------ bake (faked GPU)

describe('SpecArt bake', () => {
  it('bakes a frame list into consecutive cells, frame f from sprite f', async () => {
    const { r, drawn } = fakeRenderer();
    const { src, tex } = fakeSource({}, 4);
    const art = new SpecArt(r, 2);
    const key = artKey(['s0', 's1', 's2']);
    art.hint({ art: ['s0', 's1', 's2'] });
    expect(await art.preload(src, [key])).toBe(true);
    const role = art.role(key);
    expect(role?.frames).toBe(3);
    // 3 single-cell frames in a run wider than the 2 × 2 grid: two bands, the third frame wraps to the second row
    expect(art.grid).toBe(2);
    expect(art.stats.layers).toBe(1);
    expect(drawn).toHaveLength(1);
    const meshes = (drawn[0] as Drawn).meshes;
    expect(meshes).toHaveLength(3);
    const cellOf = (pos: number[]): [number, number] => [Math.round(((Math.min(pos[0] as number, pos[3] as number) + 1) / 2) * 2), Math.round(((1 - Math.max(pos[1] as number, pos[7] as number)) / 2) * 2)];
    const cells = meshes.map((m) => cellOf(m.pos));
    expect(cells).toEqual([[0, 0], [1, 0], [0, 1]]);
    meshes.forEach((m, f) => {
      expect(m.map).toBe(tex.get(`s${f}`));
      // each frame shows its whole sprite inside its run, a gutter all round (the corners of the image's place read the corners of the sprite)
      innerUv(m, 2).forEach((v, i) => expect(v).toBeCloseTo([0, 0, 1, 0, 0, 1, 1, 1][i] as number, 5));
      // and the gutter repeats the sprite's edge: the quad's own uv runs past the sprite, the clamp box is the sprite less half a source texel (256 px)
      expect(m.uv[0]).toBeLessThan(0);
      expect(m.uv[7]).toBeGreaterThan(1);
      for (let v = 0; v < 4; v++) expect(m.box.slice(v * 4, v * 4 + 4)).toEqual([0.5 / 256, 0.5 / 256, 1 - 0.5 / 256, 1 - 0.5 / 256].map((x) => Math.fround(x)));
    });
    // a frame hint shorter than the list uses the first n sprites
    const second = new SpecArt(fakeRenderer().r, 2);
    second.hint({ art: ['s0', 's1', 's2', 's3'], frames: 2 });
    await second.preload(src, [artKey(['s0', 's1', 's2', 's3'])]);
    expect(second.role(artKey(['s0', 's1', 's2', 's3']))?.frames).toBe(2);
  });

  it('keeps a plain sheet image working: one mesh, frames cut from its grid', async () => {
    const { r, drawn } = fakeRenderer();
    const { src } = fakeSource({ sheet: { w: 512, h: 512 } });
    const art = new SpecArt(r, 2);
    art.hint({ art: 'sheet', grid: [2, 2] });
    await art.preload(src, ['sheet']);
    expect(art.role('sheet')?.frames).toBe(4);
    const meshes = (drawn[0] as Drawn).meshes;
    expect(meshes).toHaveLength(1);
    // frame 0 reads the sheet's top-left quarter (its place inside the run, a gutter all round), the gutter repeats THAT frame's edge (the clamp box stays inside the quarter)
    innerUv(meshes[0] as never, 2).forEach((v, i) => expect(v).toBeCloseTo([0, 0.5, 0.5, 0.5, 0, 1, 0.5, 1][i] as number, 5));
    const box = meshes[0]?.box.slice(0, 4) as number[];
    expect(box[0]).toBeCloseTo(0.5 / 512, 6);
    expect(box[2]).toBeCloseTo(0.5 - 0.5 / 512, 6);
    expect(box[1]).toBeCloseTo(0.5 + 0.5 / 512, 6);
    expect(box[3]).toBeCloseTo(1 - 0.5 / 512, 6);
  });

  it('a frame list with a missing sprite draws the fallback as a whole and warns once', async () => {
    const { r } = fakeRenderer();
    const { src } = fakeSource({}, 2);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const art = new SpecArt(r, 2);
    const key = artKey(['s0', 's1', 'nope']);
    await art.preload(src, [key, 's0']);
    await art.preload(src, [key]);
    expect(art.role(key)).toBeNull();
    expect(art.isMissing(key)).toBe(true);
    expect(art.role('s0')).not.toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('nope');
    warn.mockRestore();
  });

  it('a run scope replaces the previous run: other sprites leave the array, loaded ones are not fetched twice', async () => {
    const { r } = fakeRenderer();
    const { src, loaded } = fakeSource({}, 6);
    const art = new SpecArt(r, 2);
    art.setBudget(ART_RUN_BUDGET_MB);
    await art.preload(src, ['s0', 's1', 's2'], true);
    expect(art.role('s2')).not.toBeNull();
    const v = art.version;
    await art.preload(src, ['s1', 's3'], true);
    expect(art.role('s0')).toBeNull();
    expect(art.role('s2')).toBeNull();
    expect(art.role('s1')).not.toBeNull();
    expect(art.role('s3')).not.toBeNull();
    expect(art.version).toBeGreaterThan(v);
    expect(loaded.filter((id) => id === 's1')).toHaveLength(1);
    // the same scope again: nothing changed, no re-bake
    const v2 = art.version;
    expect(await art.preload(src, ['s1', 's3'], true)).toBe(false);
    expect(art.version).toBe(v2);
    // additive load keeps the scope
    await art.preload(src, ['s5']);
    expect(art.role('s1')).not.toBeNull();
    expect(art.role('s5')).not.toBeNull();
    // an empty scope releases the array
    await art.preload(src, [], true);
    expect(art.stats.bytes).toBe(0);
    expect(art.role('s1')).toBeNull();
  });

  it('shrinks the cell to the tier budget and re-fits on a tier change', async () => {
    const { r } = fakeRenderer();
    const { src } = fakeSource({}, 130);
    const keys = Array.from({ length: 130 }, (_, i) => `s${i}`);
    // gallery / tools: no budget, full cells (3 layers of 8 × 8 at 256 px = 64 MB)
    const full = new SpecArt(r, 2);
    await full.preload(src, keys);
    expect(full.stats.layers).toBe(3);
    expect(full.stats.cell).toBe(256);
    expect(full.stats.bytes / MB).toBeCloseTo(64, 0);
    // a run on high: shrunk to fit 32 MB
    const art = new SpecArt(r, 2);
    art.setBudget(ART_RUN_BUDGET_MB);
    await art.preload(src, keys, true);
    expect(art.stats.layers).toBe(3);
    expect(art.stats.cell).toBeLessThan(256);
    expect(art.stats.bytes).toBeLessThanOrEqual(32 * MB);
    expect(art.stats.size).toBe(art.stats.cell * 8);
    expect(art.role('s129')).not.toBeNull();
    // the settings menu drops the quality to low: 12 MB
    const v = art.version;
    art.setTier(0);
    expect(art.version).toBeGreaterThan(v);
    expect(art.stats.bytes).toBeLessThanOrEqual(12 * MB);
    expect(art.stats.cell).toBeLessThan(128);
    // and back up
    art.setTier(2);
    expect(art.stats.bytes).toBeLessThanOrEqual(32 * MB);
    expect(art.stats.cell).toBeGreaterThan(112);
  });

  it('a staged scope past the capacity of the array keeps its NOW keys and the keys it streams first; the last of the stream lose their cell', async () => {
    const { r } = fakeRenderer();
    const n = ART_MAX_CELLS + 40;
    const { src } = fakeSource({}, n);
    const singles = Array.from({ length: n }, (_, i) => `s${i}`);
    const sheet = artKey(['s0', 's1']);
    const keys = [...singles, sheet];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const art = new SpecArt(r, 2);
    art.setBudget(ART_RUN_BUDGET_MB);
    // the plan lists the keys back to front and the frame list last: its order (NOW first, then the stream), not the ids' or the scope's, says who is needed
    const order = [...singles].reverse().concat(sheet);
    const plan: ArtPlan = { now: new Set(order.slice(0, 5)), later: order.slice(5), after: 8.5 };
    await art.preload(src, keys, true, plan);
    // 552 one-cell keys + a 2-cell frame list = 554 cells for 512: the frame list and the last 40 keys of the plan have no cell
    expect(art.stats.dropped).toBe(41);
    expect(art.stats.sprites + art.stats.pending).toBe(ART_MAX_CELLS);
    for (const k of order.slice(0, ART_MAX_CELLS)) expect(art.isMissing(k), k).toBe(false);
    for (const k of order.slice(ART_MAX_CELLS)) expect(art.isMissing(k), k).toBe(true);
    // the awaited keys are in the array already
    for (const k of order.slice(0, 5)) expect(art.role(k), k).not.toBeNull();
    expect(warn).toHaveBeenCalledTimes(41);
    warn.mockRestore();
    // another preload (a late spec) does not re-lay out the array for keys that are known to have no cell
    const v = art.version;
    await art.preload(src, ['s0']);
    expect(art.version).toBe(v);
    // a scope that fits reports nothing dropped
    const small = new SpecArt(r, 2);
    await small.preload(src, singles.slice(0, 30), true, { now: new Set(singles.slice(0, 3)), later: singles.slice(3, 30), after: 8.5 });
    expect(small.stats.dropped).toBe(0);
  });
});

// ------------------------------------------------------------------------------------------------ host (scope + late load)

function host(): { h: SpecHost; fx: Fx; drawn: Drawn[] } {
  const { r, drawn } = fakeRenderer();
  const fx = { time: 0, rng: new VRng(7), density: 1, budget: 1e9, spawned: 0, dropped: 0, heightAt: () => 0 } as unknown as Fx;
  return { h: new SpecHost(new Scene(), r, { value: 0 }, fx, 2, 10, []), fx, drawn };
}

const puff = (art: ParticleSpec['tex']): ElementSpec => ({ kind: 'particle', cycle: 0.5, max: 4, rate: [0, 120], life: [0, 1], half: [0, 0.3], color: [0, 0xffffff, 1], billboard: 'screen', blend: 'add', tex: art });
const spec = (id: string, elements: ElementSpec[], impact?: ElementSpec[]): FxSpec => ({ id, desc: id, behavior: 'selfBuff', ref: { family: 'test' }, size: 'radius', base: 2, dur: 1, elements, impact });

describe('SpecHost art scope', () => {
  it('collects the art keys per spec (impact and grade variants included), frame lists as one key', () => {
    const { h } = host();
    const list = ['s0', 's1', 's2'];
    h.play(spec('sk.a', [puff({ art: 's5' }), puff({ art: list, fallback: 'spark' })], [puff({ art: 's6' })]), new Ctx(), false);
    h.play(spec('sk.b', [{ ...puff('glow'), grade: { g2: { tex: { art: 's7' } } } } as ElementSpec]), new Ctx(), false);
    h.play(spec('sk.c', [puff('glow')]), new Ctx(), false);
    expect([...h.artOf('sk.a')].sort()).toEqual([artKey(list), 's5', 's6'].sort());
    expect([...h.artOf('sk.b')]).toEqual(['s7']);
    expect(h.artOf('sk.c').size).toBe(0);
    expect(h.artOf('sk.unknown').size).toBe(0);
    expect(h.artIds.has(artKey(list))).toBe(true);
  });

  it('a run loads only the art of its specs; no scope loads everything', async () => {
    const { h } = host();
    const { src, loaded } = fakeSource({}, 8);
    // compile three specs (play compiles on first use)
    for (const s of [spec('sk.a', [puff({ art: 's0' })]), spec('sk.b', [puff({ art: 's1' }), puff({ art: ['s2', 's3'] })]), spec('sk.c', [puff({ art: 's4' })])]) h.play(s, new Ctx(), false);
    await h.preloadArt(src, ['sk.a', 'sk.b', 'sk.gen.none']);
    expect([...loaded].sort()).toEqual(['s0', 's1', 's2', 's3']);
    expect(h.art.role('s0')).not.toBeNull();
    expect(h.art.role('s4')).toBeNull();
    expect(h.art.stats.bytes).toBeLessThanOrEqual(ART_RUN_BUDGET_MB[2] * MB);
    // the gallery: everything, unbudgeted
    await h.preloadArt(src);
    expect(h.art.role('s4')).not.toBeNull();
    expect(h.art.stats.cell).toBe(256);
  });

  it('a spec outside the scope loads its art late, once, and draws it afterwards', async () => {
    const { h, fx } = host();
    const { src, loaded } = fakeSource({}, 4);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const a = spec('sk.a', [puff({ art: 's0', fallback: 'spark' })]);
    const b = spec('sk.b', [puff({ art: 's1', fallback: 'spark' })]);
    h.play(a, new Ctx(), false);
    h.play(b, new Ctx(), false);
    await h.preloadArt(src, ['sk.a']);
    expect(loaded).toEqual(['s0']);
    h.play(b, new Ctx(), false);
    h.play(b, new Ctx(), false);
    expect(info).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0]?.[0])).toContain('sk.b');
    await new Promise((res) => setTimeout(res, 0));
    expect(loaded).toEqual(['s0', 's1']);
    expect(h.art.role('s1')).not.toBeNull();
    // s0 stayed: late loads add to the scope
    expect(h.art.role('s0')).not.toBeNull();
    info.mockRestore();
    expect(fx.time).toBe(0);
  });
});

// ------------------------------------------------------------------------------------------------ named sheets (ART_SHEETS)

describe('ART_SHEETS (flipbooks made of separate sprites)', () => {
  const man = JSON.parse(readFileSync(new URL('../../../public/assets/manifest/textures.json', import.meta.url), 'utf8')) as Record<string, { kind?: string; w: number; h: number }>;
  const names = Object.keys(ART_SHEETS) as ArtSheetName[];
  const pools: readonly string[] = ART_SHEET_POOLS;

  it('every frame ships as a vfx sprite, with the aspect of its first frame, and the list is a usable art key', () => {
    expect(names.length).toBeGreaterThanOrEqual(8);
    for (const n of names) {
      const ids = ART_SHEETS[n];
      expect(ids.length, n).toBeGreaterThanOrEqual(2);
      expect(ids.length, n).toBeLessThanOrEqual(32);
      expect(new Set(ids).size, `${n} repeats a frame`).toBe(ids.length);
      expect(artOk(ids), n).toBe(true);
      const first = man[ids[0] as string];
      for (const id of ids) {
        const e = man[id];
        expect(e?.kind, `${n}: ${id}`).toBe('vfx');
        expect(e && Math.abs(e.w / e.h - (first as { w: number; h: number }).w / (first as { w: number; h: number }).h) < 0.01, `${n}: ${id} aspect`).toBe(true);
      }
    }
  });

  it('declared pools are a subset of ART_SHEETS and blow sequences draw from boltBlowH', () => {
    for (const p of pools) expect(names, p).toContain(p);
    for (const n of ['boltBlowBodyH', 'boltBlowTwinH', 'boltBlowWeaponH'] as const) {
      for (const id of ART_SHEETS[n]) expect(ART_SHEETS.boltBlowH as readonly string[], `${n} ${id}`).toContain(id);
    }
  });

  it('ART_SHEET_PLAY configures every declared sheet with a valid mode and positive fps for cut sheets', () => {
    expect(Object.keys(ART_SHEET_PLAY).sort()).toEqual([...names].sort());
    for (const n of names) {
      const play = ART_SHEET_PLAY[n];
      expect(['cut', 'random']).toContain(play.mode);
      if (play.mode === 'cut') expect(play.fps, n).toBeGreaterThan(0);
    }
  });

  it('packs as one flipbook run of `frames` cells, all sheets together in one layer', async () => {
    const extra: Record<string, { w: number; h: number }> = {};
    for (const n of names) for (const id of ART_SHEETS[n]) extra[id] = { w: (man[id] as { w: number }).w, h: (man[id] as { h: number }).h };
    const { src, loaded } = fakeSource(extra);
    const art = new SpecArt(fakeRenderer().r, 2);
    art.setBudget(ART_RUN_BUDGET_MB);
    const keys = names.map((n) => artKey(ART_SHEETS[n]));
    expect(new Set(keys).size).toBe(names.length);
    await art.preload(src, keys, true);
    names.forEach((n, i) => expect(art.role(keys[i] as string)?.frames, n).toBe(ART_SHEETS[n].length));
    expect(art.stats.layers).toBe(1);
    expect(art.stats.sprites).toBe(names.length);
    expect(art.stats.bytes).toBeLessThanOrEqual(ART_RUN_BUDGET_MB[2] * MB);
    // every frame sprite was fetched exactly once (sheets share sprites)
    expect([...loaded].sort()).toEqual([...new Set(names.flatMap((n) => [...ART_SHEETS[n]]))].sort());
  });

  it('the dev demo spec carries one list per sheet into the run scope and shows every frame mode', () => {
    const { h } = host();
    h.play(ART_SHEETS_DEMO, new Ctx(), false);
    expect([...h.artOf('sk.__art_sheets')].sort()).toEqual(names.map((n) => artKey(ART_SHEETS[n])).sort());
    const modes = new Set(ART_SHEETS_DEMO.elements.map((e) => (e as ParticleSpec).frames?.mode ?? 'default'));
    expect([...modes].sort()).toEqual(['blend', 'cut', 'default', 'random']);
  });

  it('no demo sheet hides behind the gallery body (the column x = 0) and no two share a place', () => {
    for (const e of ART_SHEETS_DEMO.elements) expect(Math.abs((e as ParticleSpec).at?.[0] ?? 0), (e as ParticleSpec).note).toBeGreaterThan(0.6);
    const places = ART_SHEETS_DEMO.elements.map((e) => `${(e as ParticleSpec).at?.[0]},${(e as ParticleSpec).at?.[1]}`);
    expect(new Set(places).size).toBe(places.length);
  });

  it('the dev demo specs are excluded from every run scope', () => {
    const ids = [ART_DEMO.id, ART_DEMO_RAW.id, ART_SHEETS_DEMO.id, 'sk.gen.hit'];
    expect(runSpecIds([], [{ classId: 'warrior', doctrine: 'a' }], ids)).toEqual(['sk.gen.hit']);
  });
});

// ------------------------------------------------------------------------------------------------ flipbook frame modes

describe('flipbook frame modes (hard-cut flipbook frames)', () => {
  const FRAMES = 6;
  const FPS = 8;

  it('generated art cuts by default, procedural flipbooks keep their cross-fade, an explicit mode wins', () => {
    expect(frameModeBits(undefined, true)).toBe(1);
    expect(frameModeBits(undefined, false)).toBe(0);
    expect(frameModeBits('blend', true)).toBe(0);
    expect(frameModeBits('cut', false)).toBe(1);
    expect(frameModeBits('random', true)).toBe(2);
    expect(frameModeBits('random', false)).toBe(2);
  });

  it('cut: the frame index moves in whole steps and two frames are never mixed', () => {
    for (let k = 0; k < 400; k++) {
      const t = k * 0.0137;
      const [a, b, m] = flipFrame(FRAMES, 1, FPS, t, 0, 0);
      expect(m, `t ${t}`).toBe(0);
      expect(b).toBe(a);
      expect(a).toBe(Math.floor(t * FPS) % FRAMES);
    }
    // the cut lands exactly on the step: the frame before and after differ by one whole frame
    expect(flipFrame(FRAMES, 1, FPS, 0.1249, 0, 0)[0]).toBe(0);
    expect(flipFrame(FRAMES, 1, FPS, 0.1251, 0, 0)[0]).toBe(1);
    // random start frame (random: true): the cycle starts there, still whole frames
    expect(flipFrame(FRAMES, 1, FPS, 0.05, 0, 4)[0]).toBe(4);
    expect(flipFrame(FRAMES, 1, FPS, 0.15, 0, 4)[0]).toBe(5);
    expect(flipFrame(FRAMES, 1, FPS, 0.3, 0, 4)[0]).toBe(0);
    // fps 0: once over the life, clamped to the last frame
    expect(flipFrame(FRAMES, 1, 0, 0, 0.5, 0)).toEqual([3, 3, 0]);
    expect(flipFrame(FRAMES, 1, 0, 0, 1, 0)).toEqual([5, 5, 0]);
  });

  it('blend (procedural flipbooks): frame f cross-fades into f + 1, unchanged', () => {
    const [a, b, m] = flipFrame(FRAMES, 0, FPS, 0.0625, 0, 0);
    expect([a, b]).toEqual([0, 1]);
    expect(m).toBeCloseTo(0.5, 6);
    expect(flipFrame(FRAMES, 0, FPS, 5.5 / FPS, 0, 0)[1]).toBe(0);
    expect(flipFrame(FRAMES, 0, 0, 0, 0.25, 0)).toEqual([1, 2, 0.5]);
  });

  it('random: a NEW random frame at every step (hard cut, repeats possible), a different stream per particle', () => {
    const seq = (seed: number): number[] => Array.from({ length: 600 }, (_, k) => flipFrame(FRAMES, 2, FPS, (k + 0.5) / FPS, 0, seed)[0]);
    const a = seq(11);
    const counts = new Array<number>(FRAMES).fill(0);
    for (const f of a) counts[f] = (counts[f] as number) + 1;
    // every frame is drawn, none dominates (600 draws of 6: 100 each, wide margin)
    for (const c of counts) {
      expect(c).toBeGreaterThan(60);
      expect(c).toBeLessThan(140);
    }
    // not the sequential walk of cut mode
    expect(a.filter((f, k) => f === k % FRAMES).length).toBeLessThan(a.length * 0.4);
    // an independent draw per step: repeats of the previous frame happen (random_range(0, count - 1))
    expect(a.filter((f, k) => k > 0 && f === a[k - 1]).length).toBeGreaterThan(40);
    // another particle (seed) does not flicker in lockstep
    const b = seq(12345);
    expect(a.filter((f, k) => f === b[k]).length).toBeLessThan(a.length * 0.4);
    // whole frames only, constant inside a step
    for (let k = 0; k < 50; k++) {
      const t = k / FPS;
      const first = flipFrame(FRAMES, 2, FPS, t + 0.001, 0, 11);
      const last = flipFrame(FRAMES, 2, FPS, t + 1 / FPS - 0.001, 0, 11);
      expect(first).toEqual(last);
      expect(first[2]).toBe(0);
      expect(first[1]).toBe(first[0]);
    }
    // fps 0: one step per frame over the life
    const life = Array.from({ length: FRAMES }, (_, k) => flipFrame(FRAMES, 2, 0, 0, (k + 0.5) / FRAMES, 7)[0]);
    expect(life.every((f) => f >= 0 && f < FRAMES && Number.isInteger(f))).toBe(true);
  });
});

describe('SpecHost flipbook records', () => {
  const LIST = ['s0', 's1', 's2', 's3'];
  type Rec = Float32Array;
  type Ring = { f: Float32Array; endT: Float32Array; used: number };
  const live = (h: SpecHost, which: 'pAdd' | 'sAdd', now: number): Rec[] => {
    const b = (h as unknown as Record<string, Ring>)[which] as Ring;
    const out: Rec[] = [];
    for (let i = 0; i < b.used; i++) if ((b.endT[i] as number) > now) out.push(b.f.subarray(i * 24, i * 24 + 24));
    return out;
  };
  const particle = (tex: ParticleSpec['tex'], frames: ParticleSpec['frames']): ElementSpec => ({ kind: 'particle', cycle: 0.5, max: 8, rate: [0, 240], life: [0, 1], half: [0, 0.3], color: [0, 0xffffff, 1], billboard: 'screen', blend: 'add', tex, frames });
  const surface = (tex: ParticleSpec['tex'], frames: { fps?: number; mode?: 'cut' | 'blend' | 'random' }): ElementSpec => ({ kind: 'surface', life: 1, shape: { kind: 'card', w: 1, h: 1 }, color: [0, 0xffffff, 1], blend: 'add', tex, frames });

  /** plays one element after the art is baked, runs 0.2 s, returns the live records */
  async function records(el: ElementSpec, kind: 'pAdd' | 'sAdd'): Promise<Rec[]> {
    const { h, fx } = host();
    const { src } = fakeSource({}, 8);
    h.play(spec('sk.flip', [el]), new Ctx(), false);
    await h.preloadArt(src);
    for (let k = 0; k < 12; k++) {
      fx.time += 1 / 60;
      h.update(1 / 60);
    }
    return live(h, kind, fx.time);
  }
  const PF = 16;
  const SF = 21;
  const modeOf = (r: Rec, shift: number): number => (((r[18] as number) | 0) >> shift) & 3;

  it('a generated frame list hard-cuts by default and carries the fps; random: true only picks the start frame', async () => {
    const plain = await records(particle({ art: LIST, fallback: 'boltH' }, { fps: 8 }), 'pAdd');
    expect(plain.length).toBeGreaterThan(2);
    for (const r of plain) {
      expect(modeOf(r, PF)).toBe(1);
      expect(r[21]).toBe(8);
      expect(r[22]).toBe(0);
    }
    const start = await records(particle({ art: LIST, fallback: 'boltH' }, { fps: 8, random: true }), 'pAdd');
    expect(new Set(start.map((r) => r[22])).size).toBeGreaterThan(1);
    for (const r of start) {
      expect(modeOf(r, PF)).toBe(1);
      expect(Number.isInteger(r[22])).toBe(true);
      expect(r[22]).toBeLessThan(LIST.length);
    }
  });

  it('mode random writes a per-particle seed instead of a start frame; blend opts a list back into the cross-fade', async () => {
    const rnd = await records(particle({ art: LIST, fallback: 'boltH' }, { fps: 8, mode: 'random' }), 'pAdd');
    expect(rnd.length).toBeGreaterThan(2);
    for (const r of rnd) {
      expect(modeOf(r, PF)).toBe(2);
      expect(Number.isInteger(r[22])).toBe(true);
      expect(r[22]).toBeLessThan(16777216);
    }
    expect(new Set(rnd.map((r) => r[22])).size).toBeGreaterThan(rnd.length / 2);
    const blend = await records(particle({ art: LIST, fallback: 'boltH' }, { fps: 8, mode: 'blend' }), 'pAdd');
    for (const r of blend) expect(modeOf(r, PF)).toBe(0);
  });

  it('a procedural flipbook keeps its cross-fade unless it opts in; a missing sprite draws the procedural role with ITS mode', async () => {
    const proc = await records(particle('boltH', { fps: 8 }), 'pAdd');
    expect(proc.length).toBeGreaterThan(2);
    for (const r of proc) expect(modeOf(r, PF)).toBe(0);
    for (const r of await records(particle('boltH', { fps: 8, mode: 'cut' }), 'pAdd')) expect(modeOf(r, PF)).toBe(1);
    const missing = await records(particle({ art: ['s0', 'nope'], fallback: 'boltH' }, { fps: 8 }), 'pAdd');
    expect(missing.length).toBeGreaterThan(2);
    for (const r of missing) expect(modeOf(r, PF)).toBe(0);
  });

  it('surfaces carry the mode in their own flag bits (art cuts, procedural blends, explicit wins)', async () => {
    const art = await records(surface({ art: LIST, fallback: 'boltH' }, { fps: 8 }), 'sAdd');
    expect(art.length).toBeGreaterThan(0);
    for (const r of art) {
      expect(modeOf(r, SF)).toBe(1);
      expect(r[23]).toBe(8);
    }
    for (const r of await records(surface({ art: LIST, fallback: 'boltH' }, { fps: 8, mode: 'random' }), 'sAdd')) expect(modeOf(r, SF)).toBe(2);
    for (const r of await records(surface('boltH', { fps: 8 }), 'sAdd')) expect(modeOf(r, SF)).toBe(0);
  });
});
