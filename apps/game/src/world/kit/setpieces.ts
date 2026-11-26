// World kit (C7) set-pieces: composed groups made only of existing PROP_DEFS ids (world/props.ts), RockKinds and
// WallKinds (no new 3D models). Each places through the ScatterContext (props / rocks honour isFree; wall lines are
// tested with isFree and split where blocked, then reserved for later scatter) and returns what it placed. Irregular

// Deterministic (see util.ts): every choice comes from the piece's own seed.
import type { RockPlacement, WallKind } from '../layoutTypes';
import { clamp } from '../noise';
import { PROP_DEFS } from '../props';
import type { ScatterContext } from '../recipe';
import { WorldRng } from '../rng';
import { ROCK_ASPECT } from './clump';
import type {
  AvenueSpec,
  CampFenceSpec,
  FencedYardSpec,
  GatePairSpec,
  HayYardSpec,
  PillarRingSpec,
  RuinCourtSpec,
  SetPiece,
  StoneRingSpec,
  Vec2,
} from './types';
import { datan2, dcos, dsin, HALF_PI, Path2, PI, smoothCurve, subSeed, TAU, unit, yawToward } from './util';

/** gate props (two pillars, a passage along their local Z) */
export const GATE_PROPS: ReadonlySet<string> = new Set(['pagoda_gate', 'stone_gate', 'broken_gate']);

/** default wall height (m) per kind */
export const WALL_HEIGHT: Readonly<Record<WallKind, number>> = { palisade: 3.2, fence: 1.3, stone_wall: 2.2, ruin_wall: 1.8, ice_wall: 2.4 };

const piece = (): SetPiece => ({ props: [], rocks: [], trees: [], walls: [] });

function checkProp(id: string, fn: string): void {
  if (!PROP_DEFS[id]) throw new Error(`world/kit ${fn}: unknown prop "${id}"`);
}

/** collision radius of a prop's widest footprint part (m, scale 1) */
function footRadius(id: string): number {
  const def = PROP_DEFS[id];
  if (!def) return 0.5;
  let r = 0;
  for (const part of def.footprint) {
    if ('circle' in part) r = Math.max(r, Math.abs(part.circle[0]) + part.circle[2]);
    else r = Math.max(r, Math.max(part.rect[2], part.rect[3]) * 0.5);
  }
  return r;
}

function placeProp(sc: ScatterContext, out: SetPiece, id: string, x: number, z: number, yaw: number, scale: number, force: boolean): boolean {
  const p = sc.prop(id, x, z, yaw, scale, { force });
  if (p) out.props.push(p);
  return p !== null;
}

/**
 * Wall runs that honour isFree: each line is sampled every 0.9 m (radius 0.55 = the wall's own blocker circles) and
 * split where it is not free. Occupancy is deferred to commit() so the runs of one piece do not cut each other at
 * shared corners.
 */
class WallBuilder {
  private readonly pending: number[] = [];

  constructor(
    private readonly sc: ScatterContext,
    private readonly out: SetPiece,
  ) {}

  run(kind: WallKind, x0: number, z0: number, x1: number, z1: number, height: number): void {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.6) return;
    const steps = Math.max(1, Math.ceil(len / 0.9));
    let start = -1;
    const flush = (a: number, b: number): void => {
      if (b - a < 1) return;
      const ta = a / steps;
      const tb = b / steps;
      const ax = x0 + dx * ta;
      const az = z0 + dz * ta;
      const bx = x0 + dx * tb;
      const bz = z0 + dz * tb;
      this.out.walls.push(this.sc.wall(kind, ax, az, bx, bz, height));
      const segLen = (tb - ta) * len;
      const k = Math.max(1, Math.ceil(segLen / 1.8));
      for (let i = 0; i <= k; i++) this.pending.push(ax + ((bx - ax) * i) / k, az + ((bz - az) * i) / k);
    };
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (this.sc.isFree(x0 + dx * t, z0 + dz * t, 0.55)) {
        if (start < 0) start = i;
      } else if (start >= 0) {
        flush(start, i - 1);
        start = -1;
      }
    }
    if (start >= 0) flush(start, steps);
  }

  /** reserve every placed run for later scatter (1 m discs every 1.8 m) */
  commit(): void {
    for (let i = 0; i < this.pending.length; i += 2) this.sc.occupy(this.pending[i] as number, this.pending[i + 1] as number, 1);
    this.pending.length = 0;
  }
}

