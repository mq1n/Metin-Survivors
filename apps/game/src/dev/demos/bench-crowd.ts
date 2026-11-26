// DEV benchmark: ?bench=crowd&n=600[&types=4][&quality=high][&auto=1][&post=0]
// auto=1 runs n = 200/400/600/800 for `secs` seconds each and stores results in window.__bench.
import { createHarness } from '../harness';
import { FixedLoop } from '../../engine/loop';
import { GpuTimer, FrameStats } from '../../render/perf';
import { RenderWorld } from '../../render/world';
import type { RenderCore } from '../../render/core';
import type { RenderCatalog, RenderFeeds } from '../../render/feed';
import type { QualityTier } from '../../render/quality';
import { StressDriver } from '../stressDriver';

interface PhaseResult {
  n: number;
  frames: number;
  rafP50: number;
  rafP95: number;
  rafMax: number;
  cpuMeanMs: number;
  cpuP95Ms: number;
  gpuMeanMs: number;
  calls: number;
  triangles: number;
  drawn: number;
  quality: string;
  dpr: number;
}

declare global {
  interface Window {
    __bench?: { results: PhaseResult[]; done: boolean; setN(n: number): void; core: RenderCore; world: RenderWorld };
  }
}

export default async function run(): Promise<void> {
  const q = new URLSearchParams(location.search);
  const n = Number(q.get('n') ?? 600);
  const typeCount = Number(q.get('types') ?? 4);
  const tier = (q.get('quality') ?? 'high') as QualityTier;
  const auto = q.get('auto') === '1';
  const secs = Number(q.get('secs') ?? 8);
  const maxN = auto ? 800 : n;

  const h = await createHarness({ quality: tier, fixedQuality: true });
  // GPU timer queries stall some drivers/browsers (Chrome headless: ~1 s hitches), so they are opt-in: &gpu=1
  if (q.get('gpu') === '1') h.core.gpuTimer = new GpuTimer(h.core.renderer.getContext() as WebGL2RenderingContext);

  const ids = ['bench_quadruped', 'bench_humanoid', 'bench_brute', 'bench_quadruped_b', 'bench_humanoid_b', 'bench_brute_b'];
  const tints = [undefined, undefined, undefined, '#c8b090', '#9fb8ff', '#ffb0b0'];
  const catalog: RenderCatalog = {
    enemyTypes: Array.from({ length: typeCount }, (_, i) => ({
      key: `t${i}`,
      modelId: ids[i % ids.length] as string,
      tint: tints[i % tints.length],
      radius: 0.55,
    })),
    projectileStyles: [],
    metinTypes: [],
  };
  const world = new RenderWorld(h.core, { post: q.get('post') !== '0', vfx: q.get('vfx') !== '0' });
  const loadT0 = performance.now();
  await world.load(catalog, [{ modelId: 'hero_warrior_m_t1', weaponId: 'weapon_sword' }]);
  const loadMs = performance.now() - loadT0;
  const driver = new StressDriver({ enemies: maxN, types: typeCount });
  driver.setEnemyCount(n);
  world.perf.setVisible(q.get('overlay') !== '0');
  world.perf.extra = () => `enemies ${driver.enemies.count} drawn ${world.crowd.stats.drawn} corpses ${world.crowd.stats.corpses}`;

  const move = { x: 0, z: 0 };
  const feeds: RenderFeeds = { enemies: driver.enemies, players: driver.players };
  const loop = new FixedLoop({
    step: (dt) => driver.step(dt, move),
    render: (alpha, dt) => {
      for (const d of driver.events.deaths) world.enemyDied(d.type, d.x, d.z, d.rot, d.scale);
      driver.events.deaths.length = 0;
      const t0 = performance.now();
      world.frame(feeds, dt, alpha);
      phase.cpu.push(performance.now() - t0);
      phase.raf.push(dt * 1000);
      if (h.core.gpuTimer && h.core.gpuTimer.lastMs >= 0) phase.gpu.push(h.core.gpuTimer.lastMs);
      phase.frames++;
      phase.calls = h.core.renderer.info.render.calls;
      phase.tris = h.core.renderer.info.render.triangles;
      phase.drawn = world.crowd.drawnLastFrame;
    },
  });

  const phase = { raf: new FrameStats(), cpu: new FrameStats(), gpu: [] as number[], frames: 0, calls: 0, tris: 0, drawn: 0 };
  const results: PhaseResult[] = [];
  const bench = { results, done: false, setN: (v: number) => driver.setEnemyCount(v), core: h.core, world };
  window.__bench = bench;

  const resetPhase = (): void => {
    phase.raf.reset();
    phase.cpu.reset();
    phase.gpu.length = 0;
    phase.frames = 0;
  };
  const snapshot = (count: number): PhaseResult => ({
    n: count,
    frames: phase.frames,
    rafP50: phase.raf.percentile(0.5),
    rafP95: phase.raf.percentile(0.95),
    rafMax: phase.raf.percentile(1),
    cpuMeanMs: phase.cpu.mean(),
    cpuP95Ms: phase.cpu.percentile(0.95),
    gpuMeanMs: phase.gpu.length ? phase.gpu.reduce((a, b) => a + b, 0) / phase.gpu.length : -1,
    calls: phase.calls,
    triangles: phase.tris,
    drawn: phase.drawn,
    quality: h.core.quality.tier,
    dpr: h.core.pixelRatioApplied.value,
  });

  loop.start();
  console.info(`[bench] models loaded+baked in ${loadMs.toFixed(0)} ms; ${typeCount} types; quality ${tier}`);

  if (auto) {
    for (const count of [200, 400, 600, 800]) {
      driver.setEnemyCount(count);
      await sleep(2000); // warm up (shader compile, buffer growth)
      resetPhase();
      await sleep(secs * 1000);
      results.push(snapshot(count));
      console.info('[bench]', JSON.stringify(results[results.length - 1]));
    }
    bench.done = true;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
