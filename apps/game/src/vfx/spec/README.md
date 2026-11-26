# Skill effect specs (`sk.*`) — authoring guide

Data-driven VFX specification layer for skill, ambient, hit, and event effects. Every effect is defined by declarative numbers (timings, curves, sizes, velocities, colours, blend modes) rendered over procedural atlas roles and original generated sprites.

```
apps/game/src/vfx/spec/   types.ts (FxSpec format)  host.ts (runtime)  batches.ts  shaders.ts  curves.ts (LUT bake)
                          roles.ts (texture roles)  atlas.ts (procedural painter)  preset.ts (specPreset + contracts)
                          art.ts (generated-sprite atlas)  artScope.ts (art keys, per-run scope)  artSheets.ts (named frame lists)
                          artTier.ts (NOW / SOON / LATE split of a run's scope)
                          display.ts + artGain.ts (display-space blend layer, sprite gain)
                          flip.ts (flipbook frame modes: cut / blend / random, JS mirror of the shader)
                          sockets.ts (body anchors, stand-in body)  demo.ts (sk.__art_demo)
apps/game/src/vfx/skills/ index.ts (eager common registry) loader.ts (ensureSkillVfx / ensureAllSkillVfx, lazy packs)
                          <class>/index.ts (lazy class entry)  warrior|ninja|yacha|shaman|wolfman/*.ts  shared/  common.ts
apps/game/src/app/skillVfxFeed.ts  zone rows + `sk.*` projectile rows → VFX handles
```

## Authoring Rules

- **Coordinate system**: metres, seconds, degrees. Local frame: `+Z` = caster facing, `+Y` = up, `-X` = caster right.
- **Element cap**: `MAX_ELEMENTS = 40` per list (`elements` and `impact`).
- **Hero readability**: additive layers near the hero use `clamp` and avoid `occlude` so the character silhouette stays readable on both bright snow and dark stone floors.
- **Per-grade scaling**: `grade: { g1, g2, g3 }` overrides scale visual intensity across ranks (1..3, M1..M2, G1..G2, P).
- **Art scope streaming**: sprites referenced by a run's active class, zone, and skills are partitioned into NOW / SOON / LATE tiers (`artTier.ts`) and streamed into the GPU texture array without stalling initial zone entry.
- **Verification**: run `bun run --cwd apps/game vitest run src/vfx/` to verify spec contracts, curve LUT bounds, art-scope tier budgets, hero readability, and simulation route bindings.
