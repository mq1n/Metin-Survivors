// Skill-logic M2 on the wire (DESIGN §4): no new wire field - a skill ward rides PlayerWire.shield (shield + ward) and the shell looks
// ride the mirrored projectile table as Marker rows.

import { describe, expect, it } from 'vitest';
import type { SkillDef } from '../../data/schema';
import { castNow } from '../../sim/skills';
import { clearEnemies, dropSkills, freezeSchedules, giveSkill, makeWorld, player } from '../../sim/__tests__/helpers';
import { ProjKind } from '../../sim/stores';
import { WireStrings } from './events';
import { PROJ_COL, type PlayerAck } from './protocol';
import { SnapshotDecoder, SnapshotEncoder } from './snapshot';

function frame(enc: SnapshotEncoder, acks: PlayerAck[]): ArrayBuffer {
  const e = enc.encode({ keyframe: true, paused: false, final: false, acks, hud: false, events: { count: 0, bytes: new Uint8Array(0), dropped: 0 } });
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

describe('hero shells on the wire', () => {
  it('PlayerWire.shield = trinket shield + ward, and the ward marker row round-trips as a Marker', () => {
    const w = makeWorld({
      content: (c) => {
        const d = c.skills.find((x) => x.id === 'will_to_live') as SkillDef;
        d.params = { ...d.params, heal: 0, buff: undefined, shield: 10, duration: 8, burst: 4, power: 100, damage: 24, area: 2.2 };
        d.trigger = { any: ['engaged'] };
      },
    });
    freezeSchedules(w);
    clearEnemies(w);
    dropSkills(w, 0);
    const p = player(w);
    p.hpMax = p.hp = 120;
    const s = giveSkill(w, 'will_to_live');
    s.cd = 0;
    expect(castNow(w, p, s)).toBe(true);
    p.shield = 3;
    expect(p.ward).toBeCloseTo(12, 5);

    const strings = new WireStrings();
    const enc = new SnapshotEncoder(w, strings);
    const dec = new SnapshotDecoder();
    const f = dec.decode(frame(enc, [{ seq: 0, age: 0, connected: true, hudVer: 1 }]), 0);
    expect(f).not.toBeNull();
    expect(f?.players[0]?.shield).toBe(15);

    // the marker row of the ward is in the table: kind Marker, the interned style id, a positive look scale
    const T = dec.projectiles;
    let found = 0;
    for (let slot = 0; slot < T.present.length; slot++) {
      if (T.present[slot] === 0) continue;
      expect((T.cols[PROJ_COL.kind] as Uint16Array)[slot]! & 0x7f).toBe(ProjKind.Marker);
      expect((T.cols[PROJ_COL.style] as Uint16Array)[slot]).toBe(w.strings.id('sk.will_to_live.loop'));
      expect((T.cols[PROJ_COL.radius] as Uint16Array)[slot]).toBeGreaterThan(0);
      found++;
    }
    expect(found).toBe(1);
  });
});
