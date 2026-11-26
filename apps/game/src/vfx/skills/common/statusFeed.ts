
//   stun -> sk.gen.stun_loop (+ one sk.gen.stun burst when the bit turns on), burn -> sk.gen.fire_loop,
//   poison -> sk.gen.poison_loop, slow -> sk.gen.slow_loop.
// One loop handle per (enemy, status): spawned when the bit appears, moved every frame (positions interpolated with
// px/pz × alpha like app/skillVfxFeed.ts), stopped when the bit clears, the enemy dies / leaves the store or loses its
// place under the cap. Metin rows are skipped. At most MAX_LOOPS loops live at once (shared 255-instance spec pool),
// handed out to the enemies nearest any living player (active enemies get a small hysteresis bonus so the set does not
// flicker). Zero steady-state allocation: per-slot typed arrays, a keyed typed-array sort, no closures in the loop.
//
// Heights (r1, 2026-10-19): the specs carry the attach height of a 1.76 m humanoid in `lift` (the host adds it unscaled), the feed passes
// y = ground + (wanted height of THIS body) - lift: the stun ring over the head, gas / flames at the torso, smoke at the feet, from the model's
// baked height × the enemy's render scale (vfx/common/status/bodies.ts), so a boar's poison sits on the boar, not a metre above it.
// SpawnOpts.scale = s, the mean of the radius and the height ratio of a humanoid (0.45 m, 1.76 m).
// A loop whose instance ended (spec pool eviction, a duration) is respawned while the status bit is still set (Vfx.alive).
// Same call shape as SkillVfxFeed.update. reset(): forget every handle (call when the run / vfx is torn down).
import { EnemyFlag, EnemyState, StatusBit } from '../../../sim/stores';
import type { World } from '../../../sim/world';
import type { SpawnOpts, Vfx } from '../../types';
import { FEET_Y, bodyOf, headY, torsoY } from '../../common/status/bodies';
import { COMBAT_SPECS } from './combat';

/** loops handed out at most (all enemies, all statuses) */
export const MAX_LOOPS = 24;
/** sk.gen.stun bursts started per frame at most (an AoE stun must not drain the spec pool) */
const MAX_BURSTS = 4;
/** enemy radius of a "scale 1" humanoid, metres */
const BODY_R = 0.45;
/** height of a "scale 1" humanoid, metres */
const BODY_H = 1.76;
/** squared-distance multiplier for enemies that already show loops (hysteresis at the cap boundary) */
const KEEP_BONUS = 0.7;

/** loop kinds in priority order (first kept when the cap bites) */
const KIND_BITS = [StatusBit.Stun, StatusBit.Burn, StatusBit.Poison, StatusBit.Slow] as const;
const KIND_IDS = ['sk.gen.stun_loop', 'sk.gen.fire_loop', 'sk.gen.poison_loop', 'sk.gen.slow_loop'] as const;
const KINDS = KIND_BITS.length;
const MASK = StatusBit.Stun | StatusBit.Burn | StatusBit.Poison | StatusBit.Slow;
const BURST_ID = 'sk.gen.stun';

const LIFT: Record<string, number> = Object.fromEntries(COMBAT_SPECS.map((s) => [s.id, s.lift ?? 0]));
const KIND_LIFT = KIND_IDS.map((id) => LIFT[id] ?? 0);
const BURST_LIFT = LIFT[BURST_ID] ?? 0;
/** where each loop kind sits on the body: 0 head, 1 torso, 2 feet (same order as KIND_BITS) */
const KIND_ANCHOR = [0, 1, 1, 2] as const;

/** DenseStore handles are (generation << 16) | slot */
const SLOTS = 1 << 16;
const SLOT_MASK = SLOTS - 1;
/** candidate index bits inside a sort key */
const IDX_BITS = 8192;

