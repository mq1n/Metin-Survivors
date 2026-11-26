// pyre_king (zone boss, 12:00): a crowned lava colossus. Crimson-lacquer / black-iron / gold plate over a dark under-suit, huge spiked
// pauldrons, a gold crown with a flame plume, a throne-shard cape, a sun-disc belt and a baked-in two-handed flamberge greatsword.
// Boss budgets: <= 15k tris, <= 48 joints (lite rig + skirt + cape 3 + hair 2 = 35), height ~3.5 m, radius 1.5.
import { custom } from '../../core/paint/layers.ts';
import { type PaintVertex, type Rgb, mixRgb, rgb } from '../../core/paint/painter.ts';
import { type EmberSpec, type MeshGroup } from '../../archetypes/emberknight/index.ts';
import { emberCrown } from '../../archetypes/emberknight/crown.ts';
import { armouredFist, handRef } from '../../archetypes/emberknight/hand.ts';
import { type BuiltSword, type SwordSpec, addFlameSword } from '../../archetypes/emberknight/sword.ts';
import { SPIKE_GROUP } from '../../archetypes/emberknight/groups.ts';
import { authoredSpeeds } from '../../archetypes/emberknight/clips.ts';
import { kingClips, kingKit } from '../../archetypes/emberknight/kingclips.ts';
import { flamePlume, kingGuard, sunDisc, throneCape } from '../../archetypes/emberknight/kingparts.ts';
import { flameHeat, glowRegion } from '../../archetypes/ember/glow.ts';
import { coreRecess, legSpikes, shoulderCrags, toeClaws } from '../../archetypes/ember/parts.ts';
import { demonHead } from '../../archetypes/ember/head.ts';
import { type HumanoidParams, type PieceSpec, computeAnatomy } from '../../archetypes/humanoid/index.ts';

export const KING_SWORD: SwordSpec = {
  length: 1.0, halfW: 0.09, halfT: 0.02,
  width: [[0, 0.9], [0.06, 1], [0.6, 0.94], [0.82, 0.74], [0.94, 0.38], [1, 0.03]],
  wave: { amp: 0.1, cycles: 4, skew: 0.6 },
  gripBack: 0.08, gripFront: 0.27, guard: 0.14,
  flames: 0, flameSize: 1, pommel: 1.5,
};

const KING_GROUPS: MeshGroup[] = [
  { match: /^sw_/, voxel: 0.006, tris: 1500 },
  { match: /^(crown_(prong|spike|gem|bezel)|plume_)/, voxel: 0.006, tris: 1500 },
  { match: new RegExp(`${SPIKE_GROUP.match.source.replace('^(', '^(sun_ray|')}`), voxel: 0.007, tris: 1000 },
  { match: /^throne/, voxel: 0.008, tris: 1100 },
];

