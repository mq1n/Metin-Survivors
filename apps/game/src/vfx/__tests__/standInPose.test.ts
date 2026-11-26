// Pose sampling and socket writing for stand-in VFX replays (spec/sockets.ts).
import { describe, expect, it } from 'vitest';
import { SET_FLOATS, SOCKET_ID, SOCKET_STRIDE, STAND_IN, qrot, quatYaw, samplePose, standInSockets } from '../spec/sockets';
import type { StandInPose } from '../spec/types';

const S = SOCKET_STRIDE;
const at = (s: Float32Array, name: keyof typeof SOCKET_ID, k = 0): number => s[SOCKET_ID[name] * S + k] as number;

/** 3 frames at 10 fps: the left hand rises 1 m → 2 m → 2 m, the head sits at 1.6 m, the weapon is held upright */
function pose(extra: Partial<StandInPose> = {}): StandInPose {
  const R = Math.SQRT1_2; // 90 deg about +X
  return {
    fps: 10,
    n: 3,
    dur: 0.2,
    sockets: {
      hand_l: [0.1, 1, 0.3, 0, 0, 0, 1, 0.1, 1.5, 0.3, 0, 0, 0, 1, 0.1, 2, 0.3, R, 0, 0, R],
      head: [0, 1.6, 0, 0, 0, 0, 1, 0, 1.6, 0, 0, 0, 0, 1, 0, 1.6, 0, 0, 0, 0, 1],
      weapon: [0, 2.4, 0.5, 0, 0, 0, 1, /* */ 0, 2.4, 0.5, 0, 0, 0, 1, /* */ 0, 2.4, 0.5, R, 0, 0, R],
    },
    bladeLen: 1,
    ...extra,
  };
}

describe('samplePose', () => {
  it('interpolates linearly, holds the first and last frame', () => {
    const out = new Float32Array(3);
    const tr = [0, 0, 0, 2, 4, 6, 4, 8, 12];
    samplePose(tr, 3, 3, 10, 0.05, out);
    expect([...out]).toEqual([1, 2, 3]);
    samplePose(tr, 3, 3, 10, -1, out);
    expect([...out]).toEqual([0, 0, 0]);
    samplePose(tr, 3, 3, 10, 9, out);
    expect([...out]).toEqual([4, 8, 12]);
  });

  it('quaternions take the shortest arc and stay unit length', () => {
    const out = new Float32Array(7);
    // the same rotation written with opposite signs: the midpoint must not collapse to zero
    samplePose([0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, -1], 7, 2, 1, 0.5, out);
    expect(Math.hypot(out[3] as number, out[4] as number, out[5] as number, out[6] as number)).toBeCloseTo(1, 6);
    expect(Math.abs(out[6] as number)).toBeCloseTo(1, 6);
  });
});

describe('standInSockets with a replayed pose', () => {
  it('writes the tracked sockets from the pose (caster yaw applied), the others keep the fixed stand-in offsets', () => {
    const s = new Float32Array(SET_FLOATS);
    // facing +X (yaw π/2), standing at (5, 0, 3): local +Z (forward) → world +X, local −X (right) → world +Z
    standInSockets(s, 0, 5, 0, 3, Math.PI / 2, 0.1, 1, undefined, pose());
    expect(at(s, 'hand_l', 0)).toBeCloseTo(5 + 0.3, 5); // 0.3 m forward
    expect(at(s, 'hand_l', 1)).toBeCloseTo(1.5, 5); // mid-frame height
    expect(at(s, 'hand_l', 2)).toBeCloseTo(3 - 0.1, 5); // 0.1 m to the caster's left (+X local) = world −Z
    expect(at(s, 'head', 1)).toBeCloseTo(1.6, 5);
    // `chest` has no track: it keeps its fixed stand-in offset
    expect(at(s, 'chest', 1)).toBeCloseTo(STAND_IN.chest[1], 5);
    expect(at(s, 'chest', 0)).toBeCloseTo(5 + STAND_IN.chest[2], 5);
  });

  it('is the raised hand of the pose, not the hip-height hand of the old stand-in', () => {
    const fixed = new Float32Array(SET_FLOATS), posed = new Float32Array(SET_FLOATS);
    standInSockets(fixed, 0, 0, 0, 0, 0, 0.2, 1);
    standInSockets(posed, 0, 0, 0, 0, 0, 0.2, 1, undefined, pose());
    expect(at(fixed, 'hand_l', 1)).toBeCloseTo(STAND_IN.hand_l[1], 5); // 1.05 m
    expect(at(posed, 'hand_l', 1)).toBeCloseTo(2, 5); // above the 1.6 m head
    expect(at(posed, 'hand_l', 1)).toBeGreaterThan(at(posed, 'head', 1));
  });

  it('weapon: blade length of the pose and the full bone quaternion (yaw × bone); hand / head sockets are yaw-only by default', () => {
    const s = new Float32Array(SET_FLOATS);
    const yaw = Math.PI / 2;
    standInSockets(s, 0, 0, 0, 0, yaw, 0.2, 1, undefined, pose());
    expect(at(s, 'weapon', 3)).toBeCloseTo(1, 6);
    const wo = SOCKET_ID.weapon * S + 4;
    // bone = 90 deg about +X (blade axis +Y → the bone's +Z), then the caster yaw π/2 (+Z → world +X): the blade points along the caster's forward axis
    const axis = [0, 0, 0];
    qrot(s, wo, 0, 1, 0, axis, 0);
    expect(axis[0]).toBeCloseTo(1, 5);
    expect(axis[1]).toBeCloseTo(0, 5);
    expect(axis[2]).toBeCloseTo(0, 5);
    // hand_l's last-frame bone is rotated, but the default socket keeps only the caster yaw (like the player sockets the game feeds)
    expect(quatYaw(s, SOCKET_ID.hand_l * S + 4)).toBeCloseTo(yaw, 5);
    expect(at(s, 'hand_l', 5)).toBeCloseTo(Math.sin(yaw / 2), 5);
    expect(at(s, 'hand_l', 4)).toBeCloseTo(0, 5);
    // orient 'bone' writes the track's own rotation everywhere
    const b = new Float32Array(SET_FLOATS);
    standInSockets(b, 0, 0, 0, 0, yaw, 0.2, 1, undefined, pose({ orient: 'bone' }));
    expect(Math.abs(at(b, 'hand_l', 4))).toBeGreaterThan(0.3);
  });

  it('t is clip time: the last frame holds after the clip, the first before it', () => {
    const s = new Float32Array(SET_FLOATS);
    standInSockets(s, 0, 0, 0, 0, 0, 99, 1, undefined, pose());
    expect(at(s, 'hand_l', 1)).toBeCloseTo(2, 5);
    standInSockets(s, 0, 0, 0, 0, 0, -3, 1, undefined, pose());
    expect(at(s, 'hand_l', 1)).toBeCloseTo(1, 5);
  });
});
