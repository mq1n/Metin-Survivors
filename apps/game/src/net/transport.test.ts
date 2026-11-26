import {
  COOP_CLOSE,
  COOP_LIMITS,
  COOP_SUBPROTOCOL,
  PING_FRAME,
  SnapshotFlags,
  encodeSnapshot,
  readSnapshotHeader,
  type Loadout,
  type ServerMessage,
} from '@ms/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoopTransport, type CloseInfo, type TransportState } from './transport';

class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  binaryType = 'blob';
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly sent: (string | ArrayBuffer)[] = [];
  closedWith: { code: number; reason: string } | null = null;

  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {
    FakeSocket.instances.push(this);
  }
  send(data: string | ArrayBuffer): void {
    this.sent.push(data);
  }
  close(code = 1000, reason = ''): void {
    this.closedWith = { code, reason };
    this.readyState = 3;
  }
  // test controls
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(msg: ServerMessage | ArrayBuffer): void {
    this.onmessage?.({ data: msg instanceof ArrayBuffer ? msg : JSON.stringify(msg) });
  }
  receiveRaw(text: string): void {
    this.onmessage?.({ data: text });
  }
  drop(code = 1006, reason = ''): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}

const CREDS = { playerId: 'P'.repeat(16), secret: 's'.repeat(32) };
const LOADOUT: Loadout = { classId: 'warrior', doctrine: 'a', sex: 'm', empire: 'saehwa', tier: 1 };
const URL_ = 'wss://api.example/api/v1/coop/ABC234';

function hello(over: Partial<Extract<ServerMessage, { t: 'hello' }>> = {}): ServerMessage {
  return {
    t: 'hello',
    proto: 1,
    room: 'ABC234',
    slot: 1,
    host: 0,
    epoch: 1,
    phase: 'lobby',
    serverTime: 10_000,
    players: [],
    limits: { maxPlayers: 4, inputBytes: COOP_LIMITS.inputBytes, eventBytes: COOP_LIMITS.eventBytes, snapshotBytes: COOP_LIMITS.snapshotBytes },
    ...over,
  };
}

function make(opts: { reconnect?: boolean; maxReconnectAttempts?: number; now?: () => number } = {}): CoopTransport {
  return new CoopTransport({ url: URL_, credentials: CREDS, WebSocketImpl: FakeSocket as unknown as typeof WebSocket, pingIntervalMs: 5000, ...opts });
}

async function connected(t: CoopTransport, h: Partial<Extract<ServerMessage, { t: 'hello' }>> = {}): Promise<FakeSocket> {
  const p = t.connect();
  const ws = FakeSocket.instances.at(-1) as FakeSocket;
  ws.open();
  ws.receive(hello(h));
  await p;
  return ws;
}

beforeEach(() => {
  FakeSocket.instances = [];
});
afterEach(() => {
  vi.useRealTimers();
});

describe('connect', () => {
  it('opens with the relay subprotocol + auth token and resolves on hello', async () => {
    const t = make();
    const states: TransportState[] = [];
    t.on('state', (s) => states.push(s));
    const p = t.connect();
    const ws = FakeSocket.instances[0] as FakeSocket;
    expect(ws.url).toBe(URL_);
    expect(ws.protocols).toEqual([COOP_SUBPROTOCOL, `auth.${CREDS.playerId}.${CREDS.secret}`]);
    expect(ws.binaryType).toBe('arraybuffer');
    ws.open();
    expect(t.isOpen).toBe(true);
    ws.receive(hello({ slot: 2, host: 0, epoch: 3 }));
    const h = await p;
    expect(h.slot).toBe(2);
    expect(t).toMatchObject({ slot: 2, host: 0, epoch: 3, room: 'ABC234', phase: 'lobby', isHost: false });
    expect(states).toEqual(['connecting', 'open']);
    t.close();
  });

  it('rejects when the socket closes before hello', async () => {
    const t = make();
    const p = t.connect();
    (FakeSocket.instances[0] as FakeSocket).drop(1006);
    await expect(p).rejects.toThrow(/connection failed \(code 1006\)/);
    expect(t.state).toBe('closed');
  });

  it('rejects when closed by the caller while connecting', async () => {
    const t = make();
    const p = t.connect();
    t.close();
    await expect(p).rejects.toThrow(/closed/);
  });

  it('estimates the server clock from hello', async () => {
    let now = 1_000;
    const t = make({ now: () => now });
    await connected(t, { serverTime: 5_000 });
    now = 1_500;
    expect(t.serverNow()).toBe(5_500);
  });
});

