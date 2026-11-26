// The meta layer against the REAL shipped content (data/content/*.json), not fixtures: guards the contract between
// CONTENT and META (talent shapes, effect kinds, gear sources, codex grammar, blacksmith table, unlock chain).

import { describe, expect, it } from 'vitest';
import { content } from '../data/loader';
import { BEHAVIORS } from '../sim/skills';
import { GEAR_SLOTS, resolveEdict, resolveHardMuls, resolveOverflow, resolvePacts, resolveZoneMuls } from '../data/schema';
import { computeMetaBonusDetail } from './bonuses';
import { indexContent } from './content';
import { validateMetaContent } from './contentCheck';
import { dropTableFor, rollGearDrops } from './drops';
import { collectablePieces } from './gear';
import { seededRng } from './rng';
import { newProfile } from './save';
import { settleRun, talentXpFor } from './settle';
import { MAX_TALENT_POINTS, allocateTalent, availablePoints, treeView, xpForPoints } from './talents';
import { CLASS_IDS, type SaveData } from './types';
import { codexEntries, zoneStatuses } from './unlocks';
import { makeRun } from './__fixtures__/testkit';

const NOW = 1_700_000_000_000;
const fresh = (): SaveData => newProfile(content, { now: NOW, rng: seededRng(1), name: 'Real' });

