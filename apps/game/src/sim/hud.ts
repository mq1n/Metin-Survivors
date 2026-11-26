// HUD snapshot for the UI (10 Hz): plain data, allocated per call.

import { MAX_SKILL_RANK } from '../data/schema';
import { cooldownFrac } from './skills';
import { activeLeft, isInsuranceSkill, ringState } from './skills/trigger';
import { runEventChannelOf, runEventHud } from './runEvents';
import type { HudSnapshot } from './types';
import { MetinPhase } from './types';
import type { World } from './world';

export function hud(w: World, playerIndex: number): HudSnapshot {
  const p = w.players[playerIndex] ?? w.players[0];
  if (!p) throw new Error('sim: world has no players');
  const ix = w.ix;
  const skills = p.skills.map((s) => {
    const cooldown = cooldownFrac(s);
    const left = activeLeft(w, p, s);
    const state = ringState(s, left);
    return {
      id: s.def.id,
      icon: s.def.icon,
      rank: s.rank,
      cooldown,
      // the same moment as the fraction: 0 for an aura / a skill without a cooldown
      cdLeft: cooldown > 0 ? s.cd : 0,
      basic: s.basic,
      awakened: s.rank >= MAX_SKILL_RANK,
      state,
      activeLeft: left > 0.001 ? left : 0,
      calm: state === 'armed' && isInsuranceSkill(s),
    };
  });
  const passives = p.passives.map((x) => {
    const d = ix.passives.get(x.id);
    return { id: x.id, icon: d?.icon ?? '', rank: x.rank, maxRank: d?.maxRank ?? x.rank };
  });
  const stones = p.stones.map((s) => (s ? { id: s.id, icon: ix.stones.get(s.id)?.icon ?? '', level: s.level } : null));
  const trinkets = p.trinkets.map((t) => (t ? { id: t.id, icon: ix.trinkets.get(t.id)?.icon ?? '', rank: t.rank } : null));

  let nextBoss: HudSnapshot['nextBoss'] = null;
  const sp = w.spawner;
  const next = sp.bosses[sp.nextBoss];
  if (next) nextBoss = { at: next.at, in: Math.max(0, next.at - w.time), id: next.boss };
  else if (w.time < w.zone.final.at) nextBoss = { at: w.zone.final.at, in: Math.max(0, w.zone.final.at - w.time), id: w.zone.final.boss };

  let boss: HudSnapshot['boss'] = null;
  for (const b of w.bosses) {
    const row = w.enemies.find(b.enemy);
    if (row < 0 || b.dead) continue;
    boss = {
      id: b.def.id,
      hp: w.enemies.hp[row] as number,
      hpMax: w.enemies.hpMax[row] as number,
      phase: b.phase,
      enraged: b.enraged,
      final: b.final,
      x: w.enemies.x[row] as number,
      z: w.enemies.z[row] as number,
    };
    break;
  }
  const metins = w.metins
    .filter((m) => m.phase === MetinPhase.Alive || m.phase === MetinPhase.Awakened || m.phase === MetinPhase.Falling)
    .map((m) => ({ id: m.id, x: m.x, z: m.z, awakened: m.phase === MetinPhase.Awakened, hpFrac: m.hpFrac, rune: m.def.rune }));
  const out: HudSnapshot = {
    time: w.time,
    player: p.index,
    hp: p.hp,
    hpMax: p.hpMax,
    // the trinket shield and a skill ward share the HP bar overlay
    shield: p.shield + p.ward,
    level: p.level,
    xp: p.xp,
    xpNext: p.xpNext,
    yeop: p.yeop,
    shards: p.shards,
    kills: p.kills,
    corruption: w.corruption,
    alive: p.alive,
    skills,
    passives,
    stones,
    trinkets,
    rerolls: p.rerolls,
    banishes: p.banishes,
    skips: p.skips,
    nextBoss,
    boss,
    metins,
    darkness: w.darkness,
    px: p.x,
    pz: p.z,
    dmg: p.skills
      .map((s) => ({ skillId: s.def.id, rank: s.rank, damage: s.damage }))
      .sort((a, b) => b.damage - a.damage)
      .slice(0, 8),
    dps: w.dps(),
  };
  // run event (RS-02a): absent while the run has none or nothing is up, so the HUD of every shipped run is exactly as before
  const runEvent = runEventHud(w);
  if (runEvent !== null) out.runEvent = runEvent;
  const channel = runEventChannelOf(w, p.index);
  if (channel !== undefined) out.channel = channel;
  return out;
}
