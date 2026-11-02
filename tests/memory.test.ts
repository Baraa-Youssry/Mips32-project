import { describe, expect, it } from 'vitest';
import { Memory } from '../src/core/memory';

describe('Memory: byte-addressed little-endian access', () => {
  it('storeWord/loadWord round-trips as int32', () => {
    const m = new Memory();
    m.storeWord(0x1000, 0xdeadbeef | 0);
    expect(m.loadWord(0x1000)).toBe(-559038737);
    expect(m.loadWord(0x1000) >>> 0).toBe(0xdeadbeef);
  });
  it('word bytes are little-endian', () => {
    const m = new Memory();
    m.storeWord(0x1000, 0xdeadbeef | 0);
    expect(m.loadByte(0x1000)).toBe(0xef);
    expect(m.loadByte(0x1001)).toBe(0xbe);
    expect(m.loadByte(0x1002)).toBe(0xad);
    expect(m.loadByte(0x1003)).toBe(0xde);
  });
  it('halfword is little-endian, raw unsigned bits', () => {
    const m = new Memory();
    m.storeHalf(0x1004, 0x8000);
    expect(m.loadHalf(0x1004)).toBe(0x8000);
    expect(m.loadByte(0x1004)).toBe(0x00);
    expect(m.loadByte(0x1005)).toBe(0x80);
  });
  it('storeByte masks to low 8 bits', () => {
    const m = new Memory();
    m.storeByte(0x1006, 0x1ff);
    expect(m.loadByte(0x1006)).toBe(0xff);
  });
  it('unwritten memory reads as zero (including distant regions)', () => {
    const m = new Memory();
    expect(m.loadByte(0x10010000)).toBe(0);
    expect(m.loadWord(0x7ffffff8)).toBe(0);
    expect(m.loadByte(0x80000000)).toBe(0);
  });
  it('sparsely written far addresses do not disturb other regions', () => {
    const m = new Memory();
    m.storeByte(0x7ffffff0, 0x41);
    expect(m.loadByte(0x7ffffff0)).toBe(0x41);
    expect(m.loadByte(0x10010000)).toBe(0);
    expect(m.loadWord(0x7ffffff0)).toBe(0x41);
  });
});

describe('Memory: alignment and boundary validation', () => {
  it('rejects unaligned word reads and writes', () => {
    const m = new Memory();
    expect(() => m.loadWord(0x1001)).toThrow(/Unaligned word access/);
    expect(() => m.loadWord(0x1002)).toThrow(/Unaligned word access/);
    expect(() => m.storeWord(0x1003, 1)).toThrow(/Unaligned word access/);
  });
  it('rejects unaligned halfword reads and writes', () => {
    const m = new Memory();
    expect(() => m.loadHalf(0x1001)).toThrow(/Unaligned halfword access/);
    expect(() => m.storeHalf(0x1005, 1)).toThrow(/Unaligned halfword access/);
  });
  it('rejects word access crossing the 32-bit address space', () => {
    const m = new Memory();
    expect(() => m.loadWord(0xfffffffe)).toThrow(/Unaligned word access/);
    expect(() => m.storeWord(0xfffffffd, 1)).toThrow(/Unaligned word access/);
  });
  it('allows the highest aligned word address', () => {
    const m = new Memory();
    m.storeWord(0xfffffffc, -1);
    expect(m.loadWord(0xfffffffc)).toBe(-1);
  });
  it('normalizes signed int32 addresses to unsigned', () => {
    const m = new Memory();
    m.storeWord(-8, 42); // 0xFFFFFFF8
    expect(m.loadWord(0xfffffff8)).toBe(42);
  });
});

describe('Memory: viewer entries and reset', () => {
  it('entries is empty for fresh memory', () => {
    expect(new Memory().entries()).toEqual([]);
  });
  it('entries returns sorted [wordAddress, value] rows', () => {
    const m = new Memory();
    m.storeWord(0x1004, 2);
    m.storeWord(0x1000, 1);
    expect(m.entries()).toEqual([[0x1000, 1], [0x1004, 2]]);
  });
  it('byte/half writes dirty their containing word', () => {
    const m = new Memory();
    m.storeByte(0x1006, 9); // third byte of the word at 0x1004
    m.storeHalf(0x2002, 0x1234); // upper half of the word at 0x2000
    expect(m.entries()).toEqual([[0x1004, 9 << 16], [0x2000, 0x1234 << 16]]);
  });
  it('clear empties pages and entries', () => {
    const m = new Memory();
    m.storeWord(0x1000, 1);
    m.clear();
    expect(m.entries()).toEqual([]);
    expect(m.loadWord(0x1000)).toBe(0);
  });
});
