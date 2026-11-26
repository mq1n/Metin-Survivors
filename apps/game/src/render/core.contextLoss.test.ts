import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Assets } from '../engine/assets';

const { renderCalls, setSizeCalls, disposeCalls } = vi.hoisted(() => ({
  renderCalls: { count: 0 },
  setSizeCalls: { count: 0 },
  disposeCalls: { count: 0 },
}));

vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three');
  class MockWebGLRenderer {
    toneMapping = 0;
    toneMappingExposure = 1;
    shadowMap = { type: 0, autoUpdate: true, enabled: false };
    info = { autoReset: true, reset: vi.fn() };
    capabilities = { getMaxAnisotropy: () => 4 };
    setClearColor = vi.fn();
    setPixelRatio = vi.fn();
    setSize = vi.fn(() => {
      setSizeCalls.count++;
    });
    getContext = vi.fn(() => ({
      getParameter: () => 4096,
      getExtension: () => null,
    }));
    render = vi.fn(() => {
      renderCalls.count++;
    });
    dispose = vi.fn(() => {
      disposeCalls.count++;
    });
  }
  return { ...actual, WebGLRenderer: MockWebGLRenderer };
});

import { RenderCore, type RenderSystem } from './core';

function makeFakeCanvas(): {
  canvas: HTMLCanvasElement;
  listeners: Map<string, Set<(e: Event) => void>>;
  emit: (type: string, ev?: Partial<Event>) => { defaultPrevented: boolean };
} {
  const listeners = new Map<string, Set<(e: Event) => void>>();
  const canvas = {
    clientWidth: 800,
    clientHeight: 600,
    width: 800,
    height: 600,
    addEventListener(type: string, fn: (e: Event) => void) {
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(fn);
    },
    removeEventListener(type: string, fn: (e: Event) => void) {
      listeners.get(type)?.delete(fn);
    },
  } as unknown as HTMLCanvasElement;
  return {
    canvas,
    listeners,
    emit(type, ev = {}) {
      let defaultPrevented = false;
      const event = {
        ...ev,
        type,
        preventDefault() {
          defaultPrevented = true;
        },
      } as unknown as Event;
      for (const fn of [...(listeners.get(type) ?? [])]) fn(event);
      return { defaultPrevented };
    },
  };
}

describe('RenderCore WebGL context loss & restoration (RENDER-05)', () => {
  const origWindow = globalThis.window;
  const origResizeObserver = globalThis.ResizeObserver;

  afterEach(() => {
    renderCalls.count = 0;
    setSizeCalls.count = 0;
    disposeCalls.count = 0;
    if (origWindow === undefined) Reflect.deleteProperty(globalThis, 'window');
    else globalThis.window = origWindow;
    if (origResizeObserver === undefined) Reflect.deleteProperty(globalThis, 'ResizeObserver');
    else globalThis.ResizeObserver = origResizeObserver;
  });

  function setupCore() {
    globalThis.window = { devicePixelRatio: 1 } as unknown as Window & typeof globalThis;
    globalThis.ResizeObserver = class {
      observe(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;
    const fake = makeFakeCanvas();
    const assets = { anisotropy: 1 } as unknown as Assets;
    const core = new RenderCore(fake.canvas, assets, { quality: 'high', fixedQuality: true });
    return { core, fake };
  }

  it('prevents default on webglcontextlost, skips rendering while lost, dispatches lost/restored hooks, and cleans up on dispose', () => {
    const { core, fake } = setupCore();
    const sysUpdate = vi.fn();
    const sys: RenderSystem = { name: 'probe', update: sysUpdate };
    core.addSystem(sys);

    const events: string[] = [];
    const offLost = core.onContextLost(() => events.push('lost'));
    const offRestored = core.onContextRestored(() => events.push('restored'));

    expect(core.contextLost).toBe(false);
    core.frame(1 / 60, 0);
    expect(renderCalls.count).toBe(1);
    expect(sysUpdate).toHaveBeenCalledTimes(1);

    // Trigger webglcontextlost
    const lostRes = fake.emit('webglcontextlost');
    expect(lostRes.defaultPrevented).toBe(true);
    expect(core.contextLost).toBe(true);
    expect(events).toEqual(['lost']);

    // Duplicate lost event still prevents default but does not duplicate lost notification
    const lostAgain = fake.emit('webglcontextlost');
    expect(lostAgain.defaultPrevented).toBe(true);
    expect(events).toEqual(['lost']);

    // frame() must skip updates & rendering while context is lost
    core.frame(1 / 60, 0);
    core.frame(1 / 60, 0);
    expect(renderCalls.count).toBe(1);
    expect(sysUpdate).toHaveBeenCalledTimes(1);

    // Trigger webglcontextrestored
    const sizesBefore = setSizeCalls.count;
    fake.emit('webglcontextrestored');
    expect(core.contextLost).toBe(false);
    expect(setSizeCalls.count).toBeGreaterThan(sizesBefore);
    expect(events).toEqual(['lost', 'restored']);

    // Rendering resumes after restore
    core.frame(1 / 60, 0);
    expect(renderCalls.count).toBe(2);
    expect(sysUpdate).toHaveBeenCalledTimes(2);

    // Unsubscribe stops notifications
    offLost();
    offRestored();
    fake.emit('webglcontextlost');
    fake.emit('webglcontextrestored');
    expect(events).toEqual(['lost', 'restored']);

    // dispose() removes both listeners from the canvas
    expect(fake.listeners.get('webglcontextlost')?.size).toBe(1);
    expect(fake.listeners.get('webglcontextrestored')?.size).toBe(1);
    core.dispose();
    expect(fake.listeners.get('webglcontextlost')?.size).toBe(0);
    expect(fake.listeners.get('webglcontextrestored')?.size).toBe(0);
  });
});
