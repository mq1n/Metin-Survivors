// SKY-01: sky without banding, haze in the right colour space on every tier, a dome that the run-start fly-in can see.
//  - the horizon curves (skyRamp / skyHaze) start flat and join the old curves exactly above E_RAMP / E_HAZE (the GLSL constants are
//    checked against the CPU references),
//  - the temporal dither is +-1/255, zero-mean, re-rolls every 1/60 s, uses post.ts' hash and exists on the low tier only
//    (medium / high are dithered by post.ts: a dither before ACES / sRGB would be stretched in dark skies),
//  - the haze of the dome and the rings is blended in the colour space the fragment is written in (low: sRGB canvas),
//  - the backdrop walls keep their 45 m foot (a deeper skirt hid real far terrain) and are fully hazed there,
//  - skyVisibleFor: the fly-in pitches (20-30 deg) see the dome, the gameplay pitch (55 deg) does not.
import { Color, PerspectiveCamera, Vector3, type Mesh, type ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { COMPOSITE_FRAG } from '../../post';
import { CAMERA_FOV } from '../../camera';
import { QUALITY_PROFILES } from '../../quality';
import { atmosphereUniforms } from '../atmosphere';
import { findLook } from '../look';
import type { ZoneContext } from '../zoneContext';
import { FOOT_DEPTH, buildBackdrop } from './backdrop';
import { ABYSS_FRAG, atmosphereHazeIsRaw, createSky, isRawHazeMix, skyHazeColor, skyVisibleFor } from './index';
import { DOME_FRAG, RING_FRAG } from './shaders';
import { SKY_DITHER_GLSL, SKY_E_HAZE, SKY_E_RAMP, SKY_GRADIENT_GLSL, SKY_HAZE_OUT_GLSL, skyDitherRef, skyHazeOutRef, skyHazeRef, skyRampRef } from './skyGlsl';
import { SKY_STYLES } from './styles';

const oldRamp = (e: number): number => Math.pow(Math.min(1, Math.max(0, e)), 0.4);
const oldHaze = (e: number): number => (e >= 0 ? Math.exp(-e * 7) * 0.7 : 0.7 + 0.22 * smooth(0, -0.25, e));
function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

describe('horizon curves (no hard line at the horizon)', () => {
  it('skyRamp is the old pow(e, 0.4) from E_RAMP up, starts at 0 with a zero slope and never decreases', () => {
    for (let e = SKY_E_RAMP; e <= 1; e += 0.01) expect(skyRampRef(e)).toBeCloseTo(oldRamp(e), 12);
    expect(skyRampRef(0)).toBe(0);
    expect(skyRampRef(-0.3)).toBe(0);
    expect(skyRampRef(1.5)).toBe(1);
    let prev = 0;
    for (let e = 0; e <= 1; e += 0.0005) {
      const v = skyRampRef(e);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = v;
    }
    // zero slope at the horizon, matching slope where the old curve takes over
    expect(skyRampRef(1e-4) / 1e-4).toBeLessThan(0.01);
    const h = 1e-6;
    const slopeIn = (skyRampRef(SKY_E_RAMP) - skyRampRef(SKY_E_RAMP - h)) / h;
    const slopeOut = (oldRamp(SKY_E_RAMP + h) - oldRamp(SKY_E_RAMP)) / h;
    expect(slopeIn).toBeCloseTo(slopeOut, 3);
  });

  it('no pixel step above the horizon is larger than a few thousandths of the horizon-to-zenith range (the old first pixel was 0.05)', () => {
    const px = 0.0007; // rad per pixel at 1080p, 40 deg FOV
    let worst = 0;
    let worstOld = 0;
    for (let e = 0; e < 0.6; e += px) {
      worst = Math.max(worst, skyRampRef(e + px) - skyRampRef(e));
      worstOld = Math.max(worstOld, oldRamp(e + px) - oldRamp(e));
    }
    expect(worstOld).toBeGreaterThan(0.04); // the seam this fixes
    expect(worst).toBeLessThan(0.006);
  });

  it('skyHaze meets the flat side below the horizon with slope 0, is continuous and never rises with elevation', () => {
    expect(skyHazeRef(0)).toBeCloseTo(0.7, 12);
    expect(skyHazeRef(-1e-9)).toBeCloseTo(0.7, 6);
    for (let e = SKY_E_HAZE; e <= 1; e += 0.01) expect(skyHazeRef(e)).toBeCloseTo(oldHaze(e), 12);
    for (let e = -1; e <= -0.001; e += 0.01) expect(skyHazeRef(e)).toBeCloseTo(oldHaze(e), 12);
    expect(oldHaze(0.001) - oldHaze(0)).toBeLessThan(-0.004); // old kink: -4.9 per rad
    expect(Math.abs(skyHazeRef(0.001) - skyHazeRef(0))).toBeLessThan(3e-4); // 34x less than the old kink
    let prev = skyHazeRef(0);
    for (let e = 0; e <= 1; e += 0.0005) {
      const v = skyHazeRef(e);
      expect(v).toBeLessThanOrEqual(prev + 1e-12);
      prev = v;
    }
    const h = 1e-6;
    const slopeIn = (skyHazeRef(SKY_E_HAZE) - skyHazeRef(SKY_E_HAZE - h)) / h;
    const slopeOut = (oldHaze(SKY_E_HAZE + h) - oldHaze(SKY_E_HAZE)) / h;
    expect(slopeIn).toBeCloseTo(slopeOut, 3);
  });

  it('the GLSL constants are the CPU references', () => {
    const num = (re: RegExp): number => Number(re.exec(SKY_GRADIENT_GLSL)?.[1]);
    const p1 = Math.pow(SKY_E_RAMP, 0.4);
    expect(num(/\* ([\d.]+) \+ \(t2 \* t - t2\) \* [\d.]+;/)).toBeCloseTo(p1, 6);
    expect(num(/\(t2 \* t - t2\) \* ([\d.]+);\n\}\n\nvec3 skyBase/)).toBeCloseTo(0.4 * p1, 6);
    expect(SKY_GRADIENT_GLSL).toContain('if (x >= 0.12) return pow(x, 0.4);');
    expect(SKY_GRADIENT_GLSL).toContain('float t = x / 0.12;');
    expect(SKY_E_RAMP).toBe(0.12);
    expect(SKY_GRADIENT_GLSL).toContain('if (e >= 0.06) return exp(-e * 7.0) * 0.7;');
    expect(SKY_GRADIENT_GLSL).toContain('float t = e / 0.06;');
    const h1 = Math.exp(-SKY_E_HAZE * 7) * 0.7;
    expect(num(/\* 0\.7 \+ \(3\.0 \* t2 - 2\.0 \* t2 \* t\) \* ([\d.]+) \+/)).toBeCloseTo(h1, 6);
    expect(num(/\(t2 \* t - t2\) \* (-[\d.]+);\n\}\n\nvec3 skyGradient/)).toBeCloseTo(-4.9 * Math.exp(-SKY_E_HAZE * 7) * SKY_E_HAZE, 6);
    expect(SKY_E_HAZE).toBe(0.06);
    // the dome uses skyBase for the gradient and skyRamp is the only change to it
    expect(SKY_GRADIENT_GLSL).toContain('mix(uSkyHorizon, uSkyTop, skyRamp(e))');
  });
});

