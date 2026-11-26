// Ported from threejs-vfx src/vfx/ArcNetwork.js (MIT, © mohamedachrefelouafi — see ./LICENSE).
// A discharge that hops instead of travelling. Everything else that crosses a distance moves a front along it; a chain lightning
// picks a handful of points and is at the first one, then at the second, and the space between was skipped rather than crossed.
// That discontinuity is the whole read, so this is a node graph plus a clock rather than a `progress` uniform:
//   1. the scatter — `nodes` points between two anchors, stored as unitless fractions (along, lateral, lift) rolled once per cast;
//      the metres arrive when the vertex shader resolves a node against the role's live `scatter` and `lift`
//   2. the clock — a cursor in *hops* (dt / hopTime): a hop is dark until the cursor reaches it, holds for `hold` hops, then
//      decays over `overlap` hops
//   3. the hook — `onNode(index, position, count)` fires once per node on the frame the cursor reaches it, with the node's
//      resolved world position (the shader's own arithmetic), so a burst lands *on* the node
// It draws through a `FilamentPaths` role in CHAIN mode and never owns the meshes: the owner configures its other roles and calls
// `paths.sync()` once per frame, after `update()`.
//
//   const net = new ArcNetwork(paths, 0);            // role 0 of an existing FilamentPaths
//   net.onNode = hook;                               // bound once, never per frame
//   net.reset(seed);                                 // start of a cast
//   net.from.copy(a); net.to.copy(b);                // anchors
//   net.update(dt, params);                          // every frame; then paths.sync(look, fade, net.seed)
import { Vector3 } from 'three';
import { MAX_CHAIN_NODES, type FilamentPaths, type FilamentRole } from './filament';
import { clamp, hash11, saturate } from './math';

const _node = new Vector3();

/** Everything `ArcNetwork.update()` reads; one object per effect, written in place. */
export interface ArcNetworkParams {
  /** points including both ends, 2..MAX_CHAIN_NODES */
  nodes: number;
  /** whole polylines drawn over the same nodes */
  filaments: number;
  /** metres the lateral fractions are scaled by */
  scatter: number;
  /** metres the lift fractions are scaled by */
  lift: number;
  /** 0..1 of a hop that a node may slide down the line */
  alongJitter: number;
  /** metres a hop bows downward at mid-hop */
  sag: number;
  /** metres a hop bows sideways, alternating per hop */
  bow: number;
  /** world y below which a node's filament is clamped */
  floorY: number;
  /** seconds per hop */
  hopTime: number;
  /** hops a lit segment stays at full */
  hold: number;
  /** hops it then decays over */
  overlap: number;
  /** how much of a hop the front is smeared over */
  tip: number;
  /** multiplier on the shared `jitter` */
  kink: number;
  /** multiplier on the shared `width` */
  chainWidth: number;
  /** 0..1 alpha */
  dim: number;
  /** 0..1 on the kink's world y — a chain skimming the floor wants < 1 */
  groundDamp: number;
}

export function createArcNetworkParams(): ArcNetworkParams {
  return {
    nodes: 6,
    filaments: 3,
    scatter: 1.6,
    lift: 0.5,
    alongJitter: 0.5,
    sag: 0.12,
    bow: 0.3,
    floorY: 0.06,
    hopTime: 0.045,
    hold: 1.4,
    overlap: 2.6,
    tip: 0.3,
    kink: 1,
    chainWidth: 1,
    dim: 1,
    groundDamp: 0.55,
  };
}

export class ArcNetwork {
  /** anchors: written by the owner; the network keeps no geometry */
  readonly from = new Vector3();
  readonly to = new Vector3(0, 0, 1);
  /** Fired once per node, on the frame the cursor reaches it. `position` is module scratch: read it, do not keep it. */
  onNode: ((index: number, position: Vector3, count: number) => void) | null = null;
  seed = 0;
  /** the lit front, in hops (unitless, so `hopTime` can move under it) */
  cursor = 0;
  private fired = 0;
  private nodes = 2;
  private readonly role: FilamentRole;
  private readonly lateral = new Float32Array(MAX_CHAIN_NODES);
  private readonly lift = new Float32Array(MAX_CHAIN_NODES);
  private readonly slide = new Float32Array(MAX_CHAIN_NODES);

