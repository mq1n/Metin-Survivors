// Contract check between the meta layer and the content it reads. `validateMetaContent` returns human-readable
// problems (empty = OK). Run it against the real content in the content-loader test so a data change that would
// break talents, the blacksmith, drops, unlock chain or codex fails the suite instead of the player's profile.

import { EDICT_MAX, GEAR_SLOTS, RARITIES } from '../data/schema';
import { isUpgradeStat } from './bonuses';
import { indexContent } from './content';
import { MAX_PLUS } from './gear';
import { MILESTONE_POINTS, ROW_GATE } from './talents';
import { CLASS_IDS, type MetaContent } from './types';
import { parseCodexCondition, zoneRequirement } from './unlocks';

const KNOWN_EFFECTS = new Set(['startLevel', 'rerolls', 'banishes', 'skips']);
const KNOWN_EFFECT_PREFIXES = ['skillMod:', 'extraSkill:'];
const MIN_TREE_CAPACITY = 30;
const HARD_MUL_KEYS = ['awakenMul', 'eliteEveryMul', 'finalEnrageMul'] as const;

export function isKnownEffectKind(kind: string): boolean {
  return KNOWN_EFFECTS.has(kind) || KNOWN_EFFECT_PREFIXES.some((p) => kind.startsWith(p) && kind.length > p.length);
}

const isPositive = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && v > 0;
const isCount = (v: unknown, max: number): boolean => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;

/**
 * The roguelite data contract of stage A0 as the meta layer sees it (zones, empires, balance; the loader validates the
 * same fields with more detail on the full ContentDB). Every field is optional, an absent one means "off = today".
 */
function rogueliteProblems(content: MetaContent): string[] {
  const out: string[] = [];
  const mul = (where: string, v: unknown): void => {
    if (v !== undefined && !isPositive(v)) out.push(`${where} must be a finite number > 0`);
  };
  const { hard, overflow, chest } = content.balance;
  for (const k of HARD_MUL_KEYS) mul(`balance.hard.${k}`, hard[k]);
  for (const z of content.zones) {
    mul(`zone ${z.id}: xpMul`, z.xpMul);
    mul(`zone ${z.id}: final.hpMul`, z.final.hpMul);
    for (const k of HARD_MUL_KEYS) mul(`zone ${z.id}: hard.${k}`, z.hard?.[k]);
  }
  for (const e of content.empires) {
    for (const k of ['rerolls', 'banishes', 'skips'] as const) {
      const v = e.edict?.[k];
      if (v !== undefined && !isCount(v, EDICT_MAX)) out.push(`empire ${e.id}: edict.${k} must be an integer 0..${EDICT_MAX}`);
    }
  }
  if (overflow) {
    // shard cards pay into the bank at run end: one integer >= 0 per rarity
    const sr = overflow.shardsByRarity;
    if (sr !== undefined && (!Array.isArray(sr) || sr.length !== RARITIES.length || !sr.every((v) => isCount(v, 99)))) {
      out.push(`balance.overflow.shardsByRarity must be ${RARITIES.length} integers 0..99 (one per rarity)`);
    }
    if (overflow.skipRefund !== undefined && !isCount(overflow.skipRefund, 20)) out.push('balance.overflow.skipRefund must be an integer 0..20');
  }
  if (chest?.eliteDrop !== undefined && !(chest.eliteDrop >= 0 && chest.eliteDrop <= 1)) out.push('balance.chest.eliteDrop must be in [0, 1]');
  return out;
}