describe('temporal dither', () => {
  it('uses post.ts hash constants and the same per-frame offset', () => {
    for (const c of ['52.9829189', '0.06711056', '0.00583715', '5.588238', '3.1415']) {
      expect(COMPOSITE_FRAG).toContain(c);
      expect(SKY_DITHER_GLSL).toContain(c);
    }
    expect(SKY_DITHER_GLSL).toContain('mod(floor(t * 60.0 + 0.5), 97.0) * 1.37');
  });

  it('every sky fragment shader ends with it and declares uTime exactly once', () => {
    for (const [name, src] of Object.entries({ DOME_FRAG, RING_FRAG, ABYSS_FRAG })) {
      expect(src, name).toContain('float skyDither(float t)');
      expect(src, name).toContain('gl_FragColor.rgb += skyDither(uTime);');
      expect(src.match(/uniform float uTime;/g)?.length, name).toBe(1);
      // the dither is the last write to the colour
      const tail = src.slice(src.lastIndexOf('gl_FragColor.rgb'));
      expect(tail.startsWith('gl_FragColor.rgb += skyDither(uTime);'), name).toBe(true);
    }
    // the old static sin() hash is gone
    expect(DOME_FRAG).not.toContain('43758.5453');
  });

  it('exists on the low tier only: any other tier (or a missing QUALITY define) compiles to 0.0', () => {
    expect(SKY_DITHER_GLSL).toContain('#if defined( QUALITY ) && QUALITY == 0');
    const [low, other] = SKY_DITHER_GLSL.split('#else');
    expect(low).toContain('(a + b - 1.0) * (1.0 / 255.0)');
    expect(other).toMatch(/return 0\.0;\s*#endif/);
    expect(other).not.toContain('gl_FragCoord');
    expect(skyDitherRef(10.5, 20.5, 0.4, 0)).not.toBe(0);
    for (const q of [1, 2]) expect(skyDitherRef(10.5, 20.5, 0.4, q)).toBe(0);
  });

  it('the sky materials carry the QUALITY define the gate reads, and setQuality keeps all three in step', () => {
    const zone = 'yeonmu';
    const ctx = {
      biome: { id: zone, seed: 7, sky: { top: '#1849a8', horizon: '#d9e6ff', bottom: '#b0bdd6' } },
      core: { env: { fog: { color: new Color('#b0bdd6') }, sun: { color: new Color('#fff4e2') } } },
      quality: QUALITY_PROFILES.low,
    } as unknown as ZoneContext;
    const sky = createSky(ctx);
    const mats = sky.group.children.map((o) => (o as Mesh).material as ShaderMaterial);
    expect(mats.map((m) => m.name).sort()).toEqual(['sky_abyss', 'sky_backdrop', 'sky_dome']);
    for (const m of mats) expect(m.defines.QUALITY, m.name).toBe(0);
    sky.setQuality(QUALITY_PROFILES.high);
    for (const m of mats) expect(m.defines.QUALITY, m.name).toBe(2);
    sky.setQuality(QUALITY_PROFILES.medium);
    for (const m of mats) expect(m.defines.QUALITY, m.name).toBe(1);
    sky.dispose();
  });

  it('is within +-1/255, zero mean, and re-rolls every 1/60 s', () => {
    let sum = 0;
    let n = 0;
    let max = 0;
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 64; x++) {
        const d = skyDitherRef(x + 0.5, y + 0.5, 0.4);
        max = Math.max(max, Math.abs(d));
        sum += d;
        n++;
      }
    expect(max).toBeLessThanOrEqual(1 / 255);
    expect(Math.abs(sum / n)).toBeLessThan(0.05 / 255);
    // the next frame is another pattern; the same frame is the same pattern
    let differ = 0;
    for (let i = 0; i < 400; i++) {
      const x = (i * 37) % 64;
      const y = (i * 11) % 64;
      if (Math.abs(skyDitherRef(x + 0.5, y + 0.5, 0.4) - skyDitherRef(x + 0.5, y + 0.5, 0.4 + 1 / 60)) > 1e-6) differ++;
      expect(skyDitherRef(x + 0.5, y + 0.5, 0.4)).toBe(skyDitherRef(x + 0.5, y + 0.5, 0.4));
    }
    expect(differ).toBeGreaterThan(380);
    // one pixel averages to zero over the 97 frames of the seed cycle
    let acc = 0;
    for (let f = 0; f < 97; f++) acc += skyDitherRef(100.5, 50.5, f / 60 + 1e-4);
    expect(Math.abs(acc / 97)).toBeLessThan(0.15 / 255);
  });

  it('turns a slow gradient into the right local average instead of steps', () => {
    // 0.7 level over 300 px, rendered to 8 bit: without dither a single step, with dither the local mean follows the ramp
    const rows = 16;
    const width = 300;
    const slope = 0.7 / width;
    const base = 120.2;
    const mean = (dither: boolean, from: number, to: number): number => {
      let s = 0;
      let n = 0;
      for (let y = 0; y < rows; y++)
        for (let x = from; x < to; x++) {
          const v = base + slope * x + (dither ? skyDitherRef(x + 0.5, y + 0.5, 1 / 60) * 255 : 0);
          s += Math.round(v);
          n++;
        }
      return s / n;
    };
    let worstDither = 0;
    let worstPlain = 0;
    for (let x0 = 0; x0 < width; x0 += 30) {
      const truth = base + slope * (x0 + 15);
      worstDither = Math.max(worstDither, Math.abs(mean(true, x0, x0 + 30) - truth));
      worstPlain = Math.max(worstPlain, Math.abs(mean(false, x0, x0 + 30) - truth));
    }
    expect(worstPlain).toBeGreaterThan(0.25);
    expect(worstDither).toBeLessThan(0.1);
  });
});

