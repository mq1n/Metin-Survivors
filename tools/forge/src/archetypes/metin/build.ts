// Generic metin builder: pieces (convex solids, one bone each) -> rig -> flat-faceted mesh -> atlas bake -> clips -> ModelData.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sampleClip } from '../../core/anim/clip.ts';
import { repoRoot } from '../../core/export/manifest.ts';
import { encodePng } from '../../core/export/image.ts';
import { bakeSolid, flatten, solidToModel } from '../../core/ext/metins/solid.ts';
import type { PolyPart } from '../../core/ext/metins/solid.ts';
import type { Vec3 } from '../../core/math.ts';
import type { ModelData } from '../../core/model.ts';
import type { BuildOpts } from '../../core/registry.ts';
import { type ClipTune, metinClips } from './clips.ts';
import { type PieceDef, buildRig } from './rig.ts';
import { type ShadeSpec, makeShade } from './shade.ts';

export interface MetinSpec {
  id: string;
  pieces: PieceDef[];
  /** shader spec; `height` is filled in from the rig */
  shade: Omit<ShadeSpec, 'height'>;
  texSize: number;
  tune: ClipTune;
  /** default rune colour (linear) baked as material.emissiveFactor; the game overrides `material.emissive` per metin type */
  emissiveFactor: Vec3;
  roughness?: number;
  extras?: Record<string, unknown>;
  /** hand-set height override for the manifest (m); default = geometry height */
  radius?: number;
}

export async function buildMetin(spec: MetinSpec, log: (s: string) => void, opts?: BuildOpts): Promise<ModelData> {
  const t0 = performance.now();
  const rig = buildRig(spec.pieces);
  const parts: PolyPart[] = [];
  for (const p of rig.pieces) for (const poly of p.polys) parts.push({ poly, bone: p.bone, part: p.part });
  const faces = flatten(parts);
  const size = opts?.texture === undefined ? spec.texSize : opts.texture === 0 ? 64 : opts.texture;
  const boneTop: number[] = [];
  for (const p of rig.pieces) {
    let top = 0;
    for (const poly of p.polys) for (const v of poly.vertices()) top = Math.max(top, v[1]);
    boneTop[p.bone] = top;
  }
  const { shade, bandPaint } = makeShade({ ...spec.shade, height: rig.height, boneTop });
  log(`  ${rig.pieces.length} pieces, ${rig.skeleton.count} bones, ${faces.length} faces`);
  const baked = await bakeSolid(faces, { size, shade, bandPaint, log });
  if (process.env.FORGE_DEBUG) {
    const dir = join(repoRoot(), '.research', 'forge', spec.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'albedo.png'), encodePng(baked.albedo, size, size));
    writeFileSync(join(dir, 'emissive.png'), encodePng(baked.emissive, size, size));
  }
  const clips = metinClips(rig, spec.tune).map((c) => sampleClip(rig.skeleton, c));
  log(`  built ${spec.id} in ${Math.round(performance.now() - t0)} ms`);
  return solidToModel({
    id: spec.id,
    kind: 'metin',
    skeleton: rig.skeleton,
    clips,
    baked,
    size,
    emissiveFactor: spec.emissiveFactor,
    material: { roughness: spec.roughness ?? 0.7, metallic: 0 },
    ...(spec.extras ? { extras: spec.extras } : {}),
    ...(spec.radius ? { radius: spec.radius } : {}),
  });
}
