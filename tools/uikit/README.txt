tools/uikit — kit v1 ("Stone & Pewter") material checks and hand-off helpers (dev only, never shipped). Owner: UI core lane B.

The painted kit materials (uk_board, uk_stone, uk_rust, uk_lattice, uk_corner, uk_gauge_cap, uk_orb_ring) were NOT baked by script:
they are generated with codex `$imagegen` through tools/imagegen (using original style descriptions and palette anchors
reference, a goal line saying what the asset is for), picked and shipped with the normal pipeline:

    bun tools/imagegen/src/cli.ts gen  --id uk_<name> --kind ui --goal "..." [--variants 3]
    bun tools/imagegen/src/cli.ts pick --id uk_<name> --k <k>      # approve + ship (writes tools/imagegen/jobs/gen/uk_<name>.json)
    bun scripts/cleanRoomAudit.ts --scan apps/game/public/assets/ui   # must print CLEAN

All generated UI textures are original clean-room assets.
