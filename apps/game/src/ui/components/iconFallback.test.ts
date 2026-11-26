// Regression tests for UI-07: IconArt uses monotonic per-(id, rank) failure tracking so failed rank-band + base URLs
// settle on the procedural SVG after at most 2 attempts (never oscillating), while identity changes retry cleanly.
import { h, render } from 'preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setDeps, type UiDeps } from '../env';
import { installTestDom, TestEvent, type TestDomEnv } from '../testDom';
import { IconArt, selectIconCandidate } from './Icon';

function makeManifestDeps(): UiDeps {
  return {
    assets: {
      manifest: {
        models: {},
        textures: {},
        audio: {},
        icons: {
          icon_skill_slash: {
            url: 'icons/slash.png',
            style: { form: 'tile', variants: { m: 'icon_skill_slash__m', g: 'icon_skill_slash__g' } },
          },
          icon_skill_slash__m: {
            url: 'icons/slash__m.png',
            style: { form: 'tile' },
          },
          icon_skill_slash__g: {
            url: 'icons/slash__g.png',
            style: { form: 'tile' },
          },
          icon_skill_whirlwind: {
            url: 'icons/whirlwind.png',
            style: { form: 'tile', variants: { m: 'icon_skill_whirlwind__m' } },
          },
          icon_skill_whirlwind__m: {
            url: 'icons/whirlwind__m.png',
            style: { form: 'tile' },
          },
        },
      },
      url: (u: string) => `/${u}`,
    },
  } as unknown as UiDeps;
}

describe('UI-07: IconArt monotonic rank-band -> base -> SVG fallback', () => {
  let dom: TestDomEnv;

  beforeEach(() => {
    dom = installTestDom();
    setDeps(makeManifestDeps());
  });

  afterEach(() => {
    render(null, dom.body as unknown as Element);
    setDeps(null);
    dom.restore();
  });

  it('selectIconCandidate advances monotonically from rank-band to base to null', () => {
    const urlOf = (k: string): string => `/${k}.png`;
    expect(selectIconCandidate('icon_a', 'icon_a__m', [], urlOf)).toEqual({ useId: 'icon_a__m', url: '/icon_a__m.png' });
    expect(selectIconCandidate('icon_a', 'icon_a__m', ['icon_a__m'], urlOf)).toEqual({ useId: 'icon_a', url: '/icon_a.png' });
    expect(selectIconCandidate('icon_a', 'icon_a__m', ['icon_a__m', 'icon_a'], urlOf)).toBeNull();
  });

  it('failing rank-band falls back to base; failing both renders procedural SVG with zero further retries; changing icon/rank retries fresh', () => {
    const host = dom.document.createElement('div');
    dom.body.appendChild(host);

    // 1. Initial render: attempts rank-band M tile
    render(h(IconArt, { id: 'icon_skill_slash', rank: 3, kind: 'skill' }), host as unknown as Element);
    let img = host.querySelector('img');
    expect(img?.getAttribute('src')).toBe('/icons/slash__m.png');
    expect(host.querySelector('svg')).toBeNull();

    // 2. Rank-band fails -> falls back to base image (attempt 2)
    img!.dispatchEvent(new TestEvent('error'));
    img = host.querySelector('img');
    expect(img?.getAttribute('src')).toBe('/icons/slash.png');
    expect(host.querySelector('svg')).toBeNull();

    // 3. Base image also fails -> renders procedural SVG fallback, NEVER returns to rank-band!
    img!.dispatchEvent(new TestEvent('error'));
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('svg')).not.toBeNull();

    // 4. Multiple re-renders with same (id, rank) keep procedural SVG with zero further <img> retries
    for (let i = 0; i < 6; i++) {
      render(h(IconArt, { id: 'icon_skill_slash', rank: 3, kind: 'skill', alt: `pass-${i}` }), host as unknown as Element);
      expect(host.querySelector('img')).toBeNull();
      expect(host.querySelector('svg')).not.toBeNull();
    }

    // 5. Changing rank (3 -> 5, G1 band) retries fresh candidates cleanly
    render(h(IconArt, { id: 'icon_skill_slash', rank: 5, kind: 'skill' }), host as unknown as Element);
    img = host.querySelector('img');
    expect(img?.getAttribute('src')).toBe('/icons/slash__g.png');

    // Fail G rank-band -> base works cleanly without oscillation
    img!.dispatchEvent(new TestEvent('error'));
    img = host.querySelector('img');
    expect(img?.getAttribute('src')).toBe('/icons/slash.png');

    // 6. Changing icon id resets failure tracking and loads new rank-band image
    render(h(IconArt, { id: 'icon_skill_whirlwind', rank: 3, kind: 'skill' }), host as unknown as Element);
    img = host.querySelector('img');
    expect(img?.getAttribute('src')).toBe('/icons/whirlwind__m.png');
  });
});
