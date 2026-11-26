import { exports } from 'cloudflare:workers';
import { COOP_SUBPROTOCOL, parseServerMessage, type CoopCreateResponse, type Loadout, type ServerMessage } from '@ms/shared';
import { BASE, call, json, register, type TestPlayer } from './helpers';

export const LOADOUT: Loadout = { classId: 'warrior', doctrine: 'a', sex: 'm', empire: 'saehwa', tier: 1 };

type Frame = ServerMessage | { binary: ArrayBuffer };

/** Client-side view of one WebSocket: ordered inbox + awaiting helpers (no timers: callers await real messages). */
export class TestSocket {
  readonly inbox: Frame[] = [];
  closed: { code: number; reason: string } | null = null;
  private waiters: (() => void)[] = [];
  private syncCounter = 0;

  constructor(
    readonly ws: WebSocket,
    readonly player: TestPlayer,
  ) {
    ws.binaryType = 'arraybuffer';
    ws.accept();
    ws.addEventListener('message', (ev) => {
      const data = ev.data;
      if (typeof data === 'string') {
        const parsed = parseServerMessage(data);
        if (!parsed.ok) throw new Error(`server sent an invalid frame: ${data}`);
        this.inbox.push(parsed.value);
      } else if (data instanceof ArrayBuffer) {
        this.inbox.push({ binary: data });
      }
      this.wake();
    });
    ws.addEventListener('close', (ev) => {
      this.closed = { code: ev.code, reason: ev.reason };
      this.wake();
    });
  }

  private wake(): void {
    const waiting = this.waiters;
    this.waiters = [];
    for (const w of waiting) w();
  }

  private async until(check: () => boolean): Promise<void> {
    while (!check()) {
      const { promise, resolve } = Promise.withResolvers<void>();
      this.waiters.push(resolve);
      await promise;
    }
  }

  send(msg: unknown): void {
    this.ws.send(JSON.stringify(msg));
  }

  sendRaw(data: string | ArrayBuffer): void {
    this.ws.send(data);
  }

  /**
   * Waits for the first inbox message of `type` matching `where`, removes it and any earlier non-matching messages of the
   * same type (skipped state updates); messages of other types stay queued so `sync()` can assert on them.
   */
  async next<T extends ServerMessage['t']>(type: T, where?: (m: Extract<ServerMessage, { t: T }>) => boolean): Promise<Extract<ServerMessage, { t: T }>> {
    let found: Extract<ServerMessage, { t: T }> | undefined;
    await this.until(() => {
      const idx = this.inbox.findIndex((m) => 't' in m && m.t === type && (!where || where(m as Extract<ServerMessage, { t: T }>)));
      if (idx < 0) return false;
      found = this.inbox[idx] as Extract<ServerMessage, { t: T }>;
      const kept = this.inbox.filter((m, i) => i > idx || !('t' in m && m.t === type));
      this.inbox.splice(0, this.inbox.length, ...kept);
      return true;
    });
    return found as Extract<ServerMessage, { t: T }>;
  }

  async nextBinary(): Promise<ArrayBuffer> {
    let found: ArrayBuffer | undefined;
    await this.until(() => {
      const idx = this.inbox.findIndex((m) => 'binary' in m);
      if (idx < 0) return false;
      const frame = this.inbox.splice(0, idx + 1).pop() as { binary: ArrayBuffer };
      found = frame.binary;
      return true;
    });
    return found as ArrayBuffer;
  }

  /** Round-trips a ping so every message the room routed to this socket earlier has arrived; returns and clears the inbox. */
  async sync(): Promise<Frame[]> {
    const ts = ++this.syncCounter;
    this.send({ t: 'ping', ts });
    await this.next('pong', (m) => m.ts === ts);
    return this.inbox.splice(0, this.inbox.length);
  }

  async untilClosed(): Promise<{ code: number; reason: string }> {
    await this.until(() => this.closed !== null);
    return this.closed as { code: number; reason: string };
  }

  close(): void {
    this.ws.close(1000, 'bye');
  }
}

export async function createRoom(host: TestPlayer): Promise<string> {
  const res = await call('/coop', { method: 'POST', token: host.token, ip: host.ip });
  if (res.status !== 201) throw new Error(`createRoom failed: ${res.status} ${await res.text()}`);
  return (await json<CoopCreateResponse>(res)).room;
}

export async function upgrade(room: string, p: TestPlayer): Promise<Response> {
  return exports.default.fetch(new Request(`${BASE}/coop/${room}`, {
    headers: {
      Upgrade: 'websocket',
      'cf-connecting-ip': p.ip,
      'Sec-WebSocket-Protocol': `${COOP_SUBPROTOCOL}, auth.${p.token}`,
    },
  }));
}

export async function connect(room: string, p: TestPlayer): Promise<TestSocket> {
  const res = await upgrade(room, p);
  if (res.status !== 101 || !res.webSocket) throw new Error(`upgrade failed: ${res.status} ${await res.text()}`);
  return new TestSocket(res.webSocket, p);
}

/** Host + `guests` connected to a fresh lobby, hello consumed. */
export async function lobby(guests = 1): Promise<{ room: string; host: TestSocket; guests: TestSocket[]; players: TestPlayer[] }> {
  const hostPlayer = await register();
  const room = await createRoom(hostPlayer);
  const host = await connect(room, hostPlayer);
  await host.next('hello');
  const sockets: TestSocket[] = [];
  const players = [hostPlayer];
  for (let i = 0; i < guests; i++) {
    const p = await register();
    players.push(p);
    const g = await connect(room, p);
    await g.next('hello');
    sockets.push(g);
  }
  await host.sync();
  for (const g of sockets) await g.sync();
  return { room, host, guests: sockets, players };
}

/** Everyone sends their loadout, guests mark ready, host starts; returns after all received `start`. */
export async function startRun(l: { host: TestSocket; guests: TestSocket[] }, zone = 'yeonmu', seed = 42): Promise<void> {
  l.host.send({ t: 'join', loadout: LOADOUT });
  for (const g of l.guests) g.send({ t: 'join', loadout: LOADOUT, ready: true });
  for (const g of l.guests) await g.sync();
  await l.host.sync();
  l.host.send({ t: 'start', zone, difficulty: 'normal', seed });
  await l.host.next('start');
  for (const g of l.guests) await g.next('start');
  await l.host.sync();
  for (const g of l.guests) await g.sync();
}
