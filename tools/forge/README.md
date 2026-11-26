# @ms/forge — procedural 3-D generation

Forge builds every game model in code: SDF sculpting → meshing → simplification → skin weights → painted/baked albedo → procedural clips → GLB
(ARCHITECTURE §5.1) → hashed file in `apps/game/public/assets/models/**` + an entry in `apps/game/public/assets/manifest/models.json`.
Deterministic: same params + seed ⇒ same bytes. All geometry, rigs, and textures are 100% original procedural / authored assets.

```
bun tools/forge/src/cli.ts list                         # registered ids
bun tools/forge/src/cli.ts build wolf                   # -> .research/forge/tmp/wolf.glb (viewer input)
bun tools/forge/src/cli.ts build wolf* --ship           # prefix select; --ship also writes public/assets + models.json
bun tools/forge/src/cli.ts build all --ship --tex=1024  # --tex=0 = vertex colours only
bun tools/forge/src/cli.ts example stone_lantern        # hard-surface worked example (never shipped)
bun tools/pipeline/manifest.ts                          # manifest self-check after shipping
bun run viewer                                          # http://localhost:5290 (serves .research/forge/tmp, public models, .research)
FORGE_DEBUG=1 bun src/cli.ts build wolf                 # dumps .research/forge/<id>/albedo.png + mesh-health logs
```

## Layout

| path | what |
|---|---|
| `src/core/` | **stable shared library** (do not change semantics; extend additively) |
| `src/core/sdf/` | primitives (`Sphere, Ellipsoid, RoundCone, RoundedBox, Torus, HalfSpace`), ops (`SmoothUnion/Subtract/Intersect, Xform, MirrorX, Offset, Displace, Warp`), `fields` (fbm/ridged/voronoi/masked), `shapes` (`tube, limb, tuft, blade, flatCone`), `Body` (parts with bone + tag, stages base/cut/late/mark) |
| `src/core/mesh/` | `surfaceNets` (sparse octree + Newton projection), `simplify` (meshopt + focus region, `relax`, `projectToSurface`, `sdfNormals`, `orientToNormals`), `atlas` (xatlas UV unwrap) |
| `src/core/skin/` | `Skeleton` (identity rest rotations), `computeSkinWeights` (primitive-distance softmax + smoothing, top-4) |
| `src/core/paint/` | `layers` (fill, gradient, region, bones, blotches, stripes, strands, furClumps, grain, bakeAo, cavity, hemi, rimTint, custom), `painter` (per-vertex), `bake` (per-texel albedo → WebP) |
| `src/core/anim/` | `clip` (`ClipSpec`, `PoseCtx`, hit-time metadata), `curve` helpers, `ik` (`twoBoneIK`, `aimQuat`), `quadruped` (`QuadrupedRig` plant/gait) |
| `src/core/hard/` | hard-surface: `shape2d` (outlines, `roundCorners`, `offsetShape`, `triangulate`), `hardmesh` (`HardMesh`, `extrude`, `lathe`, `sweep`, `bevelBox`, crease-angle `finish`), `model` (`hardToModel`) |
| `src/core/build.ts` | `buildCreature(def)` pipeline; `CreatureDef`, `PaintSpec`, `MeshSettings` |
| `src/core/export/` | `glb.ts` (`buildGlb`), `manifest.ts` (`writeModelAsset`, atomic merge of the flat `models.json`), `image.ts` |
| `src/archetypes/<family>/` | one folder per archetype: `params.ts`, `anatomy.ts`, `skeleton.ts`, `body.ts`, `paint.ts`, `anim.ts`, `index.ts` (`buildX(params)`) |
| `src/models/<family>/<id>.ts` | **one file per model** = a params object (or `CreatureDef`) |
| `src/models/<family>/registry.ts` | **your family's registry**: `export const registry: ModelEntry[]`. Auto-discovered; never edit `src/models/index.ts` |
| `viewer/` | three.js page + `server.ts`; `scripts/shoot.mjs` + `scripts/montage.py` = screenshot/contact-sheet harness |

## Adding a model to an existing archetype (e.g. another canine)

1. Copy `src/models/creature/wolf.ts` → `src/models/creature/<id>.ts`; change `id`, `seed`, proportions (`scale, bodyLength, chestDepth/Width, hump, legLength/Thick, paw,
   headScale, snoutLength/Width, earSize/Fold, tailLength/Thick/Curl, ruff, mane, tufts, crouch, scar`), `pattern` (`saddle|patch|frost|agouti`) and `palette`.
   Variants must differ by *proportion and pattern*, not only tint.
