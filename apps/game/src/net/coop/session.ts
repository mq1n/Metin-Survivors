// Session layer: ties the relay transport, the lobby and the sync classes together.
//
//   const link = createCoopFactory(api, { getLoadout, onRunStart })(room)   // UI lobby: a CoopLink (+ extras)
//   await link.connect(); link.join(loadout, ready); … host: link.start(zone, difficulty, seed)
//   onRunStart(run) fires on EVERY client when the relay broadcasts `start`:
//     const config = await run.config({ meta, runOptions });        // guests hand their MetaBonuses to the host here
//     const session = new RunSession(deps, config, content, run);   // RunSession builds its world with run.createWorld(...)
//
// `CoopRunStart.createWorld` returns a `CoopHostWorld` (host) or `MirrorWorld` (guest): both ARE sim Worlds, so the engine's
// run loop, renderer, vfx, audio and UI consume them like a local run. The engine's lifecycle calls reach the sync layer
// through `runEvents` (runStart → ready, runEnd → dispose), so no co-op code is needed in the run loop itself.

import type { Difficulty, JsonValue, Loadout, LobbyPlayer, ServerMessage, Slot, ZoneId } from '@ms/shared';
import type { ContentDB } from '../../data/schema';
import { runEvents } from '../../app/runEvents';
import { EMPTY_META, type CoopPlayerInit, type MetaBonuses, type RunConfig, type RunOptions } from '../../sim/run';
import type { WorldEnv } from '../../sim/types';
import type { World } from '../../sim/world';
import type { ApiClient } from '../api';
import { CoopTransport } from '../transport';
import { contentFingerprint, CoopHost, CoopHostWorld } from './host';
import { CoopGuest, MirrorWorld } from './mirror';
import { EV, hostOrder, localOrder, type CoopStatus, type CoopWire, type NetStats } from './protocol';
import { sanitizeMeta } from './meta';

type Of<T extends ServerMessage['t']> = Extract<ServerMessage, { t: T }>;

export interface CoopRunPlayer {
  slot: Slot;
  name: string;
  loadout: Loadout;
  /** this client */
  local: boolean;
  /** the host's hero */
  host: boolean;
}

export interface CoopLocalConfig {
  /** MetaBonuses of THIS client's hero (gear / talents / blacksmith…) */
  meta: MetaBonuses;
  /** Run Options sliders; only the HOST's are used (the host simulates for everybody) */
  runOptions?: Partial<RunOptions>;
}

/** What every client receives when the room starts a run. */
export interface CoopRunStart {
  readonly role: 'host' | 'guest';
  readonly room: string;
  readonly zone: ZoneId;
  readonly difficulty: Difficulty;
  readonly seed: number;
  /** relay wall clock (ms) at which the run should begin; the host additionally waits until every guest is loaded */
  readonly startAt: number;
  /** players in WORLD order: [0] is this client's hero, then the others (host order for the rest) */
  readonly players: readonly CoopRunPlayer[];
  /**
   * Builds this client's RunConfig (local hero first, the others in `coop`). Guests send their MetaBonuses to the host
   * here; the host waits (≤ 8 s) for every guest's before it builds the config that creates the authoritative world.
   */
  config(local: CoopLocalConfig): Promise<RunConfig>;
  /** The world factory for `RunSession`: a `CoopHostWorld` on the host, a `MirrorWorld` on guests. Call exactly once. */
  createWorld(config: RunConfig, content: ContentDB, env: WorldEnv): World;
  /** sync status for the HUD (waiting for players, pending picks, reconnecting…); called immediately with the current one */
  onStatus(fn: (s: CoopStatus) => void): () => void;
  /** network statistics of the running sync layer (null before `createWorld`) */
  stats(): NetStats | null;
  /**
   * The local player paused / resumed (pause menu, hidden tab, story card). On the HOST this stops the shared sim for
   * everybody (guests see a "host paused" overlay); a guest cannot pause the shared sim — keep `loop.paused` false and show
   * only an overlay, and send zero movement while it is open.
   */
  setPaused(paused: boolean): void;
  /** the local result fallback / user left the run: stops all sync work */
  abort(): void;
  /** Keep the open room socket across run teardown so CoopLobby can reclaim the same seat for a rematch. */
  retainForLobby?(): void;
  /** Cancel any retained lobby handoff and leave the room immediately. */
  discardLobby?(): void;
}