describe('real content ↔ meta contract', () => {
  it('has no meta-level content problems', () => {
    expect(validateMetaContent(content)).toEqual([]);
  });

  it('ships the roguelite data contract switched off (except the awakening pacts, the overflow cards, the boss milestones and the edicts), so the meta numbers are today\'s', () => {
    // A0-DATA: no zone multipliers, no extra hard multipliers; OF-01 ships the pacts ON, DA-01 the edicts, OF-03 the overflow cards, OF-04 the boss milestones (the chest block is that flag only)
    // (run cards only: a shards card banks through the same RunResult.shards the settlement already pays, nothing in the meta numbers changes)
    expect(content.balance.overflow).toEqual({ shards: true, boon: true, shardsByRarity: [1, 1, 2, 3, 4], skipRefund: 1 });
    expect(content.balance.chest).toEqual({ bossMilestone: true });
    expect(resolveOverflow(content.balance.overflow)).toEqual({ shards: true, boon: true, shardsByRarity: [1, 1, 2, 3, 4], boonDamage: 0.03, boonHp: 0.02, skipRefund: 1 });
    expect(resolvePacts(content.balance.pacts).rank).toBe(4);
    expect(resolvePacts(content.balance.pacts).readyWeight).toBe(1);
    for (const z of content.zones) {
      // PC-03: zones 2-4 carry a gem-xp multiplier; PC-04: every zone carries a final-boss HP multiplier below 1 (both are run numbers: the meta settlement does not read them)
      expect(resolveZoneMuls(z), z.id).toEqual({ xp: z.id === 'yeonmu' ? 1 : z.xpMul, finalHp: z.final.hpMul });
      expect(z.final.hpMul, z.id).toBeLessThan(1);
      expect(resolveHardMuls(content.balance, z), z.id).toEqual({ awakenMul: 1, eliteEveryMul: 1, finalEnrageMul: 1 });
    }
    // DA-01: the edicts are the one roguelite field that ships ON (reroll / banish / skip budgets of a run, not meta numbers)
    expect(content.empires.map((e) => [e.id, resolveEdict(e)])).toEqual([
      ['saehwa', { rerolls: 0, banishes: 0, skips: 1 }],
      ['chowon', { rerolls: 1, banishes: 0, skips: 0 }],
      ['jihae', { rerolls: 0, banishes: 1, skips: 0 }],
    ]);
    // a hard clear still pays balance.hard.reward and nothing else changed in what the meta reads
    expect(content.balance.hard.reward).toBe(1.5);
  });

  it('awakening pacts (OF-01): every BehaviorKind maps to an existing passive the pact rank can be reached on', () => {
    const pacts = resolvePacts(content.balance.pacts);
    expect(pacts.rank).toBeGreaterThan(0);
    const passives = new Map(content.passives.map((x) => [x.id, x]));
    const kinds = Object.keys(BEHAVIORS);
    expect(kinds.length).toBe(16);
    for (const kind of kinds) {
      const id = (pacts.byBehavior as Record<string, string | undefined>)[kind];
      expect(id, `pact passive of ${kind}`).toBeDefined();
      const passive = passives.get(id as string);
      expect(passive, `passive '${String(id)}' of ${kind}`).toBeDefined();
      expect(passive?.maxRank ?? 0, `maxRank of ${String(id)}`).toBeGreaterThanOrEqual(pacts.rank);
    }
    // nothing maps outside the 16 behaviours, and every shipped skill (basic, active, talent ultimate) has a pact passive
    for (const kind of Object.keys(pacts.byBehavior)) expect(kinds, kind).toContain(kind);
    for (const sk of content.skills) expect(pacts.byBehavior[sk.behavior], `${sk.id} (${sk.behavior})`).toBeDefined();
    // 11 distinct passives carry the pacts (selfBuff has its own: benediction); the other 7 stay free (the 6 passive slots become a trade-off)
    const pact = new Set(Object.values(pacts.byBehavior));
    expect(pact.size).toBe(11);
    expect(content.passives.length - pact.size).toBe(7);
    // a pact passive is owned at pacts.rank (4) before the awakening is offered: every pact passive can be ranked that far
    expect(pacts.rank).toBe(4);
    expect(pacts.readyWeight).toBeGreaterThanOrEqual(1);
    expect(pacts.byBehavior.selfBuff).toBe('sovereign_boon');
  });

  it('every class can fill all 8 gear slots from at least one zone, and every zone feeds every class', () => {
    for (const classId of CLASS_IDS) {
      const pool = collectablePieces(content, classId);
      for (const slot of GEAR_SLOTS) expect(pool.some((g) => g.slot === slot), `${classId}/${slot}`).toBe(true);
      for (const zone of content.zones) expect(pool.some((g) => g.source.zone === zone.id), `${classId}/${zone.id}`).toBe(true);
    }
  });

  it('a new profile starts with exactly the first zone and the always-on codex entries', () => {
    const s = fresh();
    const first = indexContent(content).zonesOrdered[0];
    expect(s.unlocks.zones).toEqual([first?.id]);
    expect(s.unlocks.hard).toEqual([]);
    const statuses = zoneStatuses(s, content);
    expect(statuses.filter((z) => z.unlocked).map((z) => z.zone.id)).toEqual([first?.id]);
    expect(codexEntries(s, content).every((e) => e.condition.kind !== 'unknown')).toBe(true);
  });

  it('every talent tree reaches all three milestones within the 40-point budget', () => {
    for (const classId of CLASS_IDS) {
      for (const key of ['a', 'b'] as const) {
        let s = fresh();
        s.classes[classId].xp = xpForPoints(MAX_TALENT_POINTS);
        let spent = 0;
        const tree = indexContent(content).trees.get(`${classId}_${key}`);
        if (!tree) throw new Error(`missing ${classId}_${key}`);
        for (const rank of tree.byRank) {
          for (const node of rank) {
            while (spent < 30) {
              const r = allocateTalent(s, content, classId, key, node.id);
              if (!r.ok) break;
              s = r.save;
              spent++;
            }
          }
        }
        expect(spent, `${classId}_${key} reachable points`).toBe(30);
        expect(availablePoints(s.classes[classId])).toBe(MAX_TALENT_POINTS - 30);
        const view = treeView(content, s.classes[classId], classId, key);
        expect(view?.milestones.map((m) => m.reached)).toEqual([true, true, true]);
        const d = computeMetaBonusDetail(s, content, { classId, doctrine: key });
        expect(d.breakdown.unmappedEffects, `${classId}_${key}`).toEqual([]);
      }
    }
  });

  it('settlement end to end on real zones: XP, bank, drops, unlock chain', () => {
    const rng = seededRng(2024);
    let s = fresh();
    const zones = indexContent(content).zonesOrdered;
    for (const zone of zones) {
      const run = makeRun({
        zone: zone.id,
        victory: true,
        time: zone.final.at + 60,
        bossesKilled: [...zone.bosses.map((b) => b.boss), zone.final.boss],
        yeopLeft: 2000,
        shards: 12,
      });
      expect(talentXpFor(content, run).total).toBeGreaterThan(0);
      const r = settleRun(s, content, run, rng, NOW);
      s = r.save;
      expect(r.summary.drops.length).toBeGreaterThanOrEqual(0);
    }
    expect(s.unlocks.zones).toEqual(zones.map((z) => z.id));
    expect(s.unlocks.hard).toEqual(zones.map((z) => z.id));
    expect(s.stats.wins).toBe(zones.length);
    expect(s.bank.yeop).toBe(2000 * zones.length);
  });

  it('boss drop tables line up with the zone bosses (pity eventually completes a boss set)', () => {
    const zone = indexContent(content).zonesOrdered[0];
    if (!zone) throw new Error('no zone');
    const rng = seededRng(5);
    let s = fresh();
    for (let i = 0; i < 400; i++) {
      s = rollGearDrops(s, content, { zone: zone.id, classId: 'warrior', difficulty: 'normal', victory: true, time: 900, bossesKilled: [...zone.bosses.map((b) => b.boss)] }, rng).save;
    }
    const table = dropTableFor(s, content, 'warrior').filter((t) => t.zone === zone.id);
    expect(table.length).toBeGreaterThan(0);
    for (const section of table) expect(section.entries.every((e) => e.owned), `${section.kind}:${section.key}`).toBe(true);
  });
});
