import { describe, expect, it } from 'vitest';
import { fixtureContent } from './__fixtures__/content';
import { freshSave } from './__fixtures__/testkit';
import {
  collectionProgress,
  collectablePieces,
  duplicateShards,
  equipGear,
  equippedLook,
  equippedPieces,
  gearStats,
  grantGear,
  ownedPieces,
  plusOf,
  unequipGear,
} from './gear';
import type { SaveData } from './types';

const C = fixtureContent;

function grant(s: SaveData, cls: 'warrior' | 'ninja', id: string, auto = true): SaveData {
  const r = grantGear(s, C, cls, id, auto);
  if (!r.ok) throw new Error(r.reason);
  return r.save;
}

describe('gear collection', () => {
  it('grants a new piece, auto-equips an empty slot, and keeps classes separate', () => {
    const r = grantGear(freshSave(), C, 'warrior', 'yeonmu_weapon_warrior');
    expect(r).toMatchObject({ ok: true, isNew: true, shards: 0, autoEquipped: true });
    if (!r.ok) return;
    expect(r.save.classes.warrior.gear.weapon).toBe('yeonmu_weapon_warrior');
    expect(r.save.classes.warrior.collection).toEqual(['yeonmu_weapon_warrior']);
    expect(r.save.classes.ninja.collection).toEqual([]);
    expect(r.save.stats.gearFound).toBe(1);
  });

  it('does not auto-equip over an occupied slot or when disabled', () => {
    let s = grant(freshSave(), 'warrior', 'yeonmu_weapon_warrior');
    const r = grantGear(s, C, 'warrior', 'suryeon_weapon_warrior');
    expect(r).toMatchObject({ ok: true, isNew: true, autoEquipped: false });
    if (r.ok) expect(r.save.classes.warrior.gear.weapon).toBe('yeonmu_weapon_warrior');
    s = grant(freshSave(), 'warrior', 'yeonmu_armor_warrior', false);
    expect(s.classes.warrior.gear.armor).toBeUndefined();
  });

  it('converts a duplicate into shards by tier', () => {
    const s = grant(freshSave(), 'warrior', 'seori_shoes');
    const r = grantGear(s, C, 'warrior', 'seori_shoes');
    expect(r).toMatchObject({ ok: true, isNew: false, autoEquipped: false });
    if (!r.ok) return;
    const def = C.gear.find((g) => g.id === 'seori_shoes');
    expect(def).toBeDefined();
    if (def) expect(r.shards).toBe(duplicateShards(def));
    expect(r.save.bank.shards).toBe(r.shards);
    expect(r.save.classes.warrior.collection).toHaveLength(1);
    expect(duplicateShards({ ...(def as NonNullable<typeof def>), tier: 4 })).toBeGreaterThan(duplicateShards({ ...(def as NonNullable<typeof def>), tier: 1 }));
  });

  it('rejects class mismatch and unknown ids', () => {
    expect(grantGear(freshSave(), C, 'warrior', 'yeonmu_weapon_ninja')).toEqual({ ok: false, reason: 'classMismatch' });
    expect(grantGear(freshSave(), C, 'warrior', 'nope')).toEqual({ ok: false, reason: 'unknownGear' });
  });

  it('shared jewelry is collectable by every class', () => {
    for (const cls of ['warrior', 'ninja'] as const) expect(grantGear(freshSave(), C, cls, 'yeonmu_bracelet').ok).toBe(true);
    expect(collectablePieces(C, 'warrior')).toHaveLength(4 * (4 + 4)); // 4 zones × 8 slots
    expect(collectionProgress(grant(freshSave(), 'warrior', 'yeonmu_bracelet'), C, 'warrior')).toEqual({ owned: 1, total: 32 });
  });
});

