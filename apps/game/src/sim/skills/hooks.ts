// Kill feed (DESIGN M3): one hook, called by combat.killEnemy for every creature a hero kills, feeds
//  - refund  (s of cooldown taken off per kill, capped at trig.refundCap x the skill's cooldown per cycle: SkillInstance.refunded)
//  - extend  (s added to the running window per kill, capped at trig.extendCap x its base duration: ActiveBuff.ext)
//  - stack   (buff magnitude growth per kill, capped at +trig.stackCap: ActiveBuff.scale)
//  - the corpse ring (kill positions of heroes that own a taunting planted summon: Cursed Legion raises its knights there)
// No RNG, no allocation: the hero's skills and the holders' buffs are walked in index order.

import type { PlayerState, SkillInstance } from '../stores';
import type { World } from '../world';
import { ProjKind } from '../stores';

/** a hero `kp` killed a (non-metin) creature at (x, z); a boss feeds every cap but never the corpse ring (no legion rises from a boss) */
export function onKill(w: World, kp: PlayerState, x: number, z: number, boss = false): void {
  const skills = kp.skills;
  const t = w.trig;
  let corpse = false;
  for (let i = 0; i < skills.length; i++) {
    const s = skills[i] as SkillInstance;
    const fp = s.fp;
    if (fp.refund > 0 && s.cd > 0) {
      const room = t.refundCap * fp.cooldown - s.refunded;
      const take = Math.min(fp.refund, room, s.cd);
      if (take > 0) {
        s.cd -= take;
        s.refunded += take;
      }
    }
    if (fp.extend > 0 || fp.stack > 0) feedBuffs(w, kp, s);
    if (!corpse && s.def.role === 'planted' && (s.def.params.taunt ?? 0) > 0) corpse = true;
  }
  if (corpse && !boss) w.addCorpse(x, z, kp.index);
}

/** grow / lengthen every running buff of caster skill `s` (the caster's own and the allies' copies, player order) */
function feedBuffs(w: World, kp: PlayerState, s: SkillInstance): void {
  const t = w.trig;
  const fp = s.fp;
  const players = w.players;
  for (let qi = 0; qi < players.length; qi++) {
    const q = players[qi] as PlayerState;
    const buffs = q.buffs;
    for (let bi = 0; bi < buffs.length; bi++) {
      const b = buffs[bi];
      if (!b || b.skillSlot !== s.slot) continue;
      if (fp.extend > 0) {
        const ext = b.ext ?? 0;
        const add = Math.min(fp.extend, t.extendCap * b.total - ext);
        if (add > 0) {
          b.left += add;
          b.ext = ext + add;
          // the selfBuff recast guard reads the caster's window end
          if (q === kp) s.aux += add;
          if (q === kp) killPulse(w, kp, s, add);
        }
      }
      if (fp.stack > 0) {
        const scale = b.scale ?? 1;
        const next = Math.min(1 + t.stackCap, scale + fp.stack);
        if (next > scale) {
          b.scale = next;
          q.statsDirty = true;
          if (q === kp) killPulse(w, kp, s, 0);
        }
      }
    }
  }
}

/** vfx: a kill fed the window of `s`: its marker lives as long as the buff did (`add` s longer) and a small pulse (`sk.<id>.kill`) ticks on the hero, at most 3 a second */
function killPulse(w: World, kp: PlayerState, s: SkillInstance, add: number): void {
  if (s.h2 === 0) return;
  const P = w.projectiles;
  const r = P.find(s.h2);
  if (r < 0 || P.kind[r] !== ProjKind.Marker) {
    s.h2 = 0;
    return;
  }
  if (add > 0) {
    P.life[r] = (P.life[r] as number) + add;
    P.lifeMax[r] = Math.max(P.lifeMax[r] as number, P.life[r] as number);
  }
  if (w.time - s.fxT >= 0.33) {
    s.fxT = w.time;
    w.bus.vfx(`sk.${s.def.id}.kill`, kp.x, kp.z, 0, 1, 1, 0.35, s.fp.element);
  }
}
