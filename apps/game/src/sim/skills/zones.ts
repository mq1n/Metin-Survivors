// Zone system: skill zones (ground, spin, aura, beam, strike, shockwave) and hostile hazards (ground, fire ring).

import { hitEnemy, hurtPlayer, HurtKind } from '../combat';
import { DT, PLAYER_RADIUS } from '../constants';
import { ProjKind, ZoneKind, type PlayerState } from '../stores';
import type { World } from '../world';
import { beginHit, explodeAt, stampHit } from './common';
import { creditMimicSlot } from './companions';

const TAU = Math.PI * 2;
const RING_BLOBS = 6;

export function updateZones(w: World): void {
  const Z = w.zones;
  for (let i = Z.count - 1; i >= 0; i--) {
    Z.px[i] = Z.x[i] as number;
    Z.pz[i] = Z.z[i] as number;
    const follow = Z.follow[i] as number;
    if (follow !== 0) {
      const p = w.players[follow - 1];
      if (!p || !p.alive) {
        Z.free(i);
        continue;
      }
      Z.x[i] = p.x;
      Z.z[i] = p.z;
    }
    const t = (Z.t[i] as number) + DT;
    Z.t[i] = t;
    if (t >= (Z.dur[i] as number)) {
      endZone(w, i);
      Z.free(i);
      continue;
    }
    if (Z.team[i] === 0) friendlyZone(w, i);
    else hostileZone(w, i);
  }
}

function endZone(w: World, i: number): void {
  const Z = w.zones;
  if (Z.team[i] !== 0 || Z.kind[i] !== ZoneKind.Circle) return;
  const s = w.skillSlots[Z.skill[i] as number];
  const p = w.players[Z.owner[i] as number];
  if (!s || !p) return;
  const mul = Z.mul[i] as number;
  const credit = Z.credit[i] as number;
  const dmg0 = s.damage;
  explodeAt(w, p, s, s.fp, Z.x[i] as number, Z.z[i] as number, mul || 1);
  if (credit > 0 || mul > 0) creditMimicSlot(w, p, s, credit, mul, s.damage - dmg0);
}

