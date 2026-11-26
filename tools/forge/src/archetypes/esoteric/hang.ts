// Gravity hang for rigid-skinned cloth chains (cape / scarf / hair bones): a chain bone inherits its parent's rotation, so a hunched or leaning
// torso swings a hanging cloth up and forward. `hangChain` counter-rotates each bone by a share of its parent's world rotation (pitch / roll;
// yaw is kept so the cloth follows a turning body), leaving the secondary-motion wave the clip already wrote on top untouched in world axes.
import { type PoseCtx } from '../../core/anim/clip.ts';
import { qinv, qmul, qnorm, qslerp } from '../../core/math.ts';

/** share (0..1) of the parent's world rotation to cancel for each bone name that exists in the skeleton */
export function hangChain(c: PoseCtx, bones: readonly string[], k: number): void {
  const sk = c.skel;
  for (const name of bones) {
    if (!sk.has(name)) continue;
    const w = sk.fk(c.pose);
    const i = sk.idx(name);
    const pw = w.rot[sk.parent[i]!]!;
    const old = c.pose.rot[i]!;
    const hung = qnorm(qmul(qinv(pw), old));
    c.setQ(name, qslerp(old, hung, k));
  }
}
