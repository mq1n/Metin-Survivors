// Forge viewer: loads a GLB, plays its clips, renders fixed camera presets (portrait / side / top / gameplay).
// Query: src=<url> clip=<name> preset=<portrait|front|side|top|game|back> t=<seconds> yaw=<deg> ui=0|1 wire=0|1 bones=0|1
//        focus=<bone> dist=<m> (centre any preset on a bone, fixed distance)  weapon=/weapon2=<glb> wfix=1 (attach to hand_r/hand_l)
// Ready signalling for screenshot scripts: window.__ready === true, window.__info = {...}.
import * as THREE from 'three';
import { type GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

declare global {
  interface Window {
    __ready?: boolean;
    __info?: unknown;
    __setPose?: (clip: string, t: number) => void;
    __setPreset?: (preset: string) => void;
    __render?: () => void;
  }
}

const q = new URLSearchParams(location.search);
const PRESETS = ['portrait', 'front', 'side', 'top', 'back', 'game', 'head', 'headside'] as const;
type Preset = (typeof PRESETS)[number];

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const bgTop = new THREE.Color('#8fa7a0'), bgBot = new THREE.Color('#cfc7a8');
scene.background = bgTop;
scene.fog = new THREE.Fog('#b9bfa8', 40, 120);

const hemi = new THREE.HemisphereLight('#cfe3ff', '#6b5b3a', 1.15);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff0d4', 2.6);
sun.position.set(-4, 7, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
const fill = new THREE.DirectionalLight('#9bb6ff', 0.55);
fill.position.set(5, 3, -4);
scene.add(fill);

// ground: soft disc with a subtle ring + grid so scale reads
const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#6f7a58', roughness: 1 }));
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(40, 40, '#4c563a', '#5d684a');
(grid.material as THREE.Material).transparent = true;
(grid.material as THREE.Material).opacity = 0.35;
grid.position.y = 0.002;
scene.add(grid);

const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 400);
const root = new THREE.Group();
scene.add(root);
(window as unknown as { __scene: THREE.Scene }).__scene = scene;

// ------------------------------------------------------------- human silhouette (1.8 m) for scale
function makeHuman(): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: '#2a2630', roughness: 0.9 });
  const add = (geo: THREE.BufferGeometry, x: number, y: number, z: number): void => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
  };
  add(new THREE.SphereGeometry(0.11, 16, 12), 0, 1.69, 0); // head
  add(new THREE.CapsuleGeometry(0.17, 0.5, 6, 12), 0, 1.25, 0); // torso
  add(new THREE.CapsuleGeometry(0.07, 0.7, 4, 8), -0.12, 0.42, 0); // legs
  add(new THREE.CapsuleGeometry(0.07, 0.7, 4, 8), 0.12, 0.42, 0);
  add(new THREE.CapsuleGeometry(0.045, 0.55, 4, 8), -0.26, 1.18, 0); // arms
  add(new THREE.CapsuleGeometry(0.045, 0.55, 4, 8), 0.26, 1.18, 0);
  return g;
}
const human = makeHuman();
human.visible = false;
scene.add(human);

// ------------------------------------------------------------- model
let mixer: THREE.AnimationMixer | null = null;
let clips: THREE.AnimationClip[] = [];
let action: THREE.AnimationAction | null = null;
let model: THREE.Object3D | null = null;
let skinned: THREE.SkinnedMesh | null = null;
let box = new THREE.Box3();
let wire: THREE.Mesh | null = null;
let skeletonHelper: THREE.SkeletonHelper | null = null;
let playing = q.get('t') === null;
let preset: Preset = (PRESETS as readonly string[]).includes(q.get('preset') ?? '') ? (q.get('preset') as Preset) : 'portrait';
let yawDeg = Number(q.get('yaw') ?? 0);
const clock = new THREE.Clock();

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

