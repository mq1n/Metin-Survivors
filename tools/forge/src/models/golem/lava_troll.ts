// Magma golem (roster lava_troll, 2.8 m): basalt plates with lava seams; ember troll / beard / general (and the Ember General boss) share it
// and differ by instance scale (0.9-2.2x) and tint. Gaits are authored for 1.0 m legs: walk ~1.0 m/s, run ~2.8 m/s (enemy chase speed 2.81).
import type { GolemParams } from '../../archetypes/golem/index.ts';

export const lavaTroll = (): GolemParams => ({
  id: 'lava_troll',
  kind: 'creature',
  seed: 'lava_troll',
  variant: 'fire',
  voxel: 0.01,
  style: {
    H: 2.8,
    walk: { T: 0.85, duty: 0.62, sweep: 0.55, lift: 0.12, stomp: 0.05, bob: 0.01, sway: 0.03, lean: 0.04, twist: 0.2, roll: 0.22, pelvisRoll: 0.05, armSwing: 0.16, armLag: 0.07 },
    run: { T: 0.62, duty: 0.42, sweep: 0.72, lift: 0.22, stomp: 0.07, bob: 0.03, sway: 0.04, lean: 0.18, twist: 0.28, roll: 0.32, pelvisRoll: 0.07, armSwing: 0.26, armLag: 0.05, run: true },
    slam: { x: 0.7, y: 0.32, z: 0.72, drop: 0.26, pitch: 0.65 },
    crouch: 0.04,
    hunch: 0.03,
    carry: { x: 0, y: 0, z: 0 },
    attack: { dur: 1.6, hit: 0.66 },
    attack2: { dur: 1.4, hit: 0.56 },
    special1: { dur: 2.6, hit: 1.32 },
    death: 2.5,
    spawn: 2.2,
    hit: 0.55,
  },
});