export interface CoopOptions {
  /** the lobby loadout of this client (class / doctrine / sex / empire / armor tier) */
  getLoadout(): Loadout;
  /** the relay announced the run: begin loading (every client, host included) */
  onRunStart(run: CoopRunStart): void;
  /** wall clock for timeouts; tests inject a virtual one */
  now?: () => number;
}

const META_WAIT_MS = 8000;

/** CoopLink-compatible facade over the transport: the lobby UI talks to this, the run start flows out through `onRunStart`. */
export class CoopSession {
  /** the run currently announced / in progress */
  run: CoopRunStart | null = null;
  /** from the relay's `start` until the run is aborted the connection belongs to the run, not to the lobby that built this session */
  private runLive = false;
  private handoff = false;
  private handoffTimer: ReturnType<typeof setTimeout> | undefined;
  private early: Of<'event'>[] = [];
  private hostAttached = false;
  private readonly offs: (() => void)[] = [];
  private readonly metas = new Map<Slot, { startAt: number; meta: MetaBonuses }>();
  private metaWaiters: (() => void)[] = [];

  constructor(
    readonly transport: CoopWire,
    private readonly opts: CoopOptions,
  ) {
    this.offs.push(
      transport.on('start', (m) => this.onStart(m)),
      transport.on('event', (m) => this.onEvent(m)),
    );
  }

  // ---- CoopLink surface ---------------------------------------------------------------------------------------------------
  get state(): CoopWire['state'] {
    return this.transport.state;
  }
  get room(): string {
    return this.transport.room;
  }
  get slot(): number {
    return this.transport.slot;
  }
  get host(): number {
    return this.transport.host;
  }
  get phase(): CoopWire['phase'] {
    return this.transport.phase;
  }
  get players(): LobbyPlayer[] {
    return this.transport.players;
  }
  get isHost(): boolean {
    return this.transport.isHost;
  }
  get latencyMs(): number {
    return this.transport.latencyMs;
  }
  readonly on: CoopWire['on'] = (type, fn) => this.transport.on(type, fn);
  connect(): Promise<Of<'hello'>> {
    return this.transport.connect();
  }
  join(loadout: Loadout, ready?: boolean): boolean {
    return this.transport.join(loadout, ready);
  }
  start(zone: ZoneId, difficulty: Difficulty, seed: number): boolean {
    return this.transport.start(zone, difficulty, seed);
  }
  /** the lobby unmounts when the run starts and calls leave(): ignore it while the run owns the connection */
  leave(): void {
    if (this.runLive) return;
    this.clearHandoff();
    this.run?.abort();
    this.transport.leave();
  }
  close(): void {
    if (this.runLive) return;
    this.clearHandoff();
    this.run?.abort();
    this.transport.close();
    for (const off of this.offs) off();
    this.offs.length = 0;
  }

  /** Reclaims a live connection retained for returning to the co-op lobby after a finished run. */
  reclaim(): boolean {
    if (!this.handoff || !this.transport.isOpen) return false;
    this.clearHandoff();
    return true;
  }

  /** Drops any retained post-run lobby handoff and leaves the room immediately. */
  discardHandoff(): void {
    if (!this.handoff) return;
    this.clearHandoff();
    this.transport.leave();
  }

  private clearHandoff(): void {
    this.handoff = false;
    clearTimeout(this.handoffTimer);
    this.handoffTimer = undefined;
  }

  // ---- run start ------------------------------------------------------------------------------------------------------------

  /** guest → host events: bonuses go to the config waiters; the rest are kept for the CoopHost that does not exist yet */
  private onEvent(m: Of<'event'>): void {
    if (!this.transport.isHost) return;
    if (m.k !== EV.meta) {
      if (this.runLive && !this.hostAttached && this.early.length < 64) this.early.push(m);
      return;
    }
    const d = m.d;
    if (typeof d !== 'object' || d === null || Array.isArray(d) || typeof d.s !== 'number') return;
    this.metas.set(m.from, { startAt: d.s, meta: sanitizeMeta(d.m) });
    for (const w of this.metaWaiters) w();
  }

