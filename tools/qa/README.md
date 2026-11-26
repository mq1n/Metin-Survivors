# tools/qa — capture + compare kit for builders and critics (dev only, never shipped)

## Shared dev server (one for every agent)

`http://127.0.0.1:5183` serves the live tree (Vite dev, **HMR off**: a capture is never reloaded mid-shot, and each fresh
page load picks up the current files). Do not stop it. If `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5183/`
does not print 200, restart it in the background (Bash `run_in_background`):

    cd apps/game && MS_NO_HMR=1 bunx vite --port 5183 --strictPort --host 127.0.0.1

`window.__ms` (game), `window.__ui` (UI gallery) and `window.__gallery` (VFX gallery) only exist on this dev server.
A syntax error in a module you are editing breaks the page for every agent — keep edits compiling (Edit tool, small steps).

## shot.ts — screenshots (PNG) + JSON summary with console errors

Chrome instances are capped machine-wide (6 slots by default, `MS_QA_SLOTS`; lock files in `%TEMP%\ms-qa-locks`) — if all are busy the call waits.

**Reliability (two failures that used to kill a capture, both retried now).** Both are about the machine, not about your change:
- *Chrome opens no DevTools port* (or the CDP connection fails): the browser is killed and started again, up to 3 tries per
  attempt (`--chromeTries N`, `--chromeWait s` per try, default 45 s; env `MS_QA_CHROME_TRIES`, `MS_QA_CHROME_WAIT`). The notes of
  the JSON summary say `chrome start 1/3 failed (...)`. `MS_QA_CHROME=<exe>` picks another browser.
