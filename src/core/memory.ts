import { diagError } from '../diagnostics/errors';

const PAGE_BITS = 12;
const PAGE_SIZE = 1 << PAGE_BITS;
const PAGE_MASK = PAGE_SIZE - 1;

/**
 * Sparse byte-addressed little-endian memory (32-bit addresses).
 * Pages allocate lazily so distant regions (data @ 0x10010000, stack @ 0x7FFF...)
 * coexist without reserving 4 GB. Half/word accesses are alignment-checked;
 * invalid half/word addresses throw instead of corrupting state.
 */
export class Memory {
  private pages = new Map<number, Uint8Array>();
  private dirty = new Set<number>(); // word addresses ever written (for the viewer)

  private checkAlignment(address: number, alignment: number): number {
    const a = address >>> 0;
    if ((a & (alignment - 1)) !== 0) {
      const kind = alignment === 4 ? 'word' : 'halfword';
      throw diagError(alignment === 4 ? 'MEM001' : 'MEM002', `Unaligned ${kind} access at 0x${a.toString(16)}`);
    }
    return a;
  }

  loadByte(address: number): number {
    const a = address >>> 0;
    const page = this.pages.get(a >>> PAGE_BITS);
    return page ? page[a & PAGE_MASK] : 0;
  }

  storeByte(address: number, value: number): void {
    const a = address >>> 0;
    const index = a >>> PAGE_BITS;
    let page = this.pages.get(index);
    if (!page) { page = new Uint8Array(PAGE_SIZE); this.pages.set(index, page); }
    page[a & PAGE_MASK] = value & 0xff;
    this.dirty.add(a & ~3);
  }

  /** Raw unsigned 16 bits; caller decides sign/zero extension. */
  loadHalf(address: number): number {
    const a = this.checkAlignment(address, 2);
    return this.loadByte(a) | (this.loadByte(a + 1) << 8);
  }

  storeHalf(address: number, value: number): void {
    const a = this.checkAlignment(address, 2);
    this.storeByte(a, value & 0xff);
    this.storeByte(a + 1, (value >>> 8) & 0xff);
  }

  /** Signed 32-bit word (int32 bit pattern). */
  loadWord(address: number): number {
    const a = this.checkAlignment(address, 4);
    return (
      this.loadByte(a) |
      (this.loadByte(a + 1) << 8) |
      (this.loadByte(a + 2) << 16) |
      (this.loadByte(a + 3) << 24)
    );
  }

  storeWord(address: number, value: number): void {
    const a = this.checkAlignment(address, 4);
    this.storeByte(a, value & 0xff);
    this.storeByte(a + 1, (value >>> 8) & 0xff);
    this.storeByte(a + 2, (value >>> 16) & 0xff);
    this.storeByte(a + 3, (value >>> 24) & 0xff);
    this.dirty.add(a);
  }

  /** Sorted [wordAddress, signedWordValue] rows for the memory viewer. */
  entries(): Array<[number, number]> {
    return [...this.dirty].sort((x, y) => x - y).map((a) => [a, this.loadWord(a)]);
  }

  clear(): void {
    this.pages.clear();
    this.dirty.clear();
  }
}
