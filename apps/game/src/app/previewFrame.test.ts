import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import {
  cameraAt,
  frameMeasure,
  framePreview,
  HERO_MIN,
  heldPoints,
  heroOnlyFraming,
  heroShare,
  maxNdc,
  PAN_MAX,
  panAt,
  PITCH,
  previewBounds,
  TIP_SHARE,
  toPreviewPoints,
  YAW_SAMPLES,
  type PreviewBounds,
  type PreviewCamera,
  type PreviewPoints,
} from './previewFrame';

const FOV = 28; // app/heroPreview.ts PerspectiveCamera
const ARMORY = 520 / 760; // the armory preview frame
const TAN = Math.tan(((FOV * Math.PI) / 180) / 2);
/** the male warrior of the live tree (ASP measure 2026-11-06): 1.85 m, 0.45 m from the turntable axis at the widest */
const HERO_M: PreviewBounds = { r: 0.45, y0: 0, y1: 1.85 };

/** a straight weapon as points: from the grip along `dir` for `reach` metres (n + 1 points), in the pivot frame */
function rod(grip: [number, number, number], dir: [number, number, number], reach: number, n = 80): PreviewPoints {
  const len = Math.hypot(...dir);
  const d = dir.map((c) => c / len) as [number, number, number];
  const xyz: number[] = [], s: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * reach;
    xyz.push(grip[0] + d[0] * t, grip[1] + d[1] * t, grip[2] + d[2] * t);
    s.push(t);
  }
  return toPreviewPoints({ xyz, s })!;
}

/** the frame's half width at the look-at distance of a camera */
const halfWidth = (cam: PreviewCamera): number => cam.dist * Math.hypot(1, PITCH) * TAN * ARMORY;
const yaws = (n = 90): number[] => Array.from({ length: n }, (_, k) => (k / n) * Math.PI * 2);