describe('inbound messages', () => {
  it('tracks room state and dispatches typed events', async () => {
    const t = make();
    const ws = await connected(t, { slot: 0, host: 0 });
    expect(t.isHost).toBe(true);
    const seen: string[] = [];
    t.on('roomState', (m) => seen.push(`roomState:${m.host}:${m.epoch}`));
    t.on('start', (m) => seen.push(`start:${m.zone}:${m.seed}`));
    t.on('end', () => seen.push('end'));
    t.on('input', (m) => seen.push(`input:${m.slot}:${m.mx}`));
    t.on('event', (m) => seen.push(`event:${m.from}:${m.k}`));
    t.on('pick', (m) => seen.push(`pick:${m.slot}:${m.index}`));
    t.on('pause', (m) => seen.push(`pause:${m.from}`));
    t.on('resume', (m) => seen.push(`resume:${m.from}`));
    t.on('error', (m) => seen.push(`error:${m.code}`));

    ws.receive({ t: 'roomState', room: 'ABC234', phase: 'lobby', host: 1, epoch: 2, players: [], cause: { kind: 'hostChanged', slot: 1, from: 0 } });
    expect(t).toMatchObject({ host: 1, epoch: 2, isHost: false });
    ws.receive({ t: 'start', zone: 'seori', difficulty: 'hard', seed: 77, startAt: 1, slots: [0, 1] });
    expect(t.phase).toBe('running');
    ws.receive({ t: 'input', slot: 1, seq: 1, tick: 1, mx: 5, mz: 0 });
    ws.receive({ t: 'event', from: 1, k: 'emote' });
    ws.receive({ t: 'pick', slot: 1, id: 3, index: 2 });
    ws.receive({ t: 'pause', from: 1 });
    ws.receive({ t: 'resume', from: 1 });
    ws.receive({ t: 'error', code: 'rate_limited', message: 'slow' });
    ws.receive({ t: 'end', victory: true });
    expect(t.phase).toBe('lobby');
    expect(seen).toEqual(['roomState:1:2', 'start:seori:77', 'input:1:5', 'event:1:emote', 'pick:1:2', 'pause:1', 'resume:1', 'error:rate_limited', 'end']);
  });

  it('drops malformed frames and survives throwing handlers', async () => {
    const t = make();
    const ws = await connected(t);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const got: string[] = [];
    t.on('event', () => {
      throw new Error('boom');
    });
    t.on('event', (m) => got.push(m.k));
    ws.receiveRaw('not json');
    ws.receiveRaw('{"t":"mystery"}');
    ws.receive({ t: 'event', from: 0, k: 'ok' });
    expect(got).toEqual(['ok']);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(err).toHaveBeenCalled();
  });

  it('unsubscribes', async () => {
    const t = make();
    const ws = await connected(t);
    const got: string[] = [];
    const off = t.on('event', (m) => got.push(m.k));
    ws.receive({ t: 'event', from: 0, k: 'a' });
    off();
    ws.receive({ t: 'event', from: 0, k: 'b' });
    expect(got).toEqual(['a']);
  });

  it('delivers snapshots and drops frames from a stale host epoch', async () => {
    const t = make();
    const ws = await connected(t, { epoch: 3 });
    const got: number[] = [];
    t.on('snapshot', (s) => got.push(s.header.seq));
    const frame = (seq: number, epoch: number) => encodeSnapshot({ flags: SnapshotFlags.keyframe, seq, tick: seq, epoch, baseDelta: 0 }, new Uint8Array([seq, 2, 3]));
    ws.receive(frame(1, 3));
    ws.receive(frame(2, 2)); // previous host
    ws.receive(frame(3, 4)); // newer epoch (roomState not processed yet)
    ws.receive(new ArrayBuffer(4)); // junk
    expect(got).toEqual([1, 3]);
    let payload: number[] = [];
    t.on('snapshot', (s) => (payload = [...s.payload]));
    ws.receive(frame(9, 3));
    expect(payload).toEqual([9, 2, 3]);
  });
});

