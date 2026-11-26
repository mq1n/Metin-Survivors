import { describe, expect, it, vi } from 'vitest';
import { AnimationMixer, Box3, DataTexture, RepeatWrapping, SkinnedMesh, Vector3, type AnimationClip, type Object3D } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { makePlaceholderModel, makePlaceholderTexture, makeTestCreature } from '../placeholders';
import { cpuMsPerCall, withinBudget } from '../perfBudget';
import type { PlaceholderModel } from '../../engine/assets';
import type { ModelKind } from '../../data/assetManifest';
import { Assets } from '../../engine/assets';
import { bakeModel } from '../../render/crowd/bake';
import { inferPlan } from './infer';

// Every test here builds meshes, skeletons and clips (the boss / brute archetypes and the hero kit take 3-4.5 s alone); the vitest
// default of 5 s is a hang guard that a loaded parallel run trips. The performance gate is the CPU-time budget below.
vi.setConfig({ testTimeout: 60_000 });

const CLIP_NAMES = ['idle', 'walk', 'run', 'attack', 'attack2', 'hit', 'death', 'spawn', 'special1'];

function skinned(scene: Object3D): SkinnedMesh[] {
  const out: SkinnedMesh[] = [];
  scene.traverse((o: Object3D) => {
    if (o instanceof SkinnedMesh) out.push(o);
  });
  return out;
}

function checkSkinning(m: PlaceholderModel, maxBones: number): void {
  const meshes = skinned(m.scene);
  expect(meshes.length).toBeGreaterThanOrEqual(1);
  const skeleton = (meshes[0] as SkinnedMesh).skeleton;
  expect(skeleton.bones.length).toBeLessThanOrEqual(maxBones);
  expect(skeleton.bones[0]?.name).toBe('root');
  for (const mesh of meshes) {
    expect(mesh.skeleton).toBe(skeleton);
    const g = mesh.geometry;
    for (const a of ['position', 'normal', 'color', 'skinIndex', 'skinWeight']) expect(g.getAttribute(a), a).toBeDefined();
    const si = g.getAttribute('skinIndex');
    const sw = g.getAttribute('skinWeight');
    expect(si.array).toBeInstanceOf(Uint16Array);
    expect(sw.array).toBeInstanceOf(Float32Array);
    expect(si.itemSize).toBe(4);
    for (let i = 0; i < sw.count; i++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(i, k);
        expect(w).toBeGreaterThanOrEqual(0);
        sum += w;
        if (w > 0) expect(si.getComponent(i, k)).toBeLessThan(skeleton.bones.length);
      }
      expect(sum).toBeGreaterThan(0.999);
      expect(sum).toBeLessThan(1.001);
    }
  }
}

function checkExtras(m: PlaceholderModel): void {
  const ex = m.scene.userData as Record<string, unknown>;
  expect(ex.id).toBe(m.asset.id);
  expect(ex.kind).toBe(m.asset.kind);
  expect(ex.height).toBe(m.asset.height);
  expect(ex.radius).toBe(m.asset.radius);
  expect(ex.hit).toEqual(m.asset.hit);
  expect(ex.sockets).toEqual(m.asset.sockets);
  expect(m.asset.url).toBe('');
  expect(m.asset.tris).toBeGreaterThan(0);
  expect(m.asset.bytes).toBeGreaterThan(0);
  expect(m.asset.palette?.length).toBeGreaterThan(0);
}

/** CPU skin: max distance of any skinned vertex from the rest-pose bounding box centre, sampled across a clip. */
function maxExtent(m: PlaceholderModel, clip: AnimationClip, samples = 9): { lowest: number; highest: number; reach: number } {
  const root = cloneSkinned(m.scene);
  const mixer = new AnimationMixer(root);
  mixer.clipAction(clip).play();
  const meshes = skinned(root);
  const v = new Vector3();
  let lowest = Infinity;
  let highest = -Infinity;
  let reach = 0;
  for (let s = 0; s <= samples; s++) {
    mixer.setTime((s / samples) * clip.duration);
    root.updateMatrixWorld(true);
    for (const mesh of meshes) {
      mesh.skeleton.update();
      const n = mesh.geometry.getAttribute('position').count;
      for (let i = 0; i < n; i += 5) {
        mesh.getVertexPosition(i, v);
        expect(Number.isFinite(v.x + v.y + v.z)).toBe(true);
        lowest = Math.min(lowest, v.y);
        highest = Math.max(highest, v.y);
        reach = Math.max(reach, Math.hypot(v.x, v.z));
      }
    }
  }
  return { lowest, highest, reach };
}

