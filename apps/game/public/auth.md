# Authentication Guide — Metin Survivors (`/auth.md`)

> Metin Survivors is a free-to-play 3D browser action roguelite with **zero mandatory login**. Public read-only endpoints require **no authentication**. Authenticated endpoints use lightweight anonymous player tokens issued on demand — no OAuth, email address, or password is required.

## Public Endpoints (No Authentication Required)

- `GET https://metin-survivors.com/api/v1/health` — Live API, D1 database, and R2 storage status.
- `GET https://metin-survivors.com/api/v1/leaderboard` — Public solo, co-op, weekly, daily, and per-class leaderboards.
  - Query parameters: `mode` (`solo` | `coop`), `zone` (`yeonmu` | `suryeon` | `seori` | `daeryeol`), `difficulty` (`normal` | `hard` | `nightmare`), `class` (`all` | `warrior` | `ninja` | `yacha` | `shaman` | `wolfman`), `period` (`all` | `week` | `day`), `limit` (`1`–`100`).

## Anonymous Player Provisioning (Optional — Cloud Save, Runs & Co-op)

1. **Register an anonymous profile:**
   ```http
   POST https://metin-survivors.com/api/v1/players
   Content-Type: application/json

   { "name": "Wanderer" }
   ```
   Returns `201 Created` with `{ "playerId": "...", "secret": "...", "name": "..." }`.

2. **Authenticate subsequent requests:**
   Pass the composite Bearer token on private endpoints (`/api/v1/save`, `/api/v1/runs`, `/api/v1/transfer`, `/api/v1/coop`, `DELETE /api/v1/players/me`):
   ```http
   Authorization: Bearer <playerId>.<secret>
   ```

3. **Cross-device linking & erasure:**
   - Move an existing profile between browsers using one-time transfer codes via `POST /api/v1/transfer`.
   - Permanently erase profile data, cloud saves, and leaderboard rows via `DELETE /api/v1/players/me`.

## Rate Limits & Constraints

- Per-IP rate limit: 120 requests / 60 seconds; per-player rate limit: 60 requests / 60 seconds.
- Do not submit synthetic or fabricated game runs to `/api/v1/runs`; all submissions undergo server-side plausibility validation.
- Full OpenAPI specification: https://metin-survivors.com/openapi.json
- API Catalog (RFC 9727): https://metin-survivors.com/.well-known/api-catalog