/** true when the unit direction (ux, uz) at ring radius r falls inside the open side (gap) */
function inGap(ux: number, uz: number, r: number, gap: [number, number] | null, half: number): boolean {
  if (!gap) return false;
  const al = ux * gap[0] + uz * gap[1];
  const lat = Math.abs(ux * gap[1] - uz * gap[0]) * r;
  return al > 0 && lat < half;
}

/** Ring of standing stones (rock kind 'spire' / 'slab') with irregular spacing, lean and an optional open side. */
export function standingStoneRing(sc: ScatterContext, o: StoneRingSpec): SetPiece {
  const out = piece();
  const rng = new WorldRng(subSeed(o.seed, 0x5701));
  const force = o.force ?? true;
  const kind = o.kind ?? 'spire';
  const mat = o.mat ?? 0;
  const count = Math.max(1, Math.floor(o.count));
  const step = TAU / count;
  const a0 = rng.next() * TAU;
  const gap = o.gapDir ? unit(o.gapDir[0], o.gapDir[1]) : null;
  const gapHalf = (o.gapWidth ?? 6) * 0.5;
  const fallen = clamp(o.fallen ?? 0.15, 0, 1);
  if (o.focal) {
    checkProp(o.focal, 'standingStoneRing');
    placeProp(sc, out, o.focal, o.x, o.z, rng.next() * TAU, 1, force);
  }
  let maxR = 0;
  for (let k = 0; k < count; k++) {
    const a = a0 + k * step + (rng.next() - 0.5) * 0.5 * step;
    const rr = o.radius * (1 + (rng.next() - 0.5) * 0.12);
    const h = o.size[0] + (o.size[1] - o.size[0]) * rng.next();
    const lie = rng.next() < fallen;
    const l1 = rng.next() - 0.5;
    const l2 = rng.next() - 0.5;
    const big = rng.next() < 0.2;
    const ux = dcos(a);
    const uz = dsin(a);
    if (inGap(ux, uz, rr, gap, gapHalf + h * 0.25)) continue;
    const x = o.x + ux * rr;
    const z = o.z + uz * rr;
    const face = yawToward(o.x - x, o.z - z);
    let r: RockPlacement | null;
    if (lie) {
      // toppled: a slab lying along the ring
      r = sc.rock('slab', x, z, h * 0.42, h * 0.3, h, mat, { force, sink: h * 0.08 });
      if (r) {
        r.yaw = face + HALF_PI + l1 * 0.5;
        r.tiltX = l2 * 0.2;
        r.tiltZ = l1 * 0.2;
      }
    } else {
      const asp = kind === 'slab' ? ([0.55, 1, 0.2] as const) : kind === 'spire' ? ([0.42, 1, 0.36] as const) : ROCK_ASPECT[kind];
      const k1 = h / asp[1];
      r = sc.rock(kind, x, z, asp[0] * k1, h, asp[2] * k1, mat, { force, sink: h * 0.12 });
      if (r) {
        r.yaw = face + l1 * 0.4;
        r.tiltX = l2 * (big ? 0.38 : 0.12);
        r.tiltZ = l1 * (big ? 0.3 : 0.1);
      }
    }
    if (r) {
      out.rocks.push(r);
      maxR = Math.max(maxR, Math.max(r.sx, r.sz) * 0.5);
    }
  }
  if (o.clearInside ?? true) {
    const ri = o.radius - maxR - 0.6;
    if (ri > 0.5) sc.occupy(o.x, o.z, ri);
  }
  return out;
}

