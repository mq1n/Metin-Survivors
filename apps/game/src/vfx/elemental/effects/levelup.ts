// Ported from threejs-vfx src/abilities/BeamAbility.js (the Nova Beam column, stood upright) and src/effects/BurstSphere.js (MIT,
// © mohamedachrefelouafi — see ../LICENSE).
// Signature level-up: `levelup.ascend` — a golden column of light shoots up out of the hero's feet in 0.12 s and stands with coils
// winding up it and shock discs racing up its length; two pressure shells are shoved out across the floor from its base; then the
// column lifts off the floor and pinches to a thread as it rises away (gone by 0.8 s). The column is `../beamTube` (one draw call),
// the shells `../burstSphere` (one). It is kept narrow and hollow (thin core, rim-weighted sheath) so the hero standing inside it
// stays readable; the ground rune ring, shock rings, glyph sparks and sparkles are the preset's batched recipe around it.
import type { Ctx } from '../../emit';
import { mixHex, scaleHex } from '../../util';
import { BEAM_TESSELLATION, BeamTube } from '../beamTube';
import { BurstMode, BurstSphere } from '../burstSphere';
import { ElementalEffect, type EffectDef } from '../host';
import { Easing, clamp, saturate } from '../math';

const ASCEND = {
  /** metres the column stands above the feet (× √scale) */
  height: 10,
  /** seconds the leading edge needs to reach the top */
  rise: 0.12,
  /** seconds from the start until the column lets go */
  hold: 0.42,
  /** seconds it takes to lift off and pinch to a thread */
  collapse: 0.38,
  /** how far the base lifts off the floor while it collapses, × height */
  lift: 0.55,
  /** half-width at the top / at the feet, metres (× scale) */
  radius: 0.66,
  radiusNear: 0.52,
};

class LevelAscend extends ElementalEffect {
  /** draw calls: the column (core / sheath / halo / coils / discs in one mesh) and the pressure shells */
  readonly cost = 2;
  private tube!: BeamTube;
  private shells!: BurstSphere;
  private y = 0;
  private height = ASCEND.height;

  build(): void {
    const tier = this.host.tier;
    this.tube = new BeamTube(BEAM_TESSELLATION[tier], 46);
    this.root.add(this.tube.mesh);
    this.shells = new BurstSphere(BurstMode.AIR, 3, tier >= 3 ? 10 : tier === 2 ? 8 : 6, 44);
    this.root.add(this.shells.mesh);
  }

  start(c: Ctx): boolean {
    const tube = this.tube;
    const l = tube.look;
    const p = c.pal;
    const s = clamp(c.scale > 0 ? c.scale : 1, 0.6, 2);
    const I = clamp(c.intensity, 0.3, 2);
    const tier = this.host.tier;
    this.y = c.y;
    this.height = ASCEND.height * Math.sqrt(s);

    // a straight, hollow column: no landing flare, a thin core, the light carried by the sheath rim, the coils and the discs
    l.radius = ASCEND.radius * s;
    l.radiusNear = ASCEND.radiusNear * s;
    l.radiusCurve = 1;
    l.flare = 0;
    l.throb = 0.07;
    l.throbScale = 3;
    l.throbSpeed = 2.4;
    l.wander = 0;
    l.coreWidth = 0.16;
    l.coreSharp = 2;
    l.coreFill = 0.3;
    l.coreOpacity = 0.8;
    l.shellWidth = 1;
    l.shellRim = 1.1;
    l.shellFill = 0.06;
    l.shellOpacity = 0.9;
    l.haloWidth = 2.3;
    l.haloRim = 3.6;
    l.haloOpacity = 0.12;
    l.flowSpeed = 9;
    l.mouthGlow = 0.35;
    l.mouthLength = 0.06;
    l.tipGlow = 0.9;
    l.tipLength = 0.08;
    l.glow = 0.85;
    l.opacity = 0.34;
    l.coilTurns = 2.4;
    l.coilSpeed = 0.85;
    l.coilRadius = 1.55;
    l.coilFlare = 0.15;
    l.coilWidth = 0.07 * s;
    l.coilWidthTip = 1.3;
    l.coilPulse = 0.6;
    l.coilPulseFreq = 4;
    l.coilPulseSpeed = 2;
    l.coilGlow = 3.2;
    l.coilOpacity = 1.4;
    l.ringSpeed = 1.6;
    l.ringInner = 1.5;
    l.ringOuter = 1.85;
    l.ringSwell = 0.6;
    l.ringFade = 0.05;
    l.ringGlow = 2.6;
    l.ringOpacity = 0.85;
    l.laneOpacity = 0;

    // cream-white axis, gold body and coils, amber bloom: every colour from the palette so a tinted level-up recolours the column
    tube.setColors(
      p.core,
      mixHex(p.main, p.core, 0.45),
      p.main,
      scaleHex(p.edge, 0.6),
      mixHex(p.main, p.core, 0.15),
      p.edge,
      mixHex(p.main, p.core, 0.2),
    );
    tube.origin.set(c.x, c.y + 0.02, c.z);
    tube.target.set(c.x, c.y + this.height, c.z);
    tube.side.set(1, 0, 0);
    tube.seed = c.seed * 100;
    tube.coils = tier >= 3 ? 6 : tier === 2 ? 4 : 3;
    tube.rings = tier >= 3 ? 10 : tier === 2 ? 8 : 6;
    tube.gain = I;
    tube.progress = 0;
    tube.fade = 1;
    tube.widthFade = 1;
    tube.charge = 0;
    tube.sync(0);
    tube.mesh.visible = true;

    // pressure shells shoved out of the base (fresnel lenses of displaced air, amber so they never go lime over grass): a low wide
    // dome racing across the floor and a taller one right behind it
    const shells = this.shells;
    shells.clear();
    shells.setColors(p.edge, mixHex(p.main, p.core, 0.4), p.core);
    shells.begin(c.x, c.y + 0.05, c.z).radius(0.6 * s, 3.2 * s).life(0.5).int(0.9 * I).opacity(0.55).fresnel(2.2).displace(0.1).squash(0.6).emit();
    shells.begin(c.x, c.y + 0.05, c.z).radius(0.5 * s, 2.2 * s).life(0.45).delay(0.1).int(0.8 * I).opacity(0.5).fresnel(2.4).displace(0.12).squash(0.95).emit();
    return true;
  }

  step(dt: number): boolean {
    const age = this.age;
    const tube = this.tube;
    const end = ASCEND.hold + ASCEND.collapse;
    if (age < end) {
      tube.progress = Easing.outQuad(saturate(age / ASCEND.rise));
      // brightness hangs on and then goes; the width pinches early, and the base lifts off so the light leaves upward
      const q = saturate((age - ASCEND.hold) / ASCEND.collapse);
      tube.fade = 1 - Easing.inCubic(q);
      tube.widthFade = Math.max(0.04, 1 - Easing.outCubic(q) * 0.94);
      tube.origin.y = this.y + 0.02 + this.height * ASCEND.lift * Easing.inQuad(q);
      tube.target.y = this.y + this.height * (1 + 0.25 * q);
      tube.sync(0);
    } else {
      tube.mesh.visible = false;
    }
    this.shells.update(dt);
    return age < end || this.shells.busy;
  }

  override reset(): void {
    super.reset();
    this.tube.mesh.visible = false;
    this.shells.clear();
  }

  dispose(): void {
    this.tube.dispose();
    this.shells.dispose();
  }
}

export const EFFECTS: EffectDef[] = [{ kind: 'levelup.ascend', create: () => new LevelAscend(), pool: 2, minTier: 1 }];
