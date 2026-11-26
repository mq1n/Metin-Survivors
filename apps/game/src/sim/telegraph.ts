// Telegraphs: ground warning decals that resolve into hits (boss slams, meteors, metin impact, enemy windups).

import { hurtPlayer, HurtKind, knockEnemy, pushPlayer } from './combat';
import { DT, PLAYER_RADIUS } from './constants';
import { onMetinImpact } from './metins';
import { spawnZone } from './skills/common';
import { EnemyState, TelegraphAct, TelegraphShape, ZoneKind } from './stores';
import type { World } from './world';

export interface TelegraphSpec {
  shape: TelegraphShape;
  x: number;
  z: number;
  rot?: number;
  radius?: number;
  length?: number;
  width?: number;
  dur: number;
  follow?: number;
  /** 0 enemy, 1 boss, 2 metin */
  owner: number;
  act: TelegraphAct;
  damage?: number;
  knock?: number;
  element?: number;
  preset?: string;
  aux?: number;
}

/**
 * Store full: a warning decal (Visual) yields its row to a telegraph that resolves into damage (Impact / HitZone / ...), so a hit is
 * never dropped without its warning while a pure decal lives. The row is reused in place (no free / swap-remove, so this is safe
 * inside updateTelegraphs' loop); the oldest decal is the victim. Returns the row, or -1 when every row is a damaging telegraph.
 */
function takeVisualRow(w: World): number {
  const T = w.telegraphs;
  let best = -1;
  let bestT = -1;
  for (let i = 0; i < T.count; i++) {
    if (T.act[i] !== TelegraphAct.Visual) continue;
    const t = T.t[i] as number;
    if (t > bestT) {
      bestT = t;
      best = i;
    }
  }
  return best;
}

function takeNonMetinRow(w: World): number {
  const T = w.telegraphs;
  let bestEnemy = -1;
  let bestEnemyT = -1;
  let bestAny = -1;
  let bestAnyT = -1;
  for (let i = 0; i < T.count; i++) {
    if (T.act[i] === TelegraphAct.MetinImpact) continue;
    const t = T.t[i] as number;
    if (T.owner[i] === 0 && t > bestEnemyT) {
      bestEnemyT = t;
      bestEnemy = i;
    }
    if (t > bestAnyT) {
      bestAnyT = t;
      bestAny = i;
    }
  }
  return bestEnemy >= 0 ? bestEnemy : bestAny;
}

/** create a telegraph (and its event). Returns the row, or -1 when the store is full. */
export function addTelegraph(w: World, s: TelegraphSpec): number {
  const T = w.telegraphs;
  let r = T.alloc();
  if (r < 0 && s.act !== TelegraphAct.Visual) r = takeVisualRow(w);
  if (r < 0 && s.act === TelegraphAct.MetinImpact) r = takeNonMetinRow(w);
  if (r < 0) return -1;
  T.shape[r] = s.shape;
  T.act[r] = s.act;
  T.x[r] = s.x;
  T.z[r] = s.z;
  T.rot[r] = s.rot ?? 0;
  T.radius[r] = s.radius ?? 0;
  T.length[r] = s.length ?? 0;
  T.width[r] = s.width ?? 0;
  T.t[r] = 0;
  T.dur[r] = Math.max(0.05, s.dur);
  T.progress[r] = 0;
  T.follow[r] = s.follow ?? 0;
  T.owner[r] = s.owner;
  T.element[r] = s.element ?? 0;
  T.damage[r] = s.damage ?? 0;
  T.knock[r] = s.knock ?? 0;
  T.preset[r] = s.preset ? w.strings.id(s.preset) : 0;
  T.aux[r] = s.aux ?? 0;
  w.bus.telegraph(T.id[r] as number, s.shape, s.x, s.z, s.rot ?? 0, s.radius ?? 0, s.width ?? 0, s.length ?? 0, s.dur, s.owner);
  return r;
}