describe('backdrop walls (the foot stays at 45 m: a deeper skirt covers real far terrain)', () => {
  const zones = Object.keys(SKY_STYLES);

  it('every wall ends FOOT_DEPTH under its foot, and that foot is fully hazed by the fragment shader (vA.x <= 0)', () => {
    // The rings write depth at 240-292 m. A skirt of 110 m (tried in the first SKY-01 build) hid the distant tree line and far
    // snowfield of Seori and the far lava of Daeryeol behind a wall of plain haze on every tier. The abyss under the foot is 70-85 %
    // haze near the horizon and blends in, so the walls stay as they were.
    expect(FOOT_DEPTH).toBe(45);
    for (const zone of zones) {
      const style = SKY_STYLES[zone]!;
      const lift = findLook(zone)?.edge?.ringBase ?? 0;
      const g = buildBackdrop(style, 1234, { ringBase: lift });
      const pos = g.geometry.getAttribute('position');
      const aA = g.geometry.getAttribute('aA');
      style.rings.forEach((ring, k) => {
        let minY = Infinity;
        let maxY = -Infinity;
        for (let i = 0; i <= 384; i++) {
          const top = (k * 385 + i) * 2;
          minY = Math.min(minY, pos.getY(top + 1));
          maxY = Math.max(maxY, pos.getY(top));
          expect(aA.getX(top + 1), `${zone} ring ${k} col ${i} foot`).toBe(-FOOT_DEPTH);
        }
        expect(minY, `${zone} ring ${k} bottom`).toBeCloseTo(ring.base + lift - FOOT_DEPTH, 4);
        expect(maxY, `${zone} ring ${k} top`).toBeGreaterThan(ring.base + lift);
      });
    }
    // the fade the shader applies at the foot: foot = 1 - smoothstep(0, 30, vA.x) is 1 for every vA.x <= 0
    expect(RING_FRAG).toContain('float foot = 1.0 - smoothstep(0.0, 30.0, vA.x);');
  });

  it('keeps one quad strip per ring (vertex and index counts)', () => {
    const g = buildBackdrop(SKY_STYLES.suryeon!, 1234, { ringBase: 18 });
    expect(g.geometry.getAttribute('position').count).toBe(3 * 385 * 2);
    expect(g.geometry.index!.count).toBe(3 * 384 * 6);
  });
});

