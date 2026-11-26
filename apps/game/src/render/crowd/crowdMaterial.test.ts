// The crowd skin's program cache key tracks the GLSL injected into it (no manual "crowd-skin-vN" bump): it changes when any
// injected string or anchor changes and is stable otherwise.
import { DataTexture } from 'three';
import { describe, expect, it } from 'vitest';
import { CROWD_FX } from './fx';
import { CROWD_FX_STATUS } from './fx/status';
import {
  CROWD_FRAG_PATCHES,
  CROWD_SKIN_KEY,
  CROWD_VERT_PATCHES,
  createCrowdMaterial,
  crowdSkinKey,
  hashGlsl,
  type ShaderPatch,
} from './crowdMaterial';

const mutate = (patches: readonly ShaderPatch[], at: number, field: 0 | 1): ShaderPatch[] =>
  patches.map((p, i) => (i === at ? (field === 0 ? [`${p[0]} `, p[1]] : [p[0], `${p[1]}\n// edit`]) : p) as unknown as ShaderPatch);

describe('crowd skin program cache key', () => {
  it('is derived from the injected source: a stable, non-manual "crowd-skin-<hash>"', () => {
    expect(CROWD_SKIN_KEY).toMatch(/^crowd-skin-[0-9a-z]{8,}$/);
    expect(CROWD_SKIN_KEY).not.toBe('crowd-skin-v3');
    expect(crowdSkinKey(CROWD_VERT_PATCHES, CROWD_FRAG_PATCHES)).toBe(CROWD_SKIN_KEY);
    expect(crowdSkinKey([...CROWD_VERT_PATCHES], [...CROWD_FRAG_PATCHES])).toBe(CROWD_SKIN_KEY);
  });

  it('changes when any injected GLSL string or anchor changes (vertex and fragment, text and anchor)', () => {
    const keys = new Set<string>([CROWD_SKIN_KEY]);
    for (let i = 0; i < CROWD_VERT_PATCHES.length; i++) {
      for (const f of [0, 1] as const) keys.add(crowdSkinKey(mutate(CROWD_VERT_PATCHES, i, f), CROWD_FRAG_PATCHES));
    }
    for (let i = 0; i < CROWD_FRAG_PATCHES.length; i++) {
      for (const f of [0, 1] as const) keys.add(crowdSkinKey(CROWD_VERT_PATCHES, mutate(CROWD_FRAG_PATCHES, i, f)));
    }
    expect(keys.size).toBe(1 + 2 * CROWD_VERT_PATCHES.length + 2 * CROWD_FRAG_PATCHES.length);
  });

  it('covers the status snippet (render/crowd/fx/status.ts): editing it changes the key', () => {
    expect(CROWD_FX).toContain(CROWD_FX_STATUS);
    const fx = CROWD_FRAG_PATCHES.findIndex(([anchor]) => anchor === '#include <opaque_fragment>');
    expect(fx).toBeGreaterThanOrEqual(0);
    expect(CROWD_FRAG_PATCHES[fx]?.[1]).toContain(CROWD_FX_STATUS);
    const edited = CROWD_FRAG_PATCHES.map((p, i) =>
      i === fx ? ([p[0], p[1].replace(CROWD_FX_STATUS, `${CROWD_FX_STATUS}\n// status edit`)] as unknown as ShaderPatch) : p,
    );
    expect(crowdSkinKey(CROWD_VERT_PATCHES, edited)).not.toBe(CROWD_SKIN_KEY);
  });

  it('hashes part boundaries and order', () => {
    expect(hashGlsl(['ab', 'c'])).not.toBe(hashGlsl(['a', 'bc']));
    expect(hashGlsl(['a', 'b'])).not.toBe(hashGlsl(['b', 'a']));
    expect(hashGlsl(['a', 'b'])).toBe(hashGlsl(['a', 'b']));
  });

  it('is what every crowd material reports to three (defines still split the animLerp / colorize variants)', () => {
    const bake = new DataTexture(new Float32Array(4), 1, 1);
    const base = { bake, boneCount: 1, map: null, vertexColors: false, tint: undefined, animLerp: false };
    const a = createCrowdMaterial(base);
    const b = createCrowdMaterial({ ...base, animLerp: true, tintMode: 'colorize', tint: '#88aaff' });
    expect(a.customProgramCacheKey()).toBe(CROWD_SKIN_KEY);
    expect(b.customProgramCacheKey()).toBe(CROWD_SKIN_KEY);
    expect(a.defines).toEqual({});
    expect(b.defines).toEqual({ ANIM_LERP: '', CROWD_COLORIZE: '' });
    a.dispose();
    b.dispose();
  });
});
