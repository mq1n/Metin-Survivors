// Wiring of the GENERATED second_wind family (spec/README.md "Generated families + patches"): found by skills/warrior/index.ts through
// import.meta.glob('./*.family.ts'). live: true = this family replaces the hand spec sk.second_wind (body.ts, a selfBuff cast of the OLD skill: dead since the cone switch).

// contract (base 8 m = the cone length) and re-patched (second_wind.patch.ts: strike group at 0.25 s so gather-then-strike reads at the moment of the damage, a hand
// needle fan over the wedge, no occlude), then flipped live after the in-game cast at rank 7 read as gather (blue disc + lightning pillar) then fan

import { GEN } from '../_gen/second_wind.gen';
import { registerPatchedFamily } from '../families';
import { PATCH } from './second_wind.patch';

registerPatchedFamily('second_wind', GEN, PATCH, { live: true });
