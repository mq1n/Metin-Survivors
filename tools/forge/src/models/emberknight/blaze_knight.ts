// blaze_knight (Blaze Knight): bright crimson lacquer plate, gunmetal iron accents, gold trim and charcoal obsidian skin whose only glow
// is at the elbows / knees, the visor eyes and the chest core; kabuto demon helm with a flame-blade fan, big flared pauldrons, clawed
// sabatons and a polished-steel sabre with a hot cutting edge and two forked flames off the spine. Crowd elite: <= 5k tris, <= 32 joints, ~3 m.
// EK_MATID=1 (dev only) bakes a material-ID map instead of the albedo (3-bit RGB classes, see MATID) for the post-paint value grade.
import { type Vec3, smoothstep, vsub } from '../../core/math.ts';
import { custom } from '../../core/paint/layers.ts';
import { type PaintVertex, type Rgb, mixRgb, rgb } from '../../core/paint/painter.ts';
import { type EmberSpec } from '../../archetypes/emberknight/index.ts';
import { emberHelm } from '../../archetypes/emberknight/armor.ts';
import { armouredFist, handRef } from '../../archetypes/emberknight/hand.ts';
import { type BuiltSword, type SwordSpec, addFlameSword } from '../../archetypes/emberknight/sword.ts';
import { HEAD_GROUP, SPIKE_GROUP, SWORD_GROUP } from '../../archetypes/emberknight/groups.ts';
import { authoredSpeeds, knightClips, knightKit } from '../../archetypes/emberknight/clips.ts';
import { crackAt, crackEmissive, glowRegion, heatColor } from '../../archetypes/ember/glow.ts';
import { coreRecess, legSpikes, shoulderCrags, toeClaws } from '../../archetypes/ember/parts.ts';
import { demonHead } from '../../archetypes/ember/head.ts';
import { type HumanoidParams, type PieceSpec, computeAnatomy } from '../../archetypes/humanoid/index.ts';

export const KNIGHT_SWORD: SwordSpec = {
  length: 0.98, halfW: 0.056, halfT: 0.017,
  width: [[0, 0.8], [0.08, 1], [0.6, 0.94], [0.84, 0.74], [0.95, 0.36], [1, 0.02]],
  bow: 0.05,
  gripBack: 0.1, gripFront: 0.09, guard: 0.21, guardCurl: 0.35,
  flames: 2, flameSize: 1.3,
  flameSide: 'spine', tipFlame: false, edgeSide: 'cutting', lavaFuller: false, edgeBand: 0.007,
};

/** material classes of the EK_MATID bake (3-bit RGB) */
type MatClass = 'skin' | 'crimson' | 'leather' | 'iron' | 'gold' | 'cloth' | 'steel' | 'glow';
export const MATID: Record<MatClass, Rgb> = {
  skin: [0, 0, 0], crimson: [1, 0, 0], leather: [0, 1, 0], iron: [0, 0, 1], gold: [1, 1, 0], cloth: [1, 0, 1], steel: [0, 1, 1], glow: [1, 1, 1],
};
const MAT_CLASS: Record<string, MatClass> = { plate: 'crimson', plate2: 'iron', gold: 'gold', sash: 'cloth', metal: 'steel', leather: 'leather', flame: 'glow', core: 'glow' };

