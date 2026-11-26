// Pages Function: same-origin API. Every request to /api/* on the Pages site (production, preview and branch aliases)
// is handed to the API Worker (workers/api, `metin-survivors-api`) through the `API` service binding declared in
// apps/game/wrangler.toml — no CORS preflights, no build-time API URL, WebSocket upgrades (co-op) included.
// public/_routes.json limits Functions to /api/*, so static assets never invoke this code.
//
// When the binding is missing or the Worker cannot be reached the answer is a structured, retryable 503 (the same error
// body the Worker uses); the client treats it like being offline (runs queue locally, the game stays playable).
//
// Type-checked by workers/api (tsconfig.pages.json) and unit-tested in workers/api/test/pagesProxy.test.ts.

export interface ProxyEnv {
  /** Service binding → the API Worker. */
  API?: { fetch(request: Request): Promise<Response> };
}

function unavailable(message: string): Response {
  return new Response(JSON.stringify({ error: { code: 'unavailable', message } }), {
    status: 503,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Retry-After': '30',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/**
 * The request for the Worker: unchanged, plus `X-Real-IP` = this request's edge-set `CF-Connecting-IP` (overwriting any
 * client-supplied value). The Worker prefers `CF-Connecting-IP` and falls back to `X-Real-IP`, so its per-IP rate limits
 * keep working even if the binding hop does not carry the edge header.
 */
export function forwardedRequest(request: Request): Request {
  const ip = request.headers.get('cf-connecting-ip');
  if (!ip && !request.headers.has('x-real-ip')) return request;
  const headers = new Headers(request.headers);
  if (ip) headers.set('x-real-ip', ip);
  else headers.delete('x-real-ip');
  return new Request(request, { headers });
}

export async function proxyToApi(request: Request, env: ProxyEnv): Promise<Response> {
  if (!env.API) return unavailable('The game server is not configured');
  try {
    return await env.API.fetch(forwardedRequest(request));
  } catch (err) {
    console.error(JSON.stringify({ proxy: 'api', path: new URL(request.url).pathname, error: err instanceof Error ? err.message : String(err) }));
    return unavailable('The game server is unreachable, try again');
  }
}

export const onRequest = (context: { request: Request; env: ProxyEnv }): Promise<Response> => proxyToApi(context.request, context.env);
