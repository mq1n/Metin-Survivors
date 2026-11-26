import { CODE_ALPHABET } from '@ms/shared';

const enc = new TextEncoder();

export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

export function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** `bytes` random bytes as base64url (12 → 16 chars, 24 → 32 chars). */
export function randomToken(bytes: number): string {
  return toBase64Url(randomBytes(bytes));
}

function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

export async function sha256Hex(text: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text))));
}

/** Imported HMAC keys per secret (the secret only changes with a redeploy, which starts fresh isolates). */
const hmacKeys = new Map<string, Promise<CryptoKey>>();

export async function hmacSha256Hex(secret: string, text: string): Promise<string> {
  let key = hmacKeys.get(secret);
  if (!key) {
    key = crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    hmacKeys.set(secret, key);
  }
  return toHex(new Uint8Array(await crypto.subtle.sign('HMAC', await key, enc.encode(text))));
}

/**
 * Length-checked, branch-free comparison of two equal-length strings. The length is public (all inputs are
 * fixed-width hex digests), the content comparison never exits early.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Uniform random code over {@link CODE_ALPHABET} (rejection sampling, no modulo bias). */
export function randomCode(length: number): string {
  const n = CODE_ALPHABET.length;
  const limit = 256 - (256 % n);
  let out = '';
  while (out.length < length) {
    for (const b of randomBytes(length * 2)) {
      if (b < limit && out.length < length) out += CODE_ALPHABET[b % n];
    }
  }
  return out;
}

export function randomInt(maxExclusive: number): number {
  const limit = 0x1_0000_0000 - (0x1_0000_0000 % maxExclusive);
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf);
  while ((buf[0] as number) >= limit);
  return (buf[0] as number) % maxExclusive;
}
