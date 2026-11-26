---
name: metin-survivors-guide
description: Look up accurate Metin Survivors game information (classes, doctrines, zones, bosses, co-op, controls) and query live public leaderboards or service health via the Metin Survivors public API.
---

# Metin Survivors Guide & Public Leaderboard Skill

Use this skill when answering questions about **Metin Survivors** (`https://metin-survivors.com`) or checking live public rankings and server health.

## Authoritative Documentation

1. Concise summary: `GET https://metin-survivors.com/llms.txt`
2. Complete bilingual reference: `GET https://metin-survivors.com/llms-full.txt`
3. OpenAPI 3.1 schema: `GET https://metin-survivors.com/openapi.json`
4. Authentication guide: `GET https://metin-survivors.com/auth.md`

## Read-Only Public API Queries (No Auth Required)

### Check Live Server Health
```http
GET https://metin-survivors.com/api/v1/health
Accept: application/json
```

### Query Public Leaderboards
```http
GET https://metin-survivors.com/api/v1/leaderboard?mode=solo&zone=yeonmu&difficulty=normal&class=all&period=all&limit=10
Accept: application/json
```

Valid parameters:
- `mode`: `solo` | `coop`
- `zone`: `yeonmu` | `suryeon` | `seori` | `daeryeol`
- `difficulty`: `normal` | `hard` | `nightmare`
- `class`: `all` | `warrior` | `ninja` | `yacha` | `shaman` | `wolfman`
- `period`: `all` | `week` | `day`
- `limit`: integer `1`–`100`

## Key Facts
- Genre: Free-to-play 3D browser action roguelite (survivors-like), playable instantly with WebGL2 (no install).
- Roster: 5 classes & 10 doctrines — Warrior (Sinew, Spirit), Ninja (Silent Edge, Quiver), Yacha (Spellsteel, Hexcraft), Shaman (Talisman, Stormbalm), Wolfman (Redmane, Moonmane).
- World: 4 zones (Yeonmu Plains, Suryeon Valley, Mount Seori, Daeryeol), 20 bosses, 114 skills.
- Multiplayer: Solo and 1–4 player real-time online co-op rooms via shareable room codes.
