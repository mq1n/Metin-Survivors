import { afterEach, describe, expect, it, vi } from 'vitest';
import { SnapshotFlags, type Slot } from '@ms/shared';
import { AFFIX_KINDS, DEFAULT_AFFIXES, type ContentDB } from '../../data/schema';
import { makeBenchWorld } from '../../sim/__tests__/bench';
import { drainModals, typeOf } from '../../sim/__tests__/helpers';
import { botInput } from '../../sim/__tests__/bot';
import { spawnEnemy } from '../../sim/enemies';
import { AffixId, EnemyFlag, type PlayerInput } from '../../sim/stores';
import type { World } from '../../sim/world';
import { ByteReader, ByteWriter, DecodeError } from './bytes';
import { EventCollector, WireStrings } from './events';
import { CoopHarness } from './harness';
import { MemoryTransport } from './memoryRelay';
import type { CoopGuest } from './mirror';
import { affixOfPacked, ENEMY_COL, ENEMY_SPEC, EV, packTier, PICKUP_SPEC, SYNC_VERSION, TELE_SPEC, tierOfPacked, type PlayerAck } from './protocol';
import { MAX_WIRE_STRINGS, MAX_WIRE_STRING_BYTES, SnapshotDecoder, SnapshotEncoder, type EncodeOptions, type SnapshotStats } from './snapshot';
import { decodeTable, TableEncoder, TableState, type TableSpec } from './tables';

function acks(w: World): PlayerAck[] {
  return w.players.map((_, i) => ({ seq: i * 7, age: i, connected: true, hudVer: 1 }));
}

function frameOf(enc: SnapshotEncoder, o: EncodeOptions): { buf: ArrayBuffer; stats: SnapshotStats } {
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
  return { buf, stats: e.stats };
}