export function pyreKing(): EmberSpec {
  // inner to outer; piece k gets paint tags p<k+1> / t<k+1>
  const outfit: PieceSpec[] = [
    { id: 'belt', mat: 'plate2', o: { y: -0.025, buckleMat: 'gold', trim: 'gold' } },
    { id: 'greaves', mat: 'plate', o: { cop: 1.6, copSpike: 1.2, trim: 'gold' } },
    { id: 'boots', mat: 'plate2', o: { start: 0.42, trim: 'gold' } },
    { id: 'cuisse', mat: 'plate2', o: { from: 0.1, to: 0.5, trim: 'gold' } },
    { id: 'cuirass', mat: 'plate', o: { style: 'plate', bands: 2, emblem: 1.0, emblemMat: 'gold', pec: 0.014, trim: 'gold' } },
    { id: 'tassets', mat: 'plate', o: { count: 11, len: 0.42, rows: 2, flare: 0.6, trim: 'gold' } },
    { id: 'vambrace', mat: 'plate2', o: { flare: 1.2, from: 0.3, trim: 'gold' } },
    { id: 'pauldron', mat: 'plate', o: { lames: 5, size: 1.9, spike: 0.9, trim: 'gold' } },
    { id: 'collar', mat: 'plate2', o: { height: 0.1, flare: 0.05, trim: 'gold' } },
    { id: 'cape', mat: 'cloth', o: { width: 0.18, trim: 'gold' } },
    { id: 'crown', mat: 'gold', build: emberCrown, o: { prongs: 7, tall: 1, trim: 'none' } },
  ];
  const base: HumanoidParams = {
    id: 'pyre_king', kind: 'boss', seed: 'pyre_king', sex: 'm', bodyHeight: 2.92,
    build: { shoulder: 1.5, chest: 1.42, waist: 1.1, hips: 1.15, arms: 1.42, forearms: 1.48, legs: 1.3, calves: 1.25, neck: 1.25, hands: 1.5, feet: 1.4, head: 0.95, legLength: 1.0, armLength: 1.1, muscle: 1.15, lean: 0.1, headForward: 0.04, stance: 1.35, armSpread: 0.45 },
    face: { jaw: 1.1, brow: 1.1, nose: 0.2, lips: 0.2, eyes: 0.7, cheeks: 0.9, slant: 0.5, ears: 0.1 },
    skin: { base: '#2a1a16', shade: '#120a08', lip: '#ff7a1a', eye: '#ffc030', brow: '#0d0807', mark: '#ff7a1a' },
    hair: { style: 'none', color: '#1a1214' },
    outfit,
    palette: { plate: '#a02414', plate2: '#1a1517', plateHi: '#a08a80', gold: '#d8a640', cloth: '#6a1410', lava: '#ff6a18', flame: '#ff7a18', core: '#ffb830', metal: '#3a3438', leather: '#2a1b16', obsidian: '#1c1619' },
    style: 'sword2h',
    rig: { skirt: true, capeBones: 3, hairBones: 2 },
    mesh: { voxel: 0.011, tris: 8800 }, texture: 1024, liteHands: true,
  };
  const anat = computeAnatomy(base);
  base.mesh = {
    ...base.mesh,
    focus: [
      { c: anat.skull, r: 0.3 * anat.s, gain: 3.0 },
      { c: anat.side(-1).palm, r: 0.2 * anat.s, gain: 1.8 },
      { c: anat.side(1).palm, r: 0.2 * anat.s, gain: 1.8 },
    ],
  };
  const kit = kingKit(anat.s);
  base.speed = authoredSpeeds(anat, kit);
  const t = { flame: '', core: '', obs: '', props: [] as string[], donors: [] as [string, string][] };
  let swordInfo: BuiltSword | undefined;
  base.hooks = {
    head: (ctx) => {
      demonHead({ brow: 1.15, jaw: 1.1, tusk: 0.9, gape: 1.0, ears: 0 })(ctx);
    },
    afterOutfit: (ctx) => {
      const a = ctx.a;
      const metal = ctx.piece('metal'), gold = ctx.piece('gold'), leather = ctx.piece('leather'), flame = ctx.piece('flame'), core = ctx.piece('core'), obs = ctx.piece('obsidian');
      t.flame = flame.tag;
      t.core = core.tag;
      t.obs = obs.tag;
      const plate = ctx.piece('plate2');
      t.props = [metal.tag, gold.tag, leather.tag, flame.tag, core.tag, obs.tag, plate.tag];
      t.donors = [[metal.tag, 'metal'], [gold.tag, 'gold'], [leather.tag, 'leather'], [obs.tag, 'obsidian'], [plate.tag, 'plate2']];
      armouredFist(ctx, a, handRef(a, 'r'), 'fistR', [plate.tag], 1.0);
      armouredFist(ctx, a, handRef(a, 'l'), 'fistL', [plate.tag], 1.0);
      swordInfo = addFlameSword(ctx, a, KING_SWORD, { steel: metal, trim: gold, leather, flame, core, lava: 'swLava', hotEdge: 'swEdge' });
      kingGuard(ctx, a, swordInfo, { gold: gold.tag, core: core.tag });
      shoulderCrags(ctx, { tag: obs.tag, tip: 'hotTip' }, { size: 1.15, count: 3 });
      legSpikes(ctx, { tag: gold.tag }, 0.9);
      toeClaws(ctx, { tag: gold.tag }, 1.1);
      coreRecess(ctx, core.tag, { size: 1.15 });
      flamePlume(ctx, flame.tag, { size: 0.8 });
      throneCape(ctx, { tag: obs.tag, tip: 'hotTip', tipFrac: 0.22 }, { size: 1 });
      sunDisc(ctx, gold.tag, core.tag, { y: -0.025, size: 1 });
    },
    paint: (p, a) => {
      const sw = swordInfo!;
      // trims stay unlit gold (glowing trims read as lava marble on the plates); the sword edge runs hotter toward the tip
      const eye = glowRegion('eye', { heat: 0.9, soft: 0.002, gain: 1.6 });
      const mouth = glowRegion('lipline', { heat: 0.75, soft: 0.004, gain: 1.1 });
      const core = glowRegion(t.core, { heat: 0.7, soft: 0.005, gain: 1.2 });
      const plume = glowRegion(t.flame, { heat: flameHeat(a.skull[1] + 0.05 * a.s, a.H + 0.25 * a.s, 0.22, 0.66), soft: 0.004, gain: 0.85 });
      const lava = glowRegion('swLava', { heat: 0.62, soft: 0.003, gain: 0.85 });
      const edge = glowRegion('swEdge', { heat: (v: PaintVertex) => 0.45 + 0.27 * Math.min(1, Math.max(0, sw.blade.d(v.p[0], v.p[1], v.p[2]) / 0.2)), soft: 0.003, gain: 0.7 });
      const tip = glowRegion('hotTip', { heat: 0.7, soft: 0.006, gain: 0.9 });
      const faceFree = (v: PaintVertex): number => (1 - 0.9 * v.region('eye', 0.01)) * (1 - 0.95 * v.region('lipline', 0.012)) * (1 - 0.8 * v.region('head', 0.01));
      const covered = [...outfit.map((_, i) => `p${i + 1}`), ...t.props];
      // No molten skin: the body only shows in slivers between the plates and pokes through the thin shells after remeshing, where
      // crust + glowing veins read as black lava patches on the armour. Skin within 3.5 cm of a piece takes that piece's colour,
      // the rest a dark under-suit.
      const pal = base.palette;
      const under = rgb('#221816');
      const donors: [string, Rgb][] = [...outfit.map((o, i): [string, Rgb] => [`p${i + 1}`, rgb(pal[o.mat as keyof typeof pal]!)]), ...t.donors.map(([tag, k]): [string, Rgb] => [tag, rgb(pal[k]!)])];
      const underSuit = custom('underSuit', (v) => {
        let m = v.region('skin', 0.006) * faceFree(v);
        if (m <= 0) return;
        for (const c of covered) m *= 1 - v.region(c, 0.004);
        if (m <= 0) return;
        let best = 0, col = under;
        for (const [tag, c] of donors) {
          const r = v.region(tag, 0.035);
          if (r > best) { best = r; col = c; }
        }
        v.color = mixRgb(v.color, mixRgb(under, col, best), m);
      });
      const faceDark = custom('faceDark', (v) => {
        const m = v.region('head', 0.01) * (1 - v.region('eye', 0.01)) * (1 - v.region('lipline', 0.012)) * (1 - v.region('tusk', 0.004));
        if (m > 0) v.color = mixRgb(v.color, mixRgb(rgb('#1e1412'), rgb('#7a2a12'), 0.5 * v.region('cheek', 0.03)), 0.88 * m);
      });
      const ivory = custom('ivory', (v) => {
        const m = v.region('tusk', 0.003);
        if (m > 0) v.color = mixRgb(v.color, rgb('#e6d8b8'), 0.95 * m);
      });
      p.albedo.push(underSuit, faceDark, ivory, eye.albedo, mouth.albedo, core.albedo, plume.albedo, lava.albedo, edge.albedo, tip.albedo);
      p.emissive = [eye.emissive, mouth.emissive, core.emissive, plume.emissive, lava.emissive, edge.emissive, tip.emissive];
      return p;
    },
    clips: (_c, a, sk) => kingClips(a.s, kit)(a, sk),
  };
  return { hp: base, lite: true, radius: 1.5, groups: KING_GROUPS };
}
