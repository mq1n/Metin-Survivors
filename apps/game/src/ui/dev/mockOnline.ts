// Gallery-only fakes for the online screens (owner: B13 online): a scripted co-op link that plays a short lobby script
// (players join, ready up, the connection drops, the match starts, the join fails). The leaderboard / co-op scenarios that
// use it live in ./scenarios/online.ts; the shared service reset is ./scenarioKit.ts restoreServices. Never imported by
// the production UI path.
import type { LobbyPlayer, Loadout, ServerMessage, Slot } from '@ms/shared/coop';
import type { TransportEvents, TransportState } from '../../net/transport';
import type { CoopLink } from '../env';

// ---------------------------------------------------------------------------------------------------------------
// Scripted co-op link

export type CoopScript = 'all-ready' | 'pair' | 'guest' | 'reconnect' | 'start' | 'error' | 'full';

type Handler = (e: never) => void;

const ZEYNEP: Loadout = { classId: 'shaman', doctrine: 'b', sex: 'f', empire: 'jihae', tier: 0 };
const BOZKURT: Loadout = { classId: 'wolfman', doctrine: 'a', sex: 'm', empire: 'saehwa', tier: 2 };
const ASLAN: Loadout = { classId: 'warrior', doctrine: 'a', sex: 'm', empire: 'chowon', tier: 1 };

/** A co-op link that plays a short script (players join, ready up, the connection drops, the match starts …). */
export class ScriptedCoopLink implements CoopLink {
  state: TransportState = 'idle';
  room: string;
  slot = -1;
  host = 0;
  phase: CoopLink['phase'] = 'lobby';
  players: LobbyPlayer[] = [];
  latencyMs = 38;
  private readonly handlers = new Map<string, Set<Handler>>();
  private timers: number[] = [];
  private mine: Loadout | null = null;
  private myReady = false;

  constructor(room: string, private readonly script: CoopScript) {
    this.room = room.toUpperCase();
  }

  get isHost(): boolean {
    return this.slot >= 0 && this.slot === this.host;
  }

  on<K extends keyof TransportEvents>(type: K, fn: (e: TransportEvents[K]) => void): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn as Handler);
    return () => set.delete(fn as Handler);
  }

  private emit<K extends keyof TransportEvents>(type: K, payload: TransportEvents[K]): void {
    for (const fn of [...(this.handlers.get(type) ?? [])]) (fn as (e: TransportEvents[K]) => void)(payload);
  }

  private setState(s: TransportState): void {
    this.state = s;
    this.emit('state', s);
  }

  private later(ms: number, fn: () => void): void {
    this.timers.push(window.setTimeout(fn, ms));
  }

  private roomState(): void {
    this.emit('roomState', { t: 'roomState', room: this.room, phase: this.phase, host: this.host as Slot, epoch: 1, players: this.players });
  }

  private player(slot: Slot, name: string, loadout: Loadout, ready: boolean): LobbyPlayer {
    return { slot, name, connected: true, ready, loadout };
  }

  async connect(): Promise<Extract<ServerMessage, { t: 'hello' }>> {
    this.setState('connecting');
    await new Promise((r) => setTimeout(r, 300));
    if (this.script === 'error') {
      this.emit('error', { t: 'error', code: 'room_not_found', message: 'room not found' });
      this.emit('close', { code: 1008, reason: 'room_not_found', willReconnect: false });
      this.setState('closed');
      throw new Error('co-op connection failed');
    }
    const guest = this.script === 'guest' || this.script === 'full';
    this.slot = guest ? 1 : 0;
    this.host = 0;
    this.players = guest ? [this.player(0, 'Aslan_Yürek', ASLAN, true)] : [];
    this.setState('open');
    const hello = {
      t: 'hello',
      proto: 1,
      room: this.room,
      slot: this.slot as Slot,
      host: 0 as Slot,
      epoch: 1,
      phase: this.phase,
      serverTime: Date.now(),
      players: this.players,
      limits: { maxPlayers: 4, inputBytes: 256, eventBytes: 4096, snapshotBytes: 49152 },
    } as const;
    this.emit('hello', hello);
    return hello;
  }

  join(loadout: Loadout, ready = false): boolean {
    const first = this.mine === null;
    this.mine = loadout;
    this.myReady = ready;
    const me = this.player(this.slot as Slot, 'Kahraman2841', loadout, ready);
    this.players = [...this.players.filter((p) => p.slot !== this.slot), me].sort((a, b) => a.slot - b.slot);
    this.roomState();
    if (!first) return true;
    const add = (slot: Slot, name: string, l: Loadout, isReady: boolean): void => {
      this.players = [...this.players.filter((p) => p.slot !== slot), this.player(slot, name, l, isReady)].sort((a, b) => a.slot - b.slot);
      this.roomState();
    };
    const guest = this.script === 'guest' || this.script === 'full';
    if (guest) {
      this.later(900, () => add(2, 'Bozkurt', BOZKURT, false));
      if (this.script === 'full') this.later(1600, () => add(3, 'Zeynep', ZEYNEP, true));
    } else {
      this.later(900, () => add(1, 'Zeynep', ZEYNEP, false));
      // 'pair' stops here: two heroes in the room, Zeynep not ready (the "waiting for a hero to get ready" state)
      if (this.script !== 'pair') {
        this.later(1800, () => add(2, 'Bozkurt', BOZKURT, false));
        this.later(2800, () => add(1, 'Zeynep', ZEYNEP, true));
        if (this.script === 'all-ready' || this.script === 'start') this.later(3600, () => add(2, 'Bozkurt', BOZKURT, true));
      }
    }
    if (this.script === 'reconnect') {
      this.later(4200, () => this.setState('reconnecting'));
    }
    if (this.script === 'start') {
      this.later(5200, () => {
        this.phase = 'running';
        this.emit('start', { t: 'start', zone: 'suryeon', difficulty: 'normal', seed: 1234, startAt: Date.now() + 3000, slots: [0, 1, 2] });
        this.roomState();
      });
    }
    return true;
  }

  start(): boolean {
    this.phase = 'running';
    this.roomState();
    return true;
  }

  leave(): void {
    this.close();
  }

  close(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    if (this.state !== 'closed') this.setState('closed');
  }

  /** local readiness as last sent (test hook) */
  get ready(): boolean {
    return this.myReady;
  }
}
