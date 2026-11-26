// The bowstring: anchors (declared by every bow GLB, measured at the limb tips), the draw timeline, the nock path, the string meshes, and the shipped bows.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Group, Matrix4, Vector3 } from 'three';
import {
  BOW_TIP_FRAC,
  BowStringRig,
  DRAW_RAMP,
  RELEASE_DELAY,
  RELEASE_SPAN,
  MAX_THICKEN,
  MIN_PIXEL_RADIUS,
  STRING_RADIUS,
  stringThickening,
  TWANG_AMP,
  bowAnchorsFromExtras,
  bowDraw,
  isBow,
  measureBowAnchors,
  nockPosition,
  restNock,
} from './bowString';

const A = { top: [-0.28, 0, 0.6] as const, bottom: [-0.28, 0, -0.6] as const };

describe('bow anchors', () => {
  it('reads weapon.string from the scene extras; anything malformed or degenerate is no string', () => {
    expect(bowAnchorsFromExtras({ weapon: { type: 'bow', string: { top: [-0.3, 0, 0.6], bottom: [-0.3, 0, -0.6] } } })).toEqual({ top: [-0.3, 0, 0.6], bottom: [-0.3, 0, -0.6] });
    expect(bowAnchorsFromExtras({ weapon: { type: 'bow' } })).toBeNull();
    expect(bowAnchorsFromExtras(undefined)).toBeNull();
    expect(bowAnchorsFromExtras({ weapon: { string: { top: [0, 0], bottom: [0, 0, 0] } } })).toBeNull();
    expect(bowAnchorsFromExtras({ weapon: { string: { top: [0, 0, Number.NaN], bottom: [0, 0, -0.6] } } })).toBeNull();
    expect(bowAnchorsFromExtras({ weapon: { string: { top: [0, 0, 0.01], bottom: [0, 0, -0.01] } } })).toBeNull();
    expect(isBow({ weapon: { type: 'bow' } })).toBe(true);
    expect(isBow({ weapon: { type: 'sword' } })).toBe(false);
    expect(isBow(undefined)).toBe(false);
  });

  it('measures the tips of a synthetic bow: the centroid of the end share of the limb axis, rounded to the millimetre', () => {
    // an arc: x = -0.3 at the tips (z = +-0.6), +0.1 at the grip; sampled along z, tip clusters get 4 extra vertices each
    const P: number[] = [];
    for (let i = 0; i <= 60; i++) {
      const z = -0.6 + (1.2 * i) / 60;
      P.push(0.1 - 0.4 * (z / 0.6) ** 2, 0.01 * Math.sin(i), z);
    }
    for (const sgn of [1, -1]) for (let k = 0; k < 4; k++) P.push(-0.3, 0, sgn * (0.6 - 0.001 * k));
    const m = measureBowAnchors(P)!;
    expect(m.top[2]).toBeGreaterThan(0.57);
    expect(m.bottom[2]).toBeLessThan(-0.57);
    expect(m.top[0]).toBeLessThan(-0.2);
    expect(m.bottom[0]).toBeLessThan(-0.2);
    expect(Math.abs(m.top[0] - m.bottom[0])).toBeLessThan(1e-3); // symmetric bow, symmetric anchors
    expect(Math.round(m.top[0] * 1000)).toBe(m.top[0] * 1000); // millimetres
    expect(BOW_TIP_FRAC).toBeGreaterThan(0.01);
    expect(BOW_TIP_FRAC).toBeLessThan(0.15);
  });

  it('measures nothing for an empty or tiny (< 20 cm) model', () => {
    expect(measureBowAnchors([])).toBeNull();
    expect(measureBowAnchors([0, 0, 0])).toBeNull();
    expect(measureBowAnchors([0, 0, 0, 0, 0, 0.1])).toBeNull();
  });

  it('the rest nock is the middle of the straight string', () => {
    const n = restNock(A);
    expect(n.toArray()).toEqual([-0.28, 0, 0]);
  });
});

