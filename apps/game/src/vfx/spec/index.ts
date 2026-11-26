// Spec runtime public surface (authoring types, preset factory, host, art atlas, body sockets).
export type * from './types';
export { BEHAVIOR_CONTRACTS, SPEC_REGISTRY, specPreset, type BehaviorContract } from './preset';
export { ROLES, ROLE_NAMES, type TexRole } from './roles';
export { SpecHost, gradeOf, gradeElement, type SpecMeta, type SpecStats } from './host';
export { ART_CELL_PX, ART_RUN_BUDGET_MB, SpecArt, artFootprint, packArt, packArtRole, type ArtSource } from './art';
export { ART_SHEETS, ART_SHEET_PLAY, ART_SHEET_POOLS, type ArtSheetName } from './artSheets';
export { artKey, isDevSpec, runSpecIds, type ScopeLoadout, type ScopeSkill } from './artScope';
export { SOCKET_ID, SOCKET_NAMES, STAND_IN, STAND_IN_SWING, standInSockets } from './sockets';
