// selfBuff — temporary StatMods on the hero (+ instant heal). Recast only once the previous buff has ended.
//
// Skill-logic payloads (all optional, absent = the legacy behavior above; DESIGN M3):
//  party  (m)   buff, heal and shells also land on every living ally within `party` (player index order); solo = just the caster
//  nova   (m)   a burst at the cast (common.finishCast, base kit or awakening)
//  cost   (frac of max HP) paid by the caster at the cast, never below 1 HP (the gate's minHp keeps it from firing when low)
//  mark   (K)   the K toughest foes within `range` (elite tier, then HP, then row) get the skill's status
//  pulse  (s)   spectral bites on the nearest foe while the window is up
//  stack / extend / refund  are fed by kills (hooks.onKill)
//  veil / shield / steady / mirror  belong to the shells (shell.ts, finishCast)
// A GATED skill (def.trigger) has already passed its gate when cast() runs, so the legacy "any foe within 12 m" guard applies
// only to skills without a trigger.

import { applyStatus, healPlayer, hitEnemy } from '../../combat';
import { HealSource } from '../../events';
import { EnemyFlag, EnemyState, type PlayerState, type SkillInstance } from '../../stores';
import type { World } from '../../world';
import { aimOrManual, beginHit, finishCast, forParty, partyOut } from '../common';
import { wardAmount, type FinalParams } from '../params';
import { endMarker, spawnMarker } from '../companions';
import { grantShell, hasShell } from '../shell';
import type { Behavior } from '../types';

const MAX_MARKS = 8;
const markRows = new Int32Array(MAX_MARKS);
const DEFAULT_MARK_RANGE = 14;
const DEFAULT_BITE_RANGE = 8;
/** vfx: kill-fed window skills that draw a marker for their window (`sk.<id>.loop`, follows the holder, lives exactly as long as the buff; kills extend it, see hooks.ts) */
export const WINDOW_LOOPS: ReadonlySet<string> = new Set(['warfever', 'blood_frenzy', 'redmane_spirit', 'moonmane_spirit']);
/** vfx: how long (s) a branded foe's look is re-emitted per pass, and the pass interval: the passes overlap by 0.1 s so the brand never blinks */
const BRAND_LIFE = 1.0;
const BRAND_GAP = 0.9;

/** a ranks above b: higher elite tier, then more HP, then the lower row (deterministic whatever the query order) */
function tougher(e: World['enemies'], a: number, b: number): boolean {
  const ta = e.eliteTier[a] as number;
  const tb = e.eliteTier[b] as number;
  if (ta !== tb) return ta > tb;
  const ha = e.hp[a] as number;
  const hb = e.hp[b] as number;
  if (ha !== hb) return ha > hb;
  return a < b;
}

/** brand the `fp.mark` toughest foes within range with the skill's status (no RNG: the chance is not rolled) */
function markFoes(w: World, p: PlayerState, s: SkillInstance, fp: FinalParams): void {
  const k = Math.min(MAX_MARKS, fp.mark);
  if (k <= 0) return;
  const e = w.enemies;
  const n = w.hash.queryCircle(e, p.x, p.z, fp.range > 0 ? fp.range : DEFAULT_MARK_RANGE, w.qa);
  let m = 0;
  for (let i = 0; i < n; i++) {
    const row = w.qa[i] as number;
    if (((e.flags[row] as number) & EnemyFlag.Metin) !== 0 || e.state[row] === EnemyState.Dying) continue;
    let at = m;
    while (at > 0 && tougher(e, row, markRows[at - 1] as number)) at--;
    if (at >= k) continue;
    const top = Math.min(m, k - 1);
    for (let j = top; j > at; j--) markRows[j] = markRows[j - 1] as number;
    markRows[at] = row;
    if (m < k) m++;
  }
  const id = `${s.def.id}.mark`;
  s.marks.length = 0;
  for (let i = 0; i < m; i++) {
    const row = markRows[i] as number;
    s.marks.push(e.id[row] as number);
    if (fp.statusKind >= 0 && fp.statusChance > 0) {
      applyStatus(w, row, fp.statusKind, fp.statusDuration, fp.statusPower, s.slot, e.eliteTier[row] === 3);
    }
    w.bus.vfx(`sk.${id}`, e.x[row] as number, e.z[row] as number, 0, 1, 1 + (e.radius[row] as number), 0.6, fp.element);
  }
  // the brand look (`sk.<id>.brand`) is re-emitted over the foes while the weaken lasts (update below)
  s.markEnd = m > 0 ? w.time + Math.max(1, fp.statusDuration > 0 ? fp.statusDuration : fp.duration) : 0;
  s.fxT = w.time + BRAND_GAP;
}

