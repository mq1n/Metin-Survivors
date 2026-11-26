// Snapshot payload encoder (host) and decoder (guest). The 16-byte frame header is @ms/shared's; this file owns the payload.
//
// Payload sections, in order (all little-endian, see ./tables.ts for the entity table layout):
//   strings   varuint styleFrom, varuint n, n × str  (world.strings names = projectile style ids)
//             varuint wireFrom,  varuint n, n × str  (event / hud strings)
//   world     u8 corruption, u8 darkness, u8 maxCorruption                      (× 1/255)
//   players   u8 n, n × player record
//   modals    u8 n, n × ( u8 player, varuint modalId, u16 waited × 10 )          pending card modals (pause + auto-pick clocks)
//   tables    enemies, projectiles, pickups, telegraphs
//   metins    u8 n, n × record            bosses  u8 n, n × record
//   hud       u8 present, [per-player loadout / budgets / damage meter, next boss, dps]    ~2 Hz
//   events    varuint count, varuint byteLength, bytes                                    see ./events.ts

import { SnapshotFlags, SNAPSHOT_HEADER_BYTES, readSnapshotHeader, type SnapshotHeader } from '@ms/shared';

import { cooldownFrac } from '../../sim/skills';
import { EnemyFlag, type PlayerState } from '../../sim/stores';
import { MetinPhase } from '../../sim/types';
import type { World } from '../../sim/world';
import { ByteReader, ByteWriter, DecodeError } from './bytes';
import type { EventBlock, WireStrings } from './events';
import {
  ENEMY_COL,
  ENEMY_SPEC,
  HERO_CLIPS,
  INTEREST_ENTER,
  INTEREST_LEAVE,
  KEYFRAME_BUDGET,
  MAX_PICKUPS,
  MAX_PROJECTILES,
  packTier,
  PICKUP_COL,
  PICKUP_SPEC,
  PROJ_COL,
  PROJ_SPEC,
  RATE_MID,
  RATE_NEAR,
  SNAPSHOT_BUDGET,
  TELE_COL,
  TELE_SPEC,
  type BossWire,
  type HudPlayerWire,
  type HudWire,
  type MetinWire,
  type ModalWire,
  type PlayerAck,
  type PlayerWire,
} from './protocol';
import { dqang, dqpos, netId, qang, qpos } from './quant';
import { decodeTable, PRIO_FAR, PRIO_MID, PRIO_NEAR, TableEncoder, TableState } from './tables';

const SLOT_MASK = 0xffff;

function q8(v: number, scale: number): number {
  const q = Math.round(v * scale);
  return q < 0 ? 0 : q > 255 ? 255 : q;
}
function q16(v: number, scale: number): number {
  const q = Math.round(v * scale);
  return q < 0 ? 0 : q > 0xffff ? 0xffff : q;
}
function qs16(v: number, scale: number): number {
  const q = Math.round(v * scale);
  return q < -32768 ? -32768 : q > 32767 ? 32767 : q;
}
function vint(v: number): number {
  return !(v > 0) ? 0 : v > 4e9 ? 4e9 : Math.round(v);
}

export interface EncodeOptions {
  keyframe: boolean;
  paused: boolean;
  final: boolean;
  acks: readonly PlayerAck[];
  /** include the hud section even when it is not due (host decides cadence) */
  hud: boolean;
  events: EventBlock;
}

export interface EncodedSnapshot {
  header: Omit<SnapshotHeader, 'epoch'>;
  payload: Uint8Array;
  stats: SnapshotStats;
}

export interface SnapshotStats {
  bytes: number;
  keyframe: boolean;
  enemies: number;
  projectiles: number;
  pickups: number;
  telegraphs: number;
  enemyBytes: number;
  projectileBytes: number;
  pickupBytes: number;
  eventBytes: number;
  eventCount: number;
  playerBytes: number;
  deferred: number;
}

// ---------------------------------------------------------------------------
// Host side

export class SnapshotEncoder {
  readonly enemies = new TableEncoder(ENEMY_SPEC);
  readonly projectiles = new TableEncoder(PROJ_SPEC);
  readonly pickups = new TableEncoder(PICKUP_SPEC);
  readonly telegraphs = new TableEncoder(TELE_SPEC);
  seq = 0;
  /** snapshots emitted (drives the rate classes) */
  private n = 0;
  private styleSent = 0;
  private readonly out = new ByteWriter(24 * 1024);
  private readonly body = new ByteWriter(24 * 1024);
  private readonly ax: number[] = [];
  private readonly az: number[] = [];
  private readonly d2 = new Float32Array(1500);
  private readonly sortBuf = new Float32Array(1500);
  private readonly animToggle = new Uint8Array(ENEMY_SPEC.capacity);
  private readonly animLast = new Float32Array(ENEMY_SPEC.capacity);
  private readonly animOwner = new Uint16Array(ENEMY_SPEC.capacity);

  constructor(
    readonly world: World,
    readonly strings: WireStrings,
  ) {}

