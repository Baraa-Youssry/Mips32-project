import { describe, expect, it } from 'vitest';
import { execute } from '../helpers';

describe('arithmetic: addu/addiu/subu', () => {
  it('addu wraps like add (32-bit)', () => {
    const c = execute('li $t0, 2147483647\nli $t1, 1\naddu $t2, $t0, $t1');
    expect(c.registers[10]).toBe(-2147483648);
  });
  it('addiu adds immediate', () => {
    expect(execute('li $t0, 100\naddiu $t1, $t0, -200').registers[9]).toBe(-100);
  });
  it('subu subtracts', () => {
    expect(execute('li $t0, 3\nli $t1, 10\nsubu $t2, $t0, $t1').registers[10]).toBe(-7);
  });
  it('subu wraps below zero into unsigned range bits', () => {
    expect(execute('li $t0, 0\nli $t1, 1\nsubu $t2, $t0, $t1').registers[10]).toBe(-1);
  });
});

describe('arithmetic: mult/multu', () => {
  it('mult: negative operands produce correct signed HI/LO', () => {
    const c = execute('li $t0, -100000\nli $t1, 100000\nmult $t0, $t1\nmflo $t2\nmfhi $t3');
    // -100000 * 100000 = -10_000_000_000 → LO=0xAE6E6600 bits (-1410065408), HI=-3
    expect(c.lo).toBe(-1410065408);
    expect(c.hi).toBe(-3);
    expect(c.registers[10]).toBe(-1410065408);
    expect(c.registers[11]).toBe(-3);
  });
  it('multu: treats operands as unsigned (0xFFFFFFFF * 0xFFFFFFFF)', () => {
    const c = execute('li $t0, -1\nli $t1, -1\nmultu $t0, $t1');
    // unsigned: (2^32-1)^2 = 0xFFFFFFFE00000001 → LO=1, HI=0xFFFFFFFE (-2 signed bits)
    expect(c.lo).toBe(1);
    expect(c.hi).toBe(-2);
  });
  it('multu differs from mult on negative operands', () => {
    const signed = execute('li $t0, -2\nli $t1, -3\nmult $t0, $t1');
    const unsigned = execute('li $t0, -2\nli $t1, -3\nmultu $t0, $t1');
    expect(signed.lo).toBe(6); expect(signed.hi).toBe(0);
    expect(unsigned.lo).toBe(6);
    expect(unsigned.hi).toBe(-5); // 0xFFFFFFFE * 0xFFFFFFFD → high word 0xFFFFFFFB
  });
  it('multu: INT_MIN * unsigned -1', () => {
    const c = execute('li $t0, -2147483648\nli $t1, -1\nmultu $t0, $t1');
    // 0x80000000 * 0xFFFFFFFF = 0x7FFFFFFF80000000
    expect(c.lo).toBe(-2147483648);
    expect(c.hi).toBe(2147483647);
  });
});

describe('arithmetic: div/divu', () => {
  it('div: positive / negative', () => {
    const c = execute('li $t0, 17\nli $t1, -5\ndiv $t0, $t1');
    expect(c.lo).toBe(-3); // trunc toward zero
    expect(c.hi).toBe(2);  // remainder takes sign of dividend
  });
  it('div: INT_MIN / -1 edge', () => {
    const c = execute('li $t0, -2147483648\nli $t1, -1\ndiv $t0, $t1');
    expect(c.lo).toBe(-2147483648);
    expect(c.hi).toBe(0);
  });
  it('div by zero traps', () => {
    expect(() => execute('li $t0, 1\nli $t1, 0\ndiv $t0, $t1')).toThrow(/division by zero/);
  });
  it('divu: unsigned max / 2', () => {
    const c = execute('li $t0, -1\nli $t1, 2\ndivu $t0, $t1');
    expect(c.lo).toBe(2147483647); // 0x7FFFFFFF
    expect(c.hi).toBe(1);
  });
  it('divu: differs from signed div on negative operands', () => {
    const signed = execute('li $t0, -6\nli $t1, 3\ndiv $t0, $t1');
    const unsigned = execute('li $t0, -6\nli $t1, 3\ndivu $t0, $t1');
    expect(signed.lo).toBe(-2); expect(signed.hi).toBe(0);
    expect(unsigned.lo).toBe(1431655763); // 0xFFFFFFFA / 3
    expect(unsigned.hi).toBe(1);          // 0xFFFFFFFA % 3
  });
  it('divu by zero traps', () => {
    expect(() => execute('li $t0, 1\nli $t1, 0\ndivu $t0, $t1')).toThrow(/division by zero/);
  });
});

describe('arithmetic: HI/LO moves', () => {
  it('mfhi copies HI', () => {
    const c = execute('li $t0, 123456789\nmult $t0, $t0\nmfhi $s0');
    // 123456789^2 = 15241578750190521 → hi bits
    expect(c.registers[16]).toBe(c.hi);
    expect(c.hi).not.toBe(0);
  });
  it('mthi and mtlo set HI and LO', () => {
    const c = execute('li $t0, -5\nli $t1, 42\nmthi $t0\nmtlo $t1\nmfhi $s0\nmflo $s1');
    expect(c.hi).toBe(-5);
    expect(c.lo).toBe(42);
    expect(c.registers[16]).toBe(-5);
    expect(c.registers[17]).toBe(42);
  });
  it('mult overwrites previous HI/LO from mthi/mtlo', () => {
    const c = execute('li $t0, 7\nmthi $t0\nmtlo $t0\nli $t1, 3\nli $t2, 4\nmult $t1, $t2');
    expect(c.lo).toBe(12);
    expect(c.hi).toBe(0);
  });
});

describe('li/move edge cases and $zero invariant', () => {
  it('li wraps values beyond 32 bits via int32 truncation', () => {
    expect(execute('li $t0, 4294967295').registers[8]).toBe(-1);
    expect(execute('li $t0, 2147483648').registers[8]).toBe(-2147483648);
  });
  it('move copies bit pattern', () => {
    expect(execute('li $t0, -123\nmove $t1, $t0').registers[9]).toBe(-123);
  });
  it('$zero stays zero through writes', () => {
    const c = execute('add $zero, $t0, $t1\nli $zero, 5\nmove $zero, $t0\naddi $zero, $zero, 99');
    expect(c.registers[0]).toBe(0);
  });
  it('numeric register aliases work', () => {
    expect(execute('li $8, 7\nadd $9, $8, $8').registers[9]).toBe(14);
  });
  it('unknown register reports source line at assemble time', () => {
    expect(() => execute('li $t0, 1\nadd $bad, $t0, $t0')).toThrow(/Line 2: rd: expected register, got '\$bad'/);
  });
});
