// Type-check only (root `bun run typecheck:scripts`, tsconfig.scripts.json): tools/qa/zonecheck.ts imports the game's
// terrain look, whose import graph reaches modules that read Vite's `import.meta.env.BASE_URL`. The game workspace gets
// that type from `vite/client`; this program loads bun's types instead (where `env` is an index signature of
// `string | undefined`), so the Vite key that the game code relies on is declared here. Nothing at runtime.
interface ImportMetaEnv {
  readonly BASE_URL: string;
}
