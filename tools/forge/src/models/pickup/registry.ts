// Pickup family (kind `pickup`): xp gem, yeop coin, health potion and the three chests. Built by archetypes/pickup.
import type { ModelEntry } from '../../core/registry.ts';
import { buildChestBoss } from '../../archetypes/pickup/chestBoss.ts';
import { buildChestGold } from '../../archetypes/pickup/chestGold.ts';
import { buildChestWood } from '../../archetypes/pickup/chestWood.ts';
import { buildCoin } from '../../archetypes/pickup/coin.ts';
import { buildGem } from '../../archetypes/pickup/gem.ts';
import { buildPotion } from '../../archetypes/pickup/potion.ts';

export const registry: ModelEntry[] = [
  { id: 'xp_gem', kind: 'pickup', build: async (log) => buildGem(log) },
  { id: 'yeop_coin', kind: 'pickup', build: async (log) => buildCoin(log) },
  { id: 'potion_hp', kind: 'pickup', build: async (log) => buildPotion(log) },
  { id: 'chest_wood', kind: 'pickup', build: async (log) => buildChestWood(log) },
  { id: 'chest_gold', kind: 'pickup', build: async (log) => buildChestGold(log) },
  { id: 'chest_boss', kind: 'pickup', build: async (log) => buildChestBoss(log) },
];
