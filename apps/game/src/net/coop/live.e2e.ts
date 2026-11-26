// Live co-op check against a real relay: `wrangler dev --local` (workers/api, port 8686) + two (or more) real CoopTransport
// WebSocket clients in this process, each running the production host / guest sync classes on fixture content.
//   cd workers/api && bunx wrangler dev --local --port 8686 --persist-to .wrangler/coop-state
//   cd apps/game   && bun run src/net/coop/live.e2e.ts [seconds=45] [guests=1]
// Not a vitest test (needs the dev server); prints a bandwidth / latency / prediction report and exits non-zero on failures.

import type { Loadout, ZoneId } from '@ms/shared';
import { runEvents } from '../../app/runEvents';
import { cloneContent, FIXTURE_ZONE_ID } from '../../sim/__fixtures__/content';
import { botInput } from '../../sim/__tests__/bot';
import { ApiClient, type CredentialStore } from '../api';
import type { Credentials } from '@ms/shared';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CoopHostWorld } from './host';
import { MirrorWorld } from './mirror';
import type { World } from '../../sim/world';
import { createCoopFactory, type CoopRunStart, type CoopSession } from './session';

const BASE = process.env.API_BASE ?? 'http://127.0.0.1:8686/api/v1';
const SECONDS = Number(process.argv[2] ?? 45);
const GUESTS = Math.min(3, Math.max(1, Number(process.argv[3] ?? 1)));

/** Credentials survive between runs (the Worker rate-limits registrations per hour): one file, one entry per player index. */
const CRED_FILE = path.join(tmpdir(), `ms-coop-live-${BASE.replace(/[^a-z0-9]+/gi, '_')}.json`);

class FileCredentials implements CredentialStore {
  constructor(private readonly index: number) {}
  private all(): Record<string, Credentials> {
    try {
      return JSON.parse(readFileSync(CRED_FILE, 'utf8')) as Record<string, Credentials>;
    } catch {
      return {};
    }
  }
  load(): Credentials | null {
    return this.all()[String(this.index)] ?? null;
  }
  save(c: Credentials): void {
    writeFileSync(CRED_FILE, JSON.stringify({ ...this.all(), [String(this.index)]: c }));
  }
  clear(): void {
    const a = this.all();
    delete a[String(this.index)];
    writeFileSync(CRED_FILE, JSON.stringify(a));
  }
}

const kv = (): { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void } => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
};

const LOADOUTS: Loadout[] = [
  { classId: 'warrior', doctrine: 'a', sex: 'm', empire: 'saehwa', tier: 1 },
  { classId: 'warrior', doctrine: 'b', sex: 'f', empire: 'chowon', tier: 2 },
  { classId: 'warrior', doctrine: 'a', sex: 'f', empire: 'jihae', tier: 0 },
  { classId: 'warrior', doctrine: 'b', sex: 'm', empire: 'saehwa', tier: 3 },
];

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const failures: string[] = [];
function expect(cond: unknown, label: string): void {
  if (!cond) failures.push(label);
  console.log(`  ${cond ? '✓' : '✗'} ${label}`);
}

interface Player {
  api: ApiClient;
  session: CoopSession;
  run: CoopRunStart | null;
  world: World | null;
}

