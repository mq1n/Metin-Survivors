# @ms/painter — AI repaint + projection bake for forge models

Forge builds geometry, skin, clips and a *procedural* albedo. Painter replaces that albedo with a hand-painted-looking texture:

```
forge GLB ──► clay turnaround sheet + UV/normal/depth passes ──► codex image_gen repaint ──► per-view affine fit
          └─► inverse-projection bake into the forge UV atlas ──► levelled WebP ──► GLB texture swap + forge cache
```

No external game texture is ever sent to the generator; the prompt is a text style description plus *our* clay sheet.
Geometry, skin, clips and `extras` are untouched (the GLB is edited at the binary level: only the image bytes change).
Painted texture sheets are validated against clay sheets in blind review rounds.

## CLI

```
bun tools/painter/src/cli.ts paint <glb> --subject "<short description>" [--style fantasy] [--material fur|scale|cloth|skin|stone|wood|metal|spirit (a+b allowed)]
        [--views left,right,front,back,top,3q] [--out <glb>] [--id <id>] [--tex 1024] [--tries 2] [--candidates 1|2]
        [--extra "<free text: colours, scars, markings>"] [--reuse <painted.png>] [--no-cache] [--tag <name>] [--effort low]
bun tools/painter/src/cli.ts ship <id> [--subject "..."] [--material ...] [--extra ...] [--no-build] [--no-ship]   # forge build → paint → cache → forge build --ship
bun tools/painter/src/cli.ts batch <jobs.json> [--only id,id] [--parallel 2] [--skip-cached]                     # many models, see jobs/canine.json
bun tools/painter/src/cli.ts rebake <id...> [--min-gain 1.5] [--score 0.7] [--tex 1024]                              # re-bake the stored painted sheet (no codex): after bake/levelling fixes
bun tools/painter/src/cli.ts validate <glb...>                                                                   # gltf-validator
bun tools/painter/src/cli.ts sheet|repaint|bake|inject|dump|styles|help
```

* `paint` writes `<out>` (default `<glb dir>/<id>.painted.glb`) and, when the GLB carries `extras.layoutHash` (every textured forge build does), the **forge cache** `.research/painter/cache/<id>/{albedo.webp,meta.json}`.
* `ship <id>` is the one-liner for forge agents: it (re)builds the model so the layout hash is current, paints it, then rebuilds with `--ship`; forge finds the cached texture and ships it (`FORGE_PAINTED=0` disables the hook). It aborts if forge reports `STALE` afterwards.
  `--subject` / `--material` default to `content/model_roster.json` (`description`, archetype → material guess); `--views` defaults to left/right/front/back/top/3q for animals and front/back/left/right/3q/3q_back for upright figures (height > 1.25 × footprint).
* The result is a single JSON line: `{ id, out, cache, shipped, score, cost:{minutes,codexCalls,codexSeconds}, iou:{view:…} }`. Run log: `.research/painter/runs.jsonl`.
* Needs a **textured** forge GLB (TEXCOORD_0 + baseColorTexture). Vertex-colour-only models (weapons/props with group colours) cannot be painted until forge exports UVs + a texture for them.
* **Cost per model** (measured on the 8 canines, 2 in parallel): codex `image_gen` call 73–99 s (effort low, 1 call), geometry/sheet/bake 45–60 s ⇒ **≈ 2.0–2.7 min wall, 1 codex call**. The alignment gate (mean silhouette IoU ≥ 0.80, min ≥ 0.65) triggered one automatic re-call (alpha_blue_wolf: IoU 0.556 → re-painted → 0.912; 3.9 min, 2 calls). Painter never runs more than 2 codex sessions at once (`PAINTER_CODEX_MAX`).

### Writing a good `--subject` / `--extra`
Short, concrete, anatomy-first: `"a menacing timber wolf in a stalking crouch with a thick ruff, plume tail, pointed ears and a ridge of raised hackles"`. Put colours/markings in `--extra` (`extras.palette` of the GLB is appended automatically).
Variants of one family (alpha/blue/grey) differ by `--extra` colour + marking text — never reuse another model's painted sheet: the sheet is geometry-specific.
The default fur wording explicitly forbids feather/scale-like scallops (the generator sometimes paints dark fur that way).

