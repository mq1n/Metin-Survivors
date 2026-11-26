// Gallery scenarios: pause menu, its settings sub-view and the Settings screen with every tab, a real cloud-sync conflict
// against the MockApi and the offline (no cloud) state (owner: B8 pause-settings).
import { pauseSubView } from '../../modals/Pause';
import { settingsTab, type SettingsTab } from '../../screens/Settings';
import { openView } from '../../view';
import type { GalleryCtx } from '../../gallery';
import { inRun, openSub, restoreServices, type Scenario } from '../scenarioKit';

export const order = 60;

/** The mock api has no `deleteAccount` (the privacy card hides its delete action then); these scenarios graft one on. */
interface ErasableMock {
  hasCredentials(): boolean;
  deleteAccount?: () => Promise<void>;
}
let erasePatched: { has: () => boolean; del: (() => Promise<void>) | undefined } | null = null;
function armErase(g: GalleryCtx, linked = true): void {
  const api = g.api as unknown as ErasableMock;
  erasePatched ??= { has: api.hasCredentials.bind(api), del: api.deleteAccount };
  let erased = !linked;
  api.hasCredentials = () => !erased;
  api.deleteAccount = async () => {
    await new Promise((r) => window.setTimeout(r, 350));
    erased = true;
  };
}
function disarmErase(g: GalleryCtx): void {
  if (!erasePatched) return;
  const api = g.api as unknown as ErasableMock;
  api.hasCredentials = erasePatched.has;
  if (erasePatched.del) api.deleteAccount = erasePatched.del;
  else delete api.deleteAccount;
  erasePatched = null;
}
const scrollBodyToEnd = (): void => {
  window.setTimeout(() => {
    const el = document.querySelector('.ms-set-body');
    if (el) el.scrollTop = el.scrollHeight;
  }, 900);
};

const settingsAt = (tab: SettingsTab): Scenario => ({
  id: `settings-${tab}`,
  label: `Settings · ${tab}`,
  run: (g) => {
    restoreServices(g);
    disarmErase(g);
    settingsTab.value = tab;
    openSub(g, 'settings');
  },
});

export const scenarios: Scenario[] = [
  {
    id: 'settings',
    label: 'Settings',
    run: (g) => {
      g.store.setScreen('menu');
      openView('settings');
    },
  },
  settingsAt('audio'),
  settingsAt('graphics'),
  settingsAt('controls'),
  settingsAt('profile'),
  settingsAt('data'),
  {
    id: 'settings-conflict',
    label: 'Settings · sync conflict',
    run: (g) => {
      restoreServices(g);
      settingsTab.value = 'profile';
      openSub(g, 'settings');
      // a different cloud copy → the next sync surfaces the resolver dialog
      void (async () => {
        const cloudSave = structuredClone(g.meta.save);
        cloudSave.stats.runs += 7;
        cloudSave.stats.wins += 3;
        cloudSave.stats.bestScore = Math.round(cloudSave.stats.bestScore * 1.4);
        cloudSave.stats.playTime += 5400;
        cloudSave.bank.yeop = 52_000;
        cloudSave.bank.shards += 21;
        cloudSave.profile.updated -= 2 * 86_400_000;
        const cur = await g.api.getSave();
        await g.api.putSave(JSON.stringify(cloudSave), cur?.meta.rev ?? 0);
        window.setTimeout(() => void g.meta.syncNow(), 500);
      })();
    },
  },
  {
    id: 'settings-privacy',
    label: 'Settings · privacy (linked identity, delete action)',
    run: (g) => {
      restoreServices(g);
      armErase(g, true);
      settingsTab.value = 'profile';
      openSub(g, 'settings');
      scrollBodyToEnd();
    },
  },
  {
    id: 'settings-privacy-none',
    label: 'Settings · privacy (no online identity yet)',
    run: (g) => {
      restoreServices(g);
      armErase(g, false);
      settingsTab.value = 'profile';
      openSub(g, 'settings');
      scrollBodyToEnd();
    },
  },
  {
    id: 'settings-offline',
    label: 'Settings · offline (no cloud)',
    run: (g) => {
      restoreServices(g);
      g.meta.cloud = null;
      settingsTab.value = 'profile';
      openSub(g, 'settings');
    },
  },
  {
    id: 'pause',
    label: 'Pause',
    run: (g) => {
      disarmErase(g);
      inRun(g);
      g.store.setPaused(true);
    },
  },
  {
    id: 'pause-settings',
    label: 'Pause · settings sub-view',
    run: (g) => {
      inRun(g, { t: 372 });
      pauseSubView.value = 'settings';
      g.store.setPaused(true);
    },
  },
];
