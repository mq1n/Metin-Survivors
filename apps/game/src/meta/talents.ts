// Talents (PLAN §3.8): class XP -> talent points (40 per class, spread over its two doctrine trees; every zone cleared
// on Hard raises that cap by 2 up to 48, MT-02), 5 rows per tree, a row unlocks once 5 points per row above it are
// spent IN THAT TREE, milestones at 10/20/30 points spent in the tree, free respec. All operations are pure: they
// return a new SaveData.
//
// The cap is DERIVED from `save.stats.zones` (no save field, no SAVE_VERSION change): `talentCap(save)`. The point
// functions take it as an optional last argument that defaults to the base 40, so a caller that has not been taught
// about the cap (the run-end bar, a badge) behaves exactly as before; callers that hold the whole save pass
// `talentCap(save)`. XP is never clamped: the XP that piles up above the cap is paid the moment a Hard clear lifts it.

import type { ClassId, DoctrineId, DoctrineKey, TalentNode, TalentTree } from '../data/schema';
import { doctrineId, indexContent, type TreeIndex } from './content';
import type { ClassSave, MetaContent, SaveData } from './types';
import { isHardUnlocked } from './unlocks';

/** The base cap: what every profile has before its first Hard clear (and the only cap before MT-02). */
export const MAX_TALENT_POINTS = 40;
/** Points a zone cleared on Hard adds to the cap. */
export const TALENT_CAP_PER_HARD_ZONE = 2;
/** The cap with every zone cleared on Hard (4 zones x 2). */
export const MAX_TALENT_CAP = 48;
/** points that must be spent in the rows above row-rank r: ROW_GATE × r */
export const ROW_GATE = 5;
export const MILESTONE_POINTS = [10, 20, 30] as const;

/** XP needed for the n-th talent point (1-based): a gentle quadratic, ~70 000 XP in total for the first 40 (~110 000 for 48). */
export function talentPointCost(n: number): number {
  const k = n - 1;
  return Math.round(250 + 35 * k + 1.6 * k * k);
}

/** CUMULATIVE_XP[p] = total XP at which the p-th point is earned (index 0 = 0); runs to the maximum cap (48). */
export const CUMULATIVE_XP: readonly number[] = (() => {
  const out = [0];
  for (let n = 1; n <= MAX_TALENT_CAP; n++) out.push((out[n - 1] as number) + talentPointCost(n));
  return out;
})();

/** A cap argument made safe: an integer in 0..48; anything that is not a finite number is the base cap. */
function sane(cap: number): number {
  return Number.isFinite(cap) ? Math.min(MAX_TALENT_CAP, Math.max(0, Math.floor(cap))) : MAX_TALENT_POINTS;
}

/** The talent cap of a profile: 40 + 2 per zone cleared on Hard, at most 48 (derived from the stats, never stored). */
export function talentCap(save: Pick<SaveData, 'stats'>): number {
  let zones = 0;
  const rec = save.stats?.zones;
  if (rec) for (const z of Object.values(rec)) if ((z?.hard?.clears ?? 0) > 0) zones++;
  return Math.min(MAX_TALENT_CAP, MAX_TALENT_POINTS + TALENT_CAP_PER_HARD_ZONE * zones);
}

/** XP at which `points` points are earned; `points` is clamped to `cap` (default: the base 40). */
export function xpForPoints(points: number, cap: number = MAX_TALENT_POINTS): number {
  const p = Math.max(0, Math.min(sane(cap), Math.floor(points)));
  return CUMULATIVE_XP[p] as number;
}

/** Points `xp` pays under `cap` (default: the base 40); the XP above the cap stays in the save, it is not lost. */
export function pointsForXp(xp: number, cap: number = MAX_TALENT_POINTS): number {
  if (!(xp > 0)) return 0;
  const max = sane(cap);
  let p = 0;
  while (p < max && xp >= (CUMULATIVE_XP[p + 1] as number)) p++;
  return p;
}

export interface TalentProgress {
  points: number;
  xp: number;
  /** XP at which the current point was earned */
  floor: number;
  /** XP at which the next point is earned; null at the cap */
  next: number | null;
  /** XP into the current point */
  into: number;
  /** 0..1 progress to the next point (1 at the cap) */
  fraction: number;
}

