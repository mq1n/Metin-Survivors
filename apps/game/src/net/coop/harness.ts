// Headless co-op session for tests and tooling: one host + N guests on the in-memory relay with virtual latency, built through
// the SAME entry points the game uses (CoopSession → onRunStart → run.config → run.createWorld → runEvents.runStart).
// `tick()` advances the virtual network by one 60 Hz tick and steps every world exactly like the engine's run loop does.

import type { Loadout, ZoneId } from '@ms/shared';
import { runEvents } from '../../app/runEvents';
import type { ContentDB } from '../../data/schema';
import { cloneContent, FIXTURE_ZONE_ID } from '../../sim/__fixtures__/content';
import { MAX_SKILL_SLOTS } from '../../sim/constants';
import { giveSkill } from '../../sim/__tests__/helpers';
import type { MetaBonuses } from '../../sim/run';
import type { WorldEnv } from '../../sim/types';
import type { World } from '../../sim/world';
import { CoopHost, CoopHostWorld } from './host';
import { MemoryNet, MemoryRoom, MemoryTransport } from './memoryRelay';
import { CoopGuest, MirrorWorld } from './mirror';
import { CoopSession, type CoopRunStart } from './session';

export interface HarnessOptions {
  guests?: number;
  latencyMs?: number;
  jitterMs?: number;
  /** target live enemies (default: the fixture zone's bands) */
  enemies?: number;
  /** give every hero the 15 test skills at rank 3 */
  skills?: boolean;
  /** tough heroes (they survive a long fight) */
  tough?: boolean;
  seed?: number;
  /** the host finishes loading after every guest (tests the early `ready` buffering) */
  hostLoadsLast?: boolean;
  env?: WorldEnv;
  content?: (c: ContentDB) => void;
}

export interface Move {
  x: number;
  z: number;
  attack?: boolean;
  castMask?: number;
  aimX?: number;
  aimZ?: number;
  manualCast?: boolean;
}

const ALL_SKILLS = ['lightning_trio', 'bladewheel', 'fury_aura', 'lunge', 'aura_sword', 'war_leap', 'soul_crash', 'sky_blades', 'chain_lightning', 'sword_circle', 'frost_cleave', 'phantom_blades', 'soul_beam', 'arc_of_might', 'venom_pool'];
const LOADOUTS: Loadout[] = [
  { classId: 'warrior', doctrine: 'a', sex: 'm', empire: 'saehwa', tier: 1 },
  { classId: 'warrior', doctrine: 'b', sex: 'f', empire: 'chowon', tier: 2 },
  { classId: 'warrior', doctrine: 'a', sex: 'f', empire: 'jihae', tier: 0 },
  { classId: 'warrior', doctrine: 'b', sex: 'm', empire: 'saehwa', tier: 3 },
];

export class CoopHarness {
  readonly net = new MemoryNet();
  readonly room: MemoryRoom;
  readonly content: ContentDB;
  readonly transports: MemoryTransport[] = [];
  readonly sessions: CoopSession[] = [];
  readonly runs: CoopRunStart[] = [];
  hostWorld!: CoopHostWorld;
  host!: CoopHost;
  readonly guestWorlds: MirrorWorld[] = [];
  readonly guests: CoopGuest[] = [];
  /** ticks driven so far */
  ticks = 0;

  private constructor(readonly opts: HarnessOptions) {
    this.room = new MemoryRoom(this.net, { latencyMs: opts.latencyMs ?? 25, jitterMs: opts.jitterMs ?? 0, seed: opts.seed ?? 7 });
    this.content = cloneContent();
    opts.content?.(this.content);
    if (opts.enemies !== undefined) {
      const z = this.content.zones[0];
      if (z) {
        z.bands = [
          {
            from: 0,
            to: 900,
            rate: 60,
            maxAlive: opts.enemies,
            spawns: [
              { enemy: 'wolf', weight: 5 },
              { enemy: 'jackal', weight: 3 },
              { enemy: 'spitter', weight: 1 },
              { enemy: 'bear', weight: 1 },
              { enemy: 'fox', weight: 2 },
            ],
          },
        ];
        z.bosses = [];
        z.metins = { types: ['metin_lament'], firstAt: 30, interval: [40, 50] };
      }
    }
  }

  static async create(opts: HarnessOptions = {}): Promise<CoopHarness> {
    const h = new CoopHarness(opts);
    await h.setup();
    return h;
  }