/** vfx: re-emit the brand over every marked foe that still lives (eagle eye: the 3 toughest stay branded for the whole weaken) */
function brandFoes(w: World, s: SkillInstance, fp: FinalParams): void {
  if (s.markEnd <= w.time) {
    s.marks.length = 0;
    s.markEnd = 0;
    return;
  }
  if (w.time < s.fxT) return;
  s.fxT = w.time + BRAND_GAP;
  const e = w.enemies;
  let live = 0;
  for (let i = 0; i < s.marks.length; i++) {
    const row = e.find(s.marks[i] as number);
    if (row < 0 || e.state[row] === EnemyState.Dying) continue;
    s.marks[live++] = s.marks[i] as number;
    w.bus.vfx(`sk.${s.def.id}.brand`, e.x[row] as number, e.z[row] as number, 0, 1, 1 + (e.radius[row] as number), BRAND_LIFE, fp.element);
  }
  s.marks.length = live;
  if (live === 0) s.markEnd = 0;
}

export const selfBuff: Behavior = {
  cast(w, p, s, fp) {
    if (s.aux > w.time) return false;
    // a ward skill waits (stays armed) while its caster carries a foreign ward it could not replace: two wards that lock into phase
    // (blessing + reflect) would otherwise throw the second one away; it lands the moment the live ward breaks or fades
    if (fp.shield > 0 && p.ward > 0 && p.wardSlot !== s.slot && p.ward >= wardAmount(fp, p.hpMax)) return false;
    // do not burn an ungated buff on an empty field unless manually cast (a gated skill already passed its trigger)
    if (s.def.trigger === undefined && !aimOrManual(w, p, Math.max(fp.range, 12))) return false;
    const dur = Math.max(1, fp.duration);
    if (fp.cost > 0) {
      // the blood price: never kills (the trigger's minHp keeps the gate shut when the hero is low)
      p.hp = Math.max(1, p.hp - p.hpMax * fp.cost);
      w.bus.vfx(`sk.${s.def.id}.pay`, p.x, p.z, 0, 1, 2, 0.5, fp.element, -1, p.index);
    }
    const count = fp.party > 0 ? forParty(w, p, fp.party) : 0;
    const shell = hasShell(s, fp);
    const windowLook = fp.buff !== undefined && WINDOW_LOOPS.has(s.def.id);
    if (windowLook && s.h2 !== 0) endMarker(w, s.h2);
    for (let ti = 0; ti < Math.max(1, count); ti++) {
      const q = count > 0 ? (partyOut[ti] as PlayerState) : p;
      if (fp.buff) {
        // drop any stale buff of this skill, then apply the new one
        q.buffs = q.buffs.filter((b) => b.skillSlot !== s.slot);
        q.buffs.push({ skillSlot: s.slot, mods: fp.buff, left: dur, total: dur });
        q.statsDirty = true;
      }
      // the caster's own cast heal is HealSource.CastSelf: the cast has its own look and the heal route skips holy.heal for it (an ally's heal keeps Skill)
      if (fp.heal > 0) healPlayer(w, q, fp.heal, q === p ? HealSource.CastSelf : HealSource.Skill);
      if (shell) grantShell(w, q, s, fp);
      if (windowLook) {
        const mh = spawnMarker(w, q, s.slot, `sk.${s.def.id}.loop`, 1.4, dur, true);
        if (q === p) s.h2 = mh;
      }
    }
    s.aux = w.time + dur;
    if (fp.pulse > 0) s.h1 = w.time + fp.pulse;
    if (fp.mark > 0) markFoes(w, p, s, fp);
    w.bus.vfx(s.def.vfx, p.x, p.z, 0, 1, Math.max(2, fp.area), dur, fp.element, -1, p.index);
    finishCast(w, p, s, fp, p.x, p.z, Math.sin(p.rot), Math.cos(p.rot));
    return true;
  },

  /** spectral bites (`pulse`): every fp.pulse s while the window is up, one hit on the nearest foe through the skill's hit context */
  update(w, p, s, fp) {
    if (s.markEnd > 0) brandFoes(w, s, fp);
    if (fp.pulse <= 0 || s.aux <= w.time || w.time < s.h1) return;
    const e = w.enemies;
    const row = w.hash.nearest(e, p.x, p.z, Math.max(fp.range, DEFAULT_BITE_RANGE));
    if (row < 0) {
      s.h1 = w.time + 0.2;
      return;
    }
    s.h1 = w.time + fp.pulse;
    const tx = e.x[row] as number;
    const tz = e.z[row] as number;
    const c = beginHit(p, s, fp, p.x, p.z);
    w.bus.vfx(`sk.${s.def.id}.bite`, tx, tz, tx - p.x, tz - p.z, 1.2, 0.4, fp.element);
    hitEnemy(w, row, fp.damage, c);
  },
};
