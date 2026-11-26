// RP-01: the rules behind the death recap of the defeat report (killer line, boss strip, next steps). Pure (no DOM, no deps(): the
// name tables and the profile come in as arguments), so they are unit-tested in node; RunEnd.tsx only draws what these return.
import type { ClassId, L10n, ZoneDef } from '../../data/schema';
import { quoteUpgrade } from '../../meta/blacksmith';
import { favourFor } from '../../meta/bonuses';
import { ownedPieces } from '../../meta/gear';
import type { MetaContent, SaveData } from '../../meta/types';
import type { RunResult } from '../../sim/run';

/** the name tables the recap reads (the UI index maps satisfy this) */
export interface RecapNames {
  enemies: ReadonlyMap<string, { name: L10n }>;
  bosses: ReadonlyMap<string, { name: L10n }>;
  metins: ReadonlyMap<string, { name: L10n }>;
}

// ---------------------------------------------------------------------------------------------------------------
// who struck

export type HazardKind = 'lava' | 'miasma' | 'zone';

/** what dealt the killing blow, resolved against the content: a creature / boss / metin by name, or a ground hazard by kind */
export type Killer =
  | { kind: 'enemy' | 'boss' | 'metin'; id: string; name: L10n }
  | { kind: 'hazard'; id: HazardKind };

const HAZARDS: readonly string[] = ['lava', 'miasma', 'zone'];

/**
 * `RunResult.killedBy` (DT-01: an EnemyDef id, 'boss:<id>', 'metin:<id>' or 'hazard:<kind>') as something the report can name.
 * null for no record, and for a tag the content does not know (an id from a newer or older host): the report then says nothing about
 * the killer rather than printing a raw id.
 */
