// Build-time flags the app reads (vite/client types every other VITE_ key as `any`).
interface ImportMetaEnv {
  /** '1' only in the QA snapshot build of tools/qa/playthrough.ts: app.ts then publishes the App as window.__ms. Never set for a shipped build. */
  readonly VITE_QA_HOOKS?: string;
}
