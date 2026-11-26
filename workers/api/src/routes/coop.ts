import { Hono } from 'hono';
import {
  COOP_SUBPROTOCOL,
  ROOM_CODE_LENGTH,
  isRoomCode,
  type CoopCreateResponse,
} from '@ms/shared';
import { requirePlayer } from '../auth';
import { randomCode } from '../crypto';
import { ApiException, originAllowed, type AppEnv } from '../http';
import { clientSubject, enforce, RULES } from '../limits';

export const coop = new Hono<AppEnv>();

/** Headers the Worker stamps on requests to the room (it is the only way in); client-supplied copies are overwritten. */
export const ROOM_HEADERS = { player: 'x-ms-player', name: 'x-ms-name' } as const;

function assertCoopEnabled(flag: string | undefined): void {
  if (flag === '0' || flag === 'false') {
    throw new ApiException(503, 'unavailable', 'Co-op is temporarily paused, try again later', undefined, { 'Retry-After': '300' });
  }
}

// POST /coop — allocate a room; the caller becomes host (slot 0, reserved until they connect)
coop.post('/', async (c) => {
  assertCoopEnabled(c.env.COOP_ENABLED);
  const player = await requirePlayer(c);
  await enforce(c.env, RULES.coopCreatePlayer, `p:${player.id}`);
  await enforce(c.env, RULES.coopCreateIp, await clientSubject(c));

  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomCode(ROOM_CODE_LENGTH);
    const stub = c.env.COOP_ROOM.get(c.env.COOP_ROOM.idFromName(code));
    const res = await stub.fetch('https://room/create', {
      method: 'POST',
      headers: { [ROOM_HEADERS.player]: player.id, [ROOM_HEADERS.name]: encodeURIComponent(player.name), 'x-ms-room': code },
    });
    if (res.status === 201) {
      const body: CoopCreateResponse = { room: code };
      return c.json(body, 201);
    }
    if (res.status !== 409) break;
  }
  throw new ApiException(503, 'unavailable', 'Could not allocate a room, try again');
});

// GET /coop/:room — WebSocket upgrade → CoopRoom Durable Object
coop.get('/:room', async (c) => {
  assertCoopEnabled(c.env.COOP_ENABLED);
  const code = c.req.param('room').toUpperCase();
  if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') {
    throw new ApiException(426, 'upgrade_required', 'Expected a WebSocket upgrade', undefined, { Upgrade: 'websocket' });
  }
  if (!isRoomCode(code)) throw new ApiException(404, 'room_not_found', 'Room not found');
  const origin = c.req.header('origin');
  if (origin !== undefined && !originAllowed(c.env, origin)) throw new ApiException(403, 'origin_not_allowed', 'Origin not allowed');

  const player = await requirePlayer(c);
  await enforce(c.env, RULES.coopJoinPlayer, `p:${player.id}`);
  await enforce(c.env, RULES.coopJoinIp, await clientSubject(c));

  // Only the relay subprotocol is echoed back; the `auth.<token>` entry is never reflected.
  const offered = (c.req.header('sec-websocket-protocol') ?? '').split(',').map((s) => s.trim());
  const headers = new Headers(c.req.raw.headers);
  headers.delete('authorization');
  headers.set(ROOM_HEADERS.player, player.id);
  headers.set(ROOM_HEADERS.name, encodeURIComponent(player.name));
  headers.set('x-ms-room', code);
  headers.set('x-ms-subprotocol', offered.includes(COOP_SUBPROTOCOL) ? COOP_SUBPROTOCOL : '');
  headers.delete('sec-websocket-protocol');

  const stub = c.env.COOP_ROOM.get(c.env.COOP_ROOM.idFromName(code));
  return stub.fetch('https://room/ws', { method: 'GET', headers });
});
