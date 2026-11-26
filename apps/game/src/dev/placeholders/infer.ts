// DEV-only: maps an asset id (+ optional kind hint) to the procedural builder that should stand in for it.
import type { ModelKind } from '../../data/assetManifest';
import { Rng, hashString } from './math';
import type { Archetype } from './creatures';

export type HeroClass = 'warrior' | 'ninja' | 'yacha' | 'shaman' | 'wolfman';

export type Plan =
  | { type: 'creature'; kind: ModelKind; archetype: Archetype; variant?: string; seed: number }
  | { type: 'hero'; cls: HeroClass; female: boolean; tier: number; seed: number }
  | { type: 'weapon'; weapon: string; seed: number }
  | { type: 'metin'; seed: number }
  | { type: 'pickup'; item: string; seed: number }
  | { type: 'prop'; prop: string; seed: number };

/** token match: whole word, or prefix of a longer token when the word is >= 4 chars (`quad` → `quadruped`) */
const has = (id: string, words: readonly string[]): boolean =>
  id
    .split(/[^a-z]+/)
    .filter((t) => t.length > 0)
    .some((t) => words.some((w) => t === w || (w.length >= 4 && t.startsWith(w))));

const QUAD_WORDS: [readonly string[], string][] = [
  [['wolf', 'dog', 'jackal', 'hound', 'fox', 'coyote'], 'wolf'],
  [['boar', 'pig', 'hog', 'swine'], 'boar'],
  [['bear'], 'bear'],
  [['tiger', 'cat', 'lion', 'leopard', 'panther', 'lynx'], 'cat'],
];
const HUMANOID_WORDS: [readonly string[], string][] = [
  [['orc', 'grunt'], 'orc'],
  [['goblin', 'imp', 'kobold', 'gnome'], 'goblin'],
  [['ninja', 'assassin', 'shinobi', 'rogue'], 'ninja'],
  [['bandit', 'soldier', 'human', 'thug', 'guard', 'raider', 'warrior', 'skeleton'], 'bandit'],
];
const BRUTE_WORDS: [readonly string[], string][] = [
  [['golem'], 'golem'],
  [['yeti', 'ape', 'gorilla', 'monkey', 'snow'], 'yeti'],
  [['ogre', 'troll', 'giant', 'cyclops'], 'ogre'],
];
const BOSS_WORDS: [readonly string[], string][] = [
  [['oni', 'demon', 'devil'], 'oni'],
  [['warlord', 'king', 'general', 'lord', 'chief'], 'warlord'],
  [['tiger', 'beast', 'wolf', 'boar', 'bear'], 'beast'],
];

function lookup(id: string, table: [readonly string[], string][]): string | undefined {
  for (const [words, v] of table) if (has(id, words)) return v;
  return undefined;
}

export const WEAPON_NAMES = ['sword', 'dagger', 'blade_yacha', 'bow', 'staff', 'fan', 'bell', 'claw', 'club', 'spear'] as const;

export function inferPlan(id: string, hint?: ModelKind): Plan {
  const key = id.toLowerCase();
  const seed = hashString(id);
  const rng = new Rng(seed);

  if (key.startsWith('hero_') || hint === 'hero' || /^(warrior|ninja|yacha|shaman|wolfman)_[mf]/.test(key)) {
    const cls = (['warrior', 'ninja', 'yacha', 'shaman', 'wolfman'] as const).find((c) => key.includes(c)) ?? (['warrior', 'ninja', 'yacha', 'shaman', 'wolfman'] as const)[rng.int(5)] ?? 'warrior';
    const tier = /_t(\d)/.exec(key)?.[1];
    return { type: 'hero', cls, female: /_f(_|$)/.test(key), tier: tier ? Number(tier) : 1, seed };
  }
  if (key.startsWith('weapon_') || hint === 'weapon') {
    const name = WEAPON_NAMES.find((w) => key.includes(w)) ?? (key.includes('katana') || key.includes('blade') ? 'sword' : WEAPON_NAMES[rng.int(WEAPON_NAMES.length)] ?? 'sword');
    return { type: 'weapon', weapon: name, seed };
  }
  if (key.startsWith('metin') || hint === 'metin') return { type: 'metin', seed };
  if (hint === 'pickup' || has(key, ['xp', 'gem', 'yeop', 'coin', 'potion', 'chest'])) {
    const item = has(key, ['chest']) && has(key, ['boss']) ? 'chest_boss' : has(key, ['chest']) && has(key, ['gold']) ? 'chest_gold' : has(key, ['chest']) ? 'chest_wood' : has(key, ['yeop', 'coin']) ? 'yeop_coin' : has(key, ['potion']) ? 'potion_hp' : 'xp_gem';
    return { type: 'pickup', item, seed };
  }
  if (hint === 'prop' || hint === 'tree') {
    const prop = has(key, ['pine', 'fir', 'spruce']) ? 'pine' : has(key, ['oak', 'tree', 'maple']) ? 'oak' : has(key, ['bush', 'shrub']) ? 'bush' : has(key, ['lantern', 'lamp']) ? 'lantern' : has(key, ['grave', 'tomb']) ? 'gravestone' : has(key, ['rock', 'stone', 'boulder']) ? 'rock' : hint === 'tree' ? 'pine' : 'rock';
    return { type: 'prop', prop, seed };
  }

  // creatures
  if (hint === 'boss' || has(key, ['boss'])) {
    return { type: 'creature', kind: 'boss', archetype: 'boss', variant: lookup(key, BOSS_WORDS), seed };
  }
  const kind: ModelKind = hint === 'creature' || hint === undefined ? 'creature' : hint;
  const brute = lookup(key, BRUTE_WORDS);
  if (has(key, ['brute']) || brute) return { type: 'creature', kind, archetype: 'brute', variant: brute, seed };
  const human = lookup(key, HUMANOID_WORDS);
  if (has(key, ['humanoid', 'human']) || human) return { type: 'creature', kind, archetype: 'humanoid', variant: human, seed };
  const quad = lookup(key, QUAD_WORDS);
  if (has(key, ['quad']) || quad) return { type: 'creature', kind, archetype: 'quadruped', variant: quad, seed };
  if (hint === undefined && (has(key, ['rock', 'pine', 'tree', 'lantern', 'grave']))) {
    return { type: 'prop', prop: has(key, ['pine']) ? 'pine' : has(key, ['lantern']) ? 'lantern' : has(key, ['tree']) ? 'oak' : has(key, ['grave']) ? 'gravestone' : 'rock', seed };
  }
  const roll = rng.next();
  const archetype: Archetype = roll < 0.42 ? 'quadruped' : roll < 0.84 ? 'humanoid' : 'brute';
  return { type: 'creature', kind, archetype, seed };
}
