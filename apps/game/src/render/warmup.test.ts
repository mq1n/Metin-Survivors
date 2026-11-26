// warmupPass (RenderWorld.warmup / warmupAsync): one of everything must be drawn in both passes before play (prod4 runtime-memory-net),
// every switch it flips for that must be restored, also when a frame throws, and the async variant (code-finish A1) must never leave
// the scene half-prepared while it waits for the compile or yields to the event loop.
import { BoxGeometry, Group, HemisphereLight, InstancedMesh, Mesh, MeshBasicMaterial, Object3D, Scene, Sprite, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { CompileBatch, compileInSlices, eagerStreamTypes, planWarmSlices, primeZoneSystem, warmEstablishing, warmupPass, warmupPassSync, type WarmCore } from './warmupPass';
import { FrameStats, HITCH_MS, ProgramWatch, type LateProgram, type ProgramInfo } from './perf';

interface Seen {
  prop: boolean;
  pinned: boolean;
  crowd: boolean;
  sprite: boolean;
  pooledVisible: boolean;
  crowdCount: number;
}

function fakeWorld(opts: { shadows: boolean; throwOnRender?: boolean }) {
  const scene = new Scene();
  const geo = new BoxGeometry(1, 1, 1);
  const mat = new MeshBasicMaterial();
  const prop = new Mesh(geo, mat); // culled by default, a caster far outside any frustum
  prop.castShadow = true;
  prop.position.set(900, 0, 900);
  const pinned = new Mesh(geo, mat); // already unculled (the hero's meshes): stays that way
  pinned.frustumCulled = false;
  const pooled = new Mesh(geo, mat); // hidden pooled mesh
  pooled.visible = false;
  const crowd = new InstancedMesh(geo, mat, 4);
  crowd.count = 0;
  const sprite = new Sprite();
  scene.add(prop, pinned, pooled, crowd, sprite);
  const seen: Seen[] = [];
  const snapshot = (): Seen => ({ prop: prop.frustumCulled, pinned: pinned.frustumCulled, crowd: crowd.frustumCulled, sprite: sprite.frustumCulled, pooledVisible: pooled.visible, crowdCount: crowd.count });
  const render = vi.fn(() => {
    seen.push(snapshot());
    if (opts.throwOnRender) throw new Error('lost context');
  });
  const followShadow = vi.fn();
  const focus = new Vector3(3, 0, 4);
  const events: string[] = [];
  const removeMetins = vi.fn(() => events.push('removeSlots'));
  const world = {
    core: {
      scene,
      composer: null,
      renderer: { render: (...a: unknown[]) => (events.push('render'), render(...(a as []))) },
      rig: { camera: {}, focus },
      quality: { profile: { shadows: opts.shadows, shadowMapSize: 2048 } },
      env: { followShadow: (...a: unknown[]) => (events.push('followShadow'), followShadow(...(a as []))) },
    },
    metins: { addWarmSlots: () => removeMetins },
  };
  return { world, scene, prop, pinned, pooled, crowd, sprite, seen, render, followShadow, focus, removeMetins, snapshot, events };
}

const NORMAL: Seen = { prop: true, pinned: false, crowd: true, sprite: true, pooledVisible: false, crowdCount: 0 };
const WARM: Seen = { prop: false, pinned: false, crowd: false, sprite: false, pooledVisible: true, crowdCount: 1 };

const warmSync = (w: { core: unknown; metins: { addWarmSlots(): () => void } }): void => warmupPassSync(w.core as WarmCore, w.metins.addWarmSlots());
const warmAsync = (w: { core: unknown; metins: { addWarmSlots(): () => void } }, opts?: Parameters<typeof warmupPass>[2]): Promise<void> =>
  warmupPass(w.core as WarmCore, w.metins.addWarmSlots(), { turn: async () => undefined, ...opts });

describe('warmupPassSync', () => {
  it('draws everything in both passes: culling is off during the two warm-up frames and back on afterwards', () => {
    const f = fakeWorld({ shadows: true });
    warmSync(f.world);
    expect(f.render).toHaveBeenCalledTimes(2);
    for (const s of f.seen) expect(s).toEqual(WARM);
    expect(f.prop.frustumCulled).toBe(true);
    expect(f.crowd.frustumCulled).toBe(true);
    expect(f.sprite.frustumCulled).toBe(true);
    expect(f.pinned.frustumCulled).toBe(false); // it was never culled: not turned on by the restore
    expect(f.pooled.visible).toBe(false);
    expect(f.crowd.count).toBe(0);
    expect(f.removeMetins).toHaveBeenCalledTimes(1);
  });

  it("places the sun's shadow frustum on the run's focus first when shadows are on, and leaves it alone when they are off", () => {
    const on = fakeWorld({ shadows: true });
    warmSync(on.world);
    expect(on.followShadow).toHaveBeenCalledWith(on.focus, 2048);
    expect(on.events[0]).toBe('followShadow');
    const off = fakeWorld({ shadows: false });
    warmSync(off.world);
    expect(off.followShadow).not.toHaveBeenCalled();
  });

  it('restores culling, visibility and instance counts when a frame throws', () => {
    const f = fakeWorld({ shadows: true, throwOnRender: true });
    expect(() => warmSync(f.world)).toThrow('lost context');
    expect(f.prop.frustumCulled).toBe(true);
    expect(f.sprite.frustumCulled).toBe(true);
    expect(f.pooled.visible).toBe(false);
    expect(f.crowd.count).toBe(0);
    expect(f.removeMetins).toHaveBeenCalledTimes(1);
  });
});

describe('warmupPass (async)', () => {
  it('draws the same two unculled frames, restores everything and removes the warm slots last', async () => {
    const f = fakeWorld({ shadows: true });
    await warmAsync(f.world);
    expect(f.render).toHaveBeenCalledTimes(2);
    for (const s of f.seen) expect(s).toEqual(WARM);
    expect(f.snapshot()).toEqual(NORMAL);
    expect(f.followShadow).toHaveBeenCalledWith(f.focus, 2048);
    expect(f.events).toEqual(['followShadow', 'render', 'render', 'removeSlots']);
  });

  it('primes the lazily created content first (after the shadow frustum sits on the hero), before the compile sees the scene, once', async () => {
    const w = fakeWorld({ shadows: true });
    const lazy = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    const prime = vi.fn(() => {
      w.events.push('prime');
      w.scene.add(lazy); // what the zone's first update does: vegetation / props appear
    });
    let compiled = 0;
    await warmupPass(w.world.core as unknown as WarmCore, w.removeMetins, {
      prime,
      compile: async () => {
        w.events.push('compile');
        compiled = w.scene.children.includes(lazy) ? 1 : -1;
      },
      turn: async () => undefined,
    });
    expect(prime).toHaveBeenCalledTimes(1);
    expect(compiled).toBe(1); // the compile (and so the warm frames) cover the primed content
    expect(w.events.indexOf('followShadow')).toBeLessThan(w.events.indexOf('prime'));
    expect(w.events.indexOf('prime')).toBeLessThan(w.events.indexOf('compile'));
    expect(w.events.indexOf('compile')).toBeLessThan(w.events.indexOf('render'));
  });

  it('a priming that throws only skips the priming: the warm-up goes on, restores everything and removes the warm slots', async () => {
    const w = fakeWorld({ shadows: false });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await warmupPass(w.world.core as unknown as WarmCore, w.removeMetins, {
      prime: () => {
        throw new Error('zone not ready');
      },
      turn: async () => undefined,
    });
    warn.mockRestore();
    expect(w.render).toHaveBeenCalledTimes(2);
    expect(w.removeMetins).toHaveBeenCalledTimes(1);
    expect(w.snapshot()).toEqual(NORMAL);
  });

  it('compiles first, on the untouched scene, and hands the compile a turn to yield with', async () => {
    const f = fakeWorld({ shadows: true });
    const atCompile: Seen[] = [];
    const turns = vi.fn(async () => undefined);
    const compile = vi.fn(async (turn: () => Promise<void>) => {
      atCompile.push(f.snapshot());
      await turn();
      atCompile.push(f.snapshot());
      expect(f.render).not.toHaveBeenCalled();
    });
    await warmupPass(f.world.core as unknown as WarmCore, f.world.metins.addWarmSlots(), { compile, turn: turns });
    expect(compile).toHaveBeenCalledTimes(1);
    expect(atCompile).toEqual([NORMAL, NORMAL]);
    expect(f.render).toHaveBeenCalledTimes(2);
  });

  it('never yields with the scene prepared: each turn sees culling on, pooled meshes hidden and instance counts back at 0', async () => {
    const f = fakeWorld({ shadows: true });
    const atTurn: Seen[] = [];
    const slotsAtTurn: number[] = [];
    await warmAsync(f.world, {
      compile: async (turn) => {
        await turn();
      },
      turn: async () => {
        atTurn.push(f.snapshot());
        slotsAtTurn.push(f.removeMetins.mock.calls.length);
      },
    });
    // one turn from the compile and one between the two warm frames; none after the last frame (the slots leave right away)
    expect(atTurn).toEqual([NORMAL, NORMAL]);
    expect(slotsAtTurn).toEqual([0, 0]);
    expect(f.removeMetins).toHaveBeenCalledTimes(1);
  });

  it('reports a monotone progress from 0 to 1', async () => {
    const f = fakeWorld({ shadows: false });
    const p: number[] = [];
    await warmAsync(f.world, { onProgress: (x) => p.push(x), compile: async () => undefined });
    expect(p[0]).toBe(0);
    expect(p.at(-1)).toBe(1);
    expect([...p].sort((a, b) => a - b)).toEqual(p);
  });

  it('restores the scene and removes the warm slots when a frame throws', async () => {
    const f = fakeWorld({ shadows: true, throwOnRender: true });
    await expect(warmAsync(f.world)).rejects.toThrow('lost context');
    expect(f.snapshot()).toEqual(NORMAL);
    expect(f.removeMetins).toHaveBeenCalledTimes(1);
  });

  it('still removes the warm slots, without touching the scene, when the compile rejects', async () => {
    const f = fakeWorld({ shadows: true });
    await expect(
      warmAsync(f.world, {
        compile: async () => {
          throw new Error('compile lost');
        },
      }),
    ).rejects.toThrow('compile lost');
    expect(f.render).not.toHaveBeenCalled();
    expect(f.snapshot()).toEqual(NORMAL);
    expect(f.removeMetins).toHaveBeenCalledTimes(1);
  });
});

describe('sliced warm frames', () => {
  const mesh = (): Mesh => new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());

  it('plans units of at most sliceSize drawables, opens heavy containers and keeps lights out of every unit', () => {
    const scene = new Scene();
    const light = new HemisphereLight();
    scene.add(light);
    const small = new Group();
    small.add(mesh(), mesh());
    const heavy = new Group();
    for (let i = 0; i < 7; i++) heavy.add(mesh());
    const lit = new Group(); // small, but it holds a light: opened up, the light never leaves the scene
    const innerLight = new HemisphereLight();
    lit.add(innerLight, mesh());
    const lone = mesh();
    scene.add(small, heavy, lit, lone);
    const slices = planWarmSlices(scene, 4);
    const units = slices.flat();
    expect(units).toContain(small);
    expect(units).toContain(lone);
    expect(units).not.toContain(heavy); // 7 > 4: opened into its meshes
    expect(units).not.toContain(lit);
    expect(units).not.toContain(light);
    expect(units).not.toContain(innerLight);
    expect(units.filter((u) => u.parent === heavy)).toHaveLength(7);
    expect(units.filter((u) => u.parent === lit)).toHaveLength(1);
    // every drawable is in exactly one unit, no slice is heavier than the size (single objects aside)
    let drawn = 0;
    for (const sl of slices) {
      let w = 0;
      for (const u of sl)
        u.traverse((o) => {
          if ((o as Mesh).isMesh) w++;
        });
      expect(w).toBeLessThanOrEqual(4);
      drawn += w;
    }
    expect(drawn).toBe(11);
  });

  it('draws each slice alone (the other units are hidden for that frame), unculled, and restores everything between the slices', async () => {
    const f = fakeWorld({ shadows: true });
    const lastRender = f.render.getMockImplementation();
    const perFrame: string[][] = [];
    const units = [f.prop, f.pinned, f.pooled, f.crowd, f.sprite];
    const names = new Map<Object3D, string>([[f.prop, 'prop'], [f.pinned, 'pinned'], [f.pooled, 'pooled'], [f.crowd, 'crowd'], [f.sprite, 'sprite']]);
    f.render.mockImplementation(() => {
      perFrame.push(units.filter((u) => u.visible).map((u) => names.get(u) as string));
      return lastRender?.();
    });
    const atTurn: Seen[] = [];
    await warmupPass(f.world.core as unknown as WarmCore, f.world.metins.addWarmSlots(), {
      sliceSize: 2,
      turn: async () => {
        atTurn.push(f.snapshot());
      },
    });
    // 5 unit meshes, 2 per slice -> 3 slices per frame, 2 frames
    expect(perFrame).toHaveLength(6);
    expect(perFrame.slice(0, 3)).toEqual(perFrame.slice(3));
    expect(perFrame.slice(0, 3)).toEqual([['prop', 'pinned'], ['pooled', 'crowd'], ['sprite']]);
    // between slices the scene is the normal one: culling on, pooled meshes hidden, instance counts 0, nothing hidden by a slice
    expect(atTurn).toHaveLength(5);
    for (const s of atTurn) expect(s).toEqual(NORMAL);
    expect(units.filter((u) => u !== f.pooled).every((u) => u.visible)).toBe(true);
    expect(f.pooled.visible).toBe(false);
    expect(f.removeMetins).toHaveBeenCalledTimes(1);
    expect(f.events.at(-1)).toBe('removeSlots');
  });

  it('shows the hidden pooled container of a unit for its slice only', async () => {
    const f = fakeWorld({ shadows: false });
    const pool = new Group();
    pool.visible = false;
    const inner = new Group();
    for (let i = 0; i < 3; i++) inner.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()));
    pool.add(inner);
    f.scene.add(pool);
    const seenPool: boolean[] = [];
    f.render.mockImplementation(() => {
      seenPool.push(pool.visible && inner.visible);
    });
    await warmupPass(f.world.core as unknown as WarmCore, f.world.metins.addWarmSlots(), { sliceSize: 3, turn: async () => undefined });
    expect(seenPool.some((v) => v)).toBe(true);
    expect(pool.visible).toBe(false);
    expect(inner.visible).toBe(true);
  });
});

