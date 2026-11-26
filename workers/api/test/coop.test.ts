import { env } from 'cloudflare:workers';
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import {
  COOP_CLOSE,
  COOP_LIMITS,
  COOP_MAX_PLAYERS,
  PING_FRAME,
  PONG_FRAME,
  SnapshotFlags,
  encodeSnapshot,
  readSnapshotHeader,
  type LobbyPlayer,
} from '@ms/shared';
import { describe, expect, it } from 'vitest';
import type { CoopRoom } from '../src/coopRoom';
import { LOADOUT, connect, createRoom, lobby, startRun, upgrade } from './coopHelpers';
import { call, json, register } from './helpers';

/** Test-only window into the room's private in-memory state. */
interface RoomInternals {
  room: { createdAt: number; lastActivity: number; roster: { slot: number; graceUntil: number | null }[] } | null;
}
// The Durable Object class keeps `room` private; tests deliberately reach in to age timestamps instead of sleeping.
const internalsOf = (instance: CoopRoom): RoomInternals => instance as unknown as RoomInternals;

const stubFor = (code: string) => env.COOP_ROOM.get(env.COOP_ROOM.idFromName(code));

describe('CoopRoom: joining', () => {
  it('seats the creator as host in slot 0 and sends hello + roomState', async () => {
    const host = await register();
    const room = await createRoom(host);
    const s = await connect(room, host);
    const hello = await s.next('hello');
    expect(hello).toMatchObject({ proto: 1, room, slot: 0, host: 0, epoch: 1, phase: 'lobby' });
    expect(hello.limits).toMatchObject({ maxPlayers: COOP_MAX_PLAYERS, inputBytes: COOP_LIMITS.inputBytes, snapshotBytes: COOP_LIMITS.snapshotBytes });
    expect(hello.players).toHaveLength(1);
    expect(hello.players[0]).toMatchObject({ slot: 0, name: host.name, connected: true, ready: false, loadout: null });
    const state = await s.next('roomState');
    expect(state).toMatchObject({ room, host: 0, phase: 'lobby', cause: { kind: 'join', slot: 0 } });
    s.close();
  });

  it('seats guests in free slots and tells everyone', async () => {
    const l = await lobby(2);
    const hello = l.guests.length;
    expect(hello).toBe(2);
    l.host.send({ t: 'join', loadout: LOADOUT });
    const state = await l.guests[1]?.next('roomState', (m) => m.players.some((p) => p.loadout !== null));
    expect(state?.players.map((p: LobbyPlayer) => p.slot)).toEqual([0, 1, 2]);
    expect(state?.players.map((p: LobbyPlayer) => p.connected)).toEqual([true, true, true]);
    expect(state?.players.map((p: LobbyPlayer) => p.name)).toEqual(l.players.map((p) => p.name));
    expect(state?.host).toBe(0);
  });

  it('refuses a fifth player and unknown rooms, and requires auth', async () => {
    const l = await lobby(3);
    expect(l.guests).toHaveLength(3);
    const extra = await register();
    const full = await upgrade(l.room, extra);
    expect(full.status).toBe(409);
    expect((await json<{ error: { code: string } }>(full)).error.code).toBe('room_full');

    const missing = await upgrade('ZZZ222', extra);
    expect(missing.status).toBe(404);
    expect((await json<{ error: { code: string } }>(missing)).error.code).toBe('room_not_found');

    const anon = await call(`/coop/${l.room}`, { headers: { upgrade: 'websocket' } });
    expect(anon.status).toBe(401);
  });

  it('echoes only the relay subprotocol, never the auth token', async () => {
    const p = await register();
    const room = await createRoom(p);
    const res = await upgrade(room, p);
    expect(res.status).toBe(101);
    expect(res.headers.get('sec-websocket-protocol')).toBe('ms.coop.v1');
    res.webSocket?.accept();
    res.webSocket?.close(1000, 'done');
  });

  it('a second connection by the same player replaces the first and keeps the slot', async () => {
    const l = await lobby(1);
    const guestPlayer = l.players[1];
    if (!guestPlayer) throw new Error('missing guest');
    const second = await connect(l.room, guestPlayer);
    const hello = await second.next('hello');
    expect(hello.slot).toBe(1);
    const old = l.guests[0];
    const err = await old?.next('error');
    expect(err?.code).toBe('replaced');
    expect((await old?.untilClosed())?.code).toBe(COOP_CLOSE.replaced);
    const state = await l.host.next('roomState', (m) => m.cause?.kind === 'rejoin');
    expect(state.players).toHaveLength(2);
    expect(state.players[1]?.connected).toBe(true);
  });
});