describe('draw timeline (the authored bow shot: the arm blend raises over 25 % of the clip, the draw hand releases at the hit)', () => {
  it('attack / attack2 / cast (and their _b clips) draw, nothing else does', () => {
    for (const a of ['attack', 'attack2', 'attack_b', 'attack2_b', 'cast', 'cast_b']) expect(bowDraw(a, 0.4, 0.9, 0.5).draw).toBeGreaterThan(0.99);
    for (const a of ['dash', 'dash_b', 'hit', 'victory', 'special1', '']) expect(bowDraw(a, 0.4, 0.9, 0.5)).toEqual({ draw: 0, sinceRelease: 0 });
  });

  it('starts at rest, is fully drawn when the arm is up, holds, and lets go at the hit within a few percent of the clip', () => {
    expect(bowDraw('attack', 0, 0.9, 0.5).draw).toBe(0);
    expect(bowDraw('attack', DRAW_RAMP, 0.9, 0.5).draw).toBeCloseTo(1, 6);
    expect(bowDraw('attack', 0.4, 0.9, 0.5).draw).toBeCloseTo(1, 6);
    expect(bowDraw('attack', 0.49, 0.9, 0.5).draw).toBeCloseTo(1, 6);
    expect(bowDraw('attack', 0.5, 0.9, 0.5).draw).toBeCloseTo(1, 6);
    expect(bowDraw('attack', 0.5 + RELEASE_DELAY - 0.001, 0.9, 0.5).draw).toBeCloseTo(1, 2); // the fingers open a hair after the hit time
    expect(bowDraw('attack', 0.5 + RELEASE_DELAY + RELEASE_SPAN, 0.9, 0.5).draw).toBeCloseTo(0, 6);
    expect(bowDraw('attack', 0.9, 0.9, 0.5).draw).toBe(0);
    // monotone ramp up
    let prev = -1;
    for (let u = 0; u <= DRAW_RAMP; u += 0.01) {
      const d = bowDraw('attack2', u, 1, 0.55).draw;
      expect(d).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = d;
    }
  });

  it('counts real seconds from the release, 0 before it', () => {
    expect(bowDraw('attack', 0.3, 0.8, 0.5).sinceRelease).toBe(0);
    expect(bowDraw('attack', 0.75, 0.8, 0.5).sinceRelease).toBeCloseTo((0.75 - 0.5 - RELEASE_DELAY) * 0.8, 9);
  });

  it('a clip without a usable hit time releases at about 55 % (plus the release delay)', () => {
    expect(bowDraw('attack', 0.5, 1, undefined).draw).toBeCloseTo(1, 6);
    expect(bowDraw('attack', 0.65, 1, undefined).draw).toBeCloseTo(0, 6);
    expect(bowDraw('attack', 0.5, 1, 0.01).draw).toBeCloseTo(1, 6);
    expect(bowDraw('attack', 0.65, 1, 5).draw).toBeCloseTo(0, 6);
  });
});