describe('table codec', () => {
  const spec: TableSpec = { name: 't', capacity: 300, widths: [2, 2, 1, 1, 2] };

  function fill(enc: TableEncoder, ents: Map<number, number[]>, prio = 0): void {
    enc.beginFrame();
    for (const [slot, v] of ents) {
      enc.cur.put(slot, v[5] as number);
      for (let c = 0; c < 5; c++) (enc.cur.cols[c] as Uint16Array)[slot] = v[c] as number;
      enc.prio[slot] = prio;
    }
  }

  it('round-trips random add / remove / update streams exactly (fuzz)', () => {
    let seed = 12345;
    const rnd = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const enc = new TableEncoder(spec);
    const dec = new TableState(spec);
    const w = new ByteWriter(64);
    const world = new Map<number, number[]>();
    for (let step = 0; step < 400; step++) {
      // mutate
      for (const [slot, v] of [...world]) {
        const r = rnd();
        if (r < 0.04) world.delete(slot);
        else if (r < 0.9) {
          const big = rnd() < 0.05;
          v[0] = Math.max(0, Math.min(65535, (v[0] as number) + Math.floor((rnd() - 0.5) * (big ? 900 : 120))));
          v[1] = Math.max(0, Math.min(65535, (v[1] as number) + Math.floor((rnd() - 0.5) * (big ? 900 : 120))));
          if (rnd() < 0.3) v[2] = Math.floor(rnd() * 256);
          if (rnd() < 0.1) v[3] = Math.floor(rnd() * 256);
          if (rnd() < 0.02) v[4] = Math.floor(rnd() * 65536);
        }
      }
      for (let k = 0; k < 6; k++) {
        const slot = Math.floor(rnd() * 300);
        if (!world.has(slot)) world.set(slot, [Math.floor(rnd() * 65536), Math.floor(rnd() * 65536), Math.floor(rnd() * 256), Math.floor(rnd() * 256), Math.floor(rnd() * 65536), slot | (Math.floor(rnd() * 32) << 11)]);
      }
      fill(enc, world, step % 3);
      const keyframe = step % 97 === 0;
      w.reset();
      enc.encode(w, keyframe, step, 1_000_000);
      decodeTable(new ByteReader(w.copy()), dec, keyframe);
      expect(dec.equals(enc.sent)).toBe(true);
      // with an unlimited budget and every priority due at most 3 snapshots late, the receiver converges to the truth
      if (step % 3 === 2 && !keyframe) {
        // updates for prio 1/2 slots only go out every 2nd/3rd snapshot; a full cycle of 6 flushes everything
      }
    }
    // settle: hold the world still for 6 snapshots → receiver == truth
    for (let i = 0; i < 6; i++) {
      fill(enc, world, 2);
      w.reset();
      enc.encode(w, false, 1000 + i, 1_000_000);
      decodeTable(new ByteReader(w.copy()), dec, false);
    }
    expect(dec.count).toBe(world.size);
    for (const [slot, v] of world) {
      expect(dec.present[slot]).toBe(1);
      for (let c = 0; c < 5; c++) expect((dec.cols[c] as Uint16Array)[slot]).toBe(v[c]);
    }
  });

  it('defers far updates first when the byte budget is tight, and converges later', () => {
    const enc = new TableEncoder(spec);
    const dec = new TableState(spec);
    const w = new ByteWriter(64);
    const world = new Map<number, number[]>();
    for (let s = 0; s < 200; s++) world.set(s, [1000 + s, 2000, 5, 6, 7, s]);
    fill(enc, world);
    w.reset();
    enc.encode(w, true, 0, 1e9);
    decodeTable(new ByteReader(w.copy()), dec, true);
    for (const v of world.values()) {
      v[0] = (v[0] as number) + 20;
      v[1] = (v[1] as number) + 20;
    }
    enc.beginFrame();
    for (const [slot, v] of world) {
      enc.cur.put(slot, v[5] as number);
      for (let c = 0; c < 5; c++) (enc.cur.cols[c] as Uint16Array)[slot] = v[c] as number;
      enc.prio[slot] = slot < 100 ? 0 : 2;
    }
    w.reset();
    const st = enc.encode(w, false, 0, 100 * 5);
    expect(st.deferred).toBeGreaterThan(0);
    decodeTable(new ByteReader(w.copy()), dec, false);
    // near entities were sent, far ones deferred (they are still at the old position on the receiver)
    expect((dec.cols[0] as Uint16Array)[0]).toBe(1020);
    expect((dec.cols[0] as Uint16Array)[199]).toBe(1000 + 199);
    // a later snapshot with budget catches up
    for (let i = 0; i < 3; i++) {
      w.reset();
      enc.encode(w, false, 1 + i, 1e9);
      decodeTable(new ByteReader(w.copy()), dec, false);
    }
    expect((dec.cols[0] as Uint16Array)[199]).toBe(1000 + 199 + 20);
  });

  it('rejects corrupt table data instead of hanging', () => {
    const dec = new TableState(spec);
    expect(() => decodeTable(new ByteReader(new Uint8Array([1, 250, 0, 0])), dec, false)).toThrow(DecodeError);
    expect(() => decodeTable(new ByteReader(new Uint8Array([0, 1, 0xff, 0xff])), dec, false)).toThrow(DecodeError);
    expect(() => decodeTable(new ByteReader(new Uint8Array([])), dec, false)).toThrow(DecodeError);
  });
});