2. Add it to the family's `src/models/canine/registry.ts` list (`[...].map(canine)`).
3. `bun src/cli.ts build <id>` → open `http://localhost:5290/?src=/tmp/<id>.glb&clip=idle&preset=portrait`; iterate; then `--ship`.

## Adding a family (parallel-safe)

Each family owns its own folders and never touches shared files:
* `src/archetypes/<family>/…` — builder code (anatomy/skeleton/body/paint/anim/index), only if you need new code.
* `src/models/<family>/<id>.ts` — one file per model.
* `src/models/<family>/registry.ts` — `export const registry: ModelEntry[] = [...]` (`{ id, kind, build(log, opts) }`; `build` returns a `ModelData`).
`src/models/index.ts` globs `*/registry.ts` with `Bun.Glob`, rejects duplicate ids, and skips (with a loud warning) a family whose registry fails to import, so one WIP family cannot block another's builds.
Check yours with `bun src/cli.ts list` then `bun src/cli.ts build <id>`.

## Adding a new archetype (bear, boar, orc, golem, …)

1. `src/archetypes/<family>/`: write `anatomy.ts` (numbers only: joint positions, torso stations, scaled by `params.scale`), `skeleton.ts` (build a `Skeleton`; bone `root`, rest rotations identity,
   sockets `head hand_r hand_l back muzzle chest`), `body.ts` (a `Body`: `add/cut/addLate/mark` SDF parts, each with `{bone, w (skin falloff), tags}`; use `limb/tube/blade/flatCone`),
   `paint.ts` (`PaintSpec{albedo: PaintLayer[], shade: PaintLayer[], texture:{size}}`: albedo is *baked per texel*, shade is the per-vertex AO/cavity multiplier in `COLOR_0`),
   `anim.ts` (a `ClipSpec` per clip: `idle walk run attack attack2 hit death spawn special1..3`, loop for idle/walk/run, `hit` time metadata for attacks).
2. `index.ts` returns a `ModelData` via `buildCreature({ id, kind, body, skeleton, mesh:{voxel, tris, relax, project, focus}, paint, clips, height/radius/sockets/palette })`.
3. Mesh settings: voxel 6–7 mm for a 0.9 m creature (scale with `s`), target 3.5–4.8 k tris, `focus` the head/paws so the simplifier keeps detail where the camera looks.
4. Budget gates (checked by you before shipping): ≤ 5 000 tris, ≤ 32 joints, one skinned mesh, one material, root joint `root`, facing +Z, origin on the ground, +X = character's left.
5. Locomotion clips are *in place*; use `QuadrupedRig`/`twoBoneIK` for planted feet and put the authored ground speed in the model `extras` (walk/run m/s) so the game can scale playback.

## Aquatic archetype (`src/archetypes/aquatic/`) — hovering orca-hybrid (ice whale)

`buildAquatic(params)` (`params.ts` → `anatomy.ts` torso stations on a rising spine → `skeleton.ts` 24 bones: 6-bone spine `chest spine tail1-3 fluke`, `neck head jaw`, flukes, 2-bone dorsal, 3-bone pectoral + pelvic stubs, sockets `head muzzle chest back` → `body.ts` → `paint.ts` → `anim.ts`).
* `ice.ts` is a faceted-crystal SDF (`Crystal`: irregular hex prism + pyramid tip/flat apex) used for horns, crest, barnacle slabs and fin shards: late parts so facets stay crisp.
* The mandible is modelled closed and hinged open by `gape` in the bind pose (clips rotate it shut); mouth interior is *painted* via `mark` regions (carved cavities / thin gums / tiny teeth collapse in the decimator: use few bold fangs + a strong `focus` gain).
* `anim.ts` has `FinRig` (two-bone IK paddles planted on the ground, alternating sculling strokes) and `swim()` (travelling pitch+yaw wave with phase lag along the spine, flukes/dorsal follow through). `extras.speed` = stride sweep / (duty x cycle).
* One model today: `glacier_orca` (`src/models/aquatic/`). `.research/critters/whale_check.ts` CPU-skins every clip (ground clearance, planted-fin error).

## Humanoid archetype (`src/archetypes/humanoid/`) — heroes, human/orc/giant enemies, bosses

