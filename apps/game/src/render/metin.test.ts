// MetinViews: the compiled-program keep-alive does not grow with the runs played, and the zone's stones stream in behind the
// first seconds of a run (model + rune glyphs from STREAM_DELAY, programs compiled ahead) with an on-demand fallback.
import { AnimationClip, BufferGeometry, Group, Material, Mesh, MeshStandardMaterial, Scene, Texture, Vector3, type Object3D } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RenderCore } from './core';
import type { MetinView } from './feed';
import { MetinViews, metinDamageRamp, type MetinLoadDef } from './metin';

const RUNES = ['lament', 'avarice', 'ebon', 'strife', 'onslaught'];
const KEYS = RUNES.map((r) => `metin_${r}`);

function stoneTypes(load: MetinLoadDef['load'], at = 60): MetinLoadDef[] {
  return KEYS.map((key) => ({ key, modelId: 'metin_stone', rune: '#5aa8ff', load, at }));
}

interface Rig {
  core: RenderCore;
  requested: string[];
  uploaded: Texture[];
  compiled: Object3D[];
  disposed: Material[];
  sinkResolves: (() => void)[];
  failGlyph: Set<string>;
  /** scene extras of the fake model and the clips of every instance: tests set them (one rig per test: the dispose spy cannot be stacked) */
  extras: Record<string, unknown>;
  clips: AnimationClip[];
}

/** a renderer whose property store mimics three's: a material that "drew" has the programs its feature set keys to */
function makeRig(): Rig {
  const rig: Rig = { core: null as unknown as RenderCore, requested: [], uploaded: [], compiled: [], disposed: [], sinkResolves: [], failGlyph: new Set(), extras: {}, clips: [] };
  const loaded = new Set<string>();
  const textures = new Map<string, Texture>();
  const props = new WeakMap<object, { programs: Map<string, object> }>();
  const model = { meshes: [{ material: { map: new Texture(), color: 1 } }], extras: rig.extras };
  rig.core = {
    scene: new Scene(),
    rig: { focus: new Vector3() },
    heightAt: () => 0,
    renderer: {
      initTexture: (t: Texture) => rig.uploaded.push(t),
      properties: {
        get: (m: Material) => {
          let p = props.get(m);
          if (!p) props.set(m, (p = { programs: new Map() }));
          return p;
        },
      },
    },
    assets: {
      loadBatch: async (reqs: { id: string }[]) => {
        for (const r of reqs) {
          rig.requested.push(r.id);
          loaded.add(r.id);
        }
      },
      hasTexture: (id: string) => id.startsWith('tex_metin_rune_'),
      loadTexture: (id: string) => {
        rig.requested.push(id);
        if (rig.failGlyph.has(id)) return Promise.reject(new Error('404'));
        let t = textures.get(id);
        if (!t) textures.set(id, (t = new Texture()));
        return Promise.resolve(t);
      },
      isModelLoaded: (id: string) => loaded.has(id),
      model: () => model,
      loadModel: (id: string) => {
        rig.requested.push(id);
        loaded.add(id);
        return Promise.resolve(model);
      },
      instantiate: () => {
        const mesh = new Mesh(new BufferGeometry(), new MeshStandardMaterial());
        const root = new Group();
        root.add(mesh);
        return { root, meshes: [mesh], skinned: [], clips: rig.clips, bones: new Map() };
      },
    },
  } as unknown as RenderCore;
  // every material the views create reports to the rig when disposed
  const origDispose = Material.prototype.dispose;
  vi.spyOn(Material.prototype, 'dispose').mockImplementation(function (this: Material) {
    rig.disposed.push(this);
    origDispose.call(this);
  });
  return rig;
}

