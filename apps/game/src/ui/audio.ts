// UI sound hooks. The audio runtime (optional) exposes `playUi(id)`; the UI only ever passes base sfx ids.
// Hover sounds are throttled so sweeping the pointer across a button grid does not machine-gun.
import { deps, hasDeps } from './env';

export type UiSfx =
  | 'hover'
  | 'click'
  | 'confirm'
  | 'back'
  | 'tab'
  | 'open'
  | 'close'
  | 'equip'
  | 'error'
  | 'unlock'
  | 'purchase'
  | 'toggleOn'
  | 'toggleOff'
  | 'cardHover'
  | 'cardPick'
  | 'cardReroll'
  | 'cardBanish'
  | 'levelUp'
  | 'essencePick'
  | 'chestOpen'
  | 'forgeSuccess'
  | 'forgeFail'
  | 'bossRoar'
  | 'metinWarning';

const IDS: Record<UiSfx, string> = {
  hover: 'sfx_ui_hover',
  click: 'sfx_ui_click',
  confirm: 'sfx_ui_confirm',
  back: 'sfx_ui_back',
  tab: 'sfx_ui_tab',
  open: 'sfx_ui_open',
  close: 'sfx_ui_close',
  equip: 'sfx_ui_equip',
  error: 'sfx_ui_error',
  unlock: 'sfx_ui_unlock',
  purchase: 'sfx_ui_purchase',
  toggleOn: 'sfx_ui_toggle_on',
  toggleOff: 'sfx_ui_toggle_off',
  cardHover: 'sfx_card_hover',
  cardPick: 'sfx_card_pick',
  cardReroll: 'sfx_card_reroll',
  cardBanish: 'sfx_card_banish',
  levelUp: 'sfx_level_up',
  essencePick: 'sfx_essence_pick',
  chestOpen: 'sfx_chest_open',
  forgeSuccess: 'sfx_forge_success',
  forgeFail: 'sfx_forge_fail',
  bossRoar: 'sfx_boss_roar',
  metinWarning: 'sfx_metin_warning',
};

const lastPlayed: Partial<Record<UiSfx, number>> = {};
const THROTTLE_MS: Partial<Record<UiSfx, number>> = { hover: 55, cardHover: 90, tab: 60 };

export function sfx(kind: UiSfx): void {
  if (!hasDeps()) return;
  const gap = THROTTLE_MS[kind] ?? 0;
  if (gap > 0) {
    const now = performance.now();
    if (now - (lastPlayed[kind] ?? -1e9) < gap) return;
    lastPlayed[kind] = now;
  }
  try {
    deps().audio?.playUi(IDS[kind]);
  } catch {
    /* audio failures never break the UI */
  }
}
