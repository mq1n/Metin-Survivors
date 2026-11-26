import { describe, expect, test } from 'bun:test';
import { BACKGROUND_CLAUSE, KIND_ASSET, NO_EXTRAS, REF_ROLES, VFX_NEUTRAL, composePrompt, needsSoloSession, refRoleSentence } from './prompt';
import type { JobSpec } from './types';

const base = { group: 'g', size: 512, post: [] } as const;

describe('composePrompt — legacy jobs are unchanged', () => {
  test('structured prompt composes the labelled spec exactly', () => {
    const job: JobSpec = {
      ...base,
      id: 'tex_x',
      kind: 'terrain',
      post: [],
      prompt: { useCase: 'stylized-concept', assetType: 'ground', subject: 'moss', style: 'painted', palette: 'greens', constraints: 'tileable', avoid: 'text' },
    };
    expect(composePrompt(job)).toBe(
      [
        'Use case: stylized-concept',
        'Asset type: ground',
        'Primary request: moss',
        'Style/medium: painted',
        'Composition/framing: Square 1:1 canvas.',
        'Color palette: greens',
        'Constraints: tileable',
        'Avoid: text',
      ].join('\n'),
    );
  });

  test('plain string prompt keeps the generic asset type', () => {
    const job: JobSpec = { ...base, id: 'a', kind: 'ui', post: [], prompt: 'a gold frame' };
    expect(composePrompt(job)).toBe('Use case: stylized-concept\nAsset type: game asset\nPrimary request: a gold frame\nComposition/framing: Square 1:1 canvas.');
  });

  test('legacy transparent flag adds the magenta key clause only', () => {
    const job: JobSpec = { ...base, id: 'a', kind: 'foliage', post: [], prompt: 'fern', transparent: true };
    const p = composePrompt(job);
    expect(p).toContain('pure magenta #FF00FF');
    expect(p).not.toContain('genuinely transparent');
    expect(p).not.toContain(NO_EXTRAS);
  });
});

describe('composePrompt — goal / background / vfx', () => {
  const vfx: JobSpec = { ...base, id: 'vfx_a', kind: 'vfx', post: [], goal: '  a swirl for a spin skill  ', background: 'black' };

  test('goal-only vfx on black: goal first, kind asset type, black + neutral + no-extras clauses', () => {
    const lines = composePrompt(vfx).split('\n');
    expect(lines[0]).toBe('Goal: a swirl for a spin skill');
    expect(lines[1]).toBe(`Asset type: ${KIND_ASSET.vfx}`);
    expect(lines[2]).toBe('Composition/framing: Square 1:1 canvas.');
    expect(lines[3]).toBe(`Constraints: ${BACKGROUND_CLAUSE.black}; ${VFX_NEUTRAL}; ${NO_EXTRAS}`);
    expect(lines).toHaveLength(4);
    expect(composePrompt(vfx)).not.toContain('Use case:');
  });

  test('keepColor drops the neutral colour clause', () => {
    expect(composePrompt({ ...vfx, keepColor: true })).not.toContain(VFX_NEUTRAL);
  });

  test('transparent background clause; opaque only speaks for vfx', () => {
    expect(composePrompt({ ...vfx, background: 'transparent' })).toContain(BACKGROUND_CLAUSE.transparent);
    expect(composePrompt({ ...vfx, background: 'opaque' })).toContain(BACKGROUND_CLAUSE.opaque);
    expect(composePrompt({ ...vfx, kind: 'ui', background: 'opaque' })).not.toContain(BACKGROUND_CLAUSE.opaque);
  });

  test('goal + plain prompt: prompt becomes the primary request with the kind asset type', () => {
    const p = composePrompt({ ...vfx, prompt: 'three arms' });
    expect(p.split('\n').slice(0, 4)).toEqual(['Goal: a swirl for a spin skill', 'Use case: stylized-concept', `Asset type: ${KIND_ASSET.vfx}`, 'Primary request: three arms']);
    expect(p).not.toContain(NO_EXTRAS);
  });

  test('aspect sets the canvas line', () => {
    expect(composePrompt({ ...vfx, aspect: 'wide' })).toContain('Composition/framing: Wide cinematic 16:9 canvas.');
  });

  test('goal-only tiling job gets the tileable clause', () => {
    expect(composePrompt({ ...base, id: 't', kind: 'terrain', post: [], goal: 'snow', tiling: true })).toContain('perfectly seamless tileable texture');
  });
});

describe('reference roles', () => {
  test('known roles map to their sentence, texture is the default', () => {
    expect(refRoleSentence(undefined)).toBe(REF_ROLES.texture);
    expect(REF_ROLES.texture).toBe("the original game's texture for this element: match its shape language and feel closely, but paint a new original image, not a pixel copy");
    expect(refRoleSentence('context')).toBe(REF_ROLES.context);
    expect(refRoleSentence('style')).toBe(REF_ROLES.style);
  });
  test('custom role sentences are used verbatim (trailing period trimmed)', () => {
    expect(refRoleSentence('a colour swatch to match.  ')).toBe('a colour swatch to match');
  });
  test('solo sessions: refs or real alpha', () => {
    expect(needsSoloSession({ refs: ['a.png'] })).toBe(true);
    expect(needsSoloSession({ refs: [], background: 'transparent' })).toBe(true);
    expect(needsSoloSession({ refs: [], background: 'black' })).toBe(false);
    expect(needsSoloSession({})).toBe(false);
  });
});
