import { afterEach, describe, expect, it, vi } from 'vitest';
import { Color, Texture, type WebGLRenderTarget, type WebGLRenderer } from 'three';
import { bakeTextures } from '../textures';
import { bakeSpecAtlas } from '../spec/atlas';
import { SpecArt, type ArtSource } from '../spec/art';

function fakeCanvas2D() {
  const grad = { addColorStop: () => undefined };
  const ctx = {
    save: () => undefined,
    restore: () => undefined,
    translate: () => undefined,
    rotate: () => undefined,
    scale: () => undefined,
    beginPath: () => undefined,
    closePath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    quadraticCurveTo: () => undefined,
    bezierCurveTo: () => undefined,
    arc: () => undefined,
    ellipse: () => undefined,
    rect: () => undefined,
    roundRect: () => undefined,
    clip: () => undefined,
    fill: () => undefined,
    stroke: () => undefined,
    fillRect: () => undefined,
    strokeRect: () => undefined,
    clearRect: () => undefined,
    drawImage: () => undefined,
    setLineDash: () => undefined,
    createRadialGradient: () => grad,
    createLinearGradient: () => grad,
    createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: () => undefined,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    shadowBlur: 0,
    shadowColor: '',
  };
  return {
    width: 0,
    height: 0,
    getContext: () => ctx,
  };
}

function fakeRenderer() {
  const renderedTargets: Array<WebGLRenderTarget | null> = [];
  let currentTarget: WebGLRenderTarget | null = null;
  const renderer = {
    autoClear: true,
    getRenderTarget: () => currentTarget,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    getClearColor: (c: Color) => c,
    getClearAlpha: () => 1,
    setClearColor: () => undefined,
    setRenderTarget: (rt: WebGLRenderTarget | null) => {
      currentTarget = rt;
    },
    clear: () => undefined,
    render: () => {
      renderedTargets.push(currentTarget);
    },
  } as unknown as WebGLRenderer;
  return { renderer, renderedTargets };
}

describe('VFX GPU render target recovery on WebGL context restore (RENDER-05)', () => {
  const origDocument = globalThis.document;

  afterEach(() => {
    if (origDocument === undefined) Reflect.deleteProperty(globalThis, 'document');
    else globalThis.document = origDocument;
  });

  function installFakeDocument(): void {
    globalThis.document = {
      createElement: () => fakeCanvas2D(),
    } as unknown as Document;
  }

  it('re-bakes legacy 2048x2048 atlas and 256x256 noise render targets on context restore', () => {
    installFakeDocument();
    const { renderer, renderedTargets } = fakeRenderer();
    const tex = bakeTextures(renderer);
    const initialRenders = renderedTargets.length;
    expect(initialRenders).toBeGreaterThan(10);
    expect(renderedTargets).toContain(tex.atlasRT);
    expect(renderedTargets).toContain(tex.noiseRT);

    renderedTargets.length = 0;
    tex.onContextRestored();
    expect(renderedTargets.length).toBe(initialRenders);
    expect(renderedTargets).toContain(tex.atlasRT);
    expect(renderedTargets).toContain(tex.noiseRT);

    // No-op after dispose
    tex.dispose();
    renderedTargets.length = 0;
    tex.onContextRestored();
    expect(renderedTargets.length).toBe(0);
  });

  it('re-bakes the spec fallback atlas render target on context restore', () => {
    installFakeDocument();
    const { renderer, renderedTargets } = fakeRenderer();
    const atlas = bakeSpecAtlas(renderer);
    const initialRenders = renderedTargets.length;
    expect(initialRenders).toBeGreaterThan(5);
    expect(renderedTargets).toContain(atlas.rt);

    renderedTargets.length = 0;
    atlas.onContextRestored();
    expect(renderedTargets.length).toBe(initialRenders);
    expect(renderedTargets).toContain(atlas.rt);

    atlas.dispose();
    renderedTargets.length = 0;
    atlas.onContextRestored();
    expect(renderedTargets.length).toBe(0);
  });

  it('invalidates cached SpecArt state, marks source textures for re-upload, and re-bakes WebGLArrayRenderTarget on context restore', async () => {
    const { renderer, renderedTargets } = fakeRenderer();
    const art = new SpecArt(renderer, 2);
    const srcTex = new Texture();
    const src: ArtSource = {
      manifest: {
        textures: {
          spark_a: { w: 128, h: 128, alpha: true },
        },
      },
      hasTexture: (id) => id === 'spark_a',
      loadTexture: async () => srcTex,
    };

    await art.preload(src, ['spark_a'], true);
    const firstRole = art.role('spark_a', false);
    const firstTex = art.texture;
    const firstVersion = art.version;
    expect(firstRole).not.toBeNull();
    expect(art.stats.sprites).toBe(1);

    const oldRtDispose = vi.spyOn((art as unknown as { rt: { dispose(): void } }).rt, 'dispose');
    renderedTargets.length = 0;

    art.onContextRestored();

    expect(oldRtDispose).toHaveBeenCalledTimes(1);
    expect(renderedTargets.length).toBeGreaterThan(0);
    expect(art.version).toBeGreaterThan(firstVersion);
    expect(art.texture).not.toBe(firstTex);
    expect(art.role('spark_a', false)).toEqual(firstRole);
    expect(art.stats.sprites).toBe(1);

    // No-op after dispose
    art.dispose();
    const verAfterDispose = art.version;
    renderedTargets.length = 0;
    art.onContextRestored();
    expect(renderedTargets.length).toBe(0);
    expect(art.version).toBe(verAfterDispose);
  });
});
