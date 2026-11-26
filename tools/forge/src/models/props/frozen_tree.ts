// prop_frozen_tree — 4 m dead tree locked in ice on the snowfield: a gnarled, twisting trunk with burls and a flared foot of buttress
// roots, six wide-spreading limbs that rise, zig-zag and droop under their load, forking into crooked branches and twiggy tips (a crown
// about 3 m across). Silver-grey dead bark under a glassy pale-blue ice sheath on the upper sides of the limbs, frost crust on the
// windward faces, snow lying in the forks, clusters of long icicles hanging from the drooping limb ends, and an ice-crusted snow
// drift with crystal shards around the roots.
import { Rng } from '../../core/rng.ts';
import type { Vec3 } from '../../core/math.ts';
import { clamp01, m4mul, m4translation, smoothstep } from '../../core/math.ts';
import type { PropDef } from '../../archetypes/prop/index.ts';
import type { Mat, Texel } from '../../archetypes/prop/mesh.ts';
import { fbm01, lum, mixc, mulc, pickTex, rgb } from '../../archetypes/prop/mats.ts';
import { type Rgb, sampleTex } from '../../archetypes/prop/texlib.ts';
import { TAG_GROUND, addFaces, crystalPlanes, groundPlane, hull, hullEdge, rockPlanes, rotYm, rotZ, xfPlanes } from '../../archetypes/prop/ext/PropsElem/hull.ts';
import { facetHash, memo1, noiseBump, triSample } from '../../archetypes/prop/ext/PropsElem/paint.ts';
import { tube } from '../../archetypes/prop/ext/PropsOrc/geom.ts';

const BARK = 0, ICE = 1, SNOW = 2, SHEATH = 3;
const HEIGHT = 4.0;

const v3 = (x: number, y: number, z: number): Vec3 => [x, y, z];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const nrm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** wind comes from -x: frost crust builds up on faces looking that way */
const WIND: Vec3 = nrm([-1, 0.15, 0.35]);

// ---------------------------------------------------------------------------------------------------------------------------------
// bark under frost

const BARK_T = pickTex('tex_bark_oak', 'tex_bark_pine');
const barkAvg = BARK_T ? Math.max(1e-3, lum(BARK_T.avg)) : 1;

const barkLook = memo1((t: Texel) => {
  const windward = clamp01(t.n[0] * WIND[0] + t.n[1] * WIND[1] + t.n[2] * WIND[2]);
  const up = clamp01(t.n[1]);
  const frost = clamp01(smoothstep(0.1, 0.6, windward) * 0.8 + up * 0.3) * smoothstep(0.35, 0.6, fbm01(t, 2.5, 3, 4.1) + 0.2);
  const snow = smoothstep(0.45, 0.8, up + (1 - t.ao) * 0.45 + (fbm01(t, 7, 3, 9.9) - 0.5) * 0.5) * smoothstep(0.25, 0.5, t.n[1]);
  return { frost, snow };
});

function barkShade(t: Texel): Rgb {
  // silver-grey dead wood; the bark fissures run along the limb (tube u)
  const l = BARK_T ? lum(sampleTex(BARK_T, t.uv[1], t.uv[0], t.fp)) / barkAvg : 1;
  let c: Rgb = mixc(rgb('#24201e'), rgb('#a29c93'), clamp01(0.12 + 0.52 * Math.pow(l, 1.3)));
  c = mulc(c, 0.82 + 0.3 * fbm01(t, 3, 3, 1.7));
  // pale weathered heartwood on knots, burls and broken stubs
  c = mixc(c, rgb('#cfc8ba'), smoothstep(0.35, 0.75, t.edge) * 0.4);
  const L = barkLook(t);
  c = mixc(c, mulc(rgb('#b9dcef'), 0.85 + 0.3 * fbm01(t, 12, 2, 2)), L.frost * 0.45);
  // hoar frost speckle on the windward side
  c = mixc(c, rgb('#f4f9fc'), smoothstep(0.7, 0.9, t.noise.noise(t.p[0] * 60, t.p[1] * 60, t.p[2] * 60) * 0.5 + 0.5) * L.frost * 0.7);
  c = mixc(c, mulc(rgb('#f2f7fb'), 0.9 + 0.1 * t.ao), L.snow * 0.92);
  return mulc(c, noiseBump(t, 18, 0.18, 2, 3));
}

const barkMat: Mat = { name: 'bark', shade: barkShade };