describe('equip / unequip', () => {
  it('equips owned pieces only, swaps within a slot, reports the replaced id', () => {
    let s = grant(freshSave(), 'warrior', 'yeonmu_weapon_warrior');
    s = grant(s, 'warrior', 'suryeon_weapon_warrior');
    expect(equipGear(s, C, 'warrior', 'seori_weapon_warrior')).toEqual({ ok: false, reason: 'notOwned' });
    const r = equipGear(s, C, 'warrior', 'suryeon_weapon_warrior');
    expect(r).toMatchObject({ ok: true, slot: 'weapon', replaced: 'yeonmu_weapon_warrior' });
    if (r.ok) expect(r.save.classes.warrior.gear.weapon).toBe('suryeon_weapon_warrior');
  });

  it('enforces the class restriction even if an id was injected into the collection', () => {
    const s = freshSave();
    s.classes.warrior.collection.push('yeonmu_weapon_ninja');
    expect(equipGear(s, C, 'warrior', 'yeonmu_weapon_ninja')).toEqual({ ok: false, reason: 'classMismatch' });
  });

  it('unequips a slot but keeps the piece (and its +N) in the collection', () => {
    const s = grant(freshSave(), 'warrior', 'yeonmu_armor_warrior');
    s.classes.warrior.plus.yeonmu_armor_warrior = 4;
    const r = unequipGear(s, 'warrior', 'armor');
    expect(r).toMatchObject({ ok: true, removed: 'yeonmu_armor_warrior' });
    if (!r.ok) return;
    expect(r.save.classes.warrior.gear.armor).toBeUndefined();
    expect(plusOf(r.save.classes.warrior, 'yeonmu_armor_warrior')).toBe(4);
    expect(unequipGear(r.save, 'warrior', 'armor')).toEqual({ ok: false, reason: 'slotEmpty' });
    const back = equipGear(r.save, C, 'warrior', 'yeonmu_armor_warrior');
    expect(back).toMatchObject({ ok: true, slot: 'armor' });
  });

  it('lists owned pieces in slot → tier order with plus + equipped flags', () => {
    let s = grant(freshSave(), 'warrior', 'suryeon_weapon_warrior');
    s = grant(s, 'warrior', 'yeonmu_weapon_warrior', false);
    s = grant(s, 'warrior', 'yeonmu_armor_warrior');
    s.classes.warrior.plus.yeonmu_weapon_warrior = 2;
    const list = ownedPieces(s, C, 'warrior');
    expect(list.map((p) => p.def.id)).toEqual(['yeonmu_weapon_warrior', 'suryeon_weapon_warrior', 'yeonmu_armor_warrior']);
    expect(list.map((p) => p.equipped)).toEqual([false, true, true]);
    expect(list[0]?.plus).toBe(2);
  });

  it('equippedPieces skips tampered entries; look exposes model ids', () => {
    let s = grant(freshSave(), 'warrior', 'yeonmu_weapon_warrior');
    s = grant(s, 'warrior', 'yeonmu_bracelet');
    s.classes.warrior.gear.shield = 'yeonmu_weapon_ninja'; // wrong slot + class
    s.classes.warrior.gear.helmet = 'not_owned_helmet';
    expect(equippedPieces(s, C, 'warrior').map((p) => p.def.id).sort()).toEqual(['yeonmu_bracelet', 'yeonmu_weapon_warrior']);
    expect(equippedLook(s, C, 'warrior')).toEqual({ weapon: 'yeonmu_weapon_model' });
  });
});

describe('gearStats', () => {
  it('base + perPlus × plus, clamped to +9', () => {
    const def = C.gear.find((g) => g.id === 'yeonmu_armor_warrior');
    if (!def) throw new Error('fixture');
    expect(gearStats(def, 0)).toEqual({ armor: 6, maxHp: 20 });
    const p5 = gearStats(def, 5);
    expect(p5.armor).toBeCloseTo(6 + 1.5 * 5);
    expect(p5.maxHp).toBeCloseTo(20 + 6 * 5);
    expect(gearStats(def, 99).armor).toBeCloseTo(6 + 1.5 * 9);
    expect(def.stats).toEqual({ armor: 6, maxHp: 20 }); // definition untouched
  });
});
