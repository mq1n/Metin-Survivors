// Static server for a built dist (QA snapshot): correct MIME types, SPA fallback to index.html, the production CSP / security headers of
// public/_headers applied to every page, /api/* proxied to --api (a LOCAL Worker) or answered 503 JSON when offline.
// A free port >= 15000 is bound (never 5180 / 5183); stop() frees it (the harness stops it at exit).
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.ktx2': 'image/ktx2',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.bin': 'application/octet-stream',
};

/** the `/*` block of public/_headers (CSP, nosniff, COOP ...) as header pairs; Strict-Transport-Security is dropped (plain http). */
function pagesHeaders(dist: string): [string, string][] {
  const f = join(dist, '_headers');
  if (!existsSync(f)) return [];
  const out: [string, string][] = [];
  let inStar = false;
  for (const raw of readFileSync(f, 'utf8').split(/\r?\n/)) {
    if (raw.startsWith('#') || raw.trim() === '') continue;
    if (!/^\s/.test(raw)) {
      inStar = raw.trim() === '/*';
      continue;
    }
    if (!inStar) continue;
    const i = raw.indexOf(':');
    if (i < 0) continue;
    const name = raw.slice(0, i).trim();
    if (/^strict-transport-security$/i.test(name)) continue;
    out.push([name, raw.slice(i + 1).trim()]);
  }
  return out;
}

export interface DistServer {
  port: number;
  origin: string;
  /** number of /api/* requests answered by the offline 503 (or proxied); `ws` = WebSocket upgrades proxied (accepted by the upstream), `wsRefused` = refused by it */
  apiHits: { offline: number; proxied: number; ws: number; wsRefused: number };
  stop(): Promise<void>;
}

type WsPayload = string | ArrayBuffer | Uint8Array;
/** per-socket state of a proxied WebSocket: the upstream (already open) and what it sent before the browser side was ready */
interface WsData {
  upstream: WebSocket;
  early: WsPayload[];
}

/** close codes a server may send (1005 / 1006 are reserved and cannot be sent) */
function sendableCode(code: number): number {
  return code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1011;
}

/**
 * Dial the upstream WebSocket FIRST and report whether it accepted. A refused upgrade (404 room gone / 409 full / 429 rate limit)
 * resolves null, so the caller answers the browser with an HTTP error instead of upgrading it: the page then sees a failed handshake
 * (error, never open) exactly like against the production Worker, and the transport's 5-attempt cap holds. Upgrading the browser
 * before the upstream accepted showed it open-then-close, which reset the attempt counter on every try (EXPLORER-5).
 */
function dialUpstream(url: string, protocols: string[], origin: string): Promise<WsData | null> {
  return new Promise((resolveDial) => {
    let up: WebSocket;
    try {
      up = new WebSocket(url, { protocols, headers: { Origin: origin } } as unknown as string[]);
    } catch {
      resolveDial(null);
      return;
    }
    up.binaryType = 'arraybuffer';
    const data: WsData = { upstream: up, early: [] };
    let settled = false;
    const done = (v: WsData | null): void => {
      if (settled) return;
      settled = true;
      resolveDial(v);
    };
    up.onopen = () => done(data);
    up.onmessage = (ev) => data.early.push(ev.data as WsPayload); // replaced by the browser-side wiring once the socket is open
    up.onerror = () => done(null);
    up.onclose = () => done(null);
    setTimeout(() => {
      if (!settled) {
        try {
          up.close();
        } catch {
          /* already closed */
        }
        done(null);
      }
    }, 10_000);
  });
}

export interface ServeOpts {
  /** first port to try (>= 15000) */
  portFrom?: number;
  /** a LOCAL Worker origin, e.g. http://127.0.0.1:19431 ; absent = offline (/api/* answers 503 JSON) */
  api?: string;
}

