// Cached lookup tables over the content the meta layer reads. Content is immutable after load, so the index is
// memoised per content object identity (WeakMap) and every meta function can call `indexContent(content)` freely.

import type {
  ClassDef,
  ClassId,
  DoctrineId,
  DoctrineKey,
  EmpireDef,
  EmpireId,
  GearDef,
  TalentNode,
  TalentTree,
  ZoneDef,
} from '../data/schema';
import type { MetaContent } from './types';

export interface TreeIndex {
  tree: TalentTree;
  nodes: Map<string, TalentNode>;
  /** node.row -> row rank 0..n-1 (rows may be authored 0- or 1-based; gating always uses the rank) */
  rowRank: Map<number, number>;
  /** nodes grouped by row rank, each group sorted by col then id */
  byRank: TalentNode[][];
}

export interface ContentIndex {
  content: MetaContent;
  classes: Map<ClassId, ClassDef>;
  zones: Map<string, ZoneDef>;
  /** zones sorted by `order` (stable) */
  zonesOrdered: ZoneDef[];
  gear: Map<string, GearDef>;
  trees: Map<DoctrineId, TreeIndex>;
  empires: Map<EmpireId, EmpireDef>;
}

const cache = new WeakMap<MetaContent, ContentIndex>();

export function doctrineId(classId: ClassId, key: DoctrineKey): DoctrineId {
  return `${classId}_${key}`;
}

export function doctrineIdsOf(classId: ClassId): [DoctrineId, DoctrineId] {
  return [doctrineId(classId, 'a'), doctrineId(classId, 'b')];
}

/** Doctrine key of a doctrine id (`warrior_a` -> `a`). */
export function doctrineKeyOf(id: DoctrineId): DoctrineKey {
  return id.endsWith('_b') ? 'b' : 'a';
}

function buildTree(tree: TalentTree): TreeIndex {
  const nodes = new Map<string, TalentNode>();
  for (const n of tree.nodes) nodes.set(n.id, n);
  const rows = [...new Set(tree.nodes.map((n) => n.row))].sort((a, b) => a - b);
  const rowRank = new Map<number, number>();
  rows.forEach((r, i) => rowRank.set(r, i));
  const byRank: TalentNode[][] = rows.map(() => []);
  for (const n of tree.nodes) byRank[rowRank.get(n.row) as number]?.push(n);
  for (const g of byRank) g.sort((a, b) => a.col - b.col || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { tree, nodes, rowRank, byRank };
}

export function indexContent(content: MetaContent): ContentIndex {
  const hit = cache.get(content);
  if (hit) return hit;
  const idx: ContentIndex = {
    content,
    classes: new Map(content.classes.map((c) => [c.id, c])),
    zones: new Map(content.zones.map((z) => [z.id, z])),
    zonesOrdered: [...content.zones].sort((a, b) => a.order - b.order),
    gear: new Map(content.gear.map((g) => [g.id, g])),
    trees: new Map(content.talents.map((t) => [t.id, buildTree(t)])),
    empires: new Map(content.empires.map((e) => [e.id, e])),
  };
  cache.set(content, idx);
  return idx;
}
