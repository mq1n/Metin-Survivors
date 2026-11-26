# Metin Survivors

Browser-based 3D Eastern-fantasy action roguelite built with **Three.js (WebGL2)**, **Preact + Signals**, and **TypeScript**, hosted on **Cloudflare Pages + Workers + D1 + R2 + Durable Objects**.

- **5 playable classes** (Warrior, Ninja, Yacha, Shaman, Wolfman), each with 2 doctrines, dedicated weapon rigs, and awakening skills (`1` → `M` → `G` → `P`).
- **4 handcrafted zones** (Yeonmu Plains, Suryeon Isles, Seori Peaks, Daeryeol Caldera) with dynamic corruption events, elites, bosses, and Daily Challenges.
- **Solo & up to 4-player Co-op** over hibernating Durable Object WebSocket rooms, plus global/weekly/daily leaderboards and cross-device cloud saves.
- **Bilingual UI**: Turkish (`tr`) and English (`en`).
- **Original clean-room assets**: all shipped 3D models, textures, icons, audio, and code are original or open-source licensed — see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

---

## Controls

| Action | Input |
|---|---|
| Move | `W` `A` `S` `D` / Arrow keys |
| Basic attack (aim toward cursor) | `Left Click` / `Space` |
| Active skills | `1`–`6` (or toggle **Auto / Manual** combat mode) |
| Legendary chest | Hold click / `Space` to open (activates immediately) |
| Pause / Settings | `Esc` |

---

## Quick Start (Local Development)

**Requirements:** [Bun](https://bun.sh) ≥ 1.3 and Node.js ≥ 20 (for Wrangler).

```sh
bun install

# Terminal 1 — game client (Vite, default http://localhost:5173)
bun run dev

# Terminal 2 — optional local API Worker (D1/R2/DO on http://127.0.0.1:18686)
bun run --cwd workers/api dev
```

### Verification Commands

```sh
bun run typecheck      # all workspaces + scripts
bun run test           # game, API Worker, forge, and asset pipeline tests
bun run deploy:check   # all 11 local production gates (zero remote writes)
bun run deploy:dry     # full deployment plan without touching Cloudflare
```

### Local Production Preview (Pages + Worker)

```sh
cd apps/game && MS_STRICT_ASSETS=1 bunx vite build --sourcemap false
cd workers/api && bun run dev
# in a second terminal:
cd apps/game && bunx wrangler pages dev dist --port 18788
```

Open `http://127.0.0.1:18788` to test the built site with production `_headers`, `_routes.json`, CSP, and the `/api/*` service-binding proxy.

---

## Repository Structure

```text
apps/game/          WebGL2 game client (Three.js + Preact), assets, Pages Function proxy (/api/*)
workers/api/        Cloudflare Worker API (Hono), D1 migrations, R2 saves, CoopRoom Durable Object
packages/shared/    Shared API, plausibility, leaderboard, and co-op wire contracts
scripts/            Release pipeline (deploy.ts), clean-room audit, dist & chunk checks
tools/              Original asset generation (forge, imagegen, painter, audiogen, pipeline, qa)
content/            Model & icon production rosters
```

---

## Cloudflare Production Architecture & Deployment

### Resources

| Cloudflare Resource | Name | Purpose |
|---|---|---|
| Pages project | `metin-survivors` | Static client (`apps/game/dist`) + `/api/*` proxy Function (`apps/game/functions/api/[[path]].ts`) |
| Worker | `metin-survivors-api` | Hono API (`/api/v1/*`) + daily housekeeping cron (`17 3 * * *` UTC) |
| D1 database | `metin-survivors-db` | Players, credentials, runs, leaderboards, fixed-window rate counters |
| R2 bucket | `metin-survivors-blobs` | Cloud save blobs (`saves/<playerId>.json`) |
| Durable Object | `CoopRoom` (`new_sqlite_classes`, tag `v1`) | Hibernating WebSocket relay (one object per active room) |
| Rate Limiters | `RL_IP` (`1001`), `RL_PLAYER` (`1002`) | Zero-D1-write edge flood protection (120/min IP, 60/min player) |

The browser talks only to the Pages origin (`https://metin-survivors.com`). `apps/game/public/_routes.json` routes **only** `/api/*` (including co-op WebSockets) to the Pages Function, which forwards to `metin-survivors-api` over the `API` Service Binding (zero CORS preflights, single-request billing). Every other path is served as a free static asset with `apps/game/public/_headers` (`immutable` 1-year caching for content-hashed `/assets/*`, `no-cache` for `index.html` and manifests, strict CSP). If the API is unreachable, the client stays playable offline and queues runs locally.

### First-Time Account Setup

```sh
cd workers/api
bunx wrangler login                                    # or export CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
bunx wrangler d1 create metin-survivors-db             # update database_id in workers/api/wrangler.toml
bunx wrangler r2 bucket create metin-survivors-blobs
bunx wrangler pages project create metin-survivors --production-branch main
```

### Release Checklist

1. Verify a clean git worktree (`git status`) and check remote D1 migration state:
   ```sh
   cd workers/api && bunx wrangler d1 migrations list metin-survivors-db --remote
   ```
2. Run all local release gates and preview the deployment plan:
   ```sh
   bun run deploy:check
   bun run deploy:dry
   ```
3. Deploy D1 migrations (auto-exports a pre-migration backup and updates `workers/api/migrations.lock.json`), the API Worker, Cloudflare Pages, and the live `/api/v1/health` smoke check:
   ```sh
   bun run deploy
   ```
4. Immediately after the first Worker deploy, set the IP-hashing secret (used to HMAC-hash IPs in `rate_counters`) and commit the updated `workers/api/migrations.lock.json`:
   ```sh
   cd workers/api && bunx wrangler secret put IP_HASH_SECRET
   ```

> **Note on D1 migrations:** Never edit, rename, or delete a migration file once recorded in `workers/api/migrations.lock.json`; add a new `NNNN_snake_case.sql` file instead.

### Custom Domain & Rollback

- **Custom domain:** Attach the domain to the Pages project, add its `https://` origin to `ALLOWED_ORIGINS` in `workers/api/wrangler.toml` and its `wss://` origin to `connect-src` in `apps/game/public/_headers`, then redeploy.
- **Pages rollback:** Cloudflare Dashboard → Workers & Pages → `metin-survivors` → Deployments → **Rollback**.
- **Worker rollback:** `cd workers/api && bunx wrangler rollback`.
- **D1 restore:** `bunx wrangler d1 time-travel restore metin-survivors-db --timestamp=<ISO-8601>` (30-day retention on Workers Paid) or replay the backup under `workers/api/.wrangler/backups/`.
