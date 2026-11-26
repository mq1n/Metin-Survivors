// Ids and authored sizes of the run-event presets (EV-03b): the one place both the specs (./presets.ts) and the route (./route.ts) read, so the
// route never imports the art. vfx/spec/artScope.ts EVENT_SPEC_KINDS lists the same ids per event kind (a test pins the two together).

/** preset ids of the run-event visuals */
export const EVENT_PRESET_IDS = {
  shrine: 'ev.shrine',
  shrinePillar: 'ev.shrinePillar',
  shrineChannel: 'ev.shrineChannel',
  shrineClaim: 'ev.shrineClaim',
  champion: 'ev.champion',
  rainMark: 'ev.rainMark',
} as const;

/** the radius (m) the shrine specs are authored for = runEvents.json kinds.bargain.radius: `scale` = the real radius (k = scale / base) */
export const SHRINE_BASE = 2.5;
/** the ring of the champion (m) the spec is authored for; spawn with scale = CHAMPION_BASE for k = 1 */
export const CHAMPION_BASE = 2.4;
/** the radius (m) of the rain stone's crisp ring, authored for: OUTSIDE the stone's ~3.9 m warning circle */
export const RAIN_MARK_BASE = 4.6;
/** the channel ring is made of this many segments (a segment is 360 / N deg, 4 deg of it is the gap) */
export const SHRINE_SEGMENTS = 8;
/** seconds of the rain mark (the stone's warning is 2.6 s) */
export const RAIN_MARK_LIFE = 2.7;
