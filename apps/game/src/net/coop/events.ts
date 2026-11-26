// SimEvent ⇄ compact bytes. The host collects `world.events` after EVERY tick (the objects are pooled), encodes them
// immediately into priority buffers, aggregates damage numbers, and attaches the result to the next snapshot frame; the
// transport is reliable and ordered, so the "reliable event channel" is simply those bytes riding the snapshot stream.
//
// Priorities (what gets dropped first when a snapshot is over its event budget):
//   0  never dropped: player death/revive, level-up, card picks, boss/metin/chest/story/run-end beats, run-event phases
//   1  gameplay feedback: player hits, pickups, heals, skill casts, telegraphs, elite/boss deaths, aggregated damage numbers
//   2  cosmetic: ordinary enemy deaths/spawns/attacks, vfx, sfx, shake, run-event channel progress

import type { EventBus, SimEvent } from '../../sim/events';
import { ByteReader, ByteWriter, DecodeError } from './bytes';
import { dqang, dqpos, netId, qang, qpos } from './quant';
import { EVENT_BUDGET } from './protocol';

/** host-side append-only string table for event/hud strings (skill ids, vfx presets, sfx ids…) */
export class WireStrings {
  readonly names: string[] = [];
  private readonly ids = new Map<string, number>();
  /** entries already shipped in a snapshot (host) */
  sent = 0;

  intern(s: string): number {
    let i = this.ids.get(s);
    if (i === undefined) {
      i = this.names.length;
      this.names.push(s);
      this.ids.set(s, i);
    }
    return i;
  }
}

const enum Ev {
  Damage = 1,
  EnemyDeath = 2,
  EnemySpawn = 3,
  EnemyAttack = 4,
  PlayerHit = 5,
  PlayerDeath = 6,
  PlayerRevive = 7,
  Heal = 8,
  LevelUp = 9,
  Pickup = 10,
  SkillCast = 11,
  CardPick = 12,
  Vfx = 13,
  Sfx = 14,
  Telegraph = 15,
  MetinWarn = 16,
  MetinImpact = 17,
  MetinAwaken = 18,
  MetinBreak = 19,
  BossSpawn = 20,
  BossPhase = 21,
  BossDeath = 22,
  ChestOpen = 23,
  ChestLocked = 24,
  Story = 25,
  Shake = 26,
  RunEnd = 27,
  RunEvent = 28,
}

/** wire order of SimEvent 'runEvent' phases */
const RUN_EVENT_PHASES = ['announce', 'active', 'end', 'channel'] as const;

const MAX_DAMAGE_NUMBERS = 40;
const CAPS = { death: 48, spawn: 6, attack: 16, vfx: 40, sfx: 24, shake: 4 };

function q8(v: number, scale: number): number {
  const q = Math.round(v * scale);
  return q < 0 ? 0 : q > 255 ? 255 : q;
}
function q16(v: number, scale: number): number {
  const q = Math.round(v * scale);
  return q < 0 ? 0 : q > 0xffff ? 0xffff : q;
}
function dir8(d: number): number {
  const q = Math.round(d * 127);
  return q < -127 ? -127 : q > 127 ? 127 : q;
}
function vint(v: number): number {
  return v < 0 ? 0 : v > 1e9 ? 1e9 : Math.round(v);
}

interface DamageAgg {
  netTarget: number;
  amount: number;
  x: number;
  z: number;
  flags: number;
  elementPlayer: number;
  skill: number;
}

class PriorityBuffer {
  readonly w = new ByteWriter(4096);
  readonly lens: number[] = [];
  count = 0;
  push(scratch: ByteWriter): void {
    this.w.bytes(scratch.view());
    this.lens.push(scratch.pos);
    this.count++;
  }
  reset(): void {
    this.w.reset();
    this.lens.length = 0;
    this.count = 0;
  }
}

export interface EventBlock {
  count: number;
  bytes: Uint8Array;
  dropped: number;
}