/** Ring of pillar props (e.g. 'lava_pillar', 'ruin_pillar', 'obelisk') around a court, optional open side. */
export function pillarRing(sc: ScatterContext, o: PillarRingSpec): SetPiece {
  checkProp(o.prop, 'pillarRing');
  if (o.gate) checkProp(o.gate, 'pillarRing');
  const out = piece();
  const rng = new WorldRng(subSeed(o.seed, 0x5702));
  const force = o.force ?? true;
  const count = Math.max(1, Math.floor(o.count));
  const step = TAU / count;
  const gap = o.gapDir ? unit(o.gapDir[0], o.gapDir[1]) : null;
  // slots are symmetric about the open side (the gap centre falls between two pillars)
  const a0 = gap ? datan2(gap[1], gap[0]) + 0.5 * step : rng.next() * TAU;
  const gapWidth = o.gapWidth ?? (o.gate ? footRadius(o.gate) * 2 + 3 : 8);
  const missing = clamp(o.missing ?? 0, 0, 1);
  const s0 = o.scale ?? [1, 1];
  const pr = footRadius(o.prop);
  if (gap && o.gate) placeProp(sc, out, o.gate, o.x + gap[0] * o.radius, o.z + gap[1] * o.radius, yawToward(gap[0], gap[1]), 1, force);
  for (let k = 0; k < count; k++) {
    const a = a0 + k * step + (rng.next() - 0.5) * 0.12 * step;
    const rr = o.radius * (1 + (rng.next() - 0.5) * 0.04);
    const scale = s0[0] + (s0[1] - s0[0]) * rng.next();
    const gone = rng.next() < missing;
    const yawJ = (rng.next() - 0.5) * 0.12;
    const ux = dcos(a);
    const uz = dsin(a);
    if (gone || inGap(ux, uz, rr, gap, gapWidth * 0.5 + pr * scale)) continue;
    const x = o.x + ux * rr;
    const z = o.z + uz * rr;
    placeProp(sc, out, o.prop, x, z, yawToward(o.x - x, o.z - z) + yawJ, scale, force);
  }
  if (o.clearInside) {
    const ri = o.radius - pr * s0[1] - 1;
    if (ri > 0.5) sc.occupy(o.x, o.z, ri);
  }
  return out;
}

