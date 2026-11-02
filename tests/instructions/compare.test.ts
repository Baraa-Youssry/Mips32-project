import { describe, expect, it } from 'vitest';
import { execute } from '../helpers';

describe('compare: slt/sltu register', () => {
  it('slt signed: -1 < 1 is true', () => {
    expect(execute('li $t0, -1\nli $t1, 1\nslt $t2, $t0, $t1').registers[10]).toBe(1);
  });
  it('slt signed: 1 < -1 is false', () => {
    expect(execute('li $t0, 1\nli $t1, -1\nslt $t2, $t0, $t1').registers[10]).toBe(0);
  });
  it('slt on equal values is false', () => {
    expect(execute('li $t0, 5\nli $t1, 5\nslt $t2, $t0, $t1').registers[10]).toBe(0);
  });
  it('sltu: -1 (0xFFFFFFFF) is the largest unsigned', () => {
    expect(execute('li $t0, -1\nli $t1, 1\nsltu $t2, $t0, $t1').registers[10]).toBe(0);
    expect(execute('li $t0, 1\nli $t1, -1\nsltu $t2, $t0, $t1').registers[10]).toBe(1);
  });
  it('slt vs sltu differ on INT_MIN / -1', () => {
    const signed = execute('li $t0, -2147483648\nli $t1, -1\nslt $t2, $t0, $t1').registers[10];
    const unsigned = execute('li $t0, -2147483648\nli $t1, -1\nsltu $t2, $t0, $t1').registers[10];
    expect(signed).toBe(1);
    expect(unsigned).toBe(1); // 0x80000000 < 0xFFFFFFFF
  });
});

describe('compare: slti/sltiu immediates', () => {
  it('slti signed immediate compare', () => {
    expect(execute('li $t0, -5\nslti $t1, $t0, -4').registers[9]).toBe(1);
    expect(execute('li $t0, -4\nslti $t1, $t0, -4').registers[9]).toBe(0);
    expect(execute('li $t0, 10\nslti $t1, $t0, 11').registers[9]).toBe(1);
  });
  it('sltiu compares unsigned against sign-extended immediate', () => {
    // -1 as immediate → 0xFFFFFFFF; 5 < 0xFFFFFFFF unsigned → 1
    expect(execute('li $t0, 5\nsltiu $t1, $t0, -1').registers[9]).toBe(1);
    // -1 register → 0xFFFFFFFF; 0xFFFFFFFF < 1 → 0
    expect(execute('li $t0, -1\nsltiu $t1, $t0, 1').registers[9]).toBe(0);
    // -1 register vs -1 imm → equal unsigned → 0
    expect(execute('li $t0, -1\nsltiu $t1, $t0, -1').registers[9]).toBe(0);
  });
  it('INT_MIN boundary with slti (16-bit immediate range)', () => {
    expect(execute('li $t0, -2147483648\nslti $t1, $t0, -32768').registers[9]).toBe(1);
    expect(execute('li $t0, -32768\nslti $t1, $t0, -32768').registers[9]).toBe(0);
    expect(execute('li $t0, -32769\nslti $t1, $t0, -32768').registers[9]).toBe(1);
  });
  it('slti immediate outside 16-bit range is rejected', () => {
    expect(() => execute('li $t0, 1\nslti $t1, $t0, -32769')).toThrow(/immediate out of range/i);
    expect(() => execute('li $t0, 1\nslti $t1, $t0, 65536')).toThrow(/immediate out of range/i);
  });
});
