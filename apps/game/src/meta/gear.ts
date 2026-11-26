// Gear (PLAN §3.8): 8 slots, per-class collection, equip/unequip with class restriction, +N blacksmith level per
// owned piece. Pure functions; each mutator returns a new SaveData.

import type { ClassId, GearDef, GearSlot, StatMods } from '../data/schema';
import { GEAR_SLOTS } from '../data/schema';
import { indexContent } from './content';
import { addStatMods } from './statMods';
import type { ClassSave, Fail, MetaContent, SaveData } from './types';
import { fail } from './types';

export const MAX_PLUS = 9;

export function clampPlus(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(MAX_PLUS, Math.floor(n))) : 0;
}

export function plusOf(cs: ClassSave, gearId: string): number {
  return clampPlus(cs.plus[gearId] ?? 0);
}

export function usableBy(def: GearDef, classId: ClassId): boolean {
  return def.classes.includes(classId);
}

/** Final stats of one piece at a blacksmith level: base + perPlus × plus. */
export function gearStats(def: GearDef, plus: number): StatMods {
  const out = addStatMods({}, def.stats);
  addStatMods(out, def.perPlus, clampPlus(plus));
  return out;
}

/** Shards a duplicate drop converts into (scales with tier). */
export function duplicateShards(def: GearDef): number {
  return 4 + 3 * Math.max(0, def.tier);
}

export interface OwnedPiece {
  def: GearDef;
  plus: number;
  equipped: boolean;
}

/** Owned pieces whose definition exists, ordered slot → tier → id (stable UI order). */
export function ownedPieces(save: SaveData, content: MetaContent, classId: ClassId): OwnedPiece[] {
  const idx = indexContent(content);
  const cs = save.classes[classId];
  const out: OwnedPiece[] = [];
  for (const id of cs.collection) {
    const def = idx.gear.get(id);
    if (!def) continue;
    out.push({ def, plus: plusOf(cs, id), equipped: cs.gear[def.slot] === id });
  }
  const slotOrder = (s: GearSlot): number => GEAR_SLOTS.indexOf(s);
  out.sort((a, b) => slotOrder(a.def.slot) - slotOrder(b.def.slot) || a.def.tier - b.def.tier || (a.def.id < b.def.id ? -1 : 1));
  return out;
}

/** Equipped pieces that are valid for the class (unknown / mismatching ids are skipped). */
export function equippedPieces(save: SaveData, content: MetaContent, classId: ClassId): OwnedPiece[] {
  const idx = indexContent(content);
  const cs = save.classes[classId];
  const out: OwnedPiece[] = [];
  for (const slot of GEAR_SLOTS) {
    const id = cs.gear[slot];
    if (id === undefined) continue;
    const def = idx.gear.get(id);
    if (!def || def.slot !== slot || !usableBy(def, classId) || !cs.collection.includes(id)) continue;
    out.push({ def, plus: plusOf(cs, id), equipped: true });
  }
  return out;
}

/** Model ids of equipped pieces that change the hero's look (weapon / armor tier models etc.). */
export function equippedLook(save: SaveData, content: MetaContent, classId: ClassId): Partial<Record<GearSlot, string>> {
  const look: Partial<Record<GearSlot, string>> = {};
  for (const p of equippedPieces(save, content, classId)) if (p.def.model) look[p.def.slot] = p.def.model;
  return look;
}

/** All pieces a class can ever collect (for "x / y" collection counters and the Drop Tables screen). */
export function collectablePieces(content: MetaContent, classId: ClassId): GearDef[] {
  return content.gear.filter((g) => usableBy(g, classId));
}

export type GearFailure = 'unknownClass' | 'unknownGear' | 'notOwned' | 'classMismatch' | 'slotEmpty';

export type EquipResult = { ok: true; save: SaveData; slot: GearSlot; replaced?: string } | Fail<GearFailure>;

export function equipGear(save: SaveData, content: MetaContent, classId: ClassId, gearId: string): EquipResult {
  const cs = save.classes[classId];
  if (!cs) return fail('unknownClass');
  const def = indexContent(content).gear.get(gearId);
  if (!def) return fail('unknownGear');
  if (!usableBy(def, classId)) return fail('classMismatch');
  if (!cs.collection.includes(gearId)) return fail('notOwned');
  const next = structuredClone(save);
  const target = next.classes[classId];
  const replaced = target.gear[def.slot];
  target.gear[def.slot] = gearId;
  return { ok: true, save: next, slot: def.slot, ...(replaced !== undefined && replaced !== gearId ? { replaced } : {}) };
}

export type UnequipResult = { ok: true; save: SaveData; removed: string } | Fail<GearFailure>;

export function unequipGear(save: SaveData, classId: ClassId, slot: GearSlot): UnequipResult {
  const cs = save.classes[classId];
  if (!cs) return fail('unknownClass');
  const removed = cs.gear[slot];
  if (removed === undefined) return fail('slotEmpty');
  const next = structuredClone(save);
  delete next.classes[classId].gear[slot];
  return { ok: true, save: next, removed };
}

export interface GrantResult {
  ok: true;
  save: SaveData;
  isNew: boolean;
  /** shards banked for a duplicate (0 for new pieces) */
  shards: number;
  autoEquipped: boolean;
}

/**
 * Adds a piece to the class collection. A duplicate converts to shards (banked immediately). A new piece is
 * equipped automatically when its slot is empty and `autoEquip` is set (first drop of a slot should be usable).
 */
export function grantGear(
  save: SaveData,
  content: MetaContent,
  classId: ClassId,
  gearId: string,
  autoEquip = true,
): GrantResult | Fail<'unknownClass' | 'unknownGear' | 'classMismatch'> {
  const cs = save.classes[classId];
  if (!cs) return fail('unknownClass');
  const def = indexContent(content).gear.get(gearId);
  if (!def) return fail('unknownGear');
  if (!usableBy(def, classId)) return fail('classMismatch');
  const next = structuredClone(save);
  const target = next.classes[classId];
  if (target.collection.includes(gearId)) {
    const shards = duplicateShards(def);
    next.bank.shards += shards;
    next.stats.shardsEarned += shards;
    return { ok: true, save: next, isNew: false, shards, autoEquipped: false };
  }
  target.collection.push(gearId);
  next.stats.gearFound += 1;
  let autoEquipped = false;
  if (autoEquip && target.gear[def.slot] === undefined) {
    target.gear[def.slot] = gearId;
    autoEquipped = true;
  }
  return { ok: true, save: next, isNew: true, shards: 0, autoEquipped };
}

export function collectionProgress(save: SaveData, content: MetaContent, classId: ClassId): { owned: number; total: number } {
  const idx = indexContent(content);
  const total = collectablePieces(content, classId).length;
  let owned = 0;
  for (const id of save.classes[classId].collection) {
    const def = idx.gear.get(id);
    if (def && usableBy(def, classId)) owned++;
  }
  return { owned, total };
}