  /** Encodes the current world state. `keyframe: true` resets every table so that any receiver can start from this frame. */
  encode(o: EncodeOptions): EncodedSnapshot {
    const w = this.world;
    const body = this.body;
    body.reset();
    const stats: SnapshotStats = {
      bytes: 0,
      keyframe: o.keyframe,
      enemies: 0,
      projectiles: 0,
      pickups: 0,
      telegraphs: 0,
      enemyBytes: 0,
      projectileBytes: 0,
      pickupBytes: 0,
      eventBytes: 0,
      eventCount: 0,
      playerBytes: 0,
      deferred: 0,
    };

    // world
    body.u8(q8(w.corruption, 255));
    body.u8(q8(w.darkness, 255));
    body.u8(q8(w.maxCorruption, 255));

    // players
    const p0 = body.pos;
    const players = w.players;
    body.u8(players.length);
    for (let i = 0; i < players.length; i++) this.writePlayer(body, players[i] as PlayerState, o.acks[i] as PlayerAck);
    stats.playerBytes = body.pos - p0;

    // modals
    let nm = 0;
    for (const m of w.modals) if (m.kind !== 'runEnd') nm++;
    body.u8(nm);
    for (const m of w.modals) {
      if (m.kind === 'runEnd') continue;
      body.u8(m.player);
      body.varuint(m.id);
      body.u16(q16(m.waited, 10));
    }

    // interest centres
    this.ax.length = 0;
    this.az.length = 0;
    for (const p of players) {
      if (p.alive) {
        this.ax.push(p.x);
        this.az.push(p.z);
      }
    }
    if (this.ax.length === 0) {
      for (const p of players) {
        this.ax.push(p.x);
        this.az.push(p.z);
      }
    }

    this.fillEnemies();
    this.fillProjectiles();
    this.fillPickups();
    this.fillTelegraphs();

    const budget = o.keyframe ? KEYFRAME_BUDGET : SNAPSHOT_BUDGET;
    const idx = this.n++;
    const eb = Math.floor(budget * 0.55);
    const es = this.enemies.encode(body, o.keyframe, idx, eb);
    stats.enemies = this.enemies.sent.count;
    stats.enemyBytes = es.bytes;
    const ps = this.projectiles.encode(body, o.keyframe, idx, Math.floor(budget * 0.2));
    stats.projectiles = this.projectiles.sent.count;
    stats.projectileBytes = ps.bytes;
    const ks = this.pickups.encode(body, o.keyframe, idx, Math.floor(budget * 0.1));
    stats.pickups = this.pickups.sent.count;
    stats.pickupBytes = ks.bytes;
    this.telegraphs.encode(body, o.keyframe, idx, Math.floor(budget * 0.05));
    stats.telegraphs = this.telegraphs.sent.count;
    stats.deferred = es.deferred + ps.deferred + ks.deferred;

    this.writeMetins(body);
    this.writeBosses(body);

    if (o.hud || o.keyframe) {
      body.u8(1);
      this.writeHud(body, o.acks);
    } else {
      body.u8(0);
    }

    body.varuint(o.events.count);
    body.varuint(o.events.bytes.length);
    body.bytes(o.events.bytes);
    stats.eventBytes = o.events.bytes.length;
    stats.eventCount = o.events.count;

    // strings go first on the wire but were only complete now (hud / events intern lazily)
    const out = this.out;
    out.reset();
    const styles = w.strings.names;
    const styleFrom = o.keyframe ? 0 : this.styleSent;
    out.varuint(styleFrom);
    out.varuint(styles.length - styleFrom);
    for (let i = styleFrom; i < styles.length; i++) out.str(styles[i] as string);
    this.styleSent = styles.length;
    const wire = this.strings;
    const wireFrom = o.keyframe ? 0 : wire.sent;
    out.varuint(wireFrom);
    out.varuint(wire.names.length - wireFrom);
    for (let i = wireFrom; i < wire.names.length; i++) out.str(wire.names[i] as string);
    wire.sent = wire.names.length;
    out.bytes(body.view());

    const flags =
      (o.keyframe ? SnapshotFlags.keyframe : SnapshotFlags.delta) | (o.paused ? SnapshotFlags.paused : 0) | (o.final ? SnapshotFlags.final : 0);
    const header = { flags, seq: this.seq, tick: w.tick, baseDelta: o.keyframe ? 0 : 1 };
    this.seq = (this.seq + 1) >>> 0;
    stats.bytes = out.pos + SNAPSHOT_HEADER_BYTES;
    return { header, payload: out.copy(), stats };
  }

  // ---- players -----------------------------------------------------------------------------------------------------

