import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { assemble } from '../../src/core/assembler';
import { MipsCpu } from '../../src/core/cpu';

const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');

function runFixture(name: string, maxSteps = 500_000): MipsCpu {
  const cpu = new MipsCpu();
  cpu.load(assemble(fixture(name), name));
  cpu.run(maxSteps);
  return cpu;
}

describe('Fixture programs (real .s files from tests/fixtures)', () => {
  it('hello-world.s prints the greeting', () => {
    const cpu = runFixture('hello-world.s');
    expect(cpu.output.join('')).toBe('Hello, World!\n');
    expect(cpu.halted).toBe(true);
  });
  it('array.s sums 8 words to 31 through lw', () => {
    const cpu = runFixture('array.s');
    expect(cpu.output.join('')).toBe('31');
    expect(cpu.registers[10]).toBe(31); // $t2 sum
  });
  it('factorial.s recursive fact(10) = 3628800 with stack restored', () => {
    const cpu = new MipsCpu();
    cpu.load(assemble(fixture('factorial.s'), 'factorial.s'));
    const sp0 = cpu.registers[29];
    cpu.run(500_000);
    expect(cpu.output.join('')).toBe('3628800');
    expect(cpu.registers[29]).toBe(sp0);
  });
  it('fibonacci.s recursive fib(10) = 55 with stack restored', () => {
    const cpu = new MipsCpu();
    cpu.load(assemble(fixture('fibonacci.s'), 'fibonacci.s'));
    const sp0 = cpu.registers[29];
    cpu.run(500_000);
    expect(cpu.output.join('')).toBe('55');
    expect(cpu.registers[29]).toBe(sp0);
    expect(cpu.halted).toBe(true);
  });
  it('integer-input.s pauses for syscall 5 and squares the entered value', () => {
    const cpu = new MipsCpu();
    cpu.load(assemble(fixture('integer-input.s'), 'integer-input.s'));
    const first = cpu.runChunk(100_000);
    expect(first.pausedForInput).toBe(true);
    expect(cpu.output.join('')).toBe('n = ');
    cpu.provideInput(7);
    cpu.runChunk(100_000);
    expect(cpu.halted).toBe(true);
    expect(cpu.output.join('')).toBe('n = n^2 = 49');
  });
  it('integer-input.s supports negative input', () => {
    const cpu = new MipsCpu();
    cpu.load(assemble(fixture('integer-input.s'), 'integer-input.s'));
    cpu.runChunk(100_000);
    cpu.provideInput(-9);
    cpu.runChunk(100_000);
    expect(cpu.output.join('')).toBe('n = n^2 = 81');
  });
  it('assembly errors in fixtures report filename and line (atomic)', () => {
    const bad = '# broken\nli $t0, 5\nadd $t0, 7, $t1\n';
    expect(() => assemble(bad, 'broken.s')).toThrow(/broken\.s/);
    expect(() => assemble(bad, 'broken.s')).toThrow(/Line 3/);
  });
});
