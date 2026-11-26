import { describe, expect, test } from 'bun:test';
import { buildGlb } from '../core/export/glb.ts';
import { bevelBox } from '../core/hard/hardmesh.ts';
import { rgb, type PaintLayer } from '../core/paint/painter.ts';
import { Body } from '../core/sdf/body.ts';
import { Sphere } from '../core/sdf/primitives.ts';
import { Skeleton } from '../core/skin/skeleton.ts';
import { parseGlb } from '../../scripts/propTex.ts';
import { iceGolem } from '../models/golem/ice_golem.ts';
import { soldierParams } from '../models/humans/oath/soldier.ts';
import { buildCrowd as buildGiantCrowd } from './giant/pipeline.ts';
import { buildHard } from './golem/build.ts';
import { golemDef } from './golem/index.ts';
import { buildHero, type HeroDef } from './humanoid/build.ts';
import { humanoidDef } from './humanoid/index.ts';
import { prepareHuman } from './humans/rigx.ts';
import { buildCrowd as buildOrcCrowd } from './orc/build.ts';
import { buildProp, type PropDef } from './prop/index.ts';
import { mapAuto, type PropMesh } from './prop/mesh.ts';

function tinyHeroDef(size: number): HeroDef {
  const skeleton = new Skeleton([{ name: 'root', parent: null, pos: [0, 0, 0] }]);
  const body = new Body();
  body.add('ball', new Sphere([0, 0.5, 0], 0.4), { bone: 'root', tags: ['body'] });
  const albedo: PaintLayer[] = [
    {
      name: 'base',
      apply: (v) => {
        v.color = rgb('#b8442a');
      },
    },
  ];
  const shade: PaintLayer[] = [
    {
      name: 'ao',
      apply: (v) => {
        const k = 0.7 + 0.3 * Math.max(0, v.n[1]);
        v.color = [v.color[0] * k, v.color[1] * k, v.color[2] * k];
      },
    },
  ];
  const emissive: PaintLayer[] = [
    {
      name: 'glow',
      apply: (v) => {
        v.color = rgb('#ffaa00');
      },
    },
  ];
  return {
    id: 'tiny_tex0_test',
    kind: 'creature',
    skeleton,
    body,
    paint: { albedo, shade, emissive, size },
    clips: [],
    mesh: { voxel: 0.08, tris: 120, relax: 0, minComponentTris: 4 },
    sockets: {},
    seed: 'tex0',
  };
}

function tinyPropDef(defaultSize?: number): PropDef {
  return {
    id: 'tiny_prop_tex0_test',
    size: defaultSize,
    rays: 4,
    mats: [
      {
        name: 'brick',
        shade: () => [0.6, 0.25, 0.15],
        emit: () => [0.5, 0.2, 0.0],
      },
    ],
    build(m: PropMesh) {
      m.add(bevelBox([0.6, 0.6, 0.6], 0.04, [0, 0.3, 0], 1), 0, mapAuto(1));
    },
  };
}

describe('TOOL-UI-03 explicit texture=0 vertex-color path', () => {
  test('humanoidDef, prepareHuman, and golemDef preserve texture=0, default size, and positive override', () => {
    const sp = soldierParams();
    expect(sp.texture).toBe(512);

    expect(humanoidDef(sp, { texture: 0 }).def.paint.size).toBe(0);
    expect(humanoidDef(sp, {}).def.paint.size).toBe(512);
    expect(humanoidDef(sp).def.paint.size).toBe(512);
    expect(humanoidDef(sp, { texture: 256 }).def.paint.size).toBe(256);

    expect(prepareHuman(sp, undefined, { texture: 0 }).paint.size).toBe(0);
    expect(prepareHuman(sp, undefined, {}).paint.size).toBe(512);
    expect(prepareHuman(sp, undefined, { texture: 256 }).paint.size).toBe(256);

    const gp = iceGolem();
    expect(golemDef(gp, { texture: 0 }).paint.size).toBe(0);
    expect(golemDef(gp, {}).paint.size).toBe(1024);
    expect(golemDef(gp, { texture: 256 }).paint.size).toBe(256);
  });

  test('humanoid, giant/human crowd, orc crowd, and golem builders skip unwrap/bake on texture=0 and emit colored GLB without images', async () => {
    const builders = [
      { name: 'humanoid/buildHero', run: (def: HeroDef) => buildHero(def) },
      { name: 'giant/buildCrowd', run: (def: HeroDef) => buildGiantCrowd(def) },
      { name: 'orc/buildCrowd', run: (def: HeroDef) => buildOrcCrowd(def) },
      { name: 'golem/buildHard', run: (def: HeroDef) => buildHard(def) },
    ];

    for (const b of builders) {
      const model = await b.run(tinyHeroDef(0));
      expect(model.texture, b.name).toBeUndefined();
      expect(model.emissive, b.name).toBeUndefined();
      expect(model.uvs, b.name).toBeUndefined();
      expect(model.extras?.layoutHash, b.name).toBeUndefined();
      expect(model.colors.length, b.name).toBe(model.positions.length);
      // Vertex colors must reflect the brick-red albedo (R > B) modulated by shade, not plain white [1,1,1]
      let sumR = 0, sumB = 0;
      for (let i = 0; i < model.colors.length; i += 3) {
        sumR += model.colors[i]!;
        sumB += model.colors[i + 2]!;
      }
      expect(sumR, b.name).toBeGreaterThan(sumB * 2);

      const glb = await buildGlb(model, { noCompress: true });
      const { json } = parseGlb(glb);
      expect(json.images ?? [], `${b.name} GLB images`).toHaveLength(0);
      expect(json.textures ?? [], `${b.name} GLB textures`).toHaveLength(0);
    }
  });

  test('buildProp honors { texture: 0 } without baking textures, and honors positive texture override', async () => {
    const def = tinyPropDef(128);
    const noTex = await buildProp(def, () => {}, { texture: 0 });
    expect(noTex.texture).toBeUndefined();
    expect(noTex.emissive).toBeUndefined();
    expect(noTex.uvs).toBeUndefined();
    expect(noTex.extras?.layoutHash).toBeUndefined();
    expect(noTex.colors.length).toBe(noTex.positions.length);
    // Warm reddish-brown shade (R > G > B)
    expect(noTex.colors[0]!).toBeGreaterThan(noTex.colors[2]!);

    const glb = await buildGlb(noTex, { noCompress: true });
    const { json } = parseGlb(glb);
    expect(json.images ?? []).toHaveLength(0);
    expect(json.textures ?? []).toHaveLength(0);

    // Positive texture size still produces a textured prop
    const withTex = await buildProp(def, () => {}, { texture: 64 });
    expect(withTex.texture).toBeDefined();
    expect(withTex.uvs).toBeDefined();
    expect(withTex.emissive).toBeDefined();
  });
});
