
import { GEN } from '../_gen/radiant_thread.gen';
import { registerPatchedFamily } from '../families';
import { PATCH } from './radiant_thread.patch';

registerPatchedFamily('radiant_thread', GEN, PATCH, { live: true });