export function talentProgress(xp: number, cap: number = MAX_TALENT_POINTS): TalentProgress {
  const safe = xp > 0 ? xp : 0;
  const points = pointsForXp(safe, cap);
  const floor = CUMULATIVE_XP[points] as number;
  if (points >= sane(cap)) return { points, xp: safe, floor, next: null, into: safe - floor, fraction: 1 };
  const next = CUMULATIVE_XP[points + 1] as number;
  return { points, xp: safe, floor, next, into: safe - floor, fraction: (safe - floor) / (next - floor) };
}

// ---------------------------------------------------------------------------
// Point accounting

export type TalentPoints = Record<string, number>;

export function treePointsOf(cs: ClassSave, doctrine: DoctrineId): TalentPoints {
  return cs.talents[doctrine] ?? {};
}

export function sumPoints(points: TalentPoints): number {
  let s = 0;
  for (const v of Object.values(points)) s += v;
  return s;
}

/** Points spent across every doctrine record of the class. */
export function spentTotal(cs: ClassSave): number {
  let s = 0;
  for (const rec of Object.values(cs.talents)) if (rec) s += sumPoints(rec);
  return s;
}

export function earnedPoints(cs: ClassSave, cap: number = MAX_TALENT_POINTS): number {
  return pointsForXp(cs.xp, cap);
}

export function availablePoints(cs: ClassSave, cap: number = MAX_TALENT_POINTS): number {
  return Math.max(0, earnedPoints(cs, cap) - spentTotal(cs));
}

// ---------------------------------------------------------------------------
// The cap, for the screens: where the profile stands and what raises it next

/**
 * The zone whose Hard clear raises the cap next, or null at the maximum / when every zone of the content has been cleared
 * on Hard. A zone whose Hard is already open comes first; otherwise the first zone (by order) without a Hard clear.
 */
export function capNextZone(save: SaveData, content: MetaContent): string | null {
  if (talentCap(save) >= MAX_TALENT_CAP) return null;
  const open = indexContent(content).zonesOrdered.filter((z) => (save.stats.zones[z.id]?.hard?.clears ?? 0) === 0);
  return (open.find((z) => isHardUnlocked(save, z.id)) ?? open[0])?.id ?? null;
}

export interface TalentCapView {
  /** the profile's cap now */
  cap: number;
  /** the cap before any Hard clear (40) */
  base: number;
  /** the cap with every zone cleared on Hard (48) */
  max: number;
  /** points a zone cleared on Hard adds (2) */
  perZone: number;
  /** zones counted so far: (cap - base) / perZone */
  hardZones: number;
  /** the zone to clear on Hard for the next +2, null at the maximum */
  nextZone: string | null;
  /** zones of the content already cleared on Hard, in zone order */
  zones: string[];
}

export function talentCapView(save: SaveData, content: MetaContent): TalentCapView {
  const cap = talentCap(save);
  const zones = indexContent(content)
    .zonesOrdered.filter((z) => (save.stats.zones[z.id]?.hard?.clears ?? 0) > 0)
    .map((z) => z.id);
  return {
    cap,
    base: MAX_TALENT_POINTS,
    max: MAX_TALENT_CAP,
    perZone: TALENT_CAP_PER_HARD_ZONE,
    hardZones: (cap - MAX_TALENT_POINTS) / TALENT_CAP_PER_HARD_ZONE,
    nextZone: capNextZone(save, content),
    zones,
  };
}

/** Points spent in rows with rank strictly below `rank`. */
function spentAbove(idx: TreeIndex, points: TalentPoints, rank: number): number {
  let s = 0;
  for (let r = 0; r < rank; r++) for (const n of idx.byRank[r] ?? []) s += points[n.id] ?? 0;
  return s;
}

export type NodeLock = 'row' | 'requires';

/** Why a node cannot hold points right now (ignores the point budget and its own max). */
export function nodeLock(idx: TreeIndex, points: TalentPoints, node: TalentNode): NodeLock | null {
  const rank = idx.rowRank.get(node.row) ?? 0;
  if (spentAbove(idx, points, rank) < ROW_GATE * rank) return 'row';
  if (node.requires !== undefined && (points[node.requires] ?? 0) < 1) return 'requires';
  return null;
}

