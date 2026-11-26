// pushToast: an identical toast that is still showing is refreshed (its timer restarts) instead of stacking a copy.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pushToast, resetUiState, uiToasts } from './view';

describe('pushToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetUiState();
  });
  afterEach(() => {
    resetUiState();
    vi.useRealTimers();
  });

  it('shows one toast for four identical pushes', () => {
    for (let i = 0; i < 4; i++) pushToast('row locked', 'info');
    expect(uiToasts.value).toHaveLength(1);
  });

  it('restarts the timer of the identical toast', () => {
    pushToast('row locked', 'info', 1000);
    vi.advanceTimersByTime(800);
    pushToast('row locked', 'info', 1000);
    vi.advanceTimersByTime(800); // 1600 ms after the first push, 800 after the refresh
    expect(uiToasts.value).toHaveLength(1);
    vi.advanceTimersByTime(300);
    expect(uiToasts.value).toHaveLength(0);
  });

  it('keeps different texts and tones apart', () => {
    pushToast('a', 'info');
    pushToast('b', 'info');
    pushToast('a', 'good');
    expect(uiToasts.value.map((x) => `${x.tone}:${x.text}`)).toEqual(['info:a', 'info:b', 'good:a']);
  });

  it('pushes a fresh toast after the identical one expired', () => {
    pushToast('a', 'info', 500);
    vi.advanceTimersByTime(600);
    expect(uiToasts.value).toHaveLength(0);
    pushToast('a', 'info', 500);
    expect(uiToasts.value).toHaveLength(1);
  });
});
