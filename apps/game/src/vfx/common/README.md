# Common (non-skill) VFX — builder contract

One folder per target under `apps/game/src/vfx/common/<target>/`, each owned by exactly one builder (C0 ownership split,
2026-10-13; plan: `.research/audit2/vfx/REPORT.md` §3–§5). Everything moved verbatim, so the game looks exactly as before
the split (verified: behavioural fingerprint of all 316 presets identical, `__tests__/registryIds.test.ts`).

| target | folder | ids it owns today | render files it owns |
|---|---|---|---|
| hits | `hits/` | `hit.<element>`, `hit.crit`, `sk.gen.hit/critical/penetrate` | `render/crowd/fx/hitFlash.ts` |
| status | `status/` | `hit.dot.*`, `sk.gen.stun`, `sk.gen.*_loop` (stun/slow/poison/fire) | `render/crowd/fx/status.ts`, `vfx/skills/common/statusFeed.ts` |
| death-spawn | `death-spawn/` | `death.*`, `spawn.*`, `sk.gen.monster_die/appear` | `render/crowd/fx/dissolve.ts`, `app/simFeed.ts` |
| pickups | `pickups/` | `pickup.*`, `chest.open*` | `render/fx/pickups.ts` |
| levelup-heal | `levelup-heal/` | `sk.gen.level_up/skillup/potion*`, `aura.heal`, `holy.heal`, `heal.drain`, `buff.haste/shield/stealth`, `levelup`, `player.revive/death` | — |
| metin | `metin/` | `sk.gen.metin_*`, `metin.*` | `render/metin.ts`, `render/fx/rings/metin.ts` |
| boss | `boss/` | `boss.*` | `render/fx/rings/boss.ts` |
| enemy-projectiles | `enemy-projectiles/` | `proj.hostile`, `enemy.muzzle` | `render/fx/projectiles.ts` |
| ambient | `ambient/` | `ambient.*`, `sk.gen.dust/running_dust`, `enemy.charge/leap` | `vfx/skills/common/dustFeed.ts` |
| player-feedback | `player-feedback/` | `hit.player`, `player.evade/shield`, `aura.ring`, `dash.streak`, `buff.aura`, `summon.*`, `burst.dragon_head` | `render/fx/rings/{hero,elite,champion}.ts`, `render/crowd/fx/corruption.ts` |
| telegraphs | `telegraphs/` | dormant `telegraph.*` | `render/fx/telegraphs.ts` (the decal look; the infra is `render/fx/decalGrid.ts`, frozen) |
| damage-numbers | — | — | `render/fx/damageNumbers.ts` |

Core-owned (builders read only, ask the core owner): `vfx/adapter.ts`, `vfx/system.ts`, `vfx/emit.ts`, `vfx/batches.ts`,
`vfx/textures.ts`, `vfx/shaders/**`, `vfx/presets/{index,types,kit}.ts`, the legacy barrels (`vfx/presets/*.ts`,
`vfx/skills/common.ts`, `vfx/skills/common/{combat,feedback,metin}.ts`), `vfx/common/{index,types,route,registry}.ts`,
`vfx/__tests__/**`, `render/fx/decalGrid.ts`, `render/fx/groundRings.ts`, `render/crowd/{crowd,crowdMaterial}.ts`,
`render/crowd/fx/index.ts`, `render/world.ts`. The skill kit `vfx/spec/**` belongs to the skill-VFX infra owner.

## What a target folder exports

`index.ts` exports one `CommonTarget` (`types.ts`): `{ id, presets, specs, routes }`.

- `presets.ts` (`presets_<legacy>.ts` when several legacy files fed it): classic `PresetDef`s (fire/tick/end over the
  Fx batches, helpers in `vfx/presets/kit.ts`).
- `specs.ts`: `FxSpec` presets (the data-driven runtime of the skill VFX: `vfx/spec/README.md` — read it, it is the
  preferred way to rebuild an effect: authored timings/curves as numbers, art roles from generated sprites).
- `route.ts`: the sim-event routes of the target (see below).
- `art.ts` (when you add generated sprites): follow the art-role section of `vfx/spec/README.md` (one atlas, one
  manifest kind `vfx`; never a second atlas).