describe('CoopRoom: lobby and start', () => {
  it('tracks loadouts and ready flags', async () => {
    const l = await lobby(1);
    const guest = l.guests[0];
    guest?.send({ t: 'join', loadout: { ...LOADOUT, classId: 'yacha', tier: 3, look: [1, 2] }, ready: true });
    const state = await l.host.next('roomState', (m) => m.players[1]?.ready === true);
    expect(state.players[1]).toMatchObject({ ready: true, loadout: { classId: 'yacha', tier: 3, look: [1, 2] } });
    // unready only → cause "ready"
    guest?.send({ t: 'join', loadout: { ...LOADOUT, classId: 'yacha', tier: 3, look: [1, 2] }, ready: false });
    const again = await l.host.next('roomState', (m) => m.players[1]?.ready === false);
    expect(again.cause).toEqual({ kind: 'ready', slot: 1 });
  });

  it('validates loadouts', async () => {
    const l = await lobby(1);
    l.guests[0]?.send({ t: 'join', loadout: { ...LOADOUT, classId: 'mage' } });
    const err = await l.guests[0]?.next('error');
    expect(err?.code).toBe('bad_message');
  });

  it('only the host may start, and only when everyone is ready', async () => {
    const l = await lobby(1);
    const guest = l.guests[0];
    guest?.send({ t: 'start', zone: 'yeonmu', difficulty: 'normal', seed: 1 });
    expect((await guest?.next('error'))?.code).toBe('not_host');

    l.host.send({ t: 'start', zone: 'yeonmu', difficulty: 'normal', seed: 1 });
    expect((await l.host.next('error')).code).toBe('not_ready');

    l.host.send({ t: 'join', loadout: LOADOUT });
    guest?.send({ t: 'join', loadout: LOADOUT, ready: false });
    await guest?.sync();
    l.host.send({ t: 'start', zone: 'yeonmu', difficulty: 'normal', seed: 1 });
    expect((await l.host.next('error')).code).toBe('not_ready');

    guest?.send({ t: 'join', loadout: LOADOUT, ready: true });
    await guest?.sync();
    await l.host.sync();
    l.host.send({ t: 'start', zone: 'seori', difficulty: 'hard', seed: 777 });
    const [hs, gs] = await Promise.all([l.host.next('start'), guest?.next('start')]);
    for (const start of [hs, gs]) {
      expect(start).toMatchObject({ zone: 'seori', difficulty: 'hard', seed: 777, slots: [0, 1] });
      expect(start?.startAt).toBeGreaterThan(Date.now());
    }
    const state = await l.host.next('roomState', (m) => m.phase === 'running');
    expect(state.cause).toEqual({ kind: 'start', slot: 0 });
  });

  it('locks the room once running: no late join, no loadout changes, no second start', async () => {
    const l = await lobby(1);
    await startRun(l);
    const late = await register();
    const res = await upgrade(l.room, late);
    expect(res.status).toBe(409);
    expect((await json<{ error: { code: string } }>(res)).error.code).toBe('room_in_progress');
    l.guests[0]?.send({ t: 'join', loadout: LOADOUT });
    expect((await l.guests[0]?.next('error'))?.code).toBe('wrong_phase');
    l.host.send({ t: 'start', zone: 'yeonmu', difficulty: 'normal', seed: 1 });
    expect((await l.host.next('error')).code).toBe('wrong_phase');
  });

  it('end returns the room to the lobby with ready flags cleared', async () => {
    const l = await lobby(1);
    await startRun(l);
    l.guests[0]?.send({ t: 'end' });
    expect((await l.guests[0]?.next('error'))?.code).toBe('not_host');
    l.host.send({ t: 'end', victory: true });
    expect(await l.guests[0]?.next('end')).toEqual({ t: 'end', victory: true });
    const state = await l.guests[0]?.next('roomState', (m) => m.phase === 'lobby');
    expect(state?.players.every((p: LobbyPlayer) => !p.ready)).toBe(true);
    // a new player can join the lobby again
    const newcomer = await register();
    const s = await connect(l.room, newcomer);
    expect((await s.next('hello')).slot).toBe(2);
  });
});

