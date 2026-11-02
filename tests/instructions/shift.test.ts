import { describe, expect, it } from 'vitest';
import { execute } from '../helpers';

describe('shift: sll/srl/sra immediate', () => {
  it('sll by 0 keeps value', () => {
    expect(execute('li $t0, 42\nsll $t1, $t0, 0').registers[9]).toBe(42);
  });
  it('sll by 16', () => {
    expect(execute('li $t0, 3\nsll $t1, $t0, 16').registers[9]).toBe(3 << 16);
  });
  it('sll by 31 wraps into sign bit', () => {
    expect(execute('li $t0, 1\nsll $t1, $t0, 31').registers[9]).toBe(-2147483648);
  });
  it('srl on -1 by 31 yields 1 (zero fill)', () => {
    expect(execute('li $t0, -1\nsrl $t1, $t0, 31').registers[9]).toBe(1);
  });
  it('srl on -1 by 1 yields 0x7FFFFFFF', () => {
    expect(execute('li $t0, -1\nsrl $t1, $t0, 1').registers[9]).toBe(2147483647);
  });
  it('sra preserves sign', () => {
    expect(execute('li $t0, -1\nsra $t1, $t0, 31').registers[9]).toBe(-1);
    expect(execute('li $t0, -8\nsra $t1, $t0, 1').registers[9]).toBe(-4);
    expect(execute('li $t0, -8\nsra $t1, $t0, 2').registers[9]).toBe(-2);
  });
  it('srl and sra differ on negative values', () => {
    const logical = execute('li $t0, -16\nsrl $t1, $t0, 2').registers[9];
    const arithmetic = execute('li $t0, -16\nsra $t1, $t0, 2').registers[9];
    expect(logical).toBe(0x3FFFFFFC);
    expect(arithmetic).toBe(-4);
  });
  it('shift amount must be 0..31', () => {
    expect(() => execute('li $t0, 1\nsll $t1, $t0, 32')).toThrow(/shift amount out of range/i);
    expect(() => execute('li $t0, 1\nsll $t1, $t0, -1')).toThrow(/shift amount out of range/i);
  });
});

describe('shift: sllv/srlv/srav register amounts', () => {
  it('sllv uses low 5 bits of amount register', () => {
    // amount 33 → 33 & 31 = 1
    const c = execute('li $t0, 5\nli $t2, 33\nsllv $t1, $t0, $t2');
    expect(c.registers[9]).toBe(10);
  });
  it('sllv with amount 32 (→0) keeps value', () => {
    const c = execute('li $t0, 5\nli $t2, 32\nsllv $t1, $t0, $t2');
    expect(c.registers[9]).toBe(5);
  });
  it('srlv logical shift right with register amount', () => {
    const c = execute('li $t0, -1\nli $t2, 16\nsrlv $t1, $t0, $t2');
    expect(c.registers[9]).toBe(0xFFFF);
  });
  it('srav arithmetic shift right with register amount (-1 → -1)', () => {
    const c = execute('li $t0, -1\nli $t2, 31\nsrav $t1, $t0, $t2');
    expect(c.registers[9]).toBe(-1);
  });
  it('negative amount register uses two\'s-complement low bits (-1 → 31)', () => {
    const c = execute('li $t0, 1\nli $t2, -1\nsllv $t1, $t0, $t2');
    expect(c.registers[9]).toBe(1 << 31); // shift by 31
  });
  it('shifted value may come from any register, dest may be $zero-safe', () => {
    const c = execute('li $s0, 8\nli $s1, 2\nsllv $zero, $s0, $s1');
    expect(c.registers[0]).toBe(0);
    expect(c.registers[16]).toBe(8); // source untouched
  });
});
