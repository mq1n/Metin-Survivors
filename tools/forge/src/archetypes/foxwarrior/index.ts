// Fox-warrior archetype: a bipedal humanoid fox (Miho boss) built ON the humanoid archetype (import-only, nothing in
// archetypes/humanoid is modified). Adds: nine fanned, bushy tails on 2-bone chains `tailF<m>_1/_2` (30 + 18 = 48 joints), spirit-fire
// tips (emissive via the humanoid `glow` hook), tail animation layered over every humanoid clip, and boss clips special1..3.
import type { ClipSpec, PoseCtx } from '../../core/anim/clip.ts';
import { type Vec3, vadd, vlerp, vnorm, vscale, vsub } from '../../core/math.ts';
import { Ellipsoid, RoundCone } from '../../core/sdf/primitives.ts';
import type { ModelData } from '../../core/model.ts';
import type { BuildOpts } from '../../core/registry.ts';
import { flatCone, tubeSegments } from '../../core/sdf/shapes.ts';
import { type BoneSpec, Skeleton } from '../../core/skin/skeleton.ts';
import { type Anatomy, type Ctx, type HumanoidParams, buildHero, humanoidDef } from '../humanoid/index.ts';

export interface FoxTailSpec {
  /** number of tails (all fanned; the middle one is index 0 of the fan) */
  count: number;
  /** tail length (reference metres, scaled by body size) */
  length: number;
  /** radius multiplier */
  thick: number;
  /** palette keys used for fur and the spirit-fire tips */
  furMat: string;
  tipMat: string;
}

export interface FoxWarriorParams {
  humanoid: HumanoidParams;
  tails: FoxTailSpec;
}

/** tail root + paths for the fan, in world metres. Tails differ in length (centre longest), stagger front/back and curl outward at the tips. */
function fanPaths(a: Anatomy, t: FoxTailSpec): { path: Vec3[]; phi: number; len: number }[] {
  const s = a.s;
  const root: Vec3 = [0, a.pelvis[1] + 0.03 * s, a.pelvis[2] - 0.1 * s];
  const half = (t.count - 1) / 2;
  const out: { path: Vec3[]; phi: number; len: number }[] = [];
  for (let j = -half; j <= half; j++) {
    const r = j / half;
    const phi = r * 1.3; // angle from vertical in the back plane
    const stagger = Math.abs(j) % 2 === 0 ? -0.12 : 0.1; // alternate layers back/forward so neighbours do not fuse into one slab
    const L = t.length * s * (0.78 + 0.22 * Math.cos(r * Math.PI * 0.5)) * (1 + 0.07 * Math.sin(j * 2.3));
    const dir0 = vnorm([Math.sin(phi) * 0.8, Math.cos(phi) * 0.5 + 0.3, -0.7 + stagger]);
    const path: Vec3[] = [root];
    let p = root;
    for (let i = 1; i <= 3; i++) {
      // S-curve: the tail lifts, then its tip flicks outward and up
      const k = i / 3;
      const d = vnorm([dir0[0] + Math.sin(phi) * 0.7 * k * k, dir0[1] + 0.55 * k * k - 0.2 * k, dir0[2] + 0.5 * k - 0.15]);
      p = vadd(p, vscale(d, L / 3));
      path.push(p);
    }
    out.push({ path, phi, len: L });
  }
  return out;
}