describe('CoopRoom: relay', () => {
  it('routes guest input to the host only, stamped with the slot', async () => {
    const l = await lobby(2);
    await startRun(l);
    const [g1, g2] = l.guests;
    g1?.send({ t: 'input', seq: 5, tick: 100, mx: -127, mz: 64, aim: 200, btn: 1 });
    const got = await l.host.next('input');
    expect(got).toEqual({ t: 'input', slot: 1, seq: 5, tick: 100, mx: -127, mz: 64, aim: 200, btn: 1 });
    expect(await g2?.sync()).toEqual([]);
    expect(await g1?.sync()).toEqual([]);
    // host input is refused
    l.host.send({ t: 'input', seq: 1, tick: 1, mx: 0, mz: 0 });
    expect((await l.host.next('error')).code).toBe('bad_message');
  });

  it('ignores input before the run starts', async () => {
    const l = await lobby(1);
    l.guests[0]?.send({ t: 'input', seq: 1, tick: 1, mx: 0, mz: 0 });
    expect(await l.host.sync()).toEqual([]);
  });

  it('relays events: host → all or one slot, guest → host only', async () => {
    const l = await lobby(2);
    await startRun(l);
    const [g1, g2] = l.guests;
    l.host.send({ t: 'event', k: 'bossSpawn', tick: 900, d: { id: 'horyeong' } });
    expect(await g1?.next('event')).toEqual({ t: 'event', from: 0, k: 'bossSpawn', tick: 900, d: { id: 'horyeong' } });
    expect((await g2?.next('event'))?.k).toBe('bossSpawn');

    l.host.send({ t: 'event', k: 'cards', to: 2, d: [1, 2, 3] });
    expect((await g2?.next('event'))?.d).toEqual([1, 2, 3]);
    expect((await g1?.sync())?.some((m) => 't' in m && m.t === 'event')).toBe(false);

    g1?.send({ t: 'event', k: 'emote', d: 'gg' });
    expect(await l.host.next('event')).toEqual({ t: 'event', from: 1, k: 'emote', d: 'gg' });
    expect(await g2?.sync()).toEqual([]);

    l.host.send({ t: 'event', k: 'x', to: 3 });
    expect((await l.host.next('error')).code).toBe('bad_target');
    l.host.send({ t: 'event', k: 'x', to: 0 });
    expect((await l.host.next('error')).code).toBe('bad_target');
  });

  it('routes card picks, pause and resume', async () => {
    const l = await lobby(2);
    await startRun(l);
    const [g1, g2] = l.guests;
    g2?.send({ t: 'pick', id: 17, index: 2 });
    expect(await l.host.next('pick')).toEqual({ t: 'pick', slot: 2, id: 17, index: 2 });
    expect(await g1?.sync()).toEqual([]);
    l.host.send({ t: 'pick', id: 1, index: 0 });
    expect((await l.host.next('error')).code).toBe('bad_message');

    g1?.send({ t: 'pause', reason: 'modal' });
    expect(await l.host.next('pause')).toEqual({ t: 'pause', from: 1, reason: 'modal' });
    expect(await g2?.sync()).toEqual([]);
    l.host.send({ t: 'pause' });
    expect(await g1?.next('pause')).toEqual({ t: 'pause', from: 0 });
    expect((await g2?.next('pause'))?.from).toBe(0);
    l.host.send({ t: 'resume' });
    expect(await g1?.next('resume')).toEqual({ t: 'resume', from: 0 });
    g2?.send({ t: 'resume' });
    expect(await l.host.next('resume')).toEqual({ t: 'resume', from: 2 });
  });

  it('answers ping with pong (typed ping carries the server clock; the bare keepalive frame is auto-answered)', async () => {
    const l = await lobby(1);
    const g = l.guests[0];
    g?.send({ t: 'ping', ts: 4242 });
    const pong = await g?.next('pong');
    expect(pong?.ts).toBe(4242);
    expect(pong?.st).toBeGreaterThan(0);
    g?.sendRaw(PING_FRAME);
    const raw = await g?.next('pong', (m) => m.ts === undefined && m.st === undefined);
    expect(raw).toEqual(JSON.parse(PONG_FRAME));
  });

  it('relays binary snapshots from the host to every guest, byte for byte', async () => {
    const l = await lobby(2);
    await startRun(l);
    const payload = new Uint8Array(1000).map((_, i) => (i * 7) & 255);
    const frame = encodeSnapshot({ flags: SnapshotFlags.keyframe, seq: 9, tick: 540, epoch: 1, baseDelta: 0 }, payload);
    l.host.sendRaw(frame);
    for (const g of l.guests) {
      const got = await g.nextBinary();
      expect(new Uint8Array(got)).toEqual(new Uint8Array(frame));
      expect(readSnapshotHeader(got)).toMatchObject({ seq: 9, tick: 540, epoch: 1 });
    }
    expect(await l.host.sync()).toEqual([]); // never echoed to the sender
  });

  it('refuses snapshots from guests, malformed or oversize ones, and ignores them outside a run', async () => {
    const l = await lobby(1);
    const g = l.guests[0];
    const frame = encodeSnapshot({ flags: 1, seq: 1, tick: 1, epoch: 1, baseDelta: 0 }, new Uint8Array(32));
    // lobby: the host's snapshot is dropped silently
    l.host.sendRaw(frame);
    expect(await g?.sync()).toEqual([]);

    await startRun(l);
    g?.sendRaw(frame);
    expect((await g?.next('error'))?.code).toBe('not_host');
    expect(await l.host.sync()).toEqual([]);

    l.host.sendRaw(new ArrayBuffer(10));
    expect((await l.host.next('error')).code).toBe('bad_message');
    l.host.sendRaw(new ArrayBuffer(COOP_LIMITS.snapshotBytes + 1));
    // the previous error is within the 1 s error throttle; the frame is still dropped
    expect(await g?.sync()).toEqual([]);
    const big = encodeSnapshot({ flags: 1, seq: 2, tick: 2, epoch: 1, baseDelta: 0 }, new Uint8Array(COOP_LIMITS.snapshotBytes - 16));
    expect(big.byteLength).toBe(COOP_LIMITS.snapshotBytes);
    l.host.sendRaw(big);
    expect((await g?.nextBinary())?.byteLength).toBe(COOP_LIMITS.snapshotBytes);
  });

  it('enforces per-message size caps', async () => {
    const l = await lobby(1);
    await startRun(l);
    const g = l.guests[0];
    g?.sendRaw(JSON.stringify({ t: 'input', seq: 1, tick: 1, mx: 0, mz: 0, pad: 'x'.repeat(COOP_LIMITS.inputBytes) }));
    expect((await g?.next('error'))?.code).toBe('too_large');
    expect(await l.host.sync()).toEqual([]);
    l.host.sendRaw(JSON.stringify({ t: 'event', k: 'big', d: 'x'.repeat(COOP_LIMITS.eventBytes) }));
    expect((await l.host.next('error')).code).toBe('too_large');
    expect(await g?.sync()).toEqual([]);
  });

  it('rejects garbage frames', async () => {
    const l = await lobby(1);
    const g = l.guests[0];
    g?.sendRaw('{not json');
    expect((await g?.next('error'))?.code).toBe('bad_message');
  });
});

