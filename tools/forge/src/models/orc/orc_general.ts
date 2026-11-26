// orc_general: armoured war-chief - spiked plate, horned helm, a narrow war banner on his back, curved sabre; tight trousers under thigh plates.
import type { PieceEnv } from '../../archetypes/humanoid/index.ts';
import { orcBody } from '../../archetypes/orc/body.ts';
import { orcHead } from '../../archetypes/orc/head.ts';
import type { OrcParams } from '../../archetypes/orc/index.ts';
import { spike, weaponFrame } from '../../archetypes/orc/kit.ts';
import { orcPaint } from '../../archetypes/orc/paint.ts';
import { backBanner, backPole, hornedHelm, spikeCollar, torsoPoint, trophies } from '../../archetypes/orc/pieces.ts';
import { propTags, scimitar } from '../../archetypes/orc/props.ts';
import { slashStyle } from '../../archetypes/orc/styles.ts';
import { type Vec3, vadd, vnorm, vscale } from '../../core/math.ts';

/** spiked plate: three swept spikes fanning from each pauldron crown, studs on the breastplate, spikes on the elbow cops */
function plateSpikes(e: PieceEnv): void {
  const { a } = e;
  const s = a.s;
  const T = { tags: e.tag(e.mat), w: 0.006, grip: 1.5 };
  for (const sx of [1, -1] as const) {
    const n = sx === 1 ? 'l' : 'r';
    const j = a.side(sx);
    const crown = vadd(j.shoulder, vscale(vnorm([sx * 0.62, 0.78, -0.02]), 0.13 * s));
    const fan: [Vec3, number, number][] = [
      [vnorm([sx * 0.5, 0.86, -0.1]), 0.3, 0.034], // main: up and a little out
      [vnorm([sx * 1.0, 0.3, -0.08]), 0.25, 0.03], // outer: sideways
      [vnorm([sx * 0.3, 0.55, -0.78]), 0.2, 0.028], // rear: up and back
    ];
    fan.forEach(([d, len, r], i) => {
      e.ctx.add(`${e.spec.id}_sh${i}_${n}`, spike(crown, vadd(crown, vscale(d, len * s)), r * s, 0.01 * s), `clavicle_${n}`, T);
    });
    // elbow spike, swept back and out
    const el = j.elbow;
    const b: Vec3 = vadd(el, [sx * 0.05 * s, -0.01 * s, -0.03 * s]);
    e.ctx.add(`${e.spec.id}_el_${n}`, spike(b, vadd(b, [sx * 0.07 * s, 0.02 * s, -0.11 * s]), 0.026 * s, 0.01 * s), `forearm_${n}`, T);
  }
  // breastplate studs: two rows either side of the sternum ridge
  for (const u of [-0.5, 0.5]) {
    for (const [dy, len] of [[0.07, 0.06], [-0.03, 0.055], [-0.13, 0.05]] as const) {
      const p = torsoPoint(a, a.chest[1] + dy * s, u, 0.03 * s);
      e.ctx.add(`${e.spec.id}_stud${u}_${dy}`, spike(p, vadd(p, [u * 0.02 * s, 0.012 * s, len * s]), 0.02 * s, 0.008 * s), 'chest', T);
    }
  }
}

export function orcGeneral(): OrcParams {
  return {
    lite: true,
    style: slashStyle(),
    focus: { head: 3.6, headR: 0.32 },
    hp: {
      id: 'orc_general', kind: 'creature', seed: 'orc_general', sex: 'm', bodyHeight: 2.05,
      build: { shoulder: 1.3, chest: 1.25, waist: 1.0, hips: 1.05, arms: 1.3, forearms: 1.3, legs: 1.12, calves: 1.08, neck: 1.2, hands: 1.45, feet: 1.35, head: 1.0, legLength: 0.98, armLength: 1.1, muscle: 1.2, lean: 0.2, headForward: 0.04, stance: 1.2, armSpread: 0.36 },
      skin: { base: '#5f7a4c', shade: '#34482c', lip: '#6e3a38', eye: '#ff9a30', brow: '#1e2a18', mark: '#2a1e1a' },
      hair: { style: 'none', color: '#1c1a18', highlight: '#3a3632' },
      glow: { color: '#ff9a30', tags: ['glow'] },
      outfit: [
        { id: 'trousers', mat: 'cloth2', o: { baggy: 0.0, end: 0.96, trim: 'none' } },
        { id: 'boots', mat: 'leather', o: { start: 0.45, trim: 'none' } },
        { id: 'greaves', mat: 'plate', o: { ext: 0.017, cop: 0.9, copSpike: 0.8, spikeMat: 'plate', trim: 'none' } },
        { id: 'tassets', mat: 'plate', o: { len: 0.19, count: 8, flare: 0.35, trim: 'none' } },
        { id: 'cuirass', mat: 'plate', o: { ext: 0.021, emblem: 1, emblemMat: 'gold', trim: 'none' } },
        { id: 'belt', mat: 'leather', o: { trim: 'none' } },
        { id: 'pauldron', mat: 'plate', o: { spike: 0, lames: 1, size: 1.3, trim: 'none' } },
        { id: 'vambrace', mat: 'plate', o: { cop: true, trim: 'none' } },
        { id: 'spikeCollar', mat: 'plate', build: spikeCollar, o: { trim: 'none' } },
        { id: 'plateSpikes', mat: 'plate', build: plateSpikes, o: { trim: 'none' } },
        { id: 'trophies', mat: 'bone', build: trophies, o: { trim: 'none', neck: false } },
        { id: 'hornedHelm', mat: 'plate', build: hornedHelm, o: { trim: 'none', horn: 1.15 } },
        { id: 'backPole', mat: 'leather2', build: backPole, o: { trim: 'none', h: 0.26, bar: 0.13, r: 0.02 } },
        { id: 'backBanner', mat: 'cloth', build: backBanner, o: { trim: 'none', h: 0.26, bar: 0.13, len: 0.36, spread: -0.1, fork: 0.1 } },
      ],
      palette: { cloth: '#b8282a', cloth2: '#2c2630', leather: '#4a3222', leather2: '#5a4030', plate: '#7d8590', plateHi: '#c9d0d8', bone: '#e2d8bc', gold: '#d8a83a' },
      style: 'club',
      rig: { skirt: true, capeBones: 2 },
      mesh: { voxel: 0.008, tris: 4900 }, texture: 512, liteHands: true,
      hooks: {
        head: orcHead({ brow: 1.0, jaw: 1.0, tusk: 1.05, ears: 0.9, droop: 0.3, glow: true, scar: true }),
        afterBody: orcBody({ hump: 0.7, claws: 1.0, toeClaws: 0.8, neckMass: 1 }),
        afterOutfit: (ctx) => {
          const t = propTags(ctx, { metal: 'plate', haft: 'leather2', wrap: 'cloth', bone: 'bone', cloth: 'cloth' });
          scimitar(ctx, weaponFrame(ctx.a, 'r'), t, { size: 1.0 });
        },
        paint: orcPaint({ back: '#3a5028' }),
      },
    },
  };
}
