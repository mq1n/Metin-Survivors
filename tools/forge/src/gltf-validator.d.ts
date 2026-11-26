// the Khronos validator ships no types: only what scripts/propTex.ts and scripts/weapons/validate.ts call
declare module 'gltf-validator' {
  interface Report {
    issues: { numErrors: number; numWarnings: number; numInfos: number; messages: Array<{ severity: number; code: string; pointer?: string; message: string }> };
  }
  const validator: { validateBytes(bytes: Uint8Array, options?: { uri?: string; ignoredIssues?: string[]; maxIssues?: number }): Promise<Report> };
  export default validator;
}
