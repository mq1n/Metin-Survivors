# VFX presets

Stable ids, `group.name[.variant]`. Fire one with `vfx.spawn(id, opts)` (or a sim `vfx` event with `preset: id`).
Every id below is implemented in `src/vfx/presets/*.ts`; `src/vfx/presets.test.ts` fails if this table and the registry diverge.

## Id grammar

* **Base id** — a recipe (`melee.slash`, `shock.wave`, `proj.orb`, `hit.fire` …).
* **Variant suffix** — any base marked **V** accepts one of these suffixes (`melee.slash.gold`, `proj.orb.ice`). A suffix selects the
  colour palette **and** the element flavour of the recipe (secondary particles: flames for fire, shards for ice, arcs for lightning …):

  | suffix | palette | flavour (element) | class / use |
  |---|---|---|---|
  | `physical` | pale gold / dust | physical | neutral weapon |
  | `fire` | orange / crimson | fire | |
  | `ice` | cyan / deep blue | ice | |
  | `lightning` | pale blue / white | lightning | |
  | `dark` | violet / black | dark | |
  | `poison` | toxic green | poison | |
  | `holy` | warm white / gold | holy | |
  | `wind` | mint / white | wind | |
  | `gold` | gold + white | physical | **Warrior** (body) |
  | `white` | white + ice-blue | physical | **Warrior** (mental) / spirit |
  | `green` | poison green + violet accent | poison | **Ninja** |
  | `purple` | violet shadow + green accent | dark | **Ninja** shadow |
  | `yacha` | black-violet + orange accent | dark | **Yacha** dark magic |
  | `flame` | orange flame + violet accent | fire | **Yacha** fire |
  | `blue` | lightning blue + lilac | lightning | **Shaman** |
  | `dragon` | dragon gold + cyan accent | holy | **Shaman** dragon |
  | `red` | blood red + amber | fire | **Wolfman** red wolf |
  | `indigo` | indigo + ice-blue | ice | **Wolfman** indigo wolf |

  Without a suffix the palette is the base's default; the sim's `element` field (ElementIdx) or a `color` hint (0xRRGGBB, a full
  palette is derived from it) override it. Precedence: suffix > `color` > `element` > default.
* Ids ending in `.<palette>` that are not listed as **V** are an error (`vfx.has()` returns false).

## Spawn options (`SpawnOpts`, also the sim `vfx` event)

| field | meaning |
|---|---|
| `x, z` (`y`) | world position, y defaults to the terrain height |
| `dirX, dirZ` (or `rot`) | facing, need not be normalised |
| `scale` | `mult` presets: multiplier of the authored size · `radius` presets: **metres** (area radius / length) |
| `duration` | seconds (loops, telegraphs, zones, sky-strike delay); 0 = preset default |
| `tx, tz, hasTarget` | second point (beams, chains, dash lanes, leaps) |
| `a, b` | preset specific, noted in the *params* column |
| `color` / `element` | palette hint, see above |

*Size kind*: **R** = `scale` is metres, **M** = multiplier. *Kind*: **1** one-shot, **L** loop (returns a handle; `stop(h)`, `move(h,…)`),
**T** tracked loop (call `track(id, key, x, z, …)` every frame, ends by itself when you stop calling).

## Signature (elemental) layer

Ids marked **signature** (and `sky.lightning`, `chain.bolt`, `sky.meteor`, `shock.quake`, `boss.slam`, `metin.fall`, `metin.impact`, `beam.line`, `levelup`, `zone.ice`, `sky.icicle`, `shock.wave.ice`) first try a pooled
GPU effect from `src/vfx/elemental/` (ported from threejs-vfx, MIT, see `THIRD_PARTY_NOTICES.md`): `fx.el.cast(kind, ctx)` returns false on quality tier `low`, when the
draw-call budget (`ELEMENTAL_CALL_BUDGET` = 0/6/8/9 per tier) or the effect pool is exhausted, and the preset then plays its batched recipe. Same ids, same params, same palette/variant handling.

## Player skills — by behaviour

