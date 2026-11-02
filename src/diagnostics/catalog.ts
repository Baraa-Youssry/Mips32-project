import type { DiagnosticPhase, DiagnosticSeverity } from './types';

export interface CatalogEntry {
  phase: DiagnosticPhase;
  severity: DiagnosticSeverity;
  title: string;
  explanation: string;
  suggestion?: string;
  example?: { before?: string; after?: string };
}

export const KNOWN_MIPS32_NOT_IMPLEMENTED: Record<string, string> = {
  beql: 'branch-likely if equal',
  bnel: 'branch-likely if not equal',
  bltzal: 'branch-and-link if less than zero',
  bgezal: 'branch-and-link if greater than or equal to zero',
  clz: 'count leading zeros (MIPS32 R2)',
  clo: 'count leading ones (MIPS32 R2)',
  ext: 'extract bitfield (MIPS32 R2)',
  ins: 'insert bitfield (MIPS32 R2)',
  seb: 'sign-extend byte (MIPS32 R2)',
  seh: 'sign-extend halfword (MIPS32 R2)',
  wsbh: 'swap bytes within halfwords (MIPS32 R2)',
  rotr: 'rotate right (MIPS32 R2)',
  rori: 'rotate right immediate (MIPS32 R2)',
  madd: 'multiply-add into HI/LO (MIPS32 R2)',
  maddu: 'unsigned multiply-add into HI/LO (MIPS32 R2)',
  msub: 'multiply-subtract into HI/LO (MIPS32 R2)',
  msubu: 'unsigned multiply-subtract into HI/LO (MIPS32 R2)',
  break: 'breakpoint trap',
  teq: 'trap if equal',
  tne: 'trap if not equal',
  tge: 'trap if greater or equal',
  tlt: 'trap if less than',
  mfc0: 'move from coprocessor 0 (system control)',
  mtc0: 'move to coprocessor 0 (system control)',
  mfc1: 'move from floating-point coprocessor',
  mtc1: 'move to floating-point coprocessor',
  eret: 'return from exception (COP0)',
  'add.s': 'single-precision floating-point add',
  'sub.s': 'single-precision floating-point subtract',
  'mul.s': 'single-precision floating-point multiply',
  'div.s': 'single-precision floating-point divide',
  'mov.s': 'single-precision floating-point move',
  'neg.s': 'single-precision floating-point negate',
  'abs.s': 'single-precision floating-point absolute value',
  'cvt.w.s': 'convert float to integer',
  lwc1: 'load word to floating-point register',
  swc1: 'store word from floating-point register',
  ldc1: 'load doubleword to floating-point register',
  sdc1: 'store doubleword from floating-point register',
};

