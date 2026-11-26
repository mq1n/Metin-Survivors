// The player-facing text of a failed run load (App.startRun → GameStore.failLoading → the loading screen's error panel).
import { t } from '../i18n/i18n';

// a file path, a URL or a content-hashed asset name inside an exception message ("assets/models/enemy/orc_scout.4f1c2a9e.glb")
const FILE_REF = /(?:https?:\/\/[^\s)]+|(?:[\w.~%-]+\/)+[\w.~%-]+\.\w{2,5}\b|[\w-]+\.[0-9a-f]{6,10}\.\w{2,5}\b)/gi;

/** The technical cause with file names, paths and hashes taken out: a player never reads "orc_scout.4f1c2a9e.glb" (the status
 *  code stays: "Failed to fetch a game file, HTTP 503"). Flattened to one line and capped. */
export function scrubReason(raw: string): string {
  const flat = raw.replace(/\s+/g, ' ').trim();
  const r = flat
    .replace(FILE_REF, 'a game file')
    .replace(/\s*\(([^()]*)\)/g, ', $1')
    .replace(/\s+,/g, ',')
    .replace(/,\s*,/g, ',')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return r.slice(0, 120) || 'unknown error';
}

// the browser's own network-failure wording ("Failed to fetch", "NetworkError when attempting to fetch resource", "Load failed")
const FETCH_FAIL = /^(?:typeerror:\s*)?(?:failed to fetch|networkerror[^,]*|load failed)(?: a game file)?/i;

/** The cause in the player's language where we know the wording (the HTTP status code and anything else stay as they are). */
export function localizeReason(reason: string): string {
  return reason.replace(FETCH_FAIL, t('boot.reason.fetch'));
}

// A lazy code chunk (the hero class's skill effects, vfx/skills/loader.ts; the zone scene) that could not be fetched: a deploy replaced the hashed
// file under an open tab, or the network dropped. Chrome / Edge "Failed to fetch dynamically imported module: <url>", Firefox "error loading
// dynamically imported module: <url>", Safari "Importing a module script failed.", a stale host answering HTML "Failed to load module script".
const CHUNK_FAIL = /dynamically imported module|importing a module script failed|failed to load module script|unable to preload/i;

/** true when the error is a code chunk that did not load (a reload fetches the current page and its chunk names; a plain retry may not) */
export function isChunkLoadError(err: unknown): boolean {
  return CHUNK_FAIL.test(err instanceof Error ? err.message : String(err));
}

/** A localised sentence with the cleaned technical cause in brackets (one line, capped). */
export function loadFailureMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  // boot.loadFailedMsg (parts/boot.*) reads next to the RETRY + BACK dialog of the loading screen; the older boot.loadFailed
  // ("... go back and try again", parts/gameplay.*) does not and is no longer used here
  return t('boot.loadFailedMsg', { reason: isChunkLoadError(err) ? t('boot.reason.chunk') : localizeReason(scrubReason(raw)) });
}

/** The panel text of a run that stopped on a repeated frame error (App.crashRun → GameStore.failLoading; the same RETRY + BACK dialog). */
export function runCrashMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return t('boot.runCrashedMsg', { reason: localizeReason(scrubReason(raw)) });
}
