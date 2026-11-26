// UiRoot: routes the GameStore screen (+ the menu's local sub-views) to the screen components and mounts the HUD,
// the modal layer, tooltips, UI toasts and the navigation curtain.
import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import type { ModalView } from '../app/store';
import { takeInterruptedRun, type RunMarker } from '../app/runMarker';
import { lang, t } from '../i18n/i18n';
import { hideTip, TooltipHost } from './components/Tooltip';
import { ToastHost } from './components/Modal';
import { deps } from './env';
import { Hud } from './hud/Hud';
// Cascade order of the per-target sheets split out of the shared run-modal / menu sheets in C0 (2026-10-13): import
// order is cascade order (equal-specificity rules in different sheets resolve by it), so these imports pin the exact
// pre-split order. Keep them here, after the HUD sheet and before the modal / screen components. Every component still
// imports its own sheet too (a repeated CSS import is a no-op), so a component also works when mounted alone.
import './modals/runend.css';
import './modals/essence.css';
import './modals/chest.css';
import './modals/boss.css';
import './modals/story.css';
import './modals/pause.css';
import { BossReward } from './modals/BossReward';
import { Chest } from './modals/Chest';
import { Essence } from './modals/Essence';
import { LevelUp } from './modals/LevelUp';
import { Pause } from './modals/Pause';
import { RunEndModal } from './modals/RunEnd';
import { StoryModal } from './modals/Story';
import { Armory } from './screens/armory/Armory';
import './screens/menu.css'; // pinned: main-menu sheet keeps its pre-split slot (after armory, before boot / online / hero)
import { BootScreen } from './screens/Boot';
import { CoopScreen } from './screens/Coop';
import { CreditsScreen } from './screens/Credits';
import { HeroSelect } from './screens/HeroSelect';
import { LeaderboardScreen } from './screens/Leaderboard';
import { MainMenu } from './screens/MainMenu';
import { ResultsScreen } from './screens/Results';
import { SettingsScreen } from './screens/Settings';
import { ZoneSelect } from './screens/ZoneSelect';
import { pushToast, subView } from './view';
import './style/i18n-fit.css'; // last on purpose: long-name wrap rules (P3-8) layered over the screen sheets

function ModalHost({ modal }: { modal: ModalView }): JSX.Element | null {
  switch (modal.kind) {
    case 'pause':
      return <Pause />;
    case 'levelUp':
      return <LevelUp key={modal.request.id} request={modal.request} />;
    case 'essence':
      return <Essence key={modal.request.id} request={modal.request} />;
    case 'chest':
      return <Chest key={modal.request.id} request={modal.request} />;
    case 'bossReward':
      return <BossReward key={modal.request.id} request={modal.request} />;
    case 'runEnd':
      return <RunEndModal key={modal.request.id} request={modal.request} />;
    case 'story':
      return <StoryModal key={`${modal.story.kind}:${modal.story.ref}`} story={modal.story} />;
  }
}

function MenuScreen(): JSX.Element {
  switch (subView.value) {
    case 'armory':
      return <Armory />;
    case 'settings':
      return <SettingsScreen />;
    case 'leaderboard':
      return <LeaderboardScreen />;
    case 'coop':
      return <CoopScreen />;
    case 'credits':
      return <CreditsScreen />;
    default:
      return <MainMenu />;
  }
}

export function UiRoot(): JSX.Element {
  const { store } = deps();
  const screen = store.screen.value;
  const modal = store.modal.value;
  const sub = subView.value;
  lang.value; // re-render the router on language change (keeps document lang in sync)
  document.documentElement.lang = lang.value;
  // a navigation unmounts whatever the pointer hovered, so no pointerleave ever closes its tooltip: drop it explicitly
  useEffect(() => hideTip(), [screen, modal?.kind, sub]);
  // a run the previous page load cut off (a reload mid-run drops it) is reported once, when the menu first opens (QA EXPLORER-4)
  const interrupted = useRef<RunMarker | null | undefined>(undefined);
  if (interrupted.current === undefined) interrupted.current = takeInterruptedRun();
  useEffect(() => {
    if (screen !== 'menu' || !interrupted.current) return;
    interrupted.current = null;
    pushToast(t('runEnd.interrupted'), 'info', 8000);
  }, [screen]);

  let body: JSX.Element | null = null;
  switch (screen) {
    case 'boot':
    case 'loading':
      body = <BootScreen mode={screen} />;
      break;
    case 'menu':
      body = <MenuScreen />;
      break;
    case 'heroSelect':
      body = <HeroSelect />;
      break;
    case 'zoneSelect':
      body = <ZoneSelect />;
      break;
    case 'results':
      body = <ResultsScreen />;
      break;
    case 'run':
      body = <Hud />;
      break;
  }
  return (
    <>
      {body}
      {modal && <ModalHost modal={modal} />}
      <TooltipHost />
      <ToastHost />
      <div key={`${screen}|${sub}`} class="ms-curtain" />
    </>
  );
}
