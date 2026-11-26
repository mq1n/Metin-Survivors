// Shared Armory state: which class/doctrine every Armory tab is looking at. The Armory shell owns the selectors; the
// Character / Collection / Drops / Codex / Talents / Blacksmith tabs only read these signals.
import { signal } from '@preact/signals';
import type { ClassId, DoctrineKey, EmpireId, GearSlot, Sex } from '../../../data/schema';
import { deps, hasDeps } from '../../env';
import { indexOf } from '../../content';

/** The class being viewed (initialised from the run selection when the Armory opens). */
export const armoryClass = signal<ClassId>('warrior');
/** The doctrine being previewed for that class. */
export const armoryDoctrine = signal<DoctrineKey>('a');
/** Empire shown in the preview (its bonus is part of the derived stats). */
export const armoryEmpire = signal<EmpireId>('saehwa');
/** Hero sex shown in the preview. */
export const armorySex = signal<Sex>('m');
/** Zone focused in the Drop Tables tab (the Collection tab sets it when an unowned piece is clicked). */
export const armoryDropZone = signal<string | null>(null);
/** Character tab: the gear slot whose picker is open (null = none). A signal so the gallery can open it. */
export const armoryPicked = signal<GearSlot | null>(null);
/** Codex tab: the open page. 'pacts' (the awakening pacts of the viewed hero, CX-01) is a page only while the content has pacts on (Codex.tsx codexPage). */
export type CodexSub = 'bestiary' | 'metin' | 'story' | 'pacts';
export const armoryCodexSub = signal<CodexSub>('bestiary');

/** Re-seeds the signals from the current run selection; the shell calls it every time the Armory opens. */
export function seedArmoryState(): void {
  if (!hasDeps()) return;
  const sel = deps().store.selection.value;
  armoryClass.value = sel.classId;
  armoryDoctrine.value = sel.doctrine;
  armoryEmpire.value = sel.empire;
  armorySex.value = sel.sex;
  armoryDropZone.value = null;
  armoryPicked.value = null;
  armoryCodexSub.value = 'bestiary';
}

/** Switches the viewed class; the doctrine falls back to 'a' and the sex to one the class offers. */
export function setArmoryClass(id: ClassId): void {
  armoryClass.value = id;
  armoryDoctrine.value = 'a';
  const sexes = hasDeps() ? indexOf().classes.get(id)?.sexes : undefined;
  if (sexes && sexes.length > 0 && !sexes.includes(armorySex.value)) armorySex.value = sexes[0] ?? 'm';
}