export class EventCollector {
  private readonly scratch = new ByteWriter(256);
  private readonly bufs = [new PriorityBuffer(), new PriorityBuffer(), new PriorityBuffer()];
  private readonly damage = new Map<number, DamageAgg>();
  private readonly counts = { death: 0, spawn: 0, attack: 0, vfx: 0, sfx: 0, shake: 0 };
  private readonly sfxSeen = new Map<number, number>();
  /** events dropped by caps/budget since the last flush */
  dropped = 0;
  /** lifetime counters (stats / tests) */
  totalDropped = 0;
  totalEvents = 0;
  /** set when the hud-relevant state changed (card picks, level-ups) */
  hudDirty = false;
  /** player indexes with a card pick since the last `takeCardPicks()` */
  private pickedPlayers = 0;

  constructor(private readonly strings: WireStrings) {}

  takeCardPicks(): number {
    const m = this.pickedPlayers;
    this.pickedPlayers = 0;
    return m;
  }

  collect(events: readonly SimEvent[]): void {
    for (let i = 0; i < events.length; i++) {
      const e = events[i] as SimEvent;
      this.totalEvents++;
      this.one(e);
    }
  }

  private emit(prio: 0 | 1 | 2): void {
    (this.bufs[prio] as PriorityBuffer).push(this.scratch);
  }

  private begin(t: number): ByteWriter {
    const w = this.scratch;
    w.reset();
    w.u8(t);
    return w;
  }

  private xz(w: ByteWriter, x: number, z: number): void {
    w.u16(qpos(x));
    w.u16(qpos(z));
  }

  private drop(): void {
    this.dropped++;
    this.totalDropped++;
  }

