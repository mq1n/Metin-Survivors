// Co-op (2–4 players, host-authoritative). Public surface of the co-op layer; everything else in this folder is internal.
//
// ── Model ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
//   • The room creator is the HOST: it runs the one real sim (`CoopHostWorld`, a `World` with `players.length` heroes) and
//     broadcasts quantised binary snapshots (~15 Hz, delta-coded against the previous one, interest-managed) through the
//     relay (workers/api CoopRoom). Guests run a `MirrorWorld` (also a `World`): it plays the snapshots back 100 ms behind
//     the host (interpolation), predicts their own hero locally and reconciles with the host's acks, and routes card
//     picks / reroll / banish / skip to the host. Both worlds plug into the engine's run loop unchanged (`world.step`,
//     `world.hud(0)`, `world.modal`, stores, events) — the local hero is always `players[0]` on every client.
//   • XP / yeop / pickups are shared by the sim itself. Each player picks their OWN level-up / essence / chest cards; the sim
//     is frozen while any pick is pending and the host auto-picks (first card) after 20 s (World.autoPickAfter).
//   • Results: every client ends the run with its OWN `RunResult` (own class / level / kills / yeop / shards / damage meter /
//     talent XP, party time / bosses / metins), so meta settlement and the leaderboard see one player's run;
//     `result.players.length > 1` marks it as co-op (the submission carries `coop: <party size>`).
//
// ── Failure behaviour ───────────────────────────────────────────────────────────────────────────────────────────────────
//   • A guest that drops is "ghosted" by the host for 15 s (idle + invulnerable); if it reconnects inside that window the
//     transport re-hellos, the guest asks for a keyframe and continues; after 15 s its hero dies (the relay still keeps the
//     slot for 60 s so the player can watch / rejoin as a spectator-in-waiting).
//   • The HOST leaving ends the run for everybody gracefully: there is no host migration (the sim lives in one browser).
//     The relay hands the host seat to the next player, every guest finalises with the last 10 s checkpoint result
//     (`phase: 'hostLeft'`) and the run-end modal; the promoted guest closes the room's run (`end`).
//   • Guests cannot pause the shared sim; the host pausing (menu / hidden tab) pauses everybody and tells them.
//
// ── Integration (engine / UI) ───────────────────────────────────────────────────────────────────────────────────────────
//   const factory = createCoopFactory(api, { getLoadout: () => loadoutOf(store.selection.value), onRunStart: (run) => void app.startRun(run) });
//   UiDeps.coopFactory = factory;                     // the lobby (ui/screens/Coop.tsx) gets a CoopSession ≙ CoopLink
//   // App.startRun(run?: CoopRunStart):
//   const config = run ? await run.config({ meta, runOptions }) : <solo config>;      // guests send their MetaBonuses to the host here
//   const session = new RunSession(deps, config, content, run);                        // world = run ? run.createWorld(config, content, field.env) : createWorld(...)
//   await session.load(heroSpecsInWorldOrder, onProgress);                              // runEvents.runStart(world) → sync layer starts
//   run?.onStatus((s) => store.setCoop(s));                                            // pendingPicks / phase / players / hostPaused / pingMs
//   // App.setPaused(p): run?.setPaused(p) — guests: overlay only (never `loop.paused`).

export { createCoopFactory, joinCoop, startCoopHost, CoopSession } from './session';
export type { CoopApi, CoopLocalConfig, CoopOptions, CoopRunPlayer, CoopRunStart, CoopSessionFactoryOptions } from './session';
export { CoopHostWorld } from './host';
export { MirrorWorld } from './mirror';
export type { CoopPhase, CoopStatus, CoopStatusPlayer, NetStats } from './protocol';