/** Ruined court: broken wall runs ('ruin_wall'), fallen pillars, a focal prop at the centre. */
export function ruinCourt(sc: ScatterContext, o: RuinCourtSpec): SetPiece {
  const focal = o.focal ?? 'stele';
  const pillar = o.pillar ?? 'ruin_pillar';
  if (focal) checkProp(focal, 'ruinCourt');
  if (pillar) checkProp(pillar, 'ruinCourt');
  const out = piece();
  const rng = new WorldRng(subSeed(o.seed, 0x5703));
  const force = o.force ?? true;
  const decay = clamp(o.decay ?? 0.5, 0, 1);
  const wall = o.wall ?? 'ruin_wall';
  const [fx, fz] = unit(o.dir[0], o.dir[1]);
  const rx = fz;
  const rz = -fx;
  const hw = o.size[0] * 0.5;
  const hd = o.size[1] * 0.5;
  const P = (a: number, b: number): [number, number] => [o.x + rx * a + fx * b, o.z + rz * a + fz * b];
  if (focal) placeProp(sc, out, focal, o.x, o.z, yawToward(fx, fz), 1, force);
  // corner pillars: some snapped short, some fallen (a long slab beside the corner)
  const corners: Array<[number, number]> = [P(-hw, -hd), P(hw, -hd), P(hw, hd), P(-hw, hd)];
  for (const [cx, cz] of corners) {
    const roll = rng.next();
    const sc1 = 1 - decay * 0.45 * rng.next();
    const yaw = rng.next() * TAU;
    const fall = rng.next();
    if (pillar && roll >= decay * 0.55) placeProp(sc, out, pillar, cx, cz, yaw, sc1, force);
    else if (fall < 0.7) {
      const r = sc.rock('slab', cx + rx * 1.2, cz + rz * 1.2, 0.9, 0.6, 2.8, 0, { force, sink: 0.15 });
      if (r) {
        r.yaw = yaw;
        out.rocks.push(r);
      }
    }
  }
  // walls: each side broken into stretches with gaps; the front keeps an entrance in its middle
  const walls = new WallBuilder(sc, out);
  const gaps: Array<[number, number]> = [];
  const side = (ax: number, az: number, bx: number, bz: number, entrance: boolean): void => {
    const len = Math.sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az));
    const ux = (bx - ax) / len;
    const uz = (bz - az) / len;
    const inset = 1.6;
    const ent = entrance ? Math.max(4, o.size[0] * 0.28) : 0;
    let s = inset;
    while (s < len - inset) {
      const stretch = 2.5 + 3.5 * rng.next();
      const h = 1 + 1.8 * (1 - decay * 0.6) * rng.next();
      let e = Math.min(len - inset, s + stretch);
      if (ent > 0 && s < len * 0.5 + ent * 0.5 && e > len * 0.5 - ent * 0.5) {
        // stop at the entrance, continue after it
        e = len * 0.5 - ent * 0.5;
        if (e - s > 0.9) walls.run(wall, ax + ux * s, az + uz * s, ax + ux * e, az + uz * e, h);
        gaps.push([ax + ux * len * 0.5, az + uz * len * 0.5]);
        s = len * 0.5 + ent * 0.5;
        continue;
      }
      walls.run(wall, ax + ux * s, az + uz * s, ax + ux * e, az + uz * e, h);
      const gapLen = rng.next() < decay * 0.7 ? 1.5 + 2.5 * rng.next() : 0;
      if (gapLen > 0) gaps.push([ax + ux * (e + gapLen * 0.5), az + uz * (e + gapLen * 0.5)]);
      s = e + gapLen;
    }
  };
  const [c0, c1, c2, c3] = corners as [[number, number], [number, number], [number, number], [number, number]];
  side(c0[0], c0[1], c1[0], c1[1], false); // back
  side(c1[0], c1[1], c2[0], c2[1], false); // right
  side(c3[0], c3[1], c2[0], c2[1], true); // front (entrance)
  side(c0[0], c0[1], c3[0], c3[1], false); // left
  // rubble in some gaps (before the walls are reserved; gaps hold no wall)
  for (const [gx, gz] of gaps) {
    if (rng.next() >= decay) continue;
    const n = 1 + rng.int(2);
    for (let i = 0; i < n; i++) {
      const s = 0.4 + 0.45 * rng.next();
      const ox = (rng.next() - 0.5) * 1.6;
      const oz = (rng.next() - 0.5) * 1.6;
      const r = rng.next() < 0.5 ? sc.rock('boulder', gx + ox, gz + oz, s * 1.3, s, s * 1.15, 0, { force }) : sc.rock('pebbles', gx + ox, gz + oz, s * 1.6, s * 0.45, s * 1.2, 0, { force });
      if (r) out.rocks.push(r);
    }
  }
  walls.commit();
  if (o.clearInside ?? true) {
    const ri = Math.min(hw, hd) - 1.5;
    if (ri > 0.5) sc.occupy(o.x, o.z, ri);
  }
  return out;
}