describe('makeTestCreature', () => {
  it('builds a quadruped in under 50 ms with the contract clip set', () => {
    makeTestCreature({ seed: 2 });
    // 50 ms per build, in CPU time averaged over a batch of builds (a single ~10 ms wall-clock sample is dominated by
    // whatever else the machine is doing), see dev/perfBudget.ts. A build costs ~10-15 ms of CPU.
    const build = withinBudget(() => ({ value: 0, ms: cpuMsPerCall((i) => makeTestCreature({ seed: 10 + (i % 4) })) }), { baseMs: 50 });
    expect(build.ms, build.log).toBeLessThanOrEqual(build.budget);
    const m = makeTestCreature({ seed: 13 });
    const names = m.clips.map((c) => c.name);
    for (const n of CLIP_NAMES) expect(names).toContain(n);
    expect(skinned(m.scene)).toHaveLength(1);
    expect(m.asset.bones).toBeLessThanOrEqual(32);
    expect(m.asset.tris).toBeGreaterThan(1500);
    expect(m.asset.tris).toBeLessThan(5500);
    checkSkinning(m, 32);
    checkExtras(m);
  }, 60_000);

  it('is deterministic per seed and varies between seeds', () => {
    const a = makeTestCreature({ seed: 5 });
    const b = makeTestCreature({ seed: 5 });
    const c = makeTestCreature({ seed: 6 });
    const pa = (skinned(a.scene)[0] as SkinnedMesh).geometry.getAttribute('position').array;
    const pb = (skinned(b.scene)[0] as SkinnedMesh).geometry.getAttribute('position').array;
    const pc = (skinned(c.scene)[0] as SkinnedMesh).geometry.getAttribute('position').array;
    expect(Array.from(pa.slice(0, 60))).toEqual(Array.from(pb.slice(0, 60)));
    expect(pc.length === pa.length && Array.from(pc.slice(0, 60)).every((x, i) => x === pa[i])).toBe(false);
  });

  it('re-targets the skeleton to the requested bone count and stays animatable', () => {
    const natural = makeTestCreature({ seed: 3 }).asset.bones;
    for (const want of [12, natural, 40]) {
      const m = makeTestCreature({ seed: 3, bones: want });
      expect(m.asset.bones).toBe(Math.max(want, 1 + new Set(Object.values(m.asset.sockets ?? {})).size));
      checkSkinning(m, want);
      const names = new Set((skinned(m.scene)[0] as SkinnedMesh).skeleton.bones.map((b) => b.name));
      for (const bone of Object.values(m.asset.sockets ?? {})) expect(names.has(bone), `socket bone ${bone}`).toBe(true);
      for (const c of m.clips) for (const t of c.tracks) expect(names.has(t.name.slice(0, t.name.lastIndexOf('.'))), t.name).toBe(true);
      const walk = m.clips.find((c) => c.name === 'walk') as AnimationClip;
      const rest = maxExtent(m, walk, 4);
      expect(rest.reach).toBeLessThan(m.asset.height * 3);
      expect(rest.lowest).toBeGreaterThan(-0.4);
    }
  });
});

describe('creature archetypes', () => {
  for (const [arch, maxBones, maxTris] of [
    ['quadruped', 32, 5500],
    ['humanoid', 32, 5500],
    ['brute', 32, 5500],
    ['boss', 48, 15000],
  ] as const) {
    it(`${arch}: one skinned mesh, normalised weights, budgets, animation sanity`, () => {
      const m = makeTestCreature({ archetype: arch, seed: 3 });
      expect(skinned(m.scene)).toHaveLength(1);
      expect(m.asset.tris).toBeLessThanOrEqual(maxTris);
      checkSkinning(m, maxBones);
      checkExtras(m);
      const info = m.asset.clips;
      for (const n of CLIP_NAMES) expect(info[n]?.duration, n).toBeGreaterThan(0.2);
      for (const n of ['idle', 'walk', 'run']) expect(info[n]?.loop).toBe(true);
      for (const n of ['attack', 'attack2', 'death', 'spawn']) expect(info[n]?.loop).toBe(false);
      expect(m.asset.hit?.attack).toBeGreaterThan(0.1);
      expect(m.asset.hit?.attack).toBeLessThan((info.attack?.duration ?? 0) * 0.9);
      if (arch === 'boss') {
        expect(info.special2).toBeDefined();
        expect(m.asset.height).toBeGreaterThan(3.5);
      }
      for (const sock of ['head', 'hand_r', 'hand_l', 'back', 'muzzle', 'chest']) {
        const bone = m.asset.sockets?.[sock];
        expect(bone, sock).toBeDefined();
        expect(m.scene.getObjectByName(bone as string), sock).toBeDefined();
      }
      const rest = new Box3().setFromObject(m.scene);
      const restH = rest.max.y;
      for (const clip of m.clips) {
        const e = maxExtent(m, clip, 8);
        // skinning must not explode: everything stays within ~2.5× the creature size
        expect(e.highest, `${clip.name} high`).toBeLessThan(restH * 2.5 + 1);
        expect(e.lowest, `${clip.name} low`).toBeGreaterThan(-restH * 1.2);
        expect(e.reach, `${clip.name} reach`).toBeLessThan(restH * 2.5 + 1);
      }
      // death ends in a collapsed pose
      const death = m.clips.find((c) => c.name === 'death') as AnimationClip;
      const root = cloneSkinned(m.scene);
      const mixer = new AnimationMixer(root);
      mixer.clipAction(death).play();
      mixer.setTime(death.duration - 1e-3);
      root.updateMatrixWorld(true);
      const bone = new Vector3();
      let top = -Infinity;
      let bottom = Infinity;
      for (const b of (skinned(root)[0] as SkinnedMesh).skeleton.bones) {
        b.getWorldPosition(bone);
        top = Math.max(top, bone.y);
        bottom = Math.min(bottom, bone.y);
      }
      // a dead quadruped lies on its side with a couple of legs still in the air
      expect(top, 'collapsed: every bone near the ground').toBeLessThan(restH * (arch === 'quadruped' ? 0.8 : 0.45));
      expect(bottom, 'nothing buried').toBeGreaterThan(-restH * 0.12);
    });
  }

  it('different ids of one archetype look different', async () => {
    const a = await makePlaceholderModel('wolf_a', 'creature');
    const b = await makePlaceholderModel('boar_b', 'creature');
    const c = await makePlaceholderModel('orc_a', 'creature');
    const d = await makePlaceholderModel('orc_b', 'creature');
    expect(a.asset.palette).not.toEqual(b.asset.palette);
    expect(a.asset.height).not.toBeCloseTo(b.asset.height, 2);
    expect(c.asset.palette).not.toEqual(d.asset.palette);
  });
});

