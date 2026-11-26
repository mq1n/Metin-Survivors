// The "run in progress" marker (QA EXPLORER-4): a page reload in the middle of a run throws the run away (nothing persists a run in
// progress: it is settled only through the run-end flow), and the menu opened as if nothing had happened. The marker is written when a run
// starts and cleared when the run ends or is settled; a boot that still finds it knows the last run was cut off and tells the player once.
// sessionStorage, not localStorage: it survives a reload (F5) of THIS tab and is never seen by a second tab, which would otherwise take a
// live run of the first tab for an interrupted one. Every access is guarded: no storage (a private window, blocked site data) = no notice.

const KEY = 'ms.run.live';

export interface RunMarker {
  zone: string;
  classId: string;
  difficulty: string;
  /** ms since epoch */
  startedAt: number;
  coop: boolean;
}

export interface MarkerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): MarkerStorage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function markRunStart(m: RunMarker, storage: MarkerStorage | null = defaultStorage()): void {
  try {
    storage?.setItem(KEY, JSON.stringify(m));
  } catch {
    /* storage full or blocked: the run just goes unmarked */
  }
}

/** The run is over (ended, abandoned, crashed, settled): nothing to report at the next boot. */
export function clearRunMarker(storage: MarkerStorage | null = defaultStorage()): void {
  try {
    storage?.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** The run a previous page load left unfinished, or null. Reads AND clears the marker, so the notice shows once. */
export function takeInterruptedRun(storage: MarkerStorage | null = defaultStorage()): RunMarker | null {
  if (!storage) return null;
  let raw: string | null = null;
  try {
    raw = storage.getItem(KEY);
    storage.removeItem(KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null) return null;
    const o = v as Record<string, unknown>;
    if (typeof o.zone !== 'string' || typeof o.classId !== 'string' || typeof o.difficulty !== 'string' || typeof o.startedAt !== 'number') return null;
    return { zone: o.zone, classId: o.classId, difficulty: o.difficulty, startedAt: o.startedAt, coop: o.coop === true };
  } catch {
    return null;
  }
}
