import { COOP_AUTH_PROTOCOL_PREFIX, parseBearer, parseToken, type Credentials } from '@ms/shared';
import { sha256Hex, timingSafeEqual } from './crypto';
import { ApiException, type Ctx } from './http';
import { edgeGuardPlayer } from './limits';

export interface PlayerRow {
  id: string;
  name: string;
  banned: boolean;
  createdAt: number;
  saveRev: number;
  saveSize: number;
  saveUpdatedAt: number;
  saveBlob: string;
}

interface AuthRow {
  id: string;
  name: string;
  banned: number;
  created_at: number;
  save_rev: number;
  save_size: number;
  save_updated_at: number;
  save_blob: string;
  secret_hash: string;
}

/** Hash compared when the player does not exist, so unknown ids and wrong secrets cost the same. */
const DUMMY_HASH = '0'.repeat(64);

/** Verifies credentials against D1. Returns null for unknown player or wrong secret. */
export async function verifyCredentials(db: D1Database, cred: Credentials): Promise<PlayerRow | null> {
  const [hash, rows] = await Promise.all([
    sha256Hex(cred.secret),
    db
      .prepare(
        `SELECT p.id, p.name, p.banned, p.created_at, p.save_rev, p.save_size, p.save_updated_at, p.save_blob, c.secret_hash
           FROM players p JOIN credentials c ON c.player_id = p.id WHERE p.id = ?1`,
      )
      .bind(cred.playerId)
      .all<AuthRow>(),
  ]);
  const found = rows.results;
  // Compare against every stored credential without early exit.
  let match = false;
  for (const row of found) match = timingSafeEqual(row.secret_hash, hash) || match;
  if (found.length === 0) timingSafeEqual(DUMMY_HASH, hash);
  const row = found[0];
  if (!match || !row) return null;
  return {
    id: row.id,
    name: row.name,
    banned: row.banned === 1,
    createdAt: row.created_at,
    saveRev: row.save_rev,
    saveSize: row.save_size,
    saveUpdatedAt: row.save_updated_at,
    saveBlob: row.save_blob,
  };
}

/** `Authorization: Bearer <id>.<secret>` or, for WebSocket upgrades, `Sec-WebSocket-Protocol: …, auth.<id>.<secret>`. */
export function credentialsFromRequest(req: Request): Credentials | null {
  const bearer = parseBearer(req.headers.get('authorization'));
  if (bearer) return bearer;
  const protocols = req.headers.get('sec-websocket-protocol');
  if (!protocols) return null;
  for (const p of protocols.split(',')) {
    const proto = p.trim();
    if (proto.startsWith(COOP_AUTH_PROTOCOL_PREFIX)) return parseToken(proto.slice(COOP_AUTH_PROTOCOL_PREFIX.length));
  }
  return null;
}

/** Authenticates the request or throws 401 (403 for banned players). Caches the player on the context. */
export async function requirePlayer(c: Ctx): Promise<PlayerRow> {
  const existing = c.get('player');
  if (existing) return existing;
  const cred = credentialsFromRequest(c.req.raw);
  if (!cred) throw new ApiException(401, 'unauthorized', 'Missing or malformed credentials', undefined, { 'WWW-Authenticate': 'Bearer' });
  const player = await verifyCredentials(c.env.DB, cred);
  if (!player) throw new ApiException(401, 'unauthorized', 'Invalid credentials', undefined, { 'WWW-Authenticate': 'Bearer' });
  if (player.banned) throw new ApiException(403, 'banned', 'This player is banned');
  c.set('player', player);
  await edgeGuardPlayer(c, player.id);
  return player;
}

/** Like {@link requirePlayer} but anonymous (or stale) callers just get null. */
export async function optionalPlayer(c: Ctx): Promise<PlayerRow | null> {
  const cred = credentialsFromRequest(c.req.raw);
  if (!cred) return null;
  const player = await verifyCredentials(c.env.DB, cred);
  if (!player || player.banned) return null;
  c.set('player', player);
  return player;
}