  private writePlayer(w: ByteWriter, p: PlayerState, ack: PlayerAck): void {
    w.u8((p.alive ? 1 : 0) | (ack.connected ? 2 : 0));
    w.u16(qpos(p.x));
    w.u16(qpos(p.z));
    w.i16(qs16(p.vx, 128));
    w.i16(qs16(p.vz, 128));
    w.i16(qs16(p.kvx, 128));
    w.i16(qs16(p.kvz, 128));
    if (p.dashT > 0) {
      w.u8(Math.max(1, q8(p.dashT, 200)));
      w.i16(qs16(p.dashVx, 32));
      w.i16(qs16(p.dashVz, 32));
    } else {
      w.u8(0);
    }
    w.u8(qang(p.rot));
    const clip = HERO_CLIPS.indexOf(p.clip);
    w.u8(clip < 0 ? 0 : clip);
    w.u16(q16(p.stats.moveSpeed, 100));
    w.u8(q8(p.slowMul, 255));
    w.u8(q8(p.corrupted, 255));
    w.u16(Math.min(0xffff, vint(p.hp)));
    w.u16(Math.min(0xffff, vint(p.hpMax)));
    // the guest sees one bar: trinket shield + skill ward (DESIGN M2, no new wire field)
    w.u16(Math.min(0xffff, vint(p.shield + p.ward)));
    w.varuint(p.level);
    w.varuint(vint(p.xp));
    w.varuint(vint(p.xpNext));
    w.varuint(vint(p.yeop));
    w.varuint(p.shards);
    w.varuint(p.kills);
    w.varuint(ack.seq);
    w.u8(Math.min(255, ack.age));
    w.u8(ack.hudVer & 255);
    const n = Math.min(16, p.skills.length);
    w.u8(n);
    for (let i = 0; i < n; i++) w.u8(q8(cooldownFrac(p.skills[i] as PlayerState['skills'][number]), 255));
  }

  // ---- table fillers -------------------------------------------------------------------------------------------------

  private nearest2(x: number, z: number): number {
    let best = Infinity;
    const ax = this.ax;
    const az = this.az;
    for (let i = 0; i < ax.length; i++) {
      const dx = x - (ax[i] as number);
      const dz = z - (az[i] as number);
      const d = dx * dx + dz * dz;
      if (d < best) best = d;
    }
    return best;
  }

  private fillEnemies(): void {
    const E = this.world.enemies;
    const T = this.enemies;
    T.beginFrame();
    const cur = T.cur;
    const cols = cur.cols;
    const enter2 = INTEREST_ENTER * INTEREST_ENTER;
    const leave2 = INTEREST_LEAVE * INTEREST_LEAVE;
    const near2 = RATE_NEAR * RATE_NEAR;
    const mid2 = RATE_MID * RATE_MID;
    const sent = T.sent;
    for (let i = 0; i < E.count; i++) {
      const flags = E.flags[i] as number;
      if ((flags & EnemyFlag.Metin) !== 0) continue;
      const handle = E.id[i] as number;
      const slot = handle & SLOT_MASK;
      const nid = netId(handle);
      const d2 = this.nearest2(E.x[i] as number, E.z[i] as number);
      const known = sent.present[slot] === 1 && sent.id[slot] === nid;
      if (d2 > (known ? leave2 : enter2)) continue;
      cur.put(slot, nid);
      (cols[ENEMY_COL.x] as Uint16Array)[slot] = qpos(E.x[i] as number);
      (cols[ENEMY_COL.z] as Uint16Array)[slot] = qpos(E.z[i] as number);
      (cols[ENEMY_COL.rot] as Uint16Array)[slot] = qang(E.rot[i] as number);
      const animT = E.animT[i] as number;
      if (this.animOwner[slot] !== nid) {
        this.animOwner[slot] = nid;
        this.animToggle[slot] = 0;
        this.animLast[slot] = animT;
      } else if (animT < (this.animLast[slot] as number) - 1e-4) {
        this.animToggle[slot] = (this.animToggle[slot] as number) ^ 1;
      }
      this.animLast[slot] = animT;
      (cols[ENEMY_COL.clip] as Uint16Array)[slot] = ((E.animClip[i] as number) & 0x7f) | ((this.animToggle[slot] as number) << 7);
      const hpMax = E.hpMax[i] as number;
      const hp = E.hp[i] as number;
      (cols[ENEMY_COL.hp] as Uint16Array)[slot] = hpMax > 0 ? Math.max(hp > 0 ? 1 : 0, q8(hp / hpMax, 255)) : 0;
      (cols[ENEMY_COL.status] as Uint16Array)[slot] = (E.status[i] as number) & 0xff;
      (cols[ENEMY_COL.flags] as Uint16Array)[slot] = flags & 0xff;
      (cols[ENEMY_COL.corr] as Uint16Array)[slot] = q8(E.corrupted[i] as number, 15);
      (cols[ENEMY_COL.scale] as Uint16Array)[slot] = q8(E.scale[i] as number, 32);
      (cols[ENEMY_COL.tier] as Uint16Array)[slot] = packTier(E.eliteTier[i] as number, E.affix[i] as number);
      (cols[ENEMY_COL.type] as Uint16Array)[slot] = E.type[i] as number;
      T.prio[slot] = (flags & (EnemyFlag.Boss | EnemyFlag.Elite)) !== 0 || d2 <= near2 ? PRIO_NEAR : d2 <= mid2 ? PRIO_MID : PRIO_FAR;
    }
  }

