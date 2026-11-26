// DEV-only: minimal render harness so each render module can be exercised in isolation (demo pages, benchmarks).
// Production builds never import this file (main.ts routes to it only under import.meta.env.DEV).
import {
  Color,
  GridHelper,
  LineBasicMaterial,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
  type Object3D,
} from 'three';
import { Assets } from '../engine/assets';
import { RenderCore, type RenderCoreOptions } from '../render/core';

export interface Harness {
  canvas: HTMLCanvasElement;
  assets: Assets;
  core: RenderCore;
  /** flat ground at y=0 with a 2 m grid so scale/placement is readable */
  ground: Object3D;
  /** runs core.frame every rAF; `onFrame(dt, time)` runs before it. Returns stop(). */
  start(onFrame?: (dt: number, time: number) => void): () => void;
}

export interface HarnessOptions extends RenderCoreOptions {
  groundSize?: number;
  groundColor?: string;
  /** do not draw the debug ground/grid */
  noGround?: boolean;
}

export async function createHarness(opts: HarnessOptions = {}): Promise<Harness> {
  const canvas = document.getElementById('game');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('missing #game canvas');
  const assets = new Assets();
  await assets.init();
  const core = new RenderCore(canvas, assets, opts);
  const size = opts.groundSize ?? 160;
  const ground = new Mesh(
    new PlaneGeometry(size, size).rotateX(-Math.PI / 2),
    new MeshLambertMaterial({ color: new Color(opts.groundColor ?? '#4d5a3a') }),
  );
  ground.receiveShadow = true;
  const grid = new GridHelper(size, size / 2, '#000000', '#000000');
  const gridMat = grid.material as LineBasicMaterial;
  gridMat.transparent = true;
  gridMat.opacity = 0.18;
  grid.position.y = 0.01;
  ground.add(grid);
  if (!opts.noGround) core.scene.add(ground);
  core.env.setBiome({
    fog: { color: '#9bb0c0', near: 70, far: 170 },
    sun: { color: '#fff1d6', intensity: 2.6, dir: [0.45, 0.8, 0.35] },
    ambient: { sky: '#bcd0ff', ground: '#4a3b2a', intensity: 0.9 },
  });
  return {
    canvas,
    assets,
    core,
    ground,
    start(onFrame) {
      let last = performance.now();
      let raf = 0;
      let stopped = false;
      const loop = (now: number): void => {
        if (stopped) return;
        const dt = (now - last) / 1000;
        last = now;
        onFrame?.(Math.min(dt, 0.25), core.clock.time);
        core.frame(dt, 1);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
      return () => {
        stopped = true;
        cancelAnimationFrame(raf);
      };
    },
  };
}