describe('nock path', () => {
  const hand = new Vector3(-0.85, 0.08, 0.05);

  it('is the rest nock with no drawing hand, whatever the state', () => {
    for (const st of [{ draw: 0, sinceRelease: 0 }, { draw: 1, sinceRelease: 0 }, { draw: 0, sinceRelease: 0.05 }]) {
      expect(nockPosition(A, null, st).toArray()).toEqual([-0.28, 0, 0]);
    }
  });

  it('follows the hand: rest at draw 0, the hand at draw 1, linear between', () => {
    expect(nockPosition(A, hand, { draw: 0, sinceRelease: 0 }).toArray()).toEqual([-0.28, 0, 0]);
    const full = nockPosition(A, hand, { draw: 1, sinceRelease: 0 });
    expect(full.distanceTo(hand)).toBeLessThan(1e-9);
    const half = nockPosition(A, hand, { draw: 0.5, sinceRelease: 0 });
    expect(half.x).toBeCloseTo((-0.28 + hand.x) / 2, 9);
    expect(half.y).toBeCloseTo(0.04, 9);
  });

  it('after the release the nock rings about the rest along the pull axis and settles', () => {
    const rest = restNock(A);
    let maxDev = 0;
    for (let t = 0.001; t < 0.6; t += 0.004) {
      const n = nockPosition(A, hand, { draw: 0, sinceRelease: t });
      const dev = n.distanceTo(rest);
      maxDev = Math.max(maxDev, dev);
      // stays on the line rest -> hand
      const d = hand.clone().sub(rest).normalize();
      expect(n.clone().sub(rest).cross(d).length()).toBeLessThan(1e-9);
    }
    expect(maxDev).toBeGreaterThan(0.01);
    expect(maxDev).toBeLessThanOrEqual(TWANG_AMP + 1e-9);
    expect(nockPosition(A, hand, { draw: 0, sinceRelease: 0.6 }).distanceTo(rest)).toBeLessThan(0.002);
  });

  it('no twang when the hand is at the rest nock (nothing was pulled)', () => {
    const n = nockPosition(A, new Vector3(-0.28, 0, 0), { draw: 0, sinceRelease: 0.02 });
    expect(n.toArray()).toEqual([-0.28, 0, 0]);
  });
});

describe('BowStringRig', () => {
  /** the two prisms' end points in the bow frame: a unit prism (height 1 along +Y) through its matrix */
  function ends(rig: BowStringRig): [Vector3, Vector3][] {
    return rig.root.children.map((c) => {
      const m = (c as unknown as { matrix: Matrix4 }).matrix;
      return [new Vector3(0, -0.5, 0).applyMatrix4(m), new Vector3(0, 0.5, 0).applyMatrix4(m)] as [Vector3, Vector3];
    });
  }

  it('a straight string is one line from the top anchor to the bottom anchor through the rest nock', () => {
    const rig = new BowStringRig(A);
    const [s0, s1] = ends(rig) as [[Vector3, Vector3], [Vector3, Vector3]];
    expect(s0[0].distanceTo(new Vector3(...A.top))).toBeLessThan(1e-6);
    expect(s0[1].distanceTo(rig.nock)).toBeLessThan(1e-6);
    expect(s1[0].distanceTo(rig.nock)).toBeLessThan(1e-6);
    expect(s1[1].distanceTo(new Vector3(...A.bottom))).toBeLessThan(1e-6);
    expect(rig.nock.toArray()).toEqual([-0.28, 0, 0]);
    rig.dispose();
  });

  it('a drawn string runs top -> hand -> bottom', () => {
    const rig = new BowStringRig(A);
    const hand = new Vector3(-0.8, 0.1, 0.02);
    rig.set(hand, { draw: 1, sinceRelease: 0 });
    const [s0, s1] = ends(rig) as [[Vector3, Vector3], [Vector3, Vector3]];
    expect(s0[0].distanceTo(new Vector3(...A.top))).toBeLessThan(1e-6);
    expect(s0[1].distanceTo(hand)).toBeLessThan(1e-6);
    expect(s1[0].distanceTo(hand)).toBeLessThan(1e-6);
    expect(s1[1].distanceTo(new Vector3(...A.bottom))).toBeLessThan(1e-6);
    rig.set(null, { draw: 0, sinceRelease: 0 });
    expect(rig.nock.toArray()).toEqual([-0.28, 0, 0]);
    rig.dispose();
  });

  it('is thin, unlit and casts no shadow; dispose detaches it from the bow', () => {
    const rig = new BowStringRig(A);
    for (const c of rig.root.children) {
      const m = c as unknown as { material: { isMeshBasicMaterial?: boolean }; castShadow: boolean; geometry: { parameters: { radiusTop: number } } };
      expect(m.material.isMeshBasicMaterial).toBe(true);
      expect(m.castShadow).toBe(false);
      expect((c as unknown as { userData: { heldIgnore?: boolean } }).userData.heldIgnore).toBe(true); // the held gates measure the bow, not its string
      expect(m.geometry.parameters.radiusTop).toBe(STRING_RADIUS);
    }
    expect(STRING_RADIUS).toBeLessThan(0.008);
    expect(STRING_RADIUS).toBeGreaterThan(0.002);
    const parent = new Group();
    rig.attachTo(parent);
    expect(rig.root.parent).toBe(parent);
    rig.dispose();
    expect(rig.root.parent).toBeNull();
  });
});

