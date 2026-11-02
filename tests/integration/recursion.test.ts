import { describe, expect, it } from 'vitest';
import { assemble } from '../../src/core/assembler';
import { MipsCpu } from '../../src/core/cpu';

/** Runs source to completion; returns the CPU for output + register inspection. */
function run(source: string, maxSteps = 1_000_000): MipsCpu {
  const cpu = new MipsCpu();
  cpu.load(assemble(source));
  cpu.run(maxSteps);
  return cpu;
}

function fibProgram(n: number): string {
  return `
    .text
    li $a0, ${n}
    jal fib
    move $a0, $v0
    li $v0, 1
    syscall
    li $v0, 10
    syscall
  fib:
    blt $a0, 2, fib_base
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
  fib_base:
    move $v0, $a0
    jr $ra
  `;
}

describe('1. Simple function call', () => {
  it('jal/jr with $v0 return value and $ra correctness', () => {
    const cpu = run(`
      li $a0, 21
      jal double
      move $s0, $v0
      li $v0, 10
      syscall
    double:
      sll $v0, $a0, 1
      jr $ra
    `);
    expect(cpu.registers[16]).toBe(42); // $s0 = return value from $v0
    expect(cpu.halted).toBe(true);
  });
});

describe('2. Two nested function calls', () => {
  it('outer calls inner; both return correctly', () => {
    const cpu = run(`
      jal outer
      move $s6, $v0
      li $v0, 10
      syscall
    outer:
      addiu $sp, $sp, -8
      sw $ra, 4($sp)
      jal inner            # $v0 = 10
      addiu $sp, $sp, -4
      sw $v0, 0($sp)
      jal inner            # $v0 = 10 again
      lw $v0, 0($sp)
      addiu $sp, $sp, 4
      addiu $v0, $v0, 5    # 15
      lw $ra, 4($sp)
      addiu $sp, $sp, 8
      jr $ra
    inner:
      li $v0, 10
      jr $ra
    `);
    expect(cpu.registers[22]).toBe(15); // $s6 = outer's result
  });
});

describe('3. Function modifies $s0 and restores it', () => {
  it('$s0 survives the call when the callee saves/restores it', () => {
    const cpu = run(`
      li $s0, 42
      jal f
      li $v0, 10
      syscall
    f:
      addiu $sp, $sp, -8
      sw $ra, 4($sp)
      sw $s0, 0($sp)
      li $s0, -1           # clobber
      lw $s0, 0($sp)       # restore
      lw $ra, 4($sp)
      addiu $sp, $sp, 8
      jr $ra
    `);
    expect(cpu.registers[16]).toBe(42);
  });
});

describe('4-7. Recursive factorial and Fibonacci', () => {
  it('recursive factorial fact(6) = 720', () => {
    const cpu = run(`
      li $a0, 6
      jal fact
      move $s5, $v0
      li $v0, 10
      syscall
    fact:
      ble $a0, 1, fact_base
      addiu $sp, $sp, -16
      sw $ra, 12($sp)
      sw $a0, 8($sp)
      addiu $a0, $a0, -1
      jal fact
      lw $a0, 8($sp)
      mul $v0, $a0, $v0
      lw $ra, 12($sp)
      addiu $sp, $sp, 16
      jr $ra
    fact_base:
      li $v0, 1
      jr $ra
    `);
    expect(cpu.registers[21]).toBe(720); // $s5 = return value
  });
  it('recursive Fibonacci n = 10 -> 55 (output and state)', () => {
    const cpu = run(fibProgram(10));
    expect(cpu.output.join('')).toBe('55');
    expect(cpu.registers[4]).toBe(55); // $a0 held the result printed above
    expect(cpu.halted).toBe(true);
  });
  it('recursive Fibonacci n = 15 -> 610', () => {
    const cpu = run(fibProgram(15));
    expect(cpu.output.join('')).toBe('610');
    expect(cpu.halted).toBe(true);
  });
  it('recursive Fibonacci n = 1 (base case edge)', () => {
    const cpu = run(fibProgram(1));
    expect(cpu.output.join('')).toBe('1');
  });
});