  private onStart(m: Of<'start'>): void {
    const t = this.transport;
    const mySlot = t.slot as Slot;
    const hostSlot = t.host as Slot;
    const role: 'host' | 'guest' = t.isHost ? 'host' : 'guest';
    const slots = m.slots;
    const order = role === 'host' ? hostOrder(hostSlot, slots) : localOrder(mySlot, hostSlot, slots);
    const byslot = new Map<Slot, LobbyPlayer>(t.players.map((p) => [p.slot, p]));
    const players: CoopRunPlayer[] = [];
    for (const slot of order) {
      const lp = byslot.get(slot);
      if (!lp?.loadout) return; // the relay guarantees loadouts at start; guard against an inconsistent roster
      players.push({ slot, name: lp.name, loadout: lp.loadout, local: slot === mySlot, host: slot === hostSlot });
    }
    this.early = [];
    this.hostAttached = false;
    this.run = this.makeRun(m, role, mySlot, hostSlot, slots, order, players);
    this.runLive = true;
    this.opts.onRunStart(this.run);
  }

  private makeRun(m: Of<'start'>, role: 'host' | 'guest', mySlot: Slot, hostSlot: Slot, slots: readonly Slot[], order: readonly Slot[], players: CoopRunPlayer[]): CoopRunStart {
    const t = this.transport;
    const opts = this.opts;
    const metas = this.metas;
    const statusSubs = new Set<(s: CoopStatus) => void>();
    let lastStatus: CoopStatus | null = null;
    let host: CoopHost | null = null;
    let guest: CoopGuest | null = null;
    let offLife: (() => void) | null = null;
    let retain = false;
    const push = (s: CoopStatus): void => {
      lastStatus = s;
      for (const fn of statusSubs) fn(s);
    };
    const waitMetas = async (): Promise<void> => {
      const need = slots.filter((s) => s !== hostSlot);
      const have = (): boolean => need.every((s) => metas.get(s)?.startAt === m.startAt);
      if (have()) return;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, META_WAIT_MS);
        const waiter = (): void => {
          if (have()) done();
        };
        function done(): void {
          clearTimeout(timer);
          resolve();
        }
        this.metaWaiters.push(waiter);
      });
      this.metaWaiters = [];
    };
    const metaOf = (slot: Slot): MetaBonuses => {
      const got = metas.get(slot);
      return got && got.startAt === m.startAt ? got.meta : EMPTY_META;
    };
    const init = (p: CoopRunPlayer, meta: MetaBonuses): CoopPlayerInit => ({
      classId: p.loadout.classId,
      doctrine: p.loadout.doctrine,
      sex: p.loadout.sex,
      empire: p.loadout.empire,
      meta,
    });

    const run: CoopRunStart = {
      role,
      room: t.room,
      zone: m.zone,
      difficulty: m.difficulty,
      seed: m.seed,
      startAt: m.startAt,
      players,
      async config(local) {
        const me = players[0] as CoopRunPlayer;
        const base: RunConfig = {
          zone: m.zone,
          difficulty: m.difficulty,
          classId: me.loadout.classId,
          doctrine: me.loadout.doctrine,
          sex: me.loadout.sex,
          empire: me.loadout.empire,
          seed: m.seed,
          meta: local.meta,
        };
        if (role === 'guest') {
          // a JSON round trip hands the relay a plain copy of the validated bonuses; `s` ties them to this run start
          const body: JsonValue = JSON.parse(JSON.stringify({ s: m.startAt, m: sanitizeMeta(local.meta) }));
          t.event(EV.meta, body);
          return { ...base, coop: players.slice(1).map((p) => init(p, EMPTY_META)) };
        }
        await waitMetas();
        const cfg: RunConfig = { ...base, coop: players.slice(1).map((p) => init(p, metaOf(p.slot))) };
        if (local.runOptions) cfg.runOptions = local.runOptions;
        return cfg;
      },
      createWorld: (config, content, env) => {
        const fingerprint = contentFingerprint(content, config.zone);
        const names = players.map((p) => p.name);
        let world: World;
        if (role === 'host') {
          const w = new CoopHostWorld(config, content, env);
          host = new CoopHost({
            world: w,
            wire: t,
            hostSlot,
            guestSlots: order.slice(1),
            names,
            fingerprint,
            ...(opts.now ? { now: opts.now } : {}),
            onStatus: push,
          });
          // guests that finished loading first already sent `ready` / `sync`: replay them now that the host exists
          for (const e of this.early.splice(0)) host.handleEvent(e);
          this.hostAttached = true;
          world = w;
        } else {
          const w = new MirrorWorld(config, content, env);
          guest = new CoopGuest({
            world: w,
            wire: t,
            mySlot,
            hostSlot,
            order,
            hostOrder: hostOrder(hostSlot, slots),
            names,
            fingerprint,
            ...(opts.now ? { now: opts.now } : {}),
            onStatus: push,
          });
          world = w;
        }
        offLife = runEvents.subscribeLifecycle({
          runStart(w) {
            if (w !== world) return;
            host?.start();
            guest?.start();
          },
          runEnd(w) {
            if (w === world) run.abort();
          },
        });
        const s = host?.status() ?? guest?.status();
        if (s) push(s);
        return world;
      },
      onStatus(fn) {
        statusSubs.add(fn);
        if (lastStatus) fn(lastStatus);
        return () => statusSubs.delete(fn);
      },
      stats: () => host?.stats ?? guest?.stats ?? null,
      setPaused(paused) {
        host?.setHostPaused(paused);
      },
      retainForLobby: () => {
        if (this.run === run && t.isOpen) retain = true;
      },
      discardLobby: () => {
        retain = false;
        this.discardHandoff();
      },
      abort: () => {
        offLife?.();
        offLife = null;
        // an abandoned host run ends for everybody (personal results + room back to its lobby)
        host?.dispose();
        guest?.dispose();
        statusSubs.clear();
        // the run is over for this client: either hand the open room seat back to CoopLobby for a rematch, or leave the room
        if (this.run === run) {
          this.run = null;
          this.runLive = false;
          if (retain && t.isOpen) {
            retain = false;
            this.handoff = true;
            clearTimeout(this.handoffTimer);
            this.handoffTimer = setTimeout(() => this.discardHandoff(), 60_000);
          } else {
            retain = false;
            this.clearHandoff();
            t.leave();
          }
        }
      },
    };
    return run;
  }
}