  /** squared-distance threshold that keeps at most `max` of the first `n` entries of `this.d2` */
  private capThreshold(n: number, max: number, hardLimit2: number): number {
    if (n <= max) return hardLimit2;
    const buf = this.sortBuf.subarray(0, n);
    buf.set(this.d2.subarray(0, n));
    buf.sort();
    return Math.min(hardLimit2, buf[max - 1] as number);
  }

  private fillProjectiles(): void {
    const P = this.world.projectiles;
    const T = this.projectiles;
    T.beginFrame();
    const cur = T.cur;
    const cols = cur.cols;
    const lim = INTEREST_LEAVE * INTEREST_LEAVE;
    const n = P.count;
    for (let i = 0; i < n; i++) this.d2[i] = this.nearest2(P.x[i] as number, P.z[i] as number);
    const th = this.capThreshold(n, MAX_PROJECTILES, lim);
    const near2 = RATE_NEAR * RATE_NEAR;
    for (let i = 0; i < n; i++) {
      const d2 = this.d2[i] as number;
      if (d2 > th) continue;
      const handle = P.id[i] as number;
      const slot = handle & SLOT_MASK;
      cur.put(slot, netId(handle));
      (cols[PROJ_COL.x] as Uint16Array)[slot] = qpos(P.x[i] as number);
      (cols[PROJ_COL.z] as Uint16Array)[slot] = qpos(P.z[i] as number);
      (cols[PROJ_COL.rot] as Uint16Array)[slot] = qang(P.rot[i] as number);
      (cols[PROJ_COL.h] as Uint16Array)[slot] = q8(P.h[i] as number, 32);
      (cols[PROJ_COL.kind] as Uint16Array)[slot] = ((P.kind[i] as number) & 0x7f) | ((P.hostile[i] as number) !== 0 ? 0x80 : 0);
      (cols[PROJ_COL.style] as Uint16Array)[slot] = P.style[i] as number;
      (cols[PROJ_COL.radius] as Uint16Array)[slot] = q8(P.radius[i] as number, 32);
      T.prio[slot] = d2 <= near2 ? PRIO_NEAR : d2 <= RATE_MID * RATE_MID ? PRIO_MID : PRIO_FAR;
    }
  }

  private fillPickups(): void {
    const P = this.world.pickups;
    const T = this.pickups;
    T.beginFrame();
    const cur = T.cur;
    const cols = cur.cols;
    const lim = INTEREST_LEAVE * INTEREST_LEAVE;
    const n = P.count;
    for (let i = 0; i < n; i++) this.d2[i] = this.nearest2(P.x[i] as number, P.z[i] as number);
    const th = this.capThreshold(n, MAX_PICKUPS, lim);
    for (let i = 0; i < n; i++) {
      const d2 = this.d2[i] as number;
      if (d2 > th) continue;
      const handle = P.id[i] as number;
      const slot = handle & SLOT_MASK;
      cur.put(slot, netId(handle));
      (cols[PICKUP_COL.x] as Uint16Array)[slot] = qpos(P.x[i] as number);
      (cols[PICKUP_COL.z] as Uint16Array)[slot] = qpos(P.z[i] as number);
      (cols[PICKUP_COL.h] as Uint16Array)[slot] = q8(P.h[i] as number, 64);
      (cols[PICKUP_COL.magnet] as Uint16Array)[slot] = P.magnet[i] as number;
      (cols[PICKUP_COL.kind] as Uint16Array)[slot] = P.kind[i] as number;
      (cols[PICKUP_COL.tier] as Uint16Array)[slot] = P.tier[i] as number;
      T.prio[slot] = (P.magnet[i] as number) !== 0 ? PRIO_NEAR : PRIO_MID;
    }
  }

  private fillTelegraphs(): void {
    const G = this.world.telegraphs;
    const T = this.telegraphs;
    T.beginFrame();
    const cur = T.cur;
    const cols = cur.cols;
    for (let i = 0; i < G.count; i++) {
      const handle = G.id[i] as number;
      const slot = handle & SLOT_MASK;
      cur.put(slot, netId(handle));
      (cols[TELE_COL.x] as Uint16Array)[slot] = qpos(G.x[i] as number);
      (cols[TELE_COL.z] as Uint16Array)[slot] = qpos(G.z[i] as number);
      (cols[TELE_COL.progress] as Uint16Array)[slot] = q8(G.progress[i] as number, 255);
      (cols[TELE_COL.rot] as Uint16Array)[slot] = qang(G.rot[i] as number);
      (cols[TELE_COL.shape] as Uint16Array)[slot] = ((G.shape[i] as number) & 15) | (((G.owner[i] as number) & 15) << 4);
      (cols[TELE_COL.radius] as Uint16Array)[slot] = q16(G.radius[i] as number, 32);
      (cols[TELE_COL.length] as Uint16Array)[slot] = q16(G.length[i] as number, 32);
      (cols[TELE_COL.width] as Uint16Array)[slot] = q16(G.width[i] as number, 64);
      (cols[TELE_COL.dur] as Uint16Array)[slot] = q16(G.dur[i] as number, 100);
      T.prio[slot] = PRIO_NEAR;
    }
  }