export const CATALOG: Record<string, CatalogEntry> = {
  LEX001: {
    phase: 'lexer',
    severity: 'error',
    title: 'Unterminated string literal',
    explanation:
      'String literals must open and close with a double quote on the same line. The assembler found a quote that never closes, so it cannot tell where the text ends. A # inside a string is literal text, not a comment.',
    suggestion: 'Add the missing closing " (and check for an unescaped quote earlier in the string).',
  },
  LEX002: {
    phase: 'lexer',
    severity: 'error',
    title: 'Unknown escape sequence',
    explanation:
      'Inside strings the assembler understands only \\n, \\t, \\r, \\0, \\b, \\f, \\\\, \\" and \\\'. Any other backslash sequence is rejected because its meaning would be ambiguous.',
    suggestion: 'Escape the backslash as \\\\ or rewrite the text without it.',
    example: { before: '.asciiz "C:\\new"', after: '.asciiz "C:\\\\new"' },
  },
  LEX003: {
    phase: 'lexer',
    severity: 'error',
    title: 'Missing comma between operands',
    explanation:
      'MIPS operands are separated with commas: add $t0, $t1, $t2. The operands here are separated by spaces only, so the assembler sees the wrong number of operands for the instruction.',
    suggestion: 'Separate each operand with a comma.',
    example: { before: 'add $t0 $t1 $t2', after: 'add $t0, $t1, $t2' },
  },
  LEX004: {
    phase: 'lexer',
    severity: 'error',
    title: 'Cannot parse instruction',
    explanation:
      'A code line must begin with an instruction name (letters, digits, _ or .). This line begins with a character that cannot start an instruction, such as an operator, a bracket or a stray symbol.',
    suggestion: 'Check the start of the line for a typo or a leftover character.',
  },
  LEX005: {
    phase: 'lexer',
    severity: 'error',
    title: 'Cannot parse directive',
    explanation:
      'Directive names start with a dot followed by letters or digits (for example .text, .word). This line starts with a dot but what follows is not a valid directive name.',
    suggestion: 'Correct the directive name, e.g. .word instead of .wrod.',
  },
  INS001: {
    phase: 'instruction',
    severity: 'error',
    title: 'Unknown instruction',
    explanation:
      'The assembler does not recognize this mnemonic. It may be a misspelling, or it may be a real MIPS32 instruction that this IDE does not implement — this IDE runs an integer subset of MIPS32 (no floating point, no COP0, no branch-likely forms). A word this IDE does not know is not necessarily invalid MIPS32.',
    suggestion: 'Check the spelling, or pick a supported instruction / pseudo-instruction (li, la, move, blt …).',
  },
  INS002: {
    phase: 'instruction',
    severity: 'error',
    title: 'Incorrect number of operands',
    explanation:
      'Every instruction expects a fixed number of operands (add takes exactly 3: rd, rs, rt; lw takes 2: rt, offset(base)). This instruction was given a different number. Also check for missing commas — operands separated only by spaces can look like fewer operands.',
  },
  INS003: {
    phase: 'instruction',
    severity: 'error',
    title: 'Invalid operand — expected an integer',
    explanation:
      'This operand must be a whole number: optional sign, decimal digits, or 0x hex. Fractions, text and empty values cannot be encoded into an instruction field.',
  },
  INS004: {
    phase: 'instruction',
    severity: 'error',
    title: 'Immediate value out of range',
    explanation:
      '16-bit immediate fields hold -32768..65535 (-32768..32767 where the field is signed). Larger constants are built with li (which expands to lui + ori) or loaded from memory.',
    suggestion: 'Use a value in the listed range, or load large constants with li.',
  },
  INS005: {
    phase: 'instruction',
    severity: 'error',
    title: 'Shift amount out of range',
    explanation:
      'The shift-amount field of sll/srl/sra is 5 bits: 0..31. Shifting by 32 or more cannot be encoded by these instructions.',
    suggestion: 'Clamp the shift to 0..31, or multiply/divide by powers of two with li + mult.',
  },
  INS006: {
    phase: 'instruction',
    severity: 'error',
    title: 'Invalid memory operand',
    explanation:
      'Memory operands have the form offset($register), for example 4($sp) or 0($t1): a 16-bit offset, parentheses and a $-prefixed base register. Bare labels are also accepted for loads/stores (MARS style, e.g. lw $t0, count).',
    suggestion: 'Write the operand as offset($register), e.g. 0($t0).',
    example: { before: 'lw $t0, 0(result)', after: 'lw $t0, 0($t0)' },
  },
  REG001: {
    phase: 'instruction',
    severity: 'error',
    title: 'Unknown register',
    explanation:
      'The $-name does not match a hardware register. Valid names are $zero, $at, $v0-$v1, $a0-$a3, $t0-$t9, $s0-$s7, $k0-$k1, $gp, $sp, $fp, $ra, or the numbers $0-$31. $hi, $lo and $pc are not usable as general operands.',
  },
  REG002: {
    phase: 'instruction',
    severity: 'error',
    title: 'Invalid register syntax',
    explanation:
      'Register operands must start with $. Without the $ the assembler reads the token as a label or a number, which cannot be a register.',
    example: { before: 'add $t0, t1, $t2', after: 'add $t0, $t1, $t2' },
  },
  REG003: {
    phase: 'instruction',
    severity: 'error',
    title: 'Register number out of range',
    explanation:
      'Numeric register operands are $0 through $31 only — the hardware register field is 5 bits wide.',
  },
  LBL001: {
    phase: 'assembler',
    severity: 'error',
    title: 'Undefined label',
    explanation:
      'A branch, jump, la or data reference names a label that is not defined anywhere in this file. Labels are defined as name: at the start of a line. This IDE assembles a single file — there is no linker, so external labels do not exist.',
  },
  LBL002: {
    phase: 'assembler',
    severity: 'error',
    title: 'Duplicate label',
    explanation:
      'Each label must be unique in a file: with two definitions of the same name the assembler cannot decide which address a reference means.',
    suggestion: 'Rename one of the definitions.',
  },
  LBL003: {
    phase: 'instruction',
    severity: 'error',
    title: 'Expected a label',
    explanation:
      'la loads the ADDRESS of a label (la $t1, msg), so the second operand must be a label name (an identifier), not a number or a register.',
  },
  LBL004: {
    phase: 'assembler',
    severity: 'error',
    title: 'Jump target not word-aligned',
    explanation:
      'j and jal replace the low 28 bits of the PC with (target & 0x0FFFFFFC). Targets must therefore be multiples of 4 — the address of an instruction (each instruction is 4 bytes).',
    suggestion: 'Jump to a label or to an address divisible by 4.',
  },
  LBL005: {
    phase: 'assembler',
    severity: 'error',
    title: 'Jump target out of range',
    explanation:
      'j/jal can reach anywhere in the same 256 MB region (the top 4 bits are shared with PC+4). Code outside that region needs an indirect jump through a register.',
    suggestion: 'Load the address with la into a register and jump with jr, or keep code inside the text segment.',
  },
  LBL006: {
    phase: 'assembler',
    severity: 'error',
    title: 'Branch target out of range',
    explanation:
      'Conditional branches use a signed 16-bit word offset: -32768..32767 instructions (±128 KB) from PC+4. A target further away cannot be encoded.',
    suggestion:
      'Invert the branch and jump over an unconditional j, or restructure the code so loops stay within range.',
    example: { before: 'beq $t0, $t1, far_away', after: 'bne $t0, $t1, skip\nj far_away\nskip:' },
  },
  DIR001: {
    phase: 'parser',
    severity: 'error',
    title: 'Unknown directive',
    explanation:
      'The assembler accepts .text, .data, .globl/.global, .word, .byte, .half, .ascii, .asciiz, .space and .align. Unknown directives are rejected so typos are not silently ignored.',
  },
  DIR002: {
    phase: 'parser',
    severity: 'error',
    title: 'Directive expects values',
    explanation: 'The directive requires at least one operand, for example .word 1, 2 or .asciiz "hello".',
  },
  DIR003: {
    phase: 'parser',
    severity: 'error',
    title: 'Invalid data constant',
    explanation:
      '.word/.byte/.half accept whole numbers in -2147483648..4294967295, or a label reference (the label’s address is stored). Fractions, quoted strings and other text are not valid here.',
  },
  DIR004: {
    phase: 'parser',
    severity: 'error',
    title: 'Wrong section',
    explanation:
      'Data directives (.word, .byte, .half, .ascii, .asciiz, .space) belong in the .data section; instructions belong in .text. Mixing them would place code in the data segment or data in the code segment, which this assembler refuses to guess.',
    suggestion: 'Move the line under .data (for data) or under .text (for instructions).',
  },
  DIR005: {
    phase: 'parser',
    severity: 'error',
    title: 'Invalid .space or .align argument',
    explanation:
      '.space takes a byte count of 0..1048576. .align takes a boundary exponent 0..4 (alignment = 2^n bytes, so 1..16).',
  },
  MEM001: {
    phase: 'memory',
    severity: 'error',
    title: 'Unaligned word access',
    explanation:
      'lw/sw require addresses that are multiples of 4; a misaligned access would touch bytes that span two words, which real hardware reports as an address error. The faulting access did not modify memory.',
    suggestion: 'Use an offset divisible by 4 (4($sp), 0($t0) …) or align the base address first.',
  },
  MEM002: {
    phase: 'memory',
    severity: 'error',
    title: 'Unaligned halfword access',
    explanation: 'lh/lhu/sh require addresses that are multiples of 2. The faulting access did not modify memory.',
    suggestion: 'Use an even offset (0, 2, 4 …).',
  },
  MEM003: {
    phase: 'memory',
    severity: 'error',
    title: 'Address out of bounds',
    explanation:
      'The effective address falls in the null page (0x00000000–0x00000FFF). That region is never valid user memory — it is where a null pointer points — so the simulator faults instead of silently reading zeros. Outside the null page this IDE’s sparse memory accepts the full 32-bit space (data at 0x10010000, the stack down from 0x7FFFFFFC, and negative bases addressing high memory), so reaching this error almost always means a base register holds 0 or a near-zero value.',
    suggestion:
      'Check the base register’s value — la gives you data addresses, and $sp/$gp are set up for you. A register that was never loaded (0) is the usual cause.',
  },
  MEM004: {
    phase: 'memory',
    severity: 'error',
    title: 'Invalid effective address',
    explanation:
      'The runtime operand parser requires offset($register), for example 0($t1). The operand stored in the instruction does not match that form.',
    suggestion: 'Re-assemble the current source so instructions match the editor again.',
  },
  RT001: {
    phase: 'runtime',
    severity: 'error',
    title: 'Division by zero',
    explanation:
      'div/divu with a zero divisor cannot produce a quotient, so the simulator stops instead of writing a fake value into HI/LO (QtSPIM and MARS report this as a runtime error too).',
    suggestion: 'Test the divisor first (bne $t1, $zero, safe) before dividing.',
  },
  RT002: {
    phase: 'runtime',
    severity: 'error',
    title: 'Execution limit reached',
    explanation:
      'The program exceeded the step budget — almost always a loop whose condition never becomes false. No registers or memory were changed by this error; execution is simply stopped.',
    suggestion:
      'Use Pause/Step to watch the loop condition, and bound the loop with a counter register that forces an exit.',
  },
  RT003: {
    phase: 'runtime',
    severity: 'error',
    title: 'Unsupported instruction at runtime',
    explanation:
      'The emulator reached an opcode it does not implement. Programs that just passed the assembler should never hit this — the loaded program image is probably stale.',
    suggestion: 'Press Assemble (F6) or Reinitialize so the loaded program matches the editor.',
  },
  SYS001: {
    phase: 'syscall',
    severity: 'error',
    title: 'Unsupported MARS syscall',
    explanation:
      'This offline IDE implements the MARS syscalls 1 (print int), 4 (print string), 5 (read int), 8 (read string), 10 (exit), 11 (print char) and 12 (read char). Any other code, including SPIM-style codes above 100, is not available in this build.',
    suggestion: 'Use one of the implemented codes; exit the program with syscall 10.',
  },
  SYS002: {
    phase: 'syscall',
    severity: 'error',
    title: 'Invalid string for syscall',
    explanation:
      'Print-string (4) reads bytes from the address in $a0 until a NUL (0) byte. The string at that address never terminates within 4096 bytes — either $a0 points at the wrong place or the data is missing its terminator (.asciiz adds it automatically).',
    suggestion: 'Point $a0 at a .asciiz/.ascii string in the data section, or reserve space and store a 0 at the end.',
  },
  SYS003: {
    phase: 'syscall',
    severity: 'error',
    title: 'Invalid syscall arguments',
    explanation:
      'read-string (8) writes into the buffer at $a0 with a capacity of $a1 bytes. A negative $a1 is not a valid capacity, so the call faults instead of writing to arbitrary memory.',
    suggestion: 'Set $a1 to the buffer size in bytes (e.g. li $a1, 32) before the syscall.',
  },
  SYS004: {
    phase: 'syscall',
    severity: 'error',
    title: 'Invalid interactive input',
    explanation:
      'The value typed in the console does not match what the pending syscall accepts — read-int (5) wants a whole number in 32-bit range, read-char (12) wants at least one character. Nothing was sent to the program and execution stays paused.',
  },
  GEN001: {
    phase: 'system',
    severity: 'error',
    title: 'Unexpected internal error',
    explanation:
      'Something failed that this diagnostics system could not classify. The technical detail is preserved below for debugging; re-assembling the file normally resets the situation.',
  },
  WRN001: {
    phase: 'assembler',
    severity: 'warning',
    title: 'Label defined but never used',
    explanation:
      'Nothing in the file references this label. It is either left-over code or a reference that is missing (a branch/jump that should target it). The program still assembles and runs.',
  },
  INF001: {
    phase: 'assembler',
    severity: 'info',
    title: '.globl is accepted and ignored',
    explanation:
      '.globl/.global marks a symbol global for the linker. This IDE assembles one file with no linker, so the directive is accepted for MARS/QtSPIM source compatibility and has no effect on execution.',
  },
  HNT001: {
    phase: 'runtime',
    severity: 'hint',
    title: 'Kernel-reserved register',
    explanation:
      '$k0 and $k1 are reserved by convention for the operating system (interrupt handling). User programs should not use them — on real hardware that can corrupt exception handling. This simulator does not enforce it, so the code still runs; treat this as a portability hint.',
  },
};