  /** advances the virtual network while flushing promise continuations */
  async settle(ms: number): Promise<void> {
    for (let t = 0; t < ms; t += 5) {
      this.net.advance(5);
      await Promise.resolve();
      await Promise.resolve();
    }
  }

  private async setup(): Promise<void> {
    const n = 1 + (this.opts.guests ?? 1);
    const meta: MetaBonuses = this.opts.tough ? { stats: { maxHpPct: 80, armor: 600, regen: 80 } } : { stats: {} };
    const runs = new Map<number, CoopRunStart>();
    for (let i = 0; i < n; i++) {
      const t = this.room.client(`p${i}`, `Player${i + 1}`);
      const s = new CoopSession(t, {
        getLoadout: () => LOADOUTS[i] as Loadout,
        onRunStart: (r) => runs.set(i, r),
        now: () => this.net.now,
      });
      this.transports.push(t);
      this.sessions.push(s);
      await Promise.all([t.connect(), this.settle(120)]);
      s.join(LOADOUTS[i] as Loadout, i !== 0);
      await this.settle(120);
    }
    this.sessions[0]?.start(FIXTURE_ZONE_ID as ZoneId, 'normal', 4321);
    await this.settle(200);
    const configs = [];
    for (let i = 0; i < n; i++) {
      const run = runs.get(i);
      if (!run) throw new Error(`player ${i} never received the run start`);
      this.runs.push(run);
      configs.push(run.config({ meta }));
    }
    await this.settle(300);
    const cfgs = await Promise.all(configs);
    const env = this.opts.env ?? {};
    const make = (i: number): World => (this.runs[i] as CoopRunStart).createWorld(cfgs[i] as NonNullable<(typeof cfgs)[number]>, this.content, env);
    const worlds: World[] = [];
    if (this.opts.hostLoadsLast) {
      // the guests finish loading (and send `ready`) before the host's CoopHost exists
      for (let i = 1; i < n; i++) worlds[i] = make(i);
      for (let i = 1; i < n; i++) runEvents.runStart(worlds[i] as World);
      await this.settle(500);
      worlds[0] = make(0);
    } else {
      for (let i = 0; i < n; i++) worlds[i] = make(i);
    }
    this.hostWorld = worlds[0] as CoopHostWorld;
    this.host = this.hostWorld.host as CoopHost;
    for (let i = 1; i < n; i++) {
      const w = worlds[i] as MirrorWorld;
      this.guestWorlds.push(w);
      this.guests.push(w.guest as CoopGuest);
    }
    if (this.opts.skills) {
      // 32 skill slots are shared by the whole party
      const perHero = Math.floor(MAX_SKILL_SLOTS / this.hostWorld.players.length);
      for (let p = 0; p < this.hostWorld.players.length; p++) {
        for (const id of ALL_SKILLS) {
          const hero = this.hostWorld.players[p];
          if (hero && hero.skills.length < perHero && !hero.skills.some((s) => s.def.id === id)) giveSkill(this.hostWorld, id, 3, p);
        }
      }
    }
    for (let i = 0; i < worlds.length; i++) if (!(this.opts.hostLoadsLast && i > 0)) runEvents.runStart(worlds[i] as World);
  }

  /** one 60 Hz tick of the network and of every world */
  tick(hostMove: Move = { x: 0, z: 0 }, guestMoves: readonly Move[] = []): void {
    this.net.advance(1000 / 60);
    const toInput = (m: Move) => ({
      moveX: m.x,
      moveZ: m.z,
      ...(m.attack !== undefined ? { attack: m.attack } : {}),
      ...(m.castMask !== undefined ? { castMask: m.castMask } : {}),
      ...(m.aimX !== undefined ? { aimX: m.aimX } : {}),
      ...(m.aimZ !== undefined ? { aimZ: m.aimZ } : {}),
      ...(m.manualCast !== undefined ? { manualCast: m.manualCast } : {}),
    });
    this.hostWorld.step([toInput(hostMove)]);
    for (let i = 0; i < this.guestWorlds.length; i++) {
      const m = guestMoves[i] ?? { x: 0, z: 0 };
      (this.guestWorlds[i] as MirrorWorld).step([toInput(m)]);
    }
    this.ticks++;
  }

  dispose(): void {
    for (const r of this.runs) r.abort();
    for (const s of this.sessions) s.close();
  }

  /** the dropped transport of player `i` reconnects (and the virtual network runs long enough for the resync) */
  async reconnect(i: number): Promise<void> {
    const t = this.transports[i];
    if (!t) throw new Error(`no player ${i}`);
    await Promise.all([t.reconnect(), this.settle(150)]);
  }
}
