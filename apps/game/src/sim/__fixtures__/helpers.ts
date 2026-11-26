// Tiny constructors shared by the fixture content modules. Data stays explicit in the callers.

import type { L10n, UpgradeLine, UpgradeStat } from '../../data/schema';

/** L10n literal: Turkish first, English second. */
export const t = (tr: string, en: string): L10n => ({ tr, en });

/** Percentage upgrade line (0.15 = +15% at common rarity; for cooldown/tick = −15%). */
export const pct = (stat: UpgradeStat, base: number): UpgradeLine => ({ stat, base, mode: 'pct' });

/** Flat upgrade line (absolute amount at common rarity; for cooldown/tick = −seconds). */
export const flat = (stat: UpgradeStat, base: number): UpgradeLine => ({ stat, base, mode: 'flat' });
