// The Pages Function that makes the API same-origin in production (apps/game/functions/api/[[path]].ts): it must hand
// every /api/* request to the Worker untouched and degrade to a retryable structured 503 when the Worker is missing.
import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import { forwardedRequest, onRequest, proxyToApi } from '../../../apps/game/functions/api/[[path]]';
import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { HealthResponse, RegisterResponse } from '@ms/shared';

const PAGES = 'https://metin-survivors.pages.dev';

/** A service binding that runs the real Worker in-process. */
const binding = {
  fetch: async (request: Request): Promise<Response> => worker.fetch(request, env, createExecutionContext()),
};

describe('Pages Function /api/* proxy', () => {
  it('forwards method, path, query, headers and body to the Worker and returns its answer', async () => {
    const reg = await onRequest({
      request: new Request(`${PAGES}/api/v1/players`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: PAGES, 'cf-connecting-ip': '198.51.100.7' },
        body: JSON.stringify({ name: 'Proxy Hero' }),
      }),
      env: { API: binding },
    });
    expect(reg.status).toBe(201);
    expect(reg.headers.get('access-control-allow-origin')).toBe(PAGES);
    const body = (await reg.json()) as RegisterResponse;
    expect(body.name).toBe('Proxy Hero');

    const lb = await proxyToApi(new Request(`${PAGES}/api/v1/leaderboard?zone=yeonmu&limit=5`, { headers: { authorization: `Bearer ${body.playerId}.${body.secret}` } }), { API: binding });
    expect(lb.status).toBe(200);
    expect(await lb.json()).toMatchObject({ zone: 'yeonmu', limit: 5 });

    const missing = await proxyToApi(new Request(`${PAGES}/api/v1/nope`), { API: binding });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: 'not_found' } });
  });

  it('hands the client address to the Worker even if the binding hop drops the edge header', async () => {
    const original = new Request(`${PAGES}/api/v1/health`, { headers: { 'cf-connecting-ip': '203.0.113.50', 'x-real-ip': '6.6.6.6' } });
    expect(forwardedRequest(original).headers.get('x-real-ip')).toBe('203.0.113.50');
    // a client-chosen X-Real-IP never survives the proxy
    expect(forwardedRequest(new Request(`${PAGES}/api/v1/health`, { headers: { 'x-real-ip': '6.6.6.6' } })).headers.has('x-real-ip')).toBe(false);
    // a hop that loses CF-Connecting-IP: the Worker still sees the client through X-Real-IP
    const lossy = {
      fetch: async (request: Request): Promise<Response> => {
        const headers = new Headers(request.headers);
        headers.delete('cf-connecting-ip');
        return worker.fetch(new Request(request, { headers }), env, createExecutionContext());
      },
    };
    const res = await proxyToApi(original, { API: lossy });
    expect(((await res.json()) as HealthResponse).clientIp).toBe(true);
    // nothing at all → reported, so the deploy smoke test can catch it
    const anonymous = await worker.fetch(new Request(`${PAGES}/api/v1/health`), env, createExecutionContext());
    expect(((await anonymous.json()) as HealthResponse).clientIp).toBe(false);
  });

  it('answers a retryable structured 503 when the binding is missing or the Worker is unreachable', async () => {
    for (const env of [{}, { API: { fetch: () => Promise.reject(new Error('connection reset')) } }]) {
      const res = await proxyToApi(new Request(`${PAGES}/api/v1/health`), env);
      expect(res.status).toBe(503);
      expect(res.headers.get('retry-after')).toBe('30');
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(await res.json()).toMatchObject({ error: { code: 'unavailable' } });
    }
  });
});
