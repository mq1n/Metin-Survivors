// Skill-logic WP5 on the wire, with the SHIPPED content: a co-op host runs shell + companion kits, the snapshot encoder/decoder mirror it
// (marker rows, orbiter / pylon / knight / coil / clone rows, twin bolts), the style ids of every `sk.*` row resolve on the guest, and
// PlayerWire.shield = shield + ward for every hero. No new wire field.

import { describe, expect, it } from 'vitest';
import { botInput } from '../../sim/__tests__/bot';
import { drainModals } from '../../sim/__tests__/helpers';
import { PARTNER, hero, only, realWorld } from '../../sim/__tests__/skillLab';
import { ProjKind } from '../../sim/stores';
import type { World } from '../../sim/world';
import { EventCollector, WireStrings } from './events';
import { PROJ_COL, type PlayerAck } from './protocol';
import { SnapshotDecoder, SnapshotEncoder, type EncodeOptions } from './snapshot';

function acks(w: World): PlayerAck[] {
  return w.players.map((_, i) => ({ seq: i, age: 0, connected: true, hudVer: 1 }));
}

function frameOf(enc: SnapshotEncoder, o: EncodeOptions): ArrayBuffer {
  const e = enc.encode(o);
  const buf = new ArrayBuffer(16 + e.payload.length);
  const v = new DataView(buf);
  v.setUint8(0, 1);
  v.setUint8(1, 1);
  v.setUint16(2, e.header.flags, true);
  v.setUint32(4, e.header.seq, true);
  v.setUint32(8, e.header.tick, true);
  v.setUint16(14, e.header.baseDelta, true);
  new Uint8Array(buf, 16).set(e.payload);
  return buf;
}

describe('shipped shells and companions on the wire (co-op, 45 s of a live run)', () => {
  it('the guest mirror equals the host sent state every snapshot; shields = shield + ward; every sk.* row has a resolvable style', () => {
    const w = realWorld({ classId: 'shaman', doctrine: 'b', coop: [PARTNER], live: true, seed: 8, stats: { armor: 60, regen: 4, maxHpPct: 2 } });
    only(w, ['stormglass_shell', 'thunder_guardians', 'tailwind', 'surging_arms'], 1, 0);
    only(w, ['graniteform', 'cursed_legion', 'warfever'], 1, 1);
    const strings = new WireStrings();
    const enc = new SnapshotEncoder(w, strings);
    const dec = new SnapshotDecoder();
    const col = new EventCollector(strings);
    let n = 0;
    let wardFrames = 0;
    let markerRows = 0;
    const kindsSeen = new Set<number>();
    const stylesSeen = new Set<string>();
    for (let tick = 0; tick < 45 * 60 && !w.over; tick++) {
      drainModals(w);
      w.step([botInput(w, tick), { moveX: Math.cos(tick * 0.02), moveZ: Math.sin(tick * 0.02) }]);
      col.collect(w.events);
      if (tick % 4 !== 3) continue;
      const keyframe = n === 0 || n % 100 === 0;
      const buf = frameOf(enc, { keyframe, paused: false, final: false, acks: acks(w), hud: n % 8 === 0, events: col.flush() });
      const f = dec.decode(buf, 0);
      expect(f, 'decoded').not.toBeNull();
      expect(dec.projectiles.equals(enc.projectiles.sent)).toBe(true);
      expect(dec.enemies.equals(enc.enemies.sent)).toBe(true);
      for (let i = 0; i < w.players.length; i++) {
        const p = w.players[i];
        const q = f?.players[i];
        expect(q, `player ${i}`).toBeDefined();
        // the shield on the wire is the trinket shield plus the ward (float32 / quantised: half a point of slack)
        expect(q?.shield as number, `player ${i} shield+ward`).toBeGreaterThanOrEqual(((p?.shield ?? 0) + (p?.ward ?? 0)) - 0.6);
        expect(q?.shield as number).toBeLessThanOrEqual(((p?.shield ?? 0) + (p?.ward ?? 0)) + 0.6);
        if ((p?.ward ?? 0) > 1) wardFrames++;
      }
      const T = dec.projectiles;
      for (let slot = 0; slot < T.present.length; slot++) {
        if (T.present[slot] === 0) continue;
        const kind = (T.cols[PROJ_COL.kind] as Uint16Array)[slot]! & 0x7f;
        kindsSeen.add(kind);
        const style = dec.styleNames[(T.cols[PROJ_COL.style] as Uint16Array)[slot] as number];
        expect(style, 'the style id resolves on the guest').toBeDefined();
        if (kind === ProjKind.Marker) {
          markerRows++;
          expect(style?.startsWith('sk.'), `marker style '${style}'`).toBe(true);
          expect((T.cols[PROJ_COL.radius] as Uint16Array)[slot]).toBeGreaterThan(0);
        }
        if (style?.startsWith('sk.')) stylesSeen.add(style);
      }
      n++;
    }
    expect(wardFrames, 'at least one ward was on the wire').toBeGreaterThan(0);
    expect(markerRows, 'marker rows reached the guest').toBeGreaterThan(0);
    expect(kindsSeen.has(ProjKind.Marker)).toBe(true);
    expect(kindsSeen.has(ProjKind.Familiar), 'idols / knights / spirits are Familiar rows').toBe(true);
    expect([...stylesSeen].some((s) => s.endsWith('.loop')), 'a shell loop look').toBe(true);
    void hero;
  }, 60_000);

  it('a late joiner (keyframe) gets the standing markers and companions at once', () => {
    const w = realWorld({ classId: 'yacha', doctrine: 'a', live: true, seed: 3, stats: { armor: 300, regen: 8 } });
    only(w, ['umbral_plate', 'cursed_legion', 'chilling_dread'], 1);
    w.qaForceTriggers = true;
    for (let tick = 0; tick < 240; tick++) {
      drainModals(w);
      w.step([botInput(w, tick)]);
    }
    w.qaForceTriggers = false;
    const strings = new WireStrings();
    const enc = new SnapshotEncoder(w, strings);
    const dec = new SnapshotDecoder();
    const buf = frameOf(enc, { keyframe: true, paused: false, final: false, acks: acks(w), hud: true, events: { count: 0, bytes: new Uint8Array(0), dropped: 0 } });
    expect(dec.decode(buf, 0)).not.toBeNull();
    const T = dec.projectiles;
    let markers = 0;
    let fam = 0;
    for (let slot = 0; slot < T.present.length; slot++) {
      if (T.present[slot] === 0) continue;
      const kind = (T.cols[PROJ_COL.kind] as Uint16Array)[slot]! & 0x7f;
      if (kind === ProjKind.Marker) markers++;
      if (kind === ProjKind.Familiar) fam++;
    }
    expect(markers + fam, 'the shell loop and the knights are mirrored').toBeGreaterThan(0);
    expect(hero(w).ward).toBeGreaterThan(0);
  });
});
