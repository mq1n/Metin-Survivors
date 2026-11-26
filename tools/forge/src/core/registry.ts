import type { ModelData, ModelKind } from './model.ts';

/** CLI overrides applied to every model build */
export interface BuildOpts {
  /** override the baked texture size (px); 0 disables the texture */
  texture?: number;
}

/** A buildable model. One file per model/archetype registers entries; the CLI builds them by id. */
export interface ModelEntry {
  id: string;
  kind: ModelKind;
  /** produce the model data (geometry + skin + clips). Must be deterministic. */
  build(log: (s: string) => void, opts?: BuildOpts): Promise<ModelData>;
}