describe('CoopRoom: rate caps', () => {
  it('drops messages above the per-socket rate and disconnects sustained abusers', async () => {
    const l = await lobby(1);
    await startRun(l);
    const g = l.guests[0];
    if (!g) throw new Error('missing guest');
    // burst far above 30/s (burst 60): the excess must be refused and never reach the host
    const t0 = Date.now();
    for (let i = 0; i < 120; i++) g.send({ t: 'input', seq: i, tick: i, mx: 1, mz: 1 });
    const err = await g.next('error');
    expect(err.code).toBe('rate_limited');
    const delivered = (await l.host.sync()).filter((m) => 't' in m && m.t === 'input').length;
    // the bucket refills at 30/s while the burst is in flight; on a loaded machine that takes longer than usual
    const refill = Math.ceil(30 * ((Date.now() - t0) / 1000));
    expect(delivered).toBeLessThanOrEqual(Math.max(75, 60 + refill));
    expect(delivered).toBeLessThan(120);
    expect(delivered).toBeGreaterThanOrEqual(50);

    // sustained flooding gets the socket closed with a policy code
    for (let i = 0; i < 600 && g.closed === null; i++) g.send({ t: 'input', seq: i, tick: i, mx: 1, mz: 1 });
    const closed = await g.untilClosed();
    expect(closed.code).toBe(COOP_CLOSE.rateAbuse);
    // the abuser's seat is held for reconnection (run in progress) and the host is told
    const state = await l.host.next('roomState', (m) => m.cause?.kind === 'disconnect');
    expect(state.players[1]?.connected).toBe(false);
  });
});

