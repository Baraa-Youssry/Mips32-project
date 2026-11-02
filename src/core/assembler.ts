import type { Instruction, Program } from './types';
import { DATA_BASE, TEXT_BASE } from './types';
import { registerIndex } from './cpu';

export { DATA_BASE, TEXT_BASE };

const MAX_SPACE = 1_048_576;

/** Source-aware assembler error with line, category, and optional filename. */
export type AsmErrorCategory = 'syntax' | 'register' | 'immediate' | 'label' | 'directive' | 'operand' | 'unsupported';
export class AsmError extends Error {
  readonly line: number;
  /** The raw explanation without the "Line N:" prefix. */
  readonly detail: string;
  readonly category: AsmErrorCategory;
  readonly filename?: string;
  constructor(line: number, detail: string, category: AsmErrorCategory = 'syntax', filename?: string) {
    super(filename ? `${filename}: Line ${line}: ${detail}` : `Line ${line}: ${detail}`);
    this.name = 'AsmError';
    this.line = line;
    this.detail = detail;
    this.category = category;
    this.filename = filename;
  }
}

const R3 = new Set(['add', 'addu', 'sub', 'subu', 'and', 'or', 'xor', 'nor', 'slt', 'sltu', 'mul']);
const SHIFT_IMM = new Set(['sll', 'srl', 'sra']);
const SHIFT_VAR = new Set(['sllv', 'srlv', 'srav']);
const I16 = new Set(['addi', 'addiu', 'slti', 'sltiu', 'andi', 'ori', 'xori']);
const MULDIV = new Set(['mult', 'multu', 'div', 'divu']);
const HILO = new Set(['mfhi', 'mflo', 'mthi', 'mtlo']);
const BRANCH2 = new Set(['beq', 'bne']);                          // label operand at index 2
const BRANCH1 = new Set(['blez', 'bgtz', 'bltz', 'bgez']);        // label operand at index 1
const JUMP_ABS = new Set(['j', 'jal']);                           // target operand at index 0

const ARITY: Record<string, number> = {};
for (const op of R3) ARITY[op] = 3;
for (const op of SHIFT_IMM) ARITY[op] = 3;
for (const op of SHIFT_VAR) ARITY[op] = 3;
for (const op of I16) ARITY[op] = 3;
for (const op of MULDIV) ARITY[op] = 2;
for (const op of HILO) ARITY[op] = 1;
for (const op of BRANCH2) ARITY[op] = 3;
for (const op of BRANCH1) ARITY[op] = 2;
Object.assign(ARITY, { lui: 2, syscall: 0, li: 2, la: 2, move: 2, nop: 0, not: 2, neg: 2, lb: 2, lbu: 2, lh: 2, lhu: 2, lw: 2, sb: 2, sh: 2, sw: 2, j: 1, jal: 1, jr: 1, jalr: 2, subi: 3, b: 1, blt: 3, bgt: 3, ble: 3, bge: 3 });

const MEM_OPS = new Set(['lb', 'lbu', 'lh', 'lhu', 'lw', 'sb', 'sh', 'sw']);
const MEM_OPERAND = /^\s*(-?(?:0x[0-9a-fA-F]+|\d+))\s*\(\s*(\$\w+)\s*\)\s*$/;

/** Quote-aware comment stripper ('#' inside strings is preserved). */
export function stripComment(line: string): string {
  let inStr = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inStr) {
      if (ch === '\\') i++;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '#') return line.slice(0, i);
  }
  return line;
}

/** Comma splitter that respects quoted strings. */
function splitArgs(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      cur += ch;
      if (ch === '\\') { i++; if (i < text.length) cur += text[i]; }
      else if (ch === '"') inStr = false;
    } else if (ch === '"') { inStr = true; cur += ch; }
    else if (ch === ',') { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const encoder = new TextEncoder();

/** Parses a quoted string literal into its decoded value. */
function parseStringLiteral(arg: string, line: number): string {
  if (!(arg.length >= 2 && arg.startsWith('"') && arg.endsWith('"'))) {
    throw new AsmError(line, `expected quoted string, got ${arg || '(nothing)'}`);
  }
  const body = arg.slice(1, -1);
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch !== '\\') { out += ch; continue; }
    i++;
    const e = body[i];
    switch (e) {
      case 'n': out += '\n'; break;
      case 't': out += '\t'; break;
      case 'r': out += '\r'; break;
      case '0': out += '\0'; break;
      case 'b': out += '\b'; break;
      case 'f': out += '\f'; break;
      case '\\': out += '\\'; break;
      case '"': out += '"'; break;
      case "'": out += "'"; break;
      default: throw new AsmError(line, `unknown escape sequence '\\${e ?? ''}'`);
    }
  }
  return out;
}