describe('makePlaceholderModel inference', () => {
  it('maps ids to archetypes', () => {
    const arch = (id: string, hint?: ModelKind): string => {
      const p = inferPlan(id, hint);
      return p.type === 'creature' ? p.archetype : p.type;
    };
    expect(arch('bench_quadruped', 'creature')).toBe('quadruped');
    expect(arch('bench_humanoid', 'creature')).toBe('humanoid');
    expect(arch('bench_brute', 'creature')).toBe('brute');
    expect(arch('bench_boss', 'creature')).toBe('boss');
    expect(arch('wolf_alpha', 'creature')).toBe('quadruped');
    expect(arch('boar_a', 'creature')).toBe('quadruped');
    expect(arch('tiger_a', 'creature')).toBe('quadruped');
    expect(arch('orc_grunt', 'creature')).toBe('humanoid');
    expect(arch('ninja_shadow', 'creature')).toBe('humanoid');
    expect(arch('golem_a', 'creature')).toBe('brute');
    expect(arch('yeti_b', 'creature')).toBe('brute');
    expect(arch('boss_tiger', 'boss')).toBe('boss');
    expect(arch('hero_warrior_m_t1', 'hero')).toBe('hero');
    expect(arch('hero_ninja_f_t2')).toBe('hero');
    expect(arch('weapon_sword', 'weapon')).toBe('weapon');
    expect(arch('metin_lament', 'metin')).toBe('metin');
    for (const id of ['xp_gem', 'yeop_coin', 'potion_hp', 'chest_wood', 'chest_gold', 'chest_boss']) expect(arch(id, 'pickup')).toBe('pickup');
    expect(arch('pine_a', 'tree')).toBe('prop');
  });
});

describe('heroes and weapons', () => {
  it('builds each class with body/hair/armor sharing one skeleton and the hero clip set', async () => {
    for (const cls of ['warrior', 'ninja', 'yacha', 'shaman', 'wolfman']) {
      const m = await makePlaceholderModel(`hero_${cls}_m_t2`, 'hero');
      const meshes = skinned(m.scene);
      expect(meshes.length).toBeGreaterThanOrEqual(1);
      expect(meshes.length).toBeLessThanOrEqual(3);
      expect(m.asset.kind).toBe('hero');
      checkSkinning(m, 32);
      checkExtras(m);
      expect(m.asset.tris).toBeLessThan(14000);
      for (const n of [...CLIP_NAMES, 'cast', 'dash', 'victory']) expect(m.asset.clips[n], `${cls} ${n}`).toBeDefined();
      expect(m.scene.getObjectByName(m.asset.sockets?.hand_r as string)).toBeDefined();
      expect(m.asset.height).toBeGreaterThan(1.6);
      expect(m.asset.height).toBeLessThan(2.2);
    }
  }, 30_000);

  it('builds static weapons within the triangle budget', async () => {
    for (const w of ['sword', 'dagger', 'blade_yacha', 'bow', 'staff', 'fan', 'bell', 'claw']) {
      const m = await makePlaceholderModel(`weapon_${w}`, 'weapon');
      expect(skinned(m.scene)).toHaveLength(0);
      expect(m.asset.kind).toBe('weapon');
      expect(m.asset.tris).toBeLessThanOrEqual(1500);
      checkExtras(m);
    }
  });
});