  // ---- metins / bosses / hud -----------------------------------------------------------------------------------------

  private writeMetins(w: ByteWriter): void {
    const list = this.world.metins.filter((m) => m.phase !== MetinPhase.Broken || m.phaseT < 2.3);
    w.u8(Math.min(32, list.length));
    for (let i = 0; i < Math.min(32, list.length); i++) {
      const m = list[i] as World['metins'][number];
      w.varuint(m.id);
      w.u8(m.type);
      w.u16(qpos(m.x));
      w.u16(qpos(m.z));
      w.u8((m.phase & 3) | (m.great ? 4 : 0));
      w.u8(q8(m.hpFrac, 255));
      w.u8(q8(m.scale, 32));
      w.u8(q8(m.auraRadius, 4));
      w.u16(q16(m.phaseT, 100));
      w.u16(q16(m.warnLeft, 100));
    }
  }

  private writeBosses(w: ByteWriter): void {
    const world = this.world;
    const list = world.bosses.filter((b) => !b.dead);
    w.u8(Math.min(8, list.length));
    for (let i = 0; i < Math.min(8, list.length); i++) {
      const b = list[i] as World['bosses'][number];
      const row = world.enemies.find(b.enemy);
      w.varuint(b.id);
      w.varuint(this.strings.intern(b.def.id));
      w.u16(row >= 0 ? netId(b.enemy) : 0xffff);
      w.u8(b.phase);
      w.u8((b.enraged ? 1 : 0) | (b.final ? 2 : 0));
      w.f32(row >= 0 ? (world.enemies.hp[row] as number) : 0);
      w.f32(row >= 0 ? (world.enemies.hpMax[row] as number) : 1);
      w.u16(qpos(row >= 0 ? (world.enemies.x[row] as number) : 0));
      w.u16(qpos(row >= 0 ? (world.enemies.z[row] as number) : 0));
    }
  }

  private writeHud(w: ByteWriter, acks: readonly PlayerAck[]): void {
    const world = this.world;
    const S = this.strings;
    const players = world.players;
    for (let i = 0; i < players.length; i++) {
      const p = players[i] as PlayerState;
      w.u8((acks[i] as PlayerAck).hudVer & 255);
      const ns = Math.min(16, p.skills.length);
      w.u8(ns);
      for (let k = 0; k < ns; k++) {
        const s = p.skills[k] as PlayerState['skills'][number];
        w.varuint(S.intern(s.def.id));
        w.u8((s.rank & 15) | (s.basic ? 16 : 0));
      }
      const np = Math.min(24, p.passives.length);
      w.u8(np);
      for (let k = 0; k < np; k++) {
        const x = p.passives[k] as PlayerState['passives'][number];
        w.varuint(S.intern(x.id));
        w.u8(x.rank);
      }
      for (const s of p.stones) {
        if (s) {
          w.u8(1);
          w.varuint(S.intern(s.id));
          w.u8(s.level);
        } else {
          w.u8(0);
        }
      }
      for (const t of p.trinkets) {
        if (t) {
          w.u8(1);
          w.varuint(S.intern(t.id));
          w.u8(t.rank);
        } else {
          w.u8(0);
        }
      }
      w.u8(Math.min(255, p.rerolls));
      w.u8(Math.min(255, p.banishes));
      w.u8(Math.min(255, p.skips));
      const dmg = p.skills
        .map((s) => ({ id: s.def.id, rank: s.rank, damage: s.damage }))
        .sort((a, b) => b.damage - a.damage)
        .slice(0, 8);
      w.u8(dmg.length);
      for (const d of dmg) {
        w.varuint(S.intern(d.id));
        w.u8(d.rank);
        w.f32(d.damage);
      }
    }
    // next boss
    const sp = world.spawner;
    const next = sp.bosses[sp.nextBoss];
    if (next) {
      w.u8(1);
      w.f32(next.at);
      w.varuint(S.intern(next.boss));
    } else if (world.time < world.zone.final.at) {
      w.u8(1);
      w.f32(world.zone.final.at);
      w.varuint(S.intern(world.zone.final.boss));
    } else {
      w.u8(0);
    }
    w.f32(world.dps());
  }
}

// ---------------------------------------------------------------------------
// Guest side