// ice: glacier blue with milky rims, frosted tops, faint inner glow (icicles, root shards)
const ICE_T = pickTex('tex_ice_blue');
const iceAvg = ICE_T ? Math.max(1e-3, lum(ICE_T.avg)) : 1;
const iceMat: Mat = {
  name: 'ice',
  ao: 0.6,
  shade(t) {
    const l = ICE_T ? lum(triSample(t, ICE_T, 1.2)) / iceAvg : 1;
    let c = mixc(rgb('#1d5a96'), rgb('#94d3ef'), clamp01(0.25 + 0.35 * l + 0.3 * facetHash(t, 2)));
    if (t.p[1] < 0.9) c = mixc(c, rgb('#e8f6ff'), (1 - smoothstep(0, 0.05, hullEdge(t.uv).d)) * 0.6);
    c = mixc(c, rgb('#f2f8fc'), smoothstep(0.55, 0.85, t.n[1]) * 0.75);
    c = mixc(c, rgb('#e6f4fb'), smoothstep(0.4, 0.8, t.edge) * 0.45);
    return c;
  },
  emit(t) {
    const k = 0.1 * (1 - smoothstep(0.5, 0.95, t.n[1])) * (0.5 + 0.5 * fbm01(t, 6, 2, 3.3));
    return [0.16 * k, 0.5 * k, k];
  },
};

// glaze sheath over the upper sides of the limbs: translucent-looking pale blue plates with milky crack lines and a frost crust on top
const sheathMat: Mat = {
  name: 'ice-sheath',
  ao: 0.5,
  shade(t) {
    const l = ICE_T ? lum(triSample(t, ICE_T, 2.2)) / iceAvg : 1;
    let c = mixc(rgb('#5f9cc8'), rgb('#cdeefc'), clamp01(0.3 + 0.35 * l + 0.25 * fbm01(t, 4, 2, 6.6)));
    // plates: darker seams between glaze plates
    const v = t.noise.voronoi(t.p[0] * 7, t.p[1] * 7, t.p[2] * 7, 0.9);
    c = mulc(c, 0.75 + 0.25 * smoothstep(0.02, 0.1, v.f2 - v.f1));
    c = mixc(c, rgb('#f7fbfe'), smoothstep(0.55, 0.9, t.n[1]) * smoothstep(0.4, 0.65, fbm01(t, 8, 2, 1.2)) * 0.85);
    c = mixc(c, rgb('#eef8ff'), smoothstep(0.35, 0.75, t.edge) * 0.5);
    return c;
  },
  emit(t) {
    const k = 0.07 * (1 - smoothstep(0.3, 0.9, t.n[1]));
    return k < 0.005 ? null : [0.16 * k, 0.5 * k, k];
  },
};

// snow drift around the foot
const SNOW_T = pickTex('tex_snow_packed', 'tex_snow_fresh');
const snowMat: Mat = {
  name: 'snow',
  shade(t) {
    let c: Rgb = SNOW_T ? mulc(triSample(t, SNOW_T, 0.8), 1.05) : rgb('#eef4fa');
    c = mixc(c, rgb('#f6fafd'), 0.4);
    c = mixc(c, rgb('#9fb8d0'), (1 - t.ao) * 0.55);
    return mulc(c, noiseBump(t, 10, 0.25, 3, 7));
  },
};

// ---------------------------------------------------------------------------------------------------------------------------------
// branching

/** crooked growth: each step turns at random (zig-zag), the vertical bias blends from `rise0` at the root to `rise1` at the tip */
function grow(rng: Rng, p0: Vec3, dir: Vec3, len: number, segs: number, crook: number, rise0: number, rise1 = rise0): Vec3[] {
  const pts: Vec3[] = [p0];
  let d = nrm(dir);
  let p = p0;
  for (let i = 0; i < segs; i++) {
    const rise = rise0 + (rise1 - rise0) * (i / Math.max(1, segs - 1));
    d = nrm(add(d, [(rng.next() - 0.5) * crook, (rng.next() - 0.5) * crook * 0.5 + rise, (rng.next() - 0.5) * crook]));
    p = add(p, scl(d, len / segs));
    pts.push(p);
  }
  return pts;
}

const taper = (n: number, r0: number, r1: number): number[] => Array.from({ length: n }, (_, i) => r0 + (r1 - r0) * (i / (n - 1)));

