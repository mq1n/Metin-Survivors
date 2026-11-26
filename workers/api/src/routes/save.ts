import { Hono } from 'hono';
import { formatRev, parseRev, SAVE_MAX_BYTES, SAVE_UPDATED_HEADER, isRecord, type SaveMeta } from '@ms/shared';
import { requirePlayer } from '../auth';
import { randomToken } from '../crypto';
import { ApiException, decodeUtf8, readBodyBytes, type AppEnv } from '../http';
import { clientSubject, enforce, RULES } from '../limits';
import { discardErasedPlayerData, saveBlobKey, saveKey } from '../saves';

export const save = new Hono<AppEnv>();

export { saveKey };

/** The player this request authenticated as was erased (DELETE /players/me) while the request was running. */
const erased = (): ApiException => new ApiException(401, 'unauthorized', 'Invalid credentials', undefined, { 'WWW-Authenticate': 'Bearer' });

// "No cloud save yet" is the normal state of every new player, not a failure: 204 No Content (an empty answer the browser
// does not log as a failed request; a 404 showed up as a console error on every first sync). Clients treat 204 (and,
// for servers deployed before this change, 404 `no_save`) as "nothing to download" and upload with If-Match: 0.
const noSave = (): Response => new Response(null, { status: 204, headers: { 'Cache-Control': 'private, no-store' } });

// GET /save — raw save JSON; revision in ETag, modification time in X-Save-Updated; honours If-None-Match.
// 204 when the player has no cloud save yet.
save.get('/', async (c) => {
  const player = await requirePlayer(c);
  if (player.saveRev === 0) return noSave();

  const ifNoneMatch = parseRev(c.req.header('if-none-match'));
  if (ifNoneMatch !== null && ifNoneMatch === player.saveRev) {
    return new Response(null, { status: 304, headers: { ETag: formatRev(player.saveRev), [SAVE_UPDATED_HEADER]: String(player.saveUpdatedAt) } });
  }

  let rev = player.saveRev;
  let updatedAt = player.saveUpdatedAt;
  let key = player.saveBlob || saveKey(player.id);
  let object = await c.env.BLOBS.get(key);
  if (!object) {
    // A concurrent PUT may have published a newer immutable blob and cleaned up `key` after requirePlayer().
    const fresh = await c.env.DB
      .prepare('SELECT save_rev, save_updated_at, save_blob FROM players WHERE id = ?1')
      .bind(player.id)
      .first<{ save_rev: number; save_updated_at: number; save_blob: string }>();
    if (!fresh) throw erased();
    if (fresh.save_rev === 0) return noSave();
    const freshKey = fresh.save_blob || saveKey(player.id);
    if (freshKey !== key) {
      rev = fresh.save_rev;
      updatedAt = fresh.save_updated_at;
      key = freshKey;
      object = await c.env.BLOBS.get(key);
    }
  }
  if (!object) throw new ApiException(404, 'no_save', 'No cloud save yet');
  // Always serve D1's committed revision as ETag so GET -> PUT If-Match can never be stranded by stale blob metadata.
  const blobUpdated = Number(object.customMetadata?.updatedAt);
  const resolvedUpdatedAt = updatedAt > 0 ? updatedAt : Number.isFinite(blobUpdated) && blobUpdated > 0 ? blobUpdated : 0;
  return new Response(object.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ETag: formatRev(rev),
      [SAVE_UPDATED_HEADER]: String(resolvedUpdatedAt),
      'Cache-Control': 'private, no-store',
    },
  });
});