describe('haze colour space (low tier draws straight to the sRGB canvas)', () => {
  it('the dome and the rings blend skyHazeOut() after <colorspace_fragment>, never the raw linear uHazeColor', () => {
    expect(SKY_HAZE_OUT_GLSL).toContain('linearToOutputTexel(vec4(uFogColor, 1.0)).rgb');
    expect(SKY_HAZE_OUT_GLSL).toContain('linearToOutputTexel(vec4(uAtmoHaze, 1.0)).rgb');
    for (const [name, src] of Object.entries({ DOME_FRAG, RING_FRAG })) {
      expect(src, name).toContain('vec3 skyHazeOut()');
      const tail = src.slice(src.indexOf('#include <colorspace_fragment>'));
      expect(tail, `${name} mixes the converted haze`).toContain('skyHazeOut()');
      // the only mention of uHazeColor after the colour space conversion is inside that helper (which sits above it)
      expect(tail.includes('uHazeColor'), `${name} raw uHazeColor after the conversion`).toBe(false);
    }
    // MESA foot fade and the haze mix share one converted colour
    expect(RING_FRAG).toMatch(/vec3 hazeOut = skyHazeOut\(\);[\s\S]*mix\(gl_FragColor\.rgb, hazeOut, hz \* skyHaze\(dir\.y\)\)[\s\S]*mix\(gl_FragColor\.rgb, hazeOut, foot\)/);
  });

  it('the abyss mixes its haze before tone mapping (linear), so it needs no conversion', () => {
    const head = ABYSS_FRAG.slice(0, ABYSS_FRAG.indexOf('#include <tonemapping_fragment>'));
    expect(head).toContain('uHazeColor');
    expect(ABYSS_FRAG).not.toContain('skyHazeOut');
  });
});