function parseDataInt(text: string, line: number): number {
  const n = Number(text);
  if (!Number.isInteger(n) || n < -2147483648 || n > 4294967295) {
    throw new AsmError(line, `invalid data constant '${text}'`);
  }
  return n | 0;
}

function pushLE(out: number[], value: number, size: 1 | 2 | 4): void {
  for (let b = 0; b < size; b++) out.push((value >>> (8 * b)) & 0xff);
}

type Fixup = { offset: number; label: string; line: number; size: 1 | 2 | 4 };

function isIdentifier(text: string): boolean {
  return /^[A-Za-z_.$][\w.$]*$/.test(text);
}

/** Register operands must be $-prefixed ($t0, $31) - bare integers are silently misparsed otherwise. */
const REG_OPERAND = /^\$[A-Za-z0-9]+$/;
function isRegisterOperand(text: string): boolean {
  return REG_OPERAND.test(text);
}
/** Returns the integer value if the operand is a numeric literal, else null. */
function parseImmediateOperand(text: string): number | null {
  const n = Number(text);
  return Number.isInteger(n) && text.trim() !== '' ? n : null;
}

/** Validates a real (post-expansion) instruction's operands. */
function validateInstruction(ins: Instruction): void {
  const { op, args, line } = ins;
  const reg = (idx: number, role: string): number => {
    const text = String(args[idx] ?? '');
    if (!isRegisterOperand(text)) throw new AsmError(line, `${role}: expected register, got '${text}'`, 'register');
    try { return registerIndex(text); }
    catch { throw new AsmError(line, `${role}: expected register, got '${text}'`, 'register'); }
  };
  const int = (idx: number): number => {
    const n = Number(args[idx]);
    if (!Number.isInteger(n)) throw new AsmError(line, `expected integer, got '${args[idx]}'`, 'operand');
    return n;
  };
  const imm16 = (idx: number): number => {
    const n = int(idx);
    if (n < -32768 || n > 65535) throw new AsmError(line, `immediate out of range: '${args[idx]}' (expected -32768..65535)`, 'immediate');
    return n;
  };
  if (R3.has(op)) { reg(0, 'rd'); reg(1, 'rs'); reg(2, 'rt'); return; }
  if (SHIFT_IMM.has(op)) {
    reg(0, 'rd'); reg(1, 'rt');
    const sa = int(2);
    if (sa < 0 || sa > 31) throw new AsmError(line, `shift amount out of range: '${args[2]}' (expected 0..31)`, 'immediate');
    return;
  }
  if (SHIFT_VAR.has(op)) { reg(0, 'rd'); reg(1, 'rt'); reg(2, 'rs'); return; }
  if (I16.has(op)) { reg(0, 'rt'); reg(1, 'rs'); imm16(2); return; }
  if (MULDIV.has(op)) { reg(0, 'rs'); reg(1, 'rt'); return; }
  if (HILO.has(op)) { reg(0, op.startsWith('mt') ? 'rs' : 'rd'); return; }
  if (MEM_OPS.has(op)) {
    reg(0, 'rt');
    const m = args[1].match(MEM_OPERAND);
    if (!m) throw new AsmError(line, `invalid memory operand '${args[1]}' (expected offset($register), e.g. 0($t1))`);
    const off = Number(m[1]);
    if (!Number.isInteger(off) || off < -32768 || off > 65535) throw new AsmError(line, `offset out of range: '${m[1]}' (expected -32768..65535)`, 'immediate');
    try { registerIndex(m[2]); } catch { throw new AsmError(line, `unknown base register '${m[2]}'`, 'register'); }
    return;
  }
  if (op === 'lui') { reg(0, 'rt'); imm16(1); return; }
  if (BRANCH2.has(op)) { reg(0, 'rs'); reg(1, 'rt'); int(2); return; }
  if (BRANCH1.has(op)) { reg(0, 'rs'); int(1); return; }
  if (op === 'j' || op === 'jal') { int(0); return; }
  if (op === 'jr') { reg(0, 'rs'); return; }
  if (op === 'jalr') { reg(0, 'rd'); reg(1, 'rs'); return; }
  if (op === 'syscall') return;
  throw new AsmError(line, `unsupported instruction '${op}'`, 'unsupported');
}

