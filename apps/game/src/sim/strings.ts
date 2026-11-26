// String interner: SoA stores keep a Uint16 id for vfx/style names; render resolves ids through `names`.

export class Interner {
  /** id → string. Id 0 is always the empty string. */
  readonly names: string[] = [''];
  private readonly ids = new Map<string, number>([['', 0]]);

  id(name: string): number {
    let i = this.ids.get(name);
    if (i === undefined) {
      i = this.names.length;
      this.names.push(name);
      this.ids.set(name, i);
    }
    return i;
  }

  name(id: number): string {
    return this.names[id] ?? '';
  }
}