| id | V | size | kind | what it is · params |
|---|---|---|---|---|
| `melee.slash` | V | R reach (2.6) | 1 | **meleeArc**: curved crescent slash with erosion, sparks along the edge, hand flash. `a` arc angle rad (2.5), `b` swing direction ±1 (1 = left→right) |
| `melee.claw` | V | R reach (2.2) | 1 | **meleeArc** (Wolfman): 3 claw rakes with tapering streaks. `a` rake count (3) |
| `melee.stab` | V | R length (3.0) | 1 | **meleeArc/dash** thrust: lunge streak + point flash (Ninja assassinate) |
| `melee.flurry` | V | R reach (2.0) | 1 | rapid 4-hit dagger flurry, alternating mini-slashes + glints. `a` hits (4) |
| `spin.blades` | V | R radius (2.4) | L | **spinAura**: 3 rotating crescent blades + dust swirl + tip sparks, follows player. `a` blade count (3). default `duration` 3 |
| `aura.ring` | V | R radius (3.0) | L | **persistentAura**: soft rune ring + motes following the player; default `duration` 900 |
| `dash.streak` | V | R length (5) | 1 | **dash**: speed lines, afterimage streak, dust trail. Needs `tx,tz` or dir + length |
| `leap.arc` | V | R landing radius (2.2) | 1 | **leap**: take-off burst at `x,z`, landing shockwave at `tx,tz` after `duration` (0.5) |
| `shock.wave` | V | R final radius (4) | 1 | **shockwave**: ground ring + dust/flame/ice/arc flavour. `duration` expand time (0.55) |
| `shock.quake` | V | R radius (6) | 1 | Warrior *Earthquake* / boss slam resolve: cracks, rock chunks, 2 rings, dust wall |
| `shock.howl` | V | R radius (5) | 1 | Wolfman *Wolf Howl*: concentric sound rings + wisps |
| `ult.storm` | V | R radius (3.2) | 1 | **signature** Storm barrage (elemental `storm.bolt`): rune-circle marker, then `a` (5) filament-bundle lightning strikes over `duration` (1.4), last one centred and bigger; `b` span override; `hasTarget` = centre. Falls back to batched thunderbolts |
| `ult.novabeam` | V | R length (10) | 1 | **signature** Nova beam (elemental `beam.nova`): charge orb then a core/sheath/halo column with coils and shock discs holding `duration` (1.7); `a` charge s (0.35, <0 none); `hasTarget` ends at tx,tz |
| `ult.anvilfall` | V | R radius (5) | 1 | **signature** Earthquake (elemental `impact.fissure`): molten fissure network, lifted slabs, light spike, 3 shock rings, dust, scorch |
| `ult.frostlance` | V | R length (9) | 1 | **signature** Frost lance (elemental `frost.lance`): fracture front, crystal field on a cracked rime lane, wall of blades at the far end, then shatter. `duration` total (1.8) |
| `ult.blizzard` | V | R radius (5.5) | 1 | **signature** Blizzard (elemental `frost.nova`): rime sheet freezes outward, rings of blades rise to the rim, then shatter + thaw; slanted snow streaks. `duration` (2) |
| `ult.dragonbreath` | V | R length (8) | 1 | **signature** Dragon breath (elemental `breath.dragon`): raymarched volumetric flame cone from the mouth along dir, `a` full angle (0.9), `duration` (1.4) |
| `zone.fire` | – | R radius (3) | L | **groundZone**: flames, embers, scorch decal. default `duration` 4 |
| `zone.poison` | – | R radius (3) | L | bubbling pool + toxic puffs |
| `zone.ice` | – | R radius (3) | L | frost patch + snow glints + shard spikes |
| `zone.dark` | – | R radius (3) | L | arcane violet vortex + wisps |
| `zone.holy` | – | R radius (3) | L | light circle + rising glints |
| `zone.lightning` | – | R radius (3) | L | static field with ground arcs |
| `zone.wind` | – | R radius (3) | L | spiralling gust ring + leaves |
| `zone.physical` | – | R radius (3) | L | dust circle (generic ground AoE) |
| `zone.rune` | V | R radius (3) | L | rune circle (summon / arcane AoE), tint by palette |
| `zone.cloud` | V | R radius (3) | L | poison-cloud style volume (Poison Cloud): drifting puffs |
| `zone.firering` | – | R orbit radius (3) | L | ring of orbiting flame blobs (metin *fireRing*) |
| `cone.breath` | V | R length (6) | L | **cone**: breath / roar cone, `a` full angle rad (0.9), default `duration` 0.8 |
| `cone.roar` | V | R length (7) | 1 | Shaman *Dragon Roar*: golden shock cone with dragon-head glyph |
| `sky.strike` | V | R impact radius (1.8) | 1 | **skyStrike**: ground marker for `duration` (0.8) → bolt/meteor falls → impact (flavour from variant) |
| `sky.meteor` | V | R impact radius (2.4) | 1 | flaming meteor with tail, flipbook explosion, scorch |
| `sky.lightning` | V | R radius (1.6) | 1 | thunderbolt from the sky + flash + ground arcs |
| `sky.arrows` | V | R radius (3.0) | 1 | arrow volley from above (Ninja *Skyshatter Volley*) |
| `sky.icicle` | V | R radius (2.2) | 1 | falling icicle spears + frost burst |
| `sky.sword` | V | R radius (2.2) | 1 | Warrior *Sword Rain*: giant spectral swords plunge from above over `duration` (0.8) |
| `sky.holy` | V | R radius (2.0) | 1 | column of light from above |
| `chain.bolt` | V | M | 1 | **chain**: one link `x,z → tx,tz` (jagged bolt, forks, end spark). Spawn one per jump |
| `beam.line` | V | R length (8) | L | **beam**: persistent beam from `x,z` along dir (or to `tx,tz`) with noise flow, muzzle + end flare. `duration` |
| `proj.orb` | V | M | 1 | **projectile / homing** launch: muzzle flash + sparks + short energy streak in `dir` (the flying body and its trail are the render layer's projectile renderer; its style is picked from the interned vfx name, see `variantOf()`) |
| `proj.arrow` | V | M | 1 | arrow launch: bow-release flash + speed lines (Ninja arrows) |
| `proj.blade` | V | M | 1 | crescent air-blade launch: sweeping streak + wind burst (*Aerial Sword*) |
| `proj.bolt` | V | M | 1 | lightning-bolt launch: arcs + flash |
| `proj.talisman` | V | M | 1 | paper charm launch: rune puff + glyph flash |
| `proj.dragon` | V | M | 1 | dragon launch: golden coil flash + roar ring |
| `proj.star` | V | M | 1 | ninja star launch: spinning star glint + speed lines |
| `proj.hostile` | V | M | 1 | enemy projectile muzzle (tint by palette/element) |
| `orbit.orb` | V | M | T | **orbit** accent: glow + sparkle trail on one orbiting orb (call `track` per orbital every frame) |
| `orbit.blade` | V | M | T | accent for one orbiting spinning blade |
| `orbit.spirit` | V | M | T | accent for one orbiting ghost-flame |

## Buffs, summons, heal

| id | V | size | kind | what it is |
|---|---|---|---|---|
| `buff.aura` | V | R radius (1.6) | 1 | **selfBuff** cast: rising ring, motes, glow. `duration` (1.0) of the visible aura |
| `buff.shield` | V | R radius (1.5) | L | bubble shield with hex shimmer (Reflect / Obsidian Bulwark); follows player |
| `buff.stealth` | V | R (1.2) | 1 | camouflage: smoke vanish + shimmer |
| `buff.haste` | V | R (1.2) | L | speed wisps trailing the player |
| `summon.circle` | V | R radius (2.2) | 1 | **summon**: rune circle + pillar + burst (generic) |
| `summon.dragon` | – | M | 1 | Dragon Aid: golden coil + roar flash |
| `summon.ghost` | V | M | 1 | Fire Ghost: flame wisp rise |
| `summon.wolf` | V | M | 1 | spirit wolf: howl ring + mist |
| `burst.dragon_head` | V | M | 1 | Shaman *Dragon Roar* ult: spectral dragon head lunges along dir, roar flash + wisp stream |
| `aura.heal` | V | R radius (3.0) | 1 | heal pulse (Cure / Blessing): rising rings, motes, soft pillar |
| `holy.heal` | – | M | 1 | heal on a player: rising crosses, glints, ring |
| `heal.drain` | – | M | 1 | tiny lifesteal glints |
| `levelup` | – | M | 1 | level-up pillar with golden rings and sparkles |

## Combat feedback

| id | size | what it is |
|---|---|---|
| `hit.physical` `hit.fire` `hit.ice` `hit.lightning` `hit.dark` `hit.poison` `hit.holy` `hit.wind` | M | hit sparks by element (the adapter picks by `damage.element`) |
| `hit.crit` | M | critical overlay (flash, sunburst, halo, ground ring, fast sparks) |
| `hit.player` `player.evade` `player.shield` | M | player damaged / evaded / absorbed |
| `hit.dot.burn` `hit.dot.poison` `hit.dot.bleed` | M | damage-over-time ticks |
| `death.dust` | M | default death: dust ring + puffs |
| `death.animal` `death.orc` `death.undead` `death.ice` `death.fire` `death.desert` `death.devil` `death.insect` `death.dragon` `death.human` `death.metin` | M | race flavours (blood-free): fur/dust, bone + iron chips, soul wisps, ice shards, embers + flames, sand, dark smoke, chitin chips, scale shards, dust, crystal |
| `death.elite` `death.boss` | M | bigger death with shock ring |
| `spawn.elite` | M | elite spawn: red ring + pillar |
| `spawn.corrupt` | M | metin swarm spawn: dark rift + wisps |
| `spawn.summon` | M | summoned enemy: small rune flash |
| `player.death` `player.revive` | M | player death burst / revive pillar |
| `enemy.muzzle` `enemy.charge` `enemy.leap` `enemy.explode` | M | enemy attack cues (ranged muzzle flash, charge dust, leap, explosion) |
| `proj.hostile.*` | | see above |

## Pickups

| id | what |
|---|---|
| `pickup.xp` | gem collected (tinted by `color` = tier colour) |
| `pickup.yeop` | coin collected |
| `pickup.heal` | potion drunk |
| `pickup.magnet` | vacuum pulse (screen-wide ring) |
| `pickup.shard` | metin shard collected |
| `chest.open` `chest.open.boss` | chest burst |

## Metin stones (rune colour via `color`)

| id | size | kind | what |
|---|---|---|---|
| `metin.fall` | M (great 1.6) | 1 | sky crack + flaming trail + ground shadow telegraph for `duration` (impact delay) |
| `metin.impact` | R impact radius (3.2) | 1 | shockwave + debris + dust + scorch decal |
| `metin.aura` | M | L | alive: rune circle, pulsing pillar, corruption wisps (until `stop`) |
| `metin.aura.awakened` | M | L | awakened: darker, faster, red-tinged aura |
| `metin.awaken` | M | 1 | awaken burst |
| `metin.shatter` | M (great 1.6) | 1 | shards + light burst + dust (`a` = 1 awakened → bigger) |
| `metin.pulse` | R radius (4) | 1 | rune pulse ring (periodic corruption pulse / swarm call) |

## Bosses and telegraphs

| id | size | kind | what |
|---|---|---|---|
| `boss.spawn` `boss.spawn.final` | M | 1 | ground rupture: cracks, shock rings, debris, pillar |
| `boss.phase` | M | 1 | phase change roar ring |
| `boss.enrage` | M | T | enrage aura (`track` on the boss every frame while enraged) |
| `boss.enrage.burst` | M | 1 | enrage trigger burst |
| `boss.death` `boss.death.final` | M | 1 | big death + light release |
| `boss.slam` | R radius (4) | 1 | slam resolve: crater, dust wall, debris |
| `boss.nova` | R radius (8) | 1 | nova: expanding energy ring + flash |
| `boss.volley` | M | 1 | volley muzzle burst |
| `boss.teleport.out` `boss.teleport.in` | M | 1 | vanish / appear |
| `boss.summon` | R radius (3) | 1 | summon rune circle |
| `boss.charge.trail` | M | T | charge dust + streak trail |
| `telegraph.circle` | R radius | 1 | circular warning for `duration` (fills up) |
| `telegraph.cone` | R length | 1 | sector warning, `a` full angle (rad) |
| `telegraph.lane` | R length | 1 | rectangle warning, `a` width (m) |
| `telegraph.ring` | R outer radius | 1 | annulus warning (`a` inner safe radius) — nova / ring waves |
| `telegraph.meteor` | R radius | 1 | meteor marks: pulsing target with falling-shadow cue |
| `telegraph.*` colours | | | warning orange by default; bosses pass `color` crimson |

Boss patterns map to ids: **slam** = `telegraph.circle` → `boss.slam`; **charge** = `telegraph.lane` + `boss.charge.trail`; **volley** = `boss.volley` +
`proj.hostile.*`; **ring** = `telegraph.ring` → `shock.wave.<element>`; **breath** = `telegraph.cone` → `cone.breath.<element>`;
**meteor** = `telegraph.meteor` → `sky.meteor.fire`; **nova** = `telegraph.ring` → `boss.nova`; **teleport** = `boss.teleport.out/in`;
**enrage** = `boss.enrage` / `boss.enrage.burst`; **summon** = `boss.summon`.

## Kit demo (dev / gallery only)

| id | V | size | kind | what |
|---|---|---|---|---|
| `kit.demo` | – | R (3) | 1 | NOT used by the game: sheet of the soft-kit helpers, `a` = 0 ring arcs + ground flare, 1 glints + cinders, 2 heated cracks + stain + crater, 3 light shafts + crossed pillar, 4 rocks + smoke, 5 dust ring + ash smoke (`tools/qa/vfxstage.ts --ids kit.demo --opts '{"a":2}'`) |

## Ambient (loops following the camera focus)

`ambient.leaves` (Yeonmu: spring leaves + petals, 0.25-0.5 m) · `ambient.leaves_autumn` (Suryeon: russet / amber / ochre fall) · `ambient.motes` (sun motes, 0.06-0.12 m additive: a second loop next to the leaves) · `ambient.dust` (Suryeon) · `ambient.snow` (Seori) · `ambient.embers` (Daeryeol) · `ambient.ash` · `ambient.sparks`.
`ambient.smoke` (Daeryeol, AMB-02: slow low smoke wisps, the second loop next to the embers; nothing zone-specific enables it yet).
`BiomePreset.particles` plain names (`leaves|dust|snow|embers|ash|sparks`) are accepted as aliases.

## Event routing (adapter)

`damage` → `hit.<element>` (+ `hit.crit`), `enemyDeath` → `death.*` (type → race table via `setDeathPresets`), `enemySpawn`, `enemyAttack`, `playerHit/Death/Revive`,
`heal`, `levelUp`, `pickup`, `metinWarn/Impact/Awaken/Break`, `bossSpawn/Phase/Death`, `chestOpen`, and `vfx` (generic preset request). `telegraph` events are ignored by default
(the render layer draws telegraph decals from the feed); `telegraph.*` presets are for explicit `vfx` events and the gallery.

## Sim-side legacy ids (aliases)

The sim hard-codes a few ids; they resolve to the presets above (the event's `element` flavours them): `vfx_explode`→`enemy.explode`, `vfx_slam`/`vfx_boss_slam`/`vfx_boss_land`→`boss.slam`,
`vfx_nova`/`vfx_boss_ring`→`shock.wave`, `vfx_breath`/`vfx_boss_breath`→`cone.breath`, `vfx_crit_burst`→`hit.crit`, `vfx_revive`→`player.revive`, `vfx_enemy_bolt`→`enemy.muzzle`,
`vfx_hazard`→`zone.fire`, `vfx_meteor_impact`/`vfx_boss_meteor`→`sky.meteor`, `vfx_boss_enrage`→`boss.enrage.burst`, `vfx_boss_summon`→`boss.summon`, `vfx_boss_vanish`→`boss.teleport.out`,
`vfx_boss_nova`→`boss.nova`, `vfx_boss_volley`→`boss.volley`, `vfx_boss_charge`→`boss.charge.trail`, `vfx_boss_bolt`→`proj.hostile`. Unknown ids are ignored (no error).

## Generated art in the legacy kit (C3 bridge)

Classic presets (`PresetDef`) draw the SAME generated sprites as the FxSpec runtime: manifest kind `vfx`, packed once into the
spec art array (`vfx/spec/art.ts`), sampled by the legacy particle shader through packed art roles (floats >= 65536 in the
particle `cell`). There is no second atlas. Builder API: `fx.add/alp.at(...).art(KIT_ART.<name>)` (`common/kitArt.ts` registry,
`emit.ts KitArt`), `fx.hasArt()`, `fx.artCell()`; helpers in `presets/kit.ts` (`smoke`, `dustRing`, `ringArc`, `glints`, `cinders`,
`groundFlare`, `crackHeat`, `stain`, `crater`, `lightShaft`, `pillarCross`, `rocks`; table in `vfx/common/README.md`). A sprite that is
not packed draws its procedural atlas fallback, so no preset can break on art. `fx.legacyKit` (gallery `?legacyKit=1`, `vfxstage.ts
--legacyKit`) forces the fallbacks and the pre-C4 shapes for A/B. Shapes (`shp` / `dec`) stay procedural: new patterns `PAT.crackHeat`
(Voronoi crack network, hot seams cool to char), `PAT.stain`, `PAT.crater`, `PAT.pillarPlane` (+ `shp.plane(w, h)`, shader mode 4).
`kit.demo` (`a` = 0..5) is the QA sheet of all of it.