describe('outbound messages', () => {
  it('serialises control messages and refuses to send while closed', async () => {
    const t = make();
    expect(t.join(LOADOUT)).toBe(false);
    const ws = await connected(t, { slot: 0, host: 0 });
    expect(t.join(LOADOUT, true)).toBe(true);
    expect(t.start('yeonmu', 'normal', 5)).toBe(true);
    expect(t.end(true)).toBe(true);
    expect(t.input({ seq: 1, tick: 2, mx: 3, mz: -4, aim: 5, btn: 1 })).toBe(true);
    expect(t.event('bossSpawn', { id: 'horyeong' }, { tick: 9, to: 1 })).toBe(true);
    expect(t.pick(7, 2)).toBe(true);
    expect(t.pause('modal')).toBe(true);
    expect(t.resume()).toBe(true);
    expect(ws.sent.map((m) => JSON.parse(m as string))).toEqual([
      { t: 'join', loadout: LOADOUT, ready: true },
      { t: 'start', zone: 'yeonmu', difficulty: 'normal', seed: 5 },
      { t: 'end', victory: true },
      { t: 'input', seq: 1, tick: 2, mx: 3, mz: -4, aim: 5, btn: 1 },
      { t: 'event', k: 'bossSpawn', d: { id: 'horyeong' }, tick: 9, to: 1 },
      { t: 'pick', id: 7, index: 2 },
      { t: 'pause', reason: 'modal' },
      { t: 'resume' },
    ]);
  });

  it('enforces the relay size caps locally', async () => {
    const t = make();
    const ws = await connected(t);
    expect(t.event('big', 'x'.repeat(COOP_LIMITS.eventBytes))).toBe(false);
    expect(t.input({ seq: 1, tick: 1, mx: 0, mz: 0 })).toBe(true);
    expect(ws.sent).toHaveLength(1);
  });

  it('only the host sends snapshots, stamped with the current host epoch', async () => {
    const guest = make();
    const gws = await connected(guest, { slot: 1, host: 0 });
    expect(guest.sendSnapshot({ flags: 1, seq: 1, tick: 1, baseDelta: 0 }, new Uint8Array(4))).toBe(false);
    expect(gws.sent).toHaveLength(0);

    const host = make();
    const hws = await connected(host, { slot: 0, host: 0, epoch: 5 });
    expect(host.sendSnapshot({ flags: SnapshotFlags.keyframe, seq: 11, tick: 600, baseDelta: 0 }, new Uint8Array([9, 9]))).toBe(true);
    const frame = hws.sent[0] as ArrayBuffer;
    expect(readSnapshotHeader(frame)).toEqual({ flags: SnapshotFlags.keyframe, seq: 11, tick: 600, epoch: 5, baseDelta: 0 });
    expect(frame.byteLength).toBe(18);
    expect(host.sendSnapshot({ flags: 1, seq: 12, tick: 601, baseDelta: 0 }, new Uint8Array(COOP_LIMITS.snapshotBytes))).toBe(false);
  });

  it('leave() tells the room and closes for good', async () => {
    const t = make();
    const ws = await connected(t);
    t.leave();
    expect(JSON.parse(ws.sent[0] as string)).toEqual({ t: 'leave' });
    expect(ws.closedWith?.code).toBe(COOP_CLOSE.normal);
    expect(t.state).toBe('closed');
  });
});

describe('keepalive and latency', () => {
  it('pings with the bare keepalive frame and smooths round-trip time', async () => {
    vi.useFakeTimers();
    let now = 0;
    const t = make({ now: () => now });
    const ws = await connected(t);
    now = 5000;
    await vi.advanceTimersByTimeAsync(5000);
    expect(ws.sent).toEqual([PING_FRAME]);
    now = 5040;
    ws.receive({ t: 'pong' } as ServerMessage);
    expect(t.latencyMs).toBe(40);
    now = 10_000;
    await vi.advanceTimersByTimeAsync(5000);
    now = 10_100;
    ws.receive({ t: 'pong' } as ServerMessage);
    expect(t.latencyMs).toBeCloseTo(40 * 0.7 + 100 * 0.3, 5);
    t.close();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(ws.sent).toHaveLength(2);
  });
});

