// Little-endian byte writer/reader for the co-op wire format. The writer reuses one growable buffer (snapshots are
// built at 15–20 Hz; no per-snapshot allocation except the final frame copy). The reader never reads out of range:
// every overrun throws a `DecodeError`, so a corrupt or hostile frame cannot hang or crash the receiver.

export class DecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecodeError';
  }
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export class ByteWriter {
  private buf: Uint8Array;
  private dv: DataView;
  /** bytes written so far */
  pos = 0;

  constructor(capacity = 16 * 1024) {
    this.buf = new Uint8Array(capacity);
    this.dv = new DataView(this.buf.buffer);
  }

  reset(): void {
    this.pos = 0;
  }

  private ensure(n: number): void {
    const need = this.pos + n;
    if (need <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < need) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.pos));
    this.buf = next;
    this.dv = new DataView(next.buffer);
  }

  u8(v: number): void {
    this.ensure(1);
    this.buf[this.pos++] = v & 0xff;
  }
  i8(v: number): void {
    this.ensure(1);
    this.dv.setInt8(this.pos++, v);
  }
  u16(v: number): void {
    this.ensure(2);
    this.dv.setUint16(this.pos, v & 0xffff, true);
    this.pos += 2;
  }
  i16(v: number): void {
    this.ensure(2);
    this.dv.setInt16(this.pos, v, true);
    this.pos += 2;
  }
  u32(v: number): void {
    this.ensure(4);
    this.dv.setUint32(this.pos, v >>> 0, true);
    this.pos += 4;
  }
  f32(v: number): void {
    this.ensure(4);
    this.dv.setFloat32(this.pos, v, true);
    this.pos += 4;
  }
  /** unsigned LEB128 (non-negative integers < 2^53) */
  varuint(v: number): void {
    this.ensure(8);
    let n = !Number.isFinite(v) || v < 0 ? 0 : Math.floor(v);
    while (n >= 0x80) {
      this.buf[this.pos++] = (n % 0x80) | 0x80;
      n = Math.floor(n / 0x80);
    }
    this.buf[this.pos++] = n;
  }
  /** length-prefixed UTF-8 */
  str(s: string): void {
    const max = s.length * 3;
    this.ensure(max + 5);
    const lenPos = this.pos;
    // reserve up to 3 bytes for the length (strings here are tiny; > 16383 bytes are rejected)
    this.pos += 2;
    const { written } = textEncoder.encodeInto(s, this.buf.subarray(this.pos));
    if (written > 0x7fff) throw new RangeError('string too long for the wire');
    this.dv.setUint16(lenPos, written, true);
    this.pos += written;
  }
  bytes(b: Uint8Array): void {
    this.ensure(b.length);
    this.buf.set(b, this.pos);
    this.pos += b.length;
  }
  /** overwrite a u16 / u32 written earlier (section length back-patching) */
  patchU16(at: number, v: number): void {
    this.dv.setUint16(at, v & 0xffff, true);
  }
  patchU32(at: number, v: number): void {
    this.dv.setUint32(at, v >>> 0, true);
  }
  /** shrink back to `pos` (discard a speculative record) */
  truncate(pos: number): void {
    if (pos < this.pos) this.pos = pos;
  }
  /** a view of the written bytes (valid until the next write/reset) */
  view(): Uint8Array {
    return this.buf.subarray(0, this.pos);
  }
  /** an independent copy of the written bytes */
  copy(): Uint8Array {
    return this.buf.slice(0, this.pos);
  }
}

export class ByteReader {
  private readonly dv: DataView;
  pos = 0;
  readonly end: number;

  constructor(readonly buf: Uint8Array, start = 0, end = buf.length) {
    this.dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    this.pos = start;
    this.end = Math.min(end, buf.length);
  }

  get remaining(): number {
    return this.end - this.pos;
  }

  private need(n: number): void {
    if (this.pos + n > this.end) throw new DecodeError(`read past end (${this.pos}+${n} > ${this.end})`);
  }

  u8(): number {
    this.need(1);
    return this.buf[this.pos++] as number;
  }
  i8(): number {
    this.need(1);
    return this.dv.getInt8(this.pos++);
  }
  u16(): number {
    this.need(2);
    const v = this.dv.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }
  i16(): number {
    this.need(2);
    const v = this.dv.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }
  u32(): number {
    this.need(4);
    const v = this.dv.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  f32(): number {
    this.need(4);
    const v = this.dv.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }
  varuint(): number {
    let result = 0;
    let mul = 1;
    for (let i = 0; i < 8; i++) {
      const b = this.u8();
      result += (b & 0x7f) * mul;
      if ((b & 0x80) === 0) return result;
      mul *= 0x80;
    }
    throw new DecodeError('varuint too long');
  }
  str(): string {
    const len = this.u16();
    this.need(len);
    const s = textDecoder.decode(this.buf.subarray(this.pos, this.pos + len));
    this.pos += len;
    return s;
  }
  skip(n: number): void {
    this.need(n);
    this.pos += n;
  }
}
