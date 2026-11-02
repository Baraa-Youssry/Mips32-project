import { describe, expect, it } from 'vitest';
import { assemble, AsmError, DATA_BASE, TEXT_BASE } from '../src/core/assembler';
import { execute } from './helpers';

describe('assembler: structure and errors', () => {
  it('rejects unsupported instructions with line number', () => {
    expect(() => assemble('nonsense $t0')).toThrow(/Line 1: unsupported instruction 'nonsense'/);
  });
  it('rejects wrong operand counts', () => {
    expect(() => assemble('add $t0, $t1')).toThrow(/expects 3 operand/);
  });
  it('reports invalid registers at ASSEMBLE time with the operand role', () => {
    expect(() => assemble('add result, $t1, $t2')).toThrow(/Line 1: rd: expected register, got 'result'/);
    // historical bug shape: sw $t0, 0(result) — label used where register belongs
    expect(() => assemble('ori $t0, 0(result), 4')).toThrow(/expected register, got '0\(result\)'/);
  });
  it('rejects duplicate labels with both line numbers implied', () => {
    expect(() => assemble('a:\nnop\na:\nnop')).toThrow(/Line 3: duplicate label 'a'/);
  });
  it('rejects out-of-range shift amounts', () => {
    expect(() => assemble('sll $t0, $t1, 32')).toThrow(/Line 1: shift amount out of range/);
  });
  it('rejects out-of-range immediates', () => {
    expect(() => assemble('ori $t0, $t1, 70000')).toThrow(/Line 1: immediate out of range/);
    expect(() => assemble('addiu $t0, $t1, -32769')).toThrow(/Line 1: immediate out of range/);
  });
  it('rejects unknown directives instead of silently skipping', () => {
    expect(() => assemble('.frob')).toThrow(/Line 1: unknown directive '.frob'/);
  });
  it('rejects instructions inside .data', () => {
    expect(() => assemble('.data\nadd $t0, $t1, $t2')).toThrow(/Line 2: instruction not allowed in .data/);
  });
  it('rejects data directives inside .text', () => {
    expect(() => assemble('.word 42')).toThrow(/Line 1: .word is only allowed in the .data section/);
  });
  it('treats # inside strings as content, not comments', () => {
    const p = assemble('.data\n.asciiz "a#b"');
    expect(Array.from(p.data)).toEqual([97, 35, 98, 0]);
  });
});

describe('assembler: labels and addresses', () => {
  it('text labels resolve to byte addresses from TEXT_BASE', () => {
    const p = assemble('nop\nstart: nop\nnop');
    expect(p.labels.get('start')).toBe(TEXT_BASE + 4);
  });
  it('text label accounts for pseudo expansion (li large = 2 instructions)', () => {
    const p = assemble('li $t0, 0x12345678\nend: nop');
    expect(p.labels.get('end')).toBe(TEXT_BASE + 2 * 4);
  });
  it('data labels resolve to byte addresses from DATA_BASE', () => {
    const p = assemble('.data\nvals: .word 1, 2, 3\nnext: .word 4');
    expect(p.labels.get('vals')).toBe(DATA_BASE);
    expect(p.labels.get('next')).toBe(DATA_BASE + 12);
  });
  it('multiple labels may share a line', () => {
    const p = assemble('a: b: nop');
    expect(p.labels.get('a')).toBe(TEXT_BASE);
    expect(p.labels.get('b')).toBe(TEXT_BASE);
  });
});

describe('assembler: directives emit data bytes', () => {
  it('.word emits little-endian 32-bit words', () => {
    const p = assemble('.data\n.word 0xdeadbeef, -1');
    expect(Array.from(p.data)).toEqual([0xef, 0xbe, 0xad, 0xde, 0xff, 0xff, 0xff, 0xff]);
  });
  it('.byte and .half emit correctly', () => {
    const p = assemble('.data\n.byte 1, -1, 255\n.half 0x1234');
    expect(Array.from(p.data)).toEqual([1, 255, 255, 0x34, 0x12]);
  });
  it('.ascii and .asciiz with escapes', () => {
    const p = assemble('.data\n.ascii "A\\n"\n.asciiz "B\\tC"');
    expect(Array.from(p.data)).toEqual([65, 10, 66, 9, 67, 0]);
  });
  it('.space pads zeros and .align pads to boundary', () => {
    const p = assemble('.data\n.byte 1\n.align 2\n.space 2\nx: .byte 9');
    // [1] + align-to-4 pad [0,0,0] + space [0,0] + [9] = 7 bytes; x at offset 6
    expect(p.labels.get('x')).toBe(DATA_BASE + 6);
    expect(Array.from(p.data)).toEqual([1, 0, 0, 0, 0, 0, 9]);
  });
  it('.word with a label writes its resolved address (LE)', () => {
    const p = assemble('.data\nptr: .word target\ntarget: .word 7');
    const addr = DATA_BASE + 4;
    expect(Array.from(p.data.slice(0, 4))).toEqual([addr & 0xff, (addr >>> 8) & 0xff, (addr >>> 16) & 0xff, (addr >>> 24) & 0xff]);
    expect(Array.from(p.data.slice(4))).toEqual([7, 0, 0, 0]);
  });
  it('undefined label in .word reports the source line', () => {
    expect(() => assemble('.data\n.word missing')).toThrow(/Line 2: undefined label 'missing'/);
  });
});

