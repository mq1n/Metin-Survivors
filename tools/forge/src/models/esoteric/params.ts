import type { EsoParams } from '../../archetypes/esoteric/index.ts';
import { ascetic } from './ascetic.ts';
import { conjurer } from './conjurer.ts';
import { zealot } from './zealot.ts';

export function esoParams(): EsoParams[] {
  return [ascetic(), zealot(), conjurer()];
}