describe('snapshot encoder → decoder on a live world', () => {
  it('keeps the receiver identical to the host `sent` state for 40 s of a 400-enemy fight, within budget', () => {
    const w = makeBenchWorld(400);
    const strings = new WireStrings();
    const enc = new SnapshotEncoder(w, strings);
    const dec = new SnapshotDecoder();
    const col = new EventCollector(strings);
    const inputs: PlayerInput[] = [{ moveX: 0, moveZ: 0 }];
    let n = 0;
    let maxBytes = 0;
    let maxDelta = 0;
    let sumDelta = 0;
    let deltas = 0;
    let enemiesMax = 0;
    for (let tick = 0; tick < 60 * 40; tick++) {
      drainModals(w);
      const input = botInput(w, tick);
      inputs[0] = input;
      w.step(inputs);
      col.collect(w.events);
      if (tick % 4 !== 3) continue;
      const keyframe = n === 0 || n % 150 === 0;
      const { buf, stats } = frameOf(enc, { keyframe, paused: false, final: false, acks: acks(w), hud: n % 8 === 0, events: col.flush() });
      const f = dec.decode(buf, 0);
      expect(f).not.toBeNull();
      expect(dec.enemies.equals(enc.enemies.sent)).toBe(true);
      expect(dec.projectiles.equals(enc.projectiles.sent)).toBe(true);
      expect(dec.pickups.equals(enc.pickups.sent)).toBe(true);
      expect(dec.telegraphs.equals(enc.telegraphs.sent)).toBe(true);
      expect(f?.tick).toBe(w.tick);
      expect(f?.players).toHaveLength(1);
      expect(buf.byteLength).toBeLessThan(48 * 1024);
      maxBytes = Math.max(maxBytes, buf.byteLength);
      if (!keyframe) {
        maxDelta = Math.max(maxDelta, buf.byteLength);
        sumDelta += buf.byteLength;
        deltas++;
      }
      enemiesMax = Math.max(enemiesMax, stats.enemies);
      n++;
    }
    expect(enemiesMax).toBeGreaterThan(150);
    expect(maxDelta).toBeLessThan(12_500);
    expect(maxBytes).toBeLessThan(32_000);
    // eslint-disable-next-line no-console
    console.log(`fight: enemies≤${enemiesMax} avg delta ${(sumDelta / deltas).toFixed(0)} B, max delta ${maxDelta} B, max keyframe ${maxBytes} B`);
    // 2 400 sim ticks with 400 enemies: ~1.5 s alone, but the default 5 s timeout tripped under a loaded full-suite run
  }, 60_000);

  it('a late joiner needs a keyframe; a gap in the sequence is detected', () => {
    const w = makeBenchWorld(60);
    const strings = new WireStrings();
    const enc = new SnapshotEncoder(w, strings);
    const col = new EventCollector(strings);
    const frames: ArrayBuffer[] = [];
    for (let i = 0; i < 6; i++) {
      for (let k = 0; k < 4; k++) {
        drainModals(w);
        w.step([{ moveX: 0, moveZ: 0 }]);
        col.collect(w.events);
      }
      frames.push(frameOf(enc, { keyframe: i === 0, paused: false, final: false, acks: acks(w), hud: false, events: col.flush() }).buf);
    }
    const late = new SnapshotDecoder();
    expect(late.decode(frames[3] as ArrayBuffer, 0)).toBeNull();
    expect(late.needKeyframe).toBe(true);
    const ok = new SnapshotDecoder();
    expect(ok.decode(frames[0] as ArrayBuffer, 0)).not.toBeNull();
    expect(ok.decode(frames[1] as ArrayBuffer, 0)).not.toBeNull();
    expect(ok.decode(frames[3] as ArrayBuffer, 0)).toBeNull(); // frame 2 missing
    expect(ok.needKeyframe).toBe(true);
    // keyframe flag really is set on the first frame only
    expect(new DataView(frames[0] as ArrayBuffer).getUint16(2, true) & SnapshotFlags.keyframe).toBeTruthy();
    expect(new DataView(frames[1] as ArrayBuffer).getUint16(2, true) & SnapshotFlags.keyframe).toBe(0);
  });

  it('survives random byte corruption without throwing anything but DecodeError', () => {
    const w = makeBenchWorld(80);
    const strings = new WireStrings();
    const enc = new SnapshotEncoder(w, strings);
    const col = new EventCollector(strings);
    for (let k = 0; k < 30; k++) {
      drainModals(w);
      w.step([{ moveX: 1, moveZ: 0 }]);
      col.collect(w.events);
    }
    const good = frameOf(enc, { keyframe: true, paused: false, final: false, acks: acks(w), hud: true, events: col.flush() }).buf;
    let seed = 99;
    const rnd = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    for (let i = 0; i < 300; i++) {
      const bad = good.slice(0);
      const u8 = new Uint8Array(bad);
      for (let k = 0; k < 1 + Math.floor(rnd() * 6); k++) u8[16 + Math.floor(rnd() * (u8.length - 16))] = Math.floor(rnd() * 256);
      const cut = rnd() < 0.3 ? bad.slice(0, 16 + Math.floor(rnd() * (bad.byteLength - 16))) : bad;
      const dec = new SnapshotDecoder();
      try {
        dec.decode(cut, 0);
      } catch (e) {
        expect(e).toBeInstanceOf(DecodeError);
      }
    }
  }, 60_000); // ~4 s alone (30 sim ticks of a bench world + 300 decodes): the 5 s default trips under a loaded full-suite run

  it('table specs stay within the 11-bit slot space', () => {
    expect(PICKUP_SPEC.capacity).toBeLessThanOrEqual(2048);
    expect(TELE_SPEC.capacity).toBeLessThanOrEqual(2048);
  });

  it('rejects the 49-byte keyframe with styleFrom = 0xfffffffe immediately without mutating styleNames (NET-03)', async () => {
    function buildRawFrame(flags: number, seq: number, writePayload: (w: ByteWriter) => void): ArrayBuffer {
      const pw = new ByteWriter(64);
      writePayload(pw);
      const payload = pw.copy();
      const buf = new ArrayBuffer(16 + payload.length);
      const v = new DataView(buf);
      v.setUint8(0, 1);
      v.setUint8(1, 1);
      v.setUint16(2, flags, true);
      v.setUint32(4, seq, true);
      v.setUint32(8, 60, true);
      v.setUint16(12, 1, true);
      v.setUint16(14, 0, true);
      new Uint8Array(buf, 16).set(payload);
      return buf;
    }

    function writeEmptyRest(w: ByteWriter): void {
      w.u8(0);
      w.u8(0);
      w.u8(0); // world
      w.u8(0); // players
      w.u8(0); // modals
      for (let t = 0; t < 4; t++) {
        w.varuint(0);
        w.varuint(0);
        w.varuint(0);
      }
      w.u8(0); // metins
      w.u8(0); // bosses
      w.u8(0); // hud
      w.varuint(0); // eventCount
      w.varuint(0); // eventLen
    }

    // Exact 49-byte malicious keyframe: styleFrom = 0xfffffffe, nStyle = 1, "x", empty wireNames + empty rest.
    const malicious49 = buildRawFrame(SnapshotFlags.keyframe, 1, (w) => {
      w.varuint(0xfffffffe);
      w.varuint(1);
      w.str('x');
      w.varuint(0);
      w.varuint(0);
      writeEmptyRest(w);
    });
    expect(malicious49.byteLength).toBe(49);

    // Seed a decoder with a legitimate keyframe containing 2 styles first.
    const seedKey = buildRawFrame(SnapshotFlags.keyframe, 0, (w) => {
      w.varuint(0);
      w.varuint(2);
      w.str('st.a');
      w.str('st.b');
      w.varuint(0);
      w.varuint(1);
      w.str('w.0');
      writeEmptyRest(w);
    });
    const dec = new SnapshotDecoder();
    expect(dec.decode(seedKey, 0)).not.toBeNull();
    expect(dec.styleNames).toEqual(['st.a', 'st.b']);
    expect(dec.wireNames).toEqual(['w.0']);

    // 1. Feed the 49-byte styleFrom=0xfffffffe keyframe directly into SnapshotDecoder.
    expect(() => dec.decode(malicious49, 10)).toThrow(DecodeError);
    expect(dec.styleNames).toEqual(['st.a', 'st.b']);
    expect(dec.wireNames).toEqual(['w.0']);
    expect(dec.needKeyframe).toBe(true);

    // 2. Re-seed and test a sparse delta offset (gap: styleFrom !== styleNames.length).
    expect(dec.decode(seedKey, 20)).not.toBeNull();
    const sparseDelta = buildRawFrame(SnapshotFlags.delta, 1, (w) => {
      w.varuint(5); // gap: expected 2
      w.varuint(1);
      w.str('st.gap');
      w.varuint(1);
      w.varuint(0);
      writeEmptyRest(w);
    });
    expect(() => dec.decode(sparseDelta, 30)).toThrow(DecodeError);
    expect(dec.styleNames).toEqual(['st.a', 'st.b']);

    // 3. Re-seed and test nonzero wireFrom on keyframe: MUST NOT mutate styleNames either!
    expect(dec.decode(seedKey, 40)).not.toBeNull();
    const badWireKey = buildRawFrame(SnapshotFlags.keyframe, 2, (w) => {
      w.varuint(0);
      w.varuint(1);
      w.str('should.not.commit');
      w.varuint(0xfffffffe);
      w.varuint(1);
      w.str('y');
      writeEmptyRest(w);
    });
    expect(() => dec.decode(badWireKey, 50)).toThrow(DecodeError);
    expect(dec.styleNames).toEqual(['st.a', 'st.b']);
    expect(dec.wireNames).toEqual(['w.0']);

    // 4. Cap total entries (> MAX_WIRE_STRINGS) and total bytes (> MAX_WIRE_STRING_BYTES) before mutating state.
    expect(dec.decode(seedKey, 60)).not.toBeNull();
    const tooMany = buildRawFrame(SnapshotFlags.keyframe, 3, (w) => {
      w.varuint(0);
      w.varuint(MAX_WIRE_STRINGS + 1);
      writeEmptyRest(w);
    });
    expect(() => dec.decode(tooMany, 70)).toThrow(DecodeError);
    expect(dec.styleNames).toEqual(['st.a', 'st.b']);

    expect(dec.decode(seedKey, 80)).not.toBeNull();
    const chunk = 'a'.repeat(16 * 1024);
    const nChunks = Math.floor(MAX_WIRE_STRING_BYTES / chunk.length) + 1;
    const tooManyBytes = buildRawFrame(SnapshotFlags.keyframe, 4, (w) => {
      w.varuint(0);
      w.varuint(nChunks);
      for (let i = 0; i < nChunks; i++) w.str(chunk);
      w.varuint(0);
      w.varuint(0);
      writeEmptyRest(w);
    });
    expect(() => dec.decode(tooManyBytes, 90)).toThrow(DecodeError);
    expect(dec.styleNames).toEqual(['st.a', 'st.b']);

    // 5. Feed the exact 49-byte frame through a real CoopGuest over CoopHarness and verify bounded rejection & responsiveness.
    const harness = await CoopHarness.create({ guests: 1, latencyMs: 10, enemies: 0, tough: true });
    try {
      for (let i = 0; i < 30; i++) harness.tick();
      const guest = harness.guests[0] as CoopGuest;
      const stylesBefore = guest.decoder.styleNames.length;
      const worldStylesBefore = guest.world.strings.names.length;
      const errorsBefore = guest.stats.decodeErrors;
      // Inject the 49-byte frame directly as a host snapshot on the guest transport.
      const maliciousForGuest = malicious49.slice(0);
      new DataView(maliciousForGuest).setUint16(12, harness.transports[1]!.epoch, true);
      harness.transports[0]!.sendSnapshot(
        { flags: SnapshotFlags.keyframe, seq: 9999, tick: 9999, baseDelta: 0 },
        new Uint8Array(maliciousForGuest, 16),
      );
      for (let i = 0; i < 20; i++) harness.tick();
      expect(guest.stats.decodeErrors).toBeGreaterThan(errorsBefore);
      expect(guest.decoder.styleNames.length).toBeLessThan(MAX_WIRE_STRINGS);
      expect(guest.world.strings.names.length).toBeLessThan(MAX_WIRE_STRINGS);
      expect(guest.decoder.styleNames.length).toBe(stylesBefore);
      expect(guest.world.strings.names.length).toBe(worldStylesBefore);
    } finally {
      harness.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// EL-01: the elite affix rides the enemy tier byte (tier | affix << 4)

function affixContent(c: ContentDB): void {
  c.affixes = { ...structuredClone(DEFAULT_AFFIXES), enabled: true };
}

describe('elite affix in the enemy tier byte (EL-01)', () => {
  it('packTier keeps the tier (low nibble) and the affix (high nibble) apart for every pair', () => {
    for (let tier = 0; tier < 16; tier++) {
      for (let affix = 0; affix < 16; affix++) {
        const b = packTier(tier, affix);
        expect(b).toBeLessThan(256);
        expect(tierOfPacked(b)).toBe(tier);
        expect(affixOfPacked(b)).toBe(affix);
      }
    }
    // plain rows keep the byte the old protocol sent
    for (let tier = 0; tier < 4; tier++) expect(packTier(tier, 0)).toBe(tier);
    expect(ENEMY_SPEC.widths[ENEMY_COL.tier]).toBe(1); // still one byte: the layout did not change
    expect(AFFIX_KINDS.length).toBeLessThan(16);
  });

  it('a live world ships tier | affix << 4 for every row and the decoder holds the same bytes', () => {
    const w = makeBenchWorld(80);
    const strings = new WireStrings();
    const enc = new SnapshotEncoder(w, strings);
    const dec = new SnapshotDecoder();
    const col = new EventCollector(strings);
    const ti = typeOf(w, 'alpha_wolf');
    const hero = w.players[0] as { x: number; z: number };
    const born = new Map<number, { tier: number; affix: number }>();
    let n = 0;
    let checked = 0;
    for (let tick = 0; tick < 60 * 12; tick++) {
      drainModals(w);
      if (tick % 45 === 0) {
        // a mix of plain, affixed and other-tier rows around the hero
        const k = tick / 45;
        const tier = [1, 1, 1, 1, 2, 3, 1][k % 7] as number;
        const affix = tier === 1 ? k % 5 : 0;
        const row = spawnEnemy(w, ti, hero.x + 4 + (tick % 7) * 0.3, hero.z + 3, { tier, affix, spawnTime: 0 });
        if (row >= 0) born.set(w.enemies.id[row] as number, { tier, affix });
      }
      w.step([botInput(w, tick)]);
      col.collect(w.events);
      if (tick % 4 !== 3) continue;
      const keyframe = n === 0 || n % 150 === 0;
      const { buf } = frameOf(enc, { keyframe, paused: false, final: false, acks: acks(w), hud: n % 8 === 0, events: col.flush() });
      expect(dec.decode(buf, 0)).not.toBeNull();
      expect(dec.enemies.equals(enc.enemies.sent)).toBe(true);
      n++;
      const E = w.enemies;
      for (let i = 0; i < E.count; i++) {
        if (((E.flags[i] as number) & EnemyFlag.Metin) !== 0) continue;
        const slot = (E.id[i] as number) & 0xffff;
        if (dec.enemies.present[slot] !== 1 || dec.enemies.id[slot] !== (enc.enemies.sent.id[slot] as number)) continue; // outside the interest radius
        const byte = (dec.enemies.cols[ENEMY_COL.tier] as Uint16Array)[slot] as number;
        // tier and affix never change on a live row, so the byte on the wire is the host row's
        expect(byte).toBe(packTier(E.eliteTier[i] as number, E.affix[i] as number));
        const b = born.get(E.id[i] as number);
        if (b) {
          expect(tierOfPacked(byte)).toBe(b.tier);
          expect(affixOfPacked(byte)).toBe(b.affix);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(8);
    expect([...born.values()].some((b) => b.affix >= 1)).toBe(true);
  }, 60_000);
});

describe('elite affix on the co-op mirror (EL-01)', () => {
  let h: CoopHarness | null = null;
  afterEach(() => {
    h?.dispose();
    h = null;
    vi.restoreAllMocks();
  });

  function run(n: number): void {
    for (let i = 0; i < n; i++) (h as CoopHarness).tick();
  }

  /** (tier/affix) of every elite-ish row of a world, sorted */
  function pairs(w: World): string[] {
    const E = w.enemies;
    const out: string[] = [];
    for (let i = 0; i < E.count; i++) if ((E.eliteTier[i] as number) > 0) out.push(`${E.eliteTier[i]}/${E.affix[i]}`);
    return out.sort();
  }

  it('the guest unpacks tier and affix of the host rows, also after a resync keyframe', async () => {
    h = await CoopHarness.create({ guests: 1, latencyMs: 30, enemies: 0, tough: true, content: affixContent });
    const hw = h.hostWorld;
    const gw = h.guestWorlds[0] as World;
    run(60);
    const ti = typeOf(hw, 'alpha_wolf');
    const hero = hw.players[0] as { x: number; z: number };
    // pinned and invulnerable, so the hero's skills leave them alone and the rows hold still
    const flags = EnemyFlag.Pinned | EnemyFlag.Invuln;
    const want: [number, number][] = [
      [1, AffixId.Swift],
      [1, AffixId.Vampiric],
      [1, AffixId.Warded],
      [1, AffixId.Splitting],
      [1, 0],
      [2, 0],
      [3, 0],
    ];
    for (const [i, [tier, affix]] of want.entries()) {
      const row = spawnEnemy(hw, ti, hero.x + 5 + i * 0.9, hero.z + (i % 2 ? 4 : -4), { tier, affix, spawnTime: 0, speedMul: 0, flags });
      expect(row).toBeGreaterThanOrEqual(0);
    }
    run(120);
    const expected = want.map(([t, a]) => `${t}/${a}`).sort();
    expect(pairs(hw)).toEqual(expected);
    expect(pairs(gw)).toEqual(expected);
    // nothing leaks between the nibbles: a guest tier is 0..3
    const E = gw.enemies;
    for (let i = 0; i < E.count; i++) expect(E.eliteTier[i]).toBeLessThanOrEqual(3);
    // the guest drops and comes back: the resync keyframe carries the same bytes
    await h.reconnect(1);
    run(240);
    expect(pairs(h.guestWorlds[0] as World)).toEqual(expected);
  }, 60_000);

  it('affixes off: the guest sees a plain elite and no affix', async () => {
    h = await CoopHarness.create({ guests: 1, latencyMs: 30, enemies: 0, tough: true });
    const hw = h.hostWorld;
    run(30);
    const hero = hw.players[0] as { x: number; z: number };
    spawnEnemy(hw, typeOf(hw, 'alpha_wolf'), hero.x + 5, hero.z + 4, { tier: 1, spawnTime: 0, speedMul: 0, flags: EnemyFlag.Pinned | EnemyFlag.Invuln });
    run(90);
    expect(pairs(h.guestWorlds[0] as World)).toEqual(['1/0']);
  }, 60_000);

  it('the host announces SYNC_VERSION 2, and a guest refuses an init of the old version with "protocol"', async () => {
    const sent: { k: string; d: unknown }[] = [];
    const orig = MemoryTransport.prototype.event;
    vi.spyOn(MemoryTransport.prototype, 'event').mockImplementation(function (this: MemoryTransport, k, d, opts) {
      sent.push({ k, d });
      return orig.call(this, k, d, opts);
    });
    h = await CoopHarness.create({ guests: 1, latencyMs: 30, enemies: 0, tough: true });
    expect(SYNC_VERSION).toBe(2);
    const guest = h.guests[0] as CoopGuest;
    run(30);
    await h.settle(100);
    const init = sent.find((m) => m.k === EV.init);
    expect(init).toBeDefined();
    expect((init?.d as { v: number }).v).toBe(SYNC_VERSION);
    expect(guest.error).toBeNull();
    expect(guest.phase).not.toBe('disconnected');
    // a v1 host (it sends the tier byte unpacked): its init says v 1
    const slot = (h.transports[1] as MemoryTransport).slot as Slot;
    expect(h.transports[0]?.event(EV.init, { v: SYNC_VERSION - 1, fp: 'whatever' }, { to: slot })).toBe(true);
    await h.settle(100);
    expect(guest.error).toBe('protocol');
    expect(guest.phase).toBe('disconnected');
  }, 60_000);

  it('the same version with another content fingerprint is a content mismatch, not a protocol error', async () => {
    h = await CoopHarness.create({ guests: 1, latencyMs: 30, enemies: 0, tough: true });
    const guest = h.guests[0] as CoopGuest;
    run(10);
    const slot = (h.transports[1] as MemoryTransport).slot as Slot;
    h.transports[0]?.event(EV.init, { v: SYNC_VERSION, fp: 'another-build' }, { to: slot });
    await h.settle(100);
    expect(guest.error).toBe('contentMismatch');
  }, 60_000);
});
