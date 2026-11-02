import { describe, expect, it } from 'vitest';
import { assemble } from '../src/core/assembler';
import { MipsCpu } from '../src/core/cpu';
import {
  assembleWithDiagnostics,
  runtimeDiagnostic,
  executionLimitDiagnostic,
  invalidInputDiagnostic,
  analyzeSource,
  countDiagnostics,
  summarize,
  applyQuickFix,
  planQuickFix,
  genericDiagnostic,
  type Diagnostic,
} from '../src/diagnostics';

function asmFail(src: string, file?: string): { d: Diagnostic; errorMessage?: string } {
  const r = assembleWithDiagnostics(src, file);
  expect(r.ok).toBe(false);
  expect(r.diagnostics).toHaveLength(1);
  return { d: r.diagnostics[0], errorMessage: r.errorMessage };
}

function runFail(src: string): { d: Diagnostic; cpu: MipsCpu } {
  const cpu = new MipsCpu();
  cpu.load(assemble(src));
  try {
    cpu.run();
  } catch (e) {
    return { d: runtimeDiagnostic(e, cpu, src), cpu };
  }
  throw new Error('expected a runtime failure');
}

const stub = (severity: Diagnostic['severity']): Diagnostic => ({
  id: `stub-${severity}`,
  code: 'GEN001',
  severity,
  phase: 'system',
  title: 't',
  message: 'm',
  explanation: 'e',
});

describe('Assembly diagnostics: instructions and operands', () => {
  it('1. unknown instruction maps to INS001 with line, column and explanation', () => {
    const { d } = asmFail('nonsense $t0');
    expect(d.code).toBe('INS001');
    expect(d.severity).toBe('error');
    expect(d.phase).toBe('instruction');
    expect(d.line).toBe(1);
    expect(d.column).toBe(1);
    expect(d.message).toContain("unsupported instruction 'nonsense'");
    expect(d.explanation.length).toBeGreaterThan(40);
  });

  it('does not claim a valid-but-unimplemented MIPS32 instruction is invalid', () => {
    const { d } = asmFail('beql $t0, $t1, x\nx: nop');
    expect(d.code).toBe('INS001');
    expect(d.suggestion).toMatch(/valid MIPS32 instruction/);
    expect(d.suggestion).toMatch(/does not implement/);
    expect(d.suggestion).not.toMatch(/invalid MIPS32/);
  });

  it('suggests a close instruction match and offers it as a quick fix', () => {
    const src = 'lwz $t0, 0($sp)';
    const { d } = asmFail(src);
    expect(d.code).toBe('INS001');
    expect(d.suggestion).toBe('Did you mean `lw`?');
    expect(d.quickFix).toBeDefined();
    expect(applyQuickFix(src, d.quickFix!)).toBe('lw $t0, 0($sp)');
  });

  it('omits did-you-mean when the typo is genuinely ambiguous', () => {
    const { d } = asmFail('addd $t0, $t1, $t2');
    expect(d.code).toBe('INS001');
    expect(d.suggestion ?? '').not.toMatch(/Did you mean/);
    expect(d.quickFix).toBeUndefined();
  });

  it('2. missing operand maps to INS002 with expected info', () => {
    const { d } = asmFail('add $t0, $t1');
    expect(d.code).toBe('INS002');
    expect(d.line).toBe(1);
    expect(d.column).toBe(1);
    expect(d.expected?.length).toBeGreaterThan(0);
  });

  it('separates missing-comma from wrong-arity and fixes it', () => {
    const src = 'add $t0 $t1 $t2';
    const { d } = asmFail(src);
    expect(d.code).toBe('LEX003');
    expect(d.column).toBe(5);
    expect(d.quickFix).toBeDefined();
    expect(applyQuickFix(src, d.quickFix!)).toBe('add $t0, $t1, $t2');
    expect(applyQuickFix('nop', d.quickFix!)).toBeNull();
    expect(planQuickFix('nop', d.quickFix!)).toBeNull();
  });

  it('3. invalid registers map to REG001/REG002/REG003', () => {
    expect(asmFail('add $t0, $zzz, $t1').d.code).toBe('REG001');
    expect(asmFail('add $t0, $32, $t1').d.code).toBe('REG003');
    const bare = asmFail('add result, $t1, $t2').d;
    expect(bare.code).toBe('REG002');
    expect(bare.column).toBe(5);
  });

  it('fixes a missing $ when the name is unambiguous', () => {
    const src = 'add t0, $t1, $t2';
    const { d } = asmFail(src);
    expect(d.code).toBe('REG002');
    expect(d.suggestion).toContain('$t0');
    expect(applyQuickFix(src, d.quickFix!)).toBe('add $t0, $t1, $t2');
  });

  it('4. immediate out of range maps to INS004 with the allowed range', () => {
    const { d } = asmFail('ori $t0, $t1, 70000');
    expect(d.code).toBe('INS004');
    expect(d.expected?.join(' ')).toContain('-32768..65535');
    expect(d.actual).toBe('70000');
  });

  it('5. shift amount out of range maps to INS005', () => {
    const { d } = asmFail('sll $t0, $t1, 32');
    expect(d.code).toBe('INS005');
    expect(d.expected?.join(' ')).toContain('0..31');
  });
});

