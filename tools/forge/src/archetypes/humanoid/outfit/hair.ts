// Hair styles: a scalp cap (offset of the cranium above the hairline) plus clumps / chains per style. Hair is piece 0
// (painted first, outfit pieces such as helms and hoods paint over it).
import { type Vec3, vadd } from '../../../core/math.ts';
import { Rng } from '../../../core/rng.ts';
import { Ellipsoid, RoundCone, Sphere, Torus } from '../../../core/sdf/primitives.ts';
import { flatCone, tube, tubeSegments } from '../../../core/sdf/shapes.ts';
import type { Ctx } from '../kit/ctx.ts';
import type { HairParams, Side } from '../params.ts';
import type { Sdf } from '../../../core/sdf/node.ts';
import { type PieceEnv, boxClip, cover, makeEnv } from './util.ts';

const BOTH = [1, -1] as Side[];
const L = (sx: Side): 'l' | 'r' => (sx === 1 ? 'l' : 'r');

export function buildHair(ctx: Ctx, h: HairParams): void {
  if (h.style === 'none') return;
  const e = makeEnv(ctx, { id: `hair_${h.style}`, mat: 'hair' }, 0, 'hair');
  const a = ctx.a;
  const k = a.s * a.hs;
  const sk = a.skull;
  const vol = h.volume ?? 1;
  const len = h.length ?? 1;
  const rng = new Rng(`${a.p.seed}/hair`);
  const hairTag = (...x: string[]): string[] => e.tag('hair', ...x);
  const chain = a.layout.hair;
  const boneAt = (i: number): string => (chain ? chain.bones[Math.min(i, chain.bones.length - 1)]! : 'head');

  // ---- scalp cap
  const capExt = (h.style === 'wolf' ? 0.012 : 0.01) * k * vol;
  const frontLine = h.style === 'swept' || h.style === 'spiky' ? 0.06 : 0.05;
  const cap = (e2: PieceEnv, name: string, clipBox: Sdf): void => cover(e2, ['cranium'], capExt, { clip: clipBox, name, w: 0.006, extra: [] });
  if (h.style !== 'wolf') {
    cap(e, '_top', boxClip([sk[0], sk[1] + (frontLine + 0.15) * k, sk[2]], [0.3 * k, 0.15 * k, 0.3 * k]));
    cap(e, '_back', boxClip([sk[0], sk[1] - 0.02 * k, sk[2] - 0.15 * k], [0.3 * k, 0.1 * k, 0.12 * k]));
    // temple locks
    for (const sx of BOTH) {
      e.ctx.add(`hair_temple_${L(sx)}`, new RoundCone([sx * 0.08 * k, sk[1] + 0.04 * k, sk[2] + 0.03 * k], [sx * 0.088 * k, sk[1] - 0.045 * k, sk[2] + 0.018 * k], 0.011 * k * vol, 0.006 * k), 'head', { tags: hairTag(), w: 0.006 });
    }
  }
  const fringe = (): void => {
    for (let i = 0; i < 6; i++) {
      const t = (i / 5 - 0.5) * 2;
      const b: Vec3 = [t * 0.065 * k, sk[1] + 0.085 * k, sk[2] + 0.075 * k * (1 - 0.3 * Math.abs(t))];
      const tip: Vec3 = [t * 0.07 * k + rng.range(-0.01, 0.01) * k, sk[1] + (0.04 - 0.01 * Math.abs(t)) * k, sk[2] + 0.1 * k * (1 - 0.35 * Math.abs(t)) + 0.01 * k];
      e.ctx.add(`hair_fringe${i}`, new RoundCone(b, tip, 0.013 * k * vol, 0.003 * k), 'head', { tags: hairTag(), w: 0.008 });
    }
  };

  switch (h.style) {
    case 'short': {
      fringe();
      break;
    }
    case 'topknot': {
      fringe();
      const kb: Vec3 = [0, sk[1] + 0.1 * k, sk[2] - 0.035 * k];
      e.ctx.add('hair_knot', new Ellipsoid(vadd(kb, [0, 0.03 * k, -0.01 * k]), [0.03 * k * vol, 0.036 * k * vol, 0.028 * k * vol]), 'head', { tags: hairTag(), w: 0.01 });
      e.ctx.add('hair_knotTail', new RoundCone(vadd(kb, [0, 0.03 * k, -0.01 * k]), vadd(kb, [0, 0.085 * k * len, -0.045 * k * len]), 0.017 * k, 0.003 * k), 'head', { tags: hairTag(), w: 0.008 });
      e.ctx.add('hair_knotBand', new Torus(vadd(kb, [0, 0.0, 0.0]), 0.03 * k, 0.0065 * k, [0, 1, 0.3]), 'head', { tags: e.tag(e.s('tie', 'cloth2')), w: 0.003 });
      // back locks
      for (let i = 0; i < 3; i++) {
        const x = (i - 1) * 0.04 * k;
        e.ctx.add(`hair_back${i}`, new RoundCone([x, sk[1] + 0.0, sk[2] - 0.098 * k], [x * 1.2, sk[1] - 0.12 * k * len, sk[2] - 0.095 * k], 0.02 * k * vol, 0.005 * k), 'head', { tags: hairTag(), w: 0.01 });
      }
      break;
    }
    case 'ponytail':
    case 'braid': {
      fringe();
      const pts = chain ? chain.pts : [[0, sk[1] + 0.02 * k, sk[2] - 0.085 * k], [0, sk[1] - 0.14 * k, sk[2] - 0.13 * k]] as Vec3[];
      const r0 = (h.style === 'braid' ? 0.026 : 0.034) * k * vol;
      const segs = tubeSegments(pts, [[0, r0], [0.4, r0 * 0.95], [0.8, r0 * 0.6], [1, 0.006 * k]], { segments: Math.max(3, (chain?.bones.length ?? 1) * 2) });
      segs.forEach((sg, i) => e.ctx.add(`hair_pony${i}`, sg.sdf, boneAt(Math.floor((i / segs.length) * (chain?.bones.length ?? 1))), { tags: hairTag(), w: 0.012 * k }));
      e.ctx.add('hair_tie', new Torus(pts[0]!, 0.034 * k, 0.0075 * k, [0, 0.4, 1]), 'head', { tags: e.tag(e.s('tie', 'cloth2')), w: 0.003 });
      if (h.style === 'braid') {
        // plait ridges
        segs.forEach((sg, i) => e.ctx.add(`hair_plait${i}`, new Ellipsoid(sg.b, [0.016 * k, 0.013 * k, 0.016 * k]), boneAt(Math.floor((i / segs.length) * (chain?.bones.length ?? 1))), { tags: hairTag(), w: 0.004 }));
      }
      break;
    }
    case 'long':
    case 'swept': {
      if (h.style === 'long') fringe();
      const swept = h.style === 'swept';
      const pts = chain ? chain.pts : ([[0, sk[1] + 0.02 * k, sk[2] - 0.085 * k], [0, sk[1] - 0.2 * k, sk[2] - 0.13 * k], [0, sk[1] - 0.34 * k, sk[2] - 0.15 * k]] as Vec3[]);
      const nb = chain?.bones.length ?? 1;
      for (let strand = -2; strand <= 2; strand++) {
        const spread = strand * 0.034 * k * vol;
        const p2: Vec3[] = pts.map((p, i) => [p[0] + spread * (1 + i * 0.25), p[1] - Math.abs(strand) * 0.01 * k * i * len + (len - 1) * -0.05 * i, p[2] - Math.abs(strand) * 0.006 * k]);
        const r0 = (0.03 - Math.abs(strand) * 0.004) * k * vol;
        const segs = tubeSegments(p2, [[0, r0], [0.5, r0 * 0.85], [1, 0.006 * k]], { segments: Math.max(3, nb * 2) });
        segs.forEach((sg, i) => e.ctx.add(`hair_s${strand}_${i}`, sg.sdf, boneAt(Math.floor((i / segs.length) * nb)), { tags: hairTag(), w: 0.012 * k }));
      }
      if (swept) {
        // wild swept-back mane tufts over the crown
        for (let i = 0; i < 7; i++) {
          const t = (i / 6 - 0.5) * 2;
          const b: Vec3 = [t * 0.07 * k, sk[1] + 0.095 * k, sk[2] + 0.055 * k];
          e.ctx.add(`hair_sweep${i}`, new RoundCone(b, [t * 0.09 * k, sk[1] + 0.11 * k + 0.02 * k * (1 - Math.abs(t)), sk[2] - 0.13 * k * len], 0.017 * k * vol, 0.004 * k), 'head', { tags: hairTag(), w: 0.01 });
        }
      } else {
        // front locks over the shoulders
        for (const sx of BOTH) e.ctx.add(`hair_lock_${L(sx)}`, tube([[sx * 0.075 * k, sk[1] + 0.0, sk[2] + 0.04 * k], [sx * 0.095 * k, sk[1] - 0.13 * k, sk[2] + 0.04 * k], [sx * 0.1 * k, a.neck[1] - 0.12 * a.s, a.neck[2] + 0.07 * a.s]], [[0, 0.011 * k], [1, 0.005 * k]], { segments: 3, w: 0.006 }), 'head', { tags: hairTag(), w: 0.008 });
      }
      break;
    }
    case 'spiky': {
      fringe();
      for (let i = 0; i < 11; i++) {
        const ang = (i / 11) * Math.PI * 2;
        const rr = rng.range(0.55, 1);
        const b: Vec3 = [Math.sin(ang) * 0.06 * k * rr, sk[1] + 0.08 * k + 0.02 * k * rr, sk[2] - 0.01 * k + Math.cos(ang) * 0.06 * k * rr];
        const tip: Vec3 = [Math.sin(ang) * 0.12 * k * rr, sk[1] + (0.17 + 0.07 * rng.next()) * k * len, sk[2] - 0.05 * k + Math.cos(ang) * 0.1 * k * rr - 0.03 * k];
        e.ctx.add(`hair_spike${i}`, new RoundCone(b, tip, 0.021 * k * vol, 0.003 * k), 'head', { tags: hairTag(), w: 0.01 });
      }
      break;
    }
    case 'bun': {
      fringe();
      e.ctx.add('hair_bun', new Sphere([0, sk[1] + 0.105 * k, sk[2] - 0.04 * k], 0.046 * k * vol), 'head', { tags: hairTag(), w: 0.012 });
      e.ctx.add('hair_bunBase', new Torus([0, sk[1] + 0.085 * k, sk[2] - 0.035 * k], 0.04 * k, 0.008 * k, [0, 1, 0.3]), 'head', { tags: e.tag(e.s('tie', 'gold')), w: 0.003 });
      e.ctx.add('hair_pin', new RoundCone([-0.07 * k, sk[1] + 0.105 * k, sk[2] - 0.04 * k], [0.07 * k, sk[1] + 0.112 * k, sk[2] - 0.04 * k], 0.0045 * k, 0.0045 * k), 'head', { tags: e.tag('gold'), w: 0.002 });
      break;
    }
    case 'wolf': {
      // lupine head: fur ruff around cheeks and neck, a crest of long hair down the nape and back
      for (let i = 0; i < 16; i++) {
        const ang = (i / 16) * Math.PI * 2;
        const b: Vec3 = [Math.sin(ang) * 0.08 * k, sk[1] - 0.075 * k, sk[2] - 0.0 * k + Math.cos(ang) * 0.075 * k];
        const tip: Vec3 = [Math.sin(ang) * 0.125 * k, sk[1] - 0.14 * k * rng.range(0.9, 1.3), sk[2] + Math.cos(ang) * 0.1 * k - 0.01 * k];
        e.ctx.add(`hair_ruff${i}`, new RoundCone(b, tip, 0.024 * k * vol, 0.004 * k), 'head', { tags: hairTag('fur'), w: 0.012 });
      }
      for (let i = 0; i < 7; i++) {
        const y = a.neck[1] + 0.06 * a.s - i * 0.05 * a.s;
        const z = a.spineZ(y) - (0.09 + 0.01 * i) * a.s;
        e.ctx.add(`hair_crest${i}`, flatCone([0, y, z], [0, y - 0.09 * a.s * len, z - 0.045 * a.s], 0.03 * a.s * vol, 0.01 * a.s, 0.4, [1, 0, 0]), i < 2 ? 'neck' : 'chest', { tags: hairTag('fur'), w: 0.012 });
      }
      for (const sx of BOTH) {
        e.ctx.add(`hair_brow_${L(sx)}`, new RoundCone([sx * 0.015 * k, sk[1] + 0.045 * k, sk[2] + 0.085 * k], [sx * 0.07 * k, sk[1] + 0.06 * k, sk[2] + 0.04 * k], 0.012 * k, 0.008 * k), 'head', { tags: hairTag('fur'), w: 0.008 });
      }
      break;
    }
    default:
      break;
  }
}
