// executioner: masked executioner / inquisitor (humanoid_large). Hulking bare-armed brute in a leather apron, stitched hood and a
// huge notched cleaver baked into the right fist.
import { type HumanoidParams, computeAnatomy } from '../../../archetypes/humanoid/index.ts';
import type { HumanModel } from '../../../archetypes/humans/rigx.ts';
import { handRef, hp } from '../../../archetypes/humans/kit.ts';
import { CLEAVER } from '../../../archetypes/brute/executioner-cleaver.ts';
import { buildExecAnim, execSpeeds } from '../../../archetypes/brute/executioner-anim.ts';
import { warPaint } from '../../../archetypes/brute/executioner-pieces.ts';
import { EXEC_BUILD, EXEC_FACE, EXEC_PALETTE, EXEC_SKIN, addExecCleaver, execOutfit } from './look.ts';
import { execPaint } from './paint.ts';

const BODY_HEIGHT = 2.25;

export function executionerParams(): HumanoidParams {
  const p: HumanoidParams = {
    id: 'executioner', kind: 'creature', seed: 'executioner', sex: 'm', bodyHeight: BODY_HEIGHT,
    build: EXEC_BUILD, face: EXEC_FACE, skin: EXEC_SKIN, hair: { style: 'none', color: '#1c1612' },
    outfit: execOutfit(), palette: EXEC_PALETTE, style: 'club',
    rig: { skirt: true, hairBones: 2 },
    tris: 4850, voxel: 0.008, texture: 1024, liteHands: true,
    hooks: {
      afterOutfit: (ctx) => {
        addExecCleaver(ctx, ctx.a);
        warPaint(ctx, ctx.a);
      },
      paint: execPaint,
      // the whole clip set is authored on the humans anim kit (world-space cleaver arcs)
      clips: (_clips, a, sk) => buildExecAnim(a, sk).clips,
    },
  };
  const a = computeAnatomy(p);
  const s = a.s;
  const h = handRef(a, 'r');
  return {
    ...p,
    // extras.speed = the ground speed the authored gaits cover at this body's true scale
    speed: execSpeeds(s),
    // triangle budget: the hood face, both fists, the bandolier and the cleaver blade carry the read
    mesh: {
      focus: [
        { c: a.skull, r: 0.3 * s, gain: 5.2 },
        { c: a.side(1).palm, r: 0.15 * s, gain: 1.6 },
        { c: a.side(-1).palm, r: 0.15 * s, gain: 1.7 },
        { c: [0, a.chest[1] - 0.02 * s, a.chest[2] + 0.1 * s], r: 0.24 * s, gain: 1.4 },
        { c: hp(h, 0, 0, (CLEAVER.rootZ + CLEAVER.len * 0.5) * s), r: 0.5 * s, gain: 1.3 },
      ],
    },
  };
}

export const executioner: HumanModel = { params: executionerParams };