export interface SnapshotFrame {
  seq: number;
  tick: number;
  /** sim seconds (tick / 60) */
  time: number;
  keyframe: boolean;
  paused: boolean;
  final: boolean;
  /** local arrival time (ms) */
  recvAt: number;
  corruption: number;
  darkness: number;
  maxCorruption: number;
  players: PlayerWire[];
  modals: ModalWire[];
  enemies: TableState;
  projectiles: TableState;
  pickups: TableState;
  telegraphs: TableState;
  metins: MetinWire[];
  bosses: BossWire[];
  hud: HudWire | null;
  eventCount: number;
  eventLen: number;
  eventBytes: Uint8Array;
  /** total frame size on the wire */
  bytes: number;
}

function newFrame(): SnapshotFrame {
  return {
    seq: 0,
    tick: 0,
    time: 0,
    keyframe: false,
    paused: false,
    final: false,
    recvAt: 0,
    corruption: 0,
    darkness: 0,
    maxCorruption: 0,
    players: [],
    modals: [],
    enemies: new TableState(ENEMY_SPEC),
    projectiles: new TableState(PROJ_SPEC),
    pickups: new TableState(PICKUP_SPEC),
    telegraphs: new TableState(TELE_SPEC),
    metins: [],
    bosses: [],
    hud: null,
    eventCount: 0,
    eventLen: 0,
    eventBytes: new Uint8Array(4096),
    bytes: 0,
  };
}

const POOL = 40;
/** Hard ceilings for peer-supplied snapshot string tables and bounded collections (NET-03). */
export const MAX_WIRE_STRINGS = 2048;
export const MAX_WIRE_STRING_BYTES = 128 * 1024;
const MAX_SNAPSHOT_MODALS = 64;
const MAX_SNAPSHOT_METINS = 32;
const MAX_SNAPSHOT_BOSSES = 8;
const MAX_SNAPSHOT_EVENTS = 2048;

export class SnapshotDecoder {
  /** running state (identical to the host encoder's `sent` tables after every applied snapshot) */
  readonly enemies = new TableState(ENEMY_SPEC);
  readonly projectiles = new TableState(PROJ_SPEC);
  readonly pickups = new TableState(PICKUP_SPEC);
  readonly telegraphs = new TableState(TELE_SPEC);
  /** host `world.strings.names` (projectile style ids) */
  readonly styleNames: string[] = [];
  /** event / hud strings */
  readonly wireNames: string[] = [];
  /** true until a keyframe has been applied, and again after a gap */
  needKeyframe = true;
  lastSeq = -1;
  private styleBytes = 0;
  private wireBytes = 0;
  private readonly pool: SnapshotFrame[] = [];
  private next = 0;

  constructor() {
    for (let i = 0; i < POOL; i++) this.pool.push(newFrame());
  }

  /**
   * Decodes one complete frame (header + payload). Returns null when the frame cannot be applied (not a snapshot, delta
   * without base, sequence gap) — `needKeyframe` tells the caller to ask for a keyframe. Throws DecodeError on corruption
   * without mutating any existing decoder state.
   * The returned frame is pooled: it stays valid for POOL further decodes.
   */
  decode(frame: ArrayBuffer, recvAt: number): SnapshotFrame | null {
    const h = readSnapshotHeader(frame);
    if (!h) return null;
    const keyframe = (h.flags & SnapshotFlags.keyframe) !== 0;
    if (!keyframe) {
      if (this.needKeyframe) return null;
      if (h.seq !== ((this.lastSeq + 1) >>> 0)) {
        this.needKeyframe = true;
        return null;
      }
    }
    const r = new ByteReader(new Uint8Array(frame), SNAPSHOT_HEADER_BYTES);
    const f = this.pool[this.next % POOL] as SnapshotFrame;
    try {
      this.readPayload(r, keyframe, f);
    } catch (e) {
      this.needKeyframe = true;
      throw e;
    }
    this.next++;
    f.seq = h.seq;
    f.tick = h.tick;
    f.time = h.tick / 60;
    f.keyframe = keyframe;
    f.paused = (h.flags & SnapshotFlags.paused) !== 0;
    f.final = (h.flags & SnapshotFlags.final) !== 0;
    f.recvAt = recvAt;
    f.bytes = frame.byteLength;
    this.enemies.copyFrom(f.enemies);
    this.projectiles.copyFrom(f.projectiles);
    this.pickups.copyFrom(f.pickups);
    this.telegraphs.copyFrom(f.telegraphs);
    this.lastSeq = h.seq;
    this.needKeyframe = false;
    return f;
  }

