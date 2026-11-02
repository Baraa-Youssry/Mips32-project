import { describe, expect, it } from 'vitest';
import { assemble, AsmError, TEXT_BASE } from '../../src/core/assembler';
import { MipsCpu } from '../../src/core/cpu';
import { execute } from '../helpers';

describe('Conditional branches: beq/bne', () => {
  it('beq taken skips the following instruction', () => {
    const cpu = execute('li $t0, 5\nli $t1, 5\nbeq $t0, $t1, target\nli $t2, 1\ntarget:\nli $t3, 2');
    expect(cpu.registers[10]).toBe(0); // skipped
    expect(cpu.registers[11]).toBe(2);
  });
  it('beq not taken falls through', () => {
    const cpu = execute('li $t0, 5\nli $t1, 6\nbeq $t0, $t1, target\nli $t2, 1\ntarget:\nli $t3, 2');
    expect(cpu.registers[10]).toBe(1);
  });
  it('bne taken when registers differ', () => {
    const cpu = execute('li $t0, 5\nli $t1, 6\nbne $t0, $t1, target\nli $t2, 1\ntarget:\nli $t3, 2');
    expect(cpu.registers[10]).toBe(0);
    expect(cpu.registers[11]).toBe(2);
  });
  it('backward bne forms a loop (sum 1..5)', () => {
    const cpu = execute('li $t0, 0\nli $t1, 1\nli $t2, 6\nloop: add $t0, $t0, $t1\naddiu $t1, $t1, 1\nbne $t1, $t2, loop');
    expect(cpu.registers[8]).toBe(15);
  });
});

describe('Signed branches: blez/bgtz/bltz/bgez', () => {
  it('blez branches on zero and negative', () => {
    const cpu = execute('li $t0, 0\nblez $t0, ok1\nj fail\nok1: li $t1, 1\nli $t0, -3\nblez $t0, ok2\nj fail\nok2: li $t1, 2\nj done\nfail: li $t1, -1\ndone: nop');
    expect(cpu.registers[9]).toBe(2);
  });
  it('bgtz branches only on positive', () => {
    const cpu = execute('li $t0, 7\nbgtz $t0, ok\nj fail\nok: li $t1, 1\nj done\nfail: li $t1, -1\ndone: nop');
    expect(cpu.registers[9]).toBe(1);
    const cpu2 = execute('li $t0, 0\nbgtz $t0, ok\nj fail\nok: li $t1, 1\nj done\nfail: li $t1, -1\ndone: nop');
    expect(cpu2.registers[9]).toBe(-1);
  });
  it('bltz/bgez split on sign', () => {
    const cpu = execute('li $t0, -1\nbltz $t0, neg\nj done\nneg: li $t1, 1\ndone: nop');
    expect(cpu.registers[9]).toBe(1);
    const cpu2 = execute('li $t0, -1\nbgez $t0, nonneg\nj done\nnonneg: li $t1, 1\ndone: nop');
    expect(cpu2.registers[9]).toBe(0);
  });
});