describe('previewFrame', () => {
  it('keeps the old hero-only framing without a weapon and with one that fits it', () => {
    const none = framePreview(1.8, { r: 0.45, y0: 0, y1: 1.8 }, null, FOV, ARMORY);
    expect(none.fit).toBe('hero');
    expect(cameraAt(none, 0.3)).toEqual(heroOnlyFraming(1.8));
    expect(none.pan.every((p) => p === 0)).toBe(true);
    const sword = rod([0.3, 0.9, 0.1], [0, -1, 0], 0.8); // hanging down along the leg
    const f = framePreview(1.8, { r: 0.45, y0: 0, y1: 1.8 }, sword, FOV, ARMORY);
    expect(f.fit).toBe('hero');
    expect(f.cut).toBe(0);
    for (const y of [0, 0.3, 1.3, -0.7, 2.5]) expect(cameraAt(f, y)).toEqual(heroOnlyFraming(1.8));
    expect(heroShare({ r: 0.45, y0: 0, y1: 1.8 }, cameraAt(f, 0), FOV)).toBeCloseTo(1 / (2 * 3.1 * Math.hypot(1, PITCH) * TAN), 6); // 64.7 %
    const m = maxNdc({ r: 0.45, y0: 0, y1: 1.8 }, cameraAt(f, 0), FOV, ARMORY);
    expect(Math.max(m.x, m.y)).toBeLessThanOrEqual(0.95);
  });

  it('lets a dagger tip (within the allowance) poke out of the old framing instead of moving the camera', () => {
    // the old framing's half width for a 1.85 m hero is 0.98 m (margin line 0.93 m): blades held out from 0.42 m that reach past the edge at some
    // yaw while their body (85 %) stays inside the margin keep the old framing with a small cut; longer ones move the camera
    const fits: number[] = [], poke: number[] = [], moved: number[] = [];
    for (let reach = 0.4; reach <= 0.8; reach += 0.01) {
      const f = framePreview(1.85, HERO_M, rod([0.42, 0.9, 0], [1, 0, 0], reach), FOV, ARMORY);
      if (f.fit !== 'hero') { moved.push(reach); continue; }
      expect(cameraAt(f, 0.3)).toEqual(heroOnlyFraming(1.85));
      expect(f.cut).toBeLessThanOrEqual(TIP_SHARE + 1e-9);
      (f.cut > 0 ? poke : fits).push(reach);
    }
    expect(fits.length).toBeGreaterThan(0);
    expect(poke.length).toBeGreaterThan(0);
    expect(moved.length).toBeGreaterThan(0);
    expect(Math.max(...fits)).toBeLessThan(Math.min(...poke));
    expect(Math.max(...poke)).toBeLessThan(Math.min(...moved));
  });

  it('backs off and re-centres for a blade held above the head: nothing cut, the hero still over half the frame', () => {
    const hero: PreviewBounds = { r: 0.45, y0: 0, y1: 1.8 };
    const blade = rod([0.3, 1.4, 0.1], [0, 1, 0], 1.5); // tip at 2.9 m
    const old = heroOnlyFraming(1.8);
    expect(frameMeasure({ dist: old.pos[2], lookY: old.look[1], pan: [0], fit: 'hero', heroShare: 0, cut: 0 }, hero, blade, 0, FOV, ARMORY).cross).toBeGreaterThan(0); // the old framing cut it
    const f = framePreview(1.8, hero, blade, FOV, ARMORY);
    expect(f.fit).toBe('pan');
    expect(f.cut).toBe(0);
    expect(f.dist).toBeGreaterThan(old.pos[2]); // never closer than the hero-only framing
    expect(f.lookY).toBeGreaterThan(old.look[1]); // re-centred on the union
    expect(f.heroShare).toBeGreaterThanOrEqual(HERO_MIN);
    for (const y of yaws(24)) {
      const m = frameMeasure(f, hero, blade, y, FOV, ARMORY);
      expect(m.cross).toBe(0);
      expect(m.weapon!.y1).toBeLessThanOrEqual(0.95 + 1e-3);
      expect(Math.max(m.hero.x, m.hero.y)).toBeLessThanOrEqual(0.95 + 1e-3); // the hero is never cut
      expect(m.heroShare).toBeGreaterThanOrEqual(HERO_MIN);
      expect(Math.abs(panAt(f.pan, y))).toBeLessThan(0.05); // a blade near the axis needs no pan
    }
  });

  // weapon judge r2 MF12, rule 1 + 2: with a long weapon held out sideways (the warrior glaives t0..t3, reach 1.29..1.78 m from a grip 0.3 m off the
  // axis) the hero keeps >= half of the frame height, and only the weapon tip (<= 15 % of its reach) may cross the frame edge, only at the yaws
  // where the weapon lies across the view
  it('keeps the hero at >= half the frame and cuts a sideways glaive by its tip at most, only where it lies across the view', () => {
    for (const reach of [1.29, 1.35, 1.69, 1.78]) {
      const glaive = rod([0.3, 1.0, 0.15], [1, 0, 0], reach); // across the view at yaw 0 / pi, along it at +-pi/2
      const f = framePreview(1.85, HERO_M, glaive, FOV, ARMORY);
      expect(f.fit).not.toBe('hero');
      expect(f.heroShare).toBeGreaterThanOrEqual(HERO_MIN - 1e-9);
      expect(f.cut).toBeLessThanOrEqual(TIP_SHARE + 1e-9);
      expect(f.dist).toBeGreaterThanOrEqual(heroOnlyFraming(1.85).pos[2]);
      const hw = halfWidth(f);
      for (const y of [...yaws(), 0.3, 1.3, -0.7]) {
        const m = frameMeasure(f, HERO_M, glaive, y, FOV, ARMORY);
        expect(m.heroShare).toBeGreaterThanOrEqual(HERO_MIN - 1e-3); // rule 1 (the projected hero, every yaw incl. the rest yaw 0.3)
        expect(m.cross).toBeLessThanOrEqual(TIP_SHARE + 1e-3); // rule 2: the tip at most
        // only where the weapon lies across the view: within 60 deg of the perpendicular (the near tip of a glaive turned toward the camera grows
        // with the perspective, so the crossing band is wider than the 45 deg of a flat projection)
        if (m.cross > 0) expect(Math.abs(Math.cos(y))).toBeGreaterThanOrEqual(Math.cos(Math.PI / 3) - 1e-9);
        // the hero itself never leaves the frame; it keeps its margin too unless the floor binds and the glaive's near end needs the margin band
        expect(Math.max(m.hero.x, m.hero.y)).toBeLessThanOrEqual((f.fit === 'floor' ? 1 : 0.95) + 1e-3);
        expect(m.hero.y).toBeLessThanOrEqual(0.95 + 1e-3);
        expect(m.weapon!.y0).toBeGreaterThanOrEqual(-1); // nothing cut at the top / bottom
        expect(m.weapon!.y1).toBeLessThanOrEqual(1);
        const pan = panAt(f.pan, y);
        const tipX = (0.3 + reach) * Math.cos(y) + 0.15 * Math.sin(y); // the glaive tip's side at this yaw
        expect(pan * Math.sign(tipX)).toBeGreaterThanOrEqual(-1e-9); // the pan goes toward the weapon's side only
        expect(Math.abs(pan)).toBeLessThanOrEqual(hw - HERO_M.r + 1e-9); // and never pushes the hero out
        if (f.fit === 'pan') expect(Math.abs(pan)).toBeLessThanOrEqual(PAN_MAX * hw + 1e-6);
      }
      // where the glaive points along the view the camera is centred again; across the view it pans
      expect(Math.abs(panAt(f.pan, Math.PI / 2))).toBeLessThan(0.02);
      expect(Math.abs(panAt(f.pan, -Math.PI / 2))).toBeLessThan(0.02);
      expect(panAt(f.pan, 0)).toBeGreaterThan(0.1);
      // the pan table is continuous: the step between neighbouring samples is bounded by how far the tip can move laterally in one step
      // (2.1 m from the axis, 5 deg: 0.18 m, plus the perspective) and shrinks with the sample spacing (1 deg samples: a fifth of it), no jump
      const step = (pan: readonly number[]): number => Math.max(...pan.map((p, k) => Math.abs(p - pan[(k + 1) % pan.length]!)));
      expect(step(f.pan)).toBeLessThan(0.25);
      const fine = framePreview(1.85, HERO_M, glaive, FOV, ARMORY, 0.05, { samples: 360 });
      expect(step(fine.pan)).toBeLessThan(0.06);
      expect(Math.abs(fine.dist - f.dist)).toBeLessThan(0.05);
    }
    // the shortest glaive still fits whole with a capped pan (the hero bigger than the floor), the longest needs the floor
    expect(framePreview(1.85, HERO_M, rod([0.3, 1.0, 0.15], [1, 0, 0], 1.29), FOV, ARMORY).fit).toBe('pan');
    expect(framePreview(1.85, HERO_M, rod([0.3, 1.0, 0.15], [1, 0, 0], 1.29), FOV, ARMORY).heroShare).toBeGreaterThan(HERO_MIN + 0.03);
    expect(framePreview(1.85, HERO_M, rod([0.3, 1.0, 0.15], [1, 0, 0], 1.78), FOV, ARMORY).fit).toBe('floor');
  });

  // a dual weapon (the ninja daggers t1 / t2 of the live tree): a blade in each hand, each poking out of the old framing on its own side at some yaws.
  // The pan toward one blade must not push the other one out (ASP after_v1 measure: the first solver cut the far dagger by half at the back yaws)
  it('never pans one dagger of a dual weapon into the frame at the cost of the other', () => {
    const right = rod([0.42, 0.9, 0.1], [1, 0, 0.3], 0.62), left = rod([-0.42, 0.9, 0.1], [-1, 0, 0.3], 0.62);
    const dual: PreviewPoints = {
      xyz: Float32Array.from([...right.xyz, ...left.xyz]), s: Float32Array.from([...right.s, ...left.s]), reach: Math.max(right.reach, left.reach),
    };
    const f = framePreview(1.85, HERO_M, dual, FOV, ARMORY);
    expect(f.heroShare).toBeGreaterThan(0.6); // the old framing's size (or very near it)
    expect(f.cut).toBeLessThanOrEqual(TIP_SHARE + 1e-9);
    const hw = halfWidth(f);
    for (const y of yaws()) {
      const m = frameMeasure(f, HERO_M, dual, y, FOV, ARMORY);
      expect(m.cross).toBeLessThanOrEqual(TIP_SHARE + 1e-3);
      expect(Math.max(m.hero.x, m.hero.y)).toBeLessThanOrEqual(0.95 + 1e-3);
      expect(Math.abs(panAt(f.pan, y))).toBeLessThanOrEqual(0.15 * hw + 1e-9); // a dagger tip never moves the camera far
    }
    expect(f.dist).toBeLessThanOrEqual(heroOnlyFraming(1.85).pos[2] * 1.05); // and backs the camera off by a few percent at most
  });

  it('holds the hero rules at other aspects and never cuts more than a centred camera would', () => {
    const glaive = rod([0.3, 1.0, 0.15], [1, 0, 0], 1.78);
    for (const aspect of [ARMORY, 1, 1.6, 0.45]) {
      const f = framePreview(1.85, HERO_M, glaive, FOV, aspect);
      const centred: PreviewCamera = { ...f, pan: f.pan.map(() => 0) };
      expect(f.heroShare).toBeGreaterThanOrEqual(HERO_MIN - 1e-9);
      for (const y of yaws(36)) {
        const m = frameMeasure(f, HERO_M, glaive, y, FOV, aspect);
        expect(m.heroShare).toBeGreaterThanOrEqual(HERO_MIN - 1e-3);
        expect(Math.max(m.hero.x, m.hero.y)).toBeLessThanOrEqual((f.fit === 'floor' ? 1 : 0.95) + 1e-3); // never out of the frame; the margin band only at the floor
        expect(m.hero.y).toBeLessThanOrEqual(0.95 + 1e-3);
        expect(m.cross).toBeLessThanOrEqual(frameMeasure(centred, HERO_M, glaive, y, FOV, aspect).cross + 1e-9);
        // a frame at least as wide as the armory's can show the glaive up to its tip at a half-frame hero; a 0.45 frame cannot (the rules conflict:
        // the hero stays whole and over half the frame, the glaive loses more than its tip)
        if (aspect >= ARMORY) expect(m.cross).toBeLessThanOrEqual(TIP_SHARE + 1e-3);
      }
    }
  });

  it('reads the pan table periodically and linearly between the samples', () => {
    const pan = [0, 1, 0, -1];
    expect(panAt(pan, 0)).toBe(0);
    expect(panAt(pan, Math.PI / 2)).toBeCloseTo(1, 9);
    expect(panAt(pan, Math.PI / 4)).toBeCloseTo(0.5, 9);
    expect(panAt(pan, Math.PI / 2 + Math.PI * 2)).toBeCloseTo(1, 9);
    expect(panAt(pan, -Math.PI / 2)).toBeCloseTo(-1, 9);
    expect(panAt([], 1)).toBe(0);
    expect(framePreview(1.85, HERO_M, rod([0.3, 1, 0], [1, 0, 0], 1.78), FOV, ARMORY).pan).toHaveLength(YAW_SAMPLES);
  });

  it('measures the union of the hero and a held weapon: the hero as a cylinder about the turntable axis, the weapon as points from its grip', () => {
    const pivot = new Group();
    pivot.rotation.y = 1.1; // the turntable yaw does not change the cylinder or the points
    const hero = new Mesh(new BoxGeometry(0.6, 1.8, 0.3), new MeshBasicMaterial());
    hero.position.y = 0.9;
    const hand = new Group();
    hand.position.set(-0.4, 1.0, 0.1);
    hero.add(hand);
    hand.position.sub(hero.position);
    const blade = new Mesh(new BoxGeometry(0.06, 1.4, 0.02), new MeshBasicMaterial());
    blade.position.y = 0.7; // grip at the hand, blade up to 2.4 m
    hand.add(blade);
    pivot.add(hero);
    const all = previewBounds([hero], pivot);
    expect(all.y0).toBeCloseTo(0, 5);
    expect(all.y1).toBeCloseTo(2.4, 5);
    expect(all.r).toBeCloseTo(Math.hypot(0.43, 0.11), 5); // the farthest vertex from the axis: a blade corner at x = -0.43, z = 0.11
    const only = previewBounds([hero], pivot, 1, new Set([blade]));
    expect(only.r).toBeCloseTo(Math.hypot(0.3, 0.15), 5);
    expect(only.y1).toBeCloseTo(1.8, 5);
    const pts = toPreviewPoints(heldPoints([blade], pivot, 1))!;
    expect(pts.s.length).toBe(24); // the box's 24 vertices
    expect(pts.reach).toBeCloseTo(Math.hypot(0.03, 0.7, 0.01), 5); // from the blade's root (its centre) to a far corner
    let y1 = -Infinity;
    for (let i = 1; i < pts.xyz.length; i += 3) y1 = Math.max(y1, pts.xyz[i]!);
    expect(y1).toBeCloseTo(2.4, 5);
    pivot.rotation.y = -0.4; // the points are in the pivot frame: the same at another yaw
    const again = toPreviewPoints(heldPoints([blade], pivot, 1))!;
    for (let i = 0; i < pts.xyz.length; i++) expect(Math.abs(again.xyz[i]! - pts.xyz[i]!)).toBeLessThan(1e-5);
    // two held roots (a dual weapon) accumulate
    const off = new Mesh(new BoxGeometry(0.06, 0.5, 0.02), new MeshBasicMaterial());
    off.position.set(0.4, 1.0, 0.1);
    hero.add(off);
    const dual = toPreviewPoints(heldPoints([blade, off], pivot, 1))!;
    expect(dual.s.length).toBe(48);
    expect(dual.reach).toBeCloseTo(pts.reach, 5);
    expect(toPreviewPoints({ xyz: [], s: [] })).toBeNull();
    // the framing of this union: the blade held up needs more room above, nothing is cut, the hero keeps over half the frame
    const f = framePreview(1.8, only, pts, FOV, ARMORY);
    expect(f.cut).toBe(0);
    expect(f.heroShare).toBeGreaterThanOrEqual(HERO_MIN);
    const m = frameMeasure(f, only, pts, 0.3, FOV, ARMORY);
    expect(m.weapon!.y1).toBeLessThanOrEqual(0.95 + 1e-3);
  });
});
