import { Hono } from 'hono';
import { API_BASE_PATH } from '@ms/shared';
import { housekeeping } from './cron';
import type { ApiEnv } from './env';
import { ApiException, edgeMiddleware, errorBody, type AppEnv } from './http';
import { edgeGuardIp } from './limits';
import { coop } from './routes/coop';
import { health } from './routes/health';
import { leaderboard } from './routes/leaderboard';
import { players } from './routes/players';
import { runs } from './routes/runs';
import { save } from './routes/save';
import { transfer } from './routes/transfer';

export { CoopRoom } from './coopRoom';

const app = new Hono<AppEnv>().basePath(API_BASE_PATH);

app.use('*', edgeMiddleware);
app.use('*', async (c, next) => {
  if (c.req.method !== 'OPTIONS') await edgeGuardIp(c);
  await next();
});

app.route('/health', health);
app.route('/players', players);
app.route('/runs', runs);
app.route('/leaderboard', leaderboard);
app.route('/save', save);
app.route('/transfer', transfer);
app.route('/coop', coop);

app.notFound((c) => c.json(errorBody('not_found', 'Not found', c.get('requestId')), 404));

app.onError((err, c) => {
  const requestId = c.get('requestId');
  if (err instanceof ApiException) {
    return c.json(errorBody(err.code, err.message, requestId, err.details), err.status as 400, err.headers);
  }
  // Never leak internals: log server-side, answer with the request id only.
  console.error(JSON.stringify({ requestId, path: c.req.path, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) }));
  return c.json(errorBody('internal', 'Internal error', requestId), 500);
});

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: ApiEnv, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(housekeeping(env).then((r) => console.log(JSON.stringify({ housekeeping: r }))));
  },
} satisfies ExportedHandler<ApiEnv>;
