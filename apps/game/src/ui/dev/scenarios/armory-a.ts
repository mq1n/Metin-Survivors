// Gallery scenarios: Armory character / collection / drop tables / codex (owner: B11 armory-a, which also owns the Armory
// shell). Includes a well-travelled profile (most gear collected, a few pieces refined).
import type { ClassId, ContentDB } from '../../../data/schema';
import { ownedPieces, type MetaService } from '../../../meta';
import { armoryClass, armoryCodexSub, armoryPicked } from '../../screens/armory/state';
import { armoryTab, openView } from '../../view';
import { mockRunResult } from '../mock';
import { armoryAt, type Scenario } from '../scenarioKit';

export const order = 50;

const enriched = new WeakSet<MetaService>();

/** Settles a string of won runs (every zone, every boss) so the class owns most of its gear, then refines a few pieces. */
export function enrichArmory(meta: MetaService, content: ContentDB, classId: ClassId, wins = 48): void {
  if (enriched.has(meta)) return;
  enriched.add(meta);
  const zones = content.zones;
  for (let i = 0; i < wins; i++) {
    const zone = zones[i % zones.length];
    if (!zone) continue;
    meta.settle(mockRunResult(content, { zone: zone.id, classId, victory: true, bossesKilled: zone.bosses.map((b) => b.boss) }), { submit: false });
  }
  const refine = ownedPieces(meta.save, content, classId).slice(0, 8);
  refine.forEach((p, i) => {
    for (let k = 0; k < 2 + (i % 4); k++) meta.upgradeGear(classId, p.def.id);
  });
}

export const scenarios: Scenario[] = [
  armoryAt('character'),
  armoryAt('collection'),
  armoryAt('drops'),
  armoryAt('codex'),
  {
    id: 'armory-rich',
    label: 'Armory · rich profile (character)',
    run: (g) => {
      enrichArmory(g.meta, g.content, g.classId);
      g.store.setScreen('menu');
      openView('armory', 'character');
      armoryTab.value = 'character';
      armoryClass.value = g.classId;
    },
  },
  {
    id: 'armory-collection-rich',
    label: 'Armory · rich profile (collection)',
    run: (g) => {
      enrichArmory(g.meta, g.content, g.classId);
      g.store.setScreen('menu');
      openView('armory', 'collection');
      armoryTab.value = 'collection';
    },
  },
  {
    id: 'armory-drops-rich',
    label: 'Armory · rich profile (drop tables)',
    run: (g) => {
      enrichArmory(g.meta, g.content, g.classId);
      g.store.setScreen('menu');
      openView('armory', 'drops');
      armoryTab.value = 'drops';
    },
  },
  {
    id: 'armory-picker',
    label: 'Armory · character, slot picker open (rich profile)',
    run: (g) => {
      enrichArmory(g.meta, g.content, g.classId);
      g.store.setScreen('menu');
      openView('armory', 'character');
      armoryTab.value = 'character';
      armoryClass.value = g.classId;
      // the shell re-seeds its state when it mounts: open the picker after that
      setTimeout(() => (armoryPicked.value = 'weapon'), 150);
    },
  },
  {
    id: 'armory-picker-helmet',
    label: 'Armory · character, helmet picker open',
    run: (g) => {
      g.store.setScreen('menu');
      openView('armory', 'character');
      armoryTab.value = 'character';
      setTimeout(() => (armoryPicked.value = 'helmet'), 150);
    },
  },
  {
    id: 'armory-codex-metin',
    label: 'Armory · codex, Metin stones page',
    run: (g) => {
      g.store.setScreen('menu');
      openView('armory', 'codex');
      armoryTab.value = 'codex';
      setTimeout(() => (armoryCodexSub.value = 'metin'), 150);
    },
  },
  {
    id: 'armory-codex-story',
    label: 'Armory · codex, Story page',
    run: (g) => {
      g.store.setScreen('menu');
      openView('armory', 'codex');
      armoryTab.value = 'codex';
      setTimeout(() => (armoryCodexSub.value = 'story'), 150);
    },
  },
];
