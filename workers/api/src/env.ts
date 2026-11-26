import type { CoopRoom } from './coopRoom';

/** Worker bindings + vars (see wrangler.toml). Rate-limit bindings are optional so local tooling without them still runs. */
export interface ApiEnv {
  DB: D1Database;
  BLOBS: R2Bucket;
  COOP_ROOM: DurableObjectNamespace<CoopRoom>;
  RL_IP?: RateLimit;
  RL_PLAYER?: RateLimit;
  ALLOWED_ORIGINS?: string;
  ALLOWED_CLIENT_VERSIONS?: string;
  /** Optional Cloudflare edge cache TTL (seconds) for shared leaderboard queries; set in wrangler.toml (0/unset = off). */
  LEADERBOARD_EDGE_CACHE_SEC?: string;
  /** Emergency Durable Objects circuit breaker ("0" / "false" disables new rooms & WS upgrades without redeploy). */
  COOP_ENABLED?: string;
  /** Optional Worker secret (`wrangler secret put IP_HASH_SECRET`): keys the IP hashes of the rate counters. */
  IP_HASH_SECRET?: string;
}

declare global {
  namespace Cloudflare {
    interface Env extends ApiEnv {}
  }
}
