// Weapon family registry (auto-discovered by src/models/index.ts). Specs are plain data; builders run lazily inside build().
import { buildBell } from '../../archetypes/weapon/bell.ts';
import type { BellSpec } from '../../archetypes/weapon/bell.ts';
import { buildBow } from '../../archetypes/weapon/bow.ts';
import type { BowSpec } from '../../archetypes/weapon/bow.ts';
import { buildClaw } from '../../archetypes/weapon/claw.ts';
import type { ClawSpec } from '../../archetypes/weapon/claw.ts';
import { buildFan } from '../../archetypes/weapon/fan.ts';
import type { FanSpec } from '../../archetypes/weapon/fan.ts';
import type { ModelEntry } from '../../core/registry.ts';
import { buildSword } from '../../archetypes/weapon/sword.ts';
import type { SwordSpec } from '../../archetypes/weapon/sword.ts';
import { wolfmanClaws } from './wolfman_claw.ts';
import { ninjaBows } from './ninja_bow.ts';
import { ninjaDaggers } from './ninja_dagger.ts';
import { shamanBells } from './shaman_bell.ts';
import { shamanFans } from './shaman_fan.ts';
import { yachaSwords } from './yacha_sword.ts';
import { warriorSwords } from './warrior_sword.ts';
import { warriorTwohands } from './warrior_twohand.ts';

const sword = (s: SwordSpec): ModelEntry => ({ id: s.id, kind: 'weapon', build: (log, opts) => buildSword(s, log, opts) });
const bow = (s: BowSpec): ModelEntry => ({ id: s.id, kind: 'weapon', build: (log, opts) => buildBow(s, log, opts) });
const fan = (s: FanSpec): ModelEntry => ({ id: s.id, kind: 'weapon', build: (log, opts) => buildFan(s, log, opts) });
const bell = (s: BellSpec): ModelEntry => ({ id: s.id, kind: 'weapon', build: (log, opts) => buildBell(s, log, opts) });
const claw = (s: ClawSpec): ModelEntry => ({ id: s.id, kind: 'weapon', build: (log, opts) => buildClaw(s, log, opts) });

export const registry: ModelEntry[] = [
  ...[...warriorSwords, ...warriorTwohands, ...yachaSwords, ...ninjaDaggers].map(sword),
  ...ninjaBows.map(bow),
  ...shamanFans.map(fan),
  ...shamanBells.map(bell),
  ...wolfmanClaws.map(claw),
];
