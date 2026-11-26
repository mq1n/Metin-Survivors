// PL-05: the flares of the light pools (render/terrain/flares.ts): which emitters get one, where it sits (the lantern at its fire box, the lamp
// post at its glass box, the lava pillar on the face the camera sees), how the arc's pool gain scales it (a warm glint at noon, a lamp at dusk),
// the page switch, one instanced draw per zone, hidden on low, and one material that never gets a define.
import { Color } from 'three';
import { describe, expect, it } from 'vitest';
import type { PropPlacement, RockKind, RockPlacement } from '../../world/layoutTypes';
import type { TerrainField } from '../../world/terrainField';
import { QUALITY_PROFILES } from '../quality';
import { atmosphereUniforms } from './atmosphere';
import { bakePools, poolEmitters, rockPoolKey } from './bakePools';
import {
  DEFAULT_PUSH_OF_RADIUS,
  FLARE_FADE_FAR,
  FLARE_FADE_NEAR,
  FLARE_GAIN_EXP,
  FLARE_HDR,
  FLARE_LIT_FROM,
  FLARE_LIT_TO,
  FLARE_NOON_SCALE,
  FLARE_TABLE,
  createFlares,
  flareDefFor,
  flareEmitters,
  flareFlicker,
  flareGain,
  flareLit,
  flareScale,
  parseFlareSwitch,
} from './flares';
import { lookFor } from './look';
import type { PoolSpec } from './look/types';
import { worldUniforms } from './zoneContext';

function prop(id: string, x: number, z: number, o: Partial<PropPlacement> = {}): PropPlacement {
  return { id, x, z, y: 0, yaw: 0, scale: 1, seed: 1, ...o };
}
function rock(kind: RockKind, x: number, z: number, sx = 2, sy = 4): RockPlacement {
  return { kind, x, z, y: 1, sx, sy, sz: sx, yaw: 0, seed: 1, mat: 0 };
}
function field(props: PropPlacement[], rocks: RockPlacement[] = []): TerrainField {
  return { size: 64, layout: { props, rocks } } as unknown as TerrainField;
}
const spec = (o: Partial<PoolSpec> = {}): PoolSpec => ({ color: '#ffd08a', intensity: 0.3, radius: 5, flicker: 0.05, ...o });

describe('the emitter list (bakePools.poolEmitters)', () => {
  it('lists props first in layout order, then rocks of a `rock:` key with a positive radius', () => {
    const pools = { stone_lantern: spec(), [rockPoolKey('crystal')]: spec({ radius: 1.5 }) };
    const f = field(
      [prop('stone_lantern', 1, 2, { y: 3, scale: 1.1, yaw: 0.5 }), prop('tree', 5, 5), prop('stone_lantern', -4, 7)],
      [rock('crystal', 9, 9, 3, 5), rock('boulder', 1, 1)],
    );
    const e = poolEmitters(f, pools);
    expect(e.map((x) => [x.kind, x.key])).toEqual([
      ['prop', 'stone_lantern'],
      ['prop', 'stone_lantern'],
      ['rock', 'rock:crystal'],
    ]);
    expect(e[0]).toMatchObject({ x: 1, y: 3, z: 2, yaw: 0.5, scale: 1.1, height: 0 });
    expect(e[0]?.radius).toBeCloseTo(5.5, 6);
    expect(e[2]).toMatchObject({ x: 9, y: 1, z: 9, scale: 1, height: 5 });
    expect(e[2]?.radius).toBeCloseTo(4.5, 6);
  });
  it('a zone without a rock key never looks at its rocks', () => {
    expect(poolEmitters(field([], [rock('crystal', 0, 0)]), { stone_lantern: spec() })).toEqual([]);
  });
  it('the bake reads this list (the pixel check against the pre-ROCK-01 algorithm is bakePools.test.ts)', () => {
    const pools = { brazier: spec({ intensity: 0.9, radius: 6 }) };
    const f = field([prop('brazier', 4, -3)]);
    const data = bakePools(f, pools, 64);
    // 1 m per texel: the texel under the brazier is lit, one far away is not
    const at = (x: number, z: number): number => data[(Math.floor(z + 32) * 64 + Math.floor(x + 32)) * 4] as number;
    expect(at(4, -3)).toBeGreaterThan(40);
    expect(at(-20, 20)).toBe(0);
  });
});