export interface TreeViolation {
  nodeId: string;
  reason: 'unknownNode' | 'overMax' | NodeLock;
}

/** First rule broken by `points`, or null when the allocation is legal. */
export function treeViolation(idx: TreeIndex, points: TalentPoints): TreeViolation | null {
  for (const [id, p] of Object.entries(points)) {
    if (!(p > 0)) continue;
    const node = idx.nodes.get(id);
    if (!node) return { nodeId: id, reason: 'unknownNode' };
    if (p > node.max) return { nodeId: id, reason: 'overMax' };
  }
  for (const rank of idx.byRank) {
    for (const node of rank) {
      if ((points[node.id] ?? 0) <= 0) continue;
      const lock = nodeLock(idx, points, node);
      if (lock) return { nodeId: node.id, reason: lock };
    }
  }
  return null;
}

/** Milestones (10/20/30) reached with `spent` points in the tree. */
export function milestonesReached(tree: TalentTree, spent: number): TalentTree['milestones'] {
  return tree.milestones.filter((m) => spent >= m.at);
}

// ---------------------------------------------------------------------------
// Commands

export type TalentFailure =
  | 'unknownClass'
  | 'unknownTree'
  | 'unknownNode'
  | 'noPoints'
  | 'maxed'
  | 'rowLocked'
  | 'requiresLocked'
  | 'nothingToRefund'
  | 'dependency';

export type TalentResult =
  | { ok: true; save: SaveData; points: number }
  | { ok: false; reason: TalentFailure; blocker?: string };

function treeFor(content: MetaContent, classId: ClassId, key: DoctrineKey): { id: DoctrineId; idx: TreeIndex } | null {
  const id = doctrineId(classId, key);
  const idx = indexContent(content).trees.get(id);
  return idx ? { id, idx } : null;
}

export function allocateTalent(
  save: SaveData,
  content: MetaContent,
  classId: ClassId,
  key: DoctrineKey,
  nodeId: string,
): TalentResult {
  const cs = save.classes[classId];
  if (!cs) return { ok: false, reason: 'unknownClass' };
  const tree = treeFor(content, classId, key);
  if (!tree) return { ok: false, reason: 'unknownTree' };
  const node = tree.idx.nodes.get(nodeId);
  if (!node) return { ok: false, reason: 'unknownNode' };
  const points = treePointsOf(cs, tree.id);
  const have = points[nodeId] ?? 0;
  if (have >= node.max) return { ok: false, reason: 'maxed' };
  if (availablePoints(cs, talentCap(save)) < 1) return { ok: false, reason: 'noPoints' };
  const lock = nodeLock(tree.idx, points, node);
  if (lock === 'row') return { ok: false, reason: 'rowLocked' };
  if (lock === 'requires') return { ok: false, reason: 'requiresLocked', blocker: node.requires };
  const next = structuredClone(save);
  const target = next.classes[classId];
  const rec = (target.talents[tree.id] ??= {});
  rec[nodeId] = have + 1;
  return { ok: true, save: next, points: have + 1 };
}

export function refundTalent(
  save: SaveData,
  content: MetaContent,
  classId: ClassId,
  key: DoctrineKey,
  nodeId: string,
): TalentResult {
  const cs = save.classes[classId];
  if (!cs) return { ok: false, reason: 'unknownClass' };
  const tree = treeFor(content, classId, key);
  if (!tree) return { ok: false, reason: 'unknownTree' };
  if (!tree.idx.nodes.has(nodeId)) return { ok: false, reason: 'unknownNode' };
  const points = treePointsOf(cs, tree.id);
  const have = points[nodeId] ?? 0;
  if (have <= 0) return { ok: false, reason: 'nothingToRefund' };
  const after: TalentPoints = { ...points, [nodeId]: have - 1 };
  const violation = treeViolation(tree.idx, after);
  if (violation) return { ok: false, reason: 'dependency', blocker: violation.nodeId };
  const next = structuredClone(save);
  const rec = (next.classes[classId].talents[tree.id] ??= {});
  if (have - 1 <= 0) delete rec[nodeId];
  else rec[nodeId] = have - 1;
  return { ok: true, save: next, points: have - 1 };
}

