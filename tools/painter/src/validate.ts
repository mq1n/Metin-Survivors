// gltf-validator wrapper: `bun tools/painter/src/cli.ts validate <glb...>`
import { readFileSync } from 'node:fs';
import { validateBytes } from 'gltf-validator';

export interface ValidationSummary {
  file: string;
  errors: number;
  warnings: number;
  infos: number;
  messages: string[];
}

export async function validateGlb(file: string): Promise<ValidationSummary> {
  const bytes = new Uint8Array(readFileSync(file));
  const rep = await validateBytes(bytes, { uri: file, maxIssues: 50, ignoredIssues: [] });
  const { numErrors, numWarnings, numInfos } = rep.issues;
  const messages = rep.issues.messages.filter((m) => m.severity <= 1).map((m) => `${m.code}: ${m.message} ${m.pointer ?? ''}`.trim());
  return { file, errors: numErrors, warnings: numWarnings, infos: numInfos, messages };
}
