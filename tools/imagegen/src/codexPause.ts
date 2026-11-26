// Machine-wide pause of codex image generation after a ChatGPT usage-limit answer ("You've hit your usage limit …
// try again at 3:52 AM"). The first session that sees the limit writes %TEMP%/ms-qa-locks/codex_paused_until.json; every
// later session fails fast with CODEX_PAUSED instead of burning a slot on another doomed request. The file expires by
// itself at the reset time (delete it to resume earlier).
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DIR = join(tmpdir(), 'ms-qa-locks');
export const PAUSE_FILE = join(DIR, 'codex_paused_until.json');
const LIMIT_RE = /usage limit|rate limit|too many requests|try again at/i;

export class CodexPausedError extends Error {
  constructor(readonly until: Date, detail: string) {
    super(
      `CODEX_PAUSED until ${until.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} local (ChatGPT image usage limit: ${detail}). ` +
        'Do every step that needs no NEW image now (reuse existing shipped sprites, earlier variants, shipped ids), ' +
        'and list each image you still need as "DEFERRED_GEN: <id> | <ref path(s)> | <goal>" in your notes and structured output; ' +
        'the lead re-runs them after the reset. Do not retry in a loop.',
    );
    this.name = 'CodexPausedError';
  }
}

export function isLimitMessage(msg: string | undefined): boolean {
  return !!msg && LIMIT_RE.test(msg);
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "try again at Nov 4th, 2026 9:37 AM" (a dated reset), else the next local occurrence of "h:mm AM/PM" (or "HH:MM")
 *  from now; fallback now + 3 h. */
export function parseRetryAt(msg: string, now = new Date()): Date {
  const d = /try again at\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})?,?\s*(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(msg);
  const mon = d ? MONTHS.indexOf(d[1]!.toLowerCase()) : -1;
  if (d && mon >= 0) {
    let h = Number(d[4]);
    const ap = d[6]?.toUpperCase();
    if (ap === 'PM' && h < 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    const t = new Date(d[3] ? Number(d[3]) : now.getFullYear(), mon, Number(d[2]), h, Number(d[5]), 0, 0);
    if (!d[3] && t.getTime() <= now.getTime()) t.setFullYear(t.getFullYear() + 1);
    return new Date(t.getTime() + 60_000);
  }
  const m = /try again at\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(msg);
  if (!m) return new Date(now.getTime() + 3 * 3600_000);
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ap = m[3]?.toUpperCase();
  if (ap === 'PM' && h < 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  const t = new Date(now);
  t.setHours(h, min, 0, 0);
  if (t.getTime() <= now.getTime()) t.setDate(t.getDate() + 1);
  return new Date(t.getTime() + 60_000); // one minute of slack after the stated reset
}

export function notePause(msg: string): Date {
  const until = parseRetryAt(msg);
  mkdirSync(DIR, { recursive: true });
  writeFileSync(PAUSE_FILE, JSON.stringify({ until: until.toISOString(), msg: msg.slice(0, 300), at: new Date().toISOString() }));
  return until;
}

/** Throws CodexPausedError while a pause is active; clears an expired pause. */
export function checkPaused(): void {
  if (!existsSync(PAUSE_FILE)) return;
  try {
    const p = JSON.parse(readFileSync(PAUSE_FILE, 'utf8')) as { until: string; msg: string };
    const until = new Date(p.until);
    if (Date.now() < until.getTime()) throw new CodexPausedError(until, p.msg);
    rmSync(PAUSE_FILE, { force: true });
  } catch (e) {
    if (e instanceof CodexPausedError) throw e;
    /* unreadable pause file: ignore */
  }
}
