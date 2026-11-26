// Metin stones (kind `metin`): one shared stone + four zone Great Metins. Built by archetypes/metin.
import type { ModelEntry } from '../../core/registry.ts';
import { buildMetin } from '../../archetypes/metin/build.ts';
import { greatYeonmuSpec } from '../../archetypes/metin/great_yeonmu.ts';
import { greatSuryeonSpec } from '../../archetypes/metin/great_suryeon.ts';
import { greatSeoriSpec } from '../../archetypes/metin/great_seori.ts';
import { greatDaeryeolSpec } from '../../archetypes/metin/great_daeryeol.ts';
import { stoneSpec } from '../../archetypes/metin/stone.ts';

export const registry: ModelEntry[] = [
  { id: 'metin_stone', kind: 'metin', build: (log, opts) => buildMetin(stoneSpec(), log, opts) },
  { id: 'metin_great_yeonmu', kind: 'metin', build: (log, opts) => buildMetin(greatYeonmuSpec(), log, opts) },
  { id: 'metin_great_suryeon', kind: 'metin', build: (log, opts) => buildMetin(greatSuryeonSpec(), log, opts) },
  { id: 'metin_great_seori', kind: 'metin', build: (log, opts) => buildMetin(greatSeoriSpec(), log, opts) },
  { id: 'metin_great_daeryeol', kind: 'metin', build: (log, opts) => buildMetin(greatDaeryeolSpec(), log, opts) },
];
