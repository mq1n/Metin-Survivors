#!/usr/bin/env bun
// Playthrough harness (dev/QA only, never shipped): plays the REAL client from a fresh profile through the whole game at accelerated speed
// and checks its stability; plus a real-input smoke of the plain production build. Playwright (playwright-core) over CDP, Chrome from the
// machine-wide slot pool of tools/qa/slots.ts (this tool uses 1 slot per lane, at most 2 lanes at once).
//
//   bun tools/qa/playthrough.ts snapshot                       # build the FROZEN snapshot (inside the ship lock): dist-qa (window.__ms) + dist-prod
//   bun tools/qa/playthrough.ts selftest [--only id,id]        # inject faults, assert every detector fires (33 checks, ~13 min; --only = a subset)
//   bun tools/qa/playthrough.ts campaign [--legs N] [--timescale 6] [--god 1] [--defeat 1] [--abandon 1] [--hard 1] [--api http://127.0.0.1:PORT]
//        fresh profile -> menu -> hero -> zone -> run -> final boss -> victory -> results -> menu; then every zone the victory unlocked, in
//        unlock order (read from the content), rotating class + doctrine; a reload between zones; one deliberate no-god DEFEAT run; the pause ->
//        abandon path; the first zone on hard. --legs 1 = the first zone only (+ unlock check + reload + defeat + abandon).
//   bun tools/qa/playthrough.ts defeat                        # the death path alone: a 1-hp idle hero (no god) -> DEFEAT -> results -> menu, then pause -> abandon
//   bun tools/qa/playthrough.ts leak [--runs 5] [--zone z] [--class c] [--leakAt 14]   # the leak probe alone: identical short runs (~3 min)
//   bun tools/qa/playthrough.ts matrix [--zones a,b] [--classes x,y] [--until 200 | --full] [--lanes 1|2] [--difficulty normal|hard]
//        one run per (zone, class) on a profile seeded with every zone + hard unlocked; short runs (abandon at --until sim s) unless --full
//   bun tools/qa/playthrough.ts smoke [--seconds 180] [--zones a,b] [--lanes 1|2] [--classes x,y] [--vet 1] [--gaps 1]
//        the PLAIN dist (dist-prod, no hook): real WASD key holds, real card clicks, Esc / pause / abandon, real time; fresh profile for the
//        first zone, a pre-seeded save for the others
//        --vet 1: the seeded saves are VETERAN profiles (every class 40 talent points spent through the game's own allocateTalent: a real-input hero with no god
//        mode lives longer in the later zones); --gaps 1: every rAF gap > 250 ms of the page with the screen parts on show goes into the run JSON (`gaps`)
//

//   --api <local Worker origin> (default: offline, /api/* answers 503 and is classified "offline") · --quality low|medium|high|ultra|auto (high)
//   --viewport phone | --w 1280 --h 720 --dpr 1 --touch · --lang en|tr · --shots 0|1 · --maxRunWall 1500 (s) · --headful
//   thresholds (s): --loadingStuckS 90 --screenStuckS 60 --modalStuckS 20 --clockStallS 8 --runEndFlowS 20 --stuckSimS 30 --unresponsiveS 30
//   campaign also: --leakRuns 4 (the leak probe at the end, 0 = off) --leakAt 14 · selftest: --only id,id (a subset of the checks)
// Output: <out>/summary.json (+ runs/<label>.json, <lane>/*.png). Exit code 1 on any violation (severity != info), 2 on usage errors.
// Detectors (tools/qa/play/README.md): page + worker errors · console errors (offline = /api/* lines only) and every game warning · unhandled
// rejections · failed requests (>= 400 / failed / an aborted module chunk) · WebGL context lost / shader errors · CSP violations · page unresponsive
// (an evaluate with no answer for 30 s) · loading > 90 s · a screen without progress > 60 s · a modal open > 20 s while clicks happen · sim clock
// stalled / loop paused with nothing on screen · hero stuck (< 0.5 m in 30 s sim) / confined / on blocked ground · real WASD / touch input moves
// the hero (input probe) · run over without the run-end flow within 20 s · non-finite positions · selection / result / report headline agree with
// the sim, a victory killed the final boss · leaks (gross growth over the mixed runs + the identical-run leak probe).
import { Args } from './play/common';
import { campaign, defeat, leak, matrix } from './play/campaign';
import { selftest } from './play/selftest';
import { smoke } from './play/smoke';
import { takeSnapshot } from './play/snapshot';

const a = new Args(process.argv.slice(2));

async function main(): Promise<number> {
  switch (a.mode) {
    case 'snapshot': {
      const info = await takeSnapshot(a.has('out') ? { out: a.str('out', '') } : {});
      console.log(JSON.stringify({ out: info.out, ok: info.ok, problems: info.problems, manifestSha256: info.manifestSha256.afterBuilds, hookInQa: info.hookInQa.hookMarkers, hookInProd: info.hookInProd.hookMarkers, lockHeldMs: info.lockHeldMs }, null, 1));
      return info.ok ? 0 : 1;
    }
    case 'campaign':
      return campaign(a);
    case 'matrix':
      return matrix(a);
    case 'defeat':
      return defeat(a);
    case 'leak':
      return leak(a);
    case 'smoke':
      return smoke(a);
    case 'selftest':
      return selftest(a);
    default:
      console.log(
        (await Bun.file(import.meta.path).text())
          .split('\n')
          .filter((l) => l.startsWith('//'))
          .map((l) => l.slice(3))
          .join('\n'),
      );
      return a.mode === 'help' || a.mode === '--help' ? 0 : 2;
  }
}

const code = await main();
process.exit(code);
