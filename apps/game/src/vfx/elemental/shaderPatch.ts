// onBeforeCompile composition (ported from threejs-vfx utils/shaderPatch.js, MIT — see LICENSE).
// The program-cache-key derivation matters: without it every patched material shares one cache key and renders with
// another material's program (NaN fragments → the bloom chain blacks out the frame).
import type { Material, WebGLProgramParametersWithUniforms, WebGLRenderer } from 'three';

type Patch = (shader: WebGLProgramParametersWithUniforms, renderer: WebGLRenderer) => void;

function hashSource(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Composes `onBeforeCompile` callbacks and derives a per-injection program cache key. */
export function patchOnBeforeCompile<M extends Material>(material: M, fn: Patch): M {
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  const key = hashSource(fn.toString());
  material.onBeforeCompile = function (shader, renderer) {
    previous.call(this, shader, renderer);
    fn.call(this, shader, renderer);
  };
  material.customProgramCacheKey = function () {
    return `${previousKey.call(this)}|${key}`;
  };
  return material;
}

/** Replaces a token in a shader string; warns when it vanished (three upgrade). */
export function replaceChunk(source: string, token: string, replacement: string): string {
  if (!source.includes(token)) {
    console.warn(`[elemental/shaderPatch] token not found: ${token}`);
    return source;
  }
  return source.replace(token, replacement);
}