describe('Assembly diagnostics: labels and directives', () => {
  it('6. undefined label maps to LBL001 at the operand', () => {
    const { d } = asmFail('beq $t0, $t1, nowhere');
    expect(d.code).toBe('LBL001');
    expect(d.line).toBe(1);
    expect(d.column).toBe(15);
  });

  it('suggests a close label definition and can replace it', () => {
    const src = 'loop_start: nop\nbeq $t0, $t1, loop_startt';
    const { d } = asmFail(src);
    expect(d.code).toBe('LBL001');
    expect(d.suggestion).toBe('Did you mean `loop_start`?');
    expect(applyQuickFix(src, d.quickFix!)).toContain('beq $t0, $t1, loop_start');
  });

  it('duplicate label maps to LBL002', () => {
    expect(asmFail('a: nop\nnop\na: nop').d.code).toBe('LBL002');
  });

  it('jump/branch target shape errors map to LBL004/005/006', () => {
    expect(asmFail('j 0x00400002').d.code).toBe('LBL004');
    expect(asmFail('j 0x10000000').d.code).toBe('LBL005');
    expect(asmFail('.text\nbeq $t0, $t1, far\n.data\nfar: .word 0').d.code).toBe('LBL006');
  });

  it('7. invalid directive maps to DIR001 with did-you-mean + fix', () => {
    const src = '.wrod 5';
    const { d } = asmFail(src);
    expect(d.code).toBe('DIR001');
    expect(d.suggestion).toBe('Did you mean `.word`?');
    expect(applyQuickFix(src, d.quickFix!)).toBe('.word 5');
  });

  it('section mistakes map to DIR004', () => {
    expect(asmFail('.word 42').d.code).toBe('DIR004');
    expect(asmFail('.data\nadd $t0, $t1, $t2').d.code).toBe('DIR004');
  });
});

