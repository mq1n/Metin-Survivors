// conjurer: tall thin summoner-priest - tiered lacquered crown with side lappets, layered long robes (inner robe + loose coat + capelet),
// armillary ritual staff, and three tilted rings of floating authored paper talisman strips (extra rig bones tal_a / tal_b / tal_c).
// Casts with the staff: the rings spin up, draw in, burst forward at the release and settle.
import { monkHead } from '../../archetypes/esoteric/head.ts';
import { type EsoParams, firstOfEach } from '../../archetypes/esoteric/index.ts';
import { monkPaint } from '../../archetypes/esoteric/paint.ts';
import { waistSash } from '../../archetypes/esoteric/pieces.ts';
import { evoStaff } from '../../archetypes/esoteric/conjurer_staff.ts';
import { buildCrowdAuthored } from '../../archetypes/esoteric/conjurer_build.ts';
import { addRobeFolds, evoApron, evoCoat, evoCollar, evoHat, evoUnder } from '../../archetypes/esoteric/conjurer_pieces.ts';
import { type EvoRing, poseEvoRings, ringBoneSpecs } from '../../archetypes/esoteric/conjurer_rig.ts';
import { addStrip, newAuthored, ringStrips, stripPaint } from '../../archetypes/esoteric/conjurer_strips.ts';
import { EVO_CAST_DUR, EVO_CAST_HIT, evoStyle } from '../../archetypes/esoteric/conjurer_style.ts';
import { type Vec3, vadd, vdist, vnorm, vscale, vsub } from '../../core/math.ts';
import { custom } from '../../core/paint/layers.ts';
import { mixRgb, rgb } from '../../core/paint/painter.ts';
import type { HeroDef } from '../../archetypes/humanoid/index.ts';
import { type ClothSpec, addCloth, idleFrames, toRest } from '../../archetypes/esoteric/conjurer_cloth.ts';
import type { Anatomy } from '../../archetypes/humanoid/index.ts';
import { RUN, WALK, gaitSpeed, orcClips } from '../../archetypes/orc/anim.ts';
import { weaponFrame } from '../../archetypes/orc/kit.ts';
import { propTags } from '../../archetypes/orc/props.ts';

/**
 * three tilted rings (7 strips): a low wide ring round the robe skirt and two armillary rings tipped steeply forward, so their front arcs
 * pass low over the hips and their back arcs rise behind the shoulders and the crown: the paper never crosses the face or the chest.
 * Opposite orbit directions and different tilts so the paper never lines up.
 */
const RINGS: EvoRing[] = [
  { bone: 'tal_a', y: 0.79, R: 0.6, count: 3, phase: 0.35, lean: 0.12, yaw: 0.45, hu: 0.072, hv: 0.2, twist: 0.2, bow: 0.03, tilt: 0.22, az: 0.3, dir: 1, idleTurns: 1 / 3, wob: 0.05, ph: 0, bob: 0.025 },
  { bone: 'tal_b', y: 1.07, R: 0.58, count: 2, phase: 2.1, lean: 0.22, yaw: 0.45, hu: 0.066, hv: 0.18, twist: -0.18, bow: 0.025, tilt: 0.6, az: 0.45, dir: -1, idleTurns: 1 / 2, wob: 0.05, ph: 2.1, bob: 0.02, throw: 0.35 },
  { bone: 'tal_c', y: 1.26, R: 0.48, count: 2, phase: 1.72, lean: 0.3, yaw: 0.4, hu: 0.058, hv: 0.16, twist: 0.18, bow: 0.02, tilt: 0.9, az: 0.15, dir: 1, idleTurns: 1 / 2, wob: 0.04, ph: 4.2, bob: 0.02, throw: 0.2 },
];

/** the orbiting strips (rest pose, independent of the anatomy: the ring heights above are absolute) */
const STRIPS = ringStrips(RINGS);

/**
 * Sleeve drapes: hanging cloth pouches under each forearm, authored in the IDLE pose (they hang vertically from a forearm that points
 * forward). Two panels per arm (outer + inner side) spreading apart toward the hem.
 */
function drapesFor(def: HeroDef, a: Anatomy): ClothSpec[] {
  const sk = def.skeleton;
  const fr = idleFrames(sk, def.clips);
  const K = a.s / 0.8899;
  const out: ClothSpec[] = [];
  for (const sx of [1, -1] as const) {
    const n = sx === 1 ? 'l' : 'r';
    const bone = `forearm_${n}`;
    const E = fr.pos[sk.idx(bone)]!, W = fr.pos[sk.idx(`wrist_${n}`)]!;
    const len = vdist(E, W);
    const d = vnorm(vsub(W, E));
    // the right hand holds the staff: its drape stops short of the fist
    const end = sx === 1 ? 1.1 : 0.78;
    const cols = 6;
    const rail: Vec3[] = [], depth: number[] = [];
    for (let i = 0; i < cols; i++) {
      const s = i / (cols - 1);
      rail.push(vadd(vadd(E, vscale(d, len * (0.12 + (end - 0.12) * s))), [0, -0.035 * K, 0]));
      depth.push((0.04 + 0.2 * s ** 1.25) * K);
    }
    const rest = toRest(sk, fr, bone);
    for (const side of [1, -1] as const) {
      out.push({ bone, rail, hang: [0, -1, 0], depth, outward: [sx * side, 0, 0], spread: 0.07 * K, ripple: 0.012 * K, folds: 1.5, phase: side, t: 0.016 * K, toRest: rest });
    }
  }
  return out;
}

