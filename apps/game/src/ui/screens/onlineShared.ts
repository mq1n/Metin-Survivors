// Helpers shared by the online screens (Settings · Leaderboard · Co-op): friendly failure texts, clipboard access and a
// ticking clock hook for countdowns / "x min ago" labels. (The list scrolling lives in onlineScroll.tsx.)
import { useEffect, useState } from 'preact/hooks';
import { t } from '../../i18n/i18n';
import type { CloudFailure } from '../../meta';
import { pushToast } from '../view';

/** Maps a classified network failure to a player-facing sentence (`net.fail.<kind>`). */
export function failureText(f: CloudFailure): string {
  if (f.kind === 'rateLimited' && f.retryAfterSec !== undefined && f.retryAfterSec > 0) {
    return t('net.fail.rateLimitedAfter', { s: Math.ceil(f.retryAfterSec) });
  }
  return t(`net.fail.${f.kind}`);
}

/** Clipboard write with a legacy fallback (insecure origins / embedded webviews). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* fall through to the selection-based copy */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Copies and answers with a toast; resolves to whether the copy worked. */
export async function copyWithToast(text: string): Promise<boolean> {
  const ok = await copyText(text);
  if (ok) pushToast(t('common.copied'), 'good');
  else pushToast(t('toast.copyFailed'), 'bad');
  return ok;
}

/** `Date.now()` that re-renders the component every `intervalMs` (paused while `enabled` is false). */
export function useNow(intervalMs = 1000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled]);
  return now;
}