/** Camp enclosure: palisade / fence runs with a gate gap, tents and a fire inside ('orc_tent', 'bonfire', ...). */
export function campFence(sc: ScatterContext, o: CampFenceSpec): SetPiece {
  for (const id of o.inner ?? []) checkProp(id, 'campFence');
  if (o.gatePost) checkProp(o.gatePost, 'campFence');
  const out = piece();
  const rng = new WorldRng(subSeed(o.seed, 0x5704));
  const force = o.force ?? true;
  const [gx, gz] = unit(o.gateDir[0], o.gateDir[1]);
  const gw = o.gateWidth ?? 7;
  const R = o.radius;
  const sides = clamp(Math.round((TAU * R) / 7.5), 6, 20);
  const step = TAU / sides;
  const aGate = datan2(gz, gx);
  const height = o.height ?? WALL_HEIGHT[o.wall];
  // polygon: the gate sits in the middle of the edge from vertex sides-1 to vertex 0
  const vx: number[] = [];
  const vz: number[] = [];
  for (let k = 0; k < sides; k++) {
    const fixed = k === 0 || k === sides - 1;
    const a = aGate + (k + 0.5) * step + (fixed ? 0 : (rng.next() - 0.5) * 0.3 * step);
    const r = R * (fixed ? 1 : 1 + (rng.next() - 0.5) * 0.14);
    vx.push(o.x + dcos(a) * r);
    vz.push(o.z + dsin(a) * r);
  }
  // inside: the first prop at the centre (facing the gate), the rest round an inner ring away from the gate lane
  const inner = o.inner ?? [];
  if (inner.length > 0) placeProp(sc, out, inner[0] as string, o.x, o.z, yawToward(gx, gz), 1, force);
  const rest = inner.length - 1;
  if (rest > 0) {
    const rin = R * 0.58;
    const win = (gw * 0.5 + 2.5) / Math.max(1, rin);
    const span = TAU - 2 * win;
    const slot = span / rest;
    for (let i = 0; i < rest; i++) {
      const id = inner[i + 1] as string;
      const j1 = rng.next() - 0.5;
      const j2 = rng.next() - 0.5;
      for (let attempt = 0; attempt < 2; attempt++) {
        const a = aGate + win + (i + 0.5) * slot + j1 * 0.4 * slot * (attempt === 0 ? 1 : -1);
        const r = rin * (attempt === 0 ? 1 + j2 * 0.16 : 0.86);
        const x = o.x + dcos(a) * r;
        const z = o.z + dsin(a) * r;
        if (placeProp(sc, out, id, x, z, yawToward(o.x - x, o.z - z), 1, force)) break;
      }
    }
  }
  // palisade: every edge but the gate edge; the gate edge keeps short stubs either side of the opening
  const walls = new WallBuilder(sc, out);
  for (let k = 0; k < sides - 1; k++) walls.run(o.wall, vx[k] as number, vz[k] as number, vx[k + 1] as number, vz[k + 1] as number, height);
  const lx = vx[sides - 1] as number;
  const lz = vz[sides - 1] as number;
  const fx0 = vx[0] as number;
  const fz0 = vz[0] as number;
  const elen = Math.sqrt((fx0 - lx) * (fx0 - lx) + (fz0 - lz) * (fz0 - lz));
  const ex = (fx0 - lx) / elen;
  const ez = (fz0 - lz) / elen;
  const g0 = elen * 0.5 - gw * 0.5;
  if (g0 > 0.9) {
    walls.run(o.wall, lx, lz, lx + ex * g0, lz + ez * g0, height);
    walls.run(o.wall, lx + ex * (elen - g0), lz + ez * (elen - g0), fx0, fz0, height);
  }
  if (o.gatePost) {
    // r9 Z9 (r8 judge MF8 d: the seori south-camp gate banner read edge-on, "a giant red diagonal stick"): a banner faces the fixed
    // game camera (yaw 0 / PI, render/camera.ts) with its arm and cloth pointing away from the gate, like the suryeon camp gates;
    // other gate posts still face the gate direction. No draw either way.
    const banner = o.gatePost === 'banner_pole' || o.gatePost === 'war_banner';
    const mx = lx + ex * elen * 0.5;
    for (const sgn of [-1, 1]) {
      const t = elen * 0.5 + sgn * (gw * 0.5 + 0.6);
      const px = lx + ex * t + gx * 0.8;
      const pz = lz + ez * t + gz * 0.8;
      // banner_pole: at yaw 0 the arm points to -X; war_banner: at yaw 0 the cloth hangs on +X (props.ts notes). A gate edge running
      // north-south (no east / west post) takes the order along the edge instead.
      const west = Math.abs(ex) > 0.25 ? px < mx : sgn < 0;
      const yaw = !banner ? yawToward(gx, gz) : o.gatePost === 'banner_pole' ? (west ? 0 : Math.PI) : west ? Math.PI : 0;
      placeProp(sc, out, o.gatePost, px, pz, yaw, 1, force);
    }
  }
  walls.commit();
  return out;
}

/** A pair of flanking props (lanterns, braziers, stelae) either side of a passage, or one gate prop across it. */
export function gatePair(sc: ScatterContext, o: GatePairSpec): SetPiece {
  checkProp(o.prop, 'gatePair');
  const out = piece();
  const rng = new WorldRng(subSeed(o.seed, 0x5705));
  const force = o.force ?? true;
  const [dx, dz] = unit(o.dir[0], o.dir[1]);
  const scale = o.scale ?? 1;
  if (GATE_PROPS.has(o.prop)) {
    placeProp(sc, out, o.prop, o.x, o.z, yawToward(dx, dz), scale, force);
    return out;
  }
  // `width` is the clear passage: prop centres sit half the width plus their footprint radius off the centre line
  const off = o.width * 0.5 + footRadius(o.prop) * scale;
  for (const side of [-1, 1]) {
    const o1 = off * (1 + (rng.next() - 0.5) * 0.08);
    const along = (rng.next() - 0.5) * 0.6;
    const yaw = yawToward(-dx, -dz) + (rng.next() - 0.5) * 0.1;
    placeProp(sc, out, o.prop, o.x + dz * side * o1 + dx * along, o.z - dx * side * o1 + dz * along, yaw, scale, force);
  }
  return out;
}