describe('CoopRoom: leaving and host migration', () => {
  it('frees a lobby slot when a guest leaves, and the next joiner takes it', async () => {
    const l = await lobby(2);
    l.guests[0]?.send({ t: 'leave' });
    const state = await l.host.next('roomState', (m) => m.cause?.kind === 'leave');
    expect(state.players.map((p: LobbyPlayer) => p.slot)).toEqual([0, 2]);
    const p = await register();
    const s = await connect(l.room, p);
    expect((await s.next('hello')).slot).toBe(1);
  });

  it('migrates the host to the lowest connected slot when the host leaves the lobby', async () => {
    const l = await lobby(2);
    l.host.close();
    const [g1, g2] = l.guests;
    const state = await g1?.next('roomState', (m) => m.cause?.kind === 'hostChanged');
    expect(state).toMatchObject({ host: 1, epoch: 2, cause: { kind: 'hostChanged', slot: 1, from: 0 } });
    expect(state?.players.map((p: LobbyPlayer) => p.slot)).toEqual([1, 2]);
    const seen = await g2?.next('roomState', (m) => m.cause?.kind === 'hostChanged');
    expect(seen?.host).toBe(1);
    // the new host can run the room
    g1?.send({ t: 'join', loadout: LOADOUT });
    g2?.send({ t: 'join', loadout: LOADOUT, ready: true });
    await g2?.sync();
    await g1?.sync();
    g1?.send({ t: 'start', zone: 'yeonmu', difficulty: 'normal', seed: 5 });
    expect((await g2?.next('start'))?.seed).toBe(5);
  });

  it('migrates mid-run, keeps the old host seat reserved, and lets them rejoin as a guest', async () => {
    const l = await lobby(1);
    await startRun(l);
    const hostPlayer = l.players[0];
    if (!hostPlayer) throw new Error('missing host player');
    l.host.close();
    const g = l.guests[0];
    const state = await g?.next('roomState', (m) => m.cause?.kind === 'hostChanged');
    expect(state).toMatchObject({ host: 1, epoch: 2, phase: 'running' });
    expect(state?.players[0]).toMatchObject({ slot: 0, connected: false });

    // the new host's snapshots now flow; the old host reconnects into their old slot
    const back = await connect(l.room, hostPlayer);
    const hello = await back.next('hello');
    expect(hello).toMatchObject({ slot: 0, host: 1, epoch: 2, phase: 'running' });
    const frame = encodeSnapshot({ flags: 1, seq: 1, tick: 1, epoch: 2, baseDelta: 0 }, new Uint8Array(16));
    g?.sendRaw(frame);
    expect(new Uint8Array(await back.nextBinary())).toEqual(new Uint8Array(frame));
    // and as a guest they can no longer send snapshots
    back.sendRaw(frame);
    expect((await back.next('error')).code).toBe('not_host');
  });

  it('closes the room when the last lobby player leaves', async () => {
    const l = await lobby(0);
    const p = l.players[0];
    if (!p) throw new Error('missing player');
    l.host.send({ t: 'leave' });
    expect((await l.host.untilClosed()).code).toBe(COOP_CLOSE.normal);
    // wait for the room to be torn down via a sync point on a fresh probe
    const probe = await upgrade(l.room, p);
    expect(probe.status).toBe(404);
  });

  it('keeps a disconnected player’s slot reserved for the grace period during a run, then frees it', async () => {
    const l = await lobby(1);
    await startRun(l);
    const g = l.guests[0];
    g?.close();
    const state = await l.host.next('roomState', (m) => m.cause?.kind === 'disconnect');
    expect(state.players[1]).toMatchObject({ slot: 1, connected: false });
    const stub = stubFor(l.room);
    await runInDurableObject(stub, (instance) => {
      const internals = internalsOf(instance);
      const entry = internals.room?.roster.find((e) => e.slot === 1);
      if (entry) entry.graceUntil = Date.now() - 1;
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const after = await l.host.next('roomState', (m) => m.cause?.kind === 'leave');
    expect(after.players.map((p: LobbyPlayer) => p.slot)).toEqual([0]);
  });

  it('completes the RFC 6455 close handshake on client-initiated mid-run close so guests can immediately reconnect', async () => {
    const l = await lobby(1);
    await startRun(l);
    const g = l.guests[0];
    const guestPlayer = l.players[1];
    if (!g || !guestPlayer) throw new Error('missing guest');
    g.ws.close(4000, 'drop');
    const closed = await g.untilClosed();
    expect(closed.code).toBe(4000);
    const disc = await l.host.next('roomState', (m) => m.cause?.kind === 'disconnect');
    expect(disc.players[1]).toMatchObject({ slot: 1, connected: false });

    const back = await connect(l.room, guestPlayer);
    const hello = await back.next('hello');
    expect(hello).toMatchObject({ slot: 1, host: 0, phase: 'running' });
    const rejoin = await l.host.next('roomState', (m) => m.cause?.kind === 'rejoin');
    expect(rejoin.players[1]).toMatchObject({ slot: 1, connected: true });
    back.close();
  });
});

describe('CoopRoom: idle close, expiry and hibernation', () => {
  it('closes idle rooms (alarm) and forgets them', async () => {
    const l = await lobby(1);
    const stub = stubFor(l.room);
    await runInDurableObject(stub, (instance) => {
      const internals = internalsOf(instance);
      if (internals.room) internals.room.lastActivity = Date.now() - 11 * 60_000;
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect((await l.host.untilClosed()).code).toBe(COOP_CLOSE.idle);
    expect((await l.guests[0]?.untilClosed())?.code).toBe(COOP_CLOSE.idle);
    const p = l.players[0];
    if (!p) throw new Error('missing player');
    expect((await upgrade(l.room, p)).status).toBe(404);
  });

  it('does not count keepalive pings as activity but does count gameplay messages', async () => {
    const l = await lobby(1);
    const stub = stubFor(l.room);
    const old = Date.now() - 9 * 60_000;
    await runInDurableObject(stub, (instance) => {
      const internals = internalsOf(instance);
      if (internals.room) internals.room.lastActivity = old;
    });
    l.guests[0]?.send({ t: 'ping', ts: 1 });
    await l.guests[0]?.next('pong');
    const stale = await runInDurableObject(stub, (instance) => internalsOf(instance).room?.lastActivity ?? 0);
    expect(stale).toBe(old);
    l.guests[0]?.send({ t: 'join', loadout: LOADOUT });
    await l.guests[0]?.sync();
    const fresh = await runInDurableObject(stub, (instance) => internalsOf(instance).room?.lastActivity ?? 0);
    expect(fresh).toBeGreaterThan(old + 8 * 60_000);
  });

  it('discards a room whose creator never connects', async () => {
    const host = await register();
    const room = await createRoom(host);
    const stub = stubFor(room);
    await runInDurableObject(stub, (instance) => {
      const internals = internalsOf(instance);
      if (internals.room) internals.room.createdAt = Date.now() - 3 * 60_000;
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect((await upgrade(room, host)).status).toBe(404);
  });

  it('survives hibernation: roster, host and relay keep working after eviction', async () => {
    const l = await lobby(1);
    await startRun(l);
    const stub = stubFor(l.room);
    await evictDurableObject(stub);
    const g = l.guests[0];
    g?.send({ t: 'input', seq: 3, tick: 3, mx: 5, mz: -5 });
    expect(await l.host.next('input')).toMatchObject({ slot: 1, seq: 3, mx: 5, mz: -5 });
    const frame = encodeSnapshot({ flags: 1, seq: 4, tick: 4, epoch: 1, baseDelta: 0 }, new Uint8Array(8));
    await evictDurableObject(stub);
    l.host.sendRaw(frame);
    expect(new Uint8Array(await (g as NonNullable<typeof g>).nextBinary())).toEqual(new Uint8Array(frame));
    // roster restored from storage: a stranger still cannot join a running room, the guest can rejoin
    const late = await register();
    expect((await upgrade(l.room, late)).status).toBe(409);
  });

  it('room code allocation never reuses a live room', async () => {
    const p = await register();
    const codes = new Set<string>();
    for (let i = 0; i < 5; i++) codes.add(await createRoom(p));
    expect(codes.size).toBe(5);
    const res = await stubFor([...codes][0] as string).fetch('https://room/create', { method: 'POST', headers: { 'x-ms-player': p.playerId, 'x-ms-room': 'DUP222' } });
    expect(res.status).toBe(409);
  });
});
