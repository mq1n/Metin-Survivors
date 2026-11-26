// Cloud-save blobs (R2) and the per-player rows an erasure has to reach. Shared by routes/save.ts (PUT), routes/players.ts
// (DELETE /players/me) and cron.ts (orphan sweep) so the three agree on the key layout.
import type { ApiEnv } from './env';
import { RULES } from './limits';

export const SAVE_PREFIX = 'saves/';
/** Legacy single-key save path (pre-migration 0003). */
export const saveKey = (playerId: string): string => `${SAVE_PREFIX}${playerId}.json`;
/** Revision-specific immutable blob key written before atomic D1 publication. */
export const saveBlobKey = (playerId: string, rev: number, nonce: string): string =>
  `${SAVE_PREFIX}${playerId}.r${rev}.${nonce}.json`;

const REVISION_KEY_RE = /^([A-Za-z0-9_-]+)\.r\d+\.[A-Za-z0-9_-]+$/;

/** Inverse of {@link saveKey} and {@link saveBlobKey}; null for a key that is not a save blob. */
export function playerIdOfSaveKey(key: string): string | null {
  if (!key.startsWith(SAVE_PREFIX) || !key.endsWith('.json')) return null;
  const rest = key.slice(SAVE_PREFIX.length, -'.json'.length);
  if (rest === '' || rest.includes('/')) return null;
  if (!rest.includes('.')) return rest;
  const m = REVISION_KEY_RE.exec(rest);
  return m?.[1] ?? null;
}

