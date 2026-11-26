# tools/qa/playthrough.ts — full-game playthrough + stability harness (dev/QA only, never shipped)

Plays the REAL client from a fresh profile through the whole game at accelerated speed, and checks its stability. The usage header of
`tools/qa/playthrough.ts` is the reference (`bun tools/qa/playthrough.ts help`). Chrome comes from the machine-wide slot pool of
`tools/qa/slots.ts` (1 slot per lane, at most 2 lanes at once); a server it starts binds a free port >= 15000 and stops at exit.

## The frozen snapshot

A playthrough measures a FROZEN build, not the live tree (other workflows ship models into it).

    bun tools/qa/playthrough.ts snapshot      # -> .research/qa/snap/<stamp>/{dist-qa,dist-prod,snapshot.json,build-*.log}

Both builds are `MS_STRICT_ASSETS=1 bunx vite build --sourcemap false --outDir <dir> --emptyOutDir` taken INSIDE the ship lock of the mob
workflows (`.research/mobtripo/tools/shiplock.ts`, held for the builds only). `dist-qa` is built with `VITE_QA_HOOKS=1`:
`apps/game/src/app/app.ts` then publishes the App as `window.__ms` (`import.meta.env.DEV || import.meta.env.VITE_QA_HOOKS === '1'`;
the flag is typed in `apps/game/src/vite-env.d.ts`). `dist-prod` is the plain build and must not contain the hook: `snapshot.json` records
the grep (`window.__ms` as an exact identifier, `__msSplash` / `__ms_probe__` are other things), `git status --porcelain` and the manifest sha256.
`selftest` re-runs that check, in the files and in a real page of the plain build.

## Modes

| mode | what | needs |
|---|---|---|
| `campaign` | fresh profile -> menu -> hero -> zone -> run -> final boss -> victory -> results -> menu; then every zone the victory unlocked (unlock order read from the content), class + doctrine rotating; a reload between zones; one no-god DEFEAT run; the pause -> abandon path; the first zone on hard; the input probe on the first run and the leak probe (`--leakRuns 4`) at the end | `dist-qa` |
| `defeat` | the death path alone: a 1-hp idle hero (no god) on a fresh profile -> DEFEAT -> run-end flow -> results -> menu, then pause -> abandon. A motionless hero at full hp WINS zone 1 on normal (measured), so the defeat is made with a 1-hp handicap | `dist-qa` |
| `matrix` | one run per (zone, class) on a profile seeded with every zone + hard unlocked (IndexedDB `save.main`); short runs unless `--full`; `--lanes 2` | `dist-qa` |
| `smoke` | the PLAIN production build, real WASD key holds + real card clicks + Esc, real time, `--seconds` per zone; fresh profile for the first zone, pre-seeded save for the others (`--vet 1`: veteran saves with 40 talent points per class, `seedRecordVet`; `--gaps 1`: rAF gaps > 250 ms with the screen on show in the run JSON) | `dist-prod` |
| `leak` | the leak probe alone: `--runs` (default 5) IDENTICAL short runs (first zone + first class unless `--zone` / `--class`, abandoned at `--leakAt` 14 s, before the first level-up, no card taken), judged by `repeatLeakVerdict` (~3 min) | `dist-qa` |
| `selftest` | injects a fault per detector and asserts it fires (and that a clean boot, the offline API and real WASD input stay quiet); `--only id,id` runs a subset (~12 min in full) | both |