**Ids are the contract.** Keep every id you own (rebuild its look freely). Add new ids freely: anything a target exports
that no legacy barrel lists is appended to the registry automatically (`presets/index.ts`, `skills/common.ts`). Never
delete or move an id yourself — mark it in your notes; the core removes it and updates `__tests__/registryIds.json`
(C11). A new classic (non-`sk.`) id also needs a row in `vfx/presets/README.md` (`presets.test.ts`): ask the core.

## Routes (sim event → presets)

`EventAdapter` (`vfx/adapter.ts`) dispatches every sim event to the routes registered for its type; `onVfx`
(`w.bus.vfx` presets + aliases), `skillCast` and `enemyAttack` kind 4 (`enemy.explode`) stay in the adapter core.
A route is created once per adapter (`routes: () => EventRoute[]`), so keep its state in the closure:

```ts
import { route, type EventRoute } from '../route';
export function myRoutes(): readonly EventRoute[] {
  let budget = 0;
  return [route(['pickup'], (e, ctx) => { if (budget-- > 0) ctx.fire('pickup.xp', ctx.o(e.x, e.z, 1)); },
                { update: (_dt, ctx) => void (budget = 60 * ctx.density) })];
}
```

`RouteCtx` (`route.ts`): `fire(id, o)` (unknown ids are a cheap no-op, so you can route to an id before it exists),
`o(x, z, scale, dirX?, dirZ?)` (reusable SpawnOpts), `resolve` / `spawnResolved`, `stop`, `alive(handle)` (respawn
persistent loops), `once(key, window)` / `since(key)` / `mark(key)` (de-dupe: the adapter marks every `w.bus.vfx` preset
id, so `since('sk.mending_light')` tells a heal route that the skill already drew its cure), `heightAt`, `players`, `time`,
`density`, `deathPreset(type)`, `metinRune(def, great)`, `bossPos(x, z, out)` (live boss position from the render world),
`telegraphEvents`. Sim events are pooled: read them synchronously, never keep them.

C1 behaviour now in the routes (tests: `__tests__/routes.test.ts`): magnet pickup → `pickup.magnet`, chest pickup →
nothing (the `chestOpen` event plays the chest); one revive / one enrage burst per event (alias de-dupe); boss phase at the
live boss position; lifesteal at full size, one per 0.4 s; no `holy.heal` over a skill's own cure; every DoT tick may
show (token bucket, `DOT_RATE` per element); `spawn.ring` hook for band spawns (register the id to use it); muzzle delay
hook `MUZZLE_DELAY` (enemy-projectiles); metin corruption loops are respawned when they end while the stone stands.

## Soft kit (C4, `vfx/presets/kit.ts`, signatures unchanged)

`haloRing` = feathered band (no hairline circle), `shockRing` = `PAT.ringSoft` noisy broken band (min width 0.3 R),
`pillar` = `PAT.pillarSoft` (no cap rim, streaks scrolling up, tapered top), `flash()` intensity ≤ `FLASH_INT_MAX` (2.2),
full-screen tints ≤ `SCREEN_FLASH_MAX` (0.18). `fx.legacyKit = true` (gallery `&legacyKit=1`, `vfxstage.ts --legacyKit`)
restores the old look for A/B. `PAT.cracks` (the marbled crack slab) is banned in `vfx/common/**` (ratchet test
`commonNoCracks.test.ts`: the 6 legacy uses may only go down).

**New kit helpers (2026-10-19; none of them changes an existing preset by itself)** — all in `presets/kit.ts`, metres / seconds:

