// Run-event visuals (EV-03b): the shrine, its channel ring, the champion ring and the rain marker. NOT one of the `COMMON_TARGETS` (vfx/common/index.ts): these
// presets are drawn by a route that needs the event STATE (persistent handles keyed by the event id, a ring that rides the champion), which the adapter's
// stateless per-event routes cannot hold, so vfx/system.ts owns a `RunEventVfx`, feeds it every sim event and registers `EVENT_PRESETS` in its own table.
// `specPreset` registers the specs in SPEC_REGISTRY (the art scope reads it: a run packs the sprites of these presets only when its zone lists the kinds,
// vfx/spec/artScope.ts EVENT_SPEC_KINDS). The ids stay out of the global PRESETS array (and so out of the README id table): they are not content ids.
import type { PresetDef } from '../../presets/types';
import type { FxSpec } from '../../spec/types';
import { specPreset } from '../../spec/preset';
import { specs } from './presets';

export { EVENT_ART_IDS } from './art';
export { CHAMPION_BASE, EVENT_PRESET_IDS, RAIN_MARK_BASE, RAIN_MARK_LIFE, SHRINE_BASE, SHRINE_SEGMENTS } from './ids';
export { CHANNEL_STALE, LIVENESS_EVERY, RAIN_MARK_WINDOW, RunEventVfx, setRunEventSource, type EventVfxHost, type RunEventSource } from './route';

/** the FxSpecs of the run-event visuals */
export const EVENT_SPECS: readonly FxSpec[] = specs;
/** their presets (registered in SPEC_REGISTRY by `specPreset` at import; VfxSystem adds them to its own table) */
export const EVENT_PRESETS: readonly PresetDef[] = specs.map(specPreset);