export async function serveDist(distArg: string, opts: ServeOpts = {}): Promise<DistServer> {
  const dist = resolve(distArg);
  if (!existsSync(join(dist, 'index.html'))) throw new Error(`serveDist: no index.html in ${dist}`);
  const api = opts.api ? opts.api.replace(/\/$/, '') : '';
  if (api && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(api)) throw new Error(`--api must be a LOCAL Worker (127.0.0.1 / localhost), got ${api}`);
  const sec = pagesHeaders(dist);
  const apiHits = { offline: 0, proxied: 0, ws: 0, wsRefused: 0 };
  const from = opts.portFrom ?? 15100 + Math.floor(Math.random() * 800);
  let server: ReturnType<typeof Bun.serve<WsData, never>> | null = null;
  let lastErr: unknown = null;
  for (let port = Math.max(15000, from); port < Math.max(15000, from) + 400 && !server; port++) {
    if (port === 5180 || port === 5183) continue;
    try {
      server = Bun.serve<WsData, never>({
        port,
        hostname: '127.0.0.1',
        websocket: {
          open(ws) {
            const { upstream, early } = ws.data;
            for (const m of early) ws.send(m);
            early.length = 0;
            upstream.onmessage = (ev) => {
              try {
                ws.send(ev.data as WsPayload);
              } catch {
                /* browser side closed */
              }
            };
            upstream.onclose = (ev) => {
              try {
                ws.close(sendableCode(ev.code), ev.reason);
              } catch {
                /* already closed */
              }
            };
            upstream.onerror = () => {
              try {
                ws.close(1011, 'upstream error');
              } catch {
                /* already closed */
              }
            };
            if (upstream.readyState !== 1) ws.close(1011, 'upstream closed');
          },
          message(ws, msg) {
            const up = ws.data.upstream;
            if (up.readyState === 1) up.send(msg);
          },
          close(ws, code, reason) {
            try {
              ws.data.upstream.close(code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1000, reason);
            } catch {
              /* already closed */
            }
          },
        },
        async fetch(req, srv) {
          const url = new URL(req.url);
          const path = decodeURIComponent(url.pathname);
          // blank same-origin page the harness uses to seed IndexedDB before the game boots
          if (path === '/__qa_seed.html') return new Response('<!doctype html><title>qa seed</title>', { headers: { 'content-type': MIME['.html'] as string, 'cache-control': 'no-store' } });
          if (path.startsWith('/api/') || path === '/api') {
            if (!api) {
              apiHits.offline++;
              return new Response(JSON.stringify({ error: 'offline', detail: 'QA harness: no --api, the API is offline on purpose' }), { status: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
            }
            apiHits.proxied++;
            if ((req.headers.get('upgrade') ?? '').toLowerCase() === 'websocket') {
              const protocols = (req.headers.get('sec-websocket-protocol') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
              const data = await dialUpstream(api.replace(/^http/, 'ws') + url.pathname + url.search, protocols, req.headers.get('origin') ?? url.origin);
              if (!data) {
                apiHits.wsRefused++;
                return new Response('the upstream Worker refused the WebSocket upgrade', { status: 502, headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' } });
              }
              const ok = srv.upgrade(req, { headers: protocols[0] ? { 'Sec-WebSocket-Protocol': protocols[0] } : undefined, data });
              if (!ok) {
                try {
                  data.upstream.close();
                } catch {
                  /* already closed */
                }
                return new Response('upgrade failed', { status: 400 });
              }
              apiHits.ws++;
              return undefined;
            }
            const headers = new Headers(req.headers);
            headers.delete('host');
            try {
              const r = await fetch(api + url.pathname + url.search, { method: req.method, headers, body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer(), redirect: 'manual' });
              return new Response(r.body, { status: r.status, headers: r.headers });
            } catch (e) {
              return new Response(JSON.stringify({ error: 'upstream', detail: String(e) }), { status: 502, headers: { 'content-type': 'application/json' } });
            }
          }
          let file = normalize(join(dist, path));
          if (file !== dist && !file.startsWith(dist + sep)) return new Response('forbidden', { status: 403 });
          let st = existsSync(file) ? statSync(file) : null;
          if (st?.isDirectory()) {
            file = join(file, 'index.html');
            st = existsSync(file) ? statSync(file) : null;
          }
          const isAsset = /\.[a-z0-9]{2,5}$/i.test(path);
          if (!st) {
            // a missing FILE is a real 404 (the 404-asset detector needs it); an extension-less route falls back to the SPA shell
            if (isAsset) return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
            file = join(dist, 'index.html');
          }
          const headers = new Headers({ 'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' });
          for (const [k, v] of sec) headers.set(k, v);
          return new Response(Bun.file(file), { headers });
        },
      });
    } catch (e) {
      lastErr = e;
    }
  }
  if (!server) throw new Error(`serveDist: no free port from ${from}: ${String(lastErr)}`);
  const s = server;
  return {
    port: s.port as number,
    origin: `http://127.0.0.1:${s.port}`,
    apiHits,
    stop: async () => {
      await s.stop(true);
    },
  };
}