export function validateMetaContent(content: MetaContent): string[] {
  const problems: string[] = [];
  const idx = indexContent(content);
  const bossIds = new Set<string>();
  for (const z of content.zones) {
    for (const b of z.bosses) bossIds.add(b.boss);
    bossIds.add(z.final.boss);
  }

  // --- blacksmith
  const bs = content.balance.blacksmith;
  for (const [name, arr] of [['successRate', bs.successRate], ['yeopCost', bs.yeopCost], ['shardCost', bs.shardCost]] as const) {
    if (arr.length < MAX_PLUS) problems.push(`balance.blacksmith.${name} needs ${MAX_PLUS} entries (+0→+1 … +8→+9), has ${arr.length}`);
  }
  bs.successRate.slice(0, MAX_PLUS).forEach((r, i) => {
    if (!(r > 0 && r <= 1)) problems.push(`balance.blacksmith.successRate[${i}]=${r} must be in (0,1]`);
    if (i > 0 && r > (bs.successRate[i - 1] as number)) problems.push(`balance.blacksmith.successRate must not increase (index ${i})`);
  });
  for (const [name, arr] of [['yeopCost', bs.yeopCost], ['shardCost', bs.shardCost]] as const) {
    arr.slice(0, MAX_PLUS).forEach((v, i) => {
      if (!(v >= 0)) problems.push(`balance.blacksmith.${name}[${i}]=${v} must be ≥ 0`);
    });
  }
  if (!(content.balance.hard.reward > 0)) problems.push('balance.hard.reward must be > 0');
  if (!(content.balance.runLength > 0)) problems.push('balance.runLength must be > 0');
  problems.push(...rogueliteProblems(content));

  // --- zones
  const seenOrder = new Set<number>();
  for (const z of content.zones) {
    if (seenOrder.has(z.order)) problems.push(`zone ${z.id}: duplicate order ${z.order}`);
    seenOrder.add(z.order);
    if (z.unlock && !idx.zones.has(z.unlock.zone)) problems.push(`zone ${z.id}: unlock.zone ${z.unlock.zone} is unknown`);
  }
  const first = idx.zonesOrdered[0];
  if (first && zoneRequirement(content, first.id) !== null) problems.push(`zone ${first.id}: the first zone must not have a requirement`);
  for (const z of idx.zonesOrdered) {
    // follow the chain: it must reach the first zone without cycles
    const seen = new Set<string>();
    let cur: string | undefined = z.id;
    while (cur !== undefined) {
      if (seen.has(cur)) {
        problems.push(`zone ${z.id}: unlock chain has a cycle`);
        break;
      }
      seen.add(cur);
      cur = zoneRequirement(content, cur)?.zone;
    }
  }

  // --- talents
  for (const classId of CLASS_IDS) {
    if (!idx.classes.has(classId)) problems.push(`class ${classId} missing`);
    for (const key of ['a', 'b'] as const) {
      const id = `${classId}_${key}` as const;
      const tree = idx.trees.get(id);
      if (!tree) {
        problems.push(`talent tree ${id} missing`);
        continue;
      }
      if (tree.tree.classId !== classId) problems.push(`tree ${id}: classId is ${tree.tree.classId}`);
      if (tree.tree.nodes.length !== tree.nodes.size) problems.push(`tree ${id}: duplicate node ids`);
      if (tree.byRank.length !== 5) problems.push(`tree ${id}: needs 5 rows, has ${tree.byRank.length}`);
      let capacityAbove = 0;
      tree.byRank.forEach((rank, r) => {
        if (capacityAbove < ROW_GATE * r) problems.push(`tree ${id}: row ${r} can never unlock (capacity above ${capacityAbove} < ${ROW_GATE * r})`);
        for (const n of rank) {
          if (!(Number.isInteger(n.max) && n.max >= 1)) problems.push(`tree ${id}/${n.id}: max must be an integer ≥ 1`);
          capacityAbove += n.max;
          if (n.requires !== undefined) {
            const req = tree.nodes.get(n.requires);
            if (!req) problems.push(`tree ${id}/${n.id}: requires unknown node ${n.requires}`);
            else if ((tree.rowRank.get(req.row) ?? 0) >= r) problems.push(`tree ${id}/${n.id}: requires ${n.requires} which is not in an earlier row`);
          }
          if (n.effect && !isKnownEffectKind(n.effect.kind)) problems.push(`tree ${id}/${n.id}: effect kind '${n.effect.kind}' is not mapped by meta/bonuses.ts`);
          if (n.effect?.kind.startsWith('skillMod:')) {
            for (const [stat, v] of Object.entries(n.effect.params)) {
              if (!isUpgradeStat(stat)) problems.push(`tree ${id}/${n.id}: skillMod param '${stat}' is not an UpgradeStat`);
              else if (!Number.isFinite(v)) problems.push(`tree ${id}/${n.id}: skillMod param '${stat}' is not a number`);
            }
          } else if (n.effect && isKnownEffectKind(n.effect.kind) && !Number.isFinite(n.effect.params.value)) {
            problems.push(`tree ${id}/${n.id}: effect '${n.effect.kind}' needs a numeric params.value`);
          }
          if (!n.perPoint && !n.effect) problems.push(`tree ${id}/${n.id}: node has neither perPoint nor effect`);
        }
      });
      if (capacityAbove < MIN_TREE_CAPACITY) problems.push(`tree ${id}: capacity ${capacityAbove} < ${MIN_TREE_CAPACITY} (the 30-point milestone is unreachable)`);
      const at = tree.tree.milestones.map((m) => m.at).join(',');
      if (at !== MILESTONE_POINTS.join(',')) problems.push(`tree ${id}: milestones must be at ${MILESTONE_POINTS.join('/')}, got ${at}`);
    }
  }

  // --- gear
  const seenGear = new Set<string>();
  for (const g of content.gear) {
    if (seenGear.has(g.id)) problems.push(`gear ${g.id}: duplicate id`);
    seenGear.add(g.id);
    if (!GEAR_SLOTS.includes(g.slot)) problems.push(`gear ${g.id}: unknown slot ${g.slot}`);
    if (g.classes.length === 0) problems.push(`gear ${g.id}: no classes`);
    const zone = idx.zones.get(g.source.zone);
    if (!zone) problems.push(`gear ${g.id}: source.zone ${g.source.zone} is unknown`);
    if (g.source.boss !== undefined && !bossIds.has(g.source.boss)) problems.push(`gear ${g.id}: source.boss ${g.source.boss} is not a boss of any zone`);
    if (g.source.boss !== undefined && zone && !zone.bosses.some((b) => b.boss === g.source.boss) && zone.final.boss !== g.source.boss) {
      problems.push(`gear ${g.id}: source.boss ${g.source.boss} does not appear in zone ${zone.id}`);
    }
    if (!(g.source.chance > 0 && g.source.chance <= 1)) problems.push(`gear ${g.id}: source.chance must be in (0,1]`);
  }
  for (const classId of CLASS_IDS) {
    for (const slot of GEAR_SLOTS) {
      if (!content.gear.some((g) => g.slot === slot && g.classes.includes(classId))) problems.push(`class ${classId}: no gear can ever drop for slot ${slot}`);
    }
  }

  // --- empires + codex
  for (const id of ['saehwa', 'chowon', 'jihae'] as const) if (!idx.empires.has(id)) problems.push(`empire ${id} missing`);
  const seenCodex = new Set<string>();
  for (const e of content.story.codex) {
    if (seenCodex.has(e.id)) problems.push(`codex ${e.id}: duplicate id`);
    seenCodex.add(e.id);
    const c = parseCodexCondition(e.unlock);
    if (c.kind === 'unknown') problems.push(`codex ${e.id}: unlock '${e.unlock}' is not in the meta grammar`);
    else if (c.kind === 'enter' || c.kind === 'clear') {
      if (!idx.zones.has(c.zone)) problems.push(`codex ${e.id}: unknown zone ${c.zone}`);
    } else if (c.kind === 'boss' && !bossIds.has(c.boss)) problems.push(`codex ${e.id}: unknown boss ${c.boss}`);
  }
  return problems;
}
