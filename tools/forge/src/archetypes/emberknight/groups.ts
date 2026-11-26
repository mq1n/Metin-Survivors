// Mesh groups shared by the ember family (see build.ts): thin props that the single decimation pass would shred get their own voxel + budget.
import type { MeshGroup } from './build.ts';

/** the baked sword (everything added by addFlameSword is named sw_*) */
export const SWORD_GROUP: MeshGroup = { match: /^sw_/, voxel: 0.0045, tris: 800 };
/** helm horns / crest blades / crown prongs */
export const HEAD_GROUP: MeshGroup = { match: /^(helm|crown)_(horn|flame|prong|gem)/, voxel: 0.005, tris: 450 };
/** body spikes from the ember kit (shoulder crags, knee / elbow spikes, shin fins, heel spurs, toe claws) */
export const SPIKE_GROUP: MeshGroup = { match: /^(crag|dorsal|elbowSpike|forearmFin|kneeSpike|shinFin|heelSpur|toeClaw|backpiece_spike|greaves_copSpike)/, voxel: 0.0055, tris: 450 };
