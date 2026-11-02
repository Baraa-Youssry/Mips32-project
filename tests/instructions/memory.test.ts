import { describe, expect, it } from 'vitest';
import { assemble, AsmError, DATA_BASE, TEXT_BASE } from '../../src/core/assembler';
import { MipsCpu } from '../../src/core/cpu';
import { execute } from '../helpers';

describe('Loads and stores: lw/sw', () => {
  it('lw loads a .word from the data segment via la', () => {
    const cpu = execute('.data\nval: .word -12345\n.text\nla $t0, val\nlw $t1, 0($t0)');
    expect(cpu.registers[9]).toBe(-12345);
  });
  it('sw then lw round-trips through the stack', () => {
    const cpu = execute('li $t2, 777\nsw $t2, -4($sp)\nlw $t3, -4($sp)');
    expect(cpu.registers[11]).toBe(777);
  });
  it('data segment words are visible in memory entries after load', () => {
    const cpu = new MipsCpu();
    cpu.load(assemble('.data\n.word 42'));
    expect(cpu.memory.entries()).toContainEqual([DATA_BASE, 42]);
  });
  it('lw from a never-written address reads 0', () => {
    const cpu = execute('li $t0, -4\nlw $t1, 0($t0)'); // EA = 0xFFFFFFFC
    expect(cpu.registers[9]).toBe(0);
  });
});

describe('Loads and stores: sign/zero extension and masking', () => {
  it('lb sign-extends, lbu zero-extends', () => {
    const cpu = execute('.data\nb: .byte 0x80\n.text\nla $t0, b\nlb $t1, 0($t0)\nlbu $t2, 0($t0)');
    expect(cpu.registers[9]).toBe(-128);
    expect(cpu.registers[10]).toBe(128);
  });
  it('lh sign-extends, lhu zero-extends', () => {
    const cpu = execute('.data\nh: .half 0x8000\n.text\nla $t0, h\nlh $t1, 0($t0)\nlhu $t2, 0($t0)');
    expect(cpu.registers[9]).toBe(-32768);
    expect(cpu.registers[10]).toBe(32768);
  });
  it('sb stores only the low byte', () => {
    const cpu = execute('li $t0, 511\nla $t1, buf\nsb $t0, 0($t1)\nlbu $t2, 0($t1)\n.data\nbuf: .byte 0\n.text');
    expect(cpu.registers[10]).toBe(0xff);
  });
  it('sh stores only the low halfword', () => {
    const cpu = execute('li $t0, 0x12345\nla $t1, buf\nsh $t0, 0($t1)\nlhu $t2, 0($t1)\n.data\nbuf: .half 0\n.text');
    expect(cpu.registers[10]).toBe(0x2345);
  });
  it('negative base register addresses high memory', () => {
    // $t0 = -4 → EA = 0xFFFFFFFC; storeWord there then read back
    const cpu = execute('li $t0, -4\nli $t1, 0x7f7f\nsw $t1, 0($t0)\nlw $t2, 0($t0)');
    expect(cpu.registers[10]).toBe(0x7f7f);
  });
});

describe('Loads and stores: validation', () => {
  it('unaligned word access faults with line number (assembler accepts, CPU throws)', () => {
    expect(() => execute('.data\nval: .word 1\n.text\nla $t0, val\nlw $t1, 1($t0)'))
      .toThrow(/Line 5: Unaligned word access/);
  });
  it('historical bug: missing $ in memory operand is caught at assemble time', () => {
    // MARS-style error: 'sw $t0, 0(result)' must NOT silently assemble
    expect(() => assemble('sw $t0, 0(result)')).toThrow(/invalid memory operand '0\(result\)'/);
  });
  it('unknown base register in memory operand is rejected', () => {
    expect(() => assemble('lw $t0, 0($nope)')).toThrow(/unknown base register/);
  });
  it('offset outside imm16 range is rejected', () => {
    expect(() => assemble('lw $t0, 70000($t1)')).toThrow(/offset out of range/);
    expect(() => assemble('sw $t0, -40000($t1)')).toThrow(/offset out of range/);
  });
  it('AsmError carries the source line number', () => {
    try { assemble('nop\nlw $t0, 0(result)'); } catch (e) {
      expect(e).toBeInstanceOf(AsmError);
      expect((e as AsmError).line).toBe(2);
    }
  });
});

describe('Program counter and data layout', () => {
  it('PC starts at TEXT_BASE and advances by 4', () => {
    const cpu = new MipsCpu();
    cpu.load(assemble('nop\nnop'));
    expect(cpu.pc).toBe(TEXT_BASE);
    cpu.step();
    expect(cpu.pc).toBe(TEXT_BASE + 4);
    cpu.step();
    expect(cpu.pc).toBe(TEXT_BASE + 8);
    cpu.step(); // fell off end of program
    expect(cpu.halted).toBe(true);
  });
  it('initial ABI registers: $sp and $gp follow project convention', () => {
    const cpu = execute('nop');
    expect(cpu.registers[29]).toBe(0x7ffffffc);
    expect(cpu.registers[28]).toBe(0x10008000);
  });
  it('reset restores PC, data segment, and clears memory writes', () => {
    const cpu = execute('.data\nval: .word 5\n.text\nla $t0, val\nli $t1, 99\nsw $t1, 0($t0)');
    expect(cpu.memory.loadWord(DATA_BASE)).toBe(99);
    cpu.reset();
    expect(cpu.memory.loadWord(DATA_BASE)).toBe(5); // .word restored from program.data
    expect(cpu.pc).toBe(TEXT_BASE);
    expect(cpu.registers[9]).toBe(0); // cleared by reset
  });
});

describe('End-to-end: data segment + la + syscall 4', () => {
  it('prints an asciiz string from .data', () => {
    const cpu = execute('.data\nmsg: .asciiz "Hi"\n.text\nla $a0, msg\nli $v0, 4\nsyscall\nli $v0, 10\nsyscall');
    expect(cpu.output).toEqual(['Hi']);
    expect(cpu.halted).toBe(true);
  });
});
