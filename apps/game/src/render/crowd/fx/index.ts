// Crowd FX block host (core-owned): the snippet order is the shader order. The core-only parts (block preamble, zone
// grade, elite rim) live here; each builder owns its own snippet file next to this one.
import { CROWD_FX_CORRUPTION } from './corruption';
import { CROWD_FX_DISSOLVE_EDGE } from './dissolve';
import { CROWD_FX_HIT_FLASH } from './hitFlash';
import { CROWD_FX_STATUS } from './status';

export { CROWD_DISSOLVE } from './dissolve';

const PREAMBLE = /* glsl */ `
{
  float st = floor(vStatus + 0.5);
  vec3 viewDir = normalize(vViewPosition);
  float fres = 1.0 - clamp(dot(normal, viewDir), 0.0, 1.0);
  float rim = fres * fres * fres;
  float tier = vFx.w;
  float rank = 1.0 - step(0.5, tier);

`;

const ZONE_GRADE = /* glsl */ `  // zone grade for rank-and-file only (elites / bosses keep their full colour and stand out of the pack)
  float crowdLumG = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
  outgoingLight = mix(outgoingLight, vec3(crowdLumG), uZoneGrade.x * rank) * (1.0 - uZoneGrade.y * rank);
  outgoingLight += uZoneRim.rgb * rim * uZoneRim.a * rank;

`;

const ELITE_RIM = /* glsl */ `  // elite rim: 1 steel-blue, 2 gold, 3 boss deep gold (crimson vanished on red/lava ground)
  vec3 rimCol = tier > 2.5 ? vec3(1.0, 0.7, 0.22) : (tier > 1.5 ? vec3(1.0, 0.72, 0.18) : vec3(0.35, 0.62, 1.0));
  outgoingLight += step(0.5, tier) * rimCol * rim * 0.22;

`;

const CLOSE = /* glsl */ `}
`;

/** the whole FX block, injected before <opaque_fragment> */
export const CROWD_FX = PREAMBLE + ZONE_GRADE + CROWD_FX_STATUS + ELITE_RIM + CROWD_FX_CORRUPTION + CROWD_FX_HIT_FLASH + CROWD_FX_DISSOLVE_EDGE + CLOSE;