  private one(e: SimEvent): void {
    const S = this.strings;
    let w: ByteWriter;
    switch (e.t) {
      case 'damage': {
        const flags = (e.crit ? 1 : 0) | (e.killed ? 2 : 0) | (e.dot ? 4 : 0) | (e.boss ? 8 : 0);
        const key = ((netId(e.targetId) << 4) | flags) * 64 + ((e.player & 3) << 3) + (e.element & 7);
        const a = this.damage.get(key);
        if (a) {
          a.amount += e.amount;
          a.x = e.x;
          a.z = e.z;
          if (e.skill >= 0) a.skill = e.skill;
        } else {
          this.damage.set(key, {
            netTarget: netId(e.targetId),
            amount: e.amount,
            x: e.x,
            z: e.z,
            flags,
            elementPlayer: ((e.player & 3) << 4) | (e.element & 7),
            skill: e.skill,
          });
        }
        return;
      }
      case 'enemyDeath': {
        const important = e.tier >= 1;
        if (!important && this.counts.death++ >= CAPS.death) return this.drop();
        w = this.begin(Ev.EnemyDeath);
        w.u16(netId(e.id));
        w.u16(e.type);
        this.xz(w, e.x, e.z);
        w.u8(qang(e.rot));
        w.u8(q8(e.scale, 32));
        w.u8((e.tier & 15) | (e.crit ? 16 : 0));
        w.u8(e.killer + 1);
        w.u8(e.skill + 1);
        this.emit(important ? 1 : 2);
        return;
      }
      case 'enemySpawn': {
        if (this.counts.spawn++ >= CAPS.spawn && e.tier === 0) return this.drop();
        w = this.begin(Ev.EnemySpawn);
        w.u16(netId(e.enemy));
        w.u16(e.type);
        this.xz(w, e.x, e.z);
        w.u8(e.tier);
        w.u8(e.source);
        this.emit(e.tier > 0 ? 1 : 2);
        return;
      }
      case 'enemyAttack': {
        if (this.counts.attack++ >= CAPS.attack) return this.drop();
        w = this.begin(Ev.EnemyAttack);
        w.u16(netId(e.enemy));
        w.u16(e.type);
        w.u8(e.kind);
        this.xz(w, e.x, e.z);
        w.i8(dir8(e.dirX));
        w.i8(dir8(e.dirZ));
        this.emit(2);
        return;
      }
      case 'playerHit':
        w = this.begin(Ev.PlayerHit);
        w.u8(e.player);
        w.varuint(vint(e.amount));
        w.u8(e.result);
        this.xz(w, e.x, e.z);
        this.xz(w, e.srcX, e.srcZ);
        w.u8(e.element);
        w.varuint(vint(e.hp));
        this.emit(1);
        return;
      case 'playerDeath':
        w = this.begin(Ev.PlayerDeath);
        w.u8(e.player);
        this.xz(w, e.x, e.z);
        this.emit(0);
        return;
      case 'playerRevive':
        w = this.begin(Ev.PlayerRevive);
        w.u8(e.player);
        this.xz(w, e.x, e.z);
        w.u8(Math.max(0, Math.min(255, e.left)));
        this.emit(0);
        return;
      case 'heal':
        w = this.begin(Ev.Heal);
        w.u8(e.player);
        w.varuint(vint(e.amount));
        w.u8(e.source);
        this.emit(1);
        return;
      case 'levelUp':
        w = this.begin(Ev.LevelUp);
        w.u8(e.player);
        w.varuint(e.level);
        this.emit(0);
        this.hudDirty = true;
        return;
      case 'pickup':
        w = this.begin(Ev.Pickup);
        w.u8(e.player);
        w.u8(e.kind);
        w.varuint(vint(e.value));
        this.xz(w, e.x, e.z);
        w.u8(e.tier);
        this.emit(1);
        return;
      case 'skillCast':
        w = this.begin(Ev.SkillCast);
        w.u8(e.player);
        w.u8(e.skill);
        w.varuint(S.intern(e.skillId));
        w.varuint(S.intern(e.behavior));
        this.xz(w, e.x, e.z);
        w.i8(dir8(e.dirX));
        w.i8(dir8(e.dirZ));
        w.u16(q16(e.area, 100));
        w.u8((e.awakened ? 1 : 0) | (e.noHeroAnim ? 2 : 0));
        w.varuint(S.intern(e.heroClip));
        this.emit(1);
        return;
      case 'cardPick':
        w = this.begin(Ev.CardPick);
        w.u8(e.player);
        w.varuint(S.intern(e.kind));
        w.varuint(S.intern(e.id));
        w.varuint(S.intern(e.rarity));
        w.u8(e.rank);
        w.u8(e.awakening ? 1 : 0);
        this.emit(0);
        this.hudDirty = true;
        this.pickedPlayers |= 1 << e.player;
        return;
      case 'vfx': {
        const big = e.scale >= 3 || e.duration >= 1;
        if (!big && this.counts.vfx++ >= CAPS.vfx) return this.drop();
        w = this.begin(Ev.Vfx);
        w.varuint(S.intern(e.preset));
        this.xz(w, e.x, e.z);
        w.i8(dir8(e.dirX));
        w.i8(dir8(e.dirZ));
        // bit 4 of the flags = negative scale (meleeArc mirrored swing); bit 5 = explicit hero player index follows
        const hasPlayer = e.player >= 0;
        w.u16(q16(Math.abs(e.scale), 64));
        w.u16(q16(e.duration, 100));
        w.varuint(e.color < 0 ? 0 : e.color + 1);
        w.u8((e.hasTarget ? 1 : 0) | ((e.element & 7) << 1) | (e.scale < 0 ? 16 : 0) | (hasPlayer ? 32 : 0));
        if (e.hasTarget) this.xz(w, e.tx, e.tz);
        if (hasPlayer) w.u8(e.player);
        this.emit(big ? 1 : 2);
        return;
      }
      case 'sfx': {
        const id = S.intern(e.id);
        const key = id * 4 + ((qpos(e.x) >> 9) & 3);
        const seen = (this.sfxSeen.get(key) ?? 0) + 1;
        this.sfxSeen.set(key, seen);
        if (seen > 2 || this.counts.sfx++ >= CAPS.sfx) return this.drop();
        w = this.begin(Ev.Sfx);
        w.varuint(id);
        this.xz(w, e.x, e.z);
        w.u8(q8(e.vol, 255));
        this.emit(2);
        return;
      }
      case 'telegraph':
        w = this.begin(Ev.Telegraph);
        w.u16(netId(e.id));
        w.u8(e.shape);
        this.xz(w, e.x, e.z);
        w.u8(qang(e.rot));
        w.u16(q16(e.a, 64));
        w.u16(q16(e.b, 64));
        w.u16(q16(e.c, 64));
        w.u16(q16(e.dur, 100));
        w.u8(e.source);
        this.emit(1);
        return;
      case 'metinWarn':
        w = this.begin(Ev.MetinWarn);
        w.varuint(e.metin);
        w.varuint(S.intern(e.def));
        this.xz(w, e.x, e.z);
        w.u16(q16(e.dur, 100));
        w.u8(e.great ? 1 : 0);
        this.emit(0);
        return;
      case 'metinImpact':
        w = this.begin(Ev.MetinImpact);
        w.varuint(e.metin);
        w.varuint(S.intern(e.def));
        this.xz(w, e.x, e.z);
        w.u16(q16(e.radius, 32));
        w.u8(e.great ? 1 : 0);
        this.emit(0);
        return;
      case 'metinAwaken':
        w = this.begin(Ev.MetinAwaken);
        w.varuint(e.metin);
        w.varuint(S.intern(e.def));
        this.xz(w, e.x, e.z);
        this.emit(0);
        return;
      case 'metinBreak':
        w = this.begin(Ev.MetinBreak);
        w.varuint(e.metin);
        w.varuint(S.intern(e.def));
        this.xz(w, e.x, e.z);
        w.u8((e.great ? 1 : 0) | (e.awakened ? 2 : 0));
        this.emit(0);
        return;
      case 'bossSpawn':
        w = this.begin(Ev.BossSpawn);
        w.varuint(e.boss);
        w.u16(netId(e.enemy));
        w.varuint(S.intern(e.bossId));
        this.xz(w, e.x, e.z);
        w.u8(e.final ? 1 : 0);
        this.emit(0);
        return;
      case 'bossPhase':
        w = this.begin(Ev.BossPhase);
        w.varuint(e.boss);
        w.varuint(S.intern(e.bossId));
        w.u8(e.phase);
        w.u8(q8(e.hpFrac, 255));
        w.u8(e.enrage ? 1 : 0);
        this.emit(0);
        return;
      case 'bossDeath':
        w = this.begin(Ev.BossDeath);
        w.varuint(e.boss);
        w.varuint(S.intern(e.bossId));
        this.xz(w, e.x, e.z);
        w.u8(e.final ? 1 : 0);
        this.emit(0);
        return;
      case 'chestOpen':
        w = this.begin(Ev.ChestOpen);
        w.u8(e.player);
        this.xz(w, e.x, e.z);
        w.u8(e.boss ? 1 : 0);
        w.varuint(vint(e.cost));
        this.emit(0);
        return;
      case 'chestLocked':
        w = this.begin(Ev.ChestLocked);
        w.u8(e.player);
        w.varuint(vint(e.cost));
        w.varuint(vint(e.yeop));
        this.emit(0);
        return;
      case 'story':
        w = this.begin(Ev.Story);
        w.varuint(S.intern(e.kind));
        w.varuint(S.intern(e.ref));
        this.emit(0);
        return;
      case 'shake':
        if (this.counts.shake++ >= CAPS.shake) return this.drop();
        w = this.begin(Ev.Shake);
        w.u16(q16(e.amount, 1000));
        w.u16(q16(e.duration, 100));
        this.emit(2);
        return;
      case 'runEnd':
        w = this.begin(Ev.RunEnd);
        w.u8(e.victory ? 1 : 0);
        this.emit(0);
        return;
      case 'runEvent':
        // times are absolute sim seconds in centiseconds (a guest derives the timer from its mirrored clock); the phases are
        // never dropped, the channel progress (a steady stream of the same few heroes) is droppable
        w = this.begin(Ev.RunEvent);
        w.varuint(S.intern(e.kind));
        w.u8(Math.max(0, RUN_EVENT_PHASES.indexOf(e.phase)));
        w.varuint(vint(e.id));
        this.xz(w, e.x, e.z);
        w.varuint(vint(e.startAt * 100));
        w.varuint(vint(e.endAt * 100));
        w.u8(e.player < 0 ? 0 : Math.min(254, e.player) + 1);
        w.u8(q8(e.p, 255));
        this.emit(e.phase === 'channel' ? 2 : 0);
        return;
    }
  }