// PUT /save — optimistic concurrency via If-Match (0 = "no cloud save yet").
// Writes an immutable revision-specific blob FIRST, then atomically publishes `(save_rev, save_blob)` via D1 CAS so
// concurrent uploads can never overwrite a newer revision's blob body with an older payload.
save.put('/', async (c) => {
  const player = await requirePlayer(c);
  const ifMatchHeader = c.req.header('if-match');
  if (ifMatchHeader === undefined) {
    throw new ApiException(428, 'precondition_required', 'If-Match with the last known revision is required (0 for a first upload)');
  }
  const expectedRev = parseRev(ifMatchHeader);
  if (expectedRev === null) throw new ApiException(400, 'validation', 'Invalid If-Match', { field: 'If-Match', reason: 'must be a revision number' });

  await enforce(c.env, RULES.savePutPlayer, `p:${player.id}`);
  await enforce(c.env, RULES.savePutIp, await clientSubject(c));

  const bytes = await readBodyBytes(c.req.raw, SAVE_MAX_BYTES);
  if (bytes.byteLength === 0) throw new ApiException(400, 'bad_json', 'A JSON body is required');
  let data: unknown;
  try {
    data = JSON.parse(decodeUtf8(bytes));
  } catch (e) {
    if (e instanceof ApiException) throw e;
    throw new ApiException(400, 'bad_json', 'Body is not valid JSON');
  }
  if (!isRecord(data) || typeof data.version !== 'number') {
    throw new ApiException(400, 'validation', 'Invalid save', { field: 'version', reason: 'save must be a JSON object with a numeric version' });
  }

  // Fast-fail obvious stale revisions before spending an R2 write.
  if (player.saveRev !== expectedRev) {
    throw new ApiException(412, 'rev_conflict', 'The cloud save changed since your last sync', { currentRev: player.saveRev });
  }

  const now = Date.now();
  const nextRev = expectedRev + 1;
  const blobKey = saveBlobKey(player.id, nextRev, randomToken(8));
  try {
    await c.env.BLOBS.put(blobKey, bytes, {
      httpMetadata: { contentType: 'application/json; charset=utf-8' },
      customMetadata: { rev: String(nextRev), updatedAt: String(now) },
    });
  } catch (e) {
    console.error('save put failed', e instanceof Error ? e.message : String(e));
    throw new ApiException(503, 'unavailable', 'Save storage is temporarily unavailable, try again');
  }

  // Atomic publication: D1 CAS commits the new revision and blob pointer together.
  const swapped = await c.env.DB
    .prepare(
      'UPDATE players SET save_rev = ?1, save_size = ?2, save_updated_at = ?3, save_blob = ?4 WHERE id = ?5 AND save_rev = ?6 RETURNING save_rev',
    )
    .bind(nextRev, bytes.byteLength, now, blobKey, player.id, expectedRev)
    .first<{ save_rev: number }>();

  if (!swapped) {
    await c.env.BLOBS.delete(blobKey).catch((e: unknown) =>
      console.error('save put: cleanup unreferenced blob', e instanceof Error ? e.message : String(e)),
    );
    const current = await c.env.DB.prepare('SELECT save_rev FROM players WHERE id = ?1').bind(player.id).first<{ save_rev: number }>();
    // No row: the player was erased between authentication and the swap - not a revision conflict.
    if (!current) {
      await discardErasedPlayerData(c.env, player.id, blobKey);
      throw erased();
    }
    throw new ApiException(412, 'rev_conflict', 'The cloud save changed since your last sync', { currentRev: current.save_rev });
  }

  // DELETE /players/me may have erased this player right after our swap; verify and discard if gone.
  const stillThere = await c.env.DB.prepare('SELECT 1 AS present FROM players WHERE id = ?1').bind(player.id).first<{ present: number }>();
  if (!stillThere) {
    await discardErasedPlayerData(c.env, player.id, blobKey);
    throw erased();
  }

  // Best-effort cleanup of the superseded blob (daily orphan sweep catches any leftover).
  const prevKey = player.saveBlob || (player.saveRev > 0 ? saveKey(player.id) : '');
  if (prevKey && prevKey !== blobKey) {
    await c.env.BLOBS.delete(prevKey).catch((e: unknown) =>
      console.error('save put: cleanup superseded blob', e instanceof Error ? e.message : String(e)),
    );
  }

  const meta: SaveMeta = { rev: nextRev, updatedAt: now, size: bytes.byteLength };
  return c.json(meta, 200, { ETag: formatRev(nextRev), [SAVE_UPDATED_HEADER]: String(now) });
});