One parametric biped: anatomy (A-pose joints, torso stations) → skeleton (30 bones + optional chains) → SDF nude body (muscles, hands with fingers, feet) → head (human or wolf) → layered outfit pieces → hair → paint stack → procedural clips → GLB.
Heroes use only `buildHumanoid(params)`; enemies **import** from `archetypes/humanoid/index.ts` (never edit it) and put their own outfits/props/clips in their own archetype dir.

```ts
import { buildHumanoid, type HumanoidParams } from '../../archetypes/humanoid/index.ts';
export const params = (): HumanoidParams => ({
  id: 'orc_grunt', kind: 'creature', seed: 'orc_grunt', sex: 'm', bodyHeight: 2.0,
  build: { shoulder: 1.3, chest: 1.25, waist: 1.1, legLength: 0.85, armLength: 1.15, lean: 0.25, head: 0.9, muscle: 1.2 },
  skin: { base: '#6f8f4e', shade: '#3b5530', lip: '#7a3f3a', eye: '#d8b030', brow: '#26331c' },   // SkinPalette
  hair: { style: 'none', color: '#222' },
  outfit: [{ id: 'trousers', mat: 'cloth2', o: { baggy: 0.2 } }, { id: 'cuirass', mat: 'leather', o: { style: 'leather' } }, { id: 'pauldron', mat: 'plate' }],
  palette: { cloth2: '#3a2f28', leather: '#5a3b24', plate: '#6a6c70', gold: '#b88a2e' },
  style: 'club', tris: 4500, voxel: 0.009, texture: 512, liteHands: true,
});
// registry entry: build: (log, opts) => buildHumanoid(params(), log, opts)
```

**Contract (what every humanoid GLB looks like).** +Z forward, +X = character's LEFT (right hand at −X), Y up, origin between the feet, 1 unit = 1 m. One skinned mesh + one material (`baseColorTexture` × `COLOR_0` AO; optional emissive map).
Bones (rest = A-pose, identity rotations; `root` is the root joint): `root pelvis spine chest neck head muzzle back`, per side `clavicle_ upper_arm_ forearm_ wrist_ hand_ thumb_ fingers_` and `thigh_ shin_ foot_ toe_` (`l`/`r`),
plus optional chains from `rig`: `skirt_f/b/l/r` (`rig.skirt`), `hair1..3`, `scarf1..3`, `cape1..3`, `tail1..3`, `ear_l/r`. 30 base bones → fits the 32-joint crowd budget only with no chains.
Sockets (`sockets` map in extras / `asset.sockets`): `head hand_r hand_l back chest muzzle`. **`hand_r`/`hand_l` are non-deforming helper bones at the palm centre with identity rest rotation** (children of `wrist_*`); the game does `bone.add(weapon.root)`.
Hand frame: palm centre at the origin, grip axis Z, fingertips −Y, thumb +Z, palm medial = +X on `hand_r` / −X on `hand_l`. Weapon GLBs (`archetypes/weapon`) are baked into this frame (weapon +Y → hand +Z, edge +Z → hand −X for the right hand, +X for the left).