describe('Runtime diagnostics', () => {
  it('8. unaligned word access maps to MEM001 with line and address', () => {
    const src = 'li $t0, 7\nsw $t0, 1($sp)';
    const { d } = runFail(src);
    expect(d.code).toBe('MEM001');
    expect(d.severity).toBe('error');
    expect(d.line).toBe(2);
    expect(d.actual).toMatch(/^0x7ffffff[dc]$/);
    expect(d.context?.some((c) => c.label === 'PC')).toBe(true);
    expect(d.message).toContain('Unaligned word access');
  });

  it('9. null-page access maps to MEM003 with base-register context', () => {
    const src = 'li $t0, 0\nlw $t1, 0($t0)';
    const { d } = runFail(src);
    expect(d.code).toBe('MEM003');
    expect(d.line).toBe(2);
    const ctx = d.context ?? [];
    expect(ctx.find((c) => c.label === '$t0')?.value).toContain('0 (0x00000000)');
    expect(ctx.find((c) => c.label === 'Effective address')?.value).toBe('0x00000000');
  });

  it('10. division by zero maps to RT001 with operand register values', () => {
    const src = 'li $t0, 4\nli $t1, 0\ndiv $t0, $t1';
    const { d } = runFail(src);
    expect(d.code).toBe('RT001');
    expect(d.severity).toBe('error');
    expect(d.line).toBe(3);
    expect(d.message).toContain('division by zero');
    expect(d.relatedInformation?.[0].message).toBe('Executing: div $t0, $t1');
    const ctx = d.context ?? [];
    expect(ctx.find((c) => c.label === '$t0')?.value).toContain('4 (0x00000004)');
    expect(ctx.find((c) => c.label === '$t1')?.value).toContain('0 (0x00000000)');
  });

  it('11. unsupported syscall maps to SYS001 with $v0 context', () => {
    const src = 'li $v0, 99\nsyscall';
    const { d } = runFail(src);
    expect(d.code).toBe('SYS001');
    expect(d.line).toBe(2);
    expect(d.actual).toBe('99');
    expect(d.context?.find((c) => c.label === '$v0')?.value).toContain('99 (0x00000063)');
    expect(d.suggestion).toContain('syscall 10');
  });

  it('syscall 4 with an unterminated string maps to SYS002', () => {
    const src = [
      '.data',
      'buf: .space 5000',
      '.text',
      'la $t0, buf',
      'li $t1, 0',
      'li $t2, 65',
      'li $t3, 5000',
      'loop: add $t4, $t0, $t1',
      'sb $t2, 0($t4)',
      'addi $t1, $t1, 1',
      'bne $t1, $t3, loop',
      'la $a0, buf',
      'li $v0, 4',
      'syscall',
    ].join('\n');
    const { d } = runFail(src);
    expect(d.code).toBe('SYS002');
    expect(d.line).toBe(14);
    expect(d.context?.find((c) => c.label === '$a0')?.value).toContain('0x10010000');
  });

  it('negative read-string buffer size maps to SYS003', () => {
    const src = '.data\nbuf: .space 8\n.text\nli $v0, 8\nla $a0, buf\nli $a1, -1\nsyscall\nli $v0, 10\nsyscall';
    const cpu = new MipsCpu();
    cpu.load(assemble(src));
    cpu.run();
    expect(cpu.inputPending?.kind).toBe('string');
    cpu.provideInput('hi');
    let err: unknown;
    try {
      cpu.step();
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    const d = runtimeDiagnostic(err, cpu, src);
    expect(d.code).toBe('SYS003');
    expect(d.line).toBe(7);
    expect(d.actual).toBe('-1');
  });

  it('12. invalid interactive input maps to SYS004 with actual and expected', () => {
    const src = '.text\nli $v0, 5\nsyscall';
    const cpu = new MipsCpu();
    cpu.load(assemble(src));
    cpu.run();
    expect(cpu.inputPending?.kind).toBe('int');
    const d = invalidInputDiagnostic('int', 'abc', cpu, src, 'main.s');
    expect(d.code).toBe('SYS004');
    expect(d.severity).toBe('error');
    expect(d.file).toBe('main.s');
    expect(d.line).toBe(3);
    expect(d.actual).toBe('abc');
    expect(d.expected?.join(' ')).toContain('-2147483648..2147483647');
    expect(d.context?.find((c) => c.label === 'Syscall')?.value).toBe('5 (read int)');
  });

  it('execution budget maps to RT002 with PC and steps context', () => {
    const src = 'loop: j loop';
    const cpu = new MipsCpu();
    cpu.load(assemble(src));
    cpu.runChunk(50);
    const d = executionLimitDiagnostic(cpu, 50, src);
    expect(d.code).toBe('RT002');
    expect(d.line).toBe(1);
    expect(d.context?.find((c) => c.label === 'Steps')?.value).toBe('50');
    expect(d.context?.find((c) => c.label === 'PC')?.value).toBe('0x00400000');
  });
});

describe('Diagnostic lifecycle, analysis and summaries', () => {
  it('13. filename and original message are preserved on assembly failure', () => {
    const { d, errorMessage } = asmFail('nonsense $t0', 'prog.s');
    expect(d.file).toBe('prog.s');
    expect(errorMessage).toBe('prog.s: Line 1: unsupported instruction \'nonsense\'');
  });

  it('14. a successful assembly clears errors and yields no error diagnostics', () => {
    const bad = assembleWithDiagnostics('nonsense $t0');
    expect(bad.ok).toBe(false);
    expect(countDiagnostics(bad.diagnostics).errors).toBe(1);
    const good = assembleWithDiagnostics('li $t0, 1\nadd $t1, $t0, $t0');
    expect(good.ok).toBe(true);
    expect(countDiagnostics(good.diagnostics).errors).toBe(0);
    expect(good.program).toBeDefined();
    expect(good.errorMessage).toBeUndefined();
  });

  it('source analysis reports warning/info/hint severities at real positions', () => {
    const unused = analyzeSource('used: nop\nbne $t0, $t1, used\nunused_label: nop');
    const warn = unused.find((d) => d.code === 'WRN001');
    expect(warn?.severity).toBe('warning');
    expect(warn?.line).toBe(3);
    expect(warn?.column).toBe(1);
    expect(unused.filter((d) => d.code === 'WRN001')).toHaveLength(1);

    const glob = analyzeSource('.globl main\nmain:\nnop');
    const info = glob.find((d) => d.code === 'INF001');
    expect(info?.severity).toBe('info');
    expect(info?.line).toBe(1);
    expect(glob.some((d) => d.code === 'WRN001')).toBe(false);

    const k = analyzeSource('nop\nmove $k0, $t0');
    const hint = k.find((d) => d.code === 'HNT001');
    expect(hint?.severity).toBe('hint');
    expect(hint?.line).toBe(2);
    expect(hint?.column).toBe(6);
  });

  it('15. summarize counts severities deterministically', () => {
    expect(summarize([stub('error'), stub('error'), stub('warning')])).toBe('2 Errors · 1 Warning');
    expect(summarize([stub('hint')])).toBe('1 Hint');
    expect(summarize([stub('info'), stub('info')])).toBe('2 Infos');
    expect(summarize([])).toBe('No issues');
    expect(countDiagnostics([stub('error'), stub('warning'), stub('info'), stub('hint')])).toEqual({
      errors: 1,
      warnings: 1,
      infos: 1,
      hints: 1,
    });
  });

  it('GEN001 keeps the raw error in technicalDetail but never in the message', () => {
    const d = genericDiagnostic(new Error('internal: stack exploded'), 'prog.s');
    expect(d.code).toBe('GEN001');
    expect(d.severity).toBe('error');
    expect(d.line).toBeUndefined();
    expect(d.message).not.toContain('stack exploded');
    expect(d.technicalDetail).toBe('internal: stack exploded');
    expect(d.explanation.length).toBeGreaterThan(20);
  });

  it('every constructed diagnostic carries code, severity, phase, title and explanation', () => {
    const sources = [
      'nonsense $t0',
      'add $t0',
      'add result, $t1, $t2',
      'ori $t0, $t1, 70000',
      'beq $t0, $t1, nowhere',
      '.frob',
      'j 0x00400002',
    ];
    for (const src of sources) {
      const { d } = asmFail(src);
      expect(d.code).toMatch(/^[A-Z]{3}\d{3}$/);
      expect(['error', 'warning', 'info', 'hint']).toContain(d.severity);
      expect(d.phase.length).toBeGreaterThan(0);
      expect(d.title.length).toBeGreaterThan(0);
      expect(d.explanation.length).toBeGreaterThan(20);
      expect(d.id.length).toBeGreaterThan(0);
    }
  });
});