describe('sky visibility (fly-in)', () => {
  it('the fly-in pitches see the dome, the gameplay pitch does not', () => {
    for (const pitch of [20, 22, 25, 30, 35, 41]) expect(skyVisibleFor(pitch), `pitch ${pitch}`).toBe(true);
    for (const pitch of [43, 45, 55, 65]) expect(skyVisibleFor(pitch), `pitch ${pitch}`).toBe(false);
    expect(skyVisibleFor(55)).toBe(false);
  });

  it('follows the field of view: a wider lens sees the sky from a steeper pitch', () => {
    expect(skyVisibleFor(48, 40)).toBe(false);
    expect(skyVisibleFor(48, 60)).toBe(true);
    expect(skyVisibleFor(0, 10)).toBe(true);
  });
});

describe('haze colour = the colour the far terrain ends at (atmosphere.ts depth haze over the scene fog)', () => {
  const fog = new Color('#a38864'); // Suryeon
  const haze = new Color('#c4a070');
  const saved = { x: atmosphereUniforms.uHaze.value.x, c: atmosphereUniforms.uHazeColor.value.clone() };
  const setAtmo = (depth: number): void => {
    atmosphereUniforms.uHaze.value.x = depth;
    atmosphereUniforms.uHazeColor.value.copy(haze);
  };
  const restore = (): void => {
    atmosphereUniforms.uHaze.value.x = saved.x;
    atmosphereUniforms.uHazeColor.value.copy(saved.c);
  };

  it('is fog + (haze - fog) * depth in the working space, clamped like FRAG_FOG (0.92) and the plain fog without depth haze', () => {
    try {
      const out = new Color();
      setAtmo(0);
      expect(skyHazeColor(out, fog).equals(fog)).toBe(true);
      setAtmo(0.26);
      skyHazeColor(out, fog);
      expect(out.r).toBeCloseTo(fog.r + (haze.r - fog.r) * 0.26, 6);
      expect(out.g).toBeCloseTo(fog.g + (haze.g - fog.g) * 0.26, 6);
      expect(out.b).toBeCloseTo(fog.b + (haze.b - fog.b) * 0.26, 6);
      // lighter than the fog alone: this is what the first build missed (the sky came out darker than the ground at the world edge)
      expect(out.r + out.g + out.b).toBeGreaterThan(fog.r + fog.g + fog.b);
      setAtmo(3);
      skyHazeColor(out, fog);
      expect(out.r).toBeCloseTo(fog.r + (haze.r - fog.r) * 0.92, 6);
      setAtmo(-1);
      expect(skyHazeColor(out, fog).equals(fog)).toBe(true);
    } finally {
      restore();
    }
  });

  it('does not touch the inputs, and the sky materials follow the arc every frame', () => {
    try {
      const f = fog.clone();
      skyHazeColor(new Color(), f);
      expect(f.equals(fog)).toBe(true);
      const ctx = {
        biome: { id: 'suryeon', seed: 7, sky: { top: '#3c6a8a', horizon: '#d4c49a', bottom: '#a38864' } },
        core: { env: { fog: { color: fog.clone() }, sun: { color: new Color('#fff4e2') } } },
        quality: QUALITY_PROFILES.high,
      } as unknown as ZoneContext;
      const sky = createSky(ctx);
      const mats = sky.group.children.map((o) => (o as Mesh).material as ShaderMaterial);
      const cam = new PerspectiveCamera(CAMERA_FOV, 16 / 9);
      setAtmo(0.26);
      sky.update(0.016, cam, new Vector3());
      const want = skyHazeColor(new Color(), fog);
      for (const m of mats) expect((m.uniforms.uHazeColor!.value as Color).equals(want), m.name).toBe(true);
      // the arc raises the depth haze and the fog moves: the next frame follows (the abyss shares the uniform)
      setAtmo(0.5);
      (ctx.core.env.fog.color as Color).set('#806040');
      sky.update(0.016, cam, new Vector3());
      const want2 = skyHazeColor(new Color(), ctx.core.env.fog.color);
      expect(want2.equals(want)).toBe(false);
      for (const m of mats) expect((m.uniforms.uHazeColor!.value as Color).equals(want2), m.name).toBe(true);
      sky.dispose();
    } finally {
      restore();
    }
  });
});