/** Props along a path with irregular spacing and alternating side offset (never fence posts in a row). */
export function avenue(sc: ScatterContext, o: AvenueSpec): SetPiece {
  checkProp(o.prop, 'avenue');
  const out = piece();
  const rng = new WorldRng(subSeed(o.seed, 0x5706));
  const force = o.force ?? true;
  let coarse = false;
  for (let i = 1; i < o.pts.length; i++) {
    const a = o.pts[i - 1] as Vec2;
    const b = o.pts[i] as Vec2;
    if ((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1]) > 36) coarse = true;
  }
  const path = new Path2(coarse ? smoothCurve(o.pts, 2) : o.pts);
  if (path.n < 2) return out;
  const sp0 = Math.max(0.5, Math.min(o.spacing[0], o.spacing[1]));
  const sp1 = Math.max(sp0, o.spacing[0], o.spacing[1]);
  const skip = clamp(o.skip ?? 0, 0, 1);
  const s0 = o.scale ?? [1, 1];
  const end = path.total - (o.end ?? sp0 * 0.5);
  const pt = { x: 0, z: 0, tx: 0, tz: 0 };
  let side = rng.next() < 0.5 ? 1 : -1;
  const put = (s: number, sd: number): void => {
    path.at(s, pt);
    const nx = pt.tz;
    const nz = -pt.tx;
    const off = o.offset * (0.9 + 0.22 * rng.next());
    const scale = s0[0] + (s0[1] - s0[0]) * rng.next();
    const yaw = yawToward(-nx * sd, -nz * sd) + (rng.next() - 0.5) * 0.16;
    placeProp(sc, out, o.prop, pt.x + nx * sd * off, pt.z + nz * sd * off, yaw, scale, force);
  };
  for (let s = o.start ?? sp0 * 0.5; s <= end; s += sp0 + (sp1 - sp0) * rng.next()) {
    if (o.mode === 'pairs') {
      for (const sd of [-1, 1]) {
        const jit = (rng.next() - 0.5) * 1.2;
        if (rng.next() >= skip) put(Math.min(end, Math.max(0, s + jit)), sd);
      }
    } else {
      if (rng.next() >= skip) put(s, side);
      // mostly alternating, sometimes the same side twice
      if (rng.next() < 0.82) side = -side;
    }
  }
  return out;
}

