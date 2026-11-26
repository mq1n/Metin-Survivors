// Registry helpers for the C0 legacy barrels: rebuild a legacy array (original ids, original order) from the target
// folders, so presets/index.ts, skills/common.ts, tests and tools keep importing the old names unchanged.
import type { PresetDef } from '../presets/types';
import type { FxSpec } from '../spec/types';

/** entries of `ids` in that order, each taken from the first source that has it; ids no source provides are skipped
 *  (vfx/__tests__/registryIds.test.ts reports them — never throw here: a throw at import time breaks the dev server) */
export function pickById<T extends { readonly id: string }>(ids: readonly string[], ...sources: ReadonlyArray<readonly T[]>): T[] {
  const out: T[] = [];
  for (const id of ids) {
    for (const src of sources) {
      const hit = src.find((d) => d.id === id);
      if (hit !== undefined) {
        out.push(hit);
        break;
      }
    }
  }
  return out;
}

export const pickPresets: (ids: readonly string[], ...sources: ReadonlyArray<readonly PresetDef[]>) => PresetDef[] = pickById;
export const pickSpecs: (ids: readonly string[], ...sources: ReadonlyArray<readonly FxSpec[]>) => FxSpec[] = pickById;