export function foxHooks(spec: FoxWarriorParams, glowTags: string[]): NonNullable<HumanoidParams['hooks']> {
  return {
    afterBody(ctx: Ctx) {
      const s = ctx.a.s;
      const a = ctx.a;
      const fur = ctx.piece(spec.tails.furMat);
      const tip = ctx.piece(spec.tails.tipMat);
      glowTags.push(tip.tag);
      // --- bushy tails: fat belly, soft tapering tip (no cones), spirit-fire flames licking off every tip
      const prof: [number, number][] = [[0, 0.04], [0.2, 0.09], [0.45, 0.118], [0.7, 0.092], [0.88, 0.05], [1, 0.006]].map(([t, r]) => [t!, r! * spec.tails.thick * s] as [number, number]);
      fanPaths(a, spec.tails).forEach((tl, m) => {
        tubeSegments(tl.path, prof, { segments: 12 }).forEach((sg, i) => {
          const isTip = sg.t0 > 0.84;
          ctx.add(`tailF${m}_${i}`, sg.sdf, sg.t0 < 0.4 ? `tailF${m}_1` : `tailF${m}_2`, { tags: [isTip ? tip.tag : fur.tag, 'fur', 'tail'], w: 0.03 * s });
        });
        const end = tl.path[3]!;
        const d = vnorm(vsub(end, tl.path[2]!));
        const out: Vec3 = [Math.sign(tl.phi || 1) * 0.5, 0.3, 0];
        for (let k = 0; k < 3; k++) {
          // broad flame tongues (leaf blades), the centre one tallest, swept back/outward by the tail's own direction
          const ln = (k === 1 ? 0.34 : 0.24) * s;
          const lean = (k - 1) * 0.7;
          const tipP: Vec3 = [end[0] + (d[0] * 0.3 + out[0] * 0.25 + lean * 0.3) * ln, end[1] + (d[1] * 0.3 + 0.95) * ln, end[2] + (d[2] * 0.3 - 0.25) * ln];
          ctx.add(`flame${m}_${k}`, flatCone(vsub(end, vscale(d, 0.07 * s)), tipP, 0.052 * s, 0.003 * s, 0.28, [1, 0, 0]), `tailF${m}_2`, { tags: [tip.tag, 'tail', 'flame'], w: 0.012 * s });
        }
      });
      // --- fur body read: chest fluff, shoulder ruff, forearm and calf feathering, thigh britches, rump fluff
      const ch = a.torso[Math.min(a.torso.length - 2, a.torso.length - 1)]!;
      ctx.add('chest_fluff', new Ellipsoid([0, ch.y - 0.02 * s, (ch.cz ?? 0) + ch.rz * 0.8], [ch.rx * 0.62, 0.16 * s, ch.rz * 0.55]), 'chest', { tags: [fur.tag, 'fur'], w: 0.03 * s });
      for (let i = 0; i < 9; i++) {
        const th = (i / 9) * Math.PI * 2;
        const rr = 0.13 * s;
        if (Math.cos(th) < -0.55) continue; // open at the back so the tails stay clear
        ctx.add(`ruff_${i}`, new Ellipsoid([Math.sin(th) * rr * 1.1, a.neck[1] - 0.045 * s, a.neck[2] + Math.cos(th) * rr * 0.8 + 0.02 * s], [0.058 * s, 0.075 * s, 0.058 * s]), Math.sin(th) > 0 ? 'clavicle_l' : 'clavicle_r', { tags: [fur.tag, 'fur'], w: 0.03 * s });
      }
      ctx.add('neck_ruff', new RoundCone([0, a.neck[1] - 0.02 * s, a.neck[2] + 0.02 * s], [0, a.neck[1] - 0.07 * s, a.neck[2] + 0.06 * s], 0.11 * s, 0.15 * s), 'neck', { tags: [fur.tag, 'fur'], w: 0.03 * s });
      for (const sx of [1, -1] as const) {
        const sd = sx === 1 ? 'l' : 'r';
        const j = a.side(sx);
        for (let i = 0; i < 4; i++) {
          const t = 0.2 + i * 0.2;
          const c = vlerp(j.elbow, j.wrist, t);
          ctx.add(`fore_fur_${sd}${i}`, new Ellipsoid([c[0] - sx * 0.02 * s, c[1] + 0.01 * s, c[2] - 0.035 * s], [0.032 * s, 0.075 * s, 0.032 * s]), `forearm_${sd}`, { tags: [fur.tag, 'fur'], w: 0.015 * s });
        }
        const c2 = vlerp(j.shoulder, j.elbow, 0.4);
        ctx.add(`arm_fur_${sd}`, new Ellipsoid([c2[0] + sx * 0.012 * s, c2[1], c2[2] - 0.02 * s], [0.07 * s, 0.1 * s, 0.062 * s]), `upper_arm_${sd}`, { tags: [fur.tag, 'fur'], w: 0.02 * s });
        for (let i = 0; i < 3; i++) {
          const c = vlerp(j.knee, j.ankle, 0.2 + i * 0.25);
          ctx.add(`calf_fur_${sd}${i}`, new Ellipsoid([c[0], c[1], c[2] - 0.055 * s], [0.04 * s, 0.085 * s, 0.038 * s]), `shin_${sd}`, { tags: [fur.tag, 'fur'], w: 0.015 * s });
        }
        const th = vlerp(j.hip, j.knee, 0.45);
        ctx.add(`thigh_fur_${sd}`, new Ellipsoid([th[0], th[1], th[2] - 0.05 * s], [0.09 * s, 0.18 * s, 0.075 * s]), `thigh_${sd}`, { tags: [fur.tag, 'fur'], w: 0.02 * s });
      }
      ctx.add('rump_fluff', new Ellipsoid([0, a.pelvis[1] + 0.05 * s, a.pelvis[2] - 0.13 * s], [0.13 * s, 0.1 * s, 0.1 * s]), 'pelvis', { tags: [fur.tag, 'fur'], w: 0.04 * s });
    },
  };
}