describe('compileInSlices (the parallel compile of the scene)', () => {
  const mesh = (): Mesh => new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
  const sceneOf = (n: number): { scene: Scene; meshes: Mesh[] } => {
    const scene = new Scene();
    scene.add(new HemisphereLight());
    const meshes: Mesh[] = [];
    for (let i = 0; i < n; i++) {
      const m = mesh();
      if (i % 3 === 0) m.visible = false; // pooled meshes compile too
      meshes.push(m);
    }
    const g = new Group();
    g.visible = false;
    g.add(...meshes.slice(0, 2));
    scene.add(g, ...meshes.slice(2));
    return { scene, meshes };
  };

  it('hands every drawable (hidden ones too, no light) to the compile exactly once, in batches', async () => {
    const { scene, meshes } = sceneOf(10);
    const batches: Object3D[][] = [];
    await compileInSlices(scene, (b) => void batches.push([...b.items]), async () => undefined, { batch: 4 });
    expect(batches.map((b) => b.length)).toEqual([4, 4, 2]);
    const all = batches.flat();
    expect(all).toHaveLength(10);
    expect(new Set(all)).toEqual(new Set(meshes));
    for (const m of meshes) expect(m.parent).not.toBeNull(); // nothing was re-parented
    expect(meshes[0]?.parent?.visible).toBe(false);
  });

  it('a batch only exposes its items to traverse() and nothing to traverseVisible() (the target scene brings the lights)', () => {
    const b = new CompileBatch();
    const a = mesh();
    const c = mesh();
    b.items = [a, c];
    const seen: Object3D[] = [];
    b.traverse((o) => seen.push(o));
    expect(seen).toEqual([a, c]);
    const vis: Object3D[] = [];
    b.traverseVisible((o: Object3D) => vis.push(o));
    expect(vis).toEqual([]);
  });

  it('gives the event loop a turn once the slice budget is used up, and waits for every compile it started', async () => {
    const { scene } = sceneOf(12);
    let t = 0;
    const events: string[] = [];
    let resolved = 0;
    const compileOne = (): Promise<void> => {
      t += 20; // each batch costs 20 ms of main thread
      events.push('compile');
      return new Promise<void>((r) => setTimeout(() => (resolved++, r()), 0));
    };
    await compileInSlices(scene, compileOne, async () => void events.push('turn'), { batch: 3, sliceMs: 30, now: () => t });
    // 4 batches of 20 ms: a turn after the 2nd (40 >= 30) and after the 4th
    expect(events).toEqual(['compile', 'compile', 'turn', 'compile', 'compile', 'turn']);
    expect(resolved).toBe(4);
  });

  it('is a no-op for a scene without drawables', async () => {
    const compileOne = vi.fn();
    await compileInSlices(new Scene(), compileOne, async () => undefined);
    expect(compileOne).not.toHaveBeenCalled();
  });
});

