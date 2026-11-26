// createZoneScene: the one entry point Engine calls per run. Composes terrain, liquid, sky/backdrop, vegetation and
// structures for a TerrainField + BiomePreset and drives them each frame.
//   const zs = createZoneScene(core, field, biome);  core.scene.add(zs.group);  await zs.ready;
//   per frame: zs.update(dt, camera, focus, run?);  on tier change: zs.setQuality(profile);  at run end: zs.dispose()
// `run` = { time, corruption }: the run clock and world corruption of the sim (host) or the mirror (guest); with it the zone applies its
// run light arc (arc.ts, PL-03a), the corruption tint and the relief pulse of a metin break (PL-04: the pulse ages on `run.time`, the clock
// that stands still behind an offer). Without it (galleries, previews) nothing moves.
import { Group, HemisphereLight, MathUtils, type PerspectiveCamera, type Vector3 } from 'three';
import type { BiomePreset } from '../../data/schema';
import type { TerrainField } from '../../world/terrainField';
import type { RenderCore } from '../core';
import type { QualityProfile } from '../quality';
import { createVegetation } from '../vegetation';
import { asPostPipeline } from '../post';
import { RunArc, gradeSpecOf, pageArcSwitches, type ArcClock, type ArcState } from './arc';
import { applyArcAtmosphere, configureAtmosphere, updateAtmosphere } from './atmosphere';
import { createFlares } from './flares';
import { createLiquid } from './liquid';
import { lookFor } from './look';
import { createSky } from './sky';
import { createStructures } from './structures';
import { heroViewUniform } from './occlusion';
import { createTerrain } from './terrain';
import { setTerrainArc, type TerrainArc } from './terrainMaterial';
import { worldUniforms, type ZoneContext, type ZoneSystem } from './zoneContext';

export interface ZoneScene {
  /** add to core.scene */
  readonly group: Group;
  /** resolves when textures/geometry of every system are ready */
  readonly ready: Promise<void>;
  readonly systems: readonly ZoneSystem[];
  /** `run` (PL-03a): the run clock and corruption that drive the zone's light arc; absent = the arc stays where it is */
  update(dt: number, camera: PerspectiveCamera, focus: Vector3, run?: ArcClock): void;
  setQuality(p: QualityProfile): void;
  dispose(): void;
}