export class StatusVfxFeed {
  /** enemy id owning the loops of a slot (0 = none) */
  private readonly slotId = new Uint32Array(SLOTS);
  /** loop handle per slot × kind */
  private readonly slotH = new Int32Array(SLOTS * KINDS);
  private readonly slotStamp = new Uint32Array(SLOTS);
  /** status mask seen last frame per slot (+ the id it belongs to): rising-edge detection for the stun burst */
  private readonly prevMask = new Uint16Array(SLOTS);
  private readonly prevId = new Uint32Array(SLOTS);
  /** slots owning loops */
  private readonly active = new Int32Array(SLOTS);
  /** index of each slot in `active`, or -1 when absent (enforces at most one entry per slot) */
  private readonly activePos = new Int32Array(SLOTS).fill(-1);
  private activeN = 0;
  /** candidates of this frame */
  private candRow = new Int32Array(256);
  private candRise = new Uint8Array(256);
  private keys = new Float64Array(256).fill(Infinity);
  private keysUsed = 0;
  private readonly opts: SpawnOpts = {};
  private stamp = 0;

  /** live loop handles (tests / debug overlay) */
  get liveLoops(): number {
    let n = 0;
    for (let a = 0; a < this.activeN; a++) {
      const base = (this.active[a] as number) * KINDS;
      for (let k = 0; k < KINDS; k++) if ((this.slotH[base + k] as number) !== 0) n++;
    }
    return n;
  }

  update(world: World, vfx: Vfx, alpha: number, heightAt: (x: number, z: number) => number): void {
    const stamp = (this.stamp = (this.stamp + 1) >>> 0 || 1);
    const E = world.enemies;
    const players = world.players;

    // 1. candidates: living non-metin enemies with a tracked status bit, keyed by squared distance to the nearest player
    let n = 0;
    for (let i = 0; i < E.count; i++) {
      const id = E.id[i] as number;
      const slot = id & SLOT_MASK;
      const dead = ((E.flags[i] as number) & EnemyFlag.Metin) !== 0 || E.state[i] === EnemyState.Dying;
      const st = dead ? 0 : (E.status[i] as number) & MASK;
      const had = this.prevId[slot] === id ? (this.prevMask[slot] as number) : 0;
      this.prevMask[slot] = st;
      this.prevId[slot] = id;
      if (st === 0) continue;
      const px = E.px[i] as number, pz = E.pz[i] as number;
      const x = px + ((E.x[i] as number) - px) * alpha;
      const z = pz + ((E.z[i] as number) - pz) * alpha;
      let d2 = Infinity;
      for (let p = 0; p < players.length; p++) {
        const pl = players[p];
        if (!pl || !pl.alive) continue;
        const dx = pl.x - x, dz = pl.z - z;
        const d = dx * dx + dz * dz;
        if (d < d2) d2 = d;
      }
      if (d2 === Infinity) d2 = 1e6;
      if (this.slotId[slot] === id) d2 *= KEEP_BONUS;
      if (n >= IDX_BITS) break;
      if (n >= this.candRow.length) this.grow(n * 2, n);
      this.candRow[n] = i;
      this.candRise[n] = (st & StatusBit.Stun) !== 0 && (had & StatusBit.Stun) === 0 ? 1 : 0;
      this.keys[n] = Math.floor(Math.min(d2, 1e6) * 64) * IDX_BITS + n;
      n++;
    }
    const keys = this.keys;
    if (this.keysUsed > n) keys.fill(Infinity, n, this.keysUsed);
    this.keysUsed = n;
    if (n > 1) keys.sort();

    // 2. hand out the loop budget nearest first
    let budget = MAX_LOOPS;
    let bursts = 0;
    const o = this.opts;
    for (let j = 0; j < n; j++) {
      const key = keys[j] as number;
      if (!Number.isFinite(key)) break;
      const c = key % IDX_BITS;
      const i = this.candRow[c] as number;
      const id = E.id[i] as number;
      const slot = id & SLOT_MASK;
      const st = (E.status[i] as number) & MASK;
      const owned = this.slotId[slot] === id;
      if (!owned && budget === 0) continue;
      if (!owned) {
        if (this.slotId[slot] !== 0) this.release(vfx, slot);
        this.slotId[slot] = id;
        if ((this.activePos[slot] as number) < 0) {
          const pos = this.activeN++;
          this.active[pos] = slot;
          this.activePos[slot] = pos;
        }
      }
      this.slotStamp[slot] = stamp;
      const px = E.px[i] as number, pz = E.pz[i] as number;
      const x = px + ((E.x[i] as number) - px) * alpha;
      const z = pz + ((E.z[i] as number) - pz) * alpha;
      const defs = world.typeDefs;
      const body = bodyOf(defs ? defs[E.type[i] as number]?.model : undefined);
      const bodyH = body[0] * (E.scale[i] as number || 1);
      const s = Math.min(3, Math.max(0.6, 0.5 * ((E.radius[i] as number) / BODY_R + bodyH / BODY_H)));
      const ground = heightAt(x, z);
      const head = ground + headY(bodyH, body[1]), torso = ground + torsoY(bodyH, body[1]), feet = ground + FEET_Y;
      const base = slot * KINDS;
      const phase = ((id * 0.6180339887) % 1) * 6.283185307179586;
      for (let k = 0; k < KINDS; k++) {
        const h = this.slotH[base + k] as number;
        const at = KIND_ANCHOR[k] === 0 ? head : KIND_ANCHOR[k] === 1 ? torso : feet;
        const y = at - (KIND_LIFT[k] as number);
        if ((st & (KIND_BITS[k] as number)) !== 0 && budget > 0) {
          budget--;
          if (h === 0 || (vfx.alive !== undefined && !vfx.alive(h))) {
            o.x = x;
            o.z = z;
            o.y = y;
            o.scale = s;
            o.duration = 0;
            // r3: a random yaw per enemy turns the stun stars' path (circle starting at angle 0) so a crowd stunned on one frame does not show the same star pattern
            o.rot = k === 0 ? phase : 0;
            this.slotH[base + k] = vfx.spawn(KIND_IDS[k] as string, o);
          } else vfx.move(h, x, z, y);
        } else if (h !== 0) {
          vfx.stop(h);
          this.slotH[base + k] = 0;
        }
      }
      if (this.candRise[c] === 1 && bursts < MAX_BURSTS && (this.slotH[base] as number) !== 0) {
        bursts++;
        o.x = x;
        o.z = z;
        o.y = head - BURST_LIFT;
        o.scale = s;
        o.duration = 0;
        o.rot = phase;
        vfx.spawn(BURST_ID, o);
      }
    }

    // 3. drop slots whose enemy lost its statuses, died, left the store or fell out of the budget
    for (let a = this.activeN - 1; a >= 0; a--) {
      const slot = this.active[a] as number;
      if (this.slotStamp[slot] === stamp && this.hasLoop(slot)) continue;
      this.release(vfx, slot);
      const last = --this.activeN;
      if (a !== last) {
        const moved = this.active[last] as number;
        this.active[a] = moved;
        this.activePos[moved] = a;
      }
      this.activePos[slot] = -1;
    }
  }

