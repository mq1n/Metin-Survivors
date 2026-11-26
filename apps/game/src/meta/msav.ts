// `.msav` export/import: a text container `MSAV1.<saveVersion>.<checksum>.<base64(JSON)>`.
// The checksum covers the exact JSON text (corruption / truncation / copy-paste damage detection, not anti-cheat).
// Import = parse → verify → migrate → normalizeSave, so a hand-edited or older file can never produce an invalid profile.

import { SaveError, checksum } from './errors';
import { migrateSave } from './migrations';
import { normalizeSave, type NormalizeOptions } from './save';
import type { MetaContent, SaveData } from './types';

export const MSAV_MAGIC = 'MSAV1';
/** Import cap: a real save is tens of KB; refuse absurd files before decoding. */
export const MSAV_MAX_CHARS = 2_000_000;

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

function fromBase64(b64: string): string {
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    throw new SaveError('format', 'payload is not base64');
  }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new SaveError('format', 'payload is not UTF-8');
  }
}

export function exportMsav(save: SaveData): string {
  const json = JSON.stringify(save);
  return `${MSAV_MAGIC}.${save.version}.${checksum(json)}.${toBase64(json)}`;
}

export interface ImportResult {
  save: SaveData;
  /** version stored in the file (before migration) */
  fromVersion: number;
  repairs: string[];
}

/** Throws SaveError: 'format' | 'checksum' | 'tooNew' | 'noMigration' | 'tooLarge'. */
export function importMsav(text: string, content: MetaContent, opts: NormalizeOptions = {}): ImportResult {
  const trimmed = text.trim();
  if (trimmed.length > MSAV_MAX_CHARS) throw new SaveError('tooLarge', 'file too large');
  const first = trimmed.indexOf('.');
  const second = trimmed.indexOf('.', first + 1);
  const third = trimmed.indexOf('.', second + 1);
  if (first < 0 || second < 0 || third < 0 || trimmed.slice(0, first) !== MSAV_MAGIC) {
    throw new SaveError('format', 'not a .msav file');
  }
  const version = Number(trimmed.slice(first + 1, second));
  if (!Number.isInteger(version) || version < 0) throw new SaveError('format', 'bad version header');
  const sum = trimmed.slice(second + 1, third);
  const json = fromBase64(trimmed.slice(third + 1));
  if (checksum(json) !== sum) throw new SaveError('checksum', 'checksum mismatch: the file is damaged');
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new SaveError('format', 'payload is not JSON');
  }
  const migrated = migrateSave(data);
  const repairs: string[] = [];
  const save = normalizeSave(migrated, content, { ...opts, repairs });
  return { save, fromVersion: version, repairs };
}

export function msavFileName(save: SaveData, now: number = Date.now()): string {
  const d = new Date(now);
  const pad = (n: number): string => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const name = save.profile.name.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'profile';
  return `metin-survivors-${name}-${stamp}.msav`;
}

/** Browser: triggers a download of the export. */
export function downloadMsav(save: SaveData, now: number = Date.now()): void {
  const blob = new Blob([exportMsav(save)], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = msavFileName(save, now);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Browser: reads a user-picked file (guards the size before reading it into memory). */
export async function readMsavFile(file: File): Promise<string> {
  if (file.size > MSAV_MAX_CHARS) throw new SaveError('tooLarge', 'file too large');
  return file.text();
}
