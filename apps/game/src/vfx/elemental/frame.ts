// Uniforms shared by every elemental material, by identity (one write per frame updates all materials).
// Ported from threejs-vfx core/FrameUniforms.js (MIT — see LICENSE) without the time-region field.
import { Vector2, Vector3, type Texture } from 'three';

export interface FrameUniforms {
  uTime: { value: number };
  uDelta: { value: number };
  uResolution: { value: Vector2 };
  /** packed-RGBA depth prepass of the opaque scene (soft particles); null in the game */
  uSceneDepth: { value: Texture | null };
  uCameraNear: { value: number };
  uCameraFar: { value: number };
  /** 1 when `uSceneDepth` is valid */
  uSoftOn: { value: number };
  /** world-space direction toward the key light */
  uLightDir: { value: Vector3 };
  uShaderIntensity: { value: number };
  uGlobalGlow: { value: number };
}

export const frame: FrameUniforms = {
  uTime: { value: 0 },
  uDelta: { value: 0 },
  uResolution: { value: new Vector2(1, 1) },
  uSceneDepth: { value: null },
  uCameraNear: { value: 0.5 },
  uCameraFar: { value: 220 },
  uSoftOn: { value: 0 },
  uLightDir: { value: new Vector3(0.45, 0.78, 0.44).normalize() },
  uShaderIntensity: { value: 1 },
  uGlobalGlow: { value: 1 },
};

/** The uniform block every elemental material wants, plus `extra` per-material boxes. */
export function sharedUniforms<T extends Record<string, { value: unknown }>>(extra: T = {} as T): FrameUniforms & T {
  return { ...frame, ...extra };
}