  private readStringTable(
    r: ByteReader,
    keyframe: boolean,
    existing: readonly string[],
    existingBytes: number,
    label: string,
  ): { appended: string[]; totalBytes: number } {
    const from = r.varuint();
    const count = r.varuint();
    if (keyframe) {
      if (from !== 0) throw new DecodeError(`${label}: keyframe offset ${from} must be 0`);
    } else if (from !== existing.length) {
      throw new DecodeError(`${label}: non-contiguous offset ${from} (expected ${existing.length})`);
    }
    if (count > MAX_WIRE_STRINGS || from + count > MAX_WIRE_STRINGS) {
      throw new DecodeError(`${label}: table size ${from + count} exceeds limit ${MAX_WIRE_STRINGS}`);
    }
    // Every encoded string starts with a 2-byte length prefix.
    if (count * 2 > r.remaining) {
      throw new DecodeError(`${label}: count ${count} exceeds remaining bytes`);
    }
    let totalBytes = keyframe ? 0 : existingBytes;
    const appended: string[] = [];
    for (let i = 0; i < count; i++) {
      const start = r.pos;
      const s = r.str();
      totalBytes += r.pos - start - 2;
      if (totalBytes > MAX_WIRE_STRING_BYTES) {
        throw new DecodeError(`${label}: total bytes ${totalBytes} exceeds limit ${MAX_WIRE_STRING_BYTES}`);
      }
      appended.push(s);
    }
    return { appended, totalBytes };
  }

  private readPayload(r: ByteReader, keyframe: boolean, f: SnapshotFrame): void {
    // strings — staged first so a malformed frame never mutates existing tables
    const styleRes = this.readStringTable(r, keyframe, this.styleNames, this.styleBytes, 'styleNames');
    const wireRes = this.readStringTable(r, keyframe, this.wireNames, this.wireBytes, 'wireNames');
    const wireNameOf = (id: number): string => {
      const s = keyframe
        ? wireRes.appended[id]
        : id < this.wireNames.length
          ? this.wireNames[id]
          : wireRes.appended[id - this.wireNames.length];
      if (s === undefined) throw new DecodeError(`unknown wire string ${id}`);
      return s;
    };
    // world
    f.corruption = r.u8() / 255;
    f.darkness = r.u8() / 255;
    f.maxCorruption = r.u8() / 255;
    // players
    const np = r.u8();
    if (np > 4) throw new DecodeError(`${np} players`);
    f.players.length = 0;
    for (let i = 0; i < np; i++) f.players.push(readPlayer(r));
    // modals
    const nm = r.u8();
    if (nm > MAX_SNAPSHOT_MODALS) throw new DecodeError(`${nm} modals`);
    f.modals.length = 0;
    for (let i = 0; i < nm; i++) f.modals.push({ player: r.u8(), id: r.varuint(), waited: r.u16() / 10 });
    // tables — decoded into staged frame tables so a failure never corrupts running decoder state
    if (!keyframe) {
      f.enemies.copyFrom(this.enemies);
      f.projectiles.copyFrom(this.projectiles);
      f.pickups.copyFrom(this.pickups);
      f.telegraphs.copyFrom(this.telegraphs);
    }
    decodeTable(r, f.enemies, keyframe);
    decodeTable(r, f.projectiles, keyframe);
    decodeTable(r, f.pickups, keyframe);
    decodeTable(r, f.telegraphs, keyframe);
    // metins
    const nMetin = r.u8();
    if (nMetin > MAX_SNAPSHOT_METINS) throw new DecodeError(`${nMetin} metins`);
    f.metins.length = 0;
    for (let i = 0; i < nMetin; i++) {
      const id = r.varuint();
      const type = r.u8();
      const x = dqpos(r.u16());
      const z = dqpos(r.u16());
      const pg = r.u8();
      f.metins.push({
        id,
        type,
        x,
        z,
        phase: pg & 3,
        great: (pg & 4) !== 0,
        hpFrac: r.u8() / 255,
        scale: r.u8() / 32,
        auraRadius: r.u8() / 4,
        phaseT: r.u16() / 100,
        warnLeft: r.u16() / 100,
      });
    }
    // bosses
    const nBoss = r.u8();
    if (nBoss > MAX_SNAPSHOT_BOSSES) throw new DecodeError(`${nBoss} bosses`);
    f.bosses.length = 0;
    for (let i = 0; i < nBoss; i++) {
      const id = r.varuint();
      const bossId = wireNameOf(r.varuint());
      const enemy = r.u16();
      const phase = r.u8();
      const fl = r.u8();
      f.bosses.push({
        id,
        bossId,
        enemy,
        phase,
        enraged: (fl & 1) !== 0,
        final: (fl & 2) !== 0,
        hp: r.f32(),
        hpMax: r.f32(),
        x: dqpos(r.u16()),
        z: dqpos(r.u16()),
      });
    }
    // hud
    const hasHud = r.u8();
    if (hasHud > 1) throw new DecodeError(`invalid hud flag ${hasHud}`);
    f.hud = hasHud === 1 ? this.readHud(r, np, wireNameOf) : null;
    // events
    const eventCount = r.varuint();
    const len = r.varuint();
    if (len > r.remaining) throw new DecodeError('event block overruns the frame');
    if (eventCount > MAX_SNAPSHOT_EVENTS || eventCount > len) throw new DecodeError(`invalid event count ${eventCount} for ${len} bytes`);
    if (f.eventBytes.length < len) f.eventBytes = new Uint8Array(Math.max(len, f.eventBytes.length * 2));
    f.eventBytes.set(r.buf.subarray(r.pos, r.pos + len));
    f.eventCount = eventCount;
    f.eventLen = len;
    r.skip(len);

    // Commit validated string tables only after the full frame decoded cleanly.
    if (keyframe) {
      this.styleNames.length = 0;
      this.wireNames.length = 0;
    }
    for (let i = 0; i < styleRes.appended.length; i++) this.styleNames.push(styleRes.appended[i] as string);
    this.styleBytes = styleRes.totalBytes;
    for (let i = 0; i < wireRes.appended.length; i++) this.wireNames.push(wireRes.appended[i] as string);
    this.wireBytes = wireRes.totalBytes;
  }

