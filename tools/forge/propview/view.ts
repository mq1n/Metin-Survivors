// Prop viewer. Query: src=<url> preset=<iso|three|front|back|side|top|game|low> yaw=<deg> elev=<deg> fov=<deg> fill=<0..1> human=0|1 wire=0|1 sun=<deg azimuth>
// Ready flag for screenshot scripts: window.__ready === true, window.__info = { tris, size, bounds }.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

declare global {
  interface Window {
    __ready?: boolean;
    __info?: unknown;
    __render?: () => void;
    __set?: (o: Record<string, string>) => void;
  }
}

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#9fb7c9');
scene.fog = new THREE.Fog('#b9c6cc', 120, 600);
scene.add(new THREE.HemisphereLight('#cfe1ff', '#7a6a4a', 1.25));
const sun = new THREE.DirectionalLight('#fff1d6', 2.7);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
const fillL = new THREE.DirectionalLight('#9bb6ff', 0.5);
scene.add(fillL);

const ground = new THREE.Mesh(new THREE.CircleGeometry(400, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#7e8a5b', roughness: 1 }));
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(80, 80, '#4c563a', '#5d684a');
(grid.material as THREE.Material).transparent = true;
(grid.material as THREE.Material).opacity = 0.25;
grid.position.y = 0.003;
scene.add(grid);

const human = new THREE.Group();
{
  const mat = new THREE.MeshStandardMaterial({ color: '#30343c', roughness: 0.9 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.95, 4, 10), mat);
  body.position.y = 0.95;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), mat);
  head.position.y = 1.7;
  human.add(body, head);
  human.traverse((o) => { o.castShadow = true; });
}
scene.add(human);

const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 2000);
const root = new THREE.Group();
scene.add(root);
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

let box = new THREE.Box3();
let wire: THREE.Mesh[] = [];
const P: Record<string, string> = Object.fromEntries(q.entries());

async function load(url: string): Promise<void> {
  const gltf = await loader.loadAsync(url);
  root.add(gltf.scene);
  let tris = 0;
  gltf.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    const mat = m.material as THREE.MeshStandardMaterial;
    if (m.geometry.attributes.color) mat.vertexColors = true;
    mat.side = THREE.FrontSide;
    tris += (m.geometry.index?.count ?? m.geometry.attributes.position!.count) / 3;
    if (P.wire === '1') {
      const w = new THREE.Mesh(m.geometry, new THREE.MeshBasicMaterial({ color: '#101010', wireframe: true, transparent: true, opacity: 0.4 }));
      w.frustumCulled = false;
      gltf.scene.add(w);
      wire.push(w);
    }
  });
  box = new THREE.Box3().setFromObject(gltf.scene);
  window.__info = { tris, size: box.getSize(new THREE.Vector3()).toArray(), min: box.min.toArray(), max: box.max.toArray(), extras: gltf.scenes[0]?.userData ?? {} };
}

function frame(): void {
  const w = canvas.clientWidth || 1280, h = canvas.clientHeight || 960;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  const preset = P.preset ?? 'three';
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const yaw = (Number(P.yaw ?? 0) * Math.PI) / 180;
  const defElev: Record<string, number> = { iso: 55, three: 24, front: 6, back: 6, side: 6, top: 89, low: 3 };
  const elev = (Number(P.elev ?? defElev[preset] ?? 24) * Math.PI) / 180;
  const baseYaw: Record<string, number> = { three: 0.55, side: Math.PI / 2, back: Math.PI, iso: 0.0, front: 0, top: 0, low: 0.5 };
  const az = (baseYaw[preset] ?? 0) + yaw;
  // direction from target to camera: yaw 0 = camera on +z (looking at the model front)
  const dir = new THREE.Vector3(Math.sin(az) * Math.cos(elev), Math.sin(elev), Math.cos(az) * Math.cos(elev)).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  if (preset === 'top') up.set(0, 0, -1);
  camera.fov = Number(P.fov ?? (preset === 'game' ? 40 : 30));
  camera.updateProjectionMatrix();
  const c = center.clone();
  if (P.cy) c.y = Number(P.cy);
  let dist = 1;
  if (preset === 'game') {
    const pitch = (55 * Math.PI) / 180;
    const d = Number(P.dist ?? 22);
    dir.set(0, Math.sin(pitch), Math.cos(pitch));
    camera.position.set(0, size.y * 0.35 + Math.sin(pitch) * d, Math.cos(pitch) * d);
    camera.lookAt(0, size.y * 0.35, 0);
  } else {
    const right = new THREE.Vector3().crossVectors(up, dir).normalize();
    const upv = new THREE.Vector3().crossVectors(dir, right).normalize();
    const tanV = Math.tan((camera.fov * Math.PI) / 360), tanH = tanV * camera.aspect;
    const fill = Number(P.fill ?? 0.94);
    for (let i = 0; i < 8; i++) {
      const corner = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(c);
      const depth = corner.dot(dir), x = Math.abs(corner.dot(right)), y = Math.abs(corner.dot(upv));
      dist = Math.max(dist, depth + x / (tanH * fill), depth + y / (tanV * fill));
    }
    if (P.dist) dist = Number(P.dist);
    camera.position.copy(c).addScaledVector(dir, dist);
    camera.up.copy(up);
    camera.lookAt(c);
  }
  human.visible = P.human === '1' || preset === 'game';
  human.position.set(Math.max(size.x, size.z) * 0.5 + 1.2, 0, Math.max(size.x, size.z) * 0.35);
  if (preset === 'game') human.position.set(2.2, 0, 1);
  // sun: fixed world azimuth so A/B renders match
  const saz = (Number(P.sun ?? 35) * Math.PI) / 180;
  const R = Math.max(size.x, size.y, size.z, 4);
  sun.position.set(center.x + Math.sin(saz) * R * 1.2, R * 1.5, center.z + Math.cos(saz) * R * 1.2);
  sun.target.position.copy(new THREE.Vector3(center.x, 0, center.z));
  const sh = R * 1.35;
  sun.shadow.camera.left = -sh; sun.shadow.camera.right = sh; sun.shadow.camera.top = sh; sun.shadow.camera.bottom = -sh;
  sun.shadow.camera.far = R * 6;
  sun.shadow.camera.updateProjectionMatrix();
  fillL.position.set(center.x - 6, R, center.z - 8);
  ground.position.set(center.x, 0, center.z);
  grid.position.set(Math.round(center.x), 0.003, Math.round(center.z));
  camera.far = Math.max(600, dist * 8);
  camera.updateProjectionMatrix();
}

function render(): void {
  frame();
  renderer.render(scene, camera);
}

async function main(): Promise<void> {
  await load(P.src ?? '/tmp/stone_lantern.glb');
  window.__render = render;
  window.__set = (o) => { Object.assign(P, o); render(); };
  render();
  window.__ready = true;
}

main().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f66;position:absolute;top:8px;left:8px">${String(e)}</pre>`);
});
window.addEventListener('resize', render);
