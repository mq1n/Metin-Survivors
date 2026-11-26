import { Hono } from 'hono';
import {
  parseTransferClaimRequest,
  TRANSFER_CODE_LENGTH,
  TRANSFER_CODE_TTL_SEC,
  type TransferClaimResponse,
  type TransferCreateResponse,
} from '@ms/shared';
import { requirePlayer } from '../auth';
import { randomCode, randomToken, sha256Hex } from '../crypto';
import { ApiException, readJson, type AppEnv } from '../http';
import { clientSubject, enforce, RULES } from '../limits';

export const transfer = new Hono<AppEnv>();

/** Devices (credentials) a player may hold; the oldest is evicted beyond this. */
const MAX_CREDENTIALS = 8;

// POST /transfer — mint a single-use 8-char code (15 min); a new code replaces any previous one
transfer.post('/', async (c) => {
  const player = await requirePlayer(c);
  await enforce(c.env, RULES.transferCreate, `p:${player.id}`);
  const code = randomCode(TRANSFER_CODE_LENGTH);
  const now = Date.now();
  const expiresAt = now + TRANSFER_CODE_TTL_SEC * 1000;
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM transfer_codes WHERE player_id = ?1').bind(player.id),
    c.env.DB
      .prepare('INSERT INTO transfer_codes (code_hash, player_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)')
      .bind(await sha256Hex(`transfer|${code}`), player.id, now, expiresAt),
  ]);
  const body: TransferCreateResponse = { code, expiresAt, ttlSec: TRANSFER_CODE_TTL_SEC };
  return c.json(body, 201);
});

// POST /transfer/claim — unauthenticated (the new device has no credentials); consumes the code, mints a credential
transfer.post('/claim', async (c) => {
  await enforce(c.env, RULES.transferClaimIp, await clientSubject(c));
  const parsed = parseTransferClaimRequest(await readJson(c, 512));
  if (!parsed.ok) throw new ApiException(400, 'validation', `Invalid ${parsed.field}`, { field: parsed.field, reason: parsed.reason });

  const now = Date.now();
  const consumed = await c.env.DB
    .prepare('DELETE FROM transfer_codes WHERE code_hash = ?1 AND expires_at > ?2 RETURNING player_id')
    .bind(await sha256Hex(`transfer|${parsed.value.code}`), now)
    .first<{ player_id: string }>();
  if (!consumed) throw new ApiException(400, 'invalid_code', 'This code is invalid, expired or already used');

  const player = await c.env.DB.prepare('SELECT id, name, banned FROM players WHERE id = ?1').bind(consumed.player_id).first<{
    id: string;
    name: string;
    banned: number;
  }>();
  if (!player) throw new ApiException(400, 'invalid_code', 'This code is invalid, expired or already used');
  if (player.banned === 1) throw new ApiException(403, 'banned', 'This player is banned');

  const secret = randomToken(24);
  await c.env.DB.batch([
    c.env.DB
      .prepare('INSERT INTO credentials (player_id, secret_hash, created_at) VALUES (?1, ?2, ?3)')
      .bind(player.id, await sha256Hex(secret), now),
    c.env.DB
      .prepare(
        `DELETE FROM credentials WHERE player_id = ?1
           AND id NOT IN (SELECT id FROM credentials WHERE player_id = ?1 ORDER BY id DESC LIMIT ?2)`,
      )
      .bind(player.id, MAX_CREDENTIALS),
  ]);
  const body: TransferClaimResponse = { playerId: player.id, secret, name: player.name };
  return c.json(body);
});
