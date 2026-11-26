// UV unwrapping through xatlas (WASM). Charts are parameterised and packed; vertices are duplicated along seams.
// The mesh keeps its triangulation; `oldIndex` maps every new vertex back to its source vertex for attribute remapping.
import { Api } from 'xatlasjs/dist/node/api.mjs';
import createXAtlasModule from 'xatlasjs/dist/node/xatlas.js';

export interface Unwrapped {
  positions: Float32Array;
  indices: Uint32Array;
  /** 2 floats per vertex, normalised 0..1, V grows downward (image space) */
  uvs: Float32Array;
  /** new vertex -> source vertex */
  oldIndex: Uint32Array;
  width: number;
  height: number;
}

export interface UnwrapOpts {
  /** texels per metre of surface (sets the atlas size) */
  texelsPerUnit: number;
  padding?: number;
  /** larger = fewer, bigger charts (less seams, more distortion). xatlas default 2 */
  maxCost?: number;
}

interface XAtlasInstance {
  loaded: boolean;
  createAtlas(): void;
  addMesh(indexes: Uint16Array, vertices: Float32Array, normals?: Float32Array | null, coords?: Float32Array | null, meshObj?: unknown, useNormals?: boolean, useCoords?: boolean, scale?: number): unknown;
  generateAtlas(chart: Record<string, unknown>, pack: Record<string, unknown>, returnMeshes?: boolean): {
    width: number;
    height: number;
    meshes: { index: Uint16Array; oldIndexes: Uint16Array; vertex: { vertices: Float32Array; coords1: Float32Array }; vertexCount: number }[];
  };
  destroyAtlas(): void;
}

let instance: Promise<XAtlasInstance> | null = null;
function getXAtlas(): Promise<XAtlasInstance> {
  if (!instance) {
    const { promise, resolve } = Promise.withResolvers<XAtlasInstance>();
    const XA = Api(createXAtlasModule) as unknown as new (onLoad: () => void) => XAtlasInstance;
    const x: XAtlasInstance = new XA(() => resolve(x));
    instance = promise;
  }
  return instance;
}

export async function unwrap(positions: Float32Array, indices: Uint32Array, opts: UnwrapOpts): Promise<Unwrapped> {
  const xa = await getXAtlas();
  xa.createAtlas();
  try {
    if (positions.length / 3 > 65535) throw new Error('unwrap: more than 65535 vertices');
    xa.addMesh(Uint16Array.from(indices), positions);
    const atlas = xa.generateAtlas({ maxCost: opts.maxCost ?? 2 }, { padding: opts.padding ?? 3, texelsPerUnit: opts.texelsPerUnit, bilinear: true, blockAlign: false, rotateCharts: true });
    const m = atlas.meshes[0]!;
    const w = atlas.width, h = atlas.height;
    // the wrapper returns UVs already normalised to the packed atlas
    const uvs = Float32Array.from(m.vertex.coords1.subarray(0, m.vertexCount * 2));
    return {
      positions: m.vertex.vertices,
      indices: Uint32Array.from(m.index),
      uvs,
      oldIndex: Uint32Array.from(m.oldIndexes),
      width: w,
      height: h,
    };
  } finally {
    xa.destroyAtlas();
  }
}