describe('which emitters have a flare (flareDefFor)', () => {
  it('the built-in table names the spec ids and holds sane numbers', () => {
    for (const id of ['stone_lantern', 'lamp_post', 'brazier', 'fire_brazier', 'bonfire', 'lava_pillar', 'plague_brazier', 'fire_altar']) expect(FLARE_TABLE[id], id).toBeDefined();
    for (const [id, def] of Object.entries(FLARE_TABLE)) {
      expect(def.flare, id).toBeGreaterThan(0);
      expect(def.height, id).toBeGreaterThan(0);
      expect(def.radius, id).toBeGreaterThan(0);
      for (const share of [def.day, def.core]) {
        if (share === undefined) continue;
        expect(share, id).toBeGreaterThan(0);
        expect(share, id).toBeLessThanOrEqual(1);
      }
      expect(def.push ?? 0, id).toBeGreaterThanOrEqual(0);
      expect(def.fwd ?? 0, id).toBeGreaterThanOrEqual(0);
    }
  });
  it('the lantern glows at its fire box under the eaves (not on the roof rim), small, and only a day share of it burns at noon', () => {
    const lantern = FLARE_TABLE.stone_lantern;
    // the shipped GLB: plate 2.6..3.4, fire box 3.4..3.8, roof 3.8..4.4 (r .78): the glow sits in the box; by day it is small (the noon radius stays near the roof's)
    expect(lantern?.height).toBeGreaterThanOrEqual(3.3);
    expect(lantern?.height).toBeLessThanOrEqual(3.8);
    expect((lantern?.radius ?? 9) * FLARE_NOON_SCALE).toBeLessThanOrEqual(0.65);
    expect(lantern?.radius).toBeLessThanOrEqual(1);
    expect(lantern?.day).toBeLessThanOrEqual(0.4);
    expect(lantern?.push ?? 99).toBeLessThanOrEqual(0.5); // the eaves still cut the top of the glow
    expect(FLARE_TABLE.lamp_post?.day).toBeLessThanOrEqual(0.4);
    // fires and the lava burn by day too
    for (const id of ['brazier', 'fire_brazier', 'lava_pillar', 'fire_altar', 'plague_brazier']) expect(FLARE_TABLE[id]?.day ?? 1, id).toBeGreaterThanOrEqual(0.7);
  });
  it('the lamp post glow is in its glass box (x .5..1.37 on the arm, y 2.9..3.8), not on the bracket or the top hook', () => {
    const lamp = FLARE_TABLE.lamp_post;
    expect(lamp?.dx).toBeGreaterThanOrEqual(0.8);
    expect(lamp?.dx).toBeLessThanOrEqual(1.05);
    expect(lamp?.height).toBeGreaterThanOrEqual(3.0);
    expect(lamp?.height).toBeLessThanOrEqual(3.5);
  });
  it('the lava pillar glow sits on the face the camera sees (fwd >= the shaft half width), is pulled clear of it and has a low core: a glow, not a ball', () => {
    const p = FLARE_TABLE.lava_pillar;
    expect(p?.fwd).toBeGreaterThanOrEqual(1.2);
    expect(p?.push).toBeGreaterThanOrEqual(1);
    expect(p?.core).toBeLessThanOrEqual(0.3);
  });
  it('the lantern and the lamp glow amber: a tint that keeps the red and takes some green and more blue off the pale cream pool colour', () => {
    for (const id of ['stone_lantern', 'lamp_post']) {
      const t = FLARE_TABLE[id]?.tint;
      expect(t, id).toBeDefined();
      expect(t?.[0], id).toBe(1);
      expect(t?.[1] ?? 9, id).toBeLessThan(1);
      expect(t?.[2] ?? 9, id).toBeLessThan(t?.[1] ?? 0);
      expect(t?.[2] ?? 0, id).toBeGreaterThan(0.3);
    }
    // the fires keep the pool's own colour
    for (const id of ['brazier', 'fire_brazier', 'bonfire', 'lava_pillar', 'plague_brazier', 'fire_altar']) expect(FLARE_TABLE[id]?.tint, id).toBeUndefined();
  });
  it('a fire keeps its flame shape through a reduced core (altar, bonfire, brazier)', () => {
    for (const id of ['fire_altar', 'bonfire', 'brazier', 'fire_brazier']) expect(FLARE_TABLE[id]?.core ?? 1, id).toBeLessThanOrEqual(0.5);
  });
  it('falls back to the table, and a pool spec wins over it', () => {
    expect(flareDefFor('stone_lantern', spec())).toEqual(FLARE_TABLE.stone_lantern);
    expect(flareDefFor('stone_lantern', spec({ flare: 1.2, flareHeight: 2 }))).toMatchObject({ flare: 1.2, height: 2, radius: FLARE_TABLE.stone_lantern?.radius });
    expect(flareDefFor('bonfire', spec({ flareHeight: 0.5 }))?.flare).toBe(FLARE_TABLE.bonfire?.flare);
    // the zone's own flare keeps the table's day share, push and core
    expect(flareDefFor('stone_lantern', spec({ flare: 1.2 }))).toMatchObject({ day: FLARE_TABLE.stone_lantern?.day, push: FLARE_TABLE.stone_lantern?.push, core: FLARE_TABLE.stone_lantern?.core });
  });
  it('flare 0 switches it off; an id without a table entry has none unless the spec names one', () => {
    expect(flareDefFor('stone_lantern', spec({ flare: 0 }))).toBeNull();
    expect(flareDefFor('obelisk', spec())).toBeNull();
    expect(flareDefFor('lava_rock', spec())).toBeNull();
    const d = flareDefFor('obelisk', spec({ flare: 0.6, radius: 5.5 }));
    expect(d?.flare).toBe(0.6);
    expect(d?.height).toBeGreaterThan(0);
    expect(d?.radius).toBeGreaterThanOrEqual(0.6);
    expect(d?.radius).toBeLessThanOrEqual(2.4);
  });
});