| helper | what | notes |
|---|---|---|
| `ringArc(fx, x, z, r0, r1, life, hex, a?, int?, spin?, delay?)` | broken glowing arcs on the ground (click-select ring) | art `ring_arcs_select_a`; stack two with opposite `spin` |
| `glints(fx, x, y, z, n, radius, height, life0, life1, size, hex0, hex1?, delay?, int?)` | twinkling 4-point glints in a disk | art pin / cross / lens sprites |
| `cinders(fx, x, y, z, n, radius, rise, life0, life1, size, hexHot, hexCool, delay?, int?)` | embers that cool + faint ash veils | `size` = visible diameter-ish |
| `groundFlare(fx, x, z, r, life, hex, int?, delay?)` | flat radial spike flare + hub glow | art `rayring_ground_burst_a` |
| `crackHeat(fx, x, z, r, life, darkHex, glowHex, int?, delay?)` | Voronoi crack network, hot seams cool to char | `PAT.crackHeat` (+ art scar under it); replaces `PAT.cracks` |
| `stain(fx, x, z, r, life, bodyHex, shineHex, delay?)` / `crater(fx, x, z, r, life, pitHex, lipHex, delay?)` | blood / ooze / soot stain; impact crater | `PAT.stain` / `PAT.crater` alpha decals |
| `lightShaft(fx, x, y, z, width, height, life, hex, a?, int?, delay?)` | two layered shaft curtains rising from the ground | art `curtain_shafts_a/b`, upright billboards |
| `pillarCross(fx, x, z, radius, height, life, pal, int?, delay?, planes?)` | light column from crossed vertical planes | `shp.plane(w, h)` + `PAT.pillarPlane`; no cap rim, no hollow interior |
| `rocks(fx, x, y, z, n, speed, size, life?, floorY?, tint?, delay?)` | thrown rock sprites (alpha, lit) | art rock sprites; falls back to `chunks()` cubes |
| `smoke(...)` / `dustRing(...)` | now draw generated smoke / dust sprites | pass `cell` to `smoke` to force the atlas |

**Generated art in the legacy kit (C3 bridge).** One art system: the spec runtime's art array (`vfx/spec/art.ts`, manifest kind
`vfx`, `uSpecArt`). The legacy particle batches sample the same array: `PBuilder.spr(cell)` accepts a packed art role (a float
>= 65536, `spec/art.ts packArtRole`) and the particle shader (`shaders/particles.ts`, `shaders/common.ts GLSL_ART`) decodes it;
`Fx.spec = host` binds the host's own `uSpecArt` / `uArtGrid` uniform objects to both particle batches, so a tier change or late art
bake reaches them. Use it with a `KitArt` (`emit.ts`): `fx.add.at(...).art(KIT_ART.glintPin)...` — the packed sprite when it is in
the array, its procedural `fb` cell when not (missing file, tests, `fx.legacyKit`). `fx.hasArt(a)` tells helpers which look they
get. To add a sprite: add it to `KIT_ART` in `common/kitArt.ts` (it is then referenced by the carrier spec `sk.gen.kit_art`, which
puts it in every run's art scope; `kitArt.test.ts` checks the manifest id exists). Shapes (the `shp` / `dec` batches) are not
art-aware: ground decals that need a sprite are ground-mode particles (`.mode(M.ground)`), see `crackHeat`.

## Seeing it at the game camera (C10)

```
bun tools/qa/vfxstage.ts --ids hit.fire,death.elite --zone seori --times 0.1,0.3,0.6 --base --out .research/<task>/stage
bun tools/qa/vfxstage.ts --event '{"t":"pickup","kind":4,"tier":0}' --zone yeonmu --times 0.2 --out ...   # through the route
python tools/qa/vfxmetrics.py coverage --a <out>/base.png --b <out>/stage_t0.30.png    # % changed, bbox, luma, white-out
```

The stage is the real game (zone ground, lights, post, hero model; 1920×1080, DPR 1, zoom 22) with the sim never
ticking, so frames are deterministic; `--at dx,dz` places the effect relative to the hero, `--opts '{...}'` adds
SpawnOpts. In a running dev game the same hooks are on `window.__ms.vfx` (`spawnNow(id, opts)`, `event(e)`,
`step(seconds)`, `clear()`, `stats()`; `vfx/dev/stage.ts`). The VFX gallery still works for close-ups (`&det=1` makes it
paused from the first frame → reproducible captures). Budget per event at the game camera: ≤ 25 % changed pixels,
< 1 % white-out (`ok_coverage`, `ok_whiteout`).

## Rules

All shipped VFX sprites are original generated or procedural assets.
(`bun scripts/cleanRoomAudit.ts`). Keep the tree compiling at every step (shared dev server). Tests for your
target go in your folder (`vfx/common/<target>/__tests__/`).
