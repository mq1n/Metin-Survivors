tools/qa/probes — UI measurement snippets (dev only, never shipped). Owner: UI core (C0 rails). Builders use them for the
G3 gate (fontsize / tapsize / overflow / contrast / animlock + a clean console) and the core packages for their acceptance.

Every *.js file is the BODY of an async function and returns JSON, so it runs two ways:

  1) one screen, with a screenshot (note: shot.ts truncates the result to 2000 chars):
       bun tools/qa/shot.ts ui --screens levelUp --w 390 --h 844 --dpr 3 --touch --mobile \
           --eval @tools/qa/probes/tapsize.js --out .research/<task>/ui
  2) many screens x viewports, full JSON, seeded Math.random (EmberField / tips / motes identical between runs):
       bun tools/qa/probes/run.ts --probes fontsize,tapsize,overflow,contrast --screens all \
           --vp 1920x1080,390x844@3t,844x390@2t [--lang tr] [--opts '{"min":12}'] [--shots dir] --out .research/<task>/probes.json
     --screens: comma list | @file | all (every gallery scenario id). --vp: WxH[@dpr][t] (t = touch + mobile).
     Gallery state carries over between screens of one viewport exactly like `shot.ts ui` (use --fresh to reload each).
     --insets [auto | t,r,b,l]: the overflow-under-insets pass (below). --before <dir>: a BEFORE capture from a part's start/ copies (below).

Options go in window.__probeOpts (run.ts --opts '<json>'; with shot.ts prefix the snippet: --eval "window.__probeOpts={...}" is
not combinable, so use run.ts when you need options).

  probe          what it reports                                                               used by
  domfp.js       hash of tag/class/rect/computed style (+ ::before/::after) of every ms-* element; C0 zero-visual-change
                 animations canonicalised (finite = end, infinite = t0) then restored;         proof, any refactor
                 missing @keyframes; {full:true} adds per-element lines for diffing
  styles.js      cascade order of the injected stylesheets + rule counts                         CSS splits (C0)
  fontsize.js    visible text below the floor (12 px desktop, 10.5 px when the short side < 600) G3, C7
  tapsize.js     interactive elements smaller than 44x44 CSS px                                  G3, C3, C8
  overflow.js    clipped boxes, ellipsis, off-screen text, badges cut by an ancestor clip,       G3, C4, C8
                 scrollers with / without a fade. Checks the real HUD too (.ms-layer is no longer
                 skipped), skips screen-reader-only labels, finishes running animations first
  contrast.js    text below WCAG AA (4.5:1, 3:1 large) against what is really painted behind     G3
                 the text box: gradients, url() images, kit-plate ::before faces (see below);
                 count = below AA, hard = below 3:1 (gate on hard); rows carry via + rect
  animlock.js    finished fill-forwards animations whose last keyframe overrides the declared    C1.1, G3
                 opacity / transform; resting opacity of chosen selectors; hover-lift follow test
  rarity.js      --rc of every .ms-slot.ms-r-<tier> vs the tier token                            C1.2, C4
  gauge.js       progress fills: valid glow box-shadow, no mint                                  C1.3, C5
  tipcheck.js    replays a mouse entering each IconSlot (enter on every ancestor, bubbling move)  C1.4, C6
                 and reads the tooltip text: a wrapper tip must not replace the icon's own tip
  fonts.js       loaded faces (no Cinzel Decorative), title families, lining numerals            C1.5, C7
  modalscroll.js scrollHeight vs real content end of modal roots (dead scroll)                    C1.6
  touchhint.js   keyboard sentences on a touch layout; safe-area simulation (--safe-t / --safe-b) C1.7, C8
                 with action-row and head clearances (default selectors = the rebuilt screens)
  safe4.js       four-side inset simulation (--safe-t/-r/-b/-l, landscape 0/47/21/47): every tap   C8
                 target and text leaf must sit inside the safe rectangle
  focusring.js   keyboard modality + focus; what draws the ring (outline / box-shadow / filter);  C1.8
                 keeps the focus so a shot.ts capture shows it
  skillslots.js  gallery only: gives the hero the basic + 6 actives (+ ultimates) and checks that the    PLAYREV-2
                 taskbar, pause panel and level-up board list every skill and the pause count is 6/6
  wait.js        only waits (fonts + 3 s) and counts the scroll-driven animations: use it with   captures of what a
                 run.ts --shots when the picture must be what a player sees (no settle step)    player sees, blind pairs