export const prop: PropDef = {
  id: 'prop_frozen_tree',
  size: 1536,
  // 62°: six-sided roots, the trunk and the drift shade smooth; five-sided ice shards and the 3-4-sided twigs/icicles stay crisp
  crease: 62,
  aoShort: 0.35,
  aoLong: 1.6,
  aoGain: 1.2,
  shadowTint: [0.5, 0.56, 0.68],
  emissiveFactor: [1, 1, 1],
  material: { roughness: 0.6, metallic: 0 },
  mats: [barkMat, iceMat, snowMat, sheathMat],
  build(m) {
    const rng = new Rng('frozen_tree:v2');
    m.fixedGround = true;
    const bark = (path: Vec3[], radii: number[], sides: number, seed: string, jitter = 0.08): void => {
      tube(m, { path, radii, sides, mat: BARK, s: 0.45, caps: 'none', seed, jitter, wobble: 0.06, uOff: rng.next() * 7 });
    };
    const icicles: { p: Vec3; n: number; len: number; r: number }[] = [];

    // ---- trunk: twisting lean, burls, flared foot; the top is a broken-off snag (capped) instead of a spike above the crown
    const trunk = grow(rng.fork('trunk'), v3(0, -0.05, 0), v3(0.1, 1, -0.05), 2.6, 10, 0.38, 0.08, 0.02);
    const burl = [0, 0, 0, 0.18, 0, 0, 0.14, 0, 0, 0, 0];
    const tr = trunk.map((_, i) => {
      const t = i / (trunk.length - 1);
      return (0.22 * (1 - 0.7 * Math.pow(t, 1.3)) + 0.2 * Math.max(0, 1 - t * 3.5) ** 2) * (1 + (burl[i] ?? 0));
    });
    tube(m, { path: trunk, radii: tr, sides: 9, mat: BARK, s: 0.45, caps: 'end', seed: 'trunk', jitter: 0.14, wobble: 0.06, uOff: rng.next() * 7 });

    // ---- buttress roots: rounded flares growing out of the foot and diving under the drift (no flat fins)
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + 0.3 + rng.next() * 0.5;
      const d = v3(Math.cos(a), -0.3, Math.sin(a));
      const root = grow(rng.fork(`root${k}`), v3(Math.cos(a) * 0.08, 0.48, Math.sin(a) * 0.08), d, 0.82 + rng.next() * 0.22, 4, 0.3, -0.08, -0.75);
      const path = root.map((p, i) => [p[0], Math.max(p[1], i === root.length - 1 ? -0.1 : 0.05), p[2]] as Vec3);
      tube(m, { path, radii: path.map((_, i) => 0.19 * (1 - i / (path.length - 1)) ** 1.4 + 0.035), sides: 6, mat: BARK, s: 0.45, caps: 'none', seed: `root${k}`, jitter: 0.1, squash: 1.1, uOff: k * 2.3 });
    }

    // ---- six spreading limbs: rise, zig-zag, droop; forks and twigs; ice sheath on top; icicle clusters at the drooping ends
    const NL = 6;
    for (let li = 0; li < NL; li++) {
      const a = (li / NL) * Math.PI * 2 + 0.25 + (rng.next() - 0.5) * 0.5;
      const ti = Math.min(trunk.length - 1, 5 + (li % 4));
      const at = trunk[ti]!;
      const r0 = Math.max(0.072, tr[ti]! * 0.62);
      const len = 1.35 + rng.next() * 0.4;
      const out = v3(Math.cos(a), 0.75 + rng.next() * 0.35, Math.sin(a));
      const lp = grow(rng.fork(`limb${li}`), at, out, len, 6, 0.55, 0.05, -0.32);
      const lr = taper(lp.length, r0, r0 * 0.3);
      bark(lp, lr, 6, `limb${li}`);
      // glaze sheath: a flattened shell riding on the upper side of the limb
      const sh = lp.slice(1).map((p, i) => add(p, [0, lr[i + 1]! * 0.42, 0]));
      tube(m, { path: sh, radii: lr.slice(1).map((r) => r * 1.12), sides: 5, mat: SHEATH, s: 0.3, caps: 'both', seed: `sheath${li}`, squash: 0.55, jitter: 0.08 });
      // icicle clusters under the two last joints
      icicles.push({ p: lp[lp.length - 2]!, n: 3, len: 0.5, r: lr[lr.length - 2]! }, { p: lp[lp.length - 3]!, n: 2, len: 0.35, r: lr[lr.length - 3]! });
      // forks
      for (let b = 0; b < 3; b++) {
        const j = 2 + b;
        const p0 = lp[j]!;
        const side = b % 2 === 0 ? 1 : -1;
        const dir = nrm(add(out, [-Math.sin(a) * side * 0.9 + (rng.next() - 0.5) * 0.4, 0.3 + rng.next() * 0.3, Math.cos(a) * side * 0.9 + (rng.next() - 0.5) * 0.4]));
        const rb = lr[j]! * 0.6;
        const bp = grow(rng.fork(`br${li}${b}`), p0, dir, 0.75 - b * 0.12 + rng.next() * 0.15, 3, 0.75, 0.12, -0.18);
        bark(bp, taper(bp.length, rb, 0.006), 4, `br${li}${b}`);
        // twiggy tips
        for (let w = 0; w < 2; w++) {
          const tp = bp[2 + w]!;
          const tdir = nrm(add(dir, [(rng.next() - 0.5) * 1.6, 0.5, (rng.next() - 0.5) * 1.6]));
          const twig = grow(rng.fork(`tw${li}${b}${w}`), tp, tdir, 0.28 + rng.next() * 0.14, 2, 1.0, 0.15);
          bark(twig, taper(twig.length, rb * 0.45, 0.003), 3, `tw${li}${b}${w}`, 0.04);
        }
      }
      // a twig at the limb tip
      const tipDir = nrm(add(out, [(rng.next() - 0.5), 0.2, (rng.next() - 0.5)]));
      const tip = grow(rng.fork(`tip${li}`), lp[lp.length - 1]!, tipDir, 0.35, 3, 0.9, 0.05);
      bark(tip, taper(tip.length, lr[lr.length - 1]!, 0.003), 3, `tip${li}`, 0.04);
    }

    // ---- icicles: long tapered spikes with a slight bend, clustered
    for (const ic of icicles) {
      for (let j = 0; j < ic.n; j++) {
        const off = v3((rng.next() - 0.5) * ic.r * 2.2, -ic.r * 0.7, (rng.next() - 0.5) * ic.r * 2.2);
        const p0 = add(ic.p, off);
        const len = ic.len * (0.45 + 0.75 * rng.next());
        const bend = v3((rng.next() - 0.5) * 0.03, 0, (rng.next() - 0.5) * 0.03);
        tube(m, { path: [p0, add(p0, add(bend, [0, -len * 0.45, 0])), add(p0, add(scl(bend, 1.6), [0, -len, 0]))], radii: [0.028 + ic.r * 0.2, 0.016, 0.0015], sides: 3, mat: ICE, s: 0.3, caps: 'start', seed: `ic${icicles.indexOf(ic)}${j}` });
      }
    }

    // ---- ice-crusted drift with crystal shards around the roots
    const gp = groundPlane(0);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + 0.2 + rng.next() * 0.4;
      const r = new Rng(`rootice${k}`);
      const lp = crystalPlanes(r, { h: 0.35 + r.next() * 0.35, r: 0.13 + r.next() * 0.05, sides: 5, narrow: 0.45, tipLen: 0.14, tip: 2, irregular: 0.25, bottom: -0.2 });
      const rr = 0.45 + r.next() * 0.35;
      const xf = m4mul(m4translation([Math.cos(a) * rr, 0, Math.sin(a) * rr]), m4mul(rotYm(-a), rotZ(-0.35 - r.next() * 0.35)));
      addFaces(m, hull([...xfPlanes(lp, xf), gp], 4), { mat: ICE, skip: [TAG_GROUND] });
    }
    const drift = rockPlanes(new Rng('drift'), { r: [1.0, 0.26, 0.9], n: 20, jitter: 0.22, cut: [0.9, 1] });
    addFaces(m, hull([...xfPlanes(drift, m4translation([0.05, -0.06, 0.02])), gp], 4), { mat: SNOW, skip: [TAG_GROUND], rough: { edge: 0.12, centre: 0.08, minEdge: 0.12, seed: 5 } });
    const crust = rockPlanes(new Rng('crust'), { r: [0.55, 0.16, 0.5], n: 12, jitter: 0.3, cut: [0.85, 1] });
    addFaces(m, hull([...xfPlanes(crust, m4translation([-0.15, 0.12, 0.1])), gp], 4), { mat: ICE, skip: [TAG_GROUND], rough: { centre: 0.1, seed: 6 } });

    // normalise to the nominal height (vertical only, the crown spread is authored)
    const k = HEIGHT / Math.max(1e-3, m.bounds().max[1]);
    m.deform(0, (p) => [p[0], p[1] * k, p[2]]);
  },
};
