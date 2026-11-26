// Gallery-only fakes: an in-memory Worker (UiApi) and a scripted co-op lobby (CoopLink). They exist so every online
// screen can be rendered and screenshotted without a backend; never imported by the production UI path.
import type {
  Credentials,
  HealthResponse,
  LeaderboardEntry,
  LeaderboardQuery,
  LeaderboardResponse,
  RegisterResponse,
  RenameResponse,
  RunResponse,
  RunSubmission,
  SaveMeta,
  TransferClaimResponse,
  TransferCreateResponse,
} from '@ms/shared/api';
import { CODE_ALPHABET } from '@ms/shared/api';
import type { LobbyPlayer, Loadout, ServerMessage, Slot } from '@ms/shared/coop';
import type { CoopLink, UiApi } from '../env';
import type { TransportEvents } from '../../net/transport';

const NAMES = ['Kahraman2841', 'Aslan_Yürek', 'MetinAvcısı', 'Zeynep', 'DragonBane', 'Bozkurt', 'Kılıçhan', 'Selin', 'Mistik', 'Yeonmu_Boy', 'Tuğçe', 'Alev', 'Cengiz', 'Nehir', 'BlackStone', 'Doruk'];
const CLASSES = ['warrior', 'ninja', 'yacha', 'shaman', 'wolfman'] as const;

