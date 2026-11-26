// barbarian: bestial brute - hunched, huge-forearmed, fur kilt, rib-cage bone armour, horned bone cap, studded war club in the right hand.
// Shared by the bestial soldier / maniac / archer / specialist (+ the maniac boss): the game tints and scales it, so there are no variant props.
import type { ClipSpec } from '../../../core/anim/clip.ts';
import { clamp01, smoothstep } from '../../../core/math.ts';
import { custom, strands } from '../../../core/paint/layers.ts';
import { type PaintVertex, type Rgb, mixRgb, rgb } from '../../../core/paint/painter.ts';
import type { Skeleton } from '../../../core/skin/skeleton.ts';
import { type Anatomy, type HumanoidParams, type PieceSpec, computeAnatomy } from '../../../archetypes/humanoid/index.ts';
import { addClub } from '../../../archetypes/brute/barbarian-club.ts';
import { barbarianClips, speedsFor } from '../../../archetypes/brute/barbarian-clips.ts';
import {
  FUR_TAGS, addBeardAndMane, addBeastBody, addBonePauldrons, addBoneHelm, addBootCuffs, addFistSpikes, addFurKilt, addFurMantle, addFurPelt, addKneeGuards, addRibArmor, addSpikedBracers, addWarPaint,
} from '../../../archetypes/brute/barbarian-pieces.ts';
import { handRef, hp } from '../../../archetypes/humans/kit.ts';
import type { HumanModel, HumanRig } from '../../../archetypes/humans/rigx.ts';
import { BARB_FACE, BARB_PALETTE, BARB_SKIN } from './look.ts';

/** hook pieces of the current build (material + paint tag), recorded in afterOutfit for the paint hook */
const PIECES: { mat: string; tag: string }[] = [];

export function barbarianParams(): HumanoidParams {
  const outfit: PieceSpec[] = [
    { id: 'boots', mat: 'leather2', o: { start: 0.42, trim: 'none' } },
    { id: 'vambrace', mat: 'cloth', o: { from: 0.42, flare: 0.5, trim: 'none' } },
  ];
  const p: HumanoidParams = {
    id: 'barbarian', kind: 'creature', seed: 'barbarian', sex: 'm', bodyHeight: 1.82,
    build: {
      shoulder: 1.42, chest: 1.22, waist: 1.0, hips: 1.04, arms: 1.4, forearms: 1.75, legs: 1.2, calves: 1.3, neck: 1.4, hands: 1.9, feet: 1.35, head: 0.95,
      legLength: 0.88, armLength: 1.12, muscle: 1.25, lean: 0.36, headForward: 0.07, stance: 1.55, armSpread: 0.4,
    },
    face: BARB_FACE,
    skin: BARB_SKIN, hair: { style: 'none', color: '#2b1f16' },
    outfit, palette: BARB_PALETTE, style: 'none',
    rig: { skirt: true, capeBones: 2 },
    tris: 4960, voxel: 0.0078, texture: 512, liteHands: true,
    hooks: {
      afterBody: (ctx) => {
        addBeastBody(ctx);
      },
      afterOutfit: (ctx) => {
        addFurKilt(ctx);
        addRibArmor(ctx);
        addFurPelt(ctx);
        addFurMantle(ctx);
        addBonePauldrons(ctx);
        addSpikedBracers(ctx);
        addFistSpikes(ctx);
        addBootCuffs(ctx);
        addKneeGuards(ctx);
        addBoneHelm(ctx);
        addBeardAndMane(ctx);
        addClub(ctx, ctx.a);
        addWarPaint(ctx);
        PIECES.length = 0;
        for (const q of ctx.extraPieces) PIECES.push({ mat: q.mat, tag: `p${q.i}` });
      },
      paint: (paint, a) => {
        const regionMax = (tags: string[], soft: number): ((v: PaintVertex) => number) => {
          const cache = new WeakMap<PaintVertex, number>();
          return (v) => {
            let m = cache.get(v);
            if (m === undefined) {
              m = 0;
              for (const t of tags) m = Math.max(m, v.region(t, soft));
              cache.set(v, m);
            }
            return m;
          };
        };
        // fur strands, masked to the pelt pieces only
        const furMask = regionMax([...FUR_TAGS], 0.006);
        paint.albedo.push(
          strands({ flow: () => [0, -1, -0.15], freq: 130, stretch: 9, amount: 0.3, octaves: 2, mask: furMask }),
          strands({ flow: () => [0, -1, -0.15], freq: 380, stretch: 12, amount: 0.6, octaves: 1, tint: rgb('#b08f62'), mask: (v) => 0.5 * furMask(v) }),
        );
        // clean, clearly separated looks for bone / leather / iron: one flat family colour + faint staining, dark crevices, worn bright edges
        const k = a.s * a.hs, tipY0 = a.skull[1] + 0.14 * k, tipY1 = a.skull[1] + 0.26 * k;
        for (const mat of ['leather', 'leather2', 'leather3', 'bone', 'plate'] as const) {
          const tags = PIECES.filter((q) => q.mat === mat).map((q) => q.tag);
          if (!tags.length) continue;
          const mask = regionMax(tags, 0.004);
          const base = rgb(BARB_PALETTE[mat]);
          const amp = mat === 'bone' ? 0.07 : 0.1;
          const crevCol: Rgb = mat === 'bone' ? rgb('#5b4a36') : mixRgb(base, [0, 0, 0], 0.55);
          const hi = rgb(BARB_PALETTE.plateHi);
          paint.albedo.push(custom(`barb:${mat}`, (v) => {
            const m = mask(v);
            if (m <= 0) return;
            const n = v.noise.fbm(v.p[0] * 22, v.p[1] * 22, v.p[2] * 22, { octaves: 2 });
            let c: Rgb = [base[0] * (1 + amp * n), base[1] * (1 + amp * n), base[2] * (1 + amp * n)];
            c = mixRgb(c, crevCol, clamp01(-v.cavity * 1.6) * 0.6);
            if (mat === 'plate') c = mixRgb(c, hi, clamp01(v.cavity * 1.2) * 0.5);
            if (mat === 'bone') {
              const tip = v.region('hornTip', 0.004);
              if (tip > 0) c = mixRgb(c, rgb('#3d2f25'), smoothstep(tipY0, tipY1, v.p[1]) * tip);
            }
            v.color = mixRgb(v.color, c, m);
          }));
        }
        return paint;
      },
      clips: (clips: ClipSpec[], a: Anatomy, sk: Skeleton) => barbarianClips(clips, a, sk),
    },
  };
  // authored ground speeds (run = 3.0 m/s) from the real body scale (legLength != 1 shifts it away from bodyHeight / 1.76)
  p.speed = speedsFor(computeAnatomy(p));
  return p;
}

/** triangle budget: spend it on the face, the fists, the rib armour and the club head */
function barbarianRig(a: Anatomy): HumanRig {
  const s = a.s;
  const h = handRef(a, 'r');
  return {
    tweak: (def) => {
      def.mesh.focus = [
        { c: a.skull, r: 0.3 * s, gain: 3.8 },
        { c: a.side(1).palm, r: 0.15 * s, gain: 1.7 },
        { c: a.side(-1).palm, r: 0.15 * s, gain: 1.7 },
        { c: [0, a.chest[1] - 0.02 * s, a.chest[2] + 0.1 * s], r: 0.24 * s, gain: 1.5 },
        { c: hp(h, 0, 0, 0.82 * s), r: 0.17 * s, gain: 1.6 },
      ];
    },
  };
}

export const barbarian: HumanModel = { params: barbarianParams, rig: barbarianRig };