export function createZoneScene(core: RenderCore, field: TerrainField, biome: BiomePreset): ZoneScene {
  const ctx: ZoneContext = { core, assets: core.assets, field, biome, quality: core.quality.profile };
  const group = new Group();
  group.name = `zone:${biome.id}`;
  const systems: ZoneSystem[] = [];

  const add = (make: () => ZoneSystem | null): void => {
    try {
      const s = make();
      if (!s) return;
      systems.push(s);
      group.add(s.group);
    } catch (err) {
      // one broken subsystem must not take the whole zone down; the error is still surfaced in the console
      console.error(`[zoneScene] ${biome.id}: system failed to build`, err);
    }
  };
  add(() => createSky(ctx));
  add(() => createTerrain(ctx));
  add(() => createLiquid(ctx));
  add(() => createVegetation(ctx));
  add(() => createStructures(ctx));
  // PL-05: one additive glow at every lit emitter (lantern, brazier, bonfire, pillar); one instanced draw, none on low, its material is in the scene for the load-time warm-up
  add(() => createFlares(ctx, lookFor(biome.id)));

  worldUniforms.uSunDir.value.copy(core.env.sunDir);
  const windPhase = (biome.seed % 628) / 100;
  let time = 0;

  // zone look: shadow fill (extra hemisphere), dynamic shadow strength, cloud shadows / haze for every lit material
  const look = lookFor(biome.id);
  configureAtmosphere(look);
  const sunShadow = core.env.sun.shadow;
  const baseShadowIntensity = sunShadow.intensity;
  sunShadow.intensity = look.shadow.intensity;
  let fill: HemisphereLight | null = null;
  if (look.fill.intensity > 0) {
    fill = new HemisphereLight(look.fill.sky, look.fill.ground, look.fill.intensity);
    fill.name = 'zone:fill';
    group.add(fill);
  }

  // PL-03a: the run light arc, relative to this zone's preset (`biome` is the render biome Environment.setBiome got); PL-04: with the
  // corruption tint of the land on top and the relief pulse of a metin break (the same uniforms, nothing else: no define, no material).
  // An identity arc at corruption 0 never reports a change and nothing below runs. `up=noarc,nocorr` (dev server / VITE_QA_HOOKS only) force the identity for clean
  // captures.
  const arc = new RunArc(look, biome, { switches: pageArcSwitches() });
  const terrainArc: TerrainArc = { shadowTint: arc.state.fill.shadowTint, shadowFill: arc.state.fill.shadowFill, medallionGlow: 0 };
  let arcApplied = false;
  const applyArc = (s: ArcState, grade: boolean): void => {
    const env = core.env;
    env.sun.color.copy(s.sun.color);
    env.sun.intensity = s.sun.intensity;
    env.hemi.color.copy(s.hemi.sky);
    env.hemi.groundColor.copy(s.hemi.ground);
    env.hemi.intensity = s.hemi.intensity;
    env.fog.color.copy(s.fog.color);
    env.fog.near = s.fog.near;
    env.fog.far = s.fog.far;
    if (fill) {
      fill.color.copy(s.zoneFill.sky);
      fill.groundColor.copy(s.zoneFill.ground);
    }
    applyArcAtmosphere(s.haze, s.poolGain);
    terrainArc.shadowFill = s.fill.shadowFill;
    terrainArc.medallionGlow = s.medallionGlow;
    setTerrainArc(terrainArc);
    // the composite pass (absent on low): uniforms only, the GRADE define was fixed at zone load (run.ts setZonePost)
    if (grade) asPostPipeline(core.composer)?.setGrade(gradeSpecOf(s.grade));
  };
  setTerrainArc(null);

  const ready = Promise.all(
    systems.map((s) =>
      Promise.resolve(s.ready).catch((err: unknown) => {
        console.error(`[zoneScene] ${biome.id}: system "${s.name}" failed to load`, err);
      }),
    ),
  ).then(() => undefined);

  return {
    group,
    ready,
    systems,
    update(dt, camera, focus, run) {
      time += dt;
      worldUniforms.uTime.value = time;
      worldUniforms.uFocus.value.copy(focus);
      updateAtmosphere(camera, focus);
      heroViewUniform.value.set(focus.x, focus.y + 1, focus.z).applyMatrix4(camera.matrixWorldInverse);
      worldUniforms.uSunDir.value.copy(core.env.sunDir);
      // slow wind swing with layered gusts
      const a = 0.9 + Math.sin(time * 0.05 + windPhase) * 0.5;
      worldUniforms.uWindDir.value.set(Math.cos(a), Math.sin(a));
      worldUniforms.uWindStrength.value = MathUtils.clamp(0.5 + 0.22 * Math.sin(time * 0.31 + windPhase) + 0.18 * Math.sin(time * 0.93) * Math.sin(time * 0.17), 0.1, 1);
      // PL-04: dt makes the corruption tint follow the world's corruption over ~2 s and times the DETECTION of a metin break (arc.ts); the
      // relief pulse itself ages by the RUN clock (run.time moves only while the sim runs: it waits behind the Metin Essence offer a break opens
      // and plays when the player looks back at the world). A first frame takes the corruption as is. Without the composite pass (low) the arc
      // gives the channels low draws a stronger share (the softer table in a zone lit by a strong coloured key light).
      if (run) arc.composite = asPostPipeline(core.composer)?.active === true;
      if (run && arc.update(run.time, run.corruption, dt)) {
        applyArc(arc.state, arc.gradeDirty);
        arcApplied = true;
      }
      for (const s of systems) s.update(dt, camera, focus);
    },
    setQuality(p) {
      ctx.quality = p;
      for (const s of systems) s.setQuality(p);
    },
    dispose() {
      for (const s of systems) {
        group.remove(s.group);
        s.dispose();
      }
      systems.length = 0;
      if (fill) group.remove(fill);
      sunShadow.intensity = baseShadowIntensity;
      // the next zone / run starts from its own preset anyway (setBiome, configureAtmosphere, a new terrain material); put the lights back for whatever renders in between
      if (arcApplied) {
        applyArc(arc.base, true);
        arcApplied = false;
      }
      setTerrainArc(null);
    },
  };
}
