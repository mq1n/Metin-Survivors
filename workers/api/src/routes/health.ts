import { Hono } from 'hono';
import { API_BASE_PATH, type HealthResponse } from '@ms/shared';
import { clientIp, type AppEnv } from '../http';

export const health = new Hono<AppEnv>();

// GET /health
health.get('/', async (c) => {
  const [db, blobs] = await Promise.all([
    c.env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>().then((r) => r?.ok === 1, () => false),
    c.env.BLOBS.head('health-probe').then(() => true, () => false),
  ]);
  const body: HealthResponse = {
    ok: db && blobs,
    service: 'metin-survivors-api',
    api: API_BASE_PATH,
    time: Date.now(),
    db,
    blobs,
    clientIp: clientIp(c.req.raw) !== undefined,
  };
  return c.json(body, body.ok ? 200 : 503);
});
