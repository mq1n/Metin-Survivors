
// and the smoke loops per HP stage and colour set. Owner: FxCommon slice "FxCommonMetin". Authoring guide: ../../spec/README.md.
//

// @0.449 s), metinstone_blow (DEAD @0.28 s), metinstone_laser (DEAD @0.301 s), metinstone_splash (ATTACK hit flash),
// metinstone_loop_<1..4>[_<colour>] (attached to race 8001 bone ChamferCyl04). Numbers only; textures are our roles.
// Legacy barrel since the C0 ownership split: the specs live in vfx/common/metin. METIN_SPECS keeps the original ids and order
// for skills/common.ts (COMMON_SPECS), tests and tools.
import { METIN } from '../../common/metin';
import { pickSpecs } from '../../common/registry';
import type { FxSpec } from '../../spec/types';

export { METIN_LOOP_SETS, metinLoopId, type MetinLoopSet, type MetinLoopStage } from '../../common/metin/specs';

export const METIN_SPECS: FxSpec[] = pickSpecs(
  [
    'sk.gen.metin_drop',
    'sk.gen.metin_crash',
    'sk.gen.metin_break',
    'sk.gen.metin_blow',
    'sk.gen.metin_laser',
    'sk.gen.metin_splash',
    'sk.gen.metin_loop1',
    'sk.gen.metin_loop2',
    'sk.gen.metin_loop3',
    'sk.gen.metin_loop4',
    'sk.gen.metin_loop1.aqua',
    'sk.gen.metin_loop2.aqua',
    'sk.gen.metin_loop3.aqua',
    'sk.gen.metin_loop4.aqua',
    'sk.gen.metin_loop1.blue',
    'sk.gen.metin_loop2.blue',
    'sk.gen.metin_loop3.blue',
    'sk.gen.metin_loop4.blue',
    'sk.gen.metin_loop1.orange',
    'sk.gen.metin_loop2.orange',
    'sk.gen.metin_loop3.orange',
    'sk.gen.metin_loop4.orange',
    'sk.gen.metin_loop1.pink',
    'sk.gen.metin_loop2.pink',
    'sk.gen.metin_loop3.pink',
    'sk.gen.metin_loop4.pink',
    'sk.gen.metin_loop1.purple',
    'sk.gen.metin_loop2.purple',
    'sk.gen.metin_loop3.purple',
    'sk.gen.metin_loop4.purple',
    'sk.gen.metin_loop1.whitepurple',
    'sk.gen.metin_loop2.whitepurple',
    'sk.gen.metin_loop3.whitepurple',
    'sk.gen.metin_loop4.whitepurple',
    'sk.gen.metin_loop1.whitered',
    'sk.gen.metin_loop2.whitered',
    'sk.gen.metin_loop3.whitered',
    'sk.gen.metin_loop4.whitered',
    'sk.gen.metin_loop1.yellow',
    'sk.gen.metin_loop2.yellow',
    'sk.gen.metin_loop3.yellow',
    'sk.gen.metin_loop4.yellow',
  ],
  METIN.specs,
);
