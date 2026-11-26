// Gallery scenario registry (core-owned, dev only): every ui/dev/scenarios/*.ts module, collected eagerly.
//
// gallery.ts imports this module AFTER ./index, so the scenario modules (which import screens and modals) evaluate after
// the UI and its stylesheets: the CSS cascade order cannot change, and in a production build the scenarios stay inside
// the gallery chunk (a lazy glob would turn every screen they touch into a shared chunk with its own CSS file).
import type { Scenario, ScenarioModule } from './scenarioKit';

const modules = import.meta.glob<ScenarioModule>('./scenarios/*.ts', { eager: true });

/** Scenarios in picker order: by module `order` (default 500), then file name; duplicate ids are reported and skipped. */
export function collectScenarios(): Scenario[] {
  const mods = Object.entries(modules).sort(([pa, a], [pb, b]) => (a.order ?? 500) - (b.order ?? 500) || pa.localeCompare(pb));
  const out: Scenario[] = [];
  const seen = new Map<string, string>();
  for (const [path, mod] of mods) {
    for (const s of mod.scenarios ?? []) {
      const prev = seen.get(s.id);
      if (prev !== undefined) {
        console.error(`[gallery] duplicate scenario id "${s.id}" in ${path} (already defined in ${prev}); skipped`);
        continue;
      }
      seen.set(s.id, path);
      out.push(s);
    }
  }
  return out;
}
