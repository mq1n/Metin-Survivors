// Parts of the story dialog's speaker plate (owner: B9 story): the live boss stage (the boss GLB, lit, on a transparent WebGL
// canvas), the coin-bezel seal of an outcome, and the engraved floor sigil of a metin stone.
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { texUrl } from '../assets';
import { UiGlyph, type UiGlyphProps } from '../components/StatIcon';
import { deps } from '../env';
import { fitDistance, hash32, rng, sigilOf } from './storyArt';
import { paperPixels, SWIRL_H, SWIRL_W, swirlShapes, WEAVE_SIZE, weavePixels, type PaperTone } from './storyPaper';

type Three = typeof import('three');

// ---------------------------------------------------------------------------------------------------------------
// Boss stage

/**
 * The boss' floor: a dark stone ring with engraved rune ticks, a few ember cracks and a soft contact shadow, painted once on a canvas and
 * laid flat under the model, so it follows the camera's perspective and the boss stands on it (no flat DOM ellipse).
 */
function daisTexture(T: Three): InstanceType<Three['CanvasTexture']> | null {
  if (typeof document === 'undefined') return null;
  const S = 512;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  if (!g) return null;
  const m = S / 2;
  const rand = rng(hash32('story-dais'));
  // contact shadow + outer glow of the embers
  let gr = g.createRadialGradient(m, m, S * 0.08, m, m, m);
  gr.addColorStop(0, 'rgba(0,0,0,0.0)');
  gr.addColorStop(0.62, 'rgba(0,0,0,0.0)');
  gr.addColorStop(0.9, 'rgba(255,80,30,0.2)');
  gr.addColorStop(1, 'rgba(255,60,20,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  // stone ring: light top-left, dark bottom-right
  const ring = (r0: number, r1: number, hi: string, lo: string): void => {
    const lg = g.createLinearGradient(m - r1, m - r1, m + r1, m + r1);
    lg.addColorStop(0, hi);
    lg.addColorStop(1, lo);
    g.beginPath();
    g.arc(m, m, r1, 0, Math.PI * 2);
    g.arc(m, m, r0, 0, Math.PI * 2, true);
    g.fillStyle = lg;
    g.fill('evenodd');
  };
  ring(m * 0.74, m * 0.96, '#6d665c', '#26221e');
  ring(m * 0.74, m * 0.775, '#0b0908', '#0b0908');
  ring(m * 0.935, m * 0.96, '#0b0908', '#0b0908');
  // the floor inside: dark, a little warmer toward the middle
  gr = g.createRadialGradient(m, m, 0, m, m, m * 0.74);
  gr.addColorStop(0, '#2a1710');
  gr.addColorStop(0.7, '#150b08');
  gr.addColorStop(1, '#0a0605');
  g.beginPath();
  g.arc(m, m, m * 0.74, 0, Math.PI * 2);
  g.fillStyle = gr;
  g.fill();
  // engraved ticks on the ring (invented marks: dashes of two lengths)
  g.lineCap = 'round';
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    const long = i % 3 === 0;
    const r0 = m * (long ? 0.8 : 0.84);
    const r1 = m * 0.915;
    g.strokeStyle = long ? '#0d0a08' : 'rgba(13,10,8,0.75)';
    g.lineWidth = long ? 5 : 3;
    g.beginPath();
    g.moveTo(m + Math.cos(a) * r0, m + Math.sin(a) * r0);
    g.lineTo(m + Math.cos(a) * r1, m + Math.sin(a) * r1);
    g.stroke();
  }
  // ember rim just inside the ring and the cracks running from it toward the middle
  g.shadowColor = 'rgba(255,90,30,0.95)';
  g.shadowBlur = 16;
  g.strokeStyle = 'rgba(255,128,56,0.9)';
  g.lineWidth = 3.4;
  g.beginPath();
  g.arc(m, m, m * 0.735, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 2.4;
  g.strokeStyle = 'rgba(255,150,70,0.85)';
  for (let i = 0; i < 9; i++) {
    let a = rand() * Math.PI * 2;
    let r = m * 0.73;
    g.beginPath();
    g.moveTo(m + Math.cos(a) * r, m + Math.sin(a) * r);
    const steps = 3 + Math.floor(rand() * 3);
    for (let k = 0; k < steps; k++) {
      a += (rand() - 0.5) * 0.4;
      r -= m * (0.06 + rand() * 0.08);
      g.lineTo(m + Math.cos(a) * r, m + Math.sin(a) * r);
    }
    g.stroke();
  }
  g.shadowBlur = 0;
  const tex = new T.CanvasTexture(c);
  tex.colorSpace = T.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function mountStage(T: Three, host: HTMLElement, modelId: string, ready: () => void): () => void {
  const { assets } = deps();
  const model = assets.model(modelId);
  const inst = assets.instantiate(modelId);
  const renderer = new T.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'default' });
  try {
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
    host.appendChild(renderer.domElement);

    const scene = new T.Scene();
    scene.add(new T.HemisphereLight('#c9d4ff', '#4a2a22', 0.95));
    const key = new T.DirectionalLight('#ffe9cc', 2.7);
    key.position.set(2.6, 3.6, 3.4);
    const rim = new T.DirectionalLight('#ff6a3a', 2.3);
    rim.position.set(-3.2, 2.2, -2.6);
    const fill = new T.DirectionalLight('#7fa0ff', 0.55);
    fill.position.set(-2.4, 0.8, 3.2);
    scene.add(key, rim, fill);
    const pivot = new T.Group();
    scene.add(pivot);
    const camera = new T.PerspectiveCamera(30, 1, 0.05, 80);

    for (const m of inst.meshes) m.frustumCulled = false;
    pivot.add(inst.root);
    let mixer: InstanceType<Three['AnimationMixer']> | null = new T.AnimationMixer(inst.root);
    const idle = model.clipMap.get('idle') ?? model.clipMap.get('walk');
    const roar = model.clipMap.get('special1') ?? model.clipMap.get('spawn');
    const idleAction = idle ? mixer.clipAction(idle) : null;
    if (roar && idleAction) {
      // the boss starts with its roar / spawn clip, then settles into its idle loop
      const a = mixer.clipAction(roar);
      a.setLoop(T.LoopOnce, 1);
      a.clampWhenFinished = true;
      a.play();
      const onDone = (e: { action: unknown }): void => {
        if (e.action !== a) return;
        idleAction.reset().play();
        idleAction.crossFadeFrom(a, 0.35, false);
      };
      mixer.addEventListener('finished', onDone as never);
    } else idleAction?.play();
    mixer.update(0);
    inst.root.updateMatrixWorld(true);
    const box = new T.Box3().setFromObject(inst.root);
    const size = box.getSize(new T.Vector3());
    const center = box.getCenter(new T.Vector3());
    // stand the foot of the boss on y = 0 under the pivot, centred on x / z
    inst.root.position.set(-center.x, -box.min.y, -center.z);
    const h = Math.max(size.y, 0.4);
    const w = Math.max(size.x, size.z, 0.4);
    // the boss stands on its dais (the ring turns slowly)
    const daisTex = daisTexture(T);
    let dais: InstanceType<Three['Mesh']> | null = null;
    if (daisTex) {
      const R = Math.max(w * 0.55, h * 0.4, 0.45);
      dais = new T.Mesh(
        new T.PlaneGeometry(R * 2, R * 2),
        new T.MeshBasicMaterial({ map: daisTex, transparent: true, depthWrite: false, toneMapped: false }),
      );
      dais.rotation.x = -Math.PI / 2;
      dais.position.y = 0.012;
      scene.add(dais);
    }

    let disposed = false;
    let aspect = 1;
    const place = (): void => {
      const dist = fitDistance(h, w, camera.fov, aspect) * 0.94;
      camera.position.set(0, h * 0.72 + dist * 0.14, dist);
      camera.lookAt(0, h * 0.4, 0);
    };
    const resize = (): void => {
      const cw = Math.max(1, host.clientWidth);
      const ch = Math.max(1, host.clientHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(cw, ch, false);
      aspect = cw / ch;
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      place();
    };
    let roRaf = 0;
    const onResize = (): void => {
      if (roRaf || disposed) return;
      roRaf = requestAnimationFrame(() => {
        roRaf = 0;
        if (!disposed) resize();
      });
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(host);
    resize();

    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    let last = performance.now();
    let clock = 0;
    let raf = 0;
    let first = true;
    const frame = (now: number): void => {
      if (disposed) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      clock += dt;
      pivot.rotation.y = 0.62 + (reduced ? 0 : Math.sin(clock * 0.55) * 0.34);
      if (dais && !reduced) dais.rotation.z = clock * 0.08;
      mixer?.update(dt);
      renderer.render(scene, camera);
      if (first) {
        first = false;
        ready();
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      if (roRaf) cancelAnimationFrame(roRaf);
      ro.disconnect();
      mixer?.stopAllAction();
      mixer = null;
      if (dais) {
        dais.geometry.dispose();
        (dais.material as { dispose(): void }).dispose();
      }
      daisTex?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  } catch (err) {
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
    throw err;
  }
}

/** The boss, alive on the plate. Calls `onFail` when the model or WebGL is not available (the plate then shows its seal). */
export function BossStage({ modelId, onFail }: { modelId: string; onFail?: () => void }): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const fail = useRef(onFail);
  fail.current = onFail;
  useEffect(() => {
    setReady(false);
    const el = host.current;
    if (!el) return undefined;
    let disposed = false;
    let teardown: (() => void) | null = null;
    void (async () => {
      try {
        const [T] = await Promise.all([import('three'), deps().assets.loadBatch([{ kind: 'model', id: modelId }])]);
        if (disposed) return;
        teardown = mountStage(T, el, modelId, () => !disposed && setReady(true));
      } catch {
        if (!disposed) fail.current?.();
      }
    })();
    return () => {
      disposed = true;
      teardown?.();
    };
  }, [modelId]);
  return <div class={`ms-story-stage ${ready ? 'is-ready' : ''}`} ref={host} aria-hidden="true" />;
}

// ---------------------------------------------------------------------------------------------------------------
// Emblem: a dark-stone octagon with a thin gold rim and an engraved glyph (the frame's own materials: charcoal stone + gold edge)

export function Emblem({ glyph, tone = 'gold', size, class: cls = '' }: { glyph: UiGlyphProps['name']; tone?: NonNullable<UiGlyphProps['tone']>; size?: string; class?: string }): JSX.Element {
  return (
    <span class={`ms-story-emblem ${cls}`} style={size ? ({ '--em': size } as JSX.CSSProperties) : undefined} aria-hidden="true">
      <UiGlyph name={glyph} tone={tone} flat />
    </span>
  );
}

/** The big stone emblem of the plate, used when the boss cannot be drawn (no WebGL / model failed). */
export function Seal({ glyph, tone, size = '6.4rem', class: cls = '' }: { glyph: UiGlyphProps['name']; tone: NonNullable<UiGlyphProps['tone']>; size?: string; class?: string }): JSX.Element {
  return (
    <div class={`ms-story-seal ${cls}`} aria-hidden="true">
      <Emblem glyph={glyph} tone={tone} size={size} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Sigil: invented glyph ring engraved on the ground under a metin stone

export function Sigil({ id, great }: { id: string; great: boolean }): JSX.Element {
  const s = useMemo(() => sigilOf(id, great), [id, great]);
  return (
    <svg class="ms-story-sigil" viewBox="-50 -50 100 100" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
      <circle r="49.2" stroke-width="0.7" opacity="0.5" />
      {s.inner > 0 && <circle r={s.inner} stroke-width="1" opacity="0.75" stroke-dasharray="2.4 3.4" />}
      <g stroke-width="2.3">
        {s.arcs.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
      <path d={s.ticks} stroke-width="1.2" opacity="0.8" />
      <path d={s.strokes} stroke-width="2.1" />
      <g fill="currentColor" stroke="none">
        {s.nodes.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r="2.3" />
        ))}
        <circle r="3" />
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Swirl: a faded sepia print in the corner of the sheet, like the quest paper's printed filigree: one flat ink colour (no highlights,
// no specular), laid into the paper with multiply and a low opacity so the grid and the weave run through it. The painted
// uk_story_swirl only supplies the silhouette (CSS mask); without it an own drawing (tapered outlines) is printed the same way.
// The wrapper clips it to the inside of the frame lip, so the strokes come out from under the frame.

export function Swirl(): JSX.Element {
  const tex = texUrl('uk_story_swirl');
  const shapes = useMemo(() => swirlShapes(), []);
  return (
    <div class="ms-story-swirlbox" aria-hidden="true">
      {tex ? (
        <div class="ms-story-swirl is-print" style={{ '--swirl': `url("${tex}")` } as JSX.CSSProperties} />
      ) : (
        <svg class="ms-story-swirl" viewBox={`0 0 ${SWIRL_W} ${SWIRL_H}`} preserveAspectRatio="xMaxYMax meet" fill="#8a6222">
          {shapes.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </svg>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Weave: the seamless thread overlay of the paper as a data URL (painted once; null when there is no canvas)

let weaveCache: string | null | undefined;

export function weaveUrl(): string | null {
  if (weaveCache !== undefined) return weaveCache;
  weaveCache = null;
  try {
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas');
    c.width = WEAVE_SIZE;
    c.height = WEAVE_SIZE;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    const img = ctx.createImageData(WEAVE_SIZE, WEAVE_SIZE);
    img.data.set(weavePixels(hash32('story-weave')));
    ctx.putImageData(img, 0, 0);
    const url = c.toDataURL('image/png');
    weaveCache = url.startsWith('data:image/png') ? url : null;
  } catch {
    weaveCache = null;
  }
  return weaveCache;
}

// ---------------------------------------------------------------------------------------------------------------
// Paper: the sheet's painted noise texture as a data URL (cached per tone; null when there is no canvas)

const PAPER_W = 800;
const PAPER_H = 520;
const paperCache = new Map<string, string>();

export function paperUrl(key: string, tone: PaperTone): string | null {
  const hit = paperCache.get(key);
  if (hit) return hit;
  try {
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas');
    c.width = PAPER_W;
    c.height = PAPER_H;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    const img = ctx.createImageData(PAPER_W, PAPER_H);
    img.data.set(paperPixels(PAPER_W, PAPER_H, hash32(`paper:${key}`), tone));
    ctx.putImageData(img, 0, 0);
    const url = c.toDataURL('image/jpeg', 0.9);
    if (!url.startsWith('data:image/jpeg')) return null;
    paperCache.set(key, url);
    return url;
  } catch {
    return null;
  }
}