/** Farm yard: haystacks, crates, a fence corner, a well — loosely grouped. */
export function hayYard(sc: ScatterContext, o: HayYardSpec): SetPiece {
  const out = piece();
  const rng = new WorldRng(subSeed(o.seed, 0x5707));
  const force = o.force ?? true;
  const [fx, fz] = unit(o.dir[0], o.dir[1]);
  const rx = fz;
  const rz = -fx;
  const R = o.radius;
  const P = (a: number, b: number): [number, number] => [o.x + rx * a + fx * b, o.z + rz * a + fz * b];
  // haystacks at the back, loosely grouped. r8 Z8: each stack has its own slot across the yard (3.6 m apart, a little jitter, staggered
  // in depth): the free random spread put 2-4 stacks in one 8 x 4 m patch and the free test dropped every one that met another
  // (suryeon's village and two of yeonmu's yards lost 2-3 stacks each in every run).
  // r8 ship (Z8 critic s12 / s17: the 3.6 m slots read as fence posts, the 1.45 m crate line as a ruler row): the stooks stand on a row
  // axis turned +-25 deg with uneven gaps (3.2-4.2 m: never close enough for the free test to drop one) and +-0.8 m of depth jitter.
  // The yard's own stream `rng` draws exactly as before (the well and the fence below are unchanged); the new shape draws from `lay`.
  const lay = new WorldRng(subSeed(o.seed, 0x570c));
  const nh = 2 + rng.int(3);
  const th = (lay.next() - 0.5) * 0.87;
  const hx = dcos(th);
  const hz = dsin(th);
  let along = 0;
  const stooks: Array<[number, number, number, number]> = [];
  for (let i = 0; i < nh; i++) {
    if (i > 0) along += 3.2 + rng.next();
    else rng.next();
    const dep = -R * (0.2 + 0.4 * rng.next()) + (lay.next() - 0.5) * 1.6;
    stooks.push([along, dep, rng.next() * TAU, 0.85 + 0.3 * rng.next()]);
  }
  for (const [al, dep, yaw, scl] of stooks) {
    const a = al - along * 0.5;
    const [x, z] = P(hx * a, hz * a + dep);
    placeProp(sc, out, 'haystack', x, z, yaw, scl, force);
  }
  
  // 2 + 1 farm clutter), each item 1.2-1.4 m from its neighbour at its own angle (r8 Z8's row was 1.45 m apart, +-0.1 m)
  const nc = 2 + rng.int(3);
  const [kx, kz] = P(R * (0.3 + 0.25 * rng.next()), R * (0.25 + 0.2 * rng.next()));
  const tc = (lay.next() - 0.5) * 0.87;
  const ga = dcos(tc) * (1.8 + 0.6 * lay.next());
  const gb = dsin(tc) * 2.1 + (lay.next() - 0.5) * 1.2;
  const away = datan2(gb, ga);
  for (let i = 0; i < nc; i++) {
    const id = rng.next() < 0.5 ? 'crate' : 'barrel';
    const g2 = i >= 2;
    const k = g2 ? i - 2 : i;
    // the second item of each group leans away from the other group (never into it: the free test would drop it)
    const ang = away + (g2 ? 0 : PI) + (rng.next() - 0.5) * 2.4;
    const dj = rng.next();
    const d = k === 0 ? 0 : 1.2 + 0.2 * dj;
    const a = (g2 ? ga : 0) + dcos(ang) * d;
    const b = (g2 ? gb : 0) + dsin(ang) * d;
    placeProp(sc, out, id, kx + rx * a + fx * b, kz + rz * a + fz * b, rng.next() * TAU, 0.9 + 0.2 * rng.next(), force);
  }
  // a well in larger yards
  if (R >= 7 && rng.next() < 0.5) {
    const [wx, wz] = P(-R * 0.4, R * 0.35);
    placeProp(sc, out, 'well', wx, wz, rng.next() * TAU, 1, force);
  }
  // fence corner behind (an L of two runs)
  const walls = new WallBuilder(sc, out);
  const [cx, cz] = P(-R * 0.8, -R * 0.85);
  const la = R * (0.9 + 0.4 * rng.next());
  const lb = R * (0.6 + 0.4 * rng.next());
  walls.run('fence', cx, cz, cx + rx * la, cz + rz * la, WALL_HEIGHT.fence);
  walls.run('fence', cx, cz, cx + fx * lb, cz + fz * lb, WALL_HEIGHT.fence);
  walls.commit();
  return out;
}

