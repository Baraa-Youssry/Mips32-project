import { describe, expect, it } from 'vitest';
import { assemble } from '../../src/core/assembler';
import { MipsCpu } from '../../src/core/cpu';

/**
 * Integration tests for the six reported screenshot failures.
 * Each runs the EXACT program from the report through the real
 * assembler -> CPU -> memory -> syscall pipeline.
 */

function runProgram(source: string, maxSteps = 10000): MipsCpu {
  const cpu = new MipsCpu();
  cpu.load(assemble(source));
  cpu.run(maxSteps);
  return cpu;
}

describe('Screenshot 1: mul', () => {
  it('mul $t4, $t0, $t1 with 20 and 5 produces 100', () => {
    const cpu = runProgram(`
      li $t0, 20
      li $t1, 5
      mul $t4, $t0, $t1
      li $v0, 10
      syscall
    `);
    expect(cpu.registers[12]).toBe(100);
    expect(cpu.halted).toBe(true);
  });
});

describe('Screenshot 2: string output (syscall 4)', () => {
  it('prints "Hello, MIPS World!\\n"', () => {
    const cpu = runProgram(`
      .data
      msg: .asciiz "Hello, MIPS World!\\n"

      .text
      .globl main

      main:
          li $v0, 4
          la $a0, msg
          syscall

          li $v0, 10
          syscall
    `);
    expect(cpu.output).toEqual(['Hello, MIPS World!\n']);
    expect(cpu.halted).toBe(true);
  });
});

describe('Screenshot 3: beq/bne', () => {
  it('10 != 20 routes to not_equal; $s0 = 2', () => {
    const cpu = runProgram(`
      .text
      .globl main

      main:
          li $t0, 10
          li $t1, 20

          beq $t0, $t1, equal
          bne $t0, $t1, not_equal

      equal:
          li $s0, 1
          j end

      not_equal:
          li $s0, 2

      end:
          li $v0, 10
          syscall
    `);
    expect(cpu.registers[16]).toBe(2); // $s0
    expect(cpu.halted).toBe(true);
  });
  it('equal values take the beq path; $s0 = 1', () => {
    const cpu = runProgram(`
      li $t0, 10
      li $t1, 10
      beq $t0, $t1, equal
      bne $t0, $t1, not_equal
      equal:
      li $s0, 1
      j end
      not_equal:
      li $s0, 2
      end:
      li $v0, 10
      syscall
    `);
    expect(cpu.registers[16]).toBe(1);
  });
});

describe('Screenshot 4: factorial loop (mul + subi + beq + j)', () => {
  it('5! = 120 in $t1 and printed via syscall 1', () => {
    const cpu = runProgram(`
      .text
      .globl main

      main:
          li $t0, 5
          li $t1, 1

      loop:
          beq $t0, $zero, finish

          mul $t1, $t1, $t0
          subi $t0, $t0, 1

          j loop

      finish:
          move $a0, $t1
          li $v0, 1
          syscall

          li $v0, 10
          syscall
    `);
    expect(cpu.registers[9]).toBe(120); // $t1
    expect(cpu.output).toEqual(['120']);
    expect(cpu.halted).toBe(true);
  });
});

describe('Screenshot 5: .word + la + lw', () => {
  it('loads 10/20/30, sums to 60, prints 60', () => {
    const cpu = runProgram(`
      .data
      arr: .word 10, 20, 30, 40, 50

      .text
      .globl main

      main:
          la $t0, arr

          lw $t1, 0($t0)
          lw $t2, 4($t0)
          lw $t3, 8($t0)

          add $t4, $t1, $t2
          add $t4, $t4, $t3

          move $a0, $t4
          li $v0, 1
          syscall

          li $v0, 10
          syscall
    `);
    expect(cpu.registers[9]).toBe(10);   // $t1
    expect(cpu.registers[10]).toBe(20);  // $t2
    expect(cpu.registers[11]).toBe(30);  // $t3
    expect(cpu.registers[12]).toBe(60);  // $t4
    expect(cpu.output).toEqual(['60']);
  });
});

describe('Screenshot 6: interactive input (syscalls 4 + 5 + 1)', () => {
  it('pauses for input, echoes the entered integer 42', () => {
    const cpu = new MipsCpu();
    cpu.load(assemble(`
      .data
      prompt: .asciiz "Enter a number: "
      result: .asciiz "You entered: "

      .text
      .globl main

      main:
          li $v0, 4
          la $a0, prompt
          syscall

          li $v0, 5
          syscall

          move $t0, $v0

          li $v0, 4
          la $a0, result
          syscall

          move $a0, $t0
          li $v0, 1
          syscall

          li $v0, 10
          syscall
    `));
    const first = cpu.runChunk(100000);
    expect(first.pausedForInput).toBe(true);
    expect(cpu.output.join('')).toBe('Enter a number: ');
    cpu.provideInput(42);
    const second = cpu.runChunk(100000);
    expect(second.pausedForInput).toBe(false);
    expect(cpu.halted).toBe(true);
    expect(cpu.registers[8]).toBe(42); // $t0
    expect(cpu.output.join('')).toBe('Enter a number: You entered: 42');
  });
  it('works with negative input (-7)', () => {
    const cpu = new MipsCpu();
    cpu.load(assemble(`
      li $v0, 5
      syscall
      move $a0, $v0
      li $v0, 1
      syscall
      li $v0, 10
      syscall
    `));
    cpu.runChunk(10000);
    cpu.provideInput(-7);
    cpu.runChunk(10000);
    expect(cpu.output).toEqual(['-7']);
    expect(cpu.halted).toBe(true);
  });
});
