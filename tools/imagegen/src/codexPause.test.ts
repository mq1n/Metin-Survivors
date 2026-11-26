import { describe, expect, test } from 'bun:test';
import { isLimitMessage, parseRetryAt } from './codexPause';

describe('parseRetryAt', () => {
  const now = new Date(2026, 9, 29, 14, 14, 0);

  test('a dated reset (ChatGPT weekly limit) waits until that day, not now + 3 h', () => {
    const msg = 'You’ve hit your usage limit. Visit https://chatgpt.com/settings/usage to purchase more credits or try again at Nov 4th, 2026 9:37 AM.';
    expect(isLimitMessage(msg)).toBe(true);
    expect(parseRetryAt(msg, now).getTime()).toBe(new Date(2026, 10, 4, 9, 38, 0).getTime());
  });

  test('a dated reset without a year rolls into the next year when the day has passed', () => {
    expect(parseRetryAt('try again at Jan 2nd 1:05 PM', now).getTime()).toBe(new Date(2027, 0, 2, 13, 6, 0).getTime());
  });

  test('a clock-only reset is the next local occurrence of that time', () => {
    expect(parseRetryAt('try again at 3:52 AM', now).getTime()).toBe(new Date(2026, 9, 30, 3, 53, 0).getTime());
    expect(parseRetryAt('try again at 4:10 PM', now).getTime()).toBe(new Date(2026, 9, 29, 16, 11, 0).getTime());
  });

  test('no time in the message: now + 3 h', () => {
    expect(parseRetryAt('rate limit reached', now).getTime()).toBe(now.getTime() + 3 * 3600_000);
  });
});