/** Fenced yard around a house prop (fence runs with a gap, yard clutter). */
export function fencedYard(sc: ScatterContext, o: FencedYardSpec): SetPiece {
  const house = o.house ?? 'house_small';
  if (house) checkProp(house, 'fencedYard');
  const out = piece();
  const rng = new WorldRng(subSeed(o.seed, 0x5708));
  const force = o.force ?? true;
  const wall = o.wall ?? 'fence';
  const [fx, fz] = unit(o.dir[0], o.dir[1]);
  const rx = fz;
  const rz = -fx;
  const hw = o.size[0] * 0.5;
  const hd = o.size[1] * 0.5;
  const P = (a: number, b: number): [number, number] => [o.x + rx * a + fx * b, o.z + rz * a + fz * b];
  // the house towards the back, facing the gate
  if (house) {
    const [x, z] = P((rng.next() - 0.5) * hw * 0.2, -hd * 0.15);
    placeProp(sc, out, house, x, z, yawToward(fx, fz) + (rng.next() - 0.5) * 0.06, 1, force);
  }
  // a feature tree in a back corner
  if (o.tree) {
    const sg = rng.next() < 0.5 ? -1 : 1;
    const [x, z] = P(sg * (hw - 2.2), -hd + 2.2);
    const t = sc.tree(o.tree, x, z, 0.9 + 0.3 * rng.next(), undefined, { margin: 0, maxSlope: 1.2, anySurface: false });
    if (t) out.trees.push(t);
  }
  // clutter in the front corners and beside the house
  const spots: Array<[number, number]> = [
    [-(hw - 1.5), hd - 1.7],
    [hw - 1.5, hd - 1.7],
    [-(hw - 1.4), -hd * 0.1],
    [hw - 1.4, -hd * 0.1],
  ];
  const n = 2 + rng.int(3);
  for (let i = 0; i < n; i++) {
    const k = rng.int(spots.length);
    const roll = rng.next();
    const id = roll < 0.35 ? 'barrel' : roll < 0.7 ? 'crate' : roll < 0.85 ? 'urn' : 'haystack';
    const ja = (rng.next() - 0.5) * 0.8;
    const jb = (rng.next() - 0.5) * 0.8;
    const yaw = rng.next() * TAU;
    const scale = 0.9 + 0.2 * rng.next();
    // r8 Z8: a corner taken by something placed before the yard (a neighbour's house) hands the item to the next free corner (same
    // draws as before; the old loop dropped it: yeonmu lost an urn to a hamlet house in every run)
    for (let t = 0; t < spots.length; t++) {
      const j = (k + t) % spots.length;
      const [a, b] = spots[j] as [number, number];
      const [x, z] = P(a + ja, b + jb);
      if (!sc.fits(id, x, z, scale, { force })) continue;
      placeProp(sc, out, id, x, z, yaw, scale, force);
      spots.splice(j, 1);
      break;
    }
    if (spots.length === 0) break;
  }
  // fence: the front keeps a 3.2 m gate (off-centre a little), one side may miss a panel
  const walls = new WallBuilder(sc, out);
  const h = WALL_HEIGHT[wall];
  const gateA = (rng.next() - 0.5) * o.size[0] * 0.3;
  const missSide = rng.next() < 0.35 ? rng.int(3) : -1;
  const missAt = 0.25 + 0.5 * rng.next();
  const run = (a0: number, b0: number, a1: number, b1: number, miss: boolean): void => {
    const [x0, z0] = P(a0, b0);
    const [x1, z1] = P(a1, b1);
    if (!miss) {
      walls.run(wall, x0, z0, x1, z1, h);
      return;
    }
    const len = Math.sqrt((x1 - x0) * (x1 - x0) + (z1 - z0) * (z1 - z0));
    const gapLen = Math.min(len * 0.4, 2 + rng.next());
    const t0 = missAt - gapLen / len / 2;
    const t1 = missAt + gapLen / len / 2;
    walls.run(wall, x0, z0, x0 + (x1 - x0) * t0, z0 + (z1 - z0) * t0, h);
    walls.run(wall, x0 + (x1 - x0) * t1, z0 + (z1 - z0) * t1, x1, z1, h);
  };
  run(-hw, -hd, hw, -hd, missSide === 0); // back
  run(-hw, -hd, -hw, hd, missSide === 1); // left
  run(hw, -hd, hw, hd, missSide === 2); // right
  run(-hw, hd, gateA - 1.6, hd, false); // front, left of the gate
  run(gateA + 1.6, hd, hw, hd, false); // front, right of the gate
  walls.commit();
  return out;
}

/** a point `r` m from (cx, cz) at angle `a` (radians from +x towards +z) — for recipes placing round a piece */
export function polarPoint(cx: number, cz: number, r: number, a: number): [number, number] {
  return [cx + dcos(a) * r, cz + dsin(a) * r];
}

/** a recipe-side helper: angle (radians from +x towards +z) of the direction (dx, dz) */
export function angleOf(dx: number, dz: number): number {
  const a = datan2(dz, dx);
  return a < 0 ? a + 2 * PI : a;
}
