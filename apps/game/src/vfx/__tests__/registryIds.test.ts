// C0 safety net for the common-VFX ownership split: no registered id may vanish by accident, and every id lives in the
// vfx/common/<target> folder that owns it. registryIds.json is the committed snapshot (sorted ids of everything except
// the skill-class specs + the owner of each common-target id); only the core owner edits it, when an id is deleted or
// re-homed on purpose. Builders may ADD ids freely (they are registered automatically and need no snapshot entry).
import { describe, expect, it } from 'vitest';
import { COMMON_TARGETS, COMMON_TARGET_IDS } from '../common';
import { PRESETS } from '../presets';
import { BOSS_PRESETS } from '../presets/boss';
import { CAST_PRESETS } from '../presets/cast';
import { DEATH_PRESETS } from '../presets/death';
import { FEEDBACK_PRESETS } from '../presets/feedback';
import { HIT_PRESETS } from '../presets/hits';
import { MELEE_PRESETS } from '../presets/melee';
import { WARN_PRESETS } from '../presets/warn';
import { COMBAT_SPECS } from '../skills/common/combat';
import { FEEDBACK_SPECS } from '../skills/common/feedback';
import { METIN_SPECS } from '../skills/common/metin';
import snapshot from './registryIds.json';
import { ensureAllSkillVfx } from '../skills/loader';

// the class specs are lazy chunks (vfx/skills/loader.ts): load them all before this file reads the registry
await ensureAllSkillVfx();

const owners = snapshot.owners as Record<string, string>;

describe('VFX registry ids (C0 snapshot)', () => {
  const registered = new Set(PRESETS.map((p) => p.id));

  it('registers every snapshot id', () => {
    expect(snapshot.ids.filter((id) => !registered.has(id))).toEqual([]);
  });

  it('has unique ids', () => {
    expect(PRESETS.length).toBe(registered.size);
  });

  it('keeps the legacy barrels complete (their arrays are rebuilt from the target folders)', () => {
    const lens = [HIT_PRESETS, DEATH_PRESETS, FEEDBACK_PRESETS, CAST_PRESETS, BOSS_PRESETS, WARN_PRESETS, MELEE_PRESETS].map((a) => a.length);
    expect(lens).toEqual([12, 17, 16, 24, 21, 11, 12]);
    expect([COMBAT_SPECS.length, FEEDBACK_SPECS.length, METIN_SPECS.length]).toEqual([10, 10, 42]);
  });

  it('every target folder is registered under its own id', () => {
    expect(COMMON_TARGETS.map((t) => t.id)).toEqual([...COMMON_TARGET_IDS]);
  });

  it('every snapshot-owned id is provided by its owner folder', () => {
    const provided = new Map<string, string>();
    for (const t of COMMON_TARGETS) for (const d of [...t.presets, ...t.specs]) provided.set(d.id, t.id);
    const wrong = Object.keys(owners).filter((id) => provided.get(id) !== owners[id]).map((id) => `${id}: owner ${owners[id]}, found in ${provided.get(id) ?? 'nothing'}`);
    expect(wrong).toEqual([]);
  });

  it('no id is provided by two target folders', () => {
    const seen = new Map<string, string>();
    const dup: string[] = [];
    for (const t of COMMON_TARGETS) {
      for (const d of [...t.presets, ...t.specs]) {
        const prev = seen.get(d.id);
        if (prev !== undefined) dup.push(`${d.id}: ${prev} + ${t.id}`);
        seen.set(d.id, t.id);
      }
    }
    expect(dup).toEqual([]);
  });

  it('registers every target entry exactly once (legacy barrel or appended)', () => {
    const count = new Map<string, number>();
    for (const p of PRESETS) count.set(p.id, (count.get(p.id) ?? 0) + 1);
    const bad: string[] = [];
    for (const t of COMMON_TARGETS) for (const d of [...t.presets, ...t.specs]) if (count.get(d.id) !== 1) bad.push(d.id);
    expect(bad).toEqual([]);
  });
});
