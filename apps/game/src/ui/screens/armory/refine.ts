// Pure helpers of the refine window (Blacksmith.tsx): tones and tint bands that the CSS keys on. No DOM, no imports, so the
// unit tests run in plain node.

/** success chance -> palette tone (kit good green / amber / bad red; no neon ramp) */
export function rateTone(rate: number): 'good' | 'mid' | 'bad' {
  return rate >= 0.7 ? 'good' : rate >= 0.4 ? 'mid' : 'bad';
}

/** +N -> tint band of its chain pip: 0-3 olive, 4-6 copper, 7-8 crimson, 9+ gold */
export function plusBand(n: number): 1 | 2 | 3 | 4 {
  return n >= 9 ? 4 : n >= 7 ? 3 : n >= 4 ? 2 : 1;
}

/** how many of the `max` chain pips of a talent node are lit, and which one is the next to buy (-1 = none) */
export function chainState(points: number, max: number, canSpend: boolean): { lit: number; next: number } {
  const lit = Math.max(0, Math.min(max, Math.floor(points)));
  return { lit, next: canSpend && lit < max ? lit : -1 };
}

// ---------------------------------------------------------------------------------------------------------------
// Blessing Scroll (MT-03): the view model of the toggle under the success gauge.

/** The scroll's side of a quote (meta/blacksmith.ts `ScrollSide`; structural so this file keeps no imports). */
export interface ScrollQuoteLike {
  rate: number;
  yeop: number;
  gain: number;
  useful: boolean;
  canAfford: boolean;
  /** the normal campaign is complete (`scrollUnlocked`): before that the scroll is shown but cannot be read */
  available: boolean;
  /** the bank holds spare Yeop: after the scroll it still pays every plain attempt the shards allow (`ScrollSide.spare`) */
  spare: boolean;
  /** plain attempts the bank's shards pay for at this step (0: not even one) */
  plainAttempts: number;
  /** Yeop missing to the reserve y x (plainAttempts + 2), 0 when `spare` */
  spareShort: number;
}

export type ScrollState =
  /** the normal campaign is not complete yet: greyed, it opens after the last zone is cleared on Normal */
  | 'locked'
  /** read over the next attempt */
  | 'on'
  /** available, not read */
  | 'off'
  /** the plain chance is already 100 %: nothing to add */
  | 'capped'
  /** the bank cannot pay the scroll's 3x Yeop (no plain attempt is waiting on that Yeop: the shards pay none) */
  | 'short'
  /** the Yeop is still needed by plain attempts: the scroll reads over spare Yeop only, shown greyed with the missing Yeop */
  | 'reserve'
  /** no next step (fully refined) */
  | 'none';

export interface ScrollView {
  state: ScrollState;
  /** the next attempt is made under the scroll (what the UI asks `quoteUpgrade` / `upgradeGear` for) */
  active: boolean;
  /** the switch may be pressed (a switch that is on can always be switched off) */
  enabled: boolean;
  /** whole percentage points the scroll adds, 0 when it adds nothing */
  points: number;
  /** Yeop missing for the scroll, 0 unless state is 'short' (to its price) or 'reserve' (to the spare reserve) */
  shortYeop: number;
}

/** whole percentage points between two chances (0.55 -> 0.70 is 15) */
export function ratePoints(base: number, blessed: number): number {
  return Math.max(0, Math.round((blessed - base) * 100));
}

/**
 * What the toggle shows and does. `wanted` is the player's switch; it only takes effect while the scroll is open, adds something,
 * is read over spare Yeop and the bank can pay it. The odds shown above the switch always follow the state returned here (never a
 * silent downgrade), and `scrollWish` takes the wish back when the purse runs short or the Yeop is reserved for plain attempts, so
 * the switch cannot re-arm by itself later.
 */
export function scrollView(scroll: ScrollQuoteLike | null, wanted: boolean, bankYeop: number): ScrollView {
  if (!scroll) return { state: 'none', active: false, enabled: false, points: 0, shortYeop: 0 };
  if (!scroll.available) return { state: 'locked', active: false, enabled: false, points: 0, shortYeop: 0 };
  if (!scroll.useful) return { state: 'capped', active: false, enabled: false, points: 0, shortYeop: 0 };
  const points = ratePoints(scroll.rate - scroll.gain, scroll.rate);
  // plain attempts are waiting on this Yeop: the scroll must leave enough for them (with no shards for even one, nothing waits: 'short' below)
  if (!scroll.spare && scroll.plainAttempts >= 1) return { state: 'reserve', active: false, enabled: false, points, shortYeop: scroll.spareShort };
  const shortYeop = Math.max(0, scroll.yeop - bankYeop);
  if (shortYeop > 0) return { state: 'short', active: false, enabled: false, points, shortYeop };
  return { state: wanted ? 'on' : 'off', active: wanted, enabled: true, points, shortYeop: 0 };
}

/**
 * The switch the player keeps after a view: the wish is dropped as soon as the view is 'short' (a blessed attempt emptied the
 * purse, or the next step costs more than the bank holds), 'reserve' (the Yeop left is needed by plain attempts) or 'locked'.
 * Without this the wish would survive while the knob shows off, could not be switched off there, and would arm itself again the
 * day the Yeop comes back (a 3x price nobody asked for). 'capped' / 'none' keep it: the player's choice stands for the next step
 * they pick.
 */
export function scrollWish(view: ScrollView, wanted: boolean): boolean {
  return view.state === 'short' || view.state === 'reserve' || view.state === 'locked' ? false : wanted;
}

/**
 * Can this state not be pressed? (every state but 'on' / 'off'). The narrow container draws each of them as the charm chip alone, the
 * size of a tap target, so a greyed plate never takes the success gauge's width on a phone; only 'on' / 'off' are the full plate
 * (the switch, the two chances). The class `sm-scroll--chip` carries it to the CSS.
 */
export function scrollIsChip(state: ScrollState): boolean {
  return state !== 'on' && state !== 'off';
}

/**
 * The toast a tap on a plate that cannot be pressed gives (a phone has no hover, and the chip has no words): the i18n key of what the
 * state means, or null when the state has nothing to say ('on' / 'off' are pressed, 'none' draws no plate).
 */
export function scrollToastKey(state: ScrollState): string | null {
  switch (state) {
    case 'locked':
      return 'smith.fail.scrollLocked';
    case 'reserve':
      return 'smith.scroll.reserveToast';
    case 'short':
      return 'smith.scroll.shortToast';
    case 'capped':
      return 'smith.scroll.cappedToast';
    default:
      return null;
  }
}

/**
 * Does the reserve plate print the missing Yeop? Only while it is no more than the Yeop the bank already holds. A shortfall many times
 * the bank ('595,506 more' next to 16,494) is a wall, not a goal, and it grows with every shard banked: the plate then says that
 * plain attempts come first, and the number stays in the tooltip and the aria label.
 */
export function reserveNumberShown(shortYeop: number, bankYeop: number): boolean {
  return shortYeop <= bankYeop;
}