function friendlyZone(w: World, i: number): void {
  const Z = w.zones;
  const s = w.skillSlots[Z.skill[i] as number];
  const p = w.players[Z.owner[i] as number];
  if (!s || !p) {
    Z.dur[i] = 0;
    return;
  }
  const e = w.enemies;
  const kind = Z.kind[i] as number;
  const t = Z.t[i] as number;
  const x = Z.x[i] as number;
  const z = Z.z[i] as number;
  const mul = Z.mul[i] as number;
  const credit = Z.credit[i] as number;

  if (kind === ZoneKind.Strike) {
    if (Z.aux[i] === 0 && t >= (Z.delay[i] as number)) {
      Z.aux[i] = 1;
      const radius = Z.radius[i] as number;
      const n = w.hash.queryCircle(e, x, z, radius, w.qa);
      const dmg0 = s.damage;
      const c = beginHit(p, s, s.fp, x, z);
      c.knock = Z.knock[i] as number;
      for (let k = 0; k < n; k++) hitEnemy(w, w.qa[k] as number, Z.damage[i] as number, c);
      w.bus.vfx(s.def.vfx, x, z, 0, 1, radius, 0.4, Z.element[i] as number);
      w.bus.shake(0.12, 0.15);
      explodeAt(w, p, s, s.fp, x, z, mul || 1);
      if (credit > 0 || mul > 0) creditMimicSlot(w, p, s, credit, mul, s.damage - dmg0);
    }
    return;
  }

  if (kind === ZoneKind.Shock) {
    const expand = Math.max(0.05, Z.aux[i] as number);
    const full = Z.radius[i] as number;
    const r = full * Math.min(1, t / expand);
    const rPrev = full * Math.min(1, Math.max(0, t - DT) / expand);
    const n = w.hash.queryCircle(e, x, z, r, w.qa);
    if (n === 0) return;
    const dmg0 = s.damage;
    const c = beginHit(p, s, s.fp, x, z);
    c.knock = Z.knock[i] as number;
    for (let k = 0; k < n; k++) {
      const row = w.qa[k] as number;
      // only enemies the front passed this tick (everything inside on the very first tick); the short stamp stops a shoved
      // enemy from being caught twice by the same front while still letting an awakened echo wave hit again
      const edge = Math.hypot((e.x[row] as number) - x, (e.z[row] as number) - z) - (e.radius[row] as number);
      if (t > DT * 1.5 && edge <= rPrev) continue;
      if (stampHit(w, row, s.slot, 0.35)) hitEnemy(w, row, Z.damage[i] as number, c);
    }
    if (credit > 0 || mul > 0) creditMimicSlot(w, p, s, credit, mul, s.damage - dmg0);
    return;
  }

  // Dispel sigil (purge > 0): hostile bolts that enter it dissolve, creatures inside are stamped (below, each tick of the zone)
  const purge = kind === ZoneKind.Circle ? s.fp.purge : 0;
  if (purge > 0) dissolveBolts(w, x, z, Z.radius[i] as number);

  // ticking kinds: Circle, Spin, Aura, Beam
  if (kind === ZoneKind.Beam) steerBeam(w, i, p);
  const tick = Math.max(0.08, Z.tick[i] as number);
  const tickT = (Z.tickT[i] as number) - DT;
  if (tickT > 0) {
    Z.tickT[i] = tickT;
    return;
  }
  Z.tickT[i] = tickT + tick;
  const fp = s.fp;
  // a mimic copy of a zone carries its own damage scale (ZoneStore.mul, 0 = unset)
  const damage = fp.damage * (mul || 1);
  const dmg0 = s.damage;
  const c = beginHit(p, s, fp, x, z);
  c.knock = Z.knock[i] as number;
  if (kind === ZoneKind.Beam) {
    const length = Z.length[i] as number;
    const half = (Z.radius[i] as number) / 2;
    const rot = Z.rot[i] as number;
    const dx = Math.sin(rot);
    const dz = Math.cos(rot);
    const n = w.hash.queryCircle(e, x, z, length + 1, w.qa);
    for (let k = 0; k < n; k++) {
      const row = w.qa[k] as number;
      const vx = (e.x[row] as number) - x;
      const vz = (e.z[row] as number) - z;
      const f = vx * dx + vz * dz;
      if (f < -0.5 || f > length + (e.radius[row] as number)) continue;
      const lat = Math.abs(vx * dz - vz * dx);
      if (lat > half + (e.radius[row] as number)) continue;
      if (stampHit(w, row, s.slot, tick * 0.9)) hitEnemy(w, row, damage, c);
    }
    if (credit > 0 || mul > 0) creditMimicSlot(w, p, s, credit, mul, s.damage - dmg0);
    return;
  }
  if (purge > 0) {
    // purged creatures lose metin corruption and shadow flicker (metins.corruptionPass reads purgedUntil); a phased-out
    // flicker creature is purged too, hence includeInvuln
    const m = w.hash.queryCircle(e, x, z, Z.radius[i] as number, w.qb, true);
    const until = w.time + purge;
    let popped = 0;
    for (let k = 0; k < m; k++) {
      const row = w.qb[k] as number;
      // vfx: a creature stripped for the first time (its previous purge ran out) pops the unbinding glyph, at most PURGE_FX_CAP a tick
      if (popped < PURGE_FX_CAP && (e.purgedUntil[row] as number) < w.time) {
        popped++;
        w.bus.vfx('sk.unbinding_sigil.purge', e.x[row] as number, e.z[row] as number, 0, 1, 1, 0.3, 4);
      }
      e.purgedUntil[row] = until;
    }
  }
  const n = w.hash.queryCircle(e, x, z, Z.radius[i] as number, w.qa);
  for (let k = 0; k < n; k++) {
    const row = w.qa[k] as number;
    if (stampHit(w, row, s.slot, tick * 0.9)) hitEnemy(w, row, damage, c);
  }
  if (credit > 0 || mul > 0) creditMimicSlot(w, p, s, credit, mul, s.damage - dmg0); // a copied zone's ticks book on the clone
}