**Params that matter** (`params.ts` has doc-comments for all): `bodyHeight`; `build` (partial of `Build`: `shoulder chest waist hips arms forearms legs calves neck hands feet head legLength armLength muscle bust lean headForward stance armSpread`; 1 = reference adult, `lean` radians = hunch, huge `shoulder/chest/arms/hands` + short `legLength` = brute, `head` 1.3 + `legLength` 0.7 = goblin);
`face` (`jaw brow nose lips eyes cheeks slant ears`); `head: 'human' | 'wolf'`; `skin` (`SkinPalette`); `hair` (`style`: none topknot short ponytail long spiky bun braid swept wolf; `color highlight volume length`);
`outfit: PieceSpec[]` (inner → outer; `{ id, mat, o }`; later pieces paint over earlier ones); `palette` (named hex colours; a piece's `mat` is a palette key whose name minus trailing digits is the material family that selects the painted look — cloth, sash, paper, leather, plate, lacquer, gold, fur, hair, bone — e.g. `cloth2`, `leather3`; trim colour per piece = `o.trim` palette key, default `gold`/`trim`, `'none'` disables);
`style` / `styleB` (`WeaponStyle`: sword1h sword2h dagger bow fan bell claw spear club fist staff axe2h none → drives idle carry pose + attack/attack2/cast clips; `styleB` adds `_b` clip variants); `rig` (`skirt hairBones scarfBones capeBones tailBones earBones`);
`tier`, `glow {color, tags}` (emissive runes), `texture` (px; CLI `--tex=N` overrides), `voxel`/`tris`/`mesh {voxel,tris,focus,relax,normalStep,skin}` (crowd enemies: `voxel 0.008–0.01, tris 3500–4800, texture 512`), `liteHands` (mitten hands, −400 tris), `speed {walk,run}` (authored ground speed written to `extras.speed`; default derived from the gait), `extras`.

**Outfit pieces** (`id` → options `o`; `mat` default in brackets; see `outfit/*.ts`): soft — `tunic`(ext hem collar:'crew'|'v' sleeve) `trousers`(baggy end) `sash`(y width knot tails tail) `belt`(buckleMat pouches) `robe`(hem flare open collar sleeve wide; needs `rig.skirt`) `wraps`(where:'forearm'|'shin' rings) `boots`(start toeUp) `sandals` `gloves`(cuff) `scarf` `cape` `tail` `mantle`(rings spread) `headband` `mask` `hood` `talismans` `beads`;
armour — `pauldron`(lames size spike side) `vambrace`(from flare cop) `greaves`(cop copSpike) `cuisse` `cuirass`(style:'plate'|'leather' low pec bands ridge emblem straps) `tassets`(len count flare rows) `collar` `helm`(style:'cap'|'kabuto'|'crown' crest spikes tall) `horns` `gauntlets` `backpiece`; magic — `runes` (glow marks) `tattoo`.
Chain pieces (`scarf cape tail`) need the matching `rig.*Bones`. Garments are `cover()`s of the body's own skin parts (conform to muscles, skinned to the same bones) + plates/lofts; gold/edge trims are paint-only marks built from plate rims.

**Custom pieces and hooks (enemy-specific looks without touching this folder).**
* `PieceSpec.build: (e: PieceEnv) => void` (+ `defMat`) adds your own geometry as an outfit layer: `e.ctx.add(name, sdf, bone, {tags:[e.tag, …], w})`, `cover(e, ['pec_','torso_'], ext, {clip})`, `limbEnv/limbTube/limbBand`, `Loft`, `Plate`, `slabY/slabAxis/boxClip/clipMinus`. Or `registerPiece(id, fn, mat)` for a shared library.
* `hooks.head(ctx)` replaces the head (orc jaw/tusks, beast skull, helmed giant); `hooks.afterBody(ctx)` adds anatomy (extra tail/horns/spikes/second face); `hooks.afterOutfit(ctx)` adds props — reserve paint with `const p = ctx.piece('leather')` and tag your parts `[p.tag]` (trim marks `[p.trimTag]`);
  `hooks.paint(paint, a)` edits the paint stack (`paint.albedo/shade/emissive: PaintLayer[]`); `hooks.clips(clips, a, skeleton)` adds/replaces clips (`special1`, `slam`, …).
* `humanoidDef(params)` returns `{anatomy, skeleton, ctx, pieces, paint, clips, def}` for fully custom pipelines; `buildHero(def)` runs mesh → simplify → relax → skin → xatlas → bake (+ painter cache hook) → clips. `buildBody(ctx, {head, liteHands})` is the nude body builder.
* Props in hands: bake the weapon GLB in the hand frame (game attaches it to `hand_r`), or add small geometry in `afterOutfit` against the `hand_r` socket (`a.side(-1).palm`).

**Clips.** `makeClips(anatomy, skeleton, style, suffix, styles?)` → `idle walk run attack attack2 cast dash hit death spawn victory` (+ `_b` set: idle run attack attack2 cast dash). Poses are authored in the chest frame (`Key[]` of `PosePatch`: root/hip/spine/head Euler, planted foot targets `fl/fr`, hand grip point + blade/edge axes + finger curl) and solved by IK (`applyPose`): feet stay planted, two-hand grips stay together.
`StyleDef` = `{ cfg, idle, run, walk?, attack: Key[], attack2, cast, hit, attackHit…, castDur }`; pass `styles: { club: myClubStyle }` in params to override or add a style. Locomotion = procedural gait (WALK 1.0 s, RUN 0.667 s, planted feet; authored speed `AUTHORED_SPEED × bodyScale`). Secondary motion (skirt, scarf, cape, hair, tail, ears) is added automatically for existing chains.

**Viewer.** `?weapon=/tmp/<weapon>.glb[&weapon2=…][&wfix=1]` attaches weapon GLBs to `hand_r` / `hand_l` (add `wfix=1` only for weapon GLBs that are NOT yet baked into the hand frame).
**Painter.** Heroes/enemies ship with the procedural bake; `bun tools/painter/src/cli.ts ship <id>` replaces it (cache keyed by `extras.layoutHash`; humanoid builds publish it).

## Hard-surface models (props, weapons, metin stones, structures)

```ts
const m = new HardMesh();
m.group = 1;                                           // paint zone (index into groupColors)
lathe(roundCorners([[0,0],[.3,0],[.3,.1],[0,.1]], .02, 3, false), { segments: 28 }).appendTo(m);
extrude(outline, depth, { axis:'y', z0: .5, taper: .5, bevel:{ size:.01, segments:2 } }).appendTo(m, m4translation([x,y,z]));
sweep(circleShape(.012, 8), pathPoints, { closed: true }).appendTo(m);
return hardToModel(m.finish({ crease: 38 }), { id, kind:'prop', groupColors });
```
`finish()` welds vertices and splits normals at creases (small bevel angles stay smooth, real corners stay crisp). See `src/examples/stoneLantern.ts`.
Static models have no skin and no clips; the manifest entry is written the same way via `writeModelAsset`.

**Prop texture cap (payload policy, ARCHITECTURE §11).** A prop GLB carries one baked WebP atlas, and the first zone's window downloads 14 of them, so the atlas never exceeds `PROP_TEX_MAX` = 1024 px on its longest edge (`src/archetypes/prop/texCap.ts`): `bakeProp` aims the unwrap at `min(def.size, propTexMax(id))` and re-packs until the atlas fits (a `size: 2048` model bakes at 1024 and costs nothing extra).

**Landmarks** (`LANDMARKS` in `texCap.ts`: giant_pagoda, hall_tiled, pagoda_gate, lava_pillar) are the structures that fill a large part of the 1080p gameplay frame, where a 1024 atlas is magnified 2x to 7x (~67 screen px per metre against 10-60 texels per metre). They may keep up to `LANDMARK_TEX_MAX` = 2048 px, each with an `edge` and a `bytes` ceiling for the whole GLB; `propTex.ts` takes the highest WebP quality (floor 70) that stays under the ceiling, because more texels at a lower quality beat 1024 px at q92 for the same bytes (hall_tiled: 1536 px q80 is +2.3 dB and 2.5 KB smaller than the 1024 q92 file). A ceiling is a payload decision: the landmarks of the first zone's window carry the size of the 1024 file they replace, and `propTex.ts` prints the byte delta of every re-ship (a zone pays once per prop id its layout places).

A GLB shipped before the cap is brought to its budget without rebuilding the model: `bun tools/forge/scripts/propTex.ts [id|prefix*] [--src=<dir>] [--max=N] [--fit=<edge> [--limit=<bytes>]] [--dry] [--out=<dir>]` patches only the image bytes (the meshopt geometry stays bit-identical; every output is checked against the source and against the file it replaces), re-encodes with the bake's WebP settings (albedo q92, emissive q90; the quality steps down only when the result would otherwise grow, or for a landmark to meet its ceiling), never up-samples, validates with the Khronos validator, ships `<id>.<hash>.glb`, updates `manifest/models.json` under the `manifest-parts` mutex, runs `tools/pipeline/manifest.ts` and removes the stale build. `--src=<dir>` takes the source from a folder of pre-cap GLBs (`git show <rev>:<path> > <dir>/<file>`) instead of the shipped file: the way a landmark gets its resolution back. A forge rebake of a landmark bakes up to 2048 px at q92: run `propTex.ts <id>` once afterwards to meet its ceiling. `bun run --cwd tools/forge test` (`bun test scripts`, wired into the root `bun run test` and the deploy gate) runs `scripts/propTex.test.ts`, which checks the table and the re-encoder; the byte-ceiling cases need ffmpeg with libwebp on PATH and are skipped without it. Run `bun scripts/cleanRoomAudit.ts --scan <dir with the new files>` after a re-ship. The embedded format stays WebP (`EXT_texture_webp`, read natively by three's GLTFLoader): the game's loader has no KTX2Loader / Basis transcoder, so KTX2 would add a wasm + worker to the first-zone window and was not evaluated.

