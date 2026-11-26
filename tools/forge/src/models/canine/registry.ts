// Canine family registry. Auto-discovered by src/models/index.ts (any src/models/<family>/registry.ts exporting `registry`).
import type { CanineParams } from '../../archetypes/canine/index.ts';
import { buildCanine } from '../../archetypes/canine/index.ts';
import type { ModelEntry } from '../../core/registry.ts';
import { alphaBlueWolf } from './alpha_blue_wolf.ts';
import { alphaGreyWolf } from './alpha_grey_wolf.ts';
import { alphaWolf } from './alpha_wolf.ts';
import { blueWolf } from './blue_wolf.ts';
import { greyWolf } from './grey_wolf.ts';
import { blightedHound } from './blighted_hound.ts';
import { wildDog } from './wild_dog.ts';
import { wolf } from './wolf.ts';

const canine = (p: CanineParams): ModelEntry => ({ id: p.id, kind: p.kind, build: (log, opts) => buildCanine(p, log, opts) });

export const registry: ModelEntry[] = [wildDog, wolf, alphaWolf, blueWolf, alphaBlueWolf, greyWolf, alphaGreyWolf, blightedHound].map(canine);