/** Lists and deletes every save blob belonging to `playerId` (both legacy and revision-specific keys). */
export async function deletePlayerSaveBlobs(env: ApiEnv, playerId: string, knownBlob?: string): Promise<void> {
  const keys = new Set<string>([saveKey(playerId)]);
  if (knownBlob) keys.add(knownBlob);
  let cursor: string | undefined;
  do {
    const page: R2Objects = await env.BLOBS.list({
      prefix: `${SAVE_PREFIX}${playerId}.`,
      limit: 1000,
      ...(cursor ? { cursor } : {}),
    });
    for (const o of page.objects) keys.add(o.key);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  const all = [...keys];
  for (let i = 0; i < all.length; i += 1000) {
    const chunk = all.slice(i, i + 1000);
    await env.BLOBS.delete(chunk.length === 1 ? chunk[0]! : chunk);
  }
}

/** `rate_counters` keys of one player (`<rule>:p:<id>`, see `enforce`); IP counters are hashed, shared and not the player's. */
export function playerCounterKeys(playerId: string): string[] {
  const rules = new Set<string>();
  for (const list of Object.values(RULES)) for (const rule of list) rules.add(rule.name);
  return [...rules].map((name) => `${name}:p:${playerId}`);
}

/** The statement that removes a player's own rate counters (they carry the id in their key). */
export function deletePlayerCountersStatement(db: D1Database, playerId: string): D1PreparedStatement {
  const keys = playerCounterKeys(playerId);
  return db.prepare(`DELETE FROM rate_counters WHERE key IN (${keys.map((_, i) => `?${i + 1}`).join(', ')})`).bind(...keys);
}

/**
 * Cleanup for a request that was already past authentication when `DELETE /players/me` erased its player: any blob it
 * wrote and the rate-counter row `enforce` created for that player id must not outlive the erasure. Best effort - a
 * failure is logged and left to the daily orphan sweep ({@link sweepOrphanSaves}).
 */
export async function discardErasedPlayerData(env: ApiEnv, playerId: string, knownBlob?: string): Promise<void> {
  await deletePlayerSaveBlobs(env, playerId, knownBlob).catch((e: unknown) =>
    console.error('erased player: save blob', e instanceof Error ? e.message : String(e)),
  );
  await deletePlayerCountersStatement(env.DB, playerId)
    .run()
    .catch((e: unknown) => console.error('erased player: counters', e instanceof Error ? e.message : String(e)));
}

/** D1 allows 100 bound parameters per statement. */
const IN_CHUNK = 90;
/** A blob younger than this is never swept (no matter what the player table says). */
const ORPHAN_GRACE_MS = 3_600_000;
/** Objects one sweep inspects (R2 lists up to 1000 per page); persisted cursor resumes on the next daily run. */
export const ORPHAN_SWEEP_MAX = 5000;
const ORPHAN_CURSOR_KEY = 'orphan_save_cursor';

/**
 * Safety net for erasure and superseded/aborted revision blobs: deletes save blobs whose player row no longer exists
 * or whose key is no longer the player's published `save_blob`. Persists the R2 listing cursor in `cron_state` so
 * buckets larger than `max` are swept completely across consecutive runs instead of repeating the first page.
 */
export async function sweepOrphanSaves(env: ApiEnv, now = Date.now(), max = ORPHAN_SWEEP_MAX): Promise<number> {
  const saved = await env.DB.prepare('SELECT value FROM cron_state WHERE key = ?1')
    .bind(ORPHAN_CURSOR_KEY)
    .first<{ value: string }>();
  let cursor: string | undefined = saved?.value || undefined;
  let loadedFromDb = cursor !== undefined;
  let removed = 0;
  let seen = 0;

  do {
    const limit = Math.min(1000, Math.max(1, max - seen));
    let page: R2Objects;
    try {
      page = await env.BLOBS.list({ prefix: SAVE_PREFIX, limit, ...(cursor ? { cursor } : {}) });
    } catch (e) {
      if (!loadedFromDb) throw e;
      // Stored cursor expired or became invalid: reset and restart from the head of the prefix.
      cursor = undefined;
      loadedFromDb = false;
      await env.DB.prepare('DELETE FROM cron_state WHERE key = ?1').bind(ORPHAN_CURSOR_KEY).run().catch(() => undefined);
      page = await env.BLOBS.list({ prefix: SAVE_PREFIX, limit });
    }
    loadedFromDb = false;

    const candidates: { key: string; id: string }[] = [];
    for (const o of page.objects) {
      const id = playerIdOfSaveKey(o.key);
      if (id !== null && now - o.uploaded.getTime() >= ORPHAN_GRACE_MS) candidates.push({ key: o.key, id });
    }

    const orphans: string[] = [];
    for (let i = 0; i < candidates.length; i += IN_CHUNK) {
      const chunk = candidates.slice(i, i + IN_CHUNK);
      const uniqueIds = [...new Set(chunk.map((c) => c.id))];
      const alive = await env.DB
        .prepare(`SELECT id, save_blob FROM players WHERE id IN (${uniqueIds.map((_, n) => `?${n + 1}`).join(', ')})`)
        .bind(...uniqueIds)
        .all<{ id: string; save_blob: string }>();
      const activeByPlayer = new Map(alive.results.map((r) => [r.id, r.save_blob]));
      for (const c of chunk) {
        const activeBlob = activeByPlayer.get(c.id);
        if (activeBlob === undefined) {
          orphans.push(c.key);
        } else if (activeBlob !== '') {
          // Player has migrated to revision-specific blobs: any other old blob past grace is superseded/aborted.
          if (c.key !== activeBlob) orphans.push(c.key);
        } else {
          // Player has no revision-specific blob recorded yet: keep legacy `saves/<id>.json`, sweep aborted rev blobs.
          if (c.key !== saveKey(c.id)) orphans.push(c.key);
        }
      }
    }

    if (orphans.length > 0) {
      await env.BLOBS.delete(orphans);
      removed += orphans.length;
    }
    seen += page.objects.length;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor && seen < max);

  if (cursor) {
    await env.DB
      .prepare('INSERT INTO cron_state (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .bind(ORPHAN_CURSOR_KEY, cursor)
      .run();
  } else {
    await env.DB.prepare('DELETE FROM cron_state WHERE key = ?1').bind(ORPHAN_CURSOR_KEY).run();
  }
  return removed;
}