async function load(url: string): Promise<void> {
  const gltf = await loader.loadAsync(url);
  if (model) root.remove(model);
  model = gltf.scene;
  root.add(model);
  clips = gltf.animations;
  skinned = null;
  let tris = 0;
  model.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      if (m.isSkinnedMesh) skinned = m;
      const mat = m.material as THREE.MeshStandardMaterial;
      if (m.geometry.attributes.color) mat.vertexColors = true;
      mat.side = THREE.FrontSide;
      tris += (m.geometry.index?.count ?? m.geometry.attributes.position!.count) / 3;
    }
  });
  mixer = new THREE.AnimationMixer(model);
  box = new THREE.Box3();
  // bounding box from raw bind-pose positions (accessor min/max may be stale after quantisation)
  box.makeEmpty();
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      const pos = m.geometry.attributes.position as THREE.BufferAttribute;
      const b = new THREE.Box3().setFromBufferAttribute(pos);
      b.applyMatrix4(m.matrixWorld);
      box.union(b);
    }
  });
  if (box.isEmpty()) box.setFromObject(model);
  if (wire) root.remove(wire);
  if (q.get('wire') === '1' && skinned) {
    const s = skinned as THREE.SkinnedMesh;
    const wm = new THREE.MeshBasicMaterial({ color: '#0b0b0b', wireframe: true, transparent: true, opacity: 0.35 });
    wire = new THREE.SkinnedMesh(s.geometry, wm);
    (wire as THREE.SkinnedMesh).bind(s.skeleton, s.bindMatrix);
    wire.frustumCulled = false;
    model.add(wire);
  }
  if (skeletonHelper) scene.remove(skeletonHelper);
  if (q.get('bones') === '1') {
    skeletonHelper = new THREE.SkeletonHelper(model);
    scene.add(skeletonHelper);
  }
  const extras = (gltf.scene.userData ?? {}) as Record<string, unknown>;
  const sceneExtras = (gltf.scenes[0]?.userData ?? extras) as Record<string, unknown>;
  // optional weapon proxies (?weapon=<glb>&weapon2=<glb>&wfix=1): attached to hand_r / hand_l; wfix applies the hand-frame mapping
  // (weapon +Y -> hand +Z, weapon +Z -> hand -X/+X) for weapon GLBs that do not have it baked in yet
  for (const [param, boneName] of [['weapon', 'hand_r'], ['weapon2', 'hand_l']] as const) {
    const wurl = q.get(param);
    const bone = model.getObjectByName(boneName);
    if (!wurl || !bone) continue;
    let wg: GLTF;
    try {
      wg = await loader.loadAsync(wurl);
    } catch (err) {
      console.error('weapon load failed', wurl, err);
      continue;
    }
    wg.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.frustumCulled = false;
        const mat = m.material as THREE.MeshStandardMaterial;
        if (m.geometry.attributes.color) mat.vertexColors = true;
      }
    });
    if (q.get('wfix') === '1') {
      const right = param === 'weapon';
      const mtx = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, right ? -1 : 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(right ? -1 : 1, 0, 0));
      wg.scene.quaternion.setFromRotationMatrix(mtx);
    }
    bone.add(wg.scene);
    (window as unknown as { __wlog?: string[] }).__wlog = [...((window as unknown as { __wlog?: string[] }).__wlog ?? []), `${param}:${boneName}:${wg.scene.children.length}`];
  }
  window.__info = {
    tris,
    clips: clips.map((c) => ({ name: c.name, duration: c.duration })),
    height: box.max.y,
    size: box.getSize(new THREE.Vector3()).toArray(),
    extras: sceneExtras,
  };
}

function setClip(name: string): void {
  if (!mixer) return;
  const clip = clips.find((c) => c.name === name) ?? clips[0];
  if (!clip) return;
  if (action) action.stop();
  action = mixer.clipAction(clip);
  action.reset().play();
  const cl = document.getElementById('clip') as HTMLSelectElement | null;
  if (cl) cl.value = clip.name;
}

function seek(clipName: string, t: number): void {
  setClip(clipName);
  if (!mixer || !action) return;
  action.paused = false;
  mixer.setTime(0);
  mixer.update(0);
  mixer.setTime(t);
  action.paused = true;
  playing = false;
}

// ------------------------------------------------------------- cameras
function frame(): void {
  const w = canvas.clientWidth || 1280, h = canvas.clientHeight || 960;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.length() * 0.5, 0.3);
  root.rotation.y = (yawDeg * Math.PI) / 180;
  human.visible = preset === 'game';
  if (preset === 'game') {
    camera.fov = 40;
    camera.updateProjectionMatrix();
    const pitch = (55 * Math.PI) / 180, dist = 22;
    const target = new THREE.Vector3(0.9, 0.5, 0);
    camera.position.set(target.x, target.y + Math.sin(pitch) * dist, target.z - Math.cos(pitch) * dist);
    camera.lookAt(target);
    human.position.set(1.7, 0, 0);
    root.position.set(0, 0, 0);
  } else {
    camera.fov = 28;
    camera.updateProjectionMatrix();
    const c = center.clone();
    const focusName = q.get('focus');
    const isHead = preset === 'head' || preset === 'headside' || !!focusName;
    if (isHead) {
      const hn = root.getObjectByName(focusName ?? 'head');
      if (hn) hn.getWorldPosition(c);
    }
    let dir: THREE.Vector3;
    switch (preset) {
      case 'front': dir = new THREE.Vector3(0, 0.12, 1); break;
      case 'back': dir = new THREE.Vector3(0, 0.2, -1); break;
      case 'side': dir = new THREE.Vector3(-1, 0.04, 0); break;
      case 'top': dir = new THREE.Vector3(0, 1, -0.001); break;
      case 'head': dir = new THREE.Vector3(0.55, 0.12, 0.83); break;
      case 'headside': dir = new THREE.Vector3(1, 0.05, 0.12); break;
      default: dir = new THREE.Vector3(0.62, 0.34, 0.78); break; // front 3/4 (camera at +x,+z, creature faces +z)
    }
    dir.normalize();
    // rotate direction with the model yaw so presets stay model-relative
    const e = new THREE.Euler(0, (yawDeg * Math.PI) / 180, 0);
    root.rotation.y = 0;
    dir.applyEuler(e);
    const up = new THREE.Vector3(0, preset === 'top' ? 0 : 1, preset === 'top' ? 1 : 0).applyEuler(e);
    // fit: smallest distance at which every bbox corner lies inside the frustum with a margin
    const right = new THREE.Vector3().crossVectors(up, dir).normalize();
    const upv = new THREE.Vector3().crossVectors(dir, right).normalize();
    const tanV = Math.tan((camera.fov * Math.PI) / 360), tanH = tanV * camera.aspect;
    const fill = 0.8;
    let dist = 0.5;
    if (isHead) dist = q.get('dist') !== null ? Number(q.get('dist')) : Math.max(0.45, size.y * 0.75);
    else for (let i = 0; i < 8; i++) {
      const corner = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(c);
      const depth = corner.dot(dir), x = Math.abs(corner.dot(right)), y = Math.abs(corner.dot(upv));
      dist = Math.max(dist, depth + x / (tanH * fill), depth + y / (tanV * fill));
    }
    void radius;
    camera.position.copy(c).addScaledVector(dir, dist);
    camera.up.copy(up);
    camera.lookAt(c);
    human.position.set(2, 0, 0);
  }
  sun.target.position.copy(root.position);
  sun.position.set(-4, 7, 5);
  sun.shadow.camera.left = -4; sun.shadow.camera.right = 4; sun.shadow.camera.top = 4; sun.shadow.camera.bottom = -4;
  sun.shadow.camera.far = 30;
  sun.shadow.camera.updateProjectionMatrix();
  // shadow & ground follow the focus so the soft shadow is always inside the frustum
  ground.position.set(0, 0, 0);
}

