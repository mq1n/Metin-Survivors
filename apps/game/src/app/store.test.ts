import { describe, expect, it } from 'vitest';
import type { ModalRequest } from '../sim/types';
import { styleFromName } from './simFeed';
import { GameStore } from './store';

function modal(id: number, kind: ModalRequest['kind'] = 'levelUp'): ModalRequest {
  return {
    id,
    kind,
    player: 0,
    cards: [],
    canReroll: true,
    canBanish: true,
    canSkip: true,
    rerolls: 1,
    banishes: 1,
    skips: 1,
    level: 2,
    source: '',
    free: false,
    awakened: false,
    waited: 0,
    result: null,
  };
}

describe('GameStore', () => {
  it('modal priority: pause > sim request > story, pause only during a run', () => {
    const s = new GameStore();
    s.setScreen('run');
    expect(s.modal.value).toBeNull();
    s.setStory({ kind: 'zoneIntro', ref: 'z' });
    expect(s.modal.value?.kind).toBe('story');
    s.setSimModal(modal(1));
    expect(s.modal.value?.kind).toBe('levelUp');
    s.setPaused(true);
    expect(s.modal.value?.kind).toBe('pause');
    s.setScreen('menu');
    expect(s.modal.value?.kind).toBe('levelUp');
  });

  it('only republishes the sim modal when the request changes', () => {
    const s = new GameStore();
    let runs = 0;
    const m = modal(7);
    s.setSimModal(m);
    const unsub = s.modal.subscribe(() => runs++);
    const before = runs;
    s.setSimModal(m);
    s.setSimModal({ ...m }); // same id, new object: signal value is refreshed but id is the same request
    expect(s.modal.value?.kind).toBe('levelUp');
    s.setSimModal(modal(8));
    expect(runs).toBeGreaterThan(before);
    unsub();
  });

  it('commands are forwarded to the bound handlers', () => {
    const s = new GameStore();
    const calls: string[] = [];
    s.bind({
      chooseCard: (i) => calls.push(`choose${i}`),
      reroll: () => calls.push('reroll'),
      banish: (i) => calls.push(`banish${i}`),
      skip: () => calls.push('skip'),
      pause: () => calls.push('pause'),
      resume: () => calls.push('resume'),
      quit: () => calls.push('quit'),
      go: (sc) => calls.push(`go:${sc}`),
      startRun: () => calls.push('start'),
      dismissStory: () => calls.push('story'),
    });
    s.chooseCard(2);
    s.reroll();
    s.banish(1);
    s.skip();
    s.pause();
    s.resume();
    s.quit();
    s.go('heroSelect');
    s.startRun();
    s.dismissStory();
    expect(calls).toEqual(['choose2', 'reroll', 'banish1', 'skip', 'pause', 'resume', 'quit', 'go:heroSelect', 'start', 'story']);
  });

  it('select merges partial selections', () => {
    const s = new GameStore();
    s.select({ zone: 'seori', difficulty: 'hard' });
    expect(s.selection.value.zone).toBe('seori');
    expect(s.selection.value.classId).toBe('warrior');
  });

  it('a failed run load stays on the loading screen with the error (the screen that shows it + its Back button)', () => {
    const s = new GameStore();
    s.setScreen('loading');
    s.setLoading({ fraction: 0.4, label: 'models', error: null });
    s.failLoading('The run could not be loaded (Failed to fetch).');
    expect(s.screen.value).toBe('loading');
    expect(s.loading.value).toEqual({ fraction: 0.4, label: 'models', error: 'The run could not be loaded (Failed to fetch).' });
    // a later start clears it again
    s.setLoading({ fraction: 0, label: 'content', error: null });
    expect(s.loading.value.error).toBeNull();
  });
});

describe('loadFailureMessage', () => {
  it('is the localised sentence with the technical cause, never the bare exception text', async () => {
    const { loadFailureMessage } = await import('./loadFailure');
    const { dictionaries } = await import('../i18n/i18n');
    const msg = loadFailureMessage(new TypeError('Failed to fetch'));
    expect(msg).toContain('Failed to fetch');
    expect(msg).not.toBe('Failed to fetch');
    expect(msg).not.toContain('{reason}');
    expect(msg).not.toContain('boot.loadFailed');
    expect(dictionaries.en['boot.loadFailed']).toContain('{reason}');
    expect(dictionaries.tr['boot.loadFailed']).toContain('{reason}');
    // multi-line / long causes are flattened and capped
    const long = loadFailureMessage(`line one\n${'x'.repeat(400)}`);
    expect(long).not.toContain('\n');
    expect(long.length).toBeLessThan(400);
    expect(loadFailureMessage('')).toContain('unknown error');
    // the two dynamic imports above are module loads served by the shared transform server: alone they take ~0.3 s, but in the
    // parallel full run they queue behind every other worker and tripped the 5 s default (release test flake). 60 s = hang guard.
  }, 60_000);
});

describe('styleFromName', () => {
  it('derives shape and element color from the preset name', () => {
    expect(styleFromName('proj_fire_arrow', false).shape).toBe('arrow');
    expect(styleFromName('proj_fire_arrow', false).color).toBe('#ff7a1a');
    expect(styleFromName('sword_wave', false).shape).toBe('blade');
    expect(styleFromName('lightning_bolt', false).shape).toBe('bolt');
    expect(styleFromName('talisman_flying', false).shape).toBe('talisman');
    expect(styleFromName('mystery', false).shape).toBe('orb');
  });

  it('hostile projectiles are red', () => {
    expect(styleFromName('anything', true).color).toBe('#ff3a2a');
  });
});
