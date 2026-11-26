import { BoxGeometry, BufferAttribute, Color, DataTexture, Group, InstancedBufferGeometry, Mesh, MeshBasicMaterial, MeshStandardMaterial, Scene, ShaderMaterial, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { LoadedModel } from '../../engine/assets';
import type { RenderCore } from '../core';
import { PICKUP_CHEST, PICKUP_MAGNET, PICKUP_POTION, PICKUP_XP, PICKUP_YEOP } from '../feed';
import {
  BEAM_DIRECT_GAIN,
  BEAM_EDGE_START,
  BEAM_TAPER_POW,
  BEAM_TOP_WIDTH,
  GLOW_FRAG,
  GLOW_VORTEX,
  MESH_FRAG,
  PICKUP_BEAM_ORDER,
  PICKUP_CAP_BY_TIER,
  PICKUP_CHEST_ORDER,
  PICKUP_MODELS,
  Pickups,
  YEOP_HALO,
  XP_TIER_HEX,
  XP_TIER_SCALE,
  bakePickupGeometry,
  buildPickupVisuals,
  chestBeamProfile,
  drawsAfterBeam,
  pickupMatOf,
  pickupRoot,
  pickupVisual,
} from './pickups';

describe('PICKUP_MODELS', () => {
  it('lists the FORGE pickup ids from the contract; a shared file is told apart by its node (r8 K8: the yeop tiers are nodes of yeop_coin)', () => {
    expect(PICKUP_MODELS.map((m) => m.id)).toEqual(['xp_gem', 'yeop_coin', 'potion_hp', 'chest_wood', 'chest_gold', 'chest_boss', 'yeop_coin', 'yeop_coin']);
    expect(new Set(PICKUP_MODELS.map((m) => m.key)).size).toBe(PICKUP_MODELS.length);
    expect(new Set(PICKUP_MODELS.map((m) => `${m.id}#${m.node ?? ''}`)).size).toBe(PICKUP_MODELS.length);
    expect(['yeop', 'yeop2', 'yeop3'].map((k) => PICKUP_MODELS.find((m) => m.key === k)!.node)).toEqual(['yeop_t0', 'yeop_t1', 'yeop_t2']);
    // every other row bakes its whole file
    for (const m of PICKUP_MODELS.filter((x) => !x.key.startsWith('yeop'))) expect(m.node).toBeUndefined();
  });
  it('r8 K8: pickupRoot bakes the named node when the GLB has it, else the whole scene (an older single-coin file keeps working)', () => {
    const scene = new Group();
    const t0 = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    t0.name = 'yeop_t0';
    const t1 = new Mesh(new BoxGeometry(2, 1, 1), new MeshBasicMaterial());
    t1.name = 'yeop_t1';
    scene.add(t0, t1);
    const row = (k: string): (typeof PICKUP_MODELS)[number] => PICKUP_MODELS.find((m) => m.key === k)!;
    expect(pickupRoot(scene, row('yeop'))).toBe(t0);
    expect(pickupRoot(scene, row('yeop2'))).toBe(t1);
    expect(pickupRoot(scene, row('yeop3'))).toBe(scene);
    expect(pickupRoot(scene, row('xp'))).toBe(scene);
    // the node bake sees only its own mesh: a 2 x 1 x 1 box scaled to the row size
    const baked = bakePickupGeometry(pickupRoot(scene, row('yeop2')), 0.5);
    expect(baked.width).toBeCloseTo(0.5, 5);
    expect(baked.height).toBeCloseTo(0.25, 5);
  });
  it('r9 K9: the tier-0 coin is 0.38-0.40 m (about the smallest gem), the coin every heap is built from', () => {
    const coin = PICKUP_MODELS.find((m) => m.key === 'yeop')!;
    const gem = PICKUP_MODELS.find((m) => m.key === 'xp')!;
    expect(coin.size * 1.05).toBeGreaterThanOrEqual(0.38);
    expect(coin.size * 1.05).toBeCloseTo(0.4, 3);
    expect(coin.size * 1.05).toBeGreaterThan(gem.size * 0.85);
  });
  it('r7 K7 / r9 K9: the yeop heaps rest on the ground (no bob / spin / wobble, a random yaw) and are heaps of the tier-0 coin', () => {
    const coin = PICKUP_MODELS.find((m) => m.key === 'yeop')!;
    for (const k of ['yeop2', 'yeop3'] as const) {
      const m = PICKUP_MODELS.find((x) => x.key === k)!;
      expect(m.bob).toBe(0);
      expect(m.spin).toBe(0);
      expect(m.wobble).toBe(0);
      expect(m.hover).toBeLessThan(0.05);
      expect(m.yaw).toBeCloseTo(Math.PI * 2, 6);
      // r9 K9: a heap of 0.40 m coins (the tier-0 coin): 1.4-2.4 coin diameters across, never a single bigger coin
      expect(m.size).toBeGreaterThan(coin.size * 1.05 * 1.4);
      expect(m.size).toBeLessThan(coin.size * 1.05 * 2.4);
    }
    expect(PICKUP_MODELS.find((x) => x.key === 'yeop3')!.size).toBeGreaterThan(PICKUP_MODELS.find((x) => x.key === 'yeop2')!.size);
  });
  it('chests are larger than gems/coins/potions and do not float', () => {
    const size = (k: string): number => PICKUP_MODELS.find((m) => m.key === k)?.size ?? 0;
    expect(size('chest0')).toBeGreaterThan(size('potion'));
    expect(size('chest2')).toBeGreaterThan(size('chest1'));
    expect(size('chest1')).toBeGreaterThan(size('chest0'));
    for (const m of PICKUP_MODELS.filter((x) => x.key.startsWith('chest'))) {
      expect(m.hover).toBe(0);
      expect(m.bob).toBe(0);
    }
  });
});

describe('chest light beam draw order (r4 kp4: no lancet window over the chest)', () => {
  it('the chest models draw right after their light planes, below every other transparent layer (ground decals -20 and up)', () => {
    expect(PICKUP_BEAM_ORDER).toBeLessThan(PICKUP_CHEST_ORDER);
    expect(PICKUP_CHEST_ORDER - PICKUP_BEAM_ORDER).toBe(1);
    expect(PICKUP_CHEST_ORDER).toBeLessThan(-20);
  });
  it('exactly the chests draw after the beam, and every visual with a beam uses one of them', () => {
    expect(PICKUP_MODELS.filter(drawsAfterBeam).map((m) => m.id)).toEqual(['chest_wood', 'chest_gold', 'chest_boss']);
    const table = buildPickupVisuals();
    for (const v of table) if (v && v.beamHeight > 0) expect(drawsAfterBeam(PICKUP_MODELS[v.model]!)).toBe(true);
    for (const v of table) if (v && !drawsAfterBeam(PICKUP_MODELS[v.model]!)) expect(v.beamHeight).toBe(0);
  });
});

describe('pickupVisual', () => {
  const table = buildPickupVisuals();

  it('xp gems use model 0 and grow with tier; five distinct tints', () => {
    const tints = new Set<string>();
    let prev = 0;
    for (let t = 0; t < 5; t++) {
      const v = pickupVisual(table, PICKUP_XP, t);
      expect(v.model).toBe(0);
      expect(v.scale).toBe(XP_TIER_SCALE[t]);
      expect(v.scale).toBeGreaterThan(prev);
      prev = v.scale;
      tints.add(v.tint.map((c) => c.toFixed(3)).join(','));
    }
    expect(tints.size).toBe(5);
    expect(XP_TIER_HEX).toHaveLength(5);
  });
  it('tier 0..4 are blue, green, violet, gold, diamond-white; never fire-orange / red', () => {
    const dom = (t: number): number => {
      const [r, g, b] = pickupVisual(table, PICKUP_XP, t).tint;
      return b > r && b > g ? 2 : r >= g && r >= b ? 0 : 1;
    };
    expect(dom(0)).toBe(2); // blue
    expect(dom(1)).toBe(1); // green
    expect(dom(2)).toBe(2); // violet
    for (let t = 0; t < 5; t++) {
      const [r, g, b] = pickupVisual(table, PICKUP_XP, t).tint;
      // orange / red = red far above both other channels
      expect(r > 2 * g && r > 2 * b).toBe(false);
    }
  });
  it('r7 K7: yeop tier 0 is the single coin, tiers 1 and 2 the 2- and 3-coin heaps at their own size; the yeop halo is dimmed, the pool is not', () => {
    const key = (t: number): string => PICKUP_MODELS[pickupVisual(table, PICKUP_YEOP, t).model]!.key;
    expect([0, 1, 2].map(key)).toEqual(['yeop', 'yeop2', 'yeop3']);
    expect(pickupVisual(table, PICKUP_YEOP, 0).scale).toBeGreaterThan(1);
    expect(pickupVisual(table, PICKUP_YEOP, 1).scale).toBe(1);
    expect(pickupVisual(table, PICKUP_YEOP, 2).scale).toBe(1);
    for (let t = 0; t < 3; t++) {
      const v = pickupVisual(table, PICKUP_YEOP, t);
      expect(v.halo).toBe(YEOP_HALO);
      expect(v.pool).toBeGreaterThan(0);
      expect(v.ring).toBe(true);
    }
    expect(YEOP_HALO).toBeGreaterThan(0.2);
    expect(YEOP_HALO).toBeLessThan(1);
    // every other visual keeps the full halo
    for (const k of [PICKUP_XP, PICKUP_POTION, PICKUP_CHEST, PICKUP_MAGNET]) expect(pickupVisual(table, k, 0).halo).toBe(1);
    // tiers still grow: the pool and the glint of a heap are at least the tier below's
    for (let t = 1; t < 3; t++) {
      expect(pickupVisual(table, PICKUP_YEOP, t).pool).toBeGreaterThan(pickupVisual(table, PICKUP_YEOP, t - 1).pool);
      expect(pickupVisual(table, PICKUP_YEOP, t).glint).toBeGreaterThan(pickupVisual(table, PICKUP_YEOP, t - 1).glint);
    }
  });
  it('maps other kinds to their models and chest tiers to the three chest models', () => {
    expect(pickupVisual(table, PICKUP_YEOP, 0).model).toBe(1);
    expect(pickupVisual(table, PICKUP_POTION, 0).model).toBe(2);
    expect(pickupVisual(table, PICKUP_CHEST, 0).model).toBe(3);
    expect(pickupVisual(table, PICKUP_CHEST, 1).model).toBe(4);
    expect(pickupVisual(table, PICKUP_CHEST, 2).model).toBe(5);
  });
  it('chests carry a light beam, small pickups do not', () => {
    for (let t = 0; t < 3; t++) expect(pickupVisual(table, PICKUP_CHEST, t).beamHeight).toBeGreaterThan(0);
    expect(pickupVisual(table, PICKUP_XP, 0).beamHeight).toBe(0);
    expect(pickupVisual(table, PICKUP_CHEST, 2).beamHeight).toBeGreaterThan(pickupVisual(table, PICKUP_CHEST, 0).beamHeight);
  });
  it('the magnet/vacuum pickup is the big vortex gem', () => {
    const v = pickupVisual(table, PICKUP_MAGNET, 0);
    expect(v.glowType).toBe(GLOW_VORTEX);
    expect(v.scale).toBeGreaterThan(pickupVisual(table, PICKUP_XP, 4).scale);
  });
  it('clamps tiers beyond what a kind defines and tolerates unknown kinds', () => {
    expect(pickupVisual(table, PICKUP_YEOP, 9)).toBe(pickupVisual(table, PICKUP_YEOP, 2));
    expect(pickupVisual(table, PICKUP_XP, -3)).toBe(pickupVisual(table, PICKUP_XP, 0));
    expect(pickupVisual(table, PICKUP_POTION, 4)).toBe(pickupVisual(table, PICKUP_POTION, 0));
    expect(pickupVisual(table, 99, 0)).toBe(pickupVisual(table, PICKUP_XP, 0));
  });
});

describe('pickupMatOf (r7 K7: a GLB may carry its own pickup shading)', () => {
  const coin = PICKUP_MODELS.find((m) => m.key === 'yeop')!;
  it('takes a well-formed scene-extras pickupMat, otherwise the table mat (every shipped GLB has none)', () => {
    expect(pickupMatOf(coin, { pickupMat: [0.6, 1, 0.22, 0] })).toEqual([0.6, 1, 0.22, 0]);
    expect(pickupMatOf(coin, {})).toBe(coin.mat);
    expect(pickupMatOf(coin, undefined)).toBe(coin.mat);
    expect(pickupMatOf(coin, null)).toBe(coin.mat);
    expect(pickupMatOf(coin, { pickupMat: [0.6, 1, 0.22] })).toBe(coin.mat);
    expect(pickupMatOf(coin, { pickupMat: [0.6, 'x', 0.22, 0] })).toBe(coin.mat);
    expect(pickupMatOf(coin, { pickupMat: [0.6, Number.NaN, 0.22, 0] })).toBe(coin.mat);
    expect(pickupMatOf(coin, { pickupMat: [-1, 1, 0.22, 0] })).toBe(coin.mat);
    expect(pickupMatOf(coin, { pickupMat: 'gold' })).toBe(coin.mat);
  });
});

describe('PICKUP_CAP_BY_TIER', () => {
  it('never exceeds the sim cap and does not shrink with quality', () => {
    expect(PICKUP_CAP_BY_TIER.ultra).toBeLessThanOrEqual(1200);
    expect(PICKUP_CAP_BY_TIER.low).toBeLessThan(PICKUP_CAP_BY_TIER.medium);
    expect(PICKUP_CAP_BY_TIER.medium).toBeLessThanOrEqual(PICKUP_CAP_BY_TIER.high);
  });
});

describe('bakePickupGeometry', () => {
  const boxMesh = (w: number, h: number, d: number, x: number, y: number, z: number): Mesh => {
    const m = new Mesh(new BoxGeometry(w, h, d), new MeshBasicMaterial());
    m.position.set(x, y, z);
    return m;
  };

  it('normalises the largest side to `size`, centres X/Z and puts the base on y = 0', () => {
    const root = new Group();
    root.add(boxMesh(2, 4, 1, 3, 5, -2));
    const b = bakePickupGeometry(root, 0.5);
    expect(b.height).toBeCloseTo(0.5, 5);
    expect(b.width).toBeCloseTo(0.25, 5);
    expect(b.depth).toBeCloseTo(0.125, 5);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < b.position.length; i += 3) {
      minX = Math.min(minX, b.position[i] as number);
      maxX = Math.max(maxX, b.position[i] as number);
      minY = Math.min(minY, b.position[i + 1] as number);
      minZ = Math.min(minZ, b.position[i + 2] as number);
      maxZ = Math.max(maxZ, b.position[i + 2] as number);
    }
    expect(minY).toBeCloseTo(0, 5);
    expect(minX + maxX).toBeCloseTo(0, 5);
    expect(minZ + maxZ).toBeCloseTo(0, 5);
  });
  it('size does not depend on the source scale (a flat coin lying down keeps its diameter)', () => {
    const root = new Group();
    root.add(boxMesh(1, 0.1, 1, 0, 0, 0));
    const b = bakePickupGeometry(root, 0.4);
    expect(b.width).toBeCloseTo(0.4, 5);
    expect(b.height).toBeCloseTo(0.04, 5);
  });
  it('bakes parent transforms and merges several meshes', () => {
    const root = new Group();
    root.scale.set(2, 2, 2);
    root.add(boxMesh(1, 1, 1, 0, 0.5, 0), boxMesh(1, 1, 1, 0, 1.5, 0));
    const b = bakePickupGeometry(root, 1);
    expect(b.height).toBeCloseTo(1, 5);
    expect(b.position.length / 3).toBe(48);
    expect(b.index.length).toBe(2 * 36);
    // second mesh's indices are offset past the first mesh's vertices
    expect(Math.max(...Array.from(b.index))).toBe(47);
  });
  it('uses vertex colours multiplied by the material colour, white when absent', () => {
    const m = boxMesh(1, 1, 1, 0, 0, 0);
    const n = m.geometry.getAttribute('position').count;
    const colors = new Float32Array(n * 3).fill(0.5);
    m.geometry.setAttribute('color', new BufferAttribute(colors, 3));
    (m.material as MeshBasicMaterial).color.setRGB(0.5, 1, 0.25, 'srgb-linear');
    const root = new Group();
    root.add(m);
    const b = bakePickupGeometry(root, 1);
    expect(b.color[0]).toBeCloseTo(0.25, 5);
    expect(b.color[1]).toBeCloseTo(0.5, 5);
    expect(b.color[2]).toBeCloseTo(0.125, 5);

    const plain = new Group();
    plain.add(boxMesh(1, 1, 1, 0, 0, 0));
    const p = bakePickupGeometry(plain, 1);
    expect(Array.from(p.color.slice(0, 3))).toEqual([1, 1, 1]);
  });
  it('handles non-indexed geometry and generates missing normals', () => {
    const g = new BoxGeometry(1, 1, 1).toNonIndexed();
    g.deleteAttribute('normal');
    const root = new Group();
    root.add(new Mesh(g, new MeshBasicMaterial()));
    const b = bakePickupGeometry(root, 1);
    expect(b.index.length).toBe(36);
    const len = Math.hypot(b.normal[0] as number, b.normal[1] as number, b.normal[2] as number);
    expect(len).toBeCloseTo(1, 5);
  });
  it('throws for models without meshes', () => {
    expect(() => bakePickupGeometry(new Group(), 1)).toThrow();
  });
  it('E1 texture path: a model with a base-colour map and TEXCOORD_0 bakes uv + map, a plain model leaves both undefined', () => {
    const tex = new DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1);
    const textured = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ map: tex }));
    const root = new Group();
    root.add(textured);
    const b = bakePickupGeometry(root, 1);
    expect(b.map).toBe(tex);
    const n = textured.geometry.getAttribute('position').count;
    expect(b.uv).toBeInstanceOf(Float32Array);
    expect(b.uv?.length).toBe(n * 2);
    const src = textured.geometry.getAttribute('uv');
    expect(b.uv?.[2]).toBeCloseTo(src.getX(1), 6);
    expect(b.uv?.[3]).toBeCloseTo(src.getY(1), 6);

    const plain = new Group();
    plain.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()));
    const p = bakePickupGeometry(plain, 1);
    expect(p.map).toBeUndefined();
    expect(p.uv).toBeUndefined();
    expect('uv' in p).toBe(false);
    expect('map' in p).toBe(false);
  });
  it('r7 K7 emissive-map path: a textured mesh with an emissive map bakes emisMap + emisCol (emissive x intensity); otherwise both stay undefined', () => {
    const tex = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    const em = new DataTexture(new Uint8Array([255, 128, 0, 255]), 1, 1);
    const mat = new MeshStandardMaterial({ map: tex, emissiveMap: em, emissive: 0xffffff, emissiveIntensity: 2.4 });
    const root = new Group();
    root.add(new Mesh(new BoxGeometry(1, 1, 1), mat));
    const b = bakePickupGeometry(root, 1);
    expect(b.map).toBe(tex);
    expect(b.emisMap).toBe(em);
    expect(b.emisCol?.map((c) => +c.toFixed(4))).toEqual([2.4, 2.4, 2.4]);

    // no base-colour map (vertex-colour path): the emissive map is not used
    const noMap = new Group();
    noMap.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ emissiveMap: em })));
    const n = bakePickupGeometry(noMap, 1);
    expect(n.emisMap).toBeUndefined();
    expect('emisMap' in n).toBe(false);
    // textured without an emissive map: unchanged E1 result
    const plain = new Group();
    plain.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ map: tex })));
    const p = bakePickupGeometry(plain, 1);
    expect(p.map).toBe(tex);
    expect('emisMap' in p).toBe(false);
    expect('emisCol' in p).toBe(false);
  });
  it('r7 K7 spec mask: on the texture path the map alpha scales the specular term only (an RGB map samples 1.0), the vertex-colour path keeps 1.0', () => {
    const tex = MESH_FRAG.slice(MESH_FRAG.indexOf('vec4 texel = texture2D(uMap, vUv);'), MESH_FRAG.indexOf('#ifdef PICKUP_EMIS\n  // r8'));
    expect(tex).toContain('float specK = texel.a;');
    expect(tex).toContain('#else');
    expect(tex.slice(tex.indexOf('#else'))).toContain('float specK = 1.0;');
    expect(MESH_FRAG).toContain('* uMat.x * specK;');
    // only the specular term: diffuse and emissive never read specK (declared twice, scaled by the emissive alpha once, used once)
    expect(MESH_FRAG.match(/specK/g)?.length).toBe(4);
    expect(MESH_FRAG).toContain('rgb += emTexel.rgb * uEmisCol * vEmis;');
  });
  it('r8 K8 spec mask in the emissive alpha: sampled once under PICKUP_EMIS before the lighting, multiplies specK, and feeds the glow', () => {
    const at = MESH_FRAG.indexOf('vec4 emTexel = texture2D(uEmisMap, vUv);');
    expect(at).toBeGreaterThan(0);
    expect(MESH_FRAG.lastIndexOf('#ifdef PICKUP_EMIS', at)).toBeGreaterThan(MESH_FRAG.indexOf('float specK = 1.0;'));
    expect(MESH_FRAG.slice(at, at + 120)).toContain('specK *= emTexel.a;');
    expect(at).toBeLessThan(MESH_FRAG.indexOf('vec3 R = reflect(-V, N);'));
    // the emissive texture is sampled exactly once
    expect(MESH_FRAG.match(/texture2D\(uEmisMap/g)?.length).toBe(1);
  });
  it('E1: a map without TEXCOORD_0 stays on the vertex-colour path', () => {
    const g = new BoxGeometry(1, 1, 1);
    g.deleteAttribute('uv');
    const root = new Group();
    root.add(new Mesh(g, new MeshStandardMaterial({ map: new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1) })));
    const b = bakePickupGeometry(root, 1);
    expect(b.map).toBeUndefined();
    expect(b.uv).toBeUndefined();
  });
});