## Metin stones (`src/archetypes/metin/`, `src/core/ext/metins/`) — metin_stone + 4 Great Metins

Faceted fractured-stone monuments built from **convex solids** (`core/ext/metins/poly.ts`: half-space clipping, Voronoi/plane fracture, edge chamfers, flat-shaded faces) with **one rigid bone per piece**
(`chunk_NN` fracture plates/crystals/horns, `frag_NN` rubble, `shard_NN` floating rune shards, `core_NN` glowing cores), flattened into one skinned mesh, xatlas-unwrapped and **baked per texel** (`core/ext/metins/solid.ts`):
Imagegen's `tex_metin_obsidian` (stone) + `tex_rune_sigils/a/b/c` (glyphs/veins) are projected onto the model; hidden fracture faces and chamfer strips share a small reserved band at the bottom of the atlas (hot-core gradient / pale edge).
Specs: `stone.ts` (3.0 m, 24 bones, 2.7 k tris), `great_yeonmu.ts` (monolith + crown horns + floating void crystal, 42 b), `great_suryeon.ts` (four twisting horns around a pulsing void core on a sigil platform, 39 b),
`great_seori.ts` (vertebral pillar with ribs, glowing spine core and spiralling spectral chains, 40 b), `great_daeryeol.ts` (molten spire on a floating island over a broken lava-slab ring, 41 b). Great Metins are authored at real size (7.5–9 m, scale 1).
Build: `bun tools/forge/src/cli.ts build "metin*" --ship` (≈10 s per model; texture 1024² stone, 2048² greats).