  reset(): void {
    for (let a = 0; a < this.activeN; a++) {
      const slot = this.active[a] as number;
      this.slotId[slot] = 0;
      this.slotH.fill(0, slot * KINDS, slot * KINDS + KINDS);
      this.activePos[slot] = -1;
    }
    this.activeN = 0;
    if (this.keysUsed > 0) {
      this.keys.fill(Infinity, 0, this.keysUsed);
      this.keysUsed = 0;
    }
    this.prevId.fill(0);
    this.prevMask.fill(0);
  }

  private hasLoop(slot: number): boolean {
    const base = slot * KINDS;
    for (let k = 0; k < KINDS; k++) if ((this.slotH[base + k] as number) !== 0) return true;
    return false;
  }

  private release(vfx: Vfx, slot: number): void {
    const base = slot * KINDS;
    for (let k = 0; k < KINDS; k++) {
      const h = this.slotH[base + k] as number;
      if (h !== 0) vfx.stop(h);
      this.slotH[base + k] = 0;
    }
    this.slotId[slot] = 0;
  }

  private grow(cap: number, used: number): void {
    const row = new Int32Array(cap);
    row.set(this.candRow);
    this.candRow = row;
    const rise = new Uint8Array(cap);
    rise.set(this.candRise);
    this.candRise = rise;
    const keys = new Float64Array(cap).fill(Infinity);
    const copy = Math.min(this.keys.length, Math.max(this.keysUsed, used));
    keys.set(this.keys.subarray(0, copy));
    this.keys = keys;
  }
}