/** Expands one source instruction (pseudo or real) into zero or more real instructions. */
function expandInstruction(op: string, args: string[], line: number, source: string, out: Instruction[]): void {
  const push = (o: string, a: string[]) => out.push({ op: o, args: a, line, source });
  if (op === 'jalr') {
    if (args.length === 1) push('jalr', ['$ra', args[0]]);
    else if (args.length === 2) push('jalr', [...args]);
    else throw new AsmError(line, `jalr expects 1 or 2 operands, got ${args.length}`, 'operand');
    return;
  }
  if (!(op in ARITY)) throw new AsmError(line, `unsupported instruction '${op}'`, 'unsupported');
  if (args.length !== ARITY[op]) throw new AsmError(line, `${op} expects ${ARITY[op]} operand(s), got ${args.length}`, 'operand');
  switch (op) {
    case 'nop': push('sll', ['$zero', '$zero', '0']); break;
    case 'move': push('addu', [args[0], args[1], '$zero']); break;
    case 'not': push('nor', [args[0], args[1], '$zero']); break;
    case 'neg': push('subu', [args[0], '$zero', args[1]]); break;
    case 'li': {
      const n = Number(args[1]);
      if (!Number.isInteger(n) || n < -2147483648 || n > 4294967295) {
        throw new AsmError(line, `li constant out of range: '${args[1]}'`, 'immediate');
      }
      const v = n | 0, rd = args[0];
      if (v >= -32768 && v <= 32767) push('addiu', [rd, '$zero', String(v)]);
      else if (v >= 0 && v <= 65535) push('ori', [rd, '$zero', String(v)]);
      else { push('lui', [rd, String((v >>> 16) & 0xffff)]); push('ori', [rd, rd, String(v & 0xffff)]); }
      break;
    }
    case 'la': {
      if (!isIdentifier(args[1])) throw new AsmError(line, `la: expected label, got '${args[1]}'`, 'label');
      push('lui', [args[0], `%hi(${args[1]})`]);
      push('ori', [args[0], args[0], `%lo(${args[1]})`]);
      break;
    }
    case 'subi': {
      const n = Number(args[2]);
      if (!Number.isInteger(n) || n < -32768 || n > 32767) {
        throw new AsmError(line, `subi immediate out of range: '${args[2]}' (expected -32768..32767)`, 'immediate');
      }
      push('addi', [args[0], args[1], String(-n)]);
      break;
    }
    case 'b': push('j', [args[0]]); break;
    case 'lb': case 'lbu': case 'lh': case 'lhu': case 'lw': case 'sb': case 'sh': case 'sw': {
      // MARS-compatible bare-label form: lw $t0, count  ->  la $at, count ; lw $t0, 0($at)
      if (MEM_OPERAND.test(args[1])) { push(op, [...args]); break; }
      if (isIdentifier(args[1])) {
        push('lui', ['$at', `%hi(${args[1]})`]);
        push('ori', ['$at', '$at', `%lo(${args[1]})`]);
        push(op, [args[0], '0($at)']);
        break;
      }
      throw new AsmError(line, `invalid memory operand '${args[1]}' (expected offset($register) or a label)`, 'operand');
    }
    case 'blt': case 'bgt': case 'ble': case 'bge': {
      // Register form: slt $at, x, y ; bxx $at, $zero, label
      // Immediate form: slti $at, rs, k(c) ; bxx ...  (condition expressed as rs < k)
      const [x, y, label] = args;
      const regX = isRegisterOperand(x), regY = isRegisterOperand(y);
      const immX = parseImmediateOperand(x), immY = parseImmediateOperand(y);
      const checkImm = (k: number, needsPlus1: boolean): number => {
        if (k < -32768 || k > 65535 || (needsPlus1 && k > 65534)) {
          throw new AsmError(line, `${op} immediate operand out of range: '${k}' (expected -32768..${needsPlus1 ? 65534 : 65535})`, 'immediate');
        }
        return needsPlus1 ? k + 1 : k;
      };
      const emit = (branch: 'bne' | 'beq', c: number): void => {
        push('slti', ['$at', regX ? x : y, String(c)]);
        push(branch, ['$at', '$zero', label]);
      };
      if (regX && regY) {
        // slt $at, x, y + bne/beq depending on op
        if (op === 'blt') { push('slt', ['$at', x, y]); push('bne', ['$at', '$zero', label]); }
        else if (op === 'bge') { push('slt', ['$at', x, y]); push('beq', ['$at', '$zero', label]); }
        else if (op === 'ble') { push('slt', ['$at', y, x]); push('beq', ['$at', '$zero', label]); }
        else { push('slt', ['$at', y, x]); push('bne', ['$at', '$zero', label]); } // bgt
      } else if (regX && immY !== null) {
        // rs OP k
        if (op === 'blt') emit('bne', checkImm(immY, false));   // rs < k
        else if (op === 'bge') emit('beq', checkImm(immY, false)); // !(rs < k)
        else if (op === 'ble') emit('bne', checkImm(immY, true));  // rs < k+1
        else emit('beq', checkImm(immY, true));                    // bgt: !(rs < k+1)
      } else if (immX !== null && regY) {
        // k OP rs
        if (op === 'bgt') emit('bne', checkImm(immX, false));   // rs < k
        else if (op === 'ble') emit('beq', checkImm(immX, false)); // !(rs < k)
        else if (op === 'blt') emit('beq', checkImm(immX, true));  // !(rs < k+1)
        else emit('bne', checkImm(immX, true));                    // bge: rs < k+1
      } else {
        throw new AsmError(line, `${op}: expected register operands, or one register and one immediate (got '${x}', '${y}')`, 'operand');
      }
      break;
    }
    default: push(op, [...args]);
  }
}

