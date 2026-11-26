// EXPLORER-3: "Main menu" from a co-op report opened the lobby of the dead room (the sub-view 'coop' and the coopRoom signal outlive the run).
import { afterEach, describe, expect, it } from 'vitest';
import { leaveCoopForMenu, registerCoopLobbyReset, resultToMenu, subView } from './view';

afterEach(() => {
  registerCoopLobbyReset(null);
  subView.value = 'main';
});

describe('resultToMenu', () => {
  it('a co-op report leaves the lobby view and forgets the room BEFORE the menu shows', () => {
    const order: string[] = [];
    registerCoopLobbyReset(() => order.push('reset'));
    subView.value = 'coop';
    resultToMenu(2, () => order.push(`go:${subView.value}`));
    expect(order).toEqual(['reset', 'go:main']);
    expect(subView.value).toBe('main');
  });

  it('a solo report goes straight to the menu and leaves the sub-view alone', () => {
    let resets = 0;
    registerCoopLobbyReset(() => resets++);
    subView.value = 'armory';
    let went = 0;
    resultToMenu(1, () => went++);
    resultToMenu(undefined, () => went++);
    expect(resets).toBe(0);
    expect(went).toBe(2);
    expect(subView.value).toBe('armory');
  });

  it('works without a registered lobby (nothing to forget)', () => {
    subView.value = 'coop';
    expect(() => leaveCoopForMenu()).not.toThrow();
    expect(subView.value).toBe('main');
  });
});

describe('the co-op lobby registers its reset', () => {
  it('importing the co-op screen wires coopRoom to the Main menu path', async () => {
    // the first import of the module (this test) registers the reset at load; the afterEach above only clears it afterwards
    const { coopRoom } = await import('./screens/Coop');
    coopRoom.value = 'AHTH9T';
    subView.value = 'coop';
    resultToMenu(2, () => {});
    expect(coopRoom.value).toBeNull();
    expect(subView.value).toBe('main');
  }, 60_000);
});