**Renderer contract (for `render/metin.ts`).** One mesh, one `MeshStandardMaterial` (roughness 0.5–0.6):
* `map` = stone albedo (sRGB); `COLOR_0` is white.
* `emissiveMap` (same UV0) = **grayscale glow mask**: glyph strokes, fracture seams, veins, crystal cores (0..1). glTF `emissiveFactor` is only the *default* tint (stone = blue). **Per metin type set `material.emissive.set(def.rune)`** (the current `lerp(rune, 0)` ignores the colour) and animate `material.emissiveIntensity` per phase (suggested: idle 0.55–0.75, pulse 1.1–2.0, hit +0.6 spike, shatter flash 2.5 → 0.2).
  Damage stages need no extra texture: cracks/seams are in the same mask, so raising `emissiveIntensity` as HP drops reads as the stone cracking open.
* **Per-type glyphs** (`metin_stone` only): `bun tools/forge/src/archetypes/metin/variants.ts [type…]` re-bakes the emissive mask with a different sigil from `tex_rune_sigils` and writes `tex_metin_rune_<type>` (~53 KB each, identical UV layout to the GLB → drop-in) into `textures/metin/` + `manifest/textures.json`.
  Types (= MetinDef id without `metin_`): sorrow combat battle greed black darkness jealousy soul shadow toughness devil death murder. Swap on the per-instance material clone: `mat.emissiveMap = tex` with **`tex.flipY = false`, `tex.colorSpace = SRGBColorSpace`** (glTF UV convention; `TextureLoader` defaults to flipY=true and would mirror the glyphs). The GLB's built-in map is the `sorrow` glyph.
  The albedo carries a glyph-independent recessed medallion plate, so every variant sits correctly on the same albedo.
* Clips (rigid-bone TRS; `shatter` uses scale tracks): `drop` 0.9 s (frame 0 = falling pose, ends at rest), `idle` 8 s loop (floating shards orbit/bob, cores breathe), `hit` 0.35 s (squash + shiver),
  `pulse` 1.2 s loop (outward plate wave, faster orbits; renderer also drives `emissiveIntensity`), `shatter` 2.2 s (charge shudder → ballistic fragments with bounces → every bone scales to ~0 on the last frame). Durations equal the sim's `DROP_ANIM`/`BREAK_ANIM`.
  There is no `break` clip (roster lists one): use `shatter`.
* Great Metin `shatter`: debris is thrown outward; `extras.metin.debrisRadius` ≈ 5.5–6 m. The daeryeol low lava-slab ring (r 2.5–4 m, rocks to r 5.6 m, ≤ ~1.4 m high) leaves the centre clear for the fire dragon bursting out of the ground.
* Scene `extras.metin` = `{ glowMask, tint, pulseClip, great?, debrisRadius? }`, `extras.bounds`.

Glow never substitutes form: the silhouettes (obelisk + crystal crown + plinth + spurs, horn cage, spine, floating island) are modelled first and the glyph/seam mask only highlights them. New metin = a `MetinSpec` (pieces → `buildMetin`) + entry in `src/models/metin/registry.ts`.