function render(): void {
  frame();
  renderer.render(scene, camera);
}

function tick(): void {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (mixer && playing) mixer.update(dt);
  render();
  requestAnimationFrame(tick);
}

// ------------------------------------------------------------- UI
function buildUi(src: string): void {
  if (q.get('ui') === '0') return;
  const ui = document.createElement('div');
  ui.id = 'ui';
  ui.innerHTML = `
    <select id="model"></select>
    <select id="clip"></select>
    <select id="preset">${PRESETS.map((p) => `<option>${p}</option>`).join('')}</select>
    <label><input id="play" type="checkbox" checked> play</label>
    <input id="scrub" type="range" min="0" max="1" step="0.001" value="0" style="width:160px">
    <label>yaw <input id="yaw" type="range" min="-180" max="180" value="${yawDeg}" style="width:100px"></label>
    <span id="info"></span>`;
  document.body.appendChild(ui);
  const msel = ui.querySelector('#model') as HTMLSelectElement;
  fetch('/api/models').then((r) => r.json()).then((list: { label: string; url: string }[]) => {
    msel.innerHTML = list.map((m) => `<option value="${m.url}" ${m.url === src ? 'selected' : ''}>${m.label}</option>`).join('');
  });
  msel.onchange = () => { location.search = `?src=${encodeURIComponent(msel.value)}&preset=${preset}`; };
  const clipSel = ui.querySelector('#clip') as HTMLSelectElement;
  clipSel.innerHTML = clips.map((c) => `<option>${c.name}</option>`).join('');
  clipSel.onchange = () => { setClip(clipSel.value); playing = (ui.querySelector('#play') as HTMLInputElement).checked; };
  const ps = ui.querySelector('#preset') as HTMLSelectElement;
  ps.value = preset;
  ps.onchange = () => { preset = ps.value as Preset; };
  (ui.querySelector('#play') as HTMLInputElement).onchange = (e) => { playing = (e.target as HTMLInputElement).checked; };
  (ui.querySelector('#scrub') as HTMLInputElement).oninput = (e) => {
    const t = Number((e.target as HTMLInputElement).value) * (action?.getClip().duration ?? 1);
    seek(clipSel.value, t);
    (ui.querySelector('#play') as HTMLInputElement).checked = false;
  };
  (ui.querySelector('#yaw') as HTMLInputElement).oninput = (e) => { yawDeg = Number((e.target as HTMLInputElement).value); };
  const info = window.__info as { tris: number; clips: unknown[]; height: number };
  (ui.querySelector('#info') as HTMLElement).textContent = `${info.tris} tris · ${info.clips.length} clips · h ${info.height.toFixed(2)} m`;
}

async function main(): Promise<void> {
  const src = q.get('src') ?? '/tmp/wolf.glb';
  await load(src);
  const clipName = q.get('clip') ?? (clips.find((c) => c.name === 'idle') ?? clips[0])?.name ?? '';
  setClip(clipName);
  const t = q.get('t');
  if (t !== null) seek(clipName, Number(t));
  buildUi(src);
  window.__setPose = (c, tt) => { seek(c, tt); render(); };
  window.__setPreset = (p) => { preset = p as Preset; render(); };
  window.__render = render;
  render();
  window.__ready = true;
  tick();
}

main().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f66;position:absolute;top:40px;left:8px">${String(e)}</pre>`);
});
window.addEventListener('resize', render);