- *A dev-server module error*: another lane's half-written file makes the shared dev server answer HTTP 5xx for a `/src` module,
  show the Vite error overlay, or fail the run load with `x is not defined` / `failed to fetch dynamically imported module`
  (the game's `run load error`, a `[zoneScene] ... failed to build` console error, a page error of that kind). The capture is
  dropped at once (not after the 240 s timeout), the Chrome slot is released, it waits 20 s (x1.6 per retry, at most 90 s) and
  runs again, up to 4 more times (`--retries N`, `--retryWait s`; env `MS_QA_RETRIES`, `MS_QA_RETRY_WAIT`; `--retries 0` fails at
  once). Every retry is a line in `notes` (`attempt 1/5: dev-server module error, waiting 20 s ...: HTTP 500 /src/x.ts`). When
  it never clears the run ends with `FAILED: dev-server module error that did not clear in N attempt(s): <the error>` and
  `"devServerError": true` in the summary (exit code 2). The same text repeating on every attempt is usually a bug in your own
  edit, not another lane: open the dev server in a browser and fix it. Shots written by an abandoned attempt are overwritten by the next.

`--warnings` adds `consoleWarnings` (the browser console's warnings: shader program info logs, deprecations) to the JSON summary, next to
`consoleErrors`; use it after a shader change to see that the program compiled without new warnings.

Output: `--out` is a
`.png` path (single shot) or a directory (several shots). Default viewport 1920×1080, DPR 1 (`--w --h --dpr`).

**Game** — starts a real run (fixed scatter seed), god mode, auto-picks cards, then shoots:

    bun tools/qa/shot.ts game --zone yeonmu --class warrior [--doctrine a|b] [--sex m|f] [--tier 0..3] \
        [--spots "spawn:0,0;hall:26,-30,30"]   # name:x,z[,zoom]  — teleports the hero, settles, shoots
        [--ui real|none|dev]                    # real HUD (default) | HUD hidden (clean world shot) | dev panel
        [--time 350]                            # jump the run clock (s) → later time bands / bosses
        [--grant "bladewheel:7,bash:3"]         # give skills at a rank (0..7 = 1,2,3,M1,M2,G1,G2,P)
        [--boss tiger_god]                      # spawn a boss next to the hero
        [--advance 2.5] [--settle 1.6] [--freeze] [--zoom 22] [--quality low|medium|high|ultra]
        [--eval "<js>" | --eval @file.js]       # async snippet in the page; may `await import('/src/...')`
        [--still [--stillFrames 24]]            # deterministic world shot (see below)
        [--content '<json>' | @file.json]       # QA content override: play a system that ships switched off (see "Content overrides")
        [--query "up=noarc,nocorr"]             # extra k=v pairs on the page URL (every mode)
        --out .research/<task>/shots

Zones: `yeonmu`, `suryeon`, `seori`, `daeryeol`. Classes: `warrior ninja yacha shaman wolfman`.

`--still` (with `--ui none`): the frame loop is stopped before the run starts, the sim never ticks (world time 0: no
enemies, pickups or casts), ambient VFX are cleared, and each spot renders exactly `--stillFrames` frames of a fixed
1/60 s. The same spot list on the same tree gives bit-identical PNGs (render time accumulates over the list, so compare
only runs with the same list). Use it for before/after pixel diffs of the world; use normal shots for the live look.

## Content overrides and query switches (QA only)

Systems that ship switched off in the content (run events, affixes, trials, ... until their tuning WP flips them) stay playable and
measurable through one JSON patch that the browser, the soak and the gate all merge into the content before the first run. It never
ships: `app/content.ts` reads `globalThis.__MS_CONTENT_OVERRIDE__` only when `import.meta.env.DEV` (the dev server) or
`VITE_QA_HOOKS === '1'` (the frozen QA snapshot build of `playthrough.ts`, like `window.__ms`); a plain production build folds the
condition away and contains neither the string nor the override module (checked by grep on `dist`).

**Patch format** (`apps/game/src/data/override.ts`, `applyContentOverride(db, patch): string[]` returns the changed paths):

- the keys are the content database's top-level keys (`classes skills passives stones trinkets enemies bosses metins zones gear talents empires story balance`, plus any section a later WP adds); anything else is rejected
- objects merge recursively; a key the content does not have is added (that is how an optional system is switched on)
- an array whose items all have a string `id` merges **by id**: `{"zones":[{"id":"yeonmu","metins":{"firstAt":20}}]}` changes only that field of that zone; an unknown id appends an item (it must then be a complete, valid one)
- every other array (numbers, pairs, items without an id, `[]`) **replaces** the content's array; scalars replace; `null` deletes a key; a value cannot change its kind (number -> string, object -> array)
- the patch is merged into a clone and the clone is checked with `validateContent`; the override is refused (named errors, the live content untouched) when it adds a content error. A typo that adds a key nothing reads is NOT an error: the log line marks added keys with `(+)` and deleted ones with `(-)`, so check it

**shot.ts** — `--content <json|@file>` sets `window.__MS_CONTENT_OVERRIDE__` before the page loads (all modes; the game logs `[content] QA override applied, N changes: ...`, which lands in `notes`). A refused override fails the capture at once with the named errors (`FAILED: the game refused the --content override`, exit 2, no retry). `--query <k=v&k2=v2>` appends pairs to the page URL in every mode (`game`, `ui`, `vfx`, `url`); a key the mode already sets (`quality`) is replaced by yours, and `location.search` shows the text as typed. In PowerShell put the JSON in a file (`@f.json`): the shell eats the quotes of an inline patch.

    # a metin falls at 0:20 instead of 1:00: the run clock is set to 0:30, so one is on the way at once (the same without --content: none)
    bun tools/qa/shot.ts game --zone yeonmu --time 30 --advance 1 --spots "metin:8,0,26" --settle 9 \
        --content '{"zones":[{"id":"yeonmu","metins":{"firstAt":20}}]}' --query "up=noarc,nocorr" --out .research/<task>/shots
    bun tools/qa/shot.ts game --zone yeonmu --content @.research/<task>/events_on.json --out .research/<task>/shots

**Run-start fly-in switch** (FEEL-04, `render/camera.ts` `parseFlyInOff`) - the page query `up=noflyin` (`shot.ts --query "up=noarc,noflyin"`, `programs.ts --query`) switches the 2.5 s run-start fly-in off, so a live capture starts on the gameplay camera: it is also the way to capture a "before" side of a pair from the current tree. Without it a LIVE `shot.ts game` capture (real loop, no `--spots`, a short `--advance`, or a slow machine that sits in the up-to-2 s held wait) can catch the camera mid-flight (17 degrees, 62 m, easing into pitch 55 over 2.5 s at a camera height of about 18 m, after the intro card closes or after 10 steady frames). `--spots` shots and `--still` captures are safe without it: a teleport (`rig.snap()`) ends the fly-in for good. Same rules as the arc switches: words comma separated, not case sensitive, other `up=` words ignored, dev server and `VITE_QA_HOOKS=1` builds only. The fly-in also skips itself on the low tier, with screen shake 0, with the OS setting prefers-reduced-motion, for a co-op guest and for a restart (same zone and hero within 10 minutes of the run that just ended); a move input during it runs what is left in 0.4 s.

**Run light arc switches** (PL-03a, `render/terrain/arc.ts`) — the page query `up=noarc,nocorr` (`shot.ts --query "up=noarc,nocorr"`, `programs.ts --query`) forces the run light arc and the corruption tint of the world to the identity, so a capture of another lane's change (a zone look, damage numbers, the hero ring, ambient loops) is not contaminated by the arc that lands in parallel. Either word alone works (`up=noarc` / `up=nocorr`), the words are comma separated and not case sensitive, and other `up=` words (`nobeacon`) are ignored. Like `window.__ms` and the content override it exists only on the dev server and in `VITE_QA_HOOKS=1` builds: a plain production build folds the condition away and ignores the query. `noarc` makes `RunArc` compile no keys (sun, hemi, fog, haze, grade, pool gain and medallion glow stay on the zone's preset at every run clock); `nocorr` pins the corruption input of the arc to 0 (PL-04 blends the world tint with it). Both arms of a live before / after pair pass it, unless the change under test IS the arc or the corruption tint. Stills (`--still`, run clock 0) are never affected: the arc is the identity at t = 0. In a dev eval the arc of the running zone can be tried by assigning `look.arc` (`(await import('/src/render/terrain/look/index.ts')).lookFor('yeonmu').arc = [{ t: 0 }, { t: 900, poolGain: 3 }]`): the evaluator recompiles when the array is replaced.

**soak.ts** — `--override <json|@file>` is applied in the main process before the plan is built and in every worker before its first case (the workers get the parsed patch as inline JSON, so a changing file cannot split the pool). The report `meta.override` holds the argument, the patch and the changed / added / deleted paths; the console prints `content override: ...`; every row's `repro` ends with `--override <the argument>`. A refused override stops the run before any case (exit 2). The soak does not count `chestLocked` events itself (rows carry `chests`, the number opened); the A0-BAL-1 gate records them.

    echo '{"balance":{"chestCost":{"perOpen":200}}}' > .research/<task>/chest200.json
    bun apps/game/src/dev/soak.ts --zones yeonmu --classes warrior,shaman --doctrines a --difficulty normal --seedList 1,2 --stats god --jobs 2 --quiet \
        --override @.research/<task>/chest200.json --json .research/<task>/soak_chest200.json     # same seeds without --override = the control arm

Through the CPU pool: `bun .research/upgrade/tools/pool.ts run --slots 4 -- bun apps/game/src/dev/soak.ts ... --override @f.json`.

## zonecheck.ts — zone gates (standard shot set, palette numbers, regression)

    bun tools/qa/zonecheck.ts --zone yeonmu|suryeon|seori|daeryeol|all [--set world|hud|gallery|all] [--still] \
        [--only spawn,river] [--shots <dir>] [--baseline .research/zones_core/baseline_still [--tol 0.5]] [--out <dir>]

Shoots the standard spots of `.research/zones_core/spots.json` (`{zone: {name: [x, z, zoom?]}}`, names = the audit
evidence names; `hud*` spots are live fights with the HUD), runs `compose.py stats` on every shot and gates the roles of
`.research/zones_core/spots_meta.json` (field palette + high-frequency ratio vs the target baseline, cliff dark
share, water luma, world-edge void, screen-door energy round the hero) against the starting targets (zones REPORT §3.2)
merged with `look.targets` of `apps/game/src/render/terrain/look/<zone>.ts`. `--baseline` adds a mean-absolute-pixel diff
per world shot (use `--still` for both sides). Writes `<out>/<zone>/zonecheck.json` + `stats.json`; exit 1 on any FAIL.
Official OLD baselines (2026-10-13, before the zones-core changes): `.research/zones_core/baseline/<zone>/` (normal shots,
incl. HUD + Yeonmu `g3`) and `.research/zones_core/baseline_still/<zone>/` (still world shots).

**UI** — the UI gallery (mock store, no engine) for any screen id in `apps/game/src/ui/gallery.ts` (`/?ui=gallery` exists on the
dev server and in builds made with `VITE_UI_GALLERY=1`; a plain production build neither routes nor bundles it):

    bun tools/qa/shot.ts ui --screens menu,heroSelect,zoneSelect,hud,hud-boss,levelUp,essence,chest,pause,runEnd,results \
        [--lang tr|en] [--class ninja --doctrine b] [--w 390 --h 844 --dpr 3 --touch --mobile] --out .research/<task>/ui

**UI probes** (fontsize, tapsize, overflow, contrast, touchhint, safe4 ... one JSON per screen x viewport, with the screenshot of the same page via
`--shots`): `bun tools/qa/probes/run.ts --fresh --probes fontsize,tapsize,overflow,contrast --screens @list --vp 390x844@3t,844x390@2t --lang en
--shots <dir> --out <json>`. Use `--fresh` for a gate (gallery state carries over otherwise). What each probe measures, its options and the known
false-positive classes (the 2026-10-22 phone gate: the HUD root, screen-reader-only labels, gold plates / parchment / pips, badges of rows scrolled out
of view): `tools/qa/probes/README.txt`. `--insets auto` runs the same probes with simulated iPhone insets (portrait t47 b34, landscape r47 b21 l47; the scenario is
re-applied after the insets are set) and paints the unsafe bands on `--shots` captures: the overflow-under-insets pass of the phone gate. `--before <part>/start` serves the
CSS files of a fix part's start copies instead of the live ones (a BEFORE capture for blind pairs, the shared tree stays untouched). The probe `wait` only waits, for
captures without a settle step.

**VFX gallery** — any preset ids, deterministic time samples:

    bun tools/qa/shot.ts vfx --ids sk.bladewheel,sk.crushing_blow --times 0.3,0.8,1.4 [--zoom 12] [--q high] --out .research/<task>/vfx

**Any URL** of the dev server (terrain gallery `terrain.html`, demos `/?demo=<name>`):

    bun tools/qa/shot.ts url --url "/terrain.html?mode=veg" [--wait "window.__ready===true"] [--eval ...] --out x.png

## payload.ts — download budget gate (production build, ARCHITECTURE §11)

    cd apps/game && MS_STRICT_ASSETS=1 bunx vite build --outDir <dir> --emptyOutDir   # outside dist/ if others use it
    bun tools/qa/payload.ts --dist <dir> [--out .research/<task>/payload] [--tail 30] [--top 3] [--url http://127.0.0.1:<port>]
        [--class warrior|ninja|yacha|shaman|wolfman] [--zone yeonmu|suryeon|seori|daeryeol]

Serves the build itself (no cache), walks menu → Play → hero select → zone select → Start → HUD and prints per-category
bytes for: `menu` (until the main menu shows, budget 6 MB), `menuIdle`, `gestureToStart`, `zone` (requests issued after the
Start click until HUD + 6 s, budget 15 MB), `zoneBlocking` (until HUD) and `background` (`--tail` s more, not gated). The
report starts with the window definitions and lists the `--top` biggest files of every category. js/css/json are counted
brotli-compressed, binaries as served. Exit 1 when a budget is missed. `bun run deploy` runs it as a blocking step
(`--tail 20`; `--allow-over-budget` turns a miss into a warning).

- **A URL counts once per page session** (at its first fetch). The tool disables the HTTP cache, a real browser serves a
  repeat fetch from its cache (`/assets` is `immutable`). The same windows with every fetch counted (`windowsWithRepeats`
  in `payload.json`, "with repeat fetches" on each window line) and the repeated files (`repeats`) are reported, so a
  file the game really downloads twice stays visible.
- **Waits**: 120 s for Chrome to open its DevTools port, for the CDP connection and for every screen (180 s for the HUD): a
  Chrome start took 37-41 s and the connection 54-65 s on a machine shared with other agents.
- **Boot failures**: when the main menu or the HUD never shows (also: the boot's fatal screen `#boot-retry`, or the run's
  load-failure panel `.ms-boot.is-failed`) the report starts with `BOOT FAILED: <first page error | console error | the
  page's own error text> (<what was waited for>)` and the exit code is 1. A session with a page error or a 4xx/5xx
  response (other than `/api/`: a static server has no API) fails too; the counts are on the `session:` line. Console errors are
  listed but do not fail the gate (headless Chrome logs "The AudioContext encountered an error from the audio device" on a loaded
  machine).
- **Music**: the report lists the looping sources > 30 s that started (menu theme, zone track) with their time relative to the
  HUD. The zone track is due 9 s after the run's first steady frames (`audio/index.ts`), so use `--tail 20` or more to see
  it start.
- **`--class` / `--zone`** walk another hero / zone than the default (warrior, yeonmu = the game's own defaults: nothing is
  seeded, no card is clicked, the report is the one it always was). The walk clicks that hero card and that zone card and reads
  the selection back (`aria-checked`) before the Start click; the report then starts with a header line, e.g.
  `walk: class shaman, zone suryeon = zone 2 of 4, profile seeded with zones yeonmu + suryeon unlocked   (on screen at
  Start: hero shaman, zone suryeon)`, and `payload.json` has a `walk` object. Every hero is selectable on a fresh profile;
  a zone past the first is not (the chain opens when the one before it is cleared), so the walk first writes a saved profile
  with the chain up to the zone unlocked into the page's IndexedDB (`metin-survivors` / `kv` / `save.main`, the record of
  `meta/storage.ts` with no runs, no gold, no gear: `payloadReport.ts` `seedRecord`; a page the tool answers itself provides
  the origin, nothing of it is counted and the clock of the report starts after it). Other heroes have a bigger NOW set of VFX
  art than the warrior and later zones have more props, so each (hero, zone) pair is its own window: gate the ones you ship.
  An unknown value exits 2 with the list of valid ones. Unit tests: `apps/game/src/dev/payloadReport.test.ts`.
- `--url <base>` walks a server that is already running instead of serving `--dist` (which is then only read for file sizes):
  `cd apps/game && node ../../workers/api/node_modules/wrangler/bin/wrangler.js pages dev ./dist --port <port> --ip 127.0.0.1`
  gives the production headers (`_headers` CSP, `_routes.json`) with the repo's wrangler.
- `payload.json` keeps `marks`, `windows`, `requests`, `errors` (what `bun run deploy` and earlier notes read); new: `windowsWithRepeats`,
  `definition`, `repeats`, `music`, `consoleErrors`, `badResponses`, `bootFailed`, `timing`.

## soak.ts — headless play-every-run stability soak (no browser, no Chrome slot)

    bun run qa:soak -- --suite release --jobs 6 --budget 28 --json .research/qa/<role>/soak.json   # zones x classes x doctrines x difficulty x 3 seeds (god) + plain + Run Options max + determinism 4
    bun run qa:soak -- --zones <z> --classes <c> --doctrines a --difficulty hard --seedList 7 --stats plain --jobs 1   # one case (every row of the JSON has its own `repro`)
    bun run qa:soak -- --selftest      # 24 injected sim faults + a synthetic leak + 4 end-to-end pool checks (budget cut, dead workers, real leak, quiet control); exit 1 if one is missed

`apps/game/src/dev/soak.ts` (CLI) + `soakCore.ts` (runner): the REAL sim on the REAL content and zone terrain (`field.env` + a bossModel stub from the manifest, as app/run.ts), the sim-test bot with a card policy (first / last / random) and an unstuck wiggle; zones and classes come from the content, never hard-coded. Per run: throw, non-finite state (positions / hp every tick, every event's numbers, the 10 Hz HUD snapshot `World.hud` the game builds, boss / metin / skill state), entity caps, run end / victory with the final boss and great metin, scheduled bosses and metins, hero stuck (0.5 m for 30 s) / confined (2.5 m for 60 s: an enclosed pocket, or no crowd to explain it) / off walkable ground, spawns on blocked ground (the point itself, 0.05 m), undrained or flooding modals (> 90 in 30 s), the abandon result (`buildResult(false)`) of a run that did not end, tick time (mean / p99 <= 12 ms / max <= 250 ms; a hit is re-run and kept when the SAME tick is slow again), events per second; across runs: RSS / heap leak per worker (robust slope + growth) and determinism pairs. JSON + markdown table + `.rows.jsonl`; exit 1 on any violation, on a planned case that was not run (`--budget`, dead workers: GLOBAL not-run / pool-error) and on a worker failure. `--env full` also wires `moveCircle` + `surfaceAt` (the game does not). `soak.test.ts` keeps it alive in vitest. Review of the detectors (false negatives found and fixed): `.research/qa/soak-review/`.

## chunkGraph.ts — static import cycles between the emitted JS chunks (build gate)

    bun scripts/chunkGraph.ts apps/game/dist [--text]     # JSON report (--text: for people); exit 1 on a cycle, 2 when unreadable

Reads every `.js` of a build, takes the static `import` / `export … from` edges between them and fails on a cycle, printing the
chain (`assets/vfx-A.js -> assets/vfx-B.js -> assets/vfx-A.js`); `import()` is not an edge. The strict build (`writeBundle`,
`apps/game/vite.config.ts`) and the deploy `site` step run it. Unit tests: `apps/game/src/dev/chunkGraph.test.ts`.

Production builds stream later creatures, the zone's metin stones (shared GLB + rune glyphs, from 12 s into the run), the ground normal maps (and, as flat stand-ins that swap, the rock / bark / ice ones), the zone music and the generated VFX sprites outside the first seconds (the NOW tier of `vfx/spec/artTier.ts`
is awaited, the other ~4.9 MB streams in from 8.5 s of VFX time, each sprite blitted into its reserved cell of the art array: `vfx/spec/README.md`
"Run scope, tiers and streaming") behind the first seconds of a run
(ARCHITECTURE §11); the dev server loads them with the run so QA captures (`--time`, `--boss`, `--still`) see the complete
scene. To see the streaming on the dev server open the game with `?payload=1` (`shot.ts game --quality "high&payload=1"`).

## compose.py — sheets, blind A/B pairs, crops, palette numbers

    python tools/qa/compose.py grid --out sheet.png --cols 3 --width 640 [--labels] a.png b.png …
    python tools/qa/compose.py ab --a ours.png --b ref.png --out pair.png --key key.json   # critic sees pair.png only
    python tools/qa/compose.py crop --in big.png --out crop.png --box x,y,w,h
    python tools/qa/compose.py stats --in shot.png    # mean luma, contrast, saturation, dominant colours
    python tools/qa/compose.py diff --a old.png --b new.png [--box x,y,w,h] [--out heat.png]   # mad_pct, max, changed_frac
    python tools/qa/compose.py measure --in shot.png [--box x,y,w,h] [--ppm 67.4 --norm 17.4] [--near '#rrggbb' --de 4]
        # mean_luma, mean_saturation, dark_frac (luma<10), hf (high-frequency energy / mean luma at a common ground scale),
        # fine (pixel-scale vs 2-4 px energy: screen-door dither), flat_frac, near_frac / flat_near_frac (void / fog wall)

Plain `python` (not `python -I`: Pillow and numpy live in the user site-packages; `-I` only matters for untrusted files).

## Generating original textures (`tools/imagegen`)

Use `bun tools/imagegen/src/cli.ts gen --id <id> --kind <vfx|ui|texture> --goal "<description>"` followed by `pick` to generate and ship original textures into `apps/game/public/assets/`.

## Image engines (codex default, Gemini fallback)

`bun tools/imagegen/src/cli.ts gen …` uses **codex `$imagegen`** by default. When codex answers with a ChatGPT usage
limit, the reset time is recorded in `%TEMP%/ms-qa-locks/codex_paused_until.json` (`tools/imagegen/src/codexPause.ts`) and
every later call goes to **Gemini "Nano Banana 2.1"** (`gemini-nano-banana-2.1`, `tools/imagegen/src/gemini.ts`) until the
pause expires — same command, same references (sent inline), same post chain; transparent jobs are generated on flat
magenta and keyed to real alpha (`py/keymagenta.py`). Overrides: `MS_IMAGE_ENGINE=gemini|codex`, `MS_GEMINI_MODEL`
(e.g. `gemini-3-pro-image` = Nano Banana Pro), `MS_GEMINI_SLOTS` (default 8). The key is `GEMINI_API_KEY` in the
git-ignored repo `.env` — never print or commit it. Each scratch session folder records the engine in `engine.json`.
A billing or permission answer from Gemini (HTTP 402 "prepayment credits depleted", 403) writes
`%TEMP%/ms-qa-locks/gemini_unavailable.json`; for the next hour the fallback skips Gemini, and while codex is also paused a
call fails fast with `CODEX_PAUSED` (list the image as `DEFERRED_GEN`). Delete the file after topping up to re-probe.
