// Review state: every generated asset is viewed by the Imagegen agent and marked approved/rejected.
// Only approved + built assets are shipped into apps/game/public.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RAW, REVIEW } from './paths';
import { withFileLockSync } from '../../qa/slots';

export type ReviewStatus = 'approved' | 'rejected';

export interface ReviewEntry {
  status: ReviewStatus;
  note?: string;
  ts: string;
}

export function loadReview(): Record<string, ReviewEntry> {
  return existsSync(REVIEW) ? (JSON.parse(readFileSync(REVIEW, 'utf8')) as Record<string, ReviewEntry>) : {};
}

export function saveReview(r: Record<string, ReviewEntry>): void {
  writeFileSync(REVIEW, JSON.stringify(r, null, 1));
}

export function setStatus(ids: string[], status: ReviewStatus, note?: string): void {
  withFileLockSync('imagegen-review', () => setStatusLocked(ids, status, note));
}

function setStatusLocked(ids: string[], status: ReviewStatus, note?: string): void {
  const r = loadReview();
  for (const id of ids) {
    r[id] = { status, note, ts: new Date().toISOString() };
    if (status === 'rejected') {
      // move the rejected raw aside so the next `run` regenerates it
      const raw = join(RAW, `${id}.png`);
      if (existsSync(raw)) {
        const dir = join(RAW, '_rejected');
        mkdirSync(dir, { recursive: true });
        renameSync(raw, join(dir, `${id}.${Date.now()}.png`));
      }
    }
  }
  saveReview(r);
}

/** A fresh generation resets any earlier verdict. */
export function clearStatus(id: string): void {
  withFileLockSync('imagegen-review', () => {
    const r = loadReview();
    if (r[id]) {
      delete r[id];
      saveReview(r);
    }
  });
}
