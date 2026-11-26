// Errors + integrity helpers shared by migrations, persistence and .msav import.

export type SaveErrorCode =
  /** not JSON / not an object / wrong container */
  | 'format'
  /** checksum mismatch (corrupted or hand-edited) */
  | 'checksum'
  /** produced by a newer game version than this build understands */
  | 'tooNew'
  /** no migration path from the stored version */
  | 'noMigration'
  /** file larger than the import cap */
  | 'tooLarge';

export class SaveError extends Error {
  readonly code: SaveErrorCode;
  constructor(code: SaveErrorCode, message: string) {
    super(message);
    this.name = 'SaveError';
    this.code = code;
  }
}

/** cyrb53: fast 53-bit non-cryptographic hash. Detects corruption/truncation, not tampering. */
export function checksum(text: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}
