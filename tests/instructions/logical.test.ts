import { describe, expect, it } from 'vitest';
import { execute } from '../helpers';

describe('logical: and/or/xor/nor', () => {
  it('and of positive masks bits', () => {
    // 0xF0F0 (61680) & 0xFF00 (65280) = 0xF000 (61440)
    const c = execute('li $t0, 61680\nli $t1, 65280\nand $t2, $t0, $t1');
    expect(c.registers[10]).toBe(61440);
  });
  it('or merges bits', () => {
    // 0xF000 | 0x00FF = 0xF0FF (61695)
    const c = execute('li $t0, 61440\nli $t1, 255\nor $t2, $t0, $t1');
    expect(c.registers[10]).toBe(61695);
  });
  it('xor flips differing bits', () => {
    const c = execute('li $t0, 0b1100\nli $t1, 0b1010\nxor $t2, $t0, $t1');
    expect(c.registers[10]).toBe(0b0110);
  });
  it('nor equals bitwise not of or; nor with $zero is not', () => {
    const c = execute('li $t0, 255\nnor $t1, $t0, $zero');
    expect(c.registers[9]).toBe(-256); // ~(255 | 0)
  });
  it('nor with both operands', () => {
    const c = execute('li $t0, 0xF0F0\nli $t1, 0x0FF0\nnor $t2, $t0, $t1');
    // ~(0xFFF0) = 0xFFFF000F as int32 = -65521
    expect(c.registers[10]).toBe(-65521);
  });
});

describe('logical: andi/ori/xori (zero-extended immediates)', () => {
  it('andi keeps low 16 bits of register', () => {
    const c = execute('li $t0, -1\nandi $t1, $t0, 0xffff');
    expect(c.registers[9]).toBe(65535);
  });
  it('ori with 0xffff builds 65535 over zero', () => {
    expect(execute('ori $t1, $zero, 0xffff').registers[9]).toBe(65535);
  });
  it('andi does NOT sign-extend the immediate', () => {
    // -1 as imm16 bits = 0xFFFF → zero-extended 65535; 0x1234 & 0xFFFF = 0x1234
    const c = execute('li $t0, 4660\nandi $t1, $t0, -1');
    expect(c.registers[9]).toBe(4660);
  });
  it('xori flips low 16 bits only', () => {
    const c = execute('li $t0, 0\nxori $t1, $t0, 0xffff');
    expect(c.registers[9]).toBe(65535);
    const d = execute('li $t0, -1\nxori $t1, $t0, 0xffff');
    expect(d.registers[9]).toBe(-65536); // 0xFFFF0000
  });
  it('rejects immediates beyond 16-bit field', () => {
    expect(() => execute('ori $t0, $t1, 70000')).toThrow(/immediate out of range/i);
    expect(() => execute('andi $t0, $t1, -32769')).toThrow(/immediate out of range/i);
  });
});

describe('logical: lui', () => {
  it('lui loads immediate into high half', () => {
    const c = execute('lui $t0, 0x1234');
    expect(c.registers[8]).toBe(0x12340000);
    expect(c.registers[8]).toBe(305397760);
  });
  it('lui + ori builds arbitrary constants (0xdeadbeef)', () => {
    const c = execute('lui $t0, 0xdead\nori $t0, $t0, 0xbeef');
    expect(c.registers[8] >>> 0).toBe(0xdeadbeef);
  });
  it('lui zero immediate clears register', () => {
    expect(execute('lui $t0, 0').registers[8]).toBe(0);
  });
});
