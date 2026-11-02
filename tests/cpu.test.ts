import { describe, expect, it } from 'vitest';
import { assemble } from '../src/core/assembler';
import { MipsCpu } from '../src/core/cpu';
function execute(code: string) { const cpu = new MipsCpu(); cpu.load(assemble(code)); cpu.run(); return cpu; }
describe('MIPS32 MVP instructions', () => {
  it('add uses 32-bit wraparound', () => { const c=execute('li $t0, 2147483647\nli $t1, 1\nadd $t2, $t0, $t1'); expect(c.registers[10]).toBe(-2147483648); });
  it('addi adds immediate', () => { expect(execute('li $t0, 8\naddi $t1, $t0, -3').registers[9]).toBe(5); });
  it('sub subtracts', () => { expect(execute('li $t0, 8\nli $t1, 3\nsub $t2, $t0, $t1').registers[10]).toBe(5); });
  it('mult writes low and high halves', () => { const c=execute('li $t0, 100000\nli $t1, 100000\nmult $t0, $t1\nmflo $t2'); expect(c.lo).toBe(1410065408); expect(c.hi).toBe(2); expect(c.registers[10]).toBe(c.lo); });
  it('div stores quotient in LO and remainder in HI', () => { const c=execute('li $t0, -17\nli $t1, 5\ndiv $t0, $t1\nmflo $t2'); expect(c.lo).toBe(-3); expect(c.hi).toBe(-2); });
  it('div by zero reports error', () => { const c=new MipsCpu(); c.load(assemble('li $t0, 4\nli $t1, 0\ndiv $t0, $t1')); expect(()=>c.run()).toThrow(/division by zero/); });
  it('mflo copies LO', () => { expect(execute('li $t0, 6\nli $t1, 7\nmult $t0, $t1\nmflo $s0').registers[16]).toBe(42); });
  it('syscall 1 prints integer; syscall 10 exits', () => { const c=execute('li $v0, 1\nli $a0, 42\nsyscall\nli $v0, 10\nsyscall'); expect(c.output.join('')).toBe('42'); expect(c.halted).toBe(true); });
  it('rejects invalid instruction and operand count', () => { expect(()=>assemble('nonsense $t0')).toThrow(/unsupported instruction/); expect(()=>assemble('add $t0, $t1')).toThrow(/expects 3 operand/); });
});