/** skeleton with the fan-tail chains appended (indices of the original bones are unchanged) */
export function withFanTails(sk: Skeleton, a: Anatomy, t: FoxTailSpec): Skeleton {
  const bones: BoneSpec[] = [...sk.bones];
  fanPaths(a, t).forEach((tl, m) => {
    bones.push({ name: `tailF${m}_1`, parent: 'pelvis', pos: tl.path[0]! }, { name: `tailF${m}_2`, parent: `tailF${m}_1`, pos: tl.path[2]! });
  });
  return new Skeleton(bones);
}

const wave = (u: number, cycles: number, phase = 0): number => Math.sin((u * cycles + phase) * Math.PI * 2);

/** aggressive claw-ready idle: hunched, arms bent forward with open claws, weight rocking */
function clawReady(c: PoseCtx): void {
  const br = wave(c.u, 1, 0), sw = wave(c.u, 1, 0.25);
  c.add('spine', 0.1 + 0.02 * br, 0.05 * sw, 0);
  c.add('chest', 0.12 + 0.02 * br, -0.05 * sw, 0);
  c.add('neck', 0.14, 0.06 * sw, 0);
  c.add('head', 0.06, 0.08 * wave(c.u, 1, 0.5), 0);
  for (const [sd, sg] of [['l', 1], ['r', -1]] as const) {
    const ph = sg === 1 ? 0 : 0.5;
    c.set(`upper_arm_${sd}`, -0.5 + 0.05 * wave(c.u, 1, ph), 0.1 * sg, sg * 0.32);
    c.set(`forearm_${sd}`, -1.15 + 0.08 * wave(c.u, 1, ph + 0.15), 0, 0);
    c.set(`wrist_${sd}`, -0.15, 0, 0);
  }
}

/** drive the fan: spread (rad outward from the centre), raise (rad), sway amplitude, cycles over the clip */
export function animateTails(c: PoseCtx, n: number, spread: number, raise: number, sway: number, cycles: number, shake = 0): void {
  const half = (n - 1) / 2;
  for (let m = 0; m < n; m++) {
    const j = m - half;
    const rank = j / half; // -1..1
    const ph = m * 0.08;
    const w = sway * wave(c.u, cycles, ph);
    const w2 = sway * 0.7 * wave(c.u, cycles, ph - 0.12);
    const jit = shake * wave(c.u, 7, m * 0.17);
    c.set(`tailF${m}_1`, raise * 0.6 + 0.04 * w + jit, 0, -rank * spread + w);
    c.set(`tailF${m}_2`, raise * 0.5 + 0.05 * w2 + jit, 0, -rank * spread * 0.6 + w2 * 1.3);
  }
}

