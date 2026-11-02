import { describe, expect, it } from 'vitest';
import { assemble } from '../../src/core/assembler';
import { execute } from '../helpers';

describe('mul (MIPS32 three-operand multiply)', () => {
  it('computes rd = low 32 bits of rs * rt (screenshot 1: 20 * 5)', () => {
    const cpu = execute('li $t0, 20\nli $t1, 5\nmul $t4, $t0, $t1');
    expect(cpu.registers[12]).toBe(100);
  });
  it('handles negative operands (signed product)', () => {
    const cpu = execute('li $t0, -3\nli $t1, 7\nmul $t2, $t0, $t1');
    expect(cpu.registers[10]).toBe(-21);
    const cpu2 = execute('li $t0, -6\nli $t1, -7\nmul $t2, $t0, $t1');
    expect(cpu2.registers[10]).toBe(42);
  });
  it('wraps on 32-bit overflow (low 32 bits)', () => {
    // 0x10000 * 0x10000 = 2^32 -> low 32 = 0
    const cpu = execute('li $t0, 0x10000\nli $t1, 0x10000\nmul $t2, $t0, $t1');
    expect(cpu.registers[10]).toBe(0);
    // 0x7FFFFFFF * 2 = 0xFFFFFFFE -> -2 as int32
    const cpu2 = execute('li $t0, 0x7fffffff\nli $t1, 2\nmul $t2, $t0, $t1');
    expect(cpu2.registers[10]).toBe(-2);
  });
  it('does NOT modify HI/LO (unlike the mult instruction)', () => {
    const cpu = execute('li $t0, 12345\nmthi $t0\nli $t1, 2\nli $t2, 3\nmul $t3, $t1, $t2');
    expect(cpu.registers[11]).toBe(6); // $t3
    expect(cpu.hi).toBe(12345);
    expect(cpu.lo).toBe(0);
  });
  it('mult still writes HI/LO (distinction from mul)', () => {
    const cpu = execute('li $t0, 0x10000\nli $t1, 0x10000\nmult $t0, $t1');
    expect(cpu.lo).toBe(0);
    expect(cpu.hi).toBe(1);
  });
  it('operand order matches rd, rs, rt', () => {
    const cpu = execute('li $t0, 3\nli $t1, 100\nmul $t2, $t0, $t1');
    expect(cpu.registers[10]).toBe(300);
  });
});

describe('subi pseudoinstruction', () => {
  it('subi $rd, $rs, imm subtracts an immediate', () => {
    const cpu = execute('li $t0, 5\nsubi $t0, $t0, 1');
    expect(cpu.registers[8]).toBe(4);
  });
  it('expands to addi with negated immediate, same source line', () => {
    const p = assemble('subi $t0, $t1, 5');
    expect(p.instructions).toHaveLength(1);
    expect(p.instructions[0].op).toBe('addi');
    expect(p.instructions[0].args).toEqual(['$t0', '$t1', '-5']);
    expect(p.instructions[0].line).toBe(1);
  });
  it('accepts negative immediates (double subtraction)', () => {
    const cpu = execute('li $t0, 5\nsubi $t0, $t0, -3');
    expect(cpu.registers[8]).toBe(8);
    const p = assemble('subi $t0, $t1, -3');
    expect(p.instructions[0].args).toEqual(['$t0', '$t1', '3']);
  });
  it('rejects immediates outside imm16 range', () => {
    expect(() => assemble('subi $t0, $t1, 40000')).toThrow(/subi immediate out of range/);
    expect(() => assemble('subi $t0, $t1, -40000')).toThrow(/subi immediate out of range/);
  });
  it('validates register operands', () => {
    expect(() => assemble('subi $t0, bogus, 1')).toThrow(/rs: expected register/);
    // subi expands to addi, whose first operand is rt
    expect(() => assemble('subi bogus, $t0, 1')).toThrow(/rt: expected register/);
  });
});

describe('branch pseudoinstructions: b/blt/bgt/ble/bge', () => {
  it('b label jumps unconditionally', () => {
    const cpu = execute('b skip\nli $t0, 1\nskip: li $t0, 2');
    expect(cpu.registers[8]).toBe(2);
  });
  it('b expands to j with the same line', () => {
    const p = assemble('b done\ndone: nop');
    expect(p.instructions[0].op).toBe('j');
    expect(p.instructions[0].line).toBe(1);
  });
  it('blt branches when rs < rt (signed)', () => {
    const cpu = execute('li $t0, -1\nli $t1, 1\nblt $t0, $t1, ok\nli $t2, 99\nok: li $t2, 1');
    expect(cpu.registers[10]).toBe(1);
    const cpu2 = execute('li $t0, 2\nli $t1, 1\nblt $t0, $t1, ok\nli $t2, 99\nok: nop');
    expect(cpu2.registers[10]).toBe(99);
  });
  it('bgt branches when rs > rt', () => {
    const cpu = execute('li $t0, 5\nli $t1, -2\nbgt $t0, $t1, ok\nli $t2, 99\nok: li $t2, 1');
    expect(cpu.registers[10]).toBe(1);
  });
  it('ble branches when rs <= rt (equality included)', () => {
    const cpu = execute('li $t0, 5\nli $t1, 5\nble $t0, $t1, ok\nli $t2, 99\nok: li $t2, 1');
    expect(cpu.registers[10]).toBe(1);
  });
  it('bge branches when rs >= rt (equality included)', () => {
    const cpu = execute('li $t0, 5\nli $t1, 5\nbge $t0, $t1, ok\nli $t2, 99\nok: li $t2, 1');
    expect(cpu.registers[10]).toBe(1);
    const cpu2 = execute('li $t0, -1\nli $t1, 5\nbge $t0, $t1, ok\nli $t2, 99\nok: nop');
    expect(cpu2.registers[10]).toBe(99);
  });
  it('blt expands to slt $at + bne (uses assembler temporary)', () => {
    const p = assemble('blt $t0, $t1, target\ntarget: nop');
    expect(p.instructions[0].op).toBe('slt');
    expect(p.instructions[0].args[0]).toBe('$at');
    expect(p.instructions[1].op).toBe('bne');
    expect(p.instructions[1].args).toEqual(['$at', '$zero', String(0x00400008)]);
  });
  it('bge expands to slt $at + beq', () => {
    const p = assemble('bge $t0, $t1, target\ntarget: nop');
    expect(p.instructions[0].op).toBe('slt');
    expect(p.instructions[1].op).toBe('beq');
  });
  it('backward branch pseudos work in loops (max of array)', () => {
    const cpu = execute(`
      .data
      arr: .word 3, 40, 7, 0
      .text
      la $t0, arr
      li $t1, -1
    loop:
      lw $t2, 0($t0)
      beq $t2, $zero, done
      bgt $t2, $t1, update
      j next
    update:
      move $t1, $t2
    next:
      addiu $t0, $t0, 4
      j loop
    done:
    `);
    expect(cpu.registers[9]).toBe(40);
  });
  it('undefined label in pseudo branch is rejected', () => {
    expect(() => assemble('blt $t0, $t1, nowhere')).toThrow(/undefined label 'nowhere'/);
  });
});