describe('where a flare sits (flareEmitters)', () => {
  const emit = (props: PropPlacement[], pools: Record<string, PoolSpec>, rocks: RockPlacement[] = []) => flareEmitters(poolEmitters(field(props, rocks), pools));
  it('is at the table height above the prop base, times the prop scale, with the radius times the scale', () => {
    const [e] = emit([prop('brazier', 3, -5, { y: 2, scale: 1.5 })], { brazier: spec() });
    expect(e).toMatchObject({ key: 'brazier', x: 3, z: -5 });
    expect(e?.y).toBeCloseTo(2 + (FLARE_TABLE.brazier?.height ?? 0) * 1.5, 6);
    expect(e?.radius).toBeCloseTo((FLARE_TABLE.brazier?.radius ?? 0) * 1.5, 6);
  });
  it('carries the day share, the pull towards the camera (x the prop scale) and the core; the defaults are 1, 0 / 0.6 x radius, 1', () => {
    const [l] = emit([prop('stone_lantern', 0, 0, { scale: 1.25 })], { stone_lantern: spec() });
    expect(l?.day).toBe(FLARE_TABLE.stone_lantern?.day);
    expect(l?.push).toBeCloseTo((FLARE_TABLE.stone_lantern?.push ?? 0) * 1.25, 6);
    expect(l?.core).toBe(FLARE_TABLE.stone_lantern?.core);
    const [p] = emit([prop('lava_pillar', 0, 0, { scale: 2 })], { lava_pillar: spec() });
    expect(p?.fwd).toBeCloseTo((FLARE_TABLE.lava_pillar?.fwd ?? 0) * 2, 6);
    // an id the table does not know: day 1, no fwd, push 0.6 x the radius, core 1
    const [o] = emit([prop('obelisk', 0, 0)], { obelisk: spec({ flare: 0.6, radius: 5.5 }) });
    expect(o).toMatchObject({ day: 1, fwd: 0, core: 1 });
    expect(o?.push).toBeCloseTo(DEFAULT_PUSH_OF_RADIUS * (o?.radius ?? 0), 6);
  });
  it('the lamp post light hangs off the bracket: dx along the prop X, turned by the yaw', () => {
    const dx = FLARE_TABLE.lamp_post?.dx ?? 0;
    expect(dx).toBeGreaterThan(0);
    const [a, b] = emit([prop('lamp_post', 10, 10, { yaw: 0 }), prop('lamp_post', 10, 10, { yaw: Math.PI / 2 })], { lamp_post: spec() });
    expect(a?.x).toBeCloseTo(10 + dx, 6);
    expect(a?.z).toBeCloseTo(10, 6);
    // yaw +90 deg about Y: local +X points to world -Z (three's rotation about Y)
    expect(b?.x).toBeCloseTo(10, 5);
    expect(b?.z).toBeCloseTo(10 - dx, 5);
  });
  it('a tinted flare (the lantern) multiplies the pool colour per channel on top of the brightness', () => {
    const [e] = emit([prop('stone_lantern', 0, 0)], { stone_lantern: spec({ color: '#ffd08a' }) });
    const c = new Color('#ffd08a');
    const k = FLARE_TABLE.stone_lantern?.flare ?? 0;
    const t = FLARE_TABLE.stone_lantern?.tint ?? [1, 1, 1];
    expect(e?.r).toBeCloseTo(c.r * k * t[0], 6);
    expect(e?.g).toBeCloseTo(c.g * k * t[1], 6);
    expect(e?.b).toBeCloseTo(c.b * k * t[2], 6);
    // deeper amber than the pool: a lower green and blue share than the pool colour has
    expect((e?.g ?? 0) / (e?.r ?? 1)).toBeLessThan(c.g / c.r);
    expect((e?.b ?? 0) / (e?.r ?? 1)).toBeLessThan(c.b / c.r);
  });
  it('colour is the pool colour in linear space times the brightness; the flicker is the pool flicker', () => {
    const [e] = emit([prop('plague_brazier', 0, 0)], { plague_brazier: spec({ color: '#6dff96', flicker: 0.18 }) });
    const c = new Color('#6dff96');
    const k = FLARE_TABLE.plague_brazier?.flare ?? 0;
    expect(e?.r).toBeCloseTo(c.r * k, 6);
    expect(e?.g).toBeCloseTo(c.g * k, 6);
    expect(e?.b).toBeCloseTo(c.b * k, 6);
    expect(e?.g).toBeGreaterThan((e?.r ?? 0) * 2); // green
    expect(e?.flicker).toBe(0.18);
  });
  it('props without a pool, or without a flare, give none; a flare of 0 gives none', () => {
    expect(emit([prop('house_small', 0, 0), prop('obelisk', 1, 1)], { obelisk: spec() })).toEqual([]);
    expect(emit([prop('stone_lantern', 0, 0)], { stone_lantern: spec({ flare: 0 }) })).toEqual([]);
  });
  it('rocks only with an explicit flare; the default height is half the rock', () => {
    expect(emit([], { [rockPoolKey('crystal')]: spec({ radius: 1.5 }) }, [rock('crystal', 1, 1)])).toEqual([]);
    const [e] = emit([], { [rockPoolKey('crystal')]: spec({ radius: 1.5, flare: 0.7 }) }, [rock('crystal', 1, 1, 2, 6)]);
    expect(e?.y).toBeCloseTo(1 + 3, 6);
    expect(e?.key).toBe('rock:crystal');
    const [h] = emit([], { [rockPoolKey('crystal')]: spec({ radius: 1.5, flare: 0.7, flareHeight: 1.1 }) }, [rock('crystal', 1, 1, 2, 6)]);
    expect(h?.y).toBeCloseTo(1 + 1.1, 6);
  });
});