describe('Unconditional jumps: j/jal/jr/jalr', () => {
  it('j jumps forward', () => {
    const cpu = execute('j target\nli $t0, 1\ntarget: li $t0, 2');
    expect(cpu.registers[8]).toBe(2);
  });
  it('jal sets $ra to the instruction after the jal and jumps', () => {
    const cpu = new MipsCpu();
    cpu.load(assemble('jal func\nnop\nfunc: nop'));
    cpu.step(); // execute jal
    expect(cpu.pc).toBe(TEXT_BASE + 8); // func
    expect(cpu.registers[31]).toBe(TEXT_BASE + 4); // return address
  });
  it('jr returns from a function (call/return e2e)', () => {
    const cpu = execute('jal func\nli $t1, 1\nj end\nfunc: li $t0, 42\njr $ra\nend: nop');
    expect(cpu.registers[8]).toBe(42);
    expect(cpu.registers[9]).toBe(1);
  });
  it('jalr jumps via register and writes return address to rd', () => {
    const cpu = new MipsCpu();
    cpu.load(assemble('la $t0, func\njalr $t9, $t0\nnop\nfunc: nop'));
    cpu.step(); cpu.step(); cpu.step(); // lui, ori (la), jalr
    // func sits after lui, ori, jalr, nop -> index 4
    expect(cpu.pc).toBe(TEXT_BASE + 16);
    expect(cpu.registers[25]).toBe(TEXT_BASE + 12); // $t9 = return (jalr at index 2)
  });
  it('jalr single-operand form writes $ra', () => {
    const cpu = new MipsCpu();
    cpu.load(assemble('la $t0, func\njalr $t0\nnop\nfunc: nop'));
    cpu.step(); cpu.step(); cpu.step(); // lui, ori (la), jalr
    expect(cpu.pc).toBe(TEXT_BASE + 16);
    expect(cpu.registers[31]).toBe(TEXT_BASE + 12);
  });
  it('nested calls preserve return chain ($ra saved on stack)', () => {
    const cpu = execute(`
      jal outer
      j done
      outer:
        addiu $sp, $sp, -4
        sw $ra, 0($sp)
        li $t0, 1
        jal inner
        lw $ra, 0($sp)
        addiu $sp, $sp, 4
        addiu $t0, $t0, 10
        jr $ra
      inner:
        addiu $t0, $t0, 100
        jr $ra
      done: nop
    `);
    expect(cpu.registers[8]).toBe(111);
  });
});

describe('Control flow: assembler validation', () => {
  it('undefined branch label is rejected with line number', () => {
    expect(() => assemble('nop\nbeq $t0, $t1, nowhere')).toThrow(/Line 2: undefined label 'nowhere'/);
  });
  it('undefined jump label is rejected', () => {
    expect(() => assemble('j nowhere')).toThrow(/undefined label 'nowhere'/);
  });
  it('numeric jump targets are accepted when aligned and in range', () => {
    const p = assemble('j 0x00400010');
    expect(p.instructions[0].args[0]).toBe(String(0x00400010));
  });
  it('unaligned numeric jump target is rejected', () => {
    expect(() => assemble('j 0x00400002')).toThrow(/jump target not word-aligned/);
  });
  it('jump to a different 256MB region is rejected', () => {
    expect(() => assemble('j 0x10000000')).toThrow(/jump target out of range/);
  });
  it('branch beyond the 128KB offset range is rejected', () => {
    const src = 'nop\n'.repeat(40000) + 'beq $zero, $zero, end\n' + 'nop\n'.repeat(40000) + 'end: nop';
    expect(() => assemble(src)).toThrow(/branch target out of range/);
  });
  it('branch to a non-numeric non-label operand is rejected', () => {
    expect(() => assemble('beq $t0, $t1, $t2')).toThrow(/undefined label/);
  });
  it('AsmError type and line property are preserved', () => {
    try { assemble('blez $t0, nowhere'); } catch (e) {
      expect(e).toBeInstanceOf(AsmError);
      expect((e as AsmError).line).toBe(1);
    }
  });
  it('jalr arity: one operand expands to $ra form', () => {
    const p = assemble('la $t0, f\njalr $t0\nf: nop');
    const jalr = p.instructions.find((x) => x.op === 'jalr')!;
    expect(jalr.args).toEqual(['$ra', '$t0']);
  });
});

describe('Control flow: runtime behavior', () => {
  it('infinite loop trips the max-steps guard', () => {
    expect(() => execute('loop: j loop', 5000)).toThrow(/stopped after 5000 steps/);
  });
  it('taken branch to an address with no instruction halts', () => {
    const cpu = new MipsCpu();
    cpu.load(assemble('beq $zero, $zero, 0x00400080\nnop')); // jump into empty space
    cpu.run();
    expect(cpu.halted).toBe(true);
    expect(cpu.pc).toBe(0x00400080);
  });
  it('backward branch loop with memory stores (array sum)', () => {
    const cpu = execute(`
      .data
      arr: .word 3, 5, 7, 0
      .text
      la $t0, arr
      li $t1, 0        # sum
      li $t2, 4        # count
    loop:
      lw $t3, 0($t0)
      beq $t3, $zero, done
      addu $t1, $t1, $t3
      addiu $t0, $t0, 4
      addiu $t2, $t2, -1
      bne $t2, $zero, loop
    done:
    `);
    expect(cpu.registers[9]).toBe(15);
  });
});