function rand(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function board(q: LeaderboardQuery, youName: string): LeaderboardResponse {
  const r = rand(q.zone.length * 7919 + (q.difficulty === 'hard' ? 31 : 3) + (q.class === 'all' ? 1 : q.class.length * 13) + (q.period === 'week' ? 77 : 5));
  const entries: LeaderboardEntry[] = [];
  let score = 480_000 + Math.floor(r() * 90_000);
  const total = 137 + Math.floor(r() * 60);
  const youRank = 9;
  for (let i = 0; i < Math.min(q.limit, 25); i++) {
    const classId = q.class === 'all' ? (CLASSES[Math.floor(r() * CLASSES.length)] ?? 'warrior') : q.class;
    const victory = r() > 0.28;
    score = Math.round(score * (0.9 + r() * 0.08));
    entries.push({
      rank: i + 1,
      name: i + 1 === youRank ? youName : (NAMES[(i * 5 + Math.floor(r() * 7)) % NAMES.length] ?? 'Hero'),
      score,
      classId,
      party: q.mode === 'coop' ? 2 + Math.floor(r() * 3) : 1,
      victory,
      level: 38 + Math.floor(r() * 24),
      kills: 3800 + Math.floor(r() * 4200),
      duration: victory ? 880 + Math.floor(r() * 40) : 420 + Math.floor(r() * 400),
      achievedAt: Date.now() - Math.floor(r() * 1000 * 3600 * 24 * 6),
      you: i + 1 === youRank,
    });
  }
  const you = entries.find((e) => e.you) ?? null;
  return { mode: q.mode, zone: q.zone, difficulty: q.difficulty, class: q.class, period: q.period, weekStart: q.period === 'week' ? Date.now() - 3 * 86400000 : null, limit: q.limit, total, entries, you };
}

export class MockApi implements UiApi {
  private creds: Credentials | null = { playerId: 'mock0000mock0000', secret: 'x'.repeat(32) };
  private cloud: { rev: number; body: string; updatedAt: number } | null = null;
  name = 'Kahraman2841';
  /** simulate the network being down */
  offline = false;

  hasCredentials(): boolean {
    return this.creds !== null;
  }
  getCredentials(): Credentials | null {
    return this.creds;
  }
  pendingRuns(): number {
    return 0;
  }
  async health(): Promise<HealthResponse> {
    return { ok: !this.offline, service: 'metin-survivors-api', api: '/api/v1', time: Date.now(), db: true, blobs: true };
  }
  async register(name?: string): Promise<RegisterResponse> {
    if (name) this.name = name;
    this.creds = { playerId: 'mock0000mock0000', secret: 'x'.repeat(32) };
    return { playerId: this.creds.playerId, secret: this.creds.secret, name: this.name };
  }
  async rename(name: string): Promise<RenameResponse> {
    this.name = name;
    return { playerId: 'mock0000mock0000', name };
  }
  async getSave(): Promise<{ meta: SaveMeta; body: string } | null> {
    if (this.offline) throw Object.assign(new Error('offline'), { status: 0, code: 'network' });
    return this.cloud ? { meta: { rev: this.cloud.rev, updatedAt: this.cloud.updatedAt, size: this.cloud.body.length }, body: this.cloud.body } : null;
  }
  async putSave(body: string, ifMatchRev: number): Promise<SaveMeta> {
    if (this.offline) throw Object.assign(new Error('offline'), { status: 0, code: 'network' });
    if ((this.cloud?.rev ?? 0) !== ifMatchRev) throw Object.assign(new Error('rev_conflict'), { status: 412, code: 'rev_conflict', details: { currentRev: this.cloud?.rev ?? 0 } });
    this.cloud = { rev: ifMatchRev + 1, body, updatedAt: Date.now() };
    return { rev: this.cloud.rev, updatedAt: this.cloud.updatedAt, size: body.length };
  }
  async createTransfer(): Promise<TransferCreateResponse> {
    const r = rand(Date.now() & 0xffff);
    let code = '';
    for (let i = 0; i < 8; i++) code += CODE_ALPHABET[Math.floor(r() * CODE_ALPHABET.length)] ?? 'A';
    return { code, expiresAt: Date.now() + 15 * 60_000, ttlSec: 900 };
  }
  async claimTransfer(code: string): Promise<TransferClaimResponse> {
    if (code.replace(/[\s-]/g, '').toUpperCase() === 'BAD00000') throw Object.assign(new Error('invalid_code'), { status: 404, code: 'invalid_code' });
    return { playerId: 'mock0000mock0000', secret: 'y'.repeat(32), name: this.name };
  }
  async submitRun(run: RunSubmission): Promise<RunResponse> {
    return { id: 1, score: run.score ?? 0, status: 'ok', mode: run.coop ? 'coop' : 'solo', flags: [], duplicate: false, best: true, bestScore: run.score ?? 0, rank: 9, weekRank: 4, classRank: 3 };
  }
  async submitRunQueued(run: RunSubmission): Promise<{ status: 'submitted'; result: RunResponse } | { status: 'queued' }> {
    return { status: 'submitted', result: await this.submitRun(run) };
  }
  async flushRunQueue(): Promise<unknown> {
    return { sent: 0 };
  }
  async leaderboard(q: Partial<LeaderboardQuery> & Pick<LeaderboardQuery, 'zone'>): Promise<LeaderboardResponse> {
    if (this.offline) throw Object.assign(new Error('offline'), { status: 0, code: 'network' });
    await new Promise((r) => setTimeout(r, 180));
    return board({ mode: q.mode ?? 'solo', zone: q.zone, difficulty: q.difficulty ?? 'normal', class: q.class ?? 'all', period: q.period ?? 'all', limit: q.limit ?? 25 }, this.name);
  }
  async createRoom(): Promise<{ room: string }> {
    return { room: 'K7M2QX' };
  }
  coopSocketUrl(room: string): string {
    return `wss://mock.invalid/api/v1/coop/${room}`;
  }
}

type Handler = (e: never) => void;

/** Scripted lobby: you are the host, two friends join over the first seconds and tick "ready". */
export class MockCoopLink implements CoopLink {
  state: CoopLink['state'] = 'idle';
  room = '';
  slot = -1;
  host = 0;
  phase: CoopLink['phase'] = 'lobby';
  players: LobbyPlayer[] = [];
  latencyMs = 42;
  private handlers = new Map<string, Set<Handler>>();
  private timers: ReturnType<typeof setTimeout>[] = [];
  private me: Loadout | null = null;

  constructor(room: string, private readonly asGuest = false) {
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
    for (const fn of this.handlers.get(type) ?? []) (fn as (e: TransportEvents[K]) => void)(payload);
  }

  private pushState(): void {
    this.emit('roomState', { t: 'roomState', room: this.room, phase: this.phase, host: this.host as Slot, epoch: 1, players: this.players });
  }

  async connect(): Promise<Extract<ServerMessage, { t: 'hello' }>> {
    this.state = 'connecting';
    this.emit('state', this.state);
    await new Promise((r) => setTimeout(r, 250));
    this.state = 'open';
    this.slot = this.asGuest ? 1 : 0;
    this.host = 0;
    this.players = this.asGuest ? [{ slot: 0, name: 'Aslan_Yürek', connected: true, ready: true, loadout: { classId: 'warrior', doctrine: 'a', sex: 'm', empire: 'chowon', tier: 1 } }] : [];
    this.emit('state', this.state);
    const hello = { t: 'hello', proto: 1, room: this.room, slot: this.slot as Slot, host: this.host as Slot, epoch: 1, phase: this.phase, serverTime: Date.now(), players: this.players, limits: { maxPlayers: 4, inputBytes: 64, eventBytes: 512, snapshotBytes: 16384 } } as const;
    this.emit('hello', hello);
    return hello;
  }

  join(loadout: Loadout, ready = false): boolean {
    this.me = loadout;
    const mine: LobbyPlayer = { slot: this.slot as Slot, name: 'Kahraman2841', connected: true, ready, loadout };
    this.players = [...this.players.filter((p) => p.slot !== this.slot), mine].sort((a, b) => a.slot - b.slot);
    this.pushState();
    if (!this.asGuest && this.players.length === 1) {
      this.timers.push(
        setTimeout(() => {
          this.players = [...this.players, { slot: 1, name: 'Zeynep', connected: true, ready: false, loadout: { classId: 'shaman', doctrine: 'b', sex: 'f', empire: 'jihae', tier: 0 } }];
          this.pushState();
        }, 1200),
        setTimeout(() => {
          this.players = [...this.players, { slot: 2, name: 'Bozkurt', connected: true, ready: false, loadout: { classId: 'wolfman', doctrine: 'a', sex: 'm', empire: 'saehwa', tier: 2 } }];
          this.pushState();
        }, 2600),
        setTimeout(() => {
          this.players = this.players.map((p) => (p.slot === 1 ? { ...p, ready: true } : p));
          this.pushState();
        }, 3800),
      );
    }
    return true;
  }

  start(): boolean {
    this.phase = 'running';
    this.pushState();
    return true;
  }

  leave(): void {
    this.close();
  }

  close(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    this.state = 'closed';
    this.emit('state', this.state);
  }

  /** test hook: current local loadout */
  get loadout(): Loadout | null {
    return this.me;
  }
}
