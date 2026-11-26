// Hero preview for the hero-select screen: its own small transparent WebGL canvas inside a UI-provided container.
// The hero idles on a slow turntable; dragging rotates it. Shares the Assets cache (models are cloned per preview).
import {
  ACESFilmicToneMapping,
  AnimationMixer,
  Box3,
  DirectionalLight,
  Group,
  HemisphereLight,
  type Object3D,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { Assets, ModelInstance } from '../engine/assets';
import type { AnimationAction, AnimationClip } from 'three';
import type { HeroSpec } from '../render/world';
import { WeaponHold } from '../render/weaponHold';
import { hasEquipJoints, placeMirrored, planHeldWeapons, weaponFrameFix, isRig1to1 } from '../render/weaponHands';
import { BowStringRig, bowAnchorsFromExtras, bowDraw, isBow, poseBowString } from '../render/bowString';
import { isMobileDevice } from '../render/quality';
import { cameraAt, framePreview, heldPoints, previewBounds, toPreviewPoints, type PointAcc, type PreviewBounds, type PreviewCamera, type PreviewPoints } from './previewFrame';
import type { RunSelection } from './store';

export interface HeroPreviewHandle {
  update(sel: Pick<RunSelection, 'classId' | 'sex' | 'doctrine' | 'empire' | 'armorTier'>): void;
  dispose(): void;
  /** a read-only look at the live preview for the QA / judge sweeps (geometry-based framing measures, never the UI); null before a model is shown */
  inspect(): HeroPreviewInspection | null;
}

/** what {@link HeroPreviewHandle.inspect} returns: the live objects (not to be modified) and the framing input of the shown model */
export interface HeroPreviewInspection {
  camera: PerspectiveCamera;
  /** the turntable group (rotation.y = the yaw); the hero root is its child */
  pivot: Group;
  hero: Object3D;
  /** the held weapon instances' roots (main first, then the mirrored off-hand instance) */
  held: readonly Object3D[];
  /** the framing input (hero height, the hero's own cylinder, the weapon points over the shown pose(s)) and the camera made from it */
  framing: { h: number; hero: PreviewBounds; pts: PreviewPoints | null; cam: PreviewCamera | null } | null;
  yaw: number;
}

export interface HeroPreviewFactory {
  mount(container: HTMLElement, sel: Pick<RunSelection, 'classId' | 'sex' | 'doctrine' | 'empire' | 'armorTier'>): HeroPreviewHandle;
}

/** where in the bow's shot clip the preview holds the pose: past the draw (25 %), before the release (the hit is at about 55 %) */
export const BOW_SHOWCASE_U = 0.4;

export function createHeroPreview(
  assets: Assets,
  resolve: (sel: Pick<RunSelection, 'classId' | 'sex' | 'doctrine' | 'empire' | 'armorTier'>) => HeroSpec,
): HeroPreviewFactory {
  return {
    mount(container, initial) {
      const mobile = isMobileDevice();
      const renderer = new WebGLRenderer({ alpha: true, antialias: !mobile, powerPreference: mobile ? 'low-power' : 'default' });
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = SRGBColorSpace;
      renderer.toneMapping = ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;cursor:grab';
      container.appendChild(renderer.domElement);

      const scene = new Scene();
      const hemi = new HemisphereLight('#cfd9ff', '#4a3a2a', 1.1);
      const key = new DirectionalLight('#fff0d6', 2.6);
      key.position.set(2.5, 4, 3.5);
      const rim = new DirectionalLight('#ffb070', 1.4);
      rim.position.set(-3, 2, -3);
      scene.add(hemi, key, rim);
      const pivot = new Group();
      scene.add(pivot);
      const camera = new PerspectiveCamera(28, 1, 0.1, 50);

      let inst: ModelInstance | null = null;
      let weapon: ModelInstance | null = null;
      /** all instantiated weapon models (main + mirrored off-hand), tracked for per-instance skeleton disposal */
      let heldInstances: ModelInstance[] = [];
      /** the held bow's string (render/bowString.ts): straight in the preview's idle */
      let bowString: BowStringRig | null = null;
      let mixer: AnimationMixer | null = null;
      
      let hold: { action: AnimationAction; time: number } | null = null;
      /** the shown pose's framing input (previewFrame.ts): hero height, the hero's own cylinder and the held weapon points over the shown pose(s) */
      let framing: { h: number; hero: PreviewBounds; pts: PreviewPoints | null } | null = null;
      /** the camera for `framing` at the current aspect (framePreview: hero first, a lateral pan that follows the turn); re-made when the aspect changes */
      let cam: PreviewCamera | null = null;
      let camAspect = 0;
      /** the held weapon instances' roots of the shown model (for {@link HeroPreviewHandle.inspect}) */
      let held: Object3D[] = [];
      const placeCamera = (): void => {
        if (!cam) return;
        const f = cameraAt(cam, yaw);
        camera.position.set(...f.pos);
        camera.lookAt(...f.look);
      };
      const applyFraming = (): void => {
        if (!framing) return;
        if (!cam || camAspect !== camera.aspect) {
          cam = framePreview(framing.h, framing.hero, framing.pts, camera.fov, camera.aspect);
          camAspect = camera.aspect;
        }
        placeCamera();
      };
      let disposed = false;
      let token = 0;
      let yaw = 0.35;
      let realDragging = false;
      let syntheticHold = false;
      let lastX = 0;
      let lastSynthX = 0;

      const disposeInstanceSkeletons = (models: readonly (ModelInstance | null)[]): void => {
        const seen = new Set<unknown>();
        for (const m of models) {
          if (!m) continue;
          for (const sm of m.skinned) {
            if (sm.skeleton && !seen.has(sm.skeleton)) {
              seen.add(sm.skeleton);
              sm.skeleton.dispose();
            }
          }
        }
      };

      const clear = (): void => {
        mixer?.stopAllAction();
        if (inst) {
          mixer?.uncacheRoot(inst.root);
          pivot.remove(inst.root);
        }
        disposeInstanceSkeletons([inst, ...heldInstances]);
        inst = null;
        weapon = null;
        heldInstances = [];
        held = [];
        framing = null;
        cam = null;
        bowString?.dispose();
        bowString = null;
        hold = null;
        mixer = null;
      };

      const load = async (sel: Parameters<HeroPreviewHandle['update']>[0]): Promise<void> => {
        const mine = ++token;
        const spec = resolve(sel);
        const wanted: { kind: 'model'; id: string; hint: 'hero' | 'weapon' }[] = [{ kind: 'model', id: spec.modelId, hint: 'hero' }];
        if (spec.weaponId) wanted.push({ kind: 'model', id: spec.weaponId, hint: 'weapon' });
        try {
          await assets.loadBatch(wanted);
        } catch (err) {
          if (!disposed) console.warn('[heroPreview] load failed', spec.modelId, err);
          return;
        }
        if (disposed || mine !== token) return;
        clear();
        const model = assets.model(spec.modelId);
        let showcase: AnimationClip | undefined;
        let drawHand: Object3D | null = null;
        const next = assets.instantiate(spec.modelId);
        for (const m of next.meshes) m.frustumCulled = false;
        // E4 (forge-audit plan): the hero's own height, taken before the weapon is attached, sets the base framing, so a weapon that fits does not
        // shrink the hero in HeroSelect / the Armory; weapon-fit fix r1: a weapon that does not fit widens it (framePreview, below)
        next.root.updateMatrixWorld(true);
        const heroSize = new Box3().setFromObject(next.root).getSize(new Vector3());
        /** the held weapon instances' roots (judge r2 MF12: the hero-only bounds skip them; their reach sets the tip allowance) */
        const heldRoots: Object3D[] = [];
        const nextWeapons: ModelInstance[] = [];
        if (spec.weaponId) {
          // the weapon type decides the hands (render/weaponHands.ts): dagger / claw in both, the bow in the left, the rest in the right;
          
          const wmodel = assets.model(spec.weaponId);
          const equipJoints = hasEquipJoints(model.extras);
          const plan = planHeldWeapons(
            wmodel.extras,
            spec.styleB === true,
            (key) => model.asset.sockets?.[key] ?? model.extras.sockets?.[key],
            next.bones,
            next.root,
            equipJoints,
          );
          for (const mount of plan.mounts) {
            const w = assets.instantiate(spec.weaponId);
            nextWeapons.push(w);
            heldRoots.push(w.root);
            if (!mount.mirrored) {
              // forge claws take the worn-claw frame (render/weaponHands.ts weaponFrameFix), before the hold table so it is part of the base
              const fix = equipJoints ? weaponFrameFix(wmodel.extras) : null;
              if (fix) w.root.quaternion.multiply(fix);
              // per-clip weapon hold (render/weaponHold.ts): the preview plays idle, so the idle entry (absent table = no change)
              // rig1to1 R2: a hero on the rebuilt rig (extras.rig 'rig1to1/..') holds every weapon rigidly, no hold table
              if (!isRig1to1(model.extras)) WeaponHold.from(wmodel.extras, w.root.quaternion.clone())?.apply([['idle', 1]], w.root.quaternion);
              weapon = w;
              // a bow carries its string (the anchors the GLB declares, weapon.string)
              const anchors = isBow(wmodel.extras) ? bowAnchorsFromExtras(wmodel.extras) : null;
              if (anchors) {
                const rig = new BowStringRig(anchors);
                bowString = rig;
                rig.attachTo(w.root);
                
                // (the idle carries the bow low across the hips, the game's wait pose, which reads as a stick lying across the body)
                if (equipJoints && mount.hand === 'l') {
                  showcase = (spec.styleB ? model.clipMap.get('attack_b') : undefined) ?? model.clipMap.get('attack');
                  drawHand = plan.rightBone;
                  const bowRoot = w.root;
                  rig.onSync = () => {
                    const dur = showcase?.duration ?? 1;
                    const hit = model.asset.hit?.[showcase?.name ?? ''] ?? model.extras.hit?.[showcase?.name ?? ''];
                    poseBowString(rig, bowRoot, drawHand, bowDraw('attack', BOW_SHOWCASE_U, dur, hit !== undefined ? hit / dur : undefined));
                  };
                }
              }
            } else if (weapon) {
              placeMirrored(w.root, weapon.root, mount.scaleK);
            }
            mount.bone.add(w.root);
          }
        }
        inst = next;
        heldInstances = nextWeapons;
        held = heldRoots;
        pivot.add(next.root);
        const idle = (spec.styleB ? model.clipMap.get('idle_b') : undefined) ?? model.clipMap.get('idle');
        // the framing (previewFrame.ts): the hero's own cylinder and the held weapon(s) as points, both in the SHOWN pose (the bow's held draw;
        // the idle sampled at eight times of its loop); the hero keeps the old hero-only framing when the weapon fits it, else the camera backs
        // off (never below half the frame for the hero) and pans with the turn so no blade, glaive or bow runs out of the frame beyond its tip
        let hero: PreviewBounds | null = null;
        const acc: PointAcc = { xyz: [], s: [] };
        const skip = new Set<Object3D>(heldRoots);
        const grow = (): void => {
          const hb = previewBounds([next.root], pivot, 4, skip);
          hero = hero ? { r: Math.max(hero.r, hb.r), y0: Math.min(hero.y0, hb.y0), y1: Math.max(hero.y1, hb.y1) } : hb;
          if (heldRoots.length) heldPoints(heldRoots, pivot, 12, acc);
        };
        if (showcase) {
          mixer = new AnimationMixer(next.root);
          const action = mixer.clipAction(showcase);
          action.play();
          hold = { action, time: showcase.duration * BOW_SHOWCASE_U };
          action.time = hold.time;
          mixer.update(0);
          grow();
        } else if (idle) {
          mixer = new AnimationMixer(next.root);
          const action = mixer.clipAction(idle);
          action.play();
          for (let k = 7; k >= 0; k--) {
            action.time = (idle.duration * k) / 8;
            mixer.update(0);
            grow();
          }
        } else {
          grow();
        }
        next.root.updateMatrixWorld(true);
        const heroB = hero as PreviewBounds | null;
        framing = { h: Math.max(heroSize.y, 1), hero: heroB && heroB.y1 > heroB.y0 ? heroB : { r: 0, y0: 0, y1: Math.max(heroSize.y, 1) }, pts: toPreviewPoints(acc) };
        cam = null;
        applyFraming();
        void weapon;
      };

      const resize = (): void => {
        const w = Math.max(1, container.clientWidth);
        const hgt = Math.max(1, container.clientHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.25 : 2));
        renderer.setSize(w, hgt, false);
        camera.aspect = w / hgt;
        camera.updateProjectionMatrix();
        applyFraming();
      };
      const ro = new ResizeObserver(resize);
      ro.observe(container);
      resize();

      const el = renderer.domElement;
      const down = (e: PointerEvent): void => {
        if (!e.isTrusted) {
          syntheticHold = true;
          lastSynthX = e.clientX;
          return;
        }
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        realDragging = true;
        lastX = e.clientX;
        el.setPointerCapture(e.pointerId);
        el.style.cursor = 'grabbing';
      };
      const move = (e: PointerEvent): void => {
        if (!e.isTrusted) {
          if (!syntheticHold) return;
          yaw += (e.clientX - lastSynthX) * 0.012;
          lastSynthX = e.clientX;
          return;
        }
        if (!realDragging) return;
        if (e.pointerType === 'mouse' && (e.buttons & 1) === 0) {
          realDragging = false;
          el.style.cursor = 'grab';
          return;
        }
        yaw += (e.clientX - lastX) * 0.012;
        lastX = e.clientX;
      };
      const up = (e: PointerEvent): void => {
        if (!e.isTrusted) {
          syntheticHold = false;
          return;
        }
        realDragging = false;
        if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
        el.style.cursor = 'grab';
      };
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);

      let last = performance.now();
      let raf = 0;
      const frame = (now: number): void => {
        if (disposed) return;
        raf = requestAnimationFrame(frame);
        const elapsed = now - last;
        if (mobile && !realDragging && !syntheticHold && elapsed < 32) return;
        const dt = Math.min(0.1, elapsed / 1000);
        last = now;
        if (!realDragging && !syntheticHold) yaw += dt * 0.35;
        pivot.rotation.y = yaw;
        if (cam && cam.fit !== 'hero') placeCamera(); // the lateral pan follows the turn (previewFrame.ts cameraAt)
        if (hold) hold.action.time = hold.time;
        mixer?.update(dt);
        renderer.render(scene, camera);
      };
      raf = requestAnimationFrame(frame);
      void load(initial);

      return {
        update(sel) {
          void load(sel);
        },
        inspect() {
          return inst ? { camera, pivot, hero: inst.root, held, framing: framing ? { ...framing, cam } : null, yaw } : null;
        },
        dispose() {
          disposed = true;
          cancelAnimationFrame(raf);
          ro.disconnect();
          el.removeEventListener('pointerdown', down);
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
          el.removeEventListener('pointercancel', up);
          clear();
          renderer.dispose();
          renderer.forceContextLoss();
          el.remove();
        },
      };
    },
  };
}