export function killerOf(tag: string | undefined, names: RecapNames): Killer | null {
  if (!tag) return null;
  const colon = tag.indexOf(':');
  const prefix = colon < 0 ? '' : tag.slice(0, colon);
  const id = colon < 0 ? tag : tag.slice(colon + 1);
  if (id === '') return null;
  switch (prefix) {
    case '': {
      const def = names.enemies.get(id);
      return def ? { kind: 'enemy', id, name: def.name } : null;
    }
    case 'boss': {
      const def = names.bosses.get(id);
      return def ? { kind: 'boss', id, name: def.name } : null;
    }
    case 'metin': {
      const def = names.metins.get(id);
      return def ? { kind: 'metin', id, name: def.name } : null;
    }
    case 'hazard':
      // a hazard kind this build does not know is still the ground that killed the hero
      return { kind: 'hazard', id: (HAZARDS.includes(id) ? id : 'zone') as HazardKind };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// where the run ended on the boss timeline

export type DotState = 'killed' | 'reached' | 'ahead';

export interface BossDot {
  id: string;
  /** run clock (s) the boss arrives at */
  at: number;
  final: boolean;
  /** killed = in the run's boss tally; reached = arrived by the time the hero fell and still standing; ahead = not arrived yet */
  state: DotState;
}

/** the zone's five bosses (four scheduled, then the final one) against the moment the run ended (`at`, run clock seconds) */
export function bossStrip(zone: Pick<ZoneDef, 'bosses' | 'final'>, killed: readonly string[], at: number): BossDot[] {
  const t = Number.isFinite(at) ? at : 0;
  const dead = new Set(killed);
  const list = zone.bosses.map((b) => ({ id: b.boss, at: b.at, final: false }));
  list.sort((a, b) => a.at - b.at);
  list.push({ id: zone.final.boss, at: zone.final.at, final: true });
  return list.map((b) => ({ ...b, state: dead.has(b.id) ? 'killed' : b.at <= t ? 'reached' : 'ahead' }) as BossDot);
}

export type NextBoss =
  /** a boss still to come: `inSec` seconds after the fall */
  | { kind: 'boss'; id: string; name: L10n; inSec: number }
  /** nothing left to come: the final boss had already arrived */
  | { kind: 'final'; id: string; name: L10n };

export interface DeathRecap {
  /** run clock (s) when the hero fell; null for a result made before DT-01 */
  fellAt: number | null;
  killer: Killer | null;
  next: NextBoss | null;
  /** the strip: absent for a zone the content does not have */
  dots: BossDot[] | null;
}

type RecapFields = Pick<RunResult, 'time' | 'bossesKilled'> & Partial<Pick<RunResult, 'killedBy' | 'killedAt' | 'nextBoss'>>;

/**
 * The recap of a defeat. Every part degrades on its own: a result without the DT-01 record still gets its strip (placed by the run's
 * time, which is the fall plus a short outro); a killer the content does not know is left out; a boss id it does not know is not named.
 */
export function deathRecap(r: RecapFields, zone: ZoneDef | undefined, names: RecapNames): DeathRecap {
  const fellAt = typeof r.killedAt === 'number' && Number.isFinite(r.killedAt) ? Math.max(0, r.killedAt) : null;
  const dots = zone ? bossStrip(zone, r.bossesKilled, fellAt ?? r.time) : null;
  return { fellAt, killer: killerOf(r.killedBy, names), next: fellAt === null ? null : nextBossOf(r, fellAt, zone, names), dots };
}

function nextBossOf(r: RecapFields, fellAt: number, zone: ZoneDef | undefined, names: RecapNames): NextBoss | null {
  // the record itself (DT-01 read the same schedule the HUD does) ...
  const nb = r.nextBoss;
  if (nb && Number.isFinite(nb.inSec) && nb.inSec > 0) {
    const def = names.bosses.get(nb.id);
    return def ? { kind: 'boss', id: nb.id, name: def.name, inSec: nb.inSec } : null;
  }
  // ... else the zone's own schedule (a wire result that lost the field): the first boss that had not arrived yet, none left = the final one was here
  if (!zone) return null;
  for (const b of zone.bosses) {
    if (b.at > fellAt) {
      const def = names.bosses.get(b.boss);
      return def ? { kind: 'boss', id: b.boss, name: def.name, inSec: b.at - fellAt } : null;
    }
  }
  if (zone.final.at > fellAt) {
    const def = names.bosses.get(zone.final.boss);
    return def ? { kind: 'boss', id: zone.final.boss, name: def.name, inSec: zone.final.at - fellAt } : null;
  }
  const def = names.bosses.get(zone.final.boss);
  return def ? { kind: 'final', id: zone.final.boss, name: def.name } : null;
}

/** seconds as m:ss for a span ("2:23"); the clock times of the report keep fmtTime's two-digit minutes */
export function fmtSpan(sec: number): string {
  const s = Math.max(0, Math.round(Number.isFinite(sec) ? sec : 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------------------------------------------
// what to do next

/** the refine worth pointing at: one the bank covers today */
export interface RefineOffer {
  gearId: string;
  from: number;
  to: number;
  /** success chance 0..1 */
  rate: number;
  yeop: number;
  shards: number;
  equipped: boolean;
}

/**
 * An affordable blacksmith attempt for `classId` on the profile as the run settled it: equipped pieces before the rest, then the best
 * chance, then the cheapest in Yeop. null when nothing owned can be refined with the bank (or everything is at +9).
 */
export function bestRefine(save: SaveData, content: MetaContent, classId: ClassId): RefineOffer | null {
  if (!save.classes[classId]) return null;
  let best: RefineOffer | null = null;
  for (const piece of ownedPieces(save, content, classId)) {
    const q = quoteUpgrade(save, content, classId, piece.def.id);
    if (!q.ok || !q.quote.canAfford || !(q.quote.rate > 0)) continue;
    const o: RefineOffer = { gearId: piece.def.id, from: q.quote.from, to: q.quote.to, rate: q.quote.rate, yeop: q.quote.yeop, shards: q.quote.shards, equipped: piece.equipped };
    if (!best || beats(o, best)) best = o;
  }
  return best;
}

function beats(a: RefineOffer, b: RefineOffer): boolean {
  if (a.equipped !== b.equipped) return a.equipped;
  if (a.rate !== b.rate) return a.rate > b.rate;
  return a.yeop < b.yeop;
}

export type NextStep =
  /** unspent talent points: the Talents tab */
  | { kind: 'talents'; points: number }
  /** a refine the bank covers: the Blacksmith */
  | { kind: 'smith'; offer: RefineOffer }
  /** Sky Sovereign's Favour for the next attempt at this zone and difficulty, in whole percent (informational) */
  | { kind: 'favour'; pct: number };

export interface NextInputs {
  /** points the settled profile can spend now (`SettlementSummary.talentXp.available`) */
  talentPoints: number;
  refine: RefineOffer | null;
  /** MT-01 favourFor as a fraction */
  favour: number;
}

/** the chips in priority order: spend what is waiting, refine what is affordable, then the favour that carries into the next try */
export function nextSteps(i: NextInputs): NextStep[] {
  const out: NextStep[] = [];
  const points = Math.floor(Number.isFinite(i.talentPoints) ? i.talentPoints : 0);
  if (points > 0) out.push({ kind: 'talents', points });
  if (i.refine) out.push({ kind: 'smith', offer: i.refine });
  const pct = Math.round((Number.isFinite(i.favour) ? i.favour : 0) * 100);
  if (pct >= 1) out.push({ kind: 'favour', pct });
  return out;
}

/** the inputs read from the settled profile (the favour already counts the run that just ended as one more failed attempt) */
export function nextInputs(save: SaveData, content: MetaContent, r: Pick<RunResult, 'classId' | 'zone' | 'difficulty'>, talentPoints: number): NextInputs {
  return { talentPoints, refine: bestRefine(save, content, r.classId), favour: favourFor(save, r.zone, r.difficulty) };
}