  /** Assembles the pending events (priority order, damage numbers aggregated) within `budget` bytes and resets. */
  flush(budget = EVENT_BUDGET): EventBlock {
    const out = new ByteWriter(Math.min(budget + 256, 8192));
    let count = 0;
    let dropped = this.dropped;
    const take = (b: PriorityBuffer, limit: number): void => {
      let off = 0;
      const view = b.w.view();
      for (let i = 0; i < b.lens.length; i++) {
        const len = b.lens[i] as number;
        if (out.pos + len <= limit) {
          out.bytes(view.subarray(off, off + len));
          count++;
        } else {
          dropped++;
          this.totalDropped++;
        }
        off += len;
      }
    };
    take(this.bufs[0] as PriorityBuffer, Infinity);
    take(this.bufs[1] as PriorityBuffer, budget);

    // aggregated damage numbers: biggest / most important first
    if (this.damage.size > 0) {
      const list = [...this.damage.values()];
      list.sort((a, b) => ((b.flags & 11) !== 0 ? 1e12 : 0) + b.amount - (((a.flags & 11) !== 0 ? 1e12 : 0) + a.amount));
      const scratch = this.scratch;
      for (let i = 0; i < list.length; i++) {
        const a = list[i] as DamageAgg;
        if (i >= MAX_DAMAGE_NUMBERS) {
          dropped++;
          this.totalDropped++;
          continue;
        }
        scratch.reset();
        scratch.u8(Ev.Damage);
        scratch.u16(a.netTarget);
        scratch.u16(qpos(a.x));
        scratch.u16(qpos(a.z));
        scratch.varuint(vint(a.amount));
        scratch.u8(a.flags);
        scratch.u8(a.elementPlayer);
        scratch.u8(a.skill + 1);
        if (out.pos + scratch.pos <= budget) {
          out.bytes(scratch.view());
          count++;
        } else {
          dropped++;
          this.totalDropped++;
        }
      }
    }
    take(this.bufs[2] as PriorityBuffer, budget);

    for (const b of this.bufs) b.reset();
    this.damage.clear();
    this.sfxSeen.clear();
    this.counts.death = this.counts.spawn = this.counts.attack = this.counts.vfx = this.counts.sfx = this.counts.shake = 0;
    this.dropped = 0;
    return { count, bytes: out.copy(), dropped };
  }
}

