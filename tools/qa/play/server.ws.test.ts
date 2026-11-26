// EXPLORER-5: the QA static server proxies /api/* WebSocket upgrades to a LOCAL Worker, dialing the upstream FIRST. A refused upgrade
// (404 room gone, 409 full, 429 rate limit) must reach the page as a failed handshake (error, never open), like against the production
// Worker, so net/transport.ts counts the attempt and its 5-attempt cap holds. Before: no upgrade path at all in this server, and the
// explorer's proxy upgraded the browser first (open-then-close, attempts reset on every open: 142 upgrade requests for one dead room).
//   bun test tools/qa/play/server.ws.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serveDist, type DistServer } from './server';

let dist = '';
let upstream: ReturnType<typeof Bun.serve<{ path: string }, never>>;
let proxy: DistServer;
const upstreamHits: string[] = [];

beforeAll(async () => {
  dist = mkdtempSync(join(tmpdir(), 'qa-ws-'));
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>qa</title>');
  upstream = Bun.serve<{ path: string }, never>({
    port: 0,
    hostname: '127.0.0.1',
    fetch(req, srv) {
      const u = new URL(req.url);
      upstreamHits.push(u.pathname);
      if (u.pathname.includes('/gone/')) return new Response('room not found', { status: 404 });
      if (u.pathname.includes('/full/')) return new Response('room full', { status: 409 });
      if (u.pathname.includes('/slow/')) return new Response('rate limited', { status: 429 });
      if (srv.upgrade(req, { data: { path: u.pathname } })) return undefined;
      return new Response('expected a websocket', { status: 426 });
    },
    websocket: {
      open(ws) {
        ws.send('hello'); // sent before the browser side has wired its handlers
      },
      message(ws, m) {
        ws.send(typeof m === 'string' ? `echo:${m}` : m);
      },
    },
  });
  proxy = await serveDist(dist, { api: `http://127.0.0.1:${upstream.port}`, portFrom: 15900 });
});

afterAll(async () => {
  await proxy?.stop();
  upstream?.stop(true);
  if (dist) rmSync(dist, { recursive: true, force: true });
});

interface Outcome {
  opened: boolean;
  errored: boolean;
  closeCode: number;
  messages: string[];
}

function connect(path: string, send?: string): Promise<Outcome> {
  return new Promise((resolve) => {
    const out: Outcome = { opened: false, errored: false, closeCode: -1, messages: [] };
    const ws = new WebSocket(`ws://127.0.0.1:${proxy.port}${path}`);
    ws.onopen = () => {
      out.opened = true;
      if (send) ws.send(send);
      else setTimeout(() => ws.close(1000), 150);
    };
    ws.onmessage = (ev) => {
      out.messages.push(String(ev.data));
      if (send && out.messages.length >= 2) ws.close(1000);
    };
    ws.onerror = () => {
      out.errored = true;
    };
    ws.onclose = (ev) => {
      out.closeCode = ev.code;
      resolve(out);
    };
  });
}

describe('QA server: /api WebSocket proxy', () => {
  it('an accepted upgrade tunnels both ways, including what the upstream sends first', async () => {
    const r = await connect('/api/v1/coop/ABCDEF/ws', 'ping');
    expect(r.opened).toBe(true);
    expect(r.messages).toEqual(['hello', 'echo:ping']);
    expect(proxy.apiHits.ws).toBeGreaterThanOrEqual(1);
  });

  it('a refused upgrade (404 / 409 / 429) is a failed handshake: the page never sees an open', async () => {
    for (const room of ['gone', 'full', 'slow']) {
      const r = await connect(`/api/v1/coop/${room}/ws`);
      expect(r.opened, room).toBe(false);
      expect(r.errored, room).toBe(true);
      expect([1002, 1006], room).toContain(r.closeCode); // Bun's client reports 1002, Chrome 1006: a failed handshake, never a normal close
    }
    expect(proxy.apiHits.wsRefused).toBe(3);
  });

  it('five retries against a dead room: five refused handshakes, none open (so the transport attempt counter is never reset)', async () => {
    const before = proxy.apiHits.wsRefused;
    let opens = 0;
    for (let i = 0; i < 5; i++) {
      const r = await connect('/api/v1/coop/gone/ws');
      if (r.opened) opens++;
    }
    expect(opens).toBe(0);
    expect(proxy.apiHits.wsRefused - before).toBe(5);
    expect(upstreamHits.filter((p) => p.includes('/gone/')).length).toBeGreaterThanOrEqual(5);
  });

  it('plain HTTP /api/* is still proxied and the static shell is still served', async () => {
    const shell = await fetch(`${proxy.origin}/`);
    expect(shell.status).toBe(200);
    const api = await fetch(`${proxy.origin}/api/v1/coop/ABCDEF/ws`);
    expect(api.status).toBe(426);
  });
});
