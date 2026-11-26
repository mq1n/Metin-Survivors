// Minimal skill-cast visual cue (slot pulse counter + brief floating skill pill above the skill bar).
import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import type { SimEvent } from '../../sim/events';
import { ELEMENT_COLOR } from '../components/Icon';
import { indexOf, skillName } from '../content';
import { deps } from '../env';

export interface CastCue {
  key: number;
  skillId: string;
  icon: string;
  name: string;
  color: string;
}

const MAX_CUES = 2;
const CUE_MS = 1150;
const DEDUPE_MS = 140;

/** Monotonic pulse counter per skill id (Taskbar slots briefly flash when their counter bumps). */
export const slotFlash = signal<Record<string, number>>({});
/** Active minimal skill-name pills (non-basic skills only, max 2). */
export const castCues = signal<CastCue[]>([]);

let cueSeq = 1;
const lastCastMs = new Map<string, number>();
const cueTimers = new Set<ReturnType<typeof setTimeout>>();

export function clearSkillCues(): void {
  for (const id of cueTimers) clearTimeout(id);
  cueTimers.clear();
  slotFlash.value = {};
  castCues.value = [];
  lastCastMs.clear();
}

export function pushSkillCue(skillId: string): void {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const prev = lastCastMs.get(skillId) ?? -1e9;
  if (now - prev < DEDUPE_MS) return;
  lastCastMs.set(skillId, now);

  const cur = slotFlash.value;
  slotFlash.value = { ...cur, [skillId]: (cur[skillId] ?? 0) + 1 };

  const def = indexOf().skills.get(skillId);
  if (!def || def.kind === 'basic') return;
  const key = cueSeq++;
  const color = ELEMENT_COLOR[def.element] ?? '#e6c47c';
  const entry: CastCue = { key, skillId, icon: def.icon || skillId, name: skillName(skillId), color };
  castCues.value = [...castCues.value.filter((c) => c.skillId !== skillId), entry].slice(-MAX_CUES);
  const tid = setTimeout(() => {
    cueTimers.delete(tid);
    castCues.value = castCues.value.filter((c) => c.key !== key);
  }, CUE_MS);
  cueTimers.add(tid);
}

/** Subscribes the HUD to local-hero `skillCast` sim events and clears cues on run boundaries. */
export function useSkillCueFeed(): void {
  useEffect(() => {
    const { events, store } = deps();
    if (!events) return undefined;
    const offEv = events.subscribe((e: SimEvent) => {
      if (e.t === 'runEnd') {
        clearSkillCues();
        return;
      }
      if (e.t !== 'skillCast') return;
      const localPlayer = store.hud.value?.player ?? 0;
      if (e.player !== localPlayer) return;
      pushSkillCue(e.skillId);
    });
    const offLife = events.subscribeLifecycle?.({
      runStart: () => clearSkillCues(),
      runEnd: () => clearSkillCues(),
    });
    return () => {
      offEv();
      offLife?.();
      clearSkillCues();
    };
  }, []);
}