describe('assembler: pseudoinstruction expansion', () => {
  it('li small negative → addiu', () => {
    const p = assemble('li $t0, -5');
    expect(p.instructions).toHaveLength(1);
    expect(p.instructions[0]).toMatchObject({ op: 'addiu', args: ['$t0', '$zero', '-5'] });
  });
  it('li small positive 0..65535 → ori', () => {
    const p = assemble('li $t0, 65535');
    expect(p.instructions[0]).toMatchObject({ op: 'ori', args: ['$t0', '$zero', '65535'] });
  });
  it('li large constant → lui + ori halves', () => {
    const p = assemble('li $t0, 0xdeadbeef');
    expect(p.instructions).toHaveLength(2);
    expect(p.instructions[0]).toMatchObject({ op: 'lui', args: ['$t0', '57005'] });
    expect(p.instructions[1]).toMatchObject({ op: 'ori', args: ['$t0', '$t0', '48879'] });
  });
  it('li rejects out-of-range constants', () => {
    expect(() => assemble('li $t0, 4294967296')).toThrow(/li constant out of range/);
  });
  it('la expands to lui + ori with resolved label address halves', () => {
    const p = assemble('la $t1, msg\nnop\n.data\nmsg: .asciiz "hi"');
    expect(p.instructions).toHaveLength(3); // 2 for la + nop
    const addr = DATA_BASE;
    expect(p.instructions[0]).toMatchObject({ op: 'lui', args: ['$t1', String((addr >>> 16) & 0xffff)] });
    expect(p.instructions[1]).toMatchObject({ op: 'ori', args: ['$t1', '$t1', String(addr & 0xffff)] });
  });
  it('la with undefined label fails at assemble time', () => {
    expect(() => assemble('la $t1, nope')).toThrow(/Line 1: undefined label 'nope'/);
  });
  it('move → addu rd, rs, $zero', () => {
    expect(assemble('move $t0, $t1').instructions[0]).toMatchObject({ op: 'addu', args: ['$t0', '$t1', '$zero'] });
  });
  it('not → nor rd, rs, $zero', () => {
    expect(assemble('not $t0, $t1').instructions[0]).toMatchObject({ op: 'nor', args: ['$t0', '$t1', '$zero'] });
  });
  it('neg → subu rd, $zero, rs', () => {
    expect(assemble('neg $t0, $t1').instructions[0]).toMatchObject({ op: 'subu', args: ['$t0', '$zero', '$t1'] });
  });
  it('nop → sll $zero, $zero, 0', () => {
    expect(assemble('nop').instructions[0]).toMatchObject({ op: 'sll', args: ['$zero', '$zero', '0'] });
  });
  it('expanded instructions keep the source line number', () => {
    const p = assemble('nop\nli $t0, 0x12345678');
    expect(p.instructions[1].line).toBe(2);
    expect(p.instructions[2].line).toBe(2);
  });
});

describe('assembler: end-to-end programs still execute', () => {
  it('MVP arithmetic demo still works through expansion', () => {
    const c = execute('.text\nli $t0, 20\nli $t1, 5\nadd $t2, $t0, $t1\nmflo $t4');
    expect(c.registers[10]).toBe(25);
  });
  it('lui+ori constant building via li works at runtime', () => {
    const c = execute('li $t0, 0x12345678');
    expect(c.registers[8] >>> 0).toBe(0x12345678);
  });
  it('not/neg/move work at runtime', () => {
    const c = execute('li $t0, 5\nnot $t1, $t0\nneg $t2, $t0\nmove $t3, $t0');
    expect(c.registers[9]).toBe(-6);
    expect(c.registers[10]).toBe(-5);
    expect(c.registers[11]).toBe(5);
  });
  it('labels do not affect execution ordering', () => {
    const c = execute('li $t0, 1\nloop: addi $t0, $t0, 1\nli $t1, 4\nbeq_placeholder: nop');
    expect(c.registers[8]).toBe(2);
  });
});

describe('AsmError', () => {
  it('carries a numeric line and Line-prefixed message', () => {
    try {
      assemble('nop\nbogus $t0');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(AsmError);
      expect((e as AsmError).line).toBe(2);
      expect((e as AsmError).message).toMatch(/^Line 2: /);
    }
  });
});