export function blazeKnight(): EmberSpec {
  // inner to outer; piece k gets paint tags p<k+1> / t<k+1>. Value bands top to bottom: crimson helm, iron collar, crimson
  // pauldrons + cuirass, dark cloth, iron tassets, crimson cuisses, iron greaves / sabatons
  const outfit: PieceSpec[] = [
    { id: 'sash', mat: 'sash', o: { tails: 2, tail: 0.5, trim: 'none' } },
    { id: 'greaves', mat: 'plate', o: { cop: 1.4, copSpike: 1.0, trim: 'gold' } },
    { id: 'boots', mat: 'plate2', o: { start: 0.42, trim: 'gold' } },
    { id: 'cuisse', mat: 'plate', o: { from: 0.1, to: 0.5, trim: 'gold' } },
    { id: 'cuirass', mat: 'plate', o: { style: 'plate', bands: 2, emblem: 0.9, emblemMat: 'gold', pec: 0.012, trim: 'gold' } },
    { id: 'tassets', mat: 'plate2', o: { count: 9, len: 0.27, rows: 2, flare: 0.45, trim: 'gold' } },
    { id: 'vambrace', mat: 'plate', o: { flare: 1.1, from: 0.3, trim: 'gold' } },
    { id: 'pauldron', mat: 'plate', o: { lames: 4, size: 1.5, spike: 0, trim: 'gold' } },
    { id: 'backpiece', mat: 'plate2', o: { size: 1.15, spikes: 3, spikeMat: 'gold', trim: 'gold' } },
    { id: 'collar', mat: 'plate2', o: { height: 0.09, flare: 0.04, trim: 'gold' } },
    { id: 'helm', mat: 'plate', build: emberHelm, o: { crest: 5, crestSize: 1.0, horns: 1.25, trim: 'gold' } },
  ];
  const base: HumanoidParams = {
    id: 'blaze_knight', kind: 'creature', seed: 'blaze_knight', sex: 'm', bodyHeight: 2.45,
    build: { shoulder: 1.4, chest: 1.3, waist: 1.06, hips: 1.12, arms: 1.32, forearms: 1.4, legs: 1.35, calves: 1.35, neck: 1.1, hands: 1.55, feet: 1.45, head: 1.1, legLength: 1.0, armLength: 1.12, muscle: 1.0, lean: 0.08, headForward: 0.03, stance: 1.3, armSpread: 0.4 },
    face: { jaw: 1, brow: 1, nose: 0.2, lips: 0.2, eyes: 0.7, cheeks: 0.8, slant: 0.4, ears: 0.1 },
    skin: { base: '#2a2124', shade: '#110c0e', lip: '#ff6a14', eye: '#ffb020', brow: '#0d090a', mark: '#ff7a1a' },
    hair: { style: 'none', color: '#1a1214' },
    outfit,
    palette: { sash: '#3a1618', plate: '#b42a1c', plate2: '#3b3b45', plateHi: '#e0643a', gold: '#d8a443', lava: '#ff6a18', flame: '#ff7a18', core: '#ffb830', metal: '#8c919c', leather: '#2a1b16', obsidian: '#1f181c' },
    style: 'sword1h',
    rig: { skirt: true },
    mesh: { voxel: 0.0085, tris: 2950 }, texture: 1024, liteHands: true,
  };
  const anat = computeAnatomy(base);
  base.mesh = {
    ...base.mesh,
    focus: [
      { c: anat.skull, r: 0.3 * anat.s, gain: 3.2 },
      { c: anat.side(-1).palm, r: 0.2 * anat.s, gain: 2.0 },
      { c: anat.side(1).palm, r: 0.14 * anat.s, gain: 1.6 },
    ],
  };
  const kit = knightKit(anat.s);
  base.speed = authoredSpeeds(anat, kit);
  const t = { flame: '', core: '' };
  /** every paint piece (outfit + hook-reserved) in creation order: tag, trim tag, material key */
  const pieces: { tag: string; trimTag: string; mat: string; trim: boolean }[] = [];
  let swordInfo: BuiltSword | undefined;
  base.hooks = {
    head: (ctx) => {
      demonHead({ brow: 1.1, jaw: 1.0, tusk: 0.8, gape: 1.1, ears: 0 })(ctx);
    },
    afterOutfit: (ctx) => {
      const a = ctx.a;
      const metal = ctx.piece('metal'), gold = ctx.piece('gold'), leather = ctx.piece('leather'), flame = ctx.piece('flame'), core = ctx.piece('core');
      t.flame = flame.tag;
      t.core = core.tag;
      const plate = ctx.piece('plate2');
      armouredFist(ctx, a, handRef(a, 'r'), 'fistR', [plate.tag], 1.0);
      armouredFist(ctx, a, handRef(a, 'l'), 'fistL', [plate.tag], 1.0);
      swordInfo = addFlameSword(ctx, a, KNIGHT_SWORD, { steel: metal, trim: gold, leather, flame, core, lava: 'swLava', hotEdge: 'swEdge' });
      shoulderCrags(ctx, { tag: plate.tag, tip: 'hotTip' }, { size: 1.4, count: 3 });
      legSpikes(ctx, { tag: gold.tag }, 0.9);
      toeClaws(ctx, { tag: gold.tag }, 1.6);
      coreRecess(ctx, core.tag, { size: 1 });
      outfit.forEach((p, k) => pieces.push({ tag: `p${k + 1}`, trimTag: `t${k + 1}`, mat: p.mat ?? '', trim: p.o?.trim !== 'none' }));
      for (const x of ctx.extraPieces) pieces.push({ tag: `p${x.i}`, trimTag: `t${x.i}`, mat: x.mat, trim: true });
    },
    paint: (p, a) => {
      const sw = swordInfo!;
      const k = a.s * a.hs;
      const flameTags = pieces.filter((x) => x.mat === 'flame').map((x) => x.tag);
      const faceFree = (v: PaintVertex): number => (1 - v.region('eye', 0.01)) * (1 - v.region('lipline', 0.012)) * (1 - v.region('head', 0.01));
      const plateM = (v: PaintVertex): number => {
        let m = 0;
        for (const x of pieces) if (x.mat !== 'sash') m = Math.max(m, v.region(x.tag, 0.004));
        return m;
      };
      // charcoal skin: glowing seams only where it shows at the elbows and knees (rest-pose joint distance)
      const JOINTS = [1, -1].flatMap((sx) => [a.side(sx as 1 | -1).elbow, a.side(sx as 1 | -1).knee]);
      const jointM = (v: PaintVertex): number => Math.max(...JOINTS.map((j) => 1 - smoothstep(0.07 * a.s, 0.13 * a.s, Math.hypot(v.p[0] - j[0], v.p[1] - j[1], v.p[2] - j[2]))));
      const seams = { freq: 7.5, width: 0.075, warp: 0.3, mask: (v: PaintVertex) => v.region('skin', 0.006) * (1 - plateM(v)) * faceFree(v) * jointM(v) };
      if (process.env.EK_MATID === '1') {
        p.albedo = [custom('matid', (v) => {
          let c: MatClass = 'skin';
          for (const x of pieces) {
            if (v.region(x.tag, 0.003) > 0.5) c = MAT_CLASS[x.mat] ?? 'iron';
            if (x.trim && v.region(x.trimTag, 0.002) > 0.5) c = 'gold';
          }
          if (v.region('horn', 0.003) > 0.5) c = 'gold';
          if (v.region('tusk', 0.003) > 0.5) c = 'steel';
          for (const g of ['eye', 'lipline', 'swEdge', 'hotTip']) if (v.region(g, 0.002) > 0.5) c = 'glow';
          if (c === 'skin' && crackAt(v, seams).c > 0.35) c = 'glow';
          v.color = [...MATID[c]];
        })];
        return p;
      }
      // flames: yellow core, orange body, deep red rim and licking tips (a white / evenly lit flame reads as a candle or a wedge)
      const flameHeat = (v: PaintVertex): number => 0.8 - 0.45 * smoothstep(a.skull[1] + 0.13 * k, a.skull[1] + 0.45 * k, v.p[1]);
      const crest = flameTags.filter((x) => x !== t.flame).map((tag) => glowRegion(tag, { heat: flameHeat, soft: 0.004, gain: 1.0 }));
      const segD = (p: Vec3, s0: Vec3, s1: Vec3): [number, number] => {
        const d = vsub(s1, s0), q = vsub(p, s0);
        const u = Math.min(1, Math.max(0, (q[0] * d[0] + q[1] * d[1] + q[2] * d[2]) / Math.max(1e-9, d[0] * d[0] + d[1] * d[1] + d[2] * d[2])));
        return [Math.hypot(q[0] - d[0] * u, q[1] - d[1] * u, q[2] - d[2] * u), u];
      };
      const tongueHeat = (v: PaintVertex): number => {
        let best = 0;
        for (const f of sw.flames) {
          for (const [s0, s1, k0, k1] of [[f.a, f.b, 0, 0.5], [f.b, f.c, 0.5, 1]] as const) {
            const [d, u] = segD(v.p, s0, s1);
            const s = k0 + (k1 - k0) * u;
            const rel = d / Math.max(1e-4, f.w * (1 - 0.85 * s));
            best = Math.max(best, 0.88 - 0.5 * smoothstep(0.15, 0.95, rel) - 0.3 * smoothstep(0.45, 1, s));
          }
        }
        return best;
      };
      const eye = glowRegion('eye', { heat: 0.9, soft: 0.002, gain: 2.4 });
      const mouth = glowRegion('lipline', { heat: 0.7, soft: 0.004, gain: 1.0 });
      const core = glowRegion(t.core, { heat: 0.7, soft: 0.005, gain: 2.0 });
      const fl = glowRegion(t.flame, { heat: tongueHeat, soft: 0.004, gain: 1.3 });
      const edge = glowRegion('swEdge', { heat: 0.85, soft: 0.003, gain: 2.0 });
      const tip = glowRegion('hotTip', { heat: 0.7, soft: 0.006, gain: 0.9 });
      const ivory = custom('ivory', (v) => {
        const m = v.region('tusk', 0.003);
        if (m > 0) v.color = mixRgb(v.color, rgb('#e6dcc2'), 0.95 * m);
      });
      const faceDark = custom('faceDark', (v) => {
        const m = v.region('head', 0.01) * (1 - v.region('eye', 0.01)) * (1 - v.region('lipline', 0.012)) * (1 - v.region('tusk', 0.004));
        if (m > 0) v.color = mixRgb(v.color, mixRgb(rgb('#1c1417'), rgb('#4a2018'), 0.35 * v.region('cheek', 0.03)), 0.85 * m);
      });
      // seam albedo: dull ember in the joint cracks only (crackAlbedo would repaint every plate with crust)
      const seamA = custom('seamA', (v) => {
        const c = crackAt(v, seams).c;
        if (c > 0) v.color = mixRgb(v.color, heatColor(0.25 + 0.3 * c), Math.min(1, c * 1.5));
      });
      p.albedo.push(
        seamA,
        faceDark, ivory, eye.albedo, mouth.albedo, core.albedo, fl.albedo, edge.albedo, tip.albedo, ...crest.map((c) => c.albedo),
      );
      p.emissive = [crackEmissive({ ...seams, gain: 0.9, bleed: 0.08 }), eye.emissive, mouth.emissive, core.emissive, fl.emissive, edge.emissive, tip.emissive, ...crest.map((c) => c.emissive)];
      return p;
    },
    clips: (_c, a, sk) => knightClips(a.s, kit)(a, sk),
  };
  // the broad straight sabre needs a finer voxel + more triangles than the shared group or its long edges decimate into a saw
  return { hp: base, lite: true, radius: 0.65, groups: [{ ...SWORD_GROUP, voxel: 0.0038, tris: 1050 }, HEAD_GROUP, SPIKE_GROUP] };
}