/** marks every material under `root` (and the scene) as compiled, the way a render or compileAsync does */
function compileUnder(rig: Rig, root: Object3D): void {
  const keyOf = (m: Material): string => ((m as MeshStandardMaterial).isMeshStandardMaterial ? ((m as MeshStandardMaterial).emissiveMap ? 'std+emissive' : 'std') : 'sprite');
  root.traverse((o) => {
    const mat = (o as Mesh).material as Material | undefined;
    if (!mat) return;
    const p = (rig.core.renderer as unknown as { properties: { get(m: Material): { programs: Map<string, object> } } }).properties.get(mat);
    p.programs.set(keyOf(mat), {});
  });
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

const view = (type: number, id = 1): MetinView => ({ id, type, x: 0, z: 0, phase: 1, phaseT: 5, hpFrac: 1, scale: 1, great: false, auraRadius: 4, warnLeft: 0 });

describe('MetinViews', () => {
  let rig: Rig;
  beforeEach(() => {
    // the glow sprite paints a canvas texture at construction
    vi.stubGlobal('document', {
      createElement: () => ({ width: 0, height: 0, getContext: () => ({ createRadialGradient: () => ({ addColorStop: () => undefined }), fillRect: () => undefined, fillStyle: '' }) }),
    });
    rig = makeRig();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const keep = (v: MetinViews): Map<string, Material> => (v as unknown as { warmKeep: Map<string, Material> }).warmKeep;

  describe('warm-up keep-alive', () => {
    it('parks one material per program kind, not one per stone per run', async () => {
      const views = new MetinViews(rig.core);
      await views.load(stoneTypes('now'));
      const sizes: number[] = [];
      for (let run = 0; run < 6; run++) {
        const remove = views.addWarmSlots();
        compileUnder(rig, rig.core.scene); // the warm-up render
        remove();
        sizes.push(keep(views).size);
      }
      expect(sizes).toEqual([2, 2, 2, 2, 2, 2]); // the glyph-mapped stone program + the sprite program
      expect(rig.core.scene.children.length).toBe(0);
      // every stand-in material beyond the two parked ones was disposed: 6 runs x 5 stones x (1 stone + 2 sprites) - 2
      const parked = new Set(keep(views).values());
      expect(rig.disposed.filter((m) => !parked.has(m)).length + parked.size).toBeGreaterThanOrEqual(5 * 6 - 1);
      for (const m of parked) expect(rig.disposed).not.toContain(m);
      views.dispose();
      expect(keep(views).size).toBe(0);
      for (const m of parked) expect(rig.disposed).toContain(m);
    });

    it('keeps the program of the last live stone of a kind when it drops', async () => {
      const views = new MetinViews(rig.core);
      await views.load(stoneTypes('now'));
      views.feed = [view(0)];
      views.update(0.016, 0);
      compileUnder(rig, rig.core.scene); // it drew
      views.feed = [];
      views.update(0.016, 0); // the stone leaves the feed: dropped
      expect(keep(views).size).toBe(2);
      views.feed = [view(1, 2)];
      views.update(0.016, 0);
      views.feed = [];
      views.update(0.016, 0);
      expect(keep(views).size).toBe(2); // the second stone of that kind was just disposed
    });

    it('does not keep a material that never compiled anything', async () => {
      const views = new MetinViews(rig.core);
      await views.load(stoneTypes('now'));
      views.addWarmSlots()(); // no draw happened
      expect(keep(views).size).toBe(0);
    });
  });

  describe('streaming the zone stones', () => {
    it('fetches model + all glyphs outside the first seconds, uploads them, compiles ahead, then retires the copy', async () => {
      const views = new MetinViews(rig.core);
      const sink = vi.fn((obj: Object3D) => {
        rig.compiled.push(obj);
        compileUnder(rig, obj);
        return new Promise<void>((res) => rig.sinkResolves.push(res));
      });
      views.warmSink = sink;
      await views.load(stoneTypes('stream'));
      expect(rig.requested).toEqual([]); // nothing blocks the zone load
      views.feed = [];
      for (let t = 0; t < 11.9; t += 0.1) views.update(0.1, 0);
      expect(rig.requested).toEqual([]); // outside the payload gate's window: HUD + 6 s
      views.update(0.2, 0);
      await flush();
      expect(rig.requested.sort()).toEqual(['metin_stone', ...RUNES.map((r) => `tex_metin_rune_${r}`)].sort());
      // one texture per frame goes to the GPU: the stone's own + the 5 glyphs
      for (let i = 0; i < 8; i++) views.update(0.016, 0);
      expect(rig.uploaded.length).toBe(6);
      // the programs were compiled on a detached copy (never drawn in the scene) ...
      expect(sink).toHaveBeenCalledTimes(1);
      expect(rig.compiled[0]?.parent).toBeNull();
      expect(rig.core.scene.children.length).toBe(0);
      expect(keep(views).size).toBe(0);
      // ... which is taken apart once the compile resolved, keeping one material per program kind
      rig.sinkResolves[0]?.();
      await flush();
      expect(keep(views).size).toBe(2);
      // a stone that falls now finds model, glyph and programs ready
      views.feed = [view(2)];
      views.update(0.016, 0);
      expect(views.active.length).toBe(1);
      expect(rig.core.scene.children.length).toBe(1);
      expect(sink).toHaveBeenCalledTimes(1);
    });

    it('streams each type at its own time: the great metin waits for its wave', async () => {
      const views = new MetinViews(rig.core);
      views.warmSink = () => undefined;
      await views.load([...stoneTypes('stream'), { key: 'metin_great_yeonmu', modelId: 'metin_great_yeonmu', rune: '#ff0000', load: 'stream', at: 900 }]);
      views.feed = [];
      for (let t = 0; t < 20; t += 0.5) views.update(0.5, 0);
      await flush();
      expect(rig.requested).not.toContain('metin_great_yeonmu');
      for (let t = 20; t < 900 - 120 - 10; t += 10) views.update(10, 0); // 770 s rendered
      expect(rig.requested).not.toContain('metin_great_yeonmu');
      views.update(10, 0);
      expect(rig.requested).toContain('metin_great_yeonmu');
    });

    it('fetches on demand when a stone is needed before the stream: model and glyph, then it appears', async () => {
      const views = new MetinViews(rig.core);
      views.warmSink = () => undefined;
      await views.load(stoneTypes('stream'));
      views.feed = [view(3)];
      views.update(0.016, 0);
      expect(rig.requested.sort()).toEqual(['metin_stone', 'tex_metin_rune_strife']); // only the needed type, now
      expect(views.active.length).toBe(1); // in the feed ...
      expect(rig.core.scene.children.length).toBe(0); // ... but nothing drawn before both are in
      await flush();
      views.update(0.016, 0);
      expect(rig.core.scene.children.length).toBe(1);
      // the same fetches are not repeated while / after they are in
      views.update(0.016, 0);
      expect(rig.requested.length).toBe(2);
    });

    it('does not hold a stone back for a rune glyph that cannot be fetched', async () => {
      const views = new MetinViews(rig.core);
      views.warmSink = () => undefined;
      rig.failGlyph.add('tex_metin_rune_avarice');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      await views.load(stoneTypes('stream'));
      views.feed = [view(1)];
      views.update(0.016, 0);
      await flush();
      views.update(0.016, 0);
      expect(rig.core.scene.children.length).toBe(1);
      expect(warn).toHaveBeenCalled();
    });

    it("'now' types still load with the run (dev server, demos)", async () => {
      const views = new MetinViews(rig.core);
      await views.load(stoneTypes('now'));
      expect(rig.requested.sort()).toEqual(['metin_stone', ...RUNES.map((r) => `tex_metin_rune_${r}`)].sort());
    });
  });

  describe('E3: a stone with its own emissive mask (extras.glyph === false)', () => {
    const stoneMats = (r: Rig): MeshStandardMaterial[] => {
      const mats: MeshStandardMaterial[] = [];
      r.core.scene.traverse((o) => {
        const m = (o as Mesh).material as MeshStandardMaterial | undefined;
        if (m?.isMeshStandardMaterial) mats.push(m);
      });
      return mats;
    };
    const current = (v: MetinViews): string => {
      const slots = (v as unknown as { slots: Map<number, { current: { getClip(): AnimationClip } | null }> }).slots;
      return [...slots.values()][0]?.current?.getClip().name ?? '';
    };

    it("'now' types load the model only: the 13 rune glyph maps are not fetched, bound or waited for", async () => {
      rig.extras.glyph = false;
      const views = new MetinViews(rig.core);
      await views.load(stoneTypes('now'));
      expect(rig.requested).toEqual(['metin_stone']);
      views.feed = [view(0)];
      views.update(0.016, 0);
      expect(rig.core.scene.children.length).toBe(1);
      expect(stoneMats(rig)[0]?.emissiveMap).toBeNull();
    });

    it('streamed and on-demand types fetch the model and never a glyph', async () => {
      rig.extras.glyph = false;
      const views = new MetinViews(rig.core);
      views.warmSink = () => undefined;
      await views.load(stoneTypes('stream'));
      views.feed = [view(3)];
      views.update(0.016, 0);
      await flush();
      views.update(0.016, 0);
      expect(rig.requested).toEqual(['metin_stone']);
      expect(rig.core.scene.children.length).toBe(1);
      for (let t = 0; t < 14; t += 0.5) views.update(0.5, 0);
      await flush();
      expect(rig.requested).toEqual(['metin_stone']);
    });

    it('a forge stone (no flag) keeps its glyph path unchanged', async () => {
      const views = new MetinViews(rig.core);
      await views.load(stoneTypes('now'));
      views.feed = [view(0)];
      views.update(0.016, 0);
      expect(stoneMats(rig)[0]?.emissiveMap).not.toBeNull();
    });

    /** stones of phases 1 and 2 at full and low hp in one frame: emissive intensities [alive full, alive low, awake full, awake low] */
    const frame = async (r: Rig): Promise<number[]> => {
      const views = new MetinViews(r.core);
      await views.load(stoneTypes('now'));
      views.feed = [
        { ...view(0, 1), phase: 1, hpFrac: 1 },
        { ...view(0, 2), phase: 1, hpFrac: 0.2 },
        { ...view(0, 3), phase: 2, hpFrac: 1 },
        { ...view(0, 4), phase: 2, hpFrac: 0.2 },
      ];
      views.update(0.016, 0);
      const mats = stoneMats(r);
      expect(mats.length).toBe(4);
      return mats.map((m) => m.emissiveIntensity);
    };

    it('the damage ramp brings the emissive up as hp falls, in the alive and the awakened phase', async () => {
      rig.extras.glyph = false;
      const [aFull, aLow, wFull, wLow] = (await frame(rig)) as [number, number, number, number];
      expect(aLow / aFull).toBeCloseTo(metinDamageRamp(0.2), 5);
      expect(wLow / wFull).toBeCloseTo(metinDamageRamp(0.2), 5);
      expect(aLow).toBeGreaterThan(aFull);
    });

    it('a forge stone does not follow the ramp', async () => {
      const [aFull, aLow, wFull, wLow] = (await frame(rig)) as [number, number, number, number];
      expect(aLow).toBeCloseTo(aFull, 9);
      expect(wLow).toBeCloseTo(wFull, 9);
    });

    it('plays the hit clip for 0.35 s after an hp drop, then goes back to idle', async () => {
      rig.extras.glyph = false;
      rig.clips.push(new AnimationClip('idle', 8, []), new AnimationClip('hit', 0.35, []));
      const views = new MetinViews(rig.core);
      await views.load(stoneTypes('now'));
      views.feed = [{ ...view(0), hpFrac: 1 }];
      views.update(0.016, 0);
      expect(current(views)).toBe('idle'); // appearing does not count as a hit
      views.feed = [{ ...view(0), hpFrac: 0.8 }];
      views.update(0.016, 0);
      expect(current(views)).toBe('hit');
      for (let i = 0; i < 12; i++) views.update(0.05, 0);
      expect(current(views)).toBe('idle');
    });

    it('a forge stone never plays the hit clip', async () => {
      rig.clips.push(new AnimationClip('idle', 8, []), new AnimationClip('hit', 0.35, []));
      const views = new MetinViews(rig.core);
      await views.load(stoneTypes('now'));
      views.feed = [{ ...view(0), hpFrac: 1 }];
      views.update(0.016, 0);
      views.feed = [{ ...view(0), hpFrac: 0.5 }];
      views.update(0.016, 0);
      expect(current(views)).toBe('idle');
    });
  });
});