describe('metin, pickups, props, textures', () => {
  it('metin has drop/idle/pulse/shatter and shatter ends collapsed', async () => {
    const m = await makePlaceholderModel('metin_lament', 'metin');
    for (const n of ['drop', 'idle', 'pulse', 'shatter']) expect(m.asset.clips[n], n).toBeDefined();
    expect(m.asset.clips.idle?.loop).toBe(true);
    expect(m.asset.clips.pulse?.loop).toBe(true);
    expect(m.asset.clips.shatter?.loop).toBe(false);
    expect(m.asset.bones).toBeLessThanOrEqual(32);
    checkSkinning(m, 32);
    checkExtras(m);
    const shatter = m.clips.find((c) => c.name === 'shatter') as AnimationClip;
    const mid = maxExtent(m, shatter, 4);
    expect(mid.reach).toBeGreaterThan(1.2);
    const root = cloneSkinned(m.scene);
    const mixer = new AnimationMixer(root);
    mixer.clipAction(shatter).play();
    mixer.setTime(shatter.duration - 1e-3);
    root.updateMatrixWorld(true);
    const bones = (skinned(root)[0] as SkinnedMesh).skeleton.bones.filter((b) => b.name.startsWith('chunk') || b.name.startsWith('shard') || b.name.startsWith('frag'));
    expect(bones.length).toBeGreaterThan(10);
    for (const b of bones) expect(b.scale.x, b.name).toBeLessThan(0.08);
  });

  it('pickups are static; chests and props within budget', async () => {
    for (const id of ['xp_gem', 'yeop_coin', 'potion_hp', 'chest_wood', 'chest_gold', 'chest_boss']) {
      const m = await makePlaceholderModel(id, 'pickup');
      expect(skinned(m.scene)).toHaveLength(0);
      expect(m.asset.kind).toBe('pickup');
      expect(m.asset.tris).toBeLessThan(2500);
      checkExtras(m);
    }
    for (const [id, hint] of [['pine_a', 'tree'], ['oak_a', 'tree'], ['rock_a', 'prop'], ['lantern_a', 'prop']] as const) {
      const m = await makePlaceholderModel(id, hint);
      expect(m.asset.tris).toBeLessThan(3000);
      checkExtras(m);
    }
  });

  it('textures are tileable 256² sRGB data textures', () => {
    const t = makePlaceholderTexture('tex_grass_a');
    if (!(t instanceof DataTexture)) throw new Error('expected a DataTexture');
    expect(t.image.width).toBe(256);
    expect(t.wrapS).toBe(RepeatWrapping);
    expect(t.colorSpace).toBe('srgb');
    const n = makePlaceholderTexture('something_neutral');
    if (!(n instanceof DataTexture)) throw new Error('expected a DataTexture');
    expect(n.image.width).toBe(256);
    const a = t.image.data as Uint8Array;
    // seamless: first/last row & column are close
    let diff = 0;
    for (let i = 0; i < 256; i++) diff += Math.abs((a[(0 * 256 + i) * 4] as number) - (a[(255 * 256 + i) * 4] as number)) + Math.abs((a[(i * 256) * 4 + 1] as number) - (a[(i * 256 + 255) * 4 + 1] as number));
    expect(diff / 512).toBeLessThan(18);
  });
});

describe('engine integration', () => {
  it('loads through Assets (DEV placeholder path) and bakes for the crowd renderer', async () => {
    const assets = new Assets('/');
    const cases: [string, ModelKind, number][] = [
      ['wolf_a', 'creature', 32],
      ['orc_a', 'creature', 32],
      ['golem_a', 'creature', 32],
      ['boss_oni', 'boss', 48],
      ['hero_yacha_f_t1', 'hero', 32],
    ];
    for (const [id, hint, maxBones] of cases) {
      const lm = await assets.loadModel(id, hint);
      expect(lm.placeholder).toBe(true);
      expect(lm.skinned.length).toBeGreaterThanOrEqual(1);
      const baked = bakeModel(lm);
      expect(baked.boneCount).toBeLessThanOrEqual(maxBones);
      expect(baked.clips.has('death')).toBe(true);
      const data = baked.texture.image.data as Uint16Array;
      let nonZero = 0;
      for (let i = 0; i < data.length; i += 97) if (data[i] !== 0) nonZero++;
      expect(nonZero).toBeGreaterThan(10);
      baked.dispose();
    }
  }, 30_000);
});