async function main(): Promise<void> {
  const content = cloneContent();
  const zone = content.zones[0];
  if (zone) {
    zone.id = 'yeonmu'; // the relay only accepts real zone ids
    zone.bands = [{ from: 0, to: 900, rate: 40, maxAlive: 150, spawns: [{ enemy: 'wolf', weight: 5 }, { enemy: 'jackal', weight: 3 }, { enemy: 'spitter', weight: 1 }] }];
    zone.bosses = [];
  }
  const players: Player[] = [];
  const n = 1 + GUESTS;
  const hostApi = new ApiClient({ baseUrl: BASE, credentials: new FileCredentials(0), store: kv() });
  await hostApi.ensureRegistered('LiveHost');
  const { room } = await hostApi.createRoom();
  console.log(`room ${room} on ${BASE}`);
  for (let i = 0; i < n; i++) {
    const api = i === 0 ? hostApi : new ApiClient({ baseUrl: BASE, credentials: new FileCredentials(i), store: kv() });
    if (i > 0) await api.ensureRegistered(`LiveGuest${i}`);
    const p: Player = { api, session: null as unknown as CoopSession, run: null, world: null };
    p.session = createCoopFactory(api, { getLoadout: () => LOADOUTS[i] as Loadout, onRunStart: (r) => (p.run = r) })(room);
    p.session.on('error', (e) => console.log(`  relay error ${e.code}: ${e.message}`));
    await p.session.connect();
    p.session.join(LOADOUTS[i] as Loadout, i > 0);
    players.push(p);
  }
  await sleep(500);
  const host = players[0] as Player;
  expect(host.session.isHost && host.session.players.length === n, `lobby has ${n} players, player 0 is host`);
  host.session.start('yeonmu', 'normal', 777);
  await sleep(800);
  expect(players.every((p) => p.run !== null), 'every client received the run start');
  const meta = { stats: { maxHpPct: 80, armor: 600, regen: 80 } };
  const cfgs = await Promise.all(players.map((p) => (p.run as CoopRunStart).config({ meta })));
  players.forEach((p, i) => {
    p.world = (p.run as CoopRunStart).createWorld(cfgs[i] as NonNullable<(typeof cfgs)[number]>, content, {});
  });
  for (const p of players) runEvents.runStart(p.world as CoopHostWorld);
  const hw = host.world as CoopHostWorld;
  const guests = players.slice(1).map((p) => p.world as MirrorWorld);
  const g0 = guests[0] as MirrorWorld;

  // 60 Hz driver on the wall clock
  const histX: number[] = [];
  const histZ: number[] = [];
  let maxRemoteErr = 0;
  let sumRemoteErr = 0;
  let nRemote = 0;
  let picks = 0;
  const t0 = performance.now();
  let tick = 0;
  let dropped = false;
  let reconnected = false;
  while (performance.now() - t0 < SECONDS * 1000) {
    const target = t0 + (tick * 1000) / 60;
    const wait = target - performance.now();
    if (wait > 1) await sleep(wait);
    if (tick % 20 === 0) {
      if (hw.modal && hw.modal.kind !== 'runEnd' && hw.chooseCard(0, 0)) picks++;
      for (const g of guests) if (g.modal && g.modal.kind !== 'runEnd' && g.chooseCard(0)) picks++;
    }
    const b = botInput(hw, tick);
    hw.step([{ moveX: b.moveX, moveZ: b.moveZ }]);
    guests.forEach((g, i) => {
      const a = tick / 100 + i * 2;
      g.step([{ moveX: Math.cos(a), moveZ: Math.sin(a) }]);
    });
    histX[hw.tick] = hw.players[0]?.x ?? 0;
    histZ[hw.tick] = hw.players[0]?.z ?? 0;
    if (tick > 600 && !hw.modal) {
      const seen = g0.players[1];
      const hx = histX[g0.tick];
      const hz = histZ[g0.tick];
      if (seen && hx !== undefined && hz !== undefined) {
        const e = Math.hypot(hx - seen.x, hz - seen.z);
        maxRemoteErr = Math.max(maxRemoteErr, e);
        sumRemoteErr += e;
        nRemote++;
      }
    }
    // real socket drop of guest 1 for ~3 s in the middle of the run (the transport reconnects by itself)
    if (!dropped && tick === Math.floor(SECONDS * 30)) {
      dropped = true;
      const ws = (players[1] as Player).session.transport as unknown as { ws?: WebSocket };
      ws.ws?.close(4999, 'live test drop');
    }
    if (dropped && !reconnected && (players[1] as Player).session.state === 'open' && tick > Math.floor(SECONDS * 30) + 30) reconnected = true;
    tick++;
  }
  const hs = (host.run as CoopRunStart).stats();
  const gs = ((players[1] as Player).run as CoopRunStart).stats();
  const secs = SECONDS;
  console.log('\n=== live report ===');
  console.log(`host: ${hs?.snapshots} snapshots (${hs?.keyframes} key), avg ${hs ? (hs.bytes / hs.snapshots).toFixed(0) : '?'} B, max delta ${hs?.maxDeltaBytes} B, max key ${hs?.maxSnapshotBytes} B → ${hs ? ((hs.bytes * 8) / 1000 / secs).toFixed(0) : '?'} kbps per guest`);
  console.log(`guest1: ${gs?.snapshots} snapshots received, ${gs?.bytes} B, decode errors ${gs?.decodeErrors}`);
  console.log(`remote hero error (vs host history at playback time): avg ${(sumRemoteErr / Math.max(1, nRemote)).toFixed(3)} m, max ${maxRemoteErr.toFixed(2)} m`);
  console.log(`relay round trip (guest1 ping): ${(players[1] as Player).session.latencyMs.toFixed(0)} ms; picks made: ${picks}`);
  const pred = (g0.guest as { prediction: { count: number; sumJump: number; maxJump: number; snaps: number } }).prediction;
  console.log(`prediction: ${pred.count} reconciles, avg correction ${((pred.sumJump / Math.max(1, pred.count)) * 100).toFixed(1)} cm, max ${(pred.maxJump * 100).toFixed(0)} cm, snaps ${pred.snaps}`);
  console.log('');
  expect(hs !== null && hs.snapshots > SECONDS * 10, 'host streamed ≥ 10 snapshots/s');
  expect(gs !== null && gs.decodeErrors === 0, 'guest decoded every frame');
  expect(!hw.over, 'run still alive');
  expect(sumRemoteErr / Math.max(1, nRemote) < 0.15, 'remote hero shown where the host had it (avg < 15 cm)');
  expect(dropped && reconnected, 'guest 1 reconnected after a real socket drop');
  expect(g0.guest?.phase === 'running', 'guest back in the running phase');
  // the host abandons the run (pause menu → quit): every guest must end with its own result
  const gw = guests[0] as MirrorWorld;
  gw.step([{ moveX: 0, moveZ: 0 }]);
  (host.run as CoopRunStart).abort();
  for (let i = 0; i < 60 && !gw.over; i++) {
    await sleep(50);
    gw.step([{ moveX: 0, moveZ: 0 }]);
  }
  expect(gw.over, 'guest ended its run after the host abandoned');
  expect(gw.guest?.phase === 'ended', `guest phase is 'ended' (was ${gw.guest?.phase})`);
  expect(gw.result !== null && gw.result.players.length === n, 'guest got a result covering the whole party');
  expect(gw.modal?.kind === 'runEnd', 'guest shows the run-end modal');
  console.log(`  guest result: level ${gw.result?.level}, kills ${gw.result?.kills}, time ${gw.result?.time.toFixed(0)} s, phase ${gw.guest?.phase}`);
  for (const p of players) p.session.close();
  await sleep(200);
  console.log(failures.length === 0 ? 'LIVE OK' : `LIVE FAILED: ${failures.join('; ')}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