Determinism: two independent run.ts passes over all 80 gallery screens x 3 viewports gave identical domfp hashes
(2026-10-13, .research/ui_core/probes/before_A.json vs before_B.json).

Phone-gate notes (2026-10-22, phone gate of the UI rebuild; fix pass F2)
-----------------------------------------------------------------------
  overflow.js
    - The HUD root is div.ms-layer.ms-hud and the probe used to skip `.ms-layer`, so the HUD was never overflow-checked. It is checked now (the one
      other .ms-layer, in Modal.tsx, is aria-hidden and still skipped). hud-map at 844x390 reports its ellipsised atlas title, as the gate found.
    - Screen-reader-only labels (a box of at most 2 px that is clipped with clip / clip-path / overflow: the icon-only tab labels of the phone tiers,
      span.tal-use-w, span.ms-co-btn-t) are skipped with their subtree. They counted as ~260 clipped + ellipsis rows per settings capture.
    - A badge (+N medal, rank tag ...) is reported as cut only when its host (the nearest ancestor at least 2.5x its area) sits inside the clip while
      the badge does not. A row scrolled half out of view cuts its medal together with the row: not a defect (armory picker / collection log rows).
      Scroll containers count as clips for this check now.
    - { settle: false } keeps running animations; by default finite animations / transitions are finished first (a banner mid-slide is not clipped).
  contrast.js
    - The old probe read background-color only, so dark text on a gradient-painted gold plate (.ms-kchip--gold / --new), on the parchment image, on
      refine pips (fill in ::before) came out at 1.0-1.2:1: ~80 false positives per gate. It now paints the stack: solid colours, linear and radial
      gradients over the part the text covers (1-4 px hard-stop bevel bands and hairline rules are ignored), url() images read through a 64 x 64
      canvas over the text box (size / position / repeat honoured), and back-fill pseudo-elements (position absolute, z-index < 0) such as the kit plate
      face. Pixel-checked on the phone-gate screens: stone plate labels 3.22 (pixels 3.2), medals 3.3-3.9 (3.0-3.9), gold chip 4.46 (the online builder's
      pixel measurement 4.46), parchment text and card names now read their real 7+.
    - Which rows are left are REAL but marginal: idle .ms-ktab / .ms-kseg-btn labels on the stone plate (3.2:1 at the lightest grain, ~4.2 on average),
      skill-rank medals (M1 / M2 / 3: 3.3-3.7), gold chips (4.46), gold refine pips (4.2). They are the kit's / the HUD's to decide; a gate that wants the old
      "nothing real fails" reading uses `hard` (below 3:1) and treats `count` as the AA list. Rows still carry onImage: true when a gradient / image / pseudo
      layer took part; `busy: true` = the backdrop under the text varies a lot (photo / card art): look at a crop.
    - { debug: true } adds `stack` (the colour samples of every layer) and `src` (which element / pseudo painted it); { all: true } lists every row.
    - Remaining blind spots: filters, mask-image, blend modes, conic gradients (counted per stretch), images drawn by canvas / WebGL behind the DOM
      (the HUD over the 3D scene: rows over the scene are not measured).
  touchhint.js: the default `rows` / `heads` selectors are the ones of the rebuilt screens now (they predated the rebuild and matched nothing on most).
    Settings sizes its card with raw env(safe-area-inset-*), so this simulation (and safe4.js) cannot move it: read its numbers by hand.
  Without --fresh the gallery state carries over between screens of one viewport and produces false clusters (leaderboard class clips after
    leaderboard-coop, rich-profile armory items). Use run.ts --fresh for a gate; take screenshots with run.ts --shots in the same pass when the probe and the
    picture must be the same page.