describe('8. Recursive functions with multiple saved registers', () => {
  it('saves/restores $s0-$s3 across a nested call and returns a value', () => {
    const cpu = run(`
      li $s0, 100
      li $s1, 200
      li $s2, 300
      li $s3, 400
      jal g
      move $t8, $v0
      li $v0, 10
      syscall
    g:
      addiu $sp, $sp, -32
      sw $ra, 28($sp)
      sw $s0, 24($sp)
      sw $s1, 20($sp)
      sw $s2, 16($sp)
      sw $s3, 12($sp)
      li $s0, -1
      li $s1, -1
      li $s2, -1
      li $s3, -1
      jal h                 # nested call inside g
      lw $s3, 12($sp)
      lw $s2, 16($sp)
      lw $s1, 20($sp)
      lw $s0, 24($sp)
      lw $ra, 28($sp)
      addiu $sp, $sp, 32
      jr $ra
    h:
      li $v0, 777
      jr $ra
    `);
    expect(cpu.registers[16]).toBe(100); // $s0
    expect(cpu.registers[17]).toBe(200); // $s1
    expect(cpu.registers[18]).toBe(300); // $s2
    expect(cpu.registers[19]).toBe(400); // $s3
    expect(cpu.registers[24]).toBe(777); // $t8 = $v0 from h
  });
  it('callee-saved discipline: recursive fib keeps $s registers intact for the caller', () => {
    const cpu = new MipsCpu();
    cpu.load(assemble(`
      li $s0, 123
      li $s1, 456
      li $a0, 10
      jal fib
      move $s2, $v0
      li $v0, 10
      syscall
    fib:
      blt $a0, 2, fib_base
      addiu $sp, $sp, -24
      sw $ra, 20($sp)
      sw $s0, 16($sp)
      sw $s1, 12($sp)
      sw $a0, 8($sp)
      addiu $a0, $a0, -1
      jal fib
      move $s0, $v0
      lw $a0, 8($sp)
      addiu $a0, $a0, -2
      jal fib
      addu $v0, $v0, $s0
      lw $s1, 12($sp)
      lw $s0, 16($sp)
      lw $ra, 20($sp)
      addiu $sp, $sp, 24
      jr $ra
    fib_base:
      move $v0, $a0
      jr $ra
    `));
    cpu.run(1_000_000);
    expect(cpu.registers[18]).toBe(55); // $s2 = fib(10)
    expect(cpu.registers[16]).toBe(123);
    expect(cpu.registers[17]).toBe(456);
  });
});

describe('9. Deep recursion', () => {
  it('5000 nested frames return and print 1', () => {
    const cpu = run(`
      li $a0, 5000
      jal countdown
      move $a0, $v0
      li $v0, 1
      syscall
      li $v0, 10
      syscall
    countdown:
      addiu $sp, $sp, -8
      sw $ra, 4($sp)
      sw $a0, 0($sp)
      beq $a0, $zero, cd_done
      addiu $a0, $a0, -1
      jal countdown
    cd_done:
      li $v0, 1
      lw $a0, 0($sp)
      lw $ra, 4($sp)
      addiu $sp, $sp, 8
      jr $ra
    `, 5_000_000);
    expect(cpu.output.join('')).toBe('1');
    expect(cpu.halted).toBe(true);
  });
});

describe('10. Stack pointer restoration', () => {
  it('$sp after a mixed program of loops + calls equals the initial value', () => {
    const cpu = run(`
      li $s7, 0
      jal work
      jal work
      li $v0, 10
      syscall
    work:
      addiu $sp, $sp, -16
      sw $ra, 12($sp)
      li $t0, 0
    wloop:
      beq $t0, $zero, wdone
      addiu $t0, $t0, -1
      j wloop
    wdone:
      addiu $t0, $zero, 4
      jal helper
      lw $ra, 12($sp)
      addiu $sp, $sp, 16
      jr $ra
    helper:
      addiu $sp, $sp, -8
      sw $ra, 4($sp)
      li $t1, 0
      lw $ra, 4($sp)
      addiu $sp, $sp, 8
      jr $ra
    `);
    // sp0 captured implicitly: initial ABI value
    expect(cpu.registers[29]).toBe(0x7ffffffc);
    expect(cpu.halted).toBe(true);
  });
});

describe('ABI: no hidden register preservation (documented convention)', () => {
  it('a callee may clobber $t0 without saving — caller must not rely on it', () => {
    const cpu = run(`
      li $t0, 111
      jal f
      li $v0, 10
      syscall
    f:
      li $t0, -123      # legal: $t0 is caller-saved
      jr $ra
    `);
    expect(cpu.registers[8]).toBe(-123); // clobbered — the simulator does NOT fake preservation
  });
});
