
//
// Output is deterministic and diff-friendly: two-space indent, bare identifier keys, single-quoted strings, number arrays on one
// line, objects inline while they are short, colour curves with hex colours (`color: [0, 0x67b6ff, 0.78, 1, 0x67b6ff, 0]`).
// `undefined` values are written out (a grade band uses them to remove an inherited field).

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

const WIDTH = 118;
const IDENT = /^[A-Za-z_$][\w$]*$/;

export function quote(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r')}'`;
}

function num(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`tsLiteral: non-finite number ${n}`);
  return Object.is(n, -0) ? '0' : String(n);
}

const hex = (n: number): string => `0x${Math.round(n).toString(16).padStart(6, '0')}`;

/** `[t, 0xRRGGBB, alpha, …]` colour curve: key `color` and a number array of whole triples */
function isColorCurve(key: string | undefined, v: readonly unknown[]): boolean {
  return key === 'color' && v.length >= 3 && v.length % 3 === 0 && v.every((x) => typeof x === 'number');
}

const keyText = (k: string): string => (IDENT.test(k) ? k : quote(k));

/** one-line text of a value, or null when it has no sensible single-line form */
function inline(v: unknown, key?: string): string | null {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  if (typeof v === 'number') return num(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return quote(v);
  if (Array.isArray(v)) {
    if (isColorCurve(key, v)) return `[${v.map((x, i) => (i % 3 === 1 ? hex(x as number) : num(x as number))).join(', ')}]`;
    const parts: string[] = [];
    for (const x of v) {
      const s = inline(x);
      if (s === null) return null;
      parts.push(s);
    }
    return `[${parts.join(', ')}]`;
  }
  if (isObj(v)) {
    const keys = Object.keys(v);
    if (keys.length === 0) return '{}';
    const parts: string[] = [];
    for (const k of keys) {
      const s = inline(v[k], k);
      if (s === null) return null;
      parts.push(`${keyText(k)}: ${s}`);
    }
    return `{ ${parts.join(', ')} }`;
  }
  throw new Error(`tsLiteral: cannot write ${typeof v}`);
}

/** TypeScript source of `v`, nested lines indented from `indent` spaces (the first line carries no indent) */
export function tsLiteral(v: unknown, indent = 0, key?: string): string {
  const pad = ' '.repeat(indent);
  const one = inline(v, key);
  const keyLen = key === undefined ? 0 : key.length + 2;
  const flat = (a: unknown): boolean => !Array.isArray(a) && !isObj(a);
  if (one !== null && (indent + keyLen + one.length <= WIDTH || flat(v) || (Array.isArray(v) && v.every((x) => typeof x === 'number') && v.length <= LONG_ARRAY))) return one;
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    if (v.every((x) => typeof x === 'number')) return wrapNumbers(v as number[], indent, key);
    return `[\n${v.map((x) => `${pad}  ${tsLiteral(x, indent + 2)},`).join('\n')}\n${pad}]`;
  }
  if (isObj(v)) {
    const keys = Object.keys(v);
    return `{\n${keys.map((k) => `${pad}  ${keyText(k)}: ${tsLiteral(v[k], indent + 2, k)},`).join('\n')}\n${pad}}`;
  }
  return one ?? '';
}

/** number arrays stay on one line up to this many numbers (curves read best flat); longer ones wrap */
const LONG_ARRAY = 40;

function wrapNumbers(v: readonly number[], indent: number, key?: string): string {
  const pad = ' '.repeat(indent);
  const color = isColorCurve(key, v);
  const toks = v.map((x, i) => (color && i % 3 === 1 ? hex(x) : num(x)));
  const lines: string[] = [];
  let cur = '';
  const step = color ? 3 : 2; // keep (t, v) pairs / colour triples together
  for (let i = 0; i < toks.length; i += step) {
    const group = toks.slice(i, i + step).join(', ');
    if (cur !== '' && indent + 2 + cur.length + group.length + 2 > WIDTH) {
      lines.push(cur);
      cur = '';
    }
    cur += `${cur === '' ? '' : ' '}${group},`;
  }
  if (cur !== '') lines.push(cur);
  return `[\n${lines.map((l) => `${pad}  ${l}`).join('\n')}\n${pad}]`;
}

/** evaluate source produced by tsLiteral / the converter (object literals, numbers, strings, arrays, comments); trusted input */
export function evalLiteral<T = unknown>(src: string): T {
  return new Function(`return (${src}\n);`)() as T;
}

/** the converter's stdout (`{ id: 'sk.x', … },` object literals, `//` comments) → the specs */
export function parseConverterOutput<T = unknown>(text: string): T[] {
  return new Function(`return [${text}\n];`)() as T[];
}