describe('the arc gain and the flicker', () => {
  it('flareGain: 1 by day, rising with the arc poolGain, 0 stays 0, never negative', () => {
    expect(flareGain(1)).toBe(1);
    expect(flareGain(0)).toBe(0);
    expect(flareGain(-2)).toBe(0);
    expect(flareGain(3)).toBeGreaterThan(flareGain(2));
    expect(flareGain(4.5)).toBeGreaterThan(flareGain(3));
    expect(flareGain(3)).toBeCloseTo(3 ** FLARE_GAIN_EXP, 9);
    expect(flareGain(3)).toBeGreaterThan(1.3);
    expect(flareGain(4.5)).toBeLessThan(1.7); // the dusk lift is a lift, not a sun: the lantern stays amber
  });
  it('flareLit: the day share at poolGain 1, the full glow from poolGain 3 (dusk), smooth and monotone in between', () => {
    expect(flareLit(1, 0.3)).toBeCloseTo(0.3, 9);
    expect(flareLit(FLARE_LIT_FROM, 0.3)).toBeCloseTo(0.3, 9);
    expect(flareLit(FLARE_LIT_TO, 0.3)).toBeCloseTo(1, 9);
    expect(flareLit(4.5, 0.3)).toBe(1);
    expect(flareLit(0.5, 0.3)).toBeCloseTo(0.3, 9);
    let prev = 0;
    for (let g = 1; g <= 4.5; g += 0.1) {
      const v = flareLit(g, 0.3);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = v;
    }
    // a fire (day 1) is the same at every gain; the afternoon (gain 2) is part of the way for a lantern
    expect(flareLit(1, 1)).toBe(1);
    expect(flareLit(2, 0.3)).toBeGreaterThan(0.3);
    expect(flareLit(2, 0.3)).toBeLessThan(1);
  });
  it('flareScale: the day glint is FLARE_NOON_SCALE of the radius, the lamp has the full halo from dusk, a fire is always full size, monotone in between', () => {
    expect(flareScale(1, 0.3)).toBeCloseTo(FLARE_NOON_SCALE, 9);
    expect(flareScale(FLARE_LIT_TO, 0.3)).toBeCloseTo(1, 9);
    expect(flareScale(4.5, 0.3)).toBeCloseTo(1, 9);
    expect(flareScale(1, 1)).toBe(1);
    expect(flareScale(4.5, 1)).toBe(1);
    let prev = 0;
    for (let g = 1; g <= 4.5; g += 0.1) {
      const v = flareScale(g, 0.3);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(v).toBeLessThanOrEqual(1 + 1e-12);
      prev = v;
    }
  });
  it('a lantern at noon is a fraction of a lantern at dusk (a glint, then a lamp)', () => {
    const day = FLARE_TABLE.stone_lantern?.day ?? 1;
    const noon = flareLit(1, day) * flareGain(1);
    const dusk = flareLit(4.5, day) * flareGain(4.5);
    expect(noon / dusk).toBeGreaterThan(0.15);
    expect(noon / dusk).toBeLessThan(0.4);
  });
  it('the peak of a lantern flare stays below a white-out at noon (the first build: 2.6) and below the dusk of the first build (4.6, white suns)', () => {
    const lantern = FLARE_TABLE.stone_lantern;
    // linear peak of the added light per channel of the pool colour (a core + a halo of .42), before the pool colour
    const peak = (gain: number): number => (lantern?.flare ?? 0) * FLARE_HDR * flareLit(gain, lantern?.day ?? 1) * flareGain(gain) * ((lantern?.core ?? 1) + 0.42);
    expect(peak(1)).toBeLessThan(1.2);
    expect(peak(4.5)).toBeLessThan(4);
    expect(peak(4.5)).toBeGreaterThan(peak(1) * 2);
  });
  it('flareFlicker is the terrain shader pool flicker at the emitter: steady at amplitude 0, bounded by 1 +- 0.7 x amplitude', () => {
    expect(flareFlicker(12.3, 4, 5, 0)).toBe(1);
    for (let t = 0; t < 20; t += 0.37) {
      const f = flareFlicker(t, -7.5, 3.25, 0.2);
      expect(f).toBeGreaterThanOrEqual(1 - 0.7 * 0.2 - 1e-9);
      expect(f).toBeLessThanOrEqual(1 + 0.7 * 0.2 + 1e-9);
    }
    // the same expression as the terrain shader: 1 + a * 0.7 * (0.6 sin(t 7.3 + x .41 + z .57) + 0.4 sin(t 11.1 + x .9))
    expect(flareFlicker(2, 3, 4, 0.5)).toBeCloseTo(1 + 0.5 * 0.7 * (0.6 * Math.sin(2 * 7.3 + 3 * 0.41 + 4 * 0.57) + 0.4 * Math.sin(2 * 11.1 + 3 * 0.9)), 12);
  });
});