Phone-gate-2 notes (2026-10-22, close-out round 2; fix part F5)
---------------------------------------------------------------
  The settle step does not touch scroll-driven animations any more. overflow.js and contrast.js finish the running finite animations first (a banner caught
    mid-slide is not clipped, a card at opacity 0.3 is not low contrast). Animation.finish() on an animation of another timeline than document.timeline (the
    scroll-driven .ms-edgefade masks run on a ScrollTimeline) jumped it to its end state: the START fade stayed on and the END fade went off, so probe captures
    showed inverted fades (the codex zone chips: "HEPSI" dimmed, "SEUNGRYON" hard-cut; the source of the critic's "HEPSI dimmed" report). Those animations are
    skipped now; a capture taken by run.ts --shots after a probe shows the fades as a player sees them. (Still: use wait.js when no probe is needed.)
  The overflow-under-insets pass: run.ts --insets auto  (portrait t47 b34, landscape r47 b21 l47 = an iPhone with Face ID) or --insets 47,0,34,0 (t,r,b,l).
    After the scenario is applied the --safe-t/-r/-b/-l tokens of .ms-ui are set and the scenario is applied AGAIN (JS-placed widgets, the HUD edge arrows, are placed on
    every render from the [data-block] rects, so a static scenario keeps the inset-free placement); then the probes run with the insets ON, and a --shots capture paints
    the unsafe bands as a red hatch (added after the probes ran, removed again). The resolved insets are in the JSON (args.insets). Use it together with --fresh:
        bun tools/qa/probes/run.ts --fresh --insets auto --probes overflow,contrast,fontsize,tapsize --screens all --vp 390x844@3t,844x390@2t [--lang tr] --out x.json
    and compare the rows with the same run without --insets: the rows that appear only with insets are the inset defects (the gate's insetagg.py did that). Screens that
    size themselves with raw env(safe-area-inset-*) cannot be moved by this (the settings card did until the gate fix; read such numbers by hand). safe4.js / touchhint.js
    set their own insets and restore them; they do not need the flag.
  run.ts --before <dir>: serves the .css files under <dir> (a fix part's start/ copies, laid out like the repo: <dir>/apps/game/src/...) instead of the live ones
    (the dev server's CSS module responses are rewritten, a sheet that is @imported by another one is found inside it). It gives the BEFORE side of a before / after pair
    of a CSS fix without touching the shared tree and without a second dev server; a file that is never found in a response is reported on stderr. A pass-through
    run (--before on a folder without changes) is the fair AFTER side: any route turns the browser cache off, which changes load timing a little. TSX / TS changes
    are not covered.
  touchhint.js measures BUTTONS, not row boxes (the gate's rowgap.js): a row box that reaches the screen edge is fine when its own inset padding keeps the buttons
    clear of the home indicator (the HUD strip, the card-modal bars, the run-end footer). Each row reports gap (box), btnGap (lowest visible button / link / tab inside),
    ok (buttons >= safe-b - 1 px, else the box >= safe-b + 8) and comfy (buttons >= safe-b + 8). The HUD strip is not a row any more (it bleeds by design): .ms-tb-btns is.
  contrast.js blind spots that stay (checked on pixels in the gate, they read as false positives): mask fades (mask-image), gel-gloss gradients and medal faces (the rank
    medal rows measure 6.9-10.5:1 on pixels where the probe says 3.x; the menu PLAY label 7.4-8:1). A disabled control is listed like any other (WCAG exempts it):
    the kit's disabled ink is #b0a796 now, ~4.9:1 on the stone plate (was --k-text-off, 3.3:1).

Ui-world-leftovers notes (2026-10-27, phone gate 3 item 11)
-----------------------------------------------------------
  safe4.js sets the insets and then applies the gallery scenario AGAIN (the scenario id is read from the URL the gallery keeps current), as run.ts --insets
    does, before it measures: a layout that reads the insets at render time or from measured rects (the boss-reward note under the shelf, the HUD edge arrows)
    used to be judged with the inset-free first render. { reapply: false } keeps the page as it is.
  touchhint.js finishes the finite document-timeline animations first (the overflow.js settle loop; scroll-driven ones are left alone, { settle: false } keeps
    the page as it is): the run-end footer read btnGap 21 / 36 px 0.7 s after the apply and 32 / 51 px at rest. Its KEY scan skips prose (.ms-lore, story
    chapters, codex lore / articles, the zone chronicle, card flavour, tooltip lore): 'press' in a codex paragraph is a word of the story, not a keyboard hint.