## Pickups (`src/archetypes/pickup/`, `src/models/pickup/`) — xp_gem, yeop_coin, potion_hp, chest_wood/gold/boss

Hand-modelled hard-surface meshes (convex hulls + conforming edge splits + exact hidden-face clipping, `clip.ts`, `mesh.ts`, `bvh.ts`), per-vertex AO bake (`bake.ts`) and a paint kit (`paintkit.ts`, `chestKit.ts`, `chestFrame.ts`); one model per file (`gem.ts`, `coin.ts`, `potion.ts`, `chestWood.ts`, `chestGold.ts`, `chestBoss.ts`).
The game's pickup renderer (`render/fx/pickups.ts`) bakes every pickup GLB into ONE **vertex-colour-only** geometry (POSITION/NORMAL/COLOR_0; UVs and textures are ignored, skinned meshes are used in bind pose, the longest side is renormalised: gem/coin 0.42 m, potion 0.6 m, chests 1.05/1.2/1.6 m), so pickups carry their colour in `COLOR_0` and the xp gem is shaded with derivative flat normals + a per-instance tint (5 tiers).
Chests: 2 bones (`root`, `lid`; lid hinged at the back-top edge, rigid skin), one non-looping `open` clip (0.9 s: dip, swing to ~108° with overshoot, settle), face +Z, origin on the ground. Budgets: gem 122 tris, coin 492, potion 1194, chests ≈2.4–2.5 k tris (≤ 3 k).

## Weapons (`src/archetypes/weapon/`, `src/models/weapon/`, `scripts/weapons/`) — 32 ids = 8 families × tiers `_t0.._t3`

