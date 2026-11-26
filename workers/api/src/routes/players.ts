import { Hono } from 'hono';
import { parseRegisterRequest, parseRenameRequest, type RegisterResponse, type RenameResponse } from '@ms/shared';
import { requirePlayer } from '../auth';
import { randomToken, sha256Hex } from '../crypto';
import { ApiException, readJson, type AppEnv } from '../http';
import { clientSubject, enforce, RULES } from '../limits';
import { checkDisplayName, defaultPlayerName } from '../names';
import { deletePlayerCountersStatement, deletePlayerSaveBlobs } from '../saves';

export const players = new Hono<AppEnv>();

function moderate(name: string): void {
  const verdict = checkDisplayName(name);
  if (!verdict.ok) {
    const message = verdict.reason === 'reserved' ? 'That name is reserved' : 'That name is not allowed';
    throw new ApiException(422, 'name_rejected', message, { field: 'name', reason: verdict.reason });
  }
}

// POST /players — anonymous registration
players.post('/', async (c) => {
  await enforce(c.env, RULES.register, await clientSubject(c));
  const parsed = parseRegisterRequest(await readJson(c, 1024, true));
  if (!parsed.ok) throw new ApiException(400, 'validation', `Invalid ${parsed.field}`, { field: parsed.field, reason: parsed.reason });
  const name = parsed.value.name ?? defaultPlayerName();
  if (parsed.value.name !== undefined) moderate(name);

  const playerId = randomToken(12);
  const secret = randomToken(24);
  const secretHash = await sha256Hex(secret);
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO players (id, name, created_at, last_seen_at) VALUES (?1, ?2, ?3, ?3)').bind(playerId, name, now),
    c.env.DB.prepare('INSERT INTO credentials (player_id, secret_hash, created_at) VALUES (?1, ?2, ?3)').bind(playerId, secretHash, now),
  ]);
  const body: RegisterResponse = { playerId, secret, name };
  return c.json(body, 201);
});

// DELETE /players/me — erasure on request (KVKK/GDPR): cloud save, credentials, runs, leaderboard rows, transfer codes,
// the player's rate counters. (Not erasable per player: the hashed-IP counters, which expire by themselves, and a
// co-op room the player is in, which closes within MAX_LIFETIME_MS.)
// R2 goes first: if it fails nothing is lost and the caller retries.
// A PUT /save that passed its compare-and-swap before the batch below can still be writing its blob. Two guards close that
// race, whichever way the interleaving falls: the PUT re-checks the player row after its R2 write (routes/save.ts) and removes
// the blob if the row is gone, and this handler removes the blob once more after the rows are gone (a blob written between
// the first delete and the batch). If that second delete fails the erasure still answers 204 - the rows are gone and the
// caller could not retry (its credential is dead) - and the daily orphan sweep (cron.ts) finishes the job.
players.delete('/me', async (c) => {
  const player = await requirePlayer(c);
  try {
    await deletePlayerSaveBlobs(c.env, player.id, player.saveBlob);
  } catch (e) {
    console.error('player delete: save blob', e instanceof Error ? e.message : String(e));
    throw new ApiException(503, 'unavailable', 'Save storage is temporarily unavailable, try again');
  }
  const db = c.env.DB;
  await db.batch([
    db.prepare('DELETE FROM bests WHERE player_id = ?1').bind(player.id),
    db.prepare('DELETE FROM runs WHERE player_id = ?1').bind(player.id),
    db.prepare('DELETE FROM transfer_codes WHERE player_id = ?1').bind(player.id),
    // the per-player rate counters carry the id in their key; they would only expire after the daily sweep
    deletePlayerCountersStatement(db, player.id),
    db.prepare('DELETE FROM credentials WHERE player_id = ?1').bind(player.id),
    db.prepare('DELETE FROM players WHERE id = ?1').bind(player.id),
  ]);
  try {
    await deletePlayerSaveBlobs(c.env, player.id, player.saveBlob);
  } catch (e) {
    console.error('player delete: save blob (second pass, left to the orphan sweep)', e instanceof Error ? e.message : String(e));
  }
  return c.body(null, 204);
});

// PATCH /players/me — rename
players.patch('/me', async (c) => {
  const player = await requirePlayer(c);
  await enforce(c.env, RULES.rename, `p:${player.id}`);
  const parsed = parseRenameRequest(await readJson(c, 1024));
  if (!parsed.ok) throw new ApiException(400, 'validation', `Invalid ${parsed.field}`, { field: parsed.field, reason: parsed.reason });
  moderate(parsed.value.name);
  await c.env.DB.prepare('UPDATE players SET name = ?1 WHERE id = ?2').bind(parsed.value.name, player.id).run();
  const body: RenameResponse = { playerId: player.id, name: parsed.value.name };
  return c.json(body);
});