/** is world point (px,pz) hit by shape `i`? `pad` = body radius of the target */
export function inTelegraph(w: World, i: number, px: number, pz: number, pad: number): boolean {
  const T = w.telegraphs;
  const x = T.x[i] as number;
  const z = T.z[i] as number;
  const dx = px - x;
  const dz = pz - z;
  const d = Math.hypot(dx, dz);
  switch (T.shape[i]) {
    case TelegraphShape.Circle:
      return d <= (T.radius[i] as number) + pad;
    case TelegraphShape.Ring:
      return d <= (T.radius[i] as number) + pad && d >= (T.length[i] as number);
    case TelegraphShape.Cone: {
      const len = T.radius[i] as number;
      if (d > len + pad) return false;
      if (d < pad + 0.3) return true;
      const rot = T.rot[i] as number;
      const cos = (dx * Math.sin(rot) + dz * Math.cos(rot)) / d;
      const half = (T.width[i] as number) / 2 + Math.atan2(pad, d);
      return cos >= Math.cos(Math.min(Math.PI, half));
    }
    case TelegraphShape.Line: {
      const rot = T.rot[i] as number;
      const fx = Math.sin(rot);
      const fz = Math.cos(rot);
      const f = dx * fx + dz * fz;
      if (f < -pad || f > (T.length[i] as number) + pad) return false;
      const lat = Math.abs(dx * fz - dz * fx);
      return lat <= (T.width[i] as number) / 2 + pad;
    }
    default:
      return false;
  }
}

export function updateTelegraphs(w: World): void {
  const T = w.telegraphs;
  for (let i = T.count - 1; i >= 0; i--) {
    const follow = T.follow[i] as number;
    if (follow !== 0) {
      const row = w.enemies.find(follow);
      const st = row >= 0 ? (w.enemies.state[row] as number) : -1;
      if (row < 0 || st === EnemyState.Dying || (T.act[i] === TelegraphAct.Visual && T.owner[i] === 0 && st === EnemyState.Stunned)) {
        T.free(i);
        continue;
      }
      T.x[i] = w.enemies.x[row] as number;
      T.z[i] = w.enemies.z[row] as number;
      if (T.owner[i] === 1 && (T.shape[i] === TelegraphShape.Cone || T.shape[i] === TelegraphShape.Line)) {
        T.rot[i] = w.enemies.rot[row] as number;
      }
    }
    const t = (T.t[i] as number) + DT;
    T.t[i] = t;
    const dur = T.dur[i] as number;
    T.progress[i] = Math.min(1, t / dur);
    if (t < dur) continue;
    resolveTelegraph(w, i);
    T.free(i);
  }
}

function resolveTelegraph(w: World, i: number): void {
  const T = w.telegraphs;
  const act = T.act[i] as number;
  if (act === TelegraphAct.Visual) return;
  const x = T.x[i] as number;
  const z = T.z[i] as number;
  const damage = T.damage[i] as number;
  const knock = T.knock[i] as number;
  const element = T.element[i] as number;
  const preset = w.strings.name(T.preset[i] as number);
  const radius = T.radius[i] as number;

  if (act === TelegraphAct.MetinImpact) {
    onMetinImpact(w, T.aux[i] as number, damage, knock);
    return;
  }
  const players = w.players;
  for (let pi = 0; pi < players.length; pi++) {
    const p = players[pi];
    if (!p || !p.alive) continue;
    if (!inTelegraph(w, i, p.x, p.z, PLAYER_RADIUS)) continue;
    if (damage > 0) hurtPlayer(w, pi, damage, x, z, element, HurtKind.Melee);
    if (knock > 0) pushPlayer(p, x, z, knock);
  }
  if (preset) w.bus.vfx(preset, x, z, Math.sin(T.rot[i] as number), Math.cos(T.rot[i] as number), Math.max(radius, T.length[i] as number, 1), 0.5, element);
  if (act === TelegraphAct.Impact) w.bus.shake(0.35, 0.3);
  if (act === TelegraphAct.HitZone) {
    spawnZone(w, {
      kind: ZoneKind.Circle,
      team: 1,
      x,
      z,
      radius,
      dur: T.aux[i] as number,
      tick: 0.5,
      damage: damage * 0.25,
      preset: preset || 'vfx_hazard',
      element,
      owner: 0,
      skill: 255,
    });
  }
  // shoves nearby enemies too so slams read as physical
  if (knock > 0 && T.shape[i] === TelegraphShape.Circle && T.owner[i] === 2) {
    const n = w.hash.queryCircle(w.enemies, x, z, radius, w.qb);
    for (let k = 0; k < n; k++) {
      const r = w.qb[k] as number;
      knockEnemy(w, r, knock, x, z, w.enemies.eliteTier[r] === 3);
    }
  }
}