export function conjurer(): EsoParams {
  return {
    lite: true,
    radius: 0.3,
    minComponentTris: 24,
    dropBones: ['toe_l', 'toe_r'],
    extraBones: () => ringBoneSpecs(RINGS),
    extraPose: (clip, c) => {
      poseEvoRings(RINGS, clip, c, { hit: EVO_CAST_HIT, dur: EVO_CAST_DUR });
      // the staff is rigid on the right wrist: a slow sway about the grip while standing
      if (clip === 'idle') c.add('wrist_r', 0.035 * Math.sin(Math.PI * 2 * c.u), 0, 0.03 * Math.sin(Math.PI * 2 * c.u + 1.2));
    },
    crowd: (def, log, a) => {
      const g = evoStyle().gait ?? {};
      def.extras = { ...(def.extras ?? {}), speed: { walk: Number((gaitSpeed({ ...WALK, ...g.walk }) * a.s).toFixed(3)), run: Number((gaitSpeed({ ...RUN, ...g.run }) * a.s).toFixed(3)) } };
      // triangle density: the hands (the staff grip and the seal), the face and the staff orb (a round jewel, not a hexagon) matter most;
      // the long robe is nearly flat
      const wf = weaponFrame(a, 'r');
      def.mesh.focus = [
        { c: a.skull, r: 0.26 * a.s, gain: 2.8 },
        { c: a.side(1).palm, r: 0.17 * a.s, gain: 4.5 },
        { c: a.side(-1).palm, r: 0.17 * a.s, gain: 4.5 },
        { c: wf.p(0, 1.32 * wf.s, 0), r: 0.07 * a.s, gain: 4 },
      ];
      const authored = newAuthored();
      for (const s of STRIPS) addStrip(authored, s);
      const drape = newAuthored('drape');
      for (const c of drapesFor(def, a)) addCloth(drape, c);
      const coat = rgb('#e8e0d0'), shade = rgb('#b8ae98');
      return buildCrowdAuthored(def, [authored, drape], log, 1.5, (g) => ({
        albedo: [custom('drapePaint', (v) => {
          if (g.get('drape')!(v.p) > 0.006) return;
          const n = v.noise.fbm(v.p[0] * 30, v.p[1] * 30, v.p[2] * 30, { octaves: 2 });
          v.color = mixRgb(coat, shade, Math.min(1, Math.max(0, 0.3 + n * 0.8)));
        })],
      }));
    },
    hp: {
      id: 'conjurer', kind: 'creature', seed: 'conjurer', sex: 'm', bodyHeight: 1.564,
      build: { shoulder: 0.86, chest: 0.82, waist: 0.78, hips: 0.84, arms: 0.84, forearms: 0.86, legs: 0.84, calves: 0.84, neck: 0.9, hands: 1.15, feet: 1.0, head: 1.06, legLength: 1.1, armLength: 1.04, muscle: 0.15, lean: 0.05, headForward: 0.0, stance: 0.9, armSpread: 0.3 },
      skin: { base: '#d8c0a4', shade: '#9a7a62', lip: '#8a5a52', eye: '#d8c890', brow: '#2a2018', mark: '#5a2a22' },
      hair: { style: 'none', color: '#1c1814', highlight: '#3a342e' },
      // the orb glow stays below full white-hot so the lit, painted sphere keeps its shading (a flat emissive disc reads as unlit)
      glow: { color: '#c8501e', tags: ['glow'] },
      outfit: [
        { id: 'boots', mat: 'leather3', o: { start: 0.99, toeUp: 0.7 } },
        { id: 'evoUnder', mat: 'cloth2', build: evoUnder, o: {} },
        { id: 'evoCoat', mat: 'cloth', build: evoCoat, o: { hem: 0.17, lift: 0.12, open: 0.085, flare: 1.04 } },
        { id: 'waistSash', mat: 'sash', build: waistSash, o: { width: 0.04, tail: 0.5, trim: 'none' } },
        { id: 'evoApron', mat: 'cloth3', build: evoApron, o: {} },
        { id: 'evoCollar', mat: 'cloth4', build: evoCollar, o: {} },
        { id: 'evoHat', mat: 'lacquer', build: evoHat, o: {} },
      ],
      palette: { leather: '#5a4632', leather2: '#6a4a30', leather3: '#3a3238', plate: '#8a8478', cloth: '#e8e0d0', cloth2: '#8f87a8', cloth3: '#a85048', cloth4: '#4a4468', sash: '#a83a3a', bone: '#e8e2cc', gold: '#c8a850', paper: '#ece4cc', ink: '#8a2420', lacquer: '#2a2430', trim: '#c8a850', rune: '#ff7a3a', hair: '#1c1814' },
      style: 'staff',
      rig: { skirt: true },
      mesh: { voxel: 0.008, tris: 4400 }, texture: 1024, liteHands: false,
      hooks: {
        head: monkHead({ brow: 0.9, jaw: 0.85, cheeks: 0.9, gaunt: 0.5, nose: 1.0, mouth: 'set', eyes: 1.0, slant: 0.2, goatee: 1.2 }),
        paint: (paint, a) => {
          const base = monkPaint({ hollow: 0.7 })(paint, a);
          const sp = stripPaint(STRIPS, { paper: '#f7f0de', paperShade: '#d8cba8', ink: '#a8241c', glow: '#ff6a30' });
          return { ...base, albedo: [...base.albedo, sp.albedo], emissive: [...(base.emissive ?? []), sp.emissive] };
        },
        afterOutfit: (ctx) => {
          addRobeFolds(ctx, ctx.a, { flare: 1.04 });
          const t = propTags(ctx, { metal: 'gold', haft: 'leather2', wrap: 'leather', cloth: 'sash', glow: 'rune' });
          evoStaff(ctx, weaponFrame(ctx.a, 'r'), t);
        },
        clips: (_c, a, sk) => firstOfEach(orcClips(a, sk, evoStyle())),
      },
    },
  };
}

export type { Vec3 };