describe('output-space haze mirrors the far terrain on every tier (skyHazeOut)', () => {
  const lin = (hex: string): [number, number, number] => {
    const c = new Color(hex); // Color(hex) holds the linear working-space value
    return [c.r, c.g, c.b];
  };
  const to8 = (c: readonly number[]): number[] => c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255));

  it('low (canvas): ATMO_RAW is the terrain of atmosphere.ts as it is written, mix(OETF(fog), raw haze, k); without it everything is converted', () => {
    // Suryeon: fog #a38864, haze #c4a070 at 0.26. The r2 critic measured the low far cliffs at (157, 124, 85) = 0.74 x sRGB(fog) + 0.26 x linear(haze)
    const fog = lin('#a38864');
    const haze = lin('#c4a070');
    expect(to8(skyHazeOutRef(fog, haze, 0.26, true, true))).toEqual([157, 124, 85]);
    // the converted (correct) colour is lighter and warmer
    expect(to8(skyHazeOutRef(fog, haze, 0.26, false, true))).toEqual([172, 142, 103]);
  });

  it('medium / high (linear HDR target): both forms are the linear mix(fog, haze, k)', () => {
    const fog = lin('#a38864');
    const haze = lin('#c4a070');
    for (const raw of [true, false]) {
      const out = skyHazeOutRef(fog, haze, 0.26, raw, false);
      for (let i = 0; i < 3; i++) expect(out[i]).toBeCloseTo((fog[i] as number) + ((haze[i] as number) - (fog[i] as number)) * 0.26, 12);
    }
  });

  it('isRawHazeMix tells the unconverted mix of atmosphere.ts from a converted one', () => {
    expect(isRawHazeMix('gl_FragColor.rgb = mix(gl_FragColor.rgb, uHazeColor, clamp(atmoH, 0.0, 0.92));')).toBe(true);
    expect(isRawHazeMix('gl_FragColor.rgb = mix(gl_FragColor.rgb,uHazeColor ,atmoH);')).toBe(true);
    expect(isRawHazeMix('gl_FragColor.rgb = mix(gl_FragColor.rgb, linearToOutputTexel(vec4(uHazeColor, 1.0)).rgb, clamp(atmoH, 0.0, 0.92));')).toBe(false);
    expect(isRawHazeMix('vec3 hazeOut = linearToOutputTexel(vec4(uHazeColor, 1.0)).rgb; gl_FragColor.rgb = mix(gl_FragColor.rgb, hazeOut, atmoH);')).toBe(false);
  });

  it('the dome and the rings carry ATMO_RAW exactly when the atmosphere patch applied right now is raw, and the sky shaders branch on it', () => {
    expect(SKY_HAZE_OUT_GLSL).toContain('#ifdef ATMO_RAW');
    expect(SKY_HAZE_OUT_GLSL).toContain('return mix(fogOut, uAtmoHaze, uAtmoK);');
    const ctx = {
      biome: { id: 'suryeon', seed: 7, sky: { top: '#3c6a8a', horizon: '#d4c49a', bottom: '#a38864' } },
      core: { env: { fog: { color: new Color('#a38864') }, sun: { color: new Color('#fff4e2') } } },
      quality: QUALITY_PROFILES.low,
    } as unknown as ZoneContext;
    const sky = createSky(ctx);
    const mats = sky.group.children.map((o) => (o as Mesh).material as ShaderMaterial);
    for (const m of mats) {
      if (m.name === 'sky_abyss') continue; // pre tone mapping: linear, no conversion needed
      expect(m.defines.ATMO_RAW === 1, m.name).toBe(atmosphereHazeIsRaw());
      for (const u of ['uFogColor', 'uAtmoHaze', 'uAtmoK']) expect(m.uniforms[u], `${m.name} ${u}`).toBeDefined();
    }
    sky.dispose();
  });
});