Static, unskinned, one mesh + one material, ≤1.5k tris. Specs are plain data (`src/models/weapon/<family>.ts`), builders live in the archetype dir: `sword.ts` (`SwordSpec`: warrior_sword/warrior_twohand/yacha_sword/ninja_dagger), `bow.ts`, `fan.ts`, `bell.ts`, `claw.ts`; shared kit `loft.ts` (rings, `bladeMesh`, `talon`, bezier/catmull), `parts.ts` (plates, lathe, grips, ribbons, hoops, `box`), `paintkit.ts` (steel/gold/wood/wrap/silk/jade/bone/fur materials driven by the Imagegen `tex_wp_*` tiles through each weapon's palette), `bake.ts` (vertex AO, xatlas unwrap, per-texel 3-D paint + emissive, Painter cache hook, `extras.layoutHash`).

**Frame.** Weapons are *authored* in a canonical frame (origin = grip centre, +Y business end, +Z cutting edge / shot direction, +X flat-face normal) and *shipped baked into the hero hand frame* so the game parents the GLB to the hand bone with no offset (agreed with Heroes): `hand_r = (-wz, -wx, wy)`; `hand_l = (wz, wx, wy)` (the **bow only**). Daggers and claws ship in the right-hand frame and are X-symmetric (the rig rotates 180° about hand Z for the off hand). Two-hander: second hand at `extras.weapon.handL` = hand-frame (0,0,0.21).
**`extras.weapon`** (hand-frame metres): `{ type, tier, hand, grip: one_hand|two_hand|dual|bow|fan|bell|claw, length, pommelZ, tipZ, trail:[base,tip], handL?, muzzle? }` (+ `string{z,yTop,yBottom}` for bows, `fan{radius,spreadDeg}`).
Per-tier look: t0 plain iron/wood → t1 gold collars/silk → t2 lacquer, gems, runes (emissive 256²) → t3 ornate gold, glowing runes/gems (emissive 512²).

Dev loop: `bun scripts/weapons/dev.ts "<id|prefix*>" [--tex=N --tilt=40 --roll=-25]` → `.research/forge/tmp/<id>.glb` (shipped frame) + `<id>.d.glb` (blade-up display copy, served by the viewer as `/tmp/<id>.d.glb`; bows use `--tilt=12 --roll=0`, fans `--tilt=0 --roll=-80`). `scripts/weapons/shootMany.mjs` (eval `browser` helper), `crop.py` (tile/crop shots), `validate.ts <glb…>` (Khronos gltf-validator). Ship with `bun src/cli.ts build "<family>*" --ship` then `bun tools/pipeline/manifest.ts`.

## Viewer / critic harness

`viewer/` query params: `src` (`/tmp/<id>.glb`, `/models/...`, `/research/...`), `clip`, `preset` (`portrait front side top back game head headside`), `t` (seconds), `yaw`, `ui=0`, `wire=1`, `bones=1`.
`scripts/shoot.mjs` exports `shoot(browser, {id, src, presets, clips, t, suffix})` → `.research/forge/<id>/<preset>_<clip>.png` and `sheet(...)` for clip filmstrips (PIL via `montage.py`). The `game` preset reproduces the in-game camera (FOV 40, pitch 55°, 22 m) with a 1.8 m human silhouette for scale.

### Gauntlet (quality loop)
After each iteration render turntables and inspect silhouettes with `scripts/shoot.mjs`.
spawn a **fresh-context** critic (no labels/hints) that answers only *which is the higher-quality production creature* + the single biggest gap of the loser, log it in `round-<n>.md`, fix, repeat.
Wolf logs: `.research/gauntlet/wolf/`.

## Contracts worth knowing

* **Textured output.** Creature GLBs carry `TEXCOORD_0` and a WebP `baseColorTexture` (`EXT_texture_webp`) multiplied by `COLOR_0` (AO/cavity/hemi shade). The game material MUST use `map` + `vertexColors`. Geometry/clip data is `EXT_meshopt_compression`-compressed; load with `MeshoptDecoder`.
* `POSITION` stays float32 (not quantised) so skinning/bind matrices are exact; normals are 10-bit, colour/weights 8-bit.
* Surface nets can emit inconsistent winding where two sheets share a voxel (claws, ear edges, mouth slit). `build.ts` fixes it with `orientToNormals`; keep that step for any new SDF pipeline.
* Clips are rotation deltas on identity rest rotations (+ optional root/IK translation); `hit` metadata is in scene extras.
* Authored creature clip speeds vary per rig: scale playback with `speed / authoredSpeed`.

## Core additions (additive, stable)
* `ModelData.emissive / emissiveFactor / material{roughness,metallic}`; `PaintSpec.emissive` (layer stack baked on the same atlas, black initial) and `CreatureDef.material`.
* Clip `PoseCtx.scale(bone, s)` → glTF `scale` channel (`BoneTrack.scale`); `Pose.scale?` is ignored by CPU `fk`.
* Painted-texture hook (`src/core/paint/cache.ts`): `.research/painter/cache/<id>/albedo.webp` + `meta.json {layoutHash,width,height}` replaces the procedural bake when `layoutHash` equals the build's (published as GLB `extras.layoutHash`); stale caches are reported and ignored; `FORGE_PAINTED=0` disables.
* CLI: `build id1,id2,prefix*` (comma list / several args), never use `build all --ship` while other families are work-in-progress.
* Canine extras: `tails` (fan of 2-bone tails `tailF<m>_1/_2`, ≤48 joints for 9 tails), `ribs`, `mange`, `palette.spirit` (emissive spirit fire), clips `special2` (fan flare) / `special3` (tail lash) when `tails > 1`.

## Fox-warrior archetype (`src/archetypes/foxwarrior/`)
Bipedal fox boss built ON the humanoid archetype without editing it: `humanoidDef(params)` → append fan-tail bones (`withFanTails`, 30 + 2 per tail = 48 joints for 9 tails) → `hooks.afterBody` adds the tail tubes (spirit-fire tips are tagged and glow through the humanoid `glow` hook) → every humanoid clip is wrapped with `animateTails(...)` and boss clips `special1..3` are appended → `buildHero(parts.def)`. Model: `src/models/fox/miho.ts` (+ `registry.ts`). Reuse for any humanoid with extra rigged appendages (extra bone chains + wrapped clips).

## Painted textures (AI repaint)
Freeze geometry → `bun tools/painter/src/cli.ts ship <id> --subject "..." --extra "..."` (build → Painter repaint → `.research/painter/cache/<id>/` → `build <id> --ship`). All wolves/dogs and the fox ship painted; the hook is `src/core/paint/cache.ts`. Any geometry/UV change invalidates the cache (STALE warning) → re-run `ship`.

## Known gaps / roadmap
* Fur is painted (strands/clumps baked in albedo) plus displacement clumps; no shell or card fur, so silhouettes are smooth. Ruff and tail carry the only geometric fur.
* Wolf face is good at gameplay distance; at portrait distance the eye and lip detail is still simpler than the best hand-sculpted assets.
* Baking a 1024² albedo takes ~12 s; whole-family builds ~4 min.