describe('reconnect', () => {
  it('reconnects with backoff after an unexpected drop and re-announces hello', async () => {
    vi.useFakeTimers();
    const t = make();
    const closes: CloseInfo[] = [];
    const states: TransportState[] = [];
    t.on('close', (c) => closes.push(c));
    t.on('state', (s) => states.push(s));
    const first = await connected(t, { slot: 1 });
    first.drop(1006);
    expect(closes).toEqual([{ code: 1006, reason: '', willReconnect: true }]);
    expect(t.state).toBe('reconnecting');
    expect(FakeSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(FakeSocket.instances).toHaveLength(2);
    const second = FakeSocket.instances[1] as FakeSocket;
    expect(second.protocols).toEqual(first.protocols);
    second.open();
    const rejoined: number[] = [];
    t.on('hello', (h) => rejoined.push(h.slot));
    second.receive(hello({ slot: 1, phase: 'running' }));
    expect(rejoined).toEqual([1]);
    expect(t.phase).toBe('running');
    expect(states).toEqual(['connecting', 'open', 'reconnecting', 'open']);

    // backoff doubles per consecutive failure and gives up after the limit
    second.drop(1006);
    await vi.advanceTimersByTimeAsync(500);
    const third = FakeSocket.instances[2] as FakeSocket;
    third.drop(1006); // never opened → attempts keep growing
    await vi.advanceTimersByTimeAsync(999);
    expect(FakeSocket.instances).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeSocket.instances).toHaveLength(4);
    t.close();
  });

  it('stops after the configured number of attempts', async () => {
    vi.useFakeTimers();
    const t = make({ maxReconnectAttempts: 2 });
    const first = await connected(t);
    first.drop(1006);
    await vi.advanceTimersByTimeAsync(500);
    (FakeSocket.instances[1] as FakeSocket).drop(1006);
    await vi.advanceTimersByTimeAsync(1000);
    const last = FakeSocket.instances[2] as FakeSocket;
    const closes: CloseInfo[] = [];
    t.on('close', (c) => closes.push(c));
    last.drop(1006);
    expect(closes[0]?.willReconnect).toBe(false);
    expect(t.state).toBe('closed');
  });

  it('does not reconnect after fatal close codes, caller close, or when disabled', async () => {
    for (const code of [COOP_CLOSE.replaced, COOP_CLOSE.idle, COOP_CLOSE.roomClosed, COOP_CLOSE.rateAbuse, COOP_CLOSE.policy]) {
      const t = make();
      const ws = await connected(t);
      const closes: CloseInfo[] = [];
      t.on('close', (c) => closes.push(c));
      ws.drop(code, 'x');
      expect(closes[0], String(code)).toMatchObject({ code, willReconnect: false });
      expect(t.state).toBe('closed');
    }
    const user = make();
    const uws = await connected(user);
    user.close();
    uws.drop(1000);
    expect(FakeSocket.instances.filter((s) => s.url === URL_).length).toBeGreaterThan(0);

    const off = make({ reconnect: false });
    const ows = await connected(off);
    const before = FakeSocket.instances.length;
    ows.drop(1006);
    expect(FakeSocket.instances).toHaveLength(before);
    expect(off.state).toBe('closed');
  });

  it('ignores events from sockets that were replaced', async () => {
    vi.useFakeTimers();
    const t = make();
    const first = await connected(t);
    first.drop(1006);
    await vi.advanceTimersByTimeAsync(500);
    const second = FakeSocket.instances[1] as FakeSocket;
    second.open();
    const seen: string[] = [];
    t.on('event', (m) => seen.push(m.k));
    first.receive({ t: 'event', from: 0, k: 'stale' });
    second.receive({ t: 'event', from: 0, k: 'fresh' });
    expect(seen).toEqual(['fresh']);
  });

  it('reuses an already-open socket on connect() without opening a duplicate WebSocket', async () => {
    const t = make();
    await connected(t, { slot: 0, host: 0, phase: 'lobby' });
    expect(FakeSocket.instances).toHaveLength(1);
    const hellos: number[] = [];
    t.on('hello', (m) => hellos.push(m.slot));
    const again = await t.connect();
    await Promise.resolve();
    expect(FakeSocket.instances).toHaveLength(1);
    expect(again).toMatchObject({ slot: 0, host: 0, phase: 'lobby' });
    expect(hellos).toEqual([0]);
    t.close();
  });
});