## Forge cache contract (written by painter, read by forge `core/paint/cache.ts`)
`.research/painter/cache/<id>/albedo.webp` — sRGB WebP in the **same UV layout** as the forge build (any size, painter writes 1024² by default; 208–296 KB for the canines);
`meta.json` — `{ layoutHash, width, height, painter:{…} }`, `layoutHash` copied from the GLB `extras.layoutHash`.
Any geometry/UV change in forge changes the hash → forge logs `STALE`, falls back to the procedural bake, and the model must be re-painted (`ship <id>` again). Paint **after** geometry is frozen.
COLOR_0 (AO/cavity shade, ≈0.7 mean) still multiplies the texture in the engine, so the bake lifts the albedo median luminance towards 0.46 (`--target-median`, `0` = off) with the gain capped at 1.45 (`--max-gain`; dark-outfit characters stay dark) and a hue-preserving highlight roll-off (an earlier per-channel version turned warm skin yellow-green).
Paintings are only valid on the exact sheet they were made on; `--reuse`/`rebake` take the chroma background from the painting's own border and refuse to overwrite a cache whose bake score drops > 0.06 (`minScore`).
Machine-wide codex cap: `PAINTER_CODEX_MAX` (default 2) slots, lock files in `.research/painter/locks/` (stale locks of dead pids are reclaimed), so any number of agents can run `ship`/`batch` at once — they queue.

## Pipeline details (py/)
1. **sheet** (`sheetlib.py`) – orthographic left/right/front/back/top + a 3/4-top-down view (game camera pitch) rendered by a numpy z-buffer rasteriser as neutral clay with soft AO + subtle outline on a flat chroma background (cyan/magenta/green/yellow, whichever is farthest from the model palette). Views are packed on one 1536×1024 canvas at a common px/m scale (row-assignment solver; the top view may rotate to pack larger). `layout.json` stores every camera + rect; `pass_uv.png / pass_normal.png / pass_depth.png / passes.npz` are the per-pixel texel coordinate (R=u,G=v,B=depth), view-space normal and depth maps.
2. **repaint** (`codex.ts`) – `codex exec -s read-only --skip-git-repo-check -i sheet.png`: one `image_gen` call; the wrapper prompt makes codex only call the tool and print the path; painter copies the file out of `~/.codex/generated_images/<thread>/`. Prompt text lives in `styles.ts` (style presets × material hints); each run's prompt is saved next to `raw.png`.
3. **align** (`alignlib.py`) – foreground mask of the painted sheet (distance from the flat bg colour), per-view silhouette IoU vs our render, ECC affine fit (rejected unless near-identity). Typical result: 0.90–0.97 after the fit.
4. **bake** (`bakelib.py`) – for every UV texel: 3D position/normal from the UV rasterisation, projected into each view, depth-tested, weighted by `(N·V)^p` × edge distance × inside-mask, winner-biased blend across views (no ghosting), unseen texels (≈25 %, undersides/inner limbs) filled from the nearest seen surface points in 3D, 12 px push dilation, albedo levelling, WebP. A reprojection check renders the texture back into every sheet view (`recon.png`, per-view error in the report).
5. **inject** (`glb.ts`) – replaces the image bufferView only; meshopt streams / quantisation / skin / clips / extras stay byte-identical; `image.extras.painter` records style, subject, views, layoutHash.

Scratch lives in `.research/painter/work/<id>/` (`sheet/`, `paint/<tag><n>/{prompt.txt,raw.png,tex.png,recon.png,diag_views_p0.png}`, `result.json`). Gauntlet helper: `scripts/gauntlet.mjs` (`prepareRound` renders ours + a reference in identical viewer presets, random A/B, `assignment.json`).

## Budget notes (threejs-aaa-graphics-builder technical-art: ≤60 textures, ≤256 MB texture memory desktop / 128 MB mobile)
A painted 1024² albedo costs ≈ 5.6 MB of GPU memory with mips (RGBA8), 512² ≈ 1.4 MB, plus 208–300 KB (1024²) of WebP in the download. One texture + one material per creature, so a zone with 8 painted creature types ≈ 45 MB at 1024². Use `--tex 1024` for heroes, bosses and the creatures seen up close, `--tex 512` for pure crowd fodder (≈ 25 px/m on screen in the game camera). Painter writes the texture at the size you ask for; forge accepts any size from the cache.

## Generality check
Upright figure (`warrior_m_t1`, cloth+skin, views front/back/left/right/3q/3q_back): IoU 0.953 mean after the affine fit, 1 codex call, 2.0 min — `.research/painter/shots/front_idle_hero.png`. Not shipped (heroes are Heroes' to paint once their geometry is frozen).

## Limits / tried and rejected
* The generator returns ≈1536×1024: ~350 px/m on the sheet, so 1024² textures are as sharp as the source allows; close-up heads are soft. **Tried: a second "head detail" sheet** (higher scale, 2nd codex call colour-locked to the body paint via the finished sheet as reference): the generator re-imagines the head anatomy at close range (different colours, extended fur tufts), so features land off the mesh (eye lost, head lighter than the body) — worse than the body sheet alone, removed.
* Seams between views are blended by weights, not graph-cut; look at `diag_views_p0.png` if a model shows a hard colour break.
* Texture drift is bounded by the alignment gate; geometry whose silhouette the generator cannot follow (tiny thin parts, tails behind legs) is blurred by the per-view blend rather than misplaced.