// ---------------------------------------------------------------------------
// Decoder

export interface EventSink {
  readonly bus: EventBus;
  /** host player index → local player index */
  player(hostIdx: number): number;
  /** net id → local store handle (0 when unknown) */
  enemy(netId: number): number;
  /** wire string table */
  str(id: number): string;
  /** hooks for state derived from events (hit flash, …) */
  onDamage?(localEnemyHandle: number, e: { player: number }): void;
  onPlayerHit?(localPlayer: number, result: number): void;
  /** a 'runEvent' was decoded (`player` = local index or -1): the guest keeps the latest state for its HUD */
  onRunEvent?(e: { kind: string; phase: 'announce' | 'active' | 'end' | 'channel'; id: number; x: number; z: number; startAt: number; endAt: number; player: number; p: number }): void;
}

function sdir(v: number): number {
  return v / 127;
}

/** Decodes `count` event records from `r` into `sink.bus`. Throws DecodeError on malformed input. */
export function decodeEvents(r: ByteReader, count: number, sink: EventSink): void {
  const bus = sink.bus;
  for (let n = 0; n < count; n++) {
    const t = r.u8();
    switch (t) {
      case Ev.Damage: {
        const target = r.u16();
        const x = dqpos(r.u16());
        const z = dqpos(r.u16());
        const amount = r.varuint();
        const flags = r.u8();
        const ep = r.u8();
        const skill = r.u8() - 1;
        const handle = sink.enemy(target);
        const player = sink.player((ep >> 4) & 3);
        bus.damage(x, z, amount, (flags & 1) !== 0, ep & 7, handle, player, skill, (flags & 2) !== 0, (flags & 4) !== 0, (flags & 8) !== 0);
        sink.onDamage?.(handle, { player });
        break;
      }
      case Ev.EnemyDeath: {
        const id = r.u16();
        const type = r.u16();
        const x = dqpos(r.u16());
        const z = dqpos(r.u16());
        const rot = dqang(r.u8());
        const scale = r.u8() / 32;
        const tc = r.u8();
        const killer = r.u8() - 1;
        const skill = r.u8() - 1;
        bus.enemyDeath(sink.enemy(id) || id, type, x, z, rot, scale, tc & 15, killer < 0 ? -1 : sink.player(killer), skill, (tc & 16) !== 0);
        break;
      }
      case Ev.EnemySpawn: {
        const id = r.u16();
        const type = r.u16();
        const x = dqpos(r.u16());
        const z = dqpos(r.u16());
        const tier = r.u8();
        const source = r.u8();
        bus.enemySpawn(sink.enemy(id) || id, type, x, z, tier, source);
        break;
      }
      case Ev.EnemyAttack: {
        const id = r.u16();
        const type = r.u16();
        const kind = r.u8();
        const x = dqpos(r.u16());
        const z = dqpos(r.u16());
        const dx = sdir(r.i8());
        const dz = sdir(r.i8());
        bus.enemyAttack(sink.enemy(id) || id, type, kind, x, z, dx, dz);
        break;
      }
      case Ev.PlayerHit: {
        const player = sink.player(r.u8());
        const amount = r.varuint();
        const result = r.u8();
        const x = dqpos(r.u16());
        const z = dqpos(r.u16());
        const sx = dqpos(r.u16());
        const sz = dqpos(r.u16());
        const element = r.u8();
        const hp = r.varuint();
        bus.playerHit(player, amount, result, x, z, sx, sz, element, hp);
        sink.onPlayerHit?.(player, result);
        break;
      }
      case Ev.PlayerDeath: {
        const player = sink.player(r.u8());
        bus.playerDeath(player, dqpos(r.u16()), dqpos(r.u16()));
        break;
      }
      case Ev.PlayerRevive: {
        const player = sink.player(r.u8());
        bus.playerRevive(player, dqpos(r.u16()), dqpos(r.u16()), r.u8());
        break;
      }
      case Ev.Heal:
        bus.heal(sink.player(r.u8()), r.varuint(), r.u8());
        break;
      case Ev.LevelUp:
        bus.levelUp(sink.player(r.u8()), r.varuint());
        break;
      case Ev.Pickup: {
        const player = sink.player(r.u8());
        const kind = r.u8();
        const value = r.varuint();
        const x = dqpos(r.u16());
        const z = dqpos(r.u16());
        bus.pickup(player, kind, value, x, z, r.u8());
        break;
      }
      case Ev.SkillCast: {
        const player = sink.player(r.u8());
        const skill = r.u8();
        const skillId = sink.str(r.varuint());
        const behavior = sink.str(r.varuint());
        const x = dqpos(r.u16());
        const z = dqpos(r.u16());
        const dx = sdir(r.i8());
        const dz = sdir(r.i8());
        const area = r.u16() / 100;
        const flags = r.u8();
        const awakened = (flags & 1) !== 0;
        const noHeroAnim = (flags & 2) !== 0;
        bus.skillCast(player, skill, skillId, behavior, x, z, dx, dz, area, awakened, sink.str(r.varuint()), noHeroAnim);
        break;
      }
      case Ev.CardPick: {
        const player = sink.player(r.u8());
        const kind = sink.str(r.varuint());
        const id = sink.str(r.varuint());
        const rarity = sink.str(r.varuint());
        const rank = r.u8();
        bus.cardPick(player, kind, id, rarity, rank, r.u8() === 1);
        break;
      }
      case Ev.Vfx: {
        const preset = sink.str(r.varuint());
        const x = dqpos(r.u16());
        const z = dqpos(r.u16());
        const dx = sdir(r.i8());
        const dz = sdir(r.i8());
        const scaleAbs = r.u16() / 64;
        const duration = r.u16() / 100;
        const c = r.varuint();
        const f = r.u8();
        const scale = (f & 16) !== 0 ? -scaleAbs : scaleAbs;
        const element = (f >> 1) & 7;
        const color = c === 0 ? -1 : c - 1;
        if ((f & 1) !== 0) {
          const tx = dqpos(r.u16());
          const tz = dqpos(r.u16());
          const player = (f & 32) !== 0 ? sink.player(r.u8()) : -1;
          bus.vfxLine(preset, x, z, tx, tz, scale, duration, element, color, player);
        } else {
          const player = (f & 32) !== 0 ? sink.player(r.u8()) : -1;
          bus.vfx(preset, x, z, dx, dz, scale, duration, element, color, player);
        }
        break;
      }
      case Ev.Sfx: {
        const id = sink.str(r.varuint());
        const x = dqpos(r.u16());
        const z = dqpos(r.u16());
        bus.sfx(id, x, z, r.u8() / 255);
        break;
      }
      case Ev.Telegraph: {
        const id = r.u16();
        const shape = r.u8();
        const x = dqpos(r.u16());
        const z = dqpos(r.u16());
        const rot = dqang(r.u8());
        const a = r.u16() / 64;
        const b = r.u16() / 64;
        const c = r.u16() / 64;
        const dur = r.u16() / 100;
        bus.telegraph(id, shape, x, z, rot, a, b, c, dur, r.u8());
        break;
      }
      case Ev.MetinWarn: {
        const metin = r.varuint();
        const def = sink.str(r.varuint());
        const x = dqpos(r.u16());
        const z = dqpos(r.u16());
        const dur = r.u16() / 100;
        bus.metinWarn(metin, def, x, z, dur, r.u8() === 1);
        break;
      }
      case Ev.MetinImpact: {
        const metin = r.varuint();
        const def = sink.str(r.varuint());
        const x = dqpos(r.u16());
        const z = dqpos(r.u16());
        const radius = r.u16() / 32;
        bus.metinImpact(metin, def, x, z, radius, r.u8() === 1);
        break;
      }
      case Ev.MetinAwaken: {
        const metin = r.varuint();
        const def = sink.str(r.varuint());
        bus.metinAwaken(metin, def, dqpos(r.u16()), dqpos(r.u16()));
        break;
      }
      case Ev.MetinBreak: {
        const metin = r.varuint();
        const def = sink.str(r.varuint());
        const x = dqpos(r.u16());
        const z = dqpos(r.u16());
        const f = r.u8();
        bus.metinBreak(metin, def, x, z, (f & 1) !== 0, (f & 2) !== 0);
        break;
      }
      case Ev.BossSpawn: {
        const boss = r.varuint();
        const enemy = r.u16();
        const bossId = sink.str(r.varuint());
        const x = dqpos(r.u16());
        const z = dqpos(r.u16());
        bus.bossSpawn(boss, sink.enemy(enemy) || enemy, bossId, x, z, r.u8() === 1);
        break;
      }
      case Ev.BossPhase: {
        const boss = r.varuint();
        const bossId = sink.str(r.varuint());
        const phase = r.u8();
        const hpFrac = r.u8() / 255;
        bus.bossPhase(boss, bossId, phase, hpFrac, r.u8() === 1);
        break;
      }
      case Ev.BossDeath: {
        const boss = r.varuint();
        const bossId = sink.str(r.varuint());
        const x = dqpos(r.u16());
        const z = dqpos(r.u16());
        bus.bossDeath(boss, bossId, x, z, r.u8() === 1);
        break;
      }
      case Ev.ChestOpen: {
        const player = sink.player(r.u8());
        const x = dqpos(r.u16());
        const z = dqpos(r.u16());
        const boss = r.u8() === 1;
        bus.chestOpen(player, x, z, boss, r.varuint());
        break;
      }
      case Ev.ChestLocked:
        bus.chestLocked(sink.player(r.u8()), r.varuint(), r.varuint());
        break;
      case Ev.Story:
        bus.story(sink.str(r.varuint()), sink.str(r.varuint()));
        break;
      case Ev.Shake:
        bus.shake(r.u16() / 1000, r.u16() / 100);
        break;
      case Ev.RunEnd:
        bus.runEnd(r.u8() === 1);
        break;
      case Ev.RunEvent: {
        const kind = sink.str(r.varuint());
        const phase = RUN_EVENT_PHASES[r.u8()];
        if (phase === undefined) throw new DecodeError('unknown run event phase');
        const id = r.varuint();
        const x = dqpos(r.u16());
        const z = dqpos(r.u16());
        const startAt = r.varuint() / 100;
        const endAt = r.varuint() / 100;
        const pl = r.u8();
        const player = pl === 0 ? -1 : sink.player(pl - 1);
        const p = r.u8() / 255;
        bus.runEvent(kind, phase, id, x, z, startAt, endAt, player, p);
        sink.onRunEvent?.({ kind, phase, id, x, z, startAt, endAt, player, p });
        break;
      }
      default:
        throw new DecodeError(`unknown event type ${t}`);
    }
  }
}
