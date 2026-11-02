import { describe, expect, it } from 'vitest';
import { assemble, DATA_BASE } from '../src/core/assembler';
import { MipsCpu } from '../src/core/cpu';

describe('Syscall 5: interactive integer input', () => {
  it('pauses at the syscall, resumes with the provided value in $v0', () => {
    const cpu = new MipsCpu();
    cpu.load(assemble('li $v0, 5\nsyscall\nmove $t0, $v0\nli $v0, 10\nsyscall'));
    const chunk = cpu.runChunk(1000);
    expect(chunk.pausedForInput).toBe(true);
    expect(cpu.halted).toBe(false);
    expect(cpu.inputPending).toEqual({ kind: 'int' });
    expect(cpu.steps).toBe(1); // li executed; syscall not yet completed
    cpu.provideInput(42);
    expect(cpu.inputPending).toBeNull();
    cpu.runChunk(1000);
    expect(cpu.halted).toBe(true);
    expect(cpu.registers[8]).toBe(42);
  });
  it('supports negative integers', () => {
    const cpu = new MipsCpu();
    cpu.load(assemble('li $v0, 5\nsyscall\nmove $t0, $v0\nli $v0, 10\nsyscall'));
    cpu.runChunk(1000);
    cpu.provideInput(-7);
    cpu.runChunk(1000);
    expect(cpu.registers[8]).toBe(-7);
  });
  it('step() pauses on the syscall without advancing PC or steps', () => {
    const cpu = new MipsCpu();
    cpu.load(assemble('li $v0, 5\nsyscall'));
    cpu.step(); // li
    const pcBefore = cpu.pc;
    cpu.step(); // syscall -> pause
    expect(cpu.inputPending).toEqual({ kind: 'int' });
    expect(cpu.pc).toBe(pcBefore);
    cpu.provideInput(1);
    cpu.step(); // syscall completes
    expect(cpu.registers[2]).toBe(1);
    expect(cpu.inputPending).toBeNull();
  });
  it('run() returns (does not throw) when paused for input', () => {
    const cpu = new MipsCpu();
    cpu.load(assemble('li $v0, 5\nsyscall\nli $v0, 10\nsyscall'));
    const result = cpu.run();
    expect(result.halted).toBe(false);
    expect(cpu.inputPending).toEqual({ kind: 'int' });
  });
});

describe('Syscall 12: read character', () => {
  it('places the character code in $v0', () => {
    const cpu = new MipsCpu();
    cpu.load(assemble('li $v0, 12\nsyscall\nmove $t0, $v0\nli $v0, 10\nsyscall'));
    cpu.runChunk(1000);
    expect(cpu.inputPending).toEqual({ kind: 'char' });
    cpu.provideInput('A');
    cpu.runChunk(1000);
    expect(cpu.registers[8]).toBe(65);
  });
});

describe('Syscall 8: read string into buffer', () => {
  it('writes bytes plus NUL terminator at $a0', () => {
    const cpu = new MipsCpu();
    cpu.load(assemble(`
      .data
      buf: .space 16
      .text
      la $a0, buf
      li $a1, 16
      li $v0, 8
      syscall
      li $v0, 10
      syscall
    `));
    cpu.runChunk(10000);
    expect(cpu.inputPending).toEqual({ kind: 'string' });
    cpu.provideInput('Hi');
    cpu.runChunk(10000);
    expect(cpu.halted).toBe(true);
    expect(cpu.memory.loadByte(DATA_BASE)).toBe('H'.charCodeAt(0));
    expect(cpu.memory.loadByte(DATA_BASE + 1)).toBe('i'.charCodeAt(0));
    expect(cpu.memory.loadByte(DATA_BASE + 2)).toBe(0); // NUL terminator
  });
  it('caps input at $a1 - 1 bytes', () => {
    const cpu = new MipsCpu();
    cpu.load(assemble(`
      .data
      buf: .space 8
      .text
      la $a0, buf
      li $a1, 4
      li $v0, 8
      syscall
      li $v0, 10
      syscall
    `));
    cpu.runChunk(10000);
    cpu.provideInput('ABCDEFGH');
    cpu.runChunk(10000);
    expect(cpu.memory.loadByte(DATA_BASE)).toBe('A'.charCodeAt(0));
    expect(cpu.memory.loadByte(DATA_BASE + 2)).toBe('C'.charCodeAt(0));
    expect(cpu.memory.loadByte(DATA_BASE + 3)).toBe(0); // capped at 3 chars + NUL
  });
});

describe('Syscall robustness', () => {
  it('unsupported syscall codes throw with the code in the message', () => {
    const cpu = new MipsCpu();
    cpu.load(assemble('li $v0, 99\nsyscall'));
    cpu.step(); // li
    expect(() => cpu.step()).toThrow(/Unsupported MARS syscall code 99/);
  });
  it('runtime errors carry the source line', () => {
    const cpu = new MipsCpu();
    cpu.load(assemble('nop\nli $v0, 99\nsyscall'));
    cpu.step(); // nop
    cpu.step(); // li
    expect(() => cpu.step()).toThrow(/Line 3: Unsupported MARS syscall code 99/);
  });
});