  private readHud(r: ByteReader, nPlayers: number, wireNameOf: (id: number) => string): HudWire {
    const players: HudPlayerWire[] = [];
    for (let i = 0; i < nPlayers; i++) {
      const ver = r.u8();
      const ns = r.u8();
      if (ns > 16) throw new DecodeError(`${ns} hud skills`);
      const skills: HudPlayerWire['skills'] = [];
      for (let k = 0; k < ns; k++) {
        const id = wireNameOf(r.varuint());
        const rb = r.u8();
        skills.push({ id, rank: rb & 15, basic: (rb & 16) !== 0 });
      }
      const npas = r.u8();
      if (npas > 24) throw new DecodeError(`${npas} hud passives`);
      const passives: HudPlayerWire['passives'] = [];
      for (let k = 0; k < npas; k++) passives.push({ id: wireNameOf(r.varuint()), rank: r.u8() });
      const stones: HudPlayerWire['stones'] = [];
      for (let k = 0; k < 6; k++) {
        const present = r.u8();
        if (present > 1) throw new DecodeError(`invalid stone flag ${present}`);
        stones.push(present === 1 ? { id: wireNameOf(r.varuint()), level: r.u8() } : null);
      }
      const trinkets: HudPlayerWire['trinkets'] = [];
      for (let k = 0; k < 3; k++) {
        const present = r.u8();
        if (present > 1) throw new DecodeError(`invalid trinket flag ${present}`);
        trinkets.push(present === 1 ? { id: wireNameOf(r.varuint()), rank: r.u8() } : null);
      }
      const rerolls = r.u8();
      const banishes = r.u8();
      const skips = r.u8();
      const nd = r.u8();
      if (nd > 8) throw new DecodeError(`${nd} hud dmg entries`);
      const dmg: HudPlayerWire['dmg'] = [];
      for (let k = 0; k < nd; k++) dmg.push({ skillId: wireNameOf(r.varuint()), rank: r.u8(), damage: r.f32() });
      players.push({ ver, skills, passives, stones, trinkets, rerolls, banishes, skips, dmg });
    }
    let nextBoss: HudWire['nextBoss'] = null;
    const hasNextBoss = r.u8();
    if (hasNextBoss > 1) throw new DecodeError(`invalid nextBoss flag ${hasNextBoss}`);
    if (hasNextBoss === 1) {
      const at = r.f32();
      nextBoss = { at, id: wireNameOf(r.varuint()) };
    }
    return { players, nextBoss, dps: r.f32() };
  }
}

function readPlayer(r: ByteReader): PlayerWire {
  const fl = r.u8();
  const x = dqpos(r.u16());
  const z = dqpos(r.u16());
  const vx = r.i16() / 128;
  const vz = r.i16() / 128;
  const kvx = r.i16() / 128;
  const kvz = r.i16() / 128;
  const dq = r.u8();
  let dashVx = 0;
  let dashVz = 0;
  if (dq > 0) {
    dashVx = r.i16() / 32;
    dashVz = r.i16() / 32;
  }
  const rot = dqang(r.u8());
  const clip = r.u8();
  const moveSpeed = r.u16() / 100;
  const slowMul = r.u8() / 255;
  const corrupted = r.u8() / 255;
  const hp = r.u16();
  const hpMax = r.u16();
  const shield = r.u16();
  const level = r.varuint();
  const xp = r.varuint();
  const xpNext = r.varuint();
  const yeop = r.varuint();
  const shards = r.varuint();
  const kills = r.varuint();
  const ackSeq = r.varuint();
  const ackAge = r.u8();
  const hudVer = r.u8();
  const n = r.u8();
  if (n > 16) throw new DecodeError(`${n} player cooldowns`);
  const cds: number[] = [];
  for (let i = 0; i < n; i++) cds.push(r.u8() / 255);
  return {
    alive: (fl & 1) !== 0,
    connected: (fl & 2) !== 0,
    x,
    z,
    vx,
    vz,
    kvx,
    kvz,
    dashT: dq / 200,
    dashVx,
    dashVz,
    rot,
    clip,
    moveSpeed,
    slowMul,
    corrupted,
    hp,
    hpMax,
    shield,
    level,
    xp,
    xpNext,
    yeop,
    shards,
    kills,
    ackSeq,
    ackAge,
    hudVer,
    cds,
  };
}