describe('string thickness on screen', () => {
  it('keeps the model radius close up and grows to a hairline when the camera is far (bounded)', () => {
    // armory preview: 28 deg fov, ~3 m away, 760 px tall: a pixel is 1 mm, the 4.5 mm string is wide enough as it is
    expect(stringThickening(3, 28, 760)).toBe(1);
    // the game camera: 30 deg fov, ~40 m, 900 px: a pixel is ~2.4 cm; the string is widened to 0.8 px radius
    const k = stringThickening(40, 30, 900);
    expect(k).toBeGreaterThan(2);
    expect(k).toBeLessThanOrEqual(MAX_THICKEN);
    const px = (k * STRING_RADIUS) / ((2 * 40 * Math.tan((15 * Math.PI) / 180)) / 900);
    expect(px).toBeGreaterThanOrEqual(MIN_PIXEL_RADIUS - 1e-9);
    // farther never thins it, and it is capped
    expect(stringThickening(80, 30, 900)).toBeGreaterThanOrEqual(k);
    expect(stringThickening(5000, 30, 900)).toBe(MAX_THICKEN);
    // degenerate input is the model radius
    expect(stringThickening(0, 30, 900)).toBe(1);
    expect(stringThickening(10, 30, 0)).toBe(1);
  });
});

describe('the shipped bows (assets/manifest/models.json)', () => {
  const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
  const models = JSON.parse(readFileSync(resolve(REPO, 'apps/game/public/assets/manifest/models.json'), 'utf8')) as Record<string, { url: string }>;
  function sceneExtras(url: string): { weapon?: { type?: string; string?: { top: number[]; bottom: number[] } } } {
    const buf = readFileSync(resolve(REPO, 'apps/game/public', url));
    const len = buf.readUInt32LE(12);
    const json = JSON.parse(buf.subarray(20, 20 + len).toString('utf8')) as { scenes: { extras?: { weapon?: { type?: string; string?: { top: number[]; bottom: number[] } } } }[] };
    return json.scenes[0]?.extras ?? {};
  }

  for (const t of [0, 1, 2, 3]) {
    it(`ninja_bow_t${t} declares its string anchors at the limb tips on the -X (archer) side`, () => {
      const ex = sceneExtras(models[`ninja_bow_t${t}`]!.url);
      const a = bowAnchorsFromExtras(ex);
      expect(a, 'weapon.string').not.toBeNull();
      const length = (ex.weapon as { length?: number }).length as number;
      // the tips: top at +Z, bottom at -Z, within 8 % of the bow length of the ends
      expect(a!.top[2]).toBeGreaterThan(length * 0.38);
      expect(a!.bottom[2]).toBeLessThan(-length * 0.38);
      // the string side: the belly / back of the bow is +X (toward the target in the left hand), the string -X toward the archer
      expect(a!.top[0]).toBeLessThan(-0.05);
      expect(a!.bottom[0]).toBeLessThan(-0.05);
      // the string is near the bow's centre plane (y)
      expect(Math.abs(a!.top[1])).toBeLessThan(0.05);
      expect(Math.abs(a!.bottom[1])).toBeLessThan(0.05);
    });
  }
});