/** free every hostile bolt inside the circle (Dispel) */
const PURGE_FX_CAP = 4;
function dissolveBolts(w: World, x: number, z: number, radius: number): void {
  const P = w.projectiles;
  let fx = 0;
  for (let k = P.count - 1; k >= 0; k--) {
    if (P.kind[k] !== ProjKind.Hostile) continue;
    const dx = (P.x[k] as number) - x;
    const dz = (P.z[k] as number) - z;
    const rr = radius + (P.radius[k] as number);
    if (dx * dx + dz * dz <= rr * rr) {
      // vfx (critic: the purge had no look): a small violet-white unbinding pop where the bolt dissolved, at most PURGE_FX_CAP a call
      if (fx < PURGE_FX_CAP) {
        fx++;
        w.bus.vfx('sk.unbinding_sigil.purge', P.x[k] as number, P.z[k] as number, 0, 1, 1, 0.3, 4);
      }
      P.free(k);
    }
  }
}

/** turn the beam toward cursor aim (in manual mode) or the nearest enemy at a limited rate */
function steerBeam(w: World, i: number, p: PlayerState): void {
  const Z = w.zones;
  let want: number;
  if (p.manualCast) {
    if (!p.hasAim) return;
    want = Math.atan2(p.aimX, p.aimZ);
  } else {
    const e = w.enemies;
    const row = w.hash.nearest(e, p.x, p.z, Z.length[i] as number);
    if (row < 0) return;
    want = Math.atan2((e.x[row] as number) - p.x, (e.z[row] as number) - p.z);
  }
  const cur = Z.rot[i] as number;
  let d = want - cur;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  const rate = (Z.aux[i] as number) * DT;
  Z.rot[i] = cur + Math.max(-rate, Math.min(rate, d));
}

function hostileZone(w: World, i: number): void {
  const Z = w.zones;
  const kind = Z.kind[i] as number;
  const tick = Math.max(0.1, Z.tick[i] as number);
  const t = Z.t[i] as number;
  const x = Z.x[i] as number;
  const z = Z.z[i] as number;
  const radius = Z.radius[i] as number;
  const slow = Z.aux[i] as number;
  const players = w.players;
  if (kind === ZoneKind.FireRing) {
    const blob = Z.length[i] as number;
    const spin = t * 1.1;
    const tickT = (Z.tickT[i] as number) - DT;
    const fire = tickT <= 0;
    Z.tickT[i] = fire ? tickT + tick : tickT;
    for (let pi = 0; pi < players.length; pi++) {
      const p = players[pi];
      if (!p || !p.alive) continue;
      for (let b = 0; b < RING_BLOBS; b++) {
        const a = spin + (b / RING_BLOBS) * TAU;
        const bx = x + Math.sin(a) * radius;
        const bz = z + Math.cos(a) * radius;
        const dx = p.x - bx;
        const dz = p.z - bz;
        const rr = blob + PLAYER_RADIUS;
        if (dx * dx + dz * dz <= rr * rr) {
          if (fire) hurtPlayer(w, pi, Z.damage[i] as number, bx, bz, Z.element[i] as number, HurtKind.Hazard);
          break;
        }
      }
    }
    return;
  }
  const tickT = (Z.tickT[i] as number) - DT;
  const fire = tickT <= 0;
  Z.tickT[i] = fire ? tickT + tick : tickT;
  for (let pi = 0; pi < players.length; pi++) {
    const p = players[pi];
    if (!p || !p.alive) continue;
    const dx = p.x - x;
    const dz = p.z - z;
    const rr = radius + PLAYER_RADIUS;
    if (dx * dx + dz * dz > rr * rr) continue;
    if (slow > 0) p.slowMul = Math.min(p.slowMul, 1 - slow);
    if (fire && (Z.damage[i] as number) > 0) hurtPlayer(w, pi, Z.damage[i] as number, x, z, Z.element[i] as number, HurtKind.Hazard);
  }
}