describe('chest light plane: a soft additive column, never a dark window (PICK-01)', () => {
  const grid: number[] = [];
  for (let i = 0; i <= 40; i++) grid.push(i / 40);

  it('adds light only: the profile is within [0, 1] everywhere, also outside the plane and past the top', () => {
    for (const y of [-0.5, ...grid, 1.5]) {
      for (const x of [-2, -1.2, ...grid.map((g) => g * 2 - 1), 1.2, 2]) {
        const v = chestBeamProfile(x, y);
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('is mirror symmetric, strongest on the axis, zero at the plane edge and at the top', () => {
    for (const y of [0.1, 0.4, 0.8]) {
      expect(chestBeamProfile(0.3, y)).toBeCloseTo(chestBeamProfile(-0.3, y), 12);
      expect(chestBeamProfile(0, y)).toBeGreaterThan(chestBeamProfile(0.5, y));
      expect(chestBeamProfile(1.01, y)).toBe(0);
    }
    for (const x of [-0.5, 0, 0.5]) expect(chestBeamProfile(x, 1)).toBe(0);
    // the foot has no hot ring: strength rises from the ground and fades smoothly up (no step)
    expect(chestBeamProfile(0, 0)).toBe(0);
    let prev = chestBeamProfile(0, 0.1);
    for (const y of grid.filter((g) => g > 0.1)) {
      const v = chestBeamProfile(0, y);
      expect(v).toBeLessThanOrEqual(prev + 1e-12);
      expect(prev - v).toBeLessThan(0.12);
      prev = v;
    }
  });

  it('narrows to a column, not a needle: still wide at 60 % of its height, and the edge is soft (no jump between neighbours)', () => {
    const half = (y: number): number => {
      let lo = 0;
      for (let i = 0; i <= 400; i++) if (chestBeamProfile(i / 400, y) > 0.05 * chestBeamProfile(0, y)) lo = i / 400;
      return lo;
    };
    expect(half(0.6)).toBeGreaterThan(0.5 * half(0.1));
    expect(BEAM_TOP_WIDTH).toBeGreaterThan(0.3);
    expect(BEAM_TOP_WIDTH).toBeLessThan(1);
    for (const y of [0.15, 0.5]) {
      for (let i = 0; i < 400; i++) expect(Math.abs(chestBeamProfile((i + 1) / 400, y) - chestBeamProfile(i / 400, y))).toBeLessThan(0.05);
    }
  });

  it('GLOW_FRAG uses the same constants, writes no alpha in the plane branch and clamps the output (no negative light or alpha)', () => {
    const start = GLOW_FRAG.indexOf('else if (type < 2.5) {');
    const end = GLOW_FRAG.indexOf('else if (type < 3.5) {');
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const plane = GLOW_FRAG.slice(start, end);
    expect(plane).not.toMatch(/aout/);
    expect(plane).toContain(`mix(1.0, ${BEAM_TOP_WIDTH.toFixed(2)}, pow(y, ${BEAM_TAPER_POW.toFixed(2)}))`);
    expect(plane).toContain(`smoothstep(${BEAM_EDGE_START.toFixed(2)}, 1.0,`);
    expect(GLOW_FRAG).toContain(`? ${BEAM_DIRECT_GAIN.toFixed(2)} :`);
    expect(GLOW_FRAG).toContain('gl_FragColor = vec4(max(rgb, vec3(0.0)), clamp(aout, 0.0, 1.0));');
    expect(BEAM_DIRECT_GAIN).toBeLessThan(0.75);
  });

  it('keeps the plane sizes: heights 4.6 / 6.0 / 8.0 m and widths 1.9 / 2.2 / 2.6 m (the spec keeps them)', () => {
    const table = buildPickupVisuals();
    const ch = [0, 1, 2].map((t) => pickupVisual(table, PICKUP_CHEST, t));
    expect(ch.map((v) => v.beamHeight)).toEqual([4.6, 6.0, 8.0]);
    expect(ch.map((v) => v.beamWidth)).toEqual([1.9, 2.2, 2.6]);
  });
});

describe('Pickups.load recovery & disposal (RENDER-02)', () => {
  function fakePickupModel(id: string): LoadedModel {
    const root = new Group();
    if (id === 'yeop_coin') {
      for (const node of ['yeop_t0', 'yeop_t1', 'yeop_t2']) {
        const m = new Mesh(new BoxGeometry(1, 0.2, 1), new MeshBasicMaterial());
        m.name = node;
        root.add(m);
      }
    } else {
      root.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()));
    }
    return { id, scene: root, extras: {} } as unknown as LoadedModel;
  }

  function makeCore(loadBatchImpl: (reqs: unknown[]) => Promise<void>, modelImpl?: (id: string) => LoadedModel): RenderCore {
    return {
      scene: new Scene(),
      clock: { time: 0, dt: 0, frame: 0 },
      quality: { onChange: () => () => undefined, profile: { tier: 'high' } },
      rig: { focus: { x: 0, z: 0 }, isVisible: () => true },
      env: {
        sunDir: new Vector3(0.4, 0.8, 0.3).normalize(),
        sun: { color: new Color(1, 1, 1), intensity: 1 },
        hemi: { color: new Color(1, 1, 1), groundColor: new Color(0.5, 0.5, 0.5), intensity: 1 },
      },
      heightAt: () => 0,
      assets: {
        loadBatch: loadBatchImpl,
        model: modelImpl ?? ((id: string) => fakePickupModel(id)),
      },
    } as unknown as RenderCore;
  }

  it('clears cached promise on failure so a subsequent load retries assets cleanly with no duplicate meshes', async () => {
    let calls = 0;
    const core = makeCore(async () => {
      calls++;
      if (calls === 1) throw new Error('transient network failure');
    });
    const pickups = new Pickups(core);
    const baselineChildren = core.scene.children.length;

    await expect(pickups.load()).rejects.toThrow('transient network failure');
    expect(calls).toBe(1);
    expect(core.scene.children.length).toBe(baselineChildren);

    await pickups.load();
    expect(calls).toBe(2);
    expect(core.scene.children.length).toBe(baselineChildren + PICKUP_MODELS.length);

    // Subsequent load reuses the resolved promise without re-fetching or duplicating meshes.
    await pickups.load();
    expect(calls).toBe(2);
    expect(core.scene.children.length).toBe(baselineChildren + PICKUP_MODELS.length);

    pickups.dispose();
    expect(core.scene.children.length).toBe(0);
  });

  it('rolls back partially created batches if baking fails partway through and allows retry', async () => {
    let failOnce = true;
    const core = makeCore(
      async () => {},
      (id) => {
        if (failOnce && id === 'potion_hp') {
          failOnce = false;
          // Empty group triggers bakePickupGeometry throw after earlier batches were built
          return { id, scene: new Group(), extras: {} } as unknown as LoadedModel;
        }
        return fakePickupModel(id);
      },
    );
    const pickups = new Pickups(core);
    const baselineChildren = core.scene.children.length;
    const geoDispose = vi.spyOn(InstancedBufferGeometry.prototype, 'dispose');
    const matDispose = vi.spyOn(ShaderMaterial.prototype, 'dispose');
    try {
      await expect(pickups.load()).rejects.toThrow();
      expect(core.scene.children.length).toBe(baselineChildren);
      // xp_gem and yeop_coin batches were built before potion_hp threw; both must be rolled back & disposed
      expect(geoDispose).toHaveBeenCalledTimes(2);
      expect(matDispose).toHaveBeenCalledTimes(2);
    } finally {
      geoDispose.mockRestore();
      matDispose.mockRestore();
    }

    await pickups.load();
    expect(core.scene.children.length).toBe(baselineChildren + PICKUP_MODELS.length);
    pickups.dispose();
    expect(core.scene.children.length).toBe(0);
  });

  it('guards late completion when disposed while loadBatch is still in flight', async () => {
    let resolveLoad!: () => void;
    const core = makeCore(
      () =>
        new Promise<void>((res) => {
          resolveLoad = res;
        }),
    );
    const pickups = new Pickups(core);
    const p = pickups.load();
    pickups.dispose();
    expect(core.scene.children.length).toBe(0);

    resolveLoad();
    await p;
    expect(core.scene.children.length).toBe(0);
  });
});