// ---------------------------------------------------------------------------
// Entry points

export type CoopApi = Pick<ApiClient, 'createRoom' | 'coopSocketUrl' | 'getCredentials'>;

export interface CoopSessionFactoryOptions extends CoopOptions {
  /** builds the transport for a room code (default: the real WebSocket transport against `api`) */
  transportFactory?: (room: string) => CoopWire;
}

/** `UiDeps.coopFactory`: builds a lobby link for a room code (reusing a retained post-run session for seamless rematches). */
export function createCoopFactory(api: ApiClient, opts: CoopSessionFactoryOptions): (room: string) => CoopSession {
  const retained = new Map<string, CoopSession>();
  return (room) => {
    const code = room.trim().toUpperCase();
    const prev = retained.get(code);
    if (prev && prev.reclaim()) return prev;
    for (const s of retained.values()) s.discardHandoff();
    retained.clear();
    const session = new CoopSession(opts.transportFactory ? opts.transportFactory(room) : CoopTransport.forRoom(api, room), opts);
    retained.set(code, session);
    return session;
  };
}

/** Creates a room, connects as its host and joins it with the current loadout (not ready: hosts need no ready flag). */
export async function startCoopHost(api: ApiClient, opts: CoopSessionFactoryOptions): Promise<CoopSession> {
  const { room } = await api.createRoom();
  const session = createCoopFactory(api, opts)(room);
  await session.connect();
  session.join(opts.getLoadout(), true);
  return session;
}

/** Connects to an existing room by its 6-character code and joins it with the current loadout. */
export async function joinCoop(api: ApiClient, room: string, opts: CoopSessionFactoryOptions): Promise<CoopSession> {
  const session = createCoopFactory(api, opts)(room.trim().toUpperCase());
  await session.connect();
  session.join(opts.getLoadout(), false);
  return session;
}