describe('the page switch up=noflare', () => {
  it('is off unless the page is a QA page', () => {
    expect(parseFlareSwitch('?up=noflare', false)).toBe(false);
    expect(parseFlareSwitch('', true)).toBe(false);
    expect(parseFlareSwitch(null, true)).toBe(false);
  });
  it('reads the word among the other up= words, case-insensitive, over several pairs', () => {
    expect(parseFlareSwitch('?up=noflare', true)).toBe(true);
    expect(parseFlareSwitch('?quality=high&up=noarc,NoFlare,nocorr', true)).toBe(true);
    expect(parseFlareSwitch('?up=noarc&x=1&up=noflare', true)).toBe(true);
    expect(parseFlareSwitch('?up=noarc,nocorr', true)).toBe(false);
    expect(parseFlareSwitch('?up=noflared', true)).toBe(false);
  });
});

describe('createFlares', () => {
  const pools = { stone_lantern: spec(), bonfire: spec({ color: '#ffa860', flicker: 0.2 }) };
  const props = [prop('stone_lantern', 5, 5), prop('stone_lantern', -9, 3), prop('bonfire', 0, -12), prop('house_small', 20, 20)];
  const make = (tier: 'low' | 'medium' | 'high' | 'ultra', noFlare = false) => createFlares({ field: field(props), quality: QUALITY_PROFILES[tier] }, { pools }, noFlare);

  it('builds one mesh (one instanced draw) with every flare as an instance', () => {
    const s = make('high');
    expect(s).not.toBeNull();
    expect(s?.emitters).toHaveLength(3);
    expect(s?.group.children).toHaveLength(1);
    expect(s?.mesh.geometry.instanceCount).toBe(3);
    expect(s?.mesh.geometry.getAttribute('aPos').count).toBe(3);
    expect(s?.mesh.geometry.getAttribute('aCol').count).toBe(3);
    expect(s?.mesh.geometry.getAttribute('aEx').count).toBe(3);
    expect(s?.mesh.frustumCulled).toBe(false);
    s?.dispose();
  });
  it('low hides the mesh (no render-list entry, no draw); medium / high / ultra show it with every instance', () => {
    const s = make('low');
    expect(s?.mesh.visible).toBe(false);
    s?.setQuality(QUALITY_PROFILES.medium);
    expect(s?.mesh.visible).toBe(true);
    expect(s?.mesh.geometry.instanceCount).toBe(3);
    s?.setQuality(QUALITY_PROFILES.low);
    expect(s?.mesh.visible).toBe(false);
    s?.setQuality(QUALITY_PROFILES.ultra);
    expect(s?.mesh.visible).toBe(true);
    expect(s?.mesh.geometry.instanceCount).toBe(3);
    s?.setQuality(QUALITY_PROFILES.high);
    expect(s?.mesh.visible).toBe(true);
    s?.dispose();
    const m = make('medium');
    expect(m?.mesh.visible).toBe(true);
    m?.dispose();
    const u = make('ultra');
    expect(u?.mesh.visible).toBe(true);
    u?.dispose();
  });
  it('one material named up:PL-05:flare with no defines and no needsUpdate on a tier change; additive, depth tested, no depth write, no fog', () => {
    const s = make('medium');
    const m = s?.material;
    expect(m?.name).toBe('up:PL-05:flare');
    expect(m?.defines ?? {}).toEqual({});
    expect(m?.transparent).toBe(true);
    expect(m?.depthTest).toBe(true);
    expect(m?.depthWrite).toBe(false);
    expect(m?.fog).toBe(false);
    s?.setQuality(QUALITY_PROFILES.high);
    s?.setQuality(QUALITY_PROFILES.low);
    expect(m?.defines ?? {}).toEqual({});
    expect(m?.version).toBe(0); // needsUpdate never set by the flares
    s?.dispose();
  });
  it('reads the shared uniforms (time, focus, the arc pool gain, the hero in view space): nothing to write per frame', () => {
    const s = make('high');
    const u = s?.material.uniforms ?? {};
    expect(u.uTime).toBe(worldUniforms.uTime);
    expect(u.uFocus).toBe(worldUniforms.uFocus);
    expect(u.uPoolGain).toBe(atmosphereUniforms.uPoolGain);
    expect(u.uHeroView).toBeDefined();
    s?.dispose();
  });
  it('the shader declares those uniforms and the three instance attributes, and carries the fade distances and the day ramp', () => {
    const s = make('high');
    const v = s?.material.vertexShader ?? '';
    for (const name of ['uTime', 'uFocus', 'uPoolGain', 'uHeroView']) expect(v).toMatch(new RegExp(`uniform [a-z0-9]+ ${name};`));
    for (const name of ['aPos', 'aCol', 'aEx']) expect(v).toMatch(new RegExp(`attribute vec4 ${name};`));
    expect(v).toContain('cameraPosition'); // the move onto the visible face needs the camera (a built-in uniform of ShaderMaterial)
    expect(v).toContain(FLARE_FADE_NEAR.toFixed(2));
    expect(v).toContain(FLARE_FADE_FAR.toFixed(2));
    expect(v).toContain(`smoothstep(${FLARE_LIT_FROM.toFixed(2)}, ${FLARE_LIT_TO.toFixed(2)}, uPoolGain)`);
    expect(v).toContain(`mix(${FLARE_NOON_SCALE.toFixed(2)}, 1.0, k)`);
    expect(v).not.toContain('${');
    expect(s?.material.fragmentShader).not.toContain('${');
    s?.dispose();
  });
  it('instance data: position + radius, colour x brightness, flicker amplitude; aEx = day share, fwd, push, core', () => {
    const s = make('high');
    const pos = s?.mesh.geometry.getAttribute('aPos').array as Float32Array;
    const col = s?.mesh.geometry.getAttribute('aCol').array as Float32Array;
    const ex = s?.mesh.geometry.getAttribute('aEx').array as Float32Array;
    expect(Array.from(pos.slice(0, 3))).toEqual([5, Math.fround(FLARE_TABLE.stone_lantern?.height ?? 0), 5]);
    expect(pos[3]).toBeCloseTo(FLARE_TABLE.stone_lantern?.radius ?? 0, 5);
    expect(col[3]).toBeCloseTo(0.05, 6);
    expect(col[11]).toBeCloseTo(0.2, 6); // the bonfire's flicker (third instance)
    expect(col[0]).toBeGreaterThan(0);
    // first instance = the lantern, third = the bonfire
    expect(Array.from(ex.slice(0, 4))).toEqual([
      Math.fround(FLARE_TABLE.stone_lantern?.day ?? 1),
      0,
      Math.fround(FLARE_TABLE.stone_lantern?.push ?? 0),
      Math.fround(FLARE_TABLE.stone_lantern?.core ?? 1),
    ]);
    expect(ex[8]).toBeCloseTo(FLARE_TABLE.bonfire?.day ?? 1, 6);
    expect(ex[11]).toBeCloseTo(FLARE_TABLE.bonfire?.core ?? 1, 6);
    s?.dispose();
  });
  it('up=noflare, or a zone without a lit emitter, builds nothing', () => {
    expect(make('high', true)).toBeNull();
    expect(createFlares({ field: field([prop('house_small', 0, 0)]), quality: QUALITY_PROFILES.high }, { pools }, false)).toBeNull();
    expect(createFlares({ field: field(props), quality: QUALITY_PROFILES.high }, { pools: {} }, false)).toBeNull();
  });
});

describe('the four zones (real looks, real placements)', () => {
  it('every zone with a lit prop has flares, all finite, none for an id the table does not know', async () => {
    const { content } = await import('../../data/loader');
    const { createTerrainField } = await import('../../world/terrainField');
    const counts: Record<string, number> = {};
    for (const zone of content.zones) {
      const f = createTerrainField(zone.biome, zone.biome.seed);
      const look = lookFor(zone.id);
      const em = flareEmitters(poolEmitters(f, look.pools));
      counts[zone.id] = em.length;
      for (const e of em) {
        for (const v of [e.x, e.y, e.z, e.radius, e.r, e.g, e.b, e.flicker, e.day, e.fwd, e.push, e.core]) expect(Number.isFinite(v)).toBe(true);
        expect(look.pools[e.key]).toBeDefined();
        if (look.pools[e.key]?.flare === undefined) expect(FLARE_TABLE[e.key], e.key).toBeDefined();
      }
    }
    expect(counts.yeonmu).toBeGreaterThan(10);
    expect(counts.suryeon).toBeGreaterThan(10);
    expect(counts.seori).toBeGreaterThan(5);
    expect(counts.daeryeol).toBeGreaterThan(10);
  }, 60000);
});
