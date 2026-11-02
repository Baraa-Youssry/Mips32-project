import { describe, expect, it } from 'vitest';
import { assemble } from '../src/core/assembler';
import { MipsCpu } from '../src/core/cpu';
import { execute } from './helpers';

/**
 * Regression tests for confirmed defects (never weaken these).
 *
 * BUG-1: `blt $a0, 2, base` silently bound the immediate 2 to register $v0
 *        (bare integers were accepted as register operands), producing wrong
 *        comparisons and INFINITE LOOPS in normal recursive programs.
 * BUG-2: bare integers were accepted in register positions on real
 *        instructions (add/move/beq/slt) — silent wrong code.
 */

describe('BUG-1 regression: branch pseudos with immediate operands', () => {
  it('blt rs, imm expands to slti — NOT slt against a misparsed register', () => {
    const p = assemble('blt $a0, 2, base\nbase: nop');
    expect(p.instructions[0].op).toBe('slti');
    expect(p.instructions[0].args).toEqual(['$at', '$a0', '2']);
    expect(p.instructions[1].op).toBe('bne');
    expect(p.instructions[1].args).toEqual(['$at', '$zero', String(0x00400008)]);
  });
  it('expansion keeps the original source line', () => {
    const p = assemble('nop\nblt $a0, 2, base\nbase: nop');
    expect(p.instructions[1].line).toBe(2);
    expect(p.instructions[2].line).toBe(2);
  });
  it('the exact recursive program that previously infinite-loops now returns 55', () => {
    const cpu = new MipsCpu();
    cpu.load(assemble(`
      .text
      li $a0, 10
      jal fib
      move $a0, $v0
      li $v0, 1
      syscall
      li $v0, 10
      syscall
    fib:
      blt $a0, 2, base
      addiu $sp, $sp, -16
      sw $ra, 12($sp)
      sw $s0, 8($sp)
      sw $a0, 4($sp)
      addiu $a0, $a0, -1
      jal fib
      move $s0, $v0
      lw $a0, 4($sp)
      addiu $a0, $a0, -2
      jal fib
      addu $v0, $v0, $s0
      lw $s0, 8($sp)
      lw $ra, 12($sp)
      addiu $sp, $sp, 16
      jr $ra
    base:
      move $v0, $a0
      jr $ra
    `));
    const sp0 = cpu.registers[29];
    cpu.run(500_000);
    expect(cpu.output.join('')).toBe('55');
    expect(cpu.halted).toBe(true);
    expect(cpu.registers[29]).toBe(sp0);
  });

  it('immediate form semantics: blt/bgt/ble/bge, register on the left', () => {
    expect(execute('li $t0, 1\nblt $t0, 5, ok\nli $t1, 99\nok: li $t1, 1').registers[9]).toBe(1);
    expect(execute('li $t0, 9\nblt $t0, 5, ok\nli $t1, 99\nok: nop').registers[9]).toBe(99);
    expect(execute('li $t0, 9\nbgt $t0, 5, ok\nli $t1, 99\nok: li $t1, 1').registers[9]).toBe(1);
    expect(execute('li $t0, 5\nbgt $t0, 5, ok\nli $t1, 99\nok: nop').registers[9]).toBe(99);
    expect(execute('li $t0, 5\nble $t0, 5, ok\nli $t1, 99\nok: li $t1, 1').registers[9]).toBe(1);
    expect(execute('li $t0, 6\nble $t0, 5, ok\nli $t1, 99\nok: nop').registers[9]).toBe(99);
    expect(execute('li $t0, 5\nbge $t0, 5, ok\nli $t1, 99\nok: li $t1, 1').registers[9]).toBe(1);
    expect(execute('li $t0, 4\nbge $t0, 5, ok\nli $t1, 99\nok: nop').registers[9]).toBe(99);
  });
  it('immediate form semantics: immediate on the left', () => {
    expect(execute('li $t0, 5\nblt 1, $t0, ok\nli $t1, 99\nok: li $t1, 1').registers[9]).toBe(1);
    expect(execute('li $t0, 5\nblt 9, $t0, ok\nli $t1, 99\nok: nop').registers[9]).toBe(99);
    expect(execute('li $t0, 5\nbgt 10, $t0, ok\nli $t1, 99\nok: li $t1, 1').registers[9]).toBe(1);
    expect(execute('li $t0, 5\nble 5, $t0, ok\nli $t1, 99\nok: li $t1, 1').registers[9]).toBe(1);
    expect(execute('li $t0, 5\nbge 6, $t0, ok\nli $t1, 99\nok: li $t1, 1').registers[9]).toBe(1);
    expect(execute('li $t0, 5\nbge 4, $t0, ok\nli $t1, 99\nok: nop').registers[9]).toBe(99);
  });
  it('negative immediates work in both positions', () => {
    expect(execute('li $t0, -3\nblt $t0, -1, ok\nli $t1, 99\nok: li $t1, 1').registers[9]).toBe(1);
    expect(execute('li $t0, -3\nblt -1, $t0, ok\nli $t1, 99\nok: nop').registers[9]).toBe(99);
  });
  it('rejects immediates outside imm16 range', () => {
    expect(() => assemble('blt $t0, 70000, L\nL: nop')).toThrow(/blt immediate operand out of range/);
    expect(() => assemble('blt $t0, -70000, L\nL: nop')).toThrow(/blt immediate operand out of range/);
  });
  it('rejects 65535 where the +1 expansion would overflow', () => {
    expect(() => assemble('ble $t0, 65535, L\nL: nop')).toThrow(/out of range/);
    expect(() => assemble('bgt $t0, 65535, L\nL: nop')).toThrow(/out of range/);
    // blt/bge compare directly — 65535 is fine
    expect(assemble('blt $t0, 65535, L\nL: nop').instructions[0].args[2]).toBe('65535');
    expect(assemble('bge $t0, 65535, L\nL: nop').instructions[0].args[2]).toBe('65535');
  });
  it('rejects two immediates or two registers-plus-label misuse', () => {
    expect(() => assemble('blt 1, 2, L\nL: nop')).toThrow(/expected register operands, or one register and one immediate/);
    expect(() => assemble('blt $t0, target, L\nL: nop')).toThrow(/expected register operands, or one register and one immediate/);
  });
});

describe('BUG-2 regression: bare integers are not registers', () => {
  it('add with a bare integer operand is rejected with the source line', () => {
    expect(() => assemble('add $t0, 5, $t1')).toThrow(/Line 1: rs: expected register, got '5'/);
  });
  it('move with a bare integer is rejected', () => {
    expect(() => assemble('move $t0, 7')).toThrow(/Line 1: .*expected register, got '7'/);
  });
  it('beq with an immediate operand is rejected (use li + beq, or the branch pseudos)', () => {
    expect(() => assemble('beq $t0, 4, x\nx: nop')).toThrow(/Line 1: rt: expected register, got '4'/);
  });
  it('slt with a bare integer is rejected', () => {
    expect(() => assemble('slt $at, $a0, 2')).toThrow(/Line 1: rt: expected register, got '2'/);
  });
  it('errors still report the correct line for later lines', () => {
    expect(() => assemble('nop\nadd $t0, 9, $t1')).toThrow(/Line 2: rs: expected register, got '9'/);
  });
  it('$-prefixed numeric registers remain valid ($5 == $a1)', () => {
    const cpu = execute('li $5, 123');
    expect(cpu.registers[5]).toBe(123);
  });
});
