// Glacier golem (roster ice_golem, 3.0 m): stacked glacier slabs with a glowing blue core; also the Glacier Golem boss (instance scale 1-2.1x).
// Gaits are authored for ~0.8 m legs: walk ~0.8 m/s, run ~2.5 m/s (enemy chase speed 2.4: the game scales playback by speed / authored).
import type { GolemParams } from '../../archetypes/golem/index.ts';

export const iceGolem = (): GolemParams => ({
  id: 'ice_golem',
  kind: 'creature',
  seed: 'ice_golem',
  variant: 'ice',
  voxel: 0.01,
  style: {
    H: 3.0,
    walk: { T: 0.9, duty: 0.62, sweep: 0.55, lift: 0.12, stomp: 0.05, bob: 0.01, sway: 0.03, lean: 0.05, twist: 0.18, roll: 0.2, pelvisRoll: 0.05, armSwing: 0.14, armLag: 0.07 },
    run: { T: 0.66, duty: 0.42, sweep: 0.86, lift: 0.22, stomp: 0.08, bob: 0.03, sway: 0.04, lean: 0.2, twist: 0.26, roll: 0.3, pelvisRoll: 0.07, armSwing: 0.24, armLag: 0.05, run: true },
    slam: { x: 0.78, y: 0.45, z: 0.78, drop: 0.3, pitch: 0.7 },
    crouch: 0.05,
    hunch: 0.05,
    carry: { x: 0.04, y: 0.15, z: 0.1 },
    attack: { dur: 1.8, hit: 0.72 },
    attack2: { dur: 1.5, hit: 0.6 },
    special1: { dur: 2.4, hit: 1.1 },
    death: 2.7,
    spawn: 2.3,
    hit: 0.6,
  },
});