/**
 * Two-pass assembler.
 * Pass 1: labels, directives, pseudo expansion, address assignment.
 * Pass 2: label resolution (%hi/%lo, data fixups) + operand validation.
 * Assembly is atomic: any AsmError aborts before a Program is produced.
 * When `filename` is given it is prefixed to every error message.
 */
export function assemble(source: string, filename?: string): Program {
  try {
    return assembleInner(source);
  } catch (e) {
    if (e instanceof AsmError && filename && !e.filename) {
      throw new AsmError(e.line, e.detail, e.category, filename);
    }
    throw e;
  }
}

function assembleInner(source: string): Program {
  const instructions: Instruction[] = [];
  const labels = new Map<string, number>();
  const data: number[] = [];
  const fixups: Fixup[] = [];
  let section: 'text' | 'data' = 'text';

  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1;
    const line = stripComment(lines[index]).trim();
    if (!line) continue;

    let rest = line;
    for (;;) {
      const m = rest.match(/^([A-Za-z_.$][\w.$]*)\s*:/);
      if (!m) break;
      const label = m[1];
      if (labels.has(label)) throw new AsmError(lineNumber, `duplicate label '${label}'`, 'label');
      labels.set(label, section === 'text' ? TEXT_BASE + instructions.length * 4 : DATA_BASE + data.length);
      rest = rest.slice(m[0].length).trim();
    }
    if (!rest) continue;

    if (rest.startsWith('.')) {
      const m = rest.match(/^(\.\w+)\s*(.*)$/);
      if (!m) throw new AsmError(lineNumber, `cannot parse directive '${rest}'`);
      const directive = m[1].toLowerCase();
      const args = splitArgs(m[2]);
      switch (directive) {
        case '.text': section = 'text'; break;
        case '.data': section = 'data'; break;
        case '.globl': case '.global': break; // accepted, not needed by single-file programs
        case '.word': case '.byte': case '.half': {
          if (section !== 'data') throw new AsmError(lineNumber, `${directive} is only allowed in the .data section`);
          const size = directive === '.word' ? 4 : directive === '.half' ? 2 : 1;
          if (args.length === 0) throw new AsmError(lineNumber, `${directive} expects at least one value`);
          for (const a of args) {
            if (isIdentifier(a)) {
              fixups.push({ offset: data.length, label: a, line: lineNumber, size });
              for (let k = 0; k < size; k++) data.push(0);
            } else {
              pushLE(data, parseDataInt(a, lineNumber), size);
            }
          }
          break;
        }
        case '.ascii': case '.asciiz': {
          if (section !== 'data') throw new AsmError(lineNumber, `${directive} is only allowed in the .data section`);
          if (args.length === 0) throw new AsmError(lineNumber, `${directive} expects a string`);
          const text = parseStringLiteral(args[0], lineNumber);
          for (const b of encoder.encode(text)) data.push(b);
          if (directive === '.asciiz') data.push(0);
          break;
        }
        case '.space': {
          if (section !== 'data') throw new AsmError(lineNumber, '.space is only allowed in the .data section');
          const n = Number(args[0]);
          if (!Number.isInteger(n) || n < 0 || n > MAX_SPACE) throw new AsmError(lineNumber, `.space size must be 0..${MAX_SPACE}, got '${args[0] ?? ''}'`);
          for (let k = 0; k < n; k++) data.push(0);
          break;
        }
        case '.align': {
          const n = Number(args[0]);
          if (!Number.isInteger(n) || n < 0 || n > 4) throw new AsmError(lineNumber, `.align expects 0..4, got '${args[0] ?? ''}'`);
          if (section === 'data') {
            const boundary = 1 << n;
            while (data.length % boundary !== 0) data.push(0);
          }
          break;
        }
        default: throw new AsmError(lineNumber, `unknown directive '${directive}'`, 'directive');
      }
      continue;
    }

    if (section !== 'text') throw new AsmError(lineNumber, `instruction not allowed in .data section: '${rest.split(/[\s,]/)[0]}'`, 'directive');
    const m = rest.match(/^(\w+)\s*(.*)$/);
    if (!m) throw new AsmError(lineNumber, 'cannot parse instruction', 'syntax');
    const op = m[1].toLowerCase();
    const args = m[2] ? splitArgs(m[2]) : [];
    expandInstruction(op, args, lineNumber, lines[index].trim(), instructions);
  }

  // Pass 2: resolve label references and validate operands.
  for (let idx = 0; idx < instructions.length; idx++) {
    const ins = instructions[idx];
    for (let k = 0; k < ins.args.length; k++) {
      const m = ins.args[k].match(/^%(hi|lo)\(([\w.$]+)\)$/);
      if (!m) continue;
      const addr = labels.get(m[2]);
      if (addr === undefined) throw new AsmError(ins.line, `undefined label '${m[2]}'`, 'label');
      ins.args[k] = String(m[1] === 'hi' ? (addr >>> 16) & 0xffff : addr & 0xffff);
    }
    // Branch/jump targets: resolve label -> absolute byte address, range-check.
    let targetIdx = -1;
    if (BRANCH2.has(ins.op)) targetIdx = 2;
    else if (BRANCH1.has(ins.op)) targetIdx = 1;
    else if (JUMP_ABS.has(ins.op)) targetIdx = 0;
    if (targetIdx >= 0) {
      const operand = ins.args[targetIdx];
      let target = Number(operand);
      if (!Number.isInteger(target)) {
        const addr = labels.get(operand);
        if (addr === undefined) throw new AsmError(ins.line, `undefined label '${operand}'`, 'label');
        target = addr;
      }
      ins.args[targetIdx] = String(target);
      const pc = TEXT_BASE + idx * 4;
      if (JUMP_ABS.has(ins.op)) {
        if (target % 4 !== 0) throw new AsmError(ins.line, `jump target not word-aligned: '${operand}'`, 'label');
        if ((target >>> 28) !== ((pc + 4) >>> 28)) throw new AsmError(ins.line, `jump target out of range: '${operand}'`, 'label');
      } else {
        const delta = target - (pc + 4);
        if (delta % 4 !== 0 || delta < -131072 || delta > 131068) throw new AsmError(ins.line, `branch target out of range: '${operand}'`, 'label');
      }
    }
    validateInstruction(ins);
  }
  for (const f of fixups) {
    const addr = labels.get(f.label);
    if (addr === undefined) throw new AsmError(f.line, `undefined label '${f.label}'`, 'label');
    for (let b = 0; b < f.size; b++) data[f.offset + b] = (addr >>> (8 * b)) & 0xff;
  }

  return { instructions, labels, data: new Uint8Array(data), dataBase: DATA_BASE, textBase: TEXT_BASE };
}

/** Every instruction name (real + pseudo) this IDE can assemble. */
export const SUPPORTED_INSTRUCTIONS: ReadonlySet<string> = new Set(Object.keys(ARITY));

/** Every directive this IDE accepts. */
export const SUPPORTED_DIRECTIVES: readonly string[] = [
  '.text',
  '.data',
  '.globl',
  '.global',
  '.word',
  '.byte',
  '.half',
  '.ascii',
  '.asciiz',
  '.space',
  '.align',
];

/** Expected operand count for an instruction, or undefined when unsupported. */
export function instructionArity(op: string): number | undefined {
  return ARITY[op.toLowerCase()];
}
