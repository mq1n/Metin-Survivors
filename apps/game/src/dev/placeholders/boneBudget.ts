// DEV-only: re-targets a finished creature build to a requested bone count (bake/skinning cost benchmarks).
// Fewer bones: the least-influential non-socket bones are removed, their skin weights folded into the nearest kept
// ancestor and their animation tracks dropped. More bones: unweighted `aux_NN` bones hang off the back with a gentle
// sway track in every clip (full track coverage, like every other bone).
import { AnimationClip, BufferGeometry, Quaternion, QuaternionKeyframeTrack, Euler, type KeyframeTrack } from 'three';
import type { CreatureBuild } from './creatures';
import { Rig } from './rig';

/** Hard sanity cap for the `bones` option (the FORGE contract itself is 32, boss 48). */
export const MAX_TEST_BONES = 128;

interface SkinPart {
  index: Uint16Array;
  weight: Float32Array;
  count: number;
}

function skinOf(g: BufferGeometry): SkinPart {
  const index = g.getAttribute('skinIndex')?.array;
  const weight = g.getAttribute('skinWeight')?.array;
  if (!(index instanceof Uint16Array) || !(weight instanceof Float32Array)) throw new Error('creature geometry has no skin attributes');
  return { index, weight, count: g.getAttribute('position').count };
}

/** Folds removed bones into `remap[old] = new index` and renormalises, merging duplicate influences. */
function remapSkin(g: BufferGeometry, remap: Int32Array): void {
  const { index, weight, count } = skinOf(g);
  const ids = [0, 0, 0, 0];
  const ws = [0, 0, 0, 0];
  for (let v = 0; v < count; v++) {
    let n = 0;
    for (let k = 0; k < 4; k++) {
      const w = weight[v * 4 + k] as number;
      if (w <= 0) continue;
      const to = remap[index[v * 4 + k] as number] as number;
      let slot = -1;
      for (let s = 0; s < n; s++) if (ids[s] === to) slot = s;
      if (slot < 0) {
        slot = n++;
        ids[slot] = to;
        ws[slot] = 0;
      }
      ws[slot] = (ws[slot] as number) + w;
    }
    let sum = 0;
    for (let s = 0; s < n; s++) sum += ws[s] as number;
    for (let k = 0; k < 4; k++) {
      index[v * 4 + k] = k < n ? (ids[k] as number) : 0;
      weight[v * 4 + k] = k < n && sum > 0 ? (ws[k] as number) / sum : 0;
    }
  }
  g.getAttribute('skinIndex').needsUpdate = true;
  g.getAttribute('skinWeight').needsUpdate = true;
}

function influence(parts: readonly { geometry: BufferGeometry }[], bones: number): Float64Array {
  const total = new Float64Array(bones);
  for (const p of parts) {
    const { index, weight, count } = skinOf(p.geometry);
    for (let i = 0; i < count * 4; i++) total[index[i] as number] = (total[index[i] as number] as number) + (weight[i] as number);
  }
  return total;
}

function reduce(build: CreatureBuild, target: number): CreatureBuild {
  const old = build.rig;
  const pinned = new Set<string>([old.defs[0]!.name, ...Object.values(build.sockets)]);
  const total = influence(build.parts, old.count);
  const keep = old.defs.map(() => true);
  let alive = old.count;
  while (alive > target) {
    let pick = -1;
    for (let i = 0; i < old.count; i++) {
      if (!keep[i] || pinned.has(old.defs[i]!.name)) continue;
      if (pick < 0 || (total[i] as number) < (total[pick] as number)) pick = i;
    }
    if (pick < 0) break;
    keep[pick] = false;
    alive--;
  }
  // nearest kept ancestor-or-self for every bone
  const rig = new Rig();
  const newIndex = new Int32Array(old.count).fill(-1);
  const remap = new Int32Array(old.count);
  const survivor = (i: number): number => {
    let cur = i;
    while (!keep[cur]) cur = old.i(old.defs[cur]!.parent as string);
    return cur;
  };
  old.defs.forEach((d, i) => {
    if (!keep[i]) return;
    const parent = d.parent === null ? null : (old.defs[survivor(old.i(d.parent))] as { name: string }).name;
    newIndex[i] = rig.add(d.name, parent, d.pos);
  });
  for (let i = 0; i < old.count; i++) remap[i] = newIndex[survivor(i)] as number;
  for (const p of build.parts) remapSkin(p.geometry, remap);
  const gone = new Set(old.defs.filter((_, i) => !keep[i]).map((d) => d.name));
  const clips = build.clips.map((c) => {
    const tracks: KeyframeTrack[] = c.tracks.filter((t) => !gone.has(t.name.slice(0, t.name.lastIndexOf('.'))));
    return new AnimationClip(c.name, c.duration, tracks);
  });
  return { ...build, rig, clips };
}

function extend(build: CreatureBuild, target: number): CreatureBuild {
  const old = build.rig;
  const rig = new Rig();
  for (const d of old.defs) rig.add(d.name, d.parent, d.pos);
  const anchor = rig.has('back') ? 'back' : old.defs[0]!.name;
  const at = rig.pos(anchor);
  const extra: string[] = [];
  for (let n = 0; rig.count < target; n++) {
    const name = `aux_${String(n).padStart(2, '0')}`;
    rig.add(name, anchor, [at[0], at[1] + 0.02 * (n + 1), at[2]]);
    extra.push(name);
  }
  const q = new Quaternion();
  const clips = build.clips.map((c) => {
    const tracks: KeyframeTrack[] = [...c.tracks];
    extra.forEach((name, k) => {
      const amp = 0.08 + 0.01 * (k % 5);
      const keys = [0, c.duration / 2, c.duration];
      const vals: number[] = [];
      for (const s of [0, 1, 0]) {
        q.setFromEuler(new Euler(amp * s, 0, amp * 0.5 * s));
        vals.push(q.x, q.y, q.z, q.w);
      }
      tracks.push(new QuaternionKeyframeTrack(`${name}.quaternion`, keys, vals));
    });
    return new AnimationClip(c.name, c.duration, tracks);
  });
  return { ...build, rig, clips };
}

/** Returns the build re-targeted to `target` bones (clamped to [pinned minimum, MAX_TEST_BONES]). */
export function fitBoneBudget(build: CreatureBuild, target: number): CreatureBuild {
  const goal = Math.min(MAX_TEST_BONES, Math.max(1, Math.round(target)));
  if (goal < build.rig.count) return reduce(build, goal);
  if (goal > build.rig.count) return extend(build, goal);
  return build;
}