describe('primeZoneSystem (PERF-01: the zone\'s first update under the loading screen)', () => {
  it('runs the update of the system named zone, with dt 0, and says so', () => {
    const calls: string[] = [];
    const core = {
      systems: [
        { name: 'crowd', update: () => calls.push('crowd') },
        { name: 'zone', update: (dt: number, alpha: number) => calls.push(`zone:${dt}:${alpha}`) },
        { name: 'vfx', update: () => calls.push('vfx') },
      ],
    };
    expect(primeZoneSystem(core)).toBe(true);
    expect(calls).toEqual(['zone:0:0']);
  });

  it('does nothing without a zone system (the dev ground, the demos) or without the list, and may be called again', () => {
    expect(primeZoneSystem({ systems: [{ name: 'crowd', update: () => undefined }] })).toBe(false);
    expect(primeZoneSystem({ systems: [] })).toBe(false);
    expect(primeZoneSystem({})).toBe(false);
    const update = vi.fn();
    const core = { systems: [{ name: 'zone', update }] };
    primeZoneSystem(core);
    primeZoneSystem(core);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('finds the real RenderCore list: RenderCore keeps `systems` (the warm-up reads it by name)', async () => {
    // guards the one place the warm-up reaches into the core: if RenderCore renames its private list this fails instead of the priming silently doing nothing
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./core.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/private readonly systems: RenderSystem\[\]/);
  });
});

describe('eagerStreamTypes (PERF-01: the dev server has no streaming, so a clock jump must not meet an unloaded Great Metin)', () => {
  interface T {
    key: string;
    load?: 'now' | 'stream' | 'skip';
    at?: number;
  }
  const catalog = (): T[] => [
    { key: 'metin_ebon', load: 'now' },
    { key: 'metin_lament' },
    { key: 'metin_other_zone', load: 'skip' },
    { key: 'metin_great_ebon', load: 'stream', at: 900 },
  ];

  it('loads the streamed types with the run when nothing streams (dev server): the final-wave Great Metin is warm at second 0', () => {
    const out = eagerStreamTypes(catalog(), false);
    expect(out.map((t) => t.load)).toEqual(['now', undefined, 'skip', 'now']);
    expect(out[3]).toEqual({ key: 'metin_great_ebon', load: 'now', at: 900 });
  });

  it('leaves a production catalog (streaming on) exactly as it is, with its stream entries', () => {
    const c = catalog();
    const out = eagerStreamTypes(c, true);
    expect(out).toEqual(c);
    expect(out[3]?.load).toBe('stream');
  });

  it('never mutates the catalog it is given (the sim-side catalog is shared) and keeps the order', () => {
    const c = catalog();
    const snapshot = JSON.stringify(c);
    const out = eagerStreamTypes(c, false);
    expect(JSON.stringify(c)).toBe(snapshot);
    expect(out).not.toBe(c);
    expect(out.map((t) => t.key)).toEqual(c.map((t) => t.key));
  });

  it('an empty catalog stays empty (a zone without metins)', () => {
    expect(eagerStreamTypes([], false)).toEqual([]);
    expect(eagerStreamTypes([], true)).toEqual([]);
  });
});

describe('ProgramWatch / FrameStats.countOver (PERF-01: programs that link after the load-time warm-up, frames over 50 ms)', () => {
  type P = { id: number; name?: string; cacheKey?: string };
  const rig = (initial: P[]): { info: { programs: P[] | null }; watch: ProgramWatch } => {
    const info: { programs: P[] | null } = { programs: initial };
    return { info, watch: new ProgramWatch(info as ProgramInfo) };
  };

  it('is silent until the warm-up marks its baseline, and a program linked before that is never late', () => {
    const { info, watch } = rig([{ id: 1, name: 'a' }]);
    info.programs?.push({ id: 2, name: 'b' });
    watch.frame(80);
    expect(watch.late).toEqual([]);
    watch.markLoaded();
    watch.frame(12);
    expect(watch.late).toEqual([]);
    expect(watch.live).toBe(2);
  });

  // RenderWorld.frame order: core.frame renders (and links), THEN perf.frame(gap before the render, render time). The gap that holds the stall of
  // a link is the one the NEXT frame reports; the render time of the linking frame is the other witness. (The first version stamped the program
  // with the gap that came before the link: the 233-391 ms vegetation links of the payload traces read 6.9-7.1 ms.)
  it('records a program that appears after the baseline once; its stall is the next frame\'s gap, not the gap before the render that linked it', () => {
    const { info, watch } = rig([{ id: 1, name: 'a' }]);
    watch.markLoaded();
    const seen: LateProgram[] = [];
    watch.onLate = (p) => seen.push(p);
    watch.frame(7);
    // the frame that links: it rendered after a normal 7 ms gap and the render itself was not measured (0)
    info.programs?.push({ id: 7, name: 'metin_great_yeonmu' });
    watch.frame(7);
    expect(watch.late).toEqual([{ id: 7, name: 'metin_great_yeonmu', frameMs: 0 }]); // listed at once, stall not known yet
    expect(seen).toEqual([]); // reported when the stall is known
    watch.frame(222.24); // the next frame's gap contains the link
    watch.frame(7);
    watch.frame(7);
    expect(watch.late).toEqual([{ id: 7, name: 'metin_great_yeonmu', frameMs: 222.2 }]);
    expect(seen).toEqual(watch.late);
  });

  it('a link that blocks inside the render shows in the measured render time even when the next gap is small', () => {
    const { info, watch } = rig([]);
    watch.markLoaded();
    info.programs?.push({ id: 1, name: 'treeBark' }, { id: 2, name: 'treeFoliage' });
    watch.frame(7, 391.26); // gap before the render 7 ms, the render took 391 ms
    expect(watch.late.map((p) => p.frameMs)).toEqual([391.3, 391.3]); // provisional: the render time
    watch.frame(16.7);
    expect(watch.late.map((p) => p.frameMs)).toEqual([391.3, 391.3]); // the larger of render time and next gap
    expect(watch.late.map((p) => p.name)).toEqual(['treeBark', 'treeFoliage']);
  });

  it('the larger of the two wins both ways, and a pause (a hidden tab) is not a stall: gaps count at most 1 s', () => {
    const { info, watch } = rig([]);
    watch.markLoaded();
    info.programs?.push({ id: 1, name: 'a' });
    watch.frame(7, 30);
    watch.frame(210, 6); // the stall surfaced only in the gap
    expect(watch.late[0]?.frameMs).toBe(210);
    info.programs?.push({ id: 2, name: 'b' });
    watch.frame(7, 12);
    watch.frame(45_000, 6); // a tab that came back after 45 s
    expect(watch.late[1]?.frameMs).toBe(1000);
  });

  it('a program found by the very last frame keeps its render time; clearLate and markLoaded drop what is still pending', () => {
    const { info, watch } = rig([]);
    watch.markLoaded();
    const seen: LateProgram[] = [];
    watch.onLate = (p) => seen.push(p);
    info.programs?.push({ id: 1, name: 'a' });
    watch.frame(7, 44);
    expect(watch.late[0]?.frameMs).toBe(44);
    watch.clearLate();
    watch.frame(500); // the pending program is gone with the list: nothing is reported for it
    expect(seen).toEqual([]);
    info.programs?.push({ id: 2, name: 'b' });
    watch.frame(7, 5);
    watch.markLoaded(); // re-based: b is expected now
    watch.frame(500);
    expect(seen).toEqual([]);
    expect(watch.late.map((p) => p.id)).toEqual([2]);
  });

  it('programs beyond the 64 kept still reach onLate with their stall', () => {
    const { info, watch } = rig([]);
    watch.markLoaded();
    const seen: LateProgram[] = [];
    watch.onLate = (p) => seen.push(p);
    const many: P[] = [];
    for (let i = 10; i < 90; i++) many.push({ id: i, name: `p${i}` });
    info.programs = many;
    watch.frame(8, 90);
    watch.frame(8);
    expect(watch.late).toHaveLength(64);
    expect(seen).toHaveLength(80);
    expect(seen.every((p) => p.frameMs === 90)).toBe(true);
  });

  it('names an unnamed program by its cache key, and an empty one as unnamed', () => {
    const { info, watch } = rig([]);
    watch.markLoaded();
    info.programs?.push({ id: 1, name: '', cacheKey: 'depth,highp,srgb-linear,false,,uv,false,false,false' }, { id: 2, name: '' });
    watch.frame(9);
    expect(watch.late.map((p) => p.name)).toEqual(['depth,highp,srgb-linear,', '(unnamed)']);
  });

  it('a released program and a new one in the same frame (the count stays equal) is still found, a rebuilt program id is a new one', () => {
    const { info, watch } = rig([{ id: 1, name: 'a' }, { id: 2, name: 'b' }]);
    watch.markLoaded();
    info.programs = [{ id: 1, name: 'a' }, { id: 3, name: 'c' }];
    watch.frame(8);
    expect(watch.late.map((p) => p.id)).toEqual([]); // equal count: not rescanned (documented: the scan runs on a count change)
    info.programs = [{ id: 1, name: 'a' }, { id: 3, name: 'c' }, { id: 4, name: 'd' }];
    watch.frame(8);
    expect(watch.late.map((p) => p.id)).toEqual([3, 4]);
  });

  it('markLoaded again (the second warm pass of the run) re-bases it; clearLate drops the list; the list is capped', () => {
    const { info, watch } = rig([]);
    watch.markLoaded();
    info.programs = [{ id: 1, name: 'a' }];
    watch.frame(8);
    expect(watch.late).toHaveLength(1);
    watch.markLoaded();
    info.programs = [{ id: 1, name: 'a' }, { id: 2, name: 'b' }];
    watch.frame(8);
    expect(watch.late.map((p) => p.id)).toEqual([1, 2]);
    watch.clearLate();
    expect(watch.late).toEqual([]);
    const many: P[] = [];
    for (let i = 10; i < 200; i++) many.push({ id: i, name: `p${i}` });
    info.programs = many;
    watch.frame(8);
    expect(watch.late).toHaveLength(64);
  });

  it('copes with a renderer that has not rendered yet (programs null)', () => {
    const { info, watch } = rig([]);
    info.programs = null;
    watch.markLoaded();
    watch.frame(5);
    expect(watch.live).toBe(0);
    expect(watch.late).toEqual([]);
  });

  it('FrameStats.countOver counts the samples above a limit among the ones kept', () => {
    const f = new FrameStats();
    for (const ms of [7, 7, 49.9, 50, 50.1, 222, 7]) f.push(ms);
    expect(f.countOver(HITCH_MS)).toBe(2);
    f.reset();
    expect(f.countOver(HITCH_MS)).toBe(0);
    for (let i = 0; i < 340; i++) f.push(i < 100 ? 90 : 7); // the ring keeps the last 240: the 100 slow ones are gone
    expect(f.countOver(HITCH_MS)).toBe(0);
  });
});

describe('warmEstablishing (FEEL-04 redo: the second compile / upload pass at the establishing pose of the fly-in)', () => {
  /** a rig that can fly: it logs the pose changes into the world's event list */
  function flyingRig(f: ReturnType<typeof fakeWorld>, held = false) {
    let active = held;
    const rig = {
      camera: {},
      focus: f.focus,
      get cinematicActive() {
        return active;
      },
      cinematic: vi.fn(() => {
        active = true;
        f.events.push('pose');
      }),
      cancelCinematic: vi.fn(() => {
        active = false;
        f.events.push('unpose');
      }),
      update: vi.fn(() => void f.events.push('rig.update')),
    };
    (f.world.core as unknown as { rig: unknown }).rig = rig;
    return rig;
  }
  const core = (f: ReturnType<typeof fakeWorld>): WarmCore => f.world.core as unknown as WarmCore;

  it('does nothing for a rig that cannot fly (a stand-in core, a demo): no frame, no pose', () => {
    const f = fakeWorld({ shadows: true });
    expect(warmEstablishing(core(f))).toBe(false);
    expect(f.render).not.toHaveBeenCalled();
    expect(f.events).toEqual([]);
  });

  it('puts the camera on the pose, lets the zone create its content, draws one unculled frame, and puts the camera back', () => {
    const f = fakeWorld({ shadows: true });
    const rig = flyingRig(f);
    const refresh = vi.fn(() => void f.events.push('refresh'));
    expect(warmEstablishing(core(f), { refresh })).toBe(true);
    expect(f.events).toEqual(['pose', 'rig.update', 'followShadow', 'refresh', 'render', 'unpose', 'rig.update']);
    expect(rig.cinematic).toHaveBeenCalledWith(expect.objectContaining({ distance: 62 }), 2.5, { hold: true });
    expect(f.render).toHaveBeenCalledTimes(1);
    expect(f.seen[0]).toEqual(WARM); // both passes unculled, pooled content shown for the frame
    expect(f.prop.frustumCulled).toBe(true);
    expect(f.pooled.visible).toBe(false);
    expect(f.crowd.count).toBe(0);
    expect(rig.cinematicActive).toBe(false);
  });

  it('keeps a pose the caller already holds (the router keeps it for the fly-in): no new cinematic, no cancel', () => {
    const f = fakeWorld({ shadows: false });
    const rig = flyingRig(f, true);
    expect(warmEstablishing(core(f), { frames: 2 })).toBe(true);
    expect(rig.cinematic).not.toHaveBeenCalled();
    expect(rig.cancelCinematic).not.toHaveBeenCalled();
    expect(rig.cinematicActive).toBe(true);
    expect(f.render).toHaveBeenCalledTimes(2);
    expect(f.followShadow).not.toHaveBeenCalled();
  });

  it('puts the camera and the scene back when the refresh or the frame throws', () => {
    const f = fakeWorld({ shadows: true });
    const rig = flyingRig(f);
    expect(() => warmEstablishing(core(f), { refresh: () => { throw new Error('zone gone'); } })).toThrow('zone gone');
    expect(rig.cinematicActive).toBe(false);
    expect(f.render).not.toHaveBeenCalled();
    const g = fakeWorld({ shadows: true, throwOnRender: true });
    const rig2 = flyingRig(g);
    expect(() => warmEstablishing(core(g))).toThrow('lost context');
    expect(rig2.cinematicActive).toBe(false);
    expect(g.prop.frustumCulled).toBe(true);
    expect(g.pooled.visible).toBe(false);
    expect(g.crowd.count).toBe(0);
  });
});

