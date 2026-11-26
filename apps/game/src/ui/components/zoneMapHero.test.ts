// Regression tests for UI-05: whole-arena minimap zoom (view = 0) renders a world-positioned local hero marker with heading,
// and exactly one local hero marker exists across every zoom step and atlas mode.
import { h, render } from 'preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { content } from '../../data/loader';
import { setDeps, type UiDeps } from '../env';
import { installTestDom, type TestDomEnv } from '../testDom';
import { ZoneMap, hudPips } from './ZoneMap';

const VIEWS = [52, 84, 150, 240, 0] as const;

describe('UI-05: ZoneMap local hero marker across whole-arena and follow zooms', () => {
  let dom: TestDomEnv;

  beforeEach(() => {
    dom = installTestDom();
    setDeps({
      content,
      assets: { manifest: { models: {}, textures: {}, icons: {}, audio: {} }, url: (u: string) => u },
    } as unknown as UiDeps);
  });

  afterEach(() => {
    render(null, dom.body as unknown as Element);
    setDeps(null);
    dom.restore();
  });

  it('renders exactly one local hero marker at off-center world coordinates with heading in whole-arena zoom (view = 0)', () => {
    const host = dom.document.createElement('div');
    dom.body.appendChild(host);
    const pips = hudPips({
      metins: [{ id: 1, x: -60, z: 45, awakened: false, hpFrac: 1, rune: '#ffaa22' }],
      boss: { id: 'boss_a', hp: 500, hpMax: 1000, phase: 1, enraged: false, final: false, x: 90, z: 90 },
    });

    // Move hero off-center to (100, -80) facing east (yaw = pi/2 = 90deg)
    render(
      h(ZoneMap, {
        zone: 'yeonmu',
        variant: 'minimap',
        view: 0,
        views: VIEWS,
        hero: { x: 100, z: -80, yaw: Math.PI / 2 },
        pips,
      }),
      host as unknown as Element,
    );

    // Exactly ONE local hero marker renders (no duplication and not missing!)
    const heroMarkers = host.querySelectorAll('.ms-zm-hero, .ms-zm-pip--hero');
    expect(heroMarkers.length).toBe(1);
    const marker = heroMarkers[0]!;
    expect(marker.classList.contains('ms-zm-hero--world')).toBe(true);
    // It lives inside .ms-zm-world (not fixed at disc center)
    const world = host.querySelector('.ms-zm-world')!;
    expect(world.contains(marker)).toBe(true);

    // Default geometry before async raster completes: x0 = -218, z0 = -218, span = 436
    const expectedLeft = `${Math.round((((100 - -218) / 436) * 100) * 1000) / 1000}%`;
    const expectedTop = `${Math.round((((-80 - -218) / 436) * 100) * 1000) / 1000}%`;
    expect(marker.style.left).toBe(expectedLeft);
    expect(marker.style.top).toBe(expectedTop);
    expect(marker.style['--zm-yaw']).toBe('90deg');

    // Move hero to a different off-center position (-90, 65) facing south (pi = 180deg) -> marker moves & rotates
    render(
      h(ZoneMap, {
        zone: 'yeonmu',
        variant: 'minimap',
        view: 0,
        views: VIEWS,
        hero: { x: -90, z: 65, yaw: Math.PI },
        pips,
      }),
      host as unknown as Element,
    );
    const updated = host.querySelectorAll('.ms-zm-hero, .ms-zm-pip--hero');
    expect(updated.length).toBe(1);
    expect(updated[0]!.style.left).toBe(`${Math.round((((-90 - -218) / 436) * 100) * 1000) / 1000}%`);
    expect(updated[0]!.style.top).toBe(`${Math.round((((65 - -218) / 436) * 100) * 1000) / 1000}%`);
    expect(updated[0]!.style['--zm-yaw']).toBe('180deg');
  });

  it('renders exactly one local hero marker across every follow zoom step, whole-arena zoom, and atlas mode', () => {
    const host = dom.document.createElement('div');
    dom.body.appendChild(host);
    const hero = { x: 85, z: -40, yaw: -Math.PI / 4 };

    for (const view of VIEWS) {
      render(h(ZoneMap, { zone: 'yeonmu', variant: 'minimap', view, views: VIEWS, hero, pips: [] }), host as unknown as Element);
      const markers = host.querySelectorAll('.ms-zm-hero, .ms-zm-pip--hero');
      expect(markers.length, `minimap view=${view} must render exactly 1 hero marker`).toBe(1);
      const world = host.querySelector('.ms-zm-world')!;
      if (view === 0) {
        expect(world.contains(markers[0]!)).toBe(true);
        expect(markers[0]!.classList.contains('ms-zm-hero--world')).toBe(true);
      } else {
        expect(world.contains(markers[0]!)).toBe(false);
        expect(markers[0]!.classList.contains('ms-zm-hero--world')).toBe(false);
      }
    }

    // Atlas variant also renders exactly one hero marker
    render(h(ZoneMap, { zone: 'yeonmu', variant: 'atlas', hero, pips: [] }), host as unknown as Element);
    const atlasMarkers = host.querySelectorAll('.ms-zm-hero, .ms-zm-pip--hero');
    expect(atlasMarkers.length).toBe(1);
    expect(atlasMarkers[0]!.classList.contains('ms-zm-pip--hero')).toBe(true);

    // Persisted whole-arena zoom in localStorage restores whole-arena hero marker on remount
    localStorage.setItem('ms.ui.minimapView', '0');
    render(null, host as unknown as Element);
    render(h(ZoneMap, { zone: 'yeonmu', variant: 'minimap', views: VIEWS, hero, pips: [] }), host as unknown as Element);
    const restored = host.querySelectorAll('.ms-zm-hero, .ms-zm-pip--hero');
    expect(restored.length).toBe(1);
    expect(restored[0]!.classList.contains('ms-zm-hero--world')).toBe(true);
  });
});