/** Free respec: clears one doctrine tree (`key`) or, without a key, every tree of the class. */
export function respecTalents(save: SaveData, classId: ClassId, key?: DoctrineKey): SaveData {
  const next = structuredClone(save);
  const cs = next.classes[classId];
  if (key) delete cs.talents[doctrineId(classId, key)];
  else cs.talents = {};
  return next;
}

// ---------------------------------------------------------------------------
// Sanitising (import / migration / cloud adoption): clamp to the rules instead of rejecting the save.

/**
 * Returns the largest legal subset of `raw` within `budget` points. Deterministic: nodes are filled in row-rank,
 * column, id order and a node only receives points once its gates are met (passes repeat until stable so a
 * `requires` pointing at a later node still resolves).
 */
export function sanitizeTreePoints(idx: TreeIndex, raw: unknown, budget: number): { points: TalentPoints; used: number } {
  const wanted: TalentPoints = {};
  if (typeof raw === 'object' && raw !== null) {
    for (const [id, v] of Object.entries(raw)) {
      const node = idx.nodes.get(id);
      if (!node || typeof v !== 'number' || !Number.isFinite(v)) continue;
      const want = Math.min(node.max, Math.floor(v));
      if (want > 0) wanted[id] = want;
    }
  }
  const out: TalentPoints = {};
  let left = Math.max(0, Math.floor(budget));
  let changed = true;
  while (changed && left > 0) {
    changed = false;
    for (const rank of idx.byRank) {
      for (const node of rank) {
        const target = wanted[node.id] ?? 0;
        while ((out[node.id] ?? 0) < target && left > 0 && nodeLock(idx, out, node) === null) {
          out[node.id] = (out[node.id] ?? 0) + 1;
          left--;
          changed = true;
        }
      }
    }
  }
  return { points: out, used: Math.max(0, Math.floor(budget)) - left };
}

// ---------------------------------------------------------------------------
// UI view model

export type NodeState = 'maxed' | 'available' | 'rowLocked' | 'requiresLocked' | 'noPoints';

export interface NodeView {
  node: TalentNode;
  points: number;
  state: NodeState;
  canAllocate: boolean;
  canRefund: boolean;
}

export interface RowView {
  rank: number;
  row: number;
  /** points required above this row */
  needed: number;
  /** points spent above this row */
  have: number;
  unlocked: boolean;
}

export interface MilestoneView {
  at: 10 | 20 | 30;
  skill?: string;
  effect?: TalentTree['milestones'][number]['effect'];
  reached: boolean;
}

export interface TreeView {
  tree: TalentTree;
  spent: number;
  nodes: NodeView[];
  rows: RowView[];
  milestones: MilestoneView[];
}

export function treeView(content: MetaContent, cs: ClassSave, classId: ClassId, key: DoctrineKey, cap: number = MAX_TALENT_POINTS): TreeView | null {
  const t = treeFor(content, classId, key);
  if (!t) return null;
  const points = treePointsOf(cs, t.id);
  const avail = availablePoints(cs, cap);
  const nodes: NodeView[] = [];
  for (const rank of t.idx.byRank) {
    for (const node of rank) {
      const have = points[node.id] ?? 0;
      const lock = nodeLock(t.idx, points, node);
      let state: NodeState;
      if (have >= node.max) state = 'maxed';
      else if (lock === 'row') state = 'rowLocked';
      else if (lock === 'requires') state = 'requiresLocked';
      else if (avail < 1) state = 'noPoints';
      else state = 'available';
      const canRefund = have > 0 && treeViolation(t.idx, { ...points, [node.id]: have - 1 }) === null;
      nodes.push({ node, points: have, state, canAllocate: state === 'available', canRefund });
    }
  }
  const spent = sumPoints(points);
  const rows: RowView[] = t.idx.byRank.map((group, rank) => {
    const have = spentAbove(t.idx, points, rank);
    return { rank, row: group[0]?.row ?? rank, needed: ROW_GATE * rank, have, unlocked: have >= ROW_GATE * rank };
  });
  const milestones: MilestoneView[] = t.idx.tree.milestones.map((m) => ({
    at: m.at,
    ...(m.skill !== undefined ? { skill: m.skill } : {}),
    ...(m.effect !== undefined ? { effect: m.effect } : {}),
    reached: spent >= m.at,
  }));
  return { tree: t.idx.tree, spent, nodes, rows, milestones };
}