export async function buildFoxWarrior(spec: FoxWarriorParams, log: (s: string) => void = () => {}, opts?: BuildOpts): Promise<ModelData> {
  const glowTags: string[] = [];
  const hp: HumanoidParams = { ...spec.humanoid, glow: spec.humanoid.glow ? { ...spec.humanoid.glow, tags: glowTags } : undefined, hooks: { ...spec.humanoid.hooks, ...foxHooks(spec, glowTags) } };
  const parts = humanoidDef(hp, opts);
  const n = spec.tails.count;
  const sk = withFanTails(parts.skeleton, parts.anatomy, spec.tails);
  parts.def.skeleton = sk;
  const sc = parts.anatomy.s;
  // layer tail motion over every humanoid clip, per-clip energy
  const energy: Record<string, [number, number, number, number]> = {
    idle: [0.18, 0.06, 0.05, 1], walk: [0.2, 0.08, 0.07, 1], run: [0.35, 0.2, 0.1, 2], attack: [0.5, 0.3, 0.12, 2], attack2: [0.5, 0.3, 0.12, 2],
    cast: [0.7, 0.3, 0.1, 2], dash: [0.3, 0.35, 0.08, 2], hit: [0.1, 0.1, 0.2, 2], victory: [0.8, 0.3, 0.08, 1], spawn: [0.4, 0.2, 0.1, 1],
  };
  const clips: ClipSpec[] = parts.def.clips.map((cs) => {
    const e = energy[cs.name] ?? [0.2, 0.1, 0.06, 1];
    return {
      ...cs,
      pose(c) {
        cs.pose(c);
        if (cs.name === 'idle') clawReady(c);
        const dead = cs.name === 'death' ? 1 - Math.min(1, c.u * 2) : 1;
        animateTails(c, n, e[0] * dead, e[1] * dead, e[2] * dead, e[3]);
      },
    };
  });
  const arm = (c: PoseCtx, up: number, out: number): void => {
    for (const [sd, sg] of [['l', 1], ['r', -1]] as const) {
      c.set(`upper_arm_${sd}`, -up, 0, sg * out);
      c.set(`forearm_${sd}`, -up * 0.5, 0, 0);
    }
  };
  clips.push(
    {
      name: 'special1', duration: 2.0, loop: false,
      pose(c) {
        const t = c.t, r = Math.min(1, t / 0.5) * (1 - Math.max(0, (t - 1.5) / 0.5));
        c.set('spine', -0.15 * r, 0, 0); c.set('chest', -0.3 * r, 0, 0); c.set('neck', -0.45 * r, 0, 0); c.set('head', -0.4 * r, 0, 0);
        arm(c, 0.5 * r, 0.7 * r);
        animateTails(c, n, 0.7 * r, 0.45 * r, 0.05, 3, 0.04 * r);
      },
    },
    {
      name: 'special2', duration: 1.8, loop: false, hit: 0.95,
      pose(c) {
        const t = c.t, coil = Math.min(1, t / 0.7) * (1 - Math.max(0, (t - 1.35) / 0.45)), burst = Math.max(0, 1 - Math.abs(t - 0.95) / 0.2);
        c.move('root', 0, -0.12 * sc * coil, 0);
        c.set('pelvis', 0.2 * coil, 0, 0); c.set('spine', 0.2 * coil - 0.3 * burst, 0, 0); c.set('chest', 0.15 * coil - 0.25 * burst, 0, 0); c.set('head', -0.1 * burst, 0, 0);
        arm(c, 0.3 * coil + 0.6 * burst, 0.9 * burst);
        animateTails(c, n, 1.0 * coil + 0.3 * burst, 0.5 * coil + 0.4 * burst, 0.03, 3, 0.05 * burst);
      },
    },
    {
      name: 'special3', duration: 1.6, loop: false, hit: 0.75,
      pose(c) {
        const t = c.t, wind = Math.min(1, t / 0.5) * (1 - Math.min(1, Math.max(0, (t - 0.5) / 0.25))), lash = Math.max(0, Math.min(1, (t - 0.5) / 0.25)) * (1 - Math.max(0, (t - 1.0) / 0.6));
        c.set('spine', 0, 0.35 * wind - 0.5 * lash, 0); c.set('chest', 0, 0.3 * wind - 0.4 * lash, 0); c.set('head', 0, -0.2 * wind + 0.3 * lash, 0);
        arm(c, 0.2, 0.3 + 0.4 * lash);
        animateTails(c, n, 1.2 * (wind - 1.3 * lash), 0.3, 0.02, 1);
      },
    },
  );
  parts.def.clips = clips;
  return buildHero(parts.def, log);
}