The bot (`pagehook.js`, a port of `apps/game/src/sim/__tests__/bot.ts`) runs IN the page and writes `input.touch.x / .y`; god mode heals the
hero around every sim tick (`session.tick` is wrapped once per session). Because the bot bypasses the input devices, the first run of a campaign
(and of each matrix lane) runs an **input probe** once the sim runs: bot off, the joystick zeroed, x1 speed, a real `W` (then `D`) key hold (a
CDP touch drag on touch lanes) for >= 1 s of sim; the hero must move >= 1.5 m, else `inputBroken` (blocker). Modals are answered by clicking
the DOM (Playwright click; when its stable-box wait times out on an animated element, a mouse click at the box centre after a hit test that
the element itself is the topmost thing there; then a force click, the element's own `click()`, the store command): every step past the
hit-tested click is a finding (`uiFallback`), also for PLAY / NEXT / ENTER and for a story notice only the Enter key closes. A force click
that left the modal open is not repeated past the 6th try (the ladder goes on to `click()` / the store, the run continues).

## Detectors

page errors · Web Worker errors (the `Worker` constructor is wrapped: worker `error` / `messageerror` events with the worker's name, also
when the game handles the event itself) · console errors (counts by message, bucketed game / offline / environment; **offline = only a line whose source is an `/api/*` URL**,
the old free-text filter "sync / cloud / offline / Failed to fetch" also hid `[ui] settle failed ...` and failed chunk imports) · **every game
warning** (major when it reports a failure / fallback, e.g. `[structures] GLB prop_x failed, using procedural`; minor otherwise, e.g. i18n keys) ·
unhandled rejections · failed requests (`>= 400` or failed; a module chunk / stylesheet answered `ERR_ABORTED` while no navigation is going on is a
failed import, other aborts are counted only; `/api/*` of an offline server is "offline", never an error) · WebGL context lost on the game
canvas (the hero preview / map canvases are disposed with `forceContextLoss()` on purpose: counted as `auxGlLost`) · shader errors · CSP
violations (the server applies the `/*` block of `public/_headers`) · **page unresponsive** (a `page.evaluate` without an answer for
`--unresponsiveS` 30 s, 3x while booting / loading: a hang or an endless loop; before, the harness waited forever) · loading > 90 s · a screen
without progress > 60 s · a modal open > 20 s while clicks happen · sim clock stalled with the run screen showing and no modal while the page
keeps drawing frames (blocker; the pagehook counts rAF callbacks: a page that drew < 10 frames in that window is a `frameStall`, major - the
GPU / compositor stalls of first-use shader compiles, PLAY-2 - and only becomes `screenStuck` if it never ends) · the loop paused
with no pause overlay / modal (`loopPausedNoModal`) · hero stuck (< 0.5 m in 30 s sim; with or without enemies near: a hero held by terrain no
enemy can reach was never reported) · hero confined (< 2.5 m in 60 s sim, < 3 enemies within 6 m) · hero on non-walkable ground for 1.5 s ·
run over without the run-end flow within 20 s · non-finite player / enemy / metin positions · the selection reaching the sim (zone /
difficulty / class / doctrine) · the run-end report: headline matches the end (victory / defeat / abandoned, en + tr), `result.victory`, the
result's zone / class / difficulty / doctrine, a victory killed the zone's final boss · leaks: (1) the mixed series (every campaign run is other
content: the menu counts follow the last run's content, 111 -> 68 -> 97 -> 123 textures on 2026-10-27, so only gross growth that never shrinks
over the whole series counts, `leakVerdict`) and (2) the **leak probe** at the end of a campaign (`--leakRuns` 4 identical short runs, `repeatLeakVerdict`: textures /
geometries / programs that never shrink and grow +2 overall or +1 every run, heap growing every run by > 8 MB; one texture kept per run is
found). Per run: frame time p50 / p95 / p99, step / render ms per frame, achieved sim speed (sim seconds per wall second while no modal is
open), long tasks, frame stalls > 700 ms with context, peak draw calls / triangles / enemy rows, zone load time, results-screen content, the
saved profile before / after (runs, unlocks, bank).

## Output

`<out>/summary.json` (aggregate: violations, console summary, requests, fallbacks, leak verdict, machine CPU load at start / end),
`<out>/runs/<label>.json` (one per run), `<out>/<lane>/*.png` (menu, hero select, zone select, run start / 25 % / each boss / end, results,
pause). Exit code 1 on any violation with severity other than `info`.

## Selection between runs

The hero select and the zone select keep the previous run's doctrine and difficulty. `enterRun` sets class, doctrine (A or B) and difficulty
(normal or hard) both ways through the UI, clicks a doctrine card only when it is not selected (a click on the selected card PROCEEDS to the zone
select) and reads the selection back; the run's world (`zone / difficulty / classId / doctrine`) and its `RunResult` must match it
(`selectionMismatch` / `resultMismatch`, blocker). Before 2026-10-27 only B and hard were ever clicked: a run after a B / hard run played B / hard
while the report named A / normal.

## Slots and processes

Every lane holds one slot of the machine-wide Chrome pool with `keepAlive` (the lock is re-stamped every minute: a campaign lane holds its slot for
20-120 min, longer than the pool's 20-minute stale age after which another process used to reclaim it) and releases it only while the lock is
still its own. Each Chrome gets a fresh `--user-data-dir` and is killed on exit (also on SIGINT / SIGTERM); the static server stops in `finally`.
A harness killed from outside (TerminateProcess) cannot clean up: check for `chrome.exe` with `ms-play-` in its command line after such a kill.

## Machine load

The shared machine is often at 80-100 % CPU (other workflows). Headless Chrome then draws 1-3 frames per second for the first seconds of a page
and clicks wait for stable frames, so every wait is generous (real clicks 20 s) and the CPU load (`Get-Counter`) is recorded per run. Frame-time and
sim-speed numbers from a loaded machine are not a performance baseline.