  constructor(
    readonly paths: FilamentPaths,
    roleIndex = 0,
  ) {
    this.role = paths.role(roleIndex);
    this.reseed(0);
  }

  /** live nodes, including both ends */
  get nodeCount(): number {
    return this.nodes;
  }

  /** hops between them */
  get segments(): number {
    return Math.max(1, this.nodes - 1);
  }

  /** 0..1 of the way down the chain the front has reached */
  get progress(): number {
    return saturate(this.cursor / this.segments);
  }

  /** true once the last node has lit */
  get arrived(): boolean {
    return this.cursor >= this.segments;
  }

  /** Re-rolls the scatter; deterministic in `seed`, the clock is untouched. */
  reseed(seed: number): this {
    this.seed = seed;
    for (let i = 0; i < MAX_CHAIN_NODES; i++) {
      // Alternating sides, not free scatter: two consecutive nodes on one side draw a curve, and a curve is a bolt — the zig is
      // the point of a chain. The magnitude still varies, so it does not read as a zip.
      const side = i % 2 === 0 ? 1 : -1;
      this.lateral[i] = side * (0.35 + 0.65 * hash11(seed + i * 3.71));
      this.lift[i] = hash11(seed + i * 7.13 + 11.7);
      this.slide[i] = hash11(seed + i * 5.31 + 41.3) - 0.5;
    }
    return this;
  }

  /** Starts a cast: re-roll, rewind the clock, un-fire every hook. */
  reset(seed: number): this {
    this.reseed(seed);
    this.cursor = 0;
    this.fired = 0;
    return this;
  }

  /** Where node `i` is, in metres: the shader's arithmetic, mirrored. */
  nodePoint(i: number, out: Vector3): Vector3 {
    return this.paths.nodePoint(this.role.index, i, out);
  }

  /** Advances the clock, re-resolves the graph, configures the chain role and fires the hooks that came due. */
  update(dt: number, p: ArcNetworkParams): void {
    const n = clamp(Math.round(p.nodes), 2, MAX_CHAIN_NODES);
    this.nodes = n;
    this.paths.setNodeCount(n);

    // `along` is derived here, not stored, because the node count is live: dropping from seven nodes to four has to re-space the
    // survivors rather than leave a gap where the last three were.
    const segs = n - 1;
    const slide = p.alongJitter / segs;
    for (let i = 0; i < n; i++) {
      const end = i === 0 || i === n - 1;
      const along = end ? i / segs : i / segs + (this.slide[i] as number) * slide;
      // The ends are the anchors themselves; scattering them makes the cast look like it missed.
      this.paths.setNode(i, along, end ? 0 : (this.lateral[i] as number), end ? 0 : (this.lift[i] as number));
    }

    const hop = Math.max(p.hopTime, 1e-4);
    const hold = Math.max(p.hold, 0);
    const overlap = Math.max(p.overlap, 1e-3);
    this.cursor += dt / hop;
    // Parked once the tail has passed the last node: left to run the float loses the fractional precision the front's smear needs.
    this.cursor = Math.min(this.cursor, segs + hold + overlap + 1);

    const role = this.role;
    role.count = Math.max(1, Math.round(p.filaments));
    role.chain(this.from, this.to, p.scatter, p.lift, p.sag, p.bow, this.cursor, hold, overlap, Math.max(p.tip, 1e-3));
    role.style(p.kink, p.chainWidth, p.dim, p.groundDamp);
    role.ends(1, 1, 1, 1);
    // The chain does its own front in the shader's `chainLit`, so the ribbon-wide clip stays out of its way; the floor clamp is the
    // only part of `draw` it wants.
    role.draw(2, 0.08, p.floorY, 0);

    // after the role is configured, so a node resolves
    while (this.fired < n && this.cursor >= this.fired) {
      const index = this.fired;
      this.fired++;
      this.onNode?.(index, this.nodePoint(index, _node), n);
    }
  }

  /** Retires the chain role and rewinds; the instance stays reusable. */
  clear(): void {
    this.role.retire();
    this.cursor = 0;
    this.fired = 0;
  }
}
