// Context trigger gate (DESIGN M1): WHEN an auto-cast skill fires.
//
// A skill with `def.trigger` stays ARMED (cd 0, retried every tick by updateSkills) until one of its trigger kinds is true; its
// cooldown is the lockout after a fire. `patience` (s armed) relaxes the gate to `engaged`. Everything here is a pure read of sim
// state: gate evaluation never draws RNG (an armed skill must not shift the combat stream), the per-hero context is built once per
// tick and lazily (only when an armed skill asks), and ally / party loops run in player index order.

import type { TriggerKind } from '../../data/schema';
import { EnemyFlag, EnemyState, ProjKind, type HeroCtx, type PlayerState, type SkillInstance } from '../stores';
import type { World } from '../world';

/** HUD ring state of a skill slot (see HudSkillSlot.state) */
export type SkillRingState = 'cooling' | 'armed' | 'active';

/**
 * The per-hero gate context of this tick (`p.ctx`, cached by `w.tick`). Counts creatures by CENTRE distance (the measured
 * series of the design did the same), skips metin stones, dying / spawning / invulnerable rows. `volleyN` and `allyNeed` are
 * evaluated lazily by `volleyCount` / `allyNeeds` (-1 = not yet).
 */
export function heroCtx(w: World, p: PlayerState): HeroCtx {
  const c = p.ctx;
  if (c.tick === w.tick) return c;
  c.tick = w.tick;
  c.volleyN = -1;
  c.allyNeed = -1;
  const t = w.trig;
  const e = w.enemies;
  const reach = Math.max(t.pinned.r, t.engaged.r, t.elite.r);
  const n = w.hash.queryCircle(e, p.x, p.z, reach, w.qb);
  const pr2 = t.pinned.r * t.pinned.r;
  const er2 = t.engaged.r * t.engaged.r;
  const lr2 = t.elite.r * t.elite.r;
  let nPinned = 0;
  let nEngaged = 0;
  let elite = false;
  for (let i = 0; i < n; i++) {
    const row = w.qb[i] as number;
    if (((e.flags[row] as number) & EnemyFlag.Metin) !== 0) continue;
    const dx = (e.x[row] as number) - p.x;
    const dz = (e.z[row] as number) - p.z;
    const d2 = dx * dx + dz * dz;
    if (d2 <= pr2) nPinned++;
    if (d2 <= er2) nEngaged++;
    if (d2 <= lr2 && (e.eliteTier[row] as number) >= 1) elite = true;
  }
  let boss = false;
  if (w.bosses.length > 0) {
    const b2 = t.boss.r * t.boss.r;
    for (const b of w.bosses) {
      const row = e.find(b.enemy);
      if (row < 0 || e.state[row] === EnemyState.Dying) continue;
      const dx = (e.x[row] as number) - p.x;
      const dz = (e.z[row] as number) - p.z;
      if (dx * dx + dz * dz <= b2) {
        boss = true;
        break;
      }
    }
  }
  c.nPinned = nPinned;
  c.nEngaged = nEngaged;
  c.bossNear = boss;
  // `elite` reads "an elite or a boss": a boss inside the boss radius counts even when it is beyond the elite radius
  c.eliteNear = elite || boss;
  return c;
}

/** hostile bolts within trig.volley.r of the hero (cached in the ctx for the tick) */
export function volleyCount(w: World, p: PlayerState): number {
  const c = heroCtx(w, p);
  if (c.volleyN >= 0) return c.volleyN;
  const P = w.projectiles;
  const r = w.trig.volley.r;
  const r2 = r * r;
  let n = 0;
  for (let i = 0; i < P.count; i++) {
    if (P.kind[i] !== ProjKind.Hostile) continue;
    const dx = (P.x[i] as number) - p.x;
    const dz = (P.z[i] as number) - p.z;
    if (dx * dx + dz * dz <= r2) n++;
  }
  c.volleyN = n;
  return n;
}

/**
 * true when a living ally (not `p`) within `reach` metres is hurt (lost >= trig.hurt.frac of its max HP within the hurt window)
 * or at <= trig.ally.hp of its max HP. Never true in solo. Players are scanned in index order. Not cached: the reach differs
 * per skill (its `party` radius), and a world holds at most 4 heroes.
 */
export function allyNeeds(w: World, p: PlayerState, reach: number): boolean {
  const players = w.players;
  if (players.length < 2) return false;
  const t = w.trig;
  const r2 = reach * reach;
  for (let i = 0; i < players.length; i++) {
    const a = players[i] as PlayerState;
    if (a === p || !a.alive) continue;
    const dx = a.x - p.x;
    const dz = a.z - p.z;
    if (dx * dx + dz * dz > r2) continue;
    if (a.hp <= a.hpMax * t.ally.hp) return true;
    if (a.hurtSum(w.time, t.hurt.window) >= t.hurt.frac * a.hpMax) return true;
  }
  return false;
}

