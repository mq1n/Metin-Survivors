// Public entry of the UI layer.
//
//   const dispose = mountUi(document.getElementById('ui')!, { store, meta, content, assets, api, audio, input, events, heroPreview, project });
//
// Mounts a Preact tree into `root`: screens (boot/loading, menu + Armory/Settings/Leaderboard/Co-op/Credits, hero & zone
// select, results), the in-run HUD, and the modal layer (level-up, essence, chest, boss reward, pause, story, run end).
import './style/index.css';
import { h, render } from 'preact';
import { UiRoot } from './app';
import { applyTextureVars } from './assets';
import { setDeps, type UiDeps } from './env';
import { startLayout } from './layout';
import { installNav } from './nav';
import { resetUiState } from './view';

export type { UiDeps, UiAudio, HeroPreviewHook, HeroPreviewHandle, HeroPreviewSelection, ProjectFn, ScreenPoint, UiEventSource } from './env';

export function mountUi(root: HTMLElement, deps: UiDeps): () => void {
  setDeps(deps);
  resetUiState();
  const host = document.createElement('div');
  host.className = 'ms-ui';
  // #ui > * { pointer-events: auto } in index.html would otherwise make the whole overlay swallow canvas input
  host.style.pointerEvents = 'none';
  root.appendChild(host);
  applyTextureVars(host);
  const stopLayout = startLayout(host);
  const stopNav = installNav(host);
  render(h(UiRoot, null), host);
  return () => {
    render(null, host);
    stopNav();
    stopLayout();
    host.remove();
    resetUiState();
    setDeps(null);
  };
}