/** is one trigger kind true for hero `p` right now (the spec's own thresholds applied)? Pure read, no RNG. */
export function kindOpen(w: World, p: PlayerState, s: SkillInstance, kind: TriggerKind): boolean {
  const t = w.trig;
  const spec = s.def.trigger;
  switch (kind) {
    case 'engaged':
      return heroCtx(w, p).nEngaged >= t.engaged.n;
    case 'pinned':
      return heroCtx(w, p).nPinned >= (spec?.n ?? t.pinned.n);
    case 'hurt':
      return p.hurtSum(w.time, t.hurt.window) >= t.hurt.frac * p.hpMax;
    case 'danger':
      return p.hp <= p.hpMax * (spec?.hp ?? t.danger.hp) || p.hurtSum(w.time, t.danger.window) >= t.danger.lossFrac * p.hpMax;
    case 'elite':
      return heroCtx(w, p).eliteNear;
    case 'boss':
      return heroCtx(w, p).bossNear;
    case 'volley':
      return volleyCount(w, p) >= t.volley.n;
    case 'ally':
      return allyNeeds(w, p, s.fp.party > 0 ? s.fp.party : t.ally.r);
    case 'lethal':
      // never opens the plain gate: a lethal skill is cast by the killing blow itself (see armLethal / castNow)
      return false;
  }
}

/**
 * Does the gate of skill `s` read open for hero `p`? A skill without a trigger is always open. `World.qaForceTriggers` (tests /
 * QA only) forces every gate open so gated skills still cast on their plain cooldown. `minHp` is a hard block (also against the
 * patience fallback). The fallback opens the gate once the skill has been armed for `patience x trig.patienceMul` seconds and
 * the hero is `engaged`.
 */
export function gateOpen(w: World, p: PlayerState, s: SkillInstance): boolean {
  const spec = s.def.trigger;
  if (!spec) return true;
  if (w.qaForceTriggers) return true;
  if (spec.minHp !== undefined && spec.minHp > 0 && p.hp < p.hpMax * spec.minHp) return false;
  const any = spec.any;
  for (let i = 0; i < any.length; i++) if (kindOpen(w, p, s, any[i] as TriggerKind)) return true;
  const patience = spec.patience ?? 0;
  if (patience > 0 && s.armedT >= patience * w.trig.patienceMul && kindOpen(w, p, s, 'engaged')) return true;
  return false;
}

/** true when the skill's trigger lists `lethal` (War Oath): updateSkills arms `p.lethalSlot` while such a skill is ready */
export function isLethalSkill(s: SkillInstance): boolean {
  const spec = s.def.trigger;
  return spec !== undefined && spec.any.includes('lethal');
}

/**
 * Seconds the skill's window is still up on hero `p`: the hero's own ActiveBuff of this skill slot, the selfBuff window
 * (`s.aux` = absolute end time), the ward the skill granted. 0 when nothing of it runs. Feeds HudSkillSlot.activeLeft.
 */
export function activeLeft(w: World, p: PlayerState, s: SkillInstance): number {
  let left = 0;
  if (s.def.behavior === 'selfBuff') left = Math.max(left, s.aux - w.time);
  for (let i = 0; i < p.buffs.length; i++) {
    const b = p.buffs[i];
    if (b && b.skillSlot === s.slot && b.left > left) left = b.left;
  }
  if (p.wardSlot === s.slot && p.ward > 0 && p.wardT > left) left = p.wardT;
  // a summon window: the longest-living timed row of the skill (permanent rows, like the flame spirits, are not a window)
  if (s.pets.length > 0) {
    const P = w.projectiles;
    for (let k = 0; k < s.pets.length; k++) {
      const r = P.find(s.pets[k] as number);
      if (r < 0) continue;
      const life = P.life[r] as number;
      if (life < 1e5 && life > left) left = life;
    }
  }
  return left;
}

/** trigger kinds that only open in an emergency: a skill gated by nothing else is insurance */
const INSURANCE_KINDS: readonly TriggerKind[] = ['lethal', 'danger', 'ally'];

/**
 * An INSURANCE skill sits armed for most of a run and fires only when the hero is about to die or a friend is: War Oath (`lethal`)
 * and Cure (`danger` / `ally`). Its trigger lists nothing but emergency kinds and carries no `patience` (no fallback that would
 * fire it on plain `engaged`). The HUD draws its armed ring as a calm static rim instead of the pulsing one (HudSkillSlot.calm).
 */
export function isInsuranceSkill(s: SkillInstance): boolean {
  const spec = s.def.trigger;
  if (!spec || spec.any.length === 0 || (spec.patience ?? 0) > 0) return false;
  return spec.any.every((k) => INSURANCE_KINDS.includes(k));
}

/** HUD ring state: 'active' while the window runs, else 'armed' for a ready gated skill, else 'cooling' */
export function ringState(s: SkillInstance, left: number): SkillRingState {
  if (left > 0.001) return 'active';
  if (s.cd > 0) return 'cooling';
  return s.def.trigger && !s.basic && s.def.behavior !== 'persistentAura' ? 'armed' : 'cooling';
}
